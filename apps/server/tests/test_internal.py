"""SRV-02: the drain endpoints of a deploy are served only from the loopback interface."""

import pytest
from fastapi.testclient import TestClient
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from gow_server.app import create_app
from gow_server.matches import MatchManager
from gow_server.settings import Settings


def test_drain_from_loopback(settings: Settings) -> None:
    app = create_app(settings)
    with TestClient(app, client=("127.0.0.1", 50000)) as local:
        assert local.get("/internal/drain").json() == {"draining": False, "active": 0}
        assert local.post("/internal/drain").json() == {"draining": True, "active": 0}
        assert isinstance(app.state.matches, MatchManager)
        assert app.state.matches.draining
        assert local.get("/internal/drain").json() == {"draining": True, "active": 0}
        assert local.delete("/internal/drain").json() == {"draining": False, "active": 0}


def test_drain_is_hidden_from_other_clients(client: TestClient) -> None:
    for method in ("GET", "POST", "DELETE"):
        assert client.request(method, "/internal/drain").status_code == 404
    assert "/internal/drain" not in client.get("/openapi.json").text


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("X-Forwarded-For", "127.0.0.1"),
        ("X-Forwarded-For", "::1"),
        ("Forwarded", "for=127.0.0.1"),
        ("X-Real-IP", "127.0.0.1"),
    ],
)
def test_a_spoofed_proxy_header_does_not_open_internal(
    settings: Settings, name: str, value: str
) -> None:
    """#194: uvicorn as in compose.yaml (``proxy_headers``, every peer trusted) and a peer of the
    internal network that claims to be the loopback interface."""
    app = create_app(settings)
    app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")
    with TestClient(app, client=("172.18.0.3", 40000)) as peer:
        for method in ("GET", "POST", "DELETE"):
            assert peer.request(method, "/internal/drain", headers={name: value}).status_code == 404
        assert peer.get("/internal/metrics", headers={name: value}).status_code == 404
        assert isinstance(app.state.matches, MatchManager)
        assert not app.state.matches.draining
