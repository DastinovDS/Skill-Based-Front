"""The stance policy of the smart bots under ``[stances]`` (DEC-44, #881).

Under the section the stance sets two rates of the own economy and nothing else (DEC-44, items 1
and 2): War gives the most CP and the slowest own capital, Economy the fewest CP and the fastest
capital, Balance the middle. Built factories keep their period whatever the stance. A change is
free and has no cooldown, and it carries both counters over in proportion, rounded down (item 4),
so a change and a change back never gain and lose up to a tick: the policy changes at most once
per ``stance_dwell`` ticks.

The policy reads the ``PlayerView`` through the assessment (``assess.Army``, own CP) and the phase
of the match (``estimate.phase``), all integer:

1. **The stance of the phase** (``stance_opening``, ``stance_midgame``, ``stance_late``): an index
   of ``STANCES``, 0 Economy, 1 Balance, 2 War; the personality's character (the rusher leans War,
   the turtle and the hoarder lean Economy early).
2. **One step toward Economy** while the CP are at the cap or one quantum from it (the next
   quantum burns, DEC-02: more CP buy nothing, more charges do) or while ``stance_wait`` own
   discharged units wait in own nodes and the own city warehouses are less than half full (the
   charges are short).
3. **One step toward War** otherwise, while the own city warehouses are at least ``stance_full``
   percent full and fewer than ``stance_wait`` units wait (the charges are plenty, CP are what the
   bot spends), or while the bot is *pressed* (the own capital in danger or an enemy planned strike
   aimed at an own node, both public) with fewer than ``stance_cp_low`` CP in hundredths (the
   answers are orders, recruits and fortifications: CP).
4. Without ``insight`` (the ``easy`` level, ``gow_bots.bots.tempo``) only item 1: the bot does not
   read the position.

The ``PARAMS`` keys start with ``stance_`` (``base.LATE_KEYS``), so ``choose_params`` draws them
from their own stream: the other parameters of a seed stay as they were.
"""

from dataclasses import dataclass
from typing import Final

from gow_bots.bots.assess import Army
from gow_bots.bots.estimate import Phase
from gow_sim.commands import SetStance
from gow_sim.ruleset import Ruleset, Stance

__all__ = ["STANCES", "StanceInputs", "StancePolicy", "wanted_stance"]

STANCES: Final = (Stance.ECONOMY, Stance.BALANCE, Stance.WAR)
"""From the most charges to the most CP (DEC-44, item 1); the stance parameters index it."""

_PHASE_KEYS: Final = {
    Phase.OPENING: "stance_opening",
    Phase.MIDGAME: "stance_midgame",
    Phase.LATE: "stance_late",
}


@dataclass(frozen=True, slots=True)
class StanceInputs:
    """What the policy reads of one decision."""

    phase: Phase
    cp: int
    """Own CP in hundredths."""
    own: Army
    pressed: bool
    """The own capital in danger, or an enemy planned strike aimed at an own node."""


def wanted_stance(
    rules: Ruleset, params: dict[str, int], inputs: StanceInputs, *, insight: bool
) -> Stance:
    """The stance the policy wants now (module docstring)."""
    at = params[_PHASE_KEYS[inputs.phase]]
    if insight:
        own, cp = inputs.own, rules.cp
        burn = inputs.cp >= cp.cap - cp.per_period
        waiting = own.uncharged_standing >= params["stance_wait"]
        starving = waiting and 2 * own.warehouse < own.warehouse_cap
        plenty = (
            own.warehouse_cap > 0
            and 100 * own.warehouse >= params["stance_full"] * own.warehouse_cap
            and not waiting
        )
        short = inputs.pressed and inputs.cp < params["stance_cp_low"]
        if burn or starving:
            at -= 1
        elif plenty or short:
            at += 1
    return STANCES[max(0, min(len(STANCES) - 1, at))]


class StancePolicy:
    """The dwell of the policy: the tick of the last change it sent."""

    def __init__(self) -> None:
        self.changed: int | None = None

    def command(self, now: Stance, want: Stance, tick: int, dwell: int) -> SetStance | None:
        """``SetStance(want)`` when it is a change and the last one is ``dwell`` ticks old."""
        if want is now or (self.changed is not None and tick - self.changed < dwell):
            return None
        return SetStance(want)

    def sent(self, tick: int) -> None:
        self.changed = tick
