```
IMPLEMENTED — S-001..S-007 done; S-008 (deploy) awaits gate G-002
Profiles: software, computational
Mode flags: software.deploys = true
Claims: 14 (verified 11, verified-with-conditions 1 [C-012], by-design 1, downgraded 1 [C-002])
Tests: 33 written (unit 15, integration 6, operational 5, security 2 [moved to unit], performance 4, provenance 1, deploy smoke 1);
       node-runnable subset (47 tests) passing locally; full browser subset written but unverified in this
       environment (no network route to Playwright's browser CDN here — see plan/REVIEW.md-style note below)
Steps: 9 (S-000 spike + S-001..S-008)
Gates: 1 (G-002 deployment, pending)
Risks: 0 Critical, 0 High, 7 Medium, 3 Low
```

# Plan: Browser-Based Audio Stem Splitter (GitHub Pages)

Repo: `qualitycoding/stem-splitter` · Pages URL: `https://qualitycoding.github.io/stem-splitter/`
Pages source: **GitHub Actions** (no `gh-pages` branch).

## Implementation status

S-001 through S-007 are implemented in `src/`, with tests in `tests/unit/`
(pure logic, no browser — 47 tests, all passing in every environment this
was built in) and `tests/browser/` (real browser APIs, real ORT sessions,
via Playwright — written and typechecked, but **not executed** in the
sandbox this was built in, which has no network route to Playwright's
browser-binary CDN, same restriction noted for huggingface.co in
research/spikes/SP-1.md). `.github/workflows/tests.yml` runs the full
browser suite on push/PR, where that restriction doesn't apply; that
first CI run is the first real execution of `tests/browser/*`.

What's covered where:
- Unit (Node, no browser): chunking/OLA/window edge cases (T-004, T-005,
  D-14), stem row extraction (T-011), WAV encoding (T-007), the ZIP writer,
  file-size/duration limits (T-021), the D-12 session-option regression
  guard (T-033), the D-07 thread-count formula.
- Browser, fast (tiny synthetic ONNX fixtures, `tests/fixtures/tiny-stem-model*.onnx`,
  no network beyond the test server itself): decode/resample/mono (T-001,
  T-002, T-003), decode error handling (T-009), the full `separate()`
  pipeline incl. progress (T-008, T-013, T-014, T-015), EP fallback
  (T-010), Cache API round-trip and corruption recovery (T-012, T-022),
  app startup with no model loaded (T-019), thread count under real
  ambient isolation state (T-023).
- Browser, opt-in (real ~166 MB model, real Hugging Face download — see
  `.github/workflows/golden-parity.yml`): golden parity against a
  demucs-onnx Python reference (T-006 — the reference data itself,
  `tests/fixtures/golden-reference.json`, still needs generating by a
  maintainer with network access via
  `tests/fixtures/generate-golden-reference.py`; the test skips itself
  with a clear message until that file exists), and performance (T-027–T-030,
  informational).
- Not automated, documented as manual QA: the coi-serviceworker
  install-then-reload flow (T-018) and the live CSP `connect-src`
  allow-list (T-025) are page-navigation-level behaviours outside
  Vitest browser mode's per-test-file model; T-026 (`npm audit`) and
  T-032 (deploy smoke) are CI steps, not test files — see
  `.github/workflows/tests.yml` and `plan/templates/deploy.yml`.
- `tests/unit/session-options.test.ts` pins D-12 so nobody re-enables
  graph optimisation without re-reading `research/spikes/SP-2.md`.



```
main thread                               worker (module)
-----------                               ---------------
File ─► OfflineAudioContext(2,1,44100)    ort session(s)
        .decodeAudioData (resamples)       chunk → run → select row → OLA
     ─► ensureStereo ─► L,R Float32Array ─► (transferred) ─► 4 stems (planar)
UI ◄── progress / stems ◄──────────────────  postMessage (transfer)
     ─► WAV encode + provenance JSON ─► downloads
```

Model modes (DECISIONS D-03):

| Mode | Model | Download (fp16weights) | Networks per chunk | Default |
|---|---|---|---|---|
| Standard | `htdemucs` single-file | 165,612,636 bytes (SP-1, verified) | 1 | yes |
| High quality | `htdemucs_ft` bag | 4 × 165,612,636 bytes | 4 (sequential, one resident) | no |

Model I/O (from `demucs_onnx.inference`): input `mix` float32 `(1,2,343980)`;
output `stems` float32 `(1,4,2,343980)`, source order `drums, bass, other, vocals`.
Chunking: segment 343,980, overlap 85,995 (¼), stride 257,985, last chunk
zero-padded; triangular fade window; divide by summed window weights.

## Steps

### S-000 Spike SP-1: measure what the source code can't tell us
- Tier: Sonnet · Depends: none
- Actions: from a Chromium page served with COOP/COEP locally,
  (1) fetch each model URL, record final redirect host(s), `Content-Length`,
  `Access-Control-Allow-Origin`, and SHA-256; (2) create a WASM session for
  `htdemucs_fp16weights.onnx`, record wasm heap after load and after one run;
  (3) same on WebGPU, record time per chunk and whether any
  `maxStorageBufferBindingSize` errors occur; (4) confirm ORT spawns threads
  without `blob:` workers under the planned CSP.
