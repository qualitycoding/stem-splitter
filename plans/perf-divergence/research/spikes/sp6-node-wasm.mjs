// SP-6b: can ORT Web 1.30 (WASM EP) run htdemucs under Node with the D-12 options?
// Usage: node sp6-node-wasm.mjs <model.onnx> <outdir> [chunk=3]
import * as ort from "onnxruntime-web";
import { readFileSync, writeFileSync } from "node:fs";
const [model, out, k = "3"] = process.argv.slice(2);
ort.env.wasm.numThreads = 1;
const input = new Float32Array(readFileSync(`${out}/in_chunk${k}.f32`).buffer.slice(0));
const t0 = performance.now();
const session = await ort.InferenceSession.create(readFileSync(model), {
  executionProviders: ["wasm"], graphOptimizationLevel: "disabled", enableCpuMemArena: false, enableMemPattern: false });
const t1 = performance.now();
const res = await session.run({ mix: new ort.Tensor("float32", input, [1, 2, 343980]) });
const t2 = performance.now();
writeFileSync(`${out}/wasmnode_chunk${k}.f32`, Buffer.from(res.stems.data.buffer));
console.log(JSON.stringify({ ort: ort.env.versions?.web, create_s: +((t1 - t0) / 1000).toFixed(1), run_s: +((t2 - t1) / 1000).toFixed(1), dims: res.stems.dims }));
