"""Commands (SIM-04): player intents, their validation and application at the tick boundary.

AGENTS.md, section 4.3:

- A client or a bot sends an intent (``Move(group, dest, planned)``), never state.
- ``validate()`` checks ownership, visibility, reachability and CP and returns ``Ok`` or
  ``Reject(code)``. A group that does not exist and a group the player does not see give the same
  code ``NOT_FOUND_OR_HIDDEN``; a visible enemy group gives ``NOT_OWNER``.
- ``apply_commands()`` is the first system of a tick: the commands received during the previous
  tick are applied in ``(player, seq)`` order. A rejected command changes nothing.
- The commands of one player do not change the validity of the other player's commands in the
  same tick: a player's commands only touch the player's own groups, nodes and CP, and whether an
  enemy group is visible is decided on the state at the start of the tick.
- Surrender and a technical defeat are the command ``Forfeit`` (DEC-05), not a special path.

Ids in commands are internal ids. Opaque per-player ids of the projection are translated by
``gow_sim.view.resolve(state, player, cmd, match_key)`` (SIM-14) with ``map_group_ids()``; an id
that resolves to nothing becomes a negative id absent from the state, which ``validate()``
rejects as ``NOT_FOUND_OR_HIDDEN``.

Costs are in hundredths of CP from ``orders.cost`` (DEC-08, DEC-01, DEC-02); split, merge and
cancel are free in the rulesets of DEC-20, the keys stay so that balance can bring a price back.
Split, Merge, CancelOrder and the stack limit of ``Move`` follow DEC-20 (mechanics.md, section 3);
what DEC-20 leaves open keeps the defaults of #117 (split takes the charged units first).
Bonuses and public intents of planned orders and "Defense": ``systems.orders`` (SIM-10).
Road upgrades paid with CP (DEC-28, item 7) and, with ``city_upgrades``, the barracks and the
warehouse levels (DEC-26): ``systems.build``; they are not public.
Front markers and the rear minimum (DEC-28): ``SetFront`` and ``SetRearMin``; one-off transfers
(DEC-18): ``Transfer``; none of them is public; a transfer is cut to the free room of the
target and leaves in batches, the first in the tick it is applied (``systems.supply``, #287).
Economy v2 (DEC-41, items 2, 3, 5, 14; ``economy.model = "v2"``): ``BuildFactory``, ``DrawLine``
and ``RemoveLine`` (free of CP; ``systems.lines``, ``systems.build``); ``SetStance``, ``SetFront``,
``SetRearMin``, ``Transfer`` and ``UpgradeRoad`` give ``FEATURE_DISABLED`` there, and the three
new commands give it under v1. None of them is public.
"""

from collections.abc import Callable, Iterable
from dataclasses import dataclass, replace
from enum import StrEnum
from itertools import pairwise

from gow_sim.ruleset import Ruleset, Stance
from gow_sim.state import (
    AtNode,
    BuildKind,
    Detail,
    Event,
    FightMember,
    GameState,
    Group,
    IntentKind,
    Line,
    Mode,
    OnEdge,
    Order,
    event,
)
from gow_sim.systems.build import start_city_build, start_factory, start_road
from gow_sim.systems.economy import set_stance, stance_cooldown_left
from gow_sim.systems.lines import (
    creates_cycle,
    factory_count,
    is_line_source,
    line_edges,
    lines_out,
)
from gow_sim.systems.movement import find_path, path_ticks
from gow_sim.systems.orders import absorb, clear_bonus, set_intent
from gow_sim.systems.recruit import (
    cancel_unit,
    free_capacity,
    queue_unit,
    recruit_allowed_here,
)
from gow_sim.systems.supply import (
    TransferRoute,
    is_city,
    send_transfer,
    transfer_arrive_tick,
    transfer_route,
    warehouse_room,
)
from gow_sim.systems.vision import compute_vision, edge_detail_level, is_visible, own_internal

__all__ = [
    "BuildBarracks",
    "BuildFactory",
    "CancelOrder",
    "CancelRecruit",
    "Command",
    "CommandResult",
    "DrawLine",
    "Forfeit",
    "Merge",
    "Mode",
    "Move",
    "Ok",
    "PlayerCommand",
    "Recruit",
    "Reject",
    "RejectCode",
    "RemoveLine",
    "SetFront",
    "SetMode",
    "SetRearMin",
    "SetStance",
    "Split",
    "Stance",
    "Transfer",
    "UpgradeRoad",
    "UpgradeWarehouse",
    "apply_commands",
    "command_cost",
    "map_group_ids",
    "validate",
]


# Command types --------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Move:
    """Move ``group`` to ``dest``; ``planned``: a planned order (DEC-08)."""

    group: int
    dest: int
    planned: bool = False


@dataclass(frozen=True, slots=True)
class Split:
    """Split ``n`` units off ``group`` into a new group; the charged units go first (DEC-20, B1)."""

    group: int
    n: int


@dataclass(frozen=True, slots=True)
class Merge:
    """Merge two or more groups standing in one node into the one with the smallest id; it keeps
    its mode and "Defense" with the bonus (DEC-20, B2). A group that holds a move order is
    ``GROUP_BUSY``: the size the stack limit was checked for must not change (DEC-20, D3)."""

    groups: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class SetMode:
    group: int
    mode: Mode


