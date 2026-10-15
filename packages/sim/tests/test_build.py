"""Road upgrades by a city (DEC-16, #203; numbers: DEC-22, #234; no road types: DEC-26, #265).

Expected values come from the rules, not from the code:

- road parameters by level, DEC-22, item 4 as DEC-26, item 7 left them: level 1 speed 100,
  level 2 / 3 speed 150 / 200, amount 1 on every level. So the next level gives (``upgrade_gain``,
  DEC-26, item 7): +50 speed from level 1 and from level 2, nothing from level 3;
- only internal roads can be upgraded, buffer roads by nobody (mechanics.md, section 8);
- the build rules and the worked examples of DEC-16 (mechanics.md, section 8) that DEC-22 keeps:
  the table tests ``test_dec16_example_*`` below, with A = 3, B = 4, both own and supplied, A-B =
  e4 of level 1 and ``max_width`` 3, ``ticks_per_level`` 150 and the prices 3 / 4 pinned below
  (the rules do not depend on the prices; the examples with the prices of DEC-26:
  ``test_dec22.py`` and ``test_dec26.py``).

These numbers are pinned in ``RULES`` below. The map ``fork`` (rot180), all roads level 1 and
``max_width`` 3:

    0 (capital of 0) -e0- 1 -e2- 3 -e4- 4 -e5- 5 ...
    0 -e1- 2 -e3- 3;   4 -e6- 6
"""

import dataclasses
from collections.abc import Callable
from pathlib import Path

import pytest

from gow_sim.commands import (
    Ok,
    PlayerCommand,
    Reject,
    RejectCode,
    UpgradeRoad,
    apply_commands,
    validate,
)
from gow_sim.maps import load_map
from gow_sim.ruleset import BuildRules, LevelTable, Ruleset, load_ruleset
from gow_sim.state import (
    AtNode,
    Build,
    Event,
    GameState,
    Group,
    Mode,
    event,
    from_canonical,
    initial_state,
)
from gow_sim.state import to_canonical as state_to_canonical
from gow_sim.systems.build import UpgradeGain, build, upgrade_gain
from gow_sim.systems.capacity import change_owner
from gow_sim.systems.combat import combat

TESTS_DIR = Path(__file__).resolve().parent
MVP0 = TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml"


def _rules() -> Ruleset:
    base = load_ruleset(MVP0)
    return dataclasses.replace(
        base,
        supply=dataclasses.replace(
            base.supply,
            base_speed_pct=100,
            base_amount=1,
            fast_speed_pct=LevelTable((150, 200)),
        ),
        build=BuildRules(ticks_per_level=150, charges_per_level=LevelTable((3, 4))),
    )


RULES = _rules()


def _fork(owned: bool = True) -> GameState:
    state = initial_state(load_map(TESTS_DIR / "maps" / "fork.json"), RULES)
    if owned:
        state.nodes[3].owner = 0
        state.nodes[4].owner = 1
    return state


# upgrade_gain ---------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("level", "expected"),
    [
        (1, UpgradeGain(speed_pct=50)),
        (2, UpgradeGain(speed_pct=50)),
        (3, None),  # max_width: nothing to gain
    ],
)
def test_upgrade_gain_table(level: int, expected: UpgradeGain | None) -> None:
    state = _fork()
    state.edges[1].width = level
    assert upgrade_gain(state, RULES, 1) == expected


def test_upgrade_gain_stops_at_the_edge_max_width() -> None:
    state = _fork()
    state.map = dataclasses.replace(
        state.map,
        edges=tuple(
            dataclasses.replace(e, max_width=2) if e.id == 1 else e for e in state.map.edges
        ),
    )
    state.edges[1].width = 2
    assert upgrade_gain(state, RULES, 1) is None


# DEC-16: the worked examples of mechanics.md, section 8 --------------------------------------
# Owners: 0..5 player 0 (capital 0), 6 and 7 player 1. A = 3, B = 4: A-B = e4 (level 1,
# max_width 3). Supply: 0 -> 1, 2 -> 3 (A) -> 4 (B) -> 5. Other roads used below: e3 (A-2),
# e5 (B-5), e6 (B-6, into the enemy city 6).

A, B = 3, 4
AB = 4
A_OTHER = 3
"""e3 = A-2: «A-C» of example 6 (the fork has no node next to both A and B)."""
B_OTHER = 5
"""e5 = B-5: «B-C» of example 8."""


