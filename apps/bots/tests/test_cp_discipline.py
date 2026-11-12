"""CP discipline of the slow levels (#1015, step 2 of the bot plan; ``SmartBot`` item 26).

Expected values come from ``rulesets/mvp-7.toml`` and DEC-43, item D: a road fortification costs
``fort.cost`` = 1.5 CP, a recruit ``orders.cost.recruit`` = 1 CP, a split ``orders.cost.split`` =
0 and a stance change ``orders.cost.stance`` = 0 (DEC-20, DEC-44); the CP cap is 5 CP and the
quantum 0.5 CP, so the sink of ``economy.fort_site`` waits for 4.5 CP.

- The APM bucket (``gow_bots.bots.tempo``) pays only the commands with a CP price: a free
  command needs a ready bucket and takes nothing from it.
- The CP sink of road fortifications comes last in the decision, only spends the CP the
  decision leaves near the cap and shares the ``FORT_SHARE`` budget of the threat
  fortifications: the attacks and recruits of a slow level come first.
"""

from dataclasses import replace
from fractions import Fraction
from pathlib import Path

import pytest

from gow_bots.bots import SmartRusher, SmartTurtle
from gow_bots.bots.campaign import Ctx
from gow_sim.commands import (
    Command,
    FortifyRoad,
    Move,
    Recruit,
    SetStance,
    Split,
    command_cost,
)
from gow_sim.maps import MapDef, load_map
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset, Stance, load_ruleset
from gow_sim.state import Detail, Mode, Sighting
from gow_sim.view import PlayerView

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))
RULES = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")
CROSSROADS = load_map(ROOT / "maps" / "crossroads.json")


def test_mvp7_prices_of_the_commands() -> None:
    """The prices the bucket reads: a split, a merge, a cancel and a stance change are free."""
    assert command_cost(RULES, Split(0, 1)) == 0
    assert command_cost(RULES, SetStance(Stance.WAR)) == 0
    assert command_cost(RULES, Recruit(0)) == 100
    assert command_cost(RULES, FortifyRoad(0, 0)) == 150
    assert (RULES.cp.cap, RULES.cp.per_period) == (500, 50)


def _front(rules: Ruleset, mapdef: MapDef, player: int) -> tuple[PlayerView, int, int, int]:
    """``player``'s view at the CP cap with an own node next to a node made the enemy's, where
    3/3 of the enemy are in sight; returns the view, the own node, the enemy node and the road."""
    match = Match(mapdef, rules, KEY)
    state = match.state
    probe = SmartRusher(mapdef, rules, seed=1, player=player)
    near, enemy = next(
        (n, m)
        for n in sorted(range(len(mapdef.nodes)), key=probe.key)
        if state.nodes[n].owner == player
        for m in sorted(probe.neighbors[n], key=probe.key)
        if state.nodes[m].owner is None
    )
    state.nodes[enemy].owner = 1 - player
    match.step()
    road = next(e for e in mapdef.incident[near] if mapdef.edges[e].other(near) == enemy)
    view = match.view(player)
    nodes = list(view.nodes)
    sighting = Sighting(view.tick, Detail.EXACT, (Mode.ATTACK,), 3, 3)
    nodes[enemy] = replace(nodes[enemy], detail=Detail.EXACT, seen=sighting)
    view = replace(view, nodes=tuple(nodes), me=replace(view.me, cp=rules.cp.cap))
    return view, near, enemy, road


@pytest.mark.parametrize("player", [0, 1])
def test_a_free_command_needs_a_ready_bucket_and_takes_nothing(player: int) -> None:
    view, *_ = _front(RULES, CROSSROADS, player)
    bot = SmartRusher(CROSSROADS, RULES, seed=1, player=player, difficulty="easy")
    home = bot.home
    group = next(g for g in view.groups if g.units >= 2)
    bucket = bot.bucket
    bucket.tokens = bucket.per  # one command to pay with
    ctx = Ctx(view, view.tick, view.me.cp)
    assert bot.spend(ctx, Split(group.id, 1))
    assert bucket.tokens == bucket.per  # free: the bucket keeps its command
    assert bot.spend(ctx, Recruit(home))
    assert bucket.tokens == 0  # 1 CP: the command is paid
    assert not bot.spend(ctx, Recruit(home))  # an empty bucket pays no more
    assert not bot.spend(ctx, Split(group.id, 1))  # and sends no free command either
    assert ctx.cmds == [Split(group.id, 1), Recruit(home)]


