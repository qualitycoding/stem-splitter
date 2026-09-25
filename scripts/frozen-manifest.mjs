// Freezes the test suite (plan/PLAN.md "Tests (frozen list)"): records a
// SHA-256 for every file under tests/ so a test or fixture can't be weakened
// or swapped without the change showing up as a manifest diff.
//
//   node scripts/frozen-manifest.mjs           verify (exit 1 on any mismatch)
//   node scripts/frozen-manifest.mjs --write   regenerate tests/FROZEN_MANIFEST.sha256
//
// Text files are hashed with CRLF normalised to LF so a Windows checkout
// (core.autocrlf) verifies identically to CI. PERF.md is a results record,
// not part of the frozen suite.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TESTS = join(ROOT, "tests");
const MANIFEST = join(TESTS, "FROZEN_MANIFEST.sha256");
const EXCLUDE = new Set(["FROZEN_MANIFEST.sha256", "PERF.md"]);
const TEXT = /\.(ts|md|py|json|txt|mjs|yml)$/;

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (!EXCLUDE.has(name)) yield path;
  }
}

function hash(path) {
  let bytes = readFileSync(path);
  if (TEXT.test(path)) bytes = Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"));
  return createHash("sha256").update(bytes).digest("hex");
}

const current = new Map();
for (const path of walk(TESTS)) current.set(relative(ROOT, path).split(sep).join("/"), hash(path));

if (process.argv.includes("--write")) {
  const lines = [...current].map(([file, sum]) => `${sum}  ${file}`);
  writeFileSync(MANIFEST, lines.join("\n") + "\n");
  console.log(`Wrote ${lines.length} entries to tests/FROZEN_MANIFEST.sha256`);
} else {
  const recorded = new Map(
    readFileSync(MANIFEST, "utf8").split("\n").filter(Boolean).map((l) => {
      const [sum, file] = l.split(/  (.+)/);
      return [file, sum];
    }),
  );
  const problems = [];
  for (const [file, sum] of current) {
    if (!recorded.has(file)) problems.push(`added:    ${file}`);
    else if (recorded.get(file) !== sum) problems.push(`modified: ${file}`);
  }
  for (const file of recorded.keys()) if (!current.has(file)) problems.push(`removed:  ${file}`);
  if (problems.length) {
    console.error("tests/ differs from tests/FROZEN_MANIFEST.sha256:\n" + problems.join("\n"));
    console.error("If the change is intended, run: node scripts/frozen-manifest.mjs --write");
    process.exit(1);
  }
  console.log(`tests/ matches the frozen manifest (${current.size} files).`);
}
