"""Vision (SIM-03; DEC-21, DEC-33, DEC-35): detail levels by terrain, halves of edges, the fog
memory.

DEC-21 with the sources of DEC-35 (mechanics.md, section 10):

- sources of vision are own groups only (DEC-35): a node where an own group stands, and the node
  of the half of its edge an own group on an edge is in (``source_node``; a group in a fight on an
  edge by the half of the fight point, DEC-35, detail 6). An own node without an own group is not
  a source. A source is ``EXACT``; own packets give no vision;
- a node next to a source gets the level of the pair «terrain of the source -> terrain of the
  node» from ``vision.by_terrain`` (``EXACT``, ``RANGE`` or ``PRESENCE``); with several sources
  around, the best one. Any other node is ``FOG``. These levels (``Vision.zones``) are the levels
  of the halves of a node's edges (DEC-33, item 1);
- an own node is never in fog for the enemy groups in it: its level (``Vision.nodes``) is the
  better of its zone level and ``PRESENCE`` (DEC-35, detail 3). That ``PRESENCE`` is a level of
  the node only: it gives no zone and no levels to the neighbours (detail 4);
- an edge is split by its border point ``border_permille`` into the half of ``a`` and the half of
  ``b``; a half is seen with the zone level of its node (a source's half is ``EXACT``), so a half of
  a visible node is seen even when the edge has no source at either end (DEC-33, item 1). A group
  belongs to the half of the node it goes to once it is on the border point or past it, else to
  the half of the other end (``half_node``);
- what a place shows of the enemy groups in it (``Sighting``): ``EXACT`` the total units and
  charged and the modes, ``RANGE`` the range of the total units (``vision.range_starts``) and the
  modes, ``PRESENCE`` the modes only (every group attacks, so the modes say whether enemies are
  there).

The edge level of DEC-17 (``Vision.edges``): an edge is not in fog while at least one of its ends
is a source (the edge of an own group on it is one, its end in the group's half is a source,
DEC-35, detail 7).

Public to everyone regardless of level: geography, terrain, the map, ownership of all nodes, VP,
intents of planned orders. That part is the projection's job (SIM-14).

``is_visible()`` is the single visibility check for command validation (SIM-04) and the
projection (SIM-14). ``vision()`` is the last system of a tick and refreshes the fog memory.
"""

from dataclasses import dataclass
from typing import Final

