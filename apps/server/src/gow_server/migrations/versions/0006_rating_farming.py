"""rating-farming protection: queue ban and per-side rating mode (DEC-34, #414)

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-28 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("players") as batch_op:
        batch_op.add_column(sa.Column("queue_banned_until", sa.DateTime(), nullable=True))
    with op.batch_alter_table("match_players") as batch_op:
        batch_op.add_column(
            sa.Column("rating_mode", sa.String(length=16), server_default="none", nullable=False)
        )
        batch_op.add_column(sa.Column("unrated_reason", sa.String(length=32), nullable=True))
    # Rows of rated matches played before DEC-34 keep mode "none": they are history, and
    # ``matches.rating_applied`` already says they were counted.


def downgrade() -> None:
    with op.batch_alter_table("match_players") as batch_op:
        batch_op.drop_column("unrated_reason")
        batch_op.drop_column("rating_mode")
    with op.batch_alter_table("players") as batch_op:
        batch_op.drop_column("queue_banned_until")
