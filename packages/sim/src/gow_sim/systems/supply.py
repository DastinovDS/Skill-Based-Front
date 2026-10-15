"""Supply (SIM-08, DEC-18): packets from the capital along internal roads, transfers, recharge.

Rules (mechanics.md, section 7, block DEC-18; DEC-02: only the capital produces charges; DEC-22,
item 4: road parameters), numbers from ``Ruleset.supply``:

- Supply tree (DEC-18, item 3): Dijkstra from the own capital over own nodes joined by internal
  roads (every road between two own nodes is internal), metric ``packet_ticks``; among parents at
  the same distance the one with the lower ``node_key(player, node)`` wins. Cut-off nodes are not
  in the tree. Provinces (DEC-23) are transit: no warehouse and no target. The **children** of a
  city are its nearest city descendants (the way to them goes only through provinces); a packet
  goes to such a child along that whole way.
- Target stock of a city, the same for every priority (item 2):
  ``min(warehouse capacity, discharged standing units + supply.buffer)``; the warehouse capacity
  is the node capacity, or with ``city_upgrades`` its own (DEC-26, item 6;
  ``capacity.warehouse_capacity``). "Capacity" of a warehouse below means that number.
- Dispatch every ``supply.dispatch_ticks`` ticks (ticks ``t > 0`` divisible by it) in three
  passes ``high``, ``normal``, ``low`` (item 4). In the pass of level ``L`` a city is **active**
  when its priority is ``L`` or higher; the others are transit in that pass. What a pass sent
  counts as "on the way" in the later passes.

  - Own deficit: active ``target - warehouse - incoming``, inactive ``-(warehouse + incoming)``;
    ``incoming``: charges of own packets whose path ends in the city.
  - Subtree deficit, bottom up: ``max(0, own + sum of the children's subtree deficits)``.
  - Cities in tree order give ``warehouse - (target if active else 0)`` to children with a
    subtree deficit above 0. Children go by ascending key: the smallest
    ``(priority rank, warehouse, node_key)`` among the active cities of the child's subtree with
    an own deficit above 0 (rank ``high`` 0, ``normal`` 1, ``low`` 2). A child gets at most its
    subtree deficit, at most its free room ``capacity - warehouse - incoming`` and at most what is
    left of the ``amount`` of every road of the way this period (``road_amount`` minus what the
    transfers took, item 10; shared by the three passes and every way through the road).
  - Everything one city sent to one child in a period goes as one packet.

- Road parameters by level (DEC-22, item 4; roads have no type, DEC-26, item 7): ``speed_pct``
  is ``supply.base_speed_pct`` on level 1 and ``supply.fast_speed_pct[level]`` on an upgraded
  road; ``amount`` is ``supply.base_amount`` on every level. A packet needs
  ``packet_ticks = travel_ticks * 100 // speed_pct`` ticks per road (rounded down, at least 1),
  by the road at departure; the times never change afterwards.
- Packet on its path (item 5): on a road that is no longer internal to its owner it is lost
  (``packet_lost``) on any level (DEC-26, item 7: no freight road, no ``packet_captured``). At
  an intermediate own node it goes on at once; if the next road is no longer internal,
  an own city takes the charges into its warehouse, a province loses them (``packet_lost``). At
  the end of the path the charges go into the warehouse within the capacity, the excess burns
  (``charges_overflow``).
- Transfer (item 6, ``commands.Transfer``): the fastest way for its ``n`` charges by
  ``transfer_ticks`` per road, ties by the lexicographically smaller ``node_key`` sequence.
- Transfers share the ``amount`` of a road with the automatic dispatch and take it first
  (item 10, owner's decision of 2026-10-14, #253): a transfer packet entering a road gets the
  ``share`` of all its charges there; on every dispatch tick while it is on the road it takes
  ``min(amount, share)`` of the road's ``amount`` (``share`` falls by as much), and the automatic
  dispatch of the period gets ``max(0, amount - taken)``. Transfers do not delay each other (their
  times stay those of item 6), what they take adds up.
- Recharge: each tick, units of the node owner standing in the node (``capacity.is_standing``)
  take charges from the warehouse, at most ``supply.recharge_per_tick`` per node and tick, the
  lowest group id first. Units on edges do not recharge, nor do groups in a fight while it lasts
  (DEC-24, H1: packets still reach the warehouse of the node).

Order inside the system (item 9): lost packets, packets along their path and deliveries,
recharge, the transfer shares (item 10), dispatch. Charges are created only by the economy
(``charges_produced``) and leave the supply chain only through recharge or the documented sinks
``packet_lost``, ``charges_overflow`` and ``warehouse_lost``.

Cost per tick: O(V + E + P + G); a dispatch tick adds the tree (Dijkstra, O(E log V)) and three
passes over the cities of the tree.
"""

