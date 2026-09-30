"""Combat (SIM-09): fights by DEC-07 (mechanics.md, section 4, «Разрешение боя», rules 1-9).

Every charge is one shot: it either cancels an enemy shot or kills one enemy unit.

The core is ``resolve_fight()``, a pure function of the two sides; the bonuses of the sides are
its input (their source, planned orders and «Защита», is SIM-10, #26). The ``combat`` system
runs after ``movement`` (rule 8: all moves and arrivals first, then all fights) and reads the
``group_arrived`` events of the tick from ``state.events``:

1. Edge meetings first (rule 6): groups of the two players going towards each other along one
   edge meet when their progress towards their ends sums to at least 1000; a group that arrived
   in this tick counts with 1000 on its arrival edge. A symmetric fight without terrain; the
   loser bounces, a surviving winner goes on, on a draw both bounce.
2. Then the nodes, in id order (each node is its own fight, so the order changes nothing):
   foreign groups in a player's node attack it (rule 4, row 5: an empty node is taken without a
   fight); both players in a neutral node fight symmetrically (rule 5). If the defender is wiped
   out the node goes to the attacker through ``change_owner()``, otherwise the attackers bounce;
   in a neutral node both sides bounce unless one is wiped out.

A bounce (``OnEdge.back``) takes the group back along its edge to the node it came from and
takes as long as the group has been on the edge; the order is dropped. A bounce into a node
that became foreign meanwhile is an ordinary arrival there, with its own fight (rule 4). Nobody
flees on their own (rule 9): discharged groups stay until ordered away.

Details that DEC-07 leaves open follow the defaults of #133 (see ``TODO(#133)`` below).
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum

from gow_sim.maps import PLAYERS
from gow_sim.ruleset import Ruleset
from gow_sim.state import PROGRESS_SCALE, AtNode, Event, GameState, Group, Mode, OnEdge, event
from gow_sim.systems.build import interrupt_build
from gow_sim.systems.capacity import change_owner

__all__ = [
    "Bonus",
    "BonusSource",
    "Fighter",
    "Side",
    "SideResult",
    "combat",
    "resolve_fight",
]

FIRING_MODES = (Mode.ATTACK, Mode.DEFENSE)
"""Units in these modes shoot; charges of units in «Строительство» do not count (rule 1)."""


class BonusSource(StrEnum):
    PLANNED_ORDER = "planned_order"
    DEFENSE_MODE = "defense_mode"


@dataclass(frozen=True, slots=True)
class Bonus:
    """A one-shot bonus of a group for its next fight, in virtual shots (DEC-08)."""

    source: BonusSource
    amount: int


@dataclass(slots=True)
class Fighter:
    """A group in a fight: its counters, changed in place by ``resolve_fight()``."""

    id: int
    units: int
    charged: int
    firing: bool
    """The group's mode shoots (``FIRING_MODES``)."""


@dataclass(slots=True)
class Side:
    """One side of a fight; ``groups`` in ascending id order (ties by id inside a player)."""

    groups: list[Fighter]
    bonus: int = 0
    """Virtual shots of planned orders: count in every fight."""
    defense_bonus: int = 0
    """Virtual shots of «Защита»: count only for a node defender with a firing charge."""
    virtual: int = field(default=0, init=False)
    real: int = field(default=0, init=False)


@dataclass(frozen=True, slots=True)
class SideResult:
    pool: int
    """Q after rule 1: firing charges + bonus + terrain."""
    unspent: int
    """Shots left after the fight: they burn (rule 3)."""
    losses: int
    """Units this side lost."""


