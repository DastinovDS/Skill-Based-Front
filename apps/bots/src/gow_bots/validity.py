"""Whether the numbers of a tournament file can be trusted (#690): the data validity checks, the
level ladder, a Bradley-Terry strength model and the style matrix with its Nash mix.

``gow_bots.report`` renders these sections; this module holds the arithmetic. Everything is a pure
function of the rows: the bootstrap draws its seeds from ``random.Random(BOOTSTRAP_SEED)``, so the
same file gives the same text. Standard library only (AGENTS.md, section 2).

Definitions (``docs/balance/README.md``, section "Data validity", has the same text):

- *Decided* matches have a winner; a draw or an unfinished match is left out of every share below
  unless a definition says otherwise. Mirror matches (a bot against itself) count only for the
  side skew.
- **Level ladder**: for every personality (the bot name before ``@``) with two or more levels in
  the file, every pair of levels head to head: the share of the higher level among their decided
  matches (both sides, all maps) with its Wilson interval; *separated* when the interval excludes
  0.5, *inverted* when it lies below. The server levels (``SERVER_LEVELS``, a copy of
  ``gow_server.botmatch.LEVEL_BOTS``: the import is forbidden here, a test keeps the two equal)
  are a ladder of their own, adjacent steps.
- **Split-half reliability**: the win rate of every bot against the others on the even seeds and
  on the odd seeds, Pearson's r between the two lists; the same for the pairs (the share of the
  first name of every unordered pair among their decided matches).
- **Rank stability across maps**: Spearman's rho (Pearson's r of the ranks, ties get the mean
  rank) of the bots' win rates against the others between every two maps.
- **Bradley-Terry**: ``P(side 0 wins) = 1 / (1 + exp(-(s[bot0] - s[bot1] + h[map])))`` fitted
  on the decided matches by Newton's method with a ridge of ``RIDGE`` on every parameter (a weak
  prior that keeps a bot that never lost finite and makes ``sum(s) = 0``); ``s`` is the strength
  of a bot in log-odds, ``h`` the side-0 advantage of a map (the only way a map enters a
  symmetric pairwise model). The 95% intervals are the 2.5 and 97.5 percentiles of
  ``BOOTSTRAP`` refits on the seeds drawn with replacement (all matches of a drawn seed come
  together, so the interval holds the seed-to-seed spread).
- **Style matrix**: ``A[i][j]`` = (wins of i + half the draws) / matches of i against j, minus
  0.5 (both sides, all maps), so ``A`` is antisymmetric. Its *transitive part* is
  ``r[i] - r[j]`` with ``r[i]`` the mean of row i (the least-squares fit of a strength
  difference), the rest is the *cyclic part*; the *intransitive share* is the sum of squares of
  the cyclic part over that of ``A`` (0: one ladder explains every pair, 1: pure
  rock-paper-scissors; Balduzzi et al. 2018, the combinatorial Hodge split). The **Nash mix** is
  the symmetric equilibrium of the zero-sum game ``A`` found by ``NASH_ROUNDS`` rounds of
  multiplicative weights (the mean of the played mixes); ``gap`` is the best pure answer to it
  (0 at an exact equilibrium).
"""

import math
import random
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from itertools import pairwise
from statistics import median
from typing import Final, Protocol

from gow_bots.bots.tempo import DEFAULT_DIFFICULTY, DIFFICULTIES
from gow_bots.tournament import USAGE_KEYS

__all__ = [
    "SERVER_LEVELS",
    "Check",
    "Strength",
    "Tally",
    "bradley_terry",
    "checks",
    "ladder",
    "nash",
    "pearson",
    "spearman",
    "style_matrix",
    "transitive_split",
    "wilson",
]

