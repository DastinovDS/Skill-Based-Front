"""Leaves face the enemy only, the farthest nodes before contact, leaves even out (DEC-43, #724).

Expected values come from mechanics.md, section 7, block "Automatic supply flow, leaf shift, fixed
warehouses, road fortifications (DEC-43, #697)", item A as revised by #724 and #726 and its table
L1..L21 (computed by hand there).

The map is ``dec41`` as it is (unlike the tables F and H, whose base gives the passes 17 and 18 to
player 1): player 0 owns K = 0 (capital), A = 1, B, C, D = 2, 3, 4, E, F, G = 5, 6, 7; M = 8,
17 (North Pass), 18 (South Pass), 19, 20 are neutral provinces; player 1 owns 9..16. Roads K-A,
K-E, A-B, A-D, A-E, B-C, B-F, B-G, D-C, C-M, C-17, D-18, M-13, M-19, M-20, 17-12, 18-13; packet
ticks 20 per 30-tick road, K-E 28, D-C 38; ``node_key(0, n) = n``. Stocks 0 unless a row says so,
no groups but the start garrison of K (2/2), no packets; the dispatch at tick 10. Row L13 is the
replay-9 situation on ``narrows`` (the owner's playtest of 2026-11-03).
"""

from pathlib import Path

from gow_sim.maps import load_map
from gow_sim.match import HEADLESS_MATCH_KEY
from gow_sim.ruleset import load_ruleset
from gow_sim.state import AtNode, Event, FlowIdle, GameState, Group, Mode, OnEdge, initial_state
from gow_sim.systems.flow import supply_flow, update_flow
from gow_sim.view import project

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[2]
RULES = load_ruleset(ROOT / "rulesets" / "mvp-4.toml")
MAP = load_map(TESTS_DIR / "maps" / "dec41.json")
NARROWS = load_map(ROOT / "maps" / "narrows.json")
K, A, B, C, D, E, F, G, M = range(9)
NORTH, SOUTH, HILL_N, HILL_S = 17, 18, 19, 20
OWN = (K, A, B, C, D, E, F, G)


def _state(
    stocks: dict[int, int] | None = None,
    owners: dict[int, int | None] | None = None,
    shift: int = 0,
) -> GameState:
    """The base of the table at tick 9 (the next step is the dispatch of tick 10)."""
    state = initial_state(MAP, RULES)
    for n in OWN:
        state.nodes[n].warehouse = 0
    for n, owner in (owners or {}).items():
        state.nodes[n].owner = owner
        state.nodes[n].warehouse = 0
    for n, stock in (stocks or {}).items():
        state.nodes[n].warehouse = stock
    update_flow(state, RULES)
    state.players[0].leaf_shift = shift
    state.tick = 9
    return state


def _flow(state: GameState, tick: int = 10) -> list[Event]:
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


def _packets(events: list[Event], player: int = 0) -> list[Event]:
    return [e for e in events if e.kind == "packet_sent" and e.get("player") == player]


def _d(state: GameState, player: int = 0) -> dict[int, int | None]:
    result: dict[int, int | None] = {}
    for n in sorted(state.nodes):
        node = state.nodes[n]
        if node.owner == player:
            assert node.flow is not None
            result[n] = node.flow.d
    return result


def _group(state: GameState, node: int, units: int, charged: int, plan: int = 0) -> Group:
    gid = state.new_id()
    group = Group(gid, 0, units, charged, Mode.ATTACK, AtNode(node), plan=plan)
    state.groups[gid] = group
    return group


# Leaves (items A1, A2 as revised) -------------------------------------------------------------


def test_l1_no_contact_the_farthest_nodes_are_the_leaves() -> None:
    state = _state()
    _flow(state)
    assert _d(state) == {K: 3, A: 2, B: 1, C: 0, D: 1, E: 3, F: 0, G: 0}
    assert state.players[0].leaf_shift_max == 3


def test_l2_the_stock_rolls_to_the_farthest_nodes() -> None:
    state = _state({B: 3})
    assert _sent(_flow(state)) == [(B, C), (B, F), (B, G)]
    assert state.nodes[B].warehouse == 0


