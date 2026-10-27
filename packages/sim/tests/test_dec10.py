"""DEC-10 (#112): an own group on an edge sees its own edge, example by example.

Expected values are the table of worked examples of DEC-10 (mechanics.md, section 10): the map
M - X - E - F, M (node 0) my capital, E (node 1) the enemy capital, X (node 2) and F (node 3)
neutral, all plains; e0 = M-X, e1 = X-E (``a`` = X), e2 = E-F (``a`` = E), border points 500. X
is ``EXACT`` (plains from plains), E and F are ``FOG``. My group G (2 units, 2 charged) is on e2
unless said otherwise; the enemy group is 4 units, 3 charged, «Атака». The view is player 0's.
Example 10 is example 13 of DEC-33 (``test_dec33.py``).
"""

from collections.abc import Callable
from pathlib import Path

import pytest

from gow_sim.maps import MapDef
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.state import (
    AtNode,
    Build,
    Detail,
    Fight,
    FightMember,
    GameState,
    Group,
    Mode,
    OnEdge,
    Packet,
    Sighting,
    initial_state,
)
from gow_sim.systems.vision import is_visible, vision
from gow_sim.view import BuildView, EnemyGroupView, PlayerView, project

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))
E, R, P, F = Detail.EXACT, Detail.RANGE, Detail.PRESENCE, Detail.FOG
M_NODE, E_NODE, X_NODE, F_NODE = 0, 1, 2, 3
E0, E1, E2 = 0, 1, 2
TICK = 10

type MakeMap = Callable[..., MapDef]


_RULES = load_ruleset(ROOT / "rulesets" / "mvp-0.toml")


@pytest.fixture(scope="module")
def rules() -> Ruleset:
    return _RULES


def _state(make: MakeMap, owners: dict[int, int] | None = None) -> GameState:
    mapdef = make("pppp", [(M_NODE, X_NODE), (X_NODE, E_NODE), (E_NODE, F_NODE)], owners)
    state = initial_state(mapdef, _RULES)
    state.tick = TICK
    return state


def _group(
    state: GameState, owner: int, location: AtNode | OnEdge, units: int = 4, charged: int = 3
) -> Group:
    gid = state.new_id()
    state.groups[gid] = Group(gid, owner, units, charged, Mode.ATTACK, location)
    return state.groups[gid]


def _g(state: GameState, edge: int = E2, from_node: int = E_NODE, progress: int = 500) -> Group:
    """My group G."""
    return _group(state, 0, OnEdge(edge, from_node, progress), units=2, charged=2)


def _view(state: GameState, rules: Ruleset) -> PlayerView:
    return project(state, rules, 0, KEY)


def _shown(f: EnemyGroupView) -> tuple[object, ...]:
    """Everything of a figure but its id."""
    return (f.pos, f.toward_b, f.detail, f.mode, f.units, f.charged, f.units_range)


def _empty(level: Detail) -> Sighting:
    return Sighting(TICK, level, (), None, None)


def _attack(level: Detail = P, tick: int = TICK) -> Sighting:
    return Sighting(tick, level, (Mode.ATTACK,), None, None)


