"""Capacity-aware moves (#686) and the hold of the leaf shift (G-L of the ``mvp-4`` bot audit).

Expected values come from the rules: a node holds ``capacity.by_kind[kind]`` own units (DEC-22,
item 1; ``mvp-4``: capital 10, large city 8, medium 6, small 4, province 3), and units standing
above it die one every ``capacity.attrition_ticks`` (DEC-12); a cancel on an edge turns the group
back to the start of the edge (DEC-20); a group on an edge takes no new order (``GROUP_ON_EDGE``).
The map is ``dec41`` of the simulation tests: player 0 holds Keep 0 (capital), Ash 1 (large),
Birch 2, Cedar 3, Dale 4 (medium), Elm 5, Fern 6, Glen 7 (small); North Pass 17 is a neutral
province next to Cedar.

Every case is also played mirrored, by player 1 on the mirror nodes (AGENTS.md, section 4.1,
item 6).
"""

from dataclasses import replace
from itertools import pairwise
from pathlib import Path

import pytest

from gow_bots.bots import BOTS, SmartBot
from gow_bots.bots.campaign import CampaignBot, Ctx
from gow_bots.bots.economy import SHIFT_HOLD_TICKS, LeafShift, leaf_shift_command
from gow_sim.commands import CancelOrder, Command, Move, PlayerCommand, Recruit, SetLeafShift, Split
from gow_sim.maps import load_map
from gow_sim.match import Match
from gow_sim.ruleset import load_ruleset
from gow_sim.state import AtNode, Detail, Group, Mode, OnEdge, Sighting, initial_state
from gow_sim.systems.flow import update_flow
from gow_sim.view import GroupView, NodeView, OrderView, PlayerView, project

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))
MAP = load_map(ROOT / "packages" / "sim" / "tests" / "maps" / "dec41.json")
RULES = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")
KEEP, ASH, BIRCH, CEDAR, DALE, ELM = range(6)
NORTH_PASS = 17
TICK = 1000
NAMES = ("rusher", "smart_rusher", "smart_turtle", "smart_hoarder")


def _at(player: int, node: int) -> int:
    """``node`` of the table for ``player``: the mirror node for player 1."""
    return MAP.node_key(player, node)


def _view(player: int, groups: list[tuple[int, int, int]]) -> PlayerView:
    """The start of ``dec41`` at ``TICK`` with the start garrisons removed and the own groups
    ``(node, units, charged)`` (nodes of the table, mirrored for player 1)."""
    state = initial_state(MAP, RULES)
    state.groups.clear()
    state.tick = TICK
    for node, units, charged in groups:
        gid = state.new_id()
        where = AtNode(_at(player, node))
        state.groups[gid] = Group(gid, player, units, charged, Mode.ATTACK, where)
    update_flow(state, RULES)
    return project(state, RULES, player, KEY)


def _bot(name: str, player: int) -> CampaignBot:
    bot = BOTS[name](MAP, RULES, seed=0, player=player)
    assert isinstance(bot, CampaignBot)
    return bot


def _ctx(bot: CampaignBot, view: PlayerView) -> Ctx:
    return Ctx(view, view.tick, view.me.cp, standing=bot.standing(view))


def _group_at(view: PlayerView, node: int) -> GroupView:
    return next(g for g in view.groups if g.location == AtNode(node))


def _edge(a: int, b: int) -> int:
    return next(e for e in MAP.incident[a] if MAP.edges[e].other(a) == b)


def _with_groups(view: PlayerView, *extra: GroupView) -> PlayerView:
    return replace(view, groups=(*view.groups, *extra))


def _strong_enemy_in(view: PlayerView, node: int) -> PlayerView:
    """``node`` owned by the enemy, seen exactly this tick with 5 charged units."""
    nodes = list(view.nodes)
    seen = Sighting(view.tick, Detail.EXACT, (Mode.ATTACK,), 5, 5)
    nodes[node] = replace(nodes[node], owner=1 - view.player, detail=Detail.EXACT, seen=seen)
    return replace(view, nodes=tuple(nodes))


def _for(cmds: list[Command], group: int) -> list[Command]:
    return [c for c in cmds if getattr(c, "group", None) == group]


