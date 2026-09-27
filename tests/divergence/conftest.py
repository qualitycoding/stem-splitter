"""FROZEN. Makes scripts/divergence importable. Run with:
    PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/divergence -p no:cacheprovider
(bytecode and .pytest_cache would otherwise land under tests/ and break `npm run verify:frozen`)."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "divergence"))
