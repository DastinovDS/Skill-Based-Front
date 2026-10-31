"""Economy v2, faster supply lines (DEC-41, owner decision 2026-10-31, #665).

Expected values come from mechanics.md, section 7, block "Economy v2 (DEC-41, #642)", the rules
"Suggested path" and "Auto-extension" with their tables S1-S4 and X1-X8. Map ``dec41`` as in
``test_dec41.py``: player 0 owns K = 0 (capital, a factory), A = 1, B, C, D = 2, 3, 4, E, F, G =
5, 6, 7; M = 8 a neutral province; roads K-A, A-B, B-C, A-D, A-E, B-F, B-G 30 ticks, D-C 57,
K-E 42, C-M 48. A packet takes ``travel_ticks * 100 // 150`` per road (item 8): 20 for 30 ticks,
38 for 57, 28 for 42.
"""

from dataclasses import replace
from pathlib import Path

from gow_sim.commands import (
    Command,
    Ok,
    PlayerCommand,
    Reject,
    RejectCode,
    SetAutoLines,
    apply_commands,
)
from gow_sim.maps import load_map
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.state import Event, GameState, Line, event, initial_state
from gow_sim.systems.lines import supply_lines
from gow_sim.view import line_route, project

TESTS_DIR = Path(__file__).resolve().parent
RULESETS = TESTS_DIR.parents[2] / "rulesets"
RULES = load_ruleset(RULESETS / "mvp-3.toml")
V1 = load_ruleset(RULESETS / "mvp-2.toml")
MAP = load_map(TESTS_DIR / "maps" / "dec41.json")
KEY = b"0123456789abcdef"
K, A, B, C, D, E, F, G, M = range(9)


def _state() -> GameState:
    state = initial_state(MAP, RULES)
    state.tick = 1  # off the dispatch ticks: only the line checks run
    return state


def _cmd(state: GameState, cmd: Command, rules: Ruleset = RULES) -> Ok | Reject:
    results, _ = apply_commands(state, rules, [PlayerCommand(0, 0, cmd)])
    return results[0].outcome


def _lines(state: GameState, *paths: tuple[int, ...], player: int = 0) -> None:
    ps = state.players[player]
    for path in paths:
        ps.lines[ps.next_line] = Line(ps.next_line, path)
        ps.next_line += 1


def _capture(state: GameState, *nodes: int, player: int = 0) -> list[Event]:
    """``nodes`` change to ``player`` in this tick (as movement and combat do), then supply."""
    for n in nodes:
        state.nodes[n].owner = player
    state.events = [event(state.tick, "node_captured", node=n, player=player) for n in nodes]
    return supply_lines(state, RULES)


def _paths(state: GameState, player: int = 0) -> list[tuple[int, ...]]:
    lines = state.players[player].lines
    return [lines[k].path for k in sorted(lines)]


def _auto(events: list[Event]) -> list[tuple[object, object, object]]:
    return [
        (e.get("line"), e.get("from_node"), e.get("to_node"))
        for e in events
        if e.kind == "line_auto"
    ]


# The toggle ------------------------------------------------------------------------------------


def test_the_flag_turns_the_toggle_on_at_the_start() -> None:
    state = initial_state(MAP, RULES)
    assert RULES.line_rules().auto_extend
    assert [state.players[p].auto_lines for p in (0, 1)] == [True, True]
    assert not any(p.auto_lines for p in initial_state(MAP, V1).players.values())


def test_set_auto_lines() -> None:
    """X6: the toggle is free and per player; the same value is ``NO_CHANGE``; v1 has none."""
    state = _state()
    cp = state.players[0].cp
    assert _code(_cmd(state, SetAutoLines(True))) is RejectCode.NO_CHANGE
    assert isinstance(_cmd(state, SetAutoLines(False)), Ok)
    assert not state.players[0].auto_lines
    assert state.players[1].auto_lines
    assert state.players[0].cp == cp
    v1 = initial_state(MAP, V1)
    assert _code(_cmd(v1, SetAutoLines(True), rules=V1)) is RejectCode.FEATURE_DISABLED


def _code(outcome: Ok | Reject) -> RejectCode | None:
    return outcome.code if isinstance(outcome, Reject) else None


# Auto-extension --------------------------------------------------------------------------------


def _front() -> GameState:
    """K -> A -> B drawn; C was lost (neutral) and is taken back."""
    state = _state()
    state.nodes[C].owner = None
    _lines(state, (K, A), (A, B))
    return state


def test_x1_the_line_next_to_the_city_extends_to_it() -> None:
    state = _front()
    events = _capture(state, C)
    assert _paths(state) == [(K, A), (A, B), (B, C)]  # B: 20 ticks, A: 40, K: 60
    assert _auto(events) == [(2, B, C)]
    assert state.players[0].next_line == 3


