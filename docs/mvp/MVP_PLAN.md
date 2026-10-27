# Skill-Based Front MVP plan

## What the MVP is

Two players find each other through a public lobby, a matchmaking queue, or an invite link and play a full 1v1 match in the browser over the network. Ranked matches change the Glicko-2 rating, there is a leaderboard, play against a bot, and a replay with full reveal. Balance is driven by a set of rules (a ruleset) verified by a bot tournament and an internal playtest.

## What is not in the MVP

- Players building new edges (mechanics.md section 8): after the MVP.
- The delivery modes "packets / pump-up", trophies from warehouses, vision based on group size.
- Fallback rule models (concave economy, VP threshold, a bonus for the final hold): implemented only if BAL-02 requires them.
- Procedural map generation (hand-made maps and a mirroring script only), Ukrainian localization.
- FFA and team modes; 1v1 only.
- Full accounts and OAuth: only a guest identity with an "upgrade" option later.
- Steam, mobile devices, chat, live spectators, tournaments, monetization.
- A map editor with an interface: CLI tools only.

## Main principles of the plan

- **Mechanics first, then pixels and the meta game.** The balance gate BAL-02 checks the depth of the mechanics with bots, the internal playtest PT-01 checks it with humans. Client polish (CLI-12, CLI-13) depends on BAL-02, the whole meta game (M5) depends on PT-01.
- **The rules are specified down to the level of tests.** Combat is defined by a table of worked examples (DEC-07); the SIM-09 tests are exactly this table.
- **Open questions are closed early and fast.** Every DEC issue already has a default value; confirming it takes a couple of hours and is needed before SIM-01. After that the numbers change only by editing the ruleset.
- **Numbers are data.** All rule parameters live in `rulesets/*.toml`; balancing is editing a file and rerunning the tournament.
- **Two parallel tracks.** Track A (Python) carries the simulation, the bots and the server; track B (TypeScript and tools) carries the maps, the client and the infrastructure. The client starts on map data before the protocol is ready (CLI-03).
- **Every issue is at most 5 days and has verifiable acceptance criteria.**

## Milestones

| Milestone | Goal | Issues | P0 | Estimate, person-days |
|---|---|---|---|---|
| **M0: Foundation** | The repository, tooling, CI and documents are ready; the open design questions have default values. | 12 | 12 | 9.75 |
| **M1: Simulation core** | All MVP rules are implemented in a pure deterministic simulation with no graphics and no network. | 21 | 21 | 44.5 |
| **M2: Bots and balance gate** | The bot tournament shows that the mechanics do not collapse into a single strategy. | 7 | 7 | 17 |
| **M3: Match server** | An authoritative server runs a match between two WebSocket clients with fog of war. | 15 | 15 | 21.75 |
| **M4: Web client and internal playtest** | Two people play a full match in browsers; there is play against a bot and replay viewing; the internal playtest gave a "go". | 16 | 13 | 31.5 |
| **M5: Meta game** | Public lobby, matchmaking queue, Glicko-2 rating and leaderboard. | 7 | 7 | 12.75 |
| **M6: MVP release** | The game is deployed over https, passes e2e and an audit, a closed playtest has been held. | 9 | 7 | 15 |
| **Total** | | 87 | 82 | 152.25 |

### Milestone exit criteria

**M0: Foundation**

- CI is green on empty Python and client packages.
- docs/design/mechanics.md and AGENTS.md are in the repository.
- The default values of all DECs are recorded in mechanics.md; DEC-01…DEC-04, DEC-07, DEC-08 are confirmed.

**M1: Simulation core**

- A full match runs headless with simple controllers.
- State hashes match across different processes with different PYTHONHASHSEED values.
- A mirrored start with mirrored commands gives a mirrored state (no side advantage in the code).
- Every worked example from DEC-07 is a separate passing test.

**M2: Bots and balance gate**

- A 1000-match tournament is reproducible and fits into 20 minutes on 8 cores.
- BAL-02 is closed: the gate criteria are passed, the final ruleset is fixed.

**M3: Match server**

- Two scripted clients play a match via an invite from start to finish; the result matches the headless run.
- Reconnecting restores the player's view; a replay is recorded and played back.

