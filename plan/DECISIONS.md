# Decisions

- **D-01 Public API (worker):** `separate(left: Float32Array, right: Float32Array, mode: 'standard'|'hq', onProgress) → Promise<Record<'drums'|'bass'|'other'|'vocals', [Float32Array, Float32Array]>>`. Decoding stays on the main thread (no AudioContext in workers; AudioBuffer not transferable).
- **D-02 Outputs:** four 44.1 kHz stereo 16-bit WAVs + one provenance JSON.
- **D-03 Default model:** `htdemucs` single-file fp16weights. `htdemucs_ft` bag is opt-in and loads one specialist at a time.
- **D-04 Model sources:** `https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx`; ft specialists at `StemSplitio/htdemucs-ft-{stem}-onnx/resolve/main/htdemucs_ft_{stem}_fp16weights.onnx`. Pin to a commit hash instead of `main` once SP-1 records one.
- **D-05 Model integrity:** SHA-256 per file — *to be filled by SP-1*.
- **D-06 ORT entry:** default `onnxruntime-web` import (includes WebGPU + WASM via the JSEP binary); vendor `ort-wasm-simd-threaded.jsep.{mjs,wasm}` under `public/ort/`.
- **D-07 Threads:** `crossOriginIsolated ? min(8, max(1, hardwareConcurrency - 1)) : 1`.
- **D-08 CSP:** `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' https://huggingface.co <redirect hosts from SP-1>; img-src 'self' data:; style-src 'self'`.
- **D-09 Limits:** file ≤ 200 MB; duration ≤ 10 min; warn > 5 min.
- **D-10 Deployment:** GitHub Actions Pages; `base: '/stem-splitter/'`; workflow enabled only after G-002.
- **D-11 License:** Apache-2.0 for this repo; third-party MIT components listed in NOTICE.
