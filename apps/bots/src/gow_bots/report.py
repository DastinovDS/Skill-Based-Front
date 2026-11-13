"""Balance report (BOT-05): Markdown and charts from a tournament JSONL.

``gow-bots report <file.jsonl>`` reads the rows written by ``gow_bots.tournament`` and writes
``<name>.md`` and a few ``<name>-*.png`` charts into one folder. The numbers are a pure function
of the rows (no clock, no randomness), so the same file gives the same Markdown.

Conventions:

- A *perspective* is one player of one match: ``(bot, opponent, side)``. Every row has two.
- ``win rate`` of A against B = wins of A / all matches of A against B on both sides (a draw or an
  unfinished match is not a win). The 95% interval is the Wilson score interval (``wilson``).
- A *beats* B when A has more wins than B in their matches; the beat is *significant* when the
  Wilson interval of A's share among the decisive matches excludes 0.5.
- Side advantage is measured on mirror matches (a bot against itself): the share of side 0 among
  the decisive matches. Without a bot difference only the map and the start side are left.
- Matches of a bot against itself count for the per-bot behaviour metrics (attack planning,
  sieges, captures) but not for win rates.
- Mechanic usage (#166): the share of a bot's perspectives in which it used a mechanic at least
  once, and the mean count per match (``usage`` of the rows; files without it show n/a).
- Rows of schema 1 (written before #894) are read too; their fields of economy v1 and of the
  drawn lines are not shown. The data validity checks, the level ladder, the Bradley-Terry model
  and the style matrix come from ``gow_bots.validity``.
"""

# matplotlib's inline types leave ``**kwargs`` of most Axes methods unannotated, so strict
# pyright reports every call as partially unknown. The rest of the strict checks stay on.
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false

import json
import math
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from itertools import combinations
from pathlib import Path
from statistics import median
from typing import Any, Final

from gow_bots import validity
from gow_bots.tournament import READ_SCHEMAS, USAGE_KEYS
from gow_bots.validity import wilson

__all__ = [
    "REPORT_Z",
    "Row",
    "load_rows",
    "render_report",
    "wilson",
    "write_report",
]

REPORT_Z: Final = validity.Z
"""z of the 95% confidence interval."""
LATE_MINUTES: Final = 3
"""The tail of a match that the late-capture metric looks at."""
STRANGLER_MIN_RATE: Final = 0.5
"""BOT-05 check: a strangler takes a city by siege in at least this share of matches."""

_STRANGLER, _EXPANDER, _REACTIVE, _RUSHER, _TURTLE = (
    "strangler",
    "expander",
    "reactive",
    "rusher",
    "turtle",
)


# --- reading the rows ------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Row:
    """One match of the tournament file (the fields the report uses)."""

    map: str
    map_hash: str
    ruleset_hash: str
    sim_version: int
    seed: int
    bots: tuple[str, str]
    state_hash: str
    winner: int | None
    reason: str
    ticks: int
    vp: tuple[int, int]
    cities: tuple[int, int]
    attack_orders: tuple[int, int]
    planned_attack_orders: tuple[int, int]
    sieges: tuple[int, int]
    sieges_won: tuple[int, int]
    captures: tuple[int, int]
    captures_by_minute: tuple[tuple[int, ...], tuple[int, ...]]
    stock_mean_centi: tuple[int | None, int | None] | None = None
    """Charge stock fields (#310); ``None`` in a file written before they existed."""
    stock_peak: tuple[int, int] | None = None
    charges_produced: tuple[int, int] | None = None
    charges_burned: tuple[int, int] | None = None
    usage: tuple[dict[str, int], dict[str, int]] | None = None
    """Accepted commands per mechanic by side (#166); ``None`` in an older file."""
    flow: dict[str, tuple[int, int]] | None = None
    """Integer charge ledger fields by side (#588), keyed as in the row (``charges_start``,
    ``cap_full_ticks``, ...); ``None`` in a file written before they existed."""
    places: tuple[dict[str, list[int | None]], dict[str, list[int | None]]] | None = None
    """``stock_by_place_minute`` by side (#588)."""
    siege_orders: tuple[int, int] | None = None
    """Attack orders into a node with an enemy garrison (#590); ``None`` in an older file."""
    planned_siege_orders: tuple[int, int] | None = None
    cp: dict[str, tuple[int, int]] | None = None
    """``CP_KEYS`` by side (#743); ``None`` in a file written before they existed."""
    accepted: tuple[int, int] | None = None
    """Accepted commands of all kinds by side."""
    extra: dict[str, tuple[int, int]] | None = None
    """The per-side ``EXTRA_KEYS`` the row has (#690, #707); a key the row lacks is absent."""
    first_contact_tick: int | None = None
    """The first fight or capture of an enemy node (#690); ``None`` also in an older file."""

    @property
    def outcome(self) -> tuple[int | None, str, tuple[int, int], tuple[int, int]]:
        """What happened, without the identification of the match (for the diversity count)."""
        return (self.winner, self.reason, self.vp, self.cities)


def _pair(raw: dict[str, Any], key: str) -> tuple[int, int]:
    value = raw[key]
    return (int(value[0]), int(value[1]))


def _stock_mean(raw: dict[str, Any]) -> tuple[int | None, int | None] | None:
    value = raw.get("stock_mean_centi")
    if value is None:
        return None
    first, second = value
    return (None if first is None else int(first), None if second is None else int(second))


def _opt_pair(raw: dict[str, Any], key: str) -> tuple[int, int] | None:
    return _pair(raw, key) if key in raw else None


def _usage(raw: dict[str, Any]) -> tuple[dict[str, int], dict[str, int]] | None:
    value = raw.get("usage")
    if value is None:
        return None
    first, second = value
    return (
        {str(k): int(v) for k, v in first.items()},
        {str(k): int(v) for k, v in second.items()},
    )


FLOW_KEYS: Final[tuple[str, ...]] = (
    "charges_start",
    "charges_fights",
    "charges_captures",
    "charges_packets_lost",
    "charges_warehouses_lost",
    "charges_starved",
    "charges_attrition",
    "charges_end",
    "charges_residual",
    "charges_sent",
    "charges_delivered",
    "cap_full_ticks",
)
"""The integer per-side fields of the charge flow (#588) that the report reads."""
PLACE_KEYS: Final[tuple[str, ...]] = (
    "cap_wh",
    "rear_wh",
    "units_node",
    "units_road",
    "packets",
)
"""The places of ``stock_by_place_minute``; the same as ``gow_sim.analysis.PLACES``."""


CP_KEYS: Final[tuple[str, ...]] = (
    "cp_burned",
    "cp_cap_ticks",
    "idle_discharged_connected",
    "idle_discharged_pocket",
)
"""The per-side CP and idle unit fields (#743): CP burned in hundredths, ticks at the CP cap, idle
discharged unit-ticks in the capital's component and in pockets."""


EXTRA_KEYS: Final[tuple[str, ...]] = (
    "charges_tolls",
    "tolls_paid",
    "forts_built",
    "siege_fights",
    "siege_walk_ins",
    "contested_sieges",
    "contested_sieges_won",
    "units_killed",
    "charges_built_lost",
    "cp_cancelled",
)
"""Per-side fields read one by one, each may be missing: the road fortifications of DEC-43 (#707)
and the efficiency fields of #690."""


V2_FLOW_KEYS: Final[tuple[str, ...]] = ("charges_built", "charges_plans")
"""The building and plan sinks of the ledger (DEC-41, #646): 0 in a file written before them."""


def _flow(raw: dict[str, Any]) -> dict[str, tuple[int, int]] | None:
    if any(k not in raw for k in FLOW_KEYS):
        return None
    flow = {k: _pair(raw, k) for k in FLOW_KEYS}
    for k in V2_FLOW_KEYS:
        flow[k] = _pair(raw, k) if k in raw else (0, 0)
    return flow


