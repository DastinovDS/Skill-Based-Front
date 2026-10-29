"""``SmartBot``: the shared base of the smart bots (#166, PR 1) and its five personalities.

One controller plays every personality; a personality is only a set of thresholds and weights
(``PARAMS``, drawn from the match seed by ``choose_params``, AGENTS.md section 8) and a stance.
The decision is the campaign play of ``CampaignBot`` (fights, fronts, city builds, recalls,
attacks under the stack limit, gathering, rallying, recruiting; its module docstring) driven by
the assessment layer (``gow_bots.bots.assess``), computed from the ``PlayerView`` every decision:

1. **The thresholds of the decision follow the position.** Ahead on the VP forecast (+1 margin)
   the bot demands ``secure_margin`` more shots of every attack (no wasted waves while the clock
   wins); not ahead with at most ``all_in`` awards left it goes all in (no capital guard, no
   reserve, one hop farther). The CP ``reserve`` waits only while the upper bound of the enemy CP
   can pay for a planned strike (#166: no idle reserve against an enemy that cannot strike).
2. **The capital.** When the shown enemy forces that can reach the own capital within ``alarm``
   ticks are enough to take it (``Threat.danger``), the capital comes first: its groups stay,
   the strongest one goes into Defense if the bonus grows before the arrival (DEC-30), free
   charged groups that can arrive in time walk home, and the capital recruits.
3. **Visible strikes** (DEC-08): ``respond`` 1 answers a planned strike at the capital, 2 at any
   own city, with Defense and the nearest group (the reactive play); for ``EXPOSED_TICKS`` the
   origin of every strike scores ``w_exposed`` more as a target (a bare spot to hit back).
4. **Targets** are ranked by one weighted sum (``score``): VP of the target (``w_vp`` for an enemy
   city, ``w_neutral`` for a neutral one), the damage to the enemy supply network (``w_cut``
   percent of ``cut_value``), the hops it brings closer to the enemy capital (``w_closer``),
   minus the shots it needs (``w_need``) and the hops away (``w_hops``); the enemy capital in
   reach always first. ``region`` > 0 keeps the targets within that many hops of the own capital
   (``spill`` more while CP are about to burn).
5. **Garrisons and the rest**: ``hold_front`` units stay in own nodes next to the enemy, front
   garrisons below it are filled from free groups nearby, ``fortify`` puts their strongest group
   into Defense; the stance is the personality's, one step toward Economy while units wait for
   charges and toward War while the warehouses are full and CP do not burn; one road is
   upgraded at a time while ``road_keep`` CP are left (DEC-28, item 7).

The ordinary-or-planned choice of every order is ``prefer_planned``: a function of the ruleset
prices only, shared by all bots (AGENTS.md, section 8). Tie-breaks are mirror-invariant
(``Bot.key``, ``Bot.edge_keys``), nothing draws from ``self.rng``.
"""

from collections import deque
from collections.abc import Mapping
from typing import ClassVar, Final, override

from gow_bots.bots.assess import Assessment, Assessor, Travel
from gow_bots.bots.base import ParamRange, node_of
from gow_bots.bots.campaign import CampaignBot, Ctx
from gow_sim.commands import Command, Move, Recruit, SetMode, SetStance, Split, UpgradeRoad
from gow_sim.maps import MapDef
from gow_sim.ruleset import Ruleset
from gow_sim.view import GroupView, IntentKind, IntentView, Mode, PlayerView, Stance

__all__ = [
    "PERSONALITIES",
    "SmartBot",
    "SmartExpander",
    "SmartReactive",
    "SmartRusher",
    "SmartStrangler",
    "SmartTurtle",
]

