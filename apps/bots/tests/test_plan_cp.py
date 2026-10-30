"""#618: the smart bots keep the CP of a scheduled order they chose, and answer a visible strike
at a lesser city.

Expected values come from the rules: a scheduled order costs ``orders.cost.planned_move`` and an
ordinary one ``orders.cost.move`` (DEC-08), Defense switched on is a public intent, the level sets
how late a shown strike is noticed (``Tempo.react_ticks``) and the Defense bonus grows by 1 per
``orders.defense_ticks_per_bonus`` ticks (DEC-30).
"""

import dataclasses
from pathlib import Path

import pytest

import gow_bots.bots.campaign as campaign
from gow_bots.bots import ParamRange, SmartBot, SmartRusher, bot_factory
from gow_bots.bots.smart import PERSONALITIES
from gow_sim.commands import Command, Move, SetMode
from gow_sim.maps import MapDef, load_map
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.view import IntentKind, IntentView, Mode, PlayerView

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))
START = 100


@pytest.fixture(scope="module")
def rules() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "mvp-2.toml")


@pytest.fixture(scope="module")
def web() -> MapDef:
    return load_map(ROOT / "maps" / "fixtures" / "web.json")


def _view(mapdef: MapDef, rules: Ruleset, cp: int, tick: int = START) -> PlayerView:
    view = Match(mapdef, rules, KEY).view(0)
    return dataclasses.replace(view, tick=tick, me=dataclasses.replace(view.me, cp=cp))


def _moves(cmds: list[Command]) -> list[Move]:
    return [c for c in cmds if isinstance(c, Move)]


@pytest.fixture
def two_edges_are_planned(monkeypatch: pytest.MonkeyPatch) -> None:
    """The shared utility answers "planned" for a path of two edges or more, "ordinary" for
    less: the start of the ``web`` map then has a planned attack on top and ordinary ones below."""

    def two_or_more(rules: Ruleset, own_charged: int, need: int, edges: int) -> bool:
        return edges >= 2

    monkeypatch.setattr(campaign, "prefer_planned", two_or_more)


def _rusher(
    mapdef: MapDef, rules: Ruleset, wait: int | None = None, level: str = "hard"
) -> SmartBot:
    params = {} if wait is None else {"wait_plan": ParamRange(wait, wait)}
    bot = bot_factory(f"smart_rusher@{level}", params)(mapdef, rules, seed=0, player=0)
    assert isinstance(bot, SmartRusher)
    return bot


# (a) A chosen plan gets its CP ----------------------------------------------------------------


def test_a_plan_the_cp_cannot_pay_is_held_not_eaten_by_ordinary_orders(
    web: MapDef, rules: Ruleset, two_edges_are_planned: None
) -> None:
    plan, move = rules.orders.cost.planned_move, rules.orders.cost.move
    cp = plan - 50  # a plan is short of 0.5 CP, an ordinary order is paid
    assert move <= cp < plan
    view = _view(web, rules, cp)

    free = _rusher(web, rules, wait=0).decide(view, START)  # the control: no hold
    assert [m for m in _moves(free) if not m.planned]  # it spends the CP on an ordinary order

    bot = _rusher(web, rules)
    assert _moves(bot.decide(view, START)) == []
    assert bot.hold is not None and bot.hold.cost == plan
    assert START < bot.hold.until <= START + bot.params["wait_plan"]


def test_the_hold_ends_with_the_plan_sent_when_the_cp_are_there(
    web: MapDef, rules: Ruleset, two_edges_are_planned: None
) -> None:
    plan = rules.orders.cost.planned_move
    bot = _rusher(web, rules)
    bot.decide(_view(web, rules, plan - 50), START)
    held = bot.hold
    assert held is not None
    later = bot.decide(_view(web, rules, plan, START + 20), START + 20)
    sent = [m for m in _moves(later) if m.planned and m.dest == held.dest]
    assert sent and sent[0].group == held.group
    assert bot.hold is None or bot.hold.dest != held.dest  # (a new hold may start for a next one)


