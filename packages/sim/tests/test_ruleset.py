"""Ruleset (SIM-01): mvp-0 values, strict loading, stable hash, archive.

Expected values come from the SIM-01 (#17) table "Values and notes" and the DEC blocks of
docs/design/mechanics.md, not from the loader output.
"""

import copy
import os
import subprocess  # noqa: TID251 (fresh process with PYTHONHASHSEED)
import sys
import tomllib
from pathlib import Path
from typing import Any

import pytest

from gow_sim.canonical import canonical_json
from gow_sim.maps import NodeKind, Terrain
from gow_sim.ruleset import (
    RecruitLocation,
    Ruleset,
    RulesetError,
    Stance,
    archive_ruleset,
    load_ruleset,
    parse_ruleset,
    ruleset_hash,
    to_canonical,
)

RULESETS_DIR = Path(__file__).resolve().parents[3] / "rulesets"
MVP0 = RULESETS_DIR / "mvp-0.toml"
MVP1 = RULESETS_DIR / "mvp-1.toml"
TEST_SHORT = RULESETS_DIR / "test-short.toml"


def _raw(path: Path = MVP0) -> dict[str, Any]:
    return tomllib.loads(path.read_text(encoding="utf-8"))


def _leaves(data: dict[str, Any], prefix: tuple[str, ...] = ()) -> list[tuple[str, ...]]:
    paths: list[tuple[str, ...]] = []
    for key, value in data.items():
        if isinstance(value, dict):
            paths.extend(_leaves(value, (*prefix, key)))  # pyright: ignore[reportUnknownArgumentType]
        else:
            paths.append((*prefix, key))
    return paths


def _set(data: dict[str, Any], path: tuple[str, ...], value: object) -> None:
    for key in path[:-1]:
        data = data[key]
    data[path[-1]] = value


def _get(data: dict[str, Any], path: tuple[str, ...]) -> object:
    for key in path[:-1]:
        data = data[key]
    return data[path[-1]]


@pytest.fixture(scope="module")
def mvp0() -> Ruleset:
    return load_ruleset(MVP0)


def test_mvp0_clock_and_cp(mvp0: Ruleset) -> None:
    assert (mvp0.tick_hz, mvp0.match_ticks) == (10, 9000)  # 15 minutes (DEC-22)
    cp = mvp0.cp
    assert (cp.start, cp.cap, cp.per_period, cp.period_ticks) == (300, 500, 100, 50)


def test_mvp0_economy(mvp0: Ruleset) -> None:
    economy = mvp0.economy
    pct = economy.stance_to_charges_pct
    assert (pct.of(Stance.ECONOMY), pct.of(Stance.BALANCE), pct.of(Stance.WAR)) == (75, 50, 25)
    assert economy.charges_per_cp == 2
    # No passive production of the capital (#253): no such keys.
    assert not hasattr(economy, "passive_amount")
    # DEC-09.
    assert economy.start_stance is Stance.BALANCE


def test_mvp0_order_costs(mvp0: Ruleset) -> None:
    cost = mvp0.orders.cost
    assert cost.move == 100
    assert cost.planned_move == 200
    assert cost.split == 0  # free since DEC-20
    assert cost.merge == 0
    assert cost.defense == 200
    assert cost.build == 50  # UpgradeRoad(edge): 0,5 CP per level (DEC-28, item 7)
    assert cost.attack == 0
    assert cost.recruit == 100
    assert cost.cancel == 0  # any order, free since DEC-20
    assert cost.stance == 0
    assert (cost.front, cost.rear_min) == (0, 0)  # markers and the rear minimum: free (DEC-28)
    assert cost.transfer == 0  # Transfer is free (DEC-18, item 6)


def test_mvp0_starvation(mvp0: Ruleset) -> None:
    """DEC-19: 1 charge per started 3 units every 10 s, after a 10 s grace."""
    s = mvp0.starvation
    assert (s.grace_ticks, s.period_ticks, s.charges, s.per_units) == (100, 100, 1, 3)


def test_mvp0_order_timing_and_bonuses(mvp0: Ruleset) -> None:
    orders = mvp0.orders
    assert orders.planned_delay_ticks == 30
    assert (orders.planned_bonus_per_edge, orders.defense_ticks_per_bonus) == (1, 60)  # DEC-29, 30
    assert orders.stance_cooldown_ticks == 100