def test_x2_the_nearest_source_with_room_by_ticks() -> None:
    """B has ``lines.max_out`` lines; D (38 ticks over D-C) beats A (40 over A-B-C)."""
    state = _front()
    _lines(state, (B, F), (B, G), (B, A, D))
    _capture(state, C)
    assert _paths(state)[-1] == (D, C)


def test_x3_the_toggle_off_draws_nothing() -> None:
    state = _front()
    state.players[0].auto_lines = False
    assert _auto(_capture(state, C)) == []
    assert _paths(state) == [(K, A), (A, B)]


def test_x4_no_source_next_to_the_city() -> None:
    """With ``auto_extend_ticks = 50`` the nearest sources K and E are 60 ticks away."""
    rules = replace(RULES, lines=replace(RULES.line_rules(), auto_extend_ticks=50))
    state = _state()
    state.nodes[C].owner = None
    _lines(state, (K, E))
    state.nodes[C].owner = 0
    state.events = [event(1, "node_captured", node=C, player=0)]
    assert _auto(supply_lines(state, rules)) == []
    assert _paths(state) == [(K, E)]


def test_x8_a_new_line_from_the_factory() -> None:
    """No lines at all: the capital K, a factory, starts one along K-A-B-C (60 ticks)."""
    state = _state()
    state.nodes[C].owner = None
    assert _auto(_capture(state, C)) == [(0, K, C)]
    assert _paths(state) == [(K, A, B, C)]


def test_x5_a_province_is_not_joined() -> None:
    state = _front()
    _capture(state, C)
    assert _auto(_capture(state, M)) == []


def test_x7_two_captures_of_one_tick_go_in_node_key_order() -> None:
    """C first (the smaller ``node_key``) from B; then D from A (20 ticks; C, just joined and
    so a source, takes 38)."""
    state = _front()
    state.nodes[D].owner = None
    _capture(state, D, C)
    assert _paths(state)[2:] == [(B, C), (A, D)]


def test_the_players_are_symmetric() -> None:
    """The mirror of X1 for player 1 gives the mirrored line (4.1, rule 6)."""
    mirror = MAP.mirror_nodes
    state = _state()
    for player in (0, 1):
        n = C if player == 0 else mirror[C]
        state.nodes[n].owner = None
    _lines(state, (K, A), (A, B))
    _lines(state, *(tuple(mirror[n] for n in p) for p in ((K, A), (A, B))), player=1)
    for n, player in ((C, 0), (mirror[C], 1)):
        state.nodes[n].owner = player
    state.events = [
        event(1, "node_captured", node=C, player=0),
        event(1, "node_captured", node=mirror[C], player=1),
    ]
    supply_lines(state, RULES)
    assert _paths(state, 1)[-1] == tuple(mirror[n] for n in _paths(state, 0)[-1])


def test_the_enemy_toggle_is_not_in_a_view() -> None:
    state = _state()
    before = project(state, RULES, 0, KEY)
    assert before.me.auto_lines is True
    state.players[1].auto_lines = False
    assert project(state, RULES, 0, KEY) == before
    assert project(initial_state(MAP, V1), V1, 0, KEY).me.auto_lines is None


# The suggested path ----------------------------------------------------------------------------


def test_s1_the_fastest_own_path() -> None:
    state = _state()
    assert line_route(state, RULES, 0, (K, C)) == (K, A, B, C)  # 60 ticks; K-A-D-C takes 78


def test_s2_through_a_point() -> None:
    state = _state()
    assert line_route(state, RULES, 0, (K, D, C)) == (K, A, D, C)


def test_s3_the_legs_do_not_cross() -> None:
    """The leg to G passes B; the leg from G to C may not use B again: no way, no path."""
    state = _state()
    assert line_route(state, RULES, 0, (A, G, C)) == ()
    assert line_route(state, RULES, 0, (A, G)) == (A, B, G)


def test_s4_only_own_points_and_nodes() -> None:
    state = _state()
    enemy = MAP.mirror_nodes[C]
    assert line_route(state, RULES, 0, (K, enemy)) == ()
    assert line_route(state, RULES, 0, (K,)) == ()
    assert line_route(state, RULES, 0, (K, C, K)) == ()
    assert line_route(state, RULES, 0, (K, 999)) == ()
    state.nodes[B].owner = None
    assert line_route(state, RULES, 0, (K, C)) == (K, A, D, C)  # around the lost node
    for n in line_route(state, RULES, 0, (K, C)):
        assert state.nodes[n].owner == 0
