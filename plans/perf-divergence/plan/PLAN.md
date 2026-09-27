STATUS: PENDING-VERIFICATION (updated to READY or BLOCKED in Phase 5)

# PLAN — perf-and-divergence

Profiles: software, computational (see `PROFILE.md`). Read `../HANDOFF.md` first. IDs are namespaced (`S-1xx`, `T-1xx/2xx`, `D-1xx`, `C-1xx`, `A-1xx`, `G-1xx`, `R-1xx`).
Conventions for **every** step: run commands from the repo root in Git-Bash; Python = the venv interpreter from `ENVIRONMENT.md` (`$PY`); prefix Python test runs with `PYTHONDONTWRITEBYTECODE=1` and `-p no:cacheprovider`; never edit a frozen test (it is under `tests/` and listed in `tests/FROZEN_MANIFEST.sha256`); before ending any step run `npm run verify:frozen` and `npm run typecheck`. After each step append its ID to `completed` in `plans/perf-divergence/.checkpoints/state.json` and commit (`checkpoint: S-1xx`). The implementer works on branch `impl/perf-divergence` created from the tip of the generation branch; it may push that branch (never `main`, no PR — G-103).

**Serial machine rule (D-110):** S-104 and S-105 must run with nothing else CPU-heavy. Order of execution is exactly S-101 → S-102 → S-103 → S-107 → S-104 → S-105 → S-106 (G-101) → S-108 → S-109 → S-110 (G-102) → S-111 → S-112. (S-107 is code-only and runs before the measurements so no coding happens between measurement steps.)

Compute budget: perf ≤ 4 h wall (estimate ≈ 2.3 h: 20 s matrix ≈ 40 min; 4-min matrix ≈ 100 min); divergence ≤ 4 h (A-103).

---

### S-101 Environment bring-up and red baseline
- Tier: Haiku
- Profile: software
- Depends on: none
- Inputs: repo at the generation-branch tip; `plans/perf-divergence/plan/ENVIRONMENT.md`
- Actions:
  1. `git fetch origin && git checkout <generation branch> && git checkout -b impl/perf-divergence`.
  2. Run the setup commands of `ENVIRONMENT.md` (npm ci; venv at `../stem-splitter-venv`; pinned pip install). If the venv's `python.exe` is missing, re-run `python -m venv ../stem-splitter-venv` (restores launchers; packages survive).
  3. `npm run verify:frozen` → must print success (exit 0).
  4. `npm run typecheck` → exit 0.
  5. `npm test 2>&1 | tail -8` → expect `54 passed` from pre-existing files and `65 failed` from the four `perf-*.test.ts` files.
  6. `PYTHONDONTWRITEBYTECODE=1 $PY -m pytest tests/divergence -p no:cacheprovider -q 2>&1 | tail -3` → expect `44 failed, 4 passed, 5 errors`.
  7. `node plans/perf-divergence/research/spikes/sp4-webgpu.mjs` → the two `channel chrome` headless entries must show `"adapter": true`.
  8. Write the observed counts to `plans/perf-divergence/.checkpoints/baseline.txt`.
- Outputs: `plans/perf-divergence/.checkpoints/baseline.txt`; `impl/perf-divergence` branch
- Evidence produced: none
- Done when: steps 3–7 outputs match the expectations above (counts may differ only if the frozen tests were legitimately extended; then record and explain in `DEVIATIONS.md`)
- Checkpoint: `completed += S-101`; record Node/npm/Chrome versions seen
- On failure: step 7 shows no adapter → WebGPU configs become `unmeasured` (rule in DECISIONS "Engineering forks"); continue. Any other mismatch → `BLOCKED.md`.
- Gate: none
- Relevant decisions/claims: D-110, C-106, C-108

### S-102 Implement statistics and the phase timeline
- Tier: Sonnet
- Profile: software, computational
- Depends on: S-101
- Inputs: `src/perf/stats.ts`, `src/perf/timeline.ts` (stubs), `tests/unit/perf-stats.test.ts`, `tests/unit/perf-timeline.test.ts`, `src/dsp/chunk.ts`
- Actions:
  1. Implement `quantile`, `summarizeDistribution`, `chunkCountForDuration` (imports `planChunks` from `"../dsp/chunk.ts"`), `extrapolateSeparationMs` exactly per D-104. Validation errors are `RangeError`.
  2. Implement `PhaseTimeline.record/summarize` exactly per D-101 (phase segmentation, boundary rules, validation). Keep the two files free of runtime imports other than `../dsp/chunk.ts`; `import type` is fine.
  3. Remove the "STUB" comments.
  4. Verify Node can execute them unbuilt: `node -e "import('./src/perf/stats.ts').then(m=>console.log(m.chunkCountForDuration(240)))"` → prints `42`.
