"""Automatic supply flow (DEC-43, #697; ``supply.model = "flow"``, economy v2 only).

The ``supply`` step of a flow match (``match.SYSTEMS`` runs it instead of ``systems.lines``);
mechanics.md, section 7, "Automatic supply flow, leaf shift, fixed warehouses, road
fortifications (DEC-43)", items A and B. Numbers come from ``Ruleset.supply`` and
``Ruleset.factory``; nothing below reads the other player's state except the public owners.

Terms, per player ``p`` and over **internal roads** (both ends ``p``'s):

- a **leaf** is an own node with a road to an **enemy** node; a neutral node never makes one
  (item A1 as revised by #724). An own component with no such node takes as its leaves: the
  capital's component its nodes farthest from the capital (hops over internal roads, all ties),
  a pocket all its nodes;
- the field ``d0(n)``: roads from ``n`` to the nearest leaf of its component, a BFS from all
  leaves (item A2); every own node has one;
- the **leaf level** ``k`` of a component: the player's shift (``PlayerState.leaf_shift``) for the
  component of the own capital, 0 for every other one (item A10); the shift is clamped first,
  ``k := min(k, d0(capital))``, and stays clamped (item B3);
- a **pocket** is an own component that does not contain the own capital (item H1); its
  factories stop (``systems.economy``, item H2) and, without an own factory, its nodes starve
  (item H4);
- a node with ``d0(n) > k`` is **pulled** to the level when an own group stands in it short of a
  charge (``charged < units``, in a fight or not) or with a gathering planned order
  (``plan > 0``); groups on edges never pull (item A4). The effective field
  ``d(n) = min(d0(n), k + hops(n, nearest pulled node))``; such an army ahead of the level
  (``d0(n) < k``) pulls too: its node and its **path** are lifted onto the level, ``d = k``
  (items I6, #724, and I7, #726). The path: ``h(n)``, the hops from a node ahead to the nearest
  node not ahead (a BFS), and from the army's node each next node is the own neighbour with ``h``
  one less, the smallest ``node_key`` first, until ``h == 0`` (the level end). A lifted node
  between gives only to its next nodes towards the armies, on room alone;
- an **unpaid build** pulls exactly like such an army (item J, #729): a node with an own build
  paid in charges that still owes some (``owed > 0``: the barracks, a warehouse level, a factory,
  a bunker; ``Node.build``, ``Node.factory_build``, ``Node.fort_build``). Without a pulling army
  in it, a dispatch sends it at most its **want**, ``owed - stock - own packets on the way to
  it`` (the fill order still reads its warehouse room);
- the **room** of an own node: ``max(0, cap - stock - own packets on the way to it)``, a snapshot
  at the start of a dispatch that only decreases while it runs (item A5, the wave);
- the **capital distance** ``c(n)`` (item L1, #735): hops from the own capital over internal
  roads, for the capital's component only;
- **the nearest need** (item M, #738), the dispatch of the capital's component: every own node not
  ahead of the level with room (a build node alone: while it still wants a charge) **calls** the
  nearest stock **farther from the front** (a larger ``d``; a node that holds also calls the
  level), the front first; a charge moves one road per dispatch along its **way**, which never
  passes a node nearer the front than the caller, never a node that holds, and moves on the level
  only away from the capital (item L); a full node at the caller's ``d`` on the way passes one of
  its own on (a **relay**). What the level has left evens out along the capital distance (item
  L2). A pocket keeps the rules of items A6, I3 and K (the **feed distance**: 0 for a hungry level
  node, a BFS backwards over the roads a node behind the level sends along).

Order inside the step (item A13):

1. **Captured factories** pass to the capturer or are destroyed (``lines.settle_factories``,
   DEC-41 item 2).
1b. **Starvation** of the factory-less pockets (item H4, ``starve_pockets``): the per-node timer
   ``Node.cut_since`` and the DEC-19 consumption (``capacity.consume``) on every node of such a
   pocket, provinces included.
2. **Packets** move and land (``supply.move_packets``).
3. **Recharge** of standing units (``supply.recharge``).
4. The **field**: ``d0``, the clamp of the shift, the pull, ``d``.
5. On a dispatch tick (``t > 0`` divisible by ``supply.dispatch_ticks``) the **dispatch**, per
   player. The capital's component: the nearest need of item M (``_call``). A pocket: item A6,
   senders in ``(d, node_key)`` order, the front first; a node ahead of the level (``d < k``)
   sends nothing; the others send one charge per road, first **downhill** (own neighbours with
   ``k <= d(m) < d(n)`` and room, by fill ``(cap - room) * 100 // cap`` then ``node_key``), then
   along **level roads** (``d(m) == d(n)``, room, the same order): behind the level by the feed
   distance (item K), on the level by the gap rule ``load(m) + 2 <= have`` (item I3); a level node
   that holds keeps, and its level neighbours give to it on room alone. Each charge is a packet of
   1 along one road (item A7).
6. The **plan** of the next dispatch for the view: the same function run on the state now, without
   sending (item E: ``flow_next`` and ``flow_idle``), stored in ``Node.flow`` with the field.

The full factory spills its new charge in ``systems.economy`` (items A8 and M8): one packet to the
nearest own node with room, reading ``Node.flow`` of the previous tick (``spill_way``).

Cost per tick and player: O(V + E) for the field and the capital distance, O(packets) for the
room, O(groups) and O(V) (the builds) for the pull and the paths; the calls of item M are one
bounded BFS per caller and tier (a caller stops when it is covered or no stock is left).
"""

