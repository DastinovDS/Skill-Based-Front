"""Request body limit (audit SRV-01, #411): the middleware and its wiring into the app."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from gow_server.app import create_app
from gow_server.settings import Settings

JSON = {"Content-Type": "application/json"}


def _chunks(body: bytes, size: int = 1024) -> Iterator[bytes]:
    for start in range(0, len(body), size):
        yield body[start : start + size]


def _body(size: int) -> bytes:
    """A JSON object of exactly ``size`` bytes."""
    head, tail = b'{"nick": "abc", "pad": "', b'"}'
    return head + b"x" * (size - len(head) - len(tail)) + tail


def test_default_limit_is_32_kib(settings: Settings) -> None:
    assert settings.max_request_body_bytes == 32 * 1024


def test_normal_requests_still_work(client: TestClient) -> None:
    response = client.post("/api/guest", json={"nick": "abc"})
    assert response.status_code == 201


def test_body_at_the_limit_reaches_the_endpoint(settings: Settings) -> None:
    limited = settings.model_copy(update={"max_request_body_bytes": 2048})
    with TestClient(create_app(limited)) as client:
        # Past the limit check and rejected by validation (unknown field "pad"), not by the limit.
        assert client.post("/api/guest", content=_body(2048), headers=JSON).status_code == 422
        assert client.post("/api/guest", content=_body(2049), headers=JSON).status_code == 413


def test_chunked_body_over_the_limit_is_counted(settings: Settings) -> None:
    limited = settings.model_copy(update={"max_request_body_bytes": 2048})
    with TestClient(create_app(limited)) as client:
        assert (
            client.post("/api/guest", content=_chunks(_body(2048)), headers=JSON).status_code == 422
        )
        assert (
            client.post("/api/guest", content=_chunks(_body(2049)), headers=JSON).status_code == 413
        )


def test_refusal_is_a_413_json_without_echoing_the_body(client: TestClient) -> None:
    response = client.post("/api/login", content=_body(1 << 20), headers=JSON)
    assert response.status_code == 413
    assert response.json() == {"detail": "request body too large"}
    assert "x" * 100 not in response.text


def test_get_requests_are_not_affected(client: TestClient) -> None:
    assert client.get("/api/health").status_code == 200


@pytest.mark.parametrize("value", [0, -1])
def test_limit_must_be_positive(value: int) -> None:
    with pytest.raises(ValueError):
        Settings(max_request_body_bytes=value)
