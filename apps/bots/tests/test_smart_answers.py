"""#624: the answers of the smart bots to the owner's staging strike (``SmartBot`` items 13-17).

Expected values come from the rules: the CP regeneration and the plan price (DEC-02, DEC-08,
``orders.cost.planned_move``), the plan bonus of two edges (DEC-29), the visible enemy barracks of
an adjacent city (DEC-31), ``defender_pool`` and ``shots_to_take`` (DEC-07), the public intents
of scheduled orders (DEC-08) and the playtest of 2026-10-30 (B1-B4).
"""

import dataclasses
from collections.abc import Mapping
from pathlib import Path
from typing import ClassVar

import pytest

from gow_bots.bots import SmartHoarder, SmartStrangler, SmartTurtle, bot_factory
from gow_bots.bots.assess import Assessment
from gow_bots.bots.campaign import Ctx
from gow_bots.bots.smart import GUESS_UNITS, PERSONALITIES, SmartBot
from gow_bots.bots.utility import shots_to_take
from gow_sim.commands import Move
from gow_sim.maps import MapDef, NodeKind, load_map
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.view import (
    AtNode,
    Detail,
    GroupView,
    IntentKind,
    IntentView,
    Mode,
    PlayerView,
    Sighting,
)

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))
TICK = 3000


@pytest.fixture(scope="module")
def rules() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "mvp-2.toml")


@pytest.fixture(scope="module")
def crossroads() -> MapDef:
    return load_map(ROOT / "maps" / "crossroads.json")


def _named(mapdef: MapDef, name: str) -> int:
    return next(n.id for n in mapdef.nodes if n.name == name)


def _view(mapdef: MapDef, rules: Ruleset, cp: int = 300) -> PlayerView:
    view = Match(mapdef, rules, KEY).view(0)
    return dataclasses.replace(view, tick=TICK, me=dataclasses.replace(view.me, cp=cp))


def _nodes(view: PlayerView, **changes: Mapping[str, object]) -> PlayerView:
    nodes = list(view.nodes)
    for key, change in changes.items():
        node = int(key.removeprefix("n"))
        nodes[node] = dataclasses.replace(nodes[node], **change)  # pyright: ignore[reportArgumentType]
    return dataclasses.replace(view, nodes=tuple(nodes))


def _enemy_seen(charged: int, tick: int = TICK) -> Sighting:
    return Sighting(tick, Detail.EXACT, (Mode.ATTACK,), charged, charged)


def _group(gid: int, node: int, units: int, charged: int) -> GroupView:
    return GroupView(gid, units, charged, Mode.ATTACK, AtNode(node), None)


def _assess(bot: SmartBot, view: PlayerView) -> Assessment:
    return bot.assessor.assess(view, bot.supplied(view), guess=GUESS_UNITS, horizon=60)


# Item 13: the hidden force and the worry -------------------------------------------------------


