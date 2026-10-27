"""The player's view on the wire: the ``view`` of a ``snapshot`` message.

It carries a ``PlayerView`` (``gow_sim.view.project()``, SIM-14 #30) and nothing else; the
conversion is PRO-03 (#46). The shape follows DEC-04, DEC-21, DEC-33 and DEC-10 (mechanics.md,
section 10)
and the list of what a view must not contain (AGENTS.md, section 4.4):

- public to everyone: ownership and capacity (DEC-22) of every node, road levels and types
  (DEC-17: last seen in fog), VP of both players,
  intents of planned orders and "Defense" (origin, target, kind; no group id, no size);
- road builds of cities (DEC-16): own ones always, with ``done_tick``; an enemy one without
  ``done_tick`` and only while its edge is not in fog (DEC-17, item 5);
- sources of vision (own nodes, nodes where own groups stand): everything with numbers, the
  warehouse included;
- neighbours of sources by the terrain table (DEC-21, item 2) and the halves of edges by the
  level of their node, at least ``presence`` on an edge an own group is on (DEC-10): ``exact`` the
  enemy totals, ``range`` the range of the enemy units, ``presence`` whether enemy groups are
  there; the modes on every level; never the warehouse;
- enemy groups on the halves of edges not in fog, each as a figure (``EdgeView.enemy_groups``,
  DEC-33): position, direction, mode and the numbers of its half's level, with an opaque id that
  is new each time the group comes out of the fog; a group in a fight is shown by the fight;
- ``FOG``: only the last sighting from the fog memory (no positions);
- fights going on (DEC-24, item I1): every fight has groups of both players, so both see it with
  the exact units and charged of the enemy in it and the rounds of both sides (shots with the
  virtual ones apart, spent charges, losses; I1 as revised with DEC-29); the virtual shots still
  left and the enemy's group ids are not in the view.

Deliberate choices of the wire format:

- ``groups`` and ``packets`` are **own** entities only. What the player knows about enemy groups
  in nodes is the per-place ``Seen`` summary (modes, totals only where ``exact``, a range where
  ``range``), the same shape as the fog memory ``gow_sim.state.Sighting``; on edges the figures of
  ``EdgeView.enemy_groups``, whose ids are keyed by the sighting, not the group, so they cannot
  track a group through the fog. Enemy packets are never visible, on any edge (DEC-10, item 6).
- Own-only data (``me``: CP, stance, front markers and rear minimum of DEC-28; ``upgrade_gain``
  of own edges; orders of own groups) has no enemy counterpart in the view.
"""

from typing import Annotated, Literal, Self

from pydantic import Field, field_validator, model_validator

from gow_protocol.base import (
    Centi,
    EdgeId,
    NodeId,
    NonNegInt,
    OpaqueId,
    PlayerId,
    PosInt,
    Progress,
    Tick,
    Width,
    WireModel,
)
from gow_sim.ruleset import Stance
from gow_sim.state import BuildKind, Detail, IntentKind, Mode


class UnitsRange(WireModel):
    """A range of units (DEC-21, item 4; ``vision.range_starts``): ``low..high``, ``high``
    ``null`` for the last, open range («21+»)."""

    low: PosInt
    high: PosInt | None

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.high is not None and self.high < self.low:
            raise ValueError("high must not be below low")
        return self


class Seen(WireModel):
    """What the player sees, or last saw, of one node or half of an edge
    (``gow_sim.state.Sighting``).

    ``enemy_modes``: distinct modes of the enemy groups there; empty means no enemy groups.
    ``enemy_units`` and ``enemy_charged`` are totals, present only when ``level`` is ``exact``;
    ``enemy_range``: the range of the total units, only when ``level`` is ``range`` and enemies
    are there. ``level`` is never ``fog``: a place in fog is not seen, it keeps an older ``Seen``.
    """

    tick: Tick
    level: Detail
    enemy_modes: Annotated[tuple[Mode, ...], Field(max_length=len(Mode))]
    enemy_units: NonNegInt | None
    enemy_charged: NonNegInt | None
    enemy_range: UnitsRange | None

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.level is Detail.FOG:
            raise ValueError("level of a sighting is exact, range or presence, never fog")
        if len(set(self.enemy_modes)) != len(self.enemy_modes):
            raise ValueError("enemy_modes must be distinct")
        exact = self.level is Detail.EXACT
        if exact != (self.enemy_units is not None) or exact != (self.enemy_charged is not None):
            raise ValueError("enemy_units and enemy_charged are given exactly when level is exact")
        ranged = self.level is Detail.RANGE and bool(self.enemy_modes)
        if ranged != (self.enemy_range is not None):
            raise ValueError("enemy_range is given exactly on the range level with enemies")
        if (
            self.enemy_units is not None
            and self.enemy_charged is not None
            and self.enemy_charged > self.enemy_units
        ):
            raise ValueError("enemy_charged must not exceed enemy_units")
        return self


