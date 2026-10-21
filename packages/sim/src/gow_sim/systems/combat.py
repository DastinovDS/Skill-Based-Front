"""Combat: fights over time by DEC-24 (mechanics.md, section 4, «Бой во времени»).

Every charge is one shot: it either cancels an enemy shot or kills one enemy unit (DEC-07, rules
1-3, 5-7 and 9 hold inside a round). A fight is a ``Fight`` in ``GameState.fights`` that lasts
over ticks; its groups carry its id in ``Group.fight`` and do not move (item B6).

The ``combat`` system runs after ``movement`` (all moves and arrivals first, then all fights) and
reads the ``group_arrived`` events of the tick from ``state.events``. In one tick (item C5):

1. **Edge meetings** (item C2) on edges without a fight: groups of the two players going towards
   each other meet in the tick their progress towards their ends first sums to at least 1000 (a
   group that arrived in this tick counts with 1000 on its arrival edge and is put back on the
   edge); at least one group of a pair goes forward (#133, item 5). All meetings of an edge in
   one tick are one fight; its ``point`` is the smallest plus the largest position of the met
   groups in thousandths from the end ``a`` (item C3).
2. **Edge reinforcements** (item D2): a group on an edge with a fight (any player, forward or
   back) whose position reached or passed the point in this tick stops there and joins.
3. **Nodes**, in id order (item C1, D1): a group that finished its movement in a node with a fight
   joins its side; foreign groups standing in a player's node without a fight start one (the
   arrivals attack); an empty enemy node is taken at once (DEC-07, row 5); both players arriving
   in a neutral node start a symmetric fight.
4. **Fights**, in id order (they share no group, so the order changes nothing): a round in the
   ticks ``start + k * round_ticks`` (item B), then the groups whose withdrawal was ordered leave
   (item E3), then the end (item B5, G): a side without groups, or no side able to shoot after a
   round or at contact.

At the end of a fight (item G): a node goes to the attacker if no defender is left, otherwise
the attackers bounce, and a group that came back into its lost node and did not take it dies
(item G3: no chain of bounces); in a neutral node a lone survivor takes it, two bounce; on an edge
the side that made more shots wins (a side without groups loses), the loser bounces from where it
stands, the winner goes on ``combat.regroup_ticks`` after the end (item G4). A bounce
(``OnEdge.back``) goes back along the group's own steps; the order is dropped.

Bonuses (item F): the active bonus of a group (``systems.orders.active_bonuses``) enters the
virtual shots of its side when the group joins the fight and burns with the fight; «Защита» and
the terrain of the node count only for a defender that has a charged unit at contact, and
«Защита» only for groups standing there from the start. Mountains add virtual shots, plains
silence real ones in every round (``terrain.defense_mod``).

Events: ``fight_started``, ``fight_round``, ``fight_ended`` (both players, every field: the
shots of both sides with the virtual ones apart, the spent charges and the losses; DEC-24 items
I1, I2 as revised with DEC-29), ``fight_group`` (the owner of the group: at the end of the fight
and when the group withdraws), ``node_captured``. The latest round stays in ``Fight.last_round``
for the view; the virtual shots still left (``Fight.virtual``) stay hidden.
"""

from collections.abc import Mapping
from dataclasses import dataclass, replace
from enum import StrEnum

from gow_sim.maps import PLAYERS
from gow_sim.ruleset import Ruleset
from gow_sim.state import (
    PROGRESS_SCALE,
    AtNode,
    Event,
    Fight,
    FightMember,
    FightRound,
    GameState,
    Group,
    OnEdge,
    Order,
    event,
)
from gow_sim.systems.capacity import change_owner
from gow_sim.systems.movement import edge_between, leg

__all__ = [
    "Bonus",
    "BonusSource",
    "Fighter",
    "RoundResult",
    "Side",
    "can_fire",
    "combat",
    "play_round",
]


class BonusSource(StrEnum):
    PLANNED_ORDER = "planned_order"
    DEFENSE_MODE = "defense_mode"


@dataclass(frozen=True, slots=True)
class Bonus:
    """A bonus of a group for its next fight, in virtual shots (DEC-08, DEC-24 item F1)."""

    source: BonusSource
    amount: int


