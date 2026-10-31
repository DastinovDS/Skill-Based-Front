"""Supply of the economy v2 (DEC-41, #642; ``economy.model = "v2"``): factories and drawn lines.

The ``supply`` step of a v2 match (``match.SYSTEMS`` runs it instead of ``systems.supply.supply``);
mechanics.md, section 7, "Economy v2", items 2, 3, 5, 6, 8, and its implementation notes (#644).
Numbers come from ``Ruleset.factory``, ``Ruleset.lines`` and ``Ruleset.supply``.

Order inside the step:

1. **Captured factories** (item 2): a factory city whose owner changed in this tick passes to the
   capturer as a built factory while the capturer has fewer than ``factory.max`` factories (its
   factories and its factory builds under way), otherwise it is destroyed. Several captures of one
   player in one tick go in ``node_key`` order of that player (4.1, rule 6).
2. **Broken lines** (item 3): a line whose source or target the player no longer owns is cut
   (event ``line_cut``). A line with another node of its path lost keeps nothing of that path: it
   is rerouted along the fastest way over own nodes from its source to its target
   (``supply.transfer_route``: the sum of ``packet_ticks``, ties by the smaller ``node_key``
   sequence; event ``line_rerouted``), or cut if there is none. An intact path is never changed.
   A captured factory is a captured source, so all of its lines are cut.
3. **Packets** move as in v1 (``supply.move_packets``: a packet on a road that is no longer own is
   lost, at an own city with the way cut it is taken into the warehouse, at the end of its path it
   fills the warehouse, the excess burns as ``charges_overflow``). A packet that ends in a relay
   (a node with outgoing lines) adds its charges to the relay's ``inbox``.
4. **Recharge** of standing units from the warehouse, as in v1 (``supply.recharge``).
5. **Dispatch**, every ``supply.dispatch_ticks`` (ticks ``t > 0`` divisible by it). Every own node
   with outgoing lines runs its round robin once, nodes in ``node_key`` order:

   - the slots: the node itself if it is a relay (the target of an own line, not a factory: L5),
     then its outgoing lines by id; ``Node.rr`` is the slot that gets the next charge;
   - the charges it gives out: the whole warehouse of a factory; the ``inbox`` of a relay;
   - from ``rr``, one lap over the slots: a line whose target is full (``warehouse`` plus the
     charges of own packets on the way to it at least the warehouse capacity) is skipped (L6);
     else, while charges are left, the slot takes one: the own slot keeps it in the warehouse (it
     leaves the ``inbox``), a line sends it as a packet of one charge along its path (L1: one
     charge per line and dispatch, roads do not limit it). When the charges run out first, ``rr``
     stays on the slot that got none; after a full lap it stays where the lap began.

A packet travels at ``supply.base_speed_pct`` (item 8): roads have no levels in v2. There are no
front markers, rear minimum, donors, delivery passes, transfers or starvation (item 5).

Cost per tick: O(V + L * P + packets + groups), ``L`` the lines and ``P`` their path lengths; a
reroute adds one Dijkstra (``transfer_route``), a dispatch one walk over the lines.
"""

from gow_sim.ruleset import Ruleset
from gow_sim.state import Event, GameState, Line, Node, Packet, event
from gow_sim.systems.capacity import warehouse_capacities
from gow_sim.systems.supply import (
    all_packet_ticks,
    garrisons_by_node,
    move_packets,
    packet_dest,
    recharge,
    send_packet,
    transfer_route,
)

__all__ = [
    "creates_cycle",
    "factory_count",
    "is_line_source",
    "line_edges",
    "lines_out",
    "supply_lines",
]


def supply_lines(state: GameState, rules: Ruleset) -> list[Event]:
    """The supply step of the economy v2 (see the module docstring)."""
    events: list[Event] = []
    _settle_factories(state, rules)
    for pid in sorted(state.players):
        events.extend(_check_lines(state, rules, pid))
    capacities = warehouse_capacities(state, rules)
    relays = {pid: _relays(state, pid) for pid in sorted(state.players)}

    def delivered(packet: Packet, node: int, charges: int) -> None:
        n = state.nodes[node]
        if relays[packet.owner].get(node, False) and n.factory != packet.owner:
            n.inbox += charges

    events.extend(move_packets(state, capacities, delivered))
    recharge(state, rules, garrisons_by_node(state))
    tick = state.tick
    if tick > 0 and tick % rules.supply.dispatch_ticks == 0:
        edge_ticks = all_packet_ticks(state, rules)
        for pid in sorted(state.players):
            events.extend(_dispatch(state, pid, capacities, edge_ticks))
    return events


# Factories -------------------------------------------------------------------------------------


def factory_count(state: GameState, player: int) -> int:
    """Factories of ``player`` for ``factory.max`` (DEC-41, item 2): its factory cities and the
    factory builds it has under way."""
    count = 0
    for node in state.nodes.values():  # a count: the order does not matter
        if node.factory == player and node.owner == player:
            count += 1
        if node.factory_build is not None and node.factory_build.owner == player:
            count += 1
    return count


def _settle_factories(state: GameState, rules: Ruleset) -> None:
    """Item 2: a factory captured in this tick passes to the capturer or is destroyed."""
    captured: dict[int, list[int]] = {}
    for nid in sorted(state.nodes):
        node = state.nodes[nid]
        if node.factory is not None and node.factory != node.owner:
            node.factory = None  # counted again below if it passes
            if node.owner is not None:
                captured.setdefault(node.owner, []).append(nid)
    limit = rules.factory_rules().max
    for player in sorted(captured):
        for nid in sorted(captured[player], key=lambda n: state.map.node_key(player, n)):
            if factory_count(state, player) < limit:
                state.nodes[nid].factory = player


