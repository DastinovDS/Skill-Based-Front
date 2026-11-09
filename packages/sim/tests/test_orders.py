"""Planned orders, cancel and public intents (SIM-10, #26; DEC-08 with DEC-41, item 10; DEC-04).

Expected values come from DEC-08 and DEC-41, item 10 (mechanics.md, section 5): a planned move
costs as much as an ordinary one (1 CP), names its requested bonus and waits in its node; once per
30 ticks it takes one real charge of the node's warehouse and its bonus grows by 1, up to the
request; then it departs in the next tick with that bonus for its first fight; the intent is
public at once; cancelling is free (DEC-20). Fights follow the DEC-32 table (rows named below; a
fight lasts its rounds, 20 ticks each, from the contact), forest everywhere. Details DEC-08 leaves
open: defaults of #141, accepted by DEC-24 (bonuses per fight, item F1).

Line map ``0 - 1 - 2`` (capitals at the ends), 30 ticks per edge, so a group that leaves node 0
at tick ``t`` arrives in node 1 at ``t + 29``. A planned order with the bonus 2 applied at tick 1
and 2 charges in the warehouse of node 0 gathers them at ticks 31 and 61 and departs at 62. Tick
convention: step ``t`` runs with ``state.tick == t``; a command sent for step ``t`` is applied at
its start. ``RULES`` is mvp-5 with these numbers pinned.
"""

import dataclasses
from dataclasses import fields
from pathlib import Path
from typing import Any

import pytest

from gow_sim.commands import (
    CancelOrder,
    Command,
    Move,
    Ok,
    PlayerCommand,
    Reject,
    RejectCode,
    apply_commands,
)
from gow_sim.maps import MapDef, parse_map
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.state import (
    AtNode,
    Event,
    GameState,
    Group,
    Intent,
    IntentKind,
    Mode,
    OnEdge,
    initial_state,
)
from gow_sim.systems.build import build
from gow_sim.systems.combat import combat
from gow_sim.systems.movement import movement
from gow_sim.systems.orders import active_bonuses, orders

TESTS_DIR = Path(__file__).resolve().parent


def _rules() -> Ruleset:
    base = load_ruleset(TESTS_DIR.parents[2] / "rulesets" / "mvp-5.toml")
    cost = dataclasses.replace(base.orders.cost, move=100, planned_move=100, cancel=0)
    return dataclasses.replace(
        base,
        cp=dataclasses.replace(base.cp, start=300),
        orders=dataclasses.replace(base.orders, plan_ticks_per_bonus=30, cost=cost),
        combat=dataclasses.replace(base.combat, round_ticks=20, shots_per_round=1),
        capture=dataclasses.replace(base.capture, charge_cost=0),
    )


RULES = _rules()


def _line() -> MapDef:
    nodes: list[dict[str, Any]] = [
        {
            "id": i,
            "name": f"n{i}",
            "x": 10 * i,
            "y": 10,
            "terrain": "forest",
            "vp": 1,
            "kind": "capital" if i in (0, 2) else "city_large",
            "capital_of": {0: 0, 2: 1}.get(i),
            "start_owner": [0, 1, 1][i],
            "start_units": 0,
            "start_charged": 0,
            "start_stock": 0,
        }
        for i in range(3)
    ]
    edges = [
        {"id": i, "a": i, "b": i + 1, "max_level": 2, "travel_ticks": 30, "border_permille": 500}
        for i in range(2)
    ]
    return parse_map(
        {
            "meta": {"name": "l3", "version": 1, "symmetry": "rot180", "width": 20, "height": 20},
            "nodes": nodes,
            "edges": edges,
            "mirror": {"nodes": {"0": 2, "1": 1, "2": 0}, "edges": {"0": 1, "1": 0}},
        }
    )


def _state() -> GameState:
    state = initial_state(_line(), RULES)
    state.nodes[1].owner = 1  # setup: node 1 is player 1's
    return state


def _add(state: GameState, owner: int, units: int, charged: int, node: int) -> int:
    gid = state.new_id()
    state.groups[gid] = Group(gid, owner, units, charged, Mode.ATTACK, AtNode(node))
    return gid


