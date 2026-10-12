"""Supply (SIM-08): packets from the capital along internal roads, and recharge.

Rules (mechanics.md, sections 7 and 8; DEC-02: only the capital produces charges; details:
DEC-14 default, #131), numbers from ``Ruleset.supply``:

- Charges flow only outwards along the shortest-path tree of the player's supplied territory
  (``capacity.supplied_territory``): every own node reachable from the own capital over internal
  roads has one parent towards the capital. The tree minimizes the packet time
  (``packet_ticks``); among parents at the same distance the one with the lower
  ``node_key(player, node)`` wins. A packet goes only from a parent to its child, so there are no
  cycles and nothing ever moves back to the capital. Cut-off nodes are not in the tree: they
  neither get nor send packets.
- Target stock of a node: ``min(capacity, discharged standing units + supply.buffer)``; the
  warehouse never holds more than the capacity (mechanics.md, section 9).
- Deficit of a node: ``target - warehouse - incoming``, where ``incoming`` are the charges of
  own packets already on the way into the node. Subtree deficit, bottom up:
  ``max(0, deficit + sum of the subtree deficits of the children)``; a negative own deficit (a
  surplus, or charges on the way) covers the children first.
- Every ``supply.dispatch_ticks`` ticks (ticks ``t > 0`` divisible by it) each node of the tree
  sends everything above its target to its children, the child with the larger subtree
  deficit first (ties: lower ``node_key``). A child gets at most its subtree deficit, at most the
  road ``amount`` (one packet per road per period, ``road_amount``) and at most its free room
  ``capacity - warehouse - incoming``.
- Road parameters by level and type (DEC-22, item 4): ``speed_pct`` is ``supply.base_speed_pct``
  on level 1 and on a freight road, ``supply.fast_speed_pct[level]`` on a fast one; ``amount`` is
  ``supply.base_amount`` on level 1 and on a fast road, ``supply.freight_amount[level]`` on a
  freight one.
- A packet travels ``packet_ticks = travel_ticks * 100 // speed_pct`` ticks (rounded down, at
  least 1), with the road at departure. It is delivered into the warehouse on ``arrive_tick``;
  charges above the capacity are lost (event ``charges_overflow``).
- A packet on a road that is no longer internal to its owner is lost (event ``packet_lost``),
  except on a freight road (DEC-22, item 5): there it arrives at ``arrive_tick``. An own end
  node takes it as usual; an end node of the other player takes the charges into its warehouse
  for the new owner within the capacity (``packet_captured`` with the charges taken, for the
  captor; ``packet_lost`` with all charges, for the sender; the excess burns without an event);
  at a neutral end node the charges are lost (``packet_lost``).
- Recharge: each tick, units of the node owner standing in the node (``capacity.is_standing``)
  take charges from the warehouse, at most ``supply.recharge_per_tick`` per node and tick, the
  lowest group id first. Units on edges do not recharge.

Order inside the system: lost packets, deliveries, recharge, dispatch. Charges are created only
by the economy (``charges_produced``) and leave the supply chain only through recharge or the
documented sinks ``packet_lost``, ``charges_overflow`` and ``warehouse_lost``;
``packet_captured`` moves charges of a freight packet into the captor's warehouse.

Cost per tick: O(V + E + P + G); a dispatch tick adds the tree, a Dijkstra over at most V nodes
and E roads (O(E log V)).
"""

import heapq
from dataclasses import dataclass

from gow_sim.maps import MapDef
from gow_sim.ruleset import Ruleset
from gow_sim.state import AtNode, Event, GameState, Group, Packet, RoadKind, event
from gow_sim.systems.capacity import is_standing, node_capacities


def road_speed_pct(rules: Ruleset, level: int, kind: RoadKind) -> int:
    """Packet speed in percent on a road of ``level`` and ``kind`` (DEC-22, item 4)."""
    if kind is RoadKind.FAST and level >= 2:
        return rules.supply.fast_speed_pct.of(level)
    return rules.supply.base_speed_pct


def road_amount(rules: Ruleset, level: int, kind: RoadKind) -> int:
    """Charges per road and dispatch period on a road of ``level`` and ``kind`` (DEC-22)."""
    if kind is RoadKind.FREIGHT and level >= 2:
        return rules.supply.freight_amount.of(level)
    return rules.supply.base_amount


