"""Matchmaking queue (MM-01, #77): rated matches between strangers of similar rating.

Flow: ``POST /api/queue`` puts the player into the queue; the client polls ``GET /api/queue``
(every second). A pass pairs players at most once per ``pass_s``; a pair has ``confirm_s`` to
confirm (``POST /api/queue/confirm``). When both confirmed, the match starts on a random map of
the pool and ``GET /api/queue`` tells both the ``match_id`` for ``/ws/match/{match_id}``.
``DELETE /api/queue`` leaves the queue (or declines a found pair).

Rules (mechanics.md, section 19, "Matchmaking queue"):

- The window of a player is ``window_base + window_per_s * waited`` rating points, at most
  ``window_max``. Two players are paired only if each one's window holds the other's rating.
  The rating is Glicko ``r`` (the skill estimate), not the shown ``r - 2 RD``.
- A pass goes through the queue front first; each unpaired player takes the acceptable
  partner of the closest rating (on a tie, the one nearer to the front). Never the same pair
  twice in a row: a player's last proposed opponent is skipped.
- A pair not confirmed in time does not start a match: who did not confirm leaves the queue,
  who confirmed returns to its front (with the waiting time kept). Declining (leaving) does the
  same at once for the other player.
- After ``bot_offer_s`` of waiting the status offers a match against a bot (unrated, SRV-06).
- The match is rated (DEC-06) and not private: no pauses (DEC-05).
- Who plays which side is random (``secrets``), like in an invite: no bias by queue order.

The queue claims its players like a match (SRV-09, ``MatchLifecycle.claim``): a player in the
queue cannot create or join another match, and the other way round (409). A player whose client
did not poll for ``stale_s`` (a closed tab) leaves the queue. The queue lives in memory (one
process, AGENTS.md 5.1); passes run lazily on the requests of the polling clients, like the
sweep of the lifecycle. Not thread-safe: use it from the event loop only.
"""

import asyncio
import logging
import secrets
from dataclasses import dataclass, field
from typing import Annotated, Final, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session, sessionmaker

from gow_server.abuse import Limits, enforce
from gow_server.clock import Clock
from gow_server.identity import CurrentPlayer
from gow_server.ladder import ban_seconds_left
from gow_server.lifecycle import AlreadyActiveError, MatchLifecycle, MatchRecord
from gow_server.maps import MapCatalog
from gow_server.matches import ManagerDrainingError
from gow_server.rating import rating_of
from gow_sim.ruleset import Ruleset

log = logging.getLogger("gow_server.queue")

STARTED_TTL_S: Final = 60.0
"""How long a started pair can still read its ``match_id`` from ``GET /api/queue``."""


@dataclass(slots=True, eq=False)
class Entry:
    """A player waiting in the queue."""

    account: int
    nick: str
    rating: float
    joined_at: float
    """Clock time the player entered the queue; kept when a confirmer returns to the front."""
    seen_at: float
    record: MatchRecord
    """The lifecycle record that claims the player while searching."""


@dataclass(slots=True, eq=False)
class Proposal:
    """A pair found by a pass, waiting for both confirmations."""

    entries: tuple[Entry, Entry]
    deadline: float
    record: MatchRecord
    """Claims both players until the match starts or the proposal is dropped."""
    confirmed: set[int] = field(default_factory=set[int])
    starting: bool = False
    """Both confirmed: the row is being written and the match started."""

    def other(self, account: int) -> Entry:
        a, b = self.entries
        return b if a.account == account else a

    def entry(self, account: int) -> Entry:
        return self.other(self.other(account).account)


@dataclass(frozen=True, slots=True)
class Started:
    match_id: str
    map_id: str
    until: float


