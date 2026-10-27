"""Economy (SIM-06): CP regeneration, cap, stance split, accumulator, charges of the capital.

Expected values are worked out by hand from DEC-02 (mechanics.md, section 6):

- every 50 ticks a quantum of 100 hundredths of CP is split by the stance: 75 / 50 / 25 % into
  charges ("Economy" / "Balance" / "War"), the rest into CP;
- the charge share is converted at 1 CP -> 2 charges into an accumulator in hundredths of a
  charge, every whole 100 is one charge;
- no passive production (owner's decision of 2026-10-14, #253): charges come only from the
  stance share; 600 ticks give 18 / 12 / 6 charges in "Economy" / "Balance" / "War";
- CP cap 5 (500): the CP excess burns, the charge share is credited always;
- stance change at most once per 100 ticks; the first change is free (#104 default).

The DEC-02 numbers are pinned in ``DEC02`` below, so balance changes of ``mvp-0.toml`` do not
break these rule tests. Tick convention (``gow_sim.systems.economy``): step ``t`` runs with
``state.tick == t``; 600 steps are ticks 1..600, that is 12 quanta.
"""

import dataclasses
import json
from pathlib import Path

import pytest

from gow_sim.maps import load_map, parse_map
from gow_sim.ruleset import CpRules, EconomyRules, Ruleset, Stance, StanceTable, load_ruleset
from gow_sim.state import Event, GameState, initial_state
from gow_sim.systems.economy import economy, set_stance, stance_cooldown_left
from gow_sim.systems.supply import supply

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
            start_stance=Stance.BALANCE,
            stance_to_charges_pct=StanceTable(economy=75, balance=50, war=25),
        ),
        orders=dataclasses.replace(base.orders, stance_cooldown_ticks=100),
        # A capital holds 4 charges in these tests (its kind's capacity, DEC-22).
        capacity=dataclasses.replace(
            base.capacity, by_kind=dataclasses.replace(base.capacity.by_kind, capital=4)
        ),
    )


DEC02 = _dec02()
ROOMY = dataclasses.replace(
    DEC02,
    capacity=dataclasses.replace(
        DEC02.capacity, by_kind=dataclasses.replace(DEC02.capacity.by_kind, capital=1000)
    ),
)
"""DEC02 with capitals of capacity 1000: nothing overflows."""


def _roomy_state() -> GameState:
    """line3 with empty warehouses, for the ``ROOMY`` rules."""
    data = json.loads((MAPS_DIR / "line3.json").read_text(encoding="utf-8"))
    for node in data["nodes"]:
        if node["capital_of"] is not None:
            node["start_stock"] = 0
    return initial_state(parse_map(data), ROOMY)


def _run(state: GameState, ticks: int, rules: Ruleset = ROOMY) -> list[Event]:
    events: list[Event] = []
    for _ in range(ticks):
        state.tick += 1
        events.extend(economy(state, rules))
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
        assert state.nodes[state.map.capital(pid)].warehouse == charges  # no passive charge


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
        assert state.nodes[capital].warehouse - before == expected_charges
        assert state.players[0].charge_acc == expected_acc


# CP cap --------------------------------------------------------------------------------------


def test_cp_cap_burns_cp_but_not_the_charge_share() -> None:
    state = _roomy_state()
    state.players[0].cp = 480
    state.players[0].stance = Stance.BALANCE
    events = _run(state, 50)
    # 480 + 50 = 530 -> cap 500, 30 burn; the charge share (1 charge) is credited.
    assert state.players[0].cp == 500
    assert _burned(events, 0) == 30
    assert state.nodes[state.map.capital(0)].warehouse == 1


def test_at_the_cap_all_cp_burn_and_charges_keep_coming() -> None:
    state = _roomy_state()
    state.players[0].cp = 500
    state.players[0].stance = Stance.WAR
    events = _run(state, 100)
    assert state.players[0].cp == 500
    assert _burned(events, 0) == 150  # 2 quanta x 75
    assert state.nodes[state.map.capital(0)].warehouse == 1  # 2 x 50 hundredths


# 600 ticks for every stance ------------------------------------------------------------------

# start CP, stance, CP after 600 ticks, CP burned, charges produced (warehouse), accumulator
# 12 quanta: ECONOMY +25 CP / 150 hundredths, BALANCE +50 / 100, WAR +75 / 50; no passive charges
# (mechanics.md, DEC-02: 18 / 12 / 6 charges in 600 ticks).
SIX_HUNDRED = [
    (0, Stance.ECONOMY, 300, 0, 18, 0),  # 12 x 25 = 300; 1800 / 100 = 18
    (0, Stance.BALANCE, 500, 100, 12, 0),  # 12 x 50 = 600 -> cap 500
    (0, Stance.WAR, 500, 400, 6, 0),  # 12 x 75 = 900 -> cap 500; 600 / 100 = 6
    (300, Stance.ECONOMY, 500, 100, 18, 0),  # 300 + 300 = 600 -> 500
    (300, Stance.BALANCE, 500, 400, 12, 0),  # 300 + 600 = 900 -> 500
    (300, Stance.WAR, 500, 700, 6, 0),  # 300 + 900 = 1200 -> 500
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
        assert cp - start + burned + charges * 100 // 2 == 12 * 100


# Capital warehouse and capacity --------------------------------------------------------------


def _produced(events: list[Event]) -> list[tuple[object, object, object]]:
    return [
        (e.get("node"), e.get("charges"), e.get("spill"))
        for e in events
        if e.kind == "charges_produced" and e.get("player") == 0
    ]


def test_overflow_goes_to_the_supply_as_spill() -> None:
    # line3: the capital holds 4 (``DEC02``).
    state = initial_state(load_map(MAPS_DIR / "line3.json"), DEC02)
    state.nodes[0].warehouse = 3
    state.players[0].stance = Stance.ECONOMY
    state.players[0].charge_acc = 50
    events = _run(state, 50, DEC02)
    # ECONOMY: 50 + 150 hundredths = 2 charges; room for 1, the other one is spill for the supply
    # system of the same tick (DEC-28, item 4.4), not lost here.
    assert state.nodes[0].warehouse == 4
    assert _produced(events) == [(0, 2, 1)]
    assert not [e for e in events if e.kind == "charges_overflow"]


def test_full_warehouse_spills_everything() -> None:
    state = initial_state(load_map(MAPS_DIR / "line3.json"), DEC02)  # start_stock 4 = capacity
    events = _run(state, 50, DEC02)
    assert state.nodes[0].warehouse == 4
    assert [e.kind for e in events if e.get("player") == 0] == ["charges_produced"]
    assert _produced(events) == [(0, 1, 1)]


def test_capacity_does_not_count_internal_roads() -> None:
    # pass: capital 0 is joined to own node 1 by e0; roads add nothing (DEC-22): capacity 4.
    state = initial_state(load_map(MAPS_DIR / "choke.json"), DEC02)
    state.nodes[0].warehouse = 3
    state.edges[0].width = 3
    _run(state, 50, DEC02)
    assert state.nodes[0].warehouse == 4


def test_lost_capital_produces_nothing_but_cp_regenerates() -> None:
    state = _roomy_state()
    state.nodes[0].owner = 1
    events = _run(state, 50)
    assert state.nodes[0].warehouse == 0
    assert state.players[0].cp == 350
    # BALANCE: 1 charge, no passive; all of it is spill, which the supply system burns.
    assert _produced(events) == [(0, 1, 1)]
    state.events = events
    burnt = supply(state, ROOMY)
    assert [(e.kind, e.get("charges")) for e in burnt if e.get("player") == 0] == [
        ("charges_overflow", 1)
    ]


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
