# ENVIRONMENT

All versions below were observed on 2026-09-26 on the planning machine. "Verified" = the command was executed during planning and succeeded.

## Machine

| Item | Value |
|---|---|
| OS | Windows 10 Pro 10.0.19045 |
| CPU | Intel Core i5-6200U @ 2.30 GHz (max 2.4 GHz reported), 2 cores / 4 logical |
| GPU | Intel HD Graphics 520 (Gen9); WebGPU adapter exposed by Chrome (`vendor intel`, `architecture gen-9`, `maxStorageBufferBindingSize 2147483644`) — verified by SP-4 |
| Power | AC connected (BatteryStatus 2); active plan Balanced (`381b4222-f694-41f0-9685-ff5bb260df2e`) |
| Disk | `D:` 174 GB free |

## Toolchain (pinned)

| Tool | Version | Source of truth |
|---|---|---|
| Node | v24.13.0 (native TypeScript type-stripping verified by SP-8: a `.mjs` imports a `.ts` file with `import type` and explicit `.ts` extensions, no flag) | `node -v` |
| npm | 11.18.0 | `npm -v` |
| Git | 2.42.0.windows.2 | `git --version` |
| onnxruntime-web | 1.30.0 | `package.json`, `package-lock.json` (sha256 `67ee91ba88d812077f0bd913b372043c9574c2e6e1ac9d86c764ada261e51650`) |
| vitest / @vitest/browser / @vitest/browser-playwright | 5.0.1 | lockfile |
| playwright | 1.63.0 | lockfile |
| Chrome (system) | 154.0.8037.57 | `C:\Program Files\Google\Chrome\Application` |
| Playwright bundled Chromium | 153.0.8010.12 (no WebGPU adapter — SP-4) | `playwright` |
| TypeScript / vite | 5.9.3 / 8.3.0 | lockfile |
| Python | 3.14.2 (venv) | `python --version` |
| Python packages | `scripts/divergence/requirements.txt`: numpy 2.5.3, onnx 1.23.0, onnxruntime 1.30.0, soundfile 0.14.0, pytest 9.1.1 (installed and importable — verified, SP-5) | `pip list` |
| Model (fp16 weights) | `htdemucs_fp16weights.onnx`, sha256 `d05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a`, 165,612,636 bytes; graph opset 17, 24,917 nodes, input `mix` (1,2,343980), output `stems` (1,4,2,343980) — verified SP-5 | `research/spikes/sp5-model-inspect-output.json` |

## Setup commands (literal; run from the repo root, Git-Bash unless stated)

```sh
# 0. Node dependencies (CI does this with `npm ci`; on the planning machine node_modules already matched the lockfile: `npm ls --depth=0` clean)
npm ci

# 1. Python venv OUTSIDE the repo (never inside tests/: the freeze manifest hashes every file there)
python -m venv ../stem-splitter-venv
../stem-splitter-venv/Scripts/python -m pip install -r scripts/divergence/requirements.txt
../stem-splitter-venv/Scripts/python -c "import onnxruntime as o; print(o.__version__)"     # expect 1.30.0

# 2. Freeze check (must be green before AND after every step that touches tests/)
npm run verify:frozen

# 3. Fast checks
npm run typecheck
npm test                                                           # Node unit tests (vitest --project node)
PYTHONDONTWRITEBYTECODE=1 ../stem-splitter-venv/Scripts/python -m pytest tests/divergence -p no:cacheprovider -q
```

`PYTHONDONTWRITEBYTECODE=1` and `-p no:cacheprovider` are mandatory: otherwise `__pycache__/` and `.pytest_cache/` appear under `tests/` and `npm run verify:frozen` fails.

### Git-Bash pitfall (SP-7)

Git-Bash rewrites a leading `/` in **command-line arguments** (`/tencoder.0/...` became `C:/Program Files/Git/tencoder.0/...`). ONNX tensor names begin with `/`. Therefore tensor names are always passed **by file** (`--expose-file`), never on argv; in any shell command that must carry such a string set `MSYS_NO_PATHCONV=1`.
Also: Windows-native Python does not understand Git-Bash `/tmp/...` paths; pass `cygpath -w` results or relative paths.

## Perf machine controls (D-110)

Before any perf measurement step: (1) AC power connected; (2) `powercfg /setactive SCHEME_MIN` (High performance) — record the previous scheme GUID (`powercfg /getactivescheme`) and restore it in the step's finalisation; (3) close browsers/IDEs/AV scans; (4) no other CPU-heavy job — in particular **never run divergence work concurrently**; (5) `typeperf` sampling of `\Processor Information(_Total)\Processor Frequency` and `\% Performance Limit` at 1 s during each run, summarised into the record's optional `cpuMHzBefore/After` fields (source: claim B-11).
`powercfg /setactive` changes a machine setting: it is reversible and local, but the implementer must restore the recorded scheme in the same step (`Finalisation` action).

## What the planning agent verified by execution

| Command / probe | Result |
|---|---|
| `git push --dry-run origin HEAD:refs/heads/gen-probe` | permitted |
| `node plans/perf-divergence/research/spikes/sp4-webgpu.mjs` | Chrome channel: adapter present headless & headed; bundled Chromium: `adapter: null` |
| `python -m venv` + `pip install` of the pinned wheels | succeeded; ORT 1.30.0 reports providers `[Azure, CPU]` |
| `sp5-model-inspect.py` on the cached model | sha matches; 24,917 nodes |
| native ORT run of chunk 3 (D-12 options): create ≈ 42 s, run ≈ 12 s | ok |
| Node + ORT Web 1.30 WASM single thread (D-12 options): create ≈ 18–20 s, run ≈ 35–42 s | ok |
| `npm run typecheck` with the new stubs/tests | clean |
| `npx vitest run --project node` | 54 existing pass; 65 new fail cleanly (red, by design) |
| `pytest tests/divergence` | 44 fail + 5 setup errors (red); 4 fixture-integrity tests pass by design (data guards) |

## Credentials

None required. No deploy keys, tokens or registry credentials are used by any step. Filing an upstream issue (which would need the human's GitHub identity) is a G-103 human action.
