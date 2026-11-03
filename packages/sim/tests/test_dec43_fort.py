"""Road fortifications (DEC-43, item D, #707).

Expected values come from mechanics.md, section 7, block DEC-43, item D: the items D1 to D10 and
the table T1..T13, V1..V4 (the wire part of V4 is in ``packages/protocol/tests/
test_road_forts.py``).

The map of the table is ``dec41`` (see ``test_dec43.py``), ``mvp-4``: player 0 owns C = 3 and B =
2, player 1 owns M = 8 for these rows; the road C-M is edge 8 (``a`` = C, ``b`` = M,
``border_permille`` 500, 38 ticks: a group from M reaches the line point of C, progress 500
towards C, on its 19th tick on the road); a fortification of C on road C-M, built unless a row
says so. The start garrisons (2/2 in K and in its mirror) stay where they are; K is not next to
C, so player 0 has no source of vision near C unless a row puts one there.
"""

from pathlib import Path

import pytest

from gow_sim.commands import (
    FortifyRoad,
    Move,
    Ok,
    PlayerCommand,
    Reject,
    RejectCode,
    validate,
)
from gow_sim.maps import load_map
from gow_sim.match import Match
from gow_sim.ruleset import FortRules, Ruleset, load_ruleset, parse_ruleset, to_canonical
from gow_sim.state import (
    PROGRESS_SCALE,
    AtNode,
    Event,
    GameState,
    Group,
    Mode,
    OnEdge,
    Order,
    from_canonical,
)
from gow_sim.state import to_canonical as state_canonical
from gow_sim.systems.movement import leg
from gow_sim.view import RoadFortView, project

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[2]
RULES = load_ruleset(ROOT / "rulesets" / "mvp-4.toml")
MVP3 = load_ruleset(ROOT / "rulesets" / "mvp-3.toml")
MAP = load_map(TESTS_DIR / "maps" / "dec41.json")
KEY = bytes(range(32))
K, A, B, C, D = 0, 1, 2, 3, 4
M = 8
ROAD_KA, ROAD_AB, ROAD_BC, ROAD_DC, ROAD_CM = 0, 1, 2, 4, 8
ROAD_C17 = 10
CROSS = 19
"""The tick on the road C-M at which a group from M reaches the line point of C."""


def _match(*, fort: bool = True, m_owner: int = 1) -> Match:
    match = Match(MAP, RULES, KEY)
    state = match.state
    state.nodes[M].owner = m_owner
    if fort:
        state.nodes[C].road_forts[ROAD_CM] = 0  # built: it works from tick 0
    return match


def _group(state: GameState, owner: int, node: int, units: int, charged: int) -> Group:
    gid = state.new_id()
    group = Group(gid, owner, units, charged, Mode.ATTACK, AtNode(node))
    state.groups[gid] = group
    return group


def _on_edge(
    state: GameState, owner: int, edge: int, from_node: int, ticks: int, units: int, charged: int
) -> Group:
    """A group ``ticks`` ticks along ``edge`` from ``from_node`` with an order to the far end."""
    far = MAP.edges[edge].other(from_node)
    progress = leg(MAP, RULES, edge, far).progress(ticks)
    gid = state.new_id()
    group = Group(
        gid,
        owner,
        units,
        charged,
        Mode.ATTACK,
        OnEdge(edge, from_node, progress),
        order=Order((far,), False, 0),
    )
    state.groups[gid] = group
    return group


def _step(match: Match, *cmds: tuple[int, object], ticks: int = 1) -> list[Event]:
    """``ticks`` steps; the commands ``(player, cmd)`` go into the first one."""
    events: list[Event] = []
    first = [PlayerCommand(p, i, c) for i, (p, c) in enumerate(cmds)]  # type: ignore[arg-type]
    for i in range(ticks):
        events += match.step(first if i == 0 else [])
    return events


