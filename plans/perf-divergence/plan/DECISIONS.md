# DECISIONS

Interfaces, design choices and **decision rules** (Phase 3.2). "If → then" rules are binding. Anything not covered falls under the **default rule** at the end.
Claim IDs (`C-1xx…`) refer to `research/claims.json`; spikes to `research/spikes/`.

## Part A — Perf track

### D-101 Phase timeline is derived from `separate()`'s progress events (C-101, C-105)
`src/perf/timeline.ts` exports `PhaseTimeline` (interface frozen by `tests/unit/perf-timeline.test.ts`). Input is the existing `SeparationProgress` stream — **no change to `src/separate.ts`** is required or permitted.
Semantics (all frozen by tests): a model phase = optional `loading-model` events → optional `preparing-model` 0→1 → `separating` 1..N. A new phase starts at a `loading-model`/`preparing-model(0)` after `separating` events, or at `separating(1)` after `completed === total`. Chunk *i* = time from the previous boundary to `separating(i)`; chunk 1's boundary is `preparing-model(1)` (else phase start). **Chunk 1 is never dropped** — that omission is the recorded defect (see PERF-DEFECT below). `record()` throws `RangeError` on a non-monotonic clock, a skipped/repeated chunk index, or an out-of-range index. `summarize()` is pure.
The clock is `performance.now()`. The harness feeds each event as it arrives (from the `onProgress` callback), so the timeline observes the same events the UI does.

**PERF-DEFECT (verified, C-101).** `tests/browser/performance.test.ts:31-33` sets `modelLoadedAt` on the first `separating` event with `completed === 1` — *after chunk 1 has run* — then reports `separation = end − modelLoadedAt`, which spans **3** chunks, and `tests/PERF.md` divides it by **4** (15.4 s/chunk). Corrected from the same recorded totals: 61.7 s / 3 = 20.6 s/chunk (≈ 14.4 min for 42 chunks, not 10.8) and 105.0 s / 3 = 35.0 s/chunk (≈ 24.5 min, not 18.4). The corrected numbers agree with SP-2 (21.8 / 34.7 s) and with a Node single-thread run (34.8 s, SP-6). "model-ready" also silently includes chunk 1's inference. These are *derived from old data and are not a measurement*: S-104/S-105 re-measure.

### D-102 Run record and generated report (Rule 9)
`RunRecord` (schema 1) is defined in `src/perf/report.ts` (frozen tests fix its validation rules). One JSON file per run in `perf/results/<id>.json`, written atomically (write `<id>.json.tmp`, then rename). `id` = `<config>-<input>-<UTC yyyymmddThhmmss>`; never overwritten. Extra optional keys are allowed and preserved: `cpuMHzBefore`, `cpuMHzAfter`, `powerPlan`, `notes`, `throttleVerified` (see D-111), `cpuMHzMin`.
`perf/REPORT.md` is **generated only** by `node scripts/perf/report.ts` (a thin CLI over `renderReport`, Node type-stripping — C-108) and is checked byte-for-byte by `tests/unit/perf-record.test.ts`. No number in it, in `tests/PERF.md`'s banner, in `HANDOFF.md`, or in any status text may be typed by hand; text elsewhere refers to `perf/REPORT.md` instead of quoting numbers.
`tests/PERF.md` is retained with a `SUPERSEDED` banner (first ≤ 12 lines) that names the defect ("timer started after chunk 1…") and points to `perf/REPORT.md`; its body is otherwise untouched (A-105).

