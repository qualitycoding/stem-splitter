import { describe, expect, it } from "vitest";
import {
  evaluateTargets,
  MIN_RUNS_PER_VERDICT,
  renderReport,
  TARGET_THRESHOLDS_MS,
  validateRunRecord,
  type ConfigId,
  type RunRecord,
} from "../../src/perf/report";
import type { ModelPhase } from "../../src/perf/timeline";

/**
 * FROZEN. Enforces PD-SC-2 (T-027..T-030 are measured or explicitly "unmeasured", never inferred), PD-SC-1, decisions D-102/D-103,
 * Rule 9 (every reported number is generated from committed records). Thresholds are copied from plan/PLAN.md T-027..T-030
 * and asserted literally so a change to report.ts cannot silently move a target. Boundary semantics: T-027 is "<= 16 min",
 * T-028/T-029/T-030 and T-027-M1 are strict "<".
 */
const SHA = "a".repeat(64);
const FOUR_MIN_CHUNKS = 42;
const fill = (n: number, ms: number) => Array.from({ length: n }, () => ms);
const phase = (chunkMs: number[], sessionCreateMs: number | null = 28_000, downloadMs: number | null = null): ModelPhase => ({
  downloadMs,
  sessionCreateMs,
  chunkMs,
});

function record(over: Partial<RunRecord> & { config?: ConfigId } = {}): RunRecord {
  const config = over.config ?? "wasm-mt";
  const webgpu = config.startsWith("webgpu");
  const hq = config === "webgpu-hq";
  const base: RunRecord = {
    schema: 1,
    id: "run-1",
    config,
    input: { name: "synthetic-240s.wav", sha256: SHA, durationSeconds: 240, chunkCount: FOUR_MIN_CHUNKS },
    throttleMbps: null,
    cacheCold: false,
    executionProvider: webgpu ? "webgpu" : "wasm",
    threadCount: config === "wasm-1t" ? 1 : webgpu ? 1 : 3,
    models: hq ? [0, 1, 2, 3].map(() => phase(fill(FOUR_MIN_CHUNKS, 1_300), 40_000)) : [phase(fill(FOUR_MIN_CHUNKS, 20_000))],
    provenance: {
      gitCommit: "b9173b7d80c0323b28bf69cfe09e8b6eb478bef9",
      lockfileSha256: SHA,
      ortVersion: "1.30.0",
      browser: "Chrome 154.0.8037.57",
      os: "Windows 10.0.19045",
      cpuModel: "Intel(R) Core(TM) i5-6200U CPU @ 2.30GHz",
      logicalCores: 4,
      acPower: true,
      startedAtUtc: "2026-09-27T09:00:00.000Z",
    },
  };
  return { ...base, ...over };
}
const runs = (n: number, over: Partial<RunRecord> & { config?: ConfigId } = {}) =>
  Array.from({ length: n }, (_, i) => record({ ...over, id: `${over.config ?? "wasm-mt"}-${i}` }));
const sumChunks = (chunkMs: number[]) => chunkMs.reduce((a, b) => a + b, 0);
const verdict = (records: RunRecord[], id: string) => evaluateTargets(records).find((v) => v.id === id)!;

describe("frozen thresholds (T-107)", () => {
  it("match plan/PLAN.md T-027..T-030", () => {
    expect(TARGET_THRESHOLDS_MS).toEqual({
      "T-027": 16 * 60_000,
      "T-027-M1": 6 * 60_000,
      "T-028-separation": 90_000,
      "T-028-session": 60_000,
      "T-029": 45_000,
      "T-030": 8 * 60_000,
    });
    expect(MIN_RUNS_PER_VERDICT).toBe(3);
  });
});

