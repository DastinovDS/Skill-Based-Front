"""DEC-35 (#477): vision comes only from units, example by example and detail by detail.

Expected values are the table of worked examples of DEC-35 (mechanics.md, section 10) plus one
test per item of "Details": the map M - X - E - F as in DEC-10, M (node 0) my capital, E (node 1)
the enemy capital, X (node 2) mine, F (node 3) neutral unless said otherwise; M, X, E plains, F
forest; e0 = M-X (``a`` = M), e1 = X-E (``a`` = X), e2 = E-F (``a`` = E), border points 500. The
enemy group is 4 units, 3 charged, "Attack"; my group G is 2 units, 2 charged. The view is
player 0's.
"""

from collections.abc import Callable
from dataclasses import fields
from pathlib import Path

import pytest

from gow_sim.commands import Ok, Reject, RejectCode, UpgradeRoad, validate
from gow_sim.maps import MapDef
from gow_sim.match import SIM_VERSION
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.state import (
    AtNode,
    Build,
    Detail,
    Fight,
    FightMember,
    GameState,
    Group,
    Intent,
    IntentKind,
    Mode,
    OnEdge,
    Order,
    Packet,
    Sighting,
    initial_state,
)
from gow_sim.systems.vision import compute_vision, is_visible, vision
from gow_sim.view import BuildView, EnemyGroupView, PlayerView, project

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))
E, R, P, F = Detail.EXACT, Detail.RANGE, Detail.PRESENCE, Detail.FOG
M_NODE, E_NODE, X_NODE, F_NODE = 0, 1, 2, 3
E0, E1, E2 = 0, 1, 2
TICK = 10
ATTACK = (Mode.ATTACK,)

type MakeMap = Callable[..., MapDef]

_RULES = load_ruleset(ROOT / "rulesets" / "mvp-0.toml")


@pytest.fixture(scope="module")
def rules() -> Ruleset:
    return _RULES


def _state(make: MakeMap, owners: dict[int, int] | None = None) -> GameState:
    """M - X - E - F, X mine; no groups."""
    mapdef = make(
        "pppf",
        [(M_NODE, X_NODE), (X_NODE, E_NODE), (E_NODE, F_NODE)],
        {X_NODE: 0, **(owners or {})},
    )
    state = initial_state(mapdef, _RULES)
    state.tick = TICK
    return state


def _group(
    state: GameState, owner: int, location: AtNode | OnEdge, units: int = 4, charged: int = 3
) -> Group:
    gid = state.new_id()
    state.groups[gid] = Group(gid, owner, units, charged, Mode.ATTACK, location)
    return state.groups[gid]


def _g(state: GameState, location: AtNode | OnEdge) -> Group:
    """My group G."""
    return _group(state, 0, location, units=2, charged=2)


def _view(state: GameState, player: int = 0) -> PlayerView:
    return project(state, _RULES, player, KEY)


def _details(view: PlayerView) -> list[Detail]:
    return [n.detail for n in view.nodes]


def _sources(state: GameState, player: int = 0) -> list[int]:
    return [n for n, s in enumerate(compute_vision(state, _RULES, player).sources) if s]


def _shown(f: EnemyGroupView) -> tuple[object, ...]:
    return (f.pos, f.toward_b, f.detail, f.mode, f.units, f.charged, f.units_range)


def _empty(level: Detail) -> Sighting:
    numbers = (0, 0) if level is E else (None, None)
    return Sighting(TICK, level, (), *numbers)


def _fight(
    state: GameState,
    mine: Group,
    enemy: Group,
    *,
    node: int | None = None,
    edge: int | None = None,
    point: int | None = None,
) -> int:
    fid = state.new_id()
    state.fights[fid] = Fight(
        fid,
        node=node,
        edge=edge,
        point=point,
        attacker=None,
        start=9,
        next_round=29,
        virtual=(0, 0),
        mute=(0, 0),
        shots=(0, 0),
        losses=(0, 0),
        members={
            mine.id: FightMember(0, mine.units, mine.charged),
            enemy.id: FightMember(1, enemy.units, enemy.charged),
        },
    )
    mine.fight = enemy.fight = fid
    return fid


# The worked examples ---------------------------------------------------------------------------


