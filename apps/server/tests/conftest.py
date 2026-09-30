"""Shared fixtures of the server tests: an app over a temporary map directory."""

import io
import logging
import shutil
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from gow_server.app import create_app
from gow_server.logs import JsonFormatter
from gow_server.settings import Settings

SIM_TEST_MAPS = Path(__file__).parents[3] / "packages" / "sim" / "tests" / "maps"


@pytest.fixture
def maps_dir(tmp_path: Path) -> Path:
    directory = tmp_path / "maps"
    directory.mkdir()
    for name in ("line3", "diamond"):
        shutil.copy(SIM_TEST_MAPS / f"{name}.json", directory)
    return directory


@pytest.fixture
def settings(maps_dir: Path, tmp_path: Path) -> Settings:
    return Settings(maps_dir=maps_dir, database_url=f"sqlite:///{tmp_path / 'gow.db'}")


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    # The context manager runs the lifespan (startup and shutdown).
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture
def json_logs() -> Iterator[io.StringIO]:
    """Every server log record, formatted as in production (JSON lines).

    Records of the test HTTP client itself (``httpx2``, it logs request URLs) are left out:
    they are not server logs.
    """
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(lambda record: not record.name.startswith(("httpx", "httpcore")))
    root = logging.getLogger()
    old_level = root.level
    root.addHandler(handler)
    root.setLevel(logging.DEBUG)
    try:
        yield stream
    finally:
        root.removeHandler(handler)
        root.setLevel(old_level)
