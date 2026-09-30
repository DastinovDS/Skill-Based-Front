"""scripts/check_golden_frozen.py (SIM-16): old golden replays stay untouched."""

import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "check_golden_frozen", Path(__file__).resolve().parents[1] / "scripts/check_golden_frozen.py"
)
assert _spec is not None and _spec.loader is not None
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

G = "packages/sim/tests/golden/"


def test_rules() -> None:
    changes = [
        ("A", G + "v2/a.jsonl.gz"),  # new file of the current version: fine
        ("A", G + "generate.py"),  # tooling: fine
        ("M", G + "generate.py"),
        ("M", G + "v1/a.jsonl.gz"),  # regenerated: forbidden
        ("D", G + "v2/b.jsonl.gz"),  # removed: forbidden
        ("A", G + "v1/c.jsonl.gz"),  # added to an old version: forbidden
    ]
    bad: list[str] = _mod.violations(changes, 2)
    assert [line.split()[1].rstrip(":") for line in bad] == [
        G + "v1/a.jsonl.gz",
        G + "v2/b.jsonl.gz",
        G + "v1/c.jsonl.gz",
    ]
