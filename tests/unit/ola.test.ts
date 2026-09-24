import { describe, expect, it } from "vitest";
import { planChunks, SEGMENT_SAMPLES } from "../../src/dsp/chunk";
import { computeOverlapWeights, OverlapAccumulator } from "../../src/dsp/ola";
import { extractStem, STEM_NAMES } from "../../src/dsp/stems";

function maxAbsDiff(a: Float32Array, b: Float32Array, from = 0, to = a.length): number {
  let max = 0;
  for (let i = from; i < to; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
}

function makeSignal(n: number, seed = 1): Float32Array {
  const out = new Float32Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    // cheap deterministic PRNG (mulberry32-ish), values roughly in [-1, 1]
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    out[i] = u * 2 - 1;
  }
  return out;
}

/** Runs an "identity model" through the OLA accumulator: for every chunk,
 * the model's output for a stem is exactly the chunk's own slice of
 * `left`/`right` (zero-padded to `segment` like a real model input would
 * be), so a correct implementation reconstructs the original signal. */
function reconstruct(left: Float32Array, right: Float32Array, segment: number, stride: number): [Float32Array, Float32Array] {
  const totalLength = left.length;
  const chunks = planChunks(totalLength, segment, stride);
  const acc = new OverlapAccumulator(totalLength, STEM_NAMES, chunks, segment);
  for (const chunk of chunks) {
    // Zero-padded full-segment "model output", channel-major like the real
    // (1, 4, 2, segment) tensor, replicated identically into all 4 rows.
    const data = new Float32Array(4 * 2 * segment);
    for (let row = 0; row < 4; row++) {
      const base = row * 2 * segment;
      data.set(left.subarray(chunk.start, chunk.end), base);
      data.set(right.subarray(chunk.start, chunk.end), base + segment);
    }
    for (const stem of STEM_NAMES) {
      const [l, r] = extractStem(data, stem, segment);
      acc.add(stem, chunk, l.subarray(0, chunk.length), r.subarray(0, chunk.length));
    }
  }
  const result = acc.finalize().get("vocals")!;
  return result;
}

// The triangular window (src/dsp/chunk.ts triangularWindow, ported bit-for-
// bit from demucs_onnx.inference._make_transition_window) is exactly 0 at
// its own index 0. The very first output sample of an entire track is
// covered by only one chunk (the first), so it gets weight exactly 0 and —
// per OverlapAccumulator's MIN_WEIGHT clamp — is forced to exactly 0
// regardless of input. This is a genuine, deterministic property of the
// reference algorithm (needed for bit-exact parity with demucs_onnx, T-006),
// not a defect in this port, so every reconstruction test below excludes
// global sample 0 from the equality check and a dedicated test documents it.
// The mirrored case (a final chunk that is exactly `segment` long, reaching
// into the tail-fade zone) would zero the true last sample the same way;
// none of the totalLengths below produce that case except the dedicated
// "single full-length chunk" test, which checks for it explicitly.

