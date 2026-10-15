"""The build of a city (DEC-16, #203; DEC-22, #234; DEC-26, #265): a road level, the barracks or a
warehouse level.

- ``UpgradeRoad(node, edge)`` (SIM-04 validates it) lets the own city ``node`` raise the level
  of the internal ``edge`` at it by one. Levels are ``1..max_width`` (at most 3); roads have no
  type, a level only speeds the supply up (DEC-26, item 7). ``start_road()`` applies it at the
  start of tick ``t``: ``build.charges_per_level[level + 1]`` charges leave the city warehouse
  (before the recharge of the same tick: ``apply_commands`` runs before ``supply``), the CP cost
  ``orders.cost.build`` is charged by ``apply_commands``; event ``build_started``.
- With ``city_upgrades`` (DEC-26, items 2, 3, 8): ``BuildBarracks(node)`` and
  ``UpgradeWarehouse(node)`` take the same build slot of the city (one build at a time for the
  three kinds); their CP (``orders.cost.barracks``, ``orders.cost.warehouse``) are charged at the
  start (``start_city_build()``), the build ends ``city_upgrades.barracks_ticks`` or
  ``warehouse_ticks`` later. Without the flag the commands are rejected, the slot is the roads'.
- The ``build`` system ends a build at tick ``since + duration``: a road level grows by one
  (``road_upgraded``), the city gets its barracks (``barracks_built``) or one more warehouse
  level (``warehouse_upgraded``). The next level is a new command and a new payment.
- One build per city, one city per edge (``city_busy``, ``edge_busy``).
- Every tick the ``build`` system checks that the build still holds: a road while the edge is
  internal for the player who started it, the barracks and the warehouse while the city is
  theirs. If not, the build is removed: ``build_stopped`` with ``reason = "interrupted"``, the
  level stays, charges and CP are not returned. Combat runs before ``build``, so a capture in the
  completion tick cancels it. Nothing else stops a build: no fight without an owner change, no
  loss of supply, no empty warehouse, no group movement.
- There is no cancel.
- A road level changes only supply (DEC-22): the packet speed is read from the level when a packet
  is sent (``systems.supply``); capacities do not depend on roads.
- ``upgrade_gain()``: what the next level gives, for the road hint in the client (DEC-26, item 7:
  only the packet speed; the ``upgrade_gain`` of an own edge in the view, SIM-14).

The build events go only to their player (DEC-17, item 6; ``gow_protocol.convert``).
"""

from dataclasses import dataclass

from gow_sim.ruleset import Ruleset
from gow_sim.state import Build, BuildKind, Event, GameState, event
from gow_sim.systems.capacity import is_internal
from gow_sim.systems.supply import road_speed_pct


@dataclass(frozen=True, slots=True)
class UpgradeGain:
    """What the next level of a road gives (DEC-26, item 7): the packet speed gain in percentage
    points; the amount per period does not grow."""

    speed_pct: int


def upgrade_gain(state: GameState, rules: Ruleset, edge: int) -> UpgradeGain | None:
    """Gain of raising ``edge`` by one level; ``None`` when it already has ``max_width``."""
    level = state.edges[edge].width
    if level >= state.map.edges[edge].max_width:
        return None
    return UpgradeGain(speed_pct=road_speed_pct(rules, level + 1) - road_speed_pct(rules, level))


def level_price(state: GameState, rules: Ruleset, edge: int) -> int:
    """Charges for the next level of ``edge`` below ``max_width``: ``charges_per_level[w + 1]``."""
    return rules.build.charges_per_level.of(state.edges[edge].width + 1)


def builder_of(state: GameState, edge: int) -> int | None:
    """The city that builds ``edge`` now, or ``None``: one of its two ends (DEC-16, item 5)."""
    e = state.map.edges[edge]
    for node in (e.a, e.b):
        b = state.nodes[node].build
        if b is not None and b.kind is BuildKind.ROAD and b.edge == edge:
            return node
    return None


def duration(rules: Ruleset, kind: BuildKind) -> int:
    """Ticks a build of ``kind`` takes."""
    match kind:
        case BuildKind.ROAD:
            return rules.build.ticks_per_level
        case BuildKind.BARRACKS:
            return rules.city_upgrades.barracks_ticks
        case BuildKind.WAREHOUSE:
            return rules.city_upgrades.warehouse_ticks


def done_tick(rules: Ruleset, b: Build) -> int:
    """The tick the build ends (unless it is interrupted first)."""
    return b.since + duration(rules, b.kind)


def start_road(state: GameState, rules: Ruleset, player: int, node: int, edge: int) -> Event:
    """Apply a validated ``UpgradeRoad(node, edge)``: pay from the warehouse, start it."""
    width = state.edges[edge].width + 1
    price = rules.build.charges_per_level.of(width)
    city = state.nodes[node]
    city.warehouse -= price
    city.build = Build(edge=edge, owner=player, since=state.tick, kind=BuildKind.ROAD)
    return event(
        state.tick,
        "build_started",
        player=player,
        node=node,
        kind=BuildKind.ROAD.value,
        edge=edge,
        width=width,
        charges=price,
    )


def start_city_build(state: GameState, player: int, node: int, kind: BuildKind) -> Event:
    """Apply a validated ``BuildBarracks`` or ``UpgradeWarehouse`` (the CP are charged by SIM-04).

    ``level``: the warehouse level the build gives, ``None`` for the barracks.
    """
    city = state.nodes[node]
    city.build = Build(edge=None, owner=player, since=state.tick, kind=kind)
    level = city.warehouse_level + 1 if kind is BuildKind.WAREHOUSE else None
    return event(
        state.tick, "build_started", player=player, node=node, kind=kind.value, level=level
    )


def _holds(state: GameState, node: int, b: Build) -> bool:
    """A road: the edge is still internal for the player who started it; the barracks and the
    warehouse: the city is still theirs (DEC-26, item 8)."""
    if b.edge is None:
        return state.nodes[node].owner == b.owner
    return is_internal(state, b.edge) and state.nodes[state.map.edges[b.edge].a].owner == b.owner


def build(state: GameState, rules: Ruleset) -> list[Event]:
    """Finish or interrupt the builds of the cities (see the module docstring).

    Cities are walked in id order; a build belongs to one player and one city (and a road build
    to one edge), so the order never decides between players or between builds.
    """
    tick = state.tick
    events: list[Event] = []
    for nid in sorted(state.nodes):
        city = state.nodes[nid]
        b = city.build
        if b is None:
            continue
        data = {"player": b.owner, "node": nid, "kind": b.kind.value}
        if not _holds(state, nid, b):
            city.build = None
            events.append(event(tick, "build_stopped", reason="interrupted", edge=b.edge, **data))
            continue
        if tick < done_tick(rules, b):
            continue
        city.build = None
        match b.kind:
            case BuildKind.ROAD:
                assert b.edge is not None
                edge = state.edges[b.edge]
                edge.width += 1  # validated below max_width; nothing else changes levels
                events.append(
                    event(
                        tick,
                        "road_upgraded",
                        player=b.owner,
                        node=nid,
                        edge=b.edge,
                        width=edge.width,
                    )
                )
            case BuildKind.BARRACKS:
                city.has_barracks = True
                events.append(event(tick, "barracks_built", player=b.owner, node=nid))
            case BuildKind.WAREHOUSE:
                city.warehouse_level += 1  # validated below warehouse.max_level
                events.append(
                    event(
                        tick,
                        "warehouse_upgraded",
                        player=b.owner,
                        node=nid,
                        level=city.warehouse_level,
                    )
                )
    return events
