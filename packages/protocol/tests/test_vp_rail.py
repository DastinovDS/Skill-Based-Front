"""The VP credit rail on the wire (#934; #930 item 10, owner decision 2026-11-10: P1, both sides'
gains, the timing from the ruleset period).

Expected values from DEC-03 (mechanics.md, section 11): VP are credited every
``victory.vp_period_ticks`` (300 ticks in every kept ruleset), a capital counts x3. On ``narrows``
each player starts with its capital (``vp`` 1, x3 = 3), three cities of ``vp`` 1 and a province
of ``vp`` 0: a gain of 3 + 3 = 6 each.
"""

from pathlib import Path

import pytest

from gow_protocol.codec import decode_server, encode
from gow_protocol.convert import snapshot_frame, snapshot_msg
from gow_protocol.ruleset import RulesetPublic
from gow_sim.maps import PLAYERS, load_map
from gow_sim.match import HEADLESS_MATCH_KEY, Match
from gow_sim.ruleset import load_ruleset

ROOT = Path(__file__).resolve().parents[3]


@pytest.mark.parametrize("name", ["mvp-5", "mvp-6", "mvp-7", "test-short"])
def test_ruleset_public_carries_the_credit_period(name: str) -> None:
    public = RulesetPublic.from_ruleset(load_ruleset(ROOT / "rulesets" / f"{name}.toml"))
    assert public.victory.vp_period_ticks == 300


def test_the_snapshot_carries_both_gains_for_both_players() -> None:
    mapdef = load_map(ROOT / "maps" / "narrows.json")
    match = Match(mapdef, load_ruleset(ROOT / "rulesets" / "mvp-7.toml"), HEADLESS_MATCH_KEY)
    match.step()
    for player in PLAYERS:
        view = match.view(player)
        msg = snapshot_msg(view)
        assert msg.view.vp_gain == (6, 6)
        assert decode_server(encode(msg)) == msg
        assert snapshot_frame(view).frame == encode(msg)
