"""No retreat from a fight on the wire (DEC-40, variant N, #626): the rule is public, the client
reads ``ruleset_public.combat.retreat`` to hide the retreat hints (AGENTS.md 7.1: it computes
nothing from it). No new view field and no new event field."""

from pathlib import Path

from gow_protocol.messages import ServerMsg
from gow_protocol.ruleset import RulesetPublic
from gow_sim.ruleset import Retreat, load_ruleset

ROOT = Path(__file__).resolve().parents[3]


def test_ruleset_public_carries_the_retreat_rule() -> None:
    mvp6 = RulesetPublic.from_ruleset(load_ruleset(ROOT / "rulesets" / "mvp-6.toml"))
    mvp5 = RulesetPublic.from_ruleset(load_ruleset(ROOT / "rulesets" / "mvp-5.toml"))
    assert mvp6.combat.retreat is Retreat.NONE
    assert mvp5.combat.retreat is Retreat.ROUND
    assert mvp6.model_dump(mode="json")["combat"]["retreat"] == "none"
    assert mvp5.model_dump(mode="json")["combat"]["retreat"] == "round"


def test_the_retreat_rule_is_a_closed_choice_in_the_schema() -> None:
    schema = RulesetPublic.model_json_schema()
    combat = schema["$defs"]["CombatPublic"]["properties"]["retreat"]
    ref = combat["$ref"].rsplit("/", 1)[-1]
    assert schema["$defs"][ref]["enum"] == ["round", "none"]
    assert ServerMsg is not None
