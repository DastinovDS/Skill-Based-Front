"""The defense of the smart bots (#1022, step 4b of the bot plan of 2026-11-12).

The owner's five matches against ``smart_strangler@hard`` (2026-11-12) showed a bot that won the
land race and then gave it away: most of its front nodes had no charged defender, the owner
walked into 15 to 20 empty nodes a match with their warehouses, a visible planned strike at a
lesser node got no answer, a lost node was not taken back, and the bot did nothing while the
owner's whole army sat in one fight. A ``SmartBot`` with ``DEFENSE`` (every personality, not the
benchmarks) adds, from the ``PlayerView`` only:

1. **A line** (``plan_line``, once the neutrals run out: ``estimate.Phase`` past the opening).
   The own nodes next to an enemy node (the front, the capital and pockets aside) are ranked by
   what their loss costs: ``W_VP`` per VP, the warehouse charges, a factory or a barracks
   (``W_BUILT``), ``W_CUT`` per own node the loss cuts off the capital (``forts.cut_off``). A
   *salient* (no building, at most one own neighbour, two enemy ones or more; on the plains even a
   city, elsewhere one without VP) is given up, and so is a node ranked below ``W_PICKET`` (a
   province with an empty warehouse: nothing to lose but the node). The terrain counts (the
   owner's input of 2026-11-12): a mountain ranks ``W_HEIGHT`` more per charge it adds to the
   defender (with the cities, the critical points of the front); a plains province is held only
   while a counter-attack is ready behind it (``backed``: an own neighbour off the front with
   ``HOLD`` charged units), and a plains node gets ``HOLD`` units or nobody, never a thin picket
   (a defender on the plains burns a charge in the first round, DEC-45). A ranked node with an
   enemy force in sight next to it (``seen_near``: a fresh sighting of a neighbour, a figure
   heading in) keeps a garrison (``SmartBot.front_hold``, ``garrison``): ``HOLD`` units where it
   is ranked ``W_GARRISON`` or more, a ``PICKET`` else (a charged unit makes a walk-in a fight,
   DEC-07), one more against ``THREAT_HIGH`` shots, at most ``HOLD_HIGH``; the most valuable
   first, while ``HOLD_SHARE`` percent of the units outside the capital guard last.
   A stack that outguns the force in sight is not held: it is free to strike it (the combined
   attacks of item 28, #1023). A node with no enemy in sight keeps nobody: units that stand where
   nothing comes are captures not made (the CP bind every bot, ``tempo``). The rest of the army
   attacks: a held node lets the rest of its group go, one unit too (``SmartBot._guard_split``).
2. **A reaction force seals a breakthrough** (``seal``; the owner's input of 2026-11-12: a broken
   flank with no spare units chokes the own attack). An own node the enemy took within
   ``RETAKE_TICKS`` is retaken, the most valuable first, before any attack: by the nearest free
   charged group whose charges take it (``takes``: the estimate, the toll, the capture price;
   with the full plan bonus when only the bonus does it, DEC-41 item 10; the garrisons of the
   nodes next to the breach may go, ``SmartBot.may_leave(hold=False)``), else by up to
   ``SEAL_GROUPS`` of them together in one ``GroupMove`` with a synchronized arrival (DEC-48)
   when their sum does. When nothing can take it and the loss broke into the territory (two own
   neighbours or more), the nearest free group blocks the road into the rear: the empty own
   neighbour of the lost node nearest the own capital. A standing reserve
   was measured and dropped: three charged units kept idle behind the line turned 0.21 of the
   strangler's matches against ``smart_exploiter`` into 0.00 (24 matches each, captures 46 to 36
   a match) and sealed no faster: units that wait are captures not made. The force is whatever
   stands free nearest the breach, sized by what the retake needs. A personality without ``SEAL``
   (the rusher: its army attacks) leaves the retake to the score of item 4.
3. **Visible strikes at any own node** (``answer``; planned orders are public intents, DEC-41
   item 10, DEC-48). The strike counts the charges seen in its origin twice (the full bonus);
   when the target does not hold that (``shots_to_take`` of the garrison and the units on the way),
   the free charged groups that arrive in time go when together they hold it (the sum holds);
   otherwise the origin is a target (``W_PREEMPT``: hit the gathering squad, or its empty origin
   once it left), and a garrison that would die whole leaves for its safest own neighbour
   (``pull_out``), the capital aside.
4. **Retakes and raids** (``bonus``, read by ``SmartBot.score``; ``options`` keeps only the attacks
   whose sum holds): an own node lost within ``RETAKE_TICKS`` scores ``W_RETAKE`` (more when its
   loss broke into the own territory); while the enemy besieges an own node (a fight it attacks)
   its enemy neighbours, where the siege came from, score ``W_SOURCE`` (taken, the bounced
   attackers die: DEC-24, item G3); while its army is committed (a siege or two strikes) every
   enemy node the estimate shows empty scores ``W_RAID``.

The late game without the lead goes all in (``SmartBot`` item 1): no line. Ties go
through ``Bot.key`` and the opaque ids are never compared: mirror-invariant and deterministic.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Final

from gow_bots.bots.base import node_of
from gow_bots.bots.campaign import figure_numbers
from gow_bots.bots.forts import cut_off
from gow_bots.bots.utility import shots_to_take, takes, terrain_burned
from gow_sim.commands import GroupMove, Move
from gow_sim.view import AtNode, GroupView, IntentView, PlayerView

if TYPE_CHECKING:
    from gow_bots.bots.campaign import Ctx
    from gow_bots.bots.smart import SmartBot

__all__ = ["Defense", "Line", "plan_line", "strike_shots"]

PICKET: Final = 1
"""Units every held front node keeps first: a charged one makes a walk-in a fight."""
W_PICKET: Final = 2
"""A front node ranked below this (a province with fewer than two charges, no cut) is not held."""
W_GARRISON: Final = 3
"""A front node ranked at least this (a city, a warehouse of three, a building, a cut) keeps
``HOLD`` units once every held node has its picket."""
HOLD: Final = 2
"""Units a held front node worth a garrison keeps."""
HOLD_HIGH: Final = 3
"""Units a held front node keeps where the enemy threat reaches ``THREAT_HIGH`` shots."""
THREAT_HIGH: Final = 4
W_VP: Final = 3
"""Rank of a front node per VP it is worth (item 1)."""
W_HEIGHT: Final = 3
"""Rank of a front node per charge its terrain adds to the defender (a mountain, DEC-07 rule 1):
the owner's critical points, with the cities."""
W_BUILT: Final = 3
"""Rank of a front node with a factory or a barracks."""
W_CUT: Final = 2
"""Rank of a front node per own node its loss cuts off the capital."""
RETAKE_TICKS: Final = 600
"""An own node the enemy took is retaken (or sealed off) for this many ticks after the loss."""
W_RETAKE: Final = 300
"""Score of a lost own node (item 4): a VP of an enemy city and a half."""
W_BREACH: Final = 100
"""More score per own neighbour of a lost node beyond the first: the loss broke into the
territory."""
W_PREEMPT: Final = 300
"""Score of the origin of a visible enemy strike at an own node (item 3)."""
W_SOURCE: Final = 300
"""Score of an enemy node next to an own node the enemy besieges (item 4)."""
W_RAID: Final = 150
"""Score of an empty enemy node while the enemy army is committed (item 4)."""
COMMITTED_UNITS: Final = 3
"""Enemy units in a siege of an own node that count as its army committed."""
CUT_TICKS: Final = 20
"""The cut-off counts of the front nodes are recomputed this often."""
SEAL_GROUPS: Final = 3
"""Groups a retake combines at most (``seal``)."""
ANSWER_HOPS: Final = 4
"""Farthest own node a reinforcement of a strike comes from, in road hops."""


