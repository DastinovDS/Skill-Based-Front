"""Fixed capacity by node kind, a lost packet, a 15 minute match (DEC-22, #234).

Table tests of the worked examples of DEC-22 (mechanics.md, section 8) that the kept rules still
have: the road levels and their upgrades (examples 3-9, 12-14) were removed with economy v1
(#894). Expected values come from the decision, not from the code:

- capacity by node kind ``capacity.by_kind``: capital 10, large 8, medium 6, small 4, province 3;
- a packet on a road that is no longer internal to its owner is lost (examples 10, 11);
- ``match_ticks = 9000``, VP every 300 ticks: 30 accruals.

These numbers are pinned in ``RULES``, so balance changes of the played rulesets do not break the
rule tests.

Map ``dec22`` (rot180): K = 0 (capital of 0) -e0- A = 1 -e1- B = 2 (medium cities, B starts
neutral, the tests give it to player 0); P = 3 a neutral province at A (e2); B -e3- 5 (a medium
city the tests give to player 1); the mirror half 7 (capital of 1) -e4- 6 -e5- 5, 6 -e6- 4.
Roads ``travel_ticks`` 30 (e3: 60).
"""

import dataclasses
from pathlib import Path

import pytest

from gow_sim.maps import load_map
from gow_sim.ruleset import KindTable, Ruleset, VictoryRules, load_ruleset
from gow_sim.state import Event, GameState, Packet, initial_state
from gow_sim.systems.capacity import change_owner, city_capacity, warehouse_capacities
from gow_sim.systems.supply import edge_packet_ticks, move_packets
from gow_sim.systems.victory import EndReason, outcome, victory

TESTS_DIR = Path(__file__).resolve().parent
MVP7 = TESTS_DIR.parents[2] / "rulesets" / "mvp-7.toml"


def _rules() -> Ruleset:
    base = load_ruleset(MVP7)
    return dataclasses.replace(
        base,
        match_ticks=9000,
        capacity=dataclasses.replace(
            base.capacity,
            by_kind=KindTable(capital=10, city_large=8, city_medium=6, city_small=4, province=3),
        ),
        victory=VictoryRules(vp_period_ticks=300, capital_multiplier=3),
    )


RULES = _rules()

K, A, B, P, ENEMY = 0, 1, 2, 3, 5
KA, AB, AP = 0, 1, 2


def _state() -> GameState:
    state = initial_state(load_map(TESTS_DIR / "maps" / "dec22.json"), RULES)
    state.nodes[B].owner, state.nodes[ENEMY].owner = 0, 1
    return state


def _packets_until(state: GameState, tick: int) -> list[Event]:
    events: list[Event] = []
    while state.tick < tick:
        state.tick += 1
        events += move_packets(state, warehouse_capacities(state, RULES))
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


@pytest.mark.parametrize("case", ["own", "cut_off", "neutral"])
def test_dec22_example_1_medium_city_capacity_is_6(case: str) -> None:
    state = _state()
    match case:
        case "cut_off":
            state.nodes[K].owner = 1  # A and B lose the way to their capital
        case "neutral":
            state.nodes[A].owner = None
        case _:
            pass
    assert city_capacity(state, RULES, A) == 6
    assert city_capacity(state, RULES, B) == 6


def test_dec22_example_2_capital_capacity_is_10() -> None:
    state = _state()
    assert city_capacity(state, RULES, K) == 10
    assert city_capacity(state, RULES, P) == 3  # and a province: 3 (DEC-22, item 1)


# 10, 11: a packet on a lost road (no freight road: DEC-26, item 7) ------------------------------


@pytest.mark.parametrize("captured", [B, A])
def test_dec22_examples_10_11_a_packet_on_a_lost_road_is_lost(captured: int) -> None:
    state = _state()
    pid = _packet(state, charges=2, depart=100)
    change_owner(state, captured, 1)
    events = _packets_until(state, 101)
    assert _of(events, "packet_lost") == [
        ("packet_lost", {"packet": pid, "player": 0, "edge": AB, "charges": 2})
    ]
    assert pid not in state.packets
    events = _packets_until(state, 140)
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
