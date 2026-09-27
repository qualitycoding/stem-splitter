// Run-record validation, target verdicts and report rendering (plans/perf-divergence D-102, D-103).
// Imports carry ".ts" extensions (see stats.ts).
import { chunkCountForDuration, extrapolateSeparationMs, quantile } from "./stats.ts";
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

function isValidRecord(record: RunRecord): boolean {
  return validateRunRecord(record).length === 0;
}

interface Measure {
  name: string;
  thresholdMs: number;
  /** T-027 is "<=" (inclusive); T-027-M1/T-028/T-029/T-030 are strict "<" (D-103). */
  strict: boolean;
  value: (r: RunRecord) => number | null;
}

function buildVerdict(
  id: VerdictId,
  criteria: string,
  records: readonly RunRecord[],
  eligible: (r: RunRecord) => boolean,
  measures: readonly Measure[],
): TargetVerdict {
  const candidates = records.filter(eligible);
  const invalidCount = candidates.filter((r) => !isValidRecord(r)).length;
  const valid = candidates.filter((r) => isValidRecord(r) && measures.every((m) => m.value(r) !== null));
  const runsUsed = valid.length;

  if (runsUsed < MIN_RUNS_PER_VERDICT) {
    const invalidNote = invalidCount > 0 ? `; ${invalidCount} invalid record(s) excluded` : "";
    return {
      id,
      verdict: "unmeasured",
      runsUsed,
      checks: measures.map((m) => ({ name: m.name, measuredMs: null, thresholdMs: m.thresholdMs, ok: null })),
      basis: `${runsUsed} < ${MIN_RUNS_PER_VERDICT} required runs (criteria: ${criteria})${invalidNote}`,
    };
  }

  const checks: TargetCheck[] = measures.map((m) => {
    const measuredMs = quantile(valid.map((r) => m.value(r) as number), 0.5);
    const ok = m.strict ? measuredMs < m.thresholdMs : measuredMs <= m.thresholdMs;
    return { name: m.name, measuredMs, thresholdMs: m.thresholdMs, ok };
  });
  return {
    id,
    verdict: checks.every((c) => c.ok) ? "pass" : "fail",
    runsUsed,
    checks,
    basis: `median over ${runsUsed} valid run(s) (criteria: ${criteria})`,
  };
}

function separationMs(r: RunRecord): number | null {
  return r.models[0] ? r.models[0].chunkMs.reduce((a, b) => a + b, 0) : null;
}
function sessionCreateMs(r: RunRecord): number | null {
  return r.models[0]?.sessionCreateMs ?? null;
}
function downloadMs(r: RunRecord): number | null {
  return r.models[0]?.downloadMs ?? null;
}
function hqSessionCreateAndChunksMs(r: RunRecord): number | null {
  if (r.models.length !== 4) return null;
  return r.models.reduce((sum, m) => sum + (m.sessionCreateMs ?? 0) + m.chunkMs.reduce((a, b) => a + b, 0), 0);
}
function isAppleM1(r: RunRecord): boolean {
  return /Apple M1/.test(r.provenance.cpuModel);
}
function isFourMinutePlus(r: RunRecord): boolean {
  return r.input.durationSeconds >= 240;
}

/** Only VALID records with durationSeconds >= 240 count toward T-027/T-028/T-030. Extrapolations never yield pass/fail. */
export function evaluateTargets(records: readonly RunRecord[]): TargetVerdict[] {
  return [
    buildVerdict(
      "T-027",
      'config="wasm-mt", non-Apple CPU, durationSeconds >= 240',
      records,
      (r) => r.config === "wasm-mt" && isFourMinutePlus(r) && !isAppleM1(r),
      [{ name: "separation", thresholdMs: TARGET_THRESHOLDS_MS["T-027"], strict: false, value: separationMs }],
    ),
    buildVerdict(
      "T-027-M1",
      'config="wasm-mt", cpuModel matching /Apple M1/, durationSeconds >= 240',
      records,
      (r) => r.config === "wasm-mt" && isFourMinutePlus(r) && isAppleM1(r),
      [{ name: "separation", thresholdMs: TARGET_THRESHOLDS_MS["T-027-M1"], strict: true, value: separationMs }],
    ),
    buildVerdict(
      "T-028",
      'config="webgpu-standard", durationSeconds >= 240',
      records,
      (r) => r.config === "webgpu-standard" && isFourMinutePlus(r),
      [
        { name: "separation", thresholdMs: TARGET_THRESHOLDS_MS["T-028-separation"], strict: true, value: separationMs },
        { name: "sessionCreate", thresholdMs: TARGET_THRESHOLDS_MS["T-028-session"], strict: true, value: sessionCreateMs },
      ],
    ),
    buildVerdict(
      "T-029",
      "cacheCold=true, throttleMbps=50 (any duration)",
      records,
      (r) => r.cacheCold === true && r.throttleMbps === 50,
      [{ name: "download", thresholdMs: TARGET_THRESHOLDS_MS["T-029"], strict: true, value: downloadMs }],
    ),
    buildVerdict(
      "T-030",
      'config="webgpu-hq", durationSeconds >= 240',
      records,
      (r) => r.config === "webgpu-hq" && isFourMinutePlus(r),
      [{ name: "sessionCreateAndChunks", thresholdMs: TARGET_THRESHOLDS_MS["T-030"], strict: true, value: hqSessionCreateAndChunksMs }],
    ),
  ];
}

function fmtMinSec(ms: number): string {
  return `${(ms / 60_000).toFixed(1)} min (${(ms / 1000).toFixed(1)} s)`;
}

