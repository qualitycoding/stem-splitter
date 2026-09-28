#!/usr/bin/env python3
"""D2 "third opinion" (plans/perf-divergence D-106, S-109): native thread-count,
denormal-as-zero, fp32-vs-fp16 weights, and WebGPU, all on chunk 3 of the target fixture.
Evidence only -- not the classifier (D4/D5 in S-110 own that). Builds the pairwise rel_l2
matrix (vocals + all stems) across every variant run here plus the D0 native/wasm-node pair.

    python scripts/divergence/d2_variants.py --model-fp16 M16.onnx --model-fp32 M32.onnx \
        --wav in.wav --chunk 3 --out research/divergence [--native-reference N.f32] [--wasm-node-reference W.f32]
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import soundfile as sf

import metrics

ROOT = Path(__file__).resolve().parents[2]
RUN_WASM_BROWSER = Path(__file__).resolve().parent / "run-wasm-browser.mjs"


def load_chunk(wav_path: Path, chunk: int) -> np.ndarray:
    data, _sr = sf.read(str(wav_path), dtype="float32", always_2d=True)
    signal = data.T
    return metrics.chunk_window(signal, chunk)


def run_native(model_path: Path, input_array: np.ndarray, *, intra_op_num_threads: int | None = None, denormal_as_zero: bool = False):
    sess_options = ort.SessionOptions()
    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    sess_options.enable_cpu_mem_arena = False
    sess_options.enable_mem_pattern = False
    if intra_op_num_threads is not None:
        sess_options.intra_op_num_threads = intra_op_num_threads
    denormal_status = "not requested"
    if denormal_as_zero:
        try:
            sess_options.add_session_config_entry("session.set_denormal_as_zero", "1")
            denormal_status = "requested"
        except Exception as err:  # pragma: no cover - depends on installed ORT build
            denormal_status = f"unsupported: {err}"
    session = ort.InferenceSession(str(model_path), sess_options=sess_options, providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name
    output = session.run([output_name], {input_name: input_array})[0]
    return output, denormal_status


def run_webgpu_browser(model_path: Path, input_path: Path, outprefix: Path) -> tuple[np.ndarray, dict]:
    proc = subprocess.run(
        ["node", str(RUN_WASM_BROWSER), str(model_path), str(input_path), str(outprefix), "--ep", "webgpu"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"run-wasm-browser.mjs --ep webgpu failed: {proc.stderr[-4000:]}")
    stdout_line = next((line for line in proc.stdout.splitlines() if line.strip().startswith("{")), None)
    if stdout_line is None:
        raise RuntimeError(f"run-wasm-browser.mjs --ep webgpu produced no JSON: {proc.stdout[-2000:]}")
    payload = json.loads(stdout_line)
    shape = payload["shapes"][payload["outputNames"][0]]
    arr = np.fromfile(f"{outprefix}.0.f32", dtype=np.float32).reshape(shape)
    return arr, payload


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-fp16", required=True)
    parser.add_argument("--model-fp32", required=True)
    parser.add_argument("--wav", required=True)
    parser.add_argument("--chunk", type=int, required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_dir = out_dir / "raw" / "d2"
    raw_dir.mkdir(parents=True, exist_ok=True)

    chunk = load_chunk(Path(args.wav), args.chunk)
    input_array = chunk.reshape(1, 2, metrics.SEGMENT_SAMPLES)
    input_path = raw_dir / f"in_chunk{args.chunk}.f32"
    input_array.astype(np.float32).tofile(input_path)

    fp16_model = Path(args.model_fp16)
    fp32_model = Path(args.model_fp32)

    variants: dict[str, np.ndarray] = {}
    meta: dict[str, dict] = {}

    native_default, _ = run_native(fp16_model, input_array)
    variants["native_fp16_default"] = native_default

    native_1t, _ = run_native(fp16_model, input_array, intra_op_num_threads=1)
    variants["native_fp16_threads1"] = native_1t

    native_4t, _ = run_native(fp16_model, input_array, intra_op_num_threads=4)
    variants["native_fp16_threads4"] = native_4t

    native_denorm, denorm_status = run_native(fp16_model, input_array, denormal_as_zero=True)
    variants["native_fp16_denormal_as_zero"] = native_denorm
    meta["denormal_as_zero_status"] = denorm_status

    native_fp32, _ = run_native(fp32_model, input_array)
    variants["native_fp32_default"] = native_fp32

    webgpu_arr, webgpu_meta = run_webgpu_browser(fp16_model, input_path, raw_dir / "webgpu")
    variants["webgpu_fp16"] = webgpu_arr
    meta["webgpu"] = webgpu_meta

    # Pairwise rel_l2 matrix (whole-tensor and vocals-only)
    names = list(variants)
    matrix_whole = {}
    matrix_vocals = {}
    for a in names:
        matrix_whole[a] = {}
        matrix_vocals[a] = {}
        for b in names:
            cmp_whole = metrics.compare_arrays(variants[a].reshape(-1), variants[b].reshape(-1))
            cmp_stems = metrics.compare_stems(variants[a], variants[b])
            matrix_whole[a][b] = cmp_whole["rel_l2"]
            matrix_vocals[a][b] = cmp_stems["vocals"]["rel_l2"]

    result = {
        "schema": 1,
        "chunk": args.chunk,
        "variants": names,
        "matrix_whole_tensor_rel_l2": matrix_whole,
        "matrix_vocals_rel_l2": matrix_vocals,
        "meta": meta,
    }
    (out_dir / "d2-variants.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf8")

    md = ["# D2 pairwise rel_l2 matrix (vocals)", "", "| vs |" + "|".join(names) + "|", "|---|" + "|".join("---" for _ in names) + "|"]
    for a in names:
        row = [f"{matrix_vocals[a][b]:.6g}" for b in names]
        md.append(f"| {a} | " + " | ".join(row) + " |")
    md.append("")
    md.append(f"denormal_as_zero: {denorm_status}")
    md.append(f"webgpu meta: {json.dumps(webgpu_meta)}")
    (out_dir / "d2-matrix.md").write_text("\n".join(md) + "\n", encoding="utf8")

    print(f"Wrote {out_dir / 'd2-variants.json'} and {out_dir / 'd2-matrix.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
