"""Shared fixtures of the bot tests: the MVP maps and the kept rulesets (#894)."""

from pathlib import Path
from typing import Final

import pytest

from gow_sim.maps import MapDef, load_map
from gow_sim.ruleset import Ruleset, load_ruleset

ROOT: Final = Path(__file__).resolve().parents[3]
MVP_MAPS: Final = ("artery", "web", "pass")


@pytest.fixture(scope="session")
def maps() -> dict[str, MapDef]:
    """The MVP maps by name."""
    return {name: load_map(ROOT / "maps" / "fixtures" / f"{name}.json") for name in MVP_MAPS}


@pytest.fixture(scope="session")
def mvp_rules() -> Ruleset:
    """``mvp-5``: the ruleset of the agents' tournaments (AGENTS.md, section 8), no map tempo."""
    return load_ruleset(ROOT / "rulesets" / "mvp-5.toml")


@pytest.fixture(scope="session")
def mvp7_rules() -> Ruleset:
    """``mvp-7``, the main ruleset (its ``[map_tempo]`` applies only in ``Match``)."""
    return load_ruleset(ROOT / "rulesets" / "mvp-7.toml")


@pytest.fixture(scope="session")
def short_rules() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "test-short.toml")
