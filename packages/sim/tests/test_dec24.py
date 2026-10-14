"""DEC-24 beyond the worked examples (mechanics.md, section 4, «Бой во времени»): commands in a
fight (item E), movement around a fight (items B6, D1), supply (item H1), production (DEC-25,
item 9), bonuses (item F1), the view of a fight (item I1, with its fog test, AGENTS.md 4.4) and
the canonical state.

The setup is the line of ``test_combat.py``: ``0 - 1 - 2`` (forest, 30 ticks per edge), node 1 of
player 1 with a 2/2 garrison, player 0's 3/3 arrives from node 0 in tick 1 (contact ``t = 1``,
row 2 of the table: rounds at 11, 21, 31).
"""

from pathlib import Path
from typing import Any

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
from gow_sim.ruleset import load_ruleset
from gow_sim.state import (
    PROGRESS_SCALE,
    AtNode,
    Event,
    GameState,
    Group,
    Mode,
    OnEdge,
    Order,
    from_canonical,
    initial_state,
    state_hash,
    to_canonical,
)
from gow_sim.systems.combat import combat
from gow_sim.systems.movement import find_path, leg, movement, reachable
from gow_sim.systems.orders import active_bonuses, orders
from gow_sim.systems.supply import supply
from gow_sim.view import project

TESTS_DIR = Path(__file__).resolve().parent
RULES = load_ruleset(TESTS_DIR / "rulesets" / "dec07.toml")
KEY = bytes(range(32))


def _line(n: int = 3) -> MapDef:
    nodes: list[dict[str, Any]] = [
        {
            "id": i,
            "x": 10 * i,
            "y": 10,
            "terrain": "forest",
            "vp": 1,
            "kind": "capital" if i in (0, n - 1) else "city_large",
            "capital_of": {0: 0, n - 1: 1}.get(i),
            "start_owner": 0 if i == 0 else 1,
            "start_units": 0,
            "start_charged": 0,
            "start_stock": 0,
        }
        for i in range(n)
    ]
    edges = [
        {"id": i, "a": i, "b": i + 1, "base_width": 1, "max_width": 3, "travel_ticks": 30}
        for i in range(n - 1)
    ]
    return parse_map(
        {
            "meta": {"name": "l", "version": 1, "symmetry": "rot180", "width": 100, "height": 20},
            "nodes": nodes,
            "edges": edges,
            "mirror": {
                "nodes": {str(i): n - 1 - i for i in range(n)},
                "edges": {str(i): n - 2 - i for i in range(n - 1)},
            },
        }
    )


def _add(
    state: GameState, owner: int, units: int, charged: int, loc: AtNode | OnEdge, **kw: Any
) -> int:
    gid = state.new_id()
    state.groups[gid] = Group(gid, owner, units, charged, kw.pop("mode", Mode.ATTACK), loc, **kw)
    return gid


def _before_arrival(state: GameState, edge: int, from_node: int) -> OnEdge:
    way = leg(state.map, RULES, edge, state.map.edges[edge].other(from_node))
    return OnEdge(edge, from_node, way.progress(way.ticks - 1))


class _Run:
    def __init__(self, state: GameState) -> None:
        self.state = state
        self.seq = 0

    def step(self, *cmds: tuple[int, Command]) -> list[Ok | Reject]:
        state = self.state
        state.tick += 1
        batch = []
        for player, cmd in cmds:
            batch.append(PlayerCommand(player, self.seq, cmd))
            self.seq += 1
        results, events = apply_commands(state, RULES, batch)
        state.events = events
        state.events += movement(state, RULES)
        state.events += combat(state, RULES, active_bonuses(state))
        state.events += supply(state, RULES)
        state.events += orders(state, RULES)
        return [r.outcome for r in results]

    def kinds(self, kind: str) -> list[Event]:
        return [e for e in self.state.events if e.kind == kind]


def _node_fight() -> tuple[_Run, int, int]:
    """Row 2 in node 1: defender 2/2 (player 1), attacker 3/3 arrives in tick 1."""
    state = initial_state(_line(), RULES)
    d = _add(state, 1, 2, 2, AtNode(1))
    a = _add(state, 0, 3, 3, _before_arrival(state, 0, 0), order=Order((1,), False, 0))
    run = _Run(state)
    run.step()
    assert run.kinds("fight_started")
    return run, d, a


# Commands in a fight (item E) -------------------------------------------------------------------


