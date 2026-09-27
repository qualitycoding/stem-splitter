# GATES

At a gate the implementer **halts**, writes `plans/perf-divergence/GATE-<id>.md` (evidence bundle below, numbers copied from generated files, never retyped), commits it, and waits for a human reply. The implementer never proceeds on silence and never answers for the human.
Gate numbering avoids the app plan's `G-002` (deployment). Mapping to protocol Rule 10: `G-101`,`G-102` ≡ protocol `G-001` (headline results); `G-103` ≡ protocol `G-002` (external/irreversible actions).

## G-101 — Perf headline result

| Field | Content |
|---|---|
| Trigger step | **S-106**, after `perf/REPORT.md` is generated and T-107..T-113 pass; before S-112 (docs) and before anything cites the numbers |
| Evidence bundle | `perf/REPORT.md`; verdict table (5 rows); the list of `perf/results/*.json`; drift/abort notes (D-110); the throttle-validity statement (D-111); unchanged thresholds (A-109); statement that `T-027-M1` is `unmeasured` (A-101) |
| Questions | (1) Are the verdicts accepted as the record for the app's G-002? (2) For each `fail`: accept, or open a separate optimisation/rescope plan? (3) Waive `T-027-M1` (no M1) for the deployment decision? (4) Is `unmeasured` acceptable for any row that could not be measured (state which)? |
| Responses | `proceed` → S-112 (docs) may run; `proceed-with-rescope: <text>` → implementer records the rescope verbatim in `DEVIATIONS.md` and the report's "Human decisions" section, and edits **no threshold** unless the text names the threshold and its new value; `stop` → write `HALTED.md`, stop, leave all committed artifacts |
| Branch taken | as above; the divergence track (S-107…) is independent and may start before or after sign-off **but never while a measurement run is active** (D-110 rule 1) |

## G-102 — Divergence headline result

| Field | Content |
|---|---|
| Trigger step | **S-110**, after `classify_outcome` returns (or the budget is exhausted) and `research/divergence/REPORT.md` is written; before S-111 (outcome actions) |
| Evidence bundle | `research/divergence/REPORT.md` with: D0 result (and D0b), the D1 trigger table, the D2 matrix, the D3 profile and window, D4 per-candidate errors vs oracle and the `judge_op` result, the returned outcome name, the `BUDGET.md` totals, and (if `AMPLIFICATION`) the perturbation table |
| Questions | (1) Accept the outcome classification? (2) Approve the S-111 action row of D-109 for this outcome (including, when it applies, the exactly-mono UI notice)? (3) Is the divergence non-blocking for deployment (A-104)? |
| Responses | `proceed` → S-111 exactly per D-109; `proceed-with-rescope: <text>` → S-111 per the text (implementer may not exceed it); `extend-budget: <hours>` → allowed **only** when the outcome is `UNRESOLVED`; adds that many compute hours to D-106's budget and resumes the ladder at the rung where it stopped; `stop` → `HALTED.md` |
| Branch taken | recorded in `GATE-G-102.md` |

## G-103 — External / irreversible actions

| Field | Content |
|---|---|
| Trigger | Any step that would (a) merge or push to `main`, (b) open a pull request, (c) file, comment on, or post an upstream issue (e.g. microsoft/onnxruntime), (d) deploy or enable GitHub Pages / create `.github/workflows/deploy.yml`, (e) publish a package. **No step in this plan performs any of these.** The gate exists so an implementer who is tempted (e.g. to "send the upstream issue draft") halts instead. |
| Evidence bundle | The artifact proposed for release (e.g. `research/divergence/UPSTREAM_ISSUE.md`), the diff of the branch, `npm run verify:frozen` + test results |
| Questions | "Take action X?" (the action is named) |
| Responses | `proceed` (only for the named action) / `stop` |
| Branch taken | on `proceed` the *human* (or a new plan) performs the action; the implementer of this plan still does not |

No other gate is defined; `software.deploys = false`.
