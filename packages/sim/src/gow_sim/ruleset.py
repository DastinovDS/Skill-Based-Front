"""Ruleset: every number and flag of the game rules as data (SIM-01), and its TOML loader.

Systems read rule numbers only from ``Ruleset`` (AGENTS.md, section 4.1, rule 7). The field names
equal the keys of ``rulesets/*.toml``; the meaning of each key is commented in
``rulesets/mvp-0.toml``. Units: durations in ticks, CP in hundredths, percentages as integers.

File I/O is allowed in this module (AGENTS.md, section 4.1, rule 1).
"""

import dataclasses
import tomllib
from dataclasses import dataclass
from enum import StrEnum
from itertools import pairwise
from pathlib import Path
from typing import Final, cast

from gow_sim.canonical import digest
from gow_sim.maps import MAX_LEVEL, NodeKind, Terrain


class RulesetError(ValueError):
    """The ruleset file is malformed: unknown or missing key, wrong type or value out of range."""


class Stance(StrEnum):
    """CP stance: the share of CP regeneration that goes into charges (DEC-02)."""

    ECONOMY = "economy"
    BALANCE = "balance"
    WAR = "war"


class EconomyModel(StrEnum):
    """``economy.model`` (DEC-41, #642): ``v1`` is the economy of stances, front markers and
    donors; ``v2`` the economy of factories and drawn supply lines."""

    V1 = "v1"
    V2 = "v2"


OPTIONAL: Final = {"optional": True}
"""Metadata of a field whose key may be left out of the file (the economy v2 keys, DEC-41): at its
default it is left out of ``to_canonical`` too, so the hash of a v1 ruleset stays as it was."""


class RecruitLocation(StrEnum):
    """Where ``Recruit(node)`` is allowed (DEC-01)."""

    ANY_CITY = "any_city"
    CAPITAL = "capital"


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
class LevelTable:
    """One integer per upgraded road level ``2..MAX_LEVEL``: ``values[level - 2]`` (DEC-22)."""

    values: tuple[int, ...]

    def of(self, width: int) -> int:
        if not 2 <= width <= len(self.values) + 1:
            raise ValueError(f"road level {width} is out of range 2..{len(self.values) + 1}")
        return self.values[width - 2]


@dataclass(frozen=True, slots=True)
class FullLevelTable:
    """One integer per road level ``1..MAX_LEVEL``: ``values[level - 1]`` (DEC-28, item 7)."""

    values: tuple[int, ...]

    def of(self, width: int) -> int:
        if not 1 <= width <= len(self.values):
            raise ValueError(f"road level {width} is out of range 1..{len(self.values)}")
        return self.values[width - 1]


@dataclass(frozen=True, slots=True)
class CpRules:
    start: int
    cap: int
    per_period: int
    period_ticks: int


@dataclass(frozen=True, slots=True)
class EconomyRules:
    charges_per_cp: int
    start_stance: Stance
    stance_to_charges_pct: StanceTable
    model: EconomyModel = dataclasses.field(default=EconomyModel.V1, metadata=OPTIONAL)
    """DEC-41: under ``v2`` the stance keys above have no effect (item 1)."""
    start_stock_capital_only: bool = dataclasses.field(default=False, metadata=OPTIONAL)
    """DEC-41, item 9 (``v2`` only): the warehouses of the cities other than the capital start
    empty; the capital keeps the start stock of the map."""


@dataclass(frozen=True, slots=True)
class OrderCosts:
    """Command costs in hundredths of CP."""

    move: int
    planned_move: int
    cancel: int
    split: int
    merge: int
    attack: int
    defense: int
    build: int
    recruit: int
    stance: int
    front: int
    """``SetFront``: moving a front marker (DEC-28, item 2)."""
    rear_min: int
    """``SetRearMin``: the rear minimum of the player (DEC-28, item 3)."""
    transfer: int
    """``Transfer``: one-off shipment of charges between own cities (DEC-18, item 6)."""
    barracks: int
    """``BuildBarracks``: the barracks of a city (DEC-26, item 2; with ``city_upgrades``)."""
    warehouse: int
    """``UpgradeWarehouse``: one warehouse level of a city (DEC-26, item 3)."""


