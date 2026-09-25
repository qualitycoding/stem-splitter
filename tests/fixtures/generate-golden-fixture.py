#!/usr/bin/env python3
"""
Generates tests/fixtures/golden-20s.wav, the input for the golden-parity
test (T-006, tests/browser/golden-parity.test.ts).

    pip install numpy soundfile
    python3 tests/fixtures/generate-golden-fixture.py

Deterministic (fixed seed): 20 s, 44.1 kHz, 16-bit stereo. Five vibrato
harmonic voices panned differently, plus decaying noise bursts every 250 ms.
It is deliberately NOT an exactly-mono, exactly-periodic signal: the earlier
fixture (three pure chord tones, L == R) made ONNX Runtime Web's WASM output
diverge from native ONNX Runtime by >100% on one chunk's vocals stem, while
this signal agrees to ~0.1% — see research/spikes/SP-3.md. Changing this
script means regenerating tests/fixtures/golden-reference.json too
(generate-golden-reference.py).
"""
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 44_100
N = 20 * SR
OUT = Path(__file__).parent / "golden-20s.wav"


def main() -> None:
    t = np.arange(N) / SR
    rng = np.random.default_rng(7)

    def voice(f0: float, vib: float, amp: float) -> np.ndarray:
        phase = 2 * np.pi * np.cumsum(f0 * (1 + 0.01 * np.sin(2 * np.pi * vib * t))) / SR
        sig = sum(np.sin(k * phase) / k for k in range(1, 12))
        env = 0.5 * (1 + np.sin(2 * np.pi * rng.uniform(0.2, 0.6) * t + rng.uniform(0, 6)))
        return amp * sig * env

    left = np.zeros(N)
    right = np.zeros(N)
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

    for k in range(20 * 4):
        start = int(k * 0.25 * SR)
        length = int(0.06 * SR)
        burst = rng.standard_normal(length) * np.exp(-np.arange(length) / (0.012 * SR)) * 0.15
        left[start : start + length] += burst * rng.uniform(0.5, 1)
        right[start : start + length] += burst * rng.uniform(0.5, 1)

    mix = np.stack([left, right], axis=1)
    mix = (mix / np.abs(mix).max() * 0.5).astype("float32")
    sf.write(OUT, mix, SR, subtype="PCM_16")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
