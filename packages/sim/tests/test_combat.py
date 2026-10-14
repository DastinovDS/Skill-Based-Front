"""Combat over time (DEC-24): the worked examples of mechanics.md, section 4, run through the real
systems.

Expected values come only from ``packages/protocol/vectors/combat.json`` (the DEC-24 tables of
mechanics.md: rows 1-16 in ``vectors``, rows 17-23 in ``scenarios``), never from the code.

Rows 1-16 are played on a line ``home_0 - 1 - home_1`` (edges ``0: home_0-1`` and ``1: 1-home_1``,
forest, 30 ticks per edge): side ``a`` of the row is player 0 or player 1 (both are run, so the
order of the players changes nothing), ``b`` the other one. The groups are placed one tick before
the contact, which is then tick ``t = 1``:

- ``node_attack`` and ``empty_enemy_node``: node 1 belongs to ``b`` whose groups stand there;
  ``a`` arrives over its edge;
- ``neutral_arrival``: node 1 is neutral, both arrive at once over their own edges;
- ``edge_meeting``: both go along ``a``'s edge towards each other, 14 of 30 ticks done each
  (466 + 466 < 1000); after the tick 500 + 500 = 1000, so they meet.

Every tick runs the commands, ``movement``, ``combat`` with the active bonuses and ``orders``.
Rules: the pinned ``tests/rulesets/dec07.toml`` (with its ``[combat]`` section), so balance
changes of ``mvp-0`` do not break it.
"""

import json
from pathlib import Path
from typing import Any

import pytest

from gow_sim.commands import CancelOrder, Move, PlayerCommand, apply_commands
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
from gow_sim.systems.combat import combat
from gow_sim.systems.movement import leg, movement
from gow_sim.systems.orders import active_bonuses, orders

TESTS_DIR = Path(__file__).resolve().parent
VECTORS = json.loads(
    (TESTS_DIR.parents[1] / "protocol" / "vectors" / "combat.json").read_text(encoding="utf-8")
)
SCENARIOS = {s["id"]: s["expected"] for s in VECTORS["scenarios"]}
RULES = load_ruleset(TESTS_DIR / "rulesets" / "dec07.toml")
TRAVEL = 30


