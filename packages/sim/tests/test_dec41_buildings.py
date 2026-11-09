"""Buildings paid in charges and the province warehouse (DEC-41, #642; implementation #645).

Expected values come from mechanics.md, section 7, block "Economy v2 (DEC-41, #642)": item 7
(costs in charges: factory 4, barracks 3; the progressive payment: the city warehouse first, then
the own groups standing in the city, the largest ``charged`` first; the build time starts when it
is paid in full; no refund) and item 13 (the province warehouse of capacity 1: recharge, lost on
capture), and the implementation notes of #645 under that block.

Map ``dec41`` (see ``test_dec41.py``): player 0 owns K = 0 (capital), A = 1 (large), B, C, D =
2, 3, 4 (medium), E, F, G = 5, 6, 7 (small); M = 8 is a neutral province (plains, like every
node). Warehouse capacities of ``mvp-5`` (DEC-43, item C): capital 6, every city 3, province 1.
"""

from pathlib import Path

from gow_sim.commands import (
    BuildBarracks,
    BuildFactory,
    Command,
    Ok,
    PlayerCommand,
    Reject,
    RejectCode,
    apply_commands,
)
from gow_sim.maps import load_map
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.state import (
    AtNode,
    Build,
    BuildKind,
    Event,
    FactoryBuild,
    GameState,
    Group,
    Mode,
    event,
    from_canonical,
    initial_state,
    to_canonical,
)
from gow_sim.systems.build import build
from gow_sim.systems.capacity import change_owner, warehouse_capacity
from gow_sim.systems.supply import garrisons_by_node, recharge

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[2]
RULES = load_ruleset(ROOT / "rulesets" / "mvp-5.toml")
MAP = load_map(TESTS_DIR / "maps" / "dec41.json")
K, A, B, C, D, E, F, G, M = range(9)


def _state(tick: int = 10) -> GameState:
    state = initial_state(MAP, RULES)
    state.tick = tick
    return state


def _cmd(state: GameState, cmd: Command, player: int = 0, rules: Ruleset = RULES) -> Ok | Reject:
    results, events = apply_commands(state, rules, [PlayerCommand(player, 0, cmd)])
    state.events.extend(events)
    return results[0].outcome


def _code(outcome: Ok | Reject) -> RejectCode | None:
    return outcome.code if isinstance(outcome, Reject) else None


def _group(state: GameState, node: int, units: int, charged: int, owner: int = 0) -> Group:
    gid = state.new_id()
    group = Group(gid, owner, units, charged, Mode.ATTACK, AtNode(node))
    state.groups[gid] = group
    return group


def _builds_until(state: GameState, tick: int) -> list[Event]:
    events: list[Event] = []
    while state.tick < tick:
        state.tick += 1
        events += build(state, RULES)
    return events


def _paid(events: list[Event]) -> list[tuple[int, object, object, object, object]]:
    """``(tick, kind, warehouse, units, owed)`` of the ``build_paid`` events."""
    return [
        (e.tick, e.get("kind"), e.get("warehouse"), e.get("units"), e.get("owed"))
        for e in events
        if e.kind == "build_paid"
    ]


# Item 7: costs in charges, the progressive payment ---------------------------------------------


def test_the_barracks_costs_3_charges_from_the_warehouse_then_the_groups_and_no_cp() -> None:
    """Item 7: B (medium) holds 2, a group 3/3 stands there: 2 from the warehouse, 1 from the
    group; no CP; paid in full at once, so the barracks stands 100 ticks later."""
    state = _state()
    state.nodes[B].warehouse = 2
    group = _group(state, B, 3, 3)
    cp = state.players[0].cp
    assert _cmd(state, BuildBarracks(B)) == Ok(cost=0, path=())
    assert state.players[0].cp == cp
    assert (state.nodes[B].warehouse, group.charged) == (0, 2)
    assert _paid(state.events) == [(10, "barracks", 2, 1, 0)]
    assert state.nodes[B].build == Build(0, 10, BuildKind.BARRACKS, owed=0)
    events = _builds_until(state, 110)
    assert events == [event(110, "barracks_built", player=0, node=B)]
    assert state.nodes[B].has_barracks


def test_the_largest_charged_pays_first_one_charge_at_a_time() -> None:
    """Item 7 (as DEC-19, item 4): an empty warehouse, groups 2/2 (lower id) and 3/3: the 3/3
    pays the first charge, then both have 2 and the lower id pays, then the 3/3 again."""
    state = _state()
    low = _group(state, B, 2, 2)
    high = _group(state, B, 3, 3)
    assert isinstance(_cmd(state, BuildBarracks(B)), Ok)
    assert (low.charged, high.charged) == (1, 1)
    assert _paid(state.events) == [(10, "barracks", 0, 3, 0)]


def test_only_own_groups_standing_outside_a_fight_pay() -> None:
    """Item 7: "the own groups standing in the city": an enemy group and an own group in a fight
    pay nothing."""
    state = _state()
    enemy = _group(state, B, 3, 3, owner=1)
    fighting = _group(state, B, 3, 3)
    fighting.fight = 0
    assert isinstance(_cmd(state, BuildBarracks(B)), Ok)
    assert (enemy.charged, fighting.charged) == (3, 3)
    assert _paid(state.events) == []
    build_ = state.nodes[B].build
    assert build_ is not None and build_.owed == 3