**M4: Web client and internal playtest**

- The manual QA-01 checklist is passed on two different computers.
- PT-01 is closed with a "go" decision.

**M5: Meta game**

- A ranked match from the queue changes the rating of both players and appears in the leaderboard and in profiles.

**M6: MVP release**

- REL-01 is closed with the success criteria met.

## Schedule estimate

- Total: **152.25 ideal person-days** (87 issues), of which P0 is 144.25.
- With two developers working in parallel on the tracks, the estimated duration is **about 78 working days** (track A: 75 days, track B: 77.25 days).
- These are "ideal" full-time days. For work in evenings and weekends multiply by 2-3; leave a reserve for balance iterations (BAL-02) and the playtest (PT-01).
- The closed playtest (REL-01) ends on **about day 75**; after it only P1/P2 tasks remain in the estimate, and the release does not depend on them.
- The critical path through the dependencies, not counting people, is 48 days:

  INF-01 → DOC-01 → DEC-07 → SIM-01 → SIM-02 → SIM-03 → SIM-04 → SIM-05 → SIM-09 → SIM-10 → SIM-14 → SIM-15 → BOT-01 → BOT-03 → BOT-05 → BAL-01 → BAL-02 → PT-01 → RAT-01 → MM-01 → LB-01 → REL-01

## Estimated schedule

The layout over the two tracks (day 0 is the start). Developer A is the Python track, B is TypeScript and tools; issues with the track `any` go to whoever is free earlier.

