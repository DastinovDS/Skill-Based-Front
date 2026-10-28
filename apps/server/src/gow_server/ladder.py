"""Rating-farming protection (DEC-34, #414; mechanics.md, section 19).

Who changes whose rating in a queue match, decided once at the start (``plan_queue_match``) and
settled once at the end (``settle``). Both the match runner (for ``match_end``, no I/O in the
tick) and the database transaction (``apply_match``) call the same ``settle``, so what a player is
told is what is stored.

Rules, per side of a queue match between two accounts:

- a guest (no password) never changes a rating, and neither does a match against one;
- the first ``calibration_matches`` matches of an account are calibration matches: its Glicko-2
  rating changes but is hidden, and the match never changes the opponent's rating;
- a calibrated account against a calibrated one: a full rated match;
- more than ``opponent_limit`` rated matches of the same two accounts within the window: unrated;
- a resign (``Forfeit``) or a technical defeat before ``early_resign_s`` of match time: the loser
  is rated as usual, the winner's rating does not change;
- repeated resigns in rated matches within ``resign_window_s`` ban the player from the queue
  (``record_resign``).

A player's calibration progress is ``ratings.rated_matches``: while the account is calibrating,
every match that changed its rating was a calibration match. Matches that do not change a rating
(unrated, the early-resign winner, the calibrated side of a calibration match) do not count.

The database functions are blocking: call them through ``asyncio.to_thread``.
"""

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Final

from sqlalchemy import func, select
from sqlalchemy import update as sql_update
from sqlalchemy.orm import Session, aliased

from gow_protocol.messages import Calibration, RatingChange, UnratedReason
from gow_server.models import Match, MatchPlayer, Player
from gow_server.rating import (
    DRAW,
    LOSS,
    WIN,
    Glicko,
    displayed_rating,
    played_of,
    rating_of,
    store_rating,
    update,
)

RESIGN_END_REASONS: Final = frozenset({"forfeit", "disconnect", "no_show"})
"""``matches.end_reason`` values of a resign: a surrender, a disconnect or a no-show (a technical
defeat, DEC-05). A draw (``double_defeat``) is not a resign: it has none of these."""

DEFAULT_TICK_HZ: Final = 10

_RESULTS: Final = frozenset({"win", "loss", "draw"})


class RatingMode(StrEnum):
    """What a match does to one side's rating (stored in ``match_players.rating_mode``)."""

    NONE = "none"
    CALIBRATION = "calibration"
    """The rating changes but is not shown."""
    RATED = "rated"


@dataclass(frozen=True, slots=True)
class LadderRules:
    """The numbers of DEC-34, from ``Settings`` (``gow_server.settings``)."""

    calibration_matches: int = 5
    early_resign_s: int = 180
    resign_window_s: int = 86400
    resign_ban_second_s: int = 300
    resign_ban_third_s: int = 1800
    resign_ban_later_s: int = 7200
    opponent_limit: int = 3
    opponent_limit_window_s: int = 86400

    def early_resign_ticks(self, tick_hz: int) -> int:
        return self.early_resign_s * tick_hz

    def ban_s(self, resigns: int) -> int:
        """Queue ban after the ``resigns``-th resign in the window: none for the first."""
        if resigns <= 1:
            return 0
        if resigns == 2:
            return self.resign_ban_second_s
        if resigns == 3:
            return self.resign_ban_third_s
        return self.resign_ban_later_s


@dataclass(frozen=True, slots=True)
class SidePlan:
    """One side of a queue match as it stood at the start."""

    mode: RatingMode
    reason: UnratedReason | None
    """Why ``mode`` is ``NONE``; ``None`` otherwise."""
    rating: Glicko
    played: int
    """Matches that changed this account's rating before this one."""
    account: bool
    """A password account: the only kind that calibrates and is rated."""


@dataclass(frozen=True, slots=True)
class RatingPlan:
    """The rating rules of one queue match, fixed at its start."""

    sides: tuple[SidePlan, SidePlan]
    early_resign_ticks: int
    calibration_total: int


@dataclass(frozen=True, slots=True)
class SideSettlement:
    mode: RatingMode
    reason: UnratedReason | None
    before: Glicko
    after: Glicko
    """Equal to ``before`` when ``mode`` is ``NONE``."""
    played_after: int


@dataclass(frozen=True, slots=True)
class Settlement:
    sides: tuple[SideSettlement, SideSettlement]


@dataclass(frozen=True, slots=True)
class Notice:
    """What one player is told about the rating of a match (welcome and ``match_end``)."""

    rating: RatingChange | None
    unrated_reason: UnratedReason | None
    calibration: Calibration | None

    @property
    def rated(self) -> bool:
        return self.unrated_reason is None


