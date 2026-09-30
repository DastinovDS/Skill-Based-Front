"""SRV-01: uvicorn is started with one worker, a WebSocket size limit and trusted proxies."""

import pytest

from gow_server.cli import uvicorn_options
from gow_server.settings import Settings


def test_uvicorn_options() -> None:
    options = uvicorn_options(Settings(forwarded_allow_ips="10.0.0.2"), reload=False)
    assert options["workers"] == 1
    assert options["ws_max_size"] == 65536
    assert options["forwarded_allow_ips"] == "10.0.0.2"
    assert options["factory"] is True
    assert options["access_log"] is False


def test_settings_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOW_PORT", "9123")
    monkeypatch.setenv("GOW_ENV", "e2e")
    settings = Settings()
    assert settings.port == 9123
    assert settings.env == "e2e"
