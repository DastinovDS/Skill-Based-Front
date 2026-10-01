"""match status and duration (SRV-09)

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-01 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("matches") as batch_op:
        batch_op.add_column(
            sa.Column("status", sa.String(length=16), server_default="created", nullable=False)
        )
        batch_op.add_column(sa.Column("ticks", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("matches") as batch_op:
        batch_op.drop_column("ticks")
        batch_op.drop_column("status")
