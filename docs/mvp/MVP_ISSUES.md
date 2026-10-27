# Skill-Based Front MVP plan: issues

> Generated from `issues.yaml`. Each block is a ready GitHub issue body; the issue title is the `### [ID] ...` line.

## M0: Foundation

*The repository, tooling, CI and documents are ready; the open design questions have default values.*

### [INF-01] Monorepo: new structure and archive of the Pygame prototype

Labels: `area:infra` `type:chore` `P0` `size:S`

**Milestone:** M0: Foundation · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** any

### Context
The current code implements the old design (five resources, buildings, three unit types, combat through damage and armor) and is not reused in the new simulation. The map generator from legacy may come in handy as an offline tool (MAP-05).

### Tasks
- [ ] Put the tag `v0-pygame-prototype` on the current `develop`.
- [ ] Move `rts_core/`, `rts_client.py`, `rts_server.py`, `main.py`, `assets/` into `legacy/`; exclude `legacy/` from the linters, the type checker and CI.
- [ ] Create the directories: `packages/sim`, `packages/protocol`, `apps/server`, `apps/bots`, `apps/client`, `tools/maps`, `maps/`, `rulesets/`, `docs/{design,adr,balance,mvp,qa}`.
- [ ] A root `pyproject.toml` as a uv workspace (Python 3.12, the version pinned in `.python-version`) with the packages `gow_sim`, `gow_protocol`, `gow_server`, `gow_bots`, `gow_maps`.
- [ ] Update `.gitignore`: `node_modules/`, `dist/`, `.pytest_cache/`, `data/`, `*.db`.

### Acceptance criteria
- [ ] `uv sync --locked` passes on a clean machine.
- [ ] `uv run python -c "import gow_sim, gow_protocol, gow_server, gow_bots, gow_maps"` runs without errors.
- [ ] The README describes the new structure and links to `legacy/` and the prototype tag.

### Out of scope
- Moving the legacy code into the new packages.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [DOC-01] Design documents, ADRs and the agent instructions in the repository

Labels: `area:docs` `type:chore` `P0` `size:S`

**Milestone:** M0: Foundation · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** any
**Depends on:** INF-01

### Tasks
- [ ] `docs/design/mechanics.md`: the current mechanics (from `skill-based-front-mechanics.md`).
- [ ] Record in mechanics.md the default values of all DEC issues with the status [default]; the DEC issues later change it to [accepted] or to another decision.
- [ ] `DESIGN.md` → `docs/design/archive/DESIGN-v1.md` with the note "outdated, see mechanics.md".
- [ ] `AGENTS.md` in the root; `CLAUDE.md` with a single line `@AGENTS.md`.
- [ ] `docs/adr/0001-architecture.md`: authoritative server, pure simulation, Python + TypeScript, fog of war on the server.
- [ ] `docs/mvp/`: the MVP plan and the list of issues.

### Acceptance criteria
- [ ] The README links to mechanics.md, AGENTS.md and the MVP plan.
- [ ] The AGENTS.md glossary matches the terms of mechanics.md.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [INF-02] Python tooling: ruff, pyright strict, pytest, hypothesis, import boundaries

Labels: `area:infra` `type:chore` `P0` `size:S`

**Milestone:** M0: Foundation · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** A
**Depends on:** INF-01

### Tasks
- [ ] ruff (lint + format) with a shared config in the root.
- [ ] pyright in strict mode for `packages/`, `apps/`, `tools/`.
- [ ] pytest + hypothesis; hypothesis profiles `dev` and `ci` (a bounded number of examples, `derandomize=True`).
- [ ] import-linter: `gow_sim` does not import other project packages; `gow_protocol` does not import `gow_server` and `gow_bots`; `gow_bots.bots` does not directly import `gow_sim.state`, `gow_sim.systems`, `gow_sim.match` (a `forbidden` contract with `allow_indirect_imports = true`, because `view` and `commands` themselves use `state`); nothing imports `legacy`.
- [ ] `packages/sim/ruff.toml` with `extend = "../../pyproject.toml"` and the TID251 rule (banned-api): ban `time`, `random`, `asyncio`, `socket`, `threading`, `datetime.datetime.now` inside `gow_sim`.
- [ ] pre-commit with ruff.

### Acceptance criteria
- [ ] `uv run ruff check . && uv run ruff format --check . && uv run pyright && uv run lint-imports && uv run pytest` are green.
- [ ] A trial `import time` in `gow_sim` breaks ruff, a trial import of `gow_sim.state` from a bot breaks lint-imports (verified, described in the PR).

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [INF-03] Web client skeleton: pnpm, Vite, Svelte 5, TypeScript strict, PixiJS 8, target CSP

Labels: `area:client` `type:chore` `P0` `size:M`

**Milestone:** M0: Foundation · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** B
**Depends on:** INF-01

### Tasks
- [ ] `apps/client` from the Vite `svelte-ts` template (without SvelteKit).
- [ ] `tsconfig`: `strict`, `noUncheckedIndexedAccess`.
- [ ] ESLint (flat config, typescript-eslint, eslint-plugin-svelte), Prettier, `svelte-check`, Vitest.
- [ ] `GameCanvas.svelte`: creates the `Application` in `onMount`, is guarded against the asynchronous `init()` finishing after unmount, destroys the application in cleanup.
- [ ] An HUD overlay on top of the canvas: `pointer-events: none` on the container, `auto` on the panels.
- [ ] The `t("key")` function and the ru dictionary from the first screen: all later CLI issues write strings only through it.
- [ ] The target CSP (the same as in OPS-02) is checked on the prod build: `import 'pixi.js/unsafe-eval'` instead of `unsafe-eval`, `worker-src blob:` or disabling the loader's workers, a decision on `style-src` for Svelte.

### Acceptance criteria
- [ ] `pnpm dev` shows a canvas with a test graph (3 circles, 2 lines) and an HUD on top; resizing the window works.
- [ ] `pnpm lint && pnpm check && pnpm test && pnpm build` are green.
- [ ] Vitest: 20 mount/unmount cycles call `app.destroy` 20 times.
- [ ] The prod build under the target CSP starts without CSP errors in the browser console.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [INF-04] CI in GitHub Actions for Python and the client

Labels: `area:infra` `type:chore` `P0` `size:S`

**Milestone:** M0: Foundation · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** any
**Depends on:** INF-02, INF-03, INF-05

### Tasks
- [ ] Job `py`: `astral-sh/setup-uv`, `uv sync --locked`, ruff, pyright, lint-imports, pytest (hypothesis profile `ci`).
- [ ] Job `web`: pnpm with a cache, lint, check, test, build.
- [ ] Path filters, run on PRs into `develop` and `main`.
- [ ] Describe in the README which checks are required (branch protection is configured manually).

### Acceptance criteria
- [ ] A PR shows both jobs; a failure of either blocks the merge.
- [ ] The AGENTS.md commands marked as available from M0 run locally without edits.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [INF-05] Issue and PR templates, labels, branch and commit conventions

Labels: `area:docs` `type:chore` `P0` `size:S`

**Milestone:** M0: Foundation · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** any
**Depends on:** INF-01

### Tasks
- [ ] `.github/ISSUE_TEMPLATE/`: feature, bug, decision.
- [ ] `.github/pull_request_template.md` with the Definition of Done checklist from AGENTS.md.
- [ ] The labels are created by the issue import script.
- [ ] Conventions: branch `feature/<number>-<slug>`, commit `<type>(<scope>): <message> (#<number>)`.
- [ ] Make `develop` the default branch on GitHub, otherwise `Closes #N` in a PR into `develop` does not close the issue.

### Acceptance criteria
- [ ] The templates appear when creating an issue and a PR and match AGENTS.md.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [DEC-01] Decision: how new units appear

Labels: `area:design` `type:decision` `P0` `size:XS`

**Milestone:** M0: Foundation · **Priority:** P0 · **Size:** XS (≤ 2 hours) · **Track:** any
**Depends on:** DOC-01

### Context
mechanics.md does not describe unit production. Without this rule SIM-12 cannot be finished.

### Default decision
Recruit in any of your own cities with free capacity: the command `Recruit(node)` creates one discharged unit as a new group for 1 CP; no more than one unit per city per 20 ticks, otherwise the rejection `RECRUIT_COOLDOWN`. The flag `recruit.location = any_city | capital`.

### Alternatives
- Only in the capital (slower arrival at the front, a stronger role for logistics).
- Recruit for charges from the warehouse instead of CP.

### Acceptance criteria
- [ ] The decision is recorded in mechanics.md with the status [accepted] and reflected in `rulesets/mvp-0.toml`.

### How to close
A default value already exists, so the decision takes a couple of hours at most: confirm it or pick an alternative and record it in `docs/design/mechanics.md` with the status [accepted]. It blocks SIM-01 (DEC-05 blocks SRV-04, DEC-06 blocks RAT-02). After that the numbers change only through the ruleset and BAL-02.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [DEC-02] Decision: economy model and CP stance

Labels: `area:design` `type:decision` `P0` `size:XS`

**Milestone:** M0: Foundation · **Priority:** P0 · **Size:** XS (≤ 2 hours) · **Track:** any
**Depends on:** DOC-01

### Default decision
A flat economy: only the capital produces supply. Passively 1 charge per 50 ticks; a stance with three positions (25 / 50 / 75% of CP regeneration goes into charges at the rate 1 CP → 2 charges). Accrual in quanta: once per 50 ticks 100 hundredths of CP are split by the stance; the share going into charges accumulates in an accumulator (in hundredths of a charge) and turns into whole charges. At the CP cap the excess CP burns off; the stance's share into charges is always accrued. Changing the stance is free, no more than once per 100 ticks.

### Alternatives
- A concave model (cities give a small income with diminishing returns): implemented only if BAL-02 fails.
- Two independent flat streams (CP and charges) without conversion.

### Acceptance criteria
- [ ] The decision is recorded in mechanics.md with the status [accepted] and reflected in `rulesets/mvp-0.toml`.

### How to close
A default value already exists, so the decision takes a couple of hours at most: confirm it or pick an alternative and record it in `docs/design/mechanics.md` with the status [accepted]. It blocks SIM-01 (DEC-05 blocks SRV-04, DEC-06 blocks RAT-02). After that the numbers change only through the ruleset and BAL-02.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [DEC-03] Decision: victory condition and match length

Labels: `area:design` `type:decision` `P0` `size:XS`

