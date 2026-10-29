"""DEC-37 (#549): the engagement zone around a node (mechanics.md, section 4, the DEC-37 block).

The worked examples of DEC-37: the line ``0 - 1 - 2 - 3``, forest, 30 ticks per edge (``progress``
after ``k`` ticks: 33, 66, 100, 133), ``round_ticks = 20``, ``engage_ticks = 3`` (the pinned
``dec07`` ruleset). Node 1 is player 1's; the attacker A of player 0 comes from node 0 and arrives
in node 1 in tick ``t``; D of player 1 leaves node 1 toward node 2 by a ``Move`` given ``lead``
ticks before ``t`` (in the first tick of the run); G of player 1 stays in node 1. The expected
values are those of the DEC-37 table.
"""

from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from gow_sim.commands import (
    CancelOrder,
    Command,
    Move,
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
    Mode,
    OnEdge,
    Order,
    from_canonical,
    initial_state,
    to_canonical,
)
from gow_sim.systems.combat import combat
from gow_sim.systems.movement import leg, movement
from gow_sim.systems.orders import active_bonuses, orders
from gow_sim.view import project

TESTS_DIR = Path(__file__).resolve().parent
RULES = load_ruleset(TESTS_DIR / "rulesets" / "dec07.toml")
KEY = bytes(range(32))


def _rules(engage: int) -> Ruleset:
    return replace(RULES, combat=replace(RULES.combat, engage_ticks=engage))


def _line() -> MapDef:
    """``0 - 1 - 2 - 3``, forest, 30 ticks per edge; capitals 0 (player 0) and 3 (player 1)."""
    nodes: list[dict[str, Any]] = [
        {
            "id": i,
            "name": f"n{i}",
            "x": 10 * i,
            "y": 10,
            "terrain": "forest",
            "vp": 1,
            "kind": "capital" if i in (0, 3) else "city_large",
            "capital_of": {0: 0, 3: 1}.get(i),
            "start_owner": 0 if i == 0 else 1,
            "start_units": 0,
            "start_charged": 0,
            "start_stock": 0,
        }
        for i in range(4)
    ]
    edges = [
        {"id": i, "a": i, "b": i + 1, "max_level": 3, "travel_ticks": 30, "border_permille": 500}
        for i in range(3)
    ]
    return parse_map(
        {
            "meta": {"name": "l", "version": 1, "symmetry": "rot180", "width": 100, "height": 20},
            "nodes": nodes,
            "edges": edges,
            "mirror": {
                "nodes": {str(i): 3 - i for i in range(4)},
                "edges": {str(i): 2 - i for i in range(3)},
            },
        }
    )


def _add(
    state: GameState, owner: int, units: int, charged: int, loc: AtNode | OnEdge, **kw: Any
) -> int:
    gid = state.new_id()
    state.groups[gid] = Group(gid, owner, units, charged, Mode.ATTACK, loc, **kw)
    return gid


class _Run:
    def __init__(self, state: GameState, rules: Ruleset) -> None:
        self.state = state
        self.rules = rules
        self.seq = 0

    def step(self, *cmds: tuple[int, Command]) -> list[Any]:
        state, rules = self.state, self.rules
        state.tick += 1
        batch: list[PlayerCommand] = []
        for player, cmd in cmds:
            batch.append(PlayerCommand(player, self.seq, cmd))
            self.seq += 1
        results, events = apply_commands(state, rules, batch)
        state.events = events
        state.events += movement(state, rules)
        state.events += combat(state, rules, active_bonuses(state, rules))
        state.events += orders(state, rules)
        return [r.outcome for r in results]

    def until(self, tick: int) -> None:
        while self.state.tick < tick:
            self.step()

    def kinds(self, kind: str) -> list[Event]:
        return [e for e in self.state.events if e.kind == kind]


@dataclass
class _Case:
    run: _Run
    a: int
    d: int
    g: int | None
    t: int


