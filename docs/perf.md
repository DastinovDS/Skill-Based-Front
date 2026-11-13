# Performance budgets and the reference machine

The budgets are listed in `AGENTS.md`, section 12. Here: on which machine they were set, how they are measured and
what counts as a regression.

## The reference machine

| Parameter | Value |
|---|---|
| CPU | Apple M4, 10 cores |
| Memory | 16 GB |
| OS | macOS 15.7 |
| Python | CPython 3.12 (`uv run`, without a debugger and a profiler) |

The GitHub Actions runners (`ubuntu-latest`, CI job `py-perf`) are about 2.5 times slower than the reference; the budgets
there are scaled (below).

## How to measure

Benchmarks: `packages/sim/tests/test_benchmarks.py` (`pytest-benchmark`) and `apps/bots/tests/test_benchmarks.py`, plus
`apps/server/tests/test_match_load.py` (tick lag), plus the ratio of the snapshot cost to `project()`
(`packages/protocol/tests/test_convert.py::test_snapshot_frame_costs_no_more_than_project`). All of them are marked `pytest.mark.perf`: they are part of the ordinary
`uv run pytest`, and in CI they run in the job `py-perf` (`mise run test:perf`: sequentially, alone on its runner). Under `pytest-xdist` (`-n`)
`pytest-benchmark` itself disables the measurements, so with `-n` the budgets are not checked: these tests are not part of the main parallel run of
CI (`-m "not perf and not slow"`).

```sh
uv run pytest packages/sim/tests/test_benchmarks.py            # a time table and the budget checks
uv run pytest --benchmark-disable                             # one run without measurements and without checks
```

> Since #894 (2026-11-09) only the rulesets `mvp-5`, `mvp-6`, `mvp-7` and `test-short` exist: the benchmarks of the
> removed code (the v1 supply with donors and transfers, the drawn lines of `systems.lines`) were deleted or moved to
> `mvp-7` with the tests; the rows below that name them, `mvp-0` or `mvp-4` record the measurements of their time.

