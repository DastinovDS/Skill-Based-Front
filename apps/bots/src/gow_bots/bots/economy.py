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
- **Factories** (``factory_site``, #683): one build at a time while the player has fewer than
  ``1 + extra`` factories (the capital is one) and the match has at least ``FACTORY_LATE_TICKS``
  left (4 charges pay back in 400 ticks at the built rate). The site is in the rear: an own city
  that no enemy node touches, not a leaf, reached from the own capital over own nodes none of
  which touches an enemy node (``safe_rear``: one capture next to the front does not cut it into
  a pocket, where a factory stops, DEC-43 item H2); the deepest first (the most road hops from
  every enemy node, up to ``SITE_DEPTH``), then the farthest from the enemy capital, the nearest
  to the own capital, the largest warehouse, ``Bot.key``. It
  is started only from spare stock (``spare_stock``: the warehouses of the capital's component
  hold ``factory.cost`` beyond what the own discharged units there and the other builds still
  want), so neither the pull of the unpaid build (DEC-43, item J) nor the refill of a rear
  garrison the progressive payment of item 7 discharged takes a charge an army waits for (the
  rear garrison pays at once and pulls the spare back). ``FactorySites`` remembers the own
  factory builds: a node where one was lost (the build stopped or the factory captured) is
  never a site again, and the bot replaces at most ``FACTORY_RESTARTS`` unpaid losses in a match
  (no rebuild churn). A loss is unpaid unless the factory had made at least ``factory.cost``
  charges by then (its ticks as an own factory outside a pocket over its ``factory_period``,
  rounded down; DEC-43 item H2: a factory in a pocket makes nothing): one that paid itself back
  does not count, so a factory that served before it fell is replaced.
- **Bunkers** (``bunker_site``): an own city or the capital next to an enemy node, with a full
  (or a ``bunker.cost``) warehouse so the payment does not take the defenders' charges, no
  fight and no bunker build owing elsewhere; the most VP first.
- **Plans** (``Bot.plan_bonus``, ``release_commands``): a planned order requests at most the
  stock of its node's warehouse and the charged units of the group (DEC-41, item 10); a plan that
  gathered for its requested time plus ``RELEASE_SLACK`` ticks departs with what it has
  (``ReleasePlan``), one without any bonus is cancelled.

Under the supply flow (DEC-43, ``supply.model = "flow"``, ``mvp-4``) there are no lines and no
bunker: ``line_commands`` and ``bunker_site`` give nothing, and the flow carries the charges by
itself. The one lever is the **leaf shift** (``leaf_shift_command``, DEC-43 item G): the level goes
one road back (``SetLeafShift(1)``) so new charges stop short of a node the bot may lose (a
captured warehouse is lost, DEC-43 item C), while an own leaf faces a visibly stronger enemy and
the bot attacks from none of them; back to the front (``0``) otherwise. #686 also kept the shift
back for 300 ticks after the enemy took an own node; #749 removed that: against the hold alone it
burned 1.4 to 2.3 times the share of its charges (at full warehouses behind the level) to save
about 5 charges a match from captured warehouses, and lost head to head (0.40 for it, 72 local
matches of three ``hard`` personalities). A
tired army ahead of the level still pulls its charges (items I6, I7), so the shift only stops the
refill of the leaf warehouses. Hysteresis (G-L of the ``mvp-4`` bot audit): the shift stays
``SHIFT_HOLD_TICKS`` after a change (``LeafShift``), it does not flap with every sighting.
**Road fortifications** (``fort_site``, DEC-43 item D) are the CP sink there: while the CP are
near the cap, an own node fortifies the road to an enemy neighbour where an enemy is in sight; an
attack whose every road into the target is fortified asks for the toll on top of its shots
(``Bot.toll_ahead``).
"""

from collections import deque
from dataclasses import dataclass, field
from typing import Final

from gow_bots.bots.base import Bot
from gow_sim.commands import CancelOrder, Command, DrawLine, ReleasePlan, RemoveLine, SetLeafShift
from gow_sim.maps import NodeKind
from gow_sim.view import AtNode, NodeView, PlayerView

__all__ = [
    "FACTORY_LATE_TICKS",
    "FACTORY_RESTARTS",
    "LINES_PER_FACTORY",
    "LINE_COMMANDS",
    "LINE_HOLD_TICKS",
    "RELEASE_SLACK",
    "SHIFT_HOLD_TICKS",
    "SITE_DEPTH",
    "FactorySites",
    "LeafShift",
    "bunker_site",
    "factory_site",
    "fort_site",
    "leaf_shift_command",
    "line_commands",
    "release_commands",
    "safe_rear",
    "spare_stock",
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
FACTORY_RESTARTS: Final = 1
"""Unpaid losses of factory builds (a build stopped, or a built factory captured before it made
``factory.cost`` charges) the bot replaces at most in a match; past them it builds no more
factories (#683: no rebuild churn). A factory that paid itself back is no such loss."""
SITE_DEPTH: Final = 3
"""Road hops from every enemy node beyond which factory sites count as equally safe; among those the
farthest from the enemy capital is picked (#683: the rear of the map, not the centre the enemy
comes through)."""
RELEASE_SLACK: Final = 60
"""Ticks a gathering plan waits beyond its requested bonus times ``orders.plan_ticks_per_bonus``."""
W_WAIT: Final = 3
"""Weight of an own unit without a charge in ``wants``."""
W_FRONT: Final = 2
"""Weight of a node next to a foreign one in ``wants``."""
LEAF_MARGIN: Final = 1
"""Charged enemy units beyond the own charged units of a leaf that make it "visibly stronger"
(``leaf_shift_command``)."""
SHIFT_HOLD_TICKS: Final = 300
"""The leaf shift stays at least this many ticks (30 s) after it changed (G-L: no flapping)."""


@dataclass(slots=True)
class FactorySites:
    """What ``factory_site`` remembers between decisions, all from the own views (#683)."""

    mine: dict[int, bool] = field(default_factory=dict[int, bool])
    """Nodes where an own factory build was seen and the build or the factory it became is still
    the player's."""
    lost: dict[int, bool] = field(default_factory=dict[int, bool])
    """Nodes where an own factory build or the factory it became was lost: never a site again."""
    unpaid: int = 0
    """Losses of those that had not made ``factory.cost`` charges (``FACTORY_RESTARTS``)."""
    worked: dict[int, int] = field(default_factory=dict[int, int])
    """Ticks each of ``mine`` has worked as an own factory outside a pocket, from the views."""
    period: dict[int, int] = field(default_factory=dict[int, int])
    """``factory_period`` of each of ``mine`` that has been seen as a factory."""
    running: dict[int, bool] = field(default_factory=dict[int, bool])
    """Those of ``mine`` that were working factories in the last view."""
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
            if self.running.get(node, False):  # it worked since the last view
                self.worked[node] = self.worked.get(node, 0) + dt
            n = view.nodes[node]
            if n.owner == me and (n.factory or n.factory_build is not None):
                working = bool(n.factory) and n.flow_pocket is not True
                self.running[node] = working
                if n.factory and n.factory_period:
                    self.period[node] = n.factory_period
                continue
            period = self.period.get(node, 0)
            made = self.worked.get(node, 0) // period if period > 0 else 0  # rounded down
            if made < cost:
                self.unpaid += 1
            del self.mine[node]
            self.worked.pop(node, None)
            self.running.pop(node, None)
            self.lost[node] = True


@dataclass(slots=True)
class LeafShift:
    """What ``leaf_shift_command`` remembers between decisions, all from the own views."""

    shift: int | None = None
    """The shift in force in the last view."""
    since: int | None = None
    """The tick that shift was first seen in force; ``None``: never changed in this match."""

    def observe(self, view: PlayerView) -> None:
        shift = view.me.leaf_shift
        if self.shift is not None and shift != self.shift:
            self.since = view.tick
        self.shift = shift


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
    to date here (a line is removed only ``LINE_HOLD_TICKS`` after it). Nothing under the
    supply flow (DEC-43, item A12)."""
    if bot.rules.flow:
        return []
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


def _home(bot: Bot, view: PlayerView) -> list[int]:
    """The own nodes joined to the own capital over own nodes (the capital's component, DEC-43
    item H1), in BFS order; empty when the capital is lost."""
    me = view.player
    capital = bot.map.capital(me)
    if view.nodes[capital].owner != me:
        return []
    seen = {capital: True}
    order = [capital]
    queue = deque([capital])
    while queue:
        node = queue.popleft()
        for other in bot.neighbors[node]:
            if other not in seen and view.nodes[other].owner == me:
                seen[other] = True
                order.append(other)
                queue.append(other)
    return order


def spare_stock(bot: Bot, view: PlayerView) -> int:
    """Charges the capital's component can give a new build without taking one a waiting unit or
    another build wants: its warehouses, minus the own units without a charge standing in it and
    the charges its builds still owe (may be negative)."""
    home = {node: True for node in _home(bot, view)}
    stock = 0
    for node in home:
        n = view.nodes[node]
        stock += (n.warehouse or 0) - _owed(n)
    for g in view.groups:
        if isinstance(g.location, AtNode) and g.location.node in home:
            stock -= g.units - g.charged
    return stock


def safe_rear(bot: Bot, view: PlayerView) -> dict[int, int]:
    """The own nodes no enemy node touches that the own capital reaches over such nodes (the
    capital itself always counts as a start), with the road hops from the capital over them."""
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
        for other in bot.neighbors[node]:  # in node_key order
            if other in dist or view.nodes[other].owner != me or touches_enemy(other):
                continue
            dist[other] = dist[node] + 1
            queue.append(other)
    return dist


def factory_site(bot: Bot, view: PlayerView, extra: int, memory: FactorySites) -> int | None:
    """The own city that should start a factory now (module docstring), or ``None``; ``memory``
    is updated on every call."""
    rules = bot.rules
    memory.observe(view, rules.factory_rules().cost)
    me = view.player
    if extra <= 0 or rules.match_ticks - view.tick < FACTORY_LATE_TICKS:
        return None
    if memory.unpaid > FACTORY_RESTARTS:
        return None  # no rebuild churn
    count = 0
    for n in view.nodes:
        if n.owner != me:
            continue
        if n.factory_build is not None:
            return None  # one at a time
        count += bool(n.factory)
    if count >= min(rules.factory_rules().max, 1 + extra):
        return None
    if spare_stock(bot, view) < rules.factory_rules().cost:
        return None  # the payment would take charges the army waits for
    rear = safe_rear(bot, view)
    enemy = [n.id for n in view.nodes if n.owner == 1 - me]
    if not enemy:
        enemy = [bot.map.capital(1 - me)]
    count_nodes = len(view.nodes)
    fights = bot.fight_nodes(view)
    far = bot.hops[bot.map.capital(1 - me)]
    best: tuple[int, int, int, int, int] | None = None
    site: int | None = None
    for node in sorted(rear):
        n = view.nodes[node]
        if n.factory or bot.map.nodes[node].kind is NodeKind.PROVINCE:
            continue
        if node in fights or node in memory.lost:
            continue
        if n.front_dist == 0:
            continue  # a leaf: the flow fills it first and it is the first one lost
        hops = bot.hops[node]
        depth = min(hops[e] if hops[e] >= 0 else count_nodes for e in enemy)
        rank = (
            -min(depth, SITE_DEPTH),
            -(far[node] if far[node] >= 0 else count_nodes),
            rear[node],
            -(n.warehouse_cap or 0),
            bot.key(node),
        )
        if best is None or rank < best:
            best, site = rank, node
    return site


def bunker_site(bot: Bot, view: PlayerView, limit: int) -> int | None:
    """The own city next to an enemy node that should build a bunker now, or ``None``; always
    ``None`` without a ``[bunker]`` section (``mvp-4``, DEC-43 item D1)."""
    rules = bot.rules
    me = view.player
    if limit <= 0 or rules.bunker is None:
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


def fort_site(bot: Bot, view: PlayerView, budget: int) -> tuple[int, int] | None:
    """The road fortification to build now (DEC-43, item D), ``(node, edge)``, or ``None``; always
    ``None`` without ``[fort]``.

    Only while the CP are near their cap (``cp.cap - cp.per_period`` or more: the next income
    would burn in part) and ``budget`` pays ``fort.cost``: an own node (a city or a province)
    with no fight, on the road to an enemy neighbour it does not fortify yet, where an enemy is
    in sight (in that neighbour or as a figure on that road). The most VP of the own node first
    (the capital counted with its multiplier), then the most enemy units seen there, then
    ``Bot.key`` of the node and of the neighbour (mirror-invariant)."""
    rules = bot.rules
    fort = rules.fort
    if fort is None or budget < fort.cost or view.me.cp < rules.cp.cap - rules.cp.per_period:
        return None
    me = view.player
    fights = bot.fight_nodes(view)
    best: tuple[int, int, int, int] | None = None
    site: tuple[int, int] | None = None
    for n in view.nodes:
        node = n.id
        if n.owner != me or node in fights:
            continue
        mdef = bot.map.nodes[node]
        vp = mdef.vp * (rules.victory.capital_multiplier if mdef.kind is NodeKind.CAPITAL else 1)
        for eid in bot.map.incident[node]:
            other = bot.map.edges[eid].other(node)
            if view.nodes[other].owner != 1 - me:
                continue
            edge = view.edges[eid]
            if any(f.node == node for f in edge.forts):
                continue
            seen = view.nodes[other].seen
            units = 0 if seen is None else (seen.enemy_units or len(seen.enemy_modes))
            units += sum(g.units or 1 for g in edge.enemy_groups)
            if units <= 0:
                continue
            rank = (-vp, -units, bot.key(node), bot.key(other))
            if best is None or rank < best:
                best, site = rank, (node, eid)
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


def leaf_shift_command(bot: Bot, view: PlayerView, memory: LeafShift) -> Command | None:
    """The leaf shift the bot wants now under the supply flow (module docstring), as a command
    when it differs from the one in force and the one in force has stood ``SHIFT_HOLD_TICKS``;
    ``None`` otherwise and under any other supply model. ``memory`` is updated on every call.

    "Visibly stronger": a neighbour of the enemy whose charged units as the view tells them
    (``Bot.enemy_at``; a presence without numbers counts as nothing) exceed the own charged units
    standing in the leaf by more than ``LEAF_MARGIN``. "Attacks": an own group has an order to a
    node the player does not own. Reads only the own view (ownership, the own ``front_dist`` and
    shift)."""
    me = view.me
    if not bot.rules.flow or me.leaf_shift is None or me.leaf_shift_max is None:
        return None
    memory.observe(view)
    if memory.since is not None and view.tick - memory.since < SHIFT_HOLD_TICKS:
        return None
    player = view.player
    attacking = any(
        g.order is not None and view.nodes[g.order.dest].owner != player for g in view.groups
    )
    want = 0
    if not attacking:
        charged = [0] * len(view.nodes)
        for g in view.groups:
            if isinstance(g.location, AtNode):
                charged[g.location.node] += g.charged
        for n in view.nodes:
            if n.owner != player or n.front_dist != 0:
                continue
            for m in bot.neighbors[n.id]:
                if view.nodes[m].owner != 1 - player:
                    continue
                seen = bot.enemy_at(view, m)
                if seen is not None and seen[1] > charged[n.id] + LEAF_MARGIN:
                    want = 1
    want = min(want, me.leaf_shift_max)
    return None if want == me.leaf_shift else SetLeafShift(want)
