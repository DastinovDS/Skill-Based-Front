"""The metrics of equal access (#771) on small hand-built maps, values worked out by hand.

The map of ``_fork`` (capitals A and B; ticks on the roads)::

    A -30- C -50- B        A: t0 0,  t1 80      C: t0 30, t1 50  -> first reach of A
    A -40- D -40- B        B: t0 80, t1 0       D: t0 40, t1 40  -> a tie, nobody's
    A -20- E -30- D        E: t0 20, t1 70 (B, D, E)             -> first reach of A
    B -10- F -60- D        F: t0 90 (A, D, B, F), t1 10          -> first reach of B
"""

import dataclasses
import json
from pathlib import Path
from typing import Any

import pytest

from gow_maps import fairness
from gow_maps.fairness import (
    Neighbours,
    Scores,
    check,
    choke_pct,
    cut_nodes,
    dead_end_nodes,
    gap_pct,
    load_fairness,
    longest_lane,
    mirror_scores,
    score,
    shortest,
    terrain_ticks,
)
from gow_maps.validate import load_config, validate_file
from gow_sim.maps import MapDef, parse_map

CONFIG = load_fairness()
MAPS = Path(__file__).parents[3] / "maps"


def _node(i: int, kind: str = "province", vp: int = 0, **extra: Any) -> dict[str, Any]:
    return {
        "id": i,
        "name": f"N{i}",
        "x": 100 + 10 * i,
        "y": 100,
        "terrain": "plains",
        "vp": vp,
        "kind": kind,
        "capital_of": None,
        "start_owner": None,
        "start_units": 0,
        "start_charged": 0,
        "start_stock": 0,
    } | extra


def _capital(i: int, player: int) -> dict[str, Any]:
    return _node(
        i,
        "capital",
        1,
        capital_of=player,
        start_owner=player,
        start_units=6,
        start_charged=6,
        start_stock=6,
    )


def _map(nodes: list[dict[str, Any]], roads: list[tuple[int, int, int]]) -> MapDef:
    edges = [
        {"id": i, "a": a, "b": b, "max_level": 2, "travel_ticks": t, "border_permille": 500}
        for i, (a, b, t) in enumerate(roads)
    ]
    return parse_map(
        {
            "meta": {"name": "m", "version": 1, "symmetry": "none", "width": 400, "height": 400},
            "nodes": nodes,
            "edges": edges,
            "mirror": {
                "nodes": {str(i): i for i in range(len(nodes))},
                "edges": {str(i): i for i in range(len(edges))},
            },
        }
    )


def _fork() -> MapDef:
    nodes = [
        _capital(0, 0),
        _capital(1, 1),
        _node(2, "city_large", 2),
        _node(3),
        _node(4, "city_small", 1),
        _node(5, "city_small", 1),
    ]
    roads = [(0, 2, 30), (2, 1, 50), (0, 3, 40), (3, 1, 40), (0, 4, 20), (4, 3, 30)]
    return _map(nodes, [*roads, (1, 5, 10), (5, 3, 60)])


def _adjacent(roads: list[tuple[int, int, int]], count: int) -> Neighbours:
    out: Neighbours = [[] for _ in range(count)]
    for a, b, t in roads:
        out[a].append((b, t))
        out[b].append((a, t))
    return out


@pytest.fixture
def fork() -> Scores:
    return score(_fork(), dataclasses.replace(CONFIG, contested_ticks=25))


def test_first_reach_splits_by_the_nearer_capital(fork: Scores) -> None:
    assert fork.capital_ticks == 80
    assert fork.cities == (2, 1)  # C and E of A, F of B; the tie D counts for nobody
    assert fork.provinces == (0, 0)
    assert fork.vp == (3, 1)


def test_time_to_the_contested_zone(fork: Scores) -> None:
    # |t0 - t1|: C 20, D 0 are within 25; E 50 and F 80 are not.
    assert fork.contested == 2
    assert fork.front_ticks == (30, 40)  # A to C, B to D
    assert gap_pct(fork.front_ticks) == 25


def test_approaches_are_the_roads_of_a_capital(fork: Scores) -> None:
    assert fork.approaches == (3, 3)


def test_charges_reachable(fork: Scores) -> None:
    # Half of the 80 ticks is 40. A: A 6, E 3, C 3, D 1. B: B 6, F 3, D 1. Start: 6 + 6 each.
    assert fork.charges == (25, 22)
    assert gap_pct(fork.charges) == 12


def test_start_forces_are_compared_side_by_side(fork: Scores) -> None:
    assert fork.start_forces == ((6, 6, 6), (6, 6, 6))
    assert fork.capital_stock == (6, 6)


