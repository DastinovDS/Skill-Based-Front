"""Road fortifications as a defensive tool of the smart bots (#682, G-F of the ``mvp-4`` bot audit).

Under ``mvp-4`` (DEC-43, item D) the road fortification is the only defensive building: no bunker,
no Defense mode. A line at the border point of a road leaving an own node ``X`` takes 1 charge per
started 3 units from an enemy group crossing it towards ``X`` (item D6), works ``fort.build_ticks``
after the command (item D4) and goes with ``X`` (item D7). Two readings of the ``PlayerView``
(AGENTS.md, section 4.4: only the view):

- ``road_threats``: by own node and road from it into an enemy node, the enemy shots the view shows
  coming by that road: a fresh sighting of an enemy force in the enemy neighbour (the exact charges,
  the top of a range, ``guess`` for a presence), the visible planned strikes at ``X`` (DEC-08, an
  intent whose origin is that neighbour or nearest to it among the enemy neighbours of ``X``,
  ``guess`` each: the intent hides the size) and, with ``figures``, the enemy figures on the road
  heading into ``X`` (DEC-33). A ``Move`` ends at the first foreign node (SIM-05), so the enemy
  comes into ``X`` only from a node of its own or along a road it is already on.
- ``cut_off``: the own nodes that lose their way over own nodes to the own capital when ``X`` falls
  (a chokepoint of the own territory): a lost chokepoint makes a pocket (DEC-43, item H).

Pure functions, no randomness, no ``set`` iteration (AGENTS.md, section 4.1 holds for the bots).
"""

from collections import deque
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from gow_sim.maps import MapDef
from gow_sim.view import Detail, EnemyGroupView, IntentKind, PlayerView

__all__ = ["RoadThreat", "cut_off", "fortified", "road_threats"]


@dataclass(frozen=True, slots=True)
class RoadThreat:
    """Visible enemy shots coming into own ``node`` by road ``edge`` from ``other``."""

    node: int
    edge: int
    other: int
    shots: int


def fortified(view: PlayerView, node: int, edge: int) -> bool:
    """An own fortification of ``node`` on ``edge``, built or being built (item D3: one per
    node and road)."""
    return any(f.node == node and f.owner == view.player for f in view.edges[edge].forts)


def figure_shots(f: EnemyGroupView, guess: int) -> int:
    """The shots of an enemy figure: the exact charges, the top of the range of units (its start
    for the open last range), ``guess`` for a presence."""
    if f.detail is Detail.EXACT and f.charged is not None:
        return f.charged
    if f.units_range is not None:
        low, high = f.units_range
        return low if high is None else high
    return guess


def road_threats(
    view: PlayerView,
    mapdef: MapDef,
    seen_shots: Callable[[int], int],
    ticks: Sequence[Sequence[int]],
    edge_keys: Sequence[int],
    *,
    guess: int,
    figures: bool,
) -> dict[tuple[int, int], RoadThreat]:
    """By ``(own node, road)`` the visible enemy shots coming into the node by that road (module
    docstring); only roads with some. ``seen_shots(m)``: the enemy shots of a fresh sighting in
    node ``m`` (0 without one); ``ticks``: the least travel ticks between nodes (``Travel``);
    ``edge_keys``: the mirror-invariant tie-break of the roads (``Bot.edge_keys``)."""
    me = view.player
    enemy = 1 - me
    nodes = view.nodes
    shots: dict[tuple[int, int], int] = {}
    others: dict[tuple[int, int], int] = {}
    entries: dict[int, list[tuple[int, int]]] = {}
    """Own node to its roads from an enemy node: ``(edge, enemy neighbour)``."""
    for n in nodes:
        if n.owner != me:
            continue
        for eid in mapdef.incident[n.id]:
            other = mapdef.edges[eid].other(n.id)
            if nodes[other].owner != enemy:
                continue
            entries.setdefault(n.id, []).append((eid, other))
            seen = seen_shots(other)
            if seen > 0:
                shots[(n.id, eid)] = seen
                others[(n.id, eid)] = other
    for i in view.intents:
        if i.owner == me or i.kind is not IntentKind.PLANNED_MOVE or i.target is None:
            continue
        ways = entries.get(i.target)
        if not ways:
            continue
        row = ticks[i.origin]
        reach = [(row[m], edge_keys[eid], eid, m) for eid, m in ways if row[m] >= 0]
        if not reach:
            continue
        _, _, eid, m = min(reach)  # the origin itself first (0 ticks), then the nearest
        key = (i.target, eid)
        shots[key] = shots.get(key, 0) + guess
        others[key] = m
    if figures:
        for e in view.edges:
            edef = mapdef.edges[e.id]
            for f in e.enemy_groups:
                head = edef.b if f.toward_b else edef.a
                if nodes[head].owner != me:
                    continue
                key = (head, e.id)
                shots[key] = shots.get(key, 0) + figure_shots(f, guess)
                others[key] = edef.other(head)
    return {
        key: RoadThreat(key[0], key[1], others[key], shots[key])
        for key in sorted(shots)
        if shots[key] > 0
    }


def cut_off(view: PlayerView, neighbors: Sequence[Sequence[int]], home: int, node: int) -> int:
    """Own nodes (``node`` aside) that reach the own capital ``home`` over own nodes now and do
    not without ``node``: what its loss cuts off. 0 for the capital itself or a capital that is
    not own."""
    me = view.player
    nodes = view.nodes
    if node == home or nodes[home].owner != me:
        return 0

    def reach(skip: int) -> list[bool]:
        seen = [False] * len(nodes)
        seen[home] = True
        queue = deque([home])
        while queue:
            n = queue.popleft()
            for m in neighbors[n]:
                if not seen[m] and m != skip and nodes[m].owner == me:
                    seen[m] = True
                    queue.append(m)
        return seen

    before = reach(-1)
    after = reach(node)
    return sum(1 for n in range(len(nodes)) if n != node and before[n] and not after[n])
