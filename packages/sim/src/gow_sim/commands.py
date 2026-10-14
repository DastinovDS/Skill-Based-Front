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
Bonuses and public intents of planned orders and «Защита»: ``systems.orders`` (SIM-10).
Road upgrades by a city (DEC-16): ``systems.build``; they are not public.
Supply priority and one-off transfers (DEC-18): ``SetPriority`` and ``Transfer``; neither is
public, a transfer leaves as a packet in the tick it is applied (``systems.supply``).
"""

from collections.abc import Callable, Iterable
from dataclasses import dataclass, replace
from enum import StrEnum
from itertools import pairwise

from gow_sim.maps import NodeKind
from gow_sim.ruleset import Ruleset, Stance
from gow_sim.state import (
    AtNode,
    Event,
    FightMember,
    GameState,
    Group,
    IntentKind,
    Mode,
    OnEdge,
    Order,
    Priority,
    RoadKind,
    event,
)
from gow_sim.systems.build import builder_of, level_price, start_build
from gow_sim.systems.capacity import is_internal, supplied_territory
from gow_sim.systems.economy import set_stance, stance_cooldown_left
from gow_sim.systems.movement import find_path, path_ticks
from gow_sim.systems.orders import absorb, clear_bonus, set_intent
from gow_sim.systems.recruit import (
    free_capacity,
    recruit_allowed_here,
    recruit_cooldown_left,
    recruit_unit,
)
from gow_sim.systems.supply import TransferRoute, is_city, send_packet, transfer_route
from gow_sim.systems.vision import compute_vision, is_visible

__all__ = [
    "CancelOrder",
    "Command",
    "CommandResult",
    "Forfeit",
    "Merge",
    "Mode",
    "Move",
    "Ok",
    "PlayerCommand",
    "Priority",
    "Recruit",
    "Reject",
    "RejectCode",
    "SetMode",
    "SetPriority",
    "SetStance",
    "Split",
    "Stance",
    "Transfer",
    "UpgradeRoad",
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
    its mode and «Защита» with the bonus (DEC-20, B2)."""

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
    """The own city ``node`` raises the internal ``edge`` at it by one level (DEC-16, DEC-22).

    ``kind``: the road type, required for the first upgrade (``FAST`` or ``FREIGHT``); for the
    second it may be omitted or must equal the road's type.
    """

    node: int
    edge: int
    kind: RoadKind | None = None


@dataclass(frozen=True, slots=True)
class Recruit:
    node: int


@dataclass(frozen=True, slots=True)
class CancelOrder:
    """Cancel any order of ``group`` (DEC-20, C): a planned order while it waits to depart, a move
    order on an edge (the group turns back to the start of the current edge, ``OnEdge.back``),
    or «Защита» (the same as ``SetMode(ATTACK)``)."""

    group: int


@dataclass(frozen=True, slots=True)
class SetPriority:
    """Supply priority ``level`` of the own city ``node`` (DEC-18, item 1)."""

    node: int
    level: Priority


