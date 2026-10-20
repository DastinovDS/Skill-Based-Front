"""Supply (SIM-08, DEC-18, DEC-28): packets between own cities, transfers, recharge.

Rules (mechanics.md, section 7, blocks DEC-18 and DEC-19; section 8, block DEC-28; DEC-02: only
the capital produces charges; DEC-22, item 4: road parameters), numbers from ``Ruleset.supply``:

- Supply tree (DEC-18, item 3): Dijkstra from the own capital over own nodes joined by internal
  roads (every road between two own nodes is internal), metric ``packet_ticks``; among parents at
  the same distance the one with the lower ``node_key(player, node)`` wins. Cut-off nodes are not
  in the tree and take no part in the supply (DEC-28, example 9). Provinces (DEC-23) have no
  warehouse and no target. The distance of a city from the capital is its tree distance.
- Targets (DEC-28, items 2, 3, 5): a city with a front marker fills its warehouse (target: the
  warehouse capacity); the capital without a marker has target 0 (all of its stock is a donor's);
  any other city (a rear city) ``min(rear_min, warehouse capacity)``. The warehouse capacity is
  the node capacity, or with ``city_upgrades`` its own (DEC-26, item 6;
  ``capacity.warehouse_capacity``).
- Dispatch every ``supply.dispatch_ticks`` ticks (ticks ``t > 0`` divisible by it), recomputed
  every time (DEC-28, item 4). Deficit of a city: ``target - warehouse - incoming``
  (``incoming``: charges of own packets whose path ends in it). Cities with a deficit are served
  in this order: the marker cities, fewer charges in the warehouse first, ties by the lower
  ``node_key`` (4.1); then the rear cities, farthest from the capital first, ties by the lower
  ``node_key`` (4.2). The rest stays in the capital (4.3).
- Donors (DEC-28, item 5): a deficit is closed by the nearest city with a stock above its own
  target (distance: the sum of ``packet_ticks`` of the fastest way over own nodes; ties by the
  lower ``node_key`` of the donor), then the next one; a donor never gives below its target.
- Transit (DEC-28, item 1): a packet goes from the donor straight to the city with the deficit
  along the fastest way over own nodes (the way of a transfer, ``transfer_route``) and does not
  touch the warehouses on the way; free room counts only at the end of the way. What one city
  sends to one city in a period goes as one packet.
- Throughput: a road lets ``amount`` charges through per dispatch period (DEC-22, item 4),
  shared by every packet of the period that uses it and minus what the transfers took (DEC-18,
  item 10). A send gets at most what is left on every road of its way.
- The full capital (DEC-28, item 4.4): the produced charges that did not fit into the capital
  (``spill`` of the event ``charges_produced`` of the economy in this tick) first fill the room
  the dispatch of this tick made in the capital, then go to the rear cities with free room
  (``warehouse capacity - warehouse - incoming``), nearest to the capital first, ties by the lower
  ``node_key``, within the throughput; the rest burns (``charges_overflow``). On a tick without
  a dispatch the spill burns at once.
- Front markers fall back (DEC-28, item 2, example 8): a marker whose city the player lost moves
  to the first own city on the fastest way from that city to the capital (over the supply tree)
  that does not hold the other marker; without such a way, to the capital if it is free; else it
  is removed. Event ``front_set`` with ``reason = "fallback"``.
- Road parameters by level (DEC-22, item 4; roads have no type, DEC-26, item 7): ``speed_pct``
  is ``supply.base_speed_pct`` on level 1 and ``supply.fast_speed_pct[level]`` on an upgraded
  road; ``amount`` is ``supply.base_amount`` on every level. A packet needs
  ``packet_ticks = travel_ticks * 100 // speed_pct`` ticks per road (rounded down, at least 1),
  by the road at departure; the times never change afterwards.
- Packet on its path (DEC-18, item 5): on a road that is no longer internal to its owner it is
  lost (``packet_lost``) on any level (DEC-26, item 7: no freight road, no ``packet_captured``).
  At an intermediate own node it goes on at once; if the next road is no longer internal,
  an own city takes the charges into its warehouse, a province loses them (``packet_lost``). At
  the end of the path the charges go into the warehouse within the capacity, the excess burns
  (``charges_overflow``).
- Transfer (DEC-18, item 6, ``commands.Transfer``; #287): ``n`` is cut to the free room of the
  target warehouse (``warehouse_room``); the fastest way by ``packet_ticks``, ties by the
  lexicographically smaller ``node_key`` sequence. It goes in batches: batch ``k`` of
  ``min(amount, left)`` charges leaves ``k * dispatch_ticks`` ticks after the command (the first
  at once) as a packet of its own; until then it waits in the source city (a packet with a later
  ``depart_tick``). A waiting batch whose first road stops being internal goes back into the
  warehouse of the source while the source is own, otherwise it is lost. Targets and the rear
  minimum do not limit a transfer (DEC-28, item 6).
- Transfers share the ``amount`` of a road with the automatic dispatch and take it first
  (DEC-18, item 10, #253): a transfer packet entering a road gets the ``share`` of all its
  charges there; on every dispatch tick while it is on the road (and has left) it takes
  ``min(amount, share)`` of the road's ``amount`` (``share`` falls by as much), and the automatic
  dispatch of the period gets ``max(0, amount - taken)``.
- Recharge: each tick, units of the node owner standing in the node (``capacity.is_standing``)
  take charges from the warehouse, at most ``supply.recharge_per_tick`` per node and tick, the
  lowest group id first. Units on edges do not recharge, nor do groups in a fight while it lasts
  (DEC-24, H1: packets still reach the warehouse of the node).

Order inside the system (DEC-18, item 9): markers fall back, lost packets, packets along their
path and deliveries, recharge, the transfer shares (item 10), dispatch with the spill of the
capital. Charges are created only by the economy (``charges_produced``) and leave the supply
chain only through recharge or the documented sinks ``packet_lost``, ``charges_overflow`` and
``warehouse_lost``.

Cost per tick: O(V + E + P + G); a dispatch tick adds the tree (Dijkstra, O(E log V)), one
Dijkstra per city with a deficit and one per packet sent.
"""

