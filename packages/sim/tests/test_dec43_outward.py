"""The level passes outward along the capital distance, a leaf is a corridor (DEC-43 item L, #735).

Expected values come from mechanics.md, section 7, block "Automatic supply flow, leaf shift, fixed
warehouses, road fortifications (DEC-43, #697)", item L and its table O1..O7 (computed by hand
there).

O1 to O5 are on ``narrows`` for player 0 (``node_key(0, n) = n``): the match-12 front, tick 3600 of
the owner's match 12 (player 0 owns 0..11, The Narrows, Far Fork, Flintcross; player 1 owns 15,
16, 18..20, 22..28; Gullhaven and Windgap neutral). O6 and O7 are on ``dec41``, the base of table F
(17 and 18 player 1's) and L4 (18 only).
"""

from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

from gow_sim.maps import load_map
from gow_sim.ruleset import load_ruleset
from gow_sim.state import AtNode, Event, GameState, Group, Mode, initial_state
from gow_sim.systems.flow import supply_flow, update_flow
from gow_sim.systems.supply import packet_dest

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[2]
RULES = load_ruleset(ROOT / "rulesets" / "mvp-4.toml")
NARROWS = load_map(ROOT / "maps" / "narrows.json")
DEC41 = load_map(TESTS_DIR / "maps" / "dec41.json")

GRANITE, CAIRN, MARLOW, HOLLIN, REEDWICK, WRENFIELD, BRACKENWAY, STONECROSS = range(8)
MILLBROOK, HIGHMOOR, TORCHESTER, MID_FORK, GULLHAVEN = 8, 9, 10, 11, 12
NARROWS_CITY, FAR_FORK, BEACONFORD, FLINTCROSS, SEDGELEY, BARROW = 14, 17, 18, 21, 24, 27
FRONT0 = (*range(12), NARROWS_CITY, FAR_FORK, FLINTCROSS)
"""Player 0's nodes of the match-12 front (tick 3600)."""
FRONT1 = (15, 16, 18, 19, 20, *range(22, 29))

K, A, B, C, D, E, F, G = range(8)
NORTH, SOUTH = 17, 18


def _front(
    stocks: dict[int, int],
    mine: tuple[int, ...] = (),
    theirs: tuple[int, ...] = (),
    shift: int = 0,
) -> GameState:
    """The match-12 front at tick 9 (the next step is the dispatch of tick 10), ``mine`` moved to
    player 0 and ``theirs`` to player 1."""
    state = initial_state(NARROWS, RULES)
    for nid, node in state.nodes.items():
        owner = 0 if nid in FRONT0 else 1 if nid in FRONT1 else None
        if nid in mine:
            owner = 0
        if nid in theirs:
            owner = 1
        node.owner = owner
        node.warehouse = stocks.get(nid, 0)
    state.groups.clear()
    update_flow(state, RULES)
    state.players[0].leaf_shift = shift
    state.tick = 9
    return state


def _group(state: GameState, node: int, units: int, charged: int) -> Group:
    gid = state.new_id()
    group = Group(gid, 0, units, charged, Mode.ATTACK, AtNode(node))
    state.groups[gid] = group
    return group


def _run(state: GameState, until: int, player: int = 0) -> dict[int, list[tuple[int, int]]]:
    """The flow step of every tick up to ``until``; the sends of ``player`` per tick."""
    sends: dict[int, list[tuple[int, int]]] = {}
    while state.tick < until:
        state.tick += 1
        state.events = []
        sent = _sent(supply_flow(state, RULES), player)
        if sent:
            sends[state.tick] = sent
    return sends


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


def _stock(state: GameState, *nodes: int) -> tuple[int, ...]:
    return tuple(state.nodes[n].warehouse for n in nodes)


# O1, O2: the level outward ---------------------------------------------------------------------


def test_o1_a_province_leaf_gives_outward_and_is_refilled() -> None:
    state = _front({NARROWS_CITY: 1, FAR_FORK: 1})
    assert _d(state, HIGHMOOR, TORCHESTER, FAR_FORK, FLINTCROSS) == dict.fromkeys(
        (HIGHMOOR, TORCHESTER, FAR_FORK, FLINTCROSS), 0
    )
    assert _d(state, NARROWS_CITY, MID_FORK, GRANITE) == {NARROWS_CITY: 1, MID_FORK: 2, GRANITE: 3}
    assert _run(state, 70) == {10: [(FAR_FORK, FLINTCROSS)], 20: [(NARROWS_CITY, FAR_FORK)]}
    assert _stock(state, NARROWS_CITY, FAR_FORK, FLINTCROSS) == (0, 1, 1)


def test_o1_nothing_goes_inward() -> None:
    state = _front({FLINTCROSS: 1})
    assert _run(state, 60) == {}
    assert _stock(state, FAR_FORK, FLINTCROSS) == (0, 1)


