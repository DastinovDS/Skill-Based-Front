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
- ``fortify``: «Защита» on the guards that face enemies;
- ``build_roads``: one unthreatened own internal road a turn is upgraded for CP (DEC-28, item 7).
- ``prioritize``: the two front markers go to own cities at the front (DEC-28).

Enemy strength (DEC-04). A view gives exact enemy numbers only at ``EXACT`` detail (own nodes and
nodes where own groups stand); next to own nodes (``PRESENCE``) it tells only whether enemy groups
are there and their modes. ``StrategyBot.estimate`` therefore returns, for an enemy node:

- ``(0, 0)`` when the node is observed now (not ``FOG``) and no enemy group is there: it falls
  without a fight (DEC-07, example 5);
- the exact numbers of this tick when they are in the view;
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
from gow_bots.bots.utility import prefer_planned, shots_to_take
from gow_sim.commands import Command, Move, Recruit, SetMode, SetStance, UpgradeRoad
from gow_sim.maps import MapDef
from gow_sim.ruleset import Ruleset
from gow_sim.view import Detail, GroupView, Mode, PlayerView, Stance

__all__ = ["MEMORY_TICKS", "StrategyBot", "Turn"]

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
        self.stance_tick: int | None = None
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
        """Front markers on the front cities (DEC-28, ``Bot.fronts``)."""
        for cmd in self.fronts(turn.view):
            self.spend(turn, cmd)

    def set_stance(self, turn: Turn, stance: Stance) -> None:
        last = self.stance_tick
        if turn.view.me.stance is stance:
            return
        if last is not None and turn.tick - last < self.rules.orders.stance_cooldown_ticks:
            return
        if self.spend(turn, SetStance(stance)):
            self.stance_tick = turn.tick

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
        order (DEC-08) when the shared utility says that the bonus pays and makes them suffice.
        """
        want = need + margin
        edges = self.path_edges(turn.view, node_of(g), dest, g.units)
        bonus = self.rules.orders.planned_bonus(edges, g.charged)
        planned = Move(g.id, dest, planned=True)
        sent = (
            need > 0
            and g.charged < want <= g.charged + bonus
            and prefer_planned(self.rules, g.charged, need, edges)
            and self.spend(turn, planned, keep)
        ) or (g.charged >= want and self.spend(turn, Move(g.id, dest), keep))
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
        """Capture neutral nodes: the nearest free group goes, else a unit is recruited nearby."""
        for target in self.targets(turn, False, region):
            if target in turn.taken:
                continue
            comps = self._sources(turn, target)
            best: GroupView | None = None
            best_hops = 0
            for g in turn.free():
                node = node_of(g)
                if turn.comp[node] not in comps:
                    continue
                hops = self.hops[node][target]
                if best is None or hops < best_hops:
                    best, best_hops = g, hops
            if best is not None:
                if self.spend(turn, Move(best.id, target), keep):
                    turn.busy.add(best.id)
                    turn.taken.add(target)
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
            defended = self.defended(turn.view, target)
            need = shots_to_take(self.rules, terrain, units, charged, defended)
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

    def fortify(self, turn: Turn) -> None:
        """«Защита» on guards of threatened nodes not in it yet: the bonus grows with the time in
        the mode and gathers anew after a fight without paying again (DEC-30), so the earlier the
        better and once is enough."""
        for g in turn.groups:
            node = node_of(g)
            if (
                g.id in turn.guards
                and g.id not in turn.busy
                and turn.threatened[node]
                and g.charged > 0
                and g.mode is not Mode.DEFENSE
                and self.spend(turn, SetMode(g.id, Mode.DEFENSE))
            ):
                turn.busy.add(g.id)

    def develop(self, turn: Turn, keep: int) -> None:
        """One city build of DEC-26 (``Bot.development``) with the CP above ``keep``."""
        cmd = self.development(turn.view, turn.budget - keep)
        if cmd is not None:
            self.spend(turn, cmd, keep)

    def build_roads(self, turn: Turn, keep: int) -> None:
        """One road at a time: while no own road is being built, the own internal road with the
        best ``road_value`` whose ends are not threatened, paid with ``orders.cost.build`` CP
        (DEC-28, item 7) while ``keep`` CP stay. One build at a time keeps the roads at about
        0,5 CP per ``build.ticks_per_level``, so they do not starve the recruits and the city
        builds. Ties go to the nearer road to the own capital (a level there speeds the packets
        and the groups that leave it), then the smaller edge key: mirror-invariant."""
        view = turn.view
        if any(e.build is not None and e.upgrade_gain is not None for e in view.edges):
            return  # an own road is being built (only own internal roads have a gain)
        capital = self.map.capital(self.player)
        hops = self.hops[capital]
        best: tuple[int, int, int] | None = None
        best_edge: int | None = None
        for e, edef in enumerate(self.map.edges):
            value = self.road_value(view, e)
            if value is None or not self.can_upgrade(view, e):
                continue
            if turn.threatened[edef.a] or turn.threatened[edef.b]:
                continue
            rank = (-value, min(hops[edef.a], hops[edef.b]), self.edge_keys[e])
            if best is None or rank < best:
                best, best_edge = rank, e
        if best_edge is not None:
            self.spend(turn, UpgradeRoad(best_edge), keep)

    def road_value(self, view: PlayerView, edge: int) -> int | None:
        """What the next level of ``edge`` is worth (DEC-28, item 7): its packet and unit speed
        points plus 100 per charge of throughput; ``None`` when it cannot grow."""
        gain = view.edges[edge].upgrade_gain
        if gain is None:
            return None
        return gain.speed_pct + gain.unit_speed_pct + 100 * gain.amount
