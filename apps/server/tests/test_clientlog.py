"""#810: client diagnostics in the server log (`POST /api/client-log`, `gow_server.clientlog`)."""

import io
import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from gow_server import clientlog
from gow_server.app import create_app
from gow_server.settings import Settings

UA = "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0"


def guest(api: TestClient, nick: str = "Tester") -> tuple[str, int]:
    response = api.post("/api/guest", json={"nick": nick})
    assert response.status_code == 201, response.text
    body = response.json()
    return body["token"], body["player_id"]


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "User-Agent": UA}


def report(**fields: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "reason": "batch",
        "match_id": "42",
        "tick": 1234,
        "client_version": "p51",
        "entries": [
            {"kind": "error", "msg": "[client] uncaught error: TypeError: x", "t_ms": 5000},
            {"kind": "stall", "msg": "long frame", "ms": 640, "count": 3, "t_ms": 6000},
        ],
    }
    body.update(fields)
    return body


def client_lines(stream: io.StringIO) -> list[dict[str, Any]]:
    records = [json.loads(line) for line in stream.getvalue().splitlines()]
    return [record for record in records if record["logger"] == "gow_server.client"]


@pytest.fixture
def make_client(settings: Settings) -> Iterator[Any]:
    clients: list[TestClient] = []

    def make(**overrides: Any) -> TestClient:
        api = TestClient(create_app(settings.model_copy(update=overrides)))
        api.__enter__()
        clients.append(api)
        return api

    yield make
    for api in clients:
        api.__exit__(None, None, None)


def test_a_report_is_one_line_with_the_player_match_tick_version_and_agent(
    client: TestClient, json_logs: io.StringIO
) -> None:
    token, player_id = guest(client)
    response = client.post("/api/client-log", json=report(), headers=bearer(token))
    assert response.status_code == 204, response.text
    (line,) = client_lines(json_logs)
    assert line["level"] == "WARNING"
    assert line["msg"] == "client report"
    assert line["reason"] == "batch"
    assert line["player_id"] == player_id
    assert line["match_id"] == "42"
    assert line["tick"] == 1234
    assert line["client_version"] == "p51"
    assert line["user_agent"] == UA
    assert "request_id" in line
    assert line["entries"] == [
        {"kind": "error", "msg": "[client] uncaught error: TypeError: x", "t_ms": 5000},
        {"kind": "stall", "msg": "long frame", "ms": 640, "count": 3, "t_ms": 6000},
    ]
    assert "seconds" not in line


def test_a_mark_carries_its_timeline(client: TestClient, json_logs: io.StringIO) -> None:
    token, _ = guest(client)
    seconds = [{"frames": 60, "frame_max_ms": 17, "snapshots": 10, "hidden": False}] * 59 + [
        {"frames": 2, "frame_max_ms": 900, "snapshots": 0, "hidden": False}
    ]
    response = client.post(
        "/api/client-log", json=report(reason="mark", seconds=seconds), headers=bearer(token)
    )
    assert response.status_code == 204, response.text
    (line,) = client_lines(json_logs)
    assert line["msg"] == "client mark"
    assert line["seconds"] == seconds


def test_no_token_reaches_any_log_line(client: TestClient, json_logs: io.StringIO) -> None:
    token, _ = guest(client)
    other, _ = guest(client, "Other")
    body = report(
        entries=[
            {"kind": "error", "msg": f"failed at /ws?token={other}", "t_ms": 1},
            {"kind": "warn", "msg": f"Bearer {token}", "t_ms": 2},
        ]
    )
    headers = {**bearer(token), "User-Agent": f"Agent/{other}"}
    assert client.post("/api/client-log", json=body, headers=headers).status_code == 204
    logged = json_logs.getvalue()
    assert client_lines(json_logs)
    assert token not in logged
    assert other not in logged
    (line,) = client_lines(json_logs)
    assert line["entries"][0]["msg"] == "failed at /ws?token=[cut]"
    assert line["user_agent"] == "Agent/[cut]"


def test_a_report_needs_a_known_token(client: TestClient) -> None:
    assert client.post("/api/client-log", json=report()).status_code == 401
    headers = {"Authorization": "Bearer not-a-token"}
    assert client.post("/api/client-log", json=report(), headers=headers).status_code == 401


def test_reports_are_limited_per_player(make_client: Any) -> None:
    api: TestClient = make_client(client_log_rate_limit=2, client_log_rate_window_s=60)
    token, _ = guest(api)
    other, _ = guest(api, "Other")
    for _ in range(2):
        assert api.post("/api/client-log", json=report(), headers=bearer(token)).status_code == 204
    refused = api.post("/api/client-log", json=report(), headers=bearer(token))
    assert refused.status_code == 429
    assert int(refused.headers["Retry-After"]) > 0
    # Another player has a limit of their own.
    assert api.post("/api/client-log", json=report(), headers=bearer(other)).status_code == 204