# The round ---------------------------------------------------------------------------------------


@dataclass(slots=True)
class Fighter:
    """A group in a round: its counters, changed in place by ``play_round()``."""

    id: int
    units: int
    charged: int


@dataclass(slots=True)
class Side:
    """One side of a round; ``groups`` in ascending id order (ties by id inside a player).

    ``virtual``: virtual shots left (bonuses, mountains); ``mute``: real charges silent in every
    round (plains, DEC-24 item F2).
    """

    groups: list[Fighter]
    virtual: int = 0
    mute: int = 0

    def units(self) -> int:
        return sum(g.units for g in self.groups)

    def real(self) -> int:
        return max(0, sum(g.charged for g in self.groups) - self.mute)


@dataclass(frozen=True, slots=True)
class RoundResult:
    """Per player: shots made (cancelled plus killing ones), the virtual ones among them, the
    units lost, and the charges that left the player's units (real shots and charged units
    killed)."""

    shots: tuple[int, int]
    virtual: tuple[int, int]
    losses: tuple[int, int]
    spent: tuple[int, int]


def can_fire(side: Side, enemy: Side) -> bool:
    """The side has a shot left and the enemy a unit to shoot at (item B5)."""
    return side.virtual + side.real() > 0 and enemy.units() > 0


def play_round(sides: tuple[Side, Side], shots_per_round: int) -> RoundResult:
    """One round by DEC-24, item B4; changes the fighters of both sides.

    Both sides fire at once ``f = min(V + R, shots_per_round)`` shots, virtual ones first. Shots
    against each other cancel (``min(f0, f1)`` each, rule 2); the surplus of the stronger side
    kills enemy units, the discharged ones first (rule 3); a shot beyond the enemy's units is not
    spent. Shooter and victim groups are chosen again for every shot (rule 7, #133 item 3).
    """
    fire = [min(s.virtual + s.real(), shots_per_round) for s in sides]
    charged = [sum(g.charged for g in s.groups) for s in sides]
    cancel = min(fire)
    kills = [0, 0]
    for p in PLAYERS:
        if fire[p] > fire[1 - p]:
            kills[p] = min(fire[p] - fire[1 - p], sides[1 - p].units())
    shots = [cancel + kills[p] for p in PLAYERS]
    virtual = [_spend(sides[p], shots[p]) for p in PLAYERS]
    for p in PLAYERS:
        _kill(sides[1 - p], kills[p])
    spent = [charged[p] - sum(g.charged for g in sides[p].groups) for p in PLAYERS]
    return RoundResult(
        shots=(shots[0], shots[1]),
        virtual=(virtual[0], virtual[1]),
        losses=(kills[1], kills[0]),
        spent=(spent[0], spent[1]),
    )


def _spend(side: Side, shots: int) -> int:
    """Spend ``shots``: virtual first, then real ones from the group with the most charged (ties:
    lower id). Returns the virtual shots spent."""
    virtual = min(shots, side.virtual)
    side.virtual -= virtual
    for _ in range(shots - virtual):
        shooter = max(
            (g for g in side.groups if g.charged > 0),
            key=lambda g: (g.charged, -g.id),
        )
        shooter.charged -= 1
    return virtual


def _kill(side: Side, kills: int) -> None:
    """``kills`` units die: discharged ones first (the group with the most units among those that
    have one), then charged ones of the largest group; ties: lower id."""
    for _ in range(kills):
        alive = [g for g in side.groups if g.units > 0]
        discharged = [g for g in alive if g.units > g.charged]
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
    planned: bool
    level: int
    """The road level the group crossed the edge at (``OnEdge.level``, DEC-28, item 7)."""