@dataclass(frozen=True, slots=True)
class SetStance:
    stance: Stance


@dataclass(frozen=True, slots=True)
class UpgradeRoad:
    """Raise the own internal ``edge`` by one level for ``orders.cost.build`` CP (DEC-28, item 7):
    no city pays or builds it."""

    edge: int


@dataclass(frozen=True, slots=True)
class BuildBarracks:
    """The own city ``node`` builds the barracks: then it recruits (DEC-26, ``city_upgrades``)."""

    node: int


@dataclass(frozen=True, slots=True)
class UpgradeWarehouse:
    """The own city ``node`` raises its warehouse by one level (DEC-26, item 3)."""

    node: int


@dataclass(frozen=True, slots=True)
class Recruit:
    """Put one unit into the recruit queue of the own city ``node`` (DEC-25)."""

    node: int


@dataclass(frozen=True, slots=True)
class CancelRecruit:
    """Take the last unit off the recruit queue of the own city ``node`` (DEC-25, item 11)."""

    node: int


@dataclass(frozen=True, slots=True)
class CancelOrder:
    """Cancel any order of ``group`` (DEC-20, C): a planned order while it waits to depart, a move
    order on an edge (the group turns back to the start of the current edge, ``OnEdge.back``),
    or "Defense" (the same as ``SetMode(ATTACK)``)."""

    group: int


@dataclass(frozen=True, slots=True)
class SetFront:
    """Put the front marker ``marker`` (``0..supply.front_markers - 1``) on the own city
    ``node`` (DEC-28, item 2); ``node = None`` takes the marker off the map (owner's decision of
    2026-10-20, #309). Never two markers on one city."""

    marker: int
    node: int | None


@dataclass(frozen=True, slots=True)
class SetRearMin:
    """The rear minimum ``n`` of the player, ``0..supply.rear_min_max`` (DEC-28, item 3)."""

    n: int


@dataclass(frozen=True, slots=True)
class Transfer:
    """Ship ``n`` charges from the warehouse of the own city ``src`` to the own city ``dst``
    along own internal roads, once (DEC-18, item 6). ``from``/``to`` of the decision."""

    src: int
    dst: int
    n: int


@dataclass(frozen=True, slots=True)
class BuildFactory:
    """The own city ``node`` builds a supply factory (DEC-41, item 2; economy v2)."""

    node: int


@dataclass(frozen=True, slots=True)
class DrawLine:
    """A supply line along ``path``: own nodes from its source (an own factory or the target of
    an own line) to its target, an own city, each next one a neighbour (DEC-41, items 3 and 6)."""

    path: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class RemoveLine:
    """Remove the own line ``line`` (its per-player id, DEC-41, item 3)."""

    line: int


@dataclass(frozen=True, slots=True)
class Forfeit:
    pass


type Command = (
    Move
    | Split
    | Merge
    | SetMode
    | SetStance
    | UpgradeRoad
    | BuildBarracks
    | UpgradeWarehouse
    | Recruit
    | CancelRecruit
    | CancelOrder
    | SetFront
    | SetRearMin
    | Transfer
    | BuildFactory
    | DrawLine
    | RemoveLine
    | Forfeit
)


def map_group_ids(cmd: Command, f: Callable[[int], int]) -> Command:
    """``cmd`` with every group id replaced by ``f(id)``: the hook for ``resolve()`` (SIM-14)."""
    match cmd:
        case Move(group=g, dest=dest, planned=planned):
            return Move(f(g), dest, planned)
        case Split(group=g, n=n):
            return Split(f(g), n)
        case Merge(groups=groups):
            return Merge(tuple(f(g) for g in groups))
        case SetMode(group=g, mode=mode):
            return SetMode(f(g), mode)
        case CancelOrder(group=g):
            return CancelOrder(f(g))
        case (
            SetStance()
            | UpgradeRoad()
            | BuildBarracks()
            | UpgradeWarehouse()
            | Recruit()
            | CancelRecruit()
            | SetFront()
            | SetRearMin()
            | Transfer()
            | BuildFactory()
            | DrawLine()
            | RemoveLine()
            | Forfeit()
        ):
            return cmd


# Results --------------------------------------------------------------------------------------


