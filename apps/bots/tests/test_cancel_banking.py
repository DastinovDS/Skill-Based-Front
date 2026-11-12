"""Cancel discipline and CP banking of the smart bots under ``mvp-7`` (#687; ``SmartBot`` item 23).

The withdrawal from a fight exists only under ``combat.retreat = "round"`` (DEC-24, item E); those
two cases run on the historical ruleset ``mvp-5`` and a third checks that ``mvp-7`` has none.

Expected values come from the rules. A cancel refunds nothing (``orders.cost.cancel = 0``, DEC-20,
C: the order's CP stay spent). A fight (DEC-07, rules 1 to 4): the defenders' pool ``Qd`` is their
charges plus the terrain (plains -1, only with a firing charge), ``min(Qa, Qd)`` charges cancel on
both sides and the surplus of the stronger side kills one unit each; an attacker that does not take
the node bounces. So an attack with ``Qa >= Qd`` loses no unit (example 8 of the table: 2 charged
against 2 charged on plains, ``Qd = 1``, a defender dies, the attack bounces) and only ``Qd > Qa``
costs the attacker units. A road fortification costs 1.5 CP (``fort.cost``), the CP cap is 5 CP and
a quantum 1 CP per 100 ticks (DEC-02: CP over the cap burn).

The map is ``dec41`` of the simulation tests: player 0 holds Keep 0 (the capital), Ash 1, Birch 2,
Cedar 3, Dale 4 (medium), Elm 5, Fern 6, Glen 7; North Pass 17 and South Pass 18 are plains
provinces next to Cedar and Dale; road 24 is South Pass to Dale. Every case is also played
mirrored, by player 1 on the mirror nodes and roads (AGENTS.md, section 4.1, item 6).
"""

from dataclasses import replace
from pathlib import Path

import pytest

from gow_bots.bots import BOTS, SmartBot, bot_factory
from gow_bots.bots.campaign import RECALL_TICKS, CampaignBot, Ctx
from gow_bots.bots.smart import BANK_TICKS
from gow_sim.commands import CancelOrder, Command, FortifyRoad
from gow_sim.maps import load_map
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.state import AtNode, Detail, GameState, Group, Mode, OnEdge, Sighting, initial_state
from gow_sim.systems.flow import update_flow
from gow_sim.view import FightView, GroupView, OrderView, PlayerView, project

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))
MAP = load_map(ROOT / "packages" / "sim" / "tests" / "maps" / "dec41.json")
RULES = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")
MVP5 = load_ruleset(ROOT / "rulesets" / "mvp-5.toml")
"""Historical (``retreat = "round"``): the only ruleset left with a withdrawal from a fight."""
KEEP, CEDAR, DALE = 0, 3, 4
NORTH_PASS, SOUTH_PASS = 17, 18
SOUTH_DALE = 24
TICK = 5000
SMART = (
    "smart_exploiter",
    "smart_expander",
    "smart_reactive",
    "smart_rusher",
    "smart_strangler",
    "smart_turtle",
)
"""The personalities with ``DISCIPLINE``; ``smart_hoarder`` is the benchmark."""
SAVERS = ("smart_exploiter", "smart_expander", "smart_reactive", "smart_rusher", "smart_turtle")
"""The personalities with a ``BANK`` (the strangler keeps its steady siege pressure)."""
OLD = ("smart_hoarder", "rusher")
"""The benchmark and a plain BOT-03 bot keep the old recall and save nothing."""


def _at(player: int, node: int) -> int:
    """``node`` of the table for ``player``: the mirror node for player 1."""
    return MAP.node_key(player, node)


def _road(player: int, edge: int) -> int:
    return edge if player == 0 else MAP.mirror_edges[edge]


def _edge(a: int, b: int) -> int:
    return next(e for e in MAP.incident[a] if MAP.edges[e].other(a) == b)


def _bot(name: str, player: int, rules: Ruleset = RULES) -> CampaignBot:
    bot = bot_factory(name)(MAP, rules, seed=0, player=player)
    assert isinstance(bot, CampaignBot)
    return bot


def _smart(name: str, player: int) -> SmartBot:
    bot = _bot(name, player)
    assert isinstance(bot, SmartBot)
    return bot


def _ctx(bot: CampaignBot, view: PlayerView) -> Ctx:
    return Ctx(view, view.tick, view.me.cp, standing=bot.standing(view))