def _kinds(events: list[Event], kind: str) -> list[Event]:
    return [e for e in events if e.kind == kind]


def _attack(units: int, charged: int, fort: bool = True) -> tuple[Match, Group, list[Event]]:
    """A group of player 1 of ``units``/``charged`` sets out from M to C at tick 1 and steps until
    it reached the line point (tick ``CROSS``)."""
    match = _match(fort=fort)
    g = _group(match.state, 1, M, units, charged)
    events = _step(match, (1, Move(g.id, C)), ticks=CROSS)
    return match, g, events


# The ruleset ------------------------------------------------------------------------------------


def test_the_fort_keys_of_mvp4() -> None:
    """Item D2 and the ``[fort]`` of ``mvp-4.toml``: 1.5 CP, 100 ticks, 1 per started 3 units."""
    assert RULES.fort == FortRules(cost=150, build_ticks=100, toll_units=3, toll_charges=1)
    assert MVP3.fort is None
    assert parse_ruleset(to_canonical(RULES)) == RULES


def test_fort_only_under_economy_v2() -> None:
    data = to_canonical(load_ruleset(ROOT / "rulesets" / "mvp-0.toml"))
    data["fort"] = {"cost": 150, "build_ticks": 100, "toll_units": 3, "toll_charges": 1}
    with pytest.raises(ValueError, match=r"fort: only with economy\.model"):
        parse_ruleset(data)


@pytest.mark.parametrize(
    ("units", "charged", "lost"),
    [(1, 1, 1), (3, 3, 1), (4, 4, 2), (7, 7, 3), (5, 1, 1), (4, 0, 0), (6, 6, 2), (9, 2, 2)],
)
def test_the_toll_formula(units: int, charged: int, lost: int) -> None:
    """Item D6: ``min(charged, toll_charges * ceil(units / toll_units))``."""
    fort = RULES.fort
    assert fort is not None
    assert fort.toll(units, charged) == lost


# T1..T4: a single crossing --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("units", "charged", "after"),
    [(1, 1, 0), (3, 3, 2), (4, 4, 2), (7, 7, 4), (5, 1, 0)],
    ids=["T1-1", "T2-3", "T2-4", "T2-7", "T3-5of1"],
)
def test_a_crossing_pays_the_toll(units: int, charged: int, after: int) -> None:
    """T1 to T3: the group pays at the line point, not a tick before. It is put on the road at
    its start (a ``Move`` of 7 units to C would hit the stack limit of the medium city C)."""
    match = _match()
    g = _on_edge(match.state, 1, ROAD_CM, M, 0, units, charged)
    before = _step(match, ticks=CROSS - 1)
    assert g.charged == charged and not _kinds(before, "toll_paid")
    assert isinstance(g.location, OnEdge) and g.location.progress < PROGRESS_SCALE // 2
    events = _step(match)
    assert isinstance(g.location, OnEdge) and g.location.progress == PROGRESS_SCALE // 2
    assert (g.units, g.charged) == (units, after)
    (paid,) = _kinds(events, "toll_paid")
    assert dict(paid.data) == {
        "player": 1,
        "group": g.id,
        "node": C,
        "edge": ROAD_CM,
        "charges": charged - after,
    }
    # Once past the line, no more toll on this road.
    later = _step(match, ticks=5)
    assert g.charged == after and not _kinds(later, "toll_paid")


def test_a_group_without_charges_pays_nothing() -> None:
    """T4: 4/0 stays 4/0 and no event."""
    _, g, events = _attack(4, 0)
    assert (g.units, g.charged) == (4, 0)
    assert not _kinds(events, "toll_paid") and not _kinds(events, "toll_taken")


def test_no_toll_without_a_fortification() -> None:
    _, g, events = _attack(7, 7, fort=False)
    assert g.charged == 7 and not _kinds(events, "toll_paid")


# T5: stacking ---------------------------------------------------------------------------------


