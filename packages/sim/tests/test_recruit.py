"""Recruiting (SIM-12): DEC-01 rules, one test per rule.

Expected values come from DEC-01 (mechanics.md, section 3), not from the code: ``Recruit(node)``
in an own city with free capacity creates one discharged unit as a new group for 1 CP; at most
one unit per city per 20 ticks, otherwise ``RECRUIT_COOLDOWN``; ``recruit.location`` is
``any_city`` or ``capital``. Capacity by mechanics.md, section 9 (+1.0 / +1.5 / +2.0 / +2.3 /
+2.6). These numbers are pinned in ``RULES`` below.

The map ``fork`` (see ``test_capacity.py``): player 0 owns 0 (capital, base 4), 1 and 2 (base 2);
3 and 4 are neutral. Capacities: 0: 4 + e0 w2 (+1.5) + e1 w1 (+1.0) = 6.5 -> 6;
1: 2 + 1.5 = 3.5 -> 3; 2: 2 + 1.0 = 3. Player 0 starts with a group of 2 charged units in 0.
"""

import dataclasses
from pathlib import Path

import pytest

from gow_sim.commands import (
    Ok,
    PlayerCommand,
    Recruit,
    Reject,
    RejectCode,
    apply_commands,
    validate,
)
from gow_sim.maps import load_map
from gow_sim.ruleset import (
    CapacityRules,
    RecruitLocation,
    RecruitRules,
    Ruleset,
    WidthTable,
    load_ruleset,
)
from gow_sim.state import AtNode, GameState, Group, Mode, OnEdge, from_canonical, initial_state
from gow_sim.state import to_canonical as state_to_canonical

TESTS_DIR = Path(__file__).resolve().parent
MVP0 = TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml"


def _rules(location: RecruitLocation = RecruitLocation.ANY_CITY) -> Ruleset:
    base = load_ruleset(MVP0)
    orders = dataclasses.replace(
        base.orders, cost=dataclasses.replace(base.orders.cost, recruit=100)
    )
    return dataclasses.replace(
        base,
        orders=orders,
        capacity=CapacityRules(
            attrition_ticks=30,
            grace_ticks=50,
            width_gain_centi=WidthTable((100, 150, 200, 230, 260)),
        ),
        recruit=RecruitRules(cooldown_ticks=20, location=location),
    )


RULES = _rules()


def _fork() -> GameState:
    state = initial_state(load_map(TESTS_DIR / "maps" / "fork.json"), RULES)
    state.tick = 40
    state.players[0].cp = 500
    return state


def _add(state: GameState, owner: int, units: int, location: AtNode | OnEdge) -> Group:
    gid = state.new_id()
    group = Group(gid, owner, units, 0, Mode.ATTACK, location)
    state.groups[gid] = group
    return group


def _apply(state: GameState, *nodes: int, rules: Ruleset = RULES) -> list[Ok | Reject]:
    commands = [PlayerCommand(0, seq, Recruit(node)) for seq, node in enumerate(nodes, start=1)]
    results, _ = apply_commands(state, rules, commands)
    return [r.outcome for r in results]


def test_recruit_creates_one_discharged_unit_as_a_new_group_for_1_cp() -> None:
    state = _fork()
    before = set(state.groups)
    assert _apply(state, 0) == [Ok(cost=100)]
    (new,) = [state.groups[gid] for gid in sorted(state.groups) if gid not in before]
    assert (new.owner, new.units, new.charged, new.mode, new.location) == (
        0,
        1,
        0,
        Mode.ATTACK,
        AtNode(0),
    )
    assert state.groups[0].units == 2  # not merged into the garrison
    assert state.players[0].cp == 400


def test_recruit_in_a_full_city_is_rejected() -> None:
    state = _fork()
    _add(state, 0, 1, AtNode(1))
    _add(state, 0, 2, AtNode(1))  # 3 units: capacity 3 reached
    assert validate(state, RULES, 0, Recruit(1)) == Reject(RejectCode.CITY_FULL)


def test_recruit_takes_the_last_free_place() -> None:
    state = _fork()
    _add(state, 0, 2, AtNode(1))  # 2 of 3
    assert _apply(state, 1) == [Ok(cost=100)]
    state.tick += RULES.recruit.cooldown_ticks
    assert validate(state, RULES, 0, Recruit(1)) == Reject(RejectCode.CITY_FULL)


def test_groups_on_edges_do_not_fill_the_city() -> None:
    state = _fork()
    _add(state, 0, 2, AtNode(1))
    _add(state, 0, 5, OnEdge(edge=0, from_node=0, progress=900))  # in transit into 1
    assert validate(state, RULES, 0, Recruit(1)) == Ok(cost=100)


def test_capital_capacity_counts_the_garrison() -> None:
    state = _fork()
    _add(state, 0, 4, AtNode(0))  # 2 + 4 = 6 units: capacity 6 reached
    assert validate(state, RULES, 0, Recruit(0)) == Reject(RejectCode.CITY_FULL)


@pytest.mark.parametrize(("wait", "expected"), [(19, False), (20, True)])
def test_one_recruit_per_city_per_20_ticks(wait: int, expected: bool) -> None:
    state = _fork()
    assert _apply(state, 2) == [Ok(cost=100)]  # tick 40
    state.tick += wait
    outcome = validate(state, RULES, 0, Recruit(2))
    assert outcome == (Ok(cost=100) if expected else Reject(RejectCode.RECRUIT_COOLDOWN))


def test_second_recruit_in_the_same_city_and_tick_is_rejected() -> None:
    state = _fork()
    assert _apply(state, 0, 0) == [Ok(cost=100), Reject(RejectCode.RECRUIT_COOLDOWN)]
    assert state.players[0].cp == 400  # the rejected one costs nothing


def test_cooldown_is_per_city() -> None:
    state = _fork()
    assert _apply(state, 0, 1, 2) == [Ok(cost=100)] * 3


def test_recruit_only_in_own_cities() -> None:
    state = _fork()
    assert validate(state, RULES, 0, Recruit(3)) == Reject(RejectCode.NOT_OWNER)  # neutral
    assert validate(state, RULES, 0, Recruit(5)) == Reject(RejectCode.NOT_OWNER)  # enemy


def test_location_capital_allows_only_the_own_capital() -> None:
    rules = _rules(RecruitLocation.CAPITAL)
    state = _fork()
    assert validate(state, rules, 0, Recruit(1)) == Reject(RejectCode.NOT_CAPITAL)
    assert validate(state, rules, 0, Recruit(0)) == Ok(cost=100)
    assert validate(state, rules, 1, Recruit(7)) == Ok(cost=100)  # capital of player 1


def test_location_any_city_allows_every_own_city() -> None:
    state = _fork()
    assert [validate(state, RULES, 0, Recruit(n)) for n in (0, 1, 2)] == [Ok(cost=100)] * 3


def test_recruit_cooldown_roundtrips_through_the_canonical_form() -> None:
    state = _fork()
    _apply(state, 1)
    restored = from_canonical(state_to_canonical(state))
    assert restored.nodes[1].recruited_tick == 40
    assert restored == state