def test_the_build_time_starts_when_paid_in_full() -> None:
    """Item 7: B holds 1 of 3: the barracks owes 2 and does not progress; two charges arrive at
    tick 50 and pay it in full: the barracks stands at 150, not at 110."""
    state = _state()
    state.nodes[B].warehouse = 1
    assert isinstance(_cmd(state, BuildBarracks(B)), Ok)
    assert _paid(state.events) == [(10, "barracks", 1, 0, 2)]
    assert _builds_until(state, 49) == []
    state.nodes[B].warehouse = 2
    events = _builds_until(state, 149)
    assert _paid(events) == [(50, "barracks", 2, 0, 0)]
    assert state.nodes[B].build == Build(0, 50, BuildKind.BARRACKS, owed=0)
    assert not state.nodes[B].has_barracks
    assert _builds_until(state, 150) == [event(150, "barracks_built", player=0, node=B)]


def test_the_payment_takes_charges_as_they_come() -> None:
    """Item 7: one charge per tick reaches an empty city; each tick pays what is there."""
    state = _state()
    assert isinstance(_cmd(state, BuildBarracks(B)), Ok)
    events: list[Event] = []
    for tick in (11, 12, 13):
        state.tick = tick
        state.nodes[B].warehouse += 1
        events += build(state, RULES)
    assert _paid(events) == [
        (11, "barracks", 1, 0, 2),
        (12, "barracks", 1, 0, 1),
        (13, "barracks", 1, 0, 0),
    ]
    assert state.nodes[B].build == Build(0, 13, BuildKind.BARRACKS, owed=0)


def test_the_factory_is_paid_progressively_too() -> None:
    """Item 7 applies to the factory (item 2, cost 4): A (large, warehouse of 2 at level 0) holds
    2, a group 2/2 pays the other 2; the factory works 100 ticks later. #644 needed a warehouse
    of 4 for it."""
    state = _state()
    state.nodes[A].warehouse = 2
    group = _group(state, A, 2, 2)
    assert isinstance(_cmd(state, BuildFactory(A)), Ok)
    assert (state.nodes[A].warehouse, group.charged) == (0, 0)
    assert _paid(state.events) == [(10, "factory", 2, 2, 0)]
    assert state.nodes[A].factory_build == FactoryBuild(owner=0, since=10, owed=0)
    assert _builds_until(state, 110) == [event(110, "factory_built", player=0, node=A)]
    assert state.nodes[A].factory == 0


def test_an_unpaid_factory_waits_and_counts_for_the_cap() -> None:
    """Item 7 and the #644 reading (a build under way counts for ``factory.max``): an unpaid
    factory build owes its 4 charges, waits, and still counts."""
    state = _state()
    assert isinstance(_cmd(state, BuildFactory(A)), Ok)
    assert isinstance(_cmd(state, BuildFactory(B)), Ok)
    assert _code(_cmd(state, BuildFactory(C))) is RejectCode.FACTORY_LIMIT
    assert state.nodes[A].factory_build == FactoryBuild(owner=0, since=10, owed=4)
    assert _builds_until(state, 300) == []
    assert state.nodes[A].factory is None


def test_a_stopped_build_refunds_nothing() -> None:
    """Item 7: no refund. B paid 1 of 3, then it is captured: the build stops, the charge is gone
    and the warehouse goes as on every capture."""
    state = _state()
    state.nodes[B].warehouse = 1
    group = _group(state, B, 1, 1)
    assert isinstance(_cmd(state, BuildBarracks(B)), Ok)
    assert (state.nodes[B].warehouse, group.charged) == (0, 0)
    state.tick = 20
    change_owner(state, B, 1)
    assert build(state, RULES) == [
        event(20, "build_stopped", player=0, node=B, kind="barracks", reason="interrupted")
    ]
    assert (state.nodes[B].warehouse, group.charged, state.nodes[B].build) == (0, 0, None)


# Item 13: the province warehouse ---------------------------------------------------------------


def test_a_province_warehouse_holds_1() -> None:
    assert warehouse_capacity(_state(), RULES, M) == 1


def test_units_recharge_from_a_province_warehouse() -> None:
    state = _state(11)
    state.nodes[M].owner = 0
    state.nodes[M].warehouse = 1
    group = _group(state, M, 2, 0)
    recharge(state, RULES, garrisons_by_node(state))
    assert (group.charged, state.nodes[M].warehouse) == (1, 0)


def test_a_captured_province_loses_its_warehouse() -> None:
    """Item 13: "spoils on capture apply": the city rule of a capture, the warehouse is lost to
    its owner (``warehouse_lost``) and the capturer starts at 0."""
    state = _state()
    state.nodes[M].owner = 0
    state.nodes[M].warehouse = 1
    assert change_owner(state, M, 1) == [event(10, "warehouse_lost", node=M, owner=0, charges=1)]
    assert state.nodes[M].warehouse == 0


# Canonical form -------------------------------------------------------------------------------


def test_owed_round_trips() -> None:
    state = _state()
    state.nodes[B].build = Build(0, 10, BuildKind.BARRACKS, owed=2)
    state.nodes[A].factory_build = FactoryBuild(owner=0, since=10, owed=3)
    data = to_canonical(state)
    assert from_canonical(data) == state
