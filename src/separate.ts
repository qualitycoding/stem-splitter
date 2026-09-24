import * as ort from "onnxruntime-web";
import { type ChunkPlan, planChunks, SEGMENT_SAMPLES } from "./dsp/chunk";
import { OverlapAccumulator } from "./dsp/ola";
import { extractStem, STEM_NAMES, type StemName } from "./dsp/stems";
import { getModel } from "./model/cache";
import { HQ_SPECIALIST_MODELS, MODELS, type ModelInfo, STANDARD_MODEL } from "./model/hub";
import { createSession, type ExecutionProvider, resolveThreadCount } from "./model/session";

export type SeparationMode = "standard" | "hq";

export interface SeparationProgress {
  stage: "loading-model" | "preparing-model" | "separating";
  completed: number;
  total: number;
}

export type StemBuffers = Record<StemName, [left: Float32Array, right: Float32Array]>;

export interface SeparationResult {
  stems: StemBuffers;
  executionProvider: ExecutionProvider;
  threadCount: number;
  models: ModelInfo[];
}

export class SeparationCancelledError extends Error {
  constructor() {
    super("Separation cancelled");
    this.name = "SeparationCancelledError";
  }
}

/** The model always expects exactly SEGMENT_SAMPLES; a short final chunk is
 * zero-padded here (the rest of `data` is already zero from `new Float32Array`). */
function makeInputTensor(left: Float32Array, right: Float32Array, chunk: ChunkPlan): ort.Tensor {
  const data = new Float32Array(2 * SEGMENT_SAMPLES);
  data.set(left.subarray(chunk.start, chunk.end), 0);
  data.set(right.subarray(chunk.start, chunk.end), SEGMENT_SAMPLES);
  return new ort.Tensor("float32", data, [1, 2, SEGMENT_SAMPLES]);
}

async function disposeAll(results: ort.InferenceSession.OnnxValueMapType): Promise<void> {
  await Promise.all(Object.values(results).map((v) => v.dispose?.()));
}

/** Standard mode: one session emits all four stems, (1, 4, 2, SEGMENT_SAMPLES). */
async function runAllStems(
  session: ort.InferenceSession,
  chunks: readonly ChunkPlan[],
  left: Float32Array,
  right: Float32Array,
  accumulator: OverlapAccumulator,
  onChunkDone: (completed: number) => void,
  isCancelled: () => boolean,
): Promise<void> {
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  for (let i = 0; i < chunks.length; i++) {
    if (isCancelled()) throw new SeparationCancelledError();
    const chunk = chunks[i];
    const results = await session.run({ [inputName]: makeInputTensor(left, right, chunk) });
    const data = results[outputName].data as Float32Array;
    for (const stem of STEM_NAMES) {
      const [l, r] = extractStem(data, stem);
      accumulator.add(stem, chunk, l.subarray(0, chunk.length), r.subarray(0, chunk.length));
    }
    await disposeAll(results);
    onChunkDone(i + 1);
  }
}

/** High-quality mode: one specialist session for `stem`; still emits all
 * four rows (one-hot bag aggregation, demucs_onnx), only its own row is kept. */
async function runSingleStem(
  session: ort.InferenceSession,
  stem: StemName,
  chunks: readonly ChunkPlan[],
  left: Float32Array,
  right: Float32Array,
  accumulator: OverlapAccumulator,
  onChunkDone: (completed: number) => void,
  isCancelled: () => boolean,
): Promise<void> {
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  for (let i = 0; i < chunks.length; i++) {
    if (isCancelled()) throw new SeparationCancelledError();
    const chunk = chunks[i];
    const results = await session.run({ [inputName]: makeInputTensor(left, right, chunk) });
    const data = results[outputName].data as Float32Array;
    const [l, r] = extractStem(data, stem);
    accumulator.add(stem, chunk, l.subarray(0, chunk.length), r.subarray(0, chunk.length));
    await disposeAll(results);
    onChunkDone(i + 1);
  }
}

