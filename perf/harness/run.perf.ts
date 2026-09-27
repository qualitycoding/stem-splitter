// Vitest "perf" project test: runs one configured separation and writes a
// RunRecord to perf/results/<id>.json (plans/perf-divergence D-111, S-103).
// Driven by scripts/perf/run-matrix.mjs, which sets VITE_PERF_* env vars per
// run; can also be invoked standalone (plan/PLAN.md S-103 step 7 smoke test)
// — falls back to self-derived provenance (__PERF_GIT_SHA__ etc., computed
// in vitest.config.ts) when the driver's env vars are absent.
//
// Does NOT import "@vitest/browser/context" (commands/cdp): on the pinned
// vitest 5.0.1 (plan/ENVIRONMENT.md) that import throws even inside a real
// browser test ("vitest/browser can be imported only inside the Browser
// Mode") — the same bug vitest-dev/vitest#8657/#8658 fixed upstream in a
// later version we're not on. Per D-111's own documented fallback/fork:
// the input file is fetched from the dev server instead of read via
// `commands.readFile`, results are always emitted as a PERFRECORD stdout
// line (scripts/perf/run-matrix.mjs writes the file) instead of
// `commands.writeFile`, and CDP throttling (T-029) is unavailable, so a
// cold+throttled run always records throttleMbps: null (unmeasured) — see
// plans/perf-divergence/DEVIATIONS.md.
import * as ort from "onnxruntime-web";
import { describe, it } from "vitest";
import { decodeTo44k } from "../../src/audio/decode";
import { planChunks, SAMPLE_RATE } from "../../src/dsp/chunk";
import { sha256Hex } from "../../src/hash";
import { getModel } from "../../src/model/cache";
import { HQ_SPECIALIST_MODELS, MODELS, STANDARD_MODEL } from "../../src/model/hub";
import { validateRunRecord, type ConfigId, type RunRecord } from "../../src/perf/report";
import { PhaseTimeline } from "../../src/perf/timeline";
import { separate, type SeparationMode } from "../../src/separate";

declare const __PERF_GIT_SHA__: string;
declare const __PERF_LOCKFILE_SHA256__: string;

const CONFIG_IDS = ["wasm-1t", "wasm-mt", "webgpu-standard", "webgpu-hq"] as const;
const CONFIG_MODE: Record<ConfigId, SeparationMode> = {
  "wasm-1t": "standard",
  "wasm-mt": "standard",
  "webgpu-standard": "standard",
  "webgpu-hq": "hq",
};

/** D-111(b): 50 Mbit/s throttle validity gate is [0.80, 1.05] x nominal B/s. */
function throttleRange(mbps: number): { nominal: number; min: number; max: number } {
  const nominal = (mbps * 1_000_000) / 8;
  return { nominal, min: 0.8 * nominal, max: 1.05 * nominal };
}

function env(name: string): string | undefined {
  const value = (import.meta.env as unknown as Record<string, string | undefined>)[name];
  return value === undefined || value === "" ? undefined : value;
}

/** Reads a repo-relative file by fetching it from the dev server (Vite serves any file under the project root) — works for any VITE_PERF_INPUT path, unlike a static `?url` import. */
async function readLocalFile(path: string, name: string): Promise<File> {
  const res = await fetch(`/${path}`);
  if (!res.ok) throw new Error(`perf harness: could not fetch input "${path}" (HTTP ${res.status})`);
  return new File([await res.blob()], name, { type: "audio/wav" });
}

/**
 * commands.writeFile is unavailable in this environment (see file header);
 * scripts/perf/run-matrix.mjs parses this single line into perf/results/.
 * Must stay on one line (compact JSON, no pretty-printing) — the driver
 * splits stdout on newlines to find it.
 */
function writeResult(record: RunRecord): void {
  console.log(`PERFRECORD ${JSON.stringify(record)}`);
}

