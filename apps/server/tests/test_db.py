"""DB-01: SQLite pragmas, migrations on an empty database, models match the migrations."""

import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from gow_server.app import create_app
from gow_server.db import DbSession, create_db_engine, upgrade_to_head
from gow_server.models import Base, Match, MatchPlayer, Player
from gow_server.settings import Settings

ALEMBIC_INI = Path(__file__).parents[1] / "alembic.ini"
TABLES = {"players", "ratings", "matches", "match_players"}


@pytest.fixture
def engine(tmp_path: Path) -> Iterator[Engine]:
    engine = create_db_engine(f"sqlite:///{tmp_path / 'data' / 'test.db'}")
    upgrade_to_head(engine)
    yield engine
    engine.dispose()


def test_pragmas(engine: Engine) -> None:
    with engine.connect() as connection:

        def pragma(name: str) -> object:
            return connection.exec_driver_sql(f"PRAGMA {name}").scalar()

        assert pragma("journal_mode") == "wal"
        assert pragma("synchronous") == 1  # NORMAL
        assert pragma("foreign_keys") == 1
        assert pragma("busy_timeout") == 5000


def test_alembic_upgrade_head_on_empty_database(tmp_path: Path) -> None:
    """The same entry as ``uv run alembic -c apps/server/alembic.ini upgrade head``."""
    db_path = tmp_path / "empty.db"
    config = Config(ALEMBIC_INI)
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    command.upgrade(config, "head")
    with sqlite3.connect(db_path) as connection:
        names = {row[0] for row in connection.execute("SELECT name FROM sqlite_master")}
        version = connection.execute("SELECT version_num FROM alembic_version").fetchone()
    assert names >= TABLES
    assert version == ("0002",)
    command.downgrade(config, "base")
    with sqlite3.connect(db_path) as connection:
        names = {row[0] for row in connection.execute("SELECT name FROM sqlite_master")}
    assert not names & TABLES


def test_models_match_migrations(engine: Engine) -> None:
    with engine.connect() as connection:
        diff = compare_metadata(MigrationContext.configure(connection), Base.metadata)
    assert diff == []


def test_foreign_keys_enforced_after_migration(engine: Engine) -> None:
    with Session(engine) as session:
        session.add(MatchPlayer(match_id=999, side=0, bot="easy"))
        with pytest.raises(IntegrityError):
            session.commit()


def test_match_side_is_a_player_or_a_bot(engine: Engine) -> None:
    with Session(engine) as session:
        match = Match(map_id="line3", ruleset_hash="0" * 64)
        session.add(match)
        session.flush()
        session.add(MatchPlayer(match_id=match.id, side=0))
        with pytest.raises(IntegrityError):
            session.commit()


def test_nick_key_is_unique(engine: Engine) -> None:
    with Session(engine) as session:
        session.add(Player(nick="Ab", nick_key="ab", token_hash=b"\x01" * 32))
        session.add(Player(nick="AB", nick_key="ab", token_hash=b"\x02" * 32))
        with pytest.raises(IntegrityError):
            session.commit()


def test_app_migrates_on_startup_and_serves_sessions(settings: Settings) -> None:
    app: FastAPI = create_app(settings)

    @app.get("/test/players")
    def count_players(session: DbSession) -> int:  # pyright: ignore[reportUnusedFunction]
        return len(session.execute(select(Player)).scalars().all())

    with TestClient(app) as client:
        assert client.get("/test/players").json() == 0
    engine = create_db_engine(settings.database_url)
    try:
        assert set(inspect(engine).get_table_names()) >= TABLES
        with engine.connect() as connection:
            assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
    finally:
        engine.dispose()
