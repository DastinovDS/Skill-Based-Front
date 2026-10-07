"""BOT-03: Rusher, Strangler and Reactive.

Full matches on the MVP maps against ``random_legal`` (each must win at least 90%), self-play
symmetry, and the scenarios of the behaviour: Strangler cuts a road on ``siege.json``, Reactive
answers a visible planned strike within 10 ticks.
"""

from dataclasses import dataclass, replace
from pathlib import Path
from typing import ClassVar

import pytest

from gow_bots.bots import (
    BOTS,
    Controller,
    IdleBot,
    RandomLegalBot,
    ReactiveBot,
    RusherBot,
    StranglerBot,
)
from gow_bots.bots.base import Bot
from gow_sim.commands import Command, Move, Ok, PlayerCommand, SetMode
from gow_sim.maps import MapDef, load_map
from gow_sim.match import Match, run_headless
from gow_sim.ruleset import Ruleset
from gow_sim.view import AtNode, Mode

ROOT = Path(__file__).resolve().parents[3]
MVP_MAPS = ("arteriya", "pautina", "pereval")
CLASSES: dict[str, type[Bot]] = {
    "rusher": RusherBot,
    "strangler": StranglerBot,
    "reactive": ReactiveBot,
}
CAMPAIGN = tuple(CLASSES)
KEY = bytes(range(32))


# Against RandomLegal ---------------------------------------------------------------------------

SEEDS = 10  # per map, half of them on each side: 90% means at most one loss


@pytest.mark.slow  # 12 cells x 10 full mvp-0 matches
@pytest.mark.parametrize("name", CAMPAIGN)
@pytest.mark.parametrize("map_name", MVP_MAPS)
def test_wins_at_least_90_percent_against_random_legal(
    maps: dict[str, MapDef], mvp_rules: Ruleset, name: str, map_name: str
) -> None:
    mapdef = maps[map_name]
    wins = 0
    for seed in range(SEEDS):
        side = seed % 2
        mine = BOTS[name](mapdef, mvp_rules, seed=seed, player=side)
        theirs = RandomLegalBot(mapdef, mvp_rules, seed=seed, player=1 - side)
        result = run_headless(mapdef, mvp_rules, [mine, theirs] if side == 0 else [theirs, mine])
        assert result.outcome is not None
        wins += result.outcome.winner == side
        assert result.rejected[side] * 5 <= result.accepted[side]  # the commands are legal
    assert wins * 100 >= 90 * SEEDS, f"{name} won {wins} of {SEEDS} on {map_name}"


# Self-play -----------------------------------------------------------------------------------


def _mirrored(cls: type[Bot]) -> type[Bot]:
    """The bot class whose side 1 draws the parameters and choices of side 0."""

    class Mirrored(cls):
        name: ClassVar[str] = cls.name

        def __init__(self, mapdef: MapDef, rules: Ruleset, *, seed: int, player: int) -> None:
            super().__init__(mapdef, rules, seed=seed, player=player)
            twin = cls(mapdef, rules, seed=seed, player=0)
            self.params, self.rng = twin.params, twin.rng

    return Mirrored


@pytest.mark.parametrize("name", CAMPAIGN)
@pytest.mark.parametrize("map_name", MVP_MAPS)
def test_self_play_on_a_symmetric_map_is_a_draw(
    maps: dict[str, MapDef], short_rules: Ruleset, name: str, map_name: str
) -> None:
    # Nothing but the opaque ids differs between the sides, so a tie-break by id breaks this.
    mapdef = maps[map_name]
    cls = _mirrored(CLASSES[name])
    for seed in range(4):
        bots = [cls(mapdef, short_rules, seed=seed, player=p) for p in (0, 1)]
        result = run_headless(mapdef, short_rules, bots)
        assert result.vp[0] == result.vp[1]
        assert result.accepted[0] == result.accepted[1]
        assert result.outcome is not None and result.outcome.winner is None


# Scenarios -----------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Sent:
    tick: int
    player: int
    cmd: Command
    accepted: bool


