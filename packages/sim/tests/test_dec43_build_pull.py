"""Unpaid buildings pull supply like a discharged army (DEC-43 item J, #729).

Expected values come from mechanics.md, section 7, block "Automatic supply flow, leaf shift, fixed
warehouses, road fortifications (DEC-43, #697)", item J and its table J1..J8 (computed by hand
there).

The map is ``dec41`` with the base of table F: player 0 owns K = 0 (capital), A = 1, B, C, D =
2, 3, 4, E, F, G = 5, 6, 7; the passes 17 and 18 belong to player 1, so C and D are the leaves
(``d0``: C 0, D 0, A 1, B 1, K, E, F, G 2; ``leaf_shift_max`` 2). Roads K-A, K-E, A-B, A-D, A-E,
B-C, B-F, B-G, D-C, C-M, C-17, D-18; packet ticks 20 per 30-tick road, K-E 28, D-C 38;
``node_key(0, n) = n``. Stocks 0 unless a row says so, no groups but the start garrison of K
(2/2), no packets; the dispatch at tick 10. Every tick runs the flow step and then the ``build``
system, as ``match.SYSTEMS`` does (``build`` runs after ``supply``).
"""

from pathlib import Path

from gow_sim.maps import load_map
from gow_sim.ruleset import load_ruleset
from gow_sim.state import (
    AtNode,
    Build,
    BuildKind,
    Event,
    FactoryBuild,
    GameState,
    Group,
    Mode,
    initial_state,
)
from gow_sim.systems.build import build
from gow_sim.systems.flow import supply_flow, update_flow
from gow_sim.systems.supply import send_packet

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[2]
RULES = load_ruleset(ROOT / "rulesets" / "mvp-4.toml")
MAP = load_map(TESTS_DIR / "maps" / "dec41.json")
K, A, B, C, D, E, F, G, M = range(9)
NORTH, SOUTH = 17, 18
OWN = (K, A, B, C, D, E, F, G)
PASSES: dict[int, int | None] = {NORTH: 1, SOUTH: 1}


def _state(
    stocks: dict[int, int] | None = None,
    owners: dict[int, int | None] | None = None,
    shift: int = 0,
) -> GameState:
    """The base of the table at tick 9 (the next step is the dispatch of tick 10)."""
    state = initial_state(MAP, RULES)
    for n in OWN:
        state.nodes[n].warehouse = 0
    for n, owner in (PASSES | (owners or {})).items():
        state.nodes[n].owner = owner
        state.nodes[n].warehouse = 0
    for n, stock in (stocks or {}).items():
        state.nodes[n].warehouse = stock
    state.players[0].leaf_shift = shift
    update_flow(state, RULES)
    state.tick = 9
    return state


def _factory(state: GameState, node: int, owed: int) -> FactoryBuild:
    b = FactoryBuild(owner=0, since=1, owed=owed)
    state.nodes[node].factory_build = b
    update_flow(state, RULES)
    return b


def _step(state: GameState) -> list[Event]:
    state.tick += 1
    state.events = []
    events = supply_flow(state, RULES)
    events += build(state, RULES)
    return events


def _sent(events: list[Event], player: int = 0) -> list[tuple[int, int]]:
    return [
        (e.get("from_node"), e.get("to_node"))  # type: ignore[misc]
        for e in events
        if e.kind == "packet_sent" and e.get("player") == player
    ]


def _run(state: GameState, until: int) -> tuple[dict[int, list[tuple[int, int]]], list[Event]]:
    """The sends of every tick up to ``until`` and every event."""
    sends: dict[int, list[tuple[int, int]]] = {}
    events: list[Event] = []
    while state.tick < until:
        step = _step(state)
        events += step
        sent = _sent(step)
        if sent:
            sends[state.tick] = sent
    return sends, events


def _paid(events: list[Event]) -> list[tuple[int, int, int, int]]:
    """``(tick, node, warehouse, owed)`` of every ``build_paid``."""
    return [
        (e.tick, e.get("node"), e.get("warehouse"), e.get("owed"))  # type: ignore[misc]
        for e in events
        if e.kind == "build_paid"
    ]


def _d(state: GameState) -> dict[int, int | None]:
    result: dict[int, int | None] = {}
    for n in OWN:
        flow = state.nodes[n].flow
        assert flow is not None
        result[n] = flow.d
    return result


def _group(state: GameState, node: int, units: int, charged: int) -> Group:
    gid = state.new_id()
    group = Group(gid, 0, units, charged, Mode.ATTACK, AtNode(node))
    state.groups[gid] = group
    return group


def _packet(state: GameState, src: int, dst: int, edge: int) -> None:
    send_packet(state, 0, src, (edge,), (20,), 1, transfer=False)
    assert state.map.edges[edge].other(src) == dst


# J1: a rear city with an unpaid factory at k = 0 ----------------------------------------------


