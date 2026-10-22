"""Build a full rot180 map from a hand-drawn half (MAP-03; DEC-23, item 8; DEC-27, item 6).

Half format (``maps/src/<name>.half.json``), described in ``docs/design/map-format.md``:

- ``meta``: ``name``, ``version``, ``width``, ``height`` (the symmetry is always rot180: the
  players and the nodes swap by the ``mirror`` table, DEC-27, item 6);
- ``nodes``: like map nodes, but ``id`` is a free string label, plus ``mirror_name`` (the name of
  the copy) and optional ``mirror_x``, ``mirror_y`` (its position, default
  ``(width - x, height - y)``). A node with ``self_mirror: true`` is its own mirror at any
  position and has no copy (nor ``mirror_*`` fields); without the flag, a node exactly at the
  centre ``(width / 2, height / 2)`` and without ``mirror_x``, ``mirror_y`` is its own mirror too
  (halves written before DEC-27);
- ``edges``: ``{a, b, max_level, travel_ticks?, border_permille?}`` between half nodes, copied to
  the mirrors of the ends with the same ``border_permille``; a road between two self-mirrored
  nodes is its own mirror and is written once;
- ``cross_edges``: the same, but joining ``a`` with the *mirror* of ``b`` (roads across the
  central strip); the copy joins ``b`` with the mirror of ``a`` and gets
  ``1000 - border_permille``; ``a == b`` gives one road from a node to its own mirror, which
  needs ``border_permille`` 500.

A missing ``border_permille`` is 500. A missing ``travel_ticks`` is computed from the mean drawn
length of the road and its copy (equal lengths for a rotated copy) with the validator config.

Ids: half nodes that have a copy, in file order, get ``0..k-1``, the self-mirrored nodes follow
in file order, the mirror of node ``i`` is ``N-1-i``. Half edges with a copy get ``0..e-1`` and
their mirrors ``e..2e-1``, roads between two self-mirrored nodes follow in file order; cross edges
come last in file order, each followed by its mirror unless it is its own mirror.
"""

import json
import math
from pathlib import Path
from typing import Any

from gow_maps.validate import ValidatorConfig, expected_travel_ticks
from gow_sim.maps import BORDER_SELF_MIRROR


class HalfFormatError(ValueError):
    """The half map is malformed."""


