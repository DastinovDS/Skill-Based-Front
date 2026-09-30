"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-09-30 12:26:37.941106
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "matches",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("map_id", sa.String(length=64), nullable=False),
        sa.Column("ruleset_hash", sa.String(length=64), nullable=False),
        sa.Column("rated", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("end_reason", sa.String(length=32), nullable=True),
        sa.Column("replay_path", sa.String(length=255), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_matches")),
    )
    op.create_table(
        "players",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("nick", sa.String(length=16), nullable=False),
        sa.Column("nick_key", sa.String(length=64), nullable=False),
        sa.Column("token_hash", sa.LargeBinary(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_players")),
        sa.UniqueConstraint("nick_key", name=op.f("uq_players_nick_key")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_players_token_hash")),
    )
    op.create_table(
        "match_players",
        sa.Column("match_id", sa.Integer(), nullable=False),
        sa.Column("side", sa.Integer(), nullable=False),
        sa.Column("player_id", sa.Integer(), nullable=True),
        sa.Column("bot", sa.String(length=32), nullable=True),
        sa.Column("result", sa.String(length=8), nullable=True),
        sa.CheckConstraint(
            "(player_id IS NULL) <> (bot IS NULL)", name=op.f("ck_match_players_player_or_bot")
        ),
        sa.CheckConstraint("side IN (0, 1)", name=op.f("ck_match_players_side")),
        sa.ForeignKeyConstraint(
            ["match_id"],
            ["matches.id"],
            name=op.f("fk_match_players_match_id_matches"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["player_id"], ["players.id"], name=op.f("fk_match_players_player_id_players")
        ),
        sa.PrimaryKeyConstraint("match_id", "side", name=op.f("pk_match_players")),
        sa.UniqueConstraint("match_id", "player_id", name=op.f("uq_match_players_match_id")),
    )
    with op.batch_alter_table("match_players", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_match_players_player_id"), ["player_id"], unique=False)

    # Double[float]: the type parameter is spelled out for pyright strict.
    op.create_table(
        "ratings",
        sa.Column("player_id", sa.Integer(), nullable=False),
        sa.Column("rating", sa.Double[float](), nullable=False),
        sa.Column("rd", sa.Double[float](), nullable=False),
        sa.Column("volatility", sa.Double[float](), nullable=False),
        sa.Column("rated_matches", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["player_id"],
            ["players.id"],
            name=op.f("fk_ratings_player_id_players"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("player_id", name=op.f("pk_ratings")),
    )


def downgrade() -> None:
    op.drop_table("ratings")
    with op.batch_alter_table("match_players", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_match_players_player_id"))

    op.drop_table("match_players")
    op.drop_table("players")
    op.drop_table("matches")
