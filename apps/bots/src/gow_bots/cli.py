"""``gow-bots``: the command line of the bot tooling (AGENTS.md, section 3).

``gow-bots tournament`` plays a tournament and writes JSONL (``gow_bots.tournament``);
``gow-bots analyze`` prints the metrics of replay files, e.g. real matches (``gow_sim.analysis``);
``gow-bots report`` turns a tournament file into a Markdown balance report (``gow_bots.report``).
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
from gow_bots.tournament import build_tasks, run_tournament
from gow_sim.replay import DEFAULT_MAPS_DIR, DEFAULT_RULESETS_DIR, ReplayError, analyze_replay

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
    a = sub.add_parser("analyze", help="print the metrics of replay files as JSONL")
    a.add_argument("replays", nargs="+", help="replay files")
    a.add_argument("--rulesets", default=str(DEFAULT_RULESETS_DIR), help="ruleset archive")
    a.add_argument("--maps", default=str(DEFAULT_MAPS_DIR), help="map folder")
    r = sub.add_parser("report", help="build a Markdown balance report with charts from JSONL")
    r.add_argument("file", help="tournament result (JSONL)")
    r.add_argument("--out-dir", default=DEFAULT_REPORT_DIR, help="folder (default docs/balance)")
    r.add_argument("--name", default=None, help="file name prefix (default: stem of the input)")
    return parser


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


def _analyze(args: argparse.Namespace) -> int:
    failed = 0
    for file in args.replays:
        try:
            metrics = analyze_replay(file, args.rulesets, args.maps)
        except ReplayError as exc:
            failed += 1
            print(f"ERROR {exc}", file=sys.stderr)
            continue
        row = {"replay": Path(file).name, **metrics.to_json()}
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
        return _report(args) if args.command == "report" else _analyze(args)
    except (ValueError, OSError) as exc:  # unknown bot, bad map or ruleset file
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
