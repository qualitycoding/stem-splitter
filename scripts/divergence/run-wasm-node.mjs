#!/usr/bin/env node
// Runs one model + one chunk through ORT Web's WASM EP under Node, for the
// native-vs-WASM divergence harness (plans/perf-divergence D-105, D-107).
// numThreads=1 and the D-12 session options, matching the frozen native
// side exactly (scripts/divergence/harness.py).
//
//   node run-wasm-node.mjs <model.onnx> <input.f32> <outprefix> [--expose-file names.txt]
//
// <input.f32> is a raw float32 dump of the (1, 2, 343980) "mix" chunk
// (plans/perf-divergence D-105 chunk geometry — fixed, not read from argv,
// since Git-Bash mangles a leading "/" there; SP-7). Without --expose-file,
// every declared graph output is fetched and dumped (as in run.perf.ts's
// separate() usage). With --expose-file, only the model's primary output
// (session.outputNames[0]) plus the listed names are fetched — lets later
// steps (S-109 D3 profile bisection) fetch a batch of exposed tensors from
// a graph with hundreds of them without materialising the rest.
// Each fetched output is written to "<outprefix>.<i>.f32" (i = its index in
// the fetch list); one JSON line is printed to stdout: {outputNames, shapes,
// create_s, run_s, ort_version}.
import { readFileSync, writeFileSync } from "node:fs";
import * as ort from "onnxruntime-web";

const SEGMENT_SAMPLES = 343_980;

const args = process.argv.slice(2);
const exposeFlagIndex = args.indexOf("--expose-file");
const exposeFile = exposeFlagIndex >= 0 ? args[exposeFlagIndex + 1] : null;
const positional = exposeFlagIndex >= 0 ? [...args.slice(0, exposeFlagIndex), ...args.slice(exposeFlagIndex + 2)] : args;
const [modelPath, inputPath, outPrefix] = positional;
if (!modelPath || !inputPath || !outPrefix) {
  console.error("usage: run-wasm-node.mjs <model.onnx> <input.f32> <outprefix> [--expose-file names.txt]");
  process.exit(2);
}

ort.env.wasm.numThreads = 1;

function readFloat32File(path) {
  const buf = readFileSync(path);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / Float32Array.BYTES_PER_ELEMENT);
}

const t0 = performance.now();
const session = await ort.InferenceSession.create(readFileSync(modelPath), {
  executionProviders: ["wasm"],
  graphOptimizationLevel: "disabled",
  enableCpuMemArena: false,
  enableMemPattern: false,
});
const createS = (performance.now() - t0) / 1000;

const inputName = session.inputNames[0];
const primaryOutput = session.outputNames[0];
const exposeNames = exposeFile
  ? readFileSync(exposeFile, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
  : [];
const fetchNames = exposeFile ? [...new Set([primaryOutput, ...exposeNames])] : session.outputNames;

const feed = { [inputName]: new ort.Tensor("float32", readFloat32File(inputPath), [1, 2, SEGMENT_SAMPLES]) };
const t1 = performance.now();
const results = await session.run(feed, fetchNames);
const runS = (performance.now() - t1) / 1000;

const shapes = {};
fetchNames.forEach((name, i) => {
  const t = results[name];
  writeFileSync(`${outPrefix}.${i}.f32`, Buffer.from(t.data.buffer, t.data.byteOffset, t.data.byteLength));
  shapes[name] = t.dims;
});

console.log(JSON.stringify({ outputNames: fetchNames, shapes, create_s: createS, run_s: runS, ort_version: ort.env.versions?.web ?? "unknown" }));
