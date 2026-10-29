# AGENTS.md: instructions for agents and developers

AI agents (Claude Code, Codex and others) and people read this file before any work in the repository.
For Claude Code, the repository root has a `CLAUDE.md` with a single line: `@AGENTS.md`.

**The rules here are mandatory.** If a task requires breaking one of them, stop and describe the conflict
in an issue or a PR instead of working around the rule silently.

---

## 0. Before you start

1. Read the whole issue: tasks, **acceptance criteria**, "out of scope", dependencies. One issue, one PR.
2. Read the relevant section of `docs/design/mechanics.md`. It is the only source of truth about the game rules; DEC-issue decisions are recorded there with the status [accepted].
3. **Do not invent rules.** If a rule is not described or is ambiguous:
   - use the default from the matching DEC-issue;
   - if there is no such DEC, do not guess: open an issue with the question, leave `# TODO(#<number>)`, and list the question in the PR description.
4. **Expected values in tests come from `mechanics.md` and the DEC tables, not from the output of your code.** A test rewritten to match the code's result checks nothing.
5. A new dependency (Python or npm) only with a justification in the PR description.
6. Code, identifiers, comments, commits, documentation, issues and PRs: English.
7. The Pygame prototype lives in the tag `v0-pygame-prototype` (and in the repository `DastinovDS/Game-of-War`); it is not in the working tree.
8. Orchestrator sessions (they plan the work and launch executor agents) also read `docs/process/orchestration.md`.

---

## 1. The project in brief

A competitive 1v1 strategy game in the browser, a match takes 10 to 15 minutes. The map is a graph of cities and roads.
A unit is a "battery": charged or discharged. Each charge is one "shot": it cancels an enemy charge
or kills one enemy unit. The capital produces charges, roads carry them, a unit without a charge is defenseless.

Architecture:

- **The server is authoritative.** All logic runs on the server; the client only draws and sends intents.
- **Fog of war on the server.** Each player receives only what they can see.
- **The simulation is a pure deterministic library** in Python, used by the server, bots, replays and tests.

---

## 2. Repository structure and boundaries

```
packages/sim/        gow_sim       game rules: pure deterministic simulation
packages/protocol/   gow_protocol  Pydantic models of client <-> server messages, fixtures, test vectors
apps/server/         gow_server    FastAPI: HTTP (lobby, rating) + WebSocket (matches)
apps/bots/           gow_bots      bots (gow_bots.bots) and the tournament harness
apps/client/                       TypeScript + Vite + Svelte 5 + PixiJS 8
e2e/                               Playwright E2E against the real stack (its own package, compose.e2e.yaml)
tools/maps/          gow_maps      validator, mirroring script, previews and backgrounds of maps (offline)
maps/                              map pool of the server (JSON, previews, backgrounds); `maps/fixtures/`: MVP maps, test fixtures outside the pool
rulesets/                          rulesets (*.toml) and the archive of played ones by hash
docs/design/                       mechanics.md, map format, archive
docs/adr/  docs/balance/  docs/qa/ decisions, balance reports, checklists
deploy/                            Dockerfiles, Caddyfile, deployment scripts (compose.yaml is in the root)
```

**Boundaries** (checked by `lint-imports` and the ruff rule TID251):

| Package | May import from the project | Third-party dependencies | Must not |
|---|---|---|---|
| `gow_sim` | none | standard library only | `time`, `random`, `secrets`, `uuid`, `asyncio`, `socket`, `threading`, `subprocess`, `multiprocessing`, `concurrent`, `os.environ`, `os.urandom`, `datetime.now`; file I/O outside `maps.py`, `ruleset.py`, `replay.py`; any project package |
| `gow_protocol` | `gow_sim` | `pydantic` | `gow_server`, `gow_bots`, `gow_maps` |
| `gow_bots.bots` | `gow_sim.view`, `gow_sim.commands`, `gow_sim.maps`, `gow_sim.ruleset` | none | import `gow_sim.state`, `gow_sim.systems`, `gow_sim.match` directly (otherwise a bot sees hidden information) |
| `gow_bots` (harness) | all of `gow_sim` | `matplotlib` (reports only) | `gow_server`, `gow_protocol`, `gow_maps` |
| `gow_server` | everything above | `fastapi`, `uvicorn`, `sqlalchemy`, `alembic`, `pydantic-settings` | none |
| `gow_maps` | `gow_sim.maps`, `gow_sim.ruleset` (the `warehouse` check, DEC-26) | `networkx`, `matplotlib`, `numpy`, `Pillow` | `gow_server`, `gow_protocol`, `gow_bots`, other `gow_sim` modules |
| client | `src/protocol.gen.ts`, `src/api.gen.ts` | `pixi.js` (only under `src/render/` and in `src/main.ts`), `svelte` | its own copies of the game rules |

Where each boundary is checked (`mise run check`):

- Imports between project packages, and the third-party packages of every Python package: `[tool.importlinter]` in `pyproject.toml`. The import-linter contracts can only forbid an external package, so each Python package has a list of the installed packages it must not import; a new workspace dependency goes into the lists of the packages that may not use it (the same PR). The bot rule is an allow-list: `gow_bots.bots` may import only `gow_sim.view`, `gow_sim.commands`, `gow_sim.maps`, `gow_sim.ruleset`; `gow_maps` only `gow_sim.maps` and `gow_sim.ruleset`.
- Determinism and I/O in `gow_sim` (section 4.1): ruff in `packages/sim/ruff.toml` (TID251: clock, randomness, process, environment, concurrency, network; TID253: modules of file I/O at module level, allowed only in `maps.py`, `ruleset.py`, `replay.py` and `canonical.py` for `json`). Not lintable, left to the runtime nets (golden replays, `test_determinism.py`): `hash()`, iteration over a `set`, a function-local import of an I/O module; the builtin `open()` is caught by PTH123 (its message suggests `Path.open()`, which is banned too).
- Bots and `GameState`: `apps/bots/src/gow_bots/bots/ruff.toml` bans `gow_sim.view.GameState`.
- PixiJS only in `src/render/` and `src/main.ts`: `no-restricted-imports` in `apps/client/eslint.config.js`.

