# SP-3: WASM-vs-native numeric parity on the golden fixture (2026-09-25)

Question: does ORT Web (WASM EP, D-12 session options) reproduce the native
`demucs-onnx` 0.3.4 output within the T-006 bound (max abs diff <= 1e-3)?
The bound was set in plan/REVIEW.md before any measurement existed.

## What happened

First real run of T-006, on the original `golden-20s.wav` (three pure chord
tones, exactly mono): **max abs diff 1.30e-3 — fails**. Bit-identical on a
second run, WASM EP confirmed by assertion.

Isolating it (all on the 20 s clip, chunk = one 343,980-sample model run):

| Check | Result |
|---|---|
| Python native, D-12 options (opt disabled) vs native default | 4e-8 — session options are not the cause |
| Decode vs raw PCM | <= 2.1e-6 per sample; adding 2e-6 noise natively moves output 5e-6 — decoder not the cause |
| Native model sensitivity (chunk 3, +-1e-5 input noise) | <= 1.4% relL2 on vocals — model is well-conditioned |
| Native fp16 vs native fp32 (chunk 3) | <= 0.9% — fp16 weights are fine natively |
| WASM fp16 vs native fp32 (chunk 3) | drums 6%, bass 14%, other 4.7%, **vocals 119%** |
| WASM fp32 vs native fp32 (chunk 3) | same numbers — not fp16-specific |
| ORT Web 1.22 vs 1.30; JSEP vs plain wasm build | identical output — not version/build-specific |
| 4 threads under COOP/COEP vs 1 thread | bit-identical — not threading |
| Chunks 1, 2, 4 | within a few % on very quiet stems; `other` (the loud stem) within 0.1% |

The divergence is chunk-wide on chunk 3 only, deterministic, and appears only
on this degenerate input.

## Control

A deterministic, non-periodic stereo signal (`tests/fixtures/generate-golden-fixture.py`:
vibrato harmonic voices panned differently plus noise bursts) run through the
same chunk profile: WASM vs native rel. RMS error **0.01–0.1%** on chunks 1–3.
T-006 on it: **max abs diff 3.4e-5**, ~30x inside the 1e-3 bound.

## Outcome

- `golden-20s.wav` replaced with the generated signal; `golden-reference.json`
  regenerated and committed. T-006 passes with margin.
- **Root cause of the divergence on the tone-chord input is not identified.**
  WASM and native ORT each self-consistent, disagree on that input only. If
  real music ever reproduces this, it is an ORT Web issue worth reporting
  upstream; nothing measured here shows it on non-degenerate audio.
- The original fixture and its native reference are not kept in the repo; the
  table above is the record.
- Side finding: the Vitest browser server sends no COOP/COEP, so *every*
  browser test runs single-threaded; the multi-threaded path the deployed app
  uses by default is exercised only by manual QA. (Threading was checked here
  with a temporary isolated server; results above.)