def test_o2_a_city_gives_outward_while_it_holds_more() -> None:
    state = _front({MILLBROOK: 3}, theirs=(GULLHAVEN,))
    assert _d(state, MILLBROOK, TORCHESTER, REEDWICK, GRANITE) == {
        MILLBROOK: 0,
        TORCHESTER: 0,
        REEDWICK: 1,
        GRANITE: 2,
    }
    sends = _run(state, 64)
    assert sends == {10: [(MILLBROOK, TORCHESTER)], 20: [(MILLBROOK, TORCHESTER)]}
    assert _stock(state, MILLBROOK, TORCHESTER) == (1, 2)
    state = _front({TORCHESTER: 3}, theirs=(GULLHAVEN,))
    assert _run(state, 60) == {}  # inward


# O3: the corridor ------------------------------------------------------------------------------


def test_o3_a_leaf_feeds_the_chain_beyond_through_an_enclave() -> None:
    state = _front({BEACONFORD: 3, FAR_FORK: 1}, mine=(BEACONFORD, SEDGELEY, BARROW))
    sedgeley = _group(state, SEDGELEY, 3, 0)
    barrow = _group(state, BARROW, 3, 0)
    update_flow(state, RULES)
    assert _d(state, BEACONFORD, FAR_FORK, BARROW, SEDGELEY, FLINTCROSS, HIGHMOOR) == {
        BEACONFORD: 0,
        FAR_FORK: 0,
        BARROW: 0,
        SEDGELEY: 0,
        FLINTCROSS: 1,
        HIGHMOOR: 1,
    }
    charged: dict[int, int] = {}
    sends: dict[int, list[tuple[int, int]]] = {}
    while state.tick < 130:
        sends |= _run(state, state.tick + 1)
        if sedgeley.charged not in charged.values():
            charged[state.tick] = sedgeley.charged
    assert sends == {
        10: [(BEACONFORD, FLINTCROSS)],
        60: [(FLINTCROSS, SEDGELEY)],  # a corridor: not back to Beaconford
        70: [(BEACONFORD, FLINTCROSS)],
        120: [(FLINTCROSS, SEDGELEY)],
        130: [(BEACONFORD, FLINTCROSS)],
    }
    assert charged[104] == 1
    assert barrow.charged == 0
    assert _stock(state, BEACONFORD, FAR_FORK) == (0, 1)


def test_o3_the_view_of_a_corridor() -> None:
    """Since #738 (item M9) ``flow_down`` is the next nodes of a node's called charges at the
    plan: Beaconford's charges go to Flintcross on the calls of the armies of Barrow and
    Sedgeley; the empty Flintcross carries nothing yet; with nobody calling nothing is drawn."""
    state = _front({BEACONFORD: 3, FAR_FORK: 1}, mine=(BEACONFORD, SEDGELEY, BARROW))
    _group(state, SEDGELEY, 3, 0)
    _group(state, BARROW, 3, 0)
    update_flow(state, RULES)
    flow = state.nodes[BEACONFORD].flow
    assert flow is not None and flow.down == (FLINTCROSS,) and flow.next == (FLINTCROSS,)
    flow = state.nodes[FLINTCROSS].flow
    assert flow is not None and flow.down == ()
    full = {BEACONFORD: 3, FAR_FORK: 1, BARROW: 3, SEDGELEY: 3, TORCHESTER: 3}
    state = _front(full, mine=(BEACONFORD, SEDGELEY, BARROW))
    for n in (BEACONFORD, FLINTCROSS):
        flow = state.nodes[n].flow
        assert flow is not None and flow.down == ()


def test_o3_no_corridor_without_a_hungry_level_node() -> None:
    """The corridor needs a hungry level node beyond it: with Barrow and Sedgeley full (and their
    armies charged) Flintcross has no feed distance and Beaconford keeps its 3."""
    state = _front(
        {BEACONFORD: 3, FAR_FORK: 1, BARROW: 3, SEDGELEY: 3, TORCHESTER: 3},
        mine=(BEACONFORD, SEDGELEY, BARROW),
    )
    assert _run(state, 60) == {}


# O4: equal distances -----------------------------------------------------------------------------


def test_o4_equal_capital_distances_keep_the_gap_rule() -> None:
    state = _front({BEACONFORD: 3, FAR_FORK: 1}, mine=(BEACONFORD, SEDGELEY))
    assert _d(state, FLINTCROSS, SEDGELEY) == {FLINTCROSS: 0, SEDGELEY: 0}
    assert _run(state, 70) == {
        10: [(BEACONFORD, FLINTCROSS)],
        60: [(FLINTCROSS, SEDGELEY)],
        70: [(BEACONFORD, FLINTCROSS)],
    }
    assert state.nodes[FAR_FORK].warehouse == 1


# O5: under a shift, an enclave in the rear ------------------------------------------------------


