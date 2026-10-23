"""Map pool (MAP-04; DEC-27, #266): maps built from halves, all passing the validator.

The three MVP maps of 31..34 nodes stay in the pool next to the three maps of DEC-27 (45..55 nodes
with provinces, free coordinates of the mirror half).
"""

import dataclasses
import json
from pathlib import Path

import pytest

from gow_maps.cli import main
from gow_maps.mirror import mirror_half
from gow_maps.preview import preview_path, render_preview
from gow_maps.validate import load_config, validate_file
from gow_sim.maps import NodeKind, load_map
from gow_sim.ruleset import load_ruleset

MAPS = Path(__file__).parents[3] / "maps"
MVP = ["artery", "web", "pass"]
DEC27 = ["ridge", "crossroads", "highway"]
POOL = sorted(MVP + DEC27)
CONFIG = load_config()
SIZE = dataclasses.replace(CONFIG, size_check=True)  # DEC-27, item 5: 45..55 nodes


def test_pool_is_exactly_the_known_maps() -> None:
    assert sorted(p.stem for p in MAPS.glob("*.json")) == POOL
    assert sorted(p.name for p in (MAPS / "src").glob("*.json")) == [
        f"{name}.half.json" for name in POOL
    ]


@pytest.mark.parametrize("name", POOL)
def test_map_passes_the_validator(name: str) -> None:
    assert validate_file(MAPS / f"{name}.json", CONFIG) == []


@pytest.mark.parametrize("name", POOL)
def test_map_is_built_from_its_half(name: str) -> None:
    # maps/<name>.json is exactly what `gow-maps mirror` makes of maps/src/<name>.half.json.
    half = json.loads((MAPS / "src" / f"{name}.half.json").read_text(encoding="utf-8"))
    built = json.loads((MAPS / f"{name}.json").read_text(encoding="utf-8"))
    assert mirror_half(half, CONFIG) == built


@pytest.mark.parametrize("name", DEC27)
def test_dec27_map_passes_the_size_check_and_the_warehouses(name: str) -> None:
    # DEC-27, item 5: 45..55 nodes; DEC-26, item 5: no city starts above its warehouse (mvp-1).
    rules = load_ruleset(MAPS.parent / "rulesets" / "mvp-1.toml")
    assert validate_file(MAPS / f"{name}.json", SIZE, rules) == []


@pytest.mark.parametrize("name", DEC27)
def test_dec27_map_has_provinces_and_free_positions(name: str) -> None:
    mapdef = load_map(MAPS / f"{name}.json")
    provinces = [n for n in mapdef.nodes if n.kind is NodeKind.PROVINCE]
    assert len(provinces) * 3 >= len(mapdef.nodes)  # DEC-23: about half of the nodes
    # DEC-27, item 1: the picture is not a rotation, most mirror pairs are off (w - x, h - y).
    width, height = mapdef.meta.width, mapdef.meta.height
    mirrors = [mapdef.nodes[mapdef.mirror_nodes[n.id]] for n in mapdef.nodes]
    moved = [
        n.id
        for n, m in zip(mapdef.nodes, mirrors, strict=True)
        if (m.x, m.y) != (width - n.x, height - n.y)
    ]
    assert len(moved) * 2 > len(mapdef.nodes)


@pytest.mark.parametrize("name", POOL)
def test_map_size_and_start(name: str) -> None:
    mapdef = load_map(MAPS / f"{name}.json")
    assert mapdef.meta.name == name  # the server requires maps/<id>.json
    # mechanics.md, section 1: 25-40 nodes (DEC-27: 45..55), each player starts with real
    # territory.
    assert 25 <= len(mapdef.nodes) <= (55 if name in DEC27 else 40)
    for player in (0, 1):
        owned = [n for n in mapdef.nodes if n.start_owner == player]
        assert len(owned) >= 4
        # DEC-23, item 2: an own province starts empty; every own city has a garrison.
        assert all(n.start_units > 0 for n in owned if n.kind is not NodeKind.PROVINCE)


@pytest.mark.parametrize("name", POOL)
def test_preview_is_committed(name: str) -> None:
    path = preview_path(MAPS / f"{name}.json")
    assert path.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_render_preview(tmp_path: Path) -> None:
    out = tmp_path / "pass.preview.png"
    render_preview(load_map(MAPS / "pass.json"), out)
    assert out.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_cli_preview(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    map_path = tmp_path / "pass.json"
    map_path.write_bytes((MAPS / "pass.json").read_bytes())
    assert main(["preview", str(map_path)]) == 0
    assert (tmp_path / "pass.preview.png").exists()
    broken = tmp_path / "broken.json"
    broken.write_text("{}", encoding="utf-8")
    assert main(["preview", str(broken)]) == 1
    assert "FAIL" in capsys.readouterr().out
