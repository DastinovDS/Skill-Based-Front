"""Vision (SIM-03): detail levels by DEC-04 and the fog memory system.

DEC-04 (mechanics.md, section 10):

- ``EXACT``: own nodes and nodes where own groups stand (groups stand only in nodes);
- ``PRESENCE``: nodes adjacent to an ``EXACT`` node and edges touching an ``EXACT`` node:
  whether enemy groups are there and their modes, without numbers;
- ``FOG``: everything else; the player has the last sighting from ``vision_memory``.

Public to everyone regardless of level: geography, terrain, road widths, ownership and capacity
of all nodes, VP, intents. That part is the projection's job (SIM-14).

``is_visible()`` is the single visibility check for command validation (SIM-04) and the
projection (SIM-14). ``vision()`` is the last system of a tick and refreshes the fog memory.
"""

from dataclasses import dataclass

from gow_sim.ruleset import Ruleset
from gow_sim.state import (
    AtNode,
    Detail,
    Event,
    GameState,
    Group,
    Intent,
    Mode,
    OnEdge,
    Packet,
    Sighting,
)


@dataclass(frozen=True, slots=True)
class Vision:
    """Detail levels of one player: ``nodes[node_id]`` and ``edges[edge_id]``."""

    nodes: tuple[Detail, ...]
    edges: tuple[Detail, ...]


def compute_vision(state: GameState, player: int) -> Vision:
    """Detail levels of all nodes and edges for ``player``. O(V + E + G)."""
    mapdef = state.map
    exact = [state.nodes[n].owner == player for n in range(len(mapdef.nodes))]
    for gid in sorted(state.groups):
        group = state.groups[gid]
        if group.owner == player and isinstance(group.location, AtNode):
            exact[group.location.node] = True
    # TODO(#112): a group on an edge gives no vision (literal DEC-04: only standing groups do).
    edges = tuple(Detail.PRESENCE if exact[e.a] or exact[e.b] else Detail.FOG for e in mapdef.edges)
    nodes: list[Detail] = []
    for n in range(len(mapdef.nodes)):
        if exact[n]:
            nodes.append(Detail.EXACT)
        elif any(exact[mapdef.edges[e].other(n)] for e in mapdef.incident[n]):
            nodes.append(Detail.PRESENCE)
        else:
            nodes.append(Detail.FOG)
    return Vision(nodes=tuple(nodes), edges=edges)


def detail_level(state: GameState, player: int, node: int) -> Detail:
    return compute_vision(state, player).nodes[node]


def edge_detail_level(state: GameState, player: int, edge: int) -> Detail:
    """``PRESENCE`` or ``FOG``: DEC-04 never shows numbers on edges."""
    return compute_vision(state, player).edges[edge]


def visible_nodes(state: GameState, player: int) -> tuple[int, ...]:
    """Ids of the nodes not in fog (``EXACT`` or ``PRESENCE``), ascending."""
    levels = compute_vision(state, player).nodes
    return tuple(n for n, level in enumerate(levels) if level is not Detail.FOG)


def visible_edges(state: GameState, player: int) -> tuple[int, ...]:
    """Ids of the edges not in fog, ascending."""
    levels = compute_vision(state, player).edges
    return tuple(e for e, level in enumerate(levels) if level is not Detail.FOG)


def is_visible(
    state: GameState, player: int, entity: Group | Packet | Intent, vision: Vision | None = None
) -> bool:
    """Whether ``player`` may know that ``entity`` exists.

    - Intents are public (DEC-04). Own groups and packets are always visible.
    - An enemy group is visible in a node or on an edge that is not in fog; how much of it is
      shown (numbers or only presence and mode) is ``detail_level`` of that place.
    - Enemy packets are never visible: DEC-04 shows only groups on edges (TODO(#112)).

    Pass ``vision`` to reuse levels computed for the same state and player.
    """
    if isinstance(entity, Intent) or entity.owner == player:
        return True
    if isinstance(entity, Packet):
        return False
    levels = vision if vision is not None else compute_vision(state, player)
    match entity.location:
        case AtNode(node=node):
            return levels.nodes[node] is not Detail.FOG
        case OnEdge(edge=edge):
            return levels.edges[edge] is not Detail.FOG


def vision(state: GameState, rules: Ruleset) -> list[Event]:
    """Last system of a tick: record what each player sees now in ``vision_memory``.

    Every node and edge not in fog gets a fresh ``Sighting`` with the current tick; fogged ones
    keep their last sighting. Emits no events.
    """
    del rules  # the vision rules of DEC-04 have no numbers
    for player in sorted(state.players):
        levels = compute_vision(state, player)
        at_node: dict[int, list[Group]] = {}
        on_edge: dict[int, list[Group]] = {}
        for gid in sorted(state.groups):
            group = state.groups[gid]
            if group.owner == player:
                continue
            match group.location:
                case AtNode(node=node):
                    at_node.setdefault(node, []).append(group)
                case OnEdge(edge=edge):
                    on_edge.setdefault(edge, []).append(group)
        memory = state.vision_memory[player]
        for n, level in enumerate(levels.nodes):
            if level is not Detail.FOG:
                memory.nodes[n] = _sighting(state.tick, level, at_node.get(n, []))
        for e, level in enumerate(levels.edges):
            if level is not Detail.FOG:
                memory.edges[e] = _sighting(state.tick, level, on_edge.get(e, []))
    return []


def _sighting(tick: int, level: Detail, enemies: list[Group]) -> Sighting:
    modes: list[Mode] = sorted(dict.fromkeys(g.mode for g in enemies))  # distinct, sorted
    if level is Detail.EXACT:
        return Sighting(
            tick=tick,
            level=level,
            enemy_modes=tuple(modes),
            enemy_units=sum(g.units for g in enemies),
            enemy_charged=sum(g.charged for g in enemies),
        )
    return Sighting(
        tick=tick, level=level, enemy_modes=tuple(modes), enemy_units=None, enemy_charged=None
    )
