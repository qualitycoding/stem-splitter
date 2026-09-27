# Local performance check

A small standalone page — decoupled from the main app's build and from the
`plans/perf-divergence` S-104/S-105 vitest-driven matrix (which needs a
"serial machine" and isn't meaningful in a cloud execution container) — that
runs one real separation in your own browser and reports the timing.

## Run it

```sh
npm ci   # once, from the repo root
npm run perf:standalone:build
npm run perf:standalone:preview
```

Open the printed `http://localhost:...` URL, pick an audio file, click **Run
separation**. Nothing is uploaded — the file never leaves the tab. The
result is shown as a table and as JSON shaped exactly like a
`perf/results/*.json` run record (validated with the same
`validateRunRecord()` the real matrix uses); the **Download result.json**
button saves it under the id the record itself uses, so you can drop it
straight into `perf/results/` if you want it counted.

`npm run perf:standalone:dev` runs it with hot reload instead, if you're
editing `main.ts`/`index.html`.

## Notes

- The **config** shown (`wasm-1t` / `wasm-mt` / `webgpu-standard` /
  `webgpu-hq`) is derived from what actually happened (execution provider,
  thread count, mode) — never from a menu choice — so a silent WebGPU→WASM
  or multi→single-thread fallback can't be mislabelled.
- Multi-threaded WASM needs cross-origin isolation; this page installs the
  same `coi-serviceworker` trick the main app uses (works even when hosted
  somewhere, like GitHub Pages, that can't set custom response headers).
  The isolation status line at the top says whether it's active.
- CPU model and AC-power state aren't reliably readable from a browser, so
  they're plain text/select inputs you can fill in yourself.
- This directory is deliberately its own Vite project (see
  `vite.config.ts`'s header comment) so it can never end up bundled into the
  real deployed app — deployment stays out of scope for
  `plans/perf-divergence` (`plan/PROFILE.md`: `software.deploys = false`).
