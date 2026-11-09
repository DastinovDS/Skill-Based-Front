"""Capital defense and road fortifications of the smart bots under ``mvp-5`` (#682, G-F of the
``mvp-4`` bot audit; ``SmartBot`` item 22, ``gow_bots.bots.forts``).

Expected values come from the rules (mechanics.md, section 7, DEC-43 item D; DEC-25; DEC-22): the
map is ``dec41`` of the simulation tests, ``mvp-4``. Player 0 holds K = 0 (the capital, capacity
10, warehouse 6), A = 1, B, C, D = 2, 3, 4, E, F, G = 5, 6, 7; the passes 17 and 18 are player 1's.
Road 0 is K-A, road 5 is A-E, road 24 is South Pass (18) to D. A road fortification costs 1.5 CP
(``fort.cost``) and a recruit 1 CP; the CP sink of ``fort_site`` waits for 4 CP
(``cp.cap - cp.per_period``), so every case here stays below it. A recruit queue holds at most 3
(``recruit.queue_max``).

Every case is also played mirrored, by player 1 on the mirror nodes and roads (AGENTS.md,
section 4.1, item 6).
"""

from dataclasses import replace
from pathlib import Path

import pytest

from gow_bots.bots import BOTS, SmartBot, bot_factory
from gow_bots.bots.forts import cut_off
from gow_sim.commands import Command, FortifyRoad, Move, Recruit
from gow_sim.maps import load_map
from gow_sim.ruleset import load_ruleset
from gow_sim.state import AtNode, GameState, Group, Mode, initial_state
from gow_sim.systems.capacity import change_owner
from gow_sim.systems.flow import update_flow
from gow_sim.view import IntentKind, IntentView, PlayerView, RoadFortView, project

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))
MAP = load_map(ROOT / "packages" / "sim" / "tests" / "maps" / "dec41.json")
RULES = load_ruleset(ROOT / "rulesets" / "mvp-5.toml")
K, A, B, C, D, E, F, G = range(8)
SOUTH_PASS = 18
PASSES = (17, 18)
KA, AE, SD = 0, 5, 24
TICK = 4000
SMART = (
    "smart_exploiter",
    "smart_expander",
    "smart_reactive",
    "smart_rusher",
    "smart_strangler",
    "smart_turtle",
)


def _at(player: int, node: int) -> int:
    return MAP.node_key(player, node)


def _road(player: int, edge: int) -> int:
    return edge if player == 0 else MAP.mirror_edges[edge]


def _state(
    player: int, groups: list[tuple[int, int, int, int]], *, lost: tuple[int, ...] = ()
) -> GameState:
    """The base: the passes are the other player's, the nodes ``lost`` taken by it at ``TICK``,
    then the groups ``(owner, node, units, charged)`` (nodes of the table, mirrored for player
    1)."""
    state = initial_state(MAP, RULES)
    enemy = 1 - player
    for n in PASSES:
        state.nodes[_at(player, n)].owner = enemy
    state.tick = TICK
    for n in lost:
        change_owner(state, _at(player, n), enemy)
    for owner, node, units, charged in groups:
        gid = state.new_id()
        where = AtNode(_at(player, node))
        state.groups[gid] = Group(gid, owner, units, charged, Mode.ATTACK, where)
    update_flow(state, RULES)
    return state


def _view(state: GameState, player: int, cp: int) -> PlayerView:
    view = project(state, RULES, player, KEY)
    return replace(view, me=replace(view.me, cp=cp))


BLIND = "~blind"
"""A name suffix of ``_bot``: the bot without ``insight`` (no level has that since #749)."""


def _bot(name: str, player: int) -> SmartBot:
    blind = name.endswith(BLIND)
    bot = bot_factory(name.removesuffix(BLIND))(MAP, RULES, seed=0, player=player)
    assert isinstance(bot, SmartBot)
    if blind:
        bot.tempo = replace(bot.tempo, insight=False)
    return bot