# Cancel discipline ------------------------------------------------------------------------------


def _walk_view(player: int) -> PlayerView:
    """3/3 own units in Cedar, nothing else of the start."""
    state = initial_state(MAP, RULES)
    state.groups.clear()
    state.tick = TICK
    gid = state.new_id()
    state.groups[gid] = Group(gid, player, 3, 3, Mode.ATTACK, AtNode(_at(player, CEDAR)))
    update_flow(state, RULES)
    return project(state, RULES, player, KEY)


def _walker(player: int) -> GroupView:
    """A 2/2 group on its way from Cedar to North Pass (an ordinary order)."""
    cedar, north = _at(player, CEDAR), _at(player, NORTH_PASS)
    order = OrderView(dest=north, path=(north,), planned=False, depart_tick=TICK - 10)
    return GroupView(9999, 2, 2, Mode.ATTACK, OnEdge(_edge(cedar, north), cedar, 300), order)


def _enemy_in(view: PlayerView, node: int, units: int, charged: int) -> PlayerView:
    """``node`` owned by the enemy, seen exactly this tick with ``units`` / ``charged``."""
    nodes = list(view.nodes)
    seen = Sighting(view.tick, Detail.EXACT, (Mode.ATTACK,), units, charged)
    nodes[node] = replace(nodes[node], owner=1 - view.player, detail=Detail.EXACT, seen=seen)
    return replace(view, nodes=tuple(nodes))


def _recall(name: str, player: int, units: int, charged: int) -> list[Command]:
    view = _walk_view(player)
    view = replace(view, groups=(*view.groups, _walker(player)))
    view = _enemy_in(view, _at(player, NORTH_PASS), units, charged)
    bot = _bot(name, player)
    ctx = _ctx(bot, view)
    bot._recall(ctx)  # pyright: ignore[reportPrivateUsage]
    return ctx.cmds


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", [*SMART, *OLD])
def test_no_cancel_for_an_attack_that_would_only_bounce(name: str, player: int) -> None:
    """2/2 against 3/3 on plains: ``Qd = 3 - 1 = 2 <= Qa = 2``, so no unit of the walker dies
    (2 charges cancel on each side, no surplus) and it bounces: a cancel would only waste the
    order's CP and a command. 5 shots take the node, so the old recall (any attack that does not
    take it) still cancels."""
    cancelled = CancelOrder(9999) in _recall(name, player, 3, 3)
    assert cancelled is (name in OLD)


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", [*SMART, *OLD])
def test_a_cancel_for_an_attack_that_would_lose_units(name: str, player: int) -> None:
    """2/2 against 4/4 on plains: ``Qd = 3 > Qa = 2``, the surplus kills a unit of the walker:
    the cancel saves it, every bot turns back."""
    assert CancelOrder(9999) in _recall(name, player, 4, 4)


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", SMART)
def test_a_recall_remembers_the_shots_it_saw(name: str, player: int) -> None:
    """The recall from 4/4 on plains saw ``shots_to_take = 3 + 4 = 7`` (DEC-07, rule 4)."""
    view = _walk_view(player)
    view = replace(view, groups=(*view.groups, _walker(player)))
    north = _at(player, NORTH_PASS)
    view = _enemy_in(view, north, 4, 4)
    bot = _bot(name, player)
    ctx = _ctx(bot, view)
    bot._recall(ctx)  # pyright: ignore[reportPrivateUsage]
    assert bot.recalled == {north: (TICK, 7)}


