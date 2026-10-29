"""The assessment layer of the smart bots (#166): what the position is, from ``PlayerView`` only.

Computed once per decision (``Assessor.assess``) and read by every priority of ``SmartBot``; the
personalities differ only in how they weigh it. Everything here is public or own data of the
view (AGENTS.md, section 4.4; DEC-35: only own groups see, the own territory is known), the map
and the ruleset. Four parts:

- **VP forecast** (mechanics.md, section 11; DEC-03): each side keeps its VP now and earns the VP
  of the cities it owns now (public ownership, ``vp`` of the map, the capital times
  ``victory.capital_multiplier``) at every award left. A side is *ahead* when its forecast is at
  least ``VP_MARGIN`` (+1) above the other's: a tie on VP is decided by the cities and is not a
  lead to sit on.
- **Threat to the own capital**: the enemy forces the view shows (figures on edges, DEC-33; enemy
  groups sighted in nodes, fresh sightings in the Attack mode only; planned strikes, DEC-08; a
  fight in the capital, DEC-24) with the earliest tick each can reach the capital (``Travel``:
  a lower bound of the travel time). The forces that arrive within ``horizon`` ticks of the
  earliest one are summed; numbers hidden by the fog are guessed (``guess`` units, all
  charged). The capital is *in danger* when that sum reaches the shots that take the capital
  from its garrison now (``shots_to_take``, with the own Defense bonus the view shows).
- **Upper bound of the enemy CP** (``EnemyCp``): the enemy CP and stance are hidden (AGENTS.md,
  section 4.4), the regeneration is not: the bound starts at ``cp.start``, gains the largest CP
  share of a quantum (the stance with the fewest charges) every ``cp.period_ticks``, stops at
  ``cp.cap``, and loses the price of every payment the view shows at the tick it is paid: the
  intents of planned orders and of Defense (public at their creation). Payments the view does not
  show (ordinary orders, recruits) are not subtracted, so the bound is never below the truth.
- **Own state** (``Army``): units, charges and the uncharged units of the own groups, the
  warehouses of the own cities, the cities cut from the own capital.

Pure functions of the view except ``EnemyCp``, which keeps the bound between decisions; no
randomness, no ``set`` iteration (AGENTS.md, section 4.1 holds for the bots too).
"""

import heapq
from dataclasses import dataclass
from typing import Final

from gow_bots.bots.utility import shots_to_take
from gow_sim.maps import MapDef, NodeKind, Terrain
from gow_sim.ruleset import Ruleset, Stance
from gow_sim.view import AtNode, Detail, EnemyGroupView, IntentKind, Mode, PlayerView, Sighting

__all__ = [
    "FRESH_TICKS",
    "VP_MARGIN",
    "Army",
    "Assessment",
    "Assessor",
    "EnemyCp",
    "Threat",
    "Travel",
    "army",
    "awards_left",
    "vp_rates",
]

VP_MARGIN: Final = 1
"""A lead counts when the forecast is at least this many VP above the other side's."""
FRESH_TICKS: Final = 50
"""An enemy sighting in a node older than this is not a force of the threat: it moved on."""