def test_commands_to_a_group_in_a_fight_are_in_fight() -> None:
    run, d, a = _node_fight()
    state = run.state
    d2 = _add(state, 1, 1, 0, AtNode(1))  # setup: a second defender group joins next tick
    run.step()
    assert state.groups[d2].fight is not None
    in_fight = Reject(RejectCode.IN_FIGHT)
    assert validate(state, RULES, 1, Split(d, 1)) == in_fight
    assert validate(state, RULES, 1, Merge((d, d2))) == in_fight
    assert validate(state, RULES, 1, SetMode(d, Mode.DEFENSE)) == in_fight
    assert validate(state, RULES, 1, Move(d, 2, planned=True)) == in_fight  # E1
    assert validate(state, RULES, 0, Move(a, 0)) == in_fight  # the attacker cancels instead
    assert validate(state, RULES, 1, Recruit(1)) == in_fight  # DEC-25, item 9
    assert isinstance(validate(state, RULES, 1, Move(d, 2)), Ok)  # the defender withdraws
    assert validate(state, RULES, 0, CancelOrder(a)) == Ok(cost=0)
    assert validate(state, RULES, 1, CancelOrder(d)) == Reject(RejectCode.NOTHING_TO_CANCEL)


def test_a_defender_cancels_its_withdrawal_and_stays() -> None:
    run, d, _ = _node_fight()
    state = run.state
    assert isinstance(run.step((1, Move(d, 2)))[0], Ok)
    assert state.fights[state.groups[d].fight or -1].members[d].leaving
    assert run.step((1, CancelOrder(d))) == [Ok(cost=0)]
    fid = state.groups[d].fight
    assert fid is not None and not state.fights[fid].members[d].leaving
    while not run.kinds("fight_ended"):
        run.step()
    assert state.groups[d].location == AtNode(1)  # it fought to the end: row 2, one died
    assert state.groups[d].units == 1


def test_a_withdrawing_attacker_cannot_cancel_twice() -> None:
    run, _, a = _node_fight()
    assert run.step((0, CancelOrder(a))) == [Ok(cost=0)]
    assert run.step((0, CancelOrder(a))) == [Reject(RejectCode.NOTHING_TO_CANCEL)]


