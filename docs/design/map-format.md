# Map format

A map is a JSON file in `maps/` (the server pool) or in `maps/fixtures/` (the three MVP maps `artery`, `web`, `pass`, kept as test fixtures since #372). The loader: `gow_sim.maps.load_map(path) -> MapDef` (MAP-01, #13).
The map design checks (connectivity, planarity, rule symmetry, names, border points,
neutral space) are run by the offline validator `uv run gow-maps validate maps/*.json maps/fixtures/*.json` (MAP-02, #14).

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
| `symmetry` | `"rot180"` | the symmetry type: players and nodes swap places per the `mirror` table (DEC-27, item 6); a geometric rotation of the picture is not required |
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
| `start_stock` | integer ≥ 0 | the starting warehouse stock in charges (DEC-26: with `city_upgrades.enabled` not more than the starting warehouse capacity of the node kind) |

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
| `max_level` | integer, `1..3` | the last upgrade level (DEC-22, DEC-23, item 6); all roads start at level 1 with no type, there is no starting level in the map |
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
| `symmetry` | the `mirror` table swaps the players: the same attributes of nodes (`kind`, `terrain`, `vp`, the starting fields) and edges (`max_level`, `travel_ticks`), the owner and the capital pass to the other player, the ends of a mirrored edge are mirrored; the coordinates and the names are not compared (DEC-27, item 1) |
| `border` | `border_permille` of the mirrored edge with direction taken into account: equal to the original if the end `a` of the mirror equals `m(a)`, otherwise `1000 − border_permille`; an edge mirrored to itself has 500 (DEC-23, item 7) |
| `degree` | a node has at most `max_degree` (5) roads |
| `disjoint_paths` | from each capital to each node with `vp ≥ 2` at least 2 paths with no common roads |
| `neutral_space` | at least 20% of the nodes have no starting owner and have distances to the two capitals (in roads) differing by at most 1 |
| `travel_ticks` | the drawn length agrees with the time (DEC-27, item 4): `|travel_ticks − e| × 100 ≤ 15 × e`, `e = length × 30 / 100` (100 world units = 3 seconds), the tolerance is at least 1 tick; mirrored edges with the same `travel_ticks` therefore differ in length by no more than the tolerance |

The path and distance checks run only on a connected graph. The "bad" fixtures for each
check: `tools/maps/tests/fixtures/`.

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
`maps/<name>.preview.png` (matplotlib): roads (a dark line: level 1 at the start, a light
underlay: `max_level`), the border point (a circle on the road), nodes (color: the starting owner, shape:
terrain, star: capital), labels with `id`, the node kind (S, M, L: small, medium, large city; P:
province), the name, `vp` and the starting garrison "charged/units". The preview is for people only; the map pool
and its character are described in [`maps/README.md`](../../maps/README.md).

## The map pool on the server

At start the server (`gow_server.maps`, SRV-01) loads all `maps/*.json` (without subdirectories:
`maps/src/` holds the halves, `maps/fixtures/` the MVP maps, which the server does not serve) through `load_map`. The file name must match `meta.name`:
`maps/<id>.json`. A broken map or a name mismatch stops the server from starting.

The map background (MAP-05) lies next to it: `maps/<id>.bg.webp`. It is optional; the PNG previews from MAP-04 (other
files) are not served by the server. How the background works and how to rebake it: the section "Map background" below.

| Request | Response |
|---|---|
| `GET /api/maps` | `[{id, version, width, height, background_url}]`, ordered by `id`; `background_url` is `null` if there is no background |
| `GET /api/maps/{id}` | the map file as is (geography is public: mechanics.md, section 10) |
| `GET /api/maps/{id}/background.webp` | the background (`image/webp`) or 404 |

## Map background

`uv run gow-maps bake maps/*.json` (MAP-05, #70) draws next to each map `maps/<id>.bg.webp`.
The background is for looks only: the game rules do not read it. The baker is built on `numpy` and `Pillow` (the owner's decision
2026-10-21, `ui-style.md`, 26.3; before #344 it was a PNG on the standard library).

- **Size and anchoring.** The picture is exactly `width × height` pixels: one pixel per world unit, the top
  left pixel at the point `(0, 0)`, the `y` axis down. The client places the background sprite at `(0, 0)` with the size
  `meta.width × meta.height` in world coordinates, the same ones in which it draws nodes and roads.
- **Grid.** The field is computed on a grid with a step of 4 world units (as in the Pygame prototype), so `width` and
  `height` of a map with a background are multiples of 4; otherwise `bake` fails with an error. The grid sets only the layout of biomes; the picture is drawn at full
  resolution and does not show 4 × 4 squares.
- **No water** (DEC-27, item 3, #269): the background has no sea, shallows or beach, every cell is land.
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

## Test maps

Tiny maps for the simulation scenario tests live in `packages/sim/tests/maps/`:

| File | What it is |
|---|---|
| `line3.json` | a line of 3 nodes: capital, neutral city, capital |
| `diamond.json` | a 1v1 diamond: two capitals and two neutral cities on the flanks (`vp` 2) |
| `choke.json` | a "pass": each player has a capital and a forward city, between them the only passage through a mountain node of the ridge |

The client dev screen (CLI-03, #59) bundles `maps/*.json`, the fixtures `maps/fixtures/*.json` and these test maps
(`apps/client/src/map/bundledMaps.ts`), so editing them also triggers the `web` check in CI.
