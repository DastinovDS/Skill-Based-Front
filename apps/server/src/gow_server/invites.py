"""Private match by invite link (SRV-05; pauses and reconnection: mechanics.md, section 19).

Flow: the host calls ``POST /api/matches`` and gets an invite ``code`` to put into a link; the
guest calls ``POST /api/matches/{code}/join``; both call ``POST /api/matches/{code}/ready``.
When the second one is ready the match starts (``MatchManager.create``) and ``GET
/api/matches/{code}`` tells both the ``match_id`` for the WebSocket ``/ws/match/{match_id}``.

- The code is ``secrets.token_urlsafe(16)`` (128 bits). It is the only secret of the invite, it
  is never logged (the access log writes the route template, not the path) and it is not the
  ``match_id``: the WebSocket URL does not carry it.
- An invite takes one guest (a third player gets 409) and expires ``invite_ttl_s`` (30 minutes)
  after creation; an invite that has started a match is kept until the same deadline, so the
  player who was ready first can still read the ``match_id``. A host has one open invite: a new
  one replaces the old one.
- Lifecycle (SRV-09, ``gow_server.lifecycle``): an invite is a ``created`` match record; a join
  claims both players (``waiting``, 409 if either has another active match) and starts the ready
  timer ``ready_timeout_s``: when it runs out the invite is gone (a no-show, 404). The row of the
  ``matches`` table is written when the second player is ready, before the match starts.
- Public lobby (LOB-01, #76): ``CreateMatch.public`` puts the invite into ``GET /api/lobby``, the
  list of open public matches; anyone joins from it by the code in the list (``join`` + ``ready``
  as above). A public match is not ``private``: no pauses (DEC-05 allows them only between
  friends; against a stranger a pause is a way to stall) and, like every invite match, no rating.
  A public entry lives only while its host is there: the host's ``GET /api/matches/{code}``
  (the waiting room polls it) is a heartbeat, and an entry whose host was silent for
  ``lobby_stale_s`` is dropped (a closed tab). ``DELETE /api/matches/{code}`` removes an invite
  that has not started (the host leaves the waiting room). Creating an invite is rate limited per
  account (``invite_rate_limit`` per ``invite_rate_window_s``).
- Invites live in memory: matches do not survive a restart either, and no table is needed.
  The endpoints are ``async def`` without awaits between the check and the change, so the
  registry needs no lock; the guest token is checked by the sync ``current_player`` dependency.
"""

import math
import secrets
from dataclasses import dataclass, field
from typing import Annotated, Final, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict

from gow_server.abuse import Limits, enforce, server_full
from gow_server.clock import Clock
from gow_server.identity import CurrentPlayer
from gow_server.lifecycle import AlreadyActiveError, MatchLifecycle, MatchRecord
from gow_server.maps import MapCatalog
from gow_server.matches import ManagerDrainingError, ServerFullError
from gow_server.ratelimit import SlidingWindowLimiter
from gow_sim.ruleset import Ruleset

CODE_BYTES: Final = 16
DEFAULT_LOBBY_STALE_S: Final = 15.0
LOBBY_LIST_MAX: Final = 50


@dataclass(slots=True)
class Invite:
    code: str = field(repr=False)
    host: int
    host_nick: str
    map_id: str
    expires_at: float
    record: MatchRecord
    public: bool = False
    seen_at: float = 0.0
    """Last time the host asked for the invite (heartbeat of a public entry)."""
    guest: int | None = None
    guest_nick: str | None = None
    ready: set[int] = field(default_factory=set[int])
    match_id: str | None = None
    starting: bool = False
    """The row is being written and the match started (the second ``ready`` is in flight)."""

    def is_member(self, account_id: int) -> bool:
        return account_id in (self.host, self.guest)

    @property
    def state(self) -> Literal["open", "joined", "started"]:
        if self.match_id is not None:
            return "started"
        return "open" if self.guest is None else "joined"


