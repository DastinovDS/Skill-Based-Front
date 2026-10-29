"""Movement on the graph (SIM-05): path search and the movement system.

Rules (mechanics.md, sections 4 and 5; DEC-07, rules 6 and 8; AGENTS.md, section 4.1):

- Terrain speed by zone (owner's decision of 2026-10-14, #253; mechanics.md, section 4): the
  border point ``border_permille`` splits an edge; the part next to node A goes at
  ``terrain.speed_pct`` of A's terrain, the part next to node B at that of B. ``Leg`` holds the
  integer formulas of crossing an edge from A to B: ``traversal_ticks`` ``T`` and ``progress``
  after ``k`` ticks. An edge of one terrain ``p`` keeps ``T = travel_ticks * 100 // p`` and
  ``progress = k * 1000 // T``.
- Road level (DEC-28, item 7): an upgraded road multiplies the terrain speed of both zones by
  ``road.speed_pct[level]`` (level 1: 100): the effective speed of a zone is
  ``terrain_pct * road_pct // 100`` (rounded down). The level is read when the group enters the
  edge (``OnEdge.level``), so an upgrade finished meanwhile does not change its time; the path
  search and the ticks of a path use the current levels. It applies to the groups of both players.
- ``progress`` is in thousandths of the edge from the node the group left; the group arrives on
  tick ``T``. Groups stand only in nodes.
- A path goes only through own nodes: the path search never expands a node of another player or
  a neutral one, so the first such node is the end of the path, the target of an attack or a
  capture. If an own node on the way is lost meanwhile, the group stops there on arrival.
- Dijkstra over ``traversal_ticks``; among paths of equal time the one whose sequence of
  ``node_key(player, node)`` is lexicographically smallest wins, so the rot180 mirror of a position
  gives the mirrored path.
- Stack limit (DEC-20, D): a group of ``units`` goes only through nodes (intermediate ones and the
  target) whose capacity is at least ``units``; the search skips the other nodes, so the chosen
  path may be slower than the fastest one. ``Move`` checks it once, with the group's size.
- Two phases: first every group moves and every arrival is fixed (``advance``), then the arrivals
  are settled (``settle_arrivals``): an empty neutral node reached by groups of one player only
  is captured. Everything else at a node or on an edge with both players is left to combat
  (SIM-09, #25), which runs after this system. No step depends on the order of the players.

Timing: a group whose order may depart this tick (``state.tick >= order.depart_tick``) leaves
its node and makes its first step in the same tick. An intermediate own node is passed without a
stop: in the tick of reaching it the group is already on the next edge with ``progress == 0``, so
between ticks a group in transit is never ``AtNode`` (capacity counts only standing groups,
DEC-12). A path of edges of ``T1`` and ``T2`` ticks thus takes ``T1 + T2`` ticks. Only reaching
the end of the path (the destination, or a node that is no longer own) is an ``Arrival``.
A planned order's bonus is capped by the group's charged units when it departs (DEC-29).
"""

import heapq
from dataclasses import dataclass
from itertools import pairwise

from gow_sim.maps import MapDef
from gow_sim.ruleset import Ruleset
from gow_sim.state import PROGRESS_SCALE, AtNode, Event, GameState, OnEdge, Order, event
from gow_sim.systems.capacity import change_owner, city_capacity


def border_permille(mapdef: MapDef, edge: int) -> int:
    """The border point of ``edge`` in thousandths from its end ``a`` (DEC-21, DEC-23, item 5).

    The single source of the border point for every rule: the map field ``border_permille``.
    """
    return mapdef.edges[edge].border_permille