from gow_sim.maps import MapDef
from gow_sim.ruleset import Ruleset, VisionRules
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

    ``nodes[node_id]``: the level of the enemy groups standing in the node: its zone level, at
    least ``PRESENCE`` for an own node (DEC-35, detail 3). ``zones[node_id]``: the level by the
    sources and the terrain table (DEC-21, items 1 and 2), also the level of the node's halves of
    edges (``half``); an own node without a source gets none (DEC-35, detail 4).
    ``edges[edge_id]``: the edge visibility of DEC-17: ``PRESENCE`` while at least one end is a
    source, else ``FOG``. ``sources[node_id]``: the node is a source of vision.
    ``stands[node_id]``: an own group really stands in the node, so the warehouse of a foreign
    city there is seen (DEC-21, item 3; DEC-35, detail 2).
    """

    nodes: tuple[Detail, ...]
    edges: tuple[Detail, ...]
    zones: tuple[Detail, ...] = ()
    sources: tuple[bool, ...] = ()
    stands: tuple[bool, ...] = ()

    def half(self, node: int) -> Detail:
        """The level of a half of an edge that belongs to ``node``: the zone level of the node
        (DEC-21, item 5; DEC-33, item 1; DEC-35, detail 4)."""
        return self.zones[node]


def sources(state: GameState, player: int) -> tuple[list[bool], list[bool]]:
    """``(sources, stands)`` of ``player`` (DEC-35, details 1 and 2): ``sources[node]`` the node is
    a source of vision: an own group stands there or an own group on an edge is in the node's half
    of it (``source_node``); ``stands[node]`` an own group stands there. Own nodes as such and own
    packets give no vision."""
    count = len(state.map.nodes)
    source = [False] * count
    stands = [False] * count
    for gid in sorted(state.groups):
        group = state.groups[gid]
        if group.owner != player:
            continue
        match group.location:
            case AtNode(node=node):
                source[node] = stands[node] = True
            case OnEdge() as loc:
                source[source_node(state, group, loc)] = True
    return source, stands


def source_node(state: GameState, group: Group, loc: OnEdge) -> int:
    """The node an own group on an edge is a source in (DEC-35, item 3 and detail 6): the node of
    its half by the border point; for a group in a fight on the edge, the half of the fight point
    with the heading of its movement before the fight."""
    fight = state.fights.get(group.fight) if group.fight is not None else None
    if fight is None or fight.point is None:
        return half_node(state.map, loc)
    mapdef = state.map
    e = mapdef.edges[loc.edge]
    border2 = 2 * border_permille(mapdef, loc.edge)  # ``point`` is in half-thousandths
    if heading(mapdef, loc) == e.b:
        return e.b if fight.point >= border2 else e.a
    return e.a if fight.point <= border2 else e.b


def _edge_levels(mapdef: MapDef, source: list[bool]) -> tuple[Detail, ...]:
    """The road level visibility of every edge (DEC-17, item 1)."""
    return tuple(
        Detail.PRESENCE if source[e.a] or source[e.b] else Detail.FOG for e in mapdef.edges
    )


@dataclass(slots=True)
class _VisionMemo:
    """The last ``Vision`` of a player with every input it was computed from (``compute_vision``);
    ``GameState.memo``. ``table`` and ``mapdef`` are held, so ``is`` compares them safely."""

    mapdef: MapDef
    table: VisionRules
    source: list[bool]
    stands: list[bool]
    mine: list[bool]
    vision: Vision
    halves: tuple[tuple[int, int], ...]
    """The halves of edges not in fog, ``(edge, node)`` in the order of ``current_sightings``."""


_MEMO: Final = ("vision.0", "vision.1")
"""``GameState.memo`` keys of the vision memo, by player id."""


def compute_vision(state: GameState, rules: Ruleset, player: int) -> Vision:
    """Detail levels of all nodes and edges for ``player``. O(V + E + G).

    A pure function of the map, the terrain table of the ruleset, the own vision sources and
    stands (``sources``) and which nodes ``player`` owns; the last result is kept with these inputs
    in ``GameState.memo`` and returned again while they are equal (O(V + G) then)."""
    mapdef = state.map
    table = rules.vision
    source, stands = sources(state, player)
    nodes = state.nodes
    mine = [nodes[n].owner == player for n in range(len(source))]  # ids are 0..n-1
    memo = state.memo.get(_MEMO[player])
    if (
        isinstance(memo, _VisionMemo)
        and memo.mapdef is mapdef
        and memo.table is table
        and memo.source == source
        and memo.stands == stands
        and memo.mine == mine
    ):
        return memo.vision
    levels = _compute(mapdef, rules, source, stands, mine)
    halves = tuple(
        (e.id, n) for e in mapdef.edges for n in (e.a, e.b) if levels.zones[n] is not Detail.FOG
    )
    state.memo[_MEMO[player]] = _VisionMemo(mapdef, table, source, stands, mine, levels, halves)
    return levels


def _compute(
    mapdef: MapDef, rules: Ruleset, source: list[bool], stands: list[bool], mine: list[bool]
) -> Vision:
    """``compute_vision`` without the memo."""
    zones = [Detail.EXACT if s else Detail.FOG for s in source]
    table = rules.vision.by_terrain
    for n, is_source in enumerate(source):
        if not is_source:
            continue
        here = mapdef.nodes[n].terrain
        for e in mapdef.incident[n]:
            m = mapdef.edges[e].other(n)
            level = Detail(table.of(here, mapdef.nodes[m].terrain).value)
            if _RANK[level] < _RANK[zones[m]]:
                zones[m] = level
    nodes = tuple(
        Detail.PRESENCE if level is Detail.FOG and mine[n] else level
        for n, level in enumerate(zones)
    )
    return Vision(
        nodes=nodes,
        edges=_edge_levels(mapdef, source),
        zones=tuple(zones),
        sources=tuple(source),
        stands=tuple(stands),
    )


def _halves_in_sight(state: GameState, player: int, levels: Vision) -> tuple[tuple[int, int], ...]:
    """The halves of edges ``levels`` does not fog, ``(edge, node)`` by edge id, then ``a``
    before ``b``: kept by the memo of ``compute_vision`` when ``levels`` is its result."""
    memo = state.memo.get(_MEMO[player])
    if isinstance(memo, _VisionMemo) and memo.vision is levels and memo.mapdef is state.map:
        return memo.halves
    return tuple(
        (e.id, n) for e in state.map.edges for n in (e.a, e.b) if levels.half(n) is not Detail.FOG
    )


def detail_level(state: GameState, rules: Ruleset, player: int, node: int) -> Detail:
    return compute_vision(state, rules, player).nodes[node]


def visible_nodes(state: GameState, rules: Ruleset, player: int) -> tuple[int, ...]:
    """Ids of the nodes not in fog, ascending."""
    levels = compute_vision(state, rules, player).nodes
    return tuple(n for n, level in enumerate(levels) if level is not Detail.FOG)


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

    - Intents (planned orders and "Defense") are public (DEC-04). Own groups and packets are
      always visible.
    - An enemy group is visible in a node not in fog (an own node is never in fog, DEC-35,
      detail 3) and in a half of an edge whose node has a zone (DEC-33, item 1; DEC-35, detail
      4); a group in a fight is visible: fights are public (DEC-24, item I1). How much of it is
      shown is the level of that place.
    - Enemy packets are never visible, on any edge (DEC-10, item 6).

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


@dataclass(frozen=True, slots=True)
class Sight:
    """What one player sees at the end of a tick, as the vision system computed it (``observe``):
    the levels and the sightings of now (``current_sightings``). ``project()`` takes it in place of
    computing the same again; it is valid only for the state it was computed on (``Match`` keeps it
    until the next step)."""

    levels: Vision
    nodes: dict[int, Sighting]
    halves: dict[tuple[int, int], Sighting]


def vision(state: GameState, rules: Ruleset) -> list[Event]:
    """Last system of a tick: record what each player sees now in ``vision_memory``
    (``observe``). Emits no events."""
    observe(state, rules)
    return []


def observe(state: GameState, rules: Ruleset) -> dict[int, Sight]:
    """The work of the ``vision`` system; returns what each player sees, by player id.

    Every node and half of an edge not in fog gets a fresh ``Sighting`` with the current tick;
    fogged ones keep their last sighting. ``spotted`` keeps the enemy groups in sight with the tick
    each came into sight (DEC-33, detail 5).
    """
    sights: dict[int, Sight] = {}
    for player in sorted(state.players):
        levels = compute_vision(state, rules, player)
        nodes, halves = current_sightings(state, rules, player, levels)
        memory = state.vision_memory[player]
        memory.nodes.update(nodes)
        memory.halves.update(halves)
        before = memory.spotted
        memory.spotted = {
            gid: before.get(gid, state.tick)
            for gid in sorted(state.groups)
            if state.groups[gid].owner != player
            and is_visible(state, rules, player, state.groups[gid], levels)
        }
        sights[player] = Sight(levels, nodes, halves)
    return sights


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
    empty: dict[Detail, Sighting] = {}  # one shared sighting per level for places without enemies
    nodes: dict[int, Sighting] = {}
    for n, level in enumerate(levels.nodes):
        if level is not Detail.FOG:
            here = at_node.get(n)
            if here is not None:
                nodes[n] = _sighting(rules, tick, level, here)
            else:
                seen = empty.get(level)
                if seen is None:
                    seen = empty[level] = _sighting(rules, tick, level, [])
                nodes[n] = seen
    halves: dict[tuple[int, int], Sighting] = {}
    zones = levels.zones
    for half in _halves_in_sight(state, player, levels):
        level = zones[half[1]]
        here = on_half.get(half)
        if here is not None:
            halves[half] = _sighting(rules, tick, level, here)
        else:
            seen = empty.get(level)
            if seen is None:
                seen = empty[level] = _sighting(rules, tick, level, [])
            halves[half] = seen
    return nodes, halves


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
