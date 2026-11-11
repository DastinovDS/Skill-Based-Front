"""Packets and recharge (SIM-08, DEC-18): what the supply flow (``systems.flow``, DEC-43) and the
spill of a full factory (``systems.economy``) share.

- Packet speed (DEC-41, item 8): every road takes ``packet_ticks = travel_ticks * 100 //
  supply.speed_pct`` ticks (rounded down, at least 1); roads have no levels.
- Packet on its path (DEC-18, item 5): on a road that is no longer internal to its owner it is
  lost (``packet_lost``). At an intermediate own node it goes on at once; if the next road is no
  longer internal, an own city takes the charges into its warehouse, a province loses them
  (``packet_lost``). At the end of the path the charges go into the warehouse within the capacity,
  the excess burns (``charges_overflow``).
- Recharge: each tick, units of the node owner standing in the node (``capacity.is_standing``)
  take charges from the warehouse, at most ``supply.recharge_per_tick`` per node and tick, the
  lowest group id first. Units on edges do not recharge, nor do groups in a fight while it lasts
  (DEC-24, H1: packets still reach the warehouse of the node).

Charges are created only by the economy (``charges_produced``) and leave the supply chain only
through recharge, the payments of builds and plans, starvation or the documented sinks
``packet_lost``, ``charges_overflow``, ``charge_burned`` and ``warehouse_lost``.
"""

from gow_sim.maps import MapDef, NodeKind
from gow_sim.ruleset import Ruleset
from gow_sim.state import AtNode, Event, GameState, Group, Packet, event
from gow_sim.systems.capacity import is_standing


def packet_ticks(mapdef: MapDef, rules: Ruleset, edge: int) -> int:
    """Ticks a packet needs along ``edge`` (see the module docstring)."""
    return max(1, mapdef.edges[edge].travel_ticks * 100 // rules.supply.speed_pct)  # rounded down


def edge_packet_ticks(state: GameState, rules: Ruleset, edge: int) -> int:
    """``packet_ticks`` of ``edge``."""
    return packet_ticks(state.map, rules, edge)


def is_city(mapdef: MapDef, node: int) -> bool:
    """A node with a city; a province (DEC-23) is not one."""
    return mapdef.nodes[node].kind is not NodeKind.PROVINCE


def send_packet(
    state: GameState,
    player: int,
    from_node: int,
    edges: tuple[int, ...],
    ticks: tuple[int, ...],
    charges: int,
) -> Packet:
    """A new packet of ``player`` leaving ``from_node`` along ``edges`` now (DEC-18, item 5)."""
    pid = state.new_id()
    depart = state.tick
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


def _owned_by(state: GameState, edge: int, player: int) -> bool:
    e = state.map.edges[edge]
    return state.nodes[e.a].owner == player == state.nodes[e.b].owner


def move_packets(state: GameState, capacities: tuple[int, ...]) -> list[Event]:
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


def garrisons_by_node(state: GameState) -> dict[int, list[Group]]:
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


def recharge(state: GameState, rules: Ruleset, garrisons: dict[int, list[Group]]) -> None:
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
