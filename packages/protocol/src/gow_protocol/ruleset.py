"""``ruleset_public``: the part of the ruleset the client needs (sent once, in ``welcome``).

Only what the client uses (AGENTS.md, section 7.1):

- command costs, for the cost preview of an order (CLI-06, #62);
- the combat parameters (CLI-08, #64): the terrain defense modifier (DEC-07, rule 1; a negative
  one burns charges in the first round, DEC-45), the pace of a fight, whether a group may leave
  a fight (DEC-40, ``combat.retreat``), for the retreat hints;
- the clock and the CP income, for the HUD timer and the CP bar (CLI-08);
- the stances (DEC-44, ``stances``): the periods of the CP income and of the own capital by
  stance, for the stance menu and the progress in the HUD;
- the gathering pace of planned orders (DEC-41, item 10);
- the attrition and grace ticks, for the overcrowding countdown (ui-style 12);
- the recruit queue numbers, for the production progress over a city and the cancel refund
  (DEC-25);
- the barracks (DEC-26), its price in charges and duration, and the warehouse of a province
  (DEC-41, item 13), for the city menu;
- the factories (DEC-41, item 2) and the road fortifications (DEC-43, item D);
- the period of the supply dispatch (DEC-43, ``supply_dispatch_ticks``);
- the vision table by terrain (DEC-21, item 2), for the legend of the terrain map mode (#429);
- the price of a capture in charges (DEC-38, item 10), for the order tooltip and the help.

The rules are the same for both players, so nothing here is hidden information.
"""

from typing import Annotated, Self

from pydantic import Field

from gow_protocol.base import Centi, NonNegInt, PosInt, SignedInt, WireModel
from gow_sim.ruleset import (
    Retreat,
    Ruleset,
    Sight,
    SightTable,
    StanceTable,
)


class CostsPublic(WireModel):
    """Command costs in hundredths of CP (``orders.cost`` of the ruleset)."""

    move: Centi
    planned_move: Centi
    cancel: Centi
    split: Centi
    merge: Centi
    recruit: Centi
    stance: Centi
    barracks: Centi
    """``build_barracks`` (DEC-26, item 2); its charges are ``city_upgrades.barracks_charges``."""


class TerrainDefensePublic(WireModel):
    """``terrain.defense_mod``: charges added to the node defender's pool; a negative value burns
    that many of its charges at the start of the first round (DEC-45)."""

    plains: SignedInt
    forest: SignedInt
    mountains: SignedInt


class CombatPublic(WireModel):
    terrain_defense_mod: TerrainDefensePublic
    round_ticks: PosInt
    """Ticks between the rounds of a fight (DEC-24, item B): the round progress of a fight."""
    shots_per_round: PosInt
    regroup_ticks: NonNegInt
    """The pause of an edge winner before it goes on (DEC-24, item G4)."""
    retreat: Retreat
    """``round``: a group may leave a fight after the nearest round (DEC-24, item E); ``none``:
    no retreat (DEC-40, variant N), the client hides the retreat hints and the cancel in a fight."""


class CapturePublic(WireModel):
    """``capture`` of the ruleset (DEC-38): a capture spends ``charge_cost`` real charges of the
    capturing groups in the node, with fewer they bounce; 0: a capture is free."""

    charge_cost: NonNegInt


class CpPublic(WireModel):
    """CP: ``per_period`` hundredths per quantum, up to ``cap``; the period of the quantum is
    ``stances.cp_period_ticks`` of the own stance."""

    cap: Centi
    per_period: Centi


Percent = Annotated[int, Field(ge=0, le=100)]


class StancePeriodsPublic(WireModel):
    """Ticks per quantum under each stance (DEC-44)."""

    economy: PosInt
    balance: PosInt
    war: PosInt

    @classmethod
    def from_table(cls, table: StanceTable) -> Self:
        return cls(economy=table.economy, balance=table.balance, war=table.war)


class StancesPublic(WireModel):
    """Stances with local progress (``stances`` of the ruleset, DEC-44)."""

    cp_period_ticks: StancePeriodsPublic
    """One CP quantum (``cp.per_period``) per this many ticks; ``View.me.cp_ticks`` counts them."""
    capital_period_ticks: StancePeriodsPublic
    """One charge of the own capital per this many ticks; ``View.me.capital_ticks`` counts them."""
    factories_follow: bool
    """DEC-47 (#888): every other own factory (built or captured) makes one charge per
    ``capital_period_ticks`` of the own stance as well, on its own counter, so a stance's charge
    rate is this period times the own factories; ``False``: they keep ``factory.built_period_ticks``
    whatever the stance."""


class OrdersPublic(WireModel):
    """Planned orders (``orders`` of the ruleset)."""

    plan_ticks_per_bonus: PosInt
    """A gathering planned order takes one charge and gains one bonus per this many ticks
    (DEC-41, item 10)."""


class CapacityPublic(WireModel):
    """Overcrowding attrition (``capacity`` of the ruleset), for the countdown of ui-style 12."""

    attrition_ticks: PosInt
    """Ticks over the capacity in a row before one unit dies."""
    grace_ticks: NonNegInt
    """Ticks after a capture in which the garrison is not counted."""


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
    """The barracks (DEC-26; ``city_upgrades`` of the ruleset) and the warehouse of a province."""

    barracks_ticks: PosInt
    """Ticks from the full payment to the barracks."""
    barracks_charges: NonNegInt
    """The barracks costs this many charges (DEC-41, item 7)."""
    warehouse_province: NonNegInt
    """The warehouse of every province holds this many charges (DEC-41, item 13)."""