class _Run:
    """Steps in the fixed order (systems that do not act here are left out)."""

    def __init__(self, state: GameState) -> None:
        self.state = state
        self.seq = 0
        self.fights: list[Event] = []

    def step(self, *cmds: tuple[int, Command]) -> list[Ok | Reject]:
        state = self.state
        state.tick += 1
        commands: list[PlayerCommand] = []
        for player, cmd in cmds:
            commands.append(PlayerCommand(player, self.seq, cmd))
            self.seq += 1
        results, events = apply_commands(state, RULES, commands)
        state.events = events + movement(state, RULES)
        state.events += combat(state, RULES, active_bonuses(state))
        state.events += build(state, RULES)
        state.events += orders(state, RULES)
        self.fights += [e for e in state.events if e.kind in ("fight_started", "fight_ended")]
        return [r.outcome for r in results]

    def until(self, tick: int) -> None:
        while self.state.tick < tick:
            self.step()


def _public(state: GameState) -> list[tuple[object, ...]]:
    return [
        (i.owner, i.kind, i.origin, i.target, i.created_tick)
        for i in (state.intents[k] for k in sorted(state.intents))
    ]


def test_numbers_are_the_pinned_ruleset() -> None:
    o = RULES.orders
    assert o.plan_ticks_per_bonus == 30
    assert (o.cost.move, o.cost.planned_move, o.cost.cancel) == (100, 100, 0)


def _planned(state: GameState, a: int, run: "_Run", bonus: int = 2) -> None:
    """The planned order of ``a`` from node 0 to node 1 with ``bonus`` charges waiting in the
    warehouse of node 0, applied at tick 1."""
    state.nodes[0].warehouse = bonus
    run.step((0, Move(a, 1, planned=True, bonus=bonus)))


# Planned orders -------------------------------------------------------------------------------


def test_planned_move_costs_1_cp_and_waits_until_it_gathered_its_bonus() -> None:
    state = _state()
    a = _add(state, 0, 2, 2, 0)
    run = _Run(state)
    state.nodes[0].warehouse = 2
    (ok,) = run.step((0, Move(a, 1, planned=True, bonus=2)))
    assert isinstance(ok, Ok) and ok.cost == 100
    assert state.players[0].cp == 200
    run.until(61)
    assert state.groups[a].location == AtNode(0)
    assert (state.groups[a].bonus, state.nodes[0].warehouse) == (2, 0)
    run.step()  # tick 62: departs and makes the first step
    assert isinstance(state.groups[a].location, OnEdge)


def test_normal_move_costs_1_cp_and_leaves_at_once() -> None:
    state = _state()
    a = _add(state, 0, 2, 2, 0)
    run = _Run(state)
    run.step((0, Move(a, 1)))
    assert state.players[0].cp == 200
    assert isinstance(state.groups[a].location, OnEdge)
    assert state.intents == {}  # an ordinary order is not public


def test_planned_move_is_public_at_once_and_ends_with_the_order() -> None:
    state = _state()
    a = _add(state, 0, 2, 2, 0)
    run = _Run(state)
    _planned(state, a, run)
    assert _public(state) == [(0, IntentKind.PLANNED_MOVE, 0, 1, 1)]
    state.nodes[1].owner = None  # an empty neutral node: taken on arrival
    run.until(91)  # leaves at 62, arrives at 91
    assert state.nodes[1].owner == 0
    assert state.intents == {}


def test_intent_has_no_group_id_or_size() -> None:
    assert [f.name for f in fields(Intent)] == [
        "id",
        "owner",
        "kind",
        "origin",
        "target",
        "created_tick",
    ]
    state = _state()
    a = _add(state, 0, 5, 3, 0)
    _planned(state, a, _Run(state))
    (intent,) = state.intents.values()
    assert intent.id != a
    assert (intent.owner, intent.kind, intent.origin, intent.target) == (
        0,
        IntentKind.PLANNED_MOVE,
        0,
        1,
    )


@pytest.mark.parametrize(
    ("planned", "owner", "defender"),
    [
        (True, 0, None),  # row 9: 2 + plan (+2) vs 2: the defence dies, node 1 is taken (t+80)
        (False, 1, (2, 0)),  # row 1: 2 vs 2, no losses, the attack bounces (t+40)
    ],
)
def test_planned_bonus_in_the_first_fight(
    planned: bool, owner: int, defender: tuple[int, int] | None
) -> None:
    state = _state()
    d = _add(state, 1, 2, 2, 1)
    a = _add(state, 0, 2, 2, 0)
    run = _Run(state)
    if planned:
        _planned(state, a, run)
    else:
        run.step((0, Move(a, 1)))
    run.until(180)  # contact at 91 (planned) or 30, the fight lasts 80 or 40 ticks
    assert state.nodes[1].owner == owner
    g = state.groups.get(d)
    assert (None if g is None else (g.units, g.charged)) == defender
    assert (state.groups[a].units, state.groups[a].charged) == (2, 0)


