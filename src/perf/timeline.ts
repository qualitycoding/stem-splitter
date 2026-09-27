// Phase timeline built from separate()'s progress events (plans/perf-divergence D-101).
// Replaces the timer in tests/browser/performance.test.ts that started at `completed === 1`
// (after chunk 1 had already run) and then divided by 4 chunks (see PERF-DEFECT in plans/perf-divergence/plan/DECISIONS.md).
// STUB: methods throw until step S-102.
import type { SeparationProgress } from "../separate.ts";

export interface ModelPhase {
  /** Last "loading-model" event minus phase start; null when the phase had no "loading-model" events. */
  downloadMs: number | null;
  /** "preparing-model" completed=1 minus completed=0; null if either event is absent. */
  sessionCreateMs: number | null;
  /**
   * chunkMs[i] = duration of chunk i+1: from the previous boundary to the "separating" event with completed=i+1.
   * Boundary for chunk 1 = "preparing-model" completed=1 if present, else the phase start.
   * Chunk 1 IS included (it carries first-run costs); nothing is dropped.
   */
  chunkMs: number[];
}

export interface TimelineSummary {
  /** One entry per model session: 1 for standard mode, 4 for high quality. */
  models: ModelPhase[];
  /** Last event time minus `startedAtMs` (0 if no events). */
  totalMs: number;
}

export class PhaseTimeline {
  constructor(_startedAtMs: number) {
    void _startedAtMs;
  }

  /**
   * Feed events in order with a monotonic clock (performance.now()).
   * RangeError when: `atMs` decreases; a "separating" event's `completed` is neither previous+1 nor
   * 1-after-previous===total (a new model phase); a "separating" event has completed < 1 or > total.
   * A new phase begins at a "loading-model" or "preparing-model" completed=0 event that follows "separating" events,
   * or at a "separating" completed=1 that follows completed===total.
   */
  record(_progress: SeparationProgress, _atMs: number): void {
    throw new Error("not implemented: PhaseTimeline.record (S-102)");
  }

  /** Pure: may be called repeatedly and between record() calls. */
  summarize(): TimelineSummary {
    throw new Error("not implemented: PhaseTimeline.summarize (S-102)");
  }
}
