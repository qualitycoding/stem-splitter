import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Two projects (plan/PLAN.md "Tests" section):
//  - "node": pure DSP (chunking, overlap-add, WAV encoding) — fast, no browser.
//  - "browser": anything touching Web Audio, fetch/Cache, Worker, or ONNX
//    Runtime Web, run in real engines via Playwright (chromium/firefox/webkit).
export default defineConfig({
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
