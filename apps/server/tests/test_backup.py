"""Backup and restore of the SQLite database and replays (OPS-03, #82)."""

import io
import sqlite3
import tarfile
from pathlib import Path

import pytest
from sqlalchemy import text

from gow_server.backup import create_backup, db_path_from_url, restore_backup
from gow_server.db import create_db_engine, upgrade_to_head


def make_db(path: Path) -> None:
    engine = create_db_engine(f"sqlite:///{path}")
    upgrade_to_head(engine)
    engine.dispose()


def test_backup_of_a_live_wal_database_restores_committed_rows(tmp_path: Path) -> None:
    db = tmp_path / "live" / "gow.db"
    make_db(db)
    replays = tmp_path / "live" / "replays"
    replays.mkdir()
    (replays / "m1.jsonl.gz").write_bytes(b"replay")
    # An open writer connection in WAL mode, as in a running server: the row is only in the WAL.
    engine = create_db_engine(f"sqlite:///{db}")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE probe (value TEXT)"))
        connection.execute(text("INSERT INTO probe VALUES ('kept')"))
    with engine.connect() as connection:
        assert connection.execute(text("PRAGMA journal_mode")).scalar() == "wal"
        archive = io.BytesIO()
        create_backup(db, replays, archive)
    engine.dispose()

    target_db = tmp_path / "fresh" / "gow.db"
    target_replays = tmp_path / "fresh" / "replays"
    archive.seek(0)
    restore_backup(archive, target_db, target_replays)

    rows = sqlite3.connect(target_db).execute("SELECT value FROM probe").fetchall()
    assert rows == [("kept",)]
    assert (target_replays / "m1.jsonl.gz").read_bytes() == b"replay"
    assert not list(tmp_path.glob("*/.backup-*")) and not list(tmp_path.glob("*/.restore-*"))


def test_restore_replaces_existing_data(tmp_path: Path) -> None:
    source = tmp_path / "a" / "gow.db"
    make_db(source)
    archive = io.BytesIO()
    create_backup(source, tmp_path / "a" / "replays", archive)

    target = tmp_path / "b" / "gow.db"
    make_db(target)
    sqlite3.connect(target).execute("CREATE TABLE stale (x INT)").connection.commit()
    old_replay = tmp_path / "b" / "replays" / "old.jsonl.gz"
    old_replay.parent.mkdir()
    old_replay.write_bytes(b"old")
    archive.seek(0)
    restore_backup(archive, target, tmp_path / "b" / "replays")

    tables = {row[0] for row in sqlite3.connect(target).execute("SELECT name FROM sqlite_master")}
    assert "stale" not in tables and "alembic_version" in tables
    assert not old_replay.exists()


def test_restore_rejects_an_archive_without_a_valid_database(tmp_path: Path) -> None:
    bogus = tmp_path / "src" / "gow.db"
    bogus.parent.mkdir()
    bogus.write_bytes(b"not sqlite")
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode="w|gz") as tar:
        tar.add(bogus, arcname="gow.db")
    target = tmp_path / "dst" / "gow.db"
    make_db(target)
    archive.seek(0)
    with pytest.raises(ValueError):
        restore_backup(archive, target, tmp_path / "dst" / "replays")
    assert sqlite3.connect(target).execute("SELECT count(*) FROM alembic_version").fetchone()


def test_db_path_from_url() -> None:
    assert db_path_from_url("sqlite:////data/gow.db") == Path("/data/gow.db")
    with pytest.raises(ValueError):
        db_path_from_url("sqlite://")
