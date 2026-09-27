"""SP-5a: inspect the pinned htdemucs fp16weights ONNX (IO, opset, op histogram)."""
import collections, hashlib, json, sys
import onnx
path = sys.argv[1]
m = onnx.load(path)
g = m.graph
ops = collections.Counter(n.op_type for n in g.node)
def shape(v):
    return [d.dim_value or d.dim_param for d in v.type.tensor_type.shape.dim]
print(json.dumps({
    "sha256": hashlib.sha256(open(path, "rb").read()).hexdigest(),
    "opset": [(o.domain, o.version) for o in m.opset_import],
    "inputs": [(i.name, shape(i)) for i in g.input if i.name not in {x.name for x in g.initializer}],
    "outputs": [(o.name, shape(o)) for o in g.output],
    "n_nodes": len(g.node), "n_initializers": len(g.initializer),
    "ops": dict(ops.most_common()),
}, indent=1))
