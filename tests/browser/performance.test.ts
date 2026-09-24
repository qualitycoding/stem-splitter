import { describe, expect, it } from "vitest";
import { decodeTo44k } from "../../src/audio/decode";
import { separate } from "../../src/separate";

import golden20sUrl from "../fixtures/golden-20s.wav?url";

/**
 * Requires VITE_RUN_PERFORMANCE_TESTS=1 — downloads the real pinned
 * htdemucs model and runs real inference, so timings are meaningful but
 * machine-dependent (plan/PLAN.md T-027-030 are "informational on CI;
 * enforced on reference machines" — the SP-2 reference numbers are in
 * research/spikes/SP-2.md). Run with:
 *   VITE_RUN_PERFORMANCE_TESTS=1 npm run test:browser -- performance
 *
 * The assertions here are deliberately loose (order-of-magnitude sanity,
 * not the tight targets in plan/PLAN.md) so this doesn't flake on slower
 * CI hardware; read the logged timings for the real numbers.
 */
const enabled = import.meta.env.VITE_RUN_PERFORMANCE_TESTS === "1";

describe.skipIf(!enabled)("performance (T-027\u2013030)", () => {
  it("separates a 20 s clip and logs model-load + separation timing", async () => {
    const fileRes = await fetch(golden20sUrl);
    const file = new File([await fileRes.blob()], "golden-20s.wav", { type: "audio/wav" });
    const { left, right } = await decodeTo44k(file);

    const t0 = performance.now();
    let modelLoadedAt: number | null = null;
    const result = await separate(left, right, "standard", {
      onProgress: (p) => {
        if (p.stage === "separating" && p.completed === 1 && modelLoadedAt === null) {
          modelLoadedAt = performance.now();
        }
      },
    });
    const t1 = performance.now();

    const modelSeconds = ((modelLoadedAt ?? t1) - t0) / 1000;
    const separationSeconds = (t1 - (modelLoadedAt ?? t0)) / 1000;
    console.log(
      `[performance] EP=${result.executionProvider} threads=${result.threadCount} ` +
        `model-ready=${modelSeconds.toFixed(1)}s separation=${separationSeconds.toFixed(1)}s ` +
        `(SP-2 reference machine, 20s clip \u2248 4 chunks: WASM 3-thread create ~27s/separate ~87s, ` +
        `WebGPU create ~48s/separate ~5s \u2014 research/spikes/SP-2.md)`,
    );

    // Loose sanity bounds only — see docstring above for why.
    expect(modelSeconds).toBeLessThan(180);
    expect(separationSeconds).toBeLessThan(600);
    expect(result.stems.vocals[0].length).toBe(left.length);
  }, 900_000);
});
