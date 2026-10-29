"""Parameter search by tournament (#166, PR 3): a (1+1) hill climb over the ranges of one bot.

``gow-bots search`` tunes the ``PARAMS`` ranges of one bot (``--bot``, a ``BOTS`` name, a smart
one may carry ``@<level>``) against a field of opponents (``--against``). Standard library only.

1. The *score* of a set of ranges is the win rate of the bot against the field: every opponent,
   both sides, every map, the seeds ``seed_base .. seed_base + seeds - 1`` (the same seeds for
   every candidate, so two candidates differ only by their ranges); draws count half. A tenth of
   the bot's mean share of the VP (``vp`` of the rows) is added, so a candidate that loses every
   match but by less still climbs (a plateau of zero wins has no slope). With ``--target T`` the
   score is ``-|win rate - T|`` (a personality brought toward a share instead of up).
2. A round mutates the best ranges so far: ``--mutate`` keys picked from ``--keys`` move by a
   step of a quarter of their middle (at least 1) up or down, keeping their width and staying
   non-negative; the candidate replaces the best one only when it scores higher.
3. Every round is a line of ``--out`` (JSONL: the round, the ranges, the score, accepted or not);
   the best ranges are printed at the end as a ``PARAMS`` fragment to copy into the bot class.

The choices of the search come from ``random.Random(f"gow-bots/search/{search_seed}")``, and the
matches are a function of their task (``gow_bots.tournament``), so a search is reproducible. It
measures on few seeds: the result is a proposal to confirm with ``mise run tournament`` on fresh
seeds (``--seed-base``), not a verdict.
"""

import json
import random
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from typing import TextIO

from gow_bots.bots import BOTS, LEVEL_SEP, ParamRange
from gow_bots.tournament import MatchTask, play_tasks
from gow_sim.maps import load_map
from gow_sim.ruleset import load_ruleset

__all__ = ["Candidate", "mutate", "run_search", "score_rows", "search_tasks"]

Ranges = dict[str, tuple[int, int]]


@dataclass(frozen=True, slots=True)
class Candidate:
    """Ranges of the searched bot and their score (higher is better)."""

    ranges: Ranges
    score: float
    win_rate: float
    vp_share: float


def base_ranges(bot: str) -> Ranges:
    """The ``PARAMS`` ranges of ``bot`` (a level suffix is ignored)."""
    cls = BOTS[bot.partition(LEVEL_SEP)[0]]
    params: Mapping[str, ParamRange] = getattr(cls, "PARAMS", {})
    return {k: (r.low, r.high) for k, r in sorted(params.items())}


def mutate(ranges: Ranges, keys: Sequence[str], count: int, rng: random.Random) -> Ranges:
    """``ranges`` with ``count`` of ``keys`` moved one step (module docstring, item 2)."""
    out = dict(ranges)
    for key in rng.sample(sorted(keys), min(count, len(keys))):
        low, high = out[key]
        step = max(1, (low + high) // 8)
        delta = step if rng.random() < 0.5 else -step
        delta = max(delta, -low)  # stay non-negative
        if delta == 0:
            delta = step
        out[key] = (low + delta, high + delta)
    return out


def search_tasks(
    map_paths: Sequence[str],
    rules_path: str,
    bot: str,
    against: Sequence[str],
    seeds: int,
    seed_base: int,
    ranges: Ranges,
) -> list[MatchTask]:
    """The matches that score ``ranges``: ``bot`` against every opponent, both sides."""
    name = bot
    params = tuple((name, k, lo, hi) for k, (lo, hi) in sorted(ranges.items()))
    tasks: list[MatchTask] = []
    for map_path in sorted(map_paths):
        for seed in range(seed_base, seed_base + seeds):
            for other in sorted(set(against)):
                for pair in ((name, other), (other, name)):
                    tasks.append(MatchTask(map_path, rules_path, pair, seed, None, params))
    return tasks


def score_rows(rows: Sequence[Mapping[str, object]], bot: str) -> tuple[float, float]:
    """Win rate of ``bot`` in ``rows`` (tournament rows; a draw counts half) and its mean share
    of the VP of a match (a match without VP counts half)."""
    points = share = 0.0
    for row in rows:
        side = 0 if row["bot0"] == bot else 1
        winner = row.get("winner")
        points += 1.0 if winner == side else 0.5 if winner is None else 0.0
        vp = row.get("vp")
        pair = [int(v) for v in vp] if isinstance(vp, list) else [0, 0]  # pyright: ignore[reportUnknownVariableType, reportUnknownArgumentType]
        total = pair[0] + pair[1]
        share += pair[side] / total if total else 0.5
    count = len(rows) or 1
    return points / count, share / count


def run_search(
    map_paths: Sequence[str],
    rules_path: str,
    bot: str,
    against: Sequence[str],
    *,
    keys: Sequence[str],
    rounds: int,
    seeds: int,
    seed_base: int = 0,
    mutate_count: int = 2,
    target: float | None = None,
    search_seed: int = 0,
    jobs: int | None = None,
    start: Ranges | None = None,
    play: Callable[[Sequence[MatchTask], int | None], Iterator[str]] = play_tasks,
) -> Iterator[tuple[int, Candidate, bool]]:
    """Yield ``(round, candidate, accepted)``; round 0 scores the start ranges (module docstring).

    Raises ``ValueError`` for an unknown bot, opponent or key, ``bot`` among the opponents, or
    ``rounds``/``seeds`` below 1.
    """
    if rounds < 1 or seeds < 1:
        raise ValueError("--rounds and --seeds must be at least 1")
    if bot in against:
        raise ValueError("the searched bot cannot be its own opponent")
    ranges = dict(start) if start is not None else base_ranges(bot)
    unknown = sorted(set(keys) - ranges.keys())
    if unknown or not keys:
        raise ValueError(
            f"keys {unknown or '(none)'} are not parameters of {bot}: {sorted(ranges)}"
        )
    load_ruleset(rules_path)
    for p in map_paths:
        load_map(p)
    rng = random.Random(f"gow-bots/search/{search_seed}")

    def score(candidate: Ranges) -> Candidate:
        tasks = search_tasks(map_paths, rules_path, bot, against, seeds, seed_base, candidate)
        rows = [json.loads(r) for r in play(tasks, jobs)]
        rate, share = score_rows(rows, bot)
        value = rate + share / 10 if target is None else -abs(rate - target)
        return Candidate(candidate, value, rate, share)

    best = score(ranges)
    yield 0, best, True
    for n in range(1, rounds + 1):
        candidate = score(mutate(best.ranges, keys, mutate_count, rng))
        accepted = candidate.score > best.score
        if accepted:
            best = candidate
        yield n, candidate, accepted


def write_round(f: TextIO, n: int, c: Candidate, accepted: bool) -> None:
    """One JSONL line of a round."""
    line = {
        "round": n,
        "score": round(c.score, 4),
        "win_rate": round(c.win_rate, 4),
        "vp_share": round(c.vp_share, 4),
        "accepted": accepted,
        "ranges": {k: list(v) for k, v in sorted(c.ranges.items())},
    }
    f.write(json.dumps(line, separators=(",", ":")) + "\n")
    f.flush()


def params_fragment(best: Ranges, start: Ranges) -> str:
    """The changed ranges as lines of a ``PARAMS`` dict."""
    lines = [
        f'"{k}": ParamRange({lo}, {hi}),'
        for k, (lo, hi) in sorted(best.items())
        if start.get(k) != (lo, hi)
    ]
    return "\n".join(lines) if lines else "(no change)"
