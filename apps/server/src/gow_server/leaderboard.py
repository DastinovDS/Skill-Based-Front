"""Leaderboard and player profiles (LB-01, #78): ``/api/leaderboard``, ``/api/players/{id}``.

Both are public reads: no token is needed, only a per-IP rate limit (``Limits.public_read``).
Who is shown follows DEC-34 (mechanics.md, section 19): the leaderboard and the rating of a profile
exist only for a password account that finished calibration, is not blocked, and has the displayed
rating ``r - 2 * RD`` (rounded to an integer, like ``match_end.rating``). A guest or an account in
calibration has a profile without a rating (``calibration`` says how far it is).

The profile lists the last matches of any kind. The rating change of a history row follows the
rule of ``match_end``: hidden for calibration matches, shown from the match that completes the
calibration on. A replay link says whether the replay can be opened by the caller: the replay of
an unrated match is only for its two players (``gow_server.replays``), so another viewer sees
``private`` (the optional ``Authorization`` header tells who is asking); a replay the retention
removed (SRV-08) is ``expired``. The state is read from the database only (no file access), so a
``ready`` replay may still answer 410 on the replay endpoint if its file was lost.

The endpoints are ``def``: they use the synchronous database (AGENTS.md, section 9).
"""

from collections.abc import Sequence
from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, Final, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlalchemy import ColumnElement, and_, case, func, or_, select
from sqlalchemy.orm import Session

from gow_protocol.messages import Calibration, RatingChange, UnratedReason
from gow_server.abuse import Limits, enforce
from gow_server.db import DbSession
from gow_server.identity import client_ip, hash_token
from gow_server.models import Match, MatchPlayer, Player, Rating
from gow_server.replays import ReplayService
from gow_server.settings import Settings

LEADERBOARD_SIZE: Final = 100
"""Rows of ``GET /api/leaderboard``."""
HISTORY_SIZE: Final = 20
"""Matches of the history of ``GET /api/players/{id}``."""

STATUS_SAVED: Final = "saved"


class Record(BaseModel):
    wins: int
    losses: int
    draws: int


class LeaderboardEntry(BaseModel):
    rank: int
    """1-based position; equal ratings are ordered by player id, so ranks are all different."""
    player_id: int
    nick: str
    rating: int
    """The displayed rating ``r - 2 * RD``, rounded."""
    rated_matches: int
    """Matches that changed the rating, calibration included."""
    record: Record
    """Results of those matches (``wins + losses + draws == rated_matches``)."""


class Leaderboard(BaseModel):
    entries: list[LeaderboardEntry]
    """The top ``LEADERBOARD_SIZE`` players, best first; empty until someone is calibrated."""
    total: int
    """Players that qualify for the leaderboard (may be more than ``entries``)."""
    min_rated_matches: int
    """Rated matches needed to appear (``GOW_CALIBRATION_MATCHES``, DEC-34)."""


class MatchKind(StrEnum):
    RATED = "rated"
    """A queue match between calibrated accounts."""
    CALIBRATION = "calibration"
    """A queue match that was a calibration match for this player."""
    UNRATED = "unrated"
    """A queue match that did not change this player's rating; ``unrated_reason`` says why."""
    CASUAL = "casual"
    """An invite or a lobby match (DEC-06)."""
    BOT = "bot"
    """A match against a bot."""


class ReplayLinkState(StrEnum):
    READY = "ready"
    PREPARING = "preparing"
    """The frames file is being built: retry."""
    EXPIRED = "expired"
    """The retention removed the replay (SRV-08, #515)."""
    UNAVAILABLE = "unavailable"
    """The match is over and no replay was or will be made (a failed build)."""
    PRIVATE = "private"
    """An unrated match: only its two players may open the replay."""


class ReplayLink(BaseModel):
    state: ReplayLinkState
    url: str | None
    """``/api/replays/{match_id}`` when the caller can open it (``ready``, ``preparing``)."""


class Opponent(BaseModel):
    player_id: int | None
    """``None`` for a bot."""
    nick: str
    """The bot's name for a bot."""
    bot: bool