```mermaid
gantt
  title MVP plan (ideal days from the start)
  dateFormat YYYY-MM-DD HH:mm
  axisFormat %j
  section Developer A
  INF-01 : inf01, 2026-01-01 00:00, 24h
  DOC-01 : doc01, 2026-01-02 00:00, 24h
  INF-02 : inf02, 2026-01-03 00:00, 24h
  DEC-07 : dec07, 2026-01-04 00:00, 24h
  DEC-03 : dec03, 2026-01-05 00:00, 6h
  DEC-08 : dec08, 2026-01-05 06:00, 6h
  SIM-01 : sim01, 2026-01-05 12:00, 24h
  SIM-02 : sim02, 2026-01-06 12:00, 60h
  SIM-03 : sim03, 2026-01-09 00:00, 24h
  SIM-04 : sim04, 2026-01-10 00:00, 60h
  SIM-05 : sim05, 2026-01-12 12:00, 60h
  SIM-07 : sim07, 2026-01-15 00:00, 60h
  SIM-09 : sim09, 2026-01-17 12:00, 108h
  SIM-06 : sim06, 2026-01-22 00:00, 24h
  SIM-10 : sim10, 2026-01-23 00:00, 60h
  SIM-08 : sim08, 2026-01-25 12:00, 108h
  SIM-14 : sim14, 2026-01-30 00:00, 60h
  SIM-15 : sim15, 2026-02-01 12:00, 60h
  BOT-01 : bot01, 2026-02-04 00:00, 24h
  SIM-16 : sim16, 2026-02-05 00:00, 60h
  SRV-01 : srv01, 2026-02-07 12:00, 24h
  SRV-02 : srv02, 2026-02-08 12:00, 60h
  BOT-04 : bot04, 2026-02-11 00:00, 60h
  PRO-03 : pro03, 2026-02-13 12:00, 24h
  SRV-03 : srv03, 2026-02-14 12:00, 60h
  BAL-01 : bal01, 2026-02-17 00:00, 24h
  BAL-02 : bal02, 2026-02-18 00:00, 108h
  SRV-06 : srv06, 2026-02-22 12:00, 24h
  DEC-05 : dec05, 2026-02-23 12:00, 6h
  SRV-04 : srv04, 2026-02-23 18:00, 24h
  SRV-08 : srv08, 2026-02-24 18:00, 24h
  DEC-06 : dec06, 2026-02-25 18:00, 6h
  SIM-17 : sim17, 2026-02-26 00:00, 60h
  PT-01 : pt01, 2026-03-01 06:00, 24h
  RAT-01 : rat01, 2026-03-02 06:00, 24h
  MM-01 : mm01, 2026-03-03 06:00, 108h
  LOB-01 : lob01, 2026-03-07 18:00, 60h
  MOD-01 : mod01, 2026-03-10 06:00, 24h
  QA-04 : qa04, 2026-03-11 06:00, 24h
  LEG-01 : leg01, 2026-03-12 06:00, 24h
  OPS-04 : ops04, 2026-03-13 06:00, 24h
  REL-01 : rel01, 2026-03-14 06:00, 60h
  QA-03 : qa03, 2026-03-16 18:00, 24h
  section Developer B
  INF-03 : inf03, 2026-01-02 00:00, 60h
  DEC-01 : dec01, 2026-01-04 12:00, 6h
  DEC-02 : dec02, 2026-01-04 18:00, 6h
  DEC-04 : dec04, 2026-01-05 00:00, 6h
  MAP-01 : map01, 2026-01-05 06:00, 24h
  MAP-02 : map02, 2026-01-06 06:00, 60h
  INF-05 : inf05, 2026-01-08 18:00, 24h
  PRO-01 : pro01, 2026-01-09 18:00, 60h
  INF-04 : inf04, 2026-01-12 06:00, 24h
  MAP-03 : map03, 2026-01-13 06:00, 24h
  PRO-02 : pro02, 2026-01-14 06:00, 24h
  MAP-04 : map04, 2026-01-15 06:00, 60h
  SIM-11 : sim11, 2026-01-17 18:00, 24h
  SIM-12 : sim12, 2026-01-18 18:00, 24h
  CLI-01 : cli01, 2026-01-19 18:00, 60h
  SIM-13 : sim13, 2026-01-22 06:00, 24h
  CLI-03 : cli03, 2026-01-23 06:00, 60h
  CLI-02 : cli02, 2026-01-25 18:00, 24h
  CLI-04 : cli04, 2026-01-26 18:00, 108h
  CLI-06 : cli06, 2026-01-31 06:00, 60h
  CLI-07 : cli07, 2026-02-02 18:00, 60h
  BOT-03 : bot03, 2026-02-05 06:00, 108h
  BOT-02 : bot02, 2026-02-09 18:00, 60h
  DB-01 : db01, 2026-02-12 06:00, 24h
  ID-01 : id01, 2026-02-13 06:00, 24h
  BOT-05 : bot05, 2026-02-14 06:00, 24h
  SRV-07 : srv07, 2026-02-15 06:00, 60h
  SRV-05 : srv05, 2026-02-17 18:00, 24h
  SRV-09 : srv09, 2026-02-18 18:00, 60h
  CLI-08 : cli08, 2026-02-21 06:00, 60h
  CLI-09 : cli09, 2026-02-23 18:00, 60h
  CLI-05 : cli05, 2026-02-26 06:00, 24h
  CLI-10 : cli10, 2026-02-27 06:00, 24h
  QA-01 : qa01, 2026-02-28 06:00, 24h
  OPS-01 : ops01, 2026-03-01 06:00, 60h
  OPS-02 : ops02, 2026-03-03 18:00, 24h
  RAT-02 : rat02, 2026-03-04 18:00, 24h
  OPS-03 : ops03, 2026-03-05 18:00, 60h
  LB-01 : lb01, 2026-03-08 06:00, 60h
  QA-02 : qa02, 2026-03-10 18:00, 60h
  CLI-13 : cli13, 2026-03-13 06:00, 24h
  MAP-05 : map05, 2026-03-14 06:00, 60h
  CLI-12 : cli12, 2026-03-16 18:00, 60h
  CLI-11 : cli11, 2026-03-19 06:00, 24h
```

*The axis is the number of the ideal working day (001 is the first day). The calendar dates are nominal.*

## Risks and how we reduce them

