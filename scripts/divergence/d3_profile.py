#!/usr/bin/env python3
"""D3 profile bisection, stage 1 (plans/perf-divergence D-106, S-109): combines the batched
milestone exposures (target + control, both runtimes) already run via harness.py into a
profile, applies first_divergence(profile, tau=10) to find window W, and writes
research/divergence/d3-profile.json/.md.

    python scripts/divergence/d3_profile.py --milestones M.json --target-dir DIR --control-dir DIR --batches N --out research/divergence
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import metrics


def load_exposed(base_dir: Path, batches: int) -> dict[str, dict]:
    exposed: dict[str, dict] = {}
    for i in range(batches):
        result = json.loads((base_dir.parent / f"{base_dir.name}{i}" / "result.json").read_text(encoding="utf8"))
        for e in result["exposed"]:
            exposed[e["tensor"]] = e
    return exposed


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--milestones", required=True)
    parser.add_argument("--target-dir-prefix", required=True)
    parser.add_argument("--control-dir-prefix", required=True)
    parser.add_argument("--batches", type=int, required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    milestone_list = json.loads(Path(args.milestones).read_text(encoding="utf8"))
    target_exposed = load_exposed(Path(args.target_dir_prefix), args.batches)
    control_exposed = load_exposed(Path(args.control_dir_prefix), args.batches)

    profile_rows = []
    for m in milestone_list:
        name = m["name"]
        t = target_exposed.get(name)
        c = control_exposed.get(name)
        if t is None or c is None:
            profile_rows.append({"name": name, "kind": m["kind"], "skipped": True})
            continue
        rel_l2_target = t["rel_l2"]
        rel_l2_control = c["rel_l2"]
        value = rel_l2_target / max(rel_l2_control, metrics.JUDGE_FLOOR)
        profile_rows.append(
            {
                "name": name,
                "kind": m["kind"],
                "rel_l2_target": rel_l2_target,
                "rel_l2_control": rel_l2_control,
                "profile": value,
            }
        )

    tuples = [(r["name"], r["profile"]) for r in profile_rows if not r.get("skipped")]
    idx = metrics.first_divergence(tuples, 10.0)
    if idx is None:
        window_start = tuples[-2][0] if len(tuples) >= 2 else None
        window_end = tuples[-1][0] if tuples else None
        window_note = "no milestone exceeded tau=10; W = last block"
    else:
        window_start = tuples[idx - 1][0] if idx > 0 else None
        window_end = tuples[idx][0]
        window_note = f"first exceedance at index {idx} ({window_end})"

    out_dir = Path(args.out)
    payload = {
        "schema": 1,
        "tau": 10.0,
        "profile": profile_rows,
        "window": {"start_after": window_start, "end_at": window_end, "note": window_note},
    }
    (out_dir / "d3-profile.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf8")

    md = ["| Milestone | kind | rel_l2 target | rel_l2 control | profile |", "|---|---|---|---|---|"]
    for r in profile_rows:
        if r.get("skipped"):
            md.append(f"| {r['name']} | {r['kind']} | - | - | SKIPPED |")
        else:
            md.append(f"| {r['name']} | {r['kind']} | {r['rel_l2_target']:.6g} | {r['rel_l2_control']:.6g} | {r['profile']:.6g} |")
    md.append("")
    md.append(f"**Window W**: after `{window_start}`, up to and including `{window_end}` ({window_note}).")
    (out_dir / "d3-profile.md").write_text("\n".join(md) + "\n", encoding="utf8")

    print(f"Wrote {out_dir / 'd3-profile.json'} and {out_dir / 'd3-profile.md'}")
    print(f"Window: {window_start!r} -> {window_end!r} ({window_note})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
