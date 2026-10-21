"""Commands (SIM-04): validation table, CP, application at the tick boundary, order independence.

Expected values come from the rules, not from the code:

- costs in hundredths of CP, DEC-08 (mechanics.md, section 5) and DEC-01 (section 3): move 1 CP,
  planned move 2 CP, «Атака» free, «Защита» 2 CP, UpgradeRoad 1 CP, recruit 1 CP, stance change
  free (DEC-02); the planned delay is 30 ticks (DEC-08). Cancel, split and merge are free since
  DEC-20, but ``RULES`` below pins them at the former 1 CP: the keys stay so that balance can bring
  a price back, and the CP plumbing must still work. These numbers are pinned in ``RULES``;
- AGENTS.md, section 4.3: one code ``NOT_FOUND_OR_HIDDEN`` for a missing and a hidden entity,
  a rejected command changes nothing, commands run in ``(player, seq)`` order and one player's
  commands do not change the validity of the other's;
- Split, Merge, CancelOrder and commands to a moving or waiting group: DEC-20 (mechanics.md,
  section 3; the full table of its worked examples is ``test_dec20.py``).

The map is ``tests/maps/pass.json``: 0 -e0- 1 -e1- 3, 3 -e2- 2, 3 -e5- 4, 3 -e4- 5 -e3- 6.
Player 0 owns 0 and 1, player 1 owns 5 and 6; 2, 3, 4 are neutral. Player 0 sees 0 and 1 exactly
and 3 as presence (DEC-04); 2, 4, 5, 6 are in fog for it.
"""

import dataclasses
import itertools
from collections.abc import Callable
from pathlib import Path

import pytest

from gow_sim.commands import (
    CancelOrder,
    Command,
    Forfeit,
    Merge,
    Move,
    Ok,
    PlayerCommand,
    Recruit,
    Reject,
    RejectCode,
    SetMode,
    SetStance,
    Split,
    UpgradeRoad,
    apply_commands,
    map_group_ids,
    validate,
)
from gow_sim.maps import load_map
from gow_sim.ruleset import OrderCosts, Ruleset, Stance, load_ruleset
from gow_sim.state import (
    AtNode,
    GameState,
    Group,
    Mode,
    OnEdge,
    Order,
    initial_state,
    state_hash,
)
from gow_sim.systems.movement import edge_between, traversal_ticks

TESTS_DIR = Path(__file__).resolve().parent
MVP0 = TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml"


def _rules() -> Ruleset:
    base = load_ruleset(MVP0)
    costs = OrderCosts(
        move=100,
        planned_move=200,
        cancel=100,
        split=100,
        merge=100,
        attack=0,
        defense=200,
        build=100,
        recruit=100,
        stance=0,
        front=0,
        rear_min=0,
        transfer=0,
        barracks=300,
        warehouse=200,
    )
    orders = dataclasses.replace(
        base.orders, planned_delay_ticks=30, stance_cooldown_ticks=100, cost=costs
    )
    # City 1 is small (capacity 4, DEC-22) and holds 3 units: room for one recruit (DEC-01).
    capacity = dataclasses.replace(
        base.capacity, by_kind=dataclasses.replace(base.capacity.by_kind, city_small=4)
    )
    return dataclasses.replace(base, orders=orders, capacity=capacity)


RULES = _rules()
TICK = 40
"""Tick of the test state: the commands are applied at the start of this tick."""


@dataclasses.dataclass(frozen=True)
class Ids:
    capital: int
    """Own group of 4 charged units in node 0."""
    second: int
    """Own group of 2 charged units in node 1."""
    extra: int
    """Own group of 1 discharged unit in node 0 (to merge with ``capital``)."""
    waiting: int
    """Own group in node 1 waiting to depart on a planned order to node 3."""
    moving: int
    """Own group on edge e0, half way from node 0 to node 1, ordered to node 1."""
    enemy_seen: int
    """Enemy group in the neutral node 3: visible to player 0 (presence)."""
    enemy_hidden: int
    """Enemy group in node 5: in fog for player 0."""


MISSING = 999
"""A group id that does not exist."""