---

## 3. Commands

**The single source of commands and tool versions is `mise.toml` in the root** ([mise](https://mise.jdx.dev)).
`[tools]` sets the versions of node, pnpm and uv; `mise run <task>` installs what is missing and puts the right versions on `PATH`.
Do not run `uv`, `pnpm`, `ruff` and the rest "bare" from the system when a task exists for it: the versions may differ.
List the tasks with `mise tasks`; a task's arguments with `mise run <task> --help`; extra tool arguments go after `--`
(`mise run test:py -- -k combat -vv`). Output is quiet by default (only what the tools print, errors are not hidden);
`mise run -o prefix <task>` brings back the task labels.

A new or changed project command is edited in `mise.toml` and in this table in the same PR. If a task from the table
does not work, that is a bug: fix it. CI installs the tools with `jdx/mise-action` and calls the same tasks (`check:py`, `test:py`,
`test:perf`, `golden:check HEAD^1`, `check:client`, `test:client`, `build`, `regen:protocol`, `regen:api`, `e2e:up`),
so a task that passes locally is what CI runs; the tasks `check`, `test`, `test:perf`, `golden:check` repeat what the
jobs `py` and `web` run. A tool version is edited only in `mise.toml`, never in `.github/workflows/ci.yml`.

### For agents

- **Run only `mise run ...`** (or `mise exec -- <command>` for a one-off command with the project's versions).
  Activating mise in the shell profile is not needed: `mise run` and `mise exec` work in a non-interactive shell
  (verified: `env -i HOME=$HOME PATH=/usr/bin:/bin:/opt/homebrew/bin sh -c 'mise run check:e2e'`). If `mise` is not on
  `PATH`, call it by its full path (Homebrew on Apple Silicon: `/opt/homebrew/bin/mise`).
- **A new worktree requires trusting `mise.toml`**, otherwise every command fails with "Config files ... are not trusted".
  Once per worktree: `mise trust` (in the worktree directory). Or an environment variable that trusts all configs
  under a directory: `MISE_TRUSTED_CONFIG_PATHS=/path/to/Pet_Game-wt` (covers all worktrees at once). Read `mise.toml`
  before trusting it if it was changed by someone other than you.
- **Docker stacks.** The owner's stack (`stack`, `stack:reset`, project `skill-based-front`, ports 8080/8443) is
  **forbidden to agents: do not run `stack` and `stack:reset`**, they recreate the stack and wipe the owner's database.
  For manual checks and smoke tests there are separate stacks: `stack:agent` (project `sbf-agent`,
  `http://localhost:18080`, stopped with `stack:agent:down`), `smoke` (the same project) and `e2e` (project `sbf-e2e`,
  port 18082, removes the stack itself). They do not overlap with the owner's stack by project name, ports or volumes.
  Parallel agents on one machine: set different `SBF_AGENT_PROJECT`, `SBF_AGENT_HTTP_PORT`, `SBF_AGENT_HTTPS_PORT`
  (and `SBF_E2E_*` for `e2e`). Direct `docker compose ...` without `-p` lands in the owner's stack: do not use it
  (`docker compose down` there too). Agents also must not run `deploy/deploy-test.sh`, `deploy/deploy.sh`,
  `deploy/backup.sh`, `deploy/restore.sh` (they work with the project `skill-based-front`).
- Before pushing: `mise run check` and `mise run test` (plus `test:perf`, `golden:check` and `build` if you changed
  the simulation or the client; everything together: `mise run ci`).

### Tasks

| Task | What it does | Since |
|---|---|---|
| `setup` | dependencies: `setup:py` (`uv sync --locked`), `setup:client`, `setup:e2e` (`pnpm install --frozen-lockfile`) | INF-01 |
| `hooks` | once per clone: `pre-commit install` (ruff before every commit) | INF-02 |
| `check` | all static checks: `check:py`, `check:client`, `check:e2e` | INF-02 |
| `check:py` | ruff (check and format), pyright (strict), lint-imports (package boundaries), `gow-maps validate` of the maps (including the starting warehouse against `rulesets/mvp-1.toml`, DEC-26, item 5) | INF-02 |
| `check:client` | eslint and prettier, svelte-check and tsc of the client | INF-03 |
| `check:e2e` | prettier and tsc of the `e2e/` package | QA-02 |
| `check:i18n` | UI strings only in dictionaries, the same keys in every locale dictionary (part of `test:client`) | CLI-11 |
| `test` | quick run: `test:py` and `test:client` | INF-02 |
| `test:py` | `pytest -n auto -m "not perf and not slow"` (pytest-xdist; this is how the required job `py` runs; in CI `HYPOTHESIS_PROFILE=ci`) | INF-02 |
| `test:client` | Vitest of the client | INF-03 |
| `test:visual` | snapshots of the dev scenes against the references, like the job `visual` (not required; Playwright Chromium installs itself, the dev server starts on port 5199). References are updated per `apps/client/visual/README.md` | CLI-04 |
| `shots` | **for agents:** a PNG of every dev scene and of the replay viewer in `.shots/<label>/` (label as an argument, `current` by default; the directory is outside git), without comparing to a reference; look at them yourself with Read. The dev server runs on a free port, Playwright stops it itself. Needs a POSIX shell | #332 |
| `shots:publish` | **for agents:** PNGs from `.shots/` to the branch `shots/<number>` in origin (it holds only images, is not merged; delete it after the PR is merged) and prints markdown links for the PR description (argument: issue or PR number). Needs bash | #332 |
| `test:all` | the whole pytest in one go, without `-n` (slow) | INF-02 |
| `test:slow` | long tests of full bot matches (mark `slow`, not required job `py-slow`) | BOT-04 |
| `test:perf` | benchmarks and tick lag (mark `perf`), strictly sequential: xdist disables the measurements; a step of the job `py` | SIM-15 |
| `test:bench` | simulation benchmarks and the budgets of section 12 (`docs/perf.md`) | SIM-15 |
| `golden:check` | golden replays are re-simulated (`python -m gow_sim.replay check`) and unchanged relative to the base (`scripts/check_golden_frozen.py`; argument: a git ref, `origin/develop` by default; CI: `HEAD^1`) | SIM-16 |
| `golden:generate` | create the golden replays `v{SIM_VERSION}` (after raising `SIM_VERSION`; does not overwrite an existing directory) | SIM-16 |
| `ci` | what the jobs `py` and `web` run, locally: `check`, `test`, `test:perf`, `golden:check`, `build` | #301 |
| `dev` | dev servers together: the game server (`dev:server`, port 8000) and the client (`dev:client`, `http://localhost:5173`, Vite proxies `/api` and `/ws`) | SRV-01 |
| `build` | production build of the client | INF-03 |
| `preview` | `build` and a local preview of the production build under the target CSP (`apps/client/csp.ts`) | INF-03 |
| `regen`, `regen:protocol`, `regen:api` | regenerate the protocol schema and TS types (`protocol.gen.ts`) and the server OpenAPI with `api.gen.ts` | PRO-02, CLI-09 |
| `db:migrate` | apply Alembic migrations (the server also does this on start) | DB-01 |
| `db:revision` | a new migration from the `gow_server.models` models (argument: message) | DB-01 |
| `maps`, `maps:validate` | `gow-maps validate --ruleset rulesets/mvp-1.toml maps/*.json maps/fixtures/*.json`: the map validator (the pool and the fixtures), and the starting warehouse is not above the warehouse of the ruleset with `city_upgrades` (DEC-26, item 5) | MAP-02, #379 |
| `maps:mirror` | build `maps/<name>.json` from the half `maps/src/<name>.half.json` (argument: name) | MAP-03 |
| `maps:preview` | draw the preview `maps/<name>.preview.png` | MAP-04 |
| `maps:bake` | bake the background `maps/<name>.bg.webp`: numpy and Pillow, texture T2, WebP up to 0.5 MB (after any map edit) | MAP-05, #344 |
| `tournament` | bot tournament (by default all maps and bots, 100 seeds, 8 processes, `mvp-1`; anything else after `--`, for example `-- --seeds 20`; `mvp-0` is only a test ruleset, we do not run tournaments on it) | BOT-04 |
| `report` | balance report (argument: file, `docs/balance/latest.jsonl` by default) | BOT-05 |
| `stats` | player statistics from replays as a table (`gow-bots stats`): stance, APM, supply actions, share of scheduled orders, CP spending; arguments after the task name: replay files and options (`docs/balance/README.md`) | #375 |
| `stack` | **owner only.** The production stack on `http://localhost:8080` (HTTPS 8443, `SITE_ADDRESS=:80`; ports 80/443 are taken by another project), argument: ruleset (`mvp-1` by default). Needs a POSIX shell | OPS-01 |
| `stack:reset` | **owner only.** `docker compose down`, removal of the volume `gow-data` (database and replays), `up` again; the owner wipes the volume after every update on purpose | OPS-01 |
| `stack:agent`, `stack:agent:down` | **the agents' stack:** project `sbf-agent`, `http://localhost:18080`, argument: ruleset (`mvp-1` by default); `down` removes its volumes. Needs a POSIX shell | OPS-01 |
| `load` | the load harness `gow_server.loadtest` against a server on this machine (`dev:server`): N matches over WebSockets, tick lag, step p99, CPU, memory; options after `--` (`docs/qa/load.md`) | QA-03 |
| `load:agent` | the same inside the `app` container of the agents' stack (`stack:agent`, lift `GOW_GUEST_RATE_LIMIT` to at least 2N when starting it); needs a POSIX shell | QA-03 |
| `smoke` | `deploy/smoke.sh` on the project `sbf-agent` (build, start, restart with the volume, check through Caddy, `check-caddy.sh`, `check-ws-reload.sh`; the stack is removed at the end); the CI job `docker` does the same. Needs bash | OPS-01 |
| `e2e` | E2E: its own stack (`e2e:up`, project `sbf-e2e`, `e2e/compose.e2e.yaml`, ruleset `test-short`, `http://localhost:18082`), Playwright Chromium (`e2e:browser`), two browsers play a match via an invite, the stack is removed (`e2e:down`) even if the test failed; if `e2e:up` itself failed, run `e2e:down` | QA-02 |

### Outside mise (run directly)

The deployment scripts work with the server or with the production compose project and take their own variables; agents
are forbidden those that touch the project `skill-based-front` (see above). Details: `docs/ops/deploy.md`.

| Command | What it does | Why outside mise |
|---|---|---|
| `deploy/deploy.sh [ref]` | deploy on the server: build, drain matches (`DEPLOY_DRAIN_TIMEOUT`), `predeploy` backup, start by healthcheck, rollback with backup restore on failure | runs on the VPS where there is no mise; works with the project `skill-based-front` |
| `deploy/backup.sh [label]`, `deploy/restore.sh <archive>` | online backup of the volume `gow-data` (`VACUUM INTO` + replays) and restore | same |
| `deploy/deploy-test.sh` | local check of a deploy, rollback of a broken release, backup and restore into a clean volume (`HTTP_PORT=8080 HTTPS_PORT=8443`) | hard-wired to the project `skill-based-front` (deploys on top of the owner's stack), run by the CI job `docker`; locally only the owner |
| `deploy/check-caddy.sh` | security headers (the CSP equals `apps/client/csp.ts`), cache, compression, routes of a running stack; `BASE_URL=https://...` for TLS (part of `smoke`) | suitable for production too (`BASE_URL`), on machines without mise |
| `deploy/check-ws-reload.sh` | the match WebSocket through Caddy survives `caddy reload` (part of `smoke`) | reloads Caddy through `docker compose exec` in the project from the environment |
| `deploy/alert-forward.sh` | forwards server alerts (`match_crashed`, `tick_lag`) from the container log to the webhook `ALERT_WEBHOOK_URL`; metrics: `GET /internal/metrics` inside the container (`docs/ops/deploy.md`, "Observability") | a daemon on the server |
| `docker compose exec app gow-admin show\|rename\|block\|unblock\|reset-password <player> [nick]` (locally without a stack: `uv run gow-admin ...`) | admin script: show, rename, block or unblock a player by id or nick, reset a password (entered in the terminal, #374) (`docs/ops/deploy.md`, section 8) | works in the production container; its own database and set of arguments |
| `docker compose up --build -d` | the production stack as is, on 80/443 | for the owner this is `stack`, for agents `stack:agent`: the bare command lands in the owner's project |

---

## 4. Simulation (`gow_sim`)

### 4.1 Determinism rules: the most important in the project

1. **A step is a pure function of the state.** `Match.step(commands) -> events` changes only its own state. Systems have no I/O, network, logs or `asyncio`. Reading and writing files is allowed only in `maps.py`, `ruleset.py`, `replay.py`.
2. **The tick is the only clock.** All durations are an integer number of ticks (10 ticks = 1 second).
3. **Integers only.** No `float` in state and rules. Percentages are integers (`value * pct // 100`), fractions are in hundredths (CP are stored in hundredths). `//` only for non-negative numbers; rounding down, and this is written next to the formula.
4. **No `set` and `hash()` in the logic.** The iteration order of a `set` depends on `PYTHONHASHSEED`. Storage is `dict[int, T]`, iteration is `for gid in sorted(state.groups)`.
5. **No randomness.** The `random` module is completely forbidden in `gow_sim`. If randomness is ever needed, it is a design change through an ADR.
6. **Player symmetry.** Tie-breaks between players are forbidden. Simultaneous events are resolved symmetrically: first all movements and arrivals are computed, then all fights (DEC-07, rule 8). A tie-break between nodes only through `node_key(player, node)`: for player 1 it is the id of the mirrored node, so rotating the map does not change decisions. A tie-break between groups only within one player. The mirror test catches violations.
7. **Rule numbers come only from `Ruleset`.** If you need a new number, add a field to `Ruleset` and to `rulesets/*.toml`.

### 4.2 Structure: a functional core, no ECS

```
gow_sim/
  ruleset.py      Ruleset (frozen dataclass) + TOML loading
  canonical.py    canonical JSON and blake2b: the basis of ruleset_hash() and state_hash()
  maps.py         MapDef + loader
  state.py        GameState, Group, Node, Edge, Packet, Intent; to_canonical(), state_hash()
  commands.py     command types, validate(), apply_commands()
  systems/        economy, movement, combat, capacity, supply, recruit, build, orders, victory, vision
  view.py         project() -> PlayerView
  match.py        Match, order of systems, run_headless()
  replay.py       recording, verification, dump of divergences
  analysis.py     match metrics from the event log (tournaments and real matches)
```

Entities are `@dataclass(slots=True)`; commands, `Ruleset`, `MapDef`, `PlayerView` are `@dataclass(frozen=True, slots=True)`.
A group stores the counters `units` and `charged`, not a list of units.

A system is a function with a single signature: it changes the state in place and returns events.

```python
def combat(state: GameState, rules: Ruleset) -> list[Event]:
    events: list[Event] = []
    for node_id in sorted(state.contested_nodes()):   # always sorted
        ...
    return events
```

**The order of systems is fixed** and changes only together with `SIM_VERSION`:

```
apply_commands → economy → movement → combat → capacity → supply (including recharging)
→ recruit → build → orders → victory → vision (updating the "last seen" memory)
```

The order in code: `gow_sim.match.SYSTEMS`. `Match.step()` first increments `state.tick`, so all systems of tick `t` see `state.tick == t` (the first tick is 1); the events of each system are appended to `state.events` immediately, and the following systems read them.

`combat` runs fights over time (DEC-24): a fight is a `Fight` in `GameState.fights` (iterated by id), a group has the field `fight`;
rounds every `combat.round_ticks`, the groups of a fight do not move. `combat` gets the bonuses of scheduled orders and of "Defense" (accumulated, DEC-30) from `systems.orders.active_bonuses(state, rules)`
and removes the bonus from a group that entered a fight (it burns up with the fight);
`orders` removes the intents and bonuses of finished orders and modes (SIM-10); road building (DEC-28, item 7: for CP, on an edge) creates no intents.

The fog memory is stored in `GameState` (for each player), so `project()` stays a pure function and a replay stays reproducible.

### 4.3 Commands

- The client and the bot send an **intent** (`Move(group, dest, planned)`), never a state.
- `validate(state, rules, player, cmd) -> Ok | Reject(code)`: ownership, visibility, reachability, CP (costs come from `rules`).
- **The same rejection** `NOT_FOUND_OR_HIDDEN` for "does not exist" and "not visible".
- Commands are applied **at the start of the next tick** in the order `(player_id, seq)`; one player's commands do not affect the validity of another player's commands in the same tick.
- A rejected command does not change the state.
- Surrender and technical defeat are the command `Forfeit` in the log, not a special code path.
- Opaque ids from commands are turned into internal ones by a single function `gow_sim.view.resolve(state, player, cmd, match_key)`: both the server and `run_headless` use it. An unknown id gives `NOT_FOUND_OR_HIDDEN`.

### 4.4 Fog of war and projection

- `project(state, rules, player, match_key) -> PlayerView` is **the only** thing that leaves the simulation toward a player. Bots get the same `PlayerView` as humans. `rules` and the secret `match_key` are not part of `GameState`, so they are passed explicitly.
- A `PlayerView` **must not** contain:
  - entities in invisible nodes and edge halves; numbers beyond the level of the place per the terrain table
    (DEC-21: `EXACT` gives `units` and `charged`, `RANGE` only a range of `units`, `PRESENCE` only
    "an enemy is there" and the modes); the warehouse of an enemy city where no own group stands (DEC-21, item 3, DEC-35: vision sources are own groups only, own nodes are not sources);
  - sequential global ids: only opaque per-player ids (keyed blake2b with the secret `match_key` of the match, not with public data);
  - the enemy's CP, stance, production and overall counters; its front markers and rear minimum (DEC-28);
  - fight and supply events in the fog;
  - the size and id of a group in intents; the target of an enemy's ordinary order; the enemy's accumulated "Defense" bonus and the bonus of the enemy's waiting plan outside a fight (DEC-30, only the mode; in a fight the remaining reserve of the fight is visible to both: `FightView.virtual_left`, DEC-32);
  - enemy figures on edges (`EdgeView.enemy_groups`, DEC-33) outside the halves of visible nodes and
    of edges with an own group on them (DEC-35: the group is a vision source in the node of its half of the edge,
    the other half has the level the terrain table gives it; DEC-10's "only `PRESENCE`, end nodes hidden" is superseded) and
    groups in a fight (they are shown by `fights`); of a figure only the opaque `id` (new on every
    exit from the fog), `pos`, `toward_b` (the nearest node of the edge, not the destination), the mode and the numbers by
    the level of the half are visible; the memory of halves (`HalfView.seen` in the fog) has no position and no direction;
  - an edge level in the fog newer than the last one seen (`VisionMemory.widths`, otherwise level 1; roads have no
    type, DEC-26), enemy construction on edges in the fog (DEC-17, DEC-22);
  - a barracks (except a built barracks of an enemy city adjacent to your own node: DEC-31), the warehouse level, the warehouse capacity, construction and the recruit queue of enemy cities (DEC-25, DEC-26).
    The capacity of a node is public and exact: it is set by the kind of node (DEC-22), there is no estimate.
- A new field in `PlayerView` only together with a fog test for that field.
- Event fields are a declared contract (ARC-02, #457): `event_for_player` sends a field of an event only if `gow_protocol.convert.EVENT_FIELDS` lists it for the kind, and turns into opaque ids only the fields `EVENT_ID_FIELDS` lists; the rest of the event is dropped. A new event field only together with a fog test for that field, like a `PlayerView` field (a field of a public or fight kind goes to the opponent). The test `packages/protocol/tests/test_event_fields.py` compares the table with every `event(...)` call of `gow_sim`.

### 4.5 Replays and versions

- The replay log: a header `{sim_version, ruleset_hash, python_version, map_id, map_hash, match_key}` + `(tick, player, seq, cmd)` + control hashes every 50 ticks. The format is `.jsonl.gz` (gzip from the standard library).
- For viewing, after a match the server re-simulates the log in a `ProcessPoolExecutor` (not in the event loop and not in a thread) and writes a file of full frames: it does not depend on future simulation versions. Format: `docs/design/replay-frames.md`.
- `state_hash()` is blake2b of the canonical JSON (`sort_keys=True`, no float).
- Golden replays live in `tests/golden/v{SIM_VERSION}/`. **You changed a rule or the order of systems** → raise `SIM_VERSION`, create the directory of the new version, explain in the PR what changed. Directories of earlier versions are not changed.
- The ruleset that was played is saved to `rulesets/archive/<hash>.toml`.

---

## 5. Server (`gow_server`)

### 5.1 Process model

- **One process, `--workers 1`.** The state of matches lives in the memory of one process.
- One `asyncio` task per match. Scaling later: several processes, each with its own matches.
- `lifespan` instead of `@app.on_event`.

### 5.2 Tick loop

Time comes through the `Clock` abstraction: in tests the clock is controllable, and tests do not wait for real time.

```python
async def run(self) -> None:
    dt = 1.0 / self.tick_hz
    next_t = self.clock.now()
    while not self.match.finished:
        if self.paused:
            await self.resumed.wait()
            next_t = self.clock.now()
        now = self.clock.now()
        if now - next_t > 3 * dt:     # far behind (GC, VM): reset, do not catch up
            next_t = now
        while now >= next_t and not self.match.finished:
            self.step()                # synchronous: apply commands, step, projections, put into queues
            next_t += dt
        await self.clock.sleep(next_t - self.clock.now())
```

- **There is no `await` inside the step**: no network, no database.
- An exception in a match is logged with the match id and does not affect other matches. Keep strong references to tasks.

### 5.3 Connections

- Sockets that have not sent `hello` yet are capped per client address (IPv6: /64) and in total (`ConnectionGate`, `GOW_WS_UNAUTH_*`); over the cap: close 1013 at once.
- The first message is `hello` with a token, timeout 5 seconds. The token is **never** in the URL or in logs.
- The `Origin` is checked on the WebSocket upgrade.
- The reading and writing tasks live in a `TaskGroup`. Two queues per connection:
  - **snapshots**: a "latest only" cell: a slow client skips frames and does not slow the tick;
  - **everything else** (`ack`, `event`, `match_end`, `error`): a reliable FIFO queue.
- `send` with a timeout; a hung client is disconnected.
- Application-level `ping/pong` (the browser does not see protocol-level pings).
- Deduplication by `seq`, `ack` with the tick of application and the path or the rejection code, a token bucket for commands.
- Reconnection: the same token, the full `PlayerView` and `last_seq` in `welcome`.
- Disconnect (DEC-05, `MatchRunner`): the window `GOW_RECONNECT_WINDOW_S` (60 s), the match keeps going. When it expires, the server queues the disconnected player's `Forfeit` command like an ordinary command (it goes into the replay log, `match_end.reason = disconnect`). The window runs before the first connection too. Pauses only in private matches (`pause`/`resume`, one per player, up to `GOW_PAUSE_MAX_S`).
- A new connection of the same player closes the old one with code 4009; after 4009 the client does **not** reconnect (otherwise two tabs would push each other out forever).

### 5.4 Match lifecycle (SRV-09, `gow_server.lifecycle`)

- States: created → waiting for readiness → running → finished → saved → cleaned up (`MatchState`, the table `TRANSITIONS`); a match that has not started (the invite expired, was replaced, no-show `GOW_READY_TIMEOUT_S`) goes to `aborted` and is cleaned up at once.
- The `matches` row is created before the start (`status=running`), the runner is started with `match_id=str(matches.id)`. The result (`status`, `end_reason`, `ticks`, `match_players.result`) is written through `asyncio.to_thread` after the match ends; unfinished rows get `aborted` / `server_restart` when the process starts.
- A player has at most one active match (`MatchLifecycle.claim`, 409): from the moment of pairing (a guest joining, a bot match) until the match ends. The queue (MM-01) occupies the player the same way.
- Caps (#412): `GOW_MAX_MATCHES` running matches in all and the lower `GOW_MAX_BOT_MATCHES` against a bot; past them starting a match is `503` (`ServerFullError`, a metric and an alert). A bot match nobody connects to within `GOW_BOT_CONNECT_TIMEOUT_S` is dropped as never started: no replay, saved `aborted` with `end_reason = never_started`.
- The server's ruleset is archived in `GOW_RULESETS_DIR/<hash>.toml` on start; `test-short` is not started when `GOW_ENV=prod`.

### 5.5 Security

- Only the SHA-256 of the token is stored in the database.
- Incoming messages are validated with `TypeAdapter(ClientMsg).validate_json(raw)`, models with `extra="forbid"` and `hide_input_in_errors=True` (otherwise the token ends up in the error text and in the logs).
- Rate limits: creating guests, matches, joining the queue, commands in a match.
- The ruleset `test-short` is available only in the dev and e2e environments.

---

## 6. Protocol (`gow_protocol`)

- **Pydantic models are the only source of truth.** Messages are a tagged union on the field `type`.
- `apps/client/src/protocol.gen.ts` and `api.gen.ts` are generated and **are not edited by hand**. CI fails on drift.
  The protocol chain: models → `gow_protocol.schema` → `packages/protocol/protocol.schema.json` →
  json-schema-to-typescript → `protocol.gen.ts` (the command is in section 3). The same place holds the map file type `MapFile`
  (`gow_protocol.mapfile`) the client uses to read `GET /api/maps/{id}`.
- Any protocol change → raise `PROTOCOL_VERSION`. A client with an old version gets close code 4001.
  `PROTOCOL_VERSION` and `CLOSE_PROTOCOL_VERSION` reach the client the same way: the schema carries them in `x-constants`,
  `apps/client/scripts/protocol-consts.js` appends `export const` to the end of `protocol.gen.ts`.
- The codec is in one module (`codec`): JSON now, msgpack later by replacing one file.
- Protocol models and database models are different classes.

---

## 7. Client (`apps/client`)

### 7.1 There is no game logic in the client

- The client draws snapshots and sends intents. It does not decide who wins a fight, whether a packet arrived, or whether the capacity is enough. The path and the arrival tick of an order come in the `ack`, the reachable nodes and the travel time to them in the `reach` response to `reach_query` (DEC-20): the client does not compute them.
- No exceptions: the client computes neither the outcome of a fight nor an "estimate" of a fight. The fight estimate in the HUD was removed by the owner (#252); the test vectors `packages/protocol/vectors/combat.json` remain only for the simulation (SIM-09).

### 7.2 PixiJS and Svelte

- PixiJS draws only the map in a single `<canvas>`; **the entire interface is HTML/CSS in Svelte** on top. Do not draw buttons and windows in PixiJS.
- PixiJS objects live **outside Svelte reactivity**. The snapshot buffer and interpolation are plain TypeScript.
- The HUD is a class in `.svelte.ts` with a field `current = $state.raw(...)` that is replaced once per snapshot (10 Hz), not every frame. Exporting a reassignable `$state` directly from a module is not possible: Svelte does not compile it.
- Container layers: background → territory → roads → nodes → fog → groups → intents → effects (the groups and the intents are drawn over the fog veil: an own group on a road into the fog must not be dimmed, #419).
- Destroy everything you create: `obj.destroy({ children: true })`, created textures, `app.destroy()` on unmount. An asynchronous `app.init()` can finish after unmount: check a flag.
- Map objects with a gradient, a shadow or a rim (cities, group triangles, badges, arena plate and chips) are baked sprites from `SpriteCache` (`apps/client/src/render/bake.ts`, what is baked: `bakedShapes.ts`): one texture per look (a bounded key), never a filter on every object; the cache lives as long as the `Application` (`createSceneSprites`), a view only lets go of its sprites. A blur is allowed only on one cached layer (`cacheAsTexture`), redrawn when its input changes (the fog veil, the territory glow).
- CSP: the target policy lives in `apps/client/csp.ts` (Caddy generates the header from it when the image is built, `deploy/caddy.Dockerfile`). `import 'pixi.js/unsafe-eval'` instead of allowing `unsafe-eval`; textures are loaded without workers (`Assets.setPreferences({ preferWorkers: false })`, `worker-src 'none'`); `style-src 'self'` without `unsafe-inline`, so Svelte markup has no static `style="..."` attributes (styles from JS through the CSSOM and `style:` directives are allowed).

### 7.3 Network and smoothness

- Rendering runs 2 to 3 snapshots behind the latest one and interpolates positions on edges. No extrapolation and no prediction.
- A sent order is shown at once as a "ghost" and is confirmed or rolled back by the `ack`.

### 7.4 Interface

- All strings go through `t("key")` from the first screen (INF-03). The game ships English only (`en`), and the i18n mechanism stays: a new locale is a new dictionary with the same set of keys (checked by `check:i18n`).
- **State is not conveyed by color alone**: a charge is a filled or empty dot, the owner is color plus outline or pattern.
- No `{@html}` and no `innerHTML` with user data (nicks).

### 7.5 Visual loop and the process for visual decisions

Style guide: `docs/design/ui-style.md` (section 23 "Visual decision process"). In short:

- **An agent that changes the look** (map, figures, colors, HUD) looks at the result themselves: `mise run shots before` before the edit, `mise run shots after` after it, then reads the PNGs from `.shots/before/` and `.shots/after/` (Read) and edits until it looks right. The PR description names the scenes viewed and what was seen; the before and after PNGs are attached (how: `apps/client/visual/README.md`). "The frame opens" alone does not count as a check.
- **The `visual` references** (`mise run test:visual`) are updated by the author of an intended change of look per `apps/client/visual/README.md`; a snapshot that changed unintentionally is a regression.
- **A major visual decision** (a new map or unit style, a change of icon shape, a new arena look, a rework of a screen) does not start with code: first a self-contained interactive HTML mockup with switchable variants in `docs/design/mockups/` (example: `fight-arena.html`, #327) and an issue with a table of variants (whether DEC, protocol, simulation, client are needed, an estimate) and a recommendation; the decision field is "awaiting the owner's decision"; code after the owner chooses. Small edits (color, unifying a shape, spacing) go straight into code. Details: `docs/process/orchestration.md`, section 7.

---

## 8. Bots (`gow_bots`)

- A bot implements `Controller.decide(view: PlayerView, tick) -> list[Command]`, sees only the `PlayerView` and is called every 5 ticks.
- Bot parameters are chosen deterministically from the match seed: without this, deterministic matches repeat and the tournament measures nothing.
- The choice "ordinary or scheduled order" is a common utility function of the ruleset prices.
- A tournament is one match per process, both sides for each pair; the JSONL result is reproducible. After a ruleset edit: a tournament and a report in the PR.
- Agents' tournaments run only on `mvp-1` (the ruleset of `stack` and `compose.yaml`); `mvp-0` stays a test ruleset (unit tests, golden replays), we do not run tournaments on it. After a rules change the smoke tournament is `mise run tournament -- --seeds 3` (it looks for crashes and gross imbalance; a report in the PR). A full tournament (default seeds) only after a change of ruleset numbers and before a playtest (BAL-02).

---

## 9. Data

- SQLite in WAL mode (`journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`), SQLAlchemy 2 with `Mapped[]` and `select()`, Alembic migrations (`render_as_batch=True`).
- **Synchronous SQLAlchemy only in `def` endpoints** (FastAPI runs them in a threadpool) or through `asyncio.to_thread`. A database call inside `async def` blocks the event loop of all matches.
- Replays are files in `data/replays/`; the database holds only metadata and the path.
- A database schema change only through a migration.

---

## 10. Testing

| Level | What | Where |
|---|---|---|
| Rule table tests | every row of the DEC tables and the examples of mechanics.md | `packages/sim/tests/test_<system>.py` |
| Scenario tests | tiny maps, the exact state at tick N | `packages/sim/tests/scenarios/` |
| Mirror symmetry | mirrored start + mirrored commands → mirrored state | `packages/sim/tests/test_symmetry.py` |
| Property tests | Hypothesis: charges are conserved, none negative, no fog leaks | `packages/sim/tests/test_properties.py` |
| Determinism | one match in fresh processes with different `PYTHONHASHSEED` | `packages/sim/tests/test_determinism.py` |
| Golden replays | checkpoint hashes of the current version | `packages/sim/tests/golden/v*/` |
| Server | integration through a real WebSocket client, controllable clock | `apps/server/tests/` |
| Client | Vitest: interpolation, network, HUD | `apps/client/src/**/*.test.ts` |
| E2E | Playwright: two browsers, a match via an invite on `test-short` | `e2e/` |
| Balance | bot tournament, a report with confidence intervals | `docs/balance/` |

**What is mandatory when you change:**

| You change | Mandatory |
|---|---|
| a rule in `gow_sim` | a test from mechanics.md; `SIM_VERSION`++; new golden replays; a fix to mechanics.md |
| a number in the ruleset | a bot tournament and a report in the PR |
| a field in `PlayerView` | a fog test for that field |
| a field of an event | an entry in `EVENT_FIELDS` (and `EVENT_ID_FIELDS` for an id), a fog test for that field, `mise run regen:protocol` (`vectors/event_fields.json`) |
| the protocol | `PROTOCOL_VERSION`++; regenerate the TS types |
| the database schema | an Alembic migration |
| a project command | `mise.toml` and section 3 |

---

## 11. Process

- **Branches:** `feature/<issue number>-<slug>` from `develop`, for example `feature/91-combat-bounce`; fixes: `fix/<number>-<slug>`.
- **Commits:** `<type>(<scope>): <message> (#<number>)`, for example `feat(sim): add bounce rule (#91)`.
  - The number goes at the end, not at the start: when editing a message in an editor and during a rebase, git removes lines that start with `#`.
  - `type`: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`.
  - `scope`: `sim`, `protocol`, `server`, `bots`, `client`, `maps`, `infra`, `docs`.
- **A PR** into `develop`, the description has `Closes #<number>` and the acceptance criteria ticked. `develop` is the default branch on GitHub (otherwise `Closes` does not close the issue). `main` is for releases only.
- **CI:** the required checks are `py`, `web` and `docker` (`.github/workflows/ci.yml`, details in the README). The not required `py-slow` runs the tests marked `slow` (long statistical bot matches); mark a new test longer than about 5 s per full match with `@pytest.mark.slow`, and timing measurements with `@pytest.mark.perf`. Merge only when all required checks are green (`gh pr checks <PR> --watch`; analyze a red `py-slow`, but it does not block). GitHub does not enforce this: branch protection is unavailable on the current plan, and the rule rests on the process.
- **Templates:** `.github/pull_request_template.md` (the Definition of Done checklist below) and `.github/ISSUE_TEMPLATE/` (feature, bug, decision). If you change the Definition of Done, change the PR template too.
- **Closing an issue after the merge is manual.** In this repository `Closes #N` currently does not link the PR to the issue (the PR's `closingIssuesReferences` is empty even though the base is the default branch), so the author closes the issue: `gh issue close <N> --comment "Done in #<PR>"`.

### Definition of Done

- [ ] All acceptance criteria of the issue are met and ticked in the PR.
- [ ] CI is green: ruff, pyright strict, lint-imports, pytest, lint and check of the client, Vitest, protocol drift.
- [ ] New rules are covered by tests with expected values from mechanics.md.
- [ ] When rules or the protocol change, versions are raised and artifacts are regenerated (section 10).
- [ ] mechanics.md, AGENTS.md or the README are updated if behavior or commands changed.
- [ ] There is no `TODO` without an issue number in the code.

---

## 12. Performance budgets

The reference machine is described in `docs/perf.md`.

| What | Budget |
|---|---|
| A simulation step without projections, 40 nodes, 40 groups | on average ≤ 0.3 ms, p99 ≤ 1 ms |
| One `project()` projection | ≤ 0.3 ms |
| The same on maps with 45..55 nodes (`grid55`, DEC-27, item 7) | step and supply: the 40-node budgets; projection: 0.45 ms (accepted by the owner 2026-10-22, #371) |
| The supply step (part of the simulation step) | ≤ 0.1 ms |
| The supply step on a stress state (`test_bench_supply_many_donors_busy_roads`, `docs/perf.md`): busy roads, detours, dispatch once per `supply.dispatch_ticks` | ≤ 1 ms (accepted by the owner 2026-10-21) |
| A bot decision (every 5 ticks) | ≤ 1 ms |
| A full headless match of two bots | ≤ 8 s |
| A tournament of 1000 matches on 8 cores | ≤ 20 min |
| Server: one process (one core) | 30 parallel matches, tick lag < 10% |
| Client | 60 FPS on integrated graphics |
| The replay frames file of a full match (15 minutes, DEC-22) | ≤ 2 MB |

Benchmarks use `pytest-benchmark`; a regression of more than 50% breaks CI.

---

## 13. Outdated APIs that agents often write from memory

| Library | Do not write | Write |
|---|---|---|
| PixiJS 8 | `new Application({...})` synchronously; `beginFill` / `drawRect` / `endFill`; `BaseTexture` | `await app.init({...})`; `g.rect(...).fill(...).stroke(...)`; `Texture`, `Assets` |
| Svelte 5 | `export let`, `$:`, `on:click`, `createEventDispatcher`, stores for component state | `$props()`, `$derived`, `$effect`, `onclick`, callback props, `$state` / `$state.raw` |
| Pydantic 2 | `.dict()`, `.json()`, `parse_obj`, `@validator`, `class Config` | `.model_dump()`, `.model_dump_json()`, `model_validate`, `@field_validator`, `model_config = ConfigDict(...)` |
| SQLAlchemy 2 | `session.query(...)`, `declarative_base()`, `Column(...)` without types | `session.execute(select(...))`, `DeclarativeBase`, `Mapped[...] = mapped_column(...)` |
| FastAPI | `@app.on_event("startup")` | `lifespan` |

---

## 14. Do not

- Game logic in the client (including an estimate of a fight outcome).
- `float`, `time`, `random`, `set` iteration and `hash()` in `gow_sim`; tie-breaks between players.
- Rule numbers in system code instead of `Ruleset`.
- Sending a player anything other than the result of `project()`; different errors for "does not exist" and "not visible".
- `await` inside a match step; a synchronous database inside `async def`; several uvicorn workers.
- Editing `protocol.gen.ts` and `api.gen.ts` by hand.
- Tokens in URLs, logs and in the clear in the database.
- UI in PixiJS; PixiJS objects in `$state`; updating the HUD every frame.
- State conveyed by color alone.
- ECS, a custom UI engine, "for the future" abstractions without a task.
- New mechanics outside mechanics.md and without a ruleset flag.

---

## 15. Glossary

| Term | In code | Meaning |
|---|---|---|
| tick | `tick` | a simulation step, 10 per second |
| ruleset | `Ruleset` | all numbers and flags of the rules, `rulesets/*.toml` |
| city / node | `Node` | a vertex of the graph; a node is a city with a warehouse or a province (DEC-23) |
| province | `kind = province` | a node without a city: no warehouse, capacity 3, no VP, position only (DEC-23) |
| road / edge | `Edge` | a link between nodes; `width`: road level 1..3; there is no type, an upgrade only speeds up supply delivery (DEC-22, DEC-26) |
| border point | `border_permille` | a point on an edge in thousandths from the end `a`; splits the edge into halves for vision (DEC-21, DEC-23) |
| internal edge | `is_internal` | both ends belong to one owner; only it can be upgraded and only along it does supply go |
| buffer edge | `is_buffer` | the ends belong to different owners, or one is neutral |
| group | `Group` | units of one player in one place: `units`, `charged` |
| charge | `charged` | a charged unit; each charge is one "shot" |
| warehouse | `warehouse` | a city's stock of charges; warehouse capacity: the node capacity, with `city_upgrades.enabled` its own by kind and level `warehouse_level` (DEC-26) |
| barracks | `has_barracks` | the city can recruit; with `city_upgrades.enabled` the capital has it from the start, other cities get it by an upgrade for 3 CP (DEC-26) |
| recruit queue | `recruit_queue` | the units a city produces one per `recruit.unit_ticks`; CP at queueing, cancelling the last one refunds (DEC-25) |
| capacity | `capacity` | how many units and charges a node holds; fixed by the kind of node (DEC-22) |
| front marker | `fronts`, `SetFront` | one of a player's two markers: a city with a marker fills its warehouse to full, when the city is lost the marker moves back to the capital (DEC-28) |
| rear minimum | `rear_min`, `SetRearMin` | how many charges the cities without a marker keep, `0..supply.rear_min_max` (DEC-28) |
| transfer | `Transfer` | a one-off shipment of charges between your own cities (DEC-18) |
| starvation | `starvation` | a garrison cut off from the capital spends charges (DEC-19) |
| packet | `Packet` | charges travelling along a road |
| bounce | `bounce` | an attacker without a win returns to the source node discharged |
| scheduled order | `planned=True` | more expensive, visible to everyone as an intent, sets out with a delay, gives a one-off bonus |
| fight | `Fight` | a fight over time (DEC-24): a node or an edge with a meeting point `point`, rounds every `combat.round_ticks`, reinforcements and retreat; visible to both (`PlayerView.fights`) |
| intent | `Intent` | the part of a scheduled order visible to everyone: from where, to where, the kind, without the size and group id |
| modes | `Mode.ATTACK / DEFENSE` | "Attack", "Defense"; "Building" (`BUILD`) was removed by DEC-16 |
| construction | `UpgradeRoad(edge)` | upgrading your own internal road by one level for CP (`orders.cost.build`), construction on an edge `Edge.build` (DEC-28, item 7) |
| CP | `cp` | command points; flat regeneration, they do not grow with territory; stored in hundredths |
| stance | `Stance.ECONOMY / BALANCE / WAR` | the share of CP regeneration that goes into charges |
| player view | `PlayerView` | the state filtered by fog for a player or a bot |
| VP | `vp` | victory points for holding cities |
| auto-merge | `groups_merged` | your own group that finished moving in your own node, or was recruited there, merges with the node's group at the end of the tick (DEC-20) |
| stack limit | `STACK_LIMIT` | a group goes only through nodes whose capacity is not less than its size; a big group splits first (DEC-20) |
