"""Pockets in the smart bots (#684; ``SmartBot`` item 20, ``gow_bots.bots.pockets``).

Expected values come from the rules (mechanics.md, section 7, DEC-43 item H and its table): the map
is ``dec41`` of the simulation tests, ``mvp-7``. Player 0 holds K = 0 (capital), A = 1, B, C, D = 2,
3, 4, E, F, G = 5, 6, 7; the passes 17 and 18 are player 1's, as in the base of table F. When player
1 takes A, then B, C, D, F, G are a pocket of player 0 (row H1: A was their only way to K) and K, E
are not. A ``Move`` ends at the first foreign node (SIM-05), and a capture is free under the
historical ``mvp-5`` (``capture.charge_cost = 0``, DEC-38; ``FREE`` below, three cases), so a
discharged group takes an empty A and stands in the capital's component again; with an enemy
garrison in A there is no free way out. Under the played ``mvp-7`` a capture spends a charge, a
discharged group cannot open the cut (``test_capture_toll``).

Every case is also played mirrored, by player 1 on the mirror nodes (AGENTS.md, section 4.1,
item 6).
"""

from collections.abc import Callable
from pathlib import Path

import pytest

from gow_bots.bots import BOTS, SmartBot, bot_factory
from gow_bots.bots.campaign import Ctx
from gow_bots.bots.pockets import FACTORY_UNITS, heading, read_pockets
from gow_bots.bots.smart import W_RESCUE
from gow_sim.commands import Command, Move, PlayerCommand, Split
from gow_sim.maps import load_map
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.state import AtNode, GameState, Group, Mode, initial_state
from gow_sim.systems.capacity import change_owner
from gow_sim.systems.flow import update_flow
from gow_sim.view import GroupView, PlayerView, project

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))
MAP = load_map(ROOT / "packages" / "sim" / "tests" / "maps" / "dec41.json")
RULES = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")
FREE = load_ruleset(ROOT / "rulesets" / "mvp-5.toml")
"""Historical (``capture.charge_cost = 0``): the free-cut path of the pocket rescue is live code."""
K, A, B, C, D, E, F, G, M = range(9)
PASSES = (17, 18)
POCKET = (B, C, D, F, G)
MAIN = (K, E)
TICK = 1000
SMART = (
    "smart_expander",
    "smart_hoarder",
    "smart_reactive",
    "smart_rusher",
    "smart_strangler",
    "smart_turtle",
)


def _at(player: int, node: int) -> int:
    """``node`` of the table for ``player``: the mirror node for player 1."""
    return MAP.node_key(player, node)


def _state(
    player: int,
    groups: list[tuple[int, int, int, int]],
    own: tuple[int, ...] = (),
    *,
    state: GameState | None = None,
    rules: Ruleset = RULES,
) -> GameState:
    """The base of the table with A taken by the other player at tick ``TICK``, then the groups
    ``(owner, node, units, charged)`` (nodes of the table, mirrored for player 1); ``own``: more
    nodes of ``player`` (M joins the pocket: its only own neighbour is C). ``state``: the one to
    set up (a ``Match``'s), a new initial state by default."""
    state = initial_state(MAP, rules) if state is None else state
    enemy = 1 - player
    for n in PASSES:
        state.nodes[_at(player, n)].owner = enemy
    for n in own:
        state.nodes[_at(player, n)].owner = player
    state.tick = TICK
    change_owner(state, _at(player, A), enemy)
    for owner, node, units, charged in groups:
        gid = state.new_id()
        where = AtNode(_at(player, node))
        state.groups[gid] = Group(gid, owner, units, charged, Mode.ATTACK, where)
    update_flow(state, rules)
    return state


def _view(state: GameState, player: int, rules: Ruleset = RULES) -> PlayerView:
    return project(state, rules, player, KEY)


def _bot(name: str, player: int, rules: Ruleset = RULES) -> SmartBot:
    bot = BOTS[name](MAP, rules, seed=0, player=player)
    assert isinstance(bot, SmartBot)
    return bot


def _group_at(view: PlayerView, node: int) -> GroupView:
    return next(g for g in view.groups if g.location == AtNode(node))


def _moves(cmds: list[Command], group: int) -> list[int]:
    return [c.dest for c in cmds if isinstance(c, Move) and c.group == group]


def _free_for(state: GameState, player: int) -> Callable[[int], bool]:
    """A foreign node with no enemy group in it (what ``SmartBot.read_pockets`` estimates empty
    when the node is seen)."""

    def free(node: int) -> bool:
        return not any(
            g.owner != player and g.location == AtNode(node) for g in state.groups.values()
        )

    return free


