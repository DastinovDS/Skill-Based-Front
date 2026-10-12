"""Road types, fixed capacity by node kind, a 15 minute match (DEC-22, #234).

Table tests of exactly the 15 worked examples of DEC-22 (mechanics.md, section 8). Expected
values come from the decision, not from the code:

- capacity by node kind ``capacity.by_kind``: capital 10, large 8, medium 6, small 4, province 3;
- road parameters (item 4): level 1 ``speed_pct`` 100 and ``amount`` 1; fast level 2 / 3: speed
  150 / 200, amount 1; freight level 2 / 3: speed 100, amount 2 / 3;
  ``packet_ticks = max(1, travel_ticks * 100 // speed_pct)``;
- prices (item 6): level 2 costs 3 charges, level 3 costs 4; ``ticks_per_level`` 150;
- ``match_ticks = 9000``, VP every 300 ticks: 30 accruals.

These numbers are pinned in ``RULES``, so balance changes of ``mvp-0.toml`` do not break the rule
tests (``test_ruleset.py`` checks that mvp-0 carries them now).

Map ``dec22`` (rot180): K = 0 (capital of 0) -e0- A = 1 -e1- B = 2 (medium cities, B starts
neutral, the tests give it to player 0); P = 3 a neutral province at A (e2); B -e3- 5 (a medium
city the tests give to player 1); the mirror half 7 (capital of 1) -e4- 6 -e5- 5, 6 -e6- 4.
Roads ``travel_ticks`` 30 (e3: 60), ``max_width`` 3.
"""

import dataclasses
from pathlib import Path

import pytest

from gow_sim.commands import Ok, PlayerCommand, Reject, RejectCode, UpgradeRoad, apply_commands
from gow_sim.maps import load_map
from gow_sim.ruleset import (
    BuildRules,
    KindTable,
    LevelTable,
    Ruleset,
    VictoryRules,
    load_ruleset,
)
from gow_sim.state import AtNode, Event, GameState, Group, Mode, Packet, RoadKind, initial_state
from gow_sim.systems.build import build
from gow_sim.systems.capacity import change_owner, city_capacity
from gow_sim.systems.supply import edge_packet_ticks, supply
from gow_sim.systems.victory import EndReason, outcome, victory

TESTS_DIR = Path(__file__).resolve().parent
MVP0 = TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml"


def _rules() -> Ruleset:
    base = load_ruleset(MVP0)
    return dataclasses.replace(
        base,
        match_ticks=9000,
        capacity=dataclasses.replace(
            base.capacity,
            by_kind=KindTable(capital=10, city_large=8, city_medium=6, city_small=4, province=3),
        ),
        supply=dataclasses.replace(
            base.supply,
            dispatch_ticks=10,
            buffer=2,
            base_speed_pct=100,
            base_amount=1,
            fast_speed_pct=LevelTable((150, 200)),
            freight_amount=LevelTable((2, 3)),
        ),
        build=BuildRules(ticks_per_level=150, charges_per_level=LevelTable((3, 4))),
        orders=dataclasses.replace(
            base.orders, cost=dataclasses.replace(base.orders.cost, build=0)
        ),
        victory=VictoryRules(vp_period_ticks=300, capital_multiplier=3),
    )


RULES = _rules()

K, A, B, P, ENEMY = 0, 1, 2, 3, 5
KA, AB, AP = 0, 1, 2


def _state(level: int = 1, kind: RoadKind = RoadKind.NONE, warehouse: int = 0) -> GameState:
    state = initial_state(load_map(TESTS_DIR / "maps" / "dec22.json"), RULES)
    state.nodes[B].owner, state.nodes[ENEMY].owner = 0, 1
    state.edges[AB].width = level
    state.edges[AB].kind = kind
    state.nodes[A].warehouse = warehouse
    return state


def _cmd(state: GameState, cmd: UpgradeRoad) -> Ok | Reject:
    results, _ = apply_commands(state, RULES, [PlayerCommand(0, 0, cmd)])
    return results[0].outcome


def _build_until(state: GameState, tick: int) -> list[Event]:
    events: list[Event] = []
    while state.tick < tick:
        state.tick += 1
        events += build(state, RULES)
    return events


def _supply_until(state: GameState, tick: int) -> list[Event]:
    events: list[Event] = []
    while state.tick < tick:
        state.tick += 1
        events += supply(state, RULES)
    return events


def _packet(state: GameState, charges: int = 2, depart: int = 100) -> int:
    """A packet of player 0 from A to B on A-B, sent at ``depart`` (state at ``depart``)."""
    state.tick = depart
    pid = state.new_id()
    state.packets[pid] = Packet(
        id=pid,
        owner=0,
        edge=AB,
        from_node=A,
        charges=charges,
        depart_tick=depart,
        arrive_tick=depart + edge_packet_ticks(state, RULES, AB),
    )
    return pid


