"""Map validator (MAP-02): every check has a bad fixture; the MAP-01 test maps pass."""

import dataclasses
import json
from pathlib import Path

import pytest

from gow_maps.cli import main
from gow_maps.validate import ValidatorConfig, check_size, load_config, validate_file
from gow_sim.maps import load_map
from gow_sim.ruleset import load_ruleset

FIXTURES = Path(__file__).parent / "fixtures"
GOOD = Path(__file__).parent / "good"
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
    # DEC-27, items 4 and 5: tolerance 15%, the size check 45..55 is off by default.
    assert (config.travel_ticks_per_100_units, config.travel_tolerance_pct) == (30, 15)
    assert (config.size_check, config.min_nodes, config.max_nodes) == (False, 45, 55)


@pytest.mark.parametrize("path", TEST_MAPS, ids=[p.stem for p in TEST_MAPS])
def test_mapdef_test_maps_pass(path: Path, config: ValidatorConfig) -> None:
    assert validate_file(path, config) == []


# (fixture, the only failing check, a fragment of its message). Each fixture breaks one rule.
BAD: list[tuple[str, str, str]] = [
    ("bad_connectivity", "connectivity", "falls apart into 2 parts: [[0], [1]]"),
    ("bad_planarity", "planarity", "edges 4 and 5 cross"),
    ("bad_symmetry_vp", "symmetry", "nodes 1 and 2 differ: vp 3 != 2"),
    ("bad_symmetry_start", "symmetry", "nodes 0 and 2 differ: start_stock 4 != 5"),
    # DEC-23, table of examples: rows 4, 8, 9, 11.
    ("bad_names", "names", "nodes 1 and 2 share name 'n1'"),
    ("bad_border", "border", "edge 2 mirrors edge 0: border_permille 400, expected 600"),
    ("bad_border_self", "border", "edge 4 is its own mirror: border_permille 400, expected 500"),
    ("bad_symmetry_kind", "symmetry", "nodes 1 and 2 differ: kind city_small != city_medium"),
    ("bad_degree", "degree", "node 3 has 6 roads, max 5"),
    ("bad_disjoint_paths", "disjoint_paths", "reaches node 1 (vp 2) by 1 edge-disjoint path(s)"),
    ("bad_neutral_space", "neutral_space", "1 of 7 nodes are neutral and contested [3]"),
    ("bad_travel_ticks", "travel_ticks", "edge 0: travel_ticks 60, the length gives 30.0"),
    # DEC-27, item 4: |49 - 42.4| > 15% of 42.4 (6.4); 25% (10.6) let it pass before.
    ("bad_travel_ticks_15", "travel_ticks", "edge 0: travel_ticks 49, the length gives 42.4 ± 6.4"),
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


def test_free_positions_pass(config: ValidatorConfig) -> None:
    # DEC-27, item 1: node 1 at (210, 100) is not the rotation of its mirror at (200, 300).
    assert validate_file(GOOD / "free_positions.json", config) == []


def test_border_mirrored_with_the_direction(tmp_path: Path, config: ValidatorConfig) -> None:
    # DEC-23, table of examples, row 7: a -> b with 400, its mirror with end a = m(a) and 400.
    data = json.loads((REPO / "packages/sim/tests/maps/diamond.json").read_text(encoding="utf-8"))
    data["edges"][0]["border_permille"] = data["edges"][2]["border_permille"] = 400
    assert validate_file(_write(tmp_path, "m.json", data), config) == []
    # Row 8 with the right value: the mirror from m(b) = 2 to m(a) = 3 has 1000 - 400.
    data["edges"][2].update(a=2, b=3, border_permille=600)
    assert validate_file(_write(tmp_path, "m.json", data), config) == []


@pytest.mark.parametrize(
    ("name", "issue"),
    [
        ("", "[names] node 1: name '' is not 1..24"),
        ("x" * 25, "is not 1..24"),
        (" Брод", "[names] node 1: name ' Брод' has spaces at the ends"),
    ],
)
def test_bad_names(tmp_path: Path, config: ValidatorConfig, name: str, issue: str) -> None:
    # DEC-23, item 4: 1..24 characters without spaces at the ends.
    data = json.loads((REPO / "packages/sim/tests/maps/line3.json").read_text(encoding="utf-8"))
    data["nodes"][1]["name"] = name
    issues = [str(i) for i in validate_file(_write(tmp_path, "m.json", data), config)]
    assert any(issue in i for i in issues), issues


def test_name_of_24_characters_passes(tmp_path: Path, config: ValidatorConfig) -> None:
    data = json.loads((REPO / "packages/sim/tests/maps/line3.json").read_text(encoding="utf-8"))
    data["nodes"][1]["name"] = "Ж" * 24
    assert validate_file(_write(tmp_path, "m.json", data), config) == []


def test_size_check(config: ValidatorConfig) -> None:
    # DEC-27, item 5: off by default; on, 45..55 nodes.
    line3 = REPO / "packages/sim/tests/maps/line3.json"
    on = dataclasses.replace(config, size_check=True)
    assert validate_file(line3, config) == []
    assert [str(i) for i in validate_file(line3, on)] == ["[size] 3 nodes, need 45..55"]
    assert validate_file(line3, dataclasses.replace(on, min_nodes=3, max_nodes=3)) == []


def test_config_size_check_is_a_bool(tmp_path: Path) -> None:
    text = (Path(__file__).parents[1] / "src/gow_maps/validate.toml").read_text(encoding="utf-8")
    path = tmp_path / "c.toml"
    path.write_text(text.replace("size_check = false", "size_check = 1"), encoding="utf-8")
    with pytest.raises(ValueError, match="size_check must be true or false"):
        load_config(path)
    path.write_text(text.replace("size_check = false", "size_check = true"), encoding="utf-8")
    assert load_config(path).size_check is True


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
        {"id": 2, "a": 0, "b": 2, "max_level": 1, "travel_ticks": 60, "border_permille": 500}
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


# DEC-27, table of examples (mechanics.md, section 9): a 400 x 400 map -------------------------


def _line(
    cap0: tuple[int, int], mid: tuple[int, int], cap1: tuple[int, int], ticks: tuple[int, int]
) -> dict[str, object]:
    """Capital 0 - a neutral middle node (its own mirror) - capital 1; edge 1 mirrors edge 0."""
    base = json.loads((REPO / "packages/sim/tests/maps/line3.json").read_text(encoding="utf-8"))
    for node, (x, y) in zip(base["nodes"], (cap0, mid, cap1), strict=True):
        node.update(x=x, y=y)
    for edge, t in zip(base["edges"], ticks, strict=True):
        edge["travel_ticks"] = t
    base["meta"].update(width=400, height=400)
    return base


def _checks(tmp_path: Path, data: object, config: ValidatorConfig) -> set[str]:
    return {i.check for i in validate_file(_write(tmp_path, "m.json", data), config)}


@pytest.mark.parametrize(
    ("case", "cap1", "ticks", "checks"),
    [
        # Rows 4-6: two roads of 200 units, e = 60; 15% of 60 is 9.
        ("4: travel 60", (200, 300), (60, 60), set[str]()),
        ("5: travel 69 and 51", (200, 300), (69, 69), set[str]()),
        ("5: travel 51", (200, 300), (51, 51), set[str]()),
        ("6: travel 70", (200, 300), (70, 70), {"travel_ticks"}),
        ("6: travel 50", (200, 300), (50, 50), {"travel_ticks"}),
        # Row 7: mirrored roads of 200 and 180 units (e = 54) with one travel_ticks 60.
        ("7: lengths 200 and 180", (200, 280), (60, 60), set[str]()),
        # Row 8: 200 and 150 units (e = 45): |60 - 45| * 100 = 1500 > 15 * 45.
        ("8: lengths 200 and 150", (200, 250), (60, 60), {"travel_ticks"}),
    ],
)
def test_dec27_travel_examples(
    tmp_path: Path,
    config: ValidatorConfig,
    case: str,
    cap1: tuple[int, int],
    ticks: tuple[int, int],
    checks: set[str],
) -> None:
    # The middle node at (200, 100), capital 0 at (0, 100): road 0 is 200 units long; road 1
    # from capital 1 at `cap1` is as long as its distance to the middle.
    data = _line((0, 100), (200, 100), cap1, ticks)
    assert _checks(tmp_path, data, config) == checks, case


def test_dec27_example_1_free_position(tmp_path: Path, config: ValidatorConfig) -> None:
    # Node at (120, 80), its mirror at (260, 310) with the same attributes: OK (rot180 would
    # require (280, 320)). Both roads to the middle (190, 195) are 134.6 units long: 40 ticks.
    data = _line((120, 80), (190, 195), (260, 310), (40, 40))
    assert _checks(tmp_path, data, config) == set()


def test_dec27_example_2_terrain(tmp_path: Path, config: ValidatorConfig) -> None:
    data = _line((0, 100), (200, 100), (200, 300), (60, 60))
    nodes = data["nodes"]
    assert isinstance(nodes, list)
    nodes[2]["terrain"] = "forest"  # pyright: ignore[reportUnknownMemberType]
    assert _checks(tmp_path, data, config) == {"symmetry"}


def test_dec27_example_3_edge_without_mirror(tmp_path: Path, config: ValidatorConfig) -> None:
    data = _line((0, 100), (200, 100), (200, 300), (60, 60))
    data["mirror"] = {"nodes": {"0": 2, "1": 1, "2": 0}, "edges": {"0": 0, "1": 1}}
    assert _checks(tmp_path, data, config) == {"symmetry"}


@pytest.mark.parametrize(
    ("count", "issues"), [(50, []), (45, []), (55, []), (34, ["size"]), (56, ["size"])]
)
def test_dec27_size_examples(config: ValidatorConfig, count: int, issues: list[str]) -> None:
    # Rows 10 and 11: the size check with the thresholds 45..55 switched on.
    mapdef = load_map(REPO / "maps" / "pautina.json")
    nodes = (mapdef.nodes * 2)[:count]
    on = dataclasses.replace(config, size_check=True)
    assert [i.check for i in check_size(dataclasses.replace(mapdef, nodes=nodes), on)] == issues
