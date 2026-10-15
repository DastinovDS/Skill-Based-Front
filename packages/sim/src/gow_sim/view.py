"""Projection (SIM-14): ``project()`` builds the ``PlayerView``, the only thing a player sees.

``PlayerView`` is everything that leaves the simulation towards a player or a bot (AGENTS.md,
section 4.4); bots get the same view as people. It follows DEC-04 and DEC-17 (mechanics.md,
section 10) and has the shape of the wire ``View`` of the protocol (``gow_protocol.view``,
PRO-01), which PRO-03 converts it into:

- public to everyone: ownership of every node, VP of both players, intents of planned orders
  and «Защита» (kind, origin, target; no group id or size);
- node capacities: fixed by the node kind (DEC-22, item 1), public and exact for every node;
- road levels and types (DEC-17; DEC-22, item 8): exact on edges not in fog; on a fogged edge
  those of its last sighting, or level 1 without a type if never seen;
- road builds of cities (DEC-16, item 8): own ones always, with the tick they finish; an enemy
  one (the city and the edge, no tick) only while the edge is not in fog (DEC-17, item 5);
- ``EXACT`` places (own nodes, nodes where own groups stand): warehouse and enemy totals;
- own cities: their supply priority (DEC-18, item 8) and, cut off, the ticks until the garrison
  next starves (``starve_in``, DEC-19, item 8), their recruit queue and its progress (DEC-25,
  item 12); own packets with their remaining path and whether they are a transfer;
- ``PRESENCE`` places (neighbours of ``EXACT`` nodes, edges touching them): whether enemy groups
  are there and their modes, no numbers;
- ``FOG``: only the last sighting from ``GameState.vision_memory``;
- fights going on (DEC-24, item I1): both players fight in each, so both see it with the exact
  units and charged of the enemy in it; the enemy's virtual shots and group ids stay hidden.

What a view never has: enemy groups as entities (only the per-place ``Sighting``), road levels
and types of fogged edges newer than the last sighting, enemy builds on fogged edges, enemy packets
(#112 default), enemy CP, stance, production and counters, supply priorities of enemy cities and
enemy transfers (DEC-18, item 8), events, the target of an enemy's normal order (normal orders have
no intent), sequential ids.

Ids of own groups, own packets and intents are opaque per player: keyed blake2b of
``(player, internal id)`` with the secret ``match_key`` of the match (``opaque_id``). They are
63-bit integers, not sequential and not recoverable without the key; on the wire PRO-03 writes
them in decimal (at most 19 digits, inside the pattern ``[A-Za-z0-9_-]{1,32}`` of PRO-01).
``resolve()`` maps the opaque ids of a command back to internal ids.

``rules`` and ``match_key`` are not part of ``GameState``, so ``project()`` and ``resolve()`` take
them as arguments besides the ``(state, player[, cmd])`` of AGENTS.md.
"""

import hashlib
from collections.abc import Callable
from dataclasses import dataclass
from typing import Final

from gow_sim.canonical import digest
from gow_sim.commands import Command, map_group_ids
from gow_sim.maps import PLAYERS
from gow_sim.ruleset import Ruleset, Stance
from gow_sim.state import (
    AtNode,
    Detail,
    GameState,
    IntentKind,
    Location,
    Mode,
    OnEdge,
    Priority,
    RoadKind,
    Sighting,
)
from gow_sim.systems.build import RoadGain, UpgradeGain, done_tick, upgrade_gain
from gow_sim.systems.capacity import node_capacities, overflow_countdown, starve_in
from gow_sim.systems.movement import reachable
from gow_sim.systems.recruit import recruit_waiting
from gow_sim.systems.supply import is_city, packet_dest_tick, packet_path
from gow_sim.systems.vision import compute_vision, current_sightings, known_roads

