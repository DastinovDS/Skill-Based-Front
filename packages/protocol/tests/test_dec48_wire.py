"""DEC-48 on the wire (#896): the ``ack`` of a ``group_move``, the rally events, ``ruleset_public``.

Expected values come from mechanics.md, section 5, DEC-48: item B6 (the ``ack`` carries the kind,
the cost, the common arrival and one member per group of the list, a dropped one with its code;
a command without a valid member keeps its members, one rejected for its CP has none, owner
decision (7)), item I3 (``rally_point_cleared``, ``rally_walk_no_cp`` and ``rally_walk_paid``,
#934, reach their owner only)
and item I4 (``ruleset_public`` carries ``group_order`` and the rally point keys); item B4 as
amended by the owner 2026-11-10 (#913): a member split by the server says how many of its units go.
"""

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from gow_protocol.codec import decode_server, encode
from gow_protocol.convert import ack_msg, event_for_player
from gow_protocol.messages import AckMember, AckMsg, OrderKind
from gow_protocol.ruleset import GroupOrderPublic, RulesetPublic
from gow_sim import commands as sim
from gow_sim.ruleset import load_ruleset
from gow_sim.state import event
from gow_sim.view import opaque_id

KEY = b"dec-48 wire test match key, 32 b"
RULESETS = Path(__file__).resolve().parents[3] / "rulesets"


def _ack(outcome: sim.Ok | sim.Reject) -> AckMsg:
    ack = ack_msg(sim.CommandResult(0, 7, 100, outcome))
    assert decode_server(encode(ack)) == ack
    return ack


def test_an_accepted_group_move_carries_its_members() -> None:
    """Row S4: g1 departs at 100, g7 is dropped (``GROUP_ON_EDGE``), g3 departs at 110; one
    arrival at 139; 2 CP."""
    ok = sim.Ok(
        cost=200,
        arrive_tick=139,
        kind=sim.OrderKind.ATTACK,
        members=(
            sim.Member(1, (2, 6), 100, 139),
            sim.Member(7, reject=sim.RejectCode.GROUP_ON_EDGE),
            sim.Member(3, (4, 6), 110, 139),
        ),
    )
    ack = _ack(ok)
    assert (ack.kind, ack.cost, ack.arrive_tick, ack.path, ack.reject_code) == (
        OrderKind.ATTACK,
        200,
        139,
        None,
        None,
    )
    assert ack.members is not None
    assert [(m.path, m.depart_tick, m.arrive_tick, m.reject_code) for m in ack.members] == [
        ((2, 6), 100, 139, None),
        (None, None, None, "GROUP_ON_EDGE"),
        ((4, 6), 110, 139, None),
    ]


def test_a_planned_member_has_its_part_and_no_schedule() -> None:
    """Row P1: parts 2 / 1 / 1, no arrival until the departures are fixed (item F4)."""
    ok = sim.Ok(
        cost=300,
        kind=sim.OrderKind.ATTACK,
        members=tuple(
            sim.Member(g, (n, 6), bonus=b) for g, n, b in ((1, 2, 2), (2, 3, 1), (3, 4, 1))
        ),
    )
    ack = _ack(ok)
    assert ack.arrive_tick is None and ack.members is not None
    assert [(m.depart_tick, m.bonus) for m in ack.members] == [(None, 2), (None, 1), (None, 1)]


def test_no_valid_member_keeps_the_members_and_cp_short_has_none() -> None:
    """Rows S6 and S7."""
    rejected = sim.Reject(
        sim.RejectCode.STACK_LIMIT,
        (
            sim.Member(5, reject=sim.RejectCode.STACK_LIMIT),
            sim.Member(7, reject=sim.RejectCode.GROUP_ON_EDGE),
        ),
    )
    ack = _ack(rejected)
    assert ack.reject_code == "STACK_LIMIT" and ack.members is not None
    assert [m.reject_code for m in ack.members] == ["STACK_LIMIT", "GROUP_ON_EDGE"]
    short = _ack(sim.Reject(sim.RejectCode.NOT_ENOUGH_CP))
    assert (short.reject_code, short.members, short.kind) == ("NOT_ENOUGH_CP", None, None)


