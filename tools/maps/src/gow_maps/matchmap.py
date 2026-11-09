"""The map of one match (#884, stage 2 of #768): generate, bake, validate and preview into a folder.

The server runs ``make_map`` in a worker process at the start of an unrated match. It is the
offline ``gow-maps generate --seed N --bake`` under another map id, with the full check of
``gow-maps validate`` (the geography and the fairness included) and with the next seed when a map
fails:

1. ``generate(seed)``: the first attempt of the seed that passes the equal-access filter
   (``gow_maps.fairness``); a seed with none is skipped;
2. the map and its geography are renamed to ``map_id`` and written like ``maps/gen/``:
   ``<id>.json`` and ``src/<id>.geo.json``;
3. the bake of ``gow-maps bake``: the background ``<id>.bg.webp`` with water (the Intaglio look,
   the same code and quality as the offline bake), its thumbnail ``<id>.thumb.webp`` and the
   vector file ``geo/<id>.json``;
4. ``validate_file``: every check of ``gow-maps validate``, ``geography`` and ``fairness`` included,
   ``warehouse`` with the given ruleset; a map with a problem is removed and the next seed tried;
5. the preview ``<id>.preview.png`` over the baked ground.

The map id is not the generator's ``gen<version>-<seed>``: a per-match map must never take the id
of a stored map. Renaming changes only the noise of the bake (seeded by the name), so the seed
and the generator version still say which graph it is (the server logs the seed).
"""

import time
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from gow_maps.bake import background_path, thumb_path
from gow_maps.generate import generate
from gow_maps.geo import bake_geography, dump_geography, load_spec, spec_path, vector_path
from gow_maps.mirror import dump_map
from gow_maps.preview import preview_path, render_preview
from gow_maps.validate import ValidatorConfig, load_config, validate_file
from gow_sim.maps import parse_map
from gow_sim.ruleset import Ruleset


@dataclass(frozen=True, slots=True)
class MadeMap:
    """What ``make_map`` made, and how long each step took (seconds, wall time)."""

    map_id: str
    seed: int
    """The seed of the map that passed."""
    seeds_tried: int
    attempts: int
    """Attempts of the generator on that seed."""
    nodes: int
    generate_s: float
    bake_s: float
    validate_s: float
    preview_s: float
    """Totals over every seed tried."""


def files_of(folder: Path, map_id: str) -> list[Path]:
    """Every file ``make_map`` writes for ``map_id`` in ``folder``, the map file first."""
    path = folder / f"{map_id}.json"
    background = background_path(path)
    return [
        path,
        spec_path(path),
        background,
        thumb_path(background),
        vector_path(path),
        preview_path(path),
    ]


def make_map(
    map_id: str,
    seeds: Sequence[int],
    folder: Path,
    rules: Ruleset | None = None,
    config: ValidatorConfig | None = None,
) -> MadeMap:
    """Make the map ``map_id`` in ``folder`` from the first of ``seeds`` that passes everything.

    Raises ``ValueError`` (with the reason of every seed) if none does; ``folder`` then holds no
    file of ``map_id``.
    """
    config = load_config() if config is None else config
    path = folder / f"{map_id}.json"
    spec = spec_path(path)
    spent = {"generate": 0.0, "bake": 0.0, "validate": 0.0, "preview": 0.0}
    reasons: list[str] = []
    for tried, seed in enumerate(seeds, start=1):
        started = time.perf_counter()
        try:
            made = generate(seed, config)
        except ValueError as exc:
            spent["generate"] += time.perf_counter() - started
            reasons.append(str(exc))
            continue
        made.data["meta"]["name"] = map_id
        made.geo["map"] = map_id
        mapdef = parse_map(made.data)
        spent["generate"] += time.perf_counter() - started

        started = time.perf_counter()
        spec.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(dump_map(made.data), encoding="utf-8")
        spec.write_text(dump_geography(made.geo), encoding="utf-8")
        try:
            bake_geography(mapdef, load_spec(spec), background_path(path), vector_path(path))
        except ValueError as exc:  # a bad geography or a background over the budget
            spent["bake"] += time.perf_counter() - started
            reasons.append(f"seed {seed}: {exc}")
            remove_files(folder, map_id)
            continue
        spent["bake"] += time.perf_counter() - started

        started = time.perf_counter()
        issues = validate_file(path, config, rules)
        spent["validate"] += time.perf_counter() - started
        if issues:
            reasons.append(f"seed {seed}: " + "; ".join(str(issue) for issue in issues))
            remove_files(folder, map_id)
            continue

        started = time.perf_counter()
        render_preview(mapdef, preview_path(path), background_path(path))
        spent["preview"] += time.perf_counter() - started
        return MadeMap(
            map_id,
            seed,
            tried,
            made.attempts,
            len(mapdef.nodes),
            spent["generate"],
            spent["bake"],
            spent["validate"],
            spent["preview"],
        )
    raise ValueError(f"{map_id}: no map from {len(seeds)} seeds: " + " | ".join(reasons))


def remove_files(folder: Path, map_id: str) -> None:
    """Remove every file of ``map_id`` that ``make_map`` writes (missing ones are fine)."""
    for file in files_of(folder, map_id):
        file.unlink(missing_ok=True)
