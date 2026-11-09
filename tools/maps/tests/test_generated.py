"""The generator (#771) and the batch ``maps/gen/``: determinism, format, outside the pool."""

import json
import re
from collections import Counter
from pathlib import Path

import pytest

from gow_maps import geo
from gow_maps.cli import main
from gow_maps.generate import (
    GENERATOR_VERSION,
    MAX_NODES,
    MIN_NODES,
    delaunay,
    generate,
    has_bridge,
    map_id,
    neutral_pct,
    plan_size,
    water_share_pct,
)
from gow_maps.geo import dump_geography
from gow_maps.mirror import dump_map
from gow_maps.validate import load_config, validate_file
from gow_sim.maps import load_map, map_hash, parse_map
from gow_sim.ruleset import load_ruleset

ROOT = Path(__file__).parents[3]
GEN = ROOT / "maps" / "gen"
BATCH = sorted(GEN.glob("*.json"))
CONFIG = load_config()
PINNED_SEED = 36
PINNED_HASH = "e18154821072ce313573497ba5b238aa"


def _seed(path: Path) -> int:
    match = re.fullmatch(rf"gen{GENERATOR_VERSION}-(\d+)", path.stem)
    assert match, path
    return int(match.group(1))


def test_a_seed_pins_its_map() -> None:
    # On every platform: only + - * /, sqrt and Random.random() touch the numbers.
    made = generate(PINNED_SEED)
    assert map_hash(parse_map(made.data)) == PINNED_HASH
    assert made.data == generate(PINNED_SEED).data
    assert made.geo == generate(PINNED_SEED).geo


def test_two_seeds_give_two_maps() -> None:
    assert generate(36).data["nodes"] != generate(37).data["nodes"]


def test_a_seed_sets_a_size_of_the_pool() -> None:
    sizes = [plan_size(seed) for seed in range(200)]
    assert {n for n, _, _ in sizes} == set(range(MIN_NODES, MAX_NODES + 1))
    for _, width, height in sizes:
        assert width % 4 == 0  # the bake needs a world in multiples of 4
        assert height % 4 == 0
        assert 1.25 < width / height < 1.8


def test_delaunay_takes_the_short_diagonal() -> None:
    # A quad: the diagonal 1-2 (length^2 200) and not 0-3 (242).
    assert delaunay([(0, 0), (10, 0), (0, 10), (11, 11)]) == [
        (0, 1),
        (0, 2),
        (1, 2),
        (1, 3),
        (2, 3),
    ]


def test_has_bridge() -> None:
    triangle = [(0, 1), (1, 2), (2, 0)]
    assert not has_bridge(3, triangle)
    assert has_bridge(4, [*triangle, (2, 3)])  # the tail hangs on one road
    assert has_bridge(5, [*triangle, (3, 4)])  # two parts


def test_water_share_counts_the_ground_nearer_to_the_water() -> None:
    # A node at the east edge, a cell of radius 0 at the west edge: the bisector is x = 200, and
    # the 40 unit samples at x = 20..180 are 5 columns of 10.
    cell = {"kind": "sea", "x": 0, "y": 200, "r": 0}
    assert water_share_pct((400, 400), [cell], [(400, 200)]) == 50


def test_neutral_pct_counts_neutral_nodes_about_as_far_from_both_capitals() -> None:
    # A line: capital, neutral, neutral, neutral, capital; the distances differ by 2, 0, 2.
    def node(i: int, owner: int | None) -> dict[str, object]:
        return {"id": i, "capital_of": owner, "start_owner": owner}

    data = {
        "nodes": [node(0, 0), node(1, None), node(2, None), node(3, None), node(4, 1)],
        "edges": [{"a": i, "b": i + 1} for i in range(4)],
    }
    assert neutral_pct(data) == 20


def test_there_is_a_batch_of_mixed_sizes() -> None:
    assert len(BATCH) == 8
    sizes = [len(load_map(p).nodes) for p in BATCH]
    assert min(sizes) < 35
    assert max(sizes) > 50


@pytest.mark.parametrize("path", BATCH, ids=[p.stem for p in BATCH])
def test_a_batch_map_is_what_its_seed_gives(path: Path) -> None:
    made = generate(_seed(path))
    assert path.read_text(encoding="utf-8") == dump_map(made.data)
    spec = geo.spec_path(path)
    assert spec.read_text(encoding="utf-8") == dump_geography(made.geo)
    assert made.data["meta"]["name"] == map_id(_seed(path))


@pytest.mark.parametrize("path", BATCH, ids=[p.stem for p in BATCH])
def test_a_batch_map_passes_the_validator(path: Path) -> None:
    rules = load_ruleset(ROOT / "rulesets" / "mvp-6.toml")
    assert validate_file(path, CONFIG, rules) == []


@pytest.mark.parametrize("path", BATCH, ids=[p.stem for p in BATCH])
def test_a_batch_map_has_no_mirror_and_equal_starts(path: Path) -> None:
    mapdef = load_map(path)
    assert mapdef.meta.symmetry == "none"
    assert mapdef.mirror_nodes == tuple(range(len(mapdef.nodes)))
    assert mapdef.mirror_edges == tuple(range(len(mapdef.edges)))
    sides = [
        Counter(
            (n.kind, n.vp, n.start_units, n.start_charged, n.start_stock)
            for n in mapdef.nodes
            if n.start_owner == player
        )
        for player in (0, 1)
    ]
    assert sides[0] == sides[1]  # the same list of kinds: the bots read start forces as symmetric
    assert mapdef.nodes[mapdef.capital(0)].terrain == mapdef.nodes[mapdef.capital(1)].terrain


def test_the_batch_is_baked_and_outside_the_pool() -> None:
    for path in BATCH:
        assert path.with_name(f"{path.stem}.bg.webp").is_file()
        assert path.with_name(f"{path.stem}.preview.png").is_file()
        vectors = json.loads(geo.vector_path(path).read_text(encoding="utf-8"))
        assert vectors["map"] == path.stem
    # The server, the queue and the default tournaments read maps/*.json only.
    assert not [p for p in (ROOT / "maps").glob("*.json") if p.stem.startswith("gen")]


def test_cli_writes_a_map_and_its_geography(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["generate", "--seed", str(PINNED_SEED), "-o", str(tmp_path)]) == 0
    name = map_id(PINNED_SEED)
    assert (tmp_path / f"{name}.json").is_file()
    assert (tmp_path / "src" / f"{name}.geo.json").is_file()
    out = capsys.readouterr().out
    assert "first reach" in out
    assert "mirror: shift" in out


def test_cli_score_prints_the_pool_as_a_mirror(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["score", str(ROOT / "maps" / "narrows.json")]) == 0
    assert "mirror: shift 7%, roads 100%, profile 100%" in capsys.readouterr().out