**Milestone:** M0: Foundation · **Priority:** P0 · **Size:** XS (≤ 2 hours) · **Track:** any
**Depends on:** DOC-01

### Default decision
A 12-minute match (7200 ticks). VP are accrued every 50 ticks for each of your cities (the `vp` value from the map, the capital ×3). Capturing the enemy capital is an instant win. On the timer the winner is the one with more VP; on a tie, more cities; otherwise a draw.

### Alternatives
- A VP threshold instead of a timer, or a bonus for final holding: only if BAL-02 shows the end of the match stalling.

### Acceptance criteria
- [ ] The decision is recorded in mechanics.md with the status [accepted] and reflected in `rulesets/mvp-0.toml`.

### How to close
A default value already exists, so the decision takes a couple of hours at most: confirm it or pick an alternative and record it in `docs/design/mechanics.md` with the status [accepted]. It blocks SIM-01 (DEC-05 blocks SRV-04, DEC-06 blocks RAT-02). After that the numbers change only through the ruleset and BAL-02.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [DEC-04] Decision: visibility rules in the MVP

Labels: `area:design` `type:decision` `P0` `size:XS`

**Milestone:** M0: Foundation · **Priority:** P0 · **Size:** XS (≤ 2 hours) · **Track:** any
**Depends on:** DOC-01

### Context
Refines the information ladder from mechanics.md §10 to a level sufficient for code. The difference from §10: ownership of all nodes and the VP of both sides are public, otherwise the VP scoreboard would reveal hidden information indirectly.

### Default decision
To everyone, always: geography, terrain, road widths, ownership and capacity of all nodes, the VP of both sides, the intents of scheduled orders and constructions (from where → to where, kind; without the size and without the group id). Exactly: your own nodes and the nodes where your groups stand. In the nodes adjacent to them and on adjoining edges: whether there are enemy groups and their mode, but not the number of units and charges. For an enemy group with an ordinary order the target is not shown. The rest is fog with a "last seen" memory. We do not make vision depend on group size in the MVP.

### Alternatives
- Hidden ownership of distant nodes and hidden enemy VP (closer to §10, but the scoreboard becomes useless).

### Acceptance criteria
- [ ] The decision is recorded in mechanics.md with the status [accepted]; each rule is a separate test in SIM-14.

### How to close
A default value already exists, so the decision takes a couple of hours at most: confirm it or pick an alternative and record it in `docs/design/mechanics.md` with the status [accepted]. It blocks SIM-01 (DEC-05 blocks SRV-04, DEC-06 blocks RAT-02). After that the numbers change only through the ruleset and BAL-02.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [DEC-07] Decision: combat resolution (table of worked examples)

Labels: `area:design` `type:decision` `P0` `size:S`

**Milestone:** M0: Foundation · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** any
**Depends on:** DOC-01

### Context
The combat rules in mechanics.md §4 are not fully specified: the order of cancelling virtual charges, the fate of an extra charge, combat on an edge, simultaneous arrival, several groups, a bounce into a lost node. Without this the SIM-09 table tests would have to be invented. The table below is the default value; the SIM-09 tests are exactly this table.

### Default decision
The main rule: each charge is one "shot". It either cancels an enemy charge or kills
one enemy unit. A discharged unit does not shoot.

1. A side's pool Q = the charges of the shooting units + the bonus of a scheduled order or of "Defense" + terrain.
   Units in the "Attack" and "Defense" modes shoot; the charges of units in "Building" are not counted.
   The "Defense" bonus and terrain apply only to the node's defender and only if it has at least
   one shooting charge: mountains +1, plains −1 (a single charged unit cannot shoot, but keeps its charge).
2. Cancelling: c = min(Qa, Qd); each side spends c shots, first the virtual ones (bonus, terrain), then the real ones.
3. The excess s = |Qa − Qd| of the stronger side kills up to s enemy units. After cancelling, all the enemy's
   units are discharged (except the "plains" case), so the discharged ones die first. Each kill
   spends a shot, also the virtual ones first. Shots beyond the number of enemy units are not spent;
   the unspent bonus burns off after the fight.
4. If the defender has no units left, the node goes to the attacker. Otherwise the attacker bounces:
   returns along the same edge to the source node (the trip takes travel_ticks); the order and the bonus burn off.
   If the source node became foreign in the meantime, the arrival there is ordinary, with its own fight.
5. Simultaneous arrival of both sides at a neutral node (there are no neutral garrisons in the MVP) is a symmetric
   fight without terrain and without a "defender"; if both sides are not destroyed, both bounce, the node stays neutral.
6. A meeting on an edge: `progress` is stored in thousandths of the edge; opposing groups meet when the sum of
   progress ≥ 1000. A symmetric fight without terrain; the loser bounces to its source node, a surviving
   winner continues on its way; on a tie both bounce. A bounce from the middle of an edge lasts as long
   as the group had already travelled. Meetings on edges are resolved before arrivals in the same tick.
7. Several groups of one side in a fight are summed but remain separate groups (there is no free merging).
   The discharged units of any group die first, then the units of the group with the largest `units`; shots are spent
   from the group with the largest `charged`; on a tie, by id within the player.
8. A fight is resolved in the tick of arrival: first all movements and arrivals are computed, then all fights; the order of players does not affect the outcome.
9. There is no automatic flight: discharged units stay until the player withdraws them with an order.

Worked examples (forest, no orders unless stated otherwise):

| # | Attack | Defense | Outcome |
|---|---|---|---|
| 1 | 2 charged | 2 charged | both discharged, no losses, the attack bounces |
| 2 | 3 charged | 2 charged | 1 defender killed; the attack (3, all discharged) bounces; the defense has 1 discharged |
| 3 | 4 charged | 2 charged | defense destroyed, node taken by 4 discharged |
| 4 | 1 charged | 10 discharged | 1 killed; the attack is discharged and bounces |
| 5 | 2 charged | empty enemy node | node taken, no charges spent |
| 6 | 3 charged | 2 charged, mountains | Qd = 3: all discharged, no losses, bounce |
| 7 | 2 charged | 3 discharged, mountains | terrain does not apply; 2 killed, bounce |
| 8 | 2 charged | 2 charged, plains | Qd = 1: 1 discharged defender killed; the defense keeps 1 charged; bounce |
| 9 | 2 charged + plan (+2) | 2 charged | the virtual +2 are cancelled; the real 2 kill 2; node taken |
| 10 | 3 charged | 2 charged + "Defense" (+2) | 1 attacker killed; 2 discharged bounce; the defense has 2 units, both discharged |
| 11 | edge: 2 charged | edge: 2 charged | both discharged, both bounce |
| 12 | edge: 3 charged | edge: 1 charged | the opponent is destroyed; the winner has 1 charged, the journey continues |
| 13 | simultaneously into a neutral: 3 charged | 2 charged | 1 killed; both sides bounce; the node is neutral |
| 14 | simultaneously into a neutral: 4 charged | 2 charged | the second side is destroyed; node taken |
| 15 | 3 charged + plan (+2) | 1 discharged | 1 killed (a virtual shot is spent); node taken, the attack has 3 charged |
| 16 | 3 charged | 2 discharged + "Defense" (+2) | the bonus does not apply (no shooting charges); 2 killed; node taken, the attack has 1 charged |

### Alternatives
- An extra charge kills without being spent (attack waves are stronger, a siege is cheaper).
- Terrain applies to the defender even without charges (a siege of attrition is almost impossible in the mountains).

### Acceptance criteria
- [ ] The table is recorded in mechanics.md §4 with the status [accepted].
- [ ] The table is saved as data `packages/protocol/vectors/combat.json` (input, terrain and bonus parameters, expected outcome): both the simulation (SIM-09) and the combat estimate in the client (CLI-08) are tested against it.

### How to close
A default value already exists, so the decision takes a couple of hours at most: confirm it or pick an alternative and record it in `docs/design/mechanics.md` with the status [accepted]. It blocks SIM-01 (DEC-05 blocks SRV-04, DEC-06 blocks RAT-02). After that the numbers change only through the ruleset and BAL-02.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [DEC-08] Decision: modes and scheduled orders

Labels: `area:design` `type:decision` `P0` `size:XS`

**Milestone:** M0: Foundation · **Priority:** P0 · **Size:** XS (≤ 2 hours) · **Track:** any
**Depends on:** DOC-01

### Context
Refines mechanics.md §3 and §5: preparation time, cancellation, the effects of modes.

### Default decision
A scheduled order: the group stands in the source node for `orders.planned_delay_ticks` (30 ticks = 3 s), the intent is already visible to everyone; then it sets out with a +2 bonus for the first fight. The cost is 2 CP instead of 1. "Defense": switching it on is visible to everyone as an intent, the +2 bonus becomes active after 30 ticks and is spent in the first fight; switching it on again costs again (2 CP). "Defense" holds while the group stands; a movement order removes it at no extra cost. "Attack" is the ordinary state without effects (switching is free). "Building" (1 CP): the group's charges are not counted in a fight. Cancelling a scheduled order during the delay costs 1 CP. The full cost table is in SIM-01.

### Alternatives
- The "Defense" bonus applies to every fight while the mode is on (stronger defense, weaker siege).
- Asymmetric cancellation: free when not under threat, expensive under threat.

### Acceptance criteria
- [ ] The decision is recorded in mechanics.md with the status [accepted] and reflected in `rulesets/mvp-0.toml`.

### How to close
A default value already exists, so the decision takes a couple of hours at most: confirm it or pick an alternative and record it in `docs/design/mechanics.md` with the status [accepted]. It blocks SIM-01 (DEC-05 blocks SRV-04, DEC-06 blocks RAT-02). After that the numbers change only through the ruleset and BAL-02.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

## M1: Simulation core

*All MVP rules are implemented in a pure deterministic simulation with no graphics and no network.*

### [MAP-01] Map format and loader

Labels: `area:maps` `type:feature` `P0` `size:S`

**Milestone:** M1: Simulation core · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** B
**Depends on:** INF-02, DOC-01

### Tasks
- [ ] JSON: `nodes[{id, x, y, terrain: plains|forest|mountains, vp, base_capacity, capital_of, start_owner, start_units, start_charged, start_stock}]`, `edges[{id, a, b, base_width, max_width, travel_ticks}]`, `meta{name, version, symmetry: "rot180"}`, `mirror{nodes: {id: id}, edges: {id: id}}`. All numbers are integers.
- [ ] In the MVP every node is a city with a warehouse (record the simplification in mechanics.md); neutral nodes have no garrisons.
- [ ] `node_key(player, node)`: the key for tie-breaks between nodes: for player 0 it is the node id, for player 1 the id of the mirrored node. This way tie-breaks do not break the mirror symmetry.
- [ ] The `MapDef` model (frozen dataclass) and the loader in `gow_sim.maps` with checks of references and ranges.
- [ ] Three tiny test maps in `packages/sim/tests/maps/`: a line of 3 nodes, a 1v1 diamond, a "pass".
- [ ] A description of the format in `docs/design/map-format.md`.

