"""Pockets measured from the capital, cut-off factories stop, starvation in factory-less pockets
(DEC-43 item H, #719).

Expected values come from mechanics.md, section 7, block "Automatic supply flow, leaf shift, fixed
warehouses, road fortifications (DEC-43, #697)", item H and its table H1..H13 (H14, the lines model,
went with the lines, #894).

The map is ``dec41`` (see ``test_dec43.py``), player 0, ``mvp-4`` (pinned on ``mvp-5``): own K = 0
(capital), A = 1, B, C, D = 2, 3, 4, E, F, G = 5, 6, 7; M = 8 a neutral province (warehouse 1 when
own); 17 and 18 are player 1's, as in the base of table F (#724), so C is always a leaf. Stocks 0
unless a row says so, no groups but the start garrison of K. "A captured in tick ``t``": A is player
1's from the ``movement`` of tick ``t`` on, after the ``economy`` of that tick (``_run`` applies the
change between ``economy`` and ``capacity``); then B, C, D, F, G are a pocket of player 0.
"""

import dataclasses
from collections.abc import Callable
from pathlib import Path

from gow_sim.maps import load_map
from gow_sim.match import HEADLESS_MATCH_KEY
from gow_sim.ruleset import Ruleset, StanceTable, load_ruleset
from gow_sim.state import AtNode, Event, GameState, Group, Mode, OnEdge, initial_state
from gow_sim.systems.capacity import capacity, change_owner
from gow_sim.systems.economy import economy
from gow_sim.systems.flow import starving_nodes, supply_flow, update_flow
from gow_sim.systems.victory import EndReason, outcome
from gow_sim.view import project

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[2]
_MVP5 = load_ruleset(ROOT / "rulesets" / "mvp-5.toml")
_EVERY_100 = StanceTable(economy=100, balance=100, war=100)
RULES = dataclasses.replace(
    _MVP5,
    stances=dataclasses.replace(
        _MVP5.stances, cp_period_ticks=_EVERY_100, capital_period_ticks=_EVERY_100
    ),
)
"""``mvp-5`` with the periods of ``mvp-4`` the tables of DEC-43 were written for: a CP quantum and a
charge of the capital every 100 ticks under every stance (DEC-44)."""
MAP = load_map(TESTS_DIR / "maps" / "dec41.json")
K, A, B, C, D, E, F, G, M = range(9)
ENEMY_PASSES = (17, 18)  # North Pass, South Pass: player 1's in the base of the tables (#724)
OWN = (K, A, B, C, D, E, F, G)
POCKET = (B, C, D, F, G)
CUT = 1000

type Change = Callable[[GameState], list[Event]]


def _state(stocks: dict[int, int] | None = None, rules: Ruleset = RULES) -> GameState:
    """The base of the table at tick 999 (the next step is tick 1000)."""
    state = initial_state(MAP, rules)
    for n in OWN:
        state.nodes[n].warehouse = 0
    for n in ENEMY_PASSES:  # the passes are player 1's (#724: a neutral never makes a leaf)
        state.nodes[n].owner = 1
    for n, stock in (stocks or {}).items():
        state.nodes[n].warehouse = stock
    update_flow(state, rules)
    state.tick = CUT - 1
    for player in state.players.values():  # DEC-44: the local progress of 999 ticks, no change
        player.cp_ticks = player.capital_ticks = (CUT - 1) % 100
    return state


def _group(state: GameState, node: int, units: int, charged: int, owner: int = 0) -> Group:
    gid = state.new_id()
    group = Group(gid, owner, units, charged, Mode.ATTACK, AtNode(node))
    state.groups[gid] = group
    return group


def _owner(node: int, owner: int) -> Change:
    return lambda state: change_owner(state, node, owner)


def _run(
    state: GameState,
    until: int,
    changes: dict[int, list[Change]] | None = None,
    rules: Ruleset = RULES,
) -> list[Event]:
    """The steps up to tick ``until``: ``economy``, the changes of the tick (the captures of its
    ``movement`` and ``combat``), ``capacity``, the supply flow."""
    events: list[Event] = []
    while state.tick < until:
        state.tick += 1
        state.events = []
        events += economy(state, rules)
        for change in (changes or {}).get(state.tick, ()):
            events += change(state)
        events += capacity(state, rules)
        events += supply_flow(state, rules)
    return events


