# SP-1 results (2026-09-23)

Run on Windows, Chrome 153, 4 logical cores, 16 GB, Intel Gen9 iGPU (WebGPU
maxStorageBufferBindingSize 2 GiB). Raw data: `sp1-results.json`. Script: `sp1.py`.

| Claim | Result |
|---|---|
| C-011 CORS / hosts | **Verified.** `huggingface.co` (302, ACAO reflects origin) → `us.aws.cdn.hf.co` (ACAO `*`). Browser fetch succeeded under COOP/COEP `require-corp`. |
| C-013 CSP vs ORT workers | **Verified.** ORT 1.30 starts same-origin module workers (`ort-wasm-simd-threaded.jsep.mjs`); no `worker-src` violations, no `blob:` workers. |
| C-014 model size | **Verified.** All five fp16weights files are 165,612,636 bytes. Browser SHA-256 matched HF `X-Linked-Etag` for both models downloaded. |
| C-012 memory | **FAILED.** `InferenceSession.create` threw `std::bad_alloc` (ERROR_CODE 6) for both models on both `wasm` and `webgpu` EPs. |
| T-029 download time | 22–33 s at 40–60 Mbit/s (target < 45 s). |

CSP: the two `connect-src` reports name the `huggingface.co` URL because
browsers report the pre-redirect URL; the actually blocked origin is the CDN.
D-08 now allows `https://*.hf.co` (the CDN host is region-prefixed).

Additional finding: the demucs-onnx 0.3.4 browser demo imports
`onnxruntime-web@1.18.0/dist/ort.min.mjs`, which does not exist in 1.18.0 (that
release ships only UMD `.js` builds). No evidence these exports have ever been
loaded in a browser; C-002 downgraded.

## Next: SP-2 (`sp2.py`)
Model structure + native memory profile, and an 8-configuration browser matrix
(ORT 1.30 / 1.22 / 1.18 × threads × graph optimisation × memory arena),
recording WebAssembly memory size at failure.
