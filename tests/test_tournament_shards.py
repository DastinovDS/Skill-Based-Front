"""scripts/tournament_shards.py (#582): sharded tournament == single run, byte for byte."""

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location(
    "tournament_shards", ROOT / "scripts/tournament_shards.py"
)
assert _spec is not None and _spec.loader is not None
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)


def _row(map_name: str, seed: int, b0: str, b1: str, ruleset: str = "r") -> str:
    return (
        f'{{"map":"{map_name}","seed":{seed},"bot0":"{b0}","bot1":"{b1}",'
        f'"ruleset_hash":"{ruleset}","sim_version":1}}'
    )


def _single_run() -> list[str]:
    """Rows in harness order: maps, seeds, bot0, bot1 (a seed 10 sorts after 9)."""
    return [
        _row(m, s, a, b)
        for m in ("alpha", "beta")
        for s in range(8, 12)
        for a in ("b1", "b2")
        for b in ("b1", "b2")
    ]


def test_plan_covers_seeds_without_gaps() -> None:
    p = _mod.plan(10, 3, seed_base=5)
    assert p == [
        {"shard": 0, "seed_base": 5, "seeds": 4},
        {"shard": 1, "seed_base": 9, "seeds": 3},
        {"shard": 2, "seed_base": 12, "seeds": 3},
    ]
    assert [s["shard"] for s in _mod.plan(2, 20)] == [0, 1]  # never an empty shard
    with pytest.raises(ValueError):
        _mod.plan(0, 1)


def test_merge_of_shards_equals_single_run() -> None:
    single = _single_run()
    # Shards by seed range, each in harness order, given in the wrong order.
    shard_a = [r for r in single if '"seed":8' in r or '"seed":9' in r]
    shard_b = [r for r in single if '"seed":10' in r or '"seed":11' in r]
    assert _mod.merge_lines([shard_b, shard_a]) == single


def test_merge_rejects_duplicates_and_mixed_runs() -> None:
    with pytest.raises(ValueError, match="duplicate"):
        _mod.merge_lines([[_row("a", 0, "x", "y")], [_row("a", 0, "x", "y")]])
    with pytest.raises(ValueError, match="differ"):
        _mod.merge_lines([[_row("a", 0, "x", "y")], [_row("a", 1, "x", "y", ruleset="other")]])
    with pytest.raises(ValueError, match="no rows"):
        _mod.merge_lines([[]])


@pytest.mark.slow
def test_real_tournament_one_run_equals_two_merged_shards(tmp_path: Path) -> None:
    """A tiny real tournament: one run vs two seed shards merged (byte-identical files)."""
    base = [
        "uv", "run", "gow-bots", "tournament",
        "--maps", str(ROOT / "maps/ridge.json"),
        "--bots", "random_legal", "rusher",
        "--jobs", "2",
        "--ruleset", str(ROOT / "rulesets/mvp-1.toml"),
    ]  # fmt: skip
    one, s0, s1, merged = (tmp_path / n for n in ("one", "s0", "s1", "merged"))
    for out, seeds, seed_base in ((one, 2, 0), (s0, 1, 0), (s1, 1, 1)):
        args = [*base, "--seeds", str(seeds), "--seed-base", str(seed_base), "--out", str(out)]
        subprocess.run(args, check=True, cwd=ROOT, capture_output=True)
    _mod.merge_files([s1, s0], merged)
    assert merged.read_bytes() == one.read_bytes()
    assert sys.version_info >= (3, 12)