Z: Final = 1.96
"""z of the 95% confidence interval."""
LEVEL_SEP: Final = "@"
"""``gow_bots.bots.LEVEL_SEP``: a smart bot's name and its level."""
LEVELS: Final[tuple[str, ...]] = tuple(DIFFICULTIES)
"""The tempo levels, easiest first."""
SERVER_LEVELS: Final[tuple[tuple[str, str], ...]] = (
    ("easy", "smart_turtle@easy"),
    ("normal", "smart_reactive@normal"),
    ("hard", "smart_strangler@hard"),
    ("expert", "smart_expander@hard"),
)
"""The levels of the bot screen, easiest first: ``gow_server.botmatch.LEVEL_BOTS``."""
FLOOR_BOTS: Final[tuple[str, ...]] = ("random_legal", "idle")
"""The bots of the skill floor (V1)."""
EXPLOITER: Final = "smart_exploiter"
"""The human-style benchmark of #688 (any level)."""

# The thresholds: proposals of the data-quality notes of 2026-11-05, not owner decisions.
FLOOR_MIN: Final = 0.95
LADDER_TOP_MIN: Final = 0.60
TEMPO_MIN_GAP: Final = 0.15
SPLIT_HALF_MIN_R: Final = 0.9
PAIR_HALF_WIDTH_MAX: Final = 0.05
SIDE_BAND: Final = (0.47, 0.53)
FIELD_MAX: Final = 0.65
EXPLOITER_MIN: Final = 0.50
MAP_RHO_MIN: Final = 0.5
REPEAT_MAX: Final = 0.05
BARELY_USED: Final = 0.1
"""A mechanic used less than this many times per match by every bot cannot be judged by bots."""

BOOTSTRAP: Final = 200
BOOTSTRAP_SEED: Final = 0
RIDGE: Final = 0.01
NASH_ROUNDS: Final = 20000