class RejectCode(StrEnum):
    NOT_FOUND_OR_HIDDEN = "NOT_FOUND_OR_HIDDEN"
    """The entity does not exist or the player does not see it: one code for both."""
    NOT_OWNER = "NOT_OWNER"
    """A visible group or a node of another player (or a neutral node)."""
    NOT_ENOUGH_CP = "NOT_ENOUGH_CP"
    GROUP_ON_EDGE = "GROUP_ON_EDGE"
    """Groups take commands other than ``CancelOrder`` only while standing in a node (DEC-20)."""
    GROUP_BUSY = "GROUP_BUSY"
    """The group waits to depart on a planned order; only ``CancelOrder`` is accepted (#117)."""
    NO_PATH = "NO_PATH"
    STACK_LIMIT = "STACK_LIMIT"
    """A path exists, but none whose nodes (besides the start) all hold the group (DEC-20, D)."""
    INVALID_ARGUMENT = "INVALID_ARGUMENT"
    """Malformed arguments: ``n`` out of range, fewer than two or repeated groups, same node."""
    NOT_SAME_NODE = "NOT_SAME_NODE"
    NOT_INTERNAL = "NOT_INTERNAL"
    """Only an internal edge of the player can be upgraded (mechanics.md, section 8)."""
    MAX_WIDTH = "MAX_WIDTH"
    """The road already has ``max_level`` (its last level, DEC-22; the code keeps its name)."""
    NOT_CITY = "NOT_CITY"
    """The node is a province, not a city (DEC-22, item 3; DEC-18, items 1 and 6; DEC-23)."""
    CITY_BUSY = "CITY_BUSY"
    """The city already builds the barracks or a warehouse level (DEC-26, item 8)."""
    EDGE_BUSY = "EDGE_BUSY"
    """A level of the road is being built already (DEC-28, item 7)."""
    NOT_ENOUGH_CHARGES = "NOT_ENOUGH_CHARGES"
    """The city warehouse holds fewer charges than a transfer ships (DEC-18)."""
    TARGET_FULL = "TARGET_FULL"
    """The warehouse of the transfer's target has no free room (DEC-18, item 6, #287)."""
    NO_CHANGE = "NO_CHANGE"
    """The command would leave everything as it is (same mode or stance; already forfeited)."""
    STANCE_COOLDOWN = "STANCE_COOLDOWN"
    NOTHING_TO_CANCEL = "NOTHING_TO_CANCEL"
    NOT_CAPITAL = "NOT_CAPITAL"
    """``recruit.location = capital``: recruiting only in the own capital (DEC-01)."""
    FEATURE_DISABLED = "FEATURE_DISABLED"
    """``BuildBarracks`` and ``UpgradeWarehouse`` without ``city_upgrades`` (DEC-26, item 1); a
    command of the other economy model (DEC-41, item 14)."""
    ALREADY_BUILT = "ALREADY_BUILT"
    """The city has its barracks already, the capital from the start (DEC-26, item 9)."""
    WAREHOUSE_MAX = "WAREHOUSE_MAX"
    """The warehouse has ``warehouse.max_level`` (DEC-26, item 9)."""
    NO_BARRACKS = "NO_BARRACKS"
    """With ``city_upgrades`` a city recruits only with the barracks (DEC-26, section 3)."""
    QUEUE_FULL = "QUEUE_FULL"
    """The recruit queue of the city holds ``recruit.queue_max`` units (DEC-25, item 6)."""
    CITY_FULL = "CITY_FULL"
    """The owner's units standing in the city plus its recruit queue fill the capacity
    (DEC-25, item 7)."""
    NOT_SOURCE = "NOT_SOURCE"
    """The first node of a ``DrawLine`` is neither an own factory nor the target of an own line
    (DEC-41, item 3)."""
    LINE_LIMIT = "LINE_LIMIT"
    """``lines.max_out`` lines start at the node already (DEC-41, L4)."""
    LINE_CYCLE = "LINE_CYCLE"
    """The line would close a cycle of own lines (DEC-41, L4)."""
    FACTORY_LIMIT = "FACTORY_LIMIT"
    """The player has ``factory.max`` factories, builds under way included (DEC-41, item 2)."""
    IN_FIGHT = "IN_FIGHT"
    """The group is in a fight: it only withdraws (DEC-24, item E): a defender of a node by a
    normal ``Move``, everyone else by ``CancelOrder``."""


@dataclass(frozen=True, slots=True)
class Ok:
    cost: int
    """CP charged on application, in hundredths."""
    path: tuple[int, ...] = ()
    """For ``Move`` and ``Transfer``: the nodes ``(start, ..., dest)``, returned to the client in
    ``ack``."""
    arrive_tick: int | None = None
    """For ``Transfer``: the tick the charges reach ``dst`` if nothing stops them (DEC-18). For
    ``Move``: the tick the group reaches ``dest`` if the command is applied at ``state.tick`` and
    nothing stops it (DEC-22, item 10: the client shows the travel time)."""


@dataclass(frozen=True, slots=True)
class Reject:
    code: RejectCode


@dataclass(frozen=True, slots=True)
class PlayerCommand:
    """A command as received: who sent it and its per-player sequence number."""

    player: int
    seq: int
    cmd: Command


@dataclass(frozen=True, slots=True)
class CommandResult:
    player: int
    seq: int
    tick: int
    """The tick the command was applied (or rejected) at."""
    outcome: Ok | Reject


# Validation -----------------------------------------------------------------------------------