__all__ = [
    "MATCH_KEY_MAX",
    "MATCH_KEY_MIN",
    "AtNode",
    "BuildView",
    "Detail",
    "EdgeView",
    "FightView",
    "GroupView",
    "IntentKind",
    "IntentView",
    "Location",
    "Mode",
    "NodeView",
    "OnEdge",
    "OrderView",
    "PacketView",
    "PlayerView",
    "Priority",
    "Reach",
    "RoadGain",
    "RoadKind",
    "SelfView",
    "Sighting",
    "Stance",
    "UpgradeGain",
    "check_match_key",
    "opaque_id",
    "project",
    "reach",
    "resolve",
    "view_hash",
    "view_to_canonical",
]

MATCH_KEY_MIN: Final = 16
"""Shortest accepted ``match_key`` in bytes: a secret must not be guessable."""
MATCH_KEY_MAX: Final = 64
"""Longest ``match_key`` in bytes: the key limit of blake2b."""

_OPAQUE_PERSON: Final = b"gow-opaque-id"
"""blake2b personalization: opaque ids never equal other keyed digests of the same key."""


# View types ----------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class SelfView:
    """Own counters; the enemy's CP and stance are never in a view."""

    cp: int
    """Command points in hundredths."""
    stance: Stance


@dataclass(frozen=True, slots=True)
class BuildView:
    """A road level a city builds (DEC-16, item 8)."""

    edge: int
    done_tick: int | None
    """The tick the level grows; only for an own build."""


@dataclass(frozen=True, slots=True)
class NodeView:
    id: int
    owner: int | None
    capacity: int
    """Capacity by the node kind (DEC-22, item 1): public and exact."""
    detail: Detail
    warehouse: int | None
    """Charges in the warehouse; only for ``EXACT`` nodes."""
    seen: Sighting | None
    """This tick's sighting for ``EXACT`` and ``PRESENCE``; for ``FOG`` the last one or ``None``."""
    build: BuildView | None
    """The city's road build: own always, an enemy one only while its edge is not in fog."""
    attrition_in: int | None
    """Own node only: ticks until the next unit dies of overcrowding (the garrison exceeds the
    capacity and the grace after a capture is over); ``None`` otherwise, always for the enemy's
    and neutral nodes (AGENTS.md, section 4.4)."""
    grace_left: int | None
    """Own node only: ticks the grace after a capture still lasts while the garrison exceeds the
    capacity; ``None`` otherwise."""
    priority: Priority | None
    """Own city only: its supply priority (DEC-18); ``None`` for provinces, the enemy's and
    neutral nodes."""
    starve_in: int | None
    """Own cut-off city only: ticks until its garrison next starves (DEC-19, item 8, grace
    included); ``None`` otherwise, always for the enemy's and neutral nodes."""
    recruit_queue: int | None
    """Own city only: units in its recruit queue, the one in production included (DEC-25, item
    12); ``None`` for provinces, the enemy's and neutral nodes: the enemy's production is hidden."""
    recruit_progress: int | None
    """Own city only: ticks of production of the current unit, ``0..recruit.unit_ticks``."""
    recruit_waiting: bool | None
    """Own city only: the current unit is ready and waits for a place (DEC-25, item 7)."""


@dataclass(frozen=True, slots=True)
class EdgeView:
    id: int
    width: int
    """Road level the player knows (DEC-17, DEC-22): the current one unless ``detail`` is ``FOG``;
    in fog the level of the last sighting, or level 1 if never seen. Never above the true one."""
    kind: RoadKind
    """Road type the player knows, by the same rule as ``width`` (DEC-22, item 8)."""
    detail: Detail
    """``PRESENCE`` or ``FOG``: DEC-04 never shows numbers on edges."""
    upgrade_gain: UpgradeGain | None
    """Only for own internal edges below ``max_width`` (DEC-22, item 7)."""
    seen: Sighting | None


@dataclass(frozen=True, slots=True)
class OrderView:
    """Current order of an own group."""

    dest: int
    path: tuple[int, ...]
    """Remaining nodes to ``dest``, the next one first, ``dest`` included."""
    planned: bool
    depart_tick: int
    """Not before this tick the group leaves its node (a planned order waits, DEC-08)."""


