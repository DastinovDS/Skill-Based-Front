"""Projection (SIM-14): ``project()`` builds the ``PlayerView``, the only thing a player sees.

``PlayerView`` is everything that leaves the simulation towards a player or a bot (AGENTS.md,
section 4.4); bots get the same view as people. It follows DEC-04, DEC-17, DEC-21, DEC-33, DEC-10
and DEC-35 (mechanics.md, section 10) and has the shape of the wire ``View`` of the protocol
(``gow_protocol.view``, PRO-01), which PRO-03 converts it into:

- public to everyone: ownership of every node, VP of both players, intents of planned orders
  and "Defense" (kind, origin, target; no group id or size);
- node capacities: fixed by the node kind (DEC-22, item 1), public and exact for every node;
- road levels (DEC-17; DEC-22, item 8; roads have no type, DEC-26): exact on edges not in fog (an
  end is a source) and on own internal edges (own data, DEC-35, detail 5); on another fogged edge
  that of its last sighting, or level 1 if never seen;
- road builds of cities (DEC-16, item 8): own ones always, with the tick they finish; an enemy
  one (the city and the edge, no tick) only while the edge is not in fog (DEC-17, item 5);
- sources of vision (DEC-35: nodes where own groups stand, the node of the half of an edge an own
  group is in): the enemy totals like every ``EXACT`` place; the warehouse of own nodes always
  (own data) and of a foreign node only where an own group stands (DEC-35, detail 2);
- own nodes are never in fog: an enemy in an own node without a source is seen at ``PRESENCE``
  (DEC-35, detail 3), which gives the node's halves of edges no zone (detail 4);
- own front markers and rear minimum (DEC-28, ``SelfView``; never the enemy's);
- own cities: cut off, the ticks until the garrison
  next starves (``starve_in``, DEC-19, item 8), their recruit queue and its progress (DEC-25,
  item 12), the barracks, the warehouse level and capacity and the current build of any kind
  (DEC-26, item 10); own packets with their remaining path and whether they are a transfer;
- enemy cities joined by an edge of the map to any own node: whether their barracks are built
  (DEC-31; by the current owners and the public graph, no memory);
- own groups in "Defense": the bonus gathered so far and its cap (DEC-30; enemy groups show the
  mode only, in the ``seen`` of places);
- economy v2 (DEC-41, ``economy.model = "v2"``; under v1 these fields are empty or ``None``): the
  own supply lines with their paths (``lines``; the enemy's never, item 3), the own factories and
  their rates, the own bunkers, the factory and bunker builds of own nodes with the charges they
  still owe (item 7), the plan of an own gathering planned order (the requested bonus, the bonus
  gathered, the tick the next charge is due; item 10); the built factory of an enemy city and the
  built bunker of an enemy node joined by an edge to any own node (DEC-31, item 12), never an enemy
  build or an enemy line;
- neighbours of sources by the terrain table (DEC-21, item 2), and the halves of edges by the level
  of their node (item 5): ``EXACT`` the enemy totals, ``RANGE`` the range of the enemy units,
  ``PRESENCE`` whether enemy groups are there; the modes on every level;
- enemy groups on the halves of edges not in fog, each as a figure (DEC-33, ``EdgeView.
  enemy_groups``): position, direction, mode and the numbers of its half's level, with an opaque id
  that is new each time the group comes out of the fog; a group in a fight is shown by the fight;
- ``FOG``: only the last sighting from ``GameState.vision_memory`` (no positions, DEC-33);
- fights going on (DEC-24, item I1): both players fight in each, so both see it with the exact
  units and charged of the enemy in it, the shots and losses of both sides so far and the latest
  round of both sides (shots with the virtual ones apart, spent charges, losses; I1 as revised
  with DEC-29), the virtual shots still left of both sides (DEC-32, item 3) and the charges of
  both sides silent by terrain (``mute``, DEC-24 item F2, plains); the enemy's group
  ids stay hidden. Outside a fight the bonus of an enemy group (a gathered "Defense", a waiting
  planned order) is never in a view, also not for a reinforcement on its way.

What a view never has: internal ids of enemy groups, enemy groups standing in nodes as entities
(only the per-place ``Sighting``), positions or directions of enemy groups in fog, road levels
of fogged edges newer than the last sighting, the barracks of enemy cities not next to an own
node, the barracks builds, warehouse level and city builds of the enemy (DEC-26, item 10;
DEC-31), the warehouse of a foreign node where no own group stands (DEC-21, item 3; DEC-35,
detail 2), enemy builds on fogged
edges, enemy packets (on any edge, DEC-10, item 6), enemy CP, stance, production and counters,
the enemy's front markers and rear minimum (DEC-28), enemy transfers (DEC-18, item 8), the bonus
an enemy "Defense" has gathered (DEC-30, item 5), the enemy's supply lines, factory and bunker
builds, factory rates and planned-order requests (DEC-41), events, the target of an enemy's
normal order (normal orders have no intent), sequential ids.

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
    PLAN_WAIT,
    AtNode,
    Build,
    BuildKind,
    Detail,
    FactoryBuild,
    FightRound,
    GameState,
    Group,
    IntentKind,
    Location,
    Mode,
    OnEdge,
    Sighting,
)
from gow_sim.systems.build import UpgradeGain, done_tick, upgrade_gain
from gow_sim.systems.capacity import (
    node_capacities,
    overflow_countdown,
    starve_in,
    warehouse_capacity,
)
from gow_sim.systems.economy import factory_period
from gow_sim.systems.movement import reachable, reachable_paths
from gow_sim.systems.recruit import recruit_waiting
from gow_sim.systems.supply import (
    all_packet_ticks,
    is_city,
    packet_dest_tick,
    packet_path,
    transfer_route,
)
from gow_sim.systems.vision import (
    Vision,
    compute_vision,
    current_sightings,
    edge_pos,
    half_node,
    heading,
    known_roads,
    units_range,
)

__all__ = [
    "MATCH_KEY_MAX",
    "MATCH_KEY_MIN",
    "AtNode",
    "BuildKind",
    "BuildView",
    "BuildingView",
    "Detail",
    "EdgeView",
    "EnemyGroupView",
    "FightRound",
    "FightView",
    "GroupView",
    "HalfView",
    "IntentKind",
    "IntentView",
    "LineView",
    "Location",
    "Mode",
    "NodeView",
    "OnEdge",
    "OrderView",
    "PacketView",
    "PlayerView",
    "Reach",
    "SelfView",
    "Sighting",
    "SiteBuildView",
    "Stance",
    "UpgradeGain",
    "check_match_key",
    "line_route",
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
_FIGURE_PERSON: Final = b"gow-enemy-figure"
"""blake2b personalization of the ids of enemy figures (DEC-33, detail 5)."""


# View types ----------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class SelfView:
    """Own counters; the enemy's CP and stance are never in a view."""

    cp: int
    """Command points in hundredths."""
    stance: Stance
    fronts: tuple[int | None, ...] = ()
    """The cities of the own front markers (DEC-28, item 2; ``supply.front_markers`` of them),
    ``None``: not placed."""
    rear_min: int = 0
    """The own rear minimum (DEC-28, item 3)."""
    auto_lines: bool | None = None
    """Economy v2: whether the own lines extend to captured cities by themselves (#665, the
    player's ``SetAutoLines``); ``None`` under v1. The enemy's toggle is never in a view."""


