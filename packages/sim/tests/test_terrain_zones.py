"""Terrain speed by zone (owner's decision of 2026-10-14, #252, #253).

Table tests of exactly the 6 worked examples of the block "Speed by terrain by zones"
(mechanics.md, section 4). Expected values come from that table, not from the code. The setting:
``travel_ticks = 30``, the border point at 500; ``terrain.speed_pct`` plains 125, forest 100,
mountains 70 (pinned in ``RULES``); «after ``k`` ticks»: ``progress`` after ``k`` ticks on the edge.

Tick convention: a ``Move`` applied at tick 1 makes its first step in tick 1, so after ``k`` ticks
on the edge ``state.tick == k``.
"""

import dataclasses
import itertools
from pathlib import Path
from typing import Any

import pytest

from gow_sim.commands import Move, Ok, PlayerCommand, apply_commands, validate
from gow_sim.maps import MapDef, parse_map
from gow_sim.ruleset import Ruleset, TerrainRules, TerrainTable, load_ruleset
from gow_sim.state import AtNode, Event, GameState, Group, Mode, OnEdge, initial_state
from gow_sim.systems import movement as movement_module
from gow_sim.systems.combat import combat
from gow_sim.systems.movement import border_permille, movement, traversal_ticks
from gow_sim.view import opaque_id, reach

TESTS_DIR = Path(__file__).resolve().parent
MVP0 = TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml"
KEY = b"terrain-zones-test-key-0123456789"


def _rules() -> Ruleset:
    base = load_ruleset(MVP0)
    terrain = TerrainRules(
        defense_mod=base.terrain.defense_mod,
        speed_pct=TerrainTable(plains=125, forest=100, mountains=70),
    )
    return dataclasses.replace(base, terrain=terrain)


RULES = _rules()


def _line(terrains: list[str], owners: list[int | None]) -> MapDef:
    """A path graph 0 - 1 - ... - n-1, every edge ``travel_ticks = 30``; capitals at both ends."""
    n = len(terrains)
    nodes: list[dict[str, Any]] = [
        {
            "id": i,
            "name": f"n{i}",
            "x": 10 * i,
            "y": 10,
            "terrain": terrains[i],
            "vp": 1,
            "kind": "city_small",
            "capital_of": None,
            "start_owner": owners[i],
            "start_units": 0,
            "start_charged": 0,
            "start_stock": 0,
        }
        for i in range(n)
    ]
    nodes[0]["capital_of"], nodes[-1]["capital_of"] = 0, 1
    nodes[0]["kind"] = nodes[-1]["kind"] = "capital"
    edges = [
        {"id": i, "a": i, "b": i + 1, "max_level": 3, "travel_ticks": 30, "border_permille": 500}
        for i in range(n - 1)
    ]
    mirror = {
        "nodes": {str(i): n - 1 - i for i in range(n)},
        "edges": {str(i): n - 2 - i for i in range(n - 1)},
    }
    return parse_map(
        {
            "meta": {
                "name": "zones",
                "version": 1,
                "symmetry": "rot180",
                "width": 1000,
                "height": 20,
            },
            "nodes": nodes,
            "edges": edges,
            "mirror": mirror,
        }
    )


def _group(state: GameState, owner: int, location: AtNode | OnEdge, units: int = 2) -> int:
    gid = state.new_id()
    state.groups[gid] = Group(gid, owner, units, units, Mode.ATTACK, location)
    return gid


def _step(state: GameState, commands: list[PlayerCommand] | None = None) -> list[Event]:
    state.tick += 1
    apply_commands(state, RULES, commands or [])
    state.events = movement(state, RULES)
    fought = combat(state, RULES)
    state.events += fought
    return fought


def _progress_by_tick(terrains: list[str]) -> dict[int, int]:
    """Order a group from node 0 to node 1 at tick 1; ``progress`` after each tick on the edge,
    and ``1000`` on the tick it stands in node 1."""
    state = initial_state(_line([*terrains, "forest"], [0, 0, 1]), RULES)
    gid = _group(state, 0, AtNode(0))
    seen: dict[int, int] = {}
    commands = [PlayerCommand(0, 1, Move(gid, 1))]
    while state.tick < 100:
        _step(state, commands)
        commands = []
        match state.groups[gid].location:
            case OnEdge(edge=0, from_node=0, progress=progress):
                seen[state.tick] = progress
            case AtNode(node=1):
                seen[state.tick] = 1000
                break
            case other:
                raise AssertionError(other)
    return seen


def test_the_border_point_comes_from_the_map() -> None:
    # DEC-23, item 5 (#366): the edge field border_permille, in thousandths from the end a.
    mapdef = _line(["plains", "mountains", "forest"], [0, 0, 1])
    assert border_permille(mapdef, 0) == 500
    edges = (dataclasses.replace(mapdef.edges[0], border_permille=300), *mapdef.edges[1:])
    moved = dataclasses.replace(mapdef, edges=edges)
    assert border_permille(moved, 0) == 300
    # Rule 2, travel_ticks 30, plains 125 -> mountains 70: b = 300 from the plains end gives
    # D = 300 * 70 + 700 * 125 = 108500, T = 30 * 100 * 108500 // (1000 * 125 * 70) = 37
    # (b = 500: 33, example 1); the other way b = 700 from the mountains end, the same D.
    assert traversal_ticks(moved, RULES, 0, 1) == 37
    assert traversal_ticks(moved, RULES, 0, 0) == 37


