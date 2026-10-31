"""Projection (SIM-14): PlayerView by DEC-04, DEC-17, DEC-21 and DEC-35, opaque ids, resolve(),
determinism.

Every rule of DEC-04 and DEC-17 (mechanics.md, section 10) has its own test below, plus the list
of what a view must not contain (AGENTS.md, section 4.4) and the #112 default; the examples of
DEC-21 and DEC-33 are in ``test_dec21.py`` and ``test_dec33.py``. Expected detail levels are
worked out by hand from DEC-21 and the map file:

- line6: 0 (capital of 0) -e0- 1 -e1- 2 -e2- 3 -e3- 4 -e4- 5 (capital of 1), all plains; player 0
  owns 0 and 1, player 1 owns 4 and 5, nodes 2 and 3 are neutral; roads level 1, ``max_level`` 3;
  the ``rules`` fixture gives capitals capacity 40 and the large cities 30 (DEC-22: by node kind).
  The map has no starting groups. Player 0 at the start (DEC-35: only own groups are sources):
  no sources, the own nodes 0, 1 ``PRESENCE`` (detail 3), 2..5 fog; every edge in fog for the road
  level, the own internal e0 with its road level exact (detail 5). A group of player 0 in node 1
  makes 0, 1 and 2 exact (plains sees plains) and e0, e1 not in fog.
"""

import dataclasses
import os
import re
import subprocess  # noqa: TID251 (fresh process with PYTHONHASHSEED)
import sys
from pathlib import Path

import pytest
from hypothesis import given
from hypothesis import strategies as st

from gow_sim.commands import (
    Merge,
    Move,
    Recruit,
    Reject,
    RejectCode,
    SetMode,
    Split,
    validate,
)
from gow_sim.maps import ROAD_START_LEVEL, NodeKind, load_map
from gow_sim.ruleset import Ruleset, Stance, load_ruleset
from gow_sim.state import (
    PROGRESS_SCALE,
    AtNode,
    Build,
    BuildKind,
    Detail,
    Edge,
    Event,
    GameState,
    Group,
    Intent,
    IntentKind,
    Mode,
    OnEdge,
    Order,
    Packet,
    Sighting,
    VisionMemory,
    initial_state,
    state_hash,
)
from gow_sim.systems.capacity import city_capacity
from gow_sim.systems.vision import vision
from gow_sim.view import (
    BuildView,
    GroupView,
    IntentView,
    PlayerView,
    SelfView,
    UpgradeGain,
    opaque_id,
    project,
    resolve,
)

TESTS_DIR = Path(__file__).resolve().parent
MVP0 = TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml"
TEST_MAPS = ("line3", "diamond", "choke", "line6", "fork", "siege")
KEY = bytes(range(32))
OTHER_KEY = bytes(range(1, 33))
WIRE_ID = re.compile(r"[A-Za-z0-9_-]{1,32}")

E, R, P, F = Detail.EXACT, Detail.RANGE, Detail.PRESENCE, Detail.FOG


@pytest.fixture(scope="module")
def rules() -> Ruleset:
    return _line6_rules()


def _line6_rules() -> Ruleset:
    base = load_ruleset(MVP0)
    by_kind = dataclasses.replace(base.capacity.by_kind, capital=40, city_large=30)
    return dataclasses.replace(base, capacity=dataclasses.replace(base.capacity, by_kind=by_kind))


def _state(name: str, rules: Ruleset) -> GameState:
    return initial_state(load_map(TESTS_DIR / "maps" / f"{name}.json"), rules)


def _add(
    state: GameState,
    owner: int,
    location: AtNode | OnEdge,
    units: int = 3,
    charged: int = 2,
    mode: Mode = Mode.ATTACK,
) -> Group:
    gid = state.new_id()
    group = Group(gid, owner, units=units, charged=charged, mode=mode, location=location)
    state.groups[gid] = group
    return group


def _view(state: GameState, rules: Ruleset, player: int = 0) -> PlayerView:
    return project(state, rules, player, KEY)


# DEC-04, rule by rule -------------------------------------------------------------------------


def test_dec04_geography_and_ownership_of_all_nodes_are_public(rules: Ruleset) -> None:
    state = _state("line6", rules)
    view = _view(state, rules)
    assert [n.id for n in view.nodes] == [0, 1, 2, 3, 4, 5]
    assert [e.id for e in view.edges] == [0, 1, 2, 3, 4]
    assert [n.detail for n in view.nodes] == [P, P, F, F, F, F]  # DEC-35: no own group, no source
    assert [e.detail for e in view.edges] == [F, F, F, F, F]
    assert [n.owner for n in view.nodes] == [0, 0, None, None, 1, 1]


# DEC-17: fog of war for roads, rule by rule ---------------------------------------------------
# line6, player 0: e0 own internal, e1 buffer with an own end; without own groups all in fog
# (DEC-35), the road level of e0 exact (own data, DEC-35, detail 5); e4 internal edge of player
# 1, in fog. Roads have no type (DEC-26, item 7).


def test_dec17_upgrade_in_fog_does_not_change_the_view(rules: Ruleset) -> None:
    state = _state("line6", rules)
    before = _view(state, rules)
    state.edges[3].width = 2
    state.edges[4].width = 3  # upgraded in fog
    after = _view(state, rules)
    assert after == before
    # Never seen: level 1 (point 2; DEC-22, item 8).
    assert [e.width for e in after.edges] == [1, 1, 1, 1, 1]


def test_dec17_own_and_buffer_edges_are_exact(rules: Ruleset) -> None:
    state = _state("line6", rules)
    state.edges[0].width = 3  # own internal edge
    state.edges[1].width = 2  # buffer edge, own end
    # No own group: both in fog (DEC-35); the own internal road is own data and exact (detail 5),
    # the buffer road was never seen (level 1).
    view = _view(state, rules)
    assert [(e.width, e.detail) for e in view.edges[:2]] == [(3, F), (1, F)]
    _add(state, 0, AtNode(1), units=1, charged=1)  # a source at their common end
    view = _view(state, rules)
    assert [(e.width, e.detail) for e in view.edges[:2]] == [(3, P), (2, P)]
    # Player 1 sees its own internal e4 exactly as well.
    state.edges[4].width = 3
    assert _view(state, rules, 1).edges[4].width == 3


