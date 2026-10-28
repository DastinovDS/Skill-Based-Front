"""DEC-34 (#414): rating-farming protection. Expected values come from mechanics.md, section 19.

- calibration: the first 5 queue matches of a password account change only its own hidden rating;
- an early resign (before 3 minutes, tick 1800 at 10 Hz) gives the winner no gain; a draw is not a
  resign;
- resigns in rated matches within a rolling 24 hours: the 1st no ban, the 2nd 5 minutes, the 3rd
  30 minutes, the 4th and later 2 hours; a calibration match counts, a draw does not;
- at most 3 rated matches between the same two accounts within a rolling 24 hours.

Glicko-2 numbers of two new players (independent implementation, see ``test_rating_updates.py``):
after one decisive match the winner is ``r`` 1662.3109 / ``RD`` 290.3190 (displayed 1082) and the
loser 1337.6891 / 290.3190 (757).
"""

from collections.abc import Iterator
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from gow_protocol.messages import Calibration, RatingChange, UnratedReason
from gow_server.clock import ManualClock
from gow_server.db import create_db_engine, upgrade_to_head
from gow_server.ladder import (
    LadderRules,
    RatingMode,
    RatingPlan,
    SidePlan,
    apply_match,
    ban_seconds_left,
    end_notice,
    intro_notice,
    plan_queue_match,
    record_resign,
    settle,
)
from gow_server.models import Match, MatchPlayer, Player, Rating
from gow_server.rating import Glicko
from gow_server.settings import Settings

RATED = RatingMode.RATED
CALIBRATION = RatingMode.CALIBRATION
NONE = RatingMode.NONE
NEW = Glicko()
EARLY_TICKS = 1800
"""3 minutes at 10 ticks per second (DEC-34, item 3)."""


def side(
    mode: RatingMode,
    reason: UnratedReason | None = None,
    played: int = 5,
    account: bool = True,
    rating: Glicko = NEW,
) -> SidePlan:
    return SidePlan(mode, reason, rating, played, account)


def plan(a: SidePlan, b: SidePlan) -> RatingPlan:
    return RatingPlan((a, b), early_resign_ticks=EARLY_TICKS, calibration_total=5)


# Settings and ban lengths --------------------------------------------------------------------


def test_settings_defaults_are_the_numbers_of_dec_34() -> None:
    settings = Settings()
    assert settings.calibration_matches == 5
    assert settings.early_resign_s == 180
    assert settings.resign_window_s == 24 * 3600
    assert (settings.resign_ban_second_s, settings.resign_ban_third_s) == (5 * 60, 30 * 60)
    assert settings.resign_ban_later_s == 2 * 3600
    assert settings.opponent_limit == 3
    assert settings.opponent_limit_window_s == 24 * 3600
    assert LadderRules().early_resign_ticks(10) == EARLY_TICKS


def test_settings_are_read_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOW_CALIBRATION_MATCHES", "7")
    monkeypatch.setenv("GOW_OPPONENT_LIMIT", "2")
    monkeypatch.setenv("GOW_RESIGN_BAN_SECOND_S", "60")
    settings = Settings()
    assert (settings.calibration_matches, settings.opponent_limit) == (7, 2)
    assert settings.resign_ban_second_s == 60


@pytest.mark.parametrize(
    ("resigns", "seconds"),
    [(0, 0), (1, 0), (2, 300), (3, 1800), (4, 7200), (5, 7200), (9, 7200)],
)
def test_ban_length_by_the_number_of_resigns(resigns: int, seconds: int) -> None:
    assert LadderRules().ban_s(resigns) == seconds


# Settling a finished match (pure) ------------------------------------------------------------


def test_a_full_rated_match_changes_both_ratings() -> None:
    settled = settle(plan(side(RATED), side(RATED)), 0, "capital_captured", 4000)
    winner, loser = settled.sides
    assert (winner.after.rating, winner.after.rd) == pytest.approx((1662.3109, 290.3190), abs=1e-3)
    assert (loser.after.rating, loser.after.rd) == pytest.approx((1337.6891, 290.3190), abs=1e-3)
    assert (winner.played_after, loser.played_after) == (6, 6)
    assert (winner.reason, loser.reason) == (None, None)


