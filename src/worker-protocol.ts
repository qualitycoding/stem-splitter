import type { SeparationMode } from "./separate";
import type { StemName } from "./dsp/stems";

/** Sent once to start a separation. `left`/`right` are transferred
 * (D-01: decoding happens on the main thread; only raw sample arrays cross
 * into the worker — see plan/REVIEW.md #1). */
export interface SeparateRequest {
  type: "separate";
  left: Float32Array;
  right: Float32Array;
  mode: SeparationMode;
  fileName: string;
  fileSha256: string;
}

export interface CancelRequest {
  type: "cancel";
}

export type WorkerInMessage = SeparateRequest | CancelRequest;

export interface ProgressMessage {
  type: "progress";
  stage: "loading-model" | "preparing-model" | "separating";
  completed: number;
  total: number;
}

export interface StemPayload {
  stem: StemName;
  left: Float32Array;
  right: Float32Array;
}

export interface ResultMessage {
  type: "result";
  stems: StemPayload[];
  provenance: import("./provenance").Provenance;
}

export interface ErrorMessage {
  type: "error";
  message: string;
  name: string;
}

export interface CancelledMessage {
  type: "cancelled";
}

export type WorkerOutMessage = ProgressMessage | ResultMessage | ErrorMessage | CancelledMessage;
