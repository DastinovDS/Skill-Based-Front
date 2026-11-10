"""Game state (SIM-02): GameState and its entities, canonical form and state hash.

Rules for this module (AGENTS.md, section 4):

- entities are ``@dataclass(slots=True)``; value objects are frozen;
- collections are ``dict[int, T]`` keyed by id, and every walk over them is ``sorted()``;
- a group stores the counters ``units`` and ``charged``, not a list of units;
- only integers: CP in hundredths, edge progress in thousandths (``PROGRESS_SCALE``).

``to_canonical()`` turns the state into plain JSON data with every collection as a list sorted by
id, so the canonical JSON and ``state_hash()`` do not depend on dict insertion order or
``PYTHONHASHSEED``. The static map is embedded in the file format (``map_to_data``), so the
canonical form alone restores the state: ``from_canonical(to_canonical(s)) == s``. Some fields of
the factories (DEC-41), of the supply flow (DEC-43) and of the group order and the rally point
(DEC-48) are written only when they differ from their defaults.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Final, Protocol, cast

from gow_sim.canonical import digest
from gow_sim.maps import PLAYERS, MapDef, NodeKind, map_to_data, parse_map
from gow_sim.ruleset import Ruleset, Stance

PROGRESS_SCALE: Final = 1000
"""Edge progress is stored in thousandths of the edge (DEC-07, rule 6)."""

PLAN_WAIT: Final = 2**31 - 1
"""``Order.depart_tick`` of a planned order that gathers its bonus (DEC-41, item 10): no
departure tick is known until the requested bonus or the cap is reached, or the
player releases the group; then ``systems.orders`` (or ``ReleasePlan``) sets the real tick."""


class Mode(StrEnum):
    """Group mode (mechanics.md, section 3). "Defense" was removed with economy v1 (DEC-41,
    item 5; #894): every group attacks."""

    ATTACK = "attack"


class IntentKind(StrEnum):
    """Publicly visible intent types (DEC-04, DEC-08): the planned order."""

    PLANNED_MOVE = "planned_move"


class BuildKind(StrEnum):
    """What a city builds in its build slot (DEC-26, item 9): the barracks."""

    BARRACKS = "barracks"


class FlowIdle(StrEnum):
    """Why an own node sends nothing at the next dispatch of the supply flow (DEC-43, item E)."""

    LEAF = "leaf"
    """On the level (``d == k``) or without a field."""
    AHEAD = "ahead"
    """Ahead of the level (``d < k``): it neither gives nor receives."""
    EMPTY = "empty"
    """Its warehouse is empty."""
    FULL = "full"
    """No neighbour takes a charge."""


class Detail(StrEnum):
    """How much a player sees of a node or a half of an edge (DEC-21, mechanics.md, section 10).

    Better first: ``EXACT``, ``RANGE``, ``PRESENCE``, ``FOG``.
    """

    EXACT = "exact"
    """Everything, with numbers: the sources of vision (nodes where own groups stand, DEC-35)
    and the neighbours a source sees exactly by the terrain table."""
    RANGE = "range"
    """The range of the enemy units (``vision.range_starts``) and their modes, no charged."""
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
    the tick the order was applied; a gathering planned order has ``PLAN_WAIT`` until it may depart
    (DEC-41, item 10).
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
    """Id of the group's public ``Intent`` (SIM-10): a planned order. The link lives only here,
    the intent names no group (DEC-04)."""
    bonus: int = 0
    """Virtual shots of a planned order the group brings into its next fight (DEC-08, DEC-41
    item 10, SIM-10); 0: none."""
    bonus_tick: int = 0
    """The tick from which ``bonus`` is active: the departure of the planned order."""
    fight: int | None = None
    """Id of the ``Fight`` the group is in (DEC-24); ``None``: in no fight. A group in a fight
    does not move (DEC-24, item B6)."""
    plan: int = 0
    """DEC-41, item 10: the bonus the player requested for the planned order the
    group waits on and gathers (``bonus`` is what it has so far); 0: no gathering plan."""
    plan_tick: int = 0
    """The tick of the planned order or of the last charge it took (DEC-41, item 10): the next
    charge is due ``orders.plan_ticks_per_bonus`` ticks later; 0 without a gathering plan."""
    group_order: int | None = None
    """DEC-48: the id of the ``GroupOrder`` whose member the group is while its order lasts;
    ``None`` for a single order or none."""
    walk: bool = False
    """DEC-48, item H3: a recruit walking to the rally point of its city that has not paid
    ``recruit.rally_cost`` yet; it pays when it leaves the city (``systems.movement``)."""


@dataclass(slots=True)
class GroupOrder:
    """One ``GroupMove`` of ``owner`` (DEC-48) while a member still holds its order; the members
    are the groups whose ``Group.group_order`` is this id.

    ``rally``: a rally to an own node (every member departs at once); else an attack with a
    synchronized arrival. ``planned``: the members gather their parts of the bonus (item F).
    ``arrive_tick``: the common arrival (a rally: the latest arrival of a member), ``None`` while
    a planned order gathers (its departures are fixed once the last member is ready, item F4).
    Own data only: no field reaches the enemy (item I1)."""

    id: int
    owner: int
    rally: bool
    planned: bool
    arrive_tick: int | None


@dataclass(frozen=True, slots=True)
class FightMember:
    """A group in a fight (DEC-24), by group id in ``Fight.members``.

    ``player``: the owner (kept after the group dies, for the events). ``edge`` and
    ``from_node``: the edge the group came over into the node of the fight, the way back of a
    bounce or a withdrawal (item E2); ``None`` for a group that stood there or fights on an edge.
    ``returning``: it came back over that edge (a bounce, a cancel or a withdrawal): if its side
    does not take the node, it dies (item G3). ``arrived``: it finished a movement into the node,
    so it joins the auto-merge after the fight (DEC-20, A; DEC-07, rule 7). ``leaving``: a
    withdrawal is ordered (item E), the group leaves after the next round. ``units`` and
    ``charged``: the counters when it joined (for ``fight_group``).
    """

    player: int
    units: int
    charged: int
    edge: int | None = None
    from_node: int | None = None
    returning: bool = False
    arrived: bool = False
    leaving: bool = False


@dataclass(frozen=True, slots=True)
class FightRound:
    """The last round of a fight (DEC-24, item I1 as revised with DEC-29): by player, the shots
    made, the virtual ones among them, the charges that left its units (``spent``), the units it
    lost and the charges the terrain burned before the shots (``burned``, DEC-45, not in
    ``spent``). Public to both players, like the ``fight_round`` event of that round, and so are
    the virtual shots still left (``Fight.virtual``, DEC-32)."""

    tick: int
    shots: tuple[int, int]
    virtual: tuple[int, int]
    spent: tuple[int, int]
    losses: tuple[int, int]
    burned: tuple[int, int] = (0, 0)


@dataclass(slots=True)
class Fight:
    """A fight that lasts over ticks (DEC-24): a node or an edge, rounds every ``round_ticks``.

    ``node`` or ``edge`` (exactly one is set). ``point``: on an edge, ``pos_0 + pos_1`` in
    thousandths from the end ``a`` (0..2000, item C3); ``None`` in a node. ``attacker``: the
    player attacking a node; ``None`` for an edge and a neutral node (symmetric fights).
    ``start``: the contact tick; ``next_round``: the tick of the next round. ``virtual``: the
    virtual shots left by player (bonuses, mountains; item F); ``mute``: real charges of the
    player silent in every round (plains, item F2), under ``combat.terrain_burn`` the charges the
    first round will burn, 0 after it (DEC-45); ``shots`` and ``losses``: totals of the fight
    by player (the edge winner, item G4). ``members``: the groups in the fight by group id.
    ``last_round``: the latest round; ``None`` before the first one.
    """

    id: int
    node: int | None
    edge: int | None
    point: int | None
    attacker: int | None
    start: int
    next_round: int
    virtual: tuple[int, int]
    mute: tuple[int, int]
    shots: tuple[int, int]
    losses: tuple[int, int]
    members: dict[int, FightMember]
    last_round: FightRound | None = None


@dataclass(frozen=True, slots=True)
class FlowNode:
    """The supply flow at an own node (DEC-43), set by
    ``systems.flow`` in every tick (and by ``initial_state``) for every node of its owner.

    ``d``: the effective field (item A4, after the pull), ``None`` without a field (INF, item A2).
    ``k``: the leaf level of the node's own component (item A10: the shift for the capital's
    component, 0 for any other). ``pocket``: the component does not contain the own capital
    (item H1).
    ``down``: the downhill neighbours of item A6 (``k <= d(m) < d``, room not considered), by
    ``node_key``. ``next``: the receivers of its next dispatch in the order of item A6, and
    ``idle`` why there are none (the plan of item A13, step 6; ``None`` when ``next`` is set).
    The economy reads ``d`` and ``k`` of the previous tick for the spill of a full factory
    (item A8)."""

    d: int | None
    k: int
    pocket: bool
    down: tuple[int, ...] = ()
    next: tuple[int, ...] = ()
    idle: FlowIdle | None = None


@dataclass(slots=True)
class PlayerState:
    id: int
    cp: int
    """Command points in hundredths (100 = 1 CP)."""
    stance: Stance
    """The stance (DEC-44): the periods of the CP income and of the own capital."""
    vp: int
    forfeited: bool = False
    """The player gave up: a ``Forfeit`` command, also for a technical defeat (DEC-05)."""
    leaf_shift: int = 0
    """The leaf shift in force (DEC-43, item B): the level is the own
    nodes ``leaf_shift`` roads behind the front; ``SetLeafShift`` sets it, the flow step clamps
    it to ``leaf_shift_max`` (item B3). Hidden from the enemy (item B5)."""
    leaf_shift_max: int = 0
    """``d0`` of the own capital stored by the last flow step: the largest ``SetLeafShift``."""
    cp_ticks: int = 0
    """Ticks since the last CP quantum (DEC-44): the quantum fires when this
    reaches the period of the stance; a stance change carries it over to the new period
    (``systems.economy.carry``, #792). Hidden from the enemy."""
    capital_ticks: int = 0
    """Ticks since the last quantum of the own capital (DEC-44), the same way. It keeps counting
    without an own capital, and the quantum then does nothing."""


@dataclass(frozen=True, slots=True)
class Build:
    """The build in the build slot of a city (``Node.build``, DEC-26, item 8): the barracks.

    ``owner``: the player who started it; it holds while the city is theirs. ``since``: the tick
    the build time started, the tick the command was applied unless it waits for its payment; the
    build ends ``city_upgrades.barracks_ticks`` ticks later. ``owed``: the charges still to pay
    (DEC-41, item 7, the progressive payment); while it is above 0 the build time has not started.
    """

    owner: int
    since: int
    kind: BuildKind = BuildKind.BARRACKS
    owed: int = 0


@dataclass(frozen=True, slots=True)
class FactoryBuild:
    """A factory being built (DEC-41, item 2): by ``owner``, the build time started at the tick
    ``since``; it holds while the node is theirs and ends ``factory.build_ticks`` later.
    ``owed``: the charges still to pay (item 7, the progressive payment); while it is above 0 the
    build time has not started and ``since`` is the tick of the command."""

    owner: int
    since: int
    owed: int = 0


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
    recruit_queue: int = 0
    """Units in the recruit queue of the city, the one in production included (DEC-25); it
    belongs to the owner and is emptied on every owner change."""
    recruit_progress: int = 0
    """Ticks of production of the first unit of the queue, ``0..recruit.unit_ticks``; equal to
    ``unit_ticks``: the unit is ready and waits for a place (DEC-25, items 4 and 7)."""
    build: Build | None = None
    """The barracks build of this city (DEC-26); ``None``: no build."""
    has_barracks: bool = False
    """The city may recruit (DEC-26): the capital from the start and the cities that built the
    barracks. Kept on a capture."""
    cut_since: int | None = None
    """First tick of the current continuous cut of an own node of a factory-less pocket from the
    owner's capital (DEC-43, item H4; DEC-19, item 2); ``None`` while supplied and for neutral
    nodes."""
    factory: int | None = None
    """The player whose factory this city is (DEC-41, item 2); ``None``: no factory. It differs
    from ``owner`` only between a capture and the ``supply`` system of the same tick
    (``systems.flow.settle_factories``), which passes the factory to the capturer or destroys
    it."""
    factory_build: FactoryBuild | None = None
    """The factory being built here (DEC-41, item 2); ``None``: none."""
    factory_ticks: int = 0
    """Ticks since the last charge of this factory, under ``stances.factories_follow`` (DEC-47,
    #888) and only for a factory that is not its owner's capital: 0 when the factory starts
    working (its build ends, a capture passes it); the charge comes when it reaches the capital
    period of the owner's stance; a stance change carries it over (``systems.economy.carry``).
    Always 0 without the key. Hidden from the enemy."""
    flow: FlowNode | None = None
    """The supply flow of the owner here (DEC-43); ``None`` for nodes without an owner."""
    road_forts: dict[int, int] = field(default_factory=dict[int, int])
    """The road fortifications of the owner here (DEC-43, item D; code name ``road_fort``): edge
    id (a road leaving the node) to the tick it works from (``ready``: the tick of the command plus
    ``fort.build_ticks``); before it, it is being built. Destroyed on capture (``change_owner``)."""
    rally_point: int | None = None
    """DEC-48, item H: the own node the new units of this own city walk to; ``None``: none. Lost
    when the city or the point changes owner (``change_owner``)."""


@dataclass(slots=True)
class Packet:
    """Charges on the way along a path of internal edges (mechanics.md, section 7; DEC-18, item 5).

    ``edge`` is the current edge of the path, travelled away from ``from_node`` during
    ``depart_tick .. arrive_tick``. ``route``: the edges of the path still to go after ``edge``,
    the next one first; ``route_ticks``: their times, fixed at dispatch.
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


@dataclass(slots=True)
class Intent:
    """The public part of a planned order: no group id and no group size."""

    id: int
    owner: int
    kind: IntentKind
    origin: int
    target: int | None
    created_tick: int


@dataclass(frozen=True, slots=True)
class Sighting:
    """What a player sees, or last saw, of the enemy groups of a place: a node or a half of an
    edge (DEC-21, items 3 and 8; fog with «last seen» memory).

    ``enemy_modes``: distinct modes of the enemy groups seen, sorted; empty means none seen
    (every group attacks, so it says whether enemies were there).
    ``enemy_units`` and ``enemy_charged``: totals, known only when ``level`` is ``EXACT``.
    ``enemy_range``: the range ``(low, high)`` of the total units (``high`` ``None``: open), only
    when ``level`` is ``RANGE`` and enemies are there (DEC-21, item 4).
    """

    tick: int
    level: Detail
    enemy_modes: tuple[Mode, ...]
    enemy_units: int | None
    enemy_charged: int | None
    enemy_range: tuple[int, int | None] | None = None


@dataclass(slots=True)
class VisionMemory:
    """Fog memory of one player (DEC-17, item 7; DEC-21, item 8; DEC-33, details 5 and 8).

    ``nodes``: last sighting by node id. ``halves``: last sighting of the half of an edge by
    ``(edge, node)``, the node being the end the half belongs to; positions and directions are
    not remembered (DEC-33, detail 8). ``spotted``: enemy group id to the tick it came into sight,
    for every enemy group in sight now; it keys the opaque id of a figure, so a group gets a new one
    each time it comes out of the fog (DEC-33, detail 5).
    """

    nodes: dict[int, Sighting] = field(default_factory=dict[int, Sighting])
    halves: dict[tuple[int, int], Sighting] = field(default_factory=dict[tuple[int, int], Sighting])
    spotted: dict[int, int] = field(default_factory=dict[int, int])


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


def event(tick: int, kind: str, /, **data: EventValue) -> Event:
    return Event(tick=tick, kind=kind, data=tuple(sorted(data.items())))


@dataclass(slots=True)
class GameState:
    map: MapDef
    tick: int
    players: dict[int, PlayerState]
    nodes: dict[int, Node]
    groups: dict[int, Group]
    packets: dict[int, Packet]
    intents: dict[int, Intent]
    vision_memory: dict[int, VisionMemory]
    """Fog memory per player id; updated by the vision system at the end of a tick."""
    next_id: int
    """Next id for a group, packet, intent or fight (one counter for all of them)."""
    events: list[Event]
    """Events of the current tick."""
    fights: dict[int, Fight] = field(default_factory=dict[int, Fight])
    """Fights going on (DEC-24), by id."""
    group_orders: dict[int, GroupOrder] = field(default_factory=dict[int, GroupOrder])
    """Group orders with a member still holding its order (DEC-48), by id."""
    memo: dict[str, object] = field(default_factory=dict[str, object], compare=False, repr=False)
    """Caches of pure functions of the state, each kept with its full inputs and used only while
    they are equal (the flow field, ``systems.flow._field``). Not part of the state:
    ``to_canonical`` and ``state_hash`` leave it out, nothing reads it as state."""

    def fight_nodes(self) -> dict[int, int]:
        """Nodes with a fight going on: node id to fight id."""
        return {f.node: fid for fid, f in sorted(self.fights.items()) if f.node is not None}

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
    ``economy.start_stance`` (DEC-09). Only the capital has a barracks (DEC-26) and keeps the start
    stock of the map, cut to its warehouse (DEC-41, item 9); the own capital is the main factory
    (DEC-41, item 2). The initial state carries the field and the plan of the flow (DEC-43).
    """
    state = GameState(
        map=mapdef,
        tick=0,
        players={
            p: PlayerState(
                id=p,
                cp=rules.cp.start,
                stance=rules.economy.start_stance,
                vp=0,
            )
            for p in PLAYERS
        },
        nodes={
            n.id: Node(
                id=n.id,
                owner=n.start_owner,
                warehouse=_start_stock(rules, n.start_stock, n.kind),
                over_ticks=0,
                captured_tick=None,
                has_barracks=n.kind is NodeKind.CAPITAL,
                factory=n.capital_of,
            )
            for n in mapdef.nodes
        },
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
    # The field and the plan of the flow (DEC-43, item A8). A local import: the systems import
    # this module.
    from gow_sim.systems.flow import update_flow

    update_flow(state, rules)
    return state


def _start_stock(rules: Ruleset, stock: int, kind: NodeKind) -> int:
    """Only the capital keeps the start stock of the map (DEC-41, item 9), cut to its warehouse
    capacity; the excess is dropped without an event (DEC-26, item 5)."""
    if kind is not NodeKind.CAPITAL:
        return 0
    return min(stock, rules.warehouse.start_by_kind.of(kind))


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
        "groups": [_group_data(g) for g in _by_id(state.groups)],
        "packets": [_packet_data(p) for p in _by_id(state.packets)],
        "intents": [_intent_data(i) for i in _by_id(state.intents)],
        "fights": [_fight_data(f) for f in _by_id(state.fights)],
        "vision_memory": [
            _memory_data(p, state.vision_memory[p]) for p in sorted(state.vision_memory)
        ],
        "events": [{"tick": e.tick, "kind": e.kind, "data": dict(e.data)} for e in state.events],
        **_group_orders_data(state),
    }


def _group_orders_data(state: GameState) -> dict[str, object]:
    """The group orders of DEC-48, only when there are any (see the module docstring)."""
    if not state.group_orders:
        return {}
    return {
        "group_orders": [
            {
                "id": o.id,
                "owner": o.owner,
                "rally": o.rally,
                "planned": o.planned,
                "arrive_tick": o.arrive_tick,
            }
            for o in _by_id(state.group_orders)
        ]
    }


def _by_id[T](items: dict[int, T]) -> list[T]:
    return [items[key] for key in sorted(items)]


def _player_data(p: PlayerState) -> dict[str, object]:
    return {
        "id": p.id,
        "cp": p.cp,
        "stance": p.stance.value,
        "vp": p.vp,
        "forfeited": p.forfeited,
        **_flow_player_data(p),
    }


def _flow_player_data(p: PlayerState) -> dict[str, object]:
    """The flow and stance counters of a player, only when set (see the module docstring)."""
    data: dict[str, object] = {}
    if p.leaf_shift:
        data["leaf_shift"] = p.leaf_shift
    if p.leaf_shift_max:
        data["leaf_shift_max"] = p.leaf_shift_max
    if p.cp_ticks:
        data["cp_ticks"] = p.cp_ticks
    if p.capital_ticks:
        data["capital_ticks"] = p.capital_ticks
    return data


def _node_data(n: Node) -> dict[str, object]:
    return {
        "id": n.id,
        "owner": n.owner,
        "warehouse": n.warehouse,
        "over_ticks": n.over_ticks,
        "captured_tick": n.captured_tick,
        "recruit_queue": n.recruit_queue,
        "recruit_progress": n.recruit_progress,
        "cut_since": n.cut_since,
        "build": _build_data(n.build),
        "has_barracks": n.has_barracks,
        **_factory_node_data(n),
    }


def _factory_node_data(n: Node) -> dict[str, object]:
    """The factory and flow fields of a node, only when set (see the module docstring)."""
    data: dict[str, object] = {}
    if n.factory is not None:
        data["factory"] = n.factory
    if n.factory_build is not None:
        data["factory_build"] = _site_build_data(n.factory_build)
    if n.factory_ticks:
        data["factory_ticks"] = n.factory_ticks
    if n.road_forts:
        data["road_forts"] = [{"edge": e, "ready": n.road_forts[e]} for e in sorted(n.road_forts)]
    if n.rally_point is not None:
        data["rally_point"] = n.rally_point
    if n.flow is not None:
        f = n.flow
        data["flow"] = {
            "d": f.d,
            "k": f.k,
            "pocket": f.pocket,
            "down": list(f.down),
            "next": list(f.next),
            "idle": None if f.idle is None else f.idle.value,
        }
    return data


def _build_data(b: Build | None) -> dict[str, object] | None:
    if b is None:
        return None
    data: dict[str, object] = {"owner": b.owner, "since": b.since, "kind": b.kind.value}
    if b.owed:
        data["owed"] = b.owed
    return data


def _site_build_data(b: FactoryBuild) -> dict[str, object]:
    data: dict[str, object] = {"owner": b.owner, "since": b.since}
    if b.owed:
        data["owed"] = b.owed
    return data


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
    data: dict[str, object] = {
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
        "fight": g.fight,
    }
    if g.plan:  # a gathering planned order (DEC-41, item 10)
        data["plan"] = g.plan
        data["plan_tick"] = g.plan_tick
    if g.group_order is not None:  # a member of a group order (DEC-48)
        data["group_order"] = g.group_order
    if g.walk:  # an unpaid recruit walk (DEC-48, item H3)
        data["walk"] = True
    return data


def _fight_data(f: Fight) -> dict[str, object]:
    return {
        "id": f.id,
        "node": f.node,
        "edge": f.edge,
        "point": f.point,
        "attacker": f.attacker,
        "start": f.start,
        "next_round": f.next_round,
        "virtual": list(f.virtual),
        "mute": list(f.mute),
        "shots": list(f.shots),
        "losses": list(f.losses),
        "members": [
            {
                "group": gid,
                "player": m.player,
                "units": m.units,
                "charged": m.charged,
                "edge": m.edge,
                "from_node": m.from_node,
                "returning": m.returning,
                "arrived": m.arrived,
                "leaving": m.leaving,
            }
            for gid, m in sorted(f.members.items())
        ],
        "last_round": None if f.last_round is None else _round_data(f.last_round),
    }


def _round_data(r: FightRound) -> dict[str, object]:
    data: dict[str, object] = {
        "tick": r.tick,
        "shots": list(r.shots),
        "virtual": list(r.virtual),
        "spent": list(r.spent),
        "losses": list(r.losses),
    }
    if any(r.burned):  # DEC-45: the terrain burned charges in this round
        data["burned"] = list(r.burned)
    return data


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


def _memory_data(player: int, m: VisionMemory) -> dict[str, object]:
    return {
        "player": player,
        "nodes": [{"id": k, **_sighting_data(m.nodes[k])} for k in sorted(m.nodes)],
        "halves": [
            {"edge": e, "node": n, **_sighting_data(m.halves[e, n])} for e, n in sorted(m.halves)
        ],
        "spotted": [{"id": k, "tick": m.spotted[k]} for k in sorted(m.spotted)],
    }


def _sighting_data(s: Sighting) -> dict[str, object]:
    return {
        "tick": s.tick,
        "level": s.level.value,
        "enemy_modes": [m.value for m in s.enemy_modes],
        "enemy_units": s.enemy_units,
        "enemy_charged": s.enemy_charged,
        "enemy_range": None if s.enemy_range is None else list(s.enemy_range),
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
            "groups",
            "packets",
            "intents",
            "fights",
            "vision_memory",
            "events",
        ),
        optional=("group_orders",),
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
        groups=_collection(root["groups"], "groups", _parse_group),
        packets=_collection(root["packets"], "packets", _parse_packet),
        intents=_collection(root["intents"], "intents", _parse_intent),
        fights=_collection(root["fights"], "fights", _parse_fight),
        vision_memory=_parse_vision_memory(root["vision_memory"]),
        next_id=_int(root["next_id"], "state.next_id", low=0),
        events=[
            _parse_event(raw, f"events[{i}]")
            for i, raw in enumerate(_list(root["events"], "events"))
        ],
        group_orders=_collection(root.get("group_orders", []), "group_orders", _parse_group_order),
    )


