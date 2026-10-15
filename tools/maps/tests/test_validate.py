"""Map validator (MAP-02): every check has a bad fixture; the MAP-01 test maps pass."""

import json
from pathlib import Path

import pytest

from gow_maps.cli import main
from gow_maps.validate import ValidatorConfig, load_config, validate_file
from gow_sim.ruleset import load_ruleset

FIXTURES = Path(__file__).parent / "fixtures"
REPO = Path(__file__).parents[3]
TEST_MAPS = sorted((REPO / "packages/sim/tests/maps").glob("*.json"))


@pytest.fixture(scope="module")
def config() -> ValidatorConfig:
    return load_config()


def test_default_config_matches_the_issue(config: ValidatorConfig) -> None:
    # Thresholds from MAP-02 (#14) and mechanics.md, section 14.
    assert config.max_degree == 5
    assert (config.disjoint_paths_min_vp, config.min_disjoint_paths) == (2, 2)
    assert (config.min_neutral_pct, config.neutral_max_distance_diff) == (20, 1)


@pytest.mark.parametrize("path", TEST_MAPS, ids=[p.stem for p in TEST_MAPS])
def test_mapdef_test_maps_pass(path: Path, config: ValidatorConfig) -> None:
    assert validate_file(path, config) == []


# (fixture, the only failing check, a fragment of its message). Each fixture breaks one rule.
BAD: list[tuple[str, str, str]] = [
    ("bad_connectivity", "connectivity", "falls apart into 2 parts: [[0], [1]]"),
    ("bad_planarity", "planarity", "edges 4 and 5 cross"),
    ("bad_symmetry_vp", "symmetry", "nodes 1 and 2 differ: vp 3 != 2"),
    ("bad_symmetry_start", "symmetry", "nodes 0 and 2 differ: start_stock 4 != 5"),
    ("bad_symmetry_position", "symmetry", "is not the rotation of (210, 100), expected (190, 300)"),
    ("bad_degree", "degree", "node 3 has 6 roads, max 5"),
    ("bad_disjoint_paths", "disjoint_paths", "reaches node 1 (vp 2) by 1 edge-disjoint path(s)"),
    ("bad_neutral_space", "neutral_space", "1 of 7 nodes are neutral and contested [3]"),
    ("bad_travel_ticks", "travel_ticks", "edge 0: travel_ticks 60, the length gives 30.0"),
    ("bad_neutral_garrison", "format", "nodes[1]: a neutral node has no garrison"),
]


@pytest.mark.parametrize(("name", "check", "message"), BAD, ids=[b[0] for b in BAD])
def test_bad_fixture_fails_its_check(
    name: str, check: str, message: str, config: ValidatorConfig
) -> None:
    issues = validate_file(FIXTURES / f"{name}.json", config)
    assert {i.check for i in issues} == {check}
    assert any(message in i.message for i in issues), issues


def test_every_fixture_is_covered() -> None:
    assert sorted(p.stem for p in FIXTURES.glob("*.json")) == sorted(b[0] for b in BAD)


def _write(tmp_path: Path, name: str, data: object) -> Path:
    path = tmp_path / name
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def test_mirrored_edge_with_wrong_ends_is_reported(tmp_path: Path, config: ValidatorConfig) -> None:
    data = json.loads((REPO / "packages/sim/tests/maps/diamond.json").read_text(encoding="utf-8"))
    # Edges 0 (0-1) and 1 (0-2) claim each other's mirrors: ends do not rotate onto each other.
    data["mirror"]["edges"] = {"0": 3, "1": 2, "2": 1, "3": 0}
    issues = validate_file(_write(tmp_path, "m.json", data), config)
    assert "[symmetry] edges 0 and 3: ends [1, 3] must be [2, 3]" in [str(i) for i in issues]


def test_road_through_a_city_is_reported(tmp_path: Path, config: ValidatorConfig) -> None:
    data = json.loads((REPO / "packages/sim/tests/maps/line3.json").read_text(encoding="utf-8"))
    data["edges"].append(
        {"id": 2, "a": 0, "b": 2, "base_width": 1, "max_width": 1, "travel_ticks": 60}
    )
    data["mirror"]["edges"]["2"] = 2
    checks = {str(i) for i in validate_file(_write(tmp_path, "m.json", data), config)}
    assert "[planarity] edge 2 passes through node 1" in checks


def test_config_rejects_unknown_key(tmp_path: Path) -> None:
    text = (Path(__file__).parents[1] / "src/gow_maps/validate.toml").read_text(encoding="utf-8")
    path = tmp_path / "c.toml"
    path.write_text(text + "max_degre = 4\n", encoding="utf-8")
    with pytest.raises(ValueError, match=r"unknown keys \['max_degre'\]"):
        load_config(path)


def test_cli_exit_codes(capsys: pytest.CaptureFixture[str]) -> None:
    good = [str(p) for p in TEST_MAPS]
    assert main(["validate", *good]) == 0
    assert main(["validate", *good, str(FIXTURES / "bad_degree.json")]) == 1
    out = capsys.readouterr().out
    assert "FAIL" in out
    assert "[degree] node 3 has 6 roads, max 5" in out


def test_cli_expands_glob_patterns(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["validate", str(REPO / "packages/sim/tests/maps/*.json")]) == 0
    assert capsys.readouterr().out.count("OK") == len(TEST_MAPS)
    assert main(["validate", str(FIXTURES / "nothing-*.json")]) == 0
    assert "no files match" in capsys.readouterr().err


# DEC-26, item 5: start stocks against the warehouses of a ruleset with city_upgrades ----------

ROOT_RULESETS = REPO / "rulesets"


def test_warehouse_check_only_with_city_upgrades(config: ValidatorConfig) -> None:
    """Example 20 of DEC-26: a small city with ``start_stock = 2`` fails ``warehouse`` with the
    flag on (its warehouse starts at 1) and passes with it off (the warehouse holds 4)."""
    mvp_map = REPO / "maps" / "arteriya.json"
    on = load_ruleset(ROOT_RULESETS / "mvp-1.toml")
    off = load_ruleset(ROOT_RULESETS / "mvp-0.toml")
    issues = [i for i in validate_file(mvp_map, config, on) if i.check == "warehouse"]
    assert issues and all("city_small" in i.message for i in issues)
    assert validate_file(mvp_map, config, off) == []
    assert validate_file(mvp_map, config) == []


def test_cli_ruleset_option(capsys: pytest.CaptureFixture[str]) -> None:
    mvp_map = str(REPO / "maps" / "pautina.json")
    assert main(["validate", mvp_map, "--ruleset", str(ROOT_RULESETS / "mvp-0.toml")]) == 0
    assert main(["validate", mvp_map, "--ruleset", str(ROOT_RULESETS / "mvp-1.toml")]) == 1
    assert "[warehouse]" in capsys.readouterr().out
