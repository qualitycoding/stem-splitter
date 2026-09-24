import { SAMPLE_RATE } from "../dsp/chunk";

/** Clamp to [-1, 1] and scale to a 16-bit signed sample. Clamps rather than
 * wrapping so an over-driven mix never turns into digital noise (T-007). */
function floatToInt16(x: number): number {
  const clamped = x > 1 ? 1 : x < -1 ? -1 : x;
  return Math.round(clamped < 0 ? clamped * 32768 : clamped * 32767);
}

/**
 * Encodes stereo float samples as a 44-byte-header, 16-bit PCM WAV file.
 * `left`/`right` must be the same length.
 */
export function encodeWavPCM16(left: Float32Array, right: Float32Array, sampleRate: number = SAMPLE_RATE): Uint8Array {
  if (left.length !== right.length) {
    throw new RangeError(`encodeWavPCM16: channel length mismatch (${left.length} vs ${right.length})`);
  }
  const numFrames = left.length;
  const numChannels = 2;
  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  let offset = 0;
  const writeAscii = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i));
  };

  writeAscii("RIFF");
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;
  writeAscii("WAVE");

  writeAscii("fmt ");
  view.setUint32(offset, 16, true);
  offset += 4; // PCM fmt chunk size
  view.setUint16(offset, 1, true);
  offset += 2; // audio format 1 = PCM
  view.setUint16(offset, numChannels, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, byteRate, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, bitsPerSample, true);
  offset += 2;

  writeAscii("data");
  view.setUint32(offset, dataSize, true);
  offset += 4;

  for (let i = 0; i < numFrames; i++) {
    view.setInt16(offset, floatToInt16(left[i]), true);
    offset += 2;
    view.setInt16(offset, floatToInt16(right[i]), true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

export function wavBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes.slice()], { type: "audio/wav" });
}

/** Parses just enough of a WAV header back out to verify what was written —
 * used by tests; not needed by the app itself. */
export function readWavHeader(bytes: Uint8Array): {
  riff: string;
  wave: string;
  audioFormat: number;
  numChannels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  dataSize: number;
  dataOffset: number;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  return {
    riff: ascii(0, 4),
    wave: ascii(8, 4),
    audioFormat: view.getUint16(20, true),
    numChannels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    dataSize: view.getUint32(40, true),
    dataOffset: 44,
  };
}
