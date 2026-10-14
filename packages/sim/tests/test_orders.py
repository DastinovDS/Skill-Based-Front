"""Planned orders, «Защита», cancel and public intents (SIM-10, #26; DEC-08; DEC-04).

Expected values come from DEC-08 (mechanics.md, section 5): a planned move costs 2 CP instead of
1, waits 30 ticks in its node and gives +2 for the first fight; «Защита» costs 2 CP, is public at
once, its +2 is active after 30 ticks and spent in the first fight; a move drops it for free;
cancelling is free (DEC-20 replaced the 1 CP of DEC-08). Fights follow the DEC-07 table (rows
named below), forest everywhere.
Details DEC-08 leaves open: defaults of #141.

Line map ``0 - 1 - 2`` (capitals at the ends), 30 ticks per edge, so a group that leaves node 0
at tick ``t`` arrives in node 1 at ``t + 29``. Tick convention: step ``t`` runs with
``state.tick == t``; a command sent for step ``t`` is applied at its start.
"""

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
    SetMode,
    UpgradeRoad,
    apply_commands,
)
from gow_sim.maps import MapDef, parse_map
from gow_sim.ruleset import load_ruleset
from gow_sim.state import (
    AtNode,
    Event,
    GameState,
    Group,
    Intent,
    IntentKind,
    Mode,
    OnEdge,
    RoadKind,
    initial_state,
)
from gow_sim.systems.build import build
from gow_sim.systems.combat import combat
from gow_sim.systems.movement import movement
from gow_sim.systems.orders import active_bonuses, orders

TESTS_DIR = Path(__file__).resolve().parent
RULES = load_ruleset(TESTS_DIR / "rulesets" / "dec07.toml")


def _line() -> MapDef:
    nodes: list[dict[str, Any]] = [
        {
            "id": i,
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
        {"id": i, "a": i, "b": i + 1, "base_width": 1, "max_width": 2, "travel_ticks": 30}
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
        orders(state, RULES)
        self.fights += [e for e in state.events if e.kind == "fight"]
        return [r.outcome for r in results]

    def until(self, tick: int) -> None:
        while self.state.tick < tick:
            self.step()


def _public(state: GameState) -> list[tuple[object, ...]]:
    return [
        (i.owner, i.kind, i.origin, i.target, i.created_tick)
        for i in (state.intents[k] for k in sorted(state.intents))
    ]


def test_dec08_numbers_are_the_pinned_ruleset() -> None:
    o = RULES.orders
    assert (o.planned_delay_ticks, o.defense_delay_ticks) == (30, 30)
    assert (o.planned_bonus, o.defense_bonus) == (2, 2)
    assert (o.cost.move, o.cost.planned_move, o.cost.defense, o.cost.cancel) == (100, 200, 200, 0)


# Planned orders -------------------------------------------------------------------------------


def test_planned_move_costs_2_cp_and_waits_30_ticks() -> None:
    state = _state()
    a = _add(state, 0, 2, 2, 0)
    run = _Run(state)
    (ok,) = run.step((0, Move(a, 1, planned=True)))
    assert isinstance(ok, Ok) and ok.cost == 200
    assert state.players[0].cp == 100
    run.until(30)
    assert state.groups[a].location == AtNode(0)
    run.step()  # tick 31 = 1 + 30
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
    run.step((0, Move(a, 1, planned=True)))
    assert _public(state) == [(0, IntentKind.PLANNED_MOVE, 0, 1, 1)]
    run.until(60)  # leaves at 31, arrives at 60 and takes the empty node 1 (row 5)
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
    _Run(state).step((0, Move(a, 1, planned=True)))
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
        (True, 0, None),  # row 9: 2 + plan (+2) vs 2: the defence dies, node 1 is taken
        (False, 1, (2, 0)),  # row 1: 2 vs 2, no losses, the attack bounces
    ],
)
def test_planned_bonus_in_the_first_fight(
    planned: bool, owner: int, defender: tuple[int, int] | None
) -> None:
    state = _state()
    d = _add(state, 1, 2, 2, 1)
    a = _add(state, 0, 2, 2, 0)
    run = _Run(state)
    run.step((0, Move(a, 1, planned=planned)))
    run.until(90)
    assert state.nodes[1].owner == owner
    g = state.groups.get(d)
    assert (None if g is None else (g.units, g.charged)) == defender
    assert (state.groups[a].units, state.groups[a].charged) == (2, 0)