@dataclass(frozen=True, slots=True)
class Transfer:
    """Ship ``n`` charges from the warehouse of the own city ``src`` to the own city ``dst``
    along own internal roads, once (DEC-18, item 6). ``from``/``to`` of the decision."""

    src: int
    dst: int
    n: int


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
    | Recruit
    | CancelOrder
    | SetPriority
    | Transfer
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
        case SetStance() | UpgradeRoad() | Recruit() | SetPriority() | Transfer() | Forfeit():
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
    """Malformed arguments: ``n`` out of range, fewer than two or repeated groups, same node; no
    road type for the first road upgrade (DEC-22)."""
    NOT_SAME_NODE = "NOT_SAME_NODE"
    NOT_ADJACENT = "NOT_ADJACENT"
    """The city is not an end of the edge (``UpgradeRoad``, DEC-16)."""
    NOT_INTERNAL = "NOT_INTERNAL"
    """Only an internal edge of the player can be upgraded (mechanics.md, section 8)."""
    MAX_WIDTH = "MAX_WIDTH"
    """The road already has ``max_width`` (its last level, DEC-22)."""
    ROAD_KIND_MISMATCH = "ROAD_KIND_MISMATCH"
    """The second road upgrade names the other road type (DEC-22, item 3)."""
    NOT_CITY = "NOT_CITY"
    """The node is a province, not a city (DEC-22, item 3; DEC-18, items 1 and 6; DEC-23)."""
    NOT_SUPPLIED = "NOT_SUPPLIED"
    """The city is not in its owner's supplied territory (DEC-16)."""
    CITY_BUSY = "CITY_BUSY"
    """The city already builds a road (DEC-16: one build per city)."""
    EDGE_BUSY = "EDGE_BUSY"
    """The other end of the edge already builds it (DEC-16: one city per edge)."""
    NOT_ENOUGH_CHARGES = "NOT_ENOUGH_CHARGES"
    """The city warehouse holds fewer charges than the level costs (DEC-16) or than a transfer
    ships (DEC-18)."""
    NO_CHANGE = "NO_CHANGE"
    """The command would leave everything as it is (same mode or stance; already forfeited)."""
    STANCE_COOLDOWN = "STANCE_COOLDOWN"
    NOTHING_TO_CANCEL = "NOTHING_TO_CANCEL"
    NOT_CAPITAL = "NOT_CAPITAL"
    """``recruit.location = capital``: recruiting only in the own capital (DEC-01)."""
    CITY_FULL = "CITY_FULL"
    """No free capacity for one more unit in the city (DEC-01)."""
    RECRUIT_COOLDOWN = "RECRUIT_COOLDOWN"
    """The city recruited less than ``recruit.cooldown_ticks`` ago (DEC-01)."""
    IN_FIGHT = "IN_FIGHT"
    """The group is in a fight: it only withdraws (DEC-24, item E): a defender of a node by a
    normal ``Move``, everyone else by ``CancelOrder``. Also a recruit in a city with a fight
    (DEC-25, item 9)."""


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
        case Recruit():
            return cost.recruit
        case CancelOrder():
            return cost.cancel
        case SetStance():
            return cost.stance
        case SetPriority():
            return cost.priority
        case Transfer():
            return cost.transfer
        case Forfeit():
            return 0


def validate(state: GameState, rules: Ruleset, player: int, cmd: Command) -> Ok | Reject:
    """Whether ``cmd`` of ``player`` can be applied to ``state`` now. Does not change the state.

    Takes ``rules`` besides the ``(state, player, cmd)`` of AGENTS.md: the costs live there.
    """
    return _validate(state, rules, player, cmd, _visible_enemy_groups(state, player))


