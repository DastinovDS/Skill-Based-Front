"""DEC-30: the bonus of «Защита» grows (mechanics.md, section 5, «Накопление бонуса «Защиты»
(DEC-30, #316)»).

+1 virtual shot per ``orders.defense_ticks_per_bonus`` ticks the group stands in «Защита», at most
its charged units at the start of the fight; after the fight the bonus burns, the mode stays and
gathers anew without paying again. Bonus of a fight: ``min(charged, ticks // 60)`` with the
ruleset ``mvp-1``. Expected values: the table of examples of DEC-30 and its details.

Map: a line ``0 - 1 - 2`` of forest (no terrain modifier): player 0's capital 0, player 1's city 1
with the defender and capital 2. The defender switches «Защита» on at tick 1; the attacker is put
on edge 0 one tick before it arrives, so the contact is exactly ``ticks`` after the switch. The
bonus of the defence is read from the virtual shots of its side at contact. Only the systems that
act here run (commands, movement, combat, orders).
"""

from pathlib import Path
from typing import Any

import pytest

from gow_sim.commands import (
    CancelOrder,
    Command,
    Merge,
    Move,
    Ok,
    PlayerCommand,
    Reject,
    RejectCode,
    SetMode,
    Split,
    apply_commands,
)
from gow_sim.maps import MapDef, parse_map
from gow_sim.ruleset import load_ruleset
from gow_sim.state import AtNode, Event, Fight, GameState, Group, Mode, OnEdge, Order, initial_state
from gow_sim.systems.combat import combat
from gow_sim.systems.movement import leg, movement
from gow_sim.systems.orders import active_bonuses, orders

ROOT = Path(__file__).resolve().parents[3]
RULES = load_ruleset(ROOT / "rulesets" / "mvp-1.toml")
ATTACKER, DEFENDER = 0, 1


def _map() -> MapDef:
    owners = [0, 1, 1]
    nodes: list[dict[str, Any]] = [
        {
            "id": i,
            "name": f"n{i}",
            "x": 100 * i,
            "y": 10,
            "terrain": "forest",
            "vp": 1,
            "kind": "city_large" if i == 1 else "capital",
            "capital_of": {0: 0, 2: 1}.get(i),
            "start_owner": owners[i],
            "start_units": 0,
            "start_charged": 0,
            "start_stock": 0,
        }
        for i in range(3)
    ]
    edges = [
        {"id": k, "a": k, "b": k + 1, "max_level": 3, "travel_ticks": 30, "border_permille": 500}
        for k in range(2)
    ]
    return parse_map(
        {
            "meta": {"name": "d30", "version": 1, "symmetry": "rot180", "width": 300, "height": 20},
            "nodes": nodes,
            "edges": edges,
            "mirror": {"nodes": {"0": 2, "1": 1, "2": 0}, "edges": {"0": 1, "1": 0}},
        }
    )


class _Run:
    def __init__(self, state: GameState) -> None:
        self.state = state
        self.seq = 0
        self.events: list[Event] = []

    def step(self, *cmds: tuple[int, Command]) -> list[Ok | Reject]:
        state = self.state
        state.tick += 1
        commands = [PlayerCommand(p, self.seq + i, c) for i, (p, c) in enumerate(cmds)]
        self.seq += len(cmds)
        results, events = apply_commands(state, RULES, commands)
        state.events = events + movement(state, RULES)
        state.events += combat(state, RULES, active_bonuses(state, RULES))
        state.events += orders(state, RULES)
        self.events += state.events
        return [r.outcome for r in results]

    def until(self, tick: int) -> None:
        while self.state.tick < tick:
            self.step()

    def attack(self, units: int = 5) -> Fight:
        """An attacker arrives at node 1 in the next tick; returns the fight of that contact."""
        state = self.state
        gid = state.new_id()
        way = leg(state.map, RULES, 0, 1)
        location = OnEdge(0, 0, way.progress(way.ticks - 1))
        order = Order((1,), False, 0)
        state.groups[gid] = Group(gid, ATTACKER, units, units, Mode.ATTACK, location, order)
        contact = state.tick + 1
        self.step()
        assert [e.tick for e in state.events if e.kind == "fight_started"] == [contact]
        (fight,) = state.fights.values()
        return fight

    def fight_ends(self, limit: int = 400) -> int:
        for _ in range(limit):
            self.step()
            if any(e.kind == "fight_ended" for e in self.state.events):
                return self.state.tick
        raise AssertionError(f"no fight_ended in {limit} ticks")


def _defended(units: int, charged: int) -> tuple[_Run, int]:
    """The defender in node 1 switches «Защита» on at tick 1."""
    state = initial_state(_map(), RULES)
    gid = state.new_id()
    state.groups[gid] = Group(gid, DEFENDER, units, charged, Mode.ATTACK, AtNode(1))
    run = _Run(state)
    assert run.step((DEFENDER, SetMode(gid, Mode.DEFENSE))) == [Ok(cost=200)]
    return run, gid


def test_mvp1_gathers_one_per_60_ticks() -> None:
    assert RULES.orders.defense_ticks_per_bonus == 60
    assert RULES.orders.cost.defense == 200
    assert RULES.terrain.defense_mod.forest == 0  # the map: no terrain in the bonus


# The table of examples ---------------------------------------------------------------------------