def command_cost(rules: Ruleset, cmd: Command) -> int:
    """CP cost of a command in hundredths (``orders.cost``)."""
    cost = rules.orders.cost
    match cmd:
        case Move(planned=planned):
            return cost.planned_move if planned else cost.move
        case Split():
            return cost.split
        case Merge():
            return cost.merge
        case SetMode(mode=mode):
            match mode:
                case Mode.ATTACK:
                    return cost.attack
                case Mode.DEFENSE:
                    return cost.defense
        case UpgradeRoad():
            return cost.build
        case BuildBarracks():
            return cost.barracks
        case UpgradeWarehouse():
            return cost.warehouse
        case Recruit():
            return cost.recruit
        case CancelRecruit():
            return 0  # free, the refund is paid on application (DEC-25, item 11)
        case CancelOrder():
            return cost.cancel
        case SetStance():
            return cost.stance
        case SetFront():
            return cost.front
        case SetRearMin():
            return cost.rear_min
        case Transfer():
            return cost.transfer
        case BuildFactory() | DrawLine() | RemoveLine():
            return 0  # paid in charges or free (DEC-41, items 2 and 3)
        case Forfeit():
            return 0


def validate(state: GameState, rules: Ruleset, player: int, cmd: Command) -> Ok | Reject:
    """Whether ``cmd`` of ``player`` can be applied to ``state`` now. Does not change the state.

    Takes ``rules`` besides the ``(state, player, cmd)`` of AGENTS.md: the costs live there.
    """
    return _validate(state, rules, player, cmd, _visible_enemy_groups(state, rules, player))


def _visible_enemy_groups(state: GameState, rules: Ruleset, player: int) -> dict[int, bool]:
    levels = compute_vision(state, rules, player)
    groups = state.groups
    return {
        gid: True
        for gid in sorted(groups)
        if groups[gid].owner != player and is_visible(state, rules, player, groups[gid], levels)
    }


def _validate(
    state: GameState, rules: Ruleset, player: int, cmd: Command, seen: dict[int, bool]
) -> Ok | Reject:
    checked = _check(state, rules, player, cmd, seen)
    if isinstance(checked, Reject):
        return checked
    cost = command_cost(rules, cmd)
    if cost > state.players[player].cp:
        return Reject(RejectCode.NOT_ENOUGH_CP)
    if isinstance(checked, TransferRoute):
        assert isinstance(cmd, Transfer)
        n = _transfer_charges(state, rules, player, cmd)
        arrive = transfer_arrive_tick(state, rules, checked, n)
        return Ok(cost=cost, path=checked.nodes, arrive_tick=arrive)
    if isinstance(cmd, Move):
        # The first step is made in the tick of the order (or of the departure): tick + T - 1.
        delay = rules.orders.planned_delay_ticks if cmd.planned else 0
        arrive = state.tick + delay + path_ticks(state, rules, checked) - 1
        return Ok(cost=cost, path=checked, arrive_tick=arrive)
    return Ok(cost=cost, path=checked)