CASUAL_NOTICE: Final = Notice(None, UnratedReason.CASUAL, None)
"""A match that is not from the queue (invite, lobby, bot): DEC-06."""


def _score(winner: int | None, side: int) -> float:
    return DRAW if winner is None else WIN if winner == side else LOSS


def settle(plan: RatingPlan, winner: int | None, end_reason: str, ticks: int) -> Settlement:
    """The ratings after a finished match (pure; ``winner`` ``None`` is a draw).

    A resign before ``plan.early_resign_ticks`` takes the gain away from the winner only.
    """
    modes = [side.mode for side in plan.sides]
    reasons = [side.reason for side in plan.sides]
    early = end_reason in RESIGN_END_REASONS and ticks < plan.early_resign_ticks
    if winner is not None and early and modes[winner] is not RatingMode.NONE:
        modes[winner] = RatingMode.NONE
        reasons[winner] = UnratedReason.OPPONENT_EARLY_RESIGN
    sides: list[SideSettlement] = []
    for index, side in enumerate(plan.sides):
        mode = modes[index]
        before = side.rating
        if mode is RatingMode.NONE:
            after, played_after = before, side.played
        else:
            opponent = plan.sides[1 - index].rating
            after = update(before, [(opponent, _score(winner, index))])
            played_after = side.played + 1
        sides.append(SideSettlement(mode, reasons[index], before, after, played_after))
    return Settlement((sides[0], sides[1]))


def intro_notice(plan: RatingPlan | None, side: int) -> Notice:
    """What the player is told in ``welcome``: the plan before any result."""
    if plan is None:
        return CASUAL_NOTICE
    own = plan.sides[side]
    return Notice(None, own.reason, _calibration(plan, own, own.played))


def end_notice(plan: RatingPlan | None, settlement: Settlement | None, side: int) -> Notice:
    """What the player is told in ``match_end``. The rating is hidden during calibration."""
    if plan is None or settlement is None:
        return CASUAL_NOTICE
    own, settled = plan.sides[side], settlement.sides[side]
    rating = None
    if settled.mode is not RatingMode.NONE and settled.played_after >= plan.calibration_total:
        rating = RatingChange(
            before=round(displayed_rating(settled.before)),
            after=round(displayed_rating(settled.after)),
        )
    return Notice(rating, settled.reason, _calibration(plan, own, settled.played_after))


def _calibration(plan: RatingPlan, own: SidePlan, played: int) -> Calibration | None:
    """Progress of an account that was calibrating when the match began; ``None`` otherwise."""
    if not own.account or own.played >= plan.calibration_total:
        return None
    return Calibration(played=min(played, plan.calibration_total), total=plan.calibration_total)


# Database (blocking) -------------------------------------------------------------------------


def plan_queue_match(
    session: Session,
    accounts: tuple[int, int],
    rules: LadderRules,
    tick_hz: int,
    now: datetime,
) -> RatingPlan:
    """The rating rules of a queue match between ``accounts``, read before its row is inserted."""
    password = [session.get_one(Player, account).password_hash is not None for account in accounts]
    ratings = [rating_of(session, account) for account in accounts]
    played = [played_of(session, account) for account in accounts]
    total = rules.calibration_matches
    modes = [RatingMode.NONE, RatingMode.NONE]
    reasons: list[UnratedReason | None] = [None, None]
    if not all(password):
        reasons = [UnratedReason.OPPONENT_GUEST if has else UnratedReason.GUEST for has in password]
    elif (
        _rated_between(session, accounts, now - timedelta(seconds=rules.opponent_limit_window_s))
        >= rules.opponent_limit
    ):
        reasons = [UnratedReason.OPPONENT_LIMIT, UnratedReason.OPPONENT_LIMIT]
    else:
        calibrating = [count < total for count in played]
        for index in (0, 1):
            if calibrating[index]:
                modes[index] = RatingMode.CALIBRATION
            elif calibrating[1 - index]:
                reasons[index] = UnratedReason.OPPONENT_CALIBRATING
            else:
                modes[index] = RatingMode.RATED
    sides = tuple(
        SidePlan(modes[i], reasons[i], ratings[i], played[i], password[i]) for i in (0, 1)
    )
    return RatingPlan((sides[0], sides[1]), rules.early_resign_ticks(tick_hz), total)


def _rated_between(session: Session, accounts: tuple[int, int], since: datetime) -> int:
    """Rated matches of the two accounts that started after ``since`` (a rolling window).

    Counts every match flagged rated at its start, also one whose winner got no gain.
    """
    first, second = aliased(MatchPlayer), aliased(MatchPlayer)
    return session.execute(
        select(func.count(Match.id))
        .join(first, first.match_id == Match.id)
        .join(second, second.match_id == Match.id)
        .where(
            Match.rated.is_(True),
            Match.started_at > since,
            first.player_id == accounts[0],
            second.player_id == accounts[1],
        )
    ).scalar_one()


