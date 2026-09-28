#!/usr/bin/env python3
"""Supporting evidence for an AMPLIFICATION outcome (plans/perf-divergence D-106, S-110,
mandatory when D5 returns AMPLIFICATION): perturbs the native input by relative Gaussian
noise at several magnitudes epsilon and measures how much the perturbation grows by the
time it reaches the vocals stem, to see whether this network is generically ill-conditioned
on this input class (which would make the native-vs-WASM divergence unsurprising) rather
than something specific to the runtime comparison. Descriptive only -- does not change the
D5 classification.

    python scripts/divergence/d5_perturbation.py --model M.onnx --wav in.wav --chunk 3 --out research/divergence
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import soundfile as sf

import metrics

EPSILONS = (1e-7, 1e-6, 1e-5, 1e-4)
SEEDS = (0, 1, 2, 3, 4)


def perturb(x: np.ndarray, epsilon: float, seed: int) -> np.ndarray:
    """Adds Gaussian noise scaled so the perturbation's own L2 norm is exactly epsilon * ||x||
    (a precise relative-L2 perturbation, directly comparable to the rel_l2 metric used
    everywhere else in this investigation)."""
    rng = np.random.default_rng(seed)
    noise = rng.standard_normal(x.shape).astype(np.float64)
    noise_unit = noise / np.linalg.norm(noise)
    return x + epsilon * float(np.linalg.norm(x)) * noise_unit


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--wav", required=True)
    parser.add_argument("--chunk", type=int, required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    data, _sr = sf.read(str(args.wav), dtype="float32", always_2d=True)
    signal = data.T
    chunk = metrics.chunk_window(signal, args.chunk)
    base_input = chunk.reshape(1, 2, metrics.SEGMENT_SAMPLES).astype(np.float64)

    sess_options = ort.SessionOptions()
    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    sess_options.enable_cpu_mem_arena = False
    sess_options.enable_mem_pattern = False
    session = ort.InferenceSession(str(args.model), sess_options=sess_options, providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name

    baseline = session.run([output_name], {input_name: base_input.astype(np.float32)})[0]

    rows = []
    for epsilon in EPSILONS:
        per_seed = []
        for seed in SEEDS:
            perturbed = perturb(base_input, epsilon, seed).astype(np.float32)
            out = session.run([output_name], {input_name: perturbed})[0]
            per_stem = metrics.compare_stems(baseline, out)
            vocals_rel_l2 = per_stem["vocals"]["rel_l2"]
            per_seed.append(vocals_rel_l2)
            rows.append({"epsilon": epsilon, "seed": seed, "vocals_rel_l2": vocals_rel_l2, "amplification": vocals_rel_l2 / epsilon})
        median = float(np.median(per_seed))
        print(f"epsilon={epsilon:g}: median vocals rel_l2={median:.6g}, amplification={median / epsilon:.6g}x")

    out_dir = Path(args.out)
    payload = {"schema": 1, "chunk": args.chunk, "rows": rows}
    (out_dir / "d5-perturbation.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf8")

    md = ["| epsilon (relative L2) | seed | vocals rel_l2 (vs unperturbed) | implied amplification |", "|---|---|---|---|"]
    for r in rows:
        md.append(f"| {r['epsilon']:g} | {r['seed']} | {r['vocals_rel_l2']:.6g} | {r['amplification']:.6g}x |")
    (out_dir / "d5-perturbation.md").write_text("\n".join(md) + "\n", encoding="utf8")

    print(f"Wrote {out_dir / 'd5-perturbation.json'} and {out_dir / 'd5-perturbation.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
