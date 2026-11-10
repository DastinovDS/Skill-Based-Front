"""``PlayerView.vp_gain``: the VP each player gets at the next credit (#934, for the score rail of
#930, owner decision 2026-11-10: both sides' gains).

Expected values come from DEC-03 (mechanics.md, section 11): every ``victory.vp_period_ticks``
(300) each player gets the map ``vp`` of each own city, a capital counts
``victory.capital_multiplier`` (3) times. Map ``diamond``: the capitals 0 (player 0) and 3
(player 1) are worth 1 each (x3 = 3), the neutral cities 1 and 2 are worth 2; edges 0-1, 0-2,
3-1, 3-2 take 42 ticks. The rules are ``mvp-5`` (a capture is free, DEC-38 item 10 at
``charge_cost = 0``) with the DEC-03 victory numbers pinned, as in ``test_victory.py``.

Fog (AGENTS.md 4.4): VP and ownership are public (DEC-04), so the field is the same in both
players' views, follows from the public ``NodeView.owner`` of every node and the map, and does not
move with anything hidden (the enemy's groups, CP, stance).
"""

import dataclasses
from pathlib import Path

import pytest

from gow_sim.commands import Move, Ok, PlayerCommand
from gow_sim.maps import PLAYERS, MapDef, load_map
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset, Stance, VictoryRules, load_ruleset
from gow_sim.state import AtNode, GameState, Group, Mode, initial_state
from gow_sim.view import PlayerView, project

TESTS_DIR = Path(__file__).resolve().parent
MVP5 = TESTS_DIR.parents[2] / "rulesets" / "mvp-5.toml"
DIAMOND: MapDef = load_map(TESTS_DIR / "maps" / "diamond.json")
RULES: Ruleset = dataclasses.replace(
    load_ruleset(MVP5),
    victory=VictoryRules(vp_period_ticks=300, capital_multiplier=3),
)
KEY = bytes(range(32))


def _state(owners: dict[int, int | None] | None = None) -> GameState:
    state = initial_state(DIAMOND, RULES)
    for nid, owner in (owners or {}).items():
        state.nodes[nid].owner = owner
    return state


def _views(state: GameState) -> tuple[PlayerView, PlayerView]:
    return project(state, RULES, 0, KEY), project(state, RULES, 1, KEY)


def _from_public(view: PlayerView) -> tuple[int, ...]:
    """The gains from what the view shows anyway: the owner of every node and the map."""
    gain = [0, 0]
    for n in view.nodes:
        if n.owner is None:
            continue
        node = DIAMOND.nodes[n.id]
        gain[n.owner] += node.vp * (3 if node.capital_of is not None else 1)
    return tuple(gain)


@pytest.mark.parametrize(
    ("owners", "expected"),
    [
        ({}, (3, 3)),  # each capital 1 x 3
        ({1: 0}, (5, 3)),  # capital 3 + city 2
        ({1: 0, 2: 0}, (7, 3)),  # 3 + 2 + 2
        ({1: 0, 2: 1}, (5, 5)),
        ({1: 1, 2: 1}, (3, 7)),
    ],
)
def test_the_gain_of_capitals_and_cities(
    owners: dict[int, int | None], expected: tuple[int, int]
) -> None:
    mine, theirs = _views(_state(owners))
    assert mine.vp_gain == theirs.vp_gain == expected


def test_a_capture_moves_the_gain_and_the_credit_pays_it() -> None:
    """Player 0's garrison of capital 0 (3 units) walks to the empty neutral city 1 and takes it
    on arrival (the ``arrive_tick`` of its order, long before 300): the gains go from (3, 3) to
    (5, 3), and the credit of tick 300 pays exactly that."""
    m = Match(DIAMOND, RULES, KEY)
    (group,) = (g for g in m.state.groups.values() if g.owner == 0)
    m.step([PlayerCommand(0, 0, Move(group.id, 1))])
    (result,) = m.results
    arrive = result.outcome.arrive_tick if isinstance(result.outcome, Ok) else None
    assert arrive is not None and arrive < 299
    assert m.view(0).vp_gain == m.view(1).vp_gain == (3, 3)
    while m.tick < arrive - 1:
        m.step()
    assert m.view(0).vp_gain == (3, 3)
    m.step()
    assert m.state.nodes[1].owner == 0
    assert m.view(0).vp_gain == m.view(1).vp_gain == (5, 3)
    while m.tick < 299:
        m.step()
    before = m.view(0)
    assert (before.vp, before.vp_gain) == ((0, 0), (5, 3))
    events = m.step()
    awarded = {e.get("player"): e.get("vp") for e in events if e.kind == "vp_awarded"}
    assert awarded == {0: 5, 1: 3}
    after = m.view(1)
    assert (after.vp, after.vp_gain) == ((5, 3), (5, 3))


def test_fog_the_gain_is_public_and_follows_only_from_the_ownership() -> None:
    state = _state({1: 0, 2: 1})
    mine, theirs = _views(state)
    assert mine.vp_gain == theirs.vp_gain == _from_public(mine) == _from_public(theirs) == (5, 5)
    # Nothing hidden moves it: an enemy army in the fog, the enemy's CP and stance.
    gid = state.new_id()
    state.groups[gid] = Group(gid, 1, units=9, charged=9, mode=Mode.ATTACK, location=AtNode(2))
    state.players[1].cp += 300
    state.players[1].stance = Stance.WAR
    for player in PLAYERS:
        assert project(state, RULES, player, KEY).vp_gain == (5, 5)
