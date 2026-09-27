// Validates one or more perf/results/*.json files against validateRunRecord
// (plans/perf-divergence D-102/D-103, S-103 step 6).
//
//   node scripts/perf/validate.ts perf/results/*.json
//
// Prints "OK <file>" per valid file, else the problems; exits 1 on any problem.
import { readFileSync } from "node:fs";
import { validateRunRecord } from "../../src/perf/report.ts";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node scripts/perf/validate.ts <file...>");
  process.exit(1);
}

let ok = true;
for (const file of files) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    ok = false;
    console.error(`${file}: could not read/parse: ${(err as Error).message}`);
    continue;
  }
  const problems = validateRunRecord(parsed);
  if (problems.length === 0) {
    console.log(`OK ${file}`);
  } else {
    ok = false;
    console.error(`${file}:`);
    for (const p of problems) console.error(`  ${p}`);
  }
}

if (!ok) process.exit(1);