| Benchmark | What is measured | Budget |
|---|---|---|
| `test_bench_step` | `Match.step` without projections, a 40-node map (`grid40` from `conftest.py`) with 40 groups, both players under `ExpandBot`; the controllers and projections are in the untimed `setup` | on average ≤ 0.3 ms, p99 ≤ 1 ms |
| `test_bench_supply` (removed, #894) | the `supply` system on the state after 300 ticks of the same match, with packets on the way | ≤ 0.1 ms |
| `test_bench_supply_lines[grid40]`, `[grid55]` (removed, #894) | the economy v2 supply (`systems.lines`, DEC-41, #644) in a dispatch tick: a line from the capital to every own node along the supply tree (DEC-42: no limit of lines), two more factories on the tree as hubs, every other target full, packets of the last dispatch on the way | ≤ 0.1 ms (the section 12 supply budget; measured ≈ 0.04 and 0.07 ms on the M4 reference) |
| `test_bench_supply_flow[grid40]`, `[grid55]` | the supply flow (`systems.flow`, DEC-43, #704) under `mvp-7` (measured under `mvp-4`) on the state after 300 ticks of a bot match, a dispatch tick: the field, the pull, the dispatch and the plan of the view (computed every tick) | ≤ 0.1 ms (the section 12 supply budget; measured ≈ 0.055 and 0.071 ms on the M4 reference; ≈ 0.036 and 0.046 ms with the field memo of #787, which the deep copy of the warmed state carries over like a match does from tick to tick) |
| `test_bench_supply_flow_busy[grid40]`, `[grid55]` | the busiest dispatch of the flow (#704): each player owns its half of the map, every own warehouse holds a charge or is full in turn, a tired group in every third own node, a packet on every other internal road, the leaf shift 1; about 18 packets leave in the tick | ≤ 0.3 ms on `grid40` and `grid55`, accepted by the owner 2026-11-04 (#735; before: ≤ 0.2 ms, accepted 2026-11-03, #704; measured ≈ 0.14 and 0.16 ms on the M4 reference, half of it the packets; the section 12 budget "0.1 ms" refers to `test_bench_supply_flow`). DEC-43 item K (#732) adds the feed distance, one BFS per player for the dispatch and one for the plan: measured back to back on the same machine, mean 0.160 -> 0.182 ms (`grid40`, now 21 packets instead of 19: the saddle sends) and 0.217 -> 0.245 ms (`grid55`, 22 packets in both), about +13%; on CI `grid55` went over the scaled 0.2 ms limit (0.45 ms at x1.33). DEC-43 item L (#735) adds the capital distance, the enclaves and, with an enclave, the corridor test of the view: back to back on a laptop 0.176 -> 0.195 ms (`grid40`) and 0.236 -> 0.258 ms (`grid55`), about +10%; hence the 0.3 ms budget |
| `test_bench_project_flow[grid40]`, `[grid55]` (and `test_bench_step_flow`, removed, #894) | the step of a bot match and `project()` of the busy flow state under `mvp-7` (measured under `mvp-4`, #704): the own flow fields of DEC-43, item E | the step and projection budgets of section 12 (measured: step ≈ 0.21 and 0.29 ms, projection ≈ 0.26 and 0.36 ms; #787: step ≈ 0.20 and 0.26 ms; the benchmark calls `project()` without the reused vision of `run_headless`) |
| `test_bench_supply_many_donors_busy_roads` (removed, #894) | `supply` in a dispatch tick on a stress state (#306): 20 cities per player on `grid40`, ten with a deficit, ten donors, markers on empty front cities, the transfers took the roads near the capital, so almost every dispatch runs into an exhausted throughput and looks for a detour (#309) | ≤ 1 ms, accepted by the owner 2026-10-21 (the dispatch is once per `supply.dispatch_ticks` ticks; the section 12 budget "0.1 ms" refers to `test_bench_supply`) |
| `test_bench_project` | one `project()` on the same state | ≤ 0.3 ms |
| `test_bench_step[grid55]`, `test_bench_supply_flow[grid55]`, `test_bench_project[grid55]`, `test_bench_project_with_enemy_figures[grid55]` | the same on `grid55` (5 × 11, 55 nodes, 94 edges, 56 groups): the size of the DEC-27 maps (#266, item 7) | step and supply: the 40-node budgets; projection: 0.45 ms, accepted by the owner 2026-10-22 (#371; 0.3 ms on 55 nodes is exceeded: 0.32 ms, with figures 0.41 ms) |
| `test_bench_full_headless_match` | `run_headless` of two `ExpandBot` to the end of the match on `web` (the biggest MVP map by edges) | ≤ 8 s |
| `apps/bots/tests/test_benchmarks.py::test_bench_decide` | `decide()` of every bot from `gow_bots.bots.BOTS` on the views of a `random_legal` match on `web` after 300..1500 ticks | on average ≤ 1 ms |
| `apps/server/tests/test_match_load.py` | 30 matches on `web` (`mvp-7`) in one event loop, starts at random moments, two scripted clients per match (orders by the protocol, projections of both players); the clock is slowed down by `speed_factor` times, that is the load of the reference. Tick lag: how much later than the deadline a step started (`MatchRunner.lag_sum`). `speed_factor` is measured before and after the run, the larger one is taken; two attempts, the better one passes (the shared CI runner sometimes slows down in the middle of a run) | mean < 10% of a tick, no schedule resets |
| `packages/protocol/tests/test_convert.py::test_snapshot_frame_costs_no_more_than_project` | `snapshot_frame` (a snapshot together with the JSON encoding) against `project()` on the view of a `rusher` match on `web` after 300 ticks; a ratio on one machine, without `speed_factor` | no more expensive than `project()` (× `REGRESSION`) |
| `apps/bots/tests/test_benchmarks.py::test_bench_decide_strategy_views` | `decide()` of `expander` and `turtle` on the views of their own match on `web` after 300..1500 ticks (many groups, construction, contact with the enemy) | on average ≤ 1 ms |
| `apps/bots/tests/test_benchmarks.py::test_bench_decide_smart_views`, `test_bench_decide_smart_v2_views` | `decide()` of every `smart_*` bot on the views of a smart match on `web` (`smart_rusher` against `smart_expander`, and against `smart_hoarder`, #166, #648) | on average ≤ 1 ms |
| `apps/bots/tests/test_benchmarks_pool.py` (`test_pool_*`, #482, #1029) | the same quantities on the four pool maps `maps/*.json` under `mvp-7` with map tempo on (`Match.rules`), on the state at tick 3000 of a `smart_rusher` against `smart_expander` match (hard), replayed from the recorded commands of `apps/bots/tests/bench_pool/<map>.jsonl.gz` (`mise run bench:record`), each test on its own copy: `Match.step` (ticks 3001 to 4500 of the log), `project()`, the supply flow of a dispatch tick (with the plans of the previous tick kept, and without them, #482), `compute_vision` with an empty memo, `snapshot_frame`, a server tick (step, two reused views, two frames), and `view` plus `decide` of the bots of the day as the server times it | the section 12 budget of each is in `extra_info` of the report; the test fails above a per-map ceiling (`CEILING_MS`, the measurement of the recorded state on 2026-11-13 + about 10%, scaled by a `speed_factor` workload of its own, see "The recorded state and the CI scaling" below), which is a regression net and **not** the budget: where a budget does not hold, the section below says so |

## Regression

The budget on the current machine: the reference budget × `speed_factor`. `speed_factor` in
`test_benchmarks.py` is the time of a fixed workload in pure Python (dictionaries, objects with
`__slots__`, sorting by key, a loop; it does not call the simulation code), divided by its time on the
reference (`REFERENCE_WORKLOAD_S`, the best of 30 runs). A benchmark fails if the result exceeds
the scaled budget by more than 50% (`REGRESSION = 1.5`): a slow CI runner and noise
do not break the build, a real regression does. If the reference machine changes, re-measure
`REFERENCE_WORKLOAD_S` and the table of measurements below.

For comparing two versions of the code on one machine there is the standard `pytest-benchmark` comparison:

```sh
uv run pytest packages/sim/tests/test_benchmarks.py --benchmark-autosave             # on the old version
uv run pytest packages/sim/tests/test_benchmarks.py --benchmark-compare --benchmark-compare-fail=mean:50%
```

The saved results are in `.benchmarks/` and are not committed (they depend on the machine).

## Measurements (SIM-15)

| What | Reference | CI `py` |
|---|---|---|
| step, 40 nodes, 40 groups | ≈ 0.15 ms (p99 ≈ 0.25 ms) | ≈ 0.36 ms |
| `supply` | ≈ 0.05 ms | ≈ 0.13 ms |
| `supply`, stress state (#306) | ≈ 0.5 ms (before #306 the same computation without detours ≈ 1.1 ms) | - |
| `project()` | ≈ 0.11 ms | ≈ 0.26 ms |
| `grid40` and `grid55` (#266, CI `py`, `speed_factor` 2.28, recalculated to the reference): step | 0.18 and 0.25 ms | 0.42 and 0.57 ms |
| the same: supply | 0.07 and 0.10 ms | 0.17 and 0.24 ms |
| the same: `project()` (more expensive than the earlier measurement with DEC-21 and DEC-33; after simplifying `standing_units` in #266, before it 0.27 and 0.42 ms) | 0.22 and 0.32 ms | 0.50 and 0.73 ms |
| the same: `project()` with enemy figures (DEC-33; before #266 0.35 and 0.51 ms) | 0.29 and 0.41 ms | 0.66 and 0.93 ms |
| the `random_legal` decision (BOT-01) | ≈ 0.04 ms | - |
| a full headless match (7200 ticks) | ≈ 1.4 s | ≈ 3.2 s |

The server (SRV-02), a machine under load (`speed_factor` ≈ 1.1-1.5): the mean tick lag ≈ 2% of a tick,
the maximum ≈ 30%. The most expensive thing in a match tick was `snapshot_msg` (building the `View` with Pydantic validation):
≈ 0.64 ms per player at `speed_factor` ≈ 1.5, more expensive than `project()` itself (≈ 0.30 ms there). If all
30 matches have to tick at the same moment (the worst case, measured on `ManualClock`), the mean lag
was ≈ 46% of a tick at `speed_factor` ≈ 1.5.

### The cheap snapshot (#155)

The server sends `snapshot_frame`: the snapshot JSON is written straight from `PlayerView`, without the Pydantic
models and their validation (`gow_protocol.convert`, `gow_protocol.codec.SnapshotFrame`). The guarantees of the
models (the DEC-04 shape, the leak trap) are kept like this:

- `snapshot_msg` (through the validating models) stays the specification: the `test_convert.py` tests
  on every tick of real matches (the protocol driver on three MVP maps, a `rusher` match against
  `turtle`, rare parts of the view: an intent without a target, exact enemy numbers) require that the frame
  `snapshot_frame` equal `encode(snapshot_msg(view))` byte for byte;
- outside `prod` (`GOW_ENV=dev`, `e2e`, the server tests) the server decodes and validates every frame
  it sends (`MatchRunner(validate_snapshots=True)`): an invalid frame crashes the match, like
  any error; in `prod` the check is off.

`artery`, `web` and `pass` are the MVP maps (31..34 nodes), test fixtures in `maps/fixtures/` since #372; the DEC-27 maps of the pool have 45..55 nodes and the projection budget in AGENTS.md, section 12.

Measurements before and after on the developer's machine (Apple M4) under someone else's load (load average 10-38,
`speed_factor` ≈ 1.7-2.8, so the ratios matter, not the absolute numbers). Per player, the view after
600 ticks of a `rusher` against `turtle` match:

| Map | `project()` | was: `snapshot_msg` + `encode` | now: `snapshot_frame` (with encoding) |
|---|---|---|---|
| artery | 0.26 ms | 0.48 + 0.16 ms | 0.10 ms |
| web | 0.18 ms | 0.39 + 0.17 ms | 0.15 ms |
| pass | 0.22 ms | 0.40 + 0.15 ms | 0.13 ms |

The snapshot with encoding became 3-6 times cheaper and no more expensive than `project()` (≈ 0.4-0.8 of it; it was
≈ 2.5). 30 matches on `web` (`test_match_load.py`, the reference time):

| Scenario | Was | Now |
|---|---|---|
| ticks spread out (the test), mean lag | 2.1%, 2.5%, 25.1% (three runs) | 0.5%, 0.6%, 0.7% |
| the same, maximum | 25-148% | 5-6% |
| all 30 matches tick at the same moment (`ManualClock`), mean lag | 20-23% | 12-13% |
| the same, server time per tick (the steps and the encoding of all frames) | 48-56% of a tick | 25-26% of a tick |

The "was" run with 25% reproduces the CI failure (26.5% at `speed_factor` 1.14): at the former snapshot cost
the server load was about half a tick, and any slowdown of the runner produced a queue. The worst
case with simultaneous ticks stays above 10%; this is not a section 12 budget (match starts are
random), but the margin for it is now twice as large.

## The pool maps under `mvp-7` (#482, ARP-01 and ARP-08)

The benchmarks above run on synthetic grids and the 34-node fixture `web`. The maps the queue plays are the four
of `maps/*.json` (29 to 51 nodes), played under `mvp-7` with the map tempo applied. These are the section 12
quantities on them, measured on 2026-11-12 at `d603581` (after the memos of #983; the step and supply rows again after
the flow work of #482, back to back with `6908a44`), by
`apps/bots/tests/test_benchmarks_pool.py` (`mise run test:bench`).

Method (until #1029; since then the state is replayed from a recorded log, see "The recorded state and the CI scaling"
below): the state after 1500 ticks of a seeded `smart_rusher` against `smart_expander` match (hard), so there are
groups on the roads, fights, builds and a grown fog memory; `Match.step` is timed alone (the bots decide in the
untimed setup), `project()` is called without the reused vision (like the budget test), the supply flow runs on a
copy of the dispatch-tick state (the memos travel with the copy, like in a match; in a full run the step benchmark
before it has moved the match on by 1500 steps, so this is tick 3000). Means of three runs on the
reference machine (Apple M4, load average 3 to 5, `speed_factor` 0.97 to 1.00), divided by `speed_factor`.
Another agent's load shows up as outliers (a single run of a map went 1.5 to 2 times slower): the table is the
quiet runs.

| Quantity (ms) | budget | `narrows` (29) | `crossroads` (49) | `highway` (49) | `ridge` (51) |
|---|---|---|---|---|---|
| `Match.step` (after #482; before it) | 0.3 | 0.13 (0.14) | 0.16 (0.18) | 0.17 (0.19) | 0.18 (0.20) |
| `project()`, one player | 0.3 (up to 40 nodes), 0.45 (45..55) | 0.17 | 0.27 | 0.26 | 0.28 |
| supply flow, dispatch tick (after #482; before it) | 0.1 | 0.019 (0.04) | 0.026 (0.09) | 0.028 (0.10) | 0.054 (**0.11**) |
| supply flow, dispatch tick without the previous tick's plans (#482; before it) | 0.1 | 0.044 (0.056) | **0.12** (0.14) | **0.105** (0.16) | **0.12** (0.14) |
| `compute_vision`, empty memo (warm: 0.003) | no budget | 0.02 | 0.03 | 0.03 | 0.03 |
| `snapshot_frame`, one player | no budget (not dearer than `project()`) | 0.17 (x1.0) | 0.36 (x1.3) | 0.27 (x1.0) | 0.34 (x1.2) |
| server tick per match: step + 2 views (reused vision) + 2 frames | no budget | 0.79 | 1.5 | 1.5 | 1.5 |
| bot `view` + `decide` (mean; share over 1 ms) | 1 | 0.41 (0%) | 0.77 (8%) | 0.69 (7%) | 0.74 (6%) |

What holds and what does not (findings, nothing here changes a budget or the code):

- **The step and the projection hold on every pool map**, the step with a margin of about a third (0.20 ms on `ridge`
  against 0.3). The architecture review (ARP-01) measured 0.45 to 0.64 ms per step and 0.37 to 0.6 ms per projection at
  `7b76b6b`, before the memos of vision and of the flow plan (#983); on the current head these are gone.
- **The supply budget (0.1 ms) holds on average since #482, not on every dispatch.** Before it `ridge` measured 0.11 ms
  (runs 0.110, 0.113, 0.122), `highway` 0.097 to 0.100, `crossroads` 0.092; the owner kept the budget and the flow got
  cheaper (ARP-03 of the review), hash-neutral (the golden replays and `SIM_VERSION` unchanged):
  - a dispatch sends what the plan of the previous tick showed when every input of that plan is unchanged (the field
    object, the capacities, the own warehouses, the own packets on the way: the plan memo of #983 with its sends,
    `systems.flow._dispatch`). Before, a dispatch tick ran the calls of item M twice per player (send, then plan); in a
    whole smart-bot match the dispatch finds the plan in 90 to 97% of the dispatches (narrows 94%, crossroads 92%,
    highway 90%, ridge 97%);
  - the starving pockets of item H4 come from the memoized owner-only part of the field (`_Base.pockets`) instead of a
    BFS per player and tick;
  - the calls of a tier stop when the stock that tier may call is all called (before: when all stock was called, also
    the stock of the front that no caller of the tier may take);
  - `warehouse_capacities` is kept in `GameState.memo` with the map and `rules.warehouse`.

  Every memo is checked against a fresh computation on every call of a smart-bot match on `ridge`
  (`apps/bots/tests/test_sim_memos.py`), the capacities also by `test_capacity.py`.

  The pool benchmark runs the flow again on the state its step left, so its dispatch finds the plan (0.019 to 0.054 ms).
  A dispatch whose inputs changed since the last plan (the other 3 to 10%) still runs the calls of item M twice per
  player: `test_pool_supply_flow_replanned` measures it at 0.105 to 0.12 ms on the 49 to 51 node maps (0.14 to 0.16
  before), **over the budget**; the calls of item M (a BFS per caller and tier, two to four per tick) are most of it. In
  real play, ticks 300 to 3000 of the same seeded match, the supply step on a dispatch tick: `ridge` mean 0.044 ms (p95
  0.089; before 0.093, p95 0.168), `highway` 0.047 (p95 0.112; before 0.089, p95 0.177), `crossroads` 0.043 (p95 0.094;
  before 0.079, p95 0.154), `narrows` 0.026 (before 0.051); on the other ticks 0.018 to 0.028 (before 0.029 to 0.045).
  Cheaper still would take a new shape of the calls of item M (one search per tier instead of one per caller), with
  the same results; not done here. The synthetic `grid40` and `grid55` measure 0.03 and 0.04 ms, so the budget test on
  them says nothing about the 50-node pool maps.
- **`snapshot_frame` is dearer than `project()` on the big maps** (x1.2 to x1.3 on `crossroads` and `ridge`, x1.0 on
  `highway` and `narrows`). The test `test_snapshot_frame_costs_no_more_than_project` checks the ratio on `web` only.
  Together with the other half of a tick this makes **1.5 ms of server time per match tick on the 49 to 51 node maps**
  (0.8 ms on `narrows`) before deflate (0.1 to 0.15 ms per frame, measured by `scripts/snapshot_size.py`, so about 0.3 ms
  for the two players) and before a bot's decision. 30 such matches are 45 ms of a 100 ms tick, 54 ms with deflate. There
  is no pool-map version of `test_match_load.py` (it plays `web`), so the "30 matches, tick lag below 10%" budget has no
  measurement on the shipped maps yet.
- **A hard smart bot overruns the server's 1 ms bot budget** (`Settings.bot_budget_s`) in 6 to 8% of its calls on the
  49 to 51 node maps on the reference machine, and the live bot skips its next decision after an overrun. Between
  tournament and server this is a difference of tempo that grows on a slower host (the CI runners are about 2.5 times
  slower than the reference). The number counts `view(reuse=True)` plus `decide` like `MatchRunner._bot_commands` does
  (reused vision already in; ARP-04).
- Side note: `apps/bots/tests/conftest.py` loads **`mvp-5`** as its `mvp_rules`, so the existing bot benchmarks of
  this file's neighbour (`test_benchmarks.py`) measure the decision on a ruleset that is not played; the pool
  benchmarks load `rulesets/mvp-7.toml` themselves.

### The recorded state and the CI scaling (#1029)

From 846f122 (#1019) on, `py-perf` failed on `develop` itself in the pool supply rows (runs 43248526758, 43301391850,
43309603002, 43313578489), and two bot PRs raised those ceilings (#1022: every `supply_replan` row about +30%; #1027:
`supply[highway]` 0.032 -> 0.042 ms). The simulation did not change in that range (only `view.py`, #1004), and the
synthetic benchmarks of `packages/sim` stayed flat against the runner (supply flow / step of `grid40` 0.21 to 0.225 in every
run). Two causes, both of the measurement:

- **The measured state followed the bots.** The live smart bots played the warm-up, and the step benchmark moved the
  shared match on by 1500 ticks before the supply rows ran. Back to back on the reference machine, with only the bot
  sources swapped (`PYTHONPATH`), the same benchmark measured: `supply[highway]` 0.030 ms with the bots of aa432c6 and
  0.038 with those of 9f72adf (#1022, +27%), `supply_replan[narrows]` 0.043 -> 0.064 (+48%), `supply_replan[ridge]` 0.117
  -> 0.141 (+20%), `supply_replan[crossroads]` 0.126 -> 0.147 with a818a4d (+17%) and back to 0.106 with 9f72adf. A run
  with `-k supply` measured tick 1500 instead of 3000 (0.022 ms on `highway`, the number #1027 quoted). Now the bots play
  the match once (`scripts/bench_pool_record.py`, `mise run bench:record`, 4500 ticks, about 4 KB per map) and the
  benchmarks replay the commands, each test on a copy of the match at tick 3000: the bots of aa432c6 and of the head
  measure the same numbers, and so does `-k supply`. `test_bench_pool_logs.py` (ordinary run) fails when a rule, `mvp-7`
  or a pool map change makes the log give another match; record it again then, and measure the ceilings again.
- **The `speed_factor` workload did not scale these benchmarks on the CI runners.** Five runners of one dispatch (run
  43386390401) and one of run 43385162619, the head state, raw time against the reference:

  | Runner CPU | `_workload` of the simulation benchmarks | pool step / project | pool supply / replanned | the deep-copy graph workload |
  |---|---|---|---|---|
  | AMD EPYC 9V45 (4 runners) | x1.06 to x1.09 | 1.34 to 1.54 | 1.42 to 1.74 | x1.27 to x1.44 |
  | Intel Xeon Platinum 8370C | x2.04 | 2.28 to 2.43 | 2.42 to 2.73 | x2.38 |
  | Intel Xeon 6973P-C | x1.37 | 1.78 to 1.91 | 1.86 to 2.14 | (not measured) |

  The small workload (5000 slotted objects, in every cache) reads the EPYC runners as almost the reference, while the
  supply flow on a freshly copied state runs 1.6 to 1.7 times it there: scaled, the `supply_replan` rows sat at 1.5 to 1.6
  times the reference on a healthy head, against the 1.65 a ceiling of +10% and `REGRESSION` 1.5 allow, so any drift of the
  state or of the runner failed the job. The pool benchmarks now scale by a workload of their shape (a deep copy of a
  20000-node graph of slotted objects and a breadth-first search over it, `REFERENCE_WORKLOAD_S` 75.7 ms on the
  reference): it leaves every pool row at 0.75 to 1.35 of the reference on all those runners (supply at most 1.25,
  replanned 1.35). The simulation benchmarks keep their workload: their budgets have room on CI.

The ceilings (`CEILING_MS`) are the means of three runs of the recorded state on the reference machine (2026-11-13,
load average 2.6 to 2.9), rounded up about 10%; the raises of #1022 and #1027 are gone with the state they were set on:

| Quantity (ms) | `narrows` | `crossroads` | `highway` | `ridge` |
|---|---|---|---|---|
| `Match.step`, ticks 3001 to 4500 | 0.105 | 0.160 | 0.147 | 0.157 |
| `project()`, one player | 0.165 | 0.269 | 0.257 | 0.263 |
| supply flow, dispatch tick | 0.022 | 0.025 | 0.038 | 0.028 |
| the same without the previous tick's plans | 0.063 | 0.104 | 0.091 | **0.140** |
| `compute_vision`, empty memo | 0.019 | 0.026 | 0.027 | 0.028 |
| `snapshot_frame`, one player | 0.175 | 0.347 | 0.265 | 0.276 |
| server tick per match | 0.75 | 1.39 | 1.29 | 1.35 |
| bot `view` + `decide`, ticks 300 to 3000 (mean) | DEC_NA | DEC_CR | DEC_HW | DEC_RI |

The findings above hold on the recorded state: the replanned dispatch is over the 0.1 ms budget on `crossroads` and
`ridge`, the step and the projection hold.

### The size of a snapshot (ARP-08)

`scripts/snapshot_size.py` (`mise exec -- uv run python scripts/snapshot_size.py`, about 90 s for the four maps) plays
the same match for the whole 9000 ticks and encodes, for each player and tick, the frame the server sends
(`snapshot_frame`). Deflate is computed the way the server negotiates it: there is no setting in `gow_server`, so it is
the default of `uvicorn` (0.54, `websockets-sansio`, `ws_per_message_deflate` on): 12-bit window in both
directions, `memLevel` 5, a window kept between messages (context takeover on), messages ended with `Z_SYNC_FLUSH`
(`tests/test_snapshot_size.py` fails if those numbers change in `uvicorn`). Browsers offer `permessage-deflate`, so it is
negotiated unless something in between strips the extension; the check that the
match socket through Caddy really answers with it is still open (#910 marked it unverified, and this task did not
touch the stack).

Per player, 18000 frames per map (both players, every tick):

| Map | raw JSON mean / p95 / max | deflate, streaming mean / p95 / max | deflate, one frame alone (mean) | per player per second, raw -> deflate |
|---|---|---|---|---|
| `narrows` (29 nodes, 50 roads) | 31.4 / 33.7 / 34.3 KB | 1.7 / 1.9 / 2.1 KB | 1.8 KB | 314 -> 17 KB/s |
| `crossroads` (49, 92) | 55.1 / 58.7 / 59.3 KB | 2.4 / 2.6 / 2.7 KB | 2.4 KB | 551 -> 24 KB/s |
| `highway` (49, 78) | 50.8 / 54.2 / 55.6 KB | 2.4 / 2.7 / 3.0 KB | 2.5 KB | 508 -> 24 KB/s |
| `ridge` (51, 82) | 52.9 / 57.1 / 57.7 KB | 2.3 / 2.7 / 2.9 KB | 2.4 KB | 529 -> 23 KB/s |

- Nodes and roads are about 95% of a frame (`ridge`: nodes 26.8 KB, roads 24.0 KB, groups 1.7 KB); a frame carries
  about 1200 `null` values on the big maps. The size is flat over the match (p95 within 8% of the mean): it is
  `V + E` records of fixed fields, not the amount of play.
- Deflate takes it to 4.3 to 5.4% of raw. The window kept between messages gains only 3 to 5% over compressing each
  frame alone: a 12-bit window is 4 KB, the previous frame is 50 KB away, so there is no cross-frame delta in it. What
  deflate removes is the repetition inside one frame (the same keys and `null`s in every record), not the repetition in time.
- So a player on the wire needs about 17 to 24 KB/s (140 to 190 kbit/s) when deflate is negotiated, and 310 to 550 KB/s
  (2.5 to 4.4 Mbit/s) when it is not. The CPU of the compressor is 0.10 to 0.15 ms a frame here (about 10% of a match
  tick on top of the 1.5 ms above).

Recommendation (not done here; the format and the protocol are unchanged): **no change of format is argued for by
the numbers while deflate is on**: 24 KB/s per player is small, and a delta or a binary format would save bandwidth
that is already cheap. What the numbers do argue for is (1) verifying the negotiation through Caddy and setting
`ws_per_message_deflate=True` explicitly in `uvicorn_options` (a one-line change in `gow_server.cli`, so a `uvicorn`
default change cannot silently turn it off), and (2) a split of the static part of a frame (capacity, warehouse
capacity, ids, kind, `null` fields) out of the snapshot if the server CPU of `snapshot_frame` (0.34 ms of the 1.5 ms)
becomes the limit: that would cut the raw size and the encoding cost together, but it is a protocol change
(`PROTOCOL_VERSION`, the client, the fixtures) and belongs after the release. Without deflate the raw 55 KB per tick
would be the problem, and that is the case to watch (a proxy that drops the extension).

## The bot tournament (BOT-04)

The budget (AGENTS.md, section 12): 1000 matches on 8 cores in no more than 20 minutes. One `mvp-0` match
(7200 ticks, `random_legal` against `random_legal`) takes about 1.3 s of one core, plus the process
start (`spawn`; since #787 a worker plays match after match). The estimate for 1000 matches on 8 cores: about 3 minutes.
A measurement on the developer's machine at load average 22 on 10 cores (someone else's tasks): 96 matches in 52 s
(`--jobs 8`), that is 1000 matches in about 9 minutes, within the budget even at such a load.

The BAL-01 measurement (#39) on the reference machine (Apple M4, 10 cores, 16 GB, macOS 15.7.3), `mvp-0`, 5
strategic bots, `--jobs 8`; the machine was not idle (other agents worked in parallel):

| Run | Matches | Time | Load average | Per 1000 matches |
|---|---|---|---|---|
| the first 1000 matches of the `--seeds 100` tournament (3 maps) | 1000 | 324 s | 2.6 at the start, up to 7-9 | 5.4 min |
| the full `--seeds 100` tournament, one map after another | 7500 | 3494 s (artery 925, web 1359, pass 1210) | 9-12 | 7.8 min |

The budget of 20 minutes per 1000 matches was met in both measurements; a measurement on an idle machine was not made.

### A cheaper tournament match (#787)

#785 measured a tournament match (`mvp-4`, M4, one process): 4.75 s on average, the simulation 56%, `project()` 24%,
the bots' `decide` 17%, plus 0.25 s to spawn the worker. #787 cut it without changing any result: the same golden
replays (`SIM_VERSION` unchanged), the same tournament rows byte for byte (50 matches before and after, `cmp`), the same
`state_hash` of every timed match.

| Change | Where | What it saves |
|---|---|---|
| A light projection for a bot between two decisions: `run_headless` asks a `Glancer` (the smart bots) whether it thinks on this call (`thinks`), and if not hands it only the enemy figure ids of its view (`Match.figures`, `gow_sim.view.enemy_figure_ids`, the same fog rules), the one thing `tempo.Perception` reads then | `gow_sim.match`, `gow_sim.view`, `gow_bots.bots.smart`, `tempo` | the full `project()` of an `easy` / `normal` bot on about 94% of its calls: 43% of the projections of a hard against normal match |
| `project()` reuses the levels, sightings and known road levels the `vision` system of the same step computed (`systems.vision.observe`, `Sight`); `run_headless` passes `Match.view(reuse=True)` (only `step()` changes its state); the `vision` system tests "own internal" from one list of owners | `gow_sim.systems.vision`, `gow_sim.view`, `gow_sim.match` | a quarter of a projection |
| The flow field (`systems.flow._field`) is kept in `GameState.memo` (not part of the state, not hashed) with its full inputs (the owners, the clamped leaf shift, the holding nodes in order, the debts of the builds) and returned again while they are equal; the part of the owners and the shift alone too | `gow_sim.systems.flow`, `gow_sim.state` | a quarter to a third of the supply step |
| `CampaignBot._fit_split` asks the options of a trial army once per size and `need` once per target | `gow_bots.bots.campaign` | 12% of the decisions of `smart_expander@hard` (highway mirror) |
| Tournament workers play match after match (`ProcessPoolExecutor` without `max_tasks_per_child=1`) and `gc.freeze()` what they imported | `gow_bots.tournament` | the spawn and imports of a worker per match (0.10 s here without the console script, 0.25 s with it, #785) and a third of the collector time |

One match, `smart_expander@hard` against `smart_reactive@normal`, seed 0, `mvp-4`, with the timers of #785 (their cost
about 2%), the machine idle (`speed_factor` 0.97 to 1.03); the shares are of the match:

| | narrows (29 nodes) before | after | ridge (51 nodes) before | after |
|---|---|---|---|---|
| match | 3.78 s | 3.07 s (-19%) | 5.31 s | 4.23 s (-20%) |
| simulation | 54.5% | 60.7% | 56.8% | 60.3% |
| of it `supply` (flow) | 0.78 s | 0.59 s | 1.30 s | 0.86 s |
| of it `vision` | 0.80 s | 0.80 s | 1.09 s | 1.08 s |
| `project()` | 3600 calls, 0.25 ms each, 24.0% | 2049 calls, 0.19 ms, 12.6% | 3600, 0.35 ms, 23.6% | 2065, 0.30 ms, 14.5% |
| figure ids (`enemy_figure_ids`) | | 1551 calls, 0.005 s | | 1535 calls, 0.005 s |
| `decide` (both bots) | 16.6% | 20.0% | 15.5% | 19.3% |
| garbage collector | 3.7% | 2.5% | 4.0% | 2.5% |

By item, from the components of the same pair of runs (narrows / ridge): the light projection 0.39 / 0.53 s (10%),
the reused vision 0.13 / 0.10 s (2 to 3%), the field memo 0.19 / 0.44 s (5 to 8%), the collector 0.06 / 0.10 s
(2%), the worker reuse 0.10 to 0.25 s per match outside it. The options memo gives nothing measurable for this pair
and 0.21 s of the 5.7 s of a `smart_expander@hard` mirror on highway (decisions 1.71 -> 1.50 s). The gain of the
light projection grows with the `easy` and `normal` bots of a field (10 of the 17 bots of #785); a match of two
always thinking bots keeps only the other items. Out of scope: the flow plan of every tick (#785, item 3) changes
`state_hash`.