@dataclass(frozen=True, slots=True)
class BuildView:
    """A road level being built on an edge (DEC-28, item 7; visibility: DEC-16, item 8)."""

    done_tick: int | None
    """The tick the level grows; only for an own build."""


@dataclass(frozen=True, slots=True)
class BuildingView:
    """The current build of an own city, of any kind (DEC-26, item 10)."""

    kind: BuildKind
    done_tick: int | None
    """The tick it ends, if nothing interrupts it; ``None`` while it still owes charges (economy
    v2, DEC-41, item 7: the build time starts in the tick of the full payment)."""
    owed: int = 0
    """Economy v2 (DEC-41, item 7): the charges the build still has to take from the city and
    its groups; always 0 under v1."""


@dataclass(frozen=True, slots=True)
class SiteBuildView:
    """A factory (DEC-41, item 2) or a bunker (item 12) being built in an own node."""

    done_tick: int | None
    """The tick it is done, if nothing interrupts it; ``None`` while ``owed`` is above 0."""
    owed: int
    """The charges still to pay (the progressive payment of item 7)."""


@dataclass(frozen=True, slots=True)
class NodeView:
    id: int
    owner: int | None
    capacity: int
    """Capacity by the node kind (DEC-22, item 1): public and exact."""
    detail: Detail
    warehouse: int | None
    """Charges in the warehouse; only for own nodes (own data) and foreign nodes where an own group
    stands (DEC-21, item 3; DEC-35, detail 2), never for a neighbour seen by the terrain table or
    the node of the half of an own group on an edge."""
    seen: Sighting | None
    """This tick's sighting unless ``detail`` is ``FOG``; for ``FOG`` the last one or ``None``."""
    attrition_in: int | None
    """Own node only: ticks until the next unit dies of overcrowding (the garrison exceeds the
    capacity and the grace after a capture is over); ``None`` otherwise, always for the enemy's
    and neutral nodes (AGENTS.md, section 4.4)."""
    grace_left: int | None
    """Own node only: ticks the grace after a capture still lasts while the garrison exceeds the
    capacity; ``None`` otherwise."""
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
    has_barracks: bool | None
    """Own city: it may recruit (DEC-26): with ``city_upgrades`` the capital and the cities with
    the barracks, without it every city. A city of the enemy joined by an edge to any own node
    (DEC-31): its barracks are built (``False`` while there are none or they are being built).
    ``None`` for provinces, neutral nodes and the other cities of the enemy (DEC-26, item 10)."""
    warehouse_level: int | None
    """Own city only: warehouse upgrades, ``0..warehouse.max_level`` (always 0 without
    ``city_upgrades``)."""
    warehouse_cap: int | None
    """Own city only: charges its warehouse holds (DEC-26, item 2; the capacity without
    ``city_upgrades``)."""
    building: BuildingView | None
    """Own city only: its current build of any kind and when it ends; ``None`` without one."""
    factory: bool | None = None
    """Economy v2 (DEC-41, item 2): an own city is a factory of the player; a city of the enemy
    joined by an edge to any own node (the DEC-31 rule): it is a built factory of the enemy.
    ``None`` under v1, for provinces, neutral nodes and the other cities of the enemy."""
    factory_period: int | None = None
    """Own factory only: ticks per charge it makes (``factory.capital_period_ticks`` for the
    own capital, ``factory.built_period_ticks`` for any other)."""
    factory_build: SiteBuildView | None = None
    """Own city only: the factory being built there (economy v2)."""
    fort: bool | None = None
    """Economy v2 (DEC-41, item 12; the bunker, code name ``fort``): an own node, city or
    province, has a bunker; a node of the enemy joined by an edge to any own node (the DEC-31
    rule): it has a built bunker. ``None`` under v1, for neutral nodes and the other nodes of
    the enemy."""
    fort_build: SiteBuildView | None = None
    """Own node only: the bunker being built there (economy v2)."""