def test_mvp0_recruit(mvp0: Ruleset) -> None:
    recruit = mvp0.recruit  # DEC-25
    assert (recruit.unit_ticks, recruit.queue_max, recruit.refund_started_pct) == (30, 3, 50)
    assert recruit.location is RecruitLocation.ANY_CITY


def test_mvp0_terrain(mvp0: Ruleset) -> None:
    mod = mvp0.terrain.defense_mod
    assert [mod.of(t) for t in (Terrain.MOUNTAINS, Terrain.FOREST, Terrain.PLAINS)] == [1, 0, -1]
    speed = mvp0.terrain.speed_pct  # by zone (#253)
    assert [speed.of(t) for t in (Terrain.PLAINS, Terrain.FOREST, Terrain.MOUNTAINS)] == [
        125,
        100,
        70,
    ]


def test_mvp0_capacity_supply_build_victory(mvp0: Ruleset) -> None:
    # DEC-22 (#234): capacity by node kind, road speed by level; DEC-26 (#265): no road types,
    # amount 1 on every level, prices 1 / 2.
    by_kind = mvp0.capacity.by_kind
    kinds = (
        NodeKind.CAPITAL,
        NodeKind.CITY_LARGE,
        NodeKind.CITY_MEDIUM,
        NodeKind.CITY_SMALL,
        NodeKind.PROVINCE,
    )
    assert [by_kind.of(k) for k in kinds] == [10, 8, 6, 4, 3]
    assert (mvp0.capacity.attrition_ticks, mvp0.capacity.grace_ticks) == (30, 50)
    supply = mvp0.supply
    assert (supply.dispatch_ticks, supply.recharge_per_tick) == (10, 1)
    assert (supply.rear_min_default, supply.rear_min_max) == (1, 8)  # DEC-28, item 3
    assert supply.base_speed_pct == 100
    assert [supply.fast_speed_pct.of(level) for level in (2, 3)] == [150, 200]
    assert [supply.amount_by_level.of(level) for level in (1, 2, 3)] == [1, 2, 3]  # DEC-28
    assert supply.front_markers == 2  # DEC-28, item 2
    assert [mvp0.road.speed_pct.of(level) for level in (2, 3)] == [115, 130]  # DEC-28, item 7
    assert mvp0.build.ticks_per_level == 150
    assert (mvp0.victory.vp_period_ticks, mvp0.victory.capital_multiplier) == (300, 3)


def test_city_upgrades_of_mvp0_and_mvp1(mvp0: Ruleset) -> None:
    """DEC-26 (#265): the numbers of the barracks and the warehouse; mvp-1 is mvp-0 with the
    flag on (item 1)."""
    cu = mvp0.city_upgrades
    assert (cu.enabled, cu.barracks_ticks, cu.warehouse_ticks) == (False, 100, 100)
    w = mvp0.warehouse
    assert (w.gain_per_level, w.max_level) == (1, 2)
    kinds = (NodeKind.CAPITAL, NodeKind.CITY_LARGE, NodeKind.CITY_MEDIUM, NodeKind.CITY_SMALL)
    assert [w.start_by_kind.of(k) for k in kinds] == [6, 2, 2, 1]
    assert w.start_by_kind.of(NodeKind.PROVINCE) == 0  # no warehouse (DEC-23)
    assert (mvp0.orders.cost.barracks, mvp0.orders.cost.warehouse) == (300, 200)
    expected = _raw()
    expected["city_upgrades"]["enabled"] = True
    assert to_canonical(load_ruleset(MVP1)) == expected


def test_enabled_must_be_a_boolean() -> None:
    data = _raw()
    data["city_upgrades"]["enabled"] = 1
    with pytest.raises(RulesetError, match=r"^city_upgrades.enabled: expected true or false"):
        parse_ruleset(data)


def test_level_table_rejects_unknown_level(mvp0: Ruleset) -> None:
    with pytest.raises(ValueError, match="level 4"):
        mvp0.supply.fast_speed_pct.of(4)
    with pytest.raises(ValueError, match="level 1"):
        mvp0.road.speed_pct.of(1)
    with pytest.raises(ValueError, match="level 0"):
        mvp0.supply.amount_by_level.of(0)
    with pytest.raises(ValueError, match="level 4"):
        mvp0.supply.amount_by_level.of(4)


def test_ruleset_is_frozen(mvp0: Ruleset) -> None:
    with pytest.raises(AttributeError):
        mvp0.tick_hz = 20  # pyright: ignore[reportAttributeAccessIssue]


