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
    """Group mode (mechanics.md, section 3; effects: DEC-08)."""

    ATTACK = "attack"
    DEFENSE = "defense"
    BUILD = "build"


class IntentKind(StrEnum):
    """Publicly visible intent types (DEC-04, DEC-08)."""

    PLANNED_MOVE = "planned_move"
    DEFENSE = "defense"
    BUILD = "build"


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
    """

    edge: int
    from_node: int
    progress: int


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
    build_edge: int | None = None
    """Edge the group upgrades (``UpgradeRoad``, SIM-11); ``None`` when it builds nothing."""
    build_since: int | None = None
    """Tick the current road level started (SIM-11); set exactly when ``build_edge`` is set."""


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


@dataclass(slots=True)
class Edge:
    """Dynamic part of an edge; the static part is ``GameState.map.edges[id]``."""

    id: int
    width: int


@dataclass(slots=True)
class Packet:
    """Charges on the way along an internal edge from ``from_node`` (mechanics.md, section 7)."""

    id: int
    owner: int
    edge: int
    from_node: int
    charges: int
    depart_tick: int
    arrive_tick: int


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
    """

    tick: int
    level: Detail
    enemy_modes: tuple[Mode, ...]
    enemy_units: int | None
    enemy_charged: int | None


@dataclass(slots=True)
class VisionMemory:
    """Last sightings of one player, by node id and by edge id."""

    nodes: dict[int, Sighting] = field(default_factory=dict[int, Sighting])
    edges: dict[int, Sighting] = field(default_factory=dict[int, Sighting])


type EventValue = int | str | bool | None

type CapacityCache = tuple[
    tuple[int | None, ...], tuple[int, ...], tuple[int, ...], tuple[int, ...]
]
"""``(owners, widths, width gains, capacities)``: see ``GameState.capacity_cache``."""


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
    capacity_cache: CapacityCache | None = field(default=None, compare=False, repr=False)
    """Derived data, not part of the state: node capacities and the owners, widths and gains they
    were computed from (``systems.capacity.node_capacities``). Not serialized or hashed."""

    def new_id(self) -> int:
        new = self.next_id
        self.next_id += 1
        return new


def initial_state(mapdef: MapDef, rules: Ruleset) -> GameState:
    """State at tick 0: territory, garrisons and warehouses from the map, CP from the ruleset.

    Each starting garrison becomes one group in mode ``ATTACK`` (the normal state, DEC-08).
    Groups get ids in node id order. The stance is ``economy.start_stance`` (open question #104).
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
    for node in mapdef.nodes:
        if node.start_units > 0 and node.start_owner is not None:
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
        "edges": [{"id": e.id, "width": e.width} for e in _by_id(state.edges)],
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
    }


def _location_data(loc: Location) -> dict[str, object]:
    match loc:
        case AtNode(node=node):
            return {"kind": "node", "node": node}
        case OnEdge(edge=edge, from_node=from_node, progress=progress):
            return {"kind": "edge", "edge": edge, "from_node": from_node, "progress": progress}


def _group_data(g: Group) -> dict[str, object]:
    return {
        "id": g.id,
        "owner": g.owner,
        "units": g.units,
        "charged": g.charged,
        "mode": g.mode.value,
        "location": _location_data(g.location),
        "order": None if g.order is None else _order_data(g.order),
        "build_edge": g.build_edge,
        "build_since": g.build_since,
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
        ("id", "owner", "warehouse", "over_ticks", "captured_tick", "recruited_tick"),
    )
    return Node(
        id=_int(raw["id"], f"{where}.id", low=0),
        owner=_opt_int(raw["owner"], f"{where}.owner"),
        warehouse=_int(raw["warehouse"], f"{where}.warehouse", low=0),
        over_ticks=_int(raw["over_ticks"], f"{where}.over_ticks", low=0),
        captured_tick=_opt_int(raw["captured_tick"], f"{where}.captured_tick"),
        recruited_tick=_opt_int(raw["recruited_tick"], f"{where}.recruited_tick"),
    )


def _parse_edge(data: object, where: str) -> Edge:
    raw = _obj(data, where, ("id", "width"))
    return Edge(
        id=_int(raw["id"], f"{where}.id", low=0), width=_int(raw["width"], f"{where}.width", low=1)
    )


def _kind(data: object) -> object:
    return cast(dict[str, object], data).get("kind") if isinstance(data, dict) else None


def _parse_location(data: object, where: str) -> Location:
    kind = _kind(data)
    if kind == "node":
        raw = _obj(data, where, ("kind", "node"))
        return AtNode(node=_int(raw["node"], f"{where}.node", low=0))
    if kind == "edge":
        raw = _obj(data, where, ("kind", "edge", "from_node", "progress"))
        return OnEdge(
            edge=_int(raw["edge"], f"{where}.edge", low=0),
            from_node=_int(raw["from_node"], f"{where}.from_node", low=0),
            progress=_int(raw["progress"], f"{where}.progress", low=0, high=PROGRESS_SCALE),
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
            "build_edge",
            "build_since",
        ),
    )
    units = _int(raw["units"], f"{where}.units", low=0)
    build_edge = _opt_int(raw["build_edge"], f"{where}.build_edge")
    build_since = _opt_int(raw["build_since"], f"{where}.build_since")
    if (build_edge is None) != (build_since is None):
        raise StateFormatError(f"{where}: build_edge and build_since are set only together")
    return Group(
        id=_int(raw["id"], f"{where}.id", low=0),
        owner=_int(raw["owner"], f"{where}.owner", low=0),
        units=units,
        charged=_int(raw["charged"], f"{where}.charged", low=0, high=units),
        mode=Mode(_choice(raw["mode"], f"{where}.mode", Mode)),
        location=_parse_location(raw["location"], f"{where}.location"),
        order=None if raw["order"] is None else _parse_order(raw["order"], f"{where}.order"),
        build_edge=build_edge,
        build_since=build_since,
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
        data, where, ("id", "owner", "edge", "from_node", "charges", "depart_tick", "arrive_tick")
    )
    return Packet(
        id=_int(raw["id"], f"{where}.id", low=0),
        owner=_int(raw["owner"], f"{where}.owner", low=0),
        edge=_int(raw["edge"], f"{where}.edge", low=0),
        from_node=_int(raw["from_node"], f"{where}.from_node", low=0),
        charges=_int(raw["charges"], f"{where}.charges", low=0),
        depart_tick=_int(raw["depart_tick"], f"{where}.depart_tick", low=0),
        arrive_tick=_int(raw["arrive_tick"], f"{where}.arrive_tick", low=0),
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
        raw = _obj(item, at, ("id", "tick", "level", "enemy_modes", "enemy_units", "enemy_charged"))
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