def test_the_levels_without_g(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """The setting of the table: X exact, E and F in fog, e2 in fog."""
    view = _view(_state(make_fog_map), rules)
    assert [n.detail for n in view.nodes] == [E, F, E, F]
    assert [e.detail for e in view.edges] == [P, F, F]
    assert [h.detail for h in view.edges[E2].halves] == [F, F]


def test_example_1_both_halves_presence_the_ends_stay_in_fog(
    make_fog_map: MakeMap, rules: Ruleset
) -> None:
    state = _state(make_fog_map)
    state.edges[E2].width = 2
    state.nodes[E_NODE].warehouse = 7
    _g(state)
    view = _view(state, rules)
    edge = view.edges[E2]
    assert [(h.detail, h.seen) for h in edge.halves] == [(P, _empty(P)), (P, _empty(P))]
    assert edge.enemy_groups == ()
    assert (edge.detail, edge.width) == (P, 2)  # item 5: the road level is exact
    # Item 4: the end nodes are not revealed; the half of E on e1 stays in fog.
    for n in (E_NODE, F_NODE):
        assert (view.nodes[n].detail, view.nodes[n].seen, view.nodes[n].warehouse) == (
            F,
            None,
            None,
        )
    assert [h.detail for h in view.edges[E1].halves] == [E, F]
    assert view.edges[E1].detail is F


def test_example_2_an_enemy_figure_without_numbers(make_fog_map: MakeMap, rules: Ruleset) -> None:
    state = _state(make_fog_map)
    _g(state)
    enemy = _group(state, 1, OnEdge(E2, E_NODE, 300))
    edge = _view(state, rules).edges[E2]
    (figure,) = edge.enemy_groups
    assert _shown(figure) == (300, True, P, Mode.ATTACK, None, None, None)
    assert edge.halves[0].seen == _attack()
    assert edge.halves[1].seen == _empty(P)
    assert is_visible(state, rules, 0, enemy)


def test_example_3_a_group_standing_in_an_end_is_not_seen(
    make_fog_map: MakeMap, rules: Ruleset
) -> None:
    state = _state(make_fog_map)
    _g(state)
    enemy = _group(state, 1, AtNode(E_NODE))
    view = _view(state, rules)
    assert (view.nodes[E_NODE].detail, view.nodes[E_NODE].seen) == (F, None)
    assert [h.seen for h in view.edges[E2].halves] == [_empty(P), _empty(P)]
    assert view.edges[E2].enemy_groups == ()
    assert not is_visible(state, rules, 0, enemy)


def test_example_4_an_enemy_packet_is_not_seen(make_fog_map: MakeMap, rules: Ruleset) -> None:
    state = _state(make_fog_map)
    _g(state)
    pid = state.new_id()
    packet = Packet(pid, 1, E2, from_node=E_NODE, charges=3, depart_tick=5, arrive_tick=20)
    state.packets[pid] = packet
    before = _view(state, rules)
    assert before.packets == ()
    assert not is_visible(state, rules, 0, packet)
    del state.packets[pid]  # no trace of it anywhere in the view
    assert _view(state, rules) == before


@pytest.mark.parametrize(
    ("pos", "shown"),
    [
        (800, (800, False, P, Mode.ATTACK, None, None, None)),  # the half of E: presence
        (400, (400, False, E, Mode.ATTACK, 4, 3, None)),  # the half of X: exact, as X
    ],
)
def test_example_5_the_half_of_an_exact_node_keeps_its_level(
    make_fog_map: MakeMap, rules: Ruleset, pos: int, shown: tuple[object, ...]
) -> None:
    state = _state(make_fog_map)
    _g(state, edge=E1, from_node=X_NODE, progress=600)
    _group(state, 1, OnEdge(E1, E_NODE, 1000 - pos))  # from E (``b``) to X: pos = 1000 - progress
    edge = _view(state, rules).edges[E1]
    assert [h.detail for h in edge.halves] == [E, P]
    (figure,) = edge.enemy_groups
    assert _shown(figure) == shown


def test_example_6_a_fight_on_the_edge(make_fog_map: MakeMap, rules: Ruleset) -> None:
    state = _state(make_fog_map)
    g = _g(state, progress=300)
    first = _group(state, 1, OnEdge(E2, F_NODE, 700))  # meets G at 300 from E
    second = _group(state, 1, OnEdge(E2, F_NODE, 100), units=5, charged=1)  # pos 900
    fid = state.new_id()
    state.fights[fid] = Fight(
        fid,
        node=None,
        edge=E2,
        point=600,
        attacker=None,
        start=9,
        next_round=29,
        virtual=(0, 0),
        mute=(0, 0),
        shots=(0, 0),
        losses=(0, 0),
        members={g.id: FightMember(0, 2, 2), first.id: FightMember(1, 4, 3)},
    )
    g.fight = first.fight = fid
    view = _view(state, rules)
    (fight,) = view.fights
    assert (fight.edge, fight.enemy_units, fight.enemy_charged) == (E2, 4, 3)
    (figure,) = view.edges[E2].enemy_groups  # the second group only (DEC-33, detail 6)
    assert _shown(figure) == (900, False, P, Mode.ATTACK, None, None, None)
    assert is_visible(state, rules, 0, second)


def test_example_7_the_node_g_left_was_lost(make_fog_map: MakeMap, rules: Ruleset) -> None:
    state = _state(make_fog_map, owners={F_NODE: 1})  # F was mine, now the enemy's
    _g(state, from_node=F_NODE)
    view = _view(state, rules)
    assert [h.detail for h in view.edges[E2].halves] == [P, P]
    assert view.edges[E2].detail is P
    assert [n.detail for n in view.nodes] == [E, F, E, F]


def test_example_8_an_enemy_build_on_the_edge(make_fog_map: MakeMap, rules: Ruleset) -> None:
    state = _state(make_fog_map, owners={F_NODE: 1})  # e2 is an internal edge of the enemy
    state.edges[E2].width = 2
    state.vision_memory[0].widths[E2] = 1
    state.edges[E2].build = Build(edge=E2, owner=1, since=0)
    without = _view(state, rules).edges[E2]
    assert (without.detail, without.width, without.build) == (F, 1, None)
    _g(state)
    edge = _view(state, rules).edges[E2]
    assert (edge.detail, edge.width, edge.build) == (P, 2, BuildView(done_tick=None))


def test_example_9_g_leaves_the_edge(make_fog_map: MakeMap, rules: Ruleset) -> None:
    state = _state(make_fog_map)
    state.edges[E2].width = 2
    g = _g(state)
    _group(state, 1, OnEdge(E2, E_NODE, 300))
    vision(state, rules)  # the memory of tick 10
    assert state.vision_memory[0].widths[E2] == 2
    del state.groups[g.id]  # G is gone (it died)
    state.tick = 20
    state.edges[E2].width = 3  # upgraded in the fog
    vision(state, rules)
    edge = _view(state, rules).edges[E2]
    assert [(h.detail, h.seen) for h in edge.halves] == [(F, _attack()), (F, _empty(P))]
    assert (edge.detail, edge.width) == (F, 2)
    assert edge.enemy_groups == ()


def test_the_rule_is_the_same_for_both_players(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """Item 9: player 1 with its group on e0 (between M and X) sees the same as player 0 does."""
    state = _state(make_fog_map)
    state.nodes[M_NODE].owner = None  # player 1 has no node source near M and X
    state.nodes[E_NODE].owner = None
    _group(state, 1, OnEdge(E0, X_NODE, 500), units=2, charged=2)
    _group(state, 0, OnEdge(E0, M_NODE, 300))
    view = project(state, rules, 1, KEY)
    assert [h.detail for h in view.edges[E0].halves] == [P, P]
    (figure,) = view.edges[E0].enemy_groups
    assert _shown(figure) == (300, True, P, Mode.ATTACK, None, None, None)
    assert view.nodes[M_NODE].detail is F and view.nodes[X_NODE].detail is F
