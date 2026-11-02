# Traceability

| Success criterion | Tests | Steps |
|---|---|---|
| Accepts common audio formats, any sample rate, mono/stereo | T-001, T-002, T-003, T-009 | S-002 |
| Correct separation (matches reference implementation) | T-004, T-005, T-006, T-011, T-013 | S-003, S-005 |
| Numerically robust output | T-014, T-015, T-016 | S-005 |
| Usable outputs (WAV, progress) | T-007, T-008 | S-005 |
| Works across browsers/EPs, degrades gracefully | T-010, T-018, T-023 | S-001, S-004 |
| Model delivery reliable and verified | T-012, T-020, T-022 | S-004 |
| Model loads within the 4 GB wasm heap | T-033, T-017 | S-004 |
| Resource limits respected | T-017, T-021 | S-005, S-007 |
| UI responsive, startup without model | T-019 | S-006 |
| Privacy & security | T-024, T-025, T-026 | S-007 |
| Performance targets | T-027, T-028, T-029, T-030 | S-007 |
| Reproducibility/provenance | T-031 | S-005 |
| Live deployment works | T-032 | S-008 |

## v3.9 addendum traceability (2026-11-02)

| Requirement | Artifact | Step | Verification |
|---|---|---|---|
| Gap ledger per planning root | `plan/ADDENDUM-V3.9-GAP.md` | S-ADD-001 | `v39_addendum_verify.py final` |
| Planning-only scope freeze | D-900 in `plan/DECISIONS.md` | S-ADD-001 | verifier + retrospective |
| Mutation three-tier priced CI, aggregator, report score gate | `reviews/MUTATION.md` | S-ADD-080 | verifier + first CI run (pending in CI) |
| Split lesson/knowledge stores | G-003 in `plan/GATES.md`, `.checkpoints/state.json` | S-ADD-010/S-ADD-060 | verifier |
| Full-context checkpoints / zero-context resume | `.checkpoints/state.json` | S-ADD-020 | verifier |
| Assumption audit, reviews | `premortem/ASSUMPTION_AUDIT.md`, `reviews/` | S-ADD-030 | verifier |
| Honest verification, deviations | `DEVIATIONS.md`, `EXECUTION_LOG.md` | S-ADD-040 | verifier |
| Ephemeral protections | `plan/ENVIRONMENT.md` | S-ADD-050 | verifier |
| CI platform matrix | `plan/CI-MATRIX.md` | S-ADD-070 | cold read |
| Cold read / pre-mortem | this file, `premortem/RISK_REGISTER.md` | S-ADD-090 | verifier |