class MatchQueue:
    """The queue of this process."""

    def __init__(
        self,
        clock: Clock,
        lifecycle: MatchLifecycle,
        *,
        window_base: float = 100.0,
        window_per_s: float = 5.0,
        window_max: float = 400.0,
        pass_s: float = 1.0,
        confirm_s: float = 15.0,
        bot_offer_s: float = 60.0,
        stale_s: float = 15.0,
    ) -> None:
        self.clock = clock
        self.lifecycle = lifecycle
        self.window_base = window_base
        self.window_per_s = window_per_s
        self.window_max = window_max
        self.pass_s = pass_s
        self.confirm_s = confirm_s
        self.bot_offer_s = bot_offer_s
        self.stale_s = stale_s
        self._order: list[Entry] = []
        """Searching players, front first."""
        self._proposals: dict[int, Proposal] = {}
        self._started: dict[int, Started] = {}
        self._last_opponent: dict[int, int] = {}
        self._last_pass: float | None = None

    def __len__(self) -> int:
        """Players in the queue: searching or confirming a found pair (``gow_queue_size``)."""
        self.update()
        return len(self._order) + len(self._proposals)

    # Rules -----------------------------------------------------------------------------------

    def window(self, entry: Entry, now: float) -> float:
        """Rating distance this player accepts after waiting since ``joined_at``."""
        return min(self.window_base + self.window_per_s * (now - entry.joined_at), self.window_max)

    def accepts(self, a: Entry, b: Entry, now: float) -> bool:
        """Both windows hold the other's rating."""
        diff = abs(a.rating - b.rating)
        return diff <= self.window(a, now) and diff <= self.window(b, now)

    def _repeat(self, a: Entry, b: Entry) -> bool:
        return (
            self._last_opponent.get(a.account) == b.account
            or self._last_opponent.get(b.account) == a.account
        )

    # Players ---------------------------------------------------------------------------------

    def join(self, account: int, nick: str, rating: float) -> None:
        """Enter the queue; a player already in it stays where it is.

        Raises ``AlreadyActiveError`` if the player has a match (or is in a starting pair).
        """
        self.update()
        if self._searching(account) is not None or account in self._proposals:
            return
        if self.lifecycle.active_of(account) is not None:
            raise AlreadyActiveError(account)
        self._started.pop(account, None)
        now = self.clock.now()
        self._order.append(self._entry(account, nick, rating, now))
        self.update()

    def leave(self, account: int) -> None:
        """Leave the queue, or decline a found pair (the other player returns to the front)."""
        self.update()
        entry = self._searching(account)
        if entry is not None:
            self._drop(entry, "queue_left")
            return
        proposal = self._proposals.get(account)
        if proposal is not None and not proposal.starting:
            self._dissolve(proposal, keep=(proposal.other(account).account,), reason="declined")

    def confirm(self, account: int) -> Proposal | None:
        """Confirm the found pair; returns it when both confirmed: the caller starts the match.

        Raises ``LookupError`` when the player has no found pair.
        """
        self.update()
        proposal = self._proposals.get(account)
        if proposal is None:
            raise LookupError(account)
        proposal.entry(account).seen_at = self.clock.now()
        proposal.confirmed.add(account)
        if proposal.starting or len(proposal.confirmed) < len(proposal.entries):
            return None
        proposal.starting = True
        return proposal

    def started(self, proposal: Proposal, match_id: str, map_id: str) -> None:
        """The match of a confirmed pair runs: both players read its id from their status."""
        until = self.clock.now() + STARTED_TTL_S
        for entry in proposal.entries:
            self._proposals.pop(entry.account, None)
            self._started[entry.account] = Started(match_id, map_id, until)

    def cancel(self, proposal: Proposal, reason: str) -> None:
        """The match of a confirmed pair could not start (a deploy): both leave the queue."""
        proposal.starting = False
        self._dissolve(proposal, keep=(), reason=reason)

    # Passes ----------------------------------------------------------------------------------

    def update(self) -> None:
        """Expire proposals and silent players; run a pass if ``pass_s`` went by since the last."""
        now = self.clock.now()
        for proposal in list(dict.fromkeys(self._proposals.values())):
            if not proposal.starting and proposal.deadline <= now:
                self._dissolve(proposal, keep=tuple(proposal.confirmed), reason="not_confirmed")
        for entry in [e for e in self._order if e.seen_at + self.stale_s <= now]:
            self._drop(entry, "queue_abandoned")
        for account in [a for a, s in self._started.items() if s.until <= now]:
            del self._started[account]
        if self._last_pass is None or now - self._last_pass >= self.pass_s:
            self._last_pass = now
            self.run_pass(now)

    def run_pass(self, now: float) -> list[Proposal]:
        """Pair the searching players (module docstring); returns the new proposals."""
        made: list[Proposal] = []
        paired: set[int] = set()
        for a in list(self._order):
            if a.account in paired:
                continue
            best: Entry | None = None
            for b in self._order:
                if b is a or b.account in paired or self._repeat(a, b):
                    continue
                if not self.accepts(a, b, now):
                    continue
                if best is None or abs(a.rating - b.rating) < abs(a.rating - best.rating):
                    best = b
            if best is not None:
                paired.update((a.account, best.account))
                made.append(self._propose(a, best, now))
        return made

    # Status ----------------------------------------------------------------------------------

    def status(self, account: int) -> "QueueStatus | None":
        """What the player's client shows; ``None`` if the player is not in the queue."""
        self.update()
        now = self.clock.now()
        size = len(self._order) + len(self._proposals)
        entry = self._searching(account)
        if entry is not None:
            entry.seen_at = now
            waited = now - entry.joined_at
            return QueueStatus(
                state="searching",
                waited_s=waited,
                queue_size=size,
                bot_offer=waited >= self.bot_offer_s,
            )
        proposal = self._proposals.get(account)
        if proposal is not None:
            mine, other = proposal.entry(account), proposal.other(account)
            mine.seen_at = now
            return QueueStatus(
                state="found",
                waited_s=now - mine.joined_at,
                queue_size=size,
                opponent_nick=other.nick,
                confirm_in_s=max(proposal.deadline - now, 0.0),
                you_confirmed=account in proposal.confirmed,
                opponent_confirmed=other.account in proposal.confirmed,
            )
        started = self._started.get(account)
        if started is not None:
            return QueueStatus(
                state="started",
                waited_s=0.0,
                queue_size=size,
                match_id=started.match_id,
                map_id=started.map_id,
            )
        return None

    # Internals -------------------------------------------------------------------------------

    def _entry(self, account: int, nick: str, rating: float, joined_at: float) -> Entry:
        record = self.lifecycle.open_record()
        self.lifecycle.claim(record, (account,))
        return Entry(account, nick, rating, joined_at, self.clock.now(), record)

    def _searching(self, account: int) -> Entry | None:
        return next((e for e in self._order if e.account == account), None)

    def _drop(self, entry: Entry, reason: str) -> None:
        self._order.remove(entry)
        self.lifecycle.abort(entry.record, reason)

    def _propose(self, a: Entry, b: Entry, now: float) -> Proposal:
        for entry in (a, b):
            self._order.remove(entry)
            self.lifecycle.abort(entry.record, "paired")
        record = self.lifecycle.open_record()
        self.lifecycle.claim(record, (a.account, b.account))
        proposal = Proposal((a, b), now + self.confirm_s, record)
        for entry, other in ((a, b), (b, a)):
            self._proposals[entry.account] = proposal
            self._last_opponent[entry.account] = other.account
        log.info("queue pair found", extra={"accounts": [a.account, b.account]})
        return proposal

    def _dissolve(self, proposal: Proposal, *, keep: tuple[int, ...], reason: str) -> None:
        """Drop a proposal; the players in ``keep`` return to the front of the queue."""
        self.lifecycle.abort(proposal.record, reason)
        front: list[Entry] = []
        for entry in proposal.entries:
            self._proposals.pop(entry.account, None)
            if entry.account in keep:
                front.append(self._entry(entry.account, entry.nick, entry.rating, entry.joined_at))
        self._order[:0] = front