@dataclass(frozen=True, slots=True)
class HalfView:
    """A half of an edge, from its node to the border point (DEC-21, item 5; DEC-23, item 5)."""

    detail: Detail
    """The zone level of the node the half belongs to (a source's half is ``EXACT``; DEC-33, item
    1); ``FOG`` for an own node without a source (DEC-35, detail 4)."""
    seen: Sighting | None
    """This tick's sighting of the enemy groups in the half (those in a fight too) unless
    ``detail`` is ``FOG``; for ``FOG`` the last one (no positions, DEC-33, detail 8) or ``None``."""


@dataclass(frozen=True, slots=True)
class EnemyGroupView:
    """An enemy group on a half of an edge not in fog (DEC-33): a figure with its position and
    direction. A group in a fight is not a figure: the fight shows it (detail 6)."""

    id: int
    """Opaque id: keyed by the group and the tick it came into sight, so it is new each time the
    group comes out of the fog (detail 5); never the internal id."""
    pos: int
    """Position in thousandths of the edge from the end ``a``, ``0..1000`` (detail 1)."""
    toward_b: bool
    """Goes to the end ``b`` (else to ``a``): the nearest node it goes to, a bounce or a cancel
    included; never its target (detail 2)."""
    detail: Detail
    """The level of its half: ``EXACT``, ``RANGE`` or ``PRESENCE``."""
    mode: Mode
    units: int | None
    """``EXACT`` only."""
    charged: int | None
    """``EXACT`` only."""
    units_range: tuple[int, int | None] | None
    """``RANGE`` only: the range of its units (``vision.range_starts``; ``None`` high: open)."""