def _parse_group_order(data: object, where: str) -> GroupOrder:
    raw = _obj(data, where, ("id", "owner", "rally", "planned", "arrive_tick"))
    return GroupOrder(
        id=_int(raw["id"], f"{where}.id", low=0),
        owner=_int(raw["owner"], f"{where}.owner", low=0),
        rally=_bool(raw["rally"], f"{where}.rally"),
        planned=_bool(raw["planned"], f"{where}.planned"),
        arrive_tick=_opt_int(raw["arrive_tick"], f"{where}.arrive_tick"),
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
        (
            "id",
            "cp",
            "stance",
            "vp",
            "forfeited",
        ),
        optional=(
            "leaf_shift",
            "leaf_shift_max",
            "cp_ticks",
            "capital_ticks",
        ),
    )
    return PlayerState(
        id=_int(raw["id"], f"{where}.id", low=0),
        cp=_int(raw["cp"], f"{where}.cp", low=0),
        stance=Stance(_choice(raw["stance"], f"{where}.stance", Stance)),
        vp=_int(raw["vp"], f"{where}.vp", low=0),
        forfeited=_bool(raw["forfeited"], f"{where}.forfeited"),
        leaf_shift=_int(raw.get("leaf_shift", 0), f"{where}.leaf_shift", low=0),
        leaf_shift_max=_int(raw.get("leaf_shift_max", 0), f"{where}.leaf_shift_max", low=0),
        cp_ticks=_int(raw.get("cp_ticks", 0), f"{where}.cp_ticks", low=0),
        capital_ticks=_int(raw.get("capital_ticks", 0), f"{where}.capital_ticks", low=0),
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
            "recruit_queue",
            "recruit_progress",
            "cut_since",
            "build",
            "has_barracks",
        ),
        optional=(
            "factory",
            "factory_build",
            "factory_ticks",
            "flow",
            "road_forts",
            "rally_point",
        ),
    )
    return Node(
        id=_int(raw["id"], f"{where}.id", low=0),
        owner=_opt_int(raw["owner"], f"{where}.owner"),
        warehouse=_int(raw["warehouse"], f"{where}.warehouse", low=0),
        over_ticks=_int(raw["over_ticks"], f"{where}.over_ticks", low=0),
        captured_tick=_opt_int(raw["captured_tick"], f"{where}.captured_tick"),
        recruit_queue=_int(raw["recruit_queue"], f"{where}.recruit_queue", low=0),
        recruit_progress=_int(raw["recruit_progress"], f"{where}.recruit_progress", low=0),
        build=None if raw["build"] is None else _parse_build(raw["build"], f"{where}.build"),
        cut_since=_opt_int(raw["cut_since"], f"{where}.cut_since"),
        has_barracks=_bool(raw["has_barracks"], f"{where}.has_barracks"),
        factory=_opt_int(raw.get("factory"), f"{where}.factory"),
        factory_build=_parse_site_build(raw.get("factory_build"), f"{where}.factory_build"),
        factory_ticks=_int(raw.get("factory_ticks", 0), f"{where}.factory_ticks", low=0),
        flow=_parse_flow(raw.get("flow"), f"{where}.flow"),
        road_forts=_parse_road_forts(raw.get("road_forts", []), f"{where}.road_forts"),
        rally_point=_opt_int(raw.get("rally_point"), f"{where}.rally_point"),
    )


