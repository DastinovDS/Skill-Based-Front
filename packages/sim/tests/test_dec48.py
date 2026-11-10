"""The group order and the recruit rally point (DEC-48, #896).

Expected values come from mechanics.md, section 5, "Group order: rally to an own node and
synchronized arrival (DEC-48, #896)": the rule items A to M and the worked examples (tables S, R,
P and RP), with the owner's changes of 2026-11-10 recorded there (a recruit without the CP for its
walk gets no order and merges, rows RP8 and RP9; a command of a feature the ruleset does not have
is ``INVALID_ARGUMENT``).

Map ``dec48`` (the map of the worked examples and its rot180 mirror; every node forest, so an edge
takes exactly its ``travel_ticks``): player 0 owns the capital H (capacity 10), the city_large R
(8), the city_medium A (6), the city_small B (4) and the province C (3); E is a city_medium of
player 1, N a neutral province. Edges: H-R 40, R-A 30, R-B 50, R-C 20, A-E 40, B-E 60, C-E 30,
C-N 20. The mirror half (ids 7 to 13) and the edge E-E' only make the map whole. ``RULES`` is
``mvp-7`` (item J: both features on) without CP income, production or supply dispatch, so the CP
and the warehouses hold exactly what a test puts in ("regeneration ignored" in the tables).

The groups of the tables are made at tick 99 (so g7 is still on its edge at 100), the CP set to
500, and the command applied at tick 100 unless a row says otherwise.
"""

import copy
from dataclasses import replace
from pathlib import Path
from typing import cast

import pytest

from gow_sim.commands import (
    CancelOrder,
    Command,
    GroupMove,
    Member,
    Merge,
    Move,
    Ok,
    OrderKind,
    PlayerCommand,
    Recruit,
    Reject,
    RejectCode,
    ReleasePlan,
    SetRallyPoint,
    Split,
    rally_price,
    validate,
)
from gow_sim.maps import load_map
from gow_sim.match import HEADLESS_MATCH_KEY, Match
from gow_sim.ruleset import (
    Ruleset,
    RulesetError,
    StanceTable,
    load_ruleset,
    parse_ruleset,
    to_canonical,
)
from gow_sim.state import PLAN_WAIT, AtNode, Event, GameState, Group, Mode, OnEdge, Order
from gow_sim.systems.capacity import change_owner
from gow_sim.systems.orders import plan_parts
from gow_sim.view import project

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[2]
MVP7 = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")
_NEVER = 10**6
"""A period no test reaches: no CP income, no production, no dispatch of the flow."""
_STILL = StanceTable(economy=_NEVER, balance=_NEVER, war=_NEVER)
RULES = replace(
    MVP7,
    stances=replace(MVP7.stances, cp_period_ticks=_STILL, capital_period_ticks=_STILL),
    supply=replace(MVP7.supply, dispatch_ticks=_NEVER),
)
NO_SECTION = replace(RULES, group_order=None)
"""The same rules without ``[group_order]``: ``ReleasePlan`` works as in DEC-41."""
MAP = load_map(TESTS_DIR / "maps" / "dec48.json")
H, R, A, B, C, N, E = range(7)
INVALID = Reject(RejectCode.INVALID_ARGUMENT)

_SPEC: dict[str, tuple[int, int, int]] = {
    "g1": (A, 3, 3),
    "g2": (B, 2, 2),
    "g3": (C, 2, 2),
    "g4": (R, 4, 4),
    "g5": (H, 5, 5),
    "g6": (H, 1, 0),
}


# Helpers --------------------------------------------------------------------------------------


def _match(rules: Ruleset = RULES) -> Match:
    m = Match(MAP, rules, HEADLESS_MATCH_KEY)
    m.state.nodes[H].has_barracks = True  # the capital, as on every map
    return m


def _group(m: Match, node: int, units: int, charged: int, owner: int = 0) -> Group:
    gid = m.state.new_id()
    group = Group(gid, owner, units, charged, Mode.ATTACK, AtNode(node))
    m.state.groups[gid] = group
    return group


def _make(m: Match, *names: str) -> dict[str, Group]:
    """The groups of the tables by name, made now; g7 is on the edge H-R moving to R."""
    made: dict[str, Group] = {}
    for name in names:
        if name == "g7":
            gid = m.state.new_id()
            g = Group(gid, 0, 2, 2, Mode.ATTACK, OnEdge(0, H, 500))
            g.order = Order((R,), planned=False, depart_tick=1)
            m.state.groups[gid] = g
            made[name] = g
            continue
        node, units, charged = _SPEC[name]
        made[name] = _group(m, node, units, charged)
    return made


def _start(*names: str, cp: int = 500, rules: Ruleset = RULES) -> tuple[Match, dict[str, Group]]:
    """A match at tick 99 with the named groups and ``cp`` hundredths of CP for player 0."""
    m = _match(rules)
    _to(m, 99)
    groups = _make(m, *names)
    m.state.players[0].cp = cp
    return m, groups


