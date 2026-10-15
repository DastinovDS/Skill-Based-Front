"""Economy (SIM-06): CP regeneration and the stance split into charges of the capital.

DEC-02 (mechanics.md, section 6), numbers from ``Ruleset``:

- Every ``cp.period_ticks`` the quantum ``cp.per_period`` (hundredths of CP) is split by the
  stance: ``per_period * stance_to_charges_pct // 100`` (rounded down) goes into charges, the rest
  into CP. The charge share is multiplied by ``economy.charges_per_cp`` and added to the
  accumulator ``charge_acc`` in hundredths of a charge; every whole 100 becomes one charge.
- CP never exceed ``cp.cap``: the excess of the quantum burns (event ``cp_burned``). The stance
  share into charges is credited always, also at the cap.
- The capital produces no charges of its own: charges come only from CP through the stance (no
  passive production, owner's decision of 2026-10-14, #253).
- Charges go to the warehouse of the capital up to its warehouse capacity
  (``capacity.warehouse_capacity``: the node capacity, with ``city_upgrades`` DEC-26's own); the
  excess is lost (event ``charges_overflow``). If the player does not own its capital, all of the
  produced charges are lost.
- The stance changes at most once per ``orders.stance_cooldown_ticks``; the first change is not
  limited (#104 default). Command validation and application (SIM-04) use
  ``stance_cooldown_left()`` and ``set_stance()``.

Tick convention: a system sees ``state.tick`` as the number of the tick being simulated, 1 for
the first step after ``initial_state()``. A period fires on ticks ``t > 0`` with
``t % period == 0``, so the first CP quantum comes at tick 50, and 600 steps give 12 quanta.
"""

from typing import Final

from gow_sim.ruleset import Ruleset, Stance
from gow_sim.state import Event, GameState, event
from gow_sim.systems.capacity import warehouse_capacity

CENTI: Final = 100
"""The stance share of a CP quantum is kept in hundredths of a charge (DEC-02)."""


def economy(state: GameState, rules: Ruleset) -> list[Event]:
    """CP quantum and its charge share for both players (symmetric, no player order effect)."""
    tick = state.tick
    if not (tick > 0 and tick % rules.cp.period_ticks == 0):
        return []
    events: list[Event] = []
    for pid in sorted(state.players):
        player = state.players[pid]
        pct = rules.economy.stance_to_charges_pct.of(player.stance)
        to_charges = rules.cp.per_period * pct // 100  # non-negative: rounded down
        total = player.cp + rules.cp.per_period - to_charges
        burned = max(0, total - rules.cp.cap)
        player.cp = total - burned
        if burned > 0:
            events.append(event(tick, "cp_burned", player=pid, cp=burned))
        player.charge_acc += to_charges * rules.economy.charges_per_cp
        charges = player.charge_acc // CENTI
        player.charge_acc %= CENTI
        if charges == 0:
            continue
        capital = state.map.capital(pid)
        node = state.nodes[capital]
        if node.owner == pid:
            cap = warehouse_capacity(state, rules, capital)
            added = min(charges, max(0, cap - node.warehouse))
        else:
            added = 0
        node.warehouse += added
        if added > 0:
            events.append(event(tick, "charges_produced", player=pid, node=capital, charges=added))
        if charges > added:
            events.append(
                event(tick, "charges_overflow", player=pid, node=capital, charges=charges - added)
            )
    return events


def stance_cooldown_left(state: GameState, rules: Ruleset, player: int) -> int:
    """Ticks until ``player`` may change the stance again; 0 means now."""
    last = state.players[player].stance_changed_tick
    if last is None:
        return 0
    return max(0, last + rules.orders.stance_cooldown_ticks - state.tick)


def set_stance(state: GameState, player: int, stance: Stance) -> list[Event]:
    """Apply a validated stance change at the current tick (the cost is charged by SIM-04)."""
    ps = state.players[player]
    ps.stance = stance
    ps.stance_changed_tick = state.tick
    return [event(state.tick, "stance_changed", player=player, stance=stance.value)]
