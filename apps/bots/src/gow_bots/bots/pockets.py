"""Pockets under the supply flow (DEC-43, item H; #684): what the smart bots read about them.

A *pocket* of a player is an own component (over own nodes and internal roads) without the own
capital (item H1, ``NodeView.flow_pocket``). Its factories stop (H2), without a factory it starves
(H4), and nothing of the capital's component reaches it, so a discharged group in it never
recharges. Two readings of the ``PlayerView`` (AGENTS.md, section 4.4: only the view):

- ``exits``: for every node the number of empty foreign nodes a group there must capture to stand
  in the capital's component. A ``Move`` ends at the first foreign node (SIM-05), so a pocket is
  left one capture at a time; a capture is free when ``capture.charge_cost`` is 0 (DEC-38, the
  ``mvp-4`` value), and a node the bot estimates empty (``need`` of 0) is taken without a fight,
  so even a discharged group takes it (``utility.takes``); under a price the group that walks out
  must pay it after the toll of the way in (``SmartBot.leave_pockets``, #760), the search here
  only finds the way. Own nodes cost nothing to pass, a node
  with a fight or one that needs shots cannot be passed (``-1``: no such way).
- ``rescue``: by foreign node next to both the capital's component and a pocket (the node that cut
  it), what its capture rejoins: the own units standing in those pockets, a stranded unit (without
  a charge, in a node with an empty warehouse: nothing recharges it there, and under a capture
  price it cannot walk out, DEC-38) once more (#683), and ``FACTORY_UNITS`` per own factory there
  (a stopped factory produces again from its next period, item H5). A pocket cut off by a chain of
  ``d`` foreign nodes (up to ``RESCUE_DEPTH``) weighs ``1 / d`` of that (rounded down) on the first
  node of the chain next to the capital's component: its capture is the first step back (#683).
- ``heading``: the own units ordered into each foreign node, those sent earlier and in this
  decision: the captured node holds them all at the arrivals, and units above its capacity die one
  every ``capacity.attrition_ticks`` (DEC-22, DEC-12; #754).

Pure functions, no randomness, no ``set`` iteration (AGENTS.md, section 4.1 holds for the bots).
"""

from collections import deque
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Final

from gow_sim.commands import Command, Move
from gow_sim.view import AtNode, PlayerView

__all__ = ["FACTORY_UNITS", "RESCUE_DEPTH", "Pockets", "heading", "read_pockets"]

RESCUE_DEPTH: Final = 3
"""Foreign nodes between the capital's component and a pocket up to which ``rescue`` counts it."""
FACTORY_UNITS: Final = 3
"""A stopped own factory in a pocket weighs like this many units in ``rescue``: the units of a
group it recharges again."""


@dataclass(frozen=True, slots=True)
class Pockets:
    """The pockets of one decision (module docstring)."""

    pocket: tuple[bool, ...]
    """By node: an own node in a pocket (``flow_pocket``)."""
    main: tuple[bool, ...]
    """By node: an own node of the capital's component."""
    exits: tuple[int, ...]
    """By node: free captures from it into the capital's component; ``-1``: none."""
    rescue: dict[int, int]
    """Foreign node next to the capital's component and a pocket: what its capture rejoins (the
    units, the stranded ones twice, and the factories, module docstring)."""


def read_pockets(
    view: PlayerView,
    neighbors: Sequence[Sequence[int]],
    main: Sequence[bool],
    free: Callable[[int], bool],
) -> Pockets | None:
    """The pockets of ``view``; ``None`` when no own node is in one (or outside the flow, where
    ``flow_pocket`` is ``None``).

    ``main``: the own nodes connected to the own capital over own nodes (``Bot.supplied``).
    ``free(node)``: a foreign node the bot can capture without a fight (asked lazily, only for
    the nodes the search reaches).
    """
    me = view.player
    nodes = view.nodes
    pocket = tuple(n.owner == me and n.flow_pocket is True for n in nodes)
    if not any(pocket):
        return None
    count = len(nodes)
    # Components of the pockets and what each holds.
    comp = [-1] * count
    weight: list[int] = []
    for start in range(count):
        if not pocket[start] or comp[start] >= 0:
            continue
        index = len(weight)
        comp[start] = index
        stack = [start]
        while stack:
            node = stack.pop()
            for other in neighbors[node]:
                if pocket[other] and comp[other] < 0:
                    comp[other] = index
                    stack.append(other)
        weight.append(0)
    for g in view.groups:
        loc = g.location
        if isinstance(loc, AtNode) and pocket[loc.node]:
            stranded = 0 if nodes[loc.node].warehouse else g.units - g.charged
            weight[comp[loc.node]] += g.units + stranded  # #683: a stranded unit counts twice
    for n in nodes:
        if pocket[n.id] and n.factory:
            weight[comp[n.id]] += FACTORY_UNITS
    # The nodes that cut a pocket off: the foreign nodes next to the capital's component, by the
    # foreign nodes between them and each pocket (#683: a pocket behind ``d`` of them weighs
    # ``1 / d``, rounded down, up to ``RESCUE_DEPTH``).
    count_comps = len(weight)
    rescue: dict[int, int] = {}
    for c in range(count_comps):
        dist = [0] * count
        frontier = [n for n in range(count) if comp[n] == c]
        for depth in range(1, RESCUE_DEPTH + 1):
            step: list[int] = []
            for node in frontier:
                for other in neighbors[node]:
                    if nodes[other].owner != me and dist[other] == 0:
                        dist[other] = depth
                        step.append(other)
            frontier = step
        for n in range(count):
            if dist[n] > 0 and any(main[m] for m in neighbors[n]):
                rescue[n] = rescue.get(n, 0) + weight[c] // dist[n]
    # Free captures into the capital's component (a 0-1 search from it: stepping from a node into
    # its neighbour ``u`` costs 0 when ``u`` is own, 1 when ``u`` is a free foreign node).
    exits = [-1] * count
    passable: dict[int, bool] = {}

    def cost(node: int) -> int | None:
        if nodes[node].owner == me:
            return 0
        if node not in passable:
            passable[node] = free(node)
        return 1 if passable[node] else None

    queue: deque[int] = deque()
    for node in range(count):
        if main[node]:
            exits[node] = 0
            queue.append(node)
    done = [False] * count
    while queue:
        u = queue.popleft()
        if done[u]:
            continue
        done[u] = True
        step = 0 if main[u] else cost(u)
        if step is None:
            continue
        for v in neighbors[u]:
            if main[v] or cost(v) is None:
                continue
            d = exits[u] + step
            if exits[v] < 0 or d < exits[v]:
                exits[v] = d
                if step == 0:
                    queue.appendleft(v)
                else:
                    queue.append(v)
    return Pockets(pocket, tuple(main), tuple(exits), rescue)


def heading(view: PlayerView, sent: Sequence[Command]) -> list[int]:
    """By node: the own units on the way into it while it is not own (module docstring): the own
    groups whose order ends there, with the moves ``sent`` in this decision in place of their
    earlier orders."""
    me, nodes = view.player, view.nodes
    dest: dict[int, int] = {}
    size: dict[int, int] = {}
    for g in view.groups:
        size[g.id] = g.units
        if g.order is not None:
            dest[g.id] = g.order.dest
    for cmd in sent:
        if isinstance(cmd, Move) and cmd.group in size:
            dest[cmd.group] = cmd.dest
    units = [0] * len(nodes)
    for gid in sorted(dest):
        if nodes[dest[gid]].owner != me:
            units[dest[gid]] += size[gid]
    return units
