"""Capture costs a charge (DEC-38, #578; mechanics.md, section 4, the DEC-38 block).

``k = capture.charge_cost``. Every change of the owner of a node to a player whose groups are in
it (an empty neutral node in ``movement.settle_arrivals``, an empty enemy node and the end of a
node fight in ``combat``) first calls ``pay``: the real charges of the capturing player's groups
in the node are pooled, one payment per node (item 2). With at least ``k`` charges, ``k`` are
spent one at a time, each from the group with the most ``charged``, ties by the smaller id
(DEC-07, rule 7); the units stay. The spent charges go nowhere (not into the warehouse). With
``k = 0`` nothing is spent and every capture happens as before.

Virtual charges (the planned bonus, "Defense", mountains) are not in ``Group.charged``, so they
never pay (item 3). Without enough charges the node keeps its owner and every capturing group
bounces (item 4): ``bounce_back`` here for an empty node, the bounce of DEC-24, item G1 at the
end of a fight (``combat``). A returning group dies instead (DEC-24, item G3). Each failed group
gets a ``capture_failed`` event, only for its player (item 10).

The payment reads only the counters of one player's groups, ties by id inside that player, so
the players stay symmetric (item 11).
"""

from collections.abc import Sequence
from enum import StrEnum

from gow_sim.ruleset import Ruleset
from gow_sim.state import PROGRESS_SCALE, Event, GameState, Group, OnEdge, event

__all__ = ["CaptureFailure", "bounce_back", "failed", "pay"]


class CaptureFailure(StrEnum):
    """``capture_failed.result``: the group bounced, or it was a returning group and died."""

    BOUNCE = "bounce"
    ENCIRCLED = "encircled"


def pay(rules: Ruleset, payers: Sequence[Group]) -> bool:
    """Spend ``capture.charge_cost`` charges of ``payers`` (DEC-38, item 2); ``False`` (and
    nothing spent) when their pool has fewer."""
    cost = rules.capture.charge_cost
    if sum(g.charged for g in payers) < cost:
        return False
    for _ in range(cost):
        g = max((g for g in payers if g.charged > 0), key=lambda g: (g.charged, -g.id))
        g.charged -= 1
    return True


def failed(state: GameState, node: int, g: Group, result: CaptureFailure) -> Event:
    """The ``capture_failed`` event of ``g`` (DEC-38, item 10)."""
    return event(
        state.tick, "capture_failed", node=node, player=g.owner, group=g.id, result=result.value
    )


def bounce_back(
    state: GameState, g: Group, node: int, edge: int, from_node: int, *, returning: bool
) -> Event:
    """``g`` arrived in ``node`` over ``edge`` from ``from_node`` in this tick and could not pay
    (DEC-38, item 4): it is put back on the edge at ``progress = 1000`` going home (the first
    step in the next tick, home after the edge time), the order and its bonus burn; a returning
    group dies there (DEC-24, item G3)."""
    if returning:
        e = failed(state, node, g, CaptureFailure.ENCIRCLED)
        del state.groups[g.id]
        return e
    level = state.edges[edge].width  # a new start on the edge (DEC-28, item 7)
    g.location = OnEdge(edge, from_node, PROGRESS_SCALE, back=True, level=level)
    g.order = None
    g.bonus = 0
    g.bonus_tick = 0
    return failed(state, node, g, CaptureFailure.BOUNCE)
