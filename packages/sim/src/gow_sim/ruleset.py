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
from pathlib import Path
from typing import Final, cast

from gow_sim.canonical import digest
from gow_sim.maps import MAX_WIDTH, Terrain


class RulesetError(ValueError):
    """The ruleset file is malformed: unknown or missing key, wrong type or value out of range."""


class Stance(StrEnum):
    """CP stance: the share of CP regeneration that goes into charges (DEC-02)."""

    ECONOMY = "economy"
    BALANCE = "balance"
    WAR = "war"


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
class WidthTable:
    """One integer per road width ``1..MAX_WIDTH``: ``values[width - 1]``."""

    values: tuple[int, ...]

    def of(self, width: int) -> int:
        if not 1 <= width <= len(self.values):
            raise ValueError(f"road width {width} is out of range 1..{len(self.values)}")
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
    passive_period_ticks: int
    passive_amount: int
    start_stance: Stance
    stance_to_charges_pct: StanceTable


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


@dataclass(frozen=True, slots=True)
class OrderRules:
    planned_delay_ticks: int
    defense_delay_ticks: int
    planned_bonus: int
    defense_bonus: int
    stance_cooldown_ticks: int
    cost: OrderCosts


@dataclass(frozen=True, slots=True)
class TerrainRules:
    defense_mod: TerrainTable
    entry_speed_pct: TerrainTable


@dataclass(frozen=True, slots=True)
class CapacityRules:
    attrition_ticks: int
    grace_ticks: int
    width_gain_centi: WidthTable


@dataclass(frozen=True, slots=True)
class SupplyRules:
    dispatch_ticks: int
    buffer: int
    recharge_per_tick: int
    packet_speed_pct: WidthTable


@dataclass(frozen=True, slots=True)
class BuildRules:
    ticks_per_level: int


@dataclass(frozen=True, slots=True)
class RecruitRules:
    cooldown_ticks: int
    location: RecruitLocation


@dataclass(frozen=True, slots=True)
class VictoryRules:
    vp_period_ticks: int
    capital_multiplier: int


@dataclass(frozen=True, slots=True)
class Ruleset:
    tick_hz: int
    match_ticks: int
    cp: CpRules
    economy: EconomyRules
    orders: OrderRules
    terrain: TerrainRules
    capacity: CapacityRules
    supply: SupplyRules
    build: BuildRules
    recruit: RecruitRules
    victory: VictoryRules


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
    if isinstance(value, WidthTable):
        return {str(width): v for width, v in enumerate(value.values, start=1)}
    if isinstance(value, StrEnum):
        return value.value
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return {f.name: _plain(getattr(value, f.name)) for f in dataclasses.fields(value)}
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


