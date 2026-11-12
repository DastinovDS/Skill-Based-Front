"""The movement rule as a bot sees it (ARP-05, #994): edge times and the path of a ``Move``.

The bots may not import ``gow_sim.systems`` (AGENTS.md, section 2: a bot would see hidden
information), so the rule of ``gow_sim.systems.movement`` is restated here once, on what a
``PlayerView`` shows, the map and the ruleset. Every bot reads travel times and paths from this
module and nowhere else; ``apps/bots/tests/test_travel.py`` checks it against the simulation on
every map and ruleset, and against real ``Move`` orders of headless matches on the pool maps.

- ``edge_ticks``: the ticks of going along an edge into a node, ``T`` of ``movement.leg``
  (mechanics.md, section 4, "Speed by terrain by zones", #253): the border point splits the
  edge, each zone goes at ``terrain.speed_pct`` of its node,
  ``T = max(1, travel_ticks * 100 * d // (1000 * pa * pb))`` with ``d = b * pb + (1000 - b) * pa``
  (all non-negative, rounded down).
- ``ticks_left``: the ticks a group that has gone ``progress`` thousandths along that edge still
  needs (``T`` minus ``Leg.spent``): the exact remaining time of a figure seen on a road.
- ``Times``: ``edge_ticks`` of every edge in both directions, computed once per bot.
- ``ways``: the search of a ``Move`` (``movement.find_path``, SIM-05): Dijkstra over
  ``edge_ticks``; only ``start`` and own nodes without a fight are expanded (DEC-24, D1), so the
  first foreign or neutral node, or one with a fight, ends a path; every node but ``start`` holds
  ``size`` units (the stack limit, DEC-20, D, by the public capacity); among paths of equal time
  the lexicographically smallest sequence of ``node_key(player, node)`` wins. The ticks and the
  path of every node equal what the ``ack`` of a ``Move`` there carries.

Integers only, no ``set`` iteration (AGENTS.md, section 4.1 holds for the bots too).
"""

import heapq
from typing import Final, NamedTuple

from gow_sim.maps import MapDef
from gow_sim.ruleset import Ruleset
from gow_sim.view import PlayerView

__all__ = ["PERMILLE", "Times", "Way", "edge_ticks", "ticks_left", "ways"]

PERMILLE: Final = 1000
"""An edge in thousandths: the scale of ``border_permille`` and of a position on an edge."""


def _zones(mapdef: MapDef, rules: Ruleset, edge: int, to_node: int) -> tuple[int, int, int, int]:
    """``(border, pa, pb, d)`` of going along ``edge`` into ``to_node`` (``movement.Leg``):
    the border point in thousandths from the node left, the speeds of its zone and of the zone of
    ``to_node``, and ``d = b * pb + (1000 - b) * pa``."""
    e = mapdef.edges[edge]
    from_node = e.other(to_node)
    b = e.border_permille if from_node == e.a else PERMILLE - e.border_permille
    speed = rules.terrain.speed_pct
    pa = speed.of(mapdef.nodes[from_node].terrain)
    pb = speed.of(mapdef.nodes[to_node].terrain)
    return b, pa, pb, b * pb + (PERMILLE - b) * pa


