"""Groups and orders: auto-merge, free split, merge and cancel, the stack limit (DEC-20, #232).

Table tests of exactly the 21 worked examples of DEC-20 (mechanics.md, section 3). Expected
values come from the decision, not from the code:

- capacity by node kind (DEC-22): A (6, medium city), B (4, small city), C (8, large city),
  D and E (6), province P (3); A, B, D, E, P own, C neutral;
- roads A-B, B-C (the fastest way A-C), A-D, D-E, E-C, A-P, P-C;
- split, merge and cancel cost 0, a move 1 CP, a planned move 2 CP (DEC-08, DEC-20); a planned
  order gathers its bonus, one charge of its node's warehouse per 30 ticks (DEC-41, item 10).

Examples 1, 9 and 14 had a group in "Defense", which was removed with economy v1 (#894): example
1 keeps the merge into the standing group, 9 the merge into the smallest id, 14 is gone.

These numbers are pinned in ``RULES``. The map ``dec20`` is built below (rot180): K = 0 (capital
of 0, joined to A), A = 1, B = 2, D = 3, E = 4, P = 5, C = 6 in the centre; the mirror half is
``12 - n``. Every road is forest, 20 ticks (A-P and P-C 25), so A-B-C takes 40 ticks, A-P-C 50,
A-D-E-C 60. Steps run the systems that act here in the fixed order (``apply_commands``,
``movement``, ``combat``, ``capacity``, ``orders``): no production or recharge disturbs the
counted charges. Tick convention: step ``t`` runs with ``state.tick == t``; a command sent for
step ``t`` is applied at its start, and a group makes its first step in that tick.
"""

import dataclasses
from pathlib import Path
from typing import Any

import pytest

from gow_sim.commands import (
    CancelOrder,
    Command,
    Merge,
    Move,
    Ok,
    PlayerCommand,
    Recruit,
    Reject,
    RejectCode,
    Split,
    apply_commands,
    validate,
)
from gow_sim.maps import MapDef, parse_map
from gow_sim.ruleset import KindTable, OrderCosts, Ruleset, load_ruleset
from gow_sim.state import AtNode, Event, GameState, Group, Mode, OnEdge, initial_state
from gow_sim.systems.capacity import capacity
from gow_sim.systems.combat import combat
from gow_sim.systems.movement import movement, reachable
from gow_sim.systems.orders import active_bonuses, orders
from gow_sim.systems.recruit import recruit
from gow_sim.view import opaque_id
from gow_sim.view import reach as view_reach

TESTS_DIR = Path(__file__).resolve().parent
MVP7 = TESTS_DIR.parents[2] / "rulesets" / "mvp-7.toml"


def _rules() -> Ruleset:
    base = load_ruleset(MVP7)
    costs = OrderCosts(
        move=100,
        planned_move=200,
        cancel=0,
        split=0,
        merge=0,
        recruit=100,
        stance=0,
        barracks=0,
    )
    return dataclasses.replace(
        base,
        orders=dataclasses.replace(base.orders, plan_ticks_per_bonus=30, cost=costs),
        capacity=dataclasses.replace(
            base.capacity,
            by_kind=KindTable(capital=10, city_large=8, city_medium=6, city_small=4, province=3),
        ),
    )


RULES = _rules()
KEY = b"dec20-test-key-0123456789abcdef!"

K, A, B, D, E, P, C = range(7)
_KINDS = ["capital", "city_medium", "city_small", "city_medium", "city_medium", "province"]
_XY = [(100, 300), (250, 300), (420, 220), (300, 450), (450, 480), (400, 120)]
_ROADS = [
    (K, A, 20),
    (A, B, 20),
    (B, C, 20),
    (A, D, 20),
    (D, E, 20),
    (E, C, 20),
    (A, P, 25),
    (P, C, 25),
]
_DETOUR = [(A, D), (D, E), (E, C)]


def _mirror(n: int) -> int:
    return n if n == C else 12 - n


