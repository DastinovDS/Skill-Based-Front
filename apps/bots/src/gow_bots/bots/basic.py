"""Baseline bots (BOT-01): ``IdleBot`` does nothing, ``RandomLegalBot`` plays random legal moves.

``RandomLegalBot`` is the floor of the strategy bots (BOT-02: they must beat it in 90% of the
matches). It sends only commands that the view says are legal: own standing groups without an
order, destinations a path of own nodes reaches (``Bot.reachable``), recruits in own cities with
a barracks and free capacity, never more CP than it has. It keeps the start stance. Like every
bot it takes an open enemy capital first (``gow_bots.bots.capital``, #1019). A command can
still be rejected when the state changes in the tick before it is applied (a node lost, a group
killed); that is expected.
"""

from collections.abc import Mapping
from typing import ClassVar, override

from gow_bots.bots.base import Bot, ParamRange, node_of
from gow_bots.bots.capital import take_capital
from gow_sim.commands import Command, Merge, Move, Recruit, Split
from gow_sim.view import GroupView, PlayerView

__all__ = ["IdleBot", "RandomLegalBot"]


class IdleBot(Bot):
    """Never sends a command: the garrisons only defend."""

    name: ClassVar[str] = "idle"

    @override
    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        self.check_view(view)
        return []


class RandomLegalBot(Bot):
    name: ClassVar[str] = "random_legal"
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {
        "act_pct": ParamRange(30, 90),  # chance that an idle group gets a command
        "radius": ParamRange(1, 4),  # farthest destination of a move, in road hops
        "recruit_pct": ParamRange(20, 80),  # chance to recruit one unit on a decision
        "other_pct": ParamRange(0, 20),  # split instead of moving
        "reserve": ParamRange(0, 200),  # CP in hundredths kept unspent
    }

    @override
    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        self.check_view(view)
        rng, p = self.rng, self.params
        budget = view.me.cp - p["reserve"]
        cmds: list[Command] = []

        def spend(cmd: Command) -> bool:
            nonlocal budget
            cost = self.cost(cmd)
            if cost > budget:
                return False
            budget -= cost
            cmds.append(cmd)
            return True

        used: dict[int, bool] = {}
        take = take_capital(self, view, tick, self.idle_groups(view), view.me.cp)
        if take.wait:
            budget = min(budget, 0)  # the next CP go to the open enemy capital
        elif take.cmd is not None:
            cmd = take.cmd
            budget += p["reserve"]  # the reserve pays the move that wins
            if spend(cmd):
                used.update(
                    dict.fromkeys(cmd.groups if isinstance(cmd, Merge) else (cmd.group,), True)
                )
            budget -= p["reserve"]
        if rng.randrange(100) < p["recruit_pct"]:
            cities = self._recruit_cities(view)
            if cities:
                spend(Recruit(rng.choice(cities)))
        for g in self.idle_groups(view):
            if g.id in used or rng.randrange(100) >= p["act_pct"]:
                continue
            cmd = self._other(g) if rng.randrange(100) < p["other_pct"] else None
            if cmd is None:
                cmd = self._move(view, g)
            if cmd is not None:
                spend(cmd)
        return cmds

    def _recruit_cities(self, view: PlayerView) -> list[int]:
        """Own cities with room in the recruit queue, the rear ones if there are any (DEC-25)."""
        standing = self.standing(view)
        cities = [n.id for n in view.nodes if self.can_queue(view, n.id, standing[n.id])]
        rear = [n for n in cities if not self.front(view, n)]
        return sorted(rear or cities, key=self.key)

    def _move(self, view: PlayerView, g: GroupView) -> Command | None:
        """An ordinary move to a random destination: it never gathers a plan (DEC-41, item 10)."""
        dests = self.reachable(view, node_of(g), self.params["radius"], g.units)
        if g.charged < self.rules.capture.charge_cost:  # it cannot pay a capture (DEC-38)
            dests = [d for d in dests if view.nodes[d].owner == view.player]
        if not dests:
            return None
        return Move(g.id, self.rng.choice(dests))

    def _other(self, g: GroupView) -> Command | None:
        """A split of an idle group into two random parts."""
        if g.units < 2:
            return None
        return Split(g.id, self.rng.randint(1, g.units - 1))
