import { describe, expect, it } from "vitest";
import { OVERLAP_SAMPLES, planChunks, SEGMENT_SAMPLES, STRIDE_SAMPLES, triangularWindow } from "../../src/dsp/chunk";

describe("chunk geometry constants (T-004)", () => {
  it("matches demucs_onnx.inference (SP-1)", () => {
    expect(SEGMENT_SAMPLES).toBe(343_980);
    expect(OVERLAP_SAMPLES).toBe(85_995);
    expect(STRIDE_SAMPLES).toBe(257_985);
  });
});

describe("planChunks (T-004)", () => {
  it("produces a single chunk for input shorter than the stride", () => {
    const chunks = planChunks(1000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ start: 0, end: 1000, length: 1000 });
  });

  it("produces a single chunk for exactly one sample", () => {
    const chunks = planChunks(1);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ start: 0, end: 1, length: 1 });
  });

  it("count is ceil(totalLength / stride), minimum 1", () => {
    for (const totalLength of [1, STRIDE_SAMPLES, STRIDE_SAMPLES + 1, 4 * STRIDE_SAMPLES, 4 * STRIDE_SAMPLES + 1]) {
      const chunks = planChunks(totalLength);
      expect(chunks.length).toBe(Math.max(1, Math.ceil(totalLength / STRIDE_SAMPLES)));
    }
  });

  it("every chunk after the first starts exactly one stride after the previous", () => {
    const chunks = planChunks(4 * STRIDE_SAMPLES + 12_345);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].start - chunks[i - 1].start).toBe(STRIDE_SAMPLES);
    }
  });

  it("no chunk exceeds the segment length; truncation (once it starts) never reverses", () => {
    // Because segment (343,980) is larger than stride (257,985), more than
    // one *trailing* chunk can end up shorter than a full segment — not
    // just the very last one. Once chunk i is short, every chunk after it
    // is short too (start positions only increase), so the true invariant
    // is monotonic truncation, not "only the last chunk is short".
    const chunks = planChunks(4 * STRIDE_SAMPLES + 12_345);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(SEGMENT_SAMPLES);
    const firstShort = chunks.findIndex((c) => c.length < SEGMENT_SAMPLES);
    expect(firstShort).toBeGreaterThanOrEqual(0); // this totalLength does produce a short tail
    for (let i = 0; i < firstShort; i++) expect(chunks[i].length).toBe(SEGMENT_SAMPLES);
    for (let i = firstShort; i < chunks.length; i++) expect(chunks[i].length).toBeLessThan(SEGMENT_SAMPLES);
  });

  it("the last chunk is shorter than the segment only when it needs to be", () => {
    const totalLength = 4 * STRIDE_SAMPLES + 12_345;
    const chunks = planChunks(totalLength);
    const last = chunks[chunks.length - 1];
    expect(last.end).toBe(totalLength);
    expect(last.length).toBe(totalLength - last.start);
  });

  it("covers every sample with no gaps (chunks[i+1].start <= chunks[i].end)", () => {
    for (const totalLength of [1, 500_000, 4 * STRIDE_SAMPLES + 1]) {
      const chunks = planChunks(totalLength);
      expect(chunks[0].start).toBe(0);
      expect(chunks[chunks.length - 1].end).toBe(totalLength);
      for (let i = 1; i < chunks.length; i++) {
        expect(chunks[i].start).toBeLessThanOrEqual(chunks[i - 1].end);
      }
    }
  });

  it("rejects non-positive or non-integer lengths", () => {
    expect(() => planChunks(0)).toThrow(RangeError);
    expect(() => planChunks(-5)).toThrow(RangeError);
    expect(() => planChunks(1.5)).toThrow(RangeError);
  });

  it("supports smaller custom segment/stride for fast tests elsewhere", () => {
    const chunks = planChunks(25, 10, 7);
    expect(chunks[0]).toEqual({ start: 0, end: 10, length: 10 });
    expect(chunks[chunks.length - 1].end).toBe(25);
  });
});

describe("triangularWindow", () => {
  it("is all ones with zero overlap", () => {
    const w = triangularWindow(10, 0);
    expect(Array.from(w)).toEqual(new Array(10).fill(1));
  });

  it("ramps 0 -> 1 at the start and 1 -> 0 at the end, matching np.linspace semantics", () => {
    // transition = floor(20 * 0.5) = 10
    const w = triangularWindow(20, 0.5);
    expect(w[0]).toBeCloseTo(0, 6);
    expect(w[9]).toBeCloseTo(1, 6);
    expect(w[10]).toBe(1); // untouched middle
    expect(w[19]).toBeCloseTo(0, 6);
    expect(w[10 - 1]).toBeCloseTo(w[19 - 9], 6); // symmetry
  });

  it("handles a single-sample transition like np.linspace(0, 1, 1) == [0.0]", () => {
    // segment=4, overlapFraction=0.25 -> transition = 1
    const w = triangularWindow(4, 0.25);
    expect(w[0]).toBe(0);
    expect(w[3]).toBe(0);
    expect(w[1]).toBe(1);
    expect(w[2]).toBe(1);
  });

  it("rejects a non-positive segment", () => {
    expect(() => triangularWindow(0)).toThrow(RangeError);
  });
});
