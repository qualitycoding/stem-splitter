// Generic single-input-set ORT Web WASM runner for D4 op-level isolation (plans/perf-divergence
// S-110): unlike run-wasm-node.mjs (hardcoded to the full model's single "mix" (1,2,343980)
// input), this takes an arbitrary set of named inputs with their own shapes, for the small
// single-node models D4 builds from real graph nodes.
//
//   node run-wasm-node-generic.mjs <model.onnx> <inputs.json> <outprefix>
//
// inputs.json: [{"name": "...", "shape": [...], "path": "<raw float32 dump>"}, ...]
// Writes "<outprefix>.0.f32" (the model's first/only output) and prints one JSON line:
// {"outputName", "dims", "ort_version"}.
import { readFileSync, writeFileSync } from "node:fs";
import * as ort from "onnxruntime-web";

const [modelPath, inputsJsonPath, outPrefix] = process.argv.slice(2);
if (!modelPath || !inputsJsonPath || !outPrefix) {
  console.error("usage: run-wasm-node-generic.mjs <model.onnx> <inputs.json> <outprefix>");
  process.exit(2);
}

ort.env.wasm.numThreads = 1;

function readFloat32File(path) {
  const buf = readFileSync(path);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / Float32Array.BYTES_PER_ELEMENT);
}

const inputSpecs = JSON.parse(readFileSync(inputsJsonPath, "utf8"));

const session = await ort.InferenceSession.create(readFileSync(modelPath), {
  executionProviders: ["wasm"],
  graphOptimizationLevel: "disabled",
  enableCpuMemArena: false,
  enableMemPattern: false,
});

const feed = {};
for (const spec of inputSpecs) {
  feed[spec.name] = new ort.Tensor("float32", readFloat32File(spec.path), spec.shape);
}
const outputName = session.outputNames[0];
const results = await session.run(feed);
const output = results[outputName];

writeFileSync(`${outPrefix}.0.f32`, Buffer.from(output.data.buffer, output.data.byteOffset, output.data.byteLength));
console.log(JSON.stringify({ outputName, dims: output.dims, ort_version: ort.env.versions?.web ?? "unknown" }));