def _to(m: Match, tick: int, *cmds: Command, enemy: tuple[Command, ...] = ()) -> list[Event]:
    """Step ``m`` until ``m.tick == tick``; ``cmds`` (player 0) and ``enemy`` (player 1) are
    applied at ``tick``. Returns the events of the steps."""
    events: list[Event] = []
    while m.tick < tick - 1:
        events += m.step()
    if m.tick < tick:
        orders = [PlayerCommand(0, seq, c) for seq, c in enumerate(cmds)]
        orders += [PlayerCommand(1, seq, c) for seq, c in enumerate(enemy)]
        events += m.step(orders)
    return events


def _outcome(m: Match, player: int = 0, seq: int = 0) -> Ok | Reject:
    return next(r.outcome for r in m.results if (r.player, r.seq) == (player, seq))


def _ok(m: Match, seq: int = 0) -> Ok:
    outcome = _outcome(m, 0, seq)
    assert isinstance(outcome, Ok), outcome
    return outcome


def _ids(groups: dict[str, Group], *names: str) -> tuple[int, ...]:
    return tuple(groups[n].id for n in names)


def _at(g: Group) -> int | None:
    return g.location.node if isinstance(g.location, AtNode) else None


def _cp(m: Match) -> int:
    return m.state.players[0].cp


def _schedule(ok: Ok) -> list[tuple[int | None, int | None]]:
    return [(mm.depart_tick, mm.arrive_tick) for mm in ok.members]


def _departs(g: dict[str, Group]) -> list[int | None]:
    """The departure ticks of g1, g2, g3 (``None``: no order)."""
    out: list[int | None] = []
    for n in ("g1", "g2", "g3"):
        order = g[n].order
        out.append(None if order is None else order.depart_tick)
    return out


# Synchronized attack (ordinary) ---------------------------------------------------------------


def test_s1_three_groups_arrive_in_one_tick_and_enter_one_fight() -> None:
    m, g = _start("g1", "g2", "g3")
    z = _group(m, E, 3, 3, owner=1)
    _to(m, 100, GroupMove(_ids(g, "g1", "g2", "g3"), E))
    ok = _ok(m)
    assert (ok.kind, ok.cost, _cp(m)) == (OrderKind.ATTACK, 300, 200)
    assert ok.arrive_tick == 159  # 100 + 60 - 1
    assert _schedule(ok) == [(120, 159), (100, 159), (130, 159)]
    assert [mm.path for mm in ok.members] == [(A, E), (B, E), (C, E)]
    _to(m, 119)
    assert _at(g["g1"]) == A and _at(g["g3"]) == C  # waiting in their nodes
    _to(m, 120)
    assert isinstance(g["g1"].location, OnEdge)
    _to(m, 158)
    assert all(_at(g[n]) != E for n in ("g1", "g2", "g3"))
    events = _to(m, 159)
    started = [e for e in events if e.kind == "fight_started"]
    assert len(started) == 1 and started[0].get("node") == E
    fight = m.state.fights[g["g1"].fight or -1]
    assert sorted(fight.members) == sorted((*_ids(g, "g1", "g2", "g3"), z.id))
    assert fight.last_round is None  # before its first round


def test_s2_a_big_member_takes_its_own_path_and_passes_a_waiting_one() -> None:
    m, g = _start("g1", "g4")
    _to(m, 100, GroupMove(_ids(g, "g1", "g4"), E))
    ok = _ok(m)
    assert ok.members[1].path == (R, A, E)  # R-C-E is closed by C (capacity 3)
    assert (ok.arrive_tick, _schedule(ok)) == (169, [(130, 169), (100, 169)])
    assert ok.cost == 200
    _to(m, 129)
    g4 = g["g4"]
    assert isinstance(g4.location, OnEdge) and g4.location.from_node == A  # in transit
    assert g["g1"].id in m.state.groups and _at(g["g1"]) == A  # no merge
    _to(m, 169)
    assert _at(g["g1"]) == E and _at(g4) == E


def test_s3_one_group_is_a_move() -> None:
    m, g = _start("g3")
    move = validate(m.state, m.rules, 0, Move(g["g3"].id, E))
    assert isinstance(move, Ok)
    _to(m, 100, GroupMove(_ids(g, "g3"), E))
    ok = _ok(m)
    assert (ok.cost, ok.arrive_tick) == (100, 129)
    assert move.arrive_tick == 128  # the same Move, validated at tick 99
    _to(m, 129)
    assert _at(g["g3"]) == E


def test_s4_a_group_on_an_edge_is_dropped_and_keeps_its_order() -> None:
    m, g = _start("g1", "g7", "g3")
    order = g["g7"].order
    _to(m, 100, GroupMove(_ids(g, "g1", "g7", "g3"), E))
    ok = _ok(m)
    assert ok.members[1] == Member(g["g7"].id, reject=RejectCode.GROUP_ON_EDGE)
    assert (ok.arrive_tick, ok.cost) == (139, 200)
    assert [ok.members[0].depart_tick, ok.members[2].depart_tick] == [100, 110]
    assert g["g7"].order == order and g["g7"].group_order is None


