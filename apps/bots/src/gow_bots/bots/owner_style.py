"""``owner_style``: a fixed benchmark that plays the owner's recipe and his principles.

The owner beat ``smart_strangler@hard`` 5:0 on 2026-11-12 with one repeatable recipe (the analysis
of the five replays): let the bot win the land race, then harvest its thin network with 3-unit
squads that ask for the full planned bonus, hold what he takes, and finish with one synchronized
assault on the capital. He then wrote down eight principles of his play (#1027). This bot plays
them from the ``PlayerView`` alone, as a fixed opponent for the gates of the bot plan. It is a
yardstick, not a personality to tune and not a server level (``gow_server.levelbots.LEVEL_BOTS``).

The decision, in the order it asks for one command:

1. **The open enemy capital** is taken at once (``capital.take_capital``, the owner's rule).
2. **Reinforce** an own node in a fight (``Bot.fight_commands``).
3. **The own capital** (principle 1: no idle units there, so the open-capital rule must hold):
   it keeps no guard while no enemy can reach it soon (``capital.home_eta`` above ``HOME_ETA``);
   once one can, it keeps the units that outgun the enemy shots in sight within ``HOME_HOPS``
   (fresh sightings, figures on the roads, a visible strike counted with its full bonus,
   ``defense.strike_shots``), at least one; when it does not hold them it recruits and the
   nearest free charged group that arrives in time walks home. Meanwhile the roads out of the
   capital toward the enemy get a fortification each, at most ``HOME_FORTS`` (DEC-43, item D).
4. **Retake at once** (``RETAKE_TICKS``): an own node the enemy took is the first target; the
   garrisons next to it may go.
5. **A visible strike** at an own node (planned orders are public, DEC-41 item 10): reinforce
   when the sum holds (``defense.held_shots``), else the garrison that would die whole leaves;
   its origin scores ``W_PREEMPT`` as a target.
6. **The assault**: from ``match_ticks - assault_lead`` one ``GroupMove`` of every free charged
   group at the enemy capital, planned with the full bonus of its members, once; only while
   behind on the VP forecast or when its shots take the capital by the view.
7. **The strike package** (principle 3 and the recipe): a squad of at most ``SQUAD`` units (the
   capacity of a province) strikes only when its shots beat the defender (``CampaignBot.estimate``
   and the reinforcements the defender brings in time, ``CampaignBot.support``), the terrain, the
   toll and the capture charge with ``MARGIN`` to spare (``utility.takes``), and asks for the FULL
   bonus (its charged units) when its node is supplied; squads that are short alone combine in
   one ``GroupMove``. Targets: a node lost a moment ago, the origin of a visible strike, defended
   enemy nodes on the plains first (``W_PLAINS``: their defender burns a charge, DEC-45), the
   empty ones (harvest), cities (VP) and mountains (the critical points, ``W_HEIGHT``).
   **Few provinces** (principles 4 and 5): a neutral province only as a gateway (it is the only
   way to a neutral or enemy city or mountain no own node touches) or as a shortcut (inside the
   own territory, it shortens the own roads between two own nodes by ``SHORTCUT`` hops or more,
   the route of the supply flow); a plains province only with an own neighbour that keeps
   ``HOLD`` units (a counter-attack ready). A squad below two units only walks into an empty
   node: a strike is two units at least. **Checkers** (principle 2): a squad deeper behind the
   front scores ``W_DEPTH`` per road of depth (``NodeView.front_dist``), so the rear units
   leapfrog the front
   groups, which stay and hold.
8. **The line** (principle 3 and 8): the own front cities and mountains, never a salient or a
   plains province, keep a garrison of charged units: ``PICKET`` (a walk-in becomes a fight), two
   on the plains (a single defender burns its charge, DEC-45), one more against ``THREAT_HIGH``
   shots in sight (``defense.seen_near``); the most valuable first, within ``HOLD_SHARE`` percent
   of the army. A missing garrison is filled by the nearest free charged group.
9. **Production** (principle 6): the first factory as early as the bot holds a city one or two
   roads from its capital on the axis to the enemy capital (it feeds both flanks), paid fast by
   the charges of a group standing in it (the progressive payment, DEC-41 item 7); the second in
   the middle once the middle is the bot's; one barracks a step behind the line. The capital's
   rally point (DEC-48, item H) leads the recruits to the staging node behind the front: every
   unit walks to work without a command (principle 1).
10. **Stance**: Balance, an Economy window while the CP sit near their cap or ``ECON_EMPTY``
    units wait for a charge (principle 7: the charges the buildings took come back), War in
    bursts around a big strike; at least ``STANCE_DWELL`` ticks between changes.
11. **Recruit** while the army is below ``army_cap``, recharge, merge, station: an idle group in
    the rear walks to the front; with the CP about to burn, a fortification
    (``economy.fort_site``).

Human tempo: ONE command in a decision at most (never two in one tick), at most one every
``MIN_GAP`` ticks, and a budget of ``gap_base`` ticks a command on average (about 6 to 7 a
minute; the opening, the first ``OPENING_TICKS``, at ``OPENING_GAP``): the urgent steps (3 to 5)
may borrow half a command ahead. Plans that gathered for their time without the bonus are
cancelled (``economy.release_commands``).

Only the ``PlayerView``, the map and the ruleset; every tie through ``Bot.key`` (mirror-invariant);
integers only; the bot's own choices from ``Bot.rng``. It is a ``CampaignBot`` only for the enemy
estimate (``estimate``, ``sighted``, ``support``) and uses the helpers of the smart bots' defense
(``gow_bots.bots.defense``), never ``SmartBot`` itself.
"""

from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass
from typing import ClassVar, Final, override

from gow_bots.bots.assess import awards_left, vp_rates
from gow_bots.bots.base import ParamRange, node_of
from gow_bots.bots.campaign import CampaignBot, Ctx, figure_numbers
from gow_bots.bots.capital import home_eta, open_need, take_capital
from gow_bots.bots.defense import backed, held_shots, seen_near, strike_shots
from gow_bots.bots.economy import fort_site, release_commands
from gow_bots.bots.factories import FACTORY_PROFIT, factory_site, payback
from gow_bots.bots.forts import fortified
from gow_bots.bots.utility import shots_to_take, takes, terrain_burned
from gow_sim.commands import (
    BuildBarracks,
    BuildFactory,
    Command,
    FortifyRoad,
    GroupMove,
    Merge,
    Move,
    Recruit,
    SetRallyPoint,
    SetStance,
    Split,
)
from gow_sim.maps import MapDef, NodeKind
from gow_sim.ruleset import Ruleset, Stance
from gow_sim.view import AtNode, GroupView, PlayerView

