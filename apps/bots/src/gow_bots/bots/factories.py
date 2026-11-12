"""Factory sites of the bots (DEC-41 item 2, DEC-43 items H and J, DEC-47; #683).

A factory costs ``factory.cost`` charges (the progressive payment of DEC-41, item 7) and, under
``stances.factories_follow`` (DEC-47, ``mvp-7``), makes one charge per capital period of its
owner's stance (after map tempo, DEC-46: the bot gets the rules the match plays). A captured
factory passes to the capturer (DEC-41, item 2), a factory in a pocket stops (DEC-43, item H2), and
the supply flow rolls every charge toward the front wherever it is made (item A6), so the site of
a factory decides only whether it is lost, not where its charges go. ``factory_site`` therefore
builds in the rear, from spare stock, only while the match left pays the factory back, and never
twice where one was lost:

- **Where** (``safe_rear``): an own city (not a province, not the capital, no factory, no fight) at
  least ``SITE_DEPTH`` road hops from every enemy node, reached from the own capital over own
  nodes none of which touches an enemy node, so one capture next to the front does not cut it into
  a pocket, and never one where an own factory was lost. The farthest from the enemy nodes first
  (up to ``SITE_DEPTH_CAP`` hops; beyond that
  they count as equally safe), then the nearest to the own capital over those nodes, the largest
  warehouse, ``Bot.key`` (mirror-invariant).
- **When**: one build at a time while the player has fewer than ``1 + extra`` factories (the
  capital is one, ``factory.max`` caps the sum), not while the enemy holds more nodes than the
  player (public ownership: losing ground, the rear is the next thing lost), and only while the
  factory pays back: the charges
  it makes in the ticks left after its build time and ``FACTORY_DELIVERY_TICKS`` at the period of
  the own stance now (``factory_period``, rounded down) are at least ``factory.cost`` plus
  ``FACTORY_PROFIT``. A late build under War (the longest period) is not started.
- **Paid from spare stock** (``spare_stock``): the warehouses of the capital's component hold
  ``factory.cost`` beyond the own discharged units standing in it and the charges the other builds
  still owe, so neither the pull of the unpaid build (DEC-43, item J) nor the refill of a rear
  garrison it discharged (DEC-41, item 7) takes a charge an army waits for.
- **No rebuild churn** (``FactorySites``): a node where an own factory build or the factory it
  became was lost is never a site again, and the bot replaces at most ``FACTORY_RESTARTS`` unpaid
  losses in a match. A loss is unpaid unless the factory had made ``factory.cost`` charges by then
  (its ticks as an own factory outside a pocket over its ``factory_period`` from the view, rounded
  down): a factory that served before it fell is replaced.

Only the own ``PlayerView``, the map and the ruleset are read; no randomness, no ``set``.
"""

from collections import deque
from dataclasses import dataclass, field
from typing import Final

from gow_bots.bots.base import Bot
from gow_sim.maps import NodeKind
from gow_sim.ruleset import Ruleset, Stance
from gow_sim.view import AtNode, PlayerView

__all__ = [
    "FACTORY_DELIVERY_TICKS",
    "FACTORY_PROFIT",
    "FACTORY_RESTARTS",
    "SITE_DEPTH",
    "SITE_DEPTH_CAP",
    "FactorySites",
    "factory_period",
    "factory_site",
    "payback",
    "safe_rear",
    "spare_stock",
]

FACTORY_RESTARTS: Final = 1
"""Unpaid losses of factory builds (a build stopped, or a factory captured before it made
``factory.cost`` charges) the bot replaces at most in a match; past them it builds no more."""
SITE_DEPTH: Final = 3
"""A site is at least this many road hops from every enemy node: no enemy node within two roads
(one capture next to it would put the enemy at its door)."""
SITE_DEPTH_CAP: Final = 4
"""Hops from the enemy nodes beyond which sites count as equally safe (then the nearest to the
own capital)."""
FACTORY_PROFIT: Final = 2
"""Charges beyond ``factory.cost`` a new factory must make in the ticks left (``payback``)."""
FACTORY_DELIVERY_TICKS: Final = 50
"""Ticks the payment of a build takes beyond its build time (the flow brings the charges)."""
WORK_SCALE: Final = 1000
"""``FactorySites.work`` counts the charges a factory made in thousandths."""


@dataclass(slots=True)
class FactorySites:
    """What ``factory_site`` remembers between decisions, all from the own views."""

    mine: dict[int, bool] = field(default_factory=dict[int, bool])
    """Nodes where an own factory build was seen and the build or the factory it became is still
    the player's."""
    lost: dict[int, bool] = field(default_factory=dict[int, bool])
    """Nodes where an own factory build or the factory it became was lost: never a site again."""
    unpaid: int = 0
    """Losses of those that had not made ``factory.cost`` charges (``FACTORY_RESTARTS``)."""
    work: dict[int, int] = field(default_factory=dict[int, int])
    """Charges each of ``mine`` made as an own working factory, in ``WORK_SCALE`` parts: the ticks
    between two views over its ``factory_period`` in the earlier one (rounded down)."""
    period: dict[int, int] = field(default_factory=dict[int, int])
    """``factory_period`` of each of ``mine`` that worked in the last view; absent otherwise."""
    tick: int | None = None
    """The tick of the last view."""

    def observe(self, view: PlayerView, cost: int) -> None:
        """Updates the memory from ``view``; ``cost``: ``factory.cost``."""
        me = view.player
        dt = 0 if self.tick is None else view.tick - self.tick
        self.tick = view.tick
        for n in view.nodes:
            if n.owner == me and n.factory_build is not None:
                self.mine[n.id] = True
        for node in sorted(self.mine):
            period = self.period.pop(node, 0)
            if period > 0:  # it worked since the last view
                self.work[node] = self.work.get(node, 0) + dt * WORK_SCALE // period
            n = view.nodes[node]
            if n.owner == me and (n.factory or n.factory_build is not None):
                if n.factory and n.factory_period and n.flow_pocket is not True:
                    self.period[node] = n.factory_period  # DEC-43 item H2: a pocket makes none
                continue
            if self.work.pop(node, 0) // WORK_SCALE < cost:  # rounded down
                self.unpaid += 1
            del self.mine[node]
            self.lost[node] = True