| Risk | Sign | What we do |
|---|---|---|
| The mechanics turn out flat | BAL-02 does not pass within the timebox, or PT-01 gives "no-go" | Stop M5; discuss the postponed mechanics (new edges, vision based on size, fallback rule models) |
| The code favors one side | A side advantage in the BOT-05 report | Two-phase movement, symmetric fights (DEC-07), the mirror test in SIM-05 |
| Python is too slow for the tournament or the server | SIM-14 does not fit the step budget | Profiling; simplifying supply routing; a capacity cache; as a last resort, hot functions in Cython/mypyc |
| The TypeScript learning curve of developer B | CLI issues take twice as long | Do CLI-03 (the map from JSON) in parallel with the network layer; keep the client "dumb"; pair review |
| Too few players for matchmaking | The queue is empty | A bot opponent (SRV-06), invites and the lobby as the main path; the queue is secondary |
| Scope growth from the open questions | New mechanics ask to get into the MVP | Everything new goes behind a ruleset flag and only after BAL-02 |
| Fog of war leaks | QA-04 or players find hidden data in the WebSocket | A single `project()` function, the property tests of SIM-14 and SIM-17, the QA-04 audit |

## List of issues

### M0: Foundation

| ID | Task | Priority | Size | Track | Depends on |
|---|---|---|---|---|---|
| INF-01 | Monorepo: new structure and archive of the Pygame prototype | P0 | S | any | - |
| DOC-01 | Design documents, ADRs and the agent instructions in the repository | P0 | S | any | INF-01 |
| INF-02 | Python tooling: ruff, pyright strict, pytest, hypothesis, import boundaries | P0 | S | A | INF-01 |
| INF-03 | Web client skeleton: pnpm, Vite, Svelte 5, TypeScript strict, PixiJS 8, target CSP | P0 | M | B | INF-01 |
| INF-04 | CI in GitHub Actions for Python and the client | P0 | S | any | INF-02, INF-03, INF-05 |
| INF-05 | Issue and PR templates, labels, branch and commit conventions | P0 | S | any | INF-01 |
| DEC-01 | Decision: how new units appear | P0 | XS | any | DOC-01 |
| DEC-02 | Decision: economy model and CP stance | P0 | XS | any | DOC-01 |
| DEC-03 | Decision: victory condition and match length | P0 | XS | any | DOC-01 |
| DEC-04 | Decision: visibility rules in the MVP | P0 | XS | any | DOC-01 |
| DEC-07 | Decision: combat resolution (table of worked examples) | P0 | S | any | DOC-01 |
| DEC-08 | Decision: modes and scheduled orders | P0 | XS | any | DOC-01 |

### M1: Simulation core

| ID | Task | Priority | Size | Track | Depends on |
|---|---|---|---|---|---|
| MAP-01 | Map format and loader | P0 | S | B | INF-02, DOC-01 |
| MAP-02 | Map validator | P0 | M | B | MAP-01 |
| MAP-03 | Script for mirroring half a map | P0 | S | B | MAP-02 |
| MAP-04 | MVP map pool: three maps of different character | P0 | M | B | MAP-02, MAP-03 |
| SIM-01 | Ruleset: all rule numbers and flags as data | P0 | S | A | INF-02, DOC-01, DEC-01, DEC-02, DEC-03, DEC-04, DEC-07, DEC-08 |
| SIM-02 | State model and canonical serialization | P0 | M | A | SIM-01, MAP-01 |
| SIM-03 | Visibility: which nodes and edges a player sees | P0 | S | A | SIM-02 |
| SIM-04 | Commands: types, validation and application at the tick boundary | P0 | M | A | SIM-02, SIM-03 |
| SIM-05 | Movement across the graph | P0 | M | A | SIM-04 |
| SIM-06 | Economy: CP, stance and production in the capital | P0 | S | A | SIM-02 |
| SIM-07 | Warehouses, city capacity and attrition | P0 | M | A | SIM-02 |
| SIM-08 | Supply: packets, throughput, recharging | P0 | L | A | SIM-05, SIM-06, SIM-07 |
| SIM-09 | Combat per the DEC-07 table | P0 | L | A | SIM-05, SIM-07 |
| SIM-10 | Orders: scheduled, the "Defense" mode, cancellation | P0 | M | A | SIM-04, SIM-09 |
| SIM-11 | The "Building" mode: road upgrades | P0 | S | any | SIM-04, SIM-07 |
| SIM-12 | Unit recruiting | P0 | S | any | SIM-04, SIM-07 |
| SIM-13 | Victory: VP, capital capture, timer, tie-break | P0 | S | any | SIM-09 |
| SIM-14 | Projection: PlayerView | P0 | M | A | SIM-03, SIM-05, SIM-10, SIM-11 |
| SIM-15 | Match engine and headless run | P0 | M | A | SIM-08, SIM-10, SIM-11, SIM-12, SIM-13, SIM-14 |
| SIM-16 | Determinism and replays | P0 | M | A | SIM-15 |
| SIM-17 | Property-based tests of invariants (Hypothesis) | P0 | M | any | SIM-15 |