@dataclass(frozen=True, slots=True)
class Line:
    """The posture of one decision (item 1, item 2)."""

    hold: tuple[int, ...]
    """Units each own node keeps as its garrison (0: none)."""


@dataclass(slots=True)
class Defense:
    """The memory of the defense between decisions."""

    owned: list[bool] = field(default_factory=list[bool])
    """Own nodes at the last decision."""
    lost: dict[int, int] = field(default_factory=dict[int, int])
    """Own node the enemy took to the tick it was seen lost."""
    line: Line = field(default_factory=lambda: Line(()))
    bonus: dict[int, int] = field(default_factory=dict[int, int])
    """Target to the score it adds in this decision (item 4)."""
    answered: dict[int, int] = field(default_factory=dict[int, int])
    """Opaque intent id to the tick it was answered."""
    cut: dict[int, int] = field(default_factory=dict[int, int])
    cut_tick: int = -CUT_TICKS

    def hold(self, node: int) -> int:
        h = self.line.hold
        return h[node] if node < len(h) else 0


def strike_shots(bot: "SmartBot", view: PlayerView, origin: int, tick: int) -> int:
    """The shots a strike from ``origin`` brings: the charges the estimate shows there twice (a
    full bonus, at most the charged units, DEC-41 item 10)."""
    charged = bot.estimate(view, tick, origin)[1]
    return 2 * max(charged, 1)


