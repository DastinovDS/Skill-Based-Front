"""Per-player abuse limits (MOD-01) next to the per-IP guest limit and the WebSocket flood guard.

``app.state.limits`` holds one sliding-window limiter per action, keyed by the player id. They are
in memory: a server restart resets them (acceptable: one process, restarts are rare).
"""

import math

from fastapi import HTTPException, status

from gow_server.clock import Clock
from gow_server.ratelimit import SlidingWindowLimiter
from gow_server.settings import Settings


class Limits:
    """The limiters of the actions a player can repeat: match creation, queue entry, nick change,
    password change, and of logins (by IP and by nick)."""

    def __init__(self, settings: Settings, clock: Clock) -> None:
        self.match_create = SlidingWindowLimiter(
            settings.match_create_rate_limit, settings.match_create_rate_window_s, clock
        )
        self.queue = SlidingWindowLimiter(
            settings.queue_rate_limit, settings.queue_rate_window_s, clock
        )
        self.nick_change = SlidingWindowLimiter(
            settings.nick_change_rate_limit, settings.nick_change_rate_window_s, clock
        )
        self.password = SlidingWindowLimiter(
            settings.password_rate_limit, settings.password_rate_window_s, clock
        )
        # Logins are not keyed by a player: by client IP and by the nick key that was tried.
        self.login_ip = SlidingWindowLimiter(
            settings.login_ip_rate_limit, settings.login_ip_rate_window_s, clock
        )
        self.login_nick = SlidingWindowLimiter(
            settings.login_nick_rate_limit, settings.login_nick_rate_window_s, clock
        )


def enforce(limiter: SlidingWindowLimiter, key: str, detail: str) -> None:
    """Count a hit; raises 429 with ``Retry-After`` when ``key`` is over its limit."""
    retry_after = limiter.hit(key)
    if retry_after is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=detail,
            headers={"Retry-After": str(math.ceil(retry_after))},
        )


def server_full() -> HTTPException:
    """503 for a match that cannot start: a cap on running matches is reached (#412)."""
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="server is full, try again in a moment",
        headers={"Retry-After": "15"},
    )
