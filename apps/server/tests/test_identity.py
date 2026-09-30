"""ID-01: guest creation, bearer authentication, nick rules, rate limit, no token in logs."""

import hashlib
import io
import re
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from gow_server.app import create_app
from gow_server.settings import Settings


def _create(client: TestClient, nick: str) -> dict[str, object]:
    response = client.post("/api/guest", json={"nick": nick})
    assert response.status_code == 201, response.text
    body: dict[str, object] = response.json()
    return body


def _auth(token: object) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_create_guest_and_authenticate(client: TestClient, settings: Settings) -> None:
    response = client.post("/api/guest", json={"nick": "Alice"})
    assert response.status_code == 201
    assert response.headers["Cache-Control"] == "no-store"
    body = response.json()
    assert set(body) == {"player_id", "token"}
    token = body["token"]
    # secrets.token_urlsafe(32): 32 random bytes, 43 base64url characters.
    assert re.fullmatch(r"[A-Za-z0-9_-]{43}", token)

    me = client.get("/api/me", headers=_auth(token))
    assert me.status_code == 200
    assert me.json() == {"player_id": body["player_id"], "nick": "Alice"}

    # Only the SHA-256 of the token is stored.
    db_path = settings.database_url.removeprefix("sqlite:///")
    with sqlite3.connect(db_path) as connection:
        stored = connection.execute("SELECT token_hash FROM players").fetchall()
    assert stored == [(hashlib.sha256(token.encode()).digest(),)]
    assert token.encode() not in Path(db_path).read_bytes()


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": "Bearer not-a-real-token"},
        {"Authorization": "Bearer "},
        {"Authorization": "Basic dXNlcjpwYXNz"},
    ],
    ids=["missing", "unknown", "empty", "basic"],
)
def test_invalid_token_is_401(client: TestClient, headers: dict[str, str]) -> None:
    _create(client, "Alice")
    response = client.get("/api/me", headers=headers)
    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_token_in_url_is_not_accepted(client: TestClient) -> None:
    token = _create(client, "Alice")["token"]
    assert client.get(f"/api/me?token={token}").status_code == 401
    assert client.get("/api/me", headers={"Authorization": f"Token {token}"}).status_code == 401


def test_token_never_logged(client: TestClient, json_logs: io.StringIO) -> None:
    token = _create(client, "Alice")["token"]
    assert isinstance(token, str)
    client.get("/api/me", headers=_auth(token))
    client.get("/api/me", headers=_auth(token + "x"))
    client.get(f"/api/me?token={token}")
    client.post("/api/guest", json={"nick": "a b"}, headers=_auth(token))
    logs = json_logs.getvalue()
    assert '"path": "/api/me"' in logs  # the capture works
    assert token not in logs
    assert hashlib.sha256(token.encode()).hexdigest() not in logs


@pytest.mark.parametrize(
    "nick",
    ["abc", "a" * 16, "Player_1", "x-y", "Иван", "Straße", "玩家一号", "123"],
)
def test_valid_nicks(client: TestClient, nick: str) -> None:
    token = _create(client, nick)["token"]
    assert client.get("/api/me", headers=_auth(token)).json()["nick"] == nick


@pytest.mark.parametrize(
    "nick",
    [
        "",
        "ab",
        "a" * 17,
        "a b",
        "<b>hi</b>",
        "abc!",
        "abc.",
        "ab\u0000c",
        "ab​c",  # zero-width space
        "abc\U0001f600",  # emoji
        "\u3164\u3164\u3164",  # Hangul filler: a letter that renders as blank space
        " abc",
    ],
)
def test_invalid_nicks_are_422(client: TestClient, nick: str) -> None:
    assert client.post("/api/guest", json={"nick": nick}).status_code == 422


def test_wrong_body_is_422(client: TestClient) -> None:
    assert client.post("/api/guest", json={}).status_code == 422
    assert client.post("/api/guest", json={"nick": 123}).status_code == 422
    assert client.post("/api/guest", json={"nick": "Alice", "admin": True}).status_code == 422


def test_nick_is_nfc_normalized(client: TestClient) -> None:
    token = _create(client, "Renée")["token"]  # e + combining acute accent
    assert client.get("/api/me", headers=_auth(token)).json()["nick"] == "Renée"
    # The precomposed spelling is the same nick.
    assert client.post("/api/guest", json={"nick": "Renée"}).status_code == 409


@pytest.mark.parametrize(
    ("first", "second"),
    [("Alice", "ALICE"), ("alice", "Alice"), ("Иван", "иВАН"), ("Straße", "STRASSE")],
)
def test_nick_unique_case_insensitive(client: TestClient, first: str, second: str) -> None:
    _create(client, first)
    response = client.post("/api/guest", json={"nick": second})
    assert response.status_code == 409


def test_guest_creation_rate_limited_per_ip(maps_dir: Path, tmp_path: Path) -> None:
    settings = Settings(
        maps_dir=maps_dir,
        database_url=f"sqlite:///{tmp_path / 'limit.db'}",
        guest_rate_limit=2,
        guest_rate_window_s=600,
    )
    with TestClient(create_app(settings)) as client:
        _create(client, "one")
        _create(client, "two")
        response = client.post("/api/guest", json={"nick": "three"})
    assert response.status_code == 429
    assert 0 < int(response.headers["Retry-After"]) <= 600