__all__ = ["OwnerStyleBot"]

SQUAD: Final = 3
"""Units of a squad: the capacity of a province, so a squad fits every node and road."""
MARGIN: Final = 1
"""Shots beyond what a defended target needs that a strike must bring."""
RADIUS: Final = 4
"""Road hops of a strike at most."""
OPENING_TICKS: Final = 600
"""The opening burst: commands about every ``OPENING_GAP`` ticks."""
OPENING_GAP: Final = 45
MIN_GAP: Final = 20
"""Ticks between two commands at least (a hand moves from one group to the next)."""
CREDIT_CAP: Final = 3
"""Commands of ``gap_base`` ticks the tempo budget saves at most (a burst after a calm)."""
STANCE_DWELL: Final = 450
"""Ticks a stance stays at least (a human changes it a few times a match)."""
ECONOMY_ON_CP: Final = 400
"""CP in hundredths at which the bot goes to Economy: the CP would burn at the cap."""
ECONOMY_TICKS: Final = 600
"""Length of an Economy window."""
ECONOMY_REST: Final = 1500
"""Ticks after an Economy window before the next."""
STRIKE_WAR_TICKS: Final = 300
"""War after a big strike was ordered (its gathering and its march)."""
ASSAULT_SHOTS: Final = 18
"""Shots (charged units plus bonus) of the assault the bot waits for before the last 700 ticks."""
ASSAULT_LAST: Final = 700
"""Ticks before the end when the assault goes with whatever it has (the march takes time)."""
BIG_BONUS: Final = 3
"""A planned bonus of this size makes the strike a big one (War around it)."""
KEEP_CP: Final = 100
"""CP in hundredths a recruit or a station move leaves for a strike."""
COMBINE_MAX: Final = 4
"""Squads of one combined strike at most."""
SPARE_EMPTY: Final = 1
"""Units without a charge the army may have and the bot still recruits."""
RETAKE_TICKS: Final = 600
"""An own node the enemy took is retaken for this many ticks after the loss."""
HOME_ETA: Final = 450
"""Ticks within which an enemy could reach the own capital before it keeps a guard."""
HOME_NEAR: Final = 200
"""Ticks within which an enemy node makes the capital keep a guard with no force in sight."""
HOME_HOPS: Final = 3
"""Road hops around the own capital whose enemy forces count against it."""
PICKET: Final = 1
"""Units a held front node keeps (a charged unit makes a walk-in a fight, DEC-07)."""
HOLD: Final = 2
"""Units a held plains node keeps (one burns its charge in the first round, DEC-45)."""
HOLD_HIGH: Final = 3
"""Units a held front node keeps at most."""
THREAT_HIGH: Final = 4
"""Enemy shots in sight next to a held node that ask one unit more."""
HOLD_SHARE: Final = 50
"""Percent of the units outside the capital the line keeps at most."""
SHORTCUT: Final = 3
"""Own road hops a neutral province inside the territory must save to be taken (principle 5)."""
W_RETAKE: Final = 300
W_PREEMPT: Final = 150
W_HARVEST: Final = 20
W_PLAINS: Final = 30
"""Score per charge the terrain of a defended target burns (DEC-45: the plains first)."""
W_HEIGHT: Final = 25
"""Score of a mountain target per charge it gives its holder (a critical point)."""
W_DEPTH: Final = 6
"""Score per road a squad stands behind the front (checkers, principle 2), at most ``DEPTH_CAP``."""
DEPTH_CAP: Final = 3
ECON_EMPTY: Final = 4
"""Own units without a charge at which the bot opens an Economy window (twice the charges)."""
HOME_FORTS: Final = 3
"""Roads out of the own capital it fortifies at most while an enemy can reach it soon."""
FIRST_FACTORY_HOPS: Final = 2
"""The first factory goes in a city at most this many roads from the own capital."""


@dataclass(frozen=True, slots=True)
class Squad:
    """A free group of the bot and the part of it a strike sends."""

    group: GroupView
    here: int
    size: int
    """Units that go: at most ``SQUAD`` unless ``whole``."""
    charged: int
    """Charged units of that part."""
    prep: Split | None = None
    """The split that makes the part a group of its own first (none: the whole group goes)."""
    pinned: bool = False
    """The whole group is a garrison of the line: it goes only to retake a neighbour."""
    whole: bool = False
    """The whole free stack of more than ``SQUAD`` units: only a member of a combined strike."""

    @property
    def exact(self) -> bool:
        """The whole group goes: it can be a member of a ``GroupMove``."""
        return self.prep is None and self.size == self.group.units


@dataclass(frozen=True, slots=True)
class Option:
    """A way for one squad to a target."""

    squad: Squad
    dest: int
    hops: int
    need: int
    toll: int
    bonus: int
    ok: bool