# Recalls ----------------------------------------------------------------------------------------


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", NAMES)
@pytest.mark.parametrize(("standing", "recalled"), [(4, True), (5, False), (6, False)])
def test_a_recall_into_a_full_node_is_not_issued(
    name: str, player: int, standing: int, recalled: bool
) -> None:
    """A 2/1 group on Cedar - North Pass meets 5 charged enemy units it cannot take: the cancel
    turns it back into Cedar (capacity 6), so it goes only while 2 more units fit there."""
    cedar, north = _at(player, CEDAR), _at(player, NORTH_PASS)
    view = _view(player, [(CEDAR, standing, standing)])
    edge = _edge(cedar, north)
    order = OrderView(dest=north, path=(north,), planned=False, depart_tick=TICK - 10)
    walker = GroupView(9999, 2, 1, Mode.ATTACK, OnEdge(edge, cedar, 300), order)
    view = _strong_enemy_in(_with_groups(view, walker), north)
    assert view.nodes[cedar].capacity == 6
    bot = _bot(name, player)
    ctx = _ctx(bot, view)
    bot._recall(ctx)  # pyright: ignore[reportPrivateUsage]
    assert (CancelOrder(walker.id) in ctx.cmds) is recalled
    if recalled:
        assert ctx.incoming[cedar] == 2  # the way back counts for the next moves


# Rallies ----------------------------------------------------------------------------------------


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", NAMES)
def test_a_rally_into_a_node_with_one_free_slot_splits_one_unit(name: str, player: int) -> None:
    """3/3 in Elm rallies to Ash (capacity 8), the only own node nearer the objective (Ash); 7
    own units stand there, so 1 more fits: a 1-unit split, not the whole group."""
    elm, ash = _at(player, ELM), _at(player, ASH)
    view = _view(player, [(ELM, 3, 3), (ASH, 7, 7)])
    bot = _bot(name, player)
    bot.objective = lambda ctx: ash  # type: ignore[method-assign]
    ctx = _ctx(bot, view)
    bot._rally(ctx)  # pyright: ignore[reportPrivateUsage]
    group = _group_at(view, elm).id
    assert _for(ctx.cmds, group) == [Split(group, 1)]


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", NAMES)
def test_a_rally_counts_the_groups_already_on_the_way(name: str, player: int) -> None:
    """Ash holds 5 and a 3-unit group is ordered there: Ash is full at the arrival, so 3/3 in
    Elm stays; with only 2 on the way 1 unit splits off."""
    elm, ash, birch = _at(player, ELM), _at(player, ASH), _at(player, BIRCH)
    for coming, expected in ((3, []), (2, [1])):
        view = _view(player, [(ELM, 3, 3), (ASH, 5, 5)])
        order = OrderView(dest=ash, path=(ash,), planned=False, depart_tick=TICK - 5)
        where = OnEdge(_edge(birch, ash), birch, 500)
        walker = GroupView(9999, coming, coming, Mode.ATTACK, where, order)
        view = _with_groups(view, walker)
        bot = _bot(name, player)
        bot.objective = lambda ctx: ash  # type: ignore[method-assign]
        ctx = _ctx(bot, view)
        assert ctx.incoming[ash] == coming
        bot._rally(ctx)  # pyright: ignore[reportPrivateUsage]
        group = _group_at(view, elm).id
        assert _for(ctx.cmds, group) == [Split(group, n) for n in expected]


@pytest.mark.parametrize("player", [0, 1])
def test_a_move_into_a_full_own_node_is_not_spent(player: int) -> None:
    """Every move of a standing group into an own node goes through ``spend``'s room check: 3
    units into Elm (capacity 4) with 2 standing there are refused, 2 units are sent and then
    count as on the way."""
    elm = _at(player, ELM)
    view = _view(player, [(ELM, 2, 2), (ASH, 3, 3), (BIRCH, 2, 2)])
    bot = _bot("smart_rusher", player)
    ctx = _ctx(bot, view)
    big, small = _group_at(view, _at(player, ASH)), _group_at(view, _at(player, BIRCH))
    assert not bot.spend(ctx, Move(big.id, elm))
    assert bot.spend(ctx, Move(small.id, elm))
    assert ctx.incoming[elm] == 2
    assert bot.room(ctx, elm) == 0


# Recruits ---------------------------------------------------------------------------------------


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", ["rusher", "smart_rusher"])
@pytest.mark.parametrize(("coming", "recruits"), [(3, True), (4, False)])
def test_the_capital_recruit_stops_at_the_free_room(
    name: str, player: int, coming: int, recruits: bool
) -> None:
    """The Keep (capacity 10) holds 6 and ``coming`` units are ordered home: a recruit only
    while ``10 - 6 - coming`` leaves room for it."""
    keep, ash = _at(player, KEEP), _at(player, ASH)
    view = _view(player, [(KEEP, 6, 6)])
    order = OrderView(dest=keep, path=(keep,), planned=False, depart_tick=TICK - 5)
    walker = GroupView(9999, coming, coming, Mode.ATTACK, OnEdge(_edge(ash, keep), ash, 500), order)
    view = replace(_with_groups(view, walker), me=replace(view.me, cp=RULES.cp.cap))
    bot = _bot(name, player)
    ctx = _ctx(bot, view)
    bot._recruit(ctx)  # pyright: ignore[reportPrivateUsage]
    assert (Recruit(keep) in ctx.cmds) is recruits


