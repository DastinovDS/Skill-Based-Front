"""The economy of the bots (DEC-41, #648; mechanics.md, section 7): factories, buildings paid in
charges and the bonus of every planned order (DEC-41, item 10), under ``mvp-7``.
"""

from collections import Counter
from pathlib import Path

import pytest

from gow_bots.bots import BOTS, RusherBot, SmartRusher
from gow_sim.commands import (
    BuildFactory,
    Command,
    Move,
    Ok,
    PlayerCommand,
    SetStance,
)
from gow_sim.maps import MapDef, load_map
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.view import PlayerView, Stance

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))
SMART = (
    "smart_expander",
    "smart_hoarder",
    "smart_reactive",
    "smart_rusher",
    "smart_strangler",
    "smart_turtle",
)


@pytest.fixture(scope="module")
def rules() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "mvp-7.toml")


@pytest.fixture(scope="module")
def crossroads() -> MapDef:
    return load_map(ROOT / "maps" / "crossroads.json")


def _play(
    mapdef: MapDef, rules: Ruleset, names: tuple[str, str], ticks: int
) -> tuple[list[tuple[int, Command]], Counter[str], list[PlayerView]]:
    """A match until ``ticks``: the commands sent (player, command), the reject codes and the
    last view of each player."""
    match = Match(mapdef, rules, KEY)
    bots = [BOTS[name](mapdef, rules, seed=2, player=p) for p, name in enumerate(names)]
    sent: list[tuple[int, Command]] = []
    rejects: Counter[str] = Counter()
    seq = 0
    while match.tick < ticks and not match.finished:
        cmds: list[PlayerCommand] = []
        if match.tick % 5 == 0:
            for p in (0, 1):
                view = match.view(p)
                for cmd in bots[p].decide(view, match.tick):
                    sent.append((p, cmd))
                    cmds.append(PlayerCommand(p, seq, match.resolve(p, cmd)))
                    seq += 1
        match.step(cmds)
        for r in match.results:
            if not isinstance(r.outcome, Ok):
                rejects[r.outcome.code.value] += 1
    return sent, rejects, [match.view(0), match.view(1)]


def test_only_a_stance_policy_sends_a_stance(rules: Ruleset, crossroads: MapDef) -> None:
    smart = SmartRusher(crossroads, rules, seed=1, player=0)
    plain = RusherBot(crossroads, rules, seed=1, player=0)
    assert smart.allowed(SetStance(Stance.WAR))  # the policy of #881 (DEC-44)
    assert not plain.allowed(SetStance(Stance.WAR))
    assert plain.allowed(BuildFactory(1)) and plain.allowed(Move(1, 2))


def test_plan_bonus_is_the_stock_of_the_node(rules: Ruleset, crossroads: MapDef) -> None:
    match = Match(crossroads, rules, KEY)
    view = match.view(0)
    home = crossroads.capital(0)
    stock = view.nodes[home].warehouse
    assert stock is not None and stock >= 2
    bot = SmartRusher(crossroads, rules, seed=1, player=0)
    assert bot.plan_bonus(view, home, 1) == 1  # at most the charged units
    assert bot.plan_bonus(view, home, 99) == stock  # at most the stock
    # A planned order names its bonus; without one it is an ordinary order (DEC-41, item 10).
    assert bot.order(7, 9, True, 2) == Move(7, 9, planned=True, bonus=2)
    assert bot.order(7, 9, True, 0) == Move(7, 9)
    assert bot.order(7, 9, False, 2) == Move(7, 9)


@pytest.mark.parametrize("name", SMART)
def test_smart_bots_build_factories_and_name_their_plans(
    rules: Ruleset, crossroads: MapDef, name: str
) -> None:
    sent, rejects, _ = _play(crossroads, rules, (name, "smart_rusher"), 1500)
    assert rejects["INVALID_ARGUMENT"] == 0, rejects  # every plan names a bonus >= 1
    mine = [c for p, c in sent if p == 0]
    assert any(isinstance(c, BuildFactory) for c in mine)
    assert all(c.bonus >= 1 for c in mine if isinstance(c, Move) and c.planned)
