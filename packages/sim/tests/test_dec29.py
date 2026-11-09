"""DEC-29, the cap of a planned bonus (mechanics.md, section 5): the bonus a planned order brings
into its first fight is at most the charged units of the group in the tick it departs; a group
without charged units brings 0, the order still runs. The bonus itself is the one the order
gathered (DEC-41, item 10, ``test_dec41_plans.py``); the distance bonus of DEC-29 (per edge of
the path) was removed with economy v1 (#894).

Maps: a line ``0 - 1 - ... - 6`` of player 0's cities with the capitals at the ends (player 1's
at 6), 30 ticks per edge, ruleset ``mvp-7``. The tests set up a planned order that has gathered
its bonus and departs at ``DEPART`` (the state a released plan leaves). Only the systems that act
here run (commands, movement, combat, orders), so the charged units change only where a test
changes them.
"""

from dataclasses import fields
from pathlib import Path
from typing import Any

import pytest

from gow_sim.commands import Command, Move, Ok, PlayerCommand, Reject, apply_commands
from gow_sim.maps import MapDef, parse_map
from gow_sim.ruleset import load_ruleset
from gow_sim.state import AtNode, GameState, Group, IntentKind, Mode, OnEdge, Order, initial_state
from gow_sim.systems.combat import combat
from gow_sim.systems.movement import movement
from gow_sim.systems.orders import active_bonuses, orders, set_intent
from gow_sim.view import IntentView, OrderView, opaque_id, project

ROOT = Path(__file__).resolve().parents[3]
RULES = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")
N = 7
DEPART = 31
"""The departure tick of the planned orders the tests set up."""
KEY = bytes(range(32))


def _map(edges: list[tuple[int, int, int]] | None = None) -> MapDef:
    nodes: list[dict[str, Any]] = [
        {
            "id": i,
            "name": f"n{i}",
            "x": 10 * i,
            "y": 10,
            "terrain": "forest",
            "vp": 1,
            "kind": "capital" if i in (0, N - 1) else "city_large",
            "capital_of": {0: 0, N - 1: 1}.get(i),
            "start_owner": 1 if i == N - 1 else 0,
            "start_units": 0,
            "start_charged": 0,
            "start_stock": 0,
        }
        for i in range(N)
    ]
    pairs = edges or [(i, i + 1, 30) for i in range(N - 1)]
    edge_list = [
        {"id": k, "a": a, "b": b, "max_level": 3, "travel_ticks": t, "border_permille": 500}
        for k, (a, b, t) in enumerate(pairs)
    ]
    mirror_nodes = {str(i): N - 1 - i for i in range(N)}
    index = {(a, b): k for k, (a, b, _) in enumerate(pairs)}
    mirror_edges: dict[str, int] = {}
    for k, (a, b, _) in enumerate(pairs):
        ma, mb = N - 1 - a, N - 1 - b
        mirror_edges[str(k)] = index.get((ma, mb), index.get((mb, ma), k))
    return parse_map(
        {
            "meta": {"name": "d29", "version": 1, "symmetry": "rot180", "width": 80, "height": 20},
            "nodes": nodes,
            "edges": edge_list,
            "mirror": {"nodes": mirror_nodes, "edges": mirror_edges},
        }
    )


def _add(state: GameState, owner: int, units: int, charged: int, node: int) -> int:
    gid = state.new_id()
    state.groups[gid] = Group(gid, owner, units, charged, Mode.ATTACK, AtNode(node))
    return gid


class _Run:
    def __init__(self, state: GameState) -> None:
        self.state = state
        self.seq = 0

    def step(self, *cmds: tuple[int, Command]) -> list[Ok | Reject]:
        state = self.state
        state.tick += 1
        commands = [PlayerCommand(p, self.seq + i, c) for i, (p, c) in enumerate(cmds)]
        self.seq += len(cmds)
        results, events = apply_commands(state, RULES, commands)
        state.events = events + movement(state, RULES)
        state.events += combat(state, RULES, active_bonuses(state))
        state.events += orders(state, RULES)
        return [r.outcome for r in results]

    def until(self, tick: int) -> None:
        while self.state.tick < tick:
            self.step()


