"""Plains: the defender burns a charge in the first round (DEC-45, #778).

Expected values come from the table of DEC-45 (mechanics.md, section 4), worked out by hand with
``shots_per_round = 1``, attacker first; the column "old" is the same fight under DEC-24, item F2
(``R = charged - 1`` in every round), so the flag off is pinned by the same rows.

The setup is the line of ``test_combat.py``: ``0 - 1 - 2`` (30 ticks per edge), node 1 on plains in
the hands of the defender, the attacker arrives over its edge in tick 1 (contact ``t = 1``, rounds
at 21, 41, 61 with ``round_ticks = 20``). Every row is played with the attacker as player 0 and as
player 1.
"""

import dataclasses
import tomllib
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import pytest

from gow_sim.commands import Command, Move, PlayerCommand, apply_commands
from gow_sim.maps import PLAYERS, MapDef, parse_map
from gow_sim.ruleset import Ruleset, RulesetError, load_ruleset, parse_ruleset, ruleset_hash
from gow_sim.state import (
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
from gow_sim.systems.combat import Fighter, Side, burn, combat
from gow_sim.systems.movement import leg, movement
from gow_sim.systems.orders import active_bonuses, orders
from gow_sim.view import project

ROOT = Path(__file__).resolve().parents[3]
TESTS_DIR = Path(__file__).resolve().parent
OLD = load_ruleset(TESTS_DIR / "rulesets" / "dec07.toml")
BURN = replace(OLD, combat=replace(OLD.combat, terrain_burn=True))
KEY = bytes(range(32))
CONTACT = 1
ROUND = OLD.combat.round_ticks


def line(terrain: str, owner: int | None) -> MapDef:
    """``0 - 1 - 2``: capitals of the players at the ends, node 1 of ``owner`` on ``terrain``."""
    nodes: list[dict[str, Any]] = [
        {
            "id": i,
            "name": f"n{i}",
            "x": 10 * i,
            "y": 10,
            "terrain": terrain if i == 1 else "forest",
            "vp": 1,
            "kind": "capital" if i != 1 else "city_large",
            "capital_of": {0: 0, 2: 1}.get(i),
            "start_owner": {0: 0, 1: owner, 2: 1}[i],
            "start_units": 0,
            "start_charged": 0,
            "start_stock": 0,
        }
        for i in range(3)
    ]
    edges = [
        {"id": i, "a": i, "b": i + 1, "max_level": 3, "travel_ticks": 30, "border_permille": 500}
        for i in range(2)
    ]
    return parse_map(
        {
            "meta": {"name": "l", "version": 1, "symmetry": "rot180", "width": 100, "height": 20},
            "nodes": nodes,
            "edges": edges,
            "mirror": {"nodes": {"0": 2, "1": 1, "2": 0}, "edges": {"0": 1, "1": 0}},
        }
    )


def add(
    state: GameState, owner: int, units: int, charged: int, loc: AtNode | OnEdge, **kw: Any
) -> int:
    gid = state.new_id()
    state.groups[gid] = Group(gid, owner, units, charged, kw.pop("mode", Mode.ATTACK), loc, **kw)
    return gid


class Run:
    """A fight in node 1 with ``attacker`` coming from its capital; ``d`` is the defender."""

    def __init__(self, rules: Ruleset, attacker: int = 0, terrain: str = "plains") -> None:
        self.rules = rules
        self.a = attacker
        self.d = 1 - attacker
        self.state = initial_state(line(terrain, self.d), rules)
        self.seq = 0

    @property
    def home_a(self) -> int:
        return 0 if self.a == 0 else 2

    @property
    def home_d(self) -> int:
        return 2 if self.a == 0 else 0

    def on_way(self, player: int, ticks_left: int = 1) -> OnEdge:
        """On the edge from the capital of ``player`` to node 1, ``ticks_left`` ticks away."""
        home = 0 if player == 0 else 2
        edge = 0 if player == 0 else 1
        way = leg(self.state.map, self.rules, edge, 1)
        return OnEdge(edge, home, way.progress(way.ticks - ticks_left))

    def attack(self, units: int, charged: int, plan: int = 0) -> int:
        order = Order((1,), plan > 0, 0)
        return add(self.state, self.a, units, charged, self.on_way(self.a), order=order, bonus=plan)

    def hold(self, units: int, charged: int, defense: int = 0) -> int:
        ticks = defense * self.rules.orders.defense_ticks_per_bonus
        mode = Mode.DEFENSE if defense else Mode.ATTACK
        return add(self.state, self.d, units, charged, AtNode(1), mode=mode, ticks_in_defense=ticks)

    def step(self, *cmds: tuple[int, Command]) -> list[Event]:
        state = self.state
        state.tick += 1
        batch: list[PlayerCommand] = []
        for player, cmd in cmds:
            batch.append(PlayerCommand(player, self.seq, cmd))
            self.seq += 1
        _, events = apply_commands(state, self.rules, batch)
        state.events = events
        state.events += movement(state, self.rules)
        state.events += combat(state, self.rules, active_bonuses(state, self.rules))
        state.events += orders(state, self.rules)
        return list(state.events)

    def to_end(self, limit: int = 200) -> Event:
        for _ in range(limit):
            found = [e for e in self.step() if e.kind == "fight_ended"]
            if found:
                return found[0]
        raise AssertionError("the fight does not end")

    def side(self, player: int) -> tuple[int, int]:
        groups = [g for g in self.state.groups.values() if g.owner == player]
        return (sum(g.units for g in groups), sum(g.charged for g in groups))

    def rounds(self, events: list[Event]) -> list[Event]:
        return [e for e in events if e.kind == "fight_round"]


# The table ---------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Row:
    """A row of the DEC-45 table: the sides ``(units, charged)``, the plan and "Defense" bonuses,
    then the result under the burn and the defender's result under the old silence."""

    name: str
    attack: tuple[int, int]
    defense: tuple[int, int]
    end: int
    """Ticks from the contact to the end of the fight."""
    attack_after: tuple[int, int]
    defense_after: tuple[int, int]
    defense_old: tuple[int, int]
    shots: tuple[int, int]
    """Attack and defense, virtual ones included; the same under both rules."""
    burned: int
    captured: bool
    plan: int = 0
    guard: int = 0


ROWS = [
    Row("row8", (2, 2), (2, 2), 40, (2, 0), (1, 0), (1, 1), (2, 1), 1, False),
    Row("one_on_one", (1, 1), (1, 1), 20, (1, 0), (0, 0), (0, 0), (1, 0), 1, True),
    Row("row2", (3, 3), (2, 2), 60, (3, 0), (0, 0), (0, 0), (3, 1), 1, True),
    Row("row3", (4, 4), (2, 2), 60, (4, 1), (0, 0), (0, 0), (3, 1), 1, True),
    Row("row4", (1, 1), (10, 0), 20, (1, 0), (9, 0), (9, 0), (1, 0), 0, False),
    Row("empty_attack", (1, 0), (1, 1), 0, (1, 0), (1, 1), (1, 1), (0, 0), 0, False),
    Row("empty_attack_2", (1, 0), (2, 2), 20, (0, 0), (2, 0), (2, 1), (0, 1), 1, False),
    Row("spare_unit", (1, 1), (3, 1), 20, (1, 0), (2, 0), (2, 1), (1, 0), 1, False),
    Row("two_charged", (2, 2), (3, 2), 40, (2, 0), (2, 0), (2, 1), (2, 1), 1, False),
    Row("row9", (2, 2), (2, 2), 60, (2, 1), (0, 0), (0, 0), (3, 1), 1, True, plan=2),
    Row("row10", (3, 3), (2, 2), 60, (3, 0), (2, 0), (2, 1), (3, 3), 1, False, guard=2),
]


def play(row: Row, rules: Ruleset, attacker: int) -> tuple[Run, Event, list[int]]:
    run = Run(rules, attacker)
    run.attack(*row.attack, plan=row.plan)
    run.hold(*row.defense, defense=row.guard)
    burned: list[int] = []
    for _ in range(200):
        events = run.step()
        for e in run.rounds(events):
            burned.append(dict(e.data).get(f"burned_{run.d}", 0))  # pyright: ignore
        found = [e for e in events if e.kind == "fight_ended"]
        if found:
            return run, found[0], burned
    raise AssertionError("the fight does not end")


@pytest.mark.parametrize("attacker", PLAYERS, ids=["a=p0", "a=p1"])
@pytest.mark.parametrize("row", ROWS, ids=lambda r: r.name)
def test_the_table_under_the_burn(row: Row, attacker: int) -> None:
    run, end, burned = play(row, BURN, attacker)
    assert run.state.tick == CONTACT + row.end
    assert run.side(run.a) == row.attack_after
    assert run.side(run.d) == row.defense_after
    assert (end.get(f"shots_{run.a}"), end.get(f"shots_{run.d}")) == row.shots
    assert end.get("captured") is row.captured
    assert sum(burned) == row.burned
    assert burned[1:] == [0] * len(burned[1:]), "only the first round burns"


@pytest.mark.parametrize("attacker", PLAYERS, ids=["a=p0", "a=p1"])
@pytest.mark.parametrize("row", ROWS, ids=lambda r: r.name)
def test_the_table_with_the_flag_off_is_item_f2(row: Row, attacker: int) -> None:
    run, end, _ = play(row, OLD, attacker)
    assert run.state.tick == CONTACT + row.end
    assert run.side(run.a) == row.attack_after
    assert run.side(run.d) == row.defense_old
    assert (end.get(f"shots_{run.a}"), end.get(f"shots_{run.d}")) == row.shots
    assert end.get("captured") is row.captured


def test_only_the_fate_of_the_unused_charge_changes() -> None:
    """Every small fight without reinforcements and retreat, on plains, both rules: the same end,
    shots and losses, the same attacker; the defender differs by the one charge that burned."""
    count = 0
    for attack in [(u, c) for u in range(1, 4) for c in range(u + 1)]:
        for defense in [(u, c) for u in range(1, 4) for c in range(u + 1)]:
            for plan in range(min(attack[1], 2) + 1):
                for guard in range(min(defense[1], 2) + 1):
                    count += 1
                    row = Row("x", attack, defense, 0, (0, 0), (0, 0), (0, 0), (0, 0), 0, False)
                    row = replace(row, plan=plan, guard=guard)
                    old, old_end, _ = play(row, OLD, 0)
                    new, new_end, burned = play(row, BURN, 0)
                    where = f"{attack} {defense} plan {plan} defense {guard}"
                    assert new.state.tick == old.state.tick, where
                    for key in ("shots_0", "shots_1", "losses_0", "losses_1", "captured"):
                        assert new_end.get(key) == old_end.get(key), where
                    assert new.side(0) == old.side(0), where
                    assert new.side(1)[0] == old.side(1)[0], where
                    kept = old.side(1)[1] - new.side(1)[1]
                    assert kept == (1 if sum(burned) and old.side(1)[0] else 0), where
                    assert sum(burned) == (1 if defense[1] and burned else 0), where
    assert count > 100


# Terrain ------------------------------------------------------------------------------------------


@pytest.mark.parametrize("terrain", ["forest", "mountains"])
def test_no_burn_without_a_negative_terrain(terrain: str) -> None:
    run = Run(BURN, terrain=terrain)
    run.attack(2, 2)
    run.hold(2, 2)
    while run.state.tick < CONTACT + ROUND:
        run.step()
    (played,) = run.rounds(run.state.events)
    assert played.get(f"burned_{run.d}") == 0


def test_a_discharged_defender_burns_nothing_even_after_a_reinforcement() -> None:
    """Item F2: the condition is checked once, at contact. 2 discharged at contact, a charged group
    joins before the first round: no terrain in this fight, so all its charges shoot."""
    run = Run(BURN)
    run.attack(2, 2)
    run.hold(2, 0)
    add(run.state, run.d, 1, 1, run.on_way(run.d, 5), order=Order((1,), False, 0))
    run.step()
    assert run.state.fights
    (fight,) = run.state.fights.values()
    assert fight.mute == (0, 0)
    while run.state.tick < CONTACT + ROUND:
        run.step()
    assert run.rounds(run.state.events)[0].get(f"burned_{run.d}") == 0
    assert run.rounds(run.state.events)[0].get(f"shots_{run.d}") == 1


def test_an_edge_fight_burns_nothing() -> None:
    """Item F3: no terrain on an edge, the ends of this one on plains or not."""
    state = initial_state(line("plains", None), BURN)
    x = OnEdge(0, 0, 466)
    add(state, 0, 2, 2, x, order=Order((1,), False, 0))
    add(state, 1, 2, 2, OnEdge(0, 1, 466), order=Order((0,), False, 0))
    run = Run(BURN)
    run.state = state
    end = run.to_end()
    assert end.get("edge") == 0
    assert run.side(0) == (2, 0) and run.side(1) == (2, 0)
    assert end.get("shots_0") == 2 and end.get("shots_1") == 2


def test_a_neutral_node_burns_nothing() -> None:
    """Item F3: both arrive in a neutral plains node: a symmetric fight without terrain."""
    run = Run(BURN)
    run.state = initial_state(line("plains", None), BURN)
    add(run.state, 0, 2, 2, run.on_way(0), order=Order((1,), False, 0))
    add(run.state, 1, 2, 2, run.on_way(1), order=Order((1,), False, 0))
    end = run.to_end()
    assert end.get("shots_0") == 2 and end.get("shots_1") == 2


# Reinforcements and retreat ----------------------------------------------------------------------


@pytest.mark.parametrize(("rules", "after"), [(BURN, (4, 0)), (OLD, (4, 1))], ids=["burn", "old"])
def test_a_reinforcement_after_the_first_round(rules: Ruleset, after: tuple[int, int]) -> None:
    """Row 20 on plains: attack 3/3, defense 2/2, G (2/2) arrives in `t+30`, between r1 and r2.
    Burn: 2 units 1 charged; r1 canc. (2 / 0); G joins (2 / 2); r2 canc. (1 / 1); r3 canc. (0 / 0).
    The defender made 3 real shots under both rules; old: 1 silent charge is left."""
    run = Run(rules)
    run.attack(3, 3)
    run.hold(2, 2)
    add(run.state, run.d, 2, 2, run.on_way(run.d, 31), order=Order((1,), False, 0))
    end = run.to_end()
    assert run.state.tick == CONTACT + 3 * ROUND
    assert run.side(run.a) == (3, 0)
    assert run.side(run.d) == after
    assert end.get(f"shots_{run.d}") == 3


@pytest.mark.parametrize(("rules", "after"), [(BURN, (1, 0)), (OLD, (1, 1))], ids=["burn", "old"])
def test_a_reinforcement_before_the_first_round(rules: Ruleset, after: tuple[int, int]) -> None:
    """Attack 2/2, defense 1/1, G (1/1) arrives in `t+10`, before r1: the side has 2 charged.
    Burn: 2 units 1 charged; r1 canc. (1 / 0); r2 the attack kills 1. As row 8."""
    run = Run(rules)
    run.attack(2, 2)
    run.hold(1, 1)
    add(run.state, run.d, 1, 1, run.on_way(run.d, 11), order=Order((1,), False, 0))
    end = run.to_end()
    assert run.state.tick == CONTACT + 2 * ROUND
    assert run.side(run.a) == (2, 0)
    assert run.side(run.d) == after
    assert end.get(f"shots_{run.d}") == 1


@pytest.mark.parametrize(("rules", "after"), [(BURN, (2, 0)), (OLD, (2, 1))], ids=["burn", "old"])
def test_a_retreat_after_the_first_round(rules: Ruleset, after: tuple[int, int]) -> None:
    """Row 21 on plains, the `Move` before r1: attack 4/4, defense 2/2. Burn, r1 canc. (3 / 0), the
    defense leaves after r1 and the node falls in `t+20` to 4 units 3 charged. One real shot under
    both rules; the charge that stayed silent left with the group, the burned one did not."""
    run = Run(rules)
    run.attack(4, 4)
    d = run.hold(2, 2)
    run.step()
    run.step((run.d, Move(d, run.home_d)))
    end = run.to_end()
    assert run.state.tick == CONTACT + ROUND
    assert end.get("captured") is True
    assert run.side(run.a) == (4, 3)
    assert run.side(run.d) == after
    assert end.get(f"shots_{run.d}") == 1


@pytest.mark.parametrize(("rules", "after"), [(BURN, (1, 0)), (OLD, (1, 1))], ids=["burn", "old"])
def test_a_retreat_between_the_rounds(rules: Ruleset, after: tuple[int, int]) -> None:
    """Row 21 on plains as it stands: the `Move` in `t+24`. Burn, r1 canc. (3 / 0), r2 the attack
    kills 1, the defense leaves after r2 and the node falls in `t+40` to 4 units 2 charged."""
    run = Run(rules)
    run.attack(4, 4)
    d = run.hold(2, 2)
    while run.state.tick < CONTACT + ROUND + 3:
        run.step()
    run.step((run.d, Move(d, run.home_d)))
    run.to_end()
    assert run.state.tick == CONTACT + 2 * ROUND
    assert run.side(run.a) == (4, 2)
    assert run.side(run.d) == after


def test_what_stays_after_a_group_left_shoots() -> None:
    """DEC-45, item 3: from the first round on nothing is silent, so the split of a side by a
    retreat counts. A 4/4; D 2/2 ordered away, G 1/1 stays. Burn from D (rule 7: most charged);
    r1 D shoots (1 and 1: the lower id), canc. (A 3); D leaves 2/0. r2 G shoots, canc. (A 2);
    r3 A kills G: `t+60`, A 4/1. Old: G stays silent, A kills it in r2: `t+40`, A 4/2, D 2/1."""
    expected = {BURN: (3, (4, 1), (2, 0)), OLD: (2, (4, 2), (2, 1))}
    for rules, (rounds, attack, leaver) in expected.items():
        run = Run(rules)
        run.attack(4, 4)
        d = run.hold(2, 2)
        run.hold(1, 1)
        run.step()
        run.step((run.d, Move(d, run.home_d)))
        end = run.to_end()
        assert run.state.tick == CONTACT + rounds * ROUND
        assert run.side(run.a) == attack
        assert (run.state.groups[d].units, run.state.groups[d].charged) == leaver
        assert end.get("captured") is True


# The burn itself ---------------------------------------------------------------------------------


def test_the_group_that_burns_is_chosen_like_a_shooter() -> None:
    """Rule 7: the group with the most charged, ties to the lower id."""
    sides = (
        Side([Fighter(7, 2, 2)]),
        Side([Fighter(3, 2, 1), Fighter(5, 3, 3), Fighter(6, 3, 3)], mute=2),
    )
    assert burn(sides) == (0, 2)
    assert [(f.id, f.charged) for f in sides[1].groups] == [(3, 1), (5, 2), (6, 2)]
    assert sides[1].mute == 0


def test_the_burn_never_takes_more_than_there_is() -> None:
    """``-mod`` above the charged of the side: all that is there, and no more."""
    sides = (Side([Fighter(7, 2, 2)]), Side([Fighter(3, 2, 1)], mute=3))
    assert burn(sides) == (0, 1)
    assert sides[1].groups[0].charged == 0


def test_a_side_alone_burns_nothing() -> None:
    """The enemy is gone by the tick of the round: there is no round to burn in."""
    sides = (Side([]), Side([Fighter(3, 2, 2)], mute=1))
    assert burn(sides) == (0, 0)
    assert sides[1].groups[0].charged == 2


def test_no_charge_left_at_the_first_round_burns_nothing() -> None:
    """Armed at contact, the charge gone by the first round (starvation, DEC-24 H2): no burn."""
    run = Run(BURN)
    run.attack(2, 2)
    d = run.hold(2, 1)
    run.step()
    run.state.groups[d].charged = 0
    while run.state.tick < CONTACT + ROUND:
        run.step()
    (played,) = run.rounds(run.state.events)
    assert played.get(f"burned_{run.d}") == 0
    assert played.get(f"losses_{run.d}") == 1


def test_a_fight_that_ends_before_its_first_round_burns_nothing() -> None:
    """1 discharged arrives at 1/1 on plains: nobody can shoot (the charge will not), the fight
    ends at contact, as under item F2, and the defender keeps the charge."""
    run = Run(BURN)
    run.attack(1, 0)
    run.hold(1, 1)
    events = run.step()
    assert [e for e in events if e.kind == "fight_ended"]
    assert run.rounds(events) == []
    assert run.side(run.d) == (1, 1)


def test_the_burn_does_not_use_the_shot_of_the_round() -> None:
    """Row 8, r1: the defender burns and shoots in the same round: the attack gets no free kill."""
    run = Run(BURN)
    run.attack(2, 2)
    run.hold(2, 2)
    while run.state.tick < CONTACT + ROUND:
        run.step()
    (played,) = run.rounds(run.state.events)
    assert played.get(f"burned_{run.d}") == 1
    assert played.get(f"shots_{run.d}") == 1
    assert played.get(f"spent_{run.d}") == 1  # the shot only: ``spent`` does not hold the burn
    assert played.get(f"losses_{run.d}") == 0
    assert run.side(run.d) == (2, 0)


# View, events and the canonical form -------------------------------------------------------------


def test_both_players_see_the_pending_burn_then_nothing() -> None:
    """A fog test (AGENTS.md 4.4): ``mute`` is the pending burn for both until the first round,
    then 0; ``last_round.burned`` is public to both like the rest of the round."""
    run = Run(BURN)
    run.attack(2, 2)
    run.hold(2, 2)
    run.step()
    for player in PLAYERS:
        (fight,) = project(run.state, BURN, player, KEY).fights
        assert fight.mute == (0, 1)
        assert fight.last_round is None
    while run.state.tick < CONTACT + ROUND:
        run.step()
    for player in PLAYERS:
        (fight,) = project(run.state, BURN, player, KEY).fights
        assert fight.mute == (0, 0)
        assert fight.last_round is not None
        assert fight.last_round.burned == (0, 1)
    while run.state.tick < CONTACT + 2 * ROUND:
        run.step()
    assert run.rounds(run.state.events)[0].get("burned_1") == 0


def test_with_the_flag_off_the_mute_stays_and_nothing_is_burned() -> None:
    run = Run(OLD)
    run.attack(2, 2)
    run.hold(2, 2)
    while run.state.tick < CONTACT + ROUND:
        run.step()
    (played,) = run.rounds(run.state.events)
    assert "burned_1" not in dict(played.data)
    (fight,) = run.state.fights.values()
    assert fight.mute == (0, 1)
    assert fight.last_round is not None and fight.last_round.burned == (0, 0)
    (raw,) = to_canonical(run.state)["fights"]  # pyright: ignore
    assert "burned" not in raw["last_round"]  # pyright: ignore


def test_the_burn_survives_the_canonical_form() -> None:
    run = Run(BURN)
    run.attack(2, 2)
    run.hold(2, 2)
    while run.state.tick < CONTACT + ROUND:
        run.step()
    copy = from_canonical(to_canonical(run.state))
    (fight,) = copy.fights.values()
    assert fight.last_round == FightRound(21, (1, 1), (0, 0), (1, 1), (0, 0), (0, 1))
    assert state_hash(copy) == state_hash(run.state)


def test_the_same_fight_gives_the_same_hash() -> None:
    hashes: list[str] = []
    for _ in range(2):
        run = Run(BURN)
        run.attack(3, 3)
        run.hold(2, 2)
        run.to_end()
        hashes.append(state_hash(run.state))
    assert hashes[0] == hashes[1]


# The ruleset -------------------------------------------------------------------------------------


def _raw(name: str) -> dict[str, Any]:
    return tomllib.loads((ROOT / "rulesets" / f"{name}.toml").read_text(encoding="utf-8"))


def test_the_key_is_absent_by_default_and_on_in_the_playtest_ruleset() -> None:
    for name in ("mvp-0", "mvp-1", "mvp-2", "mvp-3", "mvp-4", "mvp-4-sup200", "test-short"):
        assert not load_ruleset(ROOT / "rulesets" / f"{name}.toml").combat.terrain_burn, name
        assert "terrain_burn" not in _raw(name)["combat"], name
    assert load_ruleset(ROOT / "rulesets" / "mvp-4-stances.toml").combat.terrain_burn


def test_the_key_off_keeps_the_hash() -> None:
    """A ruleset without the key and one with ``terrain_burn = false`` are the same rules; the
    playtest ruleset without the key has the hash it had before DEC-45, and it stays archived."""
    raw = _raw("mvp-4")
    plain = ruleset_hash(parse_ruleset(raw))
    raw["combat"]["terrain_burn"] = False
    assert ruleset_hash(parse_ruleset(raw)) == plain
    raw["combat"]["terrain_burn"] = True
    assert ruleset_hash(parse_ruleset(raw)) != plain
    stances = _raw("mvp-4-stances")
    del stances["combat"]["terrain_burn"]
    played = ruleset_hash(parse_ruleset(stances))
    archived = ROOT / "rulesets" / "archive" / f"{played}.toml"
    assert ruleset_hash(load_ruleset(archived)) == played


def test_the_key_must_be_a_boolean() -> None:
    raw = _raw("mvp-4")
    raw["combat"]["terrain_burn"] = 1
    with pytest.raises(RulesetError, match=r"combat\.terrain_burn"):
        parse_ruleset(raw)


def test_the_field_is_optional_metadata() -> None:
    field = next(f for f in dataclasses.fields(BURN.combat) if f.name == "terrain_burn")
    assert field.metadata.get("optional")
