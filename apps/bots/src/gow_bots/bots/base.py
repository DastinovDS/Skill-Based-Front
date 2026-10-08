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

Tie-breaks are mirror-invariant: nodes are ordered by ``MapDef.node_key(player, node)`` and own
groups by the ``node_key`` of their node first, never by opaque id alone. On a symmetric map the
two sides of the same bot with the same parameters take mirrored decisions.
"""

import random
from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass
from typing import ClassVar, Protocol

from gow_sim.commands import Command, command_cost
from gow_sim.maps import MapDef
from gow_sim.ruleset import Ruleset
from gow_sim.view import AtNode, GroupView, IntentKind, PlayerView

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

    def reachable(self, view: PlayerView, start: int, radius: int) -> list[int]:
        """Nodes a group standing in ``start`` can be sent to, at most ``radius`` hops away.

        A path goes through own nodes only and ends at the first foreign or neutral node
        (``find_path`` of the simulation, SIM-05), so the destinations are the own nodes
        connected to ``start`` through own nodes and their foreign neighbours. ``start`` itself
        is not a destination. In ``node_key`` order.
        """
        me = view.player
        nodes = view.nodes
        dist = {start: 0}
        queue = deque([start])
        while queue:
            node = queue.popleft()
            if dist[node] >= radius or (node != start and nodes[node].owner != me):
                continue
            for other in self.neighbors[node]:
                if other not in dist:
                    dist[other] = dist[node] + 1
                    queue.append(other)
        del dist[start]
        return sorted(dist, key=self.key)

    def idle_groups(self, view: PlayerView) -> list[GroupView]:
        """Own groups that stand in a node without an order, in mirror-invariant order.

        Groups on edges and groups on the way or waiting to depart are left alone: the first
        reject commands (``GROUP_ON_EDGE``, ``GROUP_BUSY``), the second already have work.
        """
        groups = [g for g in view.groups if isinstance(g.location, AtNode) and g.order is None]
        return sorted(groups, key=self._group_key)

    def _group_key(self, g: GroupView) -> tuple[int, int, int, str, int]:
        return (self.key(node_of(g)), -g.units, -g.charged, g.mode.value, g.id)

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
