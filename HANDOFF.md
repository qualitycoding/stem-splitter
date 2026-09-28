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
  exactly-mono tone input (not seen on ordinary stereo). Root-caused in
  `plans/perf-divergence/` (G-102, `proceed`, 2026-09-28): outcome
  `AMPLIFICATION` — see
  [`research/divergence/REPORT.md`](research/divergence/REPORT.md) and the
  README's "Known limitations" section. Docs-only guard (D-109): D1's data
  breaks reproduction between noise σ=1e-4 and σ=1e-3, not at σ≤1e-5, so
  D-109's condition for an additional UI notice is not met.

## Before G-002 (need hardware not available where this was built)

- **WebGPU and M1 performance.** `tests/PERF.md` is superseded — see
  [`perf/REPORT.md`](perf/REPORT.md) for the current, provenance-stamped
  record (`plans/perf-divergence/`, G-101 `proceed`, 2026-09-27). Verdict:
  **T-028 fail** (session creation exceeds its threshold; separation time is
  within bound); **T-027, T-029, T-030 remain unmeasured** (insufficient
  real-hardware samples for T-027/T-030, no data at all for T-029) — accepted
  as the record for G-002 per the gate reply, not re-measured here.
  **T-027-M1 (Apple Silicon) remains unmeasured** — no M1 hardware was
  available in this investigation either; G-101's reply accepted the record
  as-is (proceeding without it) rather than explicitly waiving it. Fill it
  in with a real multi-minute input on M1/GPU hardware via
  `perf/standalone/` (see its `README.md`) if it becomes available.
- **Manual QA not automated:** T-018 (coi-serviceworker reload), T-025 (live
  CSP allow-list); T-032 is the post-deploy smoke test.

## Changing tests

`tests/` is frozen by `tests/FROZEN_MANIFEST.sha256`. If a test/fixture change
is intended, run `node scripts/frozen-manifest.mjs --write` and commit the
manifest with it.

Checkpoint state: `.checkpoints/state.json`.
