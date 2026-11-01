"""Supply of the economy v2 (DEC-41, #642; ``economy.model = "v2"``): factories and drawn lines.

The ``supply`` step of a v2 match (``match.SYSTEMS`` runs it instead of ``systems.supply.supply``);
mechanics.md, section 7, "Economy v2", items 2, 3, 5, 6, 8, its implementation notes (#644) and
DEC-42 (owner decision 2026-11-01, #674: lines start only at factories, no limit of lines, hub
factories, auto-extension copies the nearest line). Numbers come from ``Ruleset.factory``,
``Ruleset.lines`` and ``Ruleset.supply``.

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
2a. **Auto-extension** (DEC-42, item 5), for a player with ``PlayerState.auto_lines`` on
   (``lines.auto_extend`` at the start, then ``SetAutoLines``): every city (not a province) the
   player captured in this tick (``node_captured``) that is still own and not an own factory, in
   ``node_key`` order of the player, gets a **copy of the nearest own line**. For every own line
   (by id) and every node ``n`` of its path, the extension is the fastest way over own nodes from
   ``n`` to the city that avoids the nodes before ``n`` on that path (the rule of a leg of the
   suggested path, ``view.line_route``; ``n`` the city itself: no extension, 0 ticks). The
   nearest is the fewest extension ticks, at most ``lines.auto_extend_ticks``; ties by the
   smaller ``node_key`` of ``n``, then the smaller line id. The new line starts at that line's
   factory, follows its path up to ``n`` and then the extension (event ``line_auto``); the line
   it copies is not changed. No own line that near: nothing happens. A line made this way counts
   for a later capture of the same tick.
3. **Packets** move as in v1 (``supply.move_packets``: a packet on a road that is no longer own is
   lost, at an own city with the way cut it is taken into the warehouse, at the end of its path it
   fills the warehouse, the excess burns as ``charges_overflow``). A packet that ends in a factory
   fills its warehouse like any other: the factory gives it out with its production (a hub).
4. **Recharge** of standing units from the warehouse, as in v1 (``supply.recharge``).
5. **Dispatch**, every ``supply.dispatch_ticks`` (ticks ``t > 0`` divisible by it). Every own
   factory with outgoing lines runs its round robin once, factories in ``node_key`` order:

   - the slots are its outgoing lines by id; ``Node.rr`` is the slot that gets the next charge;
   - it gives out its whole warehouse (its production and what lines brought into it);
   - the **room** of a line's target ``T``: ``max(0, capacity - warehouse)`` of ``T`` minus the
     charges of own packets on the way to ``T``, at least 0;
   - from ``rr``, one lap over the slots: a line is skipped when the room of its target is 0
     (L6, the factory keeps the charge); else, while charges are left, the line sends one as a
     packet of one charge along its path (L1: one charge per line and dispatch, roads do not
     limit it). When the charges run out first, ``rr`` stays on the line that got none; after a
     full lap it stays where the lap began.

   A line has no limit of number (DEC-42, item 2) and only its target receives its charges.

A packet travels at ``supply.base_speed_pct`` (item 8): roads have no levels in v2. There are no
front markers, rear minimum, donors, delivery passes, transfers or starvation (item 5).

Cost per tick: O(V + L * P + packets + groups), ``L`` the lines and ``P`` their path lengths; a
reroute adds one Dijkstra (``transfer_route``), an auto-extension one per node of the own lines,
a dispatch one walk over the lines.
"""

from gow_sim.ruleset import Ruleset
from gow_sim.state import Event, GameState, Line, Node, event
from gow_sim.systems.capacity import warehouse_capacities
from gow_sim.systems.supply import (
    all_packet_ticks,
    garrisons_by_node,
    is_city,
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
    "supply_lines",
]


def supply_lines(state: GameState, rules: Ruleset) -> list[Event]:
    """The supply step of the economy v2 (see the module docstring)."""
    events: list[Event] = []
    _settle_factories(state, rules)
    for pid in sorted(state.players):
        events.extend(_check_lines(state, rules, pid))
        events.extend(_auto_extend(state, rules, pid))
    capacities = warehouse_capacities(state, rules)
    events.extend(move_packets(state, capacities))
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


def is_line_source(state: GameState, player: int, node: int) -> bool:
    """``node`` may start a line: an own factory (DEC-42, item 1)."""
    n = state.nodes[node]
    return n.owner == player and n.factory == player


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


