"""SRV-08 (#515): replay retention: what is removed, what is kept, the task and the 410 answer."""

import asyncio
import os
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Final, cast

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from gow_server.app import create_app
from gow_server.clock import WALL_EPOCH, ManualClock
from gow_server.db import create_db_engine, upgrade_to_head
from gow_server.models import Match, MatchPlayer
from gow_server.replay_retention import RetentionPolicy, run_cleanup
from gow_server.replays import FRAMES_SUFFIX, LOG_SUFFIX, ReplayService
from gow_server.settings import Settings

NOW: Final = WALL_EPOCH + timedelta(days=100)
POLICY: Final = RetentionPolicy(unrated_days=30, rated_days=0)


@dataclass(frozen=True)
class Env:
    service: ReplayService
    sessions: sessionmaker[Session]
    dir: Path

    def add(
        self,
        match_id: int,
        *,
        age_days: float,
        rated: bool = False,
        status: str = "saved",
        frames: bool = True,
        log: bool = True,
    ) -> list[Path]:
        """A finished match that ended ``age_days`` before ``NOW`` with its replay files."""
        files: list[Path] = []
        if log:
            files.append(self.dir / f"{match_id}{LOG_SUFFIX}")
        if frames:
            files.append(self.dir / f"{match_id}{FRAMES_SUFFIX}")
        for file in files:
            file.write_bytes(b"x" * 100)
        with self.sessions.begin() as session:
            session.add(
                Match(
                    id=match_id,
                    map_id="m",
                    ruleset_hash="h",
                    rated=rated,
                    status=status,
                    created_at=NOW - timedelta(days=age_days, minutes=10),
                    ended_at=NOW - timedelta(days=age_days),
                    replay_path=f"{match_id}{FRAMES_SUFFIX}" if frames else None,
                )
            )
        return files

    def row(self, match_id: int) -> Match:
        with self.sessions() as session:
            match = session.get(Match, match_id)
            assert match is not None
            return match


@pytest.fixture
def env(tmp_path: Path) -> Iterator[Env]:
    engine = create_db_engine(f"sqlite:///{tmp_path / 'gow.db'}")
    upgrade_to_head(engine)
    sessions = sessionmaker(engine, expire_on_commit=False)
    replays = tmp_path / "replays"
    replays.mkdir()
    service = ReplayService(replays, tmp_path, tmp_path, sessions, retention=POLICY)
    yield Env(service, sessions, replays)
    engine.dispose()


def test_unrated_replay_past_the_retention_is_removed_and_marked(env: Env) -> None:
    old = env.add(1, age_days=31)
    result = env.service.purge_expired(NOW)
    assert not any(file.exists() for file in old)
    assert result.files_removed == 2 and result.bytes_removed == 200 and result.matches_expired == 1
    row = env.row(1)
    assert row.replay_path is None and row.replay_expired_at == NOW
    assert row.status == "saved" and row.ended_at is not None  # the match itself stays


def test_replay_inside_the_retention_is_kept(env: Env) -> None:
    fresh = env.add(1, age_days=29)
    exact = env.add(2, age_days=30)  # the day it expires: due at NOW, removed
    result = env.service.purge_expired(NOW)
    assert all(file.exists() for file in fresh)
    assert not any(file.exists() for file in exact)
    assert result.matches_expired == 1 and result.bytes_kept == 200
    assert env.row(1).replay_expired_at is None


def test_rated_replays_are_kept_by_default_and_expire_with_their_own_limit(env: Env) -> None:
    rated = env.add(1, age_days=400, rated=True)
    env.service.purge_expired(NOW)
    assert all(file.exists() for file in rated)  # rated_days=0: forever

    limited = ReplayService(
        env.dir, env.dir, env.dir, env.sessions, retention=RetentionPolicy(30, 365)
    )
    env.add(2, age_days=364, rated=True)
    limited.purge_expired(NOW)
    assert all(file.exists() for file in rated) is False
    assert (env.dir / f"2{FRAMES_SUFFIX}").exists()
    assert env.row(1).replay_expired_at == NOW and env.row(2).replay_expired_at is None


def test_zero_days_keeps_unrated_replays_forever(env: Env) -> None:
    keep_all = RetentionPolicy(0, 0)
    forever = ReplayService(env.dir, env.dir, env.dir, env.sessions, retention=keep_all)
    files = env.add(1, age_days=5000)
    result = forever.purge_expired(NOW)
    assert all(file.exists() for file in files) and result.files_removed == 0


