"""Match lifecycle (SRV-09, #56): states, the "one active match" rule, results in the database.

A match goes through these states (``TRANSITIONS`` is the whole table):

``created``    an invite exists, or a bot match is being started; nobody is claimed yet.
``waiting``    a guest joined; both players are claimed and have ``ready_timeout_s`` to be ready.
``running``    the ``matches`` row exists (``status = running``) and the ``MatchRunner`` plays.
``finished``   the runner is over; the players are free again. Next: the result is written.
``saved``      winner, reason and duration are in the database (``status = saved``).
``cleaned``    the record is gone from memory (the runner leaves ``MatchManager`` when it ends).
``aborted``    never started: the invite expired, was replaced, or the guest did not become ready
               in time (no-show); it is cleaned at once. Nothing is written for such a match.

A match whose task crashed or was cancelled by a server stop is saved as ``status = aborted``
without results. At start-up rows still ``running`` (the process died) become ``aborted`` too.

The rule "a player has at most one active match or queue place" is ``claim``: a player is claimed
from the moment two players are paired (``waiting``, or ``created`` of a bot match) until the
match is ``finished``. The queue (MM-01) claims the same way. Records are swept lazily: every
call first aborts the ``created`` and ``waiting`` records past their deadline.

The database is synchronous: the row is inserted and the result written through
``asyncio.to_thread``; the tick never waits for either (AGENTS.md, sections 5.2 and 9). A match
that has a row is started with ``match_id=str(matches.id)``, so replay files carry that id.
"""

import asyncio
import logging
import shutil
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Final

from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from gow_server.clock import Clock
from gow_server.matches import BOT_ACCOUNT, BotSeat, ManagerDrainingError, MatchManager, MatchRunner
from gow_server.models import Match, MatchPlayer, utcnow
from gow_sim.maps import PLAYERS, MapDef
from gow_sim.ruleset import Ruleset, archive_ruleset, ruleset_hash

log = logging.getLogger("gow_server.lifecycle")


class MatchState(StrEnum):
    CREATED = "created"
    WAITING = "waiting"
    RUNNING = "running"
    FINISHED = "finished"
    SAVED = "saved"
    CLEANED = "cleaned"
    ABORTED = "aborted"


TRANSITIONS: Final[dict[MatchState, frozenset[MatchState]]] = {
    MatchState.CREATED: frozenset({MatchState.WAITING, MatchState.RUNNING, MatchState.ABORTED}),
    MatchState.WAITING: frozenset({MatchState.RUNNING, MatchState.ABORTED}),
    MatchState.RUNNING: frozenset({MatchState.FINISHED}),
    MatchState.FINISHED: frozenset({MatchState.SAVED}),
    MatchState.SAVED: frozenset({MatchState.CLEANED}),
    MatchState.ABORTED: frozenset({MatchState.CLEANED}),
    MatchState.CLEANED: frozenset(),
}

DEFAULT_READY_TIMEOUT_S: Final = 120.0

STATUS_RUNNING: Final = "running"
STATUS_SAVED: Final = "saved"
STATUS_ABORTED: Final = "aborted"


class IllegalTransitionError(RuntimeError):
    """A state change that ``TRANSITIONS`` does not allow."""


class AlreadyActiveError(Exception):
    """An account already has an active match (or queue place)."""

    def __init__(self, account_id: int) -> None:
        super().__init__(f"account {account_id} already has an active match")
        self.account_id = account_id


@dataclass(slots=True, eq=False)
class MatchRecord:
    """The in-memory lifecycle of one match."""

    state: MatchState = MatchState.CREATED
    deadline: float | None = None
    """Clock time after which a ``created`` or ``waiting`` record is aborted; ``None``: never."""
    accounts: tuple[int, ...] = ()
    """The claimed accounts."""
    match_id: str | None = None
    abort_reason: str | None = None
    history: list[MatchState] = field(default_factory=list[MatchState])

    def __post_init__(self) -> None:
        self.history.append(self.state)

    def advance(self, new: MatchState) -> None:
        if new not in TRANSITIONS[self.state]:
            raise IllegalTransitionError(f"{self.state.value} -> {new.value}")
        self.state = new
        self.history.append(new)

    @property
    def dead(self) -> bool:
        """Never started and gone."""
        return self.state in (MatchState.ABORTED, MatchState.CLEANED) and self.match_id is None


@dataclass(frozen=True, slots=True)
class _Result:
    status: str
    end_reason: str
    ticks: int
    winner: int | None
    """Side that won; ``None``: a draw, or no result (``status = aborted``)."""
    has_result: bool


