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

import random
from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass
from typing import ClassVar, Protocol

from gow_sim.commands import (
    CancelOrder,
    Command,
    Move,
    SetPriority,
    Split,
    UpgradeRoad,
    command_cost,
)
from gow_sim.maps import MapDef
from gow_sim.ruleset import Ruleset
from gow_sim.view import (
    AtNode,
    FightView,
    GroupView,
    IntentKind,
    OnEdge,
    PlayerView,
    Priority,
    RoadKind,
)

__all__ = [
    "Bot",
    "BotFactory",
    "Controller",
    "ParamRange",
    "choose_params",
    "node_of",
]


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
    """
    rng = random.Random(f"gow-bots/{name}/params/{seed}/{player}")
    return {key: rng.randint(r.low, r.high) for key, r in sorted(ranges.items())}


class Bot:
    """Common state of a bot: public map data, parameters and the random stream of its seed."""

    name: ClassVar[str] = "bot"
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {}

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
        self._reach: dict[tuple[int, int, int], list[int]] = {}
        self._left: dict[int, int] = {}
        """Own group id to the tick it was ordered out of a fight: no second withdrawal."""

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
        found = sorted(dist, key=self.key)
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

        Withdraw: the own side has fewer charged units than the enemy, so every round costs a
        unit. Attackers and groups on edges cancel (free, back along the edge); defenders of an
        own node leave by ``Move`` to a neighbouring own node only when they cannot shoot at all.
        Reinforce: an idle charged group of a neighbouring own node goes to an own node whose
        fight it reaches before its expected end (``max`` of the charged units of the sides
        rounds from the next one).
        """
        me = view.player
        groups = {g.id: g for g in view.groups}
        idle = self.idle_groups(view)
        fight_at = self.fight_nodes(view)
        round_ticks = self.rules.combat.round_ticks
        cmds: list[Command] = []
        for f in sorted(view.fights, key=self._fight_key):
            mine = [groups[gid] for gid in f.groups if gid in groups]
            charged = sum(g.charged for g in mine)
            if f.enemy_charged > charged:
                for g in sorted(mine, key=lambda g: (-g.units, -g.charged, g.id)):
                    if self._left.get(g.id, -1) >= f.start_tick:
                        continue
                    cmd = self._withdrawal(view, g, charged, fight_at)
                    if cmd is not None and self.cost(cmd) <= budget:
                        budget -= self.cost(cmd)
                        cmds.append(cmd)
                        self._left[g.id] = tick
            node = f.node
            if node is None or view.nodes[node].owner != me or f.enemy_charged < charged:
                continue
            end = f.next_round_tick + (max(charged, f.enemy_charged) - 1) * round_ticks
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

    def _other_end(self, edge: int, node: int) -> int:
        return self.map.edges[edge].other(node)

    def _fight_key(self, f: FightView) -> tuple[int, int]:
        """Mirror-invariant order of fights: nodes by ``node_key``, then edges by edge key."""
        if f.node is not None:
            return (0, self.key(f.node))
        assert f.edge is not None
        return (1, self.edge_keys[f.edge])

    def _withdrawal(
        self, view: PlayerView, g: GroupView, charged: int, fight_at: dict[int, FightView]
    ) -> Command | None:
        loc = g.location
        if isinstance(loc, OnEdge):
            return None if loc.back or g.order is None else CancelOrder(g.id)
        here = loc.node
        if view.nodes[here].owner != view.player:
            return CancelOrder(g.id)  # an attacker of the node
        if charged > 0 or g.order is not None:
            return None
        exits = [
            n
            for n in (self._other_end(e, here) for e in self.incident[here])
            if view.nodes[n].owner == view.player
            and n not in fight_at
            and view.nodes[n].capacity >= g.units
        ]
        return Move(g.id, min(exits, key=self.key)) if exits else None

    def _group_key(self, g: GroupView) -> tuple[int, int, int, str, int]:
        return (self.key(node_of(g)), -g.units, -g.charged, g.mode.value, g.id)

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

    def front_road(self, view: PlayerView, edge: int) -> bool:
        """A road at the front: a neighbour of one of its ends is not own (public ownership)."""
        e = self.map.edges[edge]
        return any(
            view.nodes[other].owner != self.player
            for end in (e.a, e.b)
            for other in self.neighbors[end]
        )

    def priorities(self, view: PlayerView) -> list[Command]:
        """Supply priorities (DEC-18): own cities at the front ``high``, the rest ``normal``.

        A city is at the front when one of its neighbours is not own (public ownership): supply
        then reaches the front before the rear. Only changes are commanded (``NO_CHANGE``
        otherwise); cities in ``node_key`` order (mirror-invariant).
        """
        me = view.player
        cmds: list[Command] = []
        for n in sorted(range(len(view.nodes)), key=self.key):
            current = view.nodes[n].priority
            if current is None:  # not an own city
                continue
            front = any(view.nodes[m].owner != me for m in self.neighbors[n])
            want = Priority.HIGH if front else Priority.NORMAL
            if current is not want:
                cmds.append(SetPriority(n, want))
        return cmds

    def road_kind(self, view: PlayerView, edge: int) -> RoadKind | None:
        """The type for the next level of ``edge`` (DEC-22): ``None`` when it already has one.

        Freight at the front (a captured end node does not lose the charges on the way, and a
        front city needs volume), fast in the rear (refills arrive sooner).
        """
        if view.edges[edge].kind is not RoadKind.NONE:
            return None
        return RoadKind.FREIGHT if self.front_road(view, edge) else RoadKind.FAST

    def upgrade(self, view: PlayerView, node: int, edge: int) -> UpgradeRoad:
        """``UpgradeRoad(node, edge, kind)`` with the type of ``road_kind``."""
        return UpgradeRoad(node, edge, self.road_kind(view, edge))

    def can_upgrade(self, view: PlayerView, node: int, edge: int, supplied: list[bool]) -> bool:
        """``UpgradeRoad(node, edge, kind)`` passes the checks of DEC-16 and DEC-22 that the view
        shows."""
        city = view.nodes[node]
        if city.owner != self.player or not supplied[node] or city.build is not None:
            return False
        e = view.edges[edge]
        other = self.map.edges[edge].other(node)
        if e.upgrade_gain is None or node not in (self.map.edges[edge].a, self.map.edges[edge].b):
            return False
        busy = view.nodes[other].build
        if busy is not None and busy.edge == edge:
            return False
        price = self.rules.build.charges_per_level.of(e.width + 1)
        return (city.warehouse or 0) >= price

    def standing(self, view: PlayerView) -> list[int]:
        """Own units standing in each node (the load that recruiting checks against capacity)."""
        units = [0] * len(view.nodes)
        for g in view.groups:
            if isinstance(g.location, AtNode):
                units[g.location.node] += g.units
        return units

    def cost(self, cmd: Command) -> int:
        return command_cost(self.rules, cmd)

    def enemy_at(self, view: PlayerView, node: int) -> tuple[int, int] | None:
        """``(units, charged)`` of the enemy in ``node`` as far as the view tells.

        Exact numbers from this tick or the last ``EXACT`` sighting; ``(0, 0)`` when the node was
        seen without enemies (or never seen); ``None`` when enemies were seen without numbers
        (``PRESENCE``, DEC-04).
        """
        seen = view.nodes[node].seen
        if seen is None or not seen.enemy_modes:
            return (0, 0)
        if seen.enemy_units is None or seen.enemy_charged is None:
            return None
        return (seen.enemy_units, seen.enemy_charged)

    def defended(self, view: PlayerView, node: int) -> bool:
        """Whether the enemy has announced «Защита» in ``node`` (public intent, DEC-08)."""
        return any(
            i.owner != view.player and i.kind is IntentKind.DEFENSE and i.origin == node
            for i in view.intents
        )


def node_of(group: GroupView) -> int:
    """The node a standing group is in."""
    loc = group.location
    assert isinstance(loc, AtNode)
    return loc.node
