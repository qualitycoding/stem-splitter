#!/usr/bin/env python3
"""
SP-2 for qualitycoding/stem-splitter: why does the htdemucs ONNX model fail
to load in ONNX Runtime Web with std::bad_alloc?

Part A (Python)  Downloads the pinned htdemucs fp16weights model once (166 MB,
                 SHA-256 checked) and, if the `onnx` / `onnxruntime` packages
                 are installed, reports the model's structure and its peak
                 memory when loaded natively at each optimisation level.
                 Optional:  pip install onnx onnxruntime numpy psutil
Part B (browser) Serves the model locally and loads it in a matrix of
                 configurations (ORT 1.30 / 1.22 / 1.18, 1 vs many threads,
                 graph optimisation off vs on, memory arena off vs on). Each
                 configuration runs in a fresh page load, so one failure can't
                 poison the next, and records the WebAssembly memory size at
                 the point of failure.

Usage:   python3 sp2.py            (Chrome or Edge; takes ~5-15 minutes)
         python3 sp2.py --no-open  (visit the printed URL yourself)
         python3 sp2.py --skip-python
If a tab crashes ("Aw, Snap!"), reload it: the page resumes at the next
configuration. Press Ctrl+C when it says "All configurations done" and send
back sp2-results.json.
"""
import argparse
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(HERE, "sp2-results.json")
CACHE = os.path.join(HERE, ".sp1-cache")
UA = "stem-splitter-sp2/1"

MODEL_URL = ("https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/"
             "d54ed9eb60e258ea82131c6ee14578628816456a/htdemucs_fp16weights.onnx")
MODEL_SHA = "d05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a"
MODEL_PATH = os.path.join(CACHE, "htdemucs_fp16weights.onnx")
SEG = 343980

# Entry file per ORT version (1.18 predates the ESM builds).
ORT_ENTRIES = {"1.30.0": "ort.bundle.min.mjs", "1.22.0": "ort.bundle.min.mjs", "1.18.0": "ort.webgpu.min.js"}

CONFIGS = [
    # ORT     threads  graph opt   arena  memPattern  also try webgpu
    ("1.30.0", 1,      "disabled", False, False, False),
    ("1.30.0", "max",  "disabled", False, False, True),
    ("1.30.0", "max",  "basic",    True,  True,  True),
    ("1.30.0", 1,      "all",      True,  True,  False),
    ("1.22.0", "max",  "disabled", False, False, True),
    ("1.22.0", "max",  "all",      True,  True,  False),
    ("1.18.0", 1,      "all",      True,  True,  False),
    ("1.18.0", "max",  "disabled", False, False, True),
]
CONFIGS = [dict(zip(("ort", "threads", "opt", "arena", "memPattern", "webgpu"), c)) for c in CONFIGS]


def save(results):
    with open(OUT_PATH, "w") as f:
        json.dump(results, f, indent=2)


# --------------------------------------------------------------------------
# Part A
# --------------------------------------------------------------------------
def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def ensure_model():
    os.makedirs(CACHE, exist_ok=True)
    if os.path.exists(MODEL_PATH) and sha256_file(MODEL_PATH) == MODEL_SHA:
        return
    print("  downloading htdemucs_fp16weights.onnx (166 MB) ...")
    tmp = MODEL_PATH + ".part"
    with urllib.request.urlopen(urllib.request.Request(MODEL_URL, headers={"User-Agent": UA}), timeout=300) as r, \
            open(tmp, "wb") as f:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)
    if sha256_file(tmp) != MODEL_SHA:
        os.remove(tmp)
        sys.exit("  model SHA-256 mismatch — aborting")
    os.replace(tmp, MODEL_PATH)


