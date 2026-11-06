"""Maps served over HTTP: ``maps/<id>.json`` plus an optional background ``<id>.bg.webp``.

The map graph is public to both players (mechanics.md, section 10, DEC-04), so the file is
served as is. Maps are loaded and checked once at startup; a broken map stops the server.

The catalog holds two groups. The pool (``maps/*.json``) is what the queue plays and what a random
pick draws from. The generated maps (``maps/gen/*.json``, #771) are played only by an explicit
choice, in a private match or against a bot, and never rated: ``MapCatalog.pool`` keeps them out
of every random pick, ``invites.create_match`` out of the public lobby, ``MatchLifecycle.start``
out of the rating.
"""

import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Self

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from gow_sim.maps import GENERATED_SUBDIR, MapDef, MapFormatError, load_map

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
    generated: bool = False
    """From ``maps/gen/`` (#771), outside the pool."""


class MapCatalog:
    def __init__(self, entries: list[MapEntry]) -> None:
        self._entries = {entry.id: entry for entry in sorted(entries, key=lambda e: e.id)}
        if len(self._entries) != len(entries):
            raise MapFormatError("two maps with one id")

    @classmethod
    def load(cls, directory: Path) -> Self:
        """Load the pool ``directory/*.json`` and the generated maps ``directory/gen/*.json``.

        Not recursive otherwise: ``maps/src/`` holds halves, ``maps/fixtures/`` is not served.
        """
        return cls(
            [
                *_load_folder(directory, generated=False),
                *_load_folder(directory / GENERATED_SUBDIR, generated=True),
            ]
        )

    def pool(self) -> list[MapEntry]:
        """The maps of the queue and of a random pick."""
        return [entry for entry in self._entries.values() if not entry.generated]

    def generated(self) -> list[MapEntry]:
        """The maps played only by an explicit choice, never rated."""
        return [entry for entry in self._entries.values() if entry.generated]

    def get(self, map_id: str) -> MapEntry | None:
        """A map of either group by id."""
        return self._entries.get(map_id)


def _load_folder(directory: Path, *, generated: bool) -> list[MapEntry]:
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
                generated=generated,
            )
        )
    return entries


def choose_map(
    catalog: MapCatalog, map_id: str | None, *, random_generated: bool = False
) -> MapEntry:
    """The map asked for by a private or a bot match, or a random one (a pool map by default)."""
    if map_id is not None:
        entry = catalog.get(map_id)
        if entry is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="unknown map")
        return entry
    choices = catalog.generated() if random_generated else catalog.pool()
    if not choices:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="no maps")
    return secrets.choice(choices)


class MapSummary(BaseModel):
    id: str
    version: int
    width: int
    height: int
    background_url: str | None
    generated: bool
    """Outside the pool: only by an explicit choice in a private or a bot match, never rated."""


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
            generated=entry.generated,
        )
        for entry in (*catalog.pool(), *catalog.generated())
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
