"""SRV-07: the command log of a live match, the frames file, and ``GET /api/replays/{id}``."""

import asyncio
import gzip
import json
import shutil
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final, cast

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from gow_bots.bots import BOTS
from gow_protocol import commands as wire
from gow_server.app import create_app
from gow_server.clock import ManualClock
from gow_server.db import create_db_engine, upgrade_to_head
from gow_server.frames import FORMAT, FramesError, build_frames, frame_of
from gow_server.matches import MatchManager, MatchRunner
from gow_server.models import Match, MatchPlayer
from gow_server.replays import ReplayService, ReplayState
from gow_server.settings import Settings
from gow_sim.commands import PlayerCommand
from gow_sim.maps import MapDef, load_map
from gow_sim.match import Match as SimMatch
from gow_sim.replay import ReplayWriter, read_replay, record_headless, replay_run
from gow_sim.ruleset import Ruleset, Stance, load_ruleset, ruleset_hash
from gow_sim.state import Build, BuildKind, initial_state

ROOT: Final = Path(__file__).parents[3]
RULESETS: Final = ROOT / "rulesets" / "archive"
MAPS: Final = ROOT / "maps"
DT: Final = 0.1
FRAMES_BUDGET: Final = 2 * 1024 * 1024
"""AGENTS.md, section 12: the frames file of a whole match (15 minutes, DEC-22)."""


@pytest.fixture(scope="module")
def line3() -> MapDef:
    return load_map(ROOT / "packages" / "sim" / "tests" / "maps" / "line3.json")


@pytest.fixture(scope="module")
def short_rules() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "test-short.toml")


@pytest.fixture(scope="module")
def full_rules() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "mvp-0.toml")


# The frames file --------------------------------------------------------------------------


def test_frame_has_no_road_types(line3: MapDef, full_rules: Ruleset) -> None:
    """Key ``r`` (DEC-22) is gone with the road types (DEC-26): only the levels in ``w``."""
    state = initial_state(line3, full_rules)
    state.edges[1].width = 2
    frame = frame_of(state, full_rules)
    assert frame["w"] == [1, 2] and "r" not in frame


def test_frame_builds_are_road_builds_only(line3: MapDef, full_rules: Ruleset) -> None:
    """Key ``b``: road builds by city; a barracks or warehouse build (DEC-26) is not drawn."""
    state = initial_state(line3, full_rules)
    state.nodes[0].build = Build(edge=None, owner=0, since=0, kind=BuildKind.BARRACKS)
    assert "b" not in frame_of(state, full_rules)
    state.nodes[0].build = Build(edge=0, owner=0, since=0)
    assert frame_of(state, full_rules)["b"] == [[0, 0, full_rules.build.ticks_per_level]]


def test_fifteen_minute_match_resimulates_to_the_same_result(
    tmp_path: Path, full_rules: Ruleset
) -> None:
    """A real 15-minute match (DEC-22): same hash and outcome after the re-simulation, file
    within 2 MB."""
    mapdef = load_map(MAPS / "pautina.json")
    bots = [
        BOTS["rusher"](mapdef, full_rules, seed=1, player=0),
        BOTS["reactive"](mapdef, full_rules, seed=2, player=1),
    ]
    log = tmp_path / "7.jsonl.gz"
    played = record_headless(log, mapdef, full_rules, bots)
    assert played.outcome is not None
    assert played.ticks == full_rules.match_ticks == 9000  # it went the whole 15 minutes

    result = build_frames(log, tmp_path / "7.frames.json.gz", RULESETS, MAPS)

    assert result.state_hash == played.state_hash
    assert (result.winner, result.reason) == (
        played.outcome.winner,
        played.outcome.reason.value,
    )
    assert result.ticks == played.ticks
    assert 0 < result.size <= FRAMES_BUDGET
    doc = json.loads(gzip.decompress(result.path.read_bytes()))
    assert doc["format"] == FORMAT
    assert doc["state_hash"] == played.state_hash
    assert doc["vp"] == list(played.vp)
    assert doc["map"]["meta"]["name"] == "pautina"
    ticks = [f["t"] for f in doc["frames"]]
    assert ticks == list(range(0, 9001, 5))  # 2 frames a second, tick 0 and the last tick
    assert len(doc["frames"][0]["n"]) == len(mapdef.nodes)
    # [owner, warehouse, capacity]: the capacity of the node kind (DEC-22)
    assert all(
        n[2] == full_rules.capacity.by_kind.of(m.kind)
        for n, m in zip(doc["frames"][0]["n"], mapdef.nodes, strict=True)
    )
    assert len(doc["frames"][0]["w"]) == len(mapdef.edges)
    assert any(f["g"] for f in doc["frames"])
    assert doc["events"], "events are part of the file"
    assert doc["events"][-1][1] == "match_ended"