def analyse_model():
    try:
        import onnx
    except ImportError:
        print("  (onnx not installed — skipping structure analysis)")
        return {"skipped": "onnx not installed"}
    from collections import Counter
    m = onnx.load(MODEL_PATH, load_external_data=False)
    g = m.graph
    itemsize = {1: 4, 2: 1, 3: 1, 5: 2, 6: 4, 7: 8, 9: 1, 10: 2, 11: 8, 16: 2}

    def tbytes(t):
        if t.raw_data:
            return len(t.raw_data)
        n = 1
        for d in t.dims:
            n *= d
        return n * itemsize.get(t.data_type, 4)

    by_dtype, big = Counter(), []
    for t in g.initializer:
        dt = onnx.TensorProto.DataType.Name(t.data_type)
        b = tbytes(t)
        by_dtype[dt] += b
        big.append((b, t.name, dt, list(t.dims)))
    const_bytes = 0
    for n in g.node:
        if n.op_type == "Constant":
            for a in n.attribute:
                if a.t and a.t.ByteSize():
                    const_bytes += tbytes(a.t)
    ops = Counter(n.op_type for n in g.node)

    def shape(v):
        return [d.dim_value or d.dim_param for d in v.type.tensor_type.shape.dim]

    big.sort(reverse=True)
    res = {
        "ir_version": m.ir_version,
        "opsets": {o.domain or "ai.onnx": o.version for o in m.opset_import},
        "producer": f"{m.producer_name} {m.producer_version}",
        "inputs": {v.name: shape(v) for v in g.input if v.name not in {t.name for t in g.initializer}},
        "outputs": {v.name: shape(v) for v in g.output},
        "node_count": len(g.node),
        "top_ops": dict(ops.most_common(20)),
        "initializer_count": len(g.initializer),
        "initializer_MB_by_dtype": {k: round(v / 1e6, 1) for k, v in by_dtype.items()},
        "constant_node_MB": round(const_bytes / 1e6, 1),
        "largest_initializers": [{"MB": round(b / 1e6, 2), "name": n[:80], "dtype": d, "dims": s} for b, n, d, s in big[:10]],
    }
    print(f"  inputs {res['inputs']}  outputs {res['outputs']}")
    print(f"  {res['node_count']} nodes, initializers {res['initializer_MB_by_dtype']} MB, Constant nodes {res['constant_node_MB']} MB")
    print(f"  top ops: {dict(list(res['top_ops'].items())[:10])}")
    return res


NATIVE_PROBE = r"""
import json, sys, time
path, level = sys.argv[1], sys.argv[2]
def peak():
    try:
        import psutil
        mi = psutil.Process().memory_info()
        return getattr(mi, "peak_wset", None) or getattr(mi, "peak_rss", None) or mi.rss
    except ImportError:
        try:
            import resource
            r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            return r if sys.platform == "darwin" else r * 1024
        except ImportError:
            return None
out = {"level": level}
try:
    import numpy as np, onnxruntime as ort
    out["ort_version"] = ort.__version__
    out["peak_before"] = peak()
    so = ort.SessionOptions()
    so.graph_optimization_level = getattr(ort.GraphOptimizationLevel, level)
    t = time.time()
    s = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])
    out["create_s"] = round(time.time() - t, 2)
    out["peak_after_create"] = peak()
    x = (np.random.default_rng(0).standard_normal((1, 2, %d)) * 0.1).astype(np.float32)
    t = time.time()
    y = s.run(None, {s.get_inputs()[0].name: x})[0]
    out["run_s"] = round(time.time() - t, 2)
    out["out_shape"] = list(y.shape)
    out["finite"] = bool(np.isfinite(y).all())
    out["peak_after_run"] = peak()
except Exception as e:
    out["error"] = repr(e)[:400]
print(json.dumps(out))
""" % SEG


def native_probe():
    try:
        import onnxruntime  # noqa: F401
    except ImportError:
        print("  (onnxruntime not installed — skipping native memory probe)")
        return {"skipped": "onnxruntime not installed"}
    res = []
    for level in ("ORT_DISABLE_ALL", "ORT_ENABLE_BASIC", "ORT_ENABLE_ALL"):
        p = subprocess.run([sys.executable, "-c", NATIVE_PROBE, MODEL_PATH, level],
                           capture_output=True, text=True, timeout=900)
        try:
            r = json.loads(p.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            r = {"level": level, "error": (p.stderr or p.stdout)[-400:]}
        res.append(r)
        if "error" in r:
            print(f"  {level}: ERROR {r['error'][:150]}")
        else:
            mb = lambda k: f"{r[k] / 1e6:.0f}" if r.get(k) else "?"
            print(f"  {level}: create {r['create_s']}s, run {r['run_s']}s, peak mem "
                  f"{mb('peak_before')} -> {mb('peak_after_create')} -> {mb('peak_after_run')} MB, out {r['out_shape']}")
    return res


# --------------------------------------------------------------------------
# Part B
# --------------------------------------------------------------------------
def fetch_ort(version):
    dest = os.path.join(CACHE, f"ortv-{version}")
    marker = os.path.join(dest, ".done")
    if os.path.exists(marker):
        return dest
    os.makedirs(dest, exist_ok=True)
    print(f"  fetching onnxruntime-web {version} ...")
    url = f"https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-{version}.tgz"
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=300) as r:
        data = r.read()
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as t:
        for m in t.getmembers():
            name = m.name.rsplit("/", 1)[-1]
            if m.name.startswith("package/dist/") and (name == ORT_ENTRIES[version] or name.startswith("ort-wasm")) \
                    and not name.endswith(".map"):
                with open(os.path.join(dest, name), "wb") as o:
                    o.write(t.extractfile(m).read())
    open(marker, "w").close()
    return dest


