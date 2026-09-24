import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../../src/model/hub";
import { createSession, type ExecutionProvider } from "../../src/model/session";
import { separate, type SeparationProgress } from "../../src/separate";

// Tiny synthetic ONNX fixtures (a few hundred bytes, no learned weights) with
// the SAME input/output shape as the real htdemucs graph — (1,2,343980) ->
// (1,4,2,343980) — generated with onnx.helper and verified against
// onnxruntime (Python) at authoring time; see tests/fixtures/README.md.
// This exercises real chunking + a real ORT session end-to-end without the
// ~166 MB download the real model needs (that's reserved for the golden
// parity test, tests/browser/golden-parity.test.ts, which needs the real
// weights to mean anything).
//   tiny-stem-model.onnx: every output row is an exact copy of the input
//   (row r, channel c) = mix channel c — good for "does the pipeline plumb
//   data through correctly at all" checks.
//   tiny-stem-model-distinct.onnx: row r = mix * (r + 1) — lets a test
//   confirm each stem's output came from the row SOURCES.indexOf(stem)
//   selects, through the real separate() pipeline (not just the pure
//   extractStem unit test, tests/unit/stems.test.ts T-011).
import tinyDistinctUrl from "../fixtures/tiny-stem-model-distinct.onnx?url";
import tinyModelUrl from "../fixtures/tiny-stem-model.onnx?url";

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fixture fetch failed: HTTP ${res.status} for ${url}`);
  return res.arrayBuffer();
}

function tinyLoader(fixtureUrl: string) {
  return async (_info: ModelInfo): Promise<{ session: Awaited<ReturnType<typeof createSession>>["session"]; executionProvider: ExecutionProvider }> => {
    const bytes = await fetchBytes(fixtureUrl);
    return createSession(bytes);
  };
}

function makeSine(n: number, freq = 440, sampleRate = 44_100, amplitude = 0.3): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

function isFiniteArray(a: Float32Array): boolean {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
  return true;
}

function rms(a: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * a[i];
  return Math.sqrt(sum / a.length);
}

describe("separate() full pipeline, standard mode (T-013)", () => {
  it("a 10 s input produces four stems each exactly the input's length", async () => {
    const n = 10 * 44_100; // spans two chunks (stride 257,985)
    const left = makeSine(n, 440);
    const right = makeSine(n, 445);
    const result = await separate(left, right, "standard", {
      createSessionForModel: tinyLoader(tinyModelUrl),
    });
    expect(["webgpu", "wasm"]).toContain(result.executionProvider);
    for (const stem of ["drums", "bass", "other", "vocals"] as const) {
      const [l, r] = result.stems[stem];
      expect(l.length).toBe(n);
      expect(r.length).toBe(n);
      expect(isFiniteArray(l)).toBe(true);
      expect(isFiniteArray(r)).toBe(true);
    }
  }, 30_000);

  it("reports separating progress starting near 0 and ending at total (T-008)", async () => {
    const n = 10 * 44_100;
    const left = makeSine(n);
    const right = makeSine(n);
    const events: SeparationProgress[] = [];
    await separate(left, right, "standard", {
      createSessionForModel: tinyLoader(tinyModelUrl),
      onProgress: (p) => events.push({ ...p }),
    });
    const separating = events.filter((e) => e.stage === "separating");
    expect(separating.length).toBeGreaterThan(0);
    expect(separating[0].completed).toBeLessThanOrEqual(1);
    const last = separating[separating.length - 1];
    expect(last.completed).toBe(last.total);
    expect(last.total).toBeGreaterThan(0);
    // Progress within a stage never goes backwards.
    for (let i = 1; i < separating.length; i++) {
      expect(separating[i].completed).toBeGreaterThanOrEqual(separating[i - 1].completed);
    }
  }, 30_000);
});

describe("separate() edge-case inputs (T-014, T-015)", () => {
  it("silence in produces near-zero energy stems", async () => {
    const n = 2 * 44_100;
    const left = new Float32Array(n);
    const right = new Float32Array(n);
    const result = await separate(left, right, "standard", {
      createSessionForModel: tinyLoader(tinyModelUrl),
    });
    for (const stem of ["drums", "bass", "other", "vocals"] as const) {
      const [l, r] = result.stems[stem];
      expect(rms(l)).toBeLessThan(1e-4);
      expect(rms(r)).toBeLessThan(1e-4);
    }
  }, 30_000);

  it("a full-scale (clipped-style) square wave produces no NaN/Inf", async () => {
    const n = 2 * 44_100;
    const left = new Float32Array(n).fill(1);
    const right = new Float32Array(n).fill(-1);
    for (let i = 0; i < n; i += 2) left[i] = -1; // alternating square wave
    const result = await separate(left, right, "standard", {
      createSessionForModel: tinyLoader(tinyModelUrl),
    });
    for (const stem of ["drums", "bass", "other", "vocals"] as const) {
      const [l, r] = result.stems[stem];
      expect(isFiniteArray(l)).toBe(true);
      expect(isFiniteArray(r)).toBe(true);
    }
  }, 30_000);
});

describe("separate() high-quality mode row selection, end-to-end", () => {
  it("each stem's output comes from the row matching SOURCES.indexOf(stem)", async () => {
    // tiny-stem-model-distinct.onnx: row r = mix * (r + 1). drums=row0
    // (x1), bass=row1 (x2), other=row2 (x3), vocals=row3 (x4). Every
    // specialist here is the SAME fixture (loaded independently per
    // stem, exactly like the real 4-specialist bag), so this confirms
    // runSingleStem/HQ_SPECIALIST_MODELS pick the right row per stem
    // through the real pipeline, not just the pure unit test (T-011).
    const n = 44_100; // one short chunk is enough
    const left = makeSine(n, 440, 44_100, 0.2);
    const right = makeSine(n, 440, 44_100, 0.2);
    const result = await separate(left, right, "hq", {
      createSessionForModel: tinyLoader(tinyDistinctUrl),
    });
    const expectedScale: Record<import("../../src/dsp/stems").StemName, number> = {
      drums: 1,
      bass: 2,
      other: 3,
      vocals: 4,
    };
    for (const [stem, scale] of Object.entries(expectedScale)) {
      const [l] = result.stems[stem as keyof typeof expectedScale];
      // Sample 0 is always forced to 0 by the window (see tests/unit/ola.test.ts);
      // compare elsewhere in the signal.
      const idx = 1000;
      expect(l[idx]).toBeCloseTo(left[idx] * scale, 4);
    }
    expect(result.models).toHaveLength(4);
  }, 60_000);
});
