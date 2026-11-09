"""Scenario "siege of attrition" (SIM-09, #25; mechanics.md, section 4, "Siege of attrition").

Map ``tests/maps/siege.json``, ruleset ``tests/rulesets/siege.toml`` (pinned numbers), all nodes
forest (terrain modifier 0). Player 0 holds the city T (node 2: 2 units, both charged, warehouse 3,
set up: only the capital keeps the start stock of the map, DEC-41 item 9); T is linked to the own
capital only through M (node 1) and borders the enemy capital (node 5) directly. Player 1 attacks T
from its capital with 2 charged units in waves: a wave leaves only when the group stands at home
fully charged, with no order and CP for the move. Nobody else moves. With equal forces a wave only
burns charges on both sides (DEC-24, table row 1: two rounds, 40 ticks with ``round_ticks = 20``,
DEC-32): the attacker bounces home (79 ticks) and recharges in 2 ticks, the defender recharges from
T's warehouse at 1 per tick (``supply.recharge_per_tick``) once the fight is over (DEC-24, H1: not
during it). A wave leaves in tick 1 and meets T in tick 79; after a fight that ends in tick ``e``
the attacker is home in ``e + 79``, full in ``e + 80`` and meets T again in ``e + 80 + 79``. The
attacker recharges from the warehouse of its capital (6 charges, set up), so it is full in time.

Cut roads (player 1 already holds M, so T is a pocket of player 0 without a factory and gets no
packets; its warehouse of a medium city holds 3, DEC-43 item C). T starves (DEC-43, item H4, with
the consumption of DEC-19): the supply step sees the pocket on tick 1 (``cut_since = 1``), so the
garrison spends ``ceil(U / 3) = 1`` charge on ticks 101, 201, 301, ..., the warehouse first. Hand
computation, D = the defender's charged units at contact, W = T's warehouse:

====  =======  ===  ====================================================================  ===
wave  contact  D    fight (DEC-24, rounds every 20 ticks) and what happens until the next   W
====  =======  ===  ====================================================================  ===
1     79       2    starves at 101 in the fight (W 3 -> 2); r1, r2 cancel (row 1), the end   0
                    at 119; recharge 2 at 119, 120 (W 2 -> 0); starves at 201 (one unit
                    charge: D 2 -> 1)
2     278      1    r1 at 298 cancels (1 / 0), r2 at 318 kills 1 discharged defender; the    0
                    end at 318 (nobody can shoot); at 301 and 401 nothing left to spend
3     477      0    r1 at 497 kills the last unit: the end at 497, T is captured            --
====  =======  ===  ====================================================================  ===

So the city falls exactly on wave N = 3 (without starvation, SIM-09: wave 4).
"""

from pathlib import Path

from gow_sim.commands import Move, PlayerCommand, apply_commands, command_cost
from gow_sim.maps import load_map
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.state import AtNode, Event, GameState, initial_state
from gow_sim.systems.capacity import capacity
from gow_sim.systems.combat import combat
from gow_sim.systems.economy import economy
from gow_sim.systems.flow import supply_flow
from gow_sim.systems.movement import movement

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
    state.events += supply_flow(state, RULES)
    return state.events


def _siege(*, waves: int) -> tuple[GameState, list[Event]]:
    """Run the waves; return the state and the ``fight_started``, ``fight_ended`` and the
    defender's ``fight_group`` events in T (up to a capture)."""
    state = initial_state(load_map(TESTS_DIR / "maps" / "siege.json"), RULES)
    state.nodes[CITY].warehouse = 3  # setup: T's stock of the table
    state.nodes[CAPITAL_1].warehouse = 6  # setup: the attacker's recharges
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
        if ready and sum(e.kind == "fight_started" for e in fights) < waves:
            commands.append(PlayerCommand(1, seq, move))
            seq += 1
        events = _step(state, commands)
        here = [
            e
            for e in events
            if e.kind in ("fight_started", "fight_ended") and e.get("node") == CITY
        ]
        fights += here
        if any(e.kind == "fight_ended" for e in here):
            fights += [e for e in events if e.kind == "fight_group" and e.get("player") == 0]
        if any(e.kind == "node_captured" and e.get("node") == CITY for e in events):
            break
        started = sum(e.kind == "fight_started" for e in fights)
        if started == waves and attacker.location == AtNode(CAPITAL_1):
            break
    return state, fights


def _of(fights: list[Event], kind: str) -> list[Event]:
    return [e for e in fights if e.kind == kind]


def test_cut_off_city_falls_exactly_on_wave_3() -> None:
    state, fights = _siege(waves=10)
    assert [f.tick for f in _of(fights, "fight_started")] == [79, 278, 477]
    ended = _of(fights, "fight_ended")
    assert [f.tick for f in ended] == [119, 318, 497]
    assert [f.get("attacker") for f in ended] == [1, 1, 1]
    assert [f.get("charged_before") for f in _of(fights, "fight_group")] == [2, 1, 0]
    assert [f.get("losses_0") for f in ended] == [0, 1, 1]
    assert [f.get("losses_1") for f in ended] == [0, 0, 0]
    assert [f.get("captured") for f in ended] == [False, False, True]
    assert state.nodes[CITY].owner == 1
