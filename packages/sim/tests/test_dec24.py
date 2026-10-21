"""DEC-24 beyond the worked examples (mechanics.md, section 4, «Бой во времени»): commands in a
fight (item E), movement around a fight (items B6, D1), supply (item H1), production (DEC-25,
item 9), bonuses (item F1), the view of a fight (item I1 and the bonus stock of DEC-32, with
their fog tests, AGENTS.md 4.4) and the canonical state.

The setup is the line of ``test_combat.py``: ``0 - 1 - 2`` (forest, 30 ticks per edge), node 1 of
player 1 with a 2/2 garrison, player 0's 3/3 arrives from node 0 in tick 1 (contact ``t = 1``,
row 2 of the table: rounds at 21, 41, 61 with ``round_ticks = 20``, DEC-32).
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
from gow_sim.maps import PLAYERS, MapDef, parse_map
from gow_sim.ruleset import load_ruleset
from gow_sim.state import (
    PROGRESS_SCALE,
    AtNode,
    Event,
    FightRound,
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
from gow_sim.systems.recruit import recruit
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
        batch: list[PlayerCommand] = []
        for player, cmd in cmds:
            batch.append(PlayerCommand(player, self.seq, cmd))
            self.seq += 1
        results, events = apply_commands(state, RULES, batch)
        state.events = events
        state.events += movement(state, RULES)
        state.events += combat(state, RULES, active_bonuses(state, RULES))
        state.events += supply(state, RULES)
        state.events += recruit(state, RULES)
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
    assert validate(state, RULES, 1, Recruit(1)) == Ok(cost=100)  # queued, paused (DEC-25, 9)
    assert isinstance(validate(state, RULES, 1, Move(d, 2)), Ok)  # the defender withdraws
    assert validate(state, RULES, 0, CancelOrder(a)) == Ok(cost=0)
    assert validate(state, RULES, 1, CancelOrder(d)) == Reject(RejectCode.NOTHING_TO_CANCEL)


def test_a_recruit_queued_during_a_fight_waits_for_its_end() -> None:
    """DEC-25, item 9 with a real fight: queueing is allowed, the progress stands while the
    fight lasts; then the queue goes on (the node held) or is lost (the node taken)."""
    run, _, _ = _node_fight()
    state = run.state
    assert run.step((1, Recruit(1))) == [Ok(cost=100)]
    assert state.nodes[1].recruit_queue == 1
    while 1 in state.fight_nodes():
        assert state.nodes[1].recruit_progress == 0
        run.step()
    lost = run.kinds("recruit_queue_lost")
    if state.nodes[1].owner == 1:
        assert not lost and state.nodes[1].recruit_progress == 1
    else:
        assert [dict(e.data) for e in lost] == [{"node": 1, "player": 1, "units": 1}]
        assert state.nodes[1].recruit_queue == 0


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
        assert (fight.start_tick, fight.next_round_tick) == (1, 21)
        assert len(fight.groups) == 1 and fight.groups[0] == next(
            g.id for g in view.groups if g.units == state.groups[own].units
        )
        assert (fight.enemy_units, fight.enemy_charged) == enemy
        assert fight.virtual_left == (0, 0)  # forest, no orders: no virtual shots


def test_both_players_see_the_rounds_and_the_bonus_stock_of_both_sides() -> None:
    """I1 and I2 as revised with DEC-29 (#295): the rounds are public; DEC-32, items 3 and 5:
    the bonus stock of both sides too, while the fight goes on. The attacker 3/3 brings a planned
    bonus of 2 (row 2 plus a plan): the stock is 2 from the contact, in the round at 21 its shot
    is virtual (B4: virtual first) and cancels the defender's real one, so the stock is 1; the
    round at 41 spends the last one."""
    state = initial_state(_line(), RULES)
    _add(state, 1, 2, 2, AtNode(1))
    order = Order((1,), True, 0)
    _add(state, 0, 3, 3, _before_arrival(state, 0, 0), order=order, bonus=2, bonus_tick=0)
    run = _Run(state)
    run.step()
    for player in PLAYERS:
        (fight,) = project(state, RULES, player, KEY).fights
        assert fight.last_round is None  # before the first round: no round data
        assert (fight.shots, fight.losses) == ((0, 0), (0, 0))
        assert fight.virtual_left == (2, 0)  # the stock is there from the contact
    while state.tick < 21:
        run.step()
    (rnd,) = run.kinds("fight_round")
    expected = FightRound(21, shots=(1, 1), virtual=(1, 0), spent=(0, 1), losses=(0, 0))
    for key in ("shots", "virtual", "spent", "losses"):  # the event carries the same numbers
        assert (rnd.get(f"{key}_0"), rnd.get(f"{key}_1")) == getattr(expected, key)
    for player in PLAYERS:
        (fight,) = project(state, RULES, player, KEY).fights
        assert fight.last_round == expected
        assert (fight.shots, fight.losses) == ((1, 1), (0, 0))
        assert fight.virtual_left == (1, 0)
    while state.tick < 41:
        run.step()
    for player in PLAYERS:
        (fight,) = project(state, RULES, player, KEY).fights
        assert fight.last_round is not None and fight.last_round.virtual == (1, 0)
        assert fight.virtual_left == (0, 0)  # spent


def test_fog_the_bonus_stock_is_exact_for_both_players() -> None:
    """AGENTS.md 4.4 for ``FightView.virtual_left`` (DEC-32, item 3): in a fight both numbers are
    in the views of both players, exactly."""
    run, d, _ = _node_fight()
    state = run.state
    fid = state.groups[d].fight
    assert fid is not None
    state.fights[fid].virtual = (1, 4)
    for player in PLAYERS:
        (fight,) = project(state, RULES, player, KEY).fights
        assert fight.virtual_left == (1, 4)


def test_fog_a_withdrawal_is_hidden() -> None:
    """AGENTS.md 4.4, I1: an ordered withdrawal of the enemy is not in a view."""
    run, d, _ = _node_fight()
    state = run.state
    before = project(state, RULES, 0, KEY)
    run.step((1, Move(d, 2)))  # the defender orders a withdrawal: player 0 must not learn it
    after = project(state, RULES, 0, KEY)
    assert after.fights == before.fights


def _without_bonuses(state: GameState, gids: list[int]) -> GameState:
    """A copy of ``state`` where the groups ``gids`` have no bonus and no gathered «Защита»."""
    copy = from_canonical(to_canonical(state))
    for gid in gids:
        copy.groups[gid].bonus = 0
        copy.groups[gid].ticks_in_defense = 0
    return copy


def test_fog_an_enemy_bonus_outside_a_fight_is_hidden() -> None:
    """DEC-32, item 3 (DEC-30, item 5): outside a fight the gathered «Защита» and the bonus of a
    waiting planned order of an enemy group are not in a view: player 0's view is the same with
    and without them, while player 1 sees its own «Защита» bonus."""
    state = initial_state(_line(), RULES)
    gathered = 2 * RULES.orders.defense_ticks_per_bonus
    guard = _add(state, 1, 2, 2, AtNode(1), mode=Mode.DEFENSE, ticks_in_defense=gathered)
    waiting = _add(state, 1, 2, 2, AtNode(1), order=Order((0,), True, 50), bonus=2, bonus_tick=50)
    _add(state, 0, 1, 1, AtNode(0))
    bare = _without_bonuses(state, [guard, waiting])
    assert project(state, RULES, 0, KEY) == project(bare, RULES, 0, KEY)
    assert project(state, RULES, 0, KEY).fights == ()
    own = {g.units: g for g in project(state, RULES, 1, KEY).groups if g.mode is Mode.DEFENSE}
    assert own[2].defense_bonus == 2  # the own view has it: the test above is not vacuous


def test_fog_a_reinforcement_shows_its_bonus_only_when_it_joins() -> None:
    """DEC-32, item 5: a reinforcement on its way does not reveal its bonus; the stock grows in
    the tick it joins the fight (DEC-24, items D1 and F1), before the first round at 21."""
    run, _, _ = _node_fight()
    state = run.state
    way = leg(state.map, RULES, 0, 1)
    where = OnEdge(0, 0, way.progress(way.ticks - 10))
    # 2 charged: a planned bonus is at most the charged units (DEC-29, ``movement``).
    r = _add(state, 0, 2, 2, where, order=Order((1,), True, 0), bonus=2, bonus_tick=0)
    while state.groups[r].fight is None:
        (fight,) = project(state, RULES, 1, KEY).fights
        assert fight.virtual_left == (0, 0)
        bare = _without_bonuses(state, [r])
        assert project(state, RULES, 1, KEY) == project(bare, RULES, 1, KEY)
        run.step()
    assert state.tick < 21
    for player in PLAYERS:
        (fight,) = project(state, RULES, player, KEY).fights
        assert fight.virtual_left == (2, 0)


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