from collections import deque
from dataclasses import dataclass

from gow_sim.ruleset import Ruleset
from gow_sim.state import AtNode, Event, FlowIdle, FlowNode, GameState, Group, Node, event
from gow_sim.systems.capacity import consume, is_starvation_tick, warehouse_capacities
from gow_sim.systems.lines import settle_factories
from gow_sim.systems.supply import (
    edge_packet_ticks,
    garrisons_by_node,
    move_packets,
    packet_dest,
    recharge,
    send_packet,
)

__all__ = [
    "next_dispatch_tick",
    "send_one",
    "send_way",
    "spill_way",
    "starve_pockets",
    "supply_flow",
    "update_flow",
]


def supply_flow(state: GameState, rules: Ruleset) -> list[Event]:
    """The supply step of the flow (see the module docstring)."""
    events: list[Event] = []
    settle_factories(state, rules)
    garrisons = garrisons_by_node(state)
    events.extend(starve_pockets(state, rules, garrisons))
    capacities = warehouse_capacities(state, rules)
    events.extend(move_packets(state, capacities))
    recharge(state, rules, garrisons)
    tick = state.tick
    dispatch = tick > 0 and tick % rules.supply.dispatch_ticks == 0
    for pid in sorted(state.players):
        incoming = _incoming(state, pid)
        field = _field(state, pid)
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


# Pockets and starvation (item H) --------------------------------------------------------------


def starving_nodes(state: GameState, player: int) -> list[int]:
    """The own nodes of ``player`` in a factory-less pocket (items H1, H3, H4), ascending: their
    own component over own nodes does not contain the own capital and has no node with
    ``Node.factory == player``. O(V + E)."""
    mapdef = state.map
    nodes = state.nodes
    incident = mapdef.incident
    edges = mapdef.edges
    capital = mapdef.capital(player)
    seen: dict[int, bool] = {}
    result: list[int] = []
    for nid in range(len(incident)):  # ascending; ids are 0..n-1 (``MapDef``)
        if nid in seen or nodes[nid].owner != player:
            continue
        seen[nid] = True
        members = [nid]
        safe = False
        head = 0
        while head < len(members):
            n = members[head]
            head += 1
            safe = safe or n == capital or nodes[n].factory == player
            for eid in incident[n]:
                e = edges[eid]
                m = e.b if e.a == n else e.a
                if m not in seen and nodes[m].owner == player:
                    seen[m] = True
                    members.append(m)
        if not safe:
            result.extend(members)
    result.sort()
    return result


