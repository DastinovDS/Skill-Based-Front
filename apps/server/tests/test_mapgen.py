"""A new map for every unrated private and bot match (#884): made, served, played, replayed, kept.

The work itself (generate, bake, validate, preview) runs for real once per module (``made``) and
once in a worker process (``test_a_match_ticks_on_while_a_map_is_made``); the flows of the HTTP API
use a stand-in job in a thread that copies a stored generated map, so a test decides when the map
is "made".
"""

import asyncio
import gzip
import json
import os
import re
import shutil
import threading
import time
from collections.abc import Callable, Iterator, Mapping
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Final, cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from gow_bots.bots import BOTS
from gow_maps.matchmap import files_of
from gow_maps.validate import load_config, validate_file
from gow_server.app import create_app
from gow_server.clock import ManualClock, MonotonicClock
from gow_server.db import create_db_engine, upgrade_to_head
from gow_server.frames import build_frames
from gow_server.invites import InviteBook
from gow_server.mapgen import ORPHAN_GRACE, MapMaker, MapStatus, store_dir
from gow_server.maps import MapCatalog
from gow_server.mapworker import STAGING_PREFIX, MapBuilt, MapJob, build, map_files
from gow_server.matches import MatchManager
from gow_server.models import Match
from gow_server.replay_retention import archive_log
from gow_server.replays import FRAMES_SUFFIX, LOG_SUFFIX, ReplayService
from gow_server.settings import Settings
from gow_sim.maps import PLAYERS, load_map
from gow_sim.replay import record_headless, replay_run
from gow_sim.ruleset import Ruleset, load_ruleset

ROOT: Final = Path(__file__).parents[3]
GEN: Final = ROOT / "maps" / "gen"
RULESETS: Final = ROOT / "rulesets" / "archive"
SOURCE: Final = "gen1-17"
"""The stored generated map the stand-in job copies."""
POOL: Final = {"diamond", "line3"}
"""The maps of the ``maps_dir`` fixture."""
MAP_ID: Final = "live-0123456789ab"
FAST_SEED: Final = 619581435
"""A seed whose first attempts pass under ``MAP_ID``: 31 nodes, a few seconds."""
ID_RE: Final = re.compile(r"live-[0-9a-f]{12}")


@pytest.fixture(scope="module")
def rules() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "mvp-6.toml")


@pytest.fixture(scope="module")
def made(tmp_path_factory: pytest.TempPathFactory, rules: Ruleset) -> tuple[Path, MapBuilt]:
    """One real per-match map, made by the worker function in this process."""
    folder = tmp_path_factory.mktemp("store")
    return folder, build(MapJob(MAP_ID, (FAST_SEED,), folder, rules))


# The worker ---------------------------------------------------------------------------------


def test_the_worker_makes_a_map_that_passes_the_validator(
    made: tuple[Path, MapBuilt], rules: Ruleset
) -> None:
    folder, built = made
    assert built.map_id == MAP_ID
    assert built.seed == FAST_SEED
    assert built.seeds_tried == 1
    assert built.generate_s > 0 and built.bake_s > 0 and built.validate_s > 0
    assert built.total_s >= built.generate_s + built.bake_s + built.validate_s
    files = map_files(folder, MAP_ID)
    assert all(file.is_file() for file in files)
    assert not list(folder.glob(f"{STAGING_PREFIX}*"))  # the staging folder is gone
    # Every check of `gow-maps validate`, the geography and the fairness included.
    assert validate_file(files[0], load_config(), rules) == []
    mapdef = load_map(files[0])
    assert mapdef.meta.name == MAP_ID
    assert mapdef.meta.symmetry == "none"
    vectors = json.loads((folder / "geo" / f"{MAP_ID}.json").read_text())
    assert (vectors["map"], vectors["version"]) == (MAP_ID, 1)
    assert vectors["water"], "the background has water"


def test_the_store_has_the_layout_of_the_map_tools(tmp_path: Path) -> None:
    assert map_files(tmp_path, MAP_ID) == files_of(tmp_path, MAP_ID)


