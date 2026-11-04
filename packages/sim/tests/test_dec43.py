"""Automatic supply flow, leaf shift, fixed warehouses (DEC-43, #697; implementation #704).

Expected values come from mechanics.md, section 7, block "Automatic supply flow, leaf shift, fixed
warehouses, road fortifications (DEC-43, #697)": items A, B, C, the key list of ``mvp-4.toml``
and the table F1..F20 (the view rows V1..V4 are in ``test_dec43_view.py``).

The map of the table is ``dec41`` (see ``test_dec41.py``), player 0, ``mvp-4``: own K = 0 (capital,
warehouse 6), A = 1, B, C, D = 2, 3, 4, E, F, G = 5, 6, 7 (cities, warehouse 3); M = 8 is a neutral
province (warehouse 1 when own); the provinces 17 and 18 are player 1's in the base (since #724 a
neutral never makes a leaf; the map as it is: ``test_dec43_leaves.py``); roads K-A, K-E, A-B, A-D,
A-E, B-C, B-F, B-G, D-C, C-M, C-17, D-18; packet ticks 20 per 30-tick road, K-E 28, D-C 38, C-M 32,
C-17 30; ``node_key(0, n) = n``. No groups and no packets unless a row says so (the start garrison
of K, 2 units charged, never pulls); stocks as set by the row, the rest 0; the dispatch at tick 10.
"""

import tomllib
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from gow_sim.analysis import MatchMetrics, MatchRecorder, analyze
from gow_sim.commands import (
    BuildBunker,
    Command,
    DrawLine,
    Ok,
    PlayerCommand,
    Reject,
    RejectCode,
    RemoveLine,
    SetAutoLines,
    SetLeafShift,
    UpgradeWarehouse,
    apply_commands,
)
from gow_sim.maps import MapDef, load_map
from gow_sim.match import Controller, Match, run_headless
from gow_sim.ruleset import (
    Ruleset,
    RulesetError,
    SupplyModel,
    load_ruleset,
    parse_ruleset,
    ruleset_hash,
    to_canonical,
)
from gow_sim.state import (
    AtNode,
    Event,
    FlowIdle,
    GameState,
    Group,
    Mode,
    OnEdge,
    from_canonical,
    initial_state,
)
from gow_sim.state import to_canonical as state_canonical
from gow_sim.systems.capacity import warehouse_capacity
from gow_sim.systems.economy import economy
from gow_sim.systems.flow import supply_flow, update_flow
from gow_sim.systems.supply import send_packet
from gow_sim.view import PlayerView, line_route

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[2]
RULESETS = ROOT / "rulesets"
RULES = load_ruleset(RULESETS / "mvp-4.toml")
MVP3 = load_ruleset(RULESETS / "mvp-3.toml")
MAP = load_map(TESTS_DIR / "maps" / "dec41.json")
K, A, B, C, D, E, F, G, M = range(9)
ENEMY_PASSES = (17, 18)  # North Pass, South Pass: player 1's in the base of the tables (#724)
NORTH = 17
OWN = (K, A, B, C, D, E, F, G)
ROAD = {  # edge ids of dec41
    (K, A): 0,
    (A, B): 1,
    (B, C): 2,
    (A, D): 3,
    (D, C): 4,
    (A, E): 5,
    (K, E): 9,
}


def _state(stocks: dict[int, int] | None = None, shift: int = 0, tick: int = 9) -> GameState:
    """The base of the table: own stocks as given, the rest 0, at ``tick`` before the step."""
    state = initial_state(MAP, RULES)
    for n in OWN:
        state.nodes[n].warehouse = 0
    for n in ENEMY_PASSES:  # the passes are player 1's (#724: a neutral never makes a leaf)
        state.nodes[n].owner = 1
    for n, stock in (stocks or {}).items():
        state.nodes[n].warehouse = stock
    update_flow(state, RULES)  # the field of the base (item A8), before the shift is set
    state.players[0].leaf_shift = shift
    state.tick = tick
    return state


