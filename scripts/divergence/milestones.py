"""Milestone tensor names for D3 profile bisection (plans/perf-divergence D-106, S-109):
the last output of each module block (tencoder.N, encoder.N, crosstransformer, tdecoder.N,
decoder.N), every LayerNormalization output, every Softmax output, and every
InstanceNormalization output in the first two encoder blocks. Tensors with more than
MAX_ELEMENTS elements are skipped (logged by the caller) -- exposing a huge intermediate
tensor as a graph output risks `RangeError: Array buffer allocation failed` in ORT Web.
"""
from __future__ import annotations

import re
from pathlib import Path

import onnx
from onnx import shape_inference

MAX_ELEMENTS = 50_000_000

# tencoder.N / encoder.N / tdecoder.N / decoder.N are stacks of numbered blocks; crosstransformer
# is one architectural module (the transformer bridge) treated as a single block.
NUMBERED_BLOCK_RE = re.compile(r"^/(tencoder|encoder|tdecoder|decoder)\.(\d+)(?:/|$)")


def _tensor_element_count(value_info_by_name: dict[str, onnx.ValueInfoProto], name: str) -> int | None:
    vi = value_info_by_name.get(name)
    if vi is None or not vi.type.HasField("tensor_type"):
        return None
    dims = vi.type.tensor_type.shape.dim
    if any(not d.HasField("dim_value") for d in dims):
        return None  # dynamic/unknown dimension: can't size it, caller decides what to do
    count = 1
    for d in dims:
        count *= d.dim_value
    return count


def _emit(results: list[dict], seen: set[str], name: str, kind: str, value_info_by_name: dict[str, onnx.ValueInfoProto]) -> None:
    if name in seen:
        return
    seen.add(name)
    n = _tensor_element_count(value_info_by_name, name)
    if n is not None and n > MAX_ELEMENTS:
        return  # caller logs skips separately if it wants to; kept simple here
    results.append({"name": name, "kind": kind, "n": n})


def milestone_names(model_path: str | Path) -> list[dict]:
    """Returns [{"name": tensor_name, "kind": "...", "n": element_count_or_None}, ...], in
    graph execution order (required for first_divergence's "first exceedance" semantics --
    crosstransformer's internal LayerNorm/Softmax milestones happen *between* the encoder and
    decoder block milestones, not after all of them), skipping tensors over MAX_ELEMENTS.
    `kind` is one of "block", "layernorm", "softmax", "instancenorm"."""
    model = onnx.load(str(model_path))
    inferred = shape_inference.infer_shapes(model)
    value_info_by_name = {vi.name: vi for vi in list(inferred.graph.value_info) + list(inferred.graph.output)}

    # Pass 1: find the LAST node (by graph order) for each block key.
    last_node_name_by_block: dict[str, str] = {}
    for node in model.graph.node:
        m = NUMBERED_BLOCK_RE.match(node.name)
        if m:
            block_key = f"{m.group(1)}.{m.group(2)}"
        elif node.name.startswith("/crosstransformer"):
            block_key = "crosstransformer"
        else:
            continue
        if node.output:
            last_node_name_by_block[block_key] = node.name  # overwritten as later matches are found; last wins
    last_node_names = set(last_node_name_by_block.values())

    encoder_instancenorm_prefixes = ("/encoder.0", "/encoder.1")

    # Pass 2: single walk in graph order, emitting every candidate as it's encountered, so
    # block milestones interleave correctly with the LayerNorm/Softmax/InstanceNorm ones.
    results: list[dict] = []
    seen: set[str] = set()
    for node in model.graph.node:
        if node.output and node.name in last_node_names:
            _emit(results, seen, node.output[0], "block", value_info_by_name)
        if node.op_type == "LayerNormalization" and node.output:
            _emit(results, seen, node.output[0], "layernorm", value_info_by_name)
        elif node.op_type == "Softmax" and node.output:
            _emit(results, seen, node.output[0], "softmax", value_info_by_name)
        elif node.op_type == "InstanceNormalization" and node.output and node.name.startswith(encoder_instancenorm_prefixes):
            _emit(results, seen, node.output[0], "instancenorm", value_info_by_name)
    return results


if __name__ == "__main__":
    import json
    import sys

    print(json.dumps(milestone_names(sys.argv[1]), indent=2))
