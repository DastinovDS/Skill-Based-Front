"""Human tempo and difficulty levels of the smart bots (#166, PR 3).

A bot is called every 5 ticks (``run_headless``, the server) and could answer every call with
any number of commands, reacting to a shown enemy in half a second. A ``Tempo`` limits it to a
human pace, three ways:

- **Thinking**: a decision at most every ``think_ticks`` ticks (the calls between return nothing).
- **Reaction**: an enemy strike (a planned order's public intent, DEC-08) and an enemy figure on
  an edge (DEC-33; its opaque id is new on every exit from the fog) are *noticed* only
  ``react_ticks`` after they are first shown (``Perception``): until then the decision runs on a
  view without them. Fights and the own state are seen at once.
- **APM**: a token bucket of commands (``Bucket``): ``apm`` commands per minute of match time,
  at most ``burst`` saved up. Every command counts, free ones too, like ``apm_avg`` of
  ``gow-bots stats`` (``gow_sim.analysis``); a command the bucket cannot pay is not sent (the
  decision goes on in its priority order, so the cheap, urgent ones come first).

``insight`` is the quality of the assessment: without it the bot plays its drawn thresholds
whatever the position (no VP forecast, no enemy CP bound, ``SmartBot.adjusted``), does not see the
engagement zone (DEC-37 pin), does not evacuate doomed cities and sends no scouts.

The levels (``DIFFICULTIES``) are calibrated against the unlimited smart bots measured with
``gow-bots stats`` on ``mvp-1`` (3 maps, PR 3 description): 12 to 16 commands a minute on
average, peaks of 24 to 71 in one minute. ``hard`` is the unlimited play with the bursts cut to a
fast human (40 a minute) and no reaction delay beyond the call (5 ticks); ``normal`` and ``easy`` slow it down. There
are no human replays to measure yet (the playtest replays are on the owner's server); the human
figures are an assumption to check with ``mise run stats`` on them (#166).

Integers only, no randomness: a tempo is a pure function of the ticks, so a match stays a
function of ``(map, ruleset, bots, seed)`` and the two sides stay mirror-symmetric.
"""

import dataclasses
from dataclasses import dataclass
from typing import Final

from gow_sim.view import PlayerView

__all__ = ["DEFAULT_DIFFICULTY", "DIFFICULTIES", "Bucket", "Perception", "Tempo"]


@dataclass(frozen=True, slots=True)
class Tempo:
    """The pace of one difficulty level (module docstring)."""

    think_ticks: int
    react_ticks: int
    apm: int
    burst: int
    insight: bool

    def __post_init__(self) -> None:
        if self.think_ticks < 1 or self.react_ticks < 0 or self.apm < 1 or self.burst < 1:
            raise ValueError(f"bad tempo {self}")


DIFFICULTIES: Final[dict[str, Tempo]] = {
    "easy": Tempo(think_ticks=20, react_ticks=30, apm=12, burst=3, insight=False),
    "normal": Tempo(think_ticks=10, react_ticks=15, apm=25, burst=5, insight=True),
    "hard": Tempo(think_ticks=5, react_ticks=0, apm=40, burst=8, insight=True),
}
"""Difficulty name to its tempo, easiest first."""
DEFAULT_DIFFICULTY: Final = "hard"
"""The level of a smart bot named without one (``smart_rusher`` is ``smart_rusher@hard``)."""


class Bucket:
    """A token bucket of commands: ``apm`` a minute, at most ``burst`` saved, full at the start.

    Tokens are counted in ``1 / ticks_per_minute`` of a command, so the refill of every tick is the
    integer ``apm`` (AGENTS.md, section 4.1: integers only, the bots keep to it too)."""

    def __init__(self, tempo: Tempo, tick_hz: int) -> None:
        self.per = 60 * tick_hz
        """Tokens of one command: the ticks of a minute."""
        self.rate = tempo.apm
        self.cap = tempo.burst * self.per
        self.tokens = self.cap
        self.tick = 0

    def refill(self, tick: int) -> None:
        self.tokens = min(self.cap, self.tokens + max(0, tick - self.tick) * self.rate)
        self.tick = max(self.tick, tick)

    def ready(self) -> bool:
        return self.tokens >= self.per

    def take(self) -> bool:
        """Pay one command; ``False`` (nothing paid) when the bucket is short."""
        if self.tokens < self.per:
            return False
        self.tokens -= self.per
        return True


class Perception:
    """What of the enemy a bot has noticed: strikes and figures shown at least ``react_ticks``
    ago (module docstring)."""

    def __init__(self, react_ticks: int) -> None:
        self.react = react_ticks
        self.figures: dict[int, int] = {}
        """Opaque figure id to the tick it was first shown."""

    def view(self, view: PlayerView) -> PlayerView:
        """``view`` without the enemy strikes and figures not noticed yet."""
        tick, react, me = view.tick, self.react, view.player
        shown: dict[int, int] = {}
        for e in view.edges:
            for f in e.enemy_groups:
                shown[f.id] = self.figures.get(f.id, tick)
        self.figures = shown
        if react <= 0:
            return view
        intents = tuple(i for i in view.intents if i.owner == me or i.created_tick + react <= tick)
        edges = view.edges
        if any(shown[f.id] + react > tick for e in edges for f in e.enemy_groups):
            edges = tuple(
                dataclasses.replace(
                    e,
                    enemy_groups=tuple(f for f in e.enemy_groups if shown[f.id] + react <= tick),
                )
                if e.enemy_groups
                else e
                for e in edges
            )
        if len(intents) == len(view.intents) and edges is view.edges:
            return view
        return dataclasses.replace(view, intents=intents, edges=edges)
