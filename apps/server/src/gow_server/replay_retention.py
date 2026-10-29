"""Replay retention (SRV-08, #515, #525): which replay files are kept and who removes the rest.

Every finished match leaves a command log and a frames file (``gow_server.replays``). Without a
limit they grow forever and every backup carries them. The main rule (#525) is a cap per account:
a replay is kept while its match is among the ``keep_per_player`` most recent finished matches of
at least one of its human players (``recent_match_ids``). Two optional extra limits are numbers of
days, one for unrated matches (invites, the lobby, bot matches) and one for rated ones, whose
replays are public; 0 switches a limit off. The age counts from the end of the match.

For game statistics during development and playtests the command log of a replay can be copied
into an archive directory before the replay expires (``archive_log``).

``ReplayService.purge_expired`` does one pass (blocking: file and database work), and
``run_cleanup`` repeats it from the lifespan of the app, each pass in a thread, so a large replays
directory never blocks the event loop of the matches (AGENTS.md, sections 5.2 and 9).
"""

import asyncio
import logging
import os
import shutil
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Final

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from gow_server.clock import Clock
from gow_server.lifecycle import STATUS_SAVED
from gow_server.models import Match, MatchPlayer

if TYPE_CHECKING:
    from gow_server.replays import ReplayService

log = logging.getLogger("gow_server.replays")

BATCH: Final = 200
"""Matches looked up and updated in one database transaction."""

ORPHAN_GRACE_DAYS: Final = 7
"""Files of no match (a reset database, a leftover ``.tmp``) are removed after this many days when
no unrated limit is set."""


def recent_match_ids(session: Session, per_player: int) -> set[int]:
    """Ids of the finished (``saved``) matches that are among the ``per_player`` most recent of at
    least one human player. Bot sides do not count; a guest is a player like any other."""
    recency = func.coalesce(Match.ended_at, Match.created_at)
    rank = (
        func.row_number()
        .over(
            partition_by=MatchPlayer.player_id,
            order_by=(recency.desc(), Match.id.desc()),
        )
        .label("rank")
    )
    ranked = (
        select(Match.id.label("match_id"), rank)
        .join(MatchPlayer, MatchPlayer.match_id == Match.id)
        .where(MatchPlayer.player_id.is_not(None), Match.status == STATUS_SAVED)
        .subquery()
    )
    recent = select(ranked.c.match_id).where(ranked.c.rank <= per_player)
    return set(session.execute(recent).scalars())


def archive_log(log: Path, archive_dir: Path, match: Match) -> Path:
    """Copy the command log of ``match`` into ``archive_dir/<date>/<id>-<created>.jsonl.gz``.

    The date is that of the creation of the match, so ``archive_dir/*/*.jsonl.gz`` lists the lot.
    The file appears whole (written to a ``.tmp`` and renamed) and an existing one is left alone:
    a log never changes once the match is over, so a second pass is a no-op. Raises ``OSError``.
    """
    created = match.created_at
    target = archive_dir / f"{created:%Y-%m-%d}" / f"{match.id}-{created:%Y%m%dT%H%M%S}.jsonl.gz"
    if target.exists():
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + ".tmp")
    try:
        shutil.copyfile(log, tmp)
        os.replace(tmp, target)
    finally:
        tmp.unlink(missing_ok=True)
    return target


@dataclass(frozen=True, slots=True)
class RetentionPolicy:
    unrated_days: int
    rated_days: int
    """0: no age limit."""
    keep_per_player: int = 0
    """0: no cap per account."""

    def days_for(self, match: Match) -> int:
        return self.rated_days if match.rated else self.unrated_days

    def expires_at(self, match: Match) -> datetime | None:
        """Moment from which the replay of ``match`` may be removed (``None``: never)."""
        days = self.days_for(match)
        if days <= 0:
            return None
        return (match.ended_at or match.created_at) + timedelta(days=days)

    def expired(self, match: Match, now: datetime, recent: set[int] | None) -> bool:
        """The replay of ``match`` is to go: outside the cap (``recent`` from ``recent_match_ids``,
        ``None`` without a cap) or past an age limit."""
        if recent is not None and match.id not in recent:
            return True
        due = self.expires_at(match)
        return due is not None and due <= now


@dataclass(frozen=True, slots=True)
class PurgeResult:
    files_removed: int = 0
    bytes_removed: int = 0
    matches_expired: int = 0
    orphans_removed: int = 0
    bytes_kept: int = 0
    archived: int = 0


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
                    "archived": result.archived,
                },
            )
        await clock.sleep(interval_s)
