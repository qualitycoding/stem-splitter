// Run-record validation, target verdicts and report rendering (plans/perf-divergence D-102, D-103).
// STUB: functions throw until step S-103/S-106. Imports carry ".ts" extensions (see stats.ts).
import type { ModelPhase } from "./timeline.ts";

export type ConfigId = "wasm-1t" | "wasm-mt" | "webgpu-standard" | "webgpu-hq";

export interface RunProvenance {
  gitCommit: string;
  lockfileSha256: string;
  ortVersion: string;
  browser: string;
  os: string;
  cpuModel: string;
  logicalCores: number;
  /** null = not recorded (allowed but flagged in the report). */
  acPower: boolean | null;
  startedAtUtc: string;
}

export interface RunRecord {
  schema: 1;
  id: string;
  config: ConfigId;
  input: { name: string; sha256: string; durationSeconds: number; chunkCount: number };
  /** Mbit/s cap applied via CDP, or null when unthrottled. */
  throttleMbps: number | null;
  /** True only if the Cache API held no copy of the model at run start. */
  cacheCold: boolean;
  executionProvider: "wasm" | "webgpu";
  threadCount: number;
  models: ModelPhase[];
  provenance: RunProvenance;
}

export type VerdictId = "T-027" | "T-027-M1" | "T-028" | "T-029" | "T-030";
export type Verdict = "pass" | "fail" | "unmeasured";

export interface TargetCheck {
  name: string;
  measuredMs: number | null;
  thresholdMs: number;
  ok: boolean | null;
}

export interface TargetVerdict {
  id: VerdictId;
  verdict: Verdict;
  runsUsed: number;
  checks: TargetCheck[];
  /** Human-readable reason, always set (e.g. "n=2 < 3 required runs", "no Apple M1 record"). */
  basis: string;
}

/**
 * Thresholds to be copied from plan/PLAN.md T-027..T-030 in step S-103 (frozen by tests/unit/perf-report.test.ts).
 * STUB: zero placeholders until then.
 */
export const TARGET_THRESHOLDS_MS = {
  "T-027": 0,
  "T-027-M1": 0,
  "T-028-separation": 0,
  "T-028-session": 0,
  "T-029": 0,
  "T-030": 0,
} as const;

/** STUB: 0 until S-103 (required: 3). */
export const MIN_RUNS_PER_VERDICT: number = 0;

/** Returns human-readable problems; [] means the record is valid. Never throws on bad input. */
export function validateRunRecord(_record: unknown): string[] {
  throw new Error("not implemented: validateRunRecord (S-103)");
}

/** Only VALID records with durationSeconds >= 240 count toward T-027/T-028/T-030. Extrapolations never yield pass/fail. */
export function evaluateTargets(_records: readonly RunRecord[]): TargetVerdict[] {
  throw new Error("not implemented: evaluateTargets (S-106)");
}

/** Deterministic markdown: same records (any order) -> identical string. Every number is derived from `records`. */
export function renderReport(_records: readonly RunRecord[]): string {
  throw new Error("not implemented: renderReport (S-106)");
}