def _check(
    state: GameState, rules: Ruleset, player: int, cmd: Command, seen: dict[int, bool]
) -> tuple[int, ...] | TransferRoute | Reject:
    """Every rule except CP; returns the path for ``Move``, the route for ``Transfer`` (empty
    for the rest) or a Reject."""
    if _other_model(rules, cmd):
        return Reject(RejectCode.FEATURE_DISABLED)  # DEC-41, items 5 and 14
    match cmd:
        case Move(group=gid, dest=dest, planned=planned):
            group = _standing_group(state, player, gid, seen)
            if isinstance(group, Reject):
                return group
            if group.fight is not None and (planned or not _defends(state, group)):
                return Reject(RejectCode.IN_FIGHT)  # DEC-24, E1 and E4
            if not 0 <= dest < len(state.map.nodes):
                return Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
            start = _node_of(group)
            if dest == start:
                return Reject(RejectCode.INVALID_ARGUMENT)
            path = find_path(state, rules, player, start, dest, size=group.units)
            if path is not None:
                return path
            if find_path(state, rules, player, start, dest) is not None:
                return Reject(RejectCode.STACK_LIMIT)  # DEC-20, D2
            return Reject(RejectCode.NO_PATH)
        case Split(group=gid, n=n):
            group = _standing_group(state, player, gid, seen)
            if isinstance(group, Reject):
                return group
            if group.fight is not None:
                return Reject(RejectCode.IN_FIGHT)
            if not 1 <= n < group.units:
                return Reject(RejectCode.INVALID_ARGUMENT)
            return ()
        case Merge(groups=gids):
            if len(gids) < 2 or len(dict.fromkeys(gids)) != len(gids):
                return Reject(RejectCode.INVALID_ARGUMENT)
            nodes: list[int] = []
            for gid in gids:
                group = _standing_group(state, player, gid, seen)
                if isinstance(group, Reject):
                    return group
                if group.fight is not None:
                    return Reject(RejectCode.IN_FIGHT)
                if group.order is not None:
                    # A move order has not departed yet (an ordinary one: same tick as its
                    # ``Move``); merging would change the size the stack limit was checked for.
                    return Reject(RejectCode.GROUP_BUSY)  # DEC-20, D3
                nodes.append(_node_of(group))
            if any(node != nodes[0] for node in nodes):
                return Reject(RejectCode.NOT_SAME_NODE)
            return ()
        case SetMode(group=gid, mode=mode):
            group = _standing_group(state, player, gid, seen)
            if isinstance(group, Reject):
                return group
            if group.fight is not None:
                return Reject(RejectCode.IN_FIGHT)
            # "Defense" again while in it would only reset what it gathered (DEC-30): after a
            # fight it gathers anew by itself; switching it on after leaving it costs again.
            if mode == group.mode:
                return Reject(RejectCode.NO_CHANGE)
            return ()
        case UpgradeRoad(edge=eid):
            return _check_upgrade(state, player, eid)
        case BuildBarracks(node=node):
            return _check_city_build(state, rules, player, node, BuildKind.BARRACKS)
        case UpgradeWarehouse(node=node):
            return _check_city_build(state, rules, player, node, BuildKind.WAREHOUSE)
        case Recruit(node=node):
            # DEC-25, item 11: the checks in this order (CP last, in ``_validate``). A fight in
            # the city does not reject: it only pauses the production (item 9).
            if not 0 <= node < len(state.map.nodes):
                return Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
            city = state.nodes[node]
            if city.owner != player:
                return Reject(RejectCode.NOT_OWNER)
            if not is_city(state.map, node):
                return Reject(RejectCode.NOT_CITY)
            if rules.city_upgrades.enabled:  # the barracks decides, not the location (DEC-26)
                if not city.has_barracks:
                    return Reject(RejectCode.NO_BARRACKS)
            elif not recruit_allowed_here(state, rules, player, node):
                return Reject(RejectCode.NOT_CAPITAL)
            if city.recruit_queue >= rules.recruit.queue_max:
                return Reject(RejectCode.QUEUE_FULL)
            if free_capacity(state, rules, player, node) - city.recruit_queue <= 0:
                return Reject(RejectCode.CITY_FULL)
            return ()
        case CancelRecruit(node=node):
            if not 0 <= node < len(state.map.nodes):
                return Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
            if state.nodes[node].owner != player:
                return Reject(RejectCode.NOT_OWNER)
            if state.nodes[node].recruit_queue == 0:
                return Reject(RejectCode.NOTHING_TO_CANCEL)
            return ()
        case CancelOrder(group=gid):
            group = _own_group(state, player, gid, seen)
            if isinstance(group, Reject):
                return group
            if group.fight is not None:
                return _check_cancel_in_fight(state, group)
            location = group.location
            if isinstance(location, OnEdge):
                # A bouncing group lost its order in the fight (DEC-20, C4).
                if location.back or group.order is None:
                    return Reject(RejectCode.NOTHING_TO_CANCEL)
                return ()
            if not (_waits_to_depart(state, group) or group.mode is Mode.DEFENSE):
                return Reject(RejectCode.NOTHING_TO_CANCEL)
            return ()
        case SetStance(stance=stance):
            if stance == state.players[player].stance:
                return Reject(RejectCode.NO_CHANGE)
            if stance_cooldown_left(state, rules, player) > 0:
                return Reject(RejectCode.STANCE_COOLDOWN)
            return ()
        case SetFront(marker=marker, node=node):
            return _check_front(state, player, marker, node)
        case SetRearMin(n=n):
            if not 0 <= n <= rules.supply.rear_min_max:
                return Reject(RejectCode.INVALID_ARGUMENT)
            if n == state.players[player].rear_min:
                return Reject(RejectCode.NO_CHANGE)
            return ()
        case Transfer(src=src, dst=dst, n=n):
            return _check_transfer(state, rules, player, src, dst, n)
        case BuildFactory(node=node):
            return _check_factory(state, rules, player, node)
        case DrawLine(path=path):
            return _check_line(state, rules, player, path)
        case RemoveLine(line=line):
            if line not in state.players[player].lines:
                return Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
            return ()
        case Forfeit():
            return Reject(RejectCode.NO_CHANGE) if state.players[player].forfeited else ()


def _other_model(rules: Ruleset, cmd: Command) -> bool:
    """``cmd`` belongs to the other economy model (DEC-41, items 5 and 14)."""
    if isinstance(cmd, BuildFactory | DrawLine | RemoveLine):
        return not rules.v2
    if isinstance(cmd, SetStance | SetFront | SetRearMin | Transfer | UpgradeRoad):
        return rules.v2
    return False


def _check_factory(
    state: GameState, rules: Ruleset, player: int, node: int
) -> tuple[int, ...] | Reject:
    """The checks of ``BuildFactory`` in this order (DEC-41, item 2; mechanics.md, the notes of
    #644): the node, the owner, a city, a factory or a factory build there already, the factory
    cap, the charges of the city warehouse."""
    if not 0 <= node < len(state.map.nodes):
        return Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
    city = state.nodes[node]
    if city.owner != player:
        return Reject(RejectCode.NOT_OWNER)
    if not is_city(state.map, node):
        return Reject(RejectCode.NOT_CITY)
    # TODO(#651): a factory build has no shared slot with DEC-26 and counts for the cap.
    if city.factory == player or city.factory_build is not None:
        return Reject(RejectCode.ALREADY_BUILT)
    factory = rules.factory_rules()
    if factory_count(state, player) >= factory.max:
        return Reject(RejectCode.FACTORY_LIMIT)
    if city.warehouse < factory.cost:
        return Reject(RejectCode.NOT_ENOUGH_CHARGES)
    return ()