@pytest.mark.parametrize("player", [0, 1])
def test_the_fort_sink_spends_only_the_cp_the_decision_leaves_near_the_cap(player: int) -> None:
    """The sink shares the fortification budget of item 22: ``smart_rusher`` puts at most 5% of
    the CP it has had into them (``FORT_SHARE``), counted as ``cp.start`` plus 0.5 CP per 50 ticks
    (the Balance income): 1.5 CP fit from tick 2700 (30 CP had), a second line from 5700."""
    view, near, _, road = _front(RULES, CROSSROADS, player)

    def sink(tick: int, spent: int = 0) -> tuple[SmartRusher, list[Command]]:
        bot = SmartRusher(CROSSROADS, RULES, seed=1, player=player)
        ctx = Ctx(view, tick, view.me.cp - bot.params["reserve"] - spent)
        bot.fort_sink(ctx)
        return bot, ctx.cmds

    bot, cmds = sink(2700)
    assert cmds == [FortifyRoad(near, road)]  # 5 CP left: 1.5 CP into the line
    assert bot.fort_cp == 150
    again = Ctx(view, 5650, view.me.cp - bot.params["reserve"])
    bot.fort_sink(again)
    assert again.cmds == []  # 3 CP of 59 CP had: the second line waits for tick 5700
    assert sink(2650)[1] == []  # 1.5 CP is above 5% of the 29.5 CP had
    assert sink(2700, RULES.orders.cost.move)[1] == []  # an attack left 4 CP: below 4.5


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("cls", [SmartRusher, SmartTurtle])
@pytest.mark.parametrize("level", ["easy", "normal", "hard"])
def test_a_decision_at_the_cap_pays_orders_not_the_fort_sink(
    cls: type[SmartRusher] | type[SmartTurtle], level: str, player: int
) -> None:
    """At the cap (5 CP), with an enemy in sight next to an own node and the opening's targets in
    reach: the hands of a slow level go to orders (as many as its burst; the stance change and
    the split are free), and the orders leave the CP below 4.5, so no sink fortification. Before
    #1015 the sink came first and took 1.5 CP and a command."""
    view, *_ = _front(RULES, CROSSROADS, player)
    bot = cls(CROSSROADS, RULES, seed=1, player=player, difficulty=level)
    cmds = bot.decide(view, view.tick)
    moves = [c for c in cmds if isinstance(c, Move)]
    assert not any(isinstance(c, FortifyRoad) for c in cmds)
    if level != "hard":
        assert len(moves) == bot.tempo.burst
    else:
        assert len(moves) >= 2


@pytest.mark.parametrize("map_name", ["crossroads", "narrows"])
def test_the_fortification_budget_counts_the_income_of_the_stance_in_force(map_name: str) -> None:
    """The CP had (``SmartBot.cp_had``) follow the stance: 0.5 CP per period of the stance in force
    (DEC-44), the periods of the match after the map tempo (DEC-46, ``Bot.rules``). Before #1015
    the budget counted the Balance period whatever the stance."""
    mapdef = load_map(ROOT / "maps" / f"{map_name}.json")
    bot = SmartRusher(mapdef, RULES, seed=1, player=0)
    periods = bot.rules.stances.cp_period_ticks
    quantum = Fraction(RULES.cp.per_period)
    bot.note_income(0, Stance.BALANCE)
    bot.note_income(1000, Stance.WAR)
    bot.note_income(3000, Stance.ECONOMY)
    exact = (
        1000 * quantum / periods.balance
        + 2000 * quantum / periods.war
        + 1500 * quantum / periods.economy
    )
    assert bot.cp_had(4500) == RULES.cp.start + int(exact)  # rounded down
    balance_only = SmartRusher(mapdef, RULES, seed=1, player=0)
    assert balance_only.cp_had(4500) == RULES.cp.start + int(4500 * quantum / periods.balance)
    war = SmartRusher(mapdef, RULES, seed=1, player=0)
    war.note_income(0, Stance.WAR)
    assert war.cp_had(4500) > balance_only.cp_had(4500) > bot.cp_had(4500)