def test_dec17_lost_edge_freezes_at_the_last_seen_width(rules: Ruleset) -> None:
    state = _state("line6", rules)
    scout = _add(state, 0, AtNode(4))  # node 4 exact: e3 and e4 are in sight
    state.edges[4].width = 2
    state.tick = 10
    assert _view(state, rules).edges[4].width == 2  # in sight: exact
    vision(state, rules)  # end of tick 10: memory keeps level 2
    scout.location = AtNode(1)  # sight lost
    state.edges[4].width = 3
    state.tick = 20
    lost = _view(state, rules).edges[4]
    assert (lost.width, lost.detail) == (2, F)  # the last sighting
    assert state.vision_memory[0].widths[4] == 2
    scout.location = AtNode(5)  # sight back: exact again
    back = _view(state, rules).edges[4]
    assert (back.width, back.detail) == (3, P)


def test_dec22_capacity_is_public_and_exact(rules: Ruleset) -> None:
    """DEC-22, item 1: capacity by node kind, the same in every view, whatever roads and fog."""
    state = _state("line6", rules)
    state.edges[0].width = 3
    state.edges[4].width = 3  # in fog for player 0
    expected = [40, 30, 30, 30, 30, 40]
    assert [n.capacity for n in _view(state, rules).nodes] == expected
    assert [n.capacity for n in _view(state, rules, 1).nodes] == expected
    state.nodes[5].owner = 0  # player 1 lost its capital: node 4 is cut off
    assert [n.capacity for n in _view(state, rules).nodes] == expected
    assert [city_capacity(state, rules, n) for n in range(6)] == expected


# Overcrowding countdown (ui-style, section 12): own nodes only ---------------------------------
# line6: node 0 (capital of player 0) has capacity 40 (``rules``); attrition_ticks 30,
# grace_ticks 50.


def test_overcrowding_countdown_of_an_own_node(rules: Ruleset) -> None:
    state = _state("line6", rules)
    _add(state, 0, AtNode(0), units=45, charged=0)
    state.nodes[0].over_ticks = 12
    state.tick = 100
    node = _view(state, rules).nodes[0]
    assert (node.attrition_in, node.grace_left) == (30 - 12, None)


def test_overcrowding_countdown_restarts_after_a_death(rules: Ruleset) -> None:
    state = _state("line6", rules)
    _add(state, 0, AtNode(0), units=45, charged=0)
    node = _view(state, rules).nodes[0]  # over, nothing counted yet (the system has not run)
    assert (node.attrition_in, node.grace_left) == (30, None)


def test_overcrowding_grace_after_a_capture_counts_down(rules: Ruleset) -> None:
    state = _state("line6", rules)
    _add(state, 0, AtNode(0), units=45, charged=0)
    state.nodes[0].captured_tick = 90
    state.tick = 100
    node = _view(state, rules).nodes[0]
    assert (node.attrition_in, node.grace_left) == (None, 50 - 10)
    state.tick = 140  # the last tick of the grace is 139: here it is over
    assert (_view(state, rules).nodes[0].attrition_in, _view(state, rules).nodes[0].grace_left) == (
        30,
        None,
    )


def test_no_countdown_while_the_garrison_fits(rules: Ruleset) -> None:
    state = _state("line6", rules)
    _add(state, 0, AtNode(0), units=40, charged=0)
    state.nodes[0].over_ticks = 7  # stale count: the system resets it on the next tick
    node = _view(state, rules).nodes[0]
    assert (node.attrition_in, node.grace_left) == (None, None)


def test_fog_overcrowding_countdown_is_never_shown_for_foreign_nodes(rules: Ruleset) -> None:
    state = _state("line6", rules)
    _add(state, 0, AtNode(0), units=45, charged=0)  # the countdown of player 0's capital
    _add(state, 1, AtNode(0), units=1, charged=0)  # the enemy stands there: exact detail
    _add(state, 0, AtNode(2), units=31, charged=0)  # a neutral node over its capacity (30)
    state.nodes[0].over_ticks = 5
    state.nodes[2].over_ticks = 5
    state.nodes[0].captured_tick = None
    mine = _view(state, rules, 0)
    assert mine.nodes[0].attrition_in is not None
    enemy = _view(state, rules, 1)
    assert enemy.nodes[0].detail is E
    for view in (mine, enemy):
        for n in view.nodes:
            if n.owner != view.player:
                assert (n.attrition_in, n.grace_left) == (None, None)
    # The enemy's own garrison counts for the enemy: node 5 is player 1's capital.
    _add(state, 1, AtNode(5), units=45, charged=0)
    assert _view(state, rules, 1).nodes[5].attrition_in is not None
    assert _view(state, rules, 0).nodes[5].attrition_in is None


def test_dec04_vp_of_both_players_are_public(rules: Ruleset) -> None:
    state = _state("line6", rules)
    state.players[0].vp = 7
    state.players[1].vp = 11
    assert _view(state, rules, 0).vp == (7, 11)
    assert _view(state, rules, 1).vp == (7, 11)


def test_dec04_intents_are_public_without_group_id_or_size(rules: Ruleset) -> None:
    state = _state("line6", rules)
    enemy = _add(state, 1, AtNode(5), units=9, charged=9)
    iid = state.new_id()
    state.intents[iid] = Intent(iid, 1, IntentKind.PLANNED_MOVE, 5, 3, created_tick=0)
    enemy.intent = iid
    bid = state.new_id()
    state.intents[bid] = Intent(bid, 1, IntentKind.DEFENSE, 4, None, created_tick=0)
    view = _view(state, rules)  # nodes 3..5 are in fog for player 0
    assert sorted((i.origin, i.owner, i.kind, i.target or -1) for i in view.intents) == [
        (4, 1, IntentKind.DEFENSE, -1),
        (5, 1, IntentKind.PLANNED_MOVE, 3),
    ]
    fields = {f.name for f in dataclasses.fields(IntentView)}
    assert fields == {"id", "owner", "kind", "origin", "target", "created_tick"}
    assert all(i.id not in (enemy.id, iid, bid) for i in view.intents)


def test_dec04_exact_in_nodes_with_own_groups(rules: Ruleset) -> None:
    """DEC-35: a node with an own group is exact; an own node without one shows its enemies at
    ``PRESENCE`` and its own warehouse exactly (items 1 and 2 of the decision)."""
    state = _state("line6", rules)
    state.nodes[1].warehouse = 5
    state.nodes[3].warehouse = 6
    _add(state, 1, AtNode(1), units=4, charged=1)
    _add(state, 1, AtNode(1), units=2, charged=2, mode=Mode.DEFENSE)
    _add(state, 0, AtNode(3), units=1, charged=1)  # own group makes neutral node 3 exact
    _add(state, 1, AtNode(3), units=7, charged=3)
    view = _view(state, rules)
    one, three = view.nodes[1], view.nodes[3]
    assert (one.detail, one.warehouse, three.detail, three.warehouse) == (P, 5, E, 6)
    assert one.seen is not None and three.seen is not None
    assert (one.seen.enemy_units, one.seen.enemy_charged) == (None, None)
    assert one.seen.enemy_modes == (Mode.ATTACK, Mode.DEFENSE)
    assert (three.seen.enemy_units, three.seen.enemy_charged) == (7, 3)
    _add(state, 0, AtNode(1), units=1, charged=1)  # an own group in 1: exact
    one = _view(state, rules).nodes[1]
    assert (one.detail, one.warehouse) == (E, 5)
    assert one.seen is not None
    assert (one.seen.enemy_units, one.seen.enemy_charged) == (6, 3)


