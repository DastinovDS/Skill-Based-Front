"""Victory (SIM-13): VP accrual and the result by DEC-03 (mechanics.md, section 11).

Expected values are worked out by hand from DEC-03: a match is 7200 ticks; every 50 ticks each
player gets the map ``vp`` of each of its cities, a capital counts x3; capturing the enemy capital
is an instant win; at the timer more VP wins, on equal VP more cities, else a draw.

Map ``diamond`` (vp): capitals 0 and 3 are worth 1 each (x3 = 3), cities 1 and 2 are worth 2.
The DEC-03 numbers are pinned in ``DEC03``, so balance changes of ``mvp-0.toml`` do not break these
rule tests. Tick convention: step ``t`` runs with ``state.tick == t``.
"""

import dataclasses
from pathlib import Path

import pytest

from gow_sim.maps import PLAYERS, load_map
from gow_sim.ruleset import Ruleset, VictoryRules, load_ruleset
from gow_sim.state import GameState, initial_state, state_hash
from gow_sim.systems.victory import EndReason, Outcome, outcome, victory, vp_per_period

TESTS_DIR = Path(__file__).resolve().parent
MVP0 = TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml"

DEC03: Ruleset = dataclasses.replace(
    load_ruleset(MVP0),
    match_ticks=7200,
    victory=VictoryRules(vp_period_ticks=50, capital_multiplier=3),
)

MATCH_END = 7200


def fresh() -> GameState:
    return initial_state(load_map(TESTS_DIR / "maps" / "diamond.json"), DEC03)


def with_owners(owners: dict[int, int | None]) -> GameState:
    state = fresh()
    for nid, owner in owners.items():
        state.nodes[nid].owner = owner
    return state


def mirror(state: GameState) -> GameState:
    """The same position with the players swapped, through the rot180 map mirror."""
    twin = initial_state(state.map, DEC03)
    twin.tick = state.tick
    for nid, node in state.nodes.items():
        twin.nodes[state.map.mirror_nodes[nid]].owner = (
            None if node.owner is None else 1 - node.owner
        )
    for pid, player in state.players.items():
        other = twin.players[1 - pid]
        other.vp = player.vp
        other.forfeited = player.forfeited
    return twin


def flip(result: Outcome | None) -> Outcome | None:
    if result is None or result.winner is None:
        return result
    return Outcome(1 - result.winner, result.reason)


def test_vp_value_of_a_city_and_a_capital() -> None:
    state = fresh()
    # Start: each player owns only its capital, 1 vp x 3.
    assert [vp_per_period(state, DEC03, p) for p in PLAYERS] == [3, 3]


@pytest.mark.parametrize(
    ("owners", "expected"),
    [
        ({}, (3, 3)),
        ({1: 0}, (5, 3)),  # capital 3 + city 2
        ({1: 0, 2: 0}, (7, 3)),  # 3 + 2 + 2
        ({1: 0, 2: 1}, (5, 5)),
        ({1: 1, 2: 1}, (3, 7)),
        ({1: 0, 2: 0, 3: 0}, (10, 0)),  # an enemy capital counts x3 too; the match is over anyway
        ({1: None}, (3, 3)),  # a neutral city gives nothing
    ],
)
def test_vp_per_period_table(owners: dict[int, int | None], expected: tuple[int, int]) -> None:
    state = with_owners(owners)
    assert tuple(vp_per_period(state, DEC03, p) for p in PLAYERS) == expected


@pytest.mark.parametrize(
    ("tick", "gained"),
    [(1, 0), (49, 0), (50, 5), (51, 0), (100, 5), (7199, 0), (7200, 5)],
)
def test_vp_accrues_only_on_period_ticks(tick: int, gained: int) -> None:
    state = with_owners({1: 0})  # player 0: capital 3 + city 2 = 5, player 1: 3
    state.tick = tick
    events = victory(state, DEC03)
    assert state.players[0].vp == gained
    assert state.players[1].vp == (3 if gained else 0)
    assert [e.kind for e in events if e.kind == "vp_awarded"] == (
        ["vp_awarded"] * 2 if gained else []
    )


def test_a_whole_match_of_static_ownership_gives_144_periods() -> None:
    state = with_owners({1: 0})
    for t in range(1, MATCH_END + 1):
        state.tick = t
        victory(state, DEC03)
    # 7200 / 50 = 144 accruals: 144 x 5 and 144 x 3.
    assert (state.players[0].vp, state.players[1].vp) == (720, 432)


def test_no_result_before_the_timer() -> None:
    state = fresh()
    state.tick = MATCH_END - 1
    state.players[0].vp = 100
    assert outcome(state, DEC03) is None