describe("validateRunRecord (T-108)", () => {
  it("accepts a well-formed record", () => {
    expect(validateRunRecord(record())).toEqual([]);
    expect(validateRunRecord(record({ config: "webgpu-standard" }))).toEqual([]);
    expect(validateRunRecord(record({ config: "webgpu-hq" }))).toEqual([]);
    expect(validateRunRecord(record({ config: "wasm-1t" }))).toEqual([]);
  });
  it("never throws on garbage; reports a problem", () => {
    for (const bad of [null, undefined, 3, "x", [], {}]) {
      expect(validateRunRecord(bad).length).toBeGreaterThan(0);
    }
  });
  it("requires provenance fields (Rule 9: reproducible record)", () => {
    const r = record();
    const problems = validateRunRecord({ ...r, provenance: { ...r.provenance, gitCommit: "" } });
    expect(problems.some((p) => p.includes("provenance.gitCommit"))).toBe(true);
    const problems2 = validateRunRecord({ ...r, provenance: { ...r.provenance, lockfileSha256: "xyz" } });
    expect(problems2.some((p) => p.includes("provenance.lockfileSha256"))).toBe(true);
  });
  it("rejects wrong schema version", () => {
    expect(validateRunRecord({ ...record(), schema: 2 }).some((p) => p.includes("schema"))).toBe(true);
  });
  it("catches a silent single-thread fallback recorded as wasm-mt", () => {
    expect(validateRunRecord(record({ threadCount: 1 })).some((p) => p.includes("threadCount"))).toBe(true);
  });
  it("catches a silent WASM fallback recorded as webgpu", () => {
    const r = record({ config: "webgpu-standard", executionProvider: "wasm" });
    expect(validateRunRecord(r).some((p) => p.includes("executionProvider"))).toBe(true);
  });
  it("catches wasm-1t with more than one thread", () => {
    expect(validateRunRecord(record({ config: "wasm-1t", threadCount: 3 })).some((p) => p.includes("threadCount"))).toBe(true);
  });
  it("chunkCount must equal chunkCountForDuration(durationSeconds) and the measured chunk list", () => {
    const wrongCount = record({ input: { name: "x", sha256: SHA, durationSeconds: 240, chunkCount: 41 } });
    expect(validateRunRecord(wrongCount).some((p) => p.includes("chunkCount"))).toBe(true);
    const shortList = record({ models: [phase(fill(41, 20_000))] });
    expect(validateRunRecord(shortList).some((p) => p.includes("chunkMs"))).toBe(true);
  });
  it("high quality needs exactly four model phases; standard exactly one", () => {
    expect(validateRunRecord(record({ config: "webgpu-hq", models: [phase(fill(42, 1_300))] })).some((p) => p.includes("models"))).toBe(true);
    expect(validateRunRecord(record({ models: [phase(fill(42, 1)), phase(fill(42, 1))] })).some((p) => p.includes("models"))).toBe(true);
  });
  it("rejects negative, NaN and Infinity times", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const chunks = fill(42, 20_000);
      chunks[5] = bad;
      expect(validateRunRecord(record({ models: [phase(chunks)] })).some((p) => p.includes("chunkMs"))).toBe(true);
    }
    expect(validateRunRecord(record({ models: [phase(fill(42, 20_000), -5)] })).some((p) => p.includes("sessionCreateMs"))).toBe(true);
  });
  it("throttleMbps must be positive when set", () => {
    expect(validateRunRecord(record({ throttleMbps: 0 })).some((p) => p.includes("throttleMbps"))).toBe(true);
  });
});

