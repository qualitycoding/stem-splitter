# SP-2 results (2026-09-23)

Same machine as SP-1 (Windows, Chrome 153, 4 logical cores, Intel Gen9 iGPU).
Raw data: `sp2-results.json`. Script: `sp2.py`. Model: htdemucs fp16weights
(`d05c269d…`). Model-structure analysis was skipped (`onnx` not installed); not
needed given the result below.

## Cause of `std::bad_alloc` (C-012)

**Graph optimisation.** Every configuration with `graphOptimizationLevel:
'disabled'` loaded and ran, on ORT 1.30, 1.22 and 1.18. Every configuration
with `basic` or `all` grew the WebAssembly heap to its 4096 MB ceiling and
failed (`std::bad_alloc`, `Aborted()`, or a bare exception pointer).
Native onnxruntime 1.30 loads the same model at every level, so the browser
failure is the 4 GB wasm32 address-space limit, most likely hit during
constant folding (which runs from `basic` upward and would materialise fp32
copies of the fp16 weights and any foldable subgraphs).

Caveat: in the passing configurations the CPU memory arena and memory-pattern
planning were also off, so arena-on/optimisation-off was not isolated. The
adopted setting (D-12) is exactly the tested one.

| # | ORT | threads | opt | arena/memPattern | wasm | webgpu |
|---|---|---|---|---|---|---|
| 1 | 1.30 | 1 | disabled | off | OK — create 28.0 s, run 34.7 s | – |
| 2 | 1.30 | 3 | disabled | off | OK — create 26.8 s, run 21.8 s | OK — create 48.3 s, run 8.2 s then 1.26 s |
| 3 | 1.30 | 3 | basic | on | bad_alloc @ 4096 MB | bad_alloc |
| 4 | 1.30 | 1 | all | on | bad_alloc @ 4096 MB | – |
| 5 | 1.22 | 3 | disabled | off | OK — create 30.2 s, run 27.7 s | failed (exception) |
| 6 | 1.22 | 3 | all | on | Aborted @ 4096 MB | – |
| 7 | 1.18 | 1 | all | on | failed (exception) | – |
| 8 | 1.18 | 3 | disabled | off | OK — create 21.5 s, run 24.1 s | `requestAdapterInfo` removed from Chrome |

Memory with optimisation disabled: wasm heap ≈ 420 MB after session creation,
≈ 890 MB after the first run (heap never shrinks). All outputs `(1,4,2,343980)`,
no non-finite values.

Native onnxruntime 1.30 (CPU EP, same machine): create 37 s (disabled) / 8 s
(basic, all); run 6.4–7.0 s per chunk.

## Performance (per 7.8 s chunk; a 4-min song is 42 chunks)

| Path | s/chunk | 4-min song, Standard | 4-min song, High quality (×4) |
|---|---|---|---|
| WebGPU (ORT 1.30, warm) | 1.26 | ≈ 0.9 min (+ ~56 s create/warm-up) | ≈ 3.5 min + 4 × model create |
| WASM, 3 threads | 21.8 | ≈ 15 min | ≈ 61 min |
| WASM, 1 thread | 34.7 | ≈ 24 min | ≈ 97 min |
| Native CPU (reference) | 6.6 | ≈ 4.6 min | ≈ 18.5 min |

## Consequences for the plan
- D-12: session options `graphOptimizationLevel:'disabled'`, `enableCpuMemArena:false`, `enableMemPattern:false`.
- D-06: stay on ORT 1.30 — the only tested version whose WebGPU path works.
- D-03: High-quality mode requires WebGPU; on WASM it is disabled with an explanation.
- Session creation is slow (27 s WASM, 48 s WebGPU) and becomes a visible "Preparing model" stage.
- C-012 verified under D-12; R-09 downgraded to Medium.
