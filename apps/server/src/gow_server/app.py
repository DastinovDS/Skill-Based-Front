"""FastAPI application factory."""

import asyncio
import logging
import re
import time
import uuid
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.orm import sessionmaker

from gow_server import alerts, botmatch, identity, internal, invites, maps, matchqueue, replays, ws
from gow_server.abuse import Limits
from gow_server.bodylimit import BodySizeLimitMiddleware
from gow_server.clock import Clock, MonotonicClock
from gow_server.db import create_db_engine, upgrade_to_head
from gow_server.ladder import LadderRules
from gow_server.lifecycle import MatchLifecycle, abort_orphans, archive_rulesets
from gow_server.logs import request_id_var
from gow_server.matches import MatchManager
from gow_server.nicks import NickPolicy, load_blocklist
from gow_server.passwords import PasswordHasher
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
        app.state.matches = MatchManager(
            match_clock,
            replays=app.state.replays,
            reconnect_window_s=settings.reconnect_window_s,
            pause_max_s=settings.pause_max_s,
            bot_budget_s=settings.bot_budget_s,
            validate_snapshots=settings.env != "prod",
            max_matches=settings.max_matches,
            max_bot_matches=settings.max_bot_matches,
            bot_connect_timeout_s=settings.bot_connect_timeout_s,
        )
        app.state.lifecycle = MatchLifecycle(
            app.state.matches,
            app.state.sessions,
            match_clock,
            ready_timeout_s=settings.ready_timeout_s,
            ladder=LadderRules(
                calibration_matches=settings.calibration_matches,
                early_resign_s=settings.early_resign_s,
                resign_window_s=settings.resign_window_s,
                resign_ban_second_s=settings.resign_ban_second_s,
                resign_ban_third_s=settings.resign_ban_third_s,
                resign_ban_later_s=settings.resign_ban_later_s,
                opponent_limit=settings.opponent_limit,
                opponent_limit_window_s=settings.opponent_limit_window_s,
            ),
        )
        app.state.ruleset = load_ruleset(settings.ruleset_path)
        await asyncio.to_thread(
            archive_rulesets,
            settings.ruleset_path,
            settings.rulesets_dir,
            settings.rulesets_bundled_dir,
        )
        orphans = await asyncio.to_thread(abort_orphans, app.state.sessions)
        if orphans:
            log.warning("matches of the previous run aborted", extra={"count": orphans})
        app.state.invites = invites.InviteBook(
            match_clock, settings.invite_ttl_s, app.state.lifecycle, settings.lobby_stale_s
        )
        app.state.queue = matchqueue.MatchQueue(
            match_clock,
            app.state.lifecycle,
            window_base=settings.queue_window_base,
            window_per_s=settings.queue_window_per_s,
            window_max=settings.queue_window_max,
            pass_s=settings.queue_pass_s,
            confirm_s=settings.queue_confirm_s,
            bot_offer_s=settings.queue_bot_offer_s,
            stale_s=settings.queue_stale_s,
        )
        monitor = asyncio.create_task(
            alerts.monitor(app.state.matches, settings.monitor_interval_s), name="monitor"
        )
        log.info(
            "server started",
            extra={"env": settings.env, "maps": [entry.id for entry in app.state.maps.all()]},
        )
        try:
            yield
        finally:
            monitor.cancel()
            await app.state.matches.shutdown()
            await app.state.lifecycle.aclose()
            await app.state.replays.aclose()
            engine.dispose()
            log.info("server stopped")

    app = FastAPI(title="Skill-Based Front", lifespan=lifespan)
    app.state.settings = settings
    app.state.guest_limiter = SlidingWindowLimiter(
        settings.guest_rate_limit, settings.guest_rate_window_s, MonotonicClock()
    )
    app.state.limits = Limits(settings, MonotonicClock())
    app.state.nick_policy = NickPolicy(
        load_blocklist(settings.nick_blocklist_file) if settings.nick_blocklist_file else ()
    )
    app.state.passwords = PasswordHasher(settings)

    app.state.invite_limiter = SlidingWindowLimiter(
        settings.invite_rate_limit, settings.invite_rate_window_s, match_clock
    )

    # Added before request_context, so it sits inside it: the access log sees the 413.
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_request_body_bytes)

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

    @app.exception_handler(RequestValidationError)
    async def validation_error(  # pyright: ignore[reportUnusedFunction]
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # FastAPI's default 422 echoes every rejected value ("input"): a password, a token. The
        # client gets where and why, never what it sent (#374, AGENTS.md, section 5.5).
        detail = [
            {"type": error["type"], "loc": error["loc"], "msg": error["msg"]}
            for error in exc.errors()
        ]
        return JSONResponse(status_code=422, content={"detail": detail})

    @app.get("/api/health")
    async def health() -> dict[str, str]:  # pyright: ignore[reportUnusedFunction]
        return {"status": "ok"}

    app.include_router(maps.router)
    app.include_router(identity.router)
    app.include_router(replays.router)
    app.include_router(internal.router)
    app.include_router(invites.router)
    app.include_router(invites.lobby_router)
    app.include_router(botmatch.router)
    app.include_router(matchqueue.router)
    app.include_router(ws.router)
    return app
