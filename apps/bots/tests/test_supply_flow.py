"""The supply flow in the bots (DEC-43, item G; #704).

Under ``mvp-4`` (``supply.model = "flow"``) the bots draw no lines, build no bunker and raise no
warehouse (all ``FEATURE_DISABLED`` there), and the campaign bots use the leaf shift by the
heuristic of ``gow_bots.bots.economy.leaf_shift_command``. Under ``mvp-3`` nothing of it is sent.
"""

from collections import Counter
from dataclasses import replace
from pathlib import Path

import pytest

from gow_bots.bots import BOTS, SmartRusher
from gow_bots.bots.base import LINES_ONLY, V1_ONLY
from gow_bots.bots.economy import LeafShift, leaf_shift_command
from gow_sim.commands import (
    BuildBunker,
    Command,
    DrawLine,
    Move,
    Ok,
    PlayerCommand,
    SetAutoLines,
    SetLeafShift,
    UpgradeWarehouse,
)
from gow_sim.maps import MapDef, load_map
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.state import Detail, Mode, Sighting
from gow_sim.view import OrderView

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
def mvp3() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "mvp-3.toml")


@pytest.fixture(scope="module")
def mvp4() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "mvp-4.toml")


@pytest.fixture(scope="module")
def crossroads() -> MapDef:
    return load_map(ROOT / "maps" / "crossroads.json")


def _play(
    mapdef: MapDef, rules: Ruleset, names: tuple[str, str], ticks: int
) -> tuple[list[tuple[int, Command]], Counter[str]]:
    """A match until ``ticks``: the commands sent (player, command) and the reject codes."""
    match = Match(mapdef, rules, KEY)
    bots = [BOTS[name](mapdef, rules, seed=2, player=p) for p, name in enumerate(names)]
    sent: list[tuple[int, Command]] = []
    rejects: Counter[str] = Counter()
    seq = 0
    while match.tick < ticks and not match.finished:
        cmds: list[PlayerCommand] = []
        if match.tick % 5 == 0:
            for p in (0, 1):
                for cmd in bots[p].decide(match.view(p), match.tick):
                    sent.append((p, cmd))
                    cmds.append(PlayerCommand(p, seq, match.resolve(p, cmd)))
                    seq += 1
        match.step(cmds)
        for r in match.results:
            if not isinstance(r.outcome, Ok):
                rejects[r.outcome.code.value] += 1
    return sent, rejects


def test_allowed_follows_the_supply_model(mvp3: Ruleset, mvp4: Ruleset, crossroads: MapDef) -> None:
    lines = SmartRusher(crossroads, mvp3, seed=1, player=0)
    flow = SmartRusher(crossroads, mvp4, seed=1, player=0)
    assert all(lines.allowed(c) for c in (DrawLine((1, 2)), SetAutoLines(False), BuildBunker(1)))
    assert not lines.allowed(SetLeafShift(1))
    assert flow.allowed(SetLeafShift(1))
    assert not any(flow.allowed(c) for c in (DrawLine((1, 2)), SetAutoLines(False), BuildBunker(1)))
    assert (type(DrawLine((1, 2))), *LINES_ONLY[1:]) == LINES_ONLY


@pytest.mark.parametrize("name", SMART)
def test_smart_bots_play_the_flow(mvp4: Ruleset, crossroads: MapDef, name: str) -> None:
    sent, rejects = _play(crossroads, mvp4, (name, "smart_rusher"), 1500)
    assert rejects["FEATURE_DISABLED"] == 0, rejects
    assert rejects["INVALID_ARGUMENT"] == 0, rejects
    mine = [c for p, c in sent if p == 0]
    assert not any(isinstance(c, (*LINES_ONLY, *V1_ONLY)) for c in mine)
    assert not any(isinstance(c, BuildBunker | UpgradeWarehouse) for c in mine)
    assert any(isinstance(c, Move) for c in mine)


@pytest.mark.parametrize("name", sorted(BOTS))
def test_every_bot_plays_mvp4_without_a_crash(mvp4: Ruleset, crossroads: MapDef, name: str) -> None:
    sent, rejects = _play(crossroads, mvp4, (name, "smart_rusher"), 600)
    if name != "random_legal":  # it tries what the view allows; the rest knows the ruleset
        assert rejects["FEATURE_DISABLED"] == 0, rejects
    assert sent


def test_no_flow_command_under_lines(mvp3: Ruleset, crossroads: MapDef) -> None:
    sent, _ = _play(crossroads, mvp3, ("smart_rusher", "smart_turtle"), 600)
    assert not any(isinstance(c, SetLeafShift) for _, c in sent)


# The heuristic of the leaf shift (DEC-43, item G) -----------------------------------------------


def _bot_and_match(rules: Ruleset, crossroads: MapDef) -> tuple[SmartRusher, Match, int, int]:
    """A bot and a match where an own leaf of player 0 touches a node of the enemy; returns the
    leaf and that enemy node."""
    match = Match(crossroads, rules, KEY)
    bot = SmartRusher(crossroads, rules, seed=1, player=0)
    state = match.state
    home = crossroads.capital(0)
    # A neutral node next to an own node and two roads or more from the capital becomes the
    # enemy's: the own node is a leaf next to the enemy, the capital behind it.
    near, enemy = next(
        (n, m)
        for n in range(len(crossroads.nodes))
        if state.nodes[n].owner == 0 and n != home
        for m in bot.neighbors[n]
        if state.nodes[m].owner is None and home not in bot.neighbors[m]
    )
    state.nodes[enemy].owner = 1
    state.tick = 5
    match.step()
    return bot, match, near, enemy


def test_leaf_shift_goes_back_when_a_leaf_faces_a_stronger_enemy(
    mvp4: Ruleset, crossroads: MapDef
) -> None:
    bot, match, leaf, enemy = _bot_and_match(mvp4, crossroads)
    view = match.view(0)
    assert view.nodes[leaf].front_dist == 0
    assert view.me.leaf_shift_max is not None and view.me.leaf_shift_max >= 1
    # Nothing seen there: the shift stays 0.
    assert leaf_shift_command(bot, view, LeafShift()) is None
    # A visible enemy of 5 charged next to the leaf (as an EXACT sighting tells it).
    sighting = Sighting(view.tick, Detail.EXACT, (Mode.ATTACK,), 5, 5)
    nodes = list(view.nodes)
    nodes[enemy] = replace(nodes[enemy], detail=Detail.EXACT, seen=sighting)
    view = replace(view, nodes=tuple(nodes))
    seen = bot.enemy_at(view, enemy)
    assert seen == (5, 5)
    assert leaf_shift_command(bot, view, LeafShift()) == SetLeafShift(1)
    # The bot attacks: back to the front.
    group = view.groups[0]
    attack = OrderView(dest=enemy, path=(enemy,), planned=False, depart_tick=view.tick)
    attacking = replace(view, groups=(replace(group, order=attack),))
    assert leaf_shift_command(bot, attacking, LeafShift()) is None  # in force: 0


def test_leaf_shift_is_none_under_lines(mvp3: Ruleset, crossroads: MapDef) -> None:
    bot = SmartRusher(crossroads, mvp3, seed=1, player=0)
    assert leaf_shift_command(bot, Match(crossroads, mvp3, KEY).view(0), LeafShift()) is None
