"""Build a full rot180 map from a hand-drawn half (MAP-03).

Half format (``maps/src/<name>.half.json``), described in ``docs/design/map-format.md``:

- ``meta``: ``name``, ``version``, ``width``, ``height`` (the symmetry is always rot180);
- ``nodes``: like map nodes, but ``id`` is a free string label; a node exactly at the centre
  ``(width / 2, height / 2)`` is its own mirror, every other node gets a rotated copy;
- ``edges``: ``{a, b, base_width, max_width, travel_ticks?}`` between half nodes, copied rotated;
- ``cross_edges``: the same, but joining ``a`` with the *mirror* of ``b`` (roads across the
  central strip); ``a == b`` gives one road from a node to its own mirror.

A missing ``travel_ticks`` is computed from the road length with the validator config.

Ids: half nodes in file order get ``0..k-1``, the centre node ``k``, the mirror of node ``i`` is
``N-1-i``. Half edges get ``0..e-1`` and their mirrors ``e..2e-1``; cross edges follow in file
order, each followed by its mirror unless it is its own mirror.
"""

import json
import math
from pathlib import Path
from typing import Any

from gow_maps.validate import ValidatorConfig, expected_travel_ticks


class HalfFormatError(ValueError):
    """The half map is malformed."""


_META_KEYS = ("name", "version", "width", "height")
_NODE_KEYS = (
    "id",
    "x",
    "y",
    "terrain",
    "vp",
    "base_capacity",
    "capital_of",
    "start_owner",
    "start_units",
    "start_charged",
    "start_stock",
)
_EDGE_KEYS = ("a", "b", "base_width", "max_width")
_EDGE_OPTIONAL = ("travel_ticks",)


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


def mirror_half(data: object, config: ValidatorConfig) -> dict[str, Any]:
    """Turn a parsed half into a full map (as JSON data). Value types are checked by the loader."""
    root = _obj(data, "half", ("meta", "nodes", "edges", "cross_edges"))
    meta = _obj(root["meta"], "meta", _META_KEYS)
    width, height = _int(meta["width"], "meta.width"), _int(meta["height"], "meta.height")
    half_nodes = [
        _obj(n, f"nodes[{i}]", _NODE_KEYS) for i, n in enumerate(_list(root["nodes"], "nodes"))
    ]
    labels: list[str] = []
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
        x, y = _int(node["x"], f"nodes[{i}].x"), _int(node["y"], f"nodes[{i}].y")
        if 2 * x == width and 2 * y == height:
            centre.append(label)
    if len(centre) > 1:
        raise HalfFormatError(f"nodes: only one node can stand at the centre, got {centre}")
    side = [label for label in labels if label not in centre]
    total = 2 * len(side) + len(centre)
    # Half nodes 0..k-1, the centre k, the mirror of node i is N-1-i.
    node_id = {label: i for i, label in enumerate(side)}
    mirror_id = {label: total - 1 - i for i, label in enumerate(side)}
    for label in centre:
        node_id[label] = mirror_id[label] = len(side)

    nodes: list[dict[str, Any]] = []
    for node in half_nodes:
        label = node["id"]
        nodes.append({**node, "id": node_id[label]})
        if label in centre:
            continue
        nodes.append(
            {
                **node,
                "id": mirror_id[label],
                "x": width - node["x"],
                "y": height - node["y"],
                "capital_of": _swap(node["capital_of"]),
                "start_owner": _swap(node["start_owner"]),
            }
        )
    nodes.sort(key=lambda n: n["id"])
    node_mirror = {node_id[label]: mirror_id[label] for label in labels}
    node_mirror |= {target: source for source, target in node_mirror.items()}
    position = {n["id"]: (n["x"], n["y"]) for n in nodes}

    def label_id(raw: dict[str, Any], key: str, where: str) -> str:
        label = raw[key]
        if label not in node_id:
            raise HalfFormatError(f"{where}.{key}: unknown node label {label!r}")
        return str(label)

    def road(raw: dict[str, Any], a: int, b: int) -> dict[str, Any]:
        ticks = raw.get("travel_ticks")
        if ticks is None:
            (xa, ya), (xb, yb) = position[a], position[b]
            length = math.hypot(xa - xb, ya - yb)
            ticks = max(1, math.floor(expected_travel_ticks(length, config) + 0.5))
        return {
            "a": a,
            "b": b,
            "base_width": raw["base_width"],
            "max_width": raw["max_width"],
            "travel_ticks": ticks,
        }

    half_edges = [
        _obj(e, f"edges[{i}]", _EDGE_KEYS, _EDGE_OPTIONAL)
        for i, e in enumerate(_list(root["edges"], "edges"))
    ]
    straight: list[dict[str, Any]] = []
    mirrored: list[dict[str, Any]] = []
    for i, raw in enumerate(half_edges):
        a, b = label_id(raw, "a", f"edges[{i}]"), label_id(raw, "b", f"edges[{i}]")
        straight.append(road(raw, node_id[a], node_id[b]))
        mirrored.append(road(raw, mirror_id[a], mirror_id[b]))
    edges = straight + mirrored
    edge_mirror = {i: i + len(straight) for i in range(len(straight))}

    seen_cross: set[frozenset[str]] = set()
    for i, raw in enumerate(_list(root["cross_edges"], "cross_edges")):
        where = f"cross_edges[{i}]"
        edge = _obj(raw, where, _EDGE_KEYS, _EDGE_OPTIONAL)
        a, b = label_id(edge, "a", where), label_id(edge, "b", where)
        if node_id[a] == mirror_id[a] or node_id[b] == mirror_id[b]:
            raise HalfFormatError(f"{where}: the centre node joins the other half by plain edges")
        if frozenset((a, b)) in seen_cross:
            raise HalfFormatError(f"{where}: duplicates the road between {a!r} and mirror {b!r}")
        seen_cross.add(frozenset((a, b)))
        first = len(edges)
        edges.append(road(edge, node_id[a], mirror_id[b]))
        if a == b:
            edge_mirror[first] = first
        else:
            edges.append(road(edge, node_id[b], mirror_id[a]))
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
