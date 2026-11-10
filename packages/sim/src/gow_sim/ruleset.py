"""Ruleset: every number and flag of the game rules as data (SIM-01), and its TOML loader.

Systems read rule numbers only from ``Ruleset`` (AGENTS.md, section 4.1, rule 7). The field names
equal the keys of ``rulesets/*.toml``; the meaning of each key is commented in
``rulesets/mvp-7.toml``. Units: durations in ticks, CP in hundredths, percentages as integers.

Every ruleset plays economy v2 (DEC-41) with the automatic supply flow (DEC-43), the stances of
DEC-44, the road fortifications of DEC-43 item D and the terrain burn of DEC-45; the rulesets of
economy v1 and of the drawn lines were removed with their code (#894, 2026-11-09).

File I/O is allowed in this module (AGENTS.md, section 4.1, rule 1).
"""

import dataclasses
import tomllib
from dataclasses import dataclass
from enum import StrEnum
from itertools import pairwise
from math import isqrt
from pathlib import Path
from typing import Final, cast

from gow_sim.canonical import digest
from gow_sim.maps import MapDef, NodeKind, Terrain


class RulesetError(ValueError):
    """The ruleset file is malformed: unknown or missing key, wrong type or value out of range."""


class Stance(StrEnum):
    """The stance of a player (DEC-44): the rate of the CP income and of the own capital (with
    ``stances.factories_follow``, DEC-47, of every factory)."""

    ECONOMY = "economy"
    BALANCE = "balance"
    WAR = "war"


OPTIONAL: Final = {"optional": True}
"""Metadata of a field whose key may be left out of the file: at its default it is left out of
``to_canonical`` too."""


class Retreat(StrEnum):
    """``combat.retreat`` (DEC-40, #626): ``round`` is the retreat of DEC-24, item E (a group
    leaves a fight after the nearest round); ``none`` is variant N: a group that entered a fight
    stays in it until the fight ends."""

    ROUND = "round"
    NONE = "none"


@dataclass(frozen=True, slots=True)
class TerrainTable:
    """One integer per terrain type."""

    plains: int
    forest: int
    mountains: int

    def of(self, terrain: Terrain) -> int:
        match terrain:
            case Terrain.PLAINS:
                return self.plains
            case Terrain.FOREST:
                return self.forest
            case Terrain.MOUNTAINS:
                return self.mountains


@dataclass(frozen=True, slots=True)
class StanceTable:
    """One integer per stance."""

    economy: int
    balance: int
    war: int

    def of(self, stance: Stance) -> int:
        match stance:
            case Stance.ECONOMY:
                return self.economy
            case Stance.BALANCE:
                return self.balance
            case Stance.WAR:
                return self.war


@dataclass(frozen=True, slots=True)
class KindTable:
    """One integer per node kind (DEC-22, item 1)."""

    capital: int
    city_large: int
    city_medium: int
    city_small: int
    province: int

    def of(self, kind: NodeKind) -> int:
        match kind:
            case NodeKind.CAPITAL:
                return self.capital
            case NodeKind.CITY_LARGE:
                return self.city_large
            case NodeKind.CITY_MEDIUM:
                return self.city_medium
            case NodeKind.CITY_SMALL:
                return self.city_small
            case NodeKind.PROVINCE:
                return self.province


@dataclass(frozen=True, slots=True)
class CityKindTable:
    """One integer per city kind (DEC-26, item 2); a province has no warehouse: ``of`` gives 0."""

    capital: int
    city_large: int
    city_medium: int
    city_small: int

    def of(self, kind: NodeKind) -> int:
        match kind:
            case NodeKind.CAPITAL:
                return self.capital
            case NodeKind.CITY_LARGE:
                return self.city_large
            case NodeKind.CITY_MEDIUM:
                return self.city_medium
            case NodeKind.CITY_SMALL:
                return self.city_small
            case NodeKind.PROVINCE:
                return 0


@dataclass(frozen=True, slots=True)
class CpRules:
    """CP (DEC-02): the stock at the start, the cap and the quantum; the period of the quantum is
    set by the stance (``stances.cp_period_ticks``, DEC-44)."""

    start: int
    cap: int
    per_period: int