@pytest.mark.parametrize("player", [0, 1])
def test_the_pocket_and_its_way_out_follow_row_h1(player: int) -> None:
    state = _state(player, [(player, B, 3, 0)])
    view = _view(state, player)
    bot = _bot("smart_rusher", player)
    pk = read_pockets(view, bot.neighbors, bot.supplied(view), _free_for(state, player))
    assert pk is not None
    assert [n for n in range(len(MAP.nodes)) if pk.pocket[n]] == sorted(
        _at(player, n) for n in POCKET
    )
    assert [n for n in range(len(MAP.nodes)) if pk.main[n]] == sorted(_at(player, n) for n in MAIN)
    # One free capture (A) joins every pocket node to K; A itself is next to K.
    assert all(pk.exits[_at(player, n)] == 1 for n in POCKET)
    assert pk.exits[_at(player, A)] == 0
    # A cut the pocket off; its capture rejoins the 3 units standing in it, each stranded (no
    # charge, an empty warehouse) counted twice (#683).
    assert pk.rescue == {_at(player, A): 3 + 3}


@pytest.mark.parametrize("player", [0, 1])
def test_an_enemy_garrison_in_the_cut_closes_the_way_out(player: int) -> None:
    enemy = 1 - player
    state = _state(player, [(player, B, 3, 0), (enemy, A, 2, 2)])
    view = _view(state, player)
    bot = _bot("smart_rusher", player)
    pk = read_pockets(view, bot.neighbors, bot.supplied(view), _free_for(state, player))
    assert pk is not None
    assert all(pk.exits[_at(player, n)] == -1 for n in POCKET)
    assert pk.rescue == {_at(player, A): 3 + 3}


def test_a_stopped_factory_in_the_pocket_weighs_in_the_rescue() -> None:
    state = _state(0, [(0, B, 2, 0)])
    state.nodes[C].factory = 0  # H2: a factory in the pocket stops
    update_flow(state, RULES)
    view = _view(state, 0)
    bot = _bot("smart_rusher", 0)
    pk = read_pockets(view, bot.neighbors, bot.supplied(view), _free_for(state, 0))
    assert pk is not None
    assert pk.rescue == {A: 2 + 2 + FACTORY_UNITS}  # the 2 stranded units count twice (#683)


def test_no_pocket_no_reading() -> None:
    state = initial_state(MAP, RULES)
    view = _view(state, 0)
    bot = _bot("smart_rusher", 0)
    assert read_pockets(view, bot.neighbors, bot.supplied(view), lambda _: True) is None


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", [*SMART, "smart_rusher@easy", "smart_turtle@normal"])
def test_a_discharged_group_in_a_pocket_walks_out_through_the_free_cut(
    name: str, player: int
) -> None:
    """3/0 in the own province M (in the pocket through C): A, three roads away over own nodes,
    is the free capture that rejoins K; Cedar East next to M is empty too and nearer, but it
    leads deeper into the enemy's land."""
    state = _state(player, [(player, M, 3, 0)], own=(M,), rules=FREE)
    bot = bot_factory(name)(MAP, FREE, seed=0, player=player)
    assert isinstance(bot, SmartBot)
    view = _view(state, player, FREE)
    assert view.nodes[_at(player, M)].flow_pocket is True
    group = _group_at(view, _at(player, M)).id
    sent: list[int] = []
    for i in range(2):  # within two decisions of the level (``Tempo.think_ticks`` apart)
        tick = TICK + i * bot.tempo.think_ticks
        sent += _moves(bot.decide(view, tick), group)
        if sent:
            break
    assert sent == [_at(player, A)]


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", SMART)
def test_a_pocket_city_keeps_one_unit(name: str, player: int) -> None:
    """Under ``FREE``, 3/0 alone in the city B: an empty city falls to any enemy group for free
    (``capture.charge_cost = 0``), so 2 units split off to leave and 1 stays."""
    state = _state(player, [(player, B, 3, 0)], rules=FREE)
    view = _view(state, player, FREE)
    group = _group_at(view, _at(player, B)).id
    cmds = _bot(name, player, FREE).decide(view, TICK)
    assert [c for c in cmds if getattr(c, "group", None) == group] == [Split(group, 2)]