def test_example_1_no_groups_an_enemy_in_my_x(make_fog_map: MakeMap, rules: Ruleset) -> None:
    state = _state(make_fog_map)
    state.nodes[X_NODE].warehouse = 7
    state.nodes[X_NODE].recruit_queue = 2
    enemy = _group(state, 1, AtNode(X_NODE))
    view = _view(state)
    x = view.nodes[X_NODE]
    assert (x.detail, x.seen) == (P, Sighting(TICK, P, ATTACK, None, None))
    assert (x.warehouse, x.recruit_queue) == (7, 2)  # own data, exact
    assert is_visible(state, rules, 0, enemy)
    assert _details(view) == [P, F, P, F]  # M and X own (presence), E and F fog
    assert view.nodes[M_NODE].seen == _empty(P)
    assert [e.detail for e in view.edges] == [F, F, F]
    assert all(h.detail is F for e in view.edges for h in e.halves)
    assert _sources(state) == []


def test_example_2_my_group_in_m(make_fog_map: MakeMap) -> None:
    state = _state(make_fog_map)
    _group(state, 1, AtNode(X_NODE))
    _g(state, AtNode(M_NODE))
    view = _view(state)
    assert _sources(state) == [M_NODE]
    x = view.nodes[X_NODE]
    assert (x.detail, x.seen) == (E, Sighting(TICK, E, ATTACK, 4, 3))  # best of E and own P


def test_example_3_an_enemy_on_the_way_to_my_m_is_not_seen(
    make_fog_map: MakeMap, rules: Ruleset
) -> None:
    state = _state(make_fog_map)
    state.edges[E0].width = 2
    enemy = _group(state, 1, OnEdge(E0, X_NODE, 300))  # pos 700, toward M (``a``)
    view = _view(state)
    edge = view.edges[E0]
    assert edge.enemy_groups == ()
    assert [h.detail for h in edge.halves] == [F, F]  # own nodes give no zone (detail 4)
    assert not is_visible(state, rules, 0, enemy)
    assert (edge.detail, edge.width) == (F, 2)  # the road level of e0 is exact (detail 5)
    assert view.nodes[M_NODE].seen == _empty(P)
    enemy.location = AtNode(M_NODE)  # it arrives in M
    m = _view(state).nodes[M_NODE]
    assert (m.detail, m.seen) == (P, Sighting(TICK, P, ATTACK, None, None))


def test_example_4_g_on_e1_before_the_border(make_fog_map: MakeMap) -> None:
    state = _state(make_fog_map)
    state.nodes[E_NODE].warehouse = 9
    state.edges[E1].width = 2
    _g(state, OnEdge(E1, X_NODE, 300))  # pos 300 from X toward E: the half of X
    _group(state, 1, AtNode(E_NODE))
    view = _view(state)
    assert _sources(state) == [X_NODE]
    assert _details(view) == [E, E, E, F]  # M and E plains from plains; F not a neighbour of X
    e = view.nodes[E_NODE]
    assert (e.seen, e.warehouse) == (Sighting(TICK, E, ATTACK, 4, 3), None)  # detail 2
    assert (view.edges[E1].detail, view.edges[E1].width) == (P, 2)


def test_example_5_g_at_the_border_heading_to_e(make_fog_map: MakeMap) -> None:
    state = _state(make_fog_map)
    state.nodes[E_NODE].warehouse = 9
    _g(state, OnEdge(E1, X_NODE, 500))
    _group(state, 1, AtNode(E_NODE))
    view = _view(state)
    assert _sources(state) == [E_NODE]
    assert _details(view) == [P, E, E, R]  # M own without a source: presence
    e = view.nodes[E_NODE]
    assert (e.seen, e.warehouse) == (Sighting(TICK, E, ATTACK, 4, 3), None)
    assert view.edges[E2].detail is P


@pytest.mark.parametrize(("progress", "source"), [(600, E_NODE), (500, X_NODE)])
def test_example_6_a_bounced_group_by_its_position(
    make_fog_map: MakeMap, progress: int, source: int
) -> None:
    """Going back to X: at ``pos`` 600 still in the half of E; at 500 in the half of X."""
    state = _state(make_fog_map)
    _g(state, OnEdge(E1, X_NODE, progress, back=True))
    assert _sources(state) == [source]


def test_example_7_an_enemy_in_the_half_of_e(make_fog_map: MakeMap) -> None:
    state = _state(make_fog_map)
    _g(state, OnEdge(E1, X_NODE, 300))  # X a source
    _group(state, 1, OnEdge(E1, E_NODE, 200))  # pos 800, toward X (``a``)
    edge = _view(state).edges[E1]
    assert [h.detail for h in edge.halves] == [E, E]
    (figure,) = edge.enemy_groups
    assert _shown(figure) == (800, False, E, Mode.ATTACK, 4, 3, None)