def test_example_1_plains_to_mountains() -> None:
    assert traversal_ticks(_line(["plains", "mountains", "forest"], [0, 0, 1]), RULES, 0, 1) == 33
    seen = _progress_by_tick(["plains", "mountains"])
    assert (seen[5], seen[11], seen[12]) == (211, 464, 503)
    assert max(seen) == 33 and seen[33] == 1000  # arrives on the 33rd tick
    assert seen[11] < 500 < seen[12]  # the border is passed on the 12th tick


def test_example_2_mountains_to_plains() -> None:
    assert traversal_ticks(_line(["mountains", "plains", "forest"], [0, 0, 1]), RULES, 0, 1) == 33
    seen = _progress_by_tick(["mountains", "plains"])
    assert (seen[10], seen[21], seen[22]) == (236, 496, 535)
    assert max(seen) == 33


@pytest.mark.parametrize(("terrain", "ticks"), [("forest", 30), ("plains", 24), ("mountains", 42)])
def test_example_3_one_terrain_is_unchanged(terrain: str, ticks: int) -> None:
    mapdef = _line([terrain, terrain, "forest"], [0, 0, 1])
    assert traversal_ticks(mapdef, RULES, 0, 1) == ticks
    seen = _progress_by_tick([terrain, terrain])
    assert max(seen) == ticks
    for k in range(1, ticks):
        assert seen[k] == k * 1000 // ticks
    if terrain == "forest":
        assert seen[10] == 333


def test_example_4_bounce_retraces_the_steps_of_the_zones() -> None:
    state = initial_state(_line(["plains", "mountains", "forest"], [0, 0, 1]), RULES)
    gid = _group(state, 0, OnEdge(0, 0, 692, back=True))  # bounced after 20 ticks (example 1)
    _step(state)
    assert state.groups[gid].location == OnEdge(0, 0, 669, back=True)  # as after 19 ticks
    for _ in range(18):
        _step(state)
        assert isinstance(state.groups[gid].location, OnEdge)
    _step(state)  # the 20th tick of the bounce
    assert state.groups[gid].location == AtNode(0)


def test_example_5_reach_and_ack_count_both_zones() -> None:
    state = initial_state(
        _line(["plains", "mountains", "forest", "forest"], [0, 0, None, 1]), RULES
    )
    assert traversal_ticks(state.map, RULES, 1, 2) == 36  # mountains -> forest
    gid = _group(state, 0, AtNode(0))
    found = reach(state, RULES, 0, opaque_id(KEY, 0, gid), KEY)
    assert found is not None
    assert {n: (t, path) for n, t, path in found.nodes}[2] == (69, (0, 1, 2))  # 33 + 36; #448
    state.tick = 7  # the order is applied at tick t = 7
    outcome = validate(state, RULES, 0, Move(gid, 2))
    assert isinstance(outcome, Ok)
    assert outcome.path == (0, 1, 2)
    assert outcome.arrive_tick == 7 + 68


def test_example_6_edge_meeting_on_the_17th_tick() -> None:
    state = initial_state(_line(["plains", "mountains", "forest"], [0, 1, 1]), RULES)
    x = _group(state, 0, AtNode(0))
    y = _group(state, 1, AtNode(1))
    commands = [PlayerCommand(0, 1, Move(x, 1)), PlayerCommand(1, 1, Move(y, 0))]
    for tick in range(1, 17):
        assert _step(state, commands) == [], tick
        commands = []
    gx, gy = state.groups[x].location, state.groups[y].location
    assert isinstance(gx, OnEdge) and isinstance(gy, OnEdge)
    assert (gx.progress, gy.progress) == (598, 378)  # 976 after 16 ticks: not yet
    fought = _step(state)  # tick 17: 621 + 401 = 1022
    assert [e.kind for e in fought if e.kind == "fight_started"] == ["fight_started"]
    assert next(e for e in fought if e.kind == "fight_started").get("edge") == 0


@pytest.mark.parametrize("border", [0, 1, 300, 500, 700, 999, 1000])
def test_any_border_point_keeps_progress_invertible(
    border: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The rule for a border point other than 500 (DEC-21 data later): ``progress`` grows every
    tick, ``spent`` inverts it exactly (bounces retrace the steps), the edge ends at 1000, and the
    ends of the edge as border give one zone (rule 2: ``T = travel_ticks * 100 // p``)."""

    def at(mapdef: MapDef, edge: int) -> int:
        del mapdef, edge
        return border

    monkeypatch.setattr(movement_module, "border_permille", at)
    speeds = {"plains": 125, "forest": 100, "mountains": 70}
    for a in speeds:
        for b in speeds:
            mapdef = _line([a, b, "forest"], [0, 0, 1])
            for to_node in (1, 0):
                way = movement_module.leg(mapdef, RULES, 0, to_node)
                start = a if to_node == 1 else b
                end = b if to_node == 1 else a
                from_a = border if to_node == 1 else 1000 - border
                if from_a == 0:
                    assert way.ticks == 3000 // speeds[end]
                if from_a == 1000:
                    assert way.ticks == 3000 // speeds[start]
                steps = [way.progress(k) for k in range(way.ticks + 1)]
                assert steps[0] == 0 and steps[-1] == 1000
                assert all(p < q for p, q in itertools.pairwise(steps))
                assert [way.spent(p) for p in steps] == list(range(way.ticks + 1))