def test_every_line_on_the_way_takes_its_toll() -> None:
    """T5: 6/6 crosses the line of C (6/4), takes C, goes on to B over a fortified B-C (6/2),
    then to A over a fortified A-B (6/0); a fourth line (K on K-A) takes nothing."""
    match = _match()
    state = match.state
    state.nodes[B].road_forts[ROAD_BC] = 0
    state.nodes[A].road_forts[ROAD_AB] = 0
    state.nodes[K].road_forts[ROAD_KA] = 0
    g = _group(state, 1, M, 6, 6)
    _step(match, (1, Move(g.id, C)), ticks=CROSS)
    assert g.charged == 4
    while g.location != AtNode(C):
        _step(match)
    assert state.nodes[C].owner == 1
    paid: list[Event] = []
    for target, charged in ((B, 2), (A, 0)):
        events = _step(match, (1, Move(g.id, target)))
        while g.location != AtNode(target):
            events += _step(match)
        paid += _kinds(events, "toll_paid")
        assert g.charged == charged
        assert state.nodes[target].owner == 1
    assert [(e.get("node"), e.get("charges")) for e in paid] == [(B, 2), (A, 2)]
    events = _step(match, (1, Move(g.id, K)), ticks=40)
    assert g.id not in state.groups or g.charged == 0
    assert not _kinds(events, "toll_paid")


# T6, T7, T13: who pays ------------------------------------------------------------------------


def test_an_enemy_moving_away_passes_free() -> None:
    """T6: a group of player 1 bouncing back towards M crosses the border point: nothing."""
    match = _match()
    state = match.state
    away = leg(MAP, RULES, ROAD_CM, C)
    gid = state.new_id()
    g = Group(gid, 1, 4, 4, Mode.ATTACK, OnEdge(ROAD_CM, M, away.progress(CROSS + 1), back=True))
    state.groups[gid] = g
    events = _step(match, ticks=3)
    assert isinstance(g.location, OnEdge) and g.location.progress < PROGRESS_SCALE // 2
    assert g.charged == 4 and not _kinds(events, "toll_paid")


def test_an_own_group_passes_free() -> None:
    """T7: M own, a group of player 0 from M to C crosses the line of C: nothing."""
    match = _match(m_owner=0)
    g = _group(match.state, 0, M, 4, 4)
    events = _step(match, (0, Move(g.id, C)), ticks=CROSS + 2)
    assert g.charged == 4 and not _kinds(events, "toll_paid")


def test_each_line_of_an_internal_road_works_for_its_own_node() -> None:
    """T13: C and M of player 0, both fortified on C-M; a group of player 1 on the road towards
    C pays the line of C only; one towards M pays the line of M only."""
    match = _match(m_owner=0)
    state = match.state
    state.nodes[M].road_forts[ROAD_CM] = 0
    to_c = _on_edge(state, 1, ROAD_CM, M, CROSS - 1, 3, 3)
    to_m = _on_edge(state, 1, ROAD_CM, C, CROSS - 1, 4, 4)
    events = _step(match)
    assert (to_c.charged, to_m.charged) == (2, 2)
    assert sorted((e.get("group"), e.get("node")) for e in _kinds(events, "toll_paid")) == sorted(
        [(to_c.id, C), (to_m.id, M)]
    )


# T8, T9: fights -------------------------------------------------------------------------------