def held_shots(bot: "SmartBot", ctx: "Ctx", node: int, extra_units: int, extra_charged: int) -> int:
    """The shots that take own ``node`` from its garrison, the own groups on the way into it
    and ``extra`` more."""
    units = charged = 0
    for g in ctx.view.groups:
        if g.location == AtNode(node) or (g.order is not None and g.order.dest == node):
            units += g.units
            charged += g.charged
    units += extra_units
    charged += extra_charged
    if units <= 0:
        return 0
    terrain = bot.map.nodes[node].terrain
    burned = terrain_burned(bot.rules, ctx.view, node)
    return shots_to_take(bot.rules, terrain, units, charged, burned=burned)


def seen_near(bot: "SmartBot", view: PlayerView, node: int) -> int:
    """The enemy shots in sight next to own ``node``: the strongest fresh sighting of a neighbour
    (``CampaignBot.sighted``: its numbers, a guess for presence only) and the figures on its
    roads heading into it (DEC-33)."""
    best = 0
    tick = view.tick
    for m in bot.neighbors[node]:
        numbers = bot.sighted(view, tick, m)
        if numbers is not None:
            best = max(best, numbers[1])
    for e in bot.incident[node]:
        edge = bot.map.edges[e]
        for f in view.edges[e].enemy_groups:
            if (edge.b if f.toward_b else edge.a) == node:
                best += figure_numbers(f)[1]
    return best


def backed(bot: "SmartBot", view: PlayerView, node: int, charged: Sequence[int]) -> bool:
    """A counter-attack is ready behind own ``node``: an own neighbour not next to the enemy holds
    ``HOLD`` charged units or more."""
    me, enemy = view.player, 1 - view.player
    for m in bot.neighbors[node]:
        if view.nodes[m].owner != me or charged[m] < HOLD:
            continue
        if not any(view.nodes[k].owner == enemy for k in bot.neighbors[m]):
            return True
    return False


