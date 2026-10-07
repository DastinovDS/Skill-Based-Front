"""RAT-01: Glicko-2. Expected values come from Glickman's paper, not from this code."""

import pytest

from gow_server.rating import (
    DRAW,
    INITIAL_RATING,
    INITIAL_RD,
    INITIAL_VOLATILITY,
    LOSS,
    WIN,
    Glicko,
    displayed_rating,
    rate_match,
    update,
)


def test_example_from_the_paper() -> None:
    """Glickman, "Example of the Glicko-2 system": 1500 / 200 / 0.06, tau = 0.5."""
    player = Glicko(1500.0, 200.0, 0.06)
    after = update(
        player,
        [
            (Glicko(1400.0, 30.0), WIN),
            (Glicko(1550.0, 100.0), LOSS),
            (Glicko(1700.0, 300.0), LOSS),
        ],
    )
    assert after.rating == pytest.approx(1464.06, abs=0.01)
    assert after.rd == pytest.approx(151.52, abs=0.01)
    assert after.volatility == pytest.approx(0.05999, abs=0.00001)


def test_new_player_starts_at_the_paper_defaults() -> None:
    new = Glicko()
    assert (new.rating, new.rd, new.volatility) == (INITIAL_RATING, INITIAL_RD, INITIAL_VOLATILITY)


def test_displayed_rating_is_rating_minus_two_rd() -> None:
    assert displayed_rating(Glicko(1464.06, 151.52, 0.06)) == pytest.approx(1161.02)
    assert displayed_rating(Glicko()) == pytest.approx(800.0)


def test_rd_grows_without_games() -> None:
    after = update(Glicko(1500.0, 200.0, 0.06), [])
    assert after.rating == 1500.0
    assert 200.0 < after.rd < 201.0


def test_win_raises_and_loss_lowers_the_rating() -> None:
    a, b = rate_match(Glicko(), Glicko(), WIN)
    assert a.rating > INITIAL_RATING > b.rating
    assert a.rd < INITIAL_RD
    assert b.rd < INITIAL_RD


def test_equal_players_move_symmetrically() -> None:
    a, b = rate_match(Glicko(), Glicko(), WIN)
    assert a.rating - INITIAL_RATING == pytest.approx(INITIAL_RATING - b.rating)


def test_draw_of_equal_players_changes_no_rating() -> None:
    a, b = rate_match(Glicko(), Glicko(), DRAW)
    assert a.rating == pytest.approx(INITIAL_RATING)
    assert b.rating == pytest.approx(INITIAL_RATING)
    assert a.rd < INITIAL_RD


def test_upset_moves_more_than_expected_win() -> None:
    strong, weak = Glicko(1800.0, 80.0), Glicko(1400.0, 80.0)
    upset = rate_match(strong, weak, LOSS)[1].rating - weak.rating
    expected = rate_match(strong, weak, WIN)[1].rating - weak.rating
    assert upset > 0 > expected
    assert upset > abs(expected)