class EdgeBuild(WireModel):
    """A road level being built on the edge (DEC-28, item 7)."""

    done_tick: Tick | None
    """The tick the level grows; only for an own build."""


class NodeBuilding(WireModel):
    """The current build of an own city, of any kind (DEC-26, item 10)."""

    kind: BuildKind
    """``barracks`` or ``warehouse`` (roads are built on edges, ``EdgeView.build``)."""
    done_tick: Tick
    """The tick it ends, if nothing interrupts it."""


class NodeView(WireModel):
    id: NodeId
    owner: PlayerId | None
    capacity: NonNegInt
    """Capacity by the node kind (DEC-22, item 1): public and exact for every node."""
    detail: Detail
    warehouse: NonNegInt | None
    """Charges in the warehouse; only for sources of vision (own nodes, nodes where own groups
    stand), never for a neighbour seen by the terrain table (DEC-21, item 3)."""
    seen: Seen | None
    """Current sighting unless ``detail`` is ``fog``; for ``fog`` the last one, or ``None``."""
    attrition_in: PosInt | None
    """Own node only: ticks until the next unit dies of overcrowding (the garrison exceeds the
    capacity and the grace after a capture is over). ``None`` for every other node."""
    grace_left: PosInt | None
    """Own node only: ticks the grace after a capture still lasts while the garrison exceeds the
    capacity. ``None`` for every other node."""
    starve_in: PosInt | None
    """Own cut-off city only: ticks until its garrison next starves (DEC-19, item 8). ``None``
    for every other node."""
    recruit_queue: NonNegInt | None
    """Own city only: units in its recruit queue, the one in production included (DEC-25, item
    12). ``None`` for provinces, the enemy's and neutral nodes: the enemy's production is hidden."""
    recruit_progress: NonNegInt | None
    """Own city only: ticks of production of the current unit, up to ``recruit.unit_ticks``."""
    recruit_waiting: bool | None
    """Own city only: the current unit is ready and waits for a place (DEC-25, item 7)."""
    has_barracks: bool | None
    """Own city: it may recruit (DEC-26: with ``city_upgrades`` the capital and the cities with
    the barracks, without it every city). A city of the enemy joined by an edge of the map to any
    own node, at any ``detail`` (DEC-31): its barracks are built (``false`` while there are none
    or they are being built; no memory). ``None`` for provinces, neutral nodes and the other
    cities of the enemy (DEC-26, item 10)."""
    warehouse_level: NonNegInt | None
    """Own city only: warehouse upgrades (DEC-26, item 2; always 0 without ``city_upgrades``)."""
    warehouse_cap: NonNegInt | None
    """Own city only: charges its warehouse holds (DEC-26, item 2; the node capacity without
    ``city_upgrades``)."""
    building: NodeBuilding | None
    """Own city only: its current build of any kind; ``None`` without one."""

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.starve_in is not None and self.detail is not Detail.EXACT:
            raise ValueError("a starvation countdown only for an own city, seen exactly")
        recruit = (self.recruit_queue, self.recruit_progress, self.recruit_waiting)
        if any(v is not None for v in recruit) and (
            None in recruit or self.detail is not Detail.EXACT
        ):
            raise ValueError("a recruit queue only for an own city, all three fields together")
        city = (self.has_barracks, self.warehouse_level, self.warehouse_cap)
        if any(v is not None for v in city[1:]) and (
            None in city or self.detail is not Detail.EXACT
        ):
            raise ValueError("barracks and warehouse only for an own city, all three together")
        if self.has_barracks is not None and self.owner is None:
            raise ValueError("barracks only for an own city or a city of the enemy (DEC-31)")
        if self.building is not None and self.warehouse_level is None:
            raise ValueError("a building only for an own city")
        if self.warehouse is not None and self.detail is not Detail.EXACT:
            raise ValueError("a warehouse only for a source of vision, seen exactly")
        _check_seen(self.detail, self.seen)
        if self.attrition_in is not None and self.grace_left is not None:
            raise ValueError("attrition_in and grace_left exclude each other")
        if (self.attrition_in is not None or self.grace_left is not None) and (
            self.detail is not Detail.EXACT
        ):
            raise ValueError("an overcrowding countdown only for a node seen exactly")
        return self


