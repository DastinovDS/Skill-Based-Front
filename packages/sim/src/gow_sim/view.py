"""Projection (SIM-14): ``project()`` builds the ``PlayerView``, the only thing a player sees.

``PlayerView`` is everything that leaves the simulation towards a player or a bot (AGENTS.md,
section 4.4); bots get the same view as people. It follows DEC-04 (mechanics.md, section 10) and
has the shape of the wire ``View`` of the protocol (``gow_protocol.view``, PRO-01), which PRO-03
converts it into:

- public to everyone: ownership and capacity of every node, road widths, VP of both players,
  intents of planned orders, «Защита» and builds (kind, origin, target; no group id or size);
- ``EXACT`` places (own nodes, nodes where own groups stand): warehouse and enemy totals;
- ``PRESENCE`` places (neighbours of ``EXACT`` nodes, edges touching them): whether enemy groups
  are there and their modes, no numbers;
- ``FOG``: only the last sighting from ``GameState.vision_memory``.

What a view never has: enemy groups as entities (only the per-place ``Sighting``), enemy packets
(#112 default), enemy CP, stance, production and counters, events, the target of an enemy's normal
order (normal orders have no intent), sequential ids.

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
    Sighting,
)
from gow_sim.systems.build import UpgradeGain, upgrade_gain
from gow_sim.systems.capacity import node_capacities
from gow_sim.systems.vision import compute_vision, current_sightings

__all__ = [
    "MATCH_KEY_MAX",
    "MATCH_KEY_MIN",
    "AtNode",
    "Detail",
    "EdgeView",
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
    "SelfView",
    "Sighting",
    "Stance",
    "UpgradeGain",
    "check_match_key",
    "opaque_id",
    "project",
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
class NodeView:
    id: int
    owner: int | None
    capacity: int
    """Current capacity of the city; public for every node (DEC-04)."""
    detail: Detail
    warehouse: int | None
    """Charges in the warehouse; only for ``EXACT`` nodes."""
    seen: Sighting | None
    """This tick's sighting for ``EXACT`` and ``PRESENCE``; for ``FOG`` the last one or ``None``."""


@dataclass(frozen=True, slots=True)
class EdgeView:
    id: int
    width: int
    """Current width; public for every edge (DEC-04)."""
    detail: Detail
    """``PRESENCE`` or ``FOG``: DEC-04 never shows numbers on edges."""
    upgrade_gain: UpgradeGain | None
    """Only for own internal edges below ``max_width`` (SIM-11)."""
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
    build_edge: int | None
    """Edge the group upgrades in «Строительство» (SIM-11), else ``None``."""


@dataclass(frozen=True, slots=True)
class PacketView:
    """Own charges on the way (mechanics.md, section 7)."""

    id: int
    """Opaque id."""
    edge: int
    from_node: int
    charges: int
    depart_tick: int
    arrive_tick: int


@dataclass(frozen=True, slots=True)
class IntentView:
    """Public part of a planned order, «Защита» or a build: no group id and no group size."""

    id: int
    """Opaque id."""
    owner: int
    kind: IntentKind
    origin: int
    target: int | None
    created_tick: int


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


# Projection ----------------------------------------------------------------------------------


def project(state: GameState, rules: Ruleset, player: int, match_key: bytes) -> PlayerView:
    """The view of ``player`` on ``state`` (DEC-04). A pure function: reads, never writes.

    Node capacities come from ``node_capacities``, which may refresh the derived
    ``capacity_cache`` of the state; the cache is not part of the state (SIM-07).
    """
    opaque = _hasher(match_key)
    mapdef = state.map
    levels = compute_vision(state, player)
    now_nodes, now_edges = current_sightings(state, player, levels)
    memory = state.vision_memory[player]
    capacities = node_capacities(state, rules)

    nodes: list[NodeView] = []
    for n, level in enumerate(levels.nodes):
        node = state.nodes[n]
        nodes.append(
            NodeView(
                id=n,
                owner=node.owner,
                capacity=capacities[n],
                detail=level,
                warehouse=node.warehouse if level is Detail.EXACT else None,
                seen=now_nodes[n] if level is not Detail.FOG else memory.nodes.get(n),
            )
        )

    edges: list[EdgeView] = []
    for e, level in enumerate(levels.edges):
        edef = mapdef.edges[e]
        own = state.nodes[edef.a].owner == player and state.nodes[edef.b].owner == player
        edges.append(
            EdgeView(
                id=e,
                width=state.edges[e].width,
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
                build_edge=g.build_edge,
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
    )


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
            }
            for n in view.nodes
        ],
        "edges": [
            {
                "id": e.id,
                "width": e.width,
                "detail": e.detail.value,
                "upgrade_gain": None
                if e.upgrade_gain is None
                else {
                    "capacity_centi": e.upgrade_gain.capacity_centi,
                    "packet_speed_pct": e.upgrade_gain.packet_speed_pct,
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
                "build_edge": g.build_edge,
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
    }


def _seen_data(s: Sighting | None) -> dict[str, object] | None:
    if s is None:
        return None
    return {
        "tick": s.tick,
        "level": s.level.value,
        "enemy_modes": [m.value for m in s.enemy_modes],
        "enemy_units": s.enemy_units,
        "enemy_charged": s.enemy_charged,
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
