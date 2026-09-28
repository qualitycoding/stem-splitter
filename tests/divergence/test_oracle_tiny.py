"""New test (S-110 action 1: "add scripts/divergence/oracle.py with a new tiny test first").
Verifies oracle.run_oracle() against hand-computed results for the op types D4's candidates
actually use (Add, Mul, Div, InstanceNormalization), plus has_oracle()'s verified/unsupported
split (SP-9 verified InstanceNormalization/Conv/LayerNormalization/Erf/Softmax; the
elementwise ops D4 also needs -- Add/Mul/Div/Sigmoid/Split -- are trivial enough for the
reference evaluator's generic numpy kernels to be trusted without a dedicated spike)."""
import numpy as np
from onnx import helper

import oracle


def test_add_oracle_matches_expected():
    node = helper.make_node("Add", ["a", "b"], ["y"])
    a = np.array([1.0, 2.0, 3.0], dtype=np.float32)
    b = np.array([0.5, 0.5, 0.5], dtype=np.float32)
    result = oracle.run_oracle(node, {"a": a, "b": b})
    assert result.dtype == np.float64
    np.testing.assert_allclose(result, np.array([1.5, 2.5, 3.5]))


def test_div_oracle_matches_expected():
    node = helper.make_node("Div", ["a", "b"], ["y"])
    a = np.array([1.0, 2.0], dtype=np.float32)
    b = np.array([2.0, 4.0], dtype=np.float32)
    result = oracle.run_oracle(node, {"a": a, "b": b})
    np.testing.assert_allclose(result, np.array([0.5, 0.5]))


def test_instancenorm_oracle_matches_manual_float64_computation():
    rng = np.random.default_rng(0)
    x = rng.standard_normal((1, 2, 100)).astype(np.float32)
    scale = np.ones(2, dtype=np.float32)
    bias = np.zeros(2, dtype=np.float32)
    node = helper.make_node("InstanceNormalization", ["x", "s", "b"], ["y"], epsilon=1e-5)
    result = oracle.run_oracle(node, {"x": x, "s": scale, "b": bias})
    x64 = x.astype(np.float64)
    mean = x64.mean(axis=2, keepdims=True)
    var = x64.var(axis=2, keepdims=True)
    expected = (x64 - mean) / np.sqrt(var + 1e-5)
    np.testing.assert_allclose(result, expected, rtol=1e-8)


def test_has_oracle_true_for_verified_and_supported_ops():
    for op in ("Add", "Mul", "Div", "InstanceNormalization", "Conv", "LayerNormalization", "Erf", "Softmax"):
        assert oracle.has_oracle(op) is True


def test_has_oracle_false_for_unhandled_op():
    assert oracle.has_oracle("NonExistentOpType") is False