def _cp(raw: dict[str, Any]) -> dict[str, tuple[int, int]] | None:
    if any(k not in raw for k in CP_KEYS):
        return None
    return {k: _pair(raw, k) for k in CP_KEYS}


def _places(
    raw: dict[str, Any],
) -> tuple[dict[str, list[int | None]], dict[str, list[int | None]]] | None:
    value = raw.get("stock_by_place_minute")
    if value is None:
        return None
    first, second = value
    return (
        {str(k): [None if x is None else int(x) for x in v] for k, v in first.items()},
        {str(k): [None if x is None else int(x) for x in v] for k, v in second.items()},
    )


def _parse_row(raw: dict[str, Any]) -> Row:
    minutes = raw["captures_by_minute"]
    winner = raw["winner"]
    return Row(
        map=str(raw["map"]),
        map_hash=str(raw["map_hash"]),
        ruleset_hash=str(raw["ruleset_hash"]),
        sim_version=int(raw["sim_version"]),
        seed=int(raw["seed"]),
        bots=(str(raw["bot0"]), str(raw["bot1"])),
        state_hash=str(raw["state_hash"]),
        winner=None if winner is None else int(winner),
        reason=str(raw["reason"]),
        ticks=int(raw["ticks"]),
        vp=_pair(raw, "vp"),
        cities=_pair(raw, "cities"),
        attack_orders=_pair(raw, "attack_orders"),
        planned_attack_orders=_pair(raw, "planned_attack_orders"),
        sieges=_pair(raw, "sieges"),
        sieges_won=_pair(raw, "sieges_won"),
        captures=_pair(raw, "captures"),
        captures_by_minute=(
            tuple(int(x) for x in minutes[0]),
            tuple(int(x) for x in minutes[1]),
        ),
        stock_mean_centi=_stock_mean(raw),
        stock_peak=_opt_pair(raw, "stock_peak"),
        charges_produced=_opt_pair(raw, "charges_produced"),
        charges_burned=_opt_pair(raw, "charges_burned"),
        usage=_usage(raw),
        flow=_flow(raw),
        places=_places(raw),
        siege_orders=_opt_pair(raw, "siege_orders"),
        planned_siege_orders=_opt_pair(raw, "planned_siege_orders"),
        cp=_cp(raw),
        accepted=_opt_pair(raw, "accepted"),
        extra={k: _pair(raw, k) for k in EXTRA_KEYS if k in raw},
        first_contact_tick=_opt_int(raw, "first_contact_tick"),
    )


def _opt_int(raw: dict[str, Any], key: str) -> int | None:
    value = raw.get(key)
    return None if value is None else int(value)


def load_rows(path: str | Path) -> list[Row]:
    """Read a tournament JSONL; ``ValueError`` on a bad line, a foreign schema or no rows."""
    rows: list[Row] = []
    with open(path, encoding="ascii") as handle:
        for number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                raw = json.loads(line)
                if raw["schema"] not in READ_SCHEMAS:
                    raise ValueError(f"schema {raw['schema']}, this report reads {READ_SCHEMAS}")
                rows.append(_parse_row(raw))
            except (KeyError, IndexError, TypeError, ValueError) as exc:
                raise ValueError(f"{path}:{number}: bad tournament row ({exc!r})") from exc
    if not rows:
        raise ValueError(f"{path}: no matches")
    return rows


# --- perspectives and counters ---------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Persp:
    """One player of one match."""

    row: Row
    side: int
    bot: str
    opp: str

    @property
    def won(self) -> bool:
        return self.row.winner == self.side

    @property
    def late_captures(self) -> int:
        return sum(self.row.captures_by_minute[self.side][-LATE_MINUTES:])


def _persps(rows: Iterable[Row]) -> list[Persp]:
    out: list[Persp] = []
    for r in rows:
        out.append(Persp(r, 0, r.bots[0], r.bots[1]))
        out.append(Persp(r, 1, r.bots[1], r.bots[0]))
    return out


@dataclass(frozen=True, slots=True)
class Rate:
    """``k`` of ``n`` with its Wilson interval."""

    k: int
    n: int

    @property
    def value(self) -> float | None:
        return self.k / self.n if self.n else None

    @property
    def ci(self) -> tuple[float, float]:
        return wilson(self.k, self.n)

    def fmt(self) -> str:
        if not self.n:
            return "n/a"
        lo, hi = self.ci
        return f"{self.k / self.n:.2f} [{lo:.2f}; {hi:.2f}]"

    def short(self) -> str:
        return "n/a" if not self.n else f"{self.k / self.n:.2f}"


def _win_rate(ps: Iterable[Persp]) -> Rate:
    items = list(ps)
    return Rate(sum(p.won for p in items), len(items))


def _bots_of(rows: Sequence[Row]) -> list[str]:
    return sorted({b for r in rows for b in r.bots})


def _share(num: int, den: int) -> str:
    return "n/a" if den == 0 else f"{num / den:.2f}"


def _table(header: Sequence[str], body: Iterable[Sequence[str]]) -> str:
    lines = ["| " + " | ".join(header) + " |", "|" + "|".join("---" for _ in header) + "|"]
    lines.extend("| " + " | ".join(cells) + " |" for cells in body)
    return "\n".join(lines)


# --- sections --------------------------------------------------------------------------------


def _pair_ps(ps: Iterable[Persp], a: str, b: str) -> list[Persp]:
    return [p for p in ps if p.bot == a and p.opp == b]


def _beats(ps: Sequence[Persp], a: str, b: str) -> tuple[bool, bool]:
    """``(a beats b, significantly)``."""
    wins_a = sum(p.won for p in _pair_ps(ps, a, b))
    wins_b = sum(p.won for p in _pair_ps(ps, b, a))
    if wins_a <= wins_b:
        return (False, False)
    return (True, wilson(wins_a, wins_a + wins_b)[0] > 0.5)


def _matrix(ps: Sequence[Persp], bots: Sequence[str], *, full: bool) -> str:
    header = ["row beats column", *bots]
    body: list[list[str]] = []
    for a in bots:
        cells = [f"**{a}**"]
        for b in bots:
            if a == b:
                cells.append("-")
                continue
            rate = _win_rate(_pair_ps(ps, a, b))
            cells.append(rate.fmt() if full else rate.short())
        body.append(cells)
    return _table(header, body)


def _section_overview(rows: Sequence[Row]) -> str:
    maps = sorted({r.map for r in rows})
    reasons = Counter(r.reason for r in rows)
    draws = sum(r.winner is None for r in rows)
    seeds = sorted({r.seed for r in rows})
    contact: list[str] = []
    for m in maps:
        ticks = [r.first_contact_tick for r in rows if r.map == m]
        known = [t for t in ticks if t is not None]
        if known:
            contact.append(
                f"{m} {int(median(known))} ({len(ticks) - len(known)} of {len(ticks)} never met)"
            )
    lines = [
        f"- Matches: {len(rows)}; maps: {', '.join(maps)}; bots: {', '.join(_bots_of(rows))}.",
        f"- Seeds: {seeds[0]}..{seeds[-1]} ({len(seeds)}).",
        f"- Ruleset `{_one(r.ruleset_hash for r in rows)}`, `SIM_VERSION` "
        f"{_one(str(r.sim_version) for r in rows)}.",
        "- Fair field: every bot of the file played without an information grant (the code has "
        "no grants yet, #692, DEC-43); a balance verdict is read only from a fair file.",
        f"- No winner (a draw or not finished): {draws} ({_share(draws, len(rows))}).",
        "- End reasons: " + ", ".join(f"`{k}` {v}" for k, v in sorted(reasons.items())) + ".",
        "- First contact, the median tick of the first fight or capture of an enemy node: "
        + ("; ".join(contact) if contact else "n/a (a file written before #690)")
        + ".",
    ]
    return "\n".join(lines)


