"""Scenarios of SIM-11 (#27) on the map ``fork``: a road grows to max_width, both sides mirrored.

Map: see ``packages/sim/tests/test_capacity.py``; e1 joins the capital 0 (base 4) and 2 (base 2),
width 1, max_width 5; its rot180 mirror is e7 (7 - 5). Rules pinned below: a level every
150 ticks of building (``rulesets/mvp-0.toml`` ``[build]``), capacity gains by width
+1.0 / +1.5 / +2.0 / +2.3 / +2.6 (mechanics.md, section 9). Tick convention: step ``t`` runs with
``state.tick == t``; the systems run in the fixed order (AGENTS.md, section 4.2), here only the
ones this scenario needs: apply_commands -> capacity -> build.
"""

import dataclasses
from pathlib import Path

from gow_sim.commands import Ok, PlayerCommand, UpgradeRoad, apply_commands
from gow_sim.maps import load_map
from gow_sim.ruleset import BuildRules, CapacityRules, Ruleset, WidthTable, load_ruleset
from gow_sim.state import Event, GameState, Mode, initial_state
from gow_sim.systems.build import build
from gow_sim.systems.capacity import capacity, node_capacities

TESTS_DIR = Path(__file__).resolve().parents[1]
MVP0 = TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml"

RULES: Ruleset = dataclasses.replace(
    load_ruleset(MVP0),
    capacity=CapacityRules(
        attrition_ticks=30, grace_ticks=50, width_gain_centi=WidthTable((100, 150, 200, 230, 260))
    ),
    build=BuildRules(ticks_per_level=150),
)

GROUP = {0: 0, 1: 1}
"""Starting groups: player 0 in its capital 0, player 1 in its capital 7."""
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
    start = [PlayerCommand(p, 1, UpgradeRoad(GROUP[p], EDGE[p])) for p in (0, 1)]
    widths: dict[int, list[tuple[int, int]]] = {0: [], 1: []}
    caps: list[tuple[int, int]] = []
    stopped: list[tuple[int, int]] = []
    assert node_capacities(state, RULES)[0:3:2] == (6, 3)  # 4 + 1.5 + 1.0 = 6.5; 2 + 1.0
    for t in range(1, 1001):
        events = _step(state, start if t == 1 else [])
        for e in events:
            if e.kind == "road_upgraded":
                widths[_int(e, "player")].append((e.tick, _int(e, "width")))
                if e.get("player") == 0:
                    c = node_capacities(state, RULES)
                    caps.append((c[0], c[2]))
            elif e.kind == "build_stopped":
                assert e.get("reason") == "max_width"
                stopped.append((e.tick, _int(e, "player")))
        # Mirror symmetry: both roads always have the same width.
        assert state.edges[EDGE[0]].width == state.edges[EDGE[1]].width
    # UpgradeRoad applied at tick 1: +1 at 1 + 150, then every 150 ticks, up to max_width 5.
    assert widths[0] == [(151, 2), (301, 3), (451, 4), (601, 5)]
    assert widths[1] == widths[0]
    assert stopped == [(601, 0), (601, 1)]
    assert state.edges[EDGE[0]].width == 5  # nothing after max_width, up to tick 1000
    # Capacity after each level (capital 0: 4 + e0 w2 (+1.5) + e1; city 2: 2 + e1; e3 is a
    # buffer into neutral 3):
    #   e1 w2: 4 + 1.5 + 1.5 = 7,   2 + 1.5 = 3
    #   e1 w3: 4 + 1.5 + 2.0 = 7,   2 + 2.0 = 4
    #   e1 w4: 4 + 1.5 + 2.3 = 7,   2 + 2.3 = 4
    #   e1 w5: 4 + 1.5 + 2.6 = 8,   2 + 2.6 = 4
    assert caps == [(7, 3), (7, 4), (7, 4), (8, 4)]
    assert state.groups[GROUP[0]].mode is Mode.BUILD
