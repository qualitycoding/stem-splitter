# HANDOFF

Start with `plan/REVIEW.md` (why the plan changed), then execute `plan/PLAN.md`
step by step. Do **not** create `.github/workflows/deploy.yml` until gate G-002
is signed off; the template lives in `plan/templates/deploy.yml`.

Before S-004, run spike SP-1 (research/SOURCES.md, "Open verification items")
— the model download sizes, CORS/redirect hosts and fp16weights in-memory size
have not yet been measured from a browser.

Checkpoint state: `.checkpoints/state.json`.
