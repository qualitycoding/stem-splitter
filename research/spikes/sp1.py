#!/usr/bin/env python3
"""
SP-1 spike for qualitycoding/stem-splitter (plan step S-000).

Measures the four open claims:
  C-011  Hugging Face download hosts, redirects and CORS headers
  C-012  Session memory use and WebGPU buffer limits
  C-013  Whether ONNX Runtime Web's worker threads fit the planned CSP
  C-014  Exact model download sizes (plus SHA-256 pins for D-05)

Requirements: Python 3.9+ (standard library only) and Chrome or Edge 113+
for the WebGPU part. Firefox/Safari can also be run for comparison.

Usage:
  python3 sp1.py              # probe HF, then open the browser test page
  python3 sp1.py --verify     # also download all 5 models (~830 MB) to hash them locally
  python3 sp1.py --browser-only
  python3 sp1.py --no-open    # don't auto-open a browser; visit the printed URL yourself

The browser page downloads 2 models (~330 MB) and runs one 7.8 s chunk per
model on WASM and WebGPU. Keep the tab in the foreground until it says Done.
You can then open the same URL in other browsers; each run is appended.
Press Ctrl+C to finish. Results go to sp1-results.json next to this script.
"""
import argparse
import hashlib
import io
import json
import os
import re
import sys
import tarfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SCRIPT_VERSION = 1
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(HERE, "sp1-results.json")
CACHE = os.path.join(HERE, ".sp1-cache")

ORG = "StemSplitio"
MODELS = {"htdemucs": (f"{ORG}/htdemucs-onnx", "htdemucs_fp16weights.onnx")}
for _s in ("drums", "bass", "other", "vocals"):
    MODELS[f"htdemucs_ft_{_s}"] = (f"{ORG}/htdemucs-ft-{_s}-onnx", f"htdemucs_ft_{_s}_fp16weights.onnx")
BROWSER_MODELS = ["htdemucs", "htdemucs_ft_vocals"]