### Acceptance criteria
- [ ] The loader accepts the test maps and rejects broken references and non-integer numbers with a clear error.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [MAP-02] Map validator

Labels: `area:maps` `type:feature` `P0` `size:M`

**Milestone:** M1: Simulation core · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** B
**Depends on:** MAP-01

### Tasks
- [ ] CLI `uv run gow-maps validate <files>`, a non-zero exit code on error.
- [ ] Checks: connectivity; planarity (edges do not cross geometrically); 180° rotational symmetry per the `mirror` table (attributes match, including the start fields, and the coordinates after rotation); node degree ≤ 5; neutral nodes have no garrisons.
- [ ] From each capital to each node with `vp ≥ 2` there are at least two edge-disjoint paths.
- [ ] Neutral space: at least 20% of nodes without a starting owner with a difference of distances to the capitals ≤ 1 step.
- [ ] `travel_ticks` is consistent with the edge length (tolerance from the config).
- [ ] networkx is allowed in `tools/maps`, but not in `gow_sim`.

### Acceptance criteria
- [ ] Each check has a "bad" fixture that fails with a clear message.
- [ ] The test maps from MAP-01 pass.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [MAP-03] Script for mirroring half a map

Labels: `area:maps` `type:feature` `P0` `size:S`

**Milestone:** M1: Simulation core · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** B
**Depends on:** MAP-02

### Tasks
- [ ] `uv run gow-maps mirror maps/src/<name>.half.json -o maps/<name>.json`: half of the map is drawn by hand, the script rotates it by 180°, stitches the edges across the central strip and assigns the mirrored ids.
- [ ] The result is run through the validator right away.

### Acceptance criteria
- [ ] Any valid half gives a map that passes the symmetry check.

### Out of scope
- Procedural map generation: after the MVP.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [MAP-04] MVP map pool: three maps of different character

Labels: `area:maps` `type:feature` `P0` `size:M`

**Milestone:** M1: Simulation core · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** B
**Depends on:** MAP-02, MAP-03

### Tasks
- [ ] "Pass": a mountain ridge in the center, few wide passages.
- [ ] "Web": many narrow paths, frequent detours.
- [ ] "Artery": one wide central axis.
- [ ] 25-40 nodes each, assembled from halves by the MAP-03 script; starting territory and garrisons, meaningful neutral space.
- [ ] A PNG preview (matplotlib) and a description of each map's character in `maps/README.md`.

### Acceptance criteria
- [ ] All three maps pass the validator.
- [ ] The previews are attached to the PR.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SIM-01] Ruleset: all rule numbers and flags as data

Labels: `area:sim` `type:feature` `P0` `size:S`

**Milestone:** M1: Simulation core · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** A
**Depends on:** INF-02, DOC-01, DEC-01, DEC-02, DEC-03, DEC-04, DEC-07, DEC-08

### Context
All the numbers and flags of the design live in one file, so that the open questions and balancing are settled by editing data, not code.

### Tasks
- [ ] `Ruleset` is a frozen dataclass (slots) with the sections: `cp`, `orders`, `combat`, `supply`, `capacity`, `terrain`, `build`, `recruit`, `victory`.
- [ ] Loading from `rulesets/mvp-0.toml` (`tomllib`); unknown keys and out-of-range values are an error.
- [ ] `ruleset_hash` is the blake2b of the canonical representation; every ruleset that was played is saved to `rulesets/archive/<hash>.toml`.
- [ ] The starting values of `mvp-0` are the table below (from mechanics.md §14 and the DECs). Durations are in ticks, CP in hundredths, everything is an integer.
- [ ] `rulesets/test-short.toml` for e2e: a 60-second match.
- [ ] Only the flags that have a default decision; the fallback models (concave economy, VP threshold) are not implemented until BAL-02 fails.

### Values and notes
The starting values of `rulesets/mvp-0.toml`:

| Parameter | Value |
|---|---|
| `tick_hz`, `match_ticks` | 10; 7200 (12 minutes) |
| `cp.start`, `cp.cap`, `cp.per_period`, `cp.period_ticks` | 300; 500; 100 (1 CP); 50 |
| `economy.stance_to_charges_pct` | economy 75, balance 50, war 25 |
| `economy.charges_per_cp`, `economy.passive_period_ticks`, `economy.passive_amount` | 2; 50; 1 |
| `orders.cost` (in hundredths of CP) | Move 100, plan 200, Split 100, Merge 100, "Defense" 200, "Building"/UpgradeRoad 100, "Attack" 0, Recruit 100, cancel 100, stance 0 |
| `orders.planned_delay_ticks`, `orders.defense_delay_ticks`, bonuses | 30; 30; +2 |
| `orders.stance_cooldown_ticks` | 100 |
| `recruit.cooldown_ticks`, `recruit.location` | 20; any_city |
| `terrain.defense_mod` | mountains +1, forest 0, plains −1 |
| `terrain.entry_speed_pct` | plains 125, forest 100, mountains 70 (time = travel_ticks × 100 // pct) |
| `capacity.width_gain_centi` | width 1 → 100, 2 → 150, 3 → 200, 4 → 230, 5 → 260 |
| `capacity.attrition_ticks`, `capacity.grace_ticks` | 30; 50 |
| `supply.dispatch_ticks`, `supply.buffer`, `supply.recharge_per_tick` | 10; 2; 1 |
| `supply.packet_speed_pct` | width 1 → 100, 2 → 125, 3 → 150, 4 → 175, 5 → 200 |
| `build.ticks_per_level` | 150 |
| `victory.vp_period_ticks`, `victory.capital_multiplier` | 50; 3 |

Capacity is a single number that separately limits the number of standing units and separately the warehouse stock.

### Acceptance criteria
- [ ] `rulesets/mvp-0.toml` contains all the values from the table.
- [ ] A typo in a key gives an error with the key's name.
- [ ] The hash is the same in different processes and changes when any value changes.
- [ ] All rule parameters in the systems are read from `Ruleset` (checked in review).

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SIM-02] State model and canonical serialization

Labels: `area:sim` `type:feature` `P0` `size:M`

**Milestone:** M1: Simulation core · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** A
**Depends on:** SIM-01, MAP-01

### Tasks
- [ ] Dataclasses (slots): `GameState(tick, players, nodes, edges, groups, packets, intents, vision_memory, next_id, events)`.
- [ ] A group is counters, not a list of units: `units: int`, `charged: int` (≤ units), `mode`, `location: AtNode(node) | OnEdge(edge, from_node, progress)`.
- [ ] Storage in `dict[int, T]`; any iteration is `sorted()` by id; no `set` in the logic.
- [ ] `to_canonical()` / `from_canonical()`; `state_hash()` = blake2b of the canonical JSON with sorted keys.
- [ ] `initial_state(map, ruleset)`: the starting territory, garrisons and warehouses from the map, CP from the ruleset.

### Acceptance criteria
- [ ] Roundtrip `from_canonical(to_canonical(s)) == s`.
- [ ] `state_hash()` matches in two processes with different `PYTHONHASHSEED` (a test via subprocess).
- [ ] A test: the canonical representation has no values of type `float`.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SIM-03] Visibility: which nodes and edges a player sees

Labels: `area:sim` `type:feature` `P0` `size:S`

**Milestone:** M1: Simulation core · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** A
**Depends on:** SIM-02
**Related:** DEC-04

### Tasks
- [ ] `visible_nodes`, `visible_edges`, `detail_level(state, player, node) -> EXACT | PRESENCE | FOG` per DEC-04.
- [ ] `is_visible(state, player, entity)` is the single point used by command validation (SIM-04) and projection (SIM-14).
- [ ] Updating `vision_memory` in `GameState` (a separate system at the end of the tick).

### Acceptance criteria
- [ ] Unit tests of visibility on the test maps for each detail level, including groups on edges.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SIM-04] Commands: types, validation and application at the tick boundary

Labels: `area:sim` `type:feature` `P0` `size:M`

**Milestone:** M1: Simulation core · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** A
**Depends on:** SIM-02, SIM-03

### Tasks
- [ ] Commands are frozen dataclasses: `Move(group, dest, planned)`, `Split(group, n)`, `Merge(groups)`, `SetMode(group, mode)`, `SetStance(stance)`, `UpgradeRoad(group, edge)`, `Recruit(node)`, `CancelOrder(group)`, `Forfeit()`.
- [ ] `validate(state, player, cmd) -> Ok | Reject(code)`; one code `NOT_FOUND_OR_HIDDEN` for "does not exist" and "not visible".
- [ ] CP is deducted per the ruleset (in hundredths); when short, `Reject(NOT_ENOUGH_CP)`.
- [ ] Commands are applied at the start of the tick in the order `(player_id, seq)`; one player's commands do not affect the validity of another player's commands in the same tick.
- [ ] `Move` validation uses the pathfinding from SIM-05 (a stub until it is ready); the path is returned in the result of application for the `ack`.

### Acceptance criteria
- [ ] Table tests: each command × (valid, no CP, someone else's group, an invisible target, a group on an edge).
- [ ] A rejected command does not change the state (hash comparison).
- [ ] The order in which commands arrive within a tick does not affect the resulting state.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SIM-05] Movement across the graph

Labels: `area:sim` `type:feature` `P0` `size:M`

**Milestone:** M1: Simulation core · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** A
**Depends on:** SIM-04

### Tasks
- [ ] A deterministic Dijkstra over `travel_ticks` with the terrain modifier of the entry node; a tie-break by `node_key(player, node)`.
- [ ] Two-phase movement: first all groups advance and all arrivals are recorded, then combat (SIM-09), with no dependence on player order.
- [ ] Movement along an edge: `progress` in thousandths of the edge, the per-tick increment depends on the terrain of the entry node; groups can stand only in nodes.
- [ ] A path goes only through your own nodes; the first foreign or neutral node on the path is the target of an attack or capture.
- [ ] An empty neutral node is captured on arrival.

