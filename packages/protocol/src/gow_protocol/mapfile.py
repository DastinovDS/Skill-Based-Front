"""Map file as it goes to the client: ``GET /api/maps/{id}`` serves ``maps/<id>.json`` as is.

The format is ``docs/design/map-format.md``; the loader ``gow_sim.maps.parse_map`` (MAP-01, #13)
is the authority on it. This model describes the same JSON only to give the client generated
TypeScript types (PRO-02, #45): it fixes the shape and the value types, while references,
ranges between fields, the mirror table and the design checks stay with the loader and
``gow-maps validate``. ``packages/protocol/tests/test_mapfile.py`` keeps both in agreement on
every bundled map.
"""

from typing import Literal

from gow_protocol.base import EdgeId, MapId, NodeId, NonNegInt, PlayerId, PosInt, Width, WireModel
from gow_sim.maps import NodeKind, Terrain


class MapMetaFile(WireModel):
    name: MapId
    """Map id: ``map_id`` in ``welcome`` and in the replay header."""
    version: PosInt
    """Revision of the map, bumped on every edit."""
    symmetry: Literal["rot180"]
    width: PosInt
    """World size: coordinates are in ``[0, width] x [0, height]``, ``y`` grows down."""
    height: PosInt


class MapNodeFile(WireModel):
    id: NodeId
    """Equals the index in ``nodes``."""
    x: NonNegInt
    y: NonNegInt
    terrain: Terrain
    vp: NonNegInt
    kind: NodeKind
    """Node kind: its capacity is ``capacity.by_kind`` of the ruleset (DEC-22)."""
    capital_of: PlayerId | None
    start_owner: PlayerId | None
    start_units: NonNegInt
    start_charged: NonNegInt
    start_stock: NonNegInt


class MapEdgeFile(WireModel):
    id: EdgeId
    """Equals the index in ``edges``."""
    a: NodeId
    b: NodeId
    base_width: Width
    """Road level at the start: always 1 (DEC-22)."""
    max_width: Width
    """Highest road level, at most 3 (DEC-22)."""
    travel_ticks: PosInt


class MapMirrorFile(WireModel):
    """Symmetry table: id (as a JSON string key) -> id of the mirrored node or edge."""

    nodes: dict[str, NodeId]
    edges: dict[str, EdgeId]


class MapFile(WireModel):
    meta: MapMetaFile
    nodes: tuple[MapNodeFile, ...]
    edges: tuple[MapEdgeFile, ...]
    mirror: MapMirrorFile
