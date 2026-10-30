"""``gow-bots stats``: the statistics of a match as a table for a human (#375).

One block per replay, one column per player; the numbers are ``gow_sim.analysis.PlayerStats``
(definitions: its module docstring and ``docs/balance/README.md``). CP are shown in whole CP with
two decimals (the journal counts hundredths).
"""

from collections.abc import Callable, Sequence

from gow_sim.analysis import CP_CATEGORIES, MatchMetrics, MatchStats, PlayerStats

__all__ = ["render_stats"]

_STANCE_SHORT = 4
"""Longest stance timeline printed in full; more changes show the first ones and a count."""
_TICKS_SHORT = 4
"""Ticks of one kind of action printed in the table."""


def _cp(hundredths: int) -> str:
    sign = "-" if hundredths < 0 else ""
    whole, frac = divmod(abs(hundredths), 100)
    return f"{sign}{whole}.{frac:02d}"


def _share(value: float | None) -> str:
    return "-" if value is None else f"{value * 100:.1f}%"


def _ticks(ticks: Sequence[int]) -> str:
    """The number of actions and the first ticks (all of them are in the JSONL of ``analyze``)."""
    if not ticks:
        return "0"
    shown = ", ".join(str(t) for t in ticks[:_TICKS_SHORT])
    return f"{len(ticks)} (t={shown}{', ...' if len(ticks) > _TICKS_SHORT else ''})"


def _timeline(p: PlayerStats) -> str:
    line = [f"{t}:{s}" for t, s in p.stance_timeline]
    if len(line) > _STANCE_SHORT:
        line = [*line[:_STANCE_SHORT], f"... ({len(p.stance_timeline) - 1} changes)"]
    return " ".join(line)


_Row = tuple[str, Callable[[PlayerStats], str]]


def _stance_row(stance: str) -> _Row:
    return f"ticks in {stance}", lambda p: str(dict(p.stance_ticks)[stance])


def _cp_row(category: str) -> _Row:
    return f"CP {category}", lambda p: _cp(dict(p.cp_by_category)[category])


def _rows(stats: MatchStats) -> list[_Row]:
    return [
        ("stance (tick:stance)", _timeline),
        *(_stance_row(s) for s, _ in stats.players[0].stance_ticks),
        ("commands (rejected)", lambda p: f"{p.commands} ({p.rejected})"),
        ("APM avg", lambda p: "-" if p.apm_avg is None else f"{p.apm_avg:.2f}"),
        ("APM peak (a minute)", lambda p: str(p.apm_peak)),
        ("APM by minute", lambda p: " ".join(str(n) for n in p.apm_by_minute)),
        ("SetFront", lambda p: _ticks(p.front_ticks)),
        ("SetRearMin", lambda p: _ticks(p.rear_min_ticks)),
        ("Transfer (charges)", lambda p: f"{len(p.transfer_ticks)} ({p.transfer_charges})"),
        ("orders (planned)", lambda p: f"{p.orders} ({p.planned_orders})"),
        ("planned share", lambda p: _share(p.planned_share)),
        ("planned attack share", lambda p: _share(p.planned_attack_share)),
        *(_cp_row(c) for c in CP_CATEGORIES),
        ("CP refunded (in recruit)", lambda p: _cp(p.cp_refunded)),
        ("CP total", lambda p: _cp(p.cp_total)),
    ]


def _permille(value: int | None) -> str:
    return "-" if value is None else f"{value / 10:.1f}%"


def _sent_cell(m: MatchMetrics, i: int) -> str:
    f = m.flow[i]
    return f"{f.sent} / {f.delivered} / {f.delivered_front}"


def _places_cell(m: MatchMetrics, i: int) -> str:
    """Mean stock by place over the whole match: the mean of the minutes that have samples."""
    parts: list[str] = []
    for name, minutes in m.flow[i].stock_by_place_minute:
        known = [v for v in minutes if v is not None]
        parts.append(f"{name} {_cp(sum(known) // len(known)) if known else '-'}")
    return ", ".join(parts)


_FlowRow = tuple[str, Callable[[MatchMetrics, int], str]]

_CHARGE_ROWS: tuple[_FlowRow, ...] = (
    ("charges start", lambda m, i: str(m.flow[i].start)),
    ("charges produced", lambda m, i: str(m.charges_produced[i])),
    ("charges burned (overflow)", lambda m, i: str(m.charges_burned[i])),
    ("charges spent in fights", lambda m, i: str(m.flow[i].fights)),
    ("charges spent on captures", lambda m, i: str(m.flow[i].captures)),
    ("charges lost in packets", lambda m, i: str(m.flow[i].packets_lost)),
    ("charges lost with warehouses", lambda m, i: str(m.flow[i].warehouses_lost)),
    ("charges starved", lambda m, i: str(m.flow[i].starved)),
    ("charges died with units", lambda m, i: str(m.flow[i].attrition)),
    ("charges at the end", lambda m, i: str(m.flow[i].end)),
    ("ledger residual (0 = balanced)", lambda m, i: str(m.flow[i].residual)),
    ("sent / delivered / to markers", _sent_cell),
    ("marker city empty", lambda m, i: _permille(m.flow[i].front_empty_permille)),
    ("  and capital has charges", lambda m, i: _permille(m.flow[i].front_empty_cap_has_permille)),
    ("capital full (ticks)", lambda m, i: str(m.flow[i].cap_full_ticks)),
    ("mean stock by place", _places_cell),
)


def render_stats(name: str, metrics: MatchMetrics, stats: MatchStats) -> str:
    """The table of one match: a title line and one row per statistic, a column per player."""
    winner = "draw/none" if metrics.winner is None else f"player {metrics.winner}"
    lines = [
        f"{name}: {metrics.ticks} ticks ({metrics.duration_s:g} s), "
        f"winner {winner} ({metrics.reason})"
    ]
    rows = [(label, [fmt(p) for p in stats.players]) for label, fmt in _rows(stats)]
    rows += [
        (label, [fmt(metrics, i) for i in range(len(stats.players))]) for label, fmt in _CHARGE_ROWS
    ]
    width = max(len(label) for label, _ in rows)
    cols = [max(len(cells[i]) for _, cells in rows) for i in range(len(stats.players))]
    head = "player".ljust(width) + "".join(f"  {i:<{cols[i]}}" for i in range(len(cols)))
    lines.append(head)
    for label, cells in rows:
        lines.append(label.ljust(width) + "".join(f"  {c:<{cols[i]}}" for i, c in enumerate(cells)))
    return "\n".join(lines)