class Travel:
    """Lower bounds of the travel ticks between all nodes of the map.

    Every edge at the fastest terrain speed and the fastest road speed of the ruleset
    (``travel_ticks * 100 * 100 // (terrain * road)``, rounded down): no group is quicker, so an
    ETA from this table is the earliest possible one. Dijkstra from every node once per bot.
    """

    def __init__(self, mapdef: MapDef, rules: Ruleset) -> None:
        terrain = max(rules.terrain.speed_pct.of(t) for t in Terrain)
        road = max(100, *rules.road.speed_pct.values)
        count = len(mapdef.nodes)
        adj: list[list[tuple[int, int]]] = [[] for _ in range(count)]
        for e in mapdef.edges:
            ticks = e.travel_ticks * 100 * 100 // (terrain * road)
            adj[e.a].append((e.b, ticks))
            adj[e.b].append((e.a, ticks))
        self.edge_ticks: tuple[int, ...] = tuple(
            e.travel_ticks * 100 * 100 // (terrain * road) for e in mapdef.edges
        )
        """The lower bound of every edge, by edge id."""
        self.ticks: tuple[tuple[int, ...], ...] = tuple(
            self._dijkstra(adj, start) for start in range(count)
        )
        """``ticks[a][b]``: the least travel ticks from ``a`` to ``b`` (``-1``: unreachable)."""

    @staticmethod
    def _dijkstra(adj: list[list[tuple[int, int]]], start: int) -> tuple[int, ...]:
        best = [-1] * len(adj)
        best[start] = 0
        queue = [(0, start)]
        while queue:
            ticks, node = heapq.heappop(queue)
            if ticks > best[node]:
                continue
            for other, step in adj[node]:
                t = ticks + step
                if best[other] < 0 or t < best[other]:
                    best[other] = t
                    heapq.heappush(queue, (t, other))
        return tuple(best)


