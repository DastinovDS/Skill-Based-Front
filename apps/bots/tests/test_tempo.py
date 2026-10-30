"""#166, PR 3: human tempo and difficulty levels of the smart bots (``gow_bots.bots.tempo``),
front marker hysteresis, ``bot_factory`` and the parameter search (``gow_bots.search``).

Expected values come from the definitions of the tempo (``apm`` commands per minute of
``60 * tick_hz`` ticks, at most ``burst`` saved up; a decision at most every ``think_ticks``; a
strike or a figure noticed ``react_ticks`` after it is shown), not from the bots' output.
"""

import dataclasses
import json
import random
from collections.abc import Iterator, Sequence
from pathlib import Path

import pytest

from gow_bots.bots import (
    DEFAULT_DIFFICULTY,
    DIFFICULTIES,
    ParamRange,
    SmartBot,
    SmartExpander,
    SmartRusher,
    Tempo,
    bot_factory,
)
from gow_bots.bots.tempo import Bucket, Perception
from gow_bots.search import mutate, run_search, score_rows
from gow_bots.tournament import MatchTask
from gow_sim.commands import PlayerCommand, SetFront
from gow_sim.maps import MapDef
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset
from gow_sim.view import Detail, EnemyGroupView, IntentKind, IntentView, Mode, PlayerView

KEY = bytes(range(32))
ROOT = Path(__file__).resolve().parents[3]


def _start(mapdef: MapDef, rules: Ruleset, player: int = 0) -> PlayerView:
    return Match(mapdef, rules, KEY).view(player)


# The levels -----------------------------------------------------------------------------------


def test_levels_slow_down_from_hard_to_easy() -> None:
    assert list(DIFFICULTIES) == ["easy", "normal", "hard"]
    assert DEFAULT_DIFFICULTY == "hard"
    easy, normal, hard = (DIFFICULTIES[k] for k in ("easy", "normal", "hard"))
    assert easy.think_ticks > normal.think_ticks > hard.think_ticks == 5  # the call cadence
    assert easy.react_ticks > normal.react_ticks > hard.react_ticks == 0
    assert easy.apm < normal.apm < hard.apm
    assert not easy.insight and normal.insight and hard.insight
    with pytest.raises(ValueError):
        Tempo(think_ticks=0, react_ticks=0, apm=1, burst=1, insight=True)


