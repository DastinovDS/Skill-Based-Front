"""#374: accounts with a password, login by nick and password, token rotation, limits, no leaks.

Expected behaviour comes from issue #374 (tasks, acceptance criteria and the accepted defaults of
its open questions), not from the output of the code.
"""

import base64
import io
import re
import sqlite3
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import cast

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from gow_server import admin, passwords
from gow_server.app import create_app
from gow_server.models import Rating
from gow_server.passwords import PasswordHasher, normalize
from gow_server.settings import Settings

Headers = dict[str, str]
ALEMBIC_INI = Path(__file__).parents[1] / "alembic.ini"
PASSWORD = "correct horse battery"
OTHER_PASSWORD = "another long secret"


def auth(token: object) -> Headers:
    return {"Authorization": f"Bearer {token}"}


def guest(client: TestClient, nick: str) -> tuple[str, int]:
    response = client.post("/api/guest", json={"nick": nick})
    assert response.status_code == 201, response.text
    body = response.json()
    return body["token"], body["player_id"]


def set_password(client: TestClient, token: str, password: str, old: str | None = None) -> str:
    body = {"password": password} if old is None else {"password": password, "old_password": old}
    response = client.post("/api/account/password", json=body, headers=auth(token))
    assert response.status_code == 200, response.text
    new_token: str = response.json()["token"]
    return new_token


def login(client: TestClient, nick: str, password: str) -> tuple[int, dict[str, object]]:
    response = client.post("/api/login", json={"nick": nick, "password": password})
    return response.status_code, response.json()


@pytest.fixture
def fast(settings: Settings) -> Settings:
    """Cheaper scrypt for tests that hash many times; the defaults are tested separately."""
    return settings.model_copy(update={"scrypt_n": 2**10})


@pytest.fixture
def api(fast: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(fast)) as client:
        yield client