@dataclass(frozen=True, slots=True)
class GroupView:
    """An own group. Enemy groups appear only in the ``seen`` of places."""

    id: int
    """Opaque id."""
    units: int
    charged: int
    mode: Mode
    location: Location
    order: OrderView | None


@dataclass(frozen=True, slots=True)
class PacketView:
    """Own charges on the way (mechanics.md, section 7; DEC-18, item 5)."""

    id: int
    """Opaque id."""
    edge: int
    """The current edge, travelled away from ``from_node`` during ``depart_tick..arrive_tick``."""
    from_node: int
    charges: int
    depart_tick: int
    arrive_tick: int
    path: tuple[int, ...]
    """The nodes still to reach, the end of ``edge`` first, the destination last."""
    dest_tick: int
    """The tick the packet reaches the destination if nothing stops it."""
    transfer: bool
    """A one-off ``Transfer`` (DEC-18, item 6), not the automatic dispatch."""


@dataclass(frozen=True, slots=True)
class IntentView:
    """Public part of a planned order or «Защита»: no group id and no group size."""

    id: int
    """Opaque id."""
    owner: int
    kind: IntentKind
    origin: int
    target: int | None
    created_tick: int


@dataclass(frozen=True, slots=True)
class FightView:
    """A fight going on (DEC-24, item I1). A fight always has groups of both players, so both see
    it, with the exact counters of the enemy in it, also on an edge where own groups give no
    vision (#112). The enemy's virtual shots (bonuses, terrain) and group ids are hidden."""

    id: int
    """Opaque id (``fight`` in the fight events)."""
    node: int | None
    edge: int | None
    point: int | None
    """On an edge: twice the meeting position in thousandths from the end ``a`` (0..2000), so the
    mark sits at ``point / 2000`` of the edge from ``a`` (item C3); ``None`` in a node."""
    attacker: int | None
    """The player attacking the node; ``None`` on an edge and in a neutral node."""
    start_tick: int
    next_round_tick: int
    groups: tuple[int, ...]
    """Opaque ids of the own groups in the fight, sorted."""
    enemy_units: int
    enemy_charged: int


@dataclass(frozen=True, slots=True)
class PlayerView:
    """What ``player`` knows at ``tick``. Groups, packets and intents are sorted by opaque id."""

    tick: int
    player: int
    me: SelfView
    vp: tuple[int, ...]
    """VP of both players, by player id; public (DEC-04)."""
    nodes: tuple[NodeView, ...]
    """Every node of the map, ``nodes[i].id == i``."""
    edges: tuple[EdgeView, ...]
    """Every edge of the map, ``edges[i].id == i``."""
    groups: tuple[GroupView, ...]
    """Own groups only."""
    packets: tuple[PacketView, ...]
    """Own packets only (enemy packets are never visible, #112 default)."""
    intents: tuple[IntentView, ...]
    """Intents of both players."""
    fights: tuple[FightView, ...] = ()
    """Fights going on (DEC-24): every fight has own groups, so all of them; sorted by opaque id."""


# Opaque ids ----------------------------------------------------------------------------------


def check_match_key(match_key: bytes) -> None:
    """Raise ``ValueError`` unless ``match_key`` is ``MATCH_KEY_MIN..MATCH_KEY_MAX`` bytes."""
    if not MATCH_KEY_MIN <= len(match_key) <= MATCH_KEY_MAX:
        raise ValueError(f"match_key must be {MATCH_KEY_MIN}..{MATCH_KEY_MAX} bytes")


def _hasher(match_key: bytes) -> Callable[[int, int], int]:
    check_match_key(match_key)
    base = hashlib.blake2b(key=match_key, digest_size=8, person=_OPAQUE_PERSON)

    def opaque(player: int, internal: int) -> int:
        h = base.copy()
        h.update(player.to_bytes(1, "big") + internal.to_bytes(8, "big"))
        return int.from_bytes(h.digest(), "big") >> 1  # 63 bits: non-negative

    return opaque


