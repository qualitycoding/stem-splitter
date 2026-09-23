# Stem Splitter

Browser-based audio stem separation (vocals / drums / bass / other) using
HT-Demucs exported to ONNX and run with ONNX Runtime Web. Audio never leaves
the user's device. Deployed as a static site on GitHub Pages.

**Status:** blocked at the first spike — the published ONNX model runs out of memory loading in ONNX Runtime Web; diagnosis in progress (`research/spikes/`).

- Execution plan: [`plan/PLAN.md`](plan/PLAN.md)
- Review of the original plan and what changed: [`plan/REVIEW.md`](plan/REVIEW.md)
- Handoff for implementers: [`HANDOFF.md`](HANDOFF.md)

Licensed under the Apache License 2.0 — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
