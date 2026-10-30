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
from typing import Any, Final

from gow_bots.tournament import SCHEMA_VERSION, USAGE_KEYS

__all__ = [
    "REPORT_Z",
    "Row",
    "load_rows",
    "render_report",
    "wilson",
    "write_report",
]

REPORT_Z: Final = 1.96
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


def wilson(successes: int, total: int, z: float = REPORT_Z) -> tuple[float, float]:
    """Wilson score interval of a binomial proportion; ``(0.0, 1.0)`` when ``total`` is 0."""
    if total <= 0:
        return (0.0, 1.0)
    p = successes / total
    z2 = z * z
    denom = 1 + z2 / total
    centre = (p + z2 / (2 * total)) / denom
    half = z * math.sqrt(p * (1 - p) / total + z2 / (4 * total * total)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


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
    """Integer charge ledger and bottleneck fields by side (#588), keyed as in the row
    (``charges_start``, ``marker_ticks``, ...); ``None`` in a file written before they existed."""
    places: tuple[dict[str, list[int | None]], dict[str, list[int | None]]] | None = None
    """``stock_by_place_minute`` by side (#588)."""
    siege_orders: tuple[int, int] | None = None
    """Attack orders into a node with an enemy garrison (#590); ``None`` in an older file."""
    planned_siege_orders: tuple[int, int] | None = None

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
    "charges_delivered_front",
    "charges_transfers",
    "marker_ticks",
    "front_empty_ticks",
    "front_empty_cap_has_ticks",
    "cap_full_ticks",
)
"""The integer per-side fields of the charge flow (#588) that the report reads."""
PLACE_KEYS: Final[tuple[str, ...]] = (
    "cap_wh",
    "front_wh",
    "rear_wh",
    "units_node",
    "units_road",
    "packets",
)
"""The places of ``stock_by_place_minute``; the same as ``gow_sim.analysis.PLACES``."""


def _flow(raw: dict[str, Any]) -> dict[str, tuple[int, int]] | None:
    if any(k not in raw for k in FLOW_KEYS):
        return None
    return {k: _pair(raw, k) for k in FLOW_KEYS}


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
    )


def load_rows(path: str | Path) -> list[Row]:
    """Read a tournament JSONL; ``ValueError`` on a bad line, a foreign schema or no rows."""
    rows: list[Row] = []
    with open(path, encoding="ascii") as handle:
        for number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                raw = json.loads(line)
                if raw["schema"] != SCHEMA_VERSION:
                    raise ValueError(f"schema {raw['schema']}, this report reads {SCHEMA_VERSION}")
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
    lines = [
        f"- Matches: {len(rows)}; maps: {', '.join(maps)}; bots: {', '.join(_bots_of(rows))}.",
        f"- Seeds: {seeds[0]}..{seeds[-1]} ({len(seeds)}).",
        f"- Ruleset `{_one(r.ruleset_hash for r in rows)}`, `SIM_VERSION` "
        f"{_one(str(r.sim_version) for r in rows)}.",
        f"- No winner (a draw or not finished): {draws} ({_share(draws, len(rows))}).",
        "- End reasons: " + ", ".join(f"`{k}` {v}" for k, v in sorted(reasons.items())) + ".",
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
        "captures per match",
        f"share of captures in the last {LATE_MINUTES} min",
    ]
    return (
        "Win rate is counted against other bots (no mirror matches); the other metrics over "
        'all matches of the bot. The "share of scheduled attacks" (the BAL-02 gate, #590) counts '
        "the `Move` orders into a node with an enemy garrison at the moment of the order: the "
        "scheduled ones (`planned=true`) over all of them (n/a in a file written before #590); "
        '"scheduled of all attacks" is the BAL-01 definition, every `Move` to an enemy or neutral '
        'node. "Siege success" is captures of enemy nodes / siege attempts.'
        "\n\n" + _table(header, body) + "\n\n![bots by map](PREFIX-bots.png)"
    )


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
    rows = [(p.row.flow, p.side, p.row.ticks) for p in ps if p.row.flow is not None]
    if not rows:
        return ["0", *["n/a"] * 15]
    n = len(rows)

    def total(key: str) -> int:
        return sum(flow[key][side] for flow, side, _ in rows)

    def mean(key: str) -> str:
        return f"{total(key) / n:.1f}"

    produced = sum(
        p.row.charges_produced[p.side] for p in ps if p.row.flow and p.row.charges_produced
    )
    burned = sum(p.row.charges_burned[p.side] for p in ps if p.row.flow and p.row.charges_burned)
    markers = total("marker_ticks")
    ticks = sum(t for _, _, t in rows)

    def pct(num: int, den: int) -> str:
        return f"{num * 100 / den:.0f}%" if den else "n/a"

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
        mean("charges_end"),
        str(total("charges_residual")),
        f"{mean('charges_sent')} / {mean('charges_delivered')} / {mean('charges_delivered_front')}",
        pct(total("front_empty_ticks"), markers),
        pct(total("front_empty_cap_has_ticks"), markers),
        pct(total("cap_full_ticks"), ticks),
    ]


