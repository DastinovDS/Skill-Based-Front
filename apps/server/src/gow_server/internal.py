"""Operator endpoints under ``/internal``: match draining before a deploy (SRV-02, OPS-03).

Only requests from the loopback interface are served, i.e. from inside the `app` container
(``docker compose exec app ...`` in ``deploy/deploy.sh``). Caddy proxies only ``/api/*`` and
``/ws/*``, so ``/internal`` is not reachable from outside either way.

``request.client`` alone does not prove loopback: uvicorn trusts ``X-Forwarded-For`` of any peer
(``GOW_FORWARDED_ALLOW_IPS="*"`` in ``compose.yaml``) and puts its address there, so a peer on the
internal network could claim ``127.0.0.1`` (#194). A request that carries a proxy header has come
through a proxy, never from inside the container: it gets the same 404.

- ``GET /internal/drain``: ``{draining, active}``;
- ``POST /internal/drain``: stop starting new matches; running ones play to the end;
- ``DELETE /internal/drain``: accept new matches again (a deploy that stopped before the switch);
- ``GET /internal/metrics``: process metrics, Prometheus text format (OPS-04, ``metrics.py``).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel

from gow_server.matches import MatchManager
from gow_server.metrics import render

LOOPBACK = frozenset({"127.0.0.1", "::1"})
PROXY_HEADERS = ("x-forwarded-for", "forwarded", "x-real-ip")
"""Headers a proxy adds; ``X-Forwarded-For`` is what uvicorn turns into ``request.client``."""


def _loopback_only(request: Request) -> None:
    proxied = any(name in request.headers for name in PROXY_HEADERS)
    if proxied or request.client is None or request.client.host not in LOOPBACK:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)


def get_manager(request: Request) -> MatchManager:
    manager = request.app.state.matches
    assert isinstance(manager, MatchManager)
    return manager


Manager = Annotated[MatchManager, Depends(get_manager)]

router = APIRouter(
    prefix="/internal", dependencies=[Depends(_loopback_only)], include_in_schema=False
)


class DrainStatus(BaseModel):
    draining: bool
    active: int
    """Matches still running."""


def _status(manager: MatchManager) -> DrainStatus:
    return DrainStatus(draining=manager.draining, active=manager.active)


@router.get("/drain")
async def drain_status(manager: Manager) -> DrainStatus:
    return _status(manager)


@router.post("/drain")
async def drain(manager: Manager) -> DrainStatus:
    manager.drain()
    return _status(manager)


@router.delete("/drain")
async def undrain(manager: Manager) -> DrainStatus:
    manager.undrain()
    return _status(manager)


@router.get("/metrics")
async def metrics(manager: Manager) -> Response:
    return Response(render(manager), media_type="text/plain; version=0.0.4; charset=utf-8")