def _node(i: int, terrain: str, owner: int | None) -> dict[str, Any]:
    return {
        "id": i,
        "x": 10 * i,
        "y": 10,
        "terrain": terrain,
        "vp": 1,
        "kind": "city_large",
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
    nodes[0]["kind"] = nodes[-1]["kind"] = "capital"
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


def step(state: GameState, commands: list[PlayerCommand] | None = None) -> list[Event]:
    """One tick: the commands, then ``movement``, ``combat`` and ``orders``; returns its events."""
    state.tick += 1
    state.events = []
    _, applied = apply_commands(state, RULES, commands or [])
    state.events += applied
    state.events += movement(state, RULES)
    state.events += combat(state, RULES, active_bonuses(state))
    state.events += orders(state, RULES)
    return list(state.events)


def run_until(state: GameState, kind: str, limit: int = 200) -> Event:
    """Step until an event of ``kind``; returns it (the tick is ``state.tick``)."""
    for _ in range(limit):
        found = [e for e in step(state) if e.kind == kind]
        if found:
            return found[0]
    raise AssertionError(f"no {kind} in {limit} ticks")


def before_arrival(state: GameState, edge: int, from_node: int) -> OnEdge:
    """On ``edge`` from ``from_node``, one tick before arriving at the other end."""
    to = state.map.edges[edge].other(from_node)
    way = leg(state.map, RULES, edge, to)
    return OnEdge(edge, from_node, way.progress(way.ticks - 1))


def kinds(events: list[Event], kind: str) -> list[Event]:
    return [e for e in events if e.kind == kind]


def charged_of(state: GameState, player: int) -> int:
    return sum(g.charged for g in state.groups.values() if g.owner == player)


def units_of(state: GameState, player: int) -> int:
    return sum(g.units for g in state.groups.values() if g.owner == player)


# Rows 1-16 ------------------------------------------------------------------------------------


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
    assert params["round_ticks"] == RULES.combat.round_ticks
    assert params["shots_per_round"] == RULES.combat.shots_per_round
    assert params["regroup_ticks"] == RULES.combat.regroup_ticks


@pytest.mark.parametrize("a", [0, 1], ids=["a=p0", "a=p1"])
@pytest.mark.parametrize("vec", VECTORS["vectors"], ids=lambda v: f"row{v['id']}")
def test_dec24_row(vec: dict[str, Any], a: int) -> None:
    b = 1 - a
    player = {"a": a, "b": b}
    loc = vec["location"]
    owner_1 = {"a": a, "b": b, "neutral": None, None: b}[vec["node_owner_before"]]
    mapdef = line(["forest", vec["terrain"] or "forest", "forest"], [0, owner_1, 1])
    state = initial_state(mapdef, RULES)
    home = {0: 0, 1: 2}
    edge_of = {0: 0, 1: 1}  # the edge from a player's home to node 1
    ids: dict[int, int] = {}
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
            bonus = spec["bonus"]
            if bonus is not None and bonus["source"] == "planned_order":
                order = Order((1,), True, 0)
            gid = add(state, p, g["units"], g["charged"], where, mode=Mode(g["mode"]), order=order)
            if bonus is not None:
                state.groups[gid].bonus = bonus["amount"]
            ids[g["id"]] = gid

    exp = vec["expected"]
    contact = 1
    events = step(state)
    assert state.tick == contact
    trace = {t["round"]: t["charged"] for t in exp["trace"]}
    ended = kinds(events, "fight_ended")
    if not exp["fight"]:
        assert kinds(events, "fight_started") == []
        assert any(e.kind == "node_captured" for e in events)
    else:
        assert len(kinds(events, "fight_started")) == 1
        rounds = 0
        while not ended:
            events = step(state)
            assert state.tick <= contact + exp["end_after"], "the fight lasts too long"
            if kinds(events, "fight_round"):
                rounds += 1
                assert state.tick == contact + rounds * RULES.combat.round_ticks
                if rounds in trace:
                    got = {s: charged_of(state, player[s]) for s in ("a", "b")}
                    assert got == trace[rounds], f"round {rounds}"
            ended = kinds(events, "fight_ended")
        assert state.tick == contact + exp["end_after"]
        assert rounds == exp["rounds"]
        (end,) = ended
        for side in ("a", "b"):
            assert end.get(f"losses_{player[side]}") == exp["losses"][side], side
        if exp["shots"] is not None:
            for side in ("a", "b"):
                assert end.get(f"shots_{player[side]}") == exp["shots"][side], side
    for side in ("a", "b"):
        p = player[side]
        for g in exp["groups"][side]:
            gid = ids[g["id"]]
            if g["units"] == 0:
                assert gid not in state.groups
                continue
            group = state.groups[gid]
            assert (group.units, group.charged) == (g["units"], g["charged"]), g["id"]
            assert group.fight is None
            bounced = isinstance(group.location, OnEdge) and group.location.back
            assert bounced == exp["bounce"][side], side
            if bounced:  # back along the same edge to the node it came from
                assert isinstance(group.location, OnEdge)
                assert group.location.edge == edge_of[a if loc == "edge_meeting" else p]
            if exp["continues_on_edge"] is not None:
                goes_on = isinstance(group.location, OnEdge) and not group.location.back
                assert goes_on == exp["continues_on_edge"][side], side
                if goes_on and exp["goes_on_after"] is not None:
                    _check_goes_on(state, gid, contact + exp["goes_on_after"])
    after = exp["node_owner_after"]
    if after is not None:
        assert state.nodes[1].owner == {"a": a, "b": b, "neutral": None}[after]
    assert state.fights == {}


def _check_goes_on(state: GameState, gid: int, first_step: int) -> None:
    """The edge winner stands until ``first_step - 1`` and makes a step in ``first_step``."""
    standing = state.groups[gid].location
    while state.tick < first_step - 1:
        step(state)
        assert state.groups[gid].location == standing
    step(state)
    assert state.groups[gid].location != standing


# Rows 17-23 -----------------------------------------------------------------------------------


@pytest.mark.parametrize("row", ["17", "17б"])
def test_row17_a_bounce_into_a_lost_home_does_not_chain(row: str) -> None:
    """L (1, discharged) comes back into its home H, which the enemy's W took meanwhile."""
    exp = SCENARIOS[row]
    state = initial_state(line(["forest"] * 3, [0, 1, 1]), RULES)
    state.nodes[0].owner = 1
    w_charged = 0 if row == "17" else 1
    w = add(state, 1, 2, w_charged, AtNode(0))
    lone = add(state, 0, 1, 0, OnEdge(0, 0, PROGRESS_SCALE // TRAVEL, back=True))
    events = step(state)
    contact = state.tick
    assert len(kinds(events, "fight_started")) == 1
    end = kinds(events, "fight_ended") or [run_until(state, "fight_ended")]
    assert state.tick == contact + exp["end_after"]
    assert end[0].get("captured") is False
    assert lone not in state.groups  # no second bounce towards the enemy (G3)
    assert state.nodes[0].owner == 1
    assert state.groups[w].units == exp["w"]["units"]
    if "charged" in exp["w"]:
        assert state.groups[w].charged == exp["w"]["charged"]
    assert state.fights == {}


def test_row17v_a_bounce_into_an_empty_lost_home_takes_it() -> None:
    exp = SCENARIOS["17в"]
    state = initial_state(line(["forest"] * 3, [0, 1, 1]), RULES)
    state.nodes[0].owner = 1
    lone = add(state, 0, 1, 0, OnEdge(0, 0, PROGRESS_SCALE // TRAVEL, back=True))
    events = step(state)
    assert exp["end_after"] is None and kinds(events, "fight_started") == []
    assert state.groups[lone].location == AtNode(0)
    assert state.nodes[0].owner == 0
    assert kinds(events, "node_captured")


def _edge_race(y_units: int, y_charged: int, x_charged: int = 3) -> tuple[GameState, int, int]:
    """Edge a-b = edge 0 between node 0 (player 0) and node 1 (player 1); X leaves a in tick 1,
    Y leaves b 4 ticks later (rows 18 and 19)."""
    state = initial_state(line(["forest"] * 3, [0, 1, 1]), RULES)
    x = add(state, 0, 3, x_charged, AtNode(0), order=Order((1,), False, 1))
    y = add(state, 1, y_units, y_charged, AtNode(1), order=Order((0,), False, 5))
    return state, x, y


def test_row18_the_fight_point_and_the_regroup() -> None:
    exp = SCENARIOS["18"]
    state, x, y = _edge_race(1, 1)
    start = run_until(state, "fight_started")
    assert state.tick == exp["contact_tick_of_x"]  # X left in tick 1: its 18th tick
    contact = state.tick
    assert start.get("point") == exp["point"]
    assert start.get("edge") == 0 and start.get("node") is None
    assert state.groups[x].location == OnEdge(0, 0, exp["x_progress"])
    assert state.groups[y].location == OnEdge(0, 1, exp["y_progress"])
    (fight,) = state.fights.values()
    assert fight.point == exp["point"]
    run_until(state, "fight_ended")
    assert state.tick == contact + exp["end_after"]
    assert y not in state.groups
    assert state.groups[x].charged == exp["x_charged"]
    _check_goes_on(state, x, contact + exp["first_step_after"])
    while not isinstance(state.groups[x].location, AtNode):
        step(state)
    assert state.tick == contact + exp["arrive_after"]
    assert state.groups[x].location == AtNode(1)


def test_row19_the_race_home() -> None:
    exp = SCENARIOS["19"]
    state, x, y = _edge_race(2, 2)
    run_until(state, "fight_started")
    contact = state.tick
    end = run_until(state, "fight_ended")
    assert state.tick == contact + exp["end_after"]
    assert (end.get("shots_0"), end.get("shots_1")) == (exp["shots"]["x"], exp["shots"]["y"])
    assert end.get("winner") == 0
    assert (state.groups[y].units, state.groups[y].charged) == (
        exp["y"]["units"],
        exp["y"]["charged"],
    )
    loc = state.groups[y].location
    assert isinstance(loc, OnEdge) and loc.back
    while not isinstance(state.groups[y].location, AtNode):
        step(state)
    assert state.tick == contact + exp["y_home_after"]
    assert state.groups[y].location == AtNode(1)
    started = run_until(state, "fight_started")
    assert started.get("node") == 1
    assert state.tick == contact + exp["x_at_b_after"]
    # 0 charges against 0: the fight ends at once and X bounces; b stays player 1's.
    assert kinds(state.events, "fight_ended")
    assert state.groups[x].location == OnEdge(0, 0, PROGRESS_SCALE, back=True)
    assert state.nodes[1].owner == 1


def test_row20_a_reinforcement_into_the_node() -> None:
    exp = SCENARIOS["20"]
    state = initial_state(line(["forest"] * 3, [0, 1, 1]), RULES)
    add(state, 1, 2, 2, AtNode(1))
    atk = add(state, 0, 3, 3, before_arrival(state, 0, 0), order=Order((1,), False, 0))
    way = leg(state.map, RULES, 1, 1)
    arrive = exp["g_arrives_after"]
    add(state, 1, 2, 2, OnEdge(1, 2, way.progress(way.ticks - arrive)), order=Order((1,), False, 0))
    step(state)
    contact = state.tick
    trace = {t["round"]: t["charged"] for t in exp["trace"]}
    while not kinds(state.events, "fight_ended"):
        step(state)
        k, rest = divmod(state.tick - contact, RULES.combat.round_ticks)
        if rest == 0 and k in trace:
            here = [g for g in state.groups.values() if g.location == AtNode(1)]
            got = {s: sum(g.charged for g in here if g.owner == p) for s, p in (("a", 0), ("b", 1))}
            assert got == trace[k]
    assert state.tick == contact + exp["end_after"]
    group = state.groups[atk]
    assert (group.units, group.charged) == (exp["attack"]["units"], exp["attack"]["charged"])
    assert isinstance(group.location, OnEdge) and group.location.back
    assert units_of(state, 1) == exp["defense_units"]
    assert charged_of(state, 1) == exp["defense_charged"]
    assert state.nodes[1].owner == 1


def test_row21_the_defender_withdraws() -> None:
    exp = SCENARIOS["21"]
    state = initial_state(line(["forest"] * 3, [0, 1, 1]), RULES)
    d = add(state, 1, 2, 2, AtNode(1))
    atk = add(state, 0, 4, 4, before_arrival(state, 0, 0), order=Order((1,), False, 0))
    step(state)
    contact = state.tick
    cp = state.players[1].cp
    trace = {t["round"]: t["charged"] for t in exp["trace"]}
    while not kinds(state.events, "fight_ended"):
        due = state.tick + 1 == contact + exp["order_after"]
        cmds = [PlayerCommand(1, 0, Move(d, 2))] if due else []
        step(state, cmds)
        if cmds:
            assert cp - state.players[1].cp == exp["cost"]
        k, rest = divmod(state.tick - contact, RULES.combat.round_ticks)
        if rest == 0 and k in trace:
            assert {"a": charged_of(state, 0), "b": charged_of(state, 1)} == trace[k]
    assert state.tick == contact + exp["end_after"]
    assert state.nodes[1].owner == 0
    group = state.groups[atk]
    assert (group.units, group.charged) == (exp["attack"]["units"], exp["attack"]["charged"])
    assert state.groups[d].units == exp["defense_units"]
    assert isinstance(state.groups[d].location, OnEdge)


def test_row22_the_attack_withdraws() -> None:
    exp = SCENARIOS["22"]
    state = initial_state(line(["forest"] * 3, [0, 1, 1]), RULES)
    d = add(state, 1, 2, 2, AtNode(1), mode=Mode.DEFENSE, bonus=RULES.orders.defense_bonus)
    atk = add(state, 0, 3, 3, before_arrival(state, 0, 0), order=Order((1,), False, 0))
    step(state)
    contact = state.tick
    while not kinds(state.events, "fight_ended"):
        due = state.tick + 1 == contact + exp["cancel_after"]
        step(state, [PlayerCommand(0, 0, CancelOrder(atk))] if due else [])
    assert state.tick == contact + exp["end_after"]
    group = state.groups[atk]
    assert (group.units, group.charged) == (exp["attack"]["units"], exp["attack"]["charged"])
    assert group.location == OnEdge(0, 0, PROGRESS_SCALE, back=True)
    defender = state.groups[d]
    assert (defender.units, defender.charged) == (
        exp["defense"]["units"],
        exp["defense"]["charged"],
    )
    assert defender.bonus == 0  # «Защита» burned with the fight
    assert state.nodes[1].owner == 1


def test_row23_a_reinforcement_on_the_edge() -> None:
    exp = SCENARIOS["23"]
    state, x, y = _edge_race(2, 2, x_charged=2)
    state.groups[x].units = 2
    x2 = add(state, 0, 1, 1, AtNode(0), order=Order((1,), False, 6))
    run_until(state, "fight_started")
    contact = state.tick
    while state.tick < contact + exp["x2_joins_after"]:
        step(state)
        if state.tick == contact + 4:
            assert state.groups[x2].location == OnEdge(0, 0, exp["x2_at_4"])
            assert state.groups[x2].fight is None
    assert state.groups[x2].location == OnEdge(0, 0, exp["x2_progress"])
    assert state.groups[x2].fight is not None
    trace = {t["round"]: t["charged"] for t in exp["trace"]}
    while not kinds(state.events, "fight_ended"):
        step(state)
        k, rest = divmod(state.tick - contact, RULES.combat.round_ticks)
        if rest == 0 and k in trace:
            assert {"a": charged_of(state, 0), "b": charged_of(state, 1)} == trace[k]
    end = kinds(state.events, "fight_ended")[0]
    assert state.tick == contact + exp["end_after"]
    assert (end.get("shots_0"), end.get("shots_1")) == (exp["shots"]["a"], exp["shots"]["b"])
    assert (state.groups[y].units, state.groups[y].charged) == (
        exp["y"]["units"],
        exp["y"]["charged"],
    )
    loc = state.groups[y].location
    assert isinstance(loc, OnEdge) and loc.back
    _check_goes_on(state, x, contact + exp["goes_on_after"])
    loc = state.groups[x2].location
    assert isinstance(loc, OnEdge) and not loc.back and loc.progress > exp["x2_progress"]
