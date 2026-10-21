"""Vision (SIM-03; DEC-21, DEC-33): detail levels by terrain, halves of edges, the fog memory.

DEC-21 (mechanics.md, section 10):

- sources of vision: own nodes and nodes where own groups stand (groups stand only in nodes; a
  group on an edge gives no vision, #112). A source is ``EXACT``;
- a node next to a source gets the level of the pair «terrain of the source -> terrain of the
  node» from ``vision.by_terrain`` (``EXACT``, ``RANGE`` or ``PRESENCE``); with several sources
  around, the best one. Any other node is ``FOG``;
- an edge is split by its border point ``border_permille`` into the half of ``a`` and the half of
  ``b``; a half is seen with the level of its node (a source's half is ``EXACT``), so a half of a
  visible node is seen even when the edge has no source at either end (DEC-33, item 1). A group
  belongs to the half of the node it goes to once it is on the border point or past it, else to
  the half of the other end (``half_node``);
- what a place shows of the enemy groups in it (``Sighting``): ``EXACT`` the total units and
  charged and the modes, ``RANGE`` the range of the total units (``vision.range_starts``) and the
  modes, ``PRESENCE`` the modes only.

Road levels follow the edge level of DEC-17 (DEC-22, item 8; roads have no type, DEC-26): an edge
is not in fog while at least one of its ends is a source (``Vision.edges``); then its level is
shown exactly, else that of its last sighting (``VisionMemory.widths``) or level 1 if never seen
(``known_roads``). No roads are torn down, so a known level never exceeds the true one. The half of
a visible node on an edge between two non-sources does not show the level (DEC-33, item 4).

Public to everyone regardless of level: geography, terrain, the map, ownership of all nodes, VP,
intents of planned orders and «Защита». That part is the projection's job (SIM-14).

``is_visible()`` is the single visibility check for command validation (SIM-04) and the
projection (SIM-14). ``vision()`` is the last system of a tick and refreshes the fog memory.
"""

from dataclasses import dataclass
from typing import Final