import heapq
from dataclasses import dataclass

from gow_sim.maps import MapDef, NodeKind
from gow_sim.ruleset import Ruleset
from gow_sim.state import AtNode, Event, GameState, Group, Packet, event
from gow_sim.systems.capacity import is_standing, warehouse_capacities

PASSES = (0, 1, 2)
"""Dispatch passes by priority rank: ``high``, ``normal``, ``low`` (DEC-18, item 4)."""


def road_speed_pct(rules: Ruleset, level: int) -> int:
    """Packet speed in percent on a road of ``level`` (DEC-22, item 4; DEC-26, item 7)."""
    if level >= 2:
        return rules.supply.fast_speed_pct.of(level)
    return rules.supply.base_speed_pct


def road_amount(rules: Ruleset) -> int:
    """Charges per road and dispatch period, the same on every level (DEC-26, item 7)."""
    return rules.supply.base_amount


def packet_ticks(mapdef: MapDef, rules: Ruleset, edge: int, level: int) -> int:
    """Ticks a packet needs along ``edge`` of ``level`` (see the module docstring)."""
    pct = road_speed_pct(rules, level)
    return max(1, mapdef.edges[edge].travel_ticks * 100 // pct)  # both positive: rounded down


def edge_packet_ticks(state: GameState, rules: Ruleset, edge: int) -> int:
    """``packet_ticks`` of ``edge`` with its current level."""
    return packet_ticks(state.map, rules, edge, state.edges[edge].width)


def transfer_ticks(state: GameState, rules: Ruleset, edge: int, n: int) -> int:
    """Ticks a transfer of ``n`` charges needs along ``edge`` (DEC-18, item 6).

    ``packet_ticks + (ceil(n / amount) - 1) * supply.dispatch_ticks``: the charges go in batches
    of ``amount`` per period, the simulation carries them as one packet with the time of the last
    batch. ``ceil(n / a) = (n + a - 1) // a``, both positive.
    """
    amount = road_amount(rules)
    batches = (n + amount - 1) // amount
    return edge_packet_ticks(state, rules, edge) + (batches - 1) * rules.supply.dispatch_ticks


def target_stock(rules: Ruleset, warehouse_cap: int, discharged: int) -> int:
    """Target stock of a city (DEC-18, item 2; DEC-26, item 6): its warehouse capacity, at most
    the discharged units standing there plus ``supply.buffer``."""
    return min(warehouse_cap, discharged + rules.supply.buffer)


def is_city(mapdef: MapDef, node: int) -> bool:
    """A node with a city and a warehouse; a province (DEC-23) is not one."""
    return mapdef.nodes[node].kind is not NodeKind.PROVINCE


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


@dataclass(frozen=True, slots=True)
class TransferRoute:
    """The way of a transfer: ``nodes`` ``(from, ..., to)``, ``edges`` and the ``ticks`` of each."""

    nodes: tuple[int, ...]
    edges: tuple[int, ...]
    ticks: tuple[int, ...]

    @property
    def total_ticks(self) -> int:
        return sum(self.ticks)


def transfer_route(
    state: GameState, rules: Ruleset, player: int, src: int, dst: int, n: int
) -> TransferRoute | None:
    """The fastest way of a transfer of ``n`` charges from ``src`` to ``dst`` (DEC-18, item 6).

    Only own nodes, so only internal roads; ``transfer_ticks`` per road; among ways of equal time
    the lexicographically smaller sequence of ``node_key(player, node)`` wins, as for movement.
    ``None``: no such way.
    """
    mapdef = state.map
    nodes = state.nodes

    def key(node: int) -> int:
        return mapdef.node_key(player, node)

    best: dict[int, tuple[int, tuple[int, ...]]] = {src: (0, (key(src),))}
    via: dict[int, tuple[int, int]] = {}
    done: dict[int, bool] = {}
    heap: list[tuple[int, tuple[int, ...], int]] = [(0, (key(src),), src)]
    while heap:
        dist, keys, node = heapq.heappop(heap)
        if node in done:
            continue
        done[node] = True
        if node == dst:
            break
        for eid in mapdef.incident[node]:
            nxt = mapdef.edges[eid].other(node)
            if nxt in done or nodes[nxt].owner != player:
                continue
            cand = (dist + transfer_ticks(state, rules, eid, n), (*keys, key(nxt)))
            if nxt not in best or cand < best[nxt]:
                best[nxt] = cand
                via[nxt] = (node, eid)
                heapq.heappush(heap, (cand[0], cand[1], nxt))
    if dst not in done or dst == src:
        return None
    path_nodes = [dst]
    path_edges: list[int] = []
    node = dst
    while node != src:
        prev, eid = via[node]
        path_edges.append(eid)
        path_nodes.append(prev)
        node = prev
    path_nodes.reverse()
    path_edges.reverse()
    return TransferRoute(
        nodes=tuple(path_nodes),
        edges=tuple(path_edges),
        ticks=tuple(transfer_ticks(state, rules, e, n) for e in path_edges),
    )


def send_packet(
    state: GameState,
    player: int,
    from_node: int,
    edges: tuple[int, ...],
    ticks: tuple[int, ...],
    charges: int,
    *,
    transfer: bool,
) -> Packet:
    """A new packet of ``player`` leaving ``from_node`` now along ``edges`` (DEC-18, item 5)."""
    pid = state.new_id()
    packet = Packet(
        id=pid,
        owner=player,
        edge=edges[0],
        from_node=from_node,
        charges=charges,
        depart_tick=state.tick,
        arrive_tick=state.tick + ticks[0],
        route=edges[1:],
        route_ticks=ticks[1:],
        transfer=transfer,
        share=charges if transfer else 0,
    )
    state.packets[pid] = packet
    return packet


def packet_target(state: GameState, packet: Packet) -> int:
    """The node at the end of the packet's current edge."""
    return state.map.edges[packet.edge].other(packet.from_node)


def packet_dest(state: GameState, packet: Packet) -> int:
    """The node at the end of the packet's path."""
    edges = state.map.edges
    node = edges[packet.edge].other(packet.from_node)
    for eid in packet.route:
        node = edges[eid].other(node)
    return node


def packet_path(state: GameState, packet: Packet) -> tuple[int, ...]:
    """The nodes still to reach, the end of the current edge first, the destination last."""
    edges = state.map.edges
    node = edges[packet.edge].other(packet.from_node)
    path = [node]
    for eid in packet.route:
        node = edges[eid].other(node)
        path.append(node)
    return tuple(path)


def packet_dest_tick(packet: Packet) -> int:
    """The tick the packet reaches the end of its path, if nothing stops it."""
    return packet.arrive_tick + sum(packet.route_ticks)


def supply(state: GameState, rules: Ruleset) -> list[Event]:
    """The supply system (see the module docstring). Players do not affect each other."""
    capacities = warehouse_capacities(state, rules)
    events = _move_packets(state, capacities)
    garrisons = _garrisons(state)
    _recharge(state, rules, garrisons)
    tick = state.tick
    if tick > 0 and tick % rules.supply.dispatch_ticks == 0:
        taken = _take_transfer_shares(state, rules)
        for pid in sorted(state.players):
            events.extend(_dispatch(state, rules, pid, capacities, garrisons, taken))
    return events


def _take_transfer_shares(state: GameState, rules: Ruleset) -> dict[tuple[int, int], int]:
    """Item 10: every transfer packet takes ``min(amount, share)`` of its road this period.

    Returns what the transfers took, by ``(owner, edge)``. A packet's take depends only on the
    packet and its road, so the order of the packets does not matter.
    """
    taken: dict[tuple[int, int], int] = {}
    for pid in sorted(state.packets):
        packet = state.packets[pid]
        if packet.share <= 0:
            continue
        take = min(road_amount(rules), packet.share)
        packet.share -= take
        key = (packet.owner, packet.edge)
        taken[key] = taken.get(key, 0) + take
    return taken


def _owned_by(state: GameState, edge: int, player: int) -> bool:
    e = state.map.edges[edge]
    return state.nodes[e.a].owner == player == state.nodes[e.b].owner


def _move_packets(state: GameState, capacities: tuple[int, ...]) -> list[Event]:
    """Lose packets on roads that are no longer own internal ones, move and deliver the rest."""
    events: list[Event] = []
    tick = state.tick
    mapdef = state.map
    for pid in sorted(state.packets):
        packet = state.packets[pid]
        owner = packet.owner
        if not _owned_by(state, packet.edge, owner):
            del state.packets[pid]
            events.append(_lost(tick, pid, packet))
            continue
        if packet.arrive_tick > tick:
            continue
        node_id = mapdef.edges[packet.edge].other(packet.from_node)
        node = state.nodes[node_id]
        if packet.route:
            nxt = packet.route[0]
            if _owned_by(state, nxt, owner):  # an intermediate node: on at once
                packet.edge = nxt
                packet.from_node = node_id
                packet.depart_tick = tick
                packet.arrive_tick = tick + packet.route_ticks[0]
                packet.route = packet.route[1:]
                packet.route_ticks = packet.route_ticks[1:]
                if packet.transfer:  # a new road: the whole transfer takes its amount again
                    packet.share = packet.charges
                continue
            if not is_city(mapdef, node_id):  # the way is cut at a province: lost
                del state.packets[pid]
                events.append(_lost(tick, pid, packet))
                continue
        del state.packets[pid]  # the end of the path, or the way is cut at an own city
        added = min(packet.charges, max(0, capacities[node_id] - node.warehouse))
        node.warehouse += added
        events.append(
            event(tick, "packet_delivered", packet=pid, player=owner, node=node_id, charges=added)
        )
        if packet.charges > added:
            events.append(
                event(
                    tick,
                    "charges_overflow",
                    player=owner,
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
            if group.fight is not None:
                continue  # no recharge while a fight lasts (DEC-24, H1)
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
    taken: dict[tuple[int, int], int],
) -> list[Event]:
    tree = supply_tree(state, rules, player)
    if len(tree.order) < 2:
        return []
    mapdef = state.map
    nodes = state.nodes
    parent, parent_edge = tree.parent, tree.parent_edge

    # The city tree: every city of the tree under its nearest city ancestor, with the way.
    anc: dict[int, int] = {}  # tree node -> nearest city at or above it
    rest: dict[int, tuple[int, ...]] = {}  # tree node -> edges from anc[node] down to it
    cities: list[int] = []
    up: dict[int, int] = {}
    way: dict[int, tuple[int, ...]] = {}
    kids: dict[int, list[int]] = {}
    for node in tree.order:
        p = parent[node]
        city = is_city(mapdef, node)
        if p is None:
            anc[node], rest[node] = node, ()
        else:
            e = parent_edge[node]
            assert e is not None
            a, r = anc[p], (*rest[p], e)
            if city:
                up[node], way[node] = a, r
                kids[a].append(node)
                anc[node], rest[node] = node, ()
            else:
                anc[node], rest[node] = a, r
        if city:
            cities.append(node)
            kids[node] = []
    if len(cities) < 2:
        return []

    incoming: dict[int, int] = dict.fromkeys(cities, 0)
    for pid in sorted(state.packets):
        packet = state.packets[pid]
        if packet.owner == player:
            dest = packet_dest(state, packet)
            if dest in incoming:
                incoming[dest] += packet.charges
    target: dict[int, int] = {}
    rank: dict[int, int] = {}
    for c in cities:
        discharged = sum(g.units - g.charged for g in garrisons.get(c, ()))
        target[c] = target_stock(rules, capacities[c], discharged)
        rank[c] = nodes[c].priority.rank

    edge_left: dict[int, int] = {}
    sent: dict[tuple[int, int], int] = {}
    order_back = cities[::-1]
    for level in PASSES:
        need: dict[int, int] = {}
        best: dict[int, tuple[int, int, int] | None] = {}
        for c in cities:
            wh = nodes[c].warehouse
            if rank[c] <= level:
                own = target[c] - wh - incoming[c]
                best[c] = (rank[c], wh, mapdef.node_key(player, c)) if own > 0 else None
            else:
                own = -(wh + incoming[c])
                best[c] = None
            need[c] = own
        for c in order_back:  # children before parents
            n = need[c] = max(0, need[c])
            a = up.get(c)
            if a is not None:
                need[a] += n
                b = best[c]
                if b is not None:
                    ba = best[a]
                    if ba is None or b < ba:
                        best[a] = b
        for c in cities:
            node = nodes[c]
            surplus = node.warehouse - (target[c] if rank[c] <= level else 0)
            if surplus <= 0:
                continue
            ready = [k for k in kids[c] if need[k] > 0]
            ready.sort(key=lambda k: best[k] or (3, 0, 0))
            for k in ready:
                if surplus <= 0:
                    break
                amount = min(surplus, need[k], capacities[k] - nodes[k].warehouse - incoming[k])
                for e in way[k]:
                    left = edge_left.get(e)
                    if left is None:
                        amount_e = road_amount(rules)
                        left = edge_left[e] = max(0, amount_e - taken.get((player, e), 0))
                    amount = min(amount, left)
                if amount <= 0:
                    continue
                for e in way[k]:
                    edge_left[e] -= amount
                surplus -= amount
                node.warehouse -= amount
                incoming[k] += amount
                sent[c, k] = sent.get((c, k), 0) + amount

    events: list[Event] = []
    tick = state.tick
    for (c, k), charges in sent.items():  # insertion order: deterministic, first send first
        edges = way[k]
        ticks = tuple(edge_packet_ticks(state, rules, e) for e in edges)
        packet = send_packet(state, player, c, edges, ticks, charges, transfer=False)
        events.append(
            event(
                tick,
                "packet_sent",
                packet=packet.id,
                player=player,
                edge=edges[0],
                from_node=c,
                to_node=k,
                charges=charges,
            )
        )
    return events
