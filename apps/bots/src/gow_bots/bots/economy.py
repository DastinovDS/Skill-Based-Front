"""The factories, plans, leaf shift and road fortifications of the bots (DEC-41, DEC-43;
mechanics.md, section 7).

Charges come only from factories and the automatic supply flow carries them (DEC-43). These
helpers are the play every campaign bot shares; they read only the ``PlayerView``, the map and the
ruleset, and every tie goes through ``Bot.key`` (mirror-invariant):

- **Factories**: ``gow_bots.bots.factories`` (#683: a rear site, paid from spare stock, valued
  by the match left at the stance period, no rebuild churn).
- **Plans** (``Bot.plan_bonus``, ``release_commands``): a planned order requests at most the
  stock of its node's warehouse and the charged units of the group (DEC-41, item 10); a plan that
  gathered for its requested time plus ``RELEASE_SLACK`` ticks departs with what it has
  (``ReleasePlan``), one without any bonus is cancelled. Under the group order (DEC-48, item L:
  ``[group_order]`` disables ``ReleasePlan``) such a plan is cancelled whatever it gathered.
- **Leaf shift** (``leaf_shift_command``, DEC-43 item G), the one lever of the flow: the level
  goes one road back (``SetLeafShift(1)``) so new charges stop short of a node the bot may lose (a
  captured warehouse is lost, DEC-43 item C), while an own leaf faces a visibly stronger enemy and
  the bot attacks from none of them; back to the front (``0``) otherwise. #686 also kept the shift
  back for 300 ticks after the enemy took an own node; #749 removed that: against the hold alone
  it burned 1.4 to 2.3 times the share of its charges (at full warehouses behind the level) to
  save about 5 charges a match from captured warehouses, and lost head to head (0.40 for it, 72
  local matches of three ``hard`` personalities). A tired army ahead of the level still pulls its
  charges (items I6, I7), so the shift only stops the refill of the leaf warehouses. Hysteresis
  (G-L of the ``mvp-4`` bot audit): the shift stays ``SHIFT_HOLD_TICKS`` after a change
  (``LeafShift``), it does not flap with every sighting. Not under ``supply.leaf_shift = false``
  (DEC-50, ``mvp-7``): the ruleset has no lever and ``Bot.allowed`` drops the command.
- **Road fortifications** (``fort_site``, DEC-43 item D) are the CP sink: while the CP are near
  the cap, an own node fortifies the road to an enemy neighbour where an enemy is in sight (the
  smart bots ask last in the decision, with the CP it leaves, #1015: ``SmartBot.fort_sink``); an
  attack whose road into the target is fortified pays the toll from its real charges first
  (``Bot.toll_from``, ``utility.takes``; an empty node too, #760).
"""

from dataclasses import dataclass
from typing import Final

from gow_bots.bots.base import Bot
from gow_sim.commands import CancelOrder, Command, ReleasePlan, SetLeafShift
from gow_sim.maps import NodeKind
from gow_sim.view import AtNode, PlayerView

__all__ = [
    "RELEASE_SLACK",
    "SHIFT_HOLD_TICKS",
    "LeafShift",
    "fort_site",
    "leaf_shift_command",
    "release_commands",
]

RELEASE_SLACK: Final = 60
"""Ticks a gathering plan waits beyond its requested bonus times ``orders.plan_ticks_per_bonus``."""
LEAF_MARGIN: Final = 1
"""Charged enemy units beyond the own charged units of a leaf that make it "visibly stronger"
(``leaf_shift_command``)."""
SHIFT_HOLD_TICKS: Final = 300
"""The leaf shift stays at least this many ticks (30 s) after it changed (G-L: no flapping)."""


@dataclass(slots=True)
class LeafShift:
    """What ``leaf_shift_command`` remembers between decisions, all from the own views."""

    shift: int | None = None
    """The shift in force in the last view."""
    since: int | None = None
    """The tick that shift was first seen in force; ``None``: never changed in this match."""

    def observe(self, view: PlayerView) -> None:
        shift = view.me.leaf_shift
        if self.shift is not None and shift != self.shift:
            self.since = view.tick
        self.shift = shift


