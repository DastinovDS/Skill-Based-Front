"""Maps served over HTTP: ``maps/<id>.json`` plus an optional background ``<id>.bg.webp``.

The map graph is public to both players (mechanics.md, section 10, DEC-04), so the file is
served as is. Maps are loaded and checked once at startup; a broken map stops the server.

The catalog holds two groups. The pool (``maps/*.json``) is what the queue plays and what a random
pick draws from. The generated maps (``maps/gen/*.json``, #771) are played only by an explicit
choice, in an unrated match (by link, public or against a bot, #889), and never rated:
``MapCatalog.pool`` keeps them out of every random pick and so out of the queue,
``MatchLifecycle.start`` out of the rating.

The tutorial maps (``maps/tutorial/*.json``, #806) are a third group: only a tutorial chapter
plays them (``gow_server.tutorial``); no map choice, random pick or list names them, and
``GET /api/maps/{id}`` serves them for the client to draw.

A fourth kind is not in the catalog: the per-match maps (#884), made by the server for one unrated
invite or bot match (``gow_server.mapgen``) and stored next to the replays. Their ids start with
``MATCH_MAP_PREFIX``, which no file of the catalog may use, so they never collide with a pool or a
stored generated map. The endpoints below serve them like the catalog maps once they are made.
"""

import asyncio
import re
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Final, Literal, Self

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from gow_sim.maps import GENERATED_SUBDIR, MapDef, MapFormatError, load_map

TUTORIAL_SUBDIR: Final = "tutorial"
"""The maps of the tutorial chapters lie in this subfolder of the map folder (#806)."""

if TYPE_CHECKING:
    from gow_server.mapgen import MapMaker

BACKGROUND_SUFFIX = ".bg.webp"
THUMB_SUFFIX = ".thumb.webp"
GEO_SUBDIR = "geo"
"""The vector file of a map with a geography is ``<folder>/geo/<id>.json`` (DEC-36)."""
# Map files change between releases under the same URL. Without Cache-Control browsers cache
# heuristically (from Last-Modified) and keep serving a stale map or background (#576).
REVALIDATE = {"Cache-Control": "no-cache"}

MATCH_MAP_PREFIX: Final = "live-"
"""The ids of the per-match maps (#884) are ``live-`` and 12 hex digits; the prefix is theirs."""
_MATCH_MAP_RE: Final = re.compile(r"live-[0-9a-f]{12}")

MapSource = Literal["new", "pool", "generated"]
"""Where the map of an unrated match comes from when no ``map_id`` is given (#884):
``new``, a map made for this match; ``pool``, a random pool map; ``generated``, a random stored
generated map (``maps/gen/``)."""


@dataclass(frozen=True, slots=True)
class MapEntry:
    id: str
    definition: MapDef
    raw_json: bytes
    background: Path | None
    generated: bool = False
    """From ``maps/gen/`` (#771) or made for one match (#884): outside the pool, never rated."""
    thumb: Path | None = None
    """The thumbnail of the background, ``<id>.thumb.webp`` (#839)."""
    vectors: Path | None = None
    """The vector file of the geography, ``geo/<id>.json`` (DEC-36)."""
    per_match: bool = False
    """Made by the server for one match (#884), stored next to the replays."""
    tutorial: bool = False
    """From ``maps/tutorial/`` (#806): played only by a tutorial chapter."""


def is_match_map(map_id: str) -> bool:
    """The id of a per-match map (#884)."""
    return _MATCH_MAP_RE.fullmatch(map_id) is not None