def test_log_with_a_wrong_hash_is_refused(
    tmp_path: Path, maps_dir: Path, line3: MapDef, short_rules: Ruleset
) -> None:
    log = tmp_path / "1.jsonl.gz"
    bots = [BOTS["random_legal"](line3, short_rules, seed=s, player=s) for s in (0, 1)]
    record_headless(log, line3, short_rules, bots)
    lines = gzip.decompress(log.read_bytes()).splitlines()
    index = next(i for i, raw in enumerate(lines) if b'"tick":100' in raw)
    record = json.loads(lines[index])
    record["hash"] = "0" * len(record["hash"])
    lines[index] = json.dumps(record, separators=(",", ":")).encode()
    log.write_bytes(gzip.compress(b"\n".join(lines) + b"\n"))
    with pytest.raises(FramesError, match="diverged at tick 100"):
        build_frames(log, tmp_path / "1.frames.json.gz", RULESETS, maps_dir)
    assert not (tmp_path / "1.frames.json.gz").exists()


def test_log_of_an_unfinished_match_is_refused(
    tmp_path: Path, maps_dir: Path, line3: MapDef, short_rules: Ruleset
) -> None:
    log = tmp_path / "1.jsonl.gz"
    bots = [BOTS["idle"](line3, short_rules, seed=s, player=s) for s in (0, 1)]
    record_headless(log, line3, short_rules, bots, max_ticks=50)
    with pytest.raises(FramesError, match="no outcome"):
        build_frames(log, tmp_path / "1.frames.json.gz", RULESETS, maps_dir)


# A live match -----------------------------------------------------------------------------


@pytest.fixture
def maps_dir(tmp_path: Path, line3: MapDef) -> Path:
    directory = tmp_path / "maps"
    directory.mkdir()
    shutil.copy(ROOT / "packages" / "sim" / "tests" / "maps" / "line3.json", directory)
    return directory


@pytest.fixture
def sessions(tmp_path: Path) -> Iterator[sessionmaker[Session]]:
    engine = create_db_engine(f"sqlite:///{tmp_path / 'gow.db'}")
    upgrade_to_head(engine)
    yield sessionmaker(engine, expire_on_commit=False)
    engine.dispose()


def _service(tmp_path: Path, maps_dir: Path, sessions: sessionmaker[Session]) -> ReplayService:
    return ReplayService(tmp_path / "replays", RULESETS, maps_dir, sessions)


async def _settle() -> None:
    for _ in range(3):
        await asyncio.sleep(0)


async def _play(
    manager: MatchManager, runner: MatchRunner, clock: ManualClock, stances: bool = True
) -> None:
    seq = 0
    while manager.get(runner.match_id) is not None:
        clock.advance(DT)
        await _settle()
        if stances and runner.match.tick % 100 == 0 and not runner.finished:
            seq += 1
            stance = Stance.WAR if seq % 2 else Stance.ECONOMY
            runner.submit(0, seq, wire.SetStanceCmd(stance=stance))


