"""Server settings, read from environment variables with the ``GOW_`` prefix."""

from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_ONLY_RULESETS = frozenset({"test-short"})
"""Rulesets (file stems) a ``prod`` server refuses to play on (AGENTS.md, section 5.4)."""


class Settings(BaseSettings):
    """All server configuration. Example: ``GOW_PORT=9000 uv run gow-server``."""

    model_config = SettingsConfigDict(
        env_prefix="GOW_", extra="forbid", frozen=True, env_ignore_empty=True
    )

    env: Literal["dev", "e2e", "prod"] = "dev"
    host: str = "127.0.0.1"
    port: int = 8000
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    forwarded_allow_ips: str = "127.0.0.1"
    """Proxies trusted for X-Forwarded-* headers (uvicorn ``--forwarded-allow-ips``): Caddy."""
    maps_dir: Path = Path("maps")
    """Directory with the map pool: ``<id>.json`` and optional background ``<id>.bg.webp``."""
    ruleset_path: Path = Path("rulesets/mvp-0.toml")
    """The ruleset of every match this server starts (loaded once at startup)."""
    database_url: str = "sqlite:///data/gow.db"
    """SQLite only; a relative path is relative to the working directory."""
    replays_dir: Path = Path("data/replays")
    """Command logs and frames files of matches (AGENTS.md, section 9); the server writes only here
    and into the database. Relative paths are relative to the working directory."""
    rulesets_dir: Path = Path("rulesets/archive")
    """Archive of the rulesets matches were played on (``<hash>.toml``): a replay is re-simulated
    with the ruleset named in its header (AGENTS.md, section 4.5). The server archives its ruleset
    here at start-up, so it must be writable (in a container ``GOW_RULESETS_DIR=/data/rulesets``).
    """
    rulesets_bundled_dir: Path = Path("rulesets/archive")
    """The archive shipped with the image (read-only): its files are copied into ``rulesets_dir``
    at start-up when that is another directory."""
    max_request_body_bytes: int = Field(default=32 * 1024, gt=0)
    """Largest HTTP request body in bytes; more gets 413 before any parsing (SRV-01, #411). Every
    API body is a few hundred bytes. WebSocket messages are not covered."""
    guest_rate_limit: int = 10
    guest_rate_window_s: int = 3600
    """At most ``guest_rate_limit`` guests per client IP within ``guest_rate_window_s`` seconds."""
    match_create_rate_limit: int = 10
    match_create_rate_window_s: int = 600
    """At most ``match_create_rate_limit`` matches (private invites and bot matches together) per
    player within ``match_create_rate_window_s`` seconds (MOD-01)."""
    queue_rate_limit: int = 20
    queue_rate_window_s: int = 60
    """At most ``queue_rate_limit`` queue entries per player within ``queue_rate_window_s``
    seconds; used by the matchmaking queue (MM-01, ``app.state.limits.queue``)."""
    nick_change_rate_limit: int = 3
    nick_change_rate_window_s: int = 86400
    """At most ``nick_change_rate_limit`` nick changes per player within the window (MOD-01)."""
    login_ip_rate_limit: int = 20
    login_ip_rate_window_s: int = 600
    """At most ``login_ip_rate_limit`` logins (right or wrong) per client IP within the window
    (#374): password guessing from one address."""
    login_nick_rate_limit: int = 10
    login_nick_rate_window_s: int = 600
    """At most ``login_nick_rate_limit`` logins per nick (by ``nick_key``) from one client address
    within the window: password guessing for one account from one address. The key includes the
    address (SRV-06, #492), so a third party cannot use up the budget of the account's owner."""
    login_nick_total_rate_limit: int = 200
    """At most this many logins per nick from all addresses together within the same window:
    a high ceiling against guessing from many addresses. Only attempts that passed the per-IP and
    per-nick-and-IP limits count. Reaching it raises the ``login_nick_flood`` alert."""
    password_rate_limit: int = 5
    password_rate_window_s: int = 3600
    """At most ``password_rate_limit`` password sets or changes per player within the window
    (guessing the old password with a stolen token)."""
    scrypt_n: int = 2**15
    scrypt_r: int = 8
    scrypt_p: int = 1
    scrypt_maxmem: int = 64 * 1024 * 1024
    """``hashlib.scrypt`` parameters of new password hashes (#374). Memory is about
    ``128 * n * r`` bytes (32 MiB by default), so ``scrypt_maxmem`` must stay above it; a hash keeps
    its own ``n``, ``r``, ``p``, so raising them later does not break existing passwords. Target:
    50..100 ms per hash on the server."""
    scrypt_concurrency: int = Field(default=3, ge=1)
    """At most this many scrypt runs at once (#413, about ``128 * n * r`` bytes each). A login or
    a password change over the limit is answered 503 with ``Retry-After`` at once, no queueing."""
    nick_blocklist_file: Path | None = None
    """Extra forbidden words for nicks, one per line (``#`` comments), added to the built-in list
    (``gow_server.nicks``). In a container put it on the volume: ``/data/nick-blocklist.txt``."""
    ws_allowed_origins: tuple[str, ...] = ()
    """Origins allowed to open the match WebSocket besides the site's own one (the ``Host`` it was
    reached at, i.e. the page behind Caddy). JSON in the environment: ``'["http://localhost:5173"]'``."""
    ws_hello_timeout_s: float = 5.0
    """The first message, ``hello``, must come within this time (AGENTS.md, section 5.3)."""
    ws_send_timeout_s: float = 5.0
    """A send that takes longer means the client does not read: it is disconnected."""
    ws_msg_rate: float = 20.0
    ws_msg_burst: int = 60
    """Token bucket of one connection's messages: ``ws_msg_rate`` per second, bursts up to
    ``ws_msg_burst`` (a resend of unacknowledged commands after a reconnect); more is a flood."""
    invite_ttl_s: float = 1800.0
    """A private-match invite expires this long after creation (SRV-05: 30 minutes)."""
    lobby_stale_s: float = 15.0
    """A public lobby entry is dropped when its host did not ask for the invite this long (LOB-01);
    the waiting room polls every 1.5 s."""
    invite_rate_limit: int = 10
    invite_rate_window_s: float = 60.0
    """At most ``invite_rate_limit`` matches (private or public) created per account within
    ``invite_rate_window_s`` seconds (AGENTS.md, section 5.5)."""
    reconnect_window_s: float = 60.0
    """A player without a connection has this long to come back, the match goes on meanwhile;
    then the server applies a ``Forfeit`` for them, a technical defeat (DEC-05, #49)."""
    pause_max_s: float = 60.0
    """One pause per player in a private match, at most this long (DEC-05); none in rated ones."""
    max_matches: int = Field(default=30, ge=1)
    """At most this many matches run at once (#412). The budget of AGENTS.md, section 12 is 30
    parallel matches per core (tick lag under 10 %); past it a new match is refused with 503."""
    max_bot_matches: int = Field(default=10, ge=0)
    """At most this many of them play against a bot (they cost bot decisions and cannot be
    paid for by a second human); 0 turns bot matches off. 503 when full (#412)."""
    bot_connect_timeout_s: float = Field(default=15.0, gt=0)
    """A bot match nobody connected to within this many seconds is dropped as never started: no
    replay, saved ``aborted`` (#412). The client connects right after ``POST /api/bot-matches``."""
    ready_timeout_s: float = 120.0
    """A guest who joined an invite and the host have this long to be ready; otherwise the
    invite is dropped, a no-show (SRV-09)."""
    queue_window_base: float = 100.0
    queue_window_per_s: float = 5.0
    queue_window_max: float = 400.0
    """Matchmaking window (MM-01): a player accepts opponents within ``queue_window_base +
    queue_window_per_s * waited`` rating points, at most ``queue_window_max``."""
    queue_pass_s: float = 1.0
    """At most one pairing pass of the queue per this many seconds."""
    queue_confirm_s: float = 15.0
    """A found pair has this long to confirm; who did not leaves the queue."""
    queue_bot_offer_s: float = 60.0
    """After this long in the queue the player is offered an unrated match against a bot."""
    queue_stale_s: float = 15.0
    """A player whose client did not poll the queue this long (a closed tab) leaves it."""
    calibration_matches: int = Field(default=5, ge=1)
    """Calibration matches of a password account before its rating is shown and it counts for
    opponents (DEC-34, item 2)."""
    early_resign_s: int = Field(default=180, ge=0)
    """A resign or technical defeat before this match time (seconds, so ``early_resign_s *
    tick_hz`` ticks) gives the winner no rating change (DEC-34, item 3)."""
    resign_window_s: int = Field(default=86400, gt=0)
    """Rolling window of the repeated-resign count of the queue ban (DEC-34, item 3)."""
    resign_ban_second_s: int = Field(default=300, ge=0)
    resign_ban_third_s: int = Field(default=1800, ge=0)
    resign_ban_later_s: int = Field(default=7200, ge=0)
    """Queue ban after the 2nd, the 3rd, and the 4th and later resign within the window (the 1st
    carries none): 5 minutes, 30 minutes, 2 hours (DEC-34, item 3)."""
    opponent_limit: int = Field(default=3, ge=1)
    opponent_limit_window_s: int = Field(default=86400, gt=0)
    """At most ``opponent_limit`` rated matches between the same two accounts within the rolling
    window; the later ones are unrated (DEC-34, item 4)."""
    bot_budget_s: float = 0.001
    """A bot decision longer than this makes the bot skip its next call (SRV-06, AGENTS.md, 8)."""

    monitor_interval_s: float = 30.0
    """How often the tick lag of running matches is checked against the 10 % alert (OPS-04)."""

    @model_validator(mode="after")
    def _ruleset_allowed(self) -> "Settings":
        if self.env == "prod" and self.ruleset_path.stem in DEV_ONLY_RULESETS:
            raise ValueError(
                f"ruleset {self.ruleset_path.stem!r} is only for dev and e2e, not GOW_ENV=prod"
            )
        return self