def _forts(cmds: list[Command]) -> list[tuple[int, int]]:
    return [(c.node, c.edge) for c in cmds if isinstance(c, FortifyRoad)]


def _group_at(view: PlayerView, node: int) -> int:
    return next(g.id for g in view.groups if g.location == AtNode(node))


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", SMART)
def test_the_capital_fortifies_the_road_a_visible_force_comes_by(name: str, player: int) -> None:
    """#682, step 1: the enemy took A next to the capital and stands there with 4/4 (shown
    exactly: K is a vision source, plains to plains, DEC-21). It does not take a garrison of 6/6
    (the 2/2 the map starts with and 4/4 more: ``6 - 1 + 6 = 11`` shots, DEC-07; no alarm), but
    it is a force on road K-A: the capital fortifies that road with 3 CP, below the CP sink of
    ``fort_site``."""
    enemy = 1 - player
    state = _state(player, [(player, K, 4, 4), (player, E, 2, 0), (enemy, A, 4, 4)], lost=(A,))
    view = _view(state, player, 300)
    bot = _bot(name, player)
    cmds = bot.decide(view, TICK)
    assert not bot.alarm
    assert (_at(player, K), _road(player, KA)) in _forts(cmds)


def _alarm(player: int, walker: bool) -> PlayerView:
    """8/8 of the enemy in A with two planned strikes from A at the capital (DEC-08, public),
    4/4 in K (the 2/2 the map starts with and 2/2 more), road K-A fortified already, 3 CP; with
    ``walker`` a discharged 2/0 in E. 3/3 stand in B, in a pocket (row H1 of DEC-43, item H: A
    was its way to K)."""
    enemy = 1 - player
    groups = [(player, K, 2, 2), (player, B, 3, 3), (enemy, A, 8, 8)]
    if walker:
        groups.append((player, E, 2, 0))
    view = _view(_state(player, groups, lost=(A,)), player, 300)
    home, a, road = _at(player, K), _at(player, A), _road(player, KA)
    intents = tuple(
        IntentView(900 + i, enemy, IntentKind.PLANNED_MOVE, a, home, TICK - 5) for i in range(2)
    )
    edges = list(view.edges)
    edges[road] = replace(edges[road], forts=(RoadFortView(home, player, False, TICK + 50),))
    return replace(view, intents=intents, edges=tuple(edges))


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", SMART)
def test_the_alarm_walks_home_and_spends_the_rest_on_recruits(name: str, player: int) -> None:
    """#682, step 2 (the owner's match 6 under ``mvp-4``): 8 shots take a garrison of 4/4 on
    plains (``4 - 1 + 4 = 7``, DEC-07 rules 1 to 4): the alarm. The discharged 2/0 in E walks home
    (the capital warehouse has 6 charges for it, recharging 1 per tick) for 1 CP and the capital
    queues recruits with the other 2 CP (more than one unit per decision). The pocket group in B
    cannot reach the capital and stays."""
    view = _alarm(player, walker=True)
    home, road = _at(player, K), _road(player, KA)
    walker = _group_at(view, _at(player, E))
    pocket = _group_at(view, _at(player, B))
    bot = _bot(name, player)
    cmds = bot.decide(view, TICK)
    assert bot.alarm
    assert Move(walker, home) in cmds
    assert not any(isinstance(c, Move) and c.group == pocket for c in cmds)
    assert [c for c in cmds if isinstance(c, Recruit)] == [Recruit(home)] * 2
    assert (home, road) not in _forts(cmds)  # one per node and road (DEC-43, item D3)


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", SMART)
def test_the_alarm_fills_the_recruit_queue(name: str, player: int) -> None:
    """The same alarm with no group that can walk home: 3 CP fill the capital's queue to
    ``recruit.queue_max`` = 3 (DEC-25), within its capacity 10 (DEC-22)."""
    view = _alarm(player, walker=False)
    home = _at(player, K)
    cmds = _bot(name, player).decide(view, TICK)
    assert [c for c in cmds if isinstance(c, Recruit)] == [Recruit(home)] * 3


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", SMART)
def test_a_threatened_front_city_is_fortified_below_the_cp_cap(name: str, player: int) -> None:
    """G-F: 4/4 of the enemy in South Pass next to the own city D (2/2 there sees it exactly),
    3.5 CP: D fortifies road 24 though the CP are not near the cap (the sink of ``fort_site``
    waits for 4 CP). 4 shots take 2/2 on plains (``2 - 1 + 2 = 3``, DEC-07), so the line may
    decide the fight. At tick 4000 the bot has had 3 + 40 CP (``cp.start``, 1 CP per 100 ticks),
    so even the 5% of ``smart_rusher`` pays the 1.5 CP (``FORT_SHARE``)."""
    enemy = 1 - player
    state = _state(player, [(player, K, 2, 2), (player, D, 2, 2), (enemy, SOUTH_PASS, 4, 4)])
    view = _view(state, player, 350)
    cmds = _bot(name, player).decide(view, TICK)
    assert _forts(cmds) == [(_at(player, D), _road(player, SD))]


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", [*SMART, "smart_hoarder", f"smart_turtle@easy{BLIND}"])
def test_no_fortification_against_a_scout_by_the_benchmark_or_without_insight(
    name: str, player: int
) -> None:
    """A single enemy unit is a scout, not a force (``FORT_SHOTS``); the benchmark keeps no
    threat fortification; a bot without ``insight`` does not read the position (item 9)."""
    enemy = 1 - player
    scout = 1 if name in SMART else 4
    state = _state(
        player, [(player, K, 2, 2), (player, D, 2, 2), (enemy, SOUTH_PASS, scout, scout)]
    )
    view = _view(state, player, 350)
    assert _forts(_bot(name, player).decide(view, TICK)) == []


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", SMART)
def test_a_garrison_that_holds_the_force_is_not_fortified(name: str, player: int) -> None:
    """5/5 in D need ``5 - 1 + 5 = 9`` shots (DEC-07): the 4/4 next to it is more than
    ``FORT_MARGIN`` short, a line would not decide that fight."""
    enemy = 1 - player
    state = _state(player, [(player, K, 2, 2), (player, D, 5, 5), (enemy, SOUTH_PASS, 4, 4)])
    assert _forts(_bot(name, player).decide(_view(state, player, 350), TICK)) == []


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", SMART)
def test_the_cp_share_caps_the_threat_fortifications(name: str, player: int) -> None:
    """The threatened city of the G-F case, but the bot's fortifications have taken its
    ``FORT_SHARE`` of the 43 CP it has had already: no more (a budget, not a CP sink)."""
    enemy = 1 - player
    state = _state(player, [(player, K, 2, 2), (player, D, 2, 2), (enemy, SOUTH_PASS, 4, 4)])
    bot = _bot(name, player)
    bot.fort_cp = 43 * bot.FORT_SHARE  # hundredths: FORT_SHARE percent of 43 CP
    assert _forts(bot.decide(_view(state, player, 350), TICK)) == []


@pytest.mark.parametrize("player", [0, 1])
def test_a_chokepoint_cuts_off_what_lies_behind_it(player: int) -> None:
    """Row H1 of DEC-43, item H: A is the only way of B, C, D, F, G to K."""
    view = _view(_state(player, []), player, 0)
    bot = _bot("smart_turtle", player)
    home = _at(player, K)
    assert cut_off(view, bot.neighbors, home, _at(player, A)) == 5
    assert cut_off(view, bot.neighbors, home, _at(player, E)) == 0
    assert cut_off(view, bot.neighbors, home, home) == 0


def test_every_smart_personality_is_covered() -> None:
    assert sorted(n for n in BOTS if n.startswith("smart_") and "@" not in n) == sorted(
        [*SMART, "smart_hoarder"]
    )