@dataclass(frozen=True, slots=True)
class OrderRules:
    planned_delay_ticks: int
    planned_bonus_per_edge: int
    """Virtual shots of a planned order per edge of its path (DEC-29); see ``planned_bonus``."""
    defense_ticks_per_bonus: int
    """The "Defense" mode gains one virtual shot per this many ticks (DEC-30); see
    ``defense_bonus``."""
    stance_cooldown_ticks: int
    cost: OrderCosts

    def planned_bonus(self, edges: int, charged: int) -> int:
        """The bonus of a planned order (DEC-29): ``edges`` of the path chosen at the command
        times ``planned_bonus_per_edge``, at most the ``charged`` units of the group in the tick
        it departs; a group without charged units gets 0."""
        return min(edges * self.planned_bonus_per_edge, charged)

    def defense_bonus(self, ticks: int, charged: int) -> int:
        """The bonus of "Defense" (DEC-30): one per ``defense_ticks_per_bonus`` of the ``ticks``
        the group has stood in the mode (rounded down, ``ticks >= 0``), at most the ``charged``
        units of the group when the fight begins."""
        return min(ticks // self.defense_ticks_per_bonus, charged)


@dataclass(frozen=True, slots=True)
class TerrainRules:
    defense_mod: TerrainTable
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
    """Starvation of a cut-off city (DEC-19): ``charges`` per started ``per_units`` standing units
    every ``period_ticks``, the first time ``grace_ticks`` after the cut."""

    grace_ticks: int
    period_ticks: int
    charges: int
    per_units: int


@dataclass(frozen=True, slots=True)
class SupplyRules:
    dispatch_ticks: int
    rear_min_default: int
    """The rear minimum every player starts with (DEC-28, item 3)."""
    rear_min_max: int
    """The largest rear minimum ``SetRearMin`` accepts (DEC-28, item 3)."""
    recharge_per_tick: int
    base_speed_pct: int
    """Packet speed on a level 1 road (DEC-22, item 4)."""
    fast_speed_pct: LevelTable
    """Packet speed on an upgraded road by its level ``2..MAX_LEVEL`` (DEC-26, item 7)."""
    amount_by_level: FullLevelTable
    """Charges per road and dispatch period by the road level ``1..MAX_LEVEL`` (DEC-28, item 7)."""
    front_markers: int
    """Front markers of a player (DEC-28, item 2)."""


@dataclass(frozen=True, slots=True)
class RoadRules:
    """Unit speed on an upgraded road (DEC-28, item 7): ``speed_pct`` by the level
    ``2..MAX_LEVEL`` multiplies the terrain speed; level 1 is 100."""

    speed_pct: LevelTable


@dataclass(frozen=True, slots=True)
class BuildRules:
    """Road upgrades (DEC-28, item 7): one level per command, paid with ``orders.cost.build``."""

    ticks_per_level: int


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
    location: RecruitLocation


@dataclass(frozen=True, slots=True)
class CityUpgradeRules:
    """City development (DEC-26): the barracks and a warehouse apart from the unit capacity.

    ``enabled`` is the flag of the ruleset; the other numbers apply only when it is ``True``.
    """

    enabled: bool
    barracks_ticks: int
    """Ticks to build the barracks (item 2)."""
    warehouse_ticks: int
    """Ticks to raise the warehouse by one level (item 3)."""
    barracks_charges: int = dataclasses.field(default=0, metadata=OPTIONAL)
    """DEC-41, item 7 (``v2`` only): the barracks costs this many charges instead of CP."""
    warehouse_charges: int = dataclasses.field(default=0, metadata=OPTIONAL)
    """DEC-41, item 7 (``v2`` only): every warehouse level costs this many charges instead of
    CP."""


@dataclass(frozen=True, slots=True)
class WarehouseRules:
    """Warehouse capacity of a city with ``city_upgrades`` (DEC-26, item 2):
    ``start_by_kind[kind] + level * gain_per_level``, ``level`` in ``0..max_level``."""

    gain_per_level: int
    max_level: int
    start_by_kind: CityKindTable
    province: int = dataclasses.field(default=0, metadata=OPTIONAL)
    """DEC-41, item 13 (``v2`` only): the warehouse of a province, always this capacity."""


@dataclass(frozen=True, slots=True)
class FactoryRules:
    """Supply factories (DEC-41, item 2; ``economy.model = "v2"`` only): a factory city makes one
    charge per period into its own warehouse."""

    capital_period_ticks: int
    """The own capital, the main factory from the start."""
    built_period_ticks: int
    """Every other factory: a built one or a captured one (a captured capital too)."""
    cost: int
    """Charges ``BuildFactory`` pays (the progressive payment of DEC-41, item 7)."""
    build_ticks: int
    """Ticks from the full payment of ``BuildFactory`` to the factory."""
    max: int
    """Factories of a player at most, the capital and the builds under way included."""


@dataclass(frozen=True, slots=True)
class BunkerRules:
    """The bunker (DEC-41, item 12; code name ``fort``; ``economy.model = "v2"`` only): a
    building of a city or a province that adds virtual shots to the node's defender."""

    cost: int
    """Charges ``BuildBunker`` pays (progressive payment, item 7)."""
    build_ticks: int
    """Ticks from the full payment to the bunker."""
    shots: int
    """Virtual shots of the node's defender in every fight there, if it has a charged unit."""


@dataclass(frozen=True, slots=True)
class LineRules:
    """Drawn supply lines (DEC-41, item 3; ``economy.model = "v2"`` only)."""

    max_out: int
    """Lines that start at one node at most (L4)."""


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
    orders: OrderRules
    terrain: TerrainRules
    combat: CombatRules
    capture: CaptureRules
    capacity: CapacityRules
    starvation: StarvationRules
    supply: SupplyRules
    road: RoadRules
    build: BuildRules
    recruit: RecruitRules
    victory: VictoryRules
    city_upgrades: CityUpgradeRules
    warehouse: WarehouseRules
    vision: VisionRules
    factory: FactoryRules | None = dataclasses.field(default=None, metadata=OPTIONAL)
    """Set exactly with ``economy.model = "v2"`` (DEC-41)."""
    lines: LineRules | None = dataclasses.field(default=None, metadata=OPTIONAL)
    """Set exactly with ``economy.model = "v2"`` (DEC-41)."""
    bunker: BunkerRules | None = dataclasses.field(default=None, metadata=OPTIONAL)
    """Set exactly with ``economy.model = "v2"`` (DEC-41, item 12)."""

    @property
    def v2(self) -> bool:
        """The economy of DEC-41 (``economy.model = "v2"``)."""
        return self.economy.model is EconomyModel.V2

    def factory_rules(self) -> FactoryRules:
        """``factory`` of a v2 ruleset; an error under v1."""
        if self.factory is None:
            raise ValueError("factory rules exist only with economy.model = 'v2'")
        return self.factory

    def line_rules(self) -> LineRules:
        """``lines`` of a v2 ruleset; an error under v1."""
        if self.lines is None:
            raise ValueError("line rules exist only with economy.model = 'v2'")
        return self.lines

    def bunker_rules(self) -> BunkerRules:
        """``bunker`` of a v2 ruleset; an error under v1."""
        if self.bunker is None:
            raise ValueError("bunker rules exist only with economy.model = 'v2'")
        return self.bunker


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
    if isinstance(value, LevelTable):
        return {str(width): v for width, v in enumerate(value.values, start=2)}
    if isinstance(value, FullLevelTable):
        return {str(width): v for width, v in enumerate(value.values, start=1)}
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


_LEVEL_KEYS: Final = tuple(str(width) for width in range(2, MAX_LEVEL + 1))
_ALL_LEVEL_KEYS: Final = tuple(str(width) for width in range(1, MAX_LEVEL + 1))


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
            "orders",
            "terrain",
            "combat",
            "capture",
            "capacity",
            "starvation",
            "supply",
            "road",
            "build",
            "recruit",
            "victory",
            "city_upgrades",
            "warehouse",
            "vision",
            "factory",
            "lines",
            "bunker",
        ),
    )
    economy = _parse_economy(
        root.table(
            "economy",
            (
                "charges_per_cp",
                "start_stance",
                "stance_to_charges_pct",
                "model",
                "start_stock_capital_only",
            ),
        )
    )
    v2 = economy.model is EconomyModel.V2
    return Ruleset(
        tick_hz=root.integer("tick_hz", low=1),
        match_ticks=root.integer("match_ticks", low=1),
        cp=_parse_cp(root.table("cp", ("start", "cap", "per_period", "period_ticks"))),
        economy=economy,
        orders=_parse_orders(
            root.table(
                "orders",
                (
                    "planned_delay_ticks",
                    "planned_bonus_per_edge",
                    "defense_ticks_per_bonus",
                    "stance_cooldown_ticks",
                    "cost",
                ),
            )
        ),
        terrain=_parse_terrain(root.table("terrain", ("defense_mod", "speed_pct"))),
        combat=_parse_combat(
            root.table(
                "combat", ("round_ticks", "shots_per_round", "regroup_ticks", "engage_ticks")
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
            root.table(
                "supply",
                (
                    "dispatch_ticks",
                    "rear_min_default",
                    "rear_min_max",
                    "recharge_per_tick",
                    "base_speed_pct",
                    "fast_speed_pct",
                    "amount_by_level",
                    "front_markers",
                ),
            )
        ),
        road=_parse_road(root.table("road", ("speed_pct",))),
        build=_parse_build(root.table("build", ("ticks_per_level",))),
        recruit=_parse_recruit(
            root.table("recruit", ("unit_ticks", "queue_max", "refund_started_pct", "location"))
        ),
        victory=_parse_victory(root.table("victory", ("vp_period_ticks", "capital_multiplier"))),
        city_upgrades=_parse_city_upgrades(
            root.table(
                "city_upgrades",
                (
                    "enabled",
                    "barracks_ticks",
                    "warehouse_ticks",
                    "barracks_charges",
                    "warehouse_charges",
                ),
            ),
            v2,
        ),
        warehouse=_parse_warehouse(
            root.table("warehouse", ("gain_per_level", "max_level", "start_by_kind", "province")),
            v2,
        ),
        vision=_parse_vision(root.table("vision", ("range_starts", "by_terrain"))),
        factory=_parse_factory(
            root.v2_table(
                "factory",
                v2,
                ("capital_period_ticks", "built_period_ticks", "cost", "build_ticks", "max"),
            )
        ),
        lines=_parse_lines(root.v2_table("lines", v2, ("max_out",))),
        bunker=_parse_bunker(root.v2_table("bunker", v2, ("cost", "build_ticks", "shots"))),
    )


def _parse_cp(t: "_Table") -> CpRules:
    cap = t.integer("cap", low=0)
    return CpRules(
        start=t.integer("start", low=0, high=cap),
        cap=cap,
        per_period=t.integer("per_period", low=0),
        period_ticks=t.integer("period_ticks", low=1),
    )


def _parse_economy(t: "_Table") -> EconomyRules:
    pct = t.table("stance_to_charges_pct", tuple(s.value for s in Stance))
    model = EconomyModel.V1
    if t.has("model"):
        model = EconomyModel(t.choice("model", tuple(m.value for m in EconomyModel)))
    v2 = model is EconomyModel.V2
    start_stock_capital_only = False
    if t.has_v2("start_stock_capital_only", v2):
        start_stock_capital_only = t.boolean("start_stock_capital_only")
    return EconomyRules(
        charges_per_cp=t.integer("charges_per_cp", low=0),
        start_stance=Stance(t.choice("start_stance", tuple(s.value for s in Stance))),
        stance_to_charges_pct=StanceTable(
            economy=pct.integer("economy", low=0, high=100),
            balance=pct.integer("balance", low=0, high=100),
            war=pct.integer("war", low=0, high=100),
        ),
        model=model,
        start_stock_capital_only=start_stock_capital_only,
    )


def _parse_factory(t: "_Table | None") -> FactoryRules | None:
    if t is None:
        return None
    return FactoryRules(
        capital_period_ticks=t.integer("capital_period_ticks", low=1),
        built_period_ticks=t.integer("built_period_ticks", low=1),
        cost=t.integer("cost", low=0),
        build_ticks=t.integer("build_ticks", low=1),
        max=t.integer("max", low=1),
    )


def _parse_lines(t: "_Table | None") -> LineRules | None:
    if t is None:
        return None
    return LineRules(max_out=t.integer("max_out", low=1))


def _parse_bunker(t: "_Table | None") -> BunkerRules | None:
    if t is None:
        return None
    return BunkerRules(
        cost=t.integer("cost", low=0),
        build_ticks=t.integer("build_ticks", low=1),
        shots=t.integer("shots", low=0),
    )


def _parse_orders(t: "_Table") -> OrderRules:
    names = tuple(f.name for f in dataclasses.fields(OrderCosts))
    cost = t.table("cost", names)
    return OrderRules(
        planned_delay_ticks=t.integer("planned_delay_ticks", low=0),
        planned_bonus_per_edge=t.integer("planned_bonus_per_edge", low=0),
        defense_ticks_per_bonus=t.integer("defense_ticks_per_bonus", low=1),
        stance_cooldown_ticks=t.integer("stance_cooldown_ticks", low=0),
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
    speed = t.table("fast_speed_pct", _LEVEL_KEYS)
    amount = t.table("amount_by_level", _ALL_LEVEL_KEYS)
    rear_min_max = t.integer("rear_min_max", low=0)
    return SupplyRules(
        dispatch_ticks=t.integer("dispatch_ticks", low=1),
        rear_min_default=t.integer("rear_min_default", low=0, high=rear_min_max),
        rear_min_max=rear_min_max,
        recharge_per_tick=t.integer("recharge_per_tick", low=0),
        base_speed_pct=t.integer("base_speed_pct", low=1),
        fast_speed_pct=LevelTable(tuple(speed.integer(key, low=1) for key in _LEVEL_KEYS)),
        amount_by_level=FullLevelTable(
            tuple(amount.integer(key, low=1) for key in _ALL_LEVEL_KEYS)
        ),
        front_markers=t.integer("front_markers", low=0),
    )


def _parse_road(t: "_Table") -> RoadRules:
    speed = t.table("speed_pct", _LEVEL_KEYS)
    return RoadRules(speed_pct=LevelTable(tuple(speed.integer(key, low=1) for key in _LEVEL_KEYS)))


def _parse_build(t: "_Table") -> BuildRules:
    return BuildRules(ticks_per_level=t.integer("ticks_per_level", low=1))


def _parse_recruit(t: "_Table") -> RecruitRules:
    return RecruitRules(
        unit_ticks=t.integer("unit_ticks", low=1),
        queue_max=t.integer("queue_max", low=1),
        refund_started_pct=t.integer("refund_started_pct", low=0, high=100),
        location=RecruitLocation(t.choice("location", tuple(loc.value for loc in RecruitLocation))),
    )


def _parse_city_upgrades(t: "_Table", v2: bool) -> CityUpgradeRules:
    barracks_charges = warehouse_charges = 0
    if t.has_v2("barracks_charges", v2):
        barracks_charges = t.integer("barracks_charges", low=0)
    if t.has_v2("warehouse_charges", v2):
        warehouse_charges = t.integer("warehouse_charges", low=0)
    return CityUpgradeRules(
        enabled=t.boolean("enabled"),
        barracks_ticks=t.integer("barracks_ticks", low=1),
        warehouse_ticks=t.integer("warehouse_ticks", low=1),
        barracks_charges=barracks_charges,
        warehouse_charges=warehouse_charges,
    )


_CITY_KINDS: Final = tuple(k.value for k in NodeKind if k is not NodeKind.PROVINCE)


def _parse_warehouse(t: "_Table", v2: bool) -> WarehouseRules:
    kinds = t.table("start_by_kind", _CITY_KINDS)
    province = t.integer("province", low=0) if t.has_v2("province", v2) else 0
    return WarehouseRules(
        gain_per_level=t.integer("gain_per_level", low=0),
        max_level=t.integer("max_level", low=0),
        start_by_kind=CityKindTable(**{k: kinds.integer(k, low=0) for k in _CITY_KINDS}),
        province=province,
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

    def has_v2(self, key: str, v2: bool) -> bool:
        """Whether the economy v2 key ``key`` (DEC-41) is given: it is required with
        ``economy.model = "v2"`` and not allowed without it."""
        if v2:
            self._get(key)  # missing key: an error
            return True
        if key in self._data:
            raise RulesetError(f"{self._path(key)}: only with economy.model = 'v2'")
        return False

    def v2_table(self, key: str, v2: bool, keys: tuple[str, ...]) -> "_Table | None":
        """The economy v2 table ``key`` (DEC-41), see ``has_v2``; ``None`` without v2."""
        return self.table(key, keys) if self.has_v2(key, v2) else None

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