EXAMPLES = [
    # (row, ticks in «Защита» at the start of the fight, units, charged, bonus of the fight)
    (1, 30, 3, 3, 0),
    (2, 60, 3, 3, 1),
    (3, 130, 3, 3, 2),
    (4, 600, 3, 3, 3),  # the cap: the charged units
    (5, 180, 4, 1, 1),  # the cap
    (6, 300, 3, 0, 0),  # no firing charge: no bonus (DEC-24, F2)
]


@pytest.mark.parametrize(
    ("row", "ticks", "units", "charged", "bonus"), EXAMPLES, ids=[f"row{e[0]}" for e in EXAMPLES]
)
def test_dec30_example(row: int, ticks: int, units: int, charged: int, bonus: int) -> None:
    del row
    run, d = _defended(units, charged)
    run.until(ticks)  # «Защита» since tick 1: the contact in tick 1 + ticks
    assert RULES.orders.defense_bonus(run.state.groups[d].ticks_in_defense, charged) == bonus
    fight = run.attack()
    assert fight.virtual[DEFENDER] == bonus
    assert run.state.groups[d].ticks_in_defense == 0  # joining the fight resets the count


def test_dec30_example_7_the_bonus_burns_and_gathers_anew() -> None:
    """Row 7: after the first fight the group stays in «Защита»; the second fight 90 ticks after
    the end of the first gets 1 (90 // 60), what the first one gathered is gone."""
    run, d = _defended(3, 3)
    run.until(130)
    first = run.attack(units=1)
    assert first.virtual[DEFENDER] == 2
    end = run.fight_ends()
    g = run.state.groups[d]
    assert (g.units, g.mode, g.fight, g.ticks_in_defense) == (3, Mode.DEFENSE, None, 1)
    cp = run.state.players[DEFENDER].cp
    g.charged = 3  # setup: recharged by hand (no supply here)
    run.until(end + 89)
    second = run.attack()
    assert second.start == end + 90
    assert second.virtual[DEFENDER] == 1
    assert run.state.players[DEFENDER].cp == cp  # no second payment


# Details --------------------------------------------------------------------------------------


def test_the_count_does_not_grow_in_a_fight() -> None:
    run, d = _defended(3, 3)
    run.until(130)
    run.attack(units=1)
    run.step()
    for _ in range(RULES.combat.round_ticks):
        assert run.state.groups[d].fight is not None
        assert run.state.groups[d].ticks_in_defense == 0
        run.step()


@pytest.mark.parametrize("how", ["set_attack", "cancel", "move"])
def test_leaving_the_mode_drops_the_count(how: str) -> None:
    run, d = _defended(3, 3)
    run.until(130)
    cmd: Command = {
        "set_attack": SetMode(d, Mode.ATTACK),
        "cancel": CancelOrder(d),
        "move": Move(d, 2),
    }[how]
    (ok,) = run.step((DEFENDER, cmd))
    assert isinstance(ok, Ok)
    g = run.state.groups[d]
    assert (g.mode, g.ticks_in_defense) == (Mode.ATTACK, 0)
    assert active_bonuses(run.state, RULES) == {}


def test_switching_on_again_starts_from_zero_and_pays_again() -> None:
    run, d = _defended(3, 3)
    run.until(130)
    run.step((DEFENDER, SetMode(d, Mode.ATTACK)))
    run.state.players[DEFENDER].cp = cp = 300  # setup: no economy here
    assert run.step((DEFENDER, SetMode(d, Mode.DEFENSE))) == [Ok(cost=200)]
    assert run.state.players[DEFENDER].cp == cp - 200
    assert run.state.groups[d].ticks_in_defense == 1  # counted at the end of this tick


def test_switching_on_while_in_it_is_refused() -> None:
    run, d = _defended(3, 3)
    run.until(130)
    cp = run.state.players[DEFENDER].cp
    assert run.step((DEFENDER, SetMode(d, Mode.DEFENSE))) == [Reject(RejectCode.NO_CHANGE)]
    assert run.state.players[DEFENDER].cp == cp
    assert run.state.groups[d].ticks_in_defense == 131


def test_split_new_group_in_attack_the_source_keeps_its_count() -> None:
    run, d = _defended(4, 4)
    run.until(130)
    run.step((DEFENDER, Split(d, 3)))
    (new,) = [gid for gid in run.state.groups if gid != d]
    source, part = run.state.groups[d], run.state.groups[new]
    assert (source.mode, source.ticks_in_defense, source.charged) == (Mode.DEFENSE, 131, 1)
    assert (part.mode, part.ticks_in_defense) == (Mode.ATTACK, 0)
    # The cap is now the 1 charged unit left (131 // 60 = 2).
    assert active_bonuses(run.state, RULES)[d].amount == 1


def test_merge_keeps_the_count_of_the_target() -> None:
    run, d = _defended(2, 2)
    other = run.state.new_id()
    run.state.groups[other] = Group(other, DEFENDER, 2, 2, Mode.ATTACK, AtNode(1))
    run.until(130)
    assert run.step((DEFENDER, Merge((d, other)))) == [Ok(cost=0)]
    g = run.state.groups[d]
    assert (g.units, g.charged, g.mode, g.ticks_in_defense) == (4, 4, Mode.DEFENSE, 131)
    assert active_bonuses(run.state, RULES)[d].amount == 2
