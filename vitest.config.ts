import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Two projects (plan/PLAN.md "Tests" section):
//  - "node": pure DSP (chunking, overlap-add, WAV encoding) — fast, no browser.
//  - "browser": anything touching Web Audio, fetch/Cache, Worker, or ONNX
//    Runtime Web, run in real engines via Playwright (chromium/firefox/webkit).
// Opt-in: serve the browser project with COOP/COEP so the page is
// cross-origin isolated and ORT uses its multi-threaded WASM path, as the
// deployed app does after coi-serviceworker installs. Off by default because
// the default (non-isolated, single-threaded) run doubles as the T-023
// "slow mode" check. golden-parity / performance use it — see
// .github/workflows/golden-parity.yml.
const isolate = process.env.VITE_TEST_ISOLATE === "1";

// Self-derived provenance for the perf harness (plans/perf-divergence D-111,
// S-103): computed here (Node, config-eval time) — mirroring vite.config.ts's
// __GIT_SHA__ — so a bare `npx vitest run --project perf` still produces a
// valid RunRecord even without the scripts/perf/run-matrix.mjs driver, which
// overrides both via VITE_PERF_GIT / VITE_PERF_LOCK env vars.
function gitShaAtConfigLoad(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "0".repeat(40);
  }
}
function lockfileSha256AtConfigLoad(): string {
  try {
    return createHash("sha256").update(readFileSync(new URL("./package-lock.json", import.meta.url))).digest("hex");
  } catch {
    return "0".repeat(64);
  }
}

export default defineConfig({
  server: isolate
    ? { headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" } }
    : {},
  optimizeDeps: {
    // Without this, Vite discovers onnxruntime-web mid test-collection
    // (first browser-mode run to import it) and reloads mid-run.
    include: ["onnxruntime-web"],
    // Vite's dependency pre-bundling caches the Node-side stub build of
    // "@vitest/browser/context" instead of letting Vitest's own plugin swap
    // in the real in-browser implementation, so any use of `commands`/`cdp`
    // throws "vitest/browser can be imported only inside the Browser Mode"
    // even inside a real browser test — a known bug in vitest 5.0.1 (pinned,
    // plan/ENVIRONMENT.md), fixed upstream in vitest-dev/vitest#8658 by
    // excluding this import from optimization; same fix applied here.
    exclude: ["@vitest/browser/context"],
  },
  define: {
    __PERF_GIT_SHA__: JSON.stringify(gitShaAtConfigLoad()),
    __PERF_LOCKFILE_SHA256__: JSON.stringify(lockfileSha256AtConfigLoad()),
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          include: ["tests/browser/**/*.test.ts"],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [
              { browser: "chromium" },
              { browser: "firefox" },
              { browser: "webkit" },
            ],
          },
        },
      },
      // "perf": the perf harness (plans/perf-divergence D-111) — Chrome only
      // (WebGPU headless needs the real channel, not bundled Chromium), a
      // separate project so it never runs as part of test/test:browser/test:all.
      {
        extends: true,
        test: {
          name: "perf",
          include: ["perf/harness/**/*.perf.ts"],
          browser: {
            enabled: true,
            provider: playwright({ launchOptions: { channel: "chrome" } }),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
