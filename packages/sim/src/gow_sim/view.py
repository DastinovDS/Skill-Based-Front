"""Projection (SIM-14): ``project()`` builds the ``PlayerView``, the only thing a player sees.

``PlayerView`` is everything that leaves the simulation towards a player or a bot (AGENTS.md,
section 4.4); bots get the same view as people. It follows DEC-04, DEC-17, DEC-21, DEC-33, DEC-10
and DEC-35 (mechanics.md, section 10) and has the shape of the wire ``View`` of the protocol
(``gow_protocol.view``, PRO-01), which PRO-03 converts it into:

- public to everyone: ownership of every node, VP of both players, intents of planned orders
  (kind, origin, target; no group id or size);
- node capacities: fixed by the node kind (DEC-22, item 1), public and exact for every node;
- sources of vision (DEC-35: nodes where own groups stand, the node of the half of an edge an own
  group is in): the enemy totals like every ``EXACT`` place; the warehouse of own nodes always
  (own data) and of a foreign node only where an own group stands (DEC-35, detail 2);
- own nodes are never in fog: an enemy in an own node without a source is seen at ``PRESENCE``
  (DEC-35, detail 3), which gives the node's halves of edges no zone (detail 4);
- own nodes: the ticks until the garrison of a starving pocket next starves (``starve_in``,
  DEC-19, item 8; DEC-43, item H4); own cities: their recruit queue and its progress (DEC-25,
  item 12), the barracks, the warehouse capacity and the current build (DEC-26, item 10); own
  packets with their remaining path;
- enemy cities joined by an edge of the map to any own node: whether their barracks are built
  (DEC-31; by the current owners and the public graph, no memory);
- factories (DEC-41): the own factories and their rates, the factory builds of own cities with
  the charges they still owe (item 7), the plan of an own gathering planned order (the requested
  bonus, the bonus gathered, the tick the next charge is due; item 10); the built factory of an
  enemy city joined by an edge to any own node (the DEC-31 rule), never an enemy build;
- road fortifications (DEC-43, item D8; ``EdgeView.forts``): own ones always with the tick an own
  build ends; an enemy one, built or being built, while the half of its node is not in fog (only
  whether it is built, no memory);
- supply flow (DEC-43, item E): for own nodes only the field, the downhill neighbours, the plan
  of the next dispatch and why a node sends nothing, whether it is in a pocket; the own leaf
  shift, its maximum and the next dispatch tick; the own stance progress (DEC-44);
- neighbours of sources by the terrain table (DEC-21, item 2), and the halves of edges by the level
  of their node (item 5): ``EXACT`` the enemy totals, ``RANGE`` the range of the enemy units,
  ``PRESENCE`` whether enemy groups are there (the modes on every level);
- enemy groups on the halves of edges not in fog, each as a figure (DEC-33, ``EdgeView.
  enemy_groups``): position, direction, mode and the numbers of its half's level, with an opaque id
  that is new each time the group comes out of the fog; a group in a fight is shown by the fight;
- ``FOG``: only the last sighting from ``GameState.vision_memory`` (no positions, DEC-33);
- fights going on (DEC-24, item I1): both players fight in each, so both see it with the exact
  units and charged of the enemy in it, the shots and losses of both sides so far and the latest
  round of both sides (shots with the virtual ones apart, spent charges, losses; I1 as revised
  with DEC-29), the virtual shots still left of both sides (DEC-32, item 3) and the charges of
  both sides the terrain will burn in the first round (``mute``, DEC-45); the enemy's group
  ids stay hidden. Outside a fight the bonus of an enemy group (a waiting planned order) is
  never in a view, also not for a reinforcement on its way.

What a view never has: internal ids of enemy groups, enemy groups standing in nodes as entities
(only the per-place ``Sighting``), positions or directions of enemy groups in fog, the barracks
of enemy cities not next to an own node, the barracks builds and city builds of the enemy
(DEC-26, item 10; DEC-31), the warehouse of a foreign node where no own group stands (DEC-21,
item 3; DEC-35, detail 2), enemy packets (on any edge, DEC-10, item 6), enemy CP, stance,
production and counters, the enemy's factory builds, factory rates and planned-order requests
(DEC-41), the enemy's leaf shift, field and flow plan (DEC-43, item B5), the enemy's road
fortifications in fog and the tick an enemy one is built (item D8), events, the target of an
enemy's normal order (normal orders have no intent), sequential ids.

Ids of own groups, own packets and intents are opaque per player: keyed blake2b of
``(player, internal id)`` with the secret ``match_key`` of the match (``opaque_id``). They are
63-bit integers, not sequential and not recoverable without the key; on the wire PRO-03 writes
them in decimal (at most 19 digits, inside the pattern ``[A-Za-z0-9_-]{1,32}`` of PRO-01).
``resolve()`` maps the opaque ids of a command back to internal ids.

``rules`` and ``match_key`` are not part of ``GameState``, so ``project()`` and ``resolve()`` take
them as arguments besides the ``(state, player[, cmd])`` of AGENTS.md.
"""

