# Question tree

Leaves name the decision / test / step they inform. Status: ✔ answered (claim), ◐ answered with a residual risk, ○ open → carried to a plan step.

## Engineering (software)
- E1 Why are the recorded perf numbers unreliable? → ✔ C-101 (timer defect) → D-101, T-101..T-106
- E2 How are perf figures to be measured correctly? → ✔ per-event timeline (D-101), ≥3 runs/median (D-103), controls (D-110); GPU timing semantics ◐ C-306/C-307 (single-source; S-104 measures first vs steady runs; D-110 rule 8)
- E3 Can WebGPU be measured on this machine? → ✔ C-106 (Chrome channel) → D-111, S-103..S-105
- E4 How do we select Chrome in Vitest without disturbing firefox/webkit? → ✔ C-107, B-2 → D-111 (separate project)
- E5 How do we throttle to 50 Mbit/s and prove it applied? → ◐ C-313..C-315 (CDP emulate; Worker/redirect coverage unverified) → D-111 validity gate, S-104 throttle spike
- E6 Can a browser test write result files? → ◐ C-109 (typings only) → D-111 fallback `PERFRECORD`, S-103 verifies
- E7 Can we run the report CLI without a build step? → ✔ C-108
- E8 What is the default thread count and what did PERF.md use? → ✔ C-303 (ORT default min(4, ceil(hc/2)) = 2 here; repo override = hc−1 = 3)
- E9 Cold cache in a fresh Playwright context? → ✔ C-316 (fresh context ⇒ empty Cache Storage)
- E10 Are there published M1/M2 htdemucs ORT-Web numbers? → ✔ (none found, C-312) → A-101 (no M1; `unmeasured`)

## Computational (numerical divergence)
- N1 Does the SP-3 divergence reproduce, and where? → ✔ C-102, C-103 (original fixture yes; regenerated no) → D-105, S-108
- N2 Can we compare runtimes node-by-node? → ✔ C-104 → D-107, S-107, S-109
- N3 Can we run WASM without a browser? → ✔ C-105 → D-107 (Node harness) + D0b browser confirmation
- N4 Where does the disagreement arise inside the graph? → ○ S-109 (D3 bisection); early hint C-112
- N5 Which runtime is right for the decisive op? → ✔ method C-113 (float64 oracle; floor calibrated) → S-110; ✔ constants ◐ C-114 (judgement)
- N6 How are InstanceNorm / LayerNorm / denormals implemented natively vs WASM? → ○ agent A (`research/rounds/round-1-A.md`); hypotheses list is input to D2/D3, not to a decision
- N7 What does an upstream report need? → ○ agent A (issue template fields) → S-111 draft

## Policy / process
- P1 Which thresholds are targets? → ✔ frozen from plan/PLAN.md T-027..T-030 (A-109)
- P2 What happens on a miss? → ✔ D-103 + decision rules; human decides at G-101
- P3 What if the divergence can't be explained in budget? → ✔ A-103, D-106 `UNRESOLVED`, D-109
