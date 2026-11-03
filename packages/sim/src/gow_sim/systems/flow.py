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
- the **feed distance** (item K, #732): 0 for a **hungry** level node (``d == k``, room at the
  snapshot, and a build node without an army still wants a charge), then a BFS backwards over the
  roads a node behind the level sends along (downhill and level roads); a node without one feeds
  no hungry level node.

Order inside the step (item A13):

1. **Captured factories** pass to the capturer or are destroyed (``lines.settle_factories``,
   DEC-41 item 2).
1b. **Starvation** of the factory-less pockets (item H4, ``starve_pockets``): the per-node timer
   ``Node.cut_since`` and the DEC-19 consumption (``capacity.consume``) on every node of such a
   pocket, provinces included.
2. **Packets** move and land (``supply.move_packets``).
3. **Recharge** of standing units (``supply.recharge``).
4. The **field**: ``d0``, the clamp of the shift, the pull, ``d``.
5. On a dispatch tick (``t > 0`` divisible by ``supply.dispatch_ticks``) the **dispatch** of item
   A6, per player: senders in ``(d, node_key)`` order, the front first; a node ahead of the
   level (``d < k``) sends nothing; the others send one charge per road, first **downhill** (own
   neighbours with ``k <= d(m) < d(n)`` and room, by fill ``(cap - room) * 100 // cap`` then
   ``node_key``), then along **level roads** (``d(m) == d(n)``, room, the same order): behind the
   level by the feed distance (item K: towards a smaller one on room alone, the gap rule
   ``load(m) + 2 <= have``, ``load = cap - room``, between equal ones, nothing towards a larger
   one, so no charge bounces); on the level (``d == k``) by the gap rule: the leaves even out
   (#724), except a level node where an own group stands short of a
   charge or gathering a plan (the groups that pull), or with an unpaid build (item J): it keeps,
   and its level neighbours give to it without the gap (room only). A lifted path node gives
   only along its path, and the node before it on the path gives to it on room alone (item I7).
   Each charge is a packet of 1 along one road (item A7).
6. The **plan** of the next dispatch for the view: the same function run on the state now, without
   sending (item E: ``flow_next`` and ``flow_idle``), stored in ``Node.flow`` with the field.

The full factory spills its new charge in ``systems.economy`` (item A8), reading ``Node.flow`` of
the previous tick (``spill_target``).

Cost per tick and player: O(V + E) for the field and the plan (and the feed distance of a
dispatch or plan with a level road behind the level), O(packets) for the room, O(groups) and O(V)
(the builds) for the pull and the paths.
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
    "spill_target",
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
    own standing group short of a charge or gathering a plan; its downhill neighbours of item A6
    (``k <= d(m) < d``; none on the level) with the road, by road id, room not considered."""
    level: dict[int, list[tuple[int, int]]]
    """The same nodes: the neighbours on its level (``d(m) == d``): level roads behind the level,
    the equalization of the leaves on it (#724); for a lifted path node only its next nodes
    towards the armies (item I7)."""
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
    """The own nodes on the level (``d == k``), lifted and pulled nodes included: the candidates
    for a hungry level node of item K."""


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

    # Components over internal roads: the shift of the capital's one, pockets (items A10, B3, H1).
    comp: dict[int, int] = {}
    members: dict[int, list[int]] = {}
    for nid in adj:  # ascending: the component id is its smallest node
        if nid in comp:
            continue
        comp[nid] = nid
        group = [nid]
        head = 0
        while head < len(group):
            n = group[head]
            head += 1
            for m, _ in adj[n]:
                if m not in comp:
                    comp[m] = nid
                    group.append(m)
        members[nid] = group
    capital = mapdef.capital(player)
    main = comp.get(capital)

    # The leaves of every component (items A1, A2): its nodes on a road to an enemy node; with
    # none, the capital's component takes its nodes farthest from the capital, a pocket all its
    # nodes. Then ``d0`` by one BFS from all leaves.
    d0: dict[int, int] = {}
    leaves: list[int] = []
    for c in sorted(members):
        group = members[c]
        touching = [n for n in group if n in contact]
        if touching:
            leaves.extend(touching)
        elif c == main:
            hops: dict[int, int] = {capital: 0}
            _bfs(adj, hops, deque([capital]))
            far = max(hops.values())
            leaves.extend(n for n in group if hops[n] == far)
        else:
            leaves.extend(group)
    leaves.sort()
    for n in leaves:
        d0[n] = 0
    _bfs(adj, d0, deque(leaves))

    ps = state.players[player]
    shift_max = d0.get(capital, 0) if capital in adj else 0
    ps.leaf_shift_max = shift_max
    ps.leaf_shift = min(ps.leaf_shift, shift_max)  # the clamp is stored (item B3)
    shift = ps.leaf_shift
    k = {n: shift if c == main else 0 for n, c in comp.items()}
    pocket = {n: c != main for n, c in comp.items()}  # no own capital: all pockets

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
    after: dict[int, list[tuple[int, int]]] = {}
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
                after.setdefault(m, []).append((n, eid))
                n = m
    down: dict[int, list[tuple[int, int]]] = {}
    level: dict[int, list[tuple[int, int]]] = {}
    flat: list[int] = []
    for n, dn in d.items():
        kn = k[n]
        if dn == kn:
            flat.append(n)
        if dn < kn or (dn == kn and n in holding):
            continue  # ahead of the level, or a level node an army there holds: it never sends
        if n in before:  # a lifted node between: only towards the armies (item I7)
            down[n] = []
            level[n] = sorted(after.get(n, []), key=lambda pair: pair[1])  # by road id
            continue
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
    return _Field(player, d, k, pocket, adj, down, level, holding, before, owed, flat)


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
    # The want of a node that pulls for a build alone (item J): what it still owes beyond its
    # stock and its packets on the way; it takes no more than that. Its fill stays the warehouse's.
    want: dict[int, int] = {}
    for n, due in field.owed.items():
        rest = due - nodes[n].warehouse - incoming.get(n, 0)
        want[n] = rest if rest > 0 else 0

    def order(m: int) -> tuple[int, int]:
        cap = capacities[m]  # room > 0, so cap > 0
        return ((cap - room[m]) * 100 // cap, key(player, m))  # non-negative: rounded down

    # The feed distance of item K (the saddle), when a sender behind the level has a level road.
    k = field.k
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
        if want:
            down = [p for p in field.down[n] if room[p[0]] and want.get(p[0], 1)]
            level = [p for p in field.level[n] if room[p[0]] and want.get(p[0], 1)]
        else:
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
            if m in want:
                want[m] -= 1
            have -= 1
        if len(level) > 1:
            level.sort(key=lambda pair: order(pair[0]))
        for m, eid in level:
            if have == 0:
                break
            if behind and feed is not None:
                # behind the level (item K): towards a hungry level node on room alone, the gap
                # rule between equal feed distances, nothing away from a hungry level node
                fm = feed.get(m, far)
                give = fm < fn or (fm == fn and capacities[m] - room[m] + 2 <= have)
            else:
                # a gap of 1 never moves; a pulling army takes without the gap (item I3), and so
                # does the next node of a path (item I7)
                give = (
                    m in field.holding
                    or field.before.get(m) == n
                    or capacities[m] - room[m] + 2 <= have
                )
            if give:
                out.append((m, eid))
                room[m] -= 1
                if m in want:
                    want[m] -= 1
                have -= 1
        if out:
            sends.append((n, out))
    return sends


def _feed(field: _Field, room: dict[int, int], want: dict[int, int]) -> dict[int, int]:
    """The feed distance of item K at the room snapshot of a dispatch: 0 for a **hungry** level
    node (``d == k``, ``room > 0``, and a build node without an army still wants a charge, item
    J), then a BFS backwards over the roads a node behind the level sends along: ``feed(n) = 1 +
    min(feed(m))`` over its downhill and level neighbours ``m`` (``down`` and ``level`` of the
    field). A node missing from the result feeds no hungry level node. A BFS distance: the order
    of the queue does not change it. O(V + E)."""
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
