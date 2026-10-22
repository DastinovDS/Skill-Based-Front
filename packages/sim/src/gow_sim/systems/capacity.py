"""City capacity and attrition (SIM-07; mechanics.md, section 9).

Capacity (DEC-22, item 1, replaces the road-dependent formula of SIM-07):

- Capacity of a node: ``capacity.by_kind[kind]`` by the node kind of the map. It does not
  depend on roads, the owner or supply, so it is public and exact for every node; cutting a node
  off does not change it (the pressure of an encirclement is starvation, DEC-19).
- The same number limits the units standing in the city and, without ``city_upgrades``,
  separately its warehouse (DEC-22, item 1). With ``city_upgrades`` the warehouse has its own
  capacity ``warehouse.start_by_kind[kind] + level * warehouse.gain_per_level`` (DEC-26, item 2;
  ``warehouse_capacity``); provinces have no warehouse (DEC-23).
- Supplied territory of a player (the cut-off cities of DEC-19): the nodes
  reachable from the own capital over own nodes; every edge between two own nodes is internal,
  so this is a BFS over internal edges.

Attrition (the ``capacity`` system; details: #118 default):

- Only units of the node owner that stand in the node (``is_standing``) count; groups on edges
  are in transit.
- Each tick the owner's standing units exceed the capacity, ``Node.over_ticks`` grows by one; a
  tick within the limit resets it. On the ``capacity.attrition_ticks``-th tick in a row one unit
  dies and the count starts again: one unit per ``attrition_ticks`` ticks.
- Ticks ``captured_tick .. captured_tick + capacity.grace_ticks - 1`` after a capture do not count.
- The victim: a discharged unit of the lowest-id group that has one; otherwise a charged unit of
  the group with the most units, ties by lowest id (as DEC-07, rule 7). An empty group is removed.

Starvation in an encirclement (DEC-19; ``starvation`` after the attrition, in the same system):

- A cut-off city: an own city (not a province) outside its owner's ``supplied_territory``.
  ``Node.cut_since`` is the first tick of the current continuous cut; it is reset when the city is
  supplied again or changes its owner (a city captured cut off counts from the capture tick).
- On ticks ``cut_since + starvation.grace_ticks + k * starvation.period_ticks`` the garrison
  spends ``starvation.charges * ceil(U / starvation.per_units)`` charges, ``U``: the owner's
  units standing in the city: first from the warehouse, the rest one charge at a time from the
  standing group with the most ``charged`` (ties: lower id). A shortfall is not carried over.
  Units never die of it. Event ``starvation`` (player, node, from the warehouse, from the units).

Every owner change goes through ``change_owner()``: the warehouse is emptied (no trophies,
mechanics.md, section 9), road levels, the barracks and the warehouse level are kept (DEC-26,
item 4), the recruit queue of the former owner is lost without a refund (DEC-25,
item 10), the grace period starts.
"""

from gow_sim.maps import NodeKind
from gow_sim.ruleset import Ruleset
from gow_sim.state import AtNode, Event, GameState, Group, event


def is_internal(state: GameState, edge: int) -> bool:
    """Both ends of the edge have the same owner (glossary: internal edge)."""
    e = state.map.edges[edge]
    owner = state.nodes[e.a].owner
    return owner is not None and state.nodes[e.b].owner == owner


def is_standing(group: Group) -> bool:
    """The group stands in a node; groups on edges are in transit.

    TODO(#118): movement (SIM-05) must not leave a group in an intermediate node of its path
    between ticks, otherwise this check grows with SIM-05.
    """
    return isinstance(group.location, AtNode)


def standing_units(state: GameState, node: int, player: int) -> int:
    """Units of ``player`` standing in ``node``: what the capacity limits.

    A sum, so the order of the groups does not matter (no ``sorted``); ``project()`` calls it for
    every own city, so it stays cheap (#266: ``grid55``).
    """
    total = 0
    for group in state.groups.values():
        location = group.location  # standing: is_standing(group), the group is in a node
        if group.owner == player and isinstance(location, AtNode) and location.node == node:
            total += group.units
    return total


