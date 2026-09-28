# Budget (D-106; A-103: <= 4h wall across S-107..S-111 excluding docs)

Every harness/experiment invocation below is logged as it runs.

| step | command | wall_s | utc |
|---|---|---|---|
| D0 | `harness.py run --model htdemucs_fp16weights.onnx --wav tests/fixtures/diagnostic/golden-tones-mono-20s.wav --chunk 3 --runtimes native,wasm-node --out research/divergence/raw/d0-target` | 190 | 2026-09-28T (see result.json provenance.utc) |
| D0 | same, `--out research/divergence/raw/d0-target-repeat` (determinism check) | 190 | 2026-09-28T |
| D0 | same, `--wav tests/fixtures/golden-20s.wav --out research/divergence/raw/d0-control` | 187 | 2026-09-28T |
| D0b | `run-wasm-browser.mjs htdemucs_fp16weights.onnx d0-target/in_chunk3.f32 raw/d0b-single --threads 1` | 108 | 2026-09-28T |
| D0b | same, `raw/d0b-multi --threads 3` | 89 | 2026-09-28T |
| D1 | `harness.py sweep --model htdemucs_fp16weights.onnx --wav tests/fixtures/diagnostic/golden-tones-mono-20s.wav --chunk 3 --out research/divergence/raw/d1-sweep` (24 variants, native+wasm-node sessions each created once) | 1471 | 2026-09-28T |
| D2 | `d2_variants.py --model-fp16 htdemucs_fp16weights.onnx --model-fp32 htdemucs.onnx --wav tests/fixtures/diagnostic/golden-tones-mono-20s.wav --chunk 3 --out research/divergence` (native default/1t/4t/denormal/fp32 + webgpu via run-wasm-browser.mjs) | 356 | 2026-09-28T |
| D3 | 3 milestone batches (61 tensors) x {target, control} via `harness.py run --expose-file` | 750 | 2026-09-28T |
| D3 | `d3_profile.py` (offline: reads the 6 result.json files above, no new runs) | <1 | 2026-09-28T |
| D3 | 4 window-W batches (80 tensors) x {target, control} via `harness.py run --expose-file` | 962 | 2026-09-28T |
| D3 | `d3_candidates.py` (offline) | <1 | 2026-09-28T |
| D4 | `capture_inputs.py` (native-only, captures 10 real tensor values feeding the 5 D3 candidates) | 58 | 2026-09-28T |
| D4 | `d4_isolate.py` (5 candidates: native + wasm-node single-node runs + float64 oracle each) | ~30 | 2026-09-28T |
| D5 | `d5_perturbation.py` (one native session reused across 20 perturbed inputs, 4 epsilons x 5 seeds) | 325 | 2026-09-28T |

**Total: 4716 s (~78.6 min) of ~4h (A-103) budget for S-107..S-111 excluding docs.**