def starve_pockets(
    state: GameState, rules: Ruleset, garrisons: dict[int, list[Group]]
) -> list[Event]:
    """Step 1b (item H4): ``cut_since`` of every node and the DEC-19 consumption of the nodes of
    factory-less pockets, provinces included. ``garrisons``: ``supply.garrisons_by_node``."""
    starving: dict[int, bool] = {}
    for pid in sorted(state.players):
        for n in starving_nodes(state, pid):
            starving[n] = True
    events: list[Event] = []
    tick = state.tick
    for nid in sorted(state.nodes):
        node = state.nodes[nid]
        if nid not in starving:
            node.cut_since = None  # connected to the capital, a factory, or not own (item H5)
            continue
        if node.cut_since is None:
            node.cut_since = tick
        if is_starvation_tick(state, rules, node.cut_since):
            starved = consume(state, rules, nid, garrisons.get(nid, ()))
            if starved is not None:
                events.append(starved)
    return events


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
    """Every own node: its component does not contain the own capital (item H1)."""
    adj: dict[int, list[tuple[int, int]]]
    """Every own node: ``(neighbour, road)`` over internal roads, by road id."""
    down: dict[int, list[tuple[int, int]]]
    """Every own node that may send: behind the level (``d > k``), or on it (``d == k``) with no
    own standing group short of a charge or gathering a plan and no unpaid build. For a node of a
    pocket its downhill neighbours of item A6 (``k <= d(m) < d``; none on the level) with the
    road, by road id, room not considered; empty for the capital's component (item M)."""
    level: dict[int, list[tuple[int, int]]]
    """The same nodes of a pocket: the neighbours on its level (``d(m) == d``): level roads behind
    the level, the equalization of the leaves on it (#724); empty for the capital's component."""
    holding: dict[int, bool]
    """The own nodes where an own standing group is short of a charge or gathers a plan (the
    groups that pull), or with an unpaid build (item J): on the level they keep, and a level
    neighbour gives to them without the gap (item I3)."""
    before: dict[int, int]
    """The lifted nodes of the paths (item I7): the node before each on its path, towards the
    level; it gives to it on room alone."""
    owed: dict[int, int]
    """The own nodes that pull for an unpaid build alone (no pulling army there, item J): the
    charges their own builds still owe; a dispatch sends them at most ``owed - stock -
    incoming``."""
    flat: list[int]
    """The own nodes of the pockets on the level (``d == k``): the candidates for a hungry level
    node of item K."""
    c: dict[int, int]
    """The nodes of the own capital's component: hops from the capital over internal roads (item
    L1, the BFS of item I2); pockets have none."""