def test_l3_an_enemy_north_pass_makes_c_the_only_leaf() -> None:
    state = _state(owners={NORTH: 1})
    _flow(state)
    assert _d(state) == {K: 3, A: 2, B: 1, C: 0, D: 1, E: 3, F: 2, G: 2}
    assert state.players[0].leaf_shift_max == 3


def test_l4_an_enemy_south_pass_makes_d_the_only_leaf() -> None:
    state = _state(owners={SOUTH: 1})
    _flow(state)
    assert _d(state) == {K: 2, A: 1, B: 2, C: 1, D: 0, E: 2, F: 3, G: 3}
    assert state.players[0].leaf_shift_max == 2


def test_l5_a_captured_m_touches_the_enemy() -> None:
    state = _state(owners={M: 0})
    _flow(state)
    assert _d(state) == {K: 4, A: 3, B: 2, C: 1, D: 2, E: 4, F: 3, G: 3, M: 0}
    assert state.players[0].leaf_shift_max == 4


# The leaves even out (item A6 as revised) -----------------------------------------------------


def test_l6_neighbouring_leaves_even_out() -> None:
    """Since #735 (item L2) only outward: D (``c`` 2) gives to C (``c`` 3), never back."""
    passes: dict[int, int | None] = {NORTH: 1, SOUTH: 1}
    state = _state({C: 3}, owners=passes)
    assert _sent(_flow(state)) == []
    assert state.nodes[C].warehouse == 3
    assert _sent(_flow(_state({C: 2}, owners=passes))) == []
    assert _sent(_flow(_state({C: 2, D: 1}, owners=passes))) == []
    state = _state({D: 3}, owners=passes)
    assert [_sent(_flow(state, t)) for t in (10, 20, 30)] == [[(D, C)], [(D, C)], []]
    _flow(state, 60)  # landed at 48 and 58 (38 ticks)
    assert (state.nodes[D].warehouse, state.nodes[C].warehouse) == (1, 2)


def test_l7_one_charge_per_road_per_dispatch_until_even() -> None:
    state = _state({K: 6}, owners={A: 1})
    assert [_sent(_flow(state, t)) for t in (10, 20, 30, 40)] == [[(K, E)], [(K, E)], [(K, E)], []]
    _flow(state, 60)  # the three packets have landed (28 ticks each)
    assert (state.nodes[K].warehouse, state.nodes[E].warehouse) == (3, 3)


def test_l8_under_a_shift_the_level_evens_out() -> None:
    passes: dict[int, int | None] = {NORTH: 1, SOUTH: 1}
    state = _state({A: 3}, owners=passes, shift=1)
    assert _sent(_flow(state)) == [(A, B)]
    # since #735 outward by a gap of 1 (item L2), nothing inward
    assert _sent(_flow(_state({A: 2, B: 1}, owners=passes, shift=1))) == [(A, B)]
    assert _sent(_flow(_state({B: 3}, owners=passes, shift=1))) == []


def test_l9_a_level_node_an_army_holds_keeps() -> None:
    passes: dict[int, int | None] = {NORTH: 1, SOUTH: 1}
    state = _state({C: 3}, owners=passes)
    _group(state, C, 2, 2, plan=1)
    assert _sent(_flow(state)) == []
    assert state.nodes[C].warehouse == 3
    flow = state.nodes[C].flow
    assert flow is not None and flow.idle is FlowIdle.LEAF
    tired = _state({C: 3}, owners=passes)
    _group(tired, D, 2, 0)  # a tired army in the receiver does not stop the giver
    assert _sent(_flow(tired)) == [(C, D)]


def test_l10_nothing_goes_back_behind_the_level() -> None:
    state = _state({C: 3, F: 0, B: 0})
    assert _sent(_flow(state)) == []  # C, F, G are the level; B is behind it, C does not touch F, G


# Pockets and the pull (items A4, A10) ---------------------------------------------------------