def _state() -> tuple[GameState, Ids]:
    state = initial_state(load_map(TESTS_DIR / "maps" / "pass.json"), RULES)
    state.tick = TICK
    by_node = {g.location: g.id for g in state.groups.values()}  # start garrisons, one per node

    def add(owner: int, units: int, charged: int, location: AtNode | OnEdge) -> int:
        gid = state.new_id()
        state.groups[gid] = Group(gid, owner, units, charged, Mode.ATTACK, location)
        return gid

    extra = add(0, 1, 0, AtNode(0))
    waiting = add(0, 1, 1, AtNode(1))
    state.groups[waiting].order = Order(path=(3,), planned=True, depart_tick=TICK + 10)
    moving = add(0, 1, 1, OnEdge(edge=0, from_node=0, progress=500))
    state.groups[moving].order = Order(path=(1,), planned=False, depart_tick=TICK - 5)
    enemy_seen = add(1, 2, 2, AtNode(3))
    ids = Ids(
        capital=by_node[AtNode(0)],
        second=by_node[AtNode(1)],
        extra=extra,
        waiting=waiting,
        moving=moving,
        enemy_seen=enemy_seen,
        enemy_hidden=by_node[AtNode(5)],
    )
    return state, ids


# The validation table ---------------------------------------------------------------------------

type Make = Callable[[Ids, int], Command]
"""Builds the command from the ids and the id of the group (or node) under test."""

# name, command builder, own subject id, expected cost of the valid command, variants
# (a variant name -> subject for the builder, or None when the variant does not apply).
_GROUP_VARIANTS: dict[str, Callable[[Ids], int]] = {
    "foreign": lambda i: i.enemy_seen,
    "hidden": lambda i: i.enemy_hidden,
    "missing": lambda _: MISSING,
    "on_edge": lambda i: i.moving,
}

_EXPECTED = {
    "foreign": RejectCode.NOT_OWNER,
    "hidden": RejectCode.NOT_FOUND_OR_HIDDEN,
    "missing": RejectCode.NOT_FOUND_OR_HIDDEN,
    "on_edge": RejectCode.GROUP_ON_EDGE,
}


@dataclasses.dataclass(frozen=True)
class Row:
    name: str
    make: Make
    subject: Callable[[Ids], int]
    cost: int
    path: tuple[int, ...] = ()
    group_command: bool = True


ROWS = [
    Row("move", lambda _, g: Move(g, 3), lambda i: i.second, 100, path=(1, 3)),
    Row("planned_move", lambda _, g: Move(g, 3, planned=True), lambda i: i.second, 200, (1, 3)),
    Row("split", lambda _, g: Split(g, 1), lambda i: i.capital, 100),
    Row("merge", lambda i, g: Merge((i.extra, g)), lambda i: i.capital, 100),
    Row("set_defense", lambda _, g: SetMode(g, Mode.DEFENSE), lambda i: i.capital, 200),
    Row("cancel", lambda _, g: CancelOrder(g), lambda i: i.waiting, 100),
]


def _check(state: GameState, player: int, cmd: Command, expected: Ok | Reject) -> None:
    """``validate`` and ``apply_commands`` agree with ``expected``; a Reject changes nothing."""
    before = state_hash(state)
    assert validate(state, RULES, player, cmd) == expected
    assert state_hash(state) == before  # validate never changes the state
    cp = state.players[player].cp
    results, _ = apply_commands(state, RULES, [PlayerCommand(player, 1, cmd)])
    assert [r.outcome for r in results] == [expected]
    assert results[0].tick == TICK
    if isinstance(expected, Reject):
        assert state_hash(state) == before
    else:
        assert state.players[player].cp == cp - expected.cost


def _arrive_tick(state: GameState, path: tuple[int, ...], delay: int) -> int | None:
    """The first step is made in the tick of the departure (SIM-05): ``tick + delay + T - 1``."""
    if not path:
        return None
    ticks = sum(
        traversal_ticks(state.map, RULES, edge_between(state.map, a, b) or 0, b)
        for a, b in itertools.pairwise(path)
    )
    return TICK + delay + ticks - 1


