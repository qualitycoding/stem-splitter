#!/usr/bin/env python3
"""
Generates a synthetic input WAV of a given duration for perf measurement
(plans/perf-divergence S-103). Same signal recipe as
tests/fixtures/generate-golden-fixture.py (five vibrato harmonic voices
panned differently, plus decaying noise bursts every 250 ms), parameterised
by duration instead of fixed at 20 s, so different perf configs measure on
comparable, non-degenerate content (see plans/perf-divergence/plan/DECISIONS.md
D-111 and A-107 "content-dependence check").

    python3 scripts/perf/make-input.py <seconds> <out.wav>

Deterministic (fixed seed 7). Prints the output file's sha256.
"""
import hashlib
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 44_100


def main() -> None:
    if len(sys.argv) != 3:
        print("usage: make-input.py <seconds> <out.wav>", file=sys.stderr)
        raise SystemExit(2)
    seconds = float(sys.argv[1])
    out = Path(sys.argv[2])
    out.parent.mkdir(parents=True, exist_ok=True)

    n = int(seconds * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(7)

    def voice(f0: float, vib: float, amp: float) -> np.ndarray:
        phase = 2 * np.pi * np.cumsum(f0 * (1 + 0.01 * np.sin(2 * np.pi * vib * t))) / SR
        sig = sum(np.sin(k * phase) / k for k in range(1, 12))
        env = 0.5 * (1 + np.sin(2 * np.pi * rng.uniform(0.2, 0.6) * t + rng.uniform(0, 6)))
        return amp * sig * env

    left = np.zeros(n)
    right = np.zeros(n)
    for f0, vib, pan, amp in [
        (110, 5.0, 0.2, 0.08),
        (220, 4.5, 0.7, 0.05),
        (392, 6.0, 0.5, 0.06),
        (880, 5.5, 0.3, 0.03),
        (65, 0.3, 0.5, 0.10),
    ]:
        s = voice(f0, vib, amp)
        left += s * (1 - pan)
        right += s * pan

    for k in range(int(seconds * 4)):
        start = int(k * 0.25 * SR)
        length = int(0.06 * SR)
        if start >= n:
            break
        length = min(length, n - start)
        burst = rng.standard_normal(length) * np.exp(-np.arange(length) / (0.012 * SR)) * 0.15
        left[start : start + length] += burst * rng.uniform(0.5, 1)
        right[start : start + length] += burst * rng.uniform(0.5, 1)

    mix = np.stack([left, right], axis=1)
    mix = (mix / np.abs(mix).max() * 0.5).astype("float32")
    sf.write(out, mix, SR, subtype="PCM_16")

    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    print(digest)


if __name__ == "__main__":
    main()
