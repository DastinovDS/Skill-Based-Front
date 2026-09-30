"""Scenarios of SIM-13 (#29): every way a match ends, with the systems in their fixed order.

DEC-03 (mechanics.md, section 11): capturing the enemy capital is an instant win; a forfeit is a
defeat of the forfeiter; at the timer (7200 ticks) more VP wins, then more cities, else a draw.
Tick convention: step ``t`` runs with ``state.tick == t``. Order in the loop: commands, movement,
combat, victory.
"""

import dataclasses
import json
from pathlib import Path

from gow_sim.commands import Forfeit, Move, Ok, PlayerCommand, apply_commands
from gow_sim.maps import parse_map
from gow_sim.ruleset import Ruleset, VictoryRules, load_ruleset
from gow_sim.state import Event, GameState, initial_state
from gow_sim.systems.combat import combat
from gow_sim.systems.movement import movement
from gow_sim.systems.victory import victory

TESTS_DIR = Path(__file__).resolve().parents[1]
MVP0 = TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml"

RULES: Ruleset = dataclasses.replace(
    load_ruleset(MVP0),
    match_ticks=7200,
    victory=VictoryRules(vp_period_ticks=50, capital_multiplier=3),
)


def line3_state(enemy_units: int = 2, enemy_charged: int = 0) -> GameState:
    """line3 (capital 0 - city 1 - capital 2); the garrison of capital 2 is set by the caller."""
    data = json.loads((TESTS_DIR / "maps" / "line3.json").read_text(encoding="utf-8"))
    data["nodes"][2]["start_units"] = enemy_units
    data["nodes"][2]["start_charged"] = enemy_charged
    return initial_state(parse_map(data), RULES)


def step(state: GameState, commands: list[PlayerCommand] | None = None) -> list[Event]:
    state.tick += 1
    results, events = apply_commands(state, RULES, commands or [])
    assert all(isinstance(r.outcome, Ok) for r in results), results
    state.events = [*events, *movement(state, RULES)]
    state.events += combat(state, RULES)
    events = [*state.events, *victory(state, RULES)]
    state.events = events
    return events


def run_until_ended(state: GameState, limit: int) -> list[Event]:
    for _ in range(limit):
        events = step(state)
        if any(e.kind == "match_ended" for e in events):
            return events
    raise AssertionError("the match did not end")


def test_capturing_the_enemy_capital_ends_the_match_at_once() -> None:
    state = line3_state()  # the garrison of capital 2 has two units and no charges
    state.nodes[1].owner = 0  # a path leads only through own nodes (movement.find_path)
    attackers = next(g for g in state.groups.values() if g.owner == 0)  # 3 units, 3 charges
    step(state, [PlayerCommand(0, 1, Move(attackers.id, 2))])
    events = run_until_ended(state, limit=500)
    captured = next(e for e in events if e.kind == "node_captured")
    ended = next(e for e in events if e.kind == "match_ended")
    assert (captured.get("node"), captured.get("player")) == (2, 0)
    assert (ended.get("winner"), ended.get("reason")) == (0, "capital")
    assert ended.tick == captured.tick < 500  # long before the timer


def test_forfeit_is_a_defeat_of_the_forfeiter() -> None:
    state = line3_state()
    events = step(state, [PlayerCommand(1, 1, Forfeit())])
    ended = next(e for e in events if e.kind == "match_ended")
    assert (ended.get("winner"), ended.get("reason")) == (0, "forfeit")
    assert state.tick == 1


def test_both_forfeit_in_one_tick_is_a_draw() -> None:
    state = line3_state()
    events = step(state, [PlayerCommand(0, 1, Forfeit()), PlayerCommand(1, 1, Forfeit())])
    ended = next(e for e in events if e.kind == "match_ended")
    assert (ended.get("winner"), ended.get("reason")) == (None, "double_defeat")


def test_timer_equal_score_is_a_draw() -> None:
    state = line3_state()
    events = run_until_ended(state, limit=7200)
    ended = next(e for e in events if e.kind == "match_ended")
    assert state.tick == 7200  # nothing moves: the mirror position runs to the timer
    assert (ended.get("winner"), ended.get("reason")) == (None, "draw")
    # 144 accruals of the capital only: 144 x 3 each.
    assert (state.players[0].vp, state.players[1].vp) == (432, 432)


def test_timer_more_vp_wins() -> None:
    state = line3_state()
    state.nodes[1].owner = 0  # city 1 (1 vp) is ours: 4 per period against 3
    events = run_until_ended(state, limit=7200)
    ended = next(e for e in events if e.kind == "match_ended")
    assert state.tick == 7200
    assert (state.players[0].vp, state.players[1].vp) == (576, 432)
    assert (ended.get("winner"), ended.get("reason")) == (0, "vp")


def test_timer_equal_vp_more_cities_wins() -> None:
    state = line3_state()
    state.nodes[1].owner = 1
    state.players[0].vp = 144  # a lead that the extra city of player 1 (144 vp) exactly evens
    events = run_until_ended(state, limit=7200)
    ended = next(e for e in events if e.kind == "match_ended")
    assert (state.players[0].vp, state.players[1].vp) == (576, 576)
    assert (ended.get("winner"), ended.get("reason")) == (1, "cities")