@dataclass(frozen=True, slots=True)
class EdgeView:
    id: int
    width: int
    """Road level the player knows (DEC-17, DEC-22): the current one unless ``detail`` is ``FOG``,
    and always on an own internal edge (DEC-35, detail 5); otherwise in fog the level of the last
    sighting, or level 1 if never seen. Never above the true one."""
    detail: Detail
    """The road level visibility (DEC-17): ``PRESENCE`` while an end is a source (DEC-35; the edge
    of an own group on it is one), else ``FOG``. What is seen of enemies is in ``halves`` and
    ``enemy_groups``."""
    upgrade_gain: UpgradeGain | None
    """Only for own internal edges below ``max_level`` (DEC-26, item 7; DEC-28, item 7)."""
    halves: tuple[HalfView, HalfView]
    """The half of the end ``a``, then the half of the end ``b`` (DEC-21, item 5)."""
    build: BuildView | None = None
    """The road level being built here (DEC-28, item 7): an own build always, an enemy one only
    while the edge is not in fog (DEC-17, item 5; not remembered)."""
    enemy_groups: tuple[EnemyGroupView, ...] = ()
    """Enemy figures on the halves not in fog (DEC-33), sorted by id."""


@dataclass(frozen=True, slots=True)
class OrderView:
    """Current order of an own group."""

    dest: int
    path: tuple[int, ...]
    """Remaining nodes to ``dest``, the next one first, ``dest`` included."""
    planned: bool
    depart_tick: int | None
    """Not before this tick the group leaves its node (a planned order waits, DEC-08); ``None``
    while a planned order of economy v2 gathers its bonus (``gathering``, DEC-41, item 10): no
    departure tick is known until the request or the cap is reached or the plan is released."""
    bonus: int = 0
    """A planned order: the bonus it brings into its first fight (DEC-29: per edge of the path,
    at most the charged units), ``min(Group.bonus, charged now)``. Before the departure it is a
    forecast: the cap is taken by the charged units in the departure tick. 0 for a normal order
    and once the bonus entered a fight. Own orders only: the enemy's bonus shows only in a fight
    (DEC-32). Economy v2: the bonus gathered so far, at most the charged units."""
    gathering: bool = False
    """Economy v2 (DEC-41, item 10): the planned order waits in its node and gathers its bonus,
    one real charge of the node's warehouse per ``orders.plan_ticks_per_bonus`` ticks."""
    plan: int = 0
    """While ``gathering``: the bonus the player requested (the group departs by itself once
    ``bonus`` reaches it or the charged units); 0 otherwise."""
    next_charge_tick: int | None = None
    """While ``gathering``: the tick the next charge is due; it is taken in that tick or, with
    an empty warehouse or a fight in the node, in the first tick after it that allows it."""


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
    defense_bonus: int | None = None
    """In "Defense" (DEC-30): the bonus the group would bring into a fight beginning now, what it
    has gathered at most ``defense_cap``; ``None`` in another mode. Only own groups have it:
    the enemy sees the mode, not the number (DEC-30, item 5)."""
    defense_cap: int | None = None
    """In "Defense": the cap of its bonus, the charged units of the group (DEC-30, item 2);
    ``None`` in another mode."""


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
class LineView:
    """An own supply line (DEC-41, items 3 and 6): the enemy's lines are never in a view."""

    id: int
    """The per-player id of the line (``RemoveLine``, the ``line`` of ``line_cut`` and
    ``line_rerouted``); only its owner ever sees it."""
    path: tuple[int, ...]
    """The own nodes from the source to the target: the drawn path while it is intact, the
    rerouted one after a break."""


@dataclass(frozen=True, slots=True)
class IntentView:
    """Public part of a planned order or "Defense": no group id and no group size."""

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
    it, with the exact counters of the enemy in it, also on an edge where an own group shows
    only ``PRESENCE`` (DEC-10). The rounds are public (DEC-24, item I1 as revised with DEC-29):
    ``shots`` and ``losses`` of both players so far, ``last_round`` of both players with the
    virtual shots apart. The virtual shots still left (bonuses, terrain) of both players are
    public while the fight goes on (DEC-32, item 3), and so are the charges silent by terrain
    (``mute``, DEC-24, item F2). The enemy's group ids are hidden."""

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
    shots: tuple[int, int]
    """Shots of the fight so far by player."""
    losses: tuple[int, int]
    """Units lost in the fight so far by player."""
    virtual_left: tuple[int, int]
    """Virtual shots still left by player (``Fight.virtual``: bonuses, mountains; DEC-32)."""
    mute: tuple[int, int]
    """Charged units of the player in the fight that do not shoot in a round (plains: one of the
    defender, DEC-24 item F2): ``min(Fight.mute, charged)``. It follows from the public terrain and
    the counters of the fight, so the client shows it without computing it (AGENTS.md 7.1)."""
    last_round: FightRound | None
    """The latest round, by player; ``None`` before the first round."""


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
    """Own packets only (enemy packets are never visible, DEC-10, item 6)."""
    intents: tuple[IntentView, ...]
    """Intents of both players."""
    fights: tuple[FightView, ...] = ()
    """Fights going on (DEC-24): every fight has own groups, so all of them; sorted by opaque id."""
    lines: tuple[LineView, ...] = ()
    """Economy v2: the own supply lines by id (DEC-41, item 3); never the enemy's."""


