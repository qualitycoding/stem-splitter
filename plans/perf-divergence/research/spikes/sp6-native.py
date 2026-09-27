"""SP-6a: regenerate a mono three-tone-chord chunk (chunk 3 of a 20 s clip) and run it through
native ORT CPU EP with the D-12 session options. Writes input/output as raw float32.
Usage: python sp6-native.py <model.onnx> <outdir> [chunk_index(1-based, default 3)] [input.wav]
If input.wav is given it is used instead of the regenerated chord (SP-6 finding: the ORIGINAL fixture is recoverable
from git: `git show 729c249:tests/fixtures/golden-20s.wav`)
NOTE: the original SP-3 fixture is not in the repo; this is a REGENERATION from its description
('three pure chord tones, exactly mono'). Exact frequencies/amplitudes of the original are unknown."""
import sys, time, json
from pathlib import Path
import numpy as np
import onnxruntime as ort

model, out = sys.argv[1], Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
k = int(sys.argv[3]) if len(sys.argv) > 3 else 3
SR, SEG, STRIDE = 44100, 343980, 257985
if len(sys.argv) > 4:
    import soundfile as sf
    x, sr = sf.read(sys.argv[4], dtype="float32"); assert sr == SR
    left, right = x[:, 0], x[:, 1]
else:
    t = np.arange(20 * SR) / SR
    left = right = sum(0.1 * np.sin(2 * np.pi * f * t) for f in (261.63, 329.63, 392.00)).astype(np.float32)
start = (k - 1) * STRIDE
chunk = np.zeros((1, 2, SEG), np.float32)
n = len(left[start:start + SEG]); chunk[0, 0, :n] = left[start:start + SEG]; chunk[0, 1, :n] = right[start:start + SEG]
so = ort.SessionOptions()
so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
so.enable_cpu_mem_arena = False; so.enable_mem_pattern = False
t0 = time.time(); s = ort.InferenceSession(model, so, providers=["CPUExecutionProvider"]); t1 = time.time()
y = s.run(None, {"mix": chunk})[0]; t2 = time.time()
chunk.tofile(out / f"in_chunk{k}.f32"); y.astype(np.float32).tofile(out / f"native_chunk{k}.f32")
print(json.dumps({"ort": ort.__version__, "chunk": k, "out_shape": list(y.shape), "create_s": round(t1 - t0, 1), "run_s": round(t2 - t1, 1),
  "stem_rms": [float(np.sqrt((y[0, i] ** 2).mean())) for i in range(4)]}))
