"""The display numbers the client works out from ``ruleset_public`` (ARC-C03, #482).

The client shows a few numbers before the server charges or credits them: the price of a rally
(DEC-48, item A2), when each recruit walks to its rally point and whether the CP pay it (DEC-25,
DEC-48, item H3), the CP income per second (DEC-44) and the countdown to the next VP credit
(mechanics.md, section 11). Their expected values live in one vector,
``packages/protocol/vectors/display_rules.json``, written from those rules; this test checks the
simulation against it, ``apps/client/src/match/ruleVectors.test.ts`` the client. A rule change
that moves one of them fails here first: fix the vector, then both sides.
"""

import json
from dataclasses import replace
from pathlib import Path
from typing import Any, cast

import pytest

from gow_sim.commands import PlayerCommand, Recruit, SetRallyPoint, rally_price
from gow_sim.maps import load_map
from gow_sim.match import HEADLESS_MATCH_KEY, Match
from gow_sim.ruleset import GroupOrderRules, Ruleset, Stance, StanceTable, load_ruleset
from gow_sim.state import Event
from gow_sim.view import project

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[2]
VECTOR: dict[str, Any] = json.loads(
    (ROOT / "packages" / "protocol" / "vectors" / "display_rules.json").read_text(encoding="utf-8")
)
MVP7 = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")
_NEVER = 10**6
_STILL = StanceTable(economy=_NEVER, balance=_NEVER, war=_NEVER)
QUIET = replace(
    MVP7,
    stances=replace(MVP7.stances, cp_period_ticks=_STILL, capital_period_ticks=_STILL),
    supply=replace(MVP7.supply, dispatch_ticks=_NEVER),
)
"""``mvp-7`` without CP income, production or supply dispatch (as ``test_dec48.py``)."""
MAP = load_map(TESTS_DIR / "maps" / "dec48.json")
H, R = 0, 1


def _rows(section: str) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], VECTOR[section]["rows"])


def _id(row: dict[str, Any]) -> str:
    return str(row.get("id", row.get("stance", row.get("tick"))))


def _to(m: Match, tick: int, *cmds: PlayerCommand) -> list[Event]:
    """Step ``m`` until ``m.tick == tick``, ``cmds`` applied in the last step."""
    events: list[Event] = []
    while m.tick < tick - 1:
        events += m.step()
    if m.tick < tick:
        events += m.step(cmds)
    return events


@pytest.mark.parametrize("row", _rows("rally_price"), ids=_id)
def test_rally_price(row: dict[str, Any]) -> None:
    go = MVP7.group_order
    assert go is not None
    rules = replace(
        MVP7,
        orders=replace(MVP7.orders, cost=replace(MVP7.orders.cost, move=row["move"])),
        group_order=GroupOrderRules(max_groups=go.max_groups, rally_pct=row["rally_pct"]),
    )
    assert rally_price(rules, row["n"]) == row["price"]


def test_recruit_walk_params_are_the_main_ruleset() -> None:
    params = VECTOR["recruit_walks"]["params"]
    assert params == {
        "unit_ticks": MVP7.recruit.unit_ticks,
        "rally_cost": MVP7.recruit.rally_cost,
        "recruit_cost": MVP7.orders.cost.recruit,
    }


@pytest.mark.parametrize("row", _rows("recruit_walks"), ids=_id)
def test_recruit_walks(row: dict[str, Any]) -> None:
    """The view of H at ``at`` is the row's, and the walks leave ``after`` ticks later, paid or
    not, as the row says."""
    m = Match(MAP, QUIET, HEADLESS_MATCH_KEY)
    m.state.nodes[H].has_barracks = True  # the capital, as on every map
    queued, at, view = row["queued_at"], row["at"], row["view"]
    _to(m, queued - 10, PlayerCommand(0, 0, SetRallyPoint(H, R)))
    m.state.players[0].cp = view["cp"] + row["recruits"] * MVP7.orders.cost.recruit
    recruits = [PlayerCommand(0, seq, Recruit(H)) for seq in range(row["recruits"])]
    events = _to(m, queued, *recruits)
    events += _to(m, at)
    made = sum(1 for e in events if e.kind == "recruited" and e.get("node") == H)
    gone = sum(1 for e in events if e.kind in ("rally_walk_paid", "rally_walk_no_cp"))
    seen = project(m.state, QUIET, 0, HEADLESS_MATCH_KEY)
    node = seen.nodes[H]
    assert (
        node.recruit_queue,
        node.recruit_progress,
        node.recruit_waiting,
        made - gone,
        seen.me.cp,
    ) == (view["queue"], view["progress"], view["waiting"], view["pending"], view["cp"])
    assert node.rally_point == R
    last = at + max(w["after"] for w in row["walks"])
    later = _to(m, last)
    walks = [
        (e.tick - at, e.kind == "rally_walk_paid")
        for e in later
        if e.kind in ("rally_walk_paid", "rally_walk_no_cp")
    ]
    assert walks == [(w["after"], w["paid"]) for w in row["walks"]]


@pytest.mark.parametrize("row", _rows("cp_rate"), ids=_id)
def test_cp_rate(row: dict[str, Any]) -> None:
    stance = Stance(row["stance"])
    periods = replace(MVP7.stances.cp_period_ticks, **{row["stance"]: row["period_ticks"]})
    rules: Ruleset = replace(
        MVP7,
        tick_hz=row["tick_hz"],
        cp=replace(MVP7.cp, per_period=row["per_period"], cap=10**6),
        stances=replace(MVP7.stances, cp_period_ticks=periods),
        # The periods as given: the map tempo (DEC-46) scales them per map, and the server sends
        # the scaled ones in ``ruleset_public`` (``Match.rules``), so the client divides by those.
        map_tempo=None,
    )
    assert MVP7.cp.per_period == row["per_period"]
    assert MVP7.stances.cp_period_ticks.of(stance) == row["period_ticks"]
    m = Match(MAP, rules, HEADLESS_MATCH_KEY)
    m.state.players[0].stance = stance
    before = m.state.players[0].cp
    _to(m, row["seconds"] * row["tick_hz"])
    assert m.state.players[0].cp - before == row["gain"]


def test_vp_countdown() -> None:
    rows = _rows("vp_countdown")
    period = MVP7.victory.vp_period_ticks
    assert {r["period"] for r in rows} == {period}
    m = Match(MAP, QUIET, HEADLESS_MATCH_KEY)
    end = max(r["tick"] + r["next_in"] for r in rows)
    credits = sorted({e.tick for e in _to(m, end) if e.kind == "vp_awarded"})
    for row in rows:
        nxt = next(t for t in credits if t > row["tick"])
        assert nxt - row["tick"] == row["next_in"], row
