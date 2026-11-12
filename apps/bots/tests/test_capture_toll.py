"""The toll of a road fortification and the capture price in the attack planning (#760, #759).

Expected values come from the rules. A capture spends ``capture.charge_cost`` real charges of the
group in the node, with fewer it bounces (DEC-38); ``mvp-5`` has 0 (the cases under cost 0),
the played ``mvp-7`` has 1. A road fortification of node
``X`` takes ``min(charged, toll_charges * ceil(units / toll_units))`` charges from an enemy group
crossing its line point towards ``X`` (DEC-43, item D6; ``mvp-5``: 1 charge per started 3 units),
before the fight and the capture, an empty ``X`` too; a group moving away or past the line pays
nothing more. So under cost 1 a group of 1/1 or 3/1 that walks into an empty fortified node is left
discharged and bounces, 2/2 is left 2/1 and takes it; under cost 0 every one of them takes it.

The map is ``dec41`` of the simulation tests: player 0 holds Cedar 3 and Keep 0 (the capital);
North Pass 17 is a plains province next to Cedar (road 10) and to Dale East 12 (the enemy's), made
the enemy's here and fortified by the enemy on road 10. Every case is also played mirrored, by
player 1 on the mirror nodes and roads (AGENTS.md, section 4.1, item 6).
"""

from dataclasses import replace
from pathlib import Path

import pytest

from gow_bots.bots import SmartBot, bot_factory
from gow_bots.bots.campaign import CampaignBot, Ctx
from gow_sim.commands import CancelOrder, Command, Move, PlayerCommand
from gow_sim.maps import load_map
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.state import AtNode, GameState, Group, Mode, OnEdge, initial_state
from gow_sim.systems.capacity import change_owner
from gow_sim.systems.flow import update_flow
from gow_sim.view import GroupView, OrderView, PlayerView, project

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))
MAP = load_map(ROOT / "packages" / "sim" / "tests" / "maps" / "dec41.json")
MVP4 = load_ruleset(ROOT / "rulesets" / "mvp-5.toml")
"""Historical (``capture.charge_cost = 0``, #659): the free-capture path of ``takes`` is live code
as long as a kept ruleset has a free capture; the played ``mvp-7`` is ``CAP1``."""
CAP1 = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")
KEEP, ASH, CEDAR, MID = 0, 1, 3, 8
NORTH_PASS = 17
CEDAR_NORTH = 10
TICK = 1000
SMART = (
    "smart_exploiter",
    "smart_expander",
    "smart_hoarder",
    "smart_reactive",
    "smart_rusher",
    "smart_strangler",
    "smart_turtle",
)
ATTACKERS = (
    "smart_exploiter",
    "smart_expander",
    "smart_reactive",
    "smart_rusher",
    "smart_strangler",
)
"""The personalities with ``DISCIPLINE`` (#687) whose ``score`` takes North Pass from Cedar here
(the turtle keeps to its land, the hoarder to its build-up: they rank no such target)."""


def _at(player: int, node: int) -> int:
    return MAP.node_key(player, node)


def _road(player: int, edge: int) -> int:
    return edge if player == 0 else MAP.mirror_edges[edge]


def _bot(name: str, rules: Ruleset, player: int) -> CampaignBot:
    bot = bot_factory(name)(MAP, rules, seed=0, player=player)
    assert isinstance(bot, CampaignBot)
    return bot


def _state(
    rules: Ruleset,
    player: int,
    groups: list[tuple[int, int, int]],
    *,
    fort: bool = True,
    state: GameState | None = None,
) -> GameState:
    """North Pass the enemy's, empty, fortified by the enemy on the road from Cedar (built), no
    group of the start; ``groups``: own ``(node, units, charged)``."""
    state = initial_state(MAP, rules) if state is None else state
    state.groups.clear()
    state.tick = TICK
    north = _at(player, NORTH_PASS)
    state.nodes[north].owner = 1 - player
    if fort:
        state.nodes[north].road_forts[_road(player, CEDAR_NORTH)] = TICK - 1
    for node, units, charged in groups:
        gid = state.new_id()
        where = AtNode(_at(player, node))
        state.groups[gid] = Group(gid, player, units, charged, Mode.ATTACK, where)
    update_flow(state, rules)
    return state


def _view(rules: Ruleset, state: GameState, player: int) -> PlayerView:
    view = project(state, rules, player, KEY)
    north, road = _at(player, NORTH_PASS), _road(player, CEDAR_NORTH)
    seen = view.nodes[north].seen
    assert seen is not None and seen.tick == view.tick and not seen.enemy_modes  # seen empty
    built = [f.built for f in view.edges[road].forts if f.node == north]
    assert built == ([True] if state.nodes[north].road_forts else [])  # D8: the half is in sight
    return view


def _targets(bot: CampaignBot, view: PlayerView, groups: list[GroupView]) -> list[int]:
    ctx = Ctx(view, view.tick, view.me.cp, standing=bot.standing(view))
    return [o.dest for o in bot.options(ctx, groups)]


