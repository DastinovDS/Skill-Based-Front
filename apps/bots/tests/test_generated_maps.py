"""The smart bots on a generated map (#771): no mirror, an identity table, unequal halves.

They read the map through ``node_key`` and ``mirror_edges`` and assume equal start forces, which a
generated map keeps. A short match checks that nothing else assumes a mirror.
"""

from pathlib import Path

import pytest

from gow_bots.bots import bot_factory
from gow_sim.maps import load_map
from gow_sim.match import run_headless
from gow_sim.ruleset import load_ruleset

ROOT = Path(__file__).parents[3]
BATCH = sorted((ROOT / "maps" / "gen").glob("*.json"))


@pytest.mark.parametrize("bot", ["smart_expander", "smart_exploiter"])
def test_a_bot_plays_a_generated_map(bot: str) -> None:
    mapdef = load_map(BATCH[0])
    rules = load_ruleset(ROOT / "rulesets" / "mvp-4.toml")
    assert mapdef.meta.symmetry == "none"
    sides = [bot_factory(bot)(mapdef, rules, seed=1, player=p) for p in (0, 1)]
    result = run_headless(mapdef, rules, sides, max_ticks=600)
    assert result.ticks > 0
    assert min(result.accepted) > 0  # both sides get orders through on either side of the map