@dataclass(frozen=True, slots=True)
class Leg:
    """Crossing an edge from node A to node B in two terrain zones (#253, mechanics.md, section 4).

    ``border``: the border point ``b`` in thousandths from A; ``pa``, ``pb``: ``terrain.speed_pct``
    of A and B; ``d = b * pb + (1000 - b) * pa``; ``ticks``: ``T``. The formulas take every
    number non-negative, so ``//`` rounds down.
    """

    ticks: int
    border: int
    pa: int
    pb: int
    d: int

    def progress(self, spent: int) -> int:
        """``progress`` after ``spent`` ticks on the edge: ``k * d // (T * pb)`` in the zone of A
        (while ``k * d <= T * b * pb``), ``b + (k * d - T * b * pb) // (T * pa)`` in the zone of
        B; exactly ``PROGRESS_SCALE`` from ``T`` on."""
        t = self.ticks
        if spent >= t:
            return PROGRESS_SCALE
        at_border = t * self.border * self.pb
        if spent * self.d <= at_border:
            return spent * self.d // (t * self.pb)
        return self.border + (spent * self.d - at_border) // (t * self.pa)

    def spent(self, progress: int) -> int:
        """Ticks behind ``progress``, the inverse of ``progress()``: the least ``k`` whose exact
        position reaches ``progress`` (rounded up). Exact because every tick moves at least one
        thousandth in both zones (``leg`` checks it)."""
        t, b = self.ticks, self.border
        if progress <= b:
            scaled = t * progress * self.pb
        else:
            scaled = t * (b * self.pb + (progress - b) * self.pa)
        return (scaled + self.d - 1) // self.d


def road_speed_pct(rules: Ruleset, level: int) -> int:
    """Unit speed multiplier of a road of ``level`` in percent (DEC-28, item 7): 100 on level 1."""
    return rules.road.speed_pct.of(level) if level >= 2 else 100