@pytest.mark.parametrize("row", ROWS, ids=lambda r: r.name)
def test_group_command_valid(row: Row) -> None:
    state, ids = _state()
    delay = RULES.orders.planned_delay_ticks if row.name == "planned_move" else 0
    arrive = _arrive_tick(state, row.path, delay)
    _check(
        state, 0, row.make(ids, row.subject(ids)), Ok(row.cost, path=row.path, arrive_tick=arrive)
    )


@pytest.mark.parametrize("row", ROWS, ids=lambda r: r.name)
def test_group_command_without_cp(row: Row) -> None:
    state, ids = _state()
    state.players[0].cp = row.cost - 1
    _check(state, 0, row.make(ids, row.subject(ids)), Reject(RejectCode.NOT_ENOUGH_CP))


@pytest.mark.parametrize("variant", list(_GROUP_VARIANTS))
@pytest.mark.parametrize("row", ROWS, ids=lambda r: r.name)
def test_group_command_rejects(row: Row, variant: str) -> None:
    state, ids = _state()
    cmd = row.make(ids, _GROUP_VARIANTS[variant](ids))
    if (row.name, variant) == ("cancel", "on_edge"):  # DEC-20, C2: the group turns back
        _check(state, 0, cmd, Ok(cost=row.cost))
        assert state.groups[ids.moving].location == OnEdge(0, 0, 500, back=True)
        return
    _check(state, 0, cmd, Reject(_EXPECTED[variant]))


def test_missing_and_hidden_give_the_same_reject() -> None:
    state, ids = _state()
    hidden = validate(state, RULES, 0, SetMode(ids.enemy_hidden, Mode.DEFENSE))
    missing = validate(state, RULES, 0, SetMode(MISSING, Mode.DEFENSE))
    assert hidden == missing == Reject(RejectCode.NOT_FOUND_OR_HIDDEN)


_TARGETS: dict[str, tuple[Callable[[Ids], Command], RejectCode]] = {
    "move_dest": (lambda i: Move(i.second, 99), RejectCode.NOT_FOUND_OR_HIDDEN),
    "upgrade_edge": (lambda _: UpgradeRoad(99), RejectCode.NOT_FOUND_OR_HIDDEN),
    "upgrade_negative_edge": (lambda _: UpgradeRoad(-1), RejectCode.NOT_FOUND_OR_HIDDEN),
    "recruit_node": (lambda _: Recruit(99), RejectCode.NOT_FOUND_OR_HIDDEN),
    "recruit_enemy_node": (lambda _: Recruit(5), RejectCode.NOT_OWNER),
    "recruit_neutral": (lambda _: Recruit(3), RejectCode.NOT_OWNER),
}


@pytest.mark.parametrize("case", list(_TARGETS))
def test_missing_target(case: str) -> None:
    make, code = _TARGETS[case]
    state, ids = _state()
    _check(state, 0, make(ids), Reject(code))


@pytest.mark.parametrize(
    ("cmd", "cost"),
    [(Recruit(1), 100), (SetStance(Stance.WAR), 0), (Forfeit(), 0)],
    ids=["recruit", "set_stance", "forfeit"],
)
def test_player_command_valid(cmd: Command, cost: int) -> None:
    state, _ = _state()
    _check(state, 0, cmd, Ok(cost=cost))


def test_recruit_without_cp() -> None:
    state, _ = _state()
    state.players[0].cp = 99
    _check(state, 0, Recruit(1), Reject(RejectCode.NOT_ENOUGH_CP))


def test_free_commands_need_no_cp() -> None:
    state, ids = _state()
    state.groups[ids.capital].mode = Mode.DEFENSE
    state.players[0].cp = 0
    _check(state, 0, SetMode(ids.capital, Mode.ATTACK), Ok(cost=0))
    _check(state, 0, SetStance(Stance.ECONOMY), Ok(cost=0))
    _check(state, 0, Forfeit(), Ok(cost=0))


# Rules of single commands ----------------------------------------------------------------------


