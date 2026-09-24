import wasmJsepMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url";
import wasmJsepUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url";
import * as ort from "onnxruntime-web";
import { webgpuAvailable } from "../webgpu-detect";

export type ExecutionProvider = "webgpu" | "wasm";

export interface SessionResult {
  session: ort.InferenceSession;
  executionProvider: ExecutionProvider;
}

let ortConfigured = false;

function configureOrt(): void {
  if (ortConfigured) return;
  ortConfigured = true;
  // Import these two files (the pair the default onnxruntime-web entry
  // loads — confirmed in research/spikes/SP-1.md) via Vite's `?url` so
  // Vite's own bundler emits the single canonical hashed copy, the same
  // one its static analysis of onnxruntime-web's own internal
  // `new URL(...)` reference would otherwise ALSO emit — without this
  // explicit per-file map, `wasmPaths` as a directory prefix still works at
  // runtime, but leaves that auto-detected copy duplicated and unused in
  // the build output (D-06 note; found while implementing S-001/S-004).
  ort.env.wasm.wasmPaths = {
    mjs: wasmJsepMjsUrl,
    wasm: wasmJsepUrl,
  };
  ort.env.wasm.numThreads = resolveThreadCount();
  ort.env.logLevel = "warning";
}

/**
 * D-07: without cross-origin isolation, SharedArrayBuffer (and therefore
 * multi-threaded WASM) is unavailable, so numThreads must be 1 — this is
 * the "slow mode" fallback (plan/REVIEW.md #13), not a blocking error.
 * Pure so it's directly unit-testable (tests/unit/session.test.ts) without
 * needing to fake global `self`/`navigator` state.
 */
export function computeThreadCount(hardwareConcurrency: number, crossOriginIsolated: boolean): number {
  if (!crossOriginIsolated) return 1;
  return Math.min(8, Math.max(1, hardwareConcurrency - 1));
}

export function resolveThreadCount(): number {
  const isolated = typeof self !== "undefined" && self.crossOriginIsolated;
  const hardwareConcurrency = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
  return computeThreadCount(hardwareConcurrency, Boolean(isolated));
}

/**
 * D-12 (research/spikes/SP-2.md): the ONLY session options that load
 * htdemucs without exhausting the 4 GB wasm32 heap. Any graph optimisation
 * level above "disabled" causes `std::bad_alloc` at session creation —
 * verified across ORT 1.30/1.22/1.18, WASM and WebGPU. Do not change
 * without re-running research/spikes/sp2.py. Exported so tests/unit/
 * session-options.test.ts (T-033) can assert on it directly, as a cheap
 * regression guard that doesn't need a real session or model.
 */
export const SESSION_OPTIONS: Omit<ort.InferenceSession.SessionOptions, "executionProviders"> = {
  graphOptimizationLevel: "disabled",
  enableCpuMemArena: false,
  enableMemPattern: false,
};

/**
 * Creates a session, preferring WebGPU and falling back to WASM (decision
 * rule in plan/PLAN.md). Session creation is slow (tens of seconds on the
 * SP-2 reference machine) — callers should show a distinct "preparing
 * model" stage rather than treating it as part of "separating".
 */
export async function createSession(modelBytes: ArrayBuffer): Promise<SessionResult> {
  configureOrt();
  if (await webgpuAvailable()) {
    try {
      const session = await ort.InferenceSession.create(modelBytes, {
        ...SESSION_OPTIONS,
        executionProviders: ["webgpu"],
      });
      return { session, executionProvider: "webgpu" };
    } catch {
      // Fall through to WASM (plan/PLAN.md decision rule: "WebGPU session
      // creation fails: Silently fall back to WASM").
    }
  }
  const session = await ort.InferenceSession.create(modelBytes, {
    ...SESSION_OPTIONS,
    executionProviders: ["wasm"],
  });
  return { session, executionProvider: "wasm" };
}