def test_no_map_leaves_nothing_in_the_store(tmp_path: Path, rules: Ruleset) -> None:
    with pytest.raises(ValueError, match="no map from 0 seeds"):
        build(MapJob(MAP_ID, (), tmp_path, rules))
    assert list(tmp_path.iterdir()) == []


def test_a_match_on_a_per_match_map_replays_and_has_frames(
    made: tuple[Path, MapBuilt], tmp_path: Path
) -> None:
    """The log names the map; ``gow_sim.replay`` finds it in ``maps/`` next to the log."""
    folder, _ = made
    replays = tmp_path / "replays"
    shutil.copytree(folder, store_dir(replays))
    mapdef = load_map(store_dir(replays) / f"{MAP_ID}.json")
    rules = load_ruleset(ROOT / "rulesets" / "test-short.toml")
    bots = [BOTS["random_legal"](mapdef, rules, seed=s, player=s) for s in PLAYERS]
    log = replays / f"9{LOG_SUFFIX}"
    played = record_headless(log, mapdef, rules, bots)

    pool = ROOT / "maps"  # the server's map folder: the per-match map is not there
    assert replay_run(log, RULESETS, pool).ok
    result = build_frames(log, replays / f"9{FRAMES_SUFFIX}", RULESETS, pool)
    assert result.state_hash == played.state_hash
    doc = json.loads(gzip.decompress(result.path.read_bytes()))
    assert doc["map"]["meta"]["name"] == MAP_ID

    # The statistics archive (#525) takes the map along: the archived log replays on its own.
    match = Match(id=9, map_id=MAP_ID, ruleset_hash="h", created_at=datetime(2026, 11, 9, 12))
    archived = archive_log(log, tmp_path / "stats", match, store_dir(replays) / f"{MAP_ID}.json")
    shutil.rmtree(store_dir(replays))
    assert (archived.parent / "maps" / f"{MAP_ID}.json").is_file()
    assert replay_run(archived, RULESETS, pool).ok


def test_a_match_ticks_on_while_a_map_is_made(
    tmp_path: Path, maps_dir: Path, rules: Ruleset
) -> None:
    """The map is made in a worker process: the event loop of the matches keeps its ticks."""
    line3 = load_map(maps_dir / "line3.json")
    short = load_ruleset(ROOT / "rulesets" / "test-short.toml")

    async def scenario() -> tuple[float, int, MapStatus, str]:
        manager = MatchManager(MonotonicClock())
        maker = MapMaker(
            tmp_path / "store",
            MapCatalog.load(maps_dir),
            rules,
            wait_s=120,
            seeds=lambda: (FAST_SEED,),
        )
        runner = manager.create("line3", line3, short, (101, 202), match_id="1")
        pending = maker.request()
        assert pending is not None
        started, first = time.monotonic(), runner.match.tick
        await maker.settle(pending)
        elapsed, ticks = time.monotonic() - started, runner.match.tick - first
        await manager.shutdown()
        await maker.aclose()
        return elapsed, ticks, pending.status, pending.id

    elapsed, ticks, status, map_id = asyncio.run(scenario())
    assert status is MapStatus.READY
    assert elapsed > 1.0  # a real map: spawning the worker alone takes about a second
    # 10 ticks a second; a loop blocked by the work would show next to none. A wide margin for a
    # loaded runner: the point is "not blocked", the lag budget is test_match_load.py's.
    assert ticks >= elapsed * 10 * 0.5, (ticks, elapsed)
    assert (tmp_path / "store" / f"{map_id}.json").is_file()


# The HTTP flows, with a stand-in job ----------------------------------------------------------


