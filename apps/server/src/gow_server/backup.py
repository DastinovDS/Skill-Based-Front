"""Online backup and restore of the server data: the SQLite database and the replays directory.

``python -m gow_server.backup create > backup.tar.gz`` works while the server runs: ``VACUUM INTO``
takes a consistent snapshot of a WAL database (a read transaction, writers are not blocked).
The archive is a gzipped tar with ``gow.db`` only (SRV-08, #515): replay files never change once
written and a full copy in every archive made the backups grow with the replays. ``create
--with-replays`` also packs ``replays/`` (a one-off full archive).

The replays are copied incrementally by ``deploy/backup.sh`` into a mirror next to the archives:
``replays --since <epoch>`` streams a tar of the replay files modified since then, and
``replay-names`` lists every file that exists, so the script can drop mirror files the retention
removed.

``python -m gow_server.backup restore < backup.tar.gz`` replaces the data; the server must be
stopped (deploy/restore.sh does this). Replays come from ``replays/`` of the archive if it has
one, otherwise from the directory given by ``--replays-from`` (the mirror), otherwise none.
"""

import argparse
import shutil
import sqlite3
import sys
import tarfile
import tempfile
import time
from pathlib import Path
from typing import BinaryIO, Final

from sqlalchemy.engine import make_url

from gow_server.settings import Settings

DB_NAME = "gow.db"
REPLAYS_NAME = "replays"
REPLAY_SUFFIXES: Final = (".jsonl.gz", ".frames.json.gz")
"""Replay files (``gow_server.replays``); a ``.tmp`` of a build in progress is not one."""


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


def replay_files(replays_dir: Path) -> list[Path]:
    """The finished replay files of ``replays_dir``, sorted by name."""
    if not replays_dir.is_dir():
        return []
    return sorted(
        path
        for path in replays_dir.iterdir()
        if path.name.endswith(REPLAY_SUFFIXES) and path.is_file()
    )


def stream_replays(replays_dir: Path, since: float, out: BinaryIO) -> int:
    """Write a tar of the replay files modified at ``since`` (epoch seconds) or later; returns the
    count. Member names are file names, so ``tar -x -C <mirror>`` unpacks them flat."""
    count = 0
    with tarfile.open(fileobj=out, mode="w|") as archive:
        for path in replay_files(replays_dir):
            try:
                if path.stat().st_mtime < since:
                    continue
                archive.add(path, arcname=path.name)
            except FileNotFoundError:  # removed by the retention meanwhile
                continue
            count += 1
    return count


def create_backup(db_path: Path, replays_dir: Path | None, out: BinaryIO) -> None:
    """The database snapshot; with ``replays_dir`` also the whole directory."""
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
            if replays_dir is not None and replays_dir.is_dir():
                archive.add(replays_dir, arcname=REPLAYS_NAME)


def restore_backup(
    inp: BinaryIO, db_path: Path, replays_dir: Path, replays_from: Path | None = None
) -> None:
    """Replace the database and replays with the archive; the server must not be running.

    The replays are those in the archive, else a copy of the replay files in ``replays_from``.
    """
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
            for path in replay_files(replays_from) if replays_from is not None else ():
                shutil.copy2(path, replays_dir / path.name)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m gow_server.backup", description=__doc__)
    parser.add_argument("action", choices=["create", "restore", "replays", "replay-names"])
    parser.add_argument("--replays-dir", type=Path, default=None)
    parser.add_argument("--with-replays", action="store_true", help="create: pack replays/ too")
    parser.add_argument("--since", type=float, default=0.0, help="replays: epoch seconds")
    parser.add_argument("--replays-from", type=Path, default=None, help="restore: a mirror dir")
    args = parser.parse_args(argv)
    settings = Settings()
    replays_dir: Path = args.replays_dir or settings.replays_dir
    if args.action in ("replays", "replay-names") and not replays_dir.is_dir():
        # An empty list would make the mirror drop all its files: a wrong path must fail.
        parser.exit(1, f"no replays directory {replays_dir}\n")
    if args.action == "replay-names":
        for path in replay_files(replays_dir):
            print(path.name)
    elif args.action == "replays":
        count = stream_replays(replays_dir, args.since, sys.stdout.buffer)
        print(
            f"{count} replay files since {args.since:.0f} (now {time.time():.0f})", file=sys.stderr
        )
    elif args.action == "create":
        db_path = db_path_from_url(settings.database_url)
        create_backup(db_path, replays_dir if args.with_replays else None, sys.stdout.buffer)
    else:
        db_path = db_path_from_url(settings.database_url)
        restore_backup(sys.stdin.buffer, db_path, replays_dir, args.replays_from)
        print(f"restored {db_path} and {replays_dir}", file=sys.stderr)


if __name__ == "__main__":
    main()
