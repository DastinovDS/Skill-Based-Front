"""Map validator (MAP-02): design checks on top of the gow_sim.maps loader.

The loader rejects malformed files (types, references, ranges, neutral garrisons). This module
checks what makes a map playable and fair: connectivity, planarity, 180-degree symmetry, node
degree, redundant approaches to valuable cities, neutral space and road lengths. Given a ruleset
with ``city_upgrades`` (DEC-26, item 5), also that no city starts with more charges than its
warehouse holds (``warehouse``).
"""

import math
import tomllib
from dataclasses import dataclass, fields
from importlib import resources
from pathlib import Path

import networkx as nx

from gow_sim.maps import EdgeDef, MapDef, MapFormatError, NodeDef, NodeKind, load_map
from gow_sim.ruleset import Ruleset


@dataclass(frozen=True, slots=True)
class ValidatorConfig:
    """Thresholds of the map checks. Defaults: ``validate.toml`` next to this module."""

    max_degree: int
    disjoint_paths_min_vp: int
    min_disjoint_paths: int
    min_neutral_pct: int
    neutral_max_distance_diff: int
    travel_ticks_per_100_units: int
    travel_tolerance_pct: int


def load_config(path: str | Path | None = None) -> ValidatorConfig:
    """Read a validator config; unknown or missing keys are an error."""
    if path is None:
        text = resources.files("gow_maps").joinpath("validate.toml").read_text(encoding="utf-8")
    else:
        text = Path(path).read_text(encoding="utf-8")
    raw = tomllib.loads(text)
    names = [f.name for f in fields(ValidatorConfig)]
    unknown = sorted(set(raw) - set(names))
    missing = [n for n in names if n not in raw]
    if unknown or missing:
        raise ValueError(f"validator config: unknown keys {unknown}, missing keys {missing}")
    values: dict[str, int] = {}
    for name in names:
        value = raw[name]
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError(f"validator config: {name} must be a non-negative integer")
        values[name] = value
    return ValidatorConfig(**values)


@dataclass(frozen=True, slots=True)
class Issue:
    check: str
    message: str

    def __str__(self) -> str:
        return f"[{self.check}] {self.message}"


def validate_file(
    path: str | Path, config: ValidatorConfig, rules: Ruleset | None = None
) -> list[Issue]:
    """Load and validate one map file. A loader error is reported as the ``format`` check."""
    try:
        mapdef = load_map(path)
    except MapFormatError as exc:
        return [Issue("format", str(exc))]
    return validate(mapdef, config, rules)


def validate(mapdef: MapDef, config: ValidatorConfig, rules: Ruleset | None = None) -> list[Issue]:
    """Every check; ``warehouse`` only with ``rules`` that have ``city_upgrades`` on."""
    graph = to_graph(mapdef)
    issues = [
        *check_planarity(mapdef),
        *check_symmetry(mapdef),
        *check_degree(mapdef, config),
        *check_travel_ticks(mapdef, config),
        *(check_warehouse(mapdef, rules) if rules is not None else []),
    ]
    connectivity = check_connectivity(graph)
    issues += connectivity
    if not connectivity:  # path and distance checks are meaningless on a disconnected graph
        issues += check_disjoint_paths(mapdef, graph, config)
        issues += check_neutral_space(mapdef, graph, config)
    return issues


def check_warehouse(mapdef: MapDef, rules: Ruleset) -> list[Issue]:
    """DEC-26, item 5: ``start_stock`` of a city is at most ``warehouse.start_by_kind[kind]``.

    Only for a ruleset with ``city_upgrades.enabled``: without it the warehouse holds the node
    capacity (DEC-22, item 1). The simulation cuts a bigger stock at the start without an event.
    """
    if not rules.city_upgrades.enabled:
        return []
    start = rules.warehouse.start_by_kind
    return [
        Issue(
            "warehouse",
            f"node {n.id} ({n.kind.value}) starts with {n.start_stock} charges, "
            f"its warehouse holds {start.of(n.kind)}",
        )
        for n in mapdef.nodes
        if n.kind is not NodeKind.PROVINCE and n.start_stock > start.of(n.kind)
    ]


def to_graph(mapdef: MapDef) -> "nx.Graph[int]":
    graph: nx.Graph[int] = nx.Graph()
    graph.add_nodes_from(n.id for n in mapdef.nodes)
    graph.add_edges_from((e.a, e.b) for e in mapdef.edges)
    return graph


