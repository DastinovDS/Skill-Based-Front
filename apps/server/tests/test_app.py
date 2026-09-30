"""SRV-01: health, request id, structured logs and the map endpoints over HTTP."""

import io
import json
import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from gow_server.app import create_app
from gow_server.logs import JsonFormatter, request_id_var
from gow_server.settings import Settings
from gow_sim.maps import MapFormatError

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


def test_health(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_request_id_is_generated_and_echoed(client: TestClient) -> None:
    generated = client.get("/api/health").headers["X-Request-ID"]
    assert len(generated) == 32
    assert client.get("/api/health", headers={"X-Request-ID": "abc-1"}).headers["X-Request-ID"] == (
        "abc-1"
    )
    # A value that does not look like a request id is replaced, not copied into the logs.
    replaced = client.get("/api/health", headers={"X-Request-ID": "a b\nc"})
    assert replaced.headers["X-Request-ID"] != "a b\nc"


def test_access_log_has_request_id_and_no_query(client: TestClient, json_logs: io.StringIO) -> None:
    client.get("/api/health?secret=hunter2", headers={"X-Request-ID": "req-42"})
    entries = [json.loads(line) for line in json_logs.getvalue().splitlines()]
    access = [e for e in entries if e["logger"] == "gow_server.access"]
    assert len(access) == 1
    assert access[0]["request_id"] == "req-42"
    assert access[0]["path"] == "/api/health"
    assert access[0]["status"] == 200
    assert "hunter2" not in json_logs.getvalue()


def test_json_formatter_outside_request() -> None:
    assert request_id_var.get() is None
    record = logging.LogRecord("x", logging.WARNING, __file__, 1, "hello %s", ("world",), None)
    record.match_id = 7
    entry = json.loads(JsonFormatter().format(record))
    assert entry["msg"] == "hello world"
    assert entry["level"] == "WARNING"
    assert entry["match_id"] == 7
    assert "request_id" not in entry


def test_list_maps(client: TestClient) -> None:
    response = client.get("/api/maps")
    assert response.status_code == 200
    assert response.json() == [
        {"id": "diamond", "version": 1, "width": 400, "height": 400, "background_url": None},
        {"id": "line3", "version": 1, "width": 400, "height": 200, "background_url": None},
    ]


def test_get_map_returns_the_file(client: TestClient, maps_dir: Path) -> None:
    response = client.get("/api/maps/line3")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.json() == json.loads((maps_dir / "line3.json").read_text(encoding="utf-8"))


def test_unknown_map_is_404(client: TestClient) -> None:
    assert client.get("/api/maps/nope").status_code == 404
    assert client.get("/api/maps/nope/background.png").status_code == 404


def test_map_without_background_is_404(client: TestClient) -> None:
    assert client.get("/api/maps/line3/background.png").status_code == 404


def test_background_png(maps_dir: Path, settings: Settings) -> None:
    (maps_dir / "line3.bg.png").write_bytes(PNG_BYTES)
    with TestClient(create_app(settings)) as client:
        listed = {m["id"]: m for m in client.get("/api/maps").json()}
        assert listed["line3"]["background_url"] == "/api/maps/line3/background.png"
        response = client.get("/api/maps/line3/background.png")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content == PNG_BYTES


def test_file_name_must_match_map_id(maps_dir: Path, settings: Settings) -> None:
    (maps_dir / "line3.json").rename(maps_dir / "other.json")
    with pytest.raises(MapFormatError, match="file name"), TestClient(create_app(settings)):
        pass


def test_broken_map_stops_startup(maps_dir: Path, settings: Settings) -> None:
    (maps_dir / "broken.json").write_text("{", encoding="utf-8")
    with pytest.raises(MapFormatError, match=r"broken\.json"), TestClient(create_app(settings)):
        pass
