// Run-record validation, target verdicts and report rendering (plans/perf-divergence D-102, D-103).
// STUB: evaluateTargets/renderReport throw until step S-106. Imports carry ".ts" extensions (see stats.ts).
import { chunkCountForDuration } from "./stats.ts";
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

/** Thresholds copied from plan/PLAN.md T-027..T-030 (frozen by tests/unit/perf-report.test.ts). */
export const TARGET_THRESHOLDS_MS = {
  "T-027": 16 * 60_000,
  "T-027-M1": 6 * 60_000,
  "T-028-separation": 90_000,
  "T-028-session": 60_000,
  "T-029": 45_000,
  "T-030": 8 * 60_000,
} as const;

export const MIN_RUNS_PER_VERDICT = 3;

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const CONFIG_IDS: readonly ConfigId[] = ["wasm-1t", "wasm-mt", "webgpu-standard", "webgpu-hq"];

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isFiniteNonNegative(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0;
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.length > 0;
}

/** Returns human-readable problems; [] means the record is valid. Never throws on bad input. */
export function validateRunRecord(record: unknown): string[] {
  if (!isPlainObject(record)) return ["record: expected an object"];
  const r = record;
  const problems: string[] = [];

  if (r.schema !== 1) problems.push(`schema: expected 1, got ${JSON.stringify(r.schema)}`);
  if (!isNonEmptyString(r.id)) problems.push("id: expected a non-empty string");

  const config = typeof r.config === "string" ? r.config : undefined;
  if (config === undefined || !CONFIG_IDS.includes(config as ConfigId)) {
    problems.push(`config: expected one of ${CONFIG_IDS.join(", ")}, got ${JSON.stringify(r.config)}`);
  }

  let chunkCount: number | null = null;
  const input = r.input;
  if (!isPlainObject(input)) {
    problems.push("input: expected an object");
  } else {
    if (!isNonEmptyString(input.name)) problems.push("input.name: expected a non-empty string");
    if (typeof input.sha256 !== "string" || !HEX64.test(input.sha256)) problems.push("input.sha256: expected 64 hex characters");
    const durationSeconds = input.durationSeconds;
    if (!isFiniteNonNegative(durationSeconds) || durationSeconds <= 0) {
      problems.push("input.durationSeconds: expected a positive number");
    }
    if (typeof input.chunkCount !== "number" || !Number.isInteger(input.chunkCount) || input.chunkCount <= 0) {
      problems.push("input.chunkCount: expected a positive integer");
    } else {
      chunkCount = input.chunkCount;
      if (isFiniteNonNegative(durationSeconds) && durationSeconds > 0) {
        const expected = chunkCountForDuration(durationSeconds);
        if (chunkCount !== expected) {
          problems.push(`input.chunkCount: expected ${expected} (chunkCountForDuration(${durationSeconds})), got ${chunkCount}`);
        }
      }
    }
  }

  if (r.throttleMbps !== null && (typeof r.throttleMbps !== "number" || !Number.isFinite(r.throttleMbps) || r.throttleMbps <= 0)) {
    problems.push(`throttleMbps: expected null or a positive number, got ${JSON.stringify(r.throttleMbps)}`);
  }

  if (typeof r.cacheCold !== "boolean") problems.push("cacheCold: expected a boolean");

  const executionProvider = r.executionProvider;
  if (executionProvider !== "wasm" && executionProvider !== "webgpu") {
    problems.push(`executionProvider: expected "wasm" or "webgpu", got ${JSON.stringify(executionProvider)}`);
  } else if (config !== undefined) {
    const expectedEp = config.startsWith("webgpu") ? "webgpu" : "wasm";
    if (executionProvider !== expectedEp) {
      problems.push(`executionProvider: config "${config}" implies "${expectedEp}", got "${executionProvider}"`);
    }
  }

  const threadCount = r.threadCount;
  if (typeof threadCount !== "number" || !Number.isInteger(threadCount) || threadCount < 1) {
    problems.push("threadCount: expected a positive integer");
  } else if (config === "wasm-mt" && threadCount === 1) {
    problems.push("threadCount: wasm-mt recorded with threadCount === 1 (silent single-thread fallback)");
  } else if (config === "wasm-1t" && threadCount > 1) {
    problems.push("threadCount: wasm-1t recorded with threadCount > 1 (expected exactly 1)");
  }

  const models = r.models;
  if (!Array.isArray(models)) {
    problems.push("models: expected an array");
  } else {
    const expectedPhaseCount = config === "webgpu-hq" ? 4 : 1;
    if (models.length !== expectedPhaseCount) {
      problems.push(`models: expected ${expectedPhaseCount} phase(s) for config "${config}", got ${models.length}`);
    }
    models.forEach((phase: unknown, i: number) => {
      if (!isPlainObject(phase)) {
        problems.push(`models[${i}]: expected an object`);
        return;
      }
      if (phase.downloadMs !== null && !isFiniteNonNegative(phase.downloadMs)) {
        problems.push(`models[${i}].downloadMs: expected null or a non-negative finite number`);
      }
      if (phase.sessionCreateMs !== null && !isFiniteNonNegative(phase.sessionCreateMs)) {
        problems.push(`models[${i}].sessionCreateMs: expected null or a non-negative finite number`);
      }
      if (!Array.isArray(phase.chunkMs)) {
        problems.push(`models[${i}].chunkMs: expected an array`);
      } else {
        phase.chunkMs.forEach((c: unknown, j: number) => {
          if (!isFiniteNonNegative(c)) problems.push(`models[${i}].chunkMs[${j}]: expected a non-negative finite number, got ${JSON.stringify(c)}`);
        });
        if (chunkCount !== null && phase.chunkMs.length !== chunkCount) {
          problems.push(`models[${i}].chunkMs: length ${phase.chunkMs.length} does not match input.chunkCount ${chunkCount}`);
        }
      }
    });
  }

  const provenance = r.provenance;
  if (!isPlainObject(provenance)) {
    problems.push("provenance: expected an object");
  } else {
    if (typeof provenance.gitCommit !== "string" || !HEX40.test(provenance.gitCommit)) {
      problems.push(`provenance.gitCommit: expected 40 hex characters, got ${JSON.stringify(provenance.gitCommit)}`);
    }
    if (typeof provenance.lockfileSha256 !== "string" || !HEX64.test(provenance.lockfileSha256)) {
      problems.push(`provenance.lockfileSha256: expected 64 hex characters, got ${JSON.stringify(provenance.lockfileSha256)}`);
    }
    if (!isNonEmptyString(provenance.ortVersion)) problems.push("provenance.ortVersion: expected a non-empty string");
    if (!isNonEmptyString(provenance.browser)) problems.push("provenance.browser: expected a non-empty string");
    if (!isNonEmptyString(provenance.os)) problems.push("provenance.os: expected a non-empty string");
    if (!isNonEmptyString(provenance.cpuModel)) problems.push("provenance.cpuModel: expected a non-empty string");
    if (typeof provenance.logicalCores !== "number" || !Number.isInteger(provenance.logicalCores) || provenance.logicalCores < 1) {
      problems.push("provenance.logicalCores: expected a positive integer");
    }
    if (provenance.acPower !== null && typeof provenance.acPower !== "boolean") {
      problems.push("provenance.acPower: expected null or a boolean");
    }
    if (!isNonEmptyString(provenance.startedAtUtc)) problems.push("provenance.startedAtUtc: expected a non-empty string");
  }

  return problems;
}

/** Only VALID records with durationSeconds >= 240 count toward T-027/T-028/T-030. Extrapolations never yield pass/fail. */
export function evaluateTargets(_records: readonly RunRecord[]): TargetVerdict[] {
  throw new Error("not implemented: evaluateTargets (S-106)");
}

/** Deterministic markdown: same records (any order) -> identical string. Every number is derived from `records`. */
export function renderReport(_records: readonly RunRecord[]): string {
  throw new Error("not implemented: renderReport (S-106)");
}
