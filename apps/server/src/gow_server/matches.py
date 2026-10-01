"""Running matches: ``MatchRunner`` (one asyncio task per match) and ``MatchManager`` (SRV-02).

AGENTS.md, sections 5.1 and 5.2. Every match is one task of the single server process. Its tick
loop reads time only through a ``Clock`` (tests use ``ManualClock``). A tick is synchronous, with
no ``await``: the commands queued since the last tick are applied at its start, ``Match.step``
runs, and every connected player gets its acks, visible events and snapshot (``gow_protocol
.convert``) in its ``Outbox``. The connection (SRV-03) sends them; the tick never waits for it.

A loop more than 3 ticks behind (GC pause, suspended VM) restarts its schedule from the current
time instead of catching up with a burst of steps. A paused match waits for ``resume()`` and
then starts its schedule anew.

Disconnects (DEC-05, #49, SRV-04): a player without a connection has ``reconnect_window_s`` to
come back (the match goes on meanwhile, also before the first connection). When the window runs
out the runner queues a ``Forfeit`` command for that player like any other command, so the
technical defeat is in the command log and the replay stays reproducible; ``match_end`` then says
``disconnect``. Rated matches have no pauses; in a ``private`` one each player may pause once, for
at most ``pause_max_s`` (``request_pause``), and ``paused`` messages tell both players.

A runner given a ``ReplayWriter`` writes the command log of its match tick by tick (SRV-07);
``MatchManager`` hands a finished match to ``ReplayService`` for the frames file. A failing log
(a full disk) stops the recording and never the match.

The ``match_key`` of opaque ids is ``secrets.token_bytes`` and never leaves the process: it is
not logged and not part of ``repr``.
"""

import asyncio
import logging
import math
import secrets
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Final

from gow_protocol import commands as wire
from gow_protocol.convert import (
    ack_msg,
    command_from_wire,
    events_msgs,
    match_end_msg,
    snapshot_msg,
)
from gow_protocol.messages import PausedMsg, ServerMsg, SnapshotMsg
from gow_server.clock import Clock

if TYPE_CHECKING:
    from gow_server.replays import ReplayService
from gow_sim.commands import PlayerCommand
from gow_sim.maps import PLAYERS, MapDef
from gow_sim.match import Match
from gow_sim.replay import ReplayWriter
from gow_sim.ruleset import Ruleset

log = logging.getLogger("gow_server.matches")

MAX_BEHIND_TICKS: Final = 3
"""A loop further behind than this many ticks resets its schedule (AGENTS.md, section 5.2)."""

OUTBOX_LIMIT: Final = 4096
"""Reliable messages one player may have unsent before its connection is dropped."""

MATCH_KEY_BYTES: Final = 32

DEFAULT_WINDOW_S: Final = 60.0
"""DEC-05 default of the reconnect window and of a pause; the server settings override it."""

_EPS: Final = 1e-9
"""Float slack of the schedule: ten steps of 0.1 s are due at exactly 1.0 s."""


class Outbox:
    """Outgoing messages of one player's connection (AGENTS.md, section 5.3).

    Two queues: the snapshot is a "latest only" cell (a slow client skips frames and never slows
    the tick down); everything else (``ack``, ``event``, ``match_end``, ``error``) is a reliable
    FIFO, sent before the snapshot. A FIFO longer than ``limit`` means the client does not read:
    the outbox is marked ``overflowed`` and ``get()`` stops, so the connection is dropped.
    """

    def __init__(self, limit: int = OUTBOX_LIMIT) -> None:
        self._limit = limit
        self._snapshot: SnapshotMsg | None = None
        self._reliable: deque[ServerMsg] = deque()
        self._wakeup = asyncio.Event()
        self._closed = False
        self.overflowed = False

    def put(self, msg: ServerMsg) -> None:
        if self._closed or self.overflowed:
            return
        if len(self._reliable) >= self._limit:
            self.overflowed = True
        else:
            self._reliable.append(msg)
        self._wakeup.set()

    def put_snapshot(self, msg: SnapshotMsg) -> None:
        if self._closed or self.overflowed:
            return
        self._snapshot = msg
        self._wakeup.set()

    def close(self) -> None:
        """No more messages; ``get()`` returns what is queued, then ``None``."""
        self._closed = True
        self._wakeup.set()

    @property
    def closed(self) -> bool:
        return self._closed

    def get_nowait(self) -> ServerMsg | None:
        """The next message to send, or ``None`` if there is none now."""
        if self.overflowed:
            return None
        if self._reliable:
            return self._reliable.popleft()
        snapshot, self._snapshot = self._snapshot, None
        return snapshot

    async def get(self) -> ServerMsg | None:
        """Wait for the next message; ``None``: closed and empty, or overflowed."""
        while True:
            msg = self.get_nowait()
            if msg is not None or self.overflowed:
                return msg
            if self._closed:
                return None
            self._wakeup.clear()
            await self._wakeup.wait()


