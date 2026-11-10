"""Planned orders and public intents (SIM-10; mechanics.md, section 5, DEC-08, DEC-41 item 10;
DEC-04).

Numbers from ``Ruleset.orders``:

- A planned ``Move`` costs ``orders.cost.planned_move`` and names the requested bonus
  ``Move.bonus >= 1``; the group waits in its node and gathers it (``gather_plans``): one real
  charge of the node's warehouse per ``orders.plan_ticks_per_bonus`` ticks, at most its charged
  units; then it leaves with that bonus of virtual shots for its first fight, at most the charged
  units of the group in the tick it departs (DEC-29, ``movement`` caps it when the group leaves).
- ``CancelOrder`` of any order costs ``orders.cost.cancel`` (0 since DEC-20): a planned order
  while it waits, a move order on an edge (the group turns back).
- A planned order is public: an ``Intent`` with the owner, the kind, the node of the group and the
  target, without the group id or size (DEC-04). The group keeps the link (``Group.intent``); the
  intent names no group.

Commands (SIM-04) set bonuses and intents when applied (``set_intent``, ``clear_bonus``).
Around combat: the combat system gets ``active_bonuses(state)`` and takes the bonus of a
group that joins a fight off the group (it burns with the fight, DEC-24 F1); the ``orders``
system at the end of the step (after ``build``) removes the bonuses and intents whose order ended
in a system: arrival, bounce, death, attrition.

Auto-merge (DEC-20, A), also at the end of the step, after the bonuses: an own group that
finished its movement in an own node in this tick (arrived at its target, came back from a bounce
or a cancel: ``group_arrived``) or appeared by a recruit (``recruited``) joins the target group of
the node: the own group standing there with the smallest id, without an order (not waiting to
depart) and not one of the groups that finished in this tick. Without a target the groups that
finished there join the one with the smallest id. The target keeps its bonus and intent; the
others lose theirs. Groups in transit, waiting
groups and groups on edges never merge.
The target group is chosen among one player's groups only, so the players stay symmetric.

Details that DEC-08 leaves open follow the defaults of #141, accepted by DEC-24 (item L).

Group orders (DEC-48): the members of one ``GroupMove`` link to a ``GroupOrder``
(``Group.group_order``). ``plan_parts`` splits the requested bonus of a planned one (item F2),
``schedule`` times a synchronized arrival (items C2, F4). A planned member that is ready (its part
gathered, or its charged units with a bonus) stops gathering (``Group.plan`` 0) and waits without a
departure tick; ``settle_group_orders`` unlinks the members whose order ended, drops the orders
without a member and fixes the departures of a planned order once its last member is ready: at the
end of the tick of the gathering (the slowest member departs in the next tick), or at once when the
cancel of the last member not ready is applied (item F4). A recruit that got no order for want of
CP (``rally_walk_no_cp``, DEC-48 item H3 as changed by the owner on 2026-11-10) merges like a
recruit.
"""

from gow_sim.ruleset import Ruleset
from gow_sim.state import (
    PLAN_WAIT,
    AtNode,
    Event,
    GameState,
    Group,
    GroupOrder,
    Intent,
    IntentKind,
    Order,
    event,
)
from gow_sim.systems.movement import path_ticks

__all__ = [
    "absorb",
    "active_bonuses",
    "clear_bonus",
    "gather_plans",
    "member_ticks",
    "orders",
    "plan_parts",
    "release_plan",
    "schedule",
    "set_intent",
    "settle_group_orders",
]


def set_intent(
    state: GameState, group: Group, kind: IntentKind | None, target: int | None = None
) -> None:
    """Replace the intent of ``group`` (standing in a node) by a new one, or by none."""
    if group.intent is not None:
        state.intents.pop(group.intent, None)
        group.intent = None
    if kind is None:
        return
    location = group.location
    assert isinstance(location, AtNode)  # commands take only standing groups (#117)
    iid = state.new_id()
    state.intents[iid] = Intent(iid, group.owner, kind, location.node, target, state.tick)
    group.intent = iid


def clear_bonus(group: Group) -> None:
    """The planned bonus ends, and with it a plan that gathers it (DEC-41, item 10)."""
    group.bonus = 0
    group.bonus_tick = 0
    group.plan = 0
    group.plan_tick = 0


def release_plan(group: Group, tick: int) -> None:
    """The gathering plan of ``group`` stops gathering: the group departs at ``tick`` with the
    bonus it has (DEC-41, item 10), which is active from then on; the intent stays."""
    order = group.order
    assert order is not None and order.planned
    group.order = Order(order.path, order.planned, tick)
    group.bonus_tick = tick
    group.plan = 0
    group.plan_tick = 0


