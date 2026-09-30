"""Online backup and restore of the server data: the SQLite database and the replays directory.

``python -m gow_server.backup create > backup.tar.gz`` works while the server runs: ``VACUUM INTO``
takes a consistent snapshot of a WAL database (a read transaction, writers are not blocked).
``python -m gow_server.backup restore < backup.tar.gz`` replaces the data; the server must be
stopped (deploy/restore.sh does this). The archive is a gzipped tar: ``gow.db``, ``replays/``.
"""

import argparse
import shutil
import sqlite3
import sys
import tarfile
import tempfile
from pathlib import Path
from typing import BinaryIO

from sqlalchemy.engine import make_url

from gow_server.settings import Settings

DB_NAME = "gow.db"
REPLAYS_NAME = "replays"


def db_path_from_url(url: str) -> Path:
    database = make_url(url).database
    if not database or database == ":memory:":
        raise ValueError("backup needs a file SQLite database")
    return Path(database)


def check_database(path: Path) -> None:
    """Raise ``ValueError`` unless ``path`` is an intact database with applied migrations."""
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        result = connection.execute("PRAGMA integrity_check").fetchone()
        if result is None or result[0] != "ok":
            raise ValueError(f"integrity_check failed: {result}")
        if not connection.execute("SELECT version_num FROM alembic_version").fetchall():
            raise ValueError("no alembic version")
    except sqlite3.DatabaseError as exc:
        raise ValueError(f"not a valid database: {exc}") from exc
    finally:
        connection.close()


def create_backup(db_path: Path, replays_dir: Path, out: BinaryIO) -> None:
    with tempfile.TemporaryDirectory(dir=db_path.parent, prefix=".backup-") as tmp:
        snapshot = Path(tmp) / DB_NAME
        source = sqlite3.connect(db_path)
        try:
            source.execute("VACUUM INTO ?", (str(snapshot),))
        finally:
            source.close()
        check_database(snapshot)
        with tarfile.open(fileobj=out, mode="w|gz") as archive:
            archive.add(snapshot, arcname=DB_NAME)
            if replays_dir.is_dir():
                archive.add(replays_dir, arcname=REPLAYS_NAME)


def restore_backup(inp: BinaryIO, db_path: Path, replays_dir: Path) -> None:
    """Replace the database and replays with the archive; the server must not be running."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=db_path.parent, prefix=".restore-") as tmp:
        staging = Path(tmp)
        with tarfile.open(fileobj=inp, mode="r|gz") as archive:
            archive.extractall(staging, filter="data")
        check_database(staging / DB_NAME)
        for suffix in ("", "-wal", "-shm"):
            db_path.with_name(db_path.name + suffix).unlink(missing_ok=True)
        (staging / DB_NAME).replace(db_path)
        if replays_dir.exists():
            shutil.rmtree(replays_dir)
        restored_replays = staging / REPLAYS_NAME
        if restored_replays.is_dir():
            restored_replays.replace(replays_dir)
        else:
            replays_dir.mkdir(parents=True)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m gow_server.backup", description=__doc__)
    parser.add_argument("action", choices=["create", "restore"])
    parser.add_argument("--replays-dir", type=Path, default=Path("data") / REPLAYS_NAME)
    args = parser.parse_args(argv)
    db_path = db_path_from_url(Settings().database_url)
    replays_dir: Path = args.replays_dir
    if args.action == "create":
        create_backup(db_path, replays_dir, sys.stdout.buffer)
    else:
        restore_backup(sys.stdin.buffer, db_path, replays_dir)
        print(f"restored {db_path} and {replays_dir}", file=sys.stderr)


if __name__ == "__main__":
    main()
