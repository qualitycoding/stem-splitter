"""New test (S-109 action 2: "a unit test on the tiny model added first" before D3 profile
bisection uses milestones.py for real). The tiny model has none of htdemucs's named module
blocks (tencoder/encoder/crosstransformer/tdecoder/decoder) or LayerNorm/Softmax/InstanceNorm
nodes, so milestone_names() on it must return an empty list without erroring -- the plumbing
must degrade gracefully on a model with nothing to find, not crash."""
from pathlib import Path

import milestones

ROOT = Path(__file__).resolve().parents[2]
TINY = ROOT / "tests" / "fixtures" / "tiny-stem-model.onnx"


def test_milestone_names_empty_on_a_model_with_no_named_blocks():
    assert milestones.milestone_names(TINY) == []
