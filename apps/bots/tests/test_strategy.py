"""BOT-02: the strategy bots ``expander`` and ``turtle``.

Win rates are measured on full matches of the ruleset ``mvp-0`` on the three MVP maps, each bot on
both sides against ``RandomLegalBot``. Expected enemy numbers in the estimate tests come from
the rules of DEC-04 (what a view tells) and DEC-07, example 5 (an empty node falls).
"""

import dataclasses

import pytest

from gow_bots.bots import BOTS, ExpanderBot, ParamRange, TurtleBot, choose_params
from gow_bots.bots.base import Controller
from gow_bots.bots.tactics import MEMORY_TICKS, StrategyBot
from gow_sim.commands import Command, Move, Recruit, SetMode, SetStance, UpgradeRoad
from gow_sim.maps import MapDef
from gow_sim.match import Match, run_headless
from gow_sim.ruleset import Ruleset
from gow_sim.view import AtNode, Detail, Mode, NodeView, PlayerView, Sighting, Stance

MVP_MAPS = ("arteriya", "pautina", "pereval")
STRATEGY = ("expander", "turtle")
CLASSES: dict[str, type[StrategyBot]] = {"expander": ExpanderBot, "turtle": TurtleBot}
KEY = bytes(range(32))


def _random(mapdef: MapDef, rules: Ruleset, seed: int, side: int) -> Controller:
    return BOTS["random_legal"](mapdef, rules, seed=seed + 1000, player=side)


class _Recorder:
    """Passes every decision through and keeps the commands."""

    def __init__(self, bot: Controller) -> None:
        self.bot = bot
        self.cmds: list[Command] = []

    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        cmds = self.bot.decide(view, tick)
        self.cmds.extend(cmds)
        return cmds


# Strength against the baseline ------------------------------------------------------------------


@pytest.mark.slow  # 12 cells x 6 full mvp-0 matches
@pytest.mark.parametrize("name", STRATEGY)
@pytest.mark.parametrize("map_name", MVP_MAPS)
def test_strategy_bot_beats_random_legal_in_90_percent(
    maps: dict[str, MapDef], mvp_rules: Ruleset, name: str, map_name: str
) -> None:
    mapdef = maps[map_name]
    wins = games = 0
    for seed in range(3):
        for side in (0, 1):
            bots = [_random(mapdef, mvp_rules, seed, 0), _random(mapdef, mvp_rules, seed, 1)]
            bots[side] = BOTS[name](mapdef, mvp_rules, seed=seed, player=side)
            result = run_headless(mapdef, mvp_rules, bots)
            assert result.outcome is not None
            assert max(result.rejected) * 10 <= max(result.accepted)  # legal commands
            wins += result.outcome.winner == side
            games += 1
    assert wins * 10 >= games * 9, f"{wins} wins of {games}"


# Seed variability and determinism -----------------------------------------------------------------


@pytest.mark.parametrize("name", STRATEGY)
def test_params_stay_in_their_ranges_and_depend_on_the_seed(
    maps: dict[str, MapDef], mvp_rules: Ruleset, name: str
) -> None:
    cls = CLASSES[name]
    seen: set[tuple[tuple[str, int], ...]] = set()
    for seed in range(30):
        bot = cls(maps["pautina"], mvp_rules, seed=seed, player=1)
        for key, r in cls.PARAMS.items():
            assert r.low <= bot.params[key] <= r.high
        seen.add(tuple(sorted(bot.params.items())))
    assert len(seen) > 15


@pytest.mark.slow  # 10 matches of 250 s per bot
@pytest.mark.parametrize("name", STRATEGY)
def test_one_pair_over_seeds_gives_different_matches(
    maps: dict[str, MapDef], mvp_rules: Ruleset, name: str
) -> None:
    # The first 250 s of mvp-0: the 60 s of test-short end before the parameters matter.
    mapdef = maps["pautina"]
    hashes = {
        run_headless(
            mapdef,
            mvp_rules,
            [BOTS[name](mapdef, mvp_rules, seed=s, player=p) for p in (0, 1)],
            max_ticks=2500,
        ).state_hash
        for s in range(10)
    }
    assert len(hashes) >= 3


# Mirror symmetry ----------------------------------------------------------------------------------


# 4 short matches (test-short) per cell in the required path; one full mvp-0 match is ``slow``.
_SELF_PLAY = [
    pytest.param("short", 4, id="short"),
    pytest.param("mvp", 1, id="mvp-0", marks=pytest.mark.slow),
]