def _parse_road_forts(data: object, where: str) -> dict[int, int]:
    forts: dict[int, int] = {}
    for item in _list(data, where):
        raw = _obj(item, where, ("edge", "ready"))
        edge = _int(raw["edge"], f"{where}.edge", low=0)
        if edge in forts:
            raise StateFormatError(f"{where}: edge {edge} twice")
        forts[edge] = _int(raw["ready"], f"{where}.ready", low=0)
    return forts


def _parse_flow(data: object, where: str) -> FlowNode | None:
    if data is None:
        return None
    raw = _obj(data, where, ("d", "k", "pocket", "down", "next", "idle"))
    idle = raw["idle"]
    return FlowNode(
        d=_opt_int(raw["d"], f"{where}.d"),
        k=_int(raw["k"], f"{where}.k", low=0),
        pocket=_bool(raw["pocket"], f"{where}.pocket"),
        down=tuple(_int(n, f"{where}.down", low=0) for n in _list(raw["down"], f"{where}.down")),
        next=tuple(_int(n, f"{where}.next", low=0) for n in _list(raw["next"], f"{where}.next")),
        idle=None if idle is None else FlowIdle(_choice(idle, f"{where}.idle", FlowIdle)),
    )


def _parse_site_build(data: object, where: str) -> FactoryBuild | None:
    if data is None:
        return None
    raw = _obj(data, where, ("owner", "since"), optional=("owed",))
    return FactoryBuild(
        owner=_int(raw["owner"], f"{where}.owner", low=0),
        since=_int(raw["since"], f"{where}.since", low=0),
        owed=_int(raw.get("owed", 0), f"{where}.owed", low=0),
    )


