"""Equal access of a map without a mirror (#771): what stands in for rot180 on a generated map.

A map with ``meta.symmetry = "none"`` has no mirror to make it fair, so it must show that both
capitals have the same access to the map. ``score`` measures it, ``check`` compares the scores with
the thresholds of ``validate.toml``. The metrics (``docs/design/map-format.md``, "Fairness"):

* **first reach:** a node belongs to the capital that reaches it first by ``travel_ticks``, a tie
  to neither; ``cities``, ``provinces`` and ``vp`` count each side (the capitals are left out);
* **contested zone:** the nodes the capitals reach within ``contested_ticks`` of each other;
  ``front_ticks`` is the time from each capital to its nearest node of the zone, and
  ``front_terrain_ticks`` the same at the terrain speed of the ruleset (mechanics.md, section 4);
* **approaches:** the roads of each capital;
* **charges:** the start charges of a side plus the warehouses it reaches within half of the time
  between the capitals;
* **start:** the start forces of the two sides (units, charges, stock), which must be equal.

A map must also not be a mirror in disguise. Three scores against rot180, on the pool all near
the top of the scale: ``mirror_shift_pct`` (how far a rotated node lands from the nearest node),
``mirror_roads_pct`` (roads that a rotation lands on a road) and ``mirror_profile_pct`` (no
coordinates: nodes with the same distances to the two capitals, swapped, and the same degree).

Interest: ``dead_end_nodes`` (nodes outside the 2-core: dead-end lanes), ``longest_lane`` (the
longest run of nodes with two roads), ``capital_depth`` (roads from a capital to the front),
``cut_nodes`` (articulation points between the capitals) and ``choke_pct`` (how much slower the
way between the capitals gets without its most important node).

Standard library and ``gow_sim.maps`` only: the server cannot import ``networkx`` or ``numpy``, and
stage 2 of #771 runs this filter on the server.
"""

import heapq
import math
import tomllib
from collections import Counter, deque
from collections.abc import Callable, Sequence
from dataclasses import dataclass, fields
from importlib import resources

from gow_sim.maps import MapDef, NodeKind, Terrain

Pair = tuple[int, int]


@dataclass(frozen=True, slots=True)
class FairnessConfig:
    """Thresholds of the check ``fairness`` (``validate.toml``, map-format.md, "Fairness")."""

    contested_ticks: int
    max_city_gap: int
    max_province_gap: int
    max_vp_gap: int
    max_front_gap_pct: int
    max_front_terrain_gap_pct: int
    max_approach_gap: int
    min_approaches: int
    max_charge_gap_pct: int
    warehouse_capital: int
    warehouse_city: int
    warehouse_province: int
    speed_plains_pct: int
    speed_forest_pct: int
    speed_mountains_pct: int
    min_mirror_shift_pct: int
    max_mirror_roads_pct: int
    max_mirror_profile_pct: int
    max_dead_end_nodes: int
    max_lane: int
    min_capital_depth: int
    max_cut_nodes: int
    max_choke_pct: int


def load_fairness() -> FairnessConfig:
    """The thresholds of the built-in ``validate.toml``, without the rest of the validator."""
    text = resources.files("gow_maps").joinpath("validate.toml").read_text(encoding="utf-8")
    raw = tomllib.loads(text)
    return FairnessConfig(**{f.name: raw[f.name] for f in fields(FairnessConfig)})


@dataclass(frozen=True, slots=True)
class Scores:
    """The metrics of one map; a ``Pair`` is (player 0, player 1)."""

    capital_ticks: int
    cities: Pair
    provinces: Pair
    vp: Pair
    contested: int
    front_ticks: Pair
    front_terrain_ticks: Pair
    approaches: Pair
    charges: Pair
    start_forces: tuple[tuple[int, int, int], tuple[int, int, int]]
    capital_stock: Pair
    mirror_shift_pct: int
    mirror_roads_pct: int
    mirror_profile_pct: int
    dead_end_nodes: int
    longest_lane: int
    capital_depth: Pair
    cut_nodes: tuple[int, ...]
    choke_pct: int


Neighbours = list[list[tuple[int, int]]]


def _neighbours(mapdef: MapDef, cost: Callable[[int, int, int], int] | None = None) -> Neighbours:
    """``out[a]``: ``(b, ticks)`` of each road of ``a``; ``cost(edge id, from, to)`` overrides."""
    out: Neighbours = [[] for _ in mapdef.nodes]
    for e in mapdef.edges:
        out[e.a].append((e.b, cost(e.id, e.a, e.b) if cost else e.travel_ticks))
        out[e.b].append((e.a, cost(e.id, e.b, e.a) if cost else e.travel_ticks))
    return out


