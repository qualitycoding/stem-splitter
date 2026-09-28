#!/usr/bin/env python3
"""Captures real native-runtime tensor values for D4 op-level isolation (plans/perf-divergence
S-110): harness.py's `run` command only records compare_arrays() summaries for exposed
tensors, not their raw values. This loads the model, exposes the requested tensor names,
runs native ORT once (D-12 options), and dumps each tensor's raw float32 bytes + shape.

    python scripts/divergence/capture_inputs.py --model M.onnx --wav in.wav --chunk 3 \
        --names-file names.txt --out DIR
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import soundfile as sf

import metrics
from harness import build_exposed_model, load_expose_names


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--wav", required=True)
    parser.add_argument("--chunk", type=int, required=True)
    parser.add_argument("--names-file", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    names = load_expose_names(Path(args.names_file))
    model_path = Path(args.model)
    run_model_path = build_exposed_model(model_path, names, out_dir)

    data, _sr = sf.read(str(args.wav), dtype="float32", always_2d=True)
    signal = data.T
    input_array = metrics.chunk_window(signal, args.chunk).reshape(1, 2, metrics.SEGMENT_SAMPLES)

    sess_options = ort.SessionOptions()
    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    sess_options.enable_cpu_mem_arena = False
    sess_options.enable_mem_pattern = False
    session = ort.InferenceSession(str(run_model_path), sess_options=sess_options, providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name

    outputs = session.run(names, {input_name: input_array})

    manifest = []
    for name, arr in zip(names, outputs):
        safe = "".join(c if c.isalnum() or c in "_.-" else "_" for c in name)
        path = out_dir / f"{safe}.f32"
        arr.astype(np.float32).tofile(path)
        manifest.append({"name": name, "shape": list(arr.shape), "path": str(path)})

    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
    print(f"Captured {len(manifest)} tensors to {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
