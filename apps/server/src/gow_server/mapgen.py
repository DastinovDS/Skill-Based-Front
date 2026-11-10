"""A new map for every unrated invite and bot match (#884, stage 2 of #768).

The owner's decision of 2026-11-09: a private invite and a bot match without a map choice play a
map made for them at their start; the queue and rated play stay on the pool. The public lobby is
unrated too and plays a new map by default since #889. With ``GOW_QUEUE_MAPS=generated`` (#924) a
queue match gets one too, requested when its pair is found (``gow_server.matchqueue``).

``MapMaker.request`` reserves a map id (``live-`` and 12 hex digits, ``maps.MATCH_MAP_PREFIX``)
and starts the work at once; the match starts only when ``MapMaker.settle`` has the map. The work
is ``gow_server.mapworker.build`` in a ``ProcessPoolExecutor`` (spawn, like the replay frames,
``gow_server.replays``): the stage-1 generator with its equal-access filter on seeds drawn here
with ``secrets`` (outside ``gow_sim``: the map enters the match as data, AGENTS.md 4.1), the bake of
``gow-maps bake`` (background with water, thumbnail, vector file), every check of
``gow-maps validate`` and the preview. The next seed is tried when a map fails.

Load (AGENTS.md 5.1, section 12): the event loop only waits on a future. At most
``max_pending`` maps are made or wait for a worker at once, ``workers`` at a time, each worker
below the server's priority (``mapworker.NICE``). A match that cannot have its map, because the
cap is reached, the worker failed or the map took longer than ``wait_s``, plays a random pool map
instead: generation never stops a match from starting.

The store is ``<replays_dir>/maps/`` (``store_dir``), on the data volume, not ``maps/`` of the
image: the layout of ``maps/gen/`` (``mapworker.map_files``). ``gow_sim.replay`` looks for the map
of a log in ``maps/`` next to the log, so re-simulation and the frames file find a per-match map
with no change. The replay retention (``ReplayService.purge_expired``) removes a map together with
the replay of its match, and a map no match uses after ``ORPHAN_GRACE``.
"""

import asyncio
import logging
import multiprocessing
import secrets
from collections.abc import Callable
from concurrent.futures import Executor, Future, ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from dataclasses import dataclass, field
from datetime import timedelta
from enum import StrEnum
from pathlib import Path
from typing import TYPE_CHECKING, Final

from gow_server.maps import MATCH_MAP_PREFIX, MapCatalog, MapEntry, entry_of, is_match_map
from gow_server.mapworker import MapBuilt, MapJob, build, lower_priority, remove_map
from gow_sim.maps import MapFormatError, load_map
from gow_sim.ruleset import Ruleset

if TYPE_CHECKING:
    from gow_server.metrics import ServerMetrics

log = logging.getLogger("gow_server.mapgen")

STORE_SUBDIR: Final = "maps"
"""The store is this folder next to the replay logs: where ``gow_sim.replay`` looks first."""
SEEDS_PER_MAP: Final = 4
"""Seeds tried for one map. A seed fails about once in 30 (the filter, the geography check)."""
SEED_BITS: Final = 32
ORPHAN_GRACE: Final = timedelta(days=1)
"""A stored map no match row names is removed after this long (an invite that never started; the
longest an invite lives is ``GOW_INVITE_TTL_S``, 30 minutes)."""


def store_dir(replays_dir: Path) -> Path:
    return replays_dir / STORE_SUBDIR


def new_map_id() -> str:
    return f"{MATCH_MAP_PREFIX}{secrets.token_hex(6)}"


def new_seeds() -> tuple[int, ...]:
    return tuple(secrets.randbits(SEED_BITS) for _ in range(SEEDS_PER_MAP))


class MapStatus(StrEnum):
    MAKING = "making"
    READY = "ready"
    FAILED = "failed"


@dataclass(slots=True, eq=False)
class PendingMap:
    """A map being made for one match."""

    id: str
    task: "asyncio.Task[MapEntry | None]" = field(init=False, repr=False)
    abandoned: bool = False
    """Nobody waits for it any more: its files are removed when it is done."""
    job: "Future[MapBuilt] | None" = field(default=None, repr=False)

    @property
    def status(self) -> MapStatus:
        if not self.task.done():
            return MapStatus.MAKING
        if self.task.cancelled() or self.task.exception() is not None:
            return MapStatus.FAILED
        return MapStatus.READY if self.task.result() is not None else MapStatus.FAILED

    @property
    def ready(self) -> bool:
        return self.status is MapStatus.READY


Job = Callable[[MapJob], MapBuilt]
"""What a worker process runs; a module-level function (it is pickled by name)."""