def _play(
    match: Match, bots: list[Controller], until: int, script: dict[int, list[PlayerCommand]]
) -> list[Sent]:
    """Play to tick ``until`` with the ``script`` of extra commands by tick; the commands of the
    bots and whether the simulation accepted them."""
    sent: dict[int, Sent] = {}
    seq = 1000
    while match.tick < until and not match.finished:
        cmds = list(script.get(match.tick, []))
        if match.tick % 5 == 0:
            for p in (0, 1):
                for cmd in bots[p].decide(match.view(p), match.tick):
                    sent[seq] = Sent(match.tick, p, cmd, False)
                    cmds.append(PlayerCommand(p, seq, match.resolve(p, cmd)))
                    seq += 1
        match.step(cmds)
        for r in match.results:
            if r.seq in sent and isinstance(r.outcome, Ok):
                sent[r.seq] = replace(sent[r.seq], accepted=True)
    return list(sent.values())


def test_strangler_cuts_the_enemy_road_on_siege(mvp_rules: Ruleset) -> None:
    # siege.json: the enemy network is 5-4-3 (+ 4-7-6-1 through the neutral middle). Taking
    # node 3 or 4 turns the internal road 4-3 or 5-4 of player 1 into a front line.
    mapdef = load_map(ROOT / "packages" / "sim" / "tests" / "maps" / "siege.json")
    enemy_roads = [
        e.id
        for e in mapdef.edges
        if mapdef.nodes[e.a].start_owner == 1 and mapdef.nodes[e.b].start_owner == 1
    ]
    assert enemy_roads == [3, 4]
    for seed in range(5):
        match = Match(mapdef, mvp_rules, KEY)
        bots: list[Controller] = [
            BOTS["strangler"](mapdef, mvp_rules, seed=seed, player=0),
            IdleBot(mapdef, mvp_rules, seed=seed, player=1),
        ]
        _play(match, bots, 1500, {})
        view = match.view(0)
        owners = [view.nodes[n].owner for n in range(len(mapdef.nodes))]
        cut = [
            e for e in enemy_roads if 0 in (owners[mapdef.edges[e].a], owners[mapdef.edges[e].b])
        ]
        assert cut, f"seed {seed}: no enemy road cut, owners {owners}"


def test_reactive_answers_a_visible_planned_strike_within_10_ticks(short_rules: Ruleset) -> None:
    # Player 1 announces a planned strike from node 3 at the capital 0 of player 0 at tick 0.
    mapdef = load_map(ROOT / "packages" / "sim" / "tests" / "maps" / "siege.json")
    match = Match(mapdef, short_rules, KEY)
    strike_group = next(
        g for g in match.view(1).groups if isinstance(g.location, AtNode) and g.location.node == 3
    )
    script = {0: [PlayerCommand(1, 0, match.resolve(1, Move(strike_group.id, 0, planned=True)))]}
    bots: list[Controller] = [
        BOTS["reactive"](mapdef, short_rules, seed=1, player=0),
        IdleBot(mapdef, short_rules, seed=1, player=1),
    ]
    sent = _play(match, bots, 11, script)
    answers = [
        s for s in sent if s.player == 0 and s.tick <= 10 and isinstance(s.cmd, SetMode | Move)
    ]
    assert any(
        isinstance(s.cmd, SetMode) and s.cmd.mode is Mode.DEFENSE and s.accepted for s in answers
    ), answers


def test_reactive_holds_the_city_that_an_idle_bot_loses(short_rules: Ruleset) -> None:
    mapdef = load_map(ROOT / "packages" / "sim" / "tests" / "maps" / "siege.json")
    held: dict[str, int | None] = {}
    for name in ("reactive", "idle"):
        match = Match(mapdef, short_rules, KEY)
        strike = next(
            g
            for g in match.view(1).groups
            if isinstance(g.location, AtNode) and g.location.node == 3
        )
        script = {0: [PlayerCommand(1, 0, match.resolve(1, Move(strike.id, 0, planned=True)))]}
        bots: list[Controller] = [
            BOTS[name](mapdef, short_rules, seed=1, player=0),
            IdleBot(mapdef, short_rules, seed=1, player=1),
        ]
        _play(match, bots, 200, script)
        held[name] = match.view(0).nodes[0].owner
    assert held["reactive"] == 0
    assert held["idle"] != 0
