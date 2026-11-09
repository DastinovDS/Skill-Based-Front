"""City development: the barracks and a warehouse apart from the capacity (DEC-26, #265): table
tests of the worked examples (mechanics.md, section 8) that the kept rules still have.

Expected values come from the decision, not from the code, read with the decisions that came
after it: the barracks is paid in charges (``city_upgrades.barracks_charges = 3``, progressively,
DEC-41 item 7; no CP), the warehouses are fixed (capital 6, every city 3, a province 1: DEC-43
item C, DEC-41 item 13), only the capital keeps the start stock of the map (DEC-41, item 9). The
warehouse levels and the roads paid with CP (examples 7, 8, 10-15, 19, 21-23) were removed with
economy v1 (#894). Numbers: ``barracks_ticks = 100``; CP regeneration not counted
(``cp.per_period = 0``). These numbers are pinned in ``RULES`` (from ``mvp-7.toml``), so balance
changes do not break the rule tests.

Map ``dec22``: K = 0 (capital of 0) -e0- A = 1 -e1- B = 2 (medium; B starts neutral, the tests give
it to player 0), P = 3 a province at A (e2); B -e3- 5 (medium, the tests give it to player 1).
The ticks run through the full ``Match.step``.
"""

import dataclasses
from pathlib import Path

import pytest

from gow_sim.commands import (
    BuildBarracks,
    Command,
    Ok,
    PlayerCommand,
    Recruit,
    Reject,
    RejectCode,
    validate,
)
from gow_sim.maps import NodeKind, load_map
from gow_sim.match import Match
from gow_sim.ruleset import (
    CityKindTable,
    CityUpgradeRules,
    KindTable,
    Ruleset,
    WarehouseRules,
    load_ruleset,
)
from gow_sim.state import (
    AtNode,
    Build,
    Event,
    GameState,
    Group,
    Mode,
    Node,
    Packet,
    initial_state,
)
from gow_sim.systems.capacity import change_owner, warehouse_capacity
from gow_sim.view import BuildingView, BuildKind

TESTS_DIR = Path(__file__).resolve().parent
MVP7 = TESTS_DIR.parents[2] / "rulesets" / "mvp-7.toml"
K, A, B, P, ENEMY = 0, 1, 2, 3, 5
AB, AP = 1, 2
T = 1000
"""The tick of the first command of the examples."""


def _rules() -> Ruleset:
    base = load_ruleset(MVP7)
    return dataclasses.replace(
        base,
        cp=dataclasses.replace(base.cp, cap=500, per_period=0),
        orders=dataclasses.replace(
            base.orders,
            cost=dataclasses.replace(base.orders.cost, barracks=0, recruit=100),
        ),
        capacity=dataclasses.replace(
            base.capacity,
            by_kind=KindTable(capital=10, city_large=8, city_medium=6, city_small=4, province=3),
        ),
        city_upgrades=CityUpgradeRules(barracks_ticks=100, barracks_charges=3),
        warehouse=WarehouseRules(
            start_by_kind=CityKindTable(capital=6, city_large=3, city_medium=3, city_small=3),
            province=1,
        ),
        map_tempo=None,
    )


RULES = _rules()


class _Run:
    """A match on ``dec22`` at tick ``T - 1``: A and B own, 5 the enemy's, CP 500."""

    def __init__(self, rules: Ruleset = RULES) -> None:
        self.rules = rules
        self.match = Match(load_map(TESTS_DIR / "maps" / "dec22.json"), rules, bytes(range(32)))
        self.state = self.match.state
        self.state.tick = T - 1
        self.state.nodes[B].owner, self.state.nodes[ENEMY].owner = 0, 1
        self.state.players[0].cp = 500
        self.seq = 0
        self.events: list[Event] = []

    def step(self, *cmds: Command, player: int = 0) -> list[Ok | Reject]:
        batch = [PlayerCommand(player, self.seq + i, cmd) for i, cmd in enumerate(cmds)]
        self.seq += len(cmds)
        self.events += self.match.step(batch)
        return [r.outcome for r in self.match.results]

    def until(self, tick: int) -> None:
        while self.state.tick < tick:
            self.step()

    def of(self, kind: str) -> list[tuple[int, dict[str, object]]]:
        return [(e.tick, dict(e.data)) for e in self.events if e.kind == kind]

    def node(self, n: int) -> Node:
        return self.state.nodes[n]


def _check(state: GameState, cmd: Command, rules: Ruleset = RULES) -> Ok | Reject:
    return validate(state, rules, 0, cmd)


