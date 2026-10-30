"""scripts/export_howto.py (CLI-13, #72): the combat examples of the "How to play" screen."""

import importlib.util
import json
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("export_howto", ROOT / "scripts" / "export_howto.py")
assert _spec is not None and _spec.loader is not None
export_howto = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(export_howto)

REGENERATE = "mise run regen:howto"
VECTORS = {
    v["id"]: v for v in json.loads(export_howto.VECTORS_PATH.read_text(encoding="utf-8"))["vectors"]
}
BUILT: dict[str, Any] = export_howto.build()


def test_committed_file_is_up_to_date() -> None:
    """Like the protocol drift check: a rule, a ruleset number or a vector changed, regenerate."""
    committed = json.loads(export_howto.OUT_PATH.read_text(encoding="utf-8"))
    assert committed == BUILT, f"combatExamples.gen.json is out of date. Run: {REGENERATE}"


def test_the_played_ruleset_is_mvp_2() -> None:
    """The page explains the ruleset that is played (the tasks `stack` and `tournament` default)."""
    assert BUILT["ruleset"] == "mvp-2"
    mise = (ROOT / "mise.toml").read_text(encoding="utf-8")
    assert 'default="rulesets/mvp-2.toml"' in mise


@pytest.mark.parametrize("example", BUILT["examples"], ids=lambda e: e["id"])
def test_outcome_matches_the_table_of_mechanics(example: dict[str, Any]) -> None:
    """Expected values: the rows of combat.json (mechanics.md, DEC-24), not the code's output."""
    vec = VECTORS[example["vector"]]
    exp = vec["expected"]
    assert example["end"]["after_ticks"] == exp["end_after"]
    assert len(example["rounds"]) == exp["rounds"]
    for side in ("a", "b"):
        groups = exp["groups"][side]
        assert example["end"][side] == {
            "units": sum(g["units"] for g in groups),
            "charged": sum(g["charged"] for g in groups),
        }
        assert example["end"]["losses"][side] == exp["losses"][side]
    for step in exp["trace"]:
        frame = example["rounds"][step["round"] - 1]
        assert {s: frame[s]["charged"] for s in ("a", "b")} == step["charged"]
    assert example["end"]["attack_bounces"] == exp["bounce"]["a"]
    assert example["end"]["node_taken"] == (exp["node_owner_after"] == "a")
    bonus = vec["sides"]["a"]["bonus"]
    assert example["bonus_start"]["a"] == (bonus["amount"] if bonus else 0)