- Outputs: `src/perf/stats.ts`, `src/perf/timeline.ts`
- Evidence produced: T-101, T-102, T-103, T-104, T-105, T-106 pass
- Done when: `npx vitest run --project node tests/unit/perf-stats.test.ts tests/unit/perf-timeline.test.ts` → all pass; the `node -e` command prints `42`; `npm run typecheck` clean; `npm run verify:frozen` green
- Checkpoint: completed += S-102
- On failure: a test seems wrong → do **not** edit it; `TEST_CHALLENGE.md` and halt. Otherwise fix code (max 5 iterations), then `BLOCKED.md`.
- Gate: none
- Relevant decisions/claims: D-101, D-104, C-101, C-108

### S-103 Validation, thresholds, perf harness and input generator
- Tier: Sonnet
- Profile: software, computational
- Depends on: S-102
- Inputs: `src/perf/report.ts` (stub), `tests/unit/perf-report.test.ts` (T-107, T-108 in scope here), `vitest.config.ts`, `src/separate.ts`, `src/model/cache.ts`, `tests/browser/golden-parity.test.ts` (pattern for shadowing `navigator.gpu`), `tests/fixtures/generate-golden-fixture.py`, `.gitignore`
- Actions:
  1. In `src/perf/report.ts` set `TARGET_THRESHOLDS_MS` to the frozen values (`T-027` 960000, `T-027-M1` 360000, `T-028-separation` 90000, `T-028-session` 60000, `T-029` 45000, `T-030` 480000) and `MIN_RUNS_PER_VERDICT = 3`; implement `validateRunRecord` per D-102/D-103 (all problems returned as strings naming the offending path, e.g. `provenance.gitCommit`, `threadCount`, `executionProvider`, `chunkCount`, `chunkMs`, `sessionCreateMs`, `models`, `throttleMbps`, `schema`; never throws; unknown extra keys allowed; `gitCommit` is 40 hex; `lockfileSha256`/`input.sha256` are 64 hex). Leave `evaluateTargets`/`renderReport` as stubs.
  2. `scripts/perf/make-input.py <seconds> <out.wav>`: copy the signal recipe from `tests/fixtures/generate-golden-fixture.py` with `N = int(seconds*44100)` and `default_rng(7)`; 16-bit stereo; print the sha256. Add `perf/input/` to `.gitignore`. Verify: `$PY scripts/perf/make-input.py 240 perf/input/synthetic-240s.wav` prints a sha and the file is 42,336,044 bytes (240·44100·4 + 44).
  3. Add Vitest project `perf` to `vitest.config.ts` per D-111 (separate project; `channel: 'chrome'`; include `perf/harness/**/*.perf.ts`; keep `server.headers` behaviour driven by `VITE_TEST_ISOLATE`). Add npm script `"test:perf": "vitest run --project perf"`. `npm run test:browser` and `npm test` must be unaffected (`--project` filters).
  4. `perf/harness/run.perf.ts`: reads `import.meta.env.VITE_PERF_CONFIG` (`wasm-1t|wasm-mt|webgpu-standard|webgpu-hq`), `VITE_PERF_INPUT` (path under repo root), `VITE_PERF_COLD` (`1` = cold cache run), `VITE_PERF_THROTTLE_MBPS` (optional), `VITE_PERF_RUN_ID` (optional). It: decodes the input (`decodeTo44k`); asserts the requested EP is reachable (WebGPU adapter for `webgpu-*`; shadow `navigator.gpu` for `wasm-*` as in golden-parity); if cold: asserts `(await caches.keys()).length === 0`, applies the throttle via `cdp()` (D-111), else warms the cache first with an untimed `getModel(MODELS[STANDARD_MODEL])` (and, for `webgpu-hq`, the four specialists); runs `separate(left, right, mode, { onProgress })` feeding every event to a `PhaseTimeline` with `performance.now()`; builds a `RunRecord` (`gitCommit` from the `VITE_GIT_SHA` define or `git rev-parse HEAD` supplied by the driver as `VITE_PERF_GIT`, `lockfileSha256` from `VITE_PERF_LOCK`, browser from `navigator.userAgent`, `cpuModel`/`os` from `VITE_PERF_CPU`/`VITE_PERF_OS`, `logicalCores` from `navigator.hardwareConcurrency`, `acPower` from `VITE_PERF_AC`), validates it with `validateRunRecord` (throw on problems), and writes `perf/results/<id>.json` atomically via `commands.writeFile` (fallback: print one line `PERFRECORD {json}` — D-111). For a throttled run also computes throughput and sets `throttleMbps` per the validity gate in D-111. Removes the throttle in a `finally`.
  5. `scripts/perf/run-matrix.mjs <plan.json>`: a driver that executes a list of runs sequentially in fresh `vitest` processes with the cool-downs of D-110, sets the `VITE_PERF_*` env (git sha via `git rev-parse HEAD`; lockfile sha via `sha256sum package-lock.json`; CPU via `wmic cpu get Name /value`; AC via `wmic path Win32_Battery get BatteryStatus /value` == 2), starts `typeperf "\Processor Information(_Total)\Processor Frequency" -si 1 -o <tmp>.csv` beside each run and merges min/first/last MHz into the record as `cpuMHzMin/Before/After`, and (fallback path) parses `PERFRECORD` lines. It never runs two runs concurrently. **Plan-file format** (`matrix-*.json`): `{"cooldownS":60,"longCooldownS":180,"runs":[{"config":"wasm-mt","input":"tests/fixtures/golden-20s.wav","cold":false,"throttleMbps":null,"repeat":1}, ...]}`; each entry is one run in the listed order; the run id is `<config>-<basename of input without extension>-<cold|warm>-r<repeat>-<UTC yyyymmddThhmmss>`; a run is skipped if a record whose id starts with `<config>-<input>-<cold|warm>-r<repeat>-` already exists (resume). `longCooldownS` is applied after any run whose `total` exceeded 600 s.
  5b. Add `"perf"` to the `include` array of `tsconfig.json` so `npm run typecheck` covers `perf/harness/`.
  6. `scripts/perf/validate.ts <file...>`: prints `OK <file>` or the problems; exit 1 on any problem.
  7. Smoke: `VITE_TEST_ISOLATE=1 VITE_PERF_CONFIG=webgpu-standard VITE_PERF_INPUT=tests/fixtures/golden-20s.wav npx vitest run --project perf` (expect ≈ 1–2 min) then `node scripts/perf/validate.ts perf/results/*.json` → `OK`. Keep the record (it is a legitimate `webgpu-standard` 20 s run).