def _group_at(view: PlayerView, node: int) -> GroupView:
    return next(g for g in view.groups if g.location == AtNode(node))


# Planning -------------------------------------------------------------------------------------


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", ATTACKERS)
@pytest.mark.parametrize(
    ("units", "charged", "fort", "cost", "taken"),
    [
        (1, 1, True, 1, False),  # the toll takes the only charge: nothing pays the capture
        (3, 1, True, 1, False),  # ceil(3 / 3) = 1: the same
        (2, 2, True, 1, True),  # 2/1 after the line pays
        (1, 1, False, 1, True),  # no fortification: 1/1 pays
        (1, 1, True, 0, True),  # cost 0: the toll does not matter for an empty node
        (1, 0, True, 0, True),  # cost 0: a discharged group still takes it
    ],
)
def test_an_empty_fortified_target_needs_the_toll_and_the_price(
    name: str, player: int, units: int, charged: int, fort: bool, cost: int, taken: bool
) -> None:
    rules = CAP1 if cost else MVP4
    state = _state(rules, player, [(CEDAR, units, charged)], fort=fort)
    view = _view(rules, state, player)
    bot = _bot(name, rules, player)
    group = _group_at(view, _at(player, CEDAR))
    assert bot.toll_from(view, _at(player, CEDAR), _at(player, NORTH_PASS), units, charged) == (
        min(charged, 1) if fort else 0
    )
    assert (_at(player, NORTH_PASS) in _targets(bot, view, [group])) is taken


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", ATTACKERS)
def test_the_toll_is_read_on_the_road_the_move_takes(name: str, player: int) -> None:
    """Mid 8 the enemy's and empty, fortified on road 8 from Cedar only; South Hill 20 own, its
    road 25 into Mid free. A ``Move`` takes the fastest path (``find_path``): from Cedar road 8
    (the toll eats the 1/1's charge, it cannot pay under cost 1), from South Hill road 25 (no
    toll). The rule "every road in fortified" of ``toll_for`` sees a free road and counts 0 for
    both: the 1/1 in Cedar was sent and recalled (#759)."""
    state = initial_state(MAP, CAP1)
    state.groups.clear()
    state.tick = TICK
    mid, hill, cedar = _at(player, MID), _at(player, 20), _at(player, CEDAR)
    state.nodes[mid].owner = 1 - player
    state.nodes[hill].owner = player
    state.nodes[mid].road_forts[_road(player, 8)] = TICK - 1
    for node in (cedar, hill):
        gid = state.new_id()
        state.groups[gid] = Group(gid, player, 1, 1, Mode.ATTACK, AtNode(node))
    update_flow(state, CAP1)
    view = project(state, CAP1, player, KEY)
    assert [f.built for f in view.edges[_road(player, 8)].forts] == [True]
    bot = _bot(name, CAP1, player)
    assert bot.toll_for(view, mid, 1, 1) == 0
    assert bot.toll_from(view, cedar, mid, 1, 1) == 1
    assert bot.toll_from(view, hill, mid, 1, 1) == 0
    assert mid not in _targets(bot, view, [_group_at(view, cedar)])
    assert mid in _targets(bot, view, [_group_at(view, hill)])


# The recall and its loop ------------------------------------------------------------------------


def _walker(player: int, units: int, charged: int, progress: int) -> GroupView:
    """An own group on road 10 from Cedar towards North Pass (an ordinary order), ``progress``
    thousandths from Cedar; the line point of North Pass is the border point, 500."""
    cedar, north = _at(player, CEDAR), _at(player, NORTH_PASS)
    order = OrderView(dest=north, path=(north,), planned=False, depart_tick=TICK - 10)
    where = OnEdge(_road(player, CEDAR_NORTH), cedar, progress)
    return GroupView(9999, units, charged, Mode.ATTACK, where, order)