def test_the_rally_events_reach_their_owner_only() -> None:
    """Item I3: own-only events; the recruit of ``rally_walk_no_cp`` and of ``rally_walk_paid``
    (#934) is the owner's opaque id."""
    cleared = event(150, "rally_point_cleared", player=0, node=0, target=1)
    no_cp = event(130, "rally_walk_no_cp", player=0, group=12, node=0, target=1)
    paid = event(130, "rally_walk_paid", player=0, group=12, node=0, target=1, cost=50)
    for raw in (cleared, no_cp, paid):
        assert event_for_player(raw, 1, KEY) is None
    msg = event_for_player(cleared, 0, KEY)
    assert msg is not None and msg.data == {"player": 0, "node": 0, "target": 1}
    msg = event_for_player(no_cp, 0, KEY)
    assert msg is not None
    assert msg.data == {"player": 0, "group": str(opaque_id(KEY, 0, 12)), "node": 0, "target": 1}
    msg = event_for_player(paid, 0, KEY)
    assert msg is not None and msg.kind == "rally_walk_paid"
    assert msg.data == {
        "player": 0,
        "group": str(opaque_id(KEY, 0, 12)),
        "node": 0,
        "target": 1,
        "cost": 50,
    }


def test_ruleset_public_has_the_group_order_in_mvp7_only() -> None:
    """Item I4 and item J: on in ``mvp-7`` and its 60-second copy ``test-short`` (#896), off in
    every other kept ruleset."""
    for name in ("mvp-7", "test-short"):
        on = RulesetPublic.from_ruleset(load_ruleset(RULESETS / f"{name}.toml"))
        assert on.group_order == GroupOrderPublic(max_groups=16, rally_pct=50)
        assert (on.recruit.rally_point, on.recruit.rally_cost) == (True, 50)
    for name in ("mvp-5", "mvp-6"):
        other = RulesetPublic.from_ruleset(load_ruleset(RULESETS / f"{name}.toml"))
        assert other.group_order is None
        assert (other.recruit.rally_point, other.recruit.rally_cost) == (False, 0)


def test_a_split_member_says_how_many_of_its_units_go() -> None:
    """Row S5 (owner decision (9), #913): g5 (5 units) is split, its part of 3 goes along
    H-R-C-N (``d`` 100, arrival 179); g3 departs at 160; 2 CP. The member says 3 of 5."""
    ok = sim.Ok(
        cost=200,
        arrive_tick=179,
        kind=sim.OrderKind.ATTACK,
        members=(
            sim.Member(5, (0, 1, 4, 5), 100, 179, split_units=3, group_units=5),
            sim.Member(3, (4, 5), 160, 179),
        ),
    )
    ack = _ack(ok)
    assert ack.members is not None
    assert [(m.split_units, m.group_units) for m in ack.members] == [(3, 5), (None, None)]
    assert ack.members[0].path == (0, 1, 4, 5)


def test_a_split_member_is_well_formed() -> None:
    """``split_units`` and ``group_units`` come together, with a path, the part smaller."""
    base: dict[str, Any] = {
        "path": [0, 1],
        "depart_tick": 100,
        "arrive_tick": 139,
        "bonus": 0,
        "reject_code": None,
    }
    AckMember.model_validate_json(json.dumps({**base, "split_units": 3, "group_units": 5}))
    dropped = {"path": None, "depart_tick": None, "arrive_tick": None, "reject_code": "NO_PATH"}
    bad: list[dict[str, Any]] = [
        {**base, "split_units": 3},
        {**base, "group_units": 5},
        {**base, "split_units": 5, "group_units": 5},
        {**base, **dropped, "split_units": 3, "group_units": 5},
    ]
    for raw in bad:
        with pytest.raises(ValidationError):
            AckMember.model_validate_json(json.dumps(raw))