def _flow(state: GameState, tick: int = 10) -> list[Event]:
    """The flow step of tick ``tick`` (the steps of the ticks before it too)."""
    events: list[Event] = []
    while state.tick < tick:
        state.tick += 1
        state.events = []
        events += supply_flow(state, RULES)
    return events


def _sent(events: list[Event], player: int = 0) -> list[tuple[int, int]]:
    return [
        (e.get("from_node"), e.get("to_node"))  # type: ignore[misc]
        for e in events
        if e.kind == "packet_sent" and e.get("player") == player
    ]


def _d(state: GameState, *nodes: int) -> dict[int, int | None]:
    result: dict[int, int | None] = {}
    for n in nodes:
        flow = state.nodes[n].flow
        assert flow is not None
        result[n] = flow.d
    return result


def _group(state: GameState, node: int, units: int, charged: int, plan: int = 0) -> Group:
    gid = state.new_id()
    group = Group(gid, 0, units, charged, Mode.ATTACK, AtNode(node), plan=plan)
    state.groups[gid] = group
    return group


def _cmd(state: GameState, cmd: Command, rules: Ruleset = RULES) -> tuple[Ok | Reject, list[Event]]:
    results, events = apply_commands(state, rules, [PlayerCommand(0, 0, cmd)])
    return results[0].outcome, events


def _code(outcome: Ok | Reject) -> RejectCode | None:
    return outcome.code if isinstance(outcome, Reject) else None


BASE_D = {C: 0, D: 0, A: 1, B: 1, K: 2, E: 2, F: 2, G: 2}
L1_D = {C: 0, F: 0, G: 0, B: 1, D: 1, A: 2, K: 3, E: 3}
"""Row L1: the passes neutral (the map as it is), no enemy contact: the farthest nodes from K."""


# The ruleset (supply.model, mvp-4, item C) ------------------------------------------------------


def _raw(path: Path) -> dict[str, Any]:
    return tomllib.loads(path.read_text(encoding="utf-8"))


def test_mvp4_is_mvp3_with_the_dec43_keys() -> None:
    """The key list of ``mvp-4.toml``: ``supply.model = "flow"``, no ``[lines]``, no ``[bunker]``,
    fixed warehouses, the ``[fort]`` of item D (#707); everything else as ``mvp-3``."""
    expected = _raw(RULESETS / "mvp-3.toml")
    expected["supply"]["model"] = "flow"
    del expected["lines"]
    del expected["bunker"]
    expected["fort"] = {"cost": 150, "build_ticks": 100, "toll_units": 3, "toll_charges": 1}
    expected["warehouse"]["max_level"] = 0
    expected["warehouse"]["start_by_kind"] = {
        "capital": 6,
        "city_large": 3,
        "city_medium": 3,
        "city_small": 3,
    }
    assert to_canonical(RULES) == expected
    assert parse_ruleset(expected) == RULES
    assert RULES.flow and RULES.v2 and RULES.supply.model is SupplyModel.FLOW
    assert RULES.lines is None and RULES.bunker is None
    assert RULES.warehouse.province == 1
    assert (RULESETS / "archive" / f"{ruleset_hash(RULES)}.toml").is_file()


@pytest.mark.parametrize("name", ["mvp-0", "mvp-1", "mvp-2", "mvp-3", "test-short"])
def test_the_other_rulesets_keep_lines_and_their_hash(name: str) -> None:
    """``supply.model`` defaults to ``lines`` and is not part of the hash at its default."""
    rules = load_ruleset(RULESETS / f"{name}.toml")
    assert not rules.flow and rules.supply.model is SupplyModel.LINES
    supply_data = to_canonical(rules)["supply"]
    assert isinstance(supply_data, dict) and "model" not in supply_data
    assert (RULESETS / "archive" / f"{ruleset_hash(rules)}.toml").is_file()


