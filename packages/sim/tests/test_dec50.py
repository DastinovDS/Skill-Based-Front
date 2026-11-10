"""No leaf shift lever (DEC-50, #929; owner decision 2026-11-10, #928 item 8).

Expected values come from mechanics.md, section 7, block "No leaf shift lever (DEC-50, #929)":
items 1 to 3 and the rows N1 to N4. The map is ``dec41`` in the base of the DEC-43 tables (see
``test_dec43.py``): player 0 owns K = 0 and A to G = 1 to 7, the passes 17 and 18 are player 1's,
``d0``: C 0, D 0, A 1, B 1, K 2, E 2, F 2, G 2, so ``leaf_shift_max = 2``.
"""

import dataclasses
from collections.abc import Callable, Sequence
from pathlib import Path

import pytest

from gow_sim.commands import (
    Command,
    Ok,
    PlayerCommand,
    Reject,
    RejectCode,
    SetLeafShift,
    apply_commands,
)
from gow_sim.maps import MapDef, load_map
from gow_sim.match import Controller, Match, run_headless
from gow_sim.ruleset import Ruleset, StanceTable, load_ruleset, parse_ruleset, ruleset_hash
from gow_sim.ruleset import to_canonical as rules_canonical
from gow_sim.state import Event, GameState, initial_state, state_hash
from gow_sim.systems.flow import supply_flow, update_flow
from gow_sim.view import PlayerView

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[2]
RULESETS = ROOT / "rulesets"
MVP7 = load_ruleset(RULESETS / "mvp-7.toml")
_MVP5 = load_ruleset(RULESETS / "mvp-5.toml")
_EVERY_100 = StanceTable(economy=100, balance=100, war=100)
ON = dataclasses.replace(
    _MVP5,
    stances=dataclasses.replace(
        _MVP5.stances, cp_period_ticks=_EVERY_100, capital_period_ticks=_EVERY_100
    ),
)
"""The rules of the DEC-43 tables (``test_dec43.RULES``): the lever of DEC-43 item B."""
OFF = dataclasses.replace(ON, supply=dataclasses.replace(ON.supply, leaf_shift=False))
"""The same with ``supply.leaf_shift = false``: no lever."""
MAP = load_map(TESTS_DIR / "maps" / "dec41.json")
K, A, B, C, D, E, F, G, M = range(9)
ENEMY_PASSES = (17, 18)
OWN = (K, A, B, C, D, E, F, G)


def _state(rules: Ruleset, stocks: dict[int, int] | None = None, shift: int = 0) -> GameState:
    """The base of the DEC-43 tables at tick 9, before the step of tick 10."""
    state = initial_state(MAP, rules)
    for n in OWN:
        state.nodes[n].warehouse = 0
    for n in ENEMY_PASSES:
        state.nodes[n].owner = 1
    for n, stock in (stocks or {}).items():
        state.nodes[n].warehouse = stock
    update_flow(state, rules)
    state.players[0].leaf_shift = shift
    state.tick = 9
    return state


def _flow(state: GameState, rules: Ruleset, tick: int = 10) -> list[Event]:
    events: list[Event] = []
    while state.tick < tick:
        state.tick += 1
        state.events = []
        events += supply_flow(state, rules)
    return events


def _cmd(state: GameState, rules: Ruleset, cmd: Command) -> tuple[Ok | Reject, list[Event]]:
    results, events = apply_commands(state, rules, [PlayerCommand(0, 0, cmd)])
    return results[0].outcome, events


# The key ------------------------------------------------------------------------------------------


def test_mvp7_and_test_short_have_the_key_off_and_older_rulesets_the_lever() -> None:
    assert not MVP7.supply.leaf_shift
    assert not load_ruleset(RULESETS / "test-short.toml").supply.leaf_shift
    for name in ("mvp-5", "mvp-6"):
        assert load_ruleset(RULESETS / f"{name}.toml").supply.leaf_shift, name


@pytest.mark.parametrize("name", ["mvp-5", "mvp-6"])
def test_a_ruleset_without_the_key_leaves_it_out_of_its_hash(name: str) -> None:
    """``True`` is left out of the canonical form and so of the hash (``OPTIONAL``): the hashes
    and golden games of ``mvp-5`` and ``mvp-6`` stay valid."""
    supply = rules_canonical(load_ruleset(RULESETS / f"{name}.toml"))["supply"]
    assert isinstance(supply, dict) and "leaf_shift" not in supply


