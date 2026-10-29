"""Replay retention (SRV-08, #515): how long replay files are kept and the task that removes them.

Every finished match leaves a command log and a frames file (``gow_server.replays``). Without a
limit they grow forever and every backup carries them. The policy is two numbers of days, one for
unrated matches (invites, the lobby, bot matches) and one for rated ones, whose replays are public;
0 keeps the files forever. The age counts from the end of the match.

``ReplayService.purge_expired`` does one pass (blocking: file and database work), and
``run_cleanup`` repeats it from the lifespan of the app, each pass in a thread, so a large replays
directory never blocks the event loop of the matches (AGENTS.md, sections 5.2 and 9).
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Final

from gow_server.clock import Clock
from gow_server.models import Match

if TYPE_CHECKING:
    from gow_server.replays import ReplayService

log = logging.getLogger("gow_server.replays")

BATCH: Final = 200
"""Matches looked up and updated in one database transaction."""


@dataclass(frozen=True, slots=True)
class RetentionPolicy:
    unrated_days: int
    rated_days: int
    """0: keep forever."""

    def days_for(self, match: Match) -> int:
        return self.rated_days if match.rated else self.unrated_days

    def expires_at(self, match: Match) -> datetime | None:
        """Moment from which the replay of ``match`` may be removed (``None``: never)."""
        days = self.days_for(match)
        if days <= 0:
            return None
        return (match.ended_at or match.created_at) + timedelta(days=days)


@dataclass(frozen=True, slots=True)
class PurgeResult:
    files_removed: int = 0
    bytes_removed: int = 0
    matches_expired: int = 0
    orphans_removed: int = 0
    bytes_kept: int = 0


async def run_cleanup(service: "ReplayService", clock: Clock, interval_s: float) -> None:
    """Purge now, then every ``interval_s`` of the clock, until cancelled. A failed pass is logged
    and tried again at the next one."""
    while True:
        try:
            result = await asyncio.to_thread(service.purge_expired, clock.wall())
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("replay cleanup failed")
        else:
            log.info(
                "replay cleanup",
                extra={
                    "files_removed": result.files_removed,
                    "bytes_removed": result.bytes_removed,
                    "matches_expired": result.matches_expired,
                    "orphans_removed": result.orphans_removed,
                    "bytes_kept": result.bytes_kept,
                },
            )
        await clock.sleep(interval_s)
