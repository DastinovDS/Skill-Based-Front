"""DEC-33 (#296): enemy groups move visibly in the zone of a visible node, example by example.

Expected values are the table of worked examples of DEC-33 (mechanics.md, section 10) plus one
test per item of "Details": own city M (player 0, plains, a source) and the edge M-E with ``a`` = M,
the border point 500 unless said otherwise, ``pos`` in thousandths from ``a``; an enemy group of
4 units, 3 charged, "Attack" goes from E to M. The view is player 0's (``EdgeView.enemy_groups``).

DEC-35 (#477): own nodes are no longer sources of vision; mechanics.md reads the examples with "M,
a source" as "an own group stands in M". ``_state`` puts a scout of player 0 (1 unit, 1 charged)
in every own node, so these examples keep their sources; the DEC-35 rules have ``test_dec35.py``.
"""

from collections.abc import Callable, Sequence
from dataclasses import fields
from pathlib import Path

import pytest

from gow_sim.commands import Command, PlayerCommand
from gow_sim.maps import MapDef, load_map
from gow_sim.match import SIM_VERSION, Controller, Match, run_headless
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.state import (
    AtNode,
    Detail,
    Fight,
    FightMember,
    GameState,
    Group,
    Mode,
    OnEdge,
    Order,
    Sighting,
    initial_state,
)
from gow_sim.systems import movement as movement_module
from gow_sim.systems import vision as vision_module
from gow_sim.systems.vision import vision
from gow_sim.view import EdgeView, EnemyGroupView, PlayerView, opaque_id, project

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))
E, R, P, F = Detail.EXACT, Detail.RANGE, Detail.PRESENCE, Detail.FOG
M_NODE, E_NODE, F_NODE = 0, 1, 2

type MakeMap = Callable[..., MapDef]


@pytest.fixture(scope="module")
def rules() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "mvp-0.toml")


def _state(mapdef: MapDef, rules: Ruleset, tick: int = 10) -> GameState:
    """The state with a scout of player 0 in each of its nodes: the sources of the examples
    (DEC-35, the note before the DEC-33 table)."""
    state = initial_state(mapdef, rules)
    state.tick = tick
    for n in range(len(mapdef.nodes)):
        if state.nodes[n].owner == 0:
            gid = state.new_id()
            state.groups[gid] = Group(gid, 0, 1, 1, Mode.DEFENSE, AtNode(n))
    return state


def _group(
    state: GameState, owner: int, location: AtNode | OnEdge, units: int = 4, charged: int = 3
) -> Group:
    gid = state.new_id()
    state.groups[gid] = Group(gid, owner, units, charged, Mode.ATTACK, location)
    return state.groups[gid]


def _from_e(progress: int, back: bool = False) -> OnEdge:
    """On the edge M-E (``a`` = M), gone ``progress`` from E: ``pos = 1000 - progress``."""
    return OnEdge(edge=0, from_node=E_NODE, progress=progress, back=back)


def _view(state: GameState, rules: Ruleset) -> PlayerView:
    return project(state, rules, 0, KEY)


def _figures(state: GameState, rules: Ruleset, edge: int = 0) -> tuple[EnemyGroupView, ...]:
    return _view(state, rules).edges[edge].enemy_groups


def _shown(f: EnemyGroupView) -> tuple[object, ...]:
    """Everything of a figure but its id."""
    return (f.pos, f.toward_b, f.detail, f.mode, f.units, f.charged, f.units_range)


def _me(make: MakeMap, e: str) -> MapDef:
    return make("p" + e, [(M_NODE, E_NODE)])


# Examples 1-3: the zone of the visible E and of the source M -----------------------------------


@pytest.mark.parametrize(
    ("e", "pos", "shown"),
    [
        ("p", 800, (800, False, E, Mode.ATTACK, 4, 3, None)),  # 1: half of E, E exact
        ("p", 500, (500, False, E, Mode.ATTACK, 4, 3, None)),  # 2: on the border: half of M
        ("m", 800, (800, False, P, Mode.ATTACK, None, None, None)),  # 3: E presence, no numbers
    ],
    ids=["ex1", "ex2", "ex3"],
)
def test_examples_1_to_3(
    make_fog_map: MakeMap, rules: Ruleset, e: str, pos: int, shown: tuple[object, ...]
) -> None:
    state = _state(_me(make_fog_map, e), rules)
    _group(state, 1, _from_e(1000 - pos))
    (figure,) = _figures(state, rules)
    assert _shown(figure) == shown


