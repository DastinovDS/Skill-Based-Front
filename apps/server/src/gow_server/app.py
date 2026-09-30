"""FastAPI application factory."""

import asyncio
import logging
import re
import time
import uuid
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from sqlalchemy.orm import sessionmaker

from gow_server import maps
from gow_server.db import create_db_engine, upgrade_to_head
from gow_server.logs import request_id_var
from gow_server.settings import Settings

log = logging.getLogger("gow_server")
access_log = logging.getLogger("gow_server.access")

REQUEST_ID_HEADER = "X-Request-ID"
# An incoming request id (from Caddy) is reused only if it looks like one: it goes into logs.
_REQUEST_ID_RE = re.compile(r"[A-Za-z0-9._-]{1,64}")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
        app.state.maps = maps.MapCatalog.load(settings.maps_dir)
        engine = create_db_engine(settings.database_url)
        await asyncio.to_thread(upgrade_to_head, engine)
        app.state.sessions = sessionmaker(engine, expire_on_commit=False)
        log.info(
            "server started",
            extra={"env": settings.env, "maps": [entry.id for entry in app.state.maps.all()]},
        )
        try:
            yield
        finally:
            engine.dispose()
            log.info("server stopped")

    app = FastAPI(title="Skill-Based Front", lifespan=lifespan)
    app.state.settings = settings

    @app.middleware("http")
    async def request_context(  # pyright: ignore[reportUnusedFunction]
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        incoming = request.headers.get(REQUEST_ID_HEADER, "")
        request_id = incoming if _REQUEST_ID_RE.fullmatch(incoming) else uuid.uuid4().hex
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        try:
            response = await call_next(request)
            response.headers[REQUEST_ID_HEADER] = request_id
            # Path only: the query string is never logged (AGENTS.md, section 5.3).
            access_log.info(
                "request",
                extra={
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                },
            )
            return response
        finally:
            request_id_var.reset(token)

    @app.get("/api/health")
    async def health() -> dict[str, str]:  # pyright: ignore[reportUnusedFunction]
        return {"status": "ok"}

    app.include_router(maps.router)
    return app
