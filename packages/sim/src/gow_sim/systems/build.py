"""Road upgrades in the mode «Строительство» (SIM-11; mechanics.md, sections 5 and 8; DEC-08).

- ``UpgradeRoad(group, edge)`` (SIM-04 validates it, 1 CP) puts a group standing at an end of an
  internal edge of its owner into «Строительство» on that edge: ``start_build()``.
- The ``build`` system raises the width of the edge by one every ``build.ticks_per_level`` ticks
  of building, up to ``max_width`` of the edge. Buffer edges are never upgraded.
- Leaving (a move order), a mode change, a merge and a fight (combat, SIM-09, calls
  ``interrupt_build()``) stop the build; the progress of the current level is lost.
- Capacities are recomputed from the new width (``systems.capacity.node_capacities`` compares
  the widths it was computed from); packet speed is read from the width when a packet is sent
  (supply, SIM-08).
- ``upgrade_gain()``: what the next level gives, for the road hint in the client
  (mechanics.md, section 18; the ``upgrade_gain`` of an own edge in the view, SIM-14).

Details not fixed by the rules follow the defaults of #124:

- the build started at tick ``t`` raises the width at ``t + ticks_per_level`` (``Group.build_since``
  is the tick the current level started, like ``Order.depart_tick``), then every
  ``ticks_per_level`` ticks;
- every group has its own progress: builders of one edge neither help nor hinder each other;
- a finished road (``max_width``) ends the build, the group stays in «Строительство»;
- the build also stops when the edge is no longer internal or the group no longer stands at an
  end of it; the group keeps its mode;
- the size and the charges of the group do not matter.
"""

from dataclasses import dataclass

from gow_sim.ruleset import Ruleset
from gow_sim.state import AtNode, Event, GameState, Group, Mode, event
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


def start_build(group: Group, edge: int, tick: int) -> None:
    """Apply a validated ``UpgradeRoad``: the group builds ``edge`` from ``tick`` on."""
    group.mode = Mode.BUILD
    group.build_edge = edge
    group.build_since = tick


def interrupt_build(group: Group) -> None:
    """Stop the build of ``group``; the progress of the current level is lost.

    Moves, mode changes and merges call this (SIM-04); combat (SIM-09, TODO(#25)) calls it for
    every group in a fight. The mode is not changed here.
    """
    group.build_edge = None
    group.build_since = None


def _can_build(state: GameState, group: Group, edge: int) -> bool:
    """The group stands at an end of ``edge``, the edge is internal and the group's owner's."""
    e = state.map.edges[edge]
    return (
        group.mode is Mode.BUILD
        and isinstance(group.location, AtNode)
        and group.location.node in (e.a, e.b)
        and is_internal(state, edge)
        and state.nodes[e.a].owner == group.owner
    )


def build(state: GameState, rules: Ruleset) -> list[Event]:
    """Raise the widths of the roads under construction (see the module docstring).

    Groups are walked in id order; only one player can build an edge (it is internal), so the
    order never decides between players. A second pass ends the builds of finished roads, so two
    builders of one edge stop on the same tick whatever their ids.
    """
    tick = state.tick
    per_level = rules.build.ticks_per_level
    events: list[Event] = []
    for gid in sorted(state.groups):
        group = state.groups[gid]
        eid = group.build_edge
        if eid is None:
            continue
        if not _can_build(state, group, eid):
            interrupt_build(group)
            events.append(_stopped(tick, group, eid, "interrupted"))
            continue
        # TODO(#124): the level timing and independent builders of one edge are defaults.
        edge = state.edges[eid]
        since = group.build_since
        due = since is not None and tick - since >= per_level
        if due and edge.width < state.map.edges[eid].max_width:
            edge.width += 1
            group.build_since = tick
            events.append(
                event(
                    tick, "road_upgraded", player=group.owner, group=gid, edge=eid, width=edge.width
                )
            )
    for gid in sorted(state.groups):
        group = state.groups[gid]
        eid = group.build_edge
        if eid is not None and state.edges[eid].width >= state.map.edges[eid].max_width:
            interrupt_build(group)  # TODO(#124): the group stays in «Строительство»
            events.append(_stopped(tick, group, eid, "max_width"))
    return events


def _stopped(tick: int, group: Group, edge: int, reason: str) -> Event:
    return event(
        tick, "build_stopped", player=group.owner, group=group.id, edge=edge, reason=reason
    )