def test_dec21_neighbour_seen_by_terrain_without_its_warehouse(rules: Ruleset) -> None:
    """DEC-21, items 2, 3 and 5 on line6 (all plains): the neighbour 2 of the node 1 with an own
    group is seen exactly, but its warehouse is not (only sources show it); a group on e1 past the
    border point towards 1 is in the half of 1 (a source)."""
    state = _state("line6", rules)
    _add(state, 0, AtNode(1), units=1, charged=1)  # the source (DEC-35)
    state.nodes[2].warehouse = 9
    _add(state, 1, AtNode(2), units=8, charged=8, mode=Mode.DEFENSE)
    _add(state, 1, OnEdge(edge=1, from_node=2, progress=600), units=5, charged=5)
    view = _view(state, rules)
    node, edge = view.nodes[2], view.edges[1]
    assert (node.detail, node.warehouse, edge.detail) == (E, None, P)
    assert node.seen is not None and node.seen.level is E
    assert (node.seen.enemy_modes, node.seen.enemy_units, node.seen.enemy_charged) == (
        (Mode.DEFENSE,),
        8,
        8,
    )
    half1, half2 = edge.halves  # e1: a = 1, b = 2
    assert half1.seen is not None and half2.seen is not None
    assert (half1.detail, half1.seen.enemy_units, half1.seen.enemy_charged) == (E, 5, 5)
    assert (half2.detail, half2.seen.enemy_units, half2.seen.enemy_modes) == (E, 0, ())
    assert [(f.pos, f.toward_b, f.units) for f in edge.enemy_groups] == [(400, False, 5)]
    assert [g.units for g in view.groups] == [1]  # enemy groups are never own entities


def test_dec04_target_of_an_enemy_normal_order_is_not_shown(rules: Ruleset) -> None:
    state = _state("line6", rules)
    enemy = _add(state, 1, AtNode(2))  # presence for player 0
    before = _view(state, rules)
    enemy.order = Order(path=(1, 0), planned=False, depart_tick=0)
    after = _view(state, rules)
    assert after == before
    assert after.intents == ()


def test_dec04_fog_keeps_the_last_sighting(rules: Ruleset) -> None:
    state = _state("line6", rules)
    scout = _add(state, 0, AtNode(3))
    enemy = _add(state, 1, AtNode(4), units=6, charged=4)
    state.tick = 5
    vision(state, rules)  # player 0 sees node 4 (plains from plains: exact) at tick 5
    scout.location = AtNode(1)
    enemy.units, enemy.mode = 20, Mode.DEFENSE
    state.tick = 9
    view = _view(state, rules)
    four, five = view.nodes[4], view.nodes[5]
    assert four.detail is F and four.warehouse is None
    assert four.seen is not None
    assert (four.seen.tick, four.seen.level, four.seen.enemy_modes) == (5, E, (Mode.ATTACK,))
    assert (four.seen.enemy_units, four.seen.enemy_charged) == (6, 4)
    assert five.detail is F and five.seen is None  # never seen


@pytest.mark.parametrize(("where", "scout"), [(1, None), (1, 0)], ids=["presence", "exact"])
def test_dec30_the_gathered_defense_of_the_enemy_is_hidden(
    rules: Ruleset, where: int, scout: int | None
) -> None:
    """DEC-30, item 5: the enemy sees "Defense" as a mode, not what it has gathered; the view of
    player 0 is the same whatever the count of the enemy group. Presence: the own node 1 without
    an own group (DEC-35, detail 3); exact: from the own group in 0."""
    state = _state("line6", rules)
    if scout is not None:
        _add(state, 0, AtNode(scout))
    enemy = _add(state, 1, AtNode(where), units=4, charged=3, mode=Mode.DEFENSE)
    vision(state, rules)
    before = _view(state, rules)
    enemy.ticks_in_defense = 10 * rules.orders.defense_ticks_per_bonus
    assert _view(state, rules) == before
    assert all(g.defense_bonus is None and g.defense_cap is None for g in before.groups)
    seen = before.nodes[where].seen
    assert seen is not None and seen.enemy_modes == (Mode.DEFENSE,)


@pytest.mark.parametrize(
    ("ticks", "charged", "bonus"),
    [(30, 3, 0), (60, 3, 1), (130, 3, 2), (600, 3, 3), (180, 1, 1)],  # DEC-30, rows 1-5
)
def test_dec30_own_group_shows_its_gathered_bonus_and_cap(
    rules: Ruleset, ticks: int, charged: int, bonus: int
) -> None:
    rules = dataclasses.replace(
        rules, orders=dataclasses.replace(rules.orders, defense_ticks_per_bonus=60)
    )
    state = _state("line6", rules)
    g = _add(state, 0, AtNode(1), units=4, charged=charged, mode=Mode.DEFENSE)
    g.ticks_in_defense = ticks
    (view,) = _view(state, rules).groups
    assert (view.defense_bonus, view.defense_cap) == (bonus, charged)
    g.mode, g.ticks_in_defense = Mode.ATTACK, 0
    (view,) = _view(state, rules).groups
    assert (view.defense_bonus, view.defense_cap) == (None, None)


def test_dec04_vision_does_not_depend_on_group_size(rules: Ruleset) -> None:
    small, big = _state("line6", rules), _state("line6", rules)
    _add(small, 0, AtNode(2), units=1, charged=1)
    _add(big, 0, AtNode(2), units=50, charged=50)
    for state in (small, big):
        # DEC-35: 2 is the only source; the own node 0 is not its neighbour: presence.
        assert [n.detail for n in _view(state, rules).nodes] == [P, E, E, E, F, F]


# DEC-35 (#477): a group on an edge is a source in the node of its half -------------------------


def test_own_group_on_an_edge_is_a_source_in_its_half(rules: Ruleset) -> None:
    state = _state("line6", rules)
    _add(state, 0, OnEdge(edge=2, from_node=2, progress=900))  # e2 = 2 - 3, past the border
    view = _view(state, rules)
    # 3 is the source; 2 and 4 plains from plains exact; the own 0 and 1 presence (detail 3).
    assert [n.detail for n in view.nodes] == [P, P, E, E, E, F]
    assert [e.detail for e in view.edges] == [F, F, P, P, F]
    # The halves by the zone levels of their nodes; the own node 1 without a source has none.
    assert [h.detail for h in view.edges[2].halves] == [E, E]
    assert [h.detail for h in view.edges[3].halves] == [E, E]
    assert [h.detail for h in view.edges[1].halves] == [F, E]


