"""``RusherBot``: early pressure and planned strikes on weak cities (BOT-03).

It does not wait for the economy: the stance is War (more CP for orders, fewer charges), the
capital keeps at most one unit at home, and the first strong group goes for the enemy. Targets
are enemy cities, never a neutral one while an enemy city is in reach; among them the weak ones
(small ``need``, by the estimate of ``CampaignBot``) and the ones closer to the enemy capital
come first. A strike is a planned order when ``prefer_planned`` says the bonus is worth its price,
which is a property of the ruleset, not of this bot.
"""

from collections.abc import Mapping
from typing import ClassVar, override

from gow_bots.bots.base import ParamRange, node_of
from gow_bots.bots.campaign import CampaignBot, Ctx
from gow_sim.view import GroupView, Stance

__all__ = ["RusherBot"]


class RusherBot(CampaignBot):
    name: ClassVar[str] = "rusher"
    STANCE: ClassVar[Stance] = Stance.WAR
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {
        "radius": ParamRange(3, 4),
        "margin": ParamRange(0, 1),
        "guard": ParamRange(0, 1),
        "reserve": ParamRange(0, 0),
        "recruit_keep": ParamRange(100, 150),
        "neutral_pct": ParamRange(20, 60),  # worth of a free neutral city against an enemy one
    }

    @override
    def score(self, ctx: Ctx, g: GroupView, dest: int, need: int) -> int | None:
        node = self.map.nodes[dest]
        hops = self.hops[node_of(g)][dest]
        if node.capital_of is not None:
            return 10_000 - hops
        if ctx.view.nodes[dest].owner is None:
            return 2 * node.vp * self.params["neutral_pct"] - 10 * hops
        closer = self.hops[self.enemy_home][node_of(g)] - self.hops[self.enemy_home][dest]
        return 300 * node.vp + 40 * closer - 15 * need - 10 * hops
