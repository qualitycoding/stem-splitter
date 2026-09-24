import { describe, expect, it } from "vitest";
import { encodeWavPCM16, readWavHeader } from "../../src/audio/wav";

describe("encodeWavPCM16 (T-007)", () => {
  it("writes correct RIFF header fields", () => {
    const n = 10;
    const bytes = encodeWavPCM16(new Float32Array(n), new Float32Array(n), 44_100);
    const h = readWavHeader(bytes);
    expect(h.riff).toBe("RIFF");
    expect(h.wave).toBe("WAVE");
    expect(h.audioFormat).toBe(1);
    expect(h.numChannels).toBe(2);
    expect(h.sampleRate).toBe(44_100);
    expect(h.blockAlign).toBe(4);
    expect(h.bitsPerSample).toBe(16);
    expect(h.byteRate).toBe(44_100 * 4);
    expect(h.dataSize).toBe(n * 4);
    expect(bytes.length).toBe(44 + n * 4);
  });

  it("round-trips in-range values losslessly to 16-bit precision", () => {
    const left = Float32Array.from([0, 0.5, -0.5, 1, -1]);
    const right = Float32Array.from([-1, 1, 0, 0.25, -0.25]);
    const bytes = encodeWavPCM16(left, right);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const expectedL = [0, 16384, -16384, 32767, -32768];
    const expectedR = [-32768, 32767, 0, 8192, -8192];
    for (let i = 0; i < left.length; i++) {
      expect(view.getInt16(44 + i * 4, true)).toBe(expectedL[i]);
      expect(view.getInt16(44 + i * 4 + 2, true)).toBe(expectedR[i]);
    }
  });

  it("clamps out-of-range values instead of wrapping", () => {
    const left = Float32Array.from([1.5, -1.5, 100, -100]);
    const right = Float32Array.from([2, -2, 1.0001, -1.0001]);
    const bytes = encodeWavPCM16(left, right);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < left.length; i++) {
      const l = view.getInt16(44 + i * 4, true);
      const r = view.getInt16(44 + i * 4 + 2, true);
      expect(l).toBeGreaterThanOrEqual(-32768);
      expect(l).toBeLessThanOrEqual(32767);
      expect(r).toBeGreaterThanOrEqual(-32768);
      expect(r).toBeLessThanOrEqual(32767);
    }
    // sign is preserved (clamped toward the correct extreme, not wrapped)
    expect(view.getInt16(44 + 0 * 4, true)).toBe(32767); // 1.5 -> +max
    expect(view.getInt16(44 + 1 * 4, true)).toBe(-32768); // -1.5 -> -max
    expect(view.getInt16(44 + 2 * 4, true)).toBe(32767); // 100 -> +max
    expect(view.getInt16(44 + 3 * 4, true)).toBe(-32768); // -100 -> -max
  });

  it("throws on mismatched channel lengths", () => {
    expect(() => encodeWavPCM16(new Float32Array(4), new Float32Array(5))).toThrow(RangeError);
  });
});
