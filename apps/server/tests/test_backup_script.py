"""``deploy/backup.sh`` on a temp directory (SRV-08, #515): the container call is replaced by
``BACKUP_CMD``, so neither Docker nor the owner's stack is involved."""

import os
import shutil
import subprocess
import sys
import tarfile
import time
from pathlib import Path
from typing import Final

import pytest

from gow_server.db import create_db_engine, upgrade_to_head

ROOT: Final = Path(__file__).parents[3]
SCRIPTS: Final = ROOT / "deploy"

pytestmark = pytest.mark.skipif(
    shutil.which("bash") is None or shutil.which("tar") is None or shutil.which("comm") is None,
    reason="needs bash, tar and comm",
)


def run_backup(tmp_path: Path, label: str = "nightly") -> subprocess.CompletedProcess[str]:
    env = {
        **os.environ,
        "BACKUP_CMD": f"{sys.executable} -m gow_server.backup",
        "BACKUP_DIR": str(tmp_path / "backups"),
        "GOW_DATABASE_URL": f"sqlite:///{tmp_path / 'gow.db'}",
        "GOW_REPLAYS_DIR": str(tmp_path / "replays"),
    }
    return subprocess.run(
        ["bash", str(SCRIPTS / "backup.sh"), label],
        cwd=tmp_path,  # no .env here
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )


def write(path: Path, content: bytes, age_s: float = 0) -> None:
    path.write_bytes(content)
    stamp = time.time() - age_s
    os.utime(path, (stamp, stamp))


def test_replays_are_mirrored_incrementally_and_pruned(tmp_path: Path) -> None:
    engine = create_db_engine(f"sqlite:///{tmp_path / 'gow.db'}")
    upgrade_to_head(engine)
    engine.dispose()
    replays = tmp_path / "replays"
    replays.mkdir()
    mirror = tmp_path / "backups" / "replays"
    write(replays / "1.jsonl.gz", b"log-1", age_s=5000)
    write(replays / "1.frames.json.gz", b"frames-1", age_s=5000)

    # First run: everything is copied, the archive holds the database only.
    first = run_backup(tmp_path)
    assert (mirror / "1.jsonl.gz").read_bytes() == b"log-1"
    assert (mirror / "1.frames.json.gz").read_bytes() == b"frames-1"
    archives = sorted((tmp_path / "backups").glob("gow-*-nightly.tar.gz"))
    assert len(archives) == 1
    with tarfile.open(archives[0]) as tar:
        assert tar.getnames() == ["gow.db"]
    assert "2 files" in first.stdout

    # Second run: a new file arrives, an old one is expired by the retention, an unchanged one is
    # not read again (its mirror copy is marked to prove that).
    (mirror / "1.jsonl.gz").write_bytes(b"MARKED")
    write(replays / "2.frames.json.gz", b"frames-2")
    (replays / "1.frames.json.gz").unlink()
    run_backup(tmp_path)
    assert (mirror / "2.frames.json.gz").read_bytes() == b"frames-2"
    assert (mirror / "1.jsonl.gz").read_bytes() == b"MARKED"
    assert not (mirror / "1.frames.json.gz").exists()
    assert sorted(
        path.name for path in mirror.iterdir() if path.is_file() and path.name != ".last-sync"
    ) == [
        "1.jsonl.gz",
        "2.frames.json.gz",
    ]


def test_a_missing_replays_directory_does_not_wipe_the_mirror(tmp_path: Path) -> None:
    engine = create_db_engine(f"sqlite:///{tmp_path / 'gow.db'}")
    upgrade_to_head(engine)
    engine.dispose()
    mirror = tmp_path / "backups" / "replays"
    mirror.mkdir(parents=True)
    (mirror / "1.jsonl.gz").write_bytes(b"keep")
    with pytest.raises(subprocess.CalledProcessError):
        run_backup(tmp_path)
    assert (mirror / "1.jsonl.gz").read_bytes() == b"keep"


def test_scripts_parse() -> None:
    for name in ("backup.sh", "restore.sh"):
        subprocess.run(["bash", "-n", str(SCRIPTS / name)], check=True)
