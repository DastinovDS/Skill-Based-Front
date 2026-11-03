"""Level roads feed the nodes that can pass supply on: the saddle (DEC-43 item K, #732).

Expected values come from mechanics.md, section 7, block "Automatic supply flow, leaf shift, fixed
warehouses, road fortifications (DEC-43, #697)", item K and its table K1..K6 (computed by hand
there).

K1 to K3 and K5 are on ``narrows`` for player 1 (``node_key(1, n) = 28 - n``): the match-11
situation, tick 2420 of the owner's match 11, after the factory of The Narrows took the charges of
its army. K4 is on ``dec41``, the base of table F (17 and 18 player 1's).
"""

import dataclasses
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

from gow_sim.maps import load_map
from gow_sim.ruleset import load_ruleset
from gow_sim.state import AtNode, Event, GameState, Group, Mode, initial_state
from gow_sim.systems.flow import supply_flow, update_flow

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[2]
RULES = load_ruleset(ROOT / "rulesets" / "mvp-4.toml")
NARROWS = load_map(ROOT / "maps" / "narrows.json")
DEC41 = load_map(TESTS_DIR / "maps" / "dec41.json")

TORCHESTER = 10
NARROWS_CITY, GALE_GAP, TERN_HAVEN, FAR_FORK, BEACONFORD, LOWMOOR = 14, 15, 16, 17, 18, 19
WEIRBROOK, FLINTCROSS, THORNWAY, LARKFIELD, SEDGELEY = 20, 21, 22, 23, 24
ASHBY, FENMERE, BARROW, IRON_HOLD = 25, 26, 27, 28
MATCH11_STOCKS = {
    TERN_HAVEN: 2,
    BEACONFORD: 3,
    LOWMOOR: 3,
    WEIRBROOK: 3,
    FLINTCROSS: 1,
    THORNWAY: 1,
    LARKFIELD: 1,
    SEDGELEY: 3,
    FENMERE: 1,
    BARROW: 3,
    IRON_HOLD: 5,
}

K, A, B, C, D, E, F, G = range(8)
NORTH, SOUTH = 17, 18


def _group(state: GameState, owner: int, node: int, units: int, charged: int) -> Group:
    gid = state.new_id()
    group = Group(gid, owner, units, charged, Mode.ATTACK, AtNode(node))
    state.groups[gid] = group
    return group


def _match11(
    stocks: dict[int, int] = MATCH11_STOCKS, army: bool = True, also: tuple[int, ...] = ()
) -> GameState:
    """The match-11 situation at tick 9 (the next step is the dispatch of tick 10): player 1 owns
    14..28 and ``also``, player 0 the rest; groups 5/5 in Beaconford and Lowmoor, 4/0 in The
    Narrows (``army``); no packets."""
    state = initial_state(NARROWS, RULES)
    for nid, node in state.nodes.items():
        node.owner = 1 if nid >= NARROWS_CITY or nid in also else 0
        node.warehouse = stocks.get(nid, 0)
    state.groups.clear()
    _group(state, 1, BEACONFORD, 5, 5)
    _group(state, 1, LOWMOOR, 5, 5)
    if army:
        _group(state, 1, NARROWS_CITY, 4, 0)
    update_flow(state, RULES)
    state.tick = 9
    return state


def _run(state: GameState, until: int, player: int) -> dict[int, list[tuple[int, int]]]:
    """The flow step of every tick up to ``until``; the sends of ``player`` per tick."""
    sends: dict[int, list[tuple[int, int]]] = {}
    while state.tick < until:
        state.tick += 1
        state.events = []
        sent = _sent(supply_flow(state, RULES), player)
        if sent:
            sends[state.tick] = sent
    return sends


def _sent(events: list[Event], player: int) -> list[tuple[int, int]]:
    return [
        (e.get("from_node"), e.get("to_node"))  # type: ignore[misc]
        for e in events
        if e.kind == "packet_sent" and e.get("player") == player
    ]


def _army(state: GameState, node: int) -> tuple[int, int]:
    groups = [g for g in state.groups.values() if g.location == AtNode(node)]
    return sum(g.units for g in groups), sum(g.charged for g in groups)


# K1 to K3: the match-11 saddle ------------------------------------------------------------------


def test_k1_the_narrows_receives_through_the_saddle() -> None:
    state = _match11()
    sends = _run(state, 99, 1)
    assert sends == {
        10: [(THORNWAY, FAR_FORK)],
        20: [(LARKFIELD, THORNWAY)],
        50: [(FAR_FORK, NARROWS_CITY)],
        60: [(FLINTCROSS, FAR_FORK)],
        70: [(BARROW, FLINTCROSS)],
        80: [(IRON_HOLD, BARROW)],
    }
    assert _army(state, NARROWS_CITY) == (4, 0)
    sends = _run(state, 110, 1)
    assert _army(state, NARROWS_CITY) == (4, 1)  # the first charge lands at 100
    assert sends == {100: [(FAR_FORK, NARROWS_CITY)], 110: [(THORNWAY, FAR_FORK)]}


