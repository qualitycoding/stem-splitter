# Performance record (T-027 – T-030)

Recorded 2026-09-25 with `tests/browser/performance.test.ts`
(`VITE_RUN_PERFORMANCE_TESTS=1`, optionally `VITE_TEST_ISOLATE=1` for the
multi-threaded path). Informational — see plan/PLAN.md "Performance".

## Machine

Intel Core i5-6200U (2 cores / 4 threads, 2.3 GHz), Windows 10, Playwright
Chromium (headless), onnxruntime-web 1.30.0, `htdemucs` fp16weights,
D-12 session options. 20 s clip = 4 model runs (chunks).

## Measured

| Config | model-ready¹ | separation (4 chunks) | per chunk | 4-min song, 42 chunks (extrapolated) |
|---|---|---|---|---|
| WASM, 3 threads (COOP/COEP) | 74.0 s | 61.7 s | 15.4 s | ≈ 10.8 min |
| WASM, 1 thread (not isolated — "slow mode") | 87.8 s | 105.0 s | 26.3 s | ≈ 18.4 min |

¹ Fresh browser profile, so this includes the ~166 MB model download on this
connection plus session creation; the two are not timed separately.

Extrapolation is linear in chunk count (42 = ceil(4 min × 44.1 kHz / 257,985))
and has not been confirmed with a real 4-minute run.

## Against the targets

| Test | Target | Status |
|---|---|---|
| T-027 WASM multi-thread, 4-min song | < 6 min on M1 Air; ≤ 16 min on the SP-2 reference machine | **Not measured on either reference machine.** This i5-6200U extrapolates to ≈ 10.8 min (3 threads), inside the 16-min bound; slow mode ≈ 18.4 min. |
| T-028 WebGPU, 4-min song | separation < 90 s, session creation < 60 s | **Not measured** — headless Chromium here exposes no WebGPU adapter. |
| T-029 cold model download at 50 Mbps | < 45 s | **Not measured** — download not timed separately (see ¹). |
| T-030 High quality, 4-min song, WebGPU | < 8 min | **Not measured** — needs WebGPU. |

The T-027 SP-2 number (21.8 s/chunk on a 4-core Gen9 Intel) is from a
different machine than this one; the two are not directly comparable.

## To fill in before G-002 (needs hardware not available here)

WebGPU numbers (T-028, T-030) and the M1 Air T-027 figure, on a machine with a
real GPU/Chrome: `VITE_TEST_ISOLATE=1 VITE_RUN_PERFORMANCE_TESTS=1 npm run test:browser -- performance`
in headed Chrome, and a real 4-minute input through the UI.
