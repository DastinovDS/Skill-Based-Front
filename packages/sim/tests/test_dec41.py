"""Economy v2, part 1 (DEC-41, #642; implementation #644): the flag, ``mvp-3``, factories, lines.

Expected values come from mechanics.md, section 7, block "Economy v2 (DEC-41, #642)": items 1, 2,
3, 5, 8, 9, 14 and the implementation notes of #644 with their table R1-R5; the numbers of
``mvp-3`` from the same block (``factory.capital_period_ticks = 50``, ``built_period_ticks = 100``,
``cost = 4``, ``build_ticks = 100``, ``max = 3``, ``lines.max_out = 3``,
``supply.base_speed_pct = 150``). The breaking situations 1-4 of item 3 are scenario tests in
``scenarios/test_lines_scenarios.py``.

Map ``dec41`` (rot180): player 0 owns K = 0 (capital), A = 1 (large), B, C, D = 2, 3, 4
(medium), E, F, G = 5, 6, 7 (small); the roads K-A, A-B, B-C, A-D, A-E, B-F, B-G take 30 ticks,
D-C 57, K-E 42, C-M 48; M = 8 is a neutral province in the middle; player 1 owns the mirror,
``16 - n``; the neutral provinces 17..20 join the halves a second way. Warehouse capacities of
``mvp-3``: capital 6, large and medium 2, small 1.
"""

import tomllib
from dataclasses import replace
from pathlib import Path
from typing import Any, cast

import pytest

from gow_sim.commands import (
    BuildFactory,
    Command,
    DrawLine,
    Ok,
    PlayerCommand,
    Reject,
    RejectCode,
    RemoveLine,
    SetFront,
    SetRearMin,
    SetStance,
    Transfer,
    UpgradeRoad,
    apply_commands,
)
from gow_sim.maps import load_map
from gow_sim.ruleset import (
    EconomyModel,
    RulesetError,
    Stance,
    load_ruleset,
    parse_ruleset,
    ruleset_hash,
    to_canonical,
)
from gow_sim.state import (
    AtNode,
    Event,
    FactoryBuild,
    GameState,
    Group,
    Line,
    Mode,
    event,
    from_canonical,
    initial_state,
)
from gow_sim.state import (
    to_canonical as state_canonical,
)
from gow_sim.systems.build import build
from gow_sim.systems.capacity import capacity, change_owner, warehouse_capacity
from gow_sim.systems.economy import economy
from gow_sim.systems.lines import supply_lines

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[2]
RULESETS = ROOT / "rulesets"
RULES = load_ruleset(RULESETS / "mvp-3.toml")
V1 = load_ruleset(RULESETS / "mvp-2.toml")
MAP = load_map(TESTS_DIR / "maps" / "dec41.json")
K, A, B, C, D, E, F, G, M = range(9)


def _state(tick: int = 0) -> GameState:
    state = initial_state(MAP, RULES)
    state.tick = tick
    return state


def _cmd(state: GameState, cmd: Command, player: int = 0) -> Ok | Reject:
    results, events = apply_commands(state, RULES, [PlayerCommand(player, 0, cmd)])
    state.events.extend(events)
    return results[0].outcome


def _code(outcome: Ok | Reject) -> RejectCode | None:
    return outcome.code if isinstance(outcome, Reject) else None


def _lines(state: GameState, *paths: tuple[int, ...], player: int = 0) -> None:
    ps = state.players[player]
    for path in paths:
        ps.lines[ps.next_line] = Line(ps.next_line, path)
        ps.next_line += 1


def _supply_until(state: GameState, tick: int) -> list[Event]:
    events: list[Event] = []
    while state.tick < tick:
        state.tick += 1
        state.events = []
        events += supply_lines(state, RULES)
    return events


def _sent(events: list[Event]) -> list[tuple[int, object, object]]:
    """``(tick, from, to)`` of the line packets of player 0."""
    return [
        (e.tick, e.get("from_node"), e.get("to_node"))
        for e in events
        if e.kind == "packet_sent" and e.get("player") == 0
    ]


