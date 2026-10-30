# Replay frames file format

The frames file (SRV-07, #54): the full match state twice a second plus all events. The viewer
(CLI-10, #66) reads only it: re-simulation in the browser is not needed, and the file does not break when `SIM_VERSION`
or the ruleset changes. The file shows **the real state of both players without the fog of war**:
the server serves it only after the match. Since #598 every frame also carries **what each player saw**
(the key `v`, section "Vision"): the fog part of `project()` for that player and tick, so the viewer can
show the match "as player 1" or "as player 2" without computing vision (`AGENTS.md` 7.1).

Code: `gow_server.frames` (`build_frames`, `FORMAT`). The format version: the field `format` (now `1`);
the client must reject a file with an unknown `format`.

## Where it comes from

During the match the server writes the command log `data/replays/{id}.jsonl.gz` (`gow_sim.replay`,
`AGENTS.md` 4.5). After the match it re-simulates the log in a `ProcessPoolExecutor` (not in the event loop and
not in a thread), checks the state hash at every checkpoint of the log and writes
`data/replays/{id}.frames.json.gz`. If the hash does not match or the match was not played to the end, the file is not created, the log
stays for analysis. `matches.replay_path` holds the name of the frames file relative to `data/replays/`.
The log is not served outside: its header holds the secret `match_key`.

`GET /api/replays/{id}` (`id` = `matches.id`) serves the file as is (`Content-Type:
application/json`, `Content-Encoding: gzip`): the browser decompresses it itself, `fetch(url).then(r =>
r.json())` works without libraries. Replays of rated matches are public; the others only to the participants
(`Authorization: Bearer <token>`): 401 without a token, 403 to someone else's player.

Re-simulation takes seconds, and under load tens of seconds (a full 15-minute match: about 17 s
in a warm worker, about 26 s with the worker start; there is one worker, so builds go one after another).
So after the permission check the response tells three cases apart (#259):

| Response | When | Client |
|---|---|---|
| `200` and the file (`Cache-Control: private/public, no-cache`, `ETag`); `304` on a matching `If-None-Match` | the frames are on disk: the file from `matches.replay_path`, whose header (map, ruleset hash, number of ticks) matches the `matches` row | opens the replay |
| `202` `{"status": "preparing"}`, `Retry-After: 2`, `Cache-Control: no-store` | the match is still running (`matches.status = running`) or its frames are being built (`ReplayService` remembers the builds in progress) | shows the "Preparing the replay..." window and repeats the request with a growing pause |
| `410` | the match is over, there is no build, there is no file: the build failed (the hash did not match, no space), the server crashed in the middle of the build, the match was aborted (`aborted`) or the file was lost | the error "Replay is unavailable", does not retry |
| `404` | there is no match with this id | the error "Replay not found" |

A replay always belongs to its own match (#280). `matches.id` is unique only within one database: a new
database (a new volume, a deleted `gow.db`) counts from 1 again, while the browser remembers `/api/replays/1` of the previous
database. So: only the file from `matches.replay_path` is served (no guessing by `{id}`); a stale
`{id}.frames.json.gz` is deleted when a match with this id starts; the file header is checked against the `matches` row,
a mismatch is a `410`; the response goes with `no-cache` and an `ETag` made of the match number, the creation time of the
row and of the file (before, `max-age=3600, immutable` let the browser show the replay of someone else's match for an hour).

The state is derived without new DB columns: from `matches.status`, the file and the set of builds in progress in
the process memory. If the process crashes in the middle of a build, the log stays but is not rebuilt
(this is a `410`).

## Structure

One JSON object (gzip). All numbers are integers; CP in hundredths, the edge progress in thousandths (as in
`GameState`, `AGENTS.md` 4.1).

```json
{
  "format": 1, "sim_version": 1, "ruleset_hash": "...", "map_id": "artery", "map_hash": "...",
  "tick_hz": 10, "frame_every": 5, "ticks": 9000,
  "outcome": {"winner": 0, "reason": "vp"}, "vp": [31, 24], "state_hash": "...",
  "nicks": ["Danya", "Bot (normal)"],
  "map": { ...map format, docs/design/map-format.md... },
  "frames": [ {"t": 0, ...}, {"t": 5, ...}, ... ],
  "events": [ [1, "recruit", {"node": 3, "owner": 0}], ... ]
}
```

- `outcome.winner`: `0`, `1` or `null` (a draw); `reason`: `capital`, `vp`, `forfeit` and so on from
  `match_ended`.
- `vp`: the final points by player; `ticks`: the last played tick.
- `nicks` (optional, #598): the nicks of the sides by player id, as the match had them: the
  account's nick from `players`, a bot side (`match_players.bot`) as `Bot (<level>)` with the level
  of `POST /api/bot-matches` (`Bot (easy)`, `Bot (normal)`, `Bot (hard)`, `Bot (expert)`;
  `gow_server.replays.bot_nick`), a bot that is no level as `Bot`. `ReplayService` reads them from
  the `match_players` rows before the build; no key when the match has no row with both sides
  (files from before #598, a match without a database row). The nicks are not a secret: both
  players see them in `welcome` (`ui-style.md` section 15).
- `map`: the whole map (the same format as `maps/*.json`), the static graph for rendering. The file is
  self-contained: editing `maps/` does not affect it (`map_hash` is for reference). The map in the file is in the format
  that was current at the time of recording: files from before #366 have no `name` and `border_permille` (they had
  `base_width`, `max_width`), and the client then takes the border point in the middle of the edge (500).
- `frames`: tick `0`, then every `frame_every`-th tick (`tick_hz / 2`, that is 2 frames per second)
  and always the last tick of the match. The frame time in seconds: `t / tick_hz`.
- `events`: all events of the match in tick order, `[tick, kind, data]`; `data` is a flat object
  (`gow_sim.state.Event`). Since DEC-24 (`sim_version` 10) the event `fight` is replaced by
  `fight_started`, `fight_round` and `fight_ended` (a fight goes in rounds), `fight_group` is written at
  the end of a fight and when a group retreats. An event of tick `T` belongs to the state "after tick `T`": the frame
  `t = 5k` plus the events `5k < tick <= 5k + 5` describe the transition to the next frame.

## Frame

| Key | What | Value |
|---|---|---|
| `t` | tick | integer |
| `p` | players by id (0, 1) | `[cp, vp, stance, forfeited]`: CP in hundredths, `stance` a string, `forfeited` 0/1 |
| `n` | nodes by id | `[owner, warehouse, capacity, warehouse_cap]`: `owner` 0, 1 or `null`; `warehouse` charges in the warehouse; `capacity` the current capacity of the city for units (the client does not compute rules); `warehouse_cap` the places of the warehouse (DEC-26: `start_by_kind` plus the level, as `NodeView.warehouse_cap` of the live view; without `city_upgrades` the node capacity), `null` for a province. The fourth element was added in #556 (before it the viewer drew the node capacity as the warehouse, larger than the real one with `city_upgrades`); a record of three elements is an older file, the viewer then knows no places |
| `w` | road level by id (the name "width" stayed from the map format, DEC-22: 1..3) | integer |
| `g` | groups, in ascending `id` | a group object (below) |
| `k` | charge packets, by `id` | `[id, owner, edge, from_node, charges, depart_tick, arrive_tick]` |
| `i` | public intents, by `id` | `[id, owner, kind, origin, target]`, `target` may be `null` |
| `b` | ~~road construction by cities (DEC-16), by node id~~ **[superseded by DEC-28, #306]**: the server does not write the key (a road is not built by a city); it exists only in files of `sim_version` 3..14, the client reads it as construction of the edge `edge`; `FORMAT` stays 1 | `[node, edge, done_tick]`: city, edge, the tick of the level upgrade |
| `e` | road construction (DEC-28, `sim_version` 15 and newer), by edge id; no key while nothing is being built | `[edge, owner, done_tick]`: edge, player, the tick of the level upgrade |
| `r` | ~~road type by edge id (DEC-22)~~ **[superseded by DEC-26, #265]**: the server does not write the key (there is no road type); it exists only in files of `sim_version` 5..11, the client reads it and does not use it; `FORMAT` stays 1 | `none`, `fast` or `freight` |
| `v` | what each player saw (#598), `[player 0, player 1]`; no key in files from before #598 | a vision object per player, section "Vision" |
| `f` | fights in progress (DEC-24), by `id`; no key while there are no fights (and in files from before DEC-24, `sim_version` up to 10) | `[id, node, edge, point, attacker, start, next_round, [group, ...], [shots, losses, virtual_left, last_round]]`: `node` or `edge` (the other is `null`); `point` on an edge: the doubled meeting point in thousandths from end `a` (0..2000, a mark at the fraction `point / 2000`), in a node `null`; `attacker` in a node, otherwise `null`; the start tick and the tick of the next round; the ids of the fight's groups of both players. The ninth element (round data, #323) exists only in files written after #323 (a fight record of eight elements is an older file: the arena is empty). It holds pairs `[player 0, player 1]`: `shots` and `losses` (fight totals so far, `FightView.shots` and `losses`) and `virtual_left` (virtual shots left, `FightView.virtual_left`, DEC-32); `last_round` is `null` before the first round, otherwise `[tick, shots, virtual, spent, losses]` with a pair per player (`FightView.last_round`, same numbers as the `fight_round` event). The silent charges (`FightView.mute`) are not in the frames: the replay client builds them as zeros |

A group: `{"id", "o": owner, "u": units, "c": charged, "m": mode, ...}`, plus

- `"at": node` if the group stands in a node; or `"on": [edge, from_node, progress, back]` if it moves
  along an edge (`progress` 0..1000 from `from_node`, `back` 0/1: a bounce back, DEC-07);
- `"to": [node, ...]`: the remaining path of the order (the first element is the next node), if there is an order;
  `"pl": 1`: the order is scheduled.

Before DEC-16 (`sim_version` 2) a group had the key `"b": edge` (the group builds a road) and the mode `build`;
the viewer accepts old files and shows such a group in the mode `attack`.

`mode`: `attack`, `defense`. Nodes and edges go in the order of the map ids (`n[i]` is node `i`).
Keys that are not in the table (for example, the fog memory `vision_memory`) do not get into the file.

## Vision

`v[p]` is the fog part of the `PlayerView` that `gow_sim.view.project(state, rules, p, match_key)`
gave player `p` at the frame's tick: the snapshot `p` had in the live match. `gow_server.frames.vision_of`
copies it from the `PlayerView`, nothing is computed again (`apps/server/tests/test_replays.py` holds it
against `project()` on a whole match). The viewer builds the `NodeView` and `EdgeView` of a side from
it and must not decide any of it itself: which half of a road a figure is in, the zone level of a node,
the range of the units, what is remembered.

A record leaves out its trailing `null` elements: a missing element is `null` (a figure without
numbers is shorter, a node without a sighting is `["fog"]`). The levels (`detail`, `level`) are the
strings of `Detail`: `exact`, `range`, `presence`, `fog`.

| Key | What | Value |
|---|---|---|
| `n` | nodes by id (`n[i]` is node `i`), as `NodeView` | `[detail, seen, warehouse]`: `detail` the zone level (`NodeView.detail`); `seen` the sighting (below, `NodeView.seen`): this tick's unless `detail` is `fog`, for `fog` the last one remembered or `null`; `warehouse` the charges of the warehouse as the player saw them (`NodeView.warehouse`: own nodes and foreign nodes where an own group stands, DEC-35; otherwise `null`) |
| `e` | edges by id, as `EdgeView` | `[width, detail, half_a, half_b, figures]`: `width` the road level the player knew (`EdgeView.width`: in fog the last one seen, `VisionMemory.widths`, or 1); `detail` the road visibility (`presence` or `fog`); `half_a`, `half_b` the halves of the ends `a` and `b` as `[detail, seen]` (`HalfView`; `seen` as for a node: in `fog` the remembered one, without positions); `figures` (no element while there are none) the enemy figures on the edge (`EdgeView.enemy_groups`, DEC-33), sorted by id |
| `b` | the edges whose road build the player saw (`EdgeView.build` is not `null`: an own build always, an enemy one only while the edge is not in fog, DEC-17 item 5); no key while there are none | `[edge, ...]`; the tick of an own build is in the frame's `e`, an enemy build has none (`BuildView.done_tick` `null`) |

A sighting (`Sighting`): `[level, modes, units, charged, range, tick]`, `level` its zone level,
`modes` the distinct modes of the enemy groups seen (empty: none seen), `units` and `charged` the enemy
totals (only `exact`), `range` `[low, high]` of the enemy units (only `range`, `high` `null`: open).
`tick` is written only in `fog` (the tick of the remembered sighting); a place not in fog is seen in this
very tick, so its sighting tick is the frame's `t`.

A figure (`EnemyGroupView`): `[id, pos, toward_b, detail, mode, units, charged, range]`: `id` the opaque
id as a decimal string (63 bits, new every time the group comes out of the fog, DEC-33 detail 5; it
names no group of `g`), `pos` thousandths from the end `a`, `toward_b` 0/1, `detail` the level of its
half, `mode`, `units` and `charged` (only `exact`), `range` (only `range`). A group in a fight is not a
figure: the fight shows it (`f`).

What a side sees and is not in `v`, because the frame has it already, for both players alike or by
owner: its own groups and packets (`g` and `k` by owner; enemy packets are never seen, DEC-10 item 6),
its CP and stance (`p`), ownership, capacities and VP (public), intents (`i`, public) and fights (`f`:
both players are in each). Left out as in the full view: the countdowns, the recruit queue and the
barracks of own cities, the Defense and planned bonuses.

## Size

The budget of `AGENTS.md` 12: ≤ 2 MB for a full 15-minute match (DEC-22, 1801 frames). Measured: a match
of 9000 ticks on `web` (an MVP map, a fixture in `maps/fixtures/` since #372), bots rusher and reactive: about 47 KB (gzip; 1.9 MB of JSON before compression).

Round data of fights (#323) added 236 bytes to that match (47450 before, 47686 after). On other
full matches the growth is 0 to 249 bytes (`artery` 59874 and 60123, `ridge` 67538 and
67747). Worst case, six fights in each of the 1801 frames with random counters: about 380 KB.
The vision of both players (#598) adds about 100 to 150 KB (gzip) to a full match; measured on the
golden logs of `sim_version` 25 (9000 ticks, 1801 frames each), the same file without and with `v`:

| Log | Without `v` | With `v` | JSON before compression |
|---|---|---|---|
| `artery-mvp1` | 74.9 KB | 174.4 KB | 16.5 MB |
| `pass-mvp1` | 71.7 KB | 167.5 KB | 17.2 MB |
| `artery-mvp0` | 98.5 KB | 211.8 KB | 17.7 MB |
| `web-mvp0` | 98.6 KB | 246.6 KB | 22.1 MB |

The trailing `null` elements and the sighting tick of a place not in fog are left out for this: written
in full the same files are 495 to 740 KB. The build takes longer by the two projections per frame (in
the same worker, a full match about 10 to 15 s on the owner's laptop under load).

Deltas are not needed; if the format grows (more nodes, more groups), the size tests in
`apps/server/tests/test_replays.py` show it before a release.

## Viewing in the client

`apps/client/src/replay/`: `replayFile.ts` (parsing and the `format` check), `timeline.ts` (a frame into a
`SnapshotMsg` with full expansion; group and packet owners in separate tables),
`replayPlayer.ts` (`RenderSource`: pause, ×1/×4/×16, seeking, the CLI-02 interpolation),
`ReplayViewer.svelte` (the controls). The address: `/?replay=<match id>` (`replayUrl`), in a dev build
`/?replay=dev` plays the sample `siege.frames.json`. In a dev build `/?replay=dev-fights` plays `siege-fights.frames.json`: a recording with fights and round data (#323). The viewer shows the fights like a live match (arena, rounds, tracers): `shots`, `losses`, `virtual_left` and `last_round` of `FightView` come from the ninth element of the fight record (a record of eight elements, that is an old file, gives an empty arena); `mute` is built as zeros.

Loading: `loadReplayWhenReady` (`loadReplay.ts`) repeats the request while the server answers `202`
(pauses of 2 s, 3 s, 4.5 s, then 5 s; no longer than 5 minutes, then the error "The replay is taking too long to prepare"), and
`ReplayScreen` shows the "Preparing the replay..." window. `404`, `410`, `401`/`403` stop
the waiting at once, each with its own message. "Back" returns to the screen from which the replay was opened
(the result screen: `AppState.openReplay` / `closeReplay`); for a direct link `/?replay=<id>` "Back"
leads to `/`, and the token of the saved guest is taken from `localStorage`, so a player opens the
replay of their private match or of a match with a bot.

## Format change

A compatible addition (a new optional frame key or a new trailing element of a record) does not raise
`format`: a client that does not know it ignores it, and a new client tells an old file by the
missing field. This is how the keys `e` and `f` and the ninth element of the fight record (#323:
round data) were added; a fight record of eight elements is a file from before #323. The same for
the frame key `v` and the header key `nicks` (#598): a file without them is from before #598 (the dev
samples `siege.frames.json` and `siege-fights.frames.json` are such files), and the viewer then
offers no per-side view and shows "Player 1", "Player 2".

Any incompatible edit: a new `format`, and the server can write only the current one. Old files on
disk stay; the viewer client supports the versions that occur in `data/replays/`.