def shortest(adjacent: Neighbours, source: int, without: int = -1) -> list[int]:
    """Least total cost from ``source`` to every node, avoiding ``without``; unreachable: -1."""
    best = [-1] * len(adjacent)
    heap = [(0, source)]
    while heap:
        d, node = heapq.heappop(heap)
        if best[node] >= 0:
            continue
        best[node] = d
        for nxt, cost in adjacent[node]:
            if best[nxt] < 0 and nxt != without:
                heapq.heappush(heap, (d + cost, nxt))
    return best


def _hops(adjacent: Neighbours, source: int) -> list[int]:
    return shortest([[(b, 1) for b, _ in row] for row in adjacent], source)


def terrain_ticks(mapdef: MapDef, config: FairnessConfig) -> Neighbours:
    """Road times at the terrain speed: each half of a road at the speed of its node's terrain.

    The rule of mechanics.md, section 4 (``terrain.speed_pct``), on the whole ticks of a road; the
    percents come from ``validate.toml`` because the validator may run without a ruleset.
    """
    speed = {
        Terrain.PLAINS: config.speed_plains_pct,
        Terrain.FOREST: config.speed_forest_pct,
        Terrain.MOUNTAINS: config.speed_mountains_pct,
    }

    def cost(edge_id: int, a: int, b: int) -> int:
        edge = mapdef.edges[edge_id]
        near = edge.border_permille if a == edge.a else 1000 - edge.border_permille
        pa, pb = speed[mapdef.nodes[a].terrain], speed[mapdef.nodes[b].terrain]
        # travel_ticks * (near / 1000 * 100 / pa + (1000 - near) / 1000 * 100 / pb), rounded down.
        return edge.travel_ticks * (near * pb + (1000 - near) * pa) // (10 * pa * pb)

    return _neighbours(mapdef, cost)


def contested_nodes(t0: Sequence[int], t1: Sequence[int], ticks: int) -> list[int]:
    """Nodes the two capitals reach within ``ticks`` of each other."""
    return [n for n, (a, b) in enumerate(zip(t0, t1, strict=True)) if abs(a - b) <= ticks]


def warehouse(kind: NodeKind, config: FairnessConfig) -> int:
    if kind is NodeKind.CAPITAL:
        return config.warehouse_capital
    return config.warehouse_province if kind is NodeKind.PROVINCE else config.warehouse_city


def _first_reach(mapdef: MapDef, t0: Sequence[int], t1: Sequence[int]) -> tuple[Pair, Pair, Pair]:
    """Cities, provinces and VP of the nodes each capital reaches first (capitals left out)."""
    cities, provinces, vp = [0, 0], [0, 0], [0, 0]
    for n in mapdef.nodes:
        if n.capital_of is not None or t0[n.id] == t1[n.id]:
            continue
        side = 0 if t0[n.id] < t1[n.id] else 1
        vp[side] += n.vp
        (provinces if n.kind is NodeKind.PROVINCE else cities)[side] += 1
    return (cities[0], cities[1]), (provinces[0], provinces[1]), (vp[0], vp[1])


def _charges(
    mapdef: MapDef, times: tuple[Sequence[int], Sequence[int]], config: FairnessConfig
) -> Pair:
    """Start charges of a side and the warehouses within half of the time between the capitals."""
    horizon = times[0][mapdef.capital(1)] // 2
    out = [0, 0]
    for player in (0, 1):
        for n in mapdef.nodes:
            if n.start_owner == player:
                out[player] += n.start_charged + n.start_stock
            if times[player][n.id] <= horizon:
                out[player] += warehouse(n.kind, config)
    return out[0], out[1]


def _start_forces(mapdef: MapDef, player: int) -> tuple[int, int, int]:
    own = [n for n in mapdef.nodes if n.start_owner == player]
    return (
        sum(n.start_units for n in own),
        sum(n.start_charged for n in own),
        sum(n.start_stock for n in own),
    )