def test_hidden_shots_need_an_enemy_node_near_the_capital(
    crossroads: MapDef, rules: Ruleset
) -> None:
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    view = _view(crossroads, rules)
    a = dataclasses.replace(_assess(bot, view), enemy_cp=rules.cp.cap)
    assert bot.hidden_shots(view, a) == 0  # no enemy node within two hops: no build-up
    court = _named(crossroads, "Middle Court")
    near = _nodes(view, **{f"n{court}": {"owner": 1}})
    # The cap of 5 CP pays two plans of 2 CP (DEC-08): two guessed groups with a bonus of 2.
    plans = min(2, rules.cp.cap // rules.orders.cost.planned_move)
    expected = plans * (GUESS_UNITS + 2) * SmartBot.ANXIETY // 100
    assert bot.hidden_shots(near, a) == expected
    poor = dataclasses.replace(a, enemy_cp=rules.orders.cost.planned_move - 1)
    assert bot.hidden_shots(near, poor) == 0  # the bound cannot pay a plan yet
    barracks = _nodes(near, **{f"n{court}": {"owner": 1, "has_barracks": True}})
    assert (
        bot.hidden_shots(barracks, a)
        == (plans * (GUESS_UNITS + 2) + GUESS_UNITS) * (SmartBot.ANXIETY) // 100
    )


def test_a_visible_build_up_next_to_the_capital_worries_and_is_a_target(
    crossroads: MapDef, rules: Ruleset
) -> None:
    court = _named(crossroads, "Middle Court")
    view = _view(crossroads, rules)
    built = _nodes(view, **{f"n{court}": {"owner": 1, "seen": _enemy_seen(8)}})
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    w = bot._worry(built, _assess(bot, built))  # pyright: ignore[reportPrivateUsage]
    assert w is not None and w.stage == court and w.shots >= 8
    small = _nodes(view, **{f"n{court}": {"owner": 1, "seen": _enemy_seen(2)}})
    assert bot._worry(small, _assess(bot, small)) is None  # pyright: ignore[reportPrivateUsage]
    old = _nodes(view, **{f"n{court}": {"owner": 1, "seen": _enemy_seen(8, TICK - 200)}})
    assert bot._worry(old, _assess(bot, old)) is None  # pyright: ignore[reportPrivateUsage]


# Item 14: a thin garrison withdraws -------------------------------------------------------------


def _province_next_to(mapdef: MapDef, node: int) -> tuple[int, int]:
    """A province ``p`` next to ``node`` and another own neighbour ``q`` of ``p``."""
    for e in mapdef.incident[node]:
        p = mapdef.edges[e].other(node)
        if mapdef.nodes[p].kind is NodeKind.PROVINCE:
            for f in mapdef.incident[p]:
                q = mapdef.edges[f].other(p)
                if q != node:
                    return p, q
    raise AssertionError("no province")


class _Withdrawing(SmartStrangler):
    """Item 14 is off for the personalities (measured worse, #624); the rule itself is tested."""

    WITHDRAW: ClassVar[bool] = True


def test_a_thin_province_garrison_leaves_before_a_visible_stronger_force(
    crossroads: MapDef, rules: Ruleset
) -> None:
    enemy = _named(crossroads, "Lindenwood")
    prov, back = _province_next_to(crossroads, enemy)
    view = _view(crossroads, rules)
    view = _nodes(
        view,
        **{
            f"n{prov}": {"owner": 0},
            f"n{back}": {"owner": 0},
            f"n{enemy}": {"owner": 1, "seen": _enemy_seen(4)},
        },
    )
    view = dataclasses.replace(view, groups=(*view.groups, _group(900, prov, 1, 1)))
    assert not SmartStrangler.WITHDRAW and not SmartStrangler.WORRY
    bot = _Withdrawing(crossroads, rules, seed=0, player=0)
    # DEC-07: one charge on plains/forest/mountains gives a pool below 4 by 2 or more, and 4
    # shots take a node of one unit: the unit walks to the own neighbour away from the enemy.
    cmds = bot.decide(view, TICK)
    assert any(isinstance(c, Move) and c.group == 900 and c.dest == back for c in cmds)
    calm = _nodes(view, **{f"n{enemy}": {"owner": 1, "seen": _enemy_seen(1)}})
    cmds = _Withdrawing(crossroads, rules, seed=0, player=0).decide(calm, TICK)
    assert not any(isinstance(c, Move) and c.group == 900 and c.dest == back for c in cmds)


def test_the_benchmark_and_easy_bots_do_not_answer(crossroads: MapDef, rules: Ruleset) -> None:
    hoarder = SmartHoarder(crossroads, rules, seed=0, player=0)
    assert not hoarder.answering() and hoarder.striking()
    easy = bot_factory("smart_strangler@easy")(crossroads, rules, seed=0, player=0)
    assert isinstance(easy, SmartBot) and not easy.answering() and not easy.striking()
    for cls in PERSONALITIES:
        assert (cls is not SmartTurtle) == cls.STRIKE, cls.name
        assert cls.ANSWERS


# Item 15: War while the charges burn -----------------------------------------------------------


def test_the_charges_burn_at_nine_tenths_even_with_units_waiting(
    crossroads: MapDef, rules: Ruleset
) -> None:
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    assert bot._burning(9, 10, 3)  # pyright: ignore[reportPrivateUsage]
    assert not bot._burning(8, 10, 0)  # pyright: ignore[reportPrivateUsage]
    easy = bot_factory("smart_strangler@easy")(crossroads, rules, seed=0, player=0)
    assert isinstance(easy, SmartBot)
    assert not easy._burning(9, 10, 0)  # pyright: ignore[reportPrivateUsage]
    assert easy._burning(10, 10, 0)  # pyright: ignore[reportPrivateUsage]


# Item 16: the forward barracks in the centre ---------------------------------------------------


def test_the_forward_barracks_goes_to_the_centre(crossroads: MapDef, rules: Ruleset) -> None:
    centre = _named(crossroads, "Crossroads")
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    assert bot.centre == centre
    view = _view(crossroads, rules)
    bot.hot = [False] * len(crossroads.nodes)
    assert bot.wanted_barracks(view) is None  # not held
    held = _nodes(view, **{f"n{centre}": {"owner": 0, "has_barracks": False}})
    assert bot.wanted_barracks(held) == centre
    bot.hot[centre] = True
    assert bot.wanted_barracks(held) is None  # next to the enemy: it would be lost


# Item 17: two strikes at one node ---------------------------------------------------------------


def test_two_strikes_at_the_capital_raise_the_alarm(crossroads: MapDef, rules: Ruleset) -> None:
    home = crossroads.capital(0)
    view = _view(crossroads, rules)
    near = [crossroads.edges[e].other(home) for e in crossroads.incident[home]]
    ring = {f"n{n}": {"owner": 1} for n in near[:2]}
    view = _nodes(view, **ring)
    one = IntentView(501, 1, IntentKind.PLANNED_MOVE, near[0], home, TICK - 5)
    two = IntentView(502, 1, IntentKind.PLANNED_MOVE, near[1], home, TICK - 5)
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    bot.decide(dataclasses.replace(view, intents=(one,)), TICK)
    assert home not in bot.paired
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    bot.decide(dataclasses.replace(view, intents=(one, two)), TICK)
    assert home in bot.paired and bot.alarm


def test_an_unseen_capital_counts_the_guessed_garrison(crossroads: MapDef, rules: Ruleset) -> None:
    view = _view(crossroads, rules)
    bot = SmartStrangler(crossroads, rules, seed=0, player=0)
    ctx = Ctx(view, TICK, view.me.cp, standing=bot.standing(view))
    terrain = crossroads.nodes[crossroads.capital(1)].terrain
    expected = shots_to_take(rules, terrain, GUESS_UNITS, GUESS_UNITS) + SmartBot.STRIKE_MARGIN
    assert bot.strike_need(ctx) == expected