# The ruleset ------------------------------------------------------------------------------------


def _raw(path: Path) -> dict[str, Any]:
    return tomllib.loads(path.read_text(encoding="utf-8"))


def test_mvp3_is_mvp2_with_the_v2_keys() -> None:
    """The flag, the starting values of the DEC-41 block and nothing else changed (#644)."""
    expected = _raw(RULESETS / "mvp-2.toml")
    expected["economy"]["model"] = "v2"
    expected["economy"]["start_stock_capital_only"] = True
    expected["supply"]["base_speed_pct"] = 150
    expected["factory"] = {
        "capital_period_ticks": 50,
        "built_period_ticks": 100,
        "cost": 4,
        "build_ticks": 100,
        "max": 3,
    }
    expected["lines"] = {"max_out": 3}
    # #645, items 7, 12, 13: buildings paid in charges instead of CP, the bunker, the province
    # warehouse.
    expected["orders"]["cost"]["barracks"] = 0
    expected["orders"]["cost"]["warehouse"] = 0
    expected["city_upgrades"]["barracks_charges"] = 3
    expected["city_upgrades"]["warehouse_charges"] = 2
    expected["warehouse"]["province"] = 1
    expected["bunker"] = {"cost": 3, "build_ticks": 100, "shots": 1}
    # #646, items 10 and 11: the planned order costs as much as an ordinary one and gathers one
    # bonus per 30 ticks; a capture spends one charge.
    expected["orders"]["cost"]["planned_move"] = expected["orders"]["cost"]["move"]
    expected["orders"]["plan_ticks_per_bonus"] = 30
    expected["capture"]["charge_cost"] = 1
    assert to_canonical(RULES) == expected
    assert parse_ruleset(expected) == RULES
    assert RULES.v2 and RULES.economy.model is EconomyModel.V2


@pytest.mark.parametrize("name", ["mvp-0", "mvp-1", "mvp-2", "test-short"])
def test_the_v1_rulesets_are_v1_and_hash_as_before(name: str) -> None:
    """``economy.model`` defaults to ``v1`` and is not part of the hash at its default: the
    archived hash of each v1 ruleset still names it."""
    rules = load_ruleset(RULESETS / f"{name}.toml")
    assert not rules.v2 and rules.factory is None and rules.lines is None
    economy_data = to_canonical(rules)["economy"]
    assert isinstance(economy_data, dict) and "model" not in economy_data
    assert (RULESETS / "archive" / f"{ruleset_hash(rules)}.toml").is_file()


def test_v2_keys_are_required_with_v2_and_rejected_without() -> None:
    data = _raw(RULESETS / "mvp-3.toml")
    del data["lines"]
    with pytest.raises(RulesetError, match=r"^lines: missing key"):
        parse_ruleset(data)
    v1 = _raw(RULESETS / "mvp-2.toml")
    v1["factory"] = _raw(RULESETS / "mvp-3.toml")["factory"]
    with pytest.raises(RulesetError, match=r"^factory: only with economy.model = 'v2'"):
        parse_ruleset(v1)
    v1 = _raw(RULESETS / "mvp-2.toml")
    v1["economy"]["model"] = "v3"
    with pytest.raises(RulesetError, match=r"^economy\.model: expected one of"):
        parse_ruleset(v1)


# Item 1: no stances; item 5: the v1 commands -------------------------------------------------


def test_the_whole_cp_quantum_goes_to_cp() -> None:
    """Item 1: 100 hundredths per 50 ticks to CP, whatever the stance; the cap of 5 CP stays."""
    state = _state(49)
    state.players[0].stance = Stance.WAR
    start = state.players[0].cp
    state.tick = 50
    economy(state, RULES)
    assert state.players[0].cp == start + 100
    assert state.players[0].charge_acc == 0
    state.players[0].cp = 450
    state.tick = 100
    events = economy(state, RULES)
    assert state.players[0].cp == 500
    assert event(100, "cp_burned", player=0, cp=50) in events


