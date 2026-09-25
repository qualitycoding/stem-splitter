import { describe, expect, it } from "vitest";
import { decodeTo44k } from "../../src/audio/decode";
import { MODELS, STANDARD_MODEL } from "../../src/model/hub";
import { separate } from "../../src/separate";

import golden20sUrl from "../fixtures/golden-20s.wav?url";

/**
 * Requires BOTH:
 *  1. tests/fixtures/golden-reference.json — generated once by a
 *     maintainer with network access, via
 *     tests/fixtures/generate-golden-reference.py (see that file's
 *     docstring). Not committed by default in a sandboxed environment with
 *     no route to huggingface.co — this repo may or may not have it yet.
 *  2. The VITE_RUN_GOLDEN_PARITY=1 environment variable, since this test
 *     downloads the real ~166 MB pinned htdemucs model from Hugging Face
 *     (D-04) and is too slow/network-heavy to run on every push. Run it
 *     explicitly with:
 *       VITE_RUN_GOLDEN_PARITY=1 npm run test:browser -- golden-parity
 *
 * If either is missing, every test below skips itself with a clear reason
 * instead of failing the suite.
 */

interface ReferenceStem {
  length: number;
  rms_left: number;
  rms_right: number;
  samples: Record<string, { left: number; right: number }>;
}
interface ReferenceData {
  fixture_sha256: string;
  stems: Record<string, ReferenceStem>;
}

async function loadReference(): Promise<ReferenceData | null> {
  const url = new URL("../fixtures/golden-reference.json", import.meta.url);
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

const enabled = import.meta.env.VITE_RUN_GOLDEN_PARITY === "1";

describe.skipIf(!enabled)("golden parity vs demucs-onnx Python reference (T-006)", () => {
  it("standard model output matches the Python reference within 1e-3 max abs diff", async () => {
    const reference = await loadReference();
    if (!reference) {
      console.warn(
        "[golden-parity] tests/fixtures/golden-reference.json not found — " +
          "run tests/fixtures/generate-golden-reference.py first. Skipping.",
      );
      return;
    }

    const fileRes = await fetch(golden20sUrl);
    const file = new File([await fileRes.blob()], "golden-20s.wav", { type: "audio/wav" });
    const { left, right } = await decodeTo44k(file);

    // T-006 is defined on the WASM EP (plan/PLAN.md). Shadow navigator.gpu so
    // createSession() can't pick WebGPU on a machine that has it (T-016 owns
    // the WebGPU-vs-WASM bound).
    Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
    let result;
    try {
      result = await separate(left, right, "standard");
    } finally {
      delete (navigator as unknown as Record<string, unknown>).gpu;
    }
    expect(result.executionProvider).toBe("wasm");
    expect(result.models).toHaveLength(1);
    expect(result.models[0].name).toBe(STANDARD_MODEL);
    expect(result.models[0].sha256).toBe(MODELS[STANDARD_MODEL].sha256);

    let maxDiff = 0;
    for (const [stem, ref] of Object.entries(reference.stems)) {
      const [outL, outR] = result.stems[stem as keyof typeof result.stems];
      expect(outL.length).toBe(ref.length);
      for (const [indexStr, expected] of Object.entries(ref.samples)) {
        const i = Number(indexStr);
        maxDiff = Math.max(maxDiff, Math.abs(outL[i] - expected.left), Math.abs(outR[i] - expected.right));
      }
      // Whole-stem energy as a coarser cross-check than six sample points;
      // stems the reference itself renders near-silent (rms < 1e-3) are
      // dominated by relative noise, so only absolute-check those.
      let sumSq = 0;
      for (let k = 0; k < outL.length; k++) sumSq += outL[k] * outL[k];
      const rmsL = Math.sqrt(sumSq / outL.length);
      if (ref.rms_left >= 1e-3) expect(Math.abs(rmsL - ref.rms_left) / ref.rms_left).toBeLessThanOrEqual(1e-2);
      else expect(Math.abs(rmsL - ref.rms_left)).toBeLessThanOrEqual(1e-3);
    }
    console.info(`[golden-parity] max abs diff vs reference: ${maxDiff}`);
    expect(maxDiff).toBeLessThanOrEqual(1e-3);
  }, 900_000); // model download + WASM session creation + real inference; generous timeout
});