def _parse_build(data: object, where: str) -> Build:
    raw = _obj(data, where, ("owner", "since", "kind"), optional=("owed",))
    return Build(
        owner=_int(raw["owner"], f"{where}.owner", low=0),
        since=_int(raw["since"], f"{where}.since", low=0),
        kind=BuildKind(_choice(raw["kind"], f"{where}.kind", BuildKind)),
        owed=_int(raw.get("owed", 0), f"{where}.owed", low=0),
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
            "fight",
        ),
        optional=("plan", "plan_tick", "group_order", "walk"),
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
        fight=_opt_int(raw["fight"], f"{where}.fight"),
        plan=_int(raw.get("plan", 0), f"{where}.plan", low=0),
        plan_tick=_int(raw.get("plan_tick", 0), f"{where}.plan_tick", low=0),
        group_order=_opt_int(raw.get("group_order"), f"{where}.group_order"),
        walk=_bool(raw.get("walk", False), f"{where}.walk"),
    )


def _pair(data: object, where: str) -> tuple[int, int]:
    items = _list(data, where)
    if len(items) != len(PLAYERS):
        raise StateFormatError(f"{where}: expected one value per player")
    return (_int(items[0], f"{where}[0]", low=0), _int(items[1], f"{where}[1]", low=0))


def _parse_fight(data: object, where: str) -> Fight:
    raw = _obj(
        data,
        where,
        (
            "id",
            "node",
            "edge",
            "point",
            "attacker",
            "start",
            "next_round",
            "virtual",
            "mute",
            "shots",
            "losses",
            "members",
            "last_round",
        ),
    )
    members: dict[int, FightMember] = {}
    for i, item in enumerate(_list(raw["members"], f"{where}.members")):
        at = f"{where}.members[{i}]"
        m = _obj(
            item,
            at,
            (
                "group",
                "player",
                "units",
                "charged",
                "edge",
                "from_node",
                "returning",
                "arrived",
                "leaving",
            ),
        )
        gid = _int(m["group"], f"{at}.group", low=0)
        if gid in members:
            raise StateFormatError(f"{at}.group: duplicate group {gid}")
        members[gid] = FightMember(
            player=_int(m["player"], f"{at}.player", low=0),
            units=_int(m["units"], f"{at}.units", low=0),
            charged=_int(m["charged"], f"{at}.charged", low=0),
            edge=_opt_int(m["edge"], f"{at}.edge"),
            from_node=_opt_int(m["from_node"], f"{at}.from_node"),
            returning=_bool(m["returning"], f"{at}.returning"),
            arrived=_bool(m["arrived"], f"{at}.arrived"),
            leaving=_bool(m["leaving"], f"{at}.leaving"),
        )
    return Fight(
        id=_int(raw["id"], f"{where}.id", low=0),
        node=_opt_int(raw["node"], f"{where}.node"),
        edge=_opt_int(raw["edge"], f"{where}.edge"),
        point=_opt_int(raw["point"], f"{where}.point"),
        attacker=_opt_int(raw["attacker"], f"{where}.attacker"),
        start=_int(raw["start"], f"{where}.start", low=0),
        next_round=_int(raw["next_round"], f"{where}.next_round", low=0),
        virtual=_pair(raw["virtual"], f"{where}.virtual"),
        mute=_pair(raw["mute"], f"{where}.mute"),
        shots=_pair(raw["shots"], f"{where}.shots"),
        losses=_pair(raw["losses"], f"{where}.losses"),
        members=members,
        last_round=None
        if raw["last_round"] is None
        else _parse_round(raw["last_round"], f"{where}.last_round"),
    )


