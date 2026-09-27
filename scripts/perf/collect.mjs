#!/usr/bin/env node
// Reads vitest's stdout from stdin and writes any PERFRECORD lines to
// perf/results/<id>.json (plans/perf-divergence D-111 fallback — commands.writeFile
// is unavailable in this environment, see perf/harness/run.perf.ts's header).
// scripts/perf/run-matrix.mjs does this inline for driven runs; this script
// is for a standalone/manual `vitest run --project perf` invocation:
//
//   npx vitest run --project perf --reporter=verbose | node scripts/perf/collect.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const RESULTS_DIR = join(process.cwd(), "perf", "results");

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let count = 0;
rl.on("line", (line) => {
  process.stdout.write(line + "\n");
  if (!line.startsWith("PERFRECORD ")) return;
  const record = JSON.parse(line.slice("PERFRECORD ".length));
  mkdirSync(RESULTS_DIR, { recursive: true });
  const path = join(RESULTS_DIR, `${record.id}.json`);
  writeFileSync(path, JSON.stringify(record, null, 2) + "\n");
  console.error(`[collect] wrote ${path}`);
  count++;
});
rl.on("close", () => {
  if (count === 0) console.error("[collect] no PERFRECORD lines found on stdin");
});
