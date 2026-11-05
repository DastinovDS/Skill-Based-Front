"""Scenario regression tests of the smart bots on a pool map under ``mvp-4`` (#691).

The two failures of the owner's match 6 (the capital push of 10 units against 6 defenders, 11
discharged units idle in a cut-off pocket) happened under ``mvp-3``; their views do not exist on
``mvp-4``, and a bot-vs-bot tournament never reaches them. These positions are built on the pool
map ``crossroads`` (49 nodes, ``mvp-4``): the pocket one is the position a bot match reaches
(``smart_reactive`` against ``smart_hoarder``, seed 2, tick 1650: the centre chain of one side
cut off from its capital), the capital one is the owner's push under the rules of ``mvp-4``.

Expected values come from the rules and the issues, not from the bot's output (AGENTS.md, section
0, item 4): DEC-07 (a node held by ``u`` units with ``c`` charges falls to ``Qa >= c + terrain
modifier + u`` shots), SIM-05 (a ``Move`` ends at the first foreign node), DEC-22 and DEC-12 (node
capacity, attrition above it), DEC-25 (a recruit costs 1 CP, the queue holds 3), DEC-38 (a capture
is free), DEC-43 item D (a road fortification costs 1.5 CP, works after 100 ticks) and item H (a
pocket starves and its discharged groups never recharge), ``SmartBot`` items 20 to 22.

The capacity case at the end is marked ``xfail`` (not strict) for the bots that overfill the rescue
province: it documents a gap, the bot code is not changed here.

The tables are written in the frame of the bot under test: its capital is node 0, the enemy
capital node 48 (``crossroads`` is a 180 degree rotation, ``MapDef.node_key``); player 1 plays the
same table on the mirror nodes and roads (AGENTS.md, section 4.1, item 6).
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

import pytest

from gow_bots.bots import SmartBot, bot_factory
from gow_sim.commands import Command, FortifyRoad, Move, PlayerCommand, Recruit, Reject
from gow_sim.maps import load_map
from gow_sim.match import Match
from gow_sim.ruleset import load_ruleset
from gow_sim.state import AtNode, Group, Mode
from gow_sim.systems.capacity import change_owner
from gow_sim.systems.flow import update_flow
from gow_sim.view import GroupView, PlayerView

ROOT: Final = Path(__file__).resolve().parents[3]
KEY: Final = bytes(range(32))
MAP: Final = load_map(ROOT / "maps" / "crossroads.json")
RULES: Final = load_ruleset(ROOT / "rulesets" / "mvp-4.toml")
HOME: Final = 0
ME, FOE = 0, 1
"""The side of a group in a table: the bot under test, its enemy."""
SMART: Final = (
    "smart_expander",
    "smart_reactive",
    "smart_rusher",
    "smart_strangler",
    "smart_turtle",
)


def _at(player: int, node: int) -> int:
    """``node`` of the table (the frame of the bot) for ``player``: the mirror node for 1."""
    return MAP.node_key(player, node)


def _road(player: int, a: int, b: int) -> int:
    """The road between the table nodes ``a`` and ``b`` for ``player``."""
    x, y = _at(player, a), _at(player, b)
    return next(e for e in MAP.incident[x] if MAP.edges[e].other(x) == y)


def _scenario(
    player: int,
    own: Sequence[int],
    foe: Sequence[int],
    groups: Sequence[tuple[int, int, int, int]],
    *,
    tick: int,
    cp: int,
) -> Match:
    """A match of ``crossroads`` at ``tick``: the nodes ``own`` belong to ``player``, ``foe`` to
    the other one, the rest are neutral; ``groups`` are ``(side, node, units, charged)`` (the map's
    start garrisons are removed); both players have ``cp`` hundredths. The capitals keep their
    start warehouses; a node that changes hands is empty (``change_owner``)."""
    match = Match(MAP, RULES, KEY)
    state = match.state
    state.groups.clear()
    state.tick = tick
    for node in range(len(MAP.nodes)):
        key = _at(player, node)
        owner = player if node in own else 1 - player if node in foe else None
        change_owner(state, key, owner)
    for side, node, units, charged in groups:
        gid = state.new_id()
        owner = player if side == ME else 1 - player
        state.groups[gid] = Group(
            gid, owner, units, charged, Mode.ATTACK, AtNode(_at(player, node))
        )
    for p in state.players.values():
        p.cp = cp
    update_flow(state, RULES)
    return match


def _bot(name: str, player: int) -> SmartBot:
    bot = bot_factory(name)(MAP, RULES, seed=0, player=player)
    assert isinstance(bot, SmartBot)
    return bot


def _group_at(view: PlayerView, node: int) -> GroupView:
    return next(g for g in view.groups if g.location == AtNode(node))


@dataclass(slots=True)
class Run:
    """What the bot sent in a played stretch of a scenario and what the rules said to it."""

    sent: list[Command] = field(default_factory=list[Command])
    rejected: list[Reject] = field(default_factory=list[Reject])
    attrition: int = 0
    """Units of the bot's that died over the capacity of a node (DEC-12)."""