def _case(
    lead: int,
    a: tuple[int, int] = (3, 3),
    d: tuple[int, int] = (2, 2),
    g: tuple[int, int] | None = None,
    *,
    engage: int = 3,
    mirror: bool = False,
    toward: int = 2,
) -> _Case:
    """The DEC-37 setup; ``mirror``: the rot180 mirror (A of player 1 from node 3 into node 2 of
    player 0, D of player 0 toward node 1). Runs to the arrival tick ``t = 1 + lead``."""
    rules = _rules(engage)
    mapdef = _line()
    state = initial_state(mapdef, rules)

    def m(node: int) -> int:
        return 3 - node if mirror else node

    attacker, defender = (1, 0) if mirror else (0, 1)
    for node in range(4):
        state.nodes[m(node)].owner = 0 if node == 0 else 1
        if mirror:
            state.nodes[m(node)].owner = 1 if node == 0 else 0
    edge_in = 2 if mirror else 0  # the edge of A into the node
    way = leg(mapdef, rules, edge_in, m(1))
    a_loc = OnEdge(edge_in, m(0), way.progress(way.ticks - 1 - lead))
    gid_a = _add(state, attacker, *a, a_loc, order=Order((m(1),), False, 0))
    gid_d = _add(state, defender, *d, AtNode(m(1)))
    gid_g = None if g is None else _add(state, defender, *g, AtNode(m(1)))
    run = _Run(state, rules)
    run.step((defender, Move(gid_d, m(toward), False)))
    run.until(1 + lead)
    return _Case(run, gid_a, gid_d, gid_g, 1 + lead)


def _counts(state: GameState, gid: int) -> tuple[int, int]:
    g = state.groups[gid]
    return g.units, g.charged


# The table of DEC-37 ---------------------------------------------------------------------------


def test_escape_before_dec37() -> None:
    """The analysis of #549: without the zone even a ``Move`` in the arrival tick escapes."""
    for lead in range(4):
        c = _case(lead, engage=0)
        state = c.run.state
        assert not c.run.kinds("fight_started")
        assert state.nodes[1].owner == 0
        assert _counts(state, c.d) == (2, 2)
        assert state.groups[c.d].location == OnEdge(1, 1, [33, 66, 100, 133][lead])


def test_rows_1_to_3_caught_shoot_one_round_and_go_on() -> None:
    for lead, pos, after in ((0, 33, 66), (1, 66, 100), (2, 100, 133)):
        c = _case(lead)
        run, state, t = c.run, c.run.state, c.t
        assert [e.get("node") for e in run.kinds("fight_started")] == [1]
        assert not run.kinds("node_captured")
        assert state.nodes[1].owner == 1
        assert state.groups[c.d].fight is not None
        assert state.groups[c.d].location == OnEdge(1, 1, pos)
        run.until(t + 20)
        assert run.kinds("fight_ended")[0].get("winner") == 0
        assert [e.get("player") for e in run.kinds("node_captured")] == [0]
        assert _counts(state, c.a) == (3, 2)
        assert _counts(state, c.d) == (2, 1)
        assert state.groups[c.d].fight is None
        assert state.groups[c.d].location == OnEdge(1, 1, pos)
        assert state.groups[c.d].order == Order((2,), False, 1)
        run.step()
        assert state.groups[c.d].location == OnEdge(1, 1, after)


def test_row_4_left_four_ticks_ago_is_not_caught() -> None:
    c = _case(3)
    state = c.run.state
    assert not c.run.kinds("fight_started")
    assert [e.get("player") for e in c.run.kinds("node_captured")] == [0]
    assert _counts(state, c.d) == (2, 2)
    assert state.groups[c.d].location == OnEdge(1, 1, 133)


def test_row_5_a_discharged_caught_group_takes_a_loss() -> None:
    c = _case(1, a=(2, 2), d=(2, 0))
    state = c.run.state
    c.run.until(c.t + 20)
    assert [e.get("player") for e in c.run.kinds("node_captured")] == [0]
    assert _counts(state, c.a) == (2, 1)
    assert _counts(state, c.d) == (1, 0)
    assert state.groups[c.d].fight is None


def test_row_6_nobody_can_shoot_the_node_is_taken_at_contact() -> None:
    c = _case(1, a=(2, 0), d=(1, 0))
    state, run = c.run.state, c.run
    assert len(run.kinds("fight_started")) == 1
    assert len(run.kinds("fight_ended")) == 1
    assert [e.get("player") for e in run.kinds("node_captured")] == [0]
    assert state.groups[c.d].fight is None
    assert state.groups[c.d].location == OnEdge(1, 1, 66)
    run.step()
    assert state.groups[c.d].location == OnEdge(1, 1, 100)


