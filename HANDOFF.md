# HANDOFF

Start with `plan/REVIEW.md` (why the original plan changed), then
`plan/PLAN.md`'s "Implementation status" section for what's built. Do
**not** create `.github/workflows/deploy.yml` until gate G-002 is signed
off; the template lives in `plan/templates/deploy.yml`.

**Current status: S-001–S-007 implemented and verified (CI green, browser
suite executed, T-006 passing). S-008 (deploy) is gated on G-002 and not
started.**

## What is verified

- `npm test` (54 Node unit tests), `npm run typecheck`, `npm run build`,
  `npm audit`, `npm run verify:frozen`, and the browser suite on
  chromium/firefox/webkit run in `.github/workflows/tests.yml` — green on
  the last pushed commit. (Local WebKit on Windows can't run the decode
  tests: no `OfflineAudioContext` there; CI's Linux WebKit can.)
- T-006 golden parity: `VITE_TEST_ISOLATE=1 VITE_RUN_GOLDEN_PARITY=1 npm run test:browser -- golden-parity`
  passes, max abs diff 3.4e-5 vs the `demucs-onnx` Python reference.
- Read `research/spikes/SP-3.md` before touching the golden fixture: the
  first fixture exposed an unexplained WASM-vs-native divergence on
  exactly-mono tone input (not seen on ordinary stereo).

## Before G-002 (need hardware not available where this was built)

- **WebGPU and M1 performance.** `tests/PERF.md` records WASM timings on an
  i5-6200U (≈ 15 s/chunk at 3 threads, ≈ 26 s/chunk single-thread) but T-028,
  T-029, T-030 and the M1 Air T-027 figure are unmeasured: headless Chromium
  here has no WebGPU adapter. Fill them in with a real 4-minute input on a
  GPU machine (commands at the bottom of `tests/PERF.md`).
- **Manual QA not automated:** T-018 (coi-serviceworker reload), T-025 (live
  CSP allow-list); T-032 is the post-deploy smoke test.

## Changing tests

`tests/` is frozen by `tests/FROZEN_MANIFEST.sha256`. If a test/fixture change
is intended, run `node scripts/frozen-manifest.mjs --write` and commit the
manifest with it.

Checkpoint state: `.checkpoints/state.json`.