def _one(values: Iterable[str]) -> str:
    unique = sorted(set(values))
    return unique[0] if len(unique) == 1 else "different: " + ", ".join(unique)


def _section_pairs(ps: Sequence[Persp], bots: Sequence[str]) -> str:
    rate_rows = [
        [f"**{a}**", *("-" if a == b else _draw_cell(ps, a, b) for b in bots)] for a in bots
    ]
    return (
        "Win rate of the row against the column on both sides, 95% Wilson interval in brackets: "
        "`share [lower; upper]`. A draw does not count as a win.\n\n"
        + _matrix(ps, bots, full=True)
        + "\n\nShare of draws in the pair (all maps):\n\n"
        + _table(["", *bots], rate_rows)
        + "\n\n![pair matrix](PREFIX-pairs.png)"
    )


def _draw_cell(ps: Sequence[Persp], a: str, b: str) -> str:
    items = _pair_ps(ps, a, b)
    return _share(sum(p.row.winner is None for p in items), len(items))


def _section_sides(rows: Sequence[Row]) -> str:
    maps = sorted({r.map for r in rows})
    out: list[list[str]] = []

    def line(label: str, rs: Sequence[Row]) -> list[str]:
        mirror = [r for r in rs if r.bots[0] == r.bots[1]]
        every = list(rs)
        return [label, _side_cell(mirror), _side_cell(every)]

    out.extend(line(m, [r for r in rows if r.map == m]) for m in maps)
    out.append(line("all maps", rows))
    table = _table(["map", "mirror matches: side 0", "all matches: side 0"], out)
    return (
        "Share of wins of side 0 among matches with a winner (`side 0 wins / decided`, Wilson "
        "interval). Mirror matches (a bot against itself) measure the skew of the map without "
        "any difference between bots; in a full tournament every pair plays both sides, so the "
        "second column shows the skew after averaging over bots. An interval that contains 0.5 "
        "gives no grounds to speak of a skew.\n\n" + table + "\n\n![side](PREFIX-sides.png)"
    )


def _side_cell(rs: Sequence[Row]) -> str:
    decided = [r for r in rs if r.winner is not None]
    rate = Rate(sum(r.winner == 0 for r in decided), len(decided))
    return f"{rate.fmt()} (n={rate.n})"


def _section_bots(ps: Sequence[Persp], bots: Sequence[str]) -> str:
    body: list[list[str]] = []
    for b in bots:
        mine = [p for p in ps if p.bot == b]
        versus = [p for p in mine if p.opp != b]
        draw = sum(p.row.winner is None for p in versus)
        attacks = sum(p.row.attack_orders[p.side] for p in mine)
        planned = sum(p.row.planned_attack_orders[p.side] for p in mine)
        sieges = sum(p.row.sieges[p.side] for p in mine)
        with_siege = [p for p in mine if p.row.siege_orders is not None]
        siege_orders = sum(_side(p.row.siege_orders, p.side) for p in with_siege)
        planned_sieges = sum(_side(p.row.planned_siege_orders, p.side) for p in with_siege)
        sieges_won = sum(p.row.sieges_won[p.side] for p in mine)
        caps = sum(p.row.captures[p.side] for p in mine)
        late = sum(p.late_captures for p in mine)
        body.append(
            [
                f"**{b}**",
                str(len(versus)),
                _win_rate(versus).fmt(),
                _share(draw, len(versus)),
                _share(planned_sieges, siege_orders) if with_siege else "n/a",
                _share(planned, attacks),
                f"{_share(sieges_won, sieges)} ({sieges_won}/{sieges})",
                _siege_split(mine),
                _contested_cell(mine),
                f"{caps / len(mine):.2f}",
                _share(late, caps),
            ]
        )
    header = [
        "bot",
        "matches against others",
        "win rate [95%]",
        "draws",
        "share of scheduled attacks",
        "scheduled of all attacks",
        "siege success (taken/attempts)",
        "siege fights / walk-ins per match",
        "contested sieges won (won/fights)",
        "captures per match",
        f"share of captures in the last {LATE_MINUTES} min",
    ]
    return (
        "Win rate is counted against other bots (no mirror matches); the other metrics over "
        'all matches of the bot. The "share of scheduled attacks" (the BAL-02 gate, #590) counts '
        "the `Move` orders into a node with an enemy garrison at the moment of the order: the "
        "scheduled ones (`planned=true`) over all of them (n/a in a file written before #590); "
        '"scheduled of all attacks" is the BAL-01 definition, every `Move` to an enemy or neutral '
        'node. "Siege success" is captures of enemy nodes / siege attempts, and an attempt is '
        "either a fight for an enemy node or a walk into one without defenders, so it reads "
        'target choice more than fighting (#690); "contested sieges" are the fights in which '
        "the defender spent a charge (a charged defender), and their share that ended with the "
        "capture (n/a in a file written before #690)."
        "\n\n" + _table(header, body) + "\n\n![bots by map](PREFIX-bots.png)"
    )


def _extra(p: Persp, key: str) -> int | None:
    """The per-side ``EXTRA_KEYS`` field ``key`` of the perspective; ``None`` when missing."""
    extra = p.row.extra
    return None if extra is None or key not in extra else extra[key][p.side]


def _extra_sum(ps: Sequence[Persp], key: str) -> tuple[int, int]:
    """The sum of ``key`` over the perspectives that have it, and their number."""
    values = [v for p in ps if (v := _extra(p, key)) is not None]
    return sum(values), len(values)


def _siege_split(ps: Sequence[Persp]) -> str:
    fights, n = _extra_sum(ps, "siege_fights")
    walks, _ = _extra_sum(ps, "siege_walk_ins")
    return f"{fights / n:.2f} / {walks / n:.2f}" if n else "n/a"


def _contested_cell(ps: Sequence[Persp]) -> str:
    fights, n = _extra_sum(ps, "contested_sieges")
    won, _ = _extra_sum(ps, "contested_sieges_won")
    return f"{_share(won, fights)} ({won}/{fights})" if n else "n/a"


def _side(pair: tuple[int, int] | None, side: int) -> int:
    return 0 if pair is None else pair[side]


def _stock_cells(ps: Sequence[Persp]) -> list[str]:
    """Charge stock columns of a group of perspectives; rows without the fields are skipped."""
    means: list[int] = []
    peaks: list[int] = []
    produced = burned = 0
    for p in ps:
        row, side = p.row, p.side
        if row.stock_peak is None or row.stock_mean_centi is None:
            continue
        mean = row.stock_mean_centi[side]
        if mean is not None:
            means.append(mean)
        peaks.append(row.stock_peak[side])
        if row.charges_produced is not None and row.charges_burned is not None:
            produced += row.charges_produced[side]
            burned += row.charges_burned[side]
    if not peaks:
        return ["0", "n/a", "n/a", "n/a", "n/a", "n/a"]
    n = len(peaks)
    return [
        str(n),
        f"{sum(means) / (100 * len(means)):.2f}" if means else "n/a",
        f"{sum(peaks) / n:.2f}",
        str(max(peaks)),
        f"{produced / n:.2f}",
        f"{burned * 100 / produced:.1f}% ({burned}/{produced})" if produced else "n/a",
    ]


def _section_stock(ps: Sequence[Persp], rows: Sequence[Row], bots: Sequence[str]) -> str:
    header = [
        "matches",
        "mean stock",
        "mean peak",
        "highest peak",
        "produced per match",
        "burned share (burned/produced)",
    ]
    by_bot = [[f"**{b}**", *_stock_cells([p for p in ps if p.bot == b])] for b in bots]
    maps = sorted({r.map for r in rows})
    by_map = [[m, *_stock_cells([p for p in ps if p.row.map == m])] for m in maps]
    intro = (
        "Charge stock of a player = warehouses of its cities + charges in its packets on roads + "
        "charged units (sampled after every tick, definition in [README.md](README.md)). "
        "*Mean stock* is the mean over matches of the per-match mean; *mean peak* and *highest "
        "peak* are over the per-match peaks. *Burned share* = `charges_overflow` / "
        "`charges_produced` summed over all matches of the group (so a rich match weighs more "
        "than a poor one). All matches count, mirror matches included. A tournament file written "
        "before #310 has no such fields: the cells show n/a.\n\n"
    )
    return intro + _table(["bot", *header], by_bot) + "\n\n" + _table(["map", *header], by_map)