### D-103 Verdict semantics (frozen by `perf-report.test.ts`; A-108/A-109/A-110)
- Only **valid** records (`validateRunRecord(r) == []`) with `input.durationSeconds ≥ 240` count toward T-027/T-027-M1/T-028/T-030. T-029 counts valid cold-cache records with `throttleMbps === 50` (any duration).
- Verdict = `pass`/`fail` from the **median** over ≥ 3 such runs; fewer → `unmeasured` (basis names the count and any excluded invalid records).
- T-027 (≤ 16 min) uses config `wasm-mt` on non-Apple CPUs; T-027-M1 (< 6 min, strict) uses config `wasm-mt` with `cpuModel` matching `/Apple M1/`; T-028 needs separation < 90 s **and** session creation < 60 s (both strict); T-029 download < 45 s (strict); T-030 Σ(session creation + chunks over 4 phases) < 8 min (strict), download excluded. `wasm-1t` never yields a verdict.
- An extrapolation (`extrapolateSeparationMs`) is labelled *indicative — not a verdict* in the report and is never converted into pass/fail.
- Validation catches silent fallbacks: `wasm-mt` with `threadCount === 1`; `webgpu-*` with `executionProvider === "wasm"`; `wasm-1t` with > 1 thread; chunk-count mismatch.

### D-104 Statistics
`src/perf/stats.ts`: type-7 quantiles; `summarizeDistribution`; `chunkCountForDuration` = `planChunks(round(seconds·sampleRate)).length` (imports `../dsp/chunk.ts` — a single geometry); `extrapolateSeparationMs(chunkMs, N) = chunkMs[0] + (N−1)·median(chunkMs[1:])`, requires ≥ 2 measured chunks. Runtime imports in `src/perf/*.ts` carry explicit `.ts` extensions so Node can run them un-built (C-108); `tsconfig` already allows this.

### D-110 Measurement protocol (machine controls, order, drift, thermal) — B-9, B-10, B-11
1. **Serial machine.** While any S-104/S-105 run is in progress nothing else CPU-heavy runs (no divergence work, no builds, no `npm test`). The implementer performs code edits between runs only.
2. **Controls** per `ENVIRONMENT.md` (AC, High-performance plan, apps closed, `typeperf` frequency sampling). Restore the prior power scheme when the measurement steps finish or abort (S-105 *Finalisation*).
3. **Order.** Configs are interleaved, not blocked: within each phase the order is `A B C A B C …` (so slow drift shows as a trend rather than as a config effect). 60 s idle cool-down between runs; 180 s after any run ≥ 10 min.
4. **Repeats.** 20 s clip: 5 runs per config. 4-min: 3 runs for `wasm-mt`, `webgpu-standard`, `webgpu-hq`; 1 run for `wasm-1t` (informational). Each run is a fresh `vitest` browser launch (fresh Playwright context ⇒ empty Cache API, B-16), except runs that intentionally test warm cache.
5. **Warm-up.** Timings are recorded from every chunk (chunk 1 is reported separately as the warm-up chunk); nothing is discarded before it is recorded. The report shows median and IQR of steady chunks (2..N) and the first chunk separately.
6. **Drift check.** After each config's runs, if `max/min` of the run totals > 1.25, or the sampled CPU frequency's minimum falls below 60 % of its start value in any run, mark the affected runs `notes: "thermal/frequency drift"`, run **one** extra cool-down + repeat per affected config (at most once), and report both. Never drop a run silently; the median over all valid runs is used.
7. **Thermal abort rule.** If the machine shuts down/hibernates or a run exceeds 2× its expected duration (WASM MT 4-min > 30 min; WebGPU 4-min > 10 min; HQ > 20 min), kill it, write a `notes` stub run record marked invalid (`validateRunRecord` will reject it), re-run once after 10 min cool-down; if it fails again, stop, and treat that verdict as `unmeasured` with the reason in `perf/REPORT.md` (do not lower the input length to force a result).
8. **WebGPU headless.** WebGPU runs use Chrome via Playwright `channel: 'chrome'`, headless (adapter verified, C-106). First run after a fresh launch is reported as-is (shader compile is in chunk 1, B-5); the `sessionCreateMs` value is the cold-profile value. Whether a persistent-profile "return visit" is faster is **not** measured (out of scope; documented in the report).