def _cut(*more: tuple[int, Change]) -> dict[int, list[Change]]:
    changes: dict[int, list[Change]] = {CUT: [_owner(A, 1)]}
    for tick, change in more:
        changes.setdefault(tick, []).append(change)
    return changes


def _starved(events: list[Event]) -> list[tuple[int, int, int, int, int]]:
    """``(tick, player, node, warehouse, units)`` of every ``starvation`` event."""
    return [
        (e.tick, e.get("player"), e.get("node"), e.get("warehouse"), e.get("units"))  # type: ignore[misc]
        for e in events
        if e.kind == "starvation"
    ]


def _sends(events: list[Event]) -> list[tuple[int, int, int]]:
    """``(tick, from, to)`` of every ``packet_sent`` of player 0."""
    return [
        (e.tick, e.get("from_node"), e.get("to_node"))  # type: ignore[misc]
        for e in events
        if e.kind == "packet_sent" and e.get("player") == 0
    ]


def _made(events: list[Event], node: int) -> list[int]:
    """Ticks of the production events of the factory in ``node``."""
    return [
        e.tick
        for e in events
        if e.kind in ("charges_produced", "charge_burned") and e.get("node") == node
    ]


def _pocket(state: GameState, player: int = 0) -> dict[int, bool | None]:
    view = project(state, RULES, player, HEADLESS_MATCH_KEY)
    return {n: view.nodes[n].flow_pocket for n in sorted(state.nodes) if state.nodes[n].owner == 0}


# H1: the pocket is measured from the capital ---------------------------------------------------


def test_h1_a_pocket_is_a_component_without_the_capital() -> None:
    expected = {n: n in POCKET for n in (K, B, C, D, E, F, G)}
    for factory in (False, True):
        state = _state()
        if factory:
            state.nodes[C].factory = 0
        _run(state, CUT, _cut())
        assert _pocket(state) == expected
        assert all(state.nodes[n].flow.k == 0 for n in POCKET)  # type: ignore[union-attr]


# H2, H3: a cut-off factory stops, reconnecting restarts it -----------------------------------


def test_h2_a_factory_in_a_pocket_stops() -> None:
    state = _state()
    state.nodes[C].factory = 0
    events = _run(state, 1400, _cut())
    assert _made(events, C) == [1000]  # the capture comes after the economy of tick 1000
    assert state.nodes[C].warehouse == 1
    assert _made(events, K) == [1000, 1100, 1200, 1300, 1400]


def test_h3_reconnecting_restarts_production() -> None:
    state = _state()
    state.nodes[C].factory = 0
    events = _run(state, 1400, _cut((1300, _owner(A, 0))))
    assert _made(events, C) == [1000, 1400]
    made = [e for e in events if e.kind == "charges_produced" and e.get("node") == C]
    # since #738 (item M) C, a leaf with room, calls K and E over A: B passes a charge to C at
    # 1340 and D one at 1370, so C is full by 1400 and the charge spills to D
    assert made[-1].tick == 1400 and made[-1].get("spill") == 1
    assert (1340, B, C) in _sends(events) and (1370, D, C) in _sends(events)


# H4: a pocket with a factory does not starve -------------------------------------------------


def test_h4_a_pocket_with_a_factory_does_not_starve() -> None:
    state = _state({C: 2})
    state.nodes[B].factory = 0
    g = _group(state, C, 3, 3)
    events = _run(state, 1500, _cut())
    assert _starved(events) == []
    # B's factory made 1 at 1000 (before the capture); C gives 1 to D, the emptier leaf (#724)
    assert [(t, a, b) for t, a, b in _sends(events) if a == C] == [(1000, C, D)]
    assert (state.nodes[C].warehouse, g.units, g.charged) == (1, 3, 3)
    assert (state.nodes[B].warehouse, state.nodes[D].warehouse) == (1, 1)
    assert all(state.nodes[n].cut_since is None for n in POCKET)
    assert project(state, RULES, 0, HEADLESS_MATCH_KEY).nodes[C].starve_in is None


