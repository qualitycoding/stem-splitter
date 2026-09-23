# HANDOFF

Start with `plan/REVIEW.md` (why the plan changed), then execute `plan/PLAN.md`
step by step. Do **not** create `.github/workflows/deploy.yml` until gate G-002
is signed off; the template lives in `plan/templates/deploy.yml`.

**Current status: blocked at S-000.** SP-1 is done (`research/spikes/SP-1.md`); the model fails to load in ORT Web with `std::bad_alloc`. Run `python3 research/spikes/sp2.py` and resolve C-012 before starting S-001.

Originally: before S-004, run spike SP-1 (research/SOURCES.md, "Open verification items")
— the model download sizes, CORS/redirect hosts and fp16weights in-memory size
have not yet been measured from a browser.

Checkpoint state: `.checkpoints/state.json`.