@pytest.mark.parametrize(
    "cmd",
    [SetStance(Stance.WAR), SetFront(0, A), SetRearMin(2), Transfer(K, A, 1), UpgradeRoad(0)],
    ids=lambda c: type(c).__name__,
)
def test_the_v1_commands_are_disabled_in_v2(cmd: Command) -> None:
    """Item 5 and item 14: stances, front markers, the rear minimum, transfers, road upgrades."""
    state = _state(10)
    assert _code(_cmd(state, cmd)) is RejectCode.FEATURE_DISABLED


@pytest.mark.parametrize(
    "cmd", [BuildFactory(A), DrawLine((K, A)), RemoveLine(0)], ids=lambda c: type(c).__name__
)
def test_the_v2_commands_are_disabled_in_v1(cmd: Command) -> None:
    """Item 14: under v1 the new commands give ``FEATURE_DISABLED``."""
    state = initial_state(MAP, V1)
    results, _ = apply_commands(state, V1, [PlayerCommand(0, 0, cmd)])
    assert _code(results[0].outcome) is RejectCode.FEATURE_DISABLED


def test_no_starvation_in_v2() -> None:
    """Item 5: a city cut off from the capital keeps its charges (no DEC-19)."""
    state = _state()
    change_owner(state, A, 1)  # K is cut from B..G
    state.nodes[B].warehouse = 2
    gid = state.new_id()
    state.groups[gid] = Group(gid, 0, 3, 3, Mode.ATTACK, AtNode(B))
    for tick in range(1, 401):
        state.tick = tick
        assert not [e for e in capacity(state, RULES) if e.kind == "starvation"]
    assert state.nodes[B].warehouse == 2 and state.groups[gid].charged == 3
    assert state.nodes[B].cut_since is None


# Item 9: the starting supply -------------------------------------------------------------------


def _start_supply(rules_name: str, player: int) -> int:
    mapdef = load_map(ROOT / "maps" / "crossroads.json")
    state = initial_state(mapdef, load_ruleset(RULESETS / f"{rules_name}.toml"))
    stock = sum(n.warehouse for n in state.nodes.values() if n.owner == player)
    return stock + sum(g.charged for g in state.groups.values() if g.owner == player)


@pytest.mark.parametrize("player", [0, 1])
def test_crossroads_starts_with_22_charges_per_side(player: int) -> None:
    """Item 9: only the capital keeps its stock, the units stay charged: ``crossroads`` 30 -> 22."""
    assert _start_supply("mvp-2", player) == 30
    assert _start_supply("mvp-3", player) == 22


def test_only_the_capital_keeps_a_start_stock() -> None:
    state = _state()
    assert state.nodes[K].warehouse == 6
    assert [state.nodes[n].warehouse for n in (A, B, C, D, E, F, G)] == [0] * 7


# Item 2: factories -----------------------------------------------------------------------------


def test_the_capital_is_the_main_factory_from_the_start() -> None:
    state = _state()
    assert state.nodes[K].factory == 0 and state.nodes[16].factory == 1
    assert [n.id for n in state.nodes.values() if n.factory is not None] == [K, 16]


def test_the_capital_makes_a_charge_every_50_ticks() -> None:
    state = _state()
    state.nodes[K].warehouse = 4
    stock: list[int] = []
    for tick in range(1, 101):
        state.tick = tick
        economy(state, RULES)
        stock.append(state.nodes[K].warehouse)
    assert stock[48] == 4 and stock[49] == 5  # tick 49, tick 50
    assert stock[98] == 5 and stock[99] == 6  # tick 99, tick 100


def test_a_built_factory_makes_a_charge_every_100_ticks() -> None:
    state = _state()
    state.nodes[A].factory = 0
    made: list[Event] = []
    for tick in range(1, 101):
        state.tick = tick
        made += [e for e in economy(state, RULES) if e.get("node") == A]
    assert made == [event(100, "charges_produced", player=0, node=A, charges=1, spill=0)]
    assert state.nodes[A].warehouse == 1