### Acceptance criteria
- [ ] The time to traverse an edge equals `travel_ticks` with the terrain modifier.
- [ ] With paths of equal length the same one is always chosen.
- [ ] A mirror test: a mirrored start and mirrored commands on a rot180 map give a mirrored state after 600 ticks.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SIM-06] Economy: CP, stance and production in the capital

Labels: `area:sim` `type:feature` `P0` `size:S`

**Milestone:** M1: Simulation core · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** A
**Depends on:** SIM-02
**Related:** DEC-02

### Tasks
- [ ] CP regeneration per the ruleset and the cap; stored in hundredths.
- [ ] The stance splits the regeneration between CP and charges at the rate from the ruleset.
- [ ] Passive production of the capital; charges are credited to the capital's warehouse within capacity, the excess is lost (with an event).

### Acceptance criteria
- [ ] Tests of regeneration, the cap and each stance position.
- [ ] Over 600 ticks the sum of CP and charges matches the hand-computed one for each stance.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SIM-07] Warehouses, city capacity and attrition

Labels: `area:sim` `type:feature` `P0` `size:M`

**Milestone:** M1: Simulation core · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** A
**Depends on:** SIM-02

### Tasks
- [ ] The connected supplied territory is a BFS from the capital over your own nodes and internal edges.
- [ ] Capacity = `base_capacity` + Σ of the contributions of the widths of internal edges into the connected territory (a table from the ruleset in hundredths, rounded down).
- [ ] Capacity is shared by units and the warehouse (or separate, per the ruleset).
- [ ] Attrition: if the units standing in a node exceed the capacity for longer than `capacity.attrition_ticks` in a row, one unit dies (a discharged one first); transit and the `capacity.grace_ticks` grace after a capture are not counted.
- [ ] When the owner changes, the warehouse is zeroed, the edge widths are kept.
- [ ] Capacity is recomputed only when the topology or ownership changes.

### Acceptance criteria
- [ ] Scenario: a cut-off approach reduces a city's capacity exactly per the table.
- [ ] Scenario: a garrison above capacity loses units at the set pace, starting with the discharged ones; a group passing in transit loses none.
- [ ] Scenario: the warehouse of a captured city is zeroed.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SIM-08] Supply: packets, throughput, recharging

Labels: `area:sim` `type:feature` `P0` `size:L`

**Milestone:** M1: Simulation core · **Priority:** P0 · **Size:** L (4-5 days) · **Track:** A
**Depends on:** SIM-05, SIM-06, SIM-07

### Tasks
- [ ] The flow goes only outward along the tree of shortest paths from the capital (each node has a parent in the direction of the capital). By construction there are no cycles and no "ping-pong".
- [ ] A node's target stock = the number of discharged standing units + `supply.buffer`; the subtree deficit = its own deficit + the deficits of the children's subtrees (computed bottom-up once per `supply.dispatch_ticks`).
- [ ] A node sends to its children everything above its target stock, in descending order of subtree deficit (a tie-break by `node_key`), so charges go deeper in transit.
- [ ] Packets travel only along internal edges, no more than `width` charges per edge per period; travel time = `travel_ticks × 100 // packet_speed_pct[width]` (mechanics.md §8: width affects speed and volume).
- [ ] A packet on an edge that stopped being internal is lost (an event).
- [ ] Recharging: units standing in a node are charged from the warehouse no faster than `supply.recharge_per_tick`; they are not charged on edges.
- [ ] Budget: the supply step is O(V + E) per tick.

### Acceptance criteria
- [ ] Scenario: a cut road → the warehouse behind it stops being replenished, the units there stop recharging.
- [ ] Scenario: a road of width 3 delivers three times as much as width 1 in the same time.
- [ ] A test: 1000 ticks without fights, no packet moves toward the capital.
- [ ] Scenario: a chain capital → A → B, a deficit only in B: charges reach B through A.
- [ ] Benchmark: the supply step on a 40-node map ≤ 0.1 ms on the reference machine.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SIM-09] Combat per the DEC-07 table

Labels: `area:sim` `type:feature` `P0` `size:L`

**Milestone:** M1: Simulation core · **Priority:** P0 · **Size:** L (4-5 days) · **Track:** A
**Depends on:** SIM-05, SIM-07
**Related:** DEC-07

### Tasks
- [ ] Implement rules 1-9 from DEC-07: a pool with virtual charges, cancelling, excess, bounce, symmetric fights, a fight on an edge, several groups.
- [ ] The combat function receives the sides' bonuses as an input parameter (their source is SIM-10), so rows 9, 10, 15, 16 are tested before SIM-10.
- [ ] Terrain and bonus parameters come from the ruleset; the table tests run on the pinned `tests/rulesets/dec07.toml`, so that balance iterations do not break the rule tests.
- [ ] Combat events: participants, the pool before and after, losses, bounce.

### Acceptance criteria
- [ ] Each row of `packages/protocol/vectors/combat.json` (the DEC-07 table) is a separate parameterized test; the expected values are taken from the table, not from the code's output.
- [ ] A "siege of attrition" scenario on `tests/maps/siege.json` with `tests/rulesets/siege.toml`: with cut roads the city falls exactly on wave N, with open ones it does not fall in 10 waves; N is computed by hand in the test description.
- [ ] The mirror test (SIM-05) passes with fights in the central node.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SIM-10] Orders: scheduled, the "Defense" mode, cancellation

Labels: `area:sim` `type:feature` `P0` `size:M`

**Milestone:** M1: Simulation core · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** A
**Depends on:** SIM-04, SIM-09
**Related:** DEC-08

### Tasks
- [ ] A scheduled `Move` per DEC-08: the delay `orders.planned_delay_ticks`, the cost, a one-off bonus.
- [ ] The intent registry `intents`: owner, from where, to where, kind, without the size and without the group id.
- [ ] "Defense" per DEC-08; "Building": the charges do not take part in a fight.
- [ ] Cancelling a scheduled order and "Defense" costs `orders.cancel_cp`.

### Acceptance criteria
- [ ] Tests of the delay, the cost, the bonus expenditure, cancellation.
- [ ] The intent registry contains no size and no group ids (a test).

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SIM-11] The "Building" mode: road upgrades

Labels: `area:sim` `type:feature` `P0` `size:S`

**Milestone:** M1: Simulation core · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** any
**Depends on:** SIM-04, SIM-07

### Tasks
- [ ] A group in the "Building" mode at the end of an internal edge raises the width by 1 every `build.ticks_per_level`, up to `max_width`.
- [ ] Buffer edges cannot be upgraded.
- [ ] Construction is interrupted by a fight or the group leaving; the level's progress is lost.
- [ ] Recompute capacity and throughput after an increase.
- [ ] `upgrade_gain(edge)`: how much capacity and throughput the next level gives (for a hint in the client, mechanics.md §18).

### Acceptance criteria
- [ ] Scenario: the width grows exactly per the ruleset and stops at `max_width`.
- [ ] `UpgradeRoad` on a buffer edge is rejected.
- [ ] `upgrade_gain` matches the difference of capacities before and after the upgrade.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SIM-12] Unit recruiting

Labels: `area:sim` `type:feature` `P0` `size:S`

**Milestone:** M1: Simulation core · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** any
**Depends on:** SIM-04, SIM-07
**Related:** DEC-01

### Tasks
- [ ] The DEC-01 rule with the flag `recruit.location`.
- [ ] A check of free capacity and of the per-city cooldown.

### Acceptance criteria
- [ ] Tests: a recruit in a full city is rejected; the cooldown is respected; the unit appears discharged.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SIM-13] Victory: VP, capital capture, timer, tie-break

Labels: `area:sim` `type:feature` `P0` `size:S`

**Milestone:** M1: Simulation core · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** any
**Depends on:** SIM-09
**Related:** DEC-03

### Tasks
- [ ] VP accrual per DEC-03; instant victory for capturing the capital.
- [ ] Ending on the timer, tie-break, draw.
- [ ] `Forfeit` is the defeat of the one who surrenders; the server uses the same command for a technical defeat.

### Acceptance criteria
- [ ] Scenario tests for every way to end, including a draw and a surrender.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SIM-14] Projection: PlayerView

Labels: `area:sim` `type:feature` `P0` `size:M`

**Milestone:** M1: Simulation core · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** A
**Depends on:** SIM-03, SIM-05, SIM-10, SIM-11
**Related:** DEC-04

### Tasks
- [ ] `project(state, player) -> PlayerView` is a pure function, reads `vision_memory` from the state; this is the only thing a player or a bot sees.
- [ ] Opaque ids for each player: a keyed blake2b of `(match_key, player, internal_id)`, where `match_key` is the match secret that the server generates and passes into `Match` (and writes into the replay); they are not sequential and cannot be recovered by brute force.
- [ ] `resolve(state, player, cmd)` turns the opaque ids of a command into internal ones: a common function for the server and `run_headless`.
- [ ] The capacity of all nodes is in the view (DEC-04).
- [ ] The DEC-04 detail levels: exact numbers, "there are enemy groups" without numbers, fog with memory.
- [ ] Global intents without the size and group ids; the target of the opponent's ordinary order is not shown.
- [ ] Your own edges come with `upgrade_gain`.
- [ ] Not in the view: the opponent's CP, stance and production, events in the fog, the opponent's overall counters.

### Acceptance criteria
- [ ] The projection is deterministic (the same view hash in two processes).
- [ ] Each DEC-04 rule is a separate test.
- [ ] A property test (Hypothesis on random states of the scenario maps): the view has no entities from invisible nodes and edges.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SIM-15] Match engine and headless run

Labels: `area:sim` `type:feature` `P0` `size:M`

**Milestone:** M1: Simulation core · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** A
**Depends on:** SIM-08, SIM-10, SIM-11, SIM-12, SIM-13, SIM-14

### Tasks
- [ ] `Match(map, ruleset, match_key)` with the method `step(commands) -> list[Event]`.
- [ ] A fixed order of systems: `apply_commands → economy → movement → combat → capacity → supply → recruit → build → victory → vision` (the last system updates the fog memory).
- [ ] `run_headless(map, ruleset, controllers, max_ticks, decide_every=5) -> MatchResult`; controllers are called once per `decide_every` ticks.
- [ ] The reference machine for the budgets is described in `docs/perf.md`.

### Acceptance criteria
- [ ] A simulation step without projections on a 40-node map with 40 groups: on average ≤ 0.3 ms, p99 ≤ 1 ms; one projection ≤ 0.3 ms.
- [ ] A full match of two simple bots runs in ≤ 8 seconds.
- [ ] `pytest-benchmark` fails on a regression of more than 50%.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SIM-16] Determinism and replays

