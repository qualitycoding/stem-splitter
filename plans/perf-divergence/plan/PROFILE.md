# PROFILE

Task: **perf-and-divergence** — (1) replace the unreliable / unmeasured performance figures in `tests/PERF.md` with a correct, provenance-stamped record;
(2) investigate the unexplained WASM-vs-native divergence documented in `research/spikes/SP-3.md` to a root cause or a bounded, evidenced outcome.

| Profile | Active | Justification |
|---|---|---|
| software | yes | Adds instrumentation modules (`src/perf/`), a perf harness, a divergence harness, and edits to repo docs/tests |
| computational | yes (implies software) | Deliverables are measured timings and numerical comparisons whose validity depends on method and provenance |
| math | **no** | No mathematical statements or proofs are produced |
| publication | **no** | No manuscript or archive deposit (a drafted upstream issue text is a repo document, not a manuscript) |

## Mode flags

| Flag | Value | Justification |
|---|---|---|
| math.exploration | n/a | `math` inactive |
| software.deploys | **false** | Deployment (main plan S-008 / G-002) is explicitly out of scope; this plan produces evidence for that gate but takes no deployment action |

## Not-applicable sections (no artifacts, no checks)

- Rule 7 (evidence classes), Phase 2A (all: 2A.0–2A.5), 2D (manuscript), `research/NOVELTY.md`, `math/`, `manuscript/`
- `plan/OPERATIONS.md` (`software.deploys = false`)
- Publication-only lines of the severity rubric, Phase 0.3.3 / 0.3.5, Phase 4 lenses tagged `[math]`, `[publication]`, `[math, publication]`
- `figures/SPEC.md` (2C): the perf report is a table, not a figure. (`computational` would normally trigger 2C; recorded as **N/A by decision D-112**: no figure is a deliverable. If a chart is later wanted it needs a new plan.)

## Plan root and ID namespacing (D-113)

The repository already holds the shipped-app plan (`plan/`, `research/`, `HANDOFF.md`, `.checkpoints/`) with IDs `S-000..S-008`, `T-001..T-033`, `D-01..D-13`, `C-0xx`, `G-002`.
To avoid destroying or colliding with it, **this plan lives entirely under `plans/perf-divergence/`** and uses disjoint ID ranges:

| Kind | This plan | Existing app plan |
|---|---|---|
| Steps | `S-101…` | `S-000…S-008` |
| Tests | `T-101…` (T-1xx perf, T-2xx divergence) | `T-001…T-033` |
| Decisions | `D-101…` | `D-01…D-13` |
| Claims | `C-101…` | `C-0xx` |
| Assumptions | `A-101…` | — |
| Gates | `G-101, G-102, G-103` | `G-002` (deployment) |
| Risks | `R-101…` | `R-0x` |

Protocol gate mapping: protocol `G-001` (headline result) ≡ `G-101` (perf) and `G-102` (divergence); protocol `G-002` (external/irreversible) ≡ `G-103`.
Frozen tests live in the repo's real `tests/` tree (Vitest and pytest must find them) and are covered by the repo's existing `tests/FROZEN_MANIFEST.sha256` mechanism.
