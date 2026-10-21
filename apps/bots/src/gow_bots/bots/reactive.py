"""``ReactiveBot``: answers the visible intents of the enemy (BOT-03).

Planned orders and «Защита» are public (DEC-04, DEC-08): a planned strike shows its origin and
its target 30 ticks before the group leaves. For every such strike at an own city the bot
(``respond``, before anything else, spending the CP it keeps in reserve for that):

1. turns on «Защита» in the target where a charged group stands, if it gathers a bonus before the
   strike can arrive: +1 per ``orders.defense_ticks_per_bonus`` ticks in the mode (DEC-30), and
   the strike waits ``planned_delay_ticks`` and then walks at least the quickest roads of the
   map at the fastest terrain speed (``arrival``);
2. reinforces the target with the nearest charged group that can walk there;
3. remembers the origin of the strike as exposed: the group has left it or is about to, so
   ``score`` puts a viable attack on that city first (the bare spot).

The enemy «Защита» intent needs no code here: ``Bot.defended`` makes ``CampaignBot.need`` count
its bonus. Without intents it plays like the base strategy.
"""

import heapq
from collections.abc import Mapping
from typing import ClassVar, override

from gow_bots.bots.base import ParamRange, node_of
from gow_bots.bots.campaign import CampaignBot, Ctx
from gow_sim.commands import Move, SetMode
from gow_sim.maps import MapDef, Terrain
from gow_sim.ruleset import Ruleset
from gow_sim.view import GroupView, IntentKind, IntentView, Mode, Stance

__all__ = ["ReactiveBot"]

EXPOSED_TICKS = 150
"""How long the origin of a strike counts as exposed."""
SEARCH_HOPS = 3
"""Farthest own city a reinforcement comes from, in road hops."""


class ReactiveBot(CampaignBot):
    name: ClassVar[str] = "reactive"
    STANCE: ClassVar[Stance] = Stance.BALANCE
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {
        "radius": ParamRange(2, 3),
        "margin": ParamRange(0, 1),
        "guard": ParamRange(1, 2),
        "reserve": ParamRange(200, 300),  # CP kept for «Защита» and reinforcements
        "recruit_keep": ParamRange(250, 350),
    }

    def __init__(self, mapdef: MapDef, rules: Ruleset, *, seed: int, player: int) -> None:
        super().__init__(mapdef, rules, seed=seed, player=player)
        self.answered: dict[int, bool] = {}
        """Opaque ids of the intents that already got an answer."""
        self.exposed: dict[int, int] = {}
        """Origins of enemy strikes by the tick they were seen."""
        self.fastest = max(rules.terrain.speed_pct.of(t) for t in Terrain)
        """The fastest terrain speed in percent (#253): the travel times of ``arrival`` are lower
        bounds."""
        self.travel: dict[int, dict[int, int]] = {}
        """By origin: the least travel ticks to every node over the roads of the map."""

    @override
    def respond(self, ctx: Ctx) -> None:
        view = ctx.view
        live = {i.id for i in view.intents}
        self.answered = {i: True for i in self.answered if i in live}
        ctx.budget += self.params["reserve"]
        for intent in self.strikes(ctx):
            self.exposed[intent.origin] = ctx.tick
            if intent.id not in self.answered and intent.target is not None:
                done = self.defend(ctx, intent.target, self.arrival(intent))
                done = self.reinforce(ctx, intent.target) or done
                if done:
                    self.answered[intent.id] = True
        ctx.budget -= self.params["reserve"]

    def strikes(self, ctx: Ctx) -> list[IntentView]:
        """Planned enemy orders aimed at an own city, in a mirror-invariant order."""
        view = ctx.view
        found = [
            i
            for i in view.intents
            if i.owner != self.player
            and i.kind is IntentKind.PLANNED_MOVE
            and i.target is not None
            and view.nodes[i.target].owner == self.player
        ]
        found.sort(key=lambda i: (self.key(i.target or 0), self.key(i.origin), i.created_tick))
        return found

    def arrival(self, intent: IntentView) -> int:
        """The earliest tick the planned strike of ``intent`` can reach its target: the delay,
        then the quickest roads of the map at the fastest terrain speed."""
        assert intent.target is not None
        if intent.origin not in self.travel:
            self.travel[intent.origin] = self._travel_from(intent.origin)
        way = self.travel[intent.origin].get(intent.target, 0)
        return intent.created_tick + self.rules.orders.planned_delay_ticks + way

    def _travel_from(self, origin: int) -> dict[int, int]:
        """Dijkstra over the map edges, ``travel_ticks * 100 // fastest`` per edge."""
        best = {origin: 0}
        queue = [(0, self.key(origin), origin)]
        while queue:
            ticks, _, node = heapq.heappop(queue)
            if ticks > best[node]:
                continue
            for edge in self.map.edges:
                if node not in (edge.a, edge.b):
                    continue
                other = edge.other(node)
                t = ticks + edge.travel_ticks * 100 // self.fastest
                if t < best.get(other, t + 1):
                    best[other] = t
                    heapq.heappush(queue, (t, self.key(other), other))
        return best

    def defend(self, ctx: Ctx, target: int, arrival: int) -> bool:
        """«Защита» for the strongest charged group standing in ``target``, if it gathers at least
        +1 by ``arrival`` (it is switched on in the next tick, DEC-30)."""
        if self.rules.orders.defense_bonus(max(0, arrival - ctx.tick - 1), 1) < 1:
            return False
        here = [
            g
            for g in self.idle_groups(ctx.view)
            if node_of(g) == target and g.charged > 0 and g.id not in ctx.used
        ]
        if not here or any(g.mode is Mode.DEFENSE for g in here):
            return False
        best = max(here, key=lambda g: (g.charged, g.units))
        if self.spend(ctx, SetMode(best.id, Mode.DEFENSE)):
            ctx.used[best.id] = True
            return True
        return False

    def reinforce(self, ctx: Ctx, target: int) -> bool:
        """The nearest charged group that can walk to ``target`` and may leave its city."""
        best: GroupView | None = None
        for g in self.free_groups(ctx):
            here = node_of(g)
            if here == target or g.charged == 0:
                continue
            if not self.may_leave(ctx, g) or target not in self.reachable(
                ctx.view, here, SEARCH_HOPS, g.units
            ):
                continue
            if best is None or (self.hops[here][target], -g.charged) < (
                self.hops[node_of(best)][target],
                -best.charged,
            ):
                best = g
        if best is not None and self.spend(ctx, Move(best.id, target)):
            ctx.used[best.id] = True
            ctx.standing[node_of(best)] -= best.units
            ctx.claimed[target] = True
            return True
        return False

    @override
    def score(self, ctx: Ctx, g: GroupView, dest: int, need: int) -> int | None:
        base = super().score(ctx, g, dest, need)
        if base is None:
            return None
        seen = self.exposed.get(dest)
        if seen is not None and ctx.tick - seen <= EXPOSED_TICKS:
            return base + 500
        return base