def check_connectivity(graph: "nx.Graph[int]") -> list[Issue]:
    if nx.is_connected(graph):
        return []
    parts = sorted(sorted(c) for c in nx.connected_components(graph))
    return [Issue("connectivity", f"the map falls apart into {len(parts)} parts: {parts}")]


# --- planarity -------------------------------------------------------------------------------

Point = tuple[int, int]


def _cross(o: Point, p: Point, q: Point) -> int:
    return (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])


def _on_segment(p: Point, a: Point, b: Point) -> bool:
    """p lies on the closed segment ab (exact integer arithmetic)."""
    return (
        _cross(a, b, p) == 0
        and min(a[0], b[0]) <= p[0] <= max(a[0], b[0])
        and min(a[1], b[1]) <= p[1] <= max(a[1], b[1])
    )


def _segments_touch(a: Point, b: Point, c: Point, d: Point) -> bool:
    """Closed segments ab and cd have a common point."""
    d1, d2 = _cross(c, d, a), _cross(c, d, b)
    d3, d4 = _cross(a, b, c), _cross(a, b, d)
    if ((d1 > 0 > d2) or (d1 < 0 < d2)) and ((d3 > 0 > d4) or (d3 < 0 < d4)):
        return True
    return any(
        (_on_segment(a, c, d), _on_segment(b, c, d), _on_segment(c, a, b), _on_segment(d, a, b))
    )


def check_planarity(mapdef: MapDef) -> list[Issue]:
    """Roads do not cross or pass through cities; cities do not share a position."""
    issues: list[Issue] = []
    pos = {n.id: (n.x, n.y) for n in mapdef.nodes}
    seen: dict[Point, int] = {}
    for node in mapdef.nodes:
        if pos[node.id] in seen:
            other = seen[pos[node.id]]
            issues.append(
                Issue("planarity", f"nodes {other} and {node.id} share position {pos[node.id]}")
            )
        seen[pos[node.id]] = node.id
    for edge in mapdef.edges:
        for node in mapdef.nodes:
            if node.id not in (edge.a, edge.b) and _on_segment(
                pos[node.id], pos[edge.a], pos[edge.b]
            ):
                issues.append(Issue("planarity", f"edge {edge.id} passes through node {node.id}"))
    edges = mapdef.edges
    for i, e in enumerate(edges):
        for f in edges[i + 1 :]:
            shared = {e.a, e.b} & {f.a, f.b}
            if shared:
                # Adjacent roads meet only at the shared city: they must not overlap.
                (common,) = shared
                far_e, far_f = e.other(common), f.other(common)
                overlap = _on_segment(pos[far_e], pos[common], pos[far_f]) or _on_segment(
                    pos[far_f], pos[common], pos[far_e]
                )
                if overlap:
                    issues.append(Issue("planarity", f"edges {e.id} and {f.id} overlap"))
            elif _segments_touch(pos[e.a], pos[e.b], pos[f.a], pos[f.b]):
                issues.append(Issue("planarity", f"edges {e.id} and {f.id} cross"))
    return issues


# --- symmetry --------------------------------------------------------------------------------


def _swap(player: int | None) -> int | None:
    return None if player is None else 1 - player


_NODE_FIELDS = ("terrain", "vp", "kind", "start_units", "start_charged", "start_stock")
_EDGE_FIELDS = ("base_width", "max_width", "travel_ticks")


def check_symmetry(mapdef: MapDef) -> list[Issue]:
    """The ``mirror`` table describes a 180-degree rotation that swaps the players."""
    issues: list[Issue] = []
    width, height = mapdef.meta.width, mapdef.meta.height
    for node in mapdef.nodes:
        m = mapdef.nodes[mapdef.mirror_nodes[node.id]]
        if m.id < node.id:
            continue  # each pair once
        pair = f"nodes {node.id} and {m.id}"
        if (m.x, m.y) != (width - node.x, height - node.y):
            issues.append(
                Issue(
                    "symmetry",
                    f"{pair}: position {(m.x, m.y)} is not the rotation of {(node.x, node.y)},"
                    f" expected {(width - node.x, height - node.y)}",
                )
            )
        issues += _differences(pair, node, m, _NODE_FIELDS)
        for name in ("capital_of", "start_owner"):
            mine, theirs = getattr(node, name), getattr(m, name)
            if theirs != _swap(mine):
                issues.append(
                    Issue(
                        "symmetry",
                        f"{pair}: {name} {mine} must mirror to {_swap(mine)}, got {theirs}",
                    )
                )
    for edge in mapdef.edges:
        f = mapdef.edges[mapdef.mirror_edges[edge.id]]
        if f.id < edge.id:
            continue
        pair = f"edges {edge.id} and {f.id}"
        ends = sorted((mapdef.mirror_nodes[edge.a], mapdef.mirror_nodes[edge.b]))
        if sorted((f.a, f.b)) != ends:
            issues.append(Issue("symmetry", f"{pair}: ends {sorted((f.a, f.b))} must be {ends}"))
        issues += _differences(pair, edge, f, _EDGE_FIELDS)
    return issues