@pytest.mark.parametrize("player", [0, 1])
def test_heading_counts_the_units_ordered_into_foreign_nodes(player: int) -> None:
    """#754: the own units on the way into a node that is not own, the moves of this decision in
    place of the earlier orders; a move into an own node is not counted (``Ctx.incoming``
    has it)."""
    state = _state(player, [(player, B, 3, 0), (player, D, 2, 0), (player, C, 4, 0)])
    view = _view(state, player)
    b, d, c = (_group_at(view, _at(player, n)).id for n in (B, D, C))
    assert heading(view, []) == [0] * len(MAP.nodes)
    units = heading(
        view, [Move(b, _at(player, A)), Move(d, _at(player, A)), Move(c, _at(player, B))]
    )
    expected = [0] * len(MAP.nodes)
    expected[_at(player, A)] = 3 + 2
    assert units == expected


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", SMART)
def test_pocket_exits_fill_the_cut_up_to_its_capacity(name: str, player: int) -> None:
    """#754: 6/0 in B and 6/0 in D, both next to the free cut A (a large city, capacity 8,
    DEC-22): each city keeps one unit and 10 want out, more than A holds; units above the
    capacity die one every ``capacity.attrition_ticks`` (DEC-12). So within 300 ticks A is taken
    (the pocket is gone) and no unit of the bot dies of attrition (``SmartBot`` items 20, 21)."""
    match = Match(MAP, FREE, KEY)
    _state(player, [(player, B, 6, 0), (player, D, 6, 0)], state=match.state, rules=FREE)
    for p in match.state.players.values():
        p.cp = 500
    bot = bot_factory(name)(MAP, FREE, seed=0, player=player)
    attrition, seq = 0, 0
    for _ in range(300):
        cmds: list[PlayerCommand] = []
        if match.tick % 5 == 0:
            for cmd in bot.decide(match.view(player), match.tick):
                cmds.append(PlayerCommand(player, seq, match.resolve(player, cmd)))
                seq += 1
        match.step(cmds)
        attrition += sum(
            1 for e in match.state.events if e.kind == "attrition" and e.get("player") == player
        )
    assert FREE.capacity.by_kind.of(MAP.nodes[A].kind) == 8
    assert match.state.nodes[_at(player, A)].owner == player
    assert not any(n.owner == player and n.flow_pocket for n in match.view(player).nodes)
    assert attrition == 0


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", SMART)
def test_a_discharged_group_does_not_walk_into_a_garrisoned_cut(name: str, player: int) -> None:
    enemy = 1 - player
    state = _state(player, [(player, B, 3, 0), (enemy, A, 2, 2)])
    view = _view(state, player)
    group = _group_at(view, _at(player, B)).id
    assert _at(player, A) not in _moves(_bot(name, player).decide(view, TICK), group)


@pytest.mark.parametrize("player", [0, 1])
def test_the_cut_scores_more_by_the_units_it_rejoins(player: int) -> None:
    """The same position with and without 3 discharged units in the pocket: the score of A for a
    charged group in K differs by ``W_RESCUE`` per unit, twice for a stranded one (no charge, an
    empty warehouse: #683)."""
    enemy = 1 - player
    scores: list[int] = []
    for pocket_units in ((player, B, 3, 0),), ():
        state = _state(player, [(player, K, 4, 4), (enemy, A, 1, 1), *pocket_units])
        view = _view(state, player)
        bot = _bot("smart_rusher", player)
        bot.decide(view, TICK)  # the readings of the decision
        g = _group_at(view, _at(player, K))
        ctx = Ctx(view, TICK, view.me.cp, standing=bot.standing(view))
        need = bot.need(view, TICK, _at(player, A))
        score = bot.score(ctx, g, _at(player, A), need)
        assert score is not None
        scores.append(score)
    assert scores[0] - scores[1] == W_RESCUE * (3 + 3)


def test_pockets_are_read_only_under_the_flow(mvp_rules: Ruleset) -> None:
    bot = SmartBot(MAP, mvp_rules, seed=0, player=0)
    view = project(initial_state(MAP, mvp_rules), mvp_rules, 0, KEY)
    assert bot.read_pockets(view, 0, bot.supplied(view)) is None


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", SMART)
def test_a_stranded_group_joins_a_charged_one_to_leave_the_pocket(name: str, player: int) -> None:
    """#683, under ``mvp-7`` (a capture costs a charge, DEC-38): 2/0 in the own province M cannot
    pay the way out (M, C, B, then the empty A), so it walks to C, where 2/2 stands, and the 2/2
    does not leave before it arrives: together the charged units pay the capture for all."""
    state = _state(player, [(player, M, 2, 0), (player, C, 2, 2)], own=(M,))
    view = _view(state, player)
    assert view.nodes[_at(player, M)].flow_pocket is True
    assert view.nodes[_at(player, M)].warehouse == 0
    stranded, charged = (_group_at(view, _at(player, n)).id for n in (M, C))
    cmds = _bot(name, player).decide(view, TICK)
    assert _moves(cmds, stranded) == [_at(player, C)]
    assert _moves(cmds, charged) == []