class MatchLifecycle:
    """States, claims and database rows of the matches of this process."""

    def __init__(
        self,
        manager: MatchManager,
        sessions: sessionmaker[Session],
        clock: Clock,
        *,
        ready_timeout_s: float = DEFAULT_READY_TIMEOUT_S,
    ) -> None:
        self.manager = manager
        self.clock = clock
        self.ready_timeout_s = ready_timeout_s
        self._sessions = sessions
        self._claims: dict[int, MatchRecord] = {}
        self._pending: set[MatchRecord] = set()
        self._records: dict[str, MatchRecord] = {}
        self._tasks: set[asyncio.Task[None]] = set()
        manager.on_end = self.on_end

    def __len__(self) -> int:
        """Records in memory that are not cleaned: a finished match leaves after it is saved."""
        return len(self._pending) + len(self._records)

    # Claims --------------------------------------------------------------------------------

    def active_of(self, account_id: int) -> MatchRecord | None:
        """The active match of an account (paired, not finished), if any."""
        self.sweep()
        return self._claims.get(account_id)

    def claim(self, record: MatchRecord, accounts: tuple[int, ...]) -> None:
        """Claim ``accounts`` for ``record`` or raise ``AlreadyActiveError`` and claim nothing."""
        self.sweep()
        for account in accounts:
            holder = self._claims.get(account)
            if holder is not None and holder is not record:
                raise AlreadyActiveError(account)
        for account in accounts:
            self._claims[account] = record
        record.accounts = tuple(dict.fromkeys((*record.accounts, *accounts)))

    def _release(self, record: MatchRecord) -> None:
        for account in record.accounts:
            if self._claims.get(account) is record:
                del self._claims[account]

    # States --------------------------------------------------------------------------------

    def open_record(self, deadline: float | None = None) -> MatchRecord:
        """A new ``created`` record, aborted at ``deadline`` (clock time) if it did not start."""
        record = MatchRecord(deadline=deadline)
        self._pending.add(record)
        return record

    def join(self, record: MatchRecord, host: int, guest: int) -> None:
        """A guest joined: claim both players, ``created -> waiting``, the ready timer starts."""
        self.claim(record, (host, guest))
        record.advance(MatchState.WAITING)
        record.deadline = self.clock.now() + self.ready_timeout_s

    def abort(self, record: MatchRecord, reason: str) -> None:
        """A match that did not start: ``-> aborted -> cleaned``. No-op on a started one."""
        if record.state not in (MatchState.CREATED, MatchState.WAITING):
            return
        log.info("match aborted", extra={"reason": reason, "accounts": list(record.accounts)})
        record.abort_reason = reason
        record.advance(MatchState.ABORTED)
        self._release(record)
        self._pending.discard(record)
        record.advance(MatchState.CLEANED)

    def sweep(self) -> None:
        """Abort the pending records past their deadline (no-show of a player, expired invite)."""
        now = self.clock.now()
        for record in [r for r in self._pending if r.deadline is not None and r.deadline <= now]:
            self.abort(record, "no_show" if record.state is MatchState.WAITING else "expired")

    async def start(
        self,
        record: MatchRecord,
        map_id: str,
        mapdef: MapDef,
        rules: Ruleset,
        players: tuple[int, int],
        *,
        private: bool = True,
        rated: bool = False,
        bot: BotSeat | None = None,
        bot_name: str | None = None,
    ) -> MatchRunner:
        """``created`` or ``waiting`` ``-> running``: insert the row, then start the runner.

        Claims the human ``players`` (``AlreadyActiveError``). Raises ``ManagerDrainingError``
        while the server drains; the record then keeps its state, the caller may retry or abort.
        """
        if record.dead:
            raise IllegalTransitionError(f"{record.state.value} -> running")
        humans = tuple(a for a in players if a != BOT_ACCOUNT)
        self.claim(record, humans)
        if self.manager.draining:
            raise ManagerDrainingError("the server is draining for a deploy")
        deadline, record.deadline = record.deadline, None  # not swept while the row is written
        try:
            pk = await asyncio.to_thread(
                self._insert, map_id, ruleset_hash(rules), rated, players, bot_name
            )
        except BaseException:
            record.deadline = deadline
            raise
        match_id = str(pk)
        try:
            runner = self.manager.create(
                map_id, mapdef, rules, players, match_id=match_id, private=private, bot=bot
            )
        except BaseException:
            record.deadline = deadline
            await asyncio.to_thread(self._write_aborted, pk, "server_draining")
            raise
        record.match_id = match_id
        record.advance(MatchState.RUNNING)
        self._pending.discard(record)
        self._records[match_id] = record
        return runner

    def on_end(self, runner: MatchRunner, failure: str | None) -> None:
        """``MatchManager`` hook: ``running -> finished``, free the players, save the result."""
        record = self._records.get(runner.match_id)
        if record is None:  # a match without a lifecycle (tests, tools)
            return
        record.advance(MatchState.FINISHED)
        self._release(record)
        result = _result_of(runner, failure)
        task = asyncio.create_task(self._save(record, result), name=f"save-{runner.match_id}")
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _save(self, record: MatchRecord, result: _Result) -> None:
        match_id = record.match_id
        assert match_id is not None
        try:
            await asyncio.to_thread(self._write_result, int(match_id), result)
        except Exception:
            log.exception("match result not saved", extra={"match_id": match_id})
        else:
            record.advance(MatchState.SAVED)
        finally:
            self._records.pop(match_id, None)
        if record.state is MatchState.SAVED:
            record.advance(MatchState.CLEANED)

    async def aclose(self) -> None:
        """Wait for the results being written (after ``MatchManager.shutdown``)."""
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)

    # Database (blocking: call through ``asyncio.to_thread``) -----------------------------------

    def _insert(
        self, map_id: str, rules_hash: str, rated: bool, players: tuple[int, int], bot: str | None
    ) -> int:
        with self._sessions.begin() as session:
            match = Match(
                map_id=map_id,
                ruleset_hash=rules_hash,
                rated=rated,
                started_at=utcnow(),
                status=STATUS_RUNNING,
            )
            session.add(match)
            session.flush()
            for side, account in zip(PLAYERS, players, strict=True):
                is_bot = account == BOT_ACCOUNT
                session.add(
                    MatchPlayer(
                        match_id=match.id,
                        side=side,
                        player_id=None if is_bot else account,
                        bot=bot if is_bot else None,
                    )
                )
            return match.id

    def _write_result(self, pk: int, result: _Result) -> None:
        with self._sessions.begin() as session:
            match = session.get(Match, pk)
            if match is None:
                log.error("match row is gone", extra={"match_id": pk})
                return
            match.status = result.status
            match.ended_at = utcnow()
            match.end_reason = result.end_reason
            match.ticks = result.ticks
            if not result.has_result:
                return
            for side in PLAYERS:
                outcome = (
                    "draw" if result.winner is None else "win" if side == result.winner else "loss"
                )
                session.execute(
                    update(MatchPlayer)
                    .where(MatchPlayer.match_id == pk, MatchPlayer.side == side)
                    .values(result=outcome)
                )

    def _write_aborted(self, pk: int, reason: str) -> None:
        self._write_result(pk, _Result(STATUS_ABORTED, reason, 0, None, False))


