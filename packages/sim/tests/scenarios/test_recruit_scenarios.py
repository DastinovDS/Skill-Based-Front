"""Scenario of SIM-12 (#28) on the map ``fork``: recruiting in the capital until it is full.

DEC-01 (mechanics.md, section 3): one discharged unit per city per 20 ticks for 1 CP, only with
free capacity. The capital 0 of player 0 holds 4 + e0 w2 (+1.5) + e1 w1 (+1.0) = 6.5 -> 6 units
(mechanics.md, section 9) and starts with 2. Rules pinned below; CP start at the cap 5 CP, no
regeneration in this scenario. Tick convention: step ``t`` runs with ``state.tick == t``.
"""

import dataclasses
from pathlib import Path

from gow_sim.commands import Ok, PlayerCommand, Recruit, RejectCode, apply_commands
from gow_sim.maps import load_map
from gow_sim.ruleset import (
    CapacityRules,
    RecruitLocation,
    RecruitRules,
    Ruleset,
    WidthTable,
    load_ruleset,
)
from gow_sim.state import AtNode, initial_state
from gow_sim.systems.capacity import standing_units

TESTS_DIR = Path(__file__).resolve().parents[1]
MVP0 = TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml"

_BASE = load_ruleset(MVP0)
RULES: Ruleset = dataclasses.replace(
    _BASE,
    orders=dataclasses.replace(
        _BASE.orders, cost=dataclasses.replace(_BASE.orders.cost, recruit=100)
    ),
    capacity=CapacityRules(
        attrition_ticks=30, grace_ticks=50, width_gain_centi=WidthTable((100, 150, 200, 230, 260))
    ),
    recruit=RecruitRules(cooldown_ticks=20, location=RecruitLocation.ANY_CITY),
)


def test_recruit_every_tick_in_the_capital() -> None:
    state = initial_state(load_map(TESTS_DIR / "maps" / "fork.json"), RULES)
    state.players[0].cp = 500
    accepted: list[int] = []
    codes: dict[int, RejectCode] = {}
    for t in range(1, 121):
        state.tick = t
        results, _ = apply_commands(state, RULES, [PlayerCommand(0, t, Recruit(0))])
        outcome = results[0].outcome
        if isinstance(outcome, Ok):
            accepted.append(t)
        else:
            codes[t] = outcome.code
    # One per 20 ticks from tick 1, until 2 + 4 = 6 units fill the capital.
    assert accepted == [1, 21, 41, 61]
    assert {codes[t] for t in range(2, 21)} == {RejectCode.RECRUIT_COOLDOWN}
    # Full after tick 61: a full city is reported before the cooldown.
    assert {codes[t] for t in range(62, 121)} == {RejectCode.CITY_FULL}
    assert standing_units(state, 0, 0) == 6
    recruits = [g for g in state.groups.values() if g.owner == 0 and g.id != 0]
    assert [(g.units, g.charged, g.location) for g in recruits] == [(1, 0, AtNode(0))] * 4
    assert state.players[0].cp == 100  # 5 CP - 4 x 1 CP
