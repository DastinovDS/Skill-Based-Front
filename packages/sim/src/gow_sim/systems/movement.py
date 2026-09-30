"""Movement on the graph (SIM-05). For now only the path search stub used by ``Move`` (SIM-04).

TODO(#21): Dijkstra over travel times with the node_key tie-break and the movement system.
"""

from gow_sim.ruleset import Ruleset
from gow_sim.state import GameState


def find_path(
    state: GameState, rules: Ruleset, player: int, start: int, dest: int
) -> tuple[int, ...] | None:
    """Path ``(start, ..., dest)`` for a group of ``player``, or ``None`` if there is none.

    Stub until SIM-05 (#21): only a direct edge ``start -> dest`` is a path.
    """
    del rules, player
    mapdef = state.map
    for eid in mapdef.incident[start]:
        if mapdef.edges[eid].other(start) == dest:
            return (start, dest)
    return None
