// Generates perf/REPORT.md from every perf/results/*.json (plans/perf-divergence D-102/D-103, S-106).
// Thin CLI over renderReport() -- never hand-edit the output; re-run this script.
//
//   node scripts/perf/report.ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderReport, type RunRecord } from "../../src/perf/report.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const RESULTS_DIR = join(ROOT, "perf", "results");
const OUT = join(ROOT, "perf", "REPORT.md");

const files = existsSync(RESULTS_DIR) ? readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json")).sort() : [];
const records = files.map((f) => JSON.parse(readFileSync(join(RESULTS_DIR, f), "utf8")) as RunRecord);

const report = renderReport(records);
writeFileSync(OUT, report);
console.log(`Wrote ${OUT} from ${records.length} record(s).`);