def _dec16(warehouse: int = 5, width: int = 1) -> GameState:
    state = _fork()
    for n in (4, 5):
        state.nodes[n].owner = 0
    state.nodes[A].warehouse = warehouse
    state.nodes[B].warehouse = 5
    state.edges[AB].width = width
    return state


def _cmd(state: GameState, *cmds: UpgradeRoad) -> tuple[list[Ok | Reject], list[Event]]:
    """Apply ``cmds`` of player 0 at the start of ``state.tick``, in this order."""
    results, events = apply_commands(
        state, RULES, [PlayerCommand(0, seq, c) for seq, c in enumerate(cmds)]
    )
    return [r.outcome for r in results], events


def _until(
    state: GameState, tick: int, before_build: Callable[[GameState], object] | None = None
) -> list[Event]:
    """Run the build system up to ``tick``; ``before_build(state)`` at ``tick`` (combat runs
    before ``build``, AGENTS.md 4.2). Returns the build events."""
    events: list[Event] = []
    while state.tick < tick:
        state.tick += 1
        if state.tick == tick and before_build is not None:
            before_build(state)
        events += build(state, RULES)
    return events


def _kinds(events: list[Event]) -> list[tuple[int, str]]:
    return [(e.tick, e.kind) for e in events]


def _start(state: GameState, tick: int = 100) -> None:
    state.tick = tick
    outcomes, _ = _cmd(state, UpgradeRoad(A, AB))
    assert isinstance(outcomes[0], Ok)


# Examples 1, 3 and 4 with the DEC-22 prices: test_dec22.py, examples 3, 6 and 7.


def test_dec16_example_2_not_enough_charges() -> None:
    state = _dec16(warehouse=1)
    outcomes, events = _cmd(state, UpgradeRoad(A, AB))
    assert outcomes == [Reject(RejectCode.NOT_ENOUGH_CHARGES)]
    assert events == [] and state.nodes[A].warehouse == 1 and state.nodes[A].build is None


@pytest.mark.parametrize("owner", [None, 1])
def test_dec16_example_5_buffer_edge(owner: int | None) -> None:
    state = _dec16()
    state.nodes[5].owner = owner  # e5 = B-5: neutral or enemy N
    assert _cmd(state, UpgradeRoad(B, B_OTHER))[0] == [Reject(RejectCode.NOT_INTERNAL)]
    assert _cmd(state, UpgradeRoad(B, 6))[0] == [Reject(RejectCode.NOT_INTERNAL)]  # enemy


def test_dec16_example_6_city_busy() -> None:
    state = _dec16()
    _start(state)
    assert _cmd(state, UpgradeRoad(A, A_OTHER))[0] == [Reject(RejectCode.CITY_BUSY)]


def test_dec16_example_7_edge_busy() -> None:
    state = _dec16()
    _start(state)
    assert _cmd(state, UpgradeRoad(B, AB))[0] == [Reject(RejectCode.EDGE_BUSY)]


def test_dec16_example_7_same_tick_second_command_is_edge_busy() -> None:
    state = _dec16()
    outcomes, _ = _cmd(state, UpgradeRoad(A, AB), UpgradeRoad(B, AB))
    assert outcomes == [Ok(cost=0), Reject(RejectCode.EDGE_BUSY)]


def test_dec16_example_8_neighbour_roads_build_together() -> None:
    state = _dec16()
    _start(state)
    assert _cmd(state, UpgradeRoad(B, B_OTHER))[0] == [Ok(cost=0)]
    events = _until(state, 250)
    assert _kinds(events) == [(250, "road_upgraded"), (250, "road_upgraded")]
    assert state.edges[AB].width == 2
    assert state.edges[B_OTHER].width == 2


def test_dec16_example_9_other_end_captured() -> None:
    state = _dec16()
    _start(state)
    events = _until(state, 200, lambda s: change_owner(s, B, 1))
    assert _kinds(events) == [(200, "build_stopped")]
    assert events[0].get("reason") == "interrupted"
    assert state.edges[AB].width == 1 and state.nodes[A].warehouse == 2  # nothing returned
    assert _until(state, 400) == [] and state.edges[AB].width == 1