Labels: `area:sim` `type:test` `P0` `size:M`

**Milestone:** M1: Simulation core · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** A
**Depends on:** SIM-15

### Tasks
- [ ] The replay format `.jsonl.gz` (gzip from the standard library): a header `{sim_version, ruleset_hash, python_version, map_id, map_hash, match_key}`, then `(tick, player, seq, cmd)` and control hashes every 50 ticks.
- [ ] `replay_run(file)` and the CLI `python -m gow_sim.replay check <files>` verify the hashes and on a divergence save a dump of both states.
- [ ] A determinism test: one match in three fresh processes with different `PYTHONHASHSEED` gives identical hashes.
- [ ] Golden replays in `packages/sim/tests/golden/v{SIM_VERSION}/`; the regeneration script creates the directory of the new version.

### Acceptance criteria
- [ ] CI runs the determinism test and the golden replays of the current version.
- [ ] Editing a rule without raising `SIM_VERSION` breaks CI (the hashes of the current references diverge); CI also checks that the directories of earlier versions were not changed.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SIM-17] Property-based tests of invariants (Hypothesis)

Labels: `area:sim` `type:test` `P0` `size:M`

**Milestone:** M1: Simulation core · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** any
**Depends on:** SIM-15

### Tasks
- [ ] `RuleBasedStateMachine`: the rules generate random valid commands and tick steps.
- [ ] Invariants: conservation of charges (produced = warehouses + in transit + in units + spent + lost); no negative counters; `charged ≤ units`; every group is in an existing node or on an edge; without new arrivals a garrison above capacity does not grow.
- [ ] The fog invariant on a full match: `project(state, p)` has no entities from nodes and edges invisible to `p`.

### Acceptance criteria
- [ ] The tests pass in the `ci` profile in ≤ 60 seconds.
- [ ] Counterexamples found by Hypothesis are saved as regression tests.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

## M2: Bots and balance gate

*The bot tournament shows that the mechanics do not collapse into a single strategy.*

### [BOT-01] Controller interface, base bots and seed-driven variability

Labels: `area:bots` `type:feature` `P0` `size:S`

**Milestone:** M2: Bots and balance gate · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** A
**Depends on:** SIM-15, MAP-04

### Tasks
- [ ] `Controller.decide(view: PlayerView, tick) -> list[Command]`; bots see only the `PlayerView`.
- [ ] `IdleBot` and `RandomLegalBot`.
- [ ] Each bot gets parameters (aggression, expansion radius, attack threshold, etc.) from ranges chosen deterministically from the match seed, otherwise deterministic matches repeat.
- [ ] A common utility function "ordinary or scheduled order" that computes the benefit from the ruleset prices: the share of plans is determined by the price, not by the bot's code.

### Acceptance criteria
- [ ] A `RandomLegal` vs `RandomLegal` match finishes without exceptions on all MVP maps.
- [ ] 100 seeds of one pair of bots give at least 30 distinct final hashes.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [BOT-02] Strategy bots: Expander and Turtle

Labels: `area:bots` `type:feature` `P0` `size:M`

**Milestone:** M2: Bots and balance gate · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** any
**Depends on:** BOT-01

### Tasks
- [ ] `ExpanderBot`: captures neutral nodes, builds roads in the rear.
- [ ] `TurtleBot`: a bunker: holds a small region, accumulates charges, holds "Defense" (the check of Topic 2).

### Acceptance criteria
- [ ] Each beats `RandomLegal` in ≥ 90% on all MVP maps.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [BOT-03] Strategy bots: Rusher, Strangler and Reactive

Labels: `area:bots` `type:feature` `P0` `size:L`

**Milestone:** M2: Bots and balance gate · **Priority:** P0 · **Size:** L (4-5 days) · **Track:** any
**Depends on:** BOT-01

### Tasks
- [ ] `RusherBot`: early pressure, scheduled strikes on weak cities.
- [ ] `StranglerBot`: cutting roads and a siege of attrition.
- [ ] `ReactiveBot`: reacts to the opponent's visible intents: reinforces the target, switches on "Defense" or hits an exposed spot.

### Acceptance criteria
- [ ] Each beats `RandomLegal` in ≥ 90% on all MVP maps.
- [ ] Behavior scenario tests: `StranglerBot` cuts a road on the map `siege.json`; `ReactiveBot` answers a visible intent within 10 ticks.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [BOT-04] Tournament harness and match analyzer

Labels: `area:bots` `type:feature` `P0` `size:M`

**Milestone:** M2: Bots and balance gate · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** A
**Depends on:** BOT-01, SIM-16

### Tasks
- [ ] CLI `uv run gow-bots tournament --maps ... --bots ... --seeds 100 --jobs N --ruleset ...`; `ProcessPoolExecutor`, one match per process, both sides for each pair.
- [ ] `gow_sim.analysis`: metrics from the match event log: winner, side, duration, the share of scheduled attacks, siege attempts and successes, captures by minute, final VP, the reason for ending. The same analyzer is applied to real matches (PT-01, REL-01).
- [ ] Results in JSONL; optionally saving replays.

### Acceptance criteria
- [ ] 1000 matches in ≤ 20 minutes on 8 cores of the reference machine.
- [ ] A repeat run with the same parameters gives an identical JSONL.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [BOT-05] Balance report

Labels: `area:bots` `type:feature` `P0` `size:S`

**Milestone:** M2: Bots and balance gate · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** any
**Depends on:** BOT-02, BOT-03, BOT-04

### Tasks
- [ ] `uv run gow-bots report <file.jsonl>`: markdown + matplotlib charts in `docs/balance/`.
- [ ] Sections: a win matrix of pairs of strategy bots with 95% confidence intervals (Wilson); side advantage; the share of scheduled attacks; siege success; the `TurtleBot` win rate; captures in the last 3 minutes; the number of unique outcomes; a breakdown by map.

### Acceptance criteria
- [ ] The report is generated with one command.
- [ ] Bot competence checks in the report: `StranglerBot` takes at least one city by siege in ≥ 50% of matches against `ExpanderBot`; `ReactiveBot` beats `RusherBot` more often than `ExpanderBot` beats `RusherBot`.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [BAL-01] Balance: first run and verdict

Labels: `area:design` `type:decision` `P0` `size:S`

**Milestone:** M2: Bots and balance gate · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** A
**Depends on:** BOT-05, DEC-01, DEC-02, DEC-03, DEC-04, DEC-07, DEC-08

### Tasks
- [ ] A tournament on all MVP maps with `mvp-0`, the report in `docs/balance/`.
- [ ] Compare with the gate criteria (BAL-02) and write the hypotheses for iterations in `docs/balance/log.md`.

### Acceptance criteria
- [ ] The report and the list of hypotheses are published in the PR.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [BAL-02] Balance gate: iterations (5-day timebox)

Labels: `area:design` `type:decision` `P0` `size:L`

**Milestone:** M2: Bots and balance gate · **Priority:** P0 · **Size:** L (4-5 days) · **Track:** A
**Depends on:** BAL-01

### Context
The iterations edit the ruleset and, if needed, the bots (if a bot plays stupidly) and the rules code (if a bug is found). Each iteration is recorded in `docs/balance/log.md`: hypothesis, change, result. If the gate is not passed in 5 days, a design discussion before continuing M5.

### Tasks
- [ ] Iterations `mvp-1`, `mvp-2`… with a re-run of the tournament.

### Acceptance criteria
- [ ] No strategy bot beats all the other strategy bots in total more than 65% (Idle and Random are not counted).
- [ ] The side advantage on each map is < 55%, and the 95% confidence interval includes 50%.
- [ ] The share of scheduled attacks among the strategy bots is 20-70%.
- [ ] `TurtleBot` beats `ExpanderBot` in < 40%.
- [ ] At least one capture in the last 3 minutes in ≥ 30% of matches between strategy bots.
- [ ] The final ruleset is fixed as `rulesets/mvp.toml` and saved in the archive by hash.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

## M3: Match server

*An authoritative server runs a match between two WebSocket clients with fog of war.*

### [SRV-01] FastAPI server skeleton

Labels: `area:server` `type:feature` `P0` `size:S`

**Milestone:** M3: Match server · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** A
**Depends on:** INF-02

### Tasks
- [ ] An app factory, `lifespan` (not `on_event`), settings through `pydantic-settings`, `/api/health`.
- [ ] Structured logs (JSON), a request id.
- [ ] Serving maps: `/api/maps` and `/api/maps/{id}` (JSON and the background PNG, if any).
- [ ] Started only with `--workers 1`; `--ws-max-size 65536`; `--forwarded-allow-ips` for Caddy.
- [ ] The `Clock` abstraction (`now()`, `async sleep()`): a real clock in prod, a controllable one in tests.

### Acceptance criteria
- [ ] `uv run gow-server` brings up the server; health and maps are served; a test via `httpx`.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [DB-01] Storage: SQLAlchemy 2, Alembic, SQLite in WAL mode

Labels: `area:server` `type:feature` `P0` `size:S`

**Milestone:** M3: Match server · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** any
**Depends on:** SRV-01