@dataclass(frozen=True, slots=True)
class EconomyRules:
    start_stance: Stance
    """The stance of both players at the start (DEC-09). Only the capital keeps the start stock of
    the map, the other cities start empty (DEC-41, item 9)."""


@dataclass(frozen=True, slots=True)
class OrderCosts:
    """Command costs in hundredths of CP."""

    move: int
    planned_move: int
    cancel: int
    split: int
    merge: int
    recruit: int
    stance: int
    barracks: int
    """``BuildBarracks``: the barracks of a city (DEC-26, item 2), paid in charges besides."""


@dataclass(frozen=True, slots=True)
class OrderRules:
    plan_ticks_per_bonus: int
    """A waiting planned order takes one real charge from the warehouse of its node and gains one
    bonus once per this many ticks (DEC-41, item 10)."""
    cost: OrderCosts


@dataclass(frozen=True, slots=True)
class TerrainRules:
    defense_mod: TerrainTable
    """Virtual shots of a node defender by the terrain; a negative value burns that many of its
    charges at the start of the first round (DEC-45)."""
    speed_pct: TerrainTable
    """Movement speed in the zone of a node of this terrain, in percent (#253)."""


@dataclass(frozen=True, slots=True)
class CombatRules:
    """Fights over time (DEC-24, item B): rounds every ``round_ticks``, ``shots_per_round`` shots
    of each side per round; the winner of an edge fight goes on ``regroup_ticks`` after its end.
    ``engage_ticks``: the engagement zone of a node (DEC-37): a defender that left the node at most
    this many ticks ago (counting the current one) is caught into the attacker's fight; 0: off."""

    round_ticks: int
    shots_per_round: int
    regroup_ticks: int
    engage_ticks: int
    retreat: Retreat = dataclasses.field(default=Retreat.ROUND, metadata=OPTIONAL)
    """``none``: no retreat from a fight (DEC-40, variant N): the defender's ``Move`` and the
    ``CancelOrder`` of an attacker or of a group on an edge in a fight are rejected with
    ``IN_FIGHT``. Left out of the hash at ``round``."""


@dataclass(frozen=True, slots=True)
class CaptureRules:
    """The price of a capture (DEC-38): ``charge_cost`` real charges of the capturing player's
    groups in the node are spent when it changes its owner; with fewer the groups bounce. 0: off,
    a capture is free."""

    charge_cost: int


@dataclass(frozen=True, slots=True)
class CapacityRules:
    attrition_ticks: int
    grace_ticks: int
    by_kind: KindTable
    """Capacity of a node by its kind (DEC-22, item 1)."""


@dataclass(frozen=True, slots=True)
class StarvationRules:
    """Starvation of a factory-less pocket (DEC-43, item H; the consumption of DEC-19):
    ``charges`` per started ``per_units`` standing units every ``period_ticks``, the first time
    ``grace_ticks`` after the cut."""

    grace_ticks: int
    period_ticks: int
    charges: int
    per_units: int


@dataclass(frozen=True, slots=True)
class SupplyRules:
    """The automatic supply flow (DEC-43)."""

    dispatch_ticks: int
    recharge_per_tick: int
    speed_pct: int
    """Packet speed on every road (DEC-41, item 8)."""
    leaf_shift: bool = dataclasses.field(default=True, metadata=OPTIONAL)
    """DEC-43, item B: the player may move the level back with ``SetLeafShift``. ``False``
    (DEC-50): the shift stays 0 and the command is rejected. Left out of the hash at ``True``."""


@dataclass(frozen=True, slots=True)
class RecruitRules:
    """The recruit queue of a city (DEC-25): one unit at a time, ``unit_ticks`` per unit."""

    unit_ticks: int
    """Ticks of production per unit (DEC-25, item 4)."""
    queue_max: int
    """Units in the queue of one city at most, the one in production included (DEC-25, item 6)."""
    refund_started_pct: int
    """Share of ``orders.cost.recruit`` returned for a cancelled unit in production, in percent
    (DEC-25, item 3); a unit not started yet is returned in full."""
    rally_point: bool = dataclasses.field(default=False, metadata=OPTIONAL)
    """DEC-48, item H: a city may send its new units to a rally point (``SetRallyPoint``). Left
    out of the hash at ``False``."""
    rally_cost: int = dataclasses.field(default=0, metadata=OPTIONAL)
    """DEC-48, item H3: hundredths of CP a recruit pays when it leaves for the rally point,
    ``0..orders.cost.move``; given exactly when ``rally_point`` is on (0 and left out of the hash
    otherwise)."""


