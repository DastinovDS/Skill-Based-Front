"""Alembic environment.

Two ways in:
- ``gow_server.db.upgrade_to_head(engine)`` (server start, tests) passes an open connection in
  ``config.attributes["connection"]``;
- the CLI (``uv run alembic -c apps/server/alembic.ini upgrade head``) connects to
  ``sqlalchemy.url`` if the config sets it, otherwise to ``GOW_DATABASE_URL`` (``Settings``).
"""

from alembic import context
from sqlalchemy import Connection

from gow_server.db import create_db_engine
from gow_server.logs import configure_logging
from gow_server.models import Base
from gow_server.settings import Settings

config = context.config


def run_migrations(connection: Connection) -> None:
    # Batch mode rebuilds a table as copy + drop + rename; with foreign_keys=ON the drop of a
    # referenced table would fail or cascade. So migrations run with enforcement off, and the
    # result is checked with foreign_key_check before enforcement is switched back on.
    connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
    connection.commit()
    try:
        context.configure(
            connection=connection, target_metadata=Base.metadata, render_as_batch=True
        )
        with context.begin_transaction():
            context.run_migrations()
        violations = connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
        if violations:
            raise RuntimeError(f"foreign key violations after migration: {violations}")
    finally:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        connection.commit()


if context.is_offline_mode():
    raise RuntimeError("offline (--sql) migrations are not supported")

given: Connection | None = config.attributes.get("connection")
if given is not None:
    run_migrations(given)
else:
    configure_logging("INFO")
    engine = create_db_engine(config.get_main_option("sqlalchemy.url") or Settings().database_url)
    try:
        with engine.connect() as connection:
            run_migrations(connection)
    finally:
        engine.dispose()
