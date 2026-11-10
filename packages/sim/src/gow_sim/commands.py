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
Bonuses and public intents of planned orders: ``systems.orders`` (SIM-10).
The buildings (DEC-26, DEC-41, items 2 and 7): ``BuildBarracks`` and ``BuildFactory``
(``systems.build``), paid in charges by the progressive payment of item 7
(``systems.build.pay``), so no charge check rejects them; they are not public. ``SetStance``
(DEC-44) is free, without a cooldown, and a real change carries the local progress over to the
new periods (#792). A planned ``Move`` names its requested bonus (``Move.bonus >= 1``, DEC-41,
item 10) and gathers it in ``systems.orders``; ``ReleasePlan`` sends it at once.
Supply flow (DEC-43): ``SetLeafShift`` sets the player's leaf shift (item B2; free, not public,
no event). Road fortifications (DEC-43, item D): ``FortifyRoad(node, edge)`` for ``fort.cost``
CP (``systems.fortify``; not public). None of these commands is public.

The group order (DEC-48, section ``[group_order]``): ``GroupMove(groups, dest, planned, bonus)``
checks each member like a ``Move`` of that group to ``dest`` and accepts the valid ones (partial
acceptance, per-member codes in ``Ok.members``); the whole command is rejected when the section is
off, the list or the bonus is malformed, a rally is planned, ``dest`` does not exist, no member is
valid (the first member's code, with the members) or the CP of the accepted members are short
(``NOT_ENOUGH_CP``, all or nothing). A member too big for every path to ``dest`` is split
automatically (owner, 2026-11-10, #913): the largest part that has a path (the size ``reach``
offers, #762) splits off as a new group, charged units first, and goes as the member; the rest
stays as the group; only when not even one unit fits is it ``STACK_LIMIT``. An own ``dest`` is a
rally (every member departs at once, the price ``group_order.rally_pct`` of a move per member
rounded up to a whole CP), any other an attack
whose members arrive in one tick (a member waits in its node until its departure, ``GROUP_BUSY``
for any command but ``CancelOrder``), a planned one splitting the requested bonus over the members
(``systems.orders``). Under the section ``ReleasePlan`` is disabled. A command of a feature the
ruleset does not have (``GroupMove`` without the section, ``ReleasePlan`` with it,
``SetRallyPoint`` without ``recruit.rally_point``) is ``INVALID_ARGUMENT``: the client hides those
controls by ``ruleset_public``. ``SetRallyPoint(node, target)`` (DEC-48, item H) sets or clears
the rally point of an own city, free.

The ``arrive_tick`` of a planned ``Move`` is the arrival once the requested bonus is gathered: the
group departs in the tick after its last charge (``systems.orders.gather_plans``), so
``tick + bonus * plan_ticks_per_bonus + 1 + T - 1`` (#896 found the forecast one tick early).
"""

from collections.abc import Callable, Iterable
from dataclasses import dataclass, replace
from enum import StrEnum
from itertools import pairwise

from gow_sim.ruleset import Retreat, Ruleset, Stance
from gow_sim.state import (
    PLAN_WAIT,
    AtNode,
    Event,
    FightMember,
    GameState,
    Group,
    GroupOrder,
    IntentKind,
    Mode,
    OnEdge,
    Order,
    event,
)
from gow_sim.systems.build import start_barracks, start_factory
from gow_sim.systems.capacity import node_capacities
from gow_sim.systems.economy import set_stance
from gow_sim.systems.flow import factory_count
from gow_sim.systems.fortify import start_road_fort
from gow_sim.systems.movement import find_path, path_ticks
from gow_sim.systems.orders import (
    absorb,
    clear_bonus,
    plan_parts,
    release_plan,
    schedule,
    set_intent,
    settle_group_orders,
)
from gow_sim.systems.recruit import cancel_unit, free_capacity, queue_unit
from gow_sim.systems.supply import is_city
from gow_sim.systems.vision import compute_vision, is_visible

__all__ = [
    "BuildBarracks",
    "BuildFactory",
    "CancelOrder",
    "CancelRecruit",
    "Command",
    "CommandResult",
    "Forfeit",
    "FortifyRoad",
    "GroupMove",
    "Member",
    "Merge",
    "Move",
    "Ok",
    "OrderKind",
    "PlayerCommand",
    "Recruit",
    "Reject",
    "RejectCode",
    "ReleasePlan",
    "SetLeafShift",
    "SetRallyPoint",
    "SetStance",
    "Split",
    "Stance",
    "apply_commands",
    "command_cost",
    "map_group_ids",
    "rally_price",
    "validate",
]


# Command types --------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Move:
    """Move ``group`` to ``dest``; ``planned``: a planned order (DEC-08). ``bonus``: the requested
    attack bonus of a planned order, at least 1 (DEC-41, item 10); 0 for an ordinary order."""

    group: int
    dest: int
    planned: bool = False
    bonus: int = 0


@dataclass(frozen=True, slots=True)
class Split:
    """Split ``n`` units off ``group`` into a new group; the charged units go first (DEC-20, B1)."""

    group: int
    n: int


@dataclass(frozen=True, slots=True)
class Merge:
    """Merge two or more groups standing in one node into the one with the smallest id; it keeps
    its bonus (DEC-20, B2). A group that holds a move order is
    ``GROUP_BUSY``: the size the stack limit was checked for must not change (DEC-20, D3)."""

    groups: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class SetStance:
    stance: Stance


@dataclass(frozen=True, slots=True)
class BuildBarracks:
    """The own city ``node`` builds the barracks: then it recruits (DEC-26)."""

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
    order on an edge (the group turns back to the start of the current edge, ``OnEdge.back``)."""

    group: int


@dataclass(frozen=True, slots=True)
class BuildFactory:
    """The own city ``node`` builds a supply factory (DEC-41, item 2)."""

    node: int


@dataclass(frozen=True, slots=True)
class FortifyRoad:
    """The own city or province ``node`` fortifies the road ``edge`` leaving it (DEC-43, item D;
    code name ``road_fort``) for ``fort.cost`` CP."""

    node: int
    edge: int


@dataclass(frozen=True, slots=True)
class SetLeafShift:
    """Set the own leaf shift (DEC-43, item B2): the level moves ``shift`` roads back from the
    front, ``0..leaf_shift_max``. Free, not public."""

    shift: int


@dataclass(frozen=True, slots=True)
class ReleasePlan:
    """The group waiting on a gathering planned order departs now with the bonus gathered so
    far, free (DEC-41, item 10)."""

    group: int


@dataclass(frozen=True, slots=True)
class GroupMove:
    """DEC-48: one order for the own groups ``groups`` (1 to ``group_order.max_groups``, distinct,
    the order of the list decides the bonus split) to ``dest``: a rally to an own node, an attack
    with a synchronized arrival to any other. ``planned`` and ``bonus`` as in ``Move``; ``bonus``
    is the requested total of a planned attack."""

    groups: tuple[int, ...]
    dest: int
    planned: bool = False
    bonus: int = 0


@dataclass(frozen=True, slots=True)
class SetRallyPoint:
    """DEC-48, item H: the new units of the own city ``node`` walk to the own node ``target``;
    ``None`` clears the point. Free."""

    node: int
    target: int | None


@dataclass(frozen=True, slots=True)
class Forfeit:
    pass


type Command = (
    Move
    | Split
    | Merge
    | SetStance
    | BuildBarracks
    | Recruit
    | CancelRecruit
    | CancelOrder
    | BuildFactory
    | FortifyRoad
    | SetLeafShift
    | ReleasePlan
    | GroupMove
    | SetRallyPoint
    | Forfeit
)


def map_group_ids(cmd: Command, f: Callable[[int], int]) -> Command:
    """``cmd`` with every group id replaced by ``f(id)``: the hook for ``resolve()`` (SIM-14)."""
    match cmd:
        case Move(group=g, dest=dest, planned=planned, bonus=bonus):
            return Move(f(g), dest, planned, bonus)
        case ReleasePlan(group=g):
            return ReleasePlan(f(g))
        case Split(group=g, n=n):
            return Split(f(g), n)
        case Merge(groups=groups):
            return Merge(tuple(f(g) for g in groups))
        case CancelOrder(group=g):
            return CancelOrder(f(g))
        case GroupMove(groups=groups, dest=dest, planned=planned, bonus=bonus):
            return GroupMove(tuple(f(g) for g in groups), dest, planned, bonus)
        case (
            SetStance()
            | SetRallyPoint()
            | BuildBarracks()
            | Recruit()
            | CancelRecruit()
            | BuildFactory()
            | FortifyRoad()
            | SetLeafShift()
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
    NOT_CITY = "NOT_CITY"
    """The node is a province, not a city (DEC-22, item 3; DEC-23)."""
    CITY_BUSY = "CITY_BUSY"
    """The city already builds the barracks (DEC-26, item 8)."""
    NO_CHANGE = "NO_CHANGE"
    """The command would leave everything as it is (same stance or leaf shift; already
    forfeited)."""
    NOTHING_TO_CANCEL = "NOTHING_TO_CANCEL"
    ALREADY_BUILT = "ALREADY_BUILT"
    """The city has its barracks or its factory already, the capital from the start (DEC-26,
    item 9; DEC-41, item 2), or the road its fortification (DEC-43, item D3)."""
    NO_BARRACKS = "NO_BARRACKS"
    """A city recruits only with the barracks (DEC-26, section 3)."""
    QUEUE_FULL = "QUEUE_FULL"
    """The recruit queue of the city holds ``recruit.queue_max`` units (DEC-25, item 6)."""
    CITY_FULL = "CITY_FULL"
    """The owner's units standing in the city plus its recruit queue fill the capacity
    (DEC-25, item 7)."""
    FACTORY_LIMIT = "FACTORY_LIMIT"
    """The player has ``factory.max`` factories, builds under way included (DEC-41, item 2)."""
    NOT_ADJACENT = "NOT_ADJACENT"
    """The road of ``FortifyRoad`` does not leave its node (DEC-43, item D3)."""
    IN_FIGHT = "IN_FIGHT"
    """The group is in a fight: it only withdraws (DEC-24, item E): a defender of a node by a
    normal ``Move``, everyone else by ``CancelOrder``."""


class OrderKind(StrEnum):
    """What a ``GroupMove`` is, decided by the owner of its target when applied (DEC-48, B2)."""

    RALLY = "rally"
    ATTACK = "attack"


@dataclass(frozen=True, slots=True)
class Member:
    """One group of a ``GroupMove`` in the order of the list (DEC-48, item B6): its path, its
    departure and arrival (``None`` for a planned member until the departures are fixed) and its
    part of the bonus (item F2), or the code that dropped it."""

    group: int
    path: tuple[int, ...] = ()
    depart_tick: int | None = None
    arrive_tick: int | None = None
    bonus: int = 0
    reject: RejectCode | None = None
    split_units: int = 0
    """The group was too big for every path (owner, 2026-11-10, #913): the units of the part
    that splits off and goes as the member, the rest staying as the group; 0: the whole group
    goes."""
    group_units: int = 0
    """With ``split_units``: the units of the group at the command; 0 otherwise."""


@dataclass(frozen=True, slots=True)
class Ok:
    cost: int
    """CP charged on application, in hundredths."""
    path: tuple[int, ...] = ()
    """For ``Move``: the nodes ``(start, ..., dest)``, returned to the client in ``ack``."""
    arrive_tick: int | None = None
    """For ``Move``: the tick the group reaches ``dest`` if the command is applied at
    ``state.tick`` and nothing stops it (DEC-22, item 10: the client shows the travel time).
    For ``GroupMove``: the common arrival (a rally: the latest arrival of a member), ``None`` for
    a planned attack (its departures are fixed later, DEC-48, item F4)."""
    kind: OrderKind | None = None
    """For ``GroupMove``: a rally or an attack (DEC-48, item B2)."""
    members: tuple[Member, ...] = ()
    """For ``GroupMove``: every group of the list, in its order (DEC-48, item B6)."""


@dataclass(frozen=True, slots=True)
class Reject:
    code: RejectCode
    members: tuple[Member, ...] = ()
    """For a ``GroupMove`` without a valid member: the code of each group (DEC-48, item B3)."""


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
        case BuildBarracks():
            return cost.barracks
        case Recruit():
            return cost.recruit
        case CancelRecruit():
            return 0  # free, the refund is paid on application (DEC-25, item 11)
        case CancelOrder():
            return cost.cancel
        case SetStance():
            return cost.stance
        case BuildFactory():
            return 0  # paid in charges (DEC-41, items 2 and 7)
        case SetLeafShift():
            return 0  # free (DEC-43, item B2)
        case FortifyRoad():
            return rules.fort.cost  # flat (DEC-43, item D2)
        case ReleasePlan():
            return 0  # free (DEC-41, item 10)
        case GroupMove(groups=groups, planned=planned):
            # every group of the list accepted as an attack: the upper bound of the price (a rally
            # needs the owner of ``dest`` and costs less; DEC-48, items A2 and B5)
            return len(groups) * (cost.planned_move if planned else cost.move)
        case SetRallyPoint():
            return 0  # free (DEC-48, item H3)
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
    if isinstance(cmd, GroupMove):
        return _validate_group_move(state, rules, player, cmd, seen)
    checked = _check(state, rules, player, cmd, seen)
    if isinstance(checked, Reject):
        return checked
    cost = command_cost(rules, cmd)
    if cost > state.players[player].cp:
        return Reject(RejectCode.NOT_ENOUGH_CP)
    if isinstance(cmd, Move):
        # The first step is made in the tick of the order (or of the departure): tick + T - 1.
        # A plan departs in the tick after its last charge (``gather_plans``): + 1.
        delay = cmd.bonus * rules.orders.plan_ticks_per_bonus + 1 if cmd.planned else 0
        arrive = state.tick + delay + path_ticks(state, rules, checked) - 1
        return Ok(cost=cost, path=checked, arrive_tick=arrive)
    return Ok(cost=cost, path=checked)


def rally_price(rules: Ruleset, n: int) -> int:
    """DEC-48, item A2: a rally of ``n`` groups costs ``rally_pct`` of a move per group, the total
    rounded up to a whole CP (in hundredths; ``//`` on non-negative numbers)."""
    go = rules.group_order
    assert go is not None
    return (n * rules.orders.cost.move * go.rally_pct + 9999) // 10000 * 100


def _validate_group_move(
    state: GameState, rules: Ruleset, player: int, cmd: GroupMove, seen: dict[int, bool]
) -> Ok | Reject:
    """DEC-48, items B3 to B6, C2, E1, F1 and F2: the checks in this order, then the price and the
    schedule of the accepted members."""
    go = rules.group_order
    gids = cmd.groups
    invalid = Reject(RejectCode.INVALID_ARGUMENT)
    if go is None:
        return invalid  # the ruleset has no group order (item J)
    if not 1 <= len(gids) <= go.max_groups or len(dict.fromkeys(gids)) != len(gids):
        return invalid
    if cmd.bonus < 0 or (cmd.bonus >= 1) != cmd.planned:
        return invalid
    dest = cmd.dest
    if not 0 <= dest < len(state.map.nodes):
        return Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
    rally = state.nodes[dest].owner == player
    if rally and cmd.planned:
        return invalid  # item G1
    checked = [(gid, _check_member(state, rules, player, gid, dest, seen)) for gid in gids]
    accepted: list[tuple[int, tuple[int, ...]]] = []
    goes: dict[int, int] = {}  # the units each accepted member sends (a part when split)
    for gid, found in checked:
        if not isinstance(found, Reject):
            accepted.append((gid, found[0]))
            goes[gid] = found[1]
    if not accepted:
        first = checked[0][1]
        assert isinstance(first, Reject)
        dropped: list[Member] = []
        for gid, found in checked:
            assert isinstance(found, Reject)
            dropped.append(Member(gid, reject=found.code))
        return Reject(first.code, tuple(dropped))
    n = len(accepted)
    cost = rules.orders.cost
    if rally:
        price = rally_price(rules, n)
    else:
        price = n * (cost.planned_move if cmd.planned else cost.move)
    if price > state.players[player].cp:
        return Reject(RejectCode.NOT_ENOUGH_CP)
    tick = state.tick
    ticks = [path_ticks(state, rules, path) for _, path in accepted]
    plan: dict[int, Member] = {}
    arrive: int | None
    if cmd.planned:  # item F: the departures are fixed once the parts are gathered
        # The cap of a split member is the charged units of its part (they go first, DEC-20 B1).
        caps = [min(goes[gid], state.groups[gid].charged) for gid, _ in accepted]
        parts = plan_parts(caps, cmd.bonus)
        arrive = None
        for (gid, path), part in zip(accepted, parts, strict=True):
            plan[gid] = Member(gid, path, bonus=part)
    elif rally:  # item E1: every member departs at once
        arrive = tick + max(ticks) - 1
        for (gid, path), t in zip(accepted, ticks, strict=True):
            plan[gid] = Member(gid, path, tick, tick + t - 1)
    else:  # item C2: one arrival
        arrive, departs = schedule(tick, ticks)
        for (gid, path), depart in zip(accepted, departs, strict=True):
            plan[gid] = Member(gid, path, depart, arrive)
    members: list[Member] = []
    for gid, found in checked:
        if isinstance(found, Reject):
            members.append(Member(gid, reject=found.code))
            continue
        units = state.groups[gid].units
        member = plan[gid]
        if goes[gid] < units:
            member = replace(member, split_units=goes[gid], group_units=units)
        members.append(member)
    kind = OrderKind.RALLY if rally else OrderKind.ATTACK
    return Ok(cost=price, arrive_tick=arrive, kind=kind, members=tuple(members))


def _check_member(
    state: GameState, rules: Ruleset, player: int, gid: int, dest: int, seen: dict[int, bool]
) -> tuple[tuple[int, ...], int] | Reject:
    """A member of a ``GroupMove``, checked like a ``Move`` of that group (DEC-48, item B4): a
    standing own group without an order, in no fight under any ``combat.retreat``, not already in
    ``dest``. Returns its path and the units that go: the whole group when a path holds it, else
    the largest part a path holds (split automatically, owner 2026-11-10, #913) with that part's
    fastest path; ``STACK_LIMIT`` only when not even one unit has a path."""
    group = _standing_group(state, player, gid, seen)
    if isinstance(group, Reject):
        return group
    if group.fight is not None:
        return Reject(RejectCode.IN_FIGHT)
    start = _node_of(group)
    if dest == start:
        return Reject(RejectCode.INVALID_ARGUMENT)
    path = find_path(state, rules, player, start, dest, size=group.units)
    if path is not None:
        return path, group.units
    if find_path(state, rules, player, start, dest) is None:
        return Reject(RejectCode.NO_PATH)
    part = part_that_fits(state, rules, player, start, dest, group.units)
    return Reject(RejectCode.STACK_LIMIT) if part is None else part


def part_that_fits(
    state: GameState, rules: Ruleset, player: int, start: int, dest: int, units: int
) -> tuple[tuple[int, ...], int] | None:
    """The fastest path from ``start`` to ``dest`` of the largest group below ``units`` that has
    one under the stack limit (DEC-20, D), with that size; ``None``: not even one unit. A size
    passes a node exactly when the node's capacity is not less than it, so the largest such size
    is one of the node capacities: only those are tried, largest first (the size of
    ``view.Reach.split``, #762)."""
    caps = sorted(dict.fromkeys(c for c in node_capacities(state, rules) if 0 < c < units))
    for size in reversed(caps):
        path = find_path(state, rules, player, start, dest, size=size)
        if path is not None:
            return path, size
    return None


def _check(
    state: GameState, rules: Ruleset, player: int, cmd: Command, seen: dict[int, bool]
) -> tuple[int, ...] | Reject:
    """Every rule except CP; returns the path for ``Move`` (empty for the rest) or a Reject."""
    match cmd:
        case Move(group=gid, dest=dest, planned=planned, bonus=bonus):
            group = _standing_group(state, player, gid, seen)
            if isinstance(group, Reject):
                return group
            if group.fight is not None and (
                planned or not _defends(state, group) or not _retreats(rules)
            ):
                return Reject(RejectCode.IN_FIGHT)  # DEC-24, E1 and E4; DEC-40 (no retreat)
            # DEC-41, item 10: a planned order names its bonus, b >= 1; nothing else does.
            if bonus < 0 or (bonus >= 1) != planned:
                return Reject(RejectCode.INVALID_ARGUMENT)
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
        case BuildBarracks(node=node):
            return _check_barracks(state, player, node)
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
            if not city.has_barracks:  # the barracks decides (DEC-26)
                return Reject(RejectCode.NO_BARRACKS)
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
                return _check_cancel_in_fight(state, rules, group)
            location = group.location
            if isinstance(location, OnEdge):
                # A bouncing group lost its order in the fight (DEC-20, C4).
                if location.back or group.order is None:
                    return Reject(RejectCode.NOTHING_TO_CANCEL)
                return ()
            if not _waits_to_depart(state, group):
                return Reject(RejectCode.NOTHING_TO_CANCEL)
            return ()
        case SetStance(stance=stance):
            if stance == state.players[player].stance:
                return Reject(RejectCode.NO_CHANGE)
            return ()
        case BuildFactory(node=node):
            return _check_factory(state, rules, player, node)
        case FortifyRoad(node=node, edge=edge):
            return _check_road_fort(state, player, node, edge)
        case SetLeafShift(shift=shift):
            ps = state.players[player]
            if not 0 <= shift <= ps.leaf_shift_max:  # stored by the last flow step (item B2)
                return Reject(RejectCode.INVALID_ARGUMENT)
            return Reject(RejectCode.NO_CHANGE) if shift == ps.leaf_shift else ()
        case ReleasePlan(group=gid):
            if rules.group_order is not None:
                return Reject(RejectCode.INVALID_ARGUMENT)  # DEC-48, item A7: no release
            group = _own_group(state, player, gid, seen)
            if isinstance(group, Reject):
                return group
            if not isinstance(group.location, AtNode):
                return Reject(RejectCode.GROUP_ON_EDGE)
            if not (_waits_to_depart(state, group) and group.plan > 0):
                return Reject(RejectCode.NOTHING_TO_CANCEL)  # TODO(#651): the code of no plan
            if group.fight is not None:
                return Reject(RejectCode.IN_FIGHT)  # it may cancel the plan (DEC-24, E)
            return ()
        case SetRallyPoint(node=node, target=target):
            return _check_rally_point(state, rules, player, node, target)
        case GroupMove():
            raise AssertionError("checked by _validate_group_move")
        case Forfeit():
            return Reject(RejectCode.NO_CHANGE) if state.players[player].forfeited else ()


def _check_rally_point(
    state: GameState, rules: Ruleset, player: int, node: int, target: int | None
) -> tuple[int, ...] | Reject:
    """The checks of ``SetRallyPoint`` in the order of DEC-48, item H2. Only own nodes are read,
    so nothing hidden leaks; no path is needed (the point is persistent)."""
    if not rules.recruit.rally_point:
        return Reject(RejectCode.INVALID_ARGUMENT)  # the ruleset has no rally point (item H1)
    nodes = state.nodes
    if not 0 <= node < len(state.map.nodes):
        return Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
    city = nodes[node]
    if city.owner != player:
        return Reject(RejectCode.NOT_OWNER)
    if not is_city(state.map, node):
        return Reject(RejectCode.NOT_CITY)
    if not city.has_barracks:
        return Reject(RejectCode.NO_BARRACKS)
    if target is not None:
        if not 0 <= target < len(state.map.nodes):
            return Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
        if nodes[target].owner != player:
            return Reject(RejectCode.NOT_OWNER)
        if target == node:
            return Reject(RejectCode.INVALID_ARGUMENT)
    if city.rally_point == target:
        return Reject(RejectCode.NO_CHANGE)
    return ()


def _check_factory(
    state: GameState, rules: Ruleset, player: int, node: int
) -> tuple[int, ...] | Reject:
    """The checks of ``BuildFactory`` in this order (DEC-41, item 2; mechanics.md, the notes of
    #644 and #645): the node, the owner, a city, a factory or a factory build there already, the
    factory cap. The charges are paid progressively (item 7), so they are not checked."""
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
    if factory_count(state, player) >= rules.factory.max:
        return Reject(RejectCode.FACTORY_LIMIT)
    return ()


def _check_road_fort(
    state: GameState, player: int, node: int, edge: int
) -> tuple[int, ...] | Reject:
    """The checks of ``FortifyRoad`` in this order (DEC-43, item D3; CP last, in ``_validate``):
    the node and the edge on the map, the owner of the node, the edge leaves the node, a
    fortification of the node on that road built or being built already. A fight does not
    reject. Only the own node is read, so nothing hidden leaks."""
    mapdef = state.map
    if not (0 <= node < len(mapdef.nodes) and 0 <= edge < len(mapdef.edges)):
        return Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
    site = state.nodes[node]
    if site.owner != player:
        return Reject(RejectCode.NOT_OWNER)
    if edge not in mapdef.incident[node]:
        return Reject(RejectCode.NOT_ADJACENT)
    if edge in site.road_forts:
        return Reject(RejectCode.ALREADY_BUILT)
    return ()


def _defends(state: GameState, group: Group) -> bool:
    """The group stands in an own node: in a fight there it defends the node (DEC-24, E1)."""
    location = group.location
    return isinstance(location, AtNode) and state.nodes[location.node].owner == group.owner


def _member(state: GameState, group: Group) -> FightMember:
    assert group.fight is not None
    return state.fights[group.fight].members[group.id]


def _retreats(rules: Ruleset) -> bool:
    """A group may leave a fight (DEC-24, item E); ``combat.retreat = "none"``: it stays in the
    fight until the fight ends (DEC-40, variant N)."""
    return rules.combat.retreat is Retreat.ROUND


def _check_cancel_in_fight(
    state: GameState, rules: Ruleset, group: Group
) -> tuple[int, ...] | Reject:
    """``CancelOrder`` of a group in a fight (DEC-24, E): the withdrawal of an attacker of a node
    or of a group on an edge; for a defender of a node, the cancel of its withdrawal ``Move`` or
    of its waiting planned order. A returning group has no order (E2). Without retreat (DEC-40,
    variant N) the withdrawal is ``IN_FIGHT``; the cancel of a waiting planned order of a defender
    stays (it keeps the group in the fight)."""
    member = _member(state, group)
    location = group.location
    if _defends(state, group):
        if group.order is not None:
            return ()
        return Reject(RejectCode.NOTHING_TO_CANCEL)
    if member.leaving or member.returning:
        return Reject(RejectCode.NOTHING_TO_CANCEL)
    if isinstance(location, OnEdge):
        if location.back or group.order is None:
            return Reject(RejectCode.NOTHING_TO_CANCEL)
    elif member.edge is None:
        return Reject(RejectCode.NOTHING_TO_CANCEL)
    return () if _retreats(rules) else Reject(RejectCode.IN_FIGHT)


def _check_barracks(state: GameState, player: int, node: int) -> tuple[int, ...] | Reject:
    """The checks of ``BuildBarracks`` in the order of DEC-26, item 9 (CP last, in
    ``_validate``). It does not need supplied territory (item 8)."""
    if not 0 <= node < len(state.map.nodes):
        return Reject(RejectCode.NOT_FOUND_OR_HIDDEN)
    city = state.nodes[node]
    if city.owner != player:
        return Reject(RejectCode.NOT_OWNER)
    if not is_city(state.map, node):
        return Reject(RejectCode.NOT_CITY)
    if city.has_barracks:
        return Reject(RejectCode.ALREADY_BUILT)
    if city.build is not None:
        return Reject(RejectCode.CITY_BUSY)
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
    """The group waits in its node for a later departure: a gathering plan (DEC-41, item 10) or
    a member of a group order (DEC-48, item B8)."""
    order = group.order
    return order is not None and state.tick < order.depart_tick


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
        case Move(group=gid, planned=planned, bonus=bonus):
            group = state.groups[gid]
            depart = PLAN_WAIT if planned else tick  # a plan gathers first (DEC-41, item 10)
            group.order = Order(path=ok.path[1:], planned=planned, depart_tick=depart)
            group.plan = bonus
            group.plan_tick = tick if planned else 0
            if group.fight is not None:  # a defender withdraws after the next round (DEC-24)
                _set_leaving(state, group, leaving=True)
            group.group_order = None  # it leaves a group order it departs with now (DEC-48)
            group.walk = False
            if planned:  # public intent now, the bonus from the departure on (DEC-08)
                # The bonus is gathered from 0 (DEC-41, item 10: no distance bonus,
                # ``systems.orders``); ``movement`` caps it by the charged units at departure.
                group.bonus = 0
                group.bonus_tick = depart
                set_intent(state, group, IntentKind.PLANNED_MOVE, ok.path[-1])
            else:
                clear_bonus(group)
                set_intent(state, group, None)
            return []
        case Split(group=gid, n=n):
            return [_split(state, player, gid, n)[1]]
        case Merge(groups=gids):
            # The smallest id keeps its bonus and intent (DEC-20, B2).
            keep = state.groups[min(gids)]
            for gid in sorted(gids):
                if gid != keep.id:
                    absorb(state, keep, gid)
            return [event(tick, "groups_merged", player=player, group=keep.id, units=keep.units)]
        case BuildBarracks(node=node):
            return start_barracks(state, rules, player, node)
        case Recruit(node=node):
            queue_unit(state, node)
            return []
        case CancelRecruit(node=node):
            return cancel_unit(state, rules, player, node)
        case CancelOrder(group=gid):
            group = state.groups[gid]
            location = group.location
            joint = group.group_order
            if group.fight is not None:
                # DEC-24, E: a defender's withdrawal or waiting order is cancelled, it stays in
                # the fight; anyone else withdraws after the next round.
                if _defends(state, group):
                    group.order = None
                    _set_leaving(state, group, leaving=False)
                else:
                    _set_leaving(state, group, leaving=True)
            else:
                if isinstance(location, OnEdge):
                    # Back to the start of this edge, as long as the way travelled (DEC-20, C2):
                    # the mechanics of a bounce, without spending charges.
                    group.location = OnEdge(
                        location.edge, location.from_node, location.progress, True
                    )
                group.order = None  # an order on an edge or a waiting order (validated)
            clear_bonus(group)
            set_intent(state, group, None)
            if joint is not None and group.order is None:
                # DEC-48, items B7 and F8: the member leaves its group order, no refund; the
                # others keep their schedule, or depart now if it was the last one not ready.
                group.group_order = None
                group.walk = False
                settle_group_orders(state, rules, tick, only=joint)
            return []
        case SetStance(stance=stance):
            return set_stance(state, rules, player, stance)
        case BuildFactory(node=node):
            return start_factory(state, rules, player, node)
        case FortifyRoad(node=node, edge=edge):
            return start_road_fort(state, rules, player, node, edge)
        case SetLeafShift(shift=shift):
            state.players[player].leaf_shift = shift  # in force in this tick's flow step
            return []
        case ReleasePlan(group=gid):
            release_plan(state.groups[gid], tick)  # it departs in this tick (movement)
            return []
        case GroupMove(dest=dest, planned=planned):
            return _apply_group_move(state, rules, player, dest, planned, ok)
        case SetRallyPoint(node=node, target=target):
            state.nodes[node].rally_point = target  # free, no event (DEC-48, item H3)
            return []
        case Forfeit():
            state.players[player].forfeited = True
            return [event(tick, "forfeit", player=player)]


def _split(state: GameState, player: int, gid: int, n: int) -> tuple[Group, Event]:
    """Split ``n`` units off the group ``gid`` into a new group in its place, the charged units
    first (DEC-20, B1; #117); the new group and the event ``group_split``."""
    group = state.groups[gid]
    charged = min(n, group.charged)
    group.units -= n
    group.charged -= charged
    new = state.new_id()
    part = Group(new, player, n, charged, Mode.ATTACK, group.location)
    state.groups[new] = part
    return part, event(state.tick, "group_split", player=player, group=gid, new_group=new, units=n)


def _apply_group_move(
    state: GameState, rules: Ruleset, player: int, dest: int, planned: bool, ok: Ok
) -> list[Event]:
    """Apply a validated ``GroupMove`` (DEC-48): one ``GroupOrder`` and an order per accepted
    member. A member too big for every path first splits its part off (``split_units``, #913):
    the part is the member, the rest stays as the group without an order. A planned member
    gathers its part from 0 with its own public intent (item F7); with every part 0 the
    departures are fixed at once (item F4)."""
    tick = state.tick
    oid = state.new_id()
    rally = ok.kind is OrderKind.RALLY
    state.group_orders[oid] = GroupOrder(oid, player, rally, planned, ok.arrive_tick)
    events: list[Event] = []
    for m in ok.members:
        if m.reject is not None:
            continue
        if m.split_units:
            group, split = _split(state, player, m.group, m.split_units)
            events.append(split)
        else:
            group = state.groups[m.group]
        depart = PLAN_WAIT if m.depart_tick is None else m.depart_tick
        group.order = Order(path=m.path[1:], planned=planned, depart_tick=depart)
        group.group_order = oid
        group.walk = False
        if planned:
            group.plan = m.bonus
            group.plan_tick = tick
            group.bonus = 0
            group.bonus_tick = PLAN_WAIT
            set_intent(state, group, IntentKind.PLANNED_MOVE, dest)
        else:
            clear_bonus(group)
            set_intent(state, group, None)
    if planned:
        settle_group_orders(state, rules, tick, only=oid)
    return events
