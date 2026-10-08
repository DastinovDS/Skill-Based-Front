"""The common campaign play of Rusher, Strangler and Reactive (BOT-03).

One decision (every 5 ticks) goes in a fixed order, and CP is spent in the same order, so the
scarce resource (about 0.5 CP per 50 ticks, mechanics.md, section 6) goes to the useful things
first:

1. ``respond`` (a hook; ``ReactiveBot`` answers the visible intents of the enemy here);
2. attacks and captures: every idle group looks at the nodes it can reach, a node is a *viable
   target* when the group's charges are enough to take it (``shots_to_take`` against the estimate of
   the enemy below, plus ``margin``), and ``score`` ranks the viable (group, target) pairs;
3. ``gather``: groups standing in one node are merged when together they can take a target
   that none of them can take alone (one ``Merge`` costs 1 CP whatever the number of groups);
4. ``rally``: groups without a target walk to the own node closest to the objective;
5. ``recruit``: one new unit in the own city closest to the objective, while CP is left.

Each attack is a normal or a planned order by ``prefer_planned``, i.e. by the prices of the
ruleset only (BOT-01). The capital keeps ``guard`` units at home: the group that would leave
it below that is split first.

Enemy strength (DEC-04 shows numbers only in ``EXACT`` places, and a target is a neighbour of
an own node, so it is ``PRESENCE`` at best), the estimate ``estimate()``:

- seen without enemy groups: empty, ``(0, 0)`` (a neutral city is empty in the MVP, mechanics.md
  section 9; an enemy city without a group falls without a fight);
- exact numbers (the node was ``EXACT``): those numbers, and they are remembered;
- enemy groups seen without numbers: the last remembered numbers, else a garrison of the size of
  the start garrison of the node on the map, at least ``2`` units with ``2`` charges (the
  typical size of a garrison or a merged recruit);
- every failed wave on a target (the group went out and the node is still not ours) adds
  one shot to the demand for that node (``extra``), and on a node cut from the enemy capital the
  warehouse no longer refills, so the wave is assumed to have cancelled the pool it was
  strong enough to cancel (``_learn``).

All tie-breaks go through ``Bot.key`` / ``Bot.edge_keys`` (mirror-invariant), never through ids.
"""

from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import ClassVar, override

from gow_bots.bots.base import Bot, ParamRange, node_of
from gow_bots.bots.utility import defender_pool, prefer_planned, shots_to_take
from gow_sim.commands import Command, Merge, Move, Recruit, SetStance, Split
from gow_sim.maps import MapDef
from gow_sim.ruleset import RecruitLocation, Ruleset
from gow_sim.view import GroupView, Mode, PlayerView, Stance

__all__ = ["CampaignBot", "Ctx", "Option"]

MIN_WAVE_TICKS = 10
"""A wave is judged failed no sooner than this many ticks after the order (the order shows up in
the next view)."""
MAX_EXTRA = 4
"""Largest extra demand added to a node by failed waves."""
STALE_TICKS = 600
"""A remembered enemy strength older than this is dropped (the enemy recruits and recharges)."""


@dataclass(frozen=True, slots=True)
class Option:
    """A viable attack: ``group`` takes ``dest``; ``need`` shots, a planned order or not."""

    score: int
    group: GroupView
    dest: int
    planned: bool
    need: int


@dataclass(slots=True)
class Wave:
    """An attack order that was sent and not yet judged."""

    tick: int
    charged: int
    estimate: tuple[int, int]


@dataclass(slots=True)
class Ctx:
    """The state of one decision."""

    view: PlayerView
    tick: int
    budget: int
    cmds: list[Command] = field(default_factory=list[Command])
    used: dict[int, bool] = field(default_factory=dict[int, bool])
    """Opaque ids of own groups that already got a command in this decision."""
    claimed: dict[int, bool] = field(default_factory=dict[int, bool])
    """Targets that a group is already on its way to, or was sent to in this decision."""
    standing: list[int] = field(default_factory=list[int])