### D-111 Perf harness (Vitest project `perf`) and throttling
- New Vitest project `perf` in `vitest.config.ts` (a *separate* project so firefox/webkit/golden-parity are unaffected — B-2): `include: ["perf/harness/**/*.perf.ts"]`, `browser.provider: playwright({ launchOptions: { channel: "chrome" } })`, `headless: true`, `instances: [{ browser: "chromium" }]`; `VITE_TEST_ISOLATE=1` for `wasm-mt`/`webgpu-*`, unset for `wasm-1t`. Script: `"test:perf": "vitest run --project perf"`. Harness files live in `perf/harness/`, **not** `tests/` (tools, not frozen tests; A-106).
- EP control: `webgpu-*` must resolve `executionProvider === "webgpu"` (else the record is invalid: D-103); `wasm-*` shadows `navigator.gpu` exactly as `tests/browser/golden-parity.test.ts` does.
- Input: `scripts/perf/make-input.py <seconds> <out.wav>` (numpy+soundfile; same recipe as `tests/fixtures/generate-golden-fixture.py`, `N = seconds·44100`); outputs `perf/input/*.wav` (git-ignored). `input.sha256` in each record.
- Result writing: `commands.writeFile` from `vitest/browser` (C-109, verify permission keys in S-103). **Fallback rule:** if the browser cannot write files, the test `console.log`s one line `PERFRECORD {json}` and the driver script `scripts/perf/collect.mjs` parses stdout into `perf/results/`. Either way the file content is identical.
- **Cold-cache proof.** Before each cold run assert `await caches.keys()` is empty and set `cacheCold = true` only then.
- **Throttle (T-029) — validity gate.** The only Chromium API is CDP `Network.emulateNetworkConditions` (deprecated but working) or `emulateNetworkConditionsByRule`; 50 Mbit/s = **6,250,000 B/s**, latency 20 ms (B-13). Use `cdp()` from `vitest/browser` (or a `defineBrowserCommand` fallback, B-14). Coverage of a Worker fetch and of the HF→CDN redirect is **unverified** (B-15). Therefore: (a) the perf harness calls `separate()` on the test page's main thread (as the old test did), so page-level throttling applies; (b) a run may be recorded with `throttleMbps: 50` **only if** the measured mean throughput over the download (`165,612,636 B / downloadMs`) is within **[0.80, 1.05] × 6.25 MB/s**; otherwise store the run with `throttleMbps: null` and `throttleVerified: false` — it then cannot support a T-029 verdict; (c) the report states that T-029 was measured on the main-thread path and that the Worker path was/was not verified (S-104 runs one Worker-path throughput spike; if it matches (b) the statement is "verified for the Worker path", else "main-thread path only").

### D-112 No figures
`figures/SPEC.md` is not created (recorded N/A); `perf/REPORT.md` contains tables only.

### D-113 Namespacing — see `PROFILE.md`.

## Part B — Divergence track

### D-105 Fixtures, chunk geometry and metrics (C-102, C-103)
- **Target input:** `tests/fixtures/diagnostic/golden-tones-mono-20s.wav` (recovered original; sha frozen by T-201). **Control input:** `tests/fixtures/golden-20s.wav` (the non-degenerate replacement; native-vs-WASM final rel. RMS 0.01–0.1 % per SP-3).
- Both runtimes always get the identical float32 input: the WAV decoded with `soundfile` to float32 (`int16/32768`), chunk *k* by `metrics.chunk_window` (start `(k−1)·257,985`, length 343,980, zero-padded), shape `(1,2,343980)` name `mix`. (SP-3 measured decoder differences ≤ 2.1e-6 per sample, ≪ the effect.)
- All metrics in float64 via `metrics.compare_arrays`: `rel_l2 = ‖ref−test‖₂/‖ref‖₂`, `max_abs`, `rms_*`. **Reference runtime = native ORT CPU EP; "test" = the other.** Which runtime is *correct* is decided only by the oracle (D-106 step D4), never by which is called reference.