def combat(
    state: GameState, rules: Ruleset, bonuses: Mapping[int, Bonus] | None = None
) -> list[Event]:
    """The combat system (see the module docstring).

    ``bonuses``: group id to the active bonus the group brings into a fight it joins in this tick
    (``systems.orders.active_bonuses``). A joining group's active bonus is taken off the group:
    it enters the fight (if it counts there) and burns with it.
    """
    bonus = dict(bonuses or {})
    arrivals = _arrivals(state)
    busy = {f.edge: fid for fid, f in sorted(state.fights.items()) if f.edge is not None}
    events = _edge_meetings(state, rules, arrivals, bonus, busy)
    _edge_joins(state, rules, arrivals, bonus)
    events.extend(_node_contacts(state, rules, arrivals, bonus))
    for fid in sorted(state.fights):
        events.extend(_run(state, rules, state.fights[fid]))
    return events


def _arrivals(state: GameState) -> dict[int, _Arrival]:
    result: dict[int, _Arrival] = {}
    for e in state.events:
        if e.tick != state.tick or e.kind != "group_arrived":
            continue
        gid, node, edge = e.get("group"), e.get("node"), e.get("edge")
        from_node, back, planned = e.get("from_node"), e.get("back"), e.get("planned")
        level = e.get("level")
        assert isinstance(gid, int) and isinstance(node, int)
        assert isinstance(edge, int) and isinstance(from_node, int)
        assert isinstance(back, bool) and isinstance(planned, bool) and isinstance(level, int)
        if gid in state.groups and state.groups[gid].location == AtNode(node):
            result[gid] = _Arrival(node, edge, from_node, back, planned, level)
    return result


# Edges -----------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class _OnEdge:
    """A group on an edge: where it heads, its progress towards that end now and at the start of
    the tick, and the same as positions in thousandths from the end ``a`` of the edge."""

    gid: int
    owner: int
    edge: int
    heading: int
    progress: int
    back: bool
    before: int
    pos: int
    pos_before: int


def _edge_presence(
    state: GameState, rules: Ruleset, gid: int, arrivals: dict[int, _Arrival]
) -> _OnEdge:
    """A group on an edge or an arrival of the tick, with its progress before the tick.

    A group on an edge moved one step in this tick unless it waits (the regroup pause of an
    edge winner, item G4): the step is undone with the formulas of ``movement``, forward
    ``spent - 1``, back ``spent + 1``, on the steps of the way there. A group that entered the
    edge in this tick was in the node at its start: progress 0.
    """
    mapdef = state.map
    g = state.groups[gid]
    loc = g.location
    if isinstance(loc, OnEdge):
        far = mapdef.edges[loc.edge].other(loc.from_node)
        way = leg(mapdef, rules, loc.edge, far, loc.level)
        spent = way.spent(loc.progress)
        if loc.back:
            heading, progress = loc.from_node, PROGRESS_SCALE - loc.progress
            before = PROGRESS_SCALE - way.progress(spent + 1)
        else:
            heading, progress = far, loc.progress
            waits = g.order is None or state.tick < g.order.depart_tick
            before = progress if waits else way.progress(max(0, spent - 1))
        return _presence(state, gid, loc.edge, heading, progress, loc.back, before)
    a = arrivals[gid]
    if a.back:  # one step of the bounce before home: from_node is the far end
        before = PROGRESS_SCALE - leg(mapdef, rules, a.edge, a.from_node, a.level).progress(1)
    else:
        way = leg(mapdef, rules, a.edge, a.node, a.level)
        before = way.progress(way.ticks - 1)
    return _presence(state, gid, a.edge, a.node, PROGRESS_SCALE, a.back, before)


def _presence(
    state: GameState, gid: int, edge: int, heading: int, progress: int, back: bool, before: int
) -> _OnEdge:
    """``progress`` and ``before`` are towards ``heading``; positions are from the end ``a``."""
    to_b = heading == state.map.edges[edge].b
    pos = progress if to_b else PROGRESS_SCALE - progress
    pos_before = before if to_b else PROGRESS_SCALE - before
    owner = state.groups[gid].owner
    return _OnEdge(gid, owner, edge, heading, progress, back, before, pos, pos_before)


def _on_edges(state: GameState, arrivals: dict[int, _Arrival]) -> dict[int, list[int]]:
    """Groups on every edge outside fights, arrivals of the tick on their edge: edge -> gids."""
    by_edge: dict[int, list[int]] = {}
    for gid in sorted(state.groups):
        g = state.groups[gid]
        if g.fight is not None:
            continue
        loc = g.location
        if isinstance(loc, OnEdge):
            by_edge.setdefault(loc.edge, []).append(gid)
        elif gid in arrivals:
            by_edge.setdefault(arrivals[gid].edge, []).append(gid)
    return by_edge


