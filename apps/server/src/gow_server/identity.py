"""Guest identity, nicknames (ID-01) and passwords (#374).

- ``POST /api/guest {nick}`` creates a guest and returns ``{player_id, token}`` once.
- The token is ``secrets.token_urlsafe(32)``; the database keeps only its SHA-256.
- HTTP requests authenticate with ``Authorization: Bearer <token>``; the token is never read
  from the URL and never logged (AGENTS.md, sections 5.3 and 5.4).
- An account is a guest with a password: ``POST /api/account/password`` sets or changes it,
  ``POST /api/login {nick, password}`` gives a new token of the same player on another device.
  Both replace the token (one ``token_hash`` per player): the previous device is logged out.
  A wrong nick and a wrong password get the same 401 after the same scrypt work.

The endpoints are ``def``: they use the synchronous database (AGENTS.md, section 9).
"""

import hashlib
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from gow_protocol.messages import Calibration
from gow_server.abuse import Limits, enforce
from gow_server.db import DbSession
from gow_server.lifecycle import MatchLifecycle, MatchState
from gow_server.models import Player
from gow_server.nicks import NickPolicy, skeleton, validate_nick
from gow_server.passwords import HasherBusy, PasswordHasher, normalize
from gow_server.ratelimit import SlidingWindowLimiter, ip_key
from gow_server.rating import played_of
from gow_server.settings import Settings


def nick_key(nick: str) -> str:
    """Key of nick uniqueness: case, accents and look-alike letters do not make a new nick."""
    return skeleton(nick)


def hash_token(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


class GuestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    nick: str

    @field_validator("nick")
    @classmethod
    def _check_nick(cls, value: str) -> str:
        return validate_nick(value)


class GuestCreated(BaseModel):
    player_id: int
    token: str
    """Shown once; the client keeps it (the server stores only its hash)."""


class Me(BaseModel):
    player_id: int
    nick: str
    has_password: bool
    """``False`` for a guest; ``True`` once a password is set (``POST /api/account/password``)."""
    calibration: Calibration | None = None
    """Calibration progress of a password account (DEC-34, #414): its rating is hidden until
    ``played`` reaches ``total``. ``None`` for a guest and once calibration is over."""


LONGEST_INPUT = 1024
"""Upper bound of a nick or password that is only compared (login, old password): longer input
is a 422, not a long scrypt run."""


class PasswordSet(BaseModel):
    """A new password; ``old_password`` is required when the account already has one."""

    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    password: str
    old_password: str | None = Field(default=None, max_length=LONGEST_INPUT)

    @field_validator("password")
    @classmethod
    def _check_password(cls, value: str) -> str:
        return normalize(value)


class Login(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    nick: str = Field(max_length=LONGEST_INPUT)
    password: str = Field(max_length=LONGEST_INPUT)


class ActiveMatch(BaseModel):
    """The running match of an account: enough to reconnect to ``/ws/match/{match_id}``."""

    match_id: str
    map_id: str


class NickChange(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    nick: str

    @field_validator("nick")
    @classmethod
    def _check_nick(cls, value: str) -> str:
        return validate_nick(value)


bearer = HTTPBearer(description="Token from POST /api/guest, /api/login or /api/account/password")


def current_player(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(bearer)], session: DbSession
) -> Player:
    """The authenticated player; 401 for a missing, malformed or unknown token, 403 if blocked."""
    player = session.execute(
        select(Player).where(Player.token_hash == hash_token(credentials.credentials))
    ).scalar_one_or_none()
    if player is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if player.blocked_at is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="account is blocked")
    return player


CurrentPlayer = Annotated[Player, Depends(current_player)]

router = APIRouter(prefix="/api", tags=["identity"])


def _guest_limiter(request: Request) -> SlidingWindowLimiter:
    limiter: SlidingWindowLimiter = request.app.state.guest_limiter
    return limiter


def _nick_policy(request: Request) -> NickPolicy:
    policy: NickPolicy = request.app.state.nick_policy
    return policy


Policy = Annotated[NickPolicy, Depends(_nick_policy)]


@router.post("/guest", status_code=status.HTTP_201_CREATED)
def create_guest(
    body: GuestCreate,
    request: Request,
    response: Response,
    session: DbSession,
    limiter: Annotated[SlidingWindowLimiter, Depends(_guest_limiter)],
    policy: Policy,
) -> GuestCreated:
    enforce(limiter, _client_ip(request), "too many guests from this address")
    _check_policy(policy, body.nick)
    key = nick_key(body.nick)
    if session.execute(select(Player.id).where(Player.nick_key == key)).first() is not None:
        raise _nick_taken()
    token = secrets.token_urlsafe(32)
    player = Player(nick=body.nick, nick_key=key, token_hash=hash_token(token))
    session.add(player)
    try:
        session.commit()
    except IntegrityError:  # the same nick was taken concurrently
        session.rollback()
        raise _nick_taken() from None
    response.headers["Cache-Control"] = "no-store"
    return GuestCreated(player_id=player.id, token=token)


@router.get("/me")
def me(request: Request, player: CurrentPlayer, session: DbSession) -> Me:
    return _me(request, player, session)


def _passwords(request: Request) -> PasswordHasher:
    hasher: PasswordHasher = request.app.state.passwords
    return hasher


Passwords = Annotated[PasswordHasher, Depends(_passwords)]


@router.post("/account/password")
def set_password(
    body: PasswordSet,
    request: Request,
    response: Response,
    player: CurrentPlayer,
    session: DbSession,
    passwords: Passwords,
) -> GuestCreated:
    """Set the password of a guest (it becomes an account: nick, rating and history stay) or
    change it (``old_password`` needed, 403 ``wrong password`` otherwise).

    The token is replaced: the response carries the new one, the old one stops working (other
    devices are logged out). Rate limited per player. 422 if the password is not 10..128
    characters after NFKC normalization.
    """
    limits: Limits = request.app.state.limits
    enforce(limits.password, str(player.id), "too many password changes")
    player_id, old_hash = player.id, player.password_hash
    # The scrypt runs hold no database connection (#413): read, release, hash, write.
    session.rollback()
    try:
        if old_hash is not None and (
            body.old_password is None or not passwords.verify(body.old_password, old_hash)
        ):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="wrong password")
        new_hash = passwords.hash(body.password)
    except HasherBusy:
        raise _hasher_busy() from None
    current = session.get(Player, player_id)
    if current is None or current.password_hash != old_hash:  # changed meanwhile (another device)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="password changed")
    current.password_hash = new_hash
    return _issue_token(current, session, response)


