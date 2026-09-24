# Stem Splitter

Browser-based audio stem separation (vocals / drums / bass / other) using
HT-Demucs exported to ONNX and run with ONNX Runtime Web. Audio never leaves
the user's device. Deployed as a static site on GitHub Pages.

**Status:** implemented (S-001–S-007); not yet deployed (S-008 awaits sign-off). CI (`.github/workflows/tests.yml`) is the first real run of the browser test suite — see `HANDOFF.md`.

## Development

```sh
npm ci
npm run dev          # http://localhost:5173, cross-origin isolated
npm test              # pure-logic unit tests (Node, fast)
npm run test:browser  # real-browser tests (Playwright; installs browsers first: npx playwright install)
npm run build          # production build to dist/
```

- Execution plan: [`plan/PLAN.md`](plan/PLAN.md)
- Review of the original plan and what changed: [`plan/REVIEW.md`](plan/REVIEW.md)
- Handoff for implementers: [`HANDOFF.md`](HANDOFF.md)

Licensed under the Apache License 2.0 — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
