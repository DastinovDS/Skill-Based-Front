"""The recruit queue of a city (DEC-25, #262): table tests of the 15 worked examples.

Expected values come from DEC-25 (mechanics.md, section 3), not from the code: city X is medium
(capacity 6) with 1 standing unit of its owner, ``recruit.location = any_city``, CP 300,
``recruit.unit_ticks = 30``, ``recruit.queue_max = 3``, ``recruit.refund_started_pct = 50``,
``orders.cost.recruit = 100``, CP cap 500. These numbers are pinned in ``RULES`` (CP
regeneration off, as the examples do not count it), so balance changes of ``mvp-0.toml`` do not
break the rule tests.

Map ``dec18``: player 0 owns K = 0 (capital), 1, X = 2 and 3 (medium cities); 4 is a neutral
province between K and X (the tests give it to player 0 where a province is needed). X is
reached from K over 1 or over 4. The ticks run through the full ``Match.step``.
"""

import dataclasses
from pathlib import Path

import pytest

from gow_sim import match as match_module
from gow_sim.commands import (
    CancelRecruit,
    Command,
    Move,
    Ok,
    PlayerCommand,
    Recruit,
    Reject,
    RejectCode,
    validate,
)
from gow_sim.maps import load_map
from gow_sim.match import Match
from gow_sim.ruleset import (
    KindTable,
    RecruitLocation,
    RecruitRules,
    Ruleset,
    load_ruleset,
)
from gow_sim.state import (
    AtNode,
    Event,
    Fight,
    GameState,
    Group,
    Mode,
    Node,
    OnEdge,
    from_canonical,
    to_canonical,
)
from gow_sim.systems.capacity import change_owner

TESTS_DIR = Path(__file__).resolve().parent
MVP0 = TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml"
K, X, P = 0, 2, 4
START = 1000
"""The tick of the first ``Recruit`` of the examples."""


def _rules(location: RecruitLocation = RecruitLocation.ANY_CITY) -> Ruleset:
    base = load_ruleset(MVP0)
    return dataclasses.replace(
        base,
        cp=dataclasses.replace(base.cp, start=300, cap=500, per_period=0),
        orders=dataclasses.replace(
            base.orders, cost=dataclasses.replace(base.orders.cost, recruit=100)
        ),
        capacity=dataclasses.replace(
            base.capacity,
            by_kind=KindTable(capital=10, city_large=8, city_medium=6, city_small=4, province=3),
        ),
        recruit=RecruitRules(unit_ticks=30, queue_max=3, refund_started_pct=50, location=location),
    )


RULES = _rules()


class _Run:
    """A match on ``dec18`` at tick ``START - 1``: X holds 1 charged unit of player 0, CP 300."""

    def __init__(self, rules: Ruleset = RULES) -> None:
        self.match = Match(load_map(TESTS_DIR / "maps" / "dec18.json"), rules, bytes(range(32)))
        self.state = self.match.state
        self.state.tick = START - 1
        self.garrison = self.add(1, 1, AtNode(X))
        self.seq = 0
        self.events: list[Event] = []
        """Every event since the start of the run."""

    def add(self, units: int, charged: int, location: AtNode | OnEdge, owner: int = 0) -> int:
        state = self.state
        gid = state.new_id()
        state.groups[gid] = Group(gid, owner, units, charged, Mode.ATTACK, location)
        return gid

    def step(self, *cmds: Command, player: int = 0) -> list[Ok | Reject]:
        batch = [PlayerCommand(player, self.seq + i, cmd) for i, cmd in enumerate(cmds)]
        self.seq += len(cmds)
        self.events += self.match.step(batch)
        return [r.outcome for r in self.match.results]

    def until(self, tick: int) -> None:
        while self.state.tick < tick:
            self.step()

    def recruited(self) -> list[int]:
        return [e.tick for e in self.events if e.kind == "recruited"]

    def at_x(self) -> list[tuple[int, int]]:
        """``(units, charged)`` of player 0's groups standing in X."""
        return [
            (g.units, g.charged)
            for g in sorted(self.state.groups.values(), key=lambda g: g.id)
            if g.owner == 0 and g.location == AtNode(X)
        ]

    @property
    def cp(self) -> int:
        return self.state.players[0].cp

    @property
    def x(self) -> Node:
        return self.state.nodes[X]


# Worked examples --------------------------------------------------------------------------------


