"""SRV-02: the drain endpoints of a deploy are served only from the loopback interface."""

from fastapi.testclient import TestClient

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
