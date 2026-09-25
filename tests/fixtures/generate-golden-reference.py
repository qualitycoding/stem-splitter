#!/usr/bin/env python3
"""
Generates the reference output for the golden-parity test (T-006,
tests/browser/golden-parity.test.ts).

This is NOT run automatically — it needs network access to Hugging Face to
download the real ~166 MB htdemucs model, which this sandbox/CI environment
does not always have on every push. A maintainer runs this ONCE (or
whenever the pinned model changes, plan/DECISIONS.md D-04/D-05) and commits
the resulting tests/fixtures/golden-reference.json.

    pip install demucs-onnx==0.3.4 soundfile numpy
    python3 tests/fixtures/generate-golden-reference.py

Uses the SAME fixture (golden-20s.wav) and the SAME model variant
(htdemucs, fp16weights) the deployed app uses, on the CPU execution
provider, so tests/browser/golden-parity.test.ts can compare our ONNX
Runtime Web (WASM) output against it within the tolerance demucs-onnx's own
docs give for fp16 vs fp32 (~6e-5) plus cross-runtime slack — see
plan/PLAN.md T-006 (max abs diff <= 1e-3).
"""
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
FIXTURE = HERE / "golden-20s.wav"
OUT = HERE / "golden-reference.json"


def main() -> None:
    try:
        from demucs_onnx.inference import separate
    except ImportError:
        sys.exit("pip install demucs-onnx==0.3.4 soundfile numpy first (see this file's docstring)")

    if not FIXTURE.exists():
        sys.exit(f"missing fixture: {FIXTURE} (regenerate with tests/fixtures/generate-golden-fixture.py)")

    print(f"Running htdemucs (fp16weights, CPU EP) on {FIXTURE.name} ...")
    stems = separate(
        str(FIXTURE),
        model="htdemucs",
        providers="cpu",
        precision="fp16weights",
        verbose=True,
        progress=False,
    )

    # Store a manageable summary rather than every sample: per-stem length,
    # a handful of exact sample values at fixed indices (spread across the
    # track, away from sample 0 — see tests/unit/ola.test.ts for why sample
    # 0 is special), and per-stem RMS as a coarser cross-check.
    sample_indices = [1000, 50_000, 200_000, 400_000, 600_000, 800_000, 860_000]
    reference = {"fixture_sha256": hashlib.sha256(FIXTURE.read_bytes()).hexdigest(), "stems": {}}
    for name, audio in stems.items():
        left, right = audio[0], audio[1]
        valid_indices = [i for i in sample_indices if i < left.shape[0]]
        reference["stems"][name] = {
            "length": int(left.shape[0]),
            "rms_left": float((left**2).mean() ** 0.5),
            "rms_right": float((right**2).mean() ** 0.5),
            "samples": {
                str(i): {"left": float(left[i]), "right": float(right[i])} for i in valid_indices
            },
        }

    OUT.write_text(json.dumps(reference, indent=2))
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