def opaque_id(match_key: bytes, player: int, internal: int) -> int:
    """Opaque id of the group, packet or intent ``internal`` for ``player``.

    Keyed blake2b of ``(player, internal)``; groups, packets and intents share one id counter
    (``GameState.next_id``), so the id alone names the entity. PRO-03 uses it for entity ids in
    events.
    """
    return _hasher(match_key)(player, internal)


def resolve(state: GameState, player: int, cmd: Command, match_key: bytes) -> Command:
    """``cmd`` with the opaque group ids of ``player`` replaced by internal ids.

    Only own groups resolve: an opaque id that names no own group (unknown, stale, or anything
    else) becomes a negative id absent from the state, which ``validate()`` rejects as
    ``NOT_FOUND_OR_HIDDEN``. Distinct unknown ids stay distinct, so a repeated id in ``Merge`` is
    still ``INVALID_ARGUMENT``. Shared by the server and ``run_headless``.
    """
    opaque = _hasher(match_key)
    table: dict[int, int] = {}
    missing: dict[int, int] = {}
    groups = state.groups
    for gid in sorted(groups):
        if groups[gid].owner == player:
            table[opaque(player, gid)] = gid

    def internal(oid: int) -> int:
        found = table.get(oid)
        if found is not None:
            return found
        return missing.setdefault(oid, -1 - len(missing))

    return map_group_ids(cmd, internal)


@dataclass(frozen=True, slots=True)
class Reach:
    """Where an own standing group can be ordered to (DEC-20, D5; DEC-22, item 10).

    The interface highlights ``nodes`` and shows their travel time; it never computes either.
    Ownership of the own nodes is all the search reads besides the public map and ruleset, so
    the answer shows nothing a ``Move`` and its ``ack`` would not.
    """

    group: int
    """Opaque id of the group."""
    nodes: tuple[tuple[int, int], ...]
    """``(node, ticks)`` by node id: the nodes a ``Move`` of the group accepts now, with the
    ticks of the path once the group departs (``movement.path_ticks``)."""
    split: tuple[int, ...]
    """Nodes a ``Move`` rejects with ``STACK_LIMIT``: reachable only by a smaller group."""


def reach(
    state: GameState, rules: Ruleset, player: int, group: int, match_key: bytes
) -> Reach | None:
    """The ``Reach`` of the own group with opaque id ``group`` standing in a node, else ``None``
    (unknown, foreign, hidden or on an edge: one answer for all, as ``NOT_FOUND_OR_HIDDEN``)."""
    opaque = _hasher(match_key)
    for gid in sorted(state.groups):
        g = state.groups[gid]
        if g.owner == player and opaque(player, gid) == group:
            if not isinstance(g.location, AtNode):
                return None
            start = g.location.node
            fits = reachable(state, rules, player, start, size=g.units)
            every = reachable(state, rules, player, start)
            return Reach(
                group=group,
                nodes=tuple(fits.items()),
                split=tuple(n for n in every if n not in fits),
            )
    return None


# Projection ----------------------------------------------------------------------------------


