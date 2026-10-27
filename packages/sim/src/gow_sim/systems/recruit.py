"""The recruit queue of a city (DEC-25, #262; mechanics.md, section 3), numbers from ``Ruleset``.

- ``Recruit(node)`` puts one unit into the queue of an own city (not a province, DEC-23) for
  ``orders.cost.recruit``, charged when the unit is queued. Where: ``recruit.location``
  (``any_city`` or ``capital``). At most ``recruit.queue_max`` units per city, the one in
  production included (``QUEUE_FULL``); the owner's units standing in the city plus the queue must
  stay below its capacity (``CITY_FULL``). The checks: ``commands.validate``.
- ``CancelRecruit(node)`` takes the **last** unit of the queue off. A unit not started yet returns
  its CP in full; the unit in production (the only one in the queue, with progress) returns
  ``orders.cost.recruit * recruit.refund_started_pct // 100`` (hundredths of CP, rounded down).
  CP above the cap burn (``cp_burned``), like the regeneration on the cap. Event
  ``recruit_cancelled``.
- Production (the ``recruit`` system, after ``supply``): a city makes one unit at a time, the
  first of its queue. ``Node.recruit_progress`` grows by one in every tick the queue is not empty
  and there is no fight in the city (DEC-24); the unit is ready when the progress equals
  ``recruit.unit_ticks``. A unit queued into an empty queue in tick ``t`` gets its first tick of
  progress in ``t`` (``apply_commands`` runs first) and appears in ``t + unit_ticks - 1``; the next
  one starts in the next tick.
- A ready unit appears when the owner's standing units in the city are fewer than its capacity;
  otherwise it waits with full progress (``recruit_waiting`` of the view) and appears in the first
  tick there is a place. It never appears during a fight in the city.
- The unit appears discharged, as a new group in mode "Attack" (event ``recruited``); the
  ``orders`` system merges it into the group of the city in the same tick (DEC-20, A1). It takes
  a charge later, by the usual recharge from the city warehouse (``supply`` runs before
  ``recruit``, so its first recharge is in the next tick).
- A cut-off city produces as usual (DEC-19, item 9). An owner change empties the queue without a
  refund (``capacity.change_owner``, event ``recruit_queue_lost`` for the former owner).

Nodes are walked player by player, each player's in ``node_key`` order, so the ids of the new
groups of one player keep the mirror order (AGENTS.md, section 4.1, rule 6).
"""

from gow_sim.ruleset import RecruitLocation, Ruleset
from gow_sim.state import AtNode, Event, GameState, Group, Mode, event
from gow_sim.systems.capacity import city_capacity, standing_units


def recruit(state: GameState, rules: Ruleset) -> list[Event]:
    """Advance the production of every city with a queue and let the ready units appear."""
    events: list[Event] = []
    mapdef = state.map
    unit_ticks = rules.recruit.unit_ticks
    fights = state.fight_nodes()
    queued = [nid for nid in sorted(state.nodes) if state.nodes[nid].recruit_queue > 0]
    for player in sorted(state.players):
        own = [nid for nid in queued if state.nodes[nid].owner == player]
        for nid in sorted(own, key=lambda n: mapdef.node_key(player, n)):
            if nid in fights:
                continue  # no progress and no new unit during a fight (DEC-25, item 9)
            node = state.nodes[nid]
            if node.recruit_progress < unit_ticks:
                node.recruit_progress += 1
            if node.recruit_progress < unit_ticks:
                continue
            if free_capacity(state, rules, player, nid) <= 0:
                continue  # ready, waits for a place (DEC-25, item 7)
            node.recruit_queue -= 1
            node.recruit_progress = 0
            events.append(_new_unit(state, player, nid))
    return events


def recruit_allowed_here(state: GameState, rules: Ruleset, player: int, node: int) -> bool:
    """``recruit.location`` allows ``player`` to recruit in ``node`` (ownership checked apart)."""
    match rules.recruit.location:
        case RecruitLocation.ANY_CITY:
            return True
        case RecruitLocation.CAPITAL:
            return node == state.map.capital(player)


def free_capacity(state: GameState, rules: Ruleset, player: int, node: int) -> int:
    """Places left for units of ``player`` standing in ``node``; 0 or less: the city is full."""
    return city_capacity(state, rules, node) - standing_units(state, node, player)


def recruit_waiting(state: GameState, rules: Ruleset, node: int) -> bool:
    """The first unit of the queue is ready and waits for a place (or for the fight to end)."""
    n = state.nodes[node]
    return n.recruit_queue > 0 and n.recruit_progress >= rules.recruit.unit_ticks


def cancel_refund(state: GameState, rules: Ruleset, node: int) -> int:
    """CP in hundredths that ``CancelRecruit(node)`` returns for the last unit of the queue.

    The last unit is in production only when it is the only one and has progress: then
    ``orders.cost.recruit * recruit.refund_started_pct // 100`` (rounded down), else all of it.
    """
    n = state.nodes[node]
    cost = rules.orders.cost.recruit
    if n.recruit_queue == 1 and n.recruit_progress > 0:
        return cost * rules.recruit.refund_started_pct // 100
    return cost


def queue_unit(state: GameState, node: int) -> None:
    """Apply a validated ``Recruit``: one more unit in the queue (the CP are charged by SIM-04).

    No event: the ``ack`` answers the command, ``recruited`` comes when the unit appears.
    """
    state.nodes[node].recruit_queue += 1


def cancel_unit(state: GameState, rules: Ruleset, player: int, node: int) -> list[Event]:
    """Apply a validated ``CancelRecruit``: the last unit leaves the queue, CP come back."""
    refund = cancel_refund(state, rules, node)
    n = state.nodes[node]
    n.recruit_queue -= 1
    if n.recruit_queue == 0:
        n.recruit_progress = 0
    p = state.players[player]
    total = p.cp + refund
    burned = max(0, total - rules.cp.cap)
    p.cp = total - burned
    events = [event(state.tick, "recruit_cancelled", player=player, node=node, cp=refund)]
    if burned > 0:
        events.append(event(state.tick, "cp_burned", player=player, cp=burned))
    return events


def _new_unit(state: GameState, player: int, node: int) -> Event:
    gid = state.new_id()
    state.groups[gid] = Group(gid, player, 1, 0, Mode.ATTACK, AtNode(node))  # discharged
    return event(state.tick, "recruited", player=player, node=node, group=gid)