def mirror_scores(
    mapdef: MapDef, hops: tuple[Sequence[int], Sequence[int]]
) -> tuple[int, int, int]:
    """``mirror_shift_pct``, ``mirror_roads_pct``, ``mirror_profile_pct`` of the module docstring.

    The shift is the mean distance from the rotated node to the nearest node, in percent of the
    node spacing ``sqrt(width * height / nodes)``. A road maps to a road when the nearest nodes of
    its rotated ends have a road. The profile is the share of nodes whose (hops to capital 0, hops
    to capital 1, degree) has a partner with the two distances swapped.
    """
    width, height = mapdef.meta.width, mapdef.meta.height
    nodes = mapdef.nodes
    image: list[int] = []
    total = 0.0
    for n in nodes:
        x, y = width - n.x, height - n.y
        far, near = min(((x - m.x) ** 2 + (y - m.y) ** 2, m.id) for m in nodes)
        image.append(near)
        total += math.sqrt(far)
    spacing = math.sqrt(width * height / len(nodes))
    shift = int(100 * total / len(nodes) / spacing)
    roads = {(min(e.a, e.b), max(e.a, e.b)) for e in mapdef.edges}
    kept = sum(
        (min(image[a], image[b]), max(image[a], image[b])) in roads for a, b in sorted(roads)
    )
    profile = Counter(
        (hops[0][n.id], hops[1][n.id], len(mapdef.incident[n.id])) for n in mapdef.nodes
    )
    matched = sum(min(c, profile[(b, a, d)]) for (a, b, d), c in profile.items())
    return shift, 100 * kept // len(roads), 100 * matched // len(nodes)


def dead_end_nodes(adjacent: Neighbours) -> int:
    """Nodes outside the 2-core: peel the nodes with one road until none is left."""
    degree = [len(row) for row in adjacent]
    peel = deque(n for n, d in enumerate(degree) if d <= 1)
    gone = [False] * len(adjacent)
    while peel:
        node = peel.popleft()
        if gone[node]:
            continue
        gone[node] = True
        for nxt, _ in adjacent[node]:
            degree[nxt] -= 1
            if not gone[nxt] and degree[nxt] <= 1:
                peel.append(nxt)
    return sum(gone)


def longest_lane(adjacent: Neighbours) -> int:
    """The longest run of linked nodes with exactly two roads (a lane without a fork)."""
    two = [len(row) == 2 for row in adjacent]
    seen = [False] * len(adjacent)
    best = 0
    for start, is_two in enumerate(two):
        if not is_two or seen[start]:
            continue
        seen[start] = True
        stack, size = [start], 0
        while stack:
            node = stack.pop()
            size += 1
            for nxt, _ in adjacent[node]:
                if two[nxt] and not seen[nxt]:
                    seen[nxt] = True
                    stack.append(nxt)
        best = max(best, size)
    return best


def cut_nodes(adjacent: Neighbours, a: int, b: int) -> tuple[int, ...]:
    """Nodes whose removal separates ``a`` from ``b`` (the articulation points between them)."""
    return tuple(
        n
        for n in range(len(adjacent))
        if n not in (a, b) and shortest(adjacent, a, without=n)[b] < 0
    )


def choke_pct(adjacent: Neighbours, a: int, b: int) -> int:
    """How much longer (percent) the way from ``a`` to ``b`` gets without its worst single node."""
    base = shortest(adjacent, a)[b]
    worst = base
    for n in range(len(adjacent)):
        if n not in (a, b):
            worst = max(worst, shortest(adjacent, a, without=n)[b])
    return 100 * (worst - base) // base


def score(mapdef: MapDef, config: FairnessConfig) -> Scores:
    adjacent = _neighbours(mapdef)
    c0, c1 = mapdef.capital(0), mapdef.capital(1)
    t0, t1 = shortest(adjacent, c0), shortest(adjacent, c1)
    if min(*t0, *t1) < 0:
        raise ValueError("the map is not connected")
    h0, h1 = _hops(adjacent, c0), _hops(adjacent, c1)
    cities, provinces, vp = _first_reach(mapdef, t0, t1)
    zone = contested_nodes(t0, t1, config.contested_ticks)
    slow = terrain_ticks(mapdef, config)
    s0, s1 = shortest(slow, c0), shortest(slow, c1)
    shift, roads, profile = mirror_scores(mapdef, (h0, h1))
    # Roads to the front: the zone or the first node the other capital reaches first.
    depth = (
        min(h0[n] for n in range(len(t0)) if n in zone or t1[n] < t0[n]),
        min(h1[n] for n in range(len(t0)) if n in zone or t0[n] < t1[n]),
    )
    return Scores(
        capital_ticks=t0[c1],
        cities=cities,
        provinces=provinces,
        vp=vp,
        contested=len(zone),
        front_ticks=(min((t0[n] for n in zone), default=0), min((t1[n] for n in zone), default=0)),
        front_terrain_ticks=(
            min((s0[n] for n in zone), default=0),
            min((s1[n] for n in zone), default=0),
        ),
        approaches=(len(mapdef.incident[c0]), len(mapdef.incident[c1])),
        charges=_charges(mapdef, (t0, t1), config),
        start_forces=(_start_forces(mapdef, 0), _start_forces(mapdef, 1)),
        capital_stock=(mapdef.nodes[c0].start_stock, mapdef.nodes[c1].start_stock),
        mirror_shift_pct=shift,
        mirror_roads_pct=roads,
        mirror_profile_pct=profile,
        dead_end_nodes=dead_end_nodes(adjacent),
        longest_lane=longest_lane(adjacent),
        capital_depth=depth,
        cut_nodes=cut_nodes(adjacent, c0, c1),
        choke_pct=choke_pct(adjacent, c0, c1),
    )