def test_flow_only_with_v2_and_never_with_lines() -> None:
    v1 = _raw(RULESETS / "mvp-2.toml")
    v1["supply"]["model"] = "flow"
    with pytest.raises(RulesetError, match=r"^supply\.model: 'flow' only with economy\.model"):
        parse_ruleset(v1)
    flow = _raw(RULESETS / "mvp-4.toml")
    flow["lines"] = _raw(RULESETS / "mvp-3.toml")["lines"]
    with pytest.raises(RulesetError, match=r"^lines: not allowed with supply\.model = 'flow'"):
        parse_ruleset(flow)
    lines = _raw(RULESETS / "mvp-3.toml")
    del lines["lines"]
    with pytest.raises(RulesetError, match=r"^lines: missing key"):
        parse_ruleset(lines)
    bad = _raw(RULESETS / "mvp-4.toml")
    bad["supply"]["model"] = "pipes"
    with pytest.raises(RulesetError, match=r"^supply\.model: expected one of"):
        parse_ruleset(bad)


def test_the_bunker_section_is_optional_under_v2() -> None:
    """Item D1: without ``[bunker]`` ``BuildBunker`` gives ``FEATURE_DISABLED``; a v1 file still
    must not have it."""
    data = _raw(RULESETS / "mvp-3.toml")
    del data["bunker"]
    rules = parse_ruleset(data)
    assert rules.bunker is None and not rules.flow
    outcome, _ = _cmd(initial_state(MAP, rules), BuildBunker(K), rules)
    assert _code(outcome) is RejectCode.FEATURE_DISABLED
    v1 = _raw(RULESETS / "mvp-2.toml")
    v1["bunker"] = _raw(RULESETS / "mvp-3.toml")["bunker"]
    with pytest.raises(RulesetError, match=r"^bunker: only with economy\.model = 'v2'"):
        parse_ruleset(v1)


def test_c1_fixed_warehouses() -> None:
    """Item C1: every city 3, the capital 6, a province 1."""
    state = initial_state(MAP, RULES)
    assert [warehouse_capacity(state, RULES, n) for n in (K, A, B, E, M)] == [6, 3, 3, 3, 1]
    assert state.nodes[K].warehouse == 6  # the start stock of the capital
    assert all(state.nodes[n].warehouse == 0 for n in (A, B, C, D, E, F, G))


@pytest.mark.parametrize(
    "cmd", [DrawLine((K, A)), RemoveLine(0), SetAutoLines(False), BuildBunker(A)]
)
def test_a12_d1_the_line_and_bunker_commands_are_disabled(cmd: Command) -> None:
    outcome, events = _cmd(_state(), cmd)
    assert _code(outcome) is RejectCode.FEATURE_DISABLED and events == []


def test_c2_upgrade_warehouse_is_disabled_with_max_level_0() -> None:
    outcome, _ = _cmd(_state(), UpgradeWarehouse(A))
    assert _code(outcome) is RejectCode.FEATURE_DISABLED
    outcome, _ = _cmd(initial_state(MAP, MVP3), UpgradeWarehouse(A), MVP3)
    assert _code(outcome) is None  # mvp-3 keeps its warehouse levels


def test_a12_no_lines_and_no_suggested_path() -> None:
    """Item A12: ``View.lines`` empty, ``auto_lines`` ``None``, ``line_route_query`` empty."""
    state = _state()
    assert line_route(state, RULES, 0, (K, A, B)) == ()
    assert line_route(initial_state(MAP, MVP3), MVP3, 0, (K, A, B)) == (K, A, B)
    assert state.players[0].auto_lines is False


# The field (items A1 to A4, A10, A11) -----------------------------------------------------------


def test_f1_the_base_field() -> None:
    state = _state()
    _flow(state)
    assert _d(state, *OWN) == BASE_D
    assert [n for n in OWN if state.nodes[n].flow.d == 0] == [C, D]  # type: ignore[union-attr]
    assert state.players[0].leaf_shift_max == 2


