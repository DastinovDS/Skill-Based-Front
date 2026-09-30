"""Economy (SIM-06): CP regeneration, cap, stance split, accumulator, capital production.

Expected values are worked out by hand from DEC-02 (mechanics.md, section 6):

- every 50 ticks a quantum of 100 hundredths of CP is split by the stance: 75 / 50 / 25 % into
  charges («Экономия» / «Баланс» / «Война»), the rest into CP;
- the charge share is converted at 1 CP -> 2 charges into an accumulator in hundredths of a
  charge, every whole 100 is one charge;
- passive production: 1 charge per 50 ticks in the capital;
- CP cap 5 (500): the CP excess burns, the charge share is credited always;
- stance change at most once per 100 ticks; the first change is free (#104 default).

The DEC-02 numbers are pinned in ``DEC02`` below, so balance changes of ``mvp-0.toml`` do not
break these rule tests. Tick convention (``gow_sim.systems.economy``): step ``t`` runs with
``state.tick == t``; 600 steps are ticks 1..600, that is 12 quanta and 12 passive charges.
"""

import dataclasses
import json
from pathlib import Path

import pytest

from gow_sim.maps import load_map, parse_map
from gow_sim.ruleset import CpRules, EconomyRules, Ruleset, Stance, StanceTable, load_ruleset
from gow_sim.state import Event, GameState, initial_state
from gow_sim.systems.economy import economy, set_stance, stance_cooldown_left

TESTS_DIR = Path(__file__).resolve().parent
MAPS_DIR = TESTS_DIR / "maps"
MVP0 = TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml"


def _dec02() -> Ruleset:
    base = load_ruleset(MVP0)
    return dataclasses.replace(
        base,
        cp=CpRules(start=300, cap=500, per_period=100, period_ticks=50),
        economy=EconomyRules(
            charges_per_cp=2,
            passive_period_ticks=50,
            passive_amount=1,
            start_stance=Stance.BALANCE,
            stance_to_charges_pct=StanceTable(economy=75, balance=50, war=25),
        ),
        orders=dataclasses.replace(base.orders, stance_cooldown_ticks=100),
    )


DEC02 = _dec02()


def _roomy_state() -> GameState:
    """line3 with capitals of capacity 1000 and empty warehouses: nothing overflows."""
    data = json.loads((MAPS_DIR / "line3.json").read_text(encoding="utf-8"))
    for node in data["nodes"]:
        if node["capital_of"] is not None:
            node["base_capacity"] = 1000
            node["start_stock"] = 0
    return initial_state(parse_map(data), DEC02)


def _run(state: GameState, ticks: int) -> list[Event]:
    events: list[Event] = []
    for _ in range(ticks):
        state.tick += 1
        events.extend(economy(state, DEC02))
    return events


def _burned(events: list[Event], player: int) -> int:
    return sum(
        int(str(e.get("cp"))) for e in events if e.kind == "cp_burned" and e.get("player") == player
    )


# One quantum ---------------------------------------------------------------------------------

# stance, CP gained, whole charges from the stance, accumulator left (hundredths of a charge)
ONE_QUANTUM = [
    (Stance.ECONOMY, 25, 1, 50),  # 75 -> 150 hundredths of a charge
    (Stance.BALANCE, 50, 1, 0),  # 50 -> 100
    (Stance.WAR, 75, 0, 50),  # 25 -> 50
]


@pytest.mark.parametrize(("stance", "cp", "charges", "acc"), ONE_QUANTUM)
def test_one_quantum(stance: Stance, cp: int, charges: int, acc: int) -> None:
    state = _roomy_state()
    for p in state.players.values():
        p.cp = 0
        p.stance = stance
    _run(state, 50)
    for pid in (0, 1):
        assert state.players[pid].cp == cp
        assert state.players[pid].charge_acc == acc
        # + 1 passive charge at tick 50
        assert state.nodes[state.map.capital(pid)].warehouse == charges + 1


def test_nothing_happens_between_periods() -> None:
    state = _roomy_state()
    events = _run(state, 49)
    assert events == []
    assert [p.cp for p in state.players.values()] == [300, 300]
    assert state.nodes[0].warehouse == 0


# Accumulator ---------------------------------------------------------------------------------

# Whole charges from the stance after quanta 1..4 and the accumulator after each quantum.
ACCUMULATOR = [
    (Stance.ECONOMY, [1, 2, 1, 2], [50, 0, 50, 0]),  # 150 per quantum
    (Stance.BALANCE, [1, 1, 1, 1], [0, 0, 0, 0]),  # 100 per quantum
    (Stance.WAR, [0, 1, 0, 1], [50, 0, 50, 0]),  # 50 per quantum
]


@pytest.mark.parametrize(("stance", "charges", "accs"), ACCUMULATOR)
def test_accumulator(stance: Stance, charges: list[int], accs: list[int]) -> None:
    state = _roomy_state()
    state.players[0].stance = stance
    capital = state.map.capital(0)
    for expected_charges, expected_acc in zip(charges, accs, strict=True):
        before = state.nodes[capital].warehouse
        _run(state, 50)
        assert state.nodes[capital].warehouse - before == expected_charges + 1  # + passive
        assert state.players[0].charge_acc == expected_acc


# CP cap --------------------------------------------------------------------------------------


def test_cp_cap_burns_cp_but_not_the_charge_share() -> None:
    state = _roomy_state()
    state.players[0].cp = 480
    state.players[0].stance = Stance.BALANCE
    events = _run(state, 50)
    # 480 + 50 = 530 -> cap 500, 30 burn; the charge share (1 charge) and 1 passive are credited.
    assert state.players[0].cp == 500
    assert _burned(events, 0) == 30
    assert state.nodes[state.map.capital(0)].warehouse == 2


