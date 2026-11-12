"""Human tempo and difficulty levels of the smart bots (#166, PR 3).

A bot is called every 5 ticks (``run_headless``, the server) and could answer every call with
any number of commands, reacting to a shown enemy in half a second. A ``Tempo`` limits it to a
human pace, three ways:

- **Thinking**: a decision at most every ``think_ticks`` ticks (the calls between return nothing).
- **Reaction**: an enemy strike (a planned order's public intent, DEC-08) and an enemy figure on
  an edge (DEC-33; its opaque id is new on every exit from the fog) are *noticed* only
  ``react_ticks`` after they are first shown (``Perception``): until then the decision runs on a
  view without them. Fights and the own state are seen at once.
- **APM**: a token bucket of commands (``Bucket``): ``apm`` commands with a CP price per minute
  of match time, at most ``burst`` saved up. A free command (a split, a merge, a cancel, a stance
  change, a release, a factory build paid in charges) needs a ready bucket and takes nothing
  from it (#1015), so ``apm_avg`` of ``gow-bots stats`` (every command) is above ``apm``; a
  command the bucket cannot pay is not sent (the decision goes on in its priority order, so the
  cheap, urgent ones come first).

``insight`` is the quality of the assessment: without it the bot plays its drawn thresholds
whatever the position (no VP forecast, no enemy CP bound, ``SmartBot.adjusted``), does not see the
engagement zone (DEC-37 pin), does not evacuate doomed cities and sends no scouts. Every level has
it (#749): without it the bot is not weaker, only different (below); ``False`` stays for tests.

**What binds under ``mvp-4``** (#749; the 16-bot field run of #706 and short local runs). The CP
income (1 CP per 100 ticks, about 93 CP a match, ``mvp-4``) binds every level: the bots spend 98%
of it and send 118 to 136 commands a match (about 9 a minute, two thirds of them paid), whatever
the level. So a think interval, a reaction delay or an APM above that demand changes almost
nothing: the old ``normal`` (10 ticks, 15 ticks, 25 APM) and ``hard`` were within each other's
interval for every personality, and the old ``easy`` (20, 30, 12 APM, no ``insight``) could send
180 commands and sent 136. The old ``easy`` differed only by ``insight``, which is not a strength:
a bot without it at the ``hard`` tempo plays even with ``hard`` (0.53 for ``smart_strangler`` and
``smart_reactive``, 32 matches each), and since it reads no arrival, pin or plan it does not care
about a late view, while the same late view (40-tick decisions, 100-tick reaction) costs a bot with
``insight`` most of its matches (0.25 against ``hard``). Hence ``smart_reactive`` and
``smart_strangler`` ``easy`` beat ``normal`` 0.61 in the field run.

**The lever that binds is the APM bucket below the demand.** At 8 commands a minute a bot plays
even with ``hard`` (0.53, 32 matches), at 7 it wins 0.38 (24), at 6 almost nothing (0 of 32,
1 of 24): every command it cannot pay is one of the later, offensive priorities (the decision
spends in order: fights, economy, garrisons, then attacks and recruits), while the CP keep coming.
The human figure it models: the owner played ``mvp-3`` match 6 at 8.5 commands a minute on average
(``docs/balance/bot-audit-2026-11.md``, section 1). ``hard`` keeps the unlimited play (40, above
any demand); ``normal`` and ``easy`` cut it below the demand. The think and reaction delays keep
their old values (they model the human pace, not the strength).

**Only priced commands count** (#1015, ``mvp-7``). The bucket of 6 and 7 commands a minute counted
the free ones too, about a third of what the slow levels sent (a stance change, a split, a
cancel), and the road fortification of the CP sink came first in every decision near the cap, so
``easy`` put 27 to 42% of its CP into lines that took back about 0.3 charges each and ``normal``
8 to 24% (the field run of 2026-11-12). Now the sink comes last and shares the fortification
budget (``SmartBot`` item 26) and the bucket pays only priced commands, at 4 and 5 a minute: the
paid commands a match stay where they were (about 60 for ``easy``, 71 for ``normal``, 78 for
``hard``), now orders instead of lines, and the ladder with them (the field run of #1015, 120
matches a pair of levels over the five personalities: ``hard`` over ``easy`` 0.76, over
``normal`` 0.61, ``normal`` over ``easy`` 0.69; 0.79, 0.68, 0.73 before). 3 and 4 a minute
separate the levels more but burn 10 to 14% of their CP at the cap.

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
    "easy": Tempo(think_ticks=20, react_ticks=30, apm=4, burst=3, insight=True),
    "normal": Tempo(think_ticks=10, react_ticks=15, apm=5, burst=4, insight=True),
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

    def glance(self, tick: int, figures: tuple[int, ...]) -> None:
        """Note the enemy figures shown at ``tick`` (their opaque ids in view order,
        ``gow_sim.view.enemy_figure_ids``) without a view: what ``view`` notes of them."""
        known = self.figures
        self.figures = {f: known.get(f, tick) for f in figures}

    def view(self, view: PlayerView) -> PlayerView:
        """``view`` without the enemy strikes and figures not noticed yet."""
        tick, react, me = view.tick, self.react, view.player
        self.glance(tick, tuple(f.id for e in view.edges for f in e.enemy_groups))
        shown = self.figures
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
