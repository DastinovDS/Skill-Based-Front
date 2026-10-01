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
"""

# The report text is Russian: RUF001 flags Cyrillic words that look like Latin ones.
# ruff: noqa: RUF001
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

from gow_bots.tournament import SCHEMA_VERSION

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

    @property
    def outcome(self) -> tuple[int | None, str, tuple[int, int], tuple[int, int]]:
        """What happened, without the identification of the match (for the diversity count)."""
        return (self.winner, self.reason, self.vp, self.cities)


def _pair(raw: dict[str, Any], key: str) -> tuple[int, int]:
    value = raw[key]
    return (int(value[0]), int(value[1]))


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
    header = ["строка бьёт столбец", *bots]
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
        f"- Матчей: {len(rows)}; карты: {', '.join(maps)}; боты: {', '.join(_bots_of(rows))}.",
        f"- Сиды: {seeds[0]}..{seeds[-1]} ({len(seeds)} шт.).",
        f"- Рулсет `{_one(r.ruleset_hash for r in rows)}`, `SIM_VERSION` "
        f"{_one(str(r.sim_version) for r in rows)}.",
        f"- Без победителя (ничья или не закончен): {draws} ({_share(draws, len(rows))}).",
        "- Причины окончания: " + ", ".join(f"`{k}` {v}" for k, v in sorted(reasons.items())) + ".",
    ]
    return "\n".join(lines)


def _one(values: Iterable[str]) -> str:
    unique = sorted(set(values))
    return unique[0] if len(unique) == 1 else "разные: " + ", ".join(unique)


def _section_pairs(ps: Sequence[Persp], bots: Sequence[str]) -> str:
    rate_rows = [
        [f"**{a}**", *("-" if a == b else _draw_cell(ps, a, b) for b in bots)] for a in bots
    ]
    return (
        "Win-rate строки против столбца на обеих сторонах, 95% интервал Уилсона в скобках: "
        "`доля [нижняя; верхняя]`. Ничья считается не победой.\n\n"
        + _matrix(ps, bots, full=True)
        + "\n\nДоля ничьих в паре (по всем картам):\n\n"
        + _table(["", *bots], rate_rows)
        + "\n\n![матрица пар](PREFIX-pairs.png)"
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
    out.append(line("все карты", rows))
    table = _table(["карта", "зеркальные матчи: сторона 0", "все матчи: сторона 0"], out)
    return (
        "Доля побед стороны 0 среди матчей с победителем (`побед стороны 0 / решённых`, "
        "интервал Уилсона). Зеркальные матчи (бот против себя) измеряют перекос карты без разницы "
        "ботов; в полном турнире каждая пара играет обеими сторонами, поэтому второй столбец "
        "показывает перекос после усреднения по ботам. Интервал, содержащий 0.5, не даёт "
        "оснований говорить о перекосе.\n\n" + table + "\n\n![сторона](PREFIX-sides.png)"
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
        sieges_won = sum(p.row.sieges_won[p.side] for p in mine)
        caps = sum(p.row.captures[p.side] for p in mine)
        late = sum(p.late_captures for p in mine)
        body.append(
            [
                f"**{b}**",
                str(len(versus)),
                _win_rate(versus).fmt(),
                _share(draw, len(versus)),
                _share(planned, attacks),
                f"{_share(sieges_won, sieges)} ({sieges_won}/{sieges})",
                f"{caps / len(mine):.2f}",
                _share(late, caps),
            ]
        )
    header = [
        "бот",
        "матчей против других",
        "win-rate [95%]",
        "ничьи",
        "доля запланированных атак",
        "успех осад (взято/попыток)",
        "захватов за матч",
        f"доля захватов в последние {LATE_MINUTES} мин",
    ]
    return (
        "Win-rate считается против других ботов (без зеркальных матчей); остальные метрики по "
        "всем матчам бота. «Запланированная атака» = приказ `Move` с `planned=true` на чужой "
        "или нейтральный узел; «успех осады» = захваты узлов врага / попытки осады.\n\n"
        + _table(header, body)
        + "\n\n![боты по картам](PREFIX-bots.png)"
    )


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
                m or "все карты",
                str(len(rs)),
                f"{_share(late, len(rs))} ({late}/{len(rs)})",
                f"{_share(late_caps, caps)} ({late_caps}/{caps})",
            ]
        )
    header = [
        "карта",
        "матчей",
        f"матчей с захватом в последние {LATE_MINUTES} мин",
        f"доля захватов в последние {LATE_MINUTES} мин",
    ]
    return (
        f"Матч, в котором в последние {LATE_MINUTES} минуты никто ничего не берёт, обычно "
        "застыл. Матч, закончившийся раньше, считается по своим последним минутам.\n\n"
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
                m or "все карты",
                str(len(rs)),
                str(len({r.state_hash for r in rs})),
                str(len({r.outcome for r in rs})),
                f"{frozen}/{len(cells)}",
            ]
        )
    return (
        "`state_hash` различает любые два финальных состояния; «исход» = `(победитель, причина, "
        "VP, города)`. «Ячейка без вариативности» = карта + упорядоченная пара, где все сиды "
        "дали одно и то же финальное состояние (бот не зависит от сида).\n\n"
        + _table(
            [
                "карта",
                "матчей",
                "уникальных состояний",
                "уникальных исходов",
                "ячеек без вариативности",
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
    parts.append("Win-rate бота против остальных по картам:\n\n" + _table(["бот", *maps], overall))
    for m in maps:
        sub = [p for p in ps if p.row.map == m]
        n = len([r for r in rows if r.map == m])
        parts.append(f"### {m} ({n} матчей)\n\n" + _matrix(sub, bots, full=False))
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
        "Кого бот бьёт (больше побед, чем у соперника в их матчах); «значимо» = интервал Уилсона "
        "доли среди решённых матчей не содержит 0.5.\n\n"
        + _table(["бот", "бьёт", "бьёт значимо"], body)
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
        f"- Доминирующая стратегия (бьёт всех остальных): {', '.join(others) or 'нет'}"
        f"; значимо: {', '.join(sure_dom) or 'нет'}."
    )
    lines.append(
        f"- Лучший средний win-rate: {ranked[0]} {rates[ranked[0]].fmt()}; худший: "
        f"{ranked[-1]} {rates[ranked[-1]].fmt()}; разброс {spread:.2f}."
    )
    cycles = _cycles(bots, lambda a, b: _beats(ps, a, b))
    if cycles:
        lines.append(
            f"- Циклы «камень-ножницы-бумага» (A бьёт B, B бьёт C, C бьёт A): {len(cycles)}; "
            f"значимых по всем трём рёбрам: {sum(c[1] for c in cycles)}."
        )
        lines.extend(
            f"  - {' > '.join(c[0])} > {c[0][0]}" + (" (значимый)" if c[1] else "") for c in cycles
        )
    else:
        lines.append("- Циклов «камень-ножницы-бумага» нет.")
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
            f"- {_mark(ok)} `strangler` берёт хотя бы один город осадой в матче против "
            f"`expander` в {rate.fmt()} матчей (порог {STRANGLER_MIN_RATE:.0%}, n={rate.n})."
        )
    else:
        lines.append("- [нет данных] проверка `strangler` против `expander`: нет этих ботов.")

    if {_REACTIVE, _EXPANDER, _RUSHER} <= have:
        reactive = _win_rate(_pair_ps(ps, _REACTIVE, _RUSHER))
        expander = _win_rate(_pair_ps(ps, _EXPANDER, _RUSHER))
        ok = (reactive.value or 0.0) > (expander.value or 0.0)
        apart = reactive.ci[0] > expander.ci[1] or expander.ci[0] > reactive.ci[1]
        lines.append(
            f"- {_mark(ok)} `reactive` выигрывает у `rusher` чаще, чем `expander`: "
            f"{reactive.fmt()} против {expander.fmt()}"
            + ("; интервалы не пересекаются." if apart else "; интервалы пересекаются.")
        )
    else:
        lines.append("- [нет данных] проверка `reactive` и `expander` против `rusher`.")

    if _TURTLE in have:
        versus = [p for p in ps if p.bot == _TURTLE and p.opp != _TURTLE]
        rate = _win_rate(versus)
        draws = sum(p.row.winner is None for p in versus)
        lines.append(
            f"- Win-rate `turtle` против остальных: {rate.fmt()}, "
            f"ничьих {_share(draws, len(versus))}"
            f" (n={rate.n})."
        )
        lines.append(
            "  - по соперникам: "
            + ", ".join(
                f"{b} {_win_rate(_pair_ps(ps, _TURTLE, b)).short()}" for b in bots if b != _TURTLE
            )
            + "."
        )
    return "\n".join(lines)


def _mark(ok: bool) -> str:
    return "[выполнено]" if ok else "[НЕ выполнено]"


def render_report(rows: Sequence[Row], source: str, prefix: str) -> str:
    """The Markdown text; charts are referenced as ``<prefix>-<chart>.png`` next to it."""
    ps = _persps(rows)
    bots = _bots_of(rows)
    sections: list[tuple[str, str]] = [
        ("Обзор", _section_overview(rows)),
        ("Проверки компетентности ботов", _section_checks(ps, bots)),
        ("Матрица пар стратегий", _section_pairs(ps, bots)),
        ("Преимущество стороны", _section_sides(rows)),
        ("Метрики по ботам", _section_bots(ps, bots)),
        ("Разнообразие стратегий", _section_diversity(ps, bots)),
        ("Захваты в конце матча", _section_late(rows)),
        ("Уникальные исходы", _section_outcomes(rows)),
        ("Разбивка по картам", _section_maps(ps, rows, bots)),
    ]
    head = (
        f"# Баланс-отчёт: `{source}`\n\n"
        "Сгенерирован `uv run gow-bots report` (BOT-05, #38); формат входа: "
        "[README.md](README.md). Не редактировать руками.\n"
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
    ax.set_title("win-rate строки против столбца (95% Уилсон)")
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
    ax.set_ylabel("win-rate против остальных")
    ax.set_title("win-rate ботов по картам (95% Уилсон)")
    ax.legend()
    fig.tight_layout()
    paths.append(out / f"{prefix}-bots.png")
    _save(fig, paths[-1])

    # 3. side advantage: share of side 0 among decisive matches, mirror and all
    labels = [*maps, "все"]
    fig = Figure(figsize=(max(5.0, 1.8 * len(labels) + 1), 4.0), dpi=100)
    FigureCanvasAgg(fig)
    ax = fig.add_subplot()
    for k, (title, mirror_only) in enumerate((("зеркальные матчи", True), ("все матчи", False))):
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
    ax.set_ylabel("доля побед стороны 0 среди решённых")
    ax.set_title("преимущество стороны (95% Уилсон)")
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
