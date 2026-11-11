"""When the economy outgrows a human's useful APM (#974, ``docs/balance/scaling-thresholds.md``).

    mise exec -- uv run python scripts/scaling_thresholds.py thresholds [--ruleset R]
    mise exec -- uv run python scripts/scaling_thresholds.py maps FILE...
    mise exec -- uv run python scripts/scaling_thresholds.py workload FILE... [--jobs 4] > rows

``thresholds`` prints, from the ruleset alone, the node count ``N`` at which each limit starts to
bind for a range of human useful APM ceilings (markdown tables). It reuses the tempo formulas of
``scripts/apm_ceiling.py`` (#965).

``maps`` prints the static structure of map files: the nodes and cities of each player's half (a
node belongs to the half of the nearer capital in roads; equal distance: no half), the front (half-0
nodes with a road to a half-1 node or to a node of no half, and the same for half 1, averaged), the
capital distance in roads and in road ticks.

``workload`` re-simulates replay files and samples every 10 s, per player, what there is to do:
standing groups (in a node, no order, no fight), all groups and units, owned nodes and cities,
cities with a barracks, factories, front nodes (own nodes with a road to an enemy node), the CP. One
JSON line per match and player with the means and maxima over the samples.
"""

import argparse
import heapq
import json
import sys
from collections import deque
from collections.abc import Callable
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from apm_ceiling import pct, scaled  # pyright: ignore[reportImplicitRelativeImport]

from gow_sim.maps import MapDef, NodeKind, load_map
from gow_sim.match import Match
from gow_sim.replay import DEFAULT_MAPS_DIR, DEFAULT_RULESETS_DIR, replay_match
from gow_sim.ruleset import Ruleset, Stance, load_ruleset
from gow_sim.state import AtNode

N_MAX = 400
HUMANS = (6, 7, 8, 9, 10, 12)
"""Useful commands a minute a human sustains: the assumption of #965 is 7 to 8.5."""
CP_PER_COMMAND = (100, 150, 200)
"""Mean CP per useful command, percent: 100 single orders (today's bots: 98), more with bundling."""
GAPS_S = (20, 30, 40)
"""Seconds without a paid command (watching a fight, planning) the CP cap must cover."""
SAMPLE_TICKS = 100
STANCES = (Stance.WAR, Stance.BALANCE, Stance.ECONOMY)


# ---- the analytic thresholds ----------------------------------------------------------------
def cp_per_min(rules: Ruleset, stance: Stance, nodes: int) -> float:
    period = scaled(getattr(rules.stances.cp_period_ticks, stance.value), pct(rules, nodes))
    return rules.cp.per_period * 60 * rules.tick_hz / period / 100


def cap_buffer_s(rules: Ruleset, stance: Stance, nodes: int) -> float:
    """Seconds of income the CP cap holds: from 0 to the cap with no command."""
    period = scaled(getattr(rules.stances.cp_period_ticks, stance.value), pct(rules, nodes))
    return rules.cp.cap / rules.cp.per_period * period / rules.tick_hz


def first_n(test: Callable[[int], bool]) -> int | None:
    return next((n for n in range(1, N_MAX + 1) if test(n)), None)


def show(n: int | None) -> str:
    return "never" if n is None else str(n)


def table(head: list[str], rows: list[list[object]]) -> None:
    print("| " + " | ".join(head) + " |")
    print("|" + "---|" * len(head))
    for r in rows:
        print("| " + " | ".join(str(c) for c in r) + " |")
    print()