class FactoryPublic(WireModel):
    """Factories (``factory`` of the ruleset, DEC-41, item 2). The own capital makes one charge
    per ``stances.capital_period_ticks`` of the own stance."""

    built_period_ticks: PosInt | None
    """Every other factory makes one charge per this many ticks; ``None`` under
    ``stances.factories_follow`` (DEC-47): then it follows the stance like the capital."""
    cost: NonNegInt
    """Charges ``build_factory`` pays (progressive payment, item 7)."""
    build_ticks: PosInt
    """Ticks from the full payment to the factory."""
    max: PosInt
    """Factories of a player at most, the capital and the builds under way included."""


class FortPublic(WireModel):
    """Road fortifications (``fort`` of the ruleset, DEC-43, item D)."""

    cost: NonNegInt
    """CP in hundredths ``fortify_road`` costs, flat."""
    build_ticks: PosInt
    """Ticks from the command to a working fortification."""
    toll_units: PosInt
    """The toll: ``toll_charges`` per started ``toll_units`` units of an enemy group crossing the
    line towards the node, never more than its charged units."""
    toll_charges: NonNegInt


class SightRowPublic(WireModel):
    """What a source on one terrain shows of a neighbouring node, by the terrain of that node."""

    plains: Sight
    forest: Sight
    mountains: Sight

    @classmethod
    def from_table(cls, table: SightTable) -> Self:
        return cls(plains=table.plains, forest=table.forest, mountains=table.mountains)


class VisionTablePublic(WireModel):
    """One row per terrain of the source."""

    plains: SightRowPublic
    forest: SightRowPublic
    mountains: SightRowPublic


class VisionPublic(WireModel):
    """The vision table by terrain (``vision.by_terrain``, DEC-21, item 2): ``by_terrain.<source>.
    <target>`` is ``exact``, ``range`` or ``presence``. The client only displays it (the legend of
    the terrain map mode); the level of a place in the snapshot is decided by the server."""

    by_terrain: VisionTablePublic


class RulesetPublic(WireModel):
    tick_hz: PosInt
    match_ticks: PosInt
    cp: CpPublic
    cost: CostsPublic
    combat: CombatPublic
    capture: CapturePublic
    orders: OrdersPublic
    capacity: CapacityPublic
    recruit: RecruitPublic
    city_upgrades: CityUpgradesPublic
    vision: VisionPublic
    factory: FactoryPublic
    fort: FortPublic
    supply_dispatch_ticks: PosInt
    """``supply.dispatch_ticks``: the supply dispatch runs on the ticks ``t > 0`` divisible by it
    (DEC-43, item A6), so the countdown to ``View.me.next_dispatch_tick`` is exact from the first
    snapshot (#705)."""
    stances: StancesPublic

    @classmethod
    def from_ruleset(cls, rules: Ruleset) -> Self:
        cost = rules.orders.cost
        defense_mod = rules.terrain.defense_mod
        return cls(
            tick_hz=rules.tick_hz,
            match_ticks=rules.match_ticks,
            cp=CpPublic(cap=rules.cp.cap, per_period=rules.cp.per_period),
            cost=CostsPublic(
                move=cost.move,
                planned_move=cost.planned_move,
                cancel=cost.cancel,
                split=cost.split,
                merge=cost.merge,
                recruit=cost.recruit,
                stance=cost.stance,
                barracks=cost.barracks,
            ),
            combat=CombatPublic(
                terrain_defense_mod=TerrainDefensePublic(
                    plains=defense_mod.plains,
                    forest=defense_mod.forest,
                    mountains=defense_mod.mountains,
                ),
                round_ticks=rules.combat.round_ticks,
                shots_per_round=rules.combat.shots_per_round,
                regroup_ticks=rules.combat.regroup_ticks,
                retreat=rules.combat.retreat,
            ),
            capture=CapturePublic(charge_cost=rules.capture.charge_cost),
            orders=OrdersPublic(plan_ticks_per_bonus=rules.orders.plan_ticks_per_bonus),
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
                barracks_ticks=rules.city_upgrades.barracks_ticks,
                barracks_charges=rules.city_upgrades.barracks_charges,
                warehouse_province=rules.warehouse.province,
            ),
            vision=VisionPublic(
                by_terrain=VisionTablePublic(
                    plains=SightRowPublic.from_table(rules.vision.by_terrain.plains),
                    forest=SightRowPublic.from_table(rules.vision.by_terrain.forest),
                    mountains=SightRowPublic.from_table(rules.vision.by_terrain.mountains),
                )
            ),
            factory=FactoryPublic(
                built_period_ticks=rules.factory.built_period_ticks,
                cost=rules.factory.cost,
                build_ticks=rules.factory.build_ticks,
                max=rules.factory.max,
            ),
            fort=FortPublic(
                cost=rules.fort.cost,
                build_ticks=rules.fort.build_ticks,
                toll_units=rules.fort.toll_units,
                toll_charges=rules.fort.toll_charges,
            ),
            supply_dispatch_ticks=rules.supply.dispatch_ticks,
            stances=StancesPublic(
                cp_period_ticks=StancePeriodsPublic.from_table(rules.stances.cp_period_ticks),
                capital_period_ticks=StancePeriodsPublic.from_table(
                    rules.stances.capital_period_ticks
                ),
                factories_follow=rules.stances.factories_follow,
            ),
        )
