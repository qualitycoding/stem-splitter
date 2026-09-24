import { describe, expect, it } from "vitest";
import { decodeTo44k } from "../../src/audio/decode";
import { AudioInputError } from "../../src/audio/errors";
import { SAMPLE_RATE } from "../../src/dsp/chunk";

// Fixtures generated with ffmpeg (see tests/fixtures/README.md) — real,
// small audio files, not synthetic bytes, so this exercises the browser's
// actual codecs via decodeAudioData.
import mp3Url from "../fixtures/tone.mp3?url";
import oggUrl from "../fixtures/tone.ogg?url";
import wav44kMonoUrl from "../fixtures/tone-44k-mono.wav?url";
import wav48kStereoUrl from "../fixtures/tone-48k-stereo.wav?url";
import notAudioUrl from "../fixtures/not-audio.txt?url";
import corruptMp3Url from "../fixtures/corrupt.mp3?url";

async function fetchAsFile(url: string, name: string, type: string): Promise<File> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new File([blob], name, { type });
}

describe("decodeTo44k (T-001)", () => {
  it("decodes a WAV file to 44.1 kHz stereo Float32 PCM", async () => {
    const file = await fetchAsFile(wav48kStereoUrl, "tone.wav", "audio/wav");
    const { left, right, sampleCount } = await decodeTo44k(file);
    expect(left.length).toBe(sampleCount);
    expect(right.length).toBe(sampleCount);
    // ~0.5 s of audio at 44.1 kHz; allow encoder/resampler slack.
    expect(sampleCount).toBeGreaterThan(0.45 * SAMPLE_RATE);
    expect(sampleCount).toBeLessThan(0.6 * SAMPLE_RATE);
  });

  it("decodes an MP3 file", async () => {
    const file = await fetchAsFile(mp3Url, "tone.mp3", "audio/mpeg");
    const { left, right, sampleCount } = await decodeTo44k(file);
    expect(sampleCount).toBeGreaterThan(0);
    expect(left.length).toBe(sampleCount);
    expect(right.length).toBe(sampleCount);
    // MP3 encoders commonly add priming/padding samples (LAME: ~1–2
    // frames \u2248 up to ~2600 samples at 44.1 kHz) — allow generous slack.
    expect(sampleCount).toBeGreaterThan(0.4 * SAMPLE_RATE);
    expect(sampleCount).toBeLessThan(0.7 * SAMPLE_RATE);
  });

  it("decodes an OGG (Vorbis) file", async () => {
    const file = await fetchAsFile(oggUrl, "tone.ogg", "audio/ogg");
    const { sampleCount, left, right } = await decodeTo44k(file);
    expect(sampleCount).toBeGreaterThan(0.4 * SAMPLE_RATE);
    expect(sampleCount).toBeLessThan(0.7 * SAMPLE_RATE);
    expect(left.length).toBe(right.length);
  });

  it("does not throw for silence-free real audio (sanity: not all-zero)", async () => {
    const file = await fetchAsFile(wav44kMonoUrl, "tone.wav", "audio/wav");
    const { left } = await decodeTo44k(file);
    const hasNonZero = Array.from(left.subarray(0, 1000)).some((v) => v !== 0);
    expect(hasNonZero).toBe(true);
  });
});

describe("decodeTo44k resampling (T-002)", () => {
  it("resamples a 48 kHz source to 44.1 kHz, correct sample count", async () => {
    const file = await fetchAsFile(wav48kStereoUrl, "tone-48k.wav", "audio/wav");
    const { sampleCount } = await decodeTo44k(file);
    const expected = Math.round(0.5 * SAMPLE_RATE);
    // decodeAudioData's own resampling (or the explicit fallback render,
    // plan/REVIEW.md #18) should land within a handful of samples of exact.
    expect(Math.abs(sampleCount - expected)).toBeLessThan(50);
  });
});

describe("decodeTo44k mono handling (T-003)", () => {
  it("duplicates a mono source to both channels", async () => {
    const file = await fetchAsFile(wav44kMonoUrl, "tone-mono.wav", "audio/wav");
    const { left, right } = await decodeTo44k(file);
    expect(left.length).toBe(right.length);
    expect(Array.from(left)).toEqual(Array.from(right));
  });
});

describe("decodeTo44k error handling (T-009)", () => {
  it("rejects a non-audio file with a typed AudioInputError, not a raw DOMException", async () => {
    const file = await fetchAsFile(notAudioUrl, "not-audio.txt", "text/plain");
    await expect(decodeTo44k(file)).rejects.toBeInstanceOf(AudioInputError);
  });

  it("rejects a truncated/corrupt audio file with AudioInputError", async () => {
    const file = await fetchAsFile(corruptMp3Url, "corrupt.mp3", "audio/mpeg");
    await expect(decodeTo44k(file)).rejects.toBeInstanceOf(AudioInputError);
  });

  it("rejects an empty file without decoding", async () => {
    const file = new File([], "empty.wav", { type: "audio/wav" });
    await expect(decodeTo44k(file)).rejects.toBeInstanceOf(AudioInputError);
  });

  it("never produces an unhandled promise rejection for a bad file", async () => {
    const file = await fetchAsFile(notAudioUrl, "not-audio.txt", "text/plain");
    // If decodeTo44k ever threw synchronously or produced a rejection
    // outside the returned promise, awaiting it here inside try/catch
    // would not be what failed — an unhandled rejection would surface as a
    // separate test-runner failure instead. This just documents the
    // expectation explicitly, in addition to the .rejects assertions above.
    let caught: unknown;
    try {
      await decodeTo44k(file);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AudioInputError);
  });
});
