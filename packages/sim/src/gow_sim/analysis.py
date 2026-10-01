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
- **Siege attempt** (``sieges``): one assault on a node the enemy owns: a ``fight`` in the node
  with this player as attacker, or the walk-in into an enemy node without defenders (the capture
  without a fight, DEC-07 row 5). **Siege success** (``sieges_won``): a capture of an enemy node
  (a neutral node is no siege); every capture counts once.
- **Captures** (``captures``): every ``node_captured`` of the player, neutral nodes included;
  ``captures_by_minute[p][m]`` is the number in minute ``m`` of the match (ticks
  ``m * 60 * tick_hz < t <= (m + 1) * 60 * tick_hz``). The list has ``ceil(ticks / minute)``
  entries (at least one).
- ``winner`` / ``reason`` come from the ``match_ended`` event; a match stopped by the caller
  before it ended has ``winner = None`` and ``reason = "unfinished"``. ``vp`` and ``cities`` are
  the final values.

Pure: no I/O, no clock (AGENTS.md, section 4.1).
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from gow_sim.commands import Move, Ok, PlayerCommand
from gow_sim.maps import PLAYERS
from gow_sim.match import Match
from gow_sim.state import Event

__all__ = [
    "UNFINISHED",
    "MatchLog",
    "MatchMetrics",
    "MatchRecorder",
    "MoveRecord",
    "analyze",
]

UNFINISHED: Final = "unfinished"
"""``MatchMetrics.reason`` of a match that did not end (no ``match_ended`` event)."""


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
class MatchLog:
    """Everything ``analyze`` needs of a match."""

    tick_hz: int
    ticks: int
    """The last tick played."""
    events: tuple[Event, ...]
    """All events of the match in tick order."""
    moves: tuple[MoveRecord, ...]
    """Accepted ``Move`` commands in application order."""
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
            if not isinstance(r.outcome, Ok):
                self._rejected[r.player] += 1
                continue
            self._accepted[r.player] += 1
            cmd = by_key[(r.player, r.seq)]
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
    fought: set[int] = set()  # nodes assaulted in the tick being read
    fight_tick = -1
    for e in log.events:
        if e.tick != fight_tick:
            fought.clear()
            fight_tick = e.tick
        match e.kind:
            case "fight":
                node, attacker = e.get("node"), e.get("attacker")
                if isinstance(node, int) and isinstance(attacker, int):  # not an edge meeting
                    sieges[attacker] += 1
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
