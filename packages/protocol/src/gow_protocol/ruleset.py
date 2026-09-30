"""``ruleset_public``: the part of the ruleset the client needs (sent once, in ``welcome``).

Only what the client uses (AGENTS.md, section 7.1):

- command costs, for the cost preview of an order (CLI-06, #62);
- the combat estimate parameters (CLI-08, #64): terrain defense modifier and the planned and
  defense bonuses (DEC-07, rule 1; same names as ``packages/protocol/vectors/combat.json``);
- the clock and the CP regeneration, for the HUD timer and the CP bar (CLI-08).

The rules are the same for both players, so nothing here is hidden information.
"""

from typing import Self

from gow_protocol.base import Centi, PosInt, SignedInt, WireModel
from gow_sim.ruleset import Ruleset


class CostsPublic(WireModel):
    """Command costs in hundredths of CP (``orders.cost`` of the ruleset)."""

    move: Centi
    planned_move: Centi
    cancel: Centi
    split: Centi
    merge: Centi
    attack: Centi
    defense: Centi
    build: Centi
    recruit: Centi
    stance: Centi


class TerrainDefensePublic(WireModel):
    """``terrain.defense_mod``: charges added to the node defender's pool; may be negative."""

    plains: SignedInt
    forest: SignedInt
    mountains: SignedInt


class CombatPublic(WireModel):
    terrain_defense_mod: TerrainDefensePublic
    planned_bonus: SignedInt
    defense_bonus: SignedInt


class CpPublic(WireModel):
    """CP regeneration: ``per_period`` hundredths every ``period_ticks`` ticks, up to ``cap``."""

    cap: Centi
    per_period: Centi
    period_ticks: PosInt


class RulesetPublic(WireModel):
    tick_hz: PosInt
    match_ticks: PosInt
    cp: CpPublic
    cost: CostsPublic
    combat: CombatPublic

    @classmethod
    def from_ruleset(cls, rules: Ruleset) -> Self:
        cost = rules.orders.cost
        defense_mod = rules.terrain.defense_mod
        return cls(
            tick_hz=rules.tick_hz,
            match_ticks=rules.match_ticks,
            cp=CpPublic(
                cap=rules.cp.cap, per_period=rules.cp.per_period, period_ticks=rules.cp.period_ticks
            ),
            cost=CostsPublic(
                move=cost.move,
                planned_move=cost.planned_move,
                cancel=cost.cancel,
                split=cost.split,
                merge=cost.merge,
                attack=cost.attack,
                defense=cost.defense,
                build=cost.build,
                recruit=cost.recruit,
                stance=cost.stance,
            ),
            combat=CombatPublic(
                terrain_defense_mod=TerrainDefensePublic(
                    plains=defense_mod.plains,
                    forest=defense_mod.forest,
                    mountains=defense_mod.mountains,
                ),
                planned_bonus=rules.orders.planned_bonus,
                defense_bonus=rules.orders.defense_bonus,
            ),
        )