def test_enemy_packets_are_never_visible(rules: Ruleset) -> None:
    state = _state("line6", rules)
    state.nodes[2].owner = 1
    state.nodes[3].owner = 1  # e2 is an internal edge of player 1
    _add(state, 0, AtNode(2))  # an own group in node 2 puts e2 in presence
    pid = state.new_id()
    state.packets[pid] = Packet(pid, 1, 2, from_node=3, charges=4, depart_tick=0, arrive_tick=9)
    view = _view(state, rules)
    assert view.edges[2].detail is P
    assert view.packets == ()


# What a view never has (AGENTS.md, section 4.4) ----------------------------------------------


def test_no_enemy_cp_stance_production_or_counters(rules: Ruleset) -> None:
    state = _state("line6", rules)
    before = _view(state, rules)
    enemy = state.players[1]
    enemy.cp, enemy.stance, enemy.charge_acc, enemy.stance_changed_tick = 999, Stance.WAR, 77, 3
    state.nodes[5].warehouse = 42  # enemy capital production piles up in fog
    state.nodes[5].recruit_queue = 2  # the enemy's production is hidden (DEC-25, item 12)
    state.nodes[5].recruit_progress = 17
    assert _view(state, rules) == before
    # Own counters only (DEC-28: the own front markers and rear minimum; #665: the own toggle of
    # the auto-extension, tests/test_dec41_auto.py).
    names = {f.name for f in dataclasses.fields(SelfView)}
    assert names == {"cp", "stance", "fronts", "rear_min", "auto_lines"}
    me = state.players[0]
    assert before.me == SelfView(cp=me.cp, stance=me.stance, fronts=(None, None), rear_min=1)


def test_no_events_in_the_view(rules: Ruleset) -> None:
    state = _state("line6", rules)
    before = _view(state, rules)
    state.events.append(Event(tick=0, kind="fight", data=(("node", 5),)))
    assert _view(state, rules) == before
    assert "events" not in {f.name for f in dataclasses.fields(PlayerView)}


def test_own_entities_are_exact(rules: Ruleset) -> None:
    state = _state("line6", rules)
    g = _add(state, 0, AtNode(1), units=5, charged=3, mode=Mode.DEFENSE)
    w = _add(state, 0, AtNode(0), units=2, charged=1)
    w.order = Order(path=(1, 2), planned=True, depart_tick=30)
    m = _add(state, 0, OnEdge(edge=1, from_node=1, progress=250, back=True), units=1, charged=0)
    pid = state.new_id()
    state.packets[pid] = Packet(pid, 0, 0, from_node=0, charges=2, depart_tick=1, arrive_tick=8)
    view = _view(state, rules)
    by_id = {v.id: v for v in view.groups}
    # "Defense" just switched on: nothing gathered yet, the cap is the charged units (DEC-30).
    assert by_id[opaque_id(KEY, 0, g.id)] == GroupView(
        opaque_id(KEY, 0, g.id), 5, 3, Mode.DEFENSE, AtNode(1), None, 0, 3
    )
    order = by_id[opaque_id(KEY, 0, w.id)].order
    assert order is not None and (order.dest, order.path, order.planned) == (2, (1, 2), True)
    assert order.depart_tick == 30
    assert by_id[opaque_id(KEY, 0, m.id)].location == m.location
    [packet] = view.packets
    assert (packet.id, packet.edge, packet.charges, packet.arrive_tick) == (
        opaque_id(KEY, 0, pid),
        0,
        2,
        8,
    )


def test_dec28_own_front_markers_and_rear_minimum_in_the_view(rules: Ruleset) -> None:
    """DEC-28: the view shows the own markers and rear minimum (``SelfView``)."""
    state = _state("line6", rules)
    state.players[0].fronts = (2, None)
    state.players[0].rear_min = 3
    me = _view(state, rules).me
    assert (me.fronts, me.rear_min) == ((2, None), 3)


def test_dec28_enemy_front_markers_and_rear_minimum_are_hidden(rules: Ruleset) -> None:
    """DEC-28 (fog test of ``SelfView.fronts`` and ``SelfView.rear_min``): the enemy's markers
    and rear minimum are not in the view, even when the marked city is seen exactly."""
    state = _state("line6", rules)
    state.nodes[2].owner = 1  # an enemy city next to an own one
    _add(state, 0, AtNode(2))  # own group in it: exact
    view = _view(state, rules)
    assert view.nodes[2].detail is E
    state.players[1].fronts = (2, 4)
    state.players[1].rear_min = 5
    assert _view(state, rules) == view
    assert _view(state, rules, player=1).me.fronts == (2, 4)


def test_dec19_starve_in_only_for_own_cut_off_cities(rules: Ruleset) -> None:
    """DEC-19, item 8: the countdown of an own cut-off city; never for the enemy's."""
    state = _state("line6", rules)
    state.tick = 150
    state.nodes[1].cut_since = 100  # grace 100: the first consumption at 200
    state.nodes[4].cut_since = 100  # an enemy city, cut off
    for owner, node in ((0, 1), (1, 4)):  # garrisons with charges: something to spend (#253)
        gid = state.new_id()
        state.groups[gid] = Group(gid, owner, 2, 1, Mode.ATTACK, AtNode(node))
    view = _view(state, rules)
    assert view.nodes[1].starve_in == 200 - 150
    assert [n.starve_in for n in view.nodes if n.id != 1] == [None] * 5
    before = _view(state, rules, player=1)
    assert before.nodes[4].starve_in == 50
    assert before.nodes[1].starve_in is None
    state.nodes[1].cut_since = None
    assert _view(state, rules, player=1) == before


def test_dec25_recruit_queue_only_for_own_cities(rules: Ruleset) -> None:
    """DEC-25, item 12: an own city shows its queue, the progress and whether the ready unit
    waits; the enemy's and neutral nodes show ``None``, even in sight."""
    state = _state("line6", rules)
    state.nodes[1].recruit_queue, state.nodes[1].recruit_progress = 2, 7
    state.nodes[4].recruit_queue, state.nodes[4].recruit_progress = 3, 12  # an enemy city
    view = _view(state, rules)
    fields = [(n.recruit_queue, n.recruit_progress, n.recruit_waiting) for n in view.nodes]
    assert fields == [(0, 0, False), (2, 7, False)] + [(None, None, None)] * 4
    state.nodes[1].recruit_progress = rules.recruit.unit_ticks  # ready, no place yet
    assert _view(state, rules).nodes[1].recruit_waiting is True
    before = _view(state, rules, player=1)
    assert before.nodes[4].recruit_queue == 3
    for queue, progress in ((0, 0), (1, 29), (3, 30)):
        state.nodes[1].recruit_queue, state.nodes[1].recruit_progress = queue, progress
        assert _view(state, rules, player=1) == before  # the enemy never sees it