def _map(detour: bool = True) -> MapDef:
    """The map of the worked examples; ``detour=False``: without A-D, D-E, E-C (example 20)."""
    nodes: list[dict[str, Any]] = []
    for n in range(13):
        half = n if n <= C else _mirror(n)
        player = None if n == C else (0 if n < C else 1)
        x, y = (600, 300) if n == C else _XY[half]
        kind = "city_large" if n == C else _KINDS[half]
        nodes.append(
            {
                "id": n,
                "name": f"n{n}",
                "x": x if player != 1 else 1200 - x,
                "y": y if player != 1 else 600 - y,
                "terrain": "forest",
                "vp": 0 if kind == "province" else 1,
                "kind": kind,
                "capital_of": player if half == K and n != C else None,
                "start_owner": player,
                "start_units": 0,
                "start_charged": 0,
                "start_stock": 0,
            }
        )
    roads = [r for r in _ROADS if detour or (r[0], r[1]) not in _DETOUR]
    half_edges = len(roads)
    edges = [
        {"id": i, "a": a, "b": b, "max_level": 3, "travel_ticks": t, "border_permille": 500}
        for i, (a, b, t) in enumerate(roads)
    ]
    edges += [
        {
            "id": half_edges + i,
            "a": _mirror(a),
            "b": _mirror(b),
            "max_level": 3,
            "travel_ticks": t,
            "border_permille": 500,
        }
        for i, (a, b, t) in enumerate(roads)
    ]
    mirror_edges = {str(i): (i + half_edges) % (2 * half_edges) for i in range(2 * half_edges)}
    return parse_map(
        {
            "meta": {
                "name": "dec20",
                "version": 1,
                "symmetry": "rot180",
                "width": 1200,
                "height": 600,
            },
            "nodes": nodes,
            "edges": edges,
            "mirror": {"nodes": {str(n): _mirror(n) for n in range(13)}, "edges": mirror_edges},
        }
    )


MAP = _map()


def _state(mapdef: MapDef = MAP) -> GameState:
    state = initial_state(mapdef, RULES)
    for p in state.players.values():
        p.cp = 1000
    return state


def _add(state: GameState, units: int, charged: int, node: int, owner: int = 0) -> int:
    gid = state.new_id()
    state.groups[gid] = Group(gid, owner, units, charged, Mode.ATTACK, AtNode(node))
    return gid


class _Run:
    def __init__(self, state: GameState) -> None:
        self.state = state
        self.seq = 0
        self.events: list[Event] = []

    def step(self, *cmds: tuple[int, Command] | Command) -> list[Ok | Reject]:
        state = self.state
        state.tick += 1
        batch: list[PlayerCommand] = []
        for c in cmds:
            player, cmd = c if isinstance(c, tuple) else (0, c)
            self.seq += 1
            batch.append(PlayerCommand(player, self.seq, cmd))
        results, events = apply_commands(state, RULES, batch)
        state.events = events
        state.events += movement(state, RULES)
        state.events += combat(state, RULES, active_bonuses(state))
        state.events += capacity(state, RULES)
        state.events += recruit(state, RULES)
        state.events += orders(state, RULES)
        self.events += state.events
        return [r.outcome for r in results]

    def until(self, tick: int) -> None:
        while self.state.tick < tick:
            self.step()

    def until_event(self, kind: str, limit: int = 200) -> int:
        """Step until an event of ``kind`` (DEC-24: fights last); returns its tick."""
        for _ in range(limit):
            self.step()
            if any(e.kind == kind for e in self.state.events):
                return self.state.tick
        raise AssertionError(f"no {kind} in {limit} ticks")

    def kinds(self, kind: str, tick: int | None = None) -> list[Event]:
        return [e for e in self.events if e.kind == kind and (tick is None or e.tick == tick)]


def _counts(state: GameState, gid: int) -> tuple[int, int, Mode]:
    g = state.groups[gid]
    return g.units, g.charged, g.mode


def _validate_move(state: GameState, gid: int, dest: int) -> Ok | Reject:
    return validate(state, RULES, 0, Move(gid, dest))


# A. Auto-merge ----------------------------------------------------------------------------------


def test_dec20_example_1_arrival_joins_the_standing_group() -> None:
    # G1 3/3 stands in A; G2 2/1 arrives from D (20 ticks).
    state = _state()
    g1 = _add(state, 3, 3, A)
    g2 = _add(state, 2, 1, D)
    run = _Run(state)
    run.until(114)
    run.step(Move(g2, A))  # tick 115: arrives at tick 134
    run.until(133)
    assert g2 in state.groups
    run.step()
    assert g2 not in state.groups
    assert _counts(state, g1) == (5, 4, Mode.ATTACK)
    (merged,) = run.kinds("groups_merged", 134)
    assert (merged.get("player"), merged.get("group"), merged.get("units")) == (0, g1, 5)


