"""Map tempo on the wire (DEC-46 item 5, #885): ``welcome.ruleset_public`` is built from
``Match.rules``, so a client on a small map reads the scaled periods, never the given ones. No
new field, no protocol change."""

import dataclasses
from pathlib import Path

from gow_protocol.ruleset import RulesetPublic
from gow_sim.maps import load_map
from gow_sim.match import HEADLESS_MATCH_KEY, Match
from gow_sim.ruleset import load_ruleset

ROOT = Path(__file__).resolve().parents[3]


def test_ruleset_public_of_a_match_on_narrows_carries_the_scaled_periods() -> None:
    rules = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")
    match = Match(load_map(ROOT / "maps" / "narrows.json"), rules, HEADLESS_MATCH_KEY)
    public = RulesetPublic.from_ruleset(match.rules)
    # narrows has 29 nodes: pct 76; expected by hand from DEC-46 (0.5 CP quanta, #900:
    # Balance 50 * 100 // 76 = 65; war capital 526).
    assert public.stances.cp_period_ticks.balance == 65
    assert public.stances.capital_period_ticks.war == 526
    assert public.factory.built_period_ticks is None  # DEC-47: every factory follows the stance
    # The given ruleset is unscaled: this is what the wire must not carry.
    given = RulesetPublic.from_ruleset(match.source_rules)
    assert given.stances.cp_period_ticks.balance == 50
    assert given.stances.capital_period_ticks.war == 400


def test_the_built_period_is_scaled_too() -> None:
    """A ruleset with ``factory.built_period_ticks`` (``mvp-6``) and the map tempo of ``mvp-7``
    on narrows: 100 * 100 // 76 = 131."""
    mvp6 = load_ruleset(ROOT / "rulesets" / "mvp-6.toml")
    mvp7 = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")
    rules = dataclasses.replace(mvp6, map_tempo=mvp7.map_tempo)
    match = Match(load_map(ROOT / "maps" / "narrows.json"), rules, HEADLESS_MATCH_KEY)
    assert RulesetPublic.from_ruleset(match.rules).factory.built_period_ticks == 131