def _of(events: list[Event], *kinds: str) -> list[tuple[str, dict[str, object]]]:
    return [(e.kind, dict(e.data)) for e in events if e.kind in kinds]


# 1, 2: capacity by node kind -------------------------------------------------------------------


@pytest.mark.parametrize("case", ["own", "cut_off", "neutral", "roads"])
def test_dec22_example_1_medium_city_capacity_is_6(case: str) -> None:
    state = _state()
    match case:
        case "cut_off":
            state.nodes[K].owner = 1  # A and B lose the way to their capital
        case "neutral":
            state.nodes[A].owner = None
        case "roads":
            for eid, kind in ((KA, RoadKind.FAST), (AB, RoadKind.FREIGHT)):
                state.edges[eid].width, state.edges[eid].kind = 3, kind
        case _:
            pass
    assert city_capacity(state, RULES, A) == 6
    assert city_capacity(state, RULES, B) == 6


def test_dec22_example_2_capital_capacity_is_10() -> None:
    state = _state()
    assert city_capacity(state, RULES, K) == 10
    assert city_capacity(state, RULES, P) == 3  # and a province: 3 (DEC-22, item 1)


# 3-8, 13, 14: UpgradeRoad(node, edge, kind) ----------------------------------------------------


def test_dec22_example_3_first_upgrade_chooses_fast() -> None:
    state = _state(warehouse=5)
    state.tick = 100
    results, events = apply_commands(
        state, RULES, [PlayerCommand(0, 0, UpgradeRoad(A, AB, RoadKind.FAST))]
    )
    assert results[0].outcome == Ok(cost=0)
    assert state.nodes[A].warehouse == 2
    assert _of(events, "build_started") == [
        (
            "build_started",
            {"player": 0, "node": A, "edge": AB, "width": 2, "road": "fast", "charges": 3},
        )
    ]
    assert _build_until(state, 249) == []
    assert (state.edges[AB].width, state.edges[AB].kind) == (1, RoadKind.NONE)
    events = _build_until(state, 250)
    assert _of(events, "road_upgraded") == [
        ("road_upgraded", {"player": 0, "node": A, "edge": AB, "width": 2, "road": "fast"})
    ]
    assert (state.edges[AB].width, state.edges[AB].kind) == (2, RoadKind.FAST)
    assert edge_packet_ticks(state, RULES, AB) == 20  # 30 * 100 // 150


def test_dec22_example_4_first_upgrade_needs_a_type() -> None:
    state = _state(warehouse=5)
    assert _cmd(state, UpgradeRoad(A, AB)) == Reject(RejectCode.INVALID_ARGUMENT)
    assert _cmd(state, UpgradeRoad(A, AB, RoadKind.NONE)) == Reject(RejectCode.INVALID_ARGUMENT)
    assert state.nodes[A].warehouse == 5 and state.nodes[A].build is None


def test_dec22_example_5_second_upgrade_keeps_the_type() -> None:
    state = _state(level=2, kind=RoadKind.FAST, warehouse=5)
    assert _cmd(state, UpgradeRoad(A, AB, RoadKind.FREIGHT)) == Reject(
        RejectCode.ROAD_KIND_MISMATCH
    )


def test_dec22_example_6_second_upgrade_of_a_fast_road() -> None:
    state = _state(level=2, kind=RoadKind.FAST, warehouse=4)
    state.tick = 100
    assert _cmd(state, UpgradeRoad(A, AB)) == Ok(cost=0)
    assert state.nodes[A].warehouse == 0
    _build_until(state, 250)
    assert (state.edges[AB].width, state.edges[AB].kind) == (3, RoadKind.FAST)
    assert edge_packet_ticks(state, RULES, AB) == 15  # 30 * 100 // 200


def test_dec22_example_6_the_own_type_may_be_named() -> None:
    state = _state(level=2, kind=RoadKind.FAST, warehouse=4)
    assert _cmd(state, UpgradeRoad(A, AB, RoadKind.FAST)) == Ok(cost=0)


def test_dec22_example_7_level_3_is_the_last() -> None:
    state = _state(level=3, kind=RoadKind.FAST, warehouse=5)
    assert _cmd(state, UpgradeRoad(A, AB)) == Reject(RejectCode.MAX_WIDTH)


def test_dec22_example_8_a_province_does_not_build() -> None:
    state = _state()
    state.nodes[P].owner = 0
    assert _cmd(state, UpgradeRoad(P, AP, RoadKind.FAST)) == Reject(RejectCode.NOT_CITY)


def test_dec22_example_13_freight_level_3_is_the_last() -> None:
    state = _state(level=3, kind=RoadKind.FREIGHT, warehouse=3)
    assert _cmd(state, UpgradeRoad(A, AB)) == Reject(RejectCode.MAX_WIDTH)


