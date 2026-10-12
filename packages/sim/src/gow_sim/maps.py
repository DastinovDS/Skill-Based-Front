"""Map definition (MapDef) and the JSON map loader.

The format is described in ``docs/design/map-format.md``. The loader checks structure,
references and value ranges; design properties of a map (connectivity, planarity, symmetry of
attributes, neutral space) are checked offline by ``gow-maps validate`` (tools/maps).

File I/O is allowed in this module (AGENTS.md, section 4.1, rule 1).
"""

import dataclasses
import json
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Final

from gow_sim.canonical import digest

PLAYERS: Final = (0, 1)
"""Player ids of a 1v1 match (MVP)."""

MAX_WIDTH: Final = 3
"""Highest road level the format allows: levels 1..3, two upgrades (DEC-22, item 2).

The map fields keep the names ``base_width`` and ``max_width`` until DEC-23 (#235) renames
``max_width`` to ``max_level``; every road starts at level 1 (``base_width`` must be 1)."""

SYMMETRIES: Final = ("rot180",)


class Terrain(StrEnum):
    PLAINS = "plains"
    FOREST = "forest"
    MOUNTAINS = "mountains"


class NodeKind(StrEnum):
    """Kind of a node (DEC-22, item 1; DEC-23, item 1): its capacity is ``capacity.by_kind``."""

    CAPITAL = "capital"
    CITY_LARGE = "city_large"
    CITY_MEDIUM = "city_medium"
    CITY_SMALL = "city_small"
    PROVINCE = "province"
    """A node without a city (DEC-23, item 2): no road upgrades from it (``NOT_CITY``).

    TODO(#235): the other province rules (no warehouse, transit packets, no recruit) come with
    the DEC-23 implementation; the MVP maps have no provinces yet."""


class MapFormatError(ValueError):
    """The map file is malformed: wrong type, broken reference or value out of range."""


@dataclass(frozen=True, slots=True)
class MapMeta:
    name: str
    version: int
    symmetry: str
    width: int
    height: int


@dataclass(frozen=True, slots=True)
class NodeDef:
    id: int
    x: int
    y: int
    terrain: Terrain
    vp: int
    kind: NodeKind
    capital_of: int | None
    start_owner: int | None
    start_units: int
    start_charged: int
    start_stock: int


@dataclass(frozen=True, slots=True)
class EdgeDef:
    id: int
    a: int
    b: int
    base_width: int
    max_width: int
    travel_ticks: int

    def other(self, node: int) -> int:
        """The opposite end of the edge from ``node``."""
        return self.b if node == self.a else self.a


@dataclass(frozen=True, slots=True)
class MapDef:
    """A loaded map. Node and edge ids equal their index: ``nodes[i].id == i``."""

    meta: MapMeta
    nodes: tuple[NodeDef, ...]
    edges: tuple[EdgeDef, ...]
    mirror_nodes: tuple[int, ...]
    """``mirror_nodes[n]``: the node that ``n`` maps to under the map symmetry."""
    mirror_edges: tuple[int, ...]
    incident: tuple[tuple[int, ...], ...]
    """``incident[n]``: ids of the edges touching node ``n``, ascending."""

    def capital(self, player: int) -> int:
        """Node id of the capital of ``player``."""
        for node in self.nodes:
            if node.capital_of == player:
                return node.id
        raise KeyError(player)  # unreachable for a loaded map: every player has a capital

    def node_key(self, player: int, node: int) -> int:
        """Tie-break key for nodes (AGENTS.md, section 4.1, rule 6).

        Player 0 uses the node id, player 1 the id of the mirror node, so a decision taken on
        the mirrored position is the mirrored decision.
        """
        return node if player == 0 else self.mirror_nodes[node]


def load_map(path: str | Path) -> MapDef:
    """Read and check a map JSON file. Raises MapFormatError with the path and the location."""
    path = Path(path)
    try:
        data: object = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise MapFormatError(f"{path}: invalid JSON: {exc}") from exc
    try:
        return parse_map(data)
    except MapFormatError as exc:
        raise MapFormatError(f"{path}: {exc}") from exc


def parse_map(data: object) -> MapDef:
    """Build a MapDef from parsed JSON. Raises MapFormatError naming the offending field."""
    root = _obj(data, "map", ("meta", "nodes", "edges", "mirror"))
    meta = _parse_meta(root["meta"])
    nodes = tuple(
        _parse_node(raw, f"nodes[{i}]", i, meta)
        for i, raw in enumerate(_list(root["nodes"], "nodes"))
    )
    if not nodes:
        raise MapFormatError("nodes: the map has no nodes")
    edges = tuple(
        _parse_edge(raw, f"edges[{i}]", i, len(nodes))
        for i, raw in enumerate(_list(root["edges"], "edges"))
    )
    _check_edges_unique(edges)
    _check_capitals(nodes)
    mirror = _obj(root["mirror"], "mirror", ("nodes", "edges"))
    mirror_nodes = _parse_mirror(mirror["nodes"], "mirror.nodes", len(nodes))
    mirror_edges = _parse_mirror(mirror["edges"], "mirror.edges", len(edges))
    incident: list[list[int]] = [[] for _ in nodes]
    for edge in edges:
        incident[edge.a].append(edge.id)
        incident[edge.b].append(edge.id)
    return MapDef(
        meta=meta,
        nodes=nodes,
        edges=edges,
        mirror_nodes=mirror_nodes,
        mirror_edges=mirror_edges,
        incident=tuple(tuple(ids) for ids in incident),
    )