_META_KEYS = ("name", "version", "width", "height")
_NODE_KEYS = (
    "id",
    "name",
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
_NODE_OPTIONAL = ("mirror_name", "mirror_x", "mirror_y", "self_mirror")
_EDGE_KEYS = ("a", "b", "max_level")
_EDGE_OPTIONAL = ("travel_ticks", "border_permille")


def _obj(
    data: object, where: str, keys: tuple[str, ...], optional: tuple[str, ...] = ()
) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise HalfFormatError(f"{where}: expected an object, got {type(data).__name__}")
    raw: dict[str, Any] = data  # pyright: ignore[reportUnknownVariableType]
    unknown = sorted(k for k in raw if k not in keys + optional)
    missing = [k for k in keys if k not in raw]
    if unknown or missing:
        raise HalfFormatError(f"{where}: unknown keys {unknown}, missing keys {missing}")
    return raw


def _list(data: object, where: str) -> list[object]:
    if not isinstance(data, list):
        raise HalfFormatError(f"{where}: expected a list, got {type(data).__name__}")
    items: list[object] = data  # pyright: ignore[reportUnknownVariableType]
    return items


def _int(value: object, where: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise HalfFormatError(f"{where}: expected an integer, got {value!r}")
    return value


def _swap(player: object) -> object:
    return 1 - player if isinstance(player, int) and not isinstance(player, bool) else player


def _is_self_mirror(node: dict[str, Any], where: str, width: int, height: int) -> bool:
    flag = node.get("self_mirror")
    if flag is not None and not isinstance(flag, bool):
        raise HalfFormatError(f"{where}.self_mirror: expected true or false, got {flag!r}")
    if flag is None:
        # Halves before DEC-27: the node exactly at the centre, without a copy position.
        x, y = _int(node["x"], f"{where}.x"), _int(node["y"], f"{where}.y")
        flag = 2 * x == width and 2 * y == height and not {"mirror_x", "mirror_y"} & set(node)
    if flag:
        extra = sorted(k for k in ("mirror_name", "mirror_x", "mirror_y") if k in node)
        if extra:
            raise HalfFormatError(f"{where}: a self-mirrored node has no copy, remove {extra}")
    elif "mirror_name" not in node:
        raise HalfFormatError(f"{where}: missing key mirror_name (the name of the copy)")
    return flag


def mirror_half(data: object, config: ValidatorConfig) -> dict[str, Any]:
    """Turn a parsed half into a full map (as JSON data). Value types are checked by the loader."""
    root = _obj(data, "half", ("meta", "nodes", "edges", "cross_edges"))
    meta = _obj(root["meta"], "meta", _META_KEYS)
    width, height = _int(meta["width"], "meta.width"), _int(meta["height"], "meta.height")
    half_nodes = [
        _obj(n, f"nodes[{i}]", _NODE_KEYS, _NODE_OPTIONAL)
        for i, n in enumerate(_list(root["nodes"], "nodes"))
    ]
    labels: list[str] = []
    selfs: list[str] = []
    centre: list[str] = []
    for i, node in enumerate(half_nodes):
        label = node["id"]
        if not isinstance(label, str) or not label:
            raise HalfFormatError(
                f"nodes[{i}].id: expected a non-empty string label, got {label!r}"
            )
        if label in labels:
            raise HalfFormatError(f"nodes[{i}].id: duplicate label {label!r}")
        labels.append(label)
        if _is_self_mirror(node, f"nodes[{i}]", width, height):
            selfs.append(label)
            if "self_mirror" not in node:
                centre.append(label)
    if len(centre) > 1:
        raise HalfFormatError(f"nodes: only one node can stand at the centre, got {centre}")
    side = [label for label in labels if label not in selfs]
    total = 2 * len(side) + len(selfs)
    # Half nodes 0..k-1, the self-mirrored nodes next, the mirror of node i is N-1-i.
    node_id = {label: i for i, label in enumerate(side)}
    mirror_id = {label: total - 1 - i for i, label in enumerate(side)}
    for j, label in enumerate(selfs):
        node_id[label] = mirror_id[label] = len(side) + j

    def full_node(node: dict[str, Any], copy: bool) -> dict[str, Any]:
        out = {key: node[key] for key in _NODE_KEYS}
        if copy:
            out |= {
                "name": node["mirror_name"],
                "x": node.get("mirror_x", width - _int(node["x"], "x")),
                "y": node.get("mirror_y", height - _int(node["y"], "y")),
                "capital_of": _swap(node["capital_of"]),
                "start_owner": _swap(node["start_owner"]),
            }
        return out | {"id": mirror_id[node["id"]] if copy else node_id[node["id"]]}

    nodes: list[dict[str, Any]] = []
    for node in half_nodes:
        nodes.append(full_node(node, copy=False))
        if node["id"] not in selfs:
            nodes.append(full_node(node, copy=True))
    nodes.sort(key=lambda n: n["id"])
    node_mirror = {node_id[label]: mirror_id[label] for label in labels}
    node_mirror |= {target: source for source, target in node_mirror.items()}
    position = {n["id"]: (n["x"], n["y"]) for n in nodes}

    def label_id(raw: dict[str, Any], key: str, where: str) -> str:
        label = raw[key]
        if label not in node_id:
            raise HalfFormatError(f"{where}.{key}: unknown node label {label!r}")
        return str(label)

    def length(a: int, b: int) -> float:
        (xa, ya), (xb, yb) = position[a], position[b]
        return math.hypot(xa - xb, ya - yb)

    def roads(
        raw: dict[str, Any], where: str, ends: tuple[int, int], copy: tuple[int, int] | None
    ) -> list[dict[str, Any]]:
        """The road and its copy (``None``: the road is its own mirror); the copy's border
        point is measured from ``copy[0]``, the mirror of ``ends[0]`` or of ``ends[1]``."""
        ticks = raw.get("travel_ticks")
        if ticks is None:
            drawn = [length(*ends)] + ([] if copy is None else [length(*copy)])
            mean = sum(drawn) / len(drawn)
            ticks = max(1, math.floor(expected_travel_ticks(mean, config) + 0.5))
        border = _int(raw.get("border_permille", BORDER_SELF_MIRROR), f"{where}.border_permille")
        road = {"a": ends[0], "b": ends[1], "max_level": raw["max_level"], "travel_ticks": ticks}
        if copy is None:
            return [road | {"border_permille": border}]
        same_way = copy[0] == node_mirror[ends[0]]
        return [
            road | {"border_permille": border},
            road
            | {"a": copy[0], "b": copy[1]}
            | {"border_permille": border if same_way else 1000 - border},
        ]

    straight: list[dict[str, Any]] = []
    mirrored: list[dict[str, Any]] = []
    self_roads: list[dict[str, Any]] = []
    for i, raw in enumerate(_list(root["edges"], "edges")):
        where = f"edges[{i}]"
        edge = _obj(raw, where, _EDGE_KEYS, _EDGE_OPTIONAL)
        a, b = label_id(edge, "a", where), label_id(edge, "b", where)
        if a in selfs and b in selfs:
            # Both ends are their own mirrors: so is the road (DEC-23, item 7: border 500).
            if edge.get("border_permille", BORDER_SELF_MIRROR) != BORDER_SELF_MIRROR:
                raise HalfFormatError(f"{where}: a self-mirrored road needs border_permille 500")
            self_roads += roads(edge, where, (node_id[a], node_id[b]), None)
            continue
        road, copy = roads(edge, where, (node_id[a], node_id[b]), (mirror_id[a], mirror_id[b]))
        straight.append(road)
        mirrored.append(copy)
    edges = straight + mirrored + self_roads
    edge_mirror = {i: i + len(straight) for i in range(len(straight))}
    edge_mirror |= {i: i for i in range(2 * len(straight), len(edges))}

    seen_cross: set[frozenset[str]] = set()
    for i, raw in enumerate(_list(root["cross_edges"], "cross_edges")):
        where = f"cross_edges[{i}]"
        edge = _obj(raw, where, _EDGE_KEYS, _EDGE_OPTIONAL)
        a, b = label_id(edge, "a", where), label_id(edge, "b", where)
        if a in selfs or b in selfs:
            raise HalfFormatError(f"{where}: the centre node joins the other half by plain edges")
        if frozenset((a, b)) in seen_cross:
            raise HalfFormatError(f"{where}: duplicates the road between {a!r} and mirror {b!r}")
        seen_cross.add(frozenset((a, b)))
        first = len(edges)
        if a == b:
            if edge.get("border_permille", BORDER_SELF_MIRROR) != BORDER_SELF_MIRROR:
                raise HalfFormatError(f"{where}: a self-mirrored road needs border_permille 500")
            edges += roads(edge, where, (node_id[a], mirror_id[b]), None)
            edge_mirror[first] = first
        else:
            edges += roads(edge, where, (node_id[a], mirror_id[b]), (node_id[b], mirror_id[a]))
            edge_mirror[first] = first + 1
    for source, target in list(edge_mirror.items()):
        edge_mirror[target] = source

    return {
        "meta": {
            "name": meta["name"],
            "version": meta["version"],
            "symmetry": "rot180",
            "width": width,
            "height": height,
        },
        "nodes": nodes,
        "edges": [{"id": i, **e} for i, e in enumerate(edges)],
        "mirror": {
            "nodes": {str(n): node_mirror[n] for n in range(total)},
            "edges": {str(i): edge_mirror[i] for i in range(len(edges))},
        },
    }


def dump_map(data: dict[str, Any]) -> str:
    """JSON with one node or edge per line: readable diffs of hand-tuned maps."""

    def rows(items: list[Any]) -> str:
        return ",\n".join(f"    {json.dumps(item, ensure_ascii=False)}" for item in items)

    return (
        "{\n"
        f'  "meta": {json.dumps(data["meta"], ensure_ascii=False)},\n'
        f'  "nodes": [\n{rows(data["nodes"])}\n  ],\n'
        f'  "edges": [\n{rows(data["edges"])}\n  ],\n'
        f'  "mirror": {{\n    "nodes": {json.dumps(data["mirror"]["nodes"])},\n'
        f'    "edges": {json.dumps(data["mirror"]["edges"])}\n  }}\n'
        "}\n"
    )


def mirror_file(half: str | Path, out: str | Path, config: ValidatorConfig) -> None:
    data: object = json.loads(Path(half).read_text(encoding="utf-8"))
    Path(out).write_text(dump_map(mirror_half(data, config)), encoding="utf-8")