def entry_of(
    path: Path,
    definition: MapDef,
    *,
    generated: bool,
    per_match: bool = False,
    tutorial: bool = False,
) -> MapEntry:
    """The entry of a loaded map file with the files next to it (the layout of ``maps/``)."""
    map_id = definition.meta.name
    background = path.with_name(map_id + BACKGROUND_SUFFIX)
    thumb = path.with_name(map_id + THUMB_SUFFIX)
    vectors = path.parent / GEO_SUBDIR / f"{map_id}.json"
    return MapEntry(
        id=map_id,
        definition=definition,
        raw_json=path.read_bytes(),
        background=background if background.is_file() else None,
        generated=generated,
        thumb=thumb if thumb.is_file() else None,
        vectors=vectors if vectors.is_file() else None,
        per_match=per_match,
        tutorial=tutorial,
    )


class MapCatalog:
    def __init__(self, entries: list[MapEntry]) -> None:
        self._entries = {entry.id: entry for entry in sorted(entries, key=lambda e: e.id)}
        if len(self._entries) != len(entries):
            raise MapFormatError("two maps with one id")

    @classmethod
    def load(cls, directory: Path) -> Self:
        """Load the pool ``directory/*.json``, the generated maps ``directory/gen/*.json`` and the
        tutorial maps ``directory/tutorial/*.json``.

        Not recursive otherwise: ``maps/src/`` holds halves, ``maps/fixtures/`` is not served.
        """
        return cls(
            [
                *_load_folder(directory, generated=False),
                *_load_folder(directory / GENERATED_SUBDIR, generated=True),
                *_load_folder(directory / TUTORIAL_SUBDIR, generated=False, tutorial=True),
            ]
        )

    def pool(self) -> list[MapEntry]:
        """The maps of the queue and of a random pick."""
        return [
            entry for entry in self._entries.values() if not entry.generated and not entry.tutorial
        ]

    def generated(self) -> list[MapEntry]:
        """The maps played only by an explicit choice, never rated."""
        return [entry for entry in self._entries.values() if entry.generated]

    def get(self, map_id: str) -> MapEntry | None:
        """A map of any group by id."""
        return self._entries.get(map_id)

    def all(self) -> list[MapEntry]:
        """Every map of the catalog, by id."""
        return list(self._entries.values())


def _load_folder(directory: Path, *, generated: bool, tutorial: bool = False) -> list[MapEntry]:
    entries: list[MapEntry] = []
    for path in sorted(directory.glob("*.json")):
        definition = load_map(path)
        map_id = definition.meta.name
        if path.stem != map_id:
            raise MapFormatError(f"{path}: file name must be <meta.name>.json ({map_id}.json)")
        if map_id.startswith(MATCH_MAP_PREFIX):
            raise MapFormatError(f"{path}: the id prefix {MATCH_MAP_PREFIX} is for per-match maps")
        entries.append(entry_of(path, definition, generated=generated, tutorial=tutorial))
    return entries


def choose_map(
    catalog: MapCatalog,
    map_id: str | None,
    *,
    random_generated: bool = False,
    source: MapSource | None = None,
    default: MapSource = "pool",
) -> MapEntry | None:
    """The map asked for by an unrated match (an invite or a bot match); ``None``: make a new map
    for it (#884).

    ``map_id`` names a map of the catalog (a per-match map is never chosen again, a tutorial map
    only by its chapter). Without it,
    ``source`` says where the map comes from, ``default`` when absent; ``random_generated`` is the
    older spelling of ``source="generated"`` (#771). A random pick draws from the pool or from the
    stored generated maps.
    """
    if random_generated:
        if source not in (None, "generated"):
            raise _unprocessable("random_generated and map_source disagree")
        source = "generated"
    if map_id is not None:
        if source is not None:
            raise _unprocessable("map_id and map_source exclude each other")
        entry = catalog.get(map_id)
        if entry is None or entry.tutorial:
            raise _unprocessable("unknown map")
        return entry
    source = default if source is None else source
    if source == "new":
        return None
    choices = catalog.generated() if source == "generated" else catalog.pool()
    if not choices:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="no maps")
    return secrets.choice(choices)


