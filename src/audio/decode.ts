import { SAMPLE_RATE } from "../dsp/chunk";
import { AudioInputError } from "./errors";

export interface DecodedAudio {
  left: Float32Array;
  right: Float32Array;
  /** Samples per channel (left.length === right.length === sampleCount). */
  sampleCount: number;
}

/**
 * Decodes a browser-native audio file to 44.1 kHz stereo Float32 PCM.
 * `OfflineAudioContext.decodeAudioData` resamples to the context's
 * sampleRate as part of decoding on current engines (plan/REVIEW.md #18);
 * the explicit render fallback below only runs if a browser hands back
 * something else.
 */
export async function decodeTo44k(file: File | Blob): Promise<DecodedAudio> {
  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await file.arrayBuffer();
  } catch (err) {
    throw new AudioInputError("Could not read the file.", { cause: err });
  }
  if (arrayBuffer.byteLength === 0) {
    throw new AudioInputError("The file is empty.");
  }

  // length=1 is a placeholder; decodeAudioData ignores it and only uses
  // the context's sampleRate as the resample target.
  const ctx = new OfflineAudioContext(2, 1, SAMPLE_RATE);
  let buffer: AudioBuffer;
  try {
    buffer = await ctx.decodeAudioData(arrayBuffer);
  } catch (err) {
    throw new AudioInputError(
      "Could not decode this file as audio. Try a common format like MP3, WAV, FLAC or OGG.",
      { cause: err },
    );
  }

  if (buffer.sampleRate !== SAMPLE_RATE) {
    buffer = await resampleTo44k(buffer);
  }
  return ensureStereo(buffer);
}

async function resampleTo44k(buffer: AudioBuffer): Promise<AudioBuffer> {
  const targetLength = Math.max(1, Math.ceil((buffer.duration * SAMPLE_RATE) - 1e-6));
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, targetLength, SAMPLE_RATE);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  return ctx.startRendering();
}

function ensureStereo(buffer: AudioBuffer): DecodedAudio {
  const left = buffer.getChannelData(0).slice();
  // Mono duplicates to both channels; a file with >2 channels (e.g. 5.1)
  // uses only its first two — not specified further in plan/DECISIONS.md.
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice() : left.slice();
  return { left, right, sampleCount: left.length };
}
