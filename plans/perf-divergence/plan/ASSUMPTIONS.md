# ASSUMPTIONS

Sources: the Phase 0 intake batch (2026-09-26) and its human reply ("I do not have access to an M1 so proceed with defaults"),
plus facts established during planning. IDs `A-1xx`. Each states what the implementer may rely on and what happens if it proves false.

## Goal / scope / success criteria (Phase 0.3.1)

**Goal.** (a) A correct performance record for the shipped app; (b) an evidence-based outcome for the SP-3 divergence.
**In scope.** Timing instrumentation and harness; measuring T-027..T-030 on this machine; regenerating `tests/PERF.md` content as a generated report; the divergence investigation (reproduce, isolate, classify); repo documentation/state updates; a *drafted* upstream issue if the outcome warrants one.
**Out of scope.** Deploying (main-plan S-008/G-002); merging to `main`; filing any upstream issue; changing model, ORT version, session options (D-12) or the separation algorithm; implementing an inference workaround; performance optimisation of the app.

| ID | Success criterion (all measurable) | Evidence |
|---|---|---|
| PD-SC-1 | Perf timing cannot mis-count chunks: `src/perf/{stats,timeline}.ts` pass T-101..T-106 | tests |
| PD-SC-2 | T-027, T-028, T-029, T-030 each carry a verdict `pass`/`fail`/`unmeasured` computed by `evaluateTargets` from ≥ 3 valid runs on a real ≥ 240 s input (T-029: cold cache, verified 50 Mbit/s throttle); T-027-M1 is `unmeasured` (A-101); `tests/PERF.md` is marked SUPERSEDED; `perf/REPORT.md` is byte-identical to `renderReport(perf/results/*.json)` | T-107..T-113 |
| PD-SC-3 | Divergence: reproduced on the recovered original fixture (D0), then classified by rule D-106 into exactly one of `NOT_REPRODUCED / AMPLIFICATION / WASM_OP_DEFECT / NATIVE_OP_DEFECT / BOTH_OP_INACCURATE / UNRESOLVED`, with `research/divergence/REPORT.md` holding the evidence; if `UNRESOLVED`, a minimal repro package is committed | T-201..T-2xx, report |
| PD-SC-4 | Human gates G-101, G-102 signed off before dependent work; app-level guard decision recorded per D-109 | `GATE-*.md` |
| PD-SC-5 | Housekeeping: SP-3 addendum; `HANDOFF.md`, `plan/PLAN.md` status and `.checkpoints/state.json` of the *app* plan updated; frozen manifest regenerated and `npm run verify:frozen` green | commands in S-112 |

## Constraints

Windows 10 Pro 10.0.19045, Intel Core i5-6200U (2 cores / 4 threads), Intel HD Graphics 520 (Gen9), 4 logical cores, on **AC power with a battery present** (BatteryStatus 2 = AC).
Node v24.13.0, npm 11.18.0, Chrome 154.0.8037.57 (installed, used via Playwright `channel: 'chrome'`), Python 3.14.2. Model pinned by D-04/D-05 of the app plan. Licensing: no third-party audio is added; all audio is generated or already in the repo.
Compute budget: ≤ 4 h wall-clock for the perf track and ≤ 4 h for the divergence track (A-103), **run strictly serially** (D-110). Disk: ≤ 2 GB extra (models are already cached; results are small; the 4-min input is ~42 MB and git-ignored).

## Assumption records

