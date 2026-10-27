# ADR 0001. Architecture: an authoritative server, a pure simulation, Python + TypeScript, fog on the server

- Status: accepted
- Date: 2026-09-30
- Issue: DOC-01 (#2)

## Context

Skill-Based Front: a competitive 1v1 strategy game in the browser, a match of 10 to 15 minutes, a Glicko-2 rating
and replays (`docs/mvp/MVP_PLAN.md`). The game rules (`docs/design/mechanics.md`) are integer-based and without
randomness, only the opponent's state is hidden. The requirements follow from this:

- fairness: the client must not know what the player does not see, and must not influence the outcome;
- reproducibility: the same command log gives the same match (replays, debugging, bot tournaments);
- balance is checked on bots over thousands of matches before the client exists;
- the team has two developers: track A (Python) and track B (TypeScript and tools).

The Pygame prototype (the tag `v0-pygame-prototype`) implements the old design, keeps the logic in the client and does not fit
as a basis.

## Decision

1. **The server is authoritative.** All game logic runs on the server. The client draws snapshots and
   sends intents (for example, `Move(group, dest, planned)`), never a state.
   There are no exceptions: the fight estimate in the HUD was removed (#252), there is no game logic in the client at all.
2. **The simulation: a pure deterministic library `gow_sim` in Python.** A match step changes only its own
   state; time is set in ticks (10 per second); integers only; no `random`, `time`,
   network, I/O or `set` iteration. All the numbers of the rules come from the ruleset (`rulesets/*.toml`).
   The same library is used by the server, bots, the tournament harness, replays and tests.
3. **Fog of war is computed on the server.** The only thing that leaves the simulation toward a player or
   a bot: the result of `project(state, player) -> PlayerView`. Bots get the same `PlayerView` as humans.
4. **Languages and stack.** The server, simulation, protocol, bots and map tools: Python 3.12 in one
   uv workspace (FastAPI, Pydantic 2, SQLAlchemy 2, SQLite). The client: TypeScript + Vite + Svelte 5
   (the interface) + PixiJS 8 (the map). The protocol is described by Pydantic models; the TypeScript types are generated
   from the schema and are not edited by hand.
5. **One server process** with one `asyncio` task per match; there is no `await` inside a simulation step.

Details and mandatory rules: `AGENTS.md`, sections 2, 4, 5, 6 and 7.

## Consequences

- Cheating through the client (hidden state, a forged outcome) is ruled out architecturally; fog leaks
  are checked by projection tests and the audit (SIM-14, SIM-17, QA-04).
- A replay: a header and a command log; re-simulation gives exact frames. A change of rules requires
  raising `SIM_VERSION` and new golden replays.
- Balance is checked by a headless bot tournament, without the server and the client (M2 before M3/M4).
- The input latency equals the network latency plus a tick; the client interpolates snapshots, without prediction.
  For a strategy game with orders this is acceptable.
- Python limits the step performance: the budgets are in `AGENTS.md`, section 12; when short of it:
  profiling and optimization of hot functions, not a change of architecture.
- Two languages require generating the protocol types and checking schema drift in CI (PRO-02).

## Alternatives considered

- **Lockstep (a deterministic simulation on every client).** Saves traffic, but every client
  knows the full state: fog of war is not protected. Rejected.
- **Logic in the client, the server as a relay** (as in the prototype). The outcome cannot be trusted and the opponent's state cannot
  be hidden. Rejected.
- **A simulation in TypeScript, shared by the client and the server (Node.js).** One language, but bots, tournaments
  and analytics are more convenient to write in Python, and a shared simulation pushes game logic into the client.
  Rejected.
- **ECS or a game engine on the server.** Excessive for a graph of 25-40 nodes and dozens of groups;
  a functional core was chosen: systems as functions over the state. Rejected.
