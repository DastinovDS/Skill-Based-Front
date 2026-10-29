"""DEC-10 (#112): an own group on an edge, the examples that stay under DEC-35.

Expected values are the table of worked examples of DEC-10 (mechanics.md, section 10): the map
M - X - E - F, M (node 0) my capital, E (node 1) the enemy capital, X (node 2) and F (node 3)
neutral, all plains; e0 = M-X, e1 = X-E (``a`` = X), e2 = E-F (``a`` = E), border points 500. My
group G (2 units, 2 charged) is on e2 unless said otherwise; the enemy group is 4 units, 3
charged, "Attack". The view is player 0's.

DEC-35 (#477) superseded the "edge source" and the examples 1, 2, 3, 5, 6 and 10: a group on an
edge is a source in the node of its half (``test_dec35.py`` has those cases). Examples 4, 7, 8 and
9 stay; their sources are read by DEC-35: a scout of mine stands in M (so X is ``EXACT``, as the
setting of the table says), and G at ``pos`` 500 going from E to F is a source in F (the half of
the node it heads to at the border point).
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
    GameState,
    Group,
    Mode,
    OnEdge,
    Packet,
    Sighting,
    initial_state,
)
from gow_sim.systems.vision import is_visible, vision
from gow_sim.view import BuildView, PlayerView, project

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
    _group(state, 0, AtNode(M_NODE), units=1, charged=1)  # the scout in M: X is exact
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


def test_the_setting_of_the_table(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """Without G: X exact (from the scout in M), E and F in fog, e2 in fog."""
    view = _view(_state(make_fog_map), rules)
    assert [n.detail for n in view.nodes] == [E, F, E, F]
    assert [e.detail for e in view.edges] == [P, F, F]
    assert [h.detail for h in view.edges[E2].halves] == [F, F]


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


def test_example_7_the_node_g_left_was_lost(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """F was mine and was captured while G is on the way from F: G is still a source, now in the
    node of its half (DEC-35, detail 6): at ``pos`` 500 heading to E, the half of E."""
    state = _state(make_fog_map, owners={F_NODE: 1})  # F was mine, now the enemy's
    _g(state, from_node=F_NODE)
    view = _view(state, rules)
    assert view.edges[E2].detail is P
    assert [h.detail for h in view.edges[E2].halves] == [E, E]
    assert [n.detail for n in view.nodes] == [E, E, E, E]  # E a source; X and F plains from it


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
    """As 2 (an enemy group at ``pos`` 300 going to F), then G dies: the halves of e2 go back to
    the fog and keep the last sighting; e2 keeps the last seen road level. With G a source in F,
    both halves were exact (DEC-35, detail 7: E is plains from plains)."""
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
    assert [(h.detail, h.seen) for h in edge.halves] == [
        (F, Sighting(TICK, E, (Mode.ATTACK,), 4, 3)),
        (F, Sighting(TICK, E, (), 0, 0)),
    ]
    assert (edge.detail, edge.width) == (F, 2)
    assert edge.enemy_groups == ()
