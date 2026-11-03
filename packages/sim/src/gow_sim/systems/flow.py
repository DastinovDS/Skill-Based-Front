"""Automatic supply flow (DEC-43, #697; ``supply.model = "flow"``, economy v2 only).

The ``supply`` step of a flow match (``match.SYSTEMS`` runs it instead of ``systems.lines``);
mechanics.md, section 7, "Automatic supply flow, leaf shift, fixed warehouses, road
fortifications (DEC-43)", items A and B. Numbers come from ``Ruleset.supply`` and
``Ruleset.factory``; nothing below reads the other player's state except the public owners.

Terms, per player ``p`` and over **internal roads** (both ends ``p``'s):

- a **leaf** is an own node with a road to a node that is not ``p``'s (item A1);
- the field ``d0(n)``: roads from ``n`` to the nearest leaf, a BFS from all leaves; a component
  without a leaf has no field (``None``, INF; item A2);
- the **leaf level** ``k`` of a component: the player's shift (``PlayerState.leaf_shift``) for the
  component of the own capital, 0 for every other one (item A10); the shift is clamped first,
  ``k := min(k, d0(capital))``, and stays clamped (item B3);
- a node with ``d0(n) > k`` is **pulled** to the level when an own group stands in it short of a
  charge (``charged < units``, in a fight or not) or with a gathering planned order
  (``plan > 0``); groups on edges never pull (item A4). The effective field
  ``d(n) = min(d0(n), k + hops(n, nearest pulled node))``;
- the **room** of an own node: ``max(0, cap - stock - own packets on the way to it)``, a snapshot
  at the start of a dispatch that only decreases while it runs (item A5, the wave).

Order inside the step (item A13):

1. **Captured factories** pass to the capturer or are destroyed (``lines.settle_factories``,
   DEC-41 item 2).
2. **Packets** move and land (``supply.move_packets``).
3. **Recharge** of standing units (``supply.recharge``).
4. The **field**: ``d0``, the clamp of the shift, the pull, ``d``.
5. On a dispatch tick (``t > 0`` divisible by ``supply.dispatch_ticks``) the **dispatch** of item
   A6, per player: senders in ``(d, node_key)`` order, the front first; a node on or ahead of the
   level (``d <= k``) or without a field sends nothing; the others send one charge per road,
   first **downhill** (own neighbours with ``k <= d(m) < d(n)`` and room, by fill
   ``(cap - room) * 100 // cap`` then ``node_key``), then along **level roads** (``d(m) == d(n)``,
   room, the same order, only while ``load(m) + 2 <= have``, ``load = cap - room``). Each charge
   is a packet of 1 along one road (item A7).
6. The **plan** of the next dispatch for the view: the same function run on the state now, without
   sending (item E: ``flow_next`` and ``flow_idle``), stored in ``Node.flow`` with the field.

The full factory spills its new charge in ``systems.economy`` (item A8), reading ``Node.flow`` of
the previous tick (``spill_target``).

Cost per tick and player: O(V + E) for the field and the plan, O(packets) for the room, O(groups)
for the pull.
"""

from collections import deque
from dataclasses import dataclass

from gow_sim.ruleset import Ruleset
from gow_sim.state import AtNode, Event, FlowIdle, FlowNode, GameState, event
from gow_sim.systems.capacity import warehouse_capacities
from gow_sim.systems.lines import settle_factories
from gow_sim.systems.supply import (
    edge_packet_ticks,
    garrisons_by_node,
    move_packets,
    packet_dest,
    recharge,
    send_packet,
)

__all__ = ["next_dispatch_tick", "send_one", "spill_target", "supply_flow", "update_flow"]


def supply_flow(state: GameState, rules: Ruleset) -> list[Event]:
    """The supply step of the flow (see the module docstring)."""
    events: list[Event] = []
    settle_factories(state, rules)
    capacities = warehouse_capacities(state, rules)
    events.extend(move_packets(state, capacities))
    recharge(state, rules, garrisons_by_node(state))
    tick = state.tick
    dispatch = tick > 0 and tick % rules.supply.dispatch_ticks == 0
    for pid in sorted(state.players):
        field = _field(state, pid)
        incoming = _incoming(state, pid)
        if dispatch:
            sends = _run(state, field, capacities, incoming)
            events.extend(_send(state, rules, pid, sends, incoming))
        _store(state, field, capacities, incoming)
    _clear_neutral(state)
    return events