ORT_VERSION = "1.30.0"
ORT_FILES = ["ort.bundle.min.mjs", "ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]
UA = "stem-splitter-sp1/1"
SEG = 343980

# Draft CSP from plan/DECISIONS.md D-08, sent as Report-Only so violations are
# recorded without breaking the test.
CSP_DRAFT = ("default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; "
             "worker-src 'self' blob:; connect-src 'self' https://huggingface.co; "
             "img-src 'self' data:; style-src 'self'")


def resolve_url(name, revision="main"):
    repo, fname = MODELS[name]
    return f"https://huggingface.co/{repo}/resolve/{revision}/{fname}"


# --------------------------------------------------------------------------
# Part A: probe Hugging Face from Python
# --------------------------------------------------------------------------
class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


_no_redirect = urllib.request.build_opener(_NoRedirect)


def probe_chain(url, origin):
    """Follow redirects by hand, recording every hop's CORS-relevant headers."""
    chain = []
    for _ in range(8):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Origin": origin, "Range": "bytes=0-0"})
        try:
            r = _no_redirect.open(req, timeout=60)
            code, h = r.status, r.headers
            r.close()
        except urllib.error.HTTPError as e:
            code, h = e.code, e.headers
        chain.append({
            "host": urllib.parse.urlparse(url).netloc,
            "path": urllib.parse.urlparse(url).path[:120],
            "status": code,
            "access_control_allow_origin": h.get("Access-Control-Allow-Origin"),
            "cross_origin_resource_policy": h.get("Cross-Origin-Resource-Policy"),
            "content_range": h.get("Content-Range"),
            "x_linked_size": h.get("X-Linked-Size"),
            "x_linked_etag": h.get("X-Linked-Etag"),
            "x_repo_commit": h.get("X-Repo-Commit"),
        })
        loc = h.get("Location")
        if code in (301, 302, 303, 307, 308) and loc:
            url = urllib.parse.urljoin(url, loc)
            continue
        break
    return chain


def hf_commit(repo):
    req = urllib.request.Request(f"https://huggingface.co/api/models/{repo}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r).get("sha")


def download_sha256(url):
    h, n, t0, last = hashlib.sha256(), 0, time.time(), 0.0
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        total = int(r.headers.get("Content-Length") or 0)
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            h.update(b)
            n += len(b)
            if time.time() - last > 1:
                last = time.time()
                pct = f" ({100 * n / total:.0f}%)" if total else ""
                print(f"\r    downloading {n / 1e6:.0f} MB{pct}   ", end="", flush=True)
    secs = time.time() - t0
    print(f"\r    downloaded {n / 1e6:.1f} MB in {secs:.0f} s ({n * 8 / 1e6 / secs:.0f} Mbit/s)      ")
    return {"sha256": h.hexdigest(), "bytes": n, "seconds": round(secs, 1)}


def part_a(origin, verify):
    out = {}
    for name, (repo, fname) in MODELS.items():
        print(f"  {name}")
        rec = {"repo": repo, "file": fname}
        try:
            rec["commit"] = hf_commit(repo)
        except Exception as e:
            rec["commit_error"] = str(e)
        try:
            chain = probe_chain(resolve_url(name), origin)
            rec["redirect_chain"] = chain
            last = chain[-1]
            size = None
            m = re.search(r"/(\d+)$", last.get("content_range") or "")
            if m:
                size = int(m.group(1))
            for hop in chain:
                if hop["x_linked_size"]:
                    size = size or int(hop["x_linked_size"])
                etag = (hop["x_linked_etag"] or "").strip('"').replace("W/", "").strip('"')
                if re.fullmatch(r"[0-9a-f]{64}", etag):
                    rec["sha256_from_hf"] = etag
                if hop["x_repo_commit"] and not rec.get("commit"):
                    rec["commit"] = hop["x_repo_commit"]
            rec["bytes"] = size
            rec["final_status"] = last["status"]
            rec["cors_ok_every_hop"] = all(
                hop["access_control_allow_origin"] in ("*", origin) for hop in chain)
            if rec.get("commit"):
                rec["pinned_url"] = resolve_url(name, rec["commit"])
            print(f"    {size / 1e6:.1f} MB" if size else "    size unknown",
                  "| hosts:", " -> ".join(h["host"] for h in chain),
                  "| CORS ok" if rec["cors_ok_every_hop"] else "| CORS MISSING on a hop")
        except Exception as e:
            rec["probe_error"] = str(e)
            print("    probe failed:", e)
        if verify:
            try:
                d = download_sha256(resolve_url(name))
                rec["sha256_downloaded"] = d["sha256"]
                rec["download"] = d
                if rec.get("sha256_from_hf") and rec["sha256_from_hf"] != d["sha256"]:
                    print("    WARNING: downloaded SHA-256 differs from HF X-Linked-Etag")
            except Exception as e:
                rec["download_error"] = str(e)
                print("    download failed:", e)
        out[name] = rec
    return out


# --------------------------------------------------------------------------
# Part B: local test page with COOP/COEP and the draft CSP
# --------------------------------------------------------------------------
def fetch_ort():
    dest = os.path.join(CACHE, f"ort-{ORT_VERSION}")
    if all(os.path.exists(os.path.join(dest, f)) for f in ORT_FILES):
        return dest
    os.makedirs(dest, exist_ok=True)
    url = f"https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-{ORT_VERSION}.tgz"
    print(f"  fetching onnxruntime-web {ORT_VERSION} from npm ...")
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=300) as r:
        data = r.read()
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as t:
        for f in ORT_FILES:
            with open(os.path.join(dest, f), "wb") as o:
                o.write(t.extractfile(t.getmember(f"package/dist/{f}")).read())
    return dest


PAGE_HTML = """<!doctype html>
<meta charset="utf-8">
<title>stem-splitter SP-1</title>
<h1>stem-splitter SP-1</h1>
<p>Keep this tab in the foreground until it says <b>Done</b>. Downloads about 330 MB.</p>
<pre id="log"></pre>
<script type="module" src="/sp1.js"></script>
"""

PAGE_JS = r"""
const logEl = document.getElementById('log');
const log = (...a) => { const s = a.join(' '); logEl.textContent += s + '\n'; console.log(s); };
const R = {
  started: new Date().toISOString(), userAgent: navigator.userAgent,
  crossOriginIsolated: self.crossOriginIsolated, hardwareConcurrency: navigator.hardwareConcurrency,
  deviceMemoryGB: navigator.deviceMemory ?? null, cspViolations: [], workersCreated: [],
  webgpu: null, models: {}, errors: [],
};
document.addEventListener('securitypolicyviolation', e => R.cspViolations.push({
  directive: e.effectiveDirective, blockedURI: e.blockedURI, disposition: e.disposition,
  sourceFile: e.sourceFile }));
const NativeWorker = self.Worker;
self.Worker = class extends NativeWorker {
  constructor(url, opts) {
    R.workersCreated.push({ url: String(url).slice(0, 120), type: opts?.type ?? 'classic' });
    super(url, opts);
  }
};

async function mem() {
  if (performance.measureUserAgentSpecificMemory) {
    try {
      const m = await Promise.race([performance.measureUserAgentSpecificMemory(),
        new Promise((_, j) => setTimeout(() => j(new Error('timeout after 90 s')), 90000))]);
      return { api: 'measureUserAgentSpecificMemory', bytes: m.bytes };
    } catch (e) { R.errors.push('memory: ' + e.message); }
  }
  return performance.memory ? { api: 'performance.memory', bytes: performance.memory.usedJSHeapSize } : null;
}

async function fetchModel(url) {
  const t0 = performance.now();
  const r = await fetch(url, { mode: 'cors', cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const total = +r.headers.get('content-length') || 0;
  const reader = r.body.getReader();
  const parts = []; let n = 0, last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); n += value.length;
    if (performance.now() - last > 3000) {
      last = performance.now();
      log(`    ${(n / 1e6).toFixed(0)} MB` + (total ? ` / ${(total / 1e6).toFixed(0)} MB` : ''));
    }
  }
  const buf = new Uint8Array(n); let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  const secs = (performance.now() - t0) / 1000;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  const sha256 = [...digest].map(b => b.toString(16).padStart(2, '0')).join('');
  const u = new URL(r.url);
  return { buf, info: { finalHost: u.host, finalPath: u.pathname.slice(0, 120), redirected: r.redirected,
    bytes: n, seconds: +secs.toFixed(1), mbitPerSec: +(n * 8 / 1e6 / secs).toFixed(1), sha256 } };
}

async function runEP(ort, buf, ep) {
  const out = { ep };
  try {
    const m0 = await mem();
    let t = performance.now();
    const s = await ort.InferenceSession.create(buf, { executionProviders: [ep], graphOptimizationLevel: 'all' });
    out.createSeconds = +((performance.now() - t) / 1000).toFixed(2);
    out.inputNames = s.inputNames; out.outputNames = s.outputNames;
    const m1 = await mem();
    const x = new Float32Array(2 * SEG);
    for (let i = 0; i < x.length; i++) x[i] = (Math.random() * 2 - 1) * 0.1;
    const feeds = { [s.inputNames[0]]: new ort.Tensor('float32', x, [1, 2, SEG]) };
    out.runSeconds = [];
    for (let k = 0; k < 2; k++) {
      t = performance.now();
      const res = await s.run(feeds);
      out.runSeconds.push(+((performance.now() - t) / 1000).toFixed(2));
      if (k === 0) {
        const o = res[s.outputNames[0]];
        out.outputDims = o.dims;
        const d = o.getData ? await o.getData() : o.data;
        let bad = 0, mx = 0;
        for (let i = 0; i < d.length; i++) { const v = d[i]; if (!Number.isFinite(v)) bad++; else if (Math.abs(v) > mx) mx = Math.abs(v); }
        out.nonFiniteCount = bad; out.maxAbs = +mx.toFixed(4);
      }
      for (const v of Object.values(res)) v.dispose?.();
    }
    out.memory = { beforeCreate: m0, afterCreate: m1, afterRuns: await mem() };
    await s.release();
    log(`    ${ep}: create ${out.createSeconds}s, run ${out.runSeconds.join(' / ')}s, dims ${out.outputDims}`);
  } catch (e) {
    out.error = String(e?.message ?? e);
    log(`    ${ep}: ERROR ${out.error}`);
  }
  return out;
}

let SEG = 343980;
(async () => {
  try {
    const cfg = await (await fetch('/config.json')).json();
    SEG = cfg.segment;
    log('crossOriginIsolated:', self.crossOriginIsolated, '| threads available:', navigator.hardwareConcurrency);
    if (navigator.gpu) {
      try {
        const a = await navigator.gpu.requestAdapter();
        R.webgpu = a ? { info: a.info ? { vendor: a.info.vendor, architecture: a.info.architecture,
            device: a.info.device, description: a.info.description } : null,
          maxStorageBufferBindingSize: a.limits.maxStorageBufferBindingSize,
          maxBufferSize: a.limits.maxBufferSize, features: [...a.features] } : { error: 'no adapter' };
      } catch (e) { R.webgpu = { error: String(e) }; }
    } else R.webgpu = { error: 'navigator.gpu undefined' };
    log('WebGPU:', JSON.stringify(R.webgpu));

    const ort = await import('/ort/ort.bundle.min.mjs');
    R.ortVersion = ort.env.versions?.web ?? null;
    ort.env.wasm.wasmPaths = '/ort/';
    R.numThreads = self.crossOriginIsolated ? Math.min(8, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)) : 1;
    ort.env.wasm.numThreads = R.numThreads;
    ort.env.logLevel = 'warning';
    log('ORT', R.ortVersion, '| numThreads', R.numThreads);

    for (const [name, url] of Object.entries(cfg.models)) {
      log(`\n${name}: downloading ${url}`);
      const rec = R.models[name] = { url };
      let buf;
      try { const f = await fetchModel(url); buf = f.buf; Object.assign(rec, f.info);
        log(`    ${(rec.bytes / 1e6).toFixed(1)} MB in ${rec.seconds}s from ${rec.finalHost}`);
      } catch (e) { rec.fetchError = String(e?.message ?? e); log('    fetch FAILED:', rec.fetchError); continue; }
      rec.runs = [await runEP(ort, buf, 'wasm')];
      if (R.webgpu && !R.webgpu.error) rec.runs.push(await runEP(ort, buf, 'webgpu'));
      buf = null;
    }
  } catch (e) {
    R.errors.push(String(e?.stack ?? e));
    log('FATAL:', e);
  } finally {
    R.finished = new Date().toISOString();
    R.crossOriginIsolatedAtEnd = self.crossOriginIsolated;
    try {
      await fetch('/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(R) });
      log('\nDone — results sent. You can close this tab or open this URL in another browser.');
    } catch (e) { log('\nCould not send results; copy this:\n' + JSON.stringify(R)); }
  }
})();
"""


def save(results):
    with open(OUT_PATH, "w") as f:
        json.dump(results, f, indent=2)


def summarize_browser(r, part_a_models):
    print("\n" + "=" * 70)
    print("Browser:", r.get("userAgent", "?"))
    print(f"  crossOriginIsolated={r.get('crossOriginIsolated')}  ORT={r.get('ortVersion')}  threads={r.get('numThreads')}")
    gpu = r.get("webgpu") or {}
    if gpu.get("error"):
        print("  WebGPU:", gpu["error"])
    else:
        print(f"  WebGPU: {((gpu.get('info') or {}).get('description') or (gpu.get('info') or {}).get('vendor'))}"
              f"  maxStorageBufferBindingSize={gpu.get('maxStorageBufferBindingSize', 0) / 2**20:.0f} MiB"
              f"  maxBufferSize={gpu.get('maxBufferSize', 0) / 2**20:.0f} MiB")
    for name, m in (r.get("models") or {}).items():
        print(f"  {name}:")
        if m.get("fetchError"):
            print("    fetch FAILED:", m["fetchError"])
            continue
        ref = (part_a_models or {}).get(name, {})
        ref_sha = ref.get("sha256_downloaded") or ref.get("sha256_from_hf")
        match = "" if not ref_sha else ("  (matches HF)" if ref_sha == m.get("sha256") else "  (DIFFERS from HF!)")
        print(f"    {m.get('bytes', 0) / 1e6:.1f} MB via {m.get('finalHost')} at {m.get('mbitPerSec')} Mbit/s, sha256 {str(m.get('sha256'))[:16]}...{match}")
        for run in m.get("runs", []):
            if run.get("error"):
                print(f"    {run['ep']}: ERROR {run['error'][:200]}")
                continue
            mm = run.get("memory") or {}
            b0 = (mm.get("beforeCreate") or {}).get("bytes")
            b1 = (mm.get("afterCreate") or {}).get("bytes")
            b2 = (mm.get("afterRuns") or {}).get("bytes")
            memtxt = (f"mem {b0 / 1e6:.0f} -> {b1 / 1e6:.0f} -> {b2 / 1e6:.0f} MB ({(mm.get('afterRuns') or {}).get('api')})"
                      if None not in (b0, b1, b2) else "mem n/a")
            print(f"    {run['ep']}: create {run.get('createSeconds')}s, run/chunk {run.get('runSeconds')}s, "
                  f"out {run.get('outputDims')}, nonfinite {run.get('nonFiniteCount')}, {memtxt}")
            if run.get("runSeconds"):
                chunks = -(-4 * 60 * 44100 // (SEG - SEG // 4))
                mult = 4 if name.startswith("htdemucs_ft") else 1
                print(f"      -> est. 4-min song ({'HQ, x4 models' if mult == 4 else 'standard'}): "
                      f"{chunks * mult * run['runSeconds'][-1] / 60:.1f} min")
    v = r.get("cspViolations") or []
    print(f"  CSP (report-only) violations: {len(v)}")
    for x in v[:15]:
        print(f"    {x.get('directive')}: {x.get('blockedURI')}")
    print(f"  Workers created: {[w['url'][:60] + ' (' + w['type'] + ')' for w in r.get('workersCreated', [])][:6]}")
    if r.get("errors"):
        print("  Errors:", r["errors"][:5])


def serve(port, open_browser, results):
    ort_dir = fetch_ort()
    config = json.dumps({"segment": SEG, "models": {m: resolve_url(m) for m in BROWSER_MODELS}}).encode()
    types = {".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm"}

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body, ctype):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
            self.send_header("Content-Security-Policy-Report-Only", CSP_DRAFT)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            p = urllib.parse.urlparse(self.path).path
            if p in ("/", "/index.html"):
                return self._send(200, PAGE_HTML.encode(), "text/html; charset=utf-8")
            if p == "/sp1.js":
                return self._send(200, PAGE_JS.encode(), "text/javascript")
            if p == "/config.json":
                return self._send(200, config, "application/json")
            if p.startswith("/ort/"):
                f = os.path.basename(p)
                if f in ORT_FILES:
                    with open(os.path.join(ort_dir, f), "rb") as fh:
                        return self._send(200, fh.read(), types[os.path.splitext(f)[1]])
            self._send(404, b"not found", "text/plain")

        def do_POST(self):
            if self.path != "/result":
                return self._send(404, b"", "text/plain")
            n = int(self.headers.get("Content-Length") or 0)
            try:
                r = json.loads(self.rfile.read(n))
            except ValueError:
                return self._send(400, b"bad json", "text/plain")
            results["browsers"].append(r)
            save(results)
            summarize_browser(r, results.get("huggingface"))
            print(f"\nSaved to {OUT_PATH}. Open the URL in another browser, or press Ctrl+C to finish.")
            self._send(200, b"ok", "text/plain")

    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    url = f"http://localhost:{port}/"
    print(f"\nTest page: {url}\n  Open it in Chrome or Edge (WebGPU). Firefox/Safari optional for comparison.")
    if open_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--verify", action="store_true", help="download all models to hash them locally (~830 MB)")
    ap.add_argument("--browser-only", action="store_true", help="skip the Hugging Face probe")
    ap.add_argument("--no-open", action="store_true", help="don't auto-open a browser")
    a = ap.parse_args()

    results = {"script_version": SCRIPT_VERSION, "run_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "python": sys.version.split()[0], "platform": sys.platform, "ort_version": ORT_VERSION,
               "csp_draft": CSP_DRAFT, "huggingface": None, "browsers": []}
    if os.path.exists(OUT_PATH):
        try:
            with open(OUT_PATH) as f:
                prev = json.load(f)
            if prev.get("script_version") == SCRIPT_VERSION:
                results["huggingface"] = prev.get("huggingface")
                results["browsers"] = prev.get("browsers", [])
        except ValueError:
            pass

    if not a.browser_only:
        print("Part A: probing Hugging Face")
        results["huggingface"] = part_a(f"http://localhost:{a.port}", a.verify)
        save(results)
        hosts = sorted({h["host"] for m in results["huggingface"].values() for h in m.get("redirect_chain", [])})
        print("  hosts seen:", ", ".join(hosts))

    print("\nPart B: browser test")
    try:
        serve(a.port, not a.no_open, results)
    finally:
        save(results)
        print(f"\nFinished. Send me {OUT_PATH} (or paste its contents).")


if __name__ == "__main__":
    main()