def test_k2_a_chain_of_two_saddles() -> None:
    state = _match11({BEACONFORD: 3, LOWMOOR: 3, LARKFIELD: 1})
    sends = _run(state, 100, 1)
    assert sends == {
        10: [(LARKFIELD, THORNWAY)],
        60: [(THORNWAY, FAR_FORK)],
        100: [(FAR_FORK, NARROWS_CITY)],
    }


def test_k3_a_saddle_next_to_a_full_leaf_moves_nothing() -> None:
    stocks = dict(MATCH11_STOCKS)
    stocks[NARROWS_CITY] = 3
    state = _match11(stocks, army=False)
    assert _run(state, 100, 1) == {}
    assert state.nodes[THORNWAY].warehouse == 1
    assert state.nodes[FLINTCROSS].warehouse == 1
    assert state.nodes[FAR_FORK].warehouse == 0


# K4: no ping-pong ---------------------------------------------------------------------------------


def test_k4_nothing_goes_away_from_a_hungry_leaf() -> None:
    state = initial_state(DEC41, RULES)
    for n in range(8):
        state.nodes[n].warehouse = 0
    for n in (NORTH, SOUTH):
        state.nodes[n].owner = 1
        state.nodes[n].warehouse = 0
    for n, stock in ((B, 3), (C, 2), (D, 3)):
        state.nodes[n].warehouse = stock
    update_flow(state, RULES)
    state.tick = 9
    assert _run(state, 10, 0) == {10: [(B, C)]}
    assert state.nodes[B].warehouse == 2


# K5: a saddle under a shift -----------------------------------------------------------------------


def test_k5_a_saddle_behind_the_level_at_k_2() -> None:
    stocks = {GALE_GAP: 1, THORNWAY: 1, SEDGELEY: 3, BARROW: 3, FENMERE: 1, IRON_HOLD: 6}
    state = _match11(stocks, army=False, also=(TORCHESTER,))
    state.groups.clear()
    update_flow(state, RULES)
    state.players[1].leaf_shift = 2
    sends = _run(state, 100, 1)
    assert sends == {
        10: [(FENMERE, ASHBY)],
        20: [(IRON_HOLD, FENMERE)],
        50: [(ASHBY, LARKFIELD)],
        60: [(FENMERE, ASHBY)],
        70: [(IRON_HOLD, FENMERE)],
        100: [(ASHBY, LARKFIELD)],
    }
    assert state.players[1].leaf_shift == 2
    assert state.nodes[LARKFIELD].warehouse == 1  # landed at 95
    d = {n: state.nodes[n].flow.d for n in (ASHBY, FENMERE, IRON_HOLD, LARKFIELD)}  # type: ignore[union-attr]
    assert d == {ASHBY: 3, FENMERE: 3, IRON_HOLD: 3, LARKFIELD: 2}


# Properties ---------------------------------------------------------------------------------------

FAST = dataclasses.replace(RULES, supply=dataclasses.replace(RULES.supply, base_speed_pct=100_000))
"""Every packet lands one tick after it leaves (``max(1, ticks * 100 // pct)``), before the next
dispatch, so the room of a node at a dispatch is its warehouse alone."""

OWN1 = tuple(range(15, 29))
"""Player 1's half of ``narrows``; The Narrows (its own mirror) stays neutral, player 0 owns 0..13:
the leaves of player 1 are Far Fork, Beaconford and Lowmoor."""


def _feed(state: GameState, player: int) -> dict[int, int]:
    """Item K2 from its definition: 0 for an own level node with an empty warehouse and no packet
    on the way (the harness below keeps it so), then a BFS backwards to the nodes behind the level
    that send to it (downhill or along a level road)."""
    d: dict[int, int] = {}
    k: dict[int, int] = {}
    for n, node in state.nodes.items():
        if node.owner == player and node.flow is not None and node.flow.d is not None:
            d[n], k[n] = node.flow.d, node.flow.k
    feed = {n: 0 for n in sorted(d) if d[n] == k[n] and state.nodes[n].warehouse == 0}
    queue = sorted(feed)
    for m in queue:  # grows while it is walked: a BFS
        for eid in NARROWS.incident[m]:
            n = NARROWS.edges[eid].other(m)
            if n in d and n not in feed and d[n] > k[n] and d[n] >= d[m]:
                feed[n] = feed[m] + 1
                queue.append(n)
    return feed