def test_a_full_factory_warehouse_burns_the_charge() -> None:
    """R5: the capital is full (6): its charge of tick 50 burns (L6, the only production burn)."""
    state = _state(50)
    assert state.nodes[K].warehouse == warehouse_capacity(state, RULES, K) == 6
    events = economy(state, RULES)
    assert event(50, "charge_burned", player=0, node=K, charges=1) in events
    assert state.nodes[K].warehouse == 6


def _rich(state: GameState, node: int, charges: int = 4) -> None:
    """A warehouse that holds ``charges`` (two warehouse levels: 2 + 2)."""
    state.nodes[node].warehouse_level = 2
    state.nodes[node].warehouse = charges


def test_build_factory_costs_4_charges_and_takes_100_ticks() -> None:
    state = _state(10)
    _rich(state, A)
    cp = state.players[0].cp
    assert isinstance(_cmd(state, BuildFactory(A)), Ok)
    assert state.nodes[A].warehouse == 0
    assert state.players[0].cp == cp  # not CP-priced
    assert event(10, "build_started", player=0, node=A, kind="factory", level=None) in state.events
    events: list[Event] = []
    for tick in range(11, 111):
        state.tick = tick
        events = build(state, RULES)
        assert state.nodes[A].factory == (0 if tick >= 110 else None), tick
    assert events == [event(110, "factory_built", player=0, node=A)]


def test_build_factory_checks() -> None:
    state = _state(10)
    assert _code(_cmd(state, BuildFactory(99))) is RejectCode.NOT_FOUND_OR_HIDDEN
    assert _code(_cmd(state, BuildFactory(16))) is RejectCode.NOT_OWNER
    assert _code(_cmd(state, BuildFactory(K))) is RejectCode.ALREADY_BUILT
    state.nodes[M].owner = 0
    assert _code(_cmd(state, BuildFactory(M))) is RejectCode.NOT_CITY
    # #645, item 7: the payment is progressive, so an empty warehouse does not reject it.
    assert isinstance(_cmd(state, BuildFactory(A)), Ok)


def test_at_most_three_factories_with_the_capital_and_the_builds() -> None:
    """``factory.max = 3`` including the capital; a build under way counts."""
    state = _state(10)
    for node in (A, B, C):
        _rich(state, node)
    assert isinstance(_cmd(state, BuildFactory(A)), Ok)
    assert isinstance(_cmd(state, BuildFactory(B)), Ok)
    assert _code(_cmd(state, BuildFactory(C))) is RejectCode.FACTORY_LIMIT
    assert _code(_cmd(state, BuildFactory(A))) is RejectCode.ALREADY_BUILT
    assert state.nodes[C].warehouse == 4


def test_a_capture_stops_a_factory_build() -> None:
    state = _state(10)
    _rich(state, A)
    _cmd(state, BuildFactory(A))
    state.tick = 50
    change_owner(state, A, 1)
    events = build(state, RULES)
    assert events == [
        event(
            50, "build_stopped", player=0, node=A, kind="factory", edge=None, reason="interrupted"
        )
    ]
    assert state.nodes[A].factory is None and state.nodes[A].factory_build is None


def test_a_captured_factory_passes_as_a_built_one() -> None:
    """Item 2: the capturer has 1 factory (its capital) < 3: A becomes its factory with the built
    rate; a captured capital counts as a built factory too."""
    state = _state(1)
    state.nodes[A].factory = 0
    change_owner(state, A, 1)
    change_owner(state, K, 1)
    supply_lines(state, RULES)
    assert state.nodes[A].factory == 1 and state.nodes[K].factory == 1
    state.tick = 50
    produced = [e.get("node") for e in economy(state, RULES) if e.kind == "charges_produced"]
    assert K not in produced  # the built rate: 100 ticks, not 50
    state.tick = 100
    produced = [e.get("node") for e in economy(state, RULES) if e.kind == "charges_produced"]
    assert K in produced and A in produced


