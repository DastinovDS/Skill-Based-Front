"""``ruleset_public``: the part of the ruleset the client needs (sent once, in ``welcome``).

Only what the client uses (AGENTS.md, section 7.1):

- command costs, for the cost preview of an order (CLI-06, #62);
- the combat estimate parameters (CLI-08, #64): terrain defense modifier and the planned and
  defense bonuses (DEC-07, rule 1; same names as ``packages/protocol/vectors/combat.json``);
- the clock and the CP regeneration, for the HUD timer and the CP bar (CLI-08);
- the road level prices and duration, for the road upgrade hint (DEC-16);
- the stance table and the delays of planned orders, for the stance menu and the countdown on
  order arrows (ui-style 11 and 9.7);
- the attrition and grace ticks, for the overcrowding countdown (ui-style 12);
- the recruit queue numbers, for the production progress over a city and the cancel refund
  (DEC-25);
- the flag and the numbers of the city development (DEC-26, item 10): the barracks and the
  warehouse levels, their prices and durations, for the city menu;
- the range and the start value of the rear minimum (DEC-28, item 3), for the supply slider.

The rules are the same for both players, so nothing here is hidden information.
"""

from typing import Annotated, Self

from pydantic import Field

from gow_protocol.base import Centi, NonNegInt, PosInt, SignedInt, WireModel
from gow_sim.ruleset import Ruleset, Stance


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
    front: Centi
    """``set_front`` (DEC-28, item 2)."""
    rear_min: Centi
    """``set_rear_min`` (DEC-28, item 3)."""
    transfer: Centi
    """``transfer`` (DEC-18, item 6)."""
    barracks: Centi
    """``build_barracks`` (DEC-26, item 2)."""
    warehouse: Centi
    """``upgrade_warehouse``, per level (DEC-26, item 3)."""


class TerrainDefensePublic(WireModel):
    """``terrain.defense_mod``: charges added to the node defender's pool; may be negative."""

    plains: SignedInt
    forest: SignedInt
    mountains: SignedInt


class CombatPublic(WireModel):
    terrain_defense_mod: TerrainDefensePublic
    planned_bonus_per_edge: NonNegInt
    """Virtual shots of a planned order per edge of its path, at most the charged units of the
    group when it departs (DEC-29)."""
    defense_bonus: SignedInt
    round_ticks: PosInt
    """Ticks between the rounds of a fight (DEC-24, item B): the round progress of a fight."""
    shots_per_round: PosInt
    regroup_ticks: NonNegInt
    """The pause of an edge winner before it goes on (DEC-24, item G4)."""


class CpPublic(WireModel):
    """CP regeneration: ``per_period`` hundredths every ``period_ticks`` ticks, up to ``cap``."""

    cap: Centi
    per_period: Centi
    period_ticks: PosInt


Percent = Annotated[int, Field(ge=0, le=100)]


class StancePctPublic(WireModel):
    """``economy.stance_to_charges_pct``: the share of the CP quantum put into charges, in %."""

    economy: Percent
    balance: Percent
    war: Percent


class EconomyPublic(WireModel):
    """The charge production the stance menu shows (``economy`` of the ruleset, DEC-02)."""

    stance_to_charges_pct: StancePctPublic
    charges_per_cp: NonNegInt
    """Charges per whole CP put into charges."""


class OrdersPublic(WireModel):
    """Delays of planned orders and modes, and the stance cooldown (``orders`` of the ruleset)."""

    planned_delay_ticks: NonNegInt
    defense_delay_ticks: NonNegInt
    stance_cooldown_ticks: NonNegInt


class CapacityPublic(WireModel):
    """Overcrowding attrition (``capacity`` of the ruleset), for the countdown of ui-style 12."""

    attrition_ticks: PosInt
    """Ticks over the capacity in a row before one unit dies."""
    grace_ticks: NonNegInt
    """Ticks after a capture in which the garrison is not counted."""


class BuildPublic(WireModel):
    """Road upgrades (``build`` of the ruleset, DEC-28, item 7): the price is ``cost.build`` per
    level, what a level gives is ``upgrade_gain`` of the own edges in the view."""

    ticks_per_level: PosInt