def test_dec16_example_10_capture_in_the_completion_tick() -> None:
    state = _dec16()
    _start(state)
    events = _until(state, 250, lambda s: change_owner(s, A, 1))
    assert _kinds(events) == [(250, "build_stopped")]
    assert state.edges[AB].width == 1 and state.nodes[A].build is None


def test_dec16_example_11_cut_off_after_the_start() -> None:
    state = _dec16()
    _start(state)

    def cut(s: GameState) -> None:
        for n in (1, 2):
            change_owner(s, n, None)

    assert _until(state, 200, cut) == []
    events = _until(state, 250)
    assert _kinds(events) == [(250, "road_upgraded")] and state.edges[AB].width == 2


def test_dec16_example_12_cut_off_city_is_not_supplied() -> None:
    state = _dec16()
    for n in (1, 2):
        state.nodes[n].owner = None
    assert _cmd(state, UpgradeRoad(A, AB))[0] == [Reject(RejectCode.NOT_SUPPLIED)]


def test_dec16_example_13_held_city_keeps_building() -> None:
    state = _dec16()
    _start(state)

    def fight(s: GameState) -> None:
        defender = Group(s.new_id(), 0, 2, 2, Mode.ATTACK, AtNode(A))
        attacker = Group(s.new_id(), 1, 1, 0, Mode.ATTACK, AtNode(A))
        s.groups[defender.id] = defender
        s.groups[attacker.id] = attacker
        # Setup: the attacker has just arrived over A's other edge (a fight needs an arrival).
        other = s.map.edges[A_OTHER].other(A)
        s.events = [
            event(
                s.tick,
                "group_arrived",
                group=attacker.id,
                player=1,
                node=A,
                edge=A_OTHER,
                from_node=other,
                back=False,
                planned=False,
            )
        ]
        fought = combat(s, RULES, {})
        assert any(e.kind == "fight_started" for e in fought) and s.nodes[A].owner == 0

    assert _until(state, 200, fight) == []
    assert _kinds(_until(state, 250)) == [(250, "road_upgraded")]


def test_dec16_example_14_empty_warehouse_keeps_building() -> None:
    state = _dec16(warehouse=3)
    _start(state)
    assert state.nodes[A].warehouse == 0
    assert _kinds(_until(state, 250)) == [(250, "road_upgraded")]


# DEC-16: the order of the checks ---------------------------------------------------------------


def test_dec16_check_order() -> None:
    state = _dec16()
    nodes, edges = len(state.map.nodes), len(state.map.edges)
    code = RejectCode
    cases = [
        (UpgradeRoad(nodes, AB), code.NOT_FOUND_OR_HIDDEN),  # no such node
        (UpgradeRoad(-1, AB), code.NOT_FOUND_OR_HIDDEN),
        (UpgradeRoad(7, edges), code.NOT_OWNER),  # an enemy city comes before the edge check
        (UpgradeRoad(A, edges), code.NOT_FOUND_OR_HIDDEN),  # no such edge
        (UpgradeRoad(A, 0), code.NOT_ADJACENT),  # e0 = 0-1
        (UpgradeRoad(B, 6), code.NOT_INTERNAL),
    ]
    for cmd, expected in cases:
        assert validate(state, RULES, 0, cmd) == Reject(expected), cmd


def test_dec16_cp_is_checked_last() -> None:
    rules = dataclasses.replace(
        RULES,
        orders=dataclasses.replace(
            RULES.orders, cost=dataclasses.replace(RULES.orders.cost, build=100)
        ),
    )
    state = _dec16()
    state.players[0].cp = 99
    cmd = UpgradeRoad(A, AB)
    assert validate(state, rules, 0, cmd) == Reject(RejectCode.NOT_ENOUGH_CP)
    state.nodes[A].warehouse = 1
    assert validate(state, rules, 0, cmd) == Reject(RejectCode.NOT_ENOUGH_CHARGES)
    state.nodes[A].warehouse = 5
    state.players[0].cp = 100
    results, _ = apply_commands(state, rules, [PlayerCommand(0, 1, cmd)])
    assert results[0].outcome == Ok(cost=100) and state.players[0].cp == 0


def test_dec16_build_roundtrips_through_the_canonical_form() -> None:
    state = _dec16()
    _start(state)
    assert state.nodes[A].build == Build(edge=AB, owner=0, since=100)
    assert from_canonical(state_to_canonical(state)) == state
