"""Road levels, fixed capacity by node kind, a 15 minute match (DEC-22, #234; DEC-26, #265).

Table tests of exactly the 15 worked examples of DEC-22 (mechanics.md, section 8) as DEC-26
recounted them (no road types) and DEC-28 after them (roads paid with CP, throughput by level;
example 4 is gone: the command has no type). Expected values come from the decision, not from
the code:

- capacity by node kind ``capacity.by_kind``: capital 10, large 8, medium 6, small 4, province 3;
- road parameters (item 4, DEC-26, item 7, DEC-28, item 7): level 1 ``speed_pct`` 100, level 2 / 3
  speed 150 / 200, ``amount`` 1 / 2 / 3 by level; ``packet_ticks = max(1, travel_ticks * 100 //
  speed_pct)``;
- price (DEC-28, item 7): 0,5 CP per level (``orders.cost.build`` 50); ``ticks_per_level`` 150;
- ``match_ticks = 9000``, VP every 300 ticks: 30 accruals.

These numbers are pinned in ``RULES``, so balance changes of ``mvp-0.toml`` do not break the rule
tests (``test_ruleset.py`` checks that mvp-0 carries them now).

Map ``dec22`` (rot180): K = 0 (capital of 0) -e0- A = 1 -e1- B = 2 (medium cities, B starts
neutral, the tests give it to player 0); P = 3 a neutral province at A (e2); B -e3- 5 (a medium
city the tests give to player 1); the mirror half 7 (capital of 1) -e4- 6 -e5- 5, 6 -e6- 4.
Roads ``travel_ticks`` 30 (e3: 60), ``max_level`` 3.
"""

import dataclasses
from pathlib import Path

import pytest

from gow_sim.commands import Ok, PlayerCommand, Reject, RejectCode, UpgradeRoad, apply_commands
from gow_sim.maps import load_map
from gow_sim.ruleset import (
    BuildRules,
    FullLevelTable,
    KindTable,
    LevelTable,
    Ruleset,
    VictoryRules,
    load_ruleset,
)
from gow_sim.state import Event, GameState, Packet, initial_state
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
            base_speed_pct=100,
            fast_speed_pct=LevelTable((150, 200)),
            amount_by_level=FullLevelTable((1, 2, 3)),
        ),
        build=BuildRules(ticks_per_level=150),
        orders=dataclasses.replace(
            base.orders, cost=dataclasses.replace(base.orders.cost, build=50)
        ),
        victory=VictoryRules(vp_period_ticks=300, capital_multiplier=3),
    )


RULES = _rules()

K, A, B, P, ENEMY = 0, 1, 2, 3, 5
KA, AB, AP = 0, 1, 2
PRICE = 50
"""``orders.cost.build``: 0,5 CP per level (DEC-28, item 7)."""


def _state(level: int = 1, warehouse: int = 0) -> GameState:
    state = initial_state(load_map(TESTS_DIR / "maps" / "dec22.json"), RULES)
    state.nodes[B].owner, state.nodes[ENEMY].owner = 0, 1
    state.edges[AB].width = level
    state.nodes[A].warehouse = warehouse
    state.players[0].cp = 100
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
            for eid in (KA, AB):
                state.edges[eid].width = 3
        case _:
            pass
    assert city_capacity(state, RULES, A) == 6
    assert city_capacity(state, RULES, B) == 6


def test_dec22_example_2_capital_capacity_is_10() -> None:
    state = _state()
    assert city_capacity(state, RULES, K) == 10
    assert city_capacity(state, RULES, P) == 3  # and a province: 3 (DEC-22, item 1)


# 3-8, 12-14: UpgradeRoad(edge) (recounted by DEC-28, item 7: paid with CP, no city) ----------


def test_dec22_example_3_first_upgrade() -> None:
    state = _state(warehouse=5)
    state.tick = 100
    results, events = apply_commands(state, RULES, [PlayerCommand(0, 0, UpgradeRoad(AB))])
    assert results[0].outcome == Ok(cost=PRICE)
    assert state.players[0].cp == 100 - PRICE and state.nodes[A].warehouse == 5
    assert _of(events, "build_started") == [
        ("build_started", {"player": 0, "kind": "road", "edge": AB, "width": 2})
    ]
    assert _build_until(state, 249) == []
    assert state.edges[AB].width == 1
    events = _build_until(state, 250)
    assert _of(events, "road_upgraded") == [
        ("road_upgraded", {"player": 0, "edge": AB, "width": 2})
    ]
    assert state.edges[AB].width == 2
    assert edge_packet_ticks(state, RULES, AB) == 20  # 30 * 100 // 150


