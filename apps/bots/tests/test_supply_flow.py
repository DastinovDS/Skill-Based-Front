"""The supply flow in the bots (DEC-43, item G; #704).

Under the supply flow every bot sends only commands the ruleset knows (no ``FEATURE_DISABLED``),
and the campaign bots use the leaf shift by the heuristic of
``gow_bots.bots.economy.leaf_shift_command``; without the lever (``supply.leaf_shift = false``,
DEC-50, ``mvp-7``) no bot sends ``SetLeafShift``.
"""

from collections import Counter
from dataclasses import replace
from pathlib import Path

import pytest

from gow_bots.bots import BOTS, SmartRusher
from gow_bots.bots.economy import LeafShift, leaf_shift_command
from gow_sim.commands import Command, Move, Ok, PlayerCommand, SetLeafShift
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
def rules() -> Ruleset:
    """Historical ``mvp-5`` on purpose: the leaf-shift lever (``supply.leaf_shift`` on) exists only
    there and in ``mvp-6``; the played ``mvp-7`` has none (DEC-50, the tests below the line)."""
    return load_ruleset(ROOT / "rulesets" / "mvp-5.toml")


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


@pytest.mark.parametrize("name", SMART)
def test_smart_bots_play_the_flow(rules: Ruleset, crossroads: MapDef, name: str) -> None:
    sent, rejects = _play(crossroads, rules, (name, "smart_rusher"), 1500)
    assert rejects["FEATURE_DISABLED"] == 0, rejects
    assert rejects["INVALID_ARGUMENT"] == 0, rejects
    mine = [c for p, c in sent if p == 0]
    assert any(isinstance(c, Move) for c in mine)


@pytest.mark.parametrize("name", sorted(BOTS))
def test_every_bot_plays_the_flow_without_a_crash(
    rules: Ruleset, crossroads: MapDef, name: str
) -> None:
    sent, rejects = _play(crossroads, rules, (name, "smart_rusher"), 600)
    if name != "random_legal":  # it tries what the view allows; the rest knows the ruleset
        assert rejects["FEATURE_DISABLED"] == 0, rejects
    assert sent


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
    rules: Ruleset, crossroads: MapDef
) -> None:
    bot, match, leaf, enemy = _bot_and_match(rules, crossroads)
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


# No lever (DEC-50, #929) -----------------------------------------------------------------------


def test_the_bots_drop_set_leaf_shift_without_the_lever(rules: Ruleset, crossroads: MapDef) -> None:
    """``Bot.allowed`` (DEC-50, item 5): ``SetLeafShift`` only while the ruleset has the lever."""
    mvp7 = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")
    assert not SmartRusher(crossroads, mvp7, seed=1, player=0).allowed(SetLeafShift(1))
    assert SmartRusher(crossroads, rules, seed=1, player=0).allowed(SetLeafShift(1))


@pytest.mark.parametrize("name", [*SMART, "smart_exploiter"])
def test_no_bot_sends_a_leaf_shift_in_mvp7(crossroads: MapDef, name: str) -> None:
    mvp7 = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")
    sent, rejects = _play(crossroads, mvp7, (name, "smart_exploiter"), 1500)
    assert not any(isinstance(c, SetLeafShift) for _, c in sent)
    assert rejects["INVALID_ARGUMENT"] == 0, rejects