### D-106 Investigation ladder and the outcome rule (Rule 8: procedure + criteria frozen, outcome not)
Frozen numbers (also in `scripts/divergence/metrics.py`, asserted by `test_metrics.py`): reproduction threshold **vocals rel_l2 ≥ 0.5**; oracle floor **2⁻²⁰ ≈ 9.54e-7**; oracle ratio **10**; bisection ratio τ **10**. Justification: floor — native fp32 vs float64 ReferenceEvaluator on five representative ops measured 3.3e-8…2.1e-7 (SP-9, C-113), i.e. ≥ 4.5× below the floor; ratio — an implementation is "inaccurate" only if it is > 10× worse than the other *and* above the floor; reproduction threshold — SP-3 recorded 119 %, SP-6 115 %, regenerated chord 0.23 %; 0.5 separates them by > 2×. These constants are `inferred` (engineering judgement, not literature) and are **not** to be tuned by the implementer; changing one requires a human at G-102.

**Ladder (each rung is a plan step; stop conditions below):**
- **D0 Reproduce (S-108).** Harness run, chunk 3, target input, `native` vs `wasm-node`. `is_reproduced(per_stem)` (vocals ≥ 0.5). Repeat once: `wasm-node` output must be bit-identical between the two runs (else record "non-deterministic" as a finding, continue). Also run the control input, chunk 3: record its per-stem numbers.
- **D0b Environment equivalence (S-108).** Same chunk in real Chrome (`scripts/divergence/run-wasm-browser.mjs`, Playwright `channel: 'chrome'`, single thread and, isolated, multi-thread). Record max abs diff vs `wasm-node`. Rule: browser ≠ Node materially (rel_l2 vs native differs > 2×) → the browser is the harness of record from then on (each later WASM run goes through the browser runner; the ladder continues, budget unchanged).
- **D1 Input sweep (S-108).** ≤ 30 variants of chunk 3 through a single native + single `wasm-node` session each: exact mono baseline; R = L + white noise σ ∈ {1e-7, 1e-6, 1e-5, 1e-4, 1e-3} (breaks exact mono); each tone alone and each pair; gain ×{0.1, 0.5, 2.0, 4.0} (clipped to ±1); chunks 1, 2, 4; start shifted by {−100, −1, +1, +100, +10,000} samples. Output: table of vocals rel_l2 and `is_reproduced` per variant. This identifies *trigger variables*, and is descriptive (no pass/fail).
- **D2 Third opinion (S-109).** Chunk 3, target input, additional runs: WebGPU EP in Chrome; native with 1 vs 4 intra-op threads; native with `session.set_denormal_as_zero=1` (the key exists natively on x86; ORT Web accepts but ignores it — C-2xx A-7..A-9; so this variation is native-only; if the key is rejected record "unsupported"); native fp32 model (`htdemucs.onnx`, sha `68d0bf16…`) vs native fp16-weights. Output: pairwise rel_l2 matrix. Evidence only — not the classifier.
- **D3 Profile bisection (S-109).** Expose milestone tensors by file (`--expose-file`): the last output of each module block prefix (`/tencoder.N`, `/encoder.N`, `/crosstransformer/…`, `/tdecoder.N`, `/decoder.N`) plus **every `LayerNormalization` output (26) and every `Softmax` output (10) in the whole graph** (few and small; the native and WASM LayerNorm kernels are known to differ — C-2xx / `research/HYPOTHESES.md` H-2) plus every `InstanceNormalization` output in the first two encoder blocks; skip tensors > 50 M elements (log them); for every exposed tensor also record the **fraction of subnormal float32 values** (`0 < |x| < 1.1754944e-38`) in each runtime's output (descriptive column for hypothesis H-3); ≤ 25 outputs per graph copy; both target and control inputs; both runtimes. Profile value per milestone = `rel_l2_target / max(rel_l2_control, 2⁻²⁰)`; `first_divergence(profile, τ=10)` → window W = (previous milestone, that milestone]. If no milestone exceeds τ, W = the last block. Then expose **every float tensor output of nodes in W** (≤ 400 tensors, batches of ≤ 25) and take the first node in W whose profile exceeds τ, plus the ≤ 4 nodes with the largest consecutive-ratio jump in W (max 5 candidates).
- **D4 Op-level isolation (S-110).** For each candidate node: build a single-node ONNX model from the node with **native's actual input tensors** (float32) as graph inputs; run native and `wasm-node`; build the float64 twin and run `onnx.reference.ReferenceEvaluator` (oracle; verified for InstanceNormalization/Conv/LayerNormalization/Erf/Softmax, C-113; other op types: if the evaluator lacks a float64 kernel, record "no oracle" and skip the node). `err_native`, `err_wasm` = rel_l2 vs oracle; `judge_op(err_native, err_wasm)`. The **decisive op** = the first candidate whose result ≠ `agree`; if all candidates `agree` → `op_result = "agree"`; if no candidate could be evaluated and budget remains → return to D3 with the next window; if budget is exhausted → `op_result = None`.
- **D5 Classify (S-110).** `classify_outcome(reproduced, op_result, budget_exhausted)` — the function is the classifier; its table is frozen by `test_classify_outcome`. Meanings: `NOT_REPRODUCED` — could not reproduce in Node or browser (D0/D0b); `AMPLIFICATION` — every candidate op is accurate on identical inputs, so the difference is accumulated rounding-level disagreement amplified by the network (both runtimes valid; the model is ill-conditioned on this input class); `WASM_OP_DEFECT` — the WASM implementation of the decisive op is > 10× less accurate than native and over the floor; `NATIVE_OP_DEFECT` — the reverse; `BOTH_OP_INACCURATE`; `UNRESOLVED` — budget exhausted before a decisive op.
- **Supporting evidence for `AMPLIFICATION`** (S-110, mandatory when that outcome is returned): perturb the native *input* by relative Gaussian noise ε ∈ {1e-7, 1e-6, 1e-5, 1e-4} (5 seeds) and record output vocals rel_l2 vs unperturbed native; report the implied amplification factor and compare with the WASM-vs-native first-block mismatch (D3). This is descriptive; it does not change the outcome.
- **Budget accounting.** Every harness/experiment invocation appends `{step, command, wall_s, utc}` to `research/divergence/BUDGET.md` (a markdown table). Budget = 6 steps (S-107…S-111 excluding docs) and Σ wall ≤ 4 h (A-103). When Σ wall ≥ 4 h, the ladder stops at the current rung and D5 runs with `budget_exhausted = True`.

