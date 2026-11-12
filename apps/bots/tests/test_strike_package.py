"""The strike package, squads and the combined attack of the smart bots (#1023, item 28 of
``gow_bots.bots.smart``; the owner's recipe of 2026-11-12).

The position is the map ``dec41`` (21 nodes, plains everywhere: a neighbour sees a node exactly,
DEC-21; a plains defender loses a charge to the burn of the first round, DEC-45) under ``mvp-7``,
in the frame of the bot under test: its capital is 0; it holds its half and 12 and 15; the enemy
holds 9, 10, 11, 14 and 16 (its capital). 15 touches 14, 11 and 16; 12 touches 13 (neutral here)
and 15. Player 1 plays the mirror nodes (``MapDef.node_key``). The enemy capital and 11 hold a
garrison no group of the bot takes, so the target under test is 14.
"""

from collections.abc import Sequence
from pathlib import Path
from typing import Final

import pytest

from gow_bots.bots import Bot, SmartBot, bot_factory
from gow_bots.bots.base import ParamRange
from gow_sim.commands import Command, GroupMove, Move, Split
from gow_sim.maps import load_map
from gow_sim.match import Match
from gow_sim.ruleset import load_ruleset
from gow_sim.state import AtNode, Group, Mode
from gow_sim.systems.capacity import change_owner
from gow_sim.systems.flow import update_flow
from gow_sim.view import PlayerView

ROOT: Final = Path(__file__).resolve().parents[3]
KEY: Final = bytes(range(32))
MAP: Final = load_map(ROOT / "packages" / "sim" / "tests" / "maps" / "dec41.json")
RULES: Final = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")
TICK: Final = 2000
OWN: Final = (0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 15, 17, 18, 19, 20)
FOE: Final = (9, 10, 11, 14, 16)
ME, THEM = 0, 1
TARGET: Final = 14
STRONG: Final = ((THEM, 16, 8, 8), (THEM, 11, 6, 6), (ME, 0, 2, 2))
"""The enemy capital and 11 out of reach of any attack, the own capital guarded."""
HARD: Final = ("smart_strangler@hard", "smart_rusher@hard")
"""Personalities whose ``radius`` reaches 14 from 15 and 12 and whose ``margin`` lets a 3/3 squad
take it (the turtle keeps to its half, the expander demands 2 to 3 shots more)."""
NO_SCOUT: Final = {"scouts": ParamRange(0, 0)}
"""No scout keeps the squad in 15 (item 7 of ``smart``): the front node is not watched here."""
NO_MARGIN: Final = {**NO_SCOUT, "margin": ParamRange(0, 0), "secure_margin": ParamRange(0, 0)}


def _at(player: int, node: int) -> int:
    return MAP.node_key(player, node)


def _scenario(
    player: int, groups: Sequence[tuple[int, int, int, int]], stock: dict[int, int]
) -> Match:
    """``dec41`` at ``TICK`` (module docstring); ``groups`` are ``(side, node, units, charged)``,
    the start garrisons removed; ``stock``: own node to its warehouse; 3 CP each."""
    match = Match(MAP, RULES, KEY)
    state = match.state
    state.groups.clear()
    state.tick = TICK
    for node in range(len(MAP.nodes)):
        owner = player if node in OWN else 1 - player if node in FOE else None
        change_owner(state, _at(player, node), owner)
        state.nodes[_at(player, node)].warehouse = stock.get(node, 0)
    for side, node, units, charged in (*STRONG, *groups):
        gid = state.new_id()
        owner = player if side == ME else 1 - player
        state.groups[gid] = Group(
            gid, owner, units, charged, Mode.ATTACK, AtNode(_at(player, node))
        )
    for p in state.players.values():
        p.cp = 300
    update_flow(state, RULES)
    return match


def _bot(name: str, player: int, *, no_margin: bool = False) -> SmartBot:
    bot = bot_factory(name, NO_MARGIN if no_margin else NO_SCOUT)(MAP, RULES, seed=0, player=player)
    assert isinstance(bot, SmartBot)
    return bot


def _decide(bot: Bot, view: PlayerView) -> list[Command]:
    return bot.decide(view, TICK)


