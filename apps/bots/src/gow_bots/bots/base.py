"""The controller interface and the base of every bot (AGENTS.md, section 8; BOT-01).

A bot is a ``Controller``: ``decide(view, tick)`` gets the ``PlayerView`` of its player every
``decide_every`` ticks (5 in ``run_headless`` and on the server) and answers with commands in the
opaque ids of that view. Besides the view a bot knows only public data: the map and the ruleset.
``gow_bots.bots`` may not import ``gow_sim.state``, ``gow_sim.systems`` or ``gow_sim.match``
(``lint-imports``), so ``Controller`` is declared here; it has the shape of
``gow_sim.match.Controller`` and a bot is accepted by ``run_headless`` as it is.

Seed variability: every bot draws its parameters (aggression, expansion radius, attack threshold
and so on) from the ranges of its class, deterministically from the match seed and its side
(``choose_params``). Without that two deterministic bots replay the same match on every seed and
a tournament measures nothing. The bot's own choices during the match come from a second
``random.Random`` stream of the same seed; the global ``random`` is never used, so a match is a
function of ``(map, ruleset, bots, seed)`` in any process.

Stack limit (DEC-20, D): a group goes only along paths whose nodes (besides the start) hold it,
by the public capacity of the view; a bigger group must split first (``fit``, ``fitted``). The
new group of a ``Split`` gets the charged units first, so the bot splits off the army and orders
it in the next decision, when its opaque id is in the view. Split, merge and cancel are free in
the DEC-20 rulesets; the bots still pay ``command_cost``, so a price brought back works as before.

Tie-breaks are mirror-invariant: nodes are ordered by ``MapDef.node_key(player, node)`` and own
groups by the ``node_key`` of their node first, never by opaque id alone. On a symmetric map the
two sides of the same bot with the same parameters take mirrored decisions.
"""

import heapq
import random
from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass
from typing import ClassVar, Final, Protocol

from gow_bots.bots.assess import edge_ticks
from gow_sim.commands import (
    BuildBarracks,
    CancelOrder,
    Command,
    Move,
    SetStance,
    Split,
    command_cost,
)
from gow_sim.maps import MapDef
from gow_sim.ruleset import Retreat, Ruleset
from gow_sim.view import (
    AtNode,
    BuildKind,
    FightView,
    GroupView,
    NodeView,
    OnEdge,
    PlayerView,
)

__all__ = [
    "Bot",
    "BotFactory",
    "Controller",
    "ParamRange",
    "choose_params",
    "node_of",
]

LATE_KEYS: Final = ("stance_", "contact_")
"""The prefixes of the ``PARAMS`` keys of #881 (the stance policy, the attack estimate before
contact): ``choose_params`` draws them from a stream of their own."""


class Controller(Protocol):
    """A player that sees only its ``PlayerView`` and answers with commands in opaque ids."""

    def decide(self, view: PlayerView, tick: int) -> list[Command]: ...


class BotFactory(Protocol):
    """How a bot is made: the public map and ruleset, the match seed and the side it plays."""

    def __call__(self, mapdef: MapDef, rules: Ruleset, *, seed: int, player: int) -> Controller: ...


@dataclass(frozen=True, slots=True)
class ParamRange:
    """Integer range of a bot parameter, both ends included."""

    low: int
    high: int

    def __post_init__(self) -> None:
        if self.low > self.high:
            raise ValueError(f"empty range {self.low}..{self.high}")


def choose_params(
    name: str, seed: int, player: int, ranges: Mapping[str, ParamRange]
) -> dict[str, int]:
    """Parameters of bot ``name`` on side ``player`` of the match with ``seed``.

    One value per range, drawn by a ``random.Random`` seeded with a string of the three inputs
    (``str`` seeds are hashed with SHA-512 by ``random``, independent of ``PYTHONHASHSEED``).
    Ranges are drawn in the order of their names.

    The keys that start with one of ``LATE_KEYS`` (#881) are drawn from a second stream of the
    same inputs, so adding them left every other draw as it was.
    """
    rng = random.Random(f"gow-bots/{name}/params/{seed}/{player}")
    late = random.Random(f"gow-bots/{name}/params/late/{seed}/{player}")
    return {
        key: (late if key.startswith(LATE_KEYS) else rng).randint(r.low, r.high)
        for key, r in sorted(ranges.items())
    }


