"""FROZEN. T-205 (whole file). Enforces PD-SC-3: the native-vs-WASM harness runs end to end and emits a provenance-stamped result.
Uses tests/fixtures/tiny-stem-model.onnx (Unsqueeze -> Tile: pure data movement), so both runtimes MUST agree EXACTLY
(rel_l2 == 0.0, max_abs == 0.0): any non-zero value here is a harness bug, not a numerical finding. Needs `npm ci` (ORT Web) and
the pinned Python requirements (scripts/divergence/requirements.txt). Decisions D-107, D-108; claims C-102, C-105."""
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
HARNESS = ROOT / "scripts" / "divergence" / "harness.py"
TINY = ROOT / "tests" / "fixtures" / "tiny-stem-model.onnx"
WAV = ROOT / "tests" / "fixtures" / "diagnostic" / "golden-tones-mono-20s.wav"
D12 = {"graph_optimization_level": "disabled", "enable_cpu_mem_arena": False, "enable_mem_pattern": False}


def run(out: Path, *extra: str, model: Path = TINY, chunk: str = "3", runtimes: str = "native,wasm-node"):
    return subprocess.run(
        [sys.executable, str(HARNESS), "run", "--model", str(model), "--wav", str(WAV), "--chunk", chunk,
         "--runtimes", runtimes, "--out", str(out), *extra],
        cwd=ROOT, capture_output=True, text=True, timeout=300,
    )


@pytest.fixture(scope="module")
def result(tmp_path_factory):
    out = tmp_path_factory.mktemp("harness")
    names = out / "names.txt"
    names.write_text("unsq\n", encoding="utf8")
    p = run(out, "--expose-file", str(names))
    assert p.returncode == 0, p.stderr[-2000:]
    return json.loads((out / "result.json").read_text(encoding="utf8")), out


def test_schema_and_input_identity(result):
    r, _ = result
    assert r["schema"] == 1
    assert r["model"]["sha256"] == "d021adb03b18a293109cff8a366fe381a5a1c02cc2b88c188f3f3de89f2b1e65"
    assert r["input"]["sha256"] == "9d60e12db5fd40ac8c71356e05dbed8c6e387c7330c668f4403a134e57260376"
    assert (r["input"]["chunk"], r["input"]["chunk_start_sample"], r["input"]["samples"]) == (3, 515_970, 343_980)
    assert r["reference"] == "native"
    assert set(r["runtimes"]) == {"native", "wasm-node"}


def test_both_runtimes_use_the_d12_session_options_and_record_versions(result):
    r, _ = result
    for name in ("native", "wasm-node"):
        rt = r["runtimes"][name]
        assert rt["session_options"] == D12
        assert re.fullmatch(r"1\.30\.0", rt["ort_version"])
        assert rt["create_s"] >= 0 and rt["run_s"] >= 0
    assert r["runtimes"]["wasm-node"]["threads"] == 1


def test_pure_data_movement_model_agrees_exactly(result):
    r, _ = result
    assert list(r["per_stem"]) == ["drums", "bass", "other", "vocals"]
    for name, m in r["per_stem"].items():
        assert m["rel_l2"] == 0.0 and m["max_abs"] == 0.0, name


def test_exposed_intermediate_tensor_is_compared(result):
    r, out = result
    (e,) = r["exposed"]
    assert e["tensor"] == "unsq" and e["n"] == 2 * 343_980
    assert e["rel_l2"] == 0.0 and e["max_abs"] == 0.0
    assert (out / "native_chunk3.f32").exists() and (out / "wasm-node_chunk3.f32").exists()


def test_provenance_is_complete(result):
    p = result[0]["provenance"]
    assert re.fullmatch(r"[0-9a-f]{40}", p["git_commit"])
    assert re.fullmatch(r"[0-9a-f]{64}", p["requirements_sha256"])
    assert p["python"].startswith(f"{sys.version_info.major}.{sys.version_info.minor}")
    assert re.fullmatch(r"v\d+\.\d+\.\d+", p["node"])
    assert p["ort_web_version"] == "1.30.0"
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", p["utc"])
    assert p["platform"]


def test_native_only_run_is_allowed_and_has_no_comparison(tmp_path):
    p = run(tmp_path, runtimes="native")
    assert p.returncode == 0, p.stderr[-2000:]
    r = json.loads((tmp_path / "result.json").read_text(encoding="utf8"))
    assert set(r["runtimes"]) == {"native"} and r["per_stem"] is None


def test_missing_model_fails_loudly(tmp_path):
    p = run(tmp_path, model=tmp_path / "nope.onnx")
    assert p.returncode != 0 and "nope.onnx" in p.stderr
    assert not (tmp_path / "result.json").exists()


@pytest.mark.parametrize("chunk", ["0", "5", "x"])
def test_bad_chunk_fails_loudly(tmp_path, chunk):
    p = run(tmp_path, chunk=chunk)
    assert p.returncode != 0 and "chunk" in p.stderr.lower()
