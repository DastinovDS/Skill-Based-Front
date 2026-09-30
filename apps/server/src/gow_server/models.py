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
    """``nick.casefold()``: case-insensitive uniqueness (SQLite NOCASE covers only ASCII)."""
    token_hash: Mapped[bytes] = mapped_column(LargeBinary(32), unique=True)
    """SHA-256 of the token; the token itself is never stored (AGENTS.md, section 5.4)."""
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


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
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class Match(Base):
    """Match metadata; the replay itself is a file in ``data/replays/`` (AGENTS.md, section 9)."""

    __tablename__ = "matches"

    id: Mapped[int] = mapped_column(primary_key=True)
    map_id: Mapped[str] = mapped_column(String(64))
    ruleset_hash: Mapped[str] = mapped_column(String(64))
    rated: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    started_at: Mapped[datetime | None]
    ended_at: Mapped[datetime | None]
    end_reason: Mapped[str | None] = mapped_column(String(32))
    replay_path: Mapped[str | None] = mapped_column(String(255))


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
