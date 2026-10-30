"""Shard a tournament by seed range and merge the shards back (#582, standard library only).

    python scripts/tournament_shards.py plan --seeds 100 --shards 10 [--seed-base 0]
    python scripts/tournament_shards.py merge --out merged.jsonl shard0.jsonl shard1.jsonl ...

``plan`` prints a JSON list ``[{"shard": 0, "seed_base": 0, "seeds": 10}, ...]`` for a GitHub
matrix: the seeds ``seed_base .. seed_base + seeds - 1`` split into at most ``--shards`` contiguous
ranges of nearly equal size (never an empty one).

``merge`` puts the rows of the shards in the order a single run writes them: ``(map, seed, bot0,
bot1)``, see ``gow_bots.tournament`` (maps are sorted by name, seeds numerically, bots by name).
Rows are copied as the exact text of the shard, so a merge of shards of one run is byte-identical
to the file of the unsharded run. It fails on a duplicate match, on rows of different rulesets or
simulation versions, and on an empty input.
"""

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path


def plan(seeds: int, shards: int, seed_base: int = 0) -> list[dict[str, int]]:
    """Contiguous seed ranges for at most ``shards`` jobs, sizes differ by at most one."""
    if seeds < 1 or shards < 1:
        raise ValueError("seeds and shards must be at least 1")
    count = min(seeds, shards)
    size, extra = divmod(seeds, count)
    out: list[dict[str, int]] = []
    start = seed_base
    for shard in range(count):
        n = size + (1 if shard < extra else 0)
        out.append({"shard": shard, "seed_base": start, "seeds": n})
        start += n
    return out


def merge_lines(shards: Sequence[Sequence[str]]) -> list[str]:
    """The rows (without newlines) of all shards in single-run order."""
    keyed: list[tuple[tuple[str, int, str, str], str]] = []
    seen: set[tuple[str, int, str, str]] = set()
    identity: set[tuple[object, object]] = set()
    for lines in shards:
        for line in lines:
            if not line:
                continue
            row = json.loads(line)
            key = (row["map"], row["seed"], row["bot0"], row["bot1"])
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
    keyed.sort(key=lambda item: item[0])
    return [line for _, line in keyed]


def merge_files(paths: Sequence[str | Path], out: str | Path) -> int:
    """Merge shard files into ``out`` (ASCII, ``\\n``); returns the number of rows."""
    shards = [Path(p).read_text(encoding="ascii").splitlines() for p in paths]
    rows = merge_lines(shards)
    with Path(out).open("w", encoding="ascii", newline="\n") as f:
        for row in rows:
            f.write(row + "\n")
    return len(rows)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("plan", help="print the shard matrix as JSON")
    p.add_argument("--seeds", type=int, required=True)
    p.add_argument("--shards", type=int, required=True)
    p.add_argument("--seed-base", type=int, default=0)
    m = sub.add_parser("merge", help="merge shard JSONL files into one")
    m.add_argument("--out", required=True)
    m.add_argument("files", nargs="+")
    args = parser.parse_args(argv)
    if args.command == "plan":
        print(json.dumps(plan(args.seeds, args.shards, args.seed_base), separators=(",", ":")))
    else:
        n = merge_files(sorted(args.files), args.out)
        print(f"merged {len(args.files)} shards, {n} rows into {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