import heapq
from dataclasses import dataclass

from gow_sim.maps import MapDef, NodeKind
from gow_sim.ruleset import Ruleset
from gow_sim.state import FRONT_MARKERS, AtNode, Event, GameState, Group, Packet, event
from gow_sim.systems.capacity import is_standing, warehouse_capacities


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


def transfer_batches(rules: Ruleset, n: int) -> int:
    """Batches of a transfer of ``n`` charges (DEC-18, item 6): ``ceil(n / amount)``, one per
    dispatch period; ``ceil(n / a) = (n + a - 1) // a``, both positive."""
    amount = road_amount(rules)
    return (n + amount - 1) // amount


def city_target(
    state: GameState, player: int, node: int, warehouse_cap: int, *, front: bool
) -> int:
    """Target stock of the own city ``node`` (DEC-28, items 2, 3, 5): a city with a front marker
    (``front``) its warehouse capacity; the capital without a marker 0; any other city
    ``min(rear_min, warehouse capacity)``."""
    if front:
        return warehouse_cap
    if node == state.map.capital(player):
        return 0
    return min(state.players[player].rear_min, warehouse_cap)


def is_city(mapdef: MapDef, node: int) -> bool:
    """A node with a city and a warehouse; a province (DEC-23) is not one."""
    return mapdef.nodes[node].kind is not NodeKind.PROVINCE


@dataclass(frozen=True, slots=True)
class SupplyTree:
    """Shortest-path tree of a player's supplied territory, rooted at the own capital.

    ``order``: the tree nodes by distance from the capital (capital first), so every parent
    comes before its children. ``parent[n]`` and ``parent_edge[n]``: the next node towards the
    capital and the road to it; ``None`` for the capital and for nodes outside the tree.
    ``dist[n]``: the sum of ``packet_ticks`` from the capital, ``-1`` outside the tree.
    """

    order: tuple[int, ...]
    parent: tuple[int | None, ...]
    parent_edge: tuple[int | None, ...]
    dist: tuple[int, ...] = ()