- Outputs: `src/perf/report.ts` (partial), `scripts/perf/make-input.py`, `scripts/perf/run-matrix.mjs`, `scripts/perf/validate.ts`, `perf/harness/run.perf.ts`, `vitest.config.ts`, `package.json`, `.gitignore`, one `perf/results/*.json`
- Evidence produced: T-107, T-108 pass
- Done when: `npx vitest run --project node tests/unit/perf-report.test.ts -t "frozen thresholds|validateRunRecord"` passes; step-7 smoke produces a record that `validate.ts` accepts and that shows `executionProvider: "webgpu"`; `npm test` still shows the same 54 pre-existing passes
- Checkpoint: completed += S-103; note whether the `commands.writeFile` path or the `PERFRECORD` fallback is in use
- On failure: `cdp()` permission error → try `defineBrowserCommand` route (B-14); if still failing, throttled runs are impossible → T-029 `unmeasured`, continue. `commands.writeFile` refused → fallback. WebGPU adapter null → `webgpu-*` `unmeasured`.
- Gate: none
- Relevant decisions/claims: D-102, D-103, D-110, D-111, C-106, C-107, C-109, B-1, B-2, B-13..B-16

### S-107 Implement the divergence metrics and harness
- Tier: Sonnet
- Profile: software, computational
- Depends on: S-101 (runs after S-103 in execution order; touches no perf state)
- Inputs: `scripts/divergence/metrics.py`, `scripts/divergence/harness.py` (stubs), `tests/divergence/*`, the spike scripts in `plans/perf-divergence/research/spikes/` - `sp6-native.py`, `sp6-node-wasm.mjs`, `sp6-compare.py`, `sp7-extract.py`, `sp7-run-native.py`, `sp7-run-wasm-node.mjs`, `sp9-oracle.py` (reference implementations; read `SPIKES.md` first), `src/dsp/chunk.ts`
- Actions:
  1. `metrics.py`: set `SEGMENT_SAMPLES=343_980`, `STRIDE_SAMPLES=257_985`, `REPRODUCED_MIN_VOCALS_REL_L2=0.5`, `JUDGE_FLOOR=2**-20`, `JUDGE_RATIO=10.0`; implement every function per its docstring and D-105/D-106 (float64 arithmetic; `ValueError` on bad input; `judge_op` rejects negative/NaN; `classify_outcome` table exactly as `test_classify_outcome`).
  2. `scripts/divergence/run-wasm-node.mjs <model> <in.f32> <outprefix> [--expose-file names.txt]`: ORT Web (`onnxruntime-web` from `node_modules`), `numThreads = 1`, session options `{executionProviders:["wasm"], graphOptimizationLevel:"disabled", enableCpuMemArena:false, enableMemPattern:false}`; writes each output to `<outprefix>.<i>.f32` and prints one JSON line with output names, shapes, `create_s`, `run_s`, ORT Web version (`ort.env.versions.web`).
  3. `harness.py run …` per D-107 and `test_harness_tiny.py` (arguments `--model --wav --chunk --runtimes native,wasm-node|native --out [--expose-file]`; native run uses D-12 options via `SessionOptions`; result.json keys/values as the test asserts; exit non-zero with a message containing the offending path or the word "chunk" on bad input). Exposure = append names from the file to `graph.output` as FLOAT with unknown shape and save `exposed.onnx` in `--out` (never `onnx.utils.extract_model`).
  4. `git rev-parse HEAD`, `sha256` of `scripts/divergence/requirements.txt`, `node -v`, `ort.env.versions.web`, `platform.platform()`, UTC time go into `provenance`.