def map_to_data(mapdef: MapDef) -> dict[str, object]:
    """The map as JSON data in the file format, the inverse of ``parse_map``.

    ``parse_map(map_to_data(m)) == m``; for a loaded file the result equals the parsed JSON.
    The canonical game state embeds the map in this form (SIM-02).
    """
    return {
        "meta": dataclasses.asdict(mapdef.meta),
        "nodes": [
            {**dataclasses.asdict(n), "terrain": n.terrain.value, "kind": n.kind.value}
            for n in mapdef.nodes
        ],
        "edges": [dataclasses.asdict(e) for e in mapdef.edges],
        "mirror": {
            "nodes": {str(i): m for i, m in enumerate(mapdef.mirror_nodes)},
            "edges": {str(i): m for i, m in enumerate(mapdef.mirror_edges)},
        },
    }


def map_hash(mapdef: MapDef) -> str:
    """blake2b of the canonical JSON of ``map_to_data``: the ``map_hash`` of a replay header."""
    return digest(map_to_data(mapdef))


def _parse_meta(data: object) -> MapMeta:
    raw = _obj(data, "meta", ("name", "version", "symmetry", "width", "height"))
    name = raw["name"]
    if (
        not isinstance(name, str)
        or not name
        or not all(c.isascii() and (c.isalnum() or c in "-_") for c in name)
    ):
        raise MapFormatError(f"meta.name: expected a non-empty [A-Za-z0-9_-] string, got {name!r}")
    symmetry = raw["symmetry"]
    if symmetry not in SYMMETRIES:
        raise MapFormatError(f"meta.symmetry: expected one of {list(SYMMETRIES)}, got {symmetry!r}")
    return MapMeta(
        name=name,
        version=_int(raw["version"], "meta.version", low=1),
        symmetry=str(symmetry),
        width=_int(raw["width"], "meta.width", low=1),
        height=_int(raw["height"], "meta.height", low=1),
    )


_NODE_KEYS: Final = (
    "id",
    "x",
    "y",
    "terrain",
    "vp",
    "kind",
    "capital_of",
    "start_owner",
    "start_units",
    "start_charged",
    "start_stock",
)


def _parse_node(data: object, where: str, index: int, meta: MapMeta) -> NodeDef:
    raw = _obj(data, where, _NODE_KEYS)
    node_id = _int(raw["id"], f"{where}.id")
    if node_id != index:
        raise MapFormatError(
            f"{where}.id: node ids must be 0..N-1 in file order, expected {index}, got {node_id}"
        )
    terrain = raw["terrain"]
    if terrain not in [t.value for t in Terrain]:
        raise MapFormatError(
            f"{where}.terrain: expected one of {[t.value for t in Terrain]}, got {terrain!r}"
        )
    kind = raw["kind"]
    if kind not in [k.value for k in NodeKind]:
        raise MapFormatError(
            f"{where}.kind: expected one of {[k.value for k in NodeKind]}, got {kind!r}"
        )
    units = _int(raw["start_units"], f"{where}.start_units", low=0)
    node = NodeDef(
        id=node_id,
        x=_int(raw["x"], f"{where}.x", low=0, high=meta.width),
        y=_int(raw["y"], f"{where}.y", low=0, high=meta.height),
        terrain=Terrain(str(terrain)),
        vp=_int(raw["vp"], f"{where}.vp", low=0),
        kind=NodeKind(str(kind)),
        capital_of=_player(raw["capital_of"], f"{where}.capital_of"),
        start_owner=_player(raw["start_owner"], f"{where}.start_owner"),
        start_units=units,
        start_charged=_int(raw["start_charged"], f"{where}.start_charged", low=0, high=units),
        start_stock=_int(raw["start_stock"], f"{where}.start_stock", low=0),
    )
    if node.capital_of is not None and node.start_owner != node.capital_of:
        raise MapFormatError(
            f"{where}.start_owner: the capital of player {node.capital_of} must start owned by it"
        )
    if (node.kind is NodeKind.CAPITAL) != (node.capital_of is not None):
        # DEC-23, item 3: kind = capital if and only if capital_of is not null.
        raise MapFormatError(f"{where}.kind: 'capital' exactly for the node with capital_of")
    if node.kind is NodeKind.PROVINCE and (
        node.vp or node.start_units or node.start_charged or node.start_stock
    ):
        # DEC-23, item 2: a province has no VP, no starting garrison and no warehouse.
        raise MapFormatError(f"{where}: a province has vp 0 and no garrison or warehouse")
    if node.start_owner is None and (node.start_units or node.start_stock):
        # There is no neutral player: neutral nodes start empty (mechanics.md, section 9).
        raise MapFormatError(f"{where}: a neutral node has no garrison and an empty warehouse")
    return node