def _check_line(
    state: GameState, rules: Ruleset, player: int, path: tuple[int, ...]
) -> tuple[int, ...] | Reject:
    """The checks of ``DrawLine`` in this order (DEC-41, items 3 and 6; mechanics.md, the notes
    of #644): the length, the nodes, their owner, a simple path along roads, a city at the end,
    the source, ``lines.max_out``, no cycle. Only own nodes are read, so nothing hidden leaks."""
    if len(path) < 2:
        return Reject(RejectCode.INVALID_ARGUMENT)
    if any(not 0 <= n < len(state.map.nodes) for n in path):
        return Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
    if any(state.nodes[n].owner != player for n in path):
        return Reject(RejectCode.NOT_OWNER)
    if len(dict.fromkeys(path)) != len(path) or line_edges(state, path) is None:
        return Reject(RejectCode.INVALID_ARGUMENT)
    source, target = path[0], path[-1]
    if not is_city(state.map, target):
        return Reject(RejectCode.NOT_CITY)
    if not is_line_source(state, player, source):
        return Reject(RejectCode.NOT_SOURCE)
    if len(lines_out(state, player, source)) >= rules.line_rules().max_out:
        return Reject(RejectCode.LINE_LIMIT)
    if creates_cycle(state, player, source, target):
        return Reject(RejectCode.LINE_CYCLE)
    return path


def _check_front(
    state: GameState, player: int, marker: int, node: int | None
) -> tuple[int, ...] | Reject:
    """The checks of ``SetFront`` in this order (CP last, in ``_validate``): the marker index,
    the node (as ``SetPriority`` of DEC-18 did), the same place, the other marker's city."""
    fronts = state.players[player].fronts
    if not 0 <= marker < len(fronts):
        return Reject(RejectCode.INVALID_ARGUMENT)
    if node is not None:
        if not 0 <= node < len(state.map.nodes):
            return Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
        if state.nodes[node].owner != player:
            return Reject(RejectCode.NOT_OWNER)
        if not is_city(state.map, node):
            return Reject(RejectCode.NOT_CITY)
    if fronts[marker] == node:
        return Reject(RejectCode.NO_CHANGE)
    if node is not None and node in fronts:
        return Reject(RejectCode.INVALID_ARGUMENT)  # one marker per city (DEC-28, example 8)
    return ()


def _defends(state: GameState, group: Group) -> bool:
    """The group stands in an own node: in a fight there it defends the node (DEC-24, E1)."""
    location = group.location
    return isinstance(location, AtNode) and state.nodes[location.node].owner == group.owner


def _member(state: GameState, group: Group) -> FightMember:
    assert group.fight is not None
    return state.fights[group.fight].members[group.id]


def _check_cancel_in_fight(state: GameState, group: Group) -> tuple[int, ...] | Reject:
    """``CancelOrder`` of a group in a fight (DEC-24, E): the withdrawal of an attacker of a node
    or of a group on an edge; for a defender of a node, the cancel of its withdrawal ``Move`` or
    of its waiting planned order. A returning group has no order (E2), "Defense" is a mode (E4)."""
    member = _member(state, group)
    location = group.location
    if _defends(state, group):
        if group.order is not None:
            return ()
        if group.mode is Mode.DEFENSE:
            return Reject(RejectCode.IN_FIGHT)
        return Reject(RejectCode.NOTHING_TO_CANCEL)
    if member.leaving or member.returning:
        return Reject(RejectCode.NOTHING_TO_CANCEL)
    if isinstance(location, OnEdge):
        if location.back or group.order is None:
            return Reject(RejectCode.NOTHING_TO_CANCEL)
        return ()
    if member.edge is None:
        return Reject(RejectCode.NOTHING_TO_CANCEL)
    return ()


def _check_transfer(
    state: GameState, rules: Ruleset, player: int, src: int, dst: int, n: int
) -> TransferRoute | Reject:
    """The checks of ``Transfer`` in the order of DEC-18, item 6 (CP last, in ``_validate``)."""
    size = len(state.map.nodes)
    for node in (src, dst):
        if not 0 <= node < size:
            return Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
        if state.nodes[node].owner != player:
            return Reject(RejectCode.NOT_OWNER)
    if not (is_city(state.map, src) and is_city(state.map, dst)):
        return Reject(RejectCode.NOT_CITY)
    if src == dst or n < 1:
        return Reject(RejectCode.INVALID_ARGUMENT)
    route = transfer_route(state, rules, player, src, dst)
    if route is None:
        return Reject(RejectCode.NO_PATH)
    if state.nodes[src].warehouse < n:
        return Reject(RejectCode.NOT_ENOUGH_CHARGES)
    if warehouse_room(state, rules, player, dst) == 0:
        return Reject(RejectCode.TARGET_FULL)
    return route


def _transfer_charges(state: GameState, rules: Ruleset, player: int, cmd: Transfer) -> int:
    """The charges a valid ``Transfer`` ships: ``n`` cut to the free room of the target (#287)."""
    return min(cmd.n, warehouse_room(state, rules, player, cmd.dst))


