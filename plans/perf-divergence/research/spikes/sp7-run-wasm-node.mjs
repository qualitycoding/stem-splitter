// Runs a model on <outdir>/in_chunkK.f32 with ORT Web WASM under Node (D-12 options); saves output i as <tag>.<i>.f32.
import * as ort from "onnxruntime-web";
import { readFileSync, writeFileSync } from "node:fs";
const [model, out, k, tag] = process.argv.slice(2);
ort.env.wasm.numThreads = 1;
const input = new Float32Array(readFileSync(`${out}/in_chunk${k}.f32`).buffer.slice(0));
const s = await ort.InferenceSession.create(readFileSync(model), { executionProviders: ["wasm"], graphOptimizationLevel: "disabled", enableCpuMemArena: false, enableMemPattern: false });
const r = await s.run({ mix: new ort.Tensor("float32", input, [1, 2, 343980]) });
const shapes = s.outputNames.map((n, i) => { const t = r[n]; writeFileSync(`${out}/${tag}.${i}.f32`, Buffer.from(t.data.buffer, t.data.byteOffset, t.data.byteLength)); return t.dims; });
console.log(JSON.stringify({ names: s.outputNames, shapes }));
