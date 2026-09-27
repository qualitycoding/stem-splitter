// UI for perf/standalone/index.html — see vite.config.ts's header comment.
import * as ort from "onnxruntime-web";
import { SAMPLE_RATE } from "../../src/dsp/chunk";
import { decodeTo44k } from "../../src/audio/decode";
import { sha256Hex } from "../../src/hash";
import { chunkCountForDuration } from "../../src/perf/stats";
import { validateRunRecord, type ConfigId, type RunRecord } from "../../src/perf/report";
import { PhaseTimeline } from "../../src/perf/timeline";
import { separate, type SeparationMode } from "../../src/separate";

declare const __PERF_GIT_SHA__: string;
declare const __PERF_LOCKFILE_SHA256__: string;

const isolationEl = document.getElementById("isolation-status")!;
isolationEl.textContent = self.crossOriginIsolated
  ? "Cross-origin isolated — multi-threaded WASM is available."
  : "Not cross-origin isolated yet (the service worker reloads the page once it activates) — WASM will run single-threaded until then.";

const form = document.getElementById("run-form") as HTMLFormElement;
const progressEl = document.getElementById("progress")!;
const resultsEl = document.getElementById("results")!;
const tableEl = document.getElementById("result-table")!;
const jsonEl = document.getElementById("result-json")!;
const downloadButton = document.getElementById("download-button") as HTMLButtonElement;
const runButton = document.getElementById("run-button") as HTMLButtonElement;

let lastRecord: RunRecord | null = null;

/** Labels the run with the same config ids perf/results/*.json uses, derived from what actually happened
 * (never from a user selection) so a silent EP/thread fallback can't be mislabelled — see src/perf/report.ts validateRunRecord. */
function deriveConfigId(mode: SeparationMode, executionProvider: "wasm" | "webgpu", threadCount: number): ConfigId {
  if (executionProvider === "webgpu") return mode === "hq" ? "webgpu-hq" : "webgpu-standard";
  return threadCount > 1 ? "wasm-mt" : "wasm-1t";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  runButton.disabled = true;
  resultsEl.hidden = true;
  progressEl.textContent = "Starting…";

  const mode = (document.getElementById("mode") as HTMLSelectElement).value as SeparationMode;
  const forceWasm = (document.getElementById("force-wasm") as HTMLInputElement).checked;
  const file = (document.getElementById("input-file") as HTMLInputElement).files?.[0];
  const cpuModel = (document.getElementById("cpu-model") as HTMLInputElement).value.trim();
  const acPowerRaw = (document.getElementById("ac-power") as HTMLSelectElement).value;

  if (!file) {
    progressEl.textContent = "Choose a file first.";
    runButton.disabled = false;
    return;
  }

  let restoreGpu: (() => void) | null = null;
  if (forceWasm) {
    Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
    restoreGpu = () => delete (navigator as unknown as Record<string, unknown>).gpu;
  }

  try {
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const inputSha256 = await sha256Hex(fileBytes);
    const { left, right } = await decodeTo44k(file);
    const durationSeconds = left.length / SAMPLE_RATE;

    const startedAtUtc = new Date().toISOString();
    const timeline = new PhaseTimeline(performance.now());
    const result = await separate(left, right, mode, {
      onProgress: (p) => {
        timeline.record(p, performance.now());
        progressEl.textContent = `${p.stage}: ${p.completed}/${p.total}`;
      },
    });

    const summary = timeline.summarize();
    const configId = deriveConfigId(mode, result.executionProvider, result.threadCount);
    const id = `${configId}-${file.name.replace(/\.[^.]+$/, "")}-${startedAtUtc.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;

    const record: RunRecord = {
      schema: 1,
      id,
      config: configId,
      input: { name: file.name, sha256: inputSha256, durationSeconds, chunkCount: chunkCountForDuration(durationSeconds) },
      throttleMbps: null,
      cacheCold: false,
      executionProvider: result.executionProvider,
      threadCount: result.threadCount,
      models: summary.models,
      provenance: {
        gitCommit: __PERF_GIT_SHA__,
        lockfileSha256: __PERF_LOCKFILE_SHA256__,
        ortVersion: ort.env.versions?.web ?? "unknown",
        browser: navigator.userAgent,
        os: navigator.platform,
        cpuModel: cpuModel || `unknown (${navigator.hardwareConcurrency} logical cores)`,
        logicalCores: navigator.hardwareConcurrency,
        acPower: acPowerRaw === "" ? null : acPowerRaw === "1",
        startedAtUtc,
      },
    };

    lastRecord = record;
    renderResult(record, summary.totalMs, validateRunRecord(record));
  } catch (err) {
    progressEl.textContent = `Failed: ${(err as Error).message}`;
    console.error(err);
  } finally {
    restoreGpu?.();
    runButton.disabled = false;
  }
});

function renderResult(record: RunRecord, totalMs: number, problems: string[]): void {
  progressEl.textContent = "Done.";
  const rows = [
    `<tr><th>Config</th><td>${record.config}</td></tr>`,
    `<tr><th>Execution provider</th><td>${record.executionProvider}</td></tr>`,
    `<tr><th>Threads</th><td>${record.threadCount}</td></tr>`,
    `<tr><th>Total wall time</th><td>${(totalMs / 1000).toFixed(1)} s</td></tr>`,
  ];
  record.models.forEach((m, i) => {
    rows.push(`<tr><th>Model ${i + 1} — download</th><td>${m.downloadMs === null ? "—" : `${(m.downloadMs / 1000).toFixed(1)} s`}</td></tr>`);
    rows.push(
      `<tr><th>Model ${i + 1} — session create</th><td>${m.sessionCreateMs === null ? "—" : `${(m.sessionCreateMs / 1000).toFixed(1)} s`}</td></tr>`,
    );
    rows.push(`<tr><th>Model ${i + 1} — chunks (ms)</th><td>${m.chunkMs.map((c) => c.toFixed(0)).join(", ")}</td></tr>`);
  });
  tableEl.innerHTML = rows.join("\n");
  jsonEl.textContent = problems.length > 0 ? `INVALID RECORD — validateRunRecord() problems:\n${problems.join("\n")}` : JSON.stringify(record, null, 2);
  resultsEl.hidden = false;
}

downloadButton.addEventListener("click", () => {
  if (!lastRecord) return;
  const blob = new Blob([`${JSON.stringify(lastRecord, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${lastRecord.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
});