def _play(match: Match, bot: SmartBot, player: int, ticks: int) -> Run:
    """``ticks`` ticks of the scenario: the bot decides every 5 ticks (``run_headless``), the
    enemy does nothing."""
    run = Run()
    seq = 0
    for _ in range(ticks):
        cmds: list[PlayerCommand] = []
        if match.tick % 5 == 0:
            for cmd in bot.decide(match.view(player), match.tick):
                run.sent.append(cmd)
                cmds.append(PlayerCommand(player, seq, match.resolve(player, cmd)))
                seq += 1
        match.step(cmds)
        run.rejected += [
            r.outcome for r in match.results if r.player == player and isinstance(r.outcome, Reject)
        ]
        run.attrition += sum(
            1 for e in match.state.events if e.kind == "attrition" and e.get("player") == player
        )
    return run


def _held(match: Match, player: int, node: int) -> bool:
    """Whether ``player`` owns the node ``node`` of the table."""
    return match.state.nodes[_at(player, node)].owner == player


# The capital push of the owner's match 6 under mvp-4 ---------------------------------------------

PUSH_OWN: Final = (0, 1, 2, 3, 4, 6, 8)
PUSH_FOE: Final = (7, 11, 12, 40, 41, 42, 43, 44, 45, 46, 47, 48)
MIDDLE_COURT: Final = 7
"""A large city next to the capital (road 0-7): the enemy took it and stands there with 10/10."""
PUSH_SHOTS: Final = 10


def _push(player: int, walkers: Sequence[tuple[int, int, int]], *, cp: int = 500) -> Match:
    """The enemy stands in Middle Court (next to the capital, road 0-7) with 10 units, all
    charged, seen exactly by the capital garrison of 4/4; ``walkers`` ``(node, units, charged)``
    are the bot's other groups. Tick 3000: the bot has had its CP, the capital warehouse holds
    its 6 charges."""
    groups = [(ME, HOME, 4, 4), (FOE, MIDDLE_COURT, PUSH_SHOTS, PUSH_SHOTS)]
    groups += [(ME, node, units, charged) for node, units, charged in walkers]
    return _scenario(player, PUSH_OWN, PUSH_FOE, groups, tick=3000, cp=cp)