def factory_period(rules: Ruleset, stance: Stance) -> int:
    """Ticks per charge of a built factory of a player in ``stance``: the capital period of the
    stance under ``stances.factories_follow`` (DEC-47), ``factory.built_period_ticks`` otherwise."""
    built = rules.factory.built_period_ticks
    if built is None or rules.stances.factories_follow:
        return rules.stances.capital_period_ticks.of(stance)
    return built


def payback(rules: Ruleset, view: PlayerView) -> int:
    """Charges a factory started now makes before the match ends at the period of the own stance
    now (rounded down; 0 when its build and delivery outlast the match)."""
    left = rules.match_ticks - view.tick - rules.factory.build_ticks - FACTORY_DELIVERY_TICKS
    return max(0, left) // factory_period(rules, view.me.stance)


def _owed(view: PlayerView, node: int) -> int:
    n = view.nodes[node]
    owed = 0 if n.factory_build is None else n.factory_build.owed
    return owed + (0 if n.building is None else n.building.owed)


def spare_stock(bot: Bot, view: PlayerView, main: list[bool]) -> int:
    """Charges the capital's component (``main``, ``Bot.supplied``) can give a new build without
    taking one a waiting unit or another build wants: its warehouses, minus the own units without
    a charge standing in it and the charges its builds still owe (may be negative)."""
    stock = 0
    for n in view.nodes:
        if main[n.id]:
            stock += (n.warehouse or 0) - _owed(view, n.id)
    for g in view.groups:
        if isinstance(g.location, AtNode) and main[g.location.node]:
            stock -= g.units - g.charged
    return stock


def safe_rear(bot: Bot, view: PlayerView) -> dict[int, int]:
    """The own nodes no enemy node touches that the own capital reaches over such nodes (the
    capital itself always counts as a start), with the road hops from the capital over them;
    empty when the capital is lost."""
    me = view.player
    capital = bot.map.capital(me)
    if view.nodes[capital].owner != me:
        return {}

    def touches_enemy(node: int) -> bool:
        return any(view.nodes[m].owner == 1 - me for m in bot.neighbors[node])

    dist = {capital: 0}
    queue = deque([capital])
    while queue:
        node = queue.popleft()
        for other in bot.neighbors[node]:
            if other in dist or view.nodes[other].owner != me or touches_enemy(other):
                continue
            dist[other] = dist[node] + 1
            queue.append(other)
    return dist


def factory_site(
    bot: Bot, view: PlayerView, extra: int, memory: FactorySites, main: list[bool]
) -> int | None:
    """The own city that should start a factory now (module docstring), or ``None``. ``memory``
    is updated on every call; ``main``: the own nodes of the capital's component
    (``Bot.supplied``)."""
    rules = bot.rules
    cost = rules.factory.cost
    memory.observe(view, cost)
    me = view.player
    if extra <= 0 or memory.unpaid > FACTORY_RESTARTS:
        return None
    count = 0
    for n in view.nodes:
        if n.owner != me:
            continue
        if n.factory_build is not None:
            return None  # one at a time
        count += bool(n.factory)
    if count >= min(rules.factory.max, 1 + extra):
        return None
    if sum(n.owner == 1 - me for n in view.nodes) > sum(n.owner == me for n in view.nodes):
        return None  # losing ground: a new factory would be the next thing lost
    if payback(rules, view) < cost + FACTORY_PROFIT:
        return None  # too late for the stance's period
    if spare_stock(bot, view, main) < cost:
        return None  # the payment would take charges the army waits for
    rear = safe_rear(bot, view)
    enemy = [n.id for n in view.nodes if n.owner == 1 - me]
    far = len(view.nodes)
    fights = bot.fight_nodes(view)
    best: tuple[int, int, int, int] | None = None
    site: int | None = None
    for node in sorted(rear):
        n = view.nodes[node]
        if bot.map.nodes[node].kind in (NodeKind.PROVINCE, NodeKind.CAPITAL) or n.factory:
            continue
        if node in fights or node in memory.lost:
            continue
        hops = bot.hops[node]
        depth = min((hops[e] if hops[e] >= 0 else far for e in enemy), default=far)
        if depth < SITE_DEPTH:
            continue
        rank = (-min(depth, SITE_DEPTH_CAP), rear[node], -(n.warehouse_cap or 0), bot.key(node))
        if best is None or rank < best:
            best, site = rank, node
    return site