@router.post("/login")
def login(
    body: Login, request: Request, response: Response, session: DbSession, passwords: Passwords
) -> GuestCreated:
    """A new token of the account with this nick (any spelling with the same ``nick_key``).

    401 ``wrong nick or password`` for an unknown nick, a guest without a password and a wrong
    password alike, after the same scrypt work; 403 for a blocked account (only with the right
    password). Rate limited per client IP and per nick. The previous token stops working.
    """
    limits: Limits = request.app.state.limits
    client = _client_ip(request)
    enforce(limits.login_ip, client, "too many logins")
    try:
        key: str | None = nick_key(body.nick)
    except ValueError:  # not a valid nick: no account has it
        key = None
    nick = key or body.nick.casefold()
    enforce(limits.login_nick, f"{nick}\n{client}", "too many logins")
    try:
        enforce(limits.login_nick_total, nick, "too many logins")
    except HTTPException:
        limits.alerter.alert(
            "login_nick_flood",
            "logins for one nick from many addresses reached the ceiling",
            key=nick,
            nick=nick[:64],
        )
        raise
    player = (
        None
        if key is None
        else session.execute(select(Player).where(Player.nick_key == key)).scalar_one_or_none()
    )
    player_id = None if player is None else player.id
    stored = None if player is None else player.password_hash
    # The scrypt run holds no database connection (#413): read, release, hash, write.
    session.rollback()
    try:
        matches = passwords.verify(body.password, stored)
    except HasherBusy:
        raise _hasher_busy() from None
    if not matches or player_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="wrong nick or password"
        )
    current = session.get(Player, player_id)
    if current is None or current.password_hash != stored:  # changed meanwhile: the proof is stale
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="wrong nick or password"
        )
    if current.blocked_at is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="account is blocked")
    return _issue_token(current, session, response)


def _hasher_busy() -> HTTPException:
    """All scrypt slots are taken (``Settings.scrypt_concurrency``): not a verdict on the input."""
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="server is busy, try again in a moment",
        headers={"Retry-After": "1"},
    )


def _issue_token(player: Player, session: DbSession, response: Response) -> GuestCreated:
    token = secrets.token_urlsafe(32)
    player.token_hash = hash_token(token)
    session.commit()
    response.headers["Cache-Control"] = "no-store"
    return GuestCreated(player_id=player.id, token=token)


def _client_ip(request: Request) -> str:
    # request.client is the real client address: uvicorn resolves X-Forwarded-For only from
    # the trusted proxies in GOW_FORWARDED_ALLOW_IPS. The key of IPv6 is its /64 (#415).
    return ip_key(request.client.host) if request.client else "unknown"


def _me(request: Request, player: Player, session: Session) -> Me:
    settings: Settings = request.app.state.settings
    calibration = None
    if player.password_hash is not None:
        played = played_of(session, player.id)
        if played < settings.calibration_matches:
            calibration = Calibration(played=played, total=settings.calibration_matches)
    return Me(
        player_id=player.id,
        nick=player.nick,
        has_password=player.password_hash is not None,
        calibration=calibration,
    )


@router.get("/me/active-match")
async def active_match(
    request: Request, response: Response, player: CurrentPlayer
) -> ActiveMatch | None:
    """The running match of the player (a page reload, a second tab), ``null`` if none.

    The player returns to it with the same token inside the reconnect window (DEC-05). A match
    that is still waiting for its players (an invite) has no ``match_id`` yet: ``null``.
    """
    lifecycle: MatchLifecycle = request.app.state.lifecycle
    response.headers["Cache-Control"] = "no-store"
    record = lifecycle.active_of(player.id)
    if record is None or record.state is not MatchState.RUNNING or record.match_id is None:
        return None
    runner = lifecycle.manager.get(record.match_id)
    if runner is None or runner.finished:
        return None
    return ActiveMatch(match_id=runner.match_id, map_id=runner.map_id)


@router.put("/me/nick")
def change_nick(
    body: NickChange, request: Request, player: CurrentPlayer, session: DbSession, policy: Policy
) -> Me:
    """Change the nick (rate limited per player). The same rules as for a new guest."""
    limits: Limits = request.app.state.limits
    enforce(limits.nick_change, str(player.id), "too many nick changes")
    _check_policy(policy, body.nick)
    key = nick_key(body.nick)
    taken = session.execute(
        select(Player.id).where(Player.nick_key == key, Player.id != player.id)
    ).first()
    if taken is not None:
        raise _nick_taken()
    player.nick = body.nick
    player.nick_key = key
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise _nick_taken() from None
    return _me(request, player, session)


def _check_policy(policy: NickPolicy, nick: str) -> None:
    if not policy.is_allowed(nick):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="this nick is not allowed"
        )


def _nick_taken() -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail="nick is taken")
