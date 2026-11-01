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

The GitHub Actions runners (`ubuntu-latest`, CI `py`) are about 2.5 times slower than the reference; the budgets
there are scaled (below).

## How to measure

Benchmarks: `packages/sim/tests/test_benchmarks.py` (`pytest-benchmark`) and `apps/bots/tests/test_benchmarks.py`, plus
`apps/server/tests/test_match_load.py` (tick lag), plus the ratio of the snapshot cost to `project()`
(`packages/protocol/tests/test_convert.py::test_snapshot_frame_costs_no_more_than_project`). All of them are marked `pytest.mark.perf`: they are part of the ordinary
`uv run pytest`, and in CI they run as a separate sequential step `uv run pytest -m perf`. Under `pytest-xdist` (`-n`)
`pytest-benchmark` itself disables the measurements, so with `-n` the budgets are not checked: these tests are not part of the main parallel run of
CI (`-m "not perf and not slow"`).

```sh
uv run pytest packages/sim/tests/test_benchmarks.py            # a time table and the budget checks
uv run pytest --benchmark-disable                             # one run without measurements and without checks
```

| Benchmark | What is measured | Budget |
|---|---|---|
| `test_bench_step` | `Match.step` without projections, a 40-node map (`grid40` from `conftest.py`) with 40 groups, both players under `ExpandBot`; the controllers and projections are in the untimed `setup` | on average ≤ 0.3 ms, p99 ≤ 1 ms |
| `test_bench_supply` | the `supply` system on the state after 300 ticks of the same match, with packets on the way | ≤ 0.1 ms |
| `test_bench_supply_lines[grid40]`, `[grid55]` | the economy v2 supply (`systems.lines`, DEC-41, #644) in a dispatch tick: a line from the capital to every own node along the supply tree (DEC-42: no limit of lines), two more factories on the tree as hubs, every other target full, packets of the last dispatch on the way | ≤ 0.1 ms (the section 12 supply budget; measured ≈ 0.04 and 0.07 ms on the M4 reference) |
| `test_bench_supply_many_donors_busy_roads` | `supply` in a dispatch tick on a stress state (#306): 20 cities per player on `grid40`, ten with a deficit, ten donors, markers on empty front cities, the transfers took the roads near the capital, so almost every dispatch runs into an exhausted throughput and looks for a detour (#309) | ≤ 1 ms, accepted by the owner 2026-10-21 (the dispatch is once per `supply.dispatch_ticks` ticks; the section 12 budget "0.1 ms" refers to `test_bench_supply`) |
| `test_bench_project` | one `project()` on the same state | ≤ 0.3 ms |
| `test_bench_step[grid55]`, `test_bench_supply[grid55]`, `test_bench_project[grid55]`, `test_bench_project_with_enemy_figures[grid55]` | the same on `grid55` (5 × 11, 55 nodes, 94 edges, 56 groups): the size of the DEC-27 maps (#266, item 7) | step and supply: the 40-node budgets; projection: 0.45 ms, accepted by the owner 2026-10-22 (#371; 0.3 ms on 55 nodes is exceeded: 0.32 ms, with figures 0.41 ms) |
| `test_bench_full_headless_match` | `run_headless` of two `ExpandBot` to the end of the match on `web` (the biggest MVP map by edges) | ≤ 8 s |
| `apps/bots/tests/test_benchmarks.py::test_bench_decide` | `decide()` of every bot from `gow_bots.bots.BOTS` on the views of a `random_legal` match on `web` after 300..1500 ticks | on average ≤ 1 ms |
| `apps/server/tests/test_match_load.py` | 30 matches on `web` (`mvp-0`) in one event loop, starts at random moments, two scripted clients per match (orders by the protocol, projections of both players); the clock is slowed down by `speed_factor` times, that is the load of the reference. Tick lag: how much later than the deadline a step started (`MatchRunner.lag_sum`). `speed_factor` is measured before and after the run, the larger one is taken; two attempts, the better one passes (the shared CI runner sometimes slows down in the middle of a run) | mean < 10% of a tick, no schedule resets |
| `packages/protocol/tests/test_convert.py::test_snapshot_frame_costs_no_more_than_project` | `snapshot_frame` (a snapshot together with the JSON encoding) against `project()` on the view of a `rusher` match on `web` after 300 ticks; a ratio on one machine, without `speed_factor` | no more expensive than `project()` (× `REGRESSION`) |
| `apps/bots/tests/test_benchmarks.py::test_bench_decide_strategy_views` | `decide()` of `expander` and `turtle` on the views of their own match on `web` after 300..1500 ticks (many groups, construction, contact with the enemy) | on average ≤ 1 ms |

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

## The bot tournament (BOT-04)

The budget (AGENTS.md, section 12): 1000 matches on 8 cores in no more than 20 minutes. One `mvp-0` match
(7200 ticks, `random_legal` against `random_legal`) takes about 1.3 s of one core, plus the process
start (`spawn`, one match per process). The estimate for 1000 matches on 8 cores: about 3 minutes.
A measurement on the developer's machine at load average 22 on 10 cores (someone else's tasks): 96 matches in 52 s
(`--jobs 8`), that is 1000 matches in about 9 minutes, within the budget even at such a load.

The BAL-01 measurement (#39) on the reference machine (Apple M4, 10 cores, 16 GB, macOS 15.7.3), `mvp-0`, 5
strategic bots, `--jobs 8`; the machine was not idle (other agents worked in parallel):

| Run | Matches | Time | Load average | Per 1000 matches |
|---|---|---|---|---|
| the first 1000 matches of the `--seeds 100` tournament (3 maps) | 1000 | 324 s | 2.6 at the start, up to 7-9 | 5.4 min |
| the full `--seeds 100` tournament, one map after another | 7500 | 3494 s (artery 925, web 1359, pass 1210) | 9-12 | 7.8 min |

The budget of 20 minutes per 1000 matches was met in both measurements; a measurement on an idle machine was not made.