class MatchEntry(BaseModel):
    match_id: int
    map_id: str
    ended_at: datetime | None
    ticks: int | None
    result: Literal["win", "loss", "draw"]
    end_reason: str | None
    kind: MatchKind
    unrated_reason: UnratedReason | None
    """Only for ``kind`` ``unrated``."""
    opponent: Opponent
    rating_change: RatingChange | None
    """Displayed rating before and after; ``None`` when the match did not change the rating or
    it was a calibration match whose rating is hidden."""
    replay: ReplayLink


class PlayerProfile(BaseModel):
    player_id: int
    nick: str
    has_password: bool
    """``False`` for a guest: it has no rating and is never on the leaderboard."""
    rating: int | None
    """The displayed rating; ``None`` for a guest and during calibration."""
    rank: int | None
    """Position on the leaderboard (also beyond the top 100); ``None`` without a rating."""
    calibration: Calibration | None
    """Progress of a password account in calibration; ``None`` for a guest and once it is over."""
    rated_matches: int
    rated_record: Record
    """Results of the matches that changed the rating."""
    record: Record
    """Results of all finished matches of any kind, bots included."""
    matches: list[MatchEntry]
    """The last ``HISTORY_SIZE`` finished matches, newest first."""


router = APIRouter(prefix="/api", tags=["leaderboard"])

_optional_bearer = HTTPBearer(auto_error=False)

_display_score = Rating.rating - 2.0 * Rating.rd
"""The displayed rating as an SQL expression."""


def _eligible(min_matches: int) -> list[ColumnElement[bool]]:
    return [
        Player.password_hash.is_not(None),
        Player.blocked_at.is_(None),
        Rating.rated_matches >= min_matches,
    ]


def _enforce_read_limit(request: Request) -> None:
    limits: Limits = request.app.state.limits
    enforce(limits.public_read, client_ip(request), "too many requests")


def _records(session: Session, player_ids: Sequence[int]) -> dict[int, tuple[Record, Record]]:
    """``(all finished matches, matches that changed the rating)`` of each player, one query."""
    changed = case((MatchPlayer.rating_before.is_not(None), 1), else_=0)
    rows = session.execute(
        select(
            MatchPlayer.player_id,
            MatchPlayer.result,
            func.count(),
            func.coalesce(func.sum(changed), 0),
        )
        .join(Match, Match.id == MatchPlayer.match_id)
        .where(MatchPlayer.player_id.in_(player_ids), Match.status == STATUS_SAVED)
        .group_by(MatchPlayer.player_id, MatchPlayer.result)
    ).all()
    total: dict[int, dict[str, int]] = {pid: {} for pid in player_ids}
    rated: dict[int, dict[str, int]] = {pid: {} for pid in player_ids}
    for player_id, result, count, changed_count in rows:
        if player_id is None or result is None:
            continue
        total[player_id][result] = count
        rated[player_id][result] = int(changed_count)

    def record(counts: dict[str, int]) -> Record:
        return Record(
            wins=counts.get("win", 0), losses=counts.get("loss", 0), draws=counts.get("draw", 0)
        )

    return {pid: (record(total[pid]), record(rated[pid])) for pid in player_ids}


@router.get("/leaderboard")
def get_leaderboard(request: Request, session: DbSession) -> Leaderboard:
    """The top 100 by the displayed rating ``r - 2 * RD``.

    Only password accounts that are not blocked and finished calibration (DEC-34): at least
    ``min_rated_matches`` rating-changing matches. Public; rate limited per client IP.
    """
    _enforce_read_limit(request)
    settings: Settings = request.app.state.settings
    eligible = _eligible(settings.calibration_matches)
    rows = session.execute(
        select(Player.id, Player.nick, _display_score, Rating.rated_matches)
        .join(Rating, Rating.player_id == Player.id)
        .where(*eligible)
        .order_by(_display_score.desc(), Player.id)
        .limit(LEADERBOARD_SIZE)
    ).all()
    total = session.execute(
        select(func.count())
        .select_from(Player)
        .join(Rating, Rating.player_id == Player.id)
        .where(*eligible)
    ).scalar_one()
    records = _records(session, [row[0] for row in rows])
    entries = [
        LeaderboardEntry(
            rank=rank,
            player_id=player_id,
            nick=nick,
            rating=round(score),
            rated_matches=rated_matches,
            record=records[player_id][1],
        )
        for rank, (player_id, nick, score, rated_matches) in enumerate(rows, start=1)
    ]
    return Leaderboard(entries=entries, total=total, min_rated_matches=settings.calibration_matches)


