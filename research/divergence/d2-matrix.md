# D2 pairwise rel_l2 matrix (vocals)

| vs |native_fp16_default|native_fp16_threads1|native_fp16_threads4|native_fp16_denormal_as_zero|native_fp32_default|webgpu_fp16|
|---|---|---|---|---|---|---|
| native_fp16_default | 0 | 0 | 0 | 0 | 0.00381753 | 1 |
| native_fp16_threads1 | 0 | 0 | 0 | 0 | 0.00381753 | 1 |
| native_fp16_threads4 | 0 | 0 | 0 | 0 | 0.00381753 | 1 |
| native_fp16_denormal_as_zero | 0 | 0 | 0 | 0 | 0.00381753 | 1 |
| native_fp32_default | 0.00381042 | 0.00381042 | 0.00381042 | 0.00381042 | 0 | 1 |
| webgpu_fp16 | inf | inf | inf | inf | inf | 0 |

denormal_as_zero: requested
webgpu meta: {"outputNames": ["stems"], "shapes": {"stems": [1, 4, 2, 343980]}, "create_s": 49.027, "run_s": 10.094, "ort_version": "1.30.0", "executionProvider": "webgpu", "requestedThreads": 1, "actualThreads": 1, "crossOriginIsolated": false, "consoleErrorCount": 513, "consoleErrors": ["Failed to load resource: the server responded with a status of 404 (Not Found)", "\u001b[0;93m2026-09-28 10:11:06.567999 [W:onnxruntime:, session_state.cc:1397 VerifyEachNodeIsAssignedToAnEp] Some nodes were not assigned to the preferred execution providers which may or may not have an negative impact on performance. e.g. ORT explicitly assigns shape related ops to CPU to improve perf", "\u001b[0;93m2026-09-28 10:11:06.580799 [W:onnxruntime:, session_state.cc:1399 VerifyEachNodeIsAssignedToAnEp] Rerunning with verbose output on a non-minimal build will show node assignments.\u001b[m", "An uncaught WebGPU validation error was raised: Error while parsing WGSL: :7:70 error: 'f16' type used without 'f16' extension enabled\n      @group(0) @binding(0) var<storage, read> inputData: array<vec4<f16>>;\n                                                                     ^^^\n\n\n - While calli", "An uncaught WebGPU validation error was raised: [Invalid ShaderModule \"Cast\"] is invalid due to a previous error.\n - While validating compute stage ([Invalid ShaderModule \"Cast\"], entryPoint: \"main\").\n - While calling [Device].CreateComputePipeline([ComputePipelineDescriptor \"\"Cast\"\"]).\n", "An uncaught WebGPU validation error was raised: [Invalid ComputePipeline \"Cast\"] is invalid due to a previous error.\n - While Validating GetBindGroupLayout (0) on [Invalid ComputePipeline \"Cast\"]\n", "An uncaught WebGPU validation error was raised: [Invalid BindGroupLayout (unlabeled)] is invalid due to a previous error.\n - While validating [BindGroupDescriptor \"\"Cast\"\"] against [Invalid BindGroupLayout (unlabeled)]\n - While calling [Device].CreateBindGroup([BindGroupDescriptor \"\"Cast\"\"]).\n", "An uncaught WebGPU validation error was raised: [Invalid ComputePipeline \"Cast\"] is invalid due to a previous error.\n - While encoding [ComputePassEncoder (unlabeled)].SetPipeline([Invalid ComputePipeline \"Cast\"]).\n - While finishing [CommandEncoder (unlabeled)].\n", "An uncaught WebGPU validation error was raised: [Invalid CommandBuffer] is invalid due to a previous error.\n - While calling [Queue].Submit([[Invalid CommandBuffer]])\n"]}

## WebGPU result is NOT usable evidence in this environment

`webgpu_fp16`'s output is **entirely zero** (verified: min=max=mean(abs)=0, no NaNs — a
real computation failure, not a numeric coincidence). The console errors show why: WGSL
shader compilation fails with `'f16' type used without 'f16' extension enabled` on the
model's first `Cast` node, which cascades into every downstream WebGPU operation being
invalid. This is this execution environment's GPU backend (headless Chrome's software
WebGPU implementation in this cloud container) lacking the `shader-f16` WebGPU feature —
not a finding about native-vs-WASM numerical divergence. The `inf`/`1.0` entries against
`webgpu_fp16` above reflect "compared against all-zero output," not a real distance.

**Caveat this raises for earlier data**: the one `webgpu-standard` perf record gathered
from *this* cloud container during S-103
(`perf/results/webgpu-standard-golden-20s-20260927T114653Z.json`) almost certainly hit
the same failure — its timing may reflect an early-failing, degenerate computation
rather than genuine separation. It never counted toward any T-02x/T-030 verdict (all
verdicts require `durationSeconds >= 240`; that record is 20 s), but it *does* feed the
report's "indicative extrapolation" row, which should be read with this in mind. The
three real `webgpu-standard` records and one `webgpu-hq` record gathered on the user's
own laptop (real GPU hardware, not a software renderer) are unaffected by this specific
failure mode — modern real GPUs support `shader-f16` — but this wasn't independently
re-verified on that hardware.

