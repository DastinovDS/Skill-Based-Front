"""Economy v2, part 2 (DEC-41, #642; implementation #645): buildings paid in charges, the bunker,
the province warehouse.

Expected values come from mechanics.md, section 7, block "Economy v2 (DEC-41, #642)": item 7
(costs in charges: factory 4, barracks 3, warehouse upgrade 2 per level, bunker 3; the
progressive payment: the city warehouse first, then the own groups standing in the city, the
largest ``charged`` first; the build time starts when it is paid in full; no refund), item 12
(the bunker: a city or a province, one per node, ``bunker.build_ticks = 100``, +1 virtual shot to
the node's defender in every fight there if it has a charged unit, destroyed on capture) and
item 13 (the province warehouse of capacity 1: recharge, line target, lost on capture), item 5
(``SetMode(DEFENSE)`` is removed), and the implementation notes of #645 under that block.

Map ``dec41`` (see ``test_dec41.py``): player 0 owns K = 0 (capital), A = 1 (large), B, C, D =
2, 3, 4 (medium), E, F, G = 5, 6, 7 (small); M = 8 is a neutral province (plains, like every
node). Warehouse capacities of ``mvp-3``: capital 6, large and medium 2, small 1, province 1.
"""

import json
from pathlib import Path

from gow_sim.commands import (
    BuildBarracks,
    BuildBunker,
    BuildFactory,
    Command,
    DrawLine,
    Ok,
    PlayerCommand,
    Reject,
    RejectCode,
    SetMode,
    UpgradeWarehouse,
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
    Fight,
    GameState,
    Group,
    Line,
    Mode,
    event,
    from_canonical,
    initial_state,
    to_canonical,
)
from gow_sim.systems.build import build
from gow_sim.systems.capacity import change_owner, warehouse_capacity
from gow_sim.systems.combat import combat
from gow_sim.systems.lines import supply_lines

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[2]
RULES = load_ruleset(ROOT / "rulesets" / "mvp-3.toml")
V1 = load_ruleset(ROOT / "rulesets" / "mvp-2.toml")
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
    assert state.nodes[B].build == Build(None, 0, 10, BuildKind.BARRACKS, owed=0)
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
    assert state.nodes[B].build == Build(None, 0, 50, BuildKind.BARRACKS, owed=0)
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
    assert state.nodes[B].build == Build(None, 0, 13, BuildKind.BARRACKS, owed=0)


def test_a_warehouse_level_costs_2_charges() -> None:
    state = _state()
    state.nodes[B].warehouse = 2
    assert isinstance(_cmd(state, UpgradeWarehouse(B)), Ok)
    assert state.nodes[B].warehouse == 0
    assert _paid(state.events) == [(10, "warehouse", 2, 0, 0)]
    assert _builds_until(state, 110) == [
        event(110, "warehouse_upgraded", player=0, node=B, level=1)
    ]


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
        event(
            20, "build_stopped", player=0, node=B, kind="barracks", edge=None, reason="interrupted"
        )
    ]
    assert (state.nodes[B].warehouse, group.charged, state.nodes[B].build) == (0, 0, None)


def test_v1_buildings_stay_cp_priced_without_charges() -> None:
    """v1 unchanged: ``mvp-2`` takes CP for the barracks and no charges."""
    state = initial_state(MAP, V1)
    state.tick = 10
    state.nodes[B].warehouse = 2
    cp = state.players[0].cp
    assert _cmd(state, BuildBarracks(B), rules=V1) == Ok(cost=V1.orders.cost.barracks, path=())
    assert state.players[0].cp == cp - V1.orders.cost.barracks
    assert state.nodes[B].warehouse == 2 and _paid(state.events) == []


# Item 12: the bunker ------------------------------------------------------------------------------


def test_a_bunker_in_a_province_costs_3_charges_and_takes_100_ticks() -> None:
    """Item 12: a province too; cost 3 (the province warehouse 1 + 2 from a group), 100 ticks
    after the full payment; one per node."""
    state = _state()
    state.nodes[M].owner = 0
    state.nodes[M].warehouse = 1
    group = _group(state, M, 3, 3)
    cp = state.players[0].cp
    assert _cmd(state, BuildBunker(M)) == Ok(cost=0, path=())
    assert state.players[0].cp == cp
    assert (state.nodes[M].warehouse, group.charged) == (0, 1)
    assert event(10, "build_started", player=0, node=M, kind="fort", level=None) in state.events
    assert _paid(state.events) == [(10, "fort", 1, 2, 0)]
    assert _code(_cmd(state, BuildBunker(M))) is RejectCode.ALREADY_BUILT
    events = _builds_until(state, 110)
    assert events == [event(110, "fort_built", player=0, node=M)]
    assert state.nodes[M].fort and state.nodes[M].fort_build is None
    assert _code(_cmd(state, BuildBunker(M))) is RejectCode.ALREADY_BUILT


def test_build_bunker_checks() -> None:
    state = _state()
    assert _code(_cmd(state, BuildBunker(99))) is RejectCode.NOT_FOUND_OR_HIDDEN
    assert _code(_cmd(state, BuildBunker(16))) is RejectCode.NOT_OWNER
    assert _code(_cmd(state, BuildBunker(M))) is RejectCode.NOT_OWNER  # neutral
    assert isinstance(_cmd(state, BuildBunker(B)), Ok)  # a city; unpaid, it waits
    assert isinstance(_cmd(state, BuildBarracks(B)), Ok)  # its own slot, no CITY_BUSY