- Outputs: `research/spikes/SP-1.md`; model SHA-256s into `plan/DECISIONS.md` D-05; CSP host list into D-08.
- Done when: C-011, C-012, C-013, C-014 move to verified or the plan is amended.
- **Status: DONE.** SP-1 (`research/spikes/SP-1.md`): C-011/C-013/C-014 verified. SP-2
  (`research/spikes/SP-2.md`): `std::bad_alloc` was caused by graph optimisation exhausting the 4 GB wasm
  heap; with D-12 session options the model loads on WASM and WebGPU (ORT 1.30). C-012 verified under D-12.

### S-001 Scaffold
- Depends: S-000
- Actions: `npm create vite@8 . -- --template vanilla-ts`; install pinned
  `onnxruntime-web@1.30.0`, `coi-serviceworker@0.1.7`; dev: `vitest`,
  `@vitest/browser`, `playwright`. Copy `node_modules/coi-serviceworker/coi-serviceworker.min.js`
  → `public/` and load it as the **first** script in `<head>` (not bundled).
  Copy `ort-wasm-simd-threaded.jsep.{mjs,wasm}` → `public/ort/` via a
  postinstall script. `vite.config.ts`: `base: '/stem-splitter/'`,
  `worker.format: 'es'`, dev-server COOP/COEP headers.
- Done when: `npm run dev` page reports `crossOriginIsolated === true`; T-018 passes locally.
- Claims: C-003, C-009

### S-002 Decode & stereo
- Depends: S-001
- Actions: `decodeTo44k(file): Promise<{left, right, sourceRate}>` via
  `OfflineAudioContext(2,1,44100).decodeAudioData`; fallback explicit
  resample through `OfflineAudioContext` render if a browser returns the
  native rate; `ensureStereo`; typed `AudioInputError`.
- Outputs: `src/audio/decode.ts`
- Evidence: T-001, T-002, T-003, T-009, T-024

### S-003 Chunking & overlap-add (pure, node-testable)
- Depends: S-001
- Actions: `planChunks(len)`, `triangularWindow(n)`, `OverlapAccumulator`
  (per-stem planar accumulators + shared weight array, normalise at end).
- Outputs: `src/dsp/chunk.ts`, `src/dsp/ola.ts`
- Evidence: T-004, T-005

### S-004 Model loading & sessions
- Depends: S-000, S-001
- Actions: `getModel(url, sha256)`: Cache API lookup → fetch with 3× backoff
  → verify SHA-256 → cache; on mismatch evict and refetch once.
  `createSession(bytes)`: try `['webgpu']`, on failure `['wasm']`, always with the
  D-12 session options; record the EP actually used; cache the session per page (D-13). `ort.env.wasm.wasmPaths = BASE_URL + 'ort/'`;
  `numThreads = crossOriginIsolated ? min(8, max(1, hwc-1)) : 1`.
  "Load model from disk" picker (same SHA check).
- Outputs: `src/model/cache.ts`, `src/model/session.ts`
- Evidence: T-010, T-012, T-020, T-022, T-033
- Claims: C-001, C-004, C-008, C-011

### S-005 Separation pipeline (runs in worker)
- Depends: S-002, S-003, S-004
- Actions: `separate(left, right, mode, onProgress)`:
  Standard: one session; each chunk → `stems` → accumulate all 4 rows.
  High quality: for stem in `[drums,bass,other,vocals]`: load session, run
  all chunks, keep row `SOURCES.indexOf(stem)`, `session.release()`.
  Progress = completed runs / total runs. Transfer planar outputs back.
  WAV encoder (16-bit PCM, clamp, TPDF dither optional); provenance JSON.
- Outputs: `src/worker.ts`, `src/separate.ts`, `src/audio/wav.ts`, `src/provenance.ts`
- Evidence: T-006, T-007, T-008, T-011, T-013–T-017, T-031
- Claims: C-001, C-005, C-006, C-012

### S-006 UI
- Depends: S-005
- Actions: drop zone, mode selector (Standard / High quality; High quality
  disabled on WASM with an explanation; time & download estimate per EP),
  a distinct "Preparing model" stage (session creation takes 25–50 s), progress, cancel (terminates worker), EP badge,
  "slow mode" notice when not cross-origin isolated, mobile warning,
  per-stem download + "download all" (store-only zip, no dependency),
  privacy notice. No `innerHTML` with user data.
- Outputs: `src/ui.ts`, `index.html`, `src/style.css`
- Evidence: T-019, T-021, T-023

### S-007 Hardening
- Depends: S-006
- Actions: limits (≤ 200 MB file, ≤ 10 min audio, warn > 5 min); CSP meta
  from D-08; `npm audit --audit-level=high`; network allow-list test.
- Evidence: T-024, T-025, T-026; performance T-027–T-030 recorded in `tests/PERF.md`.

