# Review of the original plan (2026-09-23)

Verification method: inspected the `demucs-onnx` 0.3.4 wheel source, the
`onnxruntime-web` 1.30.0 npm tarball, and the npm/PyPI/GitHub registries.
Findings are ordered by severity.

## Blocking — the plan would not work as written

1. **Web Workers cannot decode audio.** `AudioContext`/`OfflineAudioContext`
   do not exist in worker scope, and `AudioBuffer` is not structured-cloneable
   or transferable, so `separate(audioBuffer, …)` inside a worker (S-005/S-006)
   fails. **Fix:** decode + resample on the main thread; transfer two planar
   `Float32Array` channels to the worker. The public API becomes
   `separate(left, right, onProgress)`.

2. **Wrong WASM binary vendored.** The default `onnxruntime-web` entry
   (`ort.min.mjs` / `ort.bundle.min.mjs`) loads
   `ort-wasm-simd-threaded.jsep.{mjs,wasm}` (~28 MB), not the 14 MB
   `ort-wasm-simd-threaded.wasm`, and the stated 11.79 MB size (C-009) matches
   neither. Vendoring only the plain file breaks WebGPU. **Fix:** copy the
   `.jsep.mjs` + `.jsep.wasm` pair and set `ort.env.wasm.wasmPaths`.

3. **Model interface was wrong.** The exported graph takes input `mix`
   `(1, 2, 343980)` and returns `stems` `(1, 4, 2, 343980)`. Each htdemucs_ft
   specialist outputs **all four** stems; only the row matching its
   specialty is kept. The plan never mentions this selection step.

4. **htdemucs_ft is ~4x the cost the plan budgets for.** It runs four full
   networks per chunk. C-006's 3–5 min for a 4-min song is single-network
   territory, so the ft bag lands around 12–20 min on WASM, and T-026
   (< 6 min) could not pass. Four ~316 MB fp32 sessions resident at once also
   pressures the 4 GB wasm32 heap. **Fix:** default to single-file
   `htdemucs` (one session, all four stems); offer `htdemucs_ft` as an opt-in
   "High quality" mode that loads **one specialist at a time** (all chunks,
   then `session.release()`).

5. **Deploy workflow would bypass G-002.** It triggers on every push to
   `main`, so committing it deploys before sign-off. It also omits
   `actions/configure-pages` and the `id`/`url` wiring on the deploy step,
   and the plan contradicts itself (a `gh-pages` branch in Phase 0 vs.
   Actions-based Pages in S-008). **Fix:** template kept in
   `plan/templates/deploy.yml`; moved into `.github/workflows/` only at G-002;
   Pages source = "GitHub Actions"; no `gh-pages` branch.

## Incorrect tests

6. **T-006 (stems sum to mix within 1e-4) is false for Demucs.** Outputs are
   not constrained to sum to the input. **Replaced** with a golden-parity
   test against `demucs-onnx` Python output (max abs diff ≤ 1e-3, WASM EP),
   which is the real correctness oracle.
7. **Overlap-add uses a triangular window**, not Hann, with weight-sum
   normalisation (as in `demucs_onnx.inference`). T-005 is rewritten to match.
8. **T-018 (bit-identical repeated runs)** cannot hold across execution
   providers, and WebGPU is not bitwise deterministic. Now: bit-identical on
   WASM; ≤ 1e-4 max-abs across runs on WebGPU; WebGPU vs WASM ≤ 1e-2.
9. **T-012 "Cache-Control: immutable"** is meaningless for the Cache API.
   Replaced by SHA-256 verification of cached model bytes.
10. **Memory tests used `performance.memory`**, which is deprecated and
    doesn't account for wasm memory. Use
    `performance.measureUserAgentSpecificMemory()` (available when
    `crossOriginIsolated`, Chromium only).
11. **Numbering/mapping errors.** The performance section listed four tests
    under T-026–T-028; deployment smoke T-030 was never defined; S-006 cited
    T-007–T-009 (WAV encoding, progress, errors), which belong to S-002/S-005.
    Renumbered to 32 tests; traceability rebuilt.
12. **No test runner specified.** Most units need real browser APIs.
    Added Vitest browser mode with Playwright (Chromium/WebKit/Firefox).

## Design issues

13. **"No COI → blocking error" is wrong.** Single-threaded WASM still works,
    just slower. Now: reload once, then continue with `numThreads = 1` and a
    visible "slow mode" notice.
14. **GitHub Releases mirror won't work in-browser.** Release asset
    downloads redirect to a host that doesn't send CORS headers, and Git LFS
    isn't served by Pages. **Replaced** with a "load model from disk" file
    picker (also useful offline), with SHA-256 check.
15. **CSP `connect-src` too narrow.** Hugging Face `resolve/` URLs redirect
    to CDN hosts (e.g. `*.hf.co`); the exact hosts must be captured in spike
    SP-1. Also add `worker-src 'self' blob:`.
16. **`numThreads = hardwareConcurrency`** oversubscribes and multiplies
    per-thread memory. Use `min(8, max(1, hardwareConcurrency - 1))`.
17. **Vite `base: './'`** is fragile with workers, the service worker and
    `wasmPaths`. Use `base: '/stem-splitter/'`.
18. **Resampling is simpler than planned.** `new OfflineAudioContext(2, 1,
    44100).decodeAudioData()` resamples during decode; the separate
    resample step is only needed as a fallback.
19. **Fabricated verification.** Phase 0 "verified" push access to a
    different repo (`stem-splitter-web`, `gh-pages`) and claims were marked
    verified with no sources. `research/SOURCES.md` now records what was
    actually checked and what remains open.
20. **Stale pins.** Vite 6 → 8.3, ORT 1.27 → 1.30. "Chrome disables
    third-party service workers" (pre-mortem) isn't a real risk—coi-serviceworker
    is first-party; replaced with the actual risks.
21. **Mobile.** iOS Safari tab memory limits make the ft mode infeasible
    and the default mode marginal. Explicit warning added.
