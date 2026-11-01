"""Economy v2 for the bots (DEC-41, #642, #648; mechanics.md, section 7, "Economy v2").

Under ``economy.model = "v2"`` charges come only from factories and travel only along the lines a
player draws, so a bot that does not draw lines leaves every node but its capital without
supply. These helpers are the minimal v2 play every campaign bot shares; they read only the
``PlayerView``, the map and the ruleset, and every tie goes through ``Bot.key`` (mirror-invariant):

- **Lines** (``line_commands``; DEC-42: only a factory starts a line, any number of them): the
  own nodes that want charges (``wants``: own units without a charge standing there, a building
  that still owes charges, a node next to a foreign one with room in its warehouse, and the
  nodes a personality names), at most ``LINES_PER_FACTORY`` per own factory (a bot's choice: the
  round robin of a factory splits its charges over its lines), get a line from the nearest own
  factory. A built factory with no line into it is fed by a line from the own capital (a hub: it
  gives out what that line brings with its own production); these feeds do not count for the
  cap. Once the cap is reached, a line to a node no longer among the wanted ones gives its place
  up after ``LINE_HOLD_TICKS``. At most ``LINE_COMMANDS`` per decision.
- **Factories** (``factory_site``): one build at a time while the player has fewer than
  ``1 + extra`` factories (the capital is one) and the match has at least ``FACTORY_LATE_TICKS``
  left (4 charges pay back in 400 ticks at the built rate): the own city nearest the enemy
  capital that no enemy node touches, the largest warehouse first. It is paid by the lines
  (``wants``) and the groups standing there (the progressive payment of item 7).
- **Bunkers** (``bunker_site``): an own city or the capital next to an enemy node, with a full
  (or a ``bunker.cost``) warehouse so the payment does not take the defenders' charges, no
  fight and no bunker build owing elsewhere; the most VP first.
- **Plans** (``Bot.plan_bonus``, ``release_commands``): a planned order requests at most the
  stock of its node's warehouse and the charged units of the group (DEC-41, item 10); a plan that
  gathered for its requested time plus ``RELEASE_SLACK`` ticks departs with what it has
  (``ReleasePlan``), one without any bonus is cancelled.
"""

from collections import deque
from typing import Final

from gow_bots.bots.base import Bot
from gow_sim.commands import CancelOrder, Command, DrawLine, ReleasePlan, RemoveLine
from gow_sim.maps import NodeKind
from gow_sim.view import AtNode, NodeView, PlayerView

__all__ = [
    "FACTORY_LATE_TICKS",
    "LINES_PER_FACTORY",
    "LINE_COMMANDS",
    "LINE_HOLD_TICKS",
    "RELEASE_SLACK",
    "bunker_site",
    "factory_site",
    "line_commands",
    "release_commands",
    "wants",
]

LINE_COMMANDS: Final = 2
"""Line commands (``DrawLine``, ``RemoveLine``) per decision at most."""
LINE_HOLD_TICKS: Final = 200
"""A line stays at least this long before another wanted node takes its place (no flapping)."""
LINES_PER_FACTORY: Final = 4
"""Lines to wanted nodes per own factory at most (a bot's choice, not a rule: DEC-42 has no
limit)."""
FACTORY_LATE_TICKS: Final = 1500
"""No factory is started with fewer ticks left (its 4 charges pay back in 400 ticks plus the
build and the delivery)."""
RELEASE_SLACK: Final = 60
"""Ticks a gathering plan waits beyond its requested bonus times ``orders.plan_ticks_per_bonus``."""
W_WAIT: Final = 3
"""Weight of an own unit without a charge in ``wants``."""
W_FRONT: Final = 2
"""Weight of a node next to a foreign one in ``wants``."""


def waiting(view: PlayerView) -> list[int]:
    """Own units without a charge standing in each node."""
    wait = [0] * len(view.nodes)
    for g in view.groups:
        if isinstance(g.location, AtNode):
            wait[g.location.node] += g.units - g.charged
    return wait


def _owed(n: NodeView) -> int:
    owed = 0
    for build in (n.factory_build, n.fort_build):
        if build is not None:
            owed += build.owed
    if n.building is not None:
        owed += n.building.owed
    return owed


def wants(bot: Bot, view: PlayerView, extra: dict[int, int]) -> list[int]:
    """Own nodes with a warehouse that want charges, the most wanted first (module docstring);
    ``extra``: a personality's weight by node. Own factories make their own (not listed)."""
    me = view.player
    wait = waiting(view)
    far = bot.hops[bot.map.capital(1 - me)]
    province = bot.rules.warehouse.province
    scored: list[tuple[int, int, int, int]] = []
    for n in view.nodes:
        if n.owner != me or n.factory or n.warehouse is None:
            continue
        node = n.id
        cap = n.warehouse_cap if n.warehouse_cap is not None else province
        front = n.warehouse < cap and any(view.nodes[m].owner != me for m in bot.neighbors[node])
        score = W_WAIT * wait[node] + _owed(n) + (W_FRONT if front else 0) + extra.get(node, 0)
        if score > 0:
            scored.append((-score, far[node] if far[node] >= 0 else len(far), bot.key(node), node))
    scored.sort()
    return [s[3] for s in scored]


def _way(bot: Bot, view: PlayerView, start: int, ends: list[int]) -> tuple[int, ...] | None:
    """The shortest path over own nodes from the nearest of ``ends`` to ``start``, the source
    first, ties by ``node_key``; ``None``: none."""
    me = view.player
    parent: dict[int, int] = {start: start}
    queue = deque([start])
    found: int | None = None
    while queue and found is None:
        node = queue.popleft()
        for other in bot.neighbors[node]:  # in node_key order
            if other in parent or view.nodes[other].owner != me:
                continue
            parent[other] = node
            if other in ends:
                found = other
                break
            queue.append(other)
    if found is None:
        return None
    path = [found]
    while path[-1] != start:
        path.append(parent[path[-1]])
    return tuple(path)