def test_o5_under_a_shift_the_level_feeds_an_enclave() -> None:
    state = _front({BRACKENWAY: 1, STONECROSS: 1}, shift=1)
    sends = _run(state, 50)
    d = _d(state, MID_FORK, NARROWS_CITY, FAR_FORK)
    assert d == {MID_FORK: 2, NARROWS_CITY: 1, FAR_FORK: 0}
    # since #738 (item M) the level gives into an enclave only on the call of a node that holds
    # (reading M10): Brackenway evens out to Wrenfield (item L2), Stonecross keeps its 1
    assert sends == {10: [(BRACKENWAY, WRENFIELD)]}
    state = _front({WRENFIELD: 3}, shift=1)
    assert _run(state, 30) == {}  # inward


# O6, O7: no corridor in a dead end, the rear is no enclave (``dec41``) ---------------------------


def _dec41(stocks: dict[int, int], enemy: tuple[int, ...], shift: int = 0) -> GameState:
    state = initial_state(DEC41, RULES)
    for n in range(8):
        state.nodes[n].warehouse = 0
    for n in enemy:
        state.nodes[n].owner = 1
        state.nodes[n].warehouse = 0
    for n, stock in stocks.items():
        state.nodes[n].warehouse = stock
    state.groups.clear()
    update_flow(state, RULES)
    state.players[0].leaf_shift = shift
    state.tick = 9
    return state


def test_o6_a_dead_end_is_no_corridor() -> None:
    state = _dec41({K: 6, A: 3, C: 2, F: 2}, (NORTH, SOUTH), shift=1)
    assert _run(state, 10) == {10: [(A, B), (F, B)]}  # as F12: F's stock goes to B


def test_o7_the_rear_is_no_enclave() -> None:
    state = _dec41({D: 1}, (SOUTH,))
    assert _d(state, D, A, C, B) == {D: 0, A: 1, C: 1, B: 2}
    assert _run(state, 60) == {}
    assert state.nodes[D].warehouse == 1


# Properties ---------------------------------------------------------------------------------------

SITUATIONS: tuple[tuple[tuple[int, ...], tuple[int, ...]], ...] = (
    ((), ()),  # the match-12 front (O1)
    ((), (GULLHAVEN,)),  # O2
    ((BEACONFORD, SEDGELEY, BARROW), ()),  # O3: the enclave Flintcross
    ((BEACONFORD, SEDGELEY), ()),  # O4
)


def _capital_distance(state: GameState, player: int) -> dict[int, int]:
    """Item L1 from its definition: hops from the own capital over own nodes."""
    start = NARROWS.capital(player)
    dist = {start: 0}
    queue = [start]
    for n in queue:  # grows while it is walked: a BFS
        for eid in NARROWS.incident[n]:
            m = NARROWS.edges[eid].other(n)
            if m not in dist and state.nodes[m].owner == player:
                dist[m] = dist[n] + 1
                queue.append(m)
    return dist


def _charges(state: GameState, player: int) -> int:
    stock = sum(n.warehouse for n in state.nodes.values() if n.owner == player)
    return stock + sum(p.charges for p in state.packets.values() if p.owner == player)


@given(
    st.sampled_from(SITUATIONS),
    st.lists(st.integers(0, 6), min_size=len(NARROWS.nodes), max_size=len(NARROWS.nodes)),
    st.integers(0, 2),
)
@settings(max_examples=40, deadline=None)
def test_the_flow_settles_and_never_goes_inward_on_the_level(
    situation: tuple[tuple[int, ...], tuple[int, ...]], stocks: list[int], shift: int
) -> None:
    """Item L7: with nothing produced and nothing spent (no economy step, no groups), random
    stocks and a random shift: the charges are conserved, no road carries charges both ways in
    one dispatch, a level node never gives to a smaller capital distance, and the flow settles
    (no packet after tick 1500 of 2000)."""
    mine, theirs = situation
    caps = {
        n: 6 if node.kind == "capital" else 1 if node.kind == "province" else 3
        for n, node in enumerate(NARROWS.nodes)
    }
    state = _front({n: min(s, caps[n]) for n, s in enumerate(stocks)}, mine, theirs)
    state.players[0].leaf_shift = min(shift, state.players[0].leaf_shift_max)
    update_flow(state, RULES)
    total = _charges(state, 0)
    c = _capital_distance(state, 0)
    last = 0
    while state.tick < 2000:
        state.tick += 1
        state.events = []
        sent = _sent(supply_flow(state, RULES), 0)
        for src, dst in sent:
            assert (dst, src) not in sent, f"{src} <-> {dst} in one dispatch"
            flow = state.nodes[src].flow
            assert flow is not None and flow.d is not None
            if flow.d == flow.k:  # the level: outward or between equal distances only
                assert c[dst] >= c[src], f"{src} -> {dst} inward on the level"
            last = state.tick
        assert _charges(state, 0) == total
        assert all(packet_dest(state, p) in c for p in state.packets.values() if p.owner == 0)
    assert last <= 1500, f"still moving at {last}"
