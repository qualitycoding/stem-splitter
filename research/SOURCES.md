# Sources (what was actually checked, 2026-09-23)

1. `demucs-onnx` 0.3.4 wheel from PyPI (MIT, StemSplit) — read `inference.py`, `_hub.py`, `browser.py`. Repo: https://github.com/StemSplit/demucs-onnx · Models: https://huggingface.co/StemSplitio
2. `onnxruntime-web` 1.30.0 npm tarball — `package.json` exports and `dist/` file sizes; grepped entry points for the WASM binary each loads.
3. npm registry — latest vite 8.3.0 (node ^20.19 || >=22.12), typescript 5.9.3 (5.x line), vitest 5.0.1, playwright 1.63.0, coi-serviceworker 0.1.7 (modified 2023-07-09).
4. GitHub API — latest actions: checkout v7.0.1, setup-node v7.0.0, configure-pages v6.0.0, upload-pages-artifact v5.0.0, deploy-pages v5.0.1.

## Open verification items (spike SP-1) — superseded, see below
C-011 (HF CORS/redirect hosts), C-012 (memory / WebGPU limits), C-013 (CSP vs ORT workers), C-014 (standard model size). huggingface.co was not reachable from the review sandbox, so none of these were measured.

5. SP-1 run by the project owner, 2026-09-23 — `research/spikes/SP-1.md`, raw `sp1-results.json`. Also checked: onnxruntime-web 1.18.0 tarball contains no `.mjs` builds.
6. SP-2 run by the project owner, 2026-09-23 — `research/spikes/SP-2.md`, raw `sp2-results.json`.
