"""``smart_hoarder``: the benchmark of the owner's winning plan (#624; playtest 2026-10-30).

The owner beat the hard smart bots 4 of 4 on ``crossroads`` with one plan
(``docs/balance/playtest-2026-10-30.md``, "The human's capital strikes"). This personality of
``SmartBot`` plays it, so the other smart bots have a yardstick to learn against:

1. **Expansion in groups toward the centre.** War all match (the human: 99.8% of the ticks),
   the territory play of ``smart_expander`` with two changes: a group of fewer than
   ``min_group`` units claims nothing (the human moved in groups of 2-3, the bots claimed with
   single units and lost them), and the *centre* weighs ``w_centre`` more as a target: the large
   city (the largest non-capital kind) whose hops to the two capitals differ least
   (``crossroads``: Crossroads). The enemy capital is never a single target (``SmartBot.STRIKE``).
2. **A forward barracks in the centre** (DEC-26) as soon as it is held: its price is kept from
   the other spending until it is paid (``held_cp``); the recruits appear there, nearest the
   enemy (the human: Crossroads at tick 1105-1118, 14-15 recruits there).
3. **The build-up.** From tick ``hoard`` on, a recruit comes before the claims (at any CP)
   while the army has fewer units than a strike needs plus ``army``, and the groups in a city
   with a barracks march: they take only the nodes on their way to the objective and rally to
   it. The objective is the centre while the charged units of the army (``force``) are short of
   a strike plus ``spare``, then the *stage*: the largest city next to the enemy capital
   (``crossroads``: Middle Court, capacity 8; the human took it 490-990 ticks before each
   strike). While it advances, every charged group marches (they merge where they stand and
   walk to the own node nearest the stage, ``spearhead``), the stage weighs ``w_stage`` more
   as a target, and the groups in own nodes within ``held_hops`` of the enemy capital take only
   nodes there and walk into the stage while it has room (``consolidate``).
4. **The strike** is ``SmartBot`` item 12: the free charged groups within ``STRIKE_HOPS`` edges
   of the enemy capital, ordinary orders for the groups next to it, scheduled ones for the
   groups two or more edges away with a bonus of 2 or more (DEC-29) while the strike is
   short (``plan_strike``: the human's choice; the five personalities keep the shared price
   utility ``prefer_planned``), all timed to arrive together; it waits until the pool reaches
   the estimate plus ``strike_margin`` and banks the CP meanwhile (the human: CP at the cap
   before the strike, 11-17 charged units in 2-4 groups, 2-8 plan shots).

5. **Economy v2** (DEC-41, ``economy.model = "v2"``): the hoard (the centre, then the stage) is
   the first target of a supply line, so its warehouse fills, and every group of the strike that
   can gather a bonus from the warehouse it stands in goes planned with the shots the strike
   still misses (DEC-41, item 10); no bunkers.

Deterministic and mirror-invariant like every smart bot: the centre and the stage are chosen by
the public map with ``node_key`` ties.
"""

from collections.abc import Mapping
from typing import ClassVar, Final, override

from gow_bots.bots.assess import Assessment
from gow_bots.bots.base import ParamRange, node_of
from gow_bots.bots.campaign import Ctx, Option
from gow_bots.bots.smart import SmartBot, SmartExpander
from gow_bots.bots.tempo import DEFAULT_DIFFICULTY
from gow_sim.commands import BuildBarracks, Command, Merge, Move, Split
from gow_sim.maps import MapDef
from gow_sim.ruleset import Ruleset
from gow_sim.view import GroupView, PlayerView, Stance

__all__ = ["BENCHMARKS", "SmartHoarder"]

W_HOARD: Final = 10
"""Economy v2: the weight of the hoard among the nodes that want charges (``line_extra``)."""


