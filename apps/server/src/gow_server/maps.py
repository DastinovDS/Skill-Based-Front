"""Map pool served over HTTP: ``maps/<id>.json`` plus an optional background ``<id>.bg.webp``.

The map graph is public to both players (mechanics.md, section 10, DEC-04), so the file is
served as is. Maps are loaded and checked once at startup; a broken map stops the server.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Self

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel

from gow_sim.maps import MapDef, MapFormatError, load_map

BACKGROUND_SUFFIX = ".bg.webp"
# Map files change between releases under the same URL. Without Cache-Control browsers cache
# heuristically (from Last-Modified) and keep serving a stale map or background (#576).
REVALIDATE = {"Cache-Control": "no-cache"}


@dataclass(frozen=True, slots=True)
class MapEntry:
    id: str
    definition: MapDef
    raw_json: bytes
    background: Path | None


class MapCatalog:
    def __init__(self, entries: list[MapEntry]) -> None:
        self._entries = {entry.id: entry for entry in sorted(entries, key=lambda e: e.id)}

    @classmethod
    def load(cls, directory: Path) -> Self:
        """Load every ``*.json`` in ``directory`` (not recursive: ``maps/src/`` holds halves)."""
        entries: list[MapEntry] = []
        for path in sorted(directory.glob("*.json")):
            definition = load_map(path)
            map_id = definition.meta.name
            if path.stem != map_id:
                raise MapFormatError(f"{path}: file name must be <meta.name>.json ({map_id}.json)")
            background = path.with_name(map_id + BACKGROUND_SUFFIX)
            entries.append(
                MapEntry(
                    id=map_id,
                    definition=definition,
                    raw_json=path.read_bytes(),
                    background=background if background.is_file() else None,
                )
            )
        return cls(entries)

    def all(self) -> list[MapEntry]:
        return list(self._entries.values())

    def get(self, map_id: str) -> MapEntry | None:
        return self._entries.get(map_id)


class MapSummary(BaseModel):
    id: str
    version: int
    width: int
    height: int
    background_url: str | None


def get_catalog(request: Request) -> MapCatalog:
    catalog: MapCatalog = request.app.state.maps
    return catalog


Catalog = Annotated[MapCatalog, Depends(get_catalog)]

router = APIRouter(prefix="/api/maps", tags=["maps"])


@router.get("")
async def list_maps(catalog: Catalog, response: Response) -> list[MapSummary]:
    response.headers.update(REVALIDATE)
    return [
        MapSummary(
            id=entry.id,
            version=entry.definition.meta.version,
            width=entry.definition.meta.width,
            height=entry.definition.meta.height,
            background_url=f"/api/maps/{entry.id}/background.webp" if entry.background else None,
        )
        for entry in catalog.all()
    ]


@router.get("/{map_id}", responses={200: {"content": {"application/json": {}}}})
async def get_map(map_id: str, catalog: Catalog) -> Response:
    """The map file as is (format: docs/design/map-format.md)."""
    raw_json = _entry(catalog, map_id).raw_json
    return Response(content=raw_json, media_type="application/json", headers=REVALIDATE)


@router.get("/{map_id}/background.webp", response_class=FileResponse)
async def get_background(map_id: str, catalog: Catalog) -> FileResponse:
    background = _entry(catalog, map_id).background
    if background is None:
        raise HTTPException(status_code=404, detail="map has no background")
    return FileResponse(background, media_type="image/webp", headers=REVALIDATE)


def _entry(catalog: MapCatalog, map_id: str) -> MapEntry:
    entry = catalog.get(map_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="map not found")
    return entry