def test_s5_a_member_too_big_for_every_path_is_dropped() -> None:
    m, g = _start("g5", "g3")
    _to(m, 100, GroupMove(_ids(g, "g5", "g3"), N))
    ok = _ok(m)
    assert ok.members[0].reject is RejectCode.STACK_LIMIT
    assert (ok.cost, ok.members[1].depart_tick, ok.members[1].arrive_tick) == (100, 100, 119)
    _to(m, 119)
    assert _at(g["g3"]) == N and m.state.nodes[N].owner == 0


def test_s6_no_valid_member_rejects_the_command_with_the_first_code() -> None:
    m, g = _start("g5", "g7")
    _to(m, 100, GroupMove(_ids(g, "g5", "g7"), N))
    outcome = _outcome(m)
    assert outcome == Reject(
        RejectCode.STACK_LIMIT,
        (
            Member(g["g5"].id, reject=RejectCode.STACK_LIMIT),
            Member(g["g7"].id, reject=RejectCode.GROUP_ON_EDGE),
        ),
    )
    assert _cp(m) == 500 and g["g5"].order is None and not m.state.group_orders


def test_s7_cp_are_all_or_nothing() -> None:
    m, g = _start("g1", "g2", "g3", cp=250)
    _to(m, 100, GroupMove(_ids(g, "g1", "g2", "g3"), E))
    assert _outcome(m) == Reject(RejectCode.NOT_ENOUGH_CP)
    assert _cp(m) == 250
    assert all(g[n].order is None for n in ("g1", "g2", "g3"))


def test_s8_a_cancelled_waiting_member_stands_and_the_others_keep_their_schedule() -> None:
    m, g = _start("g1", "g2", "g3")
    _to(m, 100, GroupMove(_ids(g, "g1", "g2", "g3"), E))
    _to(m, 110, CancelOrder(g["g3"].id))
    assert isinstance(_outcome(m), Ok)
    g3 = g["g3"]
    assert (_at(g3), g3.order, g3.group_order, _cp(m)) == (C, None, None, 200)
    _to(m, 119)
    assert _at(g["g1"]) == A
    _to(m, 120)
    assert isinstance(g["g1"].location, OnEdge)
    _to(m, 159)
    assert _at(g["g1"]) == E and _at(g["g2"]) == E


def test_s9_a_cancelled_member_on_its_way_turns_back_and_nobody_is_re_timed() -> None:
    m, g = _start("g1", "g2", "g3")
    _to(m, 100, GroupMove(_ids(g, "g1", "g2", "g3"), E))
    _to(m, 110, CancelOrder(g["g2"].id))
    _to(m, 118)
    assert isinstance(g["g2"].location, OnEdge)
    _to(m, 119)
    assert _at(g["g2"]) == B
    assert [_departs(g)[0], _departs(g)[2]] == [120, 130]
    _to(m, 159)
    assert _at(g["g1"]) == E and _at(g["g3"]) == E


def test_s10_a_member_held_on_the_way_arrives_late_and_alone() -> None:
    m, g = _start("g1", "g2", "g3")
    z = _group(m, E, 3, 3, owner=1)
    y = _group(m, E, 1, 1, owner=1)
    _to(m, 100, GroupMove(_ids(g, "g1", "g2", "g3"), E))
    _to(m, 101, enemy=(Move(y.id, B),))
    assert isinstance(_outcome(m, 1), Ok)
    events = _to(m, 130)
    started = [e for e in events if e.kind == "fight_started" and e.tick == 130]
    assert [e.get("edge") for e in started] == [5]  # B-E
    g2 = g["g2"]
    _to(m, 150)
    assert (g2.units, g2.charged, y.units, y.charged) == (2, 1, 1, 0)  # r1: cancelled
    _to(m, 159)
    assert _at(g["g1"]) == E and _at(g["g3"]) == E  # as scheduled, without g2
    assert g["g1"].fight is not None and z.id in m.state.fights[g["g1"].fight].members
    _to(m, 170)
    assert y.id not in m.state.groups  # r2: g2 kills Y
    _to(m, 179)
    assert isinstance(g2.location, OnEdge) and g2.fight is None
    _to(m, 207)
    assert _at(g2) is None
    _to(m, 208)
    assert (_at(g2), g2.units, g2.charged) == (E, 2, 0)  # its shot of r2 spent its last charge


def test_s11_a_waiting_member_attacked_in_its_node_departs_after_the_fight() -> None:
    m = _match()
    _to(m, 70)
    x = _group(m, E, 1, 1, owner=1)
    _to(m, 71, enemy=(Move(x.id, A),))
    assert isinstance(_outcome(m, 1), Ok)
    _to(m, 99)
    g = _make(m, "g1", "g2", "g3")
    m.state.players[0].cp = 500
    _to(m, 100, GroupMove(_ids(g, "g1", "g2", "g3"), E))
    events = _to(m, 110)
    assert any(e.kind == "fight_started" and e.get("node") == A for e in events)
    events = _to(m, 150)
    ended = [e for e in events if e.kind == "fight_ended" and e.get("node") == A]
    assert [e.tick for e in ended] == [150]
    g1 = g["g1"]
    assert x.id not in m.state.groups  # r1 cancelled, r2 killed it
    assert (_at(g1), g1.units, g1.charged) == (A, 3, 1)
    _to(m, 151)
    assert isinstance(g1.location, OnEdge)  # its d 120 passed in the fight (DEC-24, E4)
    _to(m, 159)
    assert _at(g["g2"]) == E and _at(g["g3"]) == E
    _to(m, 189)
    assert isinstance(g1.location, OnEdge)
    _to(m, 190)
    assert _at(g1) == E or g1.id not in m.state.groups  # it arrived (and merged)


