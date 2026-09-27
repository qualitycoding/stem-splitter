"""SP-6c: per-stem comparison of two raw float32 (1,4,2,343980) outputs. Usage: sp6-compare.py a.f32 b.f32"""
import sys, json
import numpy as np
a = np.fromfile(sys.argv[1], np.float32).reshape(4, 2, -1).astype(np.float64)
b = np.fromfile(sys.argv[2], np.float32).reshape(4, 2, -1).astype(np.float64)
names = ["drums", "bass", "other", "vocals"]
print(json.dumps({n: {"rms_ref": float(np.sqrt((a[i] ** 2).mean())), "rel_l2": float(np.linalg.norm(a[i] - b[i]) / max(np.linalg.norm(a[i]), 1e-30)),
   "max_abs": float(np.abs(a[i] - b[i]).max())} for i, n in enumerate(names)}, indent=1))