@dataclass(frozen=True, slots=True)
class _Queued:
    player: int
    seq: int
    cmd: wire.Command


class MatchRunner:
    """One match and its tick loop. ``players[slot]`` is the account id of player ``slot``."""

    def __init__(
        self,
        match_id: str,
        map_id: str,
        mapdef: MapDef,
        rules: Ruleset,
        players: tuple[int, int],
        clock: Clock,
        match_key: bytes | None = None,
        replay: ReplayWriter | None = None,
        *,
        private: bool = False,
        reconnect_window_s: float = DEFAULT_WINDOW_S,
        pause_max_s: float = DEFAULT_WINDOW_S,
    ) -> None:
        self.match_id: Final = match_id
        self.map_id: Final = map_id
        self.players: Final = players
        self.clock = clock
        self.match: Final = Match(mapdef, rules, match_key or secrets.token_bytes(MATCH_KEY_BYTES))
        self.dt: Final = 1.0 / rules.tick_hz
        self.replay = replay
        """Writer of the command log; ``None``: not recorded, finished or the recording failed."""
        self.replay_complete = False
        """The command log of the finished match is whole, with its ``final`` record."""
        self.resets = 0
        """How often the loop fell more than ``MAX_BEHIND_TICKS`` behind and reset its schedule."""
        self.steps = 0
        self.lag_sum = 0.0
        self.lag_max = 0.0
        """Tick lag in seconds: how late each step started after it was due (AGENTS.md, 12)."""
        self._inbox: list[_Queued] = []
        self._last_seq: dict[int, int] = dict.fromkeys(PLAYERS, 0)
        self._outboxes: dict[int, Outbox] = {}
        self._resumed = asyncio.Event()
        self._resumed.set()
        self.private: Final = private
        self.reconnect_window_s: Final = reconnect_window_s
        self.pause_max_s: Final = pause_max_s
        self._stopped = False
        self._forfeit_timers: dict[int, asyncio.Task[None]] = {}
        self._technical_defeats: set[int] = set()
        """Players whose ``Forfeit`` was queued by the server after the reconnect window."""
        self._pauses_used: set[int] = set()
        self._paused_by: int | None = None
        self._pause_ends = 0.0
        self._pause_timer: asyncio.Task[None] | None = None

    def __repr__(self) -> str:
        return f"MatchRunner({self.match_id!r}, map={self.map_id!r}, tick={self.match.tick})"

    @property
    def finished(self) -> bool:
        return self.match.finished

    def slot_of(self, account_id: int) -> int | None:
        """Player id (slot) of an account in this match, ``None`` if it does not play here."""
        return self.players.index(account_id) if account_id in self.players else None

    # Connections ---------------------------------------------------------------------------

    def attach(self, player: int, outbox: Outbox | None = None) -> Outbox:
        """Give ``player`` a new outbox (a new connection); the previous one is closed."""
        old = self._outboxes.get(player)
        if old is not None:
            old.close()
        box = outbox or Outbox()
        self._outboxes[player] = box
        self._cancel_forfeit_timer(player)
        if self.finished:
            box.close()
        elif self.paused:
            box.put(self._paused_msg())
        return box

    def detach(self, player: int, outbox: Outbox) -> None:
        """Stop filling ``outbox`` if it is still the current one of ``player``."""
        if self._outboxes.get(player) is outbox:
            del self._outboxes[player]
            outbox.close()
            self._start_forfeit_timer(player)

    def last_seq(self, player: int) -> int:
        """Highest ``seq`` of ``player`` accepted so far (``welcome.last_seq``)."""
        return self._last_seq[player]

    def snapshot(self, player: int) -> SnapshotMsg:
        """The current full view of ``player`` (after ``welcome``)."""
        return snapshot_msg(self.match.view(player))

    def submit(self, player: int, seq: int, cmd: wire.Command) -> bool:
        """Queue a command for the next tick. ``False``: a repeated ``seq`` or a finished match.

        ``seq`` must grow: a ``seq`` not greater than the last accepted one is a duplicate
        (a resend after a reconnect) and is dropped without an ``ack``.
        """
        if self.finished or seq <= self._last_seq[player]:
            return False
        self._last_seq[player] = seq
        self._inbox.append(_Queued(player, seq, cmd))
        return True

    # Disconnects ---------------------------------------------------------------------------

    def connected(self, player: int) -> bool:
        return player in self._outboxes

    def _start_forfeit_timer(self, player: int) -> None:
        if self.finished or self._stopped or player in self._forfeit_timers:
            return
        self._forfeit_timers[player] = asyncio.create_task(
            self._forfeit_after_window(player), name=f"forfeit-{self.match_id}-{player}"
        )

    def _cancel_forfeit_timer(self, player: int) -> None:
        timer = self._forfeit_timers.pop(player, None)
        if timer is not None:
            timer.cancel()

    async def _forfeit_after_window(self, player: int) -> None:
        await self.clock.sleep(self.reconnect_window_s)
        del self._forfeit_timers[player]  # no await below: a reconnect cannot interleave
        self.technical_defeat(player)

    def technical_defeat(self, player: int) -> None:
        """Queue a ``Forfeit`` for ``player`` (reconnect window over); it ends a pause."""
        if self.finished:
            return
        log.info("technical defeat", extra={"match_id": self.match_id, "player": player})
        self._technical_defeats.add(player)
        self.submit(player, self._last_seq[player] + 1, wire.ForfeitCmd())
        self.resume()  # the Forfeit is applied by the next tick

    # Pause ---------------------------------------------------------------------------------

    @property
    def paused(self) -> bool:
        return not self._resumed.is_set()

    def pause(self) -> None:
        self._resumed.clear()

    def resume(self) -> None:
        """End a pause (also one of a player): the schedule starts anew."""
        if self._paused_by is not None:
            self._end_pause()
        self._resumed.set()

    def request_pause(self, player: int) -> bool:
        """A player's pause (DEC-05). ``False``: rated match, pause already used, or paused now."""
        if not self.private or self.finished or self.paused or player in self._pauses_used:
            return False
        self._pauses_used.add(player)
        self._paused_by = player
        self._pause_ends = self.clock.now() + self.pause_max_s
        self._pause_timer = asyncio.create_task(
            self._pause_expires(), name=f"pause-{self.match_id}"
        )
        self.pause()
        self._broadcast(self._paused_msg())
        return True

    def request_resume(self, player: int) -> bool:
        """End the pause early; only the player who paused may. ``False``: not their pause."""
        if self._paused_by != player:
            return False
        self.resume()
        return True

    async def _pause_expires(self) -> None:
        await self.clock.sleep(self.pause_max_s)
        self._pause_timer = None
        self.resume()

    def _end_pause(self) -> None:
        timer, self._pause_timer = self._pause_timer, None
        if timer is not None:
            timer.cancel()
        self._paused_by = None
        self._resumed.set()
        self._broadcast(self._paused_msg())

    def _paused_msg(self) -> PausedMsg:
        if self._paused_by is None:
            return PausedMsg(paused=False, by=None, ends_in_s=None)
        left = max(self._pause_ends - self.clock.now(), 0.0)
        return PausedMsg(paused=True, by=self._paused_by, ends_in_s=math.ceil(left))

    def _broadcast(self, msg: ServerMsg) -> None:
        for box in self._outboxes.values():
            box.put(msg)

    # Tick loop -----------------------------------------------------------------------------

    async def run(self) -> None:
        """Step the match at ``tick_hz`` until it ends (AGENTS.md, section 5.2)."""
        dt = self.dt
        start, ticks = self.clock.now(), 0  # the k-th tick is due at start + k * dt
        for player in PLAYERS:  # nobody connected yet: the window runs from the start
            if player not in self._outboxes:
                self._start_forfeit_timer(player)
        try:
            while not self.finished:
                if self.paused:
                    await self._resumed.wait()
                    start, ticks = self.clock.now(), 0
                now = self.clock.now()
                if now - (start + ticks * dt) > MAX_BEHIND_TICKS * dt:
                    start, ticks = now, 0
                    self.resets += 1
                while now + _EPS >= start + ticks * dt and not self.finished and not self.paused:
                    lag = max(self.clock.now() - (start + ticks * dt), 0.0)
                    self.steps += 1
                    self.lag_sum += lag
                    self.lag_max = max(self.lag_max, lag)
                    self.step()
                    ticks += 1
                if not self.finished:
                    await self.clock.sleep(start + ticks * dt - self.clock.now() - _EPS)
        finally:
            self._stopped = True
            for timer in (*self._forfeit_timers.values(), self._pause_timer):
                if timer is not None:
                    timer.cancel()
            self._close_replay()
            for box in self._outboxes.values():
                box.close()

    def step(self) -> None:
        """One tick, synchronously: commands, ``Match.step``, messages for every connection."""
        match = self.match
        commands = [
            PlayerCommand(q.player, q.seq, match.resolve(q.player, command_from_wire(q.cmd)))
            for q in self._inbox
        ]
        self._inbox = []
        self._record_start()
        events = match.step(commands)
        self._record(commands)
        outcome = match.outcome
        disconnect = outcome is not None and (
            outcome.winner is not None and 1 - outcome.winner in self._technical_defeats
        )
        for player, box in self._outboxes.items():
            for result in match.results:
                if result.player == player:
                    box.put(ack_msg(result))
            for msg in events_msgs(events, player, match.match_key):
                box.put(msg)
            snapshot = snapshot_msg(match.view(player))
            if outcome is None:
                box.put_snapshot(snapshot)
            else:  # the final view goes before match_end, then the connection is done
                box.put(snapshot)
                vp = [match.state.players[p].vp for p in PLAYERS]
                box.put(match_end_msg(outcome, match.tick, vp, disconnect=disconnect))
                box.close()

    # Replay log ----------------------------------------------------------------------------

    def _record_start(self) -> None:
        if self.replay is not None and self.match.tick == 0:
            self._replay_call(self.replay.begin, self.match)

    def _record(self, commands: list[PlayerCommand]) -> None:
        if self.replay is not None:
            self._replay_call(self.replay.record, self.match, commands)

    def _close_replay(self) -> None:
        """Write the ``final`` record of a finished match; any other end leaves a cut log."""
        replay, self.replay = self.replay, None
        if replay is None:
            return
        try:
            if self.finished:
                replay.close()
                self.replay_complete = True
            else:
                replay.abort()
        except OSError:
            log.exception("replay log not closed", extra={"match_id": self.match_id})

    def _replay_call[**P](self, call: Callable[P, None], *args: P.args, **kwargs: P.kwargs) -> None:
        try:
            call(*args, **kwargs)
        except OSError:
            log.exception("replay log failed, match goes on", extra={"match_id": self.match_id})
            replay, self.replay = self.replay, None
            if replay is not None:
                replay.abort()