### M2: Bots and balance gate

| ID | Task | Priority | Size | Track | Depends on |
|---|---|---|---|---|---|
| BOT-01 | Controller interface, base bots and seed-driven variability | P0 | S | A | SIM-15, MAP-04 |
| BOT-02 | Strategy bots: Expander and Turtle | P0 | M | any | BOT-01 |
| BOT-03 | Strategy bots: Rusher, Strangler and Reactive | P0 | L | any | BOT-01 |
| BOT-04 | Tournament harness and match analyzer | P0 | M | A | BOT-01, SIM-16 |
| BOT-05 | Balance report | P0 | S | any | BOT-02, BOT-03, BOT-04 |
| BAL-01 | Balance: first run and verdict | P0 | S | A | BOT-05, DEC-01, DEC-02, DEC-03, DEC-04, DEC-07, DEC-08 |
| BAL-02 | Balance gate: iterations (5-day timebox) | P0 | L | A | BAL-01 |

### M3: Match server

| ID | Task | Priority | Size | Track | Depends on |
|---|---|---|---|---|---|
| SRV-01 | FastAPI server skeleton | P0 | S | A | INF-02 |
| DB-01 | Storage: SQLAlchemy 2, Alembic, SQLite in WAL mode | P0 | S | any | SRV-01 |
| ID-01 | Guest identity and nicknames | P0 | S | any | DB-01 |
| PRO-01 | Protocol: message schema and JSON fixtures | P0 | M | any | SIM-02, DEC-04 |
| PRO-02 | TypeScript type generation and schema drift check | P0 | S | B | PRO-01, INF-03, INF-04 |
| PRO-03 | Protocol: converters between the simulation and messages | P0 | S | A | PRO-01, SIM-14 |
| SRV-02 | MatchRunner and MatchManager: the match tick loop | P0 | M | A | SIM-15, SRV-01 |
| SRV-03 | Match WebSocket: authentication, reading, writing, commands | P0 | M | A | SRV-02, PRO-03, ID-01 |
| DEC-05 | Decision: disconnection and pauses | P0 | XS | any | DOC-01 |
| SRV-04 | Reconnection and the disconnect policy | P0 | S | A | SRV-03, DEC-05 |
| SRV-05 | Private match via an invite link | P0 | S | any | SRV-03 |
| SRV-06 | Match against a bot | P0 | S | A | SRV-02, BOT-02 |
| SRV-07 | Replays: recording and the frames file for viewing | P0 | M | any | SRV-02, SIM-16, DB-01 |
| SRV-08 | Integration test: two scripted clients play a match | P0 | S | A | SRV-04, SRV-05 |
| SRV-09 | Match lifecycle | P0 | M | any | SRV-05, DB-01 |

### M4: Web client and internal playtest