- Outputs: the three files above (+ `.gitignore` entry `research/divergence/raw/`)
- Evidence produced: T-202, T-203, T-204, T-205 pass
- Done when: `PYTHONDONTWRITEBYTECODE=1 $PY -m pytest tests/divergence -p no:cacheprovider -q` → `all passed` (T-201's 4 tests included); `npm run verify:frozen` green; `git status --porcelain tests/` shows no `__pycache__`/`.pytest_cache`
- Checkpoint: completed += S-107
- On failure: `pytest` error in `test_harness_tiny` due to a missing `node_modules` → `npm ci`; ORT Web fails to load under Node → `BLOCKED.md` (C-105 says it worked at planning time).
- Gate: none
- Relevant decisions/claims: D-105, D-106, D-107, C-102..C-105, C-113

### S-104 Measure: 20 s clip matrix, cold download, throttle validity, content check
- Tier: Sonnet (long-running; idempotent per run)
- Profile: computational
- Depends on: S-103, S-107 (no coding during this step)
- Inputs: `scripts/perf/run-matrix.mjs`, `perf/harness/run.perf.ts`, `tests/fixtures/golden-20s.wav`
- Actions:
  1. Apply the machine controls of `ENVIRONMENT.md` / D-110 (record the previous power scheme GUID in `perf/results/POWER.txt`; `powercfg /setactive SCHEME_MIN`).
  2. **Throttle spike (T-029 validity).** Run one cold, throttled run on the main-thread path: `VITE_PERF_COLD=1 VITE_PERF_THROTTLE_MBPS=50 VITE_PERF_CONFIG=wasm-mt VITE_TEST_ISOLATE=1 VITE_PERF_INPUT=tests/fixtures/golden-20s.wav`. Compute `165612636 / (downloadMs/1000)`; the gate is `[0.80, 1.05] × 6,250,000` B/s. Record the achieved rate in `perf/results/THROTTLE.md`. Then do the Worker-path probe: a 20-line variant of the harness that performs the same download inside a dedicated `Worker` and reports throughput; record whether it is within the gate. Both outcomes are legitimate (D-111 (c)).
  3. **Matrix.** `node scripts/perf/run-matrix.mjs plans/perf-divergence/plan/matrix-20s.json` where the file lists (in this order, interleaved): `[wasm-1t, wasm-mt, webgpu-standard]` × 5 repeats, warm-cache, input `tests/fixtures/golden-20s.wav`; then 3 cold+throttled (if the gate passed) `wasm-mt` runs. Create `matrix-20s.json` from this description first and commit it.
  4. **Content-dependence check (A-107).** Generate a second 20 s signal `$PY scripts/perf/make-input.py 20 perf/input/synthetic-20s.wav`; run `wasm-mt` ×3 on it and compare medians of steady chunk time with the golden-20s `wasm-mt` runs. Record the ratio in `perf/results/CONTENT.md`; > 10 % difference triggers the A-107 rule.
  5. Apply D-110 rules 6–7 (drift, abort). Validate: `node scripts/perf/validate.ts perf/results/*.json`.
  6. Commit `perf/results/` (JSON + the small `.md` notes) — `perf/input/` is ignored.
- Outputs: `perf/results/*.json`, `POWER.txt`, `THROTTLE.md`, `CONTENT.md`, `plans/perf-divergence/plan/matrix-20s.json`
- Evidence produced: run records for PD-SC-2 (20 s runs are indicative; no verdicts)
- Done when: ≥ 5 valid `wasm-1t`, ≥ 5 `wasm-mt`, ≥ 5 `webgpu-standard` 20 s records exist (or the D-110 reason for fewer is recorded in `perf/results/NOTES.md`); `validate.ts` OK on all; throttle statement written
- Checkpoint: after **each run** the driver skips runs whose record file already exists (resume = re-run the same command); record `completed_runs` count
- On failure: per D-110 rule 7 and "Engineering forks"; never delete or overwrite a record; an invalid/aborted run is kept under a `-invalid` id and excluded automatically
- Gate: none
- Relevant decisions/claims: A-102, A-107, D-102, D-110, D-111, B-3, B-5..B-9, B-11, B-13..B-16

### S-105 Measure: real 4-minute runs (T-027, T-028, T-030)
- Tier: Sonnet (long-running; idempotent per run)
- Profile: computational
- Depends on: S-104
- Inputs: `scripts/perf/run-matrix.mjs`, generated `perf/input/synthetic-240s.wav`
- Actions:
  1. Ensure `$PY scripts/perf/make-input.py 240 perf/input/synthetic-240s.wav` has been run; record the sha256 it prints in `perf/results/INPUT.md`.
  2. Create `plans/perf-divergence/plan/matrix-240s.json`: interleaved order `wasm-mt, webgpu-standard, webgpu-hq` × 3 repeats (warm cache), then one `wasm-1t` (informational), input `perf/input/synthetic-240s.wav`. Expected wall: wasm-mt ≈ 15 min each, webgpu-standard ≈ 2 min, webgpu-hq ≈ 7 min, wasm-1t ≈ 25 min; ≈ 100 min total. HQ needs the four specialist models (~166 MB each) cached — the harness warms them untimed on first use.
  3. Run `node scripts/perf/run-matrix.mjs plans/perf-divergence/plan/matrix-240s.json`. Apply D-110 rules 3, 6, 7 (180 s cool-down after each ≥ 10-min run).
  4. `node scripts/perf/validate.ts perf/results/*.json`.
  5. **Finalisation (always, even on abort):** restore the power scheme recorded in `perf/results/POWER.txt` with `powercfg /setactive <GUID>`.
  6. Commit `perf/results/`.
- Outputs: 10 `perf/results/*.json` (3+3+3+1) plus notes
- Evidence produced: records feeding T-027, T-028, T-030 verdicts
- Done when: ≥ 3 valid `wasm-mt`, ≥ 3 `webgpu-standard`, ≥ 3 `webgpu-hq` records with `input.durationSeconds === 240` exist, or the D-110 rule-7 reason for fewer is written to `perf/results/NOTES.md`; power scheme restored (`powercfg /getactivescheme` equals the recorded GUID)
- Checkpoint: as S-104 (per-run resume)
- On failure: D-110 rule 7. A target miss is **not** a failure of this step.
- Gate: none (G-101 follows in S-106)
- Relevant decisions/claims: D-103, D-110, A-108, A-109, B-5..B-9

### S-106 Verdicts, report, supersede PERF.md, gate G-101
- Tier: Opus
- Profile: software, computational
- Depends on: S-105
- Inputs: `src/perf/report.ts`, `perf/results/*.json`, `tests/unit/perf-report.test.ts`, `tests/unit/perf-record.test.ts`, `tests/PERF.md`
- Actions:
  1. Implement `evaluateTargets` and `renderReport` per D-103 (deterministic; sorted by `id`; minutes = `(ms/60000).toFixed(1)`, seconds = `(ms/1000).toFixed(1)`; includes: provenance table (short commit, CPU, browser, ORT, AC/"AC power not recorded"), per-config table (n, first-chunk, steady median + IQR, total), the five verdict rows with `basis`, an "Indicative extrapolations — not a verdict" section, a "Known limitations" section (T-027-M1 unmeasured — no M1; WebGPU return-visit not measured; throttle path statement from `THROTTLE.md`), and a "Human decisions" placeholder section that S-106 leaves empty). `renderReport` throws `Error` containing "invalid" for an invalid record.
  2. `scripts/perf/report.ts`: reads `perf/results/*.json` sorted, calls `renderReport`, writes `perf/REPORT.md` (LF line endings, single trailing newline). Add npm script `"perf:report": "node scripts/perf/report.ts"`. Run it.
  3. Prepend to `tests/PERF.md` a banner (≤ 12 lines total before the original title): `SUPERSEDED` (uppercase), the date of the replacement, the sentence "The timer started after the first chunk (the model-ready mark was set at `completed === 1`), so the 'separation' interval covered 3 chunks but was divided by 4; see `perf/REPORT.md` for the corrected, generated figures", a pointer `perf/REPORT.md`. **Do not edit the original body** (T-112 asserts the original numbers remain).
  4. Run `npx vitest run --project node` → all pass. Run `npm run verify:frozen`.
  5. Write `plans/perf-divergence/GATE-G-101.md` per `GATES.md` (paste the verdict table by including `perf/REPORT.md` sections mechanically, e.g. with a small script; do not retype numbers). Commit. **HALT.**
- Outputs: `src/perf/report.ts`, `scripts/perf/report.ts`, `perf/REPORT.md`, `tests/PERF.md` (banner), `package.json`, `GATE-G-101.md`
- Evidence produced: T-109, T-110, T-111, T-112, T-113 pass
- Done when: `npx vitest run --project node` exits 0 (all pre-existing + all `perf-*` tests); `node scripts/perf/report.ts && git diff --exit-code perf/REPORT.md` shows no change after regeneration
- Checkpoint: completed += S-106; `gates.G-101 = "awaiting human"`
- On failure: T-113 fails because `REPORT.md` ≠ `renderReport` → regenerate, never hand-edit. A verdict looks surprising → do not adjust; the gate is where it is discussed.
- Gate: **G-101**
- Relevant decisions/claims: D-102, D-103, D-104, A-101, A-109, C-101

### S-108 Divergence rungs D0, D0b, D1
- Tier: Sonnet
- Profile: computational
- Depends on: S-106 signed off with `proceed`/`proceed-with-rescope` **or** G-101 not yet answered but no measurement running (A-104 lets the tracks be independent; still obey D-110 rule 1). Also S-107.
- Inputs: `scripts/divergence/*`, `tests/fixtures/diagnostic/golden-tones-mono-20s.wav`, `tests/fixtures/golden-20s.wav`, cached model `htdemucs_fp16weights.onnx` (`~/.cache/huggingface/hub/models--StemSplitio--htdemucs-onnx/snapshots/*/htdemucs_fp16weights.onnx`, sha `d05c269d…` — verify with `sha256sum`; if absent, `hf_hub_download`/`curl` the URL in `src/model/hub.ts`)
- Actions:
  1. Create `research/divergence/` with `BUDGET.md` (table `step | command | wall_s | utc`), and `raw/` (git-ignored). Log **every** command below into `BUDGET.md`.
  2. **D0:** `$PY scripts/divergence/harness.py run --model <model> --wav tests/fixtures/diagnostic/golden-tones-mono-20s.wav --chunk 3 --runtimes native,wasm-node --out research/divergence/raw/d0-target` twice (`d0-target`, `d0-target-repeat`); compare the two `wasm-node_chunk3.f32` files byte-wise (`cmp`); run the control (`tests/fixtures/golden-20s.wav`, chunk 3, `d0-control`). Copy the three `result.json` to `research/divergence/d0-*.json`. Evaluate `metrics.is_reproduced` on the target and the control and record both.
  3. **D0b:** implement `scripts/divergence/run-wasm-browser.mjs` (Playwright `chromium.launch({channel:"chrome"})`, page served from a tiny `http://localhost` server with COOP/COEP headers for the multi-thread variant, loads `onnxruntime-web` 1.30.0 via `wasmPaths` pointing at `node_modules/onnxruntime-web/dist/`, same D-12 options, same `in_chunk3.f32`); run single-thread and multi-thread; compare with `wasm-node_chunk3.f32` using `metrics.compare_arrays` and record max abs diff and rel_l2 vs native. Apply the D0b rule (D-106).
  4. **D1:** add a `sweep` subcommand to `harness.py` **with a new test on the tiny model first** (`tests/divergence/test_sweep_tiny.py`; then `node scripts/frozen-manifest.mjs --write`), creating each runtime session once and iterating variants; run the D-106 D1 variant list on the target chunk; write `research/divergence/d1-sweep.json` and a markdown table `research/divergence/d1-sweep.md` (variant, vocals rel_l2, is_reproduced).
  5. If D0 **and** D0b both fail to reproduce → skip to S-110's classification with `reproduced=False` (rules in D-106); still write the report.
- Outputs: `research/divergence/{BUDGET.md,d0-*.json,d0b.json,d1-sweep.json,d1-sweep.md}`, `scripts/divergence/run-wasm-browser.mjs`, `tests/divergence/test_sweep_tiny.py`
- Evidence produced: D0/D0b/D1 records (C-102 confirmation or refutation; not a `T-` test)
- Done when: the files above exist and validate as JSON; `BUDGET.md` totals are present; `pytest tests/divergence` all passed; `npm run verify:frozen` green
- Checkpoint: completed += S-108; `divergence_budget_used_s`
- On failure: D-106 rules (browser fallback; `NOT_REPRODUCED`); budget exhausted → S-110 with `budget_exhausted=True`.
- Gate: none
- Relevant decisions/claims: D-105, D-106, D-107, A-103, A-105, C-102, C-103, C-105

### S-109 Divergence rungs D2 (third opinion) and D3 (profile bisection)
- Tier: Opus (analysis) with Sonnet for mechanical runs
- Profile: computational
- Depends on: S-108
- Inputs: S-108 outputs; `scripts/divergence/*`; fp32 model `htdemucs.onnx` (sha `68d0bf16428ef66e692cdff8a9ccf28f1ef3f69440d57e58605a4cc55fcc5e74`, in the HF cache); `research/rounds` note on `session.set_denormal_as_zero`
- Actions:
  1. **D2:** run and record (each as a `result.json` under `research/divergence/d2-*.json`): WebGPU EP in Chrome (extend `run-wasm-browser.mjs` with `--ep webgpu`); native with `intra_op_num_threads` 1 and 4; native with `session.set_denormal_as_zero=1` (`SessionOptions.add_session_config_entry("session.set_denormal_as_zero", "1")`; if the runtime raises, record "unsupported"); native fp32 model vs native fp16-weights model. Build the pairwise rel_l2 matrix (vocals + all stems) in `research/divergence/d2-matrix.md`.
  2. **D3:** generate the milestone tensor name list from the model with a small script (`scripts/divergence/milestones.py`, with a unit test on the tiny model added first + re-freeze) following D-106 D3; write names to files (never argv); run both runtimes for target and control (`--expose-file`), batches ≤ 25 outputs; compute the ratio profile and `first_divergence(profile, 10)`; write `research/divergence/d3-profile.json` and `.md`. Define W. Then run the node-level exposure inside W (≤ 400 tensors, batches ≤ 25) and pick the ≤ 5 candidates by D-106; write `d3-candidates.json`.
  3. Log every command in `BUDGET.md`; stop and go to S-110 with `budget_exhausted=True` when Σ wall ≥ 4 h.
- Outputs: `research/divergence/d2-*.json`, `d2-matrix.md`, `d3-*.json`, `d3-*.md`, `scripts/divergence/milestones.py` (+ its test)
- Evidence produced: D2/D3 records
- Done when: D2 matrix exists (or "skipped: budget"); `d3-candidates.json` lists 1–5 nodes (or documents why none); `BUDGET.md` updated
- Checkpoint: completed += S-109
- On failure: memory errors when exposing → lower batch size to 10, then 5; if a single tensor cannot be exposed, skip it and log; ORT Web `RangeError: Array buffer allocation failed` → same.
- Gate: none
- Relevant decisions/claims: D-106, D-107, C-104, C-110, C-112

### S-110 Op-level isolation, classification, report, gate G-102
- Tier: Opus
- Profile: computational
- Depends on: S-109
- Inputs: `d3-candidates.json`, harness, `metrics.py`
- Actions:
  1. **D4:** for each candidate node build the single-node model (native's real inputs, exposed in S-109 or re-run to capture them), run native and `wasm-node`, build the float64 twin and run `onnx.reference.ReferenceEvaluator` (add `scripts/divergence/oracle.py` **with a new tiny test first**; reuse `sp9-oracle.py`); compute `err_native`, `err_wasm`; `judge_op`. Record per candidate in `research/divergence/d4-ops.json` and `.md`.
  2. **D5:** `metrics.classify_outcome(reproduced, op_result, budget_exhausted)` where `op_result` is the first non-`agree` judgement, else `"agree"` if all evaluated candidates agreed, else `None`. Write the outcome name into `research/divergence/outcome.json` (with the inputs used).
  3. If the outcome is `AMPLIFICATION` run the perturbation table (D-106).
  4. Write `research/divergence/REPORT.md` (structure per `GATES.md` G-102 evidence bundle; every number pasted from the JSON via a small generator script `scripts/divergence/report.py` — no hand-typed results).
  5. Write `plans/perf-divergence/GATE-G-102.md`; commit; **HALT**.
- Outputs: `research/divergence/{d4-ops.json,d4-ops.md,outcome.json,REPORT.md}`, `scripts/divergence/{oracle.py,report.py}` (+ tests), `GATE-G-102.md`
- Evidence produced: PD-SC-3
- Done when: `outcome.json` names one of the six outcomes; `REPORT.md` exists and regenerates identically from the JSON (`$PY scripts/divergence/report.py && git diff --exit-code research/divergence/REPORT.md`); all tests green; freeze verified
- Checkpoint: completed += S-110; `gates.G-102 = "awaiting human"`
- On failure: no oracle for a node type → skip and log; all candidates without oracle and budget left → return to D3 with the next window once; then `UNRESOLVED`.
- Gate: **G-102**
- Relevant decisions/claims: D-106, D-109, A-103, A-104, C-113

### S-111 Outcome actions (after G-102 `proceed`)
- Tier: Sonnet
- Profile: software
- Depends on: S-110 and the human reply
- Inputs: `outcome.json`, D-109 table, `GATE-G-102.md` reply
- Actions:
  1. Read the outcome and the human reply. Execute **only** the D-109 row for the outcome (and the rescope text if any): README known-limitation note; UPSTREAM_ISSUE draft (never file it — G-103) using the microsoft/onnxruntime issue-template fields recorded in `research/rounds/round-1-A.md`; minimal-repro package for `UNRESOLVED`; the exactly-mono UI notice **only** if D-109 and the human say so — then first add a new frozen test in `tests/browser/` or `tests/unit/`, red-verify it, then implement, then `node scripts/frozen-manifest.mjs --write`.
  2. Append (never rewrite) an addendum to `research/spikes/SP-3.md`: date, "the original fixture is recoverable from git 729c249 (sha …)", the outcome and pointer to `research/divergence/REPORT.md`, and that SP-3's "drums 6 %" etc. came from the browser while Node numbers are in `d0-target.json` (numbers pasted from JSON).
  3. Run `npm test`, `npm run typecheck`, `npm run verify:frozen`, `npm run build`, pytest.
- Outputs: per D-109 (README.md, `research/divergence/UPSTREAM_ISSUE.md`, `research/spikes/SP-3.md` addendum, possibly `src/`+tests)
- Evidence produced: PD-SC-4 (guard decision executed)
- Done when: the D-109 row's artifacts exist; all fast checks green
- Checkpoint: completed += S-111
- On failure: a guard needs a `src/` change beyond the D-109 notice → `BLOCKED.md` (new plan).
- Gate: none (G-102 already given); any external action → G-103
- Relevant decisions/claims: D-109, A-104

### S-112 Housekeeping, final verification, handoff back to the app plan
- Tier: Sonnet
- Profile: software
- Depends on: S-106 (G-101 answered), S-111
- Inputs: `HANDOFF.md`, `plan/PLAN.md` (app), `.checkpoints/state.json` (app), `plans/perf-divergence/.checkpoints/state.json`
- Actions:
  1. In the **app's** `HANDOFF.md`, replace the "Before G-002 → WebGPU and M1 performance" bullet with a pointer to `perf/REPORT.md` (no numbers) and record the residual gap `T-027-M1 unmeasured` per the G-101 answer; add a pointer to `research/divergence/REPORT.md` next to the SP-3 bullet.
  2. In the app's `plan/PLAN.md` status header and `.checkpoints/state.json` `notes`, add one line each pointing to `plans/perf-divergence/` and G-101/G-102 outcomes (verbatim from the `GATE-*.md` replies).
  3. `node scripts/frozen-manifest.mjs --write` **only if** tests were added; then `npm run verify:frozen`.
  4. Full verification: `npm run typecheck && npm test && npm run build && npm run verify:frozen && PYTHONDONTWRITEBYTECODE=1 $PY -m pytest tests/divergence -p no:cacheprovider -q && node scripts/perf/report.ts && git diff --exit-code perf/REPORT.md`.
  5. `git push -u origin impl/perf-divergence` (branch push only). Write `plans/perf-divergence/DONE.md` listing: verdict table pointer, divergence outcome, open risks, and "Not done (G-103): merge, PR, upstream issue, deployment". **Do not open a PR, merge, deploy or file an issue.**
- Outputs: updated docs/state; `DONE.md`
- Evidence produced: PD-SC-5
- Done when: step-4 command chain exits 0; `git status --porcelain` empty except ignored files
- Checkpoint: completed += S-112; `status = "complete-pending-G-103"`
- On failure: any check red → fix code/docs (not frozen tests); after 3 attempts `BLOCKED.md`.
- Gate: none (G-103 is human-only and outside this plan)
- Relevant decisions/claims: D-102, A-101, A-104
