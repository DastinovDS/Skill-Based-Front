"""Road upgrades by a city (DEC-16, #203; mechanics.md, section 8).

- ``UpgradeRoad(node, edge)`` (SIM-04 validates it) lets the own city ``node`` raise the width of
  the internal ``edge`` at it by one level. ``start_build()`` applies it at the start of tick
  ``t``: ``build.charges_per_level[w + 1]`` charges leave the city warehouse (before the recharge
  of the same tick: ``apply_commands`` runs before ``supply``), the CP cost ``orders.cost.build``
  is charged by ``apply_commands``; event ``build_started``.
- The ``build`` system raises the width by one at tick ``t + build.ticks_per_level`` (event
  ``road_upgraded``) and ends the build. The next level is a new command and a new payment.
- One build per city, one city per edge (``city_busy``, ``edge_busy``).
- Every tick the ``build`` system checks that the edge is still internal for the player who
  started the build; if not (the builder city or the other end was captured), the build is
  removed: ``build_stopped`` with ``reason = "interrupted"``, the width stays, the charges are
  not returned. Combat runs before ``build``, so a capture in the completion tick cancels the
  level. Nothing else stops a build: no fight without an owner change, no loss of supply, no
  empty warehouse, no group movement.
- There is no cancel.
- Capacities are recomputed from the new width (``systems.capacity.node_capacities`` compares
  the widths it was computed from); packet speed is read from the width when a packet is sent
  (supply, SIM-08).
- ``upgrade_gain()``: what the next level gives, for the road hint in the client
  (mechanics.md, section 18; the ``upgrade_gain`` of an own edge in the view, SIM-14).

The build events go only to their player (DEC-17, item 6; ``gow_protocol.convert``).
"""

from dataclasses import dataclass

from gow_sim.ruleset import Ruleset
from gow_sim.state import Build, Event, GameState, event
from gow_sim.systems.capacity import is_internal


@dataclass(frozen=True, slots=True)
class UpgradeGain:
    """What the next level of a road gives (the ``UpgradeGain`` of the protocol, PRO-01).

    ``capacity_centi``: capacity gain of each end city in hundredths, from
    ``capacity.width_gain_centi`` (counts for an end city in its owner's supplied territory).
    ``packet_speed_pct``: packet speed gain in percentage points, from ``supply.packet_speed_pct``.
    """

    capacity_centi: int
    packet_speed_pct: int


def upgrade_gain(state: GameState, rules: Ruleset, edge: int) -> UpgradeGain | None:
    """Gain of raising ``edge`` by one level; ``None`` when it already has ``max_width``."""
    width = state.edges[edge].width
    if width >= state.map.edges[edge].max_width:
        return None
    gains = rules.capacity.width_gain_centi
    speeds = rules.supply.packet_speed_pct
    return UpgradeGain(
        capacity_centi=gains.of(width + 1) - gains.of(width),
        packet_speed_pct=speeds.of(width + 1) - speeds.of(width),
    )


def level_price(state: GameState, rules: Ruleset, edge: int) -> int:
    """Charges for the next level of ``edge`` below ``max_width``: ``charges_per_level[w + 1]``."""
    return rules.build.charges_per_level.of(state.edges[edge].width + 1)


def builder_of(state: GameState, edge: int) -> int | None:
    """The city that builds ``edge`` now, or ``None``: one of its two ends (DEC-16, item 5)."""
    e = state.map.edges[edge]
    for node in (e.a, e.b):
        b = state.nodes[node].build
        if b is not None and b.edge == edge:
            return node
    return None


def done_tick(rules: Ruleset, b: Build) -> int:
    """The tick the build raises the width (unless it is interrupted first)."""
    return b.since + rules.build.ticks_per_level


def start_build(state: GameState, rules: Ruleset, player: int, node: int, edge: int) -> Event:
    """Apply a validated ``UpgradeRoad(node, edge)``: pay from the warehouse, start the build."""
    width = state.edges[edge].width + 1
    price = rules.build.charges_per_level.of(width)
    city = state.nodes[node]
    city.warehouse -= price
    city.build = Build(edge=edge, owner=player, since=state.tick)
    return event(
        state.tick,
        "build_started",
        player=player,
        node=node,
        edge=edge,
        width=width,
        charges=price,
    )


def _holds(state: GameState, b: Build) -> bool:
    """The edge is still internal for the player who started the build."""
    return is_internal(state, b.edge) and state.nodes[state.map.edges[b.edge].a].owner == b.owner


def build(state: GameState, rules: Ruleset) -> list[Event]:
    """Finish or interrupt the builds of the cities (see the module docstring).

    Cities are walked in id order; a build belongs to one player and one edge, so the order
    never decides between players or between builds.
    """
    tick = state.tick
    events: list[Event] = []
    for nid in sorted(state.nodes):
        city = state.nodes[nid]
        b = city.build
        if b is None:
            continue
        data = {"player": b.owner, "node": nid, "edge": b.edge}
        if not _holds(state, b):
            city.build = None
            events.append(event(tick, "build_stopped", reason="interrupted", **data))
            continue
        if tick >= done_tick(rules, b):
            edge = state.edges[b.edge]
            edge.width += 1  # validated below max_width; nothing else changes widths
            city.build = None
            events.append(event(tick, "road_upgraded", width=edge.width, **data))
    return events