def _flow_cells(ps: Sequence[Persp]) -> list[str]:
    """Charge flow columns of a group of perspectives: means per player and match."""
    width = 15
    rows = [(p.row.flow, p.side, p.row.ticks) for p in ps if p.row.flow is not None]
    if not rows:
        return ["0", *["n/a"] * width]
    n = len(rows)

    def total(key: str) -> int:
        return sum(flow[key][side] for flow, side, _ in rows)

    def mean(key: str) -> str:
        return f"{total(key) / n:.1f}"

    produced = sum(
        p.row.charges_produced[p.side] for p in ps if p.row.flow and p.row.charges_produced
    )
    burned = sum(p.row.charges_burned[p.side] for p in ps if p.row.flow and p.row.charges_burned)
    ticks = sum(t for _, _, t in rows)

    def pct(num: int, den: int) -> str:
        return f"{num * 100 / den:.0f}%" if den else "n/a"

    tolls, with_tolls = _extra_sum([p for p in ps if p.row.flow is not None], "charges_tolls")
    return [
        str(n),
        mean("charges_start"),
        f"{produced / n:.1f}",
        f"{burned / n:.1f}",
        mean("charges_fights"),
        mean("charges_captures"),
        mean("charges_packets_lost"),
        mean("charges_warehouses_lost"),
        mean("charges_starved"),
        mean("charges_attrition"),
        mean("charges_built"),
        mean("charges_plans"),
        f"{tolls / with_tolls:.1f}" if with_tolls else "n/a",
        mean("charges_end"),
        str(total("charges_residual")),
        f"{mean('charges_sent')} / {mean('charges_delivered')}",
        pct(total("cap_full_ticks"), ticks),
    ]


