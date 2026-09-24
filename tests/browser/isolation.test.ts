import { describe, expect, it } from "vitest";
import { computeThreadCount, resolveThreadCount } from "../../src/model/session";

// The Vitest browser test server doesn't send the COOP/COEP headers the
// deployed app gets from coi-serviceworker (vite.config.ts's dev-only
// plugin isn't part of vitest.config.ts's server), so this environment is
// realistically never cross-origin isolated — which makes it a good,
// always-available stand-in for the "slow mode" fallback path (T-023: a
// browser where isolation isn't available should still run correctly,
// single-threaded, not show a blocking error). tests/browser/separate.test.ts
// already runs full separations in this same environment; this test just
// pins down *why* those runs are single-threaded and that resolveThreadCount
// matches the pure D-07 formula (tests/unit/session.test.ts) given the
// real ambient navigator/self state, not just the formula in isolation.
describe("resolveThreadCount reflects real ambient isolation state (T-023)", () => {
  it("matches computeThreadCount(hardwareConcurrency, self.crossOriginIsolated)", () => {
    const expected = computeThreadCount(navigator.hardwareConcurrency || 2, Boolean(self.crossOriginIsolated));
    expect(resolveThreadCount()).toBe(expected);
  });

  it("is a positive integer, never zero", () => {
    expect(resolveThreadCount()).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(resolveThreadCount())).toBe(true);
  });
});
