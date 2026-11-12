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
    """``mvp-7``: the played ruleset and the one of the agents' tournaments (AGENTS.md, section 8).

    Map tempo is on: ``Match`` plays ``Match.rules`` (scaled by the map) and the bots scale the
    source rules the same way. A test of a historical rule loads the ruleset it needs itself and
    says so (``mvp-5``: free capture, retreat, leaf shift)."""
    return load_ruleset(ROOT / "rulesets" / "mvp-7.toml")


@pytest.fixture(scope="session")
def short_rules() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "test-short.toml")