def test_a_fight_before_the_line_takes_no_toll() -> None:
    """T8: player 0's 1/0 sets out from C three ticks before player 1's 4/4 sets out from M; they
    meet on player 1's 18th tick at its progress 473 (the fight point 1079): no toll then; player
    1 wins with one shot (4/3) and pays 2 when it reaches the line point (4/1)."""
    match = _match()
    state = match.state
    g0 = _group(state, 0, C, 1, 0)
    g1 = _group(state, 1, M, 4, 4)
    _step(match, (0, Move(g0.id, M)), ticks=3)
    events = _step(match, (1, Move(g1.id, C)), ticks=CROSS - 1)
    (started,) = _kinds(events, "fight_started")
    assert (started.get("edge"), started.get("point"), started.tick) == (ROAD_CM, 1079, 3 + 18)
    assert isinstance(g1.location, OnEdge) and g1.location.progress == 473
    assert g1.charged == 4 and not _kinds(events, "toll_paid")
    later: list[Event] = []
    for _ in range(80):
        later += _step(match)
        if _kinds(later, "toll_paid"):
            break
    (paid,) = _kinds(later, "toll_paid")
    assert paid.get("group") == g1.id and g0.id not in state.groups
    assert paid.get("charges") == 2 and (g1.units, g1.charged) == (4, 1)


def test_a_meeting_in_the_crossing_tick_pays_at_once() -> None:
    """T8b: player 0 sets out one tick before player 1; on its 19th tick player 1's group reaches
    progress 500 and they meet at 1026: it pays at once (4/2), the fight starts with 2 charged."""
    match = _match()
    state = match.state
    g0 = _group(state, 0, C, 1, 0)
    g1 = _group(state, 1, M, 4, 4)
    _step(match, (0, Move(g0.id, M)))
    events = _step(match, (1, Move(g1.id, C)), ticks=CROSS)
    (started,) = _kinds(events, "fight_started")
    assert (started.get("edge"), started.get("point"), started.tick) == (ROAD_CM, 1026, 1 + CROSS)
    (paid,) = _kinds(events, "toll_paid")
    assert paid.tick == started.tick and (g1.units, g1.charged) == (4, 2)
    assert g1.fight is not None and state.fights[g1.fight].members[g1.id].charged == 2


def test_a_fight_after_the_line_does_not_refund() -> None:
    """T9: player 1's 4/4 crosses at its 19th tick (4/2); a group of player 0 sets out from C after
    that and meets it in the half of C: the fight starts with 2 charged."""
    match, g1, events = _attack(4, 4)
    assert g1.charged == 2 and len(_kinds(events, "toll_paid")) == 1
    state = match.state
    g0 = _group(state, 0, C, 2, 2)
    events = _step(match, (0, Move(g0.id, M)), ticks=15)
    (started,) = _kinds(events, "fight_started")
    assert started.get("edge") == ROAD_CM
    point = started.get("point")
    assert isinstance(point, int) and point < PROGRESS_SCALE  # in the half of C
    fight = state.fights[g1.fight] if g1.fight is not None else None
    assert fight is not None and fight.members[g1.id].charged == 2
    assert not _kinds(events, "toll_paid")


# T10, T11: the build and the checks -----------------------------------------------------------


def test_the_build_takes_cp_and_build_ticks() -> None:
    """T10: ``FortifyRoad(C, 8)`` applied at tick 50 with 5 CP: 3.5 CP at once, works from tick
    150 (``road_fort_built``); a crossing at tick 149 pays nothing, one at tick 150 pays."""
    for cross_tick, pays in ((149, False), (150, True)):
        match = _match(fort=False)
        state = match.state
        state.tick = 49
        state.players[0].cp = 500
        events = _step(match, (0, FortifyRoad(C, ROAD_CM)))
        assert match.results[0].outcome == Ok(cost=150)
        assert state.players[0].cp == 350
        assert state.nodes[C].road_forts == {ROAD_CM: 150}
        (started,) = _kinds(events, "build_started")
        assert dict(started.data) == {
            "player": 0,
            "node": C,
            "edge": ROAD_CM,
            "kind": "road_fort",
            "level": None,
        }
        while state.tick < cross_tick - 1:
            events += _step(match)
        g = _on_edge(state, 1, ROAD_CM, M, CROSS - 1, 3, 3)
        events += _step(match)
        assert state.tick == cross_tick
        assert g.charged == (2 if pays else 3)
        built = _kinds(events, "road_fort_built")
        assert [dict(e.data) for e in built] == (
            [{"player": 0, "node": C, "edge": ROAD_CM}] if pays else []
        )
        assert [e.tick for e in built] == ([150] if pays else [])