def print_thresholds(rules: Ruleset) -> None:
    war, bal = Stance.WAR, Stance.BALANCE
    print(
        f"CP a minute at the clamp: War {cp_per_min(rules, war, N_MAX):.2f},"
        f" Balance {cp_per_min(rules, bal, N_MAX):.2f}\n"
    )
    print("**CP outruns the human** (smallest N with CP a minute > H x CP per command):\n")
    head = ["H useful/min"] + [
        f"{s.value} c={c / 100:g}" for s in (war, bal) for c in CP_PER_COMMAND
    ]
    rows: list[list[object]] = []
    for h in HUMANS:
        row: list[object] = [h]
        for s in (war, bal):
            for c in CP_PER_COMMAND:
                row.append(
                    show(first_n(lambda n, s=s, c=c, h=h: cp_per_min(rules, s, n) * 100 > h * c))
                )
        rows.append(row)
    table(head, rows)

    print("**The CP cap covers a gap** (smallest N where the cap fills in less than G s):\n")
    rows = []
    for g in GAPS_S:
        cells = [show(first_n(lambda n, s=s, g=g: cap_buffer_s(rules, s, n) < g)) for s in STANCES]
        rows.append([g, *cells])
    table(["gap G s", "war", "balance", "economy"], rows)

    print("**Per N** (2 players):\n")
    rows = []
    for n in (29, 49, 55, 80, 100, 111, 120):
        p = pct(rules, n)
        p_f = scaled(rules.stances.capital_period_ticks.balance, p)
        rows.append(
            [
                n,
                p,
                f"{cp_per_min(rules, war, n):.2f}",
                f"{cp_per_min(rules, bal, n):.2f}",
                f"{cap_buffer_s(rules, war, n):.0f}",
                f"{cap_buffer_s(rules, bal, n):.0f}",
                f"{rules.factory.max * 60 * rules.tick_hz / p_f:.2f}",
            ]
        )
    table(
        [
            "N",
            "pct",
            "CP/min war",
            "CP/min balance",
            "cap s war",
            "cap s balance",
            "charges/min balance, 3 factories",
        ],
        rows,
    )

    go = rules.group_order
    move = rules.orders.cost.move
    attack = rules.cp.cap // move

    def rally_price(n: int) -> int:  # DEC-48, item A2: rounded up to a whole CP
        assert go is not None
        return (n * move * go.rally_pct + 9999) // 10000 * 100

    if go is not None:
        rally = max(n for n in range(1, 4 * go.max_groups) if rally_price(n) <= rules.cp.cap)
        print(
            f"Group order: the cap pays an attack of {attack} and a rally of {rally} groups;"
            f" max_groups {go.max_groups} binds an attack from a cap of"
            f" {go.max_groups * move // 100}"
            f" CP and a rally from {(go.max_groups * move * go.rally_pct + 9999) // 10000} CP.\n"
        )

    print_chart(rules)

    print("**Proposal: a CP cap with the tempo** (`max(cap, cap * pct // 100 // q * q)`):\n")
    rows = []
    q = rules.cp.per_period
    for n in (49, 55, 59, 60, 80, 100, 111):
        p = pct(rules, n)
        cap = max(rules.cp.cap, rules.cp.cap * p // 100 // q * q)
        period = scaled(rules.stances.cp_period_ticks.war, p)
        rows.append([n, p, cap / 100, f"{cap / q * period / rules.tick_hz:.0f}", cap // move])
    table(["N", "pct", "cap CP", "cap s war", "group attack members"], rows)

    print("**More players** (nodes per player n; today's tempo counts all N):\n")
    rows = []
    for players in (2, 3, 4):
        for per in (25, 30):
            n = players * per
            today = pct(rules, n)
            fair = pct(rules, 2 * per)
            rows.append(
                [
                    players,
                    per,
                    n,
                    today,
                    fair,
                    f"{cp_per_min(rules, war, n):.2f}",
                    f"{cp_per_min(rules, war, 2 * per):.2f}",
                ]
            )
    table(
        [
            "players",
            "nodes per player",
            "N",
            "pct today",
            "pct per player",
            "CP/min war today",
            "CP/min war per player",
        ],
        rows,
    )


def print_chart(rules: Ruleset) -> None:
    """CP a minute (y, half steps) against N (x, steps of 5): W War, B Balance; the rows ``-``
    and ``=`` mark the human ceilings 7 and 8.5 (#965); ``*``: a curve on a ceiling row."""
    xs = list(range(20, 135, 5))
    marks = {7.0: "-", 8.5: "="}
    print("```text")
    for half in range(24, 5, -1):
        y = half / 2
        line = [marks.get(y, " ")] * (3 * len(xs))
        for i, n in enumerate(xs):
            for s, ch in ((Stance.WAR, "W"), (Stance.BALANCE, "B")):
                if round(cp_per_min(rules, s, n) * 2) == half:
                    line[3 * i + 1] = "*" if y in marks else ch
        print(f"{y:5.1f} |" + "".join(line))
    print("      +" + "-" * (3 * len(xs)))
    print("       " + "".join(f"{n:<3}" if n % 10 == 0 else "   " for n in xs))
    print("```\n")


# ---- static map structure -------------------------------------------------------------------
def hops(mapdef: MapDef, start: int) -> list[int]:
    dist = [-1] * len(mapdef.nodes)
    dist[start] = 0
    todo = deque([start])
    while todo:
        a = todo.popleft()
        for eid in mapdef.incident[a]:
            e = mapdef.edges[eid]
            b = e.b if e.a == a else e.a
            if dist[b] < 0:
                dist[b] = dist[a] + 1
                todo.append(b)
    return dist


def ticks(mapdef: MapDef, start: int, goal: int) -> int:
    """The fastest road ticks between two nodes (``travel_ticks``, no terrain speed): Dijkstra."""
    best = {start: 0}
    heap = [(0, start)]
    while heap:
        d, a = heapq.heappop(heap)
        if a == goal:
            return d
        if d > best.get(a, d):
            continue
        for eid in mapdef.incident[a]:
            e = mapdef.edges[eid]
            b = e.b if e.a == a else e.a
            nd = d + e.travel_ticks
            if nd < best.get(b, nd + 1):
                best[b] = nd
                heapq.heappush(heap, (nd, b))
    return -1


def structure(file: str) -> dict[str, object]:
    m = load_map(file)
    caps = {n.capital_of: n.id for n in m.nodes if n.capital_of is not None}
    d = [hops(m, caps[0]), hops(m, caps[1])]
    half = [0 if a < b else 1 if b < a else None for a, b in zip(d[0], d[1], strict=True)]
    city = [n.kind is not NodeKind.PROVINCE for n in m.nodes]
    front = [0, 0]
    for i in range(len(m.nodes)):
        p = half[i]
        if p is None:
            continue
        for eid in m.incident[i]:
            e = m.edges[eid]
            j = e.b if e.a == i else e.a
            if half[j] != p:
                front[p] += 1
                break
    per = [sum(1 for h in half if h == p) for p in (0, 1)]
    cities = [sum(1 for i, h in enumerate(half) if h == p and city[i]) for p in (0, 1)]
    return {
        "map": m.meta.name,
        "nodes": len(m.nodes),
        "edges": len(m.edges),
        "cities": sum(city),
        "half_nodes": sum(per) / 2,
        "half_cities": sum(cities) / 2,
        "tied": sum(1 for h in half if h is None),
        "front_nodes": sum(front) / 2,
        "capital_hops": d[0][caps[1]],
        "capital_ticks": ticks(m, caps[0], caps[1]),
    }


# ---- what there is to do, from replays ------------------------------------------------------
class Sampler:
    def __init__(self) -> None:
        self.rows: list[list[dict[str, int]]] = [[], []]

    def begin(self, match: Match) -> None:
        pass

    def record(self, match: Match, commands: object) -> None:
        if match.tick % SAMPLE_TICKS:
            return
        s = match.state
        adj = s.map.incident
        for p in (0, 1):
            own = [n for n in s.nodes.values() if n.owner == p]
            groups = [g for g in s.groups.values() if g.owner == p]
            front = 0
            for n in own:
                for eid in adj[n.id]:
                    e = s.map.edges[eid]
                    other = s.nodes[e.b if e.a == n.id else e.a].owner
                    if other is not None and other != p:
                        front += 1
                        break
            self.rows[p].append(
                {
                    "groups": len(groups),
                    "standing": sum(
                        1
                        for g in groups
                        if isinstance(g.location, AtNode) and g.order is None and g.fight is None
                    ),
                    "units": sum(g.units for g in groups),
                    "nodes": len(own),
                    "cities": sum(
                        1 for n in own if s.map.nodes[n.id].kind is not NodeKind.PROVINCE
                    ),
                    "barracks": sum(1 for n in own if n.has_barracks),
                    "factories": sum(1 for n in s.nodes.values() if n.factory == p),
                    "front": front,
                    "cp": s.players[p].cp,
                }
            )


def workload(args: tuple[str, str, str]) -> list[dict[str, object]]:
    file, rulesets, maps = args
    sampler = Sampler()
    match = replay_match(file, rulesets, maps, sampler)
    parts = Path(file).name.split(".")[0].split("__")
    out: list[dict[str, object]] = []
    for p in (0, 1):
        samples = sampler.rows[p]
        keys = list(samples[0]) if samples else []
        row: dict[str, object] = {
            "replay": Path(file).name,
            "map": parts[0],
            "map_nodes": len(match.state.map.nodes),
            "bot": parts[1].split("_vs_")[p] if len(parts) > 1 else "",
            "player": p,
            "samples": len(samples),
        }
        for k in keys:
            row[f"{k}_mean"] = round(sum(r[k] for r in samples) / len(samples), 2)
            row[f"{k}_max"] = max(r[k] for r in samples)
        out.append(row)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Scaling thresholds of the economy (#974).")
    sub = parser.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("thresholds", help="the N where each limit binds, markdown tables")
    t.add_argument("--ruleset", default="rulesets/mvp-7.toml")
    m = sub.add_parser("maps", help="static structure of map files, markdown table")
    m.add_argument("files", nargs="+")
    w = sub.add_parser("workload", help="what there is to do, sampled from replays, JSON lines")
    w.add_argument("files", nargs="+")
    w.add_argument("--rulesets", default=str(DEFAULT_RULESETS_DIR))
    w.add_argument("--maps", default=str(DEFAULT_MAPS_DIR))
    w.add_argument("--jobs", type=int, default=1)
    args = parser.parse_args()
    if args.cmd == "thresholds":
        print_thresholds(load_ruleset(args.ruleset))
        return 0
    if args.cmd == "maps":
        rows = sorted((structure(f) for f in args.files), key=lambda r: (r["nodes"], r["map"]))
        keys = list(rows[0])
        table(keys, [[r[k] for k in keys] for r in rows])
        return 0
    tasks = [(f, args.rulesets, args.maps) for f in sorted(args.files)]
    with ProcessPoolExecutor(max_workers=args.jobs) as pool:
        for rows in pool.map(workload, tasks):
            for row in rows:
                print(json.dumps(row))
    return 0


if __name__ == "__main__":
    sys.exit(main())
