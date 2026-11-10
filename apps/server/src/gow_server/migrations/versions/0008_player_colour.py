"""player colour: players.colour and match_players.colour (DEC-49, #906)

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-10 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("players") as batch_op:
        batch_op.add_column(
            sa.Column("colour", sa.String(length=16), server_default="lapis", nullable=False)
        )
    with op.batch_alter_table("match_players") as batch_op:
        batch_op.add_column(sa.Column("colour", sa.String(length=16), nullable=True))
    # Existing players ask for Lapis (the default); sides of earlier matches keep ``NULL``:
    # their replays have no colours and the client draws them as before.


def downgrade() -> None:
    with op.batch_alter_table("match_players") as batch_op:
        batch_op.drop_column("colour")
    with op.batch_alter_table("players") as batch_op:
        batch_op.drop_column("colour")
