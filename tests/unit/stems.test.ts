import { describe, expect, it } from "vitest";
import { extractStem, STEM_NAMES } from "../../src/dsp/stems";

describe("STEM_NAMES order (C-005, T-011)", () => {
  it("matches demucs_onnx.inference.SOURCES exactly", () => {
    expect(STEM_NAMES).toEqual(["drums", "bass", "other", "vocals"]);
  });
});

describe("extractStem (T-011)", () => {
  const segment = 4;

  /** A synthetic (1, 4, 2, segment) output where row r, channel c is filled
   * with the constant value r * 10 + c, so picking the wrong row is obvious. */
  function syntheticOutput(): Float32Array {
    const data = new Float32Array(4 * 2 * segment);
    for (let row = 0; row < 4; row++) {
      for (let ch = 0; ch < 2; ch++) {
        const base = row * 2 * segment + ch * segment;
        data.fill(row * 10 + ch, base, base + segment);
      }
    }
    return data;
  }

  it("keeps row SOURCES.indexOf(stem) for every stem", () => {
    const data = syntheticOutput();
    for (const [row, stem] of STEM_NAMES.entries()) {
      const [left, right] = extractStem(data, stem, segment);
      expect(Array.from(left)).toEqual(new Array(segment).fill(row * 10 + 0));
      expect(Array.from(right)).toEqual(new Array(segment).fill(row * 10 + 1));
    }
  });

  it("vocals is row 3 (last), drums is row 0 (first)", () => {
    const data = syntheticOutput();
    expect(extractStem(data, "drums", segment)[0][0]).toBe(0);
    expect(extractStem(data, "vocals", segment)[0][0]).toBe(30);
  });

  it("throws for an unrecognised stem name", () => {
    const data = syntheticOutput();
    // @ts-expect-error deliberately invalid stem for the runtime check
    expect(() => extractStem(data, "guitar", segment)).toThrow(RangeError);
  });
});