def test_s12_a_target_taken_meanwhile_is_an_own_node_and_the_members_merge() -> None:
    m = _match()
    _to(m, 80)
    g8 = _group(m, B, 1, 1)
    _to(m, 81, Move(g8.id, E))
    _to(m, 99)
    g = _make(m, "g1", "g2", "g3")
    m.state.players[0].cp = 500
    _to(m, 100, GroupMove(_ids(g, "g1", "g2", "g3"), E))
    _to(m, 140)
    assert m.state.nodes[E].owner == 0
    _to(m, 159)
    assert all(g[n].id not in m.state.groups for n in ("g1", "g2", "g3"))
    assert (g8.units, g8.charged, _at(g8), _cp(m)) == (8, 7, E, 200)


def test_s13_an_empty_target_is_taken_for_one_charge_in_all() -> None:
    m, g = _start("g1", "g2", "g3")
    _to(m, 100, GroupMove(_ids(g, "g1", "g2", "g3"), E))
    _to(m, 159)
    assert m.state.nodes[E].owner == 0
    here = [x for x in m.state.groups.values() if x.owner == 0 and x.location == AtNode(E)]
    assert (sum(x.units for x in here), sum(x.charged for x in here)) == (7, 6)


# Rally -----------------------------------------------------------------------------------------


def test_r1_a_rally_departs_at_once_and_merges_as_it_arrives() -> None:
    m, g = _start("g1", "g2", "g3")
    _to(m, 100, GroupMove(_ids(g, "g1", "g2", "g3"), R))
    ok = _ok(m)
    assert (ok.kind, ok.cost, _cp(m), ok.arrive_tick) == (OrderKind.RALLY, 200, 300, 149)
    assert _schedule(ok) == [(100, 129), (100, 149), (100, 119)]
    g3 = g["g3"]
    _to(m, 119)
    assert _at(g3) == R
    _to(m, 129)
    assert (g3.units, g3.charged) == (5, 5) and g["g1"].id not in m.state.groups
    _to(m, 149)
    assert (g3.units, g3.charged) == (7, 7) and g["g2"].id not in m.state.groups


def test_r2_a_rally_over_the_capacity_is_not_checked() -> None:
    m, g = _start("g1", "g2", "g3", "g5", "g6")
    _to(m, 100, GroupMove(_ids(g, "g1", "g2", "g3", "g5", "g6"), R))
    assert (_ok(m).cost, _cp(m)) == (300, 200)
    g3 = g["g3"]
    _to(m, 139)
    assert g3.units == 11
    _to(m, 149)
    assert (g3.units, g3.charged) == (13, 12)  # above the capacity 8 (DEC-12 follows)


def test_r3_a_member_already_in_the_target_is_dropped_and_not_charged() -> None:
    m, g = _start("g1", "g4", "g3")
    _to(m, 100, GroupMove(_ids(g, "g1", "g4", "g3"), R))
    ok = _ok(m)
    assert ok.members[1] == Member(g["g4"].id, reject=RejectCode.INVALID_ARGUMENT)
    assert (ok.cost, _cp(m)) == (100, 400)


def test_r4_a_rally_of_one_group_costs_a_move() -> None:
    m, g = _start("g3")
    _to(m, 100, GroupMove(_ids(g, "g3"), R))
    assert (_ok(m).cost, _ok(m).kind) == (100, OrderKind.RALLY)


def test_r5_a_rally_target_captured_meanwhile_is_attacked_and_retaken() -> None:
    m, g = _start("g1", "g2")
    _to(m, 100, GroupMove(_ids(g, "g1", "g2"), R))
    assert _ok(m).cost == 100
    _to(m, 119)
    w = _group(m, R, 1, 1, owner=1)
    change_owner(m.state, R, 1)  # W takes the empty R at tick 120
    _to(m, 122, enemy=(Move(w.id, C),))
    assert isinstance(_outcome(m, 1), Ok)  # W leaves R
    _to(m, 129)
    g1 = g["g1"]
    assert (m.state.nodes[R].owner, _at(g1), g1.units, g1.charged) == (0, R, 3, 2)
    _to(m, 149)
    assert (g1.units, g1.charged, _cp(m)) == (5, 4, 400)


def test_r6_a_planned_rally_is_invalid() -> None:
    m, g = _start("g1", "g2")
    _to(m, 100, GroupMove(_ids(g, "g1", "g2"), R, planned=True, bonus=2))
    assert _outcome(m) == INVALID and _cp(m) == 500


@pytest.mark.parametrize(("n", "cp"), [(1, 1), (2, 1), (3, 2), (4, 2), (5, 3), (6, 3)])
def test_r7_the_rally_price(n: int, cp: int) -> None:
    assert rally_price(RULES, n) == cp * 100


# Synchronized planned attack ------------------------------------------------------------------


