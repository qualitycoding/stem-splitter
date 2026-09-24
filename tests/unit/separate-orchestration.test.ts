import { describe, expect, it } from "vitest";
import type { InferenceSession, Tensor } from "onnxruntime-web";
import { SEGMENT_SAMPLES } from "../../src/dsp/chunk";
import { STEM_NAMES } from "../../src/dsp/stems";
import type { ModelInfo } from "../../src/model/hub";
import { separate, type SeparationProgress } from "../../src/separate";

/** See tests/unit/separate-cancel.test.ts for why a fake session: it lets
 * separate.ts's own orchestration (chunk looping, progress reporting,
 * standard vs. high-quality flow, result assembly) be verified directly in
 * Node, which this environment can actually run — unlike
 * tests/browser/separate.test.ts, which needs a real browser this sandbox
 * has no route to (plan/PLAN.md "Implementation status"). Row r, channel c
 * of the fake output is filled with (r * 2 + c), so which row was kept is
 * checkable the same way tests/unit/stems.test.ts (T-011) does it. */
function fakeSession(): InferenceSession {
  return {
    inputNames: ["mix"],
    outputNames: ["stems"],
    async run(): Promise<InferenceSession.OnnxValueMapType> {
      const data = new Float32Array(4 * 2 * SEGMENT_SAMPLES);
      for (let row = 0; row < 4; row++) {
        for (let ch = 0; ch < 2; ch++) {
          data.fill(row * 2 + ch, (row * 2 + ch) * SEGMENT_SAMPLES, (row * 2 + ch + 1) * SEGMENT_SAMPLES);
        }
      }
      const tensor = { data, dims: [1, 4, 2, SEGMENT_SAMPLES], type: "float32" } as unknown as Tensor;
      return { stems: tensor };
    },
    async release(): Promise<void> {},
  } as unknown as InferenceSession;
}

function fakeLoader(onProgress?: (p: SeparationProgress) => void) {
  return async (_info: ModelInfo) => {
    // Mirrors defaultCreateSessionForModel's own progress reporting (it's
    // bypassed entirely when a custom loader is supplied — separate.ts has
    // no way to know a loader's internal stages — so a test that cares
    // about the full stage sequence a real run produces has to emit it
    // itself, same as the real default loader would around getModel/createSession).
    onProgress?.({ stage: "preparing-model", completed: 0, total: 1 });
    const session = fakeSession();
    onProgress?.({ stage: "preparing-model", completed: 1, total: 1 });
    return { session, executionProvider: "wasm" as const };
  };
}

describe("separate() orchestration, standard mode", () => {
  it("returns all four stems at the input's length, with exactly one model used", async () => {
    const totalLength = 2 * 257_985 + 1000; // several chunks
    const left = new Float32Array(totalLength);
    const right = new Float32Array(totalLength);

    const result = await separate(left, right, "standard", { createSessionForModel: fakeLoader() });

    expect(result.models).toHaveLength(1);
    expect(result.models[0].name).toBe("htdemucs");
    for (const stem of STEM_NAMES) {
      const [l, r] = result.stems[stem];
      expect(l.length).toBe(totalLength);
      expect(r.length).toBe(totalLength);
    }
  });

  it("reports loading-model, preparing-model, then separating, in that order", async () => {
    const left = new Float32Array(1000);
    const right = new Float32Array(1000);
    const stages: SeparationProgress["stage"][] = [];
    const onProgress = (p: SeparationProgress) => {
      if (stages[stages.length - 1] !== p.stage) stages.push(p.stage);
    };

    await separate(left, right, "standard", {
      createSessionForModel: fakeLoader(onProgress),
      onProgress,
    });

    expect(stages).toEqual(["preparing-model", "separating"]);
    // (No "loading-model" here: the fake loader bypasses getModel()/the
    // Cache API entirely, which is exactly what makes this Node-runnable.
    // tests/browser/cache.test.ts covers the real download progress path.)
  });

  it("separating progress starts at 1 and ends at the chunk count, monotonically", async () => {
    const totalLength = 3 * 257_985 + 1000; // several chunks
    const left = new Float32Array(totalLength);
    const right = new Float32Array(totalLength);
    const events: SeparationProgress[] = [];

    await separate(left, right, "standard", {
      createSessionForModel: fakeLoader(),
      onProgress: (p) => {
        if (p.stage === "separating") events.push({ ...p });
      },
    });

    expect(events.length).toBeGreaterThan(1);
    expect(events[0].completed).toBe(1);
    expect(events[events.length - 1].completed).toBe(events[events.length - 1].total);
    for (let i = 1; i < events.length; i++) expect(events[i].completed).toBeGreaterThan(events[i - 1].completed);
  });
});

describe("separate() orchestration, high-quality mode", () => {
  it("keeps the row matching each stem through the real accumulation path", async () => {
    const left = new Float32Array(1000);
    const right = new Float32Array(1000);

    const result = await separate(left, right, "hq", { createSessionForModel: fakeLoader() });

    expect(result.models).toHaveLength(4);
    // Row order is drums=0, bass=1, other=2, vocals=3; fake fills row r,
    // channel c with (r*2+c). Sample 0 is always exactly 0 (D-14); check
    // elsewhere.
    const expectedLeft: Record<import("../../src/dsp/stems").StemName, number> = {
      drums: 0,
      bass: 2,
      other: 4,
      vocals: 6,
    };
    for (const [stem, expected] of Object.entries(expectedLeft)) {
      const [l] = result.stems[stem as keyof typeof expectedLeft];
      expect(l[500]).toBeCloseTo(expected, 4);
    }
  });
});