def _meet(x: _OnEdge, y: _OnEdge) -> bool:
    """They pass each other in this tick (#175): the sum reaches 1000 now, not before; one of
    them at least goes forward (#133, item 5)."""
    return (
        x.heading != y.heading
        and x.progress + y.progress >= PROGRESS_SCALE
        and x.before + y.before < PROGRESS_SCALE
        and not (x.back and y.back)
    )


def _edge_meetings(
    state: GameState,
    rules: Ruleset,
    arrivals: dict[int, _Arrival],
    bonus: dict[int, Bonus],
    busy: dict[int, int],
) -> list[Event]:
    """Item C2: new fights on edges without one; every meeting of an edge in a tick is one fight."""
    events: list[Event] = []
    by_edge = _on_edges(state, arrivals)
    for eid in sorted(by_edge):
        if eid in busy:
            continue  # item C4: one fight per edge; the groups join it at its point instead
        here = [_edge_presence(state, rules, gid, arrivals) for gid in by_edge[eid]]
        side0 = [x for x in here if x.owner == 0]
        side1 = [y for y in here if y.owner == 1]
        met = [x for x in side0 if any(_meet(x, y) for y in side1)]
        met += [y for y in side1 if any(_meet(x, y) for x in side0)]
        if not met:
            continue
        point = min(x.pos for x in met) + max(x.pos for x in met)
        fight = _new_fight(state, rules, node=None, edge=eid, point=point, attacker=None)
        events.append(_started(state, fight))
        for x in sorted(met, key=lambda x: x.gid):
            _join_edge(state, fight, x, arrivals, bonus)
    return events


def _edge_joins(
    state: GameState, rules: Ruleset, arrivals: dict[int, _Arrival], bonus: dict[int, Bonus]
) -> None:
    """Item D2: a group whose position reached or passed the point of its edge's fight in this
    tick stops where it is and joins."""
    by_edge = _on_edges(state, arrivals)
    for fid in sorted(state.fights):
        fight = state.fights[fid]
        if fight.edge is None or fight.edge not in by_edge:
            continue
        point = fight.point
        assert point is not None
        for gid in by_edge[fight.edge]:
            if state.groups[gid].fight is not None:
                continue
            x = _edge_presence(state, rules, gid, arrivals)
            to_b = x.heading == state.map.edges[x.edge].b
            if to_b:
                crossed = 2 * x.pos >= point > 2 * x.pos_before
            else:
                crossed = 2 * x.pos <= point < 2 * x.pos_before
            if crossed:
                _join_edge(state, fight, x, arrivals, bonus)


def _join_edge(
    state: GameState,
    fight: Fight,
    x: _OnEdge,
    arrivals: dict[int, _Arrival],
    bonus: dict[int, Bonus],
) -> None:
    """``x`` stops on the edge where it is and joins ``fight``; an arrival of this tick is put back
    on its edge (forward: at 1000 with its order to the node; back: at 0 of the way home)."""
    g = state.groups[x.gid]
    a = arrivals.pop(x.gid, None)
    if a is not None:
        if a.back:
            g.location = OnEdge(a.edge, a.node, 0, back=True, level=a.level)
        else:
            g.location = OnEdge(a.edge, a.from_node, PROGRESS_SCALE, level=a.level)
            g.order = Order((a.node,), a.planned, state.tick)
    _join(fight, g, FightMember(g.owner, g.units, g.charged), bonus, defense=False)


# Nodes -----------------------------------------------------------------------------------------