def test_a_captured_factory_is_destroyed_at_the_cap() -> None:
    """Item 2: the capturer has 3 factories already: the captured one is destroyed."""
    state = _state(1)
    state.nodes[A].factory = 0
    for node in (15, 14):  # player 1: its capital and two built factories
        state.nodes[node].factory = 1
    change_owner(state, A, 1)
    supply_lines(state, RULES)
    assert state.nodes[A].factory is None


def test_two_captures_at_the_cap_go_in_node_key_order() -> None:
    """Rule 6 of 4.1: player 1 can take one more factory; of A and B the one with the smaller
    ``node_key`` for player 1 (the mirror id: A -> 15, B -> 14) passes, so B."""
    state = _state(1)
    state.nodes[A].factory = state.nodes[B].factory = 0
    state.nodes[15].factory = 1  # player 1: capital + one built factory
    change_owner(state, A, 1)
    change_owner(state, B, 1)
    supply_lines(state, RULES)
    assert (state.nodes[A].factory, state.nodes[B].factory) == (None, 1)


# Item 3, items 6, L4: drawing lines --------------------------------------------------------------


def test_draw_and_remove_a_line() -> None:
    state = _state(10)
    cp = state.players[0].cp
    ok = _cmd(state, DrawLine((K, A, B)))
    assert ok == Ok(cost=0, path=(K, A, B))
    assert state.players[0].lines == {0: Line(0, (K, A, B))}
    assert isinstance(_cmd(state, DrawLine((B, C))), Ok)  # the target of a line is a source
    assert isinstance(_cmd(state, RemoveLine(0)), Ok)
    assert list(state.players[0].lines) == [1]
    assert _code(_cmd(state, RemoveLine(0))) is RejectCode.NOT_FOUND_OR_HIDDEN
    assert state.players[0].cp == cp  # free (L3)


@pytest.mark.parametrize(
    ("path", "code"),
    [
        ((K,), RejectCode.INVALID_ARGUMENT),
        ((K, 99), RejectCode.NOT_FOUND_OR_HIDDEN),
        ((K, A, B, C, M), RejectCode.NOT_OWNER),
        ((K, A, K), RejectCode.INVALID_ARGUMENT),  # not a simple path
        ((K, B), RejectCode.INVALID_ARGUMENT),  # no road K-B
        ((A, B), RejectCode.NOT_SOURCE),  # A is no factory and no target
    ],
)
def test_draw_line_checks(path: tuple[int, ...], code: RejectCode) -> None:
    state = _state(10)
    assert _code(_cmd(state, DrawLine(path))) is code


def test_a_line_ends_in_a_node_with_a_warehouse() -> None:
    """A city, or a province with its warehouse of 1 (item 13, #645); a node without a warehouse
    (a province under a ruleset with ``warehouse.province = 0``) is ``NOT_CITY``."""
    state = _state(10)
    state.nodes[M].owner = 0
    assert isinstance(_cmd(state, DrawLine((K, A, B, C, M))), Ok)
    rules = replace(RULES, warehouse=replace(RULES.warehouse, province=0))
    results, _ = apply_commands(state, rules, [PlayerCommand(0, 0, DrawLine((K, A, B, C, M)))])
    assert _code(results[0].outcome) is RejectCode.NOT_CITY


def test_at_most_three_lines_start_at_a_node() -> None:
    """L4: ``lines.max_out = 3``; any number of incoming lines."""
    state = _state(10)
    for path in ((K, A), (K, A, B), (K, A, E)):
        assert isinstance(_cmd(state, DrawLine(path)), Ok)
    assert _code(_cmd(state, DrawLine((K, A, D)))) is RejectCode.LINE_LIMIT
    state.nodes[A].factory = 0
    assert isinstance(_cmd(state, DrawLine((A, B))), Ok)  # B: a second incoming line