def _result_of(runner: MatchRunner, failure: str | None) -> _Result:
    ticks = runner.match.tick
    if failure is not None:
        reason = "crashed" if failure == "crashed" else "server_stopped"
        return _Result(STATUS_ABORTED, reason, ticks, None, False)
    outcome = runner.match.outcome
    reason = runner.end_reason()
    assert outcome is not None and reason is not None
    return _Result(STATUS_SAVED, reason, ticks, outcome.winner, True)


def abort_orphans(sessions: sessionmaker[Session]) -> int:
    """Rows still ``running`` belong to a process that died: mark them aborted. Blocking."""
    with sessions.begin() as session:
        pks = (
            session.execute(select(Match.id).where(Match.status == STATUS_RUNNING)).scalars().all()
        )
        if pks:
            session.execute(
                update(Match)
                .where(Match.id.in_(pks))
                .values(status=STATUS_ABORTED, ended_at=utcnow(), end_reason="server_restart")
            )
    return len(pks)


def archive_rulesets(ruleset_path: Path, archive_dir: Path, bundled_dir: Path) -> Path:
    """Archive the ruleset the server plays on as ``<archive_dir>/<hash>.toml`` (AGENTS.md, 4.5).

    ``archive_dir`` is where the server writes: on the ``/data`` volume in a container, whose
    image (``bundled_dir``) is read-only. The bundled archive is copied there too, so a replay
    of any archived ruleset resolves in the one directory the replay code reads. Blocking.
    """
    archived = archive_ruleset(ruleset_path, archive_dir)
    if bundled_dir.is_dir() and bundled_dir.resolve() != archive_dir.resolve():
        for file in sorted(bundled_dir.glob("*.toml")):
            target = archive_dir / file.name
            if not target.exists():
                shutil.copyfile(file, target)
    return archived