class StandIn:
    """The job of a worker in a thread: waits for ``go``, then stores a copy of ``SOURCE`` under
    the id of the job (or fails)."""

    def __init__(self) -> None:
        self.go = threading.Event()
        self.fail = False
        self.calls = 0

    def __call__(self, job: MapJob) -> MapBuilt:
        self.calls += 1
        if not self.go.wait(20):
            raise TimeoutError("the test never let the map be made")
        if self.fail:
            raise ValueError("no map passed")
        data = json.loads((GEN / f"{SOURCE}.json").read_text())
        data["meta"]["name"] = job.map_id
        vectors = json.loads((GEN / "geo" / f"{SOURCE}.json").read_text())
        vectors["map"] = job.map_id
        (job.folder / "geo").mkdir(parents=True, exist_ok=True)
        (job.folder / "geo" / f"{job.map_id}.json").write_text(json.dumps(vectors))
        for suffix in (".bg.webp", ".thumb.webp"):
            shutil.copy(GEN / f"{SOURCE}{suffix}", job.folder / f"{job.map_id}{suffix}")
        (job.folder / f"{job.map_id}.json").write_text(json.dumps(data))  # the map file last
        return MapBuilt(job.map_id, job.seeds[0], 1, 1, 29, 0.1, 0.1, 0.1, 0.1, 0.4)


@pytest.fixture
def clock() -> ManualClock:
    return ManualClock()


@pytest.fixture
def stand_in() -> StandIn:
    return StandIn()


@pytest.fixture
def api(settings: Settings, clock: ManualClock, stand_in: StandIn) -> Iterator[TestClient]:
    app = create_app(settings.model_copy(update={"mapgen_enabled": True}), clock)
    with TestClient(app) as client:
        maker = MapMaker(
            store_dir(settings.replays_dir),
            app.state.maps,
            app.state.ruleset,
            max_pending=2,
            wait_s=10,
            metrics=app.state.matches.metrics,
            job=stand_in,
            executor=ThreadPoolExecutor(2),
        )
        app.state.mapmaker = maker
        app.state.invites.maker = maker
        yield client
        stand_in.go.set()  # nothing waits for the event when the app shuts down


def app_of(api: TestClient) -> FastAPI:
    return cast(FastAPI, api.app)


def guest(api: TestClient, nick: str) -> dict[str, str]:
    response = api.post("/api/guest", json={"nick": nick})
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


def until(check: Callable[[], bool], timeout_s: float = 10.0) -> None:
    deadline = time.monotonic() + timeout_s
    while not check():
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.02)


def in_thread(call: Callable[[], Any]) -> Callable[[], Any]:
    """Run ``call`` in a thread; the returned function joins it and gives its result."""
    result: list[Any] = []
    thread = threading.Thread(target=lambda: result.append(call()))
    thread.start()

    def join() -> Any:
        thread.join(20)
        assert result, "the call did not finish"
        return result[0]

    return join


def test_a_bot_match_without_a_choice_plays_a_new_map(
    api: TestClient, stand_in: StandIn, settings: Settings
) -> None:
    stand_in.go.set()
    response = api.post("/api/bot-matches", json={}, headers=guest(api, "solo"))
    assert response.status_code == 201, response.text
    map_id = response.json()["map_id"]
    assert ID_RE.fullmatch(map_id)
    assert api.get(f"/api/maps/{map_id}").json()["meta"]["name"] == map_id
    summary = api.get(f"/api/maps/{map_id}/summary").json()
    assert summary["per_match"] is True
    assert summary["generated"] is True
    for key in ("background_url", "thumb_url", "geo_url"):
        assert api.get(summary[key]).status_code == 200, key
    assert map_id not in {entry["id"] for entry in api.get("/api/maps").json()}
    assert (store_dir(settings.replays_dir) / f"{map_id}.json").is_file()


def test_the_player_is_claimed_while_the_map_is_made(api: TestClient, stand_in: StandIn) -> None:
    solo = guest(api, "solo")
    first = in_thread(lambda: api.post("/api/bot-matches", json={}, headers=solo))
    until(lambda: stand_in.calls == 1)
    assert api.post("/api/bot-matches", json={}, headers=solo).status_code == 409
    assert api.post("/api/matches", json={}, headers=solo).status_code == 409
    stand_in.go.set()
    assert first().status_code == 201