def test_example_4_edge_between_two_visible_non_sources(
    make_fog_map: MakeMap, rules: Ruleset
) -> None:
    """M a source; E and F visible neighbours (forest, forest: ``RANGE``); the edge E-F has no
    source; a group goes from E to F at 300 from E: a figure at 300 to F, «3-5»; the road level
    of E-F is the last one seen (DEC-17)."""
    mapdef = make_fog_map("pff", [(M_NODE, E_NODE), (M_NODE, F_NODE), (E_NODE, F_NODE)])
    state = _state(mapdef, rules)
    state.vision_memory[0].widths[2] = 2
    state.edges[2].width = 3
    _group(state, 1, OnEdge(edge=2, from_node=E_NODE, progress=300))
    edge = _view(state, rules).edges[2]
    (figure,) = edge.enemy_groups
    assert _shown(figure) == (300, True, R, Mode.ATTACK, None, None, (3, 5))
    assert (edge.detail, edge.width) == (F, 2)


def _efm(make: MakeMap) -> MapDef:
    """M - E - F, F not a neighbour of M (``FOG``), E forest (visible); e1 = E - F, ``a`` = E."""
    return make("pff", [(M_NODE, E_NODE), (E_NODE, F_NODE)])


@pytest.mark.parametrize(("progress", "seen"), [(0, True), (499, True), (500, False)])
def test_example_5_the_figure_vanishes_on_the_border(
    make_fog_map: MakeMap, rules: Ruleset, progress: int, seen: bool
) -> None:
    """A group goes from E into F: a figure in the half of E; on the border point it vanishes
    into the fog; none in the half of F, which shows the memory of F."""
    state = _state(_efm(make_fog_map), rules)
    memory = Sighting(4, R, (Mode.DEFENSE,), None, None, (1, 2))
    state.vision_memory[0].halves[1, F_NODE] = memory
    _group(state, 1, OnEdge(edge=1, from_node=E_NODE, progress=progress))
    edge = _view(state, rules).edges[1]
    assert [f.pos for f in edge.enemy_groups] == ([progress] if seen else [])
    half_e, half_f = edge.halves
    assert half_e.detail is R
    assert (half_f.detail, half_f.seen) == (F, memory)


