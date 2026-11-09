"""The bots under the stances (DEC-44, #772).

The plain bots have no stance policy: they stay in Balance; the smart bots have one since #881
(``test_stance_policy.py``). The bound of the enemy CP still has to hold, an enemy human may sit
in War. ``stats`` of the stance usage: ``test_stats.py``.
"""

import dataclasses
from pathlib import Path

import pytest

from gow_bots.bots import BOTS, SmartBot
from gow_bots.bots.assess import EnemyCp
from gow_sim.commands import Command, PlayerCommand, SetStance
from gow_sim.maps import MapDef, load_map
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset, Stance, load_ruleset

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))


@pytest.fixture(scope="module")
def rules() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "mvp-5.toml")


@pytest.fixture(scope="module")
def crossroads() -> MapDef:
    return load_map(ROOT / "maps" / "crossroads.json")


PLAIN = sorted(
    n for n, cls in BOTS.items() if not (isinstance(cls, type) and issubclass(cls, SmartBot))
)
"""The bots without a stance policy (#881: the smart bots have one, ``test_stance_policy.py``)."""


@pytest.mark.parametrize("name", PLAIN)
def test_every_plain_bot_stays_in_balance(rules: Ruleset, crossroads: MapDef, name: str) -> None:
    match = Match(crossroads, rules, KEY)
    bots = [BOTS[n](crossroads, rules, seed=2, player=p) for p, n in enumerate((name, name))]
    sent: list[Command] = []
    seq = 0
    while match.tick < 600 and not match.finished:
        cmds: list[PlayerCommand] = []
        if match.tick % 5 == 0:
            for p in (0, 1):
                for cmd in bots[p].decide(match.view(p), match.tick):
                    sent.append(cmd)
                    cmds.append(PlayerCommand(p, seq, match.resolve(p, cmd)))
                    seq += 1
        match.step(cmds)
    assert not any(isinstance(c, SetStance) for c in sent)
    assert all(p.stance is Stance.BALANCE for p in match.state.players.values())


def test_the_bound_of_the_enemy_cp_counts_the_fastest_stance(
    rules: Ruleset, crossroads: MapDef
) -> None:
    """War gives 1 CP per 80 ticks (DEC-44): 3 CP at the start, 4 at tick 80, 5 (the cap) at 160.
    To 5 CP from 3 at tick 0 it is two periods of 80 ticks."""
    match = Match(crossroads, rules, KEY)
    view = match.view(0)
    bound = EnemyCp(rules, 1)
    assert bound.ticks_to(500, 0) == 160
    assert bound.update(dataclasses.replace(view, tick=79)) == 300
    assert bound.update(dataclasses.replace(view, tick=80)) == 400
    assert bound.update(dataclasses.replace(view, tick=160)) == 500


def test_the_bound_holds_against_an_enemy_in_war(rules: Ruleset, crossroads: MapDef) -> None:
    match = Match(crossroads, rules, KEY)
    bound = EnemyCp(rules, 1)
    for tick in range(1, 301):
        cmds = [PlayerCommand(1, 0, SetStance(Stance.WAR))] if tick == 1 else []
        match.step(cmds)
        assert bound.update(match.view(0)) >= match.state.players[1].cp