def test_row_7_a_standing_garrison_holds_after_the_caught_group_left() -> None:
    c = _case(1, a=(4, 4), d=(2, 2), g=(1, 1))
    state, run = c.run.state, c.run
    assert c.g is not None
    run.until(c.t + 20)
    assert _counts(state, c.d) == (2, 1)
    assert state.groups[c.d].fight is None
    assert _counts(state, c.g) == (1, 1)
    assert _counts(state, c.a) == (4, 3)
    assert not run.kinds("node_captured")
    run.until(c.t + 40)
    assert _counts(state, c.g) == (1, 0)
    assert _counts(state, c.a) == (4, 2)
    run.until(c.t + 60)
    assert [e.get("player") for e in run.kinds("node_captured")] == [0]
    assert _counts(state, c.a) == (4, 1)


def test_row_7_before_dec37() -> None:
    c = _case(1, a=(4, 4), d=(2, 2), g=(1, 1), engage=0)
    state, run = c.run.state, c.run
    run.until(c.t + 40)
    assert [e.get("player") for e in run.kinds("node_captured")] == [0]
    assert _counts(state, c.a) == (4, 2)
    assert _counts(state, c.d) == (2, 2)


def test_row_8_a_node_with_a_running_fight_catches_nothing() -> None:
    state = initial_state(_line(), RULES)
    way = leg(state.map, RULES, 0, 1)
    go = Order((1,), False, 0)
    first = _add(state, 0, 3, 3, OnEdge(0, 0, way.progress(way.ticks - 1)), order=go)
    _add(state, 1, 2, 2, AtNode(1))
    d = _add(state, 1, 2, 2, AtNode(1))
    a = _add(state, 0, 2, 2, OnEdge(0, 0, way.progress(way.ticks - 22)), order=go)
    run = _Run(state, RULES)
    run.step()  # tick 1: the fight in node 1 starts
    assert len(state.fights) == 1
    fight_id = state.groups[first].fight
    run.step((1, Move(d, 2, False)))  # D leaves after the round of tick 21
    run.until(21)
    assert state.groups[d].fight is None
    assert state.groups[d].location == OnEdge(1, 1, 0)
    run.step()  # tick 22: A arrives and joins the running fight (DEC-24, D1)
    assert state.groups[a].fight == fight_id
    assert state.groups[d].fight is None
    assert state.groups[d].location == OnEdge(1, 1, 33)
    assert not run.kinds("fight_started")


def test_row_9_leaving_toward_the_attacker_is_an_edge_meeting() -> None:
    c = _case(1, toward=0)
    started = c.run.kinds("fight_started")
    assert [(e.get("node"), e.get("edge")) for e in started] == [(None, 0)]


def test_row_10_mirror() -> None:
    c = _case(0, mirror=True)
    run, state = c.run, c.run.state
    assert [e.get("node") for e in run.kinds("fight_started")] == [2]
    assert state.groups[c.d].location == OnEdge(1, 2, 33)
    run.until(c.t + 20)
    assert [e.get("player") for e in run.kinds("node_captured")] == [1]
    assert _counts(state, c.a) == (3, 2)
    assert _counts(state, c.d) == (2, 1)
    assert state.groups[c.d].fight is None


# Commands, the view, the canonical form --------------------------------------------------------


def test_commands_to_a_caught_group() -> None:
    c = _case(1)
    out = c.run.step((1, CancelOrder(c.d)), (1, Move(c.d, 3, False)))
    assert out == [Reject(RejectCode.NOTHING_TO_CANCEL), Reject(RejectCode.GROUP_ON_EDGE)]


def test_view_counts_the_caught_group_in_the_fight() -> None:
    c = _case(1)
    state = c.run.state
    for p in (0, 1):
        view = project(state, c.run.rules, p, KEY)
        assert len(view.fights) == 1
        f = view.fights[0]
        if p == 1:
            assert len(f.groups) == 1
        else:
            assert (f.enemy_units, f.enemy_charged) == (2, 2)
        enemy_figures = [x for e in view.edges for x in e.enemy_groups]
        assert not enemy_figures  # a group in a fight is shown by the fight (DEC-33)


def test_canonical_round_trip_with_a_caught_group() -> None:
    c = _case(1)
    state = c.run.state
    assert to_canonical(from_canonical(to_canonical(state))) == to_canonical(state)
