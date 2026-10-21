"""Planned orders, «Защита» and public intents (SIM-10; mechanics.md, section 5, DEC-08; DEC-04).

DEC-08, numbers from ``Ruleset.orders``:

- A planned ``Move`` costs ``orders.cost.planned_move``; the group waits in its node
  ``orders.planned_delay_ticks`` (``Order.depart_tick``), then leaves with a bonus of virtual
  shots for its first fight: ``orders.planned_bonus_per_edge`` per edge of the path chosen at the
  command, at most the charged units of the group in the tick it departs (DEC-29; the command
  sets the uncapped bonus, ``movement`` caps it when the group leaves).
- ``SetMode(DEFENSE)`` costs ``orders.cost.defense`` (again on every switch); its bonus of
  ``orders.defense_bonus`` is active ``orders.defense_delay_ticks`` later and counts only for a
  node defender with a firing charge (DEC-07, rule 1). «Защита» holds while the group stands; a
  move order drops it for free.
- ``CancelOrder`` of any order costs ``orders.cost.cancel`` (0 since DEC-20): a planned order
  during the delay, a move order on an edge (the group turns back), «Защита».
- A planned order and «Защита» are public: an ``Intent`` with the owner, the kind, the node of
  the group and the target, without the group id or size (DEC-04). The group keeps the link
  (``Group.intent``); the intent names no group. Road builds are not public (DEC-16).

Commands (SIM-04) set bonuses and intents when applied (``set_intent``, ``clear_bonus``).
Around combat: the combat system gets ``active_bonuses(state)`` and takes the bonus of a group
that joins a fight off the group (it burns with the fight, DEC-24 F1); the ``orders`` system at
the end of the step (after ``build``) removes the bonuses and intents whose order or mode ended
in a system: arrival, bounce, death, attrition.

Auto-merge (DEC-20, A), also at the end of the step, after the bonuses: an own group that
finished its movement in an own node in this tick (arrived at its target, came back from a bounce
or a cancel: ``group_arrived``) or appeared by a recruit (``recruited``) joins the target group of
the node: the own group standing there with the smallest id, without an order (not waiting to
depart) and not one of the groups that finished in this tick. Without a target the groups that
finished there join the one with the smallest id. The target keeps its mode, «Защита», bonus and
intent; the others lose theirs. Groups in transit, waiting groups and groups on edges never merge.
The target group is chosen among one player's groups only, so the players stay symmetric.

Details that DEC-08 leaves open follow the defaults of #141, accepted by DEC-24 (item L).
"""

from gow_sim.ruleset import Ruleset
from gow_sim.state import AtNode, Event, GameState, Group, Intent, IntentKind, Mode, event
from gow_sim.systems.combat import Bonus, BonusSource

__all__ = ["absorb", "active_bonuses", "clear_bonus", "orders", "set_intent"]


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
    group.bonus = 0
    group.bonus_tick = 0


def absorb(state: GameState, keep: Group, gid: int) -> None:
    """Move the units and charges of group ``gid`` into ``keep`` and remove it with its intent.

    ``keep`` stays as it is otherwise: mode, «Защита», bonus, order and intent (DEC-20, A4, B2).
    """
    other = state.groups[gid]
    set_intent(state, other, None)
    del state.groups[gid]
    keep.units += other.units
    keep.charged += other.charged


def active_bonuses(state: GameState) -> dict[int, Bonus]:
    """The bonuses the groups bring into a fight in this tick: the ``bonuses`` of ``combat``."""
    result: dict[int, Bonus] = {}
    for gid in sorted(state.groups):
        g = state.groups[gid]
        if g.bonus > 0 and state.tick >= g.bonus_tick:
            defense = g.mode is Mode.DEFENSE
            source = BonusSource.DEFENSE_MODE if defense else BonusSource.PLANNED_ORDER
            result[gid] = Bonus(source, g.bonus)
    return result


def orders(state: GameState, rules: Ruleset) -> list[Event]:
    """The orders system, at the end of the step: ended orders and intents, then the auto-merge
    (DEC-20, A).

    The bonuses that entered a fight left their groups there (``systems.combat``, DEC-24 F1):
    they burn with the fight. A planned bonus not yet used ends with its order; an inactive one
    (a planned order still waiting, «Защита» before its delay) is kept. Reads the
    ``group_arrived``, ``recruited`` and ``fight_group`` events of the tick from
    ``state.events``. Emits ``groups_merged`` for every auto-merge.
    """
    del rules  # the signature of a system; no numbers are needed here
    live: dict[int, bool] = {}
    for gid in sorted(state.groups):
        g = state.groups[gid]
        if g.bonus > 0 and g.mode is not Mode.DEFENSE and g.order is None:
            clear_bonus(g)  # the planned bonus ends with the order (#141 default)
        if g.intent is not None:
            if _holds(state.intents[g.intent].kind, g):
                live[g.intent] = True
            else:
                set_intent(state, g, None)
    for iid in sorted(state.intents):
        if iid not in live:
            del state.intents[iid]  # the group is gone (fight, attrition)
    return _auto_merge(state)


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
        if e.kind in ("group_arrived", "recruited") or (
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


def _holds(kind: IntentKind, g: Group) -> bool:
    """The intent still describes the group (#141 item 5, kept by DEC-24 item L)."""
    match kind:
        case IntentKind.PLANNED_MOVE:
            return g.order is not None and g.order.planned
        case IntentKind.DEFENSE:
            return g.mode is Mode.DEFENSE