def supply_tree(state: GameState, rules: Ruleset, player: int) -> SupplyTree:
    """Build the supply tree of ``player`` (see the module docstring). Empty without capital."""
    mapdef = state.map
    size = len(mapdef.nodes)
    parent: list[int | None] = [None] * size
    parent_edge: list[int | None] = [None] * size
    order: list[int] = []
    capital = mapdef.capital(player)
    dist = [-1] * size
    if state.nodes[capital].owner != player:
        return SupplyTree((), tuple(parent), tuple(parent_edge), tuple(dist))
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
    return SupplyTree(tuple(order), tuple(parent), tuple(parent_edge), tuple(dist))


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
    state: GameState, rules: Ruleset, player: int, src: int, dst: int
) -> TransferRoute | None:
    """The fastest way of a transfer from ``src`` to ``dst`` (DEC-18, item 6).

    Only own nodes, so only internal roads; ``packet_ticks`` per road (every batch takes the same
    way, the number of batches does not depend on it, #287); among ways of equal time
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
            cand = (dist + edge_packet_ticks(state, rules, eid), (*keys, key(nxt)))
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
        ticks=tuple(edge_packet_ticks(state, rules, e) for e in path_edges),
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
    delay: int = 0,
) -> Packet:
    """A new packet of ``player`` leaving ``from_node`` along ``edges`` (DEC-18, item 5) now, or
    ``delay`` ticks later (a later batch of a transfer, which waits in ``from_node`` till then)."""
    pid = state.new_id()
    depart = state.tick + delay
    packet = Packet(
        id=pid,
        owner=player,
        edge=edges[0],
        from_node=from_node,
        charges=charges,
        depart_tick=depart,
        arrive_tick=depart + ticks[0],
        route=edges[1:],
        route_ticks=ticks[1:],
        transfer=transfer,
        share=charges if transfer else 0,
    )
    state.packets[pid] = packet
    return packet


def incoming_charges(state: GameState, player: int, node: int) -> int:
    """Charges of the own packets of ``player`` whose path ends in ``node`` ("on the way to it")."""
    total = 0
    for pid in sorted(state.packets):
        packet = state.packets[pid]
        if packet.owner == player and packet_dest(state, packet) == node:
            total += packet.charges
    return total


def warehouse_room(state: GameState, rules: Ruleset, player: int, node: int) -> int:
    """Free room of the warehouse of the own city ``node``: ``capacity - warehouse - incoming``,
    at least 0 (DEC-18, item 6, #287: a transfer is cut to it)."""
    cap = warehouse_capacities(state, rules)[node]
    used = state.nodes[node].warehouse + incoming_charges(state, player, node)
    return max(0, cap - used)


def transfer_arrive_tick(state: GameState, rules: Ruleset, route: TransferRoute, n: int) -> int:
    """The tick the last batch of a transfer of ``n`` charges applied now reaches its end."""
    last = (transfer_batches(rules, n) - 1) * rules.supply.dispatch_ticks
    return state.tick + last + route.total_ticks


def send_transfer(
    state: GameState, rules: Ruleset, player: int, route: TransferRoute, n: int
) -> list[Packet]:
    """The batches of a transfer of ``n`` charges applied now (DEC-18, item 6, #287): batch ``k``
    of ``min(amount, left)`` charges leaves ``k * supply.dispatch_ticks`` ticks later, the first
    one now; every batch is a packet of its own with its own ``share`` (item 10)."""
    amount = road_amount(rules)
    packets: list[Packet] = []
    left = n
    k = 0
    while left > 0:
        charges = min(amount, left)
        delay = k * rules.supply.dispatch_ticks
        packets.append(
            send_packet(
                state,
                player,
                route.nodes[0],
                route.edges,
                route.ticks,
                charges,
                transfer=True,
                delay=delay,
            )
        )
        left -= charges
        k += 1
    return packets


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
    events: list[Event] = []
    for pid in sorted(state.players):
        events.extend(_fall_back_fronts(state, rules, pid))
    capacities = warehouse_capacities(state, rules)
    events.extend(_move_packets(state, capacities))
    garrisons = _garrisons(state)
    _recharge(state, rules, garrisons)
    spill = _spill(state)
    tick = state.tick
    if tick > 0 and tick % rules.supply.dispatch_ticks == 0:
        taken = _take_transfer_shares(state, rules)
        for pid in sorted(state.players):
            events.extend(_dispatch(state, rules, pid, capacities, taken, spill.get(pid, 0)))
    else:
        for pid in sorted(spill):
            events.extend(_store_spill(state, pid, capacities, spill[pid]))
    return events


def _spill(state: GameState) -> dict[int, int]:
    """Produced charges that did not fit into the capital this tick, by player (DEC-28, 4.4)."""
    spill: dict[int, int] = {}
    for e in state.events:
        if e.tick == state.tick and e.kind == "charges_produced":
            extra = e.get("spill")  # always set by the economy
            player = e.get("player")
            if isinstance(extra, int) and isinstance(player, int) and extra > 0:
                spill[player] = spill.get(player, 0) + extra
    return spill


def _store_spill(
    state: GameState, player: int, capacities: tuple[int, ...], spill: int
) -> list[Event]:
    """Put ``spill`` into the free room of the capital; the rest burns (``charges_overflow``)."""
    capital = state.map.capital(player)
    node = state.nodes[capital]
    room = max(0, capacities[capital] - node.warehouse - incoming_charges(state, player, capital))
    added = min(spill, room) if node.owner == player else 0
    node.warehouse += added
    if spill > added:
        return [
            event(
                state.tick, "charges_overflow", player=player, node=capital, charges=spill - added
            )
        ]
    return []


def front_fallback(
    state: GameState, rules: Ruleset, player: int, lost: int, other: int | None
) -> int | None:
    """Where a front marker of ``player`` goes when its city ``lost`` is lost (DEC-28, item 2,
    example 8): the first own city on the fastest way from ``lost`` to the capital over the
    supply tree that is not ``other`` (the city of the other marker); the way leaves ``lost``
    through the own neighbour with the smallest ``dist + packet_ticks``, ties by the lower
    ``node_key``. Without such a neighbour: the capital, if it is in the tree and not ``other``.
    ``None``: nowhere (the marker is removed)."""
    mapdef = state.map
    tree = supply_tree(state, rules, player)
    if not tree.order:
        return None
    best: tuple[int, int, int] | None = None
    for eid in mapdef.incident[lost]:
        nxt = mapdef.edges[eid].other(lost)
        d = tree.dist[nxt]
        if d < 0:
            continue
        cand = (d + edge_packet_ticks(state, rules, eid), mapdef.node_key(player, nxt), nxt)
        if best is None or cand < best:
            best = cand
    way: list[int] = []
    node: int | None = tree.order[0] if best is None else best[2]
    while node is not None:
        way.append(node)
        node = tree.parent[node]
    for node in way:
        if is_city(mapdef, node) and node != other:
            return node
    return None


def _fall_back_fronts(state: GameState, rules: Ruleset, player: int) -> list[Event]:
    """Markers on cities the player no longer owns fall back (see ``front_fallback``); the
    markers go in index order, so the second one avoids where the first one went."""
    ps = state.players[player]
    fronts = list(ps.fronts)
    events: list[Event] = []
    for i in range(FRONT_MARKERS):
        lost = fronts[i]
        if lost is None or state.nodes[lost].owner == player:
            continue
        others = [f for j, f in enumerate(fronts) if j != i and f is not None]
        other = others[0] if others else None
        fronts[i] = front_fallback(state, rules, player, lost, other)
        events.append(
            event(
                state.tick, "front_set", player=player, marker=i, node=fronts[i], reason="fallback"
            )
        )
    ps.fronts = tuple(fronts)
    return events


def _take_transfer_shares(state: GameState, rules: Ruleset) -> dict[tuple[int, int], int]:
    """Item 10: every transfer packet takes ``min(amount, share)`` of its road this period.

    Returns what the transfers took, by ``(owner, edge)``. A packet's take depends only on the
    packet and its road, so the order of the packets does not matter.
    """
    taken: dict[tuple[int, int], int] = {}
    for pid in sorted(state.packets):
        packet = state.packets[pid]
        if packet.share <= 0 or packet.depart_tick > state.tick:
            continue  # a batch still waiting in its city takes nothing yet
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
            start = packet.from_node
            waiting = packet.depart_tick > tick  # a later transfer batch, still in its city
            if not (waiting and state.nodes[start].owner == owner):
                del state.packets[pid]
                events.append(_lost(tick, pid, packet))
                continue
            node_id = start  # its way is cut: back into the warehouse of the own city (#287)
        elif packet.arrive_tick > tick:
            continue
        else:
            node_id = mapdef.edges[packet.edge].other(packet.from_node)
        node = state.nodes[node_id]
        if packet.route and node_id != packet.from_node:
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


def _distances(state: GameState, rules: Ruleset, player: int, src: int) -> dict[int, int]:
    """The sum of ``packet_ticks`` of the fastest way from ``src`` to every own node it reaches
    over own nodes (every road between two of them is internal)."""
    mapdef = state.map
    nodes = state.nodes
    dist: dict[int, int] = {src: 0}
    done: dict[int, bool] = {}
    heap = [(0, src)]
    while heap:
        d, node = heapq.heappop(heap)
        if node in done:
            continue
        done[node] = True
        for eid in mapdef.incident[node]:
            nxt = mapdef.edges[eid].other(node)
            if nxt in done or nodes[nxt].owner != player:
                continue
            cand = d + edge_packet_ticks(state, rules, eid)
            if nxt not in dist or cand < dist[nxt]:
                dist[nxt] = cand
                heapq.heappush(heap, (cand, nxt))
    return dist


@dataclass(slots=True)
class _Period:
    """What the dispatch of one player in one period has sent so far."""

    edge_left: dict[int, int]
    """Throughput left by road, filled lazily: ``amount`` minus what transfers took."""
    sent: dict[tuple[int, int], tuple[TransferRoute, int]]
    """``(from, to)``: the way and the charges, in the order of the first send."""


def _dispatch(
    state: GameState,
    rules: Ruleset,
    player: int,
    capacities: tuple[int, ...],
    taken: dict[tuple[int, int], int],
    spill: int,
) -> list[Event]:
    """One dispatch of ``player`` (DEC-28, items 1, 4, 5; see the module docstring)."""
    tree = supply_tree(state, rules, player)
    if not tree.order:  # no own capital: no supply, the production burns
        return _store_spill(state, player, capacities, spill) if spill > 0 else []
    mapdef = state.map
    nodes = state.nodes
    capital = tree.order[0]
    cities = [n for n in tree.order if is_city(mapdef, n)]
    fronts = [f for f in state.players[player].fronts if f is not None and tree.dist[f] >= 0]
    incoming: dict[int, int] = dict.fromkeys(cities, 0)
    for pid in sorted(state.packets):
        packet = state.packets[pid]
        if packet.owner == player:
            dest = packet_dest(state, packet)
            if dest in incoming:
                incoming[dest] += packet.charges
    target = {c: city_target(state, player, c, capacities[c], front=c in fronts) for c in cities}

    def key(node: int) -> int:
        return mapdef.node_key(player, node)

    period = _Period(edge_left={}, sent={})

    def send(src: int, dst: int, charges: int) -> int:
        """Send up to ``charges`` from ``src`` to ``dst`` within the throughput; how many went."""
        route = transfer_route(state, rules, player, src, dst)
        if route is None:
            return 0
        for e in route.edges:
            left = period.edge_left.get(e)
            if left is None:
                left = period.edge_left[e] = max(0, road_amount(rules) - taken.get((player, e), 0))
            charges = min(charges, left)
        if charges <= 0:
            return 0
        for e in route.edges:
            period.edge_left[e] -= charges
        incoming[dst] += charges
        old = period.sent.get((src, dst))
        period.sent[src, dst] = (route, charges + (0 if old is None else old[1]))
        return charges

    # 4.1: the marker cities, fewer charges first; 4.2: the rear cities, farthest first.
    marked = sorted(fronts, key=lambda c: (nodes[c].warehouse, key(c)))
    rear = sorted(
        (c for c in cities if c not in fronts and c != capital),
        key=lambda c: (-tree.dist[c], key(c)),
    )
    for c in (*marked, *rear):
        deficit = target[c] - nodes[c].warehouse - incoming[c]
        if deficit <= 0:
            continue
        dist = _distances(state, rules, player, c)
        donors = sorted(
            (d for d in cities if d != c and nodes[d].warehouse > target[d]),
            key=lambda d: (dist[d], key(d)),
        )
        for d in donors:  # item 5: the nearest donor first, never below its own target
            if deficit <= 0:
                break
            went = send(d, c, min(deficit, nodes[d].warehouse - target[d]))
            nodes[d].warehouse -= went
            deficit -= went

    events: list[Event] = []
    tick = state.tick
    if spill > 0:  # 4.4: the full capital spills over the rear cities, nearest first
        room = capacities[capital] - nodes[capital].warehouse - incoming[capital]
        back = min(spill, max(0, room))
        nodes[capital].warehouse += back
        spill -= back
        for c in sorted(rear, key=lambda c: (tree.dist[c], key(c))):
            if spill <= 0:
                break
            free = capacities[c] - nodes[c].warehouse - incoming[c]
            if free > 0:
                spill -= send(capital, c, min(spill, free))
        if spill > 0:
            events.append(
                event(tick, "charges_overflow", player=player, node=capital, charges=spill)
            )

    for (c, k), (route, charges) in period.sent.items():  # insertion order: first send first
        packet = send_packet(state, player, c, route.edges, route.ticks, charges, transfer=False)
        events.append(
            event(
                tick,
                "packet_sent",
                packet=packet.id,
                player=player,
                edge=route.edges[0],
                from_node=c,
                to_node=k,
                charges=charges,
            )
        )
    return events