class InviteBook:
    """Open invites by code. Not thread-safe: use it from the event loop only."""

    def __init__(
        self,
        clock: Clock,
        ttl_s: float,
        lifecycle: MatchLifecycle,
        lobby_stale_s: float = DEFAULT_LOBBY_STALE_S,
    ) -> None:
        self.clock = clock
        self.ttl_s = ttl_s
        self.lobby_stale_s = lobby_stale_s
        self.lifecycle = lifecycle
        self._by_code: dict[str, Invite] = {}
        self._open_of_host: dict[int, str] = {}

    def __len__(self) -> int:
        self._purge()
        return len(self._by_code)

    def create(self, host: int, host_nick: str, map_id: str, *, public: bool = False) -> Invite:
        self._purge()
        previous = self._open_of_host.pop(host, None)
        old = self._by_code.get(previous) if previous is not None else None
        if previous is not None and old is not None and old.match_id is None:
            self.lifecycle.abort(old.record, "replaced")
            del self._by_code[previous]
        expires_at = self.clock.now() + self.ttl_s
        invite = Invite(
            secrets.token_urlsafe(CODE_BYTES),
            host,
            host_nick,
            map_id,
            expires_at,
            self.lifecycle.open_record(expires_at),
            public=public,
            seen_at=self.clock.now(),
        )
        self._by_code[invite.code] = invite
        self._open_of_host[host] = invite.code
        return invite

    def get(self, code: str) -> Invite | None:
        """The live invite with this code, ``None`` if unknown or expired."""
        self._purge()
        return self._by_code.get(code)

    def lobby(self) -> list[Invite]:
        """Open public invites (nobody joined yet), oldest first, at most ``LOBBY_LIST_MAX``."""
        self._purge()
        entries = [inv for inv in self._by_code.values() if inv.public and inv.state == "open"]
        return entries[:LOBBY_LIST_MAX]  # dicts keep creation order

    def cancel(self, invite: Invite, reason: str) -> None:
        """Drop an invite that has not started (no-op on a started one)."""
        if invite.match_id is not None or invite.starting:
            return
        self.lifecycle.abort(invite.record, reason)
        self._purge()

    def _purge(self) -> None:
        self.lifecycle.sweep()  # aborts the expired invites and the no-shows
        now = self.clock.now()
        for invite in list(self._by_code.values()):
            if (
                invite.public
                and invite.match_id is None
                and not invite.starting
                and invite.seen_at + self.lobby_stale_s <= now
            ):
                self.lifecycle.abort(invite.record, "abandoned")  # the host left the room
        for code in [
            c for c, inv in self._by_code.items() if inv.expires_at <= now or inv.record.dead
        ]:
            invite = self._by_code.pop(code)
            if self._open_of_host.get(invite.host) == code:
                del self._open_of_host[invite.host]


class CreateMatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    map_id: str | None = None
    """A map of the pool; a random one if omitted."""
    public: bool = False
    """List the match in the public lobby (``GET /api/lobby``) instead of sharing a link."""


class InviteOut(BaseModel):
    code: str
    state: Literal["open", "joined", "started"]
    public: bool
    map_id: str
    host_nick: str
    guest_nick: str | None
    you_ready: bool
    opponent_ready: bool
    expires_in_s: float
    match_id: str | None
    """Set once the match has started: connect to ``/ws/match/{match_id}``."""


class LobbyEntry(BaseModel):
    code: str
    """Joins the match (``POST /api/matches/{code}/join``). Public by design, unlike a link's."""
    host_nick: str
    map_id: str
    age_s: float


class LobbyOut(BaseModel):
    matches: list[LobbyEntry]


def _book(request: Request) -> InviteBook:
    book: InviteBook = request.app.state.invites
    return book


Book = Annotated[InviteBook, Depends(_book)]

router = APIRouter(prefix="/api/matches", tags=["private match"])
lobby_router = APIRouter(prefix="/api/lobby", tags=["lobby"])


def _view(invite: Invite, account_id: int, book: InviteBook) -> InviteOut:
    opponent = invite.guest if account_id == invite.host else invite.host
    return InviteOut(
        code=invite.code,
        state=invite.state,
        public=invite.public,
        map_id=invite.map_id,
        host_nick=invite.host_nick,
        guest_nick=invite.guest_nick,
        you_ready=account_id in invite.ready,
        opponent_ready=opponent in invite.ready,
        expires_in_s=max(invite.expires_at - book.clock.now(), 0.0),
        match_id=invite.match_id,
    )


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, detail="invite not found or expired")


def _busy(account_id: int, caller: int) -> HTTPException:
    """409 of the "one active match per player" rule."""
    detail = (
        "you already have an active match"
        if account_id == caller
        else "the host is already in another match"
    )
    return HTTPException(status.HTTP_409_CONFLICT, detail=detail)