def resolve_fight(a: Side, b: Side, defense_mod: int | None) -> tuple[SideResult, SideResult]:
    """Resolve one fight by DEC-07, rules 1-3 and 7; changes the fighters of both sides.

    ``defense_mod``: ``None`` for a symmetric fight (edge, neutral node); otherwise ``b``
    defends a node whose terrain gives this modifier. Bonus and terrain of the defender count
    only if it has a firing charge; a negative terrain modifier silences that many real charges
    (the unit keeps its charge, rule 1).
    """
    _arm(a, None)
    _arm(b, defense_mod)
    qa, qb = a.virtual + a.real, b.virtual + b.real
    cancel = min(qa, qb)  # rule 2
    _spend(a, cancel)
    _spend(b, cancel)
    kills_a = kills_b = 0
    if qa > qb:  # rule 3: the surplus kills, each kill spends a shot, virtual first
        kills_a = min(qa - qb, _units(b))
        _spend(a, kills_a)
        _kill(b, kills_a)
    elif qb > qa:
        kills_b = min(qb - qa, _units(a))
        _spend(b, kills_b)
        _kill(a, kills_b)
    return (
        SideResult(qa, a.virtual + a.real, kills_b),
        SideResult(qb, b.virtual + b.real, kills_a),
    )


def _units(side: Side) -> int:
    return sum(g.units for g in side.groups)


def _arm(side: Side, defense_mod: int | None) -> None:
    firing = sum(g.charged for g in side.groups if g.firing)
    # TODO(#133): the bonuses of several groups of a side add up.
    side.virtual = side.bonus
    side.real = firing
    if defense_mod is not None and firing > 0:
        side.virtual += side.defense_bonus + max(0, defense_mod)
        side.real = max(0, firing + min(0, defense_mod))


def _spend(side: Side, shots: int) -> None:
    """Spend ``shots``: virtual first, then real ones from the group with the most charged."""
    virtual = min(shots, side.virtual)
    side.virtual -= virtual
    for _ in range(shots - virtual):
        # TODO(#133): the group is chosen again for every shot.
        shooter = max(
            (g for g in side.groups if g.firing and g.charged > 0),
            key=lambda g: (g.charged, -g.id),
        )
        shooter.charged -= 1
        side.real -= 1


def _kill(side: Side, kills: int) -> None:
    """``kills`` units die: discharged ones of any group first, then of the largest group."""
    for _ in range(kills):
        alive = [g for g in side.groups if g.units > 0]
        discharged = [g for g in alive if g.units > g.charged]
        # TODO(#133): among discharged units, the group with the most units dies first.
        victim = max(discharged or alive, key=lambda g: (g.units, -g.id))
        if not discharged:
            victim.charged -= 1
        victim.units -= 1


# The system ------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class _Arrival:
    node: int
    edge: int
    from_node: int
    back: bool


def combat(
    state: GameState, rules: Ruleset, bonuses: Mapping[int, Bonus] | None = None
) -> list[Event]:
    """The combat system (see the module docstring).

    ``bonuses``: group id to the bonus the group brings into its next fight (SIM-10, #26). A
    group that fought loses its bonus whether it was used or not (rule 3); the ``fight_group``
    events name those groups. Emits ``fight``, ``fight_group`` and ``node_captured``.
    """
    bonus = bonuses or {}
    arrivals = _arrivals(state)
    events = _edge_meetings(state, arrivals, bonus)
    for node_id in sorted(state.nodes):
        events.extend(_node_fight(state, rules, node_id, arrivals, bonus))
    return events


def _arrivals(state: GameState) -> dict[int, _Arrival]:
    result: dict[int, _Arrival] = {}
    for e in state.events:
        if e.tick != state.tick or e.kind != "group_arrived":
            continue
        gid, node, edge, from_node, back = (
            e.get("group"),
            e.get("node"),
            e.get("edge"),
            e.get("from_node"),
            e.get("back"),
        )
        assert isinstance(gid, int) and isinstance(node, int)
        assert isinstance(edge, int) and isinstance(from_node, int) and isinstance(back, bool)
        if gid in state.groups and state.groups[gid].location == AtNode(node):
            result[gid] = _Arrival(node, edge, from_node, back)
    return result


@dataclass(frozen=True, slots=True)
class _OnEdge:
    """A group on an edge for rule 6: where it heads and its progress towards that end."""

    gid: int
    owner: int
    edge: int
    heading: int
    progress: int
    back: bool