def line_commands(
    bot: Bot, view: PlayerView, wanted: list[int], seen: dict[int, int]
) -> list[Command]:
    """Lines from the own factories to the most ``wanted`` nodes and the feeds of the built
    factories (module docstring); ``seen``: own line id to the tick it was first seen, kept up
    to date here (a line is removed only ``LINE_HOLD_TICKS`` after it)."""
    me, tick = view.player, view.tick
    factories = [n.id for n in view.nodes if n.owner == me and n.factory]
    live = {line.id: True for line in view.lines}
    for lid in sorted(seen):
        if lid not in live:
            del seen[lid]
    for line in view.lines:
        seen.setdefault(line.id, tick)
    if not factories:
        return []
    into: dict[int, bool] = {line.path[-1]: True for line in view.lines}
    plain = sum(1 for line in view.lines if not view.nodes[line.path[-1]].factory)
    cap = LINES_PER_FACTORY * len(factories)
    keep = {node: True for node in wanted[:cap]}
    cmds: list[Command] = []
    capital = bot.map.capital(me)
    if view.nodes[capital].owner == me and view.nodes[capital].factory:
        for hub in sorted(factories, key=bot.key):
            if hub == capital or into.get(hub, False) or len(cmds) >= LINE_COMMANDS:
                continue
            path = _way(bot, view, hub, [capital])
            if path is not None:
                cmds.append(DrawLine(path))
                into[hub] = True
    for target in keep:
        if len(cmds) >= LINE_COMMANDS:
            break
        if into.get(target, False):
            continue
        if plain >= cap:
            spare = [
                line
                for line in view.lines
                if not keep.get(line.path[-1], False)
                and not view.nodes[line.path[-1]].factory  # a hub feed stays
                and tick - seen[line.id] >= LINE_HOLD_TICKS
            ]
            if spare:
                drop = min(spare, key=lambda line: (bot.key(line.path[-1]), line.id))
                cmds.append(RemoveLine(drop.id))
            break  # the place is free in the next decision
        path = _way(bot, view, target, factories)
        if path is not None:
            cmds.append(DrawLine(path))
            plain += 1
            into[target] = True
    return cmds


def factory_site(bot: Bot, view: PlayerView, extra: int) -> int | None:
    """The own city that should start a factory now (module docstring), or ``None``."""
    rules = bot.rules
    me = view.player
    if extra <= 0 or rules.match_ticks - view.tick < FACTORY_LATE_TICKS:
        return None
    count = 0
    for n in view.nodes:
        if n.owner != me:
            continue
        if n.factory_build is not None:
            return None  # one at a time: the lines pay it first
        count += bool(n.factory)
    if count >= min(rules.factory_rules().max, 1 + extra):
        return None
    fights = bot.fight_nodes(view)
    far = bot.hops[bot.map.capital(1 - me)]
    best: tuple[int, int, int] | None = None
    site: int | None = None
    for n in view.nodes:
        node = n.id
        if n.owner != me or n.factory or bot.map.nodes[node].kind is NodeKind.PROVINCE:
            continue
        if node in fights or any(view.nodes[m].owner == 1 - me for m in bot.neighbors[node]):
            continue
        rank = (far[node] if far[node] >= 0 else len(far), -(n.warehouse_cap or 0), bot.key(node))
        if best is None or rank < best:
            best, site = rank, node
    return site


def bunker_site(bot: Bot, view: PlayerView, limit: int) -> int | None:
    """The own city next to an enemy node that should build a bunker now, or ``None``."""
    rules = bot.rules
    me = view.player
    if limit <= 0:
        return None
    count = 0
    for n in view.nodes:
        if n.owner != me:
            continue
        if n.fort_build is not None and n.fort_build.owed > 0:
            return None  # one payment at a time
        count += bool(n.fort) or n.fort_build is not None
    if count >= limit:
        return None
    cost = rules.bunker_rules().cost
    fights = bot.fight_nodes(view)
    best: tuple[int, int] | None = None
    site: int | None = None
    for n in view.nodes:
        node = n.id
        mdef = bot.map.nodes[node]
        if n.owner != me or n.fort or n.fort_build is not None or node in fights:
            continue
        if mdef.kind is NodeKind.PROVINCE or n.warehouse is None:
            continue
        if n.warehouse < min(cost, n.warehouse_cap or 0):
            continue
        if not any(view.nodes[m].owner == 1 - me for m in bot.neighbors[node]):
            continue
        vp = mdef.vp * (rules.victory.capital_multiplier if mdef.kind is NodeKind.CAPITAL else 1)
        rank = (-vp, bot.key(node))
        if best is None or rank < best:
            best, site = rank, node
    return site


def release_commands(bot: Bot, view: PlayerView, since: dict[int, int], tick: int) -> list[Command]:
    """``ReleasePlan`` for a gathering plan that waited its time (module docstring), a cancel
    for one that gathered nothing; ``since``: own group id to the tick its gathering was first
    seen, kept up to date here."""
    per = bot.rules.orders.plan_ticks_per_bonus
    live: dict[int, bool] = {}
    cmds: list[Command] = []
    for g in view.groups:
        order = g.order
        if order is None or not order.gathering:
            continue
        live[g.id] = True
        start = since.setdefault(g.id, tick)
        if tick - start < order.plan * per + RELEASE_SLACK:
            continue
        cmds.append(ReleasePlan(g.id) if order.bonus >= 1 else CancelOrder(g.id))
    for gid in sorted(since):
        if gid not in live:
            del since[gid]
    return cmds