def _place_cells(ps: Sequence[Persp]) -> list[str]:
    """Mean stock by place: the mean over matches of the mean of each match's minutes."""
    per_place: dict[str, list[int]] = {k: [] for k in PLACE_KEYS}
    for p in ps:
        if p.row.places is None:
            continue
        for k in PLACE_KEYS:
            known = [v for v in p.row.places[p.side][k] if v is not None]
            if known:
                per_place[k].append(sum(known) // len(known))
    n = max(len(v) for v in per_place.values())
    if n == 0:
        return ["0", *["n/a"] * len(PLACE_KEYS)]
    return [str(n), *(f"{sum(v) / (100 * len(v)):.2f}" if v else "n/a" for v in per_place.values())]


def _section_flow(ps: Sequence[Persp], bots: Sequence[str]) -> str:
    header = [
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
        "end",
        "residual (sum, 0 = balanced)",
        "sent / delivered / to markers",
        "marker city empty",
        "and capital has charges",
        "capital full",
    ]
    flow = [[f"**{b}**", *_flow_cells([p for p in ps if p.bot == b])] for b in bots]
    places = [[f"**{b}**", *_place_cells([p for p in ps if p.bot == b])] for b in bots]
    intro = (
        "Where the charges of a player come from and go (#588, definitions in "
        "[README.md](README.md)): *start* + *produced* = *burned* + *fights* + *captures* + "
        "*packets lost* + *warehouses lost* + *starved* + *died with units* + *end*; the "
        "columns are the mean per player and match, charges. *Marker city empty* is the share "
        "of the ticks with a front marker outside the capital in which such a warehouse is empty, "
        "*and capital has charges* the part of those ticks in which the capital is not empty "
        "(a supply bottleneck, not a lack of charges); *capital full* is the share of all ticks. "
        "All matches count, mirror matches included; a file written before #588 shows n/a.\n\n"
    )
    stock = (
        "\n\nMean stock by place (charges, the mean over matches of the per-match mean of the "
        "minute means):\n\n"
    )
    return (
        intro
        + _table(["bot", *header], flow)
        + stock
        + _table(["bot", "matches", *PLACE_KEYS], places)
    )


def _usage_cell(ps: Sequence[Persp], key: str) -> str:
    counts = [p.row.usage[p.side].get(key, 0) for p in ps if p.row.usage is not None]
    if not counts:
        return "n/a"
    used = sum(c > 0 for c in counts)
    return f"{used / len(counts):.2f} ({sum(counts) / len(counts):.1f})"


def _section_usage(ps: Sequence[Persp], bots: Sequence[str]) -> str:
    body = [
        [f"**{b}**", *(_usage_cell([p for p in ps if p.bot == b], k) for k in USAGE_KEYS)]
        for b in bots
    ]
    intro = (
        "Accepted commands per mechanic (#166): the share of the bot's matches in which it used "
        "the mechanic at least once, and in brackets the mean count per match. `MovePlanned` is "
        "a `Move` with `planned=true`, `Move` the ordinary one. All matches count, mirror matches "
        "included; a tournament file written before #166 shows n/a.\n\n"
    )
    return intro + _table(["bot", *USAGE_KEYS], body)


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


def _section_checks(ps: Sequence[Persp], bots: Sequence[str]) -> str:
    have = set(bots)
    lines: list[str] = []

    if {_STRANGLER, _EXPANDER} <= have:
        mine = _pair_ps(ps, _STRANGLER, _EXPANDER)
        rate = Rate(sum(p.row.sieges_won[p.side] >= 1 for p in mine), len(mine))
        ok = (rate.value or 0.0) >= STRANGLER_MIN_RATE
        lines.append(
            f"- {_mark(ok)} `strangler` takes at least one city by siege in a match against "
            f"`expander` in {rate.fmt()} of matches "
            f"(threshold {STRANGLER_MIN_RATE:.0%}, n={rate.n})."
        )
    else:
        lines.append("- [no data] check of `strangler` against `expander`: these bots are missing.")

    if {_REACTIVE, _EXPANDER, _RUSHER} <= have:
        reactive = _win_rate(_pair_ps(ps, _REACTIVE, _RUSHER))
        expander = _win_rate(_pair_ps(ps, _EXPANDER, _RUSHER))
        ok = (reactive.value or 0.0) > (expander.value or 0.0)
        apart = reactive.ci[0] > expander.ci[1] or expander.ci[0] > reactive.ci[1]
        lines.append(
            f"- {_mark(ok)} `reactive` beats `rusher` more often than `expander` does: "
            f"{reactive.fmt()} against {expander.fmt()}"
            + ("; the intervals do not overlap." if apart else "; the intervals overlap.")
        )
    else:
        lines.append("- [no data] check of `reactive` and `expander` against `rusher`.")

    if _TURTLE in have:
        versus = [p for p in ps if p.bot == _TURTLE and p.opp != _TURTLE]
        rate = _win_rate(versus)
        draws = sum(p.row.winner is None for p in versus)
        lines.append(
            f"- Win rate of `turtle` against the others: {rate.fmt()}, "
            f"draws {_share(draws, len(versus))}"
            f" (n={rate.n})."
        )
        lines.append(
            "  - by opponent: "
            + ", ".join(
                f"{b} {_win_rate(_pair_ps(ps, _TURTLE, b)).short()}" for b in bots if b != _TURTLE
            )
            + "."
        )
    return "\n".join(lines)


def _mark(ok: bool) -> str:
    return "[done]" if ok else "[NOT done]"


def render_report(rows: Sequence[Row], source: str, prefix: str) -> str:
    """The Markdown text; charts are referenced as ``<prefix>-<chart>.png`` next to it."""
    ps = _persps(rows)
    bots = _bots_of(rows)
    sections: list[tuple[str, str]] = [
        ("Overview", _section_overview(rows)),
        ("Bot competence checks", _section_checks(ps, bots)),
        ("Strategy pair matrix", _section_pairs(ps, bots)),
        ("Side advantage", _section_sides(rows)),
        ("Metrics by bot", _section_bots(ps, bots)),
        ("Charge stock and burned share (#310)", _section_stock(ps, rows, bots)),
        ("Charge flow (#588)", _section_flow(ps, bots)),
        ("Mechanic usage (#166)", _section_usage(ps, bots)),
        ("Strategy diversity", _section_diversity(ps, bots)),
        ("Captures at the end of the match", _section_late(rows)),
        ("Unique outcomes", _section_outcomes(rows)),
        ("Breakdown by map", _section_maps(ps, rows, bots)),
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
