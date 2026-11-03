"""Road fortifications (DEC-43, item D, #707; code name ``road_fort``, the bunker is ``fort``).

mechanics.md, section 7, block DEC-43, item D:

- ``FortifyRoad(node, edge)`` (``gow_sim.commands`` validates it) puts a fortification of the own
  ``node`` on the road ``edge`` leaving it: ``Node.road_forts[edge]`` holds the tick it works from,
  the tick of the command plus ``fort.build_ticks`` (``start_road_fort``). The CP (``fort.cost``)
  are charged by ``apply_commands``. One per (node, road); ``systems.build`` emits
  ``road_fort_built`` when it starts to work; ``systems.capacity.change_owner`` destroys the
  fortifications of a captured node (``road_fort_destroyed``).
- **The toll** (``tolls``, a step of ``systems.combat`` after the edge stops and before the node
  contacts): a group not of the node's owner whose progress towards the fortified node goes from
  below the line point to it or past it in this tick, and that did not stop in a fight before the
  point, loses ``fort.toll(units, charged)`` charges. The line point is the border point of the
  edge (``border_permille``). A group with a planned bonus above its charged units after the toll
  keeps a bonus of its charged units (DEC-29). Groups are taken in id order; a group crosses at
  most one line per tick.
- Events: ``toll_paid`` to the payer (with its group), ``toll_taken`` to the owner of the
  fortification when the half of the node on that edge is not in fog for them at the toll (no
  group id); nothing when the toll takes 0.

Positions here are "towards the heading": thousandths of the edge from the end the group comes
from. A fight point is doubled (``pos_0 + pos_1`` from the end ``a``, DEC-24 item C3), so the
comparison with the line point is made doubled too, without a division.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass

from gow_sim.ruleset import Ruleset
from gow_sim.state import PROGRESS_SCALE, Detail, Event, GameState, event
from gow_sim.systems.movement import border_permille
from gow_sim.systems.vision import Vision, compute_vision

__all__ = ["Crossing", "line_point", "start_road_fort", "tolls"]


@dataclass(frozen=True, slots=True)
class Crossing:
    """A group's move along ``edge`` in this tick: towards ``heading``, from ``before`` to
    ``progress`` (thousandths from the other end). ``stop``: the doubled fight point (from the end
    ``a``) where it stops in this tick, ``None`` if it meets no fight."""

    gid: int
    owner: int
    edge: int
    heading: int
    before: int
    progress: int
    stop: int | None


def line_point(state: GameState, edge: int, node: int) -> int:
    """The line point of a fortification of ``node`` on ``edge`` in thousandths from the other end
    (item D5): the border point, where the half of ``node`` begins."""
    border = border_permille(state.map, edge)
    return border if node == state.map.edges[edge].b else PROGRESS_SCALE - border


def start_road_fort(
    state: GameState, rules: Ruleset, player: int, node: int, edge: int
) -> list[Event]:
    """Apply a validated ``FortifyRoad(node, edge)``: the fortification works ``fort.build_ticks``
    later (item D4). The CP are charged by ``apply_commands``."""
    fort = rules.fort
    assert fort is not None  # validated: FEATURE_DISABLED without [fort]
    state.nodes[node].road_forts[edge] = state.tick + fort.build_ticks
    return [
        event(
            state.tick,
            "build_started",
            player=player,
            node=node,
            edge=edge,
            kind="road_fort",
            level=None,
        )
    ]


def tolls(
    state: GameState,
    rules: Ruleset,
    crossings: Mapping[int, Crossing],
    on_toll: Callable[[int], None] | None = None,
) -> list[Event]:
    """Take the toll of every built line crossed in this tick (item D6), groups in id order.

    ``on_toll(gid)`` is called after a group paid (``systems.combat`` caps the bonus it brings into
    a fight with it)."""
    fort = rules.fort
    if fort is None:
        return []
    tick = state.tick
    events: list[Event] = []
    sight: dict[int, Vision] = {}
    for gid in sorted(crossings):
        x = crossings[gid]
        node = state.nodes[x.heading]
        ready = node.road_forts.get(x.edge)
        if ready is None or ready > tick or node.owner is None or node.owner == x.owner:
            continue
        line = line_point(state, x.edge, x.heading)
        reach = 2 * x.progress
        if x.stop is not None:
            to_b = x.heading == state.map.edges[x.edge].b
            reach = min(reach, x.stop if to_b else 2 * PROGRESS_SCALE - x.stop)
        if not (x.before < line and 2 * line <= reach):
            continue
        g = state.groups[gid]
        lost = fort.toll(g.units, g.charged)
        if lost <= 0:
            continue
        g.charged -= lost
        if g.bonus > g.charged:  # DEC-29: the bonus is at most the charged units
            g.bonus = g.charged
        if on_toll is not None:
            on_toll(gid)
        data = {"node": x.heading, "edge": x.edge, "charges": lost}
        events.append(event(tick, "toll_paid", player=g.owner, group=gid, **data))
        owner = node.owner
        if owner not in sight:
            sight[owner] = compute_vision(state, rules, owner)
        if sight[owner].half(x.heading) is not Detail.FOG:
            events.append(event(tick, "toll_taken", player=owner, **data))
    return events
