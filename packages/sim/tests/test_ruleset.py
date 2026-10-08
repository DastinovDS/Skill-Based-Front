"""Ruleset (SIM-01): mvp-0 values, strict loading, stable hash, archive.

Expected values come from the SIM-01 (#17) table «Значения и примечания» and the DEC blocks of
docs/design/mechanics.md, not from the loader output.
"""

import copy
import os
import subprocess
import sys
import tomllib
from pathlib import Path
from typing import Any

import pytest

from gow_sim.canonical import canonical_json
from gow_sim.maps import Terrain
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
    assert (mvp0.tick_hz, mvp0.match_ticks) == (10, 7200)  # 12 minutes (DEC-03)
    cp = mvp0.cp
    assert (cp.start, cp.cap, cp.per_period, cp.period_ticks) == (300, 500, 100, 50)


def test_mvp0_economy(mvp0: Ruleset) -> None:
    economy = mvp0.economy
    pct = economy.stance_to_charges_pct
    assert (pct.of(Stance.ECONOMY), pct.of(Stance.BALANCE), pct.of(Stance.WAR)) == (75, 50, 25)
    assert (economy.charges_per_cp, economy.passive_period_ticks, economy.passive_amount) == (
        2,
        50,
        1,
    )
    # Default of the open question #104.
    assert economy.start_stance is Stance.BALANCE


def test_mvp0_order_costs(mvp0: Ruleset) -> None:
    cost = mvp0.orders.cost
    assert cost.move == 100
    assert cost.planned_move == 200
    assert cost.split == 100
    assert cost.merge == 100
    assert cost.defense == 200
    assert cost.build == 100  # «Строительство» / UpgradeRoad
    assert cost.attack == 0
    assert cost.recruit == 100
    assert cost.cancel == 100
    assert cost.stance == 0


def test_mvp0_order_timing_and_bonuses(mvp0: Ruleset) -> None:
    orders = mvp0.orders
    assert (orders.planned_delay_ticks, orders.defense_delay_ticks) == (30, 30)
    assert (orders.planned_bonus, orders.defense_bonus) == (2, 2)
    assert orders.stance_cooldown_ticks == 100


def test_mvp0_recruit(mvp0: Ruleset) -> None:
    assert mvp0.recruit.cooldown_ticks == 20
    assert mvp0.recruit.location is RecruitLocation.ANY_CITY


def test_mvp0_terrain(mvp0: Ruleset) -> None:
    mod = mvp0.terrain.defense_mod
    assert [mod.of(t) for t in (Terrain.MOUNTAINS, Terrain.FOREST, Terrain.PLAINS)] == [1, 0, -1]
    speed = mvp0.terrain.entry_speed_pct
    assert [speed.of(t) for t in (Terrain.PLAINS, Terrain.FOREST, Terrain.MOUNTAINS)] == [
        125,
        100,
        70,
    ]


def test_mvp0_capacity_supply_build_victory(mvp0: Ruleset) -> None:
    gain = mvp0.capacity.width_gain_centi
    assert [gain.of(w) for w in range(1, 6)] == [100, 150, 200, 230, 260]
    assert (mvp0.capacity.attrition_ticks, mvp0.capacity.grace_ticks) == (30, 50)
    supply = mvp0.supply
    assert (supply.dispatch_ticks, supply.buffer, supply.recharge_per_tick) == (10, 2, 1)
    assert [supply.packet_speed_pct.of(w) for w in range(1, 6)] == [100, 125, 150, 175, 200]
    assert mvp0.build.ticks_per_level == 150
    assert (mvp0.victory.vp_period_ticks, mvp0.victory.capital_multiplier) == (300, 3)


def test_width_table_rejects_unknown_width(mvp0: Ruleset) -> None:
    with pytest.raises(ValueError, match="width 6"):
        mvp0.supply.packet_speed_pct.of(6)
    with pytest.raises(ValueError, match="width 0"):
        mvp0.capacity.width_gain_centi.of(0)


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


@pytest.mark.parametrize("path", [MVP0, TEST_SHORT], ids=lambda p: p.name)
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
        (("capacity", "width_gain_centi"), "6", "capacity.width_gain_centi.6"),
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
    del data["supply"]["buffer"]
    with pytest.raises(RulesetError, match=r"^supply\.buffer: missing key"):
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
        (("terrain", "entry_speed_pct", "forest"), 0, "entry_speed_pct.forest: 0 is out"),
        (("capacity", "width_gain_centi", "3"), -5, "width_gain_centi.3: -5 is out of range"),
        (("supply", "packet_speed_pct", "1"), 0, "packet_speed_pct.1: 0 is out of range"),
        (("build", "ticks_per_level"), 0, "build.ticks_per_level: 0 is out of range"),
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
    assert len(leaves) == 54  # every key of the SIM-01 table, counted by hand
    for path in leaves:
        data = copy.deepcopy(base)
        value = _get(data, path)
        if isinstance(value, str):
            changed: object = {
                "balance": "war",
                "any_city": "capital",
            }[value]
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
        env = {**os.environ, "PYTHONHASHSEED": seed}
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
