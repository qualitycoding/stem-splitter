# HANDOFF

Start with `plan/REVIEW.md` (why the original plan changed), then
`plan/PLAN.md`'s "Implementation status" section for what's built. Do
**not** create `.github/workflows/deploy.yml` until gate G-002 is signed
off; the template lives in `plan/templates/deploy.yml`.

**Current status: S-001–S-007 implemented, in `src/`. S-008 (deploy) is
gated on G-002 and not started.**

## First thing to do

Push this branch (or merge to `main`) and watch `.github/workflows/tests.yml`
run. Every test here was written and typechecked but the sandbox this was
built in has no network route to Playwright's browser-binary CDN or to
Hugging Face, so **`tests/browser/*` has never actually been executed** —
that first CI run is the real gate before trusting any of this. If
something in `tests/browser/` fails, fix it before treating S-001–S-007 as
actually done, not just written.

`npm test` (the Node-only unit suite: DSP, WAV/ZIP encoding, security
limits, D-12/D-07 regression guards) passes locally in every environment
this was built in — 47 tests, see `plan/PLAN.md` "Implementation status"
for exactly what each covers.

## Two follow-ups, not blocking S-008

- **Golden-parity reference data.** `tests/browser/golden-parity.test.ts`
  (T-006) skips itself until `tests/fixtures/golden-reference.json`
  exists. Generate it once, with network access to Hugging Face:
  `pip install demucs-onnx==0.3.4 soundfile numpy && python3 tests/fixtures/generate-golden-reference.py`,
  then commit the resulting JSON. Instructions are in that script's
  docstring.
- **Performance baseline on your own hardware.** `tests/browser/performance.test.ts`
  (T-027–T-030) is opt-in (`VITE_RUN_PERFORMANCE_TESTS=1`) and only checks
  loose sanity bounds; the real numbers to compare against are in
  `research/spikes/SP-2.md`.

Checkpoint state: `.checkpoints/state.json`.