# The leaf shift ---------------------------------------------------------------------------------


def _shift_view(player: int, tick: int, shift: int) -> PlayerView:
    view = _view(player, [(KEEP, 2, 2)])
    assert view.me.leaf_shift_max is not None and view.me.leaf_shift_max >= 1
    return replace(view, tick=tick, me=replace(view.me, leaf_shift=shift))


def _owned_by(view: PlayerView, node: int, owner: int | None) -> PlayerView:
    nodes: list[NodeView] = list(view.nodes)
    nodes[node] = replace(nodes[node], owner=owner)
    return replace(view, nodes=tuple(nodes))


@pytest.mark.parametrize("player", [0, 1])
def test_the_leaf_shift_does_not_flip_within_the_hold(player: int) -> None:
    """The shift went back to 1 at ``TICK``; nothing calls for it after, but it stays 1 until
    ``SHIFT_HOLD_TICKS`` have passed, then it goes forward to 0."""
    bot = _bot("smart_rusher", player)
    memory = LeafShift()
    assert leaf_shift_command(bot, _shift_view(player, TICK - 5, 0), memory) is None
    for t in range(TICK, TICK + SHIFT_HOLD_TICKS, 5):
        assert leaf_shift_command(bot, _shift_view(player, t, 1), memory) is None
    later = _shift_view(player, TICK + SHIFT_HOLD_TICKS, 1)
    assert leaf_shift_command(bot, later, memory) == SetLeafShift(0)


@pytest.mark.parametrize("player", [0, 1])
def test_a_lost_node_alone_does_not_move_the_leaf_shift_back(player: int) -> None:
    """#749: the enemy takes an own node (Cedar) while the player attacks elsewhere: the shift
    stays at the front (#686 moved it back for 300 ticks; that burned more charges than it kept
    from captured warehouses). Own captures, of an enemy node and of a neutral one, do not move it
    either."""
    bot = _bot("smart_rusher", player)
    for node, owner in ((CEDAR, 1 - player), (12, player), (NORTH_PASS, player)):
        memory = LeafShift()  # Dale East, North Pass: own captures
        assert leaf_shift_command(bot, _shift_view(player, TICK, 0), memory) is None
        changed = _owned_by(_shift_view(player, TICK + 5, 0), _at(player, node), owner)
        assert leaf_shift_command(bot, changed, memory) is None


def test_every_smart_bot_keeps_the_hold_in_a_match() -> None:
    """In played matches no smart bot changes the shift twice within ``SHIFT_HOLD_TICKS``.

    Historical ruleset on purpose: the lever exists only where ``supply.leaf_shift`` is on
    (``mvp-5``, ``mvp-6``); the played ``mvp-7`` has none (DEC-50, ``test_supply_flow``). Only
    the bot's own changes count: a shift the rules clamp (DEC-43, item B3: at most ``d0`` of the
    own capital, 0 once the capital touches the enemy) is no command of the bot (#683)."""
    crossroads = load_map(ROOT / "maps" / "crossroads.json")
    names = ("smart_strangler", "smart_reactive")
    lever = load_ruleset(ROOT / "rulesets" / "mvp-5.toml")
    match = Match(crossroads, lever, KEY)
    bots = [BOTS[n](crossroads, lever, seed=1, player=p) for p, n in enumerate(names)]
    assert all(isinstance(b, SmartBot) for b in bots)
    changes: list[list[int]] = [[], []]
    seq = 0
    while match.tick < 3000 and not match.finished:
        cmds: list[PlayerCommand] = []
        if match.tick % 5 == 0:
            for p in (0, 1):
                for cmd in bots[p].decide(match.view(p), match.tick):
                    cmds.append(PlayerCommand(p, seq, match.resolve(p, cmd)))
                    seq += 1
        before = [match.state.players[p].leaf_shift for p in (0, 1)]
        match.step(cmds)
        for c in cmds:
            p = c.player
            if isinstance(c.cmd, SetLeafShift) and match.state.players[p].leaf_shift != before[p]:
                changes[p].append(match.tick)
    assert changes[0] or changes[1]  # the policy is exercised at all
    for ticks in changes:
        assert all(b - a >= SHIFT_HOLD_TICKS for a, b in pairwise(ticks))
