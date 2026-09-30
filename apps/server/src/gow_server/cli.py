"""``gow-server``: run the server with uvicorn.

Always one worker (AGENTS.md, section 5.1): match state lives in the memory of one process, so
there is deliberately no ``--workers`` option. Host, port and the rest come from ``Settings``
(``GOW_*`` environment variables).
"""

import argparse
from typing import Any

import uvicorn
from fastapi import FastAPI

from gow_server.app import create_app
from gow_server.logs import configure_logging
from gow_server.settings import Settings

WS_MAX_SIZE = 65536
"""Largest WebSocket message in bytes; client messages are small intents."""


def serve_app() -> FastAPI:
    """Uvicorn factory: runs in the server process (also in the child process of ``--reload``)."""
    settings = Settings()
    configure_logging(settings.log_level)
    return create_app(settings)


def uvicorn_options(settings: Settings, *, reload: bool) -> dict[str, Any]:
    return {
        "factory": True,
        "host": settings.host,
        "port": settings.port,
        "workers": 1,
        "reload": reload,
        "ws_max_size": WS_MAX_SIZE,
        "proxy_headers": True,
        "forwarded_allow_ips": settings.forwarded_allow_ips,
        # Logging is configured by serve_app(); the access log is our middleware (no query).
        "log_config": None,
        "access_log": False,
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="gow-server", description=__doc__)
    parser.add_argument("--reload", action="store_true", help="restart on code changes (dev)")
    args = parser.parse_args(argv)
    reload: bool = args.reload
    settings = Settings()
    configure_logging(settings.log_level)
    uvicorn.run("gow_server.cli:serve_app", **uvicorn_options(settings, reload=reload))
