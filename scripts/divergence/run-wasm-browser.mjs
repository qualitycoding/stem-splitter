// Runs one model + one chunk through ORT Web's WASM EP in real Chrome (D0b,
// plans/perf-divergence D-106: browser-vs-Node environment equivalence check).
//
//   node run-wasm-browser.mjs <model.onnx> <input.f32> <outprefix> --threads <1|N>
//
// Single-thread needs no cross-origin isolation; multi-thread (--threads > 1)
// needs COOP/COEP (for SharedArrayBuffer) -- served here via response headers
// (the deployed app uses coi-serviceworker for this on a host that can't set
// headers itself; a plain Node http server can just set them directly).
// Prints the same JSON contract as run-wasm-node.mjs (outputNames, shapes,
// create_s, run_s, ort_version) plus crossOriginIsolated/actualThreads, and
// writes the primary output to "<outprefix>.0.f32".
import { writeFileSync, createReadStream, statSync } from "node:fs";
import http from "node:http";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright";

function parseArgs(argv, flagNames) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (flagNames.includes(argv[i])) {
      flags[argv[i].slice(2)] = argv[++i];
    } else {
      positional.push(argv[i]);
    }
  }
  return { flags, positional };
}

const { flags, positional } = parseArgs(process.argv.slice(2), ["--threads"]);
const [modelArg, inputArg, outPrefix] = positional;
if (!modelArg || !inputArg || !outPrefix) {
  console.error("usage: run-wasm-browser.mjs <model.onnx> <input.f32> <outprefix> --threads <1|N>");
  process.exit(2);
}
const modelPath = resolve(modelArg);
const inputPath = resolve(inputArg);
const threads = Number(flags.threads ?? "1");
const isolate = threads > 1;

const ORT_DIST = resolve("node_modules/onnxruntime-web/dist");
const html = `<!doctype html><title>d0b</title>`;

const server = http.createServer((req, res) => {
  if (isolate) {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  }
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/") {
    res.setHeader("content-type", "text/html");
    return res.end(html);
  }
  if (url.pathname === "/model.onnx") {
    res.setHeader("content-length", statSync(modelPath).size);
    return createReadStream(modelPath).pipe(res);
  }
  if (url.pathname === "/input.f32") {
    res.setHeader("content-length", statSync(inputPath).size);
    return createReadStream(inputPath).pipe(res);
  }
  if (url.pathname.startsWith("/ort/")) {
    const f = join(ORT_DIST, url.pathname.slice(5));
    res.setHeader("content-type", extname(f) === ".wasm" ? "application/wasm" : "text/javascript");
    return createReadStream(f).pipe(res);
  }
  res.statusCode = 404;
  res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
});

await page.goto(`${base}/`);
const out = await page.evaluate(
  async ({ base, threads }) => {
    function bufferToBase64(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      return btoa(binary);
    }

    const ort = await import(`${base}/ort/ort.min.mjs`);
    ort.env.wasm.wasmPaths = `${base}/ort/`;
    ort.env.wasm.numThreads = threads;

    const modelBytes = new Uint8Array(await (await fetch(`${base}/model.onnx`)).arrayBuffer());
    const inputBytes = new Float32Array(await (await fetch(`${base}/input.f32`)).arrayBuffer());

    const t0 = performance.now();
    const session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "disabled",
      enableCpuMemArena: false,
      enableMemPattern: false,
    });
    const createS = (performance.now() - t0) / 1000;

    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    const t1 = performance.now();
    const results = await session.run({ [inputName]: new ort.Tensor("float32", inputBytes, [1, 2, 343980]) });
    const runS = (performance.now() - t1) / 1000;
    const output = results[outputName];

    return {
      ortVersion: ort.env.versions?.web ?? "unknown",
      crossOriginIsolated: self.crossOriginIsolated,
      actualThreads: ort.env.wasm.numThreads,
      createS,
      runS,
      dims: output.dims,
      outputName,
      dataBase64: bufferToBase64(output.data.buffer),
    };
  },
  { base, threads },
);

writeFileSync(`${outPrefix}.0.f32`, Buffer.from(out.dataBase64, "base64"));
console.log(
  JSON.stringify({
    outputNames: [out.outputName],
    shapes: { [out.outputName]: out.dims },
    create_s: out.createS,
    run_s: out.runS,
    ort_version: out.ortVersion,
    requestedThreads: threads,
    actualThreads: out.actualThreads,
    crossOriginIsolated: out.crossOriginIsolated,
    consoleErrorCount: consoleErrors.length,
    consoleErrors: [...new Set(consoleErrors)].slice(0, 10),
  }),
);

await browser.close();
server.close();
