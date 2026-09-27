"""FROZEN. Test IDs: T-202 = geometry (constants, n_chunks, chunk_window); T-203 = compare_arrays / compare_stems;
T-204 = decision rules (frozen constants, is_reproduced, first_divergence, judge_op, classify_outcome). Enforces PD-SC-3 (divergence outcome is decided by a written rule, not by judgement after the fact),
decisions D-105/D-106, claims C-103/C-104. Every numeric tolerance below is either exact (integer/float64 arithmetic on
exactly representable values) or stated inline."""
import math
import re
from pathlib import Path

import numpy as np
import pytest

import metrics

ROOT = Path(__file__).resolve().parents[2]


# ---- geometry -------------------------------------------------------------------------------------------------------
def test_constants_match_src_dsp_chunk_ts():
    """Cross-language drift guard: metrics.py must derive from the SAME numbers as src/dsp/chunk.ts."""
    ts = (ROOT / "src" / "dsp" / "chunk.ts").read_text(encoding="utf8")
    seg = int(re.search(r"SEGMENT_SAMPLES\s*=\s*([\d_]+)", ts).group(1).replace("_", ""))
    frac = float(re.search(r"OVERLAP_FRACTION\s*=\s*([\d.]+)", ts).group(1))
    assert metrics.SEGMENT_SAMPLES == seg == 343_980
    assert metrics.STRIDE_SAMPLES == seg - math.floor(seg * frac) == 257_985


@pytest.mark.parametrize(
    "total,expected",
    [(1, 1), (257_985, 1), (257_986, 2), (343_980, 2), (882_000, 4), (10_584_000, 42)],
)
def test_n_chunks(total, expected):
    assert metrics.n_chunks(total) == expected


def test_chunk_window_positions_and_padding():
    sig = np.stack([np.arange(882_000, dtype=np.float32), -np.arange(882_000, dtype=np.float32)])
    c1, c3, c4 = (metrics.chunk_window(sig, k) for k in (1, 3, 4))
    for c in (c1, c3, c4):
        assert c.shape == (2, 343_980) and c.dtype == np.float32
    assert c1[0, 0] == 0 and c1[0, -1] == 343_979
    assert c3[0, 0] == 515_970 and c3[1, 0] == -515_970  # chunk 3 starts at 2 * 257_985
    assert c3[0, -1] == 515_970 + 343_979
    assert c4[0, 0] == 773_955
    valid = 882_000 - 773_955  # 108_045
    assert c4[0, valid - 1] == 881_999 and not c4[:, valid:].any()  # zero padded


def test_chunk_window_rejects_bad_arguments():
    sig = np.zeros((2, 882_000), np.float32)
    for k in (0, -1, 5):
        with pytest.raises(ValueError):
            metrics.chunk_window(sig, k)
    with pytest.raises(ValueError):
        metrics.chunk_window(np.zeros((882_000,), np.float32), 1)
    with pytest.raises(ValueError):
        metrics.chunk_window(np.zeros((3, 100), np.float32), 1)


# ---- comparison metrics ---------------------------------------------------------------------------------------------
def test_compare_arrays_known_values():
    ref = np.array([3.0, 4.0], np.float32)
    test = np.array([3.0, 4.5], np.float32)
    r = metrics.compare_arrays(ref, test)
    assert r["rel_l2"] == pytest.approx(0.1, rel=1e-12)  # 0.5 / 5
    assert r["max_abs"] == 0.5
    assert r["rms_ref"] == pytest.approx(math.sqrt(12.5), rel=1e-12)
    assert r["rms_test"] == pytest.approx(math.sqrt((9 + 20.25) / 2), rel=1e-12)


def test_compare_arrays_identical_and_zero_reference():
    a = np.arange(10, dtype=np.float32)
    assert metrics.compare_arrays(a, a.copy())["rel_l2"] == 0.0
    z = np.zeros(4, np.float32)
    assert metrics.compare_arrays(z, z.copy())["rel_l2"] == 0.0
    assert metrics.compare_arrays(z, np.ones(4, np.float32))["rel_l2"] == math.inf


def test_compare_arrays_rejects_shape_mismatch_and_non_finite():
    with pytest.raises(ValueError):
        metrics.compare_arrays(np.zeros(3, np.float32), np.zeros(4, np.float32))
    for bad in (np.nan, np.inf):
        with pytest.raises(ValueError):
            metrics.compare_arrays(np.zeros(3, np.float32), np.array([0, bad, 0], np.float32))
        with pytest.raises(ValueError):
            metrics.compare_arrays(np.array([0, bad, 0], np.float32), np.zeros(3, np.float32))


@pytest.mark.parametrize("shape", [(4, 2, 1000), (1, 4, 2, 1000)])
def test_compare_stems_accepts_both_layouts_and_names_stems(shape):
    rng = np.random.default_rng(0)
    ref = rng.standard_normal(shape).astype(np.float32)
    scale = np.array([1.0, 1.1, 1.2, 1.3], np.float32).reshape((4, 1, 1) if len(shape) == 3 else (1, 4, 1, 1))
    out = metrics.compare_stems(ref, ref * scale)
    assert tuple(out) == ("drums", "bass", "other", "vocals")
    for name, want in zip(out, (0.0, 0.1, 0.2, 0.3)):
        assert out[name]["rel_l2"] == pytest.approx(want, abs=1e-6)  # float32 multiply: ~6e-8 relative; 1e-6 is 16x margin