def test_example_1_one_recruit_appears_after_30_ticks_and_merges() -> None:
    run = _Run()
    assert run.step(Recruit(X)) == [Ok(cost=100)]
    assert (run.cp, run.x.recruit_queue) == (200, 1)
    run.until(START + 28)
    assert run.recruited() == []
    run.step()  # tick 1029
    assert run.recruited() == [START + 29]
    assert run.at_x() == [(2, 1)]  # merged into the group of X (DEC-20)
    assert (run.x.recruit_queue, run.x.recruit_progress) == (0, 0)


def test_example_2_three_recruits_appear_one_after_another() -> None:
    run = _Run()
    assert run.step(Recruit(X), Recruit(X), Recruit(X)) == [Ok(cost=100)] * 3
    assert (run.cp, run.x.recruit_queue) == (0, 3)
    run.until(START + 100)
    assert run.recruited() == [1029, 1059, 1089]
    assert run.at_x() == [(4, 1)]


def test_example_3_cancel_takes_the_third_not_started_unit_back_in_full() -> None:
    run = _Run()
    run.step(Recruit(X), Recruit(X), Recruit(X))
    run.until(1019)
    assert run.step(CancelRecruit(X)) == [Ok(cost=0)]  # tick 1020
    assert (run.cp, run.x.recruit_queue) == (100, 2)
    assert [e.get("cp") for e in run.events if e.kind == "recruit_cancelled"] == [100]
    run.until(1029)
    assert run.recruited() == [1029]


def test_example_4_cancel_of_the_unit_in_production_returns_half() -> None:
    run = _Run()
    run.step(Recruit(X))
    run.until(1019)
    run.step(CancelRecruit(X))  # tick 1020
    assert run.cp == 250
    assert (run.x.recruit_queue, run.x.recruit_progress) == (0, 0)
    run.until(1100)
    assert run.recruited() == []


def test_example_5_a_full_queue_rejects() -> None:
    run = _Run()
    run.step(Recruit(X), Recruit(X), Recruit(X))
    run.state.players[0].cp = 500
    assert run.step(Recruit(X)) == [Reject(RejectCode.QUEUE_FULL)]


def test_example_6_standing_units_plus_the_queue_fill_the_city() -> None:
    run = _Run()
    run.add(4, 0, AtNode(X))  # 5 units stand in X
    assert run.step(Recruit(X)) == [Ok(cost=100)]
    assert run.step(Recruit(X)) == [Reject(RejectCode.CITY_FULL)]  # 5 + 1 = 6


def test_example_7_a_ready_unit_waits_for_a_place() -> None:
    run = _Run()
    run.step(Recruit(X))
    run.until(1019)
    run.add(3, 0, AtNode(X))
    two = run.add(2, 0, AtNode(X))  # tick 1020: 6 units stand in X
    run.until(1029)
    assert run.recruited() == []
    assert (run.x.recruit_queue, run.x.recruit_progress) == (1, 30)
    view = run.match.view(0)
    assert view.nodes[X].recruit_waiting is True
    run.until(1049)
    assert run.recruited() == []
    (moved,) = run.step(Move(two, 1))  # tick 1050: the group of 2 leaves X
    assert isinstance(moved, Ok)
    assert run.recruited() == [1050]


