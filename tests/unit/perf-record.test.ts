import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderReport, validateRunRecord, type RunRecord } from "../../src/perf/report";

/**
 * FROZEN. Enforces PD-SC-1/PD-SC-2 and Rule 9 (numbers in the perf record are generated from committed run records, not transcribed):
 *  - tests/PERF.md (2026-09-25) is kept but marked SUPERSEDED (assumption A-105), not silently edited;
 *  - every perf/results/*.json is a valid RunRecord;
 *  - perf/REPORT.md is byte-identical to renderReport(all records).
 * These are RED until step S-106 (measurements committed and report generated) - by design.
 */
const ROOT = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, ROOT), "utf8").replace(/\r\n/g, "\n");

describe("tests/PERF.md is superseded, not rewritten (T-112)", () => {
  const text = read("tests/PERF.md");
  const head = text.split("\n").slice(0, 12).join("\n");
  it("carries a SUPERSEDED banner in its first 12 lines that names the defect and the replacement", () => {
    expect(head).toMatch(/SUPERSEDED/);
    expect(head).toMatch(/perf\/REPORT\.md/);
    expect(head).toMatch(/after (the )?(first chunk|chunk 1)/i);
    // ...and the original 2026-09-25 numbers stay as a historical record (not silently edited):
    for (const kept of ["61.7 s", "105.0 s", "15.4 s", "26.3 s", "10.8 min", "18.4 min", "i5-6200U"]) expect(text).toContain(kept);
  });
});

describe("committed perf results (T-113)", () => {
  const dir = new URL("perf/results/", ROOT);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];

  it("perf/results/ exists and holds at least one run record", () => {
    expect(existsSync(dir)).toBe(true);
    expect(files.length).toBeGreaterThan(0);
  });
  it("every record is valid", () => {
    expect(files.length).toBeGreaterThan(0); // never vacuous
    for (const f of files) {
      const parsed: unknown = JSON.parse(read(`perf/results/${f}`));
      expect({ file: f, problems: validateRunRecord(parsed) }).toEqual({ file: f, problems: [] });
    }
  });
  it("perf/REPORT.md is exactly renderReport(all records) - no hand-typed numbers", () => {
    const records = files.map((f) => JSON.parse(read(`perf/results/${f}`)) as RunRecord);
    expect(read("perf/REPORT.md")).toBe(renderReport(records));
  });
});
