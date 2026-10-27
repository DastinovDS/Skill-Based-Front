# Security and fog leak audit (QA-04, #86)

An audit of the code, not of the documentation: every item was checked by reading the sources and, where possible, on a live
local stack or with a test. The mark `[x]` means "checked", and next to it is written how.

Run of 2026-10-07, `develop` at `2d521e9` (+ the fixes #196 and #198). Test bed: `compose.yaml`,
project `sbf-qa04`, `HTTP_PORT=8080 HTTPS_PORT=8443`, `SITE_ADDRESS=http://localhost`, `GOW_ENV=prod`,
ruleset `mvp-0`. Only local and static analysis, no external systems were touched.

## 1. Summary

There are no critical or high findings. Two medium ones were fixed in separate PRs, one low one was filed,
one low one was fixed in the PR of this audit, the rest was accepted as a deliberate risk.

| # | Severity | Finding | Status |
|---|---|---|---|
| F1 | Medium | The server log holds the client IP and the query string of every WebSocket handshake (a uvicorn line in `uvicorn.error`), contrary to AGENTS.md 5.3 and `docs/ops/legal.md` | fixed: #193, PR #198 |
| F2 | Medium (defense in depth) | `/internal/*` (drain, metrics) opens with the header `X-Forwarded-For: 127.0.0.1` from any node of the internal network: uvicorn trusts all proxies (`GOW_FORWARDED_ALLOW_IPS="*"`) | fixed: #194, PR #196 |
| F3 | Low | There is no limit on simultaneous connections from one address: a WebSocket lives 5 s without authentication before `hello`, and uvicorn has no `limit_concurrency` | filed: #199 (P2) |
| F4 | Low | The client dev dependency `source-map-js` 1.2.1 (GHSA-68fv-2mgg-jv7q, "high" in the database: DoS when parsing a foreign source map). Build and tests only (`postcss`, `jsdom`), it does not get into the prod bundle | fixed in this PR: lockfile, 1.2.2 |
| F5 | Info | `GET /api/replays/{id}` answers 404, 401 or 403: from a sequential id one can see whether an unranked match exists and whether its replay is ready (the content is not accessible) | accepted |
| F6 | Info | The headers `Server: Caddy` and `Server: uvicorn` reveal the software | accepted |
| F7 | Info | The FastAPI 422 response returns the client its own input (`input`); it does not get into the log, there are no tokens in HTTP bodies | accepted |
| F8 | Info | The guest token is stored in `localStorage`: XSS could read it. Mitigated by a strict CSP and the absence of `{@html}`/`innerHTML` (section 6) | accepted |
| F9 | Info | The `Origin` check compares `host:port` with `Host`, but not the scheme (`http` and `https` of one host are equal) | accepted |

Details of F1 and F2 (reproduction on the test bed) are in the issues #193 and #194.

## 2. Issue checklist

- [x] **The player view contains nothing hidden** (ids and counters included): section 3.
- [x] **Errors do not tell "does not exist" from "not visible"**: section 3.4.
- [x] **Tokens are not in URLs and not in logs**: section 4 (F1 was found, fixed).
- [x] **Origin check**: section 4.
- [x] **Rate limits**: section 5 (F3 filed).
- [x] **CSP**: section 6.
- [x] **Fuzzing of `ClientMsg`**: section 5.2, the new test `packages/protocol/tests/test_command_fuzz.py`.
- [x] **"Maphack": reading all WebSocket messages of a match**: section 3.5, an automatic recording through
  Caddy instead of eyes in DevTools (the messages are the same, the check is stricter).

## 3. Fog of war

### 3.1 The `project()` projection (`packages/sim/src/gow_sim/view.py`)

- [x] Own groups and packets: only `owner == player`; there are no foreign groups as entities, only `seen`
  of a place. Foreign packets are never visible (#112).
- [x] The warehouse only at `EXACT`; at `PRESENCE` `seen` has no numbers (`systems/vision.py:_sighting`);
  in `FOG` only the memory `vision_memory`, there are never numbers on edges.
- [x] `me` contains only own CP and stance; there are no CP, stance, production of the opponent in the view.
- [x] Intents: kind, from, to, creation tick; without the group id and size. There is no target of an ordinary order:
  an ordinary order has no intent.
- [x] Ids of groups, packets and intents: keyed blake2b with the secret `match_key` (32 bytes of
  `secrets.token_bytes`, not in the log, not in `repr`), 63 bits, 18-19 digits on the wire. The order in
  tuples is by the opaque id, not by the order of creation.
- [x] Owners and VP are public per DEC-04. Road levels per DEC-17 (#210) and DEC-22 (#238; there are no
  types after DEC-26, #265): exact only on an edge not in the fog, in the fog the last seen ones
  (`Sighting.width`), otherwise level 1; the barracks, warehouse and construction of foreign cities are hidden (DEC-26); the capacity is set by the kind of node and is public (DEC-22);
  the opponent's construction is visible only on edges not in the fog. Tests: `test_view.py` (`test_dec17_*`,
  a property test with changing levels and types in the fog), `test_properties.py` (`MatchMachine.fog`).
- Test coverage: `packages/sim/tests/test_view.py` (`test_property_nothing_leaks_from_places_out_of_sight`:
  a change of the hidden does not change the view), `test_properties.py` (`MatchMachine.fog`).

### 3.2 The wire: `snapshot_frame` (#155) against strict models

- [x] `gow_protocol.convert._view_data` writes exactly the fields of `view_to_wire` in the same order; the server
  fields `depart_tick`, `build_edge`, `back` do not get into the frame.
- [x] `test_convert.py` on real matches of the three MVP maps and a bot match compares the frame byte for byte with
  `encode(snapshot_msg(view))`, and the frame JSON with the canonical view; it searches every frame for the ids of enemy
  groups and packets in the id spaces of both players.
- [x] Outside `prod` the server validates every frame (`MatchManager(validate_snapshots=env != "prod")`).

### 3.3 Events, `ack`, `welcome`, `match_end`

- [x] The event policy: a whitelist (`convert.py`). `node_captured`, `vp_awarded`,
  `forfeit` are public; the fight events `fight_started`, `fight_round`, `fight_ended` (DEC-24) go to both
  participants in full: the shots of both sides (virtual ones separately), the burned charges and the losses
  (a revision of items I1 and I2 with DEC-29, #294; before it the opponent's fields `shots_*`/`virtual_*`/`spent_*`
  were cut out); everything else only to its own player; an unknown kind never leaves.
- [x] Entity ids in events (`group`, `new_group`, `packet`, `fight`) are turned into the player's opaque
  ids. The player view `fights` (DEC-24, item I1): for the opponent the fight totals (units and charged),
  the shots and losses of the sides for the fight and the last round of both sides (`last_round`); without the id of its groups
  and without the reserve of virtual shots (bonuses are not revealed before they are spent in a round).
- [x] `ack`: the path of an order is built only from the public owners, `travel_ticks` and terrain
  (`movement.find_path`); it does not depend on road widths, so the hidden widths (DEC-17) do not leak through the path.
- [x] `welcome`: `RulesetPublic`, `map_id`, `last_seq`; `match_end`: the outcome, VP, the own rating.

### 3.4 Identical answers for "does not exist" and "not visible"

- [x] `resolve()` knows only own groups; any foreign or invented id becomes a
  negative internal id, and `validate()` answers `NOT_FOUND_OR_HIDDEN`. `NOT_OWNER` is unreachable
  from the wire: the client does not receive opaque ids of enemy groups.
- [x] Nodes and edges are public, so `NOT_OWNER` for a node reveals nothing.
- [x] WebSocket: an unknown token, a foreign match, an unknown or finished match, a blocked
  account are closed with a single code 4004.
- [x] The new test `test_command_fuzz.py` checks on a live match that foreign and invented ids always give
  `NOT_FOUND_OR_HIDDEN`.

### 3.5 Maphack: all WebSocket messages of a match

A guest, a bot match (`pereval`, bot `normal`) through Caddy, a client on `websockets` reads and writes everything
DevTools would see, 300 seconds of play (3003 ticks) and a forfeit. 4430 messages were recorded: `welcome` 1,
`snapshot` 3003, `ack` 1137, `event` 288, `match_end` 1. Checks on every message:

- the set of keys of the view, groups, intents exactly as in the schema, `me` has only `cp` and `stance`;
- the warehouse is not `null` only at `EXACT`, at `PRESENCE` the enemy numbers are `null`, fresh `seen` with the current tick;
- all ids are 18-19 digits long, there are no short (sequential) ones; 34 own ids, 1 intent id;
- all ids in events were met among own groups and packets;
- the event kinds are only from the whitelist; the fight events have no opponent `shots_1`/`virtual_1`/`spent_1`
  (before DEC-24: `pool_1`/`unspent_1` in `fight`);
- the rejection codes are only about own actions (`CITY_FULL`, `NOT_ENOUGH_CP`, `RECRUIT_COOLDOWN`; after
  DEC-25 `QUEUE_FULL` instead of the cooldown).

No violations. This does not fully replace a look with the eyes in the browser DevTools, but at the message level
everything it would have shown was checked.

### 3.6 Replays

- [x] `GET /api/replays/{id}` serves only the frames file, and only when `matches.replay_path`
  is filled: `ReplayService.finalize` does this after a finished match. A running match answers 404.
- [x] The command log `{id}.jsonl.gz` with the `match_key` is never served; the file path is checked to
  lie inside `replays_dir`.
- [x] Unranked replays only to the participants (`Authorization: Bearer`), ranked ones are public by design.
  The status side channel: F5.

## 4. Authentication and logs

- [x] The token is `secrets.token_urlsafe(32)`, only its SHA-256 is in the DB (`models.Player.token_hash`, 32 bytes),
  the IP is not stored in the DB.
- [x] The token only in `hello` (WebSocket) and `Authorization: Bearer` (HTTP); in the client it never gets
  into a URL (`net/matchConnection.ts`, `api/http.ts`, `replay/loadReplay.ts`).
- [x] `hello` within 5 s (`ws_hello_timeout_s`), otherwise 1008; the token lookup in a thread (`asyncio.to_thread`).
- [x] Protocol models `extra="forbid"`, `strict`, `hide_input_in_errors=True`, the adapters too;
  `hello` errors are written only as a number (`exc.error_count()`); `HelloMsg.token` has `repr=False`.
  The guest HTTP models are also `extra="forbid"`, `hide_input_in_errors=True`.
- [x] The access log: the middleware writes the route template (`/api/matches/{code}/join`), without the query;
  the uvicorn access log is off. **F1**: the WebSocket handshake line from `uvicorn.error` wrote
  `IP:port` and the query string. Fixed with the filter `DropWebSocketHandshake` (#198), a test on a real
  uvicorn.
- [x] The `Origin` check: on the test bed `Origin: http://evil.example` gets 403 (and the record `ws origin
  refused` without an address), the own origin passes. Tests `test_ws.py`. The scheme is not compared: F9.
- [x] `X-Forwarded-For`: Caddy replaces the incoming header with the client address (on the test bed a forged
  `6.6.6.6` did not reach the server), so the per-IP guest limit cannot be bypassed by forging.
- [x] `/internal/*`: Caddy does not proxy it; on the test bed `/internal/metrics`, `/api/../internal/...`,
  `/api/%2e%2e/...`, `/api/..%2f...`, `/ws/../...` get the client `index.html`. **F2**: from inside the
  network `X-Forwarded-For: 127.0.0.1` passed the loopback check; now a request with a proxy header
  gets 404 (#196).

## 5. Input and limits

### 5.1 Limits (MOD-01 and earlier)

- [x] Guests: 10 per hour per IP (`SlidingWindowLimiter`); matches (invites and bots): 10 per 10 minutes per
  player; invites: 10 per minute per account; nick change: 3 per day; queue: 20 per minute.
- [x] WebSocket: a token bucket of 20 messages/s, burst 60, overflow: `RATE_LIMITED` and 1008;
  a message of at most 64 KiB (`ws_max_size`); the reliable message queue is 4096, a slow client
  is disconnected; `send` with a timeout.
- [x] Integers on the wire are limited to int32, match and file ids are checked with a regular expression.
- F3: there is no limit on simultaneous connections from an address (#199).

### 5.2 Fuzzing

- [x] The codec: Hypothesis in `packages/protocol/tests/test_validation.py` (any bytes, text, JSON and
  mutations of the fixtures give only `ValidationError`, the error contains no token).
- [x] New: `packages/protocol/tests/test_command_fuzz.py`. Any command that passed the schema (own ids,
  enemy ones in both spaces, random ones, numbers up to `MAX_INT`) goes the server's way to
  `Match.step` on a live match and gets an `ack`, without crashing the match. A match crash would end it for
  both and would let a player escape a defeat in a ranked match. Checked by mutation: without the node
  bounds check in `Recruit` the test fails with `KeyError`.

## 6. Client, CSP and headers

- [x] The CSP on the test bed equals `apps/client/csp.ts`: `default-src 'self'`, `script-src 'self'`
  (without `unsafe-eval`/`unsafe-inline`), `style-src 'self'`, `worker-src 'none'`, `object-src 'none'`,
  `base-uri 'none'`, `frame-ancestors 'none'`, `connect-src 'self'`.
- [x] `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` on
  statics and on `/api`; HSTS only over HTTPS and not for `localhost` (`deploy/Caddyfile`, checked by
  `deploy/check-caddy.sh` with `BASE_URL=https://...`).
- [x] There is no `{@html}`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval`,
  `new Function` in `apps/client/src` (except a comment about `pixi.js/unsafe-eval`); nicks are output by Svelte interpolation.
- [x] There are no `.map` files in the prod image.

## 7. Containers

Checked with `docker inspect` on the test bed:

| | user | rootfs | capabilities | no-new-privileges | ports on the host |
|---|---|---|---|---|---|
| `app` | 10001 (`gow`) | read-only, `/tmp` tmpfs | `cap_drop: ALL` | yes | none, only the network `internal` (`internal: true`) |
| `caddy` | 10002 (`caddy`) | read-only, `/tmp` tmpfs | `cap_drop: ALL`, the file capability removed | yes | 80/443 (on the test bed 8080/8443) |

The base images are pinned by version and digest.

## 8. Secrets and dependencies

- [x] Secrets in the history: a pass with regular expressions (private keys, AWS, GitHub, Slack, Discord,
  Google tokens, `sk-...`, JWT, assignments `password/secret/api_key/token = "..."`, credentials in URLs)
  over `git log -p --all`, 186 commits: 0 matches. Of the environment files only `.env.example` is in git,
  without secrets; `ALERT_WEBHOOK_URL` is passed to `curl` through stdin (`deploy/alert-forward.sh`).
- [x] Python: `uvx pip-audit` over `uv export --locked --all-packages` (170 packages): no vulnerabilities.
- [x] Client: `pnpm audit --prod`: no vulnerabilities; `pnpm audit` (with dev): F4, fixed.

## 9. How to repeat

```sh
export HTTP_PORT=8080 HTTPS_PORT=8443
docker compose -p sbf-qa04 up --build -d
# Origin and the log (F1): after the fix there are no lines '"WebSocket ' from uvicorn.error in the log
docker compose -p sbf-qa04 logs app | grep uvicorn.error
# /internal is not proxied: everywhere the client index.html, not the metrics
for p in /internal/metrics /api/../internal/metrics /api/%2e%2e/internal/metrics; do
  curl -s --path-as-is "http://localhost:8080$p" | grep -c gow_matches_active; done
# F2: from the internal network a forged XFF no longer opens /internal (404)
docker exec sbf-qa04-caddy-1 wget -qO- --header 'X-Forwarded-For: 127.0.0.1' http://app:8000/internal/drain
uvx pip-audit -r <(uv export --locked --all-packages --no-emit-workspace --no-hashes -q) --no-deps --disable-pip
pnpm -C apps/client audit
uv run pytest packages/protocol/tests/test_command_fuzz.py packages/protocol/tests/test_convert.py \
  apps/server/tests/test_internal.py apps/server/tests/test_ws.py
docker compose -p sbf-qa04 down -v
```

## 10. What remains to do by hand

- Viewing the WebSocket messages with the eyes in the browser DevTools (the automatic recording in section 3.5
  covers the same at the message level).
- The HTTPS mode (HSTS, certificate) on a real domain: `BASE_URL=https://<domain> deploy/check-caddy.sh`
  after the deployment (OPS-03, QA-03).
