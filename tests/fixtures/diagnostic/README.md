# Diagnostic fixtures (plans/perf-divergence)

Used only by the divergence investigation (`tests/divergence/`, `scripts/divergence/`). Not used by the app's golden-parity test
(`tests/browser/golden-parity.test.ts` uses `../golden-20s.wav`).

## golden-tones-mono-20s.wav

The ORIGINAL first `golden-20s.wav`: 20 s, 44.1 kHz, 16-bit, two identical channels (exactly mono), a three-tone chord at
330 / 440 / 550 Hz, peak 0.0694. On this input ONNX Runtime Web (WASM EP) and native ONNX Runtime disagree by >100 % relL2 on the
vocals stem of chunk 3 (`research/spikes/SP-3.md`).

`research/spikes/SP-3.md` says this file "is not kept in the repo". It is: recover it with

```sh
git show 729c249:tests/fixtures/golden-20s.wav > tests/fixtures/diagnostic/golden-tones-mono-20s.wav
```

Expected SHA-256: `9d60e12db5fd40ac8c71356e05dbed8c6e387c7330c668f4403a134e57260376` (3,528,078 bytes; asserted by
`tests/divergence/test_fixture.py`). Do not regenerate it: a regenerated 261.63/329.63/392.00 Hz chord did NOT reproduce the
divergence (plans/perf-divergence/research/spikes/sp6-output-chunk3.json).
