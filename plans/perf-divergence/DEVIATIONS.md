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

## S-103 — `commands`/`cdp` from "@vitest/browser/context" unusable on pinned vitest 5.0.1

D-111 specifies `commands.writeFile` for writing `perf/results/*.json` and `cdp()` for
CDP network throttling (T-029), with an explicit documented fallback for each
("commands.writeFile unavailable -> PERFRECORD stdout fallback"; "cdp() permission
error -> ... if still failing, throttled runs are impossible -> T-029 unmeasured").

On this repo's pinned toolchain (vitest/@vitest/browser/@vitest/browser-playwright
5.0.1, plan/ENVIRONMENT.md), importing anything from `"@vitest/browser/context"`
(`commands`, `cdp`, `page`, etc.) throws `"vitest/browser can be imported only inside
the Browser Mode. Your test is running in browser pool."` even from inside a real,
successfully-launched Playwright browser test — reproduced with a minimal one-line
repro file in both the new "perf" project and the pre-existing "browser" project
(tests/browser/*.test.ts), so it is not specific to this plan's config. This is the
same class of bug fixed upstream in vitest-dev/vitest#8657/#8658 ("fix(browser):
exclude deprecated context import from optimization"), on a later version than the
one pinned here. Also applied an `optimizeDeps.exclude: ["@vitest/browser/context"]` /
`include: ["onnxruntime-web"]` workaround in `vitest.config.ts` mirroring that fix;
it did not resolve the throw (upstream's actual fix touched vitest's own
`packages/browser/src/node/plugin.ts`, not something reachable from user config), but
is left in place as it's harmless and matches Vitest's own guidance for the
onnxruntime-web mid-collection reload it separately prevents.

Action taken (`perf/harness/run.perf.ts`, see its file-header comment):
- Input file reading uses a plain `fetch("/" + path)` against the dev server (proven
  to work; Vite serves any file under the project root) instead of `commands.readFile`.
- Result writing always uses the documented `PERFRECORD {json}` stdout fallback (one
  compact-JSON line) — never attempts `commands.writeFile`. `scripts/perf/run-matrix.mjs`
  parses it inline for driven runs; a new `scripts/perf/collect.mjs` does the same via
  a stdin pipe for standalone/manual invocations (S-103 step 7's smoke command).
- CDP throttling is skipped entirely (no `cdp()` call is reachable): a cold+throttled
  run logs a warning and proceeds unthrottled, so `throttleMbps` is always `null` for
  it — T-029 will read as `unmeasured` for as long as this environment is used for
  measurement. This is exactly the outcome DECISIONS.md's "Engineering forks" already
  sanctions for a `cdp()` failure ("if still failing, throttled runs are impossible ->
  T-029 unmeasured, continue"), so no threshold or test was changed.

Verified end-to-end: `VITE_TEST_ISOLATE=1 VITE_PERF_CONFIG=webgpu-standard
VITE_PERF_INPUT=tests/fixtures/golden-20s.wav npx vitest run --project perf
--reporter=verbose | node scripts/perf/collect.mjs` produced a real RunRecord
(`executionProvider: "webgpu"`) that `scripts/perf/validate.ts` accepts.
