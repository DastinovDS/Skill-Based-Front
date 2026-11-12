"""``owner_style``: a fixed benchmark that scripts the recipe of the owner's 5 wins of 2026-11-12.

The owner beat ``smart_strangler@hard`` 5:0 with one repeatable recipe (the analysis of the five
replays): let the bot win the land race, then harvest its thin network with 3-unit squads that
ask for the full planned bonus, and finish with one big synchronized assault on the capital. This
bot plays that recipe from the ``PlayerView`` alone, as a fixed opponent for the gates of the bot
plan (a human does exactly this to ``hard``). It is a yardstick, not a personality to tune and not
a server level (``gow_server.botmatch.LEVEL_BOTS``).

The recipe, in the order the decision asks for it:

1. **The open enemy capital** is taken at once (``capital.take_capital``, the owner's rule).
2. **Reinforce** an own node in a fight (``Bot.fight_commands``).
3. **The assault**: from ``match_ticks - assault_lead`` (the last 2 to 4 minutes) one ``GroupMove``
   of every charged squad that has a way, planned with the bonus its warehouses give, at the
   enemy capital; once.
4. **The strike package** (``_attack``): the squad is at most ``SQUAD`` (3) units, the size of a
   province; it strikes only when its shots beat the defender's pool, the units to kill, the
   terrain, the toll and the charge of the capture with ``MARGIN`` to spare (``utility.takes``),
   and then asks for the FULL bonus its node's warehouse gives (a planned order) at a defended
   target. Where one squad is short, the best squads that are exact squads combine in one
   ``GroupMove`` to the same target. Targets: a node lost a moment ago first (retaken at once), the
   enemy's empty nodes (harvest), the enemy's weak nodes nearer to its capital; neutral nodes
   only in the opening (``expand_end``, 1.5 to 3 minutes) and up to ``neutral_cap`` captures.
5. **Production**: the first factory at once in the rear, the second in the middle of the map
   once it is the bot's and no enemy touches it, one barracks a step behind the held line with the
   capital's rally point set to it, recruits while the army is below ``army_cap``.
6. **Stance**: Balance, Economy while the CP sit near their cap, War in bursts around a big
   strike (a planned order with the bonus, a combined strike, the assault); at least
   ``STANCE_DWELL`` ticks between changes.
7. **Station**: an idle squad in the rear walks to the front.

Human tempo: ONE command in a decision at most, so never two in one tick, and a gap of about 100
ticks between commands (6 a minute; the opening, the first 600 ticks, is a burst at about 45).
Plans that gathered for their time without the bonus are cancelled (``economy.release_commands``,
no release under the group order).

Only the ``PlayerView``, the map and the ruleset; every tie through ``Bot.key`` (mirror-invariant);
integers only; the bot's own choices from ``Bot.rng``. It shares nothing with ``SmartBot``, so the
steps of the smart bots do not move this yardstick.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import ClassVar, Final, override

from gow_bots.bots.base import Bot, ParamRange, node_of
from gow_bots.bots.capital import take_capital
from gow_bots.bots.economy import release_commands
from gow_bots.bots.factories import (
    FACTORY_PROFIT,
    FactorySites,
    factory_site,
    payback,
)
from gow_bots.bots.utility import shots_to_take, takes, terrain_burned
from gow_sim.commands import (
    BuildBarracks,
    BuildFactory,
    Command,
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
from gow_sim.view import Detail, GroupView, PlayerView

__all__ = ["OwnerStyleBot"]

SQUAD: Final = 3
"""Units of a squad: the capacity of a province, so a squad fits every node and road."""
MARGIN: Final = 1
"""Shots beyond what a defended target needs that a strike must bring."""
RADIUS: Final = 4
"""Road hops of a strike at most."""
GUARD: Final = 3
"""Units the own capital keeps against a strike (not against the assault or the open capital)."""
STALE_TICKS: Final = 150
"""A sighting of a node in fog older than this counts one more charge for the defender."""
OPENING_TICKS: Final = 600
"""The opening burst: commands about every ``OPENING_GAP`` ticks."""
OPENING_GAP: Final = 45
PREP_GAP: Final = 30
URGENT_GAP: Final = 25
"""Ticks after a command before a retake of a lost node may follow it."""
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
SPARE_EMPTY: Final = 1
"""Units without a charge the army may have and the bot still recruits."""
"""Squads of one combined strike at most."""


@dataclass(frozen=True, slots=True)
class Squad:
    """An idle group of the bot and the part of it a strike sends."""

    group: GroupView
    here: int
    size: int
    """Units that go: at most ``SQUAD``; below ``group.units`` the group splits first."""
    charged: int
    """Charged units of that part (the split gives the charged first)."""
    holder: bool = False
    """The only group of a front node and the whole of it goes: it leaves the node open to a
    walk-in, so it goes only to retake a lost node."""
    whole: bool = False
    """The whole stack of more than ``SQUAD`` units: only a member of a combined strike."""

    @property
    def exact(self) -> bool:
        """The whole group goes: it can be a member of a ``GroupMove``."""
        return self.size == self.group.units


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


class OwnerStyleBot(Bot):
    """The owner-style benchmark (module docstring)."""

    name: ClassVar[str] = "owner_style"
    STANCE_POLICY: ClassVar[bool] = True
    DISCIPLINE: ClassVar[bool] = True
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {
        "expand_end": ParamRange(900, 1800),  # ticks of moderate expansion (1.5 to 3 minutes)
        "neutral_cap": ParamRange(6, 10),  # neutral captures in a match
        "assault_lead": ParamRange(1200, 2400),  # ticks before the end: the last 2 to 4 minutes
        "gap_base": ParamRange(80, 110),  # ticks between commands after the opening
        "army_cap": ParamRange(12, 18),  # units the bot recruits up to
    }

    def __init__(self, mapdef: MapDef, rules: Ruleset, *, seed: int, player: int) -> None:
        super().__init__(mapdef, rules, seed=seed, player=player)
        self.home = self.map.capital(player)
        self.enemy_home = self.map.capital(1 - player)
        self.last = -(10**6)
        """The tick of the last command."""
        self.gap = 0
        self.stance_at = 0
        self.stance_seen: Stance | None = None
        self.prev_owner: list[int | None] | None = None
        self.lost: dict[int, int] = {}
        """Own nodes the enemy took, to the tick it was seen: retaken at once."""
        self.neutral_taken = 0
        self.strike_until = -1
        self.assaulted = False
        self.barracks_tried = False
        self.economy_at = -(10**6)
        self.plan_since: dict[int, int] = {}
        self.sites = FactorySites()

    @override
    def home_keep(self) -> int:
        return GUARD

    # The decision ----------------------------------------------------------------------------

    @override
    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        self.check_view(view)
        self._observe(view, tick)
        idle = self.idle_groups(view)
        stuck = release_commands(self, view, self.plan_since, tick)
        take = take_capital(self, view, tick, idle, view.me.cp)
        if take.cmd is not None:
            return self._send(take.cmd, tick)
        if take.wait:
            return []
        if tick - self.last < self.gap:
            # a lost node is retaken at once: past the gap, but never in the tick of a command
            if self.lost and tick - self.last >= URGENT_GAP:
                cmd = self._attack(view, tick, idle, retake=True)
                if cmd is not None and self.cost(cmd) <= view.me.cp:
                    return self._send(cmd, tick)
            return []
        steps = (
            lambda: stuck[0] if stuck else None,
            lambda: self._fight(view, tick),
            lambda: self._assault(view, tick, idle),
            lambda: self._attack(view, tick, idle),
            lambda: self._recharge(view, idle),
            lambda: self._merge(view, idle),
            lambda: self._build(view, tick),
            lambda: self._stance(view, tick),
            lambda: self._recruit(view),
            lambda: self._station(view, idle),
        )
        for step in steps:
            cmd = step()
            if cmd is not None and self.allowed(cmd) and self.cost(cmd) <= view.me.cp:
                return self._send(cmd, tick)
        return []

    def _send(self, cmd: Command, tick: int) -> list[Command]:
        """The one command of this decision; the next waits ``gap`` ticks."""
        self.last = tick
        if isinstance(cmd, Split | Merge):
            self.gap = PREP_GAP + self.rng.randrange(0, 21)  # free commands come in a quick pair
        elif tick < OPENING_TICKS:
            self.gap = OPENING_GAP + self.rng.randrange(-10, 11)
        else:
            self.gap = self.params["gap_base"] + self.rng.randrange(-30, 31)
        return [cmd]

    def _observe(self, view: PlayerView, tick: int) -> None:
        me = view.player
        owners = [n.owner for n in view.nodes]
        if self.prev_owner is not None:
            for node, (was, now) in enumerate(zip(self.prev_owner, owners, strict=True)):
                if was == me and now == 1 - me:
                    self.lost[node] = tick
                elif was is None and now == me:
                    self.neutral_taken += 1
        self.prev_owner = owners
        self.lost = {
            node: t for node, t in self.lost.items() if owners[node] != me and tick - t < 900
        }
        if view.me.stance is not self.stance_seen:
            self.stance_seen = view.me.stance
            self.stance_at = tick
        self.sites.observe(view, self.rules.factory.cost)
        self.observe_barracks(view)

    # Fights and the assault --------------------------------------------------------------------

    def _fight(self, view: PlayerView, tick: int) -> Command | None:
        cmds = self.fight_commands(view, tick, view.me.cp)
        return cmds[0] if cmds else None

    def _assault(self, view: PlayerView, tick: int, idle: list[GroupView]) -> Command | None:
        """The one synchronized ``GroupMove`` at the enemy capital in the last minutes."""
        go = self.rules.group_order
        start = self.rules.match_ticks - self.params["assault_lead"]
        if go is None or self.assaulted or tick < start:
            return None
        target = self.enemy_home
        members: list[tuple[int, GroupView]] = []
        for g in idle:
            here = node_of(g)
            if g.charged < 1 or here == target:
                continue
            fit = self.fit(view, here, target, g.units)
            if fit < 1:
                continue
            if fit < g.units:
                return Split(g.id, fit)  # a planned member is never split by the simulation
            members.append((self.ways(view, here, g.units)[target].ticks, g))
        affordable = view.me.cp // self.cost(GroupMove((0,), target, planned=True, bonus=1))
        members.sort(key=lambda m: (-m[1].charged, self._group_key(m[1])))
        chosen = [g for _, g in members[: min(affordable, go.max_groups)]]
        if not chosen:
            return None
        bonus = self._bonus(view, chosen)
        shots = sum(g.charged for g in chosen) + bonus
        late = tick >= self.rules.match_ticks - ASSAULT_LAST
        if shots < ASSAULT_SHOTS and not (late and shots >= 2 * SQUAD):
            return None
        self.assaulted = True
        self.strike_until = tick + STRIKE_WAR_TICKS
        return GroupMove(tuple(g.id for g in chosen), target, planned=bonus >= 1, bonus=bonus)

    def _bonus(self, view: PlayerView, groups: list[GroupView]) -> int:
        """The bonus the warehouses of the members' nodes give together: per node at most its
        stock and the charged units of the members there (DEC-41, item 10; DEC-48, item F2)."""
        charged: dict[int, int] = {}
        for g in groups:
            node = node_of(g)
            charged[node] = charged.get(node, 0) + g.charged
        return sum(min(c, view.nodes[node].warehouse or 0) for node, c in charged.items())

    # The strike package ------------------------------------------------------------------------

    def _squads(self, view: PlayerView, idle: list[GroupView]) -> list[Squad]:
        squads: list[Squad] = []
        home_left = self.standing(view)[self.home] - GUARD
        for g in sorted(
            idle, key=lambda g: g.units > SQUAD
        ):  # the guard is a stack's, not a squad's
            here = node_of(g)
            avail = g.units
            if here == self.home:
                avail = max(0, min(avail, home_left))
                home_left -= avail
            if g.charged < self.rules.capture.charge_cost or avail < 1:
                continue
            size = min(SQUAD, avail)
            if size < g.units and size < 2:
                continue  # no 1-unit figure is split off
            alone = sum(o.units for o in idle if node_of(o) == here) == g.units
            holder = size == g.units and alone and self.front(view, here) and here != self.home
            squads.append(Squad(g, here, size, min(size, g.charged), holder))
            if avail == g.units > SQUAD:  # the whole stack, as a member of a combined strike
                squads.append(Squad(g, here, avail, min(avail, g.charged), holder, whole=True))
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

    def _may_expand(self, tick: int) -> bool:
        p = self.params
        return tick < p["expand_end"] and self.neutral_taken < p["neutral_cap"]

    def _options(self, view: PlayerView, tick: int, squads: list[Squad]) -> list[Option]:
        rules = self.rules
        me = view.player
        targeted = {g.order.dest for g in view.groups if g.order is not None}
        fights = self.fight_nodes(view)
        expand = self._may_expand(tick)
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
                    or (sq.holder and dest not in self.lost)
                ):
                    continue
                if n.owner is None and not expand:
                    continue
                need = 0
                if n.owner is not None:
                    numbers = self.enemy_at(view, dest)
                    if numbers is None:
                        continue  # enemies there, numbers hidden
                    if numbers[0] > 0:
                        burned = terrain_burned(rules, view, dest)
                        need = shots_to_take(
                            rules, self.map.nodes[dest].terrain, *numbers, burned=burned
                        )
                    seen = n.seen
                    if n.detail is Detail.FOG and (seen is None or tick - seen.tick > STALE_TICKS):
                        need += 1
                toll = self.toll_from(view, sq.here, dest, sq.size, sq.charged)
                bonus = self.plan_bonus(view, sq.here, sq.charged) if need > 0 else 0
                margin = MARGIN if need > 0 else 0
                ok = takes(rules, sq.charged, bonus, need + margin, toll)
                options.append(Option(sq, dest, way.hops, need, toll, bonus, ok))
        return options

    def _score(self, view: PlayerView, o: Option) -> int:
        node = self.map.nodes[o.dest]
        gain = self.hops[self.enemy_home][o.squad.here] - self.hops[self.enemy_home][o.dest]
        if view.nodes[o.dest].owner is None:
            return 30 + 20 * node.vp - 8 * o.hops
        score = 100 + 40 * node.vp + 15 * gain - 8 * o.hops - 5 * o.need
        if o.need == 0:
            score += 20  # harvest
        if o.dest in self.lost:
            score += 300  # retake at once
        return score

    def _attack(
        self, view: PlayerView, tick: int, idle: list[GroupView], *, retake: bool = False
    ) -> Command | None:
        if self.assaulted and tick >= self.rules.match_ticks - 300:
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
        if not sq.exact:
            return Split(sq.group.id, sq.size)
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
            if o.need > 0 and o.squad.exact and not o.ok:
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

    def _build(self, view: PlayerView, tick: int) -> Command | None:
        rules = self.rules
        me = view.player
        factories = sum(1 for n in view.nodes if n.owner == me and (n.factory or n.factory_build))
        if tick >= 20 and factories < min(2, rules.factory.max):
            site = factory_site(self, view, 1, self.sites, self.supplied(view))
            if site is not None:
                return BuildFactory(site)
        elif factories < rules.factory.max and tick >= self.params["expand_end"]:
            middle = self._middle_site(view, tick)
            if middle is not None:
                return BuildFactory(middle)
        forward = self._forward_barracks(view)
        if forward is None and not self.barracks_tried and tick >= self.params["expand_end"]:
            site = self._barracks_site(view)
            if site is not None:
                self.barracks_tried = True  # three charges, lost with the city: once a match
                return BuildBarracks(site)
        if forward is not None and view.nodes[self.home].rally_point != forward:
            return SetRallyPoint(self.home, forward)
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
                or node in self.sites.lost
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
            and view.me.cp >= ECONOMY_ON_CP
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

    def _recruit(self, view: PlayerView) -> Command | None:
        units = sum(g.units for g in view.groups)
        empty = units - sum(g.charged for g in view.groups)
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
            for d in self.reachable(view, here, RADIUS, g.units):
                n = view.nodes[d]
                stock = n.warehouse or 0
                if n.owner != view.player or stock < 1 or standing[d] + g.units > n.capacity:
                    continue
                rank = (self.ways(view, here, g.units)[d].ticks, -stock, self.key(d), g.id)
                if best is None or rank < best[:4]:
                    best = (*rank, Move(g.id, d))
        return None if best is None else best[4]

    def _station(self, view: PlayerView, idle: list[GroupView]) -> Command | None:
        """An idle squad in the rear walks to an own front node nobody holds, else to the own node
        one step behind the front nearest the enemy capital."""
        if view.me.cp < self.cost(Move(0, 0)) + KEEP_CP:
            return None
        far = self.hops[self.enemy_home]
        standing = self.standing(view)
        me = view.player
        for g in idle:
            here = node_of(g)
            if g.charged < 1 or g.units < 2 or self.front(view, here):
                continue
            if here == self.home and g.units <= GUARD:
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