describe("OverlapAccumulator reconstruction (T-005)", () => {
  it("reconstructs a signal covering several full-overlap chunks (small segment)", () => {
    const segment = 100;
    const stride = 75; // 25% overlap
    const totalLength = 4 * stride + 40; // several chunks, last one short
    const left = makeSignal(totalLength, 1);
    const right = makeSignal(totalLength, 2);
    const [outL, outR] = reconstruct(left, right, segment, stride);
    expect(maxAbsDiff(outL, left, 1)).toBeLessThanOrEqual(1e-6);
    expect(maxAbsDiff(outR, right, 1)).toBeLessThanOrEqual(1e-6);
  });

  it("reconstructs exactly at chunk-boundary-adjacent samples (edges)", () => {
    const segment = 100;
    const stride = 75;
    const totalLength = 3 * stride; // ends exactly on a stride boundary; last chunk is short (75 < 100)
    const left = makeSignal(totalLength, 3);
    const right = makeSignal(totalLength, 4);
    const [outL, outR] = reconstruct(left, right, segment, stride);
    expect(outL[totalLength - 1]).toBeCloseTo(left[totalLength - 1], 5);
    expect(maxAbsDiff(outL, left, 1)).toBeLessThanOrEqual(1e-6);
    expect(maxAbsDiff(outR, right, 1)).toBeLessThanOrEqual(1e-6);
  });

  it("reconstructs a single short chunk (input shorter than the stride)", () => {
    const segment = 100;
    const stride = 75;
    const totalLength = 17;
    const left = makeSignal(totalLength, 5);
    const right = makeSignal(totalLength, 6);
    const [outL, outR] = reconstruct(left, right, segment, stride);
    expect(outL.length).toBe(totalLength);
    expect(maxAbsDiff(outL, left, 1)).toBeLessThanOrEqual(1e-6);
    expect(maxAbsDiff(outR, right, 1)).toBeLessThanOrEqual(1e-6);
  });

  it("reconstructs at full production segment/stride (SEGMENT_SAMPLES), several chunks", () => {
    const totalLength = 2 * 257_985 + 10_000; // a few real chunks
    const left = makeSignal(totalLength, 7);
    const right = makeSignal(totalLength, 8);
    const [outL, outR] = reconstruct(left, right, SEGMENT_SAMPLES, 257_985);
    expect(maxAbsDiff(outL, left, 1)).toBeLessThanOrEqual(1e-6);
    expect(maxAbsDiff(outR, right, 1)).toBeLessThanOrEqual(1e-6);
  });

  it("global sample 0 of any track is exactly 0 (window[0] === 0, only one chunk covers it)", () => {
    const totalLength = 340;
    const left = makeSignal(totalLength, 9);
    const right = makeSignal(totalLength, 10);
    const [outL, outR] = reconstruct(left, right, 100, 75);
    expect(outL[0]).toBe(0);
    expect(outR[0]).toBe(0);
  });

  it("a lone full-length chunk with no neighbour has both edges zeroed (window symmetry)", () => {
    // In production stride < segment always, so a later chunk's own
    // (nonzero) local window value covers what would otherwise be a
    // symmetric tail-zero — see the "edges" test above, where global sample
    // totalLength-1 reconstructs exactly for that reason. This test bypasses
    // planChunks to isolate the window's own edge symmetry in the one
    // configuration where nothing else can compensate: a single chunk that
    // is the entire track, with no overlapping neighbour at all.
    const segment = 100;
    const totalLength = segment;
    const left = makeSignal(totalLength, 11);
    const right = makeSignal(totalLength, 12);
    const chunks = [{ start: 0, end: totalLength, length: totalLength }];
    const acc = new OverlapAccumulator(totalLength, STEM_NAMES, chunks, segment);
    for (const stem of STEM_NAMES) acc.add(stem, chunks[0], left, right);
    const [outL] = acc.finalize().get("vocals")!;
    expect(outL[0]).toBe(0);
    expect(outL[totalLength - 1]).toBe(0);
    expect(maxAbsDiff(outL, left, 1, totalLength - 1)).toBeLessThanOrEqual(1e-6);
  });

  it("throws if add() is called after finalize()", () => {
    const chunks = planChunks(10, 10, 10);
    const acc = new OverlapAccumulator(10, STEM_NAMES, chunks, 10);
    acc.finalize();
    expect(() => acc.add("vocals", chunks[0], new Float32Array(10), new Float32Array(10))).toThrow();
  });

  it("throws for an unknown stem", () => {
    const chunks = planChunks(10, 10, 10);
    const acc = new OverlapAccumulator(10, ["vocals"], chunks, 10);
    expect(() => acc.add("drums", chunks[0], new Float32Array(10), new Float32Array(10))).toThrow();
  });
});

describe("computeOverlapWeights", () => {
  it("is positive everywhere except sample 0 (window[0] === 0 by construction)", () => {
    const segment = 100;
    const stride = 75;
    const totalLength = 300;
    const chunks = planChunks(totalLength, segment, stride);
    const w = computeOverlapWeights(totalLength, chunks, segment);
    expect(w.length).toBe(totalLength);
    expect(w[0]).toBe(0);
    expect(Math.min(...w.subarray(1))).toBeGreaterThan(0);
  });
});
