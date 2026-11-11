"""Peak APM that spends resources (#965, ``docs/balance/apm-ceiling.md``).

    mise exec -- uv run python scripts/apm_ceiling.py ceiling [--ruleset R] [--nodes 29 49 55]
    mise exec -- uv run python scripts/apm_ceiling.py replays FILE... [--jobs 4] > rows.jsonl

``ceiling`` prints the analytic ceiling of a ruleset per stance and node count N as a markdown
table: the economy periods after map tempo (DEC-46, ``apply_map_tempo``: ``max(1, p * 100 // pct)``)
and the commands per minute that the CP income and the charge income can pay for. Every number
comes from the ruleset, nothing from a match.

``replays`` re-simulates replay files (``gow_sim.replay.replay_log``, as ``gow-bots stats`` does)
and prints one JSON line per match and player: commands, useful commands (accepted and spending
CP or charges), their peaks over sliding 10 s and 60 s windows in commands per minute, the useful
commands by kind, the CP spent by commands and by recruit rally walks, the stance shares.

A useful command is accepted and either costs CP (``Ok.cost > 0``: ``Move``, a planned ``Move``,
``GroupMove``, ``Recruit``, ``FortifyRoad``) or is paid in charges (``BuildBarracks``,
``BuildFactory``). A recruit rally walk pays CP without a command, so it is CP spent but no action.
``Forfeit`` is outside APM, as in ``gow_sim.analysis``.
"""

import argparse
import json
import sys
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from gow_sim.analysis import analyze_stats
from gow_sim.replay import DEFAULT_MAPS_DIR, DEFAULT_RULESETS_DIR, replay_log
from gow_sim.ruleset import Ruleset, Stance, load_ruleset

CHARGE_PAID = ("BuildBarracks", "BuildFactory")
"""Commands paid in charges by the progressive payment (DEC-41, item 7), no CP."""
WINDOWS_S = (10, 60)
STANCES = (Stance.WAR, Stance.BALANCE, Stance.ECONOMY)


# ---- the analytic ceiling -------------------------------------------------------------------
def pct(rules: Ruleset, nodes: int) -> int:
    return 100 if rules.map_tempo is None else rules.map_tempo.pct(nodes)