def _check_city_build(
    state: GameState, rules: Ruleset, player: int, node: int, kind: BuildKind
) -> tuple[int, ...] | Reject:
    """The checks of ``BuildBarracks`` and ``UpgradeWarehouse`` in the order of DEC-26, item 9
    (CP last, in ``_validate``). Neither needs supplied territory (item 8)."""
    if not rules.city_upgrades.enabled:
        return Reject(RejectCode.FEATURE_DISABLED)
    if not 0 <= node < len(state.map.nodes):
        return Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
    city = state.nodes[node]
    if city.owner != player:
        return Reject(RejectCode.NOT_OWNER)
    if not is_city(state.map, node):
        return Reject(RejectCode.NOT_CITY)
    if kind is BuildKind.BARRACKS and city.has_barracks:
        return Reject(RejectCode.ALREADY_BUILT)
    if kind is BuildKind.WAREHOUSE and city.warehouse_level >= rules.warehouse.max_level:
        return Reject(RejectCode.WAREHOUSE_MAX)
    if city.build is not None:
        return Reject(RejectCode.CITY_BUSY)
    return ()


def _check_upgrade(state: GameState, player: int, eid: int) -> tuple[int, ...] | Reject:
    """The checks of ``UpgradeRoad(edge)`` in the order of DEC-28, item 7 (CP last, in
    ``_validate``): no edge or an edge in fog, not internal for the player, the last level, a
    build on it already. An own internal edge always counts as known (own data, DEC-35, detail 5),
    so the answer reveals nothing. Builds are not limited otherwise; no city takes part."""
    if not 0 <= eid < len(state.map.edges):
        return Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
    own = own_internal(state, player, eid)
    if not own and edge_detail_level(state, player, eid) is Detail.FOG:
        return Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
    if not own:
        return Reject(RejectCode.NOT_INTERNAL)
    road = state.edges[eid]
    if road.width >= state.map.edges[eid].max_level:
        return Reject(RejectCode.MAX_WIDTH)
    if road.build is not None:
        return Reject(RejectCode.EDGE_BUSY)
    return ()


def _own_group(state: GameState, player: int, gid: int, seen: dict[int, bool]) -> Group | Reject:
    group = state.groups.get(gid)
    if group is not None and group.owner == player:
        return group
    if gid in seen:
        return Reject(RejectCode.NOT_OWNER)
    return Reject(RejectCode.NOT_FOUND_OR_HIDDEN)


def _standing_group(
    state: GameState, player: int, gid: int, seen: dict[int, bool]
) -> Group | Reject:
    """An own group standing in a node and not waiting to depart on a planned order (#117)."""
    group = _own_group(state, player, gid, seen)
    if isinstance(group, Reject):
        return group
    if not isinstance(group.location, AtNode):
        return Reject(RejectCode.GROUP_ON_EDGE)
    if _waits_to_depart(state, group):
        return Reject(RejectCode.GROUP_BUSY)
    return group


def _set_leaving(state: GameState, group: Group, *, leaving: bool) -> None:
    assert group.fight is not None
    members = state.fights[group.fight].members
    members[group.id] = replace(members[group.id], leaving=leaving)


def _waits_to_depart(state: GameState, group: Group) -> bool:
    order = group.order
    return order is not None and order.planned and state.tick < order.depart_tick


def _node_of(group: Group) -> int:
    assert isinstance(group.location, AtNode)  # checked by _standing_group
    return group.location.node


# Application ----------------------------------------------------------------------------------


def apply_commands(
    state: GameState, rules: Ruleset, commands: Iterable[PlayerCommand]
) -> tuple[list[CommandResult], list[Event]]:
    """Validate and apply the commands at the start of tick ``state.tick``.

    Commands run in ``(player, seq)`` order whatever order they arrived in; each is validated on
    the state left by the same player's earlier commands. A ``(player, seq)`` pair must not repeat
    (the server deduplicates by ``seq``). Returns one result per command, in that order, and the
    events of the applied commands.
    """
    ordered = sorted(commands, key=lambda c: (c.player, c.seq))
    for prev, cur in pairwise(ordered):
        if (prev.player, prev.seq) == (cur.player, cur.seq):
            raise ValueError(f"duplicate command seq {cur.seq} of player {cur.player}")
    if not ordered:
        return [], []
    # Enemy visibility is fixed at the start of the tick: the other player's commands of this
    # tick cannot change the reject code of this player's commands.
    seen = {p: _visible_enemy_groups(state, rules, p) for p in sorted(state.players)}
    results: list[CommandResult] = []
    events: list[Event] = []
    for pc in ordered:
        outcome = _validate(state, rules, pc.player, pc.cmd, seen[pc.player])
        if isinstance(outcome, Ok):
            state.players[pc.player].cp -= outcome.cost
            events.extend(_apply(state, rules, pc.player, pc.cmd, outcome))
        results.append(CommandResult(pc.player, pc.seq, state.tick, outcome))
    return results, events


