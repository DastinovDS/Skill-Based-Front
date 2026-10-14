"""Groups and orders: auto-merge, free split, merge and cancel, the stack limit (DEC-20, #232).

Table tests of exactly the 21 worked examples of DEC-20 (mechanics.md, section 3). Expected
values come from the decision, not from the code:

- capacity by node kind (DEC-22): A (6, medium city), B (4, small city), C (8, large city),
  D and E (6), province P (3); A, B, D, E, P own, C neutral;
- roads A-B, B-C (the fastest way A-C), A-D, D-E, E-C, A-P, P-C;
- split, merge and cancel cost 0, a move 1 CP, a planned move 2 CP, «Защита» 2 CP; the planned
  delay and the delay of the «Защита» bonus are 30 ticks, both bonuses +2 (DEC-08, DEC-20).

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
    SetMode,
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

TESTS_DIR = Path(__file__).resolve().parent
MVP0 = TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml"


def _rules() -> Ruleset:
    base = load_ruleset(MVP0)
    costs = OrderCosts(
        move=100,
        planned_move=200,
        cancel=0,
        split=0,
        merge=0,
        attack=0,
        defense=200,
        build=0,
        recruit=100,
        stance=0,
        priority=0,
        transfer=0,
    )
    return dataclasses.replace(
        base,
        orders=dataclasses.replace(
            base.orders,
            planned_delay_ticks=30,
            defense_delay_ticks=30,
            planned_bonus=2,
            defense_bonus=2,
            cost=costs,
        ),
        capacity=dataclasses.replace(
            base.capacity,
            by_kind=KindTable(capital=10, city_large=8, city_medium=6, city_small=4, province=3),
        ),
    )


RULES = _rules()

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
        {"id": i, "a": a, "b": b, "base_width": 1, "max_width": 3, "travel_ticks": t}
        for i, (a, b, t) in enumerate(roads)
    ]
    edges += [
        {
            "id": half_edges + i,
            "a": _mirror(a),
            "b": _mirror(b),
            "base_width": 1,
            "max_width": 3,
            "travel_ticks": t,
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
        state.events += orders(state, RULES)
        self.events += state.events
        return [r.outcome for r in results]

    def until(self, tick: int) -> None:
        while self.state.tick < tick:
            self.step()

    def kinds(self, kind: str, tick: int | None = None) -> list[Event]:
        return [e for e in self.events if e.kind == kind and (tick is None or e.tick == tick)]


def _counts(state: GameState, gid: int) -> tuple[int, int, Mode]:
    g = state.groups[gid]
    return g.units, g.charged, g.mode


def _validate_move(state: GameState, gid: int, dest: int) -> Ok | Reject:
    return validate(state, RULES, 0, Move(gid, dest))


# A. Auto-merge ----------------------------------------------------------------------------------


def test_dec20_example_1_arrival_joins_the_defending_group() -> None:
    # G1 3/3 in «Защита» with an active +2 stands in A; G2 2/1 arrives from D (20 ticks).
    state = _state()
    g1 = _add(state, 3, 3, A)
    g2 = _add(state, 2, 1, D)
    run = _Run(state)
    run.step(SetMode(g1, Mode.DEFENSE))  # tick 1: the bonus is active from tick 31
    run.until(14)
    run.step(Move(g2, A))  # tick 15: arrives at tick 34
    run.until(33)
    assert g2 in state.groups
    run.step()
    assert g2 not in state.groups
    assert _counts(state, g1) == (5, 4, Mode.DEFENSE)
    assert (state.groups[g1].bonus, active_bonuses(state)[g1].amount) == (2, 2)
    assert state.groups[g1].intent in state.intents
    (merged,) = run.kinds("groups_merged", 34)
    assert (merged.get("player"), merged.get("group"), merged.get("units")) == (0, g1, 5)


def test_dec20_example_2_no_target_while_waiting_to_depart() -> None:
    state = _state()
    g1 = _add(state, 2, 2, A)
    g2 = _add(state, 2, 1, D)
    run = _Run(state)
    run.step(Move(g1, B, planned=True), Move(g2, A))  # tick 1: G1 departs at 31, G2 arrives 20
    run.until(20)
    assert _counts(state, g1) == (2, 2, Mode.ATTACK)
    assert state.groups[g2].location == AtNode(A)
    assert _counts(state, g2) == (2, 1, Mode.ATTACK)
    assert run.kinds("groups_merged") == []


def test_dec20_example_3_recruit_joins_the_standing_group() -> None:
    state = _state()
    g1 = _add(state, 4, 4, A)
    run = _Run(state)
    (ok,) = run.step(Recruit(A))
    assert isinstance(ok, Ok)
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
    fighters = {e.get("group") for e in run.kinds("fight_group", 25) if e.get("player") == 0}
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
    # Over capacity 6: attrition by #118 (one unit per capacity.attrition_ticks).
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


def test_dec20_example_9_merge_keeps_the_defense_of_the_smallest_id() -> None:
    state = _state()
    g1 = _add(state, 2, 2, A)
    g4 = _add(state, 1, 1, A)
    run = _Run(state)
    run.step(SetMode(g1, Mode.DEFENSE))
    run.until(31)  # the bonus is active
    cp = state.players[0].cp
    assert run.step(Merge((g1, g4))) == [Ok(cost=0)]
    assert state.players[0].cp == cp
    assert g4 not in state.groups
    assert _counts(state, g1) == (3, 3, Mode.DEFENSE)
    assert state.groups[g1].bonus == 2 and g1 in active_bonuses(state)


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
    run.step(Move(g, B, planned=True))
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
    run.until(40)
    location = state.groups[g].location
    assert isinstance(location, OnEdge) and location.back
    assert run.step(CancelOrder(g)) == [Reject(RejectCode.NOTHING_TO_CANCEL)]


@pytest.mark.parametrize("cmd", ["cancel", "set_attack"])
def test_dec20_example_14_cancel_defense(cmd: str) -> None:
    state = _state()
    g = _add(state, 2, 2, A)
    run = _Run(state)
    run.step(SetMode(g, Mode.DEFENSE))
    run.until(31)
    cp = state.players[0].cp
    command = CancelOrder(g) if cmd == "cancel" else SetMode(g, Mode.ATTACK)
    assert run.step(command) == [Ok(cost=0)]
    assert state.players[0].cp == cp
    assert _counts(state, g) == (2, 2, Mode.ATTACK)
    assert (state.groups[g].bonus, state.groups[g].intent, state.intents) == (0, None, {})


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
    assert run.kinds("fight") == []
    run.step()
    (fight,) = run.kinds("fight", 10)
    assert (fight.get("node"), fight.get("attacker")) == (A, 0)


# Travel time and reachable nodes for the interface (DEC-20, D5; DEC-22, item 10) -------------


@pytest.mark.parametrize("planned", [False, True])
def test_arrive_tick_of_a_move_is_the_tick_of_the_arrival(planned: bool) -> None:
    state = _state()
    g = _add(state, 3, 3, A)
    run = _Run(state)
    run.until(4)
    (ok,) = run.step(Move(g, C, planned=planned))  # tick 5; A-B-C takes 40 ticks
    assert isinstance(ok, Ok)
    arrive = 5 + (30 if planned else 0) + 40 - 1
    assert ok.arrive_tick == arrive
    run.until(arrive)
    (arrived,) = run.kinds("group_arrived")
    assert (arrived.tick, arrived.get("node")) == (arrive, C)


def test_reachable_nodes_under_the_stack_limit() -> None:
    state = _state()
    # 5 units: B (4) and P (3) do not hold the group, C only over D and E (60 ticks).
    assert reachable(state, RULES, 0, A, size=5) == {K: 20, D: 20, E: 40, C: 60}
    assert reachable(state, RULES, 0, A, size=3) == {K: 20, B: 20, D: 20, E: 40, P: 25, C: 40}