def test_the_hold_is_bounded_and_not_repeated_at_once(
    web: MapDef, rules: Ruleset, two_edges_are_planned: None
) -> None:
    plan = rules.orders.cost.planned_move
    bot = _rusher(web, rules, wait=60)
    low = plan - 50
    bot.decide(_view(web, rules, low), START)
    first = bot.hold
    assert first is not None and first.until == START + 60
    mid = bot.decide(_view(web, rules, low, START + 30), START + 30)
    assert _moves(mid) == [] and bot.hold == first  # still held
    # It ran out: the ordinary order goes through, and the same target is not held again for
    # twice the wait.
    out = bot.decide(_view(web, rules, low, START + 60), START + 60)
    assert [m for m in _moves(out) if not m.planned]
    assert bot.hold is None or bot.hold.dest != first.dest


def test_a_bot_without_insight_does_not_hold(
    web: MapDef, rules: Ruleset, two_edges_are_planned: None
) -> None:
    bot = _rusher(web, rules, level="easy")
    bot.decide(_view(web, rules, rules.orders.cost.planned_move - 50), START)
    assert bot.hold is None


def test_the_hold_ends_when_the_group_is_gone(
    web: MapDef, rules: Ruleset, two_edges_are_planned: None
) -> None:
    plan = rules.orders.cost.planned_move
    bot = _rusher(web, rules)
    view = _view(web, rules, plan - 50)
    bot.decide(view, START)
    assert bot.hold is not None
    leader = bot.hold.group
    gone = dataclasses.replace(
        _view(web, rules, plan - 50, START + 10),
        groups=tuple(g for g in view.groups if g.id != leader),
    )
    bot.decide(gone, START + 10)
    assert bot.hold is None or bot.hold.group != leader


# (b) A strike at a lesser city ----------------------------------------------------------------


def _strike(mapdef: MapDef, target: int, tick: int = START) -> IntentView:
    return IntentView(5, 1, IntentKind.PLANNED_MOVE, mapdef.capital(1), target, tick)


def _target(mapdef: MapDef, view: PlayerView) -> int:
    """An own city that is not the capital."""
    home = mapdef.capital(0)
    return next(n.id for n in view.nodes if n.owner == 0 and n.id != home)


def test_a_strike_at_a_lesser_city_is_answered_when_it_is_worth_it(
    web: MapDef, rules: Ruleset
) -> None:
    view = _view(web, rules, 800)
    target = _target(web, view)
    seen = dataclasses.replace(view, intents=(_strike(web, target),))

    def modes(worth: int) -> list[SetMode]:
        bot = bot_factory("smart_rusher", {"worth_defense": ParamRange(worth, worth)})(
            web, rules, seed=0, player=0
        )
        return [c for c in bot.decide(seen, START) if isinstance(c, SetMode)]

    assert modes(0) == []  # off: respond 1 answers the capital only
    assert modes(web.nodes[target].vp + 1) == []  # the city is worth less than the threshold
    answered = modes(web.nodes[target].vp)
    assert [c.mode for c in answered] == [Mode.DEFENSE]


def test_a_strike_at_a_lesser_city_is_noticed_after_the_reaction_delay(
    web: MapDef, rules: Ruleset
) -> None:
    view = _view(web, rules, 800)
    target = _target(web, view)
    bot = bot_factory("smart_turtle@normal")(web, rules, seed=0, player=0)
    assert isinstance(bot, SmartBot) and bot.tempo.react_ticks == 15
    assert bot.params["worth_defense"] <= web.nodes[target].vp
    answers: dict[int, bool] = {}
    for tick in (START, START + 10, START + 20):
        bot.bucket.tokens = bot.bucket.cap  # the APM is not what is tested here
        seen = dataclasses.replace(
            _view(web, rules, 800, tick), intents=(_strike(web, target, START),)
        )
        answers[tick - START] = any(isinstance(c, SetMode) for c in bot.decide(seen, tick))
    # Shown at START, noticed `react` ticks later: the decisions at +0 and +10 are blind to it.
    assert answers == {0: False, 10: False, 20: True}


def test_every_personality_has_the_new_parameters() -> None:
    for cls in PERSONALITIES:
        assert "wait_plan" in cls.PARAMS and "worth_defense" in cls.PARAMS
        assert cls.PARAMS["wait_plan"].low >= 0