def _viewer_id(session: Session, credentials: HTTPAuthorizationCredentials | None) -> int | None:
    """The player behind an optional token; an unknown token or a blocked account is anonymous."""
    if credentials is None:
        return None
    return session.execute(
        select(Player.id).where(
            Player.token_hash == hash_token(credentials.credentials), Player.blocked_at.is_(None)
        )
    ).scalar_one_or_none()


@router.get(
    "/players/{player_id}",
    responses={404: {"description": "No such player, or the account is blocked."}},
)
def get_player(
    player_id: Annotated[int, Path(ge=1)],
    request: Request,
    session: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_optional_bearer)],
) -> PlayerProfile:
    """Rating, rank, records and the last 20 matches of a player (a guest or an account).

    Public; rate limited per client IP. An optional ``Authorization: Bearer <token>`` lets the
    replay links of the caller's own unrated matches open (``replay.state`` ``ready``); for
    anyone else they are ``private``. 404 for an unknown or blocked player.
    """
    _enforce_read_limit(request)
    settings: Settings = request.app.state.settings
    player = session.get(Player, player_id)
    if player is None or player.blocked_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="player not found")
    rating_row = session.get(Rating, player_id)
    rated_matches = 0 if rating_row is None else rating_row.rated_matches
    total = settings.calibration_matches
    has_password = player.password_hash is not None
    rating: int | None = None
    rank: int | None = None
    calibration: Calibration | None = None
    if has_password and rating_row is not None and rated_matches >= total:
        score = rating_row.rating - 2.0 * rating_row.rd
        rating = round(score)
        better = session.execute(
            select(func.count())
            .select_from(Player)
            .join(Rating, Rating.player_id == Player.id)
            .where(
                *_eligible(total),
                or_(_display_score > score, and_(_display_score == score, Player.id < player_id)),
            )
        ).scalar_one()
        rank = better + 1
    elif has_password:
        calibration = Calibration(played=rated_matches, total=total)
    record, rated_record = _records(session, [player_id])[player_id]
    viewer = _viewer_id(session, credentials)
    replays: ReplayService = request.app.state.replays
    return PlayerProfile(
        player_id=player.id,
        nick=player.nick,
        has_password=has_password,
        rating=rating,
        rank=rank,
        calibration=calibration,
        rated_matches=rated_matches,
        rated_record=rated_record,
        record=record,
        matches=_history(session, player_id, rated_matches, viewer, replays, total),
    )


def _history(
    session: Session,
    player_id: int,
    rated_matches: int,
    viewer: int | None,
    replays: ReplayService,
    calibration_total: int,
) -> list[MatchEntry]:
    own_rows = session.execute(
        select(Match, MatchPlayer)
        .join(MatchPlayer, MatchPlayer.match_id == Match.id)
        .where(MatchPlayer.player_id == player_id, Match.status == STATUS_SAVED)
        .order_by(Match.ended_at.desc(), Match.id.desc())
        .limit(HISTORY_SIZE)
    ).all()
    if not own_rows:
        return []
    ids = [match.id for match, _ in own_rows]
    opponents = _opponents(session, ids, player_id)
    ordinals = _rating_ordinals(session, player_id, rated_matches, ids)
    shared = _shared_matches(session, viewer, player_id, ids)
    entries: list[MatchEntry] = []
    for match, own in own_rows:
        opponent = opponents.get(match.id, Opponent(player_id=None, nick="", bot=False))
        changed = own.rating_before is not None and own.rating_after is not None
        kind = _kind(own, opponent, changed)
        shown = changed and ordinals.get(match.id, 0) >= calibration_total
        rating_change = (
            RatingChange(before=round(own.rating_before), after=round(own.rating_after))
            if shown and own.rating_before is not None and own.rating_after is not None
            else None
        )
        assert own.result in ("win", "loss", "draw")
        entries.append(
            MatchEntry(
                match_id=match.id,
                map_id=match.map_id,
                ended_at=None if match.ended_at is None else match.ended_at.replace(tzinfo=UTC),
                ticks=match.ticks,
                result=own.result,
                end_reason=match.end_reason,
                kind=kind,
                unrated_reason=(
                    UnratedReason(own.unrated_reason)
                    if kind is MatchKind.UNRATED and own.unrated_reason is not None
                    else None
                ),
                opponent=opponent,
                rating_change=rating_change,
                replay=_replay_link(match, match.id in shared, replays),
            )
        )
    return entries


