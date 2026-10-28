"""Glicko-2 rating (RAT-01, #73), from Glickman's paper "Example of the Glicko-2 system".

The step numbers in the comments are the paper's. Every match is its own rating period, so a
player is updated right after each match against exactly one opponent. Ratings are plain floats:
this module is server-side only, the simulation never sees it (AGENTS.md, section 4.1).

The number a player sees is ``displayed_rating``: ``r - 2 * RD``, a conservative estimate that
grows as the system gets more sure of the player.

RAT-02 (#75): ``gow_server.ladder.apply_match`` rates a finished rated match in the caller's
transaction (DEC-34: who is rated and who is not). The database helpers here are blocking: use
``asyncio.to_thread``.
"""

import math
from dataclasses import dataclass
from typing import Final

from sqlalchemy.orm import Session

from gow_server.models import Rating

INITIAL_RATING: Final = 1500.0
INITIAL_RD: Final = 350.0
INITIAL_VOLATILITY: Final = 0.06
TAU: Final = 0.5
"""System constant: how fast volatility may change (the paper suggests 0.3 to 1.2)."""

_SCALE: Final = 173.7178
"""Conversion between the Glicko scale (1500, RD) and the Glicko-2 scale (0, phi)."""
_EPSILON: Final = 0.000001
"""Convergence tolerance of the volatility iteration (step 5)."""

WIN: Final = 1.0
DRAW: Final = 0.5
LOSS: Final = 0.0


@dataclass(frozen=True, slots=True)
class Glicko:
    rating: float = INITIAL_RATING
    rd: float = INITIAL_RD
    volatility: float = INITIAL_VOLATILITY


def displayed_rating(g: Glicko) -> float:
    """The rating shown to players: ``r - 2 * RD`` (can be below 1500 for a new player)."""
    return g.rating - 2.0 * g.rd


def _g(phi: float) -> float:
    return 1.0 / math.sqrt(1.0 + 3.0 * phi * phi / (math.pi * math.pi))


def _expected(mu: float, mu_j: float, phi_j: float) -> float:
    return 1.0 / (1.0 + math.exp(-_g(phi_j) * (mu - mu_j)))


def _new_volatility(phi: float, sigma: float, delta: float, v: float) -> float:
    """Step 5: the Illinois algorithm for the new volatility."""
    a = math.log(sigma * sigma)
    tau2 = TAU * TAU
    phi2 = phi * phi

    def f(x: float) -> float:
        ex = math.exp(x)
        return ex * (delta * delta - phi2 - v - ex) / (2.0 * (phi2 + v + ex) ** 2) - (x - a) / tau2

    big_a = a
    if delta * delta > phi2 + v:
        big_b = math.log(delta * delta - phi2 - v)
    else:
        k = 1
        while f(a - k * TAU) < 0.0:
            k += 1
        big_b = a - k * TAU
    f_a, f_b = f(big_a), f(big_b)
    while abs(big_b - big_a) > _EPSILON:
        c = big_a + (big_a - big_b) * f_a / (f_b - f_a)
        f_c = f(c)
        if f_c * f_b <= 0.0:
            big_a, f_a = big_b, f_b
        else:
            f_a /= 2.0
        big_b, f_b = c, f_c
    return math.exp(big_a / 2.0)


def update(player: Glicko, results: list[tuple[Glicko, float]]) -> Glicko:
    """The rating after one rating period; ``results`` are ``(opponent, score)`` pairs.

    ``score`` is ``WIN``, ``DRAW`` or ``LOSS``. Without results only the RD grows (step 6).
    """
    mu = (player.rating - INITIAL_RATING) / _SCALE  # step 2
    phi = player.rd / _SCALE
    sigma = player.volatility
    if not results:
        phi_star = math.sqrt(phi * phi + sigma * sigma)
        return Glicko(player.rating, phi_star * _SCALE, sigma)
    opponents = [
        ((opp.rating - INITIAL_RATING) / _SCALE, opp.rd / _SCALE, score) for opp, score in results
    ]
    v_inv = 0.0  # step 3
    gain = 0.0
    for mu_j, phi_j, score in opponents:
        e = _expected(mu, mu_j, phi_j)
        v_inv += _g(phi_j) ** 2 * e * (1.0 - e)
        gain += _g(phi_j) * (score - e)
    v = 1.0 / v_inv
    delta = v * gain  # step 4
    sigma_new = _new_volatility(phi, sigma, delta, v)  # step 5
    phi_star = math.sqrt(phi * phi + sigma_new * sigma_new)  # step 6
    phi_new = 1.0 / math.sqrt(1.0 / (phi_star * phi_star) + 1.0 / v)  # step 7
    mu_new = mu + phi_new * phi_new * gain
    return Glicko(_SCALE * mu_new + INITIAL_RATING, _SCALE * phi_new, sigma_new)  # step 8


def rate_match(a: Glicko, b: Glicko, score_a: float) -> tuple[Glicko, Glicko]:
    """New ratings of both sides of one match; ``score_a`` is the result of ``a``."""
    return update(a, [(b, score_a)]), update(b, [(a, 1.0 - score_a)])


# Database -----------------------------------------------------------------------------------


def rating_of(session: Session, player_id: int) -> Glicko:
    """The stored rating of a player; a player without one is new (``Glicko()``)."""
    row = session.get(Rating, player_id)
    return Glicko() if row is None else Glicko(row.rating, row.rd, row.volatility)


def played_of(session: Session, player_id: int) -> int:
    """Matches that changed the player's rating so far (calibration matches included)."""
    row = session.get(Rating, player_id)
    return 0 if row is None else row.rated_matches


def store_rating(session: Session, player_id: int, g: Glicko) -> None:
    """Save the rating after a match that changed it and count that match."""
    row = session.get(Rating, player_id)
    if row is None:
        session.add(
            Rating(
                player_id=player_id,
                rating=g.rating,
                rd=g.rd,
                volatility=g.volatility,
                rated_matches=1,
            )
        )
    else:
        row.rating, row.rd, row.volatility = g.rating, g.rd, g.volatility
        row.rated_matches += 1