def test_waiting_group_takes_only_cancel() -> None:
    state, ids = _state()
    for cmd in (
        Move(ids.waiting, 0),
        Split(ids.waiting, 1),
        Merge((ids.second, ids.waiting)),
        SetMode(ids.waiting, Mode.DEFENSE),
    ):
        assert validate(state, RULES, 0, cmd) == Reject(RejectCode.GROUP_BUSY)
    assert validate(state, RULES, 0, CancelOrder(ids.waiting)) == Ok(cost=100)


def test_cancel_needs_a_waiting_planned_order() -> None:
    state, ids = _state()
    assert validate(state, RULES, 0, CancelOrder(ids.capital)) == Reject(
        RejectCode.NOTHING_TO_CANCEL
    )
    state.tick = TICK + 10  # the depart tick: the delay is over, the group leaves this tick
    assert validate(state, RULES, 0, CancelOrder(ids.waiting)) == Reject(
        RejectCode.NOTHING_TO_CANCEL
    )


def test_move_to_own_node_or_unreachable() -> None:
    state, ids = _state()
    assert validate(state, RULES, 0, Move(ids.second, 1)) == Reject(RejectCode.INVALID_ARGUMENT)
    assert validate(state, RULES, 0, Move(ids.capital, 6)) == Reject(RejectCode.NO_PATH)


def test_move_sets_the_order() -> None:
    state, ids = _state()
    state.groups[ids.second].mode = Mode.DEFENSE
    apply_commands(
        state,
        RULES,
        [PlayerCommand(0, 1, Move(ids.second, 3)), PlayerCommand(0, 2, Move(ids.capital, 1, True))],
    )
    second, capital = state.groups[ids.second], state.groups[ids.capital]
    assert second.order == Order(path=(3,), planned=False, depart_tick=TICK)
    assert second.mode is Mode.ATTACK  # a move order drops «Защита» for free (DEC-08)
    assert capital.order == Order(path=(1,), planned=True, depart_tick=TICK + 30)
    assert state.players[0].cp == 300 - 100 - 200


def test_split_takes_charged_units_first() -> None:
    state, ids = _state()
    state.groups[ids.capital].charged = 3  # 4 units, 3 charged
    results, _ = apply_commands(state, RULES, [PlayerCommand(0, 1, Split(ids.capital, 2))])
    assert isinstance(results[0].outcome, Ok)
    new = state.groups[max(state.groups)]
    assert (new.owner, new.units, new.charged, new.mode, new.location) == (
        0,
        2,
        2,
        Mode.ATTACK,
        AtNode(0),
    )
    assert (state.groups[ids.capital].units, state.groups[ids.capital].charged) == (2, 1)


@pytest.mark.parametrize("n", [0, 4, -1])
def test_split_size_must_leave_both_groups(n: int) -> None:
    state, ids = _state()
    assert validate(state, RULES, 0, Split(ids.capital, n)) == Reject(RejectCode.INVALID_ARGUMENT)


def test_merge_keeps_the_smallest_id() -> None:
    state, ids = _state()
    state.groups[ids.capital].mode = Mode.DEFENSE
    apply_commands(state, RULES, [PlayerCommand(0, 1, Merge((ids.extra, ids.capital)))])
    keep = state.groups[min(ids.capital, ids.extra)]
    assert max(ids.capital, ids.extra) not in state.groups
    # The group with the smallest id keeps its mode (DEC-20, B2).
    assert (keep.units, keep.charged, keep.mode, keep.order) == (5, 4, Mode.DEFENSE, None)


def test_merge_rejects() -> None:
    state, ids = _state()
    for gids, code in [
        ((ids.capital,), RejectCode.INVALID_ARGUMENT),
        ((ids.capital, ids.capital), RejectCode.INVALID_ARGUMENT),
        ((ids.capital, ids.second), RejectCode.NOT_SAME_NODE),
    ]:
        assert validate(state, RULES, 0, Merge(gids)) == Reject(code)


def test_set_mode_same_mode() -> None:
    state, ids = _state()
    assert validate(state, RULES, 0, SetMode(ids.capital, Mode.ATTACK)) == Reject(
        RejectCode.NO_CHANGE
    )
    state.groups[ids.capital].mode = Mode.DEFENSE
    # «Защита» while in it would only reset what it gathered (DEC-30): nothing to change.
    assert validate(state, RULES, 0, SetMode(ids.capital, Mode.DEFENSE)) == Reject(
        RejectCode.NO_CHANGE
    )


