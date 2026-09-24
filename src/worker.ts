import * as ort from "onnxruntime-web";
import { buildProvenance } from "./provenance";
import { separate, SeparationCancelledError } from "./separate";
import type { SeparateRequest, StemPayload, WorkerInMessage, WorkerOutMessage } from "./worker-protocol";

// Shadows the ambient DOM `self` for just this file, so this module worker
// doesn't need the "WebWorker" lib added to the shared tsconfig (which
// would conflict with "DOM", used by every main-thread file). See
// plan/REVIEW.md #1 for why decoding stays on the main thread and only
// this narrow message channel crosses into the worker.
declare const self: {
  postMessage(message: WorkerOutMessage, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerInMessage>) => void): void;
};

let cancelled = false;

function post(message: WorkerOutMessage, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

async function handleSeparate(request: SeparateRequest): Promise<void> {
  try {
    const result = await separate(request.left, request.right, request.mode, {
      onProgress: (p) => post({ type: "progress", stage: p.stage, completed: p.completed, total: p.total }),
      isCancelled: () => cancelled,
    });

    const provenance = buildProvenance({
      ortVersion: ort.env.versions.web ?? "unknown",
      models: result.models.map((m) => ({ name: m.name, sha256: m.sha256 })),
      inputSha256: request.fileSha256,
      inputFileName: request.fileName,
      executionProvider: result.executionProvider,
      threadCount: result.threadCount,
      mode: request.mode,
    });

    const stems: StemPayload[] = Object.entries(result.stems).map(([stem, channels]) => ({
      stem: stem as StemPayload["stem"],
      left: channels[0],
      right: channels[1],
    }));
    const transfer: Transferable[] = stems.flatMap((s) => [s.left.buffer, s.right.buffer]);
    post({ type: "result", stems, provenance }, transfer);
  } catch (err) {
    if (err instanceof SeparationCancelledError) {
      post({ type: "cancelled" });
      return;
    }
    post({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : "Error",
    });
  }
}

self.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "cancel") {
    cancelled = true;
    return;
  }
  if (message.type === "separate") {
    cancelled = false;
    void handleSeparate(message);
  }
});