class OwnerStyleBot(CampaignBot):
    """The owner-style benchmark (module docstring)."""

    name: ClassVar[str] = "owner_style"
    STANCE_POLICY: ClassVar[bool] = True
    DISCIPLINE: ClassVar[bool] = True
    CONTACT: ClassVar[bool] = True
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {
        "expand_end": ParamRange(900, 1800),  # ticks of moderate expansion (1.5 to 3 minutes)
        "assault_lead": ParamRange(1200, 2400),  # ticks before the end: the last 2 to 4 minutes
        "gap_base": ParamRange(80, 95),  # ticks a command on average after the opening
        "army_cap": ParamRange(15, 20),  # units the bot recruits up to
    }

    def __init__(self, mapdef: MapDef, rules: Ruleset, *, seed: int, player: int) -> None:
        super().__init__(mapdef, rules, seed=seed, player=player)
        self.last = -(10**6)
        """The tick of the last command."""
        self.credit = OPENING_GAP
        """The tempo budget in ticks (``CREDIT_CAP`` commands of ``gap_base`` at most)."""
        self.credit_tick = 0
        self.min_gap = MIN_GAP
        self.stance_at = 0
        self.stance_seen: Stance | None = None
        self.prev_owner: list[int | None] | None = None
        self.lost: dict[int, int] = {}
        """Own nodes the enemy took, to the tick it was seen: retaken at once."""
        self.answered: dict[int, int] = {}
        """Opaque intent id to the tick its strike was answered."""
        self.strike_until = -1
        self.assaulted = False
        self.barracks_tried = False
        self.economy_at = -(10**6)
        self.plan_since: dict[int, int] = {}
        self.first_factory = False
        self.rally_at = -(10**6)
        # The view of one decision ------------------------------------------------------------
        self.free: dict[int, int] = {}
        """Own idle group id to its units the line does not keep (this decision)."""
        self.hold: list[int] = []
        self.guard = 0
        self.here: list[int] = []
        """Own units standing in each node (this decision)."""
        self.neutral: dict[int, bool] = {}
        """``_neutral_ok`` of this decision by node."""

    @override
    def home_keep(self) -> int:
        return self.guard

    # The decision ----------------------------------------------------------------------------

    @override
    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        self.check_view(view)
        self._observe(view, tick)
        idle = self.idle_groups(view)
        self.here = self.standing(view)
        self.neutral = {}
        self.guard = self._home_guard(view, tick)
        self.hold = self._line(view)
        self.free = self._free_parts(view, idle)
        stuck = release_commands(self, view, self.plan_since, tick)
        take = take_capital(self, view, tick, idle, view.me.cp)
        if take.cmd is not None:
            return self._send(take.cmd, tick)
        if take.wait:
            return []
        if not self._may(tick, urgent=True):
            return []
        urgent = (
            lambda: self._fight(view, tick),
            lambda: self._home(view, tick, idle),
            lambda: self._strike(view, tick, idle, retake=True),
            lambda: self._answer(view, tick, idle),
        )
        for step in urgent:
            cmd = step()
            if cmd is not None and self.cost(cmd) <= view.me.cp:
                return self._send(cmd, tick)
        if not self._may(tick, urgent=False):
            return []
        steps = (
            lambda: stuck[0] if stuck else None,
            lambda: self._assault(view, tick, idle),
            lambda: self._strike(view, tick, idle),
            lambda: self._build(view, tick),
            lambda: self._fill(view, idle),
            lambda: self._fort(view),
            lambda: self._pay(view, idle),
            lambda: self._recharge(view, idle),
            lambda: self._merge(view, idle),
            lambda: self._stance(view, tick),
            lambda: self._enlist(view),
            lambda: self._set_rally(view, tick),
            lambda: self._station(view, idle),
        )
        for step in steps:
            cmd = step()
            if cmd is not None and self.allowed(cmd) and self.cost(cmd) <= view.me.cp:
                return self._send(cmd, tick)
        return []

    def _gap(self, tick: int) -> int:
        return OPENING_GAP if tick < OPENING_TICKS else self.params["gap_base"]

    def _may(self, tick: int, *, urgent: bool) -> bool:
        """The tempo allows a command now (module docstring)."""
        cap = CREDIT_CAP * self._gap(tick)
        self.credit = min(cap, self.credit + tick - self.credit_tick)
        self.credit_tick = tick
        if tick - self.last < self.min_gap:
            return False
        gap = self._gap(tick)
        return self.credit >= (gap // 2 if urgent else gap)

    def _send(self, cmd: Command, tick: int) -> list[Command]:
        """The one command of this decision."""
        self._may(tick, urgent=True)  # brings the budget to this tick
        self.last = tick
        gap = self._gap(tick)
        quick = isinstance(cmd, Split | Merge | SetStance | SetRallyPoint)
        self.credit -= gap // 2 if quick else gap
        self.min_gap = MIN_GAP + self.rng.randrange(0, 16)
        return [cmd]

    def _observe(self, view: PlayerView, tick: int) -> None:
        me = view.player
        owners = [n.owner for n in view.nodes]
        if self.prev_owner is not None:
            for node, (was, now) in enumerate(zip(self.prev_owner, owners, strict=True)):
                if was == me and now == 1 - me:
                    self.lost[node] = tick
        self.prev_owner = owners
        self.lost = {
            node: t
            for node, t in sorted(self.lost.items())
            if owners[node] != me and tick - t < RETAKE_TICKS
        }
        self.answered = {i: t for i, t in sorted(self.answered.items()) if tick - t < RETAKE_TICKS}
        if view.me.stance is not self.stance_seen:
            self.stance_seen = view.me.stance
            self.stance_at = tick
        self.factory_sites.observe(view, self.rules.factory.cost)
        self.observe_barracks(view)

    # The own capital and the line ---------------------------------------------------------------

    def _home_threat(self, view: PlayerView, tick: int) -> int:
        """Enemy shots in sight within ``HOME_HOPS`` of the own capital: fresh sightings
        (``CampaignBot.sighted``), figures on the roads, visible strikes at the capital."""
        home = self.home
        near = self.hops[home]
        shots = 0
        for n in view.nodes:
            if 0 < near[n.id] <= HOME_HOPS:
                numbers = self.sighted(view, tick, n.id)
                if numbers is not None:
                    shots += numbers[1]
        for e in view.edges:
            edge = self.map.edges[e.id]
            for f in e.enemy_groups:
                to = edge.b if f.toward_b else edge.a
                if 0 <= near[to] <= HOME_HOPS - 1:
                    shots += figure_numbers(f)[1]
        for i in view.intents:
            if i.owner != view.player and i.target == home:
                shots = max(shots, strike_shots(self, view, i.origin, tick))
        return shots

    def _home_guard(self, view: PlayerView, tick: int) -> int:
        """Units the own capital keeps (item 3): none while no enemy can reach it within
        ``HOME_ETA``; else those that outgun the threat, at least one."""
        home = self.home
        if view.nodes[home].owner != view.player:
            return 0
        eta = home_eta(self, view)
        if eta > HOME_ETA:
            return 0
        threat = self._home_threat(view, tick)
        if threat == 0 and eta > HOME_NEAR:
            return 0
        terrain = self.map.nodes[home].terrain
        cap = view.nodes[home].capacity
        guard = 1
        while guard < cap and shots_to_take(self.rules, terrain, guard, guard) <= threat:
            guard += 1
        return guard

    def _line(self, view: PlayerView) -> list[int]:
        """Units each own node keeps (item 8; the capital: ``guard``)."""
        me, enemy = view.player, 1 - view.player
        count = len(view.nodes)
        hold = [0] * count
        hold[self.home] = self.guard
        units = sum(g.units for g in view.groups)
        budget = max(0, units - self.guard) * HOLD_SHARE // 100
        charged = [0] * count
        for g in view.groups:
            if isinstance(g.location, AtNode):
                charged[g.location.node] += g.charged
        mod = self.rules.terrain.defense_mod
        ranked: list[tuple[int, int, int, int]] = []
        for n in view.nodes:
            node = n.id
            if n.owner != me or node == self.home or n.flow_pocket:
                continue
            own = foe = 0
            for m in self.neighbors[node]:
                owner = view.nodes[m].owner
                own += owner == me
                foe += owner == enemy
            if foe == 0:
                continue
            vp = self.map.nodes[node].vp
            height = mod.of(self.map.nodes[node].terrain)
            built = bool(n.factory) or bool(n.has_barracks)
            if not (vp > 0 or height > 0 or built):
                continue  # a province of the plains or the forest: not a critical point
            if own <= 1 and foe >= 2 and not built and height <= 0:
                continue  # a salient
            if height < 0 and not built and not backed(self, view, node, charged):
                continue  # the plains with no counter-attack behind: not held thinly
            seen = seen_near(self, view, node)
            worth = 3 * vp + (n.warehouse or 0) + (3 if built else 0) + 3 * max(0, height) + seen
            ranked.append((-worth, -seen, self.key(node), node))
        ranked.sort()
        for _, seen, _, node in ranked:
            want = HOLD if mod.of(self.map.nodes[node].terrain) < 0 else PICKET
            if -seen >= THREAT_HIGH:
                want += 1
            want = min(want, HOLD_HIGH, budget)
            if want < 1:
                break
            hold[node] = want
            budget -= want
        return hold

    def _free_parts(self, view: PlayerView, idle: list[GroupView]) -> dict[int, int]:
        """Own idle group id to the units the line does not keep: the most charged groups of a
        node keep its garrison first."""
        left = list(self.hold)
        free: dict[int, int] = {}
        for g in sorted(idle, key=lambda g: (-g.charged, -g.units, self._group_key(g))):
            here = node_of(g)
            kept = min(g.units, left[here])
            left[here] -= kept
            free[g.id] = g.units - kept
        return free

    def _home(self, view: PlayerView, tick: int, idle: list[GroupView]) -> Command | None:
        """Item 3: the capital short of its guard recruits, and the nearest free charged group
        that arrives before the enemy walks home."""
        if self.guard == 0:
            return None
        home = self.home
        standing = self.standing(view)
        coming = sum(g.units for g in view.groups if g.order is not None and g.order.dest == home)
        queued = view.nodes[home].recruit_queue or 0
        if standing[home] + coming + queued >= self.guard:
            return None
        if self.can_queue(view, home, standing[home]) and view.me.cp >= self.cost(Recruit(home)):
            return Recruit(home)
        eta = home_eta(self, view)
        best: tuple[int, int, GroupView] | None = None
        for g in idle:
            here = node_of(g)
            if here == home or g.charged < 1 or self.free.get(g.id, 0) < g.units:
                continue
            way = self.ways(view, here, g.units).get(home)
            if way is None or way.ticks >= eta + 100:
                continue
            rank = (way.ticks, self.key(here), g)
            if best is None or rank[:2] < best[:2]:
                best = rank
        return None if best is None else Move(best[2].id, home)

    def _answer(self, view: PlayerView, tick: int, idle: list[GroupView]) -> Command | None:
        """Item 5: a visible enemy strike at an own node (not the capital: item 3)."""
        me = view.player
        per = self.rules.orders.plan_ticks_per_bonus
        ctx: Ctx | None = None
        for i in sorted(
            view.intents,
            key=lambda i: (i.created_tick, self.key(i.origin), self.key(i.target or i.origin)),
        ):
            target = i.target
            if (
                i.owner == me
                or target is None
                or target == self.home
                or i.id in self.answered
                or view.nodes[target].owner != me
            ):
                continue
            if ctx is None:
                ctx = Ctx(view, tick, view.me.cp)
            shots = strike_shots(self, view, i.origin, tick)
            if held_shots(self, ctx, target, 0, 0) > shots:
                self.answered[i.id] = tick
                continue
            gather = (shots // 2) * per - (tick - i.created_tick)
            within = gather + self._road_ticks(i.origin, target)
            room = view.nodes[target].capacity - self.standing(view)[target]
            best: tuple[int, int, GroupView] | None = None
            for g in idle:
                here = node_of(g)
                if here == target or g.charged < 1 or self.free.get(g.id, 0) < g.units:
                    continue
                way = self.ways(view, here, g.units).get(target)
                if way is None or way.ticks > within or g.units > room:
                    continue
                if held_shots(self, ctx, target, g.units, g.charged) <= shots:
                    continue
                rank = (way.ticks, self.key(here), g)
                if best is None or rank[:2] < best[:2]:
                    best = rank
            self.answered[i.id] = tick
            if best is not None:
                return Move(best[2].id, target)
            out = self._pull_out(view, ctx, target, shots, idle)
            if out is not None:
                return out
        return None

    def _road_ticks(self, a: int, b: int) -> int:
        """Ticks of the road between neighbours ``a`` and ``b`` into ``b``; 200 when they are not
        neighbours."""
        for eid in self.incident[b]:
            if self.map.edges[eid].other(b) == a:
                return self.times.ticks(eid, b)
        return 200

    def _pull_out(
        self, view: PlayerView, ctx: Ctx, target: int, shots: int, idle: list[GroupView]
    ) -> Command | None:
        """A garrison the strike kills whole walks to its safest own neighbour."""
        groups = [g for g in idle if node_of(g) == target]
        if not groups:
            return None
        units = sum(g.units for g in groups)
        if shots < held_shots(self, ctx, target, 0, 0) + units:
            return None
        fights = self.fight_nodes(view)
        exits = [
            m
            for m in self.neighbors[target]
            if view.nodes[m].owner == view.player and m not in fights
        ]
        if not exits:
            return None
        home = self.hops[self.home]
        dest = min(exits, key=lambda m: (seen_near(self, view, m), home[m], self.key(m)))
        return Move(min(groups, key=self._group_key).id, dest)

    # Fights and the assault --------------------------------------------------------------------

    def _fight(self, view: PlayerView, tick: int) -> Command | None:
        cmds = self.fight_commands(view, tick, view.me.cp)
        return cmds[0] if cmds else None

    def _ahead(self, view: PlayerView, tick: int) -> bool:
        """Ahead on the VP forecast: the VP now plus the rate of the cities held times the
        awards left."""
        rates = vp_rates(view, self.map, self.rules)
        left = awards_left(self.rules, tick)
        me = view.player
        return view.vp[me] + rates[me] * left > view.vp[1 - me] + rates[1 - me] * left

    def _assault(self, view: PlayerView, tick: int, idle: list[GroupView]) -> Command | None:
        """The one synchronized ``GroupMove`` at the enemy capital in the last minutes."""
        go = self.rules.group_order
        start = self.rules.match_ticks - self.params["assault_lead"]
        if go is None or self.assaulted or tick < start:
            return None
        target = self.enemy_home
        members: list[GroupView] = []
        for g in idle:
            here = node_of(g)
            if g.charged < 1 or here == target or self.free.get(g.id, 0) < g.units:
                continue
            fit = self.fit(view, here, target, g.units)
            if fit < 1:
                continue
            if fit < g.units:
                return Split(g.id, fit)  # a planned member is never split by the simulation
            members.append(g)
        affordable = view.me.cp // self.cost(GroupMove((0,), target, planned=True, bonus=1))
        members.sort(key=lambda g: (-g.charged, self._group_key(g)))
        chosen = members[: min(affordable, go.max_groups)]
        if not chosen:
            return None
        bonus = self._bonus(view, chosen)
        shots = sum(g.charged for g in chosen) + bonus
        need = open_need(self, view, tick)
        if self._ahead(view, tick) and (need is None or shots < need + MARGIN + 1):
            return None  # the clock wins: no army thrown at a capital it does not take
        late = tick >= self.rules.match_ticks - ASSAULT_LAST
        if shots < ASSAULT_SHOTS and not (late and shots >= 2 * SQUAD):
            return None
        self.assaulted = True
        self.strike_until = tick + STRIKE_WAR_TICKS
        return GroupMove(tuple(g.id for g in chosen), target, planned=bonus >= 1, bonus=bonus)

    def _bonus(self, view: PlayerView, groups: list[GroupView]) -> int:
        """The bonus a group order asks for: per node of its members ``_full_bonus`` of their
        charged units there (each member gathers its part in its own node, DEC-48, item F2)."""
        charged: dict[int, int] = {}
        for g in groups:
            node = node_of(g)
            charged[node] = charged.get(node, 0) + g.charged
        main = self.supplied(view)
        return sum(self._full_bonus(view, node, c, main) for node, c in charged.items())

    # The strike package ------------------------------------------------------------------------

    def _squads(self, view: PlayerView, idle: list[GroupView]) -> list[Squad]:
        squads: list[Squad] = []
        cost = self.rules.capture.charge_cost
        for g in idle:
            here = node_of(g)
            free = self.free.get(g.id, g.units)
            kept = g.units - free
            if free == 0:
                if g.charged >= max(cost, 1):  # a garrison: only a retake next to it
                    squads.append(Squad(g, here, g.units, g.charged, pinned=True))
                continue
            if kept > 0:
                # the garrison splits off first (the charged go first, DEC-20 B1)
                charged = max(0, g.charged - kept)
                if charged >= max(cost, 1):
                    squads.append(Squad(g, here, free, charged, prep=Split(g.id, kept)))
                continue
            if g.charged < max(cost, 1):
                continue
            size = min(SQUAD, g.units)
            if size < g.units:
                squads.append(Squad(g, here, size, min(size, g.charged), prep=Split(g.id, size)))
                squads.append(Squad(g, here, g.units, g.charged, whole=True))
            else:
                squads.append(Squad(g, here, size, g.charged))
        return squads

    def _merge(self, view: PlayerView, idle: list[GroupView]) -> Command | None:
        """One ``Merge`` of the groups below a squad that idle in one node (scattered figures
        become squads; merging is free)."""
        by_node: dict[int, list[GroupView]] = {}
        for g in idle:
            if g.units >= SQUAD:
                continue
            by_node.setdefault(node_of(g), []).append(g)
        for node in sorted(by_node, key=self.key):
            groups = by_node[node]
            units = sum(g.units for g in groups)
            if len(groups) >= 2 and units <= view.nodes[node].capacity:
                return Merge(tuple(g.id for g in groups))
        return None

    def _depth(self, view: PlayerView, node: int) -> int:
        """Roads from an own node to the front (``NodeView.front_dist``), at most ``DEPTH_CAP``."""
        d = view.nodes[node].front_dist
        return 0 if d is None else min(max(0, d), DEPTH_CAP)

    def _own_dist(self, view: PlayerView, start: int, skip: int) -> list[int]:
        """Road hops from ``start`` over own nodes only, ``skip`` included as own (-1: none)."""
        me = view.player
        dist = [-1] * len(view.nodes)
        dist[start] = 0
        queue = deque([start])
        while queue:
            node = queue.popleft()
            for m in self.neighbors[node]:
                if dist[m] < 0 and (view.nodes[m].owner == me or m == skip):
                    dist[m] = dist[node] + 1
                    queue.append(m)
        return dist

    def _neutral_ok(self, view: PlayerView, tick: int, dest: int) -> bool:
        """Principles 3 to 5: a neutral city or mountain; a province as a gateway (the opening)
        or a shortcut (inside the territory); a plains province with a counter-attack behind."""
        node = self.map.nodes[dest]
        height = self.rules.terrain.defense_mod.of(node.terrain)
        if node.kind is not NodeKind.PROVINCE or height > 0:
            return True
        me, enemy = view.player, 1 - view.player
        if height < 0 and not any(
            view.nodes[m].owner == me and self.here[m] >= HOLD for m in self.neighbors[dest]
        ):
            return False  # the plains: only with a counter-attack ready next to it
        own = [m for m in self.neighbors[dest] if view.nodes[m].owner == me]
        if tick < self.params["expand_end"]:
            for k in self.neighbors[dest]:
                kn = self.map.nodes[k]
                height = self.rules.terrain.defense_mod.of(kn.terrain)
                key = kn.kind is not NodeKind.PROVINCE or height > 0
                if (
                    key
                    and view.nodes[k].owner != me
                    and k != self.enemy_home
                    and not any(view.nodes[j].owner == me for j in self.neighbors[k])
                ):
                    return True  # the gateway to a city or a mountain
        if len(own) >= 2 and not any(view.nodes[m].owner == enemy for m in self.neighbors[dest]):
            dist = self._own_dist(view, own[0], -1)
            for m in own[1:]:
                if dist[m] < 0 or dist[m] >= 2 + SHORTCUT:
                    return True  # a shortcut of the own roads
        return False

    def _full_bonus(self, view: PlayerView, here: int, charged: int, main: list[bool]) -> int:
        """The bonus a squad asks for at a defended target: its charged units when its node
        holds a charge and is supplied (the flow refills it while it gathers), else the stock."""
        stock = view.nodes[here].warehouse or 0
        if stock < 1:
            return 0
        if main[here]:
            return charged
        return min(charged, stock)

    def _options(self, view: PlayerView, tick: int, squads: list[Squad]) -> list[Option]:
        rules = self.rules
        me = view.player
        targeted = {g.order.dest for g in view.groups if g.order is not None}
        fights = self.fight_nodes(view)
        main = self.supplied(view)
        options: list[Option] = []
        for sq in squads:
            for dest, way in sorted(
                self.ways(view, sq.here, sq.size).items(), key=lambda kv: self.key(kv[0])
            ):
                n = view.nodes[dest]
                if (
                    dest == sq.here
                    or dest == self.enemy_home
                    or not 0 < way.hops <= RADIUS
                    or n.owner == me
                    or dest in targeted
                    or dest in fights
                ):
                    continue
                if sq.pinned and (dest not in self.lost or way.hops > 1):
                    continue
                if (
                    sq.size < 2
                    and n.owner is not None
                    and dest not in self.lost
                    and self.estimate(view, tick, dest)[0] > 0
                ):
                    continue  # a single unit only walks in (a strike is two units at least)
                if n.owner is None:
                    ok = self.neutral.get(dest)
                    if ok is None:
                        ok = self.neutral[dest] = self._neutral_ok(view, tick, dest)
                    if not ok:
                        continue
                need = 0
                if n.owner is not None:
                    units, charged = self.estimate(view, tick, dest)
                    if units > 0:
                        burned = terrain_burned(rules, view, dest)
                        need = shots_to_take(
                            rules, self.map.nodes[dest].terrain, units, charged, burned=burned
                        )
                need += self.support(view, tick, dest, need)
                toll = self.toll_from(view, sq.here, dest, sq.size, sq.charged)
                bonus = self._full_bonus(view, sq.here, sq.charged, main) if need > 0 else 0
                margin = MARGIN if need > 0 else 0
                ok = takes(rules, sq.charged, bonus, need + margin, toll)
                options.append(Option(sq, dest, way.hops, need, toll, bonus, ok))
        return options

    def _score(self, view: PlayerView, o: Option) -> int:
        node = self.map.nodes[o.dest]
        height = self.rules.terrain.defense_mod.of(node.terrain)
        depth = self._depth(view, o.squad.here)
        if view.nodes[o.dest].owner is None:
            base = 25 if node.kind is NodeKind.PROVINCE else 60 + 30 * node.vp
            return base + W_HEIGHT * max(0, height) + W_DEPTH * depth - 8 * o.hops
        deep = self.hops[self.enemy_home][o.dest]
        score = 160 + 40 * node.vp - 5 * deep - 8 * o.hops - 5 * o.need
        if o.need == 0:
            score += W_HARVEST + W_HEIGHT * max(0, height)
        else:
            score -= W_PLAINS * height  # plains first, mountains last
        if o.dest in self.lost:
            score += W_RETAKE
        if any(
            i.owner != view.player and i.origin == o.dest and i.target is not None
            for i in view.intents
        ):
            score += W_PREEMPT
        return score

    def _strike(
        self, view: PlayerView, tick: int, idle: list[GroupView], *, retake: bool = False
    ) -> Command | None:
        if self.assaulted and tick >= self.rules.match_ticks - 300:
            return None
        if retake and not self.lost:
            return None
        squads = self._squads(view, idle)
        if not squads:
            return None
        options = self._options(view, tick, squads)
        if retake:
            options = [o for o in options if o.dest in self.lost]
        good = [o for o in options if o.ok and not o.squad.whole and not self._clash(view, o)]
        best = min(
            good,
            key=lambda o: (-self._score(view, o), self.key(o.dest), self._group_key(o.squad.group)),
            default=None,
        )
        combo = self._combine(view, options)
        if combo is not None and (best is None or best.need == 0):
            return combo
        if best is None:
            return None
        sq = best.squad
        if self.cost(Move(sq.group.id, best.dest)) > view.me.cp:
            return None
        if sq.prep is not None:
            return sq.prep
        if best.need > 0 and best.bonus >= 1:
            if best.bonus >= BIG_BONUS:
                self.strike_until = tick + STRIKE_WAR_TICKS
            return self.order(sq.group.id, best.dest, True, best.bonus)
        return Move(sq.group.id, best.dest)

    def _clash(self, view: PlayerView, o: Option) -> bool:
        """A planned order from a node where another own group gathers a plan (#899)."""
        return o.need > 0 and o.bonus >= 1 and self.plans_in(view, o.squad.here, o.squad.group.id)

    def _combine(self, view: PlayerView, options: list[Option]) -> Command | None:
        """One ``GroupMove`` of exact squads that take together a target no single squad takes."""
        rules = self.rules
        by_dest: dict[int, list[Option]] = {}
        for o in options:
            if o.need > 0 and o.squad.exact and not o.squad.pinned and not o.ok:
                by_dest.setdefault(o.dest, []).append(o)
        go = rules.group_order
        if go is None:
            return None
        for dest in sorted(by_dest, key=lambda d: (-self._score(view, by_dest[d][0]), self.key(d))):
            pool = sorted(
                by_dest[dest],
                key=lambda o: (-(o.squad.charged + o.bonus), self._group_key(o.squad.group)),
            )
            for count in range(2, min(COMBINE_MAX, len(pool), go.max_groups) + 1):
                part = pool[:count]
                groups = [o.squad.group for o in part]
                bonus = self._bonus(view, groups)
                charged = sum(o.squad.charged for o in part)
                toll = sum(o.toll for o in part)
                if takes(rules, charged, bonus, part[0].need + MARGIN, toll):
                    cmd = GroupMove(
                        tuple(g.id for g in groups), dest, planned=bonus >= 1, bonus=bonus
                    )
                    if self.cost(cmd) > view.me.cp:
                        return None
                    self.strike_until = view.tick + STRIKE_WAR_TICKS
                    return cmd
        return None

    # Production, stance and the army -------------------------------------------------------------

    def _first_site(self, view: PlayerView) -> int | None:
        """Item 9: an own city at most ``FIRST_FACTORY_HOPS`` roads from the own capital, on the
        axis to the enemy capital (the fewest hops through it), no enemy next to it."""
        me = view.player
        best: tuple[int, int, int] | None = None
        site: int | None = None
        for n in view.nodes:
            node = n.id
            if (
                n.owner != me
                or node == self.home
                or n.factory
                or n.factory_build is not None
                or self.map.nodes[node].kind is NodeKind.PROVINCE
                or node in self.factory_sites.lost
                or not 0 < self.hops[self.home][node] <= FIRST_FACTORY_HOPS
                or any(view.nodes[m].owner == 1 - me for m in self.neighbors[node])
            ):
                continue
            rank = (
                self.hops[self.home][node] + self.hops[self.enemy_home][node],
                self.hops[self.home][node],
                self.key(node),
            )
            if best is None or rank < best:
                best, site = rank, node
        return site

    def _build(self, view: PlayerView, tick: int) -> Command | None:
        rules = self.rules
        me = view.player
        factories = sum(1 for n in view.nodes if n.owner == me and (n.factory or n.factory_build))
        building = any(n.owner == me and n.factory_build is not None for n in view.nodes)
        if factories < min(2, rules.factory.max) and not building:
            site = self._first_site(view) if not self.first_factory else None
            if site is None and (self.first_factory or tick >= OPENING_TICKS):
                site = factory_site(self, view, 1, self.factory_sites, self.supplied(view))
            if site is not None:
                self.first_factory = True
                return BuildFactory(site)
        elif factories < rules.factory.max and not building and tick >= self.params["expand_end"]:
            middle = self._middle_site(view, tick)
            if middle is not None:
                return BuildFactory(middle)
        forward = self._forward_barracks(view)
        if forward is None and not self.barracks_tried and tick >= self.params["expand_end"]:
            site = self._barracks_site(view)
            if site is not None:
                self.barracks_tried = True  # three charges, lost with the city: once a match
                return BuildBarracks(site)
        return None

    def _middle_site(self, view: PlayerView, tick: int) -> int | None:
        """An own city in the middle of the map (as near the enemy capital as the own one) that no
        enemy node touches: the second factory once the middle is secured."""
        rules = self.rules
        me = view.player
        if payback(rules, view) < rules.factory.cost + FACTORY_PROFIT:
            return None
        fights = self.fight_nodes(view)
        best: tuple[int, int] | None = None
        site: int | None = None
        for n in view.nodes:
            node = n.id
            if (
                n.owner != me
                or n.has_barracks is None
                or n.factory
                or n.factory_build is not None
                or n.building is not None
                or node == self.home
                or node in fights
                or node in self.factory_sites.lost
                or self.map.nodes[node].kind is NodeKind.PROVINCE
                or any(view.nodes[m].owner == 1 - me for m in self.neighbors[node])
            ):
                continue
            off = abs(self.hops[self.home][node] - self.hops[self.enemy_home][node])
            if off > 1 and tick < 2 * self.params["expand_end"]:
                continue  # the middle first; any safe city once the middle is not to be had
            rank = (off, self.key(node))
            if best is None or rank < best:
                best, site = rank, node
        return site

    def _forward_barracks(self, view: PlayerView) -> int | None:
        """An own barracks outside the capital, built or being built."""
        me = view.player
        for n in sorted(view.nodes, key=lambda n: self.key(n.id)):
            if n.owner == me and n.id != self.home and (n.has_barracks or n.building is not None):
                return n.id
        return None

    def _barracks_site(self, view: PlayerView) -> int | None:
        """An own city one step behind the held line (no enemy neighbour, next to a node that has
        one), the nearest to the enemy capital."""
        me = view.player
        fights = self.fight_nodes(view)
        far = self.hops[self.enemy_home]
        best: tuple[int, int] | None = None
        site: int | None = None
        for n in view.nodes:
            node = n.id
            if (
                n.owner != me
                or n.has_barracks is not False
                or n.building is not None
                or node in fights
                or node in self.barracks_lost
                or self.front(view, node)
                or not any(
                    view.nodes[m].owner == me and self.front(view, m) for m in self.neighbors[node]
                )
            ):
                continue
            rank = (far[node], self.key(node))
            if best is None or rank < best:
                best, site = rank, node
        return site

    def _staging(self, view: PlayerView) -> int | None:
        """The own node off the front next to a front node, nearest the enemy capital, that holds
        a charge or gets them (a supplied node): where the recruits gather."""
        me = view.player
        main = self.supplied(view)
        fights = self.fight_nodes(view)
        far = self.hops[self.enemy_home]
        best: tuple[int, int] | None = None
        site: int | None = None
        for n in view.nodes:
            node = n.id
            if (
                n.owner != me
                or not main[node]
                or node in fights
                or self.front(view, node)
                or not any(
                    view.nodes[m].owner == me and self.front(view, m) for m in self.neighbors[node]
                )
            ):
                continue
            rank = (far[node], self.key(node))
            if best is None or rank < best:
                best, site = rank, node
        return site

    def _set_rally(self, view: PlayerView, tick: int) -> Command | None:
        """Item 9: the recruits of the capital (and of a forward barracks) walk to the staging
        node; the point moves when it is no longer good, not more often than every 600 ticks."""
        if not self.rules.recruit.rally_point or tick - self.rally_at < 600:
            return None
        target = self._forward_barracks(view)
        if target is None or not view.nodes[target].has_barracks:
            target = self._staging(view)
        if target is None or target == self.home:
            return None
        if view.nodes[self.home].rally_point == target:
            return None
        self.rally_at = tick
        return SetRallyPoint(self.home, target)

    def _stance(self, view: PlayerView, tick: int) -> Command | None:
        """Balance; War around a big strike; a short Economy window (``ECONOMY_TICKS``) when the
        CP sit near their cap, since the charges bind a squad army, not the CP, and not again
        within ``ECONOMY_REST`` ticks; a change waits ``STANCE_DWELL``."""
        p = self.params
        now = view.me.stance
        assault = self.rules.match_ticks - p["assault_lead"]
        if tick < self.strike_until or assault - 200 <= tick < assault + 400:
            want = Stance.WAR
        elif (now is Stance.ECONOMY and tick - self.economy_at < ECONOMY_TICKS) or (
            tick >= OPENING_TICKS
            and (view.me.cp >= ECONOMY_ON_CP or self._empty(view) >= ECON_EMPTY)
            and tick - self.economy_at >= ECONOMY_TICKS + ECONOMY_REST
        ):
            want = Stance.ECONOMY
        else:
            want = Stance.BALANCE
        if want is now or tick - self.stance_at < STANCE_DWELL:
            return None
        if want is Stance.ECONOMY:
            self.economy_at = tick
        return SetStance(want)

    def _empty(self, view: PlayerView) -> int:
        """Own units without a charge."""
        return sum(g.units - g.charged for g in view.groups)

    def _fort(self, view: PlayerView) -> Command | None:
        """Item 3: while an enemy can reach the own capital soon (a guard is kept), the roads
        out of it toward the nearest enemy node get a fortification (DEC-43, item D: a toll on
        every enemy crossing toward the capital), at most ``HOME_FORTS``; else, with the CP
        about to burn, ``economy.fort_site``."""
        rules = self.rules
        if view.me.cp < rules.fort.cost + KEEP_CP:
            return None
        home = self.home
        if self.guard > 0:
            built = 0
            options: list[tuple[int, int, int]] = []
            enemy = [n.id for n in view.nodes if n.owner == 1 - view.player]
            for eid in self.incident[home]:
                if fortified(view, home, eid):
                    built += 1
                    continue
                other = self.map.edges[eid].other(home)
                near = min((self.hops[other][e] for e in enemy), default=99)
                options.append((near, self.edge_keys[eid], eid))
            if options and built < HOME_FORTS:
                return FortifyRoad(home, min(options)[2])
        site = fort_site(self, view, view.me.cp)
        return None if site is None else FortifyRoad(*site)

    def _enlist(self, view: PlayerView) -> Command | None:
        units = sum(g.units for g in view.groups)
        empty = self._empty(view)
        if empty > SPARE_EMPTY:
            return None  # a unit without a charge is defenseless: the charges come first
        queued = sum(n.recruit_queue or 0 for n in view.nodes if n.owner == view.player)
        price = self.cost(Recruit(0)) + KEEP_CP
        if units + queued >= self.params["army_cap"] or view.me.cp < price:
            return None
        standing = self.standing(view)
        far = self.hops[self.enemy_home]
        cities = [
            n.id
            for n in view.nodes
            if self.can_queue(view, n.id, standing[n.id]) and not self.front(view, n.id)
        ]
        if not cities:
            return None
        return Recruit(min(cities, key=lambda c: (far[c], self.key(c))))

    def _recharge(self, view: PlayerView, idle: list[GroupView]) -> Command | None:
        """A group without charges stands in a node without stock: it walks to the nearest own
        node whose warehouse holds charges (units recharge only from the warehouse they stand
        in, ``supply.recharge_per_tick``). Costs a move, so only when the CP allow it."""
        if view.me.cp < self.cost(Move(0, 0)) + KEEP_CP:
            return None
        standing = self.standing(view)
        best: tuple[int, int, int, int, Move] | None = None
        for g in idle:
            here = node_of(g)
            if g.charged >= g.units or (view.nodes[here].warehouse or 0) > 0:
                continue
            if self.free.get(g.id, g.units) < g.units:
                continue
            for d in self.reachable(view, here, RADIUS, g.units):
                n = view.nodes[d]
                stock = n.warehouse or 0
                if n.owner != view.player or stock < 1 or standing[d] + g.units > n.capacity:
                    continue
                rank = (self.ways(view, here, g.units)[d].ticks, -stock, self.key(d), g.id)
                if best is None or rank < best[:4]:
                    best = (*rank, Move(g.id, d))
        return None if best is None else best[4]

    def _fill(self, view: PlayerView, idle: list[GroupView]) -> Command | None:
        """Item 8: a held node without its garrison (standing and on the way) gets the nearest
        free charged group that fits it and does not leave a bigger hole."""
        if view.me.cp < self.cost(Move(0, 0)):
            return None
        standing = self.standing(view)
        coming = [0] * len(view.nodes)
        charged = [0] * len(view.nodes)
        for g in view.groups:
            if g.order is not None and view.nodes[g.order.dest].owner == view.player:
                coming[g.order.dest] += g.units
                charged[g.order.dest] += g.charged
            elif isinstance(g.location, AtNode):
                charged[g.location.node] += g.charged
        holes = [
            n
            for n in range(len(view.nodes))
            if self.hold[n] > 0 and n != self.home and charged[n] < self.hold[n]
        ]
        if not holes:
            return None
        best: tuple[int, int, int, Move] | None = None
        for g in idle:
            here = node_of(g)
            if g.charged < 1 or self.free.get(g.id, 0) < g.units or self.hold[here] > 0:
                continue
            for node in holes:
                way = self.ways(view, here, g.units).get(node)
                room = view.nodes[node].capacity - standing[node] - coming[node]
                if way is None or not 0 < way.hops <= RADIUS or g.units > room:
                    continue
                rank = (way.ticks, self.key(node), self.key(here))
                if best is None or rank < best[:3]:
                    best = (*rank, Move(g.id, node))
        return None if best is None else best[3]

    def _pay(self, view: PlayerView, idle: list[GroupView]) -> Command | None:
        """Item 9: an own factory build that still owes charges and has no own group standing in
        it gets the nearest free charged group of the rear (the progressive payment takes the
        charges of the groups standing there, DEC-41 item 7)."""
        me = view.player
        standing = self.standing(view)
        sites = [
            n.id
            for n in view.nodes
            if n.owner == me
            and n.factory_build is not None
            and n.factory_build.owed > (n.warehouse or 0)
            and standing[n.id] == 0
        ]
        if not sites or view.me.cp < self.cost(Move(0, 0)) + KEEP_CP:
            return None
        best: tuple[int, int, Move] | None = None
        for g in idle:
            here = node_of(g)
            if g.charged < 2 or self.free.get(g.id, 0) < g.units or self.front(view, here):
                continue
            for site in sites:
                way = self.ways(view, here, g.units).get(site)
                if way is None or not 0 < way.hops <= 2:
                    continue
                rank = (way.ticks, self.key(site))
                if best is None or rank < best[:2]:
                    best = (*rank, Move(g.id, site))
        return None if best is None else best[2]

    def _station(self, view: PlayerView, idle: list[GroupView]) -> Command | None:
        """An idle free group in the rear walks to an own front node nobody holds, else to the
        own node one step behind the front nearest the enemy capital."""
        if view.me.cp < self.cost(Move(0, 0)) + KEEP_CP:
            return None
        far = self.hops[self.enemy_home]
        standing = self.standing(view)
        me = view.player
        for g in idle:
            here = node_of(g)
            if g.charged < 1 or g.units < 2 or self.front(view, here):
                continue
            if self.free.get(g.id, 0) < g.units:
                continue
            spots = [
                d
                for d in self.reachable(view, here, RADIUS, g.units)
                if view.nodes[d].owner == me
                and far[d] < far[here]
                and standing[d] + g.units <= view.nodes[d].capacity
            ]
            open_front = [d for d in spots if standing[d] == 0 and self.front(view, d)]
            second = [
                d
                for d in spots
                if not self.front(view, d)
                and any(
                    view.nodes[m].owner == me and self.front(view, m) for m in self.neighbors[d]
                )
            ]
            pool = open_front or second
            if pool:
                return Move(g.id, min(pool, key=lambda d: (far[d], self.key(d))))
        return None
