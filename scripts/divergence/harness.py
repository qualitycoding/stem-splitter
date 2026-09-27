#!/usr/bin/env python3
"""Native-vs-WASM comparison harness (plans/perf-divergence D-107).

    python scripts/divergence/harness.py run --model M.onnx --wav in.wav --chunk 3 --runtimes native,wasm-node --out DIR [--expose-file names.txt]

Writes DIR/result.json (schema in tests/divergence/test_harness_tiny.py) plus raw float32 dumps. Tensor names to expose are
passed via FILE, never argv (Git-Bash/MSYS rewrites a leading '/' in argv - SP-7).

STUB: exits non-zero with NotImplementedError until step S-107.
"""
import sys


def main(argv: list[str]) -> int:
    raise NotImplementedError("harness.py main (S-107)")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