def test_l11_a_pocket_without_contact_is_all_leaves() -> None:
    owners: dict[int, int | None] = {C: None, 13: None, M: 0, HILL_N: 0, HILL_S: 0}
    state = _state({M: 1}, owners=owners)
    _flow(state)
    assert _d(state) == {K: 3, A: 2, B: 1, D: 3, E: 3, F: 0, G: 0, M: 0, HILL_N: 0, HILL_S: 0}
    view = project(state, RULES, 0, HEADLESS_MATCH_KEY)
    assert [view.nodes[n].flow_pocket for n in (M, HILL_N, HILL_S, K)] == [True, True, True, False]
    flow = state.nodes[M].flow
    assert flow is not None and flow.k == 0
    assert _sent(_flow(state, 20)) == []  # M 1, 19 0: a gap of 1


def test_l12_a_tired_army_still_pulls() -> None:
    state = _state({K: 1})
    _group(state, E, 2, 0)
    events = _flow(state)
    d = _d(state)
    assert (d[E], d[K], d[A]) == (0, 1, 1)
    assert _sent(events) == [(K, E)]
    assert _sent(_flow(_state({K: 1}))) == [(K, A)]


# L13: the replay-9 situation (narrows, tick 500 of the owner's playtest) ----------------------


def _narrows() -> GameState:
    """Player 0 owns 0..6, 8, 9, 10, player 1 owns 14, 17..21, 23..28; the stocks of tick 500 of
    match 9; a group 2/0 in Highmoor (9), a node that touches player 1's Beaconford (18)."""
    state = initial_state(NARROWS, RULES)
    mine = (0, 1, 2, 3, 4, 5, 6, 8, 9, 10)
    theirs = (14, 17, 18, 19, 20, 21, 23, 24, 25, 26, 27, 28)
    stocks = {0: 1, 1: 3, 2: 0, 3: 0, 4: 3, 5: 0, 6: 1, 8: 0, 9: 0, 10: 0}
    for nid, node in state.nodes.items():
        node.owner = 0 if nid in mine else 1 if nid in theirs else None
        node.warehouse = stocks.get(nid, 0)
    state.groups.clear()
    gid = state.new_id()
    state.groups[gid] = Group(gid, 0, 2, 0, Mode.ATTACK, AtNode(9))
    update_flow(state, RULES)
    state.tick = 9
    return state


def test_l13_the_starving_front_node_of_replay_9_gets_a_charge() -> None:
    state = _narrows()
    events = _flow(state)
    assert _d(state) == {0: 3, 1: 2, 2: 2, 3: 2, 4: 2, 5: 1, 6: 1, 8: 1, 9: 0, 10: 0}
    assert _sent(events) == [(6, 9), (1, 2), (4, 8)]


# Option A: a pulling army ahead of the level pulls (item I6) ----------------------------------


def test_l14_an_army_ahead_of_the_level_is_put_on_it() -> None:
    passes: dict[int, int | None] = {NORTH: 1, SOUTH: 1}
    state = _state({A: 3, B: 3, D: 2}, owners=passes, shift=1)
    _group(state, C, 2, 0)
    events = _flow(state)
    d = _d(state)
    assert (d[C], d[D], d[A], d[B]) == (1, 0, 1, 1)
    assert _sent(events) == [(B, C)]
    assert state.nodes[D].warehouse == 2  # ahead, frozen: it does not give to C


def test_l15_a_node_ahead_without_an_army_stays_frozen() -> None:
    passes: dict[int, int | None] = {NORTH: 1, SOUTH: 1}
    state = _state({A: 3, B: 3, D: 2}, owners=passes, shift=1)
    events = _flow(state)
    assert _d(state)[C] == 0
    assert _sent(events) == []
    flow = state.nodes[C].flow
    assert flow is not None and flow.idle is FlowIdle.AHEAD


def test_l16_a_pulling_army_takes_without_the_gap() -> None:
    passes: dict[int, int | None] = {NORTH: 1, SOUTH: 1}
    state = _state({C: 1}, owners=passes)
    _group(state, D, 2, 0)
    assert _sent(_flow(state)) == [(C, D)]