def test_live_match_is_logged_and_turned_into_frames(
    tmp_path: Path,
    maps_dir: Path,
    sessions: sessionmaker[Session],
    line3: MapDef,
    short_rules: Ruleset,
) -> None:
    with sessions.begin() as session:
        session.add(Match(id=5, map_id="line3", ruleset_hash="x", rated=False))

    async def scenario() -> tuple[MatchRunner, ReplayService]:
        clock = ManualClock()
        service = _service(tmp_path, maps_dir, sessions)
        manager = MatchManager(clock, replays=service)
        runner = manager.create("line3", line3, short_rules, (101, 202), match_id="5")
        await _settle()
        await _play(manager, runner, clock)
        await service.aclose()  # waits for the re-simulation
        return runner, service

    runner, service = asyncio.run(scenario())

    # The command log: whole, with commands, and it checks out on a re-simulation.
    log = service.log_path("5")
    replay = read_replay(log)
    assert replay.final
    assert replay.checkpoints[-1].tick == short_rules.match_ticks
    assert len(replay.commands) == 5  # one stance change per 100 ticks
    assert replay_run(log, RULESETS, maps_dir).ok

    # The frames file and its path in the database.
    frames = service.replays_dir / "5.frames.json.gz"
    doc = json.loads(gzip.decompress(frames.read_bytes()))
    assert doc["state_hash"] == runner.match.state_hash()
    assert doc["ticks"] == runner.match.tick
    with sessions() as session:
        assert session.get(Match, 5).replay_path == "5.frames.json.gz"  # pyright: ignore[reportOptionalMemberAccess]


def test_match_without_a_database_row_still_gets_frames(
    tmp_path: Path,
    maps_dir: Path,
    sessions: sessionmaker[Session],
    line3: MapDef,
    short_rules: Ruleset,
) -> None:
    async def scenario() -> ReplayService:
        clock = ManualClock()
        service = _service(tmp_path, maps_dir, sessions)
        manager = MatchManager(clock, new_id=lambda: "abc_DEF-1", replays=service)
        runner = manager.create("line3", line3, short_rules, (1, 2))
        await _settle()
        await _play(manager, runner, clock, stances=False)
        await service.aclose()
        return service

    service = asyncio.run(scenario())
    assert (service.replays_dir / "abc_DEF-1.frames.json.gz").is_file()


def test_replay_is_preparing_until_the_frames_are_written(
    tmp_path: Path,
    maps_dir: Path,
    sessions: sessionmaker[Session],
    line3: MapDef,
    short_rules: Ruleset,
) -> None:
    """The root cause of #259: right after the match there is no frames file for a while, and
    that must read as "preparing", not as "does not exist"."""
    with sessions.begin() as session:
        session.add(
            Match(
                id=5,
                map_id="line3",
                ruleset_hash=ruleset_hash(short_rules),
                rated=False,
                status="running",
            )
        )
    seen: list[ReplayState] = []

    def state_now(service: ReplayService) -> ReplayState:
        with sessions() as session:
            match = session.get(Match, 5)
            assert match is not None
            return service.state(match)

    async def scenario() -> ReplayService:
        clock = ManualClock()
        service = _service(tmp_path, maps_dir, sessions)
        manager = MatchManager(clock, replays=service)
        runner = manager.create("line3", line3, short_rules, (101, 202), match_id="5")
        await _settle()
        seen.append(state_now(service))  # the match runs
        await _play(manager, runner, clock, stances=False)
        # The match is over, its row says "saved" already; the worker has not finished yet.
        with sessions.begin() as session:
            match = session.get(Match, 5)
            assert match is not None
            match.status = "saved"
        seen.append(state_now(service))
        await service.aclose()
        seen.append(state_now(service))
        return service

    service = asyncio.run(scenario())
    assert seen == [ReplayState.PREPARING, ReplayState.PREPARING, ReplayState.READY]
    assert not service._building  # pyright: ignore[reportPrivateUsage]