def _node_contacts(
    state: GameState, rules: Ruleset, arrivals: dict[int, _Arrival], bonus: dict[int, Bonus]
) -> list[Event]:
    """Items C1 and D1, node by node in id order."""
    standing: dict[int, list[Group]] = {}
    for gid in sorted(state.groups):
        g = state.groups[gid]
        if g.fight is None and isinstance(g.location, AtNode):
            standing.setdefault(g.location.node, []).append(g)
    fight_at = state.fight_nodes()
    events: list[Event] = []
    for node_id in sorted(standing):
        here = standing[node_id]
        if node_id in fight_at:  # item D1: every group that finished here joins its side
            fight = state.fights[fight_at[node_id]]
            for g in here:
                _join(fight, g, _node_member(g, arrivals), bonus, defense=False)
            continue
        owners = {p: [g for g in here if g.owner == p] for p in PLAYERS}
        owner = state.nodes[node_id].owner
        if owner is None:
            if not (owners[0] and owners[1]):
                continue  # one player only: movement captured it (settle_arrivals)
            attacker = None
        else:
            attacker = 1 - owner
            if not owners[attacker]:
                continue
            if not owners[owner]:  # DEC-07, row 5: an empty enemy node is taken without a fight
                events.extend(change_owner(state, node_id, attacker))
                events.append(event(state.tick, "node_captured", node=node_id, player=attacker))
                continue
        for g in here:
            if g.owner != owner and g.id not in arrivals:
                raise ValueError(f"group {g.id} stands in node {node_id} without an arrival")
        fight = _new_fight(state, rules, node=node_id, edge=None, point=None, attacker=attacker)
        events.append(_started(state, fight))
        defender = None if attacker is None else 1 - attacker
        if defender is not None and sum(g.charged for g in owners[defender]) > 0:
            # Item F2: the defender has a charged unit at contact, so terrain counts to the end.
            mod = rules.terrain.defense_mod.of(state.map.nodes[node_id].terrain)
            _add_virtual(fight, defender, max(0, mod))
            mute = [0, 0]
            mute[defender] = max(0, -mod)
            fight.mute = (mute[0], mute[1])
            armed = True
        else:
            armed = False
        for g in here:
            _join(fight, g, _node_member(g, arrivals), bonus, defense=armed and g.owner == defender)
    return events


def _node_member(g: Group, arrivals: dict[int, _Arrival]) -> FightMember:
    a = arrivals.get(g.id)
    if a is None:
        return FightMember(g.owner, g.units, g.charged)
    return FightMember(
        g.owner,
        g.units,
        g.charged,
        edge=a.edge,
        from_node=a.from_node,
        returning=a.back,
        arrived=True,
    )


# Joining ---------------------------------------------------------------------------------------


def _new_fight(
    state: GameState,
    rules: Ruleset,
    *,
    node: int | None,
    edge: int | None,
    point: int | None,
    attacker: int | None,
) -> Fight:
    fid = state.new_id()
    fight = Fight(
        id=fid,
        node=node,
        edge=edge,
        point=point,
        attacker=attacker,
        start=state.tick,
        next_round=state.tick + rules.combat.round_ticks,
        virtual=(0, 0),
        mute=(0, 0),
        shots=(0, 0),
        losses=(0, 0),
        members={},
    )
    state.fights[fid] = fight
    return fight


def _join(
    fight: Fight, g: Group, member: FightMember, bonus: dict[int, Bonus], *, defense: bool
) -> None:
    """``g`` joins ``fight`` with its active bonus (item F1): a planned bonus always counts,
    «Защита» only when ``defense`` (a defender of the node from the start with a charged unit,
    item F2). The active bonus leaves the group either way: it burns with this fight."""
    fight.members[g.id] = member
    g.fight = fight.id
    b = bonus.pop(g.id, None)
    if b is None:
        return
    g.bonus = 0
    g.bonus_tick = 0
    if b.source is BonusSource.PLANNED_ORDER or defense:
        _add_virtual(fight, g.owner, b.amount)


def _add_virtual(fight: Fight, player: int, amount: int) -> None:
    v = [fight.virtual[0], fight.virtual[1]]
    v[player] += amount
    fight.virtual = (v[0], v[1])


def _started(state: GameState, fight: Fight) -> Event:
    return event(
        state.tick,
        "fight_started",
        fight=fight.id,
        node=fight.node,
        edge=fight.edge,
        point=fight.point,
        attacker=fight.attacker,
    )


# A fight in a tick -------------------------------------------------------------------------------


