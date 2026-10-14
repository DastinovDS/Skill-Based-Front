"""Starvation in an encirclement (DEC-19, #231).

Table tests of exactly the 13 worked examples of DEC-19 (mechanics.md, section 7). Expected
values come from the decision: city X (capacity 6) is cut off from tick 1000
(``cut_since = 1000``); ``grace_ticks = 100``, ``period_ticks = 100``, ``charges = 1``,
``per_units = 3``; the garrison stands in X.

Map ``dec18`` (see ``test_dec18.py``): X is the medium city C = 3, joined to the capital K only
through A = 1 (and to the neutral E = 6). Making A neutral cuts C off; that is setup, not a
capture. The capacity system runs every tick (attrition, then starvation).
"""

import dataclasses
from pathlib import Path

from gow_sim.maps import load_map
from gow_sim.ruleset import KindTable, Ruleset, StarvationRules, load_ruleset
from gow_sim.state import AtNode, Event, GameState, Group, Mode, OnEdge, initial_state
from gow_sim.systems.capacity import capacity, change_owner, starve_in

TESTS_DIR = Path(__file__).resolve().parent
MVP0 = TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml"


def _rules() -> Ruleset:
    base = load_ruleset(MVP0)
    return dataclasses.replace(
        base,
        capacity=dataclasses.replace(
            base.capacity,
            by_kind=KindTable(capital=10, city_large=8, city_medium=6, city_small=4, province=3),
        ),
        starvation=StarvationRules(grace_ticks=100, period_ticks=100, charges=1, per_units=3),
    )


RULES = _rules()
K, A, C, P = 0, 1, 3, 4
X = C
CUT = 1000


def _state(warehouse: int = 0) -> GameState:
    state = initial_state(load_map(TESTS_DIR / "maps" / "dec18.json"), RULES)
    state.nodes[X].warehouse = warehouse
    return state


def _group(state: GameState, units: int, charged: int, node: int = X) -> Group:
    gid = state.new_id()
    group = Group(gid, 0, units, charged, Mode.ATTACK, AtNode(node))
    state.groups[gid] = group
    return group


def _run(state: GameState, until: int, rules: Ruleset = RULES) -> list[Event]:
    """Run the capacity system on ticks ``state.tick + 1 .. until``; cut X at tick ``CUT``."""
    events: list[Event] = []
    while state.tick < until:
        state.tick += 1
        if state.tick == CUT:
            state.nodes[A].owner = None
        events += capacity(state, rules)
    return events


def _starved(events: list[Event]) -> list[tuple[int, object, object]]:
    return [(e.tick, e.get("warehouse"), e.get("units")) for e in events if e.kind == "starvation"]


def test_example_1_warehouse_first_then_units_never_die() -> None:
    state = _state(warehouse=2)
    state.tick = CUT - 1
    g = _group(state, 3, 3)
    _run(state, 1100)
    assert state.nodes[X].cut_since == CUT
    assert (state.nodes[X].warehouse, g.charged) == (1, 3)
    _run(state, 1200)
    assert (state.nodes[X].warehouse, g.charged) == (0, 3)
    for tick, charged in ((1300, 2), (1400, 1), (1500, 0)):
        _run(state, tick)
        assert g.charged == charged, tick
    events = _run(state, 1800)
    assert _starved(events) == [] and g.units == 3 and g.id in state.groups


def test_example_2_no_units_nothing_spent() -> None:
    state = _state(warehouse=5)
    state.tick = CUT - 1
    assert _starved(_run(state, 1500)) == []
    assert state.nodes[X].warehouse == 5


def test_example_3_one_charge_per_started_three_units() -> None:
    # The real rules: 5 units fit the capacity 6, so no attrition (#253 fixed the example).
    state = _state()
    state.tick = CUT - 1
    g = _group(state, 5, 5)
    _run(state, 1100)
    assert g.charged == 3  # ceil(5 / 3) = 2
    _run(state, 1200)
    assert g.charged == 1
    events = _run(state, 1300)
    assert _starved(events) == [(1300, 0, 1)]  # the shortfall of 1 is not carried over
    assert (g.charged, g.units) == (0, 5) and not [e for e in events if e.kind == "attrition"]


