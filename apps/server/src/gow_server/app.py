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

from gow_server import identity, internal, invites, maps, replays, ws
from gow_server.clock import Clock, MonotonicClock
from gow_server.db import create_db_engine, upgrade_to_head
from gow_server.logs import request_id_var
from gow_server.matches import MatchManager
from gow_server.ratelimit import SlidingWindowLimiter
from gow_server.settings import Settings
from gow_sim.ruleset import load_ruleset

log = logging.getLogger("gow_server")
access_log = logging.getLogger("gow_server.access")

REQUEST_ID_HEADER = "X-Request-ID"
# An incoming request id (from Caddy) is reused only if it looks like one: it goes into logs.
_REQUEST_ID_RE = re.compile(r"[A-Za-z0-9._-]{1,64}")


def create_app(settings: Settings | None = None, clock: Clock | None = None) -> FastAPI:
    """The app; ``clock`` drives the match loops (tests pass a ``ManualClock``)."""
    settings = settings or Settings()
    match_clock = clock or MonotonicClock()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
        app.state.maps = maps.MapCatalog.load(settings.maps_dir)
        engine = create_db_engine(settings.database_url)
        await asyncio.to_thread(upgrade_to_head, engine)
        app.state.sessions = sessionmaker(engine, expire_on_commit=False)
        app.state.replays = replays.ReplayService(
            settings.replays_dir, settings.rulesets_dir, settings.maps_dir, app.state.sessions
        )
        app.state.matches = MatchManager(match_clock, replays=app.state.replays)
        app.state.ruleset = load_ruleset(settings.ruleset_path)
        app.state.invites = invites.InviteBook(match_clock, settings.invite_ttl_s)
        log.info(
            "server started",
            extra={"env": settings.env, "maps": [entry.id for entry in app.state.maps.all()]},
        )
        try:
            yield
        finally:
            await app.state.matches.shutdown()
            await app.state.replays.aclose()
            engine.dispose()
            log.info("server stopped")

    app = FastAPI(title="Skill-Based Front", lifespan=lifespan)
    app.state.settings = settings
    app.state.guest_limiter = SlidingWindowLimiter(
        settings.guest_rate_limit, settings.guest_rate_window_s, MonotonicClock()
    )

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
            # Path only: the query string is never logged (AGENTS.md, section 5.3). A matched
            # route is logged by its template (/api/matches/{code}/join): the code is a secret.
            route = request.scope.get("route")
            path = getattr(route, "path", None) or request.url.path
            access_log.info(
                "request",
                extra={
                    "method": request.method,
                    "path": path,
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
    app.include_router(identity.router)
    app.include_router(replays.router)
    app.include_router(internal.router)
    app.include_router(invites.router)
    app.include_router(ws.router)
    return app