import hashlib
from collections.abc import Callable, Iterator
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
    FlowIdle,
    GameState,
    Group,
    IntentKind,
    Location,
    Mode,
    OnEdge,
    Sighting,
)
from gow_sim.systems.build import done_tick
from gow_sim.systems.capacity import (
    node_capacities,
    overflow_countdown,
    starve_in,
    warehouse_capacity,
)
from gow_sim.systems.economy import factory_period
from gow_sim.systems.flow import next_dispatch_tick
from gow_sim.systems.movement import reachable, reachable_paths
from gow_sim.systems.recruit import recruit_waiting
from gow_sim.systems.supply import is_city, packet_dest_tick, packet_path
from gow_sim.systems.vision import (
    Sight,
    Vision,
    compute_vision,
    current_sightings,
    edge_pos,
    half_node,
    heading,
    units_range,
)

__all__ = [
    "MATCH_KEY_MAX",
    "MATCH_KEY_MIN",
    "AtNode",
    "BuildKind",
    "BuildingView",
    "Detail",
    "EdgeView",
    "EnemyGroupView",
    "FightRound",
    "FightView",
    "FlowIdle",
    "GroupView",
    "HalfView",
    "IntentKind",
    "IntentView",
    "Location",
    "Mode",
    "NodeView",
    "OnEdge",
    "OrderView",
    "PacketView",
    "PlayerView",
    "Reach",
    "RoadFortView",
    "SelfView",
    "Sighting",
    "SiteBuildView",
    "Stance",
    "check_match_key",
    "enemy_figure_ids",
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
    leaf_shift: int | None = None
    """Supply flow (DEC-43, item B): the own leaf shift in force (always set; nullable on the
    wire until the client cleanup of #894). The enemy's shift is never in a view (item B5)."""
    leaf_shift_max: int | None = None
    """Supply flow: the largest shift, ``d0`` of the own capital (item B2)."""
    next_dispatch_tick: int | None = None
    """Supply flow: the tick of the next dispatch (item A6)."""
    cp_ticks: int | None = None
    """Stances (DEC-44): the ticks since the own last CP quantum. The enemy's counters are never
    in a view."""
    capital_ticks: int | None = None
    """Stances: the ticks since the last quantum of the own capital."""


@dataclass(frozen=True, slots=True)
class BuildingView:
    """The current build of an own city (DEC-26, item 10): the barracks."""

    kind: BuildKind
    done_tick: int | None
    """The tick it ends, if nothing interrupts it; ``None`` while it still owes charges (DEC-41,
    item 7: the build time starts in the tick of the full payment)."""
    owed: int = 0
    """The charges the build still has to take from the city and its groups (DEC-41, item 7)."""


@dataclass(frozen=True, slots=True)
class SiteBuildView:
    """A factory being built in an own city (DEC-41, item 2)."""

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
    """Own node of a starving pocket only: ticks until its garrison next starves (DEC-19, item 8,
    grace included; DEC-43, item H4); ``None`` otherwise, always for the enemy's and neutral
    nodes."""
    recruit_queue: int | None
    """Own city only: units in its recruit queue, the one in production included (DEC-25, item
    12); ``None`` for provinces, the enemy's and neutral nodes: the enemy's production is hidden."""
    recruit_progress: int | None
    """Own city only: ticks of production of the current unit, ``0..recruit.unit_ticks``."""
    recruit_waiting: bool | None
    """Own city only: the current unit is ready and waits for a place (DEC-25, item 7)."""
    has_barracks: bool | None
    """Own city: it may recruit (DEC-26): the capital and the cities with the barracks. A city of
    the enemy joined by an edge to any own node (DEC-31): its barracks are built (``False`` while
    there are none or they are being built). ``None`` for provinces, neutral nodes and the other
    cities of the enemy (DEC-26, item 10)."""
    warehouse_cap: int | None
    """Own city only: charges its warehouse holds (DEC-43, item C)."""
    building: BuildingView | None
    """Own city only: its current build and when it ends; ``None`` without one."""
    factory: bool | None = None
    """DEC-41, item 2: an own city is a factory of the player; a city of the enemy joined by an
    edge to any own node (the DEC-31 rule): it is a built factory of the enemy. ``None`` for
    provinces, neutral nodes and the other cities of the enemy."""
    factory_period: int | None = None
    """Own factory only: ticks per charge it makes (``systems.economy.factory_period``: the
    capital period of the own stance for the own capital, ``factory.built_period_ticks`` for any
    other, with ``stances.factories_follow`` (DEC-47) the capital period of the stance too)."""
    factory_build: SiteBuildView | None = None
    """Own city only: the factory being built there."""
    front_dist: int | None = None
    """Supply flow (DEC-43, item E), own node only: the effective field ``d`` (after the pull) of
    the current tick; ``None`` without a field and for other nodes."""
    flow_down: tuple[int, ...] | None = None
    """Own node only: the downhill neighbours (``k <= d(m) < d``, room not considered), by
    ``node_key``."""
    flow_next: tuple[int, ...] | None = None
    """Own node only: the receivers of its next dispatch, in the order they get the charges."""
    flow_idle: FlowIdle | None = None
    """Own node only: why it sends nothing at the next dispatch; ``None`` when ``flow_next`` is
    not empty."""
    flow_pocket: bool | None = None
    """Own node only: its component over internal roads does not contain the own capital (item
    H1)."""
    terrain_mark: int | None = None
    """The terrain effect the defender of the node would get if attacked now (DEC-24, item F2;
    #791): ``terrain.defense_mod`` of the node, positive for bonus shots (mountains), negative for
    the charges burned by plains (DEC-45), at most the defender's charged. Set only when the node
    has an owner, no fight, a non-zero terrain effect and a charged group of the owner standing in
    it; for a node of the enemy only where the view shows the enemy's charges (``EXACT``). ``None``
    otherwise: an attacker, a discharged group, an edge, a neutral node never carry it. It shows
    nothing new: the terrain is public, the owner and the charges are in the view."""
    rally_point: int | None = None
    """DEC-48, item I2: own city only, the own node its new units walk to (``SetRallyPoint``);
    ``None`` without one and for every other node."""


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
class RoadFortView:
    """A road fortification on an edge (DEC-43, item D; code name ``road_fort``): of the end
    ``node``, owned by ``owner``. Own ones always; an enemy one, built or being built, while the
    half of ``node`` on the edge is not in fog (item D8, no memory)."""

    node: int
    owner: int
    built: bool
    """It takes its toll (the build time is over)."""
    done_tick: int | None
    """Own builds only: the tick it starts to work; ``None`` when built and for the enemy's."""


@dataclass(frozen=True, slots=True)
class EdgeView:
    id: int
    detail: Detail
    """The edge visibility (DEC-17): ``PRESENCE`` while an end is a source (DEC-35; the edge of an
    own group on it is one), else ``FOG``. What is seen of enemies is in ``halves`` and
    ``enemy_groups``."""
    halves: tuple[HalfView, HalfView]
    """The half of the end ``a``, then the half of the end ``b`` (DEC-21, item 5)."""
    enemy_groups: tuple[EnemyGroupView, ...] = ()
    """Enemy figures on the halves not in fog (DEC-33), sorted by id."""
    forts: tuple[RoadFortView, ...] = ()
    """The road fortifications of its ends the player knows of (DEC-43, item D8): the end ``a``
    first."""


@dataclass(frozen=True, slots=True)
class OrderView:
    """Current order of an own group."""

    dest: int
    path: tuple[int, ...]
    """Remaining nodes to ``dest``, the next one first, ``dest`` included."""
    planned: bool
    depart_tick: int | None
    """Not before this tick the group leaves its node; ``None`` while a planned order gathers
    its bonus (``gathering``, DEC-41, item 10): no departure tick is known until the request or
    the cap is reached or the plan is released; also ``None`` for a ready member of a planned
    group order until the departures are fixed (DEC-48, item F4). A member of a synchronized
    attack waits in its node until this tick (item C2)."""
    bonus: int = 0
    """A planned order: the bonus gathered so far (DEC-41, item 10), at most the charged units,
    ``min(Group.bonus, charged now)``: the cap is taken again by the charged units in the
    departure tick (DEC-29). 0 for a normal order and once the bonus entered a fight. Own orders
    only: the enemy's bonus shows only in a fight (DEC-32)."""
    gathering: bool = False
    """DEC-41, item 10: the planned order waits in its node and gathers its bonus,
    one real charge of the node's warehouse per ``orders.plan_ticks_per_bonus`` ticks."""
    plan: int = 0
    """While ``gathering``: the bonus the player requested (the group departs by itself once
    ``bonus`` reaches it or the charged units); 0 otherwise."""
    next_charge_tick: int | None = None
    """While ``gathering``: the tick the next charge is due; it is taken in that tick or, with
    an empty warehouse or a fight in the node, in the first tick after it that allows it."""
    group_order: int | None = None
    """DEC-48, item I1: an opaque id shared by the members of one group order; ``None`` for a
    single order. Own orders only."""
    arrive_tick: int | None = None
    """DEC-48, item I1: the common arrival of the group order (a rally: the latest arrival of a
    member) once known, ``None`` while a planned order gathers and for a single order."""


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


@dataclass(frozen=True, slots=True)
class IntentView:
    """Public part of a planned order: no group id and no group size."""

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
    public while the fight goes on (DEC-32, item 3), and so are the charges the terrain will burn
    (``mute``, DEC-45). The enemy's group ids are hidden."""

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
    """Charged units of the player in the fight that do not shoot before the first round: the
    charges the first round will burn (plains, DEC-45), 0 after it: ``min(Fight.mute, charged)``. It
    follows from the public terrain and the counters of the fight, so the client shows it without
    computing it (AGENTS.md 7.1)."""
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
    split: tuple[tuple[int, int], ...]
    """``(node, units)`` by node id: the nodes a ``Move`` rejects with ``STACK_LIMIT``, reachable
    only by a smaller group, with the most units a group from the same node can have to be
    accepted there now (``0``: no smaller group either). The interface offers the split of that
    size (#762); it is the same search under the stack limit of a smaller size, so it reads
    nothing more than ``nodes`` does."""


def _split_fits(
    state: GameState, rules: Ruleset, player: int, start: int, units: int, nodes: list[int]
) -> tuple[tuple[int, int], ...]:
    """``(node, fit)`` for each of ``nodes`` (all rejected with ``STACK_LIMIT`` for ``units``):
    the largest size below ``units`` a group from ``start`` reaches it with (DEC-20, D). A size
    passes a node exactly when the node's capacity is not less than it, so the largest such size
    is one of the node capacities: only those are tried, largest first."""
    fit: dict[int, int] = {}
    caps = sorted(dict.fromkeys(c for c in node_capacities(state, rules) if 0 < c < units))
    for size in reversed(caps):
        if len(fit) == len(nodes):
            break
        found = reachable_paths(state, rules, player, start, size=size)
        for node in nodes:
            if node not in fit and node in found:
                fit[node] = size
    return tuple((node, fit.get(node, 0)) for node in nodes)


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
            split = [n for n in every if n not in fits]
            return Reach(
                group=group,
                nodes=tuple((node, ticks, path) for node, (ticks, path) in fits.items()),
                split=_split_fits(state, rules, player, start, g.units, split),
            )
    return None


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


@dataclass(frozen=True, slots=True)
class _FactoryNode:
    """The factory fields of a ``NodeView``."""

    factory: bool | None = None
    factory_period: int | None = None
    factory_build: SiteBuildView | None = None


_NO_FACTORY: Final = _FactoryNode()


def _factory_node(
    state: GameState, rules: Ruleset, player: int, n: int, city: bool, enemy_seen: bool
) -> _FactoryNode:
    """DEC-41, item 2: own factories and their builds; the built factory of an enemy city next
    to an own node (``enemy_seen``, the DEC-31 rule); nothing else of the enemy."""
    if not city:
        return _NO_FACTORY
    node = state.nodes[n]
    if node.owner == player:
        own_factory = node.factory == player
        return _FactoryNode(
            factory=own_factory,
            factory_period=factory_period(state, rules, n) if own_factory else None,
            factory_build=_site_view(node.factory_build, rules.factory.build_ticks),
        )
    if not enemy_seen:
        return _NO_FACTORY
    return _FactoryNode(factory=node.factory == node.owner)


def _site_view(b: FactoryBuild | None, ticks: int) -> SiteBuildView | None:
    if b is None:
        return None
    return SiteBuildView(done_tick=None if b.owed > 0 else b.since + ticks, owed=b.owed)


def _standing_charged(state: GameState) -> dict[int, int]:
    """Node -> the charged units of its owner standing in it, in no fight (DEC-24, item F2)."""
    charged: dict[int, int] = {}
    for gid in sorted(state.groups):
        g = state.groups[gid]
        loc = g.location
        if g.fight is not None or not isinstance(loc, AtNode) or g.charged <= 0:
            continue
        if state.nodes[loc.node].owner == g.owner:
            charged[loc.node] = charged.get(loc.node, 0) + g.charged
    return charged


def _terrain_mark(
    state: GameState,
    rules: Ruleset,
    player: int,
    n: int,
    level: Detail,
    standing: dict[int, int],
    fight_nodes: dict[int, int],
) -> int | None:
    """``NodeView.terrain_mark`` (#791): the terrain effect of item F2 for the defender of ``n``."""
    owner = state.nodes[n].owner
    if owner is None or n in fight_nodes:
        return None
    if owner != player and level is not Detail.EXACT:
        return None  # the enemy's charges are not shown here
    charged = standing.get(n, 0)
    if charged <= 0:
        return None
    mod = rules.terrain.defense_mod.of(state.map.nodes[n].terrain)
    if mod == 0:
        return None
    return mod if mod > 0 else -min(-mod, charged)


def _order_view(
    state: GameState, rules: Ruleset, g: Group, opaque: Callable[[int, int], int]
) -> OrderView | None:
    order = g.order
    if order is None or not order.path:
        return None
    gathering = order.planned and g.plan > 0 and order.depart_tick == PLAN_WAIT
    joint = None if g.group_order is None else state.group_orders.get(g.group_order)
    return OrderView(
        dest=order.path[-1],
        path=order.path,
        planned=order.planned,
        depart_tick=None if order.depart_tick == PLAN_WAIT else order.depart_tick,
        bonus=min(g.bonus, g.charged) if order.planned else 0,
        gathering=gathering,
        plan=g.plan if gathering else 0,
        next_charge_tick=g.plan_tick + rules.orders.plan_ticks_per_bonus if gathering else None,
        group_order=None if joint is None else opaque(g.owner, joint.id),
        arrive_tick=None if joint is None else joint.arrive_tick,
    )


def project(
    state: GameState, rules: Ruleset, player: int, match_key: bytes, sight: Sight | None = None
) -> PlayerView:
    """The view of ``player`` on ``state`` (DEC-04, DEC-17, DEC-21, DEC-33, DEC-10, DEC-35). A pure
    function: never writes. ``sight``: what the ``vision`` system computed for ``player`` on this
    very state (``systems.vision.observe``), reused instead of computed again."""
    opaque = _hasher(match_key)
    mapdef = state.map
    if sight is None:
        levels = compute_vision(state, rules, player)
        now_nodes, now_halves = current_sightings(state, rules, player, levels)
    else:
        levels, now_nodes, now_halves = sight.levels, sight.nodes, sight.halves
    memory = state.vision_memory[player]
    capacities = node_capacities(state, rules)
    standing = _standing_charged(state)
    fight_nodes = state.fight_nodes()

    nodes: list[NodeView] = []
    for n, level in enumerate(levels.nodes):
        node = state.nodes[n]
        city = is_city(mapdef, n)
        own_city = node.owner == player and city
        enemy_seen = _borders_enemy_city(state, player, n)
        fac = _factory_node(state, rules, player, n, city, enemy_seen)
        flow = node.flow if node.owner == player else None  # own only (item E)
        barracks_seen = own_city or enemy_seen
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
                warehouse_cap=warehouse_capacity(state, rules, n) if own_city else None,
                building=_building_view(rules, node.build) if own_city else None,
                factory=fac.factory,
                factory_period=fac.factory_period,
                factory_build=fac.factory_build,
                front_dist=flow.d if flow is not None else None,
                flow_down=flow.down if flow is not None else None,
                flow_next=flow.next if flow is not None else None,
                flow_idle=flow.idle if flow is not None else None,
                flow_pocket=flow.pocket if flow is not None else None,
                terrain_mark=_terrain_mark(state, rules, player, n, level, standing, fight_nodes),
                rally_point=node.rally_point if own_city else None,
            )
        )

    figures = _enemy_figures(state, rules, player, match_key, levels)
    fog_half = HalfView(Detail.FOG, None)
    shared: dict[int, HalfView] = {}  # by id of the sighting: the shared empty ones share a view
    edges: list[EdgeView] = []
    for e, level in enumerate(levels.edges):
        edef = mapdef.edges[e]
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
                detail=level,
                halves=(pair[0], pair[1]),
                enemy_groups=() if on_edge is None else tuple(sorted(on_edge, key=lambda v: v.id)),
                forts=_forts_view(state, player, e, levels),
            )
        )

    groups: list[GroupView] = []
    for gid in sorted(state.groups):
        g = state.groups[gid]
        if g.owner != player:
            continue
        groups.append(
            GroupView(
                id=opaque(player, gid),
                units=g.units,
                charged=g.charged,
                mode=g.mode,
                location=g.location,
                order=_order_view(state, rules, g, opaque),
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
            leaf_shift=me.leaf_shift,
            leaf_shift_max=me.leaf_shift_max,
            next_dispatch_tick=next_dispatch_tick(state, rules),
            cp_ticks=me.cp_ticks,
            capital_ticks=me.capital_ticks,
        ),
        vp=tuple(state.players[p].vp for p in PLAYERS),
        nodes=tuple(nodes),
        edges=tuple(edges),
        # Sorted by opaque id: the order says nothing about creation order or internal ids.
        groups=tuple(sorted(groups, key=lambda v: v.id)),
        packets=tuple(sorted(packets, key=lambda v: v.id)),
        intents=tuple(sorted(intents, key=lambda v: v.id)),
        fights=tuple(sorted(fights, key=lambda v: v.id)),
    )


