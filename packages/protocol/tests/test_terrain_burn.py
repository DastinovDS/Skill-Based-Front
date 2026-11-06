"""The burn of a plains defender on the wire (DEC-45, #778): the key in ``ruleset_public``, the
burned charges in ``fight_round`` and ``last_round``, public to both players (DEC-24, item I2),
and the pending burn in ``FightView.mute``.

Expected values come from row 8 of the DEC-45 table (mechanics.md, section 4).
"""

from pathlib import Path

from gow_protocol.convert import event_for_player, view_to_wire
from gow_protocol.ruleset import RulesetPublic
from gow_sim.maps import PLAYERS, load_map
from gow_sim.ruleset import load_ruleset
from gow_sim.state import (
    AtNode,
    Fight,
    FightMember,
    FightRound,
    GameState,
    Group,
    Mode,
    event,
    initial_state,
)
from gow_sim.view import opaque_id, project

KEY = b"plains burn test key, 32 bytes!!"
ROOT = Path(__file__).resolve().parents[3]
RULES = load_ruleset(ROOT / "rulesets" / "mvp-4-stances.toml")
PLAIN = load_ruleset(ROOT / "rulesets" / "mvp-4.toml")
MAP = load_map(ROOT / "packages" / "sim" / "tests" / "maps" / "dec41.json")


def test_ruleset_public_carries_the_key() -> None:
    assert RulesetPublic.from_ruleset(RULES).combat.terrain_burn is True
    assert RulesetPublic.from_ruleset(PLAIN).combat.terrain_burn is False


def test_both_players_get_the_burn_of_a_round() -> None:
    """A fight event goes to both whole; the burned charges are not an exception (AGENTS.md 4.4:
    the opponent learns nothing the charged units of ``FightView`` do not show him)."""
    played = event(
        21,
        "fight_round",
        fight=4,
        node=2,
        edge=None,
        point=None,
        shots_0=1,
        shots_1=1,
        virtual_0=0,
        virtual_1=0,
        losses_0=0,
        losses_1=0,
        spent_0=1,
        spent_1=1,
        burned_0=0,
        burned_1=1,
    )
    for p in PLAYERS:
        msg = event_for_player(played, p, KEY)
        assert msg is not None
        assert msg.data["burned_0"] == 0
        assert msg.data["burned_1"] == 1
        assert msg.data["fight"] == str(opaque_id(KEY, p, 4))


def _state_in_a_fight(mute: tuple[int, int], last: FightRound | None) -> GameState:
    state = initial_state(MAP, RULES)
    node = next(iter(sorted(state.nodes)))
    gids = (state.new_id(), state.new_id())
    fid = state.new_id()
    state.fights[fid] = Fight(
        id=fid,
        node=node,
        edge=None,
        point=None,
        attacker=0,
        start=1,
        next_round=21,
        virtual=(0, 0),
        mute=mute,
        shots=(0, 0),
        losses=(0, 0),
        members={gid: FightMember(p, 2, 2) for p, gid in enumerate(gids)},
        last_round=last,
    )
    for p, gid in enumerate(gids):
        state.groups[gid] = Group(gid, p, 2, 2, Mode.ATTACK, AtNode(node), fight=fid)
    return state


def test_the_view_on_the_wire_before_and_after_the_first_round() -> None:
    before = _state_in_a_fight((0, 1), None)
    after = _state_in_a_fight((0, 0), FightRound(21, (1, 1), (0, 0), (1, 1), (0, 0), (0, 1)))
    for p in PLAYERS:
        (fight,) = view_to_wire(project(before, RULES, p, KEY)).fights
        assert fight.mute == (0, 1)
        assert fight.last_round is None
        (fight,) = view_to_wire(project(after, RULES, p, KEY)).fights
        assert fight.mute == (0, 0)
        assert fight.last_round is not None
        assert fight.last_round.burned == (0, 1)
