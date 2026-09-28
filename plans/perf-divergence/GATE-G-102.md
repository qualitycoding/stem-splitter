# GATE G-102 — Divergence headline result

Trigger: S-110 complete. `classify_outcome` returned **AMPLIFICATION**;
`research/divergence/REPORT.md` is generated (byte-identical on regeneration,
verified via sha256); tests/divergence is 60/60 green; `npm run verify:frozen` is green.

## Evidence bundle

Full detail is in `research/divergence/REPORT.md` (generated, not retyped). Summary:

- **D0**: reproduces on the target fixture (vocals rel_l2 = 1.155 vs native), does not on
  the control (rel_l2 = 0.0043). `wasm-node` deterministic across two independent runs.
- **D0b**: real Chrome (single- and multi-threaded) is bit-identical to Node's `wasm-node`
  output (rel_l2 = 0.0) and reproduces the identical rel_l2 vs native. No browser/Node
  material difference — D-106's "switch to browser as harness of record" rule never
  triggered; Node was used throughout D1–D5.
- **D1 trigger table** (24 variants, full table in REPORT.md): breaks between noise
  σ=1e-4 (still reproduces, 1.160) and σ=1e-3 (does not, 0.147); needs the full 3-tone
  chord (no single tone or pair reproduces); gain-independent (0.1×–4×); chunk-specific
  (only chunk 3 of this fixture); tolerant of small backward shifts, breaks past +1
  sample forward.
- **D2**: native thread-count (1 vs 4) and `session.set_denormal_as_zero` make no
  difference (rel_l2=0 either way); fp32 vs fp16 weights differ by only ~0.0038 (not the
  source). **WebGPU is not usable evidence** — its output was entirely zero in this
  session's cloud container (a real computation failure: unsupported WGSL `f16`
  extension in the software GPU backend), not a numerical finding.
- **D3 profile and window**: window **W** = `(tdecoder.1, decoder.2]`, found via
  `first_divergence(profile, tau=10)` on 61 milestones profiled in true graph execution
  order (an initial ordering bug — grouping block milestones separately from the
  interleaved crosstransformer LayerNorm/Softmax ones — was caught and fixed before this
  result). Within W, 80 float tensors were profiled; 5 candidates selected (first
  exceedance + 4 largest consecutive-ratio jumps), all landing on a Div/Mul/Add sequence
  immediately after an `InstanceNormalization` in `decoder.2`'s `dconv` block, with a
  ~23.8 million× consecutive-ratio jump.
- **D4 per-candidate errors vs oracle**: all 5 candidates **agree** — `err_native` and
  `err_wasm` both ≈2.5e-8 (both runtimes essentially exact against the float64 oracle,
  given IDENTICAL real captured inputs). `op_result = "agree"`.
- **Outcome**: `classify_outcome(reproduced=True, op_result="agree", budget_exhausted=False)`
  = **AMPLIFICATION**.
- **Perturbation table** (mandatory supporting evidence for AMPLIFICATION, full table in
  REPORT.md): a synthetic 1e-7 relative-L2 input perturbation (below typical float32
  rounding scale) reaches the vocals stem amplified ~350×–1370× (5 seeds); amplification
  grows as the perturbation shrinks. Consistent with the network being numerically
  unstable near this exact-periodic input, independent of which runtime is used.
- **Budget**: 4716 s (~78.6 min) of the ~4h (14400 s) allowance (`BUDGET.md`).

## A nuance worth flagging before you answer

`plan/DECISIONS.md` D-109's action row for AMPLIFICATION reads: *"If D1 shows exact L == R
is necessary (noise σ ≤ 1e-5 on R removes reproduction) **and** the human answers `proceed`
… add a non-blocking UI notice for exactly-mono input."* The actual D1 data shows
reproduction survives through σ=1e-4 and only breaks at σ=1e-3 — one order of magnitude
looser than the σ≤1e-5 threshold D-109 anticipated when it was written. Near-exact stereo
symmetry is clearly still required (ordinary music's L/R channels differ far more than
1e-3 relative), but the precise wording of D-109's condition doesn't literally match this
data. I'm not resolving that reading myself — see question 2 below.

## Questions

1. **Accept the outcome classification** (AMPLIFICATION)? The evidence is internally
   consistent: reproduces in two independent environments (Node, Chrome), every isolated
   op agrees with a float64 oracle on identical inputs, and independent perturbation
   evidence shows generic numerical instability on this input class.
2. **Approve the S-111 action row of D-109 for this outcome** — a `README.md`
   known-limitation note either way, and (given the nuance above) do you want the
   non-blocking exactly-mono UI notice added (would need a new frozen test first), or
   docs-only?
3. **Is the divergence non-blocking for deployment (A-104)?** No workaround exists (and
   D-109 permits none for this outcome) — ordinary music is unaffected per D1's tone/gain
   variants and the golden-parity control fixture's own history (SP-3, ≤0.1% agreement).

## Responses

Per `plan/GATES.md`: `proceed` → S-111 runs exactly per D-109; `proceed-with-rescope: <text>`
→ S-111 runs per the text, not exceeding it; `extend-budget: <hours>` is not applicable
(only for `UNRESOLVED`); `stop` → `HALTED.md`, implementer stops, all committed artifacts
remain as-is.

## Human decisions

_(awaiting reply)_
