#!/usr/bin/env python3
"""D4 op-level isolation (plans/perf-divergence D-106, S-110): for each D3 candidate node,
builds a single-node ONNX model using the node's REAL captured input values (from native,
D4's own methodology: hold input fixed and identical for both runtimes so only the op's
implementation can differ), runs native and wasm-node on it, and compares both against a
float64 oracle (scripts/divergence/oracle.py) via metrics.judge_op.

    python scripts/divergence/d4_isolate.py --model M.onnx --candidates C.json \
        --captured-manifest MANIFEST.json --out research/divergence
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort

import metrics
import oracle

ROOT = Path(__file__).resolve().parents[2]
RUN_WASM_GENERIC = Path(__file__).resolve().parent / "run-wasm-node-generic.mjs"


def sanitize(name: str) -> str:
    return "".join(c if c.isalnum() or c in "_.-" else "_" for c in name)


def run_native_single_node(node: onnx.NodeProto, inputs: dict[str, np.ndarray]) -> np.ndarray:
    from onnx import TensorProto, helper

    input_infos = [helper.make_tensor_value_info(n, TensorProto.FLOAT, list(inputs[n].shape)) for n in node.input if n]
    output_infos = [helper.make_tensor_value_info(n, TensorProto.FLOAT, None) for n in node.output if n]
    graph = helper.make_graph([node], "isolated", input_infos, output_infos)
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    model.ir_version = 9

    sess_options = ort.SessionOptions()
    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    session = ort.InferenceSession(model.SerializeToString(), sess_options=sess_options, providers=["CPUExecutionProvider"])
    feed = {n: inputs[n].astype(np.float32) for n in node.input if n}
    return session.run(None, feed)[0]


def run_wasm_single_node(node: onnx.NodeProto, inputs: dict[str, np.ndarray], work_dir: Path) -> np.ndarray:
    from onnx import TensorProto, helper

    input_infos = [helper.make_tensor_value_info(n, TensorProto.FLOAT, list(inputs[n].shape)) for n in node.input if n]
    output_infos = [helper.make_tensor_value_info(n, TensorProto.FLOAT, None) for n in node.output if n]
    graph = helper.make_graph([node], "isolated", input_infos, output_infos)
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    model.ir_version = 9
    model_path = work_dir / f"{sanitize(node.name)}.onnx"
    onnx.save(model, str(model_path))

    inputs_manifest = []
    for n in node.input:
        if not n:
            continue
        arr = inputs[n].astype(np.float32)
        path = work_dir / f"{sanitize(node.name)}_{sanitize(n)}.f32"
        arr.tofile(path)
        inputs_manifest.append({"name": n, "shape": list(arr.shape) or [1], "path": str(path)})
    manifest_path = work_dir / f"{sanitize(node.name)}_inputs.json"
    manifest_path.write_text(json.dumps(inputs_manifest), encoding="utf8")

    outprefix = work_dir / f"{sanitize(node.name)}_wasm"
    proc = subprocess.run(
        ["node", str(RUN_WASM_GENERIC), str(model_path), str(manifest_path), str(outprefix)],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"run-wasm-node-generic.mjs failed for {node.name}: {proc.stderr[-4000:]}")
    stdout_line = next((line for line in proc.stdout.splitlines() if line.strip().startswith("{")), None)
    if stdout_line is None:
        raise RuntimeError(f"run-wasm-node-generic.mjs produced no JSON for {node.name}: {proc.stdout[-2000:]}")
    payload = json.loads(stdout_line)
    return np.fromfile(f"{outprefix}.0.f32", dtype=np.float32).reshape(payload["dims"])


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--candidates", required=True)
    parser.add_argument("--captured-manifest", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    model = onnx.load(args.model)
    node_by_output = {}
    for n in model.graph.node:
        for out in n.output:
            node_by_output[out] = n

    captured = {e["name"]: e for e in json.loads(Path(args.captured_manifest).read_text(encoding="utf8"))}

    def load_input(name: str) -> np.ndarray:
        entry = captured[name]
        shape = entry["shape"] or [1]
        return np.fromfile(entry["path"], dtype=np.float32).reshape(shape)

    candidates_payload = json.loads(Path(args.candidates).read_text(encoding="utf8"))
    candidate_names = candidates_payload["candidates"]

    out_dir = Path(args.out).resolve()
    work_dir = out_dir / "raw" / "d4"
    work_dir.mkdir(parents=True, exist_ok=True)

    results = []
    op_result = None
    for cand_output in candidate_names:
        node = node_by_output[cand_output]
        entry: dict = {"candidate": cand_output, "node_name": node.name, "op_type": node.op_type}
        if not oracle.has_oracle(node.op_type):
            entry["status"] = "no oracle"
            results.append(entry)
            continue

        inputs = {n: load_input(n) for n in node.input if n}

        native_out = run_native_single_node(node, inputs)
        wasm_out = run_wasm_single_node(node, inputs, work_dir)
        oracle_out = oracle.run_oracle(node, inputs)

        err_native = metrics.compare_arrays(oracle_out.reshape(-1), native_out.reshape(-1).astype(np.float64))["rel_l2"]
        err_wasm = metrics.compare_arrays(oracle_out.reshape(-1), wasm_out.reshape(-1).astype(np.float64))["rel_l2"]
        judgement = metrics.judge_op(err_native, err_wasm)

        entry.update({"status": "evaluated", "err_native": err_native, "err_wasm": err_wasm, "judge_op": judgement})
        results.append(entry)

        if op_result is None and judgement != "agree":
            op_result = judgement

    evaluated = [r for r in results if r.get("status") == "evaluated"]
    if op_result is None and evaluated:
        op_result = "agree"  # every evaluated candidate agreed

    payload = {"schema": 1, "candidates": results, "op_result": op_result}
    (out_dir / "d4-ops.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf8")

    md = ["| Candidate | op_type | status | err_native | err_wasm | judge_op |", "|---|---|---|---|---|---|"]
    for r in results:
        if r["status"] == "no oracle":
            md.append(f"| {r['candidate']} | {r['op_type']} | no oracle | - | - | - |")
        else:
            md.append(f"| {r['candidate']} | {r['op_type']} | evaluated | {r['err_native']:.6g} | {r['err_wasm']:.6g} | {r['judge_op']} |")
    md.append("")
    md.append(f"**op_result**: {op_result}")
    (out_dir / "d4-ops.md").write_text("\n".join(md) + "\n", encoding="utf8")

    print(f"Wrote {out_dir / 'd4-ops.json'} and {out_dir / 'd4-ops.md'}")
    print("op_result:", op_result)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