# Opaque ids ----------------------------------------------------------------------------------


def check_match_key(match_key: bytes) -> None:
    """Raise ``ValueError`` unless ``match_key`` is ``MATCH_KEY_MIN..MATCH_KEY_MAX`` bytes."""
    if not MATCH_KEY_MIN <= len(match_key) <= MATCH_KEY_MAX:
        raise ValueError(f"match_key must be {MATCH_KEY_MIN}..{MATCH_KEY_MAX} bytes")


def _figure_hasher(match_key: bytes) -> Callable[[int, int, int], int]:
    """Opaque ids of enemy figures (DEC-33, detail 5): keyed blake2b of ``(viewer, group,
    tick it came into sight)``."""
    check_match_key(match_key)
    base = hashlib.blake2b(key=match_key, digest_size=8, person=_FIGURE_PERSON)

    def figure(player: int, internal: int, since: int) -> int:
        h = base.copy()
        h.update(player.to_bytes(1, "big") + internal.to_bytes(8, "big") + since.to_bytes(8, "big"))
        return int.from_bytes(h.digest(), "big") >> 1  # 63 bits: non-negative

    return figure


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

    The interface highlights ``nodes`` and shows their travel time and path; it computes none.
    Ownership of the own nodes is all the search reads besides the public map and ruleset, so
    the answer shows nothing a ``Move`` and its ``ack`` would not.
    """

    group: int
    """Opaque id of the group."""
    nodes: tuple[tuple[int, int, tuple[int, ...]], ...]
    """``(node, ticks, path)`` by node id: the nodes a ``Move`` of the group accepts now, with the
    ticks of the path once the group departs (``movement.path_ticks``) and that path
    ``(start, ..., node)``, the one the ``Move`` would take (#448). Every node of a path but the
    last is the group's node or an own node, so it names nothing hidden."""
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
            fits = reachable_paths(state, rules, player, start, size=g.units)
            every = reachable(state, rules, player, start)
            return Reach(
                group=group,
                nodes=tuple((node, ticks, path) for node, (ticks, path) in fits.items()),
                split=tuple(n for n in every if n not in fits),
            )
    return None


def line_route(
    state: GameState, rules: Ruleset, player: int, points: tuple[int, ...]
) -> tuple[int, ...]:
    """The suggested path of a supply line through ``points`` (DEC-41, item 6 and the owner
    decision 2026-10-31, #665): the source, the nodes the player routes through, the target.

    Each leg from one point to the next is the fastest way over own nodes (``transfer_route``:
    the sum of ``packet_ticks``, ties by the smaller ``node_key`` sequence) that avoids the nodes
    of the legs before it and the points after it, so the whole path is simple. ``()`` when there
    are fewer than two points, a point is repeated, out of range or not own, or a leg has no way.
    Only the owners of own nodes and the public map are read, so nothing hidden leaks; the
    suggestion checks none of the rules of ``DrawLine`` (source, cycle): the server
    decides those when the player confirms the line.
    """
    count = len(state.map.nodes)
    if len(points) < 2 or len(dict.fromkeys(points)) != len(points):
        return ()
    if any(not 0 <= n < count or state.nodes[n].owner != player for n in points):
        return ()
    edges = state.map.edges
    ticks = all_packet_ticks(state, rules)
    path: list[int] = [points[0]]
    for i in range(len(points) - 1):
        start, goal = points[i], points[i + 1]
        blocked = {n: True for n in (*path[:-1], *points[i + 2 :])}

        def usable(eid: int, blocked: dict[int, bool] = blocked) -> bool:
            return edges[eid].a not in blocked and edges[eid].b not in blocked

        route = transfer_route(state, rules, player, start, goal, usable, ticks)
        if route is None:
            return ()
        path.extend(route.nodes[1:])
    return tuple(path)


# Projection ----------------------------------------------------------------------------------


def _borders_enemy_city(state: GameState, player: int, node: int) -> bool:
    """``node`` is a city of the enemy joined by an edge of the map to any own node, a province
    too (DEC-31): its built barracks are seen. The public graph and the current owners decide,
    not the vision and no memory (DEC-31, items 1 and 3)."""
    mapdef = state.map
    owner = state.nodes[node].owner
    if owner is None or owner == player or not is_city(mapdef, node):
        return False
    return any(
        state.nodes[mapdef.edges[e].other(node)].owner == player for e in mapdef.incident[node]
    )


def _borders_enemy_node(state: GameState, player: int, node: int) -> bool:
    """``node`` is a node of the enemy, a city or a province, joined by an edge of the map to any
    own node: its built bunker is seen (DEC-41, item 12, by the rule of DEC-31)."""
    mapdef = state.map
    owner = state.nodes[node].owner
    if owner is None or owner == player:
        return False
    return any(
        state.nodes[mapdef.edges[e].other(node)].owner == player for e in mapdef.incident[node]
    )


@dataclass(frozen=True, slots=True)
class _V2Node:
    """The economy v2 fields of a ``NodeView`` (all ``None`` under v1)."""

    factory: bool | None = None
    factory_period: int | None = None
    factory_build: SiteBuildView | None = None
    fort: bool | None = None
    fort_build: SiteBuildView | None = None


_NO_V2: Final = _V2Node()


def _v2_node(state: GameState, rules: Ruleset, player: int, n: int, city: bool) -> _V2Node:
    """DEC-41, items 2 and 12: own factories, bunkers and their builds; the built factory and
    bunker of an enemy node next to an own node (DEC-31 rule); nothing else of the enemy."""
    if not rules.v2:
        return _NO_V2
    node = state.nodes[n]
    if node.owner == player:
        own_factory = city and node.factory == player
        return _V2Node(
            factory=own_factory if city else None,
            factory_period=factory_period(state, rules, n) if own_factory else None,
            factory_build=_site_view(node.factory_build, rules.factory_rules().build_ticks)
            if city
            else None,
            fort=node.fort,
            fort_build=_site_view(node.fort_build, rules.bunker_rules().build_ticks),
        )
    if not _borders_enemy_node(state, player, n):
        return _NO_V2
    return _V2Node(
        factory=node.factory == node.owner if city else None,
        fort=node.fort,
    )


def _site_view(b: FactoryBuild | None, ticks: int) -> SiteBuildView | None:
    if b is None:
        return None
    return SiteBuildView(done_tick=None if b.owed > 0 else b.since + ticks, owed=b.owed)


def _order_view(rules: Ruleset, g: Group) -> OrderView | None:
    order = g.order
    if order is None or not order.path:
        return None
    gathering = order.planned and g.plan > 0 and order.depart_tick == PLAN_WAIT
    return OrderView(
        dest=order.path[-1],
        path=order.path,
        planned=order.planned,
        depart_tick=None if gathering else order.depart_tick,
        bonus=min(g.bonus, g.charged) if order.planned else 0,
        gathering=gathering,
        plan=g.plan if gathering else 0,
        next_charge_tick=g.plan_tick + rules.orders.plan_ticks_per_bonus if gathering else None,
    )


def project(state: GameState, rules: Ruleset, player: int, match_key: bytes) -> PlayerView:
    """The view of ``player`` on ``state`` (DEC-04, DEC-17, DEC-21, DEC-33, DEC-10, DEC-35). A pure
    function: never writes."""
    opaque = _hasher(match_key)
    mapdef = state.map
    levels = compute_vision(state, rules, player)
    now_nodes, now_halves = current_sightings(state, rules, player, levels)
    memory = state.vision_memory[player]
    roads = known_roads(state, player, levels)
    capacities = node_capacities(state, rules)

    nodes: list[NodeView] = []
    for n, level in enumerate(levels.nodes):
        node = state.nodes[n]
        city = is_city(mapdef, n)
        own_city = node.owner == player and city
        v2 = _v2_node(state, rules, player, n, city)
        barracks_seen = own_city or _borders_enemy_city(state, player, n)
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
                warehouse=node.warehouse if node.owner == player or levels.stands[n] else None,
                seen=now_nodes[n] if level is not Detail.FOG else memory.nodes.get(n),
                attrition_in=attrition_in,
                grace_left=grace_left,
                starve_in=starve_in(state, rules, n) if node.owner == player else None,
                recruit_queue=node.recruit_queue if own_city else None,
                recruit_progress=node.recruit_progress if own_city else None,
                recruit_waiting=recruit_waiting(state, rules, n) if own_city else None,
                has_barracks=node.has_barracks if barracks_seen else None,
                warehouse_level=node.warehouse_level if own_city else None,
                warehouse_cap=warehouse_capacity(state, rules, n) if own_city else None,
                building=_building_view(rules, node.build) if own_city else None,
                factory=v2.factory,
                factory_period=v2.factory_period,
                factory_build=v2.factory_build,
                fort=v2.fort,
                fort_build=v2.fort_build,
            )
        )

    figures = _enemy_figures(state, rules, player, match_key, levels)
    fog_half = HalfView(Detail.FOG, None)
    shared: dict[int, HalfView] = {}  # by id of the sighting: the shared empty ones share a view
    edges: list[EdgeView] = []
    for e, level in enumerate(levels.edges):
        edef = mapdef.edges[e]
        own = state.nodes[edef.a].owner == player and state.nodes[edef.b].owner == player
        pair: list[HalfView] = []
        for n in (edef.a, edef.b):
            half_level = levels.half(n)
            if half_level is Detail.FOG:
                remembered = memory.halves.get((e, n))
                pair.append(fog_half if remembered is None else HalfView(half_level, remembered))
                continue
            seen = now_halves[e, n]
            view = shared.get(id(seen))
            if view is None:
                view = shared[id(seen)] = HalfView(half_level, seen)
            pair.append(view)
        on_edge = figures.get(e)
        edges.append(
            EdgeView(
                id=e,
                width=roads[e],
                detail=level,
                # Economy v2 has no road levels (DEC-41, items 5 and 8): no upgrade to offer.
                upgrade_gain=upgrade_gain(state, rules, e) if own and not rules.v2 else None,
                halves=(pair[0], pair[1]),
                build=_build_view(state, rules, player, e, level),
                enemy_groups=() if on_edge is None else tuple(sorted(on_edge, key=lambda v: v.id)),
            )
        )

    groups: list[GroupView] = []
    for gid in sorted(state.groups):
        g = state.groups[gid]
        if g.owner != player:
            continue
        defense = g.mode is Mode.DEFENSE
        groups.append(
            GroupView(
                id=opaque(player, gid),
                units=g.units,
                charged=g.charged,
                mode=g.mode,
                location=g.location,
                order=_order_view(rules, g),
                defense_bonus=rules.orders.defense_bonus(g.ticks_in_defense, g.charged)
                if defense
                else None,
                defense_cap=g.charged if defense else None,
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
        side_charged = [0, 0]
        for gid in sorted(f.members):
            g = state.groups.get(gid)
            if g is None:
                continue
            side_charged[g.owner] += g.charged
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
                shots=f.shots,
                losses=f.losses,
                virtual_left=f.virtual,
                mute=(min(f.mute[0], side_charged[0]), min(f.mute[1], side_charged[1])),
                last_round=f.last_round,
            )
        )

    me = state.players[player]
    return PlayerView(
        tick=state.tick,
        player=player,
        me=SelfView(
            cp=me.cp,
            stance=me.stance,
            fronts=me.fronts,
            rear_min=me.rear_min,
            auto_lines=me.auto_lines if rules.v2 else None,
        ),
        vp=tuple(state.players[p].vp for p in PLAYERS),
        nodes=tuple(nodes),
        edges=tuple(edges),
        # Sorted by opaque id: the order says nothing about creation order or internal ids.
        groups=tuple(sorted(groups, key=lambda v: v.id)),
        packets=tuple(sorted(packets, key=lambda v: v.id)),
        intents=tuple(sorted(intents, key=lambda v: v.id)),
        fights=tuple(sorted(fights, key=lambda v: v.id)),
        lines=tuple(LineView(id=k, path=me.lines[k].path) for k in sorted(me.lines)),
    )