describe("evaluateTargets: T-027 (T-109)", () => {
  it("passes when the median 4-min separation is within 16 min (>= 3 runs)", () => {
    const v = verdict(runs(3), "T-027"); // 42 x 20 s = 14.0 min
    expect(v.verdict).toBe("pass");
    expect(v.runsUsed).toBe(3);
    expect(v.checks[0].measuredMs).toBe(840_000);
    expect(v.checks[0].thresholdMs).toBe(960_000);
  });
  it("boundary: exactly 16.0 min passes (<=), one ms more fails", () => {
    const exact = runs(3).map((r) => ({ ...r, models: [phase([...fill(41, 20_000), 960_000 - 41 * 20_000])] }));
    expect(sumChunks(exact[0].models[0].chunkMs)).toBe(960_000);
    expect(verdict(exact, "T-027").verdict).toBe("pass");
    const over = runs(3).map((r) => ({ ...r, models: [phase([...fill(41, 20_000), 960_001 - 41 * 20_000])] }));
    expect(verdict(over, "T-027").verdict).toBe("fail");
  });
  it("uses the median across runs, not the best run", () => {
    const rs = [800_000, 990_000, 1_000_000].map((total, i) => record({ id: `r${i}`, models: [phase([...fill(41, 1_000), total - 41_000])] }));
    expect(verdict(rs, "T-027").verdict).toBe("fail");
  });
  it("fewer than 3 valid runs -> unmeasured, with the count in the basis", () => {
    const v = verdict(runs(2), "T-027");
    expect(v.verdict).toBe("unmeasured");
    expect(v.basis).toContain("2 < 3");
  });
  it("invalid records are excluded and named as such", () => {
    const rs = [...runs(2), record({ id: "bad", threadCount: 1 })];
    const v = verdict(rs, "T-027");
    expect(v.verdict).toBe("unmeasured");
    expect(v.runsUsed).toBe(2);
    expect(v.basis).toContain("invalid");
  });
  it("REGRESSION PD-defect: 20 s clips never produce a T-027 verdict, however many runs", () => {
    const short = runs(5).map((r) => ({
      ...r,
      input: { ...r.input, durationSeconds: 20, chunkCount: 4 },
      models: [phase(fill(4, 20_000))],
    }));
    expect(verdict(short, "T-027").verdict).toBe("unmeasured");
  });
  it("Apple M1 records count toward T-027-M1 only, and non-Apple records never do", () => {
    const m1 = runs(3).map((r) => ({
      ...r,
      provenance: { ...r.provenance, cpuModel: "Apple M1" },
      models: [phase(fill(42, 7_000))], // 294 s
    }));
    expect(verdict(m1, "T-027-M1").verdict).toBe("pass");
    expect(verdict(m1, "T-027").verdict).toBe("unmeasured");
    const i5 = verdict(runs(3), "T-027-M1");
    expect(i5.verdict).toBe("unmeasured");
    expect(i5.basis).toContain("Apple M1");
  });
  it("T-027-M1 boundary is strict: exactly 6.0 min fails", () => {
    const m1 = runs(3).map((r) => ({
      ...r,
      provenance: { ...r.provenance, cpuModel: "Apple M1" },
      models: [phase([...fill(41, 8_000), 360_000 - 41 * 8_000])],
    }));
    expect(sumChunks(m1[0].models[0].chunkMs)).toBe(360_000);
    expect(verdict(m1, "T-027-M1").verdict).toBe("fail");
  });
});

