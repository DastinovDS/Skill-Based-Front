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
  (``capacity.warehouse_capacity``: the node capacity, with ``city_upgrades`` DEC-26's own). The
  excess is not lost here (DEC-28, item 4.4): the event ``charges_produced`` (``charges``: all of
  the produced charges) carries it as ``spill``, and ``systems.supply`` spreads it over the rear
  cities in the same tick; what finds no room there burns (``charges_overflow``). If the player
  does not own its capital, all of the produced charges are spill and burn there.
- The stance changes at most once per ``orders.stance_cooldown_ticks``; the first change is not
  limited (DEC-09). Command validation and application (SIM-04) use
  ``stance_cooldown_left()`` and ``set_stance()``.

Economy v2 (DEC-41, items 1 and 2; ``economy.model = "v2"``): no stances, the whole quantum goes
to CP (the cap and ``cp_burned`` as above). Charges come only from the factories: every own
factory city makes one charge per period into its own warehouse, the own capital per
``factory.capital_period_ticks``, every other factory per ``factory.built_period_ticks`` (on ticks
``t > 0`` divisible by the period; event ``charges_produced`` with ``spill = 0``). A full
warehouse burns the charge: event ``charge_burned``, the only burn of production (L6).

Stances of economy v2 (DEC-44; section ``[stances]`` of the ruleset, revises DEC-41, item 1): the
stance sets the CP income and the rate of the own capital, on local progress instead of the global
clock. Every tick ``PlayerState.cp_ticks`` and ``capital_ticks`` grow by 1; a counter that reaches
the period of the stance fires its quantum and restarts. A real stance change sets both to 0
(``set_stance``, in ``apply_commands``, so the tick of the change is the first one counted). The
capital counter never stops: without an own capital, or with its factory gone, the quantum fires
and does nothing. Built factories and a captured capital stay on the global clock above.

Supply flow (DEC-43, item A8; ``supply.model = "flow"``): a factory is **full** when its stock
plus the own packets on the way to it reach its warehouse. A full factory's new charge **spills**:
it leaves at once as one packet to the nearest own node with room, over own nodes with
``d(m) >= k`` by the field the flow step stored in the previous tick, several roads away if no
neighbour has room (item M8, #738; ``systems.flow.spill_way``; event ``charges_produced`` with
``spill = 1`` and ``packet_sent``); with no such node it burns (``charge_burned``).
A factory in a **pocket** (its own component does not contain the own capital, DEC-43 item H2)
produces nothing, with no event; the test reads the ownership at the start of the tick
(``capacity.supplied_territory``), before the captures of the tick's ``movement`` and ``combat``.

Tick convention: a system sees ``state.tick`` as the number of the tick being simulated, 1 for
the first step after ``initial_state()``. A period fires on ticks ``t > 0`` with
``t % period == 0``, so the first CP quantum comes at tick 50, and 600 steps give 12 quanta.
"""

from typing import Final

from gow_sim.ruleset import Ruleset, Stance
from gow_sim.state import Event, GameState, event
from gow_sim.systems.capacity import supplied_territory, warehouse_capacity
from gow_sim.systems.flow import send_way, spill_way
from gow_sim.systems.supply import incoming_charges

CENTI: Final = 100
"""The stance share of a CP quantum is kept in hundredths of a charge (DEC-02)."""


def economy(state: GameState, rules: Ruleset) -> list[Event]:
    """CP quantum and its charge share for both players (symmetric, no player order effect)."""
    if rules.v2:
        return _economy_v2(state, rules)
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
        # What does not fit goes to the supply system in this tick (DEC-28, item 4.4); without
        # the own capital nothing fits, and the supply system burns all of it.
        if node.owner == pid:
            cap = warehouse_capacity(state, rules, capital)
            added = min(charges, max(0, cap - node.warehouse))
        else:
            added = 0
        node.warehouse += added
        spill = charges - added
        events.append(
            event(tick, "charges_produced", player=pid, node=capital, charges=charges, spill=spill)
        )
    return events


def _economy_v2(state: GameState, rules: Ruleset) -> list[Event]:
    """The CP quantum and the production of the factories (DEC-41; the stances of DEC-44)."""
    tick = state.tick
    events: list[Event] = []
    stances = rules.stances
    capital_due: dict[int, bool] = {}
    if stances is not None:
        for pid in sorted(state.players):
            player = state.players[pid]
            player.cp_ticks += 1
            if player.cp_ticks >= stances.cp_period_ticks.of(player.stance):
                player.cp_ticks = 0
                events.extend(_cp_quantum(state, rules, pid))
            player.capital_ticks += 1
            due = player.capital_ticks >= stances.capital_period_ticks.of(player.stance)
            capital_due[pid] = due
            if due:
                player.capital_ticks = 0
    elif tick > 0 and tick % rules.cp.period_ticks == 0:
        for pid in sorted(state.players):
            events.extend(_cp_quantum(state, rules, pid))
    connected: dict[int, tuple[bool, ...]] = {}
    for nid in sorted(state.nodes):
        node = state.nodes[nid]
        owner = node.owner
        if owner is None or node.factory != owner:
            continue
        if stances is not None and nid == state.map.capital(owner):
            due = capital_due[owner]  # the own capital: local progress (DEC-44)
        else:
            due = tick > 0 and tick % factory_period(state, rules, nid) == 0
        if not due:
            continue
        if rules.flow:
            if owner not in connected:
                connected[owner] = supplied_territory(state, owner)
            if not connected[owner][nid]:
                continue  # cut off from the own capital: the factory stops (DEC-43, item H2)
            events.extend(_produce_flow(state, rules, owner, nid))
        elif node.warehouse < warehouse_capacity(state, rules, nid):
            node.warehouse += 1
            events.append(
                event(tick, "charges_produced", player=owner, node=nid, charges=1, spill=0)
            )
        else:
            events.append(event(tick, "charge_burned", player=owner, node=nid, charges=1))
    return events


def _cp_quantum(state: GameState, rules: Ruleset, pid: int) -> list[Event]:
    """The whole quantum into the CP of ``pid``, up to the cap; the excess burns."""
    player = state.players[pid]
    total = player.cp + rules.cp.per_period
    burned = max(0, total - rules.cp.cap)
    player.cp = total - burned
    return [event(state.tick, "cp_burned", player=pid, cp=burned)] if burned > 0 else []


def _produce_flow(state: GameState, rules: Ruleset, owner: int, nid: int) -> list[Event]:
    """The charge of the factory ``nid`` under the flow: into the warehouse, spilled or burned."""
    tick = state.tick
    node = state.nodes[nid]
    if node.warehouse + incoming_charges(state, owner, nid) < warehouse_capacity(state, rules, nid):
        node.warehouse += 1
        return [event(tick, "charges_produced", player=owner, node=nid, charges=1, spill=0)]
    way = spill_way(state, rules, nid)
    if way is None:
        return [event(tick, "charge_burned", player=owner, node=nid, charges=1)]
    m, roads = way
    return [
        event(tick, "charges_produced", player=owner, node=nid, charges=1, spill=1),
        send_way(state, rules, owner, nid, m, roads),
    ]


def factory_period(state: GameState, rules: Ruleset, node: int) -> int:
    """Ticks per charge of the factory in ``node`` (DEC-41, item 2): the own capital of its
    owner ``factory.capital_period_ticks`` (under ``[stances]`` the period of its owner's stance,
    DEC-44), any other factory ``factory.built_period_ticks``."""
    factory = rules.factory_rules()
    owner = state.nodes[node].owner
    if owner is not None and node == state.map.capital(owner):
        if rules.stances is not None:
            return rules.stances.capital_period_ticks.of(state.players[owner].stance)
        return factory.capital_period_ticks
    return factory.built_period_ticks


def stance_cooldown_left(state: GameState, rules: Ruleset, player: int) -> int:
    """Ticks until ``player`` may change the stance again; 0 means now. Under ``[stances]`` there
    is no cooldown: a change costs the progress of both counters (DEC-44)."""
    last = state.players[player].stance_changed_tick
    if last is None or rules.stances is not None:
        return 0
    return max(0, last + rules.orders.stance_cooldown_ticks - state.tick)


def set_stance(state: GameState, player: int, stance: Stance) -> list[Event]:
    """Apply a validated stance change at the current tick (the cost is charged by SIM-04). The
    local progress of DEC-44 starts over; without ``[stances]`` it is 0 anyway."""
    ps = state.players[player]
    ps.stance = stance
    ps.stance_changed_tick = state.tick
    ps.cp_ticks = 0
    ps.capital_ticks = 0
    return [event(state.tick, "stance_changed", player=player, stance=stance.value)]