def test_the_initial_state_carries_the_field() -> None:
    """Item A8: the initial state carries the field computed by the same function (the start of
    ``dec41``: no enemy contact, so the leaves are the farthest nodes, row L1)."""
    state = initial_state(MAP, RULES)
    assert _d(state, *OWN) == L1_D
    assert state.players[0].leaf_shift_max == 3
    assert state.nodes[M].flow is None  # neutral


# The dispatch (items A5, A6) --------------------------------------------------------------------


def test_f2_downhill_then_the_level_road() -> None:
    """Since #738 (item M) C and D call K over A; E is not nearer the front than K (``d`` 2
    both), so K gives it nothing."""
    state = _state({K: 6})
    assert _sent(_flow(state)) == [(K, A)]
    assert state.nodes[K].warehouse == 5


def _f3(stocks: dict[int, int]) -> GameState:
    state = _state(stocks)
    state.nodes[C].owner = 1  # enemy-owned: B and D are leaves
    return state


def test_f3_the_lower_fill_first() -> None:
    state = _f3({A: 1, B: 1, D: 0})
    events = _flow(state)
    assert _d(state, B, D, A, F, G, K, E) == {B: 0, D: 0, A: 1, F: 1, G: 1, K: 2, E: 2}
    assert _sent(events) == [(A, D)]


def test_f4_equal_fill_by_node_key() -> None:
    assert _sent(_flow(_f3({A: 1}))) == [(A, B)]


def test_f5_one_charge_to_each() -> None:
    assert _sent(_flow(_f3({A: 2, B: 1}))) == [(A, D), (A, B)]


def _from(events: list[Event], node: int) -> list[tuple[int, int]]:
    return [r for r in _sent(events) if r[0] == node]


def test_f6_no_room_below() -> None:
    state = _state({A: 1, D: 3, B: 3, C: 3})
    assert _from(_flow(state), A) == []
    assert state.nodes[A].flow.idle is FlowIdle.FULL  # type: ignore[union-attr]
    state = _state({A: 1, D: 2, B: 3, C: 3})
    send_packet(state, 0, K, (ROAD[K, A], ROAD[A, D]), (20, 20), 1, transfer=False)
    assert _from(_flow(state), A) == []
    assert state.nodes[A].flow.idle is FlowIdle.FULL  # type: ignore[union-attr]


def test_f7_the_wave() -> None:
    """Since #738 (item M) D calls A and, over the full A, K at 10 (K waits); at 20 A, with room
    1, calls K (``d`` 2), the nearest stock behind it; B (``d`` 1 like A) gives nothing."""
    state = _state({K: 6, A: 3, B: 3, C: 3, E: 3, D: 0})
    assert _sent(_flow(state, 10)) == [(A, D)]
    assert _sent(_flow(state, 20)) == [(A, D), (K, A)]


def test_f8_a_level_road_moves_a_gap_of_two() -> None:
    """Since #738 (item M) B calls only stock farther from the front than itself; A has its
    ``d``, so nothing moves."""
    assert _sent(_flow(_state({A: 3, B: 0, D: 3, C: 3}))) == []
    assert _sent(_flow(_state({A: 1, B: 0, D: 3, C: 3}))) == []


def test_f9_a_leaf_keeps() -> None:
    """Nothing goes back behind the level; since #735 nothing goes inward on the level either: D,
    the other leaf, is nearer the capital (item L2)."""
    state = _state({C: 3, B: 0})
    assert _sent(_flow(state)) == []
    assert state.nodes[C].warehouse == 3


# The pull (item A4) ----------------------------------------------------------------------------


def test_f10_a_tired_army_pulls() -> None:
    state = _state({K: 1})
    _group(state, E, 2, 0)
    events = _flow(state)
    assert _d(state, E, K, A) == {E: 0, K: 1, A: 1}
    assert _sent(events) == [(K, E)]
    assert _sent(_flow(_state({K: 1}))) == [(K, A)]