def _edge_presence(state: GameState, arrivals: dict[int, _Arrival]) -> list[_OnEdge]:
    mapdef = state.map
    result: list[_OnEdge] = []
    for gid in sorted(state.groups):
        g = state.groups[gid]
        loc = g.location
        if isinstance(loc, OnEdge):
            if loc.back:
                result.append(
                    _OnEdge(
                        gid, g.owner, loc.edge, loc.from_node, PROGRESS_SCALE - loc.progress, True
                    )
                )
            else:
                far = mapdef.edges[loc.edge].other(loc.from_node)
                result.append(_OnEdge(gid, g.owner, loc.edge, far, loc.progress, False))
        elif gid in arrivals:
            a = arrivals[gid]
            result.append(_OnEdge(gid, g.owner, a.edge, a.node, PROGRESS_SCALE, a.back))
    return result


def _meet(x: _OnEdge, y: _OnEdge) -> bool:
    # TODO(#133): two bouncing groups do not meet (they bounced off each other).
    return x.progress + y.progress >= PROGRESS_SCALE and not (x.back and y.back)


def _edge_meetings(
    state: GameState, arrivals: dict[int, _Arrival], bonus: Mapping[int, Bonus]
) -> list[Event]:
    """Rule 6. One fight per edge and direction of player 0's groups; fights are disjoint."""
    presence = _edge_presence(state, arrivals)
    events: list[Event] = []
    for eid in sorted(dict.fromkeys(p.edge for p in presence)):
        here = [p for p in presence if p.edge == eid]
        edge = state.map.edges[eid]
        for heading in (edge.a, edge.b):
            # The groups of a fight for one direction are not in the fight for the other one.
            side0 = [p for p in here if p.owner == 0 and p.heading == heading]
            side1 = [p for p in here if p.owner == 1 and p.heading != heading]
            met0 = [x for x in side0 if any(_meet(x, y) for y in side1)]
            met1 = [y for y in side1 if any(_meet(x, y) for x in side0)]
            if met0 and met1:
                events.extend(_edge_fight(state, eid, met0, met1, arrivals, bonus))
    return events


def _edge_fight(
    state: GameState,
    eid: int,
    met0: list[_OnEdge],
    met1: list[_OnEdge],
    arrivals: dict[int, _Arrival],
    bonus: Mapping[int, Bonus],
) -> list[Event]:
    groups = {0: [state.groups[p.gid] for p in met0], 1: [state.groups[p.gid] for p in met1]}
    before = _snapshot(groups)
    sides = {p: _side(groups[p], bonus) for p in PLAYERS}
    r0, r1 = resolve_fight(sides[0], sides[1], None)
    results = {0: r0, 1: r1}
    _apply(state, groups, sides)
    bounce: dict[int, bool] = {}
    for p in PLAYERS:
        other = 1 - p
        # The weaker side bounces, a surviving stronger one goes on; on a draw both bounce.
        bounce[p] = results[p].pool <= results[other].pool
    for p in PLAYERS:
        for g in groups[p]:
            if g.id in state.groups and bounce[p]:
                _bounce_from_edge(state, g, arrivals)
            elif g.id not in state.groups:
                arrivals.pop(g.id, None)
    return _fight_events(state, groups, before, results, bounce, edge=eid, node=None, attacker=None)


def _bounce_from_edge(state: GameState, g: Group, arrivals: dict[int, _Arrival]) -> None:
    loc = g.location
    if isinstance(loc, OnEdge):
        g.location = OnEdge(loc.edge, loc.from_node, loc.progress, back=True)
    else:
        a = arrivals.pop(g.id)
        if not a.back:  # a group that came home is already where a bounce would take it
            g.location = OnEdge(a.edge, a.from_node, PROGRESS_SCALE, back=True)
    g.order = None