@pytest.fixture
def scrypt_calls(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    """Counts scrypt runs (one entry per run, the ``n`` it used)."""
    calls: list[int] = []
    original = passwords._scrypt  # pyright: ignore[reportPrivateUsage]

    def counting(password: str, salt: bytes, n: int, r: int, p: int, maxmem: int) -> bytes:
        calls.append(n)
        return original(password, salt, n, r, p, maxmem)

    monkeypatch.setattr(passwords, "_scrypt", counting)
    return calls


# Hashing ----------------------------------------------------------------------------------------


def test_default_scrypt_parameters_and_hash_format(settings: Settings) -> None:
    # Issue #374, question 7: N=2^15, r=8, p=1, maxmem 64 MB; salt secrets.token_bytes(16).
    assert (settings.scrypt_n, settings.scrypt_r, settings.scrypt_p) == (2**15, 8, 1)
    assert settings.scrypt_maxmem == 64 * 1024 * 1024
    hasher = PasswordHasher(settings)
    stored = hasher.hash(PASSWORD)
    match = re.fullmatch(r"scrypt\$32768\$8\$1\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)", stored)
    assert match is not None
    assert len(base64.b64decode(match[1])) == 16
    assert hasher.verify(PASSWORD, stored)
    assert not hasher.verify(PASSWORD + "!", stored)
    assert hasher.hash(PASSWORD) != stored  # a new salt every time


def test_parameters_travel_with_the_hash(settings: Settings) -> None:
    """A hash made with other parameters still verifies after the defaults change."""
    old = PasswordHasher(settings.model_copy(update={"scrypt_n": 2**10, "scrypt_r": 4}))
    stored = old.hash(PASSWORD)
    assert stored.startswith("scrypt$1024$4$1$")
    assert PasswordHasher(settings).verify(PASSWORD, stored)


def test_password_is_nfkc_normalized_before_hashing(fast: Settings) -> None:
    hasher = PasswordHasher(fast)
    fullwidth = "".join(chr(ord(char) + 0xFEE0) for char in "password123")  # fullwidth forms
    assert fullwidth != "password123"
    stored = hasher.hash(fullwidth)  # NFKC gives "password123"
    assert hasher.verify("password123", stored)
    # "e" + combining acute and the precomposed "é" are the same password
    assert hasher.verify("café-au-lait", hasher.hash("café-au-lait"))


@pytest.mark.parametrize(
    ("password", "ok"),
    [
        ("x" * 9, False),
        ("x" * 10, True),
        ("x" * 128, True),
        ("x" * 129, False),
        ("ﬁ" * 5, True),  # five "fi" ligatures are ten characters after NFKC
        ("пароль из кириллицы", True),  # any Unicode, no composition rules
        ("          ", True),
    ],
)
def test_password_length_is_10_to_128_after_nfkc(password: str, ok: bool) -> None:
    if ok:
        assert 10 <= len(normalize(password)) <= 128
    else:
        with pytest.raises(ValueError, match="10 to 128") as error:
            normalize(password)
        assert password not in str(error.value)


# Account flow -----------------------------------------------------------------------------------


def test_guest_sets_a_password_and_logs_in_on_another_device(
    api: TestClient, fast: Settings
) -> None:
    guest_token, player_id = guest(api, "Alice")
    me = api.get("/api/me", headers=auth(guest_token)).json()
    assert me == {"player_id": player_id, "nick": "Alice", "has_password": False}
    sessions = cast("sessionmaker[Session]", api.app.state.sessions)  # type: ignore[attr-defined]
    with sessions() as session:
        session.add(Rating(player_id=player_id, rating=1600.0, rd=80.0, volatility=0.06))
        session.commit()

    response = api.post(
        "/api/account/password", json={"password": PASSWORD}, headers=auth(guest_token)
    )
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    body = response.json()
    assert set(body) == {"player_id", "token"}
    assert body["player_id"] == player_id
    account_token = body["token"]
    assert account_token != guest_token
    assert api.get("/api/me", headers=auth(guest_token)).status_code == 401  # the old token died
    me = api.get("/api/me", headers=auth(account_token)).json()
    assert me == {"player_id": player_id, "nick": "Alice", "has_password": True}

    # Another device (a new client, no localStorage): nick in any case and the password.
    with TestClient(create_app(fast)) as other_device:
        status, login_body = login(other_device, "ALICE", PASSWORD)
    assert status == 200
    assert login_body["player_id"] == player_id
    assert login_body["token"] not in (guest_token, account_token)
    # One token per player (question 2): the first device is logged out, the new one works.
    assert api.get("/api/me", headers=auth(account_token)).status_code == 401
    me = api.get("/api/me", headers=auth(login_body["token"])).json()
    assert me == {"player_id": player_id, "nick": "Alice", "has_password": True}
    with sessions() as session:  # the same player: the rating is still there
        rating = session.get(Rating, player_id)
        assert rating is not None and rating.rating == 1600.0


def test_database_keeps_only_the_scrypt_hash(api: TestClient, fast: Settings) -> None:
    token, _ = guest(api, "Alice")
    set_password(api, token, PASSWORD)
    db_path = fast.database_url.removeprefix("sqlite:///")
    with sqlite3.connect(db_path) as connection:
        (stored,) = connection.execute("SELECT password_hash FROM players").fetchone()
    assert stored.startswith("scrypt$")
    for path in Path(db_path).parent.glob("gow.db*"):  # the database and its WAL
        assert PASSWORD.encode() not in path.read_bytes()


def test_change_password_needs_the_old_one(api: TestClient) -> None:
    token, _ = guest(api, "Alice")
    token = set_password(api, token, PASSWORD)
    for body in (
        {"password": OTHER_PASSWORD},
        {"password": OTHER_PASSWORD, "old_password": "not the password"},
    ):
        response = api.post("/api/account/password", json=body, headers=auth(token))
        assert response.status_code == 403
        assert response.json() == {"detail": "wrong password"}
    assert login(api, "Alice", PASSWORD)[0] == 200  # unchanged
    token = api.post("/api/login", json={"nick": "Alice", "password": PASSWORD}).json()["token"]

    new_token = set_password(api, token, OTHER_PASSWORD, old=PASSWORD)
    assert api.get("/api/me", headers=auth(token)).status_code == 401  # other devices log out
    assert api.get("/api/me", headers=auth(new_token)).status_code == 200
    assert login(api, "Alice", PASSWORD)[0] == 401
    assert login(api, "Alice", OTHER_PASSWORD)[0] == 200


def test_setting_a_password_needs_a_valid_token(api: TestClient) -> None:
    response = api.post("/api/account/password", json={"password": PASSWORD})
    assert response.status_code == 401
    response = api.post(
        "/api/account/password", json={"password": PASSWORD}, headers=auth("not-a-token")
    )
    assert response.status_code == 401


def test_wrong_nick_and_wrong_password_are_indistinguishable(
    api: TestClient, fast: Settings, scrypt_calls: list[int]
) -> None:
    token, _ = guest(api, "Alice")
    set_password(api, token, PASSWORD)
    guest(api, "Bobby")  # a guest without a password cannot be logged into
    scrypt_calls.clear()

    responses = [
        api.post("/api/login", json={"nick": nick, "password": password})
        for nick, password in (
            ("Alice", "wrong password!"),
            ("Nobody", PASSWORD),
            ("Bobby", PASSWORD),
            ("not a nick!", PASSWORD),
        )
    ]
    assert {(r.status_code, r.text) for r in responses} == {
        (401, '{"detail":"wrong nick or password"}')
    }
    # the same work for each: one scrypt run with the current parameters
    assert scrypt_calls == [fast.scrypt_n] * 4


def test_blocked_account_is_403_only_with_the_right_password(api: TestClient) -> None:
    token, player_id = guest(api, "Trouble")
    set_password(api, token, PASSWORD)
    sessions = cast("sessionmaker[Session]", api.app.state.sessions)  # type: ignore[attr-defined]
    admin.run(sessions, ["block", str(player_id)])
    assert login(api, "Trouble", PASSWORD) == (403, {"detail": "account is blocked"})
    assert login(api, "Trouble", "wrong password!")[0] == 401


def test_guest_without_password_works_as_before(api: TestClient) -> None:
    token, _ = guest(api, "Alice")
    assert api.get("/api/me", headers=auth(token)).status_code == 200
    assert api.post("/api/matches", json={}, headers=auth(token)).status_code in (200, 201)
    assert api.post("/api/guest", json={"nick": "alice"}).status_code == 409  # no takeover


# Validation and leaks ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        {"password": "short"},
        {"password": "x" * 129},
        {"password": PASSWORD, "admin": True},
        {"password": 12345678901},
        {},
    ],
    ids=["short", "long", "extra", "number", "missing"],
)
def test_bad_password_body_is_422_without_the_input(api: TestClient, body: object) -> None:
    token, _ = guest(api, "Alice")
    response = api.post("/api/account/password", json=body, headers=auth(token))
    assert response.status_code == 422
    for error in response.json()["detail"]:
        assert set(error) == {"type", "loc", "msg"}
    for value in ("short", "x" * 129, "12345678901"):
        assert value not in response.text
    assert api.get("/api/me", headers=auth(token)).status_code == 200  # nothing changed


