"""DEC-21 (#233, #296): vision by terrain and the border point of an edge, example by example.

Expected values are the table of worked examples of DEC-21 (mechanics.md, section 10): own city
M (player 0), enemy city E (player 1), edge M-E with ``a`` = M and the border point 500 unless
said otherwise; in E an enemy group of 4 units, 3 charged, "Attack". The view is player 0's. The
terrain table of item 2 is the ``vision.by_terrain`` of ``mvp-0``; the ranges of item 4 its
``vision.range_starts``. Example 18 is replaced by DEC-33 (``test_dec33.py``, example 4); its road
level part is checked here.
"""

from collections.abc import Callable
from pathlib import Path

import pytest

from gow_sim.maps import MapDef
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.state import (
    AtNode,
    Detail,
    GameState,
    Group,
    Intent,
    IntentKind,
    Mode,
    OnEdge,
    Order,
    Sighting,
    initial_state,
)
from gow_sim.systems import movement as movement_module
from gow_sim.systems import vision as vision_module
from gow_sim.systems.vision import vision
from gow_sim.view import EnemyGroupView, PlayerView, project

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))
E, R, P, F = Detail.EXACT, Detail.RANGE, Detail.PRESENCE, Detail.FOG
M_NODE, E_NODE = 0, 1
ATTACK = (Mode.ATTACK,)

type MakeMap = Callable[..., MapDef]


@pytest.fixture(scope="module")
def rules() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "mvp-0.toml")


def _state(mapdef: MapDef, rules: Ruleset, tick: int = 10) -> GameState:
    state = initial_state(mapdef, rules)
    state.tick = tick
    return state


def _group(
    state: GameState,
    owner: int,
    location: AtNode | OnEdge,
    units: int = 4,
    charged: int = 3,
    mode: Mode = Mode.ATTACK,
) -> Group:
    gid = state.new_id()
    state.groups[gid] = Group(gid, owner, units, charged, mode, location)
    return state.groups[gid]


def _view(state: GameState, rules: Ruleset) -> PlayerView:
    return project(state, rules, 0, KEY)


def _me(make: MakeMap, m: str, e: str) -> MapDef:
    """M - E, ``a`` = M."""
    return make(m + e, [(M_NODE, E_NODE)])


def _seen(view: PlayerView, node: int) -> Sighting | None:
    return view.nodes[node].seen


# Items 1-4: the level of a neighbour by terrain, examples 1-10 -----------------------------------


@pytest.mark.parametrize(
    ("m", "e", "level", "expected"),
    [
        ("p", "p", E, Sighting(10, E, ATTACK, 4, 3)),  # 1
        ("m", "p", E, Sighting(10, E, ATTACK, 4, 3)),  # 2
        ("p", "f", R, Sighting(10, R, ATTACK, None, None, (3, 5))),  # 3: «3-5», no charged
        ("f", "p", R, Sighting(10, R, ATTACK, None, None, (3, 5))),  # 4
        ("m", "m", R, Sighting(10, R, ATTACK, None, None, (3, 5))),  # 5
        ("p", "m", P, Sighting(10, P, ATTACK, None, None)),  # 6: enemy, "Attack", no numbers
        ("f", "m", P, Sighting(10, P, ATTACK, None, None)),  # 7
    ],
    ids=["ex1", "ex2", "ex3", "ex4", "ex5", "ex6", "ex7"],
)
def test_examples_1_to_7_neighbour_by_terrain(
    make_fog_map: MakeMap, rules: Ruleset, m: str, e: str, level: Detail, expected: Sighting
) -> None:
    state = _state(_me(make_fog_map, m, e), rules)
    _group(state, 1, AtNode(E_NODE))
    view = _view(state, rules)
    assert view.nodes[M_NODE].detail is E  # the source: everything exact (item 1)
    assert view.nodes[E_NODE].detail is level
    assert _seen(view, E_NODE) == expected