def test_dec20_example_2_no_target_while_waiting_to_depart() -> None:
    state = _state()
    g1 = _add(state, 2, 2, A)
    g2 = _add(state, 2, 1, D)
    run = _Run(state)
    # tick 1: G1 waits to gather its bonus (A's warehouse is empty), G2 arrives at 20
    run.step(Move(g1, B, planned=True, bonus=1), Move(g2, A))
    run.until(20)
    assert _counts(state, g1) == (2, 2, Mode.ATTACK)
    assert state.groups[g2].location == AtNode(A)
    assert _counts(state, g2) == (2, 1, Mode.ATTACK)
    assert run.kinds("groups_merged") == []


def test_dec20_example_3_recruit_joins_the_standing_group() -> None:
    state = _state()
    g1 = _add(state, 4, 4, A)
    state.nodes[A].has_barracks = True  # setup: A recruits (DEC-26)
    run = _Run(state)
    (ok,) = run.step(Recruit(A))
    assert isinstance(ok, Ok)
    tick = run.until_event("recruited")  # from the recruit queue (DEC-25)
    assert state.tick == tick
    assert _counts(state, g1) == (5, 4, Mode.ATTACK)
    assert [g.id for g in state.groups.values() if g.owner == 0] == [g1]


def test_dec20_example_4_transit_does_not_merge() -> None:
    state = _state()
    g1 = _add(state, 2, 2, A)
    g2 = _add(state, 2, 2, D)
    run = _Run(state)
    run.step(Move(g2, B))  # D-A-B: in A at tick 20, already on A-B
    run.until(20)
    assert state.groups[g2].location == OnEdge(edge=1, from_node=A, progress=0)
    assert _counts(state, g1) == (2, 2, Mode.ATTACK)
    assert run.kinds("groups_merged") == []


def test_dec20_example_5_two_arrivals_into_an_empty_node() -> None:
    state = _state()
    g2 = _add(state, 1, 1, D)
    g3 = _add(state, 2, 0, D)
    assert g2 < g3
    run = _Run(state)
    run.step(Move(g3, A), Move(g2, A))
    run.until(20)
    assert g3 not in state.groups
    assert state.groups[g2].location == AtNode(A)
    assert _counts(state, g2) == (3, 1, Mode.ATTACK)


def test_dec20_example_6_fight_first_then_the_survivors_merge() -> None:
    # The enemy 1/1 comes from P (given to player 1 here, 25 ticks); G2 2/2 from D (20 ticks):
    # both reach A at tick 25, where G1 2/2 stands.
    state = _state()
    state.nodes[P].owner = 1
    g1 = _add(state, 2, 2, A)
    g2 = _add(state, 2, 2, D)
    enemy = _add(state, 1, 1, P, owner=1)
    run = _Run(state)
    run.step((1, Move(enemy, A)))
    run.until(5)
    run.step(Move(g2, A))
    run.until(25)
    assert run.kinds("fight_started", 25)
    end = run.until_event("fight_ended")  # DEC-24: the survivors merge when the fight ends
    fighters = {e.get("group") for e in run.kinds("fight_group", end) if e.get("player") == 0}
    assert fighters == {g1, g2}  # two groups in the fight, not one (DEC-07, rule 7)
    assert enemy not in state.groups
    assert g2 not in state.groups
    assert state.groups[g1].units == 4


def test_dec20_example_7_merge_over_capacity() -> None:
    state = _state()
    g1 = _add(state, 5, 5, A)
    g2 = _add(state, 3, 3, D)
    run = _Run(state)
    run.step(Move(g2, A))
    run.until(20)
    assert _counts(state, g1) == (8, 8, Mode.ATTACK)
    # The stack limit: only paths whose every node holds 8 units.
    assert _validate_move(state, g1, B) == Reject(RejectCode.STACK_LIMIT)
    assert _validate_move(state, g1, C) == Reject(RejectCode.STACK_LIMIT)
    ok = _validate_move(state, g1, K)  # the capital holds 10
    assert isinstance(ok, Ok) and ok.path == (A, K)
    # Over capacity 6: attrition by DEC-12 (one unit per capacity.attrition_ticks).
    run.until(20 + RULES.capacity.attrition_ticks)
    assert [e.get("node") for e in run.kinds("attrition")] == [A]
    assert state.groups[g1].units == 7


# B. Split and merge -----------------------------------------------------------------------------