@pytest.mark.parametrize(
    ("owners", "vp", "forfeited", "tick", "expected"),
    [
        # Instant win: the enemy capital is ours, long before the timer.
        ({3: 0}, (0, 0), (), 10, Outcome(0, EndReason.CAPITAL)),
        ({0: 1}, (0, 0), (), 10, Outcome(1, EndReason.CAPITAL)),
        # A neutral capital is not a capture by the enemy (nobody wins by it).
        ({3: None}, (0, 0), (), 10, None),
        # Forfeit: the forfeiter loses whatever the score is.
        ({}, (99, 0), (0,), 10, Outcome(1, EndReason.FORFEIT)),
        ({}, (0, 99), (1,), 10, Outcome(0, EndReason.FORFEIT)),
        # The forfeiter whose capital was also taken is still one loser: the reason is the forfeit.
        ({0: 1}, (0, 0), (0,), 10, Outcome(1, EndReason.FORFEIT)),
        # Both lose in one tick: a draw.
        ({}, (5, 0), (0, 1), 10, Outcome(None, EndReason.DOUBLE_DEFEAT)),
        ({0: 1, 3: 0}, (5, 0), (), 10, Outcome(None, EndReason.DOUBLE_DEFEAT)),
        # Timer: more VP wins.
        ({}, (10, 9), (), MATCH_END, Outcome(0, EndReason.VP)),
        ({}, (9, 10), (), MATCH_END, Outcome(1, EndReason.VP)),
        # VP beats the number of cities.
        ({1: 1, 2: 1}, (10, 9), (), MATCH_END, Outcome(0, EndReason.VP)),
        # Equal VP: more cities.
        ({1: 0}, (10, 10), (), MATCH_END, Outcome(0, EndReason.CITIES)),
        ({1: 1, 2: 1}, (10, 10), (), MATCH_END, Outcome(1, EndReason.CITIES)),
        # A neutral city is not a city of anybody: 1 vs 1 is a draw.
        ({1: None, 2: None}, (10, 10), (), MATCH_END, Outcome(None, EndReason.DRAW)),
        # Equal VP and equal cities: a draw.
        ({1: 0, 2: 1}, (10, 10), (), MATCH_END, Outcome(None, EndReason.DRAW)),
    ],
)
def test_outcome_table(
    owners: dict[int, int | None],
    vp: tuple[int, int],
    forfeited: tuple[int, ...],
    tick: int,
    expected: Outcome | None,
) -> None:
    state = with_owners(owners)
    state.tick = tick
    for pid in PLAYERS:
        state.players[pid].vp = vp[pid]
        state.players[pid].forfeited = pid in forfeited
    assert outcome(state, DEC03) == expected
    # Mirror check: the swapped position gives the swapped result (no tie-break by player).
    twin = mirror(state)
    assert outcome(twin, DEC03) == flip(expected)


def test_mirror_of_the_vp_accrual() -> None:
    state = with_owners({1: 0, 2: 0})
    twin = mirror(state)
    for s in (state, twin):
        s.tick = 50
        victory(s, DEC03)
    assert (state.players[0].vp, state.players[1].vp) == (7, 3)
    assert (twin.players[0].vp, twin.players[1].vp) == (3, 7)
    assert mirror(mirror(state)).nodes == state.nodes
    assert state_hash(mirror(mirror(state))) == state_hash(state)


def test_victory_emits_match_ended() -> None:
    state = with_owners({3: 0})
    state.tick = 10
    events = victory(state, DEC03)
    ended = [e for e in events if e.kind == "match_ended"]
    assert len(ended) == 1
    assert ended[0].get("winner") == 0
    assert ended[0].get("reason") == "capital"
    assert ended[0].tick == 10


def test_victory_emits_a_draw_without_a_winner() -> None:
    state = fresh()
    state.tick = MATCH_END
    events = victory(state, DEC03)  # tick 7200 accrues 3 + 3, equal cities: a draw
    ended = next(e for e in events if e.kind == "match_ended")
    assert ended.get("winner") is None
    assert ended.get("reason") == "draw"
    assert (state.players[0].vp, state.players[1].vp) == (3, 3)


def test_the_last_accrual_counts_for_the_timer() -> None:
    state = with_owners({1: 0})
    state.tick = MATCH_END
    state.players[0].vp = 14
    state.players[1].vp = 15  # before the accrual player 1 leads; +5 and +3 turn it around
    events = victory(state, DEC03)
    ended = next(e for e in events if e.kind == "match_ended")
    assert (state.players[0].vp, state.players[1].vp) == (19, 18)
    assert (ended.get("winner"), ended.get("reason")) == (0, "vp")