def _field(state: GameState, player: int) -> _Field:
    """Items A1 to A4 (as revised by #724) and B3 for ``player``; stores the clamped shift and its
    maximum."""
    mapdef = state.map
    nodes = state.nodes
    edges = mapdef.edges
    adj: dict[int, list[tuple[int, int]]] = {}
    contact: dict[int, bool] = {}
    incident = mapdef.incident
    owners = [nodes[nid].owner for nid in range(len(incident))]  # ids are 0..n-1 (``MapDef``)
    for nid, owner in enumerate(owners):  # ascending
        if owner != player:
            continue
        near: list[tuple[int, int]] = []
        for eid in incident[nid]:
            e = edges[eid]
            other = e.b if e.a == nid else e.a
            if owners[other] == player:
                near.append((other, eid))
            elif owners[other] is not None:
                contact[nid] = True  # a road to an enemy node; a neutral one never (item A1)
        adj[nid] = near

    # The capital's component by the BFS of the capital distance (``hops``, item L1; also the
    # farthest leaves of item I2), then the other components, the pockets (items A10, B3, H1).
    capital = mapdef.capital(player)
    hops: dict[int, int] = {}
    if capital in adj:
        hops[capital] = 0
        _bfs(adj, hops, deque([capital]))
    pockets: list[list[int]] = []
    seen: dict[int, bool] = {}
    for nid in adj:  # ascending
        if nid in hops or nid in seen:
            continue
        seen[nid] = True
        group = [nid]
        for n in group:  # grows while it is walked: a BFS
            for m, _ in adj[n]:
                if m not in seen:
                    seen[m] = True
                    group.append(m)
        pockets.append(group)

    # The leaves of every component (items A1, A2): its nodes on a road to an enemy node; with
    # none, the capital's component takes its nodes farthest from the capital, a pocket all its
    # nodes. Then ``d0`` by one BFS from all leaves.
    d0: dict[int, int] = {}
    leaves: list[int] = []
    if hops:
        touching = [n for n in hops if n in contact]
        if touching:
            leaves.extend(touching)
        else:
            far = max(hops.values())
            leaves.extend(n for n, h in hops.items() if h == far)
    for group in pockets:
        touching = [n for n in group if n in contact]
        leaves.extend(touching if touching else group)
    leaves.sort()
    for n in leaves:
        d0[n] = 0
    _bfs(adj, d0, deque(leaves))

    ps = state.players[player]
    shift_max = d0.get(capital, 0) if capital in adj else 0
    ps.leaf_shift_max = shift_max
    ps.leaf_shift = min(ps.leaf_shift, shift_max)  # the clamp is stored (item B3)
    shift = ps.leaf_shift
    k = {n: shift if n in hops else 0 for n in adj}
    pocket = {n: n not in hops for n in adj}  # no own capital: all pockets

    # The pull (item A4): a multi-source BFS from the pulled nodes behind the level; d = min(d0,
    # k + hops). A pulling army ahead of the level puts its node and its path on the level,
    # d = k (items I6, I7). The same groups make a node on the level keep what it has and take
    # from its level neighbours without the gap (item I3).
    pulled: dict[int, bool] = {}
    lifted: dict[int, bool] = {}
    holding: dict[int, bool] = {}
    for g in state.groups.values():  # flags: the order does not matter
        loc = g.location
        if g.owner != player or not isinstance(loc, AtNode):
            continue
        n = loc.node
        if (g.charged < g.units or g.plan > 0) and n in d0:
            holding[n] = True
    # An unpaid build pulls like such an army (item J): its node joins the same set; without an
    # army there its intake is capped by what it still owes (``_run``).
    owed: dict[int, int] = {}
    for n in adj:  # ascending
        if n not in holding:
            due = _owed(nodes[n], player)
            if due > 0:
                owed[n] = due
                holding[n] = True
    for n in holding:  # flags: the order does not matter
        if d0[n] > k[n]:
            pulled[n] = True
        elif d0[n] < k[n]:
            lifted[n] = True
    d = d0
    if pulled:
        dist: dict[int, int] = {}
        start: deque[int] = deque()
        for n in sorted(pulled):
            dist[n] = 0
            start.append(n)
        _bfs(adj, dist, start)
        d = dict(d0)
        for n, h in dist.items():
            if n in d:  # a pulled node and its component have a field
                d[n] = min(d[n], k[n] + h)
    before: dict[int, int] = {}
    if lifted:
        if d is d0:
            d = dict(d0)
        # rise: hops to the nearest node not ahead of the level (only the capital's component has
        # k > 0, so only its nodes can be ahead); the BFS expands into the nodes ahead only.
        rise: dict[int, int] = {}
        for n in adj:  # ascending
            if d0[n] >= k[n]:
                rise[n] = 0
        _bfs(adj, rise, deque(rise))
        key = mapdef.node_key
        for a in sorted(lifted):
            n = a
            while rise[n] > 0 and n not in before:  # a shared rest of the way is walked once
                d[n] = k[n]
                want = rise[n] - 1
                best: tuple[int, int, int] | None = None
                for m, eid in adj[n]:
                    if rise[m] == want:
                        cand = (key(player, m), m, eid)
                        if best is None or cand < best:
                            best = cand
                assert best is not None  # rise is a BFS distance: a neighbour one less exists
                _, m, eid = best
                before[n] = m
                n = m
    down: dict[int, list[tuple[int, int]]] = {}
    level: dict[int, list[tuple[int, int]]] = {}
    flat: list[int] = []
    for n, dn in d.items():
        kn = k[n]
        if dn < kn or (dn == kn and n in holding):
            continue  # ahead of the level, or a level node that holds: it never sends
        if n in hops:  # the capital's component: the calls of item M (``_call``)
            down[n] = []
            level[n] = []
            continue
        if dn == kn:
            flat.append(n)
        below: list[tuple[int, int]] = []
        same: list[tuple[int, int]] = []
        for m, eid in adj[n]:
            dm = d[m]  # every own node has a field (item I2)
            if dm < dn:
                if dm >= kn:
                    below.append((m, eid))
            elif dm == dn:
                same.append((m, eid))
        down[n] = below
        level[n] = same
    for n in holding:  # a pocket's node that holds is a hungry level node too (item K1)
        if n not in hops and d[n] == k[n]:
            flat.append(n)
    return _Field(player, d, k, pocket, adj, down, level, holding, before, owed, flat, hops)