def test_example_8_g_on_e2_in_the_half_of_e(make_fog_map: MakeMap) -> None:
    state = _state(make_fog_map)
    _g(state, OnEdge(E2, E_NODE, 300))
    _group(state, 1, AtNode(F_NODE))
    _group(state, 1, AtNode(E_NODE), units=5, charged=1)
    view = _view(state)
    assert _sources(state) == [E_NODE]
    assert view.nodes[E_NODE].seen == Sighting(TICK, E, ATTACK, 5, 1)
    f = view.nodes[F_NODE]
    assert (f.detail, f.seen) == (R, Sighting(TICK, R, ATTACK, None, None, (3, 5)))
    assert view.edges[E1].halves[1].detail is E  # the half of E on e1
    assert view.edges[E2].halves[0].detail is E  # the half of E on e2


@pytest.mark.parametrize(("point", "source"), [(600, E_NODE), (1100, F_NODE)])
def test_example_9_g_in_a_fight_on_e2(make_fog_map: MakeMap, point: int, source: int) -> None:
    """The fight shows its enemy exactly; G is a source in the half of the fight point (detail 6),
    not of its own position: at 300 with the point at 550 it is a source in F."""
    state = _state(make_fog_map)
    g = _g(state, OnEdge(E2, E_NODE, 300))
    enemy = _group(state, 1, OnEdge(E2, F_NODE, 700))
    _fight(state, g, enemy, edge=E2, point=point)
    view = _view(state)
    (fight,) = view.fights
    assert (fight.edge, fight.enemy_units, fight.enemy_charged) == (E2, 4, 3)
    assert view.edges[E2].enemy_groups == ()  # the fight shows it (DEC-33, detail 6)
    assert _sources(state) == [source]


def test_example_10_the_node_g_left_was_captured(make_fog_map: MakeMap) -> None:
    state = _state(make_fog_map, owners={F_NODE: 1})  # F was mine, now the enemy's
    _g(state, OnEdge(E2, F_NODE, 300))  # pos 700 toward E: the half of F
    view = _view(state)
    assert _sources(state) == [F_NODE]
    assert view.nodes[F_NODE].detail is E
    assert view.nodes[E_NODE].detail is R  # plains from forest


def test_example_11_an_enemy_build_on_e2(make_fog_map: MakeMap) -> None:
    state = _state(make_fog_map, owners={F_NODE: 1})  # e2 internal for the enemy
    state.edges[E2].build = Build(edge=E2, owner=1, since=0)
    assert _view(state).edges[E2].build is None  # in fog
    _g(state, OnEdge(E1, X_NODE, 500))  # E a source
    edge = _view(state).edges[E2]
    assert (edge.detail, edge.build) == (P, BuildView(done_tick=None))


def test_example_12_enemy_barracks_next_to_my_x(make_fog_map: MakeMap) -> None:
    state = _state(make_fog_map)
    state.nodes[E_NODE].has_barracks = True
    view = _view(state)
    assert view.nodes[E_NODE].detail is F
    assert view.nodes[E_NODE].has_barracks is True  # DEC-31: by ownership and the graph


def test_example_13_upgrade_road_on_an_own_edge_in_fog(
    make_fog_map: MakeMap, rules: Ruleset
) -> None:
    state = _state(make_fog_map)
    state.players[0].cp = 500
    assert _view(state).edges[E0].detail is F
    assert isinstance(validate(state, rules, 0, UpgradeRoad(E0)), Ok)


def test_example_14_a_scheduled_order_is_public(make_fog_map: MakeMap) -> None:
    state = _state(make_fog_map)
    iid = state.new_id()
    state.intents[iid] = Intent(iid, 1, IntentKind.PLANNED_MOVE, E_NODE, X_NODE, 5)
    (intent,) = _view(state).intents
    assert (intent.owner, intent.kind, intent.origin, intent.target) == (
        1,
        IntentKind.PLANNED_MOVE,
        E_NODE,
        X_NODE,
    )


def test_example_15_a_fight_in_my_x(make_fog_map: MakeMap) -> None:
    state = _state(make_fog_map)
    state.nodes[X_NODE].warehouse = 3
    enemy = _group(state, 1, AtNode(X_NODE))
    g = _g(state, AtNode(X_NODE))
    fid = _fight(state, g, enemy, node=X_NODE)
    view = _view(state)
    (fight,) = view.fights
    assert (fight.node, fight.enemy_units, fight.enemy_charged) == (X_NODE, 4, 3)
    del state.groups[enemy.id], state.fights[fid]  # the fight is over, G stays in X
    g.fight = None
    view = _view(state)
    assert _sources(state) == [X_NODE]
    x = view.nodes[X_NODE]
    assert (x.detail, x.seen, x.warehouse) == (E, _empty(E), 3)