def test_a_calibration_match_does_not_change_the_calibrated_opponent() -> None:
    # the calibrating side loses to a calibrated one: only its own rating moves
    calibrated_side = side(NONE, UnratedReason.OPPONENT_CALIBRATING)
    settled = settle(
        plan(side(CALIBRATION, played=0), calibrated_side), 1, "capital_captured", 4000
    )
    calibrating, calibrated = settled.sides
    assert calibrating.after.rating == pytest.approx(1337.6891, abs=1e-3)
    assert calibrated.after == calibrated.before == NEW
    assert (calibrating.played_after, calibrated.played_after) == (1, 5)


def test_a_calibration_match_against_a_calibrating_opponent_changes_both() -> None:
    settled = settle(
        plan(side(CALIBRATION, played=1), side(CALIBRATION, played=3)), 0, "timer", 9000
    )
    assert settled.sides[0].after.rating == pytest.approx(1662.3109, abs=1e-3)
    assert settled.sides[1].after.rating == pytest.approx(1337.6891, abs=1e-3)
    assert (settled.sides[0].played_after, settled.sides[1].played_after) == (2, 4)


def test_an_unrated_side_keeps_its_rating_and_its_count() -> None:
    unrated = side(NONE, UnratedReason.OPPONENT_CALIBRATING, played=7)
    settled = settle(plan(unrated, side(CALIBRATION, played=0)), 0, "capital_captured", 4000)
    assert settled.sides[0].after == NEW and settled.sides[0].played_after == 7
    assert settled.sides[0].reason is UnratedReason.OPPONENT_CALIBRATING


@pytest.mark.parametrize("reason", ["forfeit", "disconnect", "no_show"])
def test_an_early_resign_gives_the_winner_no_gain_and_the_loser_a_defeat(reason: str) -> None:
    settled = settle(plan(side(RATED), side(RATED)), 0, reason, EARLY_TICKS - 1)
    winner, loser = settled.sides
    assert winner.after == NEW and winner.mode is NONE
    assert winner.reason is UnratedReason.OPPONENT_EARLY_RESIGN
    assert winner.played_after == 5  # no calibration or match progress either
    assert loser.after.rating == pytest.approx(1337.6891, abs=1e-3)  # a defeat as usual
    assert loser.mode is RATED and loser.played_after == 6


@pytest.mark.parametrize("reason", ["forfeit", "disconnect", "no_show"])
def test_a_resign_at_the_threshold_is_not_early(reason: str) -> None:
    settled = settle(plan(side(RATED), side(RATED)), 0, reason, EARLY_TICKS)
    assert settled.sides[0].after.rating == pytest.approx(1662.3109, abs=1e-3)
    assert settled.sides[0].mode is RATED


def test_an_early_end_that_is_not_a_resign_is_rated() -> None:
    settled = settle(plan(side(RATED), side(RATED)), 0, "capital_captured", 100)
    assert settled.sides[0].after.rating == pytest.approx(1662.3109, abs=1e-3)


def test_a_draw_is_not_a_resign_even_a_double_defeat_at_tick_one() -> None:
    settled = settle(plan(side(RATED), side(RATED)), None, "double_defeat", 1)
    # two new players drawing: the rating stays, the RD shrinks, and both count as played
    for result in settled.sides:
        assert result.mode is RATED and result.reason is None
        assert result.after.rating == pytest.approx(1500.0, abs=1e-6)
        assert result.after.rd == pytest.approx(290.3190, abs=1e-3)
        assert result.played_after == 6


def test_an_early_resign_against_a_calibrating_loser_still_rates_the_loser() -> None:
    settled = settle(plan(side(RATED), side(CALIBRATION, played=0)), 0, "forfeit", 5)
    assert settled.sides[0].after == NEW  # the calibrated winner: unchanged anyway
    assert settled.sides[1].after.rating == pytest.approx(1337.6891, abs=1e-3)
    assert settled.sides[1].played_after == 1


