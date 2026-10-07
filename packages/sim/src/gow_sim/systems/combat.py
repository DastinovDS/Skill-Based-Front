"""Combat (SIM-09): fights by DEC-07 (mechanics.md, section 4, «Разрешение боя», rules 1-9).

Every charge is one shot: it either cancels an enemy shot or kills one enemy unit.

The core is ``resolve_fight()``, a pure function of the two sides; the bonuses of the sides are
its input (their source, planned orders and «Защита», is ``systems.orders``, SIM-10). The
``combat`` system runs after ``movement`` (rule 8: all moves and arrivals first, then all
fights) and reads the ``group_arrived`` events of the tick from ``state.events``:

1. Edge meetings first (rule 6): groups of the two players going towards each other along one
   edge meet when their progress towards their ends sums to at least 1000; a group that arrived
   in this tick counts with 1000 on its arrival edge. A meeting is the tick in which they pass
   each other: a pair whose sum was already at least 1000 at the start of the tick has met
   before and does not meet again (#175: a bouncing group that loses goes on home, the winner
   goes on, and they move apart). A symmetric fight without terrain; the loser bounces, a
   surviving winner goes on, on a draw both bounce.
2. Then the nodes, in id order (each node is its own fight, so the order changes nothing):
   foreign groups in a player's node attack it (rule 4, row 5: an empty node is taken without a
   fight); both players in a neutral node fight symmetrically (rule 5). If the defender is wiped
   out the node goes to the attacker through ``change_owner()``, otherwise the attackers bounce;
   in a neutral node both sides bounce unless one is wiped out.

A bounce (``OnEdge.back``) takes the group back along its edge to the node it came from and
takes as long as the group has been on the edge; the order is dropped. A bounce into a node
that became foreign meanwhile is an ordinary arrival there, with its own fight (rule 4), also
when the group met an enemy on the edge in its arrival tick and bounced there: that bounce
takes it home anyway (#175). Nobody
flees on their own (rule 9): discharged groups stay until ordered away.

Details that DEC-07 leaves open follow the defaults of #133 (see ``TODO(#133)`` below).
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum

from gow_sim.maps import PLAYERS
from gow_sim.ruleset import Ruleset
from gow_sim.state import PROGRESS_SCALE, AtNode, Event, GameState, Group, OnEdge, event
from gow_sim.systems.capacity import change_owner
from gow_sim.systems.movement import traversal_ticks

__all__ = [
    "Bonus",
    "BonusSource",
    "Fighter",
    "Side",
    "SideResult",
    "combat",
    "resolve_fight",
]


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
    """Every charged unit shoots (rule 1; DEC-16 removed the non-firing «Строительство»)."""


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
    firing = sum(g.charged for g in side.groups)
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
            (g for g in side.groups if g.charged > 0),
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

    ``bonuses``: group id to the bonus the group brings into its next fight
    (``systems.orders.active_bonuses``, SIM-10). A group that fought loses its bonus whether it
    was used or not (rule 3): a winner of an edge meeting that goes on into a node in the same
    tick fights there without it; the ``fight_group`` events name those groups for the
    ``orders`` system. Emits ``fight``, ``fight_group`` and ``node_captured``.
    """
    bonus = dict(bonuses or {})
    arrivals = _arrivals(state)
    events = _edge_meetings(state, rules, arrivals, bonus)
    # Standing groups by node, in id order, taken after the edge meetings. A node fight only
    # moves (bounces) or kills the groups of its own node, so the index stays right for the
    # nodes after it; ``_node_fight`` still checks each group against the current state.
    standing: dict[int, list[Group]] = {}
    for gid in sorted(state.groups):
        g = state.groups[gid]
        if isinstance(g.location, AtNode):
            standing.setdefault(g.location.node, []).append(g)
    for node_id in sorted(state.nodes):
        here = standing.get(node_id)
        if here is not None:
            events.extend(_node_fight(state, rules, node_id, here, arrivals, bonus))
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
    before: int
    """``progress`` at the start of the tick, before this tick's step of ``movement``."""


def _spent(progress: int, ticks: int) -> int:
    """Ticks behind ``progress = spent * 1000 // ticks`` (as ``movement`` recovers them)."""
    return (progress * ticks + PROGRESS_SCALE - 1) // PROGRESS_SCALE


def _contested_edges(state: GameState, arrivals: dict[int, _Arrival]) -> dict[int, list[int]]:
    """Edges with groups of both players on them (arrivals count on their edge): edge -> gids."""
    by_edge: dict[int, list[int]] = {}
    for gid in sorted(state.groups):
        loc = state.groups[gid].location
        if isinstance(loc, OnEdge):
            by_edge.setdefault(loc.edge, []).append(gid)
        elif gid in arrivals:
            by_edge.setdefault(arrivals[gid].edge, []).append(gid)
    return {
        eid: gids
        for eid, gids in by_edge.items()
        if len({state.groups[gid].owner for gid in gids}) > 1
    }


