"""The player's view on the wire: the ``view`` of a ``snapshot`` message.

It carries a ``PlayerView`` (``gow_sim.view.project()``, SIM-14 #30) and nothing else; the
conversion is PRO-03 (#46). The shape follows DEC-04 (mechanics.md, section 10) and the list of
what a view must not contain (AGENTS.md, section 4.4):

- public to everyone: ownership and capacity (DEC-22) of every node, road levels and types
  (DEC-17: last seen in fog), VP of both players,
  intents of planned orders and «Защита» (origin, target, kind; no group id, no size);
- road builds of cities (DEC-16): own ones always, with ``done_tick``; an enemy one without
  ``done_tick`` and only while its edge is not in fog (DEC-17, item 5);
- ``EXACT`` places (own nodes, nodes where own groups stand): everything with numbers;
- ``PRESENCE`` places (neighbours of ``EXACT`` nodes and edges touching them): whether enemy
  groups are there and their modes, no numbers;
- ``FOG``: only the last sighting from the fog memory.

Deliberate choices of the wire format:

- ``groups`` and ``packets`` are **own** entities only. What the player knows about enemy groups
  is the per-place ``Seen`` summary (modes, and totals only where ``EXACT``), the same shape as the
  fog memory ``gow_sim.state.Sighting``. So the view has no enemy entity ids at all, which could
  otherwise track enemy groups through the fog or reveal their number. Enemy packets are never
  visible (DEC-10 default, #112).
- Own-only data (``me``: CP and stance; ``upgrade_gain`` of own edges; orders of own groups) has
  no enemy counterpart in the view.
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
from gow_sim.state import Detail, IntentKind, Mode, RoadKind


class Seen(WireModel):
    """What the player sees, or last saw, of one node or edge (``gow_sim.state.Sighting``).

    ``enemy_modes``: distinct modes of the enemy groups there; empty means no enemy groups.
    ``enemy_units`` and ``enemy_charged`` are totals, present only when ``level`` is ``EXACT``.
    ``level`` is never ``FOG``: a place in fog is not seen, it keeps an older ``Seen``.
    """

    tick: Tick
    level: Detail
    enemy_modes: Annotated[tuple[Mode, ...], Field(max_length=len(Mode))]
    enemy_units: NonNegInt | None
    enemy_charged: NonNegInt | None

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.level is Detail.FOG:
            raise ValueError("level of a sighting is exact or presence, never fog")
        if len(set(self.enemy_modes)) != len(self.enemy_modes):
            raise ValueError("enemy_modes must be distinct")
        exact = self.level is Detail.EXACT
        if exact != (self.enemy_units is not None) or exact != (self.enemy_charged is not None):
            raise ValueError("enemy_units and enemy_charged are given exactly when level is exact")
        if (
            self.enemy_units is not None
            and self.enemy_charged is not None
            and self.enemy_charged > self.enemy_units
        ):
            raise ValueError("enemy_charged must not exceed enemy_units")
        return self


class NodeBuild(WireModel):
    """A road level the city builds (DEC-16): ``edge`` is one of the city's roads."""

    edge: EdgeId
    done_tick: Tick | None
    """The tick the width grows; only for an own build."""


class NodeView(WireModel):
    id: NodeId
    owner: PlayerId | None
    capacity: NonNegInt
    """Capacity by the node kind (DEC-22, item 1): public and exact for every node."""
    detail: Detail
    warehouse: NonNegInt | None
    """Charges in the warehouse; only for ``EXACT`` nodes."""
    seen: Seen | None
    """Current sighting for ``EXACT`` and ``PRESENCE``; for ``FOG`` the last one, or ``None``."""
    build: NodeBuild | None
    """The city's road build (DEC-16): own always, an enemy one only while its edge is unfogged."""
    attrition_in: PosInt | None
    """Own node only: ticks until the next unit dies of overcrowding (the garrison exceeds the
    capacity and the grace after a capture is over). ``None`` for every other node."""
    grace_left: PosInt | None
    """Own node only: ticks the grace after a capture still lasts while the garrison exceeds the
    capacity. ``None`` for every other node."""

    @model_validator(mode="after")
    def _check(self) -> Self:
        if (self.detail is Detail.EXACT) != (self.warehouse is not None):
            raise ValueError("warehouse is given exactly when detail is exact")
        _check_seen(self.detail, self.seen)
        if self.attrition_in is not None and self.grace_left is not None:
            raise ValueError("attrition_in and grace_left exclude each other")
        if (self.attrition_in is not None or self.grace_left is not None) and (
            self.detail is not Detail.EXACT
        ):
            raise ValueError("an overcrowding countdown only for a node seen exactly")
        return self


class RoadGain(WireModel):
    """What one more level of one road type adds (DEC-22, item 7)."""

    speed_pct: NonNegInt
    """Packet speed gain in percentage points."""
    amount: NonNegInt
    """Gain in charges per road and dispatch period."""


class UpgradeGain(WireModel):
    """What the next road level would give, per road type (DEC-22, item 7): both types on
    level 1, only the road's own type on level 2."""

    fast: RoadGain | None
    freight: RoadGain | None


class EdgeView(WireModel):
    id: EdgeId
    width: Width
    """Road level the player knows (DEC-17, DEC-22): the current one unless ``detail`` is
    ``fog``; in fog the last seen level, or 1 if never seen. Never above the true level."""
    kind: RoadKind
    """Road type the player knows, by the same rule (DEC-22, item 8): ``none`` on level 1."""
    detail: Detail
    """``PRESENCE`` or ``FOG``: DEC-04 never shows numbers on edges."""
    upgrade_gain: UpgradeGain | None
    """Only for own internal edges that can still be upgraded."""
    seen: Seen | None

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.detail is Detail.EXACT:
            raise ValueError("edge detail is presence or fog, never exact")
        _check_seen(self.detail, self.seen)
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


class GroupView(WireModel):
    """An own group. Enemy groups appear only as ``Seen`` summaries of places."""

    id: OpaqueId
    units: NonNegInt
    charged: NonNegInt
    mode: Mode
    location: Location
    order: OrderView | None

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.charged > self.units:
            raise ValueError("charged must not exceed units")
        return self


class PacketView(WireModel):
    """Own charges on the way (mechanics.md, section 7)."""

    id: OpaqueId
    edge: EdgeId
    from_node: NodeId
    charges: NonNegInt
    depart_tick: Tick
    arrive_tick: Tick

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.arrive_tick < self.depart_tick:
            raise ValueError("arrive_tick must not be before depart_tick")
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


class SelfView(WireModel):
    """Own counters; the enemy's CP and stance are never in a view (AGENTS.md, section 4.4)."""

    cp: Centi
    stance: Stance


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
        for entities in (self.groups, self.packets, self.intents):
            ids = [e.id for e in entities]
            if len(set(ids)) != len(ids):
                raise ValueError("ids of groups, packets and intents must be unique in their list")
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
            refs_nodes.append(packet.from_node)
        for intent in self.intents:
            refs_nodes.append(intent.origin)
            if intent.target is not None:
                refs_nodes.append(intent.target)
        refs_edges.extend(n.build.edge for n in self.nodes if n.build is not None)
        if any(n >= nodes for n in refs_nodes) or any(e >= edges for e in refs_edges):
            raise ValueError(
                "a group, packet, intent or build refers to a node or edge not in the view"
            )
        return self
