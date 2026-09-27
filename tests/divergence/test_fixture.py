"""FROZEN. T-201 (whole file: fixture integrity - a DATA GUARD that is green from the start by design; it cannot fail against a stub). Enforces PD-SC-3 (the investigation runs on the ORIGINAL diverging input, not a lookalike), claim C-102 (SP-6)."""
import hashlib
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
WAV = ROOT / "tests" / "fixtures" / "diagnostic" / "golden-tones-mono-20s.wav"
SHA256 = "9d60e12db5fd40ac8c71356e05dbed8c6e387c7330c668f4403a134e57260376"


def test_file_is_the_recovered_original():
    assert WAV.stat().st_size == 3_528_078
    assert hashlib.sha256(WAV.read_bytes()).hexdigest() == SHA256


def test_format_and_exact_mono():
    info = sf.info(str(WAV))
    assert (info.samplerate, info.frames, info.channels, info.subtype) == (44_100, 882_000, 2, "PCM_16")
    x, _ = sf.read(str(WAV), dtype="float32")
    assert np.array_equal(x[:, 0], x[:, 1])  # exactly mono: the property SP-3 flagged
    assert 0.069 < float(np.abs(x).max()) < 0.070


def test_three_tone_chord_at_330_440_550_hz():
    x, sr = sf.read(str(WAV), dtype="float64")
    spec = np.abs(np.fft.rfft(x[:, 0]))
    freqs = np.fft.rfftfreq(len(x), 1 / sr)
    top3 = sorted(float(freqs[i]) for i in np.argsort(spec)[-3:])
    for got, want in zip(top3, (330.0, 440.0, 550.0)):
        assert abs(got - want) <= 0.1  # bin spacing is 0.05 Hz


def test_readme_documents_recovery_command():
    text = (ROOT / "tests" / "fixtures" / "diagnostic" / "README.md").read_text(encoding="utf8")
    assert "git show 729c249:tests/fixtures/golden-20s.wav" in text and SHA256 in text