### S-008 Deployment (gated)
- Depends: S-007 · Gate: **G-002**
- Actions: after G-002 "proceed", copy `plan/templates/deploy.yml` →
  `.github/workflows/deploy.yml`; repo Settings → Pages → Source: GitHub
  Actions; push; run T-032 against the live URL.
- Rollback: see `plan/OPERATIONS.md`.

## Tests (frozen list; hashes recorded in tests/FROZEN_MANIFEST.sha256 at S-001)

Runner: Vitest; `node` project for pure DSP, `browser` project (Playwright:
chromium, webkit, firefox) for everything touching Web APIs.

**Unit**
- T-001 WAV/MP3/OGG fixtures decode to 44.1 kHz stereo planar arrays.
- T-002 48 kHz 10 s input → 441,000 ± 1 samples per channel.
- T-003 Mono input → two identical channels.
- T-004 `planChunks`: stride 257,985; count = ceil(len/stride) (min 1); last chunk padded; covers every sample.
- T-005 OLA with an identity "model" reconstructs input, max abs err ≤ 1e-6, including edges and a single short chunk.
- T-006 **Golden parity:** 20 s fixture, stems vs `demucs-onnx` 0.3.4 Python (CPU EP, same model file) max abs diff ≤ 1e-3 on WASM EP.
- T-007 WAV: RIFF header fields correct; 16-bit PCM; values > 1 clamp, never wrap.
- T-008 Progress: first 0, last 100, monotonic non-decreasing.
- T-009 Non-audio / undecodable file → `AudioInputError`, no unhandled rejection.
- T-010 WebGPU unavailable (stubbed) → session on `wasm`; EP recorded.
- T-011 High-quality mode keeps row `SOURCES.indexOf(stem)` for each specialist (checked with a synthetic 4-row output).
- T-012 Cache: stored, reused without network; corrupted bytes → SHA mismatch → evict + refetch.

- T-033 Every session is created with the D-12 options; a test asserts that `basic`/`all` are never passed (regression guard for the 4 GB heap failure).

**Integration** (Chromium unless stated)
- T-013 10 s input → 4 stems each exactly input length.
- T-014 Silence → each stem RMS < 1e-4.
- T-015 Clipped/full-scale square input → no NaN/Inf.
- T-016 Determinism: WASM repeated runs bit-identical; WebGPU repeated runs max abs ≤ 1e-4; WebGPU vs WASM ≤ 1e-2.
- T-017 Standard mode, 4-min input: `measureUserAgentSpecificMemory` peak < 2 GB; High-quality < 2.5 GB.
- T-018 First visit reloads exactly once; afterwards `crossOriginIsolated === true`; no reload loop if SW registration fails.

**Operational**
- T-019 App renders and is interactive with no model downloaded.
- T-020 Bad model URL / 404 → user-visible error, "load from disk" offered, no crash.
- T-021 > 10 min input rejected with message; 5–10 min shows warning.
- T-022 Reload mid-separation → cached model reused (no refetch), rerun succeeds.
- T-023 Not cross-origin isolated (SW blocked) → single-thread WASM completes a 10 s input; slow-mode notice shown.

**Security**
- T-024 Fuzzed/truncated audio headers → typed error only.
- T-025 All requests after load are same-origin or in the D-08 model-host allow-list (PerformanceObserver `resource`).
- T-026 `npm audit --audit-level=high` exits 0.

**Performance** (recorded, informational on CI; enforced on reference machines)
- T-027 Standard, 4-min song, WASM multi-thread: < 6 min on M1 Air; ≤ 16 min on the SP-2 reference machine (4-core Intel Gen9, measured 21.8 s/chunk ≈ 15 min).
- T-028 Standard, 4-min song, Chrome WebGPU: < 90 s separation excluding session creation (SP-2 reference iGPU: 1.26 s/chunk ≈ 53 s); session creation < 60 s.
- T-029 Standard model cold download at 50 Mbps: < 45 s.
- T-030 High quality, 4-min song, WebGPU: < 8 min including four session creations (SP-2 estimate ≈ 3.5 min separation + 4 × ~48 s create ≈ 6.7 min). Not offered on WASM (≈ 1 h).

**Provenance**
- T-031 Sidecar JSON contains: app git SHA (build-time `define`), ORT version, model name + SHA-256, input SHA-256, UTC timestamp, EP, thread count, mode.

**Deployment**
- T-032 Live URL loads; after one reload `crossOriginIsolated === true`; 10 s demo clip separates.

## Decision rules
- Model fetch fails: 3× exponential backoff → error + "load model from disk".
- WebGPU session fails: fall back to WASM silently; EP recorded in provenance; badge shows WASM.
- Not cross-origin isolated after one reload: continue with 1 thread + notice (do **not** block).
- Estimated time > 15 min: show estimate before starting; user may switch to Standard or cancel.
- `measureUserAgentSpecificMemory` unavailable: rely on input-length limits.
- iOS/iPadOS: allow Standard only, with memory warning.

## Gates
See `plan/GATES.md`. Only G-002 (deployment).
