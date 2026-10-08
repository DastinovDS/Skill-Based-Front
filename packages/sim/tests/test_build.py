"""Road upgrades by a city (DEC-16, #203; SIM-11 for ``upgrade_gain``).

Expected values come from the rules, not from the code:

- capacity gains by width, mechanics.md, section 9: +1.0 / +1.5 / +2.0 / +2.3 / +2.6, so the next
  level gives +0.5 / +0.5 / +0.3 / +0.3 (in hundredths: 50 / 50 / 30 / 30);
- packet speed by width, ``rulesets/mvp-0.toml`` ``[supply.packet_speed_pct]``:
  100 / 125 / 150 / 175 / 200, so every level gives +25 percentage points;
- only internal roads can be upgraded, buffer roads by nobody (mechanics.md, section 8);
- the build rules and the 14 worked examples of DEC-16 (mechanics.md, section 8): the table tests
  ``test_dec16_example_*`` below, with A = 3, B = 4, both own and supplied, A-B = e4 of width 1
  and ``max_width`` 3, ``ticks_per_level`` 150, prices 2 / 3 / 4 / 5.

These numbers are pinned in ``RULES`` below. The map ``fork`` (rot180), see ``test_capacity.py``:

    0 (capital of 0, base 4) -e0 w2- 1 (base 2) -e2 w2- 3 (base 2) -e4 w1- 4 (base 2) ...
    0 -e1 w1- 2 (base 2) -e3 w3- 3;   all max_width 5
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
from gow_sim.ruleset import (
    BuildRules,
    CapacityRules,
    LevelTable,
    Ruleset,
    WidthTable,
    load_ruleset,
)
from gow_sim.state import (
    AtNode,
    Build,
    Event,
    GameState,
    Group,
    Mode,
    from_canonical,
    initial_state,
)
from gow_sim.state import to_canonical as state_to_canonical
from gow_sim.systems.build import UpgradeGain, build, upgrade_gain
from gow_sim.systems.capacity import change_owner, city_capacity, city_capacity_centi
from gow_sim.systems.combat import combat

TESTS_DIR = Path(__file__).resolve().parent
MVP0 = TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml"


def _rules() -> Ruleset:
    base = load_ruleset(MVP0)
    return dataclasses.replace(
        base,
        capacity=CapacityRules(
            attrition_ticks=30,
            grace_ticks=50,
            width_gain_centi=WidthTable((100, 150, 200, 230, 260)),
        ),
        supply=dataclasses.replace(
            base.supply, packet_speed_pct=WidthTable((100, 125, 150, 175, 200))
        ),
        build=BuildRules(ticks_per_level=150, charges_per_level=LevelTable((2, 3, 4, 5))),
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
    ("width", "expected"),
    [
        (1, UpgradeGain(capacity_centi=50, packet_speed_pct=25)),  # +1.0 -> +1.5
        (2, UpgradeGain(capacity_centi=50, packet_speed_pct=25)),  # +1.5 -> +2.0
        (3, UpgradeGain(capacity_centi=30, packet_speed_pct=25)),  # +2.0 -> +2.3
        (4, UpgradeGain(capacity_centi=30, packet_speed_pct=25)),  # +2.3 -> +2.6
        (5, None),  # max_width: nothing to gain
    ],
)
def test_upgrade_gain_table(width: int, expected: UpgradeGain | None) -> None:
    state = _fork()
    state.edges[1].width = width
    assert upgrade_gain(state, RULES, 1) == expected


def test_upgrade_gain_stops_at_the_edge_max_width() -> None:
    state = _fork()
    state.map = dataclasses.replace(
        state.map,
        edges=tuple(
            dataclasses.replace(e, max_width=3) if e.id == 1 else e for e in state.map.edges
        ),
    )
    state.edges[1].width = 3
    assert upgrade_gain(state, RULES, 1) is None


@pytest.mark.parametrize("edge", [0, 1, 2, 3])
@pytest.mark.parametrize("width", [1, 2, 3, 4])
def test_upgrade_gain_equals_the_capacity_difference(edge: int, width: int) -> None:
    state = _fork()
    state.edges[edge].width = width
    gain = upgrade_gain(state, RULES, edge)
    assert gain is not None
    ends = (state.map.edges[edge].a, state.map.edges[edge].b)
    before = [city_capacity_centi(state, RULES, n) for n in ends]
    state.edges[edge].width += 1
    after = [city_capacity_centi(state, RULES, n) for n in ends]
    assert [a - b for a, b in zip(after, before, strict=True)] == [gain.capacity_centi] * 2


def test_capacity_rounds_the_upgraded_sum_down() -> None:
    state = _fork()
    # City 3: 2 + e2 (w2, +1.5) + e3 (w3, +2.0) = 5.5 -> 5; e2 to w3: 2 + 2.0 + 2.0 = 6.
    assert (city_capacity_centi(state, RULES, 3), city_capacity(state, RULES, 3)) == (550, 5)
    state.edges[2].width = 3
    assert (city_capacity_centi(state, RULES, 3), city_capacity(state, RULES, 3)) == (600, 6)


# DEC-16: the worked examples of mechanics.md, section 8 --------------------------------------
# Owners: 0..5 player 0 (capital 0), 6 and 7 player 1. A = 3, B = 4: A-B = e4 (width 1, set to
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
    state.map = dataclasses.replace(
        state.map,
        edges=tuple(
            dataclasses.replace(e, max_width=3) if e.id == AB else e for e in state.map.edges
        ),
    )
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


def test_dec16_example_1_level_after_ticks_per_level() -> None:
    state = _dec16(warehouse=5)
    state.tick = 100
    outcomes, events = _cmd(state, UpgradeRoad(A, AB))
    assert outcomes == [Ok(cost=0)]
    assert state.nodes[A].warehouse == 3
    assert [(e.kind, dict(e.data)) for e in events] == [
        ("build_started", {"player": 0, "node": A, "edge": AB, "width": 2, "charges": 2})
    ]
    events = _until(state, 249)
    assert events == [] and state.edges[AB].width == 1
    events = _until(state, 250)
    assert _kinds(events) == [(250, "road_upgraded")]
    assert dict(events[0].data) == {"player": 0, "node": A, "edge": AB, "width": 2}
    assert state.edges[AB].width == 2
    assert state.nodes[A].build is None


def test_dec16_example_2_not_enough_charges() -> None:
    state = _dec16(warehouse=1)
    outcomes, events = _cmd(state, UpgradeRoad(A, AB))
    assert outcomes == [Reject(RejectCode.NOT_ENOUGH_CHARGES)]
    assert events == [] and state.nodes[A].warehouse == 1 and state.nodes[A].build is None


def test_dec16_example_3_level_3_costs_3() -> None:
    state = _dec16(warehouse=3, width=2)
    _start(state)
    assert state.nodes[A].warehouse == 0
    _until(state, 250)
    assert state.edges[AB].width == 3


def test_dec16_example_4_max_width() -> None:
    state = _dec16(width=3)
    assert _cmd(state, UpgradeRoad(A, AB))[0] == [Reject(RejectCode.MAX_WIDTH)]


@pytest.mark.parametrize("owner", [None, 1])
def test_dec16_example_5_buffer_edge(owner: int | None) -> None:
    state = _dec16()
    state.nodes[5].owner = owner  # e5 = B-5: neutral or enemy N
    assert _cmd(state, UpgradeRoad(B, B_OTHER))[0] == [Reject(RejectCode.NOT_INTERNAL)]
    assert _cmd(state, UpgradeRoad(B, 6))[0] == [Reject(RejectCode.NOT_INTERNAL)]  # enemy 6


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
    assert (state.edges[AB].width, state.edges[B_OTHER].width) == (2, 4)


def test_dec16_example_9_other_end_captured() -> None:
    state = _dec16()
    _start(state)
    events = _until(state, 200, lambda s: change_owner(s, B, 1))
    assert _kinds(events) == [(200, "build_stopped")]
    assert events[0].get("reason") == "interrupted"
    assert state.edges[AB].width == 1 and state.nodes[A].warehouse == 3  # nothing returned
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
        fought = combat(s, RULES, {})
        assert any(e.kind == "fight" for e in fought) and s.nodes[A].owner == 0

    assert _until(state, 200, fight) == []
    assert _kinds(_until(state, 250)) == [(250, "road_upgraded")]


def test_dec16_example_14_empty_warehouse_keeps_building() -> None:
    state = _dec16(warehouse=2)
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
    assert validate(state, rules, 0, UpgradeRoad(A, AB)) == Reject(RejectCode.NOT_ENOUGH_CP)
    state.nodes[A].warehouse = 1
    assert validate(state, rules, 0, UpgradeRoad(A, AB)) == Reject(RejectCode.NOT_ENOUGH_CHARGES)
    state.nodes[A].warehouse = 5
    state.players[0].cp = 100
    results, _ = apply_commands(state, rules, [PlayerCommand(0, 1, UpgradeRoad(A, AB))])
    assert results[0].outcome == Ok(cost=100) and state.players[0].cp == 0


def test_dec16_build_roundtrips_through_the_canonical_form() -> None:
    state = _dec16()
    _start(state)
    assert state.nodes[A].build == Build(edge=AB, owner=0, since=100)
    assert from_canonical(state_to_canonical(state)) == state
