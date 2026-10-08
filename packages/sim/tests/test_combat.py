"""Combat (SIM-09): the DEC-07 table, one test per row, run through the real systems.

Expected values come only from ``packages/protocol/vectors/combat.json`` (the DEC-07 table of
mechanics.md, section 4, with a derivation in each ``note``), never from the code.

Every row is played on a line ``home_0 - 1 - home_1`` (edges ``0: home_0-1`` and ``1: 1-home_1``,
forest, 30 ticks per edge): side ``a`` of the row is player 0 or player 1 (both are run, so
the order of the players changes nothing, rule 8), ``b`` the other one. The groups are placed
one tick before the event of the row, then one tick of ``movement`` and ``combat`` runs:

- ``node_attack`` and ``empty_enemy_node``: node 1 belongs to ``b`` whose groups stand there;
  ``a`` arrives over its edge;
- ``neutral_arrival``: node 1 is neutral, both arrive at once over their own edges;
- ``edge_meeting``: both go along ``a``'s edge towards each other, 14 of 30 ticks done each
  (466 + 466 < 1000); after the tick 500 + 500 = 1000, so they meet (rule 6).

Rules: the pinned ``tests/rulesets/dec07.toml``, so balance changes of ``mvp-0`` do not break it.
"""

import json
from pathlib import Path
from typing import Any

import pytest

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
    initial_state,
)
from gow_sim.systems.combat import Bonus, BonusSource, combat
from gow_sim.systems.movement import movement, traversal_ticks

TESTS_DIR = Path(__file__).resolve().parent
VECTORS = json.loads(
    (TESTS_DIR.parents[1] / "protocol" / "vectors" / "combat.json").read_text(encoding="utf-8")
)
RULES = load_ruleset(TESTS_DIR / "rulesets" / "dec07.toml")
TRAVEL = 30


def _node(i: int, terrain: str, owner: int | None) -> dict[str, Any]:
    return {
        "id": i,
        "x": 10 * i,
        "y": 10,
        "terrain": terrain,
        "vp": 1,
        "base_capacity": 20,
        "capital_of": None,
        "start_owner": owner,
        "start_units": 0,
        "start_charged": 0,
        "start_stock": 0,
    }


def line(terrains: list[str], owners: list[int | None]) -> MapDef:
    """A path graph ``0 - 1 - ... - n-1``, capitals at the ends, ``TRAVEL`` ticks per edge."""
    n = len(terrains)
    nodes = [_node(i, terrains[i], owners[i]) for i in range(n)]
    nodes[0]["capital_of"], nodes[-1]["capital_of"] = 0, 1
    edges = [
        {"id": i, "a": i, "b": i + 1, "base_width": 1, "max_width": 3, "travel_ticks": TRAVEL}
        for i in range(n - 1)
    ]
    data = {
        "meta": {"name": "line", "version": 1, "symmetry": "rot180", "width": 1000, "height": 20},
        "nodes": nodes,
        "edges": edges,
        "mirror": {
            "nodes": {str(i): n - 1 - i for i in range(n)},
            "edges": {str(i): n - 2 - i for i in range(n - 1)},
        },
    }
    return parse_map(data)


def add(
    state: GameState, owner: int, units: int, charged: int, loc: AtNode | OnEdge, **kw: Any
) -> int:
    gid = state.new_id()
    state.groups[gid] = Group(gid, owner, units, charged, kw.pop("mode", Mode.ATTACK), loc, **kw)
    return gid


def step(state: GameState, bonuses: dict[int, Bonus] | None = None) -> list[Event]:
    """One tick of the fixed order's movement and combat; returns the combat events."""
    state.tick += 1
    state.events = movement(state, RULES)
    fought = combat(state, RULES, bonuses)
    state.events += fought
    return fought