def _live(state: GameState, fight: Fight, player: int) -> list[Group]:
    """The groups of ``player`` still in ``fight``, in id order."""
    return [
        state.groups[gid]
        for gid, m in sorted(fight.members.items())
        if m.player == player and gid in state.groups
    ]


def _sides(state: GameState, fight: Fight) -> tuple[Side, Side]:
    sides = [
        Side(
            [Fighter(g.id, g.units, g.charged) for g in _live(state, fight, p)],
            fight.virtual[p],
            fight.mute[p],
        )
        for p in PLAYERS
    ]
    return (sides[0], sides[1])


def _run(state: GameState, rules: Ruleset, fight: Fight) -> list[Event]:
    """The round of this tick (if it is one), the withdrawals after it, and the end."""
    events: list[Event] = []
    tick = state.tick
    checked = tick == fight.start  # at contact (item B5) or after a round
    if tick == fight.next_round:
        events.append(_round(state, rules, fight))
        fight.next_round += rules.combat.round_ticks
        events.extend(_withdraw(state, rules, fight))
        checked = True
    sides = _sides(state, fight)
    alive = [bool(s.groups) for s in sides]
    stuck = checked and not any(can_fire(sides[p], sides[1 - p]) for p in PLAYERS)
    if not (alive[0] and alive[1]) or stuck:
        events.extend(_end(state, rules, fight))
    return events


def _round(state: GameState, rules: Ruleset, fight: Fight) -> Event:
    sides = _sides(state, fight)
    result = play_round(sides, rules.combat.shots_per_round)
    for p in PLAYERS:
        for f in sides[p].groups:
            g = state.groups[f.id]
            g.units, g.charged = f.units, f.charged
            if g.units == 0:
                del state.groups[g.id]
    fight.virtual = (sides[0].virtual, sides[1].virtual)
    fight.shots = (fight.shots[0] + result.shots[0], fight.shots[1] + result.shots[1])
    fight.losses = (fight.losses[0] + result.losses[0], fight.losses[1] + result.losses[1])
    fight.last_round = FightRound(
        state.tick, result.shots, result.virtual, result.spent, result.losses
    )
    return event(
        state.tick,
        "fight_round",
        fight=fight.id,
        node=fight.node,
        edge=fight.edge,
        point=fight.point,
        shots_0=result.shots[0],
        shots_1=result.shots[1],
        virtual_0=result.virtual[0],
        virtual_1=result.virtual[1],
        losses_0=result.losses[0],
        losses_1=result.losses[1],
        spent_0=result.spent[0],
        spent_1=result.spent[1],
    )


def _withdraw(state: GameState, rules: Ruleset, fight: Fight) -> list[Event]:
    """Item E3: the live groups with a withdrawal leave after the round. A defender of a node
    goes on its ``Move`` (it is on the first edge of its path at once, the first step in the next
    tick); everyone else turns back along the edge it stands on or came over, like a bounce."""
    del rules
    events: list[Event] = []
    for gid, m in sorted(fight.members.items()):
        g = state.groups.get(gid)
        if g is None or not m.leaving:
            continue
        loc = g.location
        if isinstance(loc, OnEdge):
            g.location = OnEdge(loc.edge, loc.from_node, loc.progress, back=True, level=loc.level)
            g.order = None
        elif m.edge is not None and m.from_node is not None:  # an attacker of the node
            level = state.edges[m.edge].width  # a new start on the edge (DEC-28, item 7)
            g.location = OnEdge(m.edge, m.from_node, PROGRESS_SCALE, back=True, level=level)
            g.order = None
        else:  # a defender with its ``Move``
            node = loc.node
            nxt = g.order.path[0] if g.order is not None and g.order.path else None
            eid = None if nxt is None else edge_between(state.map, node, nxt)
            if eid is not None:
                g.location = OnEdge(eid, node, 0, level=state.edges[eid].width)
        del fight.members[gid]
        g.fight = None
        events.append(_group_event(state, gid, m, g, left=True))
    return events


