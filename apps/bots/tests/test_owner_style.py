"""The benchmark ``owner_style`` (``gow_bots.bots.owner_style``): the owner's recipe from the view.

Expected values come from the rules and the map (``dec41`` of the simulation tests under
``mvp-7``: plains everywhere, so a neighbour sees a node exactly, DEC-21; a plains defender burns
one charge in the first round, DEC-45), not from the output of the bot. In the frame of the bot
its own group stands in 2, a city of capacity 6 with a warehouse of 3 (DEC-43, item C), next to the
enemy's 6 (a small city, 2 is its only neighbour); the enemy's capital 16 is far away and the
rest of the map is neutral. A strike
needs ``real charges + bonus >= pool + units + 1 (the capture, DEC-38) + 1 (the margin)``.
Every case is also played as player 1 on the mirror nodes (AGENTS.md, section 4.1, item 6).
"""

from collections.abc import Sequence
from pathlib import Path
from typing import Final

import pytest

from gow_bots.bots import BOTS, OwnerStyleBot, bot_factory
from gow_sim.commands import Command, GroupMove, Move
from gow_sim.maps import MapDef, load_map
from gow_sim.match import Controller, ControllerFactory, Match, play
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.state import AtNode, Group, Mode
from gow_sim.systems.capacity import change_owner
from gow_sim.systems.flow import update_flow
from gow_sim.view import PlayerView

ROOT: Final = Path(__file__).resolve().parents[3]
KEY: Final = bytes(range(32))
MAP: Final = load_map(ROOT / "packages" / "sim" / "tests" / "maps" / "dec41.json")
RULES: Final = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")
TICK: Final = 2000
BASE, TARGET = 2, 6
"""The node of the squads and the enemy city next to it."""
OWN: Final = (0, 1, 2, 3, 4, 5, 7, 8, 12, 13, 15, 17, 18)
FOE: Final = (6, 16)
ME, THEM = 0, 1


def _at(player: int, node: int) -> int:
    return MAP.node_key(player, node)


def _scenario(player: int, groups: Sequence[tuple[int, int, int, int]]) -> Match:
    """``dec41`` at ``TICK`` with ``OWN`` the bot's and ``FOE`` the enemy's; ``groups`` are
    ``(side, node, units, charged)``, the start garrisons removed; 3 CP each, a full warehouse
    in the base node."""
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
    state.nodes[_at(player, BASE)].warehouse = 3
    for p in state.players.values():
        p.cp = 300
    update_flow(state, RULES)
    return match


def _decide(match: Match, player: int) -> tuple[list[Command], PlayerView]:
    bot = bot_factory("owner_style")(MAP, RULES, seed=0, player=player)
    assert isinstance(bot, OwnerStyleBot)
    view = match.view(player)
    return bot.decide(view, TICK), view


def _ids_at(view: PlayerView, node: int) -> list[int]:
    return sorted(g.id for g in view.groups if g.location == AtNode(node))


@pytest.mark.parametrize("player", [0, 1])
def test_a_defended_target_gets_a_planned_order_with_the_full_bonus(player: int) -> None:
    """The enemy city holds 3 units, 2 charged: the pool is 2 - 1 (plains) = 1 and 3 units die,
    so 4 shots take it; with the margin and the capture charge 6 are needed. The 3/3 squad alone
    has 3, with the warehouse's 3 as the bonus it has 6: the order is planned and asks for 3."""
    base, target = _at(player, BASE), _at(player, TARGET)
    groups = [(ME, BASE, 3, 3), (ME, BASE, 1, 0), (THEM, TARGET, 3, 2)]
    cmds, view = _decide(_scenario(player, groups), player)
    squad = next(g for g in view.groups if g.units == 3 and g.location == AtNode(base))
    assert cmds == [Move(squad.id, target, planned=True, bonus=3)]


