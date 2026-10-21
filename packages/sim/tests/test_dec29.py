"""DEC-29: the bonus of a planned order by distance (mechanics.md, section 5, «Бонус
запланированного приказа по дистанции (DEC-29, #291)»).

The bonus is the number of edges of the path of the order (the path of ``Move``, the one in
``ack.path``, chosen at the command) times ``orders.planned_bonus_per_edge``, at most the charged
units of the group in the tick it departs; a group without charged units gets 0, the order still
runs and its CP are not returned. Expected values: the table of examples of DEC-29 (ruleset
``mvp-1``, ``planned_bonus_per_edge = 1``).

Maps: a line ``0 - 1 - ... - 6`` of player 0's cities with the capitals at the ends (player 1's
at 6), 30 ticks per edge; the planned order waits ``orders.planned_delay_ticks = 30`` ticks, so a
command applied at tick 1 departs at tick 31. Only the systems that act here run (commands,
movement, combat, orders), so the charged units change only where a test changes them.
"""

from pathlib import Path
from typing import Any

import pytest

from gow_sim.commands import Command, Move, Ok, PlayerCommand, Reject, apply_commands
from gow_sim.maps import MapDef, parse_map
from gow_sim.ruleset import load_ruleset
from gow_sim.state import AtNode, GameState, Group, Mode, OnEdge, initial_state
from gow_sim.systems.combat import combat
from gow_sim.systems.movement import movement
from gow_sim.systems.orders import active_bonuses, orders

ROOT = Path(__file__).resolve().parents[3]
RULES = load_ruleset(ROOT / "rulesets" / "mvp-1.toml")
N = 7
DEPART = 1 + 30
"""The departure tick of a planned order applied at tick 1."""


def _map(edges: list[tuple[int, int, int]] | None = None) -> MapDef:
    nodes: list[dict[str, Any]] = [
        {
            "id": i,
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
        {"id": k, "a": a, "b": b, "base_width": 1, "max_width": 3, "travel_ticks": t}
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
        state.events += combat(state, RULES, active_bonuses(state, RULES))
        state.events += orders(state, RULES)
        return [r.outcome for r in results]

    def until(self, tick: int) -> None:
        while self.state.tick < tick:
            self.step()


def test_mvp1_has_one_virtual_shot_per_edge() -> None:
    assert RULES.orders.planned_bonus_per_edge == 1
    assert RULES.orders.planned_delay_ticks == 30
    assert RULES.orders.cost.planned_move == 200


# The table of examples ---------------------------------------------------------------------------

EXAMPLES = [
    # (row, edges of the path, units, charged in the departure tick, bonus)
    (1, 1, 3, 3, 1),
    (2, 2, 3, 3, 2),
    (3, 4, 3, 3, 3),  # the cap: the charged units
    (4, 3, 4, 1, 1),
    (5, 3, 3, 0, 0),
    (6, 2, 5, 5, 2),
]


@pytest.mark.parametrize(
    ("row", "edges", "units", "charged", "bonus"), EXAMPLES, ids=[f"row{e[0]}" for e in EXAMPLES]
)
def test_dec29_example(row: int, edges: int, units: int, charged: int, bonus: int) -> None:
    del row
    state = initial_state(_map(), RULES)
    gid = _add(state, 0, units, charged, 0)
    cp = state.players[0].cp
    run = _Run(state)
    (ok,) = run.step((0, Move(gid, edges, planned=True)))
    assert isinstance(ok, Ok)
    assert len(ok.path) - 1 == edges  # the path of the order, as in ``ack.path``
    assert state.players[0].cp == cp - 200  # 2 CP, never returned (row 5 too)
    run.until(DEPART - 1)
    assert state.groups[gid].location == AtNode(0)  # waits the delay
    assert active_bonuses(state, RULES) == {}  # not active before the departure
    run.step()
    group = state.groups[gid]
    assert isinstance(group.location, OnEdge)  # departs, also without a bonus (row 5)
    assert group.bonus == bonus
    active = active_bonuses(state, RULES)
    assert (active[gid].amount if gid in active else 0) == bonus
    assert state.players[0].cp == cp - 200


def test_the_bonus_is_the_rule_function_of_the_ruleset() -> None:
    for _, edges, _, charged, bonus in EXAMPLES:
        assert RULES.orders.planned_bonus(edges, charged) == bonus


# Details -----------------------------------------------------------------------------------------


def test_the_path_is_the_fastest_one_not_the_one_with_fewest_edges() -> None:
    """«Какой путь»: the path of ``Move`` (the fastest, DEC-20), not a graph of its own. The
    direct road 0-3 takes 300 ticks, the way 0-1-2-3 90: three edges, bonus 3."""
    pairs = [(0, 1, 30), (1, 2, 30), (2, 3, 30), (0, 3, 300), (3, 4, 30), (4, 5, 30), (5, 6, 30)]
    state = initial_state(_map(pairs), RULES)
    gid = _add(state, 0, 4, 4, 0)
    run = _Run(state)
    (ok,) = run.step((0, Move(gid, 3, planned=True)))
    assert isinstance(ok, Ok) and ok.path == (0, 1, 2, 3)
    run.until(DEPART)
    assert state.groups[gid].bonus == 3


@pytest.mark.parametrize(
    ("at_command", "at_departure", "bonus"),
    [
        (1, 3, 3),  # recharged from the warehouse during the delay: 3 edges, 3 charged
        (3, 1, 1),  # lost charges during the delay (starvation): 1
        (3, 0, 0),  # no charged unit left: 0
    ],
)
def test_the_cap_is_measured_in_the_departure_tick(
    at_command: int, at_departure: int, bonus: int
) -> None:
    """«Когда измеряется потолок»: by the charged units in the departure tick, not at the
    command. The test sets the charged units as supply or starvation would during the delay."""
    state = initial_state(_map(), RULES)
    gid = _add(state, 0, 3, at_command, 0)
    run = _Run(state)
    run.step((0, Move(gid, 3, planned=True)))
    run.until(DEPART - 1)
    state.groups[gid].charged = at_departure
    run.step()
    assert isinstance(state.groups[gid].location, OnEdge)
    assert state.groups[gid].bonus == bonus


def test_the_capped_bonus_enters_the_fight() -> None:
    """The bonus of row 2 (2 edges, 3 charged: +2) enters the fight as the virtual shots of the
    attacker (DEC-24, item F1): a 3/3 planned strike from node 0 on player 1's node 2."""
    state = initial_state(_map(), RULES)
    state.nodes[2].owner = 1  # setup: node 2 is player 1's, held by 2/2
    _add(state, 1, 2, 2, 2)
    gid = _add(state, 0, 3, 3, 0)
    run = _Run(state)
    run.step((0, Move(gid, 2, planned=True)))
    run.until(DEPART)
    assert state.groups[gid].bonus == 2
    while state.groups[gid].fight is None:
        run.step()
    (fight,) = state.fights.values()
    assert fight.virtual == (2, 0)
    assert state.groups[gid].bonus == 0  # it left the group: it burns with the fight
