"""Tournament harness (BOT-04, AGENTS.md section 8): bots against bots on maps, result in JSONL.

A *task* is one match: a map, a pair of bots ``(side 0, side 1)`` and a seed. Every ordered pair
of the chosen bots plays, so every pair meets with both sides (and every bot meets itself); the
seed is the match seed of both bots (``choose_params``, AGENTS.md section 8). Tasks are sorted by
``(map, seed, bot0, bot1)``, run by a ``ProcessPoolExecutor`` with one match per worker process
(``max_tasks_per_child=1``: no state survives a match) and written in that order, so the file is
a function of the arguments: the same run gives the same bytes (``docs/balance/README.md``
describes the row format).

Mechanic usage (#166): every row also counts the accepted commands of each player by mechanic
(``usage``, the keys of ``USAGE_KEYS``: the command class name, a planned ``Move`` as
``MovePlanned``), so a report shows which mechanics a bot plays and how often.

The harness imports ``gow_sim`` fully (AGENTS.md, section 4.1); it does not import the server.
"""

import json
import multiprocessing
import os
from collections.abc import Iterator, Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from gow_bots.bots import BotFactory, ParamRange, bot_factory
from gow_sim.analysis import MatchLog, MatchRecorder, analyze
from gow_sim.commands import PlayerCommand
from gow_sim.maps import PLAYERS, load_map, map_hash
from gow_sim.match import SIM_VERSION, Match, MatchObserver, MatchResult, run_headless
from gow_sim.replay import REPLAY_SUFFIX, ReplayWriter
from gow_sim.ruleset import load_ruleset, ruleset_hash

__all__ = [
    "SCHEMA_VERSION",
    "USAGE_KEYS",
    "MatchTask",
    "build_tasks",
    "play_match",
    "play_tasks",
    "run_tournament",
    "usage",
]

SCHEMA_VERSION: Final = 1
"""``schema`` of every JSONL row; bumped when a field is removed or changes meaning."""

USAGE_KEYS: Final[tuple[str, ...]] = (
    "Move",
    "MovePlanned",
    "CancelOrder",
    "Split",
    "Merge",
    "SetMode",
    "SetStance",
    "Recruit",
    "CancelRecruit",
    "BuildBarracks",
    "UpgradeWarehouse",
    "UpgradeRoad",
    "SetFront",
    "SetRearMin",
    "Transfer",
)
"""The mechanics of ``usage``, in report order: every command but ``Forfeit``."""


def usage(log: MatchLog) -> list[dict[str, int]]:
    """Accepted commands of every player (by player id) per key of ``USAGE_KEYS``."""
    counts: list[dict[str, int]] = [{k: 0 for k in USAGE_KEYS} for _ in PLAYERS]
    for c in log.commands:
        key = "MovePlanned" if c.kind == "Move" and c.planned else c.kind
        if c.accepted and key in counts[c.player]:
            counts[c.player][key] += 1
    return counts


@dataclass(frozen=True, slots=True)
class MatchTask:
    """One match. Paths, not objects: a task is sent to a worker process."""

    map_path: str
    rules_path: str
    bots: tuple[str, str]
    """Bot names by side."""
    seed: int
    replay_dir: str | None = None
    """Folder to record a replay of this match into, ``None``: no replay."""
    params: tuple[tuple[str, str, int, int], ...] = ()
    """Parameter ranges in place of the class's ones: ``(bot, key, low, high)`` (the search,
    ``gow_bots.search``); empty in a tournament."""

    def factory(self, side: int) -> BotFactory:
        name = self.bots[side]
        ranges = {k: ParamRange(lo, hi) for b, k, lo, hi in self.params if b == name}
        return bot_factory(name, ranges)


class _Both:
    """Passes the observer calls on to several observers."""

    def __init__(self, *observers: MatchObserver) -> None:
        self._observers = observers

    def begin(self, match: Match) -> None:
        for o in self._observers:
            o.begin(match)

    def record(self, match: Match, commands: Sequence[PlayerCommand]) -> None:
        for o in self._observers:
            o.record(match, commands)