def _check(
    state: GameState, cmd: FortifyRoad, player: int = 0, rules: Ruleset = RULES
) -> RejectCode | None:
    outcome = validate(state, rules, player, cmd)
    return outcome.code if isinstance(outcome, Reject) else None


def test_the_checks_in_order() -> None:
    """T11 and item D3: the codes in their order; a fight does not reject."""
    match = _match()
    state = match.state
    assert _check(state, FortifyRoad(C, ROAD_CM)) is RejectCode.ALREADY_BUILT
    assert _check(state, FortifyRoad(C, ROAD_KA)) is RejectCode.NOT_ADJACENT
    assert _check(state, FortifyRoad(M, ROAD_CM)) is RejectCode.NOT_OWNER
    assert _check(state, FortifyRoad(C, 99)) is RejectCode.NOT_FOUND_OR_HIDDEN
    assert _check(state, FortifyRoad(99, ROAD_CM)) is RejectCode.NOT_FOUND_OR_HIDDEN
    assert _check(state, FortifyRoad(M, 99)) is RejectCode.NOT_FOUND_OR_HIDDEN  # map first
    assert _check(state, FortifyRoad(M, ROAD_KA)) is RejectCode.NOT_OWNER  # owner before road
    state.players[0].cp = 149
    assert _check(state, FortifyRoad(C, ROAD_C17)) is RejectCode.NOT_ENOUGH_CP
    state.players[0].cp = 150
    assert _check(state, FortifyRoad(C, ROAD_C17)) is None
    assert _check(state, FortifyRoad(D, ROAD_DC)) is None  # a road both ends own, any end
    assert _check(state, FortifyRoad(C, ROAD_DC)) is None
    # A province (M own for player 1) can fortify too.
    state.players[1].cp = 500
    assert _check(state, FortifyRoad(M, ROAD_CM), player=1) is None
    mvp3 = Match(MAP, MVP3, KEY).state
    assert _check(mvp3, FortifyRoad(C, ROAD_CM), rules=MVP3) is RejectCode.FEATURE_DISABLED


def test_a_second_command_in_the_same_tick_is_already_built() -> None:
    match = _match(fort=False)
    state = match.state
    state.players[0].cp = 500
    _step(match, (0, FortifyRoad(C, ROAD_CM)), (0, FortifyRoad(C, ROAD_CM)))
    outcomes = [r.outcome for r in match.results]
    assert outcomes[0] == Ok(cost=150)
    assert outcomes[1] == Reject(RejectCode.ALREADY_BUILT)


# T12: a capture destroys ----------------------------------------------------------------------


def test_a_capture_destroys_the_fortifications_of_the_node() -> None:
    """T12: player 1 takes C with a built fortification on C-M and one being built on C-D."""
    match = _match()
    state = match.state
    state.nodes[C].road_forts[ROAD_DC] = 5000  # being built
    g = _group(state, 1, M, 4, 4)
    events = _step(match, (1, Move(g.id, C)))
    while g.location != AtNode(C):
        events += _step(match)
    assert state.nodes[C].owner == 1 and state.nodes[C].road_forts == {}
    destroyed = _kinds(events, "road_fort_destroyed")
    assert sorted(tuple(sorted(e.data)) for e in destroyed) == sorted(
        [
            (("built", True), ("edge", ROAD_CM), ("node", C), ("player", 0)),
            (("built", False), ("edge", ROAD_DC), ("node", C), ("player", 0)),
        ]
    )
    captured = next(e for e in events if e.kind == "node_captured")
    assert all(e.tick == captured.tick for e in destroyed)


# V1..V3: the view -----------------------------------------------------------------------------


