"""Match engine (SIM-15): the fixed system order, the tick convention, the end of a match and
``run_headless`` with simple controllers on the MVP maps."""

import dataclasses
from collections.abc import Callable
from pathlib import Path

import pytest

from gow_sim.commands import (
    Command,
    Forfeit,
    Move,
    Ok,
    PlayerCommand,
    Recruit,
    Reject,
    RejectCode,
    SetStance,
)
from gow_sim.maps import MapDef, load_map
from gow_sim.match import SYSTEMS, Controller, Match, MatchFinishedError, run_headless
from gow_sim.ruleset import Ruleset, Stance
from gow_sim.systems.victory import EndReason, Outcome
from gow_sim.view import PlayerView, opaque_id, project, resolve

ROOT = Path(__file__).resolve().parents[3]
TESTS_DIR = Path(__file__).resolve().parent
KEY = bytes(range(32))
MVP_MAPS = ("arteriya", "pautina", "pereval")

type BotFactory = Callable[[MapDef, Ruleset], Controller]


def _map(name: str) -> MapDef:
    path = TESTS_DIR / "maps" / f"{name}.json"
    return load_map(path if path.exists() else ROOT / "maps" / f"{name}.json")


def test_system_order_is_fixed() -> None:
    # AGENTS.md, section 4.2; apply_commands runs before these.
    assert [name for name, _ in SYSTEMS] == [
        "economy",
        "movement",
        "combat",
        "capacity",
        "supply",
        "recruit",
        "build",
        "orders",
        "victory",
        "vision",
    ]


def test_tick_grows_before_the_systems(mvp_rules: Ruleset) -> None:
    match = Match(_map("line3"), mvp_rules, KEY)
    assert match.tick == 0
    events = match.step([PlayerCommand(0, 0, SetStance(Stance.WAR))])
    assert match.tick == 1
    assert events and all(e.tick == 1 for e in events)
    assert [(r.player, r.seq, r.tick) for r in match.results] == [(0, 0, 1)]
    assert isinstance(match.results[0].outcome, Ok)
    # The command's event comes first: apply_commands is the first system of the tick.
    assert events[0].kind == "stance_changed"


def test_step_keeps_the_events_of_the_tick_in_the_state(mvp_rules: Ruleset) -> None:
    match = Match(_map("line3"), mvp_rules, KEY)
    events = match.step([PlayerCommand(0, 0, Recruit(0))])
    assert events == match.state.events
    assert "recruited" in [e.kind for e in events]
    assert match.step() == match.state.events
    assert "recruited" not in [e.kind for e in match.state.events]


def test_vision_memory_is_refreshed_at_the_end_of_each_tick(mvp_rules: Ruleset) -> None:
    match = Match(_map("line3"), mvp_rules, KEY)
    match.step()
    memory = match.state.vision_memory[0]
    assert sorted(memory.nodes) == [0, 1] and memory.nodes[1].tick == 1


def test_forfeit_ends_the_match(mvp_rules: Ruleset) -> None:
    match = Match(_map("line3"), mvp_rules, KEY)
    events = match.step([PlayerCommand(0, 0, Forfeit())])
    assert match.finished
    assert match.outcome == Outcome(1, EndReason.FORFEIT)
    assert events[-1].kind == "match_ended"
    with pytest.raises(MatchFinishedError):
        match.step()


def test_timer_ends_the_match(mvp_rules: Ruleset) -> None:
    rules = dataclasses.replace(mvp_rules, match_ticks=120)
    match = Match(_map("line3"), rules, KEY)
    while not match.finished:
        match.step()
    assert match.tick == 120
    # line3 is symmetric and nobody moves: equal VP and equal cities.
    assert match.outcome == Outcome(None, EndReason.DRAW)


def test_view_and_resolve_use_the_match_key(mvp_rules: Ruleset) -> None:
    match = Match(_map("line3"), mvp_rules, KEY)
    assert match.view(0) == project(match.state, mvp_rules, 0, KEY)
    (own,) = [g for g in match.state.groups.values() if g.owner == 0]
    oid = opaque_id(KEY, 0, own.id)
    assert match.resolve(0, Move(oid, 1)) == Move(own.id, 1)
    assert match.resolve(0, Move(oid, 1)) == resolve(match.state, 0, Move(oid, 1), KEY)
    match.step([PlayerCommand(0, 0, match.resolve(0, Move(own.id, 1)))])  # internal id: unknown
    assert match.results[0].outcome == Reject(RejectCode.NOT_FOUND_OR_HIDDEN)


def test_match_key_is_checked(mvp_rules: Ruleset) -> None:
    with pytest.raises(ValueError, match="match_key"):
        Match(_map("line3"), mvp_rules, b"too short")


class _Recorder:
    """Records the ticks it is asked at; sends nothing."""

    def __init__(self) -> None:
        self.ticks: list[int] = []

    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        assert view.tick == tick
        self.ticks.append(tick)
        return []


def test_run_headless_calls_controllers_every_decide_every_ticks(mvp_rules: Ruleset) -> None:
    a, b = _Recorder(), _Recorder()
    result = run_headless(_map("line3"), mvp_rules, [a, b], max_ticks=23, decide_every=5)
    assert a.ticks == b.ticks == [0, 5, 10, 15, 20]
    assert result.outcome is None and result.ticks == 23


@pytest.mark.parametrize("name", MVP_MAPS)
def test_full_headless_match_on_mvp_maps(
    name: str, mvp_rules: Ruleset, expand_bot: BotFactory
) -> None:
    mapdef = _map(name)
    result = run_headless(mapdef, mvp_rules, [expand_bot(mapdef, mvp_rules) for _ in range(2)])
    assert result.outcome is not None
    assert result.ticks <= mvp_rules.match_ticks
    assert min(result.accepted) > 10  # the controllers did play


def test_headless_match_is_deterministic(mvp_rules: Ruleset, expand_bot: BotFactory) -> None:
    mapdef = _map("pautina")
    runs = [
        run_headless(mapdef, mvp_rules, [expand_bot(mapdef, mvp_rules) for _ in range(2)], 1000)
        for _ in range(2)
    ]
    assert runs[0] == runs[1]
    assert sum(runs[0].accepted) > 0
