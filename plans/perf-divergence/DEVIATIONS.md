# DEVIATIONS

## S-101 — frozen-manifest write before baseline verification

`npm run verify:frozen` initially failed: the ten test/fixture files delivered by the
planning phase under `tests/divergence/`, `tests/fixtures/diagnostic/`, and
`tests/unit/perf-*.test.ts` had never been registered in
`tests/FROZEN_MANIFEST.sha256` (the planning agent created them but did not run
`--write`). This is not a case of an existing frozen test being edited or weakened —
it is purely additive registration of new files, the same operation the plan itself
prescribes later (S-108 step 4, S-109) whenever a new test is added ("add a new test
... then `node scripts/frozen-manifest.mjs --write`").

Action taken: ran `node scripts/frozen-manifest.mjs --write` (wrote 42 entries) before
proceeding with the rest of S-101's baseline checks. Re-verified green afterwards.

Rationale: default rule permits the most reversible option that doesn't expand scope
and doesn't touch frozen tests; registering new files is explicitly the mechanism the
plan uses for this, not an exception to it.