def _targets(bot: CampaignBot, view: PlayerView, tick: int) -> list[int]:
    ctx = Ctx(view, tick, view.me.cp, standing=bot.standing(view))
    return [o.dest for o in bot.options(ctx, list(view.groups))]


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", SMART)
def test_a_recalled_target_waits_for_more_shots(name: str, player: int) -> None:
    """The best target of the 3/3 in Cedar is empty (seen without enemies: nothing to take,
    DEC-07 example 5), but a recall from it saw 4 shots take it ``RECALL_TICKS`` ago at most: the
    group does not go there until the hold is over (no cancel and reissue loop on one target)."""
    view = _walk_view(player)
    bot = _bot(name, player)
    dest = _targets(bot, view, TICK)[0]
    bot.recalled[dest] = (TICK, 4)
    assert dest not in _targets(bot, view, TICK)
    assert dest not in _targets(bot, view, TICK + RECALL_TICKS - 1)
    assert dest in _targets(bot, view, TICK + RECALL_TICKS)
    assert dest not in bot.recalled


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", SMART)
def test_a_recalled_target_takes_a_group_that_beats_what_was_seen(name: str, player: int) -> None:
    """The hold lets through a group whose 3 charges reach the shots the recall saw plus the
    capture price (1 charge under ``mvp-7``, DEC-38)."""
    view = _walk_view(player)
    bot = _bot(name, player)
    dest = _targets(bot, view, TICK)[0]
    bot.recalled[dest] = (TICK, 3 - RULES.capture.charge_cost)
    assert dest in _targets(bot, view, TICK)


def _fight(player: int, enemy_charged: int, mute: int) -> tuple[PlayerView, GroupView]:
    """An own 2/2 attacker standing in North Pass (plains) in a fight with the enemy holder of
    ``enemy_charged`` charged units, ``mute`` of them silent by the plains (DEC-24, item F2)."""
    north = _at(player, NORTH_PASS)
    view = _walk_view(player)
    order = OrderView(dest=north, path=(north,), planned=False, depart_tick=TICK - 50)
    attacker = GroupView(9999, 2, 2, Mode.ATTACK, AtNode(north), order)
    view = _enemy_in(replace(view, groups=(*view.groups, attacker)), north, enemy_charged, 1)
    silent = (0, mute) if player == 0 else (mute, 0)
    fight = FightView(
        id=1,
        node=north,
        edge=None,
        point=None,
        attacker=player,
        start_tick=TICK - 20,
        next_round_tick=TICK + 10,
        groups=(attacker.id,),
        enemy_units=enemy_charged,
        enemy_charged=enemy_charged,
        shots=(0, 0),
        losses=(0, 0),
        virtual_left=(0, 0),
        mute=silent,
        last_round=None,
    )
    return replace(view, fights=(fight,)), attacker


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", [*SMART, *OLD])
def test_an_attacker_stays_in_a_fight_the_silent_charge_evens(name: str, player: int) -> None:
    """3 charged holders on plains, one of them silent: 2 shots against the attacker's 2, so it
    loses no unit and stays (the old play counts the silent charge and leaves)."""
    view, attacker = _fight(player, 3, 1)
    cmds = _bot(name, player, MVP5).fight_commands(view, TICK, view.me.cp)
    assert (CancelOrder(attacker.id) in cmds) is (name in OLD)


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", [*SMART, *OLD])
def test_an_attacker_leaves_a_fight_it_loses(name: str, player: int) -> None:
    """4 charged holders, one silent: 3 shots against 2, every round costs a unit: it leaves."""
    view, attacker = _fight(player, 4, 1)
    cmds = _bot(name, player, MVP5).fight_commands(view, TICK, view.me.cp)
    assert CancelOrder(attacker.id) in cmds


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", [*SMART, *OLD])
def test_no_attacker_leaves_a_fight_under_no_retreat(name: str, player: int) -> None:
    """``mvp-7`` (``combat.retreat = "none"``, DEC-40): even the lost fight of the case above has
    no withdrawal."""
    view, _ = _fight(player, 4, 1)
    assert _bot(name, player).fight_commands(view, TICK, view.me.cp) == []


# CP banking ------------------------------------------------------------------------------------


def _threat(player: int, tick: int = TICK) -> GameState:
    """The G-F case of ``test_smart_forts``: 2/2 in Keep and in Dale, the enemy's 4/4 in South
    Pass next to Dale (4 shots take 2/2 on plains, ``2 - 1 + 2 = 3``: a line may decide it)."""
    state = initial_state(MAP, RULES)
    enemy = 1 - player
    for n in (NORTH_PASS, SOUTH_PASS):
        state.nodes[_at(player, n)].owner = enemy
    state.tick = tick
    for owner, node, units, charged in (
        (player, KEEP, 2, 2),
        (player, DALE, 2, 2),
        (enemy, SOUTH_PASS, 4, 4),
    ):
        gid = state.new_id()
        state.groups[gid] = Group(
            gid, owner, units, charged, Mode.ATTACK, AtNode(_at(player, node))
        )
    update_flow(state, RULES)
    return state


