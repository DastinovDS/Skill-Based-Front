"""Map file as it goes to the client: ``GET /api/maps/{id}`` serves ``maps/<id>.json`` as is.

The format is ``docs/design/map-format.md``; the loader ``gow_sim.maps.parse_map`` (MAP-01, #13)
is the authority on it. This model describes the same JSON only to give the client generated
TypeScript types (PRO-02, #45): it fixes the shape and the value types, while references,
ranges between fields, the mirror table and the design checks stay with the loader and
``gow-maps validate``. ``packages/protocol/tests/test_mapfile.py`` keeps both in agreement on
every bundled map.
"""

from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from gow_protocol.base import EdgeId, MapId, NodeId, NonNegInt, PlayerId, PosInt, Width, WireModel
from gow_sim.maps import BORDER_MAX, BORDER_MIN, NAME_MAX_LEN, NodeKind, Terrain

NodeName = Annotated[str, StringConstraints(min_length=1, max_length=NAME_MAX_LEN)]
"""Name of a node (DEC-23, item 4); uniqueness and spaces at the ends: ``gow-maps validate``."""
BorderPermille = Annotated[int, Field(ge=BORDER_MIN, le=BORDER_MAX)]
"""Border point of an edge in thousandths from its end ``a`` (DEC-23, item 5)."""


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
    name: NodeName
    """Name of the node shown by the interface (DEC-23, item 4): not translated."""
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
    max_level: Width
    """Highest road level, at most 3 (DEC-23, item 6); every road starts at level 1 (DEC-22)."""
    travel_ticks: PosInt
    border_permille: BorderPermille
    """Border point in thousandths from ``a`` (DEC-23, item 5): where the halves of the edge meet
    (vision DEC-21, territory on the map)."""


class MapMirrorFile(WireModel):
    """Symmetry table: id (as a JSON string key) -> id of the mirrored node or edge."""

    nodes: dict[str, NodeId]
    edges: dict[str, EdgeId]


class MapFile(WireModel):
    meta: MapMetaFile
    nodes: tuple[MapNodeFile, ...]
    edges: tuple[MapEdgeFile, ...]
    mirror: MapMirrorFile