def test_dec22_example_5_level_2_costs_half_a_cp() -> None:
    state = _state(warehouse=5)
    state.players[0].cp = PRICE - 1
    assert _cmd(state, UpgradeRoad(AB)) == Reject(RejectCode.NOT_ENOUGH_CP)


def test_dec22_example_6_second_upgrade() -> None:
    state = _state(level=2, warehouse=2)
    state.tick = 100
    assert _cmd(state, UpgradeRoad(AB)) == Ok(cost=PRICE)
    assert state.nodes[A].warehouse == 2 and state.players[0].cp == 100 - PRICE
    _build_until(state, 250)
    assert state.edges[AB].width == 3
    assert edge_packet_ticks(state, RULES, AB) == 15  # 30 * 100 // 200


def test_dec22_example_7_level_3_is_the_last() -> None:
    state = _state(level=3, warehouse=5)
    assert _cmd(state, UpgradeRoad(AB)) == Reject(RejectCode.MAX_WIDTH)


def test_dec22_example_8_a_road_at_a_province_is_upgraded_too() -> None:
    state = _state()
    state.nodes[P].owner = 0
    assert _cmd(state, UpgradeRoad(AP)) == Ok(cost=PRICE)


def test_dec22_example_12_the_warehouse_takes_no_part() -> None:
    state = _state(level=2, warehouse=0)
    assert _cmd(state, UpgradeRoad(AB)) == Ok(cost=PRICE)


def test_dec22_example_13_level_2_for_the_last_half_cp() -> None:
    state = _state(warehouse=1)
    state.players[0].cp = PRICE
    state.tick = 100
    assert _cmd(state, UpgradeRoad(AB)) == Ok(cost=PRICE)
    assert state.players[0].cp == 0 and state.nodes[A].warehouse == 1
    _build_until(state, 250)
    assert state.edges[AB].width == 2


def test_dec22_example_14_a_road_under_a_build_is_busy() -> None:
    state = _state(level=2, warehouse=2)
    assert _cmd(state, UpgradeRoad(AB)) == Ok(cost=PRICE)  # level 3 is being built
    results, _ = apply_commands(state, RULES, [PlayerCommand(0, 1, UpgradeRoad(AB))])
    assert results[0].outcome == Reject(RejectCode.EDGE_BUSY)


# 9-11: supply on upgraded roads (DEC-28: amount 1 / 2 / 3 by level, no freight road) ----------


@pytest.mark.parametrize(("level", "amount"), [(1, 1), (3, 3)])
def test_dec22_example_9_charges_per_period_by_level(level: int, amount: int) -> None:
    state = _state(level=level, warehouse=6)
    state.edges[KA].width = level  # K-A carries as much as A-B
    state.players[0].fronts = (B, None)  # B wants a full warehouse: 6 charges, more than a road
    state.nodes[K].warehouse = 6
    state.nodes[A].warehouse = 1  # A at its rear minimum: no donor
    events = _supply_until(state, 10)
    sent_ab = [e for e in events if e.kind == "packet_sent" and AB in _way(state, e)]
    assert sum(_int(e.get("charges")) for e in sent_ab) == amount


def _way(state: GameState, e: Event) -> tuple[int, ...]:
    pid = e.get("packet")
    assert isinstance(pid, int)
    packet = state.packets[pid]
    return (packet.edge, *packet.route)


def _int(value: object) -> int:
    assert isinstance(value, int)
    return value


@pytest.mark.parametrize("captured", [B, A])
def test_dec22_examples_10_11_a_packet_on_a_lost_road_is_lost(captured: int) -> None:
    state = _state(level=2)
    pid = _packet(state, charges=2, depart=100)
    change_owner(state, captured, 1)
    events = _supply_until(state, 101)
    assert _of(events, "packet_lost") == [
        ("packet_lost", {"packet": pid, "player": 0, "edge": AB, "charges": 2})
    ]
    assert pid not in state.packets
    events = _supply_until(state, 140)
    assert _of(events, "packet_captured", "packet_delivered") == []
    assert state.nodes[B].warehouse == 0


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
