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

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