def overflow_countdown(
    state: GameState, rules: Ruleset, node: int, capacity: int
) -> tuple[int | None, int | None]:
    """``(attrition_in, grace_left)`` of an own city for the owner's view (ui-style, section 12).

    Both are ``None`` while the units standing in the node owned by the owner fit into
    ``capacity``. Over capacity: ``grace_left`` is the number of ticks the grace after a capture
    still lasts (attrition does not count then, ``attrition_in`` is ``None``); otherwise
    ``attrition_in`` is the number of ticks until the next unit dies (``attrition_ticks`` minus
    ``over_ticks``, at least 1). The caller shows it only to the owner of the node.
    """
    owner = state.nodes[node].owner
    if owner is None or standing_units(state, node, owner) <= capacity:
        return None, None
    captured = state.nodes[node].captured_tick
    if captured is not None and state.tick - captured < rules.capacity.grace_ticks:
        return None, rules.capacity.grace_ticks - (state.tick - captured)
    left = rules.capacity.attrition_ticks - state.nodes[node].over_ticks
    return max(1, left), None


def supplied_territory(state: GameState, player: int) -> tuple[bool, ...]:
    """``result[node]``: the node is connected to the player's capital over own nodes.

    Empty (all ``False``) when the player does not own its capital. O(V + E).
    """
    mapdef = state.map
    supplied = [False] * len(mapdef.nodes)
    capital = mapdef.capital(player)
    if state.nodes[capital].owner != player:
        return tuple(supplied)
    supplied[capital] = True
    queue = [capital]
    head = 0
    while head < len(queue):
        node = queue[head]
        head += 1
        for eid in mapdef.incident[node]:
            other = mapdef.edges[eid].other(node)
            if not supplied[other] and state.nodes[other].owner == player:
                supplied[other] = True
                queue.append(other)
    return tuple(supplied)


def node_capacities(state: GameState, rules: Ruleset) -> tuple[int, ...]:
    """Capacity of every node, ``result[node_id]``: ``capacity.by_kind[kind]`` (DEC-22, item 1).

    O(V); fixed by the map and the ruleset, public to everyone.
    """
    by_kind = rules.capacity.by_kind
    return tuple(by_kind.of(node.kind) for node in state.map.nodes)


def city_capacity(state: GameState, rules: Ruleset, node: int) -> int:
    """Capacity of one node (see the module docstring)."""
    return rules.capacity.by_kind.of(state.map.nodes[node].kind)


def warehouse_capacity(state: GameState, rules: Ruleset, node: int) -> int:
    """Charges the warehouse of ``node`` holds: the node capacity without ``city_upgrades``
    (DEC-22, item 1); with it ``start_by_kind[kind] + level * gain_per_level`` (DEC-26, item 2),
    0 for a province."""
    kind = state.map.nodes[node].kind
    if not rules.city_upgrades.enabled:
        return rules.capacity.by_kind.of(kind)
    w = rules.warehouse
    if kind is NodeKind.PROVINCE:
        return 0
    return w.start_by_kind.of(kind) + state.nodes[node].warehouse_level * w.gain_per_level


def warehouse_capacities(state: GameState, rules: Ruleset) -> tuple[int, ...]:
    """``warehouse_capacity`` of every node, ``result[node_id]``. O(V)."""
    if not rules.city_upgrades.enabled:
        return node_capacities(state, rules)
    return tuple(warehouse_capacity(state, rules, n) for n in range(len(state.map.nodes)))


def change_owner(state: GameState, node: int, owner: int | None) -> list[Event]:
    """Give ``node`` to ``owner``: the warehouse is emptied, road widths stay, grace starts.

    The recruit queue and its progress are dropped (DEC-25, item 10); a front marker of the
    former owner on the city falls back in ``systems.supply`` (DEC-28, item 2).

    Captures (movement SIM-05, combat SIM-09) call this; it emits ``warehouse_lost`` when
    charges were in the warehouse and ``recruit_queue_lost`` (for the former owner) when units
    were queued. A call with the current owner changes nothing.
    """
    n = state.nodes[node]
    if n.owner == owner:
        return []
    events: list[Event] = []
    if n.warehouse > 0:
        events.append(
            event(state.tick, "warehouse_lost", node=node, owner=n.owner, charges=n.warehouse)
        )
    if n.recruit_queue > 0 and n.owner is not None:
        # The queue belongs to the former owner and is lost without a refund (DEC-25, item 10).
        events.append(
            event(
                state.tick, "recruit_queue_lost", player=n.owner, node=node, units=n.recruit_queue
            )
        )
    n.recruit_queue = 0
    n.recruit_progress = 0
    n.owner = owner
    n.warehouse = 0
    n.cut_since = None
    n.over_ticks = 0
    n.captured_tick = state.tick
    return events


