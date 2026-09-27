import { describe, expect, it } from "vitest";
import { planChunks } from "../../src/dsp/chunk";
import { chunkCountForDuration, extrapolateSeparationMs, quantile, summarizeDistribution } from "../../src/perf/stats";

/**
 * FROZEN. Enforces success criteria PD-SC-1/PD-SC-2 (plans/perf-divergence/plan/PLAN.md), decision D-104, claim C-101
 * (tests/PERF.md timing defect). Tolerances: pure arithmetic on exactly representable values, so exact equality except
 * where noted (toBeCloseTo guards only float summation order).
 */
describe("quantile (T-101)", () => {
  it("matches numpy type-7 on known values", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0)).toBe(1);
    expect(quantile([1, 2, 3, 4], 1)).toBe(4);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(quantile([1, 2, 3, 4, 5], 0.75)).toBe(4);
  });
  it("is order-independent and does not mutate its input", () => {
    const xs = [5, 1, 4, 2, 3];
    expect(quantile(xs, 0.5)).toBe(3);
    expect(xs).toEqual([5, 1, 4, 2, 3]);
  });
  it("single element -> that element for every q", () => {
    expect(quantile([7], 0)).toBe(7);
    expect(quantile([7], 0.5)).toBe(7);
    expect(quantile([7], 1)).toBe(7);
  });
  it("rejects empty input, q outside [0,1], and non-finite values", () => {
    expect(() => quantile([], 0.5)).toThrow(RangeError);
    expect(() => quantile([1], -0.01)).toThrow(RangeError);
    expect(() => quantile([1], 1.01)).toThrow(RangeError);
    expect(() => quantile([1, Number.NaN], 0.5)).toThrow(RangeError);
    expect(() => quantile([1, Number.POSITIVE_INFINITY], 0.5)).toThrow(RangeError);
  });
});

describe("summarizeDistribution (T-102)", () => {
  it("summarises 1..5", () => {
    expect(summarizeDistribution([1, 2, 3, 4, 5])).toEqual({ n: 5, min: 1, max: 5, mean: 3, median: 3, q1: 2, q3: 4, iqr: 2 });
  });
  it("handles n=1 (iqr 0)", () => {
    expect(summarizeDistribution([9])).toEqual({ n: 1, min: 9, max: 9, mean: 9, median: 9, q1: 9, q3: 9, iqr: 0 });
  });
  it("rejects empty input", () => {
    expect(() => summarizeDistribution([])).toThrow(RangeError);
  });
});

describe("chunkCountForDuration (T-103)", () => {
  it("is 42 for a 4-minute song and 4 for the 20 s clip (the figures used in tests/PERF.md)", () => {
    expect(chunkCountForDuration(240)).toBe(42);
    expect(chunkCountForDuration(20)).toBe(4);
  });
  it("always equals planChunks(...).length (no second copy of the chunk geometry can drift)", () => {
    for (const seconds of [0.001, 1, 7.8, 7.8000227, 20, 60, 240, 600, 3600]) {
      expect(chunkCountForDuration(seconds)).toBe(planChunks(Math.round(seconds * 44_100)).length);
    }
  });
  it("honours an explicit sample rate", () => {
    expect(chunkCountForDuration(240, 48_000)).toBe(planChunks(240 * 48_000).length);
  });
  it("rejects non-positive or non-finite durations", () => {
    expect(() => chunkCountForDuration(0)).toThrow(RangeError);
    expect(() => chunkCountForDuration(-1)).toThrow(RangeError);
    expect(() => chunkCountForDuration(Number.NaN)).toThrow(RangeError);
  });
});

describe("extrapolateSeparationMs (T-104)", () => {
  it("= first chunk + (N-1) * median(rest)", () => {
    expect(extrapolateSeparationMs([20_000, 10_000, 10_000, 10_000], 42)).toBe(20_000 + 41 * 10_000);
    expect(extrapolateSeparationMs([30_000, 10_000, 12_000, 11_000], 5)).toBe(30_000 + 4 * 11_000);
  });
  it("uses the median, so one slow steady chunk does not move the prediction", () => {
    expect(extrapolateSeparationMs([9, 10, 10, 500, 10], 3)).toBe(9 + 2 * 10);
  });
  it("target of 1 returns just the first chunk", () => {
    expect(extrapolateSeparationMs([20_000, 10_000], 1)).toBe(20_000);
  });
  it("REGRESSION PD-defect: with equal chunks the prediction equals N * chunk, i.e. no chunk is dropped from the denominator", () => {
    // tests/PERF.md timed 3 chunks (61.7 s) and divided by 4 (15.4 s/chunk -> 10.8 min). With 4 equal 20.57 s chunks the
    // 42-chunk prediction must be 42 * 20.57 s (14.4 min), not 42 * 15.4 s.
    const chunk = 61_700 / 3;
    const predicted = extrapolateSeparationMs([chunk, chunk, chunk, chunk], 42);
    expect(predicted / 42).toBeCloseTo(chunk, 6);
    expect(predicted / 60_000).toBeGreaterThan(14.3);
  });
  it("needs a steady state: fewer than 2 measured chunks -> RangeError", () => {
    expect(() => extrapolateSeparationMs([20_000], 42)).toThrow(RangeError);
    expect(() => extrapolateSeparationMs([], 42)).toThrow(RangeError);
  });
  it("rejects a non-positive or fractional target and non-finite or negative chunk times", () => {
    expect(() => extrapolateSeparationMs([1, 1], 0)).toThrow(RangeError);
    expect(() => extrapolateSeparationMs([1, 1], 2.5)).toThrow(RangeError);
    expect(() => extrapolateSeparationMs([1, Number.NaN], 3)).toThrow(RangeError);
    expect(() => extrapolateSeparationMs([1, -1], 3)).toThrow(RangeError);
  });
});
