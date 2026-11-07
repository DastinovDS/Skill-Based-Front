"""scripts/tournament_shards.py (#582, #786): sharded tournament == single run, byte for byte."""

import importlib.util
import itertools
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location(
    "tournament_shards", ROOT / "scripts/tournament_shards.py"
)
assert _spec is not None and _spec.loader is not None
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

# The node counts of the pool maps (#785: a match costs about its map's node count).
POOL = [("crossroads", 49), ("highway", 49), ("narrows", 29), ("ridge", 51)]


def _row(map_name: str, seed: int, b0: str, b1: str, ruleset: str = "r") -> str:
    return (
        f'{{"map":"{map_name}","seed":{seed},"bot0":"{b0}","bot1":"{b1}",'
        f'"ruleset_hash":"{ruleset}","sim_version":1}}'
    )


def _single_run(
    maps: tuple[str, ...] = ("alpha", "beta"), seeds: range = range(8, 12)
) -> list[str]:
    """Rows in harness order: maps, seeds, bot0, bot1 (a seed 10 sorts after 9)."""
    return [
        _row(m, s, a, b) for m in maps for s in seeds for a in ("b1", "b2") for b in ("b1", "b2")
    ]


def _cells(shard: dict[str, Any]) -> list[tuple[str, int]]:
    return [
        (m, s)
        for p in shard["pieces"]
        for m in p["maps"]
        for s in range(p["seed_base"], p["seed_base"] + p["seeds"])
    ]


def _best_max(costs: list[int], parts: int) -> int:
    """The least largest part of a contiguous cut of ``costs`` into ``parts`` (brute force)."""
    best = sum(costs)
    for cuts in itertools.combinations(range(1, len(costs)), parts - 1):
        bounds = (0, *cuts, len(costs))
        best = min(best, max(sum(costs[a:b]) for a, b in itertools.pairwise(bounds)))
    return best


@pytest.mark.parametrize("seeds", [1, 2, 3, 5, 7])
@pytest.mark.parametrize("shards", [1, 2, 3, 5, 12, 20])
def test_plan_covers_every_cell_once(seeds: int, shards: int) -> None:
    plan = _mod.plan(POOL, seeds, shards, seed_base=4)
    assert len(plan) == min(shards, len(POOL) * seeds)
    assert [s["shard"] for s in plan] == list(range(len(plan)))
    cells = [c for s in plan for c in _cells(s)]
    assert sorted(cells) == sorted((m, s) for m, _ in POOL for s in range(4, 4 + seeds))
    cost = dict(POOL)
    for s in plan:
        assert s["cells"] == len(_cells(s)) >= 1
        assert s["cost"] == sum(cost[m] for m, _ in _cells(s))
        assert 1 <= len(s["pieces"]) <= 3


@pytest.mark.parametrize("seeds", [1, 2, 3])
@pytest.mark.parametrize("shards", [2, 3, 5, 7])
def test_plan_largest_shard_is_the_least_possible(seeds: int, shards: int) -> None:
    plan = _mod.plan(POOL, seeds, shards)
    costs = [c for _ in range(seeds) for _, c in POOL]  # the seed-major cell list
    assert max(s["cost"] for s in plan) == _best_max(costs, min(shards, len(costs)))


def test_plan_shapes_of_the_pool() -> None:
    # One shard: a single run of everything.
    assert _mod.plan(POOL, 3, 1) == [
        {
            "shard": 0,
            "cost": 534,
            "cells": 12,
            "pieces": [{"maps": [m for m, _ in POOL], "seed_base": 0, "seeds": 3}],
        }
    ]
    # More shards than seeds: one (map, seed) cell per runner; the cap is the number of cells.
    five = _mod.plan(POOL, 5, 20)
    assert [s["cost"] for s in five] == [49, 49, 29, 51] * 5
    assert five[2]["pieces"] == [{"maps": ["narrows"], "seed_base": 0, "seeds": 1}]
    assert len(_mod.plan(POOL, 3, 20)) == 12
    # Many seeds: equal shares of whole seeds.
    assert {s["cost"] for s in _mod.plan(POOL, 20, 20)} == {178}
    hundred = _mod.plan(POOL, 100, 10)
    assert [s["pieces"] for s in hundred][3] == [
        {"maps": [m for m, _ in POOL], "seed_base": 30, "seeds": 10}
    ]
    with pytest.raises(ValueError):
        _mod.plan(POOL, 0, 1)
    with pytest.raises(ValueError):
        _mod.plan([], 1, 1)