def _view(state: GameState, player: int, cp: int) -> PlayerView:
    view = project(state, RULES, player, KEY)
    return replace(view, me=replace(view.me, cp=cp))


def _forts(cmds: list[Command]) -> list[tuple[int, int]]:
    return [(c.node, c.edge) for c in cmds if isinstance(c, FortifyRoad)]


def _price(bot: SmartBot) -> int:
    """A fortification and the CP it leaves (``FORT_KEEP``), in hundredths."""
    fort = RULES.fort
    assert fort is not None
    return fort.cost + bot.FORT_KEEP


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", SAVERS)
def test_a_decided_fortification_is_saved_for_then_paid(name: str, player: int) -> None:
    """One quantum short of the fortification and its keep: no fortification, and the routine
    spending of the decision leaves the saving. Then a quantum a decision: the CP the decisions
    leave grow to the price (and the drawn ``reserve``) and the line is bought before the CP
    reach the cap less a quantum, where they would start to burn (DEC-02)."""
    bot = _smart(name, player)
    price = _price(bot)
    q = RULES.cp.per_period
    cp = price - q
    view = _view(_threat(player), player, cp)
    save = bot.saving(_ctx(bot, view))
    assert save == min(price, bot.BANK, RULES.cp.cap - 2 * q) > 0
    cmds = bot.decide(view, TICK)
    assert _forts(cmds) == []
    assert sum(bot.cost(c) for c in cmds) <= max(0, cp - save)
    bought: list[tuple[int, int]] = []
    for k in range(1, 4):
        cp += q - sum(bot.cost(c) for c in cmds)
        assert cp < RULES.cp.cap - q or bought
        tick = TICK + k * RULES.stances.cp_period_ticks.balance
        cmds = bot.decide(_view(_threat(player, tick), player, cp), tick)
        bought = _forts(cmds)
        if bought:
            break
    assert bought == [(_at(player, DALE), _road(player, SOUTH_DALE))]


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", SAVERS)
def test_the_saving_opens_one_quantum_below_the_cap(name: str, player: int) -> None:
    """At 4 CP the next quantum would reach the cap of 5 and the one after it burn (DEC-02):
    nothing is saved, whatever the goal."""
    bot = _smart(name, player)
    cp = RULES.cp.cap - RULES.cp.per_period
    view = _view(_threat(player), player, cp)
    assert bot.saving(_ctx(bot, view)) == 0
    assert bot.saving(_ctx(bot, _view(_threat(player), player, cp - 1))) > 0


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", SAVERS)
def test_a_goal_left_unpaid_stops_the_saving(name: str, player: int) -> None:
    """A goal saved for more than ``BANK_TICKS`` without being paid stops the saving for
    ``BANK_TICKS`` (the CP go back to the routine spending)."""
    bot = _smart(name, player)
    view = _view(_threat(player), player, 100)
    assert bot.saving(Ctx(view, TICK, 100, standing=bot.standing(view))) > 0
    end = TICK + BANK_TICKS
    assert bot.saving(Ctx(view, end, 100, standing=bot.standing(view))) > 0
    assert bot.saving(Ctx(view, end + 5, 100, standing=bot.standing(view))) == 0
    assert bot.bank_rest == end + 5 + BANK_TICKS
    assert bot.saving(Ctx(view, end + 5 + BANK_TICKS, 100, standing=bot.standing(view))) > 0


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", ["smart_hoarder", "smart_strangler"])
def test_no_saving_without_a_bank(name: str, player: int) -> None:
    """The benchmark (also with the old recall) and the strangler save nothing, goal or not."""
    bot = _smart(name, player)
    assert bot.BANK == 0
    assert bot.DISCIPLINE is (name != "smart_hoarder")
    view = _view(_threat(player), player, 100)
    assert bot.saving(_ctx(bot, view)) == 0


def test_every_smart_personality_is_covered() -> None:
    assert sorted(n for n in BOTS if n.startswith("smart_") and "@" not in n) == sorted(
        [*SMART, "smart_hoarder"]
    )
    for name in SMART:
        bot = _smart(name, 0)
        assert bot.DISCIPLINE
        limit = RULES.cp.cap - 2 * RULES.cp.per_period
        assert (0 < bot.BANK <= limit) is (name in SAVERS)