class UpgradeGain(WireModel):
    """What the next road level would give (DEC-28, item 7)."""

    speed_pct: NonNegInt
    """Packet speed gain in percentage points."""
    unit_speed_pct: NonNegInt
    """Unit speed gain in percentage points (``road.speed_pct``)."""
    amount: NonNegInt
    """Gain of charges per dispatch period (``supply.amount_by_level``)."""


class HalfView(WireModel):
    """A half of an edge, from its node to the border point (DEC-21, item 5)."""

    detail: Detail
    """The level of the node the half belongs to (a source's half is ``exact``), at least
    ``presence`` while an own group is on the edge (DEC-10, item 2)."""
    seen: Seen | None
    """The enemy groups in the half now (those in a fight too) unless ``detail`` is ``fog``; for
    ``fog`` the last sighting (no positions, DEC-33, detail 8), or ``None``."""

    @model_validator(mode="after")
    def _check(self) -> Self:
        _check_seen(self.detail, self.seen)
        return self


class EnemyGroup(WireModel):
    """An enemy group on a half of an edge not in fog (DEC-33): a figure. A group in a fight is
    not one: the fight shows it."""

    id: OpaqueId
    """Opaque, new each time the group comes out of the fog (DEC-33, detail 5)."""
    pos: Progress
    """Position in thousandths of the edge from its end ``a`` (detail 1)."""
    toward_b: bool
    """Goes to the end ``b``, else to ``a``: the nearest node, never the target (detail 2)."""
    detail: Detail
    """The level of its half: ``exact``, ``range`` or ``presence``."""
    mode: Mode
    units: NonNegInt | None
    """Only on ``exact``."""
    charged: NonNegInt | None
    """Only on ``exact``."""
    units_range: UnitsRange | None
    """Only on ``range``: the range of its units."""

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.detail is Detail.FOG:
            raise ValueError("a figure is never in fog")
        exact = self.detail is Detail.EXACT
        if exact != (self.units is not None) or exact != (self.charged is not None):
            raise ValueError("units and charged are given exactly when detail is exact")
        if (self.detail is Detail.RANGE) != (self.units_range is not None):
            raise ValueError("units_range is given exactly when detail is range")
        if self.units is not None and self.charged is not None and self.charged > self.units:
            raise ValueError("charged must not exceed units")
        return self


class EdgeView(WireModel):
    id: EdgeId
    width: Width
    """Road level the player knows (DEC-17, DEC-22): the current one unless ``detail`` is
    ``fog``; in fog the last seen level, or 1 if never seen. Never above the true level."""
    detail: Detail
    """The road level visibility (DEC-17): ``presence`` while an end is a source of vision or an
    own group is on the edge (DEC-10, item 5), else ``fog``. What is seen of enemies is in
    ``halves`` and ``enemy_groups``."""
    upgrade_gain: UpgradeGain | None
    """Only for own internal edges that can still be upgraded."""
    halves: tuple[HalfView, HalfView]
    """The half of the end ``a``, then the half of the end ``b`` (DEC-21, item 5)."""
    build: EdgeBuild | None
    """The road level being built here (DEC-28, item 7): an own build always, an enemy one only
    while the edge is not in fog (DEC-17, item 5)."""
    enemy_groups: tuple[EnemyGroup, ...]
    """Enemy figures on the halves not in fog (DEC-33)."""

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.detail not in (Detail.PRESENCE, Detail.FOG):
            raise ValueError("edge detail is presence or fog")
        if self.enemy_groups and all(h.detail is Detail.FOG for h in self.halves):
            raise ValueError("no figures on an edge with both halves in fog")
        if len({g.id for g in self.enemy_groups}) != len(self.enemy_groups):
            raise ValueError("ids of enemy_groups must be unique")
        return self


def _check_seen(detail: Detail, seen: Seen | None) -> None:
    if detail is not Detail.FOG and (seen is None or seen.level is not detail):
        raise ValueError("a place not in fog carries its current sighting with the same level")


class AtNodeLoc(WireModel):
    kind: Literal["node"] = "node"
    node: NodeId


class OnEdgeLoc(WireModel):
    """Moving along ``edge`` away from ``from_node``; ``progress`` in thousandths."""

    kind: Literal["edge"] = "edge"
    edge: EdgeId
    from_node: NodeId
    progress: Progress


type Location = Annotated[AtNodeLoc | OnEdgeLoc, Field(discriminator="kind")]


