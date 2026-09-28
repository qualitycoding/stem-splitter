#!/usr/bin/env python3
"""D3 profile bisection, stage 2 (plans/perf-divergence D-106, S-109): profiles every float
tensor output of the nodes in window W, then picks <= 5 candidates for D4 op-level isolation:
the first node in W whose profile exceeds tau, plus the <= 4 nodes with the largest
consecutive-ratio jump in W.

    python scripts/divergence/d3_candidates.py --names N.json --target-dir-prefix DIR --control-dir-prefix DIR --batches N --out research/divergence
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import metrics


def load_exposed(dir_prefix: Path, batches: int) -> dict[str, dict]:
    exposed: dict[str, dict] = {}
    for i in range(batches):
        result = json.loads((dir_prefix.parent / f"{dir_prefix.name}{i}" / "result.json").read_text(encoding="utf8"))
        for e in result["exposed"]:
            exposed[e["tensor"]] = e
    return exposed


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--names", required=True)
    parser.add_argument("--target-dir-prefix", required=True)
    parser.add_argument("--control-dir-prefix", required=True)
    parser.add_argument("--batches", type=int, required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    names = json.loads(Path(args.names).read_text(encoding="utf8"))
    target_exposed = load_exposed(Path(args.target_dir_prefix), args.batches)
    control_exposed = load_exposed(Path(args.control_dir_prefix), args.batches)

    rows = []
    for name in names:
        t = target_exposed.get(name)
        c = control_exposed.get(name)
        if t is None or c is None:
            rows.append({"name": name, "skipped": True})
            continue
        value = t["rel_l2"] / max(c["rel_l2"], metrics.JUDGE_FLOOR)
        rows.append({"name": name, "rel_l2_target": t["rel_l2"], "rel_l2_control": c["rel_l2"], "profile": value})

    valid_rows = [r for r in rows if not r.get("skipped")]
    tuples = [(r["name"], r["profile"]) for r in valid_rows]
    first_idx = metrics.first_divergence(tuples, 10.0)

    candidates: list[str] = []
    if first_idx is not None:
        candidates.append(valid_rows[first_idx]["name"])

    jumps = []
    for i in range(1, len(valid_rows)):
        prev, cur = valid_rows[i - 1]["profile"], valid_rows[i]["profile"]
        ratio = cur / max(prev, metrics.JUDGE_FLOOR)
        jumps.append((ratio, valid_rows[i]["name"]))
    jumps.sort(key=lambda x: -x[0])
    for _ratio, name in jumps:
        if len(candidates) >= 5:
            break
        if name not in candidates:
            candidates.append(name)

    out_dir = Path(args.out)
    profile_payload = {"schema": 1, "window_profile": rows}
    (out_dir / "d3-window-profile.json").write_text(json.dumps(profile_payload, indent=2) + "\n", encoding="utf8")

    candidates_payload = {
        "schema": 1,
        "tau": 10.0,
        "first_exceedance": valid_rows[first_idx]["name"] if first_idx is not None else None,
        "top_jumps": [{"name": n, "ratio": r} for r, n in jumps[:8]],
        "candidates": candidates,
    }
    (out_dir / "d3-candidates.json").write_text(json.dumps(candidates_payload, indent=2) + "\n", encoding="utf8")

    print(f"Wrote {out_dir / 'd3-window-profile.json'} and {out_dir / 'd3-candidates.json'}")
    print("candidates:", candidates)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