def _in_sight(
    state: GameState, player: int, levels: Vision
) -> Iterator[tuple[int, Group, OnEdge, Detail]]:
    """The enemy groups shown as figures (DEC-33): on the halves of edges not in fog, not in a
    fight (detail 6), by internal id: ``(id, group, location, level of its half)``."""
    mapdef = state.map
    for gid in sorted(state.groups):
        g = state.groups[gid]
        loc = g.location
        if g.owner == player or g.fight is not None or not isinstance(loc, OnEdge):
            continue
        level = levels.half(half_node(mapdef, loc))
        if level is not Detail.FOG:
            yield gid, g, loc, level


def enemy_figure_ids(
    state: GameState, rules: Ruleset, player: int, match_key: bytes, sight: Sight | None = None
) -> tuple[int, ...]:
    """The opaque ids of the enemy figures of ``project()`` without the rest of the view:
    ``tuple(f.id for e in view.edges for f in e.enemy_groups)``, in that order (by edge, then by
    id), under the same fog rules (DEC-33). A pure function; ``sight`` as in ``project()``. A bot
    that will not decide on a call reads only these (``gow_sim.match.Glancer``)."""
    figure = _figure_hasher(match_key)
    levels = compute_vision(state, rules, player) if sight is None else sight.levels
    spotted = state.vision_memory[player].spotted
    by_edge: dict[int, list[int]] = {}
    for gid, _, loc, _ in _in_sight(state, player, levels):
        by_edge.setdefault(loc.edge, []).append(figure(player, gid, spotted.get(gid, state.tick)))
    return tuple(i for e in sorted(by_edge) for i in sorted(by_edge[e]))