@pytest.mark.parametrize(
    "fields",
    [
        {"entries": [{"kind": "error", "msg": "x" * 301, "t_ms": 1}]},
        {"entries": [{"kind": "error", "msg": "x", "t_ms": 1}] * 51},
        {"seconds": [{"frames": 1, "frame_max_ms": 1, "snapshots": 1, "hidden": False}] * 61},
        {"entries": [{"kind": "debug", "msg": "x", "t_ms": 1}]},
        {"entries": [{"kind": "error", "msg": "x", "t_ms": 1, "stack": "at f"}]},
        {"match_id": "../../etc"},
        {"client_version": "v" * 33},
        {"url": "https://example.test/?token=secret"},
    ],
)
def test_oversized_or_unknown_fields_are_refused(
    client: TestClient, json_logs: io.StringIO, fields: dict[str, Any]
) -> None:
    token, _ = guest(client)
    response = client.post("/api/client-log", json=report(**fields), headers=bearer(token))
    assert response.status_code == 422
    # The 422 says where and why, never what was sent.
    assert "secret" not in response.text
    assert "x" * 50 not in response.text
    assert client_lines(json_logs) == []


def test_a_body_over_the_request_limit_is_413(client: TestClient) -> None:
    token, _ = guest(client)
    padding = {"kind": "error", "msg": "x" * 300, "t_ms": 1}
    huge = report(entries=[padding] * 50, seconds=[], dropped=0)
    huge["client_version"] = "p51"
    body = json.dumps(huge) + " " * 40_000
    response = client.post(
        "/api/client-log",
        content=body,
        headers={**bearer(token), "Content-Type": "application/json"},
    )
    assert response.status_code == 413


def test_the_largest_valid_report_fits_the_request_limit(client: TestClient) -> None:
    token, _ = guest(client)
    entry = {
        "kind": "ws_close",
        "msg": "y" * 300,
        "count": 999_999,
        "ms": 86_400_000,
        "hidden": True,
        "t_ms": 2**40,
        "tick": 2**31,
    }
    second = {"frames": 10_000, "frame_max_ms": 86_400_000, "snapshots": 10_000, "hidden": True}
    body = report(reason="mark", entries=[entry] * 50, seconds=[second] * 60, dropped=1_000_000)
    body["match_id"] = "9" * 64
    body["client_version"] = "v" * 32
    assert len(json.dumps(body)) < Settings().max_request_body_bytes
    response = client.post("/api/client-log", json=body, headers=bearer(token))
    assert response.status_code == 204, response.text


def test_the_file_log_keeps_the_reports_and_prints_one_match(
    make_client: Any, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    directory = tmp_path / "client-logs"
    api: TestClient = make_client(client_log_dir=directory)
    token, player_id = guest(api)
    for match_id in ("42", "43", "42"):
        response = api.post(
            "/api/client-log", json=report(match_id=match_id), headers=bearer(token)
        )
        assert response.status_code == 204
    lines = (directory / clientlog.LOG_FILE).read_text().splitlines()
    assert [json.loads(line)["match_id"] for line in lines] == ["42", "43", "42"]
    assert json.loads(lines[0])["player_id"] == player_id

    assert clientlog.main(["42", "--dir", str(directory)]) == 0
    printed = capsys.readouterr().out.splitlines()
    assert printed == [lines[0], lines[2]]


def test_the_file_log_rotates_by_size(make_client: Any, tmp_path: Path) -> None:
    directory = tmp_path / "client-logs"
    api: TestClient = make_client(
        client_log_dir=directory,
        client_log_max_bytes=2000,
        client_log_files=2,
        client_log_rate_limit=100,
    )
    token, _ = guest(api)
    for tick in range(30):
        body = report(tick=tick)
        assert api.post("/api/client-log", json=body, headers=bearer(token)).status_code == 204
    files = clientlog.log_files(directory)
    assert [path.name for path in files] == ["client.jsonl.2", "client.jsonl.1", "client.jsonl"]
    assert all(path.stat().st_size <= 2000 for path in files)
    ticks = [json.loads(line)["tick"] for path in files for line in path.read_text().splitlines()]
    # Oldest first; the oldest reports went with the file that fell off the end.
    assert ticks == sorted(ticks)
    assert ticks[-1] == 29
    assert 0 not in ticks


def test_the_reader_skips_damaged_lines(tmp_path: Path) -> None:
    (tmp_path / clientlog.LOG_FILE).write_text(
        '{"match_id": "7", "msg": "a"}\nnot json\n[1]\n{"match_id": "8"}\n{"match_id": "7"}\n'
    )
    assert list(clientlog.lines_of(tmp_path, "7")) == [
        '{"match_id": "7", "msg": "a"}',
        '{"match_id": "7"}',
    ]