def test_dec25_enemy_recruit_queue_hidden_even_in_sight(rules: Ruleset) -> None:
    state = _state("line6", rules)
    state.nodes[2].owner = 1  # an enemy city next to an own one, with an own group: exact
    _add(state, 0, AtNode(2))
    view = _view(state, rules)
    assert view.nodes[2].detail is E
    assert (view.nodes[2].recruit_queue, view.nodes[2].recruit_progress) == (None, None)
    assert view.nodes[2].recruit_waiting is None
    state.nodes[2].recruit_queue, state.nodes[2].recruit_progress = 2, 30
    assert _view(state, rules) == view


def test_dec19_no_starve_in_when_there_is_nothing_to_spend(rules: Ruleset) -> None:
    """#253 (DEC-19, item 8): an own cut-off city with an empty warehouse and no charged standing
    unit, or with no standing unit at all, has no countdown; charges bring it back."""
    state = _state("line6", rules)
    state.tick = 150
    state.nodes[1].cut_since = 100
    gid = state.new_id()
    state.groups[gid] = Group(gid, 0, 2, 0, Mode.ATTACK, AtNode(1))
    assert _view(state, rules).nodes[1].starve_in is None
    state.nodes[1].warehouse = 1
    assert _view(state, rules).nodes[1].starve_in == 50
    state.nodes[1].warehouse = 0
    state.groups[gid].charged = 1
    assert _view(state, rules).nodes[1].starve_in == 50
    del state.groups[gid]
    state.nodes[1].warehouse = 3
    assert _view(state, rules).nodes[1].starve_in is None


def test_dec18_own_packet_path_and_transfer(rules: Ruleset) -> None:
    state = _state("line6", rules)
    state.nodes[2].owner = 0
    pid = state.new_id()
    state.packets[pid] = Packet(
        pid, 0, 0, 0, 3, 5, 35, route=(1,), route_ticks=(30,), transfer=True
    )
    [packet] = _view(state, rules).packets
    assert (packet.path, packet.dest_tick, packet.transfer) == ((1, 2), 65, True)


def test_dec18_enemy_transfer_is_never_visible(rules: Ruleset) -> None:
    state = _state("line6", rules)
    before = _view(state, rules)
    pid = state.new_id()
    state.packets[pid] = Packet(
        pid, 1, 4, 5, 3, 5, 35, route=(3,), route_ticks=(30,), transfer=True
    )
    assert _view(state, rules) == before


def test_upgrade_gain_only_on_own_internal_edges(rules: Ruleset) -> None:
    state = _state("line6", rules)
    state.edges[0].width = 2
    view0, view1 = _view(state, rules, 0), _view(state, rules, 1)
    speeds, units = rules.supply.fast_speed_pct, rules.road.speed_pct
    amount = rules.supply.amount_by_level
    gain = view0.edges[0].upgrade_gain
    assert gain == UpgradeGain(  # DEC-26, item 7; DEC-28, item 7
        speed_pct=speeds.of(3) - speeds.of(2),
        unit_speed_pct=units.of(3) - units.of(2),
        amount=amount.of(3) - amount.of(2),
    )
    assert [e.upgrade_gain is not None for e in view0.edges] == [True, False, False, False, False]
    assert [e.upgrade_gain is not None for e in view1.edges] == [False, False, False, False, True]
    state.edges[0].width = state.map.edges[0].max_level
    assert _view(state, rules, 0).edges[0].upgrade_gain is None


# Opaque ids and resolve() ---------------------------------------------------------------------


def test_opaque_ids_are_keyed_per_player_and_fit_the_wire(rules: Ruleset) -> None:
    ids = [opaque_id(KEY, 0, i) for i in range(100)]
    assert len(set(ids)) == 100
    assert ids != sorted(ids)  # not sequential
    assert all(0 <= i < 2**63 and WIRE_ID.fullmatch(str(i)) for i in ids)
    assert opaque_id(KEY, 0, 5) != opaque_id(KEY, 1, 5)
    assert opaque_id(KEY, 0, 5) != opaque_id(OTHER_KEY, 0, 5)
    assert opaque_id(KEY, 0, 5) == opaque_id(KEY, 0, 5)


@pytest.mark.parametrize("key", [b"", b"short", bytes(65)])
def test_match_key_must_be_a_real_secret(rules: Ruleset, key: bytes) -> None:
    state = _state("line3", rules)
    with pytest.raises(ValueError, match="match_key"):
        project(state, rules, 0, key)
    with pytest.raises(ValueError, match="match_key"):
        opaque_id(key, 0, 1)


def test_resolve_maps_own_opaque_ids_to_internal_ids(rules: Ruleset) -> None:
    state = _state("line3", rules)
    a = _add(state, 0, AtNode(0))
    b = _add(state, 0, AtNode(0))
    oa, ob = opaque_id(KEY, 0, a.id), opaque_id(KEY, 0, b.id)
    assert resolve(state, 0, Move(oa, 1, True), KEY) == Move(a.id, 1, True)
    assert resolve(state, 0, Merge((ob, oa)), KEY) == Merge((b.id, a.id))
    assert resolve(state, 0, Recruit(0), KEY) == Recruit(0)
    view_ids = {v.id for v in _view(state, rules).groups}
    assert {oa, ob} <= view_ids


def test_resolve_unknown_ids_are_not_found_or_hidden(rules: Ruleset) -> None:
    state = _state("line3", rules)
    own = _add(state, 0, AtNode(0))
    enemy = _add(state, 1, AtNode(1))  # visible to player 0 (presence)
    guesses = [
        own.id,  # an internal id is not an opaque id
        enemy.id,
        opaque_id(KEY, 1, enemy.id),  # the enemy's own opaque id
        opaque_id(OTHER_KEY, 0, own.id),
        12345,
    ]
    for guess in guesses:
        for cmd in (Move(guess, 1), Split(guess, 1), SetMode(guess, Mode.DEFENSE)):
            resolved = resolve(state, 0, cmd, KEY)
            assert validate(state, rules, 0, resolved) == Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
    merge = resolve(state, 0, Merge((opaque_id(KEY, 0, own.id), 1, 2)), KEY)
    assert validate(state, rules, 0, merge) == Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
    repeated = resolve(state, 0, Merge((7, 7)), KEY)
    assert validate(state, rules, 0, repeated) == Reject(RejectCode.INVALID_ARGUMENT)