def apply_match(
    session: Session,
    match_id: int,
    rules: LadderRules | None = None,
    tick_hz: int = DEFAULT_TICK_HZ,
) -> bool:
    """Rate a saved rated queue match between two accounts once. ``True``: a rating changed.

    ``False`` when the match is not rated, is not saved, has a bot or no result, or was rated
    before. Settles with the modes stored at the start (``match_players.rating_mode``), the
    result and the stored ratings; writes the displayed rating before and after into the rows of
    the sides whose rating changed. ``matches.rating_applied`` is claimed by one atomic
    ``UPDATE``, so a match is rated once however often it is processed (RAT-02).
    """
    rules = rules or LadderRules()
    match = session.get(Match, match_id)
    if match is None or not match.rated or match.status != "saved":
        return False
    sides = list(
        session.execute(
            select(MatchPlayer).where(MatchPlayer.match_id == match_id).order_by(MatchPlayer.side)
        ).scalars()
    )
    if len(sides) != 2 or any(s.player_id is None or s.result not in _RESULTS for s in sides):
        return False
    claimed = session.execute(
        sql_update(Match)
        .where(Match.id == match_id, Match.rating_applied.is_(False))
        .values(rating_applied=True)
        .returning(Match.id)
    ).first()
    if claimed is None:
        return False
    first, second = sides
    assert first.player_id is not None and second.player_id is not None
    assert first.result is not None and match.end_reason is not None
    winner = {"win": first.side, "loss": second.side, "draw": None}[first.result]
    plan = RatingPlan(
        (_stored_side(session, first), _stored_side(session, second)),
        rules.early_resign_ticks(tick_hz),
        rules.calibration_matches,
    )
    settlement = settle(plan, winner, match.end_reason, match.ticks or 0)
    changed = False
    for row, settled in zip(sides, settlement.sides, strict=True):
        assert row.player_id is not None
        row.rating_mode = settled.mode.value
        row.unrated_reason = None if settled.reason is None else settled.reason.value
        if settled.mode is RatingMode.NONE:
            continue
        store_rating(session, row.player_id, settled.after)
        row.rating_before = displayed_rating(settled.before)
        row.rating_after = displayed_rating(settled.after)
        changed = True
    return changed


def _stored_side(session: Session, row: MatchPlayer) -> SidePlan:
    assert row.player_id is not None
    player = session.get_one(Player, row.player_id)
    return SidePlan(
        RatingMode(row.rating_mode),
        None if row.unrated_reason is None else UnratedReason(row.unrated_reason),
        rating_of(session, row.player_id),
        played_of(session, row.player_id),
        player.password_hash is not None,
    )


def record_resign(
    session: Session, match_id: int, rules: LadderRules, now: datetime
) -> datetime | None:
    """Ban from the queue the player who resigned in a rated match, if the count calls for it.

    A resign is a surrender or a technical defeat of the loser of a match that was rated at its
    start (a calibration match too). The ban length depends on the number of such resigns of the
    player within ``resign_window_s`` before ``now``, this one included; it is stored on the
    player and never shortened by a later, shorter ban. Returns the end of the ban, if one was set.
    """
    match = session.get(Match, match_id)
    if match is None or not match.rated or match.end_reason not in RESIGN_END_REASONS:
        return None
    loser = session.execute(
        select(MatchPlayer.player_id).where(
            MatchPlayer.match_id == match_id, MatchPlayer.result == "loss"
        )
    ).scalar_one_or_none()
    if loser is None:
        return None
    resigns = session.execute(
        select(func.count())
        .select_from(MatchPlayer)
        .join(Match, Match.id == MatchPlayer.match_id)
        .where(
            MatchPlayer.player_id == loser,
            MatchPlayer.result == "loss",
            Match.rated.is_(True),
            Match.status == "saved",
            Match.end_reason.in_(RESIGN_END_REASONS),
            Match.ended_at > now - timedelta(seconds=rules.resign_window_s),
        )
    ).scalar_one()
    seconds = rules.ban_s(resigns)
    if seconds <= 0:
        return None
    player = session.get_one(Player, loser)
    until = now + timedelta(seconds=seconds)
    if player.queue_banned_until is None or player.queue_banned_until < until:
        player.queue_banned_until = until
    return player.queue_banned_until


def ban_seconds_left(player: Player, now: datetime) -> int:
    """Whole seconds (rounded up) the player is still banned from the queue; 0: not banned."""
    until = player.queue_banned_until
    if until is None or until <= now:
        return 0
    return math.ceil((until - now).total_seconds())
