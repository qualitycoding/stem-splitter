#!/usr/bin/env node
// Driver for a perf measurement matrix (plans/perf-divergence D-110/D-111,
// S-103 step 5). Executes a plan file's runs sequentially, each in a fresh
// `vitest run --project perf` process, with cool-downs between runs and
// provenance env vars the harness (perf/harness/run.perf.ts) can't derive
// itself (git sha, lockfile hash, CPU model, AC power, OS). Never runs two
// runs concurrently (D-110 rule 1).
//
//   node scripts/perf/run-matrix.mjs plans/perf-divergence/plan/matrix-20s.json
//
// Plan file format: {"cooldownS":60,"longCooldownS":180,"runs":[
//   {"config":"wasm-mt","input":"tests/fixtures/golden-20s.wav","cold":false,"throttleMbps":null,"repeat":1},
//   ...
// ]}
// Each entry is one run, in the listed order. Run id:
// `<config>-<basename(input)>-<cold|warm>-r<repeat>-<UTC yyyymmddThhmmssZ>`.
// Resume: a run is skipped if perf/results/ already has a file whose name
// starts with that id's prefix (everything before the timestamp).
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, extname, join } from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const ROOT = process.cwd();
const RESULTS_DIR = join(ROOT, "perf", "results");
const LONG_RUN_THRESHOLD_S = 600; // D-110 rule 3

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryRun(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function gitSha() {
  return tryRun(() => execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), null);
}

function lockfileSha256() {
  return tryRun(() => createHash("sha256").update(readFileSync(join(ROOT, "package-lock.json"))).digest("hex"), null);
}

function cpuModel() {
  return tryRun(() => {
    const out = execFileSync("wmic", ["cpu", "get", "Name", "/value"], { encoding: "utf8" });
    const m = out.match(/Name=(.+)/);
    return m ? m[1].trim() : null;
  }, null);
}

/** null = could not determine (harness records acPower: null); true/false = on AC / on battery. */
function acPower() {
  return tryRun(() => {
    const out = execFileSync("wmic", ["path", "Win32_Battery", "get", "BatteryStatus", "/value"], { encoding: "utf8" });
    const m = out.match(/BatteryStatus=(\d+)/);
    if (!m) return true; // no battery reported -> desktop/always-AC
    return Number(m[1]) === 2;
  }, null);
}

function osString() {
  return tryRun(() => {
    const out = execFileSync("wmic", ["os", "get", "Caption,Version", "/value"], { encoding: "utf8" });
    const cleaned = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ");
    return cleaned || null;
  }, null);
}

function utcStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function inputBase(inputPath) {
  return basename(inputPath, extname(inputPath));
}

function runPrefix(run) {
  return `${run.config}-${inputBase(run.input)}-${run.cold ? "cold" : "warm"}-r${run.repeat}-`;
}

function existingResultFiles() {
  if (!existsSync(RESULTS_DIR)) return [];
  return readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json"));
}

/** Parses typeperf's CSV output for one counter into a list of numeric samples. */
function parseTypeperfCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const samples = [];
  for (const line of lines.slice(1)) {
    // typeperf CSV rows: "MM/DD/YYYY HH:MM:SS.mmm","<value>"
    const cells = line.split(",").map((c) => c.replace(/^"|"$/g, ""));
    const value = Number(cells[1]);
    if (Number.isFinite(value)) samples.push(value);
  }
  return samples;
}

function startCpuFrequencySampler(csvPath) {
  const child = spawn(
    "typeperf",
    ["\\Processor Information(_Total)\\Processor Frequency", "-si", "1", "-o", csvPath],
    { stdio: "ignore" },
  );
  child.on("error", () => {}); // best-effort; missing typeperf must not abort the run
  return child;
}

function stopCpuFrequencySampler(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.killed) return resolve();
    child.once("exit", () => resolve());
    child.kill();
    setTimeout(resolve, 3000); // don't hang the matrix if the process ignores the signal
  });
}

