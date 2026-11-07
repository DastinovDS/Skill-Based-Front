"""The stances of economy v2 on the wire (DEC-44, #772): ``set_stance`` goes through under
``[stances]``, ``ruleset_public.stances`` carries the table of DEC-44, the own counters are in the
snapshot and the enemy's never are.

Expected values come from the table of DEC-44 (mechanics.md, section 6).
"""

from pathlib import Path

import pytest
from pydantic import ValidationError

from gow_protocol.convert import event_for_player, snapshot_frame, snapshot_msg, view_to_wire
from gow_protocol.ruleset import RulesetPublic
from gow_protocol.view import SelfView
from gow_sim import commands as sim
from gow_sim.maps import load_map
from gow_sim.match import Match
from gow_sim.ruleset import Stance, load_ruleset
from gow_sim.state import event

KEY = b"stances of economy v2 test key32"
ROOT = Path(__file__).resolve().parents[3]
RULES = load_ruleset(ROOT / "rulesets" / "mvp-4-stances.toml")
SUP200 = load_ruleset(ROOT / "rulesets" / "mvp-4-sup200.toml")
MAP = load_map(ROOT / "packages" / "sim" / "tests" / "maps" / "dec41.json")


def test_ruleset_public_carries_the_table() -> None:
    public = RulesetPublic.from_ruleset(RULES)
    assert public.stances is not None
    cp, capital = public.stances.cp_period_ticks, public.stances.capital_period_ticks
    assert (cp.war, cp.balance, cp.economy) == (80, 100, 200)
    assert (capital.war, capital.balance, capital.economy) == (400, 200, 100)
    assert public.orders.stance_cooldown_ticks == 0  # no cooldown under the section


def test_ruleset_public_without_the_section() -> None:
    public = RulesetPublic.from_ruleset(SUP200)
    assert public.stances is None
    assert public.orders.stance_cooldown_ticks == SUP200.orders.stance_cooldown_ticks


def test_the_snapshot_has_the_own_counters_and_no_enemy_ones() -> None:
    """Player 1 changes to War at tick 3: its counters 2 and 2 carry to 2 * 80 // 100 = 1 and
    2 * 400 // 200 = 4 (DEC-44, item 4), so at tick 10 they are 9 and 12, and player 0 holds 10
    and 10; the frame of player 0 is the same with any counters and stance of player 1."""
    match = Match(MAP, RULES, KEY)
    for tick in range(1, 11):
        cmds = [sim.PlayerCommand(1, 0, sim.SetStance(Stance.WAR))] if tick == 3 else []
        match.step(cmds)
    mine, theirs = view_to_wire(match.view(0)).me, view_to_wire(match.view(1)).me
    assert (mine.cp_ticks, mine.capital_ticks, mine.stance) == (10, 10, Stance.BALANCE)
    assert (theirs.cp_ticks, theirs.capital_ticks, theirs.stance) == (9, 12, Stance.WAR)
    frame = snapshot_frame(match.view(0))
    enemy = match.state.players[1]
    enemy.stance, enemy.cp_ticks, enemy.capital_ticks = Stance.ECONOMY, 55, 66
    assert snapshot_frame(match.view(0)) == frame
    assert snapshot_msg(match.view(0)).view.me == mine


def test_the_counters_are_null_without_the_section() -> None:
    me = view_to_wire(Match(MAP, SUP200, KEY).view(0)).me
    assert me.cp_ticks is None and me.capital_ticks is None


def test_a_stance_change_stays_with_its_owner() -> None:
    """``stance_changed`` is an own event: the enemy learns nothing of a switch."""
    e = event(40, "stance_changed", player=1, stance="war")
    msg = event_for_player(e, 1, KEY)
    assert msg is not None and msg.data == {"player": 1, "stance": "war"}
    assert event_for_player(e, 0, KEY) is None


def test_the_two_counters_go_together() -> None:
    me = view_to_wire(Match(MAP, RULES, KEY).view(0)).me.model_dump()
    me["capital_ticks"] = None
    with pytest.raises(ValidationError, match="cp_ticks and capital_ticks go together"):
        SelfView.model_validate(me)