# H5..H8: starvation of a factory-less pocket, per node ---------------------------------------


def test_h5_a_factory_less_pocket_starves_by_dec19() -> None:
    state = _state({C: 2})
    g = _group(state, C, 3, 3)
    seen: list[tuple[int, int, int]] = []
    events: list[Event] = []
    for tick in (1100, 1200, 1300, 1400, 1500, 1600):
        events += _run(state, tick, _cut())
        seen.append((state.nodes[C].warehouse, g.units, g.charged))
    # C gives 1 to B at the dispatch of 1000: the leaves of the pocket even out (#724)
    assert [(t, a, b) for t, a, b in _sends(events) if a == C] == [(1000, C, B)]
    # at 1200 the group is short: B gives its 1 back without the gap (item I3), it recharges at 1220
    assert [(t, a, b) for t, a, b in _sends(events) if a == B] == [(1200, B, C)]
    assert seen == [(0, 3, 3), (0, 3, 2), (0, 3, 2), (0, 3, 1), (0, 3, 0), (0, 3, 0)]
    assert _starved(events) == [
        (1100, 0, C, 1, 0),
        (1200, 0, C, 0, 1),
        (1300, 0, C, 0, 1),
        (1400, 0, C, 0, 1),
        (1500, 0, C, 0, 1),
    ]
    assert state.nodes[B].warehouse == 0
    assert all(n in state.groups for n in (g.id,))  # the units live


def test_h6_starve_in_in_the_owners_view_only() -> None:
    state = _state({C: 2})
    _group(state, C, 3, 3)
    _run(state, 1050, _cut())
    own = project(state, RULES, 0, HEADLESS_MATCH_KEY)
    enemy = project(state, RULES, 1, HEADLESS_MATCH_KEY)
    assert own.nodes[C].starve_in == 50
    assert enemy.nodes[C].starve_in is None
    assert own.nodes[F].starve_in is None  # no units

    empty = _state()
    _group(empty, C, 3, 0)
    _run(empty, 1050, _cut())
    assert project(empty, RULES, 0, HEADLESS_MATCH_KEY).nodes[C].starve_in is None


def test_h7_every_node_by_its_own_units() -> None:
    state = _state()
    gc = _group(state, C, 3, 3)
    gd = _group(state, D, 4, 4)
    events = _run(state, 1100, _cut())
    assert (gc.charged, gd.charged) == (2, 2)
    assert {n for _, _, n, _, _ in _starved(events)} == {C, D}


def test_h8_a_province_starves() -> None:
    state = _state()
    state.nodes[M].owner = 0
    state.nodes[M].warehouse = 1
    g = _group(state, M, 2, 2)
    seen: list[tuple[int, int]] = []
    for tick in (1100, 1200, 1300):
        _run(state, tick, _cut())
        seen.append((state.nodes[M].warehouse, g.charged))
    assert seen == [(0, 2), (0, 1), (0, 0)]


# H9..H11: the timer of a node ----------------------------------------------------------------


def test_h9_a_later_joiner_has_its_own_timer() -> None:
    state = _state()
    gc = _group(state, C, 3, 3)
    holder: list[Group] = []

    def take_m(s: GameState) -> list[Event]:
        events = change_owner(s, M, 0)
        holder.append(_group(s, M, 3, 3))
        return events

    changes = _cut((1050, take_m))
    _run(state, 1100, changes)
    assert state.nodes[M].cut_since == 1050
    assert (gc.charged, holder[0].charged) == (2, 3)
    _run(state, 1150, changes)
    assert holder[0].charged == 2


def test_h10_reconnecting_stops_it_and_a_new_cut_restarts_the_grace() -> None:
    state = _state({C: 2})
    _group(state, C, 3, 3)
    changes = _cut((1150, _owner(A, 0)), (1180, _owner(A, 1)))
    events = _run(state, 1160, changes)
    assert state.nodes[C].cut_since is None
    assert project(state, RULES, 0, HEADLESS_MATCH_KEY).nodes[C].starve_in is None
    events += _run(state, 1300, changes)
    assert [t for t, *_ in _starved(events)] == [1100, 1280]
    assert state.nodes[C].warehouse == 0