def _falls(match: Match, player: int, units: int, charged: int) -> bool:
    """Whether the enemy's ``PUSH_SHOTS`` shots take the capital held by ``units`` units with
    ``charged`` charges (DEC-07, rule 4: ``Qa >= Qd + units``, ``Qd`` the charges plus the terrain
    modifier of the node)."""
    terrain = MAP.nodes[_at(player, HOME)].terrain
    return charged + match.rules.terrain.defense_mod.of(terrain) + units <= PUSH_SHOTS


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", SMART)
def test_the_push_is_answered_at_once(name: str, player: int) -> None:
    """The owner's push: 10 enemy units next to the capital, 4/4 at home. DEC-07 says 4/4 fall
    (``10 >= 4 + 1 + 4``), so within one decision the bot (``SmartBot`` item 22) fortifies the
    road the force comes by (DEC-43, item D), brings home charged groups until the capital holds
    (6/6 hold: ``10 < 6 + 1 + 6``), queues recruits (DEC-25) and spends its CP on nothing else; the
    garrison does not march out."""
    match = _push(player, [(2, 2, 2), (3, 2, 0)])
    assert _falls(match, player, 4, 4)
    home = _at(player, HOME)
    view = match.view(player)
    garrison = _group_at(view, home).id
    by_id = {g.id: g for g in view.groups}
    cmds = _bot(name, player).decide(view, match.tick)
    assert FortifyRoad(home, _road(player, HOME, MIDDLE_COURT)) in cmds
    assert any(isinstance(c, Recruit) and c.node == home for c in cmds)
    homeward = [c for c in cmds if isinstance(c, Move) and c.dest == home]
    stock = view.nodes[home].warehouse or 0
    units = 4 + sum(by_id[c.group].units for c in homeward)
    charged = 4 + sum(
        by_id[c.group].charged + min(by_id[c.group].units - by_id[c.group].charged, stock)
        for c in homeward
    )
    assert not _falls(match, player, units, charged)
    assert not any(getattr(c, "group", None) == garrison for c in cmds)
    # The CP go to the defence: no order that costs CP is an attack or an expansion.
    assert all(c.dest == home for c in cmds if isinstance(c, Move))


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", SMART)
def test_the_capital_holds_when_the_push_is_played_on(name: str, player: int) -> None:
    """The same push played on for 150 ticks (the enemy stands still): the line on the road is
    working (DEC-43, item D4: 100 ticks after the command), the capital holds more than the 10
    visible shots (DEC-07) and the bot sent nothing the rules rejected."""
    match = _push(player, [(2, 2, 2), (3, 2, 0)])
    run = _play(match, _bot(name, player), player, 150)
    assert not run.rejected
    home = _at(player, HOME)
    view = match.view(player)
    here = [g for g in view.groups if g.location == AtNode(home)]
    assert not _falls(match, player, sum(g.units for g in here), sum(g.charged for g in here))
    forts = view.edges[_road(player, HOME, MIDDLE_COURT)].forts
    assert any(f.node == home and f.owner == player and f.built for f in forts)


# The unsupplied pocket of a bot match under mvp-4 -------------------------------------------------


def _flip(*nodes: int) -> tuple[int, ...]:
    """Nodes recorded as player 1 (capital 48) in the frame of the bot (capital 0)."""
    return tuple(MAP.node_key(1, n) for n in nodes)


POCKET_TICK: Final = 1650
"""The position is the one ``smart_reactive`` against ``smart_hoarder`` reaches on ``crossroads``
(seed 2, ``mvp-4``) at tick 1650: player 1 holds the chain 16, 17, 20, 21, 22, 24, 29 across the
centre, cut off from its capital 48 (a pocket, DEC-43 item H1) by the enemy nodes 25 and 34 and
the neutral province 33; 2 units without a charge stand idle in the centre city 24. Node numbers
below are those of the recording, flipped into the frame of the bot by ``_flip``."""
POCKET: Final = _flip(16, 17, 20, 21, 22, 24, 29)
RESCUE: Final = _flip(33)[0]
"""The one neutral province next to both the pocket and the capital's component: a free capture
(DEC-38) of it joins the pocket to the capital's component (DEC-43 item H1)."""
POCKET_OWN: Final = (*POCKET, *_flip(35, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48))
POCKET_FOE: Final = _flip(*range(12), 13, 14, 18, 23, 25, 28, 30, 32, 34)


def _pocket(
    player: int, *, centre: tuple[int, int] = (2, 0), cut: tuple[int, int] | None = None
) -> Match:
    """The recorded position. The bot's groups: 3/3 in the capital, 2/2 in 43, 2/2 in 17, ``centre``
    (units, charged) in 24, 2/2 in 39; the enemy's: 1/0 in 32, 1/1 in 18 and in 34. With ``cut``
    (units, charged) the enemy holds the province 33 as well, garrisoned by them."""
    ours = [(48, 3, 3), (43, 2, 2), (17, 2, 2), (24, *centre), (39, 2, 2)]
    theirs = [(32, 1, 0), (18, 1, 1), (34, 1, 1)]
    foe = POCKET_FOE
    if cut is not None:
        theirs.append((33, *cut))
        foe = (*foe, RESCUE)
    groups = [(ME, _flip(n)[0], u, c) for n, u, c in ours]
    groups += [(FOE, _flip(n)[0], u, c) for n, u, c in theirs]
    return _scenario(player, POCKET_OWN, foe, groups, tick=POCKET_TICK, cp=300)


