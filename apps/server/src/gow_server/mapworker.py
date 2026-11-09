"""A per-match map in a worker process (#884): the only server module that reaches the map tools.

``gow_server.mapgen`` runs ``build`` in a ``ProcessPoolExecutor``, never in the server process:
making a map takes seconds of CPU and, while the background bakes, a lot of memory (numpy and
Pillow); the validator needs ``networkx`` and the preview ``matplotlib``. ``gow_maps.matchmap`` is
imported inside ``build``, so the server process that imports this module for ``MapJob`` and
``map_files`` loads none of them (``lint-imports`` keeps the rest of ``gow_server`` away from the
map tools).

The worker writes into a staging folder ``<folder>/.tmp-<id>/`` and moves the files into the store
with the map file last: a map file in the store always has its background, thumbnail, geography and
preview next to it, and a failed map leaves nothing behind.
"""

import contextlib
import os
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from gow_sim.ruleset import Ruleset

NICE: Final = 10
"""How much lower than the server the worker runs: on a shared core the match ticks come first."""

STAGING_PREFIX: Final = ".tmp-"


@dataclass(frozen=True, slots=True)
class MapJob:
    map_id: str
    seeds: tuple[int, ...]
    """Tried in turn until a map passes every check."""
    folder: Path
    """The store of per-match maps."""
    rules: Ruleset
    """The server's ruleset: the ``warehouse`` check of the validator (DEC-26, item 5)."""


@dataclass(frozen=True, slots=True)
class MapBuilt:
    """A map in the store and what it cost (seconds of wall time in the worker)."""

    map_id: str
    seed: int
    seeds_tried: int
    attempts: int
    nodes: int
    generate_s: float
    bake_s: float
    validate_s: float
    preview_s: float
    total_s: float


def map_files(folder: Path, map_id: str) -> list[Path]:
    """The files of a per-match map in the store, the map file first.

    The layout of ``maps/gen/`` (``gow_maps.matchmap.files_of``; a test keeps the two equal):
    ``<id>.json``, ``src/<id>.geo.json``, ``<id>.bg.webp``, ``<id>.thumb.webp``, ``geo/<id>.json``,
    ``<id>.preview.png``.
    """
    return [
        folder / f"{map_id}.json",
        folder / "src" / f"{map_id}.geo.json",
        folder / f"{map_id}.bg.webp",
        folder / f"{map_id}.thumb.webp",
        folder / "geo" / f"{map_id}.json",
        folder / f"{map_id}.preview.png",
    ]


def lower_priority() -> None:
    """Initializer of a worker process: below the server, so a busy core serves the ticks first."""
    with contextlib.suppress(OSError):  # raising the niceness needs no privilege
        os.nice(NICE)


def build(job: MapJob) -> MapBuilt:
    """Make the map of ``job`` and publish it into the store. Runs in a worker process.

    Raises ``ValueError`` if no seed of the job gives a map that passes every check.
    """
    from gow_maps.matchmap import make_map  # numpy, Pillow, networkx: in the worker only

    started = time.perf_counter()
    staging = job.folder / f"{STAGING_PREFIX}{job.map_id}"
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)
    try:
        made = make_map(job.map_id, job.seeds, staging, job.rules)
        files = map_files(staging, job.map_id)
        for source in [*files[1:], files[0]]:  # the map file last: it says the map is complete
            target = job.folder / source.relative_to(staging)
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(source, target)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return MapBuilt(
        made.map_id,
        made.seed,
        made.seeds_tried,
        made.attempts,
        made.nodes,
        made.generate_s,
        made.bake_s,
        made.validate_s,
        made.preview_s,
        time.perf_counter() - started,
    )


def remove_map(folder: Path, map_id: str) -> int:
    """Remove the files of a per-match map from the store (blocking); the number removed."""
    removed = 0
    for file in map_files(folder, map_id):
        try:
            file.unlink()
        except FileNotFoundError:
            continue
        removed += 1
    return removed
