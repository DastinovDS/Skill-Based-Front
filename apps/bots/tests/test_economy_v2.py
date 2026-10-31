"""Economy v2 in the bots (DEC-41, #648; mechanics.md, section 7, "Economy v2").

Under ``mvp-3`` the bots draw lines from their factories, build factories, pay buildings in
charges and name the bonus of every planned order; they send no command of the other economy
model. Under ``mvp-2`` (v1) they send no v2 command, so v1 play is untouched.
"""

from collections import Counter
from pathlib import Path

import pytest

from gow_bots.bots import BOTS, SmartHoarder, SmartRusher
from gow_bots.bots.base import V1_ONLY, V2_ONLY
from gow_bots.bots.campaign import Ctx
from gow_bots.bots.economy import LINE_COMMANDS
from gow_bots.bots.hoarder import W_HOARD
from gow_sim.commands import (
    BuildBunker,
    BuildFactory,
    Command,
    DrawLine,
    Move,
    Ok,
    PlayerCommand,
    ReleasePlan,
    RemoveLine,
    SetFront,
    SetMode,
    SetRearMin,
    SetStance,
    Transfer,
    UpgradeRoad,
)
from gow_sim.maps import MapDef, load_map
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.view import Mode, PlayerView, Stance

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
def mvp2() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "mvp-2.toml")


@pytest.fixture(scope="module")
def mvp3() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "mvp-3.toml")


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


def test_allowed_follows_the_economy_model(
    mvp2: Ruleset, mvp3: Ruleset, crossroads: MapDef
) -> None:
    v1 = SmartRusher(crossroads, mvp2, seed=1, player=0)
    v2 = SmartRusher(crossroads, mvp3, seed=1, player=0)
    old: list[Command] = [
        SetStance(Stance.WAR),
        SetFront(0, 1),
        SetRearMin(0),
        Transfer(1, 2, 1),
        UpgradeRoad(0),
        SetMode(1, Mode.DEFENSE),
    ]
    new: list[Command] = [BuildFactory(1), BuildBunker(1), DrawLine((1, 2)), RemoveLine(0)]
    new.append(ReleasePlan(1))
    assert all(v1.allowed(c) for c in old)
    assert not any(v1.allowed(c) for c in new)
    assert not any(v2.allowed(c) for c in old)
    assert all(v2.allowed(c) for c in new)
    assert v2.allowed(SetMode(1, Mode.ATTACK)) and v2.allowed(Move(1, 2))


def test_plan_bonus_is_the_distance_under_v1_and_the_stock_under_v2(
    mvp2: Ruleset, mvp3: Ruleset, crossroads: MapDef
) -> None:
    match = Match(crossroads, mvp3, KEY)
    view = match.view(0)
    home = crossroads.capital(0)
    stock = view.nodes[home].warehouse
    assert stock is not None and stock >= 2
    v1 = SmartRusher(crossroads, mvp2, seed=1, player=0)
    v2 = SmartRusher(crossroads, mvp3, seed=1, player=0)
    assert v1.plan_bonus(view, home, 3, 5) == mvp2.orders.planned_bonus(3, 5)
    assert v2.plan_bonus(view, home, 3, 1) == 1  # at most the charged units
    assert v2.plan_bonus(view, home, 0, 99) == stock  # at most the stock
    # A v2 planned order names its bonus; without one it is an ordinary order (DEC-41, item 10).
    assert v2.order(7, 9, True, 2) == Move(7, 9, planned=True, bonus=2)
    assert v2.order(7, 9, True, 0) == Move(7, 9)
    assert v1.order(7, 9, True, 2) == Move(7, 9, planned=True)


@pytest.mark.parametrize("name", SMART)
def test_smart_bots_play_v2(mvp3: Ruleset, crossroads: MapDef, name: str) -> None:
    sent, rejects, views = _play(crossroads, mvp3, (name, "smart_rusher"), 3000)
    assert rejects["FEATURE_DISABLED"] == 0, rejects
    assert rejects["INVALID_ARGUMENT"] == 0, rejects  # every v2 plan names a bonus >= 1
    mine = [c for p, c in sent if p == 0]
    assert any(isinstance(c, DrawLine) for c in mine)
    assert any(isinstance(c, BuildFactory) for c in mine)
    assert not any(isinstance(c, V1_ONLY) for c in mine)
    assert all(c.bonus >= 1 for c in mine if isinstance(c, Move) and c.planned)
    view = views[0]
    assert view.lines, "the bot keeps lines"
    targets = {line.path[-1]: True for line in view.lines}
    assert any(view.nodes[line.path[0]].factory for line in view.lines)
    orphans = [  # a source that lost its feed since the last decision (economy module docstring)
        line
        for line in view.lines
        if not view.nodes[line.path[0]].factory and not targets.get(line.path[0], False)
    ]
    assert len(orphans) <= LINE_COMMANDS, orphans


@pytest.mark.parametrize("names", [("smart_expander", "smart_hoarder"), ("expander", "rusher")])
def test_v1_bots_send_no_v2_command(
    mvp2: Ruleset, crossroads: MapDef, names: tuple[str, str]
) -> None:
    sent, rejects, _ = _play(crossroads, mvp2, names, 1500)
    assert rejects["FEATURE_DISABLED"] == 0, rejects
    assert not any(isinstance(c, V2_ONLY) for _, c in sent)
    assert not any(isinstance(c, Move) and c.bonus for _, c in sent)


def test_hoarder_feeds_its_hoard_first(mvp3: Ruleset, crossroads: MapDef) -> None:
    bot = SmartHoarder(crossroads, mvp3, seed=1, player=0)
    view = Match(crossroads, mvp3, KEY).view(0)
    assert bot.line_extra(Ctx(view, 0, 0)) == {bot.centre: W_HOARD}
    bot.advance = True
    assert bot.line_extra(Ctx(view, 0, 0)) == {bot.stage: W_HOARD}
