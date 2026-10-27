# Replay frames file format

The frames file (SRV-07, #54): the full match state twice a second plus all events. The viewer
(CLI-10, #66) reads only it: re-simulation in the browser is not needed, and the file does not break when `SIM_VERSION`
or the ruleset changes. The file shows **the real state of both players without the fog of war**:
the server serves it only after the match.

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
  "map": { ...map format, docs/design/map-format.md... },
  "frames": [ {"t": 0, ...}, {"t": 5, ...}, ... ],
  "events": [ [1, "recruit", {"node": 3, "owner": 0}], ... ]
}
```

- `outcome.winner`: `0`, `1` or `null` (a draw); `reason`: `capital`, `vp`, `forfeit` and so on from
  `match_ended`.
- `vp`: the final points by player; `ticks`: the last played tick.
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
| `n` | nodes by id | `[owner, warehouse, capacity]`: `owner` 0, 1 or `null`; `warehouse` charges in the warehouse; `capacity` the current capacity of the city (the client does not compute rules) |
| `w` | road level by id (the name "width" stayed from the map format, DEC-22: 1..3) | integer |
| `g` | groups, in ascending `id` | a group object (below) |
| `k` | charge packets, by `id` | `[id, owner, edge, from_node, charges, depart_tick, arrive_tick]` |
| `i` | public intents, by `id` | `[id, owner, kind, origin, target]`, `target` may be `null` |
| `b` | ~~road construction by cities (DEC-16), by node id~~ **[superseded by DEC-28, #306]**: the server does not write the key (a road is not built by a city); it exists only in files of `sim_version` 3..14, the client reads it as construction of the edge `edge`; `FORMAT` stays 1 | `[node, edge, done_tick]`: city, edge, the tick of the level upgrade |
| `e` | road construction (DEC-28, `sim_version` 15 and newer), by edge id; no key while nothing is being built | `[edge, owner, done_tick]`: edge, player, the tick of the level upgrade |
| `r` | ~~road type by edge id (DEC-22)~~ **[superseded by DEC-26, #265]**: the server does not write the key (there is no road type); it exists only in files of `sim_version` 5..11, the client reads it and does not use it; `FORMAT` stays 1 | `none`, `fast` or `freight` |
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

## Size

The budget of `AGENTS.md` 12: ≤ 2 MB for a full 15-minute match (DEC-22, 1801 frames). Measured: a match
of 9000 ticks on `web`, bots rusher and reactive: about 47 KB (gzip; 1.9 MB of JSON before compression).

Round data of fights (#323) added 236 bytes to that match (47450 before, 47686 after). On other
full matches the growth is 0 to 249 bytes (`artery` 59874 and 60123, `ridge` 67538 and
67747). Worst case, six fights in each of the 1801 frames with random counters: about 380 KB.
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
round data) were added; a fight record of eight elements is a file from before #323.

Any incompatible edit: a new `format`, and the server can write only the current one. Old files on
disk stay; the viewer client supports the versions that occur in `data/replays/`.
