"""Runs a model on <outdir>/in_chunkK.f32 with native ORT CPU EP (D-12 options); saves output i as <tag>.<i>.f32."""
import sys, json
from pathlib import Path
import numpy as np, onnxruntime as ort
model, out, k, tag = sys.argv[1], Path(sys.argv[2]), sys.argv[3], sys.argv[4]
x = np.fromfile(out / f"in_chunk{k}.f32", np.float32).reshape(1, 2, -1)
so = ort.SessionOptions(); so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
so.enable_cpu_mem_arena = False; so.enable_mem_pattern = False
s = ort.InferenceSession(model, so, providers=["CPUExecutionProvider"])
ys = s.run(None, {"mix": x})
for i, y in enumerate(ys): y.astype(np.float32).tofile(out / f"{tag}.{i}.f32")
print(json.dumps({"names": [o.name for o in s.get_outputs()], "shapes": [list(y.shape) for y in ys]}))
