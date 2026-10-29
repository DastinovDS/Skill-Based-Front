# Skill-Based Front

A competitive 1v1 strategy game in the browser, a match takes 10 to 15 minutes. The map is a graph of cities and roads.
A unit works like a "battery": charged or discharged. The capital produces charges, roads carry them,
a unit without a charge is defenseless.

Architecture: an authoritative Python server (FastAPI), a pure deterministic simulation,
fog of war on the server, a web client in TypeScript (Svelte 5 + PixiJS 8).

## Documents

- [`docs/design/mechanics.md`](docs/design/mechanics.md): the game rules, the only source of truth about the mechanics.
- [`AGENTS.md`](AGENTS.md): mandatory rules for agents and developers (structure, commands, determinism, process).
  `CLAUDE.md` pulls it in for Claude Code.
- [`docs/mvp/MVP_PLAN.md`](docs/mvp/MVP_PLAN.md): the MVP plan (milestones, estimates, risks);
  [`docs/mvp/MVP_ISSUES.md`](docs/mvp/MVP_ISSUES.md): all issues of the plan; `docs/mvp/issue_map.json`: ID → issue number.
- [`docs/adr/`](docs/adr/): architecture decisions, starting with [`0001-architecture.md`](docs/adr/0001-architecture.md).
- [`docs/design/archive/DESIGN-v1.md`](docs/design/archive/DESIGN-v1.md): the first version of the design document (outdated).

## Repository structure

```
packages/sim/        gow_sim       game rules: pure deterministic simulation
packages/protocol/   gow_protocol  Pydantic models of client <-> server messages, fixtures, test vectors
apps/server/         gow_server    FastAPI: HTTP (lobby, rating) + WebSocket (matches)
apps/bots/           gow_bots      bots and the tournament harness
apps/client/                       web client: TypeScript + Vite + Svelte 5 + PixiJS 8
tools/maps/          gow_maps      offline map tools: validator, mirroring, previews
maps/                              map pool of the server (JSON, previews); `maps/fixtures/`: MVP maps for tests
rulesets/                          rulesets (*.toml) and the archive of played ones by hash
docs/design/                       mechanics, map format, archive of the old design
docs/adr/                          architecture decisions
docs/balance/                      balance reports
docs/mvp/                          the MVP plan and the list of issues
docs/qa/                           checklists
deploy/                            Dockerfiles, Caddyfile, deployment scripts (compose.yaml is in the root)
mise.toml                          tool versions and all project commands (mise)
```

Python packages are collected in a uv workspace (the root `pyproject.toml`), each with a src layout:
`<directory>/src/<package>/__init__.py`. The Python version is pinned in `.python-version` (3.12).

## Quick start

Project commands and tool versions are set by [mise](https://mise.jdx.dev) (`mise.toml` in the root, the list of tasks and what they mean:
`AGENTS.md`, section 3). You need only mise and Docker (the latter for stacks and E2E); mise installs Node.js, pnpm and uv itself.

**macOS** (Homebrew):

```sh
brew install mise
mise trust                  # once per clone: mise does not run someone else's mise.toml without trust
mise install                # node, pnpm, uv of the project versions
mise run setup              # uv sync --locked and pnpm install (client, e2e)
```

**Windows:** `winget install jdx.mise` (or `scoop install mise`), then the same `mise trust`, `mise install`,
`mise run setup` in PowerShell. Almost all tasks are plain calls of `uv`, `pnpm` and `docker` without bash. The exceptions:
`stack`, `stack:reset`, `stack:agent` (they put the ruleset into the environment with `VAR=value command`, which needs a
POSIX shell) and `smoke` (it runs `deploy/smoke.sh`, which needs bash): run them from Git Bash. The rest has not been
tested on Windows (no machine); if something does not work, open an issue. There is no need to activate mise in the shell profile:
`mise run <task>` puts the right versions in place itself (for an ordinary terminal activation is handy: `mise activate`).

Daily commands:

