"""Match analysis (BOT-04): metrics of one match from its event log.

The same code measures a bot tournament (``gow_bots.tournament``) and a real match (a replay of
PT-01 or REL-01, ``analyze_replay`` in ``gow_sim.replay``). Two steps:

1. ``MatchRecorder`` is a ``MatchObserver``: it watches ``run_headless`` or a replay and collects
   the events of every tick plus the accepted ``Move`` commands into a ``MatchLog``. The events
   alone do not say whether an order was planned or an attack (a ``Move`` leaves no event, and
   adding one would change the state hash), so the recorder classifies the orders when they are
   applied: *attack* means the destination did not belong to the player at that moment.
2. ``analyze(log)`` is a pure function of the log and returns ``MatchMetrics``.

Definitions (all counts per player id, sides ``0`` and ``1``):

- ``planned_attack_share``: planned attack orders / attack orders (``None`` without attacks).
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
  stance; the three values always sum to ``ticks``.
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
  without orders); ``planned_attack_share`` is as in ``MatchMetrics``.
- **CP spent** (``cp_by_category``, hundredths of CP): the price charged for every accepted
  command (``orders.cost`` of the ruleset), summed per category: ``move`` (``Move``),
  ``planned_move`` (``Move`` with ``planned``), ``mode`` (``SetMode``), ``recruit``
  (``Recruit`` minus the CP that ``CancelRecruit`` returned, ``cp`` of ``recruit_cancelled``),
  ``road`` (``UpgradeRoad``), ``barracks``, ``warehouse``, ``transfer`` and ``other`` (``Split``,
  ``Merge``, ``CancelOrder``, ``SetStance``, ``SetFront``, ``SetRearMin``: free in the MVP
  rulesets). ``cp_total`` is the sum, ``cp_refunded`` the returned part (already subtracted).
  Rejected commands cost nothing; the real CP balance (regeneration, burning at the cap) is not
  reconstructed.

Pure: no I/O, no clock (AGENTS.md, section 4.1).
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from gow_sim.commands import Forfeit, Move, Ok, PlayerCommand
from gow_sim.maps import PLAYERS
from gow_sim.match import Match
from gow_sim.ruleset import Stance
from gow_sim.state import Event

__all__ = [
    "CP_CATEGORIES",
    "UNFINISHED",
    "CommandRecord",
    "MatchLog",
    "MatchMetrics",
    "MatchRecorder",
    "MatchStats",
    "MoveRecord",
    "PlayerStats",
    "analyze",
    "analyze_stats",
]

UNFINISHED: Final = "unfinished"
"""``MatchMetrics.reason`` of a match that did not end (no ``match_ended`` event)."""


CP_CATEGORIES: Final[tuple[str, ...]] = (
    "move",
    "planned_move",
    "mode",
    "recruit",
    "road",
    "barracks",
    "warehouse",
    "transfer",
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
}
"""``CommandRecord.kind`` to category; ``Move`` goes by ``planned``, the rest is ``other``."""


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

    def begin(self, match: Match) -> None:
        if self._match is not None:
            raise RuntimeError("the recorder has already begun")
        self._match = match
        self._owners = {nid: n.owner for nid, n in sorted(match.state.nodes.items())}
        self._initial = tuple(self._owners.values())

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
            if isinstance(cmd, Move):  # owners are still those from before this tick's events
                attack = self._owners[cmd.dest] != r.player
                self._moves.append(MoveRecord(r.tick, r.player, cmd.planned, attack))
        for e in match.state.events:
            if e.kind == "node_captured":
                node, player = e.get("node"), e.get("player")
                assert isinstance(node, int) and isinstance(player, int)
                self._owners[node] = player
        self._events.extend(match.state.events)

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
        )


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
    sieges: tuple[int, ...]
    sieges_won: tuple[int, ...]
    captures: tuple[int, ...]
    captures_by_minute: tuple[tuple[int, ...], ...]
    accepted: tuple[int, ...]
    rejected: tuple[int, ...]

    def to_json(self) -> dict[str, object]:
        """Plain JSON data; per-player values are lists indexed by player id."""
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
            "sieges": list(self.sieges),
            "sieges_won": list(self.sieges_won),
            "captures": list(self.captures),
            "captures_by_minute": [list(m) for m in self.captures_by_minute],
            "accepted": list(self.accepted),
            "rejected": list(self.rejected),
        }


def analyze(log: MatchLog) -> MatchMetrics:
    """The metrics of a match from its log (module docstring)."""
    minute_ticks = 60 * log.tick_hz
    minutes = max(1, -(-log.ticks // minute_ticks))
    owners = dict(enumerate(log.initial_owners))
    sieges = _zeros()
    won = _zeros()
    by_minute: dict[int, list[int]] = {p: [0] * minutes for p in PLAYERS}
    winner: int | None = None
    reason = UNFINISHED
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
                if owners[node] == 1 - player:  # an enemy node, not a neutral one
                    won[player] += 1
                    if node not in fought:  # walked into an empty node: a siege of one step
                        sieges[player] += 1
                owners[node] = player
                by_minute[player][min((e.tick - 1) // minute_ticks, minutes - 1)] += 1
            case "match_ended":
                w, why = e.get("winner"), e.get("reason")
                assert (w is None or isinstance(w, int)) and isinstance(why, str)
                winner, reason = w, why
            case _:
                pass
    orders = _zeros()
    attacks = _zeros()
    planned = _zeros()
    for m in log.moves:
        orders[m.player] += 1
        if m.attack:
            attacks[m.player] += 1
            planned[m.player] += m.planned
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
        sieges=tuple(sieges[p] for p in PLAYERS),
        sieges_won=tuple(won[p] for p in PLAYERS),
        captures=tuple(sum(by_minute[p]) for p in PLAYERS),
        captures_by_minute=tuple(tuple(by_minute[p]) for p in PLAYERS),
        accepted=log.accepted,
        rejected=log.rejected,
    )


# Player statistics (#375) ---------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class PlayerStats:
    """What one player did (module docstring); ``to_json`` is the JSONL form."""

    stance_timeline: tuple[tuple[int, str], ...]
    """``(tick, stance)``, the first entry is ``(0, start stance)``."""
    stance_ticks: tuple[tuple[str, int], ...]
    """Ticks under each stance, in ``Stance`` order; the values sum to ``MatchLog.ticks``."""
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
    cp_by_category: tuple[tuple[str, int], ...]
    """CP in hundredths per ``CP_CATEGORIES``, recruit net of refunds."""
    cp_refunded: int
    cp_total: int

    def to_json(self) -> dict[str, object]:
        return {
            "stance_timeline": [[t, s] for t, s in self.stance_timeline],
            "stance_ticks": dict(self.stance_ticks),
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
            "cp_by_category": dict(self.cp_by_category),
            "cp_refunded": self.cp_refunded,
            "cp_total": self.cp_total,
        }


@dataclass(frozen=True, slots=True)
class MatchStats:
    """``PlayerStats`` of both sides, indexed by player id."""

    players: tuple[PlayerStats, ...]

    def to_json(self) -> dict[str, object]:
        return {"players": [p.to_json() for p in self.players]}


def analyze_stats(log: MatchLog) -> MatchStats:
    """The statistics of both players from the log (module docstring)."""
    return MatchStats(tuple(_player_stats(log, p) for p in PLAYERS))


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
    return PlayerStats(
        stance_timeline=timeline,
        stance_ticks=tuple(in_stance.items()),
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
        cp_by_category=tuple(spent.items()),
        cp_refunded=refunded,
        cp_total=sum(spent.values()),
    )
