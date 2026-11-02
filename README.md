# Stem Splitter

Browser-based audio stem separation (vocals / drums / bass / other) using
HT-Demucs exported to ONNX and run with ONNX Runtime Web. Audio never leaves
the user's device. Deployed as a static site on GitHub Pages.

**Status:** implemented (S-001–S-007); the last recorded CI run passed on Chromium, Firefox and WebKit (54 Node unit tests plus the browser suite); not deployed (S-008 awaits sign-off at gate G-002). See `HANDOFF.md`.

## Development

```sh
npm ci
npm run dev          # http://localhost:5173, cross-origin isolated
npm test              # pure-logic unit tests (Node, fast)
npm run test:browser  # real-browser tests (Playwright; installs browsers first: npx playwright install)
npm run build          # production build to dist/
```

## Performance and known limits

- **Speed is not established.** Timings on an old laptop CPU (i5-6200U) were about 15 s per audio chunk with 3 WASM
  threads and 26 s single-threaded. WebGPU and Apple M1 speed have not been measured on real hardware.
  A later investigation on branch `impl/perf-divergence` (`perf/REPORT.md` there) recorded that
  session creation fails its time threshold (T-028), with separation time inside its bound, and that T-027,
  T-029 and T-030 are still unmeasured.
- **Odd input can differ between runtimes.** Exactly-mono, exactly-periodic synthetic input (for example a pure
  tone) can give large numerical disagreement between the WASM and native ONNX Runtime. Ordinary music was
  unaffected in the tests. The write-up is on `impl/perf-divergence` (`research/divergence/REPORT.md`).
- Two checks are manual only: the service-worker reload (T-018) and the live content-security-policy allow-list (T-025).

- Execution plan: [`plan/PLAN.md`](plan/PLAN.md)
- Review of the original plan and what changed: [`plan/REVIEW.md`](plan/REVIEW.md)
- Handoff for implementers: [`HANDOFF.md`](HANDOFF.md)

Licensed under the Apache License 2.0 — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
