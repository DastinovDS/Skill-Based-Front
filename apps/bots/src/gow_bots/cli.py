"""``gow-bots``: the command line of the bot tooling (AGENTS.md, section 3).

``gow-bots tournament`` plays a tournament and writes JSONL (``gow_bots.tournament``);
``gow-bots analyze`` prints the metrics and the player statistics (``stats`` key) of replay
files, e.g. real matches, as JSONL (``gow_sim.analysis``);
``gow-bots stats`` prints the player statistics of replay files as a table (``gow_bots.stats``);
``gow-bots report`` turns a tournament file into a Markdown balance report (``gow_bots.report``);
``gow-bots search`` tunes the parameter ranges of one bot by tournament (``gow_bots.search``).
"""

import argparse
import glob
import json
import sys
import time
from collections.abc import Sequence
from pathlib import Path

from gow_bots.bots import BOTS
from gow_bots.report import write_report
from gow_bots.search import base_ranges, best_of_log, params_fragment, run_search, write_round
from gow_bots.stats import render_stats
from gow_bots.tournament import build_tasks, run_tournament
from gow_sim.analysis import analyze, analyze_stats
from gow_sim.replay import DEFAULT_MAPS_DIR, DEFAULT_RULESETS_DIR, ReplayError, replay_log

DEFAULT_OUT = "docs/balance/latest.jsonl"
DEFAULT_REPORT_DIR = "docs/balance"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="gow-bots", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    t = sub.add_parser("tournament", help="play a bot tournament and write JSONL")
    t.add_argument("--maps", nargs="+", required=True, help="map files (a glob is expanded)")
    t.add_argument("--bots", nargs="+", default=["all"], help="bot names or 'all' (the registry)")
    t.add_argument("--seeds", type=int, default=100, help="seeds per map and pair (default 100)")
    t.add_argument("--seed-base", type=int, default=0, help="first seed (default 0)")
    t.add_argument("--jobs", type=int, default=None, help="worker processes (default: CPU count)")
    t.add_argument("--ruleset", default="rulesets/mvp-0.toml")
    t.add_argument("--out", default=DEFAULT_OUT, help=f"result file (default {DEFAULT_OUT})")
    t.add_argument("--replays", default=None, help="folder to record a replay of every match")
    a = sub.add_parser("analyze", help="print the metrics and statistics of replay files as JSONL")
    s = sub.add_parser("stats", help="print the player statistics of replay files as a table")
    for p in (a, s):
        p.add_argument("replays", nargs="+", help="replay files")
        p.add_argument("--rulesets", default=str(DEFAULT_RULESETS_DIR), help="ruleset archive")
        p.add_argument("--maps", default=str(DEFAULT_MAPS_DIR), help="map folder")
    r = sub.add_parser("report", help="build a Markdown balance report with charts from JSONL")
    r.add_argument("file", help="tournament result (JSONL)")
    r.add_argument("--out-dir", default=DEFAULT_REPORT_DIR, help="folder (default docs/balance)")
    r.add_argument("--name", default=None, help="file name prefix (default: stem of the input)")
    q = sub.add_parser("search", help="tune the parameter ranges of one bot by tournament")
    q.add_argument("--bot", required=True, help="the bot to tune (a smart one may take @level)")
    q.add_argument("--against", nargs="+", required=True, help="the opponents")
    q.add_argument("--keys", nargs="+", required=True, help="parameters to tune")
    q.add_argument("--maps", nargs="+", required=True, help="map files (a glob is expanded)")
    q.add_argument("--ruleset", default="rulesets/mvp-1.toml")
    q.add_argument("--rounds", type=int, default=20, help="mutations to try (default 20)")
    q.add_argument("--seeds", type=int, default=4, help="seeds per map and pair (default 4)")
    q.add_argument("--seed-base", type=int, default=0, help="first seed (default 0)")
    q.add_argument("--mutate", type=int, default=2, help="keys moved per round (default 2)")
    q.add_argument("--target", type=float, default=None, help="aim at this win rate, not up")
    q.add_argument("--search-seed", type=int, default=0, help="seed of the mutations")
    q.add_argument("--jobs", type=int, default=None, help="worker processes (default: CPU count)")
    q.add_argument("--out", default="search.jsonl", help="round log (JSONL)")
    q.add_argument("--resume", default=None, help="start from the best ranges of a round log")
    return parser


def _search(args: argparse.Namespace) -> int:
    maps = sorted({m for pattern in args.maps for m in (glob.glob(pattern) or [pattern])})
    start = base_ranges(args.bot)
    first = best_of_log(args.resume) if args.resume else None
    best = None
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="ascii", newline="\n") as f:
        for n, cand, accepted in run_search(
            maps,
            args.ruleset,
            args.bot,
            args.against,
            keys=args.keys,
            rounds=args.rounds,
            seeds=args.seeds,
            seed_base=args.seed_base,
            mutate_count=args.mutate,
            target=args.target,
            search_seed=args.search_seed,
            jobs=args.jobs,
            start=first,
        ):
            write_round(f, n, cand, accepted)
            if accepted:
                best = cand
            mark = "accepted" if accepted else "rejected"
            print(
                f"round {n}: win rate {cand.win_rate:.3f} vp share {cand.vp_share:.3f} {mark}",
                file=sys.stderr,
            )
    assert best is not None
    print(f"best win rate {best.win_rate:.3f}; changed ranges:")
    print(params_fragment(best.ranges, start))
    return 0


def _tournament(args: argparse.Namespace) -> int:
    maps = sorted({m for pattern in args.maps for m in (glob.glob(pattern) or [pattern])})
    bots = sorted(BOTS) if "all" in args.bots else list(args.bots)
    tasks = build_tasks(maps, args.ruleset, bots, args.seeds, args.seed_base, args.replays)
    print(
        f"{len(tasks)} matches: {len(maps)} maps x {len(bots)} bots ({', '.join(bots)}) "
        f"x {args.seeds} seeds, ruleset {args.ruleset}",
        file=sys.stderr,
    )
    started = time.monotonic()
    for done, _ in enumerate(run_tournament(tasks, args.out, args.jobs), start=1):
        if done % 50 == 0 or done == len(tasks):
            print(f"{done}/{len(tasks)} {time.monotonic() - started:.0f}s", file=sys.stderr)
    print(f"wrote {args.out}", file=sys.stderr)
    return 0


def _analyze(args: argparse.Namespace, *, table: bool) -> int:
    failed = 0
    for n, file in enumerate(args.replays):
        try:
            log = replay_log(file, args.rulesets, args.maps)
        except ReplayError as exc:
            failed += 1
            print(f"ERROR {exc}", file=sys.stderr)
            continue
        metrics, stats = analyze(log), analyze_stats(log)
        if table:
            print(("\n" if n else "") + render_stats(Path(file).name, metrics, stats))
        else:
            row = {"replay": Path(file).name, **metrics.to_json(), "stats": stats.to_json()}
            print(json.dumps(row, separators=(",", ":"), ensure_ascii=True))
    return 1 if failed else 0


def _report(args: argparse.Namespace) -> int:
    for path in write_report(args.file, args.out_dir, args.name):
        print(f"wrote {path}", file=sys.stderr)
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "tournament":
            return _tournament(args)
        if args.command == "report":
            return _report(args)
        if args.command == "search":
            return _search(args)
        return _analyze(args, table=args.command == "stats")
    except (ValueError, OSError) as exc:  # unknown bot, bad map or ruleset file
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
