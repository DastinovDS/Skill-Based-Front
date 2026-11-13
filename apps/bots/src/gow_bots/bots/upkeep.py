"""Army upkeep of the smart bots (#1032, step 4c of the bot plan of 2026-11-13).

In the owner's match of 2026-11-13 ``smart_strangler@hard`` pressed once and then had nothing
left: it recruited nothing for ten minutes (the recruit was the last spending of a decision, behind
a kept ``recruit_keep``, while every earlier step spent a CP as soon as it had one), fed single
units into a strike it could not hold, and retook with single units. A ``SmartBot`` with ``UPKEEP``
(every personality, not the benchmarks) adds, from the ``PlayerView`` only:

1. **An army floor** (``floor``): ``FLOOR_PCT`` percent of the own start army of the map (public,
   symmetric), ``OPENING_PCT`` percent of that while the neutrals last (the land race is won by
   captures), none in the last awards when the bot goes all in (``SmartBot`` item 1: a recruit at
   home comes too late). Below it (own units and queued recruits, ``SmartBot.deficit``) recruits
   need no ``recruit_keep``: one comes before the attacks at most every ``FIRST_TICKS`` ticks, the
   others right after the attacks, before the rallies, merges and splits; the scouts and the
   threat fortifications leave a recruit's price; a retake or a block goes with two units or more,
   never one (``defense.retake``, ``defense.block``, ``SmartBot.score``).
2. **Reinforcements with the sum of forces**: a visible strike at an own node other than the
   capital is answered only by ``defense.answer``; the old ``respond`` that walked the nearest group
   in, one at a time, keeps only the capital. ``answer`` weighs every visible strike at the node
   together, each with the most it was seen with (its origin looks empty once it left) and with
   ``defense.HIDDEN_STRIKE`` charged units at least while its origin shows none; the reinforcement
   goes whole or not at all.
3. **A plan that will not take its target is called off** (``recall_plans``): a planned attack still
   gathering in its node whose target is seen this tick stronger than its charges with the whole
   requested bonus take (``CampaignBot.wins``: it would bounce or lose) is cancelled: the cancel
   is free and the units keep their charges (DEC-20, C); the target waits for more shots
   (``recall_holds``). The owner reinforced three of the four strikes of 2026-11-13 while their
   plans gathered (a planned order is public, DEC-41 item 10), and the stacks came back
   discharged.

Measured and dropped (#1032): a beaten, mostly discharged stack next to the enemy walking back to
a stocked warehouse to recharge. In every form tried (any front node; only with an enemy force in
sight that beats it) it lost 0.03 to 0.06 of the matches against the benchmarks: the node it
leaves is a free capture, and the move costs the CP of a recruit.

Ties go through ``Bot.key``; integers only.
"""

from typing import TYPE_CHECKING, Final

from gow_bots.bots.estimate import Phase
from gow_sim.commands import CancelOrder
from gow_sim.view import AtNode, PlayerView

if TYPE_CHECKING:
    from gow_bots.bots.campaign import Ctx
    from gow_bots.bots.smart import SmartBot

__all__ = ["FIRST_TICKS", "army", "floor", "recall_plans"]

OPENING_PCT: Final = 75
"""Percent of the floor kept while the neutrals last (``estimate.Phase.OPENING``)."""
FIRST_TICKS: Final = 200
"""Below the floor a recruit comes before the attacks at most once in this many ticks (about half
the CP income of Balance, ``stances.cp_period_ticks``); the other recruits take the CP the attacks
leave. A recruit before every attack measured weaker: it starves the captures (#1032)."""


def army(view: PlayerView) -> int:
    """Own units and the recruits queued in own cities."""
    units = sum(g.units for g in view.groups)
    queued = sum(n.recruit_queue or 0 for n in view.nodes if n.owner == view.player)
    return units + queued


def floor(bot: "SmartBot") -> int:
    """Item 1: the units the bot keeps at least in this decision (0: no floor)."""
    if not bot.UPKEEP:
        return 0
    a = bot.assessment
    if a is not None and not a.ahead and a.awards_left <= bot.params["all_in"]:
        return 0  # all in: a recruit at home comes too late
    least = bot.enemy_force.own_start * bot.FLOOR_PCT // 100
    if bot.phase is Phase.OPENING:
        least = least * OPENING_PCT // 100
    return least


def recall_plans(bot: "SmartBot", ctx: "Ctx") -> None:
    """Item 4 of the module docstring."""
    view = ctx.view
    for g in view.groups:
        order, loc = g.order, g.location
        if order is None or not order.gathering or not isinstance(loc, AtNode):
            continue
        if order.group_order is not None or bot.committed(g.id):
            continue  # one of several sent together: the target is judged against all of them
        dest = order.dest
        n = view.nodes[dest]
        if n.owner == view.player or n.seen is None or n.seen.tick != view.tick:
            continue
        if bot.enemy_at(view, dest) is None:
            continue
        toll = bot.toll_from(view, loc.node, dest, g.units, g.charged)
        if bot.wins(view, g, dest, order.plan, toll):
            continue  # it still takes the node with the whole bonus
        if bot.spend(ctx, CancelOrder(g.id)):
            ctx.used[g.id] = True
            ctx.claimed.pop(dest, None)
            bot.recalled[dest] = (ctx.tick, bot.seen_shots(view, dest) + toll)