def _planned(bonus: int = 4, a: int = 2, b: int = 1, c: int = 1) -> tuple[Match, dict[str, Group]]:
    """P1's start: the warehouses hold A ``a``, B ``b``, C ``c`` charges."""
    m, g = _start("g1", "g2", "g3")
    for node, stock in ((A, a), (B, b), (C, c)):
        m.state.nodes[node].warehouse = stock
    _to(m, 100, GroupMove(_ids(g, "g1", "g2", "g3"), E, planned=True, bonus=bonus))
    return m, g


def _charged(events: list[Event]) -> list[tuple[int, object]]:
    return sorted((e.tick, e.get("node")) for e in events if e.kind == "plan_charged")


def test_p1_the_parts_gather_and_the_departures_are_fixed_when_the_last_is_ready() -> None:
    m, g = _planned()
    z = _group(m, E, 3, 3, owner=1)
    ok = _ok(m)
    assert (ok.cost, _cp(m), ok.arrive_tick) == (300, 200, None)
    assert [mm.bonus for mm in ok.members] == [2, 1, 1]
    assert _schedule(ok) == [(None, None)] * 3
    enemy = project(m.state, m.rules, 1, HEADLESS_MATCH_KEY)
    assert sorted((i.origin, i.target) for i in enemy.intents) == [(A, E), (B, E), (C, E)]
    events = _to(m, 160)
    assert _charged(events) == [(130, A), (130, B), (130, C), (160, A)]
    assert _departs(g) == [181, 161, 191]
    assert m.state.group_orders[g["g1"].group_order or -1].arrive_tick == 220
    assert [m.state.nodes[n].warehouse for n in (A, B, C)] == [0, 0, 0]
    _to(m, 219)
    assert all(g[n].fight is None for n in ("g1", "g2", "g3"))
    _to(m, 220)
    fight = m.state.fights[g["g1"].fight or -1]
    assert sorted(fight.members) == sorted((*_ids(g, "g1", "g2", "g3"), z.id))
    assert fight.virtual[0] == 4  # the bonuses add up (DEC-24, F1)


@pytest.mark.parametrize(
    ("bonus", "parts"),
    [
        (1, [1, 0, 0]),
        (2, [1, 1, 0]),
        (3, [1, 1, 1]),
        (6, [2, 2, 2]),
        (7, [3, 2, 2]),
        (9, [3, 2, 2]),
    ],
)
def test_p2_the_split_of_the_request(bonus: int, parts: list[int]) -> None:
    assert plan_parts([3, 2, 2], bonus) == parts
    m, g = _start("g1", "g2", "g3")
    plan = GroupMove(_ids(g, "g1", "g2", "g3"), E, planned=True, bonus=bonus)
    ok = validate(m.state, m.rules, 0, plan)
    assert isinstance(ok, Ok) and [mm.bonus for mm in ok.members] == parts


def test_p3_the_caps_are_the_charged_units_at_the_command() -> None:
    m, g = _start("g1", "g2", "g3")
    g["g1"].charged = 1
    plan = GroupMove(_ids(g, "g1", "g2", "g3"), E, planned=True, bonus=4)
    ok = validate(m.state, m.rules, 0, plan)
    assert isinstance(ok, Ok) and [mm.bonus for mm in ok.members] == [1, 2, 1]


def test_p4_an_empty_warehouse_pauses_a_member_and_holds_the_order() -> None:
    m, g = _planned(b=0)
    _to(m, 199)
    assert _departs(g) == [PLAN_WAIT] * 3
    m.state.nodes[B].warehouse = 1  # a charge arrives at tick 200
    events = _to(m, 200)
    assert _charged(events) == [(200, B)]
    assert _departs(g) == [221, 201, 231]
    assert m.state.group_orders[g["g2"].group_order or -1].arrive_tick == 260


def test_p5_release_plan_is_invalid_under_the_section() -> None:
    m, g = _planned()
    _to(m, 140, ReleasePlan(g["g1"].id))
    assert _outcome(m) == INVALID and g["g1"].bonus == 1
    _to(m, 160)
    assert _departs(g) == [181, 161, 191]


def test_p6_the_cancel_of_the_last_member_not_ready_fixes_the_others_at_once() -> None:
    m, g = _planned()
    _to(m, 140, CancelOrder(g["g1"].id))
    g1 = g["g1"]
    assert (_at(g1), g1.order, g1.bonus, g1.intent, _cp(m)) == (A, None, 0, None, 200)
    assert m.state.nodes[A].warehouse == 1  # the charge of 130 is lost
    assert _departs(g)[1:] == [140, 170]
    assert m.state.group_orders[g["g2"].group_order or -1].arrive_tick == 199
    assert g["g2"].bonus + g["g3"].bonus == 2
    _to(m, 140)
    assert isinstance(g["g2"].location, OnEdge)


def test_p7_a_member_with_no_part_shows_its_intent_and_is_ready_at_once() -> None:
    m, g = _planned(bonus=2)
    assert [mm.bonus for mm in _ok(m).members] == [1, 1, 0]
    enemy = project(m.state, m.rules, 1, HEADLESS_MATCH_KEY)
    assert (C, E) in [(i.origin, i.target) for i in enemy.intents]
    events = _to(m, 131)
    assert _charged(events) == [(130, A), (130, B)]
    assert _departs(g) == [151, 131, 161]
    assert m.state.group_orders[g["g1"].group_order or -1].arrive_tick == 190
    assert g["g1"].bonus + g["g2"].bonus + g["g3"].bonus == 2