def test_planned_bonus_is_spent_in_the_first_fight_only() -> None:
    """Planned 2/2 leaves node 0 at 31; player 1 sends 1/1 from node 1 at 41. Progress after k
    of 30 ticks is k * 1000 // 30: at 50 it is 666 + 333 = 999, at 51 700 + 366 >= 1000, so they
    meet at 51 (rule 6): 4 vs 1, the bonus cancels and kills, 2/2 goes on. At 60 in node 1
    against 2/2 the bonus is gone: row 1, no losses, bounce."""
    state = _state()
    d = _add(state, 1, 2, 2, 1)
    e = _add(state, 1, 1, 1, 1)
    a = _add(state, 0, 2, 2, 0)
    run = _Run(state)
    run.step((0, Move(a, 1, planned=True)))
    run.until(40)
    run.step((1, Move(e, 0)))
    run.until(60)
    assert [(f.tick, f.get("pool_0"), f.get("pool_1")) for f in run.fights] == [
        (51, 4, 1),
        (60, 2, 2),
    ]
    assert e not in state.groups
    assert (state.groups[d].units, state.groups[d].charged) == (2, 0)
    assert state.nodes[1].owner == 1


# «Защита» -------------------------------------------------------------------------------------


def _defended(delay: int) -> tuple[_Run, int, int]:
    """Defence 2/2 in node 1 switches to «Защита» at tick 1; attack 3/3 arrives at 1 + delay."""
    state = _state()
    d = _add(state, 1, 2, 2, 1)
    a = _add(state, 0, 3, 3, 0)
    run = _Run(state)
    move_tick = delay - 28  # arrives at move_tick + 29 = 1 + delay
    if move_tick == 1:
        run.step((1, SetMode(d, Mode.DEFENSE)), (0, Move(a, 1)))
    else:
        run.step((1, SetMode(d, Mode.DEFENSE)))
        run.until(move_tick - 1)
        run.step((0, Move(a, 1)))
    run.until(1 + delay)
    return run, d, a


def test_defense_costs_2_cp_and_is_public_at_once() -> None:
    state = _state()
    d = _add(state, 1, 2, 2, 1)
    _Run(state).step((1, SetMode(d, Mode.DEFENSE)))
    assert state.players[1].cp == 100
    assert _public(state) == [(1, IntentKind.DEFENSE, 1, None, 1)]


def test_defense_bonus_is_active_after_30_ticks() -> None:
    # Row 10: 3 vs 2 + «Защита» (+2): 1 attacker dies, 2 bounce, the defence has 2 discharged.
    run, d, a = _defended(30)
    (fight,) = run.fights
    assert (fight.tick, fight.get("pool_0"), fight.get("pool_1")) == (31, 3, 4)
    assert (run.state.groups[d].units, run.state.groups[d].charged) == (2, 0)
    assert (run.state.groups[a].units, run.state.groups[a].charged) == (2, 0)


def test_defense_bonus_is_not_active_before_30_ticks() -> None:
    # Row 2: 3 vs 2 without the bonus: 1 defender dies, the attack (3, discharged) bounces.
    run, d, a = _defended(29)
    (fight,) = run.fights
    assert (fight.tick, fight.get("pool_0"), fight.get("pool_1")) == (30, 3, 2)
    assert (run.state.groups[d].units, run.state.groups[d].charged) == (1, 0)
    assert (run.state.groups[a].units, run.state.groups[a].charged) == (3, 0)


def test_defense_bonus_is_spent_in_the_first_fight_and_the_mode_holds() -> None:
    """After row 10 the defence (recharged here by hand) meets a second 2/2 wave: row 1, the
    bonus is gone (2 vs 2, no losses). Re-enabling costs 2 CP again and is a new intent."""
    run, d, _ = _defended(30)
    state = run.state
    assert state.groups[d].mode is Mode.DEFENSE
    assert _public(state) == [(1, IntentKind.DEFENSE, 1, None, 1)]
    state.groups[d].charged = 2
    b = _add(state, 0, 2, 2, 0)
    run.step((0, Move(b, 1)))
    run.until(state.tick + 29)
    assert [(f.get("pool_0"), f.get("pool_1"), f.get("losses_0")) for f in run.fights][1:] == [
        (2, 2, 0)
    ]
    state.players[1].cp = 300  # setup: no economy in this test
    run.step((1, SetMode(d, Mode.DEFENSE)))
    assert state.players[1].cp == 100
    assert _public(state) == [(1, IntentKind.DEFENSE, 1, None, state.tick)]