def test_a_cycle_of_lines_is_rejected() -> None:
    """L4: K -> A, A -> B; then B -> K (through A) closes a cycle; B -> C does not."""
    state = _state(10)
    _cmd(state, DrawLine((K, A)))
    _cmd(state, DrawLine((A, B)))
    assert _code(_cmd(state, DrawLine((B, A, K)))) is RejectCode.LINE_CYCLE
    assert _code(_cmd(state, DrawLine((A, K)))) is RejectCode.LINE_CYCLE
    assert isinstance(_cmd(state, DrawLine((B, C))), Ok)


def test_two_lines_with_the_same_ends_are_two_layers() -> None:
    """L1: lines never merge; each one carries its own charge per dispatch."""
    state = _state(9)
    _lines(state, (K, A), (K, A))
    assert _sent(_supply_until(state, 10)) == [(10, K, A), (10, K, A)]


# Throughput, round robin, relay slot, full target (L1, L5, L6; table R1-R4) ----------------------


def _factory_a(state: GameState, stock: int) -> None:
    state.nodes[A].factory = 0
    state.nodes[A].warehouse = stock


def test_r1_a_factory_serves_its_lines_in_turn() -> None:
    state = _state(9)
    _factory_a(state, 1)
    _lines(state, (A, B), (A, E))
    events = _supply_until(state, 10)
    assert _sent(events) == [(10, A, B)]
    state.nodes[A].warehouse = 1
    events = _supply_until(state, 20)
    assert _sent(events) == [(20, A, E)]


def test_r2_one_charge_per_line_and_dispatch() -> None:
    state = _state(9)
    _factory_a(state, 4)
    _lines(state, (A, B), (A, E))
    assert _sent(_supply_until(state, 10)) == [(10, A, B), (10, A, E)]
    assert state.nodes[A].warehouse == 2
    assert _sent(_supply_until(state, 19)) == []  # one dispatch per 10 ticks


def test_r3_a_relay_keeps_one_slot_for_itself() -> None:
    """L5: B is the target of A -> B and has lines B -> F, B -> G; three charges came by A -> B
    and wait in transit (``inbox``, outside the warehouse, #661): B keeps one, F and G get one
    each."""
    state = _state(9)
    _factory_a(state, 0)
    _lines(state, (A, B), (B, F), (B, G))
    state.nodes[B].warehouse_level = 1  # room for 3
    state.nodes[B].inbox = 3
    assert _sent(_supply_until(state, 10)) == [(10, B, F), (10, B, G)]
    assert (state.nodes[B].warehouse, state.nodes[B].inbox) == (1, 0)
    assert _sent(_supply_until(state, 20)) == []  # the kept charge stays in B


def test_r3_relay_end_to_end() -> None:
    """A charge delivered by A -> B enters B's round robin (own slot, B -> F): the first one stays
    in B, the next goes on to F, the third stays in B again. A packet of A -> B takes
    30 * 100 // 150 = 20 ticks (item 8)."""
    state = _state(9)
    _factory_a(state, 1)
    _lines(state, (A, B), (B, F))
    assert _sent(_supply_until(state, 10)) == [(10, A, B)]
    (packet,) = state.packets.values()
    assert (packet.depart_tick, packet.arrive_tick) == (10, 30)
    assert _sent(_supply_until(state, 30)) == []  # delivered at 30: B keeps it
    assert (state.nodes[B].warehouse, state.nodes[B].inbox, state.nodes[B].rr) == (1, 0, 1)
    state.nodes[A].warehouse = 1
    assert _sent(_supply_until(state, 60)) == [(40, A, B), (60, B, F)]
    assert (state.nodes[B].warehouse, state.nodes[B].inbox, state.nodes[B].rr) == (1, 0, 0)
    state.nodes[A].warehouse = 1
    assert _sent(_supply_until(state, 90)) == [(70, A, B)]
    assert state.nodes[B].warehouse == 2


def _overflow(events: list[Event]) -> list[Event]:
    return [e for e in events if e.kind == "charges_overflow"]


