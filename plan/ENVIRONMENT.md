# Environment pins (checked against npm/PyPI/GitHub registries 2026-09-23)

| Tool | Pin | Note |
|---|---|---|
| node | 22.12.0+ (22 LTS) | Vite 8 requires ^20.19 or >=22.12 |
| vite | 8.3.0 | Original plan pinned 6.0.0 (two majors behind) |
| typescript | 5.9.3 | Stay on 5.x; TS 7 (native port) deferred |
| onnxruntime-web | 1.30.0 | Original plan pinned 1.27.0 |
| coi-serviceworker | 0.1.7 | Latest; unmaintained since 2023 (see RISK R-03) |
| vitest / @vitest/browser / @vitest/browser-playwright | 5.0.1 | Browser-mode tests (Playwright); the provider moved into its own package in vitest 5 — `provider: playwright()` from `@vitest/browser-playwright`, not a string |
| playwright | 1.63.0 | Chromium + WebKit + Firefox for browser tests |
| demucs-onnx (Python) | 0.3.4 | Golden-fixture generation only (T-006, `tests/fixtures/generate-golden-reference.py`) |
| ffmpeg | any recent | Dev-only, generates `tests/fixtures/*.{wav,mp3,ogg}`; not a runtime or CI dependency |
| actions/checkout | v7 | |
| actions/setup-node | v7 | |
| actions/configure-pages | v6 | Missing from original workflow |
| actions/upload-pages-artifact | v5 | |
| actions/deploy-pages | v5 | |

Exact transitive versions are fixed by `package-lock.json` created in S-001.