def test_upgrade_road_rules() -> None:
    """``UpgradeRoad(edge)`` paid with CP (DEC-28, item 7); the full tables are in
    ``test_build.py``, ``test_dec22.py`` and ``test_dec26.py``."""
    state, _ = _state()
    # e1 joins own 1 and neutral 3: a buffer edge (mechanics.md, section 8).
    assert validate(state, RULES, 0, UpgradeRoad(1)) == Reject(RejectCode.NOT_INTERNAL)
    state.edges[0].width = 3  # max_width of e0
    assert validate(state, RULES, 0, UpgradeRoad(0)) == Reject(RejectCode.MAX_WIDTH)
    state.edges[0].width = 1
    state.nodes[0].warehouse = 0  # no charges are needed
    _check(state, 0, UpgradeRoad(0), Ok(cost=100))  # orders.cost.build of these rules
    assert validate(state, RULES, 0, UpgradeRoad(0)) == Reject(RejectCode.EDGE_BUSY)


def test_recruit_queues_one_unit() -> None:
    """The unit appears later, from the recruit queue (DEC-25; ``test_recruit.py``)."""
    state, _ = _state()
    before = dict(state.groups)
    apply_commands(state, RULES, [PlayerCommand(0, 1, Recruit(1))])
    assert state.groups == before
    assert state.nodes[1].recruit_queue == 1


def test_stance_change_and_cooldown() -> None:
    state, _ = _state()
    assert validate(state, RULES, 0, SetStance(Stance.BALANCE)) == Reject(RejectCode.NO_CHANGE)
    apply_commands(state, RULES, [PlayerCommand(0, 1, SetStance(Stance.WAR))])
    assert state.players[0].stance is Stance.WAR
    state.tick = TICK + 99  # at most once per 100 ticks (DEC-02)
    assert validate(state, RULES, 0, SetStance(Stance.ECONOMY)) == Reject(
        RejectCode.STANCE_COOLDOWN
    )
    state.tick = TICK + 100
    assert validate(state, RULES, 0, SetStance(Stance.ECONOMY)) == Ok(cost=0)


def test_forfeit_is_a_command() -> None:
    state, _ = _state()
    _, events = apply_commands(state, RULES, [PlayerCommand(1, 7, Forfeit())])
    assert state.players[1].forfeited
    assert [(e.kind, e.get("player")) for e in events] == [("forfeit", 1)]
    assert validate(state, RULES, 1, Forfeit()) == Reject(RejectCode.NO_CHANGE)


# Application at the tick boundary --------------------------------------------------------------


def _mixed(ids: Ids) -> list[PlayerCommand]:
    """Commands of both players in one tick, including rejects and a CP conflict."""
    return [
        PlayerCommand(0, 1, Split(ids.capital, 2)),
        PlayerCommand(0, 2, Move(ids.second, 3)),
        PlayerCommand(0, 3, Merge((ids.capital, ids.extra))),
        PlayerCommand(0, 4, Recruit(1)),  # 300 - 3 * 100: no CP left
        PlayerCommand(0, 5, SetMode(ids.enemy_hidden, Mode.DEFENSE)),
        PlayerCommand(1, 1, SetMode(ids.enemy_seen, Mode.DEFENSE)),
        PlayerCommand(1, 2, Move(ids.enemy_hidden, 3)),
        PlayerCommand(1, 3, Split(ids.second, 1)),
        PlayerCommand(1, 4, SetStance(Stance.WAR)),
    ]


def _arrival_orders(commands: list[PlayerCommand]) -> list[list[PlayerCommand]]:
    """Every rotation, the reverse and the two players interleaved the other way round."""
    rotations = [commands[k:] + commands[:k] for k in range(len(commands))]
    p0 = [c for c in commands if c.player == 0]
    p1 = [c for c in commands if c.player == 1]
    interleaved = [c for pair in itertools.zip_longest(p1, p0) for c in pair if c is not None]
    return [*rotations, commands[::-1], interleaved]


