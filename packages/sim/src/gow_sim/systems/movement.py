"""Movement on the graph (SIM-05): path search and the movement system.

Rules (mechanics.md, sections 4 and 5; DEC-07, rules 6 and 8; AGENTS.md, section 4.1):

- Going along an edge into node ``v`` takes ``traversal_ticks = travel_ticks * 100 // pct``
  ticks (rounded down, at least 1), where ``pct`` is ``terrain.entry_speed_pct`` of the terrain
  of ``v``, the node being entered.
- ``progress`` is in thousandths of the edge. After ``k`` ticks on an edge of ``T`` ticks it is
  ``k * 1000 // T`` (rounded down); the group arrives on tick ``T``. Groups stand only in nodes.
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
#118). A path of edges of ``T1`` and ``T2`` ticks thus takes ``T1 + T2`` ticks. Only reaching
the end of the path (the destination, or a node that is no longer own) is an ``Arrival``.
"""

import heapq
from dataclasses import dataclass
from itertools import pairwise

from gow_sim.maps import MapDef
from gow_sim.ruleset import Ruleset
from gow_sim.state import PROGRESS_SCALE, AtNode, Event, GameState, OnEdge, Order, event
from gow_sim.systems.capacity import change_owner, city_capacity


def traversal_ticks(mapdef: MapDef, rules: Ruleset, edge: int, to_node: int) -> int:
    """Ticks to go along ``edge`` into ``to_node`` (see the module docstring).

    Raises ValueError above ``PROGRESS_SCALE`` ticks: ``progress`` would then stop growing on
    some ticks and could no longer encode the time spent on the edge.
    """
    e = mapdef.edges[edge]
    pct = rules.terrain.entry_speed_pct.of(mapdef.nodes[to_node].terrain)
    ticks = max(1, e.travel_ticks * 100 // pct)  # both positive: rounded down
    if ticks > PROGRESS_SCALE:
        raise ValueError(f"edge {edge} into node {to_node} takes {ticks} > {PROGRESS_SCALE} ticks")
    return ticks


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
        total += traversal_ticks(mapdef, rules, eid, b)
    return total


def reachable(
    state: GameState, rules: Ruleset, player: int, start: int, size: int = 0
) -> dict[int, int]:
    """Every node a group of ``player`` in ``start`` can be ordered to, by node id, with the
    ticks of its fastest path (``path_ticks``) under the stack limit ``size`` (as ``find_path``).

    ``start`` itself is not included. The same search as ``find_path``, so the ticks and the
    nodes match what a ``Move`` would get.
    """
    dist = _search(state, rules, player, start, size, None)[1]
    return {node: dist[node] for node in sorted(dist) if node != start}


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
    heap: list[tuple[int, tuple[int, ...], int]] = [(0, (key(start),), start)]
    while heap:
        d, keys, node = heapq.heappop(heap)
        if node in dist:
            continue
        dist[node] = d
        found[node] = paths[node]
        if node == dest:
            break
        if node != start and state.nodes[node].owner != player:
            continue  # the first foreign or neutral node ends a path
        for eid in mapdef.incident[node]:
            nxt = mapdef.edges[eid].other(node)
            if nxt in dist:
                continue
            if size > 0 and city_capacity(state, rules, nxt) < size:
                continue  # the stack limit (DEC-20, D): the group does not fit there
            cand = (d + traversal_ticks(mapdef, rules, eid, nxt), (*keys, key(nxt)))
            if nxt not in best or cand < best[nxt]:
                best[nxt] = cand
                paths[nxt] = (*paths[node], nxt)
                heapq.heappush(heap, (cand[0], cand[1], nxt))
    return found, dist


@dataclass(frozen=True, slots=True)
class Arrival:
    """A group reached ``node`` over ``edge`` from ``from_node`` in this tick.

    ``back``: the group came home from a bounce (``OnEdge.back``, DEC-07, rules 4 and 6).
    """

    group: int
    node: int
    edge: int
    from_node: int
    back: bool = False


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
    arrivals: list[Arrival] = []
    for gid in sorted(state.groups):
        group = state.groups[gid]
        location = group.location
        if isinstance(location, OnEdge) and location.back:
            arrival = _step_back(state, rules, gid, location)
            if arrival is not None:
                arrivals.append(arrival)
            continue
        order = group.order
        if order is None:
            continue
        if isinstance(location, AtNode):
            if state.tick < order.depart_tick:
                continue  # a planned order waits (DEC-08)
            eid = edge_between(mapdef, location.node, order.path[0]) if order.path else None
            if eid is None:
                group.order = None
                continue
            location = OnEdge(edge=eid, from_node=location.node, progress=0)
        to_node = mapdef.edges[location.edge].other(location.from_node)
        ticks = traversal_ticks(mapdef, rules, location.edge, to_node)
        # Ticks spent so far, recovered from progress = spent * 1000 // ticks (ticks <= 1000).
        spent = (location.progress * ticks + PROGRESS_SCALE - 1) // PROGRESS_SCALE + 1
        if spent < ticks:
            group.location = OnEdge(
                location.edge, location.from_node, spent * PROGRESS_SCALE // ticks
            )
            continue
        rest = order.path[1:] if order.path and order.path[0] == to_node else ()
        if rest and state.nodes[to_node].owner == group.owner:
            eid = edge_between(mapdef, to_node, rest[0])
            if eid is not None:  # pass through the own node
                group.location = OnEdge(edge=eid, from_node=to_node, progress=0)
                group.order = Order(rest, order.planned, order.depart_tick)
                continue
        # The destination, or a foreign or neutral node: the target of an attack or a capture.
        group.location = AtNode(to_node)
        group.order = None
        arrivals.append(Arrival(gid, to_node, location.edge, location.from_node))
    return arrivals


def _step_back(state: GameState, rules: Ruleset, gid: int, location: OnEdge) -> Arrival | None:
    """One tick of a bounce: ``progress`` falls by the step it grew by on the way there.

    The step is that of the way there (``traversal_ticks`` into the far end), so a bounce after
    ``k`` ticks on the edge takes ``k`` ticks (DEC-07, rules 4 and 6). No order is needed.
    """
    mapdef = state.map
    far = mapdef.edges[location.edge].other(location.from_node)
    ticks = traversal_ticks(mapdef, rules, location.edge, far)
    # Ticks spent so far, recovered as in ``advance`` (ticks <= 1000), minus this tick.
    spent = (location.progress * ticks + PROGRESS_SCALE - 1) // PROGRESS_SCALE - 1
    group = state.groups[gid]
    if spent > 0:
        group.location = OnEdge(
            location.edge, location.from_node, spent * PROGRESS_SCALE // ticks, back=True
        )
        return None
    group.location = AtNode(location.from_node)
    group.order = None
    return Arrival(gid, location.from_node, location.edge, far, back=True)


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
