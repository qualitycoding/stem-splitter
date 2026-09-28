// Batch runner for the D1 input sweep (plans/perf-divergence S-108): creates ONE ORT Web WASM
// session and runs every variant through it, instead of paying session-creation cost (~30 s)
// per variant.
//
//   node run-wasm-node-batch.mjs <model.onnx> <manifest.json> <out-dir>
//
// manifest.json: [{"name": "...", "input": "<path to a raw float32 (1,2,343980) dump>"}, ...]
// Writes "<out-dir>/<sanitized-name>.f32" per variant (primary output only) and prints one
// JSON line: {"ort_version", "create_s", "variants": [{"name", "run_s", "dims"}]}.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as ort from "onnxruntime-web";

const [modelPath, manifestPath, outDir] = process.argv.slice(2);
if (!modelPath || !manifestPath || !outDir) {
  console.error("usage: run-wasm-node-batch.mjs <model.onnx> <manifest.json> <out-dir>");
  process.exit(2);
}

ort.env.wasm.numThreads = 1;

function readFloat32File(path) {
  const buf = readFileSync(path);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / Float32Array.BYTES_PER_ELEMENT);
}
function sanitize(name) {
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const t0 = performance.now();
const session = await ort.InferenceSession.create(readFileSync(modelPath), {
  executionProviders: ["wasm"],
  graphOptimizationLevel: "disabled",
  enableCpuMemArena: false,
  enableMemPattern: false,
});
const createS = (performance.now() - t0) / 1000;

const inputName = session.inputNames[0];
const outputName = session.outputNames[0];

const results = [];
for (const variant of manifest) {
  const data = readFloat32File(variant.input);
  const t1 = performance.now();
  const out = await session.run({ [inputName]: new ort.Tensor("float32", data, [1, 2, 343980]) });
  const runS = (performance.now() - t1) / 1000;
  const output = out[outputName];
  writeFileSync(join(outDir, `${sanitize(variant.name)}.f32`), Buffer.from(output.data.buffer, output.data.byteOffset, output.data.byteLength));
  results.push({ name: variant.name, run_s: runS, dims: output.dims });
}

console.log(JSON.stringify({ ort_version: ort.env.versions?.web ?? "unknown", create_s: createS, variants: results }));
