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

The frames file takes seconds to minutes after the match (the whole match is simulated again, and
builds queue behind each other in the worker pool), so the endpoint tells three cases apart
(``ReplayState``, #259): ready (200 and the file), preparing (202: the match is still running or
its frames are being built, try again), unavailable (410: the match is over and no build is
running, so none will appear: the build failed, the server died while building, or the match
never finished). A match that does not exist is 404.

A replay always belongs to its match (#280). Match ids are only unique within one database: a new
database (a new volume, a deleted ``gow.db``) starts again from 1 while old files may remain, and a
browser may remember ``/api/replays/1`` of the previous database. Therefore (1) only the file named
in ``matches.replay_path`` is served (no guess by ``{id}``), a stale ``{id}.frames.json.gz`` is
removed when a match with that id starts, and its header (map, ruleset, ticks) must agree with the
``matches`` row; (2) the file is sent with ``Cache-Control: no-cache`` and an ``ETag`` that names
the match instance (id, creation time) and the file, so a browser asks again every time and never
shows the file of another match.
"""

import asyncio
import gzip
import logging
import multiprocessing
import re
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Final, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from gow_server.db import DbSession
from gow_server.frames import FramesResult, build_frames
from gow_server.identity import hash_token
from gow_server.lifecycle import STATUS_RUNNING
from gow_server.models import Match, MatchPlayer, Player
from gow_server.replay_retention import BATCH, PurgeResult, RetentionPolicy
from gow_sim.replay import ReplayWriter

log = logging.getLogger("gow_server.replays")

LOG_SUFFIX: Final = ".jsonl.gz"
FRAMES_SUFFIX: Final = ".frames.json.gz"
_MATCH_ID_RE: Final = re.compile(r"[A-Za-z0-9_-]{1,64}")
_HEADER_BYTES: Final = 1024
"""Unzipped bytes read to check the identity of a frames file: its header keys come first."""
_HEADER_STR_RE: Final = r'"{key}":"([^"]*)"'
_HEADER_INT_RE: Final = r'"{key}":(\d+)'

RETRY_AFTER_S: Final = 2
"""``Retry-After`` of a replay that is still being prepared (the client backs off from there)."""


class ReplayState(StrEnum):
    READY = "ready"
    PREPARING = "preparing"
    UNAVAILABLE = "unavailable"


class ReplayPreparing(BaseModel):
    """Body of ``202``: the replay will be there shortly (or when the match is over)."""

    status: Literal["preparing"] = "preparing"


class ReplayGone(BaseModel):
    """Body of ``410``. ``reason`` ``expired``: the retention removed the files (SRV-08);
    ``unavailable``: the match is over and no frames were or will be made."""

    detail: str
    reason: Literal["expired", "unavailable"]


def _header_agrees(file: Path, match: Match) -> bool:
    """The map, ruleset and length in the head of the frames file are those of the ``matches`` row.

    Reads only the start of the unzipped file; a key that is not found there is not checked.
    """
    try:
        with gzip.open(file, "rb") as f:
            head = f.read(_HEADER_BYTES).decode("ascii", errors="replace")
    except (OSError, EOFError):
        return False
    for key, expected in (("map_id", match.map_id), ("ruleset_hash", match.ruleset_hash)):
        found = re.search(_HEADER_STR_RE.format(key=key), head)
        if found is not None and found.group(1) != expected:
            return False
    ticks = re.search(_HEADER_INT_RE.format(key="ticks"), head)
    if ticks is None or match.ticks is None:
        return True
    return int(ticks.group(1)) == match.ticks


def replay_etag(match: Match, file: Path) -> str:
    """Names this match instance and this file: the same id in another database differs."""
    stat = file.stat()
    created = int(match.created_at.timestamp() * 1000)
    return f'"m{match.id}-{created}-{stat.st_mtime_ns}-{stat.st_size}"'


class ReplayService:
    """Where replay files go and how a finished match becomes a frames file."""

    def __init__(
        self,
        replays_dir: Path,
        rulesets_dir: Path,
        maps_dir: Path,
        sessions: sessionmaker[Session],
        workers: int = 1,
        retention: RetentionPolicy | None = None,
    ) -> None:
        self.replays_dir: Final = replays_dir
        self.rulesets_dir: Final = rulesets_dir
        self.maps_dir: Final = maps_dir
        self._sessions: Final = sessions
        self._workers: Final = workers
        self.retention: Final = retention or RetentionPolicy(unrated_days=0, rated_days=0)
        """Used by ``purge_expired`` (SRV-08); the default keeps every replay."""
        self._pool: ProcessPoolExecutor | None = None
        self._tasks: set[asyncio.Task[FramesResult | None]] = set()
        self._building: set[str] = set()
        """Ids of the matches whose frames are being built (from ``schedule`` to the end)."""

    def log_path(self, match_id: str) -> Path:
        return self.replays_dir / (self._checked(match_id) + LOG_SUFFIX)

    def discard_log(self, match_id: str) -> None:
        """Delete the command log of a match that never started (#412)."""
        self.log_path(match_id).unlink(missing_ok=True)

    def frames_name(self, match_id: str) -> str:
        """Name of the frames file relative to ``replays_dir``: the value of ``replay_path``."""
        return self._checked(match_id) + FRAMES_SUFFIX

    def writer(self, match_id: str) -> ReplayWriter:
        """The log writer of a match that is about to start (the file opens at its first tick).

        A frames file left under this id by an older database is removed: it is not this match's.
        """
        stale = self.replays_dir / self.frames_name(match_id)
        stale.unlink(missing_ok=True)
        stale.with_name(stale.name + ".tmp").unlink(missing_ok=True)
        return ReplayWriter(self.log_path(match_id), flush_at_checkpoints=True)

    @staticmethod
    def _checked(match_id: str) -> str:
        if not _MATCH_ID_RE.fullmatch(match_id):
            raise ValueError(f"match id {match_id!r} is not usable in a file name")
        return match_id

    # After the match ---------------------------------------------------------------------------

    def schedule(self, match_id: str) -> asyncio.Task[FramesResult | None]:
        """Start ``finalize`` as a task that ``aclose()`` waits for. Needs a running loop."""
        self._building.add(match_id)  # before the task starts: no gap for the HTTP side
        task = asyncio.create_task(self.finalize(match_id), name=f"replay-{match_id}")
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    async def finalize(self, match_id: str) -> FramesResult | None:
        """Re-simulate the log of a finished match in a worker process and publish the frames.

        Returns ``None`` (after logging the reason) when the log cannot be turned into frames:
        the match then simply has no replay for viewing; the command log stays for analysis.
        """
        try:
            return await self._build(match_id)
        finally:
            self._building.discard(match_id)

    async def _build(self, match_id: str) -> FramesResult | None:
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

    def frames_file(self, match: Match) -> Path | None:
        """The frames file of ``match``: the one in ``replay_path``, on disk, inside ``replays_dir``
        and with the header of this match (``None`` otherwise).

        There is no fallback to ``{id}.frames.json.gz``: the id alone does not say whose file it is.
        """
        if not match.replay_path:
            return None
        root = self.replays_dir.resolve()
        file = (root / match.replay_path).resolve()
        if not (file.is_relative_to(root) and file.is_file()):
            return None
        if not _header_agrees(file, match):
            log.error(
                "frames file does not belong to its match",
                extra={"match_id": match.id, "file": file.name},
            )
            return None
        return file

    def state(self, match: Match) -> ReplayState:
        """Where the replay of ``match`` is. Blocking only for a ``stat`` (call from a ``def``)."""
        if self.frames_file(match) is not None:
            return ReplayState.READY
        if match.status == STATUS_RUNNING or self.is_building(str(match.id)):
            return ReplayState.PREPARING
        return ReplayState.UNAVAILABLE

    # Retention (SRV-08) -----------------------------------------------------------------------

    def is_building(self, match_id: str) -> bool:
        return match_id in self._building

    def _scan(self) -> dict[str, list[tuple[Path, int, datetime]]]:
        """Replay files by match id: ``(path, size, modified)``. ``modified`` is naive UTC."""
        found: defaultdict[str, list[tuple[Path, int, datetime]]] = defaultdict(list)
        if not self.replays_dir.is_dir():
            return found
        for path in self.replays_dir.iterdir():
            name = path.name
            if not name.endswith((LOG_SUFFIX, FRAMES_SUFFIX, FRAMES_SUFFIX + ".tmp")):
                continue
            match_id = name.split(".", 1)[0]
            if not _MATCH_ID_RE.fullmatch(match_id):
                continue
            try:
                stat = path.stat()
            except OSError:  # removed since the listing
                continue
            modified = datetime.fromtimestamp(stat.st_mtime, UTC).replace(tzinfo=None)
            found[match_id].append((path, stat.st_size, modified))
        return found

    def purge_expired(self, now: datetime) -> PurgeResult:
        """Delete the replay files that outlived the retention (blocking: call from a thread).

        A match past its retention loses its command log and frames file, its row gets
        ``replay_path = NULL`` and ``replay_expired_at = now``. Matches that are running or whose
        frames are being built are skipped. Files of no match (a database that was reset, a
        leftover ``.tmp``) are removed once they are older than the unrated retention. With the
        database updated first, a crash between the two steps leaves files that the next pass
        removes.
        """
        files = self._scan()
        ids = sorted(files)
        removed_files = removed_bytes = expired = orphans = 0
        kept = sum(size for group in files.values() for _, size, _ in group)
        orphan_days = self.retention.unrated_days
        for start in range(0, len(ids), BATCH):
            chunk = ids[start : start + BATCH]
            doomed: list[tuple[Path, int]] = []
            with self._sessions.begin() as session:
                rows = {
                    str(match.id): match
                    for match in session.execute(
                        select(Match).where(Match.id.in_([int(i) for i in chunk if i.isdecimal()]))
                    ).scalars()
                }
                for match_id in chunk:
                    group = files[match_id]
                    if self.is_building(match_id):
                        continue
                    row = rows.get(match_id)
                    if row is None:
                        if orphan_days > 0 and all(
                            (now - modified).days >= orphan_days for _, _, modified in group
                        ):
                            doomed.extend((path, size) for path, size, _ in group)
                            orphans += len(group)
                        continue
                    if row.status == STATUS_RUNNING:
                        continue
                    due = self.retention.expires_at(row)
                    if due is None or due > now:
                        continue
                    doomed.extend((path, size) for path, size, _ in group)
                    if row.replay_path is not None:
                        row.replay_path = None
                        row.replay_expired_at = now
                        expired += 1
            for path, size in doomed:
                try:
                    path.unlink()
                except FileNotFoundError:
                    continue
                except OSError:
                    log.exception("replay file not removed", extra={"file": path.name})
                    continue
                removed_files += 1
                removed_bytes += size
        return PurgeResult(removed_files, removed_bytes, expired, orphans, kept - removed_bytes)

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


@router.get(
    "/{match_id}",
    response_class=FileResponse,
    responses={
        202: {"model": ReplayPreparing, "description": "The replay is being prepared: retry."},
        404: {"description": "No such match."},
        410: {
            "model": ReplayGone,
            "description": "The replay expired (retention), or the match is over and none is made.",
        },
    },
)
def get_replay(
    request: Request,
    match_id: int,
    session: DbSession,
    service: Annotated[ReplayService, Depends(_service)],
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_optional_bearer)],
) -> Response:
    """The frames file of a finished match (``docs/design/replay-frames.md``), gzip as stored.

    Rated matches: public. Others: 401 without a valid token, 403 for a player outside the match.
    404: no such match. 202 (``Retry-After``): the match runs or the frames are being built.
    410: the match is over and there will be no frames (failed build, crash, aborted match), or
    the retention removed them (``reason: expired``, SRV-08).
    """
    match = session.get(Match, match_id)
    if match is None:
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
    if match.replay_expired_at is not None:
        return JSONResponse(
            ReplayGone(detail="replay has expired", reason="expired").model_dump(),
            status_code=status.HTTP_410_GONE,
        )
    state = service.state(match)
    if state is ReplayState.PREPARING:
        return JSONResponse(
            ReplayPreparing().model_dump(),
            status_code=status.HTTP_202_ACCEPTED,
            headers={"Retry-After": str(RETRY_AFTER_S), "Cache-Control": "no-store"},
        )
    file = service.frames_file(match)
    if state is ReplayState.UNAVAILABLE or file is None:
        log.warning("replay is not available", extra={"match_id": match_id})
        return JSONResponse(
            ReplayGone(detail="replay is not available", reason="unavailable").model_dump(),
            status_code=status.HTTP_410_GONE,
        )
    # no-cache: the browser may keep the file but asks every time (a match id can come back with
    # another match behind it after a database reset), the ETag makes that a cheap 304.
    cache = "public" if match.rated else "private"
    etag = replay_etag(match, file)
    headers = {"Cache-Control": f"{cache}, no-cache", "ETag": etag}
    if_none_match = request.headers.get("if-none-match", "")
    if etag in {tag.strip() for tag in if_none_match.split(",")}:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return FileResponse(
        file,
        media_type="application/json",
        headers={"Content-Encoding": "gzip", **headers},
    )