| ID | Task | Priority | Size | Track | Depends on |
|---|---|---|---|---|---|
| CLI-01 | Client network layer | P0 | M | B | PRO-02, INF-03 |
| CLI-02 | Snapshot buffer and interpolation | P0 | S | B | CLI-01 |
| CLI-03 | Map rendering and camera | P0 | M | B | INF-03, MAP-01 |
| CLI-04 | Rendering groups, charges, warehouses, packets and intents | P0 | L | B | CLI-02, CLI-03 |
| CLI-05 | Fog of war on the client | P0 | S | B | CLI-04 |
| CLI-06 | Selection and movement: ordinary and scheduled orders | P0 | M | B | CLI-04 |
| CLI-07 | Remaining commands: split, merge, modes, recruit, build, stance, surrender | P0 | M | B | CLI-06 |
| CLI-08 | HUD | P0 | M | B | CLI-02, PRO-02, SIM-09 |
| CLI-09 | Screens and navigation | P0 | M | B | CLI-01, ID-01, SRV-05, SRV-06 |
| CLI-10 | Replay viewing | P0 | S | B | SRV-07, CLI-04 |
| CLI-11 | English localization and language selection | P1 | S | B | INF-03 |
| QA-01 | First live match: manual checklist | P0 | S | any | CLI-05, CLI-07, CLI-08, CLI-09, CLI-10, SRV-04, SRV-06, SRV-08, SRV-09 |
| PT-01 | Internal playtest: go / no-go decision | P0 | S | any | QA-01, BAL-02 |
| MAP-05 | Map background baker from the legacy generator | P2 | M | B | MAP-01 |
| CLI-12 | Feedback and "juice" | P2 | M | B | CLI-04, BAL-02 |
| CLI-13 | "How to play" screen | P0 | S | B | CLI-09, BAL-02 |

### M5: Meta game

| ID | Task | Priority | Size | Track | Depends on |
|---|---|---|---|---|---|
| RAT-01 | Glicko-2 rating | P0 | S | any | DB-01, PT-01 |
| DEC-06 | Decision: which matches are ranked | P0 | XS | any | DOC-01 |
| RAT-02 | Updating the rating from match results | P0 | S | any | RAT-01, SRV-09, PT-01, DEC-06 |
| LOB-01 | Public lobby | P0 | M | any | SRV-09, CLI-09, PT-01 |
| MM-01 | Matchmaking queue | P0 | L | any | RAT-01, SRV-09, SRV-06, CLI-09, PT-01 |
| LB-01 | Leaderboard and player profile | P0 | M | any | RAT-02, CLI-10, MM-01 |
| MOD-01 | Basic abuse protection | P0 | S | any | ID-01, PT-01 |

### M6: MVP release

| ID | Task | Priority | Size | Track | Depends on |
|---|---|---|---|---|---|
| OPS-01 | Docker images and docker compose | P0 | M | B | SRV-01, INF-03 |
| OPS-02 | Caddy: TLS, WebSocket, static files, security headers | P0 | S | B | OPS-01 |
| OPS-03 | VPS deployment, backups and safe deploy | P0 | M | B | OPS-02, DB-01 |
| OPS-04 | Observability: logs, metrics, errors | P1 | S | any | SRV-02, OPS-01 |
| QA-02 | E2E Playwright: an invite match in two browsers | P0 | M | B | QA-01, OPS-01 |
| QA-03 | Load test | P1 | S | any | SRV-08, OPS-03 |
| QA-04 | Security and fog leak audit | P0 | S | any | SRV-03, CLI-01, OPS-02, SIM-17, MOD-01 |
| LEG-01 | Legal minimum for a public site | P0 | S | any | OPS-03, CLI-09 |
| REL-01 | MVP closed playtest | P0 | M | any | QA-02, QA-04, OPS-03, LB-01, MM-01, LOB-01, LEG-01, SRV-08, CLI-13 |

## How to create the issues on GitHub

The issues already exist in `DastinovDS/Skill-Based-Front`; the mapping of ID to issue number is in `docs/mvp/issue_map.json`. A rerun is needed only after the plan is edited.

1. Install and authorize the GitHub CLI: `gh auth login`.
2. Check the plan without changes: `python docs/mvp/import_github_issues.py --repo DastinovDS/Skill-Based-Front` (dry run by default).
3. Create the labels, milestones and issues: `python docs/mvp/import_github_issues.py --repo DastinovDS/Skill-Based-Front --apply`.
4. The script is idempotent: issues that already exist (by the `[ID]` prefix in the title) are skipped; in the second pass the references like `SIM-03` in the bodies are completed with the real numbers `#NN`. The mapping is saved in `docs/mvp/issue_map.json`.
5. Branches are `feature/<number>-<slug>`, commits are `<type>(<scope>): <message> (#<number>)` (see AGENTS.md).
