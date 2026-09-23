# HANDOFF

Start with `plan/REVIEW.md` (why the plan changed), then execute `plan/PLAN.md`
step by step. Do **not** create `.github/workflows/deploy.yml` until gate G-002
is signed off; the template lives in `plan/templates/deploy.yml`.

**Current status: S-000 done; start at S-001.** The model loads only with graph optimisation disabled — every session must use the D-12 options (`plan/DECISIONS.md`). See `research/spikes/SP-2.md`.

Originally: before S-004, run spike SP-1 (research/SOURCES.md, "Open verification items")
— the model download sizes, CORS/redirect hosts and fp16weights in-memory size
have not yet been measured from a browser.

Checkpoint state: `.checkpoints/state.json`.