def test_plan_cli_reads_node_counts(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    for name, nodes in (("big", 6), ("small", 2)):
        doc = {"nodes": [{"id": i} for i in range(nodes)]}
        (tmp_path / f"{name}.json").write_text(json.dumps(doc), encoding="utf-8")
    pattern = str(tmp_path / "*.json")
    assert _mod.main(["plan", "--maps", pattern, "--seeds", "2", "--shards", "3"]) == 0
    plan = json.loads(capsys.readouterr().out)
    big, small = str(tmp_path / "big.json"), str(tmp_path / "small.json")
    # Cells big0 small0 big1 small1 (6 2 6 2): the least maximum 8 gives two parts, the first one
    # (the costliest, the earlier on a tie) is halved to reach three.
    assert [s["cost"] for s in plan] == [6, 2, 8]
    assert [s["pieces"] for s in plan] == [
        [{"maps": [big], "seed_base": 0, "seeds": 1}],
        [{"maps": [small], "seed_base": 0, "seeds": 1}],
        [{"maps": [big, small], "seed_base": 1, "seeds": 1}],
    ]
    with pytest.raises(ValueError, match="no map file"):
        _mod.expand_maps([str(tmp_path / "none-*.json")])


def test_merge_of_shards_equals_single_run() -> None:
    single = _single_run()
    # Shards by seed range, each in harness order, given in the wrong order.
    shard_a = [r for r in single if '"seed":8' in r or '"seed":9' in r]
    shard_b = [r for r in single if '"seed":10' in r or '"seed":11' in r]
    assert _mod.merge_lines([shard_b, shard_a]) == single


@pytest.mark.parametrize("shards", [1, 2, 3, 5, 8])
def test_merge_of_planned_pieces_equals_single_run(shards: int) -> None:
    maps = ("alpha", "beta", "gamma")
    single = _single_run(maps, range(3))
    plan = _mod.plan([("alpha", 5), ("beta", 3), ("gamma", 9)], 3, shards)
    files: list[list[str]] = []
    for shard in reversed(plan):
        for p in shard["pieces"]:
            # A piece is one harness run: its maps x its seeds, in harness order.
            seeds = range(p["seed_base"], p["seed_base"] + p["seeds"])
            files.append(_single_run(tuple(p["maps"]), seeds))
    assert _mod.merge_lines(files, seeds=3, map_count=3) == single


def test_merge_rejects_duplicates_missing_and_mixed_runs() -> None:
    with pytest.raises(ValueError, match="duplicate"):
        _mod.merge_lines([[_row("a", 0, "x", "y")], [_row("a", 0, "x", "y")]])
    with pytest.raises(ValueError, match="differ"):
        _mod.merge_lines([[_row("a", 0, "x", "y")], [_row("a", 1, "x", "y", ruleset="other")]])
    with pytest.raises(ValueError, match="no rows"):
        _mod.merge_lines([[]])
    single = _single_run()
    with pytest.raises(ValueError, match=r"missing match \('beta', 9, 'b2', 'b1'\)"):
        _mod.merge_lines([[r for r in single if r != _row("beta", 9, "b2", "b1")]])
    # A whole seed or map lost with its shard shows only against the expected counts.
    no_last_seed = [r for r in single if '"seed":11' not in r]
    assert _mod.merge_lines([no_last_seed]) == no_last_seed
    with pytest.raises(ValueError, match="missing seeds"):
        _mod.merge_lines([no_last_seed], seeds=4, seed_base=8)
    no_beta = [r for r in single if '"beta"' not in r]
    with pytest.raises(ValueError, match="missing maps"):
        _mod.merge_lines([no_beta], seeds=4, seed_base=8, map_count=2)


@pytest.mark.slow
def test_real_tournament_one_run_equals_merged_planned_shards(tmp_path: Path) -> None:
    """A tiny real tournament: one run vs the pieces of a 3-shard plan, merged (same bytes)."""
    maps = [str(ROOT / "maps/narrows.json"), str(ROOT / "maps/ridge.json")]
    base = [
        "uv", "run", "gow-bots", "tournament",
        "--bots", "random_legal", "rusher",
        "--jobs", "1",
        "--ruleset", str(ROOT / "rulesets/mvp-1.toml"),
    ]  # fmt: skip
    one = tmp_path / "one.jsonl"
    args = [*base, "--maps", *maps, "--seeds", "2", "--out", str(one)]
    subprocess.run(args, check=True, cwd=ROOT, capture_output=True)
    plan = _mod.plan([(m, _mod.map_cost(m)) for m in maps], 2, 3)
    assert len(plan) == 3
    pieces: list[Path] = []
    for shard in plan:
        for p in shard["pieces"]:
            out = tmp_path / f"shard-{shard['shard']}-{len(pieces)}.jsonl"
            seeds = ["--seeds", str(p["seeds"]), "--seed-base", str(p["seed_base"])]
            args = [*base, "--maps", *p["maps"], *seeds, "--out", str(out)]
            subprocess.run(args, check=True, cwd=ROOT, capture_output=True)
            pieces.append(out)
    merged = tmp_path / "merged.jsonl"
    _mod.merge_files(list(reversed(pieces)), merged, seeds=2, map_count=2)
    assert merged.read_bytes() == one.read_bytes()
    assert sys.version_info >= (3, 12)
