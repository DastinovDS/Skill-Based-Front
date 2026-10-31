"""Economy v2 for the bots (DEC-41, #642, #648; mechanics.md, section 7, "Economy v2").

Under ``economy.model = "v2"`` charges come only from factories and travel only along the lines a
player draws, so a bot that does not draw lines leaves every node but its capital without
supply. These helpers are the minimal v2 play every campaign bot shares; they read only the
``PlayerView``, the map and the ruleset, and every tie goes through ``Bot.key`` (mirror-invariant):

- **Lines** (``line_commands``): the own nodes that want charges (``wants``: own units without a
  charge standing there, a building that still owes charges, a node next to a foreign one with
  room in its warehouse, and the nodes a personality names), as many as the factories have
  slots (``lines.max_out`` each), get a line from the nearest own source with a free slot: a
  factory or the target of an own line (a relay passes charges on even with a full warehouse,
  owner decision 2026-10-31, #661), so the lines grow into a tree. A line to a node no longer
  among the wanted ones gives its slot up after ``LINE_HOLD_TICKS`` unless lines leave its
  target; a line whose source is neither a factory nor a line target any more goes first. At
  most ``LINE_COMMANDS`` per decision.
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
"""A line stays at least this long before another wanted node takes its slot (no flapping)."""
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
    """Lines from the own sources to the most ``wanted`` nodes their slots serve (module
    docstring); ``seen``: own line id to the tick it was first seen, kept up to date here (a
    line is removed only ``LINE_HOLD_TICKS`` after it)."""
    me, tick = view.player, view.tick
    max_out = bot.rules.line_rules().max_out
    factories = [n.id for n in view.nodes if n.owner == me and n.factory]
    live = {line.id: True for line in view.lines}
    for lid in sorted(seen):
        if lid not in live:
            del seen[lid]
    for line in view.lines:
        seen.setdefault(line.id, tick)
    out: dict[int, int] = {}
    into: dict[int, bool] = {}
    for line in view.lines:
        out[line.path[0]] = out.get(line.path[0], 0) + 1
        into[line.path[-1]] = True
    sources = factories + [
        n for n in sorted(into) if view.nodes[n].owner == me and n not in factories
    ]
    keep = {node: True for node in wanted[: max_out * len(sources)]}
    cmds: list[Command] = []
    for line in view.lines:  # a source that lost its own feed carries nothing
        source = line.path[0]
        orphan = not view.nodes[source].factory and not into.get(source, False)
        if orphan and len(cmds) < LINE_COMMANDS:
            cmds.append(RemoveLine(line.id))
    for target in keep:
        if len(cmds) >= LINE_COMMANDS:
            break
        if into.get(target, False):
            continue
        free = [f for f in sources if out.get(f, 0) < max_out]
        path = _way(bot, view, target, free) if free else None
        if path is not None:
            cmds.append(DrawLine(path))
            out[path[0]] = out.get(path[0], 0) + 1
            into[target] = True
            continue
        spare = [
            line
            for line in view.lines
            if not keep.get(line.path[-1], False)
            and not out.get(line.path[-1], 0)  # it feeds lines of its own
            and tick - seen[line.id] >= LINE_HOLD_TICKS
        ]
        if spare:
            drop = min(spare, key=lambda line: (bot.key(line.path[-1]), line.id))
            cmds.append(RemoveLine(drop.id))
            break  # the slot is free in the next decision
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