def test_l17_replay_9_with_the_shift_at_1() -> None:
    state = _narrows()
    state.players[0].leaf_shift = 1
    events = _flow(state)
    d = _d(state)
    assert (d[9], d[10], d[5], d[6], d[8], d[0]) == (1, 0, 1, 1, 1, 3)
    # since #735 Brackenway's charge goes outward to Wrenfield (item L2; one order with the army
    # of Highmoor: fill 0 both, node_key 5 < 9, item L3)
    assert _sent(events) == [(6, 5), (1, 2), (4, 8)]
    # 20: Cairn refills Brackenway, Reedwick sends Millbrook its second, Granite Hold refills Cairn
    assert _sent(_flow(state, 20)) == [(1, 6), (4, 8), (0, 1)]
    later = _flow(state, 60)
    assert [(e.tick, e.get("from_node")) for e in _packets(later) if e.get("to_node") == 9] == [
        (60, 5),  # Wrenfield, the level end of Highmoor's path (landed at 54)
        (60, 6),  # Brackenway (landed at 58): Highmoor holds, room alone
    ]
    old = _narrows()  # without the army Highmoor stays frozen ahead of the level
    old.groups.clear()
    old.players[0].leaf_shift = 1
    assert _sent(_flow(old)) == [(6, 5), (1, 2), (4, 8)]  # Brackenway outward as above


# Item I7: a pulling army ahead of the level lifts its path (#726) ------------------------------


def _timeline(
    state: GameState, groups: dict[str, Group], until: int
) -> tuple[dict[int, list[tuple[int, int]]], dict[int, dict[str, int]]]:
    """The sends of every dispatch up to ``until`` and the tick each group's ``charged`` grew."""
    sends: dict[int, list[tuple[int, int]]] = {}
    charged: dict[int, dict[str, int]] = {}
    while state.tick < until:
        before = {name: g.charged for name, g in groups.items()}
        sent = _sent(_flow(state, state.tick + 1))
        if sent:
            sends[state.tick] = sent
        grown = {name: g.charged for name, g in groups.items() if g.charged != before[name]}
        if grown:
            charged[state.tick] = grown
    return sends, charged


def test_l18_an_army_two_roads_ahead_lifts_its_path() -> None:
    passes: dict[int, int | None] = {NORTH: 1, SOUTH: 1}
    state = _state({F: 2, A: 2, D: 2}, owners=passes, shift=2)
    army = _group(state, C, 2, 0)
    sends, charged = _timeline(state, {"C": army}, 60)
    assert sends == {10: [(F, B)], 20: [(F, B)], 30: [(B, C)], 40: [(B, C)]}
    assert charged == {50: {"C": 1}, 60: {"C": 2}}
    assert (state.nodes[A].warehouse, state.nodes[D].warehouse) == (2, 2)  # ahead, on no path
    d = _d(state)  # the army is full: the lift ends at once
    assert (d[C], d[B]) == (0, 1)
    flow = state.nodes[B].flow
    assert flow is not None and flow.idle is FlowIdle.AHEAD


def test_l18_the_field_and_the_army_leaving() -> None:
    passes: dict[int, int | None] = {NORTH: 1, SOUTH: 1}
    state = _state({F: 2, A: 2, D: 2}, owners=passes, shift=2)
    army = _group(state, C, 2, 0)
    _flow(state)
    d = _d(state)
    assert (d[C], d[B], d[A], d[D], d[F], d[G], d[K], d[E]) == (2, 2, 1, 0, 2, 2, 2, 2)
    _flow(state, 35)
    army.location = OnEdge(2, C, 0)  # the group leaves C along B-C
    _flow(state, 36)
    d = _d(state)
    assert (d[C], d[B]) == (0, 1)  # the lift ends in the same tick


def test_i7_an_army_next_to_the_level_lifts_its_node_alone() -> None:
    passes: dict[int, int | None] = {NORTH: 1, SOUTH: 1}
    state = _state({F: 2}, owners=passes, shift=2)
    _group(state, B, 2, 0)  # B is one road ahead: its node alone, item I6 as before
    assert _sent(_flow(state)) == [(F, B)]
    d = _d(state)
    assert (d[B], d[C], d[A]) == (2, 0, 1)