def wilson(successes: int, total: int, z: float = Z) -> tuple[float, float]:
    """Wilson score interval of a binomial proportion; ``(0.0, 1.0)`` when ``total`` is 0."""
    if total <= 0:
        return (0.0, 1.0)
    p = successes / total
    z2 = z * z
    denom = 1 + z2 / total
    centre = (p + z2 / (2 * total)) / denom
    half = z * math.sqrt(p * (1 - p) / total + z2 / (4 * total * total)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def half_width(n: int) -> float:
    """The Wilson-like half-width ``Z * sqrt(0.25 / n)`` at p = 0.5; 1.0 for ``n = 0``."""
    return Z * math.sqrt(0.25 / n) if n > 0 else 1.0


def pearson(xs: Sequence[float], ys: Sequence[float]) -> float | None:
    """Pearson's r; ``None`` with fewer than two points or a constant list."""
    n = len(xs)
    if n < 2 or n != len(ys):
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx == 0 or syy == 0:
        return None
    return sxy / math.sqrt(sxx * syy)


def _ranks(values: Sequence[float]) -> list[float]:
    """Ranks from 1, ties get the mean of their ranks."""
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for k in range(i, j + 1):
            ranks[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return ranks


def spearman(xs: Sequence[float], ys: Sequence[float]) -> float | None:
    """Spearman's rho: Pearson's r of the ranks (ties get the mean rank)."""
    return pearson(_ranks(xs), _ranks(ys))


class Match(Protocol):
    """The fields of a tournament row this module reads (``gow_bots.report.Row``)."""

    @property
    def map(self) -> str: ...
    @property
    def seed(self) -> int: ...
    @property
    def bots(self) -> tuple[str, str]: ...
    @property
    def winner(self) -> int | None: ...
    @property
    def state_hash(self) -> str: ...
    @property
    def accepted(self) -> tuple[int, int] | None: ...
    @property
    def usage(self) -> tuple[dict[str, int], dict[str, int]] | None: ...


def split_level(name: str) -> tuple[str, str | None]:
    """``(personality, level)`` of a bot name; a smart bot without ``@`` is ``DEFAULT_DIFFICULTY``,
    any other bot has no level."""
    base, sep, level = name.partition(LEVEL_SEP)
    if sep:
        return base, level
    return base, DEFAULT_DIFFICULTY if base.startswith("smart_") else None


@dataclass(slots=True)
class _WL:
    wins: int = 0
    n: int = 0


class Tally:
    """The counts every section needs, gathered in one pass over the rows."""

    def __init__(self, rows: Sequence[Match]) -> None:
        self.bots = sorted({b for r in rows for b in r.bots})
        self.maps = sorted({r.map for r in rows})
        self.seeds = sorted({r.seed for r in rows})
        self.matches = len(rows)
        self.pair: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0, 0])
        """``(a, b)``, ``a != b`` -> ``[wins of a, wins of b, draws]`` over both sides."""
        self.field: dict[str, _WL] = defaultdict(_WL)
        """Bot -> wins and matches against the others (draws included in ``n``)."""
        self.parity: dict[tuple[int, str], _WL] = defaultdict(_WL)
        self.pair_parity: dict[tuple[int, str, str], _WL] = defaultdict(_WL)
        self.by_map: dict[tuple[str, str], _WL] = defaultdict(_WL)
        self.mirror: dict[str, _WL] = defaultdict(_WL)
        """Map -> wins of side 0 and decided mirror matches."""
        self.accepted: dict[str, list[int]] = defaultdict(lambda: [0, 0])
        self.usage: dict[str, Counter[str]] = defaultdict(Counter)
        self.usage_n: Counter[str] = Counter()
        self.keys: Counter[tuple[str, str, str, int]] = Counter()
        self.states: dict[tuple[str, str, str], list[str]] = defaultdict(list)
        self.cells: dict[int, dict[tuple[str, str, str], list[int]]] = defaultdict(dict)
        """Seed -> ``(map, bot0, bot1)`` -> ``[side 0 wins, decided]``."""
        for r in rows:
            b0, b1 = r.bots
            self.keys[(r.map, b0, b1, r.seed)] += 1
            self.states[(r.map, b0, b1)].append(r.state_hash)
            for side, bot in enumerate(r.bots):
                if r.accepted is not None:
                    self.accepted[bot][0] += r.accepted[side]
                    self.accepted[bot][1] += 1
                if r.usage is not None:
                    self.usage[bot].update(r.usage[side])
                    self.usage_n[bot] += 1
            if r.winner is not None:
                cell = self.cells[r.seed].setdefault((r.map, b0, b1), [0, 0])
                cell[0] += r.winner == 0
                cell[1] += 1
            if b0 == b1:
                if r.winner is not None:
                    self.mirror[r.map].wins += r.winner == 0
                    self.mirror[r.map].n += 1
                continue
            for side, (bot, opp) in enumerate(((b0, b1), (b1, b0))):
                won = r.winner == side
                self.field[bot].wins += won
                self.field[bot].n += 1
                self.parity[(r.seed % 2, bot)].wins += won
                self.parity[(r.seed % 2, bot)].n += 1
                self.by_map[(r.map, bot)].wins += won
                self.by_map[(r.map, bot)].n += 1
                tally = self.pair[(bot, opp)]
                if r.winner is None:
                    tally[2] += 1
                elif won:
                    tally[0] += 1
                else:
                    tally[1] += 1
            if r.winner is not None:
                a, b = sorted(r.bots)
                key = (r.seed % 2, a, b)
                self.pair_parity[key].wins += r.bots[r.winner] == a
                self.pair_parity[key].n += 1

    def head_to_head(self, a: str, b: str) -> tuple[int, int]:
        """Wins of ``a`` and decided matches of ``a`` against ``b`` (both sides, all maps)."""
        wins, losses, _ = self.pair.get((a, b), (0, 0, 0))
        return wins, wins + losses

    def field_rate(self, bot: str) -> float | None:
        wl = self.field.get(bot)
        return wl.wins / wl.n if wl and wl.n else None

    def map_rates(self, m: str) -> list[float]:
        return [
            wl.wins / wl.n if (wl := self.by_map.get((m, b))) and wl.n else 0.0 for b in self.bots
        ]

    def commands(self, bot: str) -> float | None:
        total, n = self.accepted.get(bot, (0, 0))
        return total / n if n else None

    def mean_usage(self, bot: str, key: str) -> float | None:
        n = self.usage_n.get(bot, 0)
        return self.usage[bot][key] / n if n else None


