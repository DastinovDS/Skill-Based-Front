"""Shard a tournament by (map, seed) and merge the shards back (#582, #786, standard library only).

    python scripts/tournament_shards.py plan --maps maps/*.json --seeds 5 --shards 20
        [--seed-base 0]
    python scripts/tournament_shards.py merge --out merged.jsonl [--seeds 5 --seed-base 0
        --map-count 4] shard0.jsonl shard1.jsonl ...

``plan`` prints a JSON list for a GitHub matrix, one entry per shard::

    {"shard": 0, "cost": 98, "cells": 2, "pieces": [
        {"maps": ["maps/crossroads.json", "maps/highway.json"], "seed_base": 0, "seeds": 1}]}

The work is a list of cells ``(map, seed)``, listed seed-major (every map of a seed, maps sorted by
path, then the next seed). It is cut into ``min(shards, cells)`` contiguous, never empty parts with
the least possible largest expected cost (``plan``). The cost of a cell is the node count of its
map: the time of a match grows with the map (#785: 3.3 s per match on the 29-node ``narrows``,
5.2..5.5 s on the 49..54-node maps, about the ratio of the node counts), and every cell has the same
bot pairs.
A shard plays its part as ``pieces``: each piece is one ``mise run tournament --maps <maps>
--seed-base --seeds``, a product of maps and a seed range. Bot pairs are not split: ``gow-bots
tournament`` has no option for a subset of pairs, so a run has at most ``maps x seeds`` shards.

``merge`` puts the rows of the shards in the order a single run writes them: ``(map, seed, bot0,
bot1)``, see ``gow_bots.tournament`` (maps are sorted by name, seeds numerically, bots by name).
Rows are copied as the exact text of the shard, so a merge of shards of one run is byte-identical
to the file of the unsharded run. It fails on a duplicate match, on a missing one (the rows must be
the full product of their maps, seeds and ordered bot pairs; with ``--seeds`` the seeds must be
exactly ``seed_base .. seed_base + seeds - 1``, with ``--map-count`` the number of maps must match),
on rows of different rulesets or simulation versions, and on an empty input.
"""

import argparse
import glob
import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import TypedDict


class Piece(TypedDict):
    maps: list[str]
    seed_base: int
    seeds: int


class Shard(TypedDict):
    shard: int
    cost: int
    cells: int
    pieces: list[Piece]


def expand_maps(patterns: Sequence[str]) -> list[str]:
    """Map files of ``patterns`` (a glob is expanded), sorted, without duplicates."""
    out: set[str] = set()
    for pattern in patterns:
        found = sorted(glob.glob(pattern)) if glob.has_magic(pattern) else [pattern]
        if not found or not all(Path(p).is_file() for p in found):
            raise ValueError(f"no map file for {pattern!r}")
        out.update(found)
    return sorted(out)


def map_cost(path: str | Path) -> int:
    """The expected cost of one match on the map: its node count (module docstring)."""
    nodes = json.loads(Path(path).read_text(encoding="utf-8"))["nodes"]
    return max(1, len(nodes))


def _pieces(cells: Sequence[tuple[int, str]]) -> list[Piece]:
    """The cells ``(seed, map)`` of a part as pieces: the maps of every seed, then consecutive
    seeds with the same maps in one piece (a part of the seed-major list gives at most three)."""
    by_seed: list[tuple[int, list[str]]] = []
    for seed, path in cells:
        if by_seed and by_seed[-1][0] == seed:
            by_seed[-1][1].append(path)
        else:
            by_seed.append((seed, [path]))
    pieces: list[Piece] = []
    for seed, paths in by_seed:
        last = pieces[-1] if pieces else None
        if last and last["maps"] == paths and last["seed_base"] + last["seeds"] == seed:
            last["seeds"] += 1
        else:
            pieces.append({"maps": paths, "seed_base": seed, "seeds": 1})
    return pieces


def _parts(costs: Sequence[int], limit: int) -> list[tuple[int, int]]:
    """Greedy contiguous parts ``[a, b)`` of ``costs``, each with a sum of at most ``limit``."""
    parts: list[tuple[int, int]] = []
    a, acc = 0, 0
    for j, c in enumerate(costs):
        if acc + c > limit and j > a:
            parts.append((a, j))
            a, acc = j, 0
        acc += c
    parts.append((a, len(costs)))
    return parts