def test_terrain_speed_splits_a_road_at_its_border_point() -> None:
    nodes = [_capital(0, 0) | {"terrain": "mountains"}, _capital(1, 1)]
    slow = terrain_ticks(_map(nodes, [(0, 1, 100)]), CONFIG)
    # 50 ticks at 70% and 50 at 125%: 71.4 + 40 = 111.4, rounded down.
    assert slow[0] == [(1, 111)]
    assert slow[1] == [(0, 111)]
    flat = terrain_ticks(_map([_capital(0, 0), _capital(1, 1)], [(0, 1, 30)]), CONFIG)
    assert flat[0] == [(1, 24)]  # the whole road at 125%


def test_shortest_avoids_a_node_and_marks_the_unreachable() -> None:
    line = _adjacent([(0, 1, 5), (1, 2, 5)], 3)
    assert shortest(line, 0) == [0, 5, 10]
    assert shortest(line, 0, without=1) == [0, -1, -1]


def test_dead_end_nodes_peel_a_whole_lane() -> None:
    # A triangle 0 1 2 with the lane 2 - 3 - 4.
    tail = _adjacent([(0, 1, 1), (1, 2, 1), (2, 0, 1), (2, 3, 1), (3, 4, 1)], 5)
    assert dead_end_nodes(tail) == 2
    assert dead_end_nodes(_adjacent([(0, 1, 1), (1, 2, 1), (2, 0, 1)], 3)) == 0


def test_longest_lane_counts_nodes_with_two_roads() -> None:
    # A ring of six with the chord 0 - 3: the lanes 1, 2 and 4, 5.
    ring = [(0, 1, 1), (1, 2, 1), (2, 3, 1), (3, 4, 1), (4, 5, 1), (5, 0, 1), (0, 3, 1)]
    assert longest_lane(_adjacent(ring, 6)) == 2


def test_cut_nodes_are_the_articulation_points_between_the_capitals() -> None:
    bottleneck = _adjacent([(0, 2, 1), (2, 1, 1), (0, 3, 1), (3, 2, 1)], 4)
    assert cut_nodes(bottleneck, 0, 1) == (2,)
    two_ways = _adjacent([(0, 2, 1), (2, 1, 1), (0, 3, 1), (3, 1, 1)], 4)
    assert cut_nodes(two_ways, 0, 1) == ()


def test_choke_is_the_detour_without_the_worst_node() -> None:
    # 0 - 2 - 1 takes 20, without node 2 the way 0 - 3 - 1 takes 30.
    ways = _adjacent([(0, 2, 10), (2, 1, 10), (0, 3, 15), (3, 1, 15)], 4)
    assert choke_pct(ways, 0, 1) == 50


def _square(y1: int) -> MapDef:
    nodes = [
        _capital(0, 0) | {"x": 100, "y": 100},
        _node(1) | {"x": 300, "y": y1},
        _capital(2, 1) | {"x": 300, "y": 300},
        _node(3) | {"x": 100, "y": 300},
    ]
    return _map(nodes, [(0, 1, 60), (1, 2, 60), (2, 3, 60), (3, 0, 60)])


def test_an_exact_rotation_scores_the_top_of_the_mirror_scale() -> None:
    hops = ([0, 1, 2, 1], [2, 1, 0, 1])
    assert mirror_scores(_square(100), hops) == (0, 100, 100)


def test_mirror_shift_is_in_percent_of_the_node_spacing() -> None:
    # Node 3 rotates to (300, 100), 40 from node 1 at (300, 140); node 1 rotates to (100, 260), 40
    # from node 3; the capitals land on each other: a mean of 20, a spacing of sqrt(400 * 400 / 4).
    shift, _, _ = mirror_scores(_square(140), ([0, 1, 2, 1], [2, 1, 0, 1]))
    assert shift == 10


def test_mirror_profile_needs_a_swapped_twin_of_the_same_degree() -> None:
    # Capitals 0 and 3 on a ring 0 1 3 2, node 4 hangs on 1 and 3. Profiles (hops, hops, degree):
    # (0,2,2) (1,1,3) (1,1,2) (2,0,3) (2,1,2): only the two (1,1,_) have a swapped twin.
    nodes = [_capital(0, 0), _node(1), _node(2), _capital(3, 1), _node(4)]
    mapdef = _map(nodes, [(0, 1, 1), (1, 3, 1), (3, 2, 1), (2, 0, 1), (1, 4, 1), (4, 3, 1)])
    _, _, profile = mirror_scores(mapdef, ([0, 1, 1, 2, 2], [2, 1, 1, 0, 1]))
    assert profile == 40