def test_example_8_a_fight_in_the_city_pauses_the_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The fight is a fact of the example (ticks 1010..1039), set by a stand-in ``combat``."""

    def fight_in_x(state: GameState, rules: Ruleset) -> list[Event]:
        del rules
        if 1010 <= state.tick < 1040:
            zero = (0, 0)
            state.fights[999] = Fight(999, X, None, None, 1, 1010, 1020, zero, zero, zero, zero, {})
        else:
            state.fights.pop(999, None)
        return []

    systems = tuple(
        (name, fight_in_x if name == "combat" else system) for name, system in match_module.SYSTEMS
    )
    monkeypatch.setattr(match_module, "SYSTEMS", systems)
    run = _Run()
    run.step(Recruit(X))
    run.until(1009)
    assert run.x.recruit_progress == 10
    run.until(1039)
    assert run.x.recruit_progress == 10  # stands during the fight
    run.until(1100)
    assert run.recruited() == [1059]


def test_example_9_a_capture_drops_the_queue_without_a_refund() -> None:
    run = _Run()
    run.step(Recruit(X), Recruit(X), Recruit(X))
    run.until(1019)
    run.state.tick += 1  # tick 1020: the enemy takes X
    events = change_owner(run.state, X, 1)
    assert [(e.kind, dict(e.data)) for e in events if e.kind == "recruit_queue_lost"] == [
        ("recruit_queue_lost", {"player": 0, "node": X, "units": 3})
    ]
    assert (run.x.recruit_queue, run.x.recruit_progress, run.cp) == (0, 0, 0)


def test_example_10_a_cut_off_city_produces_as_usual() -> None:
    run = _Run()
    run.state.tick = 989
    for node in (1, P):  # X loses its way to the capital in tick 990
        run.state.nodes[node].owner = None
    run.until(999)
    assert run.x.cut_since == 990
    run.step(Recruit(X))
    run.until(1029)
    assert run.recruited() == [1029]


def test_example_11_not_enough_cp() -> None:
    run = _Run()
    run.state.players[0].cp = 50
    assert run.step(Recruit(X)) == [Reject(RejectCode.NOT_ENOUGH_CP)]


def test_example_12_a_refund_above_the_cap_burns() -> None:
    run = _Run()
    run.step(Recruit(X), Recruit(X))
    run.state.players[0].cp = 450
    assert run.step(CancelRecruit(X)) == [Ok(cost=0)]
    assert run.cp == 500
    assert [e.get("cp") for e in run.events if e.kind == "cp_burned"] == [50]


def test_example_13_a_province_is_not_a_city() -> None:
    run = _Run()
    run.state.nodes[P].owner = 0
    assert run.step(Recruit(P)) == [Reject(RejectCode.NOT_CITY)]


def test_example_14_the_new_unit_takes_a_charge_from_the_warehouse_next_tick() -> None:
    run = _Run()
    run.x.warehouse = 2
    run.step(Recruit(X))
    run.until(1029)
    assert run.recruited() == [1029]
    assert run.at_x() == [(2, 1)]  # it appears discharged
    run.step()  # tick 1030
    assert run.x.warehouse == 1
    assert run.at_x() == [(2, 2)]


def test_example_15_with_an_empty_warehouse_the_unit_stays_discharged() -> None:
    run = _Run()
    run.step(Recruit(X))
    run.until(1100)
    assert run.x.warehouse == 0
    assert run.at_x() == [(2, 1)]


# Further rules ---------------------------------------------------------------------------------


def test_reject_order_of_recruit() -> None:
    """DEC-25, item 11: NOT_FOUND_OR_HIDDEN, NOT_OWNER, NOT_CITY, NOT_CAPITAL, QUEUE_FULL,
    CITY_FULL, NOT_ENOUGH_CP."""
    run = _Run(_rules(RecruitLocation.CAPITAL))
    state = run.state
    rules = run.match.rules
    cases = (
        (99, RejectCode.NOT_FOUND_OR_HIDDEN),
        (10, RejectCode.NOT_OWNER),  # the enemy's
        (5, RejectCode.NOT_OWNER),  # neutral
        (X, RejectCode.NOT_CAPITAL),
    )
    for node, code in cases:
        assert validate(state, rules, 0, Recruit(node)) == Reject(code)
    state.nodes[P].owner = 0
    assert validate(state, rules, 0, Recruit(P)) == Reject(RejectCode.NOT_CITY)
    assert validate(state, rules, 0, Recruit(K)) == Ok(cost=100)


def test_cancel_recruit_rejects() -> None:
    run = _Run()
    rules, state = run.match.rules, run.state
    assert validate(state, rules, 0, CancelRecruit(99)) == Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
    assert validate(state, rules, 0, CancelRecruit(10)) == Reject(RejectCode.NOT_OWNER)
    assert validate(state, rules, 0, CancelRecruit(X)) == Reject(RejectCode.NOTHING_TO_CANCEL)


def test_cancel_of_a_queued_unit_with_no_progress_yet_returns_all() -> None:
    """The only unit of the queue has no progress yet (queued during a fight): not started."""
    run = _Run()
    run.x.recruit_queue = 1
    assert run.step(CancelRecruit(X)) == [Ok(cost=0)]
    assert run.cp == 400


def test_groups_on_edges_do_not_fill_the_city() -> None:
    run = _Run()
    run.add(5, 0, OnEdge(edge=1, from_node=1, progress=900))  # in transit into X
    assert run.step(Recruit(X)) == [Ok(cost=100)]


def test_location_capital_allows_only_the_own_capital() -> None:
    run = _Run(_rules(RecruitLocation.CAPITAL))
    assert run.step(Recruit(X), Recruit(K)) == [Reject(RejectCode.NOT_CAPITAL), Ok(cost=100)]


def test_the_queue_roundtrips_through_the_canonical_form() -> None:
    run = _Run()
    run.step(Recruit(X), Recruit(X))
    run.until(1005)
    restored = from_canonical(to_canonical(run.state))
    assert (restored.nodes[X].recruit_queue, restored.nodes[X].recruit_progress) == (2, 6)
    assert restored == run.state