# --- the level ladder ------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Step:
    """One pair of the ladder: the higher level's share against the lower one."""

    group: str
    higher: str
    lower: str
    wins: int
    decided: int

    @property
    def rate(self) -> float | None:
        return self.wins / self.decided if self.decided else None

    @property
    def verdict(self) -> str:
        if not self.decided:
            return "no matches"
        lo, hi = wilson(self.wins, self.decided)
        if lo > 0.5:
            return "separated"
        if hi < 0.5:
            return "INVERTED"
        return "not separated"


def ladder(tally: Tally) -> list[Step]:
    """Every pair of levels of every personality, then the adjacent server levels."""
    by_personality: dict[str, dict[str, str]] = defaultdict(dict)
    for bot in tally.bots:
        base, level = split_level(bot)
        if level in LEVELS:
            by_personality[base][level] = bot
    steps: list[Step] = []
    for base in sorted(by_personality):
        named = by_personality[base]
        present = [lv for lv in LEVELS if lv in named]
        for i, low in enumerate(present):
            for high in present[i + 1 :]:
                wins, decided = tally.head_to_head(named[high], named[low])
                steps.append(Step(base, named[high], named[low], wins, decided))
    server = [(lv, bot) for lv, bot in SERVER_LEVELS if bot in tally.bots]
    for (_, low), (_, high) in pairwise(server):
        wins, decided = tally.head_to_head(high, low)
        steps.append(Step("server levels", high, low, wins, decided))
    return steps


# --- the checks ------------------------------------------------------------------------------

PASS, FAIL, NO_DATA, NOT_COMPUTABLE = "PASS", "FAIL", "NO DATA", "NOT COMPUTABLE"


@dataclass(frozen=True, slots=True)
class Check:
    """One line of the validity table."""

    id: str
    name: str
    threshold: str
    measured: str
    status: str


def _ok(ok: bool) -> str:
    return PASS if ok else FAIL


def _fmt(value: float | None, digits: int = 2) -> str:
    return "n/a" if value is None else f"{value:.{digits}f}"


def _floor(tally: Tally) -> Check:
    floor = [b for b in FLOOR_BOTS if b in tally.bots]
    smart = [b for b in tally.bots if b.startswith("smart_")]
    name, threshold = (
        "skill floor",
        f"every smart bot >= {FLOOR_MIN:.2f} against {'/'.join(FLOOR_BOTS)}",
    )
    if not floor or not smart:
        return Check("V1", name, threshold, "the floor bots are not in the file", NO_DATA)
    worst = min(
        ((tally.head_to_head(b, f), b, f) for b in smart for f in floor),
        key=lambda x: x[0][0] / x[0][1] if x[0][1] else 1.0,
    )
    (wins, decided), b, f = worst
    rate = wins / decided if decided else None
    return Check(
        "V1", name, threshold, f"lowest {b} vs {f}: {_fmt(rate)}", _ok((rate or 0.0) >= FLOOR_MIN)
    )


def _ladder_check(steps: Sequence[Step]) -> Check:
    name = "level ladder"
    threshold = (
        f"per personality: hard vs easy >= {LADDER_TOP_MIN:.2f} with the lower bound > 0.5, "
        "normal vs easy > 0.5"
    )
    groups = sorted({s.group for s in steps if s.group != "server levels"})
    if not groups:
        return Check("V2", name, threshold, "no personality has two levels", NO_DATA)
    failed: list[str] = []
    for g in groups:
        mine = {
            (split_level(s.higher)[1], split_level(s.lower)[1]): s for s in steps if s.group == g
        }
        top, low = mine.get(("hard", "easy")), mine.get(("normal", "easy"))
        ok = True
        if top is not None:
            ok &= (top.rate or 0.0) >= LADDER_TOP_MIN and wilson(top.wins, top.decided)[0] > 0.5
        if low is not None:
            ok &= (low.rate or 0.0) > 0.5
        if not ok:
            failed.append(g)
    measured = f"{len(groups) - len(failed)} of {len(groups)} pass" + (
        f"; fail: {', '.join(failed)}" if failed else ""
    )
    return Check("V2", name, threshold, measured, _ok(not failed))