def before_arrival(state: GameState, edge: int, from_node: int) -> OnEdge:
    """On ``edge`` from ``from_node``, one tick before arriving at the other end."""
    to = state.map.edges[edge].other(from_node)
    ticks = traversal_ticks(state.map, RULES, edge, to)
    return OnEdge(edge, from_node, (ticks - 1) * PROGRESS_SCALE // ticks)


def the(events: list[Event], kind: str) -> Event:
    (found,) = [e for e in events if e.kind == kind]
    return found


# The DEC-07 table -----------------------------------------------------------------------------


def test_vector_params_are_the_pinned_ruleset() -> None:
    params = VECTORS["params"]
    mod = RULES.terrain.defense_mod
    assert params["terrain_defense_mod"] == {
        "mountains": mod.mountains,
        "forest": mod.forest,
        "plains": mod.plains,
    }
    assert params["planned_bonus"] == RULES.orders.planned_bonus
    assert params["defense_bonus"] == RULES.orders.defense_bonus


@pytest.mark.parametrize("a", [0, 1], ids=["a=p0", "a=p1"])
@pytest.mark.parametrize("vec", VECTORS["vectors"], ids=lambda v: f"row{v['id']}")
def test_dec07_row(vec: dict[str, Any], a: int) -> None:
    b = 1 - a
    player = {"a": a, "b": b}
    loc = vec["location"]
    owner_1 = {"a": a, "b": b, "neutral": None, None: b}[vec["node_owner_before"]]
    mapdef = line(["forest", vec["terrain"] or "forest", "forest"], [0, owner_1, 1])
    state = initial_state(mapdef, RULES)
    home = {0: 0, 1: 2}
    edge_of = {0: 0, 1: 1}  # the edge from a player's home to node 1
    ids: dict[int, int] = {}
    bonuses: dict[int, Bonus] = {}
    for side in ("a", "b"):
        p = player[side]
        spec = vec["sides"][side]
        for g in spec["groups"]:
            if loc in ("node_attack", "empty_enemy_node") and side == "b":
                where: AtNode | OnEdge = AtNode(1)
                order = None
            elif loc == "edge_meeting":
                e = edge_of[a]
                start = home[a] if side == "a" else 1
                where = OnEdge(e, start, 14 * PROGRESS_SCALE // TRAVEL)
                order = Order((mapdef.edges[e].other(start),), False, 0)
            else:
                where = before_arrival(state, edge_of[p], home[p])
                order = Order((1,), False, 0)
            gid = add(state, p, g["units"], g["charged"], where, mode=Mode(g["mode"]), order=order)
            ids[g["id"]] = gid
            if spec["bonus"] is not None:
                bonuses[gid] = Bonus(BonusSource(spec["bonus"]["source"]), spec["bonus"]["amount"])

    events = step(state, bonuses)

    exp = vec["expected"]
    fights = [e for e in events if e.kind == "fight"]
    if exp["pool"] is None:
        assert fights == []
    else:
        (fight,) = fights
        for side in ("a", "b"):
            assert fight.get(f"pool_{player[side]}") == exp["pool"][side], side
            assert fight.get(f"losses_{player[side]}") == exp["losses"][side], side
    for side in ("a", "b"):
        p = player[side]
        for g in exp["groups"][side]:
            gid = ids[g["id"]]
            if g["units"] == 0:
                assert gid not in state.groups
                continue
            group = state.groups[gid]
            assert (group.units, group.charged) == (g["units"], g["charged"]), g["id"]
            bounced = isinstance(group.location, OnEdge) and group.location.back
            assert bounced == exp["bounce"][side], side
            if bounced:  # back along the same edge to the node it came from (rules 4-6)
                assert isinstance(group.location, OnEdge)
                assert group.location.edge == edge_of[a if loc == "edge_meeting" else p]
            if exp["continues_on_edge"] is not None:
                goes_on = isinstance(group.location, OnEdge) and not group.location.back
                assert goes_on == exp["continues_on_edge"][side], side
    after = exp["node_owner_after"]
    if after is not None:
        assert state.nodes[1].owner == {"a": a, "b": b, "neutral": None}[after]


# Rules 4-9 beyond the table ------------------------------------------------------------------
#
# Worked out by hand from DEC-07 and the defaults of #133 (group choice per shot and per loss,
# a bounce retraces its steps, two bouncing groups do not meet).


def test_rule7_several_groups_sum_and_choose_by_charged_units_and_id() -> None:
    """Attack A1 (3/3) + A2 (2/2) on D1 (4 units, 1 charged) + D2 (2/2), forest.

    Qa = 5, Qd = 3, c = 3. Attack shots, each from the group with the most charged (tie: lower
    id): A1 3 -> 2, tie 2/2 -> A1 1, A2 2 -> 1. Defence: D2 2 -> 1, tie 1/1 -> D1 0, D2 0.
    s = 2: shots A1 (tie 1/1) -> 0, A2 -> 0; losses, discharged first, the group with the most
    units: D1 4 -> 3, D1 3 -> 2. D1 (2/0), D2 (2/0) survive: both attack groups bounce, each
    group stays separate (no free merge).
    """
    state = initial_state(line(["forest"] * 3, [0, 1, 1]), RULES)
    d1 = add(state, 1, 4, 1, AtNode(1))
    d2 = add(state, 1, 2, 2, AtNode(1))
    a1 = add(state, 0, 3, 3, before_arrival(state, 0, 0), order=Order((1,), False, 0))
    a2 = add(state, 0, 2, 2, before_arrival(state, 0, 0), order=Order((1,), False, 0))
    fight = the(step(state), "fight")
    assert (fight.get("pool_0"), fight.get("pool_1")) == (5, 3)
    assert (fight.get("losses_0"), fight.get("losses_1")) == (0, 2)
    counts = {g: (state.groups[g].units, state.groups[g].charged) for g in (a1, a2, d1, d2)}
    assert counts == {a1: (3, 0), a2: (2, 0), d1: (2, 0), d2: (2, 0)}
    for g in (a1, a2):
        assert state.groups[g].location == OnEdge(0, 0, PROGRESS_SCALE, back=True)
    assert state.nodes[1].owner == 1


def test_rule4_bounce_goes_back_along_the_edge_as_long_as_the_way_there() -> None:
    """Row 1 at a mountain node: the way there takes 30 * 100 // 70 = 42 ticks, so does the way
    back (rule 4; #133: a bounce retraces its steps), then the group stands at home."""
    state = initial_state(line(["forest", "mountains", "forest"], [0, 1, 1]), RULES)
    add(state, 1, 2, 2, AtNode(1))
    a = add(state, 0, 2, 2, before_arrival(state, 0, 0), order=Order((1,), False, 0))
    step(state)
    bounced_at = state.tick
    assert state.groups[a].location == OnEdge(0, 0, PROGRESS_SCALE, back=True)
    assert state.groups[a].order is None
    while state.tick < bounced_at + 41:
        assert step(state) == []
        assert isinstance(state.groups[a].location, OnEdge)
    step(state)
    assert state.groups[a].location == AtNode(0)
    assert state.nodes[0].owner == 0


def test_rule4_bounce_into_a_node_that_became_foreign_is_an_arrival_with_its_own_fight() -> None:
    """Row 1, then home becomes player 1's with a 1/1 garrison. Coming home the discharged 2/0
    group attacks it: Qa = 0, Qd = 1 (forest 0): one attacker dies, the other bounces again."""
    state = initial_state(line(["forest"] * 3, [0, 1, 1]), RULES)
    add(state, 1, 2, 2, AtNode(1))
    a = add(state, 0, 2, 2, before_arrival(state, 0, 0), order=Order((1,), False, 0))
    step(state)
    state.nodes[0].owner = 1
    add(state, 1, 1, 1, AtNode(0))
    events: list[Event] = []
    while not events:
        events = step(state)
    fight = the(events, "fight")
    assert (fight.get("node"), fight.get("attacker")) == (0, 0)
    assert (fight.get("pool_0"), fight.get("pool_1"), fight.get("losses_0")) == (0, 1, 1)
    assert state.groups[a].units == 1
    assert state.groups[a].location == OnEdge(0, 1, PROGRESS_SCALE, back=True)


def test_rule4_bounce_into_an_empty_foreign_node_takes_it() -> None:
    state = initial_state(line(["forest"] * 3, [0, 1, 1]), RULES)
    add(state, 1, 2, 2, AtNode(1))
    a = add(state, 0, 2, 2, before_arrival(state, 0, 0), order=Order((1,), False, 0))
    step(state)
    state.nodes[0].owner = 1
    for _ in range(TRAVEL):
        step(state)
    assert state.groups[a].location == AtNode(0)
    assert state.nodes[0].owner == 0
    assert any(e.kind == "node_captured" for e in state.events)


def test_rule5_both_bounce_home_from_a_neutral_node() -> None:
    """Row 13: both survive, both go back along their own edges, the node stays neutral."""
    state = initial_state(line(["forest"] * 3, [0, None, 1]), RULES)
    g0 = add(state, 0, 3, 3, before_arrival(state, 0, 0), order=Order((1,), False, 0))
    g1 = add(state, 1, 2, 2, before_arrival(state, 1, 2), order=Order((1,), False, 0))
    step(state)
    assert state.groups[g0].location == OnEdge(0, 0, PROGRESS_SCALE, back=True)
    assert state.groups[g1].location == OnEdge(1, 2, PROGRESS_SCALE, back=True)
    for _ in range(TRAVEL):
        step(state)
    assert (state.groups[g0].location, state.groups[g1].location) == (AtNode(0), AtNode(2))
    assert state.nodes[1].owner is None


@pytest.mark.parametrize(("done0", "done1", "meet"), [(14, 14, True), (14, 13, False)])
def test_rule6_groups_meet_when_progress_sums_to_1000(done0: int, done1: int, meet: bool) -> None:
    """After the tick: 15 * 1000 // 30 = 500 and 500 (sum 1000, they meet) or 500 and
    14 * 1000 // 30 = 466 (sum 966, not yet)."""
    state = initial_state(line(["forest"] * 3, [0, 1, 1]), RULES)
    add(state, 0, 2, 2, OnEdge(0, 0, done0 * 1000 // TRAVEL), order=Order((1,), False, 0))
    add(state, 1, 2, 2, OnEdge(0, 1, done1 * 1000 // TRAVEL), order=Order((0,), False, 0))
    assert any(e.kind == "fight" for e in step(state)) == meet


def test_rule6_bounce_from_mid_edge_lasts_as_long_as_travelled() -> None:
    """Row 11 after 15 ticks each: both bounce and are home 15 ticks later; bouncing groups do
    not meet each other again (#133)."""
    state = initial_state(line(["forest"] * 3, [0, 1, 1]), RULES)
    g0 = add(state, 0, 2, 2, OnEdge(0, 0, 14 * 1000 // TRAVEL), order=Order((1,), False, 0))
    g1 = add(state, 1, 2, 2, OnEdge(0, 1, 14 * 1000 // TRAVEL), order=Order((0,), False, 0))
    step(state)
    met_at = state.tick
    while state.tick < met_at + 14:
        assert step(state) == []
        assert isinstance(state.groups[g0].location, OnEdge)
    step(state)
    assert (state.groups[g0].location, state.groups[g1].location) == (AtNode(0), AtNode(1))
    assert (state.groups[g0].charged, state.groups[g1].charged) == (0, 0)


def test_rule6_edge_meeting_comes_before_the_arrival_in_the_same_tick() -> None:
    """Node 1 of player 1 is empty; its group left it one tick ago (33 of 1000 now). Player 0
    arrives in this tick (1000 + 66 >= 1000): the edge fight (2/2 vs 2/2, a draw) comes first,
    both bounce, so the empty node is not taken (row 5 would take it)."""
    state = initial_state(line(["forest"] * 3, [0, 1, 1]), RULES)
    a = add(state, 0, 2, 2, before_arrival(state, 0, 0), order=Order((1,), False, 0))
    b = add(state, 1, 2, 2, OnEdge(0, 1, 1000 // TRAVEL), order=Order((0,), False, 0))
    fight = the(step(state), "fight")
    assert (fight.get("edge"), fight.get("node")) == (0, None)
    assert state.nodes[1].owner == 1
    assert state.groups[a].location == OnEdge(0, 0, PROGRESS_SCALE, back=True)
    assert state.groups[b].location == OnEdge(0, 1, 2 * 1000 // TRAVEL, back=True)


def test_rule6_winner_arriving_goes_on_into_the_node() -> None:
    """As above with 3/3 against 1/1 (row 12): player 1's group dies, player 0 goes on with
    3/1 into the empty node and takes it (row 5)."""
    state = initial_state(line(["forest"] * 3, [0, 1, 1]), RULES)
    a = add(state, 0, 3, 3, before_arrival(state, 0, 0), order=Order((1,), False, 0))
    add(state, 1, 1, 1, OnEdge(0, 1, 1000 // TRAVEL), order=Order((0,), False, 0))
    step(state)
    assert state.groups[a].location == AtNode(1)
    assert (state.groups[a].units, state.groups[a].charged) == (3, 1)
    assert state.nodes[1].owner == 0


def test_rule3_bonus_burns_in_the_edge_meeting_and_not_again_in_the_node() -> None:
    """2/2 with a planned bonus (+2) meets 1/1 on the edge in its arrival tick: Qa = 4, Qe = 1,
    both virtual shots spent (1 cancels, 1 kills), 2/2 goes on into node 1 held by 2/2. There the
    bonus is gone (rule 3, SIM-10): 2 against 2 is row 1, no losses, the attack bounces."""
    state = initial_state(line(["forest"] * 3, [0, 1, 1]), RULES)
    a = add(state, 0, 2, 2, before_arrival(state, 0, 0), order=Order((1,), True, 0))
    add(state, 1, 1, 1, OnEdge(0, 1, 1000 // TRAVEL), order=Order((0,), False, 0))
    d = add(state, 1, 2, 2, AtNode(1))
    fights = [e for e in step(state, {a: Bonus(BonusSource.PLANNED_ORDER, 2)}) if e.kind == "fight"]
    assert [(f.get("pool_0"), f.get("pool_1")) for f in fights] == [(4, 1), (2, 2)]
    assert (state.groups[d].units, state.groups[d].charged) == (2, 0)
    assert (state.groups[a].units, state.groups[a].charged) == (2, 0)
    assert state.nodes[1].owner == 1


def test_rule9_nobody_flees() -> None:
    """Row 4: the 9 discharged defenders and the bounced attacker stay where they end up."""
    state = initial_state(line(["forest"] * 3, [0, 1, 1]), RULES)
    d = add(state, 1, 10, 0, AtNode(1))
    a = add(state, 0, 1, 1, before_arrival(state, 0, 0), order=Order((1,), False, 0))
    step(state)
    for _ in range(3 * TRAVEL):
        step(state)
    assert state.groups[d].location == AtNode(1)
    assert state.groups[d].units == 9
    assert state.groups[a].location == AtNode(0)


# #175: a bounce home that meets an enemy on the way ----------------------------------------------


def test_rule4_and_6_bounce_home_meeting_an_enemy_then_attacking_the_lost_home() -> None:
    """#175. Player 0's 2/1 bounces home to node 0, which became player 1's (1/1 garrison D).
    In the tick it arrives, player 1's 1/1 leaves node 0 along the same edge (33 of 1000):
    they meet first (rule 6, 1000 + 33 >= 1000), 1 against 1 is a draw, both bounce. The
    bounce of player 0's group takes it where it was going anyway, home: an ordinary arrival
    with its own fight (rule 4). There Qa = 0, Qd = 1 (forest 0): one attacker dies, D spends
    its charge; the attacker survives and bounces again (row 4), back along edge 0 to node 1,
    the node it came from. Player 1's group bounces back to node 0 (rule 6)."""
    state = initial_state(line(["forest"] * 3, [0, 1, 1]), RULES)
    state.nodes[0].owner = 1
    d = add(state, 1, 1, 1, AtNode(0))
    a = add(state, 0, 2, 1, OnEdge(0, 0, 1000 // TRAVEL, back=True))
    b = add(state, 1, 1, 1, AtNode(0), order=Order((1,), False, 0))
    fights = [e for e in step(state) if e.kind == "fight"]
    assert [(f.get("edge"), f.get("node"), f.get("pool_0"), f.get("pool_1")) for f in fights] == [
        (0, None, 1, 1),
        (None, 0, 0, 1),
    ]
    assert (state.groups[a].units, state.groups[a].charged) == (1, 0)
    assert state.groups[a].location == OnEdge(0, 1, PROGRESS_SCALE, back=True)
    assert (state.groups[d].units, state.groups[d].charged) == (1, 0)
    assert state.groups[b].location == OnEdge(0, 0, 1000 // TRAVEL, back=True)
    assert state.nodes[0].owner == 1


def test_rule6_a_meeting_happens_once_the_winner_goes_on() -> None:
    """#175. Player 0's discharged 2/0 bounces home to node 0 along edge 0 (now 500 of the way
    from node 0); player 1's 2/1 goes from node 0 to node 1 (466). After the tick 466 and 500:
    they pass each other (534 + 500 >= 1000), 1 against 0 kills one unit of the bouncing
    group. The loser goes on home, the winner goes on to node 1 (rule 6): they have passed each
    other and do not meet again, so the winner is in node 1 after its 30 ticks on the edge.
    (The loser is home after its 15 ticks and takes the empty node 0, row 5.)"""
    state = initial_state(line(["forest"] * 3, [0, 1, 1]), RULES)
    state.nodes[0].owner = 1
    a = add(state, 0, 2, 0, OnEdge(0, 0, 500, back=True))
    b = add(state, 1, 2, 1, OnEdge(0, 0, 14 * 1000 // TRAVEL), order=Order((1,), False, 0))
    fought = [e for e in step(state) if e.kind == "fight"]
    assert [(f.get("pool_0"), f.get("pool_1"), f.get("losses_0")) for f in fought] == [(0, 1, 1)]
    for _ in range(TRAVEL - 15 - 1):
        assert not any(e.kind == "fight" for e in step(state))
        loc = state.groups[b].location
        assert isinstance(loc, OnEdge) and not loc.back
    step(state)
    assert state.groups[b].location == AtNode(1)
    assert (state.groups[b].units, state.groups[b].charged) == (2, 0)
    assert state.groups[a].units == 1
    assert (state.groups[a].location, state.nodes[0].owner) == (AtNode(0), 0)


def test_rule6_a_bounce_right_after_passing_through_is_back_at_once() -> None:
    """#175. Player 0 goes 0 -> 2 through its own node 1; in the tick it passes node 1 it is on
    edge 1 with progress 0, and player 1's 2/2 arrives at node 1 over edge 1 (0 + 1000 >= 1000).
    Row 11 (2 against 2 on the edge): both bounce. A bounce lasts as long as the way travelled
    (rule 6): zero ticks for player 0, which stands in node 1 at once; player 1 goes back the
    whole edge to node 2."""
    state = initial_state(line(["forest"] * 3, [0, 0, 1]), RULES)
    a = add(state, 0, 2, 2, before_arrival(state, 0, 0), order=Order((1, 2), False, 0))
    b = add(state, 1, 2, 2, before_arrival(state, 1, 2), order=Order((1,), False, 0))
    fight = the(step(state), "fight")
    assert (fight.get("edge"), fight.get("pool_0"), fight.get("pool_1")) == (1, 2, 2)
    assert state.groups[a].location == AtNode(1)
    assert state.groups[a].order is None
    assert state.groups[b].location == OnEdge(1, 2, PROGRESS_SCALE, back=True)
    assert state.nodes[1].owner == 0