def test_a_map_that_fails_gives_a_pool_map(api: TestClient, stand_in: StandIn) -> None:
    stand_in.fail = True
    stand_in.go.set()
    response = api.post("/api/bot-matches", json={}, headers=guest(api, "solo"))
    assert response.status_code == 201, response.text
    assert response.json()["map_id"] in POOL
    manager: MatchManager = app_of(api).state.matches
    assert manager.metrics.maps_fallback == 1


def test_an_invite_waits_for_its_map_and_the_ready_timer_too(
    api: TestClient, stand_in: StandIn, clock: ManualClock, settings: Settings
) -> None:
    host, joiner = guest(api, "host"), guest(api, "joiner")
    invite = api.post("/api/matches", json={}, headers=host).json()
    code, map_id = invite["code"], invite["map_id"]
    assert ID_RE.fullmatch(map_id)
    assert invite["map_ready"] is False
    assert api.get(f"/api/maps/{map_id}").status_code == 404  # not made yet
    assert api.post(f"/api/matches/{code}/join", headers=joiner).status_code == 200

    clock.advance(settings.ready_timeout_s + 1)  # no ready timer while the map is made
    assert api.get(f"/api/matches/{code}", headers=host).status_code == 200

    stand_in.go.set()
    until(lambda: api.get(f"/api/matches/{code}", headers=host).json()["map_ready"])
    book: InviteBook = app_of(api).state.invites
    invite = book.get(code)
    assert invite is not None
    assert invite.record.deadline == clock.now() + settings.ready_timeout_s
    api.post(f"/api/matches/{code}/ready", headers=host)
    started = api.post(f"/api/matches/{code}/ready", headers=joiner).json()
    assert started["state"] == "started"
    assert started["map_id"] == map_id
    assert api.get(f"/api/maps/{map_id}").status_code == 200


def test_a_public_match_plays_a_new_map_too(api: TestClient, stand_in: StandIn) -> None:
    """The public lobby is unrated like an invite by link (#889): a new map by default."""
    host, joiner = guest(api, "host"), guest(api, "joiner")
    invite = api.post("/api/matches", json={"public": True}, headers=host).json()
    code, map_id = invite["code"], invite["map_id"]
    assert ID_RE.fullmatch(map_id)
    assert (invite["public"], invite["map_ready"]) == (True, False)
    listed = api.get("/api/lobby", headers=joiner).json()["matches"]
    assert [(entry["code"], entry["map_id"]) for entry in listed] == [(code, map_id)]
    assert api.post(f"/api/matches/{code}/join", headers=joiner).status_code == 200
    stand_in.go.set()
    until(lambda: api.get(f"/api/matches/{code}", headers=host).json()["map_ready"])
    api.post(f"/api/matches/{code}/ready", headers=host)
    started = api.post(f"/api/matches/{code}/ready", headers=joiner).json()
    assert (started["state"], started["map_id"]) == ("started", map_id)


def test_the_second_ready_waits_for_the_map(api: TestClient, stand_in: StandIn) -> None:
    host, joiner = guest(api, "host"), guest(api, "joiner")
    code = api.post("/api/matches", json={}, headers=host).json()["code"]
    api.post(f"/api/matches/{code}/join", headers=joiner)
    assert api.post(f"/api/matches/{code}/ready", headers=host).json()["state"] == "joined"
    second = in_thread(lambda: api.post(f"/api/matches/{code}/ready", headers=joiner))
    time.sleep(0.2)
    assert api.get(f"/api/matches/{code}", headers=host).json()["match_id"] is None
    stand_in.go.set()
    started = second().json()
    assert started["state"] == "started"
    assert started["map_ready"] is True


def test_an_invite_whose_map_fails_plays_a_pool_map(api: TestClient, stand_in: StandIn) -> None:
    stand_in.fail = True
    host = guest(api, "host")
    code = api.post("/api/matches", json={}, headers=host).json()["code"]
    stand_in.go.set()
    until(lambda: api.get(f"/api/matches/{code}", headers=host).json()["map_ready"])
    assert api.get(f"/api/matches/{code}", headers=host).json()["map_id"] in POOL


