"""``StranglerBot``: cuts the roads of the enemy and besieges (BOT-03).

Supply flows from the capital through the connected territory (mechanics.md, sections 7 and 9),
so taking a city cuts the roads through it: the cities behind it lose the connection (their
warehouse is no longer refilled) and the upgraded roads into it stop carrying supply (DEC-22:
roads change supply only). ``cut_value`` prices a city by that damage, from the public ownership
of the nodes and the known road levels only, and the Strangler attacks the most damaging city it
can take. A city taken that
way is held (``hold`` units stay), the enemy cities that are already cut are besieged in waves:
after a bounce the estimate of a cut city drops (``CampaignBot._starve``), so the next wave is
cheaper, which is the "Siege of attrition" of mechanics.md, section 4.
"""

from collections import deque
from collections.abc import Mapping
from typing import ClassVar, override

from gow_bots.bots.base import ParamRange, node_of
from gow_bots.bots.campaign import CampaignBot, Ctx
from gow_sim.maps import MapDef
from gow_sim.ruleset import Ruleset
from gow_sim.view import GroupView, PlayerView, Stance

__all__ = ["StranglerBot"]

CUT_REFRESH_TICKS = 20
"""The cut values are recomputed this often: ownership changes rarely."""


class StranglerBot(CampaignBot):
    name: ClassVar[str] = "strangler"
    STANCE: ClassVar[Stance] = Stance.BALANCE
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {
        "radius": ParamRange(2, 4),
        "margin": ParamRange(0, 1),
        "guard": ParamRange(1, 2),
        "reserve": ParamRange(0, 100),
        "recruit_keep": ParamRange(100, 250),
        "hold": ParamRange(1, 2),  # units that stay in a city taken to cut a road
    }

    def __init__(self, mapdef: MapDef, rules: Ruleset, *, seed: int, player: int) -> None:
        super().__init__(mapdef, rules, seed=seed, player=player)
        self._values: dict[int, int] = {}
        self._values_tick = -CUT_REFRESH_TICKS
        self.held: dict[int, bool] = {}
        """Cities taken from the enemy network that the Strangler keeps."""

    def cut_value(self, view: PlayerView, node: int) -> int:
        """Damage to the enemy network if ``node`` were ours, in points (100 per lost city)."""
        net = self.enemy_net(view)
        if node not in net:
            return 0
        enemy = 1 - self.player
        seen = {self.enemy_home} if node != self.enemy_home else set[int]()
        queue = deque(seen)
        while queue:
            at = queue.popleft()
            for other in self.neighbors[at]:
                if other != node and other not in seen and view.nodes[other].owner == enemy:
                    seen.add(other)
                    queue.append(other)
        lost = len(net) - 1 - len(seen)
        roads = sum(
            100 * view.edges[e].width
            for e in self.incident[node]
            if self.map.edges[e].other(node) in net
        )
        return 100 * lost + roads // 4

    def values(self, view: PlayerView) -> dict[int, int]:
        if view.tick - self._values_tick >= CUT_REFRESH_TICKS:
            self._values = {n: self.cut_value(view, n) for n in sorted(self.enemy_net(view))}
            self._values_tick = view.tick
        return self._values

    @override
    def score(self, ctx: Ctx, g: GroupView, dest: int, need: int) -> int | None:
        node = self.map.nodes[dest]
        hops = self.hops[node_of(g)][dest]
        if node.capital_of is not None:
            return 10_000 - hops
        if ctx.view.nodes[dest].owner is None:
            return 40 * node.vp - 10 * hops
        cut = self.values(ctx.view).get(dest)
        if cut is None:  # already cut off: a siege target
            return 150 + 50 * node.vp - 10 * hops - 3 * need
        return 150 + cut - 10 * hops - 3 * need

    @override
    def objective(self, ctx: Ctx) -> int:
        values = self.values(ctx.view)
        if not values:
            return self.enemy_home
        return max(sorted(values, key=self.key), key=lambda n: values[n])

    @override
    def may_leave(self, ctx: Ctx, g: GroupView) -> bool:
        here = node_of(g)
        if here in self.held and ctx.view.nodes[here].owner == self.player:
            return ctx.standing[here] - g.units >= self.params["hold"]
        return super().may_leave(ctx, g)