def _place_cells(ps: Sequence[Persp], keys: Sequence[str]) -> list[str]:
    """Mean stock by place: the mean over matches of the mean of each match's minutes."""
    per_place: dict[str, list[int]] = {k: [] for k in keys}
    for p in ps:
        if p.row.places is None:
            continue
        for k in keys:
            known = [v for v in p.row.places[p.side].get(k, []) if v is not None]
            if known:
                per_place[k].append(sum(known) // len(known))
    n = max(len(v) for v in per_place.values())
    if n == 0:
        return ["0", *["n/a"] * len(keys)]
    return [str(n), *(f"{sum(v) / (100 * len(v)):.2f}" if v else "n/a" for v in per_place.values())]


def _section_flow(ps: Sequence[Persp], bots: Sequence[str]) -> str:
    sinks = [
        "matches",
        "start",
        "produced",
        "burned",
        "fights",
        "captures",
        "packets lost",
        "warehouses lost",
        "starved",
        "died with units",
        "built",
        "plans",
    ]
    header = [*sinks, "tolls", "end", "residual (sum, 0 = balanced)", "sent / delivered"]
    header.append("capital full")
    keys = PLACE_KEYS
    flow = [[f"**{b}**", *_flow_cells([p for p in ps if p.bot == b])] for b in bots]
    places = [[f"**{b}**", *_place_cells([p for p in ps if p.bot == b], keys)] for b in bots]
    intro = (
        "Where the charges of a player come from and go (#588, definitions in "
        "[README.md](README.md)): *start* + *produced* = *burned* + *fights* + *captures* + "
        "*packets lost* + *warehouses lost* + *starved* + *died with units* + *built* + "
        "*plans* + *tolls* + *end* (*built* and *plans*: buildings paid in charges and the bonus "
        "a planned order gathers, DEC-41; *tolls*: the charges road fortifications took, DEC-43 "
        "item D); the columns are the mean per player and match, charges. "
    )
    intro += (
        "*Capital full* is the share of all ticks. All matches count, mirror matches included; a "
        "file written before #588 shows n/a.\n\n"
    )
    stock = (
        "\n\nMean stock by place (charges, the mean over matches of the per-match mean of the "
        "minute means):\n\n"
    )
    return (
        intro + _table(["bot", *header], flow) + stock + _table(["bot", "matches", *keys], places)
    )


_OUTCOMES: Final[tuple[str, ...]] = ("won", "lost", "no winner")


def _sink_columns() -> list[tuple[str, str, bool]]:
    """``(label, row key, an EXTRA_KEYS field)`` of the sinks-by-outcome table."""
    columns = [
        ("produced", "charges_produced", False),
        ("burned", "charges_burned", False),
        ("start", "charges_start", False),
        ("fights", "charges_fights", False),
        ("captures", "charges_captures", False),
        ("packets lost", "charges_packets_lost", False),
        ("warehouses lost", "charges_warehouses_lost", False),
        ("starved", "charges_starved", False),
        ("died with units", "charges_attrition", False),
        ("built", "charges_built", False),
        ("of them lost", "charges_built_lost", True),
        ("plans", "charges_plans", False),
        ("tolls", "charges_tolls", True),
        ("end", "charges_end", False),
    ]
    return columns


def _outcome(p: Persp) -> str:
    return "no winner" if p.row.winner is None else "won" if p.won else "lost"


def _section_sinks(ps: Sequence[Persp]) -> str:
    columns = _sink_columns()
    body: list[list[str]] = []
    for outcome in _OUTCOMES:
        mine = [p for p in ps if p.row.flow is not None and _outcome(p) == outcome]
        cells = [outcome, str(len(mine))]
        for _, key, extra in columns:
            if extra:
                total, have = _extra_sum(mine, key)
            else:
                total, have = sum(_flow_side(p, key) for p in mine), len(mine)
            cells.append(f"{total / have:.1f}" if have else "n/a")
        body.append(cells)
    intro = (
        "The charge ledger split by how the match ended for the player (#690): the mean per "
        "player and match of every source and sink, over all bots and the matches with the "
        "ledger (mirror matches included). "
        + "*Of them lost*: the charges of buildings later stopped or captured "
        "(`charges_built_lost`, a part of *built*); n/a in a file written before #690. "
        "A sink that is larger for the losers than for the winners is where a lost match "
        "leaks.\n\n"
    )
    return intro + _table(["outcome", "players", *(c[0] for c in columns)], body)


def _flow_side(p: Persp, key: str) -> int:
    if key == "charges_produced":
        return 0 if p.row.charges_produced is None else p.row.charges_produced[p.side]
    if key == "charges_burned":
        return 0 if p.row.charges_burned is None else p.row.charges_burned[p.side]
    assert p.row.flow is not None
    return p.row.flow[key][p.side]


def _section_supply(ps: Sequence[Persp], bots: Sequence[str]) -> str:
    header = [
        "matches",
        "SetLeafShift per match",
        "FortifyRoad per match",
        "forts built",
        "tolls paid",
        "charges lost to tolls",
        "charges taken by own forts",
        "starved",
    ]
    body: list[list[str]] = []
    for b in bots:
        mine = [p for p in ps if p.bot == b]
        n = len(mine)
        with_usage = [p for p in mine if p.row.usage is not None]
        u = len(with_usage)

        def per(key: str, group: Sequence[Persp] = with_usage, count: int = u) -> str:
            usage = [p.row.usage[p.side].get(key, 0) for p in group if p.row.usage is not None]
            return f"{sum(usage) / count:.2f}" if count else "n/a"

        def extra(key: str, group: Sequence[Persp] = mine) -> str:
            total, have = _extra_sum(group, key)
            return f"{total / have:.2f}" if have else "n/a"

        taken = [
            p.row.extra["charges_tolls"][1 - p.side]
            for p in mine
            if p.row.extra is not None and "charges_tolls" in p.row.extra
        ]
        starved = [p.row.flow["charges_starved"][p.side] for p in mine if p.row.flow is not None]
        body.append(
            [
                f"**{b}**",
                str(n),
                per("SetLeafShift"),
                per("FortifyRoad"),
                extra("forts_built"),
                extra("tolls_paid"),
                extra("charges_tolls"),
                f"{sum(taken) / len(taken):.2f}" if taken else "n/a",
                f"{sum(starved) / len(starved):.2f}" if starved else "n/a",
            ]
        )
    intro = (
        "The levers and costs of the supply flow (DEC-43, #690), the mean per player and match: "
        "accepted `SetLeafShift` and `FortifyRoad`, the own road fortifications that started to "
        "work, the tolls the own groups paid at enemy forts (count and charges), the charges "
        "enemy groups lost at the own forts, the charges lost to starvation (a pocket without a "
        "factory, DEC-43 item H). The idle discharged units of pockets are in the CP section. "
        "All matches count, mirror matches included.\n\n"
    )
    return intro + _table(["bot", *header], body)


def _cp_cells(ps: Sequence[Persp]) -> list[str]:
    """CP and idle unit columns of a group of perspectives: means per player and match."""
    rows = [(p.row.cp, p.side, p.row.ticks) for p in ps if p.row.cp is not None]
    if not rows:
        return ["0", *["n/a"] * 6]
    n = len(rows)

    def total(key: str) -> int:
        return sum(cp[key][side] for cp, side, _ in rows)

    ticks = sum(t for _, _, t in rows)
    connected = total("idle_discharged_connected")
    pocket = total("idle_discharged_pocket")
    reached = sum(cp["cp_cap_ticks"][side] > 0 for cp, side, _ in rows)
    return [
        str(n),
        f"{total('cp_burned') / (100 * n):.2f}",
        f"{total('cp_cap_ticks') * 100 / ticks:.1f}%" if ticks else "n/a",
        f"{reached * 100 / n:.0f}%",
        f"{connected / n:.0f}",
        f"{pocket / n:.0f}",
        f"{pocket * 100 / (connected + pocket):.0f}%" if connected + pocket else "n/a",
    ]


def _section_cp(ps: Sequence[Persp], bots: Sequence[str]) -> str:
    header = [
        "matches",
        "CP burned",
        "ticks at the cap",
        "matches that reached the cap",
        "idle discharged, connected",
        "idle discharged, in pockets",
        "of them in pockets",
    ]
    body = [[f"**{b}**", *_cp_cells([p for p in ps if p.bot == b])] for b in bots]
    intro = (
        "Whether a player has more command points than it spends, and whether its discharged "
        "units wait where no charge can reach them (#743, definitions in "
        "[README.md](README.md)). *CP burned*: the mean per player and match, in CP, that the "
        "regeneration lost at the CP cap. *Ticks at the cap*: the share of all ticks that ended "
        "with the CP at the cap. *Idle discharged*: the mean unit-ticks per player and match of "
        "units without a charge standing in an own node with an empty warehouse, in no fight "
        "and with no order, in the capital's component (*connected*) or in a pocket cut off "
        "from the capital (DEC-43, item H); divide by the tick rate for unit-seconds. All "
        "matches count, mirror matches included; a file written before #743 shows n/a. Read the "
        "rule numbers on the bots that play at a human tempo: a slow or a plain bot sits at the "
        "cap by itself.\n\n"
    )
    return intro + _table(["bot", *header], body)


def _usage_cell(ps: Sequence[Persp], key: str) -> str:
    counts = [p.row.usage[p.side].get(key, 0) for p in ps if p.row.usage is not None]
    if not counts:
        return "n/a"
    used = sum(c > 0 for c in counts)
    return f"{used / len(counts):.2f} ({sum(counts) / len(counts):.1f})"


def _section_usage(ps: Sequence[Persp], bots: Sequence[str]) -> str:
    keys = USAGE_KEYS
    body = [
        [f"**{b}**", *(_usage_cell([p for p in ps if p.bot == b], k) for k in keys)] for b in bots
    ]
    intro = (
        "Accepted commands per mechanic (#166): the share of the bot's matches in which it used "
        "the mechanic at least once, and in brackets the mean count per match. `MovePlanned` is "
        "a `Move` with `planned=true`, `Move` the ordinary one. All matches count, mirror matches "
        "included; a tournament file written before #166 shows n/a.\n\n"
    )
    return intro + _table(["bot", *keys], body)


def _section_late(rows: Sequence[Row]) -> str:
    body: list[list[str]] = []
    for m in [*sorted({r.map for r in rows}), None]:
        rs = [r for r in rows if m is None or r.map == m]
        late = sum(
            1 for r in rs if any(sum(r.captures_by_minute[s][-LATE_MINUTES:]) for s in (0, 1))
        )
        caps = sum(sum(r.captures) for r in rs)
        late_caps = sum(
            sum(sum(r.captures_by_minute[s][-LATE_MINUTES:]) for s in (0, 1)) for r in rs
        )
        body.append(
            [
                m or "all maps",
                str(len(rs)),
                f"{_share(late, len(rs))} ({late}/{len(rs)})",
                f"{_share(late_caps, caps)} ({late_caps}/{caps})",
            ]
        )
    header = [
        "map",
        "matches",
        f"matches with a capture in the last {LATE_MINUTES} min",
        f"share of captures in the last {LATE_MINUTES} min",
    ]
    return (
        f"A match in which nobody takes anything in the last {LATE_MINUTES} minutes has usually "
        "frozen. A match that ended earlier is counted by its own last minutes.\n\n"
        + _table(header, body)
    )


def _section_outcomes(rows: Sequence[Row]) -> str:
    body: list[list[str]] = []
    for m in [*sorted({r.map for r in rows}), None]:
        rs = [r for r in rows if m is None or r.map == m]
        cells: dict[tuple[str, str, str], list[Row]] = defaultdict(list)
        for r in rs:
            cells[(r.map, *r.bots)].append(r)
        frozen = sum(
            1 for g in cells.values() if len(g) > 1 and len({x.state_hash for x in g}) == 1
        )
        body.append(
            [
                m or "all maps",
                str(len(rs)),
                str(len({r.state_hash for r in rs})),
                str(len({r.outcome for r in rs})),
                f"{frozen}/{len(cells)}",
            ]
        )
    return (
        '`state_hash` tells any two final states apart; an "outcome" is `(winner, reason, '
        'VP, cities)`. A "cell without variability" is a map + an ordered pair where all seeds '
        "gave the same final state (the bot does not depend on the seed).\n\n"
        + _table(
            [
                "map",
                "matches",
                "unique states",
                "unique outcomes",
                "cells without variability",
            ],
            body,
        )
    )


def _section_maps(ps: Sequence[Persp], rows: Sequence[Row], bots: Sequence[str]) -> str:
    parts: list[str] = []
    overall = [
        [
            f"**{b}**",
            *(
                _win_rate([p for p in ps if p.row.map == m and p.bot == b and p.opp != b]).fmt()
                for m in sorted({r.map for r in rows})
            ),
        ]
        for b in bots
    ]
    maps = sorted({r.map for r in rows})
    parts.append(
        "Win rate of the bot against the others by map:\n\n" + _table(["bot", *maps], overall)
    )
    for m in maps:
        sub = [p for p in ps if p.row.map == m]
        n = len([r for r in rows if r.map == m])
        parts.append(f"### {m} ({n} matches)\n\n" + _matrix(sub, bots, full=False))
    return "\n\n".join(parts)


def _section_diversity(ps: Sequence[Persp], bots: Sequence[str]) -> str:
    lines: list[str] = []
    beaten = {a: [b for b in bots if b != a and _beats(ps, a, b)[0]] for a in bots}
    sure = {a: [b for b in bots if b != a and _beats(ps, a, b)[1]] for a in bots}
    body = [
        [
            f"**{a}**",
            ", ".join(beaten[a]) or "-",
            ", ".join(sure[a]) or "-",
        ]
        for a in bots
    ]
    lines.append(
        'Whom the bot beats (more wins than the opponent in their matches); "significant" means '
        "the Wilson interval of the share among decided matches does not contain 0.5.\n\n"
        + _table(["bot", "beats", "beats significantly"], body)
        + "\n"
    )
    others = [a for a in bots if len(bots) > 1 and len(beaten[a]) == len(bots) - 1]
    sure_dom = [a for a in bots if len(sure[a]) == len(bots) - 1 and len(bots) > 1]
    rates: dict[str, Rate] = {
        a: _win_rate([p for p in ps if p.bot == a and p.opp != a]) for a in bots
    }
    ranked = sorted(bots, key=lambda a: -(rates[a].value or 0.0))
    spread = (rates[ranked[0]].value or 0.0) - (rates[ranked[-1]].value or 0.0)
    lines.append(
        f"- Dominant strategy (beats all the others): {', '.join(others) or 'none'}"
        f"; significantly: {', '.join(sure_dom) or 'none'}."
    )
    lines.append(
        f"- Best average win rate: {ranked[0]} {rates[ranked[0]].fmt()}; worst: "
        f"{ranked[-1]} {rates[ranked[-1]].fmt()}; spread {spread:.2f}."
    )
    cycles = _cycles(bots, lambda a, b: _beats(ps, a, b))
    if cycles:
        lines.append(
            f"- Rock-paper-scissors cycles (A beats B, B beats C, C beats A): {len(cycles)}; "
            f"significant on all three edges: {sum(c[1] for c in cycles)}."
        )
        lines.extend(
            f"  - {' > '.join(c[0])} > {c[0][0]}" + (" (significant)" if c[1] else "")
            for c in cycles
        )
    else:
        lines.append("- No rock-paper-scissors cycles.")
    return "\n".join(lines)


def _cycles(
    bots: Sequence[str], beats: Callable[[str, str], tuple[bool, bool]]
) -> list[tuple[tuple[str, str, str], bool]]:
    """3-cycles of the beat relation, each once (smallest name first)."""
    found: list[tuple[tuple[str, str, str], bool]] = []
    for a, b, c in combinations(bots, 3):
        for x, y, z in ((a, b, c), (a, c, b)):
            ab, bc, ca = beats(x, y), beats(y, z), beats(z, x)
            if ab[0] and bc[0] and ca[0]:
                found.append(((x, y, z), ab[1] and bc[1] and ca[1]))
    return found


def _find(bots: Sequence[str], personality: str) -> str | None:
    """The bot of a check: the plain name of BOT-03, else the smart one at ``hard``."""
    for name in (personality, f"smart_{personality}@hard", f"smart_{personality}"):
        if name in bots:
            return name
    return None


def _section_checks(ps: Sequence[Persp], bots: Sequence[str]) -> str:
    lines: list[str] = []
    strangler, expander = _find(bots, _STRANGLER), _find(bots, _EXPANDER)
    reactive, rusher, turtle = (_find(bots, x) for x in (_REACTIVE, _RUSHER, _TURTLE))

    if strangler and expander:
        mine = _pair_ps(ps, strangler, expander)
        rate = Rate(sum(p.row.sieges_won[p.side] >= 1 for p in mine), len(mine))
        ok = (rate.value or 0.0) >= STRANGLER_MIN_RATE
        lines.append(
            f"- {_mark(ok)} `{strangler}` takes at least one city by siege in a match against "
            f"`{expander}` in {rate.fmt()} of matches "
            f"(threshold {STRANGLER_MIN_RATE:.0%}, n={rate.n})."
        )
    else:
        lines.append("- [no data] check of `strangler` against `expander`: these bots are missing.")

    if reactive and expander and rusher:
        r_rate = _win_rate(_pair_ps(ps, reactive, rusher))
        e_rate = _win_rate(_pair_ps(ps, expander, rusher))
        ok = (r_rate.value or 0.0) > (e_rate.value or 0.0)
        apart = r_rate.ci[0] > e_rate.ci[1] or e_rate.ci[0] > r_rate.ci[1]
        lines.append(
            f"- {_mark(ok)} `{reactive}` beats `{rusher}` more often than `{expander}` does: "
            f"{r_rate.fmt()} against {e_rate.fmt()}"
            + ("; the intervals do not overlap." if apart else "; the intervals overlap.")
        )
    else:
        lines.append("- [no data] check of `reactive` and `expander` against `rusher`.")

    if turtle:
        versus = [p for p in ps if p.bot == turtle and p.opp != turtle]
        rate = _win_rate(versus)
        draws = sum(p.row.winner is None for p in versus)
        lines.append(
            f"- Win rate of `{turtle}` against the others: {rate.fmt()}, "
            f"draws {_share(draws, len(versus))}"
            f" (n={rate.n})."
        )
        lines.append(
            "  - by opponent: "
            + ", ".join(
                f"{b} {_win_rate(_pair_ps(ps, turtle, b)).short()}" for b in bots if b != turtle
            )
            + "."
        )
    expert = dict(validity.SERVER_LEVELS)["expert"]
    rivals = [b for b in bots if validity.split_level(b)[0] == validity.EXPLOITER]
    if expert in bots and rivals:
        rate = _win_rate([p for p in ps if p.bot == expert and p.opp in rivals])
        ok = (rate.value or 0.0) >= validity.EXPLOITER_MIN
        lines.append(
            f"- {_mark(ok)} `expert` (`{expert}`) scores at least "
            f"{validity.EXPLOITER_MIN:.2f} against `{validity.EXPLOITER}` (#688): {rate.fmt()}."
        )
    else:
        lines.append(
            f"- [no data] the exploiter gate (#688): `{expert}` against `{validity.EXPLOITER}` "
            "is not in the file."
        )
    return "\n".join(lines)


def _mark(ok: bool) -> str:
    return "[done]" if ok else "[NOT done]"


def _section_validity(checks: Sequence[validity.Check]) -> str:
    counts = Counter(c.status for c in checks)
    intro = (
        "Whether the bot data of this file can carry a decision about the rules (#690; the "
        "checks V1..V9 of the data-quality notes of 2026-11-05, plus D1 and D2). **Every "
        "threshold is a proposal, not an owner decision**: a FAIL says what this file cannot "
        "answer, not that the rules are wrong. NO DATA: the bots the check needs are not in the "
        "file; NOT COMPUTABLE: the check needs a second run or human replays. A verdict about a "
        "rule number names the field and the checks it passes. Definitions: "
        '[README.md](README.md), section "Data validity".\n\n'
    )
    summary = ", ".join(
        f"{status} {counts[status]}"
        for status in (validity.PASS, validity.FAIL, validity.NO_DATA, validity.NOT_COMPUTABLE)
        if counts[status]
    )
    table = _table(
        ["id", "check", "threshold (proposal)", "measured", "result"],
        [[c.id, c.name, c.threshold, c.measured, f"**{c.status}**"] for c in checks],
    )
    return intro + table + f"\n\nSummary: {summary}."


def _section_ladder(tally: validity.Tally, steps: Sequence[validity.Step]) -> str:
    if not steps:
        return "No personality has two levels in the file, and no two server levels: no ladder."
    body: list[list[str]] = []
    for s in steps:
        cell = Rate(s.wins, s.decided).fmt()
        body.append([s.group, f"`{s.higher}` over `{s.lower}`", str(s.decided), cell, s.verdict])
    levels = [lv for lv in validity.LEVELS]
    personalities = sorted({s.group for s in steps if s.group != "server levels"})
    tempo: list[list[str]] = []
    for base in personalities:
        cells = [base]
        for lv in levels:
            bot = next((b for b in tally.bots if validity.split_level(b) == (base, lv)), None)
            per = None if bot is None else tally.commands(bot)
            cells.append("n/a" if per is None else f"{per:.1f}")
        tempo.append(cells)
    return (
        "Head to head of the levels of every personality (`@easy` < `@normal` < `@hard`; a name "
        "without a level is `hard`) and of the adjacent server levels (easy < normal < hard < "
        "expert, `gow_server.levelbots.LEVEL_BOTS`): the share of the higher level among the "
        "decided matches of the pair, both sides, all maps, with the 95% Wilson interval. "
        "*separated*: the interval excludes 0.5; *not separated*: it contains 0.5; *INVERTED*: "
        "the lower level is significantly stronger.\n\n"
        + _table(["ladder", "pair", "decided", "higher level's share [95%]", "verdict"], body)
        + "\n\nAccepted commands per match by level (all matches of the bot): a level that "
        "gives about as many commands as another does not bind the tempo.\n\n"
        + _table(["personality", *levels], tempo)
    )


def _section_exploiter(ps: Sequence[Persp], bots: Sequence[str]) -> str:
    rivals = [b for b in bots if validity.split_level(b)[0] == validity.EXPLOITER]
    levels = [(lv, b) for lv, b in validity.SERVER_LEVELS if b in bots]
    if not rivals or not levels:
        return (
            f"No server level and `{validity.EXPLOITER}` pair in the file (the check V6 needs "
            "both)."
        )
    gate: dict[str, float] = dict(validity.EXPLOITER_GATE)
    body: list[list[str]] = []
    for level, bot in levels:
        mine = [p for p in ps if p.bot == bot and p.opp in rivals]
        wins = sum(p.won for p in mine)
        draws = sum(p.row.winner is None for p in mine)
        lost = len(mine) - wins - draws
        capital = sum(
            not p.won and p.row.winner is not None and p.row.reason == "capital" for p in mine
        )
        taken = sum(p.won and p.row.reason == "capital" for p in mine)
        body.append(
            [
                level,
                f"`{bot}`",
                str(len(mine)),
                f"{wins} / {lost} / {draws}",
                Rate(wins, wins + lost).fmt(),
                f"{gate[level]:.2f}",
                _share(capital, len(mine)),
                _share(taken, len(mine)),
            ]
        )
    return (
        f"Every server level (`gow_server.levelbots.LEVEL_BOTS`) head to head against "
        f"`{', '.join(rivals)}`, both sides, all maps: the level's share of the decided matches "
        "with the 95% Wilson interval, the least share the check V6 asks (a proposal, not an "
        "owner decision), and the share of all matches the level lost and won by the capital.\n\n"
        + _table(
            [
                "level",
                "bot",
                "matches",
                "won / lost / drawn",
                "share [95%]",
                "V6 at least",
                "capital lost",
                "capital taken",
            ],
            body,
        )
    )


def _section_strength(tally: validity.Tally) -> str:
    fit = validity.bradley_terry(tally)
    if fit is None:
        return "No decided matches: no model."
    bots, maps = fit
    rates = {b: tally.field_rate(b) for b in tally.bots}
    ranked = sorted(bots, key=lambda s: (-s.value, s.name))
    body = [
        [
            f"**{s.name}**",
            f"{s.value:+.2f} [{s.low:+.2f}; {s.high:+.2f}]",
            f"{_sigmoid(s.value):.2f}",
            "n/a" if rates[s.name] is None else f"{rates[s.name]:.2f}",
        ]
        for s in ranked
    ]
    side = [
        [
            m.name,
            f"{m.value:+.2f} [{m.low:+.2f}; {m.high:+.2f}]",
            f"{_sigmoid(m.value):.2f} [{_sigmoid(m.low):.2f}; {_sigmoid(m.high):.2f}]",
        ]
        for m in maps
    ]
    return (
        "A Bradley-Terry model of all decided matches: `P(side 0 wins) = sigmoid(s[bot0] - "
        "s[bot1] + h[map])` (#690). `s` is the strength of a bot in log-odds with `sum(s) = 0`, "
        "`h` the advantage of side 0 on a map; the model separates a bot's strength from the "
        "side and the map, which the raw win rate mixes. The 95% intervals are percentiles of "
        f"{validity.BOOTSTRAP} refits on the seeds drawn with replacement; a ridge of "
        f"{validity.RIDGE} on every parameter keeps a bot that never lost finite. *Against an "
        "average bot*: `sigmoid(s)`, the expected share against a bot of strength 0. A model "
        "of strength alone misses the counters (see the style matrix).\n\n"
        + _table(["bot", "strength s [95%]", "against an average bot", "win rate vs field"], body)
        + "\n\nSide 0 advantage by map (with equal bots):\n\n"
        + _table(["map", "h [95%]", "P(side 0 wins) [95%]"], side)
    )


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def _section_style(tally: validity.Tally) -> str:
    if len(tally.bots) < 2:
        return "One bot: no style matrix."
    a = validity.style_matrix(tally)
    r, share = validity.transitive_split(a)
    mix, gap = validity.nash(a)
    order = sorted(range(len(tally.bots)), key=lambda i: (-mix[i], tally.bots[i]))
    body = [
        [f"**{tally.bots[i]}**", f"{mix[i]:.2f}", f"{r[i]:+.3f}"] for i in order if mix[i] >= 0.005
    ]
    out = [i for i in order if mix[i] < 0.005]
    return (
        "The style matrix `A[i][j]` = (wins + half the draws) / matches of i against j, minus "
        "0.5 (both sides, all maps). The *transitive part* is a single strength per bot (the row "
        "mean `r`), the *cyclic part* what is left (counters, rock-paper-scissors). The *Nash "
        "mix* is the equilibrium of the zero-sum game `A`: a mix of bots that no single bot of "
        "the field beats; a bot outside it is not needed against this field. Definitions: "
        '[README.md](README.md), section "Data validity".\n\n'
        f"- Intransitive share: {'n/a' if share is None else f'{share:.2f}'} (0: one ladder "
        "explains every pair, 1: pure cycles).\n"
        f"- Nash mix ({validity.NASH_ROUNDS} rounds of multiplicative weights; gap {gap:.3f}, the "
        "best pure answer to the mix, 0 at an exact equilibrium):\n\n"
        + _table(["bot", "weight", "transitive strength r"], body)
        + (
            "\n\nOutside the mix (weight below 0.005): "
            + ", ".join(tally.bots[i] for i in out)
            + "."
            if out
            else ""
        )
    )


def _section_seeds(tally: validity.Tally) -> str:
    seeds, maps, bots = len(tally.seeds), len(tally.maps), len(tally.bots)
    pairs = [w + lo + d for (x, y), (w, lo, d) in tally.pair.items() if x < y]
    pair_n = int(median(pairs)) if pairs else 0
    field_n = int(median(wl.n for wl in tally.field.values())) if tally.field else 0
    ordered = pair_n // 2 // max(1, maps)
    rows = [
        ["one ordered pair on one map", str(ordered), f"{validity.half_width(ordered):.2f}"],
        ["one pair, both sides, all maps", str(pair_n), f"{validity.half_width(pair_n):.2f}"],
        ["one bot against the field", str(field_n), f"{validity.half_width(field_n):.2f}"],
    ]
    need = math.ceil((validity.Z / (2 * validity.PAIR_HALF_WIDTH_MAX)) ** 2)
    return (
        f"This file: {seeds} seeds x {maps} maps x {bots} bots. The 95% half-width of a share "
        "near 0.5 is about `1.96 * sqrt(0.25 / n)`; the table gives the median `n` of each kind "
        "of claim in this file (the general table is in [README.md](README.md), section "
        f'"Seeds"). A claim about one pair at +-{validity.PAIR_HALF_WIDTH_MAX:.2f} needs '
        f"{need} matches of the pair.\n\n" + _table(["claim", "matches n", "half-width"], rows)
    )


def render_report(rows: Sequence[Row], source: str, prefix: str) -> str:
    """The Markdown text; charts are referenced as ``<prefix>-<chart>.png`` next to it."""
    ps = _persps(rows)
    bots = _bots_of(rows)
    tally = validity.Tally(rows)
    steps = validity.ladder(tally)
    sections: list[tuple[str, str]] = [
        ("Overview", _section_overview(rows)),
        ("Data validity", _section_validity(validity.checks(tally, steps))),
        ("Bot competence checks", _section_checks(ps, bots)),
        ("Level ladder", _section_ladder(tally, steps)),
        ("Against the exploiter (#688)", _section_exploiter(ps, bots)),
        ("Strength model (Bradley-Terry)", _section_strength(tally)),
        ("Strategy pair matrix", _section_pairs(ps, bots)),
        ("Style matrix and Nash mix", _section_style(tally)),
        ("Side advantage", _section_sides(rows)),
        ("Metrics by bot", _section_bots(ps, bots)),
        ("Charge stock and burned share (#310)", _section_stock(ps, rows, bots)),
        ("Charge flow (#588)", _section_flow(ps, bots)),
        ("Charge sinks by outcome (#690)", _section_sinks(ps)),
        ("Supply flow (DEC-43)", _section_supply(ps, bots)),
        ("CP and idle units (#743)", _section_cp(ps, bots)),
        ("Mechanic usage (#166)", _section_usage(ps, bots)),
        ("Strategy diversity", _section_diversity(ps, bots)),
        ("Captures at the end of the match", _section_late(rows)),
        ("Unique outcomes", _section_outcomes(rows)),
        ("Breakdown by map", _section_maps(ps, rows, bots)),
        ("Seeds", _section_seeds(tally)),
    ]
    head = (
        f"# Balance report: `{source}`\n\n"
        "Generated by `uv run gow-bots report` (BOT-05, #38); input format: "
        "[README.md](README.md). Do not edit by hand.\n"
    )
    body = "\n\n".join(f"## {title}\n\n{text}" for title, text in sections)
    return (head + "\n" + body + "\n").replace("PREFIX", prefix)


# --- charts ----------------------------------------------------------------------------------

_COLOURS: Final = ("#2f6fdf", "#d9453b", "#3a9d5d", "#e0a526", "#7a4fb5", "#17a2b8", "#8c6d46")


def _save(fig: Any, path: Path) -> None:
    fig.savefig(path, dpi=100, metadata={"Software": None})


def _draw_charts(
    ps: Sequence[Persp], rows: Sequence[Row], bots: Sequence[str], out: Path, prefix: str
) -> list[Path]:
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from matplotlib.figure import Figure

    paths: list[Path] = []
    maps = sorted({r.map for r in rows})

    # 1. pair matrix heat map
    n = len(bots)
    fig = Figure(figsize=(1.1 * n + 2.5, 1.0 * n + 1.8), dpi=100)
    FigureCanvasAgg(fig)
    ax = fig.add_subplot()
    grid = [
        [float("nan") if a == b else (_win_rate(_pair_ps(ps, a, b)).value or 0.0) for b in bots]
        for a in bots
    ]
    image = ax.imshow(grid, vmin=0.0, vmax=1.0, cmap="RdBu")
    for i, a in enumerate(bots):
        for j, b in enumerate(bots):
            if a != b:
                rate = _win_rate(_pair_ps(ps, a, b))
                lo, hi = rate.ci
                dark = abs((rate.value or 0.0) - 0.5) > 0.35  # white text on the dark ends
                ax.text(
                    j,
                    i,
                    f"{rate.short()}\n{lo:.2f}-{hi:.2f}",
                    ha="center",
                    va="center",
                    fontsize=8,
                    color="white" if dark else "black",
                )
    ax.set_xticks(range(n), labels=bots, rotation=30, ha="right")
    ax.set_yticks(range(n), labels=bots)
    ax.set_title("win rate of row against column (95% Wilson)")
    fig.colorbar(image, ax=ax, fraction=0.046)
    fig.tight_layout()
    paths.append(out / f"{prefix}-pairs.png")
    _save(fig, paths[-1])

    # 2. win rate of every bot per map, with intervals
    fig = Figure(figsize=(max(6.0, 1.6 * n + 2), 4.2), dpi=100)
    FigureCanvasAgg(fig)
    ax = fig.add_subplot()
    width = 0.8 / max(1, len(maps))
    for k, m in enumerate(maps):
        rates = [
            _win_rate([p for p in ps if p.row.map == m and p.bot == b and p.opp != b]) for b in bots
        ]
        xs = [i + (k - (len(maps) - 1) / 2) * width for i in range(n)]
        vals = [r.value or 0.0 for r in rates]
        err = [
            [v - r.ci[0] for v, r in zip(vals, rates, strict=True)],
            [r.ci[1] - v for v, r in zip(vals, rates, strict=True)],
        ]
        ax.bar(xs, vals, width, yerr=err, capsize=2, label=m, color=_COLOURS[k % len(_COLOURS)])
    ax.axhline(0.5, color="#555555", linewidth=0.8, linestyle="--")
    ax.set_xticks(range(n), labels=bots)
    ax.set_ylim(0, 1)
    ax.set_ylabel("win rate against the others")
    ax.set_title("win rate of bots by map (95% Wilson)")
    ax.legend()
    fig.tight_layout()
    paths.append(out / f"{prefix}-bots.png")
    _save(fig, paths[-1])

    # 3. side advantage: share of side 0 among decisive matches, mirror and all
    labels = [*maps, "all"]
    fig = Figure(figsize=(max(5.0, 1.8 * len(labels) + 1), 4.0), dpi=100)
    FigureCanvasAgg(fig)
    ax = fig.add_subplot()
    for k, (title, mirror_only) in enumerate((("mirror matches", True), ("all matches", False))):
        rates: list[Rate] = []
        for m in [*maps, None]:
            decided = [
                r
                for r in rows
                if r.winner is not None
                and (m is None or r.map == m)
                and (not mirror_only or r.bots[0] == r.bots[1])
            ]
            rates.append(Rate(sum(r.winner == 0 for r in decided), len(decided)))
        vals = [r.value or 0.0 for r in rates]
        xs = [i + (k - 0.5) * 0.38 for i in range(len(labels))]
        err = [
            [v - r.ci[0] for v, r in zip(vals, rates, strict=True)],
            [r.ci[1] - v for v, r in zip(vals, rates, strict=True)],
        ]
        ax.bar(xs, vals, 0.38, yerr=err, capsize=3, label=title, color=_COLOURS[k])
    ax.axhline(0.5, color="#555555", linewidth=0.8, linestyle="--")
    ax.set_xticks(range(len(labels)), labels=labels)
    ax.set_ylim(0, 1)
    ax.set_ylabel("share of wins of side 0 among decided")
    ax.set_title("side advantage (95% Wilson)")
    ax.legend()
    fig.tight_layout()
    paths.append(out / f"{prefix}-sides.png")
    _save(fig, paths[-1])
    return paths


def write_report(source: str | Path, out_dir: str | Path, name: str | None = None) -> list[Path]:
    """Read ``source`` and write ``<name>.md`` and the charts into ``out_dir``.

    ``name`` defaults to the stem of ``source``. Returns the files written, Markdown first.
    """
    rows = load_rows(source)
    folder = Path(out_dir)
    folder.mkdir(parents=True, exist_ok=True)
    prefix = name or Path(source).stem
    text = render_report(rows, Path(source).name, prefix)
    markdown = folder / f"{prefix}.md"
    markdown.write_text(text, encoding="utf-8")
    charts = _draw_charts(_persps(rows), rows, _bots_of(rows), folder, prefix)
    return [markdown, *charts]