def _enemy_figures(
    state: GameState, rules: Ruleset, player: int, match_key: bytes, levels: Vision
) -> dict[int, list[EnemyGroupView]]:
    """Enemy groups on the halves of edges not in fog, by edge (DEC-33, ``_in_sight``)."""
    figure = _figure_hasher(match_key)
    mapdef = state.map
    spotted = state.vision_memory[player].spotted
    figures: dict[int, list[EnemyGroupView]] = {}
    for gid, g, loc, level in _in_sight(state, player, levels):
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


def _forts_view(
    state: GameState, player: int, edge: int, levels: Vision
) -> tuple[RoadFortView, ...]:
    """DEC-43, item D8: own road fortifications always, with the tick an own build ends; an enemy
    one while the half of its node is not in fog, only whether it is built."""
    edef = state.map.edges[edge]
    forts: list[RoadFortView] = []
    for n in (edef.a, edef.b):
        node = state.nodes[n]
        ready = node.road_forts.get(edge)
        if ready is None or node.owner is None:
            continue
        built = state.tick >= ready
        if node.owner == player:
            forts.append(RoadFortView(n, node.owner, built, None if built else ready))
        elif levels.half(n) is not Detail.FOG:
            forts.append(RoadFortView(n, node.owner, built, None))
    return tuple(forts)


