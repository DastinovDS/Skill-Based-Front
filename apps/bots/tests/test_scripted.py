"""The scripted opponent of a tutorial chapter (#806, ``gow_bots.bots.scripted``)."""

from pathlib import Path
from typing import Final

import pytest

from gow_bots.bots.scripted import ScriptedBot, ScriptStep
from gow_sim.commands import Move
from gow_sim.maps import load_map
from gow_sim.match import HEADLESS_MATCH_KEY, Match, Seat
from gow_sim.ruleset import load_ruleset
from gow_sim.state import AtNode

ROOT: Final = Path(__file__).resolve().parents[3]
MAP: Final = load_map(ROOT / "maps" / "tutorial" / "tut-supply.json")
IDS: Final = {n.name: n.id for n in MAP.nodes}
RULES: Final = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")


def test_a_step_at_a_tick_applies_at_that_tick() -> None:
    match = Match(MAP, RULES, HEADLESS_MATCH_KEY)
    raid = ScriptStep(IDS["Ridgeway"], IDS["Coldwell"], at=200)
    seat = Seat(match, 1, ScriptedBot([raid]), decide_every=1)
    applied_at: list[int] = []
    while match.tick < 210:
        pending = seat.commands()
        match.step(pending)
        applied_at += [r.tick for r in match.results if r.player == 1]
    assert applied_at == [200]
    (group,) = [g for g in match.state.groups.values() if g.owner == 1 and g.order is not None]
    assert not isinstance(group.location, AtNode)  # on its way from Ridgeway


def test_called_every_five_ticks_a_step_goes_at_the_first_call_after_it() -> None:
    match = Match(MAP, RULES, HEADLESS_MATCH_KEY)
    seat = Seat(match, 1, ScriptedBot([ScriptStep(IDS["Ridgeway"], IDS["Coldwell"], at=198)]))
    applied_at: list[int] = []
    while match.tick < 210:
        match.step(seat.commands())
        applied_at += [r.tick for r in match.results if r.player == 1]
    assert applied_at == [201]


def test_a_step_on_ownership_and_a_step_without_its_group() -> None:
    steps = [
        ScriptStep(IDS["Ridgeway"], IDS["Coldwell"], at=200),
        ScriptStep(IDS["Coldwell"], IDS["Ridgeway"], owns=IDS["Coldwell"]),
        ScriptStep(IDS["Westmarch"], IDS["Coldwell"], at=5),  # not its group: skipped
    ]
    match = Match(MAP, RULES, HEADLESS_MATCH_KEY)
    bot = ScriptedBot(steps)
    seat = Seat(match, 1, bot, decide_every=1)
    moves: list[tuple[int, int]] = []
    while match.tick < 280:
        pending = seat.commands()
        for c in pending:
            assert isinstance(c.cmd, Move)
            moves.append((match.tick + 1, c.cmd.dest))
        match.step(pending)
    # Coldwell taken at 267, the raiders go home with the next tick
    assert moves == [(200, IDS["Coldwell"]), (268, IDS["Ridgeway"])]
    assert not bot.thinks(match.tick)  # every step given


def test_it_needs_its_view_only_when_a_step_is_due() -> None:
    bot = ScriptedBot([ScriptStep(IDS["Ridgeway"], IDS["Coldwell"], at=200)])
    assert not bot.thinks(100) and bot.thinks(199)
    waiting = ScriptedBot([ScriptStep(IDS["Coldwell"], IDS["Ridgeway"], owns=IDS["Coldwell"])])
    assert waiting.thinks(0)


def test_a_step_has_one_condition() -> None:
    with pytest.raises(ValueError, match="exactly one"):
        ScriptStep(0, 1)
    with pytest.raises(ValueError, match="exactly one"):
        ScriptStep(0, 1, at=3, owns=2)