def test_the_bunker_and_defense_are_of_the_other_model() -> None:
    """Item 5 and 14: ``SetMode(DEFENSE)`` is removed under v2 (the bunker replaces it);
    ``BuildBunker`` is a v2 command. ``SetMode(ATTACK)`` stays."""
    state = _state()
    group = _group(state, K, 1, 1)
    assert _code(_cmd(state, SetMode(group.id, Mode.DEFENSE))) is RejectCode.FEATURE_DISABLED
    assert _code(_cmd(state, SetMode(group.id, Mode.ATTACK))) is RejectCode.NO_CHANGE
    v1 = initial_state(MAP, V1)
    v1.tick = 10
    assert _code(_cmd(v1, BuildBunker(K), rules=V1)) is RejectCode.FEATURE_DISABLED


def _contact(state: GameState, node: int, defender_charged: int) -> Fight:
    """A group 2/``defender_charged`` of player 0 stands in its ``node``; a group 2/2 of player 1
    has just arrived there over its first road. Returns the fight that starts."""
    state.tick = 200
    _group(state, node, 2, defender_charged)
    attacker = _group(state, node, 2, 2, owner=1)
    road = state.map.incident[node][0]
    state.events = [
        event(
            200,
            "group_arrived",
            group=attacker.id,
            player=1,
            node=node,
            edge=road,
            from_node=state.map.edges[road].other(node),
            back=False,
            planned=False,
            level=1,
        )
    ]
    combat(state, RULES, {})
    (fight,) = state.fights.values()
    return fight


def test_the_bunker_gives_a_charged_defender_one_virtual_shot() -> None:
    """Item 12: +1 virtual shot to the defender (plains give none: ``max(0, -1) = 0``)."""
    state = _state()
    state.nodes[B].fort = True
    assert _contact(state, B, defender_charged=1).virtual == (1, 0)


def test_the_bunker_needs_a_charged_defender() -> None:
    """Item 12: "only if the defender has a charged unit" (as terrain, DEC-07 rule 1)."""
    state = _state()
    state.nodes[B].fort = True
    assert _contact(state, B, defender_charged=0).virtual == (0, 0)


def test_no_bunker_no_virtual_shot() -> None:
    state = _state()
    assert _contact(state, B, defender_charged=1).virtual == (0, 0)


def test_the_bunker_is_destroyed_on_capture() -> None:
    """Item 12: it does not pass to the capturer; a bunker build stops, nothing is returned."""
    state = _state()
    state.nodes[B].fort = True
    state.nodes[C].fort_build = FactoryBuild(owner=0, since=5, owed=1)
    state.tick = 20
    change_owner(state, B, 1)
    change_owner(state, C, 1)
    assert not state.nodes[B].fort
    assert build(state, RULES) == [
        event(20, "build_stopped", player=0, node=C, kind="fort", edge=None, reason="interrupted")
    ]
    assert not state.nodes[C].fort and state.nodes[C].fort_build is None


# Item 13: the province warehouse ---------------------------------------------------------------


def test_a_province_warehouse_holds_1_under_v2_only() -> None:
    v1 = initial_state(MAP, V1)
    assert warehouse_capacity(_state(), RULES, M) == 1
    assert warehouse_capacity(v1, V1, M) == 0


def test_units_recharge_from_a_province_warehouse() -> None:
    state = _state(11)
    state.nodes[M].owner = 0
    state.nodes[M].warehouse = 1
    group = _group(state, M, 2, 0)
    supply_lines(state, RULES)
    assert (group.charged, state.nodes[M].warehouse) == (1, 0)


def test_a_line_fills_a_province_to_1() -> None:
    """Item 13: a province is the target of a line; once it holds 1 the line is skipped (L6)."""
    state = _state(0)
    for n in (C, M):
        state.nodes[n].owner = 0
    state.players[0].lines[0] = Line(0, (K, A, B, C, M))
    state.players[0].next_line = 1
    sent = 0
    while state.tick < 400:
        state.tick += 1
        sent += sum(1 for e in supply_lines(state, RULES) if e.kind == "packet_sent")
    assert state.nodes[M].warehouse == 1 and sent == 1


def test_a_captured_province_loses_its_warehouse() -> None:
    """Item 13: "spoils on capture apply": the city rule of a capture, the warehouse is lost to
    its owner (``warehouse_lost``) and the capturer starts at 0."""
    state = _state()
    state.nodes[M].owner = 0
    state.nodes[M].warehouse = 1
    assert change_owner(state, M, 1) == [event(10, "warehouse_lost", node=M, owner=0, charges=1)]
    assert state.nodes[M].warehouse == 0


def test_a_line_to_a_province_is_drawn() -> None:
    state = _state()
    for n in (C, M):
        state.nodes[n].owner = 0
    assert isinstance(_cmd(state, DrawLine((K, A, B, C, M))), Ok)


# Canonical form -------------------------------------------------------------------------------


def test_owed_and_bunkers_round_trip_and_stay_out_of_a_v1_state() -> None:
    state = _state()
    state.nodes[B].build = Build(None, 0, 10, BuildKind.BARRACKS, owed=2)
    state.nodes[A].factory_build = FactoryBuild(owner=0, since=10, owed=3)
    state.nodes[C].fort = True
    state.nodes[D].fort_build = FactoryBuild(owner=0, since=7)
    data = to_canonical(state)
    assert from_canonical(data) == state
    v1 = json.dumps(to_canonical(initial_state(MAP, V1)))
    assert '"fort' not in v1 and '"owed"' not in v1
