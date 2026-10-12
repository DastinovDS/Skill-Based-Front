"""Road upgrades by a city (DEC-16, #203; numbers and road types: DEC-22, #234).

- ``UpgradeRoad(node, edge, kind)`` (SIM-04 validates it) lets the own city ``node`` raise the
  level of the internal ``edge`` at it by one. Levels are ``1..max_width`` (at most 3); the first
  upgrade (1 -> 2) chooses the road type ``kind`` (``fast`` or ``freight``), the second keeps it
  (DEC-22, item 2). ``start_build()`` applies it at the start of tick ``t``:
  ``build.charges_per_level[level + 1]`` charges leave the city warehouse (before the recharge of
  the same tick: ``apply_commands`` runs before ``supply``), the CP cost ``orders.cost.build`` is
  charged by ``apply_commands``; event ``build_started``.
- The ``build`` system raises the level by one and sets the type at tick
  ``t + build.ticks_per_level`` (event ``road_upgraded``) and ends the build. The next level is a
  new command and a new payment.
- One build per city, one city per edge (``city_busy``, ``edge_busy``).
- Every tick the ``build`` system checks that the edge is still internal for the player who
  started the build; if not (the builder city or the other end was captured), the build is
  removed: ``build_stopped`` with ``reason = "interrupted"``, the level stays, the charges are
  not returned. Combat runs before ``build``, so a capture in the completion tick cancels the
  level. Nothing else stops a build: no fight without an owner change, no loss of supply, no
  empty warehouse, no group movement.
- There is no cancel.
- A level changes only supply (DEC-22): packet speed and amount are read from the level and the
  type when a packet is sent (``systems.supply``); capacities do not depend on roads.
- ``upgrade_gain()``: what the next level gives, for the road hint in the client
  (DEC-22, item 7; the ``upgrade_gain`` of an own edge in the view, SIM-14).

The build events go only to their player (DEC-17, item 6; ``gow_protocol.convert``).
"""

from dataclasses import dataclass

from gow_sim.ruleset import Ruleset
from gow_sim.state import Build, Event, GameState, RoadKind, event
from gow_sim.systems.capacity import is_internal
from gow_sim.systems.supply import road_amount, road_speed_pct


@dataclass(frozen=True, slots=True)
class RoadGain:
    """What one more level of one road type adds (DEC-22, item 7).

    ``speed_pct``: packet speed gain in percentage points; ``amount``: gain in charges per
    dispatch period.
    """

    speed_pct: int
    amount: int


@dataclass(frozen=True, slots=True)
class UpgradeGain:
    """What the next level of a road gives, per road type (the ``UpgradeGain`` of the protocol).

    On level 1 both types are offered; on level 2 only the road's own type, the other is ``None``.
    """

    fast: RoadGain | None
    freight: RoadGain | None


def _gain(rules: Ruleset, level: int, kind: RoadKind, new_kind: RoadKind) -> RoadGain:
    return RoadGain(
        speed_pct=road_speed_pct(rules, level + 1, new_kind) - road_speed_pct(rules, level, kind),
        amount=road_amount(rules, level + 1, new_kind) - road_amount(rules, level, kind),
    )


def upgrade_gain(state: GameState, rules: Ruleset, edge: int) -> UpgradeGain | None:
    """Gain of raising ``edge`` by one level; ``None`` when it already has ``max_width``."""
    road = state.edges[edge]
    if road.width >= state.map.edges[edge].max_width:
        return None
    level, kind = road.width, road.kind
    offered = (RoadKind.FAST, RoadKind.FREIGHT) if kind is RoadKind.NONE else (kind,)
    fast, freight = (
        _gain(rules, level, kind, k) if k in offered else None
        for k in (RoadKind.FAST, RoadKind.FREIGHT)
    )
    return UpgradeGain(fast=fast, freight=freight)


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
    """The tick the build raises the level (unless it is interrupted first)."""
    return b.since + rules.build.ticks_per_level


def start_build(
    state: GameState, rules: Ruleset, player: int, node: int, edge: int, kind: RoadKind | None
) -> Event:
    """Apply a validated ``UpgradeRoad(node, edge, kind)``: pay from the warehouse, start it.

    ``kind`` matters only for the first upgrade (validated: ``fast`` or ``freight``); later the
    road keeps its own type.
    """
    road = state.edges[edge]
    width = road.width + 1
    new_kind = road.kind if road.kind is not RoadKind.NONE or kind is None else kind
    price = rules.build.charges_per_level.of(width)
    city = state.nodes[node]
    city.warehouse -= price
    city.build = Build(edge=edge, owner=player, since=state.tick, kind=new_kind)
    return event(
        state.tick,
        "build_started",
        player=player,
        node=node,
        edge=edge,
        width=width,
        road=new_kind.value,
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
            edge.width += 1  # validated below max_width; nothing else changes levels
            edge.kind = b.kind
            city.build = None
            events.append(
                event(tick, "road_upgraded", width=edge.width, road=edge.kind.value, **data)
            )
    return events
