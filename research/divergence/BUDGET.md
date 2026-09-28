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

**Total so far: 2235 s (~37.3 min) of ~4h (A-103) budget for S-107..S-111 excluding docs.**