def test_test_short_is_mvp0_with_a_60_second_match() -> None:
    short = load_ruleset(TEST_SHORT)
    assert short.match_ticks == 600  # 60 s at 10 ticks per second
    assert short.tick_hz == 10
    expected = _raw()
    expected["match_ticks"] = 600
    assert to_canonical(short) == expected


@pytest.mark.parametrize("path", [MVP0, MVP1, TEST_SHORT], ids=lambda p: p.name)
def test_canonical_form_is_the_toml_data(path: Path) -> None:
    rules = load_ruleset(path)
    assert to_canonical(rules) == _raw(path)
    assert parse_ruleset(to_canonical(rules)) == rules


@pytest.mark.parametrize(
    ("path", "typo", "name"),
    [
        ((), "match_tick", "match_tick"),
        (("cp",), "strat", "cp.strat"),
        (("orders", "cost"), "mvoe", "orders.cost.mvoe"),
        (("terrain", "defense_mod"), "hills", "terrain.defense_mod.hills"),
        (("capacity", "by_kind"), "town", "capacity.by_kind.town"),
        (("supply", "fast_speed_pct"), "4", "supply.fast_speed_pct.4"),
        (("warehouse", "start_by_kind"), "province", "warehouse.start_by_kind.province"),
    ],
)
def test_typo_in_key_names_the_key(path: tuple[str, ...], typo: str, name: str) -> None:
    data = _raw()
    table: dict[str, Any] = data
    for key in path:
        table = table[key]
    original = next(iter(table))
    table[typo] = table.pop(original)
    with pytest.raises(RulesetError, match=rf"^{name}: unknown key"):
        parse_ruleset(data)


def test_missing_key_names_the_key() -> None:
    data = _raw()
    del data["supply"]["rear_min_max"]
    with pytest.raises(RulesetError, match=r"^supply\.rear_min_max: missing key"):
        parse_ruleset(data)


def test_file_errors_name_the_file(tmp_path: Path) -> None:
    bad = tmp_path / "bad.toml"
    bad.write_text(MVP0.read_text(encoding="utf-8").replace("cap = 500", "cpa = 500"))
    with pytest.raises(RulesetError, match=r"bad\.toml: cp\.cpa: unknown key"):
        load_ruleset(bad)
    broken = tmp_path / "broken.toml"
    broken.write_text("tick_hz = = 10\n")
    with pytest.raises(RulesetError, match=r"broken\.toml: invalid TOML"):
        load_ruleset(broken)


@pytest.mark.parametrize(
    ("path", "value", "message"),
    [
        (("tick_hz",), 0, "tick_hz: 0 is out of range"),
        (("match_ticks",), 1.5, "match_ticks: expected an integer"),
        (("cp", "start"), 501, "cp.start: 501 is out of range"),  # above cp.cap
        (("cp", "period_ticks"), 0, "cp.period_ticks: 0 is out of range"),
        (("cp", "cap"), True, "cp.cap: expected an integer"),
        (("economy", "stance_to_charges_pct", "war"), 101, "war: 101 is out of range"),
        (("economy", "start_stance"), "panic", "economy.start_stance: expected one of"),
        (("orders", "cost", "move"), -1, "orders.cost.move: -1 is out of range"),
        (("orders", "cost", "split"), "100", "orders.cost.split: expected an integer"),
        (("terrain", "speed_pct", "forest"), 0, "speed_pct.forest: 0 is out"),
        (("capacity", "by_kind", "city_small"), -5, "by_kind.city_small: -5 is out of range"),
        (("supply", "fast_speed_pct", "2"), 0, "fast_speed_pct.2: 0 is out of range"),
        (("supply", "amount_by_level", "1"), 0, r"supply\.amount_by_level\.1: 0 is out"),
        (("supply", "front_markers"), -1, "supply.front_markers: -1 is out of range"),
        (("build", "ticks_per_level"), 0, "build.ticks_per_level: 0 is out of range"),
        (("road", "speed_pct", "2"), 0, r"road\.speed_pct\.2: 0 is out"),
        (("recruit", "location"), "anywhere", "recruit.location: expected one of"),
        (("victory", "vp_period_ticks"), 0, "victory.vp_period_ticks: 0 is out of range"),
        (("cp",), 5, "cp: expected a table"),
    ],
)
def test_bad_values_are_rejected(path: tuple[str, ...], value: object, message: str) -> None:
    data = _raw()
    _set(data, path, value)
    with pytest.raises(RulesetError, match=message):
        parse_ruleset(data)