def test_dec22_example_14_level_3_costs_4() -> None:
    state = _state(level=2, kind=RoadKind.FAST, warehouse=3)
    assert _cmd(state, UpgradeRoad(A, AB)) == Reject(RejectCode.NOT_ENOUGH_CHARGES)


def test_dec22_check_order() -> None:
    """DEC-22, item 3: NOT_CITY after NOT_OWNER; the type checks after MAX_WIDTH, before the
    DEC-16 checks that follow it (here: NOT_ENOUGH_CHARGES)."""
    state = _state(warehouse=0)
    state.nodes[P].owner = 1
    assert _cmd(state, UpgradeRoad(P, AP, RoadKind.FAST)) == Reject(RejectCode.NOT_OWNER)
    state.nodes[P].owner = 0
    assert _cmd(state, UpgradeRoad(P, 99, RoadKind.FAST)) == Reject(RejectCode.NOT_CITY)
    assert _cmd(state, UpgradeRoad(A, AB)) == Reject(RejectCode.INVALID_ARGUMENT)
    state.edges[AB].width, state.edges[AB].kind = 2, RoadKind.FAST
    assert _cmd(state, UpgradeRoad(A, AB, RoadKind.FREIGHT)) == Reject(
        RejectCode.ROAD_KIND_MISMATCH
    )
    assert _cmd(state, UpgradeRoad(A, AB)) == Reject(RejectCode.NOT_ENOUGH_CHARGES)


# 9-12: supply on typed roads -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("level", "kind", "sent"), [(1, RoadKind.NONE, 1), (2, RoadKind.FREIGHT, 2)]
)
def test_dec22_example_9_freight_road_sends_2_per_period(
    level: int, kind: RoadKind, sent: int
) -> None:
    state = _state(level=level, kind=kind, warehouse=6)
    gid = state.new_id()  # 3 discharged units in B: B needs 5, more than the road carries
    state.groups[gid] = Group(gid, 0, 3, 0, Mode.ATTACK, AtNode(B))
    events = _supply_until(state, 10)
    sent_ab = [e for e in events if e.kind == "packet_sent" and e.get("edge") == AB]
    assert [e.get("charges") for e in sent_ab] == [sent]


def test_dec22_example_10_captured_target_of_a_freight_packet() -> None:
    state = _state(level=2, kind=RoadKind.FREIGHT)
    pid = _packet(state, charges=2, depart=100)
    assert state.packets[pid].arrive_tick == 130  # freight: speed 100
    assert _supply_until(state, 110) == []
    change_owner(state, B, 1)  # B captured before the packet arrives
    events = _supply_until(state, 129)
    assert pid in state.packets and _of(events, "packet_lost", "packet_captured") == []
    events = _supply_until(state, 130)
    assert _of(events, "packet_captured", "packet_lost") == [
        ("packet_captured", {"player": 1, "node": B, "charges": 2}),
        ("packet_lost", {"packet": pid, "player": 0, "edge": AB, "charges": 2}),
    ]
    assert pid not in state.packets
    assert (state.nodes[B].owner, state.nodes[B].warehouse) == (1, 2)


@pytest.mark.parametrize(("level", "kind"), [(1, RoadKind.NONE), (2, RoadKind.FAST)])
def test_dec22_example_11_other_roads_lose_the_packet(level: int, kind: RoadKind) -> None:
    state = _state(level=level, kind=kind)
    pid = _packet(state, charges=2, depart=100)
    change_owner(state, B, 1)
    events = _supply_until(state, 101)
    assert _of(events, "packet_lost") == [
        ("packet_lost", {"packet": pid, "player": 0, "edge": AB, "charges": 2})
    ]
    assert pid not in state.packets
    _supply_until(state, 140)
    assert state.nodes[B].warehouse == 0


def test_dec22_example_12_freight_packet_reaches_the_own_end() -> None:
    state = _state(level=2, kind=RoadKind.FREIGHT)
    pid = _packet(state, charges=2, depart=100)
    change_owner(state, A, 1)  # the sending end is captured, B stays own
    events = _supply_until(state, 130)
    assert _of(events, "packet_lost", "packet_captured") == []
    assert _of(events, "packet_delivered") == [
        ("packet_delivered", {"packet": pid, "player": 0, "node": B, "charges": 2})
    ]
    assert state.nodes[B].warehouse == 2


# 15: a 15 minute match ------------------------------------------------------------------------


def test_dec22_example_15_match_ends_at_9000_after_30_accruals() -> None:
    state = _state()
    awards = 0
    for t in range(1, RULES.match_ticks + 1):
        state.tick = t
        awards += sum(
            1 for e in victory(state, RULES) if e.kind == "vp_awarded" and e.get("player") == 0
        )
        if t < 9000:
            assert outcome(state, RULES) is None
    assert awards == 30
    result = outcome(state, RULES)
    assert result is not None and result.reason is EndReason.DRAW  # a symmetric position
