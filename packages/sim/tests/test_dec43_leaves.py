"""Leaves face the enemy only, the farthest nodes before contact, leaves even out (DEC-43, #724).

Expected values come from mechanics.md, section 7, block "Automatic supply flow, leaf shift, fixed
warehouses, road fortifications (DEC-43, #697)", item A as revised by #724 and its table L1..L13
(computed by hand there).

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
from gow_sim.state import AtNode, Event, FlowIdle, GameState, Group, Mode, initial_state
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
    passes: dict[int, int | None] = {NORTH: 1, SOUTH: 1}
    state = _state({C: 3}, owners=passes)
    assert _sent(_flow(state)) == [(C, D)]
    assert state.nodes[C].warehouse == 2
    assert _sent(_flow(_state({C: 2}, owners=passes))) == [(C, D)]
    assert _sent(_flow(_state({C: 2, D: 1}, owners=passes))) == []  # a gap of 1 never moves


def test_l7_one_charge_per_road_per_dispatch_until_even() -> None:
    state = _state({K: 6}, owners={A: 1})
    assert [_sent(_flow(state, t)) for t in (10, 20, 30, 40)] == [[(K, E)], [(K, E)], [(K, E)], []]
    _flow(state, 60)  # the three packets have landed (28 ticks each)
    assert (state.nodes[K].warehouse, state.nodes[E].warehouse) == (3, 3)


def test_l8_under_a_shift_the_level_evens_out() -> None:
    passes: dict[int, int | None] = {NORTH: 1, SOUTH: 1}
    state = _state({A: 3}, owners=passes, shift=1)
    assert _sent(_flow(state)) == [(A, B)]
    assert _sent(_flow(_state({A: 2, B: 1}, owners=passes, shift=1))) == []


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
