"""SQLite engine, sessions and migrations (AGENTS.md, section 9).

The SQLAlchemy API here is synchronous. Use it only in ``def`` endpoints (FastAPI runs them in
its threadpool) or through ``asyncio.to_thread``; never inside ``async def`` or a match tick:
a blocking call there stalls the event loop of every match.
"""

from collections.abc import Iterator
from pathlib import Path
from typing import Annotated, Final

from alembic import command
from alembic.config import Config
from fastapi import Depends, Request
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.engine.interfaces import DBAPIConnection
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import ConnectionPoolEntry

MIGRATIONS_DIR: Final = Path(__file__).parent / "migrations"

# busy_timeout first, so that switching to WAL waits for a lock instead of failing.
SQLITE_PRAGMAS: Final = (
    "PRAGMA busy_timeout=5000",
    "PRAGMA journal_mode=WAL",
    "PRAGMA synchronous=NORMAL",
    "PRAGMA foreign_keys=ON",
)


def create_db_engine(url: str) -> Engine:
    """An engine for a SQLite URL; every new connection gets ``SQLITE_PRAGMAS``."""
    sa_url = make_url(url)
    if sa_url.get_backend_name() != "sqlite":
        raise ValueError(f"only SQLite is supported, got {sa_url.get_backend_name()!r}")
    if sa_url.database and sa_url.database != ":memory:":
        Path(sa_url.database).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(sa_url)
    event.listen(engine, "connect", _set_sqlite_pragmas)
    return engine


def _set_sqlite_pragmas(dbapi_connection: DBAPIConnection, _record: ConnectionPoolEntry) -> None:
    cursor = dbapi_connection.cursor()
    try:
        for pragma in SQLITE_PRAGMAS:
            cursor.execute(pragma)
    finally:
        cursor.close()


def upgrade_to_head(engine: Engine) -> None:
    """Apply all migrations (``alembic upgrade head``) on ``engine``. Blocking."""
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    with engine.connect() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")


def get_session(request: Request) -> Iterator[Session]:
    """FastAPI dependency: a session per request. Only for ``def`` endpoints."""
    sessions: sessionmaker[Session] = request.app.state.sessions
    with sessions() as session:
        yield session


DbSession = Annotated[Session, Depends(get_session)]
