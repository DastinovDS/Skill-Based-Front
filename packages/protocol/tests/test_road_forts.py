"""Road fortifications on the wire (DEC-43, item D, #707): the fog of the toll events (row V4 of
the table in mechanics.md, section 7), the ``fortify_road`` command and ``EdgeView.forts``.

Expected values come from DEC-43 item D (D8, D9): ``toll_paid`` goes to the payer with its own
group's opaque id, ``toll_taken`` to the owner of the fortification without any group id; an
enemy fortification carries no ``done_tick``.
"""

from pathlib import Path

import pytest
from pydantic import ValidationError

from gow_protocol.codec import decode_client, decode_server, encode
from gow_protocol.convert import (
    command_from_wire,
    event_for_player,
    opaque_to_wire,
    snapshot_msg,
)
from gow_protocol.messages import CommandMsg
from gow_protocol.ruleset import RulesetPublic
from gow_protocol.view import RoadFort
from gow_sim import commands as sim
from gow_sim.maps import load_map
from gow_sim.match import Match
from gow_sim.ruleset import load_ruleset
from gow_sim.state import AtNode, Group, Mode, event
from gow_sim.view import opaque_id, project

KEY = b"road fortifications test key 32b"
ROOT = Path(__file__).resolve().parents[3]
RULES = load_ruleset(ROOT / "rulesets" / "mvp-4.toml")
MAP = load_map(ROOT / "packages" / "sim" / "tests" / "maps" / "dec41.json")
C, D, M = 3, 4, 8
ROAD_DC, ROAD_CM = 4, 8


def test_toll_paid_goes_to_the_payer_with_its_group() -> None:
    """V4: the payer's event carries its opaque group id; the line's owner gets none of it."""
    e = event(30, "toll_paid", player=1, group=42, node=C, edge=ROAD_CM, charges=2)
    msg = event_for_player(e, 1, KEY)
    assert msg is not None
    assert msg.data == {
        "player": 1,
        "group": opaque_to_wire(opaque_id(KEY, 1, 42)),
        "node": C,
        "edge": ROAD_CM,
        "charges": 2,
    }
    assert event_for_player(e, 0, KEY) is None


def test_toll_taken_goes_to_the_owner_without_a_group() -> None:
    """V4: the owner's event has no group id, and the payer does not get it."""
    e = event(30, "toll_taken", player=0, node=C, edge=ROAD_CM, charges=2)
    msg = event_for_player(e, 0, KEY)
    assert msg is not None and msg.data == {"player": 0, "node": C, "edge": ROAD_CM, "charges": 2}
    assert event_for_player(e, 1, KEY) is None


@pytest.mark.parametrize("kind", ["road_fort_built", "road_fort_destroyed"])
def test_the_build_events_go_to_the_owner_only(kind: str) -> None:
    data: dict[str, int | bool] = {"player": 0, "node": C, "edge": ROAD_CM}
    if kind == "road_fort_destroyed":
        data["built"] = True
    e = event(150, kind, **data)
    msg = event_for_player(e, 0, KEY)
    assert msg is not None and msg.data == data
    assert event_for_player(e, 1, KEY) is None


def test_the_command_on_the_wire() -> None:
    raw = b'{"type":"command","seq":3,"cmd":{"type":"fortify_road","node":3,"edge":8}}'
    msg = decode_client(raw)
    assert isinstance(msg, CommandMsg)
    assert command_from_wire(msg.cmd) == sim.FortifyRoad(C, ROAD_CM)
    with pytest.raises(ValidationError):
        decode_client(b'{"type":"command","seq":3,"cmd":{"type":"fortify_road","node":3}}')


def test_the_public_ruleset_carries_the_fort_numbers() -> None:
    public = RulesetPublic.from_ruleset(RULES)
    assert public.fort is not None
    assert (public.fort.cost, public.fort.build_ticks) == (150, 100)
    assert (public.fort.toll_units, public.fort.toll_charges) == (3, 1)
    mvp3 = RulesetPublic.from_ruleset(load_ruleset(ROOT / "rulesets" / "mvp-3.toml"))
    assert mvp3.fort is None


def test_the_forts_of_a_snapshot() -> None:
    """V1, V3 on the wire: own ones with the tick of an own build, an enemy one without it."""
    match = Match(MAP, RULES, KEY)
    state = match.state
    state.nodes[M].owner = 1
    state.nodes[C].road_forts = {ROAD_CM: 0, ROAD_DC: 5000}
    gid = state.new_id()
    state.groups[gid] = Group(gid, 1, 1, 1, Mode.ATTACK, AtNode(M))  # a source next to C
    match.step()
    mine = snapshot_msg(project(state, RULES, 0, KEY))
    theirs = snapshot_msg(project(state, RULES, 1, KEY))
    assert decode_server(encode(mine)) == mine and decode_server(encode(theirs)) == theirs
    assert mine.view.edges[ROAD_CM].forts == (
        RoadFort(node=C, owner=0, built=True, done_tick=None),
    )
    assert mine.view.edges[ROAD_DC].forts == (
        RoadFort(node=C, owner=0, built=False, done_tick=5000),
    )
    assert theirs.view.edges[ROAD_DC].forts == (
        RoadFort(node=C, owner=0, built=False, done_tick=None),
    )


def test_a_built_fort_has_no_done_tick() -> None:
    with pytest.raises(ValidationError):
        RoadFort(node=C, owner=0, built=True, done_tick=10)