def gather_plans(state: GameState, rules: Ruleset) -> list[Event]:
    """DEC-41, item 10: the waiting planned orders gather their bonus.

    In group id order (one player's groups never compete with the other player's: a node holds
    the groups of its owner), a group with a plan (``Group.plan``, the requested bonus) that
    stands in an own node and is in no fight takes one real charge from the warehouse of the
    node once ``orders.plan_ticks_per_bonus`` ticks have passed since the order or its last
    charge, if the warehouse has one and the bonus is below the request and below its charged
    units (the cap of DEC-29); the charge is consumed (``plan_charged``, own player only). The
    units recharged earlier in the tick (``supply`` runs before, P4), and the buildings of the
    node took their payment in ``build`` (TODO(#651): the order of the two sinks). An empty
    warehouse pauses the plan with no timeout: the due charge is taken in the tick stock comes
    (TODO(#651)). The group departs by itself in the next tick (``release_plan``) once its bonus
    reaches the request or, with a bonus, its charged units.
    A member of a group order (DEC-48, item F4) does not depart by itself: once ready it stops
    gathering and waits (``settle_group_orders`` fixes the departures).
    """
    tick = state.tick
    per = rules.orders.plan_ticks_per_bonus
    events: list[Event] = []
    for gid in sorted(state.groups):
        g = state.groups[gid]
        if g.plan == 0 or g.fight is not None or not isinstance(g.location, AtNode):
            continue
        nid = g.location.node
        node = state.nodes[nid]
        if (
            tick - g.plan_tick >= per
            and node.owner == g.owner
            and node.warehouse > 0
            and g.bonus < min(g.plan, g.charged)
        ):
            node.warehouse -= 1
            g.bonus += 1
            g.plan_tick = tick
            events.append(
                event(tick, "plan_charged", player=g.owner, group=gid, node=nid, bonus=g.bonus)
            )
        if g.bonus >= g.plan or 0 < g.charged <= g.bonus:
            if g.group_order is None:
                release_plan(g, tick + 1)
            else:  # ready: it waits for the others (DEC-48, item F4)
                g.plan = 0
                g.plan_tick = 0
    return events


def plan_parts(charged: list[int], bonus: int) -> list[int]:
    """DEC-48, item F2: the requested total ``bonus`` split over the members with ``charged``
    units, in the order of the command list. ``B = min(bonus, sum)``; ``L`` the smallest number
    with ``sum(min(c, L)) >= B``; each part ``min(c, L - 1)``, then +1 to the members with
    ``c >= L`` in list order until the parts add up to ``B``."""
    total = min(max(bonus, 0), sum(charged))
    if total == 0:
        return [0 for _ in charged]
    level = 1
    while sum(min(c, level) for c in charged) < total:
        level += 1
    parts = [min(c, level - 1) for c in charged]
    rest = total - sum(parts)
    for i, c in enumerate(charged):
        if rest == 0:
            break
        if c >= level:
            parts[i] += 1
            rest -= 1
    return parts


def schedule(start: int, ticks: list[int]) -> tuple[int, list[int]]:
    """DEC-48, items C2 and F4: the common arrival ``A = start + max(T) - 1`` of members whose
    paths take ``ticks`` when the slowest departs at ``start``, and each departure
    ``A - T + 1`` (the first step is made in the tick of the departure)."""
    arrive = start + max(ticks) - 1
    return arrive, [arrive - t + 1 for t in ticks]


def member_ticks(state: GameState, rules: Ruleset, group: Group) -> int:
    """Ticks of the remaining path of a member standing in its node (the path fixed at the
    command, item C7)."""
    location = group.location
    order = group.order
    assert isinstance(location, AtNode) and order is not None
    return path_ticks(state, rules, (location.node, *order.path))


def settle_group_orders(
    state: GameState, rules: Ruleset, start: int, only: int | None = None
) -> None:
    """Unlink the members whose order ended, drop the group orders without a member, and fix the
    departures of a planned order whose members are all ready (DEC-48, item F4): the slowest
    departs at ``start``. ``only``: settle that group order alone (a command of its owner)."""
    members: dict[int, list[Group]] = {}
    for gid in sorted(state.groups):
        g = state.groups[gid]
        oid = g.group_order
        if oid is None or (only is not None and oid != only):
            continue
        if g.order is None or oid not in state.group_orders:
            g.group_order = None
            continue
        members.setdefault(oid, []).append(g)
    for oid in sorted(state.group_orders):
        if only is not None and oid != only:
            continue
        joint = state.group_orders[oid]
        live = members.get(oid)
        if not live:
            del state.group_orders[oid]
        elif joint.planned and joint.arrive_tick is None and all(g.plan == 0 for g in live):
            _fix_departures(state, rules, joint, live, start)