def fort_site(bot: Bot, view: PlayerView, budget: int) -> tuple[int, int] | None:
    """The road fortification to build now (DEC-43, item D), ``(node, edge)``, or ``None``.

    Only while the CP are near their cap (``cp.cap - cp.per_period`` or more: the next income
    would burn in part) and ``budget`` pays ``fort.cost``: an own node (a city or a province)
    with no fight, on the road to an enemy neighbour it does not fortify yet, where an enemy is
    in sight (in that neighbour or as a figure on that road). The most VP of the own node first
    (the capital counted with its multiplier), then the most enemy units seen there, then
    ``Bot.key`` of the node and of the neighbour (mirror-invariant)."""
    rules = bot.rules
    fort = rules.fort
    if budget < fort.cost or view.me.cp < rules.cp.cap - rules.cp.per_period:
        return None
    me = view.player
    fights = bot.fight_nodes(view)
    best: tuple[int, int, int, int] | None = None
    site: tuple[int, int] | None = None
    for n in view.nodes:
        node = n.id
        if n.owner != me or node in fights:
            continue
        mdef = bot.map.nodes[node]
        vp = mdef.vp * (rules.victory.capital_multiplier if mdef.kind is NodeKind.CAPITAL else 1)
        for eid in bot.map.incident[node]:
            other = bot.map.edges[eid].other(node)
            if view.nodes[other].owner != 1 - me:
                continue
            edge = view.edges[eid]
            if any(f.node == node for f in edge.forts):
                continue
            seen = view.nodes[other].seen
            units = 0 if seen is None else (seen.enemy_units or len(seen.enemy_modes))
            units += sum(g.units or 1 for g in edge.enemy_groups)
            if units <= 0:
                continue
            rank = (-vp, -units, bot.key(node), bot.key(other))
            if best is None or rank < best:
                best, site = rank, (node, eid)
    return site


def release_commands(bot: Bot, view: PlayerView, since: dict[int, int], tick: int) -> list[Command]:
    """``ReleasePlan`` for a gathering plan that waited its time (module docstring), a cancel
    for one that gathered nothing, or for any such plan under ``[group_order]`` (DEC-48, item L:
    no release there); ``since``: own group id to the tick its gathering was first seen, kept up
    to date here."""
    per = bot.rules.orders.plan_ticks_per_bonus
    release = bot.rules.group_order is None
    live: dict[int, bool] = {}
    cmds: list[Command] = []
    for g in view.groups:
        order = g.order
        if order is None or not order.gathering:
            continue
        live[g.id] = True
        start = since.setdefault(g.id, tick)
        if tick - start < order.plan * per + RELEASE_SLACK:
            continue
        cmds.append(ReleasePlan(g.id) if release and order.bonus >= 1 else CancelOrder(g.id))
    for gid in sorted(since):
        if gid not in live:
            del since[gid]
    return cmds


def leaf_shift_command(bot: Bot, view: PlayerView, memory: LeafShift) -> Command | None:
    """The leaf shift the bot wants now (module docstring), as a command when it differs from the
    one in force and the one in force has stood ``SHIFT_HOLD_TICKS``; ``None`` otherwise.
    ``memory`` is updated on every call.

    "Visibly stronger": a neighbour of the enemy whose charged units as the view tells them
    (``Bot.enemy_at``; a presence without numbers counts as nothing) exceed the own charged units
    standing in the leaf by more than ``LEAF_MARGIN``. "Attacks": an own group has an order to a
    node the player does not own. Reads only the own view (ownership, the own ``front_dist`` and
    shift)."""
    me = view.me
    if me.leaf_shift is None or me.leaf_shift_max is None:
        return None
    memory.observe(view)
    if memory.since is not None and view.tick - memory.since < SHIFT_HOLD_TICKS:
        return None
    player = view.player
    attacking = any(
        g.order is not None and view.nodes[g.order.dest].owner != player for g in view.groups
    )
    want = 0
    if not attacking:
        charged = [0] * len(view.nodes)
        for g in view.groups:
            if isinstance(g.location, AtNode):
                charged[g.location.node] += g.charged
        for n in view.nodes:
            if n.owner != player or n.front_dist != 0:
                continue
            for m in bot.neighbors[n.id]:
                if view.nodes[m].owner != 1 - player:
                    continue
                seen = bot.enemy_at(view, m)
                if seen is not None and seen[1] > charged[n.id] + LEAF_MARGIN:
                    want = 1
    want = min(want, me.leaf_shift_max)
    return None if want == me.leaf_shift else SetLeafShift(want)
