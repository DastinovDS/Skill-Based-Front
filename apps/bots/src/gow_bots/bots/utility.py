"""The shared utility of all bots: a normal or a planned order (AGENTS.md, section 8; BOT-01).

Every bot decides an ordinary or a scheduled order with ``prefer_planned``, and the answer
depends only on the prices of the ruleset, so the share of planned orders in a tournament is set by
the ruleset (the calibration of mechanics.md, section 5: 20..70% of attacks), not by bot code.

The price model (mechanics.md, section 5, "How to calculate the bonus"): a planned order buys
virtual shots delivered to the fight, for ``orders.cost.planned_move - orders.cost.move`` extra
CP. Their number grows with the distance (DEC-29): ``orders.planned_bonus_per_edge`` per edge of
the path, at most the charged units of the group (``OrderRules.planned_bonus``), so a deep strike
of a well charged group pays where a strike on a neighbour does not. A shot is priced at the
capital rate: 1 CP buys ``economy.charges_per_cp`` charges (DEC-02). The plan pays when the
shots it saves are worth more than the surcharge. It saves the virtual shots it fires (DEC-07,
rule 2: virtual shots are spent first, then real ones), and when without the bonus the attack
would bounce but with it the node falls (DEC-07, rules 3 and 4), it also saves the real charges
that would otherwise be burnt for nothing. The delay of the plan and its public intent are not
priced: the ruleset has no price for them, they are the counter-play of the opponent.

Fight arithmetic (DEC-07, mechanics.md, section 4): the defender's pool is its charges plus the
Defense bonus and the terrain modifier, both only with at least one firing charge; taking the
node needs one shot per pooled charge (cancelling) and one per defending unit (killing). The
Defense bonus grows with the time in the mode, at most the charged units (DEC-30); the enemy's
number is hidden, so the caller passes an estimate (``Bot.defended``).
"""

from gow_sim.maps import Terrain
from gow_sim.ruleset import Ruleset

__all__ = ["defender_pool", "prefer_planned", "shots_to_take"]


def defender_pool(rules: Ruleset, terrain: Terrain, charged: int, defense: int) -> int:
    """Pool ``Qd`` of the defenders of a node with ``charged`` firing charges (DEC-07, rule 1).

    ``defense``: the Defense bonus gathered by the start of the fight before its cap; the pool
    takes at most ``charged`` of it (DEC-30, item 2)."""
    if charged <= 0:
        return 0
    bonus = min(defense, charged)
    return max(0, charged + bonus + rules.terrain.defense_mod.of(terrain))


def shots_to_take(
    rules: Ruleset, terrain: Terrain, units: int, charged: int, defense: int = 0
) -> int:
    """Attacker's pool that takes a node held by ``units`` units, ``charged`` of them charged.

    ``c = min(Qa, Qd)`` shots cancel, the surplus ``Qa - Qd`` kills one unit each (DEC-07, rules
    2 and 3), and the node falls when no defender is left (rule 4): ``Qa >= Qd + units``.
    """
    return defender_pool(rules, terrain, charged, defense) + units


def prefer_planned(rules: Ruleset, own_charged: int, need: int, edges: int) -> bool:
    """Whether an attack with ``own_charged`` charges on a node ``edges`` edges away that needs
    ``need`` shots (``shots_to_take``) should be a planned order rather than a normal one.

    Integer comparison in hundredths of CP: ``saved * 100 / charges_per_cp > surcharge``.
    """
    if need <= 0:
        return False  # an empty node: no fight, the bonus is never fired
    bonus = rules.orders.planned_bonus(edges, own_charged)
    cost = rules.orders.cost
    surcharge = cost.planned_move - cost.move
    saved = min(bonus, need)
    if own_charged < need <= own_charged + bonus:
        saved += own_charged  # the plan turns a bounce into a capture
    return saved * 100 > surcharge * rules.economy.charges_per_cp