def test_t1_a_full_relay_passes_charges_on_in_turn() -> None:
    """Owner's situation 2 with the decision of 2026-10-31 (#661, table T1): A -> B, B -> D,
    B -> C, B full (2). The room of B is 0 (own) + 2 (D) + 2 (C), so A -> B is not skipped; the
    charges wait in B's transit and go to D and C in turn, B keeps its 2. A -> B and B -> C take
    20 ticks, B -> A -> D 40."""
    state = _state(9)
    _factory_a(state, 2)
    _lines(state, (A, B), (B, A, D), (B, C))
    state.nodes[B].warehouse = 2
    events = _supply_until(state, 40)
    assert _sent(events) == [(10, A, B), (20, A, B), (30, B, D), (40, B, C)]
    assert (state.nodes[B].warehouse, state.nodes[B].inbox) == (2, 0)
    events += _supply_until(state, 80)
    assert (state.nodes[D].warehouse, state.nodes[C].warehouse) == (1, 1)
    assert state.nodes[B].warehouse == 2
    assert not _overflow(events)


def test_t2_a_province_relay_of_capacity_1() -> None:
    """Table T2: own province M (warehouse 1, full) is the target of C -> M and has lines
    M -> 19 and M -> 20 (provinces, empty). C -> M takes 48 * 100 // 150 = 32 ticks, M -> 19 and
    M -> 20 20: both charges pass M, one to each line in turn."""
    state = _state(9)
    for n in (M, 19, 20):
        state.nodes[n].owner = 0
    state.nodes[C].factory = 0
    state.nodes[C].warehouse = 2
    state.nodes[M].warehouse = 1
    _lines(state, (C, M), (M, 19), (M, 20))
    events = _supply_until(state, 90)
    assert _sent(events) == [(10, C, M), (20, C, M), (50, M, 19), (60, M, 20)]
    assert [state.nodes[n].warehouse for n in (M, 19, 20)] == [1, 1, 1]
    assert state.nodes[M].inbox == 0
    assert not _overflow(events)


def test_t3_a_chain_of_three_full_relays() -> None:
    """Table T3: A -> B -> C -> M -> 19, the relays B, C (2) and M (1) full, 19 empty (1). The
    room down the chain is 1, so one charge goes all the way to 19 and A keeps the other; nothing
    burns."""
    state = _state(9)
    for n in (M, 19):
        state.nodes[n].owner = 0
    _factory_a(state, 2)
    _lines(state, (A, B), (B, C), (C, M), (M, 19))
    state.nodes[B].warehouse = state.nodes[C].warehouse = 2
    state.nodes[M].warehouse = 1
    events = _supply_until(state, 200)
    assert _sent(events) == [(10, A, B), (30, B, C), (50, C, M), (90, M, 19)]
    assert [state.nodes[n].warehouse for n in (A, B, C, M, 19)] == [1, 2, 2, 1, 1]
    assert [state.nodes[n].inbox for n in (B, C, M)] == [0, 0, 0]
    assert not _overflow(events)


def test_t4_transit_burns_only_when_no_warehouse_of_the_tree_has_room() -> None:
    """Table T4: B holds 1 in transit, its warehouse (2) and F (1), the only target of its lines,
    are full: no slot takes it and it burns. With F empty it goes to F instead."""
    state = _state(9)
    _lines(state, (A, B), (B, F))
    state.nodes[B].warehouse, state.nodes[B].inbox, state.nodes[F].warehouse = 2, 1, 1
    events = _supply_until(state, 10)
    assert _sent(events) == []
    assert [(e.get("node"), e.get("charges")) for e in _overflow(events)] == [(B, 1)]
    assert state.nodes[B].inbox == 0
    state = _state(9)
    _lines(state, (A, B), (B, F))
    state.nodes[B].warehouse, state.nodes[B].inbox = 2, 1
    events = _supply_until(state, 10)
    assert _sent(events) == [(10, B, F)]
    assert not _overflow(events)