_WIDTH_KEYS: Final = tuple(str(width) for width in range(1, MAX_WIDTH + 1))


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
            "capacity",
            "supply",
            "build",
            "recruit",
            "victory",
        ),
    )
    return Ruleset(
        tick_hz=root.integer("tick_hz", low=1),
        match_ticks=root.integer("match_ticks", low=1),
        cp=_parse_cp(root.table("cp", ("start", "cap", "per_period", "period_ticks"))),
        economy=_parse_economy(
            root.table(
                "economy",
                (
                    "charges_per_cp",
                    "passive_period_ticks",
                    "passive_amount",
                    "start_stance",
                    "stance_to_charges_pct",
                ),
            )
        ),
        orders=_parse_orders(
            root.table(
                "orders",
                (
                    "planned_delay_ticks",
                    "defense_delay_ticks",
                    "planned_bonus",
                    "defense_bonus",
                    "stance_cooldown_ticks",
                    "cost",
                ),
            )
        ),
        terrain=_parse_terrain(root.table("terrain", ("defense_mod", "entry_speed_pct"))),
        capacity=_parse_capacity(
            root.table("capacity", ("attrition_ticks", "grace_ticks", "width_gain_centi"))
        ),
        supply=_parse_supply(
            root.table(
                "supply", ("dispatch_ticks", "buffer", "recharge_per_tick", "packet_speed_pct")
            )
        ),
        build=BuildRules(
            ticks_per_level=root.table("build", ("ticks_per_level",)).integer(
                "ticks_per_level", low=1
            )
        ),
        recruit=_parse_recruit(root.table("recruit", ("cooldown_ticks", "location"))),
        victory=_parse_victory(root.table("victory", ("vp_period_ticks", "capital_multiplier"))),
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
    return EconomyRules(
        charges_per_cp=t.integer("charges_per_cp", low=0),
        passive_period_ticks=t.integer("passive_period_ticks", low=1),
        passive_amount=t.integer("passive_amount", low=0),
        start_stance=Stance(t.choice("start_stance", tuple(s.value for s in Stance))),
        stance_to_charges_pct=StanceTable(
            economy=pct.integer("economy", low=0, high=100),
            balance=pct.integer("balance", low=0, high=100),
            war=pct.integer("war", low=0, high=100),
        ),
    )


def _parse_orders(t: "_Table") -> OrderRules:
    names = tuple(f.name for f in dataclasses.fields(OrderCosts))
    cost = t.table("cost", names)
    return OrderRules(
        planned_delay_ticks=t.integer("planned_delay_ticks", low=0),
        defense_delay_ticks=t.integer("defense_delay_ticks", low=0),
        planned_bonus=t.integer("planned_bonus", low=0),
        defense_bonus=t.integer("defense_bonus", low=0),
        stance_cooldown_ticks=t.integer("stance_cooldown_ticks", low=0),
        cost=OrderCosts(**{name: cost.integer(name, low=0) for name in names}),
    )


def _parse_terrain(t: "_Table") -> TerrainRules:
    keys = tuple(terrain.value for terrain in Terrain)
    mod = t.table("defense_mod", keys)
    speed = t.table("entry_speed_pct", keys)
    return TerrainRules(
        defense_mod=TerrainTable(
            plains=mod.integer("plains"),
            forest=mod.integer("forest"),
            mountains=mod.integer("mountains"),
        ),
        entry_speed_pct=TerrainTable(
            plains=speed.integer("plains", low=1),
            forest=speed.integer("forest", low=1),
            mountains=speed.integer("mountains", low=1),
        ),
    )


def _parse_capacity(t: "_Table") -> CapacityRules:
    gain = t.table("width_gain_centi", _WIDTH_KEYS)
    return CapacityRules(
        attrition_ticks=t.integer("attrition_ticks", low=1),
        grace_ticks=t.integer("grace_ticks", low=0),
        width_gain_centi=WidthTable(tuple(gain.integer(key, low=0) for key in _WIDTH_KEYS)),
    )


def _parse_supply(t: "_Table") -> SupplyRules:
    speed = t.table("packet_speed_pct", _WIDTH_KEYS)
    return SupplyRules(
        dispatch_ticks=t.integer("dispatch_ticks", low=1),
        buffer=t.integer("buffer", low=0),
        recharge_per_tick=t.integer("recharge_per_tick", low=0),
        packet_speed_pct=WidthTable(tuple(speed.integer(key, low=1) for key in _WIDTH_KEYS)),
    )


def _parse_recruit(t: "_Table") -> RecruitRules:
    return RecruitRules(
        cooldown_ticks=t.integer("cooldown_ticks", low=0),
        location=RecruitLocation(t.choice("location", tuple(loc.value for loc in RecruitLocation))),
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

    def choice(self, key: str, options: tuple[str, ...]) -> str:
        value = self._get(key)
        if not isinstance(value, str) or value not in options:
            raise RulesetError(f"{self._path(key)}: expected one of {list(options)}, got {value!r}")
        return value

    def table(self, key: str, keys: tuple[str, ...]) -> "_Table":
        return _Table(self._get(key), self._path(key), keys)