def _tempo(tally: Tally) -> Check:
    name = "tempo binding"
    threshold = f"commands per match differ between easy and hard by >= {TEMPO_MIN_GAP:.0%}"
    gaps: list[tuple[str, float]] = []
    for bot in tally.bots:
        base, level = split_level(bot)
        if level != "easy":
            continue
        hard = next((b for b in tally.bots if split_level(b) == (base, "hard")), None)
        easy_n, hard_n = tally.commands(bot), None if hard is None else tally.commands(hard)
        if easy_n and hard_n is not None:
            gaps.append((base, abs(hard_n - easy_n) / easy_n))
    if not gaps:
        return Check("V3", name, threshold, "no personality has easy and hard", NO_DATA)
    largest = max(g for _, g in gaps)
    worst = min(gaps, key=lambda x: x[1])
    measured = f"smallest {worst[0]} {worst[1]:.1%}, largest {largest:.1%}"
    return Check("V3", name, threshold, measured, _ok(worst[1] >= TEMPO_MIN_GAP))


def split_half(tally: Tally) -> tuple[float | None, float | None]:
    """Pearson's r of the even-seed and odd-seed win rates of the bots and of the pairs."""
    bots = [
        b
        for b in tally.bots
        if tally.parity.get((0, b), _WL()).n and tally.parity.get((1, b), _WL()).n
    ]
    even = [tally.parity[(0, b)].wins / tally.parity[(0, b)].n for b in bots]
    odd = [tally.parity[(1, b)].wins / tally.parity[(1, b)].n for b in bots]
    pairs = sorted({(a, b) for _, a, b in tally.pair_parity})
    pairs = [
        p
        for p in pairs
        if tally.pair_parity.get((0, *p), _WL()).n and tally.pair_parity.get((1, *p), _WL()).n
    ]
    pe = [tally.pair_parity[(0, *p)].wins / tally.pair_parity[(0, *p)].n for p in pairs]
    po = [tally.pair_parity[(1, *p)].wins / tally.pair_parity[(1, *p)].n for p in pairs]
    return pearson(even, odd), pearson(pe, po)


def _split(tally: Tally) -> Check:
    name, threshold = "split-half reliability", f"r of the bot win rates >= {SPLIT_HALF_MIN_R}"
    bots_r, pairs_r = split_half(tally)
    if bots_r is None:
        return Check("V4a", name, threshold, "needs seeds of both parities", NO_DATA)
    measured = f"bots r = {bots_r:.2f}, pairs r = {_fmt(pairs_r)}"
    return Check("V4a", name, threshold, measured, _ok(bots_r >= SPLIT_HALF_MIN_R))


def _precision(tally: Tally) -> Check:
    name = "pair precision"
    threshold = f"the half-width of a pair claim <= {PAIR_HALF_WIDTH_MAX:.2f}"
    counts = [w + lo + d for (a, b), (w, lo, d) in tally.pair.items() if a < b]
    if not counts:
        return Check("V4b", name, threshold, "no pairs", NO_DATA)
    n = int(median(counts))
    width = half_width(n)
    need = math.ceil((Z / (2 * PAIR_HALF_WIDTH_MAX)) ** 2)
    measured = f"median pair {n} matches: +-{width:.3f} (needs {need})"
    return Check("V4b", name, threshold, measured, _ok(width <= PAIR_HALF_WIDTH_MAX))


def _sides(tally: Tally) -> Check:
    lo_band, hi_band = SIDE_BAND
    name = "side bias"
    threshold = f"side 0 of the mirror matches in {lo_band:.2f}..{hi_band:.2f} on every map"
    if not tally.mirror:
        return Check("V4c", name, threshold, "no decided mirror matches", NO_DATA)
    cells: list[str] = []
    ok = True
    for m in sorted(tally.mirror):
        wl = tally.mirror[m]
        rate = wl.wins / wl.n
        lo, hi = wilson(wl.wins, wl.n)
        ok &= lo_band <= rate <= hi_band
        cells.append(f"{m} {rate:.2f} [{lo:.2f}; {hi:.2f}]")
    return Check("V4c", name, threshold, "; ".join(cells), _ok(ok))


