import { describe, expect, it, vi } from "vitest";
import type { InferenceSession, Tensor } from "onnxruntime-web";
import { SEGMENT_SAMPLES } from "../../src/dsp/chunk";
import type { ModelInfo } from "../../src/model/hub";
import { separate, SeparationCancelledError } from "../../src/separate";

/**
 * A minimal stand-in for ort.InferenceSession: enough of the shape
 * separate.ts's runAllStems/runSingleStem actually use (inputNames,
 * outputNames, run(), release()) to exercise separate()'s cancellation and
 * multi-model-load flow without a real ONNX Runtime session, a real
 * model, or a browser. This is a genuine gap the browser suite can't
 * currently fill in this environment — see plan/PLAN.md "Implementation
 * status" — so it's worth covering here even though it's not one of the
 * plan's numbered tests.
 */
function fakeSession(rowCount = 4): { session: InferenceSession; runCount: () => number; released: () => boolean } {
  let runs = 0;
  let released = false;
  const session = {
    inputNames: ["mix"],
    outputNames: ["stems"],
    async run(): Promise<InferenceSession.OnnxValueMapType> {
      runs++;
      const data = new Float32Array(rowCount * 2 * SEGMENT_SAMPLES);
      const tensor = { data, dims: [1, rowCount, 2, SEGMENT_SAMPLES], type: "float32" } as unknown as Tensor;
      return { stems: tensor };
    },
    async release(): Promise<void> {
      released = true;
    },
  } as unknown as InferenceSession;
  return { session, runCount: () => runs, released: () => released };
}

function fakeLoader(fake: ReturnType<typeof fakeSession>) {
  return async (_info: ModelInfo) => ({ session: fake.session, executionProvider: "wasm" as const });
}

describe("separate() cancellation", () => {
  it("stops before running further chunks once isCancelled() returns true", async () => {
    const totalLength = 3 * 257_985 + 10_000; // several chunks
    const left = new Float32Array(totalLength);
    const right = new Float32Array(totalLength);
    const fake = fakeSession();

    let cancelled = false;
    const onProgress = vi.fn();
    const promise = separate(left, right, "standard", {
      createSessionForModel: fakeLoader(fake),
      onProgress: (p) => {
        onProgress(p);
        if (p.stage === "separating" && p.completed === 1) cancelled = true; // cancel after first chunk
      },
      isCancelled: () => cancelled,
    });

    await expect(promise).rejects.toBeInstanceOf(SeparationCancelledError);
    // Ran the first chunk, then stopped instead of running all of them.
    expect(fake.runCount()).toBeGreaterThanOrEqual(1);
    expect(fake.runCount()).toBeLessThan(4);
    expect(fake.released()).toBe(true); // session freed even on cancellation
  });

  it("never calls run() if already cancelled before the first chunk", async () => {
    const left = new Float32Array(1000);
    const right = new Float32Array(1000);
    const fake = fakeSession();

    const promise = separate(left, right, "standard", {
      createSessionForModel: fakeLoader(fake),
      isCancelled: () => true,
    });

    await expect(promise).rejects.toBeInstanceOf(SeparationCancelledError);
    expect(fake.runCount()).toBe(0);
    expect(fake.released()).toBe(true);
  });

  it("high-quality mode loads exactly one session per stem, in order, each released before the next loads", async () => {
    const left = new Float32Array(1000);
    const right = new Float32Array(1000);
    const loadedInfos: string[] = [];
    const releasedBeforeNextLoad: boolean[] = [];
    let currentFake: ReturnType<typeof fakeSession> | null = null;

    const result = await separate(left, right, "hq", {
      createSessionForModel: async (info: ModelInfo) => {
        if (currentFake) releasedBeforeNextLoad.push(currentFake.released());
        loadedInfos.push(info.name);
        currentFake = fakeSession();
        return { session: currentFake.session, executionProvider: "wasm" };
      },
    });

    expect(loadedInfos).toEqual(["htdemucs_ft_drums", "htdemucs_ft_bass", "htdemucs_ft_other", "htdemucs_ft_vocals"]);
    expect(releasedBeforeNextLoad.every(Boolean)).toBe(true); // R-04: freed before the next specialist loads
    expect(result.models).toHaveLength(4);
  });
});