from gow_sim.maps import MapDef
from gow_sim.ruleset import Ruleset
from gow_sim.state import (
    PROGRESS_SCALE,
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
from gow_sim.systems.movement import border_permille

_RANK: Final = {Detail.EXACT: 0, Detail.RANGE: 1, Detail.PRESENCE: 2, Detail.FOG: 3}
"""Better levels first (DEC-21, item 2: ``EXACT`` better than ``RANGE`` better than
``PRESENCE``)."""


@dataclass(frozen=True, slots=True)
class Vision:
    """Detail levels of one player.

    ``nodes[node_id]``: the level of the node, which is also the level of its halves of edges.
    ``edges[edge_id]``: the road level visibility of DEC-17: ``PRESENCE`` while at least one end
    is a source, else ``FOG``. ``sources[node_id]``: the node is a source of vision (its
    warehouse is seen; DEC-21, item 3).
    """

    nodes: tuple[Detail, ...]
    edges: tuple[Detail, ...]
    sources: tuple[bool, ...] = ()

    def half(self, node: int) -> Detail:
        """The level of a half of an edge that belongs to ``node``: the level of the node."""
        return self.nodes[node]


def sources(state: GameState, player: int) -> list[bool]:
    """``result[node]``: the node is a source of vision of ``player`` (own, or an own group
    stands there; DEC-21, item 1)."""
    source = [state.nodes[n].owner == player for n in range(len(state.map.nodes))]
    for gid in sorted(state.groups):
        group = state.groups[gid]
        if group.owner == player and isinstance(group.location, AtNode):
            source[group.location.node] = True
    # TODO(#112): a group on an edge gives no vision (literal DEC-04: only standing groups do).
    return source


def compute_vision(state: GameState, rules: Ruleset, player: int) -> Vision:
    """Detail levels of all nodes and edges for ``player``. O(V + E + G)."""
    mapdef = state.map
    source = sources(state, player)
    nodes = [Detail.EXACT if s else Detail.FOG for s in source]
    table = rules.vision.by_terrain
    for n, is_source in enumerate(source):
        if not is_source:
            continue
        here = mapdef.nodes[n].terrain
        for e in mapdef.incident[n]:
            m = mapdef.edges[e].other(n)
            level = Detail(table.of(here, mapdef.nodes[m].terrain).value)
            if _RANK[level] < _RANK[nodes[m]]:
                nodes[m] = level
    edges = tuple(
        Detail.PRESENCE if source[e.a] or source[e.b] else Detail.FOG for e in mapdef.edges
    )
    return Vision(nodes=tuple(nodes), edges=edges, sources=tuple(source))


def detail_level(state: GameState, rules: Ruleset, player: int, node: int) -> Detail:
    return compute_vision(state, rules, player).nodes[node]


def edge_detail_level(state: GameState, player: int, edge: int) -> Detail:
    """The road level visibility of ``edge`` (DEC-17): ``PRESENCE`` or ``FOG``."""
    e = state.map.edges[edge]
    source = sources(state, player)
    return Detail.PRESENCE if source[e.a] or source[e.b] else Detail.FOG


def visible_nodes(state: GameState, rules: Ruleset, player: int) -> tuple[int, ...]:
    """Ids of the nodes not in fog, ascending."""
    levels = compute_vision(state, rules, player).nodes
    return tuple(n for n, level in enumerate(levels) if level is not Detail.FOG)


def visible_edges(state: GameState, player: int) -> tuple[int, ...]:
    """Ids of the edges whose road level is not in fog (DEC-17), ascending."""
    source = sources(state, player)
    return tuple(e.id for e in state.map.edges if source[e.a] or source[e.b])


# Positions on an edge --------------------------------------------------------------------------


def edge_pos(mapdef: MapDef, loc: OnEdge) -> int:
    """The position of a group on its edge in thousandths from the end ``a`` (DEC-21, item 5):
    ``progress`` if it left ``a``, else ``1000 - progress``."""
    if loc.from_node == mapdef.edges[loc.edge].a:
        return loc.progress
    return PROGRESS_SCALE - loc.progress


def heading(mapdef: MapDef, loc: OnEdge) -> int:
    """The end of the edge the group goes to: the far end, or for a bouncing or turned back group
    (``back``, DEC-07, DEC-20) the node it returns to."""
    return loc.from_node if loc.back else mapdef.edges[loc.edge].other(loc.from_node)


def half_node(mapdef: MapDef, loc: OnEdge) -> int:
    """The end whose half of the edge holds the group (DEC-21, item 5; DEC-33).

    The group belongs to the half of the node it goes to once it is on the border point or past
    it in its direction, else to the half of the other end.
    """
    e = mapdef.edges[loc.edge]
    pos = edge_pos(mapdef, loc)
    border = border_permille(mapdef, loc.edge)
    to = heading(mapdef, loc)
    if to == e.b:
        return e.b if pos >= border else e.a
    return e.a if pos <= border else e.b


def is_visible(
    state: GameState,
    rules: Ruleset,
    player: int,
    entity: Group | Packet | Intent,
    vision: Vision | None = None,
) -> bool:
    """Whether ``player`` may know that ``entity`` exists.

    - Intents (planned orders and «Защита») are public (DEC-04). Own groups and packets are
      always visible.
    - An enemy group is visible in a node not in fog and in a half of an edge whose node is not in
      fog (DEC-21, DEC-33); a group in a fight is visible: fights are public (DEC-24, item I1).
      How much of it is shown is the level of that place.
    - Enemy packets are never visible: DEC-04 shows only groups on edges (TODO(#112)).

    Pass ``vision`` to reuse levels computed for the same state and player.
    """
    if isinstance(entity, Intent) or entity.owner == player:
        return True
    if isinstance(entity, Packet):
        return False
    levels = vision if vision is not None else compute_vision(state, rules, player)
    match entity.location:
        case AtNode(node=node):
            return levels.nodes[node] is not Detail.FOG
        case OnEdge() as loc:
            if entity.fight is not None:
                return True
            return levels.half(half_node(state.map, loc)) is not Detail.FOG


# The fog memory --------------------------------------------------------------------------------


def vision(state: GameState, rules: Ruleset) -> list[Event]:
    """Last system of a tick: record what each player sees now in ``vision_memory``.

    Every node and half of an edge not in fog gets a fresh ``Sighting`` with the current tick,
    every edge whose road level is not in fog its current level (DEC-17); fogged ones keep their
    last sighting. ``spotted`` keeps the enemy groups in sight with the tick each came into sight
    (DEC-33, detail 5). Emits no events.
    """
    for player in sorted(state.players):
        levels = compute_vision(state, rules, player)
        nodes, halves = current_sightings(state, rules, player, levels)
        memory = state.vision_memory[player]
        memory.nodes.update(nodes)
        memory.halves.update(halves)
        for e, level in enumerate(levels.edges):
            if level is not Detail.FOG:
                memory.widths[e] = state.edges[e].width
        before = memory.spotted
        memory.spotted = {
            gid: before.get(gid, state.tick)
            for gid in sorted(state.groups)
            if state.groups[gid].owner != player
            and is_visible(state, rules, player, state.groups[gid], levels)
        }
    return []


def current_sightings(
    state: GameState, rules: Ruleset, player: int, levels: Vision
) -> tuple[dict[int, Sighting], dict[tuple[int, int], Sighting]]:
    """What ``player`` sees now: a ``Sighting`` of this tick for every node and every half of an
    edge not in fog.

    Returns ``(nodes, halves)``: nodes by id, halves by ``(edge, node)``, in ascending order. A
    half counts the enemy groups in it, those in a fight too (DEC-33, detail 6). Used by the
    ``vision`` system for the fog memory and by the projection (SIM-14) for the places in sight.
    """
    mapdef = state.map
    at_node: dict[int, list[Group]] = {}
    on_half: dict[tuple[int, int], list[Group]] = {}
    for gid in sorted(state.groups):
        group = state.groups[gid]
        if group.owner == player:
            continue
        match group.location:
            case AtNode(node=node):
                at_node.setdefault(node, []).append(group)
            case OnEdge() as loc:
                on_half.setdefault((loc.edge, half_node(mapdef, loc)), []).append(group)
    tick = state.tick
    empty = {  # one shared sighting per level for the places without enemies
        level: _sighting(rules, tick, level, [])
        for level in (Detail.EXACT, Detail.RANGE, Detail.PRESENCE)
    }
    nodes: dict[int, Sighting] = {}
    for n, level in enumerate(levels.nodes):
        if level is not Detail.FOG:
            here = at_node.get(n)
            nodes[n] = empty[level] if here is None else _sighting(rules, tick, level, here)
    halves: dict[tuple[int, int], Sighting] = {}
    node_levels = levels.nodes
    for e in mapdef.edges:
        for n in (e.a, e.b):
            level = node_levels[n]
            if level is not Detail.FOG:
                here = on_half.get((e.id, n))
                halves[e.id, n] = (
                    empty[level] if here is None else _sighting(rules, tick, level, here)
                )
    return nodes, halves


def known_roads(state: GameState, player: int, levels: Vision) -> tuple[int, ...]:
    """Road levels as ``player`` knows them (DEC-17; DEC-22, item 8).

    ``result[edge_id]``: exact for edges not in fog; for a fogged edge that of its last
    sighting, else ``base_width`` of the map (level 1). Never above the true level.
    """
    memory = state.vision_memory[player].widths
    roads: list[int] = []
    for e, level in enumerate(levels.edges):
        if level is not Detail.FOG:
            roads.append(state.edges[e].width)
        else:
            roads.append(memory.get(e, state.map.edges[e].base_width))
    return tuple(roads)


def units_range(rules: Ruleset, units: int) -> tuple[int, int | None] | None:
    """The range shown for ``units`` on the ``RANGE`` level; ``None`` for 0 (no enemy)."""
    return rules.vision.range_of(units) if units > 0 else None


def _sighting(rules: Ruleset, tick: int, level: Detail, enemies: list[Group]) -> Sighting:
    modes: list[Mode] = sorted(dict.fromkeys(g.mode for g in enemies))  # distinct, sorted
    units = sum(g.units for g in enemies)
    exact = level is Detail.EXACT
    return Sighting(
        tick=tick,
        level=level,
        enemy_modes=tuple(modes),
        enemy_units=units if exact else None,
        enemy_charged=sum(g.charged for g in enemies) if exact else None,
        enemy_range=units_range(rules, units) if level is Detail.RANGE else None,
    )