def _owed(node: Node, player: int) -> int:
    """The charges the builds of ``player`` in ``node`` still owe (DEC-41, item 7): the barracks
    or a warehouse level, a factory, a bunker. Road levels and road fortifications cost CP."""
    due = 0
    b = node.build
    if b is not None and b.owner == player:
        due += b.owed
    f = node.factory_build
    if f is not None and f.owner == player:
        due += f.owed
    f = node.fort_build
    if f is not None and f.owner == player:
        due += f.owed
    return due


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
    state: GameState,
    field: _Field,
    capacities: tuple[int, ...],
    incoming: dict[int, int],
    ways: dict[int, list[int]] | None = None,
) -> _Sends:
    """One dispatch on the state now, without sending: the calls of item M in the capital's
    component, item A6 in the pockets. The dispatch sends what it returns; the plan only shows it
    (``ways``: the next nodes of every node's called charges, item M9)."""
    player = field.player
    key = state.map.node_key
    nodes = state.nodes
    d = field.d
    # The senders: not ahead of the level, not holding, with stock.
    senders = [n for n in field.down if nodes[n].warehouse > 0]
    if not senders:
        return []
    senders.sort(key=lambda n: (d[n], key(player, n)))
    room, want = _snapshot(state, field, capacities, incoming)
    c = field.c
    main = [n for n in senders if n in c]
    sends = _call(state, field, capacities, main, room, want, incoming, ways) if main else []
    rest = [n for n in senders if n not in c]
    if rest:
        sends.extend(_pocket(state, field, capacities, rest, room, want))
    return sends


