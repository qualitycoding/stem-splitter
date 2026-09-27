// SP-10: WebGPU timing semantics on this machine (Playwright channel:'chrome', headless).
// Q1: does `await session.run()` resolve only after the GPU work is complete? (measure queue.onSubmittedWorkDone() AFTER run)
// Q2: first-run vs steady-state cost, and session-creation cost, with the real pinned model under the D-12 options.
// Usage: node sp10-webgpu-timing.mjs <model.onnx> [runs=5] [input.f32 [reference.f32]]
// With an input file the page uses it (else seeded noise); with a reference (native output, raw float32 (1,4,2,343980)) it reports per-stem rel_l2
// of the FIRST WebGPU run vs the reference, non-finite counts, and collects every page console error (WebGPU validation errors) into `errors`.
import http from "node:http";
import { createReadStream, statSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { extname, join, resolve } from "node:path";

const model = resolve(process.argv[2]);
const RUNS = Number(process.argv[3] ?? 5);
const inputF32 = process.argv[4] ? resolve(process.argv[4]) : null;
const refF32 = process.argv[5] ? resolve(process.argv[5]) : null;
const dist = resolve("node_modules/onnxruntime-web/dist");
const html = `<!doctype html><title>sp10</title>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/") { res.setHeader("content-type", "text/html"); return res.end(html); }
  if (url.pathname === "/model.onnx") { res.setHeader("content-length", statSync(model).size); return createReadStream(model).pipe(res); }
  if (url.pathname.startsWith("/ort/")) {
    const f = join(dist, url.pathname.slice(5));
    res.setHeader("content-type", extname(f) === ".wasm" ? "application/wasm" : "text/javascript");
    return createReadStream(f).pipe(res);
  }
  if (url.pathname === "/input.f32" && inputF32) { res.setHeader("content-length", statSync(inputF32).size); return createReadStream(inputF32).pipe(res); }
  if (url.pathname === "/ref.f32" && refF32) { res.setHeader("content-length", statSync(refF32).size); return createReadStream(refF32).pipe(res); }
  res.statusCode = 404; res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text().slice(0, 300)); });
await page.goto(base + "/");
const out = await page.evaluate(async ({ base, RUNS, hasInput, hasRef }) => {
  const ort = await import(base + "/ort/ort.min.mjs");
  ort.env.wasm.wasmPaths = base + "/ort/";
  ort.env.wasm.numThreads = 1;
  const bytes = new Uint8Array(await (await fetch(base + "/model.onnx")).arrayBuffer());
  let s = 1234567; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5);
  let data = new Float32Array(2 * 343980); for (let i = 0; i < data.length; i++) data[i] = 0.2 * rnd();
  if (hasInput) data = new Float32Array(await (await fetch(base + "/input.f32")).arrayBuffer());
  const ref = hasRef ? new Float32Array(await (await fetch(base + "/ref.f32")).arrayBuffer()) : null;
  let compare = null;
  const t0 = performance.now();
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ["webgpu"], graphOptimizationLevel: "disabled", enableCpuMemArena: false, enableMemPattern: false });
  const createMs = performance.now() - t0;
  const device = ort.env.webgpu.device;
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const a = performance.now();
    const r = await session.run({ mix: new ort.Tensor("float32", data, [1, 2, 343980]) });
    const b = performance.now();
    if (i === 0) {
      const y = r.stems.data; let bad = 0; for (let k = 0; k < y.length; k++) if (!Number.isFinite(y[k])) bad++;
      compare = { nonFinite: bad, perStem: null };
      if (ref) {
        const n = 2 * 343980; compare.perStem = ["drums", "bass", "other", "vocals"].map((name, st) => {
          let d = 0, q = 0; for (let k = 0; k < n; k++) { const a = ref[st * n + k], c = y[st * n + k]; d += (a - c) * (a - c); q += a * a; } return { name, rel_l2: Math.sqrt(d / Math.max(q, 1e-300)) }; });
      }
    }
    await device.queue.onSubmittedWorkDone();
    const c = performance.now();
    runs.push({ run_ms: +(b - a).toFixed(1), extra_wait_after_run_ms: +(c - b).toFixed(2) });
    await Promise.all(Object.values(r).map((v) => v.dispose?.()));
  }
  return { ort: ort.env.versions?.web, createMs: +createMs.toFixed(0), features: [...device.features], runs, firstRunCheck: compare };
}, { base, RUNS, hasInput: !!inputF32, hasRef: !!refF32 });
console.log(JSON.stringify({ browser: browser.version(), ...out, errorCount: errors.length, errors: [...new Set(errors)].slice(0, 12) }, null, 1));
await browser.close(); server.close();
