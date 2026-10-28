"""Reproduction tests of the pre-release audit (docs/qa/audit-2026-10.md, "Server and security").

Each test fails today and is marked ``xfail(strict=True)``: the fix of its finding makes it pass,
and then the marker must go (a strict xfail that passes fails the run).
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

TOO_LARGE = 1 << 20
"""A request body far above any real API body (they are a few hundred bytes)."""


def _oversized_guest_body() -> bytes:
    return b'{"nick": "abc", "pad": "' + b"x" * TOO_LARGE + b'"}'


def _chunks(body: bytes, size: int = 64 * 1024) -> Iterator[bytes]:
    for start in range(0, len(body), size):
        yield body[start : start + size]


@pytest.mark.xfail(strict=True, reason="audit #411: request bodies are not size-limited")
@pytest.mark.parametrize("chunked", [False, True], ids=["content-length", "chunked"])
def test_oversized_body_is_refused_before_parsing(client: TestClient, chunked: bool) -> None:
    """SRV-01: an anonymous request with a huge body gets 413, not a full read and JSON parse."""
    body = _oversized_guest_body()
    content = _chunks(body) if chunked else body
    response = client.post(
        "/api/guest", content=content, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 413