def replay_name(task_map: str, bots: tuple[str, str], seed: int) -> str:
    return f"{task_map}__{bots[0]}_vs_{bots[1]}__{seed}{REPLAY_SUFFIX}"


def play_match(task: MatchTask) -> str:
    """Play one match and return its JSONL row (no newline). Runs in a worker process."""
    mapdef = load_map(task.map_path)
    rules = load_ruleset(task.rules_path)
    controllers = [task.factory(p)(mapdef, rules, seed=task.seed, player=p) for p in PLAYERS]
    recorder = MatchRecorder()
    result: MatchResult
    if task.replay_dir is None:
        result = run_headless(mapdef, rules, controllers, observer=recorder)
    else:
        name = replay_name(mapdef.meta.name, task.bots, task.seed)
        with ReplayWriter(Path(task.replay_dir) / name) as writer:
            result = run_headless(mapdef, rules, controllers, observer=_Both(recorder, writer))
    row: dict[str, object] = {
        "schema": SCHEMA_VERSION,
        "map": mapdef.meta.name,
        "map_hash": map_hash(mapdef),
        "ruleset_hash": ruleset_hash(rules),
        "sim_version": SIM_VERSION,
        "seed": task.seed,
        "bot0": task.bots[0],
        "bot1": task.bots[1],
        "state_hash": result.state_hash,
    }
    log = recorder.log()
    row.update(analyze(log).to_json())
    row["usage"] = usage(log)
    return json.dumps(row, separators=(",", ":"), ensure_ascii=True)


def build_tasks(
    map_paths: Sequence[str | Path],
    rules_path: str | Path,
    bots: Sequence[str],
    seeds: int,
    seed_base: int = 0,
    replay_dir: str | Path | None = None,
) -> list[MatchTask]:
    """The matches of a tournament in their output order (module docstring).

    Raises ``ValueError`` for an unknown bot, no maps, no bots or ``seeds < 1``.
    """
    for name in sorted(set(bots)):
        bot_factory(name)  # an unknown bot or level fails here, not in every worker
    if not map_paths or not bots:
        raise ValueError("need at least one map and one bot")
    if seeds < 1:
        raise ValueError("--seeds must be at least 1")
    load_ruleset(rules_path)  # fail here, not in every worker
    names = sorted(set(bots))
    maps = sorted({(load_map(p).meta.name, str(p)) for p in map_paths})
    return [
        MatchTask(
            map_path,
            str(rules_path),
            (b0, b1),
            seed,
            None if replay_dir is None else str(replay_dir),
        )
        for _, map_path in maps
        for seed in range(seed_base, seed_base + seeds)
        for b0 in names
        for b1 in names
    ]


def run_tournament(
    tasks: Sequence[MatchTask], out: str | Path, jobs: int | None = None
) -> Iterator[str]:
    """Play ``tasks`` on ``jobs`` processes and write the rows to ``out`` in task order.

    Yields every row as it is written (progress for the caller). The file is written to
    ``<out>.tmp`` and moved over ``out`` when all matches are done, so an interrupted run leaves
    no half file.
    """
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(out.name + ".tmp")
    with tmp.open("w", encoding="ascii", newline="\n") as f:
        for row in play_tasks(tasks, jobs):
            f.write(row + "\n")
            yield row
    tmp.replace(out)


def play_tasks(tasks: Sequence[MatchTask], jobs: int | None = None) -> Iterator[str]:
    """The rows of ``tasks`` in task order, played on ``jobs`` processes (module docstring)."""
    workers = jobs if jobs is not None else (os.cpu_count() or 1)
    context = multiprocessing.get_context("spawn")
    with ProcessPoolExecutor(workers, mp_context=context, max_tasks_per_child=1) as pool:
        yield from pool.map(play_match, tasks, chunksize=1)
