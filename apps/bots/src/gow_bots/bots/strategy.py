"""Strategy bots (BOT-02): ``ExpanderBot`` and ``TurtleBot``.

Both play the priorities of ``gow_bots.bots.tactics`` and differ in what they want:

- ``ExpanderBot`` plays for VP through territory (mechanics.md, section 11): it spends CP on
  capturing neutral nodes (and enemy nodes that stand empty) as early as possible, in the
  «Война» stance (75% of the CP income stays CP), holds only the capital and the nodes next to
  the enemy, and puts spare groups in the rear on «Строительство» of roads. After ``war_until``
  ticks, when the map is divided, it switches to «Баланс» to get charges for fights.
- ``TurtleBot`` is the bunker of Topic 2 (mechanics.md, section 12): it keeps a small region
  around its capital (nodes within ``radius`` road hops), stays in the «Экономия» stance (75% of
  the income goes to charges, the warehouses fill up), keeps big garrisons on the front with
  «Защита» on, attacks only when sure to win (a large ``margin``). Its result against the
  expanding bots is the test of the claim that VP for holding cities beat the bunker.

Parameters are drawn from the match seed (``choose_params``); the ranges are chosen so that
every draw is a sensible player, the spread is the variability of a tournament.
"""

from collections.abc import Mapping
from typing import ClassVar, override

from gow_bots.bots.base import ParamRange
from gow_bots.bots.tactics import StrategyBot, Turn
from gow_sim.commands import Command
from gow_sim.maps import MapDef
from gow_sim.ruleset import Ruleset
from gow_sim.view import PlayerView, Stance

__all__ = ["ExpanderBot", "TurtleBot"]

SPARE_CP = 400
"""CP in hundredths above which spare CP is spent on recruits (the cap is 500, DEC-02)."""


class ExpanderBot(StrategyBot):
    name: ClassVar[str] = "expander"
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {
        "hold_capital": ParamRange(2, 4),  # units kept in the capital
        "hold_front": ParamRange(1, 2),  # units kept in every node next to the enemy
        "margin": ParamRange(0, 1),  # charges to spare in an attack
        "est_pct": ParamRange(30, 60),  # guess of the enemy garrison, % of the capacity
        "road_keep": ParamRange(100, 250),  # CP in hundredths that roads never touch
        "war_until": ParamRange(1200, 2400),  # ticks in the «Война» stance
    }

    @override
    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        p = self.params
        turn = self.begin(view, tick)
        self.set_stance(turn, Stance.WAR if tick < p["war_until"] else Stance.BALANCE)
        self.guard(turn, p["hold_capital"], p["hold_front"])
        self.strike(turn, None, p["margin"], p["est_pct"])
        self.claim(turn, None)
        self.reinforce(turn)
        self.strengthen(turn, SPARE_CP)
        self.build_roads(turn, p["road_keep"])
        return turn.cmds


class TurtleBot(StrategyBot):
    name: ClassVar[str] = "turtle"
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {
        "radius": ParamRange(3, 4),  # the region: road hops from the capital
        "hold_capital": ParamRange(3, 5),
        "hold_front": ParamRange(2, 4),
        "margin": ParamRange(1, 2),
        "est_pct": ParamRange(50, 80),
        "road_keep": ParamRange(200, 400),
        "spill": ParamRange(1, 2),  # extra hops claimed while CP is about to burn
        "spill_cp": ParamRange(350, 450),
    }

    def __init__(self, mapdef: MapDef, rules: Ruleset, *, seed: int, player: int) -> None:
        super().__init__(mapdef, rules, seed=seed, player=player)
        radius = self.params["radius"]
        self.region = frozenset(
            n for n in range(len(mapdef.nodes)) if self.hops[self.capital][n] <= radius
        )
        """The nodes the bunker holds and claims."""
        self.spill = frozenset(
            n
            for n in range(len(mapdef.nodes))
            if self.hops[self.capital][n] <= radius + self.params["spill"]
        )
        """The region and the ring around it, claimed only when CP are about to burn."""

    @override
    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        p = self.params
        turn: Turn = self.begin(view, tick)
        self.set_stance(turn, Stance.ECONOMY)
        self.guard(turn, p["hold_capital"], p["hold_front"])
        self.fortify(turn)
        self.strike(turn, self.region, p["margin"], p["est_pct"])
        self.claim(turn, self.region)
        self.reinforce(turn)
        if turn.budget >= p["spill_cp"]:
            self.claim(turn, self.spill)  # CP would burn on the cap: the bunker grows a ring
        self.strengthen(turn, SPARE_CP)
        self.build_roads(turn, p["road_keep"])
        return turn.cmds
