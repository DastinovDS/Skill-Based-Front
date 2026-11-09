"""The map of one match (#884): the next seed when a map fails, nothing left of a failed one."""

from pathlib import Path
from typing import Final

import pytest

from gow_maps import matchmap
from gow_maps.generate import Generated, generate
from gow_maps.matchmap import files_of, make_map
from gow_maps.validate import Issue, ValidatorConfig, validate_file
from gow_sim.maps import load_map
from gow_sim.ruleset import Ruleset

MAP_ID: Final = "live-0123456789ab"
FAST_SEED: Final = 619581435
"""Passes under ``MAP_ID`` at its second attempt: 31 nodes, the quickest map we know."""
BAD_SEED: Final = 1


def test_a_failed_seed_and_a_failed_check_give_way_to_the_next_seed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def generate_or_fail(seed: int, config: ValidatorConfig | None = None) -> Generated:
        if seed == BAD_SEED:
            raise ValueError(f"seed {seed}: no map passed the filter")
        return generate(seed, config)

    real_validate = validate_file
    calls: list[list[Path]] = []

    def validate_failing_once(
        path: Path, config: ValidatorConfig, rules: Ruleset | None = None
    ) -> list[Issue]:
        calls.append(sorted(tmp_path.rglob("*.*")))  # every file of the map is there to check
        if len(calls) == 1:
            return [Issue("geography", "a river across a road")]
        return real_validate(path, config, rules)

    monkeypatch.setattr(matchmap, "generate", generate_or_fail)
    monkeypatch.setattr(matchmap, "validate_file", validate_failing_once)

    made = make_map(MAP_ID, (BAD_SEED, FAST_SEED, FAST_SEED), tmp_path)

    assert (made.map_id, made.seed, made.seeds_tried, made.nodes) == (MAP_ID, FAST_SEED, 3, 31)
    assert len(calls) == 2
    assert calls[0] == sorted(files_of(tmp_path, MAP_ID)[:-1])  # all but the preview
    assert all(file.is_file() for file in files_of(tmp_path, MAP_ID))
    assert load_map(tmp_path / f"{MAP_ID}.json").meta.name == MAP_ID
    assert min(made.generate_s, made.bake_s, made.validate_s, made.preview_s) > 0


def test_no_seed_that_passes_leaves_no_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def unfair(path: Path, config: ValidatorConfig, rules: Ruleset | None = None) -> list[Issue]:
        return [Issue("fairness", "the fronts differ")]

    monkeypatch.setattr(matchmap, "validate_file", unfair)
    with pytest.raises(ValueError, match="fairness"):
        make_map(MAP_ID, (FAST_SEED,), tmp_path)
    assert [p for p in tmp_path.rglob("*") if p.is_file()] == []