def test_at_the_cap_all_cp_burn_and_charges_keep_coming() -> None:
    state = _roomy_state()
    state.players[0].cp = 500
    state.players[0].stance = Stance.WAR
    events = _run(state, 100)
    assert state.players[0].cp == 500
    assert _burned(events, 0) == 150  # 2 quanta x 75
    assert state.nodes[state.map.capital(0)].warehouse == 1 + 2  # 2 x 50 hundredths + 2 passive


# 600 ticks for every stance ------------------------------------------------------------------

# start CP, stance, CP after 600 ticks, CP burned, charges produced (warehouse), accumulator
# 12 quanta: ECONOMY +25 CP / 150 hundredths, BALANCE +50 / 100, WAR +75 / 50; 12 passive charges.
SIX_HUNDRED = [
    (0, Stance.ECONOMY, 300, 0, 18 + 12, 0),  # 12 x 25 = 300; 1800 / 100 = 18
    (0, Stance.BALANCE, 500, 100, 12 + 12, 0),  # 12 x 50 = 600 -> cap 500
    (0, Stance.WAR, 500, 400, 6 + 12, 0),  # 12 x 75 = 900 -> cap 500; 600 / 100 = 6
    (300, Stance.ECONOMY, 500, 100, 18 + 12, 0),  # 300 + 300 = 600 -> 500
    (300, Stance.BALANCE, 500, 400, 12 + 12, 0),  # 300 + 600 = 900 -> 500
    (300, Stance.WAR, 500, 700, 6 + 12, 0),  # 300 + 900 = 1200 -> 500
]


@pytest.mark.parametrize(("start", "stance", "cp", "burned", "charges", "acc"), SIX_HUNDRED)
def test_600_ticks(
    start: int, stance: Stance, cp: int, burned: int, charges: int, acc: int
) -> None:
    state = _roomy_state()
    for p in state.players.values():
        p.cp = start
        p.stance = stance
    events = _run(state, 600)
    for pid in (0, 1):
        assert state.players[pid].cp == cp
        assert _burned(events, pid) == burned
        assert state.nodes[state.map.capital(pid)].warehouse == charges
        assert state.players[pid].charge_acc == acc
        # Nothing is lost: CP gained + burned + CP spent on charges = 12 quanta of 100.
        assert cp - start + burned + (charges - 12) * 100 // 2 == 12 * 100


# Capital warehouse and capacity --------------------------------------------------------------


def test_overflow_is_lost_with_an_event() -> None:
    # line3: the capital has base_capacity 4 and only a buffer road, so its capacity is 4.
    state = initial_state(load_map(MAPS_DIR / "line3.json"), DEC02)
    state.nodes[0].warehouse = 3
    events = _run(state, 50)
    # BALANCE: 1 charge from the stance + 1 passive = 2; room for 1, 1 lost.
    assert state.nodes[0].warehouse == 4
    produced = [e for e in events if e.kind == "charges_produced" and e.get("player") == 0]
    lost = [e for e in events if e.kind == "charges_overflow" and e.get("player") == 0]
    assert [(e.get("node"), e.get("charges")) for e in produced] == [(0, 1)]
    assert [(e.get("node"), e.get("charges")) for e in lost] == [(0, 1)]


def test_full_warehouse_loses_everything() -> None:
    state = initial_state(load_map(MAPS_DIR / "line3.json"), DEC02)  # start_stock 4 = capacity
    events = _run(state, 50)
    assert state.nodes[0].warehouse == 4
    assert [e.kind for e in events if e.get("player") == 0] == ["charges_overflow"]


def test_capacity_counts_internal_roads() -> None:
    # pass: capital 0 (base 4) is joined to own node 1 by e0 of width 1 (+1.0): capacity 5.
    state = initial_state(load_map(MAPS_DIR / "pass.json"), DEC02)
    state.nodes[0].warehouse = 4
    _run(state, 50)
    assert state.nodes[0].warehouse == 5


def test_lost_capital_produces_nothing_but_cp_regenerates() -> None:
    state = _roomy_state()
    state.nodes[0].owner = 1
    events = _run(state, 50)
    assert state.nodes[0].warehouse == 0
    assert state.players[0].cp == 350
    lost = [e for e in events if e.kind == "charges_overflow" and e.get("player") == 0]
    assert [e.get("charges") for e in lost] == [2]


# Stance changes ------------------------------------------------------------------------------


def test_first_stance_change_is_free_of_the_cooldown() -> None:
    state = _roomy_state()
    assert stance_cooldown_left(state, DEC02, 0) == 0


def test_stance_cooldown() -> None:
    state = _roomy_state()
    state.tick = 10
    events = set_stance(state, 0, Stance.WAR)
    assert [(e.kind, e.get("player"), e.get("stance")) for e in events] == [
        ("stance_changed", 0, "war")
    ]
    assert state.players[0].stance is Stance.WAR
    for tick, left in [(10, 100), (60, 50), (109, 1), (110, 0), (500, 0)]:
        state.tick = tick
        assert stance_cooldown_left(state, DEC02, 0) == left
    assert stance_cooldown_left(state, DEC02, 1) == 0  # the other player is not affected


def test_stance_change_applies_to_the_next_quantum() -> None:
    state = _roomy_state()
    for p in state.players.values():
        p.cp = 0
    _run(state, 49)
    state.tick = 50
    set_stance(state, 0, Stance.WAR)  # commands are applied before the economy in tick 50
    economy(state, DEC02)
    assert state.players[0].cp == 75
    assert state.players[1].cp == 50  # still BALANCE
