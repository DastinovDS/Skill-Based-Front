"""Game state (SIM-02): GameState and its entities, canonical form and state hash.

Rules for this module (AGENTS.md, section 4):

- entities are ``@dataclass(slots=True)``; value objects are frozen;
- collections are ``dict[int, T]`` keyed by id, and every walk over them is ``sorted()``;
- a group stores the counters ``units`` and ``charged``, not a list of units;
- only integers: CP in hundredths, edge progress in thousandths (``PROGRESS_SCALE``).

``to_canonical()`` turns the state into plain JSON data with every collection as a list sorted by
id, so the canonical JSON and ``state_hash()`` do not depend on dict insertion order or
``PYTHONHASHSEED``. The static map is embedded in the file format (``map_to_data``), so the
canonical form alone restores the state: ``from_canonical(to_canonical(s)) == s``.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Final, Protocol, cast

from gow_sim.canonical import digest
from gow_sim.maps import PLAYERS, MapDef, map_to_data, parse_map
from gow_sim.ruleset import Ruleset, Stance

PROGRESS_SCALE: Final = 1000
"""Edge progress is stored in thousandths of the edge (DEC-07, rule 6)."""


class Mode(StrEnum):
    """Group mode (mechanics.md, section 3; effects: DEC-08). Roads are built by cities (DEC-16)."""

    ATTACK = "attack"
    DEFENSE = "defense"


class IntentKind(StrEnum):
    """Publicly visible intent types (DEC-04, DEC-08)."""

    PLANNED_MOVE = "planned_move"
    DEFENSE = "defense"


class RoadKind(StrEnum):
    """Type of a road (DEC-22, item 2): chosen by the first upgrade, never changes after."""

    NONE = "none"
    """A level 1 road: no type yet."""
    FAST = "fast"
    """Faster packets (``supply.fast_speed_pct``)."""
    FREIGHT = "freight"
    """More charges per dispatch period (``supply.freight_amount``); its packets arrive even when
    the edge stops being internal (DEC-22, item 5)."""


class Priority(StrEnum):
    """Supply priority of a city (DEC-18, item 1): only the order of delivery, not the target."""

    HIGH = "high"
    NORMAL = "normal"
    LOW = "low"

    @property
    def rank(self) -> int:
        """``high`` 0, ``normal`` 1, ``low`` 2: a lower rank is served first (DEC-18, item 4)."""
        return _PRIORITY_RANK[self]


_PRIORITY_RANK: Final = {Priority.HIGH: 0, Priority.NORMAL: 1, Priority.LOW: 2}


class Detail(StrEnum):
    """How much a player sees of a node or an edge (DEC-04, mechanics.md, section 10)."""

    EXACT = "exact"
    """Everything, with numbers: own nodes and nodes where own groups stand."""
    PRESENCE = "presence"
    """Whether enemy groups are there and their modes, without numbers."""
    FOG = "fog"
    """Nothing beyond the public data; the player has only the last sighting."""


@dataclass(frozen=True, slots=True)
class AtNode:
    """The group stands in a node. Groups stand only in nodes."""

    node: int


@dataclass(frozen=True, slots=True)
class OnEdge:
    """The group moves along ``edge`` away from ``from_node``.

    ``progress`` is in thousandths of the edge, ``0..PROGRESS_SCALE``.
    ``back``: the group bounces (DEC-07, rules 4 and 6) and goes back to ``from_node``; its
    ``progress`` falls by the steps it grew, so the way back takes as long as the way there.
    """

    edge: int
    from_node: int
    progress: int
    back: bool = False


type Location = AtNode | OnEdge


@dataclass(frozen=True, slots=True)
class Order:
    """A movement order of a group (``Move``, SIM-04; carried out by the movement system, SIM-05).

    ``path``: the nodes still to reach, the next one first; the last one is the destination.
    ``planned``: a planned order (DEC-08). The group leaves its node not before ``depart_tick``:
    the tick the order was applied, plus ``orders.planned_delay_ticks`` for a planned order.
    """

    path: tuple[int, ...]
    planned: bool
    depart_tick: int


@dataclass(slots=True)
class Group:
    """Units of one player in one place: counters, not a list of units (``charged <= units``)."""

    id: int
    owner: int
    units: int
    charged: int
    mode: Mode
    location: Location
    order: Order | None = None
    """Current movement order; ``None`` when the group has none."""
    intent: int | None = None
    """Id of the group's public ``Intent`` (SIM-10): planned order or «Защита». The link
    lives only here, the intent itself names no group (DEC-04)."""
    bonus: int = 0
    """Virtual shots the group brings into its next fight (DEC-08, SIM-10); 0: none. From a
    planned order, or from «Защита» when the group is in that mode."""
    bonus_tick: int = 0
    """The tick from which ``bonus`` is active: departure of the planned order, or the switch to
    «Защита» plus ``orders.defense_delay_ticks``."""


@dataclass(slots=True)
class PlayerState:
    id: int
    cp: int
    """Command points in hundredths (100 = 1 CP)."""
    stance: Stance
    charge_acc: int
    """Stance share of the CP quantum waiting to become whole charges, in hundredths (DEC-02)."""
    vp: int
    stance_changed_tick: int | None
    """Tick of the last stance change; ``None``: never changed, so the first change is free of the
    cooldown (#104 default)."""
    forfeited: bool = False
    """The player gave up: a ``Forfeit`` command, also for a technical defeat (DEC-05)."""


@dataclass(frozen=True, slots=True)
class Build:
    """A road level under construction by a city (``UpgradeRoad(node, edge, kind)``, DEC-16).

    ``owner``: the player who started it; the build holds while ``edge`` is internal for them.
    ``since``: the tick the command was applied; the level grows at
    ``since + build.ticks_per_level``. ``kind``: the road type after this level (DEC-22): the
    chosen one for the first upgrade, the road's own one for the second.
    """

    edge: int
    owner: int
    since: int
    kind: RoadKind


@dataclass(slots=True)
class Node:
    """Dynamic part of a node; the static part is ``GameState.map.nodes[id]``."""

    id: int
    owner: int | None
    warehouse: int
    """Charges in the city warehouse."""
    over_ticks: int
    """Consecutive ticks the owner's standing units exceed the capacity (attrition, SIM-07)."""
    captured_tick: int | None
    """Tick of the last owner change; ``None`` for the starting owner (attrition grace)."""
    recruited_tick: int | None = None
    """Tick of the last recruit in this city (DEC-01 cooldown, SIM-12); ``None``: never."""
    build: Build | None = None
    """The road this city upgrades (DEC-16); ``None``: no build."""
    priority: Priority = Priority.NORMAL
    """Supply priority of the city (DEC-18, item 1); back to ``NORMAL`` on every owner change."""


@dataclass(slots=True)
class Edge:
    """Dynamic part of an edge; the static part is ``GameState.map.edges[id]``.

    ``width``: the road level ``1..max_width`` (DEC-22; the name follows the map field until
    DEC-23 renames it). ``kind``: ``NONE`` on level 1, then the type the first upgrade chose.
    """

    id: int
    width: int
    kind: RoadKind = RoadKind.NONE


@dataclass(slots=True)
class Packet:
    """Charges on the way along a path of internal edges (mechanics.md, section 7; DEC-18, item 5).

    ``edge`` is the current edge of the path, travelled away from ``from_node`` during
    ``depart_tick .. arrive_tick``. ``route``: the edges of the path still to go after ``edge``,
    the next one first; ``route_ticks``: their times, fixed at dispatch. ``transfer``: a one-off
    ``Transfer`` (DEC-18, item 6), not the automatic dispatch.
    """

    id: int
    owner: int
    edge: int
    from_node: int
    charges: int
    depart_tick: int
    arrive_tick: int
    route: tuple[int, ...] = ()
    route_ticks: tuple[int, ...] = ()
    transfer: bool = False


@dataclass(slots=True)
class Intent:
    """The public part of a planned order or a mode switch: no group id and no group size.

    ``target`` is ``None`` for an intent without a destination (``DEFENSE``).
    """

    id: int
    owner: int
    kind: IntentKind
    origin: int
    target: int | None
    created_tick: int


@dataclass(frozen=True, slots=True)
class Sighting:
    """What a player last saw of a node or an edge (DEC-04: fog with «last seen» memory).

    ``enemy_modes``: distinct modes of the enemy groups seen, sorted; empty means none seen.
    ``enemy_units`` and ``enemy_charged`` are totals, known only when ``level`` is ``EXACT``.
    ``width`` and ``road``: the road level and type seen (DEC-17, DEC-22), for an edge; ``None``
    for a node.
    """

    tick: int
    level: Detail
    enemy_modes: tuple[Mode, ...]
    enemy_units: int | None
    enemy_charged: int | None
    width: int | None = None
    road: RoadKind | None = None


@dataclass(slots=True)
class VisionMemory:
    """Last sightings of one player, by node id and by edge id."""

    nodes: dict[int, Sighting] = field(default_factory=dict[int, Sighting])
    edges: dict[int, Sighting] = field(default_factory=dict[int, Sighting])


type EventValue = int | str | bool | None


@dataclass(frozen=True, slots=True)
class Event:
    """Something that happened in a tick. ``data`` is sorted by key; build it with ``event()``."""

    tick: int
    kind: str
    data: tuple[tuple[str, EventValue], ...]

    def get(self, key: str) -> EventValue:
        for name, value in self.data:
            if name == key:
                return value
        raise KeyError(key)


def event(tick: int, kind: str, **data: EventValue) -> Event:
    return Event(tick=tick, kind=kind, data=tuple(sorted(data.items())))


@dataclass(slots=True)
class GameState:
    map: MapDef
    tick: int
    players: dict[int, PlayerState]
    nodes: dict[int, Node]
    edges: dict[int, Edge]
    groups: dict[int, Group]
    packets: dict[int, Packet]
    intents: dict[int, Intent]
    vision_memory: dict[int, VisionMemory]
    """Fog memory per player id; updated by the vision system at the end of a tick."""
    next_id: int
    """Next id for a group, packet or intent (one counter for all three)."""
    events: list[Event]
    """Events of the current tick."""

    def new_id(self) -> int:
        new = self.next_id
        self.next_id += 1
        return new


def initial_state(mapdef: MapDef, rules: Ruleset) -> GameState:
    """State at tick 0: territory, garrisons and warehouses from the map, CP from the ruleset.

    Each starting garrison becomes one group in mode ``ATTACK`` (the normal state, DEC-08).
    Groups get ids player by player, each player's in ``node_key(player, node)`` order, so the
    id order of a player's groups is the mirror of the other player's: tie-breaks by group id
    inside a player (DEC-07, rule 7) stay mirror-symmetric. The stance is
    ``economy.start_stance`` (open question #104).
    """
    state = GameState(
        map=mapdef,
        tick=0,
        players={
            p: PlayerState(
                id=p,
                cp=rules.cp.start,
                stance=rules.economy.start_stance,
                charge_acc=0,
                vp=0,
                stance_changed_tick=None,
            )
            for p in PLAYERS
        },
        nodes={
            n.id: Node(
                id=n.id,
                owner=n.start_owner,
                warehouse=n.start_stock,
                over_ticks=0,
                captured_tick=None,
            )
            for n in mapdef.nodes
        },
        edges={e.id: Edge(id=e.id, width=e.base_width) for e in mapdef.edges},
        groups={},
        packets={},
        intents={},
        vision_memory={p: VisionMemory() for p in PLAYERS},
        next_id=0,
        events=[],
    )
    garrisons = sorted(
        (node.start_owner, mapdef.node_key(node.start_owner, node.id), node.id)
        for node in mapdef.nodes
        if node.start_units > 0 and node.start_owner is not None
    )
    for _, _, node_id in garrisons:
        node = mapdef.nodes[node_id]
        if node.start_owner is not None:
            gid = state.new_id()
            state.groups[gid] = Group(
                id=gid,
                owner=node.start_owner,
                units=node.start_units,
                charged=node.start_charged,
                mode=Mode.ATTACK,
                location=AtNode(node.id),
            )
    return state


# Canonical form ------------------------------------------------------------------------------


class StateFormatError(ValueError):
    """Canonical state data is malformed."""


def state_hash(state: GameState) -> str:
    """blake2b of the canonical JSON of the state (AGENTS.md, section 4.5)."""
    return digest(to_canonical(state))


def to_canonical(state: GameState) -> dict[str, object]:
    """The state as plain JSON data; every collection is a list sorted by id."""
    return {
        "map": map_to_data(state.map),
        "tick": state.tick,
        "next_id": state.next_id,
        "players": [_player_data(state.players[p]) for p in sorted(state.players)],
        "nodes": [_node_data(state.nodes[n]) for n in sorted(state.nodes)],
        "edges": [
            {"id": e.id, "width": e.width, "kind": e.kind.value} for e in _by_id(state.edges)
        ],
        "groups": [_group_data(g) for g in _by_id(state.groups)],
        "packets": [_packet_data(p) for p in _by_id(state.packets)],
        "intents": [_intent_data(i) for i in _by_id(state.intents)],
        "vision_memory": [
            {
                "player": p,
                "nodes": _sightings_data(state.vision_memory[p].nodes),
                "edges": _sightings_data(state.vision_memory[p].edges),
            }
            for p in sorted(state.vision_memory)
        ],
        "events": [{"tick": e.tick, "kind": e.kind, "data": dict(e.data)} for e in state.events],
    }


def _by_id[T](items: dict[int, T]) -> list[T]:
    return [items[key] for key in sorted(items)]


def _player_data(p: PlayerState) -> dict[str, object]:
    return {
        "id": p.id,
        "cp": p.cp,
        "stance": p.stance.value,
        "charge_acc": p.charge_acc,
        "vp": p.vp,
        "stance_changed_tick": p.stance_changed_tick,
        "forfeited": p.forfeited,
    }


def _node_data(n: Node) -> dict[str, object]:
    return {
        "id": n.id,
        "owner": n.owner,
        "warehouse": n.warehouse,
        "over_ticks": n.over_ticks,
        "captured_tick": n.captured_tick,
        "recruited_tick": n.recruited_tick,
        "priority": n.priority.value,
        "build": None
        if n.build is None
        else {
            "edge": n.build.edge,
            "owner": n.build.owner,
            "since": n.build.since,
            "kind": n.build.kind.value,
        },
    }


def _location_data(loc: Location) -> dict[str, object]:
    match loc:
        case AtNode(node=node):
            return {"kind": "node", "node": node}
        case OnEdge(edge=edge, from_node=from_node, progress=progress, back=back):
            return {
                "kind": "edge",
                "edge": edge,
                "from_node": from_node,
                "progress": progress,
                "back": back,
            }


def _group_data(g: Group) -> dict[str, object]:
    return {
        "id": g.id,
        "owner": g.owner,
        "units": g.units,
        "charged": g.charged,
        "mode": g.mode.value,
        "location": _location_data(g.location),
        "order": None if g.order is None else _order_data(g.order),
        "intent": g.intent,
        "bonus": g.bonus,
        "bonus_tick": g.bonus_tick,
    }


def _order_data(o: Order) -> dict[str, object]:
    return {"path": list(o.path), "planned": o.planned, "depart_tick": o.depart_tick}


def _packet_data(p: Packet) -> dict[str, object]:
    return {
        "id": p.id,
        "owner": p.owner,
        "edge": p.edge,
        "from_node": p.from_node,
        "charges": p.charges,
        "depart_tick": p.depart_tick,
        "arrive_tick": p.arrive_tick,
        "route": list(p.route),
        "route_ticks": list(p.route_ticks),
        "transfer": p.transfer,
    }


def _intent_data(i: Intent) -> dict[str, object]:
    return {
        "id": i.id,
        "owner": i.owner,
        "kind": i.kind.value,
        "origin": i.origin,
        "target": i.target,
        "created_tick": i.created_tick,
    }


def _sightings_data(sightings: dict[int, Sighting]) -> list[dict[str, object]]:
    return [_sighting_data(key, sightings[key]) for key in sorted(sightings)]


def _sighting_data(key: int, s: Sighting) -> dict[str, object]:
    return {
        "id": key,
        "tick": s.tick,
        "level": s.level.value,
        "enemy_modes": [m.value for m in s.enemy_modes],
        "enemy_units": s.enemy_units,
        "enemy_charged": s.enemy_charged,
        "width": s.width,
        "road": None if s.road is None else s.road.value,
    }


def from_canonical(data: object) -> GameState:
    """Rebuild a state from ``to_canonical()`` output. Raises StateFormatError on bad data."""
    root = _obj(
        data,
        "state",
        (
            "map",
            "tick",
            "next_id",
            "players",
            "nodes",
            "edges",
            "groups",
            "packets",
            "intents",
            "vision_memory",
            "events",
        ),
    )
    try:
        mapdef = parse_map(root["map"])
    except ValueError as exc:
        raise StateFormatError(f"state.map: {exc}") from exc
    return GameState(
        map=mapdef,
        tick=_int(root["tick"], "state.tick", low=0),
        players=_collection(root["players"], "players", _parse_player),
        nodes=_collection(root["nodes"], "nodes", _parse_node),
        edges=_collection(root["edges"], "edges", _parse_edge),
        groups=_collection(root["groups"], "groups", _parse_group),
        packets=_collection(root["packets"], "packets", _parse_packet),
        intents=_collection(root["intents"], "intents", _parse_intent),
        vision_memory=_parse_vision_memory(root["vision_memory"]),
        next_id=_int(root["next_id"], "state.next_id", low=0),
        events=[
            _parse_event(raw, f"events[{i}]")
            for i, raw in enumerate(_list(root["events"], "events"))
        ],
    )


class _HasId(Protocol):
    @property
    def id(self) -> int: ...


def _collection[T: _HasId](
    data: object, where: str, parse: Callable[[object, str], T]
) -> dict[int, T]:
    result: dict[int, T] = {}
    for i, raw in enumerate(_list(data, where)):
        item = parse(raw, f"{where}[{i}]")
        if item.id in result:
            raise StateFormatError(f"{where}[{i}].id: duplicate id {item.id}")
        result[item.id] = item
    return result


def _parse_player(data: object, where: str) -> PlayerState:
    raw = _obj(
        data,
        where,
        ("id", "cp", "stance", "charge_acc", "vp", "stance_changed_tick", "forfeited"),
    )
    return PlayerState(
        id=_int(raw["id"], f"{where}.id", low=0),
        cp=_int(raw["cp"], f"{where}.cp", low=0),
        stance=Stance(_choice(raw["stance"], f"{where}.stance", Stance)),
        charge_acc=_int(raw["charge_acc"], f"{where}.charge_acc", low=0),
        vp=_int(raw["vp"], f"{where}.vp", low=0),
        stance_changed_tick=_opt_int(raw["stance_changed_tick"], f"{where}.stance_changed_tick"),
        forfeited=_bool(raw["forfeited"], f"{where}.forfeited"),
    )


def _parse_node(data: object, where: str) -> Node:
    raw = _obj(
        data,
        where,
        (
            "id",
            "owner",
            "warehouse",
            "over_ticks",
            "captured_tick",
            "recruited_tick",
            "priority",
            "build",
        ),
    )
    return Node(
        id=_int(raw["id"], f"{where}.id", low=0),
        owner=_opt_int(raw["owner"], f"{where}.owner"),
        warehouse=_int(raw["warehouse"], f"{where}.warehouse", low=0),
        over_ticks=_int(raw["over_ticks"], f"{where}.over_ticks", low=0),
        captured_tick=_opt_int(raw["captured_tick"], f"{where}.captured_tick"),
        recruited_tick=_opt_int(raw["recruited_tick"], f"{where}.recruited_tick"),
        build=None if raw["build"] is None else _parse_build(raw["build"], f"{where}.build"),
        priority=Priority(_choice(raw["priority"], f"{where}.priority", Priority)),
    )


def _parse_build(data: object, where: str) -> Build:
    raw = _obj(data, where, ("edge", "owner", "since", "kind"))
    return Build(
        edge=_int(raw["edge"], f"{where}.edge", low=0),
        owner=_int(raw["owner"], f"{where}.owner", low=0),
        since=_int(raw["since"], f"{where}.since", low=0),
        kind=RoadKind(_choice(raw["kind"], f"{where}.kind", RoadKind)),
    )


def _parse_edge(data: object, where: str) -> Edge:
    raw = _obj(data, where, ("id", "width", "kind"))
    return Edge(
        id=_int(raw["id"], f"{where}.id", low=0),
        width=_int(raw["width"], f"{where}.width", low=1),
        kind=RoadKind(_choice(raw["kind"], f"{where}.kind", RoadKind)),
    )


def _kind(data: object) -> object:
    return cast(dict[str, object], data).get("kind") if isinstance(data, dict) else None


def _parse_location(data: object, where: str) -> Location:
    kind = _kind(data)
    if kind == "node":
        raw = _obj(data, where, ("kind", "node"))
        return AtNode(node=_int(raw["node"], f"{where}.node", low=0))
    if kind == "edge":
        raw = _obj(data, where, ("kind", "edge", "from_node", "progress", "back"))
        return OnEdge(
            edge=_int(raw["edge"], f"{where}.edge", low=0),
            from_node=_int(raw["from_node"], f"{where}.from_node", low=0),
            progress=_int(raw["progress"], f"{where}.progress", low=0, high=PROGRESS_SCALE),
            back=_bool(raw["back"], f"{where}.back"),
        )
    raise StateFormatError(f"{where}.kind: expected 'node' or 'edge', got {kind!r}")


def _parse_group(data: object, where: str) -> Group:
    raw = _obj(
        data,
        where,
        (
            "id",
            "owner",
            "units",
            "charged",
            "mode",
            "location",
            "order",
            "intent",
            "bonus",
            "bonus_tick",
        ),
    )
    units = _int(raw["units"], f"{where}.units", low=0)
    return Group(
        id=_int(raw["id"], f"{where}.id", low=0),
        owner=_int(raw["owner"], f"{where}.owner", low=0),
        units=units,
        charged=_int(raw["charged"], f"{where}.charged", low=0, high=units),
        mode=Mode(_choice(raw["mode"], f"{where}.mode", Mode)),
        location=_parse_location(raw["location"], f"{where}.location"),
        order=None if raw["order"] is None else _parse_order(raw["order"], f"{where}.order"),
        intent=_opt_int(raw["intent"], f"{where}.intent"),
        bonus=_int(raw["bonus"], f"{where}.bonus", low=0),
        bonus_tick=_int(raw["bonus_tick"], f"{where}.bonus_tick", low=0),
    )


def _parse_order(data: object, where: str) -> Order:
    raw = _obj(data, where, ("path", "planned", "depart_tick"))
    path = _list(raw["path"], f"{where}.path")
    return Order(
        path=tuple(_int(n, f"{where}.path[{i}]", low=0) for i, n in enumerate(path)),
        planned=_bool(raw["planned"], f"{where}.planned"),
        depart_tick=_int(raw["depart_tick"], f"{where}.depart_tick", low=0),
    )


def _parse_packet(data: object, where: str) -> Packet:
    raw = _obj(
        data,
        where,
        (
            "id",
            "owner",
            "edge",
            "from_node",
            "charges",
            "depart_tick",
            "arrive_tick",
            "route",
            "route_ticks",
            "transfer",
        ),
    )
    route = _list(raw["route"], f"{where}.route")
    route_ticks = _list(raw["route_ticks"], f"{where}.route_ticks")
    if len(route) != len(route_ticks):
        raise StateFormatError(f"{where}.route_ticks: expected one time per edge of the route")
    return Packet(
        id=_int(raw["id"], f"{where}.id", low=0),
        owner=_int(raw["owner"], f"{where}.owner", low=0),
        edge=_int(raw["edge"], f"{where}.edge", low=0),
        from_node=_int(raw["from_node"], f"{where}.from_node", low=0),
        charges=_int(raw["charges"], f"{where}.charges", low=0),
        depart_tick=_int(raw["depart_tick"], f"{where}.depart_tick", low=0),
        arrive_tick=_int(raw["arrive_tick"], f"{where}.arrive_tick", low=0),
        route=tuple(_int(e, f"{where}.route[{i}]", low=0) for i, e in enumerate(route)),
        route_ticks=tuple(
            _int(t, f"{where}.route_ticks[{i}]", low=1) for i, t in enumerate(route_ticks)
        ),
        transfer=_bool(raw["transfer"], f"{where}.transfer"),
    )


def _parse_intent(data: object, where: str) -> Intent:
    raw = _obj(data, where, ("id", "owner", "kind", "origin", "target", "created_tick"))
    return Intent(
        id=_int(raw["id"], f"{where}.id", low=0),
        owner=_int(raw["owner"], f"{where}.owner", low=0),
        kind=IntentKind(_choice(raw["kind"], f"{where}.kind", IntentKind)),
        origin=_int(raw["origin"], f"{where}.origin", low=0),
        target=_opt_int(raw["target"], f"{where}.target"),
        created_tick=_int(raw["created_tick"], f"{where}.created_tick", low=0),
    )


def _parse_sightings(data: object, where: str) -> dict[int, Sighting]:
    result: dict[int, Sighting] = {}
    for i, item in enumerate(_list(data, where)):
        at = f"{where}[{i}]"
        raw = _obj(
            item,
            at,
            (
                "id",
                "tick",
                "level",
                "enemy_modes",
                "enemy_units",
                "enemy_charged",
                "width",
                "road",
            ),
        )
        key = _int(raw["id"], f"{at}.id", low=0)
        if key in result:
            raise StateFormatError(f"{at}.id: duplicate id {key}")
        result[key] = Sighting(
            tick=_int(raw["tick"], f"{at}.tick", low=0),
            level=Detail(_choice(raw["level"], f"{at}.level", Detail)),
            enemy_modes=tuple(
                Mode(_choice(m, f"{at}.enemy_modes[{j}]", Mode))
                for j, m in enumerate(_list(raw["enemy_modes"], f"{at}.enemy_modes"))
            ),
            enemy_units=_opt_int(raw["enemy_units"], f"{at}.enemy_units"),
            enemy_charged=_opt_int(raw["enemy_charged"], f"{at}.enemy_charged"),
            width=_opt_int(raw["width"], f"{at}.width"),
            road=None
            if raw["road"] is None
            else RoadKind(_choice(raw["road"], f"{at}.road", RoadKind)),
        )
    return result


def _parse_vision_memory(data: object) -> dict[int, VisionMemory]:
    result: dict[int, VisionMemory] = {}
    for i, item in enumerate(_list(data, "vision_memory")):
        at = f"vision_memory[{i}]"
        raw = _obj(item, at, ("player", "nodes", "edges"))
        player = _int(raw["player"], f"{at}.player", low=0)
        if player in result:
            raise StateFormatError(f"{at}.player: duplicate player {player}")
        result[player] = VisionMemory(
            nodes=_parse_sightings(raw["nodes"], f"{at}.nodes"),
            edges=_parse_sightings(raw["edges"], f"{at}.edges"),
        )
    return result


def _parse_event(data: object, where: str) -> Event:
    raw = _obj(data, where, ("tick", "kind", "data"))
    kind = raw["kind"]
    if not isinstance(kind, str):
        raise StateFormatError(f"{where}.kind: expected a string, got {kind!r}")
    payload = raw["data"]
    if not isinstance(payload, dict):
        raise StateFormatError(f"{where}.data: expected an object, got {payload!r}")
    items: dict[str, object] = payload  # pyright: ignore[reportUnknownVariableType]
    values: list[tuple[str, EventValue]] = []
    for key in sorted(items):
        value = items[key]
        if isinstance(value, float) or not (value is None or isinstance(value, bool | int | str)):
            raise StateFormatError(f"{where}.data.{key}: unsupported value {value!r}")
        values.append((key, value))
    return Event(tick=_int(raw["tick"], f"{where}.tick", low=0), kind=kind, data=tuple(values))


def _obj(data: object, where: str, keys: tuple[str, ...]) -> dict[str, object]:
    if not isinstance(data, dict):
        raise StateFormatError(f"{where}: expected an object, got {type(data).__name__}")
    raw: dict[str, object] = data  # pyright: ignore[reportUnknownVariableType]
    unknown = sorted(k for k in raw if k not in keys)
    if unknown:
        raise StateFormatError(f"{where}: unknown keys {unknown}")
    missing = [k for k in keys if k not in raw]
    if missing:
        raise StateFormatError(f"{where}: missing keys {missing}")
    return raw


def _list(data: object, where: str) -> list[object]:
    if not isinstance(data, list):
        raise StateFormatError(f"{where}: expected a list, got {type(data).__name__}")
    return cast(list[object], data)


def _int(value: object, where: str, low: int | None = None, high: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise StateFormatError(f"{where}: expected an integer, got {value!r}")
    if (low is not None and value < low) or (high is not None and value > high):
        bounds = f"[{'' if low is None else low}..{'' if high is None else high}]"
        raise StateFormatError(f"{where}: {value} is out of range {bounds}")
    return value


def _bool(value: object, where: str) -> bool:
    if not isinstance(value, bool):
        raise StateFormatError(f"{where}: expected a boolean, got {value!r}")
    return value


def _opt_int(value: object, where: str) -> int | None:
    return None if value is None else _int(value, where, low=0)


def _choice(value: object, where: str, enum: type[StrEnum]) -> str:
    options = [member.value for member in enum]
    if not isinstance(value, str) or value not in options:
        raise StateFormatError(f"{where}: expected one of {options}, got {value!r}")
    return value