/** Deterministic markdown: same records (any order) -> identical string. Every number is derived from `records`. */
export function renderReport(records: readonly RunRecord[]): string {
  for (const r of records) {
    const problems = validateRunRecord(r);
    if (problems.length > 0) {
      throw new Error(`renderReport: invalid record ${isPlainObject(r) ? JSON.stringify(r.id) : "?"}:\n${problems.join("\n")}`);
    }
  }
  const sorted = [...records].sort((a, b) => a.id.localeCompare(b.id));
  const verdicts = [...evaluateTargets(sorted)].sort((a, b) => a.id.localeCompare(b.id));

  const lines: string[] = [];
  lines.push("# Performance report");
  lines.push("");
  lines.push(`Generated by \`node scripts/perf/report.ts\` from ${sorted.length} record(s) in \`perf/results/\`. Never hand-edit; re-run the script.`);
  lines.push("");

  lines.push("## Provenance");
  lines.push("");
  lines.push("| Commit | CPU | OS | Browser | ORT | AC power |");
  lines.push("|---|---|---|---|---|---|");
  const seenProvenance = new Set<string>();
  for (const r of sorted) {
    const p = r.provenance;
    const key = `${p.gitCommit}|${p.cpuModel}|${p.os}|${p.browser}|${p.ortVersion}|${p.acPower}`;
    if (seenProvenance.has(key)) continue;
    seenProvenance.add(key);
    const ac = p.acPower === null ? "AC power not recorded" : p.acPower ? "yes" : "no";
    lines.push(`| ${p.gitCommit.slice(0, 7)} | ${p.cpuModel} | ${p.os} | ${p.browser} | ${p.ortVersion} | ${ac} |`);
  }
  lines.push("");

  lines.push("## Per-config summary");
  lines.push("");
  lines.push("| Config | n | first chunk (median) | steady chunk (median, IQR) | total (median) |");
  lines.push("|---|---|---|---|---|");
  for (const config of CONFIG_IDS) {
    const configRecords = sorted.filter((r) => r.config === config);
    if (configRecords.length === 0) continue;
    const firstChunks = configRecords.flatMap((r) => (r.models[0]?.chunkMs.length ? [r.models[0].chunkMs[0]] : []));
    const steadyChunks = configRecords.flatMap((r) => r.models.flatMap((m) => m.chunkMs.slice(1)));
    const totals = configRecords.map(
      (r) => r.models.reduce((sum, m) => sum + (m.downloadMs ?? 0) + (m.sessionCreateMs ?? 0) + m.chunkMs.reduce((a, b) => a + b, 0), 0),
    );
    const first = firstChunks.length ? fmtMinSec(quantile(firstChunks, 0.5)) : "—";
    const steady = steadyChunks.length
      ? `${fmtMinSec(quantile(steadyChunks, 0.5))}, IQR ${(quantile(steadyChunks, 0.75) - quantile(steadyChunks, 0.25)).toFixed(0)} ms`
      : "—";
    const total = fmtMinSec(quantile(totals, 0.5));
    lines.push(`| ${config} | ${configRecords.length} | ${first} | ${steady} | ${total} |`);
  }
  lines.push("");

  lines.push("## Verdicts");
  lines.push("");
  lines.push("| Test | Verdict | Check | Measured | Threshold | Basis |");
  lines.push("|---|---|---|---|---|---|");
  for (const v of verdicts) {
    for (const [i, c] of v.checks.entries()) {
      const measured = c.measuredMs === null ? "—" : fmtMinSec(c.measuredMs);
      const threshold = fmtMinSec(c.thresholdMs);
      const verdictCell = i === 0 ? v.verdict : "";
      const basisCell = i === 0 ? v.basis : "";
      lines.push(`| ${i === 0 ? v.id : ""} | ${verdictCell} | ${c.name} | ${measured} | ${threshold} | ${basisCell} |`);
    }
  }
  lines.push("");

  lines.push("## Indicative extrapolations — not a verdict");
  lines.push("");
  const extrapolated = sorted.filter((r) => !isFourMinutePlus(r) && (r.models[0]?.chunkMs.length ?? 0) >= 2);
  if (extrapolated.length === 0) {
    lines.push("_(no record with < 240 s of input and >= 2 measured chunks to extrapolate from)_");
  } else {
    lines.push("| Record | Config | Extrapolated 42-chunk separation |");
    lines.push("|---|---|---|");
    for (const r of extrapolated) {
      const extraMs = extrapolateSeparationMs(r.models[0].chunkMs, 42);
      lines.push(`| ${r.id} | ${r.config} | ${fmtMinSec(extraMs)} |`);
    }
  }
  lines.push("");

  lines.push("## Known limitations");
  lines.push("");
  const m1Verdict = verdicts.find((v) => v.id === "T-027-M1");
  if (m1Verdict?.verdict === "unmeasured" && m1Verdict.runsUsed === 0) {
    lines.push("- T-027-M1 unmeasured — no Apple M1 record present.");
  }
  lines.push('- WebGPU "return visit" (persistent browser profile / warm shader cache) performance is not measured here (D-110 rule 8).');
  const t029 = verdicts.find((v) => v.id === "T-029");
  lines.push(
    t029 && t029.verdict !== "unmeasured"
      ? "- T-029 was measured on the main-thread download path; the Worker-fetch path's throttle coverage is not separately verified here (D-111)."
      : "- T-029 unmeasured — no valid cold-cache, 50 Mbit/s-throttled record present.",
  );
  lines.push("");

  lines.push("## Human decisions");
  lines.push("");
  lines.push("_(left blank — filled in at gate G-101)_");
  lines.push("");

  return lines.join("\n");
}