async function runOne(run, env) {
  const prefix = runPrefix(run);
  if (existingResultFiles().some((f) => f.startsWith(prefix))) {
    console.log(`[run-matrix] skip (already have a record): ${prefix}*`);
    return { skipped: true };
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const runId = `${prefix}${utcStamp(new Date())}`;
  console.log(`[run-matrix] running ${runId} ...`);

  const csvPath = join(RESULTS_DIR, `${runId}.cpufreq.csv`);
  const sampler = startCpuFrequencySampler(csvPath);

  const childEnv = {
    ...process.env,
    VITE_PERF_CONFIG: run.config,
    VITE_PERF_INPUT: run.input,
    VITE_PERF_RUN_ID: runId,
    ...(run.config !== "wasm-1t" ? { VITE_TEST_ISOLATE: "1" } : {}),
    ...(run.cold ? { VITE_PERF_COLD: "1" } : {}),
    ...(run.throttleMbps != null ? { VITE_PERF_THROTTLE_MBPS: String(run.throttleMbps) } : {}),
    ...(env.gitSha ? { VITE_PERF_GIT: env.gitSha } : {}),
    ...(env.lockfileSha256 ? { VITE_PERF_LOCK: env.lockfileSha256 } : {}),
    ...(env.cpuModel ? { VITE_PERF_CPU: env.cpuModel } : {}),
    ...(env.acPower !== null ? { VITE_PERF_AC: env.acPower ? "1" : "0" } : {}),
    ...(env.os ? { VITE_PERF_OS: env.os } : {}),
  };

  const perfLines = [];
  const start = Date.now();
  const exitCode = await new Promise((resolve) => {
    const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", "--project", "perf", "--reporter=verbose"], {
      cwd: ROOT,
      env: childEnv,
      stdio: ["ignore", "pipe", "inherit"],
    });
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      process.stdout.write(text);
      for (const line of text.split(/\r?\n/)) if (line.startsWith("PERFRECORD ")) perfLines.push(line.slice("PERFRECORD ".length));
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
  const wallS = (Date.now() - start) / 1000;

  await stopCpuFrequencySampler(sampler);
  let cpuMHz = [];
  if (existsSync(csvPath)) {
    cpuMHz = tryRun(() => parseTypeperfCsv(readFileSync(csvPath, "utf8")), []);
  }

  // commands.writeFile is unavailable in this environment (perf/harness/run.perf.ts header) —
  // the harness always prints one compact-JSON PERFRECORD line instead; write it out here.
  const resultPath = join(RESULTS_DIR, `${runId}.json`);
  if (!existsSync(resultPath) && perfLines.length > 0) {
    const parsed = JSON.parse(perfLines[perfLines.length - 1]);
    writeFileSync(resultPath, JSON.stringify(parsed, null, 2) + "\n");
  }

  if (existsSync(resultPath) && cpuMHz.length > 0) {
    const record = JSON.parse(readFileSync(resultPath, "utf8"));
    record.cpuMHzMin = Math.min(...cpuMHz);
    record.cpuMHzBefore = cpuMHz[0];
    record.cpuMHzAfter = cpuMHz[cpuMHz.length - 1];
    writeFileSync(resultPath, JSON.stringify(record, null, 2) + "\n");
  }

  if (exitCode !== 0) {
    console.error(`[run-matrix] run ${runId} exited with code ${exitCode}`);
  }
  return { skipped: false, wallS, exitCode };
}

async function main() {
  const planPath = process.argv[2];
  if (!planPath) {
    console.error("usage: node scripts/perf/run-matrix.mjs <plan.json>");
    process.exit(1);
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const cooldownS = plan.cooldownS ?? 60;
  const longCooldownS = plan.longCooldownS ?? 180;

  const env = { gitSha: gitSha(), lockfileSha256: lockfileSha256(), cpuModel: cpuModel(), acPower: acPower(), os: osString() };

  let completed = 0;
  for (const run of plan.runs) {
    const outcome = await runOne(run, env);
    if (!outcome.skipped) {
      completed++;
      const cooldown = outcome.wallS > LONG_RUN_THRESHOLD_S ? longCooldownS : cooldownS;
      console.log(`[run-matrix] cooling down ${cooldown}s ...`);
      await sleep(cooldown * 1000);
    }
  }
  console.log(`[run-matrix] done: ${completed} run(s) executed, ${plan.runs.length - completed} skipped/already present.`);
}

await main();