# "Details", one test per item -------------------------------------------------------------------


def test_detail_1_the_sources(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """A standing group (also one waiting for a planned departure), a group on an edge by its
    half; own nodes and own packets are no sources."""
    state = _state(make_fog_map)
    pid = state.new_id()
    state.packets[pid] = Packet(pid, 0, E2, E_NODE, 3, 5, 20)  # an own packet on e2
    assert _sources(state) == []
    waiting = _g(state, AtNode(F_NODE))
    waiting.order = Order((E_NODE,), True, TICK + 30)  # waits for its departure
    assert _sources(state) == [F_NODE]
    waiting.order = None
    _g(state, OnEdge(E0, M_NODE, 100))  # the half of M
    assert _sources(state) == [M_NODE, F_NODE]
    levels = compute_vision(state, rules, 0)
    assert (levels.stands[M_NODE], levels.stands[F_NODE]) == (False, True)


def test_detail_2_the_warehouse_of_a_foreign_city(make_fog_map: MakeMap) -> None:
    """Shown only where an own group really stands, not at the node of the half of G."""
    state = _state(make_fog_map)
    state.nodes[E_NODE].warehouse = 9
    _g(state, OnEdge(E1, X_NODE, 700))  # the half of E
    e = _view(state).nodes[E_NODE]
    assert (e.detail, e.warehouse) == (E, None)
    _g(state, AtNode(E_NODE))
    assert _view(state).nodes[E_NODE].warehouse == 9


def test_detail_3_the_level_of_a_node(make_fog_map: MakeMap) -> None:
    """The best of the table level, ``EXACT`` at a source and ``PRESENCE`` for an own node; a
    neutral node gets no such level; own data exact at any level."""
    state = _state(make_fog_map, owners={F_NODE: 0})
    state.nodes[F_NODE].warehouse = 4
    _group(state, 1, AtNode(F_NODE))
    view = _view(state)
    f = view.nodes[F_NODE]
    assert (f.detail, f.seen, f.warehouse) == (P, Sighting(TICK, P, ATTACK, None, None), 4)
    assert f.recruit_queue == 0 and f.has_barracks is not None and f.warehouse_cap is not None
    _g(state, AtNode(E_NODE))  # a source next to F: forest from plains, a range
    f = _view(state).nodes[F_NODE]
    assert (f.detail, f.seen) == (R, Sighting(TICK, R, ATTACK, None, None, (3, 5)))
    state = _state(make_fog_map)  # F neutral, no source next to it: fog
    _group(state, 1, AtNode(F_NODE))
    assert _view(state).nodes[F_NODE].detail is F


def test_detail_3_no_memory_delay_in_own_nodes(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """An enemy in an own node without a source is seen at once, not from the memory."""
    state = _state(make_fog_map)
    vision(state, rules)
    enemy = _group(state, 1, AtNode(M_NODE))
    assert _view(state).nodes[M_NODE].seen == Sighting(TICK, P, ATTACK, None, None)
    del state.groups[enemy.id]
    assert _view(state).nodes[M_NODE].seen == _empty(P)


def test_detail_4_own_presence_gives_no_zone(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """The own X without a source gives no level to its neighbour E and no zone to its halves;
    an enemy on the way to X is not a figure and leaves no memory marker."""
    state = _state(make_fog_map)
    enemy = _group(state, 1, OnEdge(E1, E_NODE, 900))  # pos 100 in the half of X, toward X
    vision(state, rules)
    view = _view(state)
    assert view.nodes[E_NODE].detail is F
    assert [h.detail for h in view.edges[E1].halves] == [F, F]
    assert view.edges[E1].enemy_groups == ()
    assert not is_visible(state, rules, 0, enemy)
    assert (E1, X_NODE) not in state.vision_memory[0].halves
    assert enemy.id not in state.vision_memory[0].spotted


def test_detail_5_own_roads_and_builds(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """The own internal e0 in fog: its level and the own build on it are exact; the buffer e1
    in fog: the last seen level (1 if never seen), ``UpgradeRoad`` hidden."""
    state = _state(make_fog_map)
    state.players[0].cp = 500
    state.edges[E0].width = 2
    state.edges[E0].build = Build(edge=E0, owner=0, since=0)
    state.edges[E1].width = 3
    view = _view(state)
    e0, e1 = view.edges[E0], view.edges[E1]
    assert (e0.detail, e0.width) == (F, 2)
    assert e0.build == BuildView(done_tick=rules.build.ticks_per_level)
    assert (e1.detail, e1.width) == (F, 1)
    assert validate(state, rules, 0, UpgradeRoad(E1)) == Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
    assert validate(state, rules, 0, UpgradeRoad(E2)) == Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
    state.edges[E0].build = None
    assert isinstance(validate(state, rules, 0, UpgradeRoad(E0)), Ok)


@pytest.mark.parametrize(
    ("location", "source"),
    [
        (OnEdge(E1, X_NODE, 0), X_NODE),  # just left X: the half of X
        (OnEdge(E1, E_NODE, 0), E_NODE),
        (OnEdge(E1, X_NODE, 499), X_NODE),
        (OnEdge(E1, X_NODE, 500), E_NODE),  # at the border point: the node it heads to
        (OnEdge(E1, E_NODE, 500), X_NODE),
        (OnEdge(E1, X_NODE, 501, back=True), E_NODE),  # turned back, not yet at the border
        (OnEdge(E1, X_NODE, 500, back=True), X_NODE),
    ],
)
def test_detail_6_the_node_of_the_half(
    make_fog_map: MakeMap, location: OnEdge, source: int
) -> None:
    state = _state(make_fog_map)
    _g(state, location)
    assert _sources(state) == [source]


def test_detail_6_the_same_rule_for_both_players(make_fog_map: MakeMap) -> None:
    state = _state(make_fog_map)
    _group(state, 1, OnEdge(E1, E_NODE, 500))  # player 1 at the border heading to X
    assert _sources(state, 1) == [X_NODE]
    view = _view(state, 1)
    assert view.nodes[X_NODE].detail is E
    assert view.nodes[E_NODE].detail is E  # neighbour plains; also own
    assert view.nodes[M_NODE].detail is E


def test_detail_7_memory_when_g_leaves(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """While G is on e2 its edge is out of the fog and its places are recorded; when G dies they
    fall to fog and keep the last sighting. Enemy packets stay hidden on G's edge."""
    state = _state(make_fog_map)
    state.edges[E2].width = 2
    g = _g(state, OnEdge(E2, E_NODE, 300))  # E a source; F a range
    _group(state, 1, OnEdge(E2, E_NODE, 100))  # pos 100: the half of E
    pid = state.new_id()
    packet = Packet(pid, 1, E2, E_NODE, 3, 5, 20)
    state.packets[pid] = packet
    assert not is_visible(state, rules, 0, packet)
    vision(state, rules)
    memory = state.vision_memory[0]
    assert memory.widths[E2] == 2
    assert memory.halves[E2, E_NODE] == Sighting(TICK, E, ATTACK, 4, 3)
    assert memory.halves[E2, F_NODE] == _empty(R)
    del state.groups[g.id]
    state.tick = 20
    state.edges[E2].width = 3
    vision(state, rules)
    edge = _view(state).edges[E2]
    assert [(h.detail, h.seen) for h in edge.halves] == [
        (F, Sighting(TICK, E, ATTACK, 4, 3)),
        (F, _empty(R)),
    ]
    assert (edge.detail, edge.width) == (F, 2)


def test_detail_8_unchanged(make_fog_map: MakeMap) -> None:
    """No ruleset numbers; the target of an enemy's normal order stays hidden."""
    assert {f.name for f in fields(_RULES.vision)} == {"range_starts", "by_terrain"}
    state = _state(make_fog_map)
    _g(state, AtNode(X_NODE))
    enemy = _group(state, 1, OnEdge(E1, E_NODE, 200))
    before = _view(state)
    enemy.order = Order((X_NODE, M_NODE), False, 0)
    assert _view(state) == before


def test_detail_9_symmetry(make_fog_map: MakeMap) -> None:
    """The same situation with the players swapped gives the same levels and sightings."""
    a = _state(make_fog_map)
    _g(a, OnEdge(E1, X_NODE, 700))
    _group(a, 1, AtNode(F_NODE))
    b = _state(make_fog_map, owners={X_NODE: 1})
    b.nodes[M_NODE].owner, b.nodes[E_NODE].owner = 1, 0
    _group(b, 1, OnEdge(E1, X_NODE, 700), units=2, charged=2)
    _group(b, 0, AtNode(F_NODE))
    va, vb = _view(a, 0), _view(b, 1)
    assert [(n.detail, n.seen) for n in va.nodes] == [(n.detail, n.seen) for n in vb.nodes]
    assert [(e.detail, e.width, e.halves) for e in va.edges] == [
        (e.detail, e.width, e.halves) for e in vb.edges
    ]


def test_detail_10_versions() -> None:
    """Vision and the fog memory changed: ``SIM_VERSION`` 22 and later."""
    assert SIM_VERSION >= 22
