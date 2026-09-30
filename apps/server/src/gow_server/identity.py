"""Guest identity and nicknames (ID-01).

- ``POST /api/guest {nick}`` creates a guest and returns ``{player_id, token}`` once.
- The token is ``secrets.token_urlsafe(32)``; the database keeps only its SHA-256.
- HTTP requests authenticate with ``Authorization: Bearer <token>``; the token is never read
  from the URL and never logged (AGENTS.md, sections 5.3 and 5.4).

The endpoints are ``def``: they use the synchronous database (AGENTS.md, section 9).
"""

import hashlib
import math
import secrets
import unicodedata
from typing import Annotated, Final

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from gow_server.db import DbSession
from gow_server.models import Player
from gow_server.ratelimit import SlidingWindowLimiter

NICK_MIN: Final = 3
NICK_MAX: Final = 16
NICK_PUNCTUATION: Final = frozenset("_-")
# Hangul fillers are letters (category Lo) that render as blank space: invisible nicks.
NICK_INVISIBLE_LETTERS: Final = frozenset("\u115f\u1160\u3164\uffa0")


def validate_nick(raw: str) -> str:
    """Normalize a nick to NFC and check it; raises ValueError with the reason.

    Allowed: 3..16 characters, each a letter (any script), a decimal digit, ``_`` or ``-``.
    No spaces, symbols, emoji, control characters or blank-looking letters.
    """
    nick = unicodedata.normalize("NFC", raw)
    if not NICK_MIN <= len(nick) <= NICK_MAX:
        raise ValueError(f"nick must be {NICK_MIN}..{NICK_MAX} characters long")
    for char in nick:
        category = unicodedata.category(char)
        letter = category.startswith("L") and char not in NICK_INVISIBLE_LETTERS
        if not (letter or category == "Nd" or char in NICK_PUNCTUATION):
            raise ValueError("nick may contain only letters, digits, '_' and '-'")
    return nick


def nick_key(nick: str) -> str:
    """Key for case-insensitive uniqueness; works for all scripts, unlike SQLite NOCASE."""
    return nick.casefold()


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


bearer = HTTPBearer(description="Guest token from POST /api/guest")


def current_player(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(bearer)], session: DbSession
) -> Player:
    """The authenticated player; 401 for a missing, malformed or unknown token."""
    player = session.execute(
        select(Player).where(Player.token_hash == hash_token(credentials.credentials))
    ).scalar_one_or_none()
    if player is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return player


CurrentPlayer = Annotated[Player, Depends(current_player)]

router = APIRouter(prefix="/api", tags=["identity"])


def _guest_limiter(request: Request) -> SlidingWindowLimiter:
    limiter: SlidingWindowLimiter = request.app.state.guest_limiter
    return limiter


@router.post("/guest", status_code=status.HTTP_201_CREATED)
def create_guest(
    body: GuestCreate,
    request: Request,
    response: Response,
    session: DbSession,
    limiter: Annotated[SlidingWindowLimiter, Depends(_guest_limiter)],
) -> GuestCreated:
    # request.client is the real client address: uvicorn resolves X-Forwarded-For only from
    # the trusted proxies in GOW_FORWARDED_ALLOW_IPS.
    retry_after = limiter.hit(request.client.host if request.client else "unknown")
    if retry_after is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="too many guests from this address",
            headers={"Retry-After": str(math.ceil(retry_after))},
        )
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


def _nick_taken() -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail="nick is taken")