def _fix_departures(
    state: GameState, rules: Ruleset, joint: GroupOrder, live: list[Group], start: int
) -> None:
    """The departures of the ready members of a planned group order (item F4); each bonus is
    active from its departure (item F6)."""
    arrive, departs = schedule(start, [member_ticks(state, rules, g) for g in live])
    joint.arrive_tick = arrive
    for g, depart in zip(live, departs, strict=True):
        order = g.order
        assert order is not None and order.depart_tick == PLAN_WAIT
        g.order = Order(order.path, order.planned, depart)
        g.bonus_tick = depart


def absorb(state: GameState, keep: Group, gid: int) -> None:
    """Move the units and charges of group ``gid`` into ``keep`` and remove it with its intent.

    ``keep`` stays as it is otherwise: bonus, order and intent (DEC-20, A4, B2).
    """
    other = state.groups[gid]
    set_intent(state, other, None)
    del state.groups[gid]
    keep.units += other.units
    keep.charged += other.charged


def active_bonuses(state: GameState) -> dict[int, int]:
    """The bonuses the groups bring into a fight in this tick, in virtual shots: the ``bonuses``
    of ``combat``. A planned order from its departure. A group in a fight has none: its bonus
    entered the fight when it joined."""
    result: dict[int, int] = {}
    for gid in sorted(state.groups):
        g = state.groups[gid]
        if g.fight is None and g.bonus > 0 and state.tick >= g.bonus_tick:
            result[gid] = g.bonus
    return result


def orders(state: GameState, rules: Ruleset) -> list[Event]:
    """The orders system, at the end of the step: ended orders and intents, then the auto-merge
    (DEC-20, A).

    The bonuses that entered a fight left their groups there (``systems.combat``, DEC-24 F1):
    they burn with the fight. A planned bonus not yet used ends with its order; an inactive one
    (a planned order still waiting) is kept. Reads the ``group_arrived``, ``recruited`` and
    ``fight_group`` events of the tick from ``state.events``. Emits ``groups_merged`` for every
    auto-merge. The waiting planned orders gather their bonus first (``gather_plans``).
    """
    gathered = gather_plans(state, rules)
    settle_group_orders(state, rules, state.tick + 1)
    live: dict[int, bool] = {}
    for gid in sorted(state.groups):
        g = state.groups[gid]
        if g.order is None:
            g.walk = False  # a recruit walk ends with its order (DEC-48, item H3)
        if g.bonus > 0 and g.order is None:
            clear_bonus(g)  # the planned bonus ends with the order (#141 default)
        if g.intent is not None:
            if _holds(g):
                live[g.intent] = True
            else:
                set_intent(state, g, None)
    for iid in sorted(state.intents):
        if iid not in live:
            del state.intents[iid]  # the group is gone (fight, attrition)
    return gathered + _auto_merge(state)


def _auto_merge(state: GameState) -> list[Event]:
    """DEC-20, A: the groups that finished their movement in an own node join its target group.

    A group in a fight does not merge (DEC-07, rule 7); a group that arrived into a fight
    finishes its movement when the fight ends (``fight_group`` with ``arrived``).
    """
    tick = state.tick
    finished: dict[int, bool] = {}
    for e in state.events:
        if e.tick != tick:
            continue
        if e.kind in ("group_arrived", "recruited", "rally_walk_no_cp") or (
            e.kind == "fight_group" and e.get("arrived") is True and e.get("left") is False
        ):
            gid = e.get("group")
            assert isinstance(gid, int)
            finished[gid] = True
    by_node: dict[int, list[int]] = {}
    for gid in sorted(finished):
        g = state.groups.get(gid)
        if (
            g is None
            or g.order is not None
            or g.fight is not None
            or not isinstance(g.location, AtNode)
        ):
            continue  # dead, bouncing, in a fight, or ordered on in this tick (a recruit)
        node = g.location.node
        if state.nodes[node].owner == g.owner:
            by_node.setdefault(node, []).append(gid)
    events: list[Event] = []
    for node in sorted(by_node):
        movers = by_node[node]
        owner = state.groups[movers[0]].owner
        at = AtNode(node)
        target = next(
            (
                gid
                for gid in sorted(state.groups)
                if gid not in finished
                and state.groups[gid].owner == owner
                and state.groups[gid].location == at
                and state.groups[gid].order is None
                and state.groups[gid].fight is None
            ),
            None,
        )
        if target is None:  # A2: the smallest id of the groups that finished here
            target, movers = movers[0], movers[1:]
        if not movers:
            continue
        keep = state.groups[target]
        for gid in movers:
            absorb(state, keep, gid)
        events.append(
            event(tick, "groups_merged", player=owner, group=target, units=keep.units, node=node)
        )
    return events


def _holds(g: Group) -> bool:
    """The planned-order intent still describes the group (#141 item 5, kept by DEC-24 item
    L)."""
    return g.order is not None and g.order.planned