def test_h11_a_factory_in_the_pocket_resets_the_timer() -> None:
    state = _state()
    g = _group(state, C, 3, 3)

    def factory_in_b(s: GameState) -> list[Event]:
        s.nodes[B].factory = 0  # a build finished in tick 1049
        return []

    events = _run(state, 1049, _cut())
    assert all(state.nodes[n].cut_since == CUT for n in POCKET)
    events += _run(state, 1300, {1050: [factory_in_b]})
    assert all(state.nodes[n].cut_since is None for n in POCKET)
    assert _starved(events) == [] and g.charged == 3
    assert _made(events, B) == []  # cut off: B produces nothing at 1200


# H12, H13: the capturer's pocket, the capital lost -------------------------------------------


def test_h12_the_capturers_pocket_starves_for_the_capturer() -> None:
    state = _state()
    holder: list[Group] = []

    def take_a(s: GameState) -> list[Event]:
        events = change_owner(s, A, 1)
        holder.append(_group(s, A, 3, 3, owner=1))
        return events

    events = _run(state, 1100, {CUT: [take_a]})
    assert state.nodes[A].cut_since == CUT
    assert holder[0].charged == 2
    assert _starved(events) == [(1100, 1, A, 0, 1)]


def test_h13_without_the_capital_every_node_is_in_a_pocket() -> None:
    state = _state()
    state.nodes[C].factory = 0
    events = _run(state, CUT, {CUT: [_owner(K, 1)]})
    assert all(_pocket(state).values())
    assert starving_nodes(state, 0) == []  # the pocket has the factory in C (item H3)
    result = outcome(state, RULES)
    assert result is not None and (result.winner, result.reason) == (1, EndReason.CAPITAL)
    events += _run(state, 1200)
    assert _made(events, C) == [1000]  # before the capture only


# Item H4 details: transit does not count, neutral nodes never starve --------------------------


def test_a_group_in_transit_does_not_count() -> None:
    state = _state()
    g = _group(state, C, 3, 3)
    gid = state.new_id()
    transit = Group(gid, 0, 3, 3, Mode.ATTACK, OnEdge(edge=2, from_node=B, progress=500))
    state.groups[gid] = transit
    _run(state, 1100, _cut())
    assert (g.charged, transit.charged) == (2, 3)  # U = 3 in C: one charge


def test_neutral_nodes_have_no_timer() -> None:
    state = _state()
    _run(state, 1100, _cut())
    neutral = [n for n in state.nodes if state.nodes[n].owner is None]
    assert all(state.nodes[n].cut_since is None for n in neutral)


def test_both_players_pockets_are_mirrored() -> None:
    """Player symmetry (AGENTS.md 4.1, item 6): the mirrored cut of player 1 starves the same."""
    mirror = MAP.mirror_nodes
    state = _state({C: 2})
    state.nodes[18].owner = 0  # the mirror of North Pass held by player 1
    update_flow(state, RULES)
    state.nodes[mirror[C]].warehouse = 2
    g0 = _group(state, C, 3, 3)
    g1 = _group(state, mirror[C], 3, 3, owner=1)
    changes: dict[int, list[Change]] = {CUT: [_owner(A, 1), _owner(mirror[A], 0)]}
    events = _run(state, 1500, changes)
    assert (g0.charged, state.nodes[C].warehouse) == (g1.charged, state.nodes[mirror[C]].warehouse)
    by_player = {p: [(t, w, u) for t, q, _, w, u in _starved(events) if q == p] for p in (0, 1)}
    assert by_player[0] == by_player[1] and len(by_player[0]) == 5  # as H5
    # each also holds the other's A, cut off from everything of its own, and its own pass
    assert starving_nodes(state, 0) == sorted((*POCKET, 18, mirror[A]))
    assert starving_nodes(state, 1) == sorted((*(mirror[n] for n in POCKET), 17, A))
