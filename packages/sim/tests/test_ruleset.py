"""Ruleset (SIM-01): the values of the kept rulesets, strict loading, stable hash, archive.

Expected values come from the SIM-01 (#17) table "Values and notes", the DEC blocks of
docs/design/mechanics.md and the owner decisions named in the ruleset files, not from the loader
output. The kept rulesets (#894): mvp-5, mvp-6, mvp-7 (the main one) and test-short.
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
    Retreat,
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
MVP5 = RULESETS_DIR / "mvp-5.toml"
MVP6 = RULESETS_DIR / "mvp-6.toml"
MVP7 = RULESETS_DIR / "mvp-7.toml"
TEST_SHORT = RULESETS_DIR / "test-short.toml"
KEPT = (MVP5, MVP6, MVP7, TEST_SHORT)


def _raw(path: Path = MVP7) -> dict[str, Any]:
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
def mvp7() -> Ruleset:
    return load_ruleset(MVP7)


def test_mvp7_clock_and_cp(mvp7: Ruleset) -> None:
    assert (mvp7.tick_hz, mvp7.match_ticks) == (10, 9000)  # 15 minutes (DEC-22)
    cp = mvp7.cp
    assert (cp.start, cp.cap, cp.per_period) == (300, 500, 100)
    assert mvp7.economy.start_stance is Stance.BALANCE  # DEC-09


def test_mvp7_stances(mvp7: Ruleset) -> None:
    """DEC-44 (#772) with DEC-47 (#888): CP every 200 / 100 / 80 ticks, every factory a charge
    every 100 / 200 / 400 ticks in Economy / Balance / War."""
    st = mvp7.stances
    order = (Stance.ECONOMY, Stance.BALANCE, Stance.WAR)
    assert [st.cp_period_ticks.of(s) for s in order] == [200, 100, 80]
    assert [st.capital_period_ticks.of(s) for s in order] == [100, 200, 400]
    assert st.factories_follow is True
    assert mvp7.factories_follow is True
    assert mvp7.factory.built_period_ticks is None


def test_mvp7_order_costs(mvp7: Ruleset) -> None:
    cost = mvp7.orders.cost
    assert (cost.move, cost.planned_move) == (100, 100)  # DEC-41, item 10
    assert (cost.cancel, cost.split, cost.merge) == (0, 0, 0)  # free since DEC-20
    assert cost.recruit == 100  # DEC-25
    assert cost.stance == 0  # DEC-44: free
    assert cost.barracks == 0  # paid in charges (DEC-41, item 7)
    assert mvp7.orders.plan_ticks_per_bonus == 30  # DEC-41, item 10 (P1)


def test_mvp7_starvation_and_recruit(mvp7: Ruleset) -> None:
    """DEC-19 consumption in the pockets of DEC-43, item H: 1 charge per started 3 units every
    10 s after a 10 s grace; DEC-25: 3 s per unit, queue of 3, half refund."""
    s = mvp7.starvation
    assert (s.grace_ticks, s.period_ticks, s.charges, s.per_units) == (100, 100, 1, 3)
    recruit = mvp7.recruit
    assert (recruit.unit_ticks, recruit.queue_max, recruit.refund_started_pct) == (30, 3, 50)


def test_mvp7_terrain_and_combat(mvp7: Ruleset) -> None:
    mod = mvp7.terrain.defense_mod
    assert [mod.of(t) for t in (Terrain.MOUNTAINS, Terrain.FOREST, Terrain.PLAINS)] == [1, 0, -1]
    speed = mvp7.terrain.speed_pct  # by zone (#253)
    assert [speed.of(t) for t in (Terrain.PLAINS, Terrain.FOREST, Terrain.MOUNTAINS)] == [
        125,
        100,
        70,
    ]
    c = mvp7.combat
    assert (c.round_ticks, c.shots_per_round, c.regroup_ticks, c.engage_ticks) == (20, 1, 10, 3)
    assert c.retreat is Retreat.NONE  # DEC-40, variant N
    assert mvp7.capture.charge_cost == 1  # DEC-38, #759


def test_mvp7_capacity_supply_warehouses_victory(mvp7: Ruleset) -> None:
    by_kind = mvp7.capacity.by_kind
    kinds = (
        NodeKind.CAPITAL,
        NodeKind.CITY_LARGE,
        NodeKind.CITY_MEDIUM,
        NodeKind.CITY_SMALL,
        NodeKind.PROVINCE,
    )
    assert [by_kind.of(k) for k in kinds] == [10, 8, 6, 4, 3]  # DEC-22
    assert (mvp7.capacity.attrition_ticks, mvp7.capacity.grace_ticks) == (30, 50)
    supply = mvp7.supply
    assert (supply.dispatch_ticks, supply.recharge_per_tick, supply.speed_pct) == (10, 1, 150)
    w = mvp7.warehouse  # DEC-43, item C: fixed warehouses; DEC-41, item 13: a province holds 1
    assert [w.start_by_kind.of(k) for k in kinds] == [6, 3, 3, 3, 0]
    assert w.province == 1
    cu = mvp7.city_upgrades  # DEC-26, DEC-41 item 7
    assert (cu.barracks_ticks, cu.barracks_charges) == (100, 3)
    f = mvp7.factory  # DEC-41, item 2
    assert (f.cost, f.build_ticks, f.max) == (4, 100, 3)
    fort = mvp7.fort  # DEC-43, item D
    assert (fort.cost, fort.build_ticks, fort.toll_units, fort.toll_charges) == (150, 100, 3, 1)
    assert (mvp7.victory.vp_period_ticks, mvp7.victory.capital_multiplier) == (300, 3)


def test_mvp7_map_tempo(mvp7: Ruleset) -> None:
    """DEC-46 (#803): the multiplier is 100 at 49 nodes, clamped to 50..150."""
    tempo = mvp7.map_tempo
    assert tempo is not None
    assert (tempo.ref_nodes, tempo.min_pct, tempo.max_pct) == (49, 50, 150)


def test_ruleset_is_frozen(mvp7: Ruleset) -> None:
    with pytest.raises(AttributeError):
        mvp7.tick_hz = 20  # pyright: ignore[reportAttributeAccessIssue]


def test_test_short_is_mvp7_with_a_60_second_match() -> None:
    short = load_ruleset(TEST_SHORT)
    assert short.match_ticks == 600  # 60 s at 10 ticks per second
    assert short.tick_hz == 10
    expected = _raw()
    expected["match_ticks"] = 600
    assert to_canonical(short) == expected


def test_mvp6_is_mvp5_with_three_changes() -> None:
    """mvp-6 (owner decision 2026-11-09, #626, #759): mvp-5 with only the capture cost 1
    (DEC-38), the built factory period 100 (DEC-41, item 2) and no retreat (DEC-40, variant N)."""
    mvp5, mvp6 = _raw(MVP5), _raw(MVP6)
    assert mvp5["capture"]["charge_cost"] == 0
    assert mvp5["factory"]["built_period_ticks"] == 200
    assert "retreat" not in mvp5["combat"]
    assert load_ruleset(MVP5).combat.retreat is Retreat.ROUND
    assert mvp6["capture"]["charge_cost"] == 1
    assert mvp6["factory"]["built_period_ticks"] == 100
    assert mvp6["combat"]["retreat"] == "none"
    assert load_ruleset(MVP6).combat.retreat is Retreat.NONE
    mvp6["capture"]["charge_cost"] = mvp5["capture"]["charge_cost"]
    mvp6["factory"]["built_period_ticks"] = mvp5["factory"]["built_period_ticks"]
    del mvp6["combat"]["retreat"]
    assert mvp6 == mvp5


def test_mvp7_is_mvp6_with_three_changes() -> None:
    """mvp-7 (#885, #888): mvp-6 with the section ``[map_tempo]`` (DEC-46), with
    ``stances.factories_follow`` (DEC-47) and so without ``factory.built_period_ticks``."""
    mvp6, mvp7 = _raw(MVP6), _raw(MVP7)
    assert "map_tempo" not in mvp6
    assert "factories_follow" not in mvp6["stances"]
    assert mvp7["stances"]["factories_follow"] is True
    assert "built_period_ticks" not in mvp7["factory"]
    del mvp7["map_tempo"]
    del mvp7["stances"]["factories_follow"]
    mvp7["factory"]["built_period_ticks"] = mvp6["factory"]["built_period_ticks"]
    assert mvp7 == mvp6


@pytest.mark.parametrize("path", KEPT, ids=lambda p: p.name)
def test_canonical_form_is_the_toml_data(path: Path) -> None:
    rules = load_ruleset(path)
    assert to_canonical(rules) == _raw(path)
    assert parse_ruleset(to_canonical(rules)) == rules


@pytest.mark.parametrize(
    "section",
    [
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
    ],
)
def test_every_section_but_map_tempo_is_required(section: str) -> None:
    data = _raw()
    del data[section]
    with pytest.raises(RulesetError, match=rf"^{section}: missing key"):
        parse_ruleset(data)


def test_map_tempo_is_optional() -> None:
    data = _raw()
    del data["map_tempo"]
    rules = parse_ruleset(data)
    assert rules.map_tempo is None
    assert "map_tempo" not in to_canonical(rules)


def test_retreat_is_optional_and_round_by_default() -> None:
    """DEC-40: without the key ``combat.retreat`` is ``round`` (DEC-24, item E); the key at
    ``round`` is the same rules, so the same hash."""
    data = _raw()
    del data["combat"]["retreat"]
    rules = parse_ruleset(data)
    assert rules.combat.retreat is Retreat.ROUND
    data["combat"]["retreat"] = "round"
    assert ruleset_hash(parse_ruleset(data)) == ruleset_hash(rules)


def test_an_unknown_retreat_value_names_the_key() -> None:
    data = _raw()
    data["combat"]["retreat"] = "volley"  # DEC-40 variant V was not chosen
    with pytest.raises(RulesetError, match=r"combat\.retreat"):
        parse_ruleset(data)


def test_built_period_is_required_without_factories_follow() -> None:
    """DEC-47: without ``stances.factories_follow`` a built factory makes its charges by
    ``factory.built_period_ticks``, so the key is required."""
    data = _raw()
    del data["stances"]["factories_follow"]
    with pytest.raises(RulesetError, match=r"^factory\.built_period_ticks: missing key"):
        parse_ruleset(data)
    data["stances"]["factories_follow"] = False
    with pytest.raises(RulesetError, match=r"^factory\.built_period_ticks: missing key"):
        parse_ruleset(data)
    data["factory"]["built_period_ticks"] = 150
    assert parse_ruleset(data).factory.built_period_ticks == 150


def test_built_period_is_refused_with_factories_follow() -> None:
    """DEC-47: with ``stances.factories_follow`` every factory follows the stance, so a built
    period would have no effect: the key is an error."""
    data = _raw()
    data["factory"]["built_period_ticks"] = 150
    with pytest.raises(RulesetError, match=r"^factory\.built_period_ticks: not allowed"):
        parse_ruleset(data)


def test_factories_follow_is_left_out_of_the_hash_when_false() -> None:
    data = _raw(MVP6)
    rules = parse_ruleset(data)
    data["stances"]["factories_follow"] = False
    assert ruleset_hash(parse_ruleset(data)) == ruleset_hash(rules)


@pytest.mark.parametrize(
    "path",
    [
        ("economy", "model"),
        ("supply", "model"),
        ("supply", "rear_min_max"),
        ("orders", "stance_cooldown_ticks"),
        ("orders", "cost", "defense"),
        ("cp", "period_ticks"),
        ("combat", "terrain_burn"),
        ("warehouse", "max_level"),
    ],
)
def test_a_removed_key_is_unknown(path: tuple[str, ...]) -> None:
    """The keys of the removed rulesets (#894) are not keys any more: a typo-like error."""
    data = _raw()
    _set(data, path, 1)
    name = ".".join(path)
    with pytest.raises(RulesetError, match=rf"^{name}: unknown key"):
        parse_ruleset(data)


@pytest.mark.parametrize("section", ["lines", "bunker", "road", "build"])
def test_a_removed_section_is_unknown(section: str) -> None:
    data = _raw()
    data[section] = {}
    with pytest.raises(RulesetError, match=rf"^{section}: unknown key"):
        parse_ruleset(data)


@pytest.mark.parametrize(
    ("path", "typo", "name"),
    [
        ((), "match_tick", "match_tick"),
        (("cp",), "strat", "cp.strat"),
        (("orders", "cost"), "mvoe", "orders.cost.mvoe"),
        (("terrain", "defense_mod"), "hills", "terrain.defense_mod.hills"),
        (("capacity", "by_kind"), "town", "capacity.by_kind.town"),
        (("stances", "cp_period_ticks"), "peace", "stances.cp_period_ticks.peace"),
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
    del data["supply"]["speed_pct"]
    with pytest.raises(RulesetError, match=r"^supply\.speed_pct: missing key"):
        parse_ruleset(data)


def test_file_errors_name_the_file(tmp_path: Path) -> None:
    bad = tmp_path / "bad.toml"
    bad.write_text(MVP7.read_text(encoding="utf-8").replace("cap = 500", "cpa = 500"))
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
        (("cp", "cap"), True, "cp.cap: expected an integer"),
        (("economy", "start_stance"), "panic", "economy.start_stance: expected one of"),
        (("stances", "cp_period_ticks", "war"), 0, "cp_period_ticks.war: 0 is out of range"),
        (("stances", "factories_follow"), 1, "stances.factories_follow: expected true or false"),
        (("orders", "cost", "move"), -1, "orders.cost.move: -1 is out of range"),
        (("orders", "cost", "split"), "100", "orders.cost.split: expected an integer"),
        (("orders", "plan_ticks_per_bonus"), 0, "plan_ticks_per_bonus: 0 is out of range"),
        (("terrain", "speed_pct", "forest"), 0, "speed_pct.forest: 0 is out"),
        (("capacity", "by_kind", "city_small"), -5, "by_kind.city_small: -5 is out of range"),
        (("supply", "speed_pct"), 0, r"supply\.speed_pct: 0 is out of range"),
        (("recruit", "refund_started_pct"), 101, "refund_started_pct: 101 is out of range"),
        (("victory", "vp_period_ticks"), 0, "victory.vp_period_ticks: 0 is out of range"),
        (("factory", "max"), 0, r"factory\.max: 0 is out of range"),
        (("fort", "toll_units"), 0, r"fort\.toll_units: 0 is out of range"),
        (("map_tempo", "max_pct"), 10, r"map_tempo\.max_pct: 10 is out of range"),  # < min_pct
        (("cp",), 5, "cp: expected a table"),
    ],
)
def test_bad_values_are_rejected(path: tuple[str, ...], value: object, message: str) -> None:
    data = _raw()
    _set(data, path, value)
    with pytest.raises(RulesetError, match=message):
        parse_ruleset(data)


def test_hash_ignores_comments_and_key_order(tmp_path: Path) -> None:
    text = MVP7.read_text(encoding="utf-8")
    stripped = "\n".join(line.split(" #")[0] for line in text.splitlines() if line[:1] != "#")
    other = tmp_path / "other.toml"
    swapped = stripped.replace(
        "tick_hz = 10\nmatch_ticks = 9000", "match_ticks = 9000\ntick_hz = 10"
    )
    assert swapped != stripped
    other.write_text(swapped)
    assert ruleset_hash(load_ruleset(other)) == ruleset_hash(load_ruleset(MVP7))


def test_hash_changes_when_any_value_changes() -> None:
    """Every value of mvp-6 is part of the hash. Its keys by hand: 2 root, cp 3, economy 1,
    stances 6, orders 1 + 8 costs, terrain 6, combat 5, capture 1, capacity 2 + 5, starvation 4,
    supply 3, recruit 3, victory 2, city_upgrades 2, warehouse 1 + 4, vision 1 + 9, factory 4,
    fort 4: 77."""
    base = _raw(MVP6)
    base_hash = ruleset_hash(parse_ruleset(base))
    leaves = _leaves(base)
    assert len(leaves) == 77
    for path in leaves:
        data = copy.deepcopy(base)
        value = _get(data, path)
        if isinstance(value, str):
            changed: object = {
                "balance": "war",
                "none": "round",
                "exact": "range",
                "range": "presence",
                "presence": "exact",
            }[value]
        elif isinstance(value, list):
            starts: list[int] = value  # pyright: ignore[reportUnknownVariableType]
            changed = [*starts, starts[-1] + 1]
        else:
            assert isinstance(value, int) and not isinstance(value, bool)
            # +1 stays in range for every mvp-6 value (cp.start 300 < cp.cap, pct <= 99).
            changed = value + 1
        _set(data, path, changed)
        assert ruleset_hash(parse_ruleset(data)) != base_hash, path


def test_hash_is_the_same_in_fresh_processes() -> None:
    expected = ruleset_hash(load_ruleset(MVP7))
    script = (
        "import sys; from gow_sim.ruleset import load_ruleset, ruleset_hash; "
        "print(ruleset_hash(load_ruleset(sys.argv[1])))"
    )
    for seed in ("0", "1", "4242"):
        env = {**os.environ, "PYTHONHASHSEED": seed}  # noqa: TID251 (fresh process with PYTHONHASHSEED)
        out = subprocess.run(
            [sys.executable, "-c", script, str(MVP7)],
            env=env,
            capture_output=True,
            text=True,
            check=True,
        )
        assert out.stdout.strip() == expected


def test_hash_is_blake2b_of_canonical_json(mvp7: Ruleset) -> None:
    import hashlib

    data = canonical_json(to_canonical(mvp7))
    assert b" " not in data  # compact separators
    assert ruleset_hash(mvp7) == hashlib.blake2b(data, digest_size=16).hexdigest()


def test_archive_stores_file_by_hash(tmp_path: Path) -> None:
    archive = tmp_path / "archive"
    target = archive_ruleset(MVP7, archive)
    rules_hash = ruleset_hash(load_ruleset(MVP7))
    assert target == archive / f"{rules_hash}.toml"
    assert target.read_bytes() == MVP7.read_bytes()
    # Archiving the same rules again is a no-op.
    assert archive_ruleset(MVP7, archive) == target
    assert sorted(p.name for p in archive.iterdir()) == [f"{rules_hash}.toml"]
    # Different rules get a different file.
    short = archive_ruleset(TEST_SHORT, archive)
    assert short != target
    assert load_ruleset(short) == load_ruleset(TEST_SHORT)


def test_archive_detects_a_tampered_file(tmp_path: Path) -> None:
    archive = tmp_path / "archive"
    target = archive_ruleset(MVP7, archive)
    target.write_text(TEST_SHORT.read_text(encoding="utf-8"))
    with pytest.raises(RulesetError, match="does not match its hash"):
        archive_ruleset(MVP7, archive)


@pytest.mark.parametrize("path", KEPT, ids=lambda p: p.name)
def test_every_kept_ruleset_is_archived(path: Path) -> None:
    """Every ruleset a match may be played on has its file in ``rulesets/archive`` (AGENTS.md,
    section 4.5), under the hash of its values."""
    archived = RULESETS_DIR / "archive" / f"{ruleset_hash(load_ruleset(path))}.toml"
    assert archived.exists()
    assert ruleset_hash(load_ruleset(archived)) == ruleset_hash(load_ruleset(path))