def test_f11_a_gathering_plan_pulls() -> None:
    state = _state({B: 2})
    _group(state, B, 2, 2, plan=1)
    events = _flow(state)
    assert _d(state, B) == {B: 0}
    assert _sent(events) == [] and state.nodes[B].warehouse == 2
    state = _state({B: 2})  # since #738: C calls B, D calls B over A
    assert _sent(_flow(state)) == [(B, C), (B, A)] and state.nodes[B].warehouse == 0


# The leaf shift (items B1 to B4) ----------------------------------------------------------------


def test_f12_the_shift_moves_the_level_back() -> None:
    state = _state({K: 6, A: 3, C: 2, F: 2}, shift=1)
    events = _flow(state)
    # since #738: B calls F and K (over the full A, which has just given B one by item L2)
    assert _sent(events) == [(A, B), (F, B)]
    assert [state.nodes[n].warehouse for n in (K, A, C, F)] == [6, 2, 2, 1]
    assert _sent([e for e in events if e.get("player") == 0 and e.get("to_node") == C]) == []


def test_f13_ahead_of_the_level_no_pull_behind_it_a_pull_to_the_level() -> None:
    state = _state({A: 3}, shift=1)
    _group(state, D, 2, 0)
    events = _flow(state)
    assert _d(state, *OWN) == {**BASE_D, D: 1}  # D ahead pulls: on the level (item I6, #724)
    assert _sent(events) == [(A, D), (A, B)]  # since #738: the army calls first (item M2)
    state = _state({K: 6}, shift=1)
    _group(state, K, 2, 0)
    events = _flow(state)
    assert _d(state, K, E) == {K: 1, E: 2}  # K pulled to the level, E stays 2
    assert [r for r in _sent(events) if r[0] == K] == []


def test_f14_set_leaf_shift_checks() -> None:
    state = _state()
    _flow(state, 9)  # leaf_shift_max is the one the previous flow step stored
    assert _code(_cmd(state, SetLeafShift(3))[0]) is RejectCode.INVALID_ARGUMENT
    outcome, events = _cmd(state, SetLeafShift(2))
    assert isinstance(outcome, Ok) and outcome.cost == 0 and events == []
    assert state.players[0].leaf_shift == 2 and state.players[0].cp == RULES.cp.start
    assert _code(_cmd(state, SetLeafShift(2))[0]) is RejectCode.NO_CHANGE
    assert _code(_cmd(state, SetLeafShift(-1))[0]) is RejectCode.INVALID_ARGUMENT
    mvp3 = initial_state(MAP, MVP3)
    assert _code(_cmd(mvp3, SetLeafShift(0), MVP3)[0]) is RejectCode.FEATURE_DISABLED


def test_f15_the_clamp_is_stored() -> None:
    state = _state(shift=2)
    state.nodes[A].owner = 1
    _flow(state, 10)
    assert state.players[0].leaf_shift == 0 and state.players[0].leaf_shift_max == 0
    state.nodes[A].owner = 0  # retaken
    _flow(state, 11)
    assert state.players[0].leaf_shift == 0 and state.players[0].leaf_shift_max == 2


# A full factory (item A8) ------------------------------------------------------------------------


def _produce(state: GameState, tick: int = 100) -> list[Event]:
    """The economy and the flow step of ``tick``; the field of the tick before is stored."""
    update_flow(state, RULES)
    state.tick = tick
    state.events = []
    events = economy(state, RULES)
    state.events = list(events)
    return events + supply_flow(state, RULES)


def test_f16_a_full_factory_spills() -> None:
    state = _state({K: 6, A: 3, C: 3, D: 3, E: 0}, tick=99)
    events = _produce(state)
    produced = [e for e in events if e.kind == "charges_produced" and e.get("player") == 0]
    assert [(e.get("node"), e.get("charges"), e.get("spill")) for e in produced] == [(K, 1, 1)]
    # since #738 the dispatch sends K nothing more to E (``d`` 2 like K); B calls K over the
    # full A, and A passes one of its own on (a relay, item M6)
    assert [r for r in _sent(events) if r[0] == K] == [(K, E)]
    assert _sent(events) == [(K, E), (A, B)]
    assert state.nodes[K].warehouse == 6