def counters(tally: Tally) -> dict[str, list[str]]:
    """Bot -> the opponents that beat it significantly (Wilson lower bound above 0.5)."""
    out: dict[str, list[str]] = {}
    for b in tally.bots:
        out[b] = [
            o
            for o in tally.bots
            if o != b and (wd := tally.head_to_head(o, b))[1] and wilson(wd[0], wd[1])[0] > 0.5
        ]
    return out


def _counter(tally: Tally) -> list[Check]:
    if len(tally.bots) < 2:
        return [Check("V5", "counter for every bot", "", "one bot", NO_DATA)]
    found = counters(tally)
    lonely = [b for b in tally.bots if not found[b]]
    first = Check(
        "V5a",
        "counter for every bot",
        "every bot has >= 1 opponent with a Wilson lower bound > 0.5 against it",
        f"without a counter: {', '.join(lonely)}" if lonely else "all have one",
        _ok(not lonely),
    )
    rates = {b: tally.field_rate(b) or 0.0 for b in tally.bots}
    top = max(tally.bots, key=lambda b: rates[b])
    second = Check(
        "V5b",
        "no bot dominates the field",
        f"no bot > {FIELD_MAX:.2f} against the field",
        f"highest {top} {rates[top]:.2f}",
        _ok(rates[top] <= FIELD_MAX),
    )
    return [first, second]


def _exploiter(tally: Tally) -> Check:
    expert = dict(SERVER_LEVELS)["expert"]
    name = "exploiter"
    threshold = f"`expert` ({expert}) >= {EXPLOITER_MIN:.2f} against `{EXPLOITER}` (#688)"
    rivals = [b for b in tally.bots if split_level(b)[0] == EXPLOITER]
    if expert not in tally.bots or not rivals:
        return Check("V6", name, threshold, "the pair is not in the file", NO_DATA)
    wins = decided = 0
    for r in rivals:
        w, d = tally.head_to_head(expert, r)
        wins, decided = wins + w, decided + d
    rate = wins / decided if decided else None
    return Check(
        "V6", name, threshold, f"{_fmt(rate)} (n={decided})", _ok((rate or 0.0) >= EXPLOITER_MIN)
    )


def barely_used(tally: Tally, keys: Sequence[str] = USAGE_KEYS) -> list[str]:
    """The ``keys`` every bot uses less than ``BARELY_USED`` times per match."""
    if not tally.usage_n:
        return []
    return [
        k for k in keys if all((tally.mean_usage(b, k) or 0.0) < BARELY_USED for b in tally.usage_n)
    ]


def map_rhos(tally: Tally) -> list[tuple[str, str, float | None]]:
    """Spearman's rho of the bots' win rates against the others for every two maps."""
    rates = {m: tally.map_rates(m) for m in tally.maps}
    return [
        (a, b, spearman(rates[a], rates[b]))
        for i, a in enumerate(tally.maps)
        for b in tally.maps[i + 1 :]
    ]


def _maps(tally: Tally) -> Check:
    name, threshold = (
        "rank stability across maps",
        f"Spearman rho >= {MAP_RHO_MIN} for every two maps",
    )
    rhos = [(a, b, r) for a, b, r in map_rhos(tally) if r is not None]
    if not rhos or len(tally.bots) < 3:
        return Check("V9", name, threshold, "needs two maps and three bots", NO_DATA)
    low = min(rhos, key=lambda x: x[2])
    high = max(r for _, _, r in rhos)
    measured = f"lowest {low[0]}/{low[1]} {low[2]:.2f}, highest {high:.2f}"
    return Check("V9", name, threshold, measured, _ok(low[2] >= MAP_RHO_MIN))


def _duplicates(tally: Tally) -> list[Check]:
    extra = sum(n - 1 for n in tally.keys.values() if n > 1)
    first = Check(
        "D1",
        "duplicate matches",
        "no (map, side 0, side 1, seed) twice",
        f"{extra} extra rows",
        _ok(extra == 0),
    )
    repeated = sum(len(v) - len(set(v)) for v in tally.states.values())
    share = repeated / tally.matches if tally.matches else 0.0
    second = Check(
        "D2",
        "repeated games",
        f"<= {REPEAT_MAX:.0%} of the matches end in the final state of another seed of their cell",
        f"{repeated} of {tally.matches} ({share:.1%})",
        _ok(share <= REPEAT_MAX),
    )
    return [first, second]


