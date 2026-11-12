"""An open enemy capital is taken at once (the owner's rule of 2026-11-12, #1019; ``capital``).

The capture of the enemy capital ends the match (mechanics.md, section 11; DEC-38 rows 22 and
23: it costs a real charge like any capture). Every bot, each smart personality at each level and
the plain ones, orders a group that reaches it and pays for it into it within its reaction time:
the think interval of its level (``tempo``), a decision every 5 ticks for the bots without one.
A discharged group never walks in: it would bounce (DEC-38, row 6) or die against a garrison
(DEC-07, rule 4).

The position is the map ``dec41`` (21 nodes, plains everywhere, so a neighbour sees a node
exactly, DEC-21) under ``mvp-7``, in the frame of the bot under test: its capital is 0, the enemy
capital 16, whose neighbours are 15 (the bot's) and 11 (the enemy's). The bot holds its half and
15; the enemy holds 16, 14, 11, 10 and 9. Its charged army stands in 2, five roads from 16 through
3, 17, 12 and 15 (``radius`` is 2 to 4 for every bot), a discharged pair in 15 next to the enemy
capital, its guard in its own capital. Player 1 plays the mirror nodes (``MapDef.node_key``).
"""

from collections.abc import Sequence
from pathlib import Path
from typing import Final

import pytest

from gow_bots.bots import BOTS, DIFFICULTIES, Bot, SmartBot, bot_factory
from gow_bots.bots.capital import open_need
from gow_sim.commands import Move, PlayerCommand
from gow_sim.maps import load_map
from gow_sim.match import Match
from gow_sim.ruleset import load_ruleset
from gow_sim.state import AtNode, Group, Mode
from gow_sim.systems.capacity import change_owner
from gow_sim.systems.flow import update_flow
from gow_sim.systems.victory import EndReason

ROOT: Final = Path(__file__).resolve().parents[3]
KEY: Final = bytes(range(32))
MAP: Final = load_map(ROOT / "packages" / "sim" / "tests" / "maps" / "dec41.json")
RULES: Final = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")
TICK: Final = 2000
HOME, TARGET, ARMY, NEXT = 0, 16, 2, 15
"""The bot's capital, the enemy capital, the node of the charged army, the node next to 16."""
OWN: Final = (0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 13, 15, 17, 18, 19, 20)
FOE: Final = (9, 10, 11, 14, 16)
ME, THEM = 0, 1

SMART: Final = tuple(
    f"{name}@{level}"
    for name in sorted(n for n in BOTS if n.startswith("smart_") and n != "smart_hoarder")
    if name != "smart_exploiter"
    for level in DIFFICULTIES
)
PLAIN: Final = ("rusher", "strangler", "reactive", "expander", "turtle", "random_legal")
BENCH: Final = ("smart_exploiter", "smart_hoarder", "owner_style")
ALL: Final = (*SMART, *BENCH, *PLAIN)


def _at(player: int, node: int) -> int:
    return MAP.node_key(player, node)


def _scenario(player: int, groups: Sequence[tuple[int, int, int, int]]) -> Match:
    """``dec41`` at ``TICK``: ``OWN`` is the bot's, ``FOE`` the enemy's; ``groups`` are ``(side,
    node, units, charged)``, the start garrisons removed; 3 CP each."""
    match = Match(MAP, RULES, KEY)
    state = match.state
    state.groups.clear()
    state.tick = TICK
    for node in range(len(MAP.nodes)):
        owner = player if node in OWN else 1 - player if node in FOE else None
        change_owner(state, _at(player, node), owner)
    for side, node, units, charged in groups:
        gid = state.new_id()
        owner = player if side == ME else 1 - player
        state.groups[gid] = Group(
            gid, owner, units, charged, Mode.ATTACK, AtNode(_at(player, node))
        )
    for p in state.players.values():
        p.cp = 300
    update_flow(state, RULES)
    return match


def _window(name: str) -> int:
    """Ticks within which the bot orders the capture: its think interval (``tempo``; the owner
    and the enemy seen in a node reach a decision at once, the reaction delay is for strikes and
    figures), one call of every 5 ticks for a bot without a tempo."""
    base, _, level = name.partition("@")
    if not base.startswith("smart_"):
        return 5
    return DIFFICULTIES[level or "hard"].think_ticks