def _planned(state: GameState, gid: int, dest: int, bonus: int) -> None:
    """Setup: ``gid`` holds a planned order to ``dest`` along the line with ``bonus`` gathered,
    departing at ``DEPART`` (DEC-41, item 10), and its public intent."""
    group = state.groups[gid]
    assert isinstance(group.location, AtNode)
    here = group.location.node
    step = 1 if dest > here else -1
    path = tuple(range(here + step, dest + step, step))
    group.order = Order(path, True, DEPART)
    group.bonus = bonus
    group.bonus_tick = DEPART
    set_intent(state, group, IntentKind.PLANNED_MOVE, dest)


@pytest.mark.parametrize(
    ("at_departure", "bonus"),
    [
        (3, 3),  # the gathered 3 within 3 charged units
        (1, 1),  # lost charges before the departure (a build, a toll, starvation): 1
        (0, 0),  # no charged unit left: 0, the order still runs
    ],
)
def test_the_cap_is_measured_in_the_departure_tick(at_departure: int, bonus: int) -> None:
    """ "When the cap is measured": by the charged units in the departure tick. The test sets the
    charged units as a payment or starvation would before the departure."""
    state = initial_state(_map(), RULES)
    gid = _add(state, 0, 3, 3, 0)
    _planned(state, gid, 3, 3)
    run = _Run(state)
    run.until(DEPART - 1)
    state.groups[gid].charged = at_departure
    run.step()
    assert isinstance(state.groups[gid].location, OnEdge)
    assert state.groups[gid].bonus == bonus


def test_the_capped_bonus_enters_the_fight() -> None:
    """A 3/3 planned strike with a bonus of 2 from node 0 on player 1's node 2: the bonus enters
    the fight as the virtual shots of the attacker (DEC-24, item F1) and leaves the group."""
    state = initial_state(_map(), RULES)
    state.nodes[2].owner = 1  # setup: node 2 is player 1's, held by 2/2
    _add(state, 1, 2, 2, 2)
    gid = _add(state, 0, 3, 3, 0)
    _planned(state, gid, 2, 2)
    run = _Run(state)
    run.until(DEPART)
    assert state.groups[gid].bonus == 2
    while state.groups[gid].fight is None:
        run.step()
    (fight,) = state.fights.values()
    assert fight.virtual == (2, 0)
    assert state.groups[gid].bonus == 0  # it left the group: it burns with the fight


# The own view and the fog ------------------------------------------------------------------------


def _own_order(state: GameState, gid: int) -> OrderView:
    view = project(state, RULES, 0, KEY)
    (group,) = (g for g in view.groups if g.id == opaque_id(KEY, 0, gid))
    assert group.order is not None
    return group.order


def test_the_own_order_shows_the_capped_bonus() -> None:
    """``OrderView.bonus``: the bonus at most the charged units now (the cap of the departure
    tick taken in advance); a normal order shows 0."""
    state = initial_state(_map(), RULES)
    gid = _add(state, 0, 3, 1, 0)
    plain = _add(state, 0, 2, 2, 1)
    _planned(state, gid, 3, 3)
    run = _Run(state)
    run.step((0, Move(plain, 2)))
    assert _own_order(state, gid).bonus == 1
    assert _own_order(state, plain).bonus == 0
    state.groups[gid].charged = 3  # as a recharge would before the departure
    assert _own_order(state, gid).bonus == 3
    run.until(DEPART)
    assert isinstance(state.groups[gid].location, OnEdge)
    assert state.groups[gid].bonus == 3
    assert _own_order(state, gid).bonus == 3


def test_fog_the_enemy_sees_no_planned_bonus() -> None:
    """AGENTS.md 4.4: the bonus is in the own ``OrderView`` only. The enemy has the intent (no
    group, no size, no bonus) and its view is the same whatever the bonus is (DEC-32: it shows
    only in a fight)."""
    state = initial_state(_map(), RULES)
    gid = _add(state, 0, 3, 3, 0)
    run = _Run(state)
    run.step((0, Move(gid, 3, planned=True, bonus=2)))
    assert [f.name for f in fields(IntentView)] == [
        "id",
        "owner",
        "kind",
        "origin",
        "target",
        "created_tick",
    ]
    enemy = project(state, RULES, 1, KEY)
    assert len(enemy.intents) == 1 and enemy.groups == ()
    state.groups[gid].bonus = 1
    assert project(state, RULES, 1, KEY) == enemy