class OrderView(WireModel):
    """Current order of an own group: the path is the server's, the client never computes it."""

    dest: NodeId
    path: Annotated[tuple[NodeId, ...], Field(min_length=1)]
    """Remaining nodes to ``dest``, ``dest`` included."""
    planned: bool
    bonus: NonNegInt
    """A planned order: the bonus it brings into its first fight (DEC-29: per edge of the path,
    at most the charged units of the group). Before the departure a forecast by the charged units
    now; the cap is taken in the departure tick. 0 for a normal order and once the bonus entered
    a fight. Only own orders exist in a view (owner 2026-10-21, mockup #339)."""


class GroupView(WireModel):
    """An own group. Enemy groups appear only as ``Seen`` summaries of places."""

    id: OpaqueId
    units: NonNegInt
    charged: NonNegInt
    mode: Mode
    location: Location
    order: OrderView | None
    defense_bonus: NonNegInt | None
    """In Defense (DEC-30): the bonus the group would bring into a fight beginning now, what it
    has gathered at most ``defense_cap``; ``None`` in another mode. Enemy groups never have it."""
    defense_cap: NonNegInt | None
    """In Defense: the cap of its bonus, the charged units of the group (DEC-30, item 2)."""

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.charged > self.units:
            raise ValueError("charged must not exceed units")
        defense = self.mode is Mode.DEFENSE
        if (self.defense_bonus is not None, self.defense_cap is not None) != (defense, defense):
            raise ValueError("defense_bonus and defense_cap are set exactly in Defense")
        if self.defense_cap is not None and not (
            self.defense_bonus is not None and self.defense_bonus <= self.defense_cap
        ):
            raise ValueError("defense_bonus must not exceed defense_cap")
        return self


class PacketView(WireModel):
    """Own charges on the way along a path of roads (mechanics.md, section 7; DEC-18, item 5).

    ``edge`` is the current road, travelled away from ``from_node`` during
    ``depart_tick..arrive_tick``; ``path``: the nodes still to reach, the end of ``edge`` first,
    the destination last; ``dest_tick``: the tick it reaches the destination if nothing stops it.
    ``transfer``: a one-off transfer (DEC-18, item 6), not the automatic dispatch.
    """

    id: OpaqueId
    edge: EdgeId
    from_node: NodeId
    charges: NonNegInt
    depart_tick: Tick
    arrive_tick: Tick
    path: Annotated[tuple[NodeId, ...], Field(min_length=1)]
    dest_tick: Tick
    transfer: bool

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.arrive_tick < self.depart_tick:
            raise ValueError("arrive_tick must not be before depart_tick")
        if self.dest_tick < self.arrive_tick:
            raise ValueError("dest_tick must not be before arrive_tick")
        return self


class IntentView(WireModel):
    """Public part of a planned order or a mode switch: no group id and no group size."""

    id: OpaqueId
    owner: PlayerId
    kind: IntentKind
    origin: NodeId
    target: NodeId | None
    """``None`` for an intent without a destination (``defense``)."""
    created_tick: Tick


class FightRoundView(WireModel):
    """The latest round of a fight (DEC-24, item I1 as revised with DEC-29), both players, index
    = player id: ``shots`` made (cancelling and killing ones), ``virtual`` among them (bonuses,
    terrain), ``spent`` charges that left the player's units, ``losses`` in units. The same
    numbers as the ``fight_round`` event of that ``tick``."""

    tick: Tick
    shots: tuple[NonNegInt, NonNegInt]
    virtual: tuple[NonNegInt, NonNegInt]
    spent: tuple[NonNegInt, NonNegInt]
    losses: tuple[NonNegInt, NonNegInt]

    @model_validator(mode="after")
    def _check(self) -> Self:
        if any(v > s for v, s in zip(self.virtual, self.shots, strict=True)):
            raise ValueError("virtual shots must not exceed shots")
        return self


