"""Baseline bots (BOT-01): ``IdleBot`` does nothing, ``RandomLegalBot`` plays random legal moves.

``RandomLegalBot`` is the floor of the strategy bots (BOT-02: they must beat it in 90% of the
matches). It sends only commands that the view says are legal: own standing groups without an
order, destinations a path of own nodes reaches (``Bot.reachable``), recruits in own cities with
free capacity and no cooldown, never more CP than it has. A command can still be rejected when the
state changes in the tick before it is applied (a node lost, a group killed); that is expected.
"""

from collections.abc import Mapping
from typing import ClassVar, override

from gow_bots.bots.base import Bot, ParamRange, node_of
from gow_bots.bots.utility import prefer_planned, shots_to_take
from gow_sim.commands import (
    Command,
    Move,
    Recruit,
    SetMode,
    SetStance,
    Split,
    UpgradeRoad,
)
from gow_sim.maps import MapDef
from gow_sim.ruleset import RecruitLocation, Ruleset
from gow_sim.view import GroupView, Mode, PlayerView, RoadKind, Stance

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
        "other_pct": ParamRange(0, 20),  # split or change mode instead of moving; a city builds
        "stance_pct": ParamRange(0, 10),  # chance to change the stance on a decision
        "reserve": ParamRange(0, 200),  # CP in hundredths kept unspent
    }

    def __init__(self, mapdef: MapDef, rules: Ruleset, *, seed: int, player: int) -> None:
        super().__init__(mapdef, rules, seed=seed, player=player)
        self.recruited: dict[int, int] = {}
        """Decision tick of the last recruit in each city (the cooldown belongs to the city)."""
        self.stance_tick: int | None = None

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

        if rng.randrange(100) < p["stance_pct"] and self._stance_ready(tick):
            stance = rng.choice([s for s in Stance if s is not view.me.stance])
            if spend(SetStance(stance)):
                self.stance_tick = tick
        if rng.randrange(100) < p["recruit_pct"]:
            cities = self._recruit_cities(view, tick)
            if cities:
                node = rng.choice(cities)
                if spend(Recruit(node)):
                    self.recruited[node] = tick
        for g in self.idle_groups(view):
            if rng.randrange(100) >= p["act_pct"]:
                continue
            cmd = self._other(view, g) if rng.randrange(100) < p["other_pct"] else None
            if cmd is None:
                cmd = self._move(view, g, budget)
            if cmd is not None:
                spend(cmd)
        return cmds

    def _stance_ready(self, tick: int) -> bool:
        last = self.stance_tick
        return last is None or tick - last >= self.rules.orders.stance_cooldown_ticks

    def _recruit_cities(self, view: PlayerView, tick: int) -> list[int]:
        me, cooldown = view.player, self.rules.recruit.cooldown_ticks
        if self.rules.recruit.location is RecruitLocation.CAPITAL:
            candidates = [self.map.capital(me)]
        else:
            candidates = [n.id for n in view.nodes]
        standing = self.standing(view)
        cities = [
            n
            for n in candidates
            if view.nodes[n].owner == me
            and standing[n] < view.nodes[n].capacity
            and tick - self.recruited.get(n, tick - cooldown) >= cooldown
        ]
        return sorted(cities, key=self.key)

    def _move(self, view: PlayerView, g: GroupView, budget: int) -> Command | None:
        dests = self.reachable(view, node_of(g), self.params["radius"])
        if not dests:
            return None
        dest = self.rng.choice(dests)
        enemy = self.enemy_at(view, dest) if view.nodes[dest].owner != view.player else (0, 0)
        if enemy is not None:
            terrain = self.map.nodes[dest].terrain
            need = shots_to_take(self.rules, terrain, *enemy, self.defended(view, dest))
            planned = Move(g.id, dest, planned=True)
            if prefer_planned(self.rules, g.charged, need) and self.cost(planned) <= budget:
                return planned
        return Move(g.id, dest)

    def _other(self, view: PlayerView, g: GroupView) -> Command | None:
        here = node_of(g)
        options: list[Command] = []
        if g.units >= 2:
            options.append(Split(g.id, self.rng.randint(1, g.units - 1)))
        options.append(SetMode(g.id, Mode.ATTACK if g.mode is Mode.DEFENSE else Mode.DEFENSE))
        supplied = self.supplied(view)
        for e in self.incident[here]:  # the city where the group stands builds (DEC-16)
            if self.can_upgrade(view, here, e, supplied):
                first = view.edges[e].kind is RoadKind.NONE
                kind = self.rng.choice([RoadKind.FAST, RoadKind.FREIGHT]) if first else None
                options.append(UpgradeRoad(here, e, kind))
        return self.rng.choice(options)
