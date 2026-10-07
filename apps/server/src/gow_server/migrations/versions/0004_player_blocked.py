"""player blocking and nick skeletons (MOD-01)

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-07 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from gow_server.nicks import skeleton

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("players") as batch_op:
        batch_op.add_column(sa.Column("blocked_at", sa.DateTime(), nullable=True))
    # nick_key was nick.casefold(); it becomes the look-alike-proof skeleton. Nicks that look
    # alike under the new rule keep working: the later one gets a key no new nick can produce
    # ("#" is not allowed in nicks), and the admin can rename it (gow-admin rename).
    connection = op.get_bind()
    taken: set[str] = set()
    rows = connection.execute(sa.text("SELECT id, nick FROM players ORDER BY id")).all()
    for player_id, nick in rows:
        try:
            key = skeleton(nick)
        except ValueError:
            key = f"#{player_id}"
        if key in taken:
            key = f"{key}#{player_id}"
        taken.add(key)
        connection.execute(
            sa.text("UPDATE players SET nick_key = :key WHERE id = :id"),
            {"key": key, "id": player_id},
        )


def downgrade() -> None:
    connection = op.get_bind()
    for player_id, nick in connection.execute(sa.text("SELECT id, nick FROM players")).all():
        connection.execute(
            sa.text("UPDATE players SET nick_key = :key WHERE id = :id"),
            {"key": nick.casefold(), "id": player_id},
        )
    with op.batch_alter_table("players") as batch_op:
        batch_op.drop_column("blocked_at")
