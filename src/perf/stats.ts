// Pure statistics + extrapolation for the performance record (plans/perf-divergence D-104).
// Runtime imports use explicit ".ts" extensions so `node scripts/perf/report.ts` can run this file
// under Node's native type stripping (tsconfig: allowImportingTsExtensions + erasableSyntaxOnly).
import { planChunks } from "../dsp/chunk.ts";

export interface DistributionSummary {
  n: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  q1: number;
  q3: number;
  iqr: number;
}

/** Linear-interpolation quantile (R type 7 / numpy default). Throws RangeError on empty input, q outside [0,1], or non-finite values. Does not mutate `xs`. */
export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) throw new RangeError("quantile: xs must not be empty");
  if (!Number.isFinite(q) || q < 0 || q > 1) throw new RangeError(`quantile: q must be in [0, 1], got ${q}`);
  const sorted = [...xs].sort((a, b) => a - b);
  for (const x of sorted) {
    if (!Number.isFinite(x)) throw new RangeError(`quantile: all values must be finite, got ${x}`);
  }
  const h = (sorted.length - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export function summarizeDistribution(xs: readonly number[]): DistributionSummary {
  if (xs.length === 0) throw new RangeError("summarizeDistribution: xs must not be empty");
  const q1 = quantile(xs, 0.25);
  const median = quantile(xs, 0.5);
  const q3 = quantile(xs, 0.75);
  return {
    n: xs.length,
    min: Math.min(...xs),
    max: Math.max(...xs),
    mean: xs.reduce((a, b) => a + b, 0) / xs.length,
    median,
    q1,
    q3,
    iqr: q3 - q1,
  };
}

/** Number of model runs (chunks) for `seconds` of audio: planChunks(Math.round(seconds * sampleRate)).length. RangeError unless seconds > 0. */
export function chunkCountForDuration(seconds: number, sampleRate = 44_100): number {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new RangeError(`chunkCountForDuration: seconds must be a positive finite number, got ${seconds}`);
  }
  return planChunks(Math.round(seconds * sampleRate)).length;
}

/**
 * Predicts total separation time for `targetChunkCount` chunks from a measured run:
 * chunkMs[0] (warm-up chunk) + (target - 1) * median(chunkMs.slice(1)).
 * RangeError if fewer than 2 measured chunks (no steady state) or target is not a positive integer.
 * An extrapolation is INDICATIVE ONLY; it must never be turned into a pass/fail verdict (see report.ts).
 */
export function extrapolateSeparationMs(chunkMs: readonly number[], targetChunkCount: number): number {
  if (chunkMs.length < 2) throw new RangeError("extrapolateSeparationMs: need at least 2 measured chunks for a steady state");
  for (const c of chunkMs) {
    if (!Number.isFinite(c) || c < 0) throw new RangeError(`extrapolateSeparationMs: chunk times must be finite and non-negative, got ${c}`);
  }
  if (!Number.isInteger(targetChunkCount) || targetChunkCount < 1) {
    throw new RangeError(`extrapolateSeparationMs: targetChunkCount must be a positive integer, got ${targetChunkCount}`);
  }
  const steady = quantile(chunkMs.slice(1), 0.5);
  return chunkMs[0] + (targetChunkCount - 1) * steady;
}
