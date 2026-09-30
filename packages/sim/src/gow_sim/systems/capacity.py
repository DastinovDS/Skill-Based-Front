"""City capacity (mechanics.md, section 9): supplied territory and the capacity formula.

- Supplied territory of a player: the nodes reachable from the own capital over own nodes; every
  edge between two own nodes is internal, so this is a BFS over internal edges.
- Capacity of a node: ``base_capacity`` of the map plus, for a node in its owner's supplied
  territory, the sum of ``capacity.width_gain_centi[width]`` over its internal edges (they lead
  into the same territory), in hundredths, divided by 100 and rounded down. A node outside
  the supplied territory of its owner (cut off) and a neutral node have only ``base_capacity``.
- The same number limits the units standing in the city and, separately, its warehouse
  (``rulesets/mvp-0.toml``, section ``[capacity]``).
"""

from typing import Final

from gow_sim.ruleset import Ruleset
from gow_sim.state import GameState

CENTI: Final = 100
"""Width gains are stored in hundredths of a capacity unit."""


def is_internal(state: GameState, edge: int) -> bool:
    """Both ends of the edge have the same owner (glossary: internal edge)."""
    e = state.map.edges[edge]
    owner = state.nodes[e.a].owner
    return owner is not None and state.nodes[e.b].owner == owner


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
    """Capacity of every node, ``result[node_id]``. O(V + E)."""
    mapdef = state.map
    supplied = {p: supplied_territory(state, p) for p in sorted(state.players)}
    gains = rules.capacity.width_gain_centi
    result: list[int] = []
    for node in mapdef.nodes:
        owner = state.nodes[node.id].owner
        gain = 0
        if owner is not None and supplied[owner][node.id]:
            for eid in mapdef.incident[node.id]:
                if is_internal(state, eid):
                    gain += gains.of(state.edges[eid].width)
        result.append(node.base_capacity + gain // CENTI)  # gain >= 0: rounded down
    return tuple(result)


def city_capacity(state: GameState, rules: Ruleset, node: int) -> int:
    """Capacity of one node (see the module docstring)."""
    return node_capacities(state, rules)[node]
