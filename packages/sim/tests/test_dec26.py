"""City development: the barracks, a warehouse apart from the capacity, roads without a type
(DEC-26, #265): table tests of the 23 worked examples (mechanics.md, section 8).

Expected values come from the decision, not from the code. The setting of the examples
(``city_upgrades.enabled = true`` except rows 13-15, 22 and 23): A, B own cities in the supplied
territory, A medium (warehouse level 0, capacity 2), K the capital; the road A-B internal, level
1, ``max_level`` 3, ``travel_ticks = 30``; CP regeneration not counted. Numbers:
``orders.cost.barracks = 300``, ``orders.cost.warehouse = 200``, ``barracks_ticks`` and
``warehouse_ticks`` 100, warehouse start capital 6 / large 2 / medium 2 / small 1, +1 per level, at
most 2 levels; roads paid with CP since DEC-28 (``orders.cost.build = 50`` per level, rows 9-14
and 23 recounted, row 13 gone), 150 ticks per level; packet speed 150 / 200 on level 2 / 3,
``amount`` 1 / 2 / 3 by level (DEC-28). These numbers are pinned in ``RULES`` (from
``mvp-1.toml``), so balance changes do not break the rule tests.

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
    Transfer,
    UpgradeRoad,
    UpgradeWarehouse,
    validate,
)
from gow_sim.maps import NodeKind, load_map
from gow_sim.match import Match
from gow_sim.ruleset import (
    BuildRules,
    CityKindTable,
    CityUpgradeRules,
    FullLevelTable,
    KindTable,
    LevelTable,
    RecruitLocation,
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
from gow_sim.systems.supply import city_target, edge_packet_ticks
from gow_sim.view import BuildingView, BuildKind

TESTS_DIR = Path(__file__).resolve().parent
MVP1 = TESTS_DIR.parents[2] / "rulesets" / "mvp-1.toml"
K, A, B, P, ENEMY = 0, 1, 2, 3, 5
AB, AP = 1, 2
T = 1000
PRICE = 50
"""``orders.cost.build``: 0,5 CP per road level (DEC-28, item 7)."""
"""The tick of the first command of the examples."""


def _rules(enabled: bool = True) -> Ruleset:
    base = load_ruleset(MVP1)
    return dataclasses.replace(
        base,
        cp=dataclasses.replace(base.cp, cap=500, per_period=0),
        orders=dataclasses.replace(
            base.orders,
            cost=dataclasses.replace(
                base.orders.cost, barracks=300, warehouse=200, recruit=100, build=PRICE
            ),
        ),
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
        city_upgrades=CityUpgradeRules(enabled=enabled, barracks_ticks=100, warehouse_ticks=100),
        warehouse=WarehouseRules(
            gain_per_level=1,
            max_level=2,
            start_by_kind=CityKindTable(capital=6, city_large=2, city_medium=2, city_small=1),
        ),
    )


RULES = _rules()
OFF = _rules(enabled=False)


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

    @property
    def cp(self) -> int:
        return self.state.players[0].cp


def _check(state: GameState, cmd: Command, rules: Ruleset = RULES) -> Ok | Reject:
    return validate(state, rules, 0, cmd)


def _kind(state: GameState, node: int, kind: NodeKind) -> None:
    """Give ``node`` another kind (the warehouse table by kind needs every kind)."""
    nodes = list(state.map.nodes)
    nodes[node] = dataclasses.replace(nodes[node], kind=kind)
    state.map = dataclasses.replace(state.map, nodes=tuple(nodes))


# 1: the warehouse capacity by kind and level ---------------------------------------------------


@pytest.mark.parametrize(
    ("kind", "caps"),
    [
        (NodeKind.CAPITAL, [6, 7, 8]),
        (NodeKind.CITY_LARGE, [2, 3, 4]),
        (NodeKind.CITY_MEDIUM, [2, 3, 4]),
        (NodeKind.CITY_SMALL, [1, 2, 3]),
        (NodeKind.PROVINCE, [0, 0, 0]),  # no warehouse
    ],
)
def test_example_1_warehouse_capacity_by_kind_and_level(kind: NodeKind, caps: list[int]) -> None:
    state = _Run().state
    _kind(state, A, kind)
    found: list[int] = []
    for level in (0, 1, 2):
        state.nodes[A].warehouse_level = level
        found.append(warehouse_capacity(state, RULES, A))
    assert found == caps


# 2-6: the barracks ------------------------------------------------------------------------------


def test_example_2_no_recruit_without_barracks() -> None:
    run = _Run()
    assert run.step(Recruit(A)) == [Reject(RejectCode.NO_BARRACKS)]
    assert run.node(K).has_barracks and not run.node(A).has_barracks


def test_example_3_barracks_after_100_ticks() -> None:
    run = _Run()
    assert run.step(BuildBarracks(A)) == [Ok(cost=300)]
    assert run.cp == 200
    assert run.of("build_started") == [
        (T, {"player": 0, "node": A, "kind": "barracks", "level": None})
    ]
    run.until(T + 99)
    assert not run.node(A).has_barracks
    assert run.step(Recruit(A)) == [Reject(RejectCode.NO_BARRACKS)]  # tick 1100: before build
    assert run.of("barracks_built") == [(T + 100, {"player": 0, "node": A})]
    assert run.node(A).has_barracks
    assert run.step(Recruit(A)) == [Ok(cost=100)]  # tick 1101


def test_example_4_the_capital_has_its_barracks() -> None:
    assert _check(_Run().state, BuildBarracks(K)) == Reject(RejectCode.ALREADY_BUILT)


def test_example_5_barracks_cost_3_cp() -> None:
    run = _Run()
    run.state.players[0].cp = 200
    assert run.step(BuildBarracks(A)) == [Reject(RejectCode.NOT_ENOUGH_CP)]


def test_example_6_a_province_builds_nothing() -> None:
    run = _Run()
    run.node(P).owner = 0
    assert _check(run.state, BuildBarracks(P)) == Reject(RejectCode.NOT_CITY)
    assert _check(run.state, UpgradeWarehouse(P)) == Reject(RejectCode.NOT_CITY)


# 7-9: the warehouse and the shared build ----------------------------------------------------


def test_example_7_warehouse_level_1() -> None:
    run = _Run()
    assert run.step(UpgradeWarehouse(A)) == [Ok(cost=200)]
    assert run.cp == 300
    run.until(T + 99)
    assert run.node(A).warehouse_level == 0
    run.until(T + 100)
    assert run.node(A).warehouse_level == 1
    assert warehouse_capacity(run.state, RULES, A) == 3
    assert run.of("warehouse_upgraded") == [(T + 100, {"player": 0, "node": A, "level": 1})]


def test_example_8_two_levels_then_warehouse_max() -> None:
    run = _Run()
    run.step(UpgradeWarehouse(A))
    run.until(T + 100)
    assert run.step(UpgradeWarehouse(A)) == [Ok(cost=200)]  # tick 1101
    assert run.cp == 100
    run.until(T + 200)
    assert run.node(A).warehouse_level == 1
    run.until(T + 201)
    assert run.node(A).warehouse_level == 2
    assert warehouse_capacity(run.state, RULES, A) == 4
    run.state.players[0].cp = 500
    assert run.step(UpgradeWarehouse(A)) == [Reject(RejectCode.WAREHOUSE_MAX)]


def test_example_9_one_build_per_city() -> None:
    run = _Run()
    run.node(A).warehouse = 2
    run.step(BuildBarracks(A))
    run.until(T + 49)
    assert run.step(UpgradeWarehouse(A)) == [Reject(RejectCode.CITY_BUSY)]  # tick 1050
    assert run.step(UpgradeRoad(AB)) == [Ok(cost=PRICE)]  # roads take no city slot (DEC-28)


# 10-15: roads without a type, paid with CP (DEC-28, item 7) ------------------------------------


def test_examples_10_11_two_road_levels_for_cp() -> None:
    run = _Run()
    run.node(A).warehouse_level = 1  # capacity 3
    run.node(A).warehouse = 3
    run.node(B).warehouse = 2  # B full: A forwards nothing (DEC-28: no deficit)
    cp = run.state.players[0].cp
    assert run.step(UpgradeRoad(AB)) == [Ok(cost=PRICE)]
    assert run.node(A).warehouse == 3 and run.state.players[0].cp == cp - PRICE
    run.until(T + 149)
    assert run.state.edges[AB].width == 1
    run.until(T + 150)
    assert run.state.edges[AB].width == 2
    assert edge_packet_ticks(run.state, RULES, AB) == 20  # 30 * 100 // 150
    assert run.step(UpgradeRoad(AB)) == [Ok(cost=PRICE)]  # tick 1151
    assert run.node(A).warehouse == 3
    run.until(T + 300)
    assert run.state.edges[AB].width == 2
    run.until(T + 301)
    assert run.state.edges[AB].width == 3
    assert edge_packet_ticks(run.state, RULES, AB) == 15  # 30 * 100 // 200


def test_example_12_the_warehouse_takes_no_part() -> None:
    run = _Run()
    run.node(A).warehouse = 1
    run.state.edges[AB].width = 2
    assert _check(run.state, UpgradeRoad(AB)) == Ok(cost=PRICE)


@pytest.mark.parametrize("rules", [RULES, OFF], ids=["on", "off"])
def test_example_14_level_3_carries_three_charges_per_period(rules: Ruleset) -> None:
    run = _Run(rules)
    run.state.edges[AB].width = 3
    run.node(A).warehouse_level = 2  # capacity 4 with the flag
    run.node(A).warehouse = 4
    run.state.players[0].fronts = (B, None)  # B wants a full warehouse: more than a road carries
    run.node(B).warehouse = 0
    run.node(B).warehouse_level = 2  # with the flag: room 4, more than the road carries
    run.until(T + 1)  # tick 1000 is a dispatch tick
    sent = [d["charges"] for _, d in run.of("packet_sent") if d["edge"] == AB]
    assert sent == [3]


@pytest.mark.parametrize("rules", [RULES, OFF], ids=["on", "off"])
def test_example_15_a_packet_to_a_captured_city_is_lost(rules: Ruleset) -> None:
    run = _Run(rules)
    state = run.state
    pid = state.new_id()
    state.packets[pid] = Packet(pid, 0, AB, A, charges=2, depart_tick=T - 1, arrive_tick=T + 29)
    change_owner(state, B, 1)
    run.until(T + 40)
    assert [d["charges"] for _, d in run.of("packet_lost")] == [2]
    assert run.of("packet_captured") == []
    assert run.node(B).warehouse == 0


# 16-17: capture -------------------------------------------------------------------------------


def test_example_16_the_captor_gets_the_barracks_and_the_level() -> None:
    run = _Run()
    b = run.node(B)
    b.has_barracks, b.warehouse_level, b.warehouse = True, 2, 3
    b.recruit_queue = 1
    events = change_owner(run.state, B, 1)
    assert (b.owner, b.has_barracks, b.warehouse_level, b.warehouse) == (1, True, 2, 0)
    assert warehouse_capacity(run.state, RULES, B) == 4
    assert [(e.kind, e.get("owner")) for e in events if e.kind == "warehouse_lost"] == [
        ("warehouse_lost", 0)
    ]
    assert b.recruit_queue == 0  # DEC-25, item 10
    run.state.players[1].cp = 500
    assert validate(run.state, RULES, 1, Recruit(B)) == Ok(cost=100)


def test_example_17_a_capture_interrupts_the_warehouse_build() -> None:
    run = _Run()
    run.step(UpgradeWarehouse(A))
    run.until(T + 49)
    change_owner(run.state, A, 1)  # tick 1050: A captured
    run.until(T + 50)
    assert run.of("build_stopped") == [
        (
            T + 50,
            {"player": 0, "node": A, "kind": "warehouse", "edge": None, "reason": "interrupted"},
        )
    ]
    assert run.cp == 300  # not returned
    run.until(T + 150)
    assert run.node(A).warehouse_level == 0


# 18-21: where the warehouse capacity counts ---------------------------------------------------


def test_example_18_a_small_warehouse_burns_the_rest_of_a_packet() -> None:
    run = _Run()
    state = run.state
    _kind(state, B, NodeKind.CITY_SMALL)  # S: capacity 1, empty
    pid = state.new_id()
    state.packets[pid] = Packet(pid, 0, AB, A, charges=2, depart_tick=T - 29, arrive_tick=T)
    run.until(T)
    assert run.node(B).warehouse == 1
    assert [d["charges"] for _, d in run.of("charges_overflow")] == [1]


def test_example_19_target_of_a_small_rear_city() -> None:
    """Example 19 [заменено DEC-28]: no ``supply.buffer``; a rear city keeps
    ``min(rear_min, warehouse capacity)``: S with ``rear_min = 1`` keeps 1, and a warehouse of 2 at
    ``rear_min = 3`` keeps ``min(3, 2) = 2`` (DEC-28, «Накопление: граничные случаи»)."""
    state = _Run().state
    state.players[0].rear_min = 1
    assert city_target(state, 0, B, warehouse_cap=1, front=False) == 1
    state.players[0].rear_min = 3
    assert city_target(state, 0, B, warehouse_cap=2, front=False) == 2


def test_example_20_the_start_stock_is_cut_to_the_warehouse() -> None:
    mapdef = load_map(TESTS_DIR.parents[2] / "maps" / "arteriya.json")
    small = [n for n in mapdef.nodes if n.kind is NodeKind.CITY_SMALL and n.start_stock == 2]
    assert small, "the MVP maps give small cities a start stock of 2"
    state = initial_state(mapdef, RULES)
    assert {state.nodes[n.id].warehouse for n in small} == {1}
    assert {initial_state(mapdef, OFF).nodes[n.id].warehouse for n in small} == {2}


def test_example_21_a_transfer_into_a_small_warehouse() -> None:
    run = _Run()
    run.node(A).warehouse_level = 1  # A has 3 charges to send: capacity 3
    run.node(A).warehouse = 3
    run.node(B).warehouse = 1  # B: medium, level 0, capacity 2
    run.step(Transfer(A, B, 3))  # cut to the free room of B: 1 (DEC-18, #287)
    assert run.node(A).warehouse == 2
    run.until(T + 30)  # one batch, 30 ticks
    assert run.node(B).warehouse == 2
    assert run.of("charges_overflow") == []


# 22-23: the flag off --------------------------------------------------------------------------


def test_example_22_without_the_flag() -> None:
    run = _Run(OFF)
    assert _check(run.state, BuildBarracks(A), OFF) == Reject(RejectCode.FEATURE_DISABLED)
    assert _check(run.state, UpgradeWarehouse(A), OFF) == Reject(RejectCode.FEATURE_DISABLED)
    assert _check(run.state, Recruit(A), OFF) == Ok(cost=100)
    assert warehouse_capacity(run.state, OFF, A) == 6
    assert warehouse_capacity(run.state, OFF, K) == 10


def test_example_23_roads_for_cp_without_the_flag() -> None:
    run = _Run(OFF)
    run.node(A).warehouse = 6
    run.node(B).warehouse = 2  # B is at its target: the supply of tick 1000 leaves A alone
    assert run.step(UpgradeRoad(AB)) == [Ok(cost=PRICE)]
    assert run.node(A).warehouse == 6
    run.until(T + 150)
    assert run.state.edges[AB].width == 2


# Further rules: check order, the view and the fog --------------------------------------------


def test_check_order_of_the_city_builds() -> None:
    """DEC-26, item 9: FEATURE_DISABLED, NOT_FOUND_OR_HIDDEN, NOT_OWNER, NOT_CITY, ALREADY_BUILT /
    WAREHOUSE_MAX, CITY_BUSY, NOT_ENOUGH_CP; no NOT_SUPPLIED (item 8)."""
    state = _Run().state
    for cmd in (BuildBarracks(99), UpgradeWarehouse(-1)):
        assert _check(state, cmd) == Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
    assert _check(state, BuildBarracks(ENEMY)) == Reject(RejectCode.NOT_OWNER)
    assert _check(state, UpgradeWarehouse(P)) == Reject(RejectCode.NOT_OWNER)  # neutral
    state.nodes[A].warehouse_level = 2
    state.players[0].cp = 0
    assert _check(state, UpgradeWarehouse(A)) == Reject(RejectCode.WAREHOUSE_MAX)
    assert _check(state, BuildBarracks(A)) == Reject(RejectCode.NOT_ENOUGH_CP)
    state.nodes[K].owner = 1  # A and B cut off from the capital: still allowed (item 8)
    state.players[0].cp = 500
    assert _check(state, BuildBarracks(A)) == Ok(cost=300)


def test_recruit_check_order_with_the_flag() -> None:
    """DEC-26, barracks item 4: NO_BARRACKS after NOT_CITY, ``recruit.location`` not used."""
    rules = dataclasses.replace(
        RULES, recruit=dataclasses.replace(RULES.recruit, location=RecruitLocation.CAPITAL)
    )
    state = _Run().state
    state.nodes[P].owner = 0
    assert _check(state, Recruit(P), rules) == Reject(RejectCode.NOT_CITY)
    assert _check(state, Recruit(A), rules) == Reject(RejectCode.NO_BARRACKS)
    state.nodes[A].has_barracks = True
    assert _check(state, Recruit(A), rules) == Ok(cost=100)


def test_own_city_shows_barracks_warehouse_and_building() -> None:
    """DEC-26, item 10: own cities only; ``building`` with its kind and end tick."""
    run = _Run()
    run.step(UpgradeWarehouse(A))
    view = run.match.view(0)
    k, a = view.nodes[K], view.nodes[A]
    assert (k.has_barracks, k.warehouse_level, k.warehouse_cap, k.building) == (True, 0, 6, None)
    assert (a.has_barracks, a.warehouse_level, a.warehouse_cap) == (False, 0, 2)
    assert a.building == BuildingView(kind=BuildKind.WAREHOUSE, done_tick=T + 100)
    province = view.nodes[P]
    assert (province.has_barracks, province.warehouse_cap, province.building) == (None, None, None)


def test_fog_the_enemy_city_development_is_hidden() -> None:
    """DEC-26, item 10: the enemy's barracks, warehouse level and builds never reach the view,
    not even with an own group in the enemy city (exact detail)."""
    run = _Run()
    state = run.state
    gid = state.new_id()
    state.groups[gid] = Group(gid, 0, 1, 1, Mode.ATTACK, AtNode(ENEMY))  # 5 seen exactly
    before = run.match.view(0)
    enemy = before.nodes[ENEMY]
    assert enemy.warehouse is not None  # exact
    assert (enemy.has_barracks, enemy.warehouse_level, enemy.warehouse_cap) == (None, None, None)
    assert enemy.building is None
    e = state.nodes[ENEMY]
    e.has_barracks, e.warehouse_level = True, 2
    e.build = Build(edge=None, owner=1, since=T - 1, kind=BuildKind.BARRACKS)
    assert run.match.view(0) == before