def test_j1_a_rear_factory_build_pulls_at_k_0() -> None:
    state = _state({A: 3, B: 3, C: 3, D: 3})
    _factory(state, F, 2)
    assert _d(state) == {K: 2, A: 1, B: 1, C: 0, D: 0, E: 2, F: 0, G: 2}
    sends, events = _run(state, 140)
    assert sends == {10: [(B, F)], 20: [(B, F)], 30: [(A, B)]}
    assert _paid(events) == [(30, F, 1, 1), (40, F, 1, 0)]
    built = [e.tick for e in events if e.kind == "factory_built"]
    assert built == [140]
    assert state.nodes[F].factory == 0
    assert state.nodes[F].warehouse == 0
    assert (state.nodes[A].warehouse, state.nodes[B].warehouse) == (2, 2)


def test_j1_the_pull_ends_after_the_payment() -> None:
    state = _state({A: 3, B: 3, C: 3, D: 3})
    _factory(state, F, 2)
    _run(state, 40)
    assert _d(state)[F] == 0  # the build pays after the flow step of tick 40
    _run(state, 41)
    assert _d(state)[F] == 2


def test_j1_without_the_build_nothing_moves() -> None:
    state = _state({A: 3, B: 3, C: 3, D: 3})
    sends, _ = _run(state, 60)
    assert sends == {}


# J2: k = 2, the path is lifted ----------------------------------------------------------------


def test_j2_a_build_two_roads_ahead_lifts_its_path() -> None:
    state = _state({F: 2, A: 2, D: 2}, shift=2)
    _factory(state, C, 2)
    d = _d(state)  # the field before the dispatch
    assert (d[C], d[B], d[A], d[D], d[F], d[G], d[K], d[E]) == (2, 2, 1, 0, 2, 2, 2, 2)
    sends, events = _run(state, 160)
    assert sends == {10: [(F, B)], 20: [(F, B)], 30: [(B, C)], 40: [(B, C)]}
    assert _paid(events) == [(50, C, 1, 1), (60, C, 1, 0)]
    assert [e.tick for e in events if e.kind == "factory_built"] == [160]
    assert (state.nodes[A].warehouse, state.nodes[D].warehouse) == (2, 2)  # ahead, on no path
    d = _d(state)
    assert (d[C], d[B]) == (0, 1)  # paid: the lift has ended


# J3: a paid build does not pull; a barracks pulls like a factory --------------------------------


def test_j3_a_paid_build_does_not_pull() -> None:
    state = _state({A: 3, B: 3, C: 3, D: 3})
    _factory(state, F, 0)
    sends, _ = _run(state, 30)
    assert sends == {}
    assert _d(state)[F] == 2


def test_j3_a_barracks_owing_one_takes_one() -> None:
    state = _state({A: 3, B: 3, C: 3, D: 3})
    state.nodes[F].build = Build(edge=None, owner=0, since=1, kind=BuildKind.BARRACKS, owed=1)
    update_flow(state, RULES)
    sends, events = _run(state, 30)
    assert sends == {10: [(B, F)]}  # at 20 its want is 1 - 0 - 1 = 0
    assert _paid(events) == [(30, F, 1, 0)]


# J4: a build and a discharged army compete by fill, then node_key -----------------------------


def test_j4_equal_fill_node_key_decides() -> None:
    state = _state({K: 1})
    _group(state, E, 2, 0)
    _factory(state, A, 2)
    d = _d(state)
    assert (d[A], d[E], d[K]) == (0, 0, 1)
    sends, _ = _run(state, 10)
    assert sends == {10: [(K, A)]}


def test_j4_the_emptier_first() -> None:
    state = _state({K: 1})
    _group(state, E, 2, 0)
    _factory(state, A, 2)
    _packet(state, B, A, 1)  # road A-B: A's fill 33 against E's 0
    sends, _ = _run(state, 10)
    assert sends == {10: [(K, E)]}
    state = _state({K: 1})
    _group(state, E, 2, 0)
    _factory(state, A, 2)
    _packet(state, A, E, 5)  # road A-E: E's fill 33 against A's 0
    sends, _ = _run(state, 10)
    assert sends == {10: [(K, A)]}


# J5: a road fortification does not pull ---------------------------------------------------------


def test_j5_a_road_fortification_does_not_pull() -> None:
    state = _state({A: 3, B: 3, C: 3, D: 3})
    state.nodes[F].road_forts[6] = 50  # road B-F, being built
    update_flow(state, RULES)
    sends, _ = _run(state, 30)
    assert sends == {}


# J6: a pocket's build ----------------------------------------------------------------------------


def test_j6_a_pocket_build_pulls_at_k_0() -> None:
    state = _state({B: 2}, owners={A: 1})
    _factory(state, G, 1)
    d = _d(state)
    assert (d[B], d[C], d[D], d[F], d[G]) == (0, 0, 0, 1, 0)
    sends, _ = _run(state, 10)
    assert sends == {10: [(B, C), (B, G)]}
    state = _state({B: 2}, owners={A: 1})
    sends, _ = _run(state, 10)
    assert sends == {10: [(B, C)]}


# J7: an army in the build's node lifts the cap --------------------------------------------------


def test_j7_an_army_there_takes_on_room() -> None:
    state = _state({A: 3, B: 3, C: 3, D: 3})
    _factory(state, F, 1)
    _group(state, F, 2, 0)
    sends, _ = _run(state, 20)
    assert sends == {10: [(B, F)], 20: [(B, F)]}
