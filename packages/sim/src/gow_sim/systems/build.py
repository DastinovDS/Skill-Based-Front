"""Builds (DEC-16, #203; DEC-22, #234; DEC-26, #265; DEC-28, #290): a road level on an edge, the
barracks or a warehouse level of a city.

- ``UpgradeRoad(edge)`` (SIM-04 validates it) raises the own internal ``edge`` by one level for
  ``orders.cost.build`` CP (DEC-28, item 7), charged at the start by ``apply_commands``; no city
  pays or builds it. Levels are ``1..max_width`` (at most 3). ``start_road()`` puts the build on
  the edge (``Edge.build``); event ``build_started``. One build per edge (``EDGE_BUSY``), any
  number of builds at a time.
- With ``city_upgrades`` (DEC-26, items 2, 3, 8): ``BuildBarracks(node)`` and
  ``UpgradeWarehouse(node)`` take the build slot of the city (``Node.build``, one at a time for
  the two kinds; roads do not take it); their CP (``orders.cost.barracks``,
  ``orders.cost.warehouse``) are charged at the start (``start_city_build()``), the build ends
  ``city_upgrades.barracks_ticks`` or ``warehouse_ticks`` later. Without the flag the commands are
  rejected.
- The ``build`` system ends a build at tick ``since + duration``: a road level grows by one
  (``road_upgraded``), the city gets its barracks (``barracks_built``) or one more warehouse
  level (``warehouse_upgraded``). The next level is a new command and a new payment.
- Every tick the ``build`` system checks that the build still holds: a road while the edge is
  internal for the player who started it (a capture of either end stops it), the barracks and the
  warehouse while the city is theirs. If not, the build is removed: ``build_stopped`` with
  ``reason = "interrupted"``, the level stays, CP are not returned. Combat runs before ``build``,
  so a capture in the completion tick cancels it. Nothing else stops a build: no fight without an
  owner change, no loss of supply, no group movement.
- There is no cancel.
- A road level changes the supply (packet speed ``supply.fast_speed_pct``, throughput
  ``supply.amount_by_level``, read when a packet is sent or a dispatch runs) and the unit speed
  (``road.speed_pct``, read when a group enters the edge; ``systems.movement``).
- ``upgrade_gain()``: what the next level gives, for the road hint in the client (the
  ``upgrade_gain`` of an own edge in the view, SIM-14).

The build events go only to their player (DEC-17, item 6; ``gow_protocol.convert``).
"""

from dataclasses import dataclass

from gow_sim.ruleset import Ruleset
from gow_sim.state import Build, BuildKind, Event, GameState, event
from gow_sim.systems.capacity import is_internal
from gow_sim.systems.movement import road_speed_pct as unit_speed_pct
from gow_sim.systems.supply import road_amount, road_speed_pct


@dataclass(frozen=True, slots=True)
class UpgradeGain:
    """What the next level of a road gives (DEC-28, item 7): the gains of the packet speed
    (``speed_pct``) and of the unit speed (``unit_speed_pct``), in percentage points, and of the
    charges per dispatch period (``amount``)."""

    speed_pct: int
    unit_speed_pct: int
    amount: int


def upgrade_gain(state: GameState, rules: Ruleset, edge: int) -> UpgradeGain | None:
    """Gain of raising ``edge`` by one level; ``None`` when it already has ``max_width``."""
    level = state.edges[edge].width
    if level >= state.map.edges[edge].max_width:
        return None
    return UpgradeGain(
        speed_pct=road_speed_pct(rules, level + 1) - road_speed_pct(rules, level),
        unit_speed_pct=unit_speed_pct(rules, level + 1) - unit_speed_pct(rules, level),
        amount=road_amount(rules, level + 1) - road_amount(rules, level),
    )


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


def start_road(state: GameState, player: int, edge: int) -> Event:
    """Apply a validated ``UpgradeRoad(edge)`` (the CP are charged by SIM-04): start the build."""
    road = state.edges[edge]
    road.build = Build(edge=edge, owner=player, since=state.tick, kind=BuildKind.ROAD)
    return event(
        state.tick,
        "build_started",
        player=player,
        kind=BuildKind.ROAD.value,
        edge=edge,
        width=road.width + 1,
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


def build(state: GameState, rules: Ruleset) -> list[Event]:
    """Finish or interrupt the builds (see the module docstring).

    Edges and then cities are walked in id order; a build belongs to one player and one edge or
    city, so the order never decides between players or between builds.
    """
    tick = state.tick
    events: list[Event] = []
    for eid in sorted(state.edges):
        road = state.edges[eid]
        b = road.build
        if b is None:
            continue
        a = state.map.edges[eid].a
        if not (is_internal(state, eid) and state.nodes[a].owner == b.owner):
            road.build = None
            events.append(
                event(
                    tick,
                    "build_stopped",
                    player=b.owner,
                    kind=b.kind.value,
                    edge=eid,
                    reason="interrupted",
                )
            )
            continue
        if tick < done_tick(rules, b):
            continue
        road.build = None
        road.width += 1  # validated below max_width; nothing else changes levels
        events.append(event(tick, "road_upgraded", player=b.owner, edge=eid, width=road.width))
    for nid in sorted(state.nodes):
        city = state.nodes[nid]
        b = city.build
        if b is None:
            continue
        data = {"player": b.owner, "node": nid, "kind": b.kind.value}
        if city.owner != b.owner:
            city.build = None
            events.append(event(tick, "build_stopped", reason="interrupted", edge=None, **data))
            continue
        if tick < done_tick(rules, b):
            continue
        city.build = None
        match b.kind:
            case BuildKind.ROAD:  # roads are built on edges (DEC-28); never in a city
                raise ValueError(f"city {nid} holds a road build")
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