class RecruitPublic(WireModel):
    """The recruit queue of a city (``recruit`` of the ruleset, DEC-25)."""

    unit_ticks: PosInt
    """Ticks of production per unit: the full progress of the current unit."""
    queue_max: PosInt
    """Units in the queue of one city at most, the one in production included."""
    refund_started_pct: Percent
    """Share of ``cost.recruit`` a cancel returns for the unit in production; a unit not started
    yet returns all of it."""


class CityUpgradesPublic(WireModel):
    """City development (DEC-26): ``city_upgrades`` and ``warehouse`` of the ruleset."""

    enabled: bool
    """Off: every city recruits, the warehouse holds the node capacity, no barracks and no
    warehouse levels (the commands are rejected with ``FEATURE_DISABLED``)."""
    barracks_ticks: PosInt
    warehouse_ticks: PosInt
    warehouse_max_level: NonNegInt
    warehouse_gain_per_level: NonNegInt


class SupplyPublic(WireModel):
    """The supply settings of a player (DEC-28): the range of the rear minimum slider."""

    rear_min_max: NonNegInt
    """``set_rear_min`` accepts ``0..rear_min_max``."""
    rear_min_default: NonNegInt
    """The rear minimum every player starts with."""
    front_markers: NonNegInt
    """Front markers of a player: ``set_front`` accepts ``marker`` ``0..front_markers - 1``."""


class RulesetPublic(WireModel):
    tick_hz: PosInt
    match_ticks: PosInt
    cp: CpPublic
    cost: CostsPublic
    combat: CombatPublic
    build: BuildPublic
    economy: EconomyPublic
    orders: OrdersPublic
    capacity: CapacityPublic
    recruit: RecruitPublic
    city_upgrades: CityUpgradesPublic
    supply: SupplyPublic

    @classmethod
    def from_ruleset(cls, rules: Ruleset) -> Self:
        cost = rules.orders.cost
        defense_mod = rules.terrain.defense_mod
        pct = rules.economy.stance_to_charges_pct
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
                front=cost.front,
                rear_min=cost.rear_min,
                transfer=cost.transfer,
                barracks=cost.barracks,
                warehouse=cost.warehouse,
            ),
            combat=CombatPublic(
                terrain_defense_mod=TerrainDefensePublic(
                    plains=defense_mod.plains,
                    forest=defense_mod.forest,
                    mountains=defense_mod.mountains,
                ),
                planned_bonus_per_edge=rules.orders.planned_bonus_per_edge,
                defense_bonus=rules.orders.defense_bonus,
                round_ticks=rules.combat.round_ticks,
                shots_per_round=rules.combat.shots_per_round,
                regroup_ticks=rules.combat.regroup_ticks,
            ),
            build=BuildPublic(ticks_per_level=rules.build.ticks_per_level),
            economy=EconomyPublic(
                stance_to_charges_pct=StancePctPublic(
                    economy=pct.of(Stance.ECONOMY),
                    balance=pct.of(Stance.BALANCE),
                    war=pct.of(Stance.WAR),
                ),
                charges_per_cp=rules.economy.charges_per_cp,
            ),
            orders=OrdersPublic(
                planned_delay_ticks=rules.orders.planned_delay_ticks,
                defense_delay_ticks=rules.orders.defense_delay_ticks,
                stance_cooldown_ticks=rules.orders.stance_cooldown_ticks,
            ),
            capacity=CapacityPublic(
                attrition_ticks=rules.capacity.attrition_ticks,
                grace_ticks=rules.capacity.grace_ticks,
            ),
            recruit=RecruitPublic(
                unit_ticks=rules.recruit.unit_ticks,
                queue_max=rules.recruit.queue_max,
                refund_started_pct=rules.recruit.refund_started_pct,
            ),
            city_upgrades=CityUpgradesPublic(
                enabled=rules.city_upgrades.enabled,
                barracks_ticks=rules.city_upgrades.barracks_ticks,
                warehouse_ticks=rules.city_upgrades.warehouse_ticks,
                warehouse_max_level=rules.warehouse.max_level,
                warehouse_gain_per_level=rules.warehouse.gain_per_level,
            ),
            supply=SupplyPublic(
                rear_min_max=rules.supply.rear_min_max,
                rear_min_default=rules.supply.rear_min_default,
                front_markers=rules.supply.front_markers,
            ),
        )
