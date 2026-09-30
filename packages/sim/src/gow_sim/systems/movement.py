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
- Two phases: first every group moves and every arrival is fixed (``advance``), then the arrivals
  are settled (``settle_arrivals``): an empty neutral node reached by groups of one player only
  is captured. Everything else at a node or on an edge with both players is left to combat
  (SIM-09, #25), which runs after this system. No step depends on the order of the players.

Timing: a group whose order may depart this tick (``state.tick >= order.depart_tick``) leaves
its node and makes its first step in the same tick; arriving at an intermediate own node, it
stands there until the next tick. A path of edges of ``T1`` and ``T2`` ticks thus takes
``T1 + T2`` ticks.
"""

import heapq
from dataclasses import dataclass

from gow_sim.maps import MapDef
from gow_sim.ruleset import Ruleset
from gow_sim.state import PROGRESS_SCALE, AtNode, Event, GameState, OnEdge, Order, event


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
    state: GameState, rules: Ruleset, player: int, start: int, dest: int
) -> tuple[int, ...] | None:
    """Fastest path ``(start, ..., dest)`` for a group of ``player``, or ``None`` if there is none.

    Only ``start`` and own nodes are expanded; ``dest`` may be any node such a path reaches.
    """
    mapdef = state.map

    def key(node: int) -> int:
        return mapdef.node_key(player, node)

    best: dict[int, tuple[int, tuple[int, ...]]] = {start: (0, (key(start),))}
    paths: dict[int, tuple[int, ...]] = {start: (start,)}
    done: dict[int, bool] = {}
    heap: list[tuple[int, tuple[int, ...], int]] = [(0, (key(start),), start)]
    while heap:
        dist, keys, node = heapq.heappop(heap)
        if node in done:
            continue
        done[node] = True
        if node == dest:
            return paths[node]
        if node != start and state.nodes[node].owner != player:
            continue  # the first foreign or neutral node ends a path
        for eid in mapdef.incident[node]:
            nxt = mapdef.edges[eid].other(node)
            if nxt in done:
                continue
            cand = (dist + traversal_ticks(mapdef, rules, eid, nxt), (*keys, key(nxt)))
            if nxt not in best or cand < best[nxt]:
                best[nxt] = cand
                paths[nxt] = (*paths[node], nxt)
                heapq.heappush(heap, (cand[0], cand[1], nxt))
    return None


@dataclass(frozen=True, slots=True)
class Arrival:
    """A group reached ``node`` over ``edge`` from ``from_node`` in this tick."""

    group: int
    node: int
    edge: int
    from_node: int


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
        order = group.order
        if order is None:
            continue
        location = group.location
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
        group.location = AtNode(to_node)
        arrivals.append(Arrival(gid, to_node, location.edge, location.from_node))
        rest = order.path[1:] if order.path and order.path[0] == to_node else ()
        if rest and state.nodes[to_node].owner == group.owner:
            group.order = Order(rest, order.planned, order.depart_tick)
        else:
            group.order = None  # the destination, or a foreign or neutral node: the target
    return arrivals


def settle_arrivals(state: GameState, arrivals: list[Arrival]) -> list[Event]:
    """Phase 2: capture every empty neutral node where only one player's groups now stand."""
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
            node.owner = owners[0]
            events.append(event(state.tick, "node_captured", node=node_id, player=owners[0]))
    return events