def _enemy_figures(
    state: GameState, rules: Ruleset, player: int, match_key: bytes, levels: Vision
) -> dict[int, list[EnemyGroupView]]:
    """Enemy groups on the halves of edges not in fog, by edge (DEC-33). One pass over the
    groups; a group in a fight is left to the fight (detail 6)."""
    figure = _figure_hasher(match_key)
    mapdef = state.map
    spotted = state.vision_memory[player].spotted
    figures: dict[int, list[EnemyGroupView]] = {}
    for gid in sorted(state.groups):
        g = state.groups[gid]
        loc = g.location
        if g.owner == player or g.fight is not None or not isinstance(loc, OnEdge):
            continue
        level = levels.half(half_node(mapdef, loc))
        if level is Detail.FOG:
            continue
        exact = level is Detail.EXACT
        figures.setdefault(loc.edge, []).append(
            EnemyGroupView(
                # A group that came into sight in this very tick before the vision system ran
                # (only a state projected outside a step) is keyed by the current tick.
                id=figure(player, gid, spotted.get(gid, state.tick)),
                pos=edge_pos(mapdef, loc),
                toward_b=heading(mapdef, loc) == mapdef.edges[loc.edge].b,
                detail=level,
                mode=g.mode,
                units=g.units if exact else None,
                charged=g.charged if exact else None,
                units_range=units_range(rules, g.units) if level is Detail.RANGE else None,
            )
        )
    return figures