def test_login_body_is_validated_without_echo(api: TestClient) -> None:
    for body in (
        {"nick": "Alice"},
        {"nick": "Alice", "password": "p" * 1025},
        {"nick": "Alice", "password": "secret-value-1", "remember": True},
    ):
        response = api.post("/api/login", json=body)
        assert response.status_code == 422
        assert "p" * 1025 not in response.text
        assert "secret-value-1" not in response.text


def test_password_never_logged(api: TestClient, json_logs: io.StringIO) -> None:
    token, _ = guest(api, "Alice")
    token = set_password(api, token, PASSWORD)
    set_password(api, token, OTHER_PASSWORD, old=PASSWORD)
    login(api, "Alice", OTHER_PASSWORD)
    login(api, "Alice", "a wrong password")
    api.post("/api/account/password", json={"password": "tooshort"}, headers=auth(token))
    logs = json_logs.getvalue()
    assert '"path": "/api/login"' in logs  # the capture works
    for secret in (PASSWORD, OTHER_PASSWORD, "a wrong password", "tooshort"):
        assert secret not in logs


# Rate limits ------------------------------------------------------------------------------------


def limited(fast: Settings, **limits: int) -> TestClient:
    return TestClient(create_app(fast.model_copy(update=limits)))


def assert_429(response: object) -> None:
    status = getattr(response, "status_code", None)
    headers = cast("dict[str, str]", getattr(response, "headers", {}))
    assert status == 429
    assert int(headers["Retry-After"]) > 0