def project(state: GameState, rules: Ruleset, player: int, match_key: bytes) -> PlayerView:
    """The view of ``player`` on ``state`` (DEC-04, DEC-17). A pure function: never writes."""
    opaque = _hasher(match_key)
    mapdef = state.map
    levels = compute_vision(state, player)
    now_nodes, now_edges = current_sightings(state, player, levels)
    memory = state.vision_memory[player]
    roads = known_roads(state, player, levels)
    capacities = node_capacities(state, rules)

    nodes: list[NodeView] = []
    for n, level in enumerate(levels.nodes):
        node = state.nodes[n]
        own_city = node.owner == player and is_city(mapdef, n)
        attrition_in, grace_left = (
            overflow_countdown(state, rules, n, capacities[n])
            if node.owner == player
            else (None, None)
        )
        nodes.append(
            NodeView(
                id=n,
                owner=node.owner,
                capacity=capacities[n],
                detail=level,
                warehouse=node.warehouse if level is Detail.EXACT else None,
                seen=now_nodes[n] if level is not Detail.FOG else memory.nodes.get(n),
                build=_build_view(state, rules, player, n, levels.edges),
                attrition_in=attrition_in,
                grace_left=grace_left,
                priority=node.priority if own_city else None,
                starve_in=starve_in(state, rules, n) if node.owner == player else None,
                recruit_queue=node.recruit_queue if own_city else None,
                recruit_progress=node.recruit_progress if own_city else None,
                recruit_waiting=recruit_waiting(state, rules, n) if own_city else None,
            )
        )

    edges: list[EdgeView] = []
    for e, level in enumerate(levels.edges):
        edef = mapdef.edges[e]
        own = state.nodes[edef.a].owner == player and state.nodes[edef.b].owner == player
        edges.append(
            EdgeView(
                id=e,
                width=roads[e][0],
                kind=roads[e][1],
                detail=level,
                upgrade_gain=upgrade_gain(state, rules, e) if own else None,
                seen=now_edges[e] if level is not Detail.FOG else memory.edges.get(e),
            )
        )

    groups: list[GroupView] = []
    for gid in sorted(state.groups):
        g = state.groups[gid]
        if g.owner != player:
            continue
        order = g.order
        groups.append(
            GroupView(
                id=opaque(player, gid),
                units=g.units,
                charged=g.charged,
                mode=g.mode,
                location=g.location,
                order=None
                if order is None or not order.path
                else OrderView(order.path[-1], order.path, order.planned, order.depart_tick),
            )
        )

    packets = [
        PacketView(
            id=opaque(player, pid),
            edge=p.edge,
            from_node=p.from_node,
            charges=p.charges,
            depart_tick=p.depart_tick,
            arrive_tick=p.arrive_tick,
            path=packet_path(state, p),
            dest_tick=packet_dest_tick(p),
            transfer=p.transfer,
        )
        for pid, p in sorted(state.packets.items())
        if p.owner == player
    ]

    intents = [
        IntentView(
            id=opaque(player, iid),
            owner=i.owner,
            kind=i.kind,
            origin=i.origin,
            target=i.target,
            created_tick=i.created_tick,
        )
        for iid, i in sorted(state.intents.items())
    ]

    fights: list[FightView] = []
    for fid, f in sorted(state.fights.items()):
        mine: list[int] = []
        units = charged = 0
        for gid in sorted(f.members):
            g = state.groups.get(gid)
            if g is None:
                continue
            if g.owner == player:
                mine.append(opaque(player, gid))
            else:
                units += g.units
                charged += g.charged
        fights.append(
            FightView(
                id=opaque(player, fid),
                node=f.node,
                edge=f.edge,
                point=f.point,
                attacker=f.attacker,
                start_tick=f.start,
                next_round_tick=f.next_round,
                groups=tuple(sorted(mine)),
                enemy_units=units,
                enemy_charged=charged,
            )
        )

    me = state.players[player]
    return PlayerView(
        tick=state.tick,
        player=player,
        me=SelfView(cp=me.cp, stance=me.stance),
        vp=tuple(state.players[p].vp for p in PLAYERS),
        nodes=tuple(nodes),
        edges=tuple(edges),
        # Sorted by opaque id: the order says nothing about creation order or internal ids.
        groups=tuple(sorted(groups, key=lambda v: v.id)),
        packets=tuple(sorted(packets, key=lambda v: v.id)),
        intents=tuple(sorted(intents, key=lambda v: v.id)),
        fights=tuple(sorted(fights, key=lambda v: v.id)),
    )


def _build_view(
    state: GameState, rules: Ruleset, player: int, node: int, edge_levels: tuple[Detail, ...]
) -> BuildView | None:
    b = state.nodes[node].build
    if b is None:
        return None
    if b.owner == player:
        return BuildView(edge=b.edge, done_tick=done_tick(rules, b))
    if edge_levels[b.edge] is Detail.FOG:  # not shown and not remembered (DEC-17, item 5)
        return None
    return BuildView(edge=b.edge, done_tick=None)