def test_example_8_both_sources_give_a_range(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """E forest; neighbours own M1 (plains) and own M2 (mountains): both give ``RANGE``."""
    mapdef = make_fog_map("pfm", [(0, 1), (2, 1)], owners={2: 0})
    state = _state(mapdef, rules)
    _group(state, 1, AtNode(E_NODE))
    view = _view(state, rules)
    assert view.nodes[E_NODE].detail is R
    assert _seen(view, E_NODE) == Sighting(10, R, ATTACK, None, None, (3, 5))


def test_example_9_the_best_source_wins(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """E plains; neighbours own M1 (forest, ``RANGE``) and own M2 (mountains, ``EXACT``)."""
    mapdef = make_fog_map("fpm", [(0, 1), (2, 1)], owners={2: 0})
    state = _state(mapdef, rules)
    _group(state, 1, AtNode(E_NODE))
    view = _view(state, rules)
    assert view.nodes[E_NODE].detail is E
    assert _seen(view, E_NODE) == Sighting(10, E, ATTACK, 4, 3)


def test_example_10_not_a_neighbour_of_a_source_is_fog(
    make_fog_map: MakeMap, rules: Ruleset
) -> None:
    """E is not a neighbour of a source: fog with the last sighting (level, values, tick)."""
    mapdef = make_fog_map("ppp", [(0, 2), (2, 1)])  # M - X - E
    state = _state(mapdef, rules, tick=5)
    scout = _group(state, 0, AtNode(2), units=1, charged=1)  # X is a source: E seen exactly
    enemy = _group(state, 1, AtNode(E_NODE))
    vision(state, rules)
    del state.groups[scout.id]
    enemy.units, enemy.charged, enemy.mode = 9, 0, Mode.DEFENSE
    state.tick = 9
    view = _view(state, rules)
    assert view.nodes[E_NODE].detail is F
    assert _seen(view, E_NODE) == Sighting(5, E, ATTACK, 4, 3)


# Item 5: halves of an edge and the border point, examples 11-15 ----------------------------------


@pytest.mark.parametrize(
    ("progress", "half", "expected"),
    [
        (400, E_NODE, Sighting(10, R, ATTACK, None, None, (3, 5))),  # 11: in the half of E
        (500, M_NODE, Sighting(10, E, ATTACK, 4, 3)),  # 12: on the border point: half of M
    ],
    ids=["ex11", "ex12"],
)
def test_examples_11_12_the_half_by_the_border_point(
    make_fog_map: MakeMap, rules: Ruleset, progress: int, half: int, expected: Sighting
) -> None:
    """E forest; a group from E to M has gone ``progress`` of the edge."""
    state = _state(_me(make_fog_map, "p", "f"), rules)
    _group(state, 1, OnEdge(edge=0, from_node=E_NODE, progress=progress))
    view = _view(state, rules)
    halves = {M_NODE: view.edges[0].halves[0], E_NODE: view.edges[0].halves[1]}
    assert halves[half].seen == expected
    other = halves[1 - half].seen
    assert other is not None and other.enemy_modes == ()


@pytest.mark.parametrize(
    ("progress", "exact"),
    [(0, False), (299, False), (300, True), (301, True), (900, True)],
)
def test_example_13_border_point_700_from_m(
    make_fog_map: MakeMap,
    rules: Ruleset,
    monkeypatch: pytest.MonkeyPatch,
    progress: int,
    exact: bool,
) -> None:
    """Border point 700 from M: the half of E until the group from E has gone 300, then exact."""

    def at_700(mapdef: MapDef, edge: int) -> int:
        del mapdef, edge
        return 700

    monkeypatch.setattr(movement_module, "border_permille", at_700)
    monkeypatch.setattr(vision_module, "border_permille", at_700)
    state = _state(_me(make_fog_map, "p", "f"), rules)
    _group(state, 1, OnEdge(edge=0, from_node=E_NODE, progress=progress))
    half_m, half_e = _view(state, rules).edges[0].halves
    if exact:
        assert half_m.seen == Sighting(10, E, ATTACK, 4, 3)
        assert half_e.seen == Sighting(10, R, (), None, None)
    else:
        assert half_m.seen == Sighting(10, E, (), 0, 0)
        assert half_e.seen == Sighting(10, R, ATTACK, None, None, (3, 5))


def test_example_14_a_bounce_belongs_to_the_node_it_returns_to(
    make_fog_map: MakeMap, rules: Ruleset
) -> None:
    """The group bounced off M and goes back to E, now at 400 from M: in the half of M, exact."""
    state = _state(_me(make_fog_map, "p", "f"), rules)
    _group(state, 1, OnEdge(edge=0, from_node=E_NODE, progress=600, back=True))
    half_m, half_e = _view(state, rules).edges[0].halves
    assert half_m.seen == Sighting(10, E, ATTACK, 4, 3)
    assert half_e.seen == Sighting(10, R, (), None, None)


def test_example_15_normal_order_target_is_hidden(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """A group with a normal order leaves E: no target; seen in the half of E by E's level."""
    state = _state(_me(make_fog_map, "p", "f"), rules)
    g = _group(state, 1, OnEdge(edge=0, from_node=E_NODE, progress=100))
    g.order = Order(path=(M_NODE,), planned=False, depart_tick=1)
    view = _view(state, rules)
    assert view.edges[0].halves[1].seen == Sighting(10, R, ATTACK, None, None, (3, 5))
    g.order = None
    assert _view(state, rules) == view  # the order says nothing
    assert view.intents == ()
    fields = set(EnemyGroupView.__dataclass_fields__)
    assert not fields & {"dest", "path", "target", "order"}


# Items 6-7: public intents, examples 16-17 -------------------------------------------------------


def test_example_16_planned_order_is_public(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """E: a planned order E -> M; the intent is seen by everyone, also with E in fog."""
    state = _state(make_fog_map("ppp", [(0, 2), (2, 1)]), rules)  # E in fog for player 0
    iid = state.new_id()
    state.intents[iid] = Intent(iid, 1, IntentKind.PLANNED_MOVE, E_NODE, 2, created_tick=4)
    view = _view(state, rules)
    assert view.nodes[E_NODE].detail is F
    assert [(i.owner, i.kind, i.origin, i.target) for i in view.intents] == [
        (1, IntentKind.PLANNED_MOVE, E_NODE, 2)
    ]


def test_example_17_defense_is_seen_from_presence(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """E in "Defense": the mode is seen on ``PRESENCE`` (plains -> mountains), the intent public."""
    state = _state(_me(make_fog_map, "p", "m"), rules)
    _group(state, 1, AtNode(E_NODE), mode=Mode.DEFENSE)
    iid = state.new_id()
    state.intents[iid] = Intent(iid, 1, IntentKind.DEFENSE, E_NODE, None, created_tick=4)
    view = _view(state, rules)
    assert _seen(view, E_NODE) == Sighting(10, P, (Mode.DEFENSE,), None, None)
    assert [(i.kind, i.origin) for i in view.intents] == [(IntentKind.DEFENSE, E_NODE)]


def test_example_18_road_level_between_two_non_sources_is_the_last_seen(
    make_fog_map: MakeMap, rules: Ruleset
) -> None:
    """Edge E-F, E and F neighbours of M, neither a source: the road level is the last one seen
    (DEC-17); the halves are seen by the levels of E and F (DEC-33, example 4)."""
    mapdef = make_fog_map("pff", [(0, 1), (0, 2), (1, 2)])  # M, E, F; e2 = E - F
    state = _state(mapdef, rules)
    state.vision_memory[0].widths[2] = 2
    state.edges[2].width = 3
    edge = _view(state, rules).edges[2]
    assert (edge.detail, edge.width) == (F, 2)
    assert [h.detail for h in edge.halves] == [R, R]


# Items 3-4: ranges, examples 19-20 ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("units", "shown"),
    [(1, (1, 2)), (2, (1, 2)), (3, (3, 5)), (10, (6, 10)), (25, (21, None))],
)
def test_example_19_ranges(
    make_fog_map: MakeMap, rules: Ruleset, units: int, shown: tuple[int, int | None]
) -> None:
    """In E 1, 2, 3, 10, 25 units on ``RANGE``: «1-2», «1-2», «3-5», «6-10», «21+»."""
    state = _state(_me(make_fog_map, "p", "f"), rules)
    _group(state, 1, AtNode(E_NODE), units=units, charged=0)
    assert _seen(_view(state, rules), E_NODE) == Sighting(10, R, ATTACK, None, None, shown)


def test_example_20_range_of_the_sum(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """Two enemy groups of 2 and 2 units in E on ``RANGE``: «3-5» by the sum."""
    state = _state(_me(make_fog_map, "p", "f"), rules)
    _group(state, 1, AtNode(E_NODE), units=2, charged=2)
    _group(state, 1, AtNode(E_NODE), units=2, charged=0)
    assert _seen(_view(state, rules), E_NODE) == Sighting(10, R, ATTACK, None, None, (3, 5))


def test_no_enemy_on_range_shows_no_range(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """Item 4: 0 units: no enemy, so no range."""
    state = _state(_me(make_fog_map, "p", "f"), rules)
    assert _seen(_view(state, rules), E_NODE) == Sighting(10, R, (), None, None)


# Items 1-3: an own group as a source, the warehouse, examples 21-22 -------------------------------


def test_example_21_own_group_in_a_neutral_node(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """An own group stands in the neutral N (forest); E (plains) is a neighbour of N: N is a
    source, everything exact; E by forest -> plains: «3-5»."""
    mapdef = make_fog_map("mpf", [(0, 2), (2, 1)])  # M - N - E
    state = _state(mapdef, rules)
    state.nodes[2].warehouse = 2
    _group(state, 0, AtNode(2), units=1, charged=1)
    _group(state, 1, AtNode(2), units=2, charged=1)
    _group(state, 1, AtNode(E_NODE))
    view = _view(state, rules)
    n = view.nodes[2]
    assert (n.detail, n.warehouse, n.seen) == (E, 2, Sighting(10, E, ATTACK, 2, 1))
    assert _seen(view, E_NODE) == Sighting(10, R, ATTACK, None, None, (3, 5))


@pytest.mark.parametrize(("m", "e", "level"), [("p", "p", E), ("p", "f", R), ("p", "m", P)])
def test_example_22_the_warehouse_of_e_is_never_seen(
    make_fog_map: MakeMap, rules: Ruleset, m: str, e: str, level: Detail
) -> None:
    state = _state(_me(make_fog_map, m, e), rules)
    state.nodes[E_NODE].warehouse = 5
    state.nodes[M_NODE].warehouse = 3
    view = _view(state, rules)
    assert view.nodes[E_NODE].detail is level
    assert view.nodes[E_NODE].warehouse is None
    assert view.nodes[M_NODE].warehouse == 3  # the own source shows it
    state.nodes[E_NODE].warehouse = 0
    assert _view(state, rules) == view


# Item 8: memory by halves ------------------------------------------------------------------------


def test_item_8_memory_of_a_half(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """The memory keeps the level, the values shown, the modes and the tick of each half; a half
    in fog shows its last sighting."""
    mapdef = make_fog_map("ppf", [(0, 2), (2, 1)])  # M - X - E (forest)
    state = _state(mapdef, rules, tick=5)
    scout = _group(state, 0, AtNode(2), units=1, charged=1)
    _group(state, 1, OnEdge(edge=1, from_node=E_NODE, progress=200))  # e1: a = X, b = E
    vision(state, rules)
    remembered = Sighting(5, R, ATTACK, None, None, (3, 5))
    assert state.vision_memory[0].halves[1, E_NODE] == remembered
    del state.groups[scout.id]
    state.groups.clear()
    state.tick = 8
    half_e = _view(state, rules).edges[1].halves[1]
    assert (half_e.detail, half_e.seen) == (F, remembered)