class QueueStatus(BaseModel):
    state: Literal["searching", "found", "started"]
    waited_s: float
    queue_size: int
    """Players in the queue now (searching or confirming), including you."""
    bot_offer: bool = False
    """Waited long enough to be offered an unrated match against a bot (``/api/bot-matches``)."""
    opponent_nick: str | None = None
    confirm_in_s: float | None = None
    """Seconds left to confirm the found pair (``POST /api/queue/confirm``)."""
    you_confirmed: bool = False
    opponent_confirmed: bool = False
    match_id: str | None = None
    """Set once the match has started: connect to ``/ws/match/{match_id}``."""
    map_id: str | None = None


def _queue(request: Request) -> MatchQueue:
    queue: MatchQueue = request.app.state.queue
    return queue


Queue = Annotated[MatchQueue, Depends(_queue)]

router = APIRouter(prefix="/api/queue", tags=["matchmaking"])


class QueueBan(BaseModel):
    """The refusal of ``POST /api/queue`` while banned (DEC-34, #414)."""

    code: Literal["queue_banned"]
    message: str
    retry_after_s: int
    """Whole seconds until the ban ends; the same value is in the ``Retry-After`` header."""


class QueueBanned(BaseModel):
    """Body of the 429 of a banned player: ``{"detail": {...}}`` like every HTTP error."""

    detail: QueueBan