class MapMaker:
    """Makes per-match maps in worker processes and reads them back from the store."""

    def __init__(
        self,
        folder: Path,
        catalog: MapCatalog,
        rules: Ruleset,
        *,
        enabled: bool = True,
        workers: int = 1,
        max_pending: int = 4,
        wait_s: float = 60.0,
        metrics: "ServerMetrics | None" = None,
        job: Job = build,
        seeds: Callable[[], tuple[int, ...]] | None = None,
        executor: Executor | None = None,
    ) -> None:
        """``job``, ``seeds`` and ``executor`` are for tests: the work, the seeds of a map
        (``new_seeds``) and the executor (a spawn ``ProcessPoolExecutor`` of ``workers``)."""
        self.folder: Final = folder
        self.catalog: Final = catalog
        self.enabled: Final = enabled
        self.wait_s: Final = wait_s
        self._rules = rules
        self._workers = workers
        self._max_pending = max_pending
        self._metrics = metrics
        self._job = job
        self._seeds = new_seeds if seeds is None else seeds
        self._pool: Executor | None = executor
        self._making: set[PendingMap] = set()

    @property
    def pending(self) -> int:
        """Maps being made or waiting for a worker."""
        return len(self._making)

    def request(self) -> PendingMap | None:
        """Start making a map for a match; ``None`` when off or ``max_pending`` maps are on the way
        (the match then plays ``fallback()``). Needs a running loop."""
        if not self.enabled:
            return None
        if len(self._making) >= self._max_pending:
            log.warning("map generation full", extra={"pending": len(self._making)})
            self._count_fallback()
            return None
        pending = PendingMap(new_map_id())
        self._making.add(pending)
        pending.task = asyncio.create_task(self._make(pending), name=f"map-{pending.id}")
        return pending

    async def settle(self, pending: PendingMap) -> MapEntry | None:
        """Wait (at most ``wait_s``) for the map; ``None`` if it failed or took too long (it is
        then abandoned: its files go when it is done)."""
        try:
            entry = await asyncio.wait_for(asyncio.shield(pending.task), self.wait_s)
        except TimeoutError:
            log.warning("map generation too slow", extra={"map_id": pending.id})
            self.discard(pending)
            entry = None
        if entry is None:
            self._count_fallback()
        return entry

    def fallback(self) -> MapEntry:
        """A random pool map, for a match whose new map did not come."""
        return secrets.choice(self.catalog.pool())

    def discard(self, pending: PendingMap) -> None:
        """Nobody will play this map (an invite dropped before its start): stop or remove it."""
        if pending.abandoned:
            return
        pending.abandoned = True
        if pending.job is not None:
            pending.job.cancel()  # still waiting for a worker: never runs
        if pending.status is MapStatus.READY:  # made already: remove its files now
            asyncio.get_running_loop().run_in_executor(None, remove_map, self.folder, pending.id)

    def load(self, map_id: str) -> MapEntry | None:
        """A made per-match map from the store, ``None`` if there is none (blocking: file I/O)."""
        if not is_match_map(map_id):
            return None
        path = self.folder / f"{map_id}.json"
        if not path.is_file():
            return None
        try:
            definition = load_map(path)
        except MapFormatError:
            log.exception("stored map is broken", extra={"map_id": map_id})
            return None
        if definition.meta.name != map_id:
            return None
        return entry_of(path, definition, generated=True, per_match=True)

    async def _make(self, pending: PendingMap) -> MapEntry | None:
        job = MapJob(pending.id, self._seeds(), self.folder, self._rules)
        try:
            pending.job = self._get_pool().submit(self._job, job)
            built = await asyncio.wrap_future(pending.job)
        except asyncio.CancelledError:
            if pending.abandoned and pending.job is not None and pending.job.cancelled():
                return None  # discarded before a worker took it
            raise
        except ValueError as exc:  # no seed gave a map that passes every check
            log.warning("no map passed", extra={"map_id": pending.id, "reason": str(exc)[:1000]})
            return None
        except BrokenProcessPool:
            self._pool = None  # a new pool for the next map
            log.error("map worker died", extra={"map_id": pending.id})
            return None
        except Exception:
            log.exception("map generation failed", extra={"map_id": pending.id})
            return None
        finally:
            self._making.discard(pending)
        if pending.abandoned:
            await asyncio.to_thread(remove_map, self.folder, pending.id)
            return None
        entry = await asyncio.to_thread(self.load, pending.id)
        if self._metrics is not None and entry is not None:
            self._metrics.maps_made += 1
        log.info(
            "map made",
            extra={
                "map_id": built.map_id,
                "seed": built.seed,
                "seeds_tried": built.seeds_tried,
                "attempts": built.attempts,
                "nodes": built.nodes,
                "generate_s": round(built.generate_s, 2),
                "bake_s": round(built.bake_s, 2),
                "validate_s": round(built.validate_s, 2),
                "preview_s": round(built.preview_s, 2),
                "total_s": round(built.total_s, 2),
            },
        )
        return entry

    def _count_fallback(self) -> None:
        if self._metrics is not None:
            self._metrics.maps_fallback += 1

    def _get_pool(self) -> Executor:
        if self._pool is None:
            # spawn: a forked child of a threaded process (uvicorn, SQLAlchemy) can deadlock.
            # One map per process: the bake leaves about 0.2 GB behind in a process that made a
            # map; a fresh one waits with a few MB and imports the map tools for its job only.
            self._pool = ProcessPoolExecutor(
                self._workers,
                mp_context=multiprocessing.get_context("spawn"),
                initializer=lower_priority,
                max_tasks_per_child=1,
            )
        return self._pool

    async def aclose(self) -> None:
        """Stop the workers; a map still being made is abandoned (its files stay as an orphan for
        the retention to remove)."""
        making = list(self._making)
        for pending in making:
            pending.abandoned = True
            if pending.job is not None:
                pending.job.cancel()
        pool, self._pool = self._pool, None
        if pool is not None:
            await asyncio.to_thread(pool.shutdown, True, cancel_futures=True)
        tasks = [pending.task for pending in making]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