def test_arrival_order_does_not_matter() -> None:
    _, ids = _state()
    outcomes: list[tuple[str, list[tuple[int, int, Ok | Reject]]]] = []
    for order in _arrival_orders(_mixed(ids)):
        run, _ = _state()
        results, _ = apply_commands(run, RULES, order)
        outcomes.append((state_hash(run), [(r.player, r.seq, r.outcome) for r in results]))
    assert all(o == outcomes[0] for o in outcomes)
    codes = [None if isinstance(o, Ok) else o.code for _, _, o in outcomes[0][1]]
    assert codes == [
        None,
        None,
        None,
        RejectCode.NOT_ENOUGH_CP,  # 300 - 3 * 100 = 0 CP left for the recruit
        RejectCode.NOT_FOUND_OR_HIDDEN,
        None,
        None,
        RejectCode.NOT_OWNER,
        None,
    ]


def test_players_do_not_affect_each_other() -> None:
    """Player 1's results are the same with and without player 0's commands in the tick."""
    state, ids = _state()
    # Player 0 merges a group that player 1 sees, and splits: the new id is predictable.
    state.groups[ids.extra].location = AtNode(1)
    p0 = [
        PlayerCommand(0, 1, Merge((ids.second, ids.extra))),
        PlayerCommand(0, 2, Split(ids.capital, 1)),
    ]
    predicted = state.next_id
    p1 = [
        PlayerCommand(1, 1, SetMode(max(ids.second, ids.extra), Mode.DEFENSE)),
        PlayerCommand(1, 2, SetMode(predicted, Mode.DEFENSE)),
        PlayerCommand(1, 3, Move(ids.enemy_seen, 1)),
    ]
    alone, _ = _state()
    alone.groups[ids.extra].location = AtNode(1)
    only_p1, _ = apply_commands(alone, RULES, p1)
    both, _ = apply_commands(state, RULES, p0 + p1)
    assert [r.outcome for r in both if r.player == 1] == [r.outcome for r in only_p1]
    assert [r.outcome for r in only_p1] == [
        Reject(RejectCode.NOT_OWNER),  # the merged-away group was visible at the tick start
        Reject(RejectCode.NOT_FOUND_OR_HIDDEN),  # did not exist at the tick start
        Ok(cost=100, path=(3, 1), arrive_tick=_arrive_tick(state, (3, 1), 0)),
    ]


def test_seq_orders_one_players_commands() -> None:
    state, ids = _state()
    state.players[0].cp = 100
    results, _ = apply_commands(
        state,
        RULES,
        [PlayerCommand(0, 9, Recruit(1)), PlayerCommand(0, 3, Split(ids.capital, 1))],
    )
    assert [(r.seq, type(r.outcome)) for r in results] == [(3, Ok), (9, Reject)]


def test_duplicate_seq_is_an_error() -> None:
    state, _ = _state()
    with pytest.raises(ValueError, match="duplicate command seq 1 of player 0"):
        apply_commands(
            state, RULES, [PlayerCommand(0, 1, Forfeit()), PlayerCommand(0, 1, Forfeit())]
        )


def test_map_group_ids() -> None:
    def f(g: int) -> int:
        return g + 100

    assert map_group_ids(Move(1, 5, True), f) == Move(101, 5, True)
    assert map_group_ids(Merge((1, 2)), f) == Merge((101, 102))
    assert map_group_ids(UpgradeRoad(4), f) == UpgradeRoad(4)  # an edge, no group
    assert map_group_ids(Split(1, 2), f) == Split(101, 2)
    assert map_group_ids(SetMode(1, Mode.DEFENSE), f) == SetMode(101, Mode.DEFENSE)
    assert map_group_ids(CancelOrder(7), f) == CancelOrder(107)
    assert map_group_ids(Recruit(3), f) == Recruit(3)
    assert map_group_ids(SetStance(Stance.WAR), f) == SetStance(Stance.WAR)
    assert map_group_ids(Forfeit(), f) == Forfeit()