def _unprocessable(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


class MapSummary(BaseModel):
    id: str
    version: int
    width: int
    height: int
    background_url: str | None
    generated: bool
    """Outside the pool: only by an explicit choice in an unrated match, never rated."""
    thumb_url: str | None = None
    """The thumbnail of the background (#839), ``/api/maps/{id}/thumb.webp``."""
    geo_url: str | None = None
    """The vector file of the geography (DEC-36), ``/api/maps/{id}/geo.json``: the areas of the
    nodes. The client bundles those of the pool and of ``maps/gen/``; a per-match map has this."""
    per_match: bool = False
    """Made by the server for one match (#884); such a map is never in ``GET /api/maps``."""


def summary_of(entry: MapEntry) -> MapSummary:
    base = f"/api/maps/{entry.id}"
    return MapSummary(
        id=entry.id,
        version=entry.definition.meta.version,
        width=entry.definition.meta.width,
        height=entry.definition.meta.height,
        background_url=f"{base}/background.webp" if entry.background else None,
        generated=entry.generated,
        thumb_url=f"{base}/thumb.webp" if entry.thumb else None,
        geo_url=f"{base}/geo.json" if entry.vectors else None,
        per_match=entry.per_match,
    )


def get_catalog(request: Request) -> MapCatalog:
    catalog: MapCatalog = request.app.state.maps
    return catalog


Catalog = Annotated[MapCatalog, Depends(get_catalog)]

router = APIRouter(prefix="/api/maps", tags=["maps"])


@router.get("")
async def list_maps(catalog: Catalog, response: Response) -> list[MapSummary]:
    """The pool, then the stored generated maps; never a per-match map (#884)."""
    response.headers.update(REVALIDATE)
    return [summary_of(entry) for entry in (*catalog.pool(), *catalog.generated())]


@router.get("/{map_id}", responses={200: {"content": {"application/json": {}}}})
async def get_map(map_id: str, request: Request) -> Response:
    """The map file as is (format: docs/design/map-format.md).

    A per-match map (#884) is here once it is made; 404 while it is being made.
    """
    raw_json = (await find_entry(request, map_id)).raw_json
    return Response(content=raw_json, media_type="application/json", headers=REVALIDATE)


@router.get("/{map_id}/summary")
async def get_summary(map_id: str, request: Request, response: Response) -> MapSummary:
    """What ``GET /api/maps`` says of a map, for every map served here, a per-match one too."""
    response.headers.update(REVALIDATE)
    return summary_of(await find_entry(request, map_id))


@router.get("/{map_id}/background.webp", response_class=FileResponse)
async def get_background(map_id: str, request: Request) -> FileResponse:
    return _file((await find_entry(request, map_id)).background, "image/webp", "background")


@router.get("/{map_id}/thumb.webp", response_class=FileResponse)
async def get_thumb(map_id: str, request: Request) -> FileResponse:
    return _file((await find_entry(request, map_id)).thumb, "image/webp", "thumbnail")


@router.get("/{map_id}/geo.json", response_class=FileResponse)
async def get_geo(map_id: str, request: Request) -> FileResponse:
    """The vector file of a map with a geography (format: map-format.md, DEC-36)."""
    return _file((await find_entry(request, map_id)).vectors, "application/json", "geography")


def _file(path: Path | None, media_type: str, what: str) -> FileResponse:
    if path is None:
        raise HTTPException(status_code=404, detail=f"map has no {what}")
    return FileResponse(path, media_type=media_type, headers=REVALIDATE)


async def find_entry(request: Request, map_id: str) -> MapEntry:
    """A map of the catalog or a made per-match map (read from its store in a thread); else 404."""
    catalog: MapCatalog = request.app.state.maps
    entry = catalog.get(map_id)
    maker: MapMaker | None = getattr(request.app.state, "mapmaker", None)
    if entry is None and maker is not None and is_match_map(map_id):
        entry = await asyncio.to_thread(maker.load, map_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="map not found")
    return entry