def leg(mapdef: MapDef, rules: Ruleset, edge: int, to_node: int, level: int = 1) -> Leg:
    """The ``Leg`` of going along ``edge`` of road ``level`` into ``to_node`` (see ``Leg``).

    ``pa``, ``pb``: the effective speeds ``terrain_pct * road_pct // 100`` of the two zones.

    ``T = max(1, travel_ticks * 100 * d // (1000 * pa * pb))``: the exact sum of the times of the
    two zones, rounded down once, at least 1. Raises ValueError when some tick would move less
    than one thousandth (``T * max(pa, pb) > d``): ``progress`` could then no longer encode the
    time spent on the edge (for one terrain: ``T > PROGRESS_SCALE``).
    """
    e = mapdef.edges[edge]
    from_node = e.other(to_node)
    border = border_permille(mapdef, edge)
    b = border if from_node == e.a else PROGRESS_SCALE - border
    speed = rules.terrain.speed_pct
    road = road_speed_pct(rules, level)
    pa = speed.of(mapdef.nodes[from_node].terrain) * road // 100  # positive: rounded down
    pb = speed.of(mapdef.nodes[to_node].terrain) * road // 100
    d = b * pb + (PROGRESS_SCALE - b) * pa
    ticks = max(1, e.travel_ticks * 100 * d // (PROGRESS_SCALE * pa * pb))  # positive: round down
    if ticks * max(pa, pb) > d:
        raise ValueError(f"edge {edge} into node {to_node} takes {ticks} ticks: too slow")
    return Leg(ticks, b, pa, pb, d)


def traversal_ticks(mapdef: MapDef, rules: Ruleset, edge: int, to_node: int, level: int = 1) -> int:
    """Ticks to go along ``edge`` of road ``level`` into ``to_node``: ``T`` of its ``leg``."""
    return leg(mapdef, rules, edge, to_node, level).ticks


def edge_between(mapdef: MapDef, a: int, b: int) -> int | None:
    for eid in mapdef.incident[a]:
        if mapdef.edges[eid].other(a) == b:
            return eid
    return None


def find_path(
    state: GameState, rules: Ruleset, player: int, start: int, dest: int, size: int = 0
) -> tuple[int, ...] | None:
    """Fastest path ``(start, ..., dest)`` for a group of ``player``, or ``None`` if there is none.

    Only ``start`` and own nodes are expanded; ``dest`` may be any node such a path reaches.
    ``size``: the stack limit (DEC-20, D): every node of the path except ``start`` must have a
    capacity of at least ``size``; ``0`` means no limit.
    """
    found = _search(state, rules, player, start, size, dest)
    return found[0].get(dest)


def path_ticks(state: GameState, rules: Ruleset, path: tuple[int, ...]) -> int:
    """Ticks a group needs for ``path`` (``(start, ..., dest)``) once it departs: the sum of
    ``traversal_ticks`` of its edges (transit through own nodes costs no extra tick)."""
    mapdef = state.map
    total = 0
    for a, b in pairwise(path):
        eid = edge_between(mapdef, a, b)
        assert eid is not None  # a path of find_path
        total += traversal_ticks(mapdef, rules, eid, b, state.edges[eid].width)
    return total


def reachable(
    state: GameState, rules: Ruleset, player: int, start: int, size: int = 0
) -> dict[int, int]:
    """Every node a group of ``player`` in ``start`` can be ordered to, by node id, with the
    ticks of its fastest path (``path_ticks``) under the stack limit ``size`` (as ``find_path``).

    ``start`` itself is not included. The same search as ``find_path``, so the ticks and the
    nodes match what a ``Move`` would get.
    """
    return {
        node: ticks
        for node, (ticks, _) in reachable_paths(state, rules, player, start, size).items()
    }


def reachable_paths(
    state: GameState, rules: Ruleset, player: int, start: int, size: int = 0
) -> dict[int, tuple[int, tuple[int, ...]]]:
    """``reachable`` with the path of each node: ``{node: (ticks, (start, ..., node))}``.

    The path is the one ``find_path`` returns for that node (the same Dijkstra; stopping at
    ``dest`` only cuts it short), so it is the path the ``ack`` of a ``Move`` there carries.
    """
    paths, dist = _search(state, rules, player, start, size, None)
    return {node: (dist[node], paths[node]) for node in sorted(dist) if node != start}


def _search(
    state: GameState, rules: Ruleset, player: int, start: int, size: int, dest: int | None
) -> tuple[dict[int, tuple[int, ...]], dict[int, int]]:
    """Dijkstra of ``find_path``: the paths and times of the settled nodes; stops at ``dest``."""
    mapdef = state.map

    def key(node: int) -> int:
        return mapdef.node_key(player, node)

    best: dict[int, tuple[int, tuple[int, ...]]] = {start: (0, (key(start),))}
    paths: dict[int, tuple[int, ...]] = {start: (start,)}
    found: dict[int, tuple[int, ...]] = {}
    dist: dict[int, int] = {}
    fight_at = state.fight_nodes()
    heap: list[tuple[int, tuple[int, ...], int]] = [(0, (key(start),), start)]
    while heap:
        d, keys, node = heapq.heappop(heap)
        if node in dist:
            continue
        dist[node] = d
        found[node] = paths[node]
        if node == dest:
            break
        if node != start and (state.nodes[node].owner != player or node in fight_at):
            continue  # the first foreign or neutral node, or one with a fight, ends a path
        for eid in mapdef.incident[node]:
            nxt = mapdef.edges[eid].other(node)
            if nxt in dist:
                continue
            if size > 0 and city_capacity(state, rules, nxt) < size:
                continue  # the stack limit (DEC-20, D): the group does not fit there
            ticks = traversal_ticks(mapdef, rules, eid, nxt, state.edges[eid].width)
            cand = (d + ticks, (*keys, key(nxt)))
            if nxt not in best or cand < best[nxt]:
                best[nxt] = cand
                paths[nxt] = (*paths[node], nxt)
                heapq.heappush(heap, (cand[0], cand[1], nxt))
    return found, dist


@dataclass(frozen=True, slots=True)
class Arrival:
    """A group reached ``node`` over ``edge`` from ``from_node`` in this tick.

    ``back``: the group came home from a bounce (``OnEdge.back``, DEC-07, rules 4 and 6).
    ``planned``: the order that ended here was a planned one (DEC-08); combat puts a group that
    met an enemy on the edge in its arrival tick back on the edge with that order (DEC-24, C2).
    ``level``: the road level the group crossed the edge at (``OnEdge.level``).
    """

    group: int
    node: int
    edge: int
    from_node: int
    back: bool = False
    planned: bool = False
    level: int = 1


def movement(state: GameState, rules: Ruleset) -> list[Event]:
    """The movement system: ``advance`` all groups, then ``settle_arrivals``.

    Emits ``group_arrived`` for every arrival (combat, SIM-09, tells attackers by it) and
    ``node_captured`` for every captured empty neutral node.
    """
    arrivals = advance(state, rules)
    events = [
        event(
            state.tick,
            "group_arrived",
            group=a.group,
            player=state.groups[a.group].owner,
            node=a.node,
            edge=a.edge,
            from_node=a.from_node,
            back=a.back,
            planned=a.planned,
            level=a.level,
        )
        for a in arrivals
    ]
    return events + settle_arrivals(state, arrivals)


def advance(state: GameState, rules: Ruleset) -> list[Arrival]:
    """Phase 1: move every group with an order one tick; returns the arrivals by group id.

    A group's step depends only on the group and on node ownership, which this phase does not
    change, so the order of the groups does not matter.
    """
    mapdef = state.map
    fight_at = state.fight_nodes()
    arrivals: list[Arrival] = []
    for gid in sorted(state.groups):
        group = state.groups[gid]
        if group.fight is not None:
            continue  # the groups of a fight do not move (DEC-24, B6)
        location = group.location
        if isinstance(location, OnEdge) and location.back:
            arrival = _step_back(state, rules, gid, location)
            if arrival is not None:
                arrivals.append(arrival)
            continue
        order = group.order
        if order is None:
            continue
        if state.tick < order.depart_tick:
            continue  # a planned order waits (DEC-08), an edge winner regroups (DEC-24, G4)
        if order.planned and group.bonus > group.charged:
            # DEC-29: the planned bonus is at most the charged units in the departure tick. A
            # moving group's charges do not change (no recharge in transit), so capping on
            # every step is the same as capping once when it leaves.
            group.bonus = group.charged
        if isinstance(location, AtNode):
            eid = edge_between(mapdef, location.node, order.path[0]) if order.path else None
            if eid is None:
                group.order = None
                continue
            level = state.edges[eid].width  # read when entering the edge (DEC-28, item 7)
            location = OnEdge(edge=eid, from_node=location.node, progress=0, level=level)
        to_node = mapdef.edges[location.edge].other(location.from_node)
        way = leg(mapdef, rules, location.edge, to_node, location.level)
        spent = way.spent(location.progress) + 1  # ticks spent so far, with this one
        if spent < way.ticks:
            group.location = OnEdge(
                location.edge, location.from_node, way.progress(spent), level=location.level
            )
            continue
        rest = order.path[1:] if order.path and order.path[0] == to_node else ()
        if rest and state.nodes[to_node].owner == group.owner and to_node not in fight_at:
            eid = edge_between(mapdef, to_node, rest[0])
            if eid is not None:  # pass through the own node
                level = state.edges[eid].width
                group.location = OnEdge(edge=eid, from_node=to_node, progress=0, level=level)
                group.order = Order(rest, order.planned, order.depart_tick)
                continue
        # The destination, a foreign or neutral node (the target of an attack or a capture), or
        # an own node with a fight: the group stops there and joins it (DEC-24, D1).
        group.location = AtNode(to_node)
        group.order = None
        arrivals.append(
            Arrival(
                gid,
                to_node,
                location.edge,
                location.from_node,
                planned=order.planned,
                level=location.level,
            )
        )
    return arrivals


def _step_back(state: GameState, rules: Ruleset, gid: int, location: OnEdge) -> Arrival | None:
    """One tick of a bounce: ``progress`` falls by the step it grew by on the way there.

    The steps are those of the way there (the ``leg`` into the far end, terrain zones included),
    so a bounce after ``k`` ticks on the edge takes ``k`` ticks (DEC-07, rules 4 and 6). No order
    is needed.
    """
    mapdef = state.map
    far = mapdef.edges[location.edge].other(location.from_node)
    way = leg(mapdef, rules, location.edge, far, location.level)
    spent = way.spent(location.progress) - 1  # ticks spent so far, minus this one
    group = state.groups[gid]
    if spent > 0:
        group.location = OnEdge(
            location.edge,
            location.from_node,
            way.progress(spent),
            back=True,
            level=location.level,
        )
        return None
    group.location = AtNode(location.from_node)
    group.order = None
    return Arrival(gid, location.from_node, location.edge, far, back=True, level=location.level)


def settle_arrivals(state: GameState, arrivals: list[Arrival]) -> list[Event]:
    """Phase 2: capture every empty neutral node where only one player's groups now stand.

    The capture goes through ``change_owner`` (SIM-07): grace period, empty warehouse.
    """
    events: list[Event] = []
    for node_id in sorted(dict.fromkeys(a.node for a in arrivals)):
        node = state.nodes[node_id]
        if node.owner is not None:
            continue
        owners = sorted(
            dict.fromkeys(
                g.owner
                for g in state.groups.values()
                if isinstance(g.location, AtNode) and g.location.node == node_id
            )
        )
        if len(owners) == 1:
            events.extend(change_owner(state, node_id, owners[0]))
            events.append(event(state.tick, "node_captured", node=node_id, player=owners[0]))
    return events