def _node_fight(
    state: GameState,
    rules: Ruleset,
    node_id: int,
    arrivals: dict[int, _Arrival],
    bonus: Mapping[int, Bonus],
) -> list[Event]:
    node = state.nodes[node_id]
    here: dict[int, list[Group]] = {p: [] for p in PLAYERS}
    for gid in sorted(state.groups):
        g = state.groups[gid]
        if g.location == AtNode(node_id):
            here[g.owner].append(g)
    tick = state.tick
    owner = node.owner
    if owner is None:
        if not (here[0] and here[1]):
            return []  # one player only: movement captured it (settle_arrivals)
        attacker = None
        groups = here
        defense_mod = None
    else:
        attacker = 1 - owner
        if not here[attacker]:
            return []
        if not here[owner]:  # row 5: an empty enemy node is taken without a fight
            events = change_owner(state, node_id, attacker)
            return [*events, event(tick, "node_captured", node=node_id, player=attacker)]
        groups = here
        defense_mod = rules.terrain.defense_mod.of(state.map.nodes[node_id].terrain)
    before = _snapshot(groups)
    first = 0 if attacker is None else attacker
    second = 1 - first
    sides = {p: _side(groups[p], bonus) for p in PLAYERS}
    ra, rb = resolve_fight(sides[first], sides[second], defense_mod)
    results = {first: ra, second: rb}
    _apply(state, groups, sides)
    alive = {p: any(g.id in state.groups for g in groups[p]) for p in PLAYERS}
    if attacker is None:
        bounce = {p: alive[0] and alive[1] for p in PLAYERS}
        winner = next((p for p in PLAYERS if alive[p] and not alive[1 - p]), None)
    else:
        bounce = {attacker: alive[second], second: False}
        winner = None if alive[second] else attacker
    for p in PLAYERS:
        for g in groups[p]:
            if g.id in state.groups and bounce[p]:
                a = arrivals.pop(g.id, None)
                if a is None:
                    raise ValueError(f"group {g.id} stands in node {node_id} without an arrival")
                g.location = OnEdge(a.edge, a.from_node, PROGRESS_SCALE, back=True)
                g.order = None
    events = _fight_events(
        state, groups, before, results, bounce, edge=None, node=node_id, attacker=attacker
    )
    if winner is not None:
        events.extend(change_owner(state, node_id, winner))
        events.append(event(tick, "node_captured", node=node_id, player=winner))
    return events


def _side(groups: list[Group], bonus: Mapping[int, Bonus]) -> Side:
    planned = defense = 0
    for g in groups:
        b = bonus.get(g.id)
        if b is None:
            continue
        if b.source is BonusSource.PLANNED_ORDER:
            planned += b.amount
        else:
            defense += b.amount
    fighters = [Fighter(g.id, g.units, g.charged, g.mode in FIRING_MODES) for g in groups]
    return Side(fighters, bonus=planned, defense_bonus=defense)


def _snapshot(groups: dict[int, list[Group]]) -> dict[int, tuple[int, int]]:
    return {g.id: (g.units, g.charged) for p in PLAYERS for g in groups[p]}


def _apply(state: GameState, groups: dict[int, list[Group]], sides: dict[int, Side]) -> None:
    """Write the fighters back; a group without units is removed; builds stop (SIM-11)."""
    for p in PLAYERS:
        for g, f in zip(groups[p], sides[p].groups, strict=True):
            g.units, g.charged = f.units, f.charged
            interrupt_build(g)
            if g.units == 0:
                del state.groups[g.id]


def _fight_events(
    state: GameState,
    groups: dict[int, list[Group]],
    before: dict[int, tuple[int, int]],
    results: dict[int, SideResult],
    bounce: dict[int, bool],
    *,
    edge: int | None,
    node: int | None,
    attacker: int | None,
) -> list[Event]:
    tick = state.tick
    events = [
        event(
            tick,
            "fight",
            node=node,
            edge=edge,
            attacker=attacker,
            pool_0=results[0].pool,
            pool_1=results[1].pool,
            unspent_0=results[0].unspent,
            unspent_1=results[1].unspent,
            losses_0=results[0].losses,
            losses_1=results[1].losses,
        )
    ]
    for p in PLAYERS:
        for g in groups[p]:
            units, charged = before[g.id]
            destroyed = g.id not in state.groups
            events.append(
                event(
                    tick,
                    "fight_group",
                    group=g.id,
                    player=p,
                    units_before=units,
                    charged_before=charged,
                    units=g.units,
                    charged=g.charged,
                    destroyed=destroyed,
                    bounce=bounce[p] and not destroyed,
                )
            )
    return events
