"""DEC-38 (#578): a capture costs a charge (mechanics.md, section 4, the DEC-38 block).

Every row of the DEC-38 table of worked examples is a test here, with the table's expected values:
the column "Result with ``charge_cost = 1``" (or the ``charge_cost`` the row names) and, for row 29,
the column "Today" with ``charge_cost = 0``. The setup is that of the table: the line
``0 - 1 - 2 - 3``, forest, 30 ticks per edge (``T = 30``), ``round_ticks = 20``,
``engage_ticks = 3`` (the pinned ``dec07`` ruleset, ``shots_per_round = 1``); the groups are of
player 0 and arrive in tick ``t = 1``; "a/b" is units / charged. Every row also runs as its rot180
mirror (player 1 doing the same on the mirrored nodes), so the rule stays symmetric.
"""

from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import pytest

from gow_sim.commands import Command, Move, Ok, PlayerCommand, apply_commands, validate
from gow_sim.maps import MapDef, parse_map
from gow_sim.ruleset import Ruleset, RulesetError, load_ruleset, parse_ruleset, to_canonical
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
from gow_sim.systems.victory import EndReason, outcome

ROOT = Path(__file__).resolve().parents[3]
TESTS_DIR = Path(__file__).resolve().parent
BASE = load_ruleset(TESTS_DIR / "rulesets" / "dec07.toml")
T = 30
COSTS = (1, 0)
"""``charge_cost`` of the table (1) and of today's rule (0, row 29)."""
MIRRORS = (False, True)


def _rules(cost: int) -> Ruleset:
    return replace(BASE, capture=replace(BASE.capture, charge_cost=cost))