def test_example_6_back_from_the_fog_with_a_new_id(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """The group returns from F to E: not seen in the half of F; on the border it appears in
    the half of E with a new id (detail 5)."""
    state = _state(_efm(make_fog_map), rules, tick=1)
    g = _group(state, 1, OnEdge(edge=1, from_node=E_NODE, progress=300))
    vision(state, rules)
    (first,) = _figures(state, rules, 1)
    state.tick, g.location = 2, OnEdge(edge=1, from_node=E_NODE, progress=700)  # into F's half
    vision(state, rules)
    assert _figures(state, rules, 1) == ()
    state.tick, g.location = 3, OnEdge(edge=1, from_node=F_NODE, progress=500)  # back on the border
    vision(state, rules)
    (second,) = _figures(state, rules, 1)
    assert (second.pos, second.toward_b) == (500, False)
    assert second.id != first.id


def test_example_7_both_ends_in_fog(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """E and F both ``FOG``: no halves, no groups."""
    mapdef = make_fog_map("ppff", [(M_NODE, 3), (3, E_NODE), (E_NODE, F_NODE)])  # M - X - E - F
    state = _state(mapdef, rules)
    _group(state, 1, OnEdge(edge=2, from_node=E_NODE, progress=100))
    _group(state, 1, OnEdge(edge=2, from_node=F_NODE, progress=100))
    edge = _view(state, rules).edges[2]
    assert [h.detail for h in edge.halves] == [F, F]
    assert edge.enemy_groups == ()


def test_example_8_normal_order_target_is_hidden(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """A group goes from E to M with a normal order to Z through M: a figure to M, no Z."""
    mapdef = make_fog_map("ppp", [(M_NODE, E_NODE), (M_NODE, 2)])  # Z = node 2 behind M
    state = _state(mapdef, rules)
    g = _group(state, 1, _from_e(100))
    g.order = Order(path=(M_NODE, 2), planned=False, depart_tick=1)
    before = _view(state, rules)
    (figure,) = before.edges[0].enemy_groups
    assert (figure.pos, figure.toward_b) == (900, False)
    g.order = Order(path=(M_NODE,), planned=False, depart_tick=1)
    assert _view(state, rules) == before


def test_example_9_a_turn_flips_the_direction(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """The group at 400 turns (a bounce or a cancel): at 400, ``toward_b`` flips, no reason."""
    state = _state(_me(make_fog_map, "p"), rules)
    g = _group(state, 1, _from_e(600))
    (before,) = _figures(state, rules)
    g.location = _from_e(600, back=True)
    (after,) = _figures(state, rules)
    assert (before.pos, before.toward_b) == (400, False)
    assert (after.pos, after.toward_b) == (400, True)
    assert after.id == before.id
    assert {f.name for f in fields(EnemyGroupView)} == {
        "id",
        "pos",
        "toward_b",
        "detail",
        "mode",
        "units",
        "charged",
        "units_range",
    }


@pytest.mark.parametrize(
    ("pos", "shown"),
    [
        (701, (701, False, R, Mode.ATTACK, None, None, (3, 5))),  # half of E by E's level
        (700, (700, False, E, Mode.ATTACK, 4, 3, None)),  # on the border: half of M, exact
        (300, (300, False, E, Mode.ATTACK, 4, 3, None)),
    ],
)
def test_example_10_border_point_700(
    make_fog_map: MakeMap,
    rules: Ruleset,
    monkeypatch: pytest.MonkeyPatch,
    pos: int,
    shown: tuple[object, ...],
) -> None:
    def at_700(mapdef: MapDef, edge: int) -> int:
        del mapdef, edge
        return 700

    monkeypatch.setattr(movement_module, "border_permille", at_700)
    monkeypatch.setattr(vision_module, "border_permille", at_700)
    state = _state(_me(make_fog_map, "f"), rules)
    _group(state, 1, _from_e(1000 - pos))
    (figure,) = _figures(state, rules)
    assert _shown(figure) == shown


def test_example_11_two_groups_in_one_half(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """Two enemy groups in the half of E at 800 and 650: two figures with their own data,
    ordered by id (details 3 and 4)."""
    state = _state(_me(make_fog_map, "p"), rules)
    _group(state, 1, _from_e(200), units=4, charged=3)
    _group(state, 1, _from_e(350), units=2, charged=0)
    figures = _figures(state, rules)
    assert sorted((f.pos, f.units, f.charged) for f in figures) == [(650, 2, 0), (800, 4, 3)]
    assert figures[0].id < figures[1].id


def test_example_12_a_group_in_a_fight_is_not_a_figure(
    make_fog_map: MakeMap, rules: Ruleset
) -> None:
    """A group in a fight on the edge, in the half of E: the fight shows it, no figure; the half
    still counts it (detail 6)."""
    state = _state(_me(make_fog_map, "f"), rules)
    own = _group(state, 0, OnEdge(edge=0, from_node=M_NODE, progress=650), units=2, charged=2)
    enemy = _group(state, 1, _from_e(350))
    fid = state.new_id()
    state.fights[fid] = Fight(
        fid,
        node=None,
        edge=0,
        point=1300,
        attacker=None,
        start=9,
        next_round=29,
        virtual=(0, 0),
        mute=(0, 0),
        shots=(0, 0),
        losses=(0, 0),
        members={own.id: FightMember(0, 2, 2), enemy.id: FightMember(1, 4, 3)},
    )
    own.fight = enemy.fight = fid
    view = _view(state, rules)
    assert view.edges[0].enemy_groups == ()
    (fight,) = view.fights
    assert (fight.edge, fight.point, fight.enemy_units, fight.enemy_charged) == (0, 1300, 4, 3)
    # DEC-35, detail 6: the own group in the fight is a source in the half of the fight point
    # (1300 / 2 = 650, past the border point toward E), so the half of E is exact.
    assert view.edges[0].halves[1].seen == Sighting(10, E, (Mode.ATTACK,), 4, 3)


def test_example_13_own_group_on_an_edge_sees_its_edge(
    make_fog_map: MakeMap, rules: Ruleset
) -> None:
    """An own group stands on the edge E-F, no source next to it: as revised by DEC-35, the own
    group at the border point heading to F (forest) is a source in F; the enemy group at 400 is in
    the half of E (plains from forest: ``RANGE``), a figure with the range "3-5"."""
    mapdef = make_fog_map("ppff", [(M_NODE, 3), (3, E_NODE), (E_NODE, F_NODE)])  # M - X - E - F
    state = _state(mapdef, rules)
    _group(state, 0, OnEdge(edge=2, from_node=E_NODE, progress=500), units=1, charged=1)
    _group(state, 1, OnEdge(edge=2, from_node=E_NODE, progress=400))
    (figure,) = _figures(state, rules, 2)
    assert _shown(figure) == (400, True, R, Mode.ATTACK, None, None, (3, 5))


# "Details", one test per item --------------------------------------------------------------------


@pytest.mark.parametrize(("from_node", "progress", "pos"), [(0, 637, 637), (1, 637, 363)])
def test_detail_1_exact_thousandths(
    make_fog_map: MakeMap, rules: Ruleset, from_node: int, progress: int, pos: int
) -> None:
    state = _state(_me(make_fog_map, "p"), rules)
    _group(state, 1, OnEdge(edge=0, from_node=from_node, progress=progress))
    (figure,) = _figures(state, rules)
    assert figure.pos == pos


@pytest.mark.parametrize(
    ("from_node", "back", "toward_b"),
    [(M_NODE, False, True), (M_NODE, True, False), (E_NODE, False, False), (E_NODE, True, True)],
)
def test_detail_2_direction_is_the_nearest_node(
    make_fog_map: MakeMap, rules: Ruleset, from_node: int, back: bool, toward_b: bool
) -> None:
    state = _state(_me(make_fog_map, "p"), rules)
    _group(state, 1, OnEdge(edge=0, from_node=from_node, progress=300, back=back))
    (figure,) = _figures(state, rules)
    assert figure.toward_b is toward_b


@pytest.mark.parametrize(
    ("e", "data"),
    [
        ("p", (E, 4, 3, None)),
        ("f", (R, None, None, (3, 5))),
        ("m", (P, None, None, None)),
    ],
)
def test_detail_3_numbers_by_the_level_of_the_half(
    make_fog_map: MakeMap, rules: Ruleset, e: str, data: tuple[object, ...]
) -> None:
    """Per group, not a sum: ``EXACT`` units and charged, ``RANGE`` the range of its units,
    ``PRESENCE`` no numbers; the mode on every level."""
    state = _state(_me(make_fog_map, e), rules)
    g = _group(state, 1, _from_e(100))
    g.mode = Mode.DEFENSE
    (figure,) = _figures(state, rules)
    assert (figure.detail, figure.units, figure.charged, figure.units_range) == data
    assert figure.mode is Mode.DEFENSE


def test_detail_4_groups_in_one_point_are_apart(make_fog_map: MakeMap, rules: Ruleset) -> None:
    state = _state(_me(make_fog_map, "p"), rules)
    _group(state, 1, _from_e(100), units=1, charged=1)
    _group(state, 1, _from_e(100), units=2, charged=0)
    figures = _figures(state, rules)
    assert [f.pos for f in figures] == [900, 900]
    assert [f.id for f in figures] == sorted({f.id for f in figures})


def test_detail_5_opaque_id(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """The id is stable while the group stays in sight, never the internal id or the own
    opaque id of the group, and new after a stay in the fog."""
    state = _state(_efm(make_fog_map), rules, tick=1)
    g = _group(state, 1, OnEdge(edge=1, from_node=E_NODE, progress=100))
    vision(state, rules)
    (first,) = _figures(state, rules, 1)
    assert first.id not in (g.id, opaque_id(KEY, 1, g.id), opaque_id(KEY, 0, g.id))
    state.tick, g.location = 2, OnEdge(edge=1, from_node=E_NODE, progress=200)
    vision(state, rules)
    (moved,) = _figures(state, rules, 1)
    assert moved.id == first.id
    state.tick, g.location = 3, AtNode(F_NODE)  # in fog
    vision(state, rules)
    state.tick, g.location = 4, OnEdge(edge=1, from_node=F_NODE, progress=600)
    vision(state, rules)
    (again,) = _figures(state, rules, 1)
    assert again.id != first.id
    other = project(state, rules, 0, bytes(range(1, 33)))  # another match key: another id
    assert other.edges[1].enemy_groups[0].id != again.id


def test_detail_6_fight_on_the_edge(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """Covered by example 12: no figure for a group in a fight; here a group that leaves the
    fight is a figure again."""
    state = _state(_me(make_fog_map, "p"), rules)
    g = _group(state, 1, _from_e(300))
    g.fight = None
    assert len(_figures(state, rules)) == 1


def test_detail_7_leaving_and_entering_a_node(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """A group standing in a visible node is in the sum of the node; once on the edge it is a
    figure at the end of that node; on arrival the figure goes and the node counts it."""
    state = _state(_me(make_fog_map, "p"), rules)
    g = _group(state, 1, AtNode(E_NODE))
    view = _view(state, rules)
    assert view.edges[0].enemy_groups == ()
    assert view.nodes[E_NODE].seen == Sighting(10, E, (Mode.ATTACK,), 4, 3)
    g.location = _from_e(13)
    view = _view(state, rules)
    assert [f.pos for f in view.edges[0].enemy_groups] == [987]
    assert view.nodes[E_NODE].seen == Sighting(10, E, (), 0, 0)
    g.location = AtNode(M_NODE)
    view = _view(state, rules)
    assert view.edges[0].enemy_groups == ()
    assert view.nodes[M_NODE].seen == Sighting(10, E, (Mode.ATTACK,), 4, 3)


def test_detail_8_memory_has_no_positions(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """The memory of a half keeps the level, values, modes and tick; no position or direction.
    In fog the half shows its memory and no figure."""
    state = _state(_efm(make_fog_map), rules, tick=1)
    scout = _group(state, 0, AtNode(E_NODE), units=1, charged=1)  # E a source: F seen
    g = _group(state, 1, OnEdge(edge=1, from_node=E_NODE, progress=800))
    vision(state, rules)
    remembered = state.vision_memory[0].halves[1, F_NODE]
    assert remembered == Sighting(1, R, (Mode.ATTACK,), None, None, (3, 5))
    assert {f.name for f in fields(Sighting)} == {
        "tick",
        "level",
        "enemy_modes",
        "enemy_units",
        "enemy_charged",
        "enemy_range",
    }
    del state.groups[scout.id]
    state.tick, g.location = 2, OnEdge(edge=1, from_node=E_NODE, progress=900)
    edge = _view(state, rules).edges[1]
    assert edge.halves[1].seen == remembered
    assert edge.enemy_groups == ()


def test_detail_9_road_level_only_by_dec17(make_fog_map: MakeMap, rules: Ruleset) -> None:
    """The figure moves at the speed of the true road level (the accepted rough leak), but the
    road level shown and remembered changes only by DEC-17."""
    mapdef = make_fog_map("pff", [(M_NODE, E_NODE), (M_NODE, F_NODE), (E_NODE, F_NODE)])
    state = _state(mapdef, rules)
    state.edges[2].width = 3
    _group(state, 1, OnEdge(edge=2, from_node=E_NODE, progress=300, level=3))
    vision(state, rules)
    edge: EdgeView = _view(state, rules).edges[2]
    assert len(edge.enemy_groups) == 1
    assert edge.width == 1
    assert 2 not in state.vision_memory[0].widths


def test_detail_10_versions() -> None:
    """The memory of halves changes ``state_hash()``: ``SIM_VERSION`` 19 and later (the
    protocol side is checked in ``gow_protocol``); the ruleset has no DEC-33 numbers."""
    assert SIM_VERSION >= 19
    rules = load_ruleset(ROOT / "rulesets" / "mvp-0.toml")
    assert {f.name for f in fields(rules.vision)} == {"range_starts", "by_terrain"}


class _Recorder:
    """Wraps a controller: checks that its view is ``project()`` of the state and counts the
    enemy figures it is given."""

    def __init__(self, inner: Controller, player: int, rules: Ruleset) -> None:
        self.inner, self.player, self.rules = inner, player, rules
        self.match: Match | None = None
        self.figures = 0

    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        if self.match is not None:
            assert view == project(self.match.state, self.rules, self.player, KEY)
        self.figures += sum(len(e.enemy_groups) for e in view.edges)
        return self.inner.decide(view, tick)


class _Observer:
    def __init__(self, recorders: list[_Recorder]) -> None:
        self.recorders = recorders

    def begin(self, match: Match) -> None:
        for r in self.recorders:
            r.match = match

    def record(self, match: Match, commands: Sequence[PlayerCommand]) -> None:
        del match, commands


def test_detail_11_bots_get_the_same_view(
    mvp_rules: Ruleset, expand_bot: Callable[[MapDef, Ruleset], Controller]
) -> None:
    """A controller gets ``project()`` of the state, ``enemy_groups`` included (the bots of
    ``gow_bots`` read them from the view only, AGENTS.md, section 2)."""
    mapdef = load_map(ROOT / "maps" / "fixtures" / "pass.json")
    recorders = [_Recorder(expand_bot(mapdef, mvp_rules), p, mvp_rules) for p in (0, 1)]
    run_headless(
        mapdef, mvp_rules, recorders, max_ticks=4000, match_key=KEY, observer=_Observer(recorders)
    )  # DEC-35: only groups see, so the first figures come later than with own nodes as sources
    assert sum(r.figures for r in recorders) > 0


def test_detail_12_budget_lives_in_the_benchmarks() -> None:
    """``project()`` with ``enemy_groups``: ``test_benchmarks.py::test_bench_project_with_
    enemy_figures`` (AGENTS.md, section 12)."""
    source = (Path(__file__).parent / "test_benchmarks.py").read_text(encoding="utf-8")
    assert "def test_bench_project_with_enemy_figures" in source
