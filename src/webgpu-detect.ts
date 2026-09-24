/**
 * Used by both the main thread (src/ui.ts, for the mode selector — D-03:
 * high-quality mode is WebGPU-only) and the worker (src/model/session.ts,
 * for execution-provider selection — D-06). Kept dependency-free (no
 * onnxruntime-web import) so checking this on the main thread doesn't pull
 * the ~400 KB ORT JS runtime into the main bundle just to render a radio
 * button — see plan/REVIEW.md-style note in session.ts.
 */
export async function webgpuAvailable(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter != null;
  } catch {
    return false;
  }
}