def edge_ticks(mapdef: MapDef, rules: Ruleset, edge: int, to_node: int) -> int:
    """Ticks a group takes along ``edge`` into ``to_node`` (module docstring)."""
    _, pa, pb, d = _zones(mapdef, rules, edge, to_node)
    return max(1, mapdef.edges[edge].travel_ticks * 100 * d // (PERMILLE * pa * pb))


def ticks_left(mapdef: MapDef, rules: Ruleset, edge: int, to_node: int, progress: int) -> int:
    """Ticks a group that has gone ``progress`` thousandths along ``edge`` from its other end
    still needs to reach ``to_node``: ``T`` minus the ticks behind ``progress``, the least ``k``
    whose position reaches it (``Leg.spent``, rounded up). ``progress`` is clamped to the edge."""
    b, pa, pb, d = _zones(mapdef, rules, edge, to_node)
    t = max(1, mapdef.edges[edge].travel_ticks * 100 * d // (PERMILLE * pa * pb))
    progress = min(max(progress, 0), PERMILLE)
    scaled = t * progress * pb if progress <= b else t * (b * pb + (progress - b) * pa)
    return t - (scaled + d - 1) // d


class Times:
    """``edge_ticks`` of every edge in both directions, by edge id: computed once per bot."""

    def __init__(self, mapdef: MapDef, rules: Ruleset) -> None:
        self.map = mapdef
        self.into: tuple[tuple[int, int], ...] = tuple(
            (edge_ticks(mapdef, rules, eid, e.a), edge_ticks(mapdef, rules, eid, e.b))
            for eid, e in enumerate(mapdef.edges)
        )
        """``into[edge]``: the ticks along ``edge`` into its end ``a``, then into its end ``b``."""
        self.out: tuple[tuple[tuple[int, int, int], ...], ...] = tuple(
            tuple(
                (eid, mapdef.edges[eid].other(node), self.ticks(eid, mapdef.edges[eid].other(node)))
                for eid in mapdef.incident[node]
            )
            for node in range(len(mapdef.nodes))
        )
        """``out[node]``: ``(edge, the node at its other end, the ticks into it)`` of every road
        of ``node``, in the order of ``MapDef.incident`` (the order the simulation relaxes)."""

    def ticks(self, edge: int, to_node: int) -> int:
        """``edge_ticks`` of ``edge`` into ``to_node``."""
        into_a, into_b = self.into[edge]
        return into_b if to_node == self.map.edges[edge].b else into_a


class Way(NamedTuple):
    """The path a ``Move`` of a group to one node takes, once it departs (a ``NamedTuple``: a
    search makes one for every node it settles, and a frozen dataclass costs twice as much)."""

    ticks: int
    """The ticks of the path (``movement.path_ticks``): the sum of its ``edge_ticks``."""
    path: tuple[int, ...]
    """``(start, ..., node)``."""
    edge: int
    """The road the path enters the node by (``-1`` for ``start`` itself)."""

    @property
    def hops(self) -> int:
        """Roads on the path."""
        return len(self.path) - 1


def ways(
    view: PlayerView,
    times: Times,
    keys: tuple[int, ...],
    start: int,
    size: int = 0,
) -> dict[int, Way]:
    """By node, the ``Way`` a ``Move`` of a group of ``size`` units standing in ``start`` takes
    there (module docstring), ``start`` included with an empty way; the nodes no ``Move`` reaches
    are missing. ``keys``: ``node_key(view.player, node)`` of every node (``Bot.keys``); ``size``
    ``0``: no stack limit.

    The Dijkstra of the simulation orders its heap by ``(ticks, key sequence)``; here the heap is
    ordered by ticks alone and the key sequences are compared only when two candidates of a node
    tie on ticks. That gives the same ways: every road takes at least one tick, so every node of a
    candidate path but the last is settled before the last is, and each node keeps the least
    ``(ticks, key sequence)`` of all its candidates, as there.
    """
    me, nodes, out = view.player, view.nodes, times.out
    fights = {f.node: True for f in view.fights if f.node is not None}
    push, pop = heapq.heappush, heapq.heappop
    best: dict[int, tuple[int, int, int]] = {}
    """By node not settled yet: ``(ticks, the node before it, the road from there)``."""
    found: dict[int, Way] = {}
    heap: list[tuple[int, int]] = []
    ticks, node, path = 0, start, (start,)
    found[start] = Way(0, path, -1)
    while True:
        if node == start or (nodes[node].owner == me and node not in fights):
            # only ``start`` and own nodes without a fight go on (a path ends at the others)
            for eid, nxt, step in out[node]:
                if nxt in found:
                    continue
                if size > 0 and nodes[nxt].capacity < size:
                    continue  # the stack limit (DEC-20, D): the group does not fit there
                cand = ticks + step
                old = best.get(nxt)
                if old is None or cand < old[0]:
                    best[nxt] = (cand, node, eid)
                    push(heap, (cand, nxt))
                elif cand == old[0] and _before(keys, path, found[old[1]].path, nxt):
                    best[nxt] = (cand, node, eid)
        while heap:
            ticks, node = pop(heap)
            if node not in found and ticks == best[node][0]:
                break
        else:
            return found
        _, before, eid = best.pop(node)
        path = (*found[before].path, node)
        found[node] = Way(ticks, path, eid)


def _before(
    keys: tuple[int, ...], path: tuple[int, ...], other: tuple[int, ...], last: int
) -> bool:
    """The key sequence of ``path`` and ``last`` is before that of ``other`` and ``last``."""
    mine, theirs = (*path, last), (*other, last)
    for a, b in zip(mine, theirs, strict=False):
        if a != b:
            return keys[a] < keys[b]
    return len(mine) < len(theirs)