def test_a_group_bouncing_into_a_fight_has_nothing_to_cancel() -> None:
    """E2: a returning group (here into its lost home with an enemy in it) has no order."""
    state = initial_state(_line(), RULES)
    state.nodes[0].owner = 1
    _add(state, 1, 3, 3, AtNode(0))
    lone = _add(state, 0, 2, 1, OnEdge(0, 0, PROGRESS_SCALE // 30, back=True))
    run = _Run(state)
    run.step()
    assert state.groups[lone].fight is not None
    assert validate(state, RULES, 0, CancelOrder(lone)) == Reject(RejectCode.NOTHING_TO_CANCEL)


# Movement around a fight (items B6, D1) -----------------------------------------------------------


def test_groups_in_a_fight_do_not_move() -> None:
    run, d, a = _node_fight()
    state = run.state
    for _ in range(5):
        run.step()
        assert state.groups[a].location == AtNode(1)
        assert state.groups[d].location == AtNode(1)


def test_no_transit_and_no_path_through_a_node_with_a_fight() -> None:
    """D1: an own node with a fight ends every path; a group heading through it stops there and
    joins the fight."""
    state = initial_state(_line(4), RULES)
    state.nodes[1].owner = 0
    state.nodes[2].owner = 0
    _add(state, 0, 8, 8, AtNode(1))  # 8 against 8: eight rounds, longer than the way there
    _add(state, 1, 8, 8, _before_arrival(state, 1, 2), order=Order((1,), False, 0))
    g = _add(state, 0, 1, 1, AtNode(0))
    run = _Run(state)
    run.step()
    assert state.fight_nodes() == {1: next(iter(state.fights))}
    assert find_path(state, RULES, 0, 0, 2) is None
    assert find_path(state, RULES, 0, 0, 1) == (0, 1)
    assert 2 not in reachable(state, RULES, 0, 0)
    state.groups[g].order = Order((1, 2), False, state.tick)  # an order given before the fight
    while state.groups[g].fight is None:
        run.step()
    assert state.groups[g].location == AtNode(1)
    assert state.groups[g].order is None


def test_a_waiting_planned_order_departs_after_the_fight() -> None:
    """E4, F1 (#141, item 2): the waiting group fights without its planned bonus and leaves
    once the fight is over."""
    state = initial_state(_line(), RULES)
    d = _add(state, 1, 2, 2, AtNode(1), order=Order((2,), True, 5), bonus=2, bonus_tick=5)
    _add(state, 0, 3, 3, _before_arrival(state, 0, 0), order=Order((1,), False, 0))
    run = _Run(state)
    run.step()
    fid = state.groups[d].fight
    assert fid is not None and state.fights[fid].virtual == (0, 0)
    while not run.kinds("fight_ended"):
        run.step()
        assert state.groups[d].location == AtNode(1)
    run.step()
    assert isinstance(state.groups[d].location, OnEdge)


# Supply (item H1) ---------------------------------------------------------------------------


def test_no_recharge_during_the_fight_then_as_usual() -> None:
    run, d, _ = _node_fight()
    state = run.state
    state.nodes[1].warehouse = 5
    while not run.kinds("fight_ended"):
        before = state.groups[d].charged if d in state.groups else 0
        run.step()
        if not run.kinds("fight_ended") and not run.kinds("fight_round"):
            assert state.groups[d].charged == before  # no recharge between rounds
    assert state.nodes[1].warehouse == 4  # recharge resumes in the tick the fight ends
    run.step()
    assert state.nodes[1].warehouse == 5 - 1  # 1 unit left (row 2), it is full now


# The view (item I1) and its fog test --------------------------------------------------------


def test_both_players_see_the_fight_with_exact_enemy_counters() -> None:
    run, d, a = _node_fight()
    state = run.state
    for player, own, enemy in ((0, a, (2, 2)), (1, d, (3, 3))):
        view = project(state, RULES, player, KEY)
        (fight,) = view.fights
        assert (fight.node, fight.edge, fight.point, fight.attacker) == (1, None, None, 0)
        assert (fight.start_tick, fight.next_round_tick) == (1, 11)
        assert len(fight.groups) == 1 and fight.groups[0] == next(
            g.id for g in view.groups if g.units == state.groups[own].units
        )
        assert (fight.enemy_units, fight.enemy_charged) == enemy


def test_fog_the_enemy_virtual_shots_and_withdrawal_are_hidden() -> None:
    """AGENTS.md 4.4: the enemy's bonuses, shots and withdrawals change nothing in the view."""
    run, d, _ = _node_fight()
    state = run.state
    before = project(state, RULES, 0, KEY)
    fid = state.groups[d].fight
    assert fid is not None
    fight = state.fights[fid]
    fight.virtual = (fight.virtual[0], fight.virtual[1] + 4)
    fight.shots = (fight.shots[0], fight.shots[1] + 3)
    run.step((1, Move(d, 2)))  # the defender orders a withdrawal: player 0 must not learn it
    after = project(state, RULES, 0, KEY)
    assert after.fights[0].enemy_units == before.fights[0].enemy_units
    assert [(f.node, f.enemy_units, f.enemy_charged, f.groups) for f in after.fights] == [
        (f.node, f.enemy_units, f.enemy_charged, f.groups) for f in before.fights
    ]


def test_fog_an_edge_fight_shows_the_enemy_counters_even_without_vision() -> None:
    """I1 (#112): a group on an edge gives no vision, but its fight shows the enemy exactly."""
    state = initial_state(_line(), RULES)
    _add(state, 0, 2, 2, OnEdge(0, 0, 14 * 1000 // 30), order=Order((1,), False, 0))
    _add(state, 1, 3, 1, OnEdge(0, 1, 14 * 1000 // 30), order=Order((0,), False, 0))
    run = _Run(state)
    run.step()
    (fight,) = project(state, RULES, 0, KEY).fights
    assert (fight.edge, fight.point, fight.attacker) == (0, 1000, None)
    assert (fight.enemy_units, fight.enemy_charged) == (3, 1)


# The canonical state (item J1) ------------------------------------------------------------------


def test_a_fight_is_in_the_canonical_state_and_its_hash() -> None:
    run, _, _ = _node_fight()
    state = run.state
    data = to_canonical(state)
    assert len(data["fights"]) == 1  # type: ignore[arg-type]
    again = from_canonical(data)
    assert again == state
    h = state_hash(state)
    (fight,) = state.fights.values()
    fight.next_round += 1
    assert state_hash(state) != h
