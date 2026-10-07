"""Guest identity and nicknames (ID-01).

- ``POST /api/guest {nick}`` creates a guest and returns ``{player_id, token}`` once.
- The token is ``secrets.token_urlsafe(32)``; the database keeps only its SHA-256.
- HTTP requests authenticate with ``Authorization: Bearer <token>``; the token is never read
  from the URL and never logged (AGENTS.md, sections 5.3 and 5.4).

The endpoints are ``def``: they use the synchronous database (AGENTS.md, section 9).
"""

import hashlib
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from gow_server.abuse import Limits, enforce
from gow_server.db import DbSession
from gow_server.models import Player
from gow_server.nicks import NickPolicy, skeleton, validate_nick
from gow_server.ratelimit import SlidingWindowLimiter


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


class NickChange(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    nick: str

    @field_validator("nick")
    @classmethod
    def _check_nick(cls, value: str) -> str:
        return validate_nick(value)


bearer = HTTPBearer(description="Guest token from POST /api/guest")


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
    # request.client is the real client address: uvicorn resolves X-Forwarded-For only from
    # the trusted proxies in GOW_FORWARDED_ALLOW_IPS.
    enforce(
        limiter,
        request.client.host if request.client else "unknown",
        "too many guests from this address",
    )
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
def me(player: CurrentPlayer) -> Me:
    return Me(player_id=player.id, nick=player.nick)


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
    return Me(player_id=player.id, nick=player.nick)


def _check_policy(policy: NickPolicy, nick: str) -> None:
    if not policy.is_allowed(nick):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="this nick is not allowed"
        )


def _nick_taken() -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail="nick is taken")