GUESS_UNITS: Final = 3
"""Units assumed for an enemy force whose numbers the fog hides (the threat to the capital)."""
THREAT_HORIZON: Final = 60
"""Ticks after the first arrival that still add a force to the threat."""
CUT_REFRESH_TICKS: Final = 20
"""The cut values are recomputed this often: ownership changes rarely."""
EXPOSED_TICKS: Final = 150
"""How long the origin of an enemy strike counts as exposed."""
SEARCH_HOPS: Final = 3
"""Farthest own node a reinforcement comes from, in road hops."""
STANCES: Final = (Stance.ECONOMY, Stance.BALANCE, Stance.WAR)
"""From the most charges to the most CP (``economy.stance_to_charges_pct``)."""

_COMMON: Final[Mapping[str, ParamRange]] = {
    "alarm": ParamRange(150, 250),
    "all_in": ParamRange(3, 5),
    "secure_margin": ParamRange(1, 1),
    "starved": ParamRange(4, 6),
}
"""Thresholds every personality shares (see the module docstring)."""


class SmartBot(CampaignBot):
    """The shared base: see the module docstring. Subclasses set ``PARAMS`` and the stances."""

    name: ClassVar[str] = "smart"
    STANCE: ClassVar[Stance] = Stance.BALANCE
    LATE_STANCE: ClassVar[Stance | None] = None
    """The stance from tick ``late`` on (``None``: ``STANCE`` all match)."""
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {
        **_COMMON,
        "radius": ParamRange(2, 3),
        "margin": ParamRange(0, 1),
        "guard": ParamRange(1, 2),
        "reserve": ParamRange(0, 100),
        "recruit_keep": ParamRange(100, 250),
        "w_vp": ParamRange(200, 200),
        "w_neutral": ParamRange(100, 100),
        "w_base": ParamRange(0, 0),
        "w_cut": ParamRange(0, 0),
        "w_closer": ParamRange(0, 0),
        "w_need": ParamRange(2, 2),
        "w_hops": ParamRange(10, 10),
        "w_exposed": ParamRange(0, 0),
        "respond": ParamRange(1, 1),
        "region": ParamRange(0, 0),
        "spill": ParamRange(0, 0),
        "hold_front": ParamRange(0, 0),
        "fortify": ParamRange(0, 0),
        "road_keep": ParamRange(600, 600),
        "late": ParamRange(0, 0),
    }

    def __init__(self, mapdef: MapDef, rules: Ruleset, *, seed: int, player: int) -> None:
        super().__init__(mapdef, rules, seed=seed, player=player)
        self.travel = Travel(mapdef, rules)
        self.assessor = Assessor(mapdef, rules, player, self.travel)
        self.assessment: Assessment | None = None
        """The assessment of the last decision (tests and the docstring's thresholds)."""
        self.alarm = False
        """The capital is in danger in this decision (module docstring, item 2)."""
        self.hot: list[bool] = [False] * len(mapdef.nodes)
        """Own nodes next to the enemy in this decision: they keep ``hold_front`` units."""
        self.answered: dict[int, bool] = {}
        self.exposed: dict[int, int] = {}
        self._cut: dict[int, int] = {}
        self._cut_tick = -CUT_REFRESH_TICKS

    # Decision -------------------------------------------------------------------------------

    @override
    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        self.check_view(view)
        drawn = self.params
        supplied = self.supplied(view)
        a = self.assessor.assess(view, supplied, guess=GUESS_UNITS, horizon=THREAT_HORIZON)
        self.assessment = a
        threat = a.threat
        self.alarm = (
            threat.danger and threat.eta is not None and threat.eta - tick <= drawn["alarm"]
        )
        self.hot = self._hot(view)
        self.params = self.adjusted(a)
        try:
            return self._decide(view, tick, a)
        finally:
            self.params = drawn

    def adjusted(self, a: Assessment) -> dict[str, int]:
        """The drawn parameters with the thresholds of this decision (module docstring, 1)."""
        p = dict(self.params)
        if a.ahead:
            p["margin"] += p["secure_margin"]
        elif a.awards_left <= p["all_in"]:
            p["guard"] = 0
            p["reserve"] = 0
            p["radius"] += 1
        if a.enemy_cp < self.rules.orders.cost.planned_move:
            p["reserve"] = 0
        if self.alarm:
            p["guard"] = max(p["guard"], a.threat.units)
            p["reserve"] = 0  # the reserve is for this moment: Defense and the walk home
        return p

    def _decide(self, view: PlayerView, tick: int, a: Assessment) -> list[Command]:
        ctx = Ctx(view, tick, view.me.cp - self.params["reserve"], standing=self.standing(view))
        for g in view.groups:
            if g.order is not None:
                ctx.claimed[g.order.dest] = True
        self._learn(ctx)
        for cmd in self.fight_commands(view, tick, ctx.budget):  # DEC-24: fights first
            if self.spend(ctx, cmd) and isinstance(cmd, Move):
                ctx.used[cmd.group] = True
        self._set_stance(ctx, a)
        for cmd in self.fronts(view):  # front markers on the front cities (DEC-28)
            self.spend(ctx, cmd)
        if not self.alarm:
            cmd = self.development(view, ctx.budget)  # DEC-26, item 11: before the orders
            if cmd is not None:
                self.spend(ctx, cmd)
        self._recall(ctx)
        self.defend_capital(ctx, a)
        self.respond(ctx)
        self.garrison(ctx)
        self.fortify(ctx)
        self._attack(ctx)
        self._fit_split(ctx)
        self._gather(ctx)
        self._rally(ctx)
        self._recruit(ctx)
        self.build_roads(ctx)
        return ctx.cmds

    # Stance ---------------------------------------------------------------------------------

    def wanted_stance(self, a: Assessment) -> Stance:
        """The personality's stance, one step toward Economy while ``starved`` own units wait
        for charges and the warehouses are less than half full, one step toward War while the
        warehouses are full, no unit waits and the CP are not about to burn (the stance only
        splits the CP income, DEC-02)."""
        p = self.params
        late = p["late"]
        stance = self.LATE_STANCE if self.LATE_STANCE and late and a.tick >= late else self.STANCE
        at = STANCES.index(stance)
        own = a.own
        if own.uncharged_standing >= p["starved"] and 2 * own.warehouse < own.warehouse_cap:
            at = max(0, at - 1)
        elif (
            0 < own.warehouse_cap <= own.warehouse
            and own.uncharged_standing == 0
            and a.cp < self.rules.cp.cap - 2 * self.rules.cp.per_period
        ):
            at = min(len(STANCES) - 1, at + 1)
        return STANCES[at]

    def _set_stance(self, ctx: Ctx, a: Assessment) -> None:
        last = self.stance_tick
        if last is not None and ctx.tick - last < self.rules.orders.stance_cooldown_ticks:
            return
        stance = self.wanted_stance(a)
        if ctx.view.me.stance is not stance and self.spend(ctx, SetStance(stance)):
            self.stance_tick = ctx.tick

    # The capital ----------------------------------------------------------------------------

    def defend_capital(self, ctx: Ctx, a: Assessment) -> None:
        """Module docstring, item 2: Defense, the groups that arrive in time, a recruit."""
        if not self.alarm or a.threat.eta is None:
            return
        view, home = ctx.view, self.home
        if view.nodes[home].owner != self.player or home in self.fight_nodes(view):
            return
        self.defend(ctx, home, a.threat.eta)
        missing = a.threat.units - a.threat.need + 1
        to_home = [row[home] for row in self.travel.ticks]
        far = len(self.map.nodes)
        for g in self.free_groups(ctx):
            here = node_of(g)
            if missing <= 0:
                break
            if here == home or g.charged == 0 or ctx.tick + to_home[here] > a.threat.eta:
                continue
            if home not in self.reachable(view, here, far, g.units):
                continue
            if self.spend(ctx, Move(g.id, home)):
                ctx.used[g.id] = True
                ctx.standing[here] -= g.units
                missing -= g.charged
        if self.can_queue(view, home, ctx.standing[home]) and self.spend(ctx, Recruit(home)):
            self.recruited[home] = ctx.tick
            ctx.standing[home] += 1

    def defend(self, ctx: Ctx, target: int, arrival: int) -> bool:
        """Defense for the strongest charged group standing in ``target``, if it gathers at least
        +1 by ``arrival`` (it is switched on in the next tick, DEC-30)."""
        if self.rules.orders.defense_bonus(max(0, arrival - ctx.tick - 1), 1) < 1:
            return False
        here = [
            g
            for g in self.idle_groups(ctx.view)
            if node_of(g) == target and g.charged > 0 and g.id not in ctx.used
        ]
        if not here or any(g.mode is Mode.DEFENSE for g in here):
            return False
        best = max(here, key=lambda g: (g.charged, g.units))
        if self.spend(ctx, SetMode(best.id, Mode.DEFENSE)):
            ctx.used[best.id] = True
            return True
        return False

    # Visible strikes ------------------------------------------------------------------------

    @override
    def respond(self, ctx: Ctx) -> None:
        view = ctx.view
        live = {i.id for i in view.intents}
        self.answered = {i: True for i in sorted(self.answered) if i in live}
        level = self.params["respond"]
        ctx.budget += self.params["reserve"]
        for intent in self.strikes(ctx):
            self.exposed[intent.origin] = ctx.tick
            target = intent.target
            if target is None or intent.id in self.answered or level <= 0:
                continue
            if level == 1 and target != self.home:
                continue
            done = self.defend(ctx, target, self.arrival(intent))
            done = self.reinforce(ctx, target) or done
            if done:
                self.answered[intent.id] = True
        ctx.budget -= self.params["reserve"]

    def strikes(self, ctx: Ctx) -> list[IntentView]:
        """Planned enemy orders aimed at an own node, in a mirror-invariant order."""
        view = ctx.view
        found = [
            i
            for i in view.intents
            if i.owner != self.player
            and i.kind is IntentKind.PLANNED_MOVE
            and i.target is not None
            and view.nodes[i.target].owner == self.player
        ]
        found.sort(key=lambda i: (self.key(i.target or 0), self.key(i.origin), i.created_tick))
        return found

    def arrival(self, intent: IntentView) -> int:
        """The earliest tick the planned strike of ``intent`` can reach its target."""
        assert intent.target is not None
        way = max(0, self.travel.ticks[intent.origin][intent.target])
        return intent.created_tick + self.rules.orders.planned_delay_ticks + way

    def reinforce(self, ctx: Ctx, target: int) -> bool:
        """The nearest charged group that can walk to ``target`` and may leave its node."""
        best: GroupView | None = None
        for g in self.free_groups(ctx):
            here = node_of(g)
            if here == target or g.charged == 0:
                continue
            if not self.may_leave(ctx, g) or target not in self.reachable(
                ctx.view, here, SEARCH_HOPS, g.units
            ):
                continue
            if best is None or (self.hops[here][target], -g.charged) < (
                self.hops[node_of(best)][target],
                -best.charged,
            ):
                best = g
        if best is not None and self.spend(ctx, Move(best.id, target)):
            ctx.used[best.id] = True
            ctx.standing[node_of(best)] -= best.units
            ctx.standing[target] += best.units
            ctx.claimed[target] = True
            return True
        return False

    # Garrisons ------------------------------------------------------------------------------

    def _hot(self, view: PlayerView) -> list[bool]:
        """Own nodes next to an enemy node or to fresh enemy groups (public ownership and the
        sightings of the view)."""
        me = view.player
        enemy_near = [
            n.owner == 1 - me
            or (n.seen is not None and bool(n.seen.enemy_modes) and view.tick - n.seen.tick <= 50)
            for n in view.nodes
        ]
        return [
            n.owner == me and any(enemy_near[m] for m in self.neighbors[n.id]) for n in view.nodes
        ]

    def garrison(self, ctx: Ctx) -> None:
        """Fill the own nodes next to the enemy that hold fewer than ``hold_front`` units from the
        free groups within ``SEARCH_HOPS`` that may leave (VP first, then ``node_key``)."""
        hold = self.params["hold_front"]
        if hold <= 0:
            return
        view = ctx.view
        short = [n for n in range(len(view.nodes)) if self.hot[n] and ctx.standing[n] < hold]
        short.sort(key=lambda n: (-self.map.nodes[n].vp, self.key(n)))
        for node in short:
            for g in self.free_groups(ctx):
                here = node_of(g)
                if ctx.standing[node] >= hold:
                    break
                if here == node or self.hot[here] or not self.may_leave(ctx, g):
                    continue
                if node not in self.reachable(view, here, SEARCH_HOPS, g.units):
                    continue
                if self.spend(ctx, Move(g.id, node)):
                    ctx.used[g.id] = True
                    ctx.standing[here] -= g.units
                    ctx.standing[node] += g.units

    def fortify(self, ctx: Ctx) -> None:
        """Defense on the strongest charged group of every own node next to the enemy (and of
        the capital), once: the bonus gathers anew after a fight without a new payment
        (DEC-30). Only while CP stay above the recruit keep."""
        if self.params["fortify"] <= 0:
            return
        keep = self.params["recruit_keep"]
        by_node: dict[int, list[GroupView]] = {}
        for g in self.free_groups(ctx):
            by_node.setdefault(node_of(g), []).append(g)
        for node in sorted(by_node, key=self.key):
            if not self.hot[node] or any(g.mode is Mode.DEFENSE for g in by_node[node]):
                continue
            charged = [g for g in by_node[node] if g.charged > 0]
            if not charged:
                continue
            best = max(charged, key=lambda g: (g.charged, g.units))
            cmd = SetMode(best.id, Mode.DEFENSE)
            if ctx.budget - self.cost(cmd) >= keep and self.spend(ctx, cmd):
                ctx.used[best.id] = True

    @override
    def may_leave(self, ctx: Ctx, g: GroupView) -> bool:
        here = node_of(g)
        if here == self.home:
            if self.alarm:
                return False
            return ctx.standing[here] - g.units >= self.params["guard"]
        if self.hot[here]:
            return ctx.standing[here] - g.units >= self.params["hold_front"]
        return True

    @override
    def _guard_split(self, ctx: Ctx) -> None:
        """Split the spare units off a group that holds the capital or a front node, so they can
        march (only when the spare units alone could take a target)."""
        p = self.params
        for g in self.free_groups(ctx):
            here = node_of(g)
            if here == self.home:
                if self.alarm:
                    continue
                keep = p["guard"]
            elif self.hot[here]:
                keep = p["hold_front"]
            else:
                continue
            spare = ctx.standing[here] - keep
            if spare < 2 or g.units <= spare:
                continue
            army = self.fake_group(g, spare, min(spare, g.charged))
            if self.options(ctx, [army]) and self.spend(ctx, Split(g.id, spare)):
                ctx.used[g.id] = True

    # Targets --------------------------------------------------------------------------------

    @override
    def score(self, ctx: Ctx, g: GroupView, dest: int, need: int) -> int | None:
        p = self.params
        node = self.map.nodes[dest]
        here = node_of(g)
        hops = self.hops[here][dest]
        region = p["region"]
        if region > 0:
            if ctx.view.me.cp >= self.rules.cp.cap - self.rules.cp.per_period:
                region += p["spill"]  # CP are about to burn: the bunker grows a ring
            if self.hops[self.home][dest] > region:
                return None
        if node.capital_of is not None:
            return 10_000 - hops
        far = self.hops[self.enemy_home]
        closer = far[here] - far[dest]
        if ctx.view.nodes[dest].owner is None:
            value = p["w_neutral"] * node.vp
        else:
            cut = self.cut_values(ctx.view).get(dest, 0)
            value = p["w_base"] + p["w_vp"] * node.vp + p["w_cut"] * cut // 100
        seen = self.exposed.get(dest)
        if seen is not None and ctx.tick - seen <= EXPOSED_TICKS:
            value += p["w_exposed"]
        return value + p["w_closer"] * closer - p["w_need"] * need - p["w_hops"] * hops

    @override
    def objective(self, ctx: Ctx) -> int:
        """Region bots gather at the edge of their region nearest the enemy; cutting bots at the
        most damaging enemy node; the rest at the enemy capital."""
        region = self.params["region"]
        if region > 0:
            far = self.hops[self.enemy_home]
            inside = [
                n.id
                for n in ctx.view.nodes
                if n.owner == self.player and 0 <= self.hops[self.home][n.id] <= region
            ]
            return min(inside, key=lambda n: (far[n], self.key(n)), default=self.home)
        if self.params["w_cut"] > 0:
            values = self.cut_values(ctx.view)
            if values:
                return max(sorted(values, key=self.key), key=lambda n: values[n])
        return self.enemy_home

    def cut_values(self, view: PlayerView) -> dict[int, int]:
        """``cut_value`` of every node of the enemy network, refreshed every few ticks."""
        if view.tick - self._cut_tick >= CUT_REFRESH_TICKS:
            self._cut = {n: self.cut_value(view, n) for n in sorted(self.enemy_net(view))}
            self._cut_tick = view.tick
        return self._cut

    def cut_value(self, view: PlayerView, node: int) -> int:
        """Damage to the enemy network if ``node`` were ours, in points: 100 per enemy node that
        would lose its connection to the enemy capital, plus a quarter of 100 per road level of
        the network roads into it (public ownership, known road levels)."""
        net = self.enemy_net(view)
        if node not in net:
            return 0
        enemy = 1 - self.player
        seen: dict[int, bool] = {self.enemy_home: True} if node != self.enemy_home else {}
        queue = deque(seen)
        while queue:
            at = queue.popleft()
            for other in self.neighbors[at]:
                if other != node and other not in seen and view.nodes[other].owner == enemy:
                    seen[other] = True
                    queue.append(other)
        lost = len(net) - 1 - len(seen)
        roads = sum(
            100 * view.edges[e].width
            for e in self.incident[node]
            if self.map.edges[e].other(node) in net
        )
        return 100 * lost + roads // 4

    # Roads ----------------------------------------------------------------------------------

    def build_roads(self, ctx: Ctx) -> None:
        """One road at a time (DEC-28, item 7): while no own road is being built and
        ``road_keep`` CP stay after the price, the own internal road with the most speed and
        throughput gain whose ends are not next to the enemy; ties to the road nearer the own
        capital, then the edge key (mirror-invariant)."""
        view = ctx.view
        keep = self.params["road_keep"]
        if ctx.budget - self.rules.orders.cost.build < keep:
            return
        if any(e.build is not None and e.upgrade_gain is not None for e in view.edges):
            return
        hops = self.hops[self.home]
        best: tuple[int, int, int] | None = None
        best_edge: int | None = None
        for e, edef in enumerate(self.map.edges):
            gain = view.edges[e].upgrade_gain
            if gain is None or not self.can_upgrade(view, e):
                continue
            if self.hot[edef.a] or self.hot[edef.b]:
                continue
            value = gain.speed_pct + gain.unit_speed_pct + 100 * gain.amount
            rank = (-value, min(hops[edef.a], hops[edef.b]), self.edge_keys[e])
            if best is None or rank < best:
                best, best_edge = rank, e
        if best_edge is not None:
            self.spend(ctx, UpgradeRoad(best_edge))