# Canonical form ------------------------------------------------------------------------------


def view_hash(view: PlayerView) -> str:
    """blake2b of the canonical JSON of the view: equal views give equal hashes in any process."""
    return digest(view_to_canonical(view))


def view_to_canonical(view: PlayerView) -> dict[str, object]:
    """The view as plain JSON data (canonical JSON, no floats)."""
    return {
        "tick": view.tick,
        "player": view.player,
        "me": {"cp": view.me.cp, "stance": view.me.stance.value},
        "vp": list(view.vp),
        "nodes": [
            {
                "id": n.id,
                "owner": n.owner,
                "capacity": n.capacity,
                "detail": n.detail.value,
                "warehouse": n.warehouse,
                "seen": _seen_data(n.seen),
                "build": None
                if n.build is None
                else {"edge": n.build.edge, "done_tick": n.build.done_tick},
                "attrition_in": n.attrition_in,
                "grace_left": n.grace_left,
                "priority": None if n.priority is None else n.priority.value,
                "starve_in": n.starve_in,
                "recruit_queue": n.recruit_queue,
                "recruit_progress": n.recruit_progress,
                "recruit_waiting": n.recruit_waiting,
            }
            for n in view.nodes
        ],
        "edges": [
            {
                "id": e.id,
                "width": e.width,
                "kind": e.kind.value,
                "detail": e.detail.value,
                "upgrade_gain": None
                if e.upgrade_gain is None
                else {
                    "fast": _gain_data(e.upgrade_gain.fast),
                    "freight": _gain_data(e.upgrade_gain.freight),
                },
                "seen": _seen_data(e.seen),
            }
            for e in view.edges
        ],
        "groups": [
            {
                "id": g.id,
                "units": g.units,
                "charged": g.charged,
                "mode": g.mode.value,
                "location": _location_data(g.location),
                "order": None
                if g.order is None
                else {
                    "dest": g.order.dest,
                    "path": list(g.order.path),
                    "planned": g.order.planned,
                    "depart_tick": g.order.depart_tick,
                },
            }
            for g in view.groups
        ],
        "packets": [
            {
                "id": p.id,
                "edge": p.edge,
                "from_node": p.from_node,
                "charges": p.charges,
                "depart_tick": p.depart_tick,
                "arrive_tick": p.arrive_tick,
                "path": list(p.path),
                "dest_tick": p.dest_tick,
                "transfer": p.transfer,
            }
            for p in view.packets
        ],
        "intents": [
            {
                "id": i.id,
                "owner": i.owner,
                "kind": i.kind.value,
                "origin": i.origin,
                "target": i.target,
                "created_tick": i.created_tick,
            }
            for i in view.intents
        ],
        "fights": [
            {
                "id": f.id,
                "node": f.node,
                "edge": f.edge,
                "point": f.point,
                "attacker": f.attacker,
                "start_tick": f.start_tick,
                "next_round_tick": f.next_round_tick,
                "groups": list(f.groups),
                "enemy_units": f.enemy_units,
                "enemy_charged": f.enemy_charged,
            }
            for f in view.fights
        ],
    }


def _gain_data(g: RoadGain | None) -> dict[str, object] | None:
    return None if g is None else {"speed_pct": g.speed_pct, "amount": g.amount}


def _seen_data(s: Sighting | None) -> dict[str, object] | None:
    if s is None:
        return None
    return {
        "tick": s.tick,
        "level": s.level.value,
        "enemy_modes": [m.value for m in s.enemy_modes],
        "enemy_units": s.enemy_units,
        "enemy_charged": s.enemy_charged,
        "width": s.width,
        "road": None if s.road is None else s.road.value,
    }


def _location_data(loc: Location) -> dict[str, object]:
    match loc:
        case AtNode(node=node):
            return {"kind": "node", "node": node}
        case OnEdge(edge=edge, from_node=from_node, progress=progress, back=back):
            return {
                "kind": "edge",
                "edge": edge,
                "from_node": from_node,
                "progress": progress,
                "back": back,
            }
