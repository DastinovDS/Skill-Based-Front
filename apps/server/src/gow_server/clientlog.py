"""Client diagnostics in the server log (#810).

``POST /api/client-log`` takes a report of the player's client: its uncaught errors, console
errors and warnings, long frames, snapshot gaps and WebSocket closes (``reason = "batch"``, sent
at most every 10 s), or the dump of the "mark problem" key (``reason = "mark"``): the same entries
of the last 60 s and a timeline of the last 60 seconds (frames, the longest frame, snapshots).

A report becomes one JSON line of the logger ``gow_server.client`` with the player id, the match
id and tick, the client version and the user agent. It goes to stderr like every log and, when
``GOW_CLIENT_LOG_DIR`` is set, into ``<dir>/client.jsonl`` as well (rotated by size,
``GOW_CLIENT_LOG_MAX_BYTES`` and ``GOW_CLIENT_LOG_FILES``): in the stack that directory is the
volume ``gow-client-logs``, which ``stack:reset`` keeps. ``python -m gow_server.clientlog <match>``
(``mise run logs <match>``) prints the lines of one match.

Every text the client sends is short (the model caps it) and whatever looks like a token is cut
out of it again here (AGENTS.md, sections 5.3 and 5.5): the client cuts it too, the log must not
rely on that. The token of the request is never logged.
"""

import argparse
import json
import logging
import re
import sys
from collections.abc import Iterator
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Annotated, Final, Literal, cast

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, ConfigDict, Field

from gow_server.abuse import Limits, enforce
from gow_server.identity import CurrentPlayer
from gow_server.logs import JsonFormatter
from gow_server.settings import Settings

client_log = logging.getLogger("gow_server.client")

LOG_FILE: Final = "client.jsonl"
MAX_TEXT: Final = 300
"""The longest message of an entry (the client cuts its lines to the same length)."""
MAX_ENTRIES: Final = 50
MAX_SECONDS: Final = 60
MAX_USER_AGENT: Final = 200

SECRET: Final = re.compile(r"[A-Za-z0-9_-]{32,}")
"""A run this long of URL-safe characters can be a token (43 characters): it is never logged.
The same rule as the client's ``errorLog.ts``."""

_STRICT = ConfigDict(extra="forbid", hide_input_in_errors=True)


def scrub(text: str, limit: int = MAX_TEXT) -> str:
    """``text`` without anything that looks like a token, at most ``limit`` characters."""
    return SECRET.sub("[cut]", text)[:limit]


class ClientEntry(BaseModel):
    """One thing the client noticed; repeats of the same kind and message are one entry."""

    model_config = _STRICT

    kind: Literal["error", "warn", "stall", "gap", "ws_close"]
    """``error``, ``warn``: a console error or warning of the client (an uncaught error, an
    unhandled rejection, a failed screen or map frame, a refused command); ``stall``: a frame
    later than 200 ms after the previous one; ``gap``: no snapshot for more than 1 s while
    connected; ``ws_close``: the match WebSocket closed (not the normal close)."""
    msg: str = Field(max_length=MAX_TEXT)
    count: int = Field(default=1, ge=1, le=1_000_000)
    """How many times it happened within the report."""
    ms: int | None = Field(default=None, ge=0, le=86_400_000)
    """The longest stall or gap, in milliseconds."""
    hidden: bool = False
    """The tab was hidden during the stall or gap: the browser held it back, not a bug."""
    t_ms: int = Field(ge=0, le=2**53)
    """When it first happened, in milliseconds since the page loaded."""
    tick: int | None = Field(default=None, ge=0, le=2**31)
    """The last tick the client had then; ``None`` outside a match."""


class ClientSecond(BaseModel):
    """One second of the timeline of a "mark problem" dump."""

    model_config = _STRICT

    frames: int = Field(ge=0, le=10_000)
    frame_max_ms: int = Field(ge=0, le=86_400_000)
    """The longest time between two frames that ended in this second."""
    snapshots: int = Field(ge=0, le=10_000)
    hidden: bool
    """The tab was hidden for some of this second."""