def test_p8_a_member_that_never_gets_its_charge_holds_the_order_until_cancelled() -> None:
    m, g = _planned(b=0)
    _to(m, 299)
    assert _departs(g) == [PLAN_WAIT] * 3
    _to(m, 300, CancelOrder(g["g2"].id))
    g2 = g["g2"]
    assert (_at(g2), g2.order, _cp(m)) == (B, None, 200)
    assert [_departs(g)[0], _departs(g)[2]] == [300, 310]
    assert m.state.group_orders[g["g1"].group_order or -1].arrive_tick == 339
    assert g["g1"].bonus + g["g3"].bonus == 3


def test_p9_a_single_plan_departs_by_itself_and_its_release_is_invalid() -> None:
    m, g = _start("g1")
    m.state.nodes[A].warehouse = 2
    _to(m, 100, Move(g["g1"].id, E, planned=True, bonus=2))
    assert _ok(m).arrive_tick == 200  # departs at 161 (the forecast was 199 before #896)
    _to(m, 140, ReleasePlan(g["g1"].id))
    assert _outcome(m) == INVALID
    _to(m, 160)
    assert g["g1"].order is not None and g["g1"].order.depart_tick == 161
    _to(m, 199)
    assert _at(g["g1"]) is None
    _to(m, 200)
    assert _at(g["g1"]) == E


def test_p9_without_the_section_the_release_works() -> None:
    m, g = _start("g1", rules=NO_SECTION)
    m.state.nodes[A].warehouse = 2
    _to(m, 100, Move(g["g1"].id, E, planned=True, bonus=2))
    _to(m, 140, ReleasePlan(g["g1"].id))
    assert isinstance(_outcome(m), Ok)
    assert g["g1"].order is not None and g["g1"].order.depart_tick == 140


# Recruit rally point -----------------------------------------------------------------------------


def _rally(recruits: int, point: int = R, cp: int = 500) -> tuple[Match, dict[str, Group]]:
    """``SetRallyPoint(H, point)`` at 90 and ``recruits`` times ``Recruit(H)`` at 100; g5 and g6
    in H."""
    m = _match()
    _to(m, 89)
    g = _make(m, "g5", "g6")
    m.state.players[0].cp = cp
    _to(m, 90, SetRallyPoint(H, point))
    assert isinstance(_outcome(m), Ok) and _cp(m) == cp
    _to(m, 100, *(Recruit(H) for _ in range(recruits)))
    return m, g


def _new(events: list[Event]) -> list[int]:
    """The groups recruited in ``events``."""
    out: list[int] = []
    for e in events:
        gid = e.get("group") if e.kind == "recruited" else None
        if isinstance(gid, int):
            out.append(gid)
    return out


def test_rp1_a_recruit_walks_to_the_point_and_pays_when_it_leaves() -> None:
    m, _ = _rally(1)
    assert _cp(m) == 400
    events = _to(m, 129)
    (gid,) = _new(events)
    unit = m.state.groups[gid]
    assert (unit.units, unit.charged, _at(unit)) == (1, 0, H)
    assert unit.order == Order((R,), planned=False, depart_tick=130)
    assert not [e for e in events if e.kind == "groups_merged" and e.tick == 129]
    assert _cp(m) == 400
    _to(m, 130)
    assert isinstance(unit.location, OnEdge) and _cp(m) == 350 and unit.charged == 0
    _to(m, 169)
    assert _at(unit) == R


def test_rp2_each_recruit_walks_alone() -> None:
    m, _ = _rally(3)
    assert _cp(m) == 200
    arrivals: list[int] = []
    cp: dict[int, int] = {}
    units: list[int] = []
    for tick in range(101, 231):
        events = _to(m, tick)
        units += _new(events)
        arrivals += [e.tick for e in events if e.kind == "group_arrived" and e.get("node") == R]
        cp[tick] = _cp(m)
    assert len(units) == 3
    assert arrivals == [169, 199, 229]
    assert (cp[129], cp[130], cp[160], cp[190]) == (200, 150, 100, 50)


def test_rp3_a_captured_point_is_cleared_and_the_walker_attacks() -> None:
    m, _ = _rally(2)
    events = _to(m, 130)
    (first,) = [x for x in m.state.groups.values() if isinstance(x.location, OnEdge)]
    _to(m, 149)
    w = _group(m, R, 1, 1, owner=1)
    cleared = change_owner(m.state, R, 1)  # the enemy captures R at tick 150
    assert [(e.kind, dict(e.data)) for e in cleared if e.kind == "rally_point_cleared"] == [
        ("rally_point_cleared", {"player": 0, "node": H, "target": R})
    ]
    assert m.state.nodes[H].rally_point is None
    events = _to(m, 159)
    (second,) = _new(events)
    assert second not in m.state.groups  # no point: it merged in H
    assert first.order == Order((R,), planned=False, depart_tick=130)
    _to(m, 169)
    assert _at(first) == R and first.fight is not None and w.id in m.state.groups


