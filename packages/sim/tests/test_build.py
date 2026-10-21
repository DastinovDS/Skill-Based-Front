"""Road upgrades (DEC-16, #203; numbers: DEC-22, #234; no road types: DEC-26, #265; paid with CP
on the edge, no city: DEC-28, #290, item 7, implementation #306).

Expected values come from the rules, not from the code:

- road parameters by level: packet speed 100 / 150 / 200 (DEC-22, item 4; DEC-26, item 7), unit
  speed 100 / 115 / 130 and throughput 1 / 2 / 3 (DEC-28, item 7). So the next level gives
  (``upgrade_gain``): +50 packet speed, +15 unit speed and +1 charge from level 1 and from level
  2, nothing from level 3;
- only internal roads can be upgraded, buffer roads by nobody (mechanics.md, section 8);
- the build rules of DEC-16 that DEC-28, item 7 keeps (one level per command, no queue, no cancel,
  a capture of either end interrupts, nothing else does) and the checks of DEC-28, item 7 in their
  order: ``NOT_FOUND_OR_HIDDEN``, ``NOT_INTERNAL``, ``MAX_WIDTH``, ``EDGE_BUSY``,
  ``NOT_ENOUGH_CP``; no ``NOT_SUPPLIED``, no ``CITY_BUSY``, any number of builds at a time. The
  table tests ``test_dec16_example_*`` follow the worked examples of DEC-16 with A = 3, B = 4,
  both own, A-B = e4 of level 1 and ``max_width`` 3, ``ticks_per_level`` 150 and
  ``orders.cost.build`` 50 (DEC-28, item 7).

The map ``fork`` (rot180), all roads level 1 and ``max_width`` 3:

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
from gow_sim.ruleset import LevelTable, Ruleset, load_ruleset
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
    assert base.orders.cost.build == 50 and base.build.ticks_per_level == 150
    assert base.supply.amount_by_level.values == (1, 2, 3)
    assert base.road.speed_pct.values == (115, 130)
    return dataclasses.replace(
        base,
        supply=dataclasses.replace(
            base.supply, base_speed_pct=100, fast_speed_pct=LevelTable((150, 200))
        ),
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
        (1, UpgradeGain(speed_pct=50, unit_speed_pct=15, amount=1)),
        (2, UpgradeGain(speed_pct=50, unit_speed_pct=15, amount=1)),
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


# DEC-16: the worked examples of mechanics.md, section 8, under DEC-28, item 7 ------------------
# Owners: 0..5 player 0 (capital 0), 6 and 7 player 1. A = 3, B = 4: A-B = e4 (level 1,
# max_width 3). Other roads used below: e3 (A-2), e5 (B-5), e6 (B-6, into the enemy city 6).

A, B = 3, 4
AB = 4
A_OTHER = 3
"""e3 = A-2: «A-C» of example 6 (the fork has no node next to both A and B)."""
B_OTHER = 5
"""e5 = B-5: «B-C» of example 8."""
PRICE = 50
"""``orders.cost.build``: 0,5 CP per level (DEC-28, item 7)."""


def _dec16(width: int = 1) -> GameState:
    state = _fork()
    for n in (4, 5):
        state.nodes[n].owner = 0
    state.nodes[A].warehouse = 5
    state.nodes[B].warehouse = 5
    state.edges[AB].width = width
    state.players[0].cp = 300
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
    outcomes, _ = _cmd(state, UpgradeRoad(AB))
    assert outcomes == [Ok(cost=PRICE)]


def test_dec16_example_1_paid_with_cp_warehouse_untouched() -> None:
    state = _dec16()
    state.tick = 100
    outcomes, events = _cmd(state, UpgradeRoad(AB))
    assert outcomes == [Ok(cost=PRICE)] and state.players[0].cp == 300 - PRICE
    assert _kinds(events) == [(100, "build_started")]
    assert dict(events[0].data) == {"player": 0, "kind": "road", "edge": AB, "width": 2}
    assert state.nodes[A].warehouse == 5 and state.nodes[B].warehouse == 5  # no charges
    assert state.nodes[A].build is None and state.nodes[B].build is None  # no city builds
    assert _until(state, 249) == [] and state.edges[AB].width == 1
    events = _until(state, 250)
    assert _kinds(events) == [(250, "road_upgraded")] and state.edges[AB].width == 2
    assert dict(events[0].data) == {"player": 0, "edge": AB, "width": 2}
    assert state.edges[AB].build is None


def test_dec16_example_2_not_enough_cp() -> None:
    state = _dec16()
    state.players[0].cp = PRICE - 1
    outcomes, events = _cmd(state, UpgradeRoad(AB))
    assert outcomes == [Reject(RejectCode.NOT_ENOUGH_CP)]
    assert events == [] and state.edges[AB].build is None and state.players[0].cp == PRICE - 1


@pytest.mark.parametrize("owner", [None, 1])
def test_dec16_example_5_buffer_edge(owner: int | None) -> None:
    state = _dec16()
    state.nodes[5].owner = owner  # e5 = B-5: neutral or enemy N
    assert _cmd(state, UpgradeRoad(B_OTHER))[0] == [Reject(RejectCode.NOT_INTERNAL)]
    assert _cmd(state, UpgradeRoad(6))[0] == [Reject(RejectCode.NOT_INTERNAL)]  # enemy


def test_dec16_example_6_no_city_busy_two_roads_at_one_city() -> None:
    state = _dec16()
    _start(state)
    assert _cmd(state, UpgradeRoad(A_OTHER))[0] == [Ok(cost=PRICE)]
    assert _kinds(_until(state, 250)) == [(250, "road_upgraded"), (250, "road_upgraded")]


def test_dec16_example_7_edge_busy() -> None:
    state = _dec16()
    _start(state)
    assert _cmd(state, UpgradeRoad(AB))[0] == [Reject(RejectCode.EDGE_BUSY)]


def test_dec16_example_7_same_tick_second_command_is_edge_busy() -> None:
    state = _dec16()
    outcomes, _ = _cmd(state, UpgradeRoad(AB), UpgradeRoad(AB))
    assert outcomes == [Ok(cost=PRICE), Reject(RejectCode.EDGE_BUSY)]
    assert state.players[0].cp == 300 - PRICE


def test_dec16_example_8_neighbour_roads_build_together() -> None:
    state = _dec16()
    _start(state)
    assert _cmd(state, UpgradeRoad(B_OTHER))[0] == [Ok(cost=PRICE)]
    events = _until(state, 250)
    assert _kinds(events) == [(250, "road_upgraded"), (250, "road_upgraded")]
    assert state.edges[AB].width == 2
    assert state.edges[B_OTHER].width == 2


def test_dec16_example_9_other_end_captured() -> None:
    state = _dec16()
    _start(state)
    events = _until(state, 200, lambda s: change_owner(s, B, 1))
    assert _kinds(events) == [(200, "build_stopped")]
    assert dict(events[0].data) == {
        "player": 0,
        "kind": "road",
        "edge": AB,
        "reason": "interrupted",
    }
    assert state.edges[AB].width == 1 and state.players[0].cp == 300 - PRICE  # no refund
    assert _until(state, 400) == [] and state.edges[AB].width == 1


def test_dec16_example_10_capture_in_the_completion_tick() -> None:
    state = _dec16()
    _start(state)
    events = _until(state, 250, lambda s: change_owner(s, A, 1))
    assert _kinds(events) == [(250, "build_stopped")]
    assert state.edges[AB].width == 1 and state.edges[AB].build is None


def test_dec16_example_11_cut_off_after_the_start() -> None:
    state = _dec16()
    _start(state)

    def cut(s: GameState) -> None:
        for n in (1, 2):
            change_owner(s, n, None)

    assert _until(state, 200, cut) == []
    events = _until(state, 250)
    assert _kinds(events) == [(250, "road_upgraded")] and state.edges[AB].width == 2


def test_dec16_example_12_cut_off_road_is_built_too() -> None:
    """DEC-28, item 7: no ``NOT_SUPPLIED`` for a road (no city pays)."""
    state = _dec16()
    for n in (1, 2):
        state.nodes[n].owner = None
    assert _cmd(state, UpgradeRoad(AB))[0] == [Ok(cost=PRICE)]


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
                level=1,
            )
        ]
        fought = combat(s, RULES, {})
        assert any(e.kind == "fight_started" for e in fought) and s.nodes[A].owner == 0

    assert _until(state, 200, fight) == []
    assert _kinds(_until(state, 250)) == [(250, "road_upgraded")]


# DEC-28, item 7: the order of the checks -------------------------------------------------------


def test_dec28_check_order() -> None:
    state = _dec16()
    edges = len(state.map.edges)
    code = RejectCode
    far = 8  # e8 = 7-6: a road of player 1 in the fog of player 0
    assert state.nodes[6].owner == 1 == state.nodes[7].owner
    cases = [
        (UpgradeRoad(edges), code.NOT_FOUND_OR_HIDDEN),  # no such edge
        (UpgradeRoad(-1), code.NOT_FOUND_OR_HIDDEN),
        (UpgradeRoad(far), code.NOT_FOUND_OR_HIDDEN),  # in fog: the same answer
        (UpgradeRoad(6), code.NOT_INTERNAL),  # B-6: a buffer road (6 is the enemy's)
    ]
    for cmd, expected in cases:
        assert validate(state, RULES, 0, cmd) == Reject(expected), cmd
    state.edges[AB].width = 3
    assert validate(state, RULES, 0, UpgradeRoad(AB)) == Reject(code.MAX_WIDTH)
    state.edges[AB].width = 2
    state.edges[AB].build = Build(edge=AB, owner=0, since=1)
    assert validate(state, RULES, 0, UpgradeRoad(AB)) == Reject(code.EDGE_BUSY)
    state.edges[AB].build = None
    state.players[0].cp = PRICE - 1
    assert validate(state, RULES, 0, UpgradeRoad(AB)) == Reject(code.NOT_ENOUGH_CP)  # last
    state.players[0].cp = PRICE
    assert isinstance(validate(state, RULES, 0, UpgradeRoad(AB)), Ok)


def test_dec28_a_seen_enemy_road_is_not_internal_for_the_player() -> None:
    state = _dec16()
    scout = Group(state.new_id(), 0, 1, 1, Mode.ATTACK, AtNode(6))  # sees e8 = 7-6
    state.groups[scout.id] = scout
    assert validate(state, RULES, 0, UpgradeRoad(8)) == Reject(RejectCode.NOT_INTERNAL)


def test_dec16_build_roundtrips_through_the_canonical_form() -> None:
    state = _dec16()
    _start(state)
    assert state.edges[AB].build == Build(edge=AB, owner=0, since=100)
    assert from_canonical(state_to_canonical(state)) == state