def _play(match: Match, bot: Bot, player: int, ticks: int) -> tuple[list[int], list[int]]:
    """``ticks`` ticks, the bot decides every 5, the enemy does nothing. Returns the charges of
    every group the bot ordered into the enemy capital (at the order) and the ticks of those
    orders."""
    target = _at(player, TARGET)
    charged: list[int] = []
    when: list[int] = []
    seq = 0
    end = match.tick + ticks
    while match.tick < end and not match.finished:
        cmds: list[PlayerCommand] = []
        if match.tick % 5 == 0:
            view = match.view(player)
            groups = {g.id: g for g in view.groups}
            for cmd in bot.decide(view, match.tick):
                if isinstance(cmd, Move) and cmd.dest == target and cmd.group in groups:
                    charged.append(groups[cmd.group].charged)
                    when.append(match.tick)
                cmds.append(PlayerCommand(player, seq, match.resolve(player, cmd)))
                seq += 1
        events = match.step(cmds)
        assert not [e for e in events if e.kind == "capture_failed" and e.get("player") == player]
    return charged, when


def _bot(name: str, player: int) -> Bot:
    bot = bot_factory(name)(MAP, RULES, seed=0, player=player)
    assert isinstance(bot, Bot)
    return bot


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", ALL)
def test_an_empty_enemy_capital_is_ordered_at_once(name: str, player: int) -> None:
    """16 is empty and seen (the pair in 15 is a vision source next to it, DEC-35): the army of
    3/3 in 2 is ordered into it within the reaction window, the discharged pair in 15 never."""
    match = _scenario(player, [(ME, HOME, 2, 2), (ME, ARMY, 3, 3), (ME, NEXT, 2, 0)])
    bot = _bot(name, player)
    view = match.view(player)
    assert open_need(bot, view, TICK) == 0
    charged, when = _play(match, bot, player, _window(name))
    assert when, "no order into the open capital"
    assert all(c >= RULES.capture.charge_cost for c in charged)


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", ALL)
def test_a_weakly_held_enemy_capital_is_ordered_at_once(name: str, player: int) -> None:
    """16 holds one discharged unit, seen exactly from 15: it falls to 1 shot (DEC-07, rule 3:
    ``Qa >= Qd + units`` with ``Qd = 0``), so the 3/3 army takes it and keeps 2 charges, one of
    which pays the capture (DEC-38, row 14 shape). It is ordered within the reaction window."""
    groups = [(ME, HOME, 2, 2), (ME, ARMY, 3, 3), (ME, NEXT, 2, 0), (THEM, TARGET, 1, 0)]
    match = _scenario(player, groups)
    bot = _bot(name, player)
    assert open_need(bot, match.view(player), TICK) == 1
    charged, when = _play(match, bot, player, _window(name))
    assert when, "no order into the weakly held capital"
    assert all(c >= 2 for c in charged)  # 1 shot for the unit, 1 charge for the capture


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", ALL)
def test_discharged_groups_do_not_walk_into_the_open_capital(name: str, player: int) -> None:
    """Only discharged groups (the pair in 15, two in the capital): no group is ordered into 16
    without the charge that pays the capture (DEC-38, rows 2 and 6) and no capture fails, for as
    long as the flow takes to bring a charge to one of them; one that got its charge may go."""
    match = _scenario(player, [(ME, HOME, 2, 0), (ME, NEXT, 2, 0)])
    charged, _ = _play(match, _bot(name, player), player, 300)
    assert all(c >= RULES.capture.charge_cost for c in charged)


@pytest.mark.parametrize("name", ALL)
def test_the_open_capital_is_taken(name: str) -> None:
    """The order of the empty case ends the match: the army walks the five roads and takes the
    capital (an instant win, mechanics.md, section 11) well within 1000 ticks."""
    match = _scenario(ME, [(ME, HOME, 2, 2), (ME, ARMY, 3, 3), (ME, NEXT, 2, 0)])
    _play(match, _bot(name, ME), ME, 1000)
    assert match.outcome is not None
    assert match.outcome.winner == ME
    assert match.outcome.reason is EndReason.CAPITAL


@pytest.mark.parametrize("name", [n for n in SMART if not n.endswith("@hard")])
def test_an_empty_apm_bucket_does_not_stop_the_capture(name: str) -> None:
    """A slow level whose APM bucket is empty (``tempo.Bucket``) does not decide, but while it
    saw the enemy capital at its last look it looks again every think interval (``peek``): the
    empty capital is ordered at the next look, past the bucket, and nothing else is sent."""
    match = _scenario(ME, [(ME, HOME, 2, 2), (ME, ARMY, 3, 3), (ME, NEXT, 2, 0)])
    bot = _bot(name, ME)
    assert isinstance(bot, SmartBot)
    think = bot.tempo.think_ticks
    bot.thought = TICK - think
    bot.watching = True
    bot.bucket.refill(TICK)
    bot.bucket.tokens = 0
    assert not bot.bucket.ready()
    view = match.view(ME)
    cmds = bot.decide(view, TICK)
    army = next(g.id for g in view.groups if g.location == AtNode(_at(ME, ARMY)))
    assert cmds == [Move(army, _at(ME, TARGET))]
    assert bot.thought == TICK - think  # a look, not a decision