def awards_left(rules: Ruleset, tick: int) -> int:
    """VP awards still to come after ``tick`` (one every ``victory.vp_period_ticks``, the last on
    the last tick, DEC-03)."""
    period = rules.victory.vp_period_ticks
    return max(0, rules.match_ticks // period - tick // period)


def vp_rates(view: PlayerView, mapdef: MapDef, rules: Ruleset) -> tuple[int, int]:
    """VP per award of each side by player id, from the public ownership of the cities."""
    rate = [0, 0]
    mult = rules.victory.capital_multiplier
    for n in view.nodes:
        if n.owner is None:
            continue
        node = mapdef.nodes[n.id]
        rate[n.owner] += node.vp * (mult if node.capital_of is not None else 1)
    return (rate[0], rate[1])


@dataclass(frozen=True, slots=True)
class Army:
    """The own forces and supply as the view shows them."""

    units: int
    charged: int
    uncharged_standing: int
    """Units without a charge in groups that stand in an own node: they wait for supply."""
    warehouse: int
    """Charges in the warehouses of the own cities."""
    warehouse_cap: int
    cities: int
    """Own cities (provinces are not cities, DEC-23)."""
    cut: int
    """Own nodes not connected to the own capital through own nodes (public ownership)."""


def army(view: PlayerView, mapdef: MapDef, supplied: list[bool]) -> Army:
    """``Army`` of the player of ``view``; ``supplied``: own nodes connected to the capital."""
    me = view.player
    units = charged = uncharged = 0
    for g in view.groups:
        units += g.units
        charged += g.charged
        loc = g.location
        if isinstance(loc, AtNode) and view.nodes[loc.node].owner == me:
            uncharged += g.units - g.charged
    warehouse = cap = cities = cut = 0
    for n in view.nodes:
        if n.owner != me:
            continue
        cut += not supplied[n.id]
        if mapdef.nodes[n.id].kind is NodeKind.PROVINCE:
            continue
        cities += 1
        warehouse += n.warehouse or 0
        cap += n.warehouse_cap or 0
    return Army(units, charged, uncharged, warehouse, cap, cities, cut)


class EnemyCp:
    """The upper bound of the enemy CP in hundredths (module docstring)."""

    def __init__(self, rules: Ruleset, enemy: int) -> None:
        self.rules = rules
        self.enemy = enemy
        least = min(rules.economy.stance_to_charges_pct.of(s) for s in Stance)
        per = rules.cp.per_period
        self.gain = per - per * least // 100
        """The largest CP part of a regeneration quantum."""
        self.bound = rules.cp.start
        self.tick = 0
        self.paid: dict[int, bool] = {}
        """Opaque ids of the enemy intents already subtracted."""

    def update(self, view: PlayerView) -> int:
        """Advance the bound to ``view.tick`` and return it."""
        if view.tick < self.tick:
            raise ValueError(f"view of tick {view.tick} after tick {self.tick}")
        cost = self.rules.orders.cost
        pays: list[tuple[int, int]] = []
        for i in view.intents:
            if i.owner != self.enemy or i.id in self.paid:
                continue
            self.paid[i.id] = True
            price = cost.planned_move if i.kind is IntentKind.PLANNED_MOVE else cost.defense
            pays.append((i.created_tick, price))
        pays.sort()
        period = self.rules.cp.period_ticks
        bound, at = self.bound, self.tick
        for tick, price in pays:
            # Commands are applied before the economy of their tick (AGENTS.md, section 4.2).
            bound = self._regen(bound, at, tick - 1, period)
            bound, at = max(0, bound - price), max(at, tick - 1)
        self.bound = self._regen(bound, at, view.tick, period)
        self.tick = view.tick
        live = {i.id for i in view.intents}
        self.paid = {i: True for i in sorted(self.paid) if i in live}
        return self.bound

    def _regen(self, bound: int, after: int, until: int, period: int) -> int:
        """The bound after the regeneration ticks in ``after + 1 .. until``."""
        periods = max(0, until // period - max(0, after) // period)
        return min(self.rules.cp.cap, bound + periods * self.gain)

    def ticks_to(self, cp: int, tick: int) -> int:
        """Ticks from ``tick`` until the bound can reach ``cp`` (0: it may already be there)."""
        if self.bound >= cp:
            return 0
        if self.gain <= 0:
            return self.rules.match_ticks
        period = self.rules.cp.period_ticks
        periods = -(-(cp - self.bound) // self.gain)
        return (tick // period + periods) * period - tick


@dataclass(frozen=True, slots=True)
class Threat:
    """The enemy forces the view shows that can reach the own capital (module docstring)."""

    eta: int | None
    """The earliest tick a shown enemy force can be in the capital; ``None``: none shown."""
    units: int
    """Enemy units (an upper guess, all of them taken as charged) arriving within the horizon."""
    need: int
    """Shots that take the capital from its garrison now (``shots_to_take``)."""

    @property
    def danger(self) -> bool:
        return self.eta is not None and self.units >= self.need


@dataclass(frozen=True, slots=True)
class Assessment:
    """The position at one decision (module docstring)."""

    tick: int
    awards_left: int
    vp: tuple[int, int]
    """Own VP now, enemy VP now."""
    rate: tuple[int, int]
    """Own VP per award, enemy VP per award."""
    threat: Threat
    enemy_cp: int
    """Upper bound of the enemy CP in hundredths."""
    own: Army
    cp: int
    """Own CP in hundredths."""

    @property
    def forecast(self) -> tuple[int, int]:
        """Own and enemy VP at the end of the match if ownership stays as it is."""
        left = self.awards_left
        return (self.vp[0] + self.rate[0] * left, self.vp[1] + self.rate[1] * left)

    @property
    def lead(self) -> int:
        own, enemy = self.forecast
        return own - enemy

    @property
    def ahead(self) -> bool:
        return self.lead >= VP_MARGIN


class Assessor:
    """Builds the ``Assessment`` of every decision of one bot (one side of one match)."""

    def __init__(self, mapdef: MapDef, rules: Ruleset, player: int, travel: Travel) -> None:
        self.map = mapdef
        self.rules = rules
        self.player = player
        self.travel = travel
        self.capital = mapdef.capital(player)
        self.enemy_cp = EnemyCp(rules, 1 - player)

    def assess(
        self, view: PlayerView, supplied: list[bool], *, guess: int, horizon: int
    ) -> Assessment:
        """The assessment of ``view``. ``guess``: units assumed for an enemy force whose numbers
        are hidden; ``horizon``: ticks after the first arrival that still add to the threat."""
        me = view.player
        bound = self.enemy_cp.update(view)
        rates = vp_rates(view, self.map, self.rules)
        return Assessment(
            tick=view.tick,
            awards_left=awards_left(self.rules, view.tick),
            vp=(view.vp[me], view.vp[1 - me]),
            rate=(rates[me], rates[1 - me]),
            threat=self.threat(view, guess, horizon),
            enemy_cp=bound,
            own=army(view, self.map, supplied),
            cp=view.me.cp,
        )

    def threat(self, view: PlayerView, guess: int, horizon: int) -> Threat:
        """The ``Threat`` to the own capital (module docstring)."""
        cap = self.capital
        to_cap = [row[cap] for row in self.travel.ticks]
        forces: list[tuple[int, int]] = []  # (eta, units)
        # A force standing in a node needs a new order: not before the enemy can pay for one.
        order_wait = self.enemy_cp.ticks_to(self.rules.orders.cost.move, view.tick)
        by_node: dict[int, tuple[int, int]] = {}
        for n in view.nodes:
            seen = n.seen
            if n.id == cap or seen is None or not seen.enemy_modes or to_cap[n.id] < 0:
                continue
            if view.tick - seen.tick > FRESH_TICKS or Mode.ATTACK not in seen.enemy_modes:
                continue  # an old sighting, or groups in Defense: a move would drop the bonus
            eta = max(view.tick + order_wait, seen.tick + to_cap[n.id])
            by_node[n.id] = (eta, _units(seen, guess))
        for i in view.intents:
            if i.owner == view.player or i.kind is not IntentKind.PLANNED_MOVE:
                continue
            if i.target != cap and (i.target is None or to_cap[i.target] < 0):
                continue
            way = to_cap[i.origin]
            if way < 0:
                continue
            eta = max(view.tick, i.created_tick + self.rules.orders.planned_delay_ticks + way)
            known = by_node.get(i.origin)
            units = max(guess, known[1] if known is not None else 0)
            by_node[i.origin] = (min(eta, known[0]) if known is not None else eta, units)
        forces.extend(by_node[n] for n in sorted(by_node))
        for e in view.edges:
            for f in e.enemy_groups:
                eta = self._figure_eta(e.id, f, to_cap)
                if eta is not None:
                    forces.append((view.tick + eta, _figure_units(f, guess)))
        for f in view.fights:
            if f.node == cap:
                forces.append((view.tick, f.enemy_units))
        own_units = own_charged = defense = 0
        for g in view.groups:
            loc = g.location
            if isinstance(loc, AtNode) and loc.node == cap:
                own_units += g.units
                own_charged += g.charged
                defense += g.defense_bonus or 0
        terrain = self.map.nodes[cap].terrain
        need = shots_to_take(self.rules, terrain, own_units, own_charged, defense)
        if not forces:
            return Threat(None, 0, need)
        eta = min(t for t, _ in forces)
        units = sum(u for t, u in forces if t <= eta + horizon)
        return Threat(eta, units, need)

    def _figure_eta(self, edge: int, f: EnemyGroupView, to_cap: list[int]) -> int | None:
        """Ticks until figure ``f`` on ``edge`` can be in the capital, ``None``: never."""
        e = self.map.edges[edge]
        node = e.b if f.toward_b else e.a
        if to_cap[node] < 0:
            return None
        left = 1000 - f.pos if f.toward_b else f.pos
        return self.travel.edge_ticks[edge] * left // 1000 + to_cap[node]


def _units(seen: Sighting, guess: int) -> int:
    if seen.enemy_units is not None:
        return seen.enemy_units
    if seen.enemy_range is not None:
        low, high = seen.enemy_range
        return low if high is None else high
    return guess


def _figure_units(f: EnemyGroupView, guess: int) -> int:
    if f.detail is Detail.EXACT and f.units is not None:
        return f.units
    if f.units_range is not None:
        low, high = f.units_range
        return low if high is None else high
    return guess