# Lines -----------------------------------------------------------------------------------------


def lines_out(state: GameState, player: int, node: int) -> list[Line]:
    """The own lines that start at ``node``, by id."""
    lines = state.players[player].lines
    return [lines[k] for k in sorted(lines) if lines[k].source == node]


def is_line_source(state: GameState, player: int, node: int) -> bool:
    """``node`` may start a line (DEC-41, item 3): an own factory or the target of an own line."""
    n = state.nodes[node]
    if n.owner == player and n.factory == player:
        return True
    lines = state.players[player].lines
    return any(lines[k].target == node for k in sorted(lines))


def creates_cycle(state: GameState, player: int, source: int, target: int) -> bool:
    """A new line ``source -> target`` closes a cycle of own lines (L4): a chain of own lines
    already leads from ``target`` back to ``source``."""
    lines = state.players[player].lines
    seen: dict[int, bool] = {target: True}
    stack = [target]
    while stack:
        node = stack.pop()
        if node == source:
            return True
        for k in sorted(lines):
            nxt = lines[k].target
            if lines[k].source == node and nxt not in seen:
                seen[nxt] = True
                stack.append(nxt)
    return False


def line_edges(state: GameState, path: tuple[int, ...]) -> tuple[int, ...] | None:
    """The roads of a path of nodes, one per pair of neighbours; ``None`` when two consecutive
    nodes are not joined by a road."""
    mapdef = state.map
    edges: list[int] = []
    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        road = next((e for e in mapdef.incident[a] if mapdef.edges[e].other(a) == b), None)
        if road is None:
            return None
        edges.append(road)
    return tuple(edges)


def _check_lines(state: GameState, rules: Ruleset, player: int) -> list[Event]:
    """Cut or reroute the broken lines of ``player`` (see the module docstring, step 2)."""
    nodes = state.nodes
    lines = state.players[player].lines
    events: list[Event] = []
    for k in sorted(lines):
        line = lines[k]
        if all(nodes[n].owner == player for n in line.path):
            continue  # intact: the drawn path stays (item 6)
        route = None
        if nodes[line.source].owner == player and nodes[line.target].owner == player:
            route = transfer_route(state, rules, player, line.source, line.target)
        src, dst = line.source, line.target
        if route is None:
            del lines[k]
            events.append(
                event(state.tick, "line_cut", player=player, line=k, from_node=src, to_node=dst)
            )
        else:
            line.path = route.nodes
            events.append(
                event(
                    state.tick, "line_rerouted", player=player, line=k, from_node=src, to_node=dst
                )
            )
    return events


def _relays(state: GameState, player: int) -> dict[int, bool]:
    """The nodes with an outgoing line of ``player``: their line deliveries go to the inbox."""
    lines = state.players[player].lines
    return {lines[k].source: True for k in sorted(lines)}


# Dispatch --------------------------------------------------------------------------------------

_SELF = -1
"""The own slot of a relay in its round robin (L5)."""


def _dispatch(
    state: GameState, player: int, capacities: tuple[int, ...], edge_ticks: tuple[int, ...]
) -> list[Event]:
    """One dispatch of ``player``: every source node runs its round robin once (module docstring,
    step 5)."""
    lines = state.players[player].lines
    if not lines:
        return []
    nodes = state.nodes
    out: dict[int, list[int]] = {}
    targets: dict[int, bool] = {}
    for k in sorted(lines):
        out.setdefault(lines[k].source, []).append(k)
        targets[lines[k].target] = True
    incoming: dict[int, int] = {}
    for pid in sorted(state.packets):
        packet = state.packets[pid]
        if packet.owner == player:
            dest = packet_dest(state, packet)
            incoming[dest] = incoming.get(dest, 0) + packet.charges

    def full(target: int) -> bool:
        stock = nodes[target].warehouse + incoming.get(target, 0)
        return stock >= capacities[target]

    events: list[Event] = []
    for src in sorted(out, key=lambda n: state.map.node_key(player, n)):
        node = nodes[src]
        factory = node.factory == player
        # TODO(#651): the relay slot and the inbox are the reading of L5 in mechanics.md (#644).
        slots = ([] if factory or not targets.get(src, False) else [_SELF]) + out[src]
        if not factory:
            node.inbox = min(node.inbox, node.warehouse)  # units may have taken some
        left = node.warehouse if factory else node.inbox
        start = node.rr % len(slots)
        node.rr = start
        for i in range(len(slots)):
            slot = slots[(start + i) % len(slots)]
            if slot != _SELF and full(lines[slot].target):
                continue  # L6: skipped, the source keeps the charge
            if left == 0:
                node.rr = (start + i) % len(slots)  # this slot gets the next charge
                break
            left -= 1
            if slot == _SELF:
                node.inbox -= 1  # kept in the own warehouse
                continue
            events.append(_send(state, player, node, lines[slot], edge_ticks, factory=factory))
            target = lines[slot].target
            incoming[target] = incoming.get(target, 0) + 1
    return events


def _send(
    state: GameState,
    player: int,
    node: Node,
    line: Line,
    edge_ticks: tuple[int, ...],
    *,
    factory: bool,
) -> Event:
    """One charge of ``node`` leaves along ``line`` as a packet (L1)."""
    edges = line_edges(state, line.path)
    assert edges is not None  # an own line always follows roads (validated, rerouted)
    node.warehouse -= 1
    if not factory:
        node.inbox -= 1
    packet = send_packet(
        state,
        player,
        line.source,
        edges,
        tuple(edge_ticks[e] for e in edges),
        1,
        transfer=False,
    )
    return event(
        state.tick,
        "packet_sent",
        packet=packet.id,
        player=player,
        edge=edges[0],
        from_node=line.source,
        to_node=line.target,
        charges=1,
    )
