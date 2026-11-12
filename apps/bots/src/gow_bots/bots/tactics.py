"""Shared tactics of the strategy bots (BOT-02, BOT-03): one decision turn and its building blocks.

A strategy bot answers ``decide`` in a fixed order of priorities; each priority is a method of
``StrategyBot`` that spends the CP budget of the turn (``Turn.budget``) and marks the groups it
commanded. The pieces are the same for every strategy, only the order, the region the bot cares
about and the numbers (``PARAMS``) differ:

- ``guard``: pick the groups that hold the capital and the front (they are not sent anywhere);
- ``claim``: capture neutral nodes next to own territory; a free group goes, otherwise a unit is
  recruited at an own node next door (it leaves on the next decision);
- ``strike``: attack enemy nodes next to own territory when the force suffices;
- ``reinforce``: fill the garrisons that are below their minimum from free groups or by recruiting;
- ``strengthen``: spend CP that would otherwise burn on the cap on recruits at the front;
- ``prioritize``: a factory build (DEC-41, ``front_factory_site``: the site rule of the smart bots
  before #683, kept for these yardsticks).

Enemy strength (DEC-21). A view gives exact enemy numbers at ``EXACT`` detail (own nodes, nodes
where own groups stand, neighbours seen exactly by terrain); ``RANGE`` gives the range of the
units, ``PRESENCE`` only whether enemy groups are there. ``StrategyBot.estimate``
therefore returns, for an enemy node:

- ``(0, 0)`` when the node is observed now (not ``FOG``) and no enemy group is there: it falls
  without a fight (DEC-07, example 5);
- the exact numbers of this tick when they are in the view;
- on ``RANGE`` the top of the range (the start of the open last one), all of it charged, or the
  memory below if it is larger;
- otherwise (enemies present, numbers unknown) the larger of the last exact sighting, if it is
  not older than ``MEMORY_TICKS``, and ``capacity * est_pct // 100`` (at least 1) units, all of
  them taken as charged. ``est_pct`` is a parameter of the bot: a cautious bot guesses high.

The estimate is a guess, not a bound: an attack can bounce (both sides lose the charges, nobody
dies, DEC-07 rule 4), and the next sighting corrects the memory.

Stack limit (DEC-20, D): ``spend`` turns the move of a group too big for the way into the split
of an army that fits; the army is a free group of the next decision.

Tie-breaks are mirror-invariant (``Bot``): nodes by ``node_key``, edges by their mirrored id,
groups by ``Bot._group_key``. Nothing here draws from ``self.rng``, so the two sides of a
symmetric map decide alike when their parameters are alike.
"""

from collections.abc import Container
from dataclasses import dataclass, field
from typing import Final

from gow_bots.bots.base import Bot, node_of
from gow_bots.bots.utility import shots_to_take, takes, terrain_burned
from gow_sim.commands import BuildFactory, Command, Move, Recruit
from gow_sim.maps import MapDef, NodeKind
from gow_sim.ruleset import Ruleset
from gow_sim.view import Detail, GroupView, PlayerView

__all__ = ["MEMORY_TICKS", "StrategyBot", "Turn", "front_factory_site"]

FACTORIES: Final = 2
"""Factories built beside the capital (``front_factory_site``)."""
FACTORY_LATE_TICKS: Final = 1500
"""No factory is started with fewer ticks left (``front_factory_site``)."""
MEMORY_TICKS: Final = 600
"""How long an exact sighting of an enemy node stays a better guess than the capacity bound."""


@dataclass(slots=True)
class Turn:
    """State of one ``decide`` call: the view, the budget and what is already commanded."""

    view: PlayerView
    tick: int
    budget: int
    owner: list[int | None]
    standing: list[int]
    comp: list[int]
    """Component of own nodes (connected through own nodes) of every node; -1 for foreign ones."""
    groups: list[GroupView]
    """Idle own groups in mirror-invariant order."""
    threatened: list[bool]
    """Own nodes next to enemy territory or to a node with enemy groups."""
    guards: set[int] = field(default_factory=set[int])
    """Opaque ids of the groups that hold the capital and the front."""
    busy: set[int] = field(default_factory=set[int])
    """Groups that already got a command this turn."""
    taken: set[int] = field(default_factory=set[int])
    """Target nodes that have a group on the way or got one this turn."""
    deficits: list[tuple[int, int]] = field(default_factory=list[tuple[int, int]])
    """``(node, units missing)`` of the garrisons below their minimum, the most valuable first."""
    cmds: list[Command] = field(default_factory=list[Command])

    def free(self) -> list[GroupView]:
        return [g for g in self.groups if g.id not in self.busy and g.id not in self.guards]