@pytest.mark.parametrize("player", [0, 1])
def test_two_squads_combine_in_one_group_move(player: int) -> None:
    """4 units, 3 charged: the pool is 2 and 4 units die, so 6 shots, 8 with the margin and
    the capture. One 3/3 squad with the bonus has 6, two have 6 real charges and a bonus of 3
    (the warehouse): 9. One ``GroupMove`` carries both, planned, with that bonus."""
    base, target = _at(player, BASE), _at(player, TARGET)
    groups = [(ME, BASE, 3, 3), (ME, BASE, 3, 3), (THEM, TARGET, 4, 3)]
    cmds, view = _decide(_scenario(player, groups), player)
    assert len(cmds) == 1
    cmd = cmds[0]
    assert isinstance(cmd, GroupMove)
    assert sorted(cmd.groups) == _ids_at(view, base)
    assert (cmd.dest, cmd.planned, cmd.bonus) == (target, True, 3)


@pytest.mark.parametrize("player", [0, 1])
def test_no_strike_without_a_surplus(player: int) -> None:
    """5 units, 5 charged: the pool is 4, 5 units die, 9 shots, 11 with the margin and the
    capture; two squads have 9. Nothing is ordered at the city."""
    target = _at(player, TARGET)
    groups = [(ME, BASE, 3, 3), (ME, BASE, 3, 3), (THEM, TARGET, 5, 5)]
    cmds, _ = _decide(_scenario(player, groups), player)
    for cmd in cmds:
        assert not (isinstance(cmd, Move) and cmd.dest == target)
        assert not (isinstance(cmd, GroupMove) and cmd.dest == target)


@pytest.mark.parametrize("player", [0, 1])
def test_an_empty_enemy_node_is_harvested_by_an_ordinary_move(player: int) -> None:
    """Nobody is in the enemy city: a 3/3 squad takes it with one charge for the capture, no
    plan (an empty node never fires a bonus, ``utility.takes``)."""
    base, target = _at(player, BASE), _at(player, TARGET)
    cmds, view = _decide(_scenario(player, [(ME, BASE, 3, 3), (ME, BASE, 1, 0)]), player)
    squad = next(g for g in view.groups if g.units == 3 and g.location == AtNode(base))
    assert cmds == [Move(squad.id, target)]


def test_the_benchmark_is_registered_and_plays_no_level() -> None:
    assert BOTS["owner_style"] is OwnerStyleBot
    with pytest.raises(ValueError, match="bad level"):
        bot_factory("owner_style@hard")


class _Recorder:
    """An ``owner_style`` bot that notes every command it sends with its tick."""

    def __init__(self, inner: OwnerStyleBot, sent: list[tuple[int, Command]]) -> None:
        self.inner, self.sent = inner, sent

    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        cmds = self.inner.decide(view, tick)
        self.sent.extend((tick, c) for c in cmds)
        return cmds


def _recording(sent: list[tuple[int, Command]]) -> ControllerFactory:
    def make(mapdef: MapDef, rules: Ruleset, *, seed: int, player: int) -> Controller:
        bot = bot_factory("owner_style")(mapdef, rules, seed=seed, player=player)
        assert isinstance(bot, OwnerStyleBot)
        return _Recorder(bot, sent)

    return make


@pytest.mark.slow
@pytest.mark.parametrize("opponent", ["smart_strangler@hard", "smart_expander@hard"])
def test_full_matches_use_group_orders_one_command_a_tick(opponent: str) -> None:
    """Full pool-map matches on ``mvp-7``: no error, never two commands in one tick, human
    tempo (under 12 a minute), and across them a planned order with a bonus and a
    ``GroupMove`` appear."""
    planned = group_moves = 0
    for name, seed, side in (("narrows", 0, 0), ("ridge", 1, 1), ("crossroads", 2, 0)):
        mapdef = load_map(ROOT / "maps" / f"{name}.json")
        sent: list[tuple[int, Command]] = []
        factories = [bot_factory(opponent), bot_factory(opponent)]
        factories[side] = _recording(sent)
        result = play(mapdef, RULES, factories, seed=seed)
        assert result.outcome is not None
        ticks = [t for t, _ in sent]
        assert len(ticks) == len(set(ticks)), "two commands in one tick"
        assert len(sent) * 600 / max(1, result.ticks) < 12
        planned += sum(isinstance(c, Move) and c.planned and c.bonus >= 1 for _, c in sent)
        group_moves += sum(isinstance(c, GroupMove) for _, c in sent)
    assert planned >= 1
    assert group_moves >= 1