export interface SeparateOptions {
  onProgress?: (p: SeparationProgress) => void;
  isCancelled?: () => boolean;
  /**
   * Overrides how a model's bytes become a session — everything else
   * (chunking, accumulation, standard vs. high-quality flow) still runs
   * for real. Defaults to the real cache+session path (getModel +
   * createSession). Tests use this to swap in a tiny synthetic ONNX
   * fixture (tests/fixtures/) instead of downloading the real ~166 MB
   * model, so the plumbing gets exercised against a real ORT session
   * without the network/time cost — see tests/browser/separate.test.ts.
   */
  createSessionForModel?: (info: ModelInfo) => Promise<{ session: ort.InferenceSession; executionProvider: ExecutionProvider }>;
}

async function defaultCreateSessionForModel(
  info: ModelInfo,
  onProgress: (p: SeparationProgress) => void,
): Promise<{ session: ort.InferenceSession; executionProvider: ExecutionProvider }> {
  const bytes = await getModel(info, (p) =>
    onProgress({ stage: "loading-model", completed: p.loaded, total: p.total || info.bytes }),
  );
  onProgress({ stage: "preparing-model", completed: 0, total: 1 });
  const result = await createSession(bytes);
  onProgress({ stage: "preparing-model", completed: 1, total: 1 });
  return result;
}

/**
 * D-01 public API. Runs entirely in the worker (src/worker.ts); `left`/
 * `right` are already-decoded 44.1 kHz Float32 PCM from the main thread.
 */
export async function separate(
  left: Float32Array,
  right: Float32Array,
  mode: SeparationMode,
  options: SeparateOptions = {},
): Promise<SeparationResult> {
  const onProgress = options.onProgress ?? (() => {});
  const isCancelled = options.isCancelled ?? (() => false);
  const loadModel = options.createSessionForModel ?? ((info) => defaultCreateSessionForModel(info, onProgress));

  const totalLength = left.length;
  const chunks = planChunks(totalLength);
  const accumulator = new OverlapAccumulator(totalLength, STEM_NAMES, chunks);
  const usedModels: ModelInfo[] = [];
  let executionProvider: ExecutionProvider = "wasm";
  const threadCount = resolveThreadCount();

  async function loadAndCreateSession(info: ModelInfo): Promise<{ session: ort.InferenceSession; executionProvider: ExecutionProvider }> {
    const result = await loadModel(info);
    if (isCancelled()) {
      await result.session.release();
      throw new SeparationCancelledError();
    }
    return result;
  }

  if (mode === "standard") {
    const info = MODELS[STANDARD_MODEL];
    const { session, executionProvider: ep } = await loadAndCreateSession(info);
    executionProvider = ep;
    usedModels.push(info);
    try {
      await runAllStems(session, chunks, left, right, accumulator, (completed) =>
        onProgress({ stage: "separating", completed, total: chunks.length }),
        isCancelled,
      );
    } finally {
      await session.release();
    }
  } else {
    for (const stem of STEM_NAMES) {
      if (isCancelled()) throw new SeparationCancelledError();
      const info = MODELS[HQ_SPECIALIST_MODELS[stem]];
      const { session, executionProvider: ep } = await loadAndCreateSession(info);
      executionProvider = ep; // every specialist resolves the same EP in practice; last one wins for provenance
      usedModels.push(info);
      try {
        await runSingleStem(session, stem, chunks, left, right, accumulator, (completed) =>
          onProgress({ stage: "separating", completed, total: chunks.length }),
          isCancelled,
        );
      } finally {
        await session.release(); // R-04: free memory before the next specialist loads
      }
    }
  }

  const finalized = accumulator.finalize();
  const stems = Object.fromEntries(STEM_NAMES.map((stem) => [stem, finalized.get(stem)!])) as StemBuffers;

  return { stems, executionProvider, threadCount, models: usedModels };
}