def _kind(state: GameState, node: int, kind: NodeKind) -> None:
    """Give ``node`` another kind (the warehouse table by kind needs every kind)."""
    nodes = list(state.map.nodes)
    nodes[node] = dataclasses.replace(nodes[node], kind=kind)
    state.map = dataclasses.replace(state.map, nodes=tuple(nodes))


# 1: the warehouse capacity by kind --------------------------------------------------------------


@pytest.mark.parametrize(
    ("kind", "cap"),
    [
        (NodeKind.CAPITAL, 6),
        (NodeKind.CITY_LARGE, 3),
        (NodeKind.CITY_MEDIUM, 3),
        (NodeKind.CITY_SMALL, 3),
        (NodeKind.PROVINCE, 1),  # DEC-41, item 13
    ],
)
def test_example_1_warehouse_capacity_by_kind(kind: NodeKind, cap: int) -> None:
    state = _Run().state
    _kind(state, A, kind)
    assert warehouse_capacity(state, RULES, A) == cap


# 2-6: the barracks ------------------------------------------------------------------------------


def test_example_2_no_recruit_without_barracks() -> None:
    run = _Run()
    assert run.step(Recruit(A)) == [Reject(RejectCode.NO_BARRACKS)]
    assert run.node(K).has_barracks and not run.node(A).has_barracks


def test_example_3_barracks_100_ticks_after_the_payment() -> None:
    run = _Run()
    run.node(A).warehouse = 3  # setup: the 3 charges of the barracks in A's warehouse
    assert run.step(BuildBarracks(A)) == [Ok(cost=0)]
    assert run.of("build_started") == [(T, {"player": 0, "node": A, "kind": "barracks"})]
    assert run.of("build_paid") == [
        (T, {"player": 0, "node": A, "kind": "barracks", "warehouse": 3, "units": 0, "owed": 0})
    ]
    run.until(T + 99)
    assert not run.node(A).has_barracks
    assert run.step(Recruit(A)) == [Reject(RejectCode.NO_BARRACKS)]  # tick 1100: before build
    assert run.of("barracks_built") == [(T + 100, {"player": 0, "node": A})]
    assert run.node(A).has_barracks
    assert run.step(Recruit(A)) == [Ok(cost=100)]  # tick 1101


def test_example_4_the_capital_has_its_barracks() -> None:
    assert _check(_Run().state, BuildBarracks(K)) == Reject(RejectCode.ALREADY_BUILT)


def test_example_6_a_province_builds_nothing() -> None:
    run = _Run()
    run.node(P).owner = 0
    assert _check(run.state, BuildBarracks(P)) == Reject(RejectCode.NOT_CITY)


def test_example_9_one_build_per_city() -> None:
    run = _Run()
    run.step(BuildBarracks(A))
    run.until(T + 49)
    assert run.step(BuildBarracks(A)) == [Reject(RejectCode.CITY_BUSY)]  # tick 1050


# 16-17: capture -------------------------------------------------------------------------------


def test_example_16_the_captor_gets_the_barracks() -> None:
    run = _Run()
    b = run.node(B)
    b.has_barracks, b.warehouse = True, 3
    b.recruit_queue = 1
    events = change_owner(run.state, B, 1)
    assert (b.owner, b.has_barracks, b.warehouse) == (1, True, 0)
    assert [(e.kind, e.get("owner")) for e in events if e.kind == "warehouse_lost"] == [
        ("warehouse_lost", 0)
    ]
    assert b.recruit_queue == 0  # DEC-25, item 10
    run.state.players[1].cp = 500
    assert validate(run.state, RULES, 1, Recruit(B)) == Ok(cost=100)


def test_example_17_a_capture_interrupts_the_barracks_build() -> None:
    run = _Run()
    run.node(A).warehouse = 3
    run.step(BuildBarracks(A))
    run.until(T + 49)
    change_owner(run.state, A, 1)  # tick 1050: A captured
    run.until(T + 50)
    assert run.of("build_stopped") == [
        (T + 50, {"player": 0, "node": A, "kind": "barracks", "reason": "interrupted"})
    ]
    run.until(T + 150)
    assert not run.node(A).has_barracks


# 18, 20: where the warehouse capacity counts --------------------------------------------------