def _building_view(rules: Ruleset, b: Build | None) -> BuildingView | None:
    """A build that still owes charges (DEC-41, item 7) has no done tick yet."""
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
            "leaf_shift": view.me.leaf_shift,
            "leaf_shift_max": view.me.leaf_shift_max,
            "next_dispatch_tick": view.me.next_dispatch_tick,
            "cp_ticks": view.me.cp_ticks,
            "capital_ticks": view.me.capital_ticks,
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
                "front_dist": n.front_dist,
                "flow_down": None if n.flow_down is None else list(n.flow_down),
                "flow_next": None if n.flow_next is None else list(n.flow_next),
                "flow_idle": None if n.flow_idle is None else n.flow_idle.value,
                "flow_pocket": n.flow_pocket,
                "terrain_mark": n.terrain_mark,
                "rally_point": n.rally_point,
            }
            for n in view.nodes
        ],
        "edges": [
            {
                "id": e.id,
                "detail": e.detail.value,
                "halves": [
                    {"detail": h.detail.value, "seen": _seen_data(h.seen)} for h in e.halves
                ],
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
                "forts": [
                    {"node": f.node, "owner": f.owner, "built": f.built, "done_tick": f.done_tick}
                    for f in e.forts
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
                    "group_order": g.order.group_order,
                    "arrive_tick": g.order.arrive_tick,
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
                    "burned": list(f.last_round.burned),
                },
            }
            for f in view.fights
        ],
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
