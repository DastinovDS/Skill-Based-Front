"""Builds (DEC-26, #265; DEC-41, items 2 and 7; DEC-43, item D): the barracks of a city, a factory
and a road fortification.

- ``BuildBarracks(node)`` (SIM-04 validates it) takes the build slot of the city (``Node.build``,
  one at a time, DEC-26, item 8); its CP (``orders.cost.barracks``) are charged at the start by
  ``apply_commands``. ``city_upgrades.barracks_ticks`` after the full payment the city gets its
  barracks (``barracks_built``).
- ``BuildFactory(node)`` puts a ``FactoryBuild`` on the city (``start_factory()``); it does not
  take the build slot of the barracks. ``factory.build_ticks`` after the full payment the city is
  a factory (``factory_built``).
- Every building is paid in **charges** (DEC-41, item 7): the barracks
  ``city_upgrades.barracks_charges``, a factory ``factory.cost`` (``charge_cost()``). The payment
  is **progressive** (``pay()``): the build takes the charges of the node's warehouse, then those
  of the owner's groups standing in the node outside a fight (the largest ``charged`` first, ties
  by the lower id, as the starvation of DEC-19, item 4), until the cost is met; what is missing is
  ``owed`` and the ``build`` system takes it on every later tick (event ``build_paid`` whenever
  charges are taken). The build time starts in the tick the build is paid in full (``since``).
- Every tick the ``build`` system checks that a build still holds: while the node is its
  owner's. If not, the build is removed: ``build_stopped`` with ``reason = "interrupted"``, nothing
  is returned. Combat runs before ``build``, so a capture in the completion tick cancels it.
  Nothing else stops a build. There is no cancel.

- ``FortifyRoad(node, edge)`` (DEC-43, item D; ``systems.fortify``): a road fortification works
  ``fort.build_ticks`` after the command, ``road_fort_built`` in that tick; a capture destroys it.

The build events go only to their player (DEC-17, item 6; ``gow_protocol.convert``).
"""

from dataclasses import replace

from gow_sim.ruleset import Ruleset
from gow_sim.state import AtNode, Build, BuildKind, Event, FactoryBuild, GameState, Group, event


def done_tick(rules: Ruleset, b: Build) -> int:
    """The tick the barracks build ends (unless it is interrupted first)."""
    return b.since + rules.city_upgrades.barracks_ticks


def start_barracks(state: GameState, rules: Ruleset, player: int, node: int) -> list[Event]:
    """Apply a validated ``BuildBarracks`` (the CP are charged by SIM-04, the charges by
    ``pay()``)."""
    kind = BuildKind.BARRACKS.value
    events = [event(state.tick, "build_started", player=player, node=node, kind=kind)]
    owed = _pay_into(state, player, node, kind, charge_cost(rules, kind), events)
    state.nodes[node].build = Build(owner=player, since=state.tick, owed=owed)
    return events


FACTORY_KIND = "factory"
"""``kind`` of the build events of a factory (DEC-41, item 2)."""


def charge_cost(rules: Ruleset, kind: str) -> int:
    """The charges a building of ``kind`` costs (DEC-41, item 7)."""
    if kind == BuildKind.BARRACKS.value:
        return rules.city_upgrades.barracks_charges
    if kind == FACTORY_KIND:
        return rules.factory.cost
    raise ValueError(f"no charge cost for a build of kind {kind!r}")


def pay(state: GameState, player: int, node: int, owed: int) -> tuple[int, int]:
    """Take up to ``owed`` charges for a build of ``player`` in ``node`` (DEC-41, item 7): the
    node's warehouse first, then the charged units of the player's groups standing there outside
    a fight, one charge at a time from the group with the most ``charged`` (ties: the lower id).
    Returns the charges taken from the warehouse and from the units."""
    # TODO(#651): one charge at a time from the largest, groups in a fight do not pay, the payment
    # retried every tick: the readings of item 7 in mechanics.md (#645).
    n = state.nodes[node]
    from_stock = min(owed, n.warehouse)
    n.warehouse -= from_stock
    left = owed - from_stock
    groups: list[Group] = []
    if left > 0:
        for gid in sorted(state.groups):
            g = state.groups[gid]
            here = isinstance(g.location, AtNode) and g.location.node == node
            if here and g.owner == player and g.fight is None and g.charged > 0:
                groups.append(g)
    from_units = 0
    while left > 0 and groups:
        group = max(groups, key=lambda g: (g.charged, -g.id))
        if group.charged == 0:
            break
        group.charged -= 1
        left -= 1
        from_units += 1
    return from_stock, from_units