def _not_in_queue() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, detail="not in the queue")


def _read_rating(sessions: sessionmaker[Session], account: int) -> float:
    with sessions() as session:
        return rating_of(session, account).rating


@router.post("", responses={status.HTTP_429_TOO_MANY_REQUESTS: {"model": QueueBanned}})
async def join_queue(
    request: Request, response: Response, player: CurrentPlayer, queue: Queue
) -> QueueStatus:
    """Enter the queue (or read the status if already in it).

    429 with ``Retry-After`` and a ``QueueBan`` body while the player is banned for repeated
    resigns (DEC-34); 429 with only ``Retry-After`` when the entry rate limit is hit.
    """
    response.headers["Cache-Control"] = "no-store"
    left = ban_seconds_left(player, queue.clock.wall())
    if left > 0:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail=QueueBan(
                code="queue_banned", message="queue ban for repeated resigns", retry_after_s=left
            ).model_dump(),
            headers={"Retry-After": str(left)},
        )
    limits: Limits = request.app.state.limits
    enforce(limits.queue, str(player.id), "too many queue entries")
    if queue.lifecycle.manager.draining:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="server is restarting")
    if queue.lifecycle.active_of(player.id) is not None and queue.status(player.id) is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="you already have an active match")
    rating = await asyncio.to_thread(_read_rating, request.app.state.sessions, player.id)
    try:
        queue.join(player.id, player.nick, rating)
    except AlreadyActiveError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="you already have an active match"
        ) from None
    found = queue.status(player.id)
    assert found is not None
    return found


@router.get("")
async def queue_status(response: Response, player: CurrentPlayer, queue: Queue) -> QueueStatus:
    """The status; the client polls it every second (it is also the heartbeat)."""
    response.headers["Cache-Control"] = "no-store"
    found = queue.status(player.id)
    if found is None:
        raise _not_in_queue()
    return found


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def leave_queue(player: CurrentPlayer, queue: Queue) -> None:
    """Leave the queue or decline the found pair; a started match is not touched."""
    queue.leave(player.id)


@router.post("/confirm")
async def confirm_match(
    request: Request, response: Response, player: CurrentPlayer, queue: Queue
) -> QueueStatus:
    """Confirm the found pair; the second confirmation starts the rated match."""
    response.headers["Cache-Control"] = "no-store"
    try:
        proposal = queue.confirm(player.id)
    except LookupError:
        raise _not_in_queue() from None
    if proposal is not None:
        catalog: MapCatalog = request.app.state.maps
        rules: Ruleset = request.app.state.ruleset
        pool = catalog.all()
        if not pool:
            queue.cancel(proposal, "no_maps")
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="no maps")
        entry = secrets.choice(pool)
        sides = [e.account for e in proposal.entries]
        if secrets.randbelow(2):
            sides.reverse()
        try:
            runner = await queue.lifecycle.start(
                proposal.record,
                entry.id,
                entry.definition,
                rules,
                (sides[0], sides[1]),
                private=False,
                rated=True,
            )
        except ManagerDrainingError:
            queue.cancel(proposal, "server_draining")
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, detail="server is restarting"
            ) from None
        except BaseException:
            queue.cancel(proposal, "start_failed")
            raise
        queue.started(proposal, runner.match_id, entry.id)
    found = queue.status(player.id)
    if found is None:
        raise _not_in_queue()
    return found