class SmartHoarder(SmartBot):
    """The owner's staging strike (module docstring)."""

    name: ClassVar[str] = "smart_hoarder"
    STANCE: ClassVar[Stance] = Stance.WAR
    STRIKE: ClassVar[bool] = True
    STRIKE_ONLY: ClassVar[bool] = True
    STRIKE_BANK: ClassVar[bool] = True
    STRIKE_MIN: ClassVar[int] = 1
    BUNKERS: ClassVar[int] = 0
    """Economy v2: the yardstick attacks, it does not dig in."""
    ANSWERS: ClassVar[bool] = False
    """The yardstick stays as it was measured (#624, PR 1): none of items 13-17."""
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {
        **SmartExpander.PARAMS,
        "radius": ParamRange(3, 4),
        "margin": ParamRange(1, 1),
        "guard": ParamRange(2, 2),
        "hold_front": ParamRange(0, 0),
        "late": ParamRange(0, 0),
        "worth_defense": ParamRange(2, 2),
        "hoard": ParamRange(2400, 3600),
        "held_hops": ParamRange(2, 2),
        "min_group": ParamRange(2, 2),
        "strike_margin": ParamRange(2, 3),
        "strike_guess": ParamRange(4, 5),
        "w_centre": ParamRange(300, 300),
        "w_stage": ParamRange(600, 600),
        "army": ParamRange(4, 4),
        "spare": ParamRange(2, 3),
    }

    def __init__(
        self,
        mapdef: MapDef,
        rules: Ruleset,
        *,
        seed: int,
        player: int,
        difficulty: str = DEFAULT_DIFFICULTY,
    ) -> None:
        super().__init__(mapdef, rules, seed=seed, player=player, difficulty=difficulty)
        cap = rules.capacity.by_kind
        enemy = self.enemy_home
        ring = [mapdef.edges[e].other(enemy) for e in mapdef.incident[enemy]]
        self.stage = min(ring, key=lambda n: (-cap.of(mapdef.nodes[n].kind), self.key(n)))
        """The largest city next to the enemy capital (module docstring, item 3)."""
        self.advance = False
        """The build-up has left the centre for the stage (item 3)."""
        self.marchers: dict[int, bool] = {}
        """Opaque ids of the groups sent on the march (``marching``)."""
        self._march: dict[int, bool] = {}

    # Phases ---------------------------------------------------------------------------------

    def hoarding(self, tick: int) -> bool:
        return tick >= self.params["hoard"]

    def target(self) -> int:
        """Where the build-up goes now: the centre, then the stage (item 3)."""
        return self.stage if self.advance else self.centre

    def force(self, ctx: Ctx) -> int:
        """Own charged units of the whole army (item 3)."""
        return sum(g.charged for g in ctx.view.groups)

    def _phase(self, ctx: Ctx) -> None:
        if not self.hoarding(ctx.tick):
            self.advance = False
            return
        if not self.advance:
            self.advance = self.force(ctx) >= self.strike_need(ctx) + self.params["spare"]
        elif self.strike is None and ctx.tick < self.strike_rest:
            self.advance = False  # a strike went: build up again at the centre

    def held(self, ctx: Ctx, node: int) -> bool:
        """An own node of the advance: within ``held_hops`` of the enemy capital (item 3)."""
        return (
            self.advance
            and node != self.home
            and ctx.view.nodes[node].owner == self.player
            and self.hops[node][self.enemy_home] <= self.params["held_hops"]
        )

    def marching(self, ctx: Ctx, g: GroupView) -> bool:
        """Item 3: a charged group in an own city with a barracks (the recruits) or sent on the
        march, and while advancing every charged group outside the held nodes."""
        here = node_of(g)
        if not self.hoarding(ctx.tick) or g.charged == 0 or here == self.target():
            return False
        if self.held(ctx, here):
            return False
        if self.advance:
            return True
        return g.id in self.marchers or bool(ctx.view.nodes[here].has_barracks)

    # Decision hooks -------------------------------------------------------------------------

    @override
    def _decide(self, view: PlayerView, tick: int, a: Assessment) -> list[Command]:
        live = {g.id for g in view.groups}
        self.marchers = {g: True for g in sorted(self.marchers) if g in live}
        return super()._decide(view, tick, a)

    @override
    def held_cp(self, ctx: Ctx) -> int:
        """The plan's CP (``SmartBot`` item 10), and the price of the wanted barracks (item 2)."""
        self._phase(ctx)
        held = super().held_cp(ctx)
        if self.wanted_barracks(ctx.view) is not None:
            held = max(held, self.rules.orders.cost.barracks)
        return held

    @override
    def spend(self, ctx: Ctx, cmd: Command) -> bool:
        march = isinstance(cmd, Move) and cmd.group in self._march
        if isinstance(cmd, BuildBarracks) and ctx.held:
            held, ctx.held = ctx.held, 0  # the barracks is what its CP were kept for
            try:
                return super().spend(ctx, cmd)
            finally:
                ctx.held = held
        if not super().spend(ctx, cmd):
            return False
        if march and isinstance(cmd, Move):
            self.marchers[cmd.group] = True
        return True

    @override
    def line_extra(self, ctx: Ctx) -> dict[int, int]:
        """Economy v2 (item 5): the hoard, the centre and then the stage, gets its line first:
        its warehouse feeds the plans of the strike that goes from there."""
        return {self.target(): W_HOARD}

    @override
    def wanted_stance(self, a: Assessment) -> Stance:
        return self.STANCE

    @override
    def wanted_barracks(self, view: PlayerView) -> int | None:
        """The centre, once held, without a barracks and without a build or a fight (item 2)."""
        if not self.rules.city_upgrades.enabled:
            return None
        n = view.nodes[self.centre]
        if n.owner != self.player or n.has_barracks or n.building is not None:
            return None
        if self.centre in self.fight_nodes(view):
            return None
        return self.centre

    @override
    def score(self, ctx: Ctx, g: GroupView, dest: int, need: int) -> int | None:
        value = super().score(ctx, g, dest, need)
        if value is None:
            return None
        if dest == self.stage and self.advance:
            return value + self.params["w_stage"]
        if dest == self.centre:
            return value + self.params["w_centre"]
        return value

    @override
    def objective(self, ctx: Ctx) -> int:
        return self.target() if self.hoarding(ctx.tick) else self.centre

    @override
    def options(self, ctx: Ctx, groups: list[GroupView]) -> list[Option]:
        small = self.params["min_group"]
        found = [o for o in super().options(ctx, groups) if o.group.units >= small]
        if not self.hoarding(ctx.tick):
            return found
        goal, near = self.hops[self.target()], self.hops[self.enemy_home]
        held = self.params["held_hops"]
        kept: list[Option] = []
        for o in found:
            here = node_of(o.group)
            if self.held(ctx, here) and near[o.dest] > held:
                continue  # the build-up does not march off to claims
            if self.marching(ctx, o.group) and goal[o.dest] >= goal[here]:
                continue  # on the march: only the nodes on the way
            kept.append(o)
        return kept

    @override
    def _attack(self, ctx: Ctx) -> None:
        army = self.params["army"]
        if army and self.hoarding(ctx.tick):
            units = sum(g.units for g in ctx.view.groups)
            if units < self.strike_need(ctx) + army:
                keep = self.params["recruit_keep"]
                self.params["recruit_keep"] = 0
                try:
                    self._recruit(ctx)  # bodies before claims
                finally:
                    self.params["recruit_keep"] = keep
        super()._attack(ctx)

    @override
    def _rally(self, ctx: Ctx) -> None:
        self._march = {g.id: True for g in self.free_groups(ctx) if self.marching(ctx, g)}
        try:
            if self.advance:
                self.spearhead(ctx)
            super()._rally(ctx)
        finally:
            self._march = {}
        self.consolidate(ctx)

    def spearhead(self, ctx: Ctx) -> None:
        """While advancing, the marching groups merge where they stand and walk to one own node,
        the nearest to the stage (the largest, then ``node_key``), so the next node on the way
        meets one group, not several small ones (item 3)."""
        view = ctx.view
        to_stage = self.hops[self.stage]
        own = [
            n.id
            for n in view.nodes
            if n.owner == self.player and n.id not in self.fight_nodes(view) and to_stage[n.id] >= 0
        ]
        if not own:
            return
        spear = min(own, key=lambda n: (to_stage[n], -view.nodes[n].capacity, self.key(n)))
        by_node: dict[int, list[GroupView]] = {}
        for g in self.free_groups(ctx):
            if g.id in self._march:
                by_node.setdefault(node_of(g), []).append(g)
        far = len(self.map.nodes)
        for node in sorted(by_node, key=self.key):
            groups = by_node[node]
            if len(groups) >= 2 and self.spend(ctx, Merge(tuple(g.id for g in groups))):
                for g in groups:
                    ctx.used[g.id] = True
                continue
            g = groups[0]
            if node == spear or to_stage[node] <= to_stage[spear]:
                continue
            room = view.nodes[spear].capacity - ctx.standing[spear]
            if g.units > room or spear not in self.reachable(view, node, far, g.units):
                continue
            if self.spend(ctx, Move(g.id, spear)):
                ctx.used[g.id] = True
                ctx.standing[node] -= g.units
                ctx.standing[spear] += g.units

    def consolidate(self, ctx: Ctx) -> None:
        """While advancing, the charged groups in the other held nodes walk into the held stage
        while it has room (item 3): a strike goes from the stage and its neighbours."""
        view, stage = ctx.view, self.stage
        if not self.advance or view.nodes[stage].owner != self.player:
            return
        if stage in self.fight_nodes(view):
            return
        room = view.nodes[stage].capacity - ctx.standing[stage]
        for g in self.free_groups(ctx):
            here = node_of(g)
            if room <= 0:
                return
            if here == stage or g.charged == 0 or not self.held(ctx, here) or g.units > room:
                continue
            if self.pinned[here] or stage not in self.reachable(view, here, 2, g.units):
                continue
            if self.spend(ctx, Move(g.id, stage)):
                ctx.used[g.id] = True
                ctx.standing[here] -= g.units
                ctx.standing[stage] += g.units
                room -= g.units

    @override
    def _guard_split(self, ctx: Ctx) -> None:
        """The capital's spare units split off to march (item 3) even without a target for them;
        the base split asks for one."""
        super()._guard_split(ctx)
        if not self.hoarding(ctx.tick) or self.alarm:
            return
        spare = ctx.standing[self.home] - self.params["guard"]
        if spare < self.params["min_group"]:
            return
        for g in self.free_groups(ctx):
            if node_of(g) == self.home and g.units > spare and g.charged > 0:
                if self.spend(ctx, Split(g.id, spare)):
                    ctx.used[g.id] = True
                return

    @override
    def striking(self) -> bool:
        return True  # at every level: the strike is the plan

    @override
    def plan_strike(self, g: GroupView, missing: int, edges: int, bonus: int = 0) -> bool:
        """The human's choice, not the price utility (item 4): a group two or more edges away
        whose charged units take the whole bonus goes planned while the strike is short (the
        owner planned 1-3 small groups from 1-3 edges in every winning strike). Under v2 every
        group that can gather a bonus from its warehouse does (the hoard, item 5)."""
        if self.rules.v2:
            return bonus >= 1
        return edges >= 2 and self.rules.orders.planned_bonus(edges, g.charged) >= 2

    @override
    def strike_wanted(self, ctx: Ctx) -> bool:
        return self.advance


BENCHMARKS: tuple[type[SmartBot], ...] = (SmartHoarder,)
"""Smart bots that are yardsticks, not personalities of the server levels."""