def plan_line(bot: "SmartBot", view: PlayerView, d: Defense) -> Line:
    """Item 1 and item 2 of the module docstring."""
    count = len(view.nodes)
    none = Line((0,) * count)
    if not bot.defending() or not bot.settled():
        return none
    a = bot.assessment
    if a is not None and not a.ahead and a.awards_left <= bot.params["all_in"]:
        return none  # all in (``SmartBot`` item 1)
    me, enemy, home = view.player, 1 - view.player, bot.home
    if view.nodes[home].owner != me:
        return none
    pocket = bot.pockets.pocket if bot.pockets is not None else [False] * count
    units = sum(g.units for g in view.groups)
    avail = units - bot.params["guard"]
    budget = avail * bot.HOLD_SHARE // 100
    if view.tick - d.cut_tick >= CUT_TICKS:
        d.cut, d.cut_tick = {}, view.tick
    charged = [0] * count
    for g in view.groups:
        if isinstance(g.location, AtNode):
            charged[g.location.node] += g.charged
    defense_mod = bot.rules.terrain.defense_mod
    front: list[tuple[int, int, int, int]] = []
    for n in view.nodes:
        node = n.id
        if n.owner != me or node == home or pocket[node]:
            continue
        own = foe = 0
        for m in bot.neighbors[node]:
            owner = view.nodes[m].owner
            own += owner == me
            foe += owner == enemy
        if foe == 0:
            continue
        vp = bot.map.nodes[node].vp
        built = bool(n.factory) or bool(n.has_barracks)
        mod = defense_mod.of(bot.map.nodes[node].terrain)
        salient = own <= 1 and foe >= 2 and not built
        if salient and (vp == 0 or mod < 0):
            continue  # a salient (on the plains even with a city): given up
        if mod < 0 and vp == 0 and not built and not backed(bot, view, node, charged):
            continue  # a plains stretch with no counter-attack ready behind it: left
        cut = d.cut.get(node)
        if cut is None:
            cut = d.cut[node] = cut_off(view, bot.neighbors, home, node)
        worth = W_VP * vp + (n.warehouse or 0) + (W_BUILT if built else 0) + W_CUT * cut
        worth += W_HEIGHT * max(0, mod)  # a mountain is a critical point of the front
        if worth < W_PICKET:
            continue  # nothing to lose but the node: not worth a unit
        front.append((-worth, -seen_near(bot, view, node), bot.key(node), node))
    front.sort()
    hold = [0] * count
    for worth, seen, _, node in front:
        if seen >= 0:
            continue  # no enemy force in sight next to it: nothing to hold against yet
        if charged[node] > -seen:
            continue  # the stack there outguns the force in sight: free to strike it (#1023)
        want = HOLD if -worth >= W_GARRISON else PICKET
        if -seen >= THREAT_HIGH:
            want += 1
        plains = defense_mod.of(bot.map.nodes[node].terrain) < 0
        if plains:
            want = max(want, HOLD)  # a thin plains garrison burns its charge and dies (DEC-45)
        want = min(want, HOLD_HIGH)
        if budget < PICKET:
            break
        if plains and budget < want:
            continue
        want = min(want, budget)
        hold[node] = want
        budget -= want
    return Line(tuple(hold))


def read(bot: "SmartBot", view: PlayerView, d: Defense) -> None:
    """The losses, the line and the target scores of this decision."""
    me, enemy, tick = view.player, 1 - view.player, view.tick
    owned = [n.owner == me for n in view.nodes]
    if d.owned:
        for n in view.nodes:
            if d.owned[n.id] and n.owner == enemy:
                d.lost[n.id] = tick
    d.owned = owned
    d.lost = {
        n: t
        for n, t in sorted(d.lost.items())
        if tick - t <= RETAKE_TICKS and view.nodes[n].owner == enemy
    }
    d.answered = {i: t for i, t in sorted(d.answered.items()) if tick - t <= RETAKE_TICKS}
    d.line = plan_line(bot, view, d)
    d.bonus = {}
    if not bot.defending():
        return
    bonus = d.bonus
    for node in d.lost:
        breach = sum(view.nodes[m].owner == me for m in bot.neighbors[node])
        bonus[node] = W_RETAKE + W_BREACH * max(0, breach - 1)
    for i in view.intents:
        aimed = i.target is not None and view.nodes[i.target].owner == me
        if i.owner == enemy and aimed and view.nodes[i.origin].owner == enemy:
            bonus[i.origin] = max(bonus.get(i.origin, 0), W_PREEMPT)
    committed = 0
    for f in view.fights:
        node = f.node
        if node is None or f.attacker != enemy or view.nodes[node].owner != me:
            continue
        committed = max(committed, f.enemy_units)
        for m in bot.neighbors[node]:
            if view.nodes[m].owner == enemy:
                bonus[m] = bonus.get(m, 0) + W_SOURCE
    strikes = sum(1 for i in view.intents if i.owner == enemy and i.target is not None)
    if committed >= COMMITTED_UNITS or strikes >= 2:
        for n in view.nodes:
            if n.owner == enemy and bot.estimate(view, tick, n.id)[0] == 0:
                bonus[n.id] = bonus.get(n.id, 0) + W_RAID