def _passing() -> Scores:
    return Scores(
        capital_ticks=500,
        cities=(10, 10),
        provinces=(10, 10),
        vp=(14, 14),
        contested=8,
        front_ticks=(250, 250),
        front_terrain_ticks=(250, 250),
        approaches=(3, 3),
        charges=(70, 70),
        start_forces=((16, 16, 14), (16, 16, 14)),
        capital_stock=(6, 6),
        mirror_shift_pct=45,
        mirror_roads_pct=45,
        mirror_profile_pct=40,
        dead_end_nodes=0,
        longest_lane=1,
        capital_depth=(4, 4),
        cut_nodes=(),
        choke_pct=10,
    )


def test_a_balanced_map_passes() -> None:
    assert check(_passing(), CONFIG) == []


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("contested", 0, "no contested zone"),
        ("cities", (11, 8), "first reach: cities"),
        ("provinces", (12, 8), "first reach: provinces"),
        ("vp", (16, 13), "first reach: vp"),
        ("front_ticks", (200, 250), "time to the contested zone (200, 250)"),
        ("front_terrain_ticks", (190, 250), "by terrain"),
        ("approaches", (3, 5), "approaches"),
        ("approaches", (2, 3), "approaches"),
        ("charges", (60, 72), "charges reachable"),
        ("start_forces", ((16, 16, 14), (18, 18, 14)), "start forces"),
        ("capital_stock", (6, 4), "capital stock"),
        ("mirror_shift_pct", 21, "of a spacing"),
        ("mirror_roads_pct", 100, "of the roads land"),
        ("mirror_profile_pct", 100, "swapped twin"),
        ("dead_end_nodes", 1, "dead-end"),
        ("longest_lane", 3, "a lane of 3"),
        ("capital_depth", (1, 4), "capital depth"),
        ("cut_nodes", (7,), "cut nodes [7]"),
        ("choke_pct", 31, "slows the capitals"),
    ],
)
def test_every_threshold_rejects(field: str, value: object, message: str) -> None:
    failed = check(dataclasses.replace(_passing(), **{field: value}), CONFIG)
    assert len(failed) == 1
    assert message in failed[0]


@pytest.mark.parametrize("name", ["ridge", "crossroads", "highway", "narrows"])
def test_the_pool_scores_zero_gaps_and_the_top_of_the_mirror_scale(name: str) -> None:
    # The mirror keeps both sides equal by construction: what fails is only "a mirror in disguise".
    from gow_sim.maps import load_map

    s = score(load_map(MAPS / f"{name}.json"), CONFIG)
    for pair in (s.cities, s.provinces, s.vp, s.front_ticks, s.approaches, s.charges):
        assert pair[0] == pair[1]
    assert (s.mirror_roads_pct, s.mirror_profile_pct) == (100, 100)
    assert s.mirror_shift_pct < CONFIG.min_mirror_shift_pct
    failed = check(s, CONFIG)
    assert len(failed) == 3
    assert all("rot180" in m or "spacing" in m or "swapped twin" in m for m in failed)


def _none_copy(tmp_path: Path, name: str, **changes: Any) -> Path:
    """A pool map marked as a map without a mirror."""
    data = json.loads((MAPS / f"{name}.json").read_text(encoding="utf-8"))
    data["meta"]["symmetry"] = "none"
    data["mirror"] = {
        "nodes": {str(i): i for i in range(len(data["nodes"]))},
        "edges": {str(i): i for i in range(len(data["edges"]))},
    } | changes
    path = tmp_path / f"{name}.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def test_validator_replaces_symmetry_and_border_by_fairness(tmp_path: Path) -> None:
    config = load_config()
    issues = validate_file(_none_copy(tmp_path, "narrows"), config)
    assert {i.check for i in issues} == {"fairness"}  # a mirror in disguise: nothing else fails
    assert any("rot180" in i.message for i in issues)


def test_validator_wants_an_identity_mirror_on_a_map_without_symmetry(tmp_path: Path) -> None:
    moved = {str(i): i for i in range(29)} | {"3": 4, "4": 3}
    issues = validate_file(_none_copy(tmp_path, "narrows", nodes=moved), load_config())
    assert [i.message for i in issues if i.check == "symmetry"] == [
        "not an identity mirror: nodes [3, 4], edges []"
    ]


def test_load_fairness_reads_the_shared_validator_file() -> None:
    config = load_config()
    assert {f.name: getattr(config, f.name) for f in dataclasses.fields(CONFIG)} == {
        f.name: getattr(CONFIG, f.name) for f in dataclasses.fields(CONFIG)
    }
    assert fairness.warehouse(_fork().nodes[0].kind, CONFIG) == CONFIG.warehouse_capital
