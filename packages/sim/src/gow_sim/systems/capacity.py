"""City capacity and attrition (SIM-07; mechanics.md, section 9).

Capacity:

- Supplied territory of a player: the nodes reachable from the own capital over own nodes; every
  edge between two own nodes is internal, so this is a BFS over internal edges.
- Capacity of a node: ``base_capacity`` of the map plus, for a node in its owner's supplied
  territory, the sum of ``capacity.width_gain_centi[width]`` over its internal edges (they lead
  into the same territory), in hundredths, divided by 100 and rounded down. A node outside
  the supplied territory of its owner (cut off) and a neutral node have only ``base_capacity``.
- The same number limits the units standing in the city and, separately, its warehouse
  (``rulesets/mvp-0.toml``, section ``[capacity]``).
- Capacities depend only on node owners and road widths; ``node_capacities()`` recomputes them
  only when one of those changed (``GameState.capacity_cache``).

Attrition (the ``capacity`` system; details: #118 default):

- Only units of the node owner that stand in the node (``is_standing``) count; groups on edges
  are in transit.
- Each tick the owner's standing units exceed the capacity, ``Node.over_ticks`` grows by one; a
  tick within the limit resets it. On the ``capacity.attrition_ticks``-th tick in a row one unit
  dies and the count starts again: one unit per ``attrition_ticks`` ticks.
- Ticks ``captured_tick .. captured_tick + capacity.grace_ticks - 1`` after a capture do not count.
- The victim: a discharged unit of the lowest-id group that has one; otherwise a charged unit of
  the group with the most units, ties by lowest id (as DEC-07, rule 7). An empty group is removed.

Every owner change goes through ``change_owner()``: the warehouse is emptied (no trophies,
mechanics.md, section 9), road widths are kept, the grace period starts.
"""

from typing import Final

from gow_sim.ruleset import Ruleset
from gow_sim.state import AtNode, Event, GameState, Group, event

CENTI: Final = 100
"""Width gains are stored in hundredths of a capacity unit."""


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
    """Units of ``player`` standing in ``node``: what the capacity limits."""
    total = 0
    for gid in sorted(state.groups):
        group = state.groups[gid]
        if group.owner == player and is_standing(group) and group.location == AtNode(node):
            total += group.units
    return total


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
    """Capacity of every node, ``result[node_id]``.

    Recomputed (O(V + E)) only when node owners, road widths or the width gains changed since
    the last call on this state; otherwise the cached tuple is returned.
    """
    owners = tuple(state.nodes[n].owner for n in range(len(state.map.nodes)))
    widths = tuple(state.edges[e].width for e in range(len(state.map.edges)))
    gains = rules.capacity.width_gain_centi.values
    cache = state.capacity_cache
    if cache is not None and cache[0] == owners and cache[1] == widths and cache[2] == gains:
        return cache[3]
    capacities = _compute_capacities(state, rules)
    state.capacity_cache = (owners, widths, gains, capacities)
    return capacities


def _compute_capacities(state: GameState, rules: Ruleset) -> tuple[int, ...]:
    supplied = {p: supplied_territory(state, p) for p in sorted(state.players)}
    # Capacity centi >= 0: rounded down.
    return tuple(
        _capacity_centi(state, rules, supplied, node) // CENTI
        for node in range(len(state.map.nodes))
    )


def _capacity_centi(
    state: GameState, rules: Ruleset, supplied: dict[int, tuple[bool, ...]], node: int
) -> int:
    mapdef = state.map
    total = mapdef.nodes[node].base_capacity * CENTI
    owner = state.nodes[node].owner
    if owner is not None and supplied[owner][node]:
        gains = rules.capacity.width_gain_centi
        for eid in mapdef.incident[node]:
            if is_internal(state, eid):
                total += gains.of(state.edges[eid].width)
    return total


def city_capacity_centi(state: GameState, rules: Ruleset, node: int) -> int:
    """Capacity of one node in hundredths, before rounding down: ``city_capacity * 100 <= it``.

    Not cached, O(V + E): for hints and tests (``systems.build.upgrade_gain``), not for systems.
    """
    supplied = {p: supplied_territory(state, p) for p in sorted(state.players)}
    return _capacity_centi(state, rules, supplied, node)


def city_capacity(state: GameState, rules: Ruleset, node: int) -> int:
    """Capacity of one node (see the module docstring)."""
    return node_capacities(state, rules)[node]


def change_owner(state: GameState, node: int, owner: int | None) -> list[Event]:
    """Give ``node`` to ``owner``: the warehouse is emptied, road widths stay, grace starts.

    Captures (movement SIM-05, combat SIM-09) call this; it emits ``warehouse_lost`` when
    charges were in the warehouse. A call with the current owner changes nothing.
    """
    n = state.nodes[node]
    if n.owner == owner:
        return []
    events: list[Event] = []
    if n.warehouse > 0:
        events.append(
            event(state.tick, "warehouse_lost", node=node, owner=n.owner, charges=n.warehouse)
        )
    n.owner = owner
    n.warehouse = 0
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