# The personalities: the BOT-02 and BOT-03 bots as thresholds and weights of ``SmartBot``. ------


class SmartRusher(SmartBot):
    """Early pressure (``RusherBot``): War, a small guard, the weak cities near the enemy
    capital first, neutral cities only as a side dish."""

    name: ClassVar[str] = "smart_rusher"
    STANCE: ClassVar[Stance] = Stance.WAR
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {
        **SmartBot.PARAMS,
        "radius": ParamRange(3, 4),
        "margin": ParamRange(0, 1),
        "guard": ParamRange(0, 1),
        "reserve": ParamRange(0, 0),
        "recruit_keep": ParamRange(100, 150),
        "secure_margin": ParamRange(0, 0),
        "w_vp": ParamRange(300, 300),
        "w_neutral": ParamRange(40, 120),
        "w_closer": ParamRange(40, 40),
        "w_need": ParamRange(15, 15),
        "respond": ParamRange(1, 1),
    }


class SmartStrangler(SmartBot):
    """Cuts the enemy roads and besieges (``StranglerBot``): the most damaging city in reach,
    a held cut-off city keeps a garrison."""

    name: ClassVar[str] = "smart_strangler"
    STANCE: ClassVar[Stance] = Stance.BALANCE
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {
        **SmartBot.PARAMS,
        "radius": ParamRange(2, 4),
        "margin": ParamRange(0, 1),
        "guard": ParamRange(1, 2),
        "reserve": ParamRange(0, 100),
        "recruit_keep": ParamRange(100, 250),
        "w_vp": ParamRange(50, 50),
        "w_neutral": ParamRange(40, 40),
        "w_base": ParamRange(150, 150),
        "w_cut": ParamRange(100, 100),
        "w_need": ParamRange(3, 3),
    }


