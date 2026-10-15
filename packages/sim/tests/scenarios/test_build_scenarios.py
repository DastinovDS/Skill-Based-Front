"""Road upgrades by a city (DEC-16, #203; DEC-22, #234) on the map ``fork``: a road grows level by
level to max_width, both sides mirrored.

Map: see ``packages/sim/tests/test_capacity.py``; e1 joins the capital 0 and 2, level 1,
max_width 3; its rot180 mirror is e7 (7 - 5). Rules pinned below: a level 150 ticks after its
command, one command and one payment per level, prices 3 / 4 charges by the new level (pinned;
the rule does not depend on them); roads have no type (DEC-26, item 7); capacities do not change
(DEC-22, item 1). Tick convention: step ``t`` runs with ``state.tick == t``; the
systems run in the fixed order (AGENTS.md, section 4.2), here only the ones this scenario needs:
apply_commands -> capacity -> build.
"""

import dataclasses
from pathlib import Path

from gow_sim.commands import Ok, PlayerCommand, UpgradeRoad, apply_commands
from gow_sim.maps import load_map
from gow_sim.ruleset import BuildRules, LevelTable, Ruleset, load_ruleset
from gow_sim.state import Event, GameState, initial_state
from gow_sim.systems.build import build
from gow_sim.systems.capacity import capacity, node_capacities

TESTS_DIR = Path(__file__).resolve().parents[1]
MVP0 = TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml"

RULES: Ruleset = dataclasses.replace(
    load_ruleset(MVP0),
    build=BuildRules(ticks_per_level=150, charges_per_level=LevelTable((3, 4))),
)

CITY = {0: 0, 1: 7}
"""The builder cities: the capitals 0 and 7."""
EDGE = {0: 1, 1: 7}
"""The road each player builds: e1 (0 - 2) and its mirror e7 (7 - 5)."""


def _step(state: GameState, commands: list[PlayerCommand]) -> list[Event]:
    state.tick += 1
    results, events = apply_commands(state, RULES, commands)
    assert all(isinstance(r.outcome, Ok) for r in results)
    events += capacity(state, RULES)
    events += build(state, RULES)
    return events


def _int(e: Event, key: str) -> int:
    value = e.get(key)
    assert isinstance(value, int)
    return value


def test_road_grows_by_the_ruleset_and_stops_at_max_width() -> None:
    state = initial_state(load_map(TESTS_DIR / "maps" / "fork.json"), RULES)
    for p in (0, 1):
        state.nodes[CITY[p]].warehouse = 7  # 3 + 4: the whole road from 1 to 3
    widths: dict[int, list[tuple[int, int]]] = {0: [], 1: []}
    stopped: list[tuple[int, int]] = []
    capacities = node_capacities(state, RULES)
    for t in range(1, 1001):
        start = [
            PlayerCommand(p, t, UpgradeRoad(CITY[p], EDGE[p]))
            for p in (0, 1)
            if state.nodes[CITY[p]].build is None and state.edges[EDGE[p]].width < 3
        ]
        events = _step(state, start)
        for e in events:
            if e.kind == "road_upgraded":
                widths[_int(e, "player")].append((e.tick, _int(e, "width")))
            elif e.kind == "build_stopped":
                stopped.append((e.tick, _int(e, "player")))
        # Mirror symmetry: both roads always have the same level.
        assert state.edges[EDGE[0]].width == state.edges[EDGE[1]].width
    # A command applied at tick t gives +1 at t + 150; the city is free again after the build
    # system of that tick, so the next command applies at t + 151.
    assert widths[0] == [(151, 2), (302, 3)]
    assert widths[1] == widths[0]
    assert stopped == []
    assert state.nodes[CITY[0]].warehouse == state.nodes[CITY[1]].warehouse == 0
    assert state.edges[EDGE[0]].width == 3  # nothing after max_width, up to tick 1000
    assert node_capacities(state, RULES) == capacities  # roads do not change capacity