def test_the_key_round_trips_and_counts_in_the_hash() -> None:
    data = rules_canonical(MVP7)
    supply = data["supply"]
    assert isinstance(supply, dict) and supply["leaf_shift"] is False
    assert parse_ruleset(data) == MVP7
    on = dataclasses.replace(MVP7, supply=dataclasses.replace(MVP7.supply, leaf_shift=True))
    assert ruleset_hash(on) != ruleset_hash(MVP7)


# Row N1: the command is rejected ------------------------------------------------------------------


@pytest.mark.parametrize("shift", [2, 0, 3, -1])
def test_n1_set_leaf_shift_is_rejected_and_changes_nothing(shift: int) -> None:
    state = _state(OFF)
    _flow(state, OFF, 9)  # nothing to run: ``leaf_shift_max`` is the one ``update_flow`` stored
    assert state.players[0].leaf_shift_max == 2
    before = state_hash(state)
    outcome, events = _cmd(state, OFF, SetLeafShift(shift))
    assert isinstance(outcome, Reject) and outcome.code is RejectCode.INVALID_ARGUMENT
    assert events == []
    assert state_hash(state) == before
    assert state.players[0].leaf_shift == 0 and state.players[0].leaf_shift_max == 2
    assert state.players[0].cp == OFF.cp.start


def test_n4_the_lever_works_with_the_key_on() -> None:
    """Row N4: DEC-43 item B unchanged (row F14)."""
    state = _state(ON)
    outcome, _ = _cmd(state, ON, SetLeafShift(2))
    assert isinstance(outcome, Ok)
    assert state.players[0].leaf_shift == 2


# Row N2: the flow equals the flow with the shift 0 ------------------------------------------------


def test_n2_a_stored_shift_is_0_and_the_flow_is_the_flow_at_0() -> None:
    stocks = {K: 6, A: 3, C: 2, F: 2}  # row F12
    off = _state(OFF, stocks, shift=1)
    at_0 = _state(ON, stocks, shift=0)
    off_events = _flow(off, OFF)
    at_0_events = _flow(at_0, ON)
    assert off.players[0].leaf_shift == 0
    assert off_events == at_0_events
    assert {n: off.nodes[n].warehouse for n in OWN} == {n: at_0.nodes[n].warehouse for n in OWN}
    assert {n: off.nodes[n].flow for n in OWN} == {n: at_0.nodes[n].flow for n in OWN}
    assert off.packets == at_0.packets


def test_n2_the_lever_still_moves_the_level_with_the_key_on() -> None:
    """The control of row N2: with the lever the same stored shift does change the flow."""
    stocks = {K: 6, A: 3, C: 2, F: 2}
    shifted = _state(ON, stocks, shift=1)
    at_0 = _state(ON, stocks, shift=0)
    assert _flow(shifted, ON) != _flow(at_0, ON)


# Row N3: a whole match ----------------------------------------------------------------------------


class _Shifter:
    """``ExpandBot`` plus a ``SetLeafShift`` every 100 ticks (0, 1, 2 in turn)."""

    def __init__(self, base: Controller) -> None:
        self.base = base
        self.sent = 0

    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        cmds = self.base.decide(view, tick)
        if tick % 100 == 0:
            cmds.append(SetLeafShift(tick // 100 % 3))
            self.sent += 1
        return cmds


class _Hashes:
    def __init__(self) -> None:
        self.hashes: list[str] = []

    def begin(self, match: Match) -> None:
        self.hashes.append(state_hash(match.state))

    def record(self, match: Match, commands: Sequence[PlayerCommand]) -> None:
        del commands
        self.hashes.append(state_hash(match.state))
        assert all(p.leaf_shift == 0 for p in match.state.players.values())


def test_n3_a_match_with_shift_commands_equals_one_without(
    expand_bot: Callable[[MapDef, Ruleset], Controller],
) -> None:
    mapdef = load_map(ROOT / "maps" / "fixtures" / "web.json")
    plain, shifting = _Hashes(), _Hashes()
    run_headless(mapdef, MVP7, [expand_bot(mapdef, MVP7) for _ in (0, 1)], 1500, observer=plain)
    bots = [_Shifter(expand_bot(mapdef, MVP7)) for _ in (0, 1)]
    run_headless(mapdef, MVP7, bots, 1500, observer=shifting)
    assert all(b.sent > 0 for b in bots)
    assert shifting.hashes == plain.hashes
