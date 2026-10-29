"""SRV-08 (#515, #525): replay retention: the cap per account, the age limits, the statistics
archive, the task and the 410 answer."""

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
from gow_server.models import Match, MatchPlayer, Player
from gow_server.replay_retention import RetentionPolicy, archive_log, run_cleanup
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

    def sides(self, match_id: int, *players: int | None) -> None:
        """The sides of a match: a player id per side, ``None`` for a bot."""
        with self.sessions.begin() as session:
            for side, player in enumerate(players):
                session.add(
                    MatchPlayer(
                        match_id=match_id,
                        side=side,
                        player_id=player,
                        bot=None if player is not None else "idle",
                    )
                )

    def player(self, nick: str, *, guest: bool = True) -> int:
        with self.sessions.begin() as session:
            row = Player(
                nick=nick,
                nick_key=nick.lower(),
                token_hash=nick.encode().ljust(32, b"-"),
                password_hash=None if guest else "scrypt$x",
            )
            session.add(row)
            session.flush()
            return row.id

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


# The cap per account (#525) ----------------------------------------------------------------


def capped(env: Env, keep: int, archive: Path | None = None) -> ReplayService:
    return ReplayService(
        env.dir,
        env.dir,
        env.dir,
        env.sessions,
        retention=RetentionPolicy(0, 0, keep_per_player=keep),
        stats_archive_dir=archive,
    )


def alive(files: list[Path]) -> bool:
    return all(file.exists() for file in files)


def test_only_the_last_n_replays_of_an_account_are_kept(env: Env) -> None:
    alice = env.player("alice", guest=False)
    matches = {i: env.add(i, age_days=10 - i) for i in range(1, 5)}  # 4 is the newest
    for i in matches:
        env.sides(i, alice, None)
    result = capped(env, 2).purge_expired(NOW)
    assert not alive(matches[1]) and not any(f.exists() for f in matches[1] + matches[2])
    assert alive(matches[3]) and alive(matches[4])
    assert result.matches_expired == 2
    assert env.row(2).replay_expired_at == NOW and env.row(3).replay_expired_at is None
    assert capped(env, 2).purge_expired(NOW).files_removed == 0  # stable


def test_a_match_is_kept_while_it_is_recent_for_either_player(env: Env) -> None:
    """Match 1 is old for Alice (two newer matches) but Bob has played only it."""
    alice, bob, carol = (env.player(n) for n in ("alice", "bob", "carol"))
    shared = env.add(1, age_days=9)
    env.sides(1, alice, bob)
    newer = [env.add(2, age_days=5), env.add(3, age_days=4)]
    env.sides(2, alice, carol)
    env.sides(3, alice, carol)
    result = capped(env, 2).purge_expired(NOW)
    assert alive(shared) and alive(newer[0]) and alive(newer[1]) and result.files_removed == 0
    # Bob plays two more: match 1 is outside both windows now.
    for i, age in ((4, 2), (5, 1)):
        env.add(i, age_days=age)
        env.sides(i, bob, carol)
    capped(env, 2).purge_expired(NOW)
    assert not any(file.exists() for file in shared)
    assert env.row(1).replay_expired_at == NOW


def test_bot_sides_do_not_count_as_an_account(env: Env) -> None:
    """The bot is in match 1 alone: if its side were a window of its own, match 1 would stay."""
    alice, carol = env.player("alice"), env.player("carol")
    vs_bot = env.add(1, age_days=9)
    env.sides(1, alice, None)
    fresh = [env.add(i, age_days=9 - i) for i in (2, 3)]
    for i in (2, 3):
        env.sides(i, alice, carol)
    capped(env, 2).purge_expired(NOW)
    assert not any(file.exists() for file in vs_bot) and alive(fresh[0]) and alive(fresh[1])
    kept = capped(env, 5)  # but with room, a match against a bot is kept like any other
    env.add(4, age_days=0)
    env.sides(4, alice, None)
    assert alive([env.dir / f"4{LOG_SUFFIX}"]) and kept.purge_expired(NOW).files_removed == 0


def test_rated_and_unrated_follow_the_same_cap(env: Env) -> None:
    alice = env.player("alice", guest=False)
    rated_old = env.add(1, age_days=9, rated=True)
    rated_new = env.add(3, age_days=1, rated=True)
    unrated = env.add(2, age_days=5)
    for i in (1, 2, 3):
        env.sides(i, alice, None)
    capped(env, 2).purge_expired(NOW)
    assert not any(file.exists() for file in rated_old)
    assert alive(unrated) and alive(rated_new)


def test_aborted_and_running_matches_do_not_take_a_place_in_the_window(env: Env) -> None:
    alice = env.player("alice")
    kept = env.add(1, age_days=9)
    env.sides(1, alice, None)
    for i, state in ((2, "aborted"), (3, "aborted")):
        env.add(i, age_days=9 - i, status=state, frames=False)
        env.sides(i, alice, None)
    live = env.add(4, age_days=0, status="running")
    env.sides(4, alice, None)
    capped(env, 1).purge_expired(NOW)
    assert alive(kept) and alive(live)  # the finished match is Alice's only one
    assert not (env.dir / f"2{LOG_SUFFIX}").exists()  # the log of an aborted match goes