def packet_ticks(mapdef: MapDef, rules: Ruleset, edge: int, level: int, kind: RoadKind) -> int:
    """Ticks a packet needs along ``edge`` of ``level`` and ``kind`` (see the module docstring)."""
    pct = road_speed_pct(rules, level, kind)
    return max(1, mapdef.edges[edge].travel_ticks * 100 // pct)  # both positive: rounded down


def edge_packet_ticks(state: GameState, rules: Ruleset, edge: int) -> int:
    """``packet_ticks`` of ``edge`` with its current level and type."""
    e = state.edges[edge]
    return packet_ticks(state.map, rules, edge, e.width, e.kind)


@dataclass(frozen=True, slots=True)
class SupplyTree:
    """Shortest-path tree of a player's supplied territory, rooted at the own capital.

    ``order``: the tree nodes by distance from the capital (capital first), so every parent
    comes before its children. ``parent[n]`` and ``parent_edge[n]``: the next node towards the
    capital and the road to it; ``None`` for the capital and for nodes outside the tree.
    """

    order: tuple[int, ...]
    parent: tuple[int | None, ...]
    parent_edge: tuple[int | None, ...]


def supply_tree(state: GameState, rules: Ruleset, player: int) -> SupplyTree:
    """Build the supply tree of ``player`` (see the module docstring). Empty without capital."""
    mapdef = state.map
    size = len(mapdef.nodes)
    parent: list[int | None] = [None] * size
    parent_edge: list[int | None] = [None] * size
    order: list[int] = []
    capital = mapdef.capital(player)
    if state.nodes[capital].owner != player:
        return SupplyTree((), tuple(parent), tuple(parent_edge))
    dist = [-1] * size
    done = [False] * size
    dist[capital] = 0
    heap = [(0, mapdef.node_key(player, capital), capital)]
    while heap:
        d, _, node = heapq.heappop(heap)
        if done[node]:
            continue
        done[node] = True
        order.append(node)
        node_key = mapdef.node_key(player, node)
        for eid in mapdef.incident[node]:
            nxt = mapdef.edges[eid].other(node)
            if done[nxt] or state.nodes[nxt].owner != player:
                continue  # every road between two own nodes is internal
            cand = d + edge_packet_ticks(state, rules, eid)
            old = parent[nxt]
            if (
                dist[nxt] < 0
                or cand < dist[nxt]
                or (
                    cand == dist[nxt]
                    and old is not None
                    and node_key < mapdef.node_key(player, old)
                )
            ):
                dist[nxt] = cand
                parent[nxt] = node
                parent_edge[nxt] = eid
                heapq.heappush(heap, (cand, mapdef.node_key(player, nxt), nxt))
    return SupplyTree(tuple(order), tuple(parent), tuple(parent_edge))


def packet_target(state: GameState, packet: Packet) -> int:
    """The node the packet goes to."""
    return state.map.edges[packet.edge].other(packet.from_node)


def supply(state: GameState, rules: Ruleset) -> list[Event]:
    """The supply system (see the module docstring). Players do not affect each other.

    TODO(#131): tree metric, capacity limits, subtree deficit and recharge order are DEC-14
    defaults.
    """
    capacities = node_capacities(state, rules)
    events = _move_packets(state, capacities)
    garrisons = _garrisons(state)
    _recharge(state, rules, garrisons)
    tick = state.tick
    if tick > 0 and tick % rules.supply.dispatch_ticks == 0:
        for pid in sorted(state.players):
            events.extend(_dispatch(state, rules, pid, capacities, garrisons))
    return events


def _move_packets(state: GameState, capacities: tuple[int, ...]) -> list[Event]:
    """Lose packets on roads that are no longer own internal ones, deliver the arrived ones.

    A packet on a freight road is not lost there (DEC-22, item 5); it is delivered on
    ``arrive_tick`` to whoever owns the end node then.
    """
    events: list[Event] = []
    tick = state.tick
    mapdef = state.map
    for pid in sorted(state.packets):
        packet = state.packets[pid]
        e = mapdef.edges[packet.edge]
        internal = state.nodes[e.a].owner == packet.owner == state.nodes[e.b].owner
        if not internal and state.edges[packet.edge].kind is not RoadKind.FREIGHT:
            del state.packets[pid]
            events.append(_lost(tick, pid, packet))
            continue
        if packet.arrive_tick > tick:
            continue
        del state.packets[pid]
        node_id = e.other(packet.from_node)
        node = state.nodes[node_id]
        receiver = node.owner
        if receiver is None:  # a neutral end node of a freight road: the charges are lost
            events.append(_lost(tick, pid, packet))
            continue
        added = min(packet.charges, max(0, capacities[node_id] - node.warehouse))
        node.warehouse += added
        if receiver != packet.owner:
            # The captor of the end node takes a freight packet (DEC-22, item 5): the sender
            # loses all of it, the captor gets what fits, the excess burns.
            events.append(
                event(tick, "packet_captured", player=receiver, node=node_id, charges=added)
            )
            events.append(_lost(tick, pid, packet))
            continue
        events.append(
            event(
                tick,
                "packet_delivered",
                packet=pid,
                player=receiver,
                node=node_id,
                charges=added,
            )
        )
        if packet.charges > added:
            events.append(
                event(
                    tick,
                    "charges_overflow",
                    player=packet.owner,
                    node=node_id,
                    charges=packet.charges - added,
                )
            )
    return events


def _lost(tick: int, pid: int, packet: Packet) -> Event:
    return event(
        tick,
        "packet_lost",
        packet=pid,
        player=packet.owner,
        edge=packet.edge,
        charges=packet.charges,
    )


def _garrisons(state: GameState) -> dict[int, list[Group]]:
    """Standing groups of the node owner, by node, each list by ascending group id."""
    garrisons: dict[int, list[Group]] = {}
    for gid in sorted(state.groups):
        group = state.groups[gid]
        location = group.location
        if is_standing(group) and isinstance(location, AtNode):
            node_id = location.node
            if group.owner == state.nodes[node_id].owner:
                garrisons.setdefault(node_id, []).append(group)
    return garrisons


def _recharge(state: GameState, rules: Ruleset, garrisons: dict[int, list[Group]]) -> None:
    for node_id in sorted(garrisons):
        node = state.nodes[node_id]
        left = min(rules.supply.recharge_per_tick, node.warehouse)
        for group in garrisons[node_id]:
            if left == 0:
                break
            take = min(left, group.units - group.charged)
            group.charged += take
            left -= take
            node.warehouse -= take


def _dispatch(
    state: GameState,
    rules: Ruleset,
    player: int,
    capacities: tuple[int, ...],
    garrisons: dict[int, list[Group]],
) -> list[Event]:
    tree = supply_tree(state, rules, player)
    if len(tree.order) < 2:
        return []
    mapdef = state.map
    size = len(mapdef.nodes)
    incoming = [0] * size
    for pid in sorted(state.packets):
        packet = state.packets[pid]
        if packet.owner == player:
            incoming[packet_target(state, packet)] += packet.charges
    target = [0] * size
    need = [0] * size
    children: list[list[int]] = [[] for _ in range(size)]
    for node_id in tree.order:
        discharged = sum(g.units - g.charged for g in garrisons.get(node_id, ()))
        target[node_id] = min(capacities[node_id], discharged + rules.supply.buffer)
        need[node_id] = target[node_id] - state.nodes[node_id].warehouse - incoming[node_id]
        up = tree.parent[node_id]
        if up is not None:
            children[up].append(node_id)
    for node_id in reversed(tree.order):  # children before parents
        need[node_id] = max(0, need[node_id])
        up = tree.parent[node_id]
        if up is not None:
            need[up] += need[node_id]
    events: list[Event] = []
    tick = state.tick
    for node_id in tree.order:
        node = state.nodes[node_id]
        surplus = node.warehouse - target[node_id]
        kids = sorted(children[node_id], key=lambda c: (-need[c], mapdef.node_key(player, c)))
        for child in kids:
            if surplus <= 0:
                break
            eid = tree.parent_edge[child]
            assert eid is not None
            road = state.edges[eid]
            room = capacities[child] - state.nodes[child].warehouse - incoming[child]
            amount = min(surplus, need[child], road_amount(rules, road.width, road.kind), room)
            if amount <= 0:
                continue
            surplus -= amount
            node.warehouse -= amount
            incoming[child] += amount
            packet_id = state.new_id()
            state.packets[packet_id] = Packet(
                id=packet_id,
                owner=player,
                edge=eid,
                from_node=node_id,
                charges=amount,
                depart_tick=tick,
                arrive_tick=tick + packet_ticks(mapdef, rules, eid, road.width, road.kind),
            )
            events.append(
                event(
                    tick,
                    "packet_sent",
                    packet=packet_id,
                    player=player,
                    edge=eid,
                    from_node=node_id,
                    charges=amount,
                )
            )
    return events