def test_failed_build_is_unavailable_not_preparing(
    tmp_path: Path,
    maps_dir: Path,
    sessions: sessionmaker[Session],
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A log that cannot be turned into frames: after the build ends the state is "unavailable"
    (a poller must stop), and the file never appears."""
    service = _service(tmp_path, maps_dir, sessions)
    service.replays_dir.mkdir()
    service.log_path("8").write_bytes(b"not a replay")
    saved = Match(id=8, map_id="line3", ruleset_hash="x", status="saved")

    async def scenario() -> ReplayState:
        task = service.schedule("8")
        assert service.state(saved) is ReplayState.PREPARING
        assert await task is None
        state = service.state(saved)
        await service.aclose()
        return state

    assert asyncio.run(scenario()) is ReplayState.UNAVAILABLE
    assert "replay frames failed" in caplog.text


def test_cancelled_match_keeps_a_cut_log_and_no_frames(
    tmp_path: Path,
    maps_dir: Path,
    sessions: sessionmaker[Session],
    line3: MapDef,
    short_rules: Ruleset,
) -> None:
    async def scenario() -> ReplayService:
        clock = ManualClock()
        service = _service(tmp_path, maps_dir, sessions)
        manager = MatchManager(clock, replays=service)
        runner = manager.create("line3", line3, short_rules, (1, 2), match_id="9")
        await _settle()
        for _ in range(120):
            clock.advance(DT)
            await _settle()
        assert runner.match.tick > 100
        await manager.shutdown()
        await _settle()
        await service.aclose()
        return service

    service = asyncio.run(scenario())
    replay = read_replay(service.log_path("9"))
    assert not replay.final
    assert replay.checkpoints[-1].tick >= 100  # flushed at checkpoints, readable up to there
    assert not (service.replays_dir / "9.frames.json.gz").exists()


class _FailingWriter(ReplayWriter):
    """A disk that fills up at tick 30."""

    def record(self, match: SimMatch, commands: Sequence[PlayerCommand]) -> None:
        if match.tick == 30:
            raise OSError(28, "No space left on device")
        super().record(match, commands)


def test_failing_log_does_not_stop_the_match(
    tmp_path: Path, line3: MapDef, short_rules: Ruleset, caplog: pytest.LogCaptureFixture
) -> None:
    async def scenario() -> MatchRunner:
        clock = ManualClock()
        manager = MatchManager(clock)
        runner = MatchRunner(
            "m",
            "line3",
            line3,
            short_rules,
            (1, 2),
            clock,
            replay=_FailingWriter(tmp_path / "m.gz"),
        )
        manager.start(runner)
        await _settle()
        await _play(manager, runner, clock, stances=False)
        return runner

    runner = asyncio.run(scenario())
    assert runner.finished
    assert runner.replay is None and not runner.replay_complete
    assert "replay log failed, match goes on" in caplog.text


# HTTP -------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Api:
    client: TestClient
    replays_dir: Path
    maps_dir: Path
    sessions: sessionmaker[Session]


@pytest.fixture
def api(tmp_path: Path, maps_dir: Path) -> Iterator[Api]:
    settings = Settings(
        maps_dir=maps_dir,
        database_url=f"sqlite:///{tmp_path / 'gow.db'}",
        replays_dir=tmp_path / "replays",
        rulesets_dir=RULESETS,
    )
    app = create_app(settings)
    with TestClient(app) as client:
        sessions = cast("sessionmaker[Session]", app.state.sessions)  # pyright: ignore[reportUnknownMemberType]
        yield Api(client, settings.replays_dir, maps_dir, sessions)


def _guest(api: Api, nick: str) -> tuple[int, dict[str, str]]:
    body = api.client.post("/api/guest", json={"nick": nick}).json()
    return body["player_id"], {"Authorization": f"Bearer {body['token']}"}


def _add_match(
    api: Api,
    match_id: int,
    rated: bool,
    players: tuple[int, int],
    path: str | None,
    status: str = "saved",
) -> None:
    """A ``matches`` row; with an existing frames file the row describes that file's match."""
    map_id, ruleset_hash, ticks = "line3", "x", None
    if path is not None and (api.replays_dir / path).is_file():
        head = json.loads(gzip.decompress((api.replays_dir / path).read_bytes()))
        map_id, ruleset_hash, ticks = head["map_id"], head["ruleset_hash"], head["ticks"]
    with api.sessions.begin() as session:
        session.add(
            Match(
                id=match_id,
                map_id=map_id,
                ruleset_hash=ruleset_hash,
                rated=rated,
                replay_path=path,
                status=status,
                ticks=ticks,
            )
        )
        session.flush()
        for side, player in enumerate(players):
            session.add(MatchPlayer(match_id=match_id, side=side, player_id=player))


def _frames_file(api: Api, name: str, line3: MapDef, rules: Ruleset) -> Path:
    bots = [BOTS["idle"](line3, rules, seed=s, player=s) for s in (0, 1)]
    log = api.replays_dir / "tmp.jsonl.gz"
    record_headless(log, line3, rules, bots)
    return build_frames(log, api.replays_dir / name, RULESETS, api.maps_dir).path


def test_rated_replay_is_public(api: Api, line3: MapDef, short_rules: Ruleset) -> None:
    a, _ = _guest(api, "Alice")
    b, _ = _guest(api, "Bobby")
    path = _frames_file(api, "1.frames.json.gz", line3, short_rules)
    _add_match(api, 1, True, (a, b), path.name)

    response = api.client.get("/api/replays/1")  # no token
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.headers["cache-control"].startswith("public")
    assert response.headers["content-encoding"] == "gzip"
    stored = json.loads(gzip.decompress(path.read_bytes()))
    assert response.json() == stored  # httpx unzips Content-Encoding: gzip, like a browser
    assert stored["format"] == FORMAT


def test_unrated_replay_is_for_the_participants(
    api: Api, line3: MapDef, short_rules: Ruleset
) -> None:
    a, auth_a = _guest(api, "Alice")
    b, auth_b = _guest(api, "Bobby")
    _, auth_c = _guest(api, "Carol")
    path = _frames_file(api, "2.frames.json.gz", line3, short_rules)
    _add_match(api, 2, False, (a, b), path.name)

    assert api.client.get("/api/replays/2", headers=auth_a).status_code == 200
    assert api.client.get("/api/replays/2", headers=auth_b).status_code == 200
    assert api.client.get("/api/replays/2").status_code == 401
    assert (
        api.client.get("/api/replays/2", headers={"Authorization": "Bearer nope"}).status_code
        == 401
    )
    assert api.client.get("/api/replays/2", headers=auth_c).status_code == 403
    private = api.client.get("/api/replays/2", headers=auth_a)
    assert private.headers["cache-control"].startswith("private")


def test_replay_not_found(api: Api) -> None:
    _, auth = _guest(api, "Alice")
    assert api.client.get("/api/replays/99", headers=auth).status_code == 404
    assert api.client.get("/api/replays/abc").status_code == 422


def test_replay_of_a_running_match_is_preparing(api: Api) -> None:
    """202 with ``Retry-After``: the client waits instead of reporting "not found" (#259)."""
    a, auth = _guest(api, "Alice")
    b, _ = _guest(api, "Bobby")
    _add_match(api, 3, True, (a, b), None, status="running")
    response = api.client.get("/api/replays/3", headers=auth)
    assert response.status_code == 202
    assert response.json() == {"status": "preparing"}
    assert response.headers["retry-after"] == "2"
    assert response.headers["cache-control"] == "no-store"


def test_preparing_replay_keeps_its_access_rules(api: Api) -> None:
    a, auth_a = _guest(api, "Alice")
    b, _ = _guest(api, "Bobby")
    _, auth_c = _guest(api, "Carol")
    _add_match(api, 3, False, (a, b), None, status="running")
    assert api.client.get("/api/replays/3", headers=auth_a).status_code == 202
    assert api.client.get("/api/replays/3").status_code == 401
    assert api.client.get("/api/replays/3", headers=auth_c).status_code == 403


def test_replay_that_will_never_exist_is_gone(api: Api) -> None:
    """410: the match is over and nothing builds its frames (failed build, crash, aborted)."""
    a, auth = _guest(api, "Alice")
    b, _ = _guest(api, "Bobby")
    _add_match(api, 3, True, (a, b), None, status="saved")  # the build failed or never ran
    _add_match(api, 4, True, (a, b), "4.frames.json.gz", status="saved")  # the file is gone
    _add_match(api, 5, True, (a, b), "../gow.db", status="saved")  # never leaves the folder
    _add_match(api, 6, True, (a, b), None, status="aborted")  # crashed or cut by a restart
    for match_id in (3, 4, 5, 6):
        response = api.client.get(f"/api/replays/{match_id}", headers=auth)
        assert response.status_code == 410, match_id
        assert response.headers.get("content-encoding") != "gzip"


def test_stale_file_of_an_older_database_is_not_served(
    api: Api, line3: MapDef, short_rules: Ruleset
) -> None:
    """#280: ids restart in a new database; ``{id}.frames.json.gz`` of the old one is not ours."""
    a, auth = _guest(api, "Alice")
    b, _ = _guest(api, "Bobby")
    _frames_file(api, "7.frames.json.gz", line3, short_rules)  # left by a match of an older DB
    _add_match(api, 7, False, (a, b), None, status="running")  # the new match 7 is being played
    assert api.client.get("/api/replays/7", headers=auth).status_code == 202
    _add_match(api, 8, False, (a, b), None, status="saved")  # ...a new match 8 with no build
    _frames_file(api, "8.frames.json.gz", line3, short_rules)
    assert api.client.get("/api/replays/8", headers=auth).status_code == 410


def test_starting_a_match_removes_a_stale_frames_file(
    api: Api, line3: MapDef, short_rules: Ruleset, maps_dir: Path
) -> None:
    stale = _frames_file(api, "9.frames.json.gz", line3, short_rules)
    service = ReplayService(api.replays_dir, RULESETS, maps_dir, api.sessions)
    service.writer("9")
    assert not stale.exists()


def test_file_of_another_match_in_replay_path_is_refused(
    api: Api, line3: MapDef, short_rules: Ruleset
) -> None:
    """The header of the file must agree with the row: map, ruleset and length."""
    a, auth = _guest(api, "Alice")
    b, _ = _guest(api, "Bobby")
    path = _frames_file(api, "10.frames.json.gz", line3, short_rules)
    head = json.loads(gzip.decompress(path.read_bytes()))
    _add_match(api, 10, False, (a, b), path.name)
    assert api.client.get("/api/replays/10", headers=auth).status_code == 200
    changed = {
        "map_id": ("pautina", head["ruleset_hash"], head["ticks"]),
        "ruleset_hash": (head["map_id"], "0" * 32, head["ticks"]),
        "ticks": (head["map_id"], head["ruleset_hash"], head["ticks"] + 1),
    }
    for field, (map_id, rules_hash, ticks) in changed.items():
        with api.sessions.begin() as session:
            match = session.get(Match, 10)
            assert match is not None
            match.map_id, match.ruleset_hash, match.ticks = map_id, rules_hash, ticks
        assert api.client.get("/api/replays/10", headers=auth).status_code == 410, field


def test_replay_is_revalidated_not_cached_blindly(
    api: Api, line3: MapDef, short_rules: Ruleset
) -> None:
    """#280: ``immutable, max-age`` made a browser show the old match 1 for a new match 1."""
    a, _ = _guest(api, "Alice")
    b, _ = _guest(api, "Bobby")
    path = _frames_file(api, "11.frames.json.gz", line3, short_rules)
    _add_match(api, 11, True, (a, b), path.name)

    first = api.client.get("/api/replays/11")
    assert first.status_code == 200
    cache = first.headers["cache-control"]
    assert "no-cache" in cache
    assert "max-age" not in cache
    assert "immutable" not in cache
    etag = first.headers["etag"]
    again = api.client.get("/api/replays/11", headers={"If-None-Match": etag})
    assert again.status_code == 304
    assert again.content == b""
    assert again.headers["etag"] == etag
    assert "no-cache" in again.headers["cache-control"]


def test_same_id_in_another_database_has_another_etag(
    api: Api, line3: MapDef, short_rules: Ruleset
) -> None:
    """The ETag a browser kept for match 1 of the old database does not match the new match 1,
    even when the frames file is byte for byte the same (the same bots on the same map)."""
    a, auth = _guest(api, "Alice")
    b, _ = _guest(api, "Bobby")
    path = _frames_file(api, "12.frames.json.gz", line3, short_rules)
    _add_match(api, 12, False, (a, b), path.name)
    old = api.client.get("/api/replays/12", headers=auth).headers["etag"]

    with api.sessions.begin() as session:  # the database starts over: same id, another match
        match = session.get(Match, 12)
        assert match is not None
        match.created_at = match.created_at.replace(year=match.created_at.year + 1)
    response = api.client.get("/api/replays/12", headers={**auth, "If-None-Match": old})
    assert response.status_code == 200
    assert response.headers["etag"] != old
