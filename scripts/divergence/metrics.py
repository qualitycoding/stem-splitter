"""Pure metrics + decision rules for the WASM-vs-native divergence investigation (plans/perf-divergence D-105, D-106)."""
from __future__ import annotations

import math
from typing import Optional, Sequence

import numpy as np

STEM_NAMES = ("drums", "bass", "other", "vocals")  # row order of the model's `stems` output (src/dsp/stems.ts)
SEGMENT_SAMPLES = 343_980  # must equal src/dsp/chunk.ts SEGMENT_SAMPLES
STRIDE_SAMPLES = 257_985  # SEGMENT - floor(SEGMENT * OVERLAP_FRACTION), OVERLAP_FRACTION = 0.25
REPRODUCED_MIN_VOCALS_REL_L2 = 0.5
JUDGE_FLOOR = 2**-20
JUDGE_RATIO = 10.0


def n_chunks(total_samples: int) -> int:
    """max(1, ceil(total / STRIDE)) - identical to planChunks() in src/dsp/chunk.ts."""
    if not isinstance(total_samples, (int, np.integer)) or total_samples <= 0:
        raise ValueError(f"n_chunks: total_samples must be a positive integer, got {total_samples}")
    return max(1, math.ceil(total_samples / STRIDE_SAMPLES))


def chunk_window(signal: np.ndarray, k: int) -> np.ndarray:
    """1-based chunk k of a (2, n) signal as float32 (2, SEGMENT_SAMPLES), zero-padded at the end. ValueError on bad k or shape."""
    if signal.ndim != 2 or signal.shape[0] != 2:
        raise ValueError(f"chunk_window: signal must have shape (2, n), got {signal.shape}")
    total = signal.shape[1]
    last_chunk = n_chunks(total)
    if not isinstance(k, (int, np.integer)) or k < 1 or k > last_chunk:
        raise ValueError(f"chunk_window: k must be in [1, {last_chunk}], got {k}")
    start = (k - 1) * STRIDE_SAMPLES
    end = min(start + SEGMENT_SAMPLES, total)
    out = np.zeros((2, SEGMENT_SAMPLES), dtype=np.float32)
    out[:, : end - start] = signal[:, start:end]
    return out


def compare_arrays(ref: np.ndarray, test: np.ndarray) -> dict:
    """{rel_l2, max_abs, rms_ref, rms_test}, computed in float64. rel_l2 = ||ref-test|| / ||ref||; inf if ||ref||==0 and they differ, 0.0 if equal.
    ValueError on shape mismatch or non-finite values in either input."""
    ref = np.asarray(ref)
    test = np.asarray(test)
    if ref.shape != test.shape:
        raise ValueError(f"compare_arrays: shape mismatch {ref.shape} vs {test.shape}")
    ref64 = ref.astype(np.float64)
    test64 = test.astype(np.float64)
    if not np.all(np.isfinite(ref64)) or not np.all(np.isfinite(test64)):
        raise ValueError("compare_arrays: inputs must be finite")
    diff = test64 - ref64
    diff_norm = math.sqrt(float(np.sum(diff * diff)))
    ref_norm = math.sqrt(float(np.sum(ref64 * ref64)))
    if ref_norm == 0.0:
        rel_l2 = 0.0 if diff_norm == 0.0 else math.inf
    else:
        rel_l2 = diff_norm / ref_norm
    max_abs = float(np.max(np.abs(diff))) if diff.size else 0.0
    rms_ref = math.sqrt(float(np.mean(ref64 * ref64))) if ref64.size else 0.0
    rms_test = math.sqrt(float(np.mean(test64 * test64))) if test64.size else 0.0
    return {"rel_l2": rel_l2, "max_abs": max_abs, "rms_ref": rms_ref, "rms_test": rms_test}


def compare_stems(ref: np.ndarray, test: np.ndarray) -> dict:
    """Accepts (4, 2, N) or (1, 4, 2, N); returns {stem_name: compare_arrays(...)} for STEM_NAMES."""

    def normalize(x: np.ndarray) -> np.ndarray:
        x = np.asarray(x)
        if x.ndim == 4:
            if x.shape[0] != 1:
                raise ValueError(f"compare_stems: expected batch size 1, got {x.shape[0]}")
            x = x[0]
        if x.ndim != 3 or x.shape[0] != len(STEM_NAMES):
            raise ValueError(
                f"compare_stems: expected shape ({len(STEM_NAMES)}, 2, N) or (1, {len(STEM_NAMES)}, 2, N), got {x.shape}"
            )
        return x

    ref = normalize(ref)
    test = normalize(test)
    if ref.shape != test.shape:
        raise ValueError(f"compare_stems: shape mismatch {ref.shape} vs {test.shape}")
    return {name: compare_arrays(ref[i], test[i]) for i, name in enumerate(STEM_NAMES)}


def is_reproduced(per_stem: dict) -> bool:
    """D0 criterion: vocals rel_l2 >= REPRODUCED_MIN_VOCALS_REL_L2."""
    return per_stem["vocals"]["rel_l2"] >= REPRODUCED_MIN_VOCALS_REL_L2


def first_divergence(profile: Sequence[tuple[str, float]], tau: float) -> Optional[int]:
    """Index of the first (name, rel_l2) entry with rel_l2 > tau (strict); None if none. ValueError on NaN."""
    for i, (name, value) in enumerate(profile):
        if math.isnan(value):
            raise ValueError(f"first_divergence: NaN at index {i} ({name!r})")
    for i, (_name, value) in enumerate(profile):
        if value > tau:
            return i
    return None


def judge_op(err_native: float, err_wasm: float, floor: float = JUDGE_FLOOR, ratio: float = JUDGE_RATIO) -> str:
    """Compare each runtime's error against a float64 oracle for ONE op on IDENTICAL inputs.
    Returns 'wasm_inaccurate' | 'native_inaccurate' | 'both_inaccurate' | 'agree'."""
    for name, value in (("err_native", err_native), ("err_wasm", err_wasm)):
        if math.isnan(value) or value < 0:
            raise ValueError(f"judge_op: {name} must be a non-negative number, got {value}")
    if max(err_native, err_wasm) <= floor:
        return "agree"
    if err_wasm > err_native:
        larger, smaller, label = err_wasm, err_native, "wasm_inaccurate"
    elif err_native > err_wasm:
        larger, smaller, label = err_native, err_wasm, "native_inaccurate"
    else:
        return "both_inaccurate"
    if smaller == 0 or (larger / smaller) > ratio:
        return label
    return "both_inaccurate"


def classify_outcome(reproduced: bool, op_result: Optional[str], budget_exhausted: bool) -> str:
    """Divergence outcome per plans/perf-divergence D-106."""
    if not reproduced:
        return "NOT_REPRODUCED"
    outcome_for_op = {
        "agree": "AMPLIFICATION",
        "wasm_inaccurate": "WASM_OP_DEFECT",
        "native_inaccurate": "NATIVE_OP_DEFECT",
        "both_inaccurate": "BOTH_OP_INACCURATE",
    }
    if op_result is not None:
        if op_result not in outcome_for_op:
            raise ValueError(f"classify_outcome: unknown op_result {op_result!r}")
        return outcome_for_op[op_result]
    if budget_exhausted:
        return "UNRESOLVED"
    raise ValueError("classify_outcome: op_result is None and the budget is not exhausted; the caller must continue the ladder")
