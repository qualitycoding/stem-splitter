import { describe, expect, it } from "vitest";
import { computeThreadCount } from "../../src/model/session";

describe("computeThreadCount (D-07)", () => {
  it("is 1 whenever not cross-origin isolated, regardless of hardwareConcurrency", () => {
    expect(computeThreadCount(1, false)).toBe(1);
    expect(computeThreadCount(16, false)).toBe(1);
  });

  it("is hardwareConcurrency - 1 when isolated, floored at 1", () => {
    expect(computeThreadCount(4, true)).toBe(3);
    expect(computeThreadCount(2, true)).toBe(1);
    expect(computeThreadCount(1, true)).toBe(1);
    expect(computeThreadCount(0, true)).toBe(1);
  });

  it("is capped at 8 even on very high core counts", () => {
    expect(computeThreadCount(32, true)).toBe(8);
  });
});
