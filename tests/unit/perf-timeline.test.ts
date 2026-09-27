import { describe, expect, it } from "vitest";
import { PhaseTimeline } from "../../src/perf/timeline";
import type { SeparationProgress } from "../../src/separate";

/**
 * FROZEN. Enforces PD-SC-1 (per-phase timing that cannot mis-count), decision D-101, claim C-101.
 * All times are integer milliseconds on a synthetic monotonic clock -> exact equality.
 */
const load = (completed: number, total = 165_612_636): SeparationProgress => ({ stage: "loading-model", completed, total });
const prep = (completed: 0 | 1): SeparationProgress => ({ stage: "preparing-model", completed, total: 1 });
const sep = (completed: number, total: number): SeparationProgress => ({ stage: "separating", completed, total });

function feed(events: Array<[SeparationProgress, number]>, startedAt = 0) {
  const t = new PhaseTimeline(startedAt);
  for (const [p, at] of events) t.record(p, at);
  return t;
}

describe("PhaseTimeline.summarize (T-105)", () => {
  it("cold standard run: download, session creation and ALL four chunks are separated", () => {
    const t = feed([
      [load(1_000_000), 1_000],
      [load(165_612_636), 30_000],
      [prep(0), 30_000],
      [prep(1), 58_000],
      [sep(1, 4), 78_500],
      [sep(2, 4), 98_500],
      [sep(3, 4), 118_500],
      [sep(4, 4), 138_500],
    ]);
    expect(t.summarize()).toEqual({
      models: [{ downloadMs: 30_000, sessionCreateMs: 28_000, chunkMs: [20_500, 20_000, 20_000, 20_000] }],
      totalMs: 138_500,
    });
  });

  it("REGRESSION PD-defect: chunk 1 is measured (not folded into 'model ready'); sum(chunkMs) covers every chunk", () => {
    const t = feed([
      [prep(0), 0],
      [prep(1), 10_000],
      [sep(1, 4), 30_000],
      [sep(2, 4), 50_000],
      [sep(3, 4), 70_000],
      [sep(4, 4), 90_000],
    ]);
    const [m] = t.summarize().models;
    expect(m.chunkMs).toHaveLength(4);
    expect(m.chunkMs.reduce((a, b) => a + b, 0)).toBe(80_000); // the old timer reported 60_000 (3 chunks) and divided by 4
  });

  it("warm cache: no loading-model events -> downloadMs is null, session creation still timed", () => {
    const t = feed([
      [prep(0), 200],
      [prep(1), 27_200],
      [sep(1, 2), 47_200],
      [sep(2, 2), 67_200],
    ]);
    expect(t.summarize().models).toEqual([{ downloadMs: null, sessionCreateMs: 27_000, chunkMs: [20_000, 20_000] }]);
  });

  it("warm cache that still emits one loading-model event: download = that event's time since phase start", () => {
    const t = feed([
      [load(165_612_636), 150],
      [prep(0), 150],
      [prep(1), 27_150],
      [sep(1, 1), 47_150],
    ]);
    expect(t.summarize().models).toEqual([{ downloadMs: 150, sessionCreateMs: 27_000, chunkMs: [20_000] }]);
  });

  it("fake-session stream (createSessionForModel override): no loading/preparing events -> chunk 1 starts at startedAt", () => {
    const t = feed(
      [
        [sep(1, 2), 1_100],
        [sep(2, 2), 1_250],
      ],
      1_000,
    );
    expect(t.summarize()).toEqual({ models: [{ downloadMs: null, sessionCreateMs: null, chunkMs: [100, 150] }], totalMs: 250 });
  });

  it("high quality: four model phases; each phase is timed from the previous phase's last chunk", () => {
    const events: Array<[SeparationProgress, number]> = [];
    let now = 0;
    for (let m = 0; m < 4; m++) {
      now += 5_000;
      events.push([load(165_612_636), now]); // download finishes 5 s after phase start
      events.push([prep(0), now]);
      now += 40_000;
      events.push([prep(1), now]);
      now += 2_000;
      events.push([sep(1, 2), now]);
      now += 1_000;
      events.push([sep(2, 2), now]);
    }
    const s = feed(events).summarize();
    expect(s.models).toHaveLength(4);
    for (const m of s.models) expect(m).toEqual({ downloadMs: 5_000, sessionCreateMs: 40_000, chunkMs: [2_000, 1_000] });
    expect(s.totalMs).toBe(4 * 48_000);
  });

  it("high quality with single-chunk input and no load events: a repeated completed=1 of total=1 starts a new phase", () => {
    const s = feed([
      [sep(1, 1), 10],
      [sep(1, 1), 30],
      [sep(1, 1), 35],
      [sep(1, 1), 60],
    ]).summarize();
    expect(s.models.map((m) => m.chunkMs)).toEqual([[10], [20], [5], [25]]);
  });

  it("empty timeline", () => {
    expect(new PhaseTimeline(5).summarize()).toEqual({ models: [], totalMs: 0 });
  });

  it("summarize() is pure: repeatable and usable mid-run", () => {
    const t = new PhaseTimeline(0);
    t.record(prep(0), 0);
    t.record(prep(1), 10);
    t.record(sep(1, 2), 30);
    const first = t.summarize();
    expect(t.summarize()).toEqual(first);
    t.record(sep(2, 2), 55);
    expect(t.summarize().models[0].chunkMs).toEqual([20, 25]);
    expect(first.models[0].chunkMs).toEqual([20]);
  });
});

describe("PhaseTimeline.record validation (T-106)", () => {
  it("rejects a clock that goes backwards", () => {
    const t = new PhaseTimeline(0);
    t.record(prep(0), 100);
    expect(() => t.record(prep(1), 99)).toThrow(RangeError);
  });
  it("rejects a skipped chunk (would silently halve a per-chunk time)", () => {
    const t = new PhaseTimeline(0);
    t.record(sep(1, 4), 10);
    expect(() => t.record(sep(3, 4), 20)).toThrow(RangeError);
  });
  it("rejects a repeated chunk index inside one phase and out-of-range completed", () => {
    const t = new PhaseTimeline(0);
    t.record(sep(1, 4), 10);
    expect(() => t.record(sep(1, 4), 20)).toThrow(RangeError);
    expect(() => new PhaseTimeline(0).record(sep(0, 4), 1)).toThrow(RangeError);
    expect(() => new PhaseTimeline(0).record(sep(5, 4), 1)).toThrow(RangeError);
  });
  it("rejects events before startedAt", () => {
    expect(() => new PhaseTimeline(1_000).record(prep(0), 999)).toThrow(RangeError);
  });
});
