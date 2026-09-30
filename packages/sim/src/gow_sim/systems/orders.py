"""Planned orders, «Защита» and public intents (SIM-10; mechanics.md, section 5, DEC-08; DEC-04).

DEC-08, numbers from ``Ruleset.orders``:

- A planned ``Move`` costs ``orders.cost.planned_move``; the group waits in its node
  ``orders.planned_delay_ticks`` (``Order.depart_tick``), then leaves with a bonus of
  ``orders.planned_bonus`` virtual shots for its first fight.
- ``SetMode(DEFENSE)`` costs ``orders.cost.defense`` (again on every switch); its bonus of
  ``orders.defense_bonus`` is active ``orders.defense_delay_ticks`` later and counts only for a
  node defender with a firing charge (DEC-07, rule 1). «Защита» holds while the group stands; a
  move order drops it for free.
- ``CancelOrder`` of a planned order during the delay, or of «Защита», costs
  ``orders.cost.cancel``.
- A planned order, «Защита» and a road build (SIM-11) are public: an ``Intent`` with the owner,
  the kind, the node of the group and the target, without the group id or size (DEC-04). The
  group keeps the link (``Group.intent``); the intent names no group.

Commands (SIM-04) set bonuses and intents when applied (``set_intent``, ``clear_bonus``).
Around combat: the combat system gets ``active_bonuses(state)``, and the ``orders`` system at
the end of the step (after ``build``) spends the bonuses of the groups that fought and removes
the bonuses and intents whose order, mode or build ended in a system: arrival, bounce, death,
attrition, ``build_stopped``.

Details that DEC-08 leaves open follow the defaults of #141 (see ``TODO(#141)`` below).
"""

from gow_sim.ruleset import Ruleset
from gow_sim.state import AtNode, Event, GameState, Group, Intent, IntentKind, Mode
from gow_sim.systems.combat import Bonus, BonusSource

__all__ = ["active_bonuses", "clear_bonus", "orders", "set_intent"]


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
    """The orders system, at the end of the step: spent bonuses, ended orders and intents.

    Reads the ``fight_group`` events of the tick from ``state.events``. A group that fought
    with an active bonus loses it, used or not (DEC-07, rule 3); an inactive one (a planned
    order still waiting, «Защита» before its delay) is kept. A planned bonus also ends with the
    order. Emits nothing.
    """
    del rules  # the signature of a system; no numbers are needed here
    tick = state.tick
    fought: dict[int, bool] = {}
    for e in state.events:
        if e.tick == tick and e.kind == "fight_group":
            gid = e.get("group")
            assert isinstance(gid, int)
            fought[gid] = True
    live: dict[int, bool] = {}
    for gid in sorted(state.groups):
        g = state.groups[gid]
        if g.bonus > 0:
            spent = gid in fought and tick >= g.bonus_tick
            # TODO(#141): the planned bonus ends with the order, also without a fight.
            ended = g.mode is not Mode.DEFENSE and g.order is None
            if spent or ended:
                clear_bonus(g)
        if g.intent is not None:
            if _holds(state.intents[g.intent].kind, g):
                live[g.intent] = True
            else:
                set_intent(state, g, None)
    for iid in sorted(state.intents):
        if iid not in live:
            del state.intents[iid]  # the group is gone (fight, attrition)
    return []


def _holds(kind: IntentKind, g: Group) -> bool:
    """The intent still describes the group (TODO(#141): the life of intents)."""
    match kind:
        case IntentKind.PLANNED_MOVE:
            return g.order is not None and g.order.planned
        case IntentKind.DEFENSE:
            return g.mode is Mode.DEFENSE
        case IntentKind.BUILD:
            return g.build_edge is not None