def _pocket_nodes(match: Match, player: int) -> list[int]:
    """The own nodes in a pocket in the bot's view (``flow_pocket``)."""
    return [n.id for n in match.view(player).nodes if n.owner == player and n.flow_pocket]


POCKET_BOTS: Final = (*SMART, "smart_hoarder")


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", POCKET_BOTS)
def test_idle_discharged_units_leave_the_pocket_through_the_free_capture(
    name: str, player: int
) -> None:
    """The match's failure: 2/0 idle in the pocket city 24, which never recharges (DEC-43, item H).
    The free capture of the province 33 (DEC-38) is one road beyond the pocket's own nodes, so
    within 500 ticks (the walk alone is a good 200) a unit has walked out and taken it (a ``Move``
    ends at the first foreign node, SIM-05), no own node is in a pocket any more, and the bot sent
    nothing the rules rejected."""
    match = _pocket(player)
    assert _pocket_nodes(match, player) == sorted(_at(player, n) for n in POCKET)
    run = _play(match, _bot(name, player), player, 500)
    assert not run.rejected
    assert _held(match, player, RESCUE)
    assert _pocket_nodes(match, player) == []


@pytest.mark.parametrize("player", [0, 1])
@pytest.mark.parametrize("name", POCKET_BOTS)
def test_discharged_units_do_not_walk_into_a_garrisoned_cut(name: str, player: int) -> None:
    """The enemy holds 33 with 2/2: a unit without a charge entering it cancels no shot of the
    garrison and dies (DEC-07, rule 4), so none of the bot's discharged groups is ordered into an
    enemy node or onto 33 in the first decisions, and the units keep their city."""
    match = _pocket(player, cut=(2, 2))
    bot = _bot(name, player)
    view = match.view(player)
    discharged = {g.id for g in view.groups if g.charged == 0}
    assert discharged
    foreign = {n.id for n in view.nodes if n.owner != player}
    run = Run()
    for tick in range(match.tick, match.tick + 30, 5):
        run.sent += bot.decide(view, tick)
    entering = [c for c in run.sent if isinstance(c, Move) and c.group in discharged]
    assert not [c for c in entering if isinstance(c, Move) and c.dest in foreign]


OVERFILLED: Final = {
    ("smart_rusher", 0),
    ("smart_rusher", 1),
    ("smart_strangler", 0),
    ("smart_turtle", 0),
}
"""Bots and sides whose pocket exit puts more units into the rescue province than it holds (see
``test_a_big_pocket_group_leaves_within_the_capacity_of_the_way_out``): found by this scenario,
not fixed here (the smart bots are another issue's code)."""


OVERFILLED_MARK: Final = pytest.mark.xfail(
    strict=False,
    reason=(
        "pocket exits keep sending units to the rescue province after it holds its 3 (the units "
        "there and on the way are not counted): attrition, DEC-12; SmartBot items 20 and 21"
    ),
)


@pytest.mark.parametrize(
    ("name", "player"),
    [
        pytest.param(
            n,
            p,
            marks=[OVERFILLED_MARK] if (n, p) in OVERFILLED else [],
            id=f"{n}-{p}",
        )
        for n in POCKET_BOTS
        for p in (0, 1)
    ],
)
def test_a_big_pocket_group_leaves_within_the_capacity_of_the_way_out(
    name: str, player: int
) -> None:
    """5/0 stand idle in the pocket city 24 (capacity 8). The way out is the province 33, which
    holds 3 units (DEC-22, item 1; a group goes only through nodes whose capacity is not below its
    size, DEC-20), and units above the capacity of a node die one every 30 ticks (DEC-12). So the
    pocket empties through the province without a rejected order and without losing a unit to
    attrition (``SmartBot`` item 21: no move puts an own node over its capacity at the arrival,
    the units already on the way counted)."""
    match = _pocket(player, centre=(5, 0))
    run = _play(match, _bot(name, player), player, 500)
    assert not run.rejected
    assert _held(match, player, RESCUE)
    assert _pocket_nodes(match, player) == []
    assert run.attrition == 0
