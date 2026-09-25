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

export default defineConfig({
  server: isolate
    ? { headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" } }
    : {},
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
    ],
  },
});