def test_dec20_example_8_split_is_free_and_does_not_merge_back() -> None:
    state = _state()
    g1 = _add(state, 5, 3, A)
    run = _Run(state)
    assert run.step(Split(g1, 2)) == [Ok(cost=0)]
    new = max(state.groups)
    assert _counts(state, new) == (2, 2, Mode.ATTACK)
    assert _counts(state, g1) == (3, 1, Mode.ATTACK)
    assert state.players[0].cp == 1000
    run.until(10)
    assert (g1 in state.groups, new in state.groups) == (True, True)


def test_dec20_example_9_merge_into_the_smallest_id_is_free() -> None:
    state = _state()
    g1 = _add(state, 2, 2, A)
    g4 = _add(state, 1, 1, A)
    run = _Run(state)
    run.until(121)
    cp = state.players[0].cp
    assert run.step(Merge((g1, g4))) == [Ok(cost=0)]
    assert state.players[0].cp == cp
    assert g4 not in state.groups
    assert _counts(state, g1) == (3, 3, Mode.ATTACK)


@pytest.mark.parametrize("moving_first", [True, False])
def test_dec20_d3_merge_with_a_group_holding_a_move_order_is_rejected(moving_first: bool) -> None:
    # #435: two 4-unit groups fit B (capacity 4). `Move` plus `Merge` in one tick used to send the
    # merged 8 units to B, which `Move` refuses (STACK_LIMIT); the size must not change after the
    # check (D3), so the Merge is GROUP_BUSY.
    state = _state()
    g1 = _add(state, 4, 4, A)
    g2 = _add(state, 4, 4, A)
    assert isinstance(_validate_move(state, g1, B), Ok)
    mover = g1 if moving_first else g2
    run = _Run(state)
    moved, merged = run.step(Move(mover, B), Merge((g1, g2)))
    assert isinstance(moved, Ok)
    assert merged == Reject(RejectCode.GROUP_BUSY)
    assert state.groups[g1].units == state.groups[g2].units == 4
    run.until(40)
    assert max(g.units for g in state.groups.values() if g.location == AtNode(B)) == 4
    assert all(g.units == 4 for g in state.groups.values())


# C. Cancel --------------------------------------------------------------------------------------


def test_dec20_example_10_cancel_on_the_edge_goes_back_as_long() -> None:
    state = _state()
    g = _add(state, 2, 2, A)
    run = _Run(state)
    run.step(Move(g, B))  # tick 1: the first of 20 steps
    run.until(10)  # 10 steps made
    cp = state.players[0].cp
    assert run.step(CancelOrder(g)) == [Ok(cost=0)]  # tick 11: the first step back
    run.until(19)
    assert isinstance(state.groups[g].location, OnEdge)
    run.step()  # tick 20: the 10th step back
    assert (state.groups[g].location, state.groups[g].order) == (AtNode(A), None)
    assert state.players[0].cp == cp
    assert _counts(state, g) == (2, 2, Mode.ATTACK)


def test_dec20_example_11_cancel_during_the_delay() -> None:
    state = _state()
    g = _add(state, 2, 2, A)
    run = _Run(state)
    run.step(Move(g, B, planned=True, bonus=1))
    assert state.players[0].cp == 1000 - 200
    assert len(state.intents) == 1
    assert run.step(CancelOrder(g)) == [Ok(cost=0)]
    assert (state.groups[g].order, state.intents) == (None, {})
    assert state.players[0].cp == 1000 - 200  # the 2 CP of the order are not returned
    run.until(40)
    assert state.groups[g].location == AtNode(A)


def test_dec20_example_12_cancel_returns_to_the_start_of_the_current_edge() -> None:
    state = _state()
    g = _add(state, 2, 2, A)
    run = _Run(state)
    run.step(Move(g, C))  # A-B-C: in B at tick 20, on B-C from then on
    run.until(24)  # 4 steps on B-C
    assert state.groups[g].location == OnEdge(edge=2, from_node=B, progress=200)
    run.step(CancelOrder(g))  # tick 25
    run.until(28)  # 4 steps back
    assert (state.groups[g].location, state.groups[g].order) == (AtNode(B), None)


