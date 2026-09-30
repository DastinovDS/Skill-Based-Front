"""MVP map pool (MAP-04): three maps built from halves, all passing the validator."""

import json
from pathlib import Path

import pytest

from gow_maps.cli import main
from gow_maps.mirror import mirror_half
from gow_maps.preview import preview_path, render_preview
from gow_maps.validate import load_config, validate_file
from gow_sim.maps import load_map

MAPS = Path(__file__).parents[3] / "maps"
POOL = ["arteriya", "pautina", "pereval"]
CONFIG = load_config()


def test_pool_is_exactly_the_three_mvp_maps() -> None:
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


@pytest.mark.parametrize("name", POOL)
def test_map_size_and_start(name: str) -> None:
    mapdef = load_map(MAPS / f"{name}.json")
    assert mapdef.meta.name == name  # the server requires maps/<id>.json
    # mechanics.md, section 1: 25-40 nodes, each player starts with real territory.
    assert 25 <= len(mapdef.nodes) <= 40
    for player in (0, 1):
        owned = [n for n in mapdef.nodes if n.start_owner == player]
        assert len(owned) >= 4
        assert all(n.start_units > 0 for n in owned)


@pytest.mark.parametrize("name", POOL)
def test_preview_is_committed(name: str) -> None:
    path = preview_path(MAPS / f"{name}.json")
    assert path.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_render_preview(tmp_path: Path) -> None:
    out = tmp_path / "pereval.preview.png"
    render_preview(load_map(MAPS / "pereval.json"), out)
    assert out.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_cli_preview(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    map_path = tmp_path / "pereval.json"
    map_path.write_bytes((MAPS / "pereval.json").read_bytes())
    assert main(["preview", str(map_path)]) == 0
    assert (tmp_path / "pereval.preview.png").exists()
    broken = tmp_path / "broken.json"
    broken.write_text("{}", encoding="utf-8")
    assert main(["preview", str(broken)]) == 1
    assert "FAIL" in capsys.readouterr().out