def test_l19_an_army_three_roads_ahead_under_k_3() -> None:
    state = _state({K: 2, E: 1, D: 2}, owners={NORTH: 1}, shift=3)
    army = _group(state, C, 2, 0)
    sends, charged = _timeline(state, {"C": army}, 80)
    assert sends == {
        10: [(K, A)],
        20: [(K, A)],
        30: [(A, B)],
        40: [(A, B)],
        50: [(B, C)],
        60: [(B, C)],
    }
    assert charged == {70: {"C": 1}, 80: {"C": 2}}
    assert (state.nodes[D].warehouse, state.nodes[E].warehouse) == (2, 1)


def test_l19_the_field_of_the_path() -> None:
    state = _state({K: 2, E: 1, D: 2}, owners={NORTH: 1}, shift=3)
    _group(state, C, 2, 0)
    _flow(state)
    d = _d(state)
    assert (d[C], d[B], d[A], d[D], d[F], d[G], d[K], d[E]) == (3, 3, 3, 1, 2, 2, 3, 3)
    view = project(state, RULES, 0, HEADLESS_MATCH_KEY)
    assert view.me.leaf_shift == 3
    assert [view.nodes[n].front_dist for n in (C, B, A, D)] == [3, 3, 3, 1]


def test_l20_two_armies_share_a_path() -> None:
    state = _state({K: 2, E: 1}, owners={NORTH: 1}, shift=3)
    north = _group(state, C, 2, 0)
    south = _group(state, D, 2, 0)
    sends, charged = _timeline(state, {"C": north, "D": south}, 70)
    assert sends == {10: [(K, A)], 20: [(K, A)], 30: [(A, B)], 40: [(A, D)], 50: [(B, C)]}
    assert charged == {60: {"D": 1}, 70: {"C": 1}}


def test_l21_the_nearer_army_first() -> None:
    """Since #735 K's third charge goes outward to E (item L2) and comes back to the path by the
    gap rule between equal capital distances (E and A, ``c`` 1)."""
    state = _state({K: 3, E: 1}, owners={NORTH: 1}, shift=3)
    near = _group(state, B, 2, 0)
    far = _group(state, C, 2, 0)
    sends, charged = _timeline(state, {"B": near, "C": far}, 110)
    assert sends == {
        10: [(K, A), (K, E)],
        20: [(K, A)],
        30: [(A, B)],
        40: [(A, B)],
        50: [(E, A)],
        70: [(A, B)],
        90: [(B, C)],
    }
    assert charged == {50: {"B": 1}, 60: {"B": 2}, 110: {"C": 1}}


def test_i7_the_path_is_mirrored() -> None:
    """Both players with the mirrored position (the map as it is, no contact, ``k = 3``, an army
    in C and in its mirror node): the ties of the path (B or D from C) are broken by ``node_key``,
    so player 1 lifts and sends the mirror of what player 0 does."""
    mirror = MAP.mirror_nodes
    state = _state({K: 2} | {mirror[n]: 0 for n in OWN} | {mirror[K]: 2}, shift=3)
    state.players[1].leaf_shift = 3
    west = _group(state, C, 2, 0)
    gid = state.new_id()
    east = Group(gid, 1, 2, 0, Mode.ATTACK, AtNode(mirror[C]))
    state.groups[gid] = east
    events: list[Event] = []
    while state.tick < 80:
        events += _flow(state, state.tick + 1)
        assert west.charged == east.charged
        for n in OWN:
            a, b = state.nodes[n].flow, state.nodes[mirror[n]].flow
            assert a is not None and b is not None
            assert (b.d, b.k, b.idle) == (a.d, a.k, a.idle)
            assert b.next == tuple(mirror[m] for m in a.next)
    sent_west = _sent(events, 0)
    # since #735 the level end K gives its second charge outward to E (item L2, one per road per
    # dispatch), and E keeps it (A, equal ``c``: the gap rule)
    assert sent_west == [(K, A), (K, E), (A, B), (B, C)]
    assert _sent(events, 1) == [(mirror[a], mirror[b]) for a, b in sent_west]
    assert west.charged == 1
