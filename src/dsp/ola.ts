import { type ChunkPlan, OVERLAP_FRACTION, SEGMENT_SAMPLES, triangularWindow } from "./chunk";
import { type StemName } from "./stems";

/** Guards divide-by-zero in any output region no chunk actually covers (there
 * shouldn't be any — `planChunks` guarantees full coverage — but this matches
 * demucs_onnx.inference's own safety clamp). */
const MIN_WEIGHT = 1e-8;

/**
 * Summed window weight at every output sample. Depends only on the chunk
 * plan, not on how many stems or model runs contribute to it — Python's
 * `weight` array is likewise incremented once per chunk regardless of how
 * many specialist sessions ran over it (demucs_onnx.inference), so a stem
 * processed by itself (high-quality mode, one specialist at a time) is
 * normalised by exactly the same weights as a stem produced alongside the
 * other three (standard mode, one model for all sources).
 */
export function computeOverlapWeights(
  totalLength: number,
  chunks: readonly ChunkPlan[],
  segment: number = SEGMENT_SAMPLES,
  overlapFraction: number = OVERLAP_FRACTION,
): Float32Array {
  const window = triangularWindow(segment, overlapFraction);
  const weight = new Float32Array(totalLength);
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) weight[chunk.start + i] += window[i];
  }
  return weight;
}

export type StemChannels = readonly [left: Float32Array, right: Float32Array];

/**
 * Accumulates per-stem overlap-add output across chunks. Call `add()` once
 * per (stem, chunk) pair — in any order, and any number of times a stem is
 * revisited is fine as long as it's exactly once per chunk — then `finalize()`
 * once to normalise. Mirrors `demucs_onnx.inference._chunked_separate_*`.
 */
export class OverlapAccumulator {
  private readonly totalLength: number;
  private readonly window: Float32Array;
  private readonly weight: Float32Array;
  private readonly sums = new Map<StemName, [Float32Array, Float32Array]>();
  private finalized = false;

  constructor(
    totalLength: number,
    stems: readonly StemName[],
    chunks: readonly ChunkPlan[],
    segment: number = SEGMENT_SAMPLES,
    overlapFraction: number = OVERLAP_FRACTION,
  ) {
    this.totalLength = totalLength;
    this.window = triangularWindow(segment, overlapFraction);
    this.weight = computeOverlapWeights(totalLength, chunks, segment, overlapFraction);
    for (const stem of stems) {
      this.sums.set(stem, [new Float32Array(totalLength), new Float32Array(totalLength)]);
    }
  }

  /**
   * Accumulate one chunk's model output for one stem. `left`/`right` must
   * hold at least `chunk.length` samples — a model always emits `segment`
   * samples per chunk; only the first `chunk.length` are meaningful for a
   * zero-padded final chunk, and the caller passes exactly that many.
   */
  add(stem: StemName, chunk: ChunkPlan, left: ArrayLike<number>, right: ArrayLike<number>): void {
    if (this.finalized) throw new Error("OverlapAccumulator: add() called after finalize()");
    const pair = this.sums.get(stem);
    if (!pair) throw new Error(`OverlapAccumulator: unknown stem "${stem}"`);
    if (left.length < chunk.length || right.length < chunk.length) {
      throw new RangeError("OverlapAccumulator: chunk data shorter than chunk.length");
    }
    const [outL, outR] = pair;
    for (let i = 0; i < chunk.length; i++) {
      const w = this.window[i];
      outL[chunk.start + i] += left[i] * w;
      outR[chunk.start + i] += right[i] * w;
    }
  }

  /**
   * Normalise every accumulated stem by the summed window weight and return
   * the result. Safe to call once; a further `add()` throws.
   */
  finalize(): Map<StemName, [Float32Array, Float32Array]> {
    this.finalized = true;
    for (const [, [l, r]] of this.sums) {
      for (let i = 0; i < this.totalLength; i++) {
        const w = Math.max(this.weight[i], MIN_WEIGHT);
        l[i] /= w;
        r[i] /= w;
      }
    }
    return this.sums;
  }
}

// Re-exported so callers building an accumulator don't need a second import
// from ./chunk just for the plan type.
export type { ChunkPlan };