def test_dec20_example_13_nothing_to_cancel_after_a_fight() -> None:
    # C belongs to the enemy with 2/2 in it; 2/2 attacks over A-B-C: row 1 of DEC-07, bounce.
    state = _state()
    state.nodes[C].owner = 1
    _add(state, 2, 2, C, owner=1)
    g = _add(state, 2, 2, A)
    run = _Run(state)
    run.step(Move(g, C))
    run.until_event("fight_ended")  # DEC-24: the fight lasts its rounds
    location = state.groups[g].location
    assert isinstance(location, OnEdge) and location.back
    assert run.step(CancelOrder(g)) == [Reject(RejectCode.NOTHING_TO_CANCEL)]


# D. Stack limit ---------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("example", "units", "dest", "expected"),
    [
        (15, 5, B, RejectCode.STACK_LIMIT),
        (16, 5, C, (A, D, E, C)),
        (17, 3, C, (A, B, C)),
        (18, 3, P, (A, P)),
        (19, 4, P, RejectCode.STACK_LIMIT),
    ],
)
def test_dec20_examples_15_to_19_stack_limit(
    example: int, units: int, dest: int, expected: RejectCode | tuple[int, ...]
) -> None:
    del example
    state = _state()
    g = _add(state, units, units, A)
    outcome = _validate_move(state, g, dest)
    if isinstance(expected, RejectCode):
        assert outcome == Reject(expected)
    else:
        assert isinstance(outcome, Ok) and outcome.path == expected


def test_dec20_example_20_no_path_under_the_limit() -> None:
    state = _state(_map(detour=False))
    g = _add(state, 5, 5, A)
    assert _validate_move(state, g, C) == Reject(RejectCode.STACK_LIMIT)
    # With B and P lost as well there is no path at all: NO_PATH, as before DEC-20.
    state.nodes[B].owner = state.nodes[P].owner = 1
    assert _validate_move(state, g, C) == Reject(RejectCode.NO_PATH)


def test_dec20_example_21_cancel_home_was_taken_meanwhile() -> None:
    state = _state()
    g = _add(state, 2, 2, A)
    run = _Run(state)
    run.step(Move(g, B))
    run.until(5)  # 5 steps on A-B
    state.nodes[A].owner = 1  # A is taken meanwhile: one enemy 1/1 stands there
    _add(state, 1, 1, A, owner=1)
    run.step(CancelOrder(g))  # tick 6: 5 steps back, home at tick 10
    run.until(9)
    assert run.kinds("fight_started") == []
    run.step()
    (fight,) = run.kinds("fight_started", 10)
    assert (fight.get("node"), fight.get("attacker")) == (A, 0)


# Travel time and reachable nodes for the interface (DEC-20, D5; DEC-22, item 10) -------------


def test_arrive_tick_of_a_move_is_the_tick_of_the_arrival() -> None:
    state = _state()
    g = _add(state, 3, 3, A)
    run = _Run(state)
    run.until(4)
    (ok,) = run.step(Move(g, C))  # tick 5; A-B-C takes 40 ticks
    assert isinstance(ok, Ok)
    arrive = 5 + 40 - 1
    assert ok.arrive_tick == arrive
    run.until(arrive)
    (arrived,) = run.kinds("group_arrived")
    assert (arrived.tick, arrived.get("node")) == (arrive, C)


def test_reachable_nodes_under_the_stack_limit() -> None:
    state = _state()
    # 5 units: B (4) and P (3) do not hold the group, C only over D and E (60 ticks).
    assert reachable(state, RULES, 0, A, size=5) == {K: 20, D: 20, E: 40, C: 60}
    assert reachable(state, RULES, 0, A, size=3) == {K: 20, B: 20, D: 20, E: 40, P: 25, C: 40}


@pytest.mark.parametrize(
    ("units", "split"),
    [
        # 5 units: B (4) and P (3) do not hold the group; a split of 4 gets to B, of 3 to P.
        (5, ((B, 4), (P, 3))),
        # 7 units: only K (10) holds it; D, E and C (over D-E) take 6, B 4, P 3.
        (7, ((B, 4), (D, 6), (E, 6), (P, 3), (C, 6))),
    ],
)
def test_reach_names_the_size_that_fits_a_split_node(
    units: int, split: tuple[tuple[int, int], ...]
) -> None:
    """#762: a ``STACK_LIMIT`` node of ``reach`` carries the most units that get there (DEC-20, D:
    a group goes only through nodes whose capacity is not less than its size)."""
    state = _state()
    gid = _add(state, units, units, A)
    found = view_reach(state, RULES, 0, opaque_id(KEY, 0, gid), KEY)
    assert found is not None
    assert found.split == split