### D-107 Harness design
`scripts/divergence/harness.py run …` (interface frozen by `test_harness_tiny.py`): Python orchestrates; native ORT in-process; `wasm-node` via `node scripts/divergence/run-wasm-node.mjs` (ORT Web 1.30 WASM, `numThreads = 1`, D-12 session options, per SP-6); intermediate tensors exposed by appending them to `graph.output` as untyped-shape FLOAT `ValueInfo` (SP-7; `onnx.utils.extract_model` is **not** usable — the model has no `value_info`); names passed by file. Both runtimes get D-12 options (`graph_optimization_level=disabled`, `enable_cpu_mem_arena=false`, `enable_mem_pattern=false`) and record them. `result.json` schema is frozen by the test (keys: `schema, model, input, reference, runtimes, per_stem, exposed, provenance`). Raw float32 dumps go to the `--out` dir (scratch or `research/divergence/raw/`, git-ignored — dumps are large; only `result.json` files and tables are committed).
Additional subcommands added by the implementer (`sweep`, `bisect`, `oracle`) get their own new tests (tiny model) before use; adding tests is permitted (then re-freeze).

### D-108 Python environment — see `scripts/divergence/requirements.txt` and `ENVIRONMENT.md`.

### D-109 Post-G-102 outcome actions (S-111) — binding table
| Outcome | Repo actions (S-111) | Not done |
|---|---|---|
| `NOT_REPRODUCED` | Document in `research/divergence/REPORT.md`; SP-3 addendum: "not reproducible with the recovered fixture in Node/Chrome on <date>"; keep the diagnostic fixture; risk R-1xx stays open. | No guard. |
| `AMPLIFICATION` | Known-limitation note in `README.md` ("exactly-mono, exactly-periodic synthetic input can produce large numerical disagreement between runtimes; ordinary music is unaffected in our tests"), cross-referenced from `HANDOFF.md`. If D1 shows exact L == R is **necessary** (noise σ ≤ 1e-5 on R removes reproduction) **and** the human answers `proceed` at G-102: add a non-blocking UI notice for exactly-mono input (new frozen test first). Otherwise docs only. | No inference workaround; no change to D-12. |
| `WASM_OP_DEFECT` / `NATIVE_OP_DEFECT` / `BOTH_OP_INACCURATE` | Write `research/divergence/UPSTREAM_ISSUE.md` (draft in microsoft/onnxruntime's issue-template shape with the minimal repro: single-node model + input tensor + expected/actual + versions); README known-limitation note; SP-3 addendum. | **Never file the issue** (G-103). No workaround in `src/`. |
| `UNRESOLVED` | Minimal repro package (harness command + fixture + the largest-jump window's node list) in `research/divergence/`; README note; risk stays open. | — |
All outcomes: the golden-parity test T-006 is unaffected (control fixture). The guard is documentation-level unless the row above says otherwise.

## Decision rules (3.2)

**Engineering forks**
- `npm ci` fails → delete `node_modules`, retry once; if it fails again `BLOCKED.md` (lockfile is the pin).
- Node cannot import `.ts` (older Node) → `BLOCKED.md` (Node v24.13.0 is pinned; do not add a transpiler dependency).
- A frozen test appears wrong → **do not edit it**; write `TEST_CHALLENGE.md` (item ID, evidence, proposed fix) and halt (protocol Test Challenge Rule).
- `commands.writeFile` unavailable → use the `PERFRECORD` stdout fallback (D-111).
- `channel: 'chrome'` yields no WebGPU adapter at run time (`navigator.gpu.requestAdapter()` null) → WebGPU configs are `unmeasured`; record the reason in `perf/REPORT.md`; do **not** fall back to WASM and label it WebGPU (`validateRunRecord` forbids it).
- Performance misses a target → record `fail`; do not tune, retry selectively, shorten input, or edit thresholds (A-109). Report it.
- Model download fails (network) → retry the run once after 60 s; second failure → stop, mark `unmeasured` with reason.
- `pip`/`npm` audit or install warnings → ignore unless install fails; no upgrades (pins are the point).

**Result-pivot rules (Rule 8)**
- *Timing anomalies:* run totals differ > 25 % within a config → D-110 rule 6. A 4-min WASM MT median > 16 min → verdict `fail` — record and continue; at G-101 the human decides (rescope thresholds / accept / optimise in a new plan).
- *Extrapolation vs measurement:* if a measured 4-min separation differs from the earlier extrapolation from the 20 s runs by > 10 %, report both and add a sentence noting the extrapolation method is unreliable on this machine; do not "fix" the measurement.
- *Divergence does not reproduce* → D0b browser check; if also absent → `NOT_REPRODUCED`; do not try to "make" it reproduce by altering the fixture beyond D1's declared variants.
- *Bisection finds nothing above τ before the final block* → W = last block (D3); continue per ladder.
- *Native and WASM disagree with the oracle in opposite directions* → the frozen `judge_op` rule decides; do not add ad-hoc oracles.
- *Oracle cannot be built for a node type* → skip it, log "no oracle: <op>", continue.
- *Result contradicts SP-3's numbers* (e.g. drums 33 % vs SP-3's 6 %): record both; no reconciliation attempt (different runtime host; D0b tests exactly this).

**Operational forks:** none (`software.deploys = false`).

**Default rule (unanticipated situations)**

> Choose the most reversible option that does not expand scope, log it in `DEVIATIONS.md` with rationale, and continue — **unless** it touches frozen tests, security, data integrity, a public interface, research integrity, or a threshold/constant named in this file, in which case halt and write `BLOCKED.md`.