def test_planned_bonus_is_spent_in_the_first_fight_only() -> None:
    """Planned 2/2 leaves node 0 at 62 with the bonus 2; player 1 sends 1/1 from node 1 at 72.
    Progress after k of 30 ticks is k * 1000 // 30: at 81 it is 666 + 333 = 999, at 82
    700 + 366 >= 1000, so they meet at 82 (DEC-24, C2). The bonus (+2) enters the edge fight
    (F1): r1 at 102 the virtual shot cancels the enemy's, r2 at 122 the second one kills it; 2/2
    wins and goes on after the regroup at 132, 9 steps to node 1 (at 140). There against 2/2 the
    bonus is gone: row 1, no losses, the fight ends at 180 (t+40, DEC-32) and the attack
    bounces."""
    state = _state()
    d = _add(state, 1, 2, 2, 1)
    e = _add(state, 1, 1, 1, 1)
    a = _add(state, 0, 2, 2, 0)
    run = _Run(state)
    _planned(state, a, run)
    run.until(71)
    run.step((1, Move(e, 0)))
    run.until(181)
    assert [(f.kind, f.tick, f.get("node")) for f in run.fights] == [
        ("fight_started", 82, None),
        ("fight_ended", 122, None),
        ("fight_started", 140, 1),
        ("fight_ended", 180, 1),
    ]
    assert e not in state.groups
    assert (state.groups[d].units, state.groups[d].charged) == (2, 0)
    assert (state.groups[a].units, state.groups[a].charged) == (2, 0)
    assert state.nodes[1].owner == 1


# Cancel ---------------------------------------------------------------------------------------


def test_cancel_planned_order_while_it_gathers_is_free() -> None:
    state = _state()
    a = _add(state, 0, 2, 2, 0)
    run = _Run(state)
    _planned(state, a, run)
    (ok,) = run.step((0, CancelOrder(a)))
    assert isinstance(ok, Ok) and ok.cost == 0
    assert state.players[0].cp == 200  # the 1 CP of the order is not returned (DEC-20, C1)
    assert state.intents == {}
    run.until(60)
    assert state.groups[a].location == AtNode(0)
    assert state.nodes[1].owner == 1


def test_cancel_after_departure_turns_the_group_back() -> None:
    # DEC-20, C2: one step on the edge (tick 62), one step back (tick 63); bonus and intent go.
    state = _state()
    a = _add(state, 0, 2, 2, 0)
    run = _Run(state)
    _planned(state, a, run)
    run.until(62)
    assert isinstance(state.groups[a].location, OnEdge)
    assert run.step((0, CancelOrder(a))) == [Ok(cost=0)]
    g = state.groups[a]
    assert (g.location, g.order, g.bonus, state.intents) == (AtNode(0), None, 0, {})
    assert (g.units, g.charged) == (2, 2)  # no charges of the units spent, unlike a bounce


def test_cancel_without_an_order_is_rejected() -> None:
    state = _state()
    a = _add(state, 0, 2, 2, 0)
    assert _Run(state).step((0, CancelOrder(a))) == [Reject(RejectCode.NOTHING_TO_CANCEL)]
    assert state.players[0].cp == 300


# Intents --------------------------------------------------------------------------------------


def test_intent_of_a_destroyed_group_is_removed() -> None:
    # Row 3: 4 vs 2: the defence dies at 110. It waits on a planned order (an empty warehouse:
    # the plan never departs), so it has a public intent until it dies.
    state = _state()
    d = _add(state, 1, 2, 2, 1)
    a = _add(state, 0, 4, 4, 0)
    run = _Run(state)
    run.step((1, Move(d, 0, planned=True, bonus=1)), (0, Move(a, 1)))
    assert len(state.intents) == 1
    run.until(110)
    assert d not in state.groups
    assert state.nodes[1].owner == 0
    assert state.intents == {}