describe("evaluateTargets: T-028 / T-029 / T-030 (T-110)", () => {
  it("T-028 passes when separation < 90 s and session creation < 60 s", () => {
    const v = verdict(runs(3, { config: "webgpu-standard", models: [phase(fill(42, 1_300), 48_000)] }), "T-028");
    expect(v.verdict).toBe("pass");
    expect(v.checks.map((c) => c.name).sort()).toEqual(["separation", "sessionCreate"]);
  });
  it("T-028 fails if EITHER check fails; separation boundary is strict", () => {
    expect(verdict(runs(3, { config: "webgpu-standard", models: [phase(fill(42, 1_300), 61_000)] }), "T-028").verdict).toBe("fail");
    const at90 = phase([...fill(41, 1_000), 90_000 - 41_000], 40_000);
    expect(verdict(runs(3, { config: "webgpu-standard", models: [at90] }), "T-028").verdict).toBe("fail");
  });
  it("T-029 needs cold cache AND a 50 Mbit/s throttle; download < 45 s", () => {
    const cold = (downloadMs: number, over: Partial<RunRecord> = {}) =>
      runs(3, { cacheCold: true, throttleMbps: 50, models: [phase(fill(42, 20_000), 28_000, downloadMs)], ...over });
    expect(verdict(cold(30_000), "T-029").verdict).toBe("pass");
    expect(verdict(cold(45_000), "T-029").verdict).toBe("fail");
    expect(verdict(cold(30_000, { throttleMbps: null }), "T-029").verdict).toBe("unmeasured");
    expect(verdict(cold(30_000, { throttleMbps: 100 }), "T-029").verdict).toBe("unmeasured");
    expect(verdict(cold(30_000, { cacheCold: false }), "T-029").verdict).toBe("unmeasured");
  });
  it("T-030: four session creations + all chunks < 8 min, download excluded", () => {
    const pass = runs(3, { config: "webgpu-hq" }); // 4 x (40 s + 54.6 s) = 378.4 s
    expect(verdict(pass, "T-030").verdict).toBe("pass");
    expect(verdict(pass, "T-030").checks[0].measuredMs).toBeCloseTo(4 * (40_000 + 42 * 1_300), 6);
    const fail = runs(3, { config: "webgpu-hq", models: [0, 1, 2, 3].map(() => phase(fill(42, 1_300), 80_000)) });
    expect(verdict(fail, "T-030").verdict).toBe("fail");
    const withDownload = runs(3, { config: "webgpu-hq", models: [0, 1, 2, 3].map(() => phase(fill(42, 1_300), 40_000, 500_000)) });
    expect(verdict(withDownload, "T-030").verdict).toBe("pass");
  });
  it("wasm-1t records never produce a target verdict (informational only)", () => {
    const only1t = runs(5, { config: "wasm-1t" });
    for (const id of ["T-027", "T-028", "T-030"]) expect(verdict(only1t, id).verdict).toBe("unmeasured");
  });
  it("with no records every target is unmeasured and evaluateTargets lists all five ids", () => {
    const vs = evaluateTargets([]);
    expect(vs.map((v) => v.id).sort()).toEqual(["T-027", "T-027-M1", "T-028", "T-029", "T-030"]);
    expect(vs.every((v) => v.verdict === "unmeasured" && v.basis.length > 0)).toBe(true);
  });
});

describe("renderReport (T-111)", () => {
  const all = [...runs(3), ...runs(3, { config: "webgpu-standard", models: [phase(fill(42, 1_300), 48_000)] })];
  it("is deterministic and independent of record order", () => {
    const a = renderReport(all);
    expect(renderReport(all)).toBe(a);
    expect(renderReport([...all].reverse())).toBe(a);
  });
  it("prints every verdict id with its status, and the derived median as minutes", () => {
    const text = renderReport(all);
    for (const id of ["T-027", "T-027-M1", "T-028", "T-029", "T-030"]) expect(text).toContain(id);
    expect(text).toContain("unmeasured");
    expect(text).toContain("14.0 min");
  });
  it("labels extrapolations as indicative and not a verdict", () => {
    const short = runs(3).map((r) => ({ ...r, input: { ...r.input, durationSeconds: 20, chunkCount: 4 }, models: [phase(fill(4, 20_000))] }));
    const text = renderReport(short);
    expect(text).toContain("not a verdict");
    expect(text).toContain("14.0 min"); // 20 s + 41 x 20 s = 840 s, from extrapolateSeparationMs
  });
  it("carries provenance and flags an unrecorded power state", () => {
    const text = renderReport([record({ provenance: { ...record().provenance, acPower: null } })]);
    expect(text).toContain("b9173b7");
    expect(text).toContain("AC power not recorded");
  });
  it("throws (does not render) on an invalid record", () => {
    expect(() => renderReport([record({ threadCount: 1 })])).toThrow(/invalid/i);
  });
});