def _apply(state: GameState, rules: Ruleset, player: int, cmd: Command, ok: Ok) -> list[Event]:
    tick = state.tick
    match cmd:
        case Move(group=gid, planned=planned):
            group = state.groups[gid]
            delay = rules.orders.planned_delay_ticks if planned else 0
            group.order = Order(path=ok.path[1:], planned=planned, depart_tick=tick + delay)
            if group.mode is Mode.DEFENSE:
                group.mode = Mode.ATTACK  # a move order drops "Defense" for free (DEC-08)
                group.ticks_in_defense = 0  # with what it gathered (DEC-30)
            if group.fight is not None:  # a defender withdraws after the next round (DEC-24)
                _set_leaving(state, group, leaving=True)
            if planned:  # public intent now, the bonus from the departure on (DEC-08)
                # DEC-29: per edge of the path chosen now; ``movement`` caps it by the charged
                # units in the tick the group departs.
                group.bonus = (len(ok.path) - 1) * rules.orders.planned_bonus_per_edge
                group.bonus_tick = tick + delay
                set_intent(state, group, IntentKind.PLANNED_MOVE, ok.path[-1])
            else:
                clear_bonus(group)
                set_intent(state, group, None)
            return []
        case Split(group=gid, n=n):
            group = state.groups[gid]
            charged = min(n, group.charged)  # charged units go first (#117)
            group.units -= n
            group.charged -= charged
            new = state.new_id()
            state.groups[new] = Group(new, player, n, charged, Mode.ATTACK, group.location)
            return [event(tick, "group_split", player=player, group=gid, new_group=new, units=n)]
        case Merge(groups=gids):
            # The smallest id keeps its mode, "Defense" with its bonus and intent (DEC-20, B2).
            keep = state.groups[min(gids)]
            for gid in sorted(gids):
                if gid != keep.id:
                    absorb(state, keep, gid)
            return [event(tick, "groups_merged", player=player, group=keep.id, units=keep.units)]
        case SetMode(group=gid, mode=mode):
            group = state.groups[gid]
            group.mode = mode
            group.order = None  # the group stops where it stands
            group.ticks_in_defense = 0  # "Defense" gathers its bonus from now on (DEC-30)
            clear_bonus(group)
            # "Defense" is public at once (DEC-08); its bonus grows in ``systems.orders``.
            set_intent(state, group, IntentKind.DEFENSE if mode is Mode.DEFENSE else None)
            return []
        case UpgradeRoad(edge=eid):
            return [start_road(state, player, eid)]  # not public (DEC-16, DEC-28)
        case BuildBarracks(node=node):
            return [start_city_build(state, player, node, BuildKind.BARRACKS)]
        case UpgradeWarehouse(node=node):
            return [start_city_build(state, player, node, BuildKind.WAREHOUSE)]
        case Recruit(node=node):
            queue_unit(state, node)
            return []
        case CancelRecruit(node=node):
            return cancel_unit(state, rules, player, node)
        case CancelOrder(group=gid):
            group = state.groups[gid]
            location = group.location
            if group.fight is not None:
                # DEC-24, E: a defender's withdrawal or waiting order is cancelled, it stays in
                # the fight; anyone else withdraws after the next round.
                if _defends(state, group):
                    group.order = None
                    _set_leaving(state, group, leaving=False)
                else:
                    _set_leaving(state, group, leaving=True)
                clear_bonus(group)
                set_intent(state, group, None)
                return []
            if isinstance(location, OnEdge):
                # Back to the start of this edge, as long as the way travelled (DEC-20, C2): the
                # mechanics of a bounce, without spending charges.
                group.location = OnEdge(
                    location.edge, location.from_node, location.progress, True, location.level
                )
                group.order = None
            elif _waits_to_depart(state, group):
                group.order = None
            else:
                group.mode = Mode.ATTACK  # "Defense" (validated)
                group.ticks_in_defense = 0
            clear_bonus(group)
            set_intent(state, group, None)
            return []
        case SetStance(stance=stance):
            return set_stance(state, player, stance)
        case SetFront(marker=marker, node=node):
            ps = state.players[player]
            ps.fronts = tuple(node if i == marker else f for i, f in enumerate(ps.fronts))
            return [
                event(tick, "front_set", player=player, marker=marker, node=node, reason="command")
            ]
        case SetRearMin(n=n):
            state.players[player].rear_min = n
            return [event(tick, "rear_min_set", player=player, n=n)]
        case Transfer(src=src, dst=dst):
            route = transfer_route(state, rules, player, src, dst)
            assert route is not None  # validated just before, on this state
            n = _transfer_charges(state, rules, player, cmd)
            arrive = transfer_arrive_tick(state, rules, route, n)
            state.nodes[src].warehouse -= n
            packets = send_transfer(state, rules, player, route, n)
            return [
                event(
                    tick,
                    "transfer_started",
                    packet=packets[0].id,
                    player=player,
                    from_node=src,
                    to_node=dst,
                    charges=n,
                    arrive_tick=arrive,
                )
            ]
        case BuildFactory(node=node):
            return [start_factory(state, rules, player, node)]
        case DrawLine(path=path):
            ps = state.players[player]
            ps.lines[ps.next_line] = Line(ps.next_line, path)
            ps.next_line += 1
            return []
        case RemoveLine(line=line):
            del state.players[player].lines[line]
            return []
        case Forfeit():
            state.players[player].forfeited = True
            return [event(tick, "forfeit", player=player)]