@dataclass(frozen=True, slots=True)
class CityUpgradeRules:
    """The barracks of a city (DEC-26): the capital has one from the start, another city builds
    it; only a city with a barracks recruits."""

    barracks_ticks: int
    """Ticks to build the barracks after its full payment (item 2)."""
    barracks_charges: int
    """The charges the barracks costs (DEC-41, item 7, the progressive payment)."""


@dataclass(frozen=True, slots=True)
class WarehouseRules:
    """Fixed warehouses (DEC-43, item C): the capacity of a city by its kind, of a province
    ``province`` (DEC-41, item 13)."""

    start_by_kind: CityKindTable
    province: int


@dataclass(frozen=True, slots=True)
class FactoryRules:
    """Supply factories (DEC-41, item 2): a factory city makes one charge per period into its own
    warehouse. The own capital at the period of its owner's stance (DEC-44); every other factory
    at ``built_period_ticks``, or with ``stances.factories_follow`` (DEC-47) at the stance period
    too."""

    cost: int
    """Charges ``BuildFactory`` pays (the progressive payment of DEC-41, item 7)."""
    build_ticks: int
    """Ticks from the full payment of ``BuildFactory`` to the factory."""
    max: int
    """Factories of a player at most, the capital and the builds under way included."""
    built_period_ticks: int | None = dataclasses.field(default=None, metadata=OPTIONAL)
    """Every other factory (a built one or a captured one, a captured capital too); required
    without ``stances.factories_follow`` and not allowed with it."""


@dataclass(frozen=True, slots=True)
class StanceRules:
    """Stances with local progress (DEC-44, section ``[stances]``): the periods of the player's
    stance, counted from the player's own last quantum."""

    cp_period_ticks: StanceTable
    """Ticks per CP quantum (``cp.per_period``) under each stance."""
    capital_period_ticks: StanceTable
    """Ticks per charge of the own capital under each stance."""
    factories_follow: bool = dataclasses.field(default=False, metadata=OPTIONAL)
    """DEC-47 (#888): every other factory of the player (built or captured, a captured capital
    too) makes its charges by ``capital_period_ticks`` of its owner's stance as well, each on its
    own counter (``Node.factory_ticks``). Left out of the hash when ``False``."""


