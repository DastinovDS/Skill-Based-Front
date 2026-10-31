"""Builds (DEC-16, #203; DEC-22, #234; DEC-26, #265; DEC-28, #290): a road level on an edge, the
barracks or a warehouse level of a city.

- ``UpgradeRoad(edge)`` (SIM-04 validates it) raises the own internal ``edge`` by one level for
  ``orders.cost.build`` CP (DEC-28, item 7), charged at the start by ``apply_commands``; no city
  pays or builds it. Levels are ``1..max_level`` (at most 3). ``start_road()`` puts the build on
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

- Under the economy v2 (DEC-41, items 2, 7, 12): every building is paid in **charges**, not CP:
  the barracks ``city_upgrades.barracks_charges``, a warehouse level
  ``city_upgrades.warehouse_charges``, a factory ``factory.cost``, a bunker ``bunker.cost``
  (``charge_cost()``). The payment is **progressive** (``pay()``): the build takes the charges of
  the node's warehouse, then those of the owner's groups standing in the node outside a fight
  (the largest ``charged`` first, ties by the lower id, as the starvation of DEC-19, item 4),
  until the cost is met; what is missing is ``owed`` and the ``build`` system takes it on every
  later tick (event ``build_paid`` whenever charges are taken). The build time starts in the tick
  the build is paid in full (``since``); a build that is stopped returns nothing.
- ``BuildFactory(node)`` puts a ``FactoryBuild`` on the city (``start_factory()``); it does not
  take the build slot of the barracks and the warehouse. ``factory.build_ticks`` after the full
  payment the city is a factory (``factory_built``).
- ``BuildBunker(node)`` (code name ``fort``) puts a ``FactoryBuild`` into ``Node.fort_build`` of
  an own city or province (``start_fort()``), its own slot as well; ``bunker.build_ticks`` after
  the full payment the node has a bunker (``fort_built``). A capture destroys the bunker
  (``systems.capacity.change_owner``); in a fight at the node it gives the defender
  ``bunker.shots`` virtual shots if the defender has a charged unit (``systems.combat``).
- A change of the node's owner stops a factory or bunker build (``build_stopped``, ``kind =
  "factory"`` or ``"fort"``), nothing is returned.

The build events go only to their player (DEC-17, item 6; ``gow_protocol.convert``).
"""

from dataclasses import dataclass, replace

from gow_sim.ruleset import Ruleset
from gow_sim.state import AtNode, Build, BuildKind, Event, FactoryBuild, GameState, Group, event
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
    """Gain of raising ``edge`` by one level; ``None`` when it already has ``max_level``."""
    level = state.edges[edge].width
    if level >= state.map.edges[edge].max_level:
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


def start_city_build(
    state: GameState, rules: Ruleset, player: int, node: int, kind: BuildKind
) -> list[Event]:
    """Apply a validated ``BuildBarracks`` or ``UpgradeWarehouse`` (the CP are charged by SIM-04;
    under the economy v2 the charges are paid by ``pay()``).

    ``level``: the warehouse level the build gives, ``None`` for the barracks.
    """
    city = state.nodes[node]
    level = city.warehouse_level + 1 if kind is BuildKind.WAREHOUSE else None
    events = [
        event(state.tick, "build_started", player=player, node=node, kind=kind.value, level=level)
    ]
    owed = charge_cost(rules, kind.value) if rules.v2 else 0
    owed = _pay_into(state, player, node, kind.value, owed, events)
    city.build = Build(edge=None, owner=player, since=state.tick, kind=kind, owed=owed)
    return events


FACTORY_KIND = "factory"
"""``kind`` of the build events of a factory (DEC-41, item 2)."""
FORT_KIND = "fort"
"""``kind`` of the build events of a bunker (DEC-41, item 12; code name ``fort``)."""


def charge_cost(rules: Ruleset, kind: str) -> int:
    """The charges a building of ``kind`` costs under the economy v2 (DEC-41, item 7)."""
    if kind == BuildKind.BARRACKS.value:
        return rules.city_upgrades.barracks_charges
    if kind == BuildKind.WAREHOUSE.value:
        return rules.city_upgrades.warehouse_charges
    if kind == FACTORY_KIND:
        return rules.factory_rules().cost
    if kind == FORT_KIND:
        return rules.bunker_rules().cost
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
    n.inbox = min(n.inbox, n.warehouse)  # a relay gives out only what is still there (L5)
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
    events = [
        event(state.tick, "build_started", player=player, node=node, kind=FACTORY_KIND, level=None)
    ]
    owed = _pay_into(state, player, node, FACTORY_KIND, charge_cost(rules, FACTORY_KIND), events)
    state.nodes[node].factory_build = FactoryBuild(owner=player, since=state.tick, owed=owed)
    return events


def start_fort(state: GameState, rules: Ruleset, player: int, node: int) -> list[Event]:
    """Apply a validated ``BuildBunker(node)``: start the build, pay what can be paid now."""
    events = [
        event(state.tick, "build_started", player=player, node=node, kind=FORT_KIND, level=None)
    ]
    owed = _pay_into(state, player, node, FORT_KIND, charge_cost(rules, FORT_KIND), events)
    state.nodes[node].fort_build = FactoryBuild(owner=player, since=state.tick, owed=owed)
    return events


def _site_build(
    state: GameState, nid: int, b: FactoryBuild, kind: str, ticks: int, events: list[Event]
) -> tuple[FactoryBuild | None, bool]:
    """One tick of a factory or bunker build in ``nid``: stopped by an owner change, paid, done.
    Returns the build that stays (``None`` when it is stopped or done) and whether it is done."""
    tick = state.tick
    if state.nodes[nid].owner != b.owner:
        events.append(
            event(
                tick,
                "build_stopped",
                player=b.owner,
                node=nid,
                kind=kind,
                edge=None,
                reason="interrupted",
            )
        )
        return None, False
    if b.owed > 0:
        owed = _pay_into(state, b.owner, nid, kind, b.owed, events)
        b = replace(b, owed=owed, since=tick if owed == 0 else b.since)
        if owed > 0:
            return b, False
    if tick < b.since + ticks:
        return b, False
    if kind == FACTORY_KIND:
        events.append(event(tick, "factory_built", player=b.owner, node=nid))
    else:
        events.append(event(tick, "fort_built", player=b.owner, node=nid))
    return None, True


def _site_builds(state: GameState, rules: Ruleset) -> list[Event]:
    """Pay, finish or stop the factory and bunker builds (DEC-41, items 2, 7, 12), nodes in id
    order, the factory before the bunker of one node."""
    events: list[Event] = []
    factory_ticks = rules.factory_rules().build_ticks
    fort_ticks = rules.bunker_rules().build_ticks
    for nid in sorted(state.nodes):
        node = state.nodes[nid]
        b = node.factory_build
        if b is not None:
            node.factory_build, done = _site_build(
                state, nid, b, FACTORY_KIND, factory_ticks, events
            )
            if done:
                node.factory = b.owner
        b = node.fort_build
        if b is not None:
            node.fort_build, done = _site_build(state, nid, b, FORT_KIND, fort_ticks, events)
            if done:
                node.fort = True
    return events


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
        road.width += 1  # validated below max_level; nothing else changes levels
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
        if b.owed > 0:  # the economy v2: the progressive payment (DEC-41, item 7)
            owed = _pay_into(state, b.owner, nid, b.kind.value, b.owed, events)
            b = city.build = replace(b, owed=owed, since=tick if owed == 0 else b.since)
            if owed > 0:
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
    if rules.v2:
        events.extend(_site_builds(state, rules))
    return events