def scaled(period: int, p: int) -> int:
    """DEC-46, item 2 (``gow_sim.ruleset._scaled``)."""
    return max(1, period * 100 // p)


def cheapest_cp_command(rules: Ruleset) -> int:
    """The lowest positive CP price of one command, hundredths."""
    cost = rules.orders.cost
    prices = [cost.move, cost.planned_move, cost.recruit, rules.fort.cost, cost.split, cost.merge]
    go = rules.group_order
    if go is not None:  # a rally of one group (DEC-48, item A2): rounded up to a whole CP
        prices.append((cost.move * go.rally_pct + 9999) // 10000 * 100)
    return min(p for p in prices if p > 0)


def cheapest_charge_command(rules: Ruleset) -> int:
    return min(rules.city_upgrades.barracks_charges, rules.factory.cost)


def ceiling_rows(rules: Ruleset, nodes: list[int]) -> list[dict[str, object]]:
    hz = rules.tick_hz
    cp_cmd = cheapest_cp_command(rules)
    ch_cmd = cheapest_charge_command(rules)
    rows: list[dict[str, object]] = []
    for n in nodes:
        p = pct(rules, n)
        for stance in STANCES:
            p_cp = scaled(getattr(rules.stances.cp_period_ticks, stance.value), p)
            p_f = scaled(getattr(rules.stances.capital_period_ticks, stance.value), p)
            cp_min = rules.cp.per_period * 60 * hz / p_cp / 100  # CP a minute
            ch_min = rules.factory.max * 60 * hz / p_f  # charges a minute, factory.max factories
            a_cp = cp_min * 100 / cp_cmd
            a_ch = ch_min / ch_cmd
            row: dict[str, object] = {
                "nodes": n,
                "pct": p,
                "stance": stance.value,
                "cp_period": p_cp,
                "factory_period": p_f,
                "cp_per_min": round(cp_min, 2),
                "charges_per_min": round(ch_min, 2),
                "apm_cp": round(a_cp, 2),
                "apm_charges": round(a_ch, 2),
                "apm_sustained": round(a_cp + a_ch, 2),
                "burst": rules.cp.cap // cp_cmd,
                "cap_refill_s": round((rules.cp.cap / rules.cp.per_period) * p_cp / hz, 1),
            }
            for w in WINDOWS_S:
                # Commands applied in ticks t..t+W-1, at the cap after tick t-1. Commands go before
                # the economy in a tick, so a quantum of ticks t..t+W-2 can still be spent in the
                # window: at most ceil((W - 1) / P_cp) of them.
                quanta = (w * hz - 1 + p_cp - 1) // p_cp
                actions = (rules.cp.cap + quanta * rules.cp.per_period) // cp_cmd
                row[f"apm_{w}s"] = round(actions * 60 / w, 1)
            rows.append(row)
    return rows


def print_ceiling(rows: list[dict[str, object]]) -> None:
    keys = list(rows[0])
    print("| " + " | ".join(keys) + " |")
    print("|" + "---|" * len(keys))
    for r in rows:
        print("| " + " | ".join(str(r[k]) for k in keys) + " |")


# ---- replays --------------------------------------------------------------------------------
def peak(ticks: list[int], window: int) -> int:
    """The most ticks of ``ticks`` (sorted) inside any ``window`` consecutive ticks."""
    best = 0
    lo = 0
    for hi, t in enumerate(ticks):
        while t - ticks[lo] >= window:
            lo += 1
        best = max(best, hi - lo + 1)
    return best


def replay_rows(file: str, rulesets: str, maps: str) -> list[dict[str, object]]:
    log = replay_log(file, rulesets, maps)
    stats = analyze_stats(log)
    name = Path(file).name.split(".")[0]
    parts = name.split("__")
    rows: list[dict[str, object]] = []
    for player in (0, 1):
        mine = [c for c in log.commands if c.player == player and c.kind != "Forfeit"]
        useful = [c for c in mine if c.accepted and (c.cost > 0 or c.kind in CHARGE_PAID)]
        walk_cp = sum(
            int(e.get("cost"))  # pyright: ignore[reportArgumentType]
            for e in log.events
            if e.kind == "rally_walk_paid" and e.get("player") == player
        )
        minutes = log.ticks / (60 * log.tick_hz)
        row: dict[str, object] = {
            "replay": Path(file).name,
            "map": parts[0],
            "bot": parts[1].split("_vs_")[player] if len(parts) > 1 else "",
            "player": player,
            "ticks": log.ticks,
            "commands": len(mine),
            "accepted": sum(1 for c in mine if c.accepted),
            "useful": len(useful),
            "apm": round(len(mine) / minutes, 2) if minutes else None,
            "useful_apm": round(len(useful) / minutes, 2) if minutes else None,
            "useful_by_kind": dict(sorted(Counter(c.kind for c in useful).items())),
            "planned": sum(1 for c in useful if c.planned),
            "cp_commands": sum(c.cost for c in mine if c.accepted),
            "cp_rally_walks": walk_cp,
            "stance_share": stats.players[player].stance_share,
        }
        for w in WINDOWS_S:
            span = w * log.tick_hz
            row[f"peak_{w}s"] = round(peak([c.tick for c in mine], span) * 60 / w, 1)
            row[f"useful_peak_{w}s"] = round(peak([c.tick for c in useful], span) * 60 / w, 1)
        rows.append(row)
    return rows


def _rows(args: tuple[str, str, str]) -> list[dict[str, object]]:
    return replay_rows(*args)


def main() -> int:
    parser = argparse.ArgumentParser(description="Peak APM that spends resources (#965).")
    sub = parser.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("ceiling", help="the analytic ceiling of a ruleset as a markdown table")
    c.add_argument("--ruleset", default="rulesets/mvp-7.toml")
    c.add_argument("--nodes", type=int, nargs="+", default=[29, 49, 51, 54, 55, 80, 111, 150])
    c.add_argument("--json", action="store_true", help="JSON lines instead of the table")
    r = sub.add_parser("replays", help="commands and useful commands of replay files, JSON lines")
    r.add_argument("files", nargs="+")
    r.add_argument("--rulesets", default=str(DEFAULT_RULESETS_DIR))
    r.add_argument("--maps", default=str(DEFAULT_MAPS_DIR))
    r.add_argument("--jobs", type=int, default=1)
    args = parser.parse_args()
    if args.cmd == "ceiling":
        rows = ceiling_rows(load_ruleset(args.ruleset), args.nodes)
        if args.json:
            for row in rows:
                print(json.dumps(row))
        else:
            print_ceiling(rows)
        return 0
    tasks = [(f, args.rulesets, args.maps) for f in sorted(args.files)]
    with ProcessPoolExecutor(max_workers=args.jobs) as pool:
        for rows in pool.map(_rows, tasks):
            for row in rows:
                print(json.dumps(row))
    return 0


if __name__ == "__main__":
    sys.exit(main())