class ManagerDrainingError(RuntimeError):
    """The server is being drained for a deploy and starts no new matches."""


class MatchManager:
    """All matches of the process: a registry with strong references to their tasks.

    A match that raises is logged with its id and removed; the other matches go on. ``drain()``
    (before a deploy, ``deploy/deploy.sh``) stops new matches; ``active`` tells when the running
    ones are over.
    """

    def __init__(
        self,
        clock: Clock,
        new_id: Callable[[], str] | None = None,
        replays: "ReplayService | None" = None,
        *,
        reconnect_window_s: float = DEFAULT_WINDOW_S,
        pause_max_s: float = DEFAULT_WINDOW_S,
    ) -> None:
        self.clock = clock
        self._reconnect_window_s = reconnect_window_s
        self._pause_max_s = pause_max_s
        self._replays = replays
        self._new_id = new_id or (lambda: secrets.token_urlsafe(12))
        self._runners: dict[str, MatchRunner] = {}
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self.draining = False

    @property
    def active(self) -> int:
        return len(self._tasks)

    def get(self, match_id: str) -> MatchRunner | None:
        return self._runners.get(match_id)

    def create(
        self,
        map_id: str,
        mapdef: MapDef,
        rules: Ruleset,
        players: tuple[int, int],
        match_id: str | None = None,
        *,
        private: bool = False,
    ) -> MatchRunner:
        """Create a match and start its loop. Raises ``ManagerDrainingError`` while draining.

        ``match_id`` is ``str(matches.id)`` for a match with a database row: the replay files and
        ``GET /api/replays/{id}`` are named by it (``gow_server.replays``). ``private``: lobby,
        invite and bot matches, where each player may pause once (DEC-05); queue matches are rated.
        """
        if self.draining:
            raise ManagerDrainingError("the server is draining for a deploy")
        match_id = match_id or self._new_id()
        replay = self._replays.writer(match_id) if self._replays is not None else None
        runner = MatchRunner(
            match_id,
            map_id,
            mapdef,
            rules,
            players,
            self.clock,
            replay=replay,
            private=private,
            reconnect_window_s=self._reconnect_window_s,
            pause_max_s=self._pause_max_s,
        )
        self.start(runner)
        return runner

    def start(self, runner: MatchRunner) -> asyncio.Task[None]:
        """Run ``runner`` as a task of this manager (``create`` uses it; tests too)."""
        if runner.match_id in self._runners:
            raise ValueError(f"match {runner.match_id} already exists")
        task = asyncio.create_task(runner.run(), name=f"match-{runner.match_id}")
        self._runners[runner.match_id] = runner
        self._tasks[runner.match_id] = task
        task.add_done_callback(lambda t: self._done(runner, t))
        log.info("match started", extra={"match_id": runner.match_id, "map": runner.map_id})
        return task

    def _done(self, runner: MatchRunner, task: asyncio.Task[None]) -> None:
        self._runners.pop(runner.match_id, None)
        self._tasks.pop(runner.match_id, None)
        extra: dict[str, object] = {
            "match_id": runner.match_id,
            "tick": runner.match.tick,
            "lag_mean_ms": round(1000 * runner.lag_sum / max(runner.steps, 1), 2),
            "lag_max_ms": round(1000 * runner.lag_max, 2),
            "resets": runner.resets,
        }
        if task.cancelled():
            log.info("match cancelled", extra=extra)
        elif (exc := task.exception()) is not None:
            log.error("match crashed", exc_info=exc, extra=extra)
        else:
            if self._replays is not None and runner.replay_complete:
                self._replays.schedule(runner.match_id)
            outcome = runner.match.outcome
            assert outcome is not None
            log.info(
                "match finished",
                extra={**extra, "winner": outcome.winner, "reason": outcome.reason.value},
            )

    def drain(self) -> None:
        self.draining = True

    def undrain(self) -> None:
        self.draining = False

    async def shutdown(self) -> None:
        """Cancel every running match (server stop) and wait for the tasks."""
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