def _pay_into(
    state: GameState, player: int, node: int, kind: str, owed: int, events: list[Event]
) -> int:
    """``pay()`` what ``owed`` asks, add ``build_paid`` to ``events`` when charges were taken;
    returns what is still owed."""
    if owed <= 0:
        return 0
    from_stock, from_units = pay(state, player, node, owed)
    owed -= from_stock + from_units
    if from_stock or from_units:
        events.append(
            event(
                state.tick,
                "build_paid",
                player=player,
                node=node,
                kind=kind,
                warehouse=from_stock,
                units=from_units,
                owed=owed,
            )
        )
    return owed


def start_factory(state: GameState, rules: Ruleset, player: int, node: int) -> list[Event]:
    """Apply a validated ``BuildFactory(node)``: start the build, pay what can be paid now."""
    events = [event(state.tick, "build_started", player=player, node=node, kind=FACTORY_KIND)]
    owed = _pay_into(state, player, node, FACTORY_KIND, charge_cost(rules, FACTORY_KIND), events)
    state.nodes[node].factory_build = FactoryBuild(owner=player, since=state.tick, owed=owed)
    return events


def _stopped(tick: int, player: int, node: int, kind: str) -> Event:
    return event(tick, "build_stopped", player=player, node=node, kind=kind, reason="interrupted")


def _factory_builds(state: GameState, rules: Ruleset) -> list[Event]:
    """Pay, finish or stop the factory builds (DEC-41, items 2 and 7), nodes in id order."""
    tick = state.tick
    events: list[Event] = []
    ticks = rules.factory.build_ticks
    for nid in sorted(state.nodes):
        node = state.nodes[nid]
        b = node.factory_build
        if b is None:
            continue
        if node.owner != b.owner:
            node.factory_build = None
            events.append(_stopped(tick, b.owner, nid, FACTORY_KIND))
            continue
        if b.owed > 0:
            owed = _pay_into(state, b.owner, nid, FACTORY_KIND, b.owed, events)
            b = node.factory_build = replace(b, owed=owed, since=tick if owed == 0 else b.since)
            if owed > 0:
                continue
        if tick < b.since + ticks:
            continue
        node.factory_build = None
        node.factory = b.owner
        node.factory_ticks = 0  # its own progress starts now (DEC-47)
        events.append(event(tick, "factory_built", player=b.owner, node=nid))
    return events


def build(state: GameState, rules: Ruleset) -> list[Event]:
    """Finish or interrupt the builds (see the module docstring).

    Cities are walked in id order, the barracks before the factories; a build belongs to one
    player and one node, so the order never decides between players or between builds.
    """
    tick = state.tick
    events: list[Event] = []
    for nid in sorted(state.nodes):
        city = state.nodes[nid]
        b = city.build
        if b is None:
            continue
        kind = b.kind.value
        if city.owner != b.owner:
            city.build = None
            events.append(_stopped(tick, b.owner, nid, kind))
            continue
        if b.owed > 0:  # the progressive payment (DEC-41, item 7)
            owed = _pay_into(state, b.owner, nid, kind, b.owed, events)
            b = city.build = replace(b, owed=owed, since=tick if owed == 0 else b.since)
            if owed > 0:
                continue
        if tick < done_tick(rules, b):
            continue
        city.build = None
        city.has_barracks = True
        events.append(event(tick, "barracks_built", player=b.owner, node=nid))
    events.extend(_factory_builds(state, rules))
    events.extend(_road_forts_built(state))
    return events


def _road_forts_built(state: GameState) -> list[Event]:
    """``road_fort_built`` for every road fortification that works from this tick on (DEC-43,
    item D4), nodes and then edges in id order. A capture before it destroyed it already
    (``change_owner``), so nothing else stops it."""
    tick = state.tick
    events: list[Event] = []
    for nid in sorted(state.nodes):
        node = state.nodes[nid]
        for eid in sorted(node.road_forts):
            if node.road_forts[eid] == tick and node.owner is not None:
                events.append(event(tick, "road_fort_built", player=node.owner, node=nid, edge=eid))
    return events