def checks(tally: Tally, steps: Sequence[Step], keys: Sequence[str] = USAGE_KEYS) -> list[Check]:
    """The validity checks V1..V9 and D1, D2 (module docstring, ``docs/balance/README.md``);
    ``keys``: the mechanics the economy of the file accepts (for V7)."""
    unused = barely_used(tally, keys)
    return [
        _floor(tally),
        _ladder_check(steps),
        _tempo(tally),
        _split(tally),
        _precision(tally),
        _sides(tally),
        *_counter(tally),
        _exploiter(tally),
        Check(
            "V7",
            "sensitivity to rule numbers",
            "a rules change moves the metric the predicted way (needs two runs)",
            "used < "
            + f"{BARELY_USED} per match by every bot, not judged by bots: "
            + (", ".join(unused) or "none"),
            NOT_COMPUTABLE,
        ),
        Check(
            "V8",
            "similarity to humans",
            "a metric off by more than 2x from the owner's replays is bots-only",
            "needs replays of humans (`gow-bots stats`)",
            NOT_COMPUTABLE,
        ),
        _maps(tally),
        *_duplicates(tally),
    ]


# --- Bradley-Terry ---------------------------------------------------------------------------


def _sigmoid(x: float) -> float:
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    e = math.exp(x)
    return e / (1.0 + e)


def _solve(h: list[list[float]], g: list[float]) -> list[float]:
    """``h x = g`` by Gaussian elimination with partial pivoting (``h`` is positive definite)."""
    n = len(g)
    a = [[*row, g[i]] for i, row in enumerate(h)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(a[r][col]))
        a[col], a[pivot] = a[pivot], a[col]
        p = a[col][col]
        for r in range(col + 1, n):
            f = a[r][col] / p
            if f:
                row, top = a[r], a[col]
                for c in range(col, n + 1):
                    row[c] -= f * top[c]
    x = [0.0] * n
    for r in range(n - 1, -1, -1):
        x[r] = (a[r][n] - sum(a[r][c] * x[c] for c in range(r + 1, n))) / a[r][r]
    return x


Cell = tuple[int, int, int, int, int]
"""``(map index, bot0 index, bot1 index, side 0 wins, decided)``."""


def _fit(cells: Sequence[Cell], bots: int, maps: int, start: Sequence[float] | None) -> list[float]:
    """The parameters ``s[0..bots-1], h[0..maps-1]`` (module docstring) by Newton's method."""
    k = bots + maps
    theta = list(start) if start is not None else [0.0] * k
    for _ in range(50):
        grad = [-RIDGE * t for t in theta]
        hess = [[RIDGE if i == j else 0.0 for j in range(k)] for i in range(k)]
        for m, i, j, wins, n in cells:
            hm = bots + m
            p = _sigmoid(theta[i] - theta[j] + theta[hm])
            g = wins - n * p
            w = n * p * (1.0 - p)
            grad[hm] += g
            hess[hm][hm] += w
            if i != j:
                grad[i] += g
                grad[j] -= g
                hess[i][i] += w
                hess[j][j] += w
                hess[i][j] -= w
                hess[j][i] -= w
                hess[i][hm] += w
                hess[hm][i] += w
                hess[j][hm] -= w
                hess[hm][j] -= w
        step = _solve(hess, grad)
        theta = [t + d for t, d in zip(theta, step, strict=True)]
        if max(abs(d) for d in step) < 1e-9:
            break
    return theta


@dataclass(frozen=True, slots=True)
class Strength:
    """A fitted parameter with its bootstrap interval."""

    name: str
    value: float
    low: float
    high: float


def _percentile(sorted_values: Sequence[float], q: float) -> float:
    """The ``q`` quantile by linear interpolation between the closest ranks."""
    pos = q * (len(sorted_values) - 1)
    lo = math.floor(pos)
    hi = min(lo + 1, len(sorted_values) - 1)
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (pos - lo)


