"""Private match by invite link (SRV-05, mechanics.md section "Приватный матч").

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
- Invites live in memory: matches do not survive a restart either, and no table is needed.
  The endpoints are ``async def`` without awaits between the check and the change, so the
  registry needs no lock; the guest token is checked by the sync ``current_player`` dependency.
"""

import secrets
from dataclasses import dataclass, field
from typing import Annotated, Final, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict

from gow_server.clock import Clock
from gow_server.identity import CurrentPlayer
from gow_server.maps import MapCatalog
from gow_server.matches import ManagerDrainingError, MatchManager
from gow_sim.ruleset import Ruleset

CODE_BYTES: Final = 16


@dataclass(slots=True)
class Invite:
    code: str = field(repr=False)
    host: int
    host_nick: str
    map_id: str
    expires_at: float
    guest: int | None = None
    guest_nick: str | None = None
    ready: set[int] = field(default_factory=set[int])
    match_id: str | None = None

    def is_member(self, account_id: int) -> bool:
        return account_id in (self.host, self.guest)

    @property
    def state(self) -> Literal["open", "joined", "started"]:
        if self.match_id is not None:
            return "started"
        return "open" if self.guest is None else "joined"


class InviteBook:
    """Open invites by code. Not thread-safe: use it from the event loop only."""

    def __init__(self, clock: Clock, ttl_s: float) -> None:
        self.clock = clock
        self.ttl_s = ttl_s
        self._by_code: dict[str, Invite] = {}
        self._open_of_host: dict[int, str] = {}

    def __len__(self) -> int:
        self._purge()
        return len(self._by_code)

    def create(self, host: int, host_nick: str, map_id: str) -> Invite:
        self._purge()
        previous = self._open_of_host.pop(host, None)
        old = self._by_code.get(previous) if previous is not None else None
        if previous is not None and old is not None and old.match_id is None:
            del self._by_code[previous]
        invite = Invite(
            secrets.token_urlsafe(CODE_BYTES),
            host,
            host_nick,
            map_id,
            self.clock.now() + self.ttl_s,
        )
        self._by_code[invite.code] = invite
        self._open_of_host[host] = invite.code
        return invite

    def get(self, code: str) -> Invite | None:
        """The live invite with this code, ``None`` if unknown or expired."""
        self._purge()
        return self._by_code.get(code)

    def _purge(self) -> None:
        now = self.clock.now()
        for code in [c for c, inv in self._by_code.items() if inv.expires_at <= now]:
            invite = self._by_code.pop(code)
            if self._open_of_host.get(invite.host) == code:
                del self._open_of_host[invite.host]


class CreateMatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    map_id: str | None = None
    """A map of the pool; a random one if omitted."""


class InviteOut(BaseModel):
    code: str
    state: Literal["open", "joined", "started"]
    map_id: str
    host_nick: str
    guest_nick: str | None
    you_ready: bool
    opponent_ready: bool
    expires_in_s: float
    match_id: str | None
    """Set once the match has started: connect to ``/ws/match/{match_id}``."""


def _book(request: Request) -> InviteBook:
    book: InviteBook = request.app.state.invites
    return book


Book = Annotated[InviteBook, Depends(_book)]

router = APIRouter(prefix="/api/matches", tags=["private match"])


def _view(invite: Invite, account_id: int, book: InviteBook) -> InviteOut:
    opponent = invite.guest if account_id == invite.host else invite.host
    return InviteOut(
        code=invite.code,
        state=invite.state,
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
    catalog: MapCatalog = request.app.state.maps
    if body.map_id is None:
        pool = catalog.all()
        if not pool:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="no maps")
        map_id = secrets.choice(pool).id
    elif catalog.get(body.map_id) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="unknown map")
    else:
        map_id = body.map_id
    invite = book.create(player.id, player.nick, map_id)
    response.headers["Cache-Control"] = "no-store"
    return _view(invite, player.id, book)


@router.get("/{code}")
async def get_match(code: str, response: Response, player: CurrentPlayer, book: Book) -> InviteOut:
    response.headers["Cache-Control"] = "no-store"
    return _view(_member_invite(book, code, player.id), player.id, book)


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
    if invite.match_id is None and invite.ready == {invite.host, invite.guest}:
        manager: MatchManager = request.app.state.matches
        catalog: MapCatalog = request.app.state.maps
        rules: Ruleset = request.app.state.ruleset
        entry = catalog.get(invite.map_id)
        assert entry is not None  # checked at creation, the pool does not change at runtime
        sides = [invite.host, invite.guest]
        if secrets.randbelow(2):  # who plays which side is random
            sides.reverse()
        try:
            runner = manager.create(invite.map_id, entry.definition, rules, (sides[0], sides[1]))
        except ManagerDrainingError:
            invite.ready.discard(player.id)  # the caller retries
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, detail="server is restarting"
            ) from None
        invite.match_id = runner.match_id
    return _view(invite, player.id, book)