@pytest.mark.parametrize("rules_name, seeds", _SELF_PLAY)
@pytest.mark.parametrize("name", STRATEGY)
@pytest.mark.parametrize("map_name", MVP_MAPS)
def test_self_play_on_a_symmetric_map_is_a_draw_on_vp(
    maps: dict[str, MapDef],
    mvp_rules: Ruleset,
    short_rules: Ruleset,
    name: str,
    map_name: str,
    rules_name: str,
    seeds: int,
) -> None:
    # Both sides get the parameters of side 0; then nothing but opaque ids differs between them,
    # and a tie-break by opaque id would break the equality of the VP.
    mapdef = maps[map_name]
    cls = CLASSES[name]
    rules = short_rules if rules_name == "short" else mvp_rules
    for seed in range(seeds):
        fixed = {k: ParamRange(v, v) for k, v in choose_params(name, seed, 0, cls.PARAMS).items()}
        twin = type("Twin", (cls,), {"PARAMS": fixed})
        bots = [twin(mapdef, rules, seed=seed, player=p) for p in (0, 1)]
        result = run_headless(mapdef, rules, bots)
        assert result.vp[0] == result.vp[1]
        assert result.accepted[0] == result.accepted[1]
        assert result.outcome is not None and result.outcome.winner is None


# The bots do what their names say ----------------------------------------------------------------


def test_expander_spends_the_start_cp_on_neutral_nodes(
    maps: dict[str, MapDef], mvp_rules: Ruleset
) -> None:
    mapdef = maps["pautina"]
    view = Match(mapdef, mvp_rules, KEY).view(0)
    bot = ExpanderBot(mapdef, mvp_rules, seed=0, player=0)
    cmds = bot.decide(view, 0)
    assert SetStance(Stance.WAR) in cmds
    moves = [c for c in cmds if isinstance(c, Move)]
    # 3 CP at the start: three one-CP orders (a plan would cost two), all to neutral nodes.
    assert len(moves) + sum(isinstance(c, Recruit) for c in cmds) == 3
    assert all(not c.planned and view.nodes[c.dest].owner is None for c in moves)
    capital = {g.id for g in view.groups if g.location == AtNode(mapdef.capital(0))}
    assert not capital & {c.group for c in moves}  # the capital group stays at home


def test_expander_builds_roads_in_the_rear(maps: dict[str, MapDef], mvp_rules: Ruleset) -> None:
    mapdef = maps["arteriya"]
    rec = _Recorder(ExpanderBot(mapdef, mvp_rules, seed=2, player=0))
    run_headless(mapdef, mvp_rules, [rec, BOTS["idle"](mapdef, mvp_rules, seed=0, player=1)])
    assert any(isinstance(c, UpgradeRoad) for c in rec.cmds)


def test_expander_takes_empty_enemy_nodes(maps: dict[str, MapDef], mvp_rules: Ruleset) -> None:
    mapdef = maps["pautina"]
    result = run_headless(
        mapdef,
        mvp_rules,
        [
            ExpanderBot(mapdef, mvp_rules, seed=1, player=0),
            BOTS["idle"](mapdef, mvp_rules, seed=0, player=1),
        ],
    )
    assert result.outcome is not None and result.outcome.winner == 0
    assert result.vp[0] > 3 * result.vp[1]  # it did not stop at the neutral nodes


def _front_view(mapdef: MapDef, rules: Ruleset) -> tuple[PlayerView, int]:
    """The start view of side 0 where enemy groups stand in a neutral node next to an own node."""
    view = Match(mapdef, rules, KEY).view(0)
    own = {n.id for n in view.nodes if n.owner == 0}
    front = next(
        (n, m)
        for n in sorted(own - {mapdef.capital(0)})
        for m in sorted(e.other(n) for e in map(mapdef.edges.__getitem__, mapdef.incident[n]))
        if m not in own
    )
    sighting = Sighting(view.tick, Detail.PRESENCE, (Mode.ATTACK,), None, None)
    nodes = list(view.nodes)
    nodes[front[1]] = dataclasses.replace(nodes[front[1]], detail=Detail.PRESENCE, seen=sighting)
    return dataclasses.replace(view, nodes=tuple(nodes)), front[0]