def test_example_4_warehouse_then_one_unit_charge() -> None:
    state = _state(warehouse=1)
    state.tick = CUT - 1
    g = _group(state, 4, 4)
    events = _run(state, 1100)
    assert _starved(events) == [(1100, 1, 1)]
    assert (state.nodes[X].warehouse, g.charged) == (0, 3)


def test_example_5_the_group_with_the_most_charged_first_ties_lower_id() -> None:
    state = _state()
    state.tick = CUT - 1
    g1 = _group(state, 3, 3)
    g2 = _group(state, 2, 2)
    assert g1.id < g2.id
    _run(state, 1100)
    assert (g1.charged, g2.charged) == (1, 2)


def test_example_6_restored_then_cut_again_restarts_the_count() -> None:
    state = _state(warehouse=5)
    state.tick = CUT - 1
    _group(state, 3, 3)
    events: list[Event] = []
    events += _run(state, 1149)
    state.tick += 1  # tick 1150: the road is back
    state.nodes[A].owner = 0
    events += capacity(state, RULES)
    assert state.nodes[X].cut_since is None
    events += _run(state, 1179)
    state.tick += 1  # tick 1180: cut again
    state.nodes[A].owner = None
    events += capacity(state, RULES)
    assert state.nodes[X].cut_since == 1180
    events += _run(state, 1300)
    assert [t for t, _, _ in _starved(events)] == [1100, 1280]


def test_example_7_a_group_in_transit_does_not_count() -> None:
    state = _state()
    state.tick = CUT - 1
    g = _group(state, 3, 3)
    gid = state.new_id()
    transit = Group(gid, 0, 3, 3, Mode.ATTACK, OnEdge(edge=2, from_node=A, progress=500))
    state.groups[gid] = transit
    _run(state, 1100)
    assert (g.charged, transit.charged) == (2, 3)  # U = 3: one charge


def test_example_8_a_province_does_not_starve() -> None:
    state = _state()
    state.nodes[P].owner = 0
    state.tick = CUT - 1
    g = _group(state, 3, 3, node=P)
    state.nodes[K].owner = 1  # P (and every own node) cut off from the capital
    events = _run(state, 1500)
    assert g.charged == 3
    assert state.nodes[P].cut_since is None
    assert all(e.get("node") != P for e in events if e.kind == "starvation")


def test_example_9_captured_cut_off_counts_from_the_capture() -> None:
    state = _state()
    state.nodes[A].owner = None
    state.nodes[X].owner = 1
    state.tick = 1999
    capacity(state, RULES)
    state.tick = 2000
    change_owner(state, X, 0)  # the capture (movement or combat, before capacity)
    g = _group(state, 3, 3)
    capacity(state, RULES)
    assert state.nodes[X].cut_since == 2000
    events = _run(state, 2100)
    assert _starved(events) == [(2100, 0, 1)] and g.charged == 2


def test_example_10_nothing_to_spend_nobody_dies() -> None:
    state = _state()
    state.tick = CUT - 1
    g = _group(state, 3, 0)
    events = _run(state, 1100)
    assert _starved(events) == []
    assert (g.units, g.charged) == (3, 0)


def test_example_11_nothing_to_spend_no_countdown() -> None:
    state = _state()
    state.tick = CUT - 1
    _group(state, 3, 0)
    _run(state, 1150)
    assert starve_in(state, RULES, X) is None


def test_example_12_charges_back_the_countdown_keeps_its_schedule() -> None:
    state = _state()
    state.tick = CUT - 1
    _group(state, 3, 0)
    _run(state, 1159)
    state.nodes[X].warehouse = 1  # tick 1160: a packet brings 1 charge
    _run(state, 1160)
    assert starve_in(state, RULES, X) == 40  # the next consumption at 1200


def test_example_13_no_units_no_countdown() -> None:
    state = _state(warehouse=5)
    state.tick = CUT - 1
    _run(state, 1150)
    assert state.nodes[X].cut_since == CUT
    assert starve_in(state, RULES, X) is None


def test_starve_in_counts_down_to_the_next_consumption() -> None:
    state = _state(warehouse=5)
    state.tick = CUT - 1
    _group(state, 3, 0)
    _run(state, CUT)
    assert starve_in(state, RULES, X) == 100
    _run(state, 1099)
    assert starve_in(state, RULES, X) == 1
    _run(state, 1100)
    assert starve_in(state, RULES, X) == 100
    assert starve_in(state, RULES, A) is None