def _member_invite(book: InviteBook, code: str, account_id: int) -> Invite:
    """The invite for one of its two players; 404 for everyone else (does not reveal it)."""
    invite = book.get(code)
    if invite is None or not invite.is_member(account_id):
        raise _not_found()
    return invite


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_match(
    body: CreateMatch, request: Request, response: Response, player: CurrentPlayer, book: Book
) -> InviteOut:
    limiter: SlidingWindowLimiter = request.app.state.invite_limiter
    retry_after = limiter.hit(str(player.id))
    if retry_after is not None:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail="too many matches created",
            headers={"Retry-After": str(math.ceil(retry_after))},
        )
    catalog: MapCatalog = request.app.state.maps
    limits: Limits = request.app.state.limits
    enforce(limits.match_create, str(player.id), "too many matches created")
    if book.lifecycle.active_of(player.id) is not None:
        raise _busy(player.id, player.id)
    if body.map_id is None:
        pool = catalog.all()
        if not pool:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="no maps")
        map_id = secrets.choice(pool).id
    elif catalog.get(body.map_id) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="unknown map")
    else:
        map_id = body.map_id
    invite = book.create(player.id, player.nick, map_id, public=body.public)
    response.headers["Cache-Control"] = "no-store"
    return _view(invite, player.id, book)


@router.get("/{code}")
async def get_match(code: str, response: Response, player: CurrentPlayer, book: Book) -> InviteOut:
    response.headers["Cache-Control"] = "no-store"
    invite = _member_invite(book, code, player.id)
    if player.id == invite.host:
        invite.seen_at = book.clock.now()
    return _view(invite, player.id, book)


@router.delete("/{code}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_match(code: str, player: CurrentPlayer, book: Book) -> None:
    """Leave the waiting room before the match starts: the invite is dropped (404 for others).

    Either player may do it; the other one sees the invite gone (404). A started match is not
    touched: leaving a running one is a ``Forfeit`` over the WebSocket.
    """
    book.cancel(_member_invite(book, code, player.id), "cancelled")


@lobby_router.get("")
async def lobby(response: Response, player: CurrentPlayer, book: Book) -> LobbyOut:
    """Open public matches of other players, oldest first (the client polls every 2 s)."""
    response.headers["Cache-Control"] = "no-store"
    return LobbyOut(
        matches=[
            LobbyEntry(
                code=inv.code,
                host_nick=inv.host_nick,
                map_id=inv.map_id,
                age_s=book.clock.now() - (inv.expires_at - book.ttl_s),
            )
            for inv in book.lobby()
            if inv.host != player.id
        ]
    )


@router.post("/{code}/join")
async def join_match(code: str, response: Response, player: CurrentPlayer, book: Book) -> InviteOut:
    response.headers["Cache-Control"] = "no-store"
    invite = book.get(code)
    if invite is None:
        raise _not_found()
    if invite.guest == player.id:  # a repeated join (reload of the page)
        return _view(invite, player.id, book)
    if player.id == invite.host:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="this is your own invite")
    if invite.guest is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="invite is full")
    try:
        book.lifecycle.join(invite.record, invite.host, player.id)
    except AlreadyActiveError as busy:
        raise _busy(busy.account_id, player.id) from None
    invite.guest, invite.guest_nick = player.id, player.nick
    return _view(invite, player.id, book)


@router.post("/{code}/ready")
async def ready_match(
    code: str, request: Request, response: Response, player: CurrentPlayer, book: Book
) -> InviteOut:
    """Mark the caller ready; the second ready player starts the match."""
    response.headers["Cache-Control"] = "no-store"
    invite = _member_invite(book, code, player.id)
    if invite.guest is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="waiting for the second player")
    invite.ready.add(player.id)
    if (
        invite.match_id is None
        and not invite.starting
        and invite.ready == {invite.host, invite.guest}
    ):
        catalog: MapCatalog = request.app.state.maps
        rules: Ruleset = request.app.state.ruleset
        entry = catalog.get(invite.map_id)
        assert entry is not None  # checked at creation, the pool does not change at runtime
        sides = [invite.host, invite.guest]
        if secrets.randbelow(2):  # who plays which side is random
            sides.reverse()
        invite.starting = True  # the only await below is the database; no second start meanwhile
        try:
            runner = await book.lifecycle.start(
                invite.record,
                invite.map_id,
                entry.definition,
                rules,
                (sides[0], sides[1]),
                private=not invite.public,
            )
        except ManagerDrainingError:
            invite.ready.discard(player.id)  # the caller retries
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, detail="server is restarting"
            ) from None
        except ServerFullError:
            invite.ready.discard(player.id)  # the caller retries
            raise server_full() from None
        finally:
            invite.starting = False
        invite.match_id = runner.match_id
    return _view(invite, player.id, book)