def test_example_18_a_full_warehouse_burns_the_rest_of_a_packet() -> None:
    run = _Run()
    state = run.state
    run.node(B).warehouse = 2  # one charge of room in B's warehouse of 3
    pid = state.new_id()
    state.packets[pid] = Packet(pid, 0, AB, A, charges=2, depart_tick=T - 29, arrive_tick=T)
    run.until(T)
    assert run.node(B).warehouse == 3
    assert [d["charges"] for _, d in run.of("charges_overflow")] == [1]


def test_example_20_the_start_stock_is_cut_to_the_warehouse() -> None:
    # Example 20 with DEC-41, item 9: only the capital keeps the start stock of the map, cut to
    # its warehouse of 6; every other city starts empty.
    mapdef = load_map(TESTS_DIR.parents[2] / "maps" / "fixtures" / "artery.json")
    nodes = tuple(
        dataclasses.replace(n, start_stock=9 if n.capital_of is not None else 2)
        for n in mapdef.nodes
    )
    state = initial_state(dataclasses.replace(mapdef, nodes=nodes), RULES)
    capitals = {n.id for n in mapdef.nodes if n.capital_of is not None}
    assert {state.nodes[i].warehouse for i in capitals} == {6}
    assert {state.nodes[n.id].warehouse for n in mapdef.nodes if n.id not in capitals} == {0}


# Further rules: check order, the view and the fog --------------------------------------------


def test_check_order_of_the_barracks() -> None:
    """DEC-26, item 9: NOT_FOUND_OR_HIDDEN, NOT_OWNER, NOT_CITY, ALREADY_BUILT, CITY_BUSY; no
    NOT_SUPPLIED (item 8)."""
    state = _Run().state
    for cmd in (BuildBarracks(99), BuildBarracks(-1)):
        assert _check(state, cmd) == Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
    assert _check(state, BuildBarracks(ENEMY)) == Reject(RejectCode.NOT_OWNER)
    assert _check(state, BuildBarracks(P)) == Reject(RejectCode.NOT_OWNER)  # neutral
    state.nodes[A].build = Build(owner=0, since=T - 1, owed=3)
    assert _check(state, BuildBarracks(A)) == Reject(RejectCode.CITY_BUSY)
    state.nodes[A].build = None
    state.nodes[K].owner = 1  # A and B cut off from the capital: still allowed (item 8)
    assert _check(state, BuildBarracks(A)) == Ok(cost=0)


def test_recruit_check_order() -> None:
    """DEC-26, barracks item 4: NO_BARRACKS after NOT_CITY."""
    state = _Run().state
    state.nodes[P].owner = 0
    assert _check(state, Recruit(P)) == Reject(RejectCode.NOT_CITY)
    assert _check(state, Recruit(A)) == Reject(RejectCode.NO_BARRACKS)
    state.nodes[A].has_barracks = True
    assert _check(state, Recruit(A)) == Ok(cost=100)


def test_own_city_shows_barracks_warehouse_and_building() -> None:
    """DEC-26, item 10: own cities only; ``building`` with its kind, the charges it still owes and
    no end tick before the full payment (DEC-41, item 7)."""
    run = _Run()
    run.step(BuildBarracks(A))  # A's warehouse is empty: it owes all 3
    view = run.match.view(0)
    k, a = view.nodes[K], view.nodes[A]
    assert (k.has_barracks, k.warehouse_cap, k.building) == (True, 6, None)
    assert (a.has_barracks, a.warehouse_cap) == (False, 3)
    assert a.building == BuildingView(kind=BuildKind.BARRACKS, done_tick=None, owed=3)
    province = view.nodes[P]
    assert (province.has_barracks, province.warehouse_cap, province.building) == (None, None, None)


def test_fog_the_enemy_city_development_is_hidden() -> None:
    """DEC-26, item 10: the enemy's barracks and builds never reach the view, not even with an own
    group in the enemy city (exact detail). B is neutral here: with an own node next to it the
    enemy city shows its built barracks (DEC-31, ``test_dec31.py``)."""
    run = _Run()
    state = run.state
    state.nodes[B].owner = None
    gid = state.new_id()
    state.groups[gid] = Group(gid, 0, 1, 1, Mode.ATTACK, AtNode(ENEMY))  # 5 seen exactly
    before = run.match.view(0)
    enemy = before.nodes[ENEMY]
    assert enemy.warehouse is not None  # exact
    assert (enemy.has_barracks, enemy.warehouse_cap) == (None, None)
    assert enemy.building is None
    e = state.nodes[ENEMY]
    e.has_barracks = True
    e.build = Build(owner=1, since=T - 1, owed=2)
    assert run.match.view(0) == before