```sh
mise tasks                  # all tasks with descriptions
mise run check              # ruff, pyright, lint-imports, maps, lint and check of the client and e2e
mise run test               # quick pytest (like the job py) and Vitest
mise run test:perf          # benchmarks and tick lag, sequential only
mise run test:slow          # long bot matches (the job py-slow)
mise run dev                # server (port 8000) and client (http://localhost:5173), Ctrl-C stops both
mise run test:py -- -k combat -vv   # tool arguments after --
```

Task output is quiet: you see only what the tools print. Errors are not hidden; `mise run -o prefix <task>`
labels the lines with the tasks. Once after cloning: `mise run hooks` (ruff before every commit).

Without mise the same checks run directly (you need [uv](https://docs.astral.sh/uv/), Node.js 24.15+ and the pnpm version from the
`packageManager` field in `apps/client/package.json`: `corepack enable pnpm` or `npm i -g pnpm`): the commands are in
`mise.toml`, one or two lines per task. If Python 3.12 is not installed, uv downloads it itself
(`uv python install 3.12`).

The protocol types in the client (`apps/client/src/protocol.gen.ts`) are generated from the Pydantic models of
`gow_protocol` and are not edited by hand. After changing the models: `mise run regen:protocol`.

The HTTP API types (`apps/client/src/api.gen.ts`) are generated from the OpenAPI of the FastAPI app
(`apps/server/openapi.json`) and are not edited by hand. After changing endpoints or their models: `mise run regen:api`
(both generations at once: `mise run regen`).

A production build of the client under the target CSP: `mise run preview`.

The client in development: `mise run dev` (`uv run gow-server` on port 8000 and `pnpm -C apps/client dev`); the Vite dev server
proxies `/api` and `/ws` to `127.0.0.1:8000`. Screens: the guest nick (the token is in `localStorage`, key `sbf.guest`, it never
reaches the address), the menu, a private match (an invite link `/?m=<code>`, the code is removed from the address
bar after it is read), a match with a bot, a match, the result with a replay. The old dev screen with a map and fixtures opens in a dev build
at `/?dev` and `/?scene=<id>`.

The client dev screen shows a map from the bundle (`maps/*.json`, the fixtures `maps/fixtures/*.json`, before MAP-04 the test maps
`packages/sim/tests/maps/`): choosing a map and "Fit map" in the panel, dragging moves the map,
the wheel zooms at the cursor. The FPS counter in the panel updates twice a second.

Interface language: English (`en`); the i18n mechanism stays, so more languages can be added later: a new locale is a new
dictionary with the same set of keys, an entry in `LOCALES` (`apps/client/src/i18n/locale.ts`) and `DICTIONARIES`, and a
legal content file. Any browser language and any saved `sbf.locale` value that is not supported (for example the former
`ru`) give English; the language selector is shown only while there is more than one locale. UI strings live in the
dictionaries in `apps/client/src/i18n/` (`en.ts` is the reference set of keys): a missing or extra key in a dictionary is a
type error, and `mise run check:i18n` checks that the markup has no strings outside the dictionaries and that the key sets
of all dictionaries match (part of `mise run test:client`).

## CI

GitHub Actions, `.github/workflows/ci.yml`. It runs on PRs into `develop` and `main`, on pushes to `develop`
and manually (`workflow_dispatch`).

**Required checks** (a PR is merged only when all are green):

| Check | What it does |
|---|---|
| `py` | `uv sync --locked`, `ruff check`, `ruff format --check`, `pyright`, `lint-imports`, `gow-maps validate`, `pytest -n auto -m "not perf and not slow"` (pytest-xdist, `HYPOTHESIS_PROFILE=ci`), then `pytest -m perf` sequentially (performance budgets), replays and `check_golden_frozen` |
| `web` | `pnpm -C apps/client install --frozen-lockfile`, the steps `protocol-drift` and `api-drift` (regenerate the protocol schema with `protocol.gen.ts` and the server OpenAPI with `api.gen.ts`, fail if they differ from the committed ones), `lint`, `check`, `test`, `build` |
| `docker` | `hadolint` for `deploy/*.Dockerfile`, then `deploy/smoke.sh`: build the images, `docker compose up`, checks through Caddy |

- The not required job `py-slow` runs in parallel with `py` on the same paths: `pytest -n auto -m slow`, that is the long
  tests of full matches (win shares of bots against `random_legal` over 3 and 10 seeds per map, diversity across seeds,
  the tournament harness on all bots). It does not delay the merge, but its red result must be analyzed before a release.
  The pytest marks: `perf` (timing measurements, not run under xdist), `slow` (long matches); both are described in
  `pyproject.toml`.
- The not required job `e2e` (QA-02, #84): builds the stack (`compose.yaml` + `e2e/compose.e2e.yaml`) and runs
  Playwright from `e2e/` in a real Chromium. It is not required for the same reason as `visual`: it builds both
  images a second time, renders WebGL in software, plays real 60-second matches (about 5 minutes), so it is
  the longest and the most sensitive to the environment; its red result is analyzed before a release. The artifact `e2e-results`
  (traces and screenshots of failed tests).
- The helper job `changes` looks at the changed paths in a PR. If a PR has no changes for `py`, `web` or `docker`
  (for example a documentation-only edit), the matching job is skipped, and GitHub counts a skipped job as
  successful: a required check does not hang waiting. If `changes` itself failed, all checks run in full.
  On a push to `develop` and on a manual run everything is checked.
- Versions: Python from `.python-version`, pnpm from the `packageManager` field, Node from the `engines.node` field
  in `apps/client/package.json`.

**Branch protection is not enabled.** For a private repository on the free plan the GitHub API answers
`403 Upgrade to GitHub Pro or make this repository public to enable this feature` (for both branch protection
and rulesets). While that holds, the rule "merge only when `py`, `web` and `docker` are green" rests on the process (AGENTS.md, section 11).
After moving to Pro or making the repository public: Settings → Branches → a rule for `develop`
(and `main`) with the required checks `py`, `web` and `docker`, without required reviews, without `enforce_admins`.

## Server

```sh
uv run gow-server            # http://127.0.0.1:8000/api/health
uv run gow-server --reload   # restart on code changes
```

The server always starts with one worker (`AGENTS.md`, section 5.1). Logs: JSON lines on stderr,
every request has a `request_id` (the header `X-Request-ID`). Settings: the `GOW_*` environment variables
(`apps/server/src/gow_server/settings.py`):

| Variable | Default | Meaning |
|---|---|---|
| `GOW_ENV` | `dev` | `dev`, `e2e` or `prod` |
| `GOW_HOST`, `GOW_PORT` | `127.0.0.1`, `8000` | the server address |
| `GOW_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `GOW_FORWARDED_ALLOW_IPS` | `127.0.0.1` | the proxy (Caddy) whose `X-Forwarded-*` headers are trusted |
| `GOW_MAPS_DIR` | `maps` | the map pool: `<id>.json` and an optional background `<id>.bg.webp` (not recursive: `maps/fixtures/` is not served) |
| `GOW_RULESET_PATH` | `rulesets/mvp-0.toml` (in `compose.yaml` and the `app` image: `mvp-1`) | the ruleset of the matches the server runs |
| `GOW_RULESETS_DIR`, `GOW_RULESETS_BUNDLED_DIR` | `rulesets/archive`, `rulesets/archive` | the archive of rulesets by hash: the server puts its own ruleset here on start (the directory must be writable; in the container `/data/rulesets` on the volume), the archive from the image is copied here if the directories differ. The server does not accept `test-short` when `GOW_ENV=prod` |
| `GOW_DATABASE_URL` | `sqlite:///data/gow.db` | the SQLite database (WAL); the path is relative to the working directory |
| `GOW_GUEST_RATE_LIMIT`, `GOW_GUEST_RATE_WINDOW_S` | `10`, `3600` | no more than N new guests from one IP per window in seconds |
| `GOW_MATCH_CREATE_RATE_LIMIT`, `GOW_MATCH_CREATE_RATE_WINDOW_S` | `10`, `600` | MOD-01: no more than N created matches (invites and bot matches together) per player per window |
| `GOW_QUEUE_RATE_LIMIT`, `GOW_QUEUE_RATE_WINDOW_S` | `20`, `60` | MOD-01: no more than N entries into the matchmaking queue (`POST /api/queue`) per player per window |
| `GOW_QUEUE_WINDOW_BASE`, `GOW_QUEUE_WINDOW_PER_S`, `GOW_QUEUE_WINDOW_MAX` | `100`, `5`, `400` | MM-01: the matchmaking rating window `base + k·wait` (seconds) with a cap (mechanics.md, section 19) |
| `GOW_QUEUE_PASS_S`, `GOW_QUEUE_CONFIRM_S` | `1`, `15` | MM-01: no more than one matchmaking pass per N seconds; the time to confirm a found pair |
| `GOW_QUEUE_BOT_OFFER_S`, `GOW_QUEUE_STALE_S` | `60`, `15` | MM-01: after how many seconds of waiting to offer a bot; a player whose client is silent for that many seconds leaves the queue |
| `GOW_NICK_CHANGE_RATE_LIMIT`, `GOW_NICK_CHANGE_RATE_WINDOW_S` | `3`, `86400` | MOD-01: no more than N nick changes (`PUT /api/me/nick`) per player per window |
| `GOW_LOGIN_IP_RATE_LIMIT`, `GOW_LOGIN_IP_RATE_WINDOW_S` | `20`, `600` | #374: no more than N login attempts (`POST /api/login`) from one IP per window |
| `GOW_LOGIN_NICK_RATE_LIMIT`, `GOW_LOGIN_NICK_RATE_WINDOW_S` | `10`, `600` | #374: no more than N login attempts to one nick (by `nick_key`) per window |
| `GOW_PASSWORD_RATE_LIMIT`, `GOW_PASSWORD_RATE_WINDOW_S` | `5`, `3600` | #374: no more than N password settings and changes per player per window |
| `GOW_SCRYPT_N`, `GOW_SCRYPT_R`, `GOW_SCRYPT_P`, `GOW_SCRYPT_MAXMEM` | `32768`, `8`, `1`, `67108864` | #374: the `hashlib.scrypt` parameters of new password hashes (memory is about `128·N·r` bytes, `MAXMEM` must be larger); a hash stores its own parameters |
| `GOW_SCRYPT_CONCURRENCY` | `3` | #413: at most this many scrypt runs at once (about 32 MiB each); a login or password change over it gets `503` with `Retry-After` at once |
| `GOW_NICK_BLOCKLIST_FILE` | empty | MOD-01: a file of additional forbidden words for nicks (one word per line, `#` is a comment); in the container `/data/nick-blocklist.txt` |
| `GOW_MAX_REQUEST_BODY_BYTES` | `32768` | SRV-01: the largest HTTP request body in bytes; more gets `413` before any parsing (by `Content-Length` and by counting a streamed body). Caddy adds its own 64 KB cap on `/api/*` |
| `GOW_CALIBRATION_MATCHES` | `5` | DEC-34, #414: rating-changing matches of a password account before its rating is shown and it counts for opponents (calibration) |
| `GOW_EARLY_RESIGN_S` | `180` | DEC-34: a surrender or disconnect before this match time (seconds) gives the winner no rating change |
| `GOW_RESIGN_WINDOW_S`, `GOW_RESIGN_BAN_SECOND_S`, `GOW_RESIGN_BAN_THIRD_S`, `GOW_RESIGN_BAN_LATER_S` | `86400`, `300`, `1800`, `7200` | DEC-34: repeated resigns in rated matches within the window ban the player from the queue: the 2nd for `SECOND` seconds, the 3rd for `THIRD`, the 4th and later for `LATER` (the 1st: no ban) |
| `GOW_OPPONENT_LIMIT`, `GOW_OPPONENT_LIMIT_WINDOW_S` | `3`, `86400` | DEC-34: at most N rated matches between the same two accounts per window, the later ones are unrated |
| `GOW_INVITE_TTL_S` | `1800` | the lifetime of an invite to a private match (seconds) |
| `GOW_READY_TIMEOUT_S` | `120` | SRV-09: the time to get ready after a guest joins an invite; after that the invite is withdrawn (no-show) |
| `GOW_MAX_MATCHES` | `30` | #412: at most this many matches run at once (the AGENTS.md section 12 budget for one core); past it a new match is refused with `503` |
| `GOW_MAX_BOT_MATCHES` | `10` | #412: of them at most this many against a bot; `0` turns bot matches off; `503` when full |
| `GOW_BOT_CONNECT_TIMEOUT_S` | `15` | #412: a bot match nobody connected to within this time is dropped as never started (no replay, saved `aborted`) |
| `GOW_WS_ALLOWED_ORIGINS` | `[]` | a JSON list of `Origin`s, other than the site itself, that may open the match WebSocket |
| `GOW_WS_HELLO_TIMEOUT_S`, `GOW_WS_SEND_TIMEOUT_S` | `5`, `5` | the wait for `hello`; a send longer than this: the client is not reading, disconnect |
| `GOW_MONITOR_INTERVAL_S` | `30` | OPS-04: the period of the tick lag check (the alert threshold is 10% of the tick period) |
| `GOW_RECONNECT_WINDOW_S`, `GOW_PAUSE_MAX_S` | `60`, `60` | DEC-05: the time to reconnect before a technical defeat (the `Forfeit` command in the log); the maximum of a player's single pause in a private match |
| `GOW_WS_MSG_RATE`, `GOW_WS_MSG_BURST` | `20`, `60` | the message token bucket of one connection (per second, burst); more than that: flood, disconnect |

The database: SQLite, models in `gow_server/models.py`, Alembic migrations in `gow_server/migrations/versions/`.
The server applies migrations on start; by hand: `uv run alembic -c apps/server/alembic.ini upgrade head`.
A schema change: edit the models, then
`uv run alembic -c apps/server/alembic.ini revision --autogenerate -m "<what>"` and check the migration file.

HTTP API: `GET /api/health`, `GET /api/maps` (the list), `GET /api/maps/{id}` (the map file),
`GET /api/maps/{id}/background.webp` (the background, if there is one). The schema: `/docs` on a running server.

The match WebSocket: `/ws/match/{id}` (`gow_server/ws.py`, AGENTS.md, section 5.3). The `Origin` must be
the site itself (`Host`) or one from `GOW_WS_ALLOWED_ORIGINS`, otherwise 403. The first message is `hello` with
the guest token. Close codes: 4001 another protocol version, 4004 no such match (or the token is someone else's,
unknown), 4009 the same player opened a new connection, 1008 no `hello`, flood or the client is not reading,
1000 after `match_end`.

Guest identity (ID-01):

- `POST /api/guest` with the body `{"nick": "..."}` → `201 {"player_id", "token"}`. The token is shown once,
  the database holds only its SHA-256. `409`: the nick is taken, `422`: the nick failed validation, `429`: the guest limit per IP.
- Requests on behalf of a player: the header `Authorization: Bearer <token>` (example: `GET /api/me`).
  A token in the URL is not accepted and is not written to logs. No token or a wrong one: `401`.
- An account (#374) is a guest with a password. `POST /api/account/password {password, old_password?}` (with a token) sets
  a guest's password or changes it (`old_password` is needed if a password already exists) → `200 {player_id, token}`: the token is
  new, the old one stops working. `403 wrong password`, `422` the password is not 10..128 characters after NFKC.
  `POST /api/login {nick, password}` → `200 {player_id, token}` of the same player (the previous token stops
  working); `401 wrong nick or password` is the same for an unknown nick, a guest without a password and a wrong
  password; `403` blocked; `429` limits per IP and per nick. `GET /api/me` → `{player_id, nick, has_password}`.
  A `422` response does not repeat the submitted values (`input`). There is no password recovery, reset with `gow-admin reset-password`.
- `GET /api/me/active-match` → `{match_id, map_id}` of the player's running match or `null` (#189). With it the client
  returns to the match after a page reload: a WebSocket with the same token within the reconnect window (DEC-05).
- A nick: 3-16 characters after NFC normalization; letters of any alphabet, digits, `_` and `-`. Spaces, punctuation,
  emoji and "empty" filler letters are forbidden. Uniqueness is case-insensitive: the column
  `nick_key = nick.casefold()` with a unique index (`Straße` and `STRASSE` count as one nick).
  The client shows a nick only as text (`AGENTS.md`, section 7.4).

## Docker

The production stack: `compose.yaml` in the root, images in `deploy/`. You need Docker with Compose v2.

```sh
cp .env.example .env              # optional: without .env the game comes up on http://localhost
docker compose up --build -d      # http://localhost, http://localhost/api/health
deploy/smoke.sh                   # build, start and check the stack (the CI job `docker` does the same)
deploy/check-caddy.sh             # only the headers, cache and routes of an already running stack
docker compose logs -f app        # server logs (JSON lines)
docker compose down               # stop; data stays in the volumes
GOW_RULESET_PATH=rulesets/mvp-0.toml docker compose up -d   # the stack on another ruleset (mvp-1 by default)
# a 60-second match (the ruleset test-short) for a manual check and E2E: docs/qa/manual-match.md
docker compose -f compose.yaml -f e2e/compose.e2e.yaml up --build -d --wait
```

mise tasks for stacks (`AGENTS.md`, section 3; ports 80/443 are taken on the owner's machine, so the tasks have their own):

| Task | For whom | What it does |
|---|---|---|
| `mise run stack [ruleset]` | owner | the production stack (project `skill-based-front`) on `http://localhost:8080`, HTTPS 8443, `SITE_ADDRESS=:80`, the default ruleset is `mvp-1` |
| `mise run stack:reset [ruleset]` | owner | the same from scratch: `down`, removal of the volume `gow-data` (database and replays), `up` |
| `mise run stack:agent [ruleset]`, `stack:agent:down` | agents | their own stack (project `sbf-agent`, `http://localhost:18080`), does not touch the owner's stack |
| `mise run smoke` | both | `deploy/smoke.sh` on the project `sbf-agent`, the stack is removed at the end |
| `mise run e2e` | both | its own stack `sbf-e2e` (`http://localhost:18082`, ruleset `test-short`), Playwright, the stack is removed |

Parallel agents on one machine set different `SBF_AGENT_PROJECT`, `SBF_AGENT_HTTP_PORT`, `SBF_AGENT_HTTPS_PORT`
(for `e2e`: `SBF_E2E_*`). Direct `docker compose ...` without `-p` lands in the project `skill-based-front`.

| Service | Image | What it does |
|---|---|---|
| `caddy` | `deploy/caddy.Dockerfile`: a client build (Node, pnpm `--frozen-lockfile`) and Caddy with static files | the only public service (80/443): serves the client, proxies `/api/*` and `/ws/*` to `app` |
| `app` | `deploy/app.Dockerfile`: uv (`uv sync --locked --no-dev`), only the packages `gow-server` needs | the server, one uvicorn worker; port 8000 only on the internal network |

- **Data:** the volume `gow-data` is mounted at `/data` of the `app` container: SQLite (`/data/gow.db` with WAL files)
  and replays (`/data/replays/`). The server applies migrations on start. Everything the server writes to disk must
  live in `/data`: the root file system of the container is read-only. `/app/data` leads to `/data`,
  so settings with a default path relative to the working directory (`data/...`) also land in the volume.
  Do not delete the volumes `caddy-data` (TLS certificates, the ACME account) and `caddy-config` without need.
  `docker compose down --volumes` deletes the database.
- **Network:** `app` is connected only to the network `internal` with no way out, its port is not published to the host.
  That is why `GOW_FORWARDED_ALLOW_IPS=*`: the `X-Forwarded-*` headers come only from Caddy, and Caddy replaces the
  `X-Forwarded-For` sent by the client with the real address.
- **Security:** both containers run as non-root (uid 10001 `app`, uid 10002 `caddy`), with `cap_drop: ALL`
  and `no-new-privileges`. Caddy listens on 80/443 without `CAP_NET_BIND_SERVICE` thanks to
  `net.ipv4.ip_unprivileged_port_start=0` in `compose.yaml`.
- **Base images** are pinned by version and digest in `deploy/*.Dockerfile`; how to update them is written there.

Variables (`.env`, sample `.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `SITE_ADDRESS` | `http://localhost` | the site address for Caddy: `http://localhost` without TLS (local, e2e), `https://localhost` with local TLS, a domain name turns on automatic HTTPS (the "Caddy" section) |
| `HTTP_PORT`, `HTTPS_PORT` | `80`, `443` | ports on the host, for example `HTTP_PORT=8080` if 80 is taken |
| `APP_MEM_LIMIT` | `1g` | the memory limit of the `app` container (SRV-01) |
| `GOW_ENV`, `GOW_LOG_LEVEL`, `GOW_GUEST_RATE_LIMIT`, `GOW_GUEST_RATE_WINDOW_S`, `GOW_RECONNECT_WINDOW_S`, `GOW_PAUSE_MAX_S`, `GOW_MONITOR_INTERVAL_S` | `prod`, `INFO`, `10`, `3600`, `60`, `60`, `30` | server settings (the "Server" section); `e2e` only for a Playwright run |
| every other `GOW_*` setting of the table in the "Server" section except the container paths | the default of that table | passed through by `compose.yaml` since audit SRV-07 (`apps/server/tests/test_compose.py` keeps the list and `Settings` in step); a new server setting is added to `compose.yaml` in the same change |

Only the variables listed in `compose.yaml` reach `app` (`Settings` forbids unknown fields):
a new server setting for production is added both there and in `.env.example`.

### Caddy

`deploy/Caddyfile` (OPS-02, #81):

| Path | What it does | Cache |
|---|---|---|
| `/api/*` | a proxy to `app:8000`, compression | the server's headers |
| `/ws/*` | a WebSocket proxy to `app:8000`; on `caddy reload` open connections live for up to 15 more minutes (`stream_close_delay`, a match lasts 12) | none |
| `/assets/*` | Vite build files with a hash in the name, zstd/gzip compression; no file: 404 | `public, max-age=31536000, immutable` |
| the rest | `index.html` and files from `apps/client/public`; an unknown path serves `index.html` (`try_files`) | `no-cache` (an ETag check on every load) |

- **Headers on all responses:** `Content-Security-Policy` from `apps/client/csp.ts` (including `frame-ancestors 'none'`),
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (camera, microphone,
  geolocation, payments, USB are off). The CSP is not copied by hand: the `caddy` image generates `/etc/caddy/csp.caddy`
  from `csp.ts` at build time, and `deploy/check-caddy.sh` compares the served header with `csp.ts`.
- **TLS:** with a domain in `SITE_ADDRESS` Caddy gets and renews a Let's Encrypt certificate itself (the volume `caddy-data`)
  and redirects HTTP to HTTPS. `Strict-Transport-Security: max-age=31536000` is sent only over HTTPS and
  never for `localhost`/`127.0.0.1` (otherwise the browser starts demanding HTTPS from all local projects).
- **Local TLS:** `SITE_ADDRESS=https://localhost` turns on Caddy's internal CA (the browser warns about a
  self-signed certificate, it is not put into the trust store). If 80/443 are taken:
  `SITE_ADDRESS=https://localhost HTTP_PORT=8080 HTTPS_PORT=8443 docker compose up -d`, then
  `BASE_URL=https://localhost:8443 deploy/check-caddy.sh`. The redirect from HTTP leads to port 443.
- **Checks:** `deploy/check-caddy.sh` (headers, cache, compression, routes; read-only, suitable for production too:
  `BASE_URL=https://game.example.com`) and `deploy/check-ws-reload.sh` (the match WebSocket `/ws/match/...`
  survives `caddy reload`: after the reload the server answers on the same connection with code 4001 to a `hello`
  of an old version; no match or guest is needed, but the script reloads Caddy through `docker compose exec`).

### Server, deploy and backups

VPS preparation, the first deploy, rollback, backups and restore: `docs/ops/deploy.md` (OPS-03, #82).

```sh
deploy/deploy.sh origin/main      # on the server: build, predeploy backup, start by healthcheck, rollback on failure
deploy/backup.sh                  # online backup of the volume gow-data into $BACKUP_DIR (./backups by default)
deploy/restore.sh <archive>       # restore (stops app)
HTTP_PORT=8080 HTTPS_PORT=8443 deploy/deploy-test.sh   # locally: deploy, rollback, backup and restore
```

What the following issues will add: draining matches on deploy (after SRV-02, #47); metrics and alerts
(OPS-04, #83).

## E2E

`e2e/`: Playwright against the real stack (QA-02, #84). Its own package (`e2e/package.json`, its own lock file):
the client needs Svelte and Vite, E2E needs only Playwright and TypeScript, and they do not depend on the client build
(the tests see it only through the browser). The `@playwright/test` version is the same as in `apps/client` (visual tests).

```sh
mise run e2e                                     # all at once: Chromium, its own stack sbf-e2e on :18082, tests, the stack is removed
mise run check:e2e                               # prettier and tsc
```

The same by hand (the stack on default ports):

```sh
pnpm -C e2e install --frozen-lockfile
pnpm -C e2e exec playwright install chromium     # once
docker compose -f compose.yaml -f e2e/compose.e2e.yaml up --build -d --wait   # the stack; HTTP_PORT=8080 if 80 is taken
E2E_BASE_URL=http://localhost:8080 pnpm -C e2e test   # http://localhost by default
```

`e2e/compose.e2e.yaml` turns on `GOW_ENV=e2e`, the ruleset `test-short` (a 60-second match), a reconnect window and a
pause of 10 seconds each and a large guest limit: the E2E stack must not be used as production.

The tests (`e2e/tests/`), each with its own guests in isolated browser contexts:

| File | What it checks |
|---|---|
| `invite-match.spec.ts` | two guests: an invite, "Ready", three orders each (a move, a scheduled move, a stance), a match to the end by the timer, a consistent result, "Watch the replay" for both, playback, pause and position; separately a pause (the server sends no snapshots), a socket drop with reconnection and a surrender |
| `bot-and-pages.spec.ts` | a match with a bot and a surrender; the production build renders the nick form without page errors, the language, the legal pages |

Orders on the map are clicked on the real canvas: the coordinates are computed by `e2e/support/player.ts` with the same camera and
layout functions as the client (`apps/client/src/render/camera.ts`, `layout.ts`), and the acceptance of an order is checked by the `ack` in
the socket log (the socket goes through `page.routeWebSocket`, the client and the server talk as usual). One test per
match, no retries (`retries`): a false pass would hide instability.

## Pygame prototype

The first prototype (the old design: five resources, buildings, three unit types, combat through damage and armor) no longer
lives in the working tree. It is kept in the tag `v0-pygame-prototype` of this repository
(`git show v0-pygame-prototype --stat`, `git checkout v0-pygame-prototype`) and in the repository
`DastinovDS/Game-of-War`. The new simulation does not reuse this code; the map generator formulas
were moved to `tools/maps/src/gow_maps/bake.py` (MAP-05).

The first version of the Skill-Based Front design document is in `docs/design/archive/DESIGN-v1.md`
(in the prototype repository the file was not tracked by git and was copied separately from the working copy).