def test_hash_ignores_comments_and_key_order(tmp_path: Path) -> None:
    text = MVP0.read_text(encoding="utf-8")
    stripped = "\n".join(line.split(" #")[0] for line in text.splitlines() if line[:1] != "#")
    other = tmp_path / "other.toml"
    other.write_text(
        stripped.replace("tick_hz = 10\nmatch_ticks = 7200", "match_ticks = 7200\ntick_hz = 10")
    )
    assert ruleset_hash(load_ruleset(other)) == ruleset_hash(load_ruleset(MVP0))


def test_hash_changes_when_any_value_changes() -> None:
    base = _raw()
    base_hash = ruleset_hash(parse_ruleset(base))
    leaves = _leaves(base)
    # Keys of SIM-01, DEC-16, DEC-22, DEC-18, DEC-19 by hand; #253: -2; DEC-24: +3; DEC-25: +2;
    # DEC-26: +11 (2 costs, 3 city_upgrades, 6 warehouse) - 2 (supply.freight_amount); DEC-28:
    # +4 (supply.rear_min_default, supply.rear_min_max, cost.front, cost.rear_min) - 2
    # (supply.buffer, cost.priority); DEC-30: +1 (orders.defense_ticks_per_bonus) - 2
    # (orders.defense_delay_ticks, orders.defense_bonus); DEC-21: +10 (vision.range_starts and
    # the 9 cells of vision.by_terrain); DEC-37: +1 (combat.engage_ticks).
    assert len(leaves) == 90
    for path in leaves:
        data = copy.deepcopy(base)
        value = _get(data, path)
        if isinstance(value, str):
            changed: object = {
                "balance": "war",
                "any_city": "capital",
                "exact": "range",
                "range": "presence",
                "presence": "exact",
            }[value]
        elif isinstance(value, list):
            starts: list[int] = value  # pyright: ignore[reportUnknownVariableType]
            changed = [*starts, starts[-1] + 1]
        elif isinstance(value, bool):
            changed = not value
        else:
            assert isinstance(value, int)
            # +1 stays in range for every mvp-0 value (cp.start 300 < cp.cap, pct <= 99).
            changed = value + 1
        _set(data, path, changed)
        assert ruleset_hash(parse_ruleset(data)) != base_hash, path


def test_hash_is_the_same_in_fresh_processes() -> None:
    expected = ruleset_hash(load_ruleset(MVP0))
    script = (
        "import sys; from gow_sim.ruleset import load_ruleset, ruleset_hash; "
        "print(ruleset_hash(load_ruleset(sys.argv[1])))"
    )
    for seed in ("0", "1", "4242"):
        env = {**os.environ, "PYTHONHASHSEED": seed}  # noqa: TID251 (fresh process with PYTHONHASHSEED)
        out = subprocess.run(
            [sys.executable, "-c", script, str(MVP0)],
            env=env,
            capture_output=True,
            text=True,
            check=True,
        )
        assert out.stdout.strip() == expected


def test_hash_is_blake2b_of_canonical_json(mvp0: Ruleset) -> None:
    import hashlib

    data = canonical_json(to_canonical(mvp0))
    assert b" " not in data  # compact separators
    assert ruleset_hash(mvp0) == hashlib.blake2b(data, digest_size=16).hexdigest()


def test_archive_stores_file_by_hash(tmp_path: Path) -> None:
    archive = tmp_path / "archive"
    target = archive_ruleset(MVP0, archive)
    rules_hash = ruleset_hash(load_ruleset(MVP0))
    assert target == archive / f"{rules_hash}.toml"
    assert target.read_bytes() == MVP0.read_bytes()
    # Archiving the same rules again is a no-op.
    assert archive_ruleset(MVP0, archive) == target
    assert sorted(p.name for p in archive.iterdir()) == [f"{rules_hash}.toml"]
    # Different rules get a different file.
    short = archive_ruleset(TEST_SHORT, archive)
    assert short != target
    assert load_ruleset(short) == load_ruleset(TEST_SHORT)


def test_archive_detects_a_tampered_file(tmp_path: Path) -> None:
    archive = tmp_path / "archive"
    target = archive_ruleset(MVP0, archive)
    target.write_text(TEST_SHORT.read_text(encoding="utf-8"))
    with pytest.raises(RulesetError, match="does not match its hash"):
        archive_ruleset(MVP0, archive)