class FightView(WireModel):
    """A fight going on (DEC-24, item I1): a node, or an edge with the meeting ``point``.

    ``point``: twice the meeting position in thousandths from the end ``a`` of the edge
    (0..2000); the mark sits at ``point / 2000`` of the edge from ``a`` (item C3). ``groups``:
    the own groups in the fight. ``enemy_units`` and ``enemy_charged``: the enemy's totals in this
    fight, exact. A round happens at ``next_round_tick``, every ``combat.round_ticks``.
    ``shots`` and ``losses``: totals of the fight so far by player; ``last_round``: the latest
    round of both players, ``None`` before the first one. ``virtual_left``: the virtual shots
    (bonuses, mountains) still left by player, public to both while the fight goes on (DEC-32,
    item 3); it grows when a reinforcement with a bonus joins and drops after each round.
    ``mute``: by player, the charged units in the fight that do not shoot in a round because of
    the terrain (plains: one of the defender, DEC-24, item F2), at most the side's charged units.
    """

    id: OpaqueId
    node: NodeId | None
    edge: EdgeId | None
    point: Annotated[int, Field(ge=0, le=2000)] | None
    attacker: PlayerId | None
    """The player attacking the node; ``None`` on an edge and in a neutral node."""
    start_tick: Tick
    next_round_tick: Tick
    groups: tuple[OpaqueId, ...]
    enemy_units: NonNegInt
    enemy_charged: NonNegInt
    shots: tuple[NonNegInt, NonNegInt]
    losses: tuple[NonNegInt, NonNegInt]
    virtual_left: tuple[NonNegInt, NonNegInt]
    mute: tuple[NonNegInt, NonNegInt]
    last_round: FightRoundView | None

    @model_validator(mode="after")
    def _check(self) -> Self:
        if (self.node is None) == (self.edge is None):
            raise ValueError("a fight is in a node or on an edge")
        if (self.point is None) != (self.edge is None):
            raise ValueError("point is given exactly for a fight on an edge")
        if self.next_round_tick <= self.start_tick:
            raise ValueError("next_round_tick must be after start_tick")
        if self.enemy_charged > self.enemy_units:
            raise ValueError("enemy_charged must not exceed enemy_units")
        return self


class SelfView(WireModel):
    """Own counters; the enemy's CP and stance are never in a view (AGENTS.md, section 4.4)."""

    cp: Centi
    stance: Stance
    fronts: tuple[NodeId | None, ...]
    """The own cities of the front markers (DEC-28, item 2; ``supply.front_markers`` of
    ``ruleset_public``), ``null``: not placed. The enemy's markers are never in a view."""
    rear_min: NonNegInt
    """The own rear minimum (DEC-28, item 3); the enemy's is never in a view."""


class View(WireModel):
    me: SelfView
    vp: tuple[NonNegInt, NonNegInt]
    """VP of both players, by player id; public (DEC-04)."""
    nodes: tuple[NodeView, ...]
    """Every node of the map, ``nodes[i].id == i``."""
    edges: tuple[EdgeView, ...]
    """Every edge of the map, ``edges[i].id == i``."""
    groups: tuple[GroupView, ...]
    packets: tuple[PacketView, ...]
    intents: tuple[IntentView, ...]
    fights: tuple[FightView, ...]
    """Fights going on (DEC-24): own groups fight in each."""

    @field_validator("nodes", "edges")
    @classmethod
    def _dense(cls, items: tuple[NodeView, ...] | tuple[EdgeView, ...]) -> object:
        for index, item in enumerate(items):
            if item.id != index:
                raise ValueError(
                    f"ids must be 0..{len(items) - 1} in order, got {item.id} at {index}"
                )
        return items

    @model_validator(mode="after")
    def _check_refs(self) -> Self:
        for entities in (self.groups, self.packets, self.intents, self.fights):
            ids = [e.id for e in entities]
            if len(set(ids)) != len(ids):
                raise ValueError(
                    "ids of groups, packets, intents and fights must be unique in their list"
                )
        nodes, edges = len(self.nodes), len(self.edges)
        refs_nodes: list[int] = []
        refs_edges: list[int] = []
        for group in self.groups:
            match group.location:
                case AtNodeLoc(node=node):
                    refs_nodes.append(node)
                case OnEdgeLoc(edge=edge, from_node=from_node):
                    refs_edges.append(edge)
                    refs_nodes.append(from_node)
            if group.order is not None:
                refs_nodes.extend((group.order.dest, *group.order.path))
        for packet in self.packets:
            refs_edges.append(packet.edge)
            refs_nodes.extend((packet.from_node, *packet.path))
        for intent in self.intents:
            refs_nodes.append(intent.origin)
            if intent.target is not None:
                refs_nodes.append(intent.target)
        own = {g.id for g in self.groups}
        for fight in self.fights:
            if fight.node is not None:
                refs_nodes.append(fight.node)
            if fight.edge is not None:
                refs_edges.append(fight.edge)
            if any(g not in own for g in fight.groups):
                raise ValueError("a fight names a group that is not an own group of the view")
        if any(n >= nodes for n in refs_nodes) or any(e >= edges for e in refs_edges):
            raise ValueError(
                "a group, packet, intent, build or fight refers to a node or edge not in the view"
            )
        return self
