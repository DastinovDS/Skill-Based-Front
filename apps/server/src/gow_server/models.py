"""Database models (SQLAlchemy 2). Separate from the protocol models (AGENTS.md, section 6).

A schema change goes only through an Alembic migration in ``gow_server/migrations/versions/``;
``test_db.py`` fails when the models and the migrations disagree.
Times are naive UTC (SQLite has no time zones): use ``utcnow()``.
"""

from datetime import UTC, datetime

from sqlalchemy import CheckConstraint, ForeignKey, LargeBinary, MetaData, String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Named constraints: Alembic batch mode on SQLite can only alter or drop a named constraint.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class Player(Base):
    __tablename__ = "players"

    id: Mapped[int] = mapped_column(primary_key=True)
    nick: Mapped[str] = mapped_column(String(16))
    nick_key: Mapped[str] = mapped_column(String(64), unique=True)
    """``gow_server.nicks.skeleton(nick)``: uniqueness that ignores case, accents and look-alike
    letters (SQLite NOCASE covers only ASCII)."""
    token_hash: Mapped[bytes] = mapped_column(LargeBinary(32), unique=True)
    """SHA-256 of the token; the token itself is never stored (AGENTS.md, section 5.4). A login
    and a password change replace it (#374): one device at a time."""
    password_hash: Mapped[str | None] = mapped_column(String(255))
    """``gow_server.passwords``: ``scrypt$n$r$p$salt$hash``, never the password itself (#374).
    ``None`` for a guest: the account is reachable only by its token."""
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    blocked_at: Mapped[datetime | None]
    """Set by ``gow-admin block`` (MOD-01): the account no longer authenticates (HTTP 403; on the
    match WebSocket it is an unknown token)."""
    queue_banned_until: Mapped[datetime | None]
    """The matchmaking queue refuses the player until then: repeated resigns in rated matches
    (DEC-34, #414). Set when a result is written, so the length is that of the resign that
    caused it; a later resign never shortens it."""


class Rating(Base):
    """Glicko-2 state of a player (RAT-01)."""

    __tablename__ = "ratings"

    player_id: Mapped[int] = mapped_column(
        ForeignKey("players.id", ondelete="CASCADE"), primary_key=True
    )
    rating: Mapped[float]
    rd: Mapped[float]
    volatility: Mapped[float]
    rated_matches: Mapped[int] = mapped_column(default=0)
    """Matches that changed this player's rating, calibration matches included. While it is below
    ``Settings.calibration_matches`` the account is calibrating (DEC-34, #414)."""
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class Match(Base):
    """Match metadata; the replay itself is a file in ``data/replays/`` (AGENTS.md, section 9)."""

    __tablename__ = "matches"

    id: Mapped[int] = mapped_column(primary_key=True)
    map_id: Mapped[str] = mapped_column(String(64))
    ruleset_hash: Mapped[str] = mapped_column(String(64))
    rated: Mapped[bool] = mapped_column(default=False)
    rating_applied: Mapped[bool] = mapped_column(default=False, server_default="0")
    """The result is in the ratings (RAT-02): set once, so a match is rated at most once."""
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    started_at: Mapped[datetime | None]
    ended_at: Mapped[datetime | None]
    end_reason: Mapped[str | None] = mapped_column(String(32))
    """``EndReason`` value, or ``disconnect``, ``no_show``, ``crashed``, ``server_stopped``,
    ``server_restart`` (see ``gow_server.lifecycle``)."""
    status: Mapped[str] = mapped_column(String(16), default="created", server_default="created")
    """``running``, ``saved`` (result written) or ``aborted`` (no result); SRV-09."""
    ticks: Mapped[int | None]
    """Duration of the match in ticks (10 per second) once it is over."""
    replay_path: Mapped[str | None] = mapped_column(String(255))
    replay_expired_at: Mapped[datetime | None]
    """When the retention removed the replay files (SRV-08, #515); ``replay_path`` is then null.
    The row stays: result, rating and sides do not expire with the replay."""


class MatchPlayer(Base):
    """A side of a match: a player or a bot."""

    __tablename__ = "match_players"
    __table_args__ = (
        UniqueConstraint("match_id", "player_id"),
        CheckConstraint("side IN (0, 1)", name="side"),
        CheckConstraint("(player_id IS NULL) <> (bot IS NULL)", name="player_or_bot"),
    )

    match_id: Mapped[int] = mapped_column(
        ForeignKey("matches.id", ondelete="CASCADE"), primary_key=True
    )
    side: Mapped[int] = mapped_column(primary_key=True)
    """Player id in the simulation: 0 or 1."""
    player_id: Mapped[int | None] = mapped_column(ForeignKey("players.id"), index=True)
    bot: Mapped[str | None] = mapped_column(String(32))
    """Bot name when this side is a bot (then ``player_id`` is null)."""
    result: Mapped[str | None] = mapped_column(String(8))
    """``win``, ``loss`` or ``draw`` once the match is over."""
    rating_before: Mapped[float | None]
    rating_after: Mapped[float | None]
    """Displayed rating (``r - 2 * RD``) before and after a rated match (RAT-02)."""
    rating_mode: Mapped[str] = mapped_column(String(16), default="none", server_default="none")
    """What the match does to this side's rating (DEC-34): ``rated``, ``calibration`` (the rating
    changes but is hidden) or ``none``. Fixed at the start, ``none`` again if the early-resign rule
    takes the gain away at the end."""
    unrated_reason: Mapped[str | None] = mapped_column(String(32))
    """``gow_protocol.messages.UnratedReason`` value when ``rating_mode`` is ``none`` in a queue
    match; ``None`` otherwise (and in matches that are not from the queue)."""