def _parse_round(data: object, where: str) -> FightRound:
    raw = _obj(data, where, ("tick", "shots", "virtual", "spent", "losses"), ("burned",))
    return FightRound(
        tick=_int(raw["tick"], f"{where}.tick", low=0),
        shots=_pair(raw["shots"], f"{where}.shots"),
        virtual=_pair(raw["virtual"], f"{where}.virtual"),
        spent=_pair(raw["spent"], f"{where}.spent"),
        losses=_pair(raw["losses"], f"{where}.losses"),
        burned=_pair(raw["burned"], f"{where}.burned") if "burned" in raw else (0, 0),
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


_SIGHTING_KEYS: Final = (
    "tick",
    "level",
    "enemy_modes",
    "enemy_units",
    "enemy_charged",
    "enemy_range",
)


def _parse_sighting(raw: dict[str, object], at: str) -> Sighting:
    span = raw["enemy_range"]
    enemy_range: tuple[int, int | None] | None = None
    if span is not None:
        bounds = _list(span, f"{at}.enemy_range")
        if len(bounds) != 2:
            raise StateFormatError(f"{at}.enemy_range: expected [low, high]")
        enemy_range = (
            _int(bounds[0], f"{at}.enemy_range[0]", low=1),
            _opt_int(bounds[1], f"{at}.enemy_range[1]"),
        )
    return Sighting(
        tick=_int(raw["tick"], f"{at}.tick", low=0),
        level=Detail(_choice(raw["level"], f"{at}.level", Detail)),
        enemy_modes=tuple(
            Mode(_choice(m, f"{at}.enemy_modes[{j}]", Mode))
            for j, m in enumerate(_list(raw["enemy_modes"], f"{at}.enemy_modes"))
        ),
        enemy_units=_opt_int(raw["enemy_units"], f"{at}.enemy_units"),
        enemy_charged=_opt_int(raw["enemy_charged"], f"{at}.enemy_charged"),
        enemy_range=enemy_range,
    )


def _parse_memory(raw: dict[str, object], at: str) -> VisionMemory:
    memory = VisionMemory()
    for i, item in enumerate(_list(raw["nodes"], f"{at}.nodes")):
        where = f"{at}.nodes[{i}]"
        row = _obj(item, where, ("id", *_SIGHTING_KEYS))
        key = _int(row["id"], f"{where}.id", low=0)
        if key in memory.nodes:
            raise StateFormatError(f"{where}.id: duplicate id {key}")
        memory.nodes[key] = _parse_sighting(row, where)
    for i, item in enumerate(_list(raw["halves"], f"{at}.halves")):
        where = f"{at}.halves[{i}]"
        row = _obj(item, where, ("edge", "node", *_SIGHTING_KEYS))
        half = (
            _int(row["edge"], f"{where}.edge", low=0),
            _int(row["node"], f"{where}.node", low=0),
        )
        if half in memory.halves:
            raise StateFormatError(f"{where}: duplicate half {half}")
        memory.halves[half] = _parse_sighting(row, where)
    for i, item in enumerate(_list(raw["spotted"], f"{at}.spotted")):
        where = f"{at}.spotted[{i}]"
        row = _obj(item, where, ("id", "tick"))
        key = _int(row["id"], f"{where}.id", low=0)
        if key in memory.spotted:
            raise StateFormatError(f"{where}.id: duplicate id {key}")
        memory.spotted[key] = _int(row["tick"], f"{where}.tick", low=0)
    return memory


def _parse_vision_memory(data: object) -> dict[int, VisionMemory]:
    result: dict[int, VisionMemory] = {}
    for i, item in enumerate(_list(data, "vision_memory")):
        at = f"vision_memory[{i}]"
        raw = _obj(item, at, ("player", "nodes", "halves", "spotted"))
        player = _int(raw["player"], f"{at}.player", low=0)
        if player in result:
            raise StateFormatError(f"{at}.player: duplicate player {player}")
        result[player] = _parse_memory(raw, at)
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


def _obj(
    data: object, where: str, keys: tuple[str, ...], optional: tuple[str, ...] = ()
) -> dict[str, object]:
    """The object ``data`` with exactly ``keys``, plus any of ``optional`` (may be absent)."""
    if not isinstance(data, dict):
        raise StateFormatError(f"{where}: expected an object, got {type(data).__name__}")
    raw: dict[str, object] = data  # pyright: ignore[reportUnknownVariableType]
    unknown = sorted(k for k in raw if k not in keys and k not in optional)
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
