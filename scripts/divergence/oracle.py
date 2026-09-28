"""Float64 oracle for single-op isolation (D4, plans/perf-divergence D-106): wraps
onnx.reference.ReferenceEvaluator on a single-node model built from the real graph node,
following the pattern verified in research/spikes/sp9-oracle.py for InstanceNormalization,
Conv, LayerNormalization, Erf and Softmax. Other simple elementwise/structural ops
(Add, Mul, Div, Sigmoid, Split) are trusted without a dedicated spike -- the reference
evaluator's kernels for these are generic numpy one-liners, not the kind of op where a
runtime-specific kernel choice could plausibly diverge from float64 numpy semantics.
"""
from __future__ import annotations

import numpy as np
import onnx
from onnx import TensorProto, helper
from onnx.reference import ReferenceEvaluator

# SP-9-verified (InstanceNormalization, Conv, LayerNormalization, Erf, Softmax) plus the
# simple elementwise/structural ops D4's candidates in this investigation actually use.
SUPPORTED_OP_TYPES = {
    "InstanceNormalization",
    "Conv",
    "LayerNormalization",
    "Erf",
    "Softmax",
    "Add",
    "Mul",
    "Div",
    "Sigmoid",
    "Split",
}


def has_oracle(op_type: str) -> bool:
    return op_type in SUPPORTED_OP_TYPES


def build_single_node_model(node: onnx.NodeProto, dtype: int) -> onnx.ModelProto:
    """A minimal graph containing only `node`, with every input/output declared as `dtype`
    and unknown shape -- concrete arrays are supplied at run() time (SP-9 pattern)."""
    inputs = [helper.make_tensor_value_info(n, dtype, None) for n in node.input if n]
    outputs = [helper.make_tensor_value_info(n, dtype, None) for n in node.output if n]
    graph = helper.make_graph([node], "oracle", inputs, outputs)
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    model.ir_version = 9
    return model


def run_oracle(node: onnx.NodeProto, inputs: dict[str, np.ndarray]) -> np.ndarray:
    """Runs `node` in float64 via ReferenceEvaluator. `inputs` maps input tensor name to an
    array of any float dtype; always cast to float64 before evaluating. Returns the single
    output array, in float64. Caller checks has_oracle(node.op_type) first."""
    model64 = build_single_node_model(node, TensorProto.DOUBLE)
    feed = {name: np.asarray(value, dtype=np.float64) for name, value in inputs.items()}
    return ReferenceEvaluator(model64).run(None, feed)[0]
