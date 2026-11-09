"""Generated maps on the server (#771): an explicit choice in a private or a bot match only.

The rating and the replay of such a match: ``test_lifecycle.py`` and ``test_replays.py``.
"""

import shutil
from collections.abc import Iterator
from pathlib import Path
from typing import Final

import pytest
from fastapi import HTTPException, status
from fastapi.testclient import TestClient

from gow_server.app import create_app
from gow_server.clock import ManualClock
from gow_server.maps import MapCatalog, MapEntry, choose_map
from gow_server.settings import Settings
from gow_sim.maps import MapFormatError

ROOT: Final = Path(__file__).parents[3]
GEN: Final = ROOT / "maps" / "gen"
GENERATED: Final = "gen1-17"
"""The smallest map of the batch."""
POOL: Final = {"diamond", "line3"}
"""The two maps of the ``maps_dir`` fixture."""


@pytest.fixture
def gen_dir(maps_dir: Path) -> Path:
    directory = maps_dir / "gen"
    directory.mkdir()
    shutil.copy(GEN / f"{GENERATED}.json", directory)
    shutil.copy(GEN / f"{GENERATED}.bg.webp", directory)
    return directory


@pytest.fixture
def clock() -> ManualClock:
    return ManualClock()


@pytest.fixture
def api(settings: Settings, gen_dir: Path, clock: ManualClock) -> Iterator[TestClient]:
    with TestClient(create_app(settings, clock)) as client:
        yield client


def guest(api: TestClient, nick: str) -> dict[str, str]:
    response = api.post("/api/guest", json={"nick": nick})
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


def test_the_catalog_of_the_repository_keeps_the_batch_out_of_the_pool() -> None:
    catalog = MapCatalog.load(ROOT / "maps")
    assert [entry.id for entry in catalog.pool()] == ["crossroads", "highway", "narrows", "ridge"]
    generated = catalog.generated()
    assert [entry.id for entry in generated] == sorted(p.stem for p in GEN.glob("*.json"))
    assert len(generated) == 8
    assert all(entry.generated and entry.background is not None for entry in generated)
    assert all(entry.definition.meta.symmetry == "none" for entry in generated)
    assert catalog.get(GENERATED) is generated[0]


def test_one_id_in_both_groups_stops_the_server(maps_dir: Path) -> None:
    (maps_dir / "gen").mkdir()
    shutil.copy(maps_dir / "line3.json", maps_dir / "gen")
    with pytest.raises(MapFormatError, match="one id"):
        MapCatalog.load(maps_dir)


def test_the_list_flags_the_generated_maps_and_they_are_served(api: TestClient) -> None:
    listed = {entry["id"]: entry for entry in api.get("/api/maps").json()}
    assert {map_id for map_id, entry in listed.items() if not entry["generated"]} == POOL
    assert listed[GENERATED]["generated"] is True
    url = listed[GENERATED]["background_url"]
    assert url == f"/api/maps/{GENERATED}/background.webp"
    assert api.get(url).status_code == 200
    assert api.get(f"/api/maps/{GENERATED}").json()["meta"]["symmetry"] == "none"


def _record_choices(monkeypatch: pytest.MonkeyPatch) -> list[set[str]]:
    """What every random pick draws from: a test on the candidates, not on luck."""
    seen: list[set[str]] = []

    def first(entries: list[MapEntry]) -> MapEntry:
        seen.append({entry.id for entry in entries})
        return entries[0]

    monkeypatch.setattr("secrets.choice", first)
    return seen


def test_a_random_pick_draws_from_the_pool_only(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen = _record_choices(monkeypatch)
    alice, bob = guest(api, "alice"), guest(api, "bob")
    assert api.post("/api/matches", json={}, headers=alice).status_code == 201
    assert api.post("/api/bot-matches", json={}, headers=bob).status_code == 201
    assert seen == [POOL, POOL]


def test_the_queue_draws_from_the_pool_only(
    api: TestClient, clock: ManualClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen = _record_choices(monkeypatch)
    alice, bob = guest(api, "alice"), guest(api, "bob")
    api.post("/api/queue", headers=alice)
    api.post("/api/queue", headers=bob)
    clock.advance(1)
    assert api.get("/api/queue", headers=bob).json()["state"] == "found"
    api.post("/api/queue/confirm", headers=alice)
    started = api.post("/api/queue/confirm", headers=bob).json()
    assert started["state"] == "started"
    assert started["map_id"] in POOL
    assert seen == [POOL]


def test_an_explicit_choice_works_in_an_invite_and_against_a_bot(api: TestClient) -> None:
    alice, bob = guest(api, "alice"), guest(api, "bob")
    invite = api.post("/api/matches", json={"map_id": GENERATED}, headers=alice)
    assert invite.status_code == 201, invite.text
    assert invite.json()["map_id"] == GENERATED
    match = api.post("/api/bot-matches", json={"map_id": GENERATED}, headers=bob)
    assert match.status_code == 201, match.text
    assert match.json()["map_id"] == GENERATED


def test_random_generated_draws_from_the_generated_maps(
    api: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen = _record_choices(monkeypatch)
    alice, bob = guest(api, "alice"), guest(api, "bob")
    body = {"random_generated": True}
    assert api.post("/api/matches", json=body, headers=alice).json()["map_id"] == GENERATED
    assert api.post("/api/bot-matches", json=body, headers=bob).json()["map_id"] == GENERATED
    assert seen == [{GENERATED}, {GENERATED}]


@pytest.mark.parametrize(
    "body", [{"map_id": GENERATED}, {"random_generated": True}, {"map_source": "generated"}]
)
def test_the_public_lobby_takes_a_generated_map(api: TestClient, body: dict[str, object]) -> None:
    """A public match is unrated like an invite by link (#889): it may play a generated map."""
    alice = guest(api, "alice")
    response = api.post("/api/matches", json={**body, "public": True}, headers=alice)
    assert response.status_code == 201, response.text
    assert response.json()["map_id"] == GENERATED
    assert response.json()["public"] is True


def test_no_generated_map_to_draw_from(maps_dir: Path) -> None:
    catalog = MapCatalog.load(maps_dir)
    with pytest.raises(HTTPException) as refused:
        choose_map(catalog, None, random_generated=True)
    assert refused.value.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
