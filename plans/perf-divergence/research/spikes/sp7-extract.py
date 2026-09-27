"""SP-7: mechanism check for node-by-node bisection.
  sp7-extract.py <model.onnx> <outdir> list                      first candidate float tensors (topo order) -> stdout JSON
  sp7-extract.py <model.onnx> <outdir> expose <names.txt>        writes <outdir>/exposed.onnx = the model with each tensor in names.txt appended to graph.output
Tensor names are passed via FILE (not argv): Git-Bash/MSYS rewrites leading '/' in argv (SP-7 finding). onnx.utils.extract_model is NOT usable
here: it needs value_info for every cut tensor and this model has none."""
import sys, json
from pathlib import Path
import onnx
from onnx import TensorProto, helper
model, out, mode = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
out.mkdir(parents=True, exist_ok=True)
m = onnx.load(model)
if mode == "list":
    picks = [(i, n.op_type, n.output[0]) for i, n in enumerate(m.graph.node) if n.op_type in ("InstanceNormalization", "LayerNormalization", "Softmax", "Erf")]
    print(json.dumps(picks[:12]))
else:
    names = [l.strip() for l in Path(sys.argv[4]).read_text().splitlines() if l.strip()]
    for n in names:
        m.graph.output.append(helper.make_tensor_value_info(n, TensorProto.FLOAT, None))
    onnx.save(m, str(out / "exposed.onnx")); print("ok", len(names))