def _auto_extend(state: GameState, rules: Ruleset, player: int) -> list[Event]:
    """Copy the nearest own line to the cities ``player`` captured in this tick (module
    docstring, 2a)."""
    if not state.players[player].auto_lines:
        return []
    nodes, mapdef = state.nodes, state.map
    captured: dict[int, bool] = {}
    for e in state.events:  # the events of this tick so far: movement and combat capture
        node = e.get("node") if e.kind == "node_captured" else None
        if isinstance(node, int) and e.get("player") == player:
            captured[node] = True
    events: list[Event] = []
    reach = rules.line_rules().auto_extend_ticks
    edge_ticks = all_packet_ticks(state, rules) if captured else ()
    ps = state.players[player]
    for city in sorted(captured, key=lambda n: mapdef.node_key(player, n)):
        n = nodes[city]
        if n.owner != player or n.factory == player or not is_city(mapdef, city):
            continue
        best = _nearest_copy(state, rules, player, city, reach, edge_ticks)
        if best is None:
            continue
        line = Line(ps.next_line, best)
        ps.lines[line.id] = line
        ps.next_line += 1
        events.append(
            event(
                state.tick,
                "line_auto",
                player=player,
                line=line.id,
                from_node=line.source,
                to_node=line.target,
            )
        )
    return events


def _nearest_copy(
    state: GameState,
    rules: Ruleset,
    player: int,
    city: int,
    reach: int,
    edge_ticks: tuple[int, ...],
) -> tuple[int, ...] | None:
    """The path of the copy of the own line nearest to ``city`` (module docstring, 2a), or
    ``None`` when no own line comes within ``reach`` packet ticks."""
    mapdef = state.map
    edges = mapdef.edges
    lines = state.players[player].lines
    best: tuple[int, int, int, tuple[int, ...]] | None = None
    for k in sorted(lines):
        path = lines[k].path
        if not is_line_source(state, player, path[0]):
            continue  # only a factory starts a line (DEC-42, item 1)
        for i, node in enumerate(path):
            if node == city:
                cand = (0, mapdef.node_key(player, node), k, path[: i + 1])
            else:
                blocked = {n: True for n in path[:i]}

                def usable(eid: int, blocked: dict[int, bool] = blocked) -> bool:
                    return edges[eid].a not in blocked and edges[eid].b not in blocked

                route = transfer_route(state, rules, player, node, city, usable, edge_ticks)
                if route is None or route.total_ticks > reach:
                    continue  # no way, or the line does not come that near
                cand = (route.total_ticks, mapdef.node_key(player, node), k, path[:i] + route.nodes)
            if best is None or cand[:3] < best[:3]:
                best = cand
    return None if best is None else best[3]


# Dispatch --------------------------------------------------------------------------------------


def _dispatch(
    state: GameState, player: int, capacities: tuple[int, ...], edge_ticks: tuple[int, ...]
) -> list[Event]:
    """One dispatch of ``player``: every own factory with lines runs its round robin once
    (module docstring, step 5)."""
    lines = state.players[player].lines
    nodes = state.nodes
    out: dict[int, list[int]] = {}
    for k in sorted(lines):
        if is_line_source(state, player, lines[k].source):
            out.setdefault(lines[k].source, []).append(k)
    if not out:
        return []
    incoming: dict[int, int] = {}
    for pid in sorted(state.packets):
        packet = state.packets[pid]
        if packet.owner == player:
            dest = packet_dest(state, packet)
            incoming[dest] = incoming.get(dest, 0) + packet.charges

    def room(target: int) -> int:
        free = capacities[target] - nodes[target].warehouse - incoming.get(target, 0)
        return max(0, free)

    events: list[Event] = []
    for src in sorted(out, key=lambda n: state.map.node_key(player, n)):
        node = nodes[src]
        slots = out[src]
        start = node.rr % len(slots)
        node.rr = start
        for i in range(len(slots)):
            line = lines[slots[(start + i) % len(slots)]]
            if room(line.target) <= 0:
                continue  # L6: the target is full, the factory keeps the charge
            if node.warehouse == 0:
                node.rr = (start + i) % len(slots)  # this line gets the next charge
                break
            events.append(_send(state, player, node, line, edge_ticks))
            incoming[line.target] = incoming.get(line.target, 0) + 1
    return events


def _send(
    state: GameState, player: int, node: Node, line: Line, edge_ticks: tuple[int, ...]
) -> Event:
    """One charge of the factory ``node`` leaves along ``line`` as a packet (L1)."""
    edges = line_edges(state, line.path)
    assert edges is not None  # an own line always follows roads (validated, rerouted)
    node.warehouse -= 1
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
