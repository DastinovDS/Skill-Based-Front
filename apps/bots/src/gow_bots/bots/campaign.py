"""The common campaign play of Rusher, Strangler and Reactive (BOT-03).

One decision (every 5 ticks) goes in a fixed order, and CP is spent in the same order, so the
scarce resource (about 0.5 CP per 50 ticks, mechanics.md, section 6) goes to the useful things
first:

1. ``recall``: an attack on the way whose target turned out stronger (exact numbers seen this
   tick) is cancelled, the group turns back (free since DEC-20, but the order's CP are not
   refunded); with ``DISCIPLINE`` (#687) only an attack that would lose units, and the target
   waits ``RECALL_TICKS`` for a group with more shots than the recall saw;
2. ``respond`` (a hook; ``ReactiveBot`` answers the visible intents of the enemy here);
3. attacks and captures: every idle group looks at the nodes it can reach under the stack limit
   (DEC-20, D), a node is a *viable target* when the group's charges are enough to take it
   (``shots_to_take`` against the estimate of the enemy below, plus ``margin``, and the price of
   the capture on top: ``capture.charge_cost`` real charges, DEC-38, ``takes``; the toll of a
   visible enemy road fortification on the road in comes off the real charges first, an empty
   node too: DEC-43, item D6, ``Bot.toll_from``, #760), and ``score``
   ranks the viable (group, target) pairs; a group too big for every path to a target splits off
   an army that fits and could take it (``fit_split``), the army goes in the next decision;
4. ``gather``: groups standing in one node are merged when together they can take a target
   that none of them can take alone (and the merged group still fits the path);
5. ``rally``: groups without a target walk to the own node closest to the objective (a group too
   big for the way splits off the part that fits);
6. ``recruit``: one new unit in the own city closest to the objective, while CP is left.

Groups that arrive in an own node merge on their own (DEC-20, A), so a rally point gathers the
army without a ``Merge``.

Capacity (#686): units standing in an own node above its capacity die one every
``capacity.attrition_ticks`` (DEC-12), so no command puts a node over it at the arrival. The load of
a node is the own units standing there plus the own units on the way into it (``Ctx.incoming``:
ordered there, or turning back to it on an edge). ``spend`` refuses a move of a standing group into
an own node the group does not fit (a group leaving a fight is exempt), ``recall`` cancels only
into a node with room for the group, ``rally`` sends at most the free room (a split), and a
recruit is queued only while the load leaves room for it.

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
from gow_bots.bots.economy import (
    FactorySites,
    LeafShift,
    bunker_site,
    factory_site,
    fort_site,
    leaf_shift_command,
    line_commands,
    release_commands,
    wants,
)
from gow_bots.bots.utility import defender_pool, prefer_planned, shots_to_take, takes
from gow_sim.commands import (
    BuildBunker,
    BuildFactory,
    CancelOrder,
    Command,
    FortifyRoad,
    Merge,
    Move,
    Recruit,
    ReleasePlan,
    SetStance,
    Split,
)
from gow_sim.maps import MapDef
from gow_sim.ruleset import Ruleset
from gow_sim.view import AtNode, GroupView, Mode, OnEdge, PlayerView, Stance

__all__ = ["CampaignBot", "Ctx", "Option"]

MIN_WAVE_TICKS = 10
"""A wave is judged failed no sooner than this many ticks after the order (the order shows up in
the next view)."""
MAX_EXTRA = 4
"""Largest extra demand added to a node by failed waves."""
STALE_TICKS = 600
"""A remembered enemy strength older than this is dropped (the enemy recruits and recharges)."""
RECALL_TICKS = 300
"""Cancel discipline (#687): a target an attack was recalled from is not ordered again for this
many ticks by a group whose shots do not beat what the recall saw there (no cancel and reissue
loop on the same target)."""
PERMILLE = 1000
"""An edge in thousandths: the scale of ``border_permille`` and of ``OnEdge.progress``."""


@dataclass(frozen=True, slots=True)
class Option:
    """A viable attack: ``group`` takes ``dest``; ``need`` shots, a planned order or not."""

    score: int
    group: GroupView
    dest: int
    planned: bool
    need: int
    bonus: int = 0
    """Economy v2: the bonus a planned order requests (DEC-41, item 10); 0 otherwise."""


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
    held: int = 0
    """CP in hundredths kept for a chosen scheduled order (``SmartBot``): the rest leaves them."""
    saved: int = 0
    """CP in hundredths the routine spending leaves for a push or a fortification the bot decided
    on (``SmartBot``, item 23, #687), scheduled orders included; 0: nothing saved."""
    incoming: list[int] = field(default_factory=list[int])
    """Own units on the way into each own node (#686): ordered there in an earlier decision or
    in this one (``spend`` adds every accepted move), or turning back to it on an edge
    (``OnEdge.back``: a cancel or a bounce returns to the start of the edge)."""
    groups: dict[int, GroupView] = field(default_factory=dict[int, GroupView])
    """Own groups of the view by opaque id."""

    def __post_init__(self) -> None:
        view = self.view
        self.groups = {g.id: g for g in view.groups}
        if not self.standing:
            self.standing = [0] * len(view.nodes)
            for g in view.groups:
                if isinstance(g.location, AtNode):
                    self.standing[g.location.node] += g.units
        if not self.incoming:
            self.incoming = incoming(view)


def incoming(view: PlayerView) -> list[int]:
    """Own units on the way into each own node (``Ctx.incoming``): the groups with an order to
    an own node they do not stand in, and the groups turning back on an edge."""
    units = [0] * len(view.nodes)
    for g in view.groups:
        loc, order = g.location, g.order
        if isinstance(loc, OnEdge) and loc.back:
            units[loc.from_node] += g.units
        elif (
            order is not None
            and view.nodes[order.dest].owner == view.player
            and not (isinstance(loc, AtNode) and loc.node == order.dest)
        ):
            units[order.dest] += g.units
    return units


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
    FACTORIES: ClassVar[int] = 2
    """Economy v2: factories built beside the capital (``factory.max`` caps the sum)."""
    BUNKERS: ClassVar[int] = 0
    """Economy v2: bunkers kept at most (``bunker_site``)."""

    def __init__(self, mapdef: MapDef, rules: Ruleset, *, seed: int, player: int) -> None:
        super().__init__(mapdef, rules, seed=seed, player=player)
        self.gathering: dict[int, int] = {}
        """Economy v2: own group id to the tick its gathering plan was first seen."""
        self.lines_seen: dict[int, int] = {}
        """Economy v2: own line id to the tick it was first seen."""
        self.home = mapdef.capital(player)
        self.enemy_home = mapdef.capital(1 - player)
        self.recruited: dict[int, int] = {}
        self.stance_tick: int | None = None
        self.memory: dict[int, tuple[int, int, int]] = {}
        """Remembered enemy strength by node: ``(tick, units, charged)``."""
        self.extra: dict[int, int] = {}
        self.waves: dict[int, Wave] = {}
        self.recalled: dict[int, tuple[int, int]] = {}
        """Target to ``(tick, shots)`` of the last recall from it (``DISCIPLINE``): the shots the
        recall saw it take (``shots_to_take`` of the exact numbers) and the toll of the road in
        the recalled group still had to pay (DEC-43, item D6; #760)."""
        self._net_tick = -1
        self._net: frozenset[int] = frozenset()
        self.leaf = LeafShift()
        """The memory of the leaf shift policy (``economy.leaf_shift_command``)."""
        self.factory_sites = FactorySites()
        """The memory of the own factory builds (``economy.factory_site``, #683)."""

    # Decision -------------------------------------------------------------------------------

    @override
    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        self.check_view(view)
        ctx = Ctx(view, tick, view.me.cp - self.params["reserve"], standing=self.standing(view))
        for g in view.groups:
            if g.order is not None:
                ctx.claimed[g.order.dest] = True
        self._learn(ctx)
        for cmd in self.fight_commands(view, tick, ctx.budget):  # DEC-24: fights first
            if self.spend(ctx, cmd) and isinstance(cmd, Move):
                ctx.used[cmd.group] = True
        self._stance(ctx)
        for cmd in self.fronts(view):  # front markers on the front cities (DEC-28)
            self.spend(ctx, cmd)
        self.economy_v2(ctx)  # lines, factories, bunkers, plans (DEC-41)
        cmd = self.development(ctx.view, ctx.budget)  # DEC-26, item 11: before the orders
        if cmd is not None:
            self.spend(ctx, cmd)
        self._recall(ctx)
        self.respond(ctx)
        self._attack(ctx)
        self._fit_split(ctx)
        self._gather(ctx)
        self._rally(ctx)
        self._recruit(ctx)
        return ctx.cmds

    # Economy v2 (DEC-41) ---------------------------------------------------------------------

    def economy_v2(self, ctx: Ctx) -> None:
        """The v2 play of ``gow_bots.bots.economy``: plans that waited depart, lines to the nodes
        that want charges, one factory and one bunker build at a time; under the supply flow no
        lines and no bunker, the leaf shift instead (DEC-43), and a road fortification when the
        CP near their cap (``fort_site``, item D). Nothing under v1."""
        if not self.rules.v2:
            return
        view = ctx.view
        for cmd in release_commands(self, view, self.gathering, ctx.tick):
            if self.spend(ctx, cmd) and isinstance(cmd, ReleasePlan | CancelOrder):
                ctx.used[cmd.group] = True
        for cmd in line_commands(
            self, view, wants(self, view, self.line_extra(ctx)), self.lines_seen
        ):
            self.spend(ctx, cmd)
        site = factory_site(self, view, self.FACTORIES, self.factory_sites)
        if site is not None:
            self.spend(ctx, BuildFactory(site))
        site = bunker_site(self, view, self.bunkers())
        if site is not None:
            self.spend(ctx, BuildBunker(site))
        road = fort_site(self, view, ctx.budget)  # DEC-43, item D: the CP sink of mvp-4
        if road is not None:
            self.spend(ctx, FortifyRoad(*road))
        shift = self.leaf_shift(ctx)  # the supply flow (DEC-43, item G)
        if shift is not None:
            self.spend(ctx, shift)

    def leaf_shift(self, ctx: Ctx) -> Command | None:
        """Hook: the leaf shift command of this decision (``economy.leaf_shift_command``)."""
        return leaf_shift_command(self, ctx.view, self.leaf)

    def line_extra(self, ctx: Ctx) -> dict[int, int]:
        """Hook: the weight a personality adds to own nodes that want charges (``wants``)."""
        return {}

    def bunkers(self) -> int:
        """Bunkers (and bunker builds) the bot keeps at most (``BUNKERS``)."""
        return self.BUNKERS

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
        """Send ``cmd`` if the CP pay for it. A move of a standing group into an own node is sent
        only when the units fit the node at the arrival (``room``, #686: a node over capacity
        loses a unit every ``capacity.attrition_ticks``, DEC-12); it then counts in
        ``Ctx.incoming``. A group leaving a fight is exempt: a lost fight costs a unit a round."""
        if not self.allowed(cmd):
            return False  # a command of the other economy model (DEC-41)
        into = self.moves_in(ctx, cmd)
        if into is not None and into[1] > self.room(ctx, into[0]):
            return False
        cost = self.cost(cmd)
        if cost > ctx.budget:
            return False
        ctx.budget -= cost
        ctx.cmds.append(cmd)
        if into is not None:
            ctx.incoming[into[0]] += into[1]
        return True

    def moves_in(self, ctx: Ctx, cmd: Command) -> tuple[int, int] | None:
        """``(node, units)`` when ``cmd`` moves an own standing group outside any fight into an
        own node (``spend``); ``None`` otherwise."""
        if not isinstance(cmd, Move) or ctx.view.nodes[cmd.dest].owner != self.player:
            return None
        g = ctx.groups.get(cmd.group)
        if g is None or not isinstance(g.location, AtNode) or g.location.node == cmd.dest:
            return None
        if any(g.id in f.groups for f in ctx.view.fights):
            return None
        return cmd.dest, g.units

    def load(self, ctx: Ctx, node: int) -> int:
        """Own units in ``node`` at the arrivals: those standing there and those on the way."""
        return ctx.standing[node] + ctx.incoming[node]

    def room(self, ctx: Ctx, node: int) -> int:
        """Units that still fit ``node`` (its public capacity, DEC-22) once the own units on the
        way have arrived; negative when it will be over."""
        return ctx.view.nodes[node].capacity - self.load(ctx, node)

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
        """Shots that take ``dest`` by the estimate, with the margin and the failed waves. The
        toll of a fortified road (DEC-43, item D6) is not in it: it takes real charges of the
        group before the fight, an empty node too, so the caller passes it to ``takes``
        (``toll_from``, ``toll_left``; #760)."""
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
        pool = defender_pool(self.rules, terrain, charged, 0)
        cancelled = min(wave.charged, pool)
        killed = max(0, wave.charged - pool)
        self.memory[dest] = (tick, max(0, units - killed), max(0, charged - cancelled))

    def _recall(self, ctx: Ctx) -> None:
        """Cancel an attack on the way when the target is seen exactly and is too strong for it
        (with the price of the capture, DEC-38: a group that could not pay would bounce).

        Free since DEC-20: the group turns back to the start of its edge. Only on numbers of
        this tick, so an old memory does not make the bot hesitate. Only into an own node with
        room for the group (#686): a group on an edge takes no new order (``GROUP_ON_EDGE``), so
        it cannot be sent elsewhere; it goes on and the attack decides.
        """
        view = ctx.view
        orders = self.rules.orders
        busy = self.fighting(view)
        for g in view.groups:
            loc = g.location
            if not isinstance(loc, OnEdge) or g.order is None or g.id in busy:
                continue
            if self.committed(g.id):
                continue  # one wave of several: the target is judged against all of them
            back = loc.from_node
            if view.nodes[back].owner == self.player and self.room(ctx, back) < g.units:
                continue  # #686: the way back ends over capacity
            dest = g.order.dest
            seen = view.nodes[dest].seen
            if view.nodes[dest].owner == self.player or seen is None or seen.tick != view.tick:
                continue
            if self.enemy_at(view, dest) is None:
                continue
            # The bonus was set by the whole path at the departure (DEC-29); the edges still to
            # go are a lower bound of it.
            if self.rules.v2:
                bonus = g.order.bonus  # gathered, active from the departure (DEC-41, item 10)
            elif g.order.planned:
                bonus = orders.planned_bonus(len(g.order.path), g.charged)
            else:
                bonus = 0
            toll = self.toll_left(view, g, dest)
            if self.DISCIPLINE:
                if not self.recall_pays(view, g, dest, bonus, toll):
                    if view.nodes[back].owner == self.player and not self.wins(
                        view, g, dest, bonus, toll
                    ):
                        ctx.incoming[back] += g.units  # #686: the bounce comes back here
                    continue
            elif takes(self.rules, g.charged, bonus, self.need(view, ctx.tick, dest), toll):
                continue
            if self.spend(ctx, CancelOrder(g.id)):
                ctx.used[g.id] = True
                ctx.claimed.pop(dest, None)
                if view.nodes[back].owner == self.player:
                    ctx.incoming[back] += g.units
                if self.DISCIPLINE:
                    # #760: with the toll it saw, so a group the toll leaves short again waits.
                    self.recalled[dest] = (ctx.tick, self.seen_shots(view, dest) + toll)

    def toll_left(self, view: PlayerView, g: GroupView, dest: int) -> int:
        """The toll ``g``, on an edge on its way to ``dest``, still pays on the way in (DEC-43,
        item D6): its own order names the last node before ``dest`` (``OrderView.path``), so the
        road in is known; on that road a group past the line point (item D5) has paid already,
        its charges are what is left."""
        loc, order = g.location, g.order
        if not isinstance(loc, OnEdge) or order is None or not order.path:
            return 0
        if len(order.path) >= 2:
            last = order.path[-2]
            way = next(e for e in self.map.incident[last] if self.map.edges[e].other(last) == dest)
            return self.toll_on(view, way, dest, g.units, g.charged)
        edge = self.map.edges[loc.edge]
        if loc.back or edge.other(loc.from_node) != dest:
            return 0
        line = edge.border_permille if dest == edge.b else PERMILLE - edge.border_permille
        if loc.progress >= line:
            return 0
        return self.toll_on(view, loc.edge, dest, g.units, g.charged)

    def recall_pays(
        self, view: PlayerView, g: GroupView, dest: int, bonus: int, toll: int = 0
    ) -> bool:
        """Cancel discipline (#687): whether turning ``g`` back from ``dest`` saves more than it
        costs. The order's CP are spent either way (``orders.cost.cancel`` refunds nothing,
        DEC-20, C) and the cancel takes a command, so the cancel pays only when the attack would
        lose units: the defenders' pool ``Qd`` (the exact numbers of this tick, the terrain and a
        bunker, ``defender_pool``) is above the group's charges and bonus less the ``toll`` of a
        fortified road still ahead (DEC-43, item D6, ``toll_left``). Otherwise the attack at worst
        bounces (DEC-07, rules 2 to 4: ``min(Qa, Qd)`` charges cancel on both sides, the surplus
        kills defenders, nobody of the group dies) and the CP already paid buy that trade. Under a
        capture price (DEC-38) an attack that would kill every defender and not pay is recalled
        too: the bots do not repeat unpaid captures (#580)."""
        seen = self.enemy_at(view, dest)
        if seen is None:
            return False
        terrain = self.map.nodes[dest].terrain
        qd = defender_pool(self.rules, terrain, seen[1], self.defended(view, dest))
        real = max(0, g.charged - toll)
        qa = real + min(bonus, real)
        if qd > qa:
            return True
        clears = qa >= qd + seen[0]
        return clears and not takes(self.rules, g.charged, bonus, qd + seen[0], toll)

    def wins(self, view: PlayerView, g: GroupView, dest: int, bonus: int, toll: int = 0) -> bool:
        """Whether ``g`` takes ``dest`` by the numbers the view shows there now (``seen_shots``,
        the capture price, DEC-38, the ``toll`` still ahead); otherwise it bounces back to the
        start of its edge."""
        return takes(self.rules, g.charged, bonus, self.seen_shots(view, dest), toll)

    def seen_shots(self, view: PlayerView, dest: int) -> int:
        """The shots that take ``dest`` by the numbers the view shows there now (``need`` without
        the margin and the failed waves; the toll is the caller's, ``takes``)."""
        seen = self.enemy_at(view, dest)
        if seen is None or seen[0] <= 0:
            return 0
        terrain = self.map.nodes[dest].terrain
        return shots_to_take(self.rules, terrain, seen[0], seen[1], self.defended(view, dest))

    def recall_holds(self, tick: int, dest: int, shots: int) -> bool:
        """``DISCIPLINE``: an attack of ``shots`` (charges and bonus) on ``dest`` waits, the target
        was recalled from within ``RECALL_TICKS`` and the attack does not beat what the recall
        saw there (``recalled``: the shots and the toll of the way in) with the price of the
        capture: a recall for a capture it could not pay is not reissued with the same shortfall,
        an empty node behind a toll too (#760)."""
        last = self.recalled.get(dest)
        if last is None:
            return False
        if tick - last[0] >= RECALL_TICKS:
            del self.recalled[dest]
            return False
        return shots < last[1] + self.rules.capture.charge_cost

    def committed(self, group: int) -> bool:
        """Hook: own group ``group`` is one of several groups sent together (``SmartBot``)."""
        return False

    # Attacks --------------------------------------------------------------------------------

    def options(self, ctx: Ctx, groups: list[GroupView]) -> list[Option]:
        """Viable attacks of ``groups`` on nodes in reach, best first."""
        view, rules = ctx.view, self.rules
        found: list[Option] = []
        for g in groups:
            if g.charged < rules.capture.charge_cost or not self.may_leave(ctx, g):
                continue  # DEC-38: a group that cannot pay a capture takes nothing (``takes``)
            here = node_of(g)
            for dest in self.reachable(view, here, self.params["radius"], g.units):
                if view.nodes[dest].owner == self.player or dest in ctx.claimed:
                    continue
                need = self.need(view, ctx.tick, dest)
                # DEC-43, item D6: a fortified road in takes real charges first, an empty node
                # too (#760: else a group of 1 charge is sent, cannot pay and is recalled).
                toll = self.toll_from(view, here, dest, g.units, g.charged)
                real = g.charged - toll
                # The v2 bonus does not grow with the distance (DEC-41, item 10).
                edges = 0 if rules.v2 else self.path_edges(view, here, dest, g.units)
                bonus = self.plan_bonus(view, here, edges, g.charged)
                # DEC-38: the charges must also pay the capture; virtual shots never pay.
                plain = takes(rules, g.charged, 0, need, toll)
                plan = bonus >= 1 and takes(rules, g.charged, bonus, need, toll)
                if not (plain or plan):
                    continue
                planned = plan and (not plain or prefer_planned(rules, real, need, edges))
                # Under v2 the plan asks for the shots it misses only (DEC-41, item 10).
                ask = max(1, need + rules.capture.charge_cost - real)
                shots = g.charged + (min(bonus, ask) if planned else 0)
                if self.DISCIPLINE and self.recall_holds(ctx.tick, dest, shots):
                    continue  # #687: no reissue of a recalled attack without more shots
                score = self.score(ctx, g, dest, need)
                if score is not None:
                    found.append(Option(score, g, dest, planned, need, min(bonus, ask)))
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
            cmd = self.order(opt.group.id, opt.dest, opt.planned, opt.bonus)
            if self.spend(ctx, cmd):
                ctx.used[opt.group.id] = True
                ctx.claimed[opt.dest] = True
                ctx.standing[node_of(opt.group)] -= opt.group.units
                estimate = self.estimate(ctx.view, ctx.tick, opt.dest)
                self.waves[opt.dest] = Wave(ctx.tick, opt.group.charged, estimate)
            else:
                self.short(ctx, opt, cmd)
        self._guard_split(ctx)

    def short(self, ctx: Ctx, opt: Option, cmd: Move) -> None:
        """Hook: the attack ``cmd`` of ``opt`` was not paid (``SmartBot`` saves CP for a plan)."""

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

    def _fit_split(self, ctx: Ctx) -> None:
        """A free group too big for the paths to its targets splits off an army that fits.

        The army (the new group of ``Split``, charged units first) has the size of the biggest
        group that reaches the target (``fit``) and must be able to take it; it gets its order in
        the next decision. The best such target by ``score`` decides the size.
        """
        view, radius = ctx.view, self.params["radius"]
        for g in self.free_groups(ctx):
            here = node_of(g)
            # The capital keeps ``guard`` units: only the rest may split off.
            spare = g.units - 1
            if here == self.home:
                spare = min(spare, ctx.standing[here] - self.params["guard"])
            if spare < 1 or g.charged < self.rules.capture.charge_cost or self.options(ctx, [g]):
                continue  # DEC-38: the army gets the charged units first, none can pay
            best: tuple[int, int] | None = None
            for dest in self.reachable(view, here, radius):
                if view.nodes[dest].owner == self.player or dest in ctx.claimed:
                    continue
                size = min(spare, self.fit(view, here, dest, g.units))
                if size < 1:
                    continue
                army = self.fake_group(g, size, min(size, g.charged))
                found = [o for o in self.options(ctx, [army]) if o.dest == dest]
                if found and (best is None or found[0].score > best[0]):
                    best = (found[0].score, size)
            if best is not None and self.spend(ctx, Split(g.id, best[1])):
                ctx.used[g.id] = True

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
        """Free charged groups walk to the own node nearest the objective that has room for at
        least one unit at the arrival (#686); a group bigger than that room (or the way)
        splits off the part that fits, which walks in the next decision."""
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
                    if ctx.view.nodes[n].owner == self.player
                    and hops[n] < hops[here]
                    and self.room(ctx, n) >= 1
                ),
                key=lambda n: (hops[n], self.key(n)),
                default=None,
            )
            if best is None:
                continue
            size = min(self.fit(ctx.view, here, best, g.units), self.room(ctx, best))
            if size == g.units and self.spend(ctx, Move(g.id, best)):
                ctx.used[g.id] = True
                ctx.standing[here] -= g.units
            elif 1 <= size < g.units and self.spend(ctx, Split(g.id, size)):
                ctx.used[g.id] = True  # the part that fits rallies in the next decision

    # Recruiting -----------------------------------------------------------------------------

    def _recruit(self, ctx: Ctx) -> None:
        view = ctx.view
        if ctx.budget - self.cost(Recruit(0)) < self.params["recruit_keep"]:
            return
        hops = self.hops[self.objective(ctx)]
        cities = [
            n.id
            for n in view.nodes
            if self.recruited.get(n.id) != ctx.tick
            and self.can_queue(view, n.id, self.load(ctx, n.id))  # #686: the arrivals too
        ]
        if not cities:
            return
        # Closest to the objective, but not in a front city: a queue there is lost with the
        # city (DEC-25, items 10 and 13); the next rear city is a few seconds away.
        city = min(cities, key=lambda n: (self.front(view, n), hops[n], self.key(n)))
        if self.spend(ctx, Recruit(city)):
            self.recruited[city] = ctx.tick
            ctx.standing[city] += 1