def test_move_drops_defense_for_free() -> None:
    state = _state()
    d = _add(state, 1, 2, 2, 1)
    run = _Run(state)
    run.step((1, SetMode(d, Mode.DEFENSE)))
    run.step((1, Move(d, 2)))
    assert state.players[1].cp == 100 - 100  # only the move
    assert state.groups[d].mode is Mode.ATTACK
    assert state.intents == {}


# Cancel ---------------------------------------------------------------------------------------


def test_cancel_planned_order_during_the_delay_is_free() -> None:
    state = _state()
    a = _add(state, 0, 2, 2, 0)
    run = _Run(state)
    run.step((0, Move(a, 1, planned=True)))
    (ok,) = run.step((0, CancelOrder(a)))
    assert isinstance(ok, Ok) and ok.cost == 0
    assert state.players[0].cp == 100  # the 2 CP of the order are not returned (DEC-20, C1)
    assert state.intents == {}
    run.until(60)
    assert state.groups[a].location == AtNode(0)
    assert state.nodes[1].owner == 1


def test_cancel_after_departure_turns_the_group_back() -> None:
    # DEC-20, C2: one step on the edge (tick 31), one step back (tick 32); bonus and intent go.
    state = _state()
    a = _add(state, 0, 2, 2, 0)
    run = _Run(state)
    run.step((0, Move(a, 1, planned=True)))
    run.until(31)
    assert isinstance(state.groups[a].location, OnEdge)
    assert run.step((0, CancelOrder(a))) == [Ok(cost=0)]
    g = state.groups[a]
    assert (g.location, g.order, g.bonus, state.intents) == (AtNode(0), None, 0, {})
    assert (g.units, g.charged) == (2, 2)  # no charges spent, unlike a bounce


def test_cancel_defense_is_free_and_drops_the_bonus() -> None:
    # After the cancel the 3/3 attack at tick 31 meets 2/2 without a bonus: row 2.
    state = _state()
    d = _add(state, 1, 2, 2, 1)
    a = _add(state, 0, 3, 3, 0)
    run = _Run(state)
    run.step((1, SetMode(d, Mode.DEFENSE)))
    _, ok = run.step((1, CancelOrder(d)), (0, Move(a, 1)))  # results in (player, seq) order
    assert isinstance(ok, Ok) and ok.cost == 0
    assert state.players[1].cp == 100
    assert state.groups[d].mode is Mode.ATTACK
    assert state.intents == {}
    run.until(31)
    assert [(f.get("pool_0"), f.get("pool_1")) for f in run.fights] == [(3, 2)]


def test_cancel_without_planned_order_or_defense_is_rejected() -> None:
    state = _state()
    a = _add(state, 0, 2, 2, 0)
    assert _Run(state).step((0, CancelOrder(a))) == [Reject(RejectCode.NOTHING_TO_CANCEL)]
    assert state.players[0].cp == 300


# Builds -----------------------------------------------------------------------------------------


def test_a_city_build_is_not_public() -> None:
    """DEC-16, item 8: a road build has no public intent."""
    state = _state()
    state.nodes[1].owner = 0  # edge 0 internal to player 0
    state.nodes[0].warehouse = 3  # the level 2 costs 3 charges (DEC-22, item 6)
    run = _Run(state)
    run.step((0, UpgradeRoad(0, 0, RoadKind.FAST)))
    assert state.nodes[0].build is not None
    assert state.intents == {}
    run.until(151)  # width 1 -> 2 at 1 + 150
    assert state.edges[0].width == 2 and state.nodes[0].build is None


def test_intent_of_a_destroyed_group_is_removed() -> None:
    # Row 3: 4 vs 2 (the «Защита» bonus is not active yet at tick 30): the defence dies.
    state = _state()
    d = _add(state, 1, 2, 2, 1)
    a = _add(state, 0, 4, 4, 0)
    run = _Run(state)
    run.step((1, SetMode(d, Mode.DEFENSE)), (0, Move(a, 1)))
    assert len(state.intents) == 1
    run.until(30)
    assert d not in state.groups
    assert state.nodes[1].owner == 0
    assert state.intents == {}