def test_a_relay_tree_is_mirror_symmetric() -> None:
    """4.1, rule 6: situation 2 of T1 for both players (player 1 owns the mirror ``16 - n``)
    gives the mirrored warehouses, transit, round robin and sends."""
    state = _state(9)
    for player in (0, 1):

        def flip(n: int, player: int = player) -> int:
            return 16 - n if player else n

        state.nodes[flip(A)].factory = player
        state.nodes[flip(A)].warehouse = 2
        state.nodes[flip(B)].warehouse = 2
        _lines(
            state,
            (flip(A), flip(B)),
            (flip(B), flip(A), flip(D)),
            (flip(B), flip(C)),
            player=player,
        )
    events: list[Event] = []
    for tick in (40, 55, 80):
        events += _supply_until(state, tick)
        for n in range(17):
            a, b = state.nodes[n], state.nodes[16 - n]
            assert (a.warehouse, a.inbox, a.rr) == (b.warehouse, b.inbox, b.rr), f"node {n}"
    sent = {
        p: [
            (e.tick, e.get("from_node"), e.get("to_node"))
            for e in events
            if e.kind == "packet_sent" and e.get("player") == p
        ]
        for p in (0, 1)
    }
    assert sent[1] == [(t, 16 - cast(int, a), 16 - cast(int, b)) for t, a, b in sent[0]]
    assert sent[0][:4] == [(10, A, B), (20, A, B), (30, B, D), (40, B, C)]


def test_r4_a_full_target_is_skipped_and_the_source_keeps_the_charge() -> None:
    """L6: B is full (2): A -> B is skipped, A -> E gets its charge, A keeps the rest."""
    state = _state(9)
    _factory_a(state, 4)
    _lines(state, (A, B), (A, E))
    state.nodes[B].warehouse = 2
    assert _sent(_supply_until(state, 10)) == [(10, A, E)]
    assert state.nodes[A].warehouse == 3


def test_charges_on_the_way_count_for_a_full_target() -> None:
    """E holds 1 and has a packet on the way: E (capacity 1) counts as full, nothing burns."""
    state = _state(9)
    _factory_a(state, 4)
    _lines(state, (A, E))
    assert _sent(_supply_until(state, 10)) == [(10, A, E)]
    assert _sent(_supply_until(state, 20)) == []  # the first one is still on the way
    events = _supply_until(state, 60)
    assert not [e for e in events if e.kind == "charges_overflow"]
    assert state.nodes[E].warehouse == 1


def test_line_packets_travel_at_150_percent() -> None:
    """Item 8: ``travel_ticks * 100 // 150``: 30 -> 20 ticks per road, so K -> A -> B in 40."""
    state = _state(9)
    _lines(state, (K, A, B))
    _supply_until(state, 10)
    (packet,) = state.packets.values()
    assert (packet.depart_tick, packet.arrive_tick, packet.route_ticks) == (10, 30, (20,))
    events = _supply_until(state, 50)
    delivered = [e for e in events if e.kind == "packet_delivered" and e.get("node") == B]
    assert [e.tick for e in delivered] == [50]


# The state ------------------------------------------------------------------------------------


def test_the_v2_fields_round_trip_and_a_v1_state_has_none() -> None:
    """The canonical form carries factories, factory builds, the relay state and the lines; a v1
    state has none of these keys, so its hash is the hash it had before DEC-41."""
    state = _state(7)
    _lines(state, (K, A, B), (B, C))
    state.nodes[A].factory_build = FactoryBuild(owner=0, since=3)
    state.nodes[B].inbox, state.nodes[B].rr = 1, 1
    assert from_canonical(state_canonical(state)) == state
    v1 = state_canonical(initial_state(MAP, V1))
    players, nodes = v1["players"], v1["nodes"]
    assert isinstance(players, list) and isinstance(nodes, list)
    v2_keys = ("lines", "next_line", "factory", "factory_build", "inbox", "rr")
    rows = cast(list[dict[str, object]], [*players, *nodes])
    for row in rows:
        assert not [key for key in v2_keys if key in row]