def test_f17_no_room_burns_and_a_reserved_arrival_counts() -> None:
    """Since #738 (item M8) the spill goes to the nearest own node with room, several roads away:
    with A and E full it goes to B over A; it burns only when no own node has room."""
    state = _state({K: 6, A: 3, C: 3, D: 3, E: 3}, tick=99)
    events = _produce(state)
    spilled_to = [
        (e.get("from_node"), e.get("to_node"), e.get("edge"))
        for e in events
        if e.kind == "packet_sent" and e.get("from_node") == K
    ]
    assert spilled_to == [(K, B, ROAD[K, A])]
    assert [p.route for p in state.packets.values() if p.from_node == K] == [(ROAD[A, B],)]
    full = {n: 3 for n in OWN}
    state = _state({**full, K: 6}, tick=99)
    events = _produce(state)
    burned = [e for e in events if e.kind == "charge_burned" and e.get("player") == 0]
    assert [(e.get("node"), e.get("charges")) for e in burned] == [(K, 1)]
    assert [r for r in _sent(events) if r[0] == K] == []
    for e_stock, spilled in ((0, True), (3, False)):
        state = _state({**full, K: 5, E: e_stock}, tick=99)
        send_packet(state, 0, A, (ROAD[K, A],), (20,), 1, transfer=False)  # on the way to K
        events = economy_only(state)
        kinds = [(e.kind, e.get("spill") if e.kind == "charges_produced" else None) for e in events]
        if spilled:
            assert ("charges_produced", 1) in kinds and _sent(events) == [(K, E)]
        else:
            assert ("charge_burned", None) in kinds and _sent(events) == []
        assert state.nodes[K].warehouse == 5


def economy_only(state: GameState) -> list[Event]:
    update_flow(state, RULES)
    state.tick = 100
    return [e for e in economy(state, RULES) if e.get("player") == 0]


# Pockets and a moving front (items A10, A11) ---------------------------------------------------


def test_f18_a_pocket_flows_with_k_0() -> None:
    state = _state({F: 2, B: 0}, shift=2)
    state.nodes[A].owner = 1
    events = _flow(state)
    assert _d(state, B, C, D, F, G, K, E) == {B: 0, C: 0, D: 0, F: 1, G: 1, K: 0, E: 0}
    assert _sent(events) == [(F, B)]
    pockets = {n: state.nodes[n].flow.pocket for n in (B, C, D, F, G, K, E)}  # type: ignore[union-attr]
    assert pockets == {B: True, C: True, D: True, F: True, G: True, K: False, E: False}


def test_f19_captured_nodes_are_new_leaves() -> None:
    state = _state({C: 3, D: 3})
    state.nodes[M].owner = 0
    state.nodes[NORTH].owner = 0
    events = _flow(state)
    assert _d(state, C, M, NORTH) == {C: 1, M: 0, NORTH: 0}
    assert _sent(events) == [(C, M), (C, NORTH)]
    assert state.nodes[C].warehouse == 1


def test_f20_an_enemy_group_does_not_block_a_packet() -> None:
    for capture in (False, True):
        state = _state({A: 1})
        assert _sent(_flow(state, 10)) == [(A, D)]
        gid = state.new_id()
        state.groups[gid] = Group(gid, 1, 3, 3, Mode.ATTACK, OnEdge(ROAD[A, D], A, 500, False))
        _flow(state, 20)
        if capture:
            state.nodes[D].owner = 1
        events = _flow(state, 30)
        delivered = [
            (e.tick, e.get("node"))
            for e in events
            if e.kind == "packet_delivered" and e.get("player") == 0
        ]
        lost = [e.tick for e in events if e.kind == "packet_lost" and e.get("player") == 0]
        if capture:
            assert delivered == [] and lost == [21]
        else:
            assert delivered == [(30, D)] and lost == []