def _build_view(
    state: GameState, rules: Ruleset, player: int, edge: int, level: Detail
) -> BuildView | None:
    b = state.edges[edge].build
    if b is None:
        return None
    if b.owner == player:
        return BuildView(done_tick=done_tick(rules, b))
    if level is Detail.FOG:  # not shown and not remembered (DEC-17, item 5)
        return None
    return BuildView(done_tick=None)


def _building_view(rules: Ruleset, b: Build | None) -> BuildingView | None:
    """A build that still owes charges (economy v2, DEC-41, item 7) has no done tick yet."""
    if b is None:
        return None
    return BuildingView(
        kind=b.kind, done_tick=None if b.owed > 0 else done_tick(rules, b), owed=b.owed
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
        "me": {
            "cp": view.me.cp,
            "stance": view.me.stance.value,
            "fronts": list(view.me.fronts),
            "rear_min": view.me.rear_min,
            "auto_lines": view.me.auto_lines,
        },
        "vp": list(view.vp),
        "nodes": [
            {
                "id": n.id,
                "owner": n.owner,
                "capacity": n.capacity,
                "detail": n.detail.value,
                "warehouse": n.warehouse,
                "seen": _seen_data(n.seen),
                "attrition_in": n.attrition_in,
                "grace_left": n.grace_left,
                "starve_in": n.starve_in,
                "recruit_queue": n.recruit_queue,
                "recruit_progress": n.recruit_progress,
                "recruit_waiting": n.recruit_waiting,
                "has_barracks": n.has_barracks,
                "warehouse_level": n.warehouse_level,
                "warehouse_cap": n.warehouse_cap,
                "building": None
                if n.building is None
                else {
                    "kind": n.building.kind.value,
                    "done_tick": n.building.done_tick,
                    "owed": n.building.owed,
                },
                "factory": n.factory,
                "factory_period": n.factory_period,
                "factory_build": _site_data(n.factory_build),
                "fort": n.fort,
                "fort_build": _site_data(n.fort_build),
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
                    "speed_pct": e.upgrade_gain.speed_pct,
                    "unit_speed_pct": e.upgrade_gain.unit_speed_pct,
                    "amount": e.upgrade_gain.amount,
                },
                "halves": [
                    {"detail": h.detail.value, "seen": _seen_data(h.seen)} for h in e.halves
                ],
                "build": None if e.build is None else {"done_tick": e.build.done_tick},
                "enemy_groups": [
                    {
                        "id": f.id,
                        "pos": f.pos,
                        "toward_b": f.toward_b,
                        "detail": f.detail.value,
                        "mode": f.mode.value,
                        "units": f.units,
                        "charged": f.charged,
                        "units_range": None if f.units_range is None else list(f.units_range),
                    }
                    for f in e.enemy_groups
                ],
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
                    "bonus": g.order.bonus,
                    "gathering": g.order.gathering,
                    "plan": g.order.plan,
                    "next_charge_tick": g.order.next_charge_tick,
                },
                "defense_bonus": g.defense_bonus,
                "defense_cap": g.defense_cap,
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
                "shots": list(f.shots),
                "losses": list(f.losses),
                "virtual_left": list(f.virtual_left),
                "mute": list(f.mute),
                "last_round": None
                if f.last_round is None
                else {
                    "tick": f.last_round.tick,
                    "shots": list(f.last_round.shots),
                    "virtual": list(f.last_round.virtual),
                    "spent": list(f.last_round.spent),
                    "losses": list(f.last_round.losses),
                },
            }
            for f in view.fights
        ],
        "lines": [{"id": line.id, "path": list(line.path)} for line in view.lines],
    }


def _site_data(b: SiteBuildView | None) -> dict[str, object] | None:
    return None if b is None else {"done_tick": b.done_tick, "owed": b.owed}


def _seen_data(s: Sighting | None) -> dict[str, object] | None:
    if s is None:
        return None
    return {
        "tick": s.tick,
        "level": s.level.value,
        "enemy_modes": [m.value for m in s.enemy_modes],
        "enemy_units": s.enemy_units,
        "enemy_charged": s.enemy_charged,
        "enemy_range": None if s.enemy_range is None else list(s.enemy_range),
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