def _kind(own: MatchPlayer, opponent: Opponent, changed: bool) -> MatchKind:
    if opponent.bot:
        return MatchKind.BOT
    if own.rating_mode == "calibration":
        return MatchKind.CALIBRATION
    if changed:
        return MatchKind.RATED
    # Only queue matches record why they did not change the rating; an invite or a lobby match
    # has no reason (DEC-06).
    return MatchKind.UNRATED if own.unrated_reason is not None else MatchKind.CASUAL


def _opponents(session: Session, match_ids: Sequence[int], player_id: int) -> dict[int, Opponent]:
    rows = session.execute(
        select(MatchPlayer.match_id, MatchPlayer.player_id, MatchPlayer.bot, Player.nick)
        .outerjoin(Player, Player.id == MatchPlayer.player_id)
        .where(
            MatchPlayer.match_id.in_(match_ids),
            or_(MatchPlayer.player_id.is_(None), MatchPlayer.player_id != player_id),
        )
    ).all()
    return {
        match_id: Opponent(
            player_id=opponent_id,
            nick=nick or bot or "",
            bot=bot is not None,
        )
        for match_id, opponent_id, bot, nick in rows
    }


def _rating_ordinals(
    session: Session, player_id: int, rated_matches: int, match_ids: Sequence[int]
) -> dict[int, int]:
    """For each listed match that changed the player's rating, how many rating-changing matches
    the player had up to and including it (1-based).

    Counted back from ``ratings.rated_matches`` (the total) by the newer rating-changing matches
    (by match id: a player never has two matches at once), so a history older than the stored
    rows does not shift the numbers.
    """
    numbered = (
        select(
            MatchPlayer.match_id.label("match_id"),
            func.row_number().over(order_by=MatchPlayer.match_id.desc()).label("newest"),
        )
        .where(MatchPlayer.player_id == player_id, MatchPlayer.rating_before.is_not(None))
        .subquery()
    )
    rows = session.execute(
        select(numbered.c.match_id, numbered.c.newest).where(numbered.c.match_id.in_(match_ids))
    ).all()
    return {match_id: rated_matches - newest + 1 for match_id, newest in rows}


def _shared_matches(
    session: Session, viewer: int | None, player_id: int, match_ids: Sequence[int]
) -> set[int]:
    """Ids among ``match_ids`` the viewer played in (so may open their replays)."""
    if viewer is None:
        return set()
    if viewer == player_id:
        return set(match_ids)
    return set(
        session.execute(
            select(MatchPlayer.match_id).where(
                MatchPlayer.player_id == viewer, MatchPlayer.match_id.in_(match_ids)
            )
        ).scalars()
    )


def _replay_link(match: Match, played_in: bool, replays: ReplayService) -> ReplayLink:
    """The replay state from the database and the in-memory build set; no file access."""
    if match.replay_expired_at is not None:
        return ReplayLink(state=ReplayLinkState.EXPIRED, url=None)
    if not match.rated and not played_in:  # the rule of GET /api/replays/{id}
        return ReplayLink(state=ReplayLinkState.PRIVATE, url=None)
    url = f"/api/replays/{match.id}"
    if match.replay_path:
        return ReplayLink(state=ReplayLinkState.READY, url=url)
    if replays.is_building(str(match.id)):
        return ReplayLink(state=ReplayLinkState.PREPARING, url=url)
    return ReplayLink(state=ReplayLinkState.UNAVAILABLE, url=None)