def _group_at(view: PlayerView, node: int) -> int:
    return next(g.id for g in view.groups if g.location == AtNode(node))


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", HARD)
def test_a_defended_node_gets_the_full_bonus(name: str, player: int) -> None:
    """A 3/3 squad in 15 with 3 charges in its warehouse against 14 held by 1 unit with 1
    charge: the plain charges would take it (the burn takes the charge, DEC-45: 1 shot and the
    capture charge), but the package plans the full bonus of 3 the warehouse holds (DEC-41, item
    10), not the 1 shot an ordinary order would miss."""
    match = _scenario(player, [(ME, 15, 3, 3), (THEM, TARGET, 1, 1)], {15: 3})
    view = match.view(player)
    cmds = _decide(_bot(name, player), view)
    target = _at(player, TARGET)
    sent = [c for c in cmds if isinstance(c, Move) and c.dest == target]
    assert sent == [Move(_group_at(view, _at(player, 15)), target, planned=True, bonus=3)]


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", HARD)
def test_a_walk_in_stays_an_ordinary_order(name: str, player: int) -> None:
    """14 is empty: a capture without a fight (DEC-38: the capture charge only), so the bonus
    would never fire; the squad in 15 walks in by an ordinary order, whatever its warehouse
    holds."""
    match = _scenario(player, [(ME, 15, 3, 3)], {15: 3})
    view = match.view(player)
    cmds = _decide(_bot(name, player), view)
    target = _at(player, TARGET)
    sent = [c for c in cmds if isinstance(c, Move | GroupMove) and c.dest == target]
    assert sent == [Move(_group_at(view, _at(player, 15)), target)]


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", HARD)
def test_no_attack_short_of_the_capture_charge(name: str, player: int) -> None:
    """A 2/2 pair in 15 with an empty warehouse against 14 held by 1 unit with 2 charges: the
    burn leaves 1 (DEC-45), so 2 shots kill the defender and nothing is left for the capture
    (DEC-38): it would bounce. No group goes into 14."""
    match = _scenario(player, [(ME, 15, 2, 2), (THEM, TARGET, 1, 2)], {})
    cmds = _decide(_bot(name, player, no_margin=True), match.view(player))
    target = _at(player, TARGET)
    assert not [c for c in cmds if isinstance(c, Move | GroupMove) and c.dest == target]


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", HARD)
def test_two_squads_strike_together(name: str, player: int) -> None:
    """14 holds 2 units with 2 charges: 1 left after the burn (DEC-45), 3 shots and the capture
    charge take it: 4 real charges (no ``margin`` here, no bonus to gather). Neither the 3/3
    squad in 15 nor the 3/3 squad in 13 (the bot's here) takes it alone; together they do. One
    ``GroupMove`` sends both (DEC-48: a synchronized arrival), ordinary since no warehouse holds
    a bonus."""
    groups = [(ME, 15, 3, 3), (ME, 13, 3, 3), (THEM, TARGET, 2, 2)]
    match = _scenario(player, groups, {})
    change_owner(match.state, _at(player, 13), player)
    update_flow(match.state, RULES)
    view = match.view(player)
    cmds = _decide(_bot(name, player, no_margin=True), view)
    target = _at(player, TARGET)
    sent = [c for c in cmds if isinstance(c, Move | GroupMove) and c.dest == target]
    a, b = _group_at(view, _at(player, 15)), _group_at(view, _at(player, 13))
    assert len(sent) == 1
    cmd = sent[0]
    assert isinstance(cmd, GroupMove)
    assert sorted(cmd.groups) == sorted((a, b))
    assert not cmd.planned


def test_without_the_group_order_no_group_move() -> None:
    """Under a ruleset without ``[group_order]`` (``mvp-6``) the combined attack is off: no
    ``GroupMove`` is ever sent (it would be rejected)."""
    rules = load_ruleset(ROOT / "rulesets" / "mvp-6.toml")
    assert rules.group_order is None
    bot = bot_factory("smart_strangler@hard")(MAP, rules, seed=0, player=ME)
    assert isinstance(bot, SmartBot)
    assert not bot.combining()


@pytest.mark.parametrize("player", [0, 1])
def test_a_settled_capital_splits_off_a_whole_squad(player: int) -> None:
    """On a settled map (item 18: one neutral node of 21) the capital with 7 units and a guard of
    2 splits off one whole squad of 3 (a province's capacity, DEC-22) a decision, not the whole
    spare of 5 (too big for a province, the stack limit of DEC-20); a spare of 2 below a squad
    does not stand idle either: it rallies to the front (the owner's "use every unit")."""
    for units, want in ((7, [3]), (4, [2])):
        match = _scenario(player, [(ME, 0, units, units)], {})
        match.state.groups = {
            gid: g
            for gid, g in match.state.groups.items()
            if not (g.owner == player and g.units == 2)
        }
        bot = bot_factory("smart_strangler@hard", {**NO_SCOUT, "guard": ParamRange(2, 2)})(
            MAP, RULES, seed=0, player=player
        )
        assert isinstance(bot, SmartBot)
        view = match.view(player)
        home = _group_at(view, _at(player, 0))
        splits = [c.n for c in _decide(bot, view) if isinstance(c, Split) and c.group == home]
        assert splits == want