def test_rp4_no_own_path_to_the_point_the_recruit_stays_and_the_point_stays() -> None:
    m, g = _rally(1, point=A)
    _to(m, 119)
    change_owner(m.state, R, 1)  # H has no own path to A any more
    events = _to(m, 129)
    (gid,) = _new(events)
    assert gid not in m.state.groups
    assert g["g5"].units == 6 and m.state.nodes[H].rally_point == A


@pytest.mark.parametrize(
    ("cmd", "code"),
    [
        (SetRallyPoint(H, N), RejectCode.NOT_OWNER),
        (SetRallyPoint(C, R), RejectCode.NOT_CITY),
        (SetRallyPoint(H, H), RejectCode.INVALID_ARGUMENT),
        (SetRallyPoint(A, R), RejectCode.NO_BARRACKS),
        (SetRallyPoint(E, R), RejectCode.NOT_OWNER),
        (SetRallyPoint(99, R), RejectCode.NOT_FOUND_OR_HIDDEN),
        (SetRallyPoint(H, 99), RejectCode.NOT_FOUND_OR_HIDDEN),
    ],
)
def test_rp5_the_checks_of_set_rally_point(cmd: SetRallyPoint, code: RejectCode) -> None:
    m = _match()
    assert validate(m.state, m.rules, 0, cmd) == Reject(code)


def test_rp5_the_flag_off() -> None:
    rules = replace(RULES, recruit=replace(RULES.recruit, rally_point=False, rally_cost=0))
    m = _match(rules)
    assert validate(m.state, m.rules, 0, SetRallyPoint(H, R)) == INVALID


def test_rp6_clearing() -> None:
    m = _match()
    assert validate(m.state, m.rules, 0, SetRallyPoint(H, None)) == Reject(RejectCode.NO_CHANGE)
    _to(m, 1, SetRallyPoint(H, R))
    assert validate(m.state, m.rules, 0, SetRallyPoint(H, R)) == Reject(RejectCode.NO_CHANGE)
    cp = _cp(m)
    _to(m, 2, SetRallyPoint(H, None))
    assert isinstance(_outcome(m), Ok) and _cp(m) == cp
    assert m.state.nodes[H].rally_point is None


def test_rp7_a_captured_city_loses_its_queue_and_its_point() -> None:
    m, _ = _rally(1)
    _to(m, 119)
    change_owner(m.state, H, 1)
    node = m.state.nodes[H]
    assert (node.recruit_queue, node.rally_point) == (0, None)


def test_rp8_without_the_cp_the_recruit_gets_no_order_and_merges() -> None:
    m, g = _rally(1)
    _to(m, 129)
    m.state.players[0].cp = 20
    events = _to(m, 130)
    alerts = [dict(e.data) for e in events if e.kind == "rally_walk_no_cp"]
    assert len(alerts) == 1
    assert (alerts[0]["player"], alerts[0]["node"], alerts[0]["target"]) == (0, H, R)
    assert alerts[0]["group"] not in m.state.groups  # merged with the garrison
    assert (g["g5"].units, g["g5"].charged, _cp(m)) == (6, 5, 20)
    assert m.state.nodes[H].rally_point == R


def test_rp9_no_queue_of_waiting_recruits() -> None:
    m, g = _rally(3)
    _to(m, 129)
    m.state.players[0].cp = 50
    alerts: list[int] = []
    for tick in range(130, 231):
        events = _to(m, tick)
        alerts += [e.tick for e in events if e.kind == "rally_walk_no_cp"]
        if tick == 130:
            assert _cp(m) == 0
    assert alerts == [160, 190]
    assert g["g5"].units == 7 and _cp(m) == 0


# Items B, D, F7, I and J ----------------------------------------------------------------------


def test_b3_malformed_group_moves_are_invalid() -> None:
    m, g = _start("g1", "g2")
    state, rules = m.state, m.rules
    a, b = _ids(g, "g1", "g2")
    assert validate(state, rules, 0, GroupMove((), E)) == INVALID
    assert validate(state, rules, 0, GroupMove((a, a), E)) == INVALID
    assert validate(state, rules, 0, GroupMove((a, b), E, planned=True)) == INVALID
    assert validate(state, rules, 0, GroupMove((a, b), E, bonus=1)) == INVALID
    assert validate(state, rules, 0, GroupMove((a, b), 99)) == Reject(
        RejectCode.NOT_FOUND_OR_HIDDEN
    )
    many = tuple(range(1000, 1017))  # 17 > max_groups
    assert validate(state, rules, 0, GroupMove(many, E)) == INVALID
    assert validate(state, NO_SECTION, 0, GroupMove((a, b), E)) == INVALID


