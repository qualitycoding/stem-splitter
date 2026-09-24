import { describe, expect, it } from "vitest";
import {
  AudioTooLongError,
  checkDuration,
  checkFileSize,
  FileTooLargeError,
  MAX_DURATION_SECONDS,
  MAX_FILE_BYTES,
  WARN_DURATION_SECONDS,
} from "../../src/security";

describe("checkFileSize (T-021, D-09)", () => {
  it("accepts a file at or under the limit", () => {
    expect(() => checkFileSize(new File([new Uint8Array(10)], "a.wav"))).not.toThrow();
  });

  it("rejects a file over the limit", () => {
    const file = { size: MAX_FILE_BYTES + 1, name: "big.wav" } as File;
    expect(() => checkFileSize(file)).toThrow(FileTooLargeError);
  });
});

describe("checkDuration (T-021, D-09)", () => {
  const sampleRate = 44_100;

  it("does not warn for a short track", () => {
    const result = checkDuration(60 * sampleRate, sampleRate); // 1 min
    expect(result.warn).toBe(false);
    expect(result.seconds).toBeCloseTo(60, 3);
  });

  it("warns between 5 and 10 minutes", () => {
    const result = checkDuration((WARN_DURATION_SECONDS + 1) * sampleRate, sampleRate);
    expect(result.warn).toBe(true);
  });

  it("does not warn at exactly the warn threshold", () => {
    const result = checkDuration(WARN_DURATION_SECONDS * sampleRate, sampleRate);
    expect(result.warn).toBe(false);
  });

  it("throws over 10 minutes", () => {
    expect(() => checkDuration((MAX_DURATION_SECONDS + 1) * sampleRate, sampleRate)).toThrow(AudioTooLongError);
  });

  it("does not throw at exactly the max", () => {
    expect(() => checkDuration(MAX_DURATION_SECONDS * sampleRate, sampleRate)).not.toThrow();
  });
});
