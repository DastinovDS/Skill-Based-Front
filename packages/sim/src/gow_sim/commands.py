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
``resolve(state, player, cmd)`` of SIM-14 (#30) with ``map_group_ids()``; an id that resolves to
nothing may be mapped to any id absent from the state (for example ``-1``), which ``validate()``
rejects as ``NOT_FOUND_OR_HIDDEN``.

Costs are in hundredths of CP from ``orders.cost`` (DEC-08, DEC-01, DEC-02).
Split, Merge and commands to a moving or waiting group follow the defaults of #117.
Bonuses and public intents of planned orders, «Защита» and builds: ``systems.orders`` (SIM-10).
"""

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from enum import StrEnum
from itertools import pairwise

from gow_sim.ruleset import Ruleset, Stance
from gow_sim.state import AtNode, Event, GameState, Group, IntentKind, Mode, Order, event
from gow_sim.systems.build import interrupt_build, start_build
from gow_sim.systems.capacity import is_internal
from gow_sim.systems.economy import set_stance, stance_cooldown_left
from gow_sim.systems.movement import find_path
from gow_sim.systems.orders import clear_bonus, set_intent
from gow_sim.systems.recruit import (
    free_capacity,
    recruit_allowed_here,
    recruit_cooldown_left,
    recruit_unit,
)
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
    "Recruit",
    "Reject",
    "RejectCode",
    "SetMode",
    "SetStance",
    "Split",
    "Stance",
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
    """Split ``n`` units off ``group`` into a new group (#117)."""

    group: int
    n: int


@dataclass(frozen=True, slots=True)
class Merge:
    """Merge two or more groups standing in one node into the one with the smallest id (#117)."""

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
    """Put ``group`` into «Строительство» on the internal ``edge`` it stands at (SIM-11)."""

    group: int
    edge: int


@dataclass(frozen=True, slots=True)
class Recruit:
    node: int


@dataclass(frozen=True, slots=True)
class CancelOrder:
    """Cancel the planned order of ``group`` while it waits to depart, or its «Защита» (DEC-08).

    TODO(#141): cancelling «Защита» costs ``orders.cost.cancel``, ``SetMode(ATTACK)`` is free.
    """

    group: int


@dataclass(frozen=True, slots=True)
class Forfeit:
    pass


type Command = (
    Move | Split | Merge | SetMode | SetStance | UpgradeRoad | Recruit | CancelOrder | Forfeit
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
        case UpgradeRoad(group=g, edge=edge):
            return UpgradeRoad(f(g), edge)
        case CancelOrder(group=g):
            return CancelOrder(f(g))
        case SetStance() | Recruit() | Forfeit():
            return cmd


# Results --------------------------------------------------------------------------------------


class RejectCode(StrEnum):
    NOT_FOUND_OR_HIDDEN = "NOT_FOUND_OR_HIDDEN"
    """The entity does not exist or the player does not see it: one code for both."""
    NOT_OWNER = "NOT_OWNER"
    """A visible group or a node of another player (or a neutral node)."""
    NOT_ENOUGH_CP = "NOT_ENOUGH_CP"
    GROUP_ON_EDGE = "GROUP_ON_EDGE"
    """Groups take commands only while standing in a node (#117)."""
    GROUP_BUSY = "GROUP_BUSY"
    """The group waits to depart on a planned order; only ``CancelOrder`` is accepted (#117)."""
    NO_PATH = "NO_PATH"
    INVALID_ARGUMENT = "INVALID_ARGUMENT"
    """Malformed arguments: ``n`` out of range, fewer than two or repeated groups, same node."""
    NOT_SAME_NODE = "NOT_SAME_NODE"
    NOT_ADJACENT = "NOT_ADJACENT"
    """The group does not stand at an end of the edge."""
    NOT_INTERNAL = "NOT_INTERNAL"
    """Only an internal edge of the player can be upgraded (mechanics.md, section 8)."""
    MAX_WIDTH = "MAX_WIDTH"
    NO_CHANGE = "NO_CHANGE"
    """The command would leave everything as it is (same mode, stance, road; already forfeited)."""
    STANCE_COOLDOWN = "STANCE_COOLDOWN"
    NOTHING_TO_CANCEL = "NOTHING_TO_CANCEL"
    NOT_CAPITAL = "NOT_CAPITAL"
    """``recruit.location = capital``: recruiting only in the own capital (DEC-01)."""
    CITY_FULL = "CITY_FULL"
    """No free capacity for one more unit in the city (DEC-01)."""
    RECRUIT_COOLDOWN = "RECRUIT_COOLDOWN"
    """The city recruited less than ``recruit.cooldown_ticks`` ago (DEC-01)."""


@dataclass(frozen=True, slots=True)
class Ok:
    cost: int
    """CP charged on application, in hundredths."""
    path: tuple[int, ...] = ()
    """For ``Move``: the nodes ``(start, ..., dest)``, returned to the client in ``ack``."""


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
                case Mode.BUILD:
                    return cost.build
        case UpgradeRoad():
            return cost.build
        case Recruit():
            return cost.recruit
        case CancelOrder():
            return cost.cancel
        case SetStance():
            return cost.stance
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
    return Ok(cost=cost, path=checked)


def _check(
    state: GameState, rules: Ruleset, player: int, cmd: Command, seen: dict[int, bool]
) -> tuple[int, ...] | Reject:
    """Every rule except CP; returns the path for ``Move`` (empty for the rest) or a Reject."""
    match cmd:
        case Move(group=gid, dest=dest):
            group = _standing_group(state, player, gid, seen)
            if isinstance(group, Reject):
                return group
            if not 0 <= dest < len(state.map.nodes):
                return Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
            start = _node_of(group)
            if dest == start:
                return Reject(RejectCode.INVALID_ARGUMENT)
            path = find_path(state, rules, player, start, dest)
            return Reject(RejectCode.NO_PATH) if path is None else path
        case Split(group=gid, n=n):
            group = _standing_group(state, player, gid, seen)
            if isinstance(group, Reject):
                return group
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
                nodes.append(_node_of(group))
            if any(node != nodes[0] for node in nodes):
                return Reject(RejectCode.NOT_SAME_NODE)
            return ()
        case SetMode(group=gid, mode=mode):
            group = _standing_group(state, player, gid, seen)
            if isinstance(group, Reject):
                return group
            # Re-enabling «Защита» is allowed and costs again (DEC-08): a new bonus and intent.
            if mode == group.mode and mode is not Mode.DEFENSE:
                return Reject(RejectCode.NO_CHANGE)
            return ()
        case UpgradeRoad(group=gid, edge=eid):
            group = _standing_group(state, player, gid, seen)
            if isinstance(group, Reject):
                return group
            if not 0 <= eid < len(state.map.edges):
                return Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
            edge = state.map.edges[eid]
            if _node_of(group) not in (edge.a, edge.b):
                return Reject(RejectCode.NOT_ADJACENT)
            if not is_internal(state, eid) or state.nodes[edge.a].owner != player:
                return Reject(RejectCode.NOT_INTERNAL)
            if state.edges[eid].width >= edge.max_width:
                return Reject(RejectCode.MAX_WIDTH)
            if group.mode is Mode.BUILD and group.build_edge == eid:
                return Reject(RejectCode.NO_CHANGE)
            return ()
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
            return ()
        case CancelOrder(group=gid):
            group = _own_group(state, player, gid, seen)
            if isinstance(group, Reject):
                return group
            if not isinstance(group.location, AtNode):
                return Reject(RejectCode.GROUP_ON_EDGE)
            if not (_waits_to_depart(state, group) or group.mode is Mode.DEFENSE):
                return Reject(RejectCode.NOTHING_TO_CANCEL)
            return ()
        case SetStance(stance=stance):
            if stance == state.players[player].stance:
                return Reject(RejectCode.NO_CHANGE)
            if stance_cooldown_left(state, rules, player) > 0:
                return Reject(RejectCode.STANCE_COOLDOWN)
            return ()
        case Forfeit():
            return Reject(RejectCode.NO_CHANGE) if state.players[player].forfeited else ()


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
            interrupt_build(group)  # leaving interrupts the build (SIM-11)
            if group.mode is Mode.DEFENSE:
                group.mode = Mode.ATTACK  # a move order drops «Защита» for free (DEC-08)
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
            keep = state.groups[min(gids)]
            for gid in sorted(gids):
                if gid != keep.id:
                    set_intent(state, state.groups[gid], None)
                    other = state.groups.pop(gid)
                    keep.units += other.units
                    keep.charged += other.charged
            keep.mode = Mode.ATTACK
            keep.order = None
            interrupt_build(keep)
            clear_bonus(keep)
            set_intent(state, keep, None)
            return [event(tick, "groups_merged", player=player, group=keep.id, units=keep.units)]
        case SetMode(group=gid, mode=mode):
            group = state.groups[gid]
            group.mode = mode
            group.order = None  # the group stops where it stands
            if mode is not Mode.BUILD:
                interrupt_build(group)
            if mode is Mode.DEFENSE:  # public at once, the bonus after the delay (DEC-08)
                group.bonus = rules.orders.defense_bonus
                group.bonus_tick = tick + rules.orders.defense_delay_ticks
                set_intent(state, group, IntentKind.DEFENSE)
            else:
                clear_bonus(group)
                set_intent(state, group, None)
            return []
        case UpgradeRoad(group=gid, edge=eid):
            group = state.groups[gid]
            start_build(group, eid, tick)  # a new build: the progress starts from zero
            group.order = None
            clear_bonus(group)
            # Builds are public like planned orders (DEC-04): from the group's node along the edge.
            set_intent(state, group, IntentKind.BUILD, state.map.edges[eid].other(_node_of(group)))
            return []
        case Recruit(node=node):
            return recruit_unit(state, player, node)
        case CancelOrder(group=gid):
            group = state.groups[gid]
            if _waits_to_depart(state, group):
                group.order = None
            else:
                group.mode = Mode.ATTACK  # «Защита» (validated)
            clear_bonus(group)
            set_intent(state, group, None)
            return []
        case SetStance(stance=stance):
            return set_stance(state, player, stance)
        case Forfeit():
            state.players[player].forfeited = True
            return [event(tick, "forfeit", player=player)]