### Tasks
- [ ] `Mapped[]` models: `players`, `ratings`, `matches`, `match_players`; separate from the protocol models.
- [ ] Alembic with `render_as_batch=True`, the first migration.
- [ ] PRAGMAs on connect: `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- [ ] Synchronous SQLAlchemy only in `def` endpoints (the FastAPI threadpool) or through `asyncio.to_thread`; never inside `async def` and the match tick.

### Acceptance criteria
- [ ] A test checks that `PRAGMA journal_mode` returns `wal`.
- [ ] `alembic upgrade head` on an empty database passes.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [ID-01] Guest identity and nicknames

Labels: `area:server` `type:feature` `P0` `size:S`

**Milestone:** M3: Match server · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** any
**Depends on:** DB-01

### Tasks
- [ ] `POST /api/guest` → `{player_id, token}`; the token from `secrets.token_urlsafe(32)`, only the SHA-256 in the database.
- [ ] HTTP: `Authorization: Bearer`; the token is never written to logs and never passed in a URL.
- [ ] Nickname: length 3-16, allowed characters; case-insensitive uniqueness through a separate column `nick_key = nick.casefold()` with a unique index (NOCASE in SQLite works only for ASCII).
- [ ] Rate limiting of guest creation by IP.

### Acceptance criteria
- [ ] Tests: a wrong token → 401; the token does not appear in the logs (logger interception); the nickname is validated.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [PRO-01] Protocol: message schema and JSON fixtures

Labels: `area:protocol` `type:feature` `P0` `size:M`

**Milestone:** M3: Match server · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** any
**Depends on:** SIM-02, DEC-04

### Context
The schema is separated from the converters so that the client can start its network layer before the whole simulation is ready.

### Tasks
- [ ] `ClientMsg` is a tagged union on the field `type`: `hello{protocol_version, token}`, `command{seq, cmd}`, `ping`, `resync`.
- [ ] `ServerMsg`: `welcome{player, ruleset_public, map_id, last_seq}`, `snapshot{tick, view}`, `ack{seq, applied_tick, path | reject_code}`, `event`, `match_end`, `error`, `pong`.
- [ ] `model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)` everywhere (otherwise the token from `hello` ends up in the error text and in the logs); `PROTOCOL_VERSION` is an integer.
- [ ] `ruleset_public` is only what the client needs: command costs and the combat estimate parameters.
- [ ] JSON fixtures of typical messages in `packages/protocol/fixtures/`: the client tests use them.
- [ ] The `codec` module (JSON now, msgpack later by replacing one file).

### Acceptance criteria
- [ ] Roundtrip tests of all messages and fixtures.
- [ ] Hypothesis fuzzing: arbitrary bytes on input give only `ValidationError`, no other exceptions.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [PRO-02] TypeScript type generation and schema drift check

Labels: `area:protocol` `type:chore` `P0` `size:S`

**Milestone:** M3: Match server · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** B
**Depends on:** PRO-01, INF-03, INF-04

### Tasks
- [ ] `scripts/export_schema.py`: `TypeAdapter(...).json_schema()` for both unions → `protocol.schema.json`; `json2ts` → `apps/client/src/protocol.gen.ts`; the npm script `pnpm gen:protocol`.
- [ ] A CI job `protocol-drift`: regeneration + `git diff --exit-code`.

### Acceptance criteria
- [ ] Changing a field in a Pydantic model without regenerating breaks CI.
- [ ] In `protocol.gen.ts` the message union narrows by `type`.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [PRO-03] Protocol: converters between the simulation and messages

Labels: `area:protocol` `type:feature` `P0` `size:S`

**Milestone:** M3: Match server · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** A
**Depends on:** PRO-01, SIM-14

### Tasks
- [ ] `PlayerView → SnapshotMsg`, a client command → a simulation command, simulation events → `event` (only those visible to the player).

### Acceptance criteria
- [ ] Converter tests on the scenario maps; no hidden field gets into a message.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SRV-02] MatchRunner and MatchManager: the match tick loop

Labels: `area:server` `type:feature` `P0` `size:M`

**Milestone:** M3: Match server · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** A
**Depends on:** SIM-15, SRV-01

### Tasks
- [ ] One `asyncio` task per match; a loop on `Clock` with `next += dt`; when more than 3 ticks behind, `next` is reset to the current time instead of endless catching up.
- [ ] Pauses: the loop waits for a resume event and recomputes `next` after it.
- [ ] An incoming command queue, applied at the tick boundary; there is no `await` inside the step.
- [ ] After the step, a projection for each player once per tick and sending through the connection queues.
- [ ] `MatchManager`: a registry of matches, strong references to tasks, logging of exceptions with the match id; the crash of one match does not touch the others.

### Acceptance criteria
- [ ] A test with a controllable clock: a match of two fake controllers runs to the end without real waiting.
- [ ] A test: a clock "freeze" of 2 seconds does not lead to a burst of 20 steps.
- [ ] A test: an exception in one match does not stop the other.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SRV-03] Match WebSocket: authentication, reading, writing, commands

Labels: `area:server` `type:feature` `P0` `size:M`

**Milestone:** M3: Match server · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** A
**Depends on:** SRV-02, PRO-03, ID-01

### Tasks
- [ ] `/ws/match/{id}`: a check of `Origin`; the first message `hello` with the token within 5 seconds, otherwise closing.
- [ ] A `PROTOCOL_VERSION` mismatch → closing with code 4001.
- [ ] Reading and writing tasks in a `TaskGroup`. Snapshots are a "latest only" cell; `ack`, `event`, `match_end`, `error` are a reliable FIFO queue. `send` with a timeout, a hung client is disconnected.
- [ ] An application-level `ping/pong` for RTT.
- [ ] Deduplication by `seq`, `ack` with the tick of application and the path or the rejection code.
- [ ] A token bucket on the player's commands; a flood → disconnect.

### Acceptance criteria
- [ ] Integration tests on a `websockets` client: a wrong Origin, no hello, an old protocol version, a flood, a repeated `seq`, a slow client does not slow the tick and does not lose an `ack`.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [DEC-05] Decision: disconnection and pauses

Labels: `area:design` `type:decision` `P0` `size:XS`

**Milestone:** M3: Match server · **Priority:** P0 · **Size:** XS (≤ 2 hours) · **Track:** any
**Depends on:** DOC-01

### Default decision
60 seconds to reconnect, the match keeps going meanwhile; then a technical defeat (written to the replay log as the command `Forfeit`). There are no pauses in ranked matches; in private ones, one pause of up to 60 seconds per player. Server settings, not the ruleset's.

### Alternatives
- A bot takes control for the duration of the disconnection.

### Acceptance criteria
- [ ] The decision is recorded in mechanics.md with the status [accepted].

### How to close
A default value already exists, so the decision takes a couple of hours at most: confirm it or pick an alternative and record it in `docs/design/mechanics.md` with the status [accepted]. It blocks SIM-01 (DEC-05 blocks SRV-04, DEC-06 blocks RAT-02). After that the numbers change only through the ruleset and BAL-02.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SRV-04] Reconnection and the disconnect policy

Labels: `area:server` `type:feature` `P0` `size:S`

**Milestone:** M3: Match server · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** A
**Depends on:** SRV-03, DEC-05

### Tasks
- [ ] Reconnecting with the same token within the DEC-05 window; the full view and `last_seq` in `welcome`.
- [ ] The window expires → a `Forfeit` command on behalf of the disconnected player (written to the replay log).
- [ ] Pauses for private matches per DEC-05.

### Acceptance criteria
- [ ] A test with a controllable clock: a disconnect and a reconnect after 10 s restore the view; after 61 s, a defeat.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SRV-05] Private match via an invite link

Labels: `area:server` `type:feature` `P0` `size:S`

**Milestone:** M3: Match server · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** any
**Depends on:** SRV-03

### Tasks
- [ ] `POST /api/matches` (a map from the pool) → an invite code; `POST /api/matches/{code}/join`.
- [ ] Both players ready → start; an unused invite expires after 30 minutes.

### Acceptance criteria
- [ ] A test: create, join, both ready → the match starts; a third player gets a refusal.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SRV-06] Match against a bot

Labels: `area:server` `type:feature` `P0` `size:S`

**Milestone:** M3: Match server · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** A
**Depends on:** SRV-02, BOT-02

### Tasks
- [ ] The "against a bot" mode: the bot's controller in the server process gets the same `PlayerView`, decides once per 5 ticks.
- [ ] Bot choice (several difficulty levels = different bots and parameters).
- [ ] The bot's decision fits into 1 ms; otherwise the bot skips the next call (with a metric).

### Acceptance criteria
- [ ] A test: a match of a scripted client against a bot finishes.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SRV-07] Replays: recording and the frames file for viewing

Labels: `area:server` `type:feature` `P0` `size:M`

**Milestone:** M3: Match server · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** any
**Depends on:** SRV-02, SIM-16, DB-01

### Context
Viewing does not require re-simulation in the browser and does not break when `SIM_VERSION` changes: after the match the server re-simulates the log once and writes full frames.

### Tasks
- [ ] The command log `data/replays/{id}.jsonl.gz` is written during the match; metadata in `matches`.
- [ ] After the match, re-simulation of the log in a `ProcessPoolExecutor` (not in the event loop and not in a thread: the GIL gets in the way), a check of the hashes and the frames file `data/replays/{id}.frames.json.gz`: the full state 2 times per second + events.
- [ ] `GET /api/replays/{id}` serves the frames file; access is for the participants, the replays of ranked matches are public.

### Acceptance criteria
- [ ] A test: re-simulating a finished match gives the same result and hashes; the frames file of a 12-minute match ≤ 2 MB.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SRV-08] Integration test: two scripted clients play a match

Labels: `area:qa` `type:test` `P0` `size:S`

**Milestone:** M3: Match server · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** A
**Depends on:** SRV-04, SRV-05

### Tasks
- [ ] The test brings up the server, two clients on `websockets` go through an invite and play with bots over the protocol to the end on `test-short`.
- [ ] Checks: a client never received an entity from an invisible node; the result matches `run_headless` on the same commands.

### Acceptance criteria
- [ ] The test runs in CI in ≤ 90 seconds.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [SRV-09] Match lifecycle

Labels: `area:server` `type:feature` `P0` `size:M`

**Milestone:** M3: Match server · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** any
**Depends on:** SRV-05, DB-01

### Tasks
- [ ] States: created → waiting for readiness → running → finished → saved → cleaned up; a no-show timeout.
- [ ] The result of each match (ranked or not) is written to the DB outside the tick.
- [ ] A rule: a player has at most one active match or queue spot.
- [ ] A whitelist of rulesets: `test-short` is available only in the dev and e2e environment.

### Acceptance criteria
- [ ] Tests for each state transition, a no-show and an attempt at a second active match.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

## M4: Web client and internal playtest

*Two people play a full match in browsers; there is play against a bot and replay viewing; the internal playtest gave a "go".*

### [CLI-01] Client network layer

Labels: `area:client` `type:feature` `P0` `size:M`

**Milestone:** M4: Web client and internal playtest · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** B
**Depends on:** PRO-02, INF-03

### Tasks
- [ ] A typed WebSocket client on `protocol.gen.ts`; `hello` with the token as the first message.
- [ ] Reconnection with an exponential delay; on code 4001, a request to reload the page.
- [ ] Tracking commands until the `ack`; retrying unconfirmed ones after reconnection.
- [ ] RTT via `ping/pong`.

### Acceptance criteria
- [ ] Vitest with a fake server on the PRO-01 fixtures: reconnection, command retry, code 4001.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [CLI-02] Snapshot buffer and interpolation

Labels: `area:client` `type:feature` `P0` `size:S`

**Milestone:** M4: Web client and internal playtest · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** B
**Depends on:** CLI-01

### Tasks
- [ ] A ring buffer of snapshots by tick; rendering 2-3 snapshots behind (configurable).
- [ ] Interpolation of the `progress` of groups and packets on edges; no extrapolation and no prediction.
- [ ] Resetting the buffer on `resync` and on reconnection.
- [ ] The buffer is plain TypeScript, not `$state`.

### Acceptance criteria
- [ ] Vitest: interpolation between two snapshots; a skipped and a duplicate snapshot.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [CLI-03] Map rendering and camera

Labels: `area:client` `type:feature` `P0` `size:M`

**Milestone:** M4: Web client and internal playtest · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** B
**Depends on:** INF-03, MAP-01

### Context
It can start before the protocol is ready: the map is loaded from JSON directly.

### Tasks
- [ ] Container layers: background, territory, roads, nodes, groups, intents, fog, effects.
- [ ] The background is a fill by terrain (or the PNG from MAP-05, if there is one).
- [ ] Road thickness by width; the node's owner is color and outline (not color alone); a capital icon; the node's VP.
- [ ] Camera: dragging, wheel, "fit the map"; correct on HiDPI.
- [ ] Shared `GraphicsContext`s for identical shapes; `destroy` of everything created.

### Acceptance criteria
- [ ] All MVP maps are displayed; 60 FPS on the integrated graphics of the reference laptop.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [CLI-04] Rendering groups, charges, warehouses, packets and intents

Labels: `area:client` `type:feature` `P0` `size:L`

**Milestone:** M4: Web client and internal playtest · **Priority:** P0 · **Size:** L (4-5 days) · **Track:** B
**Depends on:** CLI-02, CLI-03

### Tasks
- [ ] A group: the number of units and charges, the mode. A charge is distinguishable not by color alone: a filled and an empty dot.
- [ ] The fog detail levels: exact numbers, "there is an enemy" without numbers.
- [ ] A warehouse: a fill bar relative to capacity.
- [ ] Packets are an animation of movement along roads.
- [ ] The intents (scheduled orders and constructions) of both sides are arrows.
- [ ] A fight marker in a node with the participants and the result (from events).

### Acceptance criteria
- [ ] For three pre-recorded snapshots (fixtures) a Playwright screenshot test matches the reference.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [CLI-05] Fog of war on the client

Labels: `area:client` `type:feature` `P0` `size:S`

**Milestone:** M4: Web client and internal playtest · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** B
**Depends on:** CLI-04

### Tasks
- [ ] Darkening of invisible nodes and edges.
- [ ] "Ghosts" from the "last seen" memory with an age.

### Acceptance criteria
- [ ] The invisible is visually different from the visible; ghosts disappear on being seen again.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [CLI-06] Selection and movement: ordinary and scheduled orders

Labels: `area:client` `type:feature` `P0` `size:M`

**Milestone:** M4: Web client and internal playtest · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** B
**Depends on:** CLI-04

### Tasks
- [ ] Selecting a group and a node by click; deselecting.
- [ ] A movement order by clicking the target; a scheduled one with Shift or a toggle.
- [ ] Preview: the target and the cost in CP; the path is drawn from the `ack` (the client does not compute the path).
- [ ] A ghost arrow until the `ack`, a rollback on rejection with a clear message; cancelling an order.

### Acceptance criteria
- [ ] All scenarios work with the mouse; the hotkeys are described in a hint.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [CLI-07] Remaining commands: split, merge, modes, recruit, build, stance, surrender

Labels: `area:client` `type:feature` `P0` `size:M`

**Milestone:** M4: Web client and internal playtest · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** B
**Depends on:** CLI-06

### Tasks
- [ ] Splitting (a slider or a number) and merging groups in a node.
- [ ] Modes A / D / B (hotkeys); a road upgrade with the `upgrade_gain` hint ("+1.5 city capacity").
- [ ] Recruit in the selected city; the stance toggle.
- [ ] A "Surrender" button with confirmation.

### Acceptance criteria
- [ ] Each command is sent and confirmed, or rejected with a message.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [CLI-08] HUD

Labels: `area:client` `type:feature` `P0` `size:M`

**Milestone:** M4: Web client and internal playtest · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** B
**Depends on:** CLI-02, PRO-02, SIM-09

### Tasks
- [ ] CP with regeneration, stance, the VP of both sides, the timer.
- [ ] A panel of the selected group or city: units, charges, capacity, warehouse.
- [ ] A combat estimate before an attack from `ruleset_public`: exact if the enemy is fully visible, otherwise an upper bound by the node's capacity ("no more than N"). Marked as an estimate.
- [ ] A feed of visible events.
- [ ] The HUD data is a class in `.svelte.ts` with a field `current = $state.raw(...)` that is replaced once per snapshot (10 Hz), not every frame (Svelte does not compile exporting a reassignable `$state` from a module).

### Acceptance criteria
- [ ] The estimate function passes all rows of `packages/protocol/vectors/combat.json` in Vitest.
- [ ] The HUD values match the snapshot; the profiler does not show a Svelte recomputation every frame.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [CLI-09] Screens and navigation

Labels: `area:client` `type:feature` `P0` `size:M`

**Milestone:** M4: Web client and internal playtest · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** B
**Depends on:** CLI-01, ID-01, SRV-05, SRV-06

### Tasks
- [ ] REST types: FastAPI OpenAPI → `openapi-typescript` → `apps/client/src/api.gen.ts` (part of the drift check).
- [ ] A welcome screen (guest creation, nickname), the main menu.
- [ ] Creating a private match with a choice of map and joining via the link `?m=<code>`; the readiness waiting screen.
- [ ] "Play against a bot": choice of bot and map.
- [ ] The match screen; the result screen (outcome, VP, a replay button).
- [ ] Navigation through state, without SvelteKit; no `{@html}` with user data.

### Acceptance criteria
- [ ] The path "opened a link → entered a nickname → ended up in a match" takes ≤ 3 actions.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [CLI-10] Replay viewing

Labels: `area:client` `type:feature` `P0` `size:S`

**Milestone:** M4: Web client and internal playtest · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** B
**Depends on:** SRV-07, CLI-04

### Tasks
- [ ] Loading the frames file and the same rendering in spectator mode with full reveal.
- [ ] Speed ×1 / ×4 / ×16, pause, seeking with a slider.

### Acceptance criteria
- [ ] The replay of a finished match opens from the result screen.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [CLI-11] English localization and language selection

Labels: `area:client` `type:feature` `P1` `size:S`

**Milestone:** M4: Web client and internal playtest · **Priority:** P1 · **Size:** S (≤ 1 day) · **Track:** B
**Depends on:** INF-03

### Tasks
- [ ] An en dictionary for all the ru keys (uk after the MVP).
- [ ] Language selection by the browser with the option to switch.

### Acceptance criteria
- [ ] A check script: no interface strings outside the dictionaries, the dictionaries have the same set of keys.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [QA-01] First live match: manual checklist

Labels: `area:qa` `type:test` `P0` `size:S`

**Milestone:** M4: Web client and internal playtest · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** any
**Depends on:** CLI-05, CLI-07, CLI-08, CLI-09, CLI-10, SRV-04, SRV-06, SRV-08, SRV-09

### Tasks
- [ ] A checklist in `docs/qa/manual-match.md`: invite, play against a bot, all commands, combat, siege, victory by timer and by capital, surrender, reconnection, replay.
- [ ] A run on two different computers over the internet (a temporary server or a tunnel).

### Acceptance criteria
- [ ] All checklist items are passed, the bugs found are filed as issues.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [PT-01] Internal playtest: go / no-go decision

Labels: `area:design` `type:decision` `P0` `size:S`

**Milestone:** M4: Web client and internal playtest · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** any
**Depends on:** QA-01, BAL-02

### Context
Bots do not replace people: before investing in the meta game we need to make sure the game is fun to play.

### Tasks
- [ ] At least 10 matches between people (developers and friends) via an invite on `rulesets/mvp.toml`.
- [ ] A short questionnaire after each match: clarity of combat, interest, what was annoying.
- [ ] Analysis of the replays with the same analyzer (BOT-04).

### Acceptance criteria
- [ ] A "go" or "no-go" decision is recorded in `docs/balance/playtest-0.md` with arguments; on "no-go", a list of fixes before a repeat playtest.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [MAP-05] Map background baker from the legacy generator

Labels: `area:maps` `type:feature` `P2` `size:M`

**Milestone:** M4: Web client and internal playtest · **Priority:** P2 · **Size:** M (2-3 days) · **Track:** B
**Depends on:** MAP-01

### Tasks
- [ ] Move the biome and metaballs logic from `legacy/.../MapGenerator.py` into `tools/maps/bake.py`.
- [ ] The biome of each area corresponds to the node's terrain + sea; the result is deterministic.

### Acceptance criteria
- [ ] A PNG for all MVP maps, each ≤ 1.5 MB.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [CLI-12] Feedback and "juice"

Labels: `area:client` `type:feature` `P2` `size:M`

**Milestone:** M4: Web client and internal playtest · **Priority:** P2 · **Size:** M (2-3 days) · **Track:** B
**Depends on:** CLI-04, BAL-02

### Tasks
- [ ] Animations of combat, bounce, node capture, unit deaths.
- [ ] Sounds (Howler.js) with volume control.

### Acceptance criteria
- [ ] Every combat event has a visual response; sound is switched off with one button.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [CLI-13] "How to play" screen

Labels: `area:client` `type:feature` `P0` `size:S`

**Milestone:** M4: Web client and internal playtest · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** B
**Depends on:** CLI-09, BAL-02

### Tasks
- [ ] One page: charges, roads, combat and bounce, scheduled orders, victory, with pictures.
- [ ] The central phrase: "The capital produces charges, roads carry them, a unit without a charge is defenseless".

### Acceptance criteria
- [ ] The screen opens from the menu and from the match screen; the combat examples on it are generated from the `combat.json` vectors, recomputed against `rulesets/mvp.toml`.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

## M5: Meta game

*Public lobby, matchmaking queue, Glicko-2 rating and leaderboard.*

### [RAT-01] Glicko-2 rating

Labels: `area:meta` `type:feature` `P0` `size:S`

**Milestone:** M5: Meta game · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** any
**Depends on:** DB-01, PT-01

### Tasks
- [ ] Our own Glicko-2 implementation (~100 lines) in `gow_server.rating`, τ = 0.5, updated after every match.
- [ ] A test on the example from Glickman's paper: 1500 / 200 / 0.06 → 1464.06 / 151.52 / 0.05999.
- [ ] The displayed rating is `r − 2·RD`.

### Acceptance criteria
- [ ] The test on the example from the paper passes to within 0.01.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [DEC-06] Decision: which matches are ranked

Labels: `area:design` `type:decision` `P0` `size:XS`

**Milestone:** M5: Meta game · **Priority:** P0 · **Size:** XS (≤ 2 hours) · **Track:** any
**Depends on:** DOC-01

### Default decision
Only matches from the matchmaking queue are ranked. Matches from the lobby, via an invite and against a bot do not change the rating, but are saved in the history. A technical defeat and a surrender are a defeat.

### Acceptance criteria
- [ ] The decision is recorded in mechanics.md with the status [accepted].

### How to close
A default value already exists, so the decision takes a couple of hours at most: confirm it or pick an alternative and record it in `docs/design/mechanics.md` with the status [accepted]. It blocks SIM-01 (DEC-05 blocks SRV-04, DEC-06 blocks RAT-02). After that the numbers change only through the ruleset and BAL-02.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [RAT-02] Updating the rating from match results

Labels: `area:meta` `type:feature` `P0` `size:S`

**Milestone:** M5: Meta game · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** any
**Depends on:** RAT-01, SRV-09, PT-01, DEC-06

### Tasks
- [ ] When a ranked match ends, both players are updated in one transaction outside the tick.
- [ ] Idempotency: reprocessing the same match does not change the rating.
- [ ] The rating change in `match_end` and on the result screen.

### Acceptance criteria
- [ ] A test: two ranked matches in a row give the expected values; reprocessing does not change them.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [LOB-01] Public lobby

Labels: `area:meta` `type:feature` `P0` `size:M`

**Milestone:** M5: Meta game · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** any
**Depends on:** SRV-09, CLI-09, PT-01

### Tasks
- [ ] Server: a public match (a map from the pool), a list of open matches, joining, removing abandoned ones.
- [ ] Client: a lobby screen with a refreshing list (polling once every 2 seconds).

### Acceptance criteria
- [ ] Two browsers: one creates a public match, the other sees it in the list and joins.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [MM-01] Matchmaking queue

Labels: `area:meta` `type:feature` `P0` `size:L`

**Milestone:** M5: Meta game · **Priority:** P0 · **Size:** L (4-5 days) · **Track:** any
**Depends on:** RAT-01, SRV-09, SRV-06, CLI-09, PT-01

### Tasks
- [ ] An in-memory queue, a pass once per 1-2 seconds; a window `±100 + k·wait` with a cap; a pair only if both windows accept each other; do not pair the same pair twice in a row.
- [ ] "Pair found" → confirmation within 15 seconds; whoever did not confirm leaves the queue, whoever confirmed returns to the front of it.
- [ ] A random map from the pool; a ranked match per DEC-06.
- [ ] After 60-90 seconds of waiting, an offer to play against a bot without rating.
- [ ] Client: a queue screen with the waiting time and the queue size.

### Acceptance criteria
- [ ] An algorithm test: 10 players with different ratings are paired by the rules, the window widens over time.
- [ ] A test: an unconfirmed pair does not create a match.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [LB-01] Leaderboard and player profile

Labels: `area:meta` `type:feature` `P0` `size:M`

**Milestone:** M5: Meta game · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** any
**Depends on:** RAT-02, CLI-10, MM-01

### Tasks
- [ ] `/api/leaderboard` (the top 100 by `r − 2·RD`, at least 5 ranked matches) and `/api/players/{id}`.
- [ ] Profile: rating, wins and losses, the last 20 matches (any) with links to replays.
- [ ] Client screens.

### Acceptance criteria
- [ ] After a ranked match both players see the changes in the profile and the leaderboard.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [MOD-01] Basic abuse protection

Labels: `area:meta` `type:feature` `P0` `size:S`

**Milestone:** M5: Meta game · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** any
**Depends on:** ID-01, PT-01

### Tasks
- [ ] Reserved and forbidden nicknames (a basic list).
- [ ] Rate limits: creating matches, joining the queue, changing the nickname.
- [ ] An admin script: rename or block a player.

### Acceptance criteria
- [ ] Tests of the limits and forbidden nicknames.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

## M6: MVP release

*The game is deployed over https, passes e2e and an audit, a closed playtest has been held.*

### [OPS-01] Docker images and docker compose

Labels: `area:infra` `type:chore` `P0` `size:M`

**Milestone:** M6: MVP release · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** B
**Depends on:** SRV-01, INF-03

### Tasks
- [ ] The `app` image: uv, `uvicorn --workers 1`, the volume `/data` (SQLite and replays).
- [ ] A multi-stage `caddy` image: building the client and Caddy with static files.
- [ ] `compose.yaml`: `caddy` (80/443) and `app` (internal network only); `.env.example`.

### Acceptance criteria
- [ ] `docker compose up` brings up the game locally; a match via an invite works.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [OPS-02] Caddy: TLS, WebSocket, static files, security headers

Labels: `area:infra` `type:chore` `P0` `size:S`

**Milestone:** M6: MVP release · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** B
**Depends on:** OPS-01

### Tasks
- [ ] Routes `/api/*`, `/ws/*` (with `stream_close_delay`), the rest is static files with `try_files`.
- [ ] `index.html` is `no-cache`, hashed assets are `immutable`.
- [ ] The CSP from INF-03, `X-Content-Type-Options`, `Referrer-Policy`.

### Acceptance criteria
- [ ] A header check by script; the WebSocket survives a Caddy config reload; there are no CSP errors in the browser console.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [OPS-03] VPS deployment, backups and safe deploy

Labels: `area:infra` `type:chore` `P0` `size:M`

**Milestone:** M6: MVP release · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** B
**Depends on:** OPS-02, DB-01

### Tasks
- [ ] An instruction and a script for preparing a VPS (Hetzner): Docker, firewall, a non-root user.
- [ ] Deploy with "draining": a ban on new matches, waiting for the current ones to end (or a timeout), then a restart.
- [ ] A nightly backup of `VACUUM INTO` and the replay directory; a verified restore.

### Acceptance criteria
- [ ] The game is available over https on its own domain; restoring from a backup is verified on a clean machine.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [OPS-04] Observability: logs, metrics, errors

Labels: `area:infra` `type:chore` `P1` `size:S`

**Milestone:** M6: MVP release · **Priority:** P1 · **Size:** S (≤ 1 day) · **Track:** any
**Depends on:** SRV-02, OPS-01

### Tasks
- [ ] Metrics: active matches, tick lag, the p99 of the step, bot skips, queue size, the number of connections.
- [ ] Error collection (Sentry or an equivalent, optional) for the server and the client.
- [ ] An alert when a match crashes or the tick lag exceeds 10%.

### Acceptance criteria
- [ ] A deliberate exception in a match is visible in the logs with the match id, and an alert arrives.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [QA-02] E2E Playwright: an invite match in two browsers

Labels: `area:qa` `type:test` `P0` `size:M`

**Milestone:** M6: MVP release · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** B
**Depends on:** QA-01, OPS-01

### Tasks
- [ ] Two browser contexts: creating guests, an invite, several orders, the end of a match on `test-short`, opening a replay.
- [ ] Running in CI against `docker compose`.

### Acceptance criteria
- [ ] The test is stable: 20 runs in a row without false failures.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [QA-03] Load test

Labels: `area:qa` `type:test` `P1` `size:S`

**Milestone:** M6: MVP release · **Priority:** P1 · **Size:** S (≤ 1 day) · **Track:** any
**Depends on:** SRV-08, OPS-03

### Tasks
- [ ] N parallel bot-vs-bot matches through real WebSockets on the target VPS.
- [ ] Measuring tick lag, the p99 of the step, CPU and memory.

### Acceptance criteria
- [ ] 30 parallel matches in one server process (one core) with tick lag < 10%; the result in `docs/qa/load.md`.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [QA-04] Security and fog leak audit

Labels: `area:qa` `type:test` `P0` `size:S`

**Milestone:** M6: MVP release · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** any
**Depends on:** SRV-03, CLI-01, OPS-02, SIM-17, MOD-01

### Tasks
- [ ] A checklist: a player's view contains nothing hidden (including ids and counters); errors do not distinguish "no" from "not visible"; tokens are not in URLs and logs; the Origin check; rate limits; CSP; fuzzing of `ClientMsg`.
- [ ] A manual "maphack" attempt: reading all the WebSocket messages in DevTools over a match.

### Acceptance criteria
- [ ] All checklist items are passed; what is found is fixed or filed as P0.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [LEG-01] Legal minimum for a public site

Labels: `area:release` `type:chore` `P0` `size:S`

**Milestone:** M6: MVP release · **Priority:** P0 · **Size:** S (≤ 1 day) · **Track:** any
**Depends on:** OPS-03, CLI-09

### Context
The site is hosted in Germany and is publicly available, so an Impressum and a privacy policy (DSGVO) are needed. This is not legal advice: the texts should be checked by a lawyer or taken from a trusted generator.

### Tasks
- [ ] Impressum and privacy policy pages; links in the footer and on the welcome screen.
- [ ] A list of data: the guest id and token in localStorage, the nickname, the IP in logs (retention period), replays; deletion on request.
- [ ] Third-party services (error collection, hosting) are mentioned in the policy; analytics only without consent or with a consent banner.

### Acceptance criteria
- [ ] The pages are reachable from any game screen; the retention period of logs with IPs is configured and matches the policy.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".

### [REL-01] MVP closed playtest

Labels: `area:release` `type:chore` `P0` `size:M`

**Milestone:** M6: MVP release · **Priority:** P0 · **Size:** M (2-3 days) · **Track:** any
**Depends on:** QA-02, QA-04, OPS-03, LB-01, MM-01, LOB-01, LEG-01, SRV-08, CLI-13

### Tasks
- [ ] 10-20 invited players, a week, a feedback questionnaire.
- [ ] A report on the real matches with the BOT-04 analyzer (from the replay logs): duration, results, the share of scheduled attacks, sieges, disconnects.
- [ ] A review of bugs and results in `docs/balance/playtest-1.md`.

### Acceptance criteria
- [ ] ≥ 90% of started matches finish without technical failures.
- [ ] Not a single divergence of a replay's re-simulation from the match result.
- [ ] ≥ 70% of participants correctly explain the combat rule after two matches.

---
Definition of Done: see `AGENTS.md`, section "Definition of Done".