def _visible_enemy_groups(state: GameState, player: int) -> dict[int, bool]:
    levels = compute_vision(state, player)
    groups = state.groups
    return {
        gid: True
        for gid in sorted(groups)
        if groups[gid].owner != player and is_visible(state, player, groups[gid], levels)
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
        return Ok(cost=cost, path=checked.nodes, arrive_tick=state.tick + checked.total_ticks)
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
            # Re-enabling «Защита» is allowed and costs again (DEC-08): a new bonus and intent.
            if mode == group.mode and mode is not Mode.DEFENSE:
                return Reject(RejectCode.NO_CHANGE)
            return ()
        case UpgradeRoad(node=node, edge=eid, kind=kind):
            return _check_upgrade(state, rules, player, node, eid, kind)
        case Recruit(node=node):
            if not 0 <= node < len(state.map.nodes):
                return Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
            if state.nodes[node].owner != player:
                return Reject(RejectCode.NOT_OWNER)
            if not recruit_allowed_here(state, rules, player, node):
                return Reject(RejectCode.NOT_CAPITAL)
            if free_capacity(state, rules, player, node) <= 0:
                return Reject(RejectCode.CITY_FULL)
            if recruit_cooldown_left(state, rules, node) > 0:
                return Reject(RejectCode.RECRUIT_COOLDOWN)
            if node in state.fight_nodes():
                return Reject(RejectCode.IN_FIGHT)  # no production in a city with a fight
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
        case SetPriority(node=node, level=level):
            # DEC-18, item 1: the checks in this order (CP last, in ``_validate``).
            if not 0 <= node < len(state.map.nodes):
                return Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
            if state.nodes[node].owner != player:
                return Reject(RejectCode.NOT_OWNER)
            if not is_city(state.map, node):
                return Reject(RejectCode.NOT_CITY)
            if state.nodes[node].priority is level:
                return Reject(RejectCode.NO_CHANGE)
            return ()
        case Transfer(src=src, dst=dst, n=n):
            return _check_transfer(state, rules, player, src, dst, n)
        case Forfeit():
            return Reject(RejectCode.NO_CHANGE) if state.players[player].forfeited else ()


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
    of its waiting planned order. A returning group has no order (E2), «Защита» is a mode (E4)."""
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
    route = transfer_route(state, rules, player, src, dst, n)
    if route is None:
        return Reject(RejectCode.NO_PATH)
    if state.nodes[src].warehouse < n:
        return Reject(RejectCode.NOT_ENOUGH_CHARGES)
    return route


def _check_upgrade(
    state: GameState, rules: Ruleset, player: int, node: int, eid: int, kind: RoadKind | None
) -> tuple[int, ...] | Reject:
    """The checks of ``UpgradeRoad`` in the order of DEC-16, item 2 with the changes of DEC-22,
    item 3 (CP last, in ``_validate``)."""
    if not 0 <= node < len(state.map.nodes):
        return Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
    if state.nodes[node].owner != player:
        return Reject(RejectCode.NOT_OWNER)
    if state.map.nodes[node].kind is NodeKind.PROVINCE:
        return Reject(RejectCode.NOT_CITY)
    if not 0 <= eid < len(state.map.edges):
        return Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
    edge = state.map.edges[eid]
    if node not in (edge.a, edge.b):
        return Reject(RejectCode.NOT_ADJACENT)
    if not is_internal(state, eid):  # the node is own, so an internal edge is the player's
        return Reject(RejectCode.NOT_INTERNAL)
    road = state.edges[eid]
    if road.width >= edge.max_width:
        return Reject(RejectCode.MAX_WIDTH)
    if road.kind is RoadKind.NONE:
        if kind not in (RoadKind.FAST, RoadKind.FREIGHT):
            return Reject(RejectCode.INVALID_ARGUMENT)
    elif kind is not None and kind is not road.kind:
        return Reject(RejectCode.ROAD_KIND_MISMATCH)
    if not supplied_territory(state, player)[node]:
        return Reject(RejectCode.NOT_SUPPLIED)
    if state.nodes[node].build is not None:
        return Reject(RejectCode.CITY_BUSY)
    if builder_of(state, eid) is not None:
        return Reject(RejectCode.EDGE_BUSY)
    if state.nodes[node].warehouse < level_price(state, rules, eid):
        return Reject(RejectCode.NOT_ENOUGH_CHARGES)
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
    seen = {p: _visible_enemy_groups(state, p) for p in sorted(state.players)}
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
                group.mode = Mode.ATTACK  # a move order drops «Защита» for free (DEC-08)
            if group.fight is not None:  # a defender withdraws after the next round (DEC-24)
                _set_leaving(state, group, leaving=True)
            if planned:  # public intent now, the bonus from the departure on (DEC-08)
                group.bonus = rules.orders.planned_bonus
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
            # The smallest id keeps its mode, «Защита» with its bonus and intent (DEC-20, B2).
            keep = state.groups[min(gids)]
            for gid in sorted(gids):
                if gid != keep.id:
                    absorb(state, keep, gid)
            return [event(tick, "groups_merged", player=player, group=keep.id, units=keep.units)]
        case SetMode(group=gid, mode=mode):
            group = state.groups[gid]
            group.mode = mode
            group.order = None  # the group stops where it stands
            if mode is Mode.DEFENSE:  # public at once, the bonus after the delay (DEC-08)
                group.bonus = rules.orders.defense_bonus
                group.bonus_tick = tick + rules.orders.defense_delay_ticks
                set_intent(state, group, IntentKind.DEFENSE)
            else:
                clear_bonus(group)
                set_intent(state, group, None)
            return []
        case UpgradeRoad(node=node, edge=eid, kind=kind):
            return [start_build(state, rules, player, node, eid, kind)]  # not public (DEC-16)
        case Recruit(node=node):
            return recruit_unit(state, player, node)
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
                group.location = OnEdge(location.edge, location.from_node, location.progress, True)
                group.order = None
            elif _waits_to_depart(state, group):
                group.order = None
            else:
                group.mode = Mode.ATTACK  # «Защита» (validated)
            clear_bonus(group)
            set_intent(state, group, None)
            return []
        case SetStance(stance=stance):
            return set_stance(state, player, stance)
        case SetPriority(node=node, level=level):
            state.nodes[node].priority = level
            return [event(tick, "priority_set", player=player, node=node, level=level.value)]
        case Transfer(src=src, dst=dst, n=n):
            route = transfer_route(state, rules, player, src, dst, n)
            assert route is not None  # validated just before, on this state
            state.nodes[src].warehouse -= n
            packet = send_packet(state, player, src, route.edges, route.ticks, n, transfer=True)
            return [
                event(
                    tick,
                    "transfer_started",
                    packet=packet.id,
                    player=player,
                    from_node=src,
                    to_node=dst,
                    charges=n,
                    arrive_tick=tick + route.total_ticks,
                )
            ]
        case Forfeit():
            state.players[player].forfeited = True
            return [event(tick, "forfeit", player=player)]