def _recall(
    bot: CampaignBot, rules: Ruleset, player: int, walker: GroupView
) -> tuple[list[Command], PlayerView]:
    state = _state(rules, player, [(CEDAR, 1, 1)])  # the eyes on North Pass
    view = _view(rules, state, player)
    view = replace(view, groups=(*view.groups, walker))
    ctx = Ctx(view, view.tick, view.me.cp, standing=bot.standing(view))
    bot._recall(ctx)  # pyright: ignore[reportPrivateUsage]
    return ctx.cmds, view


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", ATTACKERS)
def test_a_recall_for_the_toll_is_not_reissued_with_the_same_shortfall(
    name: str, player: int
) -> None:
    """1/1 short of the line under cost 1 would arrive discharged and bounce: it is turned back,
    and in the next decision neither it (standing in Cedar again) nor another 1/1 goes there
    (#760: the old hold let a 1-charge group through, the recall saw 0 shots); a 2/2 still may."""
    bot = _bot(name, CAP1, player)
    cmds, view = _recall(bot, CAP1, player, _walker(player, 1, 1, 300))
    assert CancelOrder(9999) in cmds
    north = _at(player, NORTH_PASS)
    assert north in bot.recalled
    one = _group_at(view, _at(player, CEDAR))
    assert north not in _targets(bot, view, [one])
    two = replace(one, units=2, charged=2)
    assert north in _targets(bot, view, [two])


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", ATTACKERS)
def test_no_recall_past_the_line(name: str, player: int) -> None:
    """Past the line point the toll is paid: the 1/1 left takes the empty node and pays its 1."""
    bot = _bot(name, CAP1, player)
    cmds, _ = _recall(bot, CAP1, player, _walker(player, 1, 1, 600))
    assert CancelOrder(9999) not in cmds


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", ATTACKERS)
def test_no_recall_under_cost_0(name: str, player: int) -> None:
    """Cost 0: the 1/1 arrives 1/0 and takes the empty node for free."""
    bot = _bot(name, MVP4, player)
    cmds, _ = _recall(bot, MVP4, player, _walker(player, 1, 1, 300))
    assert CancelOrder(9999) not in cmds


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", ["smart_rusher", "smart_exploiter", "smart_reactive@hard"])
def test_no_send_and_recall_loop_in_play(name: str, player: int) -> None:
    """200 ticks of play under cost 1 from a 1/1 in Cedar next to the empty fortified North
    Pass, its only target (Mid is own here): no group whose charges the toll leaves below the
    price is sent there, and nothing is cancelled (the loop of #759 sent, recalled and sent
    again)."""
    match = Match(MAP, CAP1, KEY)
    state = _state(CAP1, player, [(CEDAR, 1, 1)], state=match.state)
    state.nodes[_at(player, MID)].owner = player
    for p in state.players.values():
        p.cp = 500
    update_flow(state, CAP1)
    bot = bot_factory(name)(MAP, CAP1, seed=0, player=player)
    north, seq = _at(player, NORTH_PASS), 0
    fort = CAP1.fort
    assert fort is not None
    for _ in range(200):
        cmds: list[PlayerCommand] = []
        if match.tick % 5 == 0:
            view = match.view(player)
            groups = {g.id: g for g in view.groups}
            for cmd in bot.decide(view, match.tick):
                assert not isinstance(cmd, CancelOrder)
                if isinstance(cmd, Move) and cmd.dest == north:
                    g = groups[cmd.group]
                    assert g.charged - fort.toll(g.units, g.charged) >= 1
                cmds.append(PlayerCommand(player, seq, match.resolve(player, cmd)))
                seq += 1
        match.step(cmds)


# Pocket exits -----------------------------------------------------------------------------------

PASSES = (17, 18)


def _pocket(rules: Ruleset, player: int, units: int, charged: int, *, fort: bool) -> GameState:
    """The pocket of ``test_smart_pockets``: player 1 took Ash, so the own province Mid (own here,
    joined to the pocket through Cedar) holds a group of ``units`` / ``charged`` with no way to
    the capital but the empty Ash; ``fort``: Ash fortified on every road (the enemy's lines)."""
    state = initial_state(MAP, rules)
    enemy = 1 - player
    for n in PASSES:
        state.nodes[_at(player, n)].owner = enemy
    state.nodes[_at(player, MID)].owner = player
    state.tick = TICK
    ash = _at(player, ASH)
    change_owner(state, ash, enemy)
    if fort:
        for e in MAP.incident[ash]:
            state.nodes[ash].road_forts[e] = TICK - 1
    gid = state.new_id()
    state.groups[gid] = Group(gid, player, units, charged, Mode.ATTACK, AtNode(_at(player, MID)))
    update_flow(state, rules)
    return state


def _pocket_moves(name: str, rules: Ruleset, player: int, state: GameState) -> list[int]:
    bot = bot_factory(name)(MAP, rules, seed=0, player=player)
    assert isinstance(bot, SmartBot)
    view = project(state, rules, player, KEY)
    assert view.nodes[_at(player, MID)].flow_pocket is True
    group = _group_at(view, _at(player, MID)).id
    for i in range(2):  # within two decisions of the level (``Tempo.think_ticks`` apart)
        sent = [
            c.dest
            for c in bot.decide(view, TICK + i * bot.tempo.think_ticks)
            if isinstance(c, Move) and c.group == group
        ]
        if sent:
            return sent
    return []


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", [n for n in SMART if n != "smart_exploiter"])
def test_a_discharged_pocket_group_waits_under_cost_1(name: str, player: int) -> None:
    """3/0 in the pocket under cost 1 cannot pay the capture of Ash: it stays (a walk out
    would bounce and be sent again, #759) instead of the free walk of ``mvp-5``."""
    state = _pocket(CAP1, player, 3, 0, fort=False)
    assert _pocket_moves(name, CAP1, player, state) == []


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", [n for n in SMART if n != "smart_exploiter"])
def test_a_discharged_pocket_group_walks_out_under_cost_0_through_a_fortified_cut(
    name: str, player: int
) -> None:
    """Cost 0: the toll takes nothing from 3/0 and the capture is free, so the fortified Ash
    changes nothing (the walk of ``test_smart_pockets``)."""
    state = _pocket(MVP4, player, 3, 0, fort=True)
    assert _pocket_moves(name, MVP4, player, state) == [_at(player, ASH)]