@given(
    st.lists(st.integers(0, 6), min_size=len(OWN1), max_size=len(OWN1)),
    st.lists(st.booleans(), min_size=len(OWN1), max_size=len(OWN1)),
    st.integers(0, 2),
)
@settings(max_examples=40, deadline=None)
def test_under_a_stable_demand_no_charge_bounces(
    stocks: list[int], hungry: list[bool], shift: int
) -> None:
    """Item K5: the level nodes are held fixed after every tick, each either empty (hungry) or
    full, so the hungry level nodes never change; packets land before the next dispatch. Over 300
    ticks: no road carries charges both ways in one dispatch; no node behind the level gives to
    a neighbour with a larger feed distance or uphill; a road between two different feed
    distances never carries a charge back (only the gap rule of item A6 between equal ones can
    even out both ways as stock arrives)."""
    state = initial_state(NARROWS, FAST)
    for nid, node in state.nodes.items():
        node.owner = 1 if nid in OWN1 else 0 if nid < NARROWS_CITY else None
        node.warehouse = 0
    state.groups.clear()
    state.players[1].leaf_shift = shift
    update_flow(state, FAST)
    caps = {
        n: 6 if n == IRON_HOLD else 1 if NARROWS.nodes[n].kind == "province" else 3 for n in OWN1
    }
    level: dict[int, int] = {}
    for i, n in enumerate(OWN1):
        flow = state.nodes[n].flow
        assert flow is not None and flow.d is not None
        if flow.d == flow.k:
            level[n] = 0 if hungry[i] else caps[n]
            state.nodes[n].warehouse = level[n]
        else:
            state.nodes[n].warehouse = min(stocks[i], caps[n])
    feed = _feed(state, 1)
    far = len(OWN1) + 1
    d = {n: state.nodes[n].flow.d for n in OWN1}  # type: ignore[union-attr]
    k = state.players[1].leaf_shift
    seen: dict[tuple[int, int], bool] = {}
    while state.tick < 300:
        state.tick += 1
        state.events = []
        sent = _sent(supply_flow(state, FAST), 1)
        for src, dst in sent:
            assert (dst, src) not in sent, f"{src} <-> {dst} in one dispatch"
            fs, fd = feed.get(src, far), feed.get(dst, far)
            if d[src] > k:  # type: ignore[operator]
                assert d[dst] <= d[src], f"{src} -> {dst} uphill"  # type: ignore[operator]
                if d[dst] == d[src]:
                    assert fd <= fs, f"{src} -> {dst} away from a hungry level node"
            if (dst, src) in seen:
                assert fs == fd, f"{src} -> {dst} after {dst} -> {src}"
            seen[(src, dst)] = True
        for n, stock in level.items():
            state.nodes[n].warehouse = stock


@given(
    st.lists(st.integers(0, 6), min_size=len(OWN1), max_size=len(OWN1)),
    st.lists(st.integers(0, 3), min_size=len(OWN1), max_size=len(OWN1)),
    st.integers(0, 3),
)
@settings(max_examples=25, deadline=None)
def test_saddles_are_mirrored_and_conserve_charges(
    stocks: list[int], tired: list[int], shift: int
) -> None:
    """Both players with the mirrored halves of ``narrows`` (The Narrows neutral), random stocks,
    random tired groups (``3/c``) and a random shift: every tick the flow of player 0 is the
    mirror of player 1's, and the charges of each player (warehouses, packets, units) stay
    constant; nothing is produced (no economy step), nothing is spent but by the recharge."""
    mirror = NARROWS.mirror_nodes
    state = initial_state(NARROWS, RULES)
    for nid, node in state.nodes.items():
        node.owner = 1 if nid in OWN1 else 0 if nid < NARROWS_CITY else None
        node.warehouse = 0
    state.groups.clear()
    for i, n in enumerate(OWN1):
        cap = 6 if n == IRON_HOLD else 1 if NARROWS.nodes[n].kind == "province" else 3
        for p, node in ((1, n), (0, mirror[n])):
            state.nodes[node].warehouse = min(stocks[i], cap)
            if tired[i] < 3:
                _group(state, p, node, 3, tired[i])
    for p in (0, 1):
        state.players[p].leaf_shift = shift
    update_flow(state, RULES)
    state.tick = 9

    def total(player: int) -> int:
        stock = sum(n.warehouse for n in state.nodes.values() if n.owner == player)
        moving = sum(pk.charges for pk in state.packets.values() if pk.owner == player)
        units = sum(g.charged for g in state.groups.values() if g.owner == player)
        return stock + moving + units

    start = (total(0), total(1))
    while state.tick < 200:
        state.tick += 1
        state.events = []
        events = supply_flow(state, RULES)
        assert (total(0), total(1)) == start
        assert sorted((mirror[a], mirror[b]) for a, b in _sent(events, 1)) == sorted(
            _sent(events, 0)
        )
        for n in OWN1:
            a, b = state.nodes[n], state.nodes[mirror[n]]
            assert b.warehouse == a.warehouse
            assert a.flow is not None and b.flow is not None
            assert (b.flow.d, b.flow.k, b.flow.idle) == (a.flow.d, a.flow.k, a.flow.idle)
            assert b.flow.next == tuple(mirror[m] for m in a.flow.next)