def test_b8_a_waiting_member_takes_only_a_cancel() -> None:
    m, g = _start("g1", "g2", "g3", "g4")
    _to(m, 100, GroupMove(_ids(g, "g1", "g2", "g3"), E))
    _to(m, 101)
    g1, g4 = g["g1"].id, g["g4"].id
    state, rules = m.state, m.rules
    busy = Reject(RejectCode.GROUP_BUSY)
    assert validate(state, rules, 0, Move(g1, R)) == busy
    assert validate(state, rules, 0, Split(g1, 1)) == busy
    assert validate(state, rules, 0, Merge((g1, g4))) == busy
    again = validate(state, rules, 0, GroupMove((g1, g4), E))
    assert isinstance(again, Ok) and again.members[0].reject is RejectCode.GROUP_BUSY
    assert isinstance(validate(state, rules, 0, CancelOrder(g1)), Ok)


def test_d3_a_waiting_member_does_not_merge_with_an_arrival() -> None:
    m, g = _start("g1", "g2", "g3", "g4")
    _to(m, 100, GroupMove(_ids(g, "g1", "g2", "g3"), E))
    _to(m, 101, Move(g["g4"].id, A))
    _to(m, 130)
    assert _at(g["g4"]) == A and g["g1"].id in m.state.groups and g["g4"].units == 4


def _strip(state: GameState) -> GameState:
    """``state`` without anything of DEC-48: no group order, no rally point, no walk."""
    bare = copy.deepcopy(state)
    bare.group_orders = {}
    for g in bare.groups.values():
        g.group_order = None
        g.walk = False
    for n in bare.nodes.values():
        n.rally_point = None
    return bare


def test_i1_the_enemy_sees_nothing_of_a_group_order() -> None:
    """Item I1 (and D4): the enemy's projection with the group order and the rally point equals
    the one without them, in every tick of the order; the planned intents (F7) are in both."""
    for planned in (False, True):
        m, g = _start("g1", "g2", "g3")
        for node, stock in ((A, 2), (B, 1), (C, 1)):
            m.state.nodes[node].warehouse = stock
        _group(m, E, 3, 3, owner=1)
        bonus = 4 if planned else 0
        cmds: list[Command] = [
            GroupMove(_ids(g, "g1", "g2", "g3"), E, planned=planned, bonus=bonus),
            SetRallyPoint(H, R),
            Recruit(H),
        ]
        _to(m, 100, *cmds)
        for tick in range(100, 230, 3):
            _to(m, tick)
            with_order = project(m.state, m.rules, 1, HEADLESS_MATCH_KEY)
            without = project(_strip(m.state), m.rules, 1, HEADLESS_MATCH_KEY)
            assert with_order == without, tick
            assert all(n.rally_point is None for n in with_order.nodes)


def test_i1_i2_the_own_view_carries_the_group_order_and_the_rally_point() -> None:
    m, g = _start("g1", "g2", "g3")
    _to(m, 100, GroupMove(_ids(g, "g1", "g2", "g3"), E), SetRallyPoint(H, R))
    view = project(m.state, m.rules, 0, HEADLESS_MATCH_KEY)
    orders = [v.order for v in view.groups if v.order is not None]
    assert len(orders) == 3
    assert len({o.group_order for o in orders}) == 1 and orders[0].group_order is not None
    assert {o.arrive_tick for o in orders} == {159}
    assert sorted(o.depart_tick or 0 for o in orders) == [100, 120, 130]
    assert view.nodes[H].rally_point == R
    assert all(n.rally_point is None for n in view.nodes if n.id != H)


def test_i1_a_planned_member_has_no_departure_until_the_departures_are_fixed() -> None:
    m, _ = _planned(bonus=2)
    view = project(m.state, m.rules, 0, HEADLESS_MATCH_KEY)
    orders = [v.order for v in view.groups if v.order is not None]
    assert len(orders) == 3
    assert all(o.depart_tick is None and o.arrive_tick is None for o in orders)
    assert sorted(o.gathering for o in orders) == [False, True, True]  # g3: part 0, ready
    _to(m, 131)
    view = project(m.state, m.rules, 0, HEADLESS_MATCH_KEY)
    assert {v.order.arrive_tick for v in view.groups if v.order is not None} == {190}


def _with(section: str, **values: object) -> dict[str, object]:
    """The canonical data of mvp-7 with ``values`` set in ``section``."""
    raw = to_canonical(MVP7)
    table = dict(cast(dict[str, object], raw[section]))
    table.update(values)
    raw[section] = table
    return raw


def test_j_the_keys() -> None:
    raw = to_canonical(MVP7)
    assert raw["group_order"] == {"max_groups": 16, "rally_pct": 50}
    with pytest.raises(RulesetError, match=r"group_order\.max_groups"):
        parse_ruleset(_with("group_order", max_groups=17))
    with pytest.raises(RulesetError, match=r"recruit\.rally_cost"):
        parse_ruleset(_with("recruit", rally_cost=101))  # above orders.cost.move
    with pytest.raises(RulesetError, match=r"recruit\.rally_cost"):
        parse_ruleset(_with("recruit", rally_point=False))  # only with the point
    mvp6 = load_ruleset(ROOT / "rulesets" / "mvp-6.toml")
    assert mvp6.group_order is None and not mvp6.recruit.rally_point


def test_the_order_ends_with_its_last_member() -> None:
    m, g = _start("g3")
    _to(m, 100, GroupMove(_ids(g, "g3"), E))
    assert len(m.state.group_orders) == 1
    _to(m, 129)
    assert not m.state.group_orders and g["g3"].group_order is None