def bradley_terry(
    tally: Tally, replicates: int = BOOTSTRAP
) -> tuple[list[Strength], list[Strength]] | None:
    """The bot strengths and the map side effects with bootstrap intervals over the seeds;
    ``None`` without decided matches."""
    bot_ix = {b: i for i, b in enumerate(tally.bots)}
    map_ix = {m: i for i, m in enumerate(tally.maps)}
    per_seed: dict[int, list[Cell]] = {
        seed: [
            (map_ix[m], bot_ix[b0], bot_ix[b1], w, n)
            for (m, b0, b1), (w, n) in sorted(tally.cells[seed].items())
        ]
        for seed in sorted(tally.cells)
    }
    if not per_seed:
        return None

    def merge(seeds: Iterable[int]) -> list[Cell]:
        total: dict[tuple[int, int, int], list[int]] = {}
        for seed in seeds:
            for m, i, j, w, n in per_seed[seed]:
                cell = total.setdefault((m, i, j), [0, 0])
                cell[0] += w
                cell[1] += n
        return [(m, i, j, w, n) for (m, i, j), (w, n) in sorted(total.items())]

    nb, nm = len(tally.bots), len(tally.maps)
    seeds = sorted(per_seed)
    full = _fit(merge(seeds), nb, nm, None)
    rng = random.Random(BOOTSTRAP_SEED)
    draws: list[list[float]] = []
    for _ in range(replicates):
        drawn = [seeds[rng.randrange(len(seeds))] for _ in seeds]
        draws.append(_fit(merge(drawn), nb, nm, full))
    out: list[Strength] = []
    for k, name in enumerate([*tally.bots, *tally.maps]):
        values = sorted(d[k] for d in draws) if draws else [full[k]]
        out.append(Strength(name, full[k], _percentile(values, 0.025), _percentile(values, 0.975)))
    return out[:nb], out[nb:]


# --- the style matrix ------------------------------------------------------------------------


def style_matrix(tally: Tally) -> list[list[float]]:
    """``A[i][j]`` of the module docstring over ``tally.bots``; 0 for a pair without matches."""
    out: list[list[float]] = []
    for a in tally.bots:
        row: list[float] = []
        for b in tally.bots:
            wins, losses, draws = tally.pair.get((a, b), (0, 0, 0))
            n = wins + losses + draws
            row.append((wins + draws / 2) / n - 0.5 if a != b and n else 0.0)
        out.append(row)
    return out


def transitive_split(a: Sequence[Sequence[float]]) -> tuple[list[float], float | None]:
    """The row means ``r`` (the transitive strengths) and the intransitive share of ``A``;
    the share is ``None`` for a matrix of zeros."""
    n = len(a)
    r = [sum(row) / n for row in a] if n else []
    total = cyclic = 0.0
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            total += a[i][j] ** 2
            cyclic += (a[i][j] - (r[i] - r[j])) ** 2
    return r, (cyclic / total if total else None)


def nash(a: Sequence[Sequence[float]], rounds: int = NASH_ROUNDS) -> tuple[list[float], float]:
    """The symmetric equilibrium mix of the zero-sum game ``A`` (module docstring) and its gap."""
    n = len(a)
    if n == 0:
        return [], 0.0
    eta = math.sqrt(8 * math.log(max(n, 2)) / rounds)
    weights = [1.0] * n
    mean = [0.0] * n
    for _ in range(rounds):
        total = sum(weights)
        x = [w / total for w in weights]
        for i in range(n):
            mean[i] += x[i]
        payoff = [sum(a[i][j] * x[j] for j in range(n)) for i in range(n)]
        top = max(payoff)
        weights = [w * math.exp(eta * (p - top)) for w, p in zip(weights, payoff, strict=True)]
    mix = [m / rounds for m in mean]
    gap = max(sum(a[i][j] * mix[j] for j in range(n)) for i in range(n))
    return mix, gap


def by_name(values: Mapping[str, float]) -> list[tuple[str, float]]:
    """``values`` sorted from the largest, ties by name."""
    return sorted(values.items(), key=lambda kv: (-kv[1], kv[0]))
