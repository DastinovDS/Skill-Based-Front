"""An open enemy capital is taken at once (the owner's rule of 2026-11-12, #1019).

The capture of the enemy capital ends the match (mechanics.md, section 11). The bots used to
reach it only through their ordinary attack, the last priority of a decision and limited to
``radius`` road hops, so a bot that broke through walked around an empty enemy capital: the
groups next to it were discharged and could not pay the capture (DEC-38), the charged ones were
farther than ``radius`` or kept as the guard of the own capital, and the CP of the decision went
to buildings, garrisons and scouts first. Every bot now asks ``take_capital`` first in its
decision, right after its fights:

- **Open** (``open_need``): the view shows the enemy capital's numbers, this tick or in a
  sighting at most ``OPEN_MEMORY_TICKS`` old: empty (no enemy seen there, at any detail, DEC-21),
  or exact numbers, or a range (its top, all charged). A capital in fog for longer, or seen only
  as a presence, is not open. ``need`` is the shots that take it (``shots_to_take``, 0 when
  empty) plus what the bot counts the defender can still bring (``Bot.open_support``).
- **A taker**: an own free group with a ``Move`` path to it (``Bot.ways``: through own nodes,
  under the stack limit; no ``radius``) whose real charges take it and pay the capture after the
  toll of the road in (``takes``, DEC-38, DEC-43 item D6). The earliest arrival goes. A group of
  the own capital goes only when it arrives before any enemy could reach the own capital
  (``home_eta``: from an enemy node, a fresh sighting or a figure on a road) or the rest of the
  garrison keeps ``Bot.home_keep`` units. A group too big for every path splits off the part
  that takes it; groups of one node that take it only together merge. A discharged group is
  never sent: it would bounce (DEC-38) or die.
- **A plan** gathering its bonus for the capital that already takes it departs (``ReleasePlan``).
- **No CP** for the move: the decision spends no priced command, so the next CP go to it.

Only the ``PlayerView``, the map and the ruleset; ties by ``Bot.key`` (mirror-invariant).
"""

import heapq
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Final

from gow_bots.bots.base import Bot, node_of
from gow_bots.bots.utility import shots_to_take, takes, terrain_burned
from gow_sim.commands import Merge, Move, ReleasePlan, Split
from gow_sim.view import AtNode, Detail, GroupView, PlayerView

__all__ = ["OPEN_MEMORY_TICKS", "Take", "TakeCommand", "home_eta", "open_need", "take_capital"]

type TakeCommand = Move | Split | Merge | ReleasePlan
"""The commands ``take_capital`` sends."""

OPEN_MEMORY_TICKS: Final = 50
"""A sighting of the enemy capital in fog at most this old still counts (``assess.FRESH_TICKS``):
the bot saw its numbers a moment ago and its group is on the way out of sight."""
NEVER: Final = 1 << 30
"""``home_eta`` when no enemy is known anywhere."""


@dataclass(frozen=True, slots=True)
class Take:
    """What ``take_capital`` found: the command to send now (``None``: none), whether a taker
    waits for the CP of its move (``wait``), and whether a taker exists at all (``found``)."""

    cmd: TakeCommand | None = None
    wait: bool = False
    found: bool = False


def open_need(bot: Bot, view: PlayerView, tick: int) -> int | None:
    """The shots that take the enemy capital by the view now (module docstring); ``None`` when it
    is own or its numbers are not known."""
    node = bot.map.capital(1 - bot.player)
    n = view.nodes[node]
    if n.owner == bot.player:
        return None
    seen = n.seen
    if n.detail is Detail.FOG and (seen is None or tick - seen.tick > OPEN_MEMORY_TICKS):
        return None
    numbers = bot.enemy_at(view, node)
    if numbers is None:
        return None  # enemies there, numbers hidden (``PRESENCE``)
    need = 0
    if numbers[0] > 0:
        terrain = bot.map.nodes[node].terrain
        burned = terrain_burned(bot.rules, view, node)
        need = shots_to_take(bot.rules, terrain, numbers[0], numbers[1], burned=burned)
    return need + bot.open_support(view, tick, node, need)


