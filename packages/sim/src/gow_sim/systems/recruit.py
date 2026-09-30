"""Recruiting (SIM-12): DEC-01 (mechanics.md, section 3), numbers from ``Ruleset``.

- ``Recruit(node)`` creates one discharged unit as a new group in mode «Атака» in an own city,
  for ``orders.cost.recruit`` (1 CP).
- Where: ``recruit.location``: ``any_city`` is any own city, ``capital`` only the own capital.
- The city needs free capacity: the units of the player standing in it (``standing_units``, as for
  attrition; groups on edges are in transit) are fewer than its capacity.
- At most one unit per city per ``recruit.cooldown_ticks``: a recruit at tick ``t`` allows the
  next one in that city at ``t + cooldown_ticks``, otherwise ``RECRUIT_COOLDOWN``. The cooldown
  belongs to the city (``Node.recruited_tick``), whoever owns it.

The unit appears when the command is applied (``apply_commands``, the first system of a tick), so
the ``recruit`` slot of the system order has no per-tick work in the MVP. Command validation and
application (SIM-04) use the helpers below, like ``set_stance()`` of the economy.
"""

from gow_sim.ruleset import RecruitLocation, Ruleset
from gow_sim.state import AtNode, Event, GameState, Group, Mode, event
from gow_sim.systems.capacity import city_capacity, standing_units


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


def recruit_cooldown_left(state: GameState, rules: Ruleset, node: int) -> int:
    """Ticks until the city ``node`` may recruit again; 0 means now."""
    last = state.nodes[node].recruited_tick
    if last is None:
        return 0
    return max(0, last + rules.recruit.cooldown_ticks - state.tick)


def recruit_unit(state: GameState, player: int, node: int) -> list[Event]:
    """Apply a validated ``Recruit`` at the current tick (the cost is charged by SIM-04)."""
    gid = state.new_id()
    state.groups[gid] = Group(gid, player, 1, 0, Mode.ATTACK, AtNode(node))  # discharged
    state.nodes[node].recruited_tick = state.tick
    return [event(state.tick, "recruited", player=player, node=node, group=gid)]
