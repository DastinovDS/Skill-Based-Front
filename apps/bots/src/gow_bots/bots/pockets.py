"""Pockets under the supply flow (DEC-43, item H; #684): what the smart bots read about them.

A *pocket* of a player is an own component (over own nodes and internal roads) without the own
capital (item H1, ``NodeView.flow_pocket``). Its factories stop (H2), without a factory it starves
(H4), and nothing of the capital's component reaches it, so a discharged group in it never
recharges. Two readings of the ``PlayerView`` (AGENTS.md, section 4.4: only the view):

- ``exits``: for every node the number of empty foreign nodes a group there must capture to stand
  in the capital's component. A ``Move`` ends at the first foreign node (SIM-05), so a pocket is
  left one capture at a time; a capture is free when ``capture.charge_cost`` is 0 (DEC-38, the
  ``mvp-4`` value), and a node the bot estimates empty (``need`` of 0) is taken without a fight,
  so even a discharged group takes it (``utility.takes``). Own nodes cost nothing to pass, a node
  with a fight or one that needs shots cannot be passed (``-1``: no such way).
- ``rescue``: by foreign node next to both the capital's component and a pocket (the node that cut
  it), what its capture rejoins: the own units standing in those pockets and ``FACTORY_UNITS`` per
  own factory there (a stopped factory produces again from its next period, item H5).

Pure functions, no randomness, no ``set`` iteration (AGENTS.md, section 4.1 holds for the bots).
"""

from collections import deque
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Final

from gow_sim.view import AtNode, PlayerView

__all__ = ["FACTORY_UNITS", "Pockets", "read_pockets"]

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
    """Foreign node next to the capital's component and a pocket: what its capture rejoins."""


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
            weight[comp[loc.node]] += g.units
    for n in nodes:
        if pocket[n.id] and n.factory:
            weight[comp[n.id]] += FACTORY_UNITS
    # The nodes that cut a pocket off.
    rescue: dict[int, int] = {}
    for n in nodes:
        if n.owner == me or not any(main[m] for m in neighbors[n.id]):
            continue
        touched: list[int] = []
        for m in neighbors[n.id]:
            if pocket[m] and comp[m] not in touched:
                touched.append(comp[m])
        if touched:
            rescue[n.id] = sum(weight[c] for c in touched)
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