class StrategyBot(Bot):
    """Base of the strategy bots: observation, enemy estimate and the shared priorities."""

    def __init__(self, mapdef: MapDef, rules: Ruleset, *, seed: int, player: int) -> None:
        super().__init__(mapdef, rules, seed=seed, player=player)
        self.capital = mapdef.capital(player)
        self.recruited: dict[int, int] = {}
        """Decision tick of the last recruit in each city: one unit per city and decision."""
        self.memory: dict[int, tuple[int, int, int]] = {}
        """Last exact sighting of the enemy per node: ``(units, charged, tick)``."""
        self.value: tuple[int, ...] = tuple(
            n.vp * (rules.victory.capital_multiplier if n.capital_of is not None else 1)
            for n in mapdef.nodes
        )
        """VP per accrual of every node (the value of owning it)."""

    # Observation -------------------------------------------------------------------------------

    def begin(self, view: PlayerView, tick: int) -> Turn:
        """Check the view, remember exact sightings and build the state of the turn."""
        self.check_view(view)
        me = view.player
        for n in view.nodes:
            seen = n.seen
            if (
                n.owner != me
                and seen is not None
                and seen.enemy_units is not None
                and seen.enemy_charged is not None
            ):
                self.memory[n.id] = (seen.enemy_units, seen.enemy_charged, seen.tick)
        owner = [n.owner for n in view.nodes]
        threatened = [False] * len(owner)
        for n, who in enumerate(owner):
            if who == me:
                threatened[n] = any(self._hostile(view, owner, m) for m in self.neighbors[n])
        for e in view.edges:  # DEC-33: an enemy group on the way to an own node threatens it
            edef = self.map.edges[e.id]
            for f in e.enemy_groups:
                target = edef.b if f.toward_b else edef.a
                if owner[target] == me:
                    threatened[target] = True
        turn = Turn(
            view=view,
            tick=tick,
            budget=view.me.cp,
            owner=owner,
            standing=self.standing(view),
            comp=self._components(owner),
            groups=self.idle_groups(view),
            threatened=threatened,
        )
        for g in view.groups:
            if g.order is not None:
                turn.taken.add(g.order.dest)
        for cmd in self.fight_commands(view, tick, turn.budget):  # DEC-24: fights first
            if self.spend(turn, cmd) and isinstance(cmd, Move):
                turn.busy.add(cmd.group)
        return turn

    def _components(self, owner: list[int | None]) -> list[int]:
        comp = [-1] * len(owner)
        label = 0
        for start in range(len(owner)):
            if owner[start] != self.player or comp[start] >= 0:
                continue
            comp[start] = label
            stack = [start]
            while stack:
                node = stack.pop()
                for other in self.neighbors[node]:
                    if comp[other] < 0 and owner[other] == self.player:
                        comp[other] = label
                        stack.append(other)
            label += 1
        return comp

    def _hostile(self, view: PlayerView, owner: list[int | None], node: int) -> bool:
        """Whether ``node`` is enemy territory or has enemy groups in it right now."""
        if owner[node] is not None and owner[node] != self.player:
            return True
        n = view.nodes[node]
        return n.detail is not Detail.FOG and n.seen is not None and bool(n.seen.enemy_modes)

    def estimate(self, turn: Turn, node: int, est_pct: int) -> tuple[int, int]:
        """``(units, charged)`` the enemy has in ``node``; see the module docstring."""
        n = turn.view.nodes[node]
        seen = n.seen
        if n.detail is not Detail.FOG:
            if seen is None or not seen.enemy_modes:
                return (0, 0)
            if seen.enemy_units is not None and seen.enemy_charged is not None:
                return (seen.enemy_units, seen.enemy_charged)
            if seen.enemy_range is not None:
                low, high = seen.enemy_range
                top = low if high is None else high
                mem = self.memory.get(node)
                if mem is not None and turn.tick - mem[2] <= MEMORY_TICKS:
                    top = max(top, mem[0])
                return (top, top)
        units = max(1, n.capacity * est_pct // 100)
        mem = self.memory.get(node)
        if mem is not None and turn.tick - mem[2] <= MEMORY_TICKS:
            return (max(units, mem[0]), max(units, mem[1]))
        return (units, units)

    # Spending ----------------------------------------------------------------------------------

    def spend(self, turn: Turn, cmd: Command, keep: int = 0) -> bool:
        """Queue ``cmd`` if at least ``keep`` CP (in hundredths) stay in the budget after it.

        A ``Move`` of a group too big for every path becomes the ``Split`` of the army that
        fits (``Bot.fitted``, DEC-20): the army goes in a later decision.
        """
        fitted = self.fitted(turn.view, cmd)
        if fitted is None:
            return False
        cmd = fitted
        cost = self.cost(cmd)
        if cost > turn.budget - keep:
            return False
        turn.budget -= cost
        turn.cmds.append(cmd)
        return True

    def prioritize(self, turn: Turn) -> None:
        """A factory build (DEC-41, ``front_factory_site``)."""
        view = turn.view
        site = front_factory_site(self, view, FACTORIES)
        if site is not None:
            self.spend(turn, BuildFactory(site))

    def recruit(self, turn: Turn, node: int, keep: int = 0) -> bool:
        """Queue one unit in ``node`` if the rules allow it there now (``Bot.can_queue``)."""
        if turn.owner[node] != self.player or self.recruited.get(node) == turn.tick:
            return False
        if not self.can_queue(turn.view, node, turn.standing[node]):
            return False
        if not self.spend(turn, Recruit(node), keep):
            return False
        self.recruited[node] = turn.tick
        turn.standing[node] += 1
        return True

    def attack(
        self, turn: Turn, g: GroupView, dest: int, need: int, margin: int, keep: int
    ) -> bool:
        """Send ``g`` to ``dest`` that needs ``need`` shots (``shots_to_take``) to be taken.

        A normal order when the charges of the group suffice with ``margin`` to spare; a planned
        order (DEC-08) when the bonus the group can gather makes them suffice (DEC-41, item 10).
        Either way the real charges must also pay the capture (DEC-38, ``takes``).
        """
        want = need + margin
        here = node_of(g)
        bonus = self.plan_bonus(turn.view, here, g.charged)
        ask = max(1, want + self.rules.capture.charge_cost - g.charged)
        planned = self.order(g.id, dest, True, min(bonus, ask))
        plain = takes(self.rules, g.charged, 0, want)
        sent = (
            need > 0
            and not plain
            and takes(self.rules, g.charged, bonus, want)
            and self.spend(turn, planned, keep)
        ) or (plain and self.spend(turn, Move(g.id, dest), keep))
        if sent:
            turn.busy.add(g.id)
            turn.taken.add(dest)
        return sent

    # Priorities --------------------------------------------------------------------------------

    def targets(self, turn: Turn, enemy: bool, region: Container[int] | None) -> list[int]:
        """Neutral (or enemy) nodes next to own territory, the most valuable first."""
        me = self.player
        found: dict[int, None] = {}
        for node, who in enumerate(turn.owner):
            if who != me:
                continue
            for other in self.neighbors[node]:
                owner = turn.owner[other]
                if owner != me and (owner is None) != enemy and (region is None or other in region):
                    found[other] = None
        return sorted(found, key=lambda t: (-self.value[t], self.key(t)))

    def _sources(self, turn: Turn, target: int) -> set[int]:
        return {turn.comp[o] for o in self.neighbors[target] if turn.owner[o] == self.player}

    def guard(self, turn: Turn, hold_capital: int, hold_front: int) -> None:
        """Mark the groups that hold the capital and the threatened nodes; note the deficits."""
        by_node: dict[int, list[GroupView]] = {}
        for g in turn.groups:
            by_node.setdefault(node_of(g), []).append(g)
        for node, who in enumerate(turn.owner):
            if who != self.player:
                continue
            hold = hold_capital if node == self.capital else 0
            if turn.threatened[node]:
                hold = max(hold, hold_front)
            if hold <= 0:
                continue
            have = 0
            for g in by_node.get(node, ()):
                if have >= hold:
                    break
                turn.guards.add(g.id)
                have += g.units
            if turn.standing[node] < hold:
                turn.deficits.append((node, hold - turn.standing[node]))
        turn.deficits.sort(key=lambda d: (-self.value[d[0]], self.key(d[0])))

    def claim(self, turn: Turn, region: Container[int] | None, keep: int = 0) -> None:
        """Capture neutral nodes: the nearest free group goes, else a unit is recruited nearby.

        With a price of the capture (DEC-38) only a group whose real charges pay it goes; a free
        group nearby that cannot pay yet waits for its charges, so no unit is recruited for it.
        """
        cost = self.rules.capture.charge_cost
        for target in self.targets(turn, False, region):
            if target in turn.taken:
                continue
            comps = self._sources(turn, target)
            best: GroupView | None = None
            best_hops = 0
            waiting = False
            for g in turn.free():
                node = node_of(g)
                if turn.comp[node] not in comps:
                    continue
                if g.charged < cost:
                    waiting = True
                    continue
                hops = self.hops[node][target]
                if best is None or hops < best_hops:
                    best, best_hops = g, hops
            if best is not None:
                if self.spend(turn, Move(best.id, target), keep):
                    turn.busy.add(best.id)
                    turn.taken.add(target)
                continue
            if waiting:
                continue
            for src in self.neighbors[target]:
                if self.recruit(turn, src, keep + self.rules.orders.cost.move):
                    turn.taken.add(target)
                    break

    def strike(
        self, turn: Turn, region: Container[int] | None, margin: int, est_pct: int, keep: int = 0
    ) -> None:
        """Attack enemy nodes next to own territory with the nearest group that suffices."""
        for target in self.targets(turn, True, region):
            if target in turn.taken:
                continue
            units, charged = self.estimate(turn, target, est_pct)
            terrain = self.map.nodes[target].terrain
            burned = terrain_burned(self.rules, turn.view, target)
            need = shots_to_take(self.rules, terrain, units, charged, burned=burned)
            comps = self._sources(turn, target)
            senders = sorted(
                (g for g in turn.free() if turn.comp[node_of(g)] in comps),
                key=lambda g: (self.hops[node_of(g)][target], -g.charged),
            )
            for g in senders:
                if self.attack(turn, g, target, need, margin, keep):
                    break

    def reinforce(self, turn: Turn) -> None:
        """Fill the garrisons below their minimum: free groups walk in, else a unit is recruited."""
        for node, missing in turn.deficits:
            for g in turn.free():
                src = node_of(g)
                if missing <= 0:
                    break
                near = turn.comp[src] == turn.comp[node] and self.hops[src][node] <= 4
                if near and self.spend(turn, Move(g.id, node)):
                    turn.busy.add(g.id)
                    missing -= g.units
            if missing > 0:
                self.recruit(turn, node)

    def strengthen(self, turn: Turn, keep: int) -> None:
        """Recruit at the threatened nodes (then the capital) while more than ``keep`` CP are left.

        CP above the cap burn (DEC-02), so spare CP is spent on bodies that the supply charges.
        """
        nodes = [n for n, hot in enumerate(turn.threatened) if hot] + [self.capital]
        nodes.sort(key=lambda n: (-self.value[n], self.key(n)))
        for node in nodes:
            if turn.budget <= keep:
                return
            self.recruit(turn, node, keep)

    def develop(self, turn: Turn, keep: int) -> None:
        """One city build of DEC-26 (``Bot.development``) with the CP above ``keep``."""
        cmd = self.development(turn.view, turn.budget - keep)
        if cmd is not None:
            self.spend(turn, cmd, keep)


def front_factory_site(bot: Bot, view: PlayerView, extra: int) -> int | None:
    """The own city that should start a factory now, or ``None``: one build at a time while the
    player has fewer than ``1 + extra`` factories and ``FACTORY_LATE_TICKS`` are left; the own
    city nearest the enemy capital that no enemy node touches, the largest warehouse first.

    The rule the smart bots played before #683 (``gow_bots.bots.factories`` replaced it there),
    kept for the plain BOT-03 bots: they are yardsticks, and under the rear rule of the smart bots
    their matches played the same over every seed (AGENTS.md, section 8)."""
    rules = bot.rules
    me = view.player
    if extra <= 0 or rules.match_ticks - view.tick < FACTORY_LATE_TICKS:
        return None
    count = 0
    for n in view.nodes:
        if n.owner != me:
            continue
        if n.factory_build is not None:
            return None  # one at a time: the flow pays it first
        count += bool(n.factory)
    if count >= min(rules.factory.max, 1 + extra):
        return None
    fights = bot.fight_nodes(view)
    far = bot.hops[bot.map.capital(1 - me)]
    best: tuple[int, int, int] | None = None
    site: int | None = None
    for n in view.nodes:
        node = n.id
        if n.owner != me or n.factory or bot.map.nodes[node].kind is NodeKind.PROVINCE:
            continue
        if node in fights or any(view.nodes[m].owner == 1 - me for m in bot.neighbors[node]):
            continue
        rank = (far[node] if far[node] >= 0 else len(far), -(n.warehouse_cap or 0), bot.key(node))
        if best is None or rank < best:
            best, site = rank, node
    return site
