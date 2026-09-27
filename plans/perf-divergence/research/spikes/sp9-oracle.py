"""SP-9: is onnx.reference.ReferenceEvaluator usable as a float64 oracle for single ops (InstanceNormalization, Conv, LayerNormalization, Erf, Softmax)?
Compares float64 ReferenceEvaluator output against native ORT float32 on random data; reports dtype, time, relL2."""
import time, json
import numpy as np, onnx, onnxruntime as ort
from onnx import helper, TensorProto as TP
from onnx.reference import ReferenceEvaluator

rng = np.random.default_rng(1)
def model(node, ins, outs, dtype):
    g = helper.make_graph([node], "g", [helper.make_tensor_value_info(n, dtype, None) for n in ins], [helper.make_tensor_value_info(o, dtype, None) for o in outs])
    m = helper.make_model(g, opset_imports=[helper.make_opsetid("", 17)]); m.ir_version = 9; return m
cases = {
  "InstanceNormalization": (helper.make_node("InstanceNormalization", ["x", "s", "b"], ["y"], epsilon=1e-5), {"x": rng.standard_normal((1, 6, 85995)), "s": rng.standard_normal(6), "b": rng.standard_normal(6)}),
  "Conv": (helper.make_node("Conv", ["x", "w", "b"], ["y"], strides=[4], kernel_shape=[8], pads=[2, 2]), {"x": rng.standard_normal((1, 2, 40000)), "w": rng.standard_normal((48, 2, 8)), "b": rng.standard_normal(48)}),
  "LayerNormalization": (helper.make_node("LayerNormalization", ["x", "s", "b"], ["y"], axis=-1, epsilon=1e-5), {"x": rng.standard_normal((1, 512, 384)), "s": rng.standard_normal(384), "b": rng.standard_normal(384)}),
  "Erf": (helper.make_node("Erf", ["x"], ["y"]), {"x": rng.standard_normal((1, 4, 200000))}),
  "Softmax": (helper.make_node("Softmax", ["x"], ["y"], axis=-1), {"x": rng.standard_normal((1, 8, 256, 256)) * 5}),
}
out = {}
for name, (node, data) in cases.items():
    ins = list(data)
    m64 = model(node, ins, ["y"], TP.DOUBLE); m32 = model(node, ins, ["y"], TP.FLOAT)
    t = time.time(); ref = ReferenceEvaluator(m64).run(None, {k: v.astype(np.float64) for k, v in data.items()})[0]; t_ref = time.time() - t
    so = ort.SessionOptions(); so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    y32 = ort.InferenceSession(m32.SerializeToString(), so, providers=["CPUExecutionProvider"]).run(None, {k: v.astype(np.float32) for k, v in data.items()})[0]
    out[name] = {"ref_dtype": str(ref.dtype), "ref_s": round(t_ref, 2), "ort32_vs_ref64_relL2": float(np.linalg.norm(y32.astype(np.float64) - ref) / np.linalg.norm(ref))}
print(json.dumps(out, indent=1))