def plan(
    maps: Sequence[tuple[str, int]], seeds: int, shards: int, seed_base: int = 0
) -> list[Shard]:
    """Split the cells of ``maps`` (``(path, cost)``) x seeds over ``min(shards, cells)`` jobs.

    The cells are listed seed-major (every map of a seed, then the next seed), so cells of different
    cost alternate and a contiguous part can be cut finely. The cut is contiguous with the least
    possible largest cost (a binary search over the limit of a greedy cut: the wall time of a run is
    its slowest shard); then the costliest part of more than one cell is halved until there are
    ``min(shards, cells)`` parts: more, smaller shards, never a larger maximum.
    """
    if seeds < 1 or shards < 1:
        raise ValueError("seeds and shards must be at least 1")
    if not maps:
        raise ValueError("need at least one map")
    ordered = sorted(maps)
    cells = [(seed, path) for seed in range(seed_base, seed_base + seeds) for path, _ in ordered]
    costs = [cost for _ in range(seeds) for _, cost in ordered]
    count = min(shards, len(cells))
    lo, hi = max(costs), sum(costs)
    while lo < hi:
        mid = (lo + hi) // 2  # non-negative, rounds down
        if len(_parts(costs, mid)) <= count:
            hi = mid
        else:
            lo = mid + 1
    parts = _parts(costs, lo)
    while len(parts) < count:
        i = max(
            (k for k, (a, b) in enumerate(parts) if b - a > 1),
            key=lambda k: (sum(costs[parts[k][0] : parts[k][1]]), -k),
        )
        a, b = parts[i]
        whole = sum(costs[a:b])
        # The cut nearest to the middle of the part's cost, a cell on each side.
        cut = min(range(a + 1, b), key=lambda j: abs(2 * sum(costs[a:j]) - whole))
        parts[i : i + 1] = [(a, cut), (cut, b)]
    return [
        {"shard": n, "cost": sum(costs[a:b]), "cells": b - a, "pieces": _pieces(cells[a:b])}
        for n, (a, b) in enumerate(parts)
    ]


Key = tuple[str, int, str, str]


def merge_lines(
    shards: Sequence[Sequence[str]],
    seeds: int | None = None,
    seed_base: int = 0,
    map_count: int | None = None,
) -> list[str]:
    """The rows (without newlines) of all shards in single-run order (checks: module docstring)."""
    keyed: list[tuple[Key, str]] = []
    seen: set[Key] = set()
    identity: set[tuple[object, object]] = set()
    for lines in shards:
        for line in lines:
            if not line:
                continue
            row = json.loads(line)
            key: Key = (row["map"], row["seed"], row["bot0"], row["bot1"])
            if key in seen:
                raise ValueError(f"duplicate match {key}")
            seen.add(key)
            identity.add((row["ruleset_hash"], row["sim_version"]))
            keyed.append((key, line))
    if not keyed:
        raise ValueError("no rows to merge")
    if len(identity) != 1:
        found = sorted(map(str, identity))
        raise ValueError(f"shards differ in ruleset_hash or sim_version: {found}")
    names = sorted({k[0] for k in seen})
    seed_list = sorted({k[1] for k in seen})
    bots = sorted({k[2] for k in seen} | {k[3] for k in seen})
    if seeds is not None and seed_list != list(range(seed_base, seed_base + seeds)):
        raise ValueError(f"missing seeds: expected {seed_base}..{seed_base + seeds - 1}")
    if map_count is not None and len(names) != map_count:
        raise ValueError(f"missing maps: {len(names)} of {map_count} ({names})")
    if len(seen) != len(names) * len(seed_list) * len(bots) ** 2:
        for m in names:
            for s in seed_list:
                for b0 in bots:
                    for b1 in bots:
                        if (m, s, b0, b1) not in seen:
                            raise ValueError(f"missing match {(m, s, b0, b1)}")
    keyed.sort(key=lambda item: item[0])
    return [line for _, line in keyed]


def merge_files(
    paths: Sequence[str | Path],
    out: str | Path,
    seeds: int | None = None,
    seed_base: int = 0,
    map_count: int | None = None,
) -> int:
    """Merge shard files into ``out`` (ASCII, ``\\n``); returns the number of rows."""
    shards = [Path(p).read_text(encoding="ascii").splitlines() for p in paths]
    rows = merge_lines(shards, seeds, seed_base, map_count)
    with Path(out).open("w", encoding="ascii", newline="\n") as f:
        for row in rows:
            f.write(row + "\n")
    return len(rows)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("plan", help="print the shard matrix as JSON")
    p.add_argument("--maps", nargs="+", required=True, help="map files (a glob is expanded)")
    p.add_argument("--seeds", type=int, required=True)
    p.add_argument("--shards", type=int, required=True)
    p.add_argument("--seed-base", type=int, default=0)
    m = sub.add_parser("merge", help="merge shard JSONL files into one")
    m.add_argument("--out", required=True)
    m.add_argument("--seeds", type=int, default=None, help="expected seed count")
    m.add_argument("--seed-base", type=int, default=0)
    m.add_argument("--map-count", type=int, default=None, help="expected number of maps")
    m.add_argument("files", nargs="+")
    args = parser.parse_args(argv)
    if args.command == "plan":
        maps = [(path, map_cost(path)) for path in expand_maps(args.maps)]
        shards = plan(maps, args.seeds, args.shards, args.seed_base)
        print(json.dumps(shards, separators=(",", ":")))
    else:
        n = merge_files(sorted(args.files), args.out, args.seeds, args.seed_base, args.map_count)
        print(f"merged {len(args.files)} shards, {n} rows into {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