def test_a_dropped_invite_drops_its_map(
    api: TestClient, stand_in: StandIn, settings: Settings
) -> None:
    host = guest(api, "host")
    invite = api.post("/api/matches", json={}, headers=host).json()
    until(lambda: stand_in.calls == 1)  # a worker has it: it cannot be cancelled, only removed
    assert api.delete(f"/api/matches/{invite['code']}", headers=host).status_code == 204
    api.get("/api/lobby", headers=host)  # any call of the book purges the dropped invite
    stand_in.go.set()
    maker: MapMaker = app_of(api).state.mapmaker
    until(lambda: maker.pending == 0)
    until(lambda: not (store_dir(settings.replays_dir) / f"{invite['map_id']}.json").exists())


def test_past_the_cap_an_invite_gets_a_pool_map_at_once(api: TestClient) -> None:
    for nick in ("alpha", "bravo"):  # max_pending = 2 in the fixture
        invite = api.post("/api/matches", json={}, headers=guest(api, nick)).json()
        assert ID_RE.fullmatch(invite["map_id"])
    third = api.post("/api/matches", json={}, headers=guest(api, "charlie")).json()
    assert third["map_id"] in POOL
    assert third["map_ready"] is True


def test_the_map_choices(api: TestClient) -> None:
    def create(body: Mapping[str, object]) -> Any:
        return api.post("/api/matches", json=body, headers=guest(api, f"player{len(seen)}"))

    seen: list[int] = []
    for body, code, pool in (
        ({"public": True, "map_source": "pool"}, 201, True),
        ({"map_source": "pool"}, 201, True),
        ({"map_id": "line3", "map_source": "pool"}, 422, False),
        ({"random_generated": True, "map_source": "pool"}, 422, False),
        ({"map_id": "live-0123456789ab"}, 422, False),  # a per-match map is never chosen again
    ):
        seen.append(1)
        response = create(body)
        assert response.status_code == code, (body, response.text)
        if pool:
            assert response.json()["map_id"] in POOL


# The retention -------------------------------------------------------------------------------


@pytest.fixture
def sessions(tmp_path: Path) -> Iterator[sessionmaker[Session]]:
    engine = create_db_engine(f"sqlite:///{tmp_path / 'gow.db'}")
    upgrade_to_head(engine)
    yield sessionmaker(engine, expire_on_commit=False)
    engine.dispose()


def test_a_map_goes_with_the_replay_of_its_match(
    tmp_path: Path, maps_dir: Path, sessions: sessionmaker[Session]
) -> None:
    replays = tmp_path / "replays"
    store = store_dir(replays)
    now = datetime.now(UTC).replace(tzinfo=None)
    ids = {name: f"live-{n:012x}" for n, name in enumerate(("kept", "gone", "running", "young"))}
    ids["old"] = "live-00000000000f"
    for map_id in ids.values():
        for file in map_files(store, map_id):
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(b"x")
    staging = store / f"{STAGING_PREFIX}{ids['old']}"
    staging.mkdir()
    old = (now - ORPHAN_GRACE - timedelta(hours=1)).replace(tzinfo=UTC).timestamp()
    for path in (store / f"{ids['old']}.json", staging):
        os.utime(path, (old, old))
    (replays / f"1{FRAMES_SUFFIX}").write_bytes(b"x")  # the replay of "kept" is still there
    with sessions.begin() as session:
        session.add(Match(id=1, map_id=ids["kept"], ruleset_hash="h", status="saved"))
        session.add(Match(id=2, map_id=ids["gone"], ruleset_hash="h", status="saved"))
        session.add(Match(id=3, map_id=ids["running"], ruleset_hash="h", status="running"))
    service = ReplayService(replays, RULESETS, maps_dir, sessions)

    result = service.purge_expired(now)

    assert result.maps_removed == 2
    left = {p.stem for p in store.glob("*.json")}
    assert left == {ids["kept"], ids["running"], ids["young"]}
    assert not (store / "geo" / f"{ids['gone']}.json").exists()
    assert not staging.exists()