class ClientReport(BaseModel):
    """``POST /api/client-log``: a batch of entries or a "mark problem" dump (#810)."""

    model_config = _STRICT

    reason: Literal["batch", "mark"]
    match_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,64}$")
    """The match the client is in, ``None`` outside a match."""
    tick: int | None = Field(default=None, ge=0, le=2**31)
    """The last tick the client had when it sent the report."""
    client_version: str = Field(max_length=32, pattern=r"^[A-Za-z0-9._+-]*$")
    entries: list[ClientEntry] = Field(default_factory=list[ClientEntry], max_length=MAX_ENTRIES)
    dropped: int = Field(default=0, ge=0, le=1_000_000)
    """Entries the client left out: more than ``MAX_ENTRIES`` different ones in one batch."""
    seconds: list[ClientSecond] = Field(
        default_factory=list[ClientSecond], max_length=MAX_SECONDS
    )
    """A mark only: the last 60 seconds, oldest first, the last one is the second of the key."""


def write(report: ClientReport, player_id: int, user_agent: str) -> None:
    """The report as one line of ``gow_server.client``."""
    entries = [
        entry.model_copy(update={"msg": scrub(entry.msg)}).model_dump(exclude_defaults=True)
        for entry in report.entries
    ]
    extra: dict[str, object] = {
        "reason": report.reason,
        "player_id": player_id,
        "match_id": report.match_id,
        "tick": report.tick,
        "client_version": report.client_version,
        "user_agent": scrub(user_agent, MAX_USER_AGENT),
        "entries": entries,
    }
    if report.dropped:
        extra["dropped"] = report.dropped
    if report.reason == "mark":
        extra["seconds"] = [second.model_dump() for second in report.seconds]
    client_log.warning(
        "client mark" if report.reason == "mark" else "client report", extra=extra
    )


def open_file_log(settings: Settings) -> RotatingFileHandler | None:
    """Write ``gow_server.client`` into ``<GOW_CLIENT_LOG_DIR>/client.jsonl`` too; ``None`` when
    the directory is not set. The caller closes the handler with ``close_file_log``."""
    directory = settings.client_log_dir
    if directory is None:
        return None
    directory.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(
        directory / LOG_FILE,
        maxBytes=settings.client_log_max_bytes,
        backupCount=settings.client_log_files,
        encoding="utf-8",
    )
    handler.setFormatter(JsonFormatter())
    client_log.addHandler(handler)
    return handler


def close_file_log(handler: RotatingFileHandler | None) -> None:
    if handler is not None:
        client_log.removeHandler(handler)
        handler.close()


def _limits(request: Request) -> Limits:
    limits: Limits = request.app.state.limits
    return limits


router = APIRouter(prefix="/api", tags=["diagnostics"])


@router.post("/client-log", status_code=status.HTTP_204_NO_CONTENT)
def client_report(
    body: ClientReport,
    request: Request,
    player: CurrentPlayer,
    limits: Annotated[Limits, Depends(_limits)],
) -> None:
    """A report of the player's client into the server log (#810); 429 past the per-player limit
    (``GOW_CLIENT_LOG_RATE_LIMIT`` within ``GOW_CLIENT_LOG_RATE_WINDOW_S``)."""
    enforce(limits.client_log, str(player.id), "too many client reports")
    write(body, player.id, request.headers.get("user-agent", ""))


def log_files(directory: Path) -> list[Path]:
    """The files of the client log, oldest first (``client.jsonl.5`` .. ``client.jsonl``)."""
    rotated = sorted(
        (path for path in directory.glob(f"{LOG_FILE}.*") if path.suffix[1:].isdigit()),
        key=lambda path: int(path.suffix[1:]),
        reverse=True,
    )
    current = directory / LOG_FILE
    return [*rotated, *([current] if current.exists() else [])]


def lines_of(directory: Path, match_id: str) -> Iterator[str]:
    """The lines of one match, oldest first; a line that is not a JSON object is skipped."""
    for path in log_files(directory):
        with path.open(encoding="utf-8", errors="replace") as file:
            for line in file:
                try:
                    record: object = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if (
                    isinstance(record, dict)
                    and cast(dict[str, object], record).get("match_id") == match_id
                ):
                    yield line.rstrip("\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m gow_server.clientlog",
        description="Print the client diagnostics of one match (#810), oldest first.",
    )
    parser.add_argument("match_id")
    parser.add_argument(
        "--dir",
        type=Path,
        default=None,
        help="the client log directory (default: GOW_CLIENT_LOG_DIR)",
    )
    args = parser.parse_args(argv)
    directory: Path | None = args.dir or Settings().client_log_dir
    if directory is None:
        print("no client log directory: set GOW_CLIENT_LOG_DIR or pass --dir", file=sys.stderr)
        return 2
    found = 0
    for line in lines_of(directory, args.match_id):
        print(line)
        found += 1
    if found == 0:
        print(f"no client diagnostics of match {args.match_id} in {directory}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