| ID | Assumption | If false |
|---|---|---|
| A-101 | **No Apple M1 hardware is available** (human, 2026-09-26). T-027's "< 6 min on M1 Air" line (`T-027-M1`) stays `unmeasured`; it is reported as a residual gap that the human may waive or fill at G-101/G-103. Nothing in this plan estimates it. | If M1 access appears later, run S-105 on it with the same harness; `evaluateTargets` picks records up by `provenance.cpuModel` (`/Apple M1/`). |
| A-102 | The i5-6200U machine used here **is** the SP-1/SP-2 reference machine. Basis (inferred, not proven): same Gen9 iGPU generation and 4 logical cores as SP-1/SP-2's description, same OS, Chrome 153→154 upgrade in between, and the single-thread WASM figure agrees (SP-2 34.7 s/chunk; Node single-thread SP-6 34.8 s; corrected browser figure 35.0 s). `tests/PERF.md`'s statement that SP-2 was "a different machine" is unverified. | Records carry `cpuModel`; T-027 counts records from any non-Apple CPU, and the report prints the CPU per row, so a different reference machine is visible rather than hidden. |
| A-103 | **Divergence budget** (human default, Q2): ≤ 6 plan steps (S-107..S-111 plus S-108's browser check) and ≤ 4 compute hours; ends in a root cause or a minimal repro + a drafted (never filed) upstream issue. | Budget exhausted → outcome `UNRESOLVED` per D-106; the plan never continues past budget without G-102 sign-off. |
| A-104 | **The divergence does not block deployment (G-002 of the app plan) provided a guard decision is recorded** (human default, Q3). The guard's content is decided by D-109 after G-102. | If the human reverses this at G-102 (`stop`), S-111 becomes a fix-or-block step and a new plan is needed. |
| A-105 | **Original fixture is used, not regenerated** (deviation from intake Q4's default, with reason). Spike SP-6 found the original `golden-20s.wav` is recoverable from git (`729c249`, sha256 `9d60e12d…`), contradicting SP-3's claim that it is lost, and a regenerated 261.63/329.63/392.00 Hz chord did **not** reproduce the divergence (vocals 0.23 % vs 115 %). It is committed as `tests/fixtures/diagnostic/golden-tones-mono-20s.wav` (frozen, T-201). `tests/PERF.md` is **kept and marked SUPERSEDED** rather than silently edited (Q5 default). | — |
| A-106 | Perf and divergence code, tests and results live in the repo's own tree (`src/perf/`, `perf/`, `scripts/perf/`, `scripts/divergence/`, `tests/…`, `research/divergence/`). Existing `tests/browser/performance.test.ts` is left in place (it is frozen); it is superseded by the new harness, not deleted. | — |
| A-107 | **Synthetic 4-minute input** (default, Q7): generated deterministically by `scripts/perf/make-input.py` (same signal recipe as the non-degenerate golden fixture, 240 s), git-ignored, its SHA-256 recorded in every run record. Inference cost of a fixed-shape dense model is assumed content-independent; this is checked once in S-104 (20 s golden vs a second 20 s signal, both wasm-mt, difference ≤ 10 % of median). | If content-dependence > 10 %, S-105 also runs the 4-min case on a second synthetic signal and reports both; the verdict uses the slower. |
| A-108 | "Separation time" for T-027/T-028 excludes download and session creation (this is how SP-2's "21.8 s/chunk ≈ 15 min" was computed); T-028 additionally bounds session creation separately (< 60 s, per plan/PLAN.md text); T-030 includes the four session creations and excludes download (per its text). | — |
| A-109 | Verdict thresholds are **frozen** as written in `plan/PLAN.md` (T-027 ≤ 16 min; M1 < 6 min; T-028 < 90 s and session < 60 s; T-029 < 45 s; T-030 < 8 min). A `fail` is reported as `fail`; the implementer never edits a threshold. Changing one is a human decision at G-101. | — |
| A-110 | ≥ 3 valid runs per verdict, median used (frozen `MIN_RUNS_PER_VERDICT = 3`). `wasm-1t` (slow mode) is informational and never yields a target verdict. | — |
| A-111 | The model files are already in the local Hugging Face cache (`~/.cache/huggingface/hub/models--StemSplitio--htdemucs-onnx`, sha `d05c269d…` fp16weights and `68d0bf16…` fp32) and are used **only** by the Python/Node divergence harness. The **browser perf runs must download** the model through the app's own cache path (fresh Playwright context → empty Cache API, B-16), because the download/cache path is part of what is measured. | — |
| A-112 | This planning environment is a local Windows machine, not the remote container the session banner describes; `git push` works (dry-run verified); no PR is created (protocol + system rule). | — |

## Ambiguities resolved without a human (Phase 0.3.6 residual)

1. *Which harness runs the divergence bisection?* Node + native Python (D-107); the browser is used only to confirm equivalence once (S-108).
2. *Where do results go?* `perf/results/*.json` (data), `perf/REPORT.md` (generated), `research/divergence/` (investigation record). None are under `tests/` (results are not frozen inputs).
3. *Are frozen tests allowed to be added by the implementer?* Yes — new tests may be added (then `node scripts/frozen-manifest.mjs --write`); existing frozen tests may not be modified, skipped or weakened.
4. *What if a 4-minute WASM run exceeds the machine's endurance (thermal shutdown)?* Decision rule D-110.
