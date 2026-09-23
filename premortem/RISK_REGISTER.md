# Risk register

| ID | Risk | Sev | Mitigation |
|---|---|---|---|
| R-01 | WebGPU unavailable/fragmented (Firefox, older Safari) → slow WASM path | Med | Automatic fallback, EP badge, time estimate before start |
| R-02 | HF URL change / rate-limit / outage | Med | Pin to commit hash; SHA-256; "load model from disk" |
| R-03 | coi-serviceworker unmaintained (last release 2023) or SW blocked (private mode, enterprise policy) | Med | Single-thread fallback path (T-023); small enough to vendor and patch |
| R-04 | Memory exhaustion (long inputs, HQ mode, mobile) | Med | 10-min cap, one resident session in HQ, release after use, iOS Standard-only |
| R-05 | ORT version drift changes numerics | Low | Exact pin + lockfile; ORT version in provenance; golden test T-006 |
| R-06 | Model supply-chain tampering | Med | SHA-256 pinned in D-05, verified on every load incl. from cache |
| R-07 | Pages bandwidth (100 GB/mo soft) | Low | Models not hosted on Pages; ORT wasm ~28 MB cached by browser |
| R-08 | Model/weights licensing | Low | Demucs weights and demucs-onnx are MIT; listed in NOTICE |
| R-09 | Published ONNX exports don't load in ORT Web (`std::bad_alloc`, SP-1) | **High** | SP-2 diagnosis; fallbacks: session-option/ORT-version pin, or re-export the model ourselves with demucs-onnx |
