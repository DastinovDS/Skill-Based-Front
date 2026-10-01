"""Replays on the server (SRV-07): the command log, the frames file and ``GET /api/replays/{id}``.

Files live in ``Settings.replays_dir`` (``data/replays/``, the ``/data`` volume in containers);
the database keeps only metadata and the path (AGENTS.md, section 9):

- ``{id}.jsonl.gz``: the command log (``gow_sim.replay``), written tick by tick while the match
  runs; the secret ``match_key`` is in its header, so the log is never served;
- ``{id}.frames.json.gz``: the full-state frames for the viewer (``gow_server.frames``), written
  once after the match. ``matches.replay_path`` is its name relative to ``replays_dir``.

``{id}`` is ``MatchRunner.match_id``, which is ``str(matches.id)`` for a match with a database row
(the lifecycle, SRV-09, creates the row first and starts the runner with that id).

After a match, ``ReplayService.schedule`` re-simulates the log in a ``ProcessPoolExecutor``: not
in the event loop, and not in a thread (the GIL would stall every match tick). The worker checks
the hashes of the log against the simulation and writes the frames file; the path is then saved
to the database outside the event loop.

Access (``GET /api/replays/{id}``): replays of rated matches are public; any other replay only
for the two participants (``Authorization: Bearer <token>``).
"""

import asyncio
import logging
import multiprocessing
import re
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from pathlib import Path
from typing import Annotated, Final

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from gow_server.db import DbSession
from gow_server.frames import FramesResult, build_frames
from gow_server.identity import hash_token
from gow_server.models import Match, MatchPlayer, Player
from gow_sim.replay import ReplayWriter

log = logging.getLogger("gow_server.replays")

LOG_SUFFIX: Final = ".jsonl.gz"
FRAMES_SUFFIX: Final = ".frames.json.gz"
_MATCH_ID_RE: Final = re.compile(r"[A-Za-z0-9_-]{1,64}")


class ReplayService:
    """Where replay files go and how a finished match becomes a frames file."""

    def __init__(
        self,
        replays_dir: Path,
        rulesets_dir: Path,
        maps_dir: Path,
        sessions: sessionmaker[Session],
        workers: int = 1,
    ) -> None:
        self.replays_dir: Final = replays_dir
        self.rulesets_dir: Final = rulesets_dir
        self.maps_dir: Final = maps_dir
        self._sessions: Final = sessions
        self._workers: Final = workers
        self._pool: ProcessPoolExecutor | None = None
        self._tasks: set[asyncio.Task[FramesResult | None]] = set()

    def log_path(self, match_id: str) -> Path:
        return self.replays_dir / (self._checked(match_id) + LOG_SUFFIX)

    def frames_name(self, match_id: str) -> str:
        """Name of the frames file relative to ``replays_dir``: the value of ``replay_path``."""
        return self._checked(match_id) + FRAMES_SUFFIX

    def writer(self, match_id: str) -> ReplayWriter:
        """The log writer of a match that is about to start (the file opens at its first tick)."""
        return ReplayWriter(self.log_path(match_id), flush_at_checkpoints=True)

    @staticmethod
    def _checked(match_id: str) -> str:
        if not _MATCH_ID_RE.fullmatch(match_id):
            raise ValueError(f"match id {match_id!r} is not usable in a file name")
        return match_id

    # After the match ---------------------------------------------------------------------------

    def schedule(self, match_id: str) -> asyncio.Task[FramesResult | None]:
        """Start ``finalize`` as a task that ``aclose()`` waits for. Needs a running loop."""
        task = asyncio.create_task(self.finalize(match_id), name=f"replay-{match_id}")
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    async def finalize(self, match_id: str) -> FramesResult | None:
        """Re-simulate the log of a finished match in a worker process and publish the frames.

        Returns ``None`` (after logging the reason) when the log cannot be turned into frames:
        the match then simply has no replay for viewing; the command log stays for analysis.
        """
        loop = asyncio.get_running_loop()
        out = self.replays_dir / self.frames_name(match_id)
        try:
            result = await loop.run_in_executor(
                self._get_pool(),
                build_frames,
                self.log_path(match_id),
                out,
                self.rulesets_dir,
                self.maps_dir,
            )
        except BrokenProcessPool:
            self._pool = None  # a new pool on the next match
            log.error("replay worker died", extra={"match_id": match_id})
            return None
        except Exception:
            log.exception("replay frames failed", extra={"match_id": match_id})
            return None
        saved = await asyncio.to_thread(self._save_path, match_id)
        log.info(
            "replay ready",
            extra={
                "match_id": match_id,
                "ticks": result.ticks,
                "frames": result.frames,
                "bytes": result.size,
                "saved": saved,
            },
        )
        return result

    def _get_pool(self) -> ProcessPoolExecutor:
        if self._pool is None:
            # spawn: a forked child of a threaded process (uvicorn, SQLAlchemy) can deadlock.
            self._pool = ProcessPoolExecutor(
                self._workers, mp_context=multiprocessing.get_context("spawn")
            )
        return self._pool

    def _save_path(self, match_id: str) -> bool:
        """Store ``replay_path`` in the ``matches`` row (blocking); ``False``: there is no row."""
        if not match_id.isdecimal():
            log.warning("match has no database row", extra={"match_id": match_id})
            return False
        with self._sessions.begin() as session:
            match = session.get(Match, int(match_id))
            if match is not None:
                match.replay_path = self.frames_name(match_id)
        if match is None:
            log.warning("match has no database row", extra={"match_id": match_id})
            return False
        return True

    async def aclose(self) -> None:
        """Wait for the running re-simulations, then stop the worker processes."""
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        pool, self._pool = self._pool, None
        if pool is not None:
            await asyncio.to_thread(pool.shutdown)


# HTTP ---------------------------------------------------------------------------------------

_optional_bearer = HTTPBearer(auto_error=False)

router = APIRouter(prefix="/api/replays", tags=["replays"])


def _service(request: Request) -> ReplayService:
    service = request.app.state.replays
    assert isinstance(service, ReplayService)
    return service


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="this replay is only for its players: send the token",
        headers={"WWW-Authenticate": "Bearer"},
    )


@router.get("/{match_id}", response_class=FileResponse)
def get_replay(
    match_id: int,
    session: DbSession,
    service: Annotated[ReplayService, Depends(_service)],
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_optional_bearer)],
) -> FileResponse:
    """The frames file of a finished match (``docs/design/replay-frames.md``), gzip as stored.

    Rated matches: public. Others: 401 without a valid token, 403 for a player outside the match.
    404: no such match, or its replay is not ready (yet).
    """
    match = session.get(Match, match_id)
    if match is None or match.replay_path is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="replay not found")
    if not match.rated:
        if credentials is None:
            raise _unauthorized()
        player = session.execute(
            select(Player).where(Player.token_hash == hash_token(credentials.credentials))
        ).scalar_one_or_none()
        if player is None:
            raise _unauthorized()
        played = session.execute(
            select(MatchPlayer.side).where(
                MatchPlayer.match_id == match_id, MatchPlayer.player_id == player.id
            )
        ).first()
        if played is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not your match")
    root = service.replays_dir.resolve()
    file = (root / match.replay_path).resolve()
    if not file.is_relative_to(root) or not file.is_file():
        log.error("replay file is missing", extra={"match_id": match_id})
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="replay not found")
    cache = "public" if match.rated else "private"
    return FileResponse(
        file,
        media_type="application/json",
        headers={
            "Content-Encoding": "gzip",
            "Cache-Control": f"{cache}, max-age=3600, immutable",
        },
    )
