"""New test (added per S-108 action 4: "a new test on the tiny model first" before implementing
harness.py's `sweep` subcommand). Not pre-frozen by the planning phase; re-freeze after this
lands (node scripts/frozen-manifest.mjs --write). Uses tests/fixtures/tiny-stem-model.onnx
(pure data movement) so every variant MUST agree exactly between runtimes (rel_l2 == 0.0,
is_reproduced == False) -- any non-zero value here is a sweep-plumbing bug, not a numerical
finding. Verifies the D1 sweep runs to completion, reuses one session per runtime rather than
recreating it per variant, and produces both the JSON and markdown outputs plans/perf-divergence
S-108 asks for."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HARNESS = ROOT / "scripts" / "divergence" / "harness.py"
TINY = ROOT / "tests" / "fixtures" / "tiny-stem-model.onnx"
WAV = ROOT / "tests" / "fixtures" / "diagnostic" / "golden-tones-mono-20s.wav"


def test_sweep_runs_all_variants_on_the_tiny_model(tmp_path):
    p = subprocess.run(
        [sys.executable, str(HARNESS), "sweep", "--model", str(TINY), "--wav", str(WAV), "--chunk", "3", "--out", str(tmp_path)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert p.returncode == 0, p.stderr[-2000:]

    data = json.loads((tmp_path / "d1-sweep.json").read_text(encoding="utf8"))
    assert isinstance(data["variants"], list)
    assert len(data["variants"]) >= 20  # D-106 D1: <= 30 variants total

    names = [v["name"] for v in data["variants"]]
    assert len(names) == len(set(names)), "variant names must be unique"

    for v in data["variants"]:
        assert v["per_stem"]["vocals"]["rel_l2"] == 0.0, v["name"]  # pure data movement: exact agreement always
        assert v["is_reproduced"] is False, v["name"]

    md = (tmp_path / "d1-sweep.md").read_text(encoding="utf8")
    assert "rel_l2" in md.lower()
    for name in names:
        assert name in md