def _pocket(
    state: GameState,
    field: _Field,
    capacities: tuple[int, ...],
    senders: list[int],
    room: dict[int, int],
    want: dict[int, int],
) -> _Sends:
    """The dispatch of the pockets (``k = 0``): item A6, the level roads behind the level by the
    feed distance of item K, the level by the gap rule of item I3 (a node that holds takes on room
    alone)."""
    player = field.player
    key = state.map.node_key
    nodes = state.nodes
    d = field.d
    k = field.k

    def order(m: int) -> tuple[int, int]:
        cap = capacities[m]  # room > 0, so cap > 0
        return ((cap - room[m]) * 100 // cap, key(player, m))  # non-negative: rounded down

    # The feed distance of item K (the saddle), when a sender behind the level has a level road.
    feed: dict[int, int] | None = None
    for n in senders:
        if d[n] > k[n] and any(room[m] for m, _ in field.level[n]):
            feed = _feed(field, room, want)
            break
    far = len(field.adj) + 1  # above every feed distance: "feeds no hungry level node"
    sends: _Sends = []
    for n in senders:
        have = nodes[n].warehouse
        behind = d[n] > k[n]
        fn = feed.get(n, far) if feed is not None else far
        down = [p for p in field.down[n] if room[p[0]] and want.get(p[0], 1)]
        level = [p for p in field.level[n] if room[p[0]] and want.get(p[0], 1)]
        out: list[tuple[int, int]] = []
        if len(down) > 1:
            down.sort(key=lambda pair: order(pair[0]))
        for m, eid in down:
            if have == 0:
                break
            out.append((m, eid))
            room[m] -= 1
            if m in want:
                want[m] -= 1
            have -= 1
        if len(level) > 1:
            level.sort(key=lambda pair: order(pair[0]))
        for m, eid in level:
            if have == 0:
                break
            load = capacities[m] - room[m]
            if behind:
                if feed is not None:
                    # behind the level (item K): towards a hungry level node on room alone, the
                    # gap rule between equal feed distances, nothing away from a hungry level node
                    fm = feed.get(m, far)
                    give = fm < fn or (fm == fn and load + 2 <= have)
                else:
                    give = load + 2 <= have  # a gap of 1 never moves
            elif m in field.holding:
                give = True  # a pulling army takes without the gap (item I3)
            else:
                give = load + 2 <= have  # the gap rule of item I3
            if give:
                out.append((m, eid))
                room[m] -= 1
                if m in want:
                    want[m] -= 1
                have -= 1
        if out:
            sends.append((n, out))
    return sends


def _call(
    state: GameState,
    field: _Field,
    capacities: tuple[int, ...],
    senders: list[int],
    room: dict[int, int],
    want: dict[int, int],
    incoming: dict[int, int],
    ways: dict[int, list[int]] | None,
) -> _Sends:
    """The nearest need (item M) in the capital's component, at the room snapshot of item A5.

    **Callers**: own nodes not ahead of the level with room (a node that pulls for a build alone:
    while it still wants a charge, item J5); a caller takes at most its room (its want). They call
    by **tiers**: ``d`` ascending (the front first), in a tier the nodes that hold first, then the
    others; in a tier by fill, then ``node_key``. **Stock**: the warehouse and the own packets on
    the way of every own node not ahead of the level that does not hold. A caller is answered by
    stock **farther from the front** (a larger ``d``); a caller that holds also by the level when
    every road of the way goes away from the capital. **Ways**: BFS from each caller, all callers
    of a tier one layer at a time, the nodes of a layer by ``node_key``; a way never passes a node
    ahead of the level, a node that holds, a node nearer the front than the caller, another caller
    of the tier (it stops the charge), a lifted node between but along its path (item I7); it moves
    on the level and from the level behind it only away from the capital (``c`` grows, item L), but
    the last road into a caller that holds. A node answers the nearest caller first, with its
    packets on the way and at most one warehouse charge per road of its way; a covered caller
    reaches no farther.

    **Sends**, the senders in ``(d, node_key)`` order: each called charge goes one road along its
    way, to the next node with room by fill, then ``node_key``; when every next node is full, a
    full next node at the caller's ``d`` passes one of its own on (a **relay**, recursively). Then a
    level node evens out with what it has left along level roads to the nodes that do not hold
    (item L2: away from the capital ``load(m) + 1 <= have``, at an equal ``c`` ``load(m) + 2 <=
    have``, never towards the capital). At most one charge per road and direction."""
    player = field.player
    key = state.map.node_key
    nodes = state.nodes
    d = field.d
    k = field.k
    c = field.c
    adj = field.adj
    holding = field.holding
    before = field.before

    def order(m: int) -> tuple[int, int]:
        cap = capacities[m]  # room > 0, so cap > 0
        return ((cap - room[m]) * 100 // cap, key(player, m))  # non-negative: rounded down

    stock: dict[int, int] = {}
    moving: dict[int, int] = {}
    for n in c:  # independent entries: the order does not matter
        if d[n] < k[n] or n in holding:
            continue
        on_way = incoming.get(n, 0)
        total = nodes[n].warehouse + on_way
        if total:
            stock[n] = total
            moving[n] = on_way
    callers = [t for t in c if d[t] >= k[t] and room[t] and want.get(t, 1)]
    tiers: dict[tuple[int, int], list[int]] = {}
    for t in callers:
        tiers.setdefault((d[t], 0 if t in holding else 1), []).append(t)
    need = {t: min(room[t], want[t]) if t in want else room[t] for t in callers}
    dist: dict[int, dict[int, int]] = {}
    called: dict[int, list[list[int]]] = {}  # node -> [[caller, warehouse charges], ...]
    left = sum(stock.values())
    for tier_key in sorted(tiers):
        if not left:
            break
        j, sub = tier_key
        holds = sub == 0
        if not any(v and (d[n] > j or (holds and d[n] == j)) for n, v in stock.items()):
            continue  # no stock this tier can call
        tier = tiers[tier_key]
        tier.sort(key=order)
        front: dict[int, list[int]] = {}
        outward: dict[int, dict[int, bool]] = {}
        for t in tier:
            dist[t] = {t: 0}
            front[t] = [t]
            outward[t] = {t: True}
        while True:
            live = [t for t in tier if need[t] and front[t]]
            if not live:
                break
            for t in live:
                dt = dist[t]
                ot = outward[t]
                layer: list[int] = []
                for m in front[t]:
                    step = dt[m] + 1
                    for n, _ in adj[m]:  # the charge would go n -> m
                        if n in dt or d[n] < j or d[n] < k[n] or n in holding:
                            continue
                        if not holds and need.get(n) and d[n] == j:
                            continue  # another caller of the tier: it would keep the charge
                        if n in before and before.get(m) != n:
                            continue  # a lifted node between: only along its path
                        if d[n] == k[n] and c[m] <= c[n] and not (holds and m == t):
                            continue  # the level passes on only away from the capital
                        dt[n] = step
                        if holds:
                            ot[n] = m == t or (ot[m] and c[m] > c[n])
                        layer.append(n)
                if len(layer) > 1:
                    layer.sort(key=lambda n: key(player, n))
                front[t] = layer
            covered = True
            for t in live:
                dt = dist[t]
                ot = outward[t]
                for n in front[t]:
                    if not need[t]:
                        break
                    v = stock.get(n, 0)
                    if not v or not (d[n] > j or (holds and ot[n])):
                        continue
                    dn = dt[n] - 1
                    roads = 0
                    for m, _ in adj[n]:
                        if dt.get(m, -1) == dn and (n not in before or before.get(m) == n):
                            roads += 1
                    on_way = moving[n]
                    a_way = on_way if on_way < need[t] else need[t]
                    a_wh = min(v - on_way, roads, need[t] - a_way)
                    if not a_way + a_wh:
                        continue
                    stock[n] = v - a_way - a_wh
                    moving[n] = on_way - a_way
                    need[t] -= a_way + a_wh
                    left -= a_way + a_wh
                    if a_wh:
                        called.setdefault(n, []).append([t, a_wh])
                if need[t]:
                    covered = False
            if covered or not left:
                break

    have: dict[int, int] = {}
    out: dict[int, list[tuple[int, int]]] = {}
    used: dict[tuple[int, int], bool] = {}

    def give(n: int, m: int, eid: int) -> None:
        out.setdefault(n, []).append((m, eid))
        used[(n, eid)] = True
        room[m] -= 1
        if m in want:
            want[m] -= 1
        have[n] -= 1
        if ways is not None:
            ways.setdefault(n, []).append(m)

    def nearer(n: int, dt: dict[int, int]) -> list[tuple[int, int]]:
        """The next nodes of ``n`` on its ways to the caller of ``dt``, by fill then node_key."""
        dn = dt[n] - 1
        nxt = [
            (m, eid)
            for m, eid in adj[n]
            if dt.get(m, -1) == dn and (n not in before or before.get(m) == n)
        ]
        if len(nxt) > 1:
            nxt.sort(key=lambda pair: order(pair[0]))
        return nxt

    def relay(m: int, t: int) -> bool:
        """The full node ``m`` at the caller's ``d`` passes one of its own on towards ``t`` (each
        step one road nearer ``t``, so it ends)."""
        if m == t or m in holding or d[m] != d[t]:
            return False
        if have.setdefault(m, nodes[m].warehouse) == 0:
            return False
        nxt = [pair for pair in nearer(m, dist[t]) if (m, pair[1]) not in used]
        for x, eid in nxt:
            if room[x] and want.get(x, 1):
                give(m, x, eid)
                return True
        return any(relay(x, t) for x, _ in nxt)

    for n in senders:
        have.setdefault(n, nodes[n].warehouse)
        for t, a in called.get(n, ()):
            blocked: list[int] = []
            for m, eid in nearer(n, dist[t]):
                if ways is not None:
                    ways.setdefault(n, []).append(m)
                if a == 0 or have[n] == 0 or (n, eid) in used:
                    continue
                if room[m] and want.get(m, 1):
                    give(n, m, eid)
                    a -= 1
                else:
                    blocked.append(m)
            if a:
                for m in blocked:
                    if relay(m, t):
                        break
        if d[n] == k[n] and n not in before and have[n]:
            # the level evens out with what is left, away from the capital (item L2)
            cn = c[n]
            even = [
                (m, eid)
                for m, eid in adj[n]
                if d[m] == k[m]
                and m not in holding
                and m not in before
                and room[m]
                and c[m] >= cn
                and (n, eid) not in used
            ]
            if len(even) > 1:
                even.sort(key=lambda pair: order(pair[0]))
            for m, eid in even:
                if have[n] == 0:
                    break
                load = capacities[m] - room[m]
                if load + 1 <= have[n] if c[m] > cn else load + 2 <= have[n]:
                    give(n, m, eid)
    sends: _Sends = []
    for n in senders:
        if n in out:
            sends.append((n, out.pop(n)))
    for n in sorted(out, key=lambda n: (d[n], key(player, n))):  # relays of nodes not sending
        sends.append((n, out[n]))
    return sends


def _snapshot(
    state: GameState, field: _Field, capacities: tuple[int, ...], incoming: dict[int, int]
) -> tuple[dict[int, int], dict[int, int]]:
    """The room of every own node at the start of a dispatch (item A5) and the want of the nodes
    that pull for a build alone (item J): what they still owe beyond their stock and their
    packets on the way; they take no more than that (their fill stays the warehouse's)."""
    nodes = state.nodes
    room: dict[int, int] = {}
    for n in field.adj:
        free = capacities[n] - nodes[n].warehouse - incoming.get(n, 0)
        room[n] = free if free > 0 else 0
    want: dict[int, int] = {}
    for n, due in field.owed.items():
        rest = due - nodes[n].warehouse - incoming.get(n, 0)
        want[n] = rest if rest > 0 else 0
    return room, want


def _feed(field: _Field, room: dict[int, int], want: dict[int, int]) -> dict[int, int]:
    """The feed distance of item K at the room snapshot of a dispatch: 0 for a **hungry** level
    node (``d == k``, ``room > 0``, and a build node without an army still wants a charge, item
    J), then a BFS backwards over the roads a node behind the level sends along: ``feed(n) = 1 +
    min(feed(m))`` over its downhill and level neighbours ``m`` (``down`` and ``level`` of the
    field). A node missing from the result feeds no hungry level node. A BFS distance: the order
    of the queue does not change it. Pockets only (item M). O(V + E)."""
    d = field.d
    k = field.k
    adj = field.adj
    queue = [n for n in field.flat if room[n] and want.get(n, 1)]
    feed = dict.fromkeys(queue, 0)
    for m in queue:  # the list grows while it is walked: a BFS in queue order
        dm = d[m]
        step = feed[m] + 1
        for n, _ in adj[m]:
            # n sends to m: n is behind the level, m downhill of it or on its level (the nodes of
            # one component share k, and every own node has a field)
            if n not in feed and d[n] >= dm and d[n] > k[n]:
                feed[n] = step
                queue.append(n)
    return feed


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
    ways: dict[int, list[int]] = {}
    plan = dict(_run(state, field, capacities, incoming, ways))
    for n in field.adj:
        dn = d.get(n)
        k = field.k[n]
        down: tuple[int, ...] = ()
        if n in field.c:
            # the chevrons of the capital's component: the next nodes of its called charges and
            # of its evening at the plan (item M9)
            nxt_ways = ways.get(n)
            if nxt_ways:
                down = tuple(sorted(dict.fromkeys(nxt_ways), key=lambda m: key(player, m)))
        else:
            below = [m for m, _ in field.down.get(n, ())]
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


# The spill of a full factory (items A8 and M8) ------------------------------------------------


def spill_way(
    state: GameState, rules: Ruleset, factory: int
) -> tuple[int, tuple[int, ...]] | None:
    """``(receiver, roads)`` of the spill of the full factory ``factory`` (items A8 and M8): the
    nearest own node with room (the fewest roads), over own nodes with ``d(m) >= k`` by the field
    stored by the flow step of the previous tick; among the equally near the smallest ``d(m)``,
    then ``node_key``; the way is the one a BFS finds first with the neighbours of every node in
    ``node_key`` order. ``None``: it burns. A neighbour with room is the receiver of item A8."""
    mapdef = state.map
    nodes = state.nodes
    owner = nodes[factory].owner
    assert owner is not None
    here = nodes[factory].flow
    k = here.k if here is not None else 0
    capacities = warehouse_capacities(state, rules)
    incoming = _incoming(state, owner)
    key = mapdef.node_key
    parent: dict[int, tuple[int, int]] = {factory: (factory, -1)}
    layer = [factory]
    while layer:
        nxt: list[int] = []
        best: tuple[tuple[int, int], int] | None = None
        for n in layer:
            near: list[tuple[int, int, int]] = []
            for eid in mapdef.incident[n]:
                m = mapdef.edges[eid].other(n)
                node = nodes[m]
                f = node.flow
                if m in parent or node.owner != owner or f is None or f.d is None or f.d < k:
                    continue
                near.append((key(owner, m), m, eid))
            near.sort()
            for _, m, eid in near:
                if m in parent:
                    continue  # reached from an earlier node of the layer
                parent[m] = (n, eid)
                nxt.append(m)
                if capacities[m] - nodes[m].warehouse - incoming.get(m, 0) > 0:
                    f = nodes[m].flow
                    assert f is not None and f.d is not None
                    cand = ((f.d, key(owner, m)), m)
                    if best is None or cand[0] < best[0]:
                        best = cand
        if best is not None:
            dest = best[1]
            roads: list[int] = []
            n = dest
            while n != factory:
                n, eid = parent[n]
                roads.append(eid)
            roads.reverse()
            return dest, tuple(roads)
        layer = nxt
    return None


def send_way(
    state: GameState, rules: Ruleset, player: int, src: int, dst: int, roads: tuple[int, ...]
) -> Event:
    """One charge of ``src`` leaves along ``roads`` to ``dst`` as one packet (item M8); the caller
    takes it from where it comes (the production of item A8)."""
    ticks = tuple(edge_packet_ticks(state, rules, eid) for eid in roads)
    packet = send_packet(state, player, src, roads, ticks, 1, transfer=False)
    return event(
        state.tick,
        "packet_sent",
        packet=packet.id,
        player=player,
        edge=roads[0],
        from_node=src,
        to_node=dst,
        charges=1,
    )


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