# The state ---------------------------------------------------------------------------------------


def test_the_flow_fields_round_trip_and_the_lines_state_keeps_its_form() -> None:
    state = _state({K: 6}, shift=1)
    _flow(state)
    assert from_canonical(state_canonical(state)) == state
    data = state_canonical(initial_state(MAP, MVP3))
    assert all("flow" not in n for n in data["nodes"])  # type: ignore[union-attr]
    assert all("leaf_shift" not in p for p in data["players"])  # type: ignore[union-attr]


# Properties on whole matches: the ledger and the warehouses ---------------------------------------


class _Checked:
    """A ``MatchObserver``: the ``gow_sim.analysis`` recorder, and no warehouse above its
    capacity after any tick."""

    def __init__(self) -> None:
        self.recorder = MatchRecorder()

    def begin(self, match: Match) -> None:
        self.recorder.begin(match)
        self._check(match)

    def record(self, match: Match, commands: Sequence[PlayerCommand]) -> None:
        self.recorder.record(match, commands)
        self._check(match)

    @staticmethod
    def _check(match: Match) -> None:
        state = match.state
        for n, node in state.nodes.items():
            cap = warehouse_capacity(state, match.rules, n)
            assert 0 <= node.warehouse <= cap, f"tick {state.tick}: node {n} {node.warehouse}"


class _Shifter:
    """A controller: ``ExpandBot`` plus a leaf shift from ``shifts`` every 100 ticks."""

    def __init__(self, base: Controller, shifts: Sequence[int]) -> None:
        self.base = base
        self.shifts = shifts

    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        cmds = self.base.decide(view, tick)
        if tick % 100 == 0 and self.shifts:
            shift = self.shifts[tick // 100 % len(self.shifts)]
            assert view.me.leaf_shift_max is not None
            cmds.append(SetLeafShift(min(shift, view.me.leaf_shift_max)))
        return cmds


def _play(
    mapdef: MapDef,
    expand_bot: Callable[[MapDef, Ruleset], Controller],
    shifts: tuple[Sequence[int], Sequence[int]],
    max_ticks: int,
) -> MatchMetrics:
    observer = _Checked()
    bots = [_Shifter(expand_bot(mapdef, RULES), shifts[p]) for p in (0, 1)]
    run_headless(mapdef, RULES, bots, max_ticks=max_ticks, observer=observer)
    return analyze(observer.recorder.log())


@pytest.mark.parametrize("name", ["artery", "web", "pass"])
def test_the_ledger_balances_in_mvp4_bot_matches(
    name: str, expand_bot: Callable[[MapDef, Ruleset], Controller]
) -> None:
    """Charges are conserved (the residual of the ``gow_sim.analysis`` ledger is 0) and no
    warehouse exceeds its capacity in matches of two ``ExpandBot``s that shift their level."""
    mapdef = load_map(ROOT / "maps" / "fixtures" / f"{name}.json")
    metrics = _play(mapdef, expand_bot, ((0, 1, 2), (2, 0)), 3000)
    assert all(flow.residual == 0 for flow in metrics.flow), metrics.flow
    assert sum(flow.sent for flow in metrics.flow) > 0


@given(
    st.lists(st.integers(0, 4), max_size=6),
    st.lists(st.integers(0, 4), max_size=6),
    st.sampled_from(["artery", "web", "pass"]),
)
@settings(max_examples=8, deadline=None)
def test_the_ledger_balances_for_any_shifts(
    expand_bot: Callable[[MapDef, Ruleset], Controller],
    shifts0: list[int],
    shifts1: list[int],
    name: str,
) -> None:
    mapdef = load_map(ROOT / "maps" / "fixtures" / f"{name}.json")
    metrics = _play(mapdef, expand_bot, (shifts0, shifts1), 1200)
    assert all(flow.residual == 0 for flow in metrics.flow), metrics.flow