def test_turtle_sets_defense_on_the_front_group(
    maps: dict[str, MapDef], mvp_rules: Ruleset
) -> None:
    mapdef = maps["pautina"]
    view, front = _front_view(mapdef, mvp_rules)
    bot = TurtleBot(mapdef, mvp_rules, seed=0, player=0)
    cmds = bot.decide(view, 0)
    assert SetStance(Stance.ECONOMY) in cmds
    defended = {c.group for c in cmds if isinstance(c, SetMode) and c.mode is Mode.DEFENSE}
    assert defended == {g.id for g in view.groups if g.location == AtNode(front)}
    # The bunker pays 2 CP for «Защита» before it spends anything on expansion.
    assert sum(isinstance(c, Move) for c in cmds) <= 1


def test_turtle_stays_in_its_region_while_cp_do_not_burn(
    maps: dict[str, MapDef], mvp_rules: Ruleset
) -> None:
    mapdef = maps["pereval"]
    bot = TurtleBot(mapdef, mvp_rules, seed=5, player=0)
    rec = _Recorder(bot)
    match = Match(mapdef, mvp_rules, KEY)
    for tick in range(0, 1500, 5):
        view = match.view(0)
        if view.me.cp < bot.params["spill_cp"]:
            dests = {c.dest for c in rec.decide(view, tick) if isinstance(c, Move)}
            assert dests <= bot.region
        match.step([])


# The estimate of enemy strength (DEC-04) ----------------------------------------------------------


def _estimate(
    mapdef: MapDef,
    rules: Ruleset,
    detail: Detail,
    seen: Sighting | None,
    tick: int = 100,
    memory: tuple[int, int, int] | None = None,
) -> tuple[int, int]:
    view = Match(mapdef, rules, KEY).view(0)
    node = next(n.id for n in view.nodes if n.owner == 1)
    nodes = list(view.nodes)
    nodes[node] = NodeView(node, 1, 6, detail, None, seen)
    view = dataclasses.replace(view, nodes=tuple(nodes))
    bot = ExpanderBot(mapdef, rules, seed=0, player=0)
    if memory is not None:
        bot.memory[node] = memory
    turn = bot.begin(view, tick)
    return bot.estimate(turn, node, est_pct=50)


def test_estimate_of_an_observed_empty_node_is_zero(
    maps: dict[str, MapDef], mvp_rules: Ruleset
) -> None:
    mapdef = maps["pautina"]
    empty = Sighting(100, Detail.PRESENCE, (), None, None)
    assert _estimate(mapdef, mvp_rules, Detail.PRESENCE, empty) == (0, 0)


def test_estimate_uses_exact_numbers_when_the_view_has_them(
    maps: dict[str, MapDef], mvp_rules: Ruleset
) -> None:
    exact = Sighting(100, Detail.EXACT, (Mode.DEFENSE,), 4, 3)
    assert _estimate(maps["pautina"], mvp_rules, Detail.EXACT, exact) == (4, 3)


def test_estimate_of_presence_is_the_larger_of_memory_and_the_capacity_guess(
    maps: dict[str, MapDef], mvp_rules: Ruleset
) -> None:
    mapdef = maps["pautina"]
    seen = Sighting(100, Detail.PRESENCE, (Mode.ATTACK,), None, None)
    # Capacity 6, est_pct 50: 3 units, all charged, when nothing better is known.
    assert _estimate(mapdef, mvp_rules, Detail.PRESENCE, seen) == (3, 3)
    assert _estimate(mapdef, mvp_rules, Detail.PRESENCE, seen, memory=(5, 4, 90)) == (5, 4)
    fresh = _estimate(mapdef, mvp_rules, Detail.PRESENCE, seen, memory=(5, 2, 90))
    assert fresh == (5, 3)  # units from the memory, charges at least the guess
    stale = _estimate(
        mapdef, mvp_rules, Detail.PRESENCE, seen, tick=100 + MEMORY_TICKS + 1, memory=(5, 5, 90)
    )
    assert stale == (3, 3)  # a sighting older than MEMORY_TICKS is forgotten


def test_strategy_bots_are_registered_and_refuse_foreign_views(
    maps: dict[str, MapDef], mvp_rules: Ruleset
) -> None:
    assert BOTS["expander"] is ExpanderBot and BOTS["turtle"] is TurtleBot
    view = Match(maps["pautina"], mvp_rules, KEY).view(1)
    with pytest.raises(ValueError, match="player 0"):
        ExpanderBot(maps["pautina"], mvp_rules, seed=0, player=0).decide(view, 0)