def test_login_rate_limited_per_ip(fast: Settings) -> None:
    with limited(fast, login_ip_rate_limit=3, login_nick_rate_limit=100) as client:
        for nick in ("Nobody1", "Nobody2", "Nobody3"):
            assert login(client, nick, PASSWORD)[0] == 401
        assert_429(client.post("/api/login", json={"nick": "Nobody4", "password": PASSWORD}))


def test_login_rate_limited_per_nick(fast: Settings) -> None:
    with limited(fast, login_ip_rate_limit=100, login_nick_rate_limit=2) as client:
        token, _ = guest(client, "Alice")
        set_password(client, token, PASSWORD)
        assert login(client, "Alice", "wrong password1")[0] == 401
        assert login(client, "alice", "wrong password2")[0] == 401  # the same nick key
        # even the right password waits: the limit protects the account, not the guesser
        assert_429(client.post("/api/login", json={"nick": "ALICE", "password": PASSWORD}))
        assert login(client, "Nobody", PASSWORD)[0] == 401  # another nick has its own budget


def test_password_changes_rate_limited_per_player(fast: Settings) -> None:
    with limited(fast, password_rate_limit=2) as client:
        token, _ = guest(client, "Alice")
        other, _ = guest(client, "Bobby")
        token = set_password(client, token, PASSWORD)
        bad = {"password": OTHER_PASSWORD, "old_password": "guess number 1"}
        assert (
            client.post("/api/account/password", json=bad, headers=auth(token)).status_code == 403
        )
        assert_429(
            client.post(
                "/api/account/password",
                json={"password": OTHER_PASSWORD, "old_password": PASSWORD},
                headers=auth(token),
            )
        )
        set_password(client, other, PASSWORD)  # another player has their own budget


# gow-admin reset-password ------------------------------------------------------------------------


def answers(*values: str) -> Callable[[str], str]:
    queue = list(values)
    return lambda prompt: queue.pop(0)


def test_admin_reset_password(api: TestClient, fast: Settings) -> None:
    token, player_id = guest(api, "Alice")
    token = set_password(api, token, PASSWORD)
    sessions = cast("sessionmaker[Session]", api.app.state.sessions)  # type: ignore[attr-defined]
    hasher = PasswordHasher(fast)

    for typed, message in (
        (("new password 1", "new password 2"), "do not match"),
        (("short", "short"), "10 to 128"),
    ):
        with pytest.raises(admin.AdminError, match=message):
            admin.run(
                sessions,
                ["reset-password", "alice"],
                passwords=hasher,
                read_password=answers(*typed),
            )
    assert api.get("/api/me", headers=auth(token)).status_code == 200  # nothing changed yet

    line = admin.run(
        sessions,
        ["reset-password", str(player_id)],
        passwords=hasher,
        read_password=answers(OTHER_PASSWORD, OTHER_PASSWORD),
    )
    assert f"id={player_id}" in line
    assert OTHER_PASSWORD not in line
    assert api.get("/api/me", headers=auth(token)).status_code == 401  # logged out everywhere
    assert login(api, "Alice", PASSWORD)[0] == 401
    assert login(api, "Alice", OTHER_PASSWORD)[0] == 200


# Migration --------------------------------------------------------------------------------------


def test_migration_0005_adds_an_empty_password(tmp_path: Path) -> None:
    db_path = tmp_path / "old.db"
    config = Config(ALEMBIC_INI)
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    command.upgrade(config, "0004")
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "INSERT INTO players (nick, nick_key, token_hash, created_at)"
            " VALUES ('Alice', 'alice', ?, '2026-01-01')",
            (b"t" * 32,),
        )
    command.upgrade(config, "0005")
    with sqlite3.connect(db_path) as connection:
        rows = connection.execute("SELECT nick, password_hash FROM players").fetchall()
    assert rows == [("Alice", None)]  # existing players stay guests
    command.downgrade(config, "0004")
    with sqlite3.connect(db_path) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(players)")}
    assert "password_hash" not in columns
