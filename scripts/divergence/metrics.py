"""Pure metrics + decision rules for the WASM-vs-native divergence investigation (plans/perf-divergence D-105, D-106).

STUB: every function raises NotImplementedError until step S-107. Constants are deliberately wrong placeholders
so tests/divergence/test_metrics.py fails until they are set.
"""
from __future__ import annotations

from typing import Optional, Sequence

import numpy as np

STEM_NAMES = ("drums", "bass", "other", "vocals")  # row order of the model's `stems` output (src/dsp/stems.ts)
SEGMENT_SAMPLES = 0  # STUB (must equal src/dsp/chunk.ts SEGMENT_SAMPLES)
STRIDE_SAMPLES = 0  # STUB (SEGMENT - floor(SEGMENT * OVERLAP_FRACTION))
REPRODUCED_MIN_VOCALS_REL_L2 = 0.0  # STUB (frozen value: 0.5)
JUDGE_FLOOR = 0.0  # STUB (frozen value: 2**-20)
JUDGE_RATIO = 0.0  # STUB (frozen value: 10.0)


def n_chunks(total_samples: int) -> int:
    """max(1, ceil(total / STRIDE)) - identical to planChunks() in src/dsp/chunk.ts."""
    raise NotImplementedError("n_chunks (S-107)")


def chunk_window(signal: np.ndarray, k: int) -> np.ndarray:
    """1-based chunk k of a (2, n) signal as float32 (2, SEGMENT_SAMPLES), zero-padded at the end. ValueError on bad k or shape."""
    raise NotImplementedError("chunk_window (S-107)")


def compare_arrays(ref: np.ndarray, test: np.ndarray) -> dict:
    """{rel_l2, max_abs, rms_ref, rms_test}, computed in float64. rel_l2 = ||ref-test|| / ||ref||; inf if ||ref||==0 and they differ, 0.0 if equal.
    ValueError on shape mismatch or non-finite values in either input."""
    raise NotImplementedError("compare_arrays (S-107)")


def compare_stems(ref: np.ndarray, test: np.ndarray) -> dict:
    """Accepts (4, 2, N) or (1, 4, 2, N); returns {stem_name: compare_arrays(...)} for STEM_NAMES."""
    raise NotImplementedError("compare_stems (S-107)")


def is_reproduced(per_stem: dict) -> bool:
    """D0 criterion: vocals rel_l2 >= REPRODUCED_MIN_VOCALS_REL_L2."""
    raise NotImplementedError("is_reproduced (S-107)")


def first_divergence(profile: Sequence[tuple[str, float]], tau: float) -> Optional[int]:
    """Index of the first (name, rel_l2) entry with rel_l2 > tau (strict); None if none. ValueError on NaN."""
    raise NotImplementedError("first_divergence (S-107)")


def judge_op(err_native: float, err_wasm: float, floor: float = JUDGE_FLOOR, ratio: float = JUDGE_RATIO) -> str:
    """Compare each runtime's error against a float64 oracle for ONE op on IDENTICAL inputs.
    Returns 'wasm_inaccurate' | 'native_inaccurate' | 'both_inaccurate' | 'agree'."""
    raise NotImplementedError("judge_op (S-107)")


def classify_outcome(reproduced: bool, op_result: Optional[str], budget_exhausted: bool) -> str:
    """Divergence outcome per plans/perf-divergence D-106."""
    raise NotImplementedError("classify_outcome (S-107)")
