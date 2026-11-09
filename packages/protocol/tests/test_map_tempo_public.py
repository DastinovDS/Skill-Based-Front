"""Map tempo on the wire (DEC-46 item 5, #885): ``welcome.ruleset_public`` is built from
``Match.rules``, so a client on a small map reads the scaled periods, never the given ones. No
new field, no protocol change."""

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
    # narrows has 29 nodes: pct 76; expected by hand from DEC-46 (131 = 100 * 100 // 76, ...).
    assert public.cp.period_ticks == 131
    assert public.factory is not None
    assert (public.factory.capital_period_ticks, public.factory.built_period_ticks) == (263, 197)
    assert public.stances is not None
    assert public.stances.cp_period_ticks.balance == 131
    assert public.stances.capital_period_ticks.war == 526
    # The given ruleset is unscaled: this is what the wire must not carry.
    given = RulesetPublic.from_ruleset(match.source_rules)
    assert given.cp.period_ticks == 100
    assert given.factory is not None and given.factory.built_period_ticks == 150
