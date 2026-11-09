"""``ReactiveBot``: answers the visible intents of the enemy (BOT-03).

Planned orders are public (DEC-04, DEC-08): a planned strike shows its origin and its target
while it gathers its bonus, at least ``orders.plan_ticks_per_bonus`` ticks before the group
leaves (DEC-41, item 10). For every such strike at an own city the bot (``respond``, before
anything else, spending the CP it keeps in reserve for that):

1. reinforces the target with the nearest charged group that can walk there;
2. remembers the origin of the strike as exposed: the group has left it or is about to, so
   ``score`` puts a viable attack on that city first (the bare spot).

Without intents it plays like the base strategy.
"""

from collections.abc import Mapping
from typing import ClassVar, override

from gow_bots.bots.base import ParamRange, node_of
from gow_bots.bots.campaign import CampaignBot, Ctx
from gow_sim.commands import Move
from gow_sim.maps import MapDef
from gow_sim.ruleset import Ruleset
from gow_sim.view import GroupView, IntentView

__all__ = ["ReactiveBot"]

EXPOSED_TICKS = 150
"""How long the origin of a strike counts as exposed."""
SEARCH_HOPS = 3
"""Farthest own city a reinforcement comes from, in road hops."""


class ReactiveBot(CampaignBot):
    name: ClassVar[str] = "reactive"
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {
        "radius": ParamRange(2, 3),
        "margin": ParamRange(0, 1),
        "guard": ParamRange(1, 2),
        "reserve": ParamRange(200, 300),  # CP kept for reinforcements
        "recruit_keep": ParamRange(250, 350),
    }

    def __init__(self, mapdef: MapDef, rules: Ruleset, *, seed: int, player: int) -> None:
        super().__init__(mapdef, rules, seed=seed, player=player)
        self.answered: dict[int, bool] = {}
        """Opaque ids of the intents that already got an answer."""
        self.exposed: dict[int, int] = {}
        """Origins of enemy strikes by the tick they were seen."""

    @override
    def respond(self, ctx: Ctx) -> None:
        view = ctx.view
        live = {i.id for i in view.intents}
        self.answered = {i: True for i in self.answered if i in live}
        ctx.budget += self.params["reserve"]
        for intent in self.strikes(ctx):
            self.exposed[intent.origin] = ctx.tick
            target = intent.target
            if (
                intent.id not in self.answered
                and target is not None
                and self.reinforce(ctx, target)
            ):
                self.answered[intent.id] = True
        ctx.budget -= self.params["reserve"]

    def strikes(self, ctx: Ctx) -> list[IntentView]:
        """Planned enemy orders aimed at an own city, in a mirror-invariant order."""
        view = ctx.view
        found = [
            i
            for i in view.intents
            if i.owner != self.player
            and i.target is not None
            and view.nodes[i.target].owner == self.player
        ]
        found.sort(key=lambda i: (self.key(i.target or 0), self.key(i.origin), i.created_tick))
        return found

    def reinforce(self, ctx: Ctx, target: int) -> bool:
        """The nearest charged group that can walk to ``target`` and may leave its city."""
        best: GroupView | None = None
        room = self.room(ctx, target) if ctx.view.nodes[target].owner == self.player else None
        for g in self.free_groups(ctx):
            here = node_of(g)
            if here == target or g.charged == 0 or (room is not None and g.units > room):
                continue  # #686: no move into a node it would put over capacity
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