def capacity(state: GameState, rules: Ruleset) -> list[Event]:
    """Attrition of garrisons above the city capacity (see the module docstring)."""
    events: list[Event] = []
    capacities = node_capacities(state, rules)
    garrisons: dict[int, list[Group]] = {}
    for gid in sorted(state.groups):
        group = state.groups[gid]
        if is_standing(group) and isinstance(group.location, AtNode):
            node_id = group.location.node
            if group.owner == state.nodes[node_id].owner:
                garrisons.setdefault(node_id, []).append(group)
    for node_id in sorted(state.nodes):
        node = state.nodes[node_id]
        groups = garrisons.get(node_id, [])
        over = sum(g.units for g in groups) > capacities[node_id]
        in_grace = (
            node.captured_tick is not None
            and state.tick - node.captured_tick < rules.capacity.grace_ticks
        )
        if not over or in_grace:
            node.over_ticks = 0
            continue
        node.over_ticks += 1
        if node.over_ticks < rules.capacity.attrition_ticks:
            continue
        node.over_ticks = 0
        events.append(_kill_one(state, node_id, groups))
    events.extend(starvation(state, rules, garrisons))
    return events


def is_city_node(state: GameState, node: int) -> bool:
    return state.map.nodes[node].kind is not NodeKind.PROVINCE


def starve_in(state: GameState, rules: Ruleset, node: int) -> int | None:
    """Ticks until the next consumption of a cut-off city (DEC-19, item 8); ``None`` if not cut.

    Also ``None`` when that consumption would spend nothing (#253): no standing unit of the owner
    in the city, or an empty warehouse and no charged standing unit. The schedule itself
    (``cut_since``) does not change, so the countdown comes back on it once there are charges.
    The caller shows it only to the owner of the node.
    """
    n = state.nodes[node]
    since = n.cut_since
    if since is None:
        return None
    units = charged = 0
    for group in state.groups.values():  # sums only: the order does not matter
        location = group.location
        if (
            group.owner == n.owner
            and is_standing(group)
            and isinstance(location, AtNode)
            and location.node == node
        ):
            units += group.units
            charged += group.charged
    if units == 0 or (n.warehouse == 0 and charged == 0):
        return None
    first = since + rules.starvation.grace_ticks
    if state.tick < first:
        return first - state.tick
    period = rules.starvation.period_ticks
    return period - (state.tick - first) % period


def starvation(state: GameState, rules: Ruleset, garrisons: dict[int, list[Group]]) -> list[Event]:
    """Update ``cut_since`` of every own city and let the cut-off garrisons starve (DEC-19)."""
    events: list[Event] = []
    rules_s = rules.starvation
    supplied = {p: supplied_territory(state, p) for p in sorted(state.players)}
    tick = state.tick
    for node_id in sorted(state.nodes):
        node = state.nodes[node_id]
        owner = node.owner
        if owner is None or not is_city_node(state, node_id) or supplied[owner][node_id]:
            node.cut_since = None
            continue
        if node.cut_since is None:
            node.cut_since = tick
        since = tick - node.cut_since - rules_s.grace_ticks
        if since < 0 or since % rules_s.period_ticks != 0:
            continue
        groups = [g for g in garrisons.get(node_id, ()) if g.units > 0]
        units = sum(g.units for g in groups)
        if units == 0:
            continue
        need = rules_s.charges * ((units + rules_s.per_units - 1) // rules_s.per_units)
        from_stock = min(need, node.warehouse)
        node.warehouse -= from_stock
        left = need - from_stock
        from_units = 0
        while left > 0:
            group = max(groups, key=lambda g: (g.charged, -g.id))
            if group.charged == 0:
                break  # nothing left to spend: the shortfall is not carried over
            group.charged -= 1
            left -= 1
            from_units += 1
        if from_stock or from_units:
            events.append(
                event(
                    tick,
                    "starvation",
                    player=owner,
                    node=node_id,
                    warehouse=from_stock,
                    units=from_units,
                )
            )
    return events


def _kill_one(state: GameState, node: int, groups: list[Group]) -> Event:
    """One unit of the garrison ``groups`` (ascending id, non-empty) dies."""
    discharged = [g for g in groups if g.units > g.charged]
    if discharged:
        victim = discharged[0]
        charged = False
    else:
        victim = max(groups, key=lambda g: (g.units, -g.id))
        victim.charged -= 1
        charged = True
    victim.units -= 1
    destroyed = victim.units == 0
    if destroyed:
        del state.groups[victim.id]
    return event(
        state.tick,
        "attrition",
        node=node,
        player=victim.owner,
        group=victim.id,
        charged=charged,
        destroyed=destroyed,
    )