def _differences(
    pair: str, x: NodeDef | EdgeDef, y: NodeDef | EdgeDef, names: tuple[str, ...]
) -> list[Issue]:
    issues: list[Issue] = []
    for name in names:
        a, b = getattr(x, name), getattr(y, name)
        if a != b:
            issues.append(Issue("symmetry", f"{pair} differ: {name} {a} != {b}"))
    return issues


# --- degree, travel time ---------------------------------------------------------------------


def check_degree(mapdef: MapDef, config: ValidatorConfig) -> list[Issue]:
    return [
        Issue("degree", f"node {n} has {len(ids)} roads, max {config.max_degree}")
        for n, ids in enumerate(mapdef.incident)
        if len(ids) > config.max_degree
    ]


def expected_travel_ticks(length: float, config: ValidatorConfig) -> float:
    return length * config.travel_ticks_per_100_units / 100


def edge_length(mapdef: MapDef, edge: EdgeDef) -> float:
    a, b = mapdef.nodes[edge.a], mapdef.nodes[edge.b]
    return math.hypot(a.x - b.x, a.y - b.y)


def check_travel_ticks(mapdef: MapDef, config: ValidatorConfig) -> list[Issue]:
    """travel_ticks matches the road length within the configured tolerance (at least 1 tick)."""
    issues: list[Issue] = []
    for edge in mapdef.edges:
        expected = expected_travel_ticks(edge_length(mapdef, edge), config)
        tolerance = max(1.0, expected * config.travel_tolerance_pct / 100)
        if abs(edge.travel_ticks - expected) > tolerance:
            issues.append(
                Issue(
                    "travel_ticks",
                    f"edge {edge.id}: travel_ticks {edge.travel_ticks}, the length gives"
                    f" {expected:.1f} ± {tolerance:.1f}",
                )
            )
    return issues


# --- paths and neutral space -----------------------------------------------------------------


def check_disjoint_paths(
    mapdef: MapDef, graph: "nx.Graph[int]", config: ValidatorConfig
) -> list[Issue]:
    """Every capital reaches every valuable city by edge-disjoint paths: one cut is not enough."""
    issues: list[Issue] = []
    for player in (0, 1):
        capital = mapdef.capital(player)
        for node in mapdef.nodes:
            if node.id == capital or node.vp < config.disjoint_paths_min_vp:
                continue
            paths = nx.edge_connectivity(graph, capital, node.id)
            if paths < config.min_disjoint_paths:
                issues.append(
                    Issue(
                        "disjoint_paths",
                        f"capital of player {player} (node {capital}) reaches node {node.id}"
                        f" (vp {node.vp}) by {paths} edge-disjoint path(s),"
                        f" need {config.min_disjoint_paths}",
                    )
                )
    return issues


def contested_neutral_nodes(
    mapdef: MapDef, graph: "nx.Graph[int]", config: ValidatorConfig
) -> list[int]:
    """Neutral nodes about as far (in roads) from one capital as from the other."""
    d0 = nx.single_source_shortest_path_length(graph, mapdef.capital(0))
    d1 = nx.single_source_shortest_path_length(graph, mapdef.capital(1))
    return [
        n.id
        for n in mapdef.nodes
        if n.start_owner is None and abs(d0[n.id] - d1[n.id]) <= config.neutral_max_distance_diff
    ]


def check_neutral_space(
    mapdef: MapDef, graph: "nx.Graph[int]", config: ValidatorConfig
) -> list[Issue]:
    contested = contested_neutral_nodes(mapdef, graph, config)
    total = len(mapdef.nodes)
    if len(contested) * 100 >= config.min_neutral_pct * total:
        return []
    return [
        Issue(
            "neutral_space",
            f"{len(contested)} of {total} nodes are neutral and contested {contested},"
            f" need at least {config.min_neutral_pct}%",
        )
    ]