class SmartReactive(SmartBot):
    """Answers the visible intents (``ReactiveBot``): Defense and a reinforcement at every own
    city under a planned strike, then the bare origin of the strike."""

    name: ClassVar[str] = "smart_reactive"
    STANCE: ClassVar[Stance] = Stance.BALANCE
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {
        **SmartBot.PARAMS,
        "radius": ParamRange(2, 3),
        "margin": ParamRange(0, 1),
        "guard": ParamRange(1, 2),
        "reserve": ParamRange(200, 300),
        "recruit_keep": ParamRange(250, 350),
        "w_exposed": ParamRange(500, 500),
        "respond": ParamRange(2, 2),
    }


class SmartExpander(SmartBot):
    """Territory first (``ExpanderBot``): War until ``late``, then Balance; neutral cities weigh
    like enemy ones, the front keeps a garrison, spare CP go into roads."""

    name: ClassVar[str] = "smart_expander"
    STANCE: ClassVar[Stance] = Stance.WAR
    LATE_STANCE: ClassVar[Stance | None] = Stance.BALANCE
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {
        **SmartBot.PARAMS,
        "radius": ParamRange(2, 3),
        "margin": ParamRange(0, 1),
        "guard": ParamRange(2, 3),
        "reserve": ParamRange(0, 0),
        "recruit_keep": ParamRange(100, 200),
        "w_vp": ParamRange(150, 150),
        "w_neutral": ParamRange(200, 250),
        "w_hops": ParamRange(20, 20),
        "hold_front": ParamRange(1, 2),
        "road_keep": ParamRange(350, 450),
        "late": ParamRange(1200, 2400),
    }


class SmartTurtle(SmartBot):
    """The bunker (``TurtleBot``): a region of ``region`` hops around the capital, Economy, big
    front garrisons in Defense, attacks only with a large margin."""

    name: ClassVar[str] = "smart_turtle"
    STANCE: ClassVar[Stance] = Stance.ECONOMY
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {
        **SmartBot.PARAMS,
        "radius": ParamRange(2, 3),
        "margin": ParamRange(1, 2),
        "guard": ParamRange(3, 5),
        "reserve": ParamRange(0, 100),
        "recruit_keep": ParamRange(150, 250),
        "w_neutral": ParamRange(150, 150),
        "region": ParamRange(3, 4),
        "spill": ParamRange(1, 2),
        "hold_front": ParamRange(2, 3),
        "fortify": ParamRange(1, 1),
        "road_keep": ParamRange(350, 450),
    }


PERSONALITIES: Final[tuple[type[SmartBot], ...]] = (
    SmartExpander,
    SmartReactive,
    SmartRusher,
    SmartStrangler,
    SmartTurtle,
)
"""The five personalities, in name order."""
