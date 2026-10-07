"""rating updates of rated matches (RAT-02)

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-07 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("matches") as batch_op:
        batch_op.add_column(
            sa.Column("rating_applied", sa.Boolean(), server_default="0", nullable=False)
        )
    with op.batch_alter_table("match_players") as batch_op:
        batch_op.add_column(sa.Column("rating_before", sa.Double(), nullable=True))
        batch_op.add_column(sa.Column("rating_after", sa.Double(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("match_players") as batch_op:
        batch_op.drop_column("rating_after")
        batch_op.drop_column("rating_before")
    with op.batch_alter_table("matches") as batch_op:
        batch_op.drop_column("rating_applied")