PAGE_HTML = """<!doctype html>
<meta charset="utf-8">
<title>stem-splitter SP-2</title>
<h1>stem-splitter SP-2</h1>
<p>Runs each configuration in a fresh page load. Leave this tab in the foreground.</p>
<pre id="log"></pre>
<script type="module" src="/sp2.js"></script>
"""

PAGE_JS = r"""
const logEl = document.getElementById('log');
const log = (...a) => { const s = a.join(' '); logEl.textContent += s + '\n'; console.log(s); };

// Record every WebAssembly.Memory ORT creates, so we can see its size when it fails.
const mems = [];
const NativeMemory = WebAssembly.Memory;
WebAssembly.Memory = function (desc) {
  const m = new NativeMemory(desc);
  mems.push({ initialPages: desc.initial, maximumPages: desc.maximum ?? null, shared: !!desc.shared, m });
  return m;
};
WebAssembly.Memory.prototype = NativeMemory.prototype;
const memInfo = () => mems.map(x => ({ initialPages: x.initialPages, maximumPages: x.maximumPages,
  maximumMB: x.maximumPages ? Math.round(x.maximumPages * 65536 / 1048576) : null, shared: x.shared,
  currentMB: Math.round(x.m.buffer.byteLength / 1048576) }));

async function loadOrt(ver, entry) {
  const url = `/ort/${ver}/${entry}`;
  if (entry.endsWith('.mjs')) return await import(url);
  await new Promise((res, rej) => { const s = document.createElement('script'); s.src = url;
    s.onload = res; s.onerror = () => rej(new Error('failed to load ' + url)); document.head.appendChild(s); });
  return self.ort;
}

async function attempt(ort, bytes, c, ep, runs) {
  const r = { ep };
  let s;
  try {
    let t = performance.now();
    s = await ort.InferenceSession.create(bytes, { executionProviders: [ep], graphOptimizationLevel: c.opt,
      enableCpuMemArena: c.arena, enableMemPattern: c.memPattern });
    r.createSeconds = +((performance.now() - t) / 1000).toFixed(2);
    r.memAfterCreate = memInfo();
    const x = new Float32Array(2 * SEG);
    for (let i = 0; i < x.length; i++) x[i] = (Math.random() * 2 - 1) * 0.1;
    const feeds = { [s.inputNames[0]]: new ort.Tensor('float32', x, [1, 2, SEG]) };
    r.runSeconds = [];
    for (let k = 0; k < runs; k++) {
      t = performance.now();
      const res = await s.run(feeds);
      r.runSeconds.push(+((performance.now() - t) / 1000).toFixed(2));
      if (k === 0) {
        const o = res[s.outputNames[0]];
        r.outputDims = o.dims;
        const d = o.getData ? await o.getData() : o.data;
        let bad = 0; for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) bad++;
        r.nonFiniteCount = bad;
      }
      for (const v of Object.values(res)) v.dispose?.();
    }
    r.ok = true;
    log(`  ${ep}: OK create ${r.createSeconds}s, run ${r.runSeconds.join(' / ')}s`);
  } catch (e) {
    r.ok = false; r.error = String(e?.message ?? e).slice(0, 500);
    log(`  ${ep}: FAILED ${r.error}`);
  }
  r.memAtEnd = memInfo();
  try { await s?.release(); } catch (_) {}
  return r;
}

let SEG = 343980;
(async () => {
  const i = +(new URLSearchParams(location.search).get('i') ?? 0);
  const cfg = await (await fetch('/config.json', { cache: 'no-store' })).json();
  SEG = cfg.segment;
  const c = cfg.configs[i];
  if (!c) { log('All configurations done. Return to the terminal and press Ctrl+C.'); return; }
  fetch('/start?i=' + i, { cache: 'no-store' });
  const threads = c.threads === 'max' ? Math.min(8, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)) : c.threads;
  log(`Config ${i + 1}/${cfg.configs.length}: ORT ${c.ort}, threads ${threads}, opt ${c.opt}, arena ${c.arena}, memPattern ${c.memPattern}`);
  const R = { i, config: { ...c, threadsResolved: threads }, userAgent: navigator.userAgent,
    crossOriginIsolated: self.crossOriginIsolated, attempts: [] };
  try {
    const ort = await loadOrt(c.ort, cfg.entries[c.ort]);
    ort.env.wasm.wasmPaths = `/ort/${c.ort}/`;
    ort.env.wasm.numThreads = threads;
    R.ortVersion = ort.env.versions?.web ?? c.ort;
    const bytes = new Uint8Array(await (await fetch('/model.onnx')).arrayBuffer());
    const w = await attempt(ort, bytes, c, 'wasm', 1);
    R.attempts.push(w);
    if (c.webgpu && navigator.gpu) R.attempts.push(await attempt(ort, bytes, c, 'webgpu', 2));
  } catch (e) {
    R.fatal = String(e?.message ?? e).slice(0, 500);
    log('  FATAL:', R.fatal);
  }
  await fetch('/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(R) });
  setTimeout(() => { location.href = '/?i=' + (i + 1); }, 1500);
})();
"""


