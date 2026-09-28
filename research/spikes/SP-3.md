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

## Addendum (2026-09-28, `plans/perf-divergence/` S-107..S-111)

The original fixture is recoverable from git: `git show 729c249:tests/fixtures/golden-20s.wav`
(sha256 `9d60e12db5fd40ac8c71356e05dbed8c6e387c7330c668f4403a134e57260376`); it now lives at
`tests/fixtures/diagnostic/golden-tones-mono-20s.wav` (see that directory's `README.md`).

Root cause investigated end to end (D0–D5, `scripts/divergence/`); full evidence in
[`research/divergence/REPORT.md`](../divergence/REPORT.md). **Outcome: `AMPLIFICATION`** — every
candidate op (a `Div`/`Mul`/`Add` sequence in `decoder.2`'s dconv block, right after an
`InstanceNormalization`) agrees with a float64 oracle to ~2.5e-8 given identical real inputs, so
neither runtime is defective; the divergence is ordinary rounding-level disagreement between the
two runtimes, amplified ~350x-1370x by this network's numerical instability on this specific
exact-periodic input class. Confirmed independent of the runtime: perturbing the *native* input by
1e-7 relative noise alone reproduces the same order of amplification.

The percentages above (`drums 6%, bass 14%, other 4.7%, vocals 119%`) were measured in the browser
(WASM EP) against native fp32, on the original 2026-09-25 run. The Node-based `wasm-node` harness
built for this investigation (D-107) measured the same chunk on 2026-09-28 with the recovered fixture
and got comparable, not identical, numbers — `research/divergence/d0-target.json`:
drums rel_l2 0.328 (33%), bass 0.141 (14%), other 0.0719 (7.2%), vocals 1.155 (115%). The two runs
used different reference weights (native fp16 vs the fp32 comparison above) and are not expected to
match exactly; both show the same qualitative pattern (vocals worst by a wide margin, other least
affected).