def test_running_and_building_matches_are_not_touched(env: Env) -> None:
    running = env.add(1, age_days=90, status="running")
    building = env.add(2, age_days=90, frames=False)
    env.service._building.add("2")  # pyright: ignore[reportPrivateUsage]
    env.service.purge_expired(NOW)
    assert all(file.exists() for file in running + building)
    env.service._building.discard("2")  # pyright: ignore[reportPrivateUsage]
    env.service.purge_expired(NOW)
    assert not any(file.exists() for file in building)


def test_log_without_frames_goes_without_an_expired_mark(env: Env) -> None:
    """A failed build leaves a log and no ``replay_path``: the log is removed, nothing to mark."""
    files = env.add(1, age_days=40, frames=False)
    result = env.service.purge_expired(NOW)
    assert not files[0].exists() and result.matches_expired == 0
    assert env.row(1).replay_expired_at is None


def test_files_of_no_match_are_removed_when_old(env: Env) -> None:
    """A reset database leaves files under ids that now mean nothing (#280); so does a ``.tmp``."""
    stale = env.dir / f"77{FRAMES_SUFFIX}"
    fresh = env.dir / f"78{LOG_SUFFIX}"
    tmp = env.dir / f"79{FRAMES_SUFFIX}.tmp"
    other = env.dir / "notes.txt"
    for file in (stale, fresh, tmp, other):
        file.write_bytes(b"x")
    old = (NOW - timedelta(days=40)).replace(tzinfo=UTC).timestamp()
    recent = (NOW - timedelta(days=1)).replace(tzinfo=UTC).timestamp()
    for file, stamp in ((stale, old), (tmp, old), (fresh, recent), (other, old)):
        os.utime(file, (stamp, stamp))
    result = env.service.purge_expired(NOW)
    assert not stale.exists() and not tmp.exists()
    assert fresh.exists() and other.exists()
    assert result.orphans_removed == 2


def test_missing_replays_dir_is_fine(env: Env, tmp_path: Path) -> None:
    service = ReplayService(
        tmp_path / "nowhere", tmp_path, tmp_path, env.sessions, retention=POLICY
    )
    assert service.purge_expired(NOW).files_removed == 0


def test_cleanup_task_purges_at_start_and_then_every_interval(env: Env) -> None:
    clock = ManualClock()  # wall() is WALL_EPOCH; NOW is 100 days later
    clock.advance(100 * 86400)
    first = env.add(1, age_days=31)

    async def wait_for(condition: Callable[[], bool]) -> None:
        for _ in range(500):
            if condition():
                return
            await asyncio.sleep(0.01)
        raise AssertionError("timed out")

    async def scenario() -> None:
        task = asyncio.create_task(run_cleanup(env.service, clock, 3600))
        await wait_for(lambda: not first[0].exists())
        later = env.add(2, age_days=31)  # added after the start-up pass
        await asyncio.sleep(0.1)
        assert all(file.exists() for file in later)  # nothing runs before the interval
        clock.advance(3600)
        await wait_for(lambda: not later[0].exists())
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    asyncio.run(scenario())


# The answer of the endpoint ----------------------------------------------------------------


def test_expired_replay_is_gone_with_a_reason(tmp_path: Path) -> None:
    settings = Settings(
        maps_dir=Path(__file__).parents[3] / "maps" / "fixtures",
        database_url=f"sqlite:///{tmp_path / 'gow.db'}",
        replays_dir=tmp_path / "replays",
        rulesets_dir=Path(__file__).parents[3] / "rulesets" / "archive",
        replay_retention_days=7,
    )
    app = create_app(settings, clock=ManualClock())
    with TestClient(app) as client:
        sessions = cast("sessionmaker[Session]", app.state.sessions)  # pyright: ignore[reportUnknownMemberType]
        body = client.post("/api/guest", json={"nick": "Alice"}).json()
        auth = {"Authorization": f"Bearer {body['token']}"}
        env = Env(cast("ReplayService", app.state.replays), sessions, settings.replays_dir)  # pyright: ignore[reportUnknownMemberType]
        env.dir.mkdir(exist_ok=True)
        env.add(5, age_days=10)
        with sessions.begin() as session:
            session.add(MatchPlayer(match_id=5, side=0, player_id=body["player_id"]))
            session.add(MatchPlayer(match_id=5, side=1, bot="idle"))

        before = client.get("/api/replays/5", headers=auth)
        assert before.status_code == 410  # the row has no file on disk
        assert before.json()["reason"] == "unavailable"

        env.service.purge_expired(datetime(2026, 1, 1) + timedelta(days=100))
        after = client.get("/api/replays/5", headers=auth)
        assert after.status_code == 410
        assert after.json() == {"detail": "replay has expired", "reason": "expired"}
        assert client.get("/api/replays/5").status_code == 401  # the access rules still apply