def _parse_edge(data: object, where: str, index: int, node_count: int) -> EdgeDef:
    raw = _obj(data, where, ("id", "a", "b", "base_width", "max_width", "travel_ticks"))
    edge_id = _int(raw["id"], f"{where}.id")
    if edge_id != index:
        raise MapFormatError(
            f"{where}.id: edge ids must be 0..E-1 in file order, expected {index}, got {edge_id}"
        )
    a = _int(raw["a"], f"{where}.a", low=0, high=node_count - 1)
    b = _int(raw["b"], f"{where}.b", low=0, high=node_count - 1)
    if a == b:
        raise MapFormatError(f"{where}: an edge must join two different nodes, got a == b == {a}")
    max_width = _int(raw["max_width"], f"{where}.max_width", low=1, high=MAX_WIDTH)
    return EdgeDef(
        id=edge_id,
        a=a,
        b=b,
        # Every road starts at level 1 without a type (DEC-22, item 2).
        base_width=_int(raw["base_width"], f"{where}.base_width", low=1, high=1),
        max_width=max_width,
        travel_ticks=_int(raw["travel_ticks"], f"{where}.travel_ticks", low=1),
    )


def _check_edges_unique(edges: tuple[EdgeDef, ...]) -> None:
    seen: dict[tuple[int, int], int] = {}
    for edge in edges:
        pair = (min(edge.a, edge.b), max(edge.a, edge.b))
        if pair in seen:
            raise MapFormatError(
                f"edges[{edge.id}]: duplicates edges[{seen[pair]}]"
                f" between nodes {pair[0]} and {pair[1]}"
            )
        seen[pair] = edge.id


def _check_capitals(nodes: tuple[NodeDef, ...]) -> None:
    for player in PLAYERS:
        capitals = [n.id for n in nodes if n.capital_of == player]
        if len(capitals) != 1:
            raise MapFormatError(
                f"nodes: player {player} must have exactly one capital, found {capitals}"
            )


def _parse_mirror(data: object, where: str, count: int) -> tuple[int, ...]:
    if not isinstance(data, dict):
        raise MapFormatError(f"{where}: expected an object {{id: id}}, got {type(data).__name__}")
    table: dict[int, int] = {}
    items: dict[object, object] = data  # pyright: ignore[reportUnknownVariableType]
    for key, value in items.items():
        if not isinstance(key, str) or not key.isdigit():
            raise MapFormatError(f"{where}: key {key!r} is not an id")
        source = int(key)
        if source >= count:
            raise MapFormatError(f"{where}: key {source} does not exist")
        table[source] = _int(value, f"{where}[{source}]", low=0, high=count - 1)
    missing = [i for i in range(count) if i not in table]
    if missing:
        raise MapFormatError(f"{where}: no mirror for ids {missing}")
    for source in range(count):
        if table[table[source]] != source:
            raise MapFormatError(
                f"{where}: not an involution, {source} -> {table[source]} -> {table[table[source]]}"
            )
    return tuple(table[i] for i in range(count))


def _obj(data: object, where: str, keys: tuple[str, ...]) -> dict[str, object]:
    if not isinstance(data, dict):
        raise MapFormatError(f"{where}: expected an object, got {type(data).__name__}")
    raw: dict[str, object] = data  # pyright: ignore[reportUnknownVariableType]
    unknown = sorted(k for k in raw if k not in keys)
    if unknown:
        raise MapFormatError(f"{where}: unknown keys {unknown}")
    missing = [k for k in keys if k not in raw]
    if missing:
        raise MapFormatError(f"{where}: missing keys {missing}")
    return raw


def _list(data: object, where: str) -> list[object]:
    if not isinstance(data, list):
        raise MapFormatError(f"{where}: expected a list, got {type(data).__name__}")
    items: list[object] = data  # pyright: ignore[reportUnknownVariableType]
    return items


def _int(value: object, where: str, low: int | None = None, high: int | None = None) -> int:
    # bool is a subclass of int in Python; a JSON true/false is not a number here.
    if isinstance(value, bool) or not isinstance(value, int):
        raise MapFormatError(f"{where}: expected an integer, got {value!r}")
    if (low is not None and value < low) or (high is not None and value > high):
        bounds = f"[{'' if low is None else low}..{'' if high is None else high}]"
        raise MapFormatError(f"{where}: {value} is out of range {bounds}")
    return value


def _player(value: object, where: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or value not in PLAYERS:
        raise MapFormatError(
            f"{where}: expected null or a player id {list(PLAYERS)}, got {value!r}"
        )
    return _int(value, where)
