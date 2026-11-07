"""Match analysis (BOT-04): metrics of one match from its event log.

The same code measures a bot tournament (``gow_bots.tournament``) and a real match (a replay of
PT-01 or REL-01, ``analyze_replay`` in ``gow_sim.replay``). Two steps:

1. ``MatchRecorder`` is a ``MatchObserver``: it watches ``run_headless`` or a replay and collects
   the events of every tick plus the accepted ``Move`` commands into a ``MatchLog``. The events
   alone do not say whether an order was planned or an attack (a ``Move`` leaves no event, and
   adding one would change the state hash), so the recorder classifies the orders when they are
   applied: *attack* means the destination did not belong to the player at that moment; *siege
   order* means an attack whose destination held a group of the other player standing in it
   (an enemy garrison) at that moment, that is at the end of the previous tick, the state the
   order is applied to.
2. ``analyze(log)`` is a pure function of the log and returns ``MatchMetrics``.

Definitions (all counts per player id, sides ``0`` and ``1``):

- ``planned_siege_share`` (the gate metric "share of scheduled attacks", owner's decision
  2026-10-30, #590, mechanics.md section 17): planned siege orders / siege orders (``None``
  without siege orders). A walk into an empty node (neutral or enemy) is no siege order: no plan
  can pay there, there is no fight.
- ``planned_attack_share``: planned attack orders / all attack orders, empty nodes included
  (``None`` without attacks); the BAL-01 definition, kept for comparison with older runs.
- **Siege attempt** (``sieges``): one assault on a node the enemy owns: a fight in the node with
  this player as attacker (``fight_started``, DEC-24), or the walk-in into an enemy node without
  defenders (the capture without a fight, DEC-07 row 5). A capture at the end of a fight
  (``fight_ended`` in the same tick) is no walk-in. **Siege success** (``sieges_won``): a
  capture of an enemy node (a neutral node is no siege); every capture counts once.
- **Captures** (``captures``): every ``node_captured`` of the player, neutral nodes included;
  ``captures_by_minute[p][m]`` is the number in minute ``m`` of the match (ticks
  ``m * 60 * tick_hz < t <= (m + 1) * 60 * tick_hz``). The list has ``ceil(ticks / minute)``
  entries (at least one).
- ``winner`` / ``reason`` come from the ``match_ended`` event; a match stopped by the caller
  before it ended has ``winner = None`` and ``reason = "unfinished"``. ``vp`` and ``cities`` are
  the final values.
- **Charge stock** (#310, a balance statistic, not a game rule): the total charges of a player at
  the end of a tick = the warehouses of the cities it owns + the charges in its packets on roads
  + the charged units of its groups (``charge_stock``). ``MatchRecorder`` samples it after every
  tick (``MatchLog.stock``, tick ``t`` is entry ``t - 1``); ``stock_peak`` is the largest sample
  and ``stock_mean_centi = sum * 100 // samples`` the mean in hundredths of a charge (rounded
  down; ``None`` without samples). A charge is counted in one place only: a charge that left a
  warehouse as a packet or was taken by a unit is no longer in the warehouse.
- **Burned share** (#310): ``charges_produced`` is the sum of ``charges`` of the player's
  ``charges_produced`` events (all that the economy made, spill included), ``charges_burned`` the
  sum of ``charges`` of its ``charges_overflow`` events (what found no room in a warehouse); a
  ``charge_burned`` of a full factory (economy v2, DEC-41) counts in both,
  ``burned_permille = charges_burned * 1000 // charges_produced`` (per mille, rounded down;
  ``None`` without production). The other sinks (``packet_lost``, ``warehouse_lost``, starvation)
  are not burning and are not counted. Charges that never were produced (the start stock) never
  burn, so the share cannot exceed 1000.

**Charge ledger and flow** (#588, balance statistics, not game rules; ``docs/balance/README.md``
has the same text). Per player, from the events of the match, the start stock of the map and two
state samplings; nothing is added to the simulation:

- ``charges_start`` and ``charges_end`` are the charge stock (``charge_stock``) before tick 1 and
  after the last tick. Sources: ``charges_start`` + ``charges_produced``. Sinks: ``charges_burned``,
  ``charges_fights`` (``spent_<p>`` and, under ``combat.terrain_burn``, ``burned_<p>`` of the
  public ``fight_round`` events, DEC-45), ``charges_captures``
  (``node_captured`` count times ``capture.charge_cost``, DEC-38), ``charges_packets_lost``
  (``packet_lost``), ``charges_warehouses_lost`` (``warehouse_lost``, its ``owner``),
  ``charges_starved`` (``starvation`` warehouse + units), ``charges_attrition`` (``attrition``
  with a charged unit: one charge each), under economy v2 ``charges_built`` (``build_paid``
  warehouse + units: the progressive payment of the barracks, a warehouse level, a factory and a
  bunker, DEC-41 item 7) and ``charges_plans`` (``plan_charged``: one charge each, the bonus of a
  waiting planned order, item 10), ``charges_tolls`` (``toll_paid``: the charges road
  fortifications took, DEC-43 item D6), and ``charges_end``. ``charges_residual`` = sources - sinks
  and must be 0: a value other than 0 means a charge appeared or vanished that no event explains
  (a rule changed without this ledger).
- Flow: ``charges_sent`` (``packet_sent``, the supply dispatch), ``charges_delivered`` (all
  ``packet_delivered``, one-off transfers included), ``charges_delivered_front`` (of them into a
  city with a front marker at the end of that tick), ``charges_transfers`` (``transfer_started``);
  ``tolls_paid`` (the number of ``toll_paid`` of the player's groups) and ``forts_built`` (its
  ``road_fort_built``), road fortifications (DEC-43, item D).
- **Stock by place**, ``stock_by_place_minute``: the charges of a player split into the places of
  ``PLACES`` (capital warehouse, warehouses of the cities with a front marker, other warehouses,
  charged units standing in nodes, charged units on roads, packets), sampled at the end of every
  ``PLACE_SAMPLE_TICKS``-th tick; the value of a minute is the mean of its samples in hundredths
  of a charge (rounded down; minute ``m``: ticks ``m * 60 * tick_hz < t <= (m + 1) * 60 *
  tick_hz``; ``None`` for a minute without a sample). The places sum to ``charge_stock``.
- **Supply bottleneck**, counted in every tick: ``marker_ticks`` (the player owns its capital and
  a city other than the capital with a front marker), ``front_empty_ticks`` (of them: a marker
  city has an empty warehouse), ``front_empty_cap_has_ticks`` (of those: the capital warehouse is
  not empty), ``cap_full_ticks`` (the player owns its capital and the warehouse is at capacity,
  counted in all ticks). ``front_empty_permille`` and ``front_empty_cap_has_permille`` are the
  first two over ``marker_ticks`` (per mille, rounded down; ``None`` without marker ticks).

**CP and idle units** (#743, balance statistics, not game rules; ``docs/balance/README.md`` has
the same text). Per player, from the ``cp_burned`` events and a sampling of the end-of-tick state;
nothing is added to the simulation:

- ``cp_burned`` (hundredths of CP, like ``PlayerState.cp``): the sum of ``cp`` of the player's
  ``cp_burned`` events, the CP that did not fit under ``cp.cap``: the regeneration quantum, and
  also the (rare) overflow of a ``CancelRecruit`` refund, which the log cannot tell apart from a
  quantum burned in the same tick. Both are CP lost to the cap.
- ``cp_cap_ticks``: the ticks ``1..ticks`` that ended with the player's CP at ``cp.cap`` (the next
  quantum burns completely).
- ``idle_discharged_connected`` and ``idle_discharged_pocket``, unit-ticks: in every tick, for each
  group of the player that stands in a node (not on an edge) the player owns, in no fight, with no
  movement order (a waiting planned order is an order), the units without a charge
  (``units - charged``) when the warehouse of the node is empty: nothing there can recharge them.
  *Connected*: the node is connected to the player's capital over own nodes
  (``capacity.supplied_territory``). *Pocket*: it is not (DEC-43, item H1: a component of own
  nodes without the own capital; a player without its capital has only pockets). Groups in a
  node the player does not own (the walk into a neutral or an enemy node ends in a capture or
  a fight in the same tick) are not counted.

**Efficiency and contact** (#690, balance statistics, not game rules; ``docs/balance/README.md``
has the same text). From the events of the match and the command journal; nothing is added to the
simulation:

- ``economy_model`` and ``supply_model``: ``economy.model`` and ``supply.model`` of the ruleset
  (``"v1"`` / ``"v2"``, ``"lines"`` / ``"flow"``), so a reader can hide the rows of the other
  economy. Under ``v1`` the supply model has no meaning and is written as it is in the ruleset.
- ``first_contact_tick`` (one value per match): the earlier of the first ``fight_started`` (in a
  node or on an edge) and the first capture of a node the other player owned; ``None`` when the
  players never met.
- ``siege_fights`` and ``siege_walk_ins``: the two parts of ``sieges``, the fights for an enemy
  node with the player as attacker and the walks into an enemy node without defenders.
- ``contested_sieges``: the siege fights in which the defender spent a charge (``spent_<d>`` of a
  ``fight_round`` of that fight above 0: a real shot or a charged unit killed), that is a fight
  against at least one charged defender; ``contested_sieges_won``: those that ended with the
  capture of the node (``fight_ended`` with ``captured`` and the attacker as ``winner``). A fight
  without its ``fight`` id in the events (a hand-made log) is not counted here.
- ``units_killed``: the enemy units the player's shots killed (``losses`` of the other player in
  every ``fight_round``); ``charges_per_kill_centi = charges_fights * 100 // units_killed``
  (hundredths, rounded down; ``None`` without a kill).
- ``charges_built_lost``: the charges of ``build_paid`` of a building that never served or stopped
  serving the player: a build later stopped (``build_stopped`` of its node and kind) and a finished
  building (``barracks_built``, ``warehouse_upgraded``, ``factory_built``, ``fort_built``) in a node
  the other player later captured. Every charge counts once (a part of ``charges_built``).
- ``cp_cancelled`` (hundredths of CP): the price of the ``Move`` orders that an accepted
  ``CancelOrder`` of the same group cancelled; ``MatchRecorder`` keeps the price of the last
  accepted ``Move`` of every group while the group has an order (``Group.order``) at the end of a
  tick, and a ``CancelOrder`` takes it. A move that arrived or was replaced by a new ``Move`` is not
  cancelled.

**Front pressure** (#803, the map tempo experiment; balance statistics, not game rules;
``docs/balance/README.md`` has the same text). From a sampling of the end-of-tick state and the
charge ledger; nothing is added to the simulation:

- **Front width** of a player at a sample: the number of nodes it owns that share an edge with a
  node the other player owns. Sampled at the end of every ``PLACE_SAMPLE_TICKS``-th tick (1 s):
  ``front_width_sum`` is the sum of the samples (front node-seconds), ``front_samples`` the number
  of samples with a width above 0 (seconds with a front);
  ``front_width_centi = front_width_sum * 100 // front_samples`` is the mean width while a front
  exists, in hundredths (rounded down; ``None`` without a front).
- **Front pressure** ``front_pressure_centi``: the charges the player spent in fights
  (``charges_fights``) per front node per minute, in hundredths:
  ``charges_fights * 100 * 60 * tick_hz // (front_width_sum * PLACE_SAMPLE_TICKS)`` (rounded
  down; ``None`` without a front). It weighs a minute with a wide front more, so it reads as
  "how hard is each front node pushed on".
- **CP income** ``cp_income`` (hundredths of CP): the CP quanta the player's economy fired times
  ``cp.per_period``, before the burning at the cap (``cp_burned``) and, under economy v1, before
  the share of the stance that goes into charges. A quantum is read like ``cp_by_stance``: under
  ``[stances]`` from ``cp_ticks`` (0 at the end of a tick exactly when it fired), otherwise on the
  ticks divisible by ``cp.period_ticks`` of the rules the match plays (``Match.rules``, the map
  tempo applied).

Player statistics (#375), the actions of a player instead of the outcome: ``analyze_stats(log)``
returns ``MatchStats``, one ``PlayerStats`` per side. They come from the command journal of the
match (every command sent, accepted or rejected, with the price charged) and from existing events
(``stance_changed``, ``transfer_started``, ``recruit_cancelled``); nothing is added to the
simulation, so the state hash does not change. Definitions (the same text is in
``docs/balance/README.md``):

- **Stance timeline** (``stance_timeline``): ``(tick, stance)`` pairs, the first is
  ``(0, economy.start_stance)``, then every accepted ``SetStance`` in order. A stance set at tick
  ``t`` works in tick ``t`` itself (``apply_commands`` runs before ``economy``), so the first tick
  under a stance is ``max(t, 1)`` and ``stance_ticks`` counts the ticks ``1..ticks`` under each
  stance; the three values always sum to ``ticks``. ``stance_switches`` is the number of accepted
  changes and ``stance_share`` the share of ``ticks`` under each stance (``None`` for
  ``ticks = 0``).
- **Earned by stance** (DEC-44, #772): ``cp_by_stance`` is the CP in hundredths a quantum really
  added under each stance (the quantum minus its ``cp_burned``), filled only under ``[stances]``:
  ``MatchRecorder`` reads a quantum from ``cp_ticks``, which is 0 at the end of a tick exactly when
  the quantum fired. ``charges_by_stance`` is ``(stance, capital, built)``: the charges made under
  each stance by the own capital and by every other factory (a captured capital too), and
  ``charges_capital`` and ``charges_built`` their sums; they count the ``charges_produced`` and the
  ``charge_burned`` events of a factory under economy v2, like ``MatchMetrics.charges_produced``.
- **Commands** (``commands``): all commands the player sent except ``Forfeit``; ``rejected`` is
  the part that was rejected (also in ``MatchMetrics.rejected``, which counts ``Forfeit`` too).
  **APM**: ``apm_avg = commands * 60 * tick_hz / ticks`` (``None`` for ``ticks = 0``);
  ``apm_by_minute[m]`` is the number of commands applied in minute ``m`` (ticks
  ``m * 60 * tick_hz < t <= (m + 1) * 60 * tick_hz``, like ``captures_by_minute``; the last
  minute may be shorter); ``apm_peak`` is its maximum.
- **Supply actions**: accepted ``SetFront``, ``SetRearMin`` and ``Transfer`` as tick lists
  (``front_ticks``, ``rear_min_ticks``, ``transfer_ticks``); ``transfer_charges`` is the sum of the
  charges that ``transfer_started`` says were sent (a transfer is cut to the free room of the
  target, so this may be less than the ``n`` of the command).
- **Planned orders**: ``planned_share = planned / all`` accepted ``Move`` orders (``None``
  without orders); ``planned_attack_share`` and ``planned_siege_share`` are as in
  ``MatchMetrics``.
- **CP spent** (``cp_by_category``, hundredths of CP): the price charged for every accepted
  command (``orders.cost`` of the ruleset), summed per category: ``move`` (``Move``),
  ``planned_move`` (``Move`` with ``planned``), ``mode`` (``SetMode``), ``recruit``
  (``Recruit`` minus the CP that ``CancelRecruit`` returned, ``cp`` of ``recruit_cancelled``),
  ``road`` (``UpgradeRoad``), ``barracks``, ``warehouse``, ``transfer``, ``fort`` (``FortifyRoad``,
  DEC-43 item D) and ``other`` (``Split``,
  ``Merge``, ``CancelOrder``, ``SetStance``, ``SetFront``, ``SetRearMin``: free in the MVP
  rulesets). ``cp_total`` is the sum, ``cp_refunded`` the returned part (already subtracted).
  Rejected commands cost nothing; the real CP balance (regeneration, burning at the cap) is not
  reconstructed.

**Result totals** (#607, the result screen): ``result_totals(events, player)`` returns the two
numbers of one player the ``match_end`` message carries. ``units_lost`` is the units of that player
destroyed in the match: the ``losses_<p>`` of every ``fight_round`` (units killed by shots; units
of a retreat are not lost) plus one per ``attrition`` event of the player (a unit that dies from
over-capacity). Starvation spends charges, not units, so it is not counted. ``charges_delivered``
is the same number as ``ChargeFlow.charges_delivered``: the ``charges`` of all the player's
``packet_delivered`` events, one-off transfers included. Both are counted over the whole event
list, so a reconnect does not change them.

Pure: no I/O, no clock (AGENTS.md, section 4.1).
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from gow_sim.commands import CancelOrder, Forfeit, Move, Ok, PlayerCommand
from gow_sim.maps import PLAYERS
from gow_sim.match import Match
from gow_sim.ruleset import Stance
from gow_sim.state import AtNode, Event, GameState, OnEdge
from gow_sim.systems.build import FACTORY_KIND, FORT_KIND
from gow_sim.systems.capacity import supplied_territory, warehouse_capacity

__all__ = [
    "CP_CATEGORIES",
    "PLACES",
    "PLACE_SAMPLE_TICKS",
    "UNFINISHED",
    "ChargeFlow",
    "CommandRecord",
    "MatchLog",
    "MatchMetrics",
    "MatchRecorder",
    "MatchStats",
    "MoveRecord",
    "PlayerStats",
    "analyze",
    "analyze_stats",
    "charge_places",
    "charge_stock",
    "result_totals",
]

UNFINISHED: Final = "unfinished"
"""``MatchMetrics.reason`` of a match that did not end (no ``match_ended`` event)."""


PLACES: Final[tuple[str, ...]] = (
    "cap_wh",
    "front_wh",
    "rear_wh",
    "units_node",
    "units_road",
    "packets",
)
"""Places of the charge stock, in output order (module docstring, stock by place)."""

PLACE_SAMPLE_TICKS: Final = 10
"""The stock by place is sampled at the end of every tick that is a multiple of this (1 second)."""

CP_CATEGORIES: Final[tuple[str, ...]] = (
    "move",
    "planned_move",
    "mode",
    "recruit",
    "road",
    "barracks",
    "warehouse",
    "transfer",
    "fort",
    "other",
)
"""Categories of ``PlayerStats.cp_by_category``, in output order (module docstring)."""

_KIND_CATEGORY: Final = {
    "SetMode": "mode",
    "Recruit": "recruit",
    "CancelRecruit": "recruit",
    "UpgradeRoad": "road",
    "BuildBarracks": "barracks",
    "UpgradeWarehouse": "warehouse",
    "Transfer": "transfer",
    "FortifyRoad": "fort",
}
"""``CommandRecord.kind`` to category; ``Move`` goes by ``planned``, the rest is ``other``."""


def result_totals(events: Sequence[Event], player: int) -> tuple[int, int]:
    """``(units_lost, charges_delivered)`` of ``player`` over ``events`` (module docstring)."""
    lost = delivered = 0
    for e in events:
        if e.kind == "fight_round":
            n = e.get(f"losses_{player}")
            assert isinstance(n, int)
            lost += n
        elif e.kind == "attrition" and e.get("player") == player:
            lost += 1
        elif e.kind == "packet_delivered" and e.get("player") == player:
            charges = e.get("charges")
            assert isinstance(charges, int)
            delivered += charges
    return lost, delivered


def _zeros() -> dict[int, int]:
    return {p: 0 for p in PLAYERS}


@dataclass(frozen=True, slots=True)
class MoveRecord:
    """An accepted ``Move`` command."""

    tick: int
    player: int
    planned: bool
    attack: bool
    """The destination was not owned by ``player`` when the order was applied."""
    siege: bool = False
    """An attack on a node with an enemy garrison: a group of the other player stood in the
    destination at the end of the previous tick (#590)."""


@dataclass(frozen=True, slots=True)
class CommandRecord:
    """A command as the journal has it, with the verdict of ``validate``."""

    tick: int
    """The tick the command was applied (or rejected) at."""
    player: int
    kind: str
    """Class name of the command, e.g. ``"Move"`` or ``"SetStance"``."""
    accepted: bool
    cost: int
    """CP in hundredths charged (``Ok.cost``); ``0`` for a rejected command."""
    planned: bool = False
    """``Move`` only: ``Move.planned``."""


@dataclass(frozen=True, slots=True)
class MatchLog:
    """Everything ``analyze`` needs of a match."""

    tick_hz: int
    ticks: int
    """The last tick played."""
    events: tuple[Event, ...]
    """All events of the match in tick order."""
    moves: tuple[MoveRecord, ...]
    """Accepted ``Move`` commands in application order."""
    commands: tuple[CommandRecord, ...]
    """Every command of the journal in application order, accepted or not."""
    start_stance: str
    """``Stance`` value of both players at tick 0 (``economy.start_stance``)."""
    initial_owners: tuple[int | None, ...]
    """Owner of every node (by node id) at tick 0."""
    vp: tuple[int, ...]
    """Final VP by player id."""
    accepted: tuple[int, ...]
    """Accepted commands (all kinds) by player id."""
    rejected: tuple[int, ...]
    """Rejected commands by player id."""
    stock: tuple[tuple[int, ...], ...]
    """Charge stock samples by player id: entry ``t - 1`` of a player is the stock at the end of
    tick ``t`` (``charge_stock``); every player has one entry per tick played."""
    capture_charge_cost: int = 0
    """``capture.charge_cost`` of the ruleset."""
    places_start: tuple[tuple[int, ...], ...] = ()
    """``charge_places`` by player id before tick 1; empty in a hand-made log."""
    places_end: tuple[tuple[int, ...], ...] = ()
    """``charge_places`` by player id after the last tick."""
    place_samples: tuple[tuple[tuple[int, ...], ...], ...] = ((), ())
    """``charge_places`` by player id at the end of every ``PLACE_SAMPLE_TICKS``-th tick:
    entry ``i`` is tick ``(i + 1) * PLACE_SAMPLE_TICKS``."""
    bottleneck: tuple[tuple[int, int, int, int], ...] = ((0, 0, 0, 0), (0, 0, 0, 0))
    """By player id: ``marker_ticks``, ``front_empty_ticks``, ``front_empty_cap_has_ticks``,
    ``cap_full_ticks`` (module docstring)."""
    delivered_front: tuple[int, ...] = (0, 0)
    """By player id: charges delivered into a city with a front marker."""
    cp_cap_ticks: tuple[int, ...] = (0, 0)
    """By player id: ticks that ended with the CP at ``cp.cap`` (module docstring, #743)."""
    idle_discharged: tuple[tuple[int, int], ...] = ((0, 0), (0, 0))
    """By player id: ``(connected, pocket)`` idle discharged unit-ticks (module docstring)."""
    cp_cancelled: tuple[int, ...] = (0, 0)
    """By player id: CP in hundredths of the ``Move`` orders cancelled by ``CancelOrder`` (#690)."""
    economy_model: str = "v1"
    """``economy.model`` of the ruleset (#690)."""
    supply_model: str = "lines"
    """``supply.model`` of the ruleset (#690)."""
    stances: bool = False
    """The ruleset has ``[stances]`` (DEC-44)."""
    capitals: tuple[int, ...] = ()
    """The own capital by player id; empty in a hand-made log."""
    cp_by_stance: tuple[tuple[tuple[str, int], ...], ...] = ((), ())
    """By player id: ``(stance, CP in hundredths)``, only under ``[stances]`` (module docstring)."""
    front_width_sum: tuple[int, ...] = (0, 0)
    """By player id: the sum of the front width samples (module docstring, front pressure)."""
    front_samples: tuple[int, ...] = (0, 0)
    """By player id: the samples with a front width above 0."""
    cp_income: tuple[int, ...] = (0, 0)
    """By player id: CP in hundredths of the quanta fired, before the cap (#803)."""


def charge_stock(state: GameState) -> tuple[int, ...]:
    """Total charges of every player by player id (module docstring, charge stock).

    The sum does not depend on the iteration order, so the dicts are read as they are.
    """
    total = _zeros()
    for node in state.nodes.values():
        if node.owner is not None:
            total[node.owner] += node.warehouse
    for packet in state.packets.values():
        total[packet.owner] += packet.charges
    for group in state.groups.values():
        total[group.owner] += group.charged
    return tuple(total[p] for p in PLAYERS)


def charge_places(state: GameState) -> tuple[tuple[int, ...], ...]:
    """Charges of every player by player id split into ``PLACES`` (module docstring).

    The sums do not depend on the iteration order, so the dicts are read as they are.
    """
    out = {p: [0] * len(PLACES) for p in PLAYERS}
    for nid, node in state.nodes.items():
        owner = node.owner
        if owner is None:
            continue
        if nid == state.map.capital(owner):
            out[owner][0] += node.warehouse
        elif nid in state.players[owner].fronts:
            out[owner][1] += node.warehouse
        else:
            out[owner][2] += node.warehouse
    for group in state.groups.values():
        out[group.owner][4 if isinstance(group.location, OnEdge) else 3] += group.charged
    for packet in state.packets.values():
        out[packet.owner][5] += packet.charges
    return tuple(tuple(out[p]) for p in PLAYERS)


def _garrisons(state: GameState) -> dict[int, tuple[bool, ...]]:
    """Node -> per player id: whether a group of that player stands in the node."""
    held: dict[int, list[bool]] = {}
    for gid in sorted(state.groups):
        g = state.groups[gid]
        if isinstance(g.location, AtNode):
            held.setdefault(g.location.node, [False for _ in PLAYERS])[g.owner] = True
    return {node: tuple(flags) for node, flags in sorted(held.items())}


class MatchRecorder:
    """A ``MatchObserver`` that builds a ``MatchLog``; use one recorder per match."""

    def __init__(self) -> None:
        self._match: Match | None = None
        self._events: list[Event] = []
        self._moves: list[MoveRecord] = []
        self._commands: list[CommandRecord] = []
        self._owners: dict[int, int | None] = {}
        self._initial: tuple[int | None, ...] = ()
        self._accepted = _zeros()
        self._rejected = _zeros()
        self._stock: dict[int, list[int]] = {p: [] for p in PLAYERS}
        self._places_start: tuple[tuple[int, ...], ...] = ()
        self._samples: dict[int, list[tuple[int, ...]]] = {p: [] for p in PLAYERS}
        self._bottleneck = {p: [0, 0, 0, 0] for p in PLAYERS}
        self._delivered_front = _zeros()
        self._cap_ticks = _zeros()
        self._idle = {p: [0, 0] for p in PLAYERS}
        self._capitals: dict[int, int] = {}
        self._order_cost: dict[int, tuple[int, int]] = {}
        """Group id -> ``(player, cost)`` of its last accepted ``Move`` while it has an order."""
        self._cancelled = _zeros()
        self._cp_earned = {p: {s.value: 0 for s in Stance} for p in PLAYERS}
        self._garrisons: dict[int, tuple[bool, ...]] = {}
        """Node -> per player id: a group of that player stands in it (end of the last tick)."""
        self._neighbours: tuple[tuple[int, ...], ...] = ()
        self._front_sum = _zeros()
        self._front_samples = _zeros()
        self._cp_income = _zeros()

    def begin(self, match: Match) -> None:
        if self._match is not None:
            raise RuntimeError("the recorder has already begun")
        self._match = match
        self._capitals = {p: match.state.map.capital(p) for p in PLAYERS}
        self._places_start = charge_places(match.state)
        self._owners = {nid: n.owner for nid, n in sorted(match.state.nodes.items())}
        self._initial = tuple(self._owners.values())
        self._garrisons = _garrisons(match.state)
        mapdef = match.state.map
        self._neighbours = tuple(
            tuple(mapdef.edges[e].other(n.id) for e in mapdef.incident[n.id]) for n in mapdef.nodes
        )

    def record(self, match: Match, commands: Sequence[PlayerCommand]) -> None:
        if self._match is not match:
            raise RuntimeError("record() before begin() or with another match")
        by_key = {(c.player, c.seq): c.cmd for c in commands}
        for r in match.results:
            cmd = by_key[(r.player, r.seq)]
            kind = type(cmd).__name__
            planned = isinstance(cmd, Move) and cmd.planned
            if not isinstance(r.outcome, Ok):
                self._rejected[r.player] += 1
                self._commands.append(CommandRecord(r.tick, r.player, kind, False, 0, planned))
                continue
            self._accepted[r.player] += 1
            self._commands.append(
                CommandRecord(r.tick, r.player, kind, True, r.outcome.cost, planned)
            )
            if isinstance(cmd, CancelOrder):
                cancelled = self._order_cost.pop(cmd.group, None)
                if cancelled is not None and cancelled[0] == r.player:
                    self._cancelled[r.player] += cancelled[1]
            if isinstance(cmd, Move):  # owners are still those from before this tick's events
                attack = self._owners[cmd.dest] != r.player
                held = self._garrisons.get(cmd.dest)
                siege = (
                    attack and held is not None and any(held[p] for p in PLAYERS if p != r.player)
                )
                self._moves.append(MoveRecord(r.tick, r.player, cmd.planned, attack, siege))
                self._order_cost[cmd.group] = (r.player, r.outcome.cost)
        state = match.state
        for e in state.events:
            if e.kind == "node_captured":
                node, player = e.get("node"), e.get("player")
                assert isinstance(node, int) and isinstance(player, int)
                self._owners[node] = player
            elif e.kind == "packet_delivered":
                node, player, charges = e.get("node"), e.get("player"), e.get("charges")
                assert isinstance(node, int) and isinstance(player, int)
                assert isinstance(charges, int)
                if node in state.players[player].fronts:
                    self._delivered_front[player] += charges
        self._events.extend(state.events)
        for p, charges in zip(PLAYERS, charge_stock(state), strict=True):
            self._stock[p].append(charges)
        self._count_bottleneck(match)
        self._count_cp_and_idle(match)
        if match.rules.stances is not None:
            self._count_stance_cp(match)
        self._garrisons = _garrisons(state)
        self._order_cost = {
            gid: cost
            for gid, cost in sorted(self._order_cost.items())
            if gid in state.groups and state.groups[gid].order is not None
        }
        self._count_cp_income(match)
        if state.tick % PLACE_SAMPLE_TICKS == 0:
            for p, places in zip(PLAYERS, charge_places(state), strict=True):
                self._samples[p].append(places)
            self._count_front(state)

    def _count_front(self, state: GameState) -> None:
        """One front width sample of both players (module docstring, front pressure)."""
        width = _zeros()
        nodes = state.nodes
        for nid, node in nodes.items():  # the sums do not depend on the order
            owner = node.owner
            if owner is None:
                continue
            if any(nodes[m].owner == 1 - owner for m in self._neighbours[nid]):
                width[owner] += 1
        for p in PLAYERS:
            if width[p]:
                self._front_sum[p] += width[p]
                self._front_samples[p] += 1

    def _count_cp_income(self, match: Match) -> None:
        """The CP quanta of this tick (module docstring, front pressure)."""
        rules, state = match.rules, match.state
        for p in PLAYERS:
            if rules.stances is not None:
                fired = state.players[p].cp_ticks == 0
            else:
                fired = state.tick % rules.cp.period_ticks == 0
            if fired:
                self._cp_income[p] += rules.cp.per_period

    def _count_bottleneck(self, match: Match) -> None:
        state = match.state
        for p in PLAYERS:
            capital = self._capitals[p]
            cap = state.nodes[capital]
            if cap.owner != p:
                continue
            counts = self._bottleneck[p]
            if cap.warehouse >= warehouse_capacity(state, match.rules, capital):
                counts[3] += 1
            marked = [
                n
                for n in state.players[p].fronts
                if n is not None and n != capital and state.nodes[n].owner == p
            ]
            if not marked:
                continue
            counts[0] += 1
            if any(state.nodes[n].warehouse == 0 for n in marked):
                counts[1] += 1
                if cap.warehouse > 0:
                    counts[2] += 1

    def _count_stance_cp(self, match: Match) -> None:
        """The CP of this tick's quanta by stance (DEC-44): the economy adds 1 to ``cp_ticks``
        every tick, so it ends a tick at 0 only when the quantum fired in that tick."""
        state = match.state
        for p in PLAYERS:
            player = state.players[p]
            if player.cp_ticks != 0:
                continue
            burned = 0
            for e in state.events:
                if e.kind == "cp_burned" and e.get("player") == p:
                    cp = e.get("cp")
                    assert isinstance(cp, int)
                    burned += cp
            self._cp_earned[p][player.stance.value] += match.rules.cp.per_period - burned

    def _count_cp_and_idle(self, match: Match) -> None:
        """One tick of ``cp_cap_ticks`` and of the idle discharged unit-ticks (#743)."""
        state = match.state
        for p in PLAYERS:
            if state.players[p].cp >= match.rules.cp.cap:
                self._cap_ticks[p] += 1
        supplied: dict[int, tuple[bool, ...]] = {}
        for g in state.groups.values():  # the sums do not depend on the order
            if g.charged >= g.units or g.fight is not None or g.order is not None:
                continue
            loc = g.location
            if not isinstance(loc, AtNode):
                continue
            node = state.nodes[loc.node]
            if node.owner != g.owner or node.warehouse > 0:
                continue
            if g.owner not in supplied:
                supplied[g.owner] = supplied_territory(state, g.owner)
            self._idle[g.owner][0 if supplied[g.owner][loc.node] else 1] += g.units - g.charged

    def log(self) -> MatchLog:
        """The log of the match as far as it was played."""
        match = self._match
        if match is None:
            raise RuntimeError("the recorder has not begun")
        return MatchLog(
            tick_hz=match.rules.tick_hz,
            ticks=match.tick,
            events=tuple(self._events),
            moves=tuple(self._moves),
            commands=tuple(self._commands),
            start_stance=match.rules.economy.start_stance.value,
            initial_owners=self._initial,
            vp=tuple(match.state.players[p].vp for p in PLAYERS),
            accepted=tuple(self._accepted[p] for p in PLAYERS),
            rejected=tuple(self._rejected[p] for p in PLAYERS),
            stock=tuple(tuple(self._stock[p]) for p in PLAYERS),
            capture_charge_cost=match.rules.capture.charge_cost,
            places_start=self._places_start,
            places_end=charge_places(match.state),
            place_samples=tuple(tuple(self._samples[p]) for p in PLAYERS),
            bottleneck=tuple(
                (b[0], b[1], b[2], b[3]) for b in (self._bottleneck[p] for p in PLAYERS)
            ),
            delivered_front=tuple(self._delivered_front[p] for p in PLAYERS),
            cp_cap_ticks=tuple(self._cap_ticks[p] for p in PLAYERS),
            idle_discharged=tuple((self._idle[p][0], self._idle[p][1]) for p in PLAYERS),
            cp_cancelled=tuple(self._cancelled[p] for p in PLAYERS),
            economy_model=match.rules.economy.model.value,
            supply_model=match.rules.supply.model.value,
            stances=match.rules.stances is not None,
            capitals=tuple(self._capitals[p] for p in PLAYERS),
            cp_by_stance=tuple(tuple(self._cp_earned[p].items()) for p in PLAYERS),
            front_width_sum=tuple(self._front_sum[p] for p in PLAYERS),
            front_samples=tuple(self._front_samples[p] for p in PLAYERS),
            cp_income=tuple(self._cp_income[p] for p in PLAYERS),
        )


@dataclass(frozen=True, slots=True)
class ChargeFlow:
    """The charge ledger, flow, stock by place and bottleneck of one player (module docstring).

    ``charges_produced`` and ``charges_burned`` stay in ``MatchMetrics``.
    """

    start: int
    fights: int
    captures: int
    packets_lost: int
    warehouses_lost: int
    starved: int
    attrition: int
    built: int
    """Economy v2: the charges paid for buildings (``build_paid``, DEC-41 item 7)."""
    plans: int
    """Economy v2: the charges planned orders took for their bonus (``plan_charged``, item 10)."""
    tolls: int
    """The charges road fortifications took from the player's groups (``toll_paid``, DEC-43
    item D6)."""
    end: int
    residual: int
    """``start + produced - (burned + fights + captures + packets_lost + warehouses_lost +
    starved + attrition + built + plans + tolls) - end``; 0 in a consistent match."""
    sent: int
    delivered: int
    delivered_front: int
    transfers: int
    tolls_paid: int
    """Road fortification tolls the player's groups paid (``toll_paid`` events, DEC-43 item D)."""
    forts_built: int
    """Road fortifications of the player that started to work (``road_fort_built``)."""
    stock_by_place_minute: tuple[tuple[str, tuple[int | None, ...]], ...]
    """Per ``PLACES`` name the mean of each match minute in hundredths of a charge."""
    marker_ticks: int
    front_empty_ticks: int
    front_empty_cap_has_ticks: int
    cap_full_ticks: int
    front_empty_permille: int | None
    front_empty_cap_has_permille: int | None


_FLOW_FIELDS: Final[tuple[str, ...]] = (
    "start",
    "fights",
    "captures",
    "packets_lost",
    "warehouses_lost",
    "starved",
    "attrition",
    "built",
    "plans",
    "tolls",
    "end",
    "residual",
    "sent",
    "delivered",
    "delivered_front",
    "transfers",
    "tolls_paid",
    "forts_built",
    "marker_ticks",
    "front_empty_ticks",
    "front_empty_cap_has_ticks",
    "cap_full_ticks",
)
"""Integer fields of ``ChargeFlow`` that ``MatchMetrics.to_json`` writes as ``charges_<name>`` or
``<name>``: ``_flow_key``."""


def _flow_key(name: str) -> str:
    if name.endswith("_ticks") or name in ("stock_by_place_minute", "tolls_paid", "forts_built"):
        return name
    return f"charges_{name}"


@dataclass(frozen=True, slots=True)
class MatchMetrics:
    """Metrics of one match (module docstring); ``to_json`` is the JSONL form (BOT-04)."""

    winner: int | None
    """Winning side (``0`` or ``1``); ``None`` for a draw or an unfinished match."""
    reason: str
    """``EndReason`` value of ``match_ended`` or ``UNFINISHED``."""
    ticks: int
    duration_s: float
    vp: tuple[int, ...]
    cities: tuple[int, ...]
    orders: tuple[int, ...]
    """Accepted ``Move`` orders by player."""
    attack_orders: tuple[int, ...]
    planned_attack_orders: tuple[int, ...]
    planned_attack_share: tuple[float | None, ...]
    """Over all attack orders (BAL-01); the gate uses ``planned_siege_share``."""
    siege_orders: tuple[int, ...]
    """Attack orders into a node with an enemy garrison (#590)."""
    planned_siege_orders: tuple[int, ...]
    planned_siege_share: tuple[float | None, ...]
    """The gate metric (#590): ``planned_siege_orders / siege_orders``."""
    sieges: tuple[int, ...]
    sieges_won: tuple[int, ...]
    captures: tuple[int, ...]
    captures_by_minute: tuple[tuple[int, ...], ...]
    accepted: tuple[int, ...]
    rejected: tuple[int, ...]
    stock_mean_centi: tuple[int | None, ...]
    """Mean charge stock in hundredths of a charge; ``None`` without samples."""
    stock_peak: tuple[int, ...]
    """Largest charge stock sample."""
    charges_produced: tuple[int, ...]
    charges_burned: tuple[int, ...]
    burned_permille: tuple[int | None, ...]
    """``charges_burned * 1000 // charges_produced``; ``None`` without production."""
    flow: tuple[ChargeFlow, ...]
    """The charge ledger and flow by player id (#588)."""
    cp_burned: tuple[int, ...]
    """CP in hundredths the regeneration lost at the cap (#743)."""
    cp_cap_ticks: tuple[int, ...]
    """Ticks that ended with the CP at the cap (#743)."""
    idle_discharged_connected: tuple[int, ...]
    """Idle discharged unit-ticks in the capital's component (#743)."""
    idle_discharged_pocket: tuple[int, ...]
    """Idle discharged unit-ticks in pockets (#743)."""
    economy_model: str = "v1"
    """``economy.model`` of the ruleset (#690)."""
    supply_model: str = "lines"
    """``supply.model`` of the ruleset (#690)."""
    first_contact_tick: int | None = None
    """The first fight or capture of an enemy node (#690); ``None``: the players never met."""
    siege_fights: tuple[int, ...] = (0, 0)
    """Fights for an enemy node with the player as attacker: the fight part of ``sieges``."""
    siege_walk_ins: tuple[int, ...] = (0, 0)
    """Walks into an empty enemy node: the other part of ``sieges``."""
    contested_sieges: tuple[int, ...] = (0, 0)
    """Siege fights against a charged defender (#690)."""
    contested_sieges_won: tuple[int, ...] = (0, 0)
    """Contested sieges that ended with the capture of the node."""
    units_killed: tuple[int, ...] = (0, 0)
    """Enemy units killed by the player's shots."""
    charges_per_kill_centi: tuple[int | None, ...] = (None, None)
    """``charges_fights * 100 // units_killed``; ``None`` without a kill."""
    charges_built_lost: tuple[int, ...] = (0, 0)
    """Charges paid for buildings later stopped or captured (#690)."""
    cp_cancelled: tuple[int, ...] = (0, 0)
    """CP in hundredths of the ``Move`` orders cancelled by ``CancelOrder`` (#690)."""
    front_width_sum: tuple[int, ...] = (0, 0)
    """Front node-samples (#803, module docstring, front pressure)."""
    front_samples: tuple[int, ...] = (0, 0)
    """Samples with a front."""
    front_width_centi: tuple[int | None, ...] = (None, None)
    """Mean front width while a front exists, in hundredths."""
    front_pressure_centi: tuple[int | None, ...] = (None, None)
    """Fight charges per front node per minute, in hundredths."""
    cp_income: tuple[int, ...] = (0, 0)
    """CP in hundredths of the quanta fired, before the cap."""

    def to_json(self) -> dict[str, object]:
        """Plain JSON data; per-player values are lists indexed by player id."""
        flow: dict[str, object] = {
            _flow_key(f): [getattr(x, f) for x in self.flow] for f in _FLOW_FIELDS
        }
        flow["stock_by_place_minute"] = [
            {name: list(values) for name, values in x.stock_by_place_minute} for x in self.flow
        ]
        flow["front_empty_permille"] = [x.front_empty_permille for x in self.flow]
        flow["front_empty_cap_has_permille"] = [x.front_empty_cap_has_permille for x in self.flow]
        return {
            "winner": self.winner,
            "reason": self.reason,
            "ticks": self.ticks,
            "duration_s": self.duration_s,
            "vp": list(self.vp),
            "cities": list(self.cities),
            "orders": list(self.orders),
            "attack_orders": list(self.attack_orders),
            "planned_attack_orders": list(self.planned_attack_orders),
            "planned_attack_share": list(self.planned_attack_share),
            "siege_orders": list(self.siege_orders),
            "planned_siege_orders": list(self.planned_siege_orders),
            "planned_siege_share": list(self.planned_siege_share),
            "sieges": list(self.sieges),
            "sieges_won": list(self.sieges_won),
            "captures": list(self.captures),
            "captures_by_minute": [list(m) for m in self.captures_by_minute],
            "accepted": list(self.accepted),
            "rejected": list(self.rejected),
            "stock_mean_centi": list(self.stock_mean_centi),
            "stock_peak": list(self.stock_peak),
            "charges_produced": list(self.charges_produced),
            "charges_burned": list(self.charges_burned),
            "burned_permille": list(self.burned_permille),
            **flow,
            "cp_burned": list(self.cp_burned),
            "cp_cap_ticks": list(self.cp_cap_ticks),
            "idle_discharged_connected": list(self.idle_discharged_connected),
            "idle_discharged_pocket": list(self.idle_discharged_pocket),
            "economy_model": self.economy_model,
            "supply_model": self.supply_model,
            "first_contact_tick": self.first_contact_tick,
            "siege_fights": list(self.siege_fights),
            "siege_walk_ins": list(self.siege_walk_ins),
            "contested_sieges": list(self.contested_sieges),
            "contested_sieges_won": list(self.contested_sieges_won),
            "units_killed": list(self.units_killed),
            "charges_per_kill_centi": list(self.charges_per_kill_centi),
            "charges_built_lost": list(self.charges_built_lost),
            "cp_cancelled": list(self.cp_cancelled),
            "front_width_sum": list(self.front_width_sum),
            "front_samples": list(self.front_samples),
            "front_width_centi": list(self.front_width_centi),
            "front_pressure_centi": list(self.front_pressure_centi),
            "cp_income": list(self.cp_income),
        }


def analyze(log: MatchLog) -> MatchMetrics:
    """The metrics of a match from its log (module docstring)."""
    minute_ticks = 60 * log.tick_hz
    minutes = max(1, -(-log.ticks // minute_ticks))
    owners = dict(enumerate(log.initial_owners))
    sieges = _zeros()
    walk_ins = _zeros()
    won = _zeros()
    by_minute: dict[int, list[int]] = {p: [0] * minutes for p in PLAYERS}
    winner: int | None = None
    reason = UNFINISHED
    produced = _zeros()
    burned = _zeros()
    ledger = {k: _zeros() for k in _EVENT_COUNTERS}
    cp_burned = _zeros()
    effort = _Effort(owners)
    fought: set[int] = set()  # nodes whose fight started or ended in the tick being read
    fight_tick = -1
    for e in log.events:
        if e.tick != fight_tick:
            fought.clear()
            fight_tick = e.tick
        match e.kind:
            case "fight_started":
                node, attacker = e.get("node"), e.get("attacker")
                if isinstance(node, int) and isinstance(attacker, int):  # not an edge meeting
                    sieges[attacker] += 1
                    fought.add(node)
            case "fight_ended":
                node = e.get("node")
                if isinstance(node, int):
                    fought.add(node)
            case "node_captured":
                node, player = e.get("node"), e.get("player")
                assert isinstance(node, int) and isinstance(player, int)
                ledger["captures"][player] += 1
                if owners[node] == 1 - player:  # an enemy node, not a neutral one
                    won[player] += 1
                    if node not in fought:  # walked into an empty node: a siege of one step
                        sieges[player] += 1
                        walk_ins[player] += 1
                owners[node] = player
                by_minute[player][min((e.tick - 1) // minute_ticks, minutes - 1)] += 1
            case "charges_produced" | "charges_overflow":
                player, charges = e.get("player"), e.get("charges")
                assert isinstance(player, int) and isinstance(charges, int)
                (produced if e.kind == "charges_produced" else burned)[player] += charges
            case "charge_burned":  # made by a full factory and burned at once (DEC-41, item 2)
                player, charges = e.get("player"), e.get("charges")
                assert isinstance(player, int) and isinstance(charges, int)
                produced[player] += charges
                burned[player] += charges
            case "cp_burned":
                player, cp = e.get("player"), e.get("cp")
                assert isinstance(player, int) and isinstance(cp, int)
                cp_burned[player] += cp
            case "match_ended":
                w, why = e.get("winner"), e.get("reason")
                assert (w is None or isinstance(w, int)) and isinstance(why, str)
                winner, reason = w, why
            case _:
                pass
        _count_ledger(e, ledger)
        effort.read(e)
    orders = _zeros()
    attacks = _zeros()
    planned = _zeros()
    siege_orders = _zeros()
    planned_sieges = _zeros()
    for m in log.moves:
        orders[m.player] += 1
        if m.attack:
            attacks[m.player] += 1
            planned[m.player] += m.planned
        if m.siege:
            siege_orders[m.player] += 1
            planned_sieges[m.player] += m.planned
    return MatchMetrics(
        winner=winner,
        reason=reason,
        ticks=log.ticks,
        duration_s=round(log.ticks / log.tick_hz, 3),
        vp=log.vp,
        cities=tuple(sum(1 for o in owners.values() if o == p) for p in PLAYERS),
        orders=tuple(orders[p] for p in PLAYERS),
        attack_orders=tuple(attacks[p] for p in PLAYERS),
        planned_attack_orders=tuple(planned[p] for p in PLAYERS),
        planned_attack_share=tuple(
            round(planned[p] / attacks[p], 4) if attacks[p] else None for p in PLAYERS
        ),
        siege_orders=tuple(siege_orders[p] for p in PLAYERS),
        planned_siege_orders=tuple(planned_sieges[p] for p in PLAYERS),
        planned_siege_share=tuple(
            round(planned_sieges[p] / siege_orders[p], 4) if siege_orders[p] else None
            for p in PLAYERS
        ),
        sieges=tuple(sieges[p] for p in PLAYERS),
        sieges_won=tuple(won[p] for p in PLAYERS),
        captures=tuple(sum(by_minute[p]) for p in PLAYERS),
        captures_by_minute=tuple(tuple(by_minute[p]) for p in PLAYERS),
        accepted=log.accepted,
        rejected=log.rejected,
        stock_mean_centi=tuple(
            sum(log.stock[p]) * 100 // len(log.stock[p]) if log.stock[p] else None for p in PLAYERS
        ),
        stock_peak=tuple(max(log.stock[p], default=0) for p in PLAYERS),
        charges_produced=tuple(produced[p] for p in PLAYERS),
        charges_burned=tuple(burned[p] for p in PLAYERS),
        burned_permille=tuple(
            burned[p] * 1000 // produced[p] if produced[p] else None for p in PLAYERS
        ),
        flow=tuple(
            _charge_flow(
                log, p, minutes, {k: v[p] for k, v in ledger.items()}, produced[p], burned[p]
            )
            for p in PLAYERS
        ),
        cp_burned=tuple(cp_burned[p] for p in PLAYERS),
        cp_cap_ticks=log.cp_cap_ticks,
        idle_discharged_connected=tuple(log.idle_discharged[p][0] for p in PLAYERS),
        idle_discharged_pocket=tuple(log.idle_discharged[p][1] for p in PLAYERS),
        economy_model=log.economy_model,
        supply_model=log.supply_model,
        first_contact_tick=effort.contact,
        siege_fights=tuple(effort.fights[p] for p in PLAYERS),
        siege_walk_ins=tuple(walk_ins[p] for p in PLAYERS),
        contested_sieges=tuple(effort.contested[p] for p in PLAYERS),
        contested_sieges_won=tuple(effort.contested_won[p] for p in PLAYERS),
        units_killed=tuple(effort.killed[p] for p in PLAYERS),
        charges_per_kill_centi=tuple(
            ledger["fights"][p] * 100 // effort.killed[p] if effort.killed[p] else None
            for p in PLAYERS
        ),
        charges_built_lost=tuple(effort.built_lost[p] for p in PLAYERS),
        cp_cancelled=log.cp_cancelled,
        front_width_sum=log.front_width_sum,
        front_samples=log.front_samples,
        front_width_centi=tuple(
            log.front_width_sum[p] * 100 // log.front_samples[p] if log.front_samples[p] else None
            for p in PLAYERS
        ),
        front_pressure_centi=tuple(
            ledger["fights"][p]
            * 100
            * minute_ticks
            // (log.front_width_sum[p] * PLACE_SAMPLE_TICKS)
            if log.front_width_sum[p]
            else None
            for p in PLAYERS
        ),
        cp_income=log.cp_income,
    )


def _opt_int(e: Event, key: str) -> int | None:
    """The integer field ``key`` of ``e``; ``None`` when the event has no such field (a road build,
    a hand-made log) or it is not an integer."""
    value = next((v for k, v in e.data if k == key), None)
    return value if isinstance(value, int) and not isinstance(value, bool) else None


_COMPLETED: Final = {
    "barracks_built": "barracks",
    "warehouse_upgraded": "warehouse",
    "factory_built": FACTORY_KIND,
    "fort_built": FORT_KIND,
}
"""The event of a finished city building -> the ``kind`` of its ``build_paid`` events."""


class _Effort:
    """The contact, siege, kill and building counters of ``analyze`` (module docstring, #690).

    It reads the events in order and keeps its own node owners (from ``initial_owners``).
    """

    def __init__(self, owners: dict[int, int | None]) -> None:
        self.owners = dict(owners)
        self.contact: int | None = None
        self.fights = _zeros()
        self.contested = _zeros()
        self.contested_won = _zeros()
        self.killed = _zeros()
        self.built_lost = _zeros()
        self._open: dict[int, tuple[int, bool]] = {}
        """Fight id -> ``(attacker, the defender spent a charge)`` of an open siege fight."""
        self._paying: dict[tuple[int, int, str], int] = {}
        """``(player, node, kind)`` -> charges paid for a build that is not finished."""
        self._standing: dict[tuple[int, int], int] = {}
        """``(player, node)`` -> charges paid for the finished buildings of the node."""

    def _touch(self, tick: int) -> None:
        if self.contact is None:
            self.contact = tick

    def read(self, e: Event) -> None:
        match e.kind:
            case "fight_started":
                self._touch(e.tick)
                self._start(e)
            case "fight_round":
                self._round(e)
            case "fight_ended":
                fight = _opt_int(e, "fight")
                if fight is not None and fight in self._open:
                    attacker, spent = self._open.pop(fight)
                    if spent:
                        self.contested[attacker] += 1
                        if e.get("captured") is True and _opt_int(e, "winner") == attacker:
                            self.contested_won[attacker] += 1
            case "node_captured":
                node, player = e.get("node"), e.get("player")
                assert isinstance(node, int) and isinstance(player, int)
                before = self.owners[node]
                if before is not None and before == 1 - player:
                    self._touch(e.tick)
                    self.built_lost[before] += self._standing.pop((before, node), 0)
                self.owners[node] = player
            case "build_paid":
                player, node, kind = e.get("player"), e.get("node"), e.get("kind")
                warehouse, units = e.get("warehouse"), e.get("units")
                assert isinstance(player, int) and isinstance(node, int) and isinstance(kind, str)
                assert isinstance(warehouse, int) and isinstance(units, int)
                key = (player, node, kind)
                self._paying[key] = self._paying.get(key, 0) + warehouse + units
            case "build_stopped":
                player, node, kind = e.get("player"), _opt_int(e, "node"), e.get("kind")
                if isinstance(player, int) and node is not None and isinstance(kind, str):
                    self.built_lost[player] += self._paying.pop((player, node, kind), 0)
            case _ if e.kind in _COMPLETED:
                player, node = e.get("player"), e.get("node")
                assert isinstance(player, int) and isinstance(node, int)
                paid = self._paying.pop((player, node, _COMPLETED[e.kind]), 0)
                key = (player, node)
                self._standing[key] = self._standing.get(key, 0) + paid
            case _:
                pass

    def _start(self, e: Event) -> None:
        node, attacker, fight = e.get("node"), e.get("attacker"), _opt_int(e, "fight")
        if not (isinstance(node, int) and isinstance(attacker, int)):
            return  # an edge meeting or a neutral node
        if self.owners[node] != 1 - attacker:
            return  # not a fight for an enemy node
        self.fights[attacker] += 1
        if fight is not None:
            self._open[fight] = (attacker, False)

    def _round(self, e: Event) -> None:
        for p in PLAYERS:
            self.killed[p] += _opt_int(e, f"losses_{1 - p}") or 0
        fight = _opt_int(e, "fight")
        if fight is not None and fight in self._open:
            attacker, spent = self._open[fight]
            defender = _opt_int(e, f"spent_{1 - attacker}") or 0
            self._open[fight] = (attacker, spent or defender > 0)


_EVENT_COUNTERS: Final[tuple[str, ...]] = (
    "captures",
    "fights",
    "packets_lost",
    "warehouses_lost",
    "starved",
    "attrition",
    "built",
    "plans",
    "tolls",
    "tolls_paid",
    "forts_built",
    "sent",
    "delivered",
    "transfers",
)
"""Counters of ``_count_ledger`` (``captures`` is counted in ``analyze``)."""


def _count_ledger(e: Event, ledger: dict[str, dict[int, int]]) -> None:
    """Add the charges that event ``e`` spent or moved to ``ledger`` (module docstring)."""
    match e.kind:
        case "fight_round":
            for p in PLAYERS:
                spent = e.get(f"spent_{p}")
                assert isinstance(spent, int)
                ledger["fights"][p] += spent + (_opt_int(e, f"burned_{p}") or 0)
        case "packet_lost" | "packet_sent" | "packet_delivered" | "transfer_started":
            player, charges = e.get("player"), e.get("charges")
            assert isinstance(player, int) and isinstance(charges, int)
            key = {
                "packet_lost": "packets_lost",
                "packet_sent": "sent",
                "packet_delivered": "delivered",
                "transfer_started": "transfers",
            }[e.kind]
            ledger[key][player] += charges
        case "warehouse_lost":
            owner, charges = e.get("owner"), e.get("charges")
            assert isinstance(owner, int) and isinstance(charges, int)
            ledger["warehouses_lost"][owner] += charges
        case "starvation":
            player, warehouse, units = e.get("player"), e.get("warehouse"), e.get("units")
            assert isinstance(player, int) and isinstance(warehouse, int)
            assert isinstance(units, int)
            ledger["starved"][player] += warehouse + units
        case "attrition":
            player, charged = e.get("player"), e.get("charged")
            assert isinstance(player, int)
            ledger["attrition"][player] += 1 if charged else 0
        case "build_paid":
            player, warehouse, units = e.get("player"), e.get("warehouse"), e.get("units")
            assert isinstance(player, int) and isinstance(warehouse, int)
            assert isinstance(units, int)
            ledger["built"][player] += warehouse + units
        case "plan_charged":
            player = e.get("player")
            assert isinstance(player, int)
            ledger["plans"][player] += 1
        case "toll_paid":
            player, charges = e.get("player"), e.get("charges")
            assert isinstance(player, int) and isinstance(charges, int)
            ledger["tolls"][player] += charges
            ledger["tolls_paid"][player] += 1
        case "road_fort_built":
            player = e.get("player")
            assert isinstance(player, int)
            ledger["forts_built"][player] += 1
        case _:
            pass


def _charge_flow(
    log: MatchLog, player: int, minutes: int, counts: dict[str, int], produced: int, burned: int
) -> ChargeFlow:
    start = sum(log.places_start[player]) if log.places_start else 0
    end = sum(log.places_end[player]) if log.places_end else 0
    counts["captures"] *= log.capture_charge_cost
    sinks = burned + sum(
        counts[k]
        for k in (
            "captures",
            "fights",
            "packets_lost",
            "warehouses_lost",
            "starved",
            "attrition",
            "built",
            "plans",
            "tolls",
        )
    )
    by_place: dict[str, list[int | None]] = {name: [None] * minutes for name in PLACES}
    minute_ticks = 60 * log.tick_hz
    sums = [[0] * len(PLACES) for _ in range(minutes)]
    taken = [0] * minutes
    for i, places in enumerate(log.place_samples[player]):
        m = min(((i + 1) * PLACE_SAMPLE_TICKS - 1) // minute_ticks, minutes - 1)
        taken[m] += 1
        for j, value in enumerate(places):
            sums[m][j] += value
    for m in range(minutes):
        if taken[m]:
            for j, name in enumerate(PLACES):
                by_place[name][m] = sums[m][j] * 100 // taken[m]
    marker, empty, empty_cap, cap_full = log.bottleneck[player]
    return ChargeFlow(
        start=start,
        fights=counts["fights"],
        captures=counts["captures"],
        packets_lost=counts["packets_lost"],
        warehouses_lost=counts["warehouses_lost"],
        starved=counts["starved"],
        attrition=counts["attrition"],
        built=counts["built"],
        tolls=counts["tolls"],
        tolls_paid=counts["tolls_paid"],
        forts_built=counts["forts_built"],
        plans=counts["plans"],
        end=end,
        residual=start + produced - sinks - end,
        sent=counts["sent"],
        delivered=counts["delivered"],
        delivered_front=log.delivered_front[player],
        transfers=counts["transfers"],
        stock_by_place_minute=tuple((name, tuple(v)) for name, v in by_place.items()),
        marker_ticks=marker,
        front_empty_ticks=empty,
        front_empty_cap_has_ticks=empty_cap,
        cap_full_ticks=cap_full,
        front_empty_permille=empty * 1000 // marker if marker else None,
        front_empty_cap_has_permille=empty_cap * 1000 // marker if marker else None,
    )


# Player statistics (#375) ---------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class PlayerStats:
    """What one player did (module docstring); ``to_json`` is the JSONL form."""

    stance_timeline: tuple[tuple[int, str], ...]
    """``(tick, stance)``, the first entry is ``(0, start stance)``."""
    stance_ticks: tuple[tuple[str, int], ...]
    """Ticks under each stance, in ``Stance`` order; the values sum to ``MatchLog.ticks``."""
    stance_switches: int
    """Accepted stance changes."""
    stance_share: tuple[tuple[str, float | None], ...]
    """The share of the match under each stance, in ``Stance`` order."""
    cp_by_stance: tuple[tuple[str, int], ...]
    """CP in hundredths earned under each stance, only under ``[stances]`` (DEC-44)."""
    charges_by_stance: tuple[tuple[str, int, int], ...]
    """``(stance, capital, built)``: charges made under each stance (module docstring)."""
    charges_capital: int
    """Charges made by the own capital."""
    charges_built: int
    """Charges made by every other factory."""
    commands: int
    """Commands sent, ``Forfeit`` excluded."""
    rejected: int
    """The part of ``commands`` that was rejected."""
    apm_avg: float | None
    apm_by_minute: tuple[int, ...]
    apm_peak: int
    front_ticks: tuple[int, ...]
    """Ticks of the accepted ``SetFront`` commands."""
    rear_min_ticks: tuple[int, ...]
    transfer_ticks: tuple[int, ...]
    transfer_charges: int
    """Charges sent by the accepted transfers."""
    orders: int
    """Accepted ``Move`` orders."""
    planned_orders: int
    planned_share: float | None
    planned_attack_share: float | None
    planned_siege_share: float | None
    """As in ``MatchMetrics`` (#590)."""
    cp_by_category: tuple[tuple[str, int], ...]
    """CP in hundredths per ``CP_CATEGORIES``, recruit net of refunds."""
    cp_refunded: int
    cp_total: int

    def to_json(self) -> dict[str, object]:
        return {
            "stance_timeline": [[t, s] for t, s in self.stance_timeline],
            "stance_ticks": dict(self.stance_ticks),
            "stance_switches": self.stance_switches,
            "stance_share": dict(self.stance_share),
            "cp_by_stance": dict(self.cp_by_stance),
            "charges_by_stance": {s: [c, b] for s, c, b in self.charges_by_stance},
            "charges_capital": self.charges_capital,
            "charges_built": self.charges_built,
            "commands": self.commands,
            "rejected": self.rejected,
            "apm_avg": self.apm_avg,
            "apm_by_minute": list(self.apm_by_minute),
            "apm_peak": self.apm_peak,
            "supply": {
                "set_front": list(self.front_ticks),
                "set_rear_min": list(self.rear_min_ticks),
                "transfer": list(self.transfer_ticks),
                "transfer_charges": self.transfer_charges,
            },
            "orders": self.orders,
            "planned_orders": self.planned_orders,
            "planned_share": self.planned_share,
            "planned_attack_share": self.planned_attack_share,
            "planned_siege_share": self.planned_siege_share,
            "cp_by_category": dict(self.cp_by_category),
            "cp_refunded": self.cp_refunded,
            "cp_total": self.cp_total,
        }


@dataclass(frozen=True, slots=True)
class MatchStats:
    """``PlayerStats`` of both sides, indexed by player id."""

    players: tuple[PlayerStats, ...]
    stances: bool = False
    """The ruleset of the match has ``[stances]`` (DEC-44)."""

    def to_json(self) -> dict[str, object]:
        return {"players": [p.to_json() for p in self.players], "stances": self.stances}


def analyze_stats(log: MatchLog) -> MatchStats:
    """The statistics of both players from the log (module docstring)."""
    return MatchStats(tuple(_player_stats(log, p) for p in PLAYERS), log.stances)


def _stance_line(log: MatchLog, player: int) -> tuple[tuple[tuple[int, str], ...], dict[str, int]]:
    timeline = [(0, log.start_stance)]
    for e in log.events:
        if e.kind == "stance_changed" and e.get("player") == player:
            stance = e.get("stance")
            assert isinstance(stance, str)
            timeline.append((e.tick, stance))
    ticks = {s.value: 0 for s in Stance}
    # A stance set at tick t works from tick t on; the start stance from tick 1.
    firsts = [max(t, 1) for t, _ in timeline] + [log.ticks + 1]
    for (_, stance), first, nxt in zip(timeline, firsts, firsts[1:], strict=False):
        ticks[stance] += max(0, nxt - first)
    return tuple(timeline), ticks


def _charges_by_stance(
    log: MatchLog, player: int, timeline: Sequence[tuple[int, str]]
) -> dict[str, list[int]]:
    """Stance -> ``[capital, built]``: the charges the factories of ``player`` made under it."""
    made = {s.value: [0, 0] for s in Stance}
    capital = log.capitals[player] if log.capitals else None
    at = 0
    for e in log.events:  # in tick order, like the timeline
        if e.kind not in ("charges_produced", "charge_burned") or e.get("player") != player:
            continue
        while at + 1 < len(timeline) and timeline[at + 1][0] <= e.tick:
            at += 1
        charges = e.get("charges")
        assert isinstance(charges, int)
        made[timeline[at][1]][0 if e.get("node") == capital else 1] += charges
    return made


def _player_stats(log: MatchLog, player: int) -> PlayerStats:
    minute_ticks = 60 * log.tick_hz
    minutes = max(1, -(-log.ticks // minute_ticks))
    timeline, in_stance = _stance_line(log, player)
    by_minute = [0] * minutes
    sent = rejected = 0
    ticks: dict[str, list[int]] = {"SetFront": [], "SetRearMin": [], "Transfer": []}
    spent: dict[str, int] = dict.fromkeys(CP_CATEGORIES, 0)
    for c in log.commands:
        if c.player != player or c.kind == Forfeit.__name__:
            continue
        sent += 1
        by_minute[min((c.tick - 1) // minute_ticks, minutes - 1)] += 1
        if not c.accepted:
            rejected += 1
            continue
        if c.kind in ticks:
            ticks[c.kind].append(c.tick)
        if c.kind == Move.__name__:
            spent["planned_move" if c.planned else "move"] += c.cost
        else:
            spent[_KIND_CATEGORY.get(c.kind, "other")] += c.cost
    refunded = charges = 0
    for e in log.events:
        if e.kind not in ("recruit_cancelled", "transfer_started") or e.get("player") != player:
            continue
        if e.kind == "recruit_cancelled":
            cp = e.get("cp")
            assert isinstance(cp, int)
            refunded += cp
        elif e.kind == "transfer_started":
            n = e.get("charges")
            assert isinstance(n, int)
            charges += n
    spent["recruit"] -= refunded
    orders = sum(1 for m in log.moves if m.player == player)
    planned = sum(1 for m in log.moves if m.player == player and m.planned)
    attacks = [m for m in log.moves if m.player == player and m.attack]
    planned_attacks = sum(1 for m in attacks if m.planned)
    sieges = [m for m in log.moves if m.player == player and m.siege]
    planned_sieges = sum(1 for m in sieges if m.planned)
    by_stance = _charges_by_stance(log, player, timeline)
    return PlayerStats(
        stance_timeline=timeline,
        stance_ticks=tuple(in_stance.items()),
        stance_switches=len(timeline) - 1,
        stance_share=tuple(
            (s, round(t / log.ticks, 4) if log.ticks else None) for s, t in in_stance.items()
        ),
        cp_by_stance=log.cp_by_stance[player],
        charges_by_stance=tuple((s, c, b) for s, (c, b) in by_stance.items()),
        charges_capital=sum(c for c, _ in by_stance.values()),
        charges_built=sum(b for _, b in by_stance.values()),
        commands=sent,
        rejected=rejected,
        apm_avg=round(sent * minute_ticks / log.ticks, 3) if log.ticks else None,
        apm_by_minute=tuple(by_minute),
        apm_peak=max(by_minute),
        front_ticks=tuple(ticks["SetFront"]),
        rear_min_ticks=tuple(ticks["SetRearMin"]),
        transfer_ticks=tuple(ticks["Transfer"]),
        transfer_charges=charges,
        orders=orders,
        planned_orders=planned,
        planned_share=round(planned / orders, 4) if orders else None,
        planned_attack_share=round(planned_attacks / len(attacks), 4) if attacks else None,
        planned_siege_share=round(planned_sieges / len(sieges), 4) if sieges else None,
        cp_by_category=tuple(spent.items()),
        cp_refunded=refunded,
        cp_total=sum(spent.values()),
    )