def test_bot_factory_takes_a_level_and_parameters(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    plain = bot_factory("smart_rusher")(mapdef, mvp1_rules, seed=0, player=0)
    assert isinstance(plain, SmartRusher) and plain.difficulty == "hard"
    easy = bot_factory("smart_rusher@easy")(mapdef, mvp1_rules, seed=0, player=0)
    assert isinstance(easy, SmartRusher) and easy.tempo == DIFFICULTIES["easy"]
    # The level changes the tempo only: the drawn parameters are those of the name.
    assert easy.params == plain.params
    tuned = bot_factory("smart_rusher", {"guard": ParamRange(7, 7)})
    bot = tuned(mapdef, mvp1_rules, seed=0, player=0)
    assert isinstance(bot, SmartRusher) and bot.params["guard"] == 7
    assert SmartRusher.PARAMS["guard"] != ParamRange(7, 7)  # the class itself is untouched
    for bad in ("nope", "rusher@easy", "smart_rusher@expert"):
        with pytest.raises(ValueError):
            bot_factory(bad)
    with pytest.raises(ValueError, match="no parameters"):
        bot_factory("smart_rusher", {"nope": ParamRange(1, 1)})


# The bucket and the perception ----------------------------------------------------------------


def test_bucket_pays_apm_commands_a_minute_after_a_burst() -> None:
    tempo = Tempo(think_ticks=5, react_ticks=0, apm=20, burst=3, insight=True)
    bucket = Bucket(tempo, tick_hz=10)
    assert [bucket.take() for _ in range(4)] == [True, True, True, False]  # the burst
    gap = 60 * 10 // 20  # a command every 30 ticks
    bucket.refill(gap - 1)
    assert not bucket.ready()
    bucket.refill(gap)
    assert bucket.take() and not bucket.ready()
    bucket.refill(gap + 10 * 600)  # a long pause saves up the burst only
    assert sum(bucket.take() for _ in range(10)) == 3


def _with_strike_and_figure(view: PlayerView, mapdef: MapDef, created: int) -> PlayerView:
    capital = mapdef.capital(0)
    edge = min(mapdef.incident[capital])
    near = mapdef.edges[edge].other(capital)
    strike = IntentView(5, 1, IntentKind.PLANNED_MOVE, near, capital, created)
    figure = EnemyGroupView(77, 500, True, Detail.EXACT, Mode.ATTACK, 2, 2, None)
    edges = list(view.edges)
    edges[edge] = dataclasses.replace(edges[edge], enemy_groups=(figure,))
    return dataclasses.replace(view, intents=(strike,), edges=tuple(edges))


def test_strikes_and_figures_are_noticed_react_ticks_after_they_are_shown(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    start = _start(mapdef, mvp1_rules)
    seen = Perception(react_ticks=15)

    def at(tick: int) -> PlayerView:
        view = _with_strike_and_figure(dataclasses.replace(start, tick=tick), mapdef, 100)
        return seen.view(view)

    early = at(100)  # both shown first at tick 100
    assert early.intents == () and all(not e.enemy_groups for e in early.edges)
    assert at(114).intents == ()
    late = at(115)
    assert len(late.intents) == 1 and sum(len(e.enemy_groups) for e in late.edges) == 1
    # Without a delay the view is passed on as it is.
    view = _with_strike_and_figure(start, mapdef, 0)
    assert Perception(0).view(view) is view


def test_a_bot_thinks_at_most_every_think_ticks(
    maps: dict[str, MapDef], mvp1_rules: Ruleset
) -> None:
    mapdef = maps["web"]
    view = _start(mapdef, mvp1_rules)
    bot = SmartExpander(mapdef, mvp1_rules, seed=0, player=0, difficulty="normal")
    assert bot.decide(view, 0)  # the first decision: stance, markers, orders
    think = DIFFICULTIES["normal"].think_ticks
    assert bot.thought == 0
    bot.decide(dataclasses.replace(view, tick=think - 5), think - 5)
    assert bot.thought == 0  # too early: nothing decided
    bot.bucket.tokens = bot.bucket.cap  # commands to pay with (the first decision spent them)
    bot.decide(dataclasses.replace(view, tick=think), think)
    assert bot.thought == think
    bot.bucket.tokens = 0  # an empty bucket: no decision either
    bot.decide(dataclasses.replace(view, tick=2 * think), 2 * think)
    assert bot.thought == think


@pytest.mark.parametrize("level", list(DIFFICULTIES))
def test_commands_a_minute_stay_within_the_bucket(
    maps: dict[str, MapDef], mvp1_rules: Ruleset, level: str
) -> None:
    # In any window of a minute a bot sends at most ``burst + apm`` commands (a full bucket and
    # a minute of refill), free commands included.
    mapdef = maps["artery"]
    tempo = DIFFICULTIES[level]
    bots = [
        SmartRusher(mapdef, mvp1_rules, seed=3, player=0, difficulty=level),
        SmartExpander(mapdef, mvp1_rules, seed=3, player=1, difficulty=level),
    ]
    match = Match(mapdef, mvp1_rules, KEY)
    sent: list[list[int]] = [[], []]
    seq = 0
    minute = 60 * mvp1_rules.tick_hz
    while match.tick < 3 * minute and not match.finished:
        cmds: list[PlayerCommand] = []
        if match.tick % 5 == 0:
            for p in (0, 1):
                for cmd in bots[p].decide(match.view(p), match.tick):
                    cmds.append(PlayerCommand(p, seq, match.resolve(p, cmd)))
                    sent[p].append(match.tick)
                    seq += 1
        match.step(cmds)
    for ticks in sent:
        assert ticks  # the bots play
        for t in ticks:
            window = sum(1 for u in ticks if t <= u < t + minute)
            assert window <= tempo.burst + tempo.apm, (level, t, window)


# Front marker hysteresis ----------------------------------------------------------------------


def test_a_front_marker_holds_its_city_until_the_hold_ends(
    maps: dict[str, MapDef], mvp1_rules: Ruleset, monkeypatch: pytest.MonkeyPatch
) -> None:
    from gow_bots.bots.smart import FRONT_HOLD

    mapdef = maps["web"]
    view = _start(mapdef, mvp1_rules)
    own = [n.id for n in view.nodes if n.owner == 0]
    a, b, c, d, e = own[:5]
    bot = SmartRusher(mapdef, mvp1_rules, seed=0, player=0)
    ranking = [a, b, c, d]

    def front_cities(_view: PlayerView) -> list[int]:
        return ranking

    def supplied(_view: PlayerView) -> list[bool]:
        return [True] * len(view.nodes)

    monkeypatch.setattr(bot, "front_cities", front_cities)
    monkeypatch.setattr(bot, "supplied", supplied)
    assert bot.fronts(view) == [SetFront(0, a), SetFront(1, b)]
    placed = dataclasses.replace(view, me=dataclasses.replace(view.me, fronts=(a, b)))
    ranking = [c, d, e, a, b]  # a and b drop out of the wanted cities, still candidates
    soon = dataclasses.replace(placed, tick=FRONT_HOLD - 5)
    assert bot.fronts(soon) == []  # held
    late = dataclasses.replace(placed, tick=FRONT_HOLD)
    assert bot.fronts(late) == [SetFront(0, c), SetFront(1, d)]
    # A marker within one rank of the wanted ones stays after the hold (here the hold of the
    # moves above has ended too).
    later = dataclasses.replace(placed, tick=2 * FRONT_HOLD)
    ranking = [c, a, d, b]
    assert bot.fronts(later) == [SetFront(1, c)]
    # With no wanted city free, a marker stays on its own city.
    ranking = [a]
    assert bot.fronts(dataclasses.replace(placed, tick=4 * FRONT_HOLD)) == []
    # A lost city gives its marker up at once, hold or not.
    lost = list(placed.nodes)
    lost[b] = dataclasses.replace(lost[b], owner=1)
    ranking = [a, c]
    bot.front_set = [None, 4 * FRONT_HOLD]
    lost_view = dataclasses.replace(placed, tick=4 * FRONT_HOLD + 5, nodes=tuple(lost))

    def owned(v: PlayerView) -> list[bool]:
        return [n.owner == 0 for n in v.nodes]

    monkeypatch.setattr(bot, "supplied", owned)
    assert bot.fronts(lost_view) == [SetFront(1, c)]


# The search -----------------------------------------------------------------------------------


def test_mutate_moves_keys_one_step_and_keeps_widths() -> None:
    ranges = {"a": (0, 4), "b": (100, 120), "c": (3, 3)}
    rng = random.Random(1)
    for _ in range(50):
        out = mutate(ranges, ["a", "b", "c"], 2, rng)
        moved = [k for k in ranges if out[k] != ranges[k]]
        assert len(moved) == 2
        for k in moved:
            (lo, hi), (lo2, hi2) = ranges[k], out[k]
            step = max(1, (lo + hi) // 8)
            assert hi2 - lo2 == hi - lo and lo2 >= 0
            assert lo2 - lo in (step, -step) or lo2 == 0  # a step, or down to 0


def test_score_rows_counts_wins_draws_and_the_vp_share() -> None:
    rows = [
        {"bot0": "x", "bot1": "y", "winner": 0, "vp": [3, 1]},
        {"bot0": "y", "bot1": "x", "winner": 0, "vp": [1, 1]},
        {"bot0": "x", "bot1": "y", "winner": None, "vp": [0, 0]},
    ]
    rate, share = score_rows(rows, "x")
    assert rate == pytest.approx((1 + 0 + 0.5) / 3)
    assert share == pytest.approx((0.75 + 0.5 + 0.5) / 3)


def test_search_keeps_the_best_ranges() -> None:
    # A fake tournament: the bot wins when its "guard" is at most 1, and its VP share grows as
    # the guard falls, so the search climbs down.
    def play(tasks: Sequence[MatchTask], _jobs: int | None) -> Iterator[str]:
        for t in tasks:
            guard = next(lo for _b, k, lo, _hi in t.params if k == "guard")
            side = t.bots.index("smart_rusher")
            vp = [10 - guard, 10 + guard] if side == 0 else [10 + guard, 10 - guard]
            winner = side if guard <= 1 else 1 - side
            row = {"bot0": t.bots[0], "bot1": t.bots[1], "winner": winner, "vp": vp}
            yield json.dumps(row)

    start = {k: (r.low, r.high) for k, r in SmartRusher.PARAMS.items()}
    start["guard"] = (4, 4)
    rounds = list(
        run_search(
            [str(ROOT / "maps" / "fixtures" / "web.json")],
            str(ROOT / "rulesets" / "test-short.toml"),
            "smart_rusher",
            ["idle"],
            keys=["guard"],
            rounds=20,
            seeds=1,
            mutate_count=1,
            start=start,
            play=play,
        )
    )
    assert rounds[0][0] == 0 and rounds[0][2]
    best = [c for _, c, ok in rounds if ok][-1]
    assert best.win_rate == 1.0 and best.ranges["guard"][0] <= 1
    scores = [c.score for _, c, ok in rounds if ok]
    assert scores == sorted(scores) and len(set(scores)) == len(scores)
    with pytest.raises(ValueError, match="own opponent"):
        next(run_search([], "x", "idle", ["idle"], keys=["a"], rounds=1, seeds=1))


def test_every_level_of_every_personality_plays(
    maps: dict[str, MapDef], short_rules: Ruleset
) -> None:
    from gow_bots.bots.smart import PERSONALITIES
    from gow_sim.match import run_headless

    mapdef = maps["pass"]
    for cls in PERSONALITIES:
        for level in DIFFICULTIES:
            bots: list[SmartBot] = [
                cls(mapdef, short_rules, seed=1, player=p, difficulty=level) for p in (0, 1)
            ]
            run_headless(mapdef, short_rules, bots)
            assert all(b.thought is not None for b in bots), (cls.name, level)
