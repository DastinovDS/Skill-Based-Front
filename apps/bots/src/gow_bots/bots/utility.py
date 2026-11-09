"""The shared utility of all bots: a normal or a planned order (AGENTS.md, section 8; BOT-01).

Every bot decides an ordinary or a scheduled order with ``prefer_planned``, and the answer
depends only on the ruleset and what the group can gather, not on bot code.

The price model (DEC-41, item 10; mechanics.md, section 5): a planned order costs what an
ordinary order costs, but every bonus shot is a real charge of the warehouse of the group's node
and ``orders.plan_ticks_per_bonus`` ticks of waiting in public. It pays only when the plan turns a
bounce into a capture (DEC-07, rules 3 and 4: virtual shots are spent first, then real ones).

Fight arithmetic (DEC-07, mechanics.md, section 4): the defender's pool is its charges plus the
terrain modifier, only with at least one firing charge; taking the node needs one shot per pooled
charge (cancelling) and one per defending unit (killing).

Plains (DEC-45): the first round of a fight burns the charges the modifier takes, so the pool of a
defender about to be attacked has them taken off, but in a fight past its first round the charges
the view shows all shoot: the caller says so with ``terrain_burned``. The burned charge is gone
after the fight (``first_burn``).

The price of a capture (DEC-38): a capture spends ``capture.charge_cost`` real charges of the
capturing groups in the node, and with fewer they bounce. Virtual shots fire first in a fight and
never pay, so a group takes a node when its real charges cover the shots the bonus does not and
the price on top (``takes``). With ``charge_cost = 0`` a toll never stops a capture.
"""

from gow_sim.maps import Terrain
from gow_sim.ruleset import Ruleset
from gow_sim.view import PlayerView

__all__ = [
    "defender_pool",
    "first_burn",
    "prefer_planned",
    "shots_to_take",
    "takes",
    "terrain_burned",
]


def terrain_burned(rules: Ruleset, view: PlayerView, node: int) -> bool:
    """Whether a negative terrain of ``node`` no longer acts on the numbers the view shows: a fight
    goes on there and nothing is left to burn (DEC-45). ``rules`` is not read; it keeps the
    signature of the other helpers."""
    del rules
    return any(f.node == node and not any(f.mute) for f in view.fights)


def first_burn(rules: Ruleset, terrain: Terrain, charged: int) -> int:
    """The charges of a defender with ``charged`` charged units that the first round burns
    (DEC-45)."""
    return min(charged, max(0, -rules.terrain.defense_mod.of(terrain)))


def defender_pool(rules: Ruleset, terrain: Terrain, charged: int, *, burned: bool = False) -> int:
    """Pool ``Qd`` of the defenders of a node with ``charged`` firing charges (DEC-07, rule 1).

    ``burned``: ``terrain_burned``, the ``charged`` are what is left after the burn."""
    if charged <= 0:
        return 0
    mod = rules.terrain.defense_mod.of(terrain)
    return max(0, charged + (max(0, mod) if burned else mod))


def shots_to_take(
    rules: Ruleset, terrain: Terrain, units: int, charged: int, *, burned: bool = False
) -> int:
    """Attacker's pool that takes a node held by ``units`` units, ``charged`` of them charged.

    ``c = min(Qa, Qd)`` shots cancel, the surplus ``Qa - Qd`` kills one unit each (DEC-07, rules
    2 and 3), and the node falls when no defender is left (rule 4): ``Qa >= Qd + units``.
    """
    return defender_pool(rules, terrain, charged, burned=burned) + units


def takes(rules: Ruleset, charged: int, bonus: int, need: int, toll: int = 0) -> bool:
    """Whether a group with ``charged`` real charges and ``bonus`` virtual shots takes a node that
    needs ``need`` shots (``shots_to_take``; ``0``: an empty node) and pays for the capture.

    Virtual shots are spent first (DEC-07, rule 2), so ``max(0, need - bonus)`` real charges go in
    the fight and ``capture.charge_cost`` must be left after it (DEC-38, items 2 and 3): an empty
    node never fires the bonus, and only real charges pay.

    ``toll``: the charges a road fortification takes on the way in (DEC-43, item D6), before the
    fight and before the capture, an empty node too; the bonus drops to the charged units left
    (D6, "the planned bonus"). With ``charge_cost = 0`` a toll never stops the capture of an empty
    node.
    """
    cost = rules.capture.charge_cost
    real = max(0, charged - toll)
    bonus = min(bonus, real)
    return real >= cost and real + bonus >= need + cost


def prefer_planned(rules: Ruleset, own_charged: int, need: int, bonus: int | None = None) -> bool:
    """Whether an attack with ``own_charged`` charges on a node that needs ``need`` shots
    (``shots_to_take``) should be a planned order rather than a normal one (module docstring):
    ``bonus`` is what the group can gather (``Bot.plan_bonus``; ``None``: nothing). It pays only
    when the plan turns a bounce into a capture.
    """
    if need <= 0:
        return False  # an empty node: no fight, the bonus is never fired
    b = bonus or 0
    return b >= 1 and not takes(rules, own_charged, 0, need) and takes(rules, own_charged, b, need)