def test_cap_zero_keeps_everything_and_cap_adds_to_the_age_limit(env: Env) -> None:
    alice = env.player("alice")
    old = env.add(1, age_days=40)
    recent = env.add(2, age_days=1)
    env.sides(1, alice, None)
    env.sides(2, alice, None)
    off = ReplayService(env.dir, env.dir, env.dir, env.sessions, retention=RetentionPolicy(0, 0, 0))
    off.purge_expired(NOW)
    assert alive(old) and alive(recent)
    both = ReplayService(
        env.dir, env.dir, env.dir, env.sessions, retention=RetentionPolicy(30, 0, 5)
    )
    both.purge_expired(NOW)  # inside the cap but past the age limit
    assert not any(file.exists() for file in old) and alive(recent)


def test_default_age_limits_are_off_and_the_cap_is_five() -> None:
    settings = Settings()
    assert (settings.replay_retention_days, settings.replay_rated_retention_days) == (0, 0)
    assert settings.replay_keep_per_player == 5 and settings.replay_stats_archive_dir is None


def test_archive_dir_must_not_be_the_replays_dir(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="ARCHIVE_DIR"):
        Settings(replays_dir=tmp_path, replay_stats_archive_dir=tmp_path)


# The statistics archive ---------------------------------------------------------------------


def test_the_command_log_is_archived_before_the_replay_expires(env: Env, tmp_path: Path) -> None:
    alice = env.player("alice")
    archive = tmp_path / "stats"
    old = env.add(1, age_days=9)
    new = env.add(2, age_days=1)
    for i in (1, 2):
        env.sides(i, alice, None)
    old[0].write_bytes(b"log-of-1")
    result = capped(env, 1, archive).purge_expired(NOW)
    created = env.row(1).created_at
    copied = archive / f"{created:%Y-%m-%d}" / f"1-{created:%Y%m%dT%H%M%S}.jsonl.gz"
    assert copied.read_bytes() == b"log-of-1" and result.archived == 1
    assert sorted(p.name for p in archive.rglob("*") if p.is_file()) == [copied.name]  # no frames
    assert not any(file.exists() for file in old) and alive(new)  # the replay itself is gone
    assert env.row(1).replay_expired_at == NOW


def test_archive_off_by_default_writes_nothing(env: Env, tmp_path: Path) -> None:
    alice = env.player("alice")
    env.add(1, age_days=9)
    env.add(2, age_days=1)
    env.sides(1, alice, None)
    env.sides(2, alice, None)
    result = capped(env, 1).purge_expired(NOW)
    assert result.archived == 0 and result.matches_expired == 1
    assert list(tmp_path.glob("stats*")) == []


def test_archiving_twice_is_idempotent_and_leaves_no_tmp(env: Env, tmp_path: Path) -> None:
    archive = tmp_path / "stats"
    row = env.add(1, age_days=9)
    row[0].write_bytes(b"first")
    with env.sessions() as session:
        match = session.get(Match, 1)
        assert match is not None
        first = archive_log(row[0], archive, match)
        row[0].write_bytes(b"second")  # a rerun must not rewrite what is archived
        assert archive_log(row[0], archive, match) == first
    assert first.read_bytes() == b"first"
    assert [p.name for p in archive.rglob("*") if p.is_file()] == [first.name]


def test_the_archive_is_never_cleaned_and_survives_a_second_pass(env: Env, tmp_path: Path) -> None:
    alice = env.player("alice")
    archive = tmp_path / "stats"
    for i, age in ((1, 9), (2, 1)):
        env.add(i, age_days=age)
        env.sides(i, alice, None)
    service = capped(env, 1, archive)
    service.purge_expired(NOW)
    service.purge_expired(NOW + timedelta(days=3650))
    assert len([p for p in archive.rglob("*.jsonl.gz")]) == 1


def test_a_failed_copy_keeps_the_replay_for_the_next_pass(env: Env, tmp_path: Path) -> None:
    alice = env.player("alice")
    blocked = tmp_path / "stats"
    blocked.write_bytes(b"a file where the directory should be")
    old = env.add(1, age_days=9)
    env.add(2, age_days=1)
    env.sides(1, alice, None)
    env.sides(2, alice, None)
    result = capped(env, 1, blocked).purge_expired(NOW)
    assert alive(old) and result.matches_expired == 0 and result.archived == 0
    assert env.row(1).replay_expired_at is None
    blocked.unlink()
    assert capped(env, 1, blocked).purge_expired(NOW).archived == 1
    assert not any(file.exists() for file in old)


def test_age_expiry_archives_too_and_orphans_do_not(env: Env, tmp_path: Path) -> None:
    archive = tmp_path / "stats"
    env.add(1, age_days=40)
    orphan = env.dir / f"90{LOG_SUFFIX}"
    orphan.write_bytes(b"x")
    stamp = (NOW - timedelta(days=40)).replace(tzinfo=UTC).timestamp()
    os.utime(orphan, (stamp, stamp))
    service = ReplayService(
        env.dir, env.dir, env.dir, env.sessions, retention=POLICY, stats_archive_dir=archive
    )
    result = service.purge_expired(NOW)
    assert result.archived == 1 and result.orphans_removed == 1
    assert len(list(archive.rglob("*.jsonl.gz"))) == 1


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