def update_flow(state: GameState, rules: Ruleset) -> None:
    """Steps 4 and 6 only: the field, the clamp and the plan, no dispatch and no events. The
    initial state carries the field this way (item A8)."""
    capacities = warehouse_capacities(state, rules)
    for pid in sorted(state.players):
        _store(state, _field(state, pid), capacities, _incoming(state, pid))
    _clear_neutral(state)


def next_dispatch_tick(state: GameState, rules: Ruleset) -> int:
    """The tick of the next dispatch after the current tick (``View.me.next_dispatch_tick``)."""
    period = rules.supply.dispatch_ticks
    return (state.tick // period + 1) * period  # non-negative: rounded down


# The field -----------------------------------------------------------------------------------


@dataclass(slots=True)
class _Field:
    """The field of one player (module docstring, step 4)."""

    player: int
    d: dict[int, int]
    """The effective field of the own nodes that have one."""
    k: dict[int, int]
    """The leaf level of every own node's component."""
    pocket: dict[int, bool]
    """Every own node: its component has no own factory."""
    adj: dict[int, list[tuple[int, int]]]
    """Every own node: ``(neighbour, road)`` over internal roads, by road id."""
    down: dict[int, list[tuple[int, int]]]
    """Every own node behind the level (``d > k``): its downhill neighbours of item A6
    (``k <= d(m) < d``) with the road, by road id, room not considered."""
    level: dict[int, list[tuple[int, int]]]
    """The same nodes: the neighbours on its level (``d(m) == d``)."""


def _field(state: GameState, player: int) -> _Field:
    """Item A2 to A4 and B3 for ``player``; stores the clamped shift and its maximum."""
    mapdef = state.map
    nodes = state.nodes
    edges = mapdef.edges
    adj: dict[int, list[tuple[int, int]]] = {}
    d0: dict[int, int] = {}
    queue: deque[int] = deque()
    incident = mapdef.incident
    owners = [nodes[nid].owner for nid in range(len(incident))]  # ids are 0..n-1 (``MapDef``)
    for nid, owner in enumerate(owners):  # ascending
        if owner != player:
            continue
        near: list[tuple[int, int]] = []
        leaf = False
        for eid in incident[nid]:
            e = edges[eid]
            other = e.b if e.a == nid else e.a
            if owners[other] == player:
                near.append((other, eid))
            else:
                leaf = True
        adj[nid] = near
        if leaf:
            d0[nid] = 0
            queue.append(nid)
    _bfs(adj, d0, queue)

    # Components over internal roads: the shift of the capital's one, pockets (items A10, B3).
    comp: dict[int, int] = {}
    has_factory: dict[int, bool] = {}
    for nid in adj:  # ascending: the component id is its smallest node
        if nid in comp:
            continue
        comp[nid] = nid
        factory = False
        stack = [nid]
        while stack:
            n = stack.pop()
            factory = factory or nodes[n].factory == player
            for m, _ in adj[n]:
                if m not in comp:
                    comp[m] = nid
                    stack.append(m)
        has_factory[nid] = factory
    ps = state.players[player]
    capital = mapdef.capital(player)
    shift_max = d0.get(capital, 0) if capital in adj else 0
    ps.leaf_shift_max = shift_max
    ps.leaf_shift = min(ps.leaf_shift, shift_max)  # the clamp is stored (item B3)
    main = comp.get(capital)
    shift = ps.leaf_shift
    k = {n: shift if c == main else 0 for n, c in comp.items()}
    pocket = {n: not has_factory[c] for n, c in comp.items()}

    # The pull (item A4): a multi-source BFS from the pulled nodes; d = min(d0, k + hops).
    pulled: dict[int, bool] = {}
    for g in state.groups.values():  # flags: the order does not matter
        loc = g.location
        if g.owner != player or not isinstance(loc, AtNode):
            continue
        n = loc.node
        if (g.charged < g.units or g.plan > 0) and n in d0 and d0[n] > k[n]:
            pulled[n] = True
    d = d0
    if pulled:
        hops: dict[int, int] = {}
        start: deque[int] = deque()
        for n in sorted(pulled):
            hops[n] = 0
            start.append(n)
        _bfs(adj, hops, start)
        d = dict(d0)
        for n, h in hops.items():
            if n in d:  # a pulled node and its component have a field
                d[n] = min(d[n], k[n] + h)
    down: dict[int, list[tuple[int, int]]] = {}
    level: dict[int, list[tuple[int, int]]] = {}
    for n, dn in d.items():
        kn = k[n]
        if dn <= kn:
            continue  # on or ahead of the level: it never sends
        below: list[tuple[int, int]] = []
        same: list[tuple[int, int]] = []
        for m, eid in adj[n]:
            dm = d.get(m)
            if dm is None:
                continue
            if dm < dn:
                if dm >= kn:
                    below.append((m, eid))
            elif dm == dn:
                same.append((m, eid))
        down[n] = below
        level[n] = same
    return _Field(player, d, k, pocket, adj, down, level)


def _bfs(adj: dict[int, list[tuple[int, int]]], dist: dict[int, int], queue: deque[int]) -> None:
    """Hops over ``adj`` from the nodes already in ``dist`` (all at their start values, in the
    queue in ascending value order)."""
    while queue:
        n = queue.popleft()
        step = dist[n] + 1
        for m, _ in adj[n]:
            if m not in dist:
                dist[m] = step
                queue.append(m)


# The dispatch and the plan ---------------------------------------------------------------------


def _incoming(state: GameState, player: int) -> dict[int, int]:
    """Charges of the own packets on the way to each node."""
    incoming: dict[int, int] = {}
    for p in state.packets.values():  # sums: the order does not matter
        if p.owner == player:
            dest = packet_dest(state, p)
            incoming[dest] = incoming.get(dest, 0) + p.charges
    return incoming


type _Sends = list[tuple[int, list[tuple[int, int]]]]
"""``(sender, [(receiver, road), ...])`` in the order the charges leave."""


def _run(
    state: GameState, field: _Field, capacities: tuple[int, ...], incoming: dict[int, int]
) -> _Sends:
    """One dispatch of item A6 on the state now, without sending. The dispatch sends what it
    returns; the plan only shows it."""
    player = field.player
    key = state.map.node_key
    nodes = state.nodes
    d = field.d
    # The senders: behind the level (the level keeps, ahead is frozen) and with stock.
    senders = [n for n in field.down if nodes[n].warehouse > 0]
    if not senders:
        return []
    senders.sort(key=lambda n: (d[n], key(player, n)))
    room: dict[int, int] = {}
    for n in field.adj:
        free = capacities[n] - nodes[n].warehouse - incoming.get(n, 0)
        room[n] = free if free > 0 else 0

    def order(m: int) -> tuple[int, int]:
        cap = capacities[m]  # room > 0, so cap > 0
        return ((cap - room[m]) * 100 // cap, key(player, m))  # non-negative: rounded down

    sends: _Sends = []
    for n in senders:
        have = nodes[n].warehouse
        down = [pair for pair in field.down[n] if room[pair[0]]]
        level = [pair for pair in field.level[n] if room[pair[0]]]
        out: list[tuple[int, int]] = []
        if len(down) > 1:
            down.sort(key=lambda pair: order(pair[0]))
        for m, eid in down:
            if have == 0:
                break
            out.append((m, eid))
            room[m] -= 1
            have -= 1
        if len(level) > 1:
            level.sort(key=lambda pair: order(pair[0]))
        for m, eid in level:
            if have == 0:
                break
            if capacities[m] - room[m] + 2 <= have:  # a gap of 1 never moves
                out.append((m, eid))
                room[m] -= 1
                have -= 1
        if out:
            sends.append((n, out))
    return sends


def _send(
    state: GameState, rules: Ruleset, player: int, sends: _Sends, incoming: dict[int, int]
) -> list[Event]:
    """The packets of a dispatch, in its order; ``incoming`` counts them."""
    events: list[Event] = []
    for n, out in sends:
        for m, eid in out:
            state.nodes[n].warehouse -= 1
            incoming[m] = incoming.get(m, 0) + 1
            ticks = edge_packet_ticks(state, rules, eid)
            events.append(send_one(state, player, n, m, eid, ticks))
    return events


def _store(
    state: GameState, field: _Field, capacities: tuple[int, ...], incoming: dict[int, int]
) -> None:
    """Step 6: the plan of the next dispatch and the field into ``Node.flow``. A node keeps its
    ``FlowNode`` when nothing of it changed (equal values: the same state)."""
    player = field.player
    key = state.map.node_key
    nodes = state.nodes
    d = field.d
    plan = dict(_run(state, field, capacities, incoming))
    for n in field.adj:
        dn = d.get(n)
        k = field.k[n]
        down: tuple[int, ...] = ()
        below_pairs = field.down.get(n)
        if below_pairs:
            below = [m for m, _ in below_pairs]
            if len(below) > 1:
                below.sort(key=lambda m: key(player, m))
            down = tuple(below)
        receivers = plan.get(n)
        idle: FlowIdle | None = None
        if receivers is None:
            if dn is None or dn == k:
                idle = FlowIdle.LEAF
            elif dn < k:
                idle = FlowIdle.AHEAD
            elif nodes[n].warehouse == 0:
                idle = FlowIdle.EMPTY
            else:
                idle = FlowIdle.FULL
        nxt = () if receivers is None else tuple(m for m, _ in receivers)
        pocket = field.pocket[n]
        old = nodes[n].flow
        if (
            old is not None
            and old.d == dn
            and old.k == k
            and old.pocket == pocket
            and old.down == down
            and old.next == nxt
            and old.idle is idle
        ):
            continue
        nodes[n].flow = FlowNode(d=dn, k=k, pocket=pocket, down=down, next=nxt, idle=idle)


def _clear_neutral(state: GameState) -> None:
    for node in state.nodes.values():  # independent writes: the order does not matter
        if node.owner is None:
            node.flow = None


# The spill of a full factory (item A8) ---------------------------------------------------------


def spill_target(state: GameState, rules: Ruleset, factory: int) -> tuple[int, int] | None:
    """``(neighbour, road)`` the full factory ``factory`` spills its new charge to: an own
    neighbour with room and ``d(m) >= k``, the smallest ``d(m)`` first, then ``node_key``, by the
    field stored by the flow step of the previous tick (item A8); ``None``: it burns."""
    mapdef = state.map
    nodes = state.nodes
    owner = nodes[factory].owner
    assert owner is not None
    here = nodes[factory].flow
    k = here.k if here is not None else 0
    capacities = warehouse_capacities(state, rules)
    incoming = _incoming(state, owner)
    best: tuple[tuple[int, int], int, int] | None = None
    for eid in mapdef.incident[factory]:
        m = mapdef.edges[eid].other(factory)
        node = nodes[m]
        f = node.flow
        if node.owner != owner or f is None or f.d is None or f.d < k:
            continue
        if capacities[m] - node.warehouse - incoming.get(m, 0) <= 0:
            continue
        cand = ((f.d, mapdef.node_key(owner, m)), m, eid)
        if best is None or cand[0] < best[0]:
            best = cand
    return None if best is None else (best[1], best[2])


def send_one(state: GameState, player: int, src: int, dst: int, eid: int, ticks: int) -> Event:
    """One charge of ``src`` leaves along the road ``eid`` to ``dst`` as a packet (item A7); the
    caller takes it from where it comes (the warehouse, or the production of item A8)."""
    packet = send_packet(state, player, src, (eid,), (ticks,), 1, transfer=False)
    return event(
        state.tick,
        "packet_sent",
        packet=packet.id,
        player=player,
        edge=eid,
        from_node=src,
        to_node=dst,
        charges=1,
    )
