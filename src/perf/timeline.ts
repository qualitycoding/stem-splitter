// Phase timeline built from separate()'s progress events (plans/perf-divergence D-101).
// Replaces the timer in tests/browser/performance.test.ts that started at `completed === 1`
// (after chunk 1 had already run) and then divided by 4 chunks (see PERF-DEFECT in plans/perf-divergence/plan/DECISIONS.md).
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

interface PhaseState {
  phaseStartMs: number;
  downloadMs: number | null;
  sessionCreateMs: number | null;
  prepZeroAtMs: number | null;
  chunk1BoundaryMs: number | null;
  chunkMs: number[];
  hasSeenSeparating: boolean;
  lastSepAtMs: number;
  lastSepCompleted: number;
  lastSepTotal: number;
}

export class PhaseTimeline {
  private readonly startedAtMs: number;
  private lastAtMs: number;
  private readonly phases: PhaseState[] = [];

  constructor(startedAtMs: number) {
    this.startedAtMs = startedAtMs;
    this.lastAtMs = startedAtMs;
  }

  private currentPhase(): PhaseState | undefined {
    return this.phases[this.phases.length - 1];
  }

  private startPhase(phaseStartMs: number): PhaseState {
    const phase: PhaseState = {
      phaseStartMs,
      downloadMs: null,
      sessionCreateMs: null,
      prepZeroAtMs: null,
      chunk1BoundaryMs: null,
      chunkMs: [],
      hasSeenSeparating: false,
      lastSepAtMs: phaseStartMs,
      lastSepCompleted: 0,
      lastSepTotal: 0,
    };
    this.phases.push(phase);
    return phase;
  }

  /**
   * Feed events in order with a monotonic clock (performance.now()).
   * RangeError when: `atMs` decreases; a "separating" event's `completed` is neither previous+1 nor
   * 1-after-previous===total (a new model phase); a "separating" event has completed < 1 or > total.
   * A new phase begins at a "loading-model" or "preparing-model" completed=0 event that follows "separating" events,
   * or at a "separating" completed=1 that follows completed===total.
   */
  record(progress: SeparationProgress, atMs: number): void {
    if (!(atMs >= this.lastAtMs)) {
      throw new RangeError(`PhaseTimeline.record: clock must be monotonic, got ${atMs} after ${this.lastAtMs}`);
    }
    const previousAtMs = this.lastAtMs;
    const isLoadOrPrepZero = progress.stage === "loading-model" || (progress.stage === "preparing-model" && progress.completed === 0);
    const isSepOne = progress.stage === "separating" && progress.completed === 1;

    let phase = this.currentPhase();
    if (!phase) {
      phase = this.startPhase(this.startedAtMs);
    } else if (isLoadOrPrepZero && phase.hasSeenSeparating) {
      phase = this.startPhase(previousAtMs);
    } else if (isSepOne && phase.hasSeenSeparating && phase.lastSepCompleted === phase.lastSepTotal) {
      phase = this.startPhase(previousAtMs);
    }

    if (progress.stage === "loading-model") {
      phase.downloadMs = atMs - phase.phaseStartMs;
    } else if (progress.stage === "preparing-model") {
      if (progress.completed === 0) {
        phase.prepZeroAtMs = atMs;
      } else {
        if (phase.prepZeroAtMs !== null) phase.sessionCreateMs = atMs - phase.prepZeroAtMs;
        phase.chunk1BoundaryMs = atMs;
      }
    } else {
      if (progress.completed < 1 || progress.completed > progress.total) {
        throw new RangeError(`PhaseTimeline.record: separating completed=${progress.completed} out of range for total=${progress.total}`);
      }
      const expected = phase.hasSeenSeparating ? phase.lastSepCompleted + 1 : 1;
      if (progress.completed !== expected) {
        throw new RangeError(`PhaseTimeline.record: expected separating completed=${expected}, got ${progress.completed}`);
      }
      const boundary = progress.completed === 1 ? (phase.chunk1BoundaryMs ?? phase.phaseStartMs) : phase.lastSepAtMs;
      phase.chunkMs.push(atMs - boundary);
      phase.hasSeenSeparating = true;
      phase.lastSepAtMs = atMs;
      phase.lastSepCompleted = progress.completed;
      phase.lastSepTotal = progress.total;
    }

    this.lastAtMs = atMs;
  }

  /** Pure: may be called repeatedly and between record() calls. */
  summarize(): TimelineSummary {
    return {
      models: this.phases.map((p) => ({ downloadMs: p.downloadMs, sessionCreateMs: p.sessionCreateMs, chunkMs: [...p.chunkMs] })),
      totalMs: this.lastAtMs - this.startedAtMs,
    };
  }
}