def _edge_presence(
    state: GameState, rules: Ruleset, gid: int, arrivals: dict[int, _Arrival]
) -> _OnEdge:
    """A group on an edge or an arrival of the tick, with its progress before the tick.

    Every group on an edge has made exactly one step in this tick (commands need a standing
    group, so a group on an edge always moves), so the step is undone with the formulas of
    ``movement``: forward ``spent - 1``, a bounce ``spent + 1``, both on the ticks of the way
    there (``traversal_ticks`` into the far end of the edge). A group that entered the edge in
    this tick was in the node at its start: progress 0.
    """
    mapdef = state.map
    g = state.groups[gid]
    loc = g.location
    if isinstance(loc, OnEdge):
        far = mapdef.edges[loc.edge].other(loc.from_node)
        ticks = traversal_ticks(mapdef, rules, loc.edge, far)
        spent = _spent(loc.progress, ticks)
        if loc.back:
            behind = min(PROGRESS_SCALE, (spent + 1) * PROGRESS_SCALE // ticks)
            return _OnEdge(
                gid,
                g.owner,
                loc.edge,
                loc.from_node,
                PROGRESS_SCALE - loc.progress,
                True,
                PROGRESS_SCALE - behind,
            )
        before = max(0, spent - 1) * PROGRESS_SCALE // ticks
        return _OnEdge(gid, g.owner, loc.edge, far, loc.progress, False, before)
    a = arrivals[gid]
    if a.back:  # one step of the bounce before home: from_node is the far end
        ticks = traversal_ticks(mapdef, rules, a.edge, a.from_node)
        before = PROGRESS_SCALE - PROGRESS_SCALE // ticks
    else:
        ticks = traversal_ticks(mapdef, rules, a.edge, a.node)
        before = (ticks - 1) * PROGRESS_SCALE // ticks
    return _OnEdge(gid, g.owner, a.edge, a.node, PROGRESS_SCALE, a.back, before)


def _meet(x: _OnEdge, y: _OnEdge) -> bool:
    """They pass each other in this tick (#175): the sum reaches 1000 now, not before."""
    # TODO(#133): two bouncing groups do not meet (they bounced off each other).
    return (
        x.progress + y.progress >= PROGRESS_SCALE
        and x.before + y.before < PROGRESS_SCALE
        and not (x.back and y.back)
    )


def _edge_meetings(
    state: GameState, rules: Ruleset, arrivals: dict[int, _Arrival], bonus: dict[int, Bonus]
) -> list[Event]:
    """Rule 6. One fight per edge and direction of player 0's groups; fights are disjoint."""
    contested = _contested_edges(state, arrivals)
    events: list[Event] = []
    for eid in sorted(contested):
        here = [_edge_presence(state, rules, gid, arrivals) for gid in contested[eid]]
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
    bonus: dict[int, Bonus],
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
    if isinstance(loc, OnEdge) and loc.progress == 0 and not loc.back:
        # It has just passed through its own node onto this edge: a bounce lasts as long as the
        # way travelled (rule 6), here zero ticks, so it is back in that node at once (#175).
        g.location = AtNode(loc.from_node)
    elif isinstance(loc, OnEdge):
        g.location = OnEdge(loc.edge, loc.from_node, loc.progress, back=True)
    elif not arrivals[g.id].back:
        a = arrivals.pop(g.id)
        g.location = OnEdge(a.edge, a.from_node, PROGRESS_SCALE, back=True)
    # A group that came home is already where a bounce would take it. It keeps its arrival: if
    # home became foreign meanwhile, the arrival is an attack there with its own fight (rule 4).
    g.order = None


def _node_fight(
    state: GameState,
    rules: Ruleset,
    node_id: int,
    standing: list[Group],
    arrivals: dict[int, _Arrival],
    bonus: dict[int, Bonus],
) -> list[Event]:
    """The fight in ``node_id``; ``standing``: the groups that stood there, in id order."""
    node = state.nodes[node_id]
    here: dict[int, list[Group]] = {p: [] for p in PLAYERS}
    at = AtNode(node_id)
    for g in standing:
        if g.location == at and state.groups.get(g.id) is g:
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


def _side(groups: list[Group], bonus: dict[int, Bonus]) -> Side:
    """The side of ``groups``; takes their bonuses out of ``bonus``: they burn in this fight."""
    planned = defense = 0
    for g in groups:
        b = bonus.pop(g.id, None)
        if b is None:
            continue
        if b.source is BonusSource.PLANNED_ORDER:
            planned += b.amount
        else:
            defense += b.amount
    fighters = [Fighter(g.id, g.units, g.charged) for g in groups]
    return Side(fighters, bonus=planned, defense_bonus=defense)


def _snapshot(groups: dict[int, list[Group]]) -> dict[int, tuple[int, int]]:
    return {g.id: (g.units, g.charged) for p in PLAYERS for g in groups[p]}


def _apply(state: GameState, groups: dict[int, list[Group]], sides: dict[int, Side]) -> None:
    """Write the fighters back; a group without units is removed."""
    for p in PLAYERS:
        for g, f in zip(groups[p], sides[p].groups, strict=True):
            g.units, g.charged = f.units, f.charged
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