def _map(kinds: dict[int, str]) -> MapDef:
    """``0 - 1 - 2 - 3``, forest, 30 ticks per edge; capitals 0 (player 0) and 3 (player 1)."""
    nodes: list[dict[str, Any]] = [
        {
            "id": i,
            "name": f"n{i}",
            "x": 10 * i,
            "y": 10,
            "terrain": "forest",
            "vp": 0 if kinds.get(i, "city_large") == "province" else 1,
            "kind": "capital" if i in (0, 3) else kinds.get(i, "city_large"),
            "capital_of": {0: 0, 3: 1}.get(i),
            "start_owner": 0 if i < 2 else 1,
            "start_units": 0,
            "start_charged": 0,
            "start_stock": 0,
        }
        for i in range(4)
    ]
    edges = [
        {"id": i, "a": i, "b": i + 1, "max_level": 3, "travel_ticks": T, "border_permille": 500}
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


class Scene:
    """A row of the table in the frame of player 0; ``mirror`` runs it as its rot180 mirror.

    ``n``, ``e``, ``p`` map a node, an edge and a player of the table to the ones of the run.
    """

    def __init__(
        self,
        owners: tuple[int | None, int | None, int | None, int | None],
        *,
        cost: int,
        mirror: bool,
        provinces: bool = False,
    ) -> None:
        self.mirror = mirror
        self.rules = _rules(cost)
        kinds = {1: "province", 2: "province"} if provinces else {}
        self.state: GameState = initial_state(_map(kinds), self.rules)
        for node, owner in enumerate(owners):
            self.state.nodes[self.n(node)].owner = None if owner is None else self.p(owner)
        self.seq = 0

    def n(self, node: int) -> int:
        return 3 - node if self.mirror else node

    def e(self, edge: int) -> int:
        return 2 - edge if self.mirror else edge

    def p(self, player: int) -> int:
        return 1 - player if self.mirror else player

    def add(self, player: int, units: int, charged: int, loc: AtNode | OnEdge, **kw: Any) -> int:
        state = self.state
        gid = state.new_id()
        mode = kw.pop("mode", Mode.ATTACK)
        state.groups[gid] = Group(gid, self.p(player), units, charged, mode, loc, **kw)
        return gid

    def at(self, player: int, units: int, charged: int, node: int, **kw: Any) -> int:
        return self.add(player, units, charged, AtNode(self.n(node)), **kw)

    def arriving(self, player: int, units: int, charged: int, edge: int, to: int, **kw: Any) -> int:
        """A group one tick before ``to`` on ``edge``: it arrives in tick 1 (``t``)."""
        eid, node = self.e(edge), self.n(to)
        way = leg(self.state.map, self.rules, eid, node)
        frm = self.state.map.edges[eid].other(node)
        planned = kw.pop("planned", False)
        loc = OnEdge(eid, frm, way.progress(way.ticks - 1))
        return self.add(player, units, charged, loc, order=Order((node,), planned, 0), **kw)

    def returning(self, player: int, units: int, charged: int, edge: int, home: int) -> int:
        """A group bouncing home to ``home`` along ``edge``: it arrives there in tick 1."""
        eid, node = self.e(edge), self.n(home)
        far = self.state.map.edges[eid].other(node)
        way = leg(self.state.map, self.rules, eid, far)
        return self.add(player, units, charged, OnEdge(eid, node, way.progress(1), back=True))

    def bounced(self, edge: int, home: int) -> OnEdge:
        """Where a group that could not pay stands in its arrival tick (DEC-38, item 4)."""
        return OnEdge(self.e(edge), self.n(home), PROGRESS_SCALE, back=True)

    def step(self, *cmds: tuple[int, Command]) -> None:
        state, rules = self.state, self.rules
        state.tick += 1
        batch = [PlayerCommand(self.p(pl), i, cmd) for i, (pl, cmd) in enumerate(cmds)]
        _, events = apply_commands(state, rules, batch)
        state.events = events
        state.events += movement(state, rules)
        state.events += combat(state, rules, active_bonuses(state, rules))
        state.events += orders(state, rules)

    def until(self, tick: int) -> None:
        while self.state.tick < tick:
            self.step()

    def kinds(self, kind: str) -> list[Event]:
        return [e for e in self.state.events if e.kind == kind]

    def owner(self, node: int) -> int | None:
        owner = self.state.nodes[self.n(node)].owner
        return None if owner is None else self.p(owner)

    def counts(self, gid: int) -> tuple[int, int]:
        g = self.state.groups[gid]
        return g.units, g.charged

    def captured(self) -> list[tuple[int, int]]:
        """``node_captured`` of this tick as ``(node, player)`` of the table."""
        return [
            (self.n(_int(e, "node")), self.p(_int(e, "player")))
            for e in self.kinds("node_captured")
        ]

    def failed(self) -> list[tuple[int, int, int, str]]:
        """``capture_failed`` of this tick as ``(node, player, group, result)`` of the table."""
        return [
            (
                self.n(_int(e, "node")),
                self.p(_int(e, "player")),
                _int(e, "group"),
                str(e.get("result")),
            )
            for e in self.kinds("capture_failed")
        ]

    def merged(self, node: int) -> list[tuple[int, int]]:
        """The counters of player 0's groups standing in ``node``."""
        at = AtNode(self.n(node))
        return [
            (g.units, g.charged)
            for _, g in sorted(self.state.groups.items())
            if g.location == at and g.owner == self.p(0)
        ]


def _int(e: Event, key: str) -> int:
    value = e.get(key)
    assert isinstance(value, int) and not isinstance(value, bool), (e, key)
    return value


NEUTRAL_1 = (0, None, 1, 1)
"""Node 1 neutral, node 2 player 1's: the empty neutral node of rows 1-4, 7-12, 18, 28."""
ENEMY_1 = (0, 1, 1, 1)
"""Node 1 player 1's: the enemy city of rows 5, 6, 13-17, 24, 27."""

cases = pytest.mark.parametrize(("cost", "mirror"), [(c, m) for c in COSTS for m in MIRRORS])
mirrors = pytest.mark.parametrize("mirror", MIRRORS)


# Empty neutral nodes: rows 1-4, 7-10 ------------------------------------------------------------


def _bounces_home(s: Scene, gid: int) -> None:
    """Row 2: on the edge at 1000 going home in ``t``, home in ``t + 30``."""
    assert s.state.groups[gid].location == s.bounced(0, 0)
    assert s.state.groups[gid].order is None
    s.until(T)
    assert isinstance(s.state.groups[gid].location, OnEdge)
    s.until(1 + T)
    assert s.state.groups[gid].location == AtNode(s.n(0))


@cases
def test_row_1_a_charged_group_takes_an_empty_neutral_city(cost: int, mirror: bool) -> None:
    s = Scene(NEUTRAL_1, cost=cost, mirror=mirror)
    a = s.arriving(0, 2, 2, 0, 1)
    s.step()
    assert s.captured() == [(1, 0)]
    assert s.counts(a) == ((2, 1) if cost else (2, 2))
    assert not s.failed()


@cases
def test_row_2_a_discharged_group_bounces_from_an_empty_neutral_city(
    cost: int, mirror: bool
) -> None:
    s = Scene(NEUTRAL_1, cost=cost, mirror=mirror)
    a = s.arriving(0, 2, 0, 0, 1)
    s.step()
    if not cost:
        assert s.captured() == [(1, 0)]
        assert s.counts(a) == (2, 0)
        return
    assert not s.captured()
    assert s.failed() == [(1, 0, a, "bounce")]
    assert s.owner(1) is None
    _bounces_home(s, a)
    assert s.counts(a) == (2, 0)


@cases
def test_row_3_a_charged_group_takes_an_empty_neutral_province(cost: int, mirror: bool) -> None:
    s = Scene(NEUTRAL_1, cost=cost, mirror=mirror, provinces=True)
    a = s.arriving(0, 1, 1, 0, 1)
    s.step()
    assert s.captured() == [(1, 0)]
    assert s.counts(a) == ((1, 0) if cost else (1, 1))


@cases
def test_row_4_a_discharged_group_bounces_from_an_empty_neutral_province(
    cost: int, mirror: bool
) -> None:
    s = Scene(NEUTRAL_1, cost=cost, mirror=mirror, provinces=True)
    a = s.arriving(0, 1, 0, 0, 1)
    s.step()
    if not cost:
        assert s.captured() == [(1, 0)]
        return
    assert not s.captured()
    assert s.failed() == [(1, 0, a, "bounce")]
    _bounces_home(s, a)
    assert s.counts(a) == (1, 0)


@cases
def test_row_7_two_arrivals_pool_their_charges(cost: int, mirror: bool) -> None:
    s = Scene(NEUTRAL_1, cost=cost, mirror=mirror)
    s.arriving(0, 1, 0, 0, 1)
    s.arriving(0, 2, 1, 0, 1)
    s.step()
    assert s.captured() == [(1, 0)]
    assert s.merged(1) == ([(3, 0)] if cost else [(3, 1)])


@cases
def test_row_8_two_discharged_arrivals_both_bounce(cost: int, mirror: bool) -> None:
    s = Scene(NEUTRAL_1, cost=cost, mirror=mirror)
    a = s.arriving(0, 1, 0, 0, 1)
    b = s.arriving(0, 2, 0, 0, 1)
    s.step()
    if not cost:
        assert s.captured() == [(1, 0)]
        return
    assert not s.captured()
    assert s.failed() == [(1, 0, a, "bounce"), (1, 0, b, "bounce")]
    assert s.owner(1) is None
    for gid in (a, b):
        assert s.state.groups[gid].location == s.bounced(0, 0)


@pytest.mark.parametrize("cost", (2, 0))
@mirrors
def test_row_9_two_charges_one_from_each_group(cost: int, mirror: bool) -> None:
    s = Scene(NEUTRAL_1, cost=cost, mirror=mirror)
    a = s.arriving(0, 2, 1, 0, 1)
    b = s.arriving(0, 1, 1, 0, 1)
    assert a < b  # 2/1 has the smaller id
    s.state.events = []
    s.state.tick += 1
    s.state.events += movement(s.state, s.rules)
    if cost:  # equal ``charged``: the smaller id pays first, then the other one
        assert (s.counts(a), s.counts(b)) == ((2, 0), (1, 0))
    s.state.events += combat(s.state, s.rules, active_bonuses(s.state, s.rules))
    s.state.events += orders(s.state, s.rules)
    assert s.captured() == [(1, 0)]
    assert s.merged(1) == ([(3, 0)] if cost else [(3, 2)])


@pytest.mark.parametrize("cost", (2, 0))
@mirrors
def test_row_10_two_charges_one_group_with_one(cost: int, mirror: bool) -> None:
    s = Scene(NEUTRAL_1, cost=cost, mirror=mirror)
    a = s.arriving(0, 3, 1, 0, 1)
    s.step()
    if not cost:
        assert s.captured() == [(1, 0)]
        return
    assert not s.captured()
    assert s.failed() == [(1, 0, a, "bounce")]
    assert s.counts(a) == (3, 1)
    assert s.state.groups[a].location == s.bounced(0, 0)


# Empty enemy nodes: rows 5, 6, 22-26 ------------------------------------------------------------


@cases
def test_row_5_a_charged_group_takes_an_empty_enemy_city(cost: int, mirror: bool) -> None:
    s = Scene(ENEMY_1, cost=cost, mirror=mirror)
    s.state.nodes[s.n(1)].warehouse = 2
    a = s.arriving(0, 2, 2, 0, 1)
    s.step()
    assert s.captured() == [(1, 0)]
    assert s.counts(a) == ((2, 1) if cost else (2, 2))
    assert [_int(e, "charges") for e in s.kinds("warehouse_lost")] == [2]
    assert not s.kinds("fight_started")


@cases
def test_row_6_a_discharged_group_bounces_from_an_empty_enemy_city(cost: int, mirror: bool) -> None:
    s = Scene(ENEMY_1, cost=cost, mirror=mirror)
    s.state.nodes[s.n(1)].warehouse = 2
    a = s.arriving(0, 3, 0, 0, 1)
    s.step()
    if not cost:
        assert s.captured() == [(1, 0)]
        return
    assert not s.captured()
    assert not s.kinds("warehouse_lost")
    assert s.failed() == [(1, 0, a, "bounce")]
    assert s.owner(1) == 1
    assert s.state.nodes[s.n(1)].warehouse == 2
    _bounces_home(s, a)
    assert s.counts(a) == (3, 0)


def _capital_scene(cost: int, mirror: bool) -> Scene:
    """Player 1's capital 3 is empty; player 0 holds 0..2 and arrives from node 2."""
    return Scene((0, 0, 0, 1), cost=cost, mirror=mirror)


@cases
def test_row_22_a_charged_group_takes_an_empty_enemy_capital(cost: int, mirror: bool) -> None:
    s = _capital_scene(cost, mirror)
    a = s.arriving(0, 1, 1, 2, 3)
    s.step()
    assert s.captured() == [(3, 0)]
    assert s.counts(a) == ((1, 0) if cost else (1, 1))
    result = outcome(s.state, s.rules)
    assert result is not None
    assert result.winner == s.p(0)
    assert result.reason is EndReason.CAPITAL


@cases
def test_row_23_a_discharged_group_does_not_win_by_an_empty_capital(
    cost: int, mirror: bool
) -> None:
    s = _capital_scene(cost, mirror)
    a = s.arriving(0, 3, 0, 2, 3)
    s.step()
    if not cost:
        assert s.captured() == [(3, 0)]
        assert outcome(s.state, s.rules) is not None
        return
    assert not s.captured()
    assert s.failed() == [(3, 0, a, "bounce")]
    assert s.state.groups[a].location == s.bounced(2, 2)
    assert outcome(s.state, s.rules) is None


@cases
def test_row_24_no_discount_for_a_former_own_node(cost: int, mirror: bool) -> None:
    """Node 1 starts as player 0's on the map (``start_owner``); the enemy took it, left it."""
    s = Scene(ENEMY_1, cost=cost, mirror=mirror)
    assert s.state.map.nodes[s.n(1)].start_owner == s.p(0)
    a = s.arriving(0, 2, 0, 0, 1)
    s.step()
    if not cost:
        assert s.captured() == [(1, 0)]
        return
    assert not s.captured()
    assert s.failed() == [(1, 0, a, "bounce")]
    assert s.owner(1) == 1


@cases
def test_row_25_a_discharged_group_dies_in_its_lost_home(cost: int, mirror: bool) -> None:
    """The group bounces home to Y = node 1 over edge 1; the enemy took Y and left it empty."""
    s = Scene(ENEMY_1, cost=cost, mirror=mirror)
    a = s.returning(0, 2, 0, 1, 1)
    s.step()
    if not cost:
        assert s.captured() == [(1, 0)]
        assert s.counts(a) == (2, 0)
        return
    assert not s.captured()
    assert a not in s.state.groups
    assert s.failed() == [(1, 0, a, "encircled")]
    assert s.owner(1) == 1


@cases
def test_row_26_a_charged_returning_group_retakes_its_home(cost: int, mirror: bool) -> None:
    s = Scene(ENEMY_1, cost=cost, mirror=mirror)
    a = s.returning(0, 2, 1, 1, 1)
    s.step()
    assert s.captured() == [(1, 0)]
    assert s.counts(a) == ((2, 0) if cost else (2, 1))
    assert s.state.groups[a].location == AtNode(s.n(1))


# Fights: rows 11-17, 27 -------------------------------------------------------------------------


def _ended(s: Scene) -> tuple[int | None, bool]:
    [e] = s.kinds("fight_ended")
    winner = e.get("winner")
    assert winner is None or isinstance(winner, int)
    captured = e.get("captured")
    assert isinstance(captured, bool)
    return (None if winner is None else s.p(winner)), captured


@cases
def test_row_11_the_survivor_of_a_neutral_fight_cannot_pay(cost: int, mirror: bool) -> None:
    s = Scene(NEUTRAL_1, cost=cost, mirror=mirror)
    a = s.arriving(0, 4, 4, 0, 1)
    b = s.arriving(1, 2, 2, 1, 1)
    s.step()
    assert len(s.kinds("fight_started")) == 1
    s.until(80)
    assert not s.kinds("fight_ended")
    s.step()  # t + 80: r1, r2 cancel; r3, r4 kill
    assert b not in s.state.groups
    assert _ended(s) == (0, not cost)
    if not cost:
        assert s.captured() == [(1, 0)]
        assert s.counts(a) == (4, 0)
        return
    assert not s.captured()
    assert s.owner(1) is None
    assert s.counts(a) == (4, 0)
    assert s.state.groups[a].location == s.bounced(0, 0)
    assert s.failed() == [(1, 0, a, "bounce")]


@cases
def test_row_12_the_survivor_of_a_neutral_fight_pays(cost: int, mirror: bool) -> None:
    s = Scene(NEUTRAL_1, cost=cost, mirror=mirror)
    a = s.arriving(0, 5, 5, 0, 1)
    s.arriving(1, 2, 2, 1, 1)
    s.until(81)
    assert _ended(s) == (0, True)
    assert s.captured() == [(1, 0)]
    assert s.counts(a) == ((5, 0) if cost else (5, 1))


@cases
def test_row_13_the_attack_destroys_the_defense_and_cannot_pay(cost: int, mirror: bool) -> None:
    s = Scene(ENEMY_1, cost=cost, mirror=mirror)
    a = s.arriving(0, 4, 4, 0, 1)
    d = s.at(1, 2, 2, 1)
    s.until(81)
    assert d not in s.state.groups
    assert _ended(s) == (0, not cost)
    if not cost:
        assert s.captured() == [(1, 0)]
        assert s.counts(a) == (4, 0)
        return
    assert not s.captured()
    assert s.owner(1) == 1
    assert not s.merged(1)
    assert s.counts(a) == (4, 0)
    assert s.state.groups[a].location == s.bounced(0, 0)
    assert s.failed() == [(1, 0, a, "bounce")]


@cases
def test_row_14_the_attack_keeps_a_charge_and_pays(cost: int, mirror: bool) -> None:
    s = Scene(ENEMY_1, cost=cost, mirror=mirror)
    a = s.arriving(0, 5, 5, 0, 1)
    s.at(1, 2, 2, 1)
    s.until(41)
    assert s.counts(a) == (5, 3)  # r1 (t+20), r2 (t+40) cancel
    s.until(81)
    assert _ended(s) == (0, True)
    assert s.captured() == [(1, 0)]
    assert s.counts(a) == ((5, 0) if cost else (5, 1))


@cases
def test_row_15_virtual_charges_do_not_pay(cost: int, mirror: bool) -> None:
    s = Scene(ENEMY_1, cost=cost, mirror=mirror)
    a = s.arriving(0, 2, 2, 0, 1, planned=True, bonus=2)
    s.at(1, 2, 2, 1)
    s.until(81)
    assert _ended(s) == (0, not cost)
    assert s.counts(a) == (2, 0)
    if not cost:
        assert s.captured() == [(1, 0)]
        return
    assert not s.captured()
    assert s.owner(1) == 1
    assert s.state.groups[a].location == s.bounced(0, 0)
    assert s.failed() == [(1, 0, a, "bounce")]


@cases
def test_row_16_a_virtual_shot_kills_a_real_charge_pays(cost: int, mirror: bool) -> None:
    s = Scene(ENEMY_1, cost=cost, mirror=mirror)
    a = s.arriving(0, 3, 3, 0, 1, planned=True, bonus=2)
    s.at(1, 1, 0, 1)
    s.until(21)
    assert _ended(s) == (0, True)
    assert s.captured() == [(1, 0)]
    assert s.counts(a) == ((3, 2) if cost else (3, 3))
    assert s.state.groups[a].bonus == 0  # the unused bonus burns


@cases
def test_row_17_defense_without_a_charge(cost: int, mirror: bool) -> None:
    s = Scene(ENEMY_1, cost=cost, mirror=mirror)
    a = s.arriving(0, 3, 3, 0, 1)
    s.at(1, 2, 0, 1, mode=Mode.DEFENSE, ticks_in_defense=120)  # "Defense" (+2)
    s.until(21)
    assert not s.kinds("fight_ended")
    s.until(41)
    assert _ended(s) == (0, True)
    assert s.captured() == [(1, 0)]
    assert s.counts(a) == ((3, 0) if cost else (3, 1))


@pytest.mark.parametrize("charged", (1, 0))
@cases
def test_row_27_the_last_defender_leaves_by_a_move(charged: int, cost: int, mirror: bool) -> None:
    """DEC-24, E5: the defender 1/1 withdraws after r1; the attacker 2/(charged + 1) cancels
    one charge in r1 and is 2/1 or 2/0 when the fight ends (``t + 20``)."""
    s = Scene(ENEMY_1, cost=cost, mirror=mirror)
    a = s.arriving(0, 2, charged + 1, 0, 1)
    d = s.at(1, 1, 1, 1)
    s.step()
    s.step((1, Move(d, s.n(2), False)))
    s.until(21)
    assert s.state.groups[d].fight is None
    if charged or not cost:
        assert _ended(s) == (0, True)
        assert s.captured() == [(1, 0)]
        assert s.counts(a) == (2, 0 if cost else charged)
        return
    assert _ended(s) == (0, False)
    assert not s.captured()
    assert s.owner(1) == 1
    assert s.state.groups[a].location == s.bounced(0, 0)
    assert s.failed() == [(1, 0, a, "bounce")]


# A planned order into an empty node: row 18 -----------------------------------------------------


@cases
def test_row_18_a_planned_bonus_does_not_pay_an_empty_node(cost: int, mirror: bool) -> None:
    s = Scene(NEUTRAL_1, cost=cost, mirror=mirror)
    a = s.arriving(0, 2, 0, 0, 1, planned=True, bonus=2)
    s.step()
    if not cost:
        assert s.captured() == [(1, 0)]
        return
    assert not s.captured()
    assert s.failed() == [(1, 0, a, "bounce")]
    assert s.state.groups[a].location == s.bounced(0, 0)
    assert s.state.groups[a].bonus == 0  # the bonus burns


# DEC-37: rows 19-21 -----------------------------------------------------------------------------


@dataclass
class _Zone:
    s: Scene
    a: int
    d: int
    g: int | None
    t: int


def _zone(
    lead: int,
    a: tuple[int, int],
    d: tuple[int, int],
    g: tuple[int, int] | None = None,
    *,
    cost: int,
    mirror: bool,
) -> _Zone:
    """The DEC-37 setup: D of player 1 leaves node 1 toward node 2 by a ``Move`` ``lead`` ticks
    before A of player 0 arrives from node 0 (in tick ``t = 1 + lead``); G stays."""
    s = Scene(ENEMY_1, cost=cost, mirror=mirror)
    eid = s.e(0)
    way = leg(s.state.map, s.rules, eid, s.n(1))
    loc = OnEdge(eid, s.n(0), way.progress(way.ticks - 1 - lead))
    gid_a = s.add(0, *a, loc, order=Order((s.n(1),), False, 0))
    gid_d = s.at(1, *d, 1)
    gid_g = None if g is None else s.at(1, *g, 1)
    s.step((1, Move(gid_d, s.n(2), False)))
    s.until(1 + lead)
    return _Zone(s, gid_a, gid_d, gid_g, 1 + lead)


@cases
def test_row_19_dec37_row_1(cost: int, mirror: bool) -> None:
    z = _zone(0, (3, 3), (2, 2), cost=cost, mirror=mirror)
    s = z.s
    assert not s.captured()
    s.until(z.t + 20)
    assert s.counts(z.d) == (2, 1)
    assert s.state.groups[z.d].fight is None
    assert s.captured() == [(1, 0)]
    assert s.counts(z.a) == ((3, 1) if cost else (3, 2))


@cases
def test_row_20_dec37_row_6_nobody_can_shoot(cost: int, mirror: bool) -> None:
    z = _zone(1, (2, 0), (1, 0), cost=cost, mirror=mirror)
    s = z.s
    assert len(s.kinds("fight_started")) == 1
    assert len(s.kinds("fight_ended")) == 1
    assert s.state.groups[z.d].fight is None  # D is released
    if not cost:
        assert s.captured() == [(1, 0)]
        return
    assert _ended(s) == (0, False)
    assert not s.captured()
    assert s.owner(1) == 1
    assert s.failed() == [(1, 0, z.a, "bounce")]
    assert s.state.groups[z.a].location == s.bounced(0, 0)
    s.step()  # the first step home in t + 1
    way = leg(s.state.map, s.rules, s.e(0), s.n(1))
    assert s.state.groups[z.a].location == OnEdge(s.e(0), s.n(0), way.progress(T - 1), back=True)


@cases
def test_row_21_dec37_row_7(cost: int, mirror: bool) -> None:
    z = _zone(1, (4, 4), (2, 2), (1, 1), cost=cost, mirror=mirror)
    s = z.s
    s.until(z.t + 40)
    assert not s.captured()
    s.until(z.t + 60)
    assert s.captured() == [(1, 0)]
    assert s.counts(z.a) == ((4, 0) if cost else (4, 1))


# Orders: row 28 ---------------------------------------------------------------------------------


@cases
def test_row_28_a_move_of_a_discharged_group_is_accepted(cost: int, mirror: bool) -> None:
    s = Scene(NEUTRAL_1, cost=cost, mirror=mirror)
    a = s.at(0, 2, 0, 0)
    result = validate(s.state, s.rules, s.p(0), Move(a, s.n(1), False))
    assert isinstance(result, Ok)
    assert result.path == (s.n(0), s.n(1))


# Row 29 is the ``cost = 0`` half of every test above. ------------------------------------------


def test_every_ruleset_of_the_repo_has_capture_off() -> None:
    """The number of DEC-38: ``0`` (off) in ``mvp-0``, ``mvp-1``, ``test-short`` and the test
    rulesets; BAL-02 sets ``1`` in its own ruleset."""
    paths = [
        *(ROOT / "rulesets" / f"{n}.toml" for n in ("mvp-0", "mvp-1", "test-short")),
        *sorted((TESTS_DIR / "rulesets").glob("*.toml")),
    ]
    for path in paths:
        assert load_ruleset(path).capture.charge_cost == 0, path


def test_a_negative_charge_cost_is_rejected() -> None:
    data = to_canonical(BASE)
    capture = data["capture"]
    assert isinstance(capture, dict)
    capture["charge_cost"] = -1  # pyright: ignore[reportUnknownMemberType]
    with pytest.raises(RulesetError, match=r"capture\.charge_cost"):
        parse_ruleset(data)
