"""Shared fixtures of the bot tests: the MVP maps and rulesets."""

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
    return {name: load_map(ROOT / "maps" / f"{name}.json") for name in MVP_MAPS}


@pytest.fixture(scope="session")
def mvp_rules() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "mvp-0.toml")


@pytest.fixture(scope="session")
def mvp1_rules() -> Ruleset:
    """mvp-0 with the city development of DEC-26 (``city_upgrades.enabled``)."""
    return load_ruleset(ROOT / "rulesets" / "mvp-1.toml")


@pytest.fixture(scope="session")
def short_rules() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "test-short.toml")