describe("perf harness", () => {
  it(
    "runs one configured separation and records it",
    async () => {
      const configRaw = env("VITE_PERF_CONFIG");
      if (!configRaw || !(CONFIG_IDS as readonly string[]).includes(configRaw)) {
        throw new Error(`perf harness: VITE_PERF_CONFIG must be one of ${CONFIG_IDS.join(", ")}, got ${JSON.stringify(configRaw)}`);
      }
      const configId = configRaw as ConfigId;
      const mode = CONFIG_MODE[configId];
      const inputPath = env("VITE_PERF_INPUT");
      if (!inputPath) throw new Error("perf harness: VITE_PERF_INPUT is required (a path under the repo root)");
      const cold = env("VITE_PERF_COLD") === "1";
      const throttleMbpsRequested = env("VITE_PERF_THROTTLE_MBPS") ? Number(env("VITE_PERF_THROTTLE_MBPS")) : undefined;
      const isWebgpu = configId.startsWith("webgpu");

      if (isWebgpu) {
        if (!navigator.gpu) throw new Error(`perf harness: config ${configId} requires navigator.gpu`);
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error(`perf harness: config ${configId} requires a WebGPU adapter, requestAdapter() returned null`);
      } else {
        // Shadow WebGPU so createSession() can't silently pick it (mirrors tests/browser/golden-parity.test.ts).
        Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
      }

      try {
        const cacheKeysBefore = await caches.keys();
        if (cold && cacheKeysBefore.length > 0) {
          throw new Error(`perf harness: VITE_PERF_COLD=1 requires an empty Cache API, found ${cacheKeysBefore.length} cache(s)`);
        }

        const modelsForMode = mode === "hq" ? Object.values(HQ_SPECIALIST_MODELS).map((name) => MODELS[name]) : [MODELS[STANDARD_MODEL]];
        if (!cold) {
          for (const info of modelsForMode) await getModel(info); // untimed warm-up
        }

        const inputName = inputPath.split(/[/\\]/).pop() ?? inputPath;
        const file = await readLocalFile(inputPath, inputName);
        const inputSha256 = await sha256Hex(await file.arrayBuffer());
        const { left, right } = await decodeTo44k(file);
        const durationSeconds = left.length / SAMPLE_RATE;
        const chunkCount = planChunks(left.length).length;

        if (cold && throttleMbpsRequested !== undefined) {
          // CDP throttling needs `cdp()` from "@vitest/browser/context", unavailable here (see file header) —
          // per the plan's own decision fork this makes the run un-throttled; T-029 stays unmeasured for it.
          console.warn(`perf harness: throttle requested (${throttleMbpsRequested} Mbit/s) but CDP is unavailable; running unthrottled.`);
        }

        const startedAtUtc = new Date().toISOString();
        const timeline = new PhaseTimeline(performance.now());
        const result = await separate(left, right, mode, { onProgress: (p) => timeline.record(p, performance.now()) });

        if (isWebgpu !== (result.executionProvider === "webgpu")) {
          throw new Error(`perf harness: config ${configId} resolved to executionProvider "${result.executionProvider}"`);
        }

        const summary = timeline.summarize();

        let throttleMbps: number | null = null;
        let throttleVerified: boolean | undefined;
        if (cold && throttleMbpsRequested !== undefined) {
          const downloadMs = summary.models[0]?.downloadMs ?? null;
          const range = throttleRange(throttleMbpsRequested);
          const achieved = downloadMs ? modelsForMode[0].bytes / (downloadMs / 1000) : null;
          throttleVerified = achieved !== null && achieved >= range.min && achieved <= range.max;
          throttleMbps = throttleVerified ? throttleMbpsRequested : null;
        }

        const defaultId = `${configId}-${inputName.replace(/\.[^.]+$/, "")}-${startedAtUtc.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
        const runId = env("VITE_PERF_RUN_ID") ?? defaultId;

        const record: RunRecord = {
          schema: 1,
          id: runId,
          config: configId,
          input: { name: inputName, sha256: inputSha256, durationSeconds, chunkCount },
          throttleMbps,
          cacheCold: cold,
          executionProvider: result.executionProvider,
          threadCount: result.threadCount,
          models: summary.models,
          provenance: {
            gitCommit: env("VITE_PERF_GIT") ?? __PERF_GIT_SHA__,
            lockfileSha256: env("VITE_PERF_LOCK") ?? __PERF_LOCKFILE_SHA256__,
            ortVersion: ort.env.versions?.web ?? "unknown",
            browser: navigator.userAgent,
            os: env("VITE_PERF_OS") ?? navigator.platform,
            cpuModel: env("VITE_PERF_CPU") ?? `unknown (${navigator.hardwareConcurrency} logical cores)`,
            logicalCores: navigator.hardwareConcurrency,
            acPower: env("VITE_PERF_AC") ? env("VITE_PERF_AC") === "1" : null,
            startedAtUtc,
          },
        };
        if (throttleVerified !== undefined) (record as unknown as Record<string, unknown>).throttleVerified = throttleVerified;

        const problems = validateRunRecord(record);
        if (problems.length > 0) throw new Error(`perf harness: built an invalid RunRecord:\n${problems.join("\n")}`);

        writeResult(record);
      } finally {
        if (!isWebgpu) delete (navigator as unknown as Record<string, unknown>).gpu;
      }
    },
    60 * 60_000, // generous: the slowest config (wasm-1t, 4-min input) is expected around 25 min (plan/PLAN.md S-105)
  );
});