class Bot:
    """Common state of a bot: public map data, parameters and the random stream of its seed."""

    name: ClassVar[str] = "bot"
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {}
    STANCE_POLICY: ClassVar[bool] = False
    """The bot changes its stance (DEC-44) by a policy (``SmartBot``, #881); without it
    ``SetStance`` is not sent (``allowed``) and the bot stays in the start stance, Balance."""
    DISCIPLINE: ClassVar[bool] = False
    """Cancel discipline (#687): cancels only where they save units. ``fight_commands`` counts
    the charges plains still burn (``FightView.mute``, nothing after the first round, DEC-45)
    out of both stocks; ``CampaignBot``
    recalls only an attack that would lose units (``recall_pays``) and a recalled target waits
    ``RECALL_TICKS`` for a stronger group. Off: the play of BOT-03 (a recall of any attack that
    would not take the target with the margin), which the plain bots and the benchmark
    ``smart_hoarder`` keep."""

    def __init__(self, mapdef: MapDef, rules: Ruleset, *, seed: int, player: int) -> None:
        self.map = mapdef
        self.rules = rules
        self.player = player
        self.seed = seed
        self.params = choose_params(self.name, seed, player, self.PARAMS)
        self.rng = random.Random(f"gow-bots/{self.name}/play/{seed}/{player}")
        count = len(mapdef.nodes)
        self.keys: tuple[int, ...] = tuple(mapdef.node_key(player, n) for n in range(count))
        """``node_key`` of every node for this side: the only tie-break between nodes."""
        self.neighbors: tuple[tuple[int, ...], ...] = tuple(
            tuple(sorted((mapdef.edges[e].other(n) for e in mapdef.incident[n]), key=self.key))
            for n in range(count)
        )
        """Neighbours of every node, in ``node_key`` order."""
        self.edge_keys: tuple[int, ...] = tuple(
            e if player == 0 else mapdef.mirror_edges[e] for e in range(len(mapdef.edges))
        )
        """Tie-break key of edges, like ``node_key``: the mirror edge id for player 1."""
        self.incident: tuple[tuple[int, ...], ...] = tuple(
            tuple(sorted(mapdef.incident[n], key=self.edge_keys.__getitem__)) for n in range(count)
        )
        """Edges touching every node, in edge key order."""
        self.hops: tuple[tuple[int, ...], ...] = tuple(self._bfs(n) for n in range(count))
        """``hops[a][b]``: road hops between two nodes on the whole map (-1: unreachable)."""
        self._reach_tick = -1
        self._reach: dict[tuple[int, int, int], tuple[dict[int, int], list[int]]] = {}
        """By ``(start, radius, size)``: hops to each destination, the destinations in
        ``node_key`` order."""
        self._left: dict[int, int] = {}
        """Own group id to the tick it was ordered out of a fight: no second withdrawal."""
        self.retreat = rules.combat.retreat is Retreat.ROUND
        """A group may leave a fight (DEC-24, item E); not under ``combat.retreat = "none"``
        (DEC-40, variant N)."""
        self._ways_tick = -1
        self._ways: dict[tuple[int, int], dict[int, int]] = {}
        """By ``(start, size)``: the road each node is entered by on the fastest path (``ways_in``),
        for the decision of ``_ways_tick``."""

    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        raise NotImplementedError

    # Helpers ---------------------------------------------------------------------------------

    def key(self, node: int) -> int:
        return self.keys[node]

    def _bfs(self, start: int) -> tuple[int, ...]:
        dist = [-1] * len(self.map.nodes)
        dist[start] = 0
        queue = deque([start])
        while queue:
            node = queue.popleft()
            for other in self.neighbors[node]:
                if dist[other] < 0:
                    dist[other] = dist[node] + 1
                    queue.append(other)
        return tuple(dist)

    def check_view(self, view: PlayerView) -> None:
        if view.player != self.player:
            raise ValueError(f"bot of player {self.player} got the view of player {view.player}")

    def reachable(self, view: PlayerView, start: int, radius: int, size: int = 0) -> list[int]:
        """Nodes a group standing in ``start`` can be sent to, at most ``radius`` hops away.

        A path goes through own nodes only and ends at the first foreign or neutral node
        (``find_path`` of the simulation, SIM-05), so the destinations are the own nodes
        connected to ``start`` through own nodes and their foreign neighbours. ``start`` itself
        is not a destination. ``size``: the units of the group; nodes whose capacity is smaller
        are neither passed nor reached (the stack limit, DEC-20, D); ``0``: no limit. In
        ``node_key`` order.
        """
        return self._search(view, start, radius, size)[1]

    def path_edges(self, view: PlayerView, start: int, dest: int, size: int = 0) -> int:
        """Edges of the shortest path ``reachable`` finds from ``start`` to ``dest``; ``0``: no
        path. An estimate of the edges of the ``Move`` path (the simulation takes the fastest one,
        DEC-20), which sets the planned bonus (DEC-29)."""
        return self._search(view, start, len(self.map.nodes), size)[0].get(dest, 0)

    def _search(
        self, view: PlayerView, start: int, radius: int, size: int
    ) -> tuple[dict[int, int], list[int]]:
        if self._reach_tick != view.tick:
            self._reach_tick, self._reach = view.tick, {}
        cached = self._reach.get((start, radius, size))
        if cached is not None:
            return cached
        me = view.player
        nodes = view.nodes
        fights = self.fight_nodes(view)
        dist = {start: 0}
        queue = deque([start])
        while queue:
            node = queue.popleft()
            if dist[node] >= radius or (
                node != start and (nodes[node].owner != me or node in fights)
            ):
                continue  # a path ends at a foreign node or at one with a fight (DEC-24, D1)
            for other in self.neighbors[node]:
                if other not in dist and nodes[other].capacity >= size:
                    dist[other] = dist[node] + 1
                    queue.append(other)
        del dist[start]
        found = (dist, sorted(dist, key=self.key))
        self._reach[(start, radius, size)] = found
        return found

    def fit(self, view: PlayerView, start: int, dest: int, units: int) -> int:
        """The biggest group of at most ``units`` that can be sent from ``start`` to ``dest``
        under the stack limit (DEC-20, D); ``0``: no path at all."""
        far = len(self.map.nodes)
        sizes = sorted({units, *(n.capacity for n in view.nodes if n.capacity < units)})
        for size in reversed(sizes):
            if size >= 1 and dest in self.reachable(view, start, far, size):
                return size
        return 0

    def fitted(self, view: PlayerView, cmd: Command) -> Command | None:
        """``cmd``, or for a ``Move`` of a group too big for any path the ``Split`` that makes
        its army (``fit`` units, the charged first) to be sent in the next decision; ``None``
        when there is no path at all."""
        if not isinstance(cmd, Move):
            return cmd
        g = next((g for g in view.groups if g.id == cmd.group), None)
        if g is None or not isinstance(g.location, AtNode):
            return cmd
        size = self.fit(view, g.location.node, cmd.dest, g.units)
        if size == g.units:
            return cmd
        return Split(g.id, size) if size >= 1 else None

    def idle_groups(self, view: PlayerView) -> list[GroupView]:
        """Own groups that stand in a node without an order and outside fights, in
        mirror-invariant order.

        Groups on edges and groups on the way or waiting to depart are left alone: the first
        reject commands (``GROUP_ON_EDGE``, ``GROUP_BUSY``), the second already have work. Groups
        in a fight only withdraw (``IN_FIGHT``, DEC-24): ``fight_commands``.
        """
        busy = self.fighting(view)
        groups = [
            g
            for g in view.groups
            if isinstance(g.location, AtNode) and g.order is None and g.id not in busy
        ]
        return sorted(groups, key=self._group_key)

    # Fights (DEC-24) ----------------------------------------------------------------------------

    def fighting(self, view: PlayerView) -> dict[int, FightView]:
        """Own group id to the fight it is in."""
        return {gid: f for f in view.fights for gid in f.groups}

    def fight_nodes(self, view: PlayerView) -> dict[int, FightView]:
        """Nodes with a fight going on: no transit, no recruit there (DEC-24, D1; DEC-25, 9)."""
        return {f.node: f for f in view.fights if f.node is not None}

    def fight_commands(self, view: PlayerView, tick: int, budget: int) -> list[Command]:
        """Withdrawals from lost fights and one reinforcement per fight of an own node (DEC-24,
        item K), at most ``budget`` CP in hundredths.

        The stock of a side is its charged units plus its bonus shots still left
        (``FightView.virtual_left``, public to both in a fight: DEC-32, items 3 and 8).
        Withdraw: the own stock is smaller than the enemy's, so every round costs a unit.
        Attackers and groups on edges cancel (free, back along the edge); defenders of an own node
        leave by ``Move`` to a neighbouring own node only when they cannot shoot at all. Without
        retreat (``combat.retreat = "none"``, DEC-40) nobody withdraws: the server would reject it
        with ``IN_FIGHT``.
        Reinforce: an idle charged group of a neighbouring own node goes to an own node whose
        fight it reaches before its expected end (``max`` of the stocks of the sides rounds from
        the next one, ``combat.round_ticks`` each; a rough estimate on purpose).
        """
        me = view.player
        groups = {g.id: g for g in view.groups}
        idle = self.idle_groups(view)
        fight_at = self.fight_nodes(view)
        round_ticks = self.rules.combat.round_ticks
        cmds: list[Command] = []
        for f in sorted(view.fights, key=self._fight_key):
            mine = [groups[gid] for gid in f.groups if gid in groups]
            stock = sum(g.charged for g in mine) + f.virtual_left[me]
            enemy = f.enemy_charged + f.virtual_left[1 - me]
            if self.DISCIPLINE:  # #687: a silent or burning charge never shoots (DEC-45)
                stock -= f.mute[me]
                enemy -= f.mute[1 - me]
            if self.retreat and enemy > stock + self.coming(view, f):
                for g in sorted(mine, key=lambda g: (-g.units, -g.charged, g.id)):
                    if self._left.get(g.id, -1) >= f.start_tick:
                        continue
                    cmd = self._withdrawal(view, g, stock, fight_at)
                    if cmd is not None and self.cost(cmd) <= budget:
                        budget -= self.cost(cmd)
                        cmds.append(cmd)
                        self._left[g.id] = tick
            node = f.node
            if node is None or view.nodes[node].owner != me or enemy < stock:
                continue
            end = f.next_round_tick + (max(stock, enemy) - 1) * round_ticks
            for g in idle:
                here = node_of(g)
                if g.charged == 0 or here == node or here in fight_at:
                    continue
                edge = next(
                    (e for e in self.incident[here] if self._other_end(e, here) == node), None
                )

                if edge is None or tick + self.map.edges[edge].travel_ticks >= end:
                    continue
                cmd = Move(g.id, node)
                if self.cost(cmd) <= budget:
                    budget -= self.cost(cmd)
                    cmds.append(cmd)
                    idle = [x for x in idle if x.id != g.id]
                    break
        return cmds

    def coming(self, view: PlayerView, fight: FightView) -> int:
        """Own shots on the way into ``fight`` that keep its groups in it (a converging strike,
        ``SmartBot``); ``0``: every fight is judged by the stocks in it."""
        return 0

    def _other_end(self, edge: int, node: int) -> int:
        return self.map.edges[edge].other(node)

    def _fight_key(self, f: FightView) -> tuple[int, int]:
        """Mirror-invariant order of fights: nodes by ``node_key``, then edges by edge key."""
        if f.node is not None:
            return (0, self.key(f.node))
        assert f.edge is not None
        return (1, self.edge_keys[f.edge])

    def _withdrawal(
        self, view: PlayerView, g: GroupView, stock: int, fight_at: dict[int, FightView]
    ) -> Command | None:
        loc = g.location
        if isinstance(loc, OnEdge):
            return None if loc.back or g.order is None else CancelOrder(g.id)
        here = loc.node
        if view.nodes[here].owner != view.player:
            return CancelOrder(g.id)  # an attacker of the node
        if stock > 0 or g.order is not None:
            return None
        exits = [
            n
            for n in (self._other_end(e, here) for e in self.incident[here])
            if view.nodes[n].owner == view.player
            and n not in fight_at
            and view.nodes[n].capacity >= g.units
        ]
        return Move(g.id, min(exits, key=self.key)) if exits else None

    def _group_key(self, g: GroupView) -> tuple[int, int, int, int]:
        return (self.key(node_of(g)), -g.units, -g.charged, g.id)

    def supplied(self, view: PlayerView) -> list[bool]:
        """Own nodes connected to the own capital over own nodes (ownership is public)."""
        me = self.player
        result = [False] * len(view.nodes)
        capital = self.map.capital(me)
        if view.nodes[capital].owner != me:
            return result
        result[capital] = True
        queue = [capital]
        while queue:
            node = queue.pop()
            for other in self.neighbors[node]:
                if not result[other] and view.nodes[other].owner == me:
                    result[other] = True
                    queue.append(other)
        return result

    def development(self, view: PlayerView, budget: int) -> Command | None:
        """At most one city build of DEC-26 per decision (item 11), from ``budget`` CP in
        hundredths: the barracks, when the nearest own city to the enemy capital is at least two
        hops nearer than every own city with the barracks (recruits would walk far); their price
        buys a shorter way for every later recruit (``wanted_barracks``). Cities without a build
        and without a fight, in ``node_key`` order: mirror-invariant.
        """
        want = self.wanted_barracks(view)
        if want is not None and budget >= self.rules.orders.cost.barracks:
            return BuildBarracks(want)
        return None

    def wanted_barracks(self, view: PlayerView) -> int | None:
        """The own city that should build the barracks now (``development``), or ``None``."""
        far = self.hops[self.map.capital(1 - view.player)]
        barracks = [far[n.id] for n in view.nodes if n.owner == view.player and n.has_barracks]
        if any(
            n.building is not None and n.building.kind is BuildKind.BARRACKS for n in view.nodes
        ):
            return None  # one at a time
        for n in self._free_cities(view):
            if not n.has_barracks:
                near = far[n.id] + 2 <= min(barracks, default=far[n.id] + 2)
                return n.id if near else None
        return None

    def _free_cities(self, view: PlayerView) -> list[NodeView]:
        """Own cities without a build and without a fight, nearest to the enemy capital first
        (ties by ``node_key``: mirror-invariant)."""
        fights = self.fight_nodes(view)
        far = self.hops[self.map.capital(1 - view.player)]
        free = [
            n
            for n in view.nodes
            if n.owner == view.player
            and n.has_barracks is not None
            and n.building is None
            and n.id not in fights
        ]
        return sorted(free, key=lambda n: (far[n.id], self.key(n.id)))

    def can_queue(self, view: PlayerView, node: int, standing: int) -> bool:
        """``Recruit(node)`` is accepted and sensible now (DEC-25), with ``standing`` own units
        in the node as the caller counts them.

        An own city (``recruit_queue`` is ``None`` for provinces and foreign nodes) with the
        barracks (DEC-26, item 11), without a fight (the production would stand) and with an
        empty queue: a decision comes every few ticks and a unit takes ``recruit.unit_ticks``, so
        one unit at a time per city is all that is made before the next decision, and a longer
        queue would only tie CP up and be lost with the city (DEC-25, items 10 and 13).
        """
        n = view.nodes[node]
        if n.owner != view.player or n.recruit_queue is None:
            return False
        if not n.has_barracks:  # the barracks decides where (DEC-26, item 11)
            return False
        if node in self.fight_nodes(view):
            return False
        return n.recruit_queue == 0 and standing + n.recruit_queue < n.capacity

    def front(self, view: PlayerView, node: int) -> bool:
        """An own node next to a node of the enemy: a recruit queue there risks the capture."""
        me = view.player
        return any(
            view.nodes[self.map.edges[e].other(node)].owner not in (None, me)
            for e in self.map.incident[node]
        )

    def standing(self, view: PlayerView) -> list[int]:
        """Own units standing in each node (the load that recruiting checks against capacity)."""
        units = [0] * len(view.nodes)
        for g in view.groups:
            if isinstance(g.location, AtNode):
                units[g.location.node] += g.units
        return units

    def cost(self, cmd: Command) -> int:
        return command_cost(self.rules, cmd)

    def allowed(self, cmd: Command) -> bool:
        """Whether the bot sends ``cmd`` at all: ``SetStance`` (DEC-44) only with
        ``STANCE_POLICY``; every other command."""
        if isinstance(cmd, SetStance):
            return self.STANCE_POLICY  # #881
        return True

    def plan_bonus(self, view: PlayerView, node: int, charged: int) -> int:
        """The bonus a planned order of a group with ``charged`` units in ``node`` can gather now:
        the stock of the own warehouse there, at most the charged units (DEC-41, item 10)."""
        return max(0, min(charged, view.nodes[node].warehouse or 0))

    def plan_lead(self, bonus: int) -> int:
        """Ticks a planned order waits in its node before it departs: the gathering of ``bonus``
        charges (DEC-41, item 10; it departs the tick after the last one)."""
        return bonus * self.rules.orders.plan_ticks_per_bonus + 1

    def order(self, group: int, dest: int, planned: bool, bonus: int) -> Move:
        """The ``Move`` of an attack: a planned order names its requested ``bonus`` and is an
        ordinary one without any (DEC-41, item 10)."""
        if not planned or bonus < 1:
            return Move(group, dest)
        return Move(group, dest, planned=True, bonus=bonus)

    def enemy_at(self, view: PlayerView, node: int) -> tuple[int, int] | None:
        """``(units, charged)`` of the enemy in ``node`` as far as the view tells.

        Exact numbers from this tick or the last ``EXACT`` sighting; on ``RANGE`` (DEC-21) the top
        of the range of units (its start for the open last range), all taken as charged; ``(0,
        0)`` when the node was seen without enemies (or never seen); ``None`` when enemies were
        seen without numbers (``PRESENCE``).
        """
        seen = view.nodes[node].seen
        if seen is None or not seen.enemy_modes:
            return (0, 0)
        if seen.enemy_range is not None:
            low, high = seen.enemy_range
            top = low if high is None else high
            return (top, top)
        if seen.enemy_units is None or seen.enemy_charged is None:
            return None
        return (seen.enemy_units, seen.enemy_charged)

    def toll_ahead(self, view: PlayerView, dest: int, shots: int) -> int:
        """``toll_for`` of a group of ``shots`` units, all charged (an attack of several groups
        whose sizes are not known yet: the converging strike)."""
        return self.toll_for(view, dest, shots, shots)

    def toll_for(self, view: PlayerView, dest: int, units: int, charged: int) -> int:
        """The charges a group of ``units`` units, ``charged`` of them charged, loses on its way
        into ``dest`` to a visible enemy road fortification of ``dest`` (DEC-43, item D6,
        ``FortRules.toll``), when every road from an own node into ``dest`` has a built one (the
        bot cannot pick the road: the path is the simulation's); 0 when one of them is free and
        for a node of no enemy. An empty node takes its toll too: the
        charges are gone before the capture (DEC-38) is paid."""
        fort = self.rules.fort
        if charged <= 0 or view.nodes[dest].owner != 1 - view.player:
            return 0
        approaches = 0
        for eid in self.map.incident[dest]:
            if view.nodes[self.map.edges[eid].other(dest)].owner != view.player:
                continue
            approaches += 1
            if not any(f.node == dest and f.built for f in view.edges[eid].forts):
                return 0
        return fort.toll(units, charged) if approaches else 0

    def toll_from(self, view: PlayerView, here: int, dest: int, units: int, charged: int) -> int:
        """The toll a group of ``units``, ``charged`` standing in ``here`` pays on its way into
        ``dest`` (DEC-43, item D6): the road it enters ``dest`` by is the last one of the fastest
        path a ``Move`` gets (``ways_in``), so the fortification of that road alone decides;
        ``toll_for`` when no path is found. Only built enemy fortifications the view shows."""
        if charged <= 0 or view.nodes[dest].owner != 1 - view.player:
            return 0
        if not any(
            f.node == dest and f.built for e in self.map.incident[dest] for f in view.edges[e].forts
        ):
            return 0  # no fortification in sight: no path search
        edge = self.ways_in(view, here, units).get(dest)
        if edge is None:
            return self.toll_for(view, dest, units, charged)
        return self.toll_on(view, edge, dest, units, charged)

    def ways_in(self, view: PlayerView, start: int, size: int) -> dict[int, int]:
        """By node, the road the fastest path of a group of ``size`` from ``start`` enters it by:
        the search of a ``Move`` (``gow_sim.systems.movement.find_path``) on what the view
        shows: only ``start`` and own nodes without a fight are expanded, every node but
        ``start`` holds ``size`` (DEC-20, D), the road times of ``assess.edge_ticks``, ties by the
        ``node_key`` sequence of the path. Once per decision."""
        if self._ways_tick != view.tick:
            self._ways_tick, self._ways = view.tick, {}
        cached = self._ways.get((start, size))
        if cached is not None:
            return cached
        me, nodes = view.player, view.nodes
        fights = self.fight_nodes(view)
        best: dict[int, tuple[int, tuple[int, ...]]] = {start: (0, (self.key(start),))}
        via: dict[int, int] = {}
        done: dict[int, bool] = {}
        heap: list[tuple[int, tuple[int, ...], int]] = [(0, (self.key(start),), start)]
        while heap:
            ticks, keys, node = heapq.heappop(heap)
            if node in done:
                continue
            done[node] = True
            if node != start and (nodes[node].owner != me or node in fights):
                continue  # a path ends at the first foreign node or at a fight
            for eid in self.map.incident[node]:
                nxt = self.map.edges[eid].other(node)
                if nxt in done or (size > 0 and nodes[nxt].capacity < size):
                    continue
                t = ticks + edge_ticks(self.map, self.rules, eid, nxt)
                cand = (t, (*keys, self.key(nxt)))
                if nxt not in best or cand < best[nxt]:
                    best[nxt] = cand
                    via[nxt] = eid
                    heapq.heappush(heap, (t, cand[1], nxt))
        self._ways[(start, size)] = via
        return via

    def toll_on(self, view: PlayerView, edge: int, dest: int, units: int, charged: int) -> int:
        """The toll a group of ``units``, ``charged`` pays crossing into ``dest`` over ``edge``: a
        visible built enemy road fortification of ``dest`` there (DEC-43, items D6 and D8)."""
        fort = self.rules.fort
        if charged <= 0 or view.nodes[dest].owner != 1 - view.player:
            return 0
        if not any(f.node == dest and f.built for f in view.edges[edge].forts):
            return 0
        return fort.toll(units, charged)


def node_of(group: GroupView) -> int:
    """The node a standing group is in."""
    loc = group.location
    assert isinstance(loc, AtNode)
    return loc.node
