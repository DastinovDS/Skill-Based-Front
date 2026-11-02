# ADR 0002. Information grants for bot difficulty levels: a per-level grant inside `project()`

- Status: proposed, awaiting the owner's decision (#692)
- Date: 2026-11-02
- Issue: #692 (DEC-43); the audit `docs/balance/bot-audit-2026-11.md`, section 4

## Context

The owner (2026-11-02): a human beats the `expert` bot without much effort; maybe the higher levels should be allowed
to cheat a little, with more and more accurate information. Today:

- ADR 0001, decision 3, and AGENTS.md 4.4: `project(state, rules, player, match_key) -> PlayerView` is the only thing
  that leaves the simulation toward a player or a bot; bots get the same `PlayerView` as humans.
- AGENTS.md 2 and 8, the import-linter contract and `apps/bots/src/gow_bots/bots/ruff.toml`: `gow_bots.bots` imports
  only `gow_sim.view`, `gow_sim.commands`, `gow_sim.maps`, `gow_sim.ruleset`; `GameState` is banned. The reason is
  not fairness alone: a bot that reads hidden state cannot measure balance (it plays a different game), and its
  decisions cannot be explained from a replay.
- The levels differ by tempo (`gow_bots.bots.tempo`: think, react, APM, `insight`) and by personality. The tempo does
  not separate `normal` from `hard` measurably (`docs/balance/log.md`, #574), and the real `expert` match used 14.5 of
  its 40 APM.
- The audit found that the `expert` loss has fair causes first (charges sunk into lost buildings, no v2 capital
  defense, idle discharged units in a cut-off pocket): a grant is a multiplier on a bot that spends its resources
  well, not a substitute for the fixes.

## Decision (proposed)

1. **A grant is an input of `project()`, never a bypass of it.**

   ```python
   @dataclass(frozen=True, slots=True)
   class Grant:
       near_exact: bool = False
       """Enemy nodes adjacent to an own node, and both halves of the edges between them: EXACT."""
       floor: Detail | None = None
       """A floor on the detail of every enemy node (RANGE: numbers as a range anywhere on the map)."""
       intent_bonus: bool = False
       """The requested bonus of enemy planned orders (DEC-41, item 10) is shown."""

   NO_GRANT = Grant()
   GRANTS = {"none": NO_GRANT, "near": Grant(near_exact=True),
             "wide": Grant(near_exact=True, floor=Detail.RANGE, intent_bonus=True)}

   def project(state, rules, player, match_key, grant: Grant = NO_GRANT) -> PlayerView: ...
   ```

   The grant is applied to the vision levels right after `compute_vision` (the node and edge-half levels are raised,
   nothing else changes); the sightings, the memory, the opaque ids and every other rule of the projection run as
   today on the raised levels. The fog memory of the state (`vision_memory`, written by the `vision` system) is not
   touched: the grant is a property of the view, not of the match, so the replay and the state hash are unchanged.
   Enemy lines, the enemy's CP and stance, factory builds and the recruit queue stay hidden under every grant: the
   grant is about numbers in places, the things a human could learn by scouting, not about the enemy's economy.

2. **Who passes the grant.** The server: `LEVEL_BOTS` becomes a table of `(bot, grant)`; `MatchRunner._bot_commands`
   calls `match.view(seat.slot, grant=seat.grant)`. `run_headless` and the tournament take an explicit grant per
   controller (`--bots "smart_expander@hard+near"` or a `--grant` option); the default everywhere is `NO_GRANT`.
   Humans never get a grant (the WebSocket path calls `project()` without one).

3. **Fair by default, visible when not.** Tournament rows carry the grant of each side; `gow-bots report` prints a
   "fair field: yes/no" line; balance verdicts (BAL-02 criteria, burn, capital wins) are read only from fair files; the
   GitHub workflow keeps the fair default. The replay header records the grant of a bot seat.

4. **The product side.** A granted level is a new level (`expert+`), not a silent change of `expert`; its client
   description says what it sees ("sees the numbers of every enemy city next to its own"). If bot matches touch the
   rating, the owner decides whether a granted level is rated.

5. **Order.** The fair fixes of the audit (#682, #683, #684, #686, #687, #685) and the exploiter gate (#688) come
   first; the grant is implemented and measured after them, `near` first, `wide` only if `near` does not separate
   `expert+` from `expert` beyond the interval (the computed ladder of #690 and the exploiter pair at 50 seeds).

6. **The rules text.** AGENTS.md 4.4 and 8 get one sentence each: "a bot seat may receive `project()` with a `Grant`
   of its level; bots still read only a `PlayerView`"; the import-linter contract and the `GameState` ban stay.

## Consequences

- The boundary stays lintable and testable: one new parameter in `gow_sim.view`, fog tests that prove the granted
  view is a superset of the fair one (every field of the fair view equal, the extra information only in enemy places
  and edge halves) and that `NO_GRANT` gives a byte-identical view (`test_view.py`, `test_dec41_view.py`).
- `SIM_VERSION` does not change (no rule or state changes); `PROTOCOL_VERSION` changes only if the level table or the
  replay header is public (the level names reach the client through `botStyles.ts` and the API).
- The bots gain exact numbers where they guess today (`GUESS_UNITS = 3`, `strike_guess`, the top of a range): the
  threat and the strike estimates become exact at the front, so the `expert+` bot attacks what it can take and defends
  what is coming. It gains nothing against the decisions it lacks (section 2 of the audit).
- The tournament, the report and the search grow a grant flag and a fair-field line; a mixed field is a tool for
  measuring the grant, never for balance.

## Alternatives considered

- **B. Bots read `GameState`** (drop the import-linter contract for a `cheat` module). Unbounded information, nothing
  to test fairness against, decisions unexplainable from the replay, a leak in a bot path is a leak in the server
  process. Rejected.
- **C. Resource grants** (extra CP or charges for the bot's side). Keeps the boundary but breaks the symmetry the
  sim's mirror and property tests assume; a human sees a bot that recruits faster than it can. Kept as a last resort
  after A, as its own DEC if ever.
- **D. Tempo only.** Already there; measured insufficient (#574). Nothing to gain.
- **E. No grant, better fair bots.** The first step of the plan in any case; whether a grant follows is the owner's
  decision. The ceiling of a fair bot is unknown; the audit expects it well above today's `expert`.

## Open questions for the owner

1. A or E (and if A: `near` only, or `wide` as a second level)?
2. Should the granted level be labelled in the client, and should it be rated?
3. Should a grant ever include the enemy's economy (lines, CP), or stay with numbers in places as proposed?