def test_an_early_resign_keeps_an_earlier_reason_of_the_winner() -> None:
    unrated = side(NONE, UnratedReason.OPPONENT_CALIBRATING)
    settled = settle(plan(unrated, side(CALIBRATION, played=0)), 0, "forfeit", 5)
    assert settled.sides[0].reason is UnratedReason.OPPONENT_CALIBRATING


# What the players are told -------------------------------------------------------------------


def test_the_rating_is_hidden_during_calibration_and_shown_when_it_ends() -> None:
    mid = plan(side(CALIBRATION, played=1), side(RATED))
    notice = end_notice(mid, settle(mid, 0, "capital_captured", 4000), 0)
    assert notice.rating is None and notice.rated
    assert notice.calibration == Calibration(played=2, total=5)

    last = plan(side(CALIBRATION, played=4), side(RATED))
    notice = end_notice(last, settle(last, 0, "capital_captured", 4000), 0)
    assert notice.rating == RatingChange(before=800, after=1082)
    assert notice.calibration == Calibration(played=5, total=5)


def test_a_calibrated_player_has_no_calibration_progress() -> None:
    full = plan(side(RATED), side(RATED))
    notice = end_notice(full, settle(full, 0, "capital_captured", 4000), 0)
    assert notice.rating == RatingChange(before=800, after=1082)
    assert notice.calibration is None and notice.unrated_reason is None


def test_the_calibrated_side_of_a_calibration_match_is_told_why() -> None:
    mixed = plan(side(NONE, UnratedReason.OPPONENT_CALIBRATING), side(CALIBRATION, played=0))
    notice = end_notice(mixed, settle(mixed, 0, "capital_captured", 4000), 0)
    assert (notice.rating, notice.rated) == (None, False)
    assert notice.unrated_reason is UnratedReason.OPPONENT_CALIBRATING
    assert notice.calibration is None


def test_the_early_resign_winner_is_told_why_and_the_loser_is_rated() -> None:
    full = plan(side(RATED), side(RATED))
    settled = settle(full, 0, "disconnect", 20)
    winner, loser = end_notice(full, settled, 0), end_notice(full, settled, 1)
    assert (winner.rating, winner.rated) == (None, False)
    assert winner.unrated_reason is UnratedReason.OPPONENT_EARLY_RESIGN
    assert loser.rating == RatingChange(before=800, after=757)


def test_a_calibrating_winner_of_an_early_resign_makes_no_progress() -> None:
    mixed = plan(side(CALIBRATION, played=2), side(RATED))
    notice = end_notice(mixed, settle(mixed, 0, "forfeit", 20), 0)
    assert notice.unrated_reason is UnratedReason.OPPONENT_EARLY_RESIGN
    assert notice.calibration == Calibration(played=2, total=5)


def test_a_guest_is_told_it_is_a_guest_and_has_no_calibration() -> None:
    guest = plan(side(NONE, UnratedReason.GUEST, played=0, account=False), side(NONE))
    notice = intro_notice(guest, 0)
    assert (notice.rated, notice.unrated_reason, notice.calibration) == (
        False,
        UnratedReason.GUEST,
        None,
    )


def test_the_intro_shows_the_calibration_before_the_match() -> None:
    notice = intro_notice(plan(side(CALIBRATION, played=3), side(RATED)), 0)
    assert notice.rated and notice.unrated_reason is None
    assert notice.calibration == Calibration(played=3, total=5)


def test_a_match_that_is_not_from_the_queue_is_casual() -> None:
    notice = intro_notice(None, 0)
    assert (notice.rated, notice.unrated_reason) == (False, UnratedReason.CASUAL)
    assert end_notice(None, None, 0).unrated_reason is UnratedReason.CASUAL


# Database: planning, limit, resigns ----------------------------------------------------------


