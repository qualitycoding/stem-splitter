// SP-4: can Playwright 1.63 expose a WebGPU adapter on this machine?
// Usage: node plans/perf-divergence/research/spikes/sp4-webgpu.mjs
import { chromium } from "playwright";
import http from "node:http";

// navigator.gpu is [SecureContext]: about:blank is NOT one, http://localhost is.
const server = http.createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><title>sp4</title>"); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const URL_ = `http://localhost:${server.address().port}/`;

const configs = [
  { name: "bundled chromium headless (baseline)", opts: { headless: true } },
  { name: "channel chrome, headless", opts: { channel: "chrome", headless: true } },
  { name: "channel chrome, headless + unsafe-webgpu", opts: { channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu"] } },
  { name: "channel chrome, headed", opts: { channel: "chrome", headless: false } },
  { name: "channel chrome, headed + unsafe-webgpu", opts: { channel: "chrome", headless: false, args: ["--enable-unsafe-webgpu"] } },
];
const out = [];
for (const c of configs) {
  let browser;
  try {
    browser = await chromium.launch(c.opts);
    const page = await browser.newPage();
    await page.goto(URL_);
    const r = await page.evaluate(async () => {
      if (!navigator.gpu) return { gpu: false };
      const a = await navigator.gpu.requestAdapter();
      if (!a) return { gpu: true, adapter: null };
      return { gpu: true, adapter: true, info: a.info ? { vendor: a.info.vendor, architecture: a.info.architecture, description: a.info.description } : null, maxStorage: a.limits.maxStorageBufferBindingSize };
    });
    out.push({ config: c.name, version: browser.version(), ...r });
  } catch (e) {
    out.push({ config: c.name, error: String(e).split("\n")[0] });
  } finally {
    await browser?.close();
  }
}
server.close();
console.log(JSON.stringify(out, null, 2));
