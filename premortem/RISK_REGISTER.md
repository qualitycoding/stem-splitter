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
| R-09 | Model exhausts the 4 GB wasm heap if graph optimisation is enabled (SP-2) | Med | D-12 options, T-033 regression guard; if a future ORT/model breaks it, re-export with constants pre-folded offline |
| R-10 | Slow session creation (27 s WASM, 48 s WebGPU on reference iGPU) and slow WASM separation (≈ 15 min / 4-min song) | Med | "Preparing model" stage, session reuse (D-13), per-EP time estimate, HQ WebGPU-only; future: pre-optimised model export |
| R-11 | `tests/browser/*` has never actually run (sandbox had no network to Playwright's browser CDN) | Med | `.github/workflows/tests.yml` runs it on the first push/PR — treat that run as the real completion gate for S-001–S-007, not this plan document |

## v3.9 addendum risk round (2026-11-02)

| Risk | Severity | Mitigation | Status |
|---|---|---|---|
| No independent fresh-context review (D-906) | High | Recorded substitution; independent review scheduled before product execution resumes | Open |
| CI-dependent checks (mutation pricing/floor, matrix jobs) not locally executable (D-905) | Medium | CI is the authoritative venue; estimates labelled; post-conditions gate in CI | Open |
| Lesson/knowledge store push pending G-003 sign-off | Low | Bundle fallback documented; does not block amendment completion | Open |

Pre-mortem rounds repeated to zero Critical risks; the High risk is retained
honestly with owner and mitigation.
