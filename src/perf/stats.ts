// Pure statistics + extrapolation for the performance record (plans/perf-divergence D-104).
// Runtime imports use explicit ".ts" extensions so `node scripts/perf/report.ts` can run this file
// under Node's native type stripping (tsconfig: allowImportingTsExtensions + erasableSyntaxOnly).
// STUB: every function throws until step S-102.

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
export function quantile(_xs: readonly number[], _q: number): number {
  throw new Error("not implemented: quantile (S-102)");
}

export function summarizeDistribution(_xs: readonly number[]): DistributionSummary {
  throw new Error("not implemented: summarizeDistribution (S-102)");
}

/** Number of model runs (chunks) for `seconds` of audio: planChunks(Math.round(seconds * sampleRate)).length. RangeError unless seconds > 0. */
export function chunkCountForDuration(_seconds: number, _sampleRate?: number): number {
  throw new Error("not implemented: chunkCountForDuration (S-102)");
}

/**
 * Predicts total separation time for `targetChunkCount` chunks from a measured run:
 * chunkMs[0] (warm-up chunk) + (target - 1) * median(chunkMs.slice(1)).
 * RangeError if fewer than 2 measured chunks (no steady state) or target is not a positive integer.
 * An extrapolation is INDICATIVE ONLY; it must never be turned into a pass/fail verdict (see report.ts).
 */
export function extrapolateSeparationMs(_chunkMs: readonly number[], _targetChunkCount: number): number {
  throw new Error("not implemented: extrapolateSeparationMs (S-102)");
}