def test_fog_of_a_fortification() -> None:
    """V1, V3: player 1 with a group standing in M sees the fortifications of C (built or not,
    no tick); without it nothing, also not remembered. Own ones always, with the tick."""
    match = _match()
    state = match.state
    state.nodes[C].road_forts[ROAD_DC] = 5000
    watcher = _group(state, 1, M, 1, 1)
    _step(match)
    theirs = project(state, RULES, 1, KEY)
    assert theirs.edges[ROAD_CM].forts == (RoadFortView(C, 0, True, None),)
    assert theirs.edges[ROAD_DC].forts == (RoadFortView(C, 0, False, None),)
    mine = project(state, RULES, 0, KEY)
    assert mine.edges[ROAD_CM].forts == (RoadFortView(C, 0, True, None),)
    assert mine.edges[ROAD_DC].forts == (RoadFortView(C, 0, False, 5000),)
    del state.groups[watcher.id]
    _step(match)
    theirs = project(state, RULES, 1, KEY)
    assert theirs.edges[ROAD_CM].forts == () and theirs.edges[ROAD_DC].forts == ()
    assert project(state, RULES, 0, KEY).edges[ROAD_CM].forts == mine.edges[ROAD_CM].forts


def test_the_fog_view_does_not_depend_on_hidden_fortifications() -> None:
    """AGENTS.md 4.4: without a source near C, player 1's view is the same with and without the
    fortifications of C (apart from nothing)."""
    with_forts = _match()
    with_forts.state.nodes[C].road_forts[ROAD_DC] = 5000
    without = _match(fort=False)
    _step(with_forts)
    _step(without)
    a = project(with_forts.state, RULES, 1, KEY)
    b = project(without.state, RULES, 1, KEY)
    assert a == b


def test_fog_of_the_toll() -> None:
    """V2: with a group of player 0 standing in C the owner gets ``toll_taken``; with C and its
    neighbours empty of player 0's groups only the payer gets ``toll_paid``."""
    match = _match()
    _group(match.state, 0, C, 1, 1)
    g = _group(match.state, 1, M, 3, 3)
    events = _step(match, (1, Move(g.id, C)), ticks=CROSS)
    (paid,) = _kinds(events, "toll_paid")
    (taken,) = _kinds(events, "toll_taken")
    assert dict(taken.data) == {"player": 0, "node": C, "edge": ROAD_CM, "charges": 1}
    assert paid.get("player") == 1 and taken.tick == paid.tick
    _, _, events = _attack(3, 3)
    assert len(_kinds(events, "toll_paid")) == 1 and not _kinds(events, "toll_taken")


# State and determinism ------------------------------------------------------------------------


def test_the_canonical_state_keeps_the_fortifications() -> None:
    match = _match()
    state = match.state
    state.nodes[C].road_forts[ROAD_DC] = 5000
    data = state_canonical(state)
    assert from_canonical(data) == state
    plain = _match(fort=False).state
    assert "road_forts" not in str(state_canonical(plain))


def test_the_mirrored_toll() -> None:
    """Mirror symmetry (AGENTS.md 4.1, item 6): the rot180 mirror of T2 (6/6, 2 charges) gives the
    mirrored toll to player 0."""
    mn, me = MAP.mirror_nodes, MAP.mirror_edges
    match = Match(MAP, RULES, KEY)
    state = match.state
    state.nodes[mn[M]].owner = 0
    state.nodes[mn[C]].road_forts[me[ROAD_CM]] = 0
    g = _group(state, 0, mn[M], 6, 6)
    events = _step(match, (0, Move(g.id, mn[C])), ticks=CROSS)
    (paid,) = _kinds(events, "toll_paid")
    assert (paid.get("node"), paid.get("edge"), paid.get("charges")) == (mn[C], me[ROAD_CM], 2)
    assert g.charged == 4 and paid.tick == CROSS
