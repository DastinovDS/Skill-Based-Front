# Map format

A map is a JSON file in `maps/` (the server pool), in `maps/fixtures/` (the three MVP maps `artery`, `web`, `pass`, kept as test fixtures since #372), in `maps/menu/` (the maps `marches` and `valley` drawn behind the screens before a match, #474, #866, outside the pool) or in `maps/gen/` (generated maps, #771, outside the pool); a map made by the server for one match lives on its data volume (#884, "A new map for every match" below). The loader: `gow_sim.maps.load_map(path) -> MapDef` (MAP-01, #13).
The map design checks (connectivity, planarity, rule symmetry, names, border points,
neutral space) are run by the offline validator `uv run gow-maps validate maps/*.json maps/fixtures/*.json maps/menu/*.json` (MAP-02, #14).

The game rules that rely on map fields are described in [`mechanics.md`](mechanics.md): terrain
(section 4), roads (section 8), cities and capacity (section 9), VP (section 11).

## Format changes under DEC-23 (implemented)

> Decision [accepted]: DEC-23 (#235), mechanics.md, section 9; related rules: DEC-21 (#233, the border
> point), DEC-22 (#234, capacity by node kind, road levels). DEC-22 (#238) introduced `kind` in place of
> `base_capacity`; the rest (`name`, `border_permille`, `max_level` instead of `max_width`, removal of
> `base_width`, the validator checks, the half of a map) was implemented in #366 (`SIM_VERSION` 20,
> `PROTOCOL_VERSION` 24). Maps with provinces: #266. The table below is the history of the change; the current
> format is described in the sections "Structure" and later.

| Where | Was | Becomes |
|---|---|---|
| `nodes[]` | `base_capacity` | removed; new `kind`: `capital` \| `city_large` \| `city_medium` \| `city_small` \| `province`, capacity by kind from the ruleset (`capacity.by_kind`) |
| `nodes[]` | (none) | `name`: the node name, a string of 1..24 characters with no leading or trailing spaces, unique within the map, not translated |
| `nodes[]` provinces | (none) | `vp = 0`, `capital_of = null`, `start_units = start_charged = start_stock = 0`; `start_owner` any |
| `nodes[]` | (none) | `kind = capital` if and only if `capital_of` is not `null` |
| `edges[]` | `base_width`, `max_width` (1..5) | `base_width` is removed (all roads start at level 1 with no type); `max_level`, 1..3 |
| `edges[]` | (none) | `border_permille`: the border point in thousandths from end `a`, 100..900, required in a finished map |
| `mirror` | attributes are equal | `kind` is equal, `name` is its own; the `border_permille` of the mirrored edge is equal to the original if its end `a` = `m(a)`, otherwise `1000 - border_permille`; an edge mirrored to itself: 500 |
| half of a map | (none) | a node has `name` and `mirror_name` (the central one has `name` only); `border_permille` of an edge is optional (500); the copy of a `cross_edge` gets `1000 - border_permille`, a `cross_edge` with `a == b` requires 500 |
| validator | (none) | the checks `names`, `border` (range and symmetry), `kinds` (provinces, capitals); `symmetry` compares `kind` and `border_permille` taking direction into account. **Implemented:** the range of `border_permille` and `kinds` (items 2, 3) are checked by the loader (the `format` error, examples 1-3 and 5 of DEC-23), the symmetry of the border point by the `border` check, `kind` by the `symmetry` check |

## Format changes under DEC-26 (implemented in #265)

> Since #894 (2026-11-09) every ruleset has fixed warehouses (DEC-43, item C) and no flag
> `city_upgrades.enabled`: the right column below is how it always works, the `warehouse` check runs against
> `rulesets/mvp-7.toml` (`mise run maps:validate`). The rulesets `mvp-0` and `mvp-1` named below were removed.

> Decision [accepted] (all details, 2026-10-14): DEC-26 (#265), mechanics.md, section 8. The map file
> format does not change: the barracks and the warehouse level live in the match state, not in the map.
> What changes is the meaning of `start_stock` and the validator checks, and only with `city_upgrades.enabled = true`.
> The DEC-26 change to roads (no type, prices 1 and 2) does not affect the map format: `max_level` stays
> from 1 to 3, and it applies for any value of the flag.

| Where | Now | With `city_upgrades.enabled = true` |
|---|---|---|
| `nodes[].start_stock` | the starting warehouse stock, within the node capacity (`capacity.by_kind`) | within the **warehouse** capacity of the node kind: `warehouse.start_by_kind[kind]` (capital 6, large and medium 2, small 1); at start the simulation takes `min(start_stock, warehouse_capacity)` |
| validator | (none) | the `warehouse` check (only with a ruleset that has `city_upgrades.enabled`: `gow-maps validate --ruleset rulesets/mvp-1.toml maps/*.json maps/fixtures/*.json`): `start_stock <= warehouse.start_by_kind[kind]`; it is not checked without `--ruleset` or with `mvp-0`. All six maps (the pool and the fixtures) pass it (`mise run maps:validate`): small cities have `start_stock = 1`; in `artery` and `web` the value was fixed from 2 to 1 in #379 (before that the simulation with `mvp-1` clipped it to 1, with `mvp-0`, where the warehouse equals the node capacity, a small city started with 2) |
| `nodes[].kind` | unit capacity by node kind | the same; plus the warehouse and the right to recruit (only the capital from the start) are set by the ruleset, not by the map |
| starting garrisons | `start_units` in any city | unchanged: a city without a barracks keeps its starting garrison but does not recruit |

## Format changes under DEC-27 (implemented)

> Decision [accepted] (all details, 2026-10-14): DEC-27 (#266), mechanics.md, section 9.
> Symmetry of the rules, not of the picture: the graph and the attributes stay mirrored, the node coordinates are free.
> What changes is the validator, the mirroring script and the background; the map file format does not change. Background: #269;
> validator and script: #366; maps with 45..55 nodes with provinces (`ridge`, `crossroads`, `highway`) and
> the `grid55` benchmark: #266 (projection budget on 55 nodes: #371).

| Where | Now | Becomes |
|---|---|---|
| `mirror` | the coordinates of the mirrored node are `(width - x, height - y)` | the coordinates are free; the graph and the attributes of nodes and edges, `border_permille` with direction stay mirrored. **Done in #366** |
| validator `symmetry` | compares the coordinates too | the graph and the attributes (`kind`, `terrain`, `vp`, the starting fields, `max_level`, `travel_ticks`, `border_permille`); it does not compare coordinates. **Done in #366** |
| validator `travel_ticks` | tolerance `travel_tolerance_pct = 25` | `15`: `abs(travel_ticks - e) * 100 <= 15 * e`, `e = length * 30 / 100`; mirrored edges with the same `travel_ticks` differ in length by no more than the tolerance. **Done in #366** |
| validator `planarity` | unchanged | unchanged, but now the main protection against crossings of mirrored roads |
| validator `size` | (none) | new, off by default: `min_nodes = 45`, `max_nodes = 55` in `validate.toml`. **Done in #366** |
| half of a map | a copy at `(width - x, height - y)` | optional `mirror_x`, `mirror_y` on a node; `self_mirror: true` for a node mirrored to itself (not only at the center). **Done in #366** |
| `meta.symmetry` | `"rot180"`: a rotation by 180° | `"rot180"` stays and means swapping players and nodes per the `mirror` table, not geometry. **Done in #366** |
| background `bake` | land and sea, a coast; symmetric by rotation | the whole map is land (no sea, shallows, beach); biomes by node terrain; the picture need not be mirrored. **Done in #269**, see the section "Map background" below |
| preview, `maps/README.md` | "180° rotational symmetry", 25-40 nodes | rewrite: symmetry of the rules, 45-55 nodes. Preview: names and border points, symmetry of the rules in the README (#366); 45-55 nodes: #266. **Done** |

## Format changes under DEC-36 (accepted 2026-10-29; step 1: the baker and the validator, #537)

> Decision **[accepted]** 2026-10-29: DEC-36 (#537), mechanics.md, section 9: water cells, rivers as area borders,
> areas of nodes touch only where a road links them; water look W4 Painted, no dark line along water. Step 1 (#537):
> the authored file, the baker and the vector file, the validator check `geography`. Step 2 (the client territory
> layer, #544) and step 3 (the pool maps and the menu map with water, #545) follow. Since #545 the pool maps `ridge`,
> `crossroads`, `highway` and the menu map `valley` have an authored geography (`maps/README.md` lists their water,
> rivers and bridges); the fixtures and the test maps keep the land-only background of the section "Map background". Mockup:
> [`mockups/map-geography.html`](mockups/map-geography.html); prototype: `mockups/src/map_geography.py`.

**The map file does not change.** Water is not a field of `maps/<id>.json`: the loader (`gow_sim.maps`), `MapDef`,
`map_hash`, the protocol type `MapFile` and the simulation stay as they are. Two new files per map, both read only by
the map tools and the client (module `gow_maps.geo`):

| File | Who writes it | Who reads it | What |
|---|---|---|---|
| `maps/src/<id>.geo.json` | the map author (next to the half `maps/src/<id>.half.json`) | `gow-maps bake`, `gow-maps validate` | the authored geography: water cells, long rivers |
| `maps/geo/<id>.json` | `gow-maps bake` (generated, committed, like `maps/<id>.bg.webp`) | the client (bundled at build time like the background), `gow-maps validate` | the computed geometry: shared border chains, water, river lines, bridges |

The generated file lives in the subdirectory `maps/geo/` (`maps/menu/geo/` for the menu map), not as
`maps/<id>.geo.json` as first proposed: every `maps/*.json` is a map to the server pool (`gow_server.maps` loads
`*.json` without subdirectories), the client bundle (`bundledMaps.ts`), `maps:validate`, `maps:bake` and the
tournament, so a sibling `.json` file would be taken for a map.

The authored geography (`maps/src/<id>.geo.json`), numbers in world units (`x`, `y`, `r` integers, the half widths
`w0`, `w1` positive numbers); unknown keys are an error:

```json
{
  "map": "ridge",
  "water":  [{"kind": "sea",  "x": -150, "y": 1360, "r": 330},
             {"kind": "lake", "x": 820,  "y": 760,  "r": 72}],
  "rivers": [{"from": [800, 885], "to": 1, "w0": 6, "w1": 11}]
}
```

- `water[]`: a water cell. `kind`: `sea` or `lake` (only the look differs); `x`, `y`: its point, may lie outside the
  map (a sea along an edge); `r`: its radius (the cell takes the ground nearer to its point minus `r` than to any node).
- `rivers[]`: a long river. `from`: the spring (a point near an area border; a point at a lake is its outflow); `to`
  (optional): the index of the water cell it flows into, otherwise the nearest water; `w0`, `w1` (optional, default 4
  and 11): the half width at the spring and at the mouth.
- Node moves are made in the half itself (`x`, `y`, `mirror_x`, `mirror_y`); `meta.version` is raised as for any map edit.

The computed geometry (`maps/geo/<id>.json`), written by the baker (compact JSON, one chain per line):

| Field | What |
|---|---|
| `map`, `version` | the map id and `meta.version` it was baked from (the client ignores a stale file and falls back to the Voronoi cells; the validator fails a stale one) |
| `step` | the grid step of the labels (4 world units) |
| `chains[]` | the shared borders of the subdivision: `{l, r, pts}`, one polyline per stretch of border between two regions from junction to junction, on the cell corners (integers, multiples of `step`), simplified by Ramer-Douglas-Peucker (3 units); `pts` is flat `[x0, y0, x1, y1, ...]`; `l` lies on the left of the walk from the first point (the `y` axis down), `r` on the right; each is a node id, `"w<k>"` (water cell `k`), `"river"` (a long river or a stream), or `-1` (outside the map). An area ring and its neighbour use the same chain, so the tint, the borders and the water match exactly |
| `water[]` | `{kind}` of every water cell, in the order of the authored file |
| `rivers[]`, `streams[]` | `{pts, hw}`: centre lines (flat points) with the half width per point (for the flow look, not for the shape) |
| `bridges[]` | `{edge, x, y}`: the road and the point (its border point) where a long river passes it |

**The baker** (`gow-maps bake`, still numpy and Pillow; for a map with `maps/src/<id>.geo.json`): computes the label
grid of item 2 of DEC-36 (nearest site: a node with its road halves plus 18 units, or a water cell; the warp of
`_Noise.warp` (amplitude `bake.WARP`, 24 units) fading near roads (`geo.WARP_FADE`: none within 6 units of a road, full
from 140; a water cell never comes closer than 34 units to a road nor 60 to a node), cuts a
stream on every border of two node areas without a road (half width 4.5 units, up to 9 next to water), turns the land
contacts left over into stream cells, routes the long rivers along area borders (Dijkstra over the cells near a
border and at least 40 units from every node), turns land pieces cut off from their node into the water around them,
and bakes the picture: the T2 ground of the new areas (under the water the ground continues, so there is no muddy band
at a shore), details thinning toward a shore, and the water of **W4 Painted** on top: two tones in blotches, rivers
lighter, the shore of a sea or a lake lighter inside the water, a slightly darker current on rivers (no light flow
streaks: the owner read them as rendering artifacts, 2026-10-30, #585), sparse muted reed tufts beside the water, wooden bridges. **No dark line along water** (the owner, 2026-10-29):
nothing darkens the land along a coast or a river bank, the edge of the water is only anti-aliased. Then it writes the
vector file. Deterministic for the map seed as now; the WebP limit of 0.5 MB and the 10 s per map stay (the mockup
geography on `ridge`: about 1 s for the geography, 4 to 6 s for the picture). `tools/maps/tests/test_bake.py` compares
a committed vector file with a fresh bake by its structure (the head, the bridges, the pairs of regions with a shared
border), not byte by byte: the labels come from floating-point noise, and a cell at a tie may flip between numpy
builds; the picture with the tolerance of today.

**Calmer borders (#919, item 11, the owner's option B of 2026-11-10).** The warp was 40 units fading over 6 to 70
units from a road: the steep fade bent every border into an S next to a road (a radius of 15 to 20 units), and the warped
grid folded (the Jacobian of `(x, y) + fade * warp` at or below 0) in 0.13 to 0.8% of the cells of the maps with a
geography, which drew hooks on the borders (smallest Jacobian -0.12 to -0.45). Now 24 units fading over 6 to 140: no fold
on any committed map (smallest Jacobian 0.27 to 0.48). One global change, no map field; `WARP` also warps the biome
areas of the maps without a geography (the fixtures). Every committed map was rebaked (backgrounds, thumbnails, vector
files, previews) and passes `maps:validate`. `GENERATOR_VERSION` stays 1: `generate(seed)` never reads the warp (its map
and authored geography of a seed are the same), the warp only moves the baked borders and so may change which seed passes
the check `geography` after the bake; the stored `maps/gen/` maps all still pass.

**The validator:** a new check `geography`, on for a map that has `maps/src/<id>.geo.json` (the fixtures and the
current pool without one are not checked):

| Check | What it requires |
|---|---|
| `geography` | on the label grid of the baker (4 world units per cell, 4-neighbour contacts): two node areas share land only if a road connects their nodes; every area is one piece and holds its node; a road crosses water (a sea, a lake, a river, a stream) only within 24 units of a bridge of its own (the bridge stands at its border point); every node is at least `water_clearance` (60, `validate.toml`) from a water cell (a sea or a lake; rivers and streams are area borders and are not counted); `maps/geo/<id>.json` exists and was baked from this map and `meta.version`; a malformed authored file or one of another map fails here too |

**The client** (territory layer, `apps/client/src/render/`): for a map with a vector file, the areas come from its
chains instead of `voronoiCells`: the tint and its capture fade, the owner border, the glow and the thin area line
(`mapView.ts`, `regionLayout.ts`), the fog veil (`fogView.ts`), the capture effect (`effectsView.ts`), picking an area
by a click (`pick.ts`, today `insideConvex`: the new areas are not convex) and the Supply view (its flat floor hides the
background, so it draws the water flat). The owner border runs along a coast where the territory ends at water and not
along a river between two areas of one owner. Maps without the file keep today's code. No new dependency, no
protocol change (the file is bundled like the background; serving it at `GET /api/maps/{id}/geo.json` too is optional).

**Done in #544 (step 2).** `apps/client/src/map/geography.ts` loads `maps/geo/<id>.json` (one lazy chunk per map,
`maps/geo/` is copied into the client stage of `deploy/caddy.Dockerfile`) and ignores a file of another map or another `meta.version`; `render/territory.ts` turns the chains
into one polygon per node (a lake inside an area is cut out by a slit) and into edges with what lies across each.
Every chain except the map frame is smoothed once (#585): resampled every 4 units, a binomial low-pass filter of about
10 units (the stairs of the 4-unit label grid vanish, the warp of the borders stays), simplified; the line moves at most
about 4.5 units from the traced chain. The ends of a chain stay where they are (a junction of three regions, the frame),
so the neighbours still share every point; where only an area and water meet (a coast running into a river mouth), the
chains through the point are smoothed as one line, without a kink. A river bank is looked across in pieces of 16 units,
and a run of another answer shorter than 40 units takes the answer of its longer neighbour, so the owner border has no
loose stub and no gap at a bend or a mouth; the owner border is moved inward with a miter at every corner, so its
segments meet. Across a sea or a lake there is no area; across a river or a
stream the client looks for the area on the far bank, so the owner border runs along a coast, along a river bank between two
owners, and not along a river between two areas of one owner. The thin area line is drawn only between two land areas (no
line along water). The fog veil covers the areas of hidden nodes only, not the water beside them. The Supply view and the
terrain mode draw the water flat (the part of the map no area covers). A map without a usable file keeps the Voronoi cells.

**Symmetry** (DEC-27, item 1): the authored geography and the vectors need not be mirrored; `symmetry` does not read them.

## Format changes under #771 (generated maps, stage 1)

> Decision [accepted] 2026-11-06 (#768, #771): DEC-27, item 8, for generated maps outside ranked. A map of its own
> geography, not a reflection of one half; fairness comes from a filter of equal access, not from a mirror, and approximate
> equality is accepted, so such a map belongs to a separate unrated mode. Ranked, the queue and tournaments stay on the
> hand-made maps. Stage 1 is the offline generator and the batch `maps/gen/`; stage 2, a new map for every match on the
> server, is #884 (below, "A new map for every match").

| Where | Now | Becomes |
|---|---|---|
| `meta.symmetry` | `"rot180"` | `"rot180"` or `"none"`: a map without a mirror |
| `mirror` | swaps the players | with `"none"`: the identity, `m(x) = x` for every node and edge. It passes the involution check of the loader, and `node_key(player, node)` is the node id for both players. The simulation, the server and the bots read nothing else of the table (checked in the code: `node_key`, `Bot.edge_keys`) |
| validator | `symmetry`, `border` | with `"none"`: skipped; `symmetry` only requires the identity table, the new check `fairness` takes their place. All the other checks stay |
| `gow-maps` | | `generate --seed N` (`mise run maps:generate <seed>`), `score <files>` |

**No rule.** A map enters a match as data, never as a seed: no `SIM_VERSION`, the loader only learns one more value. The
client type `MapFile` takes it too (`Literal["rot180", "none"]`, `PROTOCOL_VERSION` 40): the client reads no `symmetry` and no
`mirror`, nothing in it depends on them.

### Playing a generated map

The owner's decision of 2026-11-06: the batch is playable, so that he can judge it by hand. Generation per match came with
stage 2 (#884, below).

| Where | What |
|---|---|
| `gow_server.maps` | `MapCatalog.load` reads `maps/*.json` into the pool and `maps/gen/*.json` into the generated group; `pool()` and `generated()` are separate, `get(id)` finds both; one id in both groups stops the server |
| `GET /api/maps` | the pool first, then the generated maps, each with the flag `generated`; `GET /api/maps/{id}` and the background serve both |
| who can play | only by an explicit choice: `map_id`, or `random_generated: true` (a draw from the group), in `POST /api/matches` and `POST /api/bot-matches`. A random pick without them, and the queue, draw from the pool. A public match may name one too since #889 (it is unrated) |
| rating | none: only the queue passes `rated`, and `MatchLifecycle.start` ignores it for `meta.symmetry = "none"` as well |
| replays | `gow_sim.replay` looks for the map of a log in the map folder and in its `gen/` |
| client | the group "Generated, unrated" in the map tiles of the invite, public and bot screens (#889); the vector files `maps/gen/geo/<id>.json` are bundled like `maps/geo/` (`geography.ts`, `deploy/caddy.Dockerfile`); the result screen names the map |

### A new map for every match (stage 2, #884)

The owner's decision of 2026-11-09 (#768): every ordinary, unrated match gets a freshly generated map at its start: a
private invite and a bot match, and since #889 a public lobby match (unrated too). Rated play and the matchmaking queue stay
on the pool. The quality of
the background is that of the offline bake. The map still enters the match as data: no rule, no `SIM_VERSION`.

| Where | What |
|---|---|
| who gets one | `POST /api/matches` (by link or public, #889) and `POST /api/bot-matches` without `map_id`: the default `map_source` is `new`. `map_source: "pool"` draws from the pool, `"generated"` (or the older `random_generated: true`) from `maps/gen/`, `map_id` names a map; `map_id` with `map_source` is `422`. With `GOW_MAPGEN_ENABLED=false` the default is the pool again |
| how | `gow_server.mapgen.MapMaker` draws 4 seeds with `secrets` (32 bits) and reserves the id; `gow_server.mapworker.build` runs `gow_maps.matchmap.make_map` in a spawn `ProcessPoolExecutor` (one map per worker process, `GOW_MAPGEN_WORKERS`, `nice` 10, the out-of-memory killer's first choice): `generate(seed)` with the equal-access filter, renamed to the id; the bake of `gow-maps bake` (background with water, thumbnail, vector file); `validate_file` with the server's ruleset (every check of `gow-maps validate`, `geography`, `fairness`, `warehouse`); the preview. A seed that fails gives way to the next |
| the id | `live-` and 12 hex digits (`gow_server.maps.MATCH_MAP_PREFIX`; a file of the pool or of `maps/gen/` with this prefix stops the server), so it never collides with a stored map. The generator's `gen<version>-<seed>` is not used: renaming changes only the noise of the bake; the server logs the seed (`map made`) |
| storage | `<GOW_REPLAYS_DIR>/maps/` on the data volume (not `maps/` of the image), in the layout of `maps/gen/`: `<id>.json`, `src/<id>.geo.json`, `<id>.bg.webp`, `<id>.thumb.webp`, `geo/<id>.json`, `<id>.preview.png`. The worker writes into `.tmp-<id>/` and moves the map file in last |
| serving | `GET /api/maps/{id}`, `/background.webp`, `/thumb.webp`, `/geo.json` and `/summary` (a `MapSummary` with `per_match: true`) serve it once it is made (404 before); `GET /api/maps` never lists it, and it cannot be chosen by `map_id` |
| replays | the replay log names it by `map_id` and `map_hash` as any map; `gow_sim.replay` looks for the map of a log first in `maps/` next to the log, which is the store, so the re-simulation and the frames file need no change (the frames file embeds the map anyway) |
| cleanup | the replay retention (#515, #525): a map goes with the last replay file of its match (when the match is over and no frames are being built), a map no match row names after a day (an invite that never started), a dropped invite or a failed start drops its map at once |
| fallback | at most `GOW_MAPGEN_MAX_PENDING` maps are made or wait at once; past it, when no seed passes, when the worker dies or after `GOW_MAPGEN_WAIT_S`, the match plays a random pool map (`gow_maps_fallback_total`) |
| rating | none: such a map has `meta.symmetry = "none"`, and `MatchLifecycle.start` never rates one |

**Readiness.** A bot match answers `POST /api/bot-matches` when its map is made (the player is claimed meanwhile, a
second match is `409`). An invite has its map id at once and `InviteOut.map_ready: false` until the map is made; the
ready timer of a joined guest starts only then, and the second `ready` waits for the map before the match starts. No
tick runs before the map is there, since the match is created only with it.

**Cost** (this machine, Apple M-series, in the Linux container of `deploy/app.Dockerfile`; a map of 30 to 55 nodes):
generate 0.1 to 6 s (the filter: 1 to 150 attempts of about 40 ms), bake 1.7 to 3.5 s, validate 0.3 to 0.7 s, preview
0.4 to 0.6 s; in all 2.5 to 11 s, typically 5 s. The worker's memory peaks at 0.4 to 0.65 GB while it bakes (it was
0.9 GB before #884 freed the large arrays early, with the same pixels), and the process exits after its map.

### Fairness

`gow_maps.fairness` measures a map, the check `fairness` compares it with `validate.toml`. `gow-maps score <files>` and
`gow-maps generate` print the scores. Standard library only, like `gow_maps.generate`: stage 2 runs them on the server, and
`lint-imports` holds both to that. All times are by `travel_ticks` unless said otherwise. A node belongs to the capital that
reaches it first (first reach; a tie to neither, the capitals to neither).

The pool maps are mirrored, so they score 0 on every gap and the top of the scale on the mirror scores: a gap
threshold cannot be read off them. The thresholds below are the owner's "approximate equality", sized against what a pool map
holds (8 to 12 cities and 5 to 13 provinces on a side, 450 to 624 ticks between the capitals), and the mirror thresholds sit
well away from the pool.

| Metric | What it is | Pool maps | Threshold |
|---|---|---|---|
| first reach | cities, provinces, VP on each side | 8..12, 5..13, 10..15 on a side, gap 0 | gap at most 2, 3, 2 (`max_city_gap`, `max_province_gap`, `max_vp_gap`) |
| front | the contested zone: the nodes the capitals reach within `contested_ticks` (60) of each other; from each capital the time to its nearest node of the zone | 249..324 ticks, gap 0 | gap at most 15% of the larger (`max_front_gap_pct`) |
| front by terrain | the same at the terrain speed (`terrain.speed_pct`, mechanics.md, section 4; the percents repeat `mvp-7` in `validate.toml`, the validator may run without a ruleset) | 224..297, gap 0 | gap at most 20% (`max_front_terrain_gap_pct`) |
| approaches | the roads of each capital | 3 and 3 | gap at most 1, at least 3 (`max_approach_gap`, `min_approaches`) |
| charges | the start charges of a side (`start_charged + start_stock`) plus the warehouses (city 3, province 1, capital 6) of the nodes within half of the time between the capitals | 57..80, gap 0 | gap at most 15% (`max_charge_gap_pct`) |
| start | units, charged units and stock of each side, and the stock of each capital | equal | must be equal (`estimate.py` and `smart.py` of the bots rely on it) |
| mirror shift | the mean distance from the rot180 image of a node to the nearest node, in percent of the node spacing `sqrt(width * height / nodes)` | 7..21% | at least 30% (`min_mirror_shift_pct`) |
| mirror roads | the roads whose rotated ends (the nearest nodes) have a road | 100% | at most 55% (`max_mirror_roads_pct`; a planar graph of this density lands near 45% by chance) |
| mirror profile | no coordinates: nodes with a partner of the same degree and the two distances (in roads) to the capitals swapped | 100% | at most 70% (`max_mirror_profile_pct`) |
| dead ends | nodes outside the 2-core: the dead-end lanes | 0 | 0 (`max_dead_end_nodes`) |
| lane | the longest run of linked nodes with two roads | 1 | at most 2 (`max_lane`) |
| capital depth | roads from a capital to the nearest node of the contested zone or of the other side | 4..5 | at least 4 (`min_capital_depth`) |
| cut nodes | nodes whose removal separates the capitals (articulation points between them) | none | none (`max_cut_nodes`) |
| choke | how much longer the way between the capitals gets without its most important node | 1..24% | at most 30% (`max_choke_pct`) |

### The generator

`gow-maps generate --seed N [-o maps/gen] [--bake]` (`gow_maps.generate`; the map id is `gen<version>-<seed>`, so one seed under
another `GENERATOR_VERSION` is another map). The size comes from the seed: 29 to 55 nodes, about 50 000 square units a node, an
aspect of 1.3 to 1.75. An attempt:

1. **Land:** value noise minus the pits of an archetype (`coast`, `gulf`, `inland`, `straits`, `corners`, `lakes`) on a 16 unit
   grid; the lowest cells are water; islands sink, ponds dry up.
2. **Nodes:** Poisson-disc points at least 92 units from that water and 128 from each other, denser where a noise says so.
3. **Roads:** Delaunay on the integer points, without roads over water or longer than 345 units, pruned to 1.5 to 1.72 roads a
   node while no road becomes a bridge of the graph, two roads of a node stay about 29 degrees apart, and no node has more than
   five. Planar by construction.
4. **Capitals:** the pair with the most equal access, 430 to 680 ticks apart, one of the best four, never within 1.5 spacings of
   each other's rotation.
5. **Attributes:** terrain from a ridge field and a wet field, `kind` and VP from a settlement field. These are patches over the whole
   map, not node pairs; the sides get equal counts by taking the top of each side. Both sides start with the same list of kinds
   (5 own nodes on the smallest map, 8 at 50 nodes, as in the pool). `border_permille` moves 60 toward the lower end per terrain
   step (a long approach to high ground), `max_level` is 3 on the fastest ways to the key cities, 2 elsewhere.
6. **Geography:** `src/<id>.geo.json` with water cells (circles packed into the water, with radii that keep the water at 17 to
   25 percent) and two to four river springs on high ground; the baker does the rest as for a hand-made map.
7. **Filter:** `fairness`, then the next attempt of the seed (up to 400). The check `geography` needs the baker, so
   `generate` without `--bake` cannot run it: 1 of the 28 seeds baked so far failed it (a river across a road away from the
   border point), and such a seed is thrown out.

An attempt takes about 40 ms in pure Python, a seed a median of 30 attempts (about 1 s; 1 of 60 seeds found no map in 400
attempts), the bake 2 to 3 seconds. Determinism: a seed gives the same map on any platform, a test pins a `map_hash`. Only
`+ - * /`, `sqrt` and `Random.random()` touch the numbers (`sin`, `sum()` of floats and `Random.shuffle` differ between platforms
or Python versions).

## General rules

- **All numbers are integers.** `1.0`, `"1"` and `true` instead of a number: a load error.
- **Node and edge ids equal their position in the list:** `nodes[i].id == i`, `edges[i].id == i`.
  Inside the simulation nodes and edges are stored by these ids.
- **An unknown or missing key:** an error (a typo does not pass silently).
- MVP players: `0` and `1`. "No owner": `null`.
- Coordinates: integer "world units" in the rectangle `[0, width] × [0, height]`, the `y` axis points down
  (as on a screen).

A load error names the file and the field: `maps/x.json: nodes[3].vp: expected an integer, got 1.5`.

## Structure

```json
{
  "meta":   {"name": "line3", "version": 1, "symmetry": "rot180", "width": 400, "height": 200},
  "nodes":  [{"id": 0, "name": "Stonetown", "x": 100, "y": 100, "terrain": "mountains", "vp": 1,
              "kind": "capital", "capital_of": 0, "start_owner": 0, "start_units": 3,
              "start_charged": 3, "start_stock": 4}],
  "edges":  [{"id": 0, "a": 0, "b": 1, "max_level": 3, "travel_ticks": 30, "border_permille": 500}],
  "mirror": {"nodes": {"0": 2, "1": 1, "2": 0}, "edges": {"0": 1, "1": 0}}
}
```

### `meta`

| Field | Type | Meaning |
|---|---|---|
| `name` | string `[A-Za-z0-9_-]+` | the map id (`map_id` in the replay and the protocol) |
| `version` | integer ≥ 1 | the map revision; raised on any edit |
| `symmetry` | `"rot180"` \| `"none"` | the symmetry type. `rot180`: players and nodes swap places per the `mirror` table (DEC-27, item 6); a geometric rotation of the picture is not required. `none`: a generated map without a mirror, the table is the identity (#771) |
| `width`, `height` | integers ≥ 1 | the size of the world |

### `nodes[]`

A node: a city with a warehouse or a province, a node without a city (`kind = province`, DEC-23, item 2;
mechanics.md, section 9).

| Field | Type | Meaning |
|---|---|---|
| `id` | integer | equals the index in the list |
| `name` | string | the node name (DEC-23, item 4): 1..24 characters with no leading or trailing spaces, unique within the map, not translated (the length, the spaces and the uniqueness are checked by the validator, `names`) |
| `x`, `y` | integers | position, `0 ≤ x ≤ width`, `0 ≤ y ≤ height` |
| `terrain` | `plains` \| `forest` \| `mountains` | terrain: plains, forest, mountains (mechanics.md, section 4) |
| `vp` | integer ≥ 0 | VP for holding the city; for a capital the multiplier from the ruleset (DEC-03) |
| `kind` | `capital` \| `city_large` \| `city_medium` \| `city_small` \| `province` | the node kind; capacity by kind from the ruleset `capacity.by_kind`, it does not depend on roads (DEC-22) |
| `capital_of` | `null` \| `0` \| `1` | whose capital it is |
| `start_owner` | `null` \| `0` \| `1` | the owner at the start |
| `start_units` | integer ≥ 0 | the starting garrison: the number of units |
| `start_charged` | integer, `0..start_units` | how many of them are charged |
| `start_stock` | integer ≥ 0 | the starting warehouse stock in charges (DEC-26: not more than the warehouse capacity of the node kind, DEC-43 item C); in a match only the capital keeps it (DEC-41, item 9) |

The loader additionally requires:

- each player has exactly one capital, and at the start it belongs to them;
- `kind = capital` if and only if `capital_of` is not `null` (DEC-23, item 3);
- a province has `vp = 0` and no garrison and no warehouse (DEC-23, item 2);
- a **neutral node** (`start_owner: null`) is empty: `start_units`, `start_charged` and `start_stock`
  are 0. There are no neutral garrisons in the MVP.

### `edges[]`

A road is undirected. There is at most one road between two nodes, loops are forbidden.

| Field | Type | Meaning |
|---|---|---|
| `id` | integer | equals the index in the list |
| `a`, `b` | node ids | the ends of the road, `a ≠ b` |
| `max_level` | integer, `1..3` | the last upgrade level (DEC-22, DEC-23, item 6); all roads start at level 1 with no type, there is no starting level in the map. Since #894 no rule reads it: road upgrades were removed with the old rulesets; the field stays in the format (the validator, the symmetry check and the map hash still read it) |
| `travel_ticks` | integer ≥ 1 | the base travel time in ticks; the speed by terrain zones of the edge ends comes from the ruleset (`terrain.speed_pct`, mechanics.md, section 4) |
| `border_permille` | integer, `100..900` | the border point in thousandths of the length from end `a`, 500: the middle (DEC-23, item 5): splits the edge into halves for vision (DEC-21) and into terrain zones for speed (mechanics.md, section 4) |

`travel_ticks` agrees with the drawn length of the road; the tolerance is checked by the validator (section "Validator").
The old fields `base_width`, `max_width` and `base_capacity` are rejected by the loader as unknown keys
(DEC-23, item 9).

### Node kinds in the MVP maps (before DEC-23)

The three MVP maps (`artery`, `web`, `pass`; since #372 test fixtures in `maps/fixtures/`, no longer in the server pool) got `kind` from their previous data by one rule (a replacement of `base_capacity` and of the contribution
of roads, #238); the DEC-27 maps of #266 replaced them in the pool. They got the node names (DEC-23, item 4)
in #366, and their border points are all 500:

- the capital: `capital`;
- the other nodes by the number of roads (degree): 1-2 roads `city_small`, 3-4 `city_medium`, 5 and more
  `city_large` (the former capacity of a supplied city was about `3 + degree`);
- a node with `vp >= 2` goes up one class (not above `city_large`): a valuable city holds more.

Roads: all start at level 1 (the former starting widths 2 and 3 are dropped), `max_level` equals the former
`max_width`, but not more than 3.

### `mirror`

The symmetry table: `nodes` and `edges` map an id to the id of the mirrored object: players swap
places, the rules for them are the same (symmetry of the rules, not of the picture: DEC-27, item 1). Keys: ids as
strings (this is how JSON works), values: integer ids.

- The table is complete (every node and edge has a mirror) and is an involution: `m(m(x)) == x`.
- A node may be mirrored to itself; its `start_owner` and `capital_of` are `null`.
- The mirror of the edge `(a, b)` connects `m(a)` and `m(b)`; its `border_permille` is equal to the original if
  its end `a` equals `m(a)`, otherwise `1000 − border_permille`; an edge mirrored to itself has 500
  (DEC-23, item 7).
- A mirrored node has the same attributes (`kind`, `terrain`, `vp`, the starting fields), while `capital_of` and
  `start_owner` pass to the other player; `name` is its own. **The coordinates are free** (DEC-27, item 1):
  the requirement `(width − x, height − y)` is gone, the picture of the sides may differ.
- A map with `meta.symmetry = "none"` (#771) has an identity table, and the three rules above do not apply to it.

The loader checks only completeness and involutivity. The match of attributes, edge ends and border
points is checked by the validator (MAP-02).

**Why the simulation needs the table.** Tie-breaks between nodes go through `MapDef.node_key(player, node)`:
for player 0 it is the node id, for player 1 it is the id of the mirrored node (`AGENTS.md`, section 4.1, rule 6).
So a decision in a mirrored position is mirrored too, and the mirror test (SIM-05) does not miss
an advantage of one side introduced by the id order.

## Map type in the client

The client reads the map file by the type `MapFile` from `apps/client/src/protocol.gen.ts`. The type is generated
from the model `gow_protocol.mapfile.MapFile` (PRO-02, #45): it describes only the shape and the types of values,
while references, ranges between fields and the mirror are checked by the loader. The test
`packages/protocol/tests/test_mapfile.py` checks that the model and the loader agree on all maps
of `maps/` and `packages/sim/tests/maps/`. If you change the format: fix the loader and the model and regenerate the types
(`AGENTS.md`, section 3).

## `MapDef` in code

`gow_sim.maps` (standard library only):

- `MapDef(meta, nodes, edges, mirror_nodes, mirror_edges, incident)`: a frozen dataclass; `nodes` and
  `edges` are tuples of `NodeDef` and `EdgeDef`, the index equals the id; `incident[n]` is the ids of the edges of node `n`
  in ascending order.
- `MapDef.capital(player)`, `MapDef.node_key(player, node)`, `EdgeDef.other(node)`.
- `load_map(path)` and `parse_map(data)`; errors: `MapFormatError` (a subclass of `ValueError`).
- `map_to_data(map)`: the inverse of `parse_map` (data in the file format); this is how a map enters the canonical state and `state_hash()` (SIM-02).

## Validator

`uv run gow-maps validate <files>` (MAP-02, #14) loads each map and checks the design.
Output: `OK <file>` or `FAIL <file>` with a list of `[check] message`; exit code 1 if
at least one map failed. Patterns like `maps/*.json` are expanded by the CLI itself too (bash passes
an unmatched pattern as is). The thresholds: `tools/maps/src/gow_maps/validate.toml`, another file:
`--config <path>`.

| Check | What it requires |
|---|---|
| `format` | the map loads with `gow_sim.maps` (types, references, ranges, including `border_permille` 100..900 and `max_level` 1..3, empty neutral nodes, provinces and capitals per DEC-23, items 2, 3) |
| `size` | `min_nodes..max_nodes` nodes (45..55, DEC-27, item 5); **off by default** (`size_check = false`), enabled with a thresholds file of its own via `--config` |
| `names` | every node has a name of 1..24 characters with no leading or trailing spaces, names do not repeat (DEC-23, item 4) |
| `connectivity` | the graph is connected |
| `planarity` | roads do not cross or overlap, a road does not pass through someone else's city, cities have different coordinates (the actual coordinates are checked: with free coordinates this is the main protection against crossings, DEC-27, item 5) |
| `symmetry` | the `mirror` table swaps the players: the same attributes of nodes (`kind`, `terrain`, `vp`, the starting fields) and edges (`max_level`, `travel_ticks`), the owner and the capital pass to the other player, the ends of a mirrored edge are mirrored; the coordinates and the names are not compared (DEC-27, item 1). With `meta.symmetry = "none"`: only that the table is the identity (#771) |
| `border` | `border_permille` of the mirrored edge with direction taken into account: equal to the original if the end `a` of the mirror equals `m(a)`, otherwise `1000 − border_permille`; an edge mirrored to itself has 500 (DEC-23, item 7). Not for `meta.symmetry = "none"` |
| `fairness` | only for `meta.symmetry = "none"` (#771): equal access of the two capitals, not a mirror in disguise, no dead-end lanes, no capital next to the front, no single node between the capitals; the section "Fairness" |
| `degree` | a node has at most `max_degree` (5) roads |
| `disjoint_paths` | from each capital to each node with `vp ≥ 2` at least 2 paths with no common roads |
| `neutral_space` | at least 20% of the nodes have no starting owner and have distances to the two capitals (in roads) differing by at most 1 |
| `travel_ticks` | the drawn length agrees with the time (DEC-27, item 4): `|travel_ticks − e| × 100 ≤ 15 × e`, `e = length × 30 / 100` (100 world units = 3 seconds), the tolerance is at least 1 tick; mirrored edges with the same `travel_ticks` therefore differ in length by no more than the tolerance |
| `geography` | only for a map with an authored geography `maps/src/<id>.geo.json` (DEC-36): land contact of two areas only along a road, one piece per area around its node, roads cross water only at a bridge, nodes at least `water_clearance` (60) from a sea or a lake, the vector file `maps/geo/<id>.json` up to date; details in the section "Format changes under DEC-36" |

The path and distance checks run only on a connected graph. The "bad" fixtures for each
check: `tools/maps/tests/fixtures/`; for `geography`, the worked examples of DEC-36 in `tools/maps/tests/test_geo.py`
(hand-made label grids for the failing rows: the baker itself never produces them).

## Half of a map and mirroring

The maps of the pool are drawn as a half, the script builds the other half (MAP-03, #15; the halves of the three fixtures lie in `maps/fixtures/src/`, those maps are frozen and the script is not run on them):

```bash
uv run gow-maps mirror maps/src/<name>.half.json -o maps/<name>.json
```

The script builds a mirrored copy of the half (by default by a rotation of 180°, or at given
coordinates), stitches the roads across the central strip, assigns ids, names, border points and
the `mirror` table, writes the map and at once runs it through the validator (exit code 1 if the map
failed; the file stays for analysis).

The format of the half (`maps/src/<name>.half.json`):

```json
{
  "meta":  {"name": "diamond", "version": 1, "width": 400, "height": 400},
  "nodes": [{"id": "capital", "name": "Stonetown", "mirror_name": "Flintburg", "x": 100, "y": 200,
             "terrain": "mountains", "vp": 1, "kind": "capital", "capital_of": 0, "start_owner": 0,
             "start_units": 3, "start_charged": 3, "start_stock": 4},
            {"id": "north", "name": "Cliff", "mirror_name": "Crag", "x": 200, "y": 100,
             "mirror_x": 190, "mirror_y": 310, "terrain": "forest", "vp": 2, "...": "..."},
            {"id": "ford", "name": "Ford", "self_mirror": true, "x": 210, "y": 190, "...": "..."}],
  "edges":       [{"a": "capital", "b": "north", "max_level": 3, "border_permille": 400}],
  "cross_edges": [{"a": "capital", "b": "north", "max_level": 3}]
}
```

- `meta` without `symmetry`: a finished map always has `"rot180"` (swapping players per the `mirror` table).
- `nodes[].id`: a string label, unique within the file; the other fields are as in the map, plus:
  - `mirror_name`: the name of the copy (DEC-23, item 8), required for a node that has a copy;
  - `mirror_x`, `mirror_y` (optional, DEC-27, item 6): the coordinates of the copy; without them the copy is at
    `(width − x, height − y)`, as in the halves before DEC-27;
  - `self_mirror: true` (optional): the node is mirrored to itself at any coordinates and is not
    copied; it has only `name`, without `mirror_name`, `mirror_x`, `mirror_y`. Without the flag, the node mirrored to
    itself is the node at the exact center `(width / 2, height / 2)` without `mirror_x`, `mirror_y` (halves before
    DEC-27; there is at most one such node).

  In a copy `capital_of` and `start_owner` pass to the other player, the other attributes are the same.
- `edges[]`: a road between two nodes of the half; the copy connects their mirrors with the same
  `border_permille`. A road between two nodes mirrored to themselves is mirrored to itself: it is
  written once and requires `border_permille` 500.
- `cross_edges[]`: a road across the central strip from node `a` to the **mirror** of node `b`; its copy
  goes from `b` to the mirror of `a` and gets `1000 − border_permille`. With `a == b` the result is one
  road mirrored to itself: `border_permille` is only 500, otherwise a script error. A node
  mirrored to itself is connected with ordinary `edges`.
- `border_permille` of roads is optional (500); the script always writes it into the finished map.
- `travel_ticks` of roads may be omitted: the script computes it from the average drawn length
  of the road and its copy (under a rotation the lengths are equal) with the same scale as the validator
  (`travel_ticks_per_100_units`), rounded to the nearest integer, not less than 1.

Ids in the finished map: the nodes of the half that have a copy get `0..k−1` in file order, the nodes mirrored to
themselves follow in file order, the mirror of node `i` is `N−1−i`. The roads of the half that have a copy get
`0..e−1`, their copies `e..2e−1`, then the roads between nodes mirrored to themselves; then
`cross_edges` in order, each followed by its own copy.

## Preview

`uv run gow-maps preview maps/*.json` (MAP-04, #16) draws next to each map
`maps/<name>.preview.png` (matplotlib): roads (an ink line on a dark casing: level 1 at the start, a faint
underlay: `max_level`), the border point (a circle on the road), nodes (color: the starting owner, shape:
terrain, star: capital), labels with `id`, the node kind (S, M, L: small, medium, large city; P:
province), the name, `vp` and the starting garrison "charged/units". The preview is for people only; the map pool
and its character are described in [`maps/README.md`](../../maps/README.md).

Since #839 it has the Engraved look of the match: the dark plate, the map's own baked background (`<id>.bg.webp`,
darkened) under the graph, ink labels on a dark halo, the own and enemy colours of the match. It reads the background,
so it runs after `bake`. The PNG is a palette of the picture's colours plus the exact colours of the pieces (about
250 KB).

## The map pool on the server

At start the server (`gow_server.maps`, SRV-01) loads all `maps/*.json` into the pool and all `maps/gen/*.json` into the
generated group (no other subdirectories: `maps/src/` holds the halves, `maps/fixtures/` the MVP maps, `maps/menu/` the menu maps) through `load_map`. The file name must match `meta.name`:
`maps/<id>.json`. A broken map or a name mismatch stops the server from starting.

The map background (MAP-05) lies next to it: `maps/<id>.bg.webp`. It is optional; the PNG previews from MAP-04 (other
files) are not served by the server. How the background works and how to rebake it: the section "Map background" below.

| Request | Response |
|---|---|
| `GET /api/maps` | `[{id, version, width, height, background_url}]`, ordered by `id`; `background_url` is `null` if there is no background |
| `GET /api/maps/{id}` | the map file as is (geography is public: mechanics.md, section 10) |
| `GET /api/maps/{id}/background.webp` | the background (`image/webp`) or 404 |

## Map background

`uv run gow-maps bake maps/*.json` (MAP-05, #70) draws next to each map `maps/<id>.bg.webp` and its thumbnail
`maps/<id>.thumb.webp` (#839: the same picture 200 px wide, about 2 KB, under the graph of a map card in the lobby
and the replays; the client bundles the thumbnails of the pool and of `maps/gen/`).
The background is for looks only: the game rules do not read it. The baker is built on `numpy` and `Pillow` (the owner's decision
2026-10-21, `ui-style.md`, 26.3; before #344 it was a PNG on the standard library).

- **Size and anchoring.** The picture is exactly `width × height` pixels: one pixel per world unit, the top
  left pixel at the point `(0, 0)`, the `y` axis down. The client places the background sprite at `(0, 0)` with the size
  `meta.width × meta.height` in world coordinates, the same ones in which it draws nodes and roads.
- **Grid.** The field is computed on a grid with a step of 4 world units (as in the Pygame prototype), so `width` and
  `height` of a map with a background are multiples of 4; otherwise `bake` fails with an error. The grid sets only the layout of biomes; the picture is drawn at full
  resolution and does not show 4 × 4 squares.
- **No water without a geography** (DEC-27, item 3, #269, [superseded by DEC-36] for the maps with a geography): a map
  without `maps/src/<id>.geo.json` has no sea, shallows or beach, every cell is land. A map with one gets water cells
  and rivers as area borders (DEC-36, #537): the section "Format changes under DEC-36" above.
  Previously the background was computed as metaballs from the map generator of the Pygame prototype (the tag `v0-pygame-prototype`):
  the density of cities and roads with a threshold and wave noise, below the threshold the sea, a narrow strip above the threshold
  the coast. The owner finds water confusing. The jungle color from the prototype (turquoise) was replaced
  by green so that it does not read as water.
- **The biome of an area.** The area of a node: the cells closest to it (Voronoi with borders warped by noise).
  The biome follows the node terrain: plains: steppe or savanna, forest: forest or jungle, mountains:
  rocks or snow. The variant within a terrain and the shade are chosen by the humidity and detail noise from the prototype.
- **Texture T2 "Thinning"** (`ui-style.md`, 26.3; mockup `mockups/map-style-2.html`, prototype
  `mockups/src/map_textures.py`). Flat ground of a biome in two tones in patches; between biomes a narrow strip
  of color (about 14 px) that "wanders" with the noise; details (tree crowns, grass tufts, stones, snow strokes)
  thin out and shrink toward the edge of the biome; a little grain on top. No shadows, light or relief. The biome layout
  is the same as in the former baker (the `bake_cells` field did not change).
- **Determinism.** The noise is set by a seed from the `blake2b(name:version)` of the map (or `--seed`): the offsets
  of the biome field from `random.Random`, the texture fields from `numpy.random.default_rng`. Two runs in the same environment give
  the same pixels. The background need not be symmetric (DEC-27, item 1): each cell looks for its own nearest node.
- **Format and weight.** Lossy WebP (`quality=85`, `method=6`). The file is not larger than 0.5 MB (now
  230 to 300 KB; `bake` refuses if larger), baking one map takes up to 10 s. The file bytes depend on the
  libwebp of the Pillow wheel, so the test `tools/maps/tests/test_bake.py` compares the committed backgrounds with a fresh bake
  by the mean colors of 16 × 16 blocks with a tolerance, not byte by byte: a map edit without `bake` breaks CI.
- **Client stamps.** A map with baked details gets no `TerrainView` stamps (about 1300 sprites):
  they stay only on maps without a background and on a map whose background failed to load.

## The menu map

`maps/menu/valley.json` (#474, the sketch MM1 "Valley" of `docs/design/mockups/menu-background.html`) is drawn
behind the screens before a match. It is an ordinary map in this format, built from its half
`maps/menu/src/valley.half.json` (`uv run gow-maps mirror maps/menu/src/valley.half.json -o maps/menu/valley.json`)
and validated, previewed and baked with the pool (`mise run maps:validate`, `maps:preview`, `maps:bake`), but it is not
in the pool: the server never serves it, the queue, the lobby and the tournaments never play on it. The client imports
the JSON at build time (`apps/client/src/app/menuMap.ts`), so the start screen draws it on the first frame without a
request. Its world is 800 × 560: at a window of 1280 × 800 the client's `layoutScene` shows it at one px per unit,
the own capital `Highhold` right of the text rail and `Stormcrown` in the fog; no node is above the line that keeps
the title bar and the corner chip clear. 25 nodes, the road of the valley `Highhold`, `Mossgate`, `Fordham`, `Wickwood`,
`Stormcrown` runs straight down the middle. Since #866 it is drawn behind the entry screen and its opening scene
only (the five fights of `introBattles.ts` stand on its roads), laid over the whole window.

`maps/menu/marches.json` (#866) is drawn behind every other screen before a match: a generated map (`gow-maps generate
--seed 112`, renamed from `gen1-112` with its geography `maps/menu/src/marches.geo.json`; `meta.symmetry = "none"`, so
the validator runs its fairness check), 48 nodes on a world of 1904 × 1256, baked and previewed with the rest. The
client lays it over the whole window, a tenth larger than it takes to cover it, and the window crops it: the enemy
capital `Kelpcrown` in the fog at the right, the front through the middle, the own capital `Eaglekeep` under the shade
at the left. The owners the client draws on both menu maps are a front in mid game, not the start owners of the files
(`apps/client/src/app/menuMap.ts`).

## Test maps

Tiny maps for the simulation scenario tests live in `packages/sim/tests/maps/`:

| File | What it is |
|---|---|
| `line3.json` | a line of 3 nodes: capital, neutral city, capital |
| `diamond.json` | a 1v1 diamond: two capitals and two neutral cities on the flanks (`vp` 2) |
| `choke.json` | a "pass": each player has a capital and a forward city, between them the only passage through a mountain node of the ridge |

The client dev screen (CLI-03, #59) bundles `maps/*.json`, the fixtures `maps/fixtures/*.json` and these test maps
(`apps/client/src/map/bundledMaps.ts`), so editing them also triggers the `web` check in CI.