def _send(bot: "SmartBot", ctx: "Ctx", g: GroupView, dest: int) -> bool:
    if not bot.spend(ctx, Move(g.id, dest)):
        return False
    ctx.used[g.id] = True
    ctx.standing[node_of(g)] -= g.units
    return True


def answer(bot: "SmartBot", ctx: "Ctx", strikes: Sequence[IntentView]) -> None:
    """Item 3: every visible enemy strike at an own node not answered yet."""
    d = bot.defense
    view, tick = ctx.view, ctx.tick
    for intent in strikes:
        target = intent.target
        if target is None or intent.id in d.answered or target == bot.home:
            continue
        shots = strike_shots(bot, view, intent.origin, tick)
        if held_shots(bot, ctx, target, 0, 0) > shots:
            d.answered[intent.id] = tick
            continue
        arrive = bot.arrival(intent) + (shots // 2) * bot.rules.orders.plan_ticks_per_bonus
        within = arrive - tick
        if reinforce(bot, ctx, target, shots, within) or pull_out(bot, ctx, target, shots):
            d.answered[intent.id] = tick


def reinforce(bot: "SmartBot", ctx: "Ctx", target: int, shots: int, within: int) -> bool:
    """The free charged groups that reach ``target`` within ``within`` ticks and fit it go, the
    nearest first, when together they make it hold ``shots`` (the sum holds); else none."""
    view = ctx.view
    ticks = bot.travel.ticks
    found: list[tuple[int, tuple[int, int, int], GroupView]] = []
    for g in bot.free_groups(ctx):
        here = node_of(g)
        if here == target or g.charged <= 0 or not bot.may_leave(ctx, g):
            continue
        way = ticks[here][target]
        if way < 0 or way > within:
            continue
        if target not in bot.reachable(view, here, ANSWER_HOPS, g.units):
            continue
        found.append((way, bot.group_order(g), g))
    found.sort(key=lambda x: (x[0], x[1]))
    room = bot.room(ctx, target)
    units = charged = 0
    picked: list[GroupView] = []
    for _, _, g in found:
        if g.units > room - units:
            continue
        picked.append(g)
        units += g.units
        charged += g.charged
        if held_shots(bot, ctx, target, units, charged) > shots:
            break
    else:
        return False
    sent = False
    for g in picked:
        sent = _send(bot, ctx, g, target) or sent
    if sent:
        ctx.claimed[target] = True
    return sent


def pull_out(bot: "SmartBot", ctx: "Ctx", target: int, shots: int) -> bool:
    """A garrison that would die whole (the strike's shots take it with every unit killed) leaves
    for the own neighbour with the least enemy next to it and room (``PULL_OUT``)."""
    if not bot.PULL_OUT or bot.pinned[target]:
        return False
    view = ctx.view
    groups = [g for g in bot.free_groups(ctx) if node_of(g) == target]
    if not groups:
        return False
    units = sum(g.units for g in groups)
    if shots < held_shots(bot, ctx, target, 0, 0) + units:
        return False  # the garrison takes some of them with it, or holds
    fights = bot.fight_nodes(view)
    exits = [
        m
        for m in bot.neighbors[target]
        if view.nodes[m].owner == bot.player and m not in fights and not bot.doomed[m]
    ]
    if not exits:
        return False
    dest = min(exits, key=lambda m: (bot.threat[m], bot.hops[bot.home][m], bot.key(m)))
    moved = False
    for g in groups:
        if g.units <= bot.room(ctx, dest):
            moved = _send(bot, ctx, g, dest) or moved
    return moved


def seal(bot: "SmartBot", ctx: "Ctx") -> None:
    """Item 2: every own node lost within ``RETAKE_TICKS``, the most valuable first, is retaken by
    the nearest free charged group that takes it, else by up to ``SEAL_GROUPS`` together; else
    the nearest free group blocks the road into the rear."""
    d = bot.defense
    if not d.lost:
        return
    view = ctx.view
    fights = bot.fight_nodes(view)
    for target in sorted(d.lost, key=lambda n: (-d.bonus.get(n, 0), bot.key(n))):
        if target in ctx.claimed or target in fights:
            continue
        if not retake(bot, ctx, target):
            block(bot, ctx, target)


def retake(bot: "SmartBot", ctx: "Ctx", target: int) -> bool:
    """``seal`` of one lost node: one group, else a ``GroupMove`` of the nearest ones."""
    view, tick, rules = ctx.view, ctx.tick, bot.rules
    need = bot.need(view, tick, target)
    found: list[tuple[int, tuple[int, int, int], GroupView, int]] = []
    for g in bot.free_groups(ctx):
        if g.charged < rules.capture.charge_cost or g.charged <= 0:
            continue
        here = node_of(g)
        # The garrisons next to the breach are the ones that seal it; farther ones stay.
        if not bot.may_leave(ctx, g, hold=target not in bot.neighbors[here]):
            continue
        way = bot.ways(view, here, g.units).get(target)
        if way is None or not 0 < len(way.path) - 1 <= ANSWER_HOPS:
            continue
        toll = bot.toll_from(view, here, target, g.units, g.charged)
        found.append((way.ticks, bot.group_order(g), g, toll))
    found.sort(key=lambda x: (x[0], x[1]))
    for _, _, g, toll in found:
        bonus = bot.plan_bonus(view, node_of(g), g.charged) if need > 0 else 0
        if not takes(rules, g.charged, bonus, need, toll):
            continue
        planned = bonus >= 1 and not takes(rules, g.charged, 0, need, toll)
        if bot.spend(ctx, bot.order(g.id, target, planned, bonus)):
            ctx.used[g.id] = True
            ctx.standing[node_of(g)] -= g.units
            ctx.claimed[target] = True
            return True
        return False
    real = 0
    picked: list[GroupView] = []
    for _, _, g, toll in found[:SEAL_GROUPS]:
        picked.append(g)
        real += max(0, g.charged - toll)
        if len(picked) >= 2 and takes(rules, real, 0, need):
            cmd = GroupMove(tuple(p.id for p in picked), target)
            if not bot.spend(ctx, cmd):
                return False
            for p in picked:
                ctx.used[p.id] = True
                ctx.standing[node_of(p)] -= p.units
            ctx.claimed[target] = True
            return True
    return False


def block(bot: "SmartBot", ctx: "Ctx", target: int) -> None:
    """``seal`` when nothing retakes ``target`` and its loss broke into the territory (two own
    neighbours or more): the nearest free charged group walks into the empty own neighbour of
    ``target`` nearest the own capital (the road into the rear)."""
    view, me = ctx.view, ctx.view.player
    ways = [m for m in bot.neighbors[target] if view.nodes[m].owner == me and m != bot.home]
    if len(ways) < 2:
        return  # no breach into the territory: a lost edge node is not worth a move
    mod = bot.rules.terrain.defense_mod
    # Nearest the capital; of two, the one whose terrain helps the defender (not the plains).
    rear = min(
        ways,
        key=lambda m: (bot.hops[bot.home][m], -mod.of(bot.map.nodes[m].terrain), bot.key(m)),
    )
    if bot.load(ctx, rear) > 0 or rear in bot.fight_nodes(view):
        return
    ticks = bot.travel.ticks
    groups = sorted(
        (g for g in bot.free_groups(ctx) if g.charged > 0 and node_of(g) != rear),
        key=lambda g: (ticks[node_of(g)][rear], bot.group_order(g)),
    )
    for g in groups:
        if g.units > bot.room(ctx, rear) or not bot.may_leave(ctx, g):
            continue
        if rear in bot.reachable(view, node_of(g), ANSWER_HOPS, g.units):
            _send(bot, ctx, g, rear)
        return
