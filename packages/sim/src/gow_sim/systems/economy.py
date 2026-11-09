"""Economy (SIM-06): the CP income and the production of the factories.

The stances of DEC-44 (mechanics.md, section 6) with local progress: the stance sets the CP income
and the rate of the own capital. Every tick ``PlayerState.cp_ticks`` and ``capital_ticks`` grow by
1; a counter that reaches the period of the stance (``stances.cp_period_ticks``,
``stances.capital_period_ticks``) fires its quantum and restarts. A real stance change carries both
over in proportion to the periods (``carry`` in ``set_stance``, applied by ``apply_commands``, so
the tick of the change is the first one counted at the new rate; revised 2026-11-07, #792). The
capital counter never stops: without an own capital, or with its factory gone, the quantum fires
and does nothing.

- The CP quantum ``cp.per_period`` goes into CP; CP never exceed ``cp.cap``: the excess burns
  (event ``cp_burned``).
- Charges come only from the factories (DEC-41, item 2): every own factory city makes one charge
  into its own warehouse per period, the own capital by its owner's stance. Built factories and a
  captured capital make one per ``factory.built_period_ticks`` on the global clock (ticks ``t > 0``
  divisible by it), unless the ruleset has ``stances.factories_follow`` (DEC-47, #888): then every
  factory that is not its owner's capital counts its own ``Node.factory_ticks`` the same way,
  against the capital period of its owner's stance. The counter grows only while the node is a
  factory of its owner, starts at 0 when the factory starts working (``systems.build``) or passes
  on a capture (``systems.flow.settle_factories``), keeps counting in a pocket (the quantum then
  does nothing, like the capital's), and a real stance change carries it over with the capital
  counter.

Supply flow (DEC-43, item A8): a factory is **full** when its stock plus the own packets on the way
to it reach its warehouse. A full factory's new charge **spills**: it leaves at once as one packet
to the nearest own node with room, over own nodes with ``d(m) >= k`` by the field the flow step
stored in the previous tick, several roads away if no neighbour has room (item M8, #738;
``systems.flow.spill_way``; event ``charges_produced`` with ``spill = 1`` and ``packet_sent``);
with no such node it burns (``charge_burned``). Otherwise the charge goes into the warehouse
(``charges_produced`` with ``spill = 0``). A factory in a **pocket** (its own component does not
contain the own capital, DEC-43 item H2) produces nothing, with no event; the test reads the
ownership at the start of the tick (``capacity.supplied_territory``), before the captures of the
tick's ``movement`` and ``combat``.

Tick convention: a system sees ``state.tick`` as the number of the tick being simulated, 1 for
the first step after ``initial_state()``.
"""

from gow_sim.ruleset import Ruleset, Stance
from gow_sim.state import Event, GameState, event
from gow_sim.systems.capacity import supplied_territory, warehouse_capacity
from gow_sim.systems.flow import send_way, spill_way
from gow_sim.systems.supply import incoming_charges


def economy(state: GameState, rules: Ruleset) -> list[Event]:
    """The CP quantum and the production of the factories (DEC-41, DEC-44, DEC-47), players
    and factories in id order (one player's counters never touch the other's)."""
    events: list[Event] = []
    stances = rules.stances
    capital_due: dict[int, bool] = {}
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
    connected: dict[int, tuple[bool, ...]] = {}
    for nid in sorted(state.nodes):
        node = state.nodes[nid]
        owner = node.owner
        if owner is None or node.factory != owner:
            continue
        if nid == state.map.capital(owner):
            due = capital_due[owner]  # the own capital: local progress (DEC-44)
        elif stances.factories_follow:
            node.factory_ticks += 1  # any other factory: its own local progress (DEC-47)
            due = node.factory_ticks >= stances.capital_period_ticks.of(state.players[owner].stance)
            if due:
                node.factory_ticks = 0
        else:
            due = state.tick % factory_period(state, rules, nid) == 0  # the tick is > 0
        if not due:
            continue
        if owner not in connected:
            connected[owner] = supplied_territory(state, owner)
        if not connected[owner][nid]:
            continue  # cut off from the own capital: the factory stops (DEC-43, item H2)
        events.extend(_produce_flow(state, rules, owner, nid))
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
    owner by the period of its owner's stance (DEC-44), any other factory
    ``factory.built_period_ticks`` (under ``stances.factories_follow`` the capital period of its
    owner's stance as well, DEC-47)."""
    owner = state.nodes[node].owner
    stances = rules.stances
    capital = owner is not None and node == state.map.capital(owner)
    built = rules.factory.built_period_ticks
    if owner is not None and (capital or built is None):
        return stances.capital_period_ticks.of(state.players[owner].stance)
    assert built is not None  # a factory without an owner reads the built period
    return built


def carry(ticks: int, old_period: int, new_period: int) -> int:
    """A local counter after a stance change (DEC-44, item 4, revised 2026-11-07, #792): it keeps
    its share of the cycle, ``ticks * new_period // old_period``. All three are non-negative, so
    ``//`` rounds down: a change and a change back never raise a counter."""
    return ticks * new_period // old_period


def set_stance(state: GameState, rules: Ruleset, player: int, stance: Stance) -> list[Event]:
    """Apply a validated stance change at the current tick (the cost is charged by SIM-04): the
    local progress of DEC-44 carries over to the periods of the new stance, and under
    ``stances.factories_follow`` the counter of every other own factory too (DEC-47)."""
    ps = state.players[player]
    stances = rules.stances
    cp, capital = stances.cp_period_ticks, stances.capital_period_ticks
    old, new = capital.of(ps.stance), capital.of(stance)
    ps.cp_ticks = carry(ps.cp_ticks, cp.of(ps.stance), cp.of(stance))
    ps.capital_ticks = carry(ps.capital_ticks, old, new)
    if stances.factories_follow:
        home = state.map.capital(player)
        for nid in sorted(state.nodes):
            node = state.nodes[nid]
            if nid != home and node.owner == player and node.factory == player:
                node.factory_ticks = carry(node.factory_ticks, old, new)
    ps.stance = stance
    return [event(state.tick, "stance_changed", player=player, stance=stance.value)]
