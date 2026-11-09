"""What the smart bots read about the arrivals of the enemy (#166, PR 2).

Pure functions of the ``PlayerView``, the map and the ruleset (AGENTS.md, section 4.4: only the
view; DEC-35: only own groups see):

- ``arrivals``: the shown enemy forces heading into each own node and the earliest tick each can
  be there. An enemy figure on an edge (DEC-33) heading to an own node ends its path there (a path
  ends at the first foreign node, SIM-05), so it attacks that node; its arrival is estimated from
  the part of the edge left at the speed of the zone of that node (its terrain, mechanics.md,
  section 4). A planned strike (DEC-08) arrives after it gathered one bonus at least (DEC-41,
  item 10) and the way (``Travel``, a lower bound).
- ``garrison_need``: the shots that take an own node from its garrison now.

No randomness, no ``set`` iteration (AGENTS.md, section 4.1 holds for the bots too).
"""

from dataclasses import dataclass

from gow_bots.bots.assess import Travel
from gow_bots.bots.utility import shots_to_take, terrain_burned
from gow_sim.maps import MapDef
from gow_sim.ruleset import Ruleset
from gow_sim.view import AtNode, Detail, EnemyGroupView, PlayerView

__all__ = ["Arrival", "arrivals", "figure_ticks", "garrison_need"]


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
    edge left (``pos`` in thousandths from ``a``) at the speed of that end's terrain,
    ``travel_ticks * 100 // speed`` scaled by the part (rounded down). ``view`` is not read."""
    del view
    e = mapdef.edges[edge]
    node = e.b if f.toward_b else e.a
    left = 1000 - f.pos if f.toward_b else f.pos
    speed = max(1, rules.terrain.speed_pct.of(mapdef.nodes[node].terrain))
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
    delay = rules.orders.plan_ticks_per_bonus  # it gathers one bonus at least (DEC-41, item 10)
    for i in view.intents:
        if i.owner == me or i.target is None:
            continue
        if view.nodes[i.target].owner != me:
            continue
        way = max(0, travel.ticks[i.origin][i.target])
        add(i.target, max(view.tick, i.created_tick + delay + way), guess)
    return found


def garrison_need(view: PlayerView, mapdef: MapDef, rules: Ruleset, node: int) -> int:
    """Shots that take the own ``node`` from the own groups standing in it now (DEC-07,
    ``shots_to_take``)."""
    units = charged = 0
    for g in view.groups:
        if g.location == AtNode(node):
            units += g.units
            charged += g.charged
    burned = terrain_burned(rules, view, node)
    return shots_to_take(rules, mapdef.nodes[node].terrain, units, charged, burned=burned)
