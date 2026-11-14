"""tutorial progress: players.tutorial (#806)

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-14 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("players") as batch_op:
        batch_op.add_column(sa.Column("tutorial", sa.JSON(), nullable=True))
    # Every earlier player has no progress on the server: ``NULL`` is the empty progress.


def downgrade() -> None:
    with op.batch_alter_table("players") as batch_op:
        batch_op.drop_column("tutorial")
