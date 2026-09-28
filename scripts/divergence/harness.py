#!/usr/bin/env python3
"""Native-vs-WASM comparison harness (plans/perf-divergence D-107).

    python scripts/divergence/harness.py run --model M.onnx --wav in.wav --chunk 3 --runtimes native,wasm-node --out DIR [--expose-file names.txt]

Writes DIR/result.json (schema in tests/divergence/test_harness_tiny.py) plus raw float32 dumps. Tensor names to expose are
passed via FILE, never argv (Git-Bash/MSYS rewrites a leading '/' in argv - SP-7).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import soundfile as sf

import metrics

ROOT = Path(__file__).resolve().parents[2]
RUN_WASM_NODE = Path(__file__).resolve().parent / "run-wasm-node.mjs"
RUN_WASM_NODE_BATCH = Path(__file__).resolve().parent / "run-wasm-node-batch.mjs"
D12_OPTIONS = {"graph_optimization_level": "disabled", "enable_cpu_mem_arena": False, "enable_mem_pattern": False}


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ort_web_version() -> str:
    package_json = ROOT / "node_modules" / "onnxruntime-web" / "package.json"
    return json.loads(package_json.read_text(encoding="utf8"))["version"]


def load_expose_names(path: Path | None) -> list[str]:
    if path is None:
        return []
    names = []
    for line in path.read_text(encoding="utf8").splitlines():
        line = line.strip()
        if line:
            names.append(line)
    return names


def build_exposed_model(model_path: Path, expose_names: list[str], out_dir: Path) -> Path:
    """Appends `expose_names` to graph.output as untyped-shape FLOAT ValueInfo (D-107). Returns the model to actually
    run — the original path when nothing needs exposing, else a new "exposed.onnx" under out_dir."""
    if not expose_names:
        return model_path
    model = onnx.load(str(model_path))
    existing = {o.name for o in model.graph.output}
    for name in expose_names:
        if name in existing:
            continue
        model.graph.output.append(onnx.helper.make_tensor_value_info(name, onnx.TensorProto.FLOAT, None))
        existing.add(name)
    exposed_path = out_dir / "exposed.onnx"
    onnx.save(model, str(exposed_path))
    return exposed_path


def run_native(model_path: Path, input_array: np.ndarray, output_names: list[str]) -> tuple[dict, list[np.ndarray]]:
    sess_options = ort.SessionOptions()
    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    sess_options.enable_cpu_mem_arena = False
    sess_options.enable_mem_pattern = False

    t0 = time.perf_counter()
    session = ort.InferenceSession(str(model_path), sess_options=sess_options, providers=["CPUExecutionProvider"])
    create_s = time.perf_counter() - t0

    input_name = session.get_inputs()[0].name
    t0 = time.perf_counter()
    outputs = session.run(output_names, {input_name: input_array})
    run_s = time.perf_counter() - t0

    meta = {
        "session_options": D12_OPTIONS,
        "ort_version": ort.__version__,
        "create_s": create_s,
        "run_s": run_s,
    }
    return meta, outputs


def run_wasm_node(model_path: Path, input_array: np.ndarray, output_names: list[str], out_dir: Path, chunk: int) -> tuple[dict, list[np.ndarray]]:
    input_path = out_dir / f"in_chunk{chunk}.f32"
    input_array.astype(np.float32, copy=False).tofile(input_path)

    names_path = out_dir / f"expose_wasm_chunk{chunk}.txt"
    # output_names[0] is the primary output; run-wasm-node.mjs always fetches it plus anything listed here.
    names_path.write_text("\n".join(output_names[1:]) + ("\n" if len(output_names) > 1 else ""), encoding="utf8")

    outprefix = out_dir / f"wasm-node_raw_chunk{chunk}"
    args = ["node", str(RUN_WASM_NODE), str(model_path), str(input_path), str(outprefix), "--expose-file", str(names_path)]
    proc = subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"run-wasm-node.mjs failed (chunk {chunk}): {proc.stderr[-4000:]}")

    stdout_line = next((line for line in proc.stdout.splitlines() if line.strip().startswith("{")), None)
    if stdout_line is None:
        raise RuntimeError(f"run-wasm-node.mjs produced no JSON output (chunk {chunk}): {proc.stdout[-2000:]}")
    payload = json.loads(stdout_line)

    outputs = []
    for i, name in enumerate(output_names):
        shape = payload["shapes"][name]
        arr = np.fromfile(f"{outprefix}.{i}.f32", dtype=np.float32).reshape(shape)
        outputs.append(arr)

    meta = {
        "session_options": D12_OPTIONS,
        "ort_version": payload["ort_version"],
        "create_s": payload["create_s"],
        "run_s": payload["run_s"],
        "threads": 1,
    }
    return meta, outputs


def cmd_run(args: argparse.Namespace) -> int:
    model_path = Path(args.model)
    if not model_path.is_file():
        print(f"harness.py: model file not found: {model_path}", file=sys.stderr)
        return 1
    wav_path = Path(args.wav)
    if not wav_path.is_file():
        print(f"harness.py: wav file not found: {wav_path}", file=sys.stderr)
        return 1

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    requested_runtimes = [r.strip() for r in args.runtimes.split(",") if r.strip()]
    for r in requested_runtimes:
        if r not in ("native", "wasm-node"):
            print(f"harness.py: unknown runtime {r!r} (expected native or wasm-node)", file=sys.stderr)
            return 1
    if not requested_runtimes:
        print("harness.py: --runtimes must list at least one runtime", file=sys.stderr)
        return 1

    data, _sr = sf.read(str(wav_path), dtype="float32", always_2d=True)  # (n, channels)
    signal = data.T  # (channels, n); D-105 always feeds a stereo (2, n) signal
    if signal.shape[0] != 2:
        print(f"harness.py: expected a stereo wav, got {signal.shape[0]} channel(s)", file=sys.stderr)
        return 1

    try:
        chunk_arr = metrics.chunk_window(signal, args.chunk)
    except ValueError as err:
        print(f"harness.py: bad --chunk: {err}", file=sys.stderr)
        return 1
    input_array = chunk_arr.reshape(1, 2, metrics.SEGMENT_SAMPLES)

    expose_names = load_expose_names(Path(args.expose_file) if args.expose_file else None)
    run_model_path = build_exposed_model(model_path, expose_names, out_dir)

    # Discover the (possibly-augmented) model's primary output name once, from whichever runtime runs first.
    probe = onnx.load(str(run_model_path))
    primary_output_name = probe.graph.output[0].name
    output_names = [primary_output_name, *expose_names]

    runtimes: dict[str, dict] = {}
    primary_by_runtime: dict[str, np.ndarray] = {}
    exposed_by_runtime: dict[str, list[np.ndarray]] = {}

    for runtime in requested_runtimes:
        if runtime == "native":
            meta, outputs = run_native(run_model_path, input_array, output_names)
        else:
            meta, outputs = run_wasm_node(run_model_path, input_array, output_names, out_dir, args.chunk)
        runtimes[runtime] = meta
        primary_by_runtime[runtime] = outputs[0]
        exposed_by_runtime[runtime] = outputs[1:]
        outputs[0].astype(np.float32, copy=False).tofile(out_dir / f"{runtime}_chunk{args.chunk}.f32")

    per_stem = None
    exposed_result: list[dict] = []
    if "native" in primary_by_runtime and "wasm-node" in primary_by_runtime:
        per_stem = metrics.compare_stems(primary_by_runtime["native"], primary_by_runtime["wasm-node"])
        for i, name in enumerate(expose_names):
            native_arr = exposed_by_runtime["native"][i]
            wasm_arr = exposed_by_runtime["wasm-node"][i]
            cmp = metrics.compare_arrays(native_arr.reshape(-1), wasm_arr.reshape(-1))
            exposed_result.append({"tensor": name, "n": int(native_arr.size), **cmp})

    git_commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    node_version = subprocess.run(["node", "-v"], capture_output=True, text=True).stdout.strip()

    result = {
        "schema": 1,
        "model": {"path": str(model_path), "sha256": sha256_file(model_path)},
        "input": {
            "path": str(wav_path),
            "sha256": sha256_file(wav_path),
            "chunk": args.chunk,
            "chunk_start_sample": (args.chunk - 1) * metrics.STRIDE_SAMPLES,
            "samples": metrics.SEGMENT_SAMPLES,
        },
        "reference": "native",
        "runtimes": runtimes,
        "per_stem": per_stem,
        "exposed": exposed_result,
        "provenance": {
            "git_commit": git_commit,
            "requirements_sha256": sha256_file(ROOT / "scripts" / "divergence" / "requirements.txt"),
            "python": platform.python_version(),
            "node": node_version,
            "ort_web_version": ort_web_version(),
            "platform": platform.platform(),
            "utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
    }
    (out_dir / "result.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf8")
    return 0


def sanitize_variant_name(name: str) -> str:
    return "".join(c if c.isalnum() or c in "_.-" else "_" for c in name)


def build_sweep_variants(signal: np.ndarray, chunk: int) -> list[tuple[str, np.ndarray]]:
    """The D1 variant list (plans/perf-divergence D-106): <= 30 variants of one chunk, each
    shape (2, SEGMENT_SAMPLES) float32. `signal` is the full decoded (2, N) fixture."""
    variants: list[tuple[str, np.ndarray]] = []
    base_chunk = metrics.chunk_window(signal, chunk)
    variants.append(("baseline", base_chunk))

    rng = np.random.default_rng(1234)  # fixed seed: descriptive sweep, reproducible across re-runs
    for sigma in (1e-7, 1e-6, 1e-5, 1e-4, 1e-3):
        c = base_chunk.copy()
        c[1] = c[1] + rng.normal(0, sigma, size=c.shape[1]).astype(np.float32)
        variants.append((f"noise_sigma_{sigma:g}", c))

    # Isolate/remove chord tones via narrow-band FFT filtering of the FULL signal (the exact
    # synthesis recipe for golden-tones-mono-20s.wav isn't available -- only the recovered WAV
    # is, see tests/fixtures/diagnostic/README.md -- so tones are extracted from the real
    # fixture's own spectrum rather than resynthesized).
    sample_rate = 44_100
    tone_freqs = (330.0, 440.0, 550.0)

    def filtered_signal(keep_freqs: tuple[float, ...]) -> np.ndarray:
        freq_axis = np.fft.rfftfreq(signal.shape[1], 1 / sample_rate)
        mask = np.zeros_like(freq_axis, dtype=bool)
        for f in keep_freqs:
            mask |= np.abs(freq_axis - f) <= 2.0
        out = np.zeros_like(signal)
        for ch in range(signal.shape[0]):
            spec = np.fft.rfft(signal[ch])
            out[ch] = np.fft.irfft(np.where(mask, spec, 0), n=signal.shape[1])
        return out.astype(np.float32)

    for f in tone_freqs:
        variants.append((f"tone_alone_{int(f)}hz", metrics.chunk_window(filtered_signal((f,)), chunk)))
    for i in range(len(tone_freqs)):
        for j in range(i + 1, len(tone_freqs)):
            pair = (tone_freqs[i], tone_freqs[j])
            variants.append((f"tone_pair_{int(pair[0])}_{int(pair[1])}hz", metrics.chunk_window(filtered_signal(pair), chunk)))

    for gain in (0.1, 0.5, 2.0, 4.0):
        variants.append((f"gain_{gain}x", np.clip(base_chunk * gain, -1.0, 1.0).astype(np.float32)))

    for k in (1, 2, 4):
        variants.append((f"chunk_{k}", metrics.chunk_window(signal, k)))

    for shift in (-100, -1, 1, 100, 10_000):
        start = max(0, (chunk - 1) * metrics.STRIDE_SAMPLES + shift)
        end = min(start + metrics.SEGMENT_SAMPLES, signal.shape[1])
        c = np.zeros((2, metrics.SEGMENT_SAMPLES), dtype=np.float32)
        c[:, : end - start] = signal[:, start:end]
        variants.append((f"shift_{shift:+d}", c))

    return variants


def cmd_sweep(args: argparse.Namespace) -> int:
    model_path = Path(args.model)
    if not model_path.is_file():
        print(f"harness.py: model file not found: {model_path}", file=sys.stderr)
        return 1
    wav_path = Path(args.wav)
    if not wav_path.is_file():
        print(f"harness.py: wav file not found: {wav_path}", file=sys.stderr)
        return 1

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    inputs_dir = out_dir / "sweep_inputs"
    outputs_dir = out_dir / "sweep_outputs"
    inputs_dir.mkdir(parents=True, exist_ok=True)
    outputs_dir.mkdir(parents=True, exist_ok=True)

    data, _sr = sf.read(str(wav_path), dtype="float32", always_2d=True)
    signal = data.T
    if signal.shape[0] != 2:
        print(f"harness.py: expected a stereo wav, got {signal.shape[0]} channel(s)", file=sys.stderr)
        return 1

    try:
        variants = build_sweep_variants(signal, args.chunk)
    except ValueError as err:
        print(f"harness.py: bad --chunk: {err}", file=sys.stderr)
        return 1

    manifest = []
    for name, chunk_arr in variants:
        input_path = inputs_dir / f"{sanitize_variant_name(name)}.f32"
        chunk_arr.reshape(1, 2, metrics.SEGMENT_SAMPLES).astype(np.float32).tofile(input_path)
        manifest.append({"name": name, "input": str(input_path)})
    manifest_path = out_dir / "sweep_manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf8")

    # Native: one session created once, then reused for every variant (D-106: "creating each
    # runtime session once and iterating variants" -- session creation otherwise dominates: ~84 s
    # each, see research/divergence/BUDGET.md's D0 entries).
    sess_options = ort.SessionOptions()
    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    sess_options.enable_cpu_mem_arena = False
    sess_options.enable_mem_pattern = False
    native_session = ort.InferenceSession(str(model_path), sess_options=sess_options, providers=["CPUExecutionProvider"])
    input_name = native_session.get_inputs()[0].name
    output_name = native_session.get_outputs()[0].name

    native_outputs: dict[str, np.ndarray] = {}
    for name, chunk_arr in variants:
        input_array = chunk_arr.reshape(1, 2, metrics.SEGMENT_SAMPLES).astype(np.float32)
        native_outputs[name] = native_session.run([output_name], {input_name: input_array})[0]

    # WASM: one session created once (in the batch script), reused for every variant.
    proc = subprocess.run(
        ["node", str(RUN_WASM_NODE_BATCH), str(model_path), str(manifest_path), str(outputs_dir)],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        print(f"harness.py: run-wasm-node-batch.mjs failed: {proc.stderr[-4000:]}", file=sys.stderr)
        return 1
    stdout_line = next((line for line in proc.stdout.splitlines() if line.strip().startswith("{")), None)
    if stdout_line is None:
        print(f"harness.py: run-wasm-node-batch.mjs produced no JSON output: {proc.stdout[-2000:]}", file=sys.stderr)
        return 1

    results = []
    for name, _chunk_arr in variants:
        wasm_path = outputs_dir / f"{sanitize_variant_name(name)}.f32"
        wasm_arr = np.fromfile(wasm_path, dtype=np.float32).reshape(native_outputs[name].shape)
        per_stem = metrics.compare_stems(native_outputs[name], wasm_arr)
        results.append({"name": name, "per_stem": per_stem, "is_reproduced": metrics.is_reproduced(per_stem)})

    out_payload = {"schema": 1, "chunk": args.chunk, "variants": results}
    (out_dir / "d1-sweep.json").write_text(json.dumps(out_payload, indent=2) + "\n", encoding="utf8")

    md_lines = ["| Variant | vocals rel_l2 | is_reproduced |", "|---|---|---|"]
    for r in results:
        md_lines.append(f"| {r['name']} | {r['per_stem']['vocals']['rel_l2']:.6g} | {r['is_reproduced']} |")
    (out_dir / "d1-sweep.md").write_text("\n".join(md_lines) + "\n", encoding="utf8")

    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="harness.py")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run")
    run_parser.add_argument("--model", required=True)
    run_parser.add_argument("--wav", required=True)
    run_parser.add_argument("--chunk", type=int, required=True)
    run_parser.add_argument("--runtimes", default="native,wasm-node")
    run_parser.add_argument("--out", required=True)
    run_parser.add_argument("--expose-file", default=None)
    run_parser.set_defaults(func=cmd_run)

    sweep_parser = subparsers.add_parser("sweep")
    sweep_parser.add_argument("--model", required=True)
    sweep_parser.add_argument("--wav", required=True)
    sweep_parser.add_argument("--chunk", type=int, required=True)
    sweep_parser.add_argument("--out", required=True)
    sweep_parser.set_defaults(func=cmd_sweep)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
