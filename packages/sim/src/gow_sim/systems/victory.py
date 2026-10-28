"""Victory (SIM-13): VP accrual and the end of the match.

DEC-03 (mechanics.md, section 11), numbers from ``Ruleset.victory`` and ``Ruleset.match_ticks``:

- Every ``victory.vp_period_ticks`` each player gets the ``vp`` of the map for every city it owns;
  a capital counts ``victory.capital_multiplier`` times (event ``vp_awarded``).
- A player loses at once when it forfeited (``PlayerState.forfeited``, a ``Forfeit`` command, also
  used by the server for a technical defeat) or when its capital belongs to the enemy.
- When both lose in the same tick (both forfeit, or both capitals changed hands), the match is a
  draw (``EndReason.DOUBLE_DEFEAT``): the only mirror-symmetric answer (DEC-03 addition, #136,
  accepted by the owner on 2026-10-28).
- At ``match_ticks`` more VP wins; on equal VP more cities; else a draw.

``outcome()`` is a pure function of the state: no winner field is stored, so the canonical form
and the state hash are unchanged. ``victory()`` is the system: it accrues VP, then emits
``match_ended`` (``winner`` is ``None`` for a draw) when ``outcome()`` is not ``None``. The match
runner (SIM-14) stops at the first ``match_ended``.

Tick convention: a system sees ``state.tick`` as the number of the tick being simulated, 1 for the
first step. A period fires on ticks ``t > 0`` with ``t % period == 0``; the last tick of a match is
``t == match_ticks``, and its VP accrual counts.
"""

from dataclasses import dataclass
from enum import StrEnum

from gow_sim.maps import PLAYERS
from gow_sim.ruleset import Ruleset
from gow_sim.state import Event, GameState, event


class EndReason(StrEnum):
    CAPITAL = "capital"
    """The enemy capital was captured."""
    FORFEIT = "forfeit"
    """The enemy gave up."""
    VP = "vp"
    """Timer: more VP."""
    CITIES = "cities"
    """Timer: equal VP, more cities."""
    DRAW = "draw"
    """Timer: equal VP and equal cities."""
    DOUBLE_DEFEAT = "double_defeat"
    """Both players lost in the same tick: a draw."""


@dataclass(frozen=True, slots=True)
class Outcome:
    winner: int | None
    """Player id; ``None`` for a draw."""
    reason: EndReason


def city_count(state: GameState, player: int) -> int:
    return sum(1 for node in state.nodes.values() if node.owner == player)


def vp_per_period(state: GameState, rules: Ruleset, player: int) -> int:
    """VP a player gets per accrual: map ``vp`` of its cities, capitals times the multiplier."""
    total = 0
    for nid in sorted(state.nodes):
        if state.nodes[nid].owner != player:
            continue
        node = state.map.nodes[nid]
        total += node.vp * (rules.victory.capital_multiplier if node.capital_of is not None else 1)
    return total


def _lost(state: GameState, player: int) -> EndReason | None:
    """Why ``player`` lost at once, or ``None``. A forfeit goes first."""
    if state.players[player].forfeited:
        return EndReason.FORFEIT
    owner = state.nodes[state.map.capital(player)].owner
    if owner is not None and owner != player:
        return EndReason.CAPITAL
    return None


def outcome(state: GameState, rules: Ruleset) -> Outcome | None:
    """The result of the match in the current state; ``None`` while it goes on."""
    losers = {p: reason for p in PLAYERS if (reason := _lost(state, p)) is not None}
    if len(losers) == len(PLAYERS):
        return Outcome(None, EndReason.DOUBLE_DEFEAT)
    if losers:
        ((loser, reason),) = losers.items()
        return Outcome(next(p for p in PLAYERS if p != loser), reason)
    if state.tick < rules.match_ticks:
        return None
    p0, p1 = PLAYERS
    vp0, vp1 = state.players[p0].vp, state.players[p1].vp
    if vp0 != vp1:
        return Outcome(p0 if vp0 > vp1 else p1, EndReason.VP)
    c0, c1 = city_count(state, p0), city_count(state, p1)
    if c0 != c1:
        return Outcome(p0 if c0 > c1 else p1, EndReason.CITIES)
    return Outcome(None, EndReason.DRAW)


def victory(state: GameState, rules: Ruleset) -> list[Event]:
    """VP accrual on period ticks and ``match_ended`` once the match is decided."""
    tick = state.tick
    events: list[Event] = []
    if tick > 0 and tick % rules.victory.vp_period_ticks == 0:
        for pid in sorted(state.players):
            gained = vp_per_period(state, rules, pid)
            state.players[pid].vp += gained
            if gained > 0:
                events.append(event(tick, "vp_awarded", player=pid, vp=gained))
    result = outcome(state, rules)
    if result is not None:
        events.append(event(tick, "match_ended", winner=result.winner, reason=result.reason.value))
    return events