@dataclass(frozen=True, slots=True)
class MapTempoRules:
    """Map tempo (DEC-46, #803): the economy periods of a match scaled once by the node count of
    its map (``apply_map_tempo``). The square root is the only form (the owner rejected the linear
    one, 2026-11-07)."""

    ref_nodes: int
    """The node count where the multiplier is exactly 100."""
    min_pct: int
    """The multiplier is clamped to ``min_pct..max_pct`` (percent)."""
    max_pct: int

    def pct(self, nodes: int) -> int:
        """The multiplier in percent for a map of ``nodes`` nodes:
        ``isqrt(nodes * 10000 // ref_nodes)`` (both steps rounded down), clamped to
        ``min_pct..max_pct``."""
        raw = isqrt(nodes * 10000 // self.ref_nodes)  # non-negative: rounded down
        return max(self.min_pct, min(self.max_pct, raw))


MAX_GROUP_ORDER: Final = 16
"""The largest ``group_order.max_groups``: the protocol bound of a ``GroupMove`` list (DEC-48,
item J)."""


@dataclass(frozen=True, slots=True)
class GroupOrderRules:
    """The group order (DEC-48, section ``[group_order]``): one ``GroupMove`` for several own
    groups, a rally to an own node or an attack with a synchronized arrival."""

    max_groups: int
    """Groups in one ``GroupMove`` at most, ``1..MAX_GROUP_ORDER``."""
    rally_pct: int
    """The price of a rally per group in percent of ``orders.cost.move``, the total rounded up to
    a whole CP (item A2)."""


@dataclass(frozen=True, slots=True)
class FortRules:
    """Road fortifications (DEC-43, item D; code name ``road_fort``): a line at the border point
    of a road leaving an own node that takes charges from an enemy group crossing it towards the
    node."""

    cost: int
    """CP in hundredths ``FortifyRoad`` costs, flat (item D2)."""
    build_ticks: int
    """Ticks from the command to a working fortification (item D4)."""
    toll_units: int
    """The toll is ``toll_charges`` per started ``toll_units`` units of the group (item D6)."""
    toll_charges: int
    """Charges taken per started ``toll_units`` units, never more than the group's charged."""

    def toll(self, units: int, charged: int) -> int:
        """The charges a group of ``units``, ``charged`` loses on one line (item D6):
        ``min(charged, toll_charges * ceil(units / toll_units))``; non-negative, rounded down."""
        started = (units + self.toll_units - 1) // self.toll_units
        return min(charged, self.toll_charges * started)


@dataclass(frozen=True, slots=True)
class VictoryRules:
    vp_period_ticks: int
    capital_multiplier: int


class Sight(StrEnum):
    """What a source of vision shows of a neighbouring node (DEC-21, item 2): the detail levels
    ``exact``, ``range`` and ``presence`` of ``gow_sim.state.Detail`` (never fog)."""

    EXACT = "exact"
    RANGE = "range"
    PRESENCE = "presence"


@dataclass(frozen=True, slots=True)
class SightTable:
    """One ``Sight`` per terrain of the target node."""

    plains: Sight
    forest: Sight
    mountains: Sight

    def of(self, terrain: Terrain) -> Sight:
        match terrain:
            case Terrain.PLAINS:
                return self.plains
            case Terrain.FOREST:
                return self.forest
            case Terrain.MOUNTAINS:
                return self.mountains


@dataclass(frozen=True, slots=True)
class SightByTerrain:
    """``by_terrain.<terrain of the source>.<terrain of the target>`` (DEC-21, item 2)."""

    plains: SightTable
    forest: SightTable
    mountains: SightTable

    def of(self, source: Terrain, target: Terrain) -> Sight:
        match source:
            case Terrain.PLAINS:
                table = self.plains
            case Terrain.FOREST:
                table = self.forest
            case Terrain.MOUNTAINS:
                table = self.mountains
        return table.of(target)


@dataclass(frozen=True, slots=True)
class VisionRules:
    """Vision by terrain (DEC-21): the level a source gives of a neighbouring node and the
    ranges of units shown on the ``range`` level."""

    range_starts: tuple[int, ...]
    """Lower bounds of the unit ranges, ascending, the first one 1 (DEC-21, item 4): ``[1, 3, 6,
    11, 21]`` gives 1..2, 3..5, 6..10, 11..20 and 21+."""
    by_terrain: SightByTerrain

    def range_of(self, units: int) -> tuple[int, int | None]:
        """The range ``(low, high)`` holding ``units >= 1``; ``high`` is ``None`` for the last,
        open range. Depends only on the number (no noise, DEC-21, item 4)."""
        starts = self.range_starts
        i = len(starts) - 1
        while i > 0 and starts[i] > units:
            i -= 1
        high = starts[i + 1] - 1 if i + 1 < len(starts) else None
        return (starts[i], high)


@dataclass(frozen=True, slots=True)
class Ruleset:
    tick_hz: int
    match_ticks: int
    cp: CpRules
    economy: EconomyRules
    stances: StanceRules
    orders: OrderRules
    terrain: TerrainRules
    combat: CombatRules
    capture: CaptureRules
    capacity: CapacityRules
    starvation: StarvationRules
    supply: SupplyRules
    recruit: RecruitRules
    victory: VictoryRules
    city_upgrades: CityUpgradeRules
    warehouse: WarehouseRules
    vision: VisionRules
    factory: FactoryRules
    fort: FortRules
    map_tempo: MapTempoRules | None = dataclasses.field(default=None, metadata=OPTIONAL)
    """Map tempo (DEC-46, #803): the economy periods scaled by the map size. ``Match`` plays
    ``apply_map_tempo(rules, map)``, which has no section. Left out of the hash when absent."""
    group_order: GroupOrderRules | None = dataclasses.field(default=None, metadata=OPTIONAL)
    """The group order (DEC-48): ``GroupMove`` works and ``ReleasePlan`` is disabled. Left out of
    the hash when absent."""

    @property
    def factories_follow(self) -> bool:
        """Every factory follows the stance of its owner (DEC-47, ``stances.factories_follow``)."""
        return self.stances.factories_follow


def _scaled(period: int, pct: int) -> int:
    """``period * 100 // pct`` rounded down, at least 1 (DEC-46)."""
    return max(1, period * 100 // pct)


def _scaled_table(table: StanceTable, pct: int) -> StanceTable:
    return StanceTable(
        economy=_scaled(table.economy, pct),
        balance=_scaled(table.balance, pct),
        war=_scaled(table.war, pct),
    )


def apply_map_tempo(rules: Ruleset, mapdef: MapDef) -> Ruleset:
    """The rules a match on ``mapdef`` plays (DEC-46, #803): without ``[map_tempo]``
    ``rules`` itself; with it a copy without the section whose economy periods are scaled by
    ``map_tempo.pct(len(mapdef.nodes))``: ``factory.built_period_ticks`` (when set) and both
    ``[stances]`` tables, each ``max(1, p * 100 // pct)`` (rounded down). Nothing else changes.
    Pure, integers only."""
    tempo = rules.map_tempo
    if tempo is None:
        return rules
    pct = tempo.pct(len(mapdef.nodes))
    factory = rules.factory
    if factory.built_period_ticks is not None:
        factory = dataclasses.replace(
            factory, built_period_ticks=_scaled(factory.built_period_ticks, pct)
        )
    stances = dataclasses.replace(
        rules.stances,
        cp_period_ticks=_scaled_table(rules.stances.cp_period_ticks, pct),
        capital_period_ticks=_scaled_table(rules.stances.capital_period_ticks, pct),
    )
    return dataclasses.replace(rules, factory=factory, stances=stances, map_tempo=None)


def load_ruleset(path: str | Path) -> Ruleset:
    """Read and check a ruleset TOML file. Raises RulesetError naming the file and the key."""
    path = Path(path)
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise RulesetError(f"{path}: invalid TOML: {exc}") from exc
    try:
        return parse_ruleset(data)
    except RulesetError as exc:
        raise RulesetError(f"{path}: {exc}") from exc


def to_canonical(rules: Ruleset) -> dict[str, object]:
    """The ruleset as plain data shaped exactly like the parsed TOML file.

    ``parse_ruleset(to_canonical(r)) == r``, and for a loaded file the result equals
    ``tomllib.loads(text)``.
    """
    return cast(dict[str, object], _plain(rules))


def _plain(value: object) -> object:
    if isinstance(value, StrEnum):
        return value.value
    if isinstance(value, tuple):
        items: tuple[object, ...] = value  # pyright: ignore[reportUnknownVariableType]
        return [_plain(item) for item in items]
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return {
            f.name: _plain(getattr(value, f.name))
            for f in dataclasses.fields(value)
            if not (f.metadata.get("optional") and getattr(value, f.name) == f.default)
        }
    return value


def ruleset_hash(rules: Ruleset) -> str:
    """blake2b of the canonical JSON of the values; comments and key order do not matter."""
    return digest(to_canonical(rules))


def archive_ruleset(path: str | Path, archive_dir: str | Path) -> Path:
    """Store the ruleset file as ``<archive_dir>/<ruleset_hash>.toml`` and return that path.

    Every ruleset a match was played on is archived this way (AGENTS.md, section 4.5), so a replay
    header's ``ruleset_hash`` always resolves to the rules. Archiving the same rules again is a
    no-op; an existing archive file with other rules is an error.
    """
    path = Path(path)
    rules_hash = ruleset_hash(load_ruleset(path))
    target = Path(archive_dir) / f"{rules_hash}.toml"
    if target.exists():
        if ruleset_hash(load_ruleset(target)) != rules_hash:
            raise RulesetError(f"{target}: archived ruleset does not match its hash")
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(path.read_bytes())
    return target


def parse_ruleset(data: object) -> Ruleset:
    """Build a Ruleset from parsed TOML. Raises RulesetError naming the offending key."""
    root = _Table(
        data,
        "",
        (
            "tick_hz",
            "match_ticks",
            "cp",
            "economy",
            "stances",
            "orders",
            "terrain",
            "combat",
            "capture",
            "capacity",
            "starvation",
            "supply",
            "recruit",
            "victory",
            "city_upgrades",
            "warehouse",
            "vision",
            "factory",
            "fort",
            "map_tempo",
            "group_order",
        ),
    )
    stances = _parse_stances(
        root.table("stances", ("cp_period_ticks", "capital_period_ticks", "factories_follow"))
    )
    economy = root.table("economy", ("start_stance",))
    orders = _parse_orders(root.table("orders", ("plan_ticks_per_bonus", "cost")))
    return Ruleset(
        tick_hz=root.integer("tick_hz", low=1),
        match_ticks=root.integer("match_ticks", low=1),
        cp=_parse_cp(root.table("cp", ("start", "cap", "per_period"))),
        economy=EconomyRules(
            start_stance=Stance(economy.choice("start_stance", tuple(s.value for s in Stance)))
        ),
        stances=stances,
        orders=orders,
        terrain=_parse_terrain(root.table("terrain", ("defense_mod", "speed_pct"))),
        combat=_parse_combat(
            root.table(
                "combat",
                ("round_ticks", "shots_per_round", "regroup_ticks", "engage_ticks", "retreat"),
            )
        ),
        capture=CaptureRules(
            charge_cost=root.table("capture", ("charge_cost",)).integer("charge_cost", low=0)
        ),
        capacity=_parse_capacity(
            root.table("capacity", ("attrition_ticks", "grace_ticks", "by_kind"))
        ),
        starvation=_parse_starvation(
            root.table("starvation", ("grace_ticks", "period_ticks", "charges", "per_units"))
        ),
        supply=_parse_supply(
            root.table("supply", ("dispatch_ticks", "recharge_per_tick", "speed_pct", "leaf_shift"))
        ),
        recruit=_parse_recruit(
            root.table(
                "recruit",
                ("unit_ticks", "queue_max", "refund_started_pct", "rally_point", "rally_cost"),
            ),
            orders.cost.move,
        ),
        victory=_parse_victory(root.table("victory", ("vp_period_ticks", "capital_multiplier"))),
        city_upgrades=_parse_city_upgrades(
            root.table("city_upgrades", ("barracks_ticks", "barracks_charges"))
        ),
        warehouse=_parse_warehouse(root.table("warehouse", ("start_by_kind", "province"))),
        vision=_parse_vision(root.table("vision", ("range_starts", "by_terrain"))),
        factory=_parse_factory(
            root.table("factory", ("built_period_ticks", "cost", "build_ticks", "max")),
            stances.factories_follow,
        ),
        fort=_parse_fort(root.table("fort", ("cost", "build_ticks", "toll_units", "toll_charges"))),
        map_tempo=_parse_map_tempo(
            root.table("map_tempo", ("ref_nodes", "min_pct", "max_pct"))
            if root.has("map_tempo")
            else None
        ),
        group_order=_parse_group_order(
            root.table("group_order", ("max_groups", "rally_pct"))
            if root.has("group_order")
            else None
        ),
    )


def _parse_group_order(t: "_Table | None") -> GroupOrderRules | None:
    if t is None:
        return None
    return GroupOrderRules(
        max_groups=t.integer("max_groups", low=1, high=MAX_GROUP_ORDER),
        rally_pct=t.integer("rally_pct", low=0, high=100),
    )


def _parse_map_tempo(t: "_Table | None") -> MapTempoRules | None:
    if t is None:
        return None
    min_pct = t.integer("min_pct", low=1)
    return MapTempoRules(
        ref_nodes=t.integer("ref_nodes", low=1),
        min_pct=min_pct,
        max_pct=t.integer("max_pct", low=min_pct),
    )


def _parse_cp(t: "_Table") -> CpRules:
    cap = t.integer("cap", low=0)
    return CpRules(
        start=t.integer("start", low=0, high=cap),
        cap=cap,
        per_period=t.integer("per_period", low=0),
    )


def _parse_stances(t: "_Table") -> StanceRules:
    def periods(key: str) -> StanceTable:
        table = t.table(key, tuple(s.value for s in Stance))
        return StanceTable(
            economy=table.integer("economy", low=1),
            balance=table.integer("balance", low=1),
            war=table.integer("war", low=1),
        )

    return StanceRules(
        cp_period_ticks=periods("cp_period_ticks"),
        capital_period_ticks=periods("capital_period_ticks"),
        factories_follow=t.boolean("factories_follow") if t.has("factories_follow") else False,
    )


def _parse_factory(t: "_Table", factories_follow: bool) -> FactoryRules:
    built: int | None = None
    if not factories_follow:
        built = t.integer("built_period_ticks", low=1)
    elif t.has("built_period_ticks"):
        raise RulesetError(
            "factory.built_period_ticks: not allowed with stances.factories_follow (DEC-47)"
        )
    return FactoryRules(
        cost=t.integer("cost", low=0),
        build_ticks=t.integer("build_ticks", low=1),
        max=t.integer("max", low=1),
        built_period_ticks=built,
    )


def _parse_fort(t: "_Table") -> FortRules:
    return FortRules(
        cost=t.integer("cost", low=0),
        build_ticks=t.integer("build_ticks", low=1),
        toll_units=t.integer("toll_units", low=1),
        toll_charges=t.integer("toll_charges", low=0),
    )


def _parse_orders(t: "_Table") -> OrderRules:
    names = tuple(f.name for f in dataclasses.fields(OrderCosts))
    cost = t.table("cost", names)
    return OrderRules(
        plan_ticks_per_bonus=t.integer("plan_ticks_per_bonus", low=1),
        cost=OrderCosts(**{name: cost.integer(name, low=0) for name in names}),
    )


def _parse_terrain(t: "_Table") -> TerrainRules:
    keys = tuple(terrain.value for terrain in Terrain)
    mod = t.table("defense_mod", keys)
    speed = t.table("speed_pct", keys)
    return TerrainRules(
        defense_mod=TerrainTable(
            plains=mod.integer("plains"),
            forest=mod.integer("forest"),
            mountains=mod.integer("mountains"),
        ),
        speed_pct=TerrainTable(
            plains=speed.integer("plains", low=1),
            forest=speed.integer("forest", low=1),
            mountains=speed.integer("mountains", low=1),
        ),
    )


def _parse_combat(t: "_Table") -> CombatRules:
    return CombatRules(
        round_ticks=t.integer("round_ticks", low=1),
        shots_per_round=t.integer("shots_per_round", low=1),
        regroup_ticks=t.integer("regroup_ticks", low=0),
        engage_ticks=t.integer("engage_ticks", low=0),
        retreat=(
            Retreat(t.choice("retreat", tuple(r.value for r in Retreat)))
            if t.has("retreat")
            else Retreat.ROUND
        ),
    )


def _parse_capacity(t: "_Table") -> CapacityRules:
    kinds = t.table("by_kind", tuple(k.value for k in NodeKind))
    return CapacityRules(
        attrition_ticks=t.integer("attrition_ticks", low=1),
        grace_ticks=t.integer("grace_ticks", low=0),
        by_kind=KindTable(**{k.value: kinds.integer(k.value, low=0) for k in NodeKind}),
    )


def _parse_starvation(t: "_Table") -> StarvationRules:
    return StarvationRules(
        grace_ticks=t.integer("grace_ticks", low=0),
        period_ticks=t.integer("period_ticks", low=1),
        charges=t.integer("charges", low=0),
        per_units=t.integer("per_units", low=1),
    )


def _parse_supply(t: "_Table") -> SupplyRules:
    return SupplyRules(
        dispatch_ticks=t.integer("dispatch_ticks", low=1),
        recharge_per_tick=t.integer("recharge_per_tick", low=0),
        speed_pct=t.integer("speed_pct", low=1),
        leaf_shift=t.boolean("leaf_shift") if t.has("leaf_shift") else True,
    )


def _parse_recruit(t: "_Table", move_cost: int) -> RecruitRules:
    rally = t.boolean("rally_point") if t.has("rally_point") else False
    cost = 0
    if rally:
        cost = t.integer("rally_cost", low=0, high=move_cost)
    elif t.has("rally_cost"):
        raise RulesetError("recruit.rally_cost: only with recruit.rally_point = true (DEC-48)")
    return RecruitRules(
        unit_ticks=t.integer("unit_ticks", low=1),
        queue_max=t.integer("queue_max", low=1),
        refund_started_pct=t.integer("refund_started_pct", low=0, high=100),
        rally_point=rally,
        rally_cost=cost,
    )


def _parse_city_upgrades(t: "_Table") -> CityUpgradeRules:
    return CityUpgradeRules(
        barracks_ticks=t.integer("barracks_ticks", low=1),
        barracks_charges=t.integer("barracks_charges", low=0),
    )


_CITY_KINDS: Final = tuple(k.value for k in NodeKind if k is not NodeKind.PROVINCE)


def _parse_warehouse(t: "_Table") -> WarehouseRules:
    kinds = t.table("start_by_kind", _CITY_KINDS)
    return WarehouseRules(
        start_by_kind=CityKindTable(**{k: kinds.integer(k, low=0) for k in _CITY_KINDS}),
        province=t.integer("province", low=0),
    )


def _parse_vision(t: "_Table") -> VisionRules:
    starts = t.integers("range_starts", low=1)
    if not starts or starts[0] != 1:
        raise RulesetError("vision.range_starts: the first range must start at 1")
    if any(b <= a for a, b in pairwise(starts)):
        raise RulesetError("vision.range_starts: expected strictly ascending integers")
    keys = tuple(terrain.value for terrain in Terrain)
    sights = tuple(s.value for s in Sight)
    by = t.table("by_terrain", keys)

    def row(source: str) -> SightTable:
        r = by.table(source, keys)
        return SightTable(**{k: Sight(r.choice(k, sights)) for k in keys})

    return VisionRules(
        range_starts=starts,
        by_terrain=SightByTerrain(**{k: row(k) for k in keys}),
    )


def _parse_victory(t: "_Table") -> VictoryRules:
    return VictoryRules(
        vp_period_ticks=t.integer("vp_period_ticks", low=1),
        capital_multiplier=t.integer("capital_multiplier", low=0),
    )


class _Table:
    """A TOML table with a fixed key list; errors name the dotted key."""

    __slots__ = ("_data", "_where")

    def __init__(self, data: object, where: str, keys: tuple[str, ...]) -> None:
        if not isinstance(data, dict):
            raise RulesetError(f"{where or 'ruleset'}: expected a table, got {data!r}")
        raw: dict[str, object] = data  # pyright: ignore[reportUnknownVariableType]
        self._data = raw
        self._where = where
        # Unknown keys first: a typo is reported by its own name, not as the missing correct key.
        for key in sorted(raw):
            if key not in keys:
                raise RulesetError(f"{self._path(key)}: unknown key, expected one of {list(keys)}")

    def _path(self, key: str) -> str:
        return f"{self._where}.{key}" if self._where else key

    def has(self, key: str) -> bool:
        return key in self._data

    def _get(self, key: str) -> object:
        if key not in self._data:
            raise RulesetError(f"{self._path(key)}: missing key")
        return self._data[key]

    def integer(self, key: str, low: int | None = None, high: int | None = None) -> int:
        value = self._get(key)
        # bool is a subclass of int in Python; TOML true/false is not a number here.
        if isinstance(value, bool) or not isinstance(value, int):
            raise RulesetError(f"{self._path(key)}: expected an integer, got {value!r}")
        if (low is not None and value < low) or (high is not None and value > high):
            bounds = f"[{'' if low is None else low}..{'' if high is None else high}]"
            raise RulesetError(f"{self._path(key)}: {value} is out of range {bounds}")
        return value

    def integers(self, key: str, low: int | None = None) -> tuple[int, ...]:
        value = self._get(key)
        if not isinstance(value, list | tuple):
            raise RulesetError(f"{self._path(key)}: expected a list of integers, got {value!r}")
        items: list[object] = list(value)  # pyright: ignore[reportUnknownArgumentType]
        result: list[int] = []
        for i, item in enumerate(items):
            if isinstance(item, bool) or not isinstance(item, int):
                raise RulesetError(f"{self._path(key)}[{i}]: expected an integer, got {item!r}")
            if low is not None and item < low:
                raise RulesetError(f"{self._path(key)}[{i}]: {item} is out of range [{low}..]")
            result.append(item)
        return tuple(result)

    def boolean(self, key: str) -> bool:
        value = self._get(key)
        if not isinstance(value, bool):
            raise RulesetError(f"{self._path(key)}: expected true or false, got {value!r}")
        return value

    def choice(self, key: str, options: tuple[str, ...]) -> str:
        value = self._get(key)
        if not isinstance(value, str) or value not in options:
            raise RulesetError(f"{self._path(key)}: expected one of {list(options)}, got {value!r}")
        return value

    def table(self, key: str, keys: tuple[str, ...]) -> "_Table":
        return _Table(self._get(key), self._path(key), keys)
