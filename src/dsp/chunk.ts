// Chunking geometry for overlap-add inference. Mirrors demucs_onnx.inference
// (Python) exactly — see research/spikes/SP-1.md and plan/DECISIONS.md D-05.
// The exported ONNX graph has a FIXED input shape (1, 2, SEGMENT_SAMPLES); a
// longer input must be split into SEGMENT_SAMPLES chunks with 25% overlap.

export const SAMPLE_RATE = 44_100;

/** 7.8 s @ 44.1 kHz — fixed by the exported ONNX graph, not configurable. */
export const SEGMENT_SAMPLES = 343_980;

export const OVERLAP_FRACTION = 0.25;
export const OVERLAP_SAMPLES = Math.floor(SEGMENT_SAMPLES * OVERLAP_FRACTION);
export const STRIDE_SAMPLES = SEGMENT_SAMPLES - OVERLAP_SAMPLES;

export interface ChunkPlan {
  readonly start: number;
  readonly end: number;
  /** end - start; equals `segment` for every chunk except (possibly) the last. */
  readonly length: number;
}

/**
 * Splits `totalLength` samples into overlapping chunks of at most `segment`
 * samples, `stride` samples apart. The last chunk is shorter than `segment`
 * rather than padded here — callers zero-pad when building the model input
 * (see src/separate.ts `makeInputTensor`), keeping this function pure and
 * about sample ranges only.
 */
export function planChunks(
  totalLength: number,
  segment: number = SEGMENT_SAMPLES,
  stride: number = STRIDE_SAMPLES,
): ChunkPlan[] {
  if (!Number.isInteger(totalLength) || totalLength <= 0) {
    throw new RangeError(`planChunks: totalLength must be a positive integer, got ${totalLength}`);
  }
  if (!Number.isInteger(segment) || segment <= 0) {
    throw new RangeError(`planChunks: segment must be a positive integer, got ${segment}`);
  }
  if (!Number.isInteger(stride) || stride <= 0 || stride > segment) {
    throw new RangeError(`planChunks: stride must be a positive integer <= segment, got ${stride}`);
  }

  const count = Math.max(1, Math.ceil(totalLength / stride));
  const chunks: ChunkPlan[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * stride;
    const end = Math.min(start + segment, totalLength);
    chunks.push({ start, end, length: end - start });
  }
  return chunks;
}

/**
 * Triangular fade-in/fade-out window used for overlap-add blending, built
 * over a fixed `segment` length. For a chunk shorter than `segment` (the
 * final chunk of a track), callers use `window.subarray(0, chunkLength)` —
 * this function always returns the full-length window.
 * Matches `demucs_onnx.inference._make_transition_window`.
 */
export function triangularWindow(segment: number, overlapFraction: number = OVERLAP_FRACTION): Float32Array {
  if (!Number.isInteger(segment) || segment <= 0) {
    throw new RangeError(`triangularWindow: segment must be a positive integer, got ${segment}`);
  }
  if (overlapFraction < 0 || overlapFraction > 1) {
    throw new RangeError(`triangularWindow: overlapFraction must be in [0, 1], got ${overlapFraction}`);
  }
  const transition = Math.floor(segment * overlapFraction);
  const window = new Float32Array(segment).fill(1);
  for (let i = 0; i < transition; i++) {
    // np.linspace(0, 1, transition)[i]; linspace(0, 1, 1) === [0.0]
    const v = transition > 1 ? i / (transition - 1) : 0;
    window[i] = v;
    window[segment - 1 - i] = v;
  }
  return window;
}
