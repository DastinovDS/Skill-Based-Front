"""Scenario «осада на истощение» (SIM-09, #25; mechanics.md, section 4, «Осада на истощение»).

Map ``tests/maps/siege.json``, ruleset ``tests/rulesets/siege.toml`` (a pinned copy of mvp-0),
all nodes forest (terrain modifier 0). Player 0 holds the city T (node 2: 2 units, both charged,
warehouse 3); T is linked to the own capital only through M (node 1) and borders the enemy
capital (node 5) directly. Player 1 attacks T from its capital with 2 charged units in waves:
a wave leaves only when the group stands at home fully charged, with no order and CP for the
move. Nobody else moves. With equal forces a wave only burns charges on both sides (DEC-07,
table row 1): the attacker bounces home and recharges, the defender recharges from T's
warehouse at 1 per tick (``supply.recharge_per_tick``), long before the next wave (the round
trip takes 2 * 79 ticks).

Cut roads (player 1 already holds M, so T is outside the supplied territory and gets no
packets; as a medium city its capacity is 6 (DEC-22), which holds the warehouse of 3). Hand
computation, D = the defender's firing charges, W = T's warehouse after the recharge:

====  ===  ============================================================  ====
wave   D   fight (DEC-07 rules 1-4)                                        W
====  ===  ============================================================  ====
1      2   2 vs 2: all cancelled, no losses, bounce; recharge 2          1
2      2   2 vs 2: all cancelled, no losses, bounce; recharge 1          0
3      1   2 vs 1: 1 cancelled, the surplus 1 kills 1; bounce           0
4      0   2 vs 0: the surplus kills the last unit, T is captured       --
====  ===  ============================================================  ====

So the city falls exactly on wave N = 4.

Open roads (M is player 0's): T is refilled over 0 -> 1 -> 2. The capital produces 2 charges
per 50 ticks (passive 1 + half of the CP quantum at stance «Баланс»), a level 1 road carries
1 charge per 10 ticks and the chain takes 59 + 72 ticks; a wave uses 2 charges of T per round
trip of more than 158 ticks, and T starts with 3. So the defender meets every wave with both
units charged (row 1 every time) and does not fall in 10 waves.
"""

from pathlib import Path

from gow_sim.commands import Move, PlayerCommand, apply_commands, command_cost
from gow_sim.maps import load_map
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.state import AtNode, Event, GameState, initial_state
from gow_sim.systems.capacity import capacity
from gow_sim.systems.combat import combat
from gow_sim.systems.economy import economy
from gow_sim.systems.movement import movement
from gow_sim.systems.supply import supply

TESTS_DIR = Path(__file__).resolve().parents[1]
RULES: Ruleset = load_ruleset(TESTS_DIR / "rulesets" / "siege.toml")
CAPITAL_1, CITY, CUT_NODE = 5, 2, 1
MAX_TICKS = 3000


def _step(state: GameState, commands: list[PlayerCommand]) -> list[Event]:
    """One tick in the order of AGENTS.md 4.2 (systems that do not act here are left out)."""
    state.tick += 1
    _, events = apply_commands(state, RULES, commands)
    events += economy(state, RULES)
    state.events = events + movement(state, RULES)
    state.events += combat(state, RULES)
    state.events += capacity(state, RULES)
    state.events += supply(state, RULES)
    return state.events


def _siege(*, cut: bool, waves: int) -> tuple[GameState, list[Event]]:
    """Run the waves; return the state and the fight events in T (up to a capture)."""
    state = initial_state(load_map(TESTS_DIR / "maps" / "siege.json"), RULES)
    if cut:
        state.nodes[CUT_NODE].owner = 1  # setup, not a capture: player 1 already holds M
    attacker = next(g for g in state.groups.values() if g.location == AtNode(CAPITAL_1))
    move = Move(attacker.id, CITY)
    fights: list[Event] = []
    seq = 0
    while state.tick < MAX_TICKS:
        commands: list[PlayerCommand] = []
        ready = (
            attacker.location == AtNode(CAPITAL_1)
            and attacker.order is None
            and attacker.charged == attacker.units
            and state.players[1].cp >= command_cost(RULES, move)
        )
        if ready and len(fights) < waves:
            commands.append(PlayerCommand(1, seq, move))
            seq += 1
        events = _step(state, commands)
        fights += [e for e in events if e.kind == "fight" and e.get("node") == CITY]
        if any(e.kind == "node_captured" and e.get("node") == CITY for e in events):
            break
        if len(fights) == waves and attacker.location == AtNode(CAPITAL_1):
            break
    return state, fights


def test_cut_off_city_falls_exactly_on_wave_4() -> None:
    state, fights = _siege(cut=True, waves=10)
    assert [f.get("attacker") for f in fights] == [1, 1, 1, 1]
    assert [f.get("pool_1") for f in fights] == [2, 2, 2, 2]
    assert [f.get("pool_0") for f in fights] == [2, 2, 1, 0]
    assert [f.get("losses_0") for f in fights] == [0, 0, 1, 1]
    assert [f.get("losses_1") for f in fights] == [0, 0, 0, 0]
    assert state.nodes[CITY].owner == 1


def test_supplied_city_holds_10_waves() -> None:
    state, fights = _siege(cut=False, waves=10)
    assert len(fights) == 10
    assert [f.get("pool_0") for f in fights] == [2] * 10
    assert [f.get("losses_0") for f in fights] == [0] * 10
    assert state.nodes[CITY].owner == 0
    defenders = [g for g in state.groups.values() if g.location == AtNode(CITY)]
    assert [(g.owner, g.units) for g in defenders] == [(0, 2)]
