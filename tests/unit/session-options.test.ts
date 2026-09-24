import { describe, expect, it } from "vitest";
import { SESSION_OPTIONS } from "../../src/model/session";

// D-12 / research/spikes/SP-2.md: graphOptimizationLevel other than
// "disabled" exhausts the 4 GB wasm32 heap when loading htdemucs. This
// doesn't run a real session (that needs a browser + the real model —
// see tests/browser/session.test.ts); it just pins the constant so nobody
// "optimises" this back on without re-reading SP-2 first.
describe("D-12 session options (T-033)", () => {
  it("never enables graph optimisation", () => {
    expect(SESSION_OPTIONS.graphOptimizationLevel).toBe("disabled");
  });

  it("keeps the CPU memory arena and memory-pattern planning off", () => {
    expect(SESSION_OPTIONS.enableCpuMemArena).toBe(false);
    expect(SESSION_OPTIONS.enableMemPattern).toBe(false);
  });

  it("does not itself set executionProviders (callers choose webgpu/wasm)", () => {
    expect("executionProviders" in SESSION_OPTIONS).toBe(false);
  });
});