# Purity and determinism -----------------------------------------------------------------------


def test_project_does_not_change_the_state(rules: Ruleset) -> None:
    state = _state("diamond", rules)
    _add(state, 1, AtNode(1))
    before = state_hash(state)
    _view(state, rules, 0)
    _view(state, rules, 1)
    assert state_hash(state) == before


_HASH_SCRIPT = """
from pathlib import Path
from gow_sim.maps import load_map
from gow_sim.ruleset import load_ruleset
from gow_sim.state import AtNode, Group, Mode, initial_state
from gow_sim.systems.vision import vision
from gow_sim.view import project, view_hash
tests = Path({tests!r})
rules = load_ruleset(tests.parents[2] / "rulesets" / "mvp-0.toml")
state = initial_state(load_map(tests / "maps" / "diamond.json"), rules)
gid = state.new_id()
state.groups[gid] = Group(gid, 1, 4, 2, Mode.DEFENSE, AtNode(1))
vision(state, rules)
print(*(view_hash(project(state, rules, p, bytes(range(32)))) for p in (0, 1)))
"""


def test_view_hash_is_the_same_in_fresh_processes() -> None:
    script = _HASH_SCRIPT.format(tests=str(TESTS_DIR))
    outputs = {
        subprocess.run(
            [sys.executable, "-c", script],
            env={**os.environ, "PYTHONHASHSEED": seed},  # noqa: TID251 (fresh process with PYTHONHASHSEED)
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        for seed in ("0", "12345")
    }
    assert len(outputs) == 1
    assert len(outputs.pop().split()) == 2


# Property: nothing from places the player does not see ----------------------------------------


_SIGHT = {  # DEC-21, item 2, written out by hand: (terrain of the source, of the target)
    ("plains", "plains"): E,
    ("plains", "forest"): R,
    ("plains", "mountains"): P,
    ("forest", "plains"): R,
    ("forest", "forest"): R,
    ("forest", "mountains"): P,
    ("mountains", "plains"): E,
    ("mountains", "forest"): R,
    ("mountains", "mountains"): R,
}
_ORDER = (E, R, P, F)


def _levels(state: GameState, player: int) -> tuple[list[Detail], list[Detail], list[bool]]:
    """DEC-21 levels with the sources of DEC-35, computed independently of ``systems.vision``:
    the levels of the nodes (an own node at least ``PRESENCE``, DEC-35, detail 3), the road level
    visibility of edges (DEC-17) and whether the node's warehouse is shown (own, or an own group
    stands there; DEC-35, detail 2)."""
    mapdef = state.map
    zones = _zones(state, player)
    nodes = [P if z is F and state.nodes[n].owner == player else z for n, z in enumerate(zones)]
    source = _sources(state, player)
    edges = [P if source[e.a] or source[e.b] else F for e in mapdef.edges]
    warehouse = [state.nodes[n].owner == player for n in range(len(mapdef.nodes))]
    for g in state.groups.values():
        if g.owner == player and isinstance(g.location, AtNode):
            warehouse[g.location.node] = True
    return nodes, edges, warehouse


def _sources(state: GameState, player: int) -> list[bool]:
    """DEC-35: a node where an own group stands, or the node of the half of an edge an own group
    is in (the states here have no fights)."""
    source = [False] * len(state.map.nodes)
    for g in state.groups.values():
        if g.owner != player:
            continue
        match g.location:
            case AtNode(node=node):
                source[node] = True
            case OnEdge() as loc:
                source[_half(state, loc)] = True
    return source


def _zones(state: GameState, player: int) -> list[Detail]:
    """The level of each node by the sources and the terrain table (DEC-21, item 2), which is
    also the level of its halves of edges (DEC-33, item 1); own nodes get no level of their own
    here (DEC-35, detail 4)."""
    mapdef = state.map
    source = _sources(state, player)
    zones: list[Detail] = []
    for n in range(len(mapdef.nodes)):
        seen = [F]
        if source[n]:
            seen.append(E)
        for e in mapdef.incident[n]:
            m = mapdef.edges[e].other(n)
            if source[m]:
                seen.append(_SIGHT[mapdef.nodes[m].terrain.value, mapdef.nodes[n].terrain.value])
        zones.append(min(seen, key=_ORDER.index))
    return zones


def _own_internal(state: GameState, player: int, edge: int) -> bool:
    e = state.map.edges[edge]
    return state.nodes[e.a].owner == player and state.nodes[e.b].owner == player


def _half(state: GameState, loc: OnEdge) -> int:
    """The end whose half holds a group (DEC-21, item 5), border point 500."""
    e = state.map.edges[loc.edge]
    pos = loc.progress if loc.from_node == e.a else PROGRESS_SCALE - loc.progress
    to = loc.from_node if loc.back else e.other(loc.from_node)
    if to == e.b:
        return e.b if pos >= 500 else e.a
    return e.a if pos <= 500 else e.b


def _place_level(state: GameState, nodes: list[Detail], zones: list[Detail], g: Group) -> Detail:
    match g.location:
        case AtNode(node=node):
            return nodes[node]
        case OnEdge() as loc:
            return zones[_half(state, loc)]


_MAPS = {name: load_map(TESTS_DIR / "maps" / f"{name}.json") for name in TEST_MAPS}
_RULES = load_ruleset(MVP0)


def _location(draw: st.DrawFn, state: GameState) -> AtNode | OnEdge:
    mapdef = state.map
    if draw(st.booleans()):
        return AtNode(draw(st.integers(0, len(mapdef.nodes) - 1)))
    edge = mapdef.edges[draw(st.integers(0, len(mapdef.edges) - 1))]
    return OnEdge(
        edge=edge.id,
        from_node=draw(st.sampled_from([edge.a, edge.b])),
        progress=draw(st.integers(0, PROGRESS_SCALE)),
        back=draw(st.booleans()),
    )


def _random_group(draw: st.DrawFn, state: GameState, owner: int) -> None:
    units = draw(st.integers(1, 20))
    g = _add(
        state,
        owner,
        _location(draw, state),
        units=units,
        charged=draw(st.integers(0, units)),
        mode=draw(st.sampled_from(list(Mode))),
    )
    if draw(st.booleans()):
        path = draw(st.lists(st.integers(0, len(state.map.nodes) - 1), min_size=1, max_size=3))
        g.order = Order(tuple(path), draw(st.booleans()), draw(st.integers(0, 50)))


def _upgrade(edge: Edge, level: int) -> None:
    """Raise ``edge`` to ``level``."""
    edge.width = level


@st.composite
def _states(draw: st.DrawFn) -> tuple[GameState, int]:
    """A random state on a scenario map, with fog memory from a few earlier ticks."""
    state = initial_state(_MAPS[draw(st.sampled_from(TEST_MAPS))], _RULES)
    for node in state.nodes.values():
        node.owner = draw(st.sampled_from([None, 0, 1]))
        node.warehouse = draw(st.integers(0, 30))
    for edge in state.edges.values():
        static = state.map.edges[edge.id]
        _upgrade(edge, draw(st.integers(ROAD_START_LEVEL, static.max_level)))
    for _ in range(draw(st.integers(0, 3))):  # earlier ticks leave fog memory
        state.groups = {}
        for _ in range(draw(st.integers(0, 6))):
            _random_group(draw, state, draw(st.sampled_from([0, 1])))
        vision(state, _RULES)
        state.tick += draw(st.integers(1, 20))
        for edge in state.edges.values():  # roads are upgraded, never torn down
            level = draw(st.integers(edge.width, state.map.edges[edge.id].max_level))
            _upgrade(edge, level)
    state.groups = {}
    for _ in range(draw(st.integers(0, 8))):
        _random_group(draw, state, draw(st.sampled_from([0, 1])))
    for _ in range(draw(st.integers(0, 4))):
        edge = state.map.edges[draw(st.integers(0, len(state.map.edges) - 1))]
        pid = state.new_id()
        state.packets[pid] = Packet(
            pid, draw(st.sampled_from([0, 1])), edge.id, edge.a, draw(st.integers(1, 5)), 0, 5
        )
    for _ in range(draw(st.integers(0, 4))):
        iid = state.new_id()
        kind = draw(st.sampled_from(list(IntentKind)))
        edge = state.map.edges[draw(st.integers(0, len(state.map.edges) - 1))]
        target = None if kind is IntentKind.DEFENSE else edge.b
        state.intents[iid] = Intent(iid, draw(st.sampled_from([0, 1])), kind, edge.a, target, 0)
    for _ in range(draw(st.integers(0, 3))):  # road builds of cities (DEC-16)
        edge = state.map.edges[draw(st.integers(0, len(state.map.edges) - 1))]
        node = draw(st.sampled_from([edge.a, edge.b]))
        state.nodes[node].build = Build(edge.id, draw(st.sampled_from([0, 1])), 0)
    for node in state.nodes.values():  # DEC-26: the barracks, warehouse levels, city builds
        node.has_barracks = draw(st.booleans())
        node.warehouse_level = draw(st.integers(0, 2))
        if node.build is None and node.owner is not None and draw(st.booleans()):
            # The build system removes a city build whose city changed hands in the same tick.
            kind = draw(st.sampled_from([BuildKind.BARRACKS, BuildKind.WAREHOUSE]))
            node.build = Build(None, node.owner, 0, kind)
    return state, draw(st.sampled_from([0, 1]))


def _hide(data: st.DataObject, state: GameState, player: int) -> None:
    """Change only what ``player`` must not know; the view must stay the same."""
    draw = data.draw
    nodes, edges, warehouse = _levels(state, player)
    zones = _zones(state, player)
    enemy = 1 - player
    for gid in sorted(state.groups):
        g = state.groups[gid]
        if g.owner != enemy:
            continue
        if g.mode is Mode.DEFENSE:  # DEC-30, item 5: what it has gathered is hidden everywhere
            g.ticks_in_defense = draw(st.integers(0, 1000))
        level = _place_level(state, nodes, zones, g)
        g.order = None  # the target of a normal order is never shown (DEC-21, item 6)
        if level is F and draw(st.booleans()):
            del state.groups[gid]  # a group in fog may vanish
        elif level is R:  # the range of the units stays, the charged are hidden
            g.charged = draw(st.integers(0, g.units))
        elif level is not E:  # presence and fog: sizes are hidden
            g.units = g.units + draw(st.integers(0, 5))
            g.charged = draw(st.integers(0, g.units))
    for _ in range(draw(st.integers(0, 3))):  # new enemy groups deep in fog
        fogged = [n for n, level in enumerate(nodes) if level is F]
        if fogged:
            _add(state, enemy, AtNode(draw(st.sampled_from(fogged))), draw(st.integers(1, 9)), 0)
    for n in range(len(nodes)):
        if not warehouse[n]:  # DEC-21, item 3; DEC-35, detail 2: own or where an own group stands
            state.nodes[n].warehouse = draw(st.integers(0, 30))
    for pid in sorted(state.packets):
        if state.packets[pid].owner == enemy:
            state.packets[pid].charges = draw(st.integers(1, 9))
            state.packets[pid].transfer = draw(st.booleans())
    for node in state.nodes.values():  # DEC-19: enemy starvation hidden
        if node.owner == enemy:
            node.cut_since = draw(st.none() | st.integers(0, max(0, state.tick)))
            node.recruit_queue = draw(st.integers(0, 3))  # DEC-25: the enemy's queue is hidden
            node.recruit_progress = draw(st.integers(0, 30))
    other = state.players[enemy]
    other.cp = draw(st.integers(0, 10_000))
    other.stance = draw(st.sampled_from(list(Stance)))
    other.charge_acc = draw(st.integers(0, 99))
    other.fronts = (draw(st.none() | st.integers(0, len(nodes) - 1)), None)  # DEC-28: hidden
    other.rear_min = draw(st.integers(0, 8))
    state.events = [Event(state.tick, "fight", (("node", 0),))]
    state.vision_memory[enemy] = VisionMemory()  # the enemy's fog memory
    # DEC-17: roads in fog may be upgraded further, enemy builds on them may start or stop.
    for e, level in enumerate(edges):
        if level is F and not _own_internal(state, player, e):  # own roads: DEC-35, detail 5
            edge = state.edges[e]
            level = data.draw(st.integers(edge.width, state.map.edges[e].max_level))
            _upgrade(edge, level)
    for node in state.nodes.values():
        b = node.build
        if node.owner == player:  # the builds of an own city are own data, whoever started them
            continue
        if b is not None and b.owner == enemy and b.edge is not None and edges[b.edge] is F:
            if draw(st.booleans()):
                node.build = None
        elif b is not None and b.owner == enemy and b.edge is None and draw(st.booleans()):
            node.build = None  # the barracks and warehouse builds of the enemy: never shown
    for node in state.nodes.values():  # DEC-26, item 10: the enemy's barracks and levels hidden
        if node.owner == enemy:
            if not _borders_own(state, player, node.id):  # DEC-31: seen next to an own node
                node.has_barracks = draw(st.booleans())
            node.warehouse_level = draw(st.integers(0, 2))


def _borders_own(state: GameState, player: int, node: int) -> bool:
    """``node`` is joined by an edge of the map to a node of ``player`` (DEC-31, item 1)."""
    return any(
        node in (e.a, e.b) and player in (state.nodes[e.a].owner, state.nodes[e.b].owner)
        for e in state.map.edges
    )


@given(data=st.data())
def test_property_nothing_leaks_from_places_out_of_sight(data: st.DataObject) -> None:
    state, player = data.draw(_states())
    view = project(state, _RULES, player, KEY)
    nodes, edges, warehouse = _levels(state, player)
    zones = _zones(state, player)

    assert [n.detail for n in view.nodes] == nodes
    assert [e.detail for e in view.edges] == edges
    own = [g for g in state.groups.values() if g.owner == player]
    assert sorted(g.id for g in view.groups) == sorted(opaque_id(KEY, player, g.id) for g in own)
    own_packets = [p.id for p in state.packets.values() if p.owner == player]
    assert sorted(p.id for p in view.packets) == sorted(
        opaque_id(KEY, player, pid) for pid in own_packets
    )
    memory = state.vision_memory[player]
    for n in view.nodes:
        _check_place(n.detail, n.seen, memory.nodes.get(n.id))
        assert (n.warehouse is not None) == warehouse[n.id]
    for e in view.edges:
        edef = state.map.edges[e.id]
        assert [h.detail for h in e.halves] == [zones[edef.a], zones[edef.b]]
        for h, n in zip(e.halves, (edef.a, edef.b), strict=True):
            _check_place(h.detail, h.seen, memory.halves.get((e.id, n)))
    _check_figures(state, player, zones, view)
    # DEC-17, DEC-22: known levels never exceed the true ones and equal them in sight;
    # capacities are exact everywhere.
    for e in view.edges:
        road = state.edges[e.id]
        assert e.width <= road.width
        assert e.detail is F or e.width == road.width
        assert not _own_internal(state, player, e.id) or e.width == road.width  # DEC-35, detail 5
    for n in view.nodes:
        assert n.capacity == city_capacity(state, _RULES, n.id)
    # DEC-26, item 10; DEC-31: the barracks of own cities and of enemy cities next to an own
    # node, whatever the detail; the rest of the enemy city stays hidden.
    for n in view.nodes:
        node = state.nodes[n.id]
        city = state.map.nodes[n.id].kind is not NodeKind.PROVINCE
        enemy_city = city and node.owner == 1 - player
        next_door = enemy_city and _borders_own(state, player, n.id)
        seen = (city and node.owner == player) or next_door
        assert n.has_barracks == (node.has_barracks if seen else None)
        if enemy_city:
            assert (n.warehouse_level, n.warehouse_cap, n.building, n.recruit_queue) == (
                (None,) * 4
            )

    _hide(data, state, player)
    assert project(state, _RULES, player, KEY) == view


def _check_place(detail: Detail, seen: Sighting | None, memory: Sighting | None) -> None:
    if detail is F:
        assert seen == memory
        return
    assert seen is not None and seen.level is detail
    numbers = (seen.enemy_units, seen.enemy_charged)
    if detail is E:
        assert None not in numbers and seen.enemy_range is None
    else:
        assert numbers == (None, None)
    if detail is R:
        assert (seen.enemy_range is None) == (not seen.enemy_modes)
    else:
        assert seen.enemy_range is None


def _check_figures(state: GameState, player: int, zones: list[Detail], view: PlayerView) -> None:
    """DEC-33: every enemy group on a half not in fog and in no fight is a figure, nothing else."""
    expected: list[tuple[int, int, bool, Detail, Mode]] = []
    internal = set(state.groups)
    for g in state.groups.values():
        loc = g.location
        if g.owner == player or g.fight is not None or not isinstance(loc, OnEdge):
            continue
        level = zones[_half(state, loc)]
        if level is F:
            continue
        e = state.map.edges[loc.edge]
        pos = loc.progress if loc.from_node == e.a else PROGRESS_SCALE - loc.progress
        to = loc.from_node if loc.back else e.other(loc.from_node)
        expected.append((loc.edge, pos, to == e.b, level, g.mode))
    shown = [
        (e.id, f.pos, f.toward_b, f.detail, f.mode) for e in view.edges for f in e.enemy_groups
    ]
    assert sorted(shown) == sorted(expected)
    for e in view.edges:
        assert [f.id for f in e.enemy_groups] == sorted(f.id for f in e.enemy_groups)
        for f in e.enemy_groups:
            assert f.id not in internal
            if f.detail is E:
                assert f.units is not None and f.charged is not None and f.units_range is None
            else:
                assert (f.units, f.charged) == (None, None)
                assert (f.units_range is not None) == (f.detail is R)


# DEC-16, item 8 and DEC-17, item 5: road builds of cities ---------------------------------------


def test_dec28_own_build_is_exact(rules: Ruleset) -> None:
    """The road build sits on the edge (DEC-28, item 7; ``EdgeView.build``)."""
    state = _state("line6", rules)
    state.edges[0].build = Build(edge=0, owner=0, since=40)
    view = _view(state, rules)
    done = 40 + rules.build.ticks_per_level
    assert view.edges[0].build == BuildView(done_tick=done)
    assert [e.id for e in view.edges if e.build is not None] == [0]


def test_dec28_enemy_build_in_fog_is_hidden(rules: Ruleset) -> None:
    """Fog test of ``EdgeView.build`` (DEC-17, item 5): not shown and not remembered."""
    state = _state("line6", rules)
    state.edges[4].build = Build(edge=4, owner=1, since=40)  # e4 = 4-5: fog for player 0
    view = _view(state, rules)
    assert view.edges[4].detail is Detail.FOG
    assert all(e.build is None for e in view.edges)
    assert _view(state, rules, player=1).edges[4].build == BuildView(
        done_tick=40 + rules.build.ticks_per_level
    )
    _add(state, 0, AtNode(4), units=1, charged=0)  # seen now ...
    assert _view(state, rules).edges[4].build is not None
    state.groups.clear()  # ... and in fog again: nothing remembered
    assert _view(state, rules).edges[4].build is None


def test_dec28_enemy_build_on_a_seen_edge_shows_no_end_tick(rules: Ruleset) -> None:
    state = _state("line6", rules)
    state.edges[4].build = Build(edge=4, owner=1, since=40)
    _add(state, 0, AtNode(4), units=1, charged=0)  # node 4 exact, so e4 is not in fog
    view = _view(state, rules)
    assert view.edges[4].detail is Detail.PRESENCE
    assert view.edges[4].build == BuildView(done_tick=None)