def _end(state: GameState, rules: Ruleset, fight: Fight) -> list[Event]:
    """Item G: capture, bounces, deaths of returning groups, the regroup of an edge winner."""
    tick = state.tick
    live = {p: _live(state, fight, p) for p in PLAYERS}
    alive = {p: bool(live[p]) for p in PLAYERS}
    winner: int | None
    captured = False
    bounce = {p: False for p in PLAYERS}
    losses = [fight.losses[0], fight.losses[1]]
    encircled: dict[int, tuple[int, int]] = {}
    if fight.edge is not None:  # item G4
        if alive[0] and alive[1]:
            s0, s1 = fight.shots
            winner = 0 if s0 > s1 else 1 if s1 > s0 else None
        else:
            winner = next((p for p in PLAYERS if alive[p]), None)
        for p in PLAYERS:
            bounce[p] = winner != p and alive[p]
            for g in live[p]:
                loc = g.location
                assert isinstance(loc, OnEdge)
                if loc.back:
                    continue  # a returning group goes on home either way
                if winner == p and g.order is not None:
                    regroup = tick + rules.combat.regroup_ticks
                    g.order = Order(g.order.path, g.order.planned, regroup)
                else:
                    g.location = replace(loc, back=True)
                    g.order = None
    else:
        node = fight.node
        assert node is not None
        attacker = fight.attacker
        if attacker is None:  # a neutral node (item G2)
            takers = [p for p in PLAYERS if alive[p]]
            winner = takers[0] if len(takers) == 1 else None
            bounce = {p: alive[0] and alive[1] for p in PLAYERS}
        else:  # item G1
            defender = 1 - attacker
            if alive[attacker] and not alive[defender]:
                winner = attacker
            else:
                winner = defender if alive[defender] else None
                bounce[attacker] = alive[attacker]
        if winner is not None and state.nodes[node].owner != winner:
            captured = True
        for p in PLAYERS:
            if not bounce[p]:
                continue
            for g in live[p]:
                m = fight.members[g.id]
                if m.returning:  # item G3: back in its lost node and it did not take it
                    losses[p] += g.units
                    encircled[g.id] = (g.units, g.charged)
                    del state.groups[g.id]
                    continue
                if m.edge is None or m.from_node is None:
                    raise ValueError(f"group {g.id} bounces from node {node} without a way back")
                level = state.edges[m.edge].width  # a new start on the edge (DEC-28, item 7)
                g.location = OnEdge(m.edge, m.from_node, PROGRESS_SCALE, back=True, level=level)
                g.order = None
    fight.losses = (losses[0], losses[1])
    events = [
        event(
            tick,
            "fight_ended",
            fight=fight.id,
            node=fight.node,
            edge=fight.edge,
            point=fight.point,
            attacker=fight.attacker,
            start=fight.start,
            winner=winner,
            captured=captured,
            shots_0=fight.shots[0],
            shots_1=fight.shots[1],
            losses_0=fight.losses[0],
            losses_1=fight.losses[1],
        )
    ]
    for gid, m in sorted(fight.members.items()):
        g = state.groups.get(gid)
        if g is not None:
            g.fight = None
        events.append(
            _group_event(
                state,
                gid,
                m,
                g,
                bounce=bounce[m.player] and g is not None,
                encircled=encircled.get(gid),
            )
        )
    del state.fights[fight.id]
    if captured and fight.node is not None and winner is not None:
        events.extend(change_owner(state, fight.node, winner))
        events.append(event(tick, "node_captured", node=fight.node, player=winner))
    return events


def _group_event(
    state: GameState,
    gid: int,
    m: FightMember,
    g: Group | None,
    *,
    bounce: bool = False,
    left: bool = False,
    encircled: tuple[int, int] | None = None,
) -> Event:
    """``fight_group``: the counters of the group when it joined and now; a group that died by
    item G3 (``encircled``) has the counters it died with (its charges are lost with it)."""
    units, charged = (0, 0) if g is None else (g.units, g.charged)
    if encircled is not None:
        units, charged = encircled
    return event(
        state.tick,
        "fight_group",
        group=gid,
        player=m.player,
        units_before=m.units,
        charged_before=m.charged,
        units=units,
        charged=charged,
        destroyed=g is None,
        bounce=bounce,
        left=left,
        encircled=encircled is not None,
        arrived=m.arrived,
    )
