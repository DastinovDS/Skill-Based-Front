"""What the smart bots read about arrivals and the own supply network (#166, PR 2).

Pure functions of the ``PlayerView``, the map and the ruleset (AGENTS.md, section 4.4: only the
view; DEC-35: only own groups see):

- ``arrivals``: the shown enemy forces heading into each own node and the earliest tick each can
  be there. An enemy figure on an edge (DEC-33) heading to an own node ends its path there (a path
  ends at the first foreign node, SIM-05), so it attacks that node; its arrival is estimated from
  the part of the edge left at the speed of the zone of that node (terrain times the road level,
  mechanics.md, section 4). A planned strike (DEC-08) arrives after its delay and the way
  (``Travel``, a lower bound).
- ``incoming_charges``: the charges of the own packets on their way to each node (the room a
  transfer can fill is ``capacity - warehouse - incoming``, DEC-18, item 6; #287).
- ``own_parts``: the parts of the own territory connected over own nodes (a transfer goes over
  own internal roads only, DEC-18, item 6).

No randomness, no ``set`` iteration (AGENTS.md, section 4.1 holds for the bots too).
"""

from dataclasses import dataclass

from gow_bots.bots.assess import Travel
from gow_bots.bots.utility import shots_to_take
from gow_sim.maps import MapDef
from gow_sim.ruleset import Ruleset
from gow_sim.view import AtNode, Detail, EnemyGroupView, IntentKind, PlayerView

__all__ = ["Arrival", "arrivals", "figure_ticks", "garrison_need", "incoming_charges", "own_parts"]


@dataclass(frozen=True, slots=True)
class Arrival:
    """The shown enemy forces heading into one own node."""

    tick: int
    """The earliest tick one of them can be in the node."""
    units: int
    """Their units (an upper guess where the fog hides the numbers), all taken as charged."""


def figure_ticks(
    view: PlayerView, mapdef: MapDef, rules: Ruleset, edge: int, f: EnemyGroupView
) -> int:
    """Ticks figure ``f`` on ``edge`` still needs to reach the end it heads to: the part of the
    edge left (``pos`` in thousandths from ``a``) at the speed of that end's terrain on the road
    level of the view, ``travel_ticks * 100 // speed`` scaled by the part (rounded down)."""
    e = mapdef.edges[edge]
    node = e.b if f.toward_b else e.a
    left = 1000 - f.pos if f.toward_b else f.pos
    width = view.edges[edge].width
    road = 100 if width <= 1 else rules.road.speed_pct.of(width)
    speed = max(1, rules.terrain.speed_pct.of(mapdef.nodes[node].terrain) * road // 100)
    return e.travel_ticks * 100 * left // (speed * 1000)


def _units(f: EnemyGroupView, guess: int) -> int:
    if f.detail is Detail.EXACT and f.units is not None:
        return f.units
    if f.units_range is not None:
        low, high = f.units_range
        return low if high is None else high
    return guess


def arrivals(
    view: PlayerView, mapdef: MapDef, rules: Ruleset, travel: Travel, guess: int
) -> dict[int, Arrival]:
    """Own node to the ``Arrival`` of the shown enemy forces heading into it (module docstring).

    ``travel``: the lower bounds of the way of a planned strike; ``guess``: units assumed where
    the fog hides the numbers. The units of every force heading
    into a node are summed, the tick is the earliest of them."""
    me = view.player
    found: dict[int, Arrival] = {}

    def add(node: int, tick: int, units: int) -> None:
        old = found.get(node)
        if old is None:
            found[node] = Arrival(tick, units)
        else:
            found[node] = Arrival(min(old.tick, tick), old.units + units)

    for e in view.edges:
        edef = mapdef.edges[e.id]
        for f in e.enemy_groups:
            node = edef.b if f.toward_b else edef.a
            if view.nodes[node].owner == me:
                add(node, view.tick + figure_ticks(view, mapdef, rules, e.id, f), _units(f, guess))
    delay = rules.orders.planned_delay_ticks
    for i in view.intents:
        if i.owner == me or i.kind is not IntentKind.PLANNED_MOVE or i.target is None:
            continue
        if view.nodes[i.target].owner != me:
            continue
        way = max(0, travel.ticks[i.origin][i.target])
        add(i.target, max(view.tick, i.created_tick + delay + way), guess)
    return found


def garrison_need(view: PlayerView, mapdef: MapDef, rules: Ruleset, node: int) -> int:
    """Shots that take the own ``node`` from the own groups standing in it now (DEC-07,
    ``shots_to_take``, with the own Defense bonus the view shows)."""
    units = charged = defense = 0
    for g in view.groups:
        if g.location == AtNode(node):
            units += g.units
            charged += g.charged
            defense += g.defense_bonus or 0
    return shots_to_take(rules, mapdef.nodes[node].terrain, units, charged, defense)


def incoming_charges(view: PlayerView) -> dict[int, int]:
    """Node to the charges of the own packets heading there (the last node of a packet's path)."""
    found: dict[int, int] = {}
    for p in view.packets:
        if p.path:
            dest = p.path[-1]
            found[dest] = found.get(dest, 0) + p.charges
    return found


def own_parts(view: PlayerView, mapdef: MapDef) -> list[int]:
    """For every node the index of its part of the own territory (connected over own nodes),
    ``-1`` for a node that is not own. Parts are numbered in node id order."""
    me = view.player
    part = [-1] * len(view.nodes)
    count = 0
    for start in range(len(view.nodes)):
        if part[start] >= 0 or view.nodes[start].owner != me:
            continue
        part[start] = count
        stack = [start]
        while stack:
            node = stack.pop()
            for eid in mapdef.incident[node]:
                other = mapdef.edges[eid].other(node)
                if part[other] < 0 and view.nodes[other].owner == me:
                    part[other] = count
                    stack.append(other)
        count += 1
    return part