def home_eta(bot: Bot, view: PlayerView) -> int:
    """Ticks the nearest enemy that the view shows could take to reach the own capital: from an
    enemy node (public ownership), a node with an enemy seen within ``OPEN_MEMORY_TICKS``, or the
    node an enemy figure on a road heads to; along any roads (``Times``). ``NEVER``: none."""
    home = bot.map.capital(bot.player)
    times = bot.times
    dist = [NEVER] * len(bot.map.nodes)
    dist[home] = 0
    queue = [(0, bot.key(home), home)]
    while queue:
        d, _, node = heapq.heappop(queue)
        if d > dist[node]:
            continue
        for eid in bot.incident[node]:
            other = bot.map.edges[eid].other(node)
            nd = d + times.ticks(eid, node)
            if nd < dist[other]:
                dist[other] = nd
                heapq.heappush(queue, (nd, bot.key(other), other))
    enemy = 1 - bot.player
    eta = NEVER
    for n in view.nodes:
        seen = n.seen
        fresh = seen is not None and seen.enemy_modes and view.tick - seen.tick <= OPEN_MEMORY_TICKS
        if n.owner == enemy or fresh:
            eta = min(eta, dist[n.id])
    for e in view.edges:
        edge = bot.map.edges[e.id]
        for f in e.enemy_groups:
            eta = min(eta, dist[edge.b if f.toward_b else edge.a])
    return eta


def take_capital(
    bot: Bot,
    view: PlayerView,
    tick: int,
    free: Sequence[GroupView],
    cp: int,
    may_leave: Callable[[GroupView], bool] = lambda g: True,
) -> Take:
    """The command that takes the open enemy capital now (module docstring). ``free``: the own
    groups the decision has not commanded, in mirror-invariant order; ``cp``: the CP in
    hundredths it may spend on it; ``may_leave``: the caller's own veto (a pinned node)."""
    need = open_need(bot, view, tick)
    if need is None:
        return Take()
    target = bot.map.capital(1 - bot.player)
    rules = bot.rules
    for g in view.groups:
        order = g.order
        if order is None or order.dest != target:
            continue
        if not order.gathering:
            return Take()  # one is on its way: the recall decides on it
        here = node_of(g)
        toll = bot.toll_from(view, here, target, g.units, g.charged)
        if takes(rules, g.charged, order.bonus, need, toll):
            return Take(ReleasePlan(g.id), found=True)  # free (DEC-41, item 10)
    home = bot.map.capital(bot.player)
    standing = bot.standing(view)
    eta: int | None = None
    best: tuple[int, int, int, int, TakeCommand] | None = None
    cost = rules.capture.charge_cost
    for g in free:
        if g.charged < cost or not isinstance(g.location, AtNode) or not may_leave(g):
            continue
        here = node_of(g)
        if here == target:
            continue
        size = bot.fit(view, here, target, g.units)
        if size < 1:
            continue
        charged = min(size, g.charged)
        way = bot.ways(view, here, size)[target]
        toll = bot.toll_on(view, way.edge, target, size, charged)
        if not takes(rules, charged, 0, need, toll):
            continue
        if here == home:
            if eta is None:
                eta = home_eta(bot, view)
            if way.ticks + 1 >= eta and standing[home] - size < bot.home_keep():
                continue  # the enemy could take the own capital first
        cmd: TakeCommand = Move(g.id, target) if size == g.units else Split(g.id, size)
        key = (way.ticks, bot.key(here), -g.units, -g.charged, cmd)
        if best is None or key[:4] < best[:4]:
            best = key
    if best is None:
        merge = _merge(bot, view, free, need, may_leave)
        return Take(merge, found=merge is not None)
    cmd = best[4]
    if bot.cost(cmd) > cp:
        return Take(wait=True, found=True)
    return Take(cmd, found=True)


def _merge(
    bot: Bot,
    view: PlayerView,
    free: Sequence[GroupView],
    need: int,
    may_leave: Callable[[GroupView], bool],
) -> Merge | None:
    """A ``Merge`` of the free groups of one node outside the own capital that take the enemy
    capital only together (they go in the next decision); nodes in ``node_key`` order."""
    target = bot.map.capital(1 - bot.player)
    home = bot.map.capital(bot.player)
    by_node: dict[int, list[GroupView]] = {}
    for g in free:
        if isinstance(g.location, AtNode) and may_leave(g):
            by_node.setdefault(node_of(g), []).append(g)
    for node in sorted(by_node, key=bot.key):
        groups = by_node[node]
        if node in (home, target) or len(groups) < 2:
            continue
        units = sum(g.units for g in groups)
        charged = sum(g.charged for g in groups)
        if bot.fit(view, node, target, units) != units:
            continue
        way = bot.ways(view, node, units)[target]
        toll = bot.toll_on(view, way.edge, target, units, charged)
        if takes(bot.rules, charged, 0, need, toll):
            return Merge(tuple(g.id for g in groups))
    return None