def gap_pct(pair: Pair) -> int:
    """The difference of two values in percent of the larger one, rounded down."""
    return 100 * abs(pair[0] - pair[1]) // max(pair[0], pair[1], 1)


def _gap(pair: Pair) -> int:
    return abs(pair[0] - pair[1])


def check(s: Scores, config: FairnessConfig) -> list[str]:
    """What the map fails; one message per failed threshold."""
    rows: list[tuple[bool, str]] = [
        (s.contested == 0, "no contested zone"),
        (_gap(s.cities) > config.max_city_gap, f"first reach: cities {s.cities}"),
        (_gap(s.provinces) > config.max_province_gap, f"first reach: provinces {s.provinces}"),
        (_gap(s.vp) > config.max_vp_gap, f"first reach: vp {s.vp}"),
        (
            gap_pct(s.front_ticks) > config.max_front_gap_pct,
            f"time to the contested zone {s.front_ticks}",
        ),
        (
            gap_pct(s.front_terrain_ticks) > config.max_front_terrain_gap_pct,
            f"time to the contested zone by terrain {s.front_terrain_ticks}",
        ),
        (_gap(s.approaches) > config.max_approach_gap, f"approaches {s.approaches}"),
        (min(s.approaches) < config.min_approaches, f"approaches {s.approaches}"),
        (gap_pct(s.charges) > config.max_charge_gap_pct, f"charges reachable {s.charges}"),
        (s.start_forces[0] != s.start_forces[1], f"start forces {s.start_forces}"),
        (s.capital_stock[0] != s.capital_stock[1], f"capital stock {s.capital_stock}"),
        (
            s.mirror_shift_pct < config.min_mirror_shift_pct,
            f"nodes are {s.mirror_shift_pct}% of a spacing from their rot180 image",
        ),
        (
            s.mirror_roads_pct > config.max_mirror_roads_pct,
            f"{s.mirror_roads_pct}% of the roads land on a road under rot180",
        ),
        (
            s.mirror_profile_pct > config.max_mirror_profile_pct,
            f"{s.mirror_profile_pct}% of the nodes have a swapped twin",
        ),
        (s.dead_end_nodes > config.max_dead_end_nodes, f"{s.dead_end_nodes} dead-end nodes"),
        (s.longest_lane > config.max_lane, f"a lane of {s.longest_lane} nodes"),
        (
            min(s.capital_depth) < config.min_capital_depth,
            f"capital depth {s.capital_depth} roads",
        ),
        (len(s.cut_nodes) > config.max_cut_nodes, f"cut nodes {list(s.cut_nodes)}"),
        (s.choke_pct > config.max_choke_pct, f"one node slows the capitals by {s.choke_pct}%"),
    ]
    return [message for failed, message in rows if failed]


def describe(s: Scores) -> str:
    """The scores as a few lines of text (the output of ``gow-maps generate`` and ``score``)."""
    return "\n".join(
        (
            f"  capitals {s.capital_ticks} ticks apart, contested zone {s.contested} nodes",
            f"  first reach: cities {s.cities}, provinces {s.provinces}, vp {s.vp}",
            f"  front ticks {s.front_ticks} (gap {gap_pct(s.front_ticks)}%), by terrain"
            f" {s.front_terrain_ticks} (gap {gap_pct(s.front_terrain_ticks)}%)",
            f"  approaches {s.approaches}, charges reachable {s.charges}"
            f" (gap {gap_pct(s.charges)}%), start forces {s.start_forces[0]} {s.start_forces[1]}",
            f"  mirror: shift {s.mirror_shift_pct}%, roads {s.mirror_roads_pct}%,"
            f" profile {s.mirror_profile_pct}%",
            f"  interest: dead ends {s.dead_end_nodes}, longest lane {s.longest_lane}, capital"
            f" depth {s.capital_depth}, cut nodes {list(s.cut_nodes)}, choke {s.choke_pct}%",
        )
    )