class CampaignBot(Bot):
    """Base of the strategy bots: see the module docstring."""

    name: ClassVar[str] = "strategy"
    STANCE: ClassVar[Stance] = Stance.BALANCE
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {
        "radius": ParamRange(2, 3),  # farthest target of an order, in road hops
        "margin": ParamRange(0, 1),  # shots demanded above the estimate of the enemy
        "guard": ParamRange(1, 2),  # units that stay in the capital
        "reserve": ParamRange(0, 100),  # CP in hundredths kept unspent
        "recruit_keep": ParamRange(100, 250),  # CP left after a recruit
    }

    def __init__(self, mapdef: MapDef, rules: Ruleset, *, seed: int, player: int) -> None:
        super().__init__(mapdef, rules, seed=seed, player=player)
        self.home = mapdef.capital(player)
        self.enemy_home = mapdef.capital(1 - player)
        self.recruited: dict[int, int] = {}
        self.stance_tick: int | None = None
        self.memory: dict[int, tuple[int, int, int]] = {}
        """Remembered enemy strength by node: ``(tick, units, charged)``."""
        self.extra: dict[int, int] = {}
        self.waves: dict[int, Wave] = {}
        self._net_tick = -1
        self._net: frozenset[int] = frozenset()

    # Decision -------------------------------------------------------------------------------

    @override
    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        self.check_view(view)
        ctx = Ctx(view, tick, view.me.cp - self.params["reserve"], standing=self.standing(view))
        for g in view.groups:
            if g.order is not None:
                ctx.claimed[g.order.dest] = True
        self._learn(ctx)
        self._stance(ctx)
        self.respond(ctx)
        self._attack(ctx)
        self._gather(ctx)
        self._rally(ctx)
        self._recruit(ctx)
        return ctx.cmds

    def respond(self, ctx: Ctx) -> None:
        """Hook: commands that come before everything else (``ReactiveBot``)."""

    def score(self, ctx: Ctx, g: GroupView, dest: int, need: int) -> int | None:
        """Rank of the viable attack of ``g`` on ``dest``; ``None`` drops it. Higher is better."""
        node = self.map.nodes[dest]
        hops = self.hops[node_of(g)][dest]
        if node.capital_of is not None:
            return 10_000 - hops
        enemy = ctx.view.nodes[dest].owner is not None
        return 100 * node.vp * (2 if enemy else 1) - 10 * hops - 2 * need

    def objective(self, ctx: Ctx) -> int:
        """The node the army walks to and recruits close to."""
        return self.enemy_home

    # Spending -------------------------------------------------------------------------------

    def spend(self, ctx: Ctx, cmd: Command) -> bool:
        cost = self.cost(cmd)
        if cost > ctx.budget:
            return False
        ctx.budget -= cost
        ctx.cmds.append(cmd)
        return True

    def free_groups(self, ctx: Ctx) -> list[GroupView]:
        return [g for g in self.idle_groups(ctx.view) if g.id not in ctx.used]

    # Stance ---------------------------------------------------------------------------------

    def _stance(self, ctx: Ctx) -> None:
        last = self.stance_tick
        ready = last is None or ctx.tick - last >= self.rules.orders.stance_cooldown_ticks
        if (
            ready
            and ctx.view.me.stance is not self.STANCE
            and self.spend(ctx, SetStance(self.STANCE))
        ):
            self.stance_tick = ctx.tick

    # Enemy strength -------------------------------------------------------------------------

    def estimate(self, view: PlayerView, tick: int, node: int) -> tuple[int, int]:
        """``(units, charged)`` of the enemy in ``node``: see the module docstring."""
        exact = self.enemy_at(view, node)
        if exact is not None:
            seen = view.nodes[node].seen
            if seen is not None and seen.enemy_units is not None:
                self.memory[node] = (tick, exact[0], exact[1])
            return exact
        known = self.memory.get(node)
        if known is not None and tick - known[0] <= STALE_TICKS:
            return (known[1], known[2])
        start = self.map.nodes[node]
        return (max(start.start_units, 2), max(start.start_charged, 2))

    def need(self, view: PlayerView, tick: int, dest: int) -> int:
        """Shots that take ``dest`` by the estimate, with the margin and the failed waves."""
        units, charged = self.estimate(view, tick, dest)
        if units <= 0:
            return 0
        terrain = self.map.nodes[dest].terrain
        base = shots_to_take(self.rules, terrain, units, charged, self.defended(view, dest))
        return base + self.params["margin"] + self.extra.get(dest, 0)

    def enemy_net(self, view: PlayerView) -> frozenset[int]:
        """Enemy nodes connected to the enemy capital through enemy nodes (public ownership)."""
        if self._net_tick == view.tick:
            return self._net
        enemy = 1 - self.player
        seen: set[int] = set()
        if view.nodes[self.enemy_home].owner == enemy:
            seen.add(self.enemy_home)
            queue = deque([self.enemy_home])
            while queue:
                node = queue.popleft()
                for other in self.neighbors[node]:
                    if other not in seen and view.nodes[other].owner == enemy:
                        seen.add(other)
                        queue.append(other)
        self._net, self._net_tick = frozenset(seen), view.tick
        return self._net

    def is_cut(self, view: PlayerView, node: int) -> bool:
        """An enemy node whose roads to the enemy capital are cut: its warehouse is not refilled."""
        return view.nodes[node].owner == 1 - self.player and node not in self.enemy_net(view)

    def _learn(self, ctx: Ctx) -> None:
        """Judge the waves that went out: a taken node ends the wave, a bounce raises the demand."""
        view = ctx.view
        for dest in sorted(self.waves, key=self.key):
            wave = self.waves[dest]
            if view.nodes[dest].owner == self.player:
                del self.waves[dest]
                self.extra.pop(dest, None)
                self.memory.pop(dest, None)
            elif ctx.tick - wave.tick >= MIN_WAVE_TICKS and dest not in ctx.claimed:
                del self.waves[dest]
                self.extra[dest] = min(MAX_EXTRA, self.extra.get(dest, 0) + 1)
                if self.is_cut(view, dest):
                    self._starve(dest, wave, ctx.tick)

    def _starve(self, dest: int, wave: Wave, tick: int) -> None:
        # The wave fought the pool of the node. A cut node does not recharge, so the shots that
        # cancelled the pool are gone for good, and the surplus killed one unit each.
        units, charged = wave.estimate
        terrain = self.map.nodes[dest].terrain
        pool = defender_pool(self.rules, terrain, charged, False)
        cancelled = min(wave.charged, pool)
        killed = max(0, wave.charged - pool)
        self.memory[dest] = (tick, max(0, units - killed), max(0, charged - cancelled))

    # Attacks --------------------------------------------------------------------------------

    def options(self, ctx: Ctx, groups: list[GroupView]) -> list[Option]:
        """Viable attacks of ``groups`` on nodes in reach, best first."""
        view, bonus = ctx.view, self.rules.orders.planned_bonus
        found: list[Option] = []
        for g in groups:
            if not self.may_leave(ctx, g):
                continue
            for dest in self.reachable(view, node_of(g), self.params["radius"]):
                if view.nodes[dest].owner == self.player or dest in ctx.claimed:
                    continue
                need = self.need(view, ctx.tick, dest)
                plain = g.charged >= need
                plan = g.charged >= 1 and g.charged + bonus >= need
                if not (plain or plan):
                    continue
                planned = plan and (not plain or prefer_planned(self.rules, g.charged, need))
                score = self.score(ctx, g, dest, need)
                if score is not None:
                    found.append(Option(score, g, dest, planned, need))
        found.sort(key=lambda o: (-o.score, self.key(o.dest), self.group_order(o.group)))
        return found

    def group_order(self, g: GroupView) -> tuple[int, int, int]:
        """Mirror-invariant order of own groups (node, then size, then charges)."""
        return (self.key(node_of(g)), -g.units, -g.charged)

    def may_leave(self, ctx: Ctx, g: GroupView) -> bool:
        """Whether ``g`` may leave its node: the capital keeps ``guard`` units at home."""
        here = node_of(g)
        if here != self.home:
            return True
        return ctx.standing[here] - g.units >= self.params["guard"]

    def _attack(self, ctx: Ctx) -> None:
        groups = self.free_groups(ctx)
        for opt in self.options(ctx, groups):
            if opt.group.id in ctx.used or opt.dest in ctx.claimed:
                continue
            cmd = Move(opt.group.id, opt.dest, planned=opt.planned)
            if self.spend(ctx, cmd):
                ctx.used[opt.group.id] = True
                ctx.claimed[opt.dest] = True
                ctx.standing[node_of(opt.group)] -= opt.group.units
                estimate = self.estimate(ctx.view, ctx.tick, opt.dest)
                self.waves[opt.dest] = Wave(ctx.tick, opt.group.charged, estimate)
        self._guard_split(ctx)

    def _guard_split(self, ctx: Ctx) -> None:
        """Split the spare units off the group that holds the capital, so they can march.

        Only when the spare units alone could take a target; ``Split`` hands the charged units to
        the new group first (SIM-04), and the new group gets an order in the next decision.
        """
        spare = ctx.standing[self.home] - self.params["guard"]
        if spare < 2:
            return
        for g in self.free_groups(ctx):
            if node_of(g) != self.home or g.units <= spare:
                continue
            army = self.fake_group(g, spare, min(spare, g.charged))
            if self.options(ctx, [army]) and self.spend(ctx, Split(g.id, spare)):
                ctx.used[g.id] = True
                return

    @staticmethod
    def fake_group(like: GroupView, units: int, charged: int) -> GroupView:
        """A group that does not exist yet (a split or a merge), to ask what it could take."""
        return GroupView(-1, units, charged, Mode.ATTACK, like.location, None)

    # Gathering ------------------------------------------------------------------------------

    def _gather(self, ctx: Ctx) -> None:
        by_node: dict[int, list[GroupView]] = {}
        for g in self.free_groups(ctx):
            by_node.setdefault(node_of(g), []).append(g)
        for node in sorted(by_node, key=self.key):
            groups = by_node[node]
            if len(groups) < 2:
                continue
            if node == self.home:
                groups = [g for g in groups if self.may_leave(ctx, g)]
                if len(groups) < 2:
                    continue
            if not self._merge_pays(ctx, groups):
                continue
            if self.spend(ctx, Merge(tuple(g.id for g in groups))):
                for g in groups:
                    ctx.used[g.id] = True

    def _merge_pays(self, ctx: Ctx, groups: list[GroupView]) -> bool:
        """Whether the merged group can take a target that no single group can."""
        one = self.options(ctx, groups)
        merged = self.fake_group(
            groups[0], sum(g.units for g in groups), sum(g.charged for g in groups)
        )
        both = self.options(ctx, [merged])
        return bool(both) and (not one or both[0].score > one[0].score)

    # Rally ----------------------------------------------------------------------------------

    def _rally(self, ctx: Ctx) -> None:
        goal = self.objective(ctx)
        hops = self.hops[goal]
        for g in self.free_groups(ctx):
            here = node_of(g)
            if not self.may_leave(ctx, g) or g.charged == 0:
                continue
            best = min(
                (
                    n
                    for n in self.reachable(ctx.view, here, self.params["radius"])
                    if ctx.view.nodes[n].owner == self.player and hops[n] < hops[here]
                ),
                key=lambda n: (hops[n], self.key(n)),
                default=None,
            )
            if best is not None and self.spend(ctx, Move(g.id, best)):
                ctx.used[g.id] = True
                ctx.standing[here] -= g.units

    # Recruiting -----------------------------------------------------------------------------

    def _recruit(self, ctx: Ctx) -> None:
        view, cooldown = ctx.view, self.rules.recruit.cooldown_ticks
        if ctx.budget - self.cost(Recruit(0)) < self.params["recruit_keep"]:
            return
        if self.rules.recruit.location is RecruitLocation.CAPITAL:
            candidates = [self.home]
        else:
            candidates = [n.id for n in view.nodes]
        hops = self.hops[self.objective(ctx)]
        cities = [
            n
            for n in candidates
            if view.nodes[n].owner == self.player
            and ctx.standing[n] < view.nodes[n].capacity
            and ctx.tick - self.recruited.get(n, ctx.tick - cooldown) >= cooldown
        ]
        if not cities:
            return
        city = min(cities, key=lambda n: (hops[n], self.key(n)))
        if self.spend(ctx, Recruit(city)):
            self.recruited[city] = ctx.tick
            ctx.standing[city] += 1
