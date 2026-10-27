"""DEC-31 (#319): the barracks of an enemy city next to an own node are seen, example by example.

Expected values are the table of worked examples of DEC-31 (mechanics.md, section 10) and its
"Details": ruleset ``mvp-1`` (``city_upgrades.enabled = true``), the view is player 0's.

Map ``dec22``: K = 0 (capital of 0) - A = 1 - M = 2 - E = 5 - F = 6 - 7 (capital of 1), the
province P = 3 at A and the province Q = 4 at F. Player 0 owns K, A and M, player 1 owns E, F and
its capital; P and Q are neutral unless a test gives them away.
"""

import dataclasses
from pathlib import Path

from gow_sim.commands import BuildBarracks, Command, PlayerCommand
from gow_sim.maps import load_map
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.state import Build
from gow_sim.view import BuildKind, NodeView

TESTS_DIR = Path(__file__).resolve().parent
MVP1 = load_ruleset(TESTS_DIR.parents[2] / "rulesets" / "mvp-1.toml")
OFF = dataclasses.replace(
    MVP1, city_upgrades=dataclasses.replace(MVP1.city_upgrades, enabled=False)
)
K, A, M, P, Q, E, F, ENEMY_CAPITAL = 0, 1, 2, 3, 4, 5, 6, 7


def _match(rules: Ruleset = MVP1) -> Match:
    match = Match(load_map(TESTS_DIR / "maps" / "dec22.json"), rules, bytes(range(32)))
    state = match.state
    state.nodes[M].owner, state.nodes[E].owner = 0, 1
    return match


def _step(match: Match, player: int, *cmds: Command) -> None:
    match.step([PlayerCommand(player, i, cmd) for i, cmd in enumerate(cmds)])


def _hidden_city_fields(node: NodeView) -> tuple[object, ...]:
    """Fields of an enemy city that DEC-31 keeps hidden (DEC-25, item 12; DEC-26, item 10)."""
    return (
        node.warehouse_level,
        node.warehouse_cap,
        node.building,
        node.recruit_queue,
        node.recruit_progress,
        node.recruit_waiting,
    )


def test_example_1_built_barracks_of_a_neighbour_are_seen() -> None:
    match = _match()
    match.state.nodes[E].has_barracks = True
    e = match.view(0).nodes[E]
    assert e.has_barracks is True
    assert _hidden_city_fields(e) == (None,) * 6


def test_example_2_a_barracks_build_shows_false_and_nothing_else() -> None:
    """Example 2, then the build ends: ``True`` from the tick the barracks stand (example 1)."""
    match = _match()
    match.state.players[1].cp = MVP1.orders.cost.barracks
    match.state.nodes[E].recruit_queue = 2  # the enemy's queue stays hidden as well
    assert match.view(0).nodes[E].has_barracks is False  # no barracks yet
    _step(match, 1, BuildBarracks(E))
    assert match.state.nodes[E].build is not None  # the build has started
    building = match.view(0).nodes[E]
    assert building.has_barracks is False
    assert _hidden_city_fields(building) == (None,) * 6
    while match.state.nodes[E].build is not None:
        _step(match, 0)
    assert match.state.nodes[E].has_barracks
    assert match.view(0).nodes[E].has_barracks is True


def test_example_3_an_enemy_city_one_node_further_is_unknown() -> None:
    """F has barracks, but between F and the nearest own node M stands E: no edge F-own node."""
    match = _match()
    match.state.nodes[F].has_barracks = True
    view = match.view(0)
    assert view.nodes[F].has_barracks is None
    assert view.nodes[ENEMY_CAPITAL].has_barracks is None  # the capital always has them


def test_example_4_an_own_province_is_a_source_of_the_neighbourhood() -> None:
    match = _match()
    match.state.nodes[Q].owner = 0  # F's only own neighbour is the province Q
    match.state.nodes[F].has_barracks = True
    f = match.view(0).nodes[F]
    assert f.has_barracks is True
    assert _hidden_city_fields(f) == (None,) * 6


def test_example_5_no_memory_once_the_own_neighbour_is_lost() -> None:
    match = _match()
    match.state.nodes[E].has_barracks = True
    assert match.view(0).nodes[E].has_barracks is True
    match.state.nodes[M].owner = 1  # M captured: E has no own neighbour any more
    assert match.view(0).nodes[E].has_barracks is None


def test_a_neutral_city_next_to_an_own_node_stays_unknown() -> None:
    """Details: neutral cities are ``None`` (they have no barracks)."""
    match = _match()
    match.state.nodes[M].owner = None  # neutral M next to the own A
    assert match.view(0).nodes[M].has_barracks is None


def test_without_city_upgrades_a_neighbour_shows_true() -> None:
    """Details: with ``city_upgrades.enabled = false`` every city has the barracks (DEC-26,
    item 1), so the enemy city next to an own node shows ``True``."""
    match = _match(OFF)
    view = match.view(0)
    assert view.nodes[E].has_barracks is True
    assert view.nodes[F].has_barracks is None


def test_the_enemy_sees_the_mirror() -> None:
    """Both players by one rule: player 1 sees M's barracks the same way."""
    match = _match()
    state = match.state
    state.nodes[M].has_barracks = True
    state.nodes[A].has_barracks = True
    state.nodes[A].build = Build(None, 0, 0, BuildKind.WAREHOUSE)
    view = match.view(1)
    assert view.nodes[M].has_barracks is True
    assert view.nodes[A].has_barracks is None  # A is not next to a node of player 1
    assert _hidden_city_fields(view.nodes[M]) == (None,) * 6
