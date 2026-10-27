"""``MapFile`` (the map JSON the client gets) agrees with the loader ``gow_sim.maps``.

Maps are validated as JSON, as the client gets them: in strict mode a Python list is not a tuple.
"""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from gow_protocol.mapfile import MapFile
from gow_sim.maps import map_to_data, parse_map

ROOT = Path(__file__).resolve().parents[3]
MAPS = (
    sorted((ROOT / "maps").glob("*.json"))
    + sorted((ROOT / "maps" / "fixtures").glob("*.json"))
    + sorted((ROOT / "packages" / "sim" / "tests" / "maps").glob("*.json"))
)


def _load(path: Path) -> dict[str, object]:
    data: object = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(data, dict)
    return data  # pyright: ignore[reportUnknownVariableType]


def test_there_are_maps_to_check() -> None:
    assert len(MAPS) >= 3


@pytest.mark.parametrize("path", MAPS, ids=[p.stem for p in MAPS])
def test_every_map_is_a_map_file(path: Path) -> None:
    model = MapFile.model_validate_json(path.read_bytes())
    data = _load(path)
    assert model.model_dump(mode="json") == data
    # The loader reads the same file into the same data.
    assert MapFile.model_validate_json(json.dumps(map_to_data(parse_map(data)))) == model


@pytest.mark.parametrize(
    ("section", "field", "value"),
    [
        ("nodes", "vp", 1.5),
        ("nodes", "vp", "1"),
        ("nodes", "vp", True),
        ("nodes", "terrain", "swamp"),
        ("nodes", "capital_of", 2),
        ("edges", "max_level", 6),
        ("edges", "border_permille", 50),
        ("edges", "border_permille", 950),
        ("nodes", "name", ""),
        ("nodes", "name", 7),
    ],
)
def test_bad_value_is_rejected(section: str, field: str, value: object) -> None:
    data = _load(MAPS[0])
    items = data[section]
    assert isinstance(items, list)
    item: dict[str, object] = items[0]  # pyright: ignore[reportUnknownVariableType]
    item[field] = value
    with pytest.raises(ValidationError):
        MapFile.model_validate_json(json.dumps(data))


def test_unknown_key_is_rejected() -> None:
    data = _load(MAPS[0])
    data["extra"] = 1
    with pytest.raises(ValidationError):
        MapFile.model_validate_json(json.dumps(data))