@pytest.fixture
def engine(tmp_path: Path) -> Iterator[Engine]:
    engine = create_db_engine(f"sqlite:///{tmp_path / 'gow.db'}")
    upgrade_to_head(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def session(engine: Engine) -> Iterator[Session]:
    with sessionmaker(engine, expire_on_commit=False)() as session:
        yield session


@pytest.fixture
def clock() -> ManualClock:
    clock = ManualClock()
    clock.advance(10 * 24 * 3600)  # room for "days ago"
    return clock


RULES = LadderRules()


def account(session: Session, nick: str, *, password: bool = True, played: int | None = 5) -> int:
    player = Player(
        nick=nick,
        nick_key=nick.lower(),
        token_hash=nick.encode().ljust(32, b"-"),
        password_hash="scrypt$x" if password else None,
    )
    session.add(player)
    session.flush()
    if played is not None:
        session.add(
            Rating(
                player_id=player.id, rating=1500.0, rd=350.0, volatility=0.06, rated_matches=played
            )
        )
    session.commit()
    return player.id


def plan_of(session: Session, clock: ManualClock, a: int, b: int) -> RatingPlan:
    return plan_queue_match(session, (a, b), RULES, 10, clock.wall())


def modes(p: RatingPlan) -> tuple[RatingMode, RatingMode]:
    return p.sides[0].mode, p.sides[1].mode


def reasons(p: RatingPlan) -> tuple[UnratedReason | None, UnratedReason | None]:
    return p.sides[0].reason, p.sides[1].reason


def test_two_calibrated_accounts_play_a_rated_match(session: Session, clock: ManualClock) -> None:
    p = plan_of(session, clock, account(session, "a"), account(session, "b"))
    assert modes(p) == (RATED, RATED) and reasons(p) == (None, None)
    assert p.early_resign_ticks == EARLY_TICKS and p.calibration_total == 5


def test_a_guest_makes_the_match_unrated_for_both(session: Session, clock: ManualClock) -> None:
    a = account(session, "a")
    guest = account(session, "g", password=False, played=None)
    p = plan_of(session, clock, a, guest)
    assert modes(p) == (NONE, NONE)
    assert reasons(p) == (UnratedReason.OPPONENT_GUEST, UnratedReason.GUEST)
    assert plan_of(session, clock, guest, a).sides[1].reason is UnratedReason.OPPONENT_GUEST


def test_two_guests(session: Session, clock: ManualClock) -> None:
    p = plan_of(
        session,
        clock,
        account(session, "g1", password=False, played=None),
        account(session, "g2", password=False, played=None),
    )
    assert reasons(p) == (UnratedReason.GUEST, UnratedReason.GUEST)


def test_a_new_account_without_a_rating_row_is_calibrating(
    session: Session, clock: ManualClock
) -> None:
    p = plan_of(session, clock, account(session, "new", played=None), account(session, "b"))
    assert modes(p) == (CALIBRATION, NONE)
    assert reasons(p) == (None, UnratedReason.OPPONENT_CALIBRATING)
    assert p.sides[0].played == 0 and p.sides[0].rating == NEW


def test_the_fifth_match_is_still_calibration_the_sixth_is_rated(
    session: Session, clock: ManualClock
) -> None:
    b = account(session, "b")
    assert modes(plan_of(session, clock, account(session, "four", played=4), b))[0] is CALIBRATION
    assert modes(plan_of(session, clock, account(session, "five", played=5), b)) == (RATED, RATED)


def test_two_calibrating_accounts_both_calibrate(session: Session, clock: ManualClock) -> None:
    p = plan_of(session, clock, account(session, "a", played=0), account(session, "b", played=3))
    assert modes(p) == (CALIBRATION, CALIBRATION)


def test_the_calibration_length_is_a_setting(session: Session, clock: ManualClock) -> None:
    a, b = account(session, "a", played=2), account(session, "b")
    rules = LadderRules(calibration_matches=2)
    assert modes(plan_queue_match(session, (a, b), rules, 10, clock.wall())) == (RATED, RATED)
    assert modes(plan_queue_match(session, (a, b), RULES, 10, clock.wall()))[0] is CALIBRATION


def add_match(
    session: Session,
    a: int,
    b: int,
    *,
    ago: timedelta,
    clock: ManualClock,
    rated: bool = True,
    loser: int | None = None,
    end_reason: str = "capital_captured",
    status: str = "saved",
) -> int:
    """A finished match of ``a`` (side 0) and ``b`` (side 1) that ended ``ago`` before now."""
    ended = clock.wall() - ago
    match = Match(
        map_id="m",
        ruleset_hash="h",
        rated=rated,
        started_at=ended - timedelta(minutes=5),
        ended_at=ended,
        end_reason=end_reason,
        status=status,
        ticks=3000,
    )
    session.add(match)
    session.flush()
    for index, player in enumerate((a, b)):
        result = "draw" if loser is None else "loss" if player == loser else "win"
        session.add(MatchPlayer(match_id=match.id, side=index, player_id=player, result=result))
    session.commit()
    return match.id


def test_the_fourth_rated_match_within_24_hours_is_unrated(
    session: Session, clock: ManualClock
) -> None:
    a, b = account(session, "a"), account(session, "b")
    for hours in (1, 5, 20):
        assert modes(plan_of(session, clock, a, b)) == (RATED, RATED)
        add_match(session, a, b, ago=timedelta(hours=hours), clock=clock, loser=b)
    p = plan_of(session, clock, a, b)  # three in the window
    assert modes(p) == (NONE, NONE)
    assert reasons(p) == (UnratedReason.OPPONENT_LIMIT, UnratedReason.OPPONENT_LIMIT)
    assert plan_of(session, clock, b, a).sides[0].reason is UnratedReason.OPPONENT_LIMIT


def test_the_limit_window_rolls(session: Session, clock: ManualClock) -> None:
    a, b = account(session, "a"), account(session, "b")
    add_match(session, a, b, ago=timedelta(hours=24, minutes=1), clock=clock, loser=b)  # out
    add_match(session, a, b, ago=timedelta(hours=10), clock=clock, loser=b)
    add_match(session, a, b, ago=timedelta(hours=2), clock=clock, loser=b)
    assert modes(plan_of(session, clock, a, b)) == (RATED, RATED)  # two in the window
    add_match(session, a, b, ago=timedelta(minutes=10), clock=clock, loser=b)
    assert modes(plan_of(session, clock, a, b)) == (NONE, NONE)
    clock.advance(14 * 3600)  # the 10-hour-old match is now more than 24 hours old
    assert modes(plan_of(session, clock, a, b)) == (RATED, RATED)


def test_the_limit_counts_one_pair_and_rated_matches_only(
    session: Session, clock: ManualClock
) -> None:
    a, b, c = account(session, "a"), account(session, "b"), account(session, "c")
    for _ in range(3):
        add_match(session, a, c, ago=timedelta(hours=1), clock=clock, loser=c)  # other pair
        add_match(session, a, b, ago=timedelta(hours=1), clock=clock, rated=False, loser=b)
    assert modes(plan_of(session, clock, a, b)) == (RATED, RATED)


def test_the_limit_is_a_setting(session: Session, clock: ManualClock) -> None:
    a, b = account(session, "a"), account(session, "b")
    add_match(session, a, b, ago=timedelta(hours=1), clock=clock, loser=b)
    rules = LadderRules(opponent_limit=1)
    assert modes(plan_queue_match(session, (a, b), rules, 10, clock.wall())) == (NONE, NONE)


def test_the_limit_counts_a_match_whose_winner_got_no_gain(
    session: Session, clock: ManualClock
) -> None:
    """Flagged rated at its start is what counts: an early resign is no way around the limit."""
    a, b = account(session, "a"), account(session, "b")
    for _ in range(3):
        add_match(session, a, b, ago=timedelta(hours=1), clock=clock, loser=b, end_reason="forfeit")
    assert modes(plan_of(session, clock, a, b)) == (NONE, NONE)


# Resigns and the queue ban -------------------------------------------------------------------


def resign(
    session: Session,
    clock: ManualClock,
    loser: int,
    other: int,
    *,
    ago: timedelta = timedelta(0),
    end_reason: str = "forfeit",
    rated: bool = True,
) -> datetime:
    """A finished match the ``loser`` resigned, recorded as ``lifecycle`` does; the ban end."""
    pk = add_match(
        session, loser, other, ago=ago, clock=clock, loser=loser, end_reason=end_reason, rated=rated
    )
    now = clock.wall() - ago
    until = record_resign(session, pk, RULES, now)
    session.commit()
    return until  # type: ignore[return-value]


def banned_until(session: Session, player: int) -> datetime | None:
    session.expire_all()
    return session.get_one(Player, player).queue_banned_until


def test_the_first_resign_carries_no_ban_the_second_five_minutes(
    session: Session, clock: ManualClock
) -> None:
    a, b = account(session, "a"), account(session, "b")
    assert resign(session, clock, a, b, ago=timedelta(hours=3)) is None
    assert banned_until(session, a) is None
    assert resign(session, clock, a, b) == clock.wall() + timedelta(minutes=5)
    assert banned_until(session, a) == clock.wall() + timedelta(minutes=5)


def test_the_third_resign_30_minutes_the_fourth_and_later_two_hours(
    session: Session, clock: ManualClock
) -> None:
    a, b = account(session, "a"), account(session, "b")
    resign(session, clock, a, b, ago=timedelta(hours=5))
    resign(session, clock, a, b, ago=timedelta(hours=4))
    assert resign(session, clock, a, b, ago=timedelta(hours=3)) == (
        clock.wall() - timedelta(hours=3) + timedelta(minutes=30)
    )
    assert resign(session, clock, a, b, ago=timedelta(hours=2)) == (
        clock.wall() - timedelta(hours=2) + timedelta(hours=2)
    )
    assert resign(session, clock, a, b) == clock.wall() + timedelta(hours=2)


def test_the_winner_is_never_banned(session: Session, clock: ManualClock) -> None:
    a, b = account(session, "a"), account(session, "b")
    for _ in range(4):
        resign(session, clock, a, b)
    assert banned_until(session, b) is None


def test_resigns_older_than_24_hours_do_not_count(session: Session, clock: ManualClock) -> None:
    a, b = account(session, "a"), account(session, "b")
    resign(session, clock, a, b, ago=timedelta(hours=25))
    resign(session, clock, a, b, ago=timedelta(hours=24, minutes=1))
    assert resign(session, clock, a, b) is None  # the first of the window
    assert resign(session, clock, a, b) == clock.wall() + timedelta(minutes=5)


@pytest.mark.parametrize("end_reason", ["disconnect", "no_show", "forfeit"])
def test_a_disconnect_is_a_resign(session: Session, clock: ManualClock, end_reason: str) -> None:
    a, b = account(session, "a"), account(session, "b")
    resign(session, clock, a, b, end_reason="forfeit")
    assert resign(session, clock, a, b, end_reason=end_reason) is not None


def test_a_defeat_that_is_not_a_resign_does_not_count(session: Session, clock: ManualClock) -> None:
    a, b = account(session, "a"), account(session, "b")
    for end_reason in ("capital_captured", "timer"):
        pk = add_match(session, a, b, ago=timedelta(0), clock=clock, loser=a, end_reason=end_reason)
        assert record_resign(session, pk, RULES, clock.wall()) is None
    resign(session, clock, a, b)
    assert banned_until(session, a) is None  # still only one resign


def test_a_draw_is_not_a_resign(session: Session, clock: ManualClock) -> None:
    a, b = account(session, "a"), account(session, "b")
    resign(session, clock, a, b)
    pk = add_match(session, a, b, ago=timedelta(0), clock=clock, end_reason="double_defeat")
    assert record_resign(session, pk, RULES, clock.wall()) is None
    assert banned_until(session, a) is None


def test_resigns_of_unrated_matches_do_not_count(session: Session, clock: ManualClock) -> None:
    a, b = account(session, "a"), account(session, "b")
    resign(session, clock, a, b, rated=False)
    resign(session, clock, a, b, rated=False)
    assert resign(session, clock, a, b) is None  # the only rated resign so far


def test_a_resign_in_a_calibration_match_counts(session: Session, clock: ManualClock) -> None:
    """Owner decision of 2026-10-28: calibration resigns count toward the queue ban."""
    new, b = account(session, "new", played=0), account(session, "b")
    pk = add_match(
        session, new, b, ago=timedelta(hours=1), clock=clock, loser=new, end_reason="forfeit"
    )
    assert record_resign(session, pk, RULES, clock.wall()) is None  # the first
    assert resign(session, clock, new, b) == clock.wall() + timedelta(minutes=5)  # the second


def test_a_shorter_ban_never_shortens_a_longer_one(session: Session, clock: ManualClock) -> None:
    a, b = account(session, "a"), account(session, "b")
    for hours in (6, 5, 4):
        resign(session, clock, a, b, ago=timedelta(hours=hours))
    first_end = banned_until(session, a)
    assert first_end is not None
    # an older resign recorded late (a window edge): the stored end stays
    pk = add_match(
        session, a, b, ago=timedelta(hours=30), clock=clock, loser=a, end_reason="forfeit"
    )
    record_resign(session, pk, RULES, clock.wall() - timedelta(hours=30))
    assert banned_until(session, a) == first_end


def test_seconds_left_of_a_ban(session: Session, clock: ManualClock) -> None:
    a = account(session, "a")
    player = session.get_one(Player, a)
    assert ban_seconds_left(player, clock.wall()) == 0
    player.queue_banned_until = clock.wall() + timedelta(seconds=299, milliseconds=500)
    assert ban_seconds_left(player, clock.wall()) == 300  # rounded up
    clock.advance(299)
    assert ban_seconds_left(player, clock.wall()) == 1
    clock.advance(1)
    assert ban_seconds_left(player, clock.wall()) == 0


# apply_match of a stored match ---------------------------------------------------------------


def test_apply_match_follows_the_stored_modes(session: Session, clock: ManualClock) -> None:
    new, b = account(session, "new", played=0), account(session, "b")
    pk = add_match(session, new, b, ago=timedelta(minutes=1), clock=clock, loser=b)
    for row, (mode, reason) in zip(
        session.query(MatchPlayer).filter_by(match_id=pk).order_by(MatchPlayer.side),
        ((CALIBRATION, None), (NONE, UnratedReason.OPPONENT_CALIBRATING)),
        strict=True,
    ):
        row.rating_mode = mode.value
        row.unrated_reason = None if reason is None else reason.value
    session.commit()
    assert apply_match(session, pk, RULES) is True
    session.commit()
    mine, theirs = session.get_one(Rating, new), session.get_one(Rating, b)
    assert (mine.rating, mine.rd) == pytest.approx((1662.3109, 290.3190), abs=1e-3)
    assert mine.rated_matches == 1
    assert (theirs.rating, theirs.rd, theirs.rated_matches) == (1500.0, 350.0, 5)
    assert apply_match(session, pk, RULES) is False  # once


def test_apply_match_takes_the_gain_from_an_early_resign_winner(
    session: Session, clock: ManualClock
) -> None:
    a, b = account(session, "a"), account(session, "b")
    pk = add_match(
        session, a, b, ago=timedelta(minutes=1), clock=clock, loser=b, end_reason="forfeit"
    )
    for row in session.query(MatchPlayer).filter_by(match_id=pk):
        row.rating_mode = RATED.value
    session.query(Match).filter_by(id=pk).one().ticks = 100
    session.commit()
    assert apply_match(session, pk, RULES) is True
    session.commit()
    winner, loser = session.get_one(Rating, a), session.get_one(Rating, b)
    assert (winner.rating, winner.rated_matches) == (1500.0, 5)
    assert loser.rating < 1500.0 and loser.rated_matches == 6
    rows = {r.player_id: r for r in session.query(MatchPlayer).filter_by(match_id=pk)}
    assert rows[a].rating_mode == "none" and rows[a].unrated_reason == "opponent_early_resign"
    assert rows[a].rating_after is None
    assert rows[b].rating_mode == "rated" and rows[b].rating_after is not None