def test_compare_stems_rejects_wrong_stem_count():
    with pytest.raises(ValueError):
        metrics.compare_stems(np.zeros((3, 2, 10), np.float32), np.zeros((3, 2, 10), np.float32))


# ---- decision rules (frozen numbers) --------------------------------------------------------------------------------
def test_frozen_decision_constants():
    assert metrics.REPRODUCED_MIN_VOCALS_REL_L2 == 0.5
    assert metrics.JUDGE_FLOOR == 2**-20
    assert metrics.JUDGE_RATIO == 10.0


def test_is_reproduced_uses_vocals_only():
    mk = lambda v: {"drums": {"rel_l2": 9.0}, "bass": {"rel_l2": 9.0}, "other": {"rel_l2": 9.0}, "vocals": {"rel_l2": v}}
    assert metrics.is_reproduced(mk(1.155)) is True  # Node WASM vs native on the recovered fixture, SP-6
    assert metrics.is_reproduced(mk(0.5)) is True  # boundary is >=
    assert metrics.is_reproduced(mk(0.4999)) is False
    assert metrics.is_reproduced(mk(0.0023)) is False  # regenerated chord, SP-6


def test_first_divergence():
    prof = [("a", 1e-7), ("b", 1e-5), ("c", 1e-3), ("d", 1e-1)]
    assert metrics.first_divergence(prof, 1e-4) == 2
    assert metrics.first_divergence(prof, 1.0) is None
    assert metrics.first_divergence(prof, 1e-3) == 3  # strict >: equality is not divergence
    assert metrics.first_divergence([("a", 2e-3), ("b", 1e-8)], 1e-3) == 0  # non-monotone profile: FIRST exceedance
    assert metrics.first_divergence([], 1e-3) is None
    with pytest.raises(ValueError):
        metrics.first_divergence([("a", math.nan)], 1e-3)


@pytest.mark.parametrize(
    "err_native,err_wasm,expected",
    [
        (0.0, 0.0, "agree"),
        (1e-7, 2e-7, "agree"),  # both under the 2**-20 (~9.5e-7) floor
        (1e-7, 1e-3, "wasm_inaccurate"),
        (1e-3, 1e-7, "native_inaccurate"),
        (1e-3, 2e-3, "both_inaccurate"),  # both over floor, within 10x of each other
        (5e-7, 2e-6, "both_inaccurate"),  # over floor but < 10x apart
        (5e-7, 5.0001e-6, "wasm_inaccurate"),  # just over 10x and over floor
        (2**-21, 10 * 2**-21, "both_inaccurate"),  # exactly 10x (exactly representable): strict >, so not "wasm_inaccurate"
        (2**-21, math.nextafter(10 * 2**-21, 1.0), "wasm_inaccurate"),  # one ulp over 10x
        (2e-8, 9e-7, "agree"),  # 45x apart but both under floor: still agree
    ],
)
def test_judge_op(err_native, err_wasm, expected):
    assert metrics.judge_op(err_native, err_wasm) == expected


def test_judge_op_is_symmetric_under_swapping_runtimes():
    swap = {"wasm_inaccurate": "native_inaccurate", "native_inaccurate": "wasm_inaccurate", "both_inaccurate": "both_inaccurate", "agree": "agree"}
    for a, b in [(1e-7, 1e-3), (1e-3, 2e-3), (5e-7, 2e-6), (0.0, 0.0)]:
        assert metrics.judge_op(b, a) == swap[metrics.judge_op(a, b)]


def test_judge_op_rejects_negative_or_nan():
    for bad in (-1e-9, math.nan):
        with pytest.raises(ValueError):
            metrics.judge_op(bad, 0.0)
        with pytest.raises(ValueError):
            metrics.judge_op(0.0, bad)


@pytest.mark.parametrize(
    "reproduced,op_result,budget,expected",
    [
        (False, None, False, "NOT_REPRODUCED"),
        (False, "agree", True, "NOT_REPRODUCED"),  # reproduction gate dominates everything
        (True, "agree", False, "AMPLIFICATION"),
        (True, "wasm_inaccurate", False, "WASM_OP_DEFECT"),
        (True, "native_inaccurate", False, "NATIVE_OP_DEFECT"),
        (True, "both_inaccurate", False, "BOTH_OP_INACCURATE"),
        (True, None, True, "UNRESOLVED"),
        (True, "agree", True, "AMPLIFICATION"),  # a finished bisection wins over an exhausted budget
    ],
)
def test_classify_outcome(reproduced, op_result, budget, expected):
    assert metrics.classify_outcome(reproduced, op_result, budget) == expected


def test_classify_outcome_refuses_to_guess():
    with pytest.raises(ValueError):  # bisection incomplete AND budget not exhausted: caller must keep going
        metrics.classify_outcome(True, None, False)
    with pytest.raises(ValueError):
        metrics.classify_outcome(True, "bogus", False)
