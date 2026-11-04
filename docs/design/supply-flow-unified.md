# Supply flow: a liveness check and one routing rule

Status: **[awaiting the owner's decision]**. Refs #738 (the ridge), #697 (DEC-43). Nothing here changes the rules: `develop` is `SIM_VERSION` 39 (DEC-43 items A to L). The prototypes are throwaway branches, pushed and not merged: `proto/738-c1-feed-everywhere`, `proto/738-c2-nearest-need`, `proto/738-c3-outward-only`.

## Why

The flow moves charges downhill along `d` (roads to the nearest leaf) and has special rules on level roads. Every playtest of `mvp-4` found one more node that the flow never fed while the rear held stock, and each got its own patch: the saddle (item K, match 11), the corridor through a leaf (item L, match 12), now the ridge (#738: Mid Fork at `d = 2` with every own neighbour at `d = 1`, so the basin of Far Fork and Flintcross gets nothing while the rear burns). The owner accepted on 2026-11-04: stop patching one hole per playtest; first a check that finds all such holes at once, then one routing rule instead of K, L and the #738 options, if one exists.

## 1. The liveness check

`packages/sim/tests/test_flow_liveness.py`, using `gow_sim` only.

**The property** (per player, the own capital's component, `k` the player's shift). A **hungry** level node: own, `d == k`, room in its warehouse (a node where an own army stands short of a charge has room once its warehouse is empty). An **idle source**: own, behind the level (`d > k`), stock in its warehouse, no pulling army there. A source **reaches** a hungry node over own internal roads through nodes that are not ahead of the level (frozen by item A3) and do not hold (a node with a pulling army keeps what it gets).

1. **Settle (no endless churn).** Without production and with the armies standing still, the flow reaches a fixed point (a dispatch that sends nothing, no packet on the way, the same warehouses and armies at the next dispatch) within `4 * V * hop` dispatches (`V` nodes of the map). A state that does not settle has a charge cycling while the demand stands still.
2. **Rest (no hole).** At the fixed point no hungry level node has an idle source that reaches it. A fixed point never changes again, so such a pair is a node the flow will never feed from that stock, for every N.
3. **Progress.** From the start, if a hungry node has an idle source that reaches it, a charge lands in a node that was hungry at the start within `N = (D + 1) * hop` dispatches, `D` the hop diameter of the map, `hop = ceil(T / dispatch_ticks) + 1` for the slowest packet `T`: a charge waits at most one dispatch to leave a node and `T` ticks on a road, and no shortest way is longer than `D` roads. On the pool maps `N` is 56 (narrows) to 120 (highway) dispatches; the settle cap is 812 to 1960; the slowest state settles in 80 (`develop`) to 86 (C2, C3).

**The shape of a hole**, the first that fits, by the ways from its idle sources to the hungry node:

| Shape | The way that exists | Whose case |
|---|---|---|
| downhill | behind the level, `d` falls at every step | the rule fails on its own terms |
| saddle | behind the level, `d` never rises, a level road on the way | item K |
| ridge | behind the level only, uphill somewhere | #738 |
| corridor out | through another level node, every step out of a level node farther from the capital (`c` grows) | item L |
| corridor in | only through the level sideways (equal `c`) or towards the capital | item L forbids it by design |

The report also counts the holes whose sources all lie in an **enclave** (a part behind the level without an own factory, item L5): there the corridor rule L6 forbids every road towards the capital.

**The states.** Every pool map; ownership splits grown from both capitals one random frontier node at a time by a seeded generator in the test (splitmix64, no `random`), some nodes left neutral, then pushed four ways (as grown, single captures across the border, a salient of 2 to 6 captures, both); four stock layouts (the rear full and the level empty; random; the capital full; one node behind the level full); with and without 1 or 2 armies 3/0; every leaf shift `0..leaf_shift_max`. Both players are checked in every state. The full sweep is 12 splits per map: 1704 states, 3408 checked state-players, about 40 s.

**How it runs.** `test_the_holes_do_not_grow` (the required job `py`, 2 splits per map, about 7 s) asserts no churn and that the holes per map do not exceed the `develop` numbers; the same for the full sweep is marked `slow` (job `py-slow`). A rule that fixes holes lowers the numbers in `QUICK` and `FULL`. The report: `mise exec -- uv run python packages/sim/tests/test_flow_liveness.py --full` (`--maps narrows`, `--splits 3`).

## 2. What it finds on `develop` (SIM 39)

No churn: every state settles within 80 dispatches. **1219 holes in 625 of 3408 state-players** (18%); 9 stalled (no progress within N).

| Shape | crossroads | highway | narrows | ridge | all | sources in an enclave |
|---|---|---|---|---|---|---|
| saddle | 15 | 13 | 0 | 15 | 43 | 42 |
| ridge | 83 | 217 | 34 | 158 | **492** | 62 |
| corridor out | 90 | 103 | 39 | 41 | 273 | 4 |
| corridor in | 90 | 104 | 65 | 152 | 411 | 390 |
| holes / failing state-players | 278 / 136 | 437 / 226 | 138 / 97 | 366 / 166 | 1219 / 625 | |

The smallest example of each (case labels of the report: map, split, layout, armies, shift):

- **Ridge** (`highway split 0 random armies k=1`, player 1, 11 own nodes): Underwood, a province on the level with a tired army, is empty; Pitchworks (city, `d = 2`) holds 2 next to the full level province Pasture; the only way behind the level climbs to Hayfield and Meadowland (`d = 3`). On `narrows` the #738 shape itself: Torchester hungry, The Narrows holds 2 behind the full Far Fork, the way goes up to Mid Fork. The most common hole on every map.
- **Corridor out through a province** (new; `narrows split 8 random armies k=0`, player 1, 9 own nodes): Ashby, a leaf city, is reached only through the leaf province Fenmere (`c` 1 to 2). Item L2 gives outward when `load(m) + 1 <= have(n)`: a province with 1 passes only into an **empty** node, so Ashby stops at 1/3 while Sedgeley and Iron Hold hold stock. The same with Lowmoor behind Thornway (`narrows split 0 capital`).
- **The capital on the front** (new, counted as a saddle; `crossroads split 9 rear k=0`, player 0, 8 own nodes): Nexus, the capital, is a leaf and holds 2 of 6; Lodge holds 1 behind the empty province Strip. With the only factory on the level, everything behind the level is an enclave (L5), and L6 forbids every road towards the capital: stock behind a capital under attack never reaches it.
- **Corridor in** (`narrows split 0 rear armies k=1`, player 1, 12 own nodes): Barrow (level, 2/3) next to the full level province Fenmere (equal `c`), and Ashby holds 3 behind Fenmere, a dead end. The level passes sideways only by the gap rule (`load + 2 <= have`), never from a province. This is item L as decided (the level never gives towards the capital), so it is listed, not counted as a fault of the candidates.

## 3. Candidate rules

All three keep: the field `d0` and `d` (items A1 to A4, I1, I2), the shift and its clamp (B), the pull and the lifted path (I6, I7), unpaid builds and their want (J), the room snapshot of item A5, one charge per road and direction, packets (A7), the spill (A8), warehouses (C), road fortifications (D), pockets and starvation (H; a pocket keeps today's rules, `k = 0`), the capital distance `c` (L1), the order of the senders `(d, node_key)`, ties only by `node_key` (fill, then `node_key`), no player tie-break. **Hungry level node** in all three: item K1 (a level node of the capital's component with room; a build node without an army only while its want is above 0).

### C1. The feed distance on every road behind the level (the minimal patch)

1. The feed distance of item K2 counts **every** road of a node behind the level to an own neighbour not ahead of the level, uphill included; for an enclave node the roads of item L6 still do not count.
2. A sender behind the level gives, one charge per road: (a) on room alone to every own neighbour not ahead with a **smaller feed distance** (downhill, level or uphill), by fill then `node_key`; (b) with what is left, downhill to neighbours with an **equal** feed distance, on room alone; (c) along level roads to equal feed distances by the gap rule. Nothing to a larger feed distance. With no hungry level node every feed distance is `INF`, and (b) and (c) are item A6 as today.
3. The level, the enclaves and the corridors: item L as today.

- **Replaces** item K3 (its three cases become (a) to (c)) and the #738 options 1 and 2. **Keeps** everything else, items I3 and L included.
- **No oscillation**: in a dispatch every send lowers the pair `(feed, d)` or is a gap move between equal pairs (a gap of 2 or more shrinks by 2); the level keeps the potential `c` of item L7. Across dispatches a charge goes back only after its demand ended (K5, L7).
- **One sentence**: none; it is today's rule plus one more case ("behind the front a charge also climbs towards a starving front city").

### C2. The nearest need (the unified rule)

1. **The front zone**: the level nodes of the capital's component and the enclave nodes (item L5) that have an **outward way** to a hungry level node (over level and enclave nodes, each step to a larger `c` or into a node that holds). Every other node behind the level is **the rear** (it reaches an own factory over nodes behind the level, or it is a dead-end enclave).
2. **Where a node may send** (room aside): a node ahead of the level, and a node that holds (a pulling army or an unpaid build, items A4, J), send nothing; a lifted node between only along its path (item I7); a front-zone node to an own neighbour in the front zone with a **larger `c`**, to a neighbour that holds (any `c`) and to its path node; a rear node to **any** own neighbour not ahead.
3. **The need distance** `g(n)`: 0 for a hungry level node, else `1 + min g(m)` over the neighbours `n` may send to; one BFS backwards from the hungry level nodes per dispatch (and per plan, item E); `INF` without a way. A BFS distance needs no tie-break.
4. **The dispatch**: each sender gives one charge per road on room alone (a build node: at most its want) to the neighbours it may send to with a **smaller `g`**, and to the neighbours that hold and its path node, in one list by fill then `node_key`; a rear sender then gives with what is left **downhill** (`d` smaller, not ahead) to neighbours with an **equal `g`**, on room alone. With no hungry level node every `g` is `INF`, and this is the downhill of item A6.

- **Replaces** the gap rule of the level roads behind the level (A6), item K (its feed distance becomes `g`), the gap rule on the level and "an army takes without the gap" (I3; the army is "a neighbour that holds"), item L2 (outward by a gap of 1 becomes "outward on room alone towards a smaller `g`"), items L4 and L6 (the corridor is the front zone), and the #738 options. **Keeps** item L1 (`c`) and L5 (the enclave, as the edge of the front zone). **Drops**: a full city next to an empty one at equal `c` on the level no longer evens out sideways (it waits for the rear); a level node that is hungry itself passes nothing on outward (only a full one does).
- **No oscillation**: (i) in a dispatch `g` is fixed and every send lowers `g`, goes into a node that holds (which never sends) or lowers `d` at an equal `g`, so no road carries charges both ways; (ii) a charge in the front zone only moves to a larger `c` or into a node that holds, and the rear never receives from the front zone, so every charge makes finitely many front-zone moves; a node becomes hungry only by giving from the front zone (finitely often) and stops being hungry by a landing; between such changes every rear move lowers `g`. So the flow settles, and a charge goes back only after the demand it was sent for ended (a corridor whose need was filled is rear again). The check: no churn in 3408 state-players.
- **One sentence**: "Every charge goes one road at a time towards the nearest front city that needs it; along the front it only moves away from the capital."

### C3. Outward only (the simplest)

1. A node may send to an own neighbour not ahead with a **larger `c`**, to a neighbour that holds and to its path node; nodes ahead and nodes that hold send nothing.
2. `g` as in C2 over these roads; a sender gives one charge per road on room alone to the neighbours with a smaller `g` (and those that hold, and the path), by fill then `node_key`. Nothing else moves: no downhill, no level roads, no staging.

- **Replaces** item A6 (downhill and level roads), K, I3's gap rule, L2 to L6, the #738 options. The field `d` stays only for the level, the shift, the pull and the spill.
- **No oscillation**: every send raises `c` or ends in a node that holds; the roads used form a directed acyclic graph, so nothing ever comes back, also when the demand changes.
- **Cost**: stock that lies farther from the capital than the need (after a retreat, in a dead end, when the capital is on the front) never comes back.
- **One sentence**: "A charge always moves away from your capital, towards the nearest city that needs it."

Rejected without a prototype: **the field from hungry leaves** (match-11 fix F2: `d0` measured only from hungry leaves) moves the level whenever a leaf fills, which breaks the meaning of the shift and the path of item I7; **orientation by the distance from the stock** instead of `c` on the level (it would also feed "corridor in") lets a rear node hand a charge back to the leaf that just gave it, a ping-pong as soon as a fill-or-key tie picks the giver.

## 4. Evidence

The liveness check (the full sweep, 3408 state-players), the recorded commands of matches 11 and 12 re-run with group ids kept (packets get their own id range; the bots do not react), one headless bot match per pool map and side order (`smart_reactive@normal` against `smart_turtle@normal`, seed 1, as in #737), and `test_bench_supply_flow_busy` (this laptop, mean of at least 200 rounds).

| | develop (SIM 39) | C1 | C2 | C3 |
|---|---|---|---|---|
| **Holes** (failing state-players) | 1219 (625) | 657 (391) | **418 (178)** | 4263 (1203) |
| downhill / saddle / ridge | 0 / 43 / 492 | 0 / 46 / 56 | **0 / 0 / 0** | 1595 / 661 / 387 |
| corridor out / corridor in | 273 / 411 | 157 / 398 | **7** / 411 | 559 / 1061 |
| churn / stalled within N | 0 / 9 | 0 / 9 | 0 / 15 | 0 / 361 |
| settle: quick returns / sends | 944 / 50125 | 2790 / 57105 | 1775 / 49747 | **21** / 33125 |
| **Match 11** (human, whole match): landed in The Narrows | 6 | 6 | 6 | 6 |
| burned / quick returns / army short and empty, node-ticks | 4 / 22 / 177 | 4 / 22 / 177 | 6 / 23 / 177 | 8 / 0 / 97 |
| **Match 12, the ridge window 3520..4170**: landed in Mid Fork / The Narrows | 0 / 0 | 2 / 2 | 5 / 5 | 5 / 4 |
| starving-mark node-ticks / army short and empty / burned | 349 / 37 / 12 | 49 / 7 / 10 | 121 / 0 / 8 | 169 / 7 / 8 |
| **Match 12, the corridor window 5150..5705**: landed in Flintcross / Sedgeley / Barrow | 10 / 6 / 2 | 10 / 6 / 2 | 10 / 7 / 3 | 10 / 7 / 3 |
| army short and empty, node-ticks / burned | 693 / 3 | 693 / 2 | 633 / 0 | 633 / 3 |
| Match 12 whole (diverges after tick 4454): captures / burned / quick returns | 33 / 71 / 24 | 42 / 49 / 47 | 42 / 49 / 45 | 42 / 51 / 6 |
| **Bot matches** (8): burned / quick returns | 988 / 427 | 1007 / 1309 | 958 / 1259 | 946 / 139 |
| army short and empty, node-ticks | 168 205 | 207 199 | 196 070 | 199 552 |
| **Perf** `supply_flow_busy`, ms, grid40 / grid55 (budget 0.3) | 0.205 / 0.260 | 0.206 / 0.269 | 0.211 / 0.278 | 0.209 / 0.269 |
| existing flow rule-table tests that change (of 208) | 0 | 2 | 20 | 22 |
| explained in one sentence | no | no | yes | yes |

Notes on the numbers:

- The "starving-mark" is the client's `!` (`flowLayout.starvingNodes`): own, warehouse empty, and an army short or a level node with no packet on the way.
- **Quick returns** (a road used back within 60 ticks without a capture of an end) triple under C1 and C2. The cause: the need distance does not know the charges already on their way to a need, so every rear node in reach sends towards the nearest hungry node at once; when it fills, the surplus turns to the next one or stages. Today the static basins of `d` split the rear between the leaves, so charges rarely turn.
- **Bot matches** under C1, C2 and C3 have 17 to 23% more node-ticks of an army short of charges next to an empty warehouse. Per match the picture is mixed (C2: 4 of 8 matches worse by 16 to 53%, crossroads both sides, highway and ridge one side each; the other 4 within 2%; one `develop` match ended at tick 8037, the others ran 9000); the bots react to the supply, so the matches diverge. Under C2 more stock sits on the level (+12% charge-ticks) and less one road behind it (-11%): without a static basin, a rear node with a way to any need sends towards it instead of filling the node behind its own leaf. The static check cannot see this (it has no spending).
- C3 does well in the matches (production keeps flowing outward, almost no returns), but its static holes are 3.5 times today's: everything the check places farther from the capital than the need stays there.
- "Corridor in" stays at about 400 under every candidate: it is the "never towards the capital" of item L. Feeding it needs either the level to pass sideways and inward (a ping-pong between two leaves without a potential) or a rule with memory (what a node passes on and what it keeps), both outside "one local rule".

## 5. Recommendation

**C2, the nearest need**, as the one routing rule: it removes every saddle, ridge and province corridor the check finds (holes 1219 to 418, failing state-players 625 to 178, the rest is the "never inward" of item L), feeds the #738 basin (Mid Fork and The Narrows 0 / 0 to 5 / 5 landed, army short and empty 37 to 0 node-ticks), settles in every generated state, fits the budget (0.278 ms against 0.3 on `grid55`), replaces items K, L2, L4, L6, the I3 gap rule and the level-road gap rule of A6, and says itself in one sentence. Two costs to accept or to address before the code:

1. **Herding**: three times the quick returns and, in bot play, more short armies on some maps. If the owner wants the buffer behind every leaf back, a follow-up item can count the charges already heading to a need (a reservation); it is not part of this proposal.
2. **The level no longer evens out sideways** (equal `c`): one clause can keep the gap rule there if the owner wants it; it does not change the no-oscillation argument (a gap move shrinks a gap by 2).

C1 is the smallest code change and also closes the ridge (492 to 56), but it adds a fourth case to today's rule set, keeps the province corridor (157) and the capital-on-the-front hole, and has the same herding cost. C3 is the simplest to explain and never sends a charge back, but strands every charge that lies beyond the need.

**Decision**: awaiting the owner's decision (C1, C2, C2 with the sideways gap rule, C3, or none). The code follows the choice as a DEC-43 item with `SIM_VERSION` 40, golden replays, the rule tables rewritten from the chosen text, and the liveness baselines lowered.

## Risks

- The check is static (no production, no spending, no captures, armies standing still); it proves where stock can never go, not how well a rule supplies a moving front. The match and bot numbers cover that only partly: the bots and the recorded human do not react to another supply.
- The re-runs of match 12 diverge from the original after tick 4454 under every version, so its whole-match numbers compare different games; the two windows start from the same saved state.
- The prototypes leave pockets on today's rules and do not touch the view's chevrons (`flow_down`); `flow_next` follows the new dispatch because the plan is the same function.
- The shapes are classified by geometry, not by the rule that blocks them; a "saddle" on `develop` is in practice the capital on the front (42 of 43 in an enclave).