def summarize(r):
    c = r.get("config", {})
    head = (f"[{r.get('i', 0) + 1}] ORT {c.get('ort')} threads={c.get('threadsResolved')} opt={c.get('opt')} "
            f"arena={c.get('arena')} memPattern={c.get('memPattern')}")
    print(head)
    if r.get("fatal"):
        print("     FATAL:", r["fatal"][:200])
    for a in r.get("attempts", []):
        mems = a.get("memAtEnd") or []
        mtxt = ", ".join(f"{m['currentMB']}/{m['maximumMB']} MB{' shared' if m['shared'] else ''}" for m in mems) or "no Memory seen"
        if a.get("ok"):
            print(f"     {a['ep']}: OK  create {a['createSeconds']}s  run {a['runSeconds']}s  wasm mem {mtxt}")
        else:
            print(f"     {a['ep']}: FAIL {a.get('error', '')[:120]}  wasm mem {mtxt}")


def serve(port, open_browser, results):
    ort_dirs = {v: fetch_ort(v) for v in ORT_ENTRIES}
    config = json.dumps({"segment": SEG, "configs": CONFIGS, "entries": ORT_ENTRIES}).encode()
    types = {".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm"}

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body, ctype, path=None):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(os.path.getsize(path) if path else len(body)))
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if path:
                with open(path, "rb") as f:
                    while True:
                        b = f.read(1 << 20)
                        if not b:
                            break
                        self.wfile.write(b)
            else:
                self.wfile.write(body)

        def do_GET(self):
            u = urllib.parse.urlparse(self.path)
            p = u.path
            if p in ("/", "/index.html"):
                return self._send(200, PAGE_HTML.encode(), "text/html; charset=utf-8")
            if p == "/sp2.js":
                return self._send(200, PAGE_JS.encode(), "text/javascript")
            if p == "/config.json":
                return self._send(200, config, "application/json")
            if p == "/model.onnx":
                return self._send(200, b"", "application/octet-stream", MODEL_PATH)
            if p == "/start":
                i = int(urllib.parse.parse_qs(u.query).get("i", ["0"])[0])
                print(f"  running config {i + 1}/{len(CONFIGS)} ...")
                return self._send(200, b"ok", "text/plain")
            m = re.fullmatch(r"/ort/([\d.]+)/([\w.\-]+)", p)
            if m and m.group(1) in ort_dirs:
                f = os.path.join(ort_dirs[m.group(1)], m.group(2))
                if os.path.isfile(f):
                    return self._send(200, b"", types.get(os.path.splitext(f)[1], "application/octet-stream"), f)
            self._send(404, b"not found", "text/plain")

        def do_POST(self):
            if self.path != "/result":
                return self._send(404, b"", "text/plain")
            try:
                r = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
            except ValueError:
                return self._send(400, b"bad json", "text/plain")
            results["browser"].append(r)
            save(results)
            summarize(r)
            if r.get("i", 0) + 1 >= len(CONFIGS):
                print(f"\nAll configurations done. Press Ctrl+C, then send {OUT_PATH}.")
            self._send(200, b"ok", "text/plain")

    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    url = f"http://localhost:{port}/?i=0"
    print(f"\nTest page: {url}  (Chrome or Edge)")
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
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--no-open", action="store_true")
    ap.add_argument("--skip-python", action="store_true", help="skip model analysis and native probe")
    a = ap.parse_args()
    results = {"script": "sp2", "version": 1, "run_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "python": sys.version.split()[0], "platform": sys.platform, "model_sha256": MODEL_SHA,
               "model_analysis": None, "native": None, "browser": []}
    print("Model")
    ensure_model()
    if not a.skip_python:
        print("\nPart A: model structure")
        results["model_analysis"] = analyse_model()
        save(results)
        print("\nPart A: native onnxruntime memory (for comparison with the browser)")
        results["native"] = native_probe()
        save(results)
    print("\nPart B: browser configuration matrix")
    try:
        serve(a.port, not a.no_open, results)
    finally:
        save(results)
        print(f"\nSaved {OUT_PATH}")


if __name__ == "__main__":
    main()
