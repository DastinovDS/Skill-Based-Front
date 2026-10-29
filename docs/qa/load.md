# Load test: 30 parallel matches in one server process (QA-03, #85)

The budget (AGENTS.md, section 12): one server process on one core plays **30 parallel matches with a mean tick lag under 10 %** of the
tick (10 ms at 10 ticks per second). This document says how to measure it on the target VPS, what the harness measures, and what was
measured locally.

**Status.** The harness and the procedure are done. The run on the target VPS is `[manual]` (the owner, below), so #85 stays open.
The only run so far was on a developer Mac under a heavy foreign load and says nothing about the VPS: see "Local run".

## The harness

`gow_server.loadtest` (`apps/server/src/gow_server/loadtest.py`, standard library and `websockets`, no new dependency). For N matches it:

1. creates 2N guests (`ld<salt><n>`, the salt makes a run's nicks unique) and plays the invite flow for every match
   (`POST /api/matches`, `join`, `ready` twice) on a map of the pool, with the starts spread over `--ramp-s` seconds;
2. connects both players of each match over `/ws/match/{id}` like the web client (`hello`, then `snapshot`s at 10 Hz with the
   per-connection compression the browser negotiates) and plays: every 25 ticks each idle group goes to a random neighbour node, the
   same scripted client as in `test_match_load` and `test_e2e_match`. Sockets are opened at most 4 at a time: all of them come from one
   address and the server caps sockets that have not sent `hello` per address (`GOW_WS_UNAUTH_PER_IP`, #199); a `1013` is retried and
   counted, so the run also shows that cap does not interfere (it counts a connection for milliseconds only);
3. when all matches run, measures for `--duration` seconds (default 180), then one player of each match resigns, so no match is left to
   the reconnect window.

It reads `GET /internal/metrics` before and after the window and takes the **difference** of the histograms, so the ramp-up and any earlier
history of the process are not in the numbers. It also samples the server process in `/proc` (CPU and resident memory) every `--sample-s`
seconds and records what the clients saw (the gaps between the snapshots they received, errors, close codes).

| Reported | Source | Looking for |
|---|---|---|
| tick lag: mean, share of ticks over 10 ms, p99 bucket | `gow_tick_lag_seconds` (server) | **mean under 10 ms** (the acceptance criterion); p99 is the upper bound of the histogram bucket |
| step: mean, p99 bucket | `gow_step_seconds` (server) | the step with both projections and frame encoding: AGENTS.md section 12 budgets 0.3 ms for the simulation step alone and 0.3 ms per projection |
| CPU, RSS | `/proc/<pid>` of the server (in the container) | CPU of one core stays under 100 % with headroom; RSS does not grow over the window |
| crashed matches, refused (full), refused before hello, outbox backlog | server counters | all zero; a backlog of a few is fine |
| gap between snapshots (mean, p99, max) | the clients | mean 100 ms; p99 close to it: what a player feels |
| CPU of the harness | the harness | context: it runs on the same machine |

Exit code 0 when every check passed (tick lag budget, all matches started and ended, no crash, no client error), 1 otherwise; `--json FILE`
writes everything, including the time series of the samples.

## Running it on the VPS `[manual]`

The metrics endpoint answers on loopback only (`docs/ops/deploy.md`, section 7), so the harness runs **inside the `app` container**, where
it also finds the server process. It needs three limits of the production defaults lifted for the run, and restored afterwards:

| Setting | Default | For N = 30 | Why |
|---|---|---|---|
| `GOW_GUEST_RATE_LIMIT` | 10 per hour per address | at least 2N, e.g. 100 | the harness makes 2N guests from one address (the harness stops with a message on a 429) |
| `GOW_MAX_MATCHES` | 30 | at least N | already enough for 30; raise it to test more |
| `GOW_WS_UNAUTH_PER_IP` | 10 | no change | the harness opens 4 sockets at a time, so it also checks this cap |

```sh
cd /srv/skill-based-front            # the checkout used by deploy/deploy.sh
# 1. Lift the guest limit for the run (restart the app: no matches are running, otherwise drain first)
echo 'GOW_GUEST_RATE_LIMIT=100' >> .env
docker compose up -d app

# 2. The run: about 3.5 minutes, 30 matches, one map of the pool
docker compose exec -T app python -m gow_server.loadtest --matches 30 --duration 180 --json /tmp/load.json

# 3. Keep the result, restore the limit
docker compose cp app:/tmp/load.json ./load-$(date +%F).json
sed -i '/^GOW_GUEST_RATE_LIMIT=100$/d' .env
docker compose up -d app
```

Then paste the printed report into the "Target VPS" section below with the date, the VPS (provider, plan, vCPU, RAM), the commit
(`git rev-parse --short HEAD`) and the ruleset. Useful extras: `docker stats --no-stream` during the run (the whole container), `docker compose
exec app sh -c 'ulimit -n'`, and a second run with `--map <other>` for the other maps of the pool.

Notes for reading the result:

- The harness shares the machine, and the cgroup, with the server (its CPU is in the report). With one vCPU it competes with the server
  and the lag is pessimistic; with two or more the server, a single thread, keeps its own core. To take the harness off the server's
  machine, run it from another host against the public URL with `--no-server-metrics --base-url https://<DOMAIN>`: only the client-side
  gaps (and a verdict on them) remain, the tick lag is then read from `/internal/metrics` by hand before and after.
- The run leaves 2N guests (`ld...` nicks), N finished unrated matches and their replays (expired by `GOW_REPLAY_RETENTION_DAYS`) in the
  database of the stack: do it before the launch, or on a stack with a throwaway volume (`docker compose -p <other> ...`).
- Scripted clients move groups every 2.5 s and never build, recruit or schedule orders: the simulation part of the load is lighter than
  with humans, the wire part (frames to 60 sockets) is the real one. A busier script is a follow-up if the first result is close to the budget.
- Matches against a bot (`POST /api/bot-matches`) are not covered: they add one bot decision per 5 ticks and are capped by
  `GOW_MAX_BOT_MATCHES` (10).

On a developer machine the same harness runs against `mise run dev:server` (loopback, metrics readable from the host): `mise run load -- --matches 5
--duration 30`. Against the agents' stack (project `sbf-agent`, lift the guest limit when starting it): `GOW_GUEST_RATE_LIMIT=100 mise run
stack:agent`, then `mise run load:agent -- --matches 30 --duration 150`, then `mise run stack:agent:down`.

## Local run: local Mac, shared machine, not the target VPS

**These numbers are not the answer to the acceptance criterion.** They were taken on a developer Mac (Docker Desktop VM with 10 vCPUs,
`mvp-1`, map `crossroads`, 49 nodes) while other work was running on the same machine: the load average of the host was **63 to 105
on 10 cores** before, during and after the run, so the server process was constantly descheduled and its measured CPU time includes
time stolen by the host. They show that the harness works end to end and how the budget fails under contention, nothing more.

Command: `GOW_GUEST_RATE_LIMIT=100 mise run stack:agent`, then `mise run load:agent -- --matches 30 --duration 150 --ramp-s 10 --sample-s 10`
(2026-10-29, commit of the PR #536 branch).

```
Matches: 30 started, 30 ended cleanly; window 152 s at 10 ticks/s
Server steps in the window: 19918
Tick lag: mean 101.89 ms, 64.32% of ticks over 10 ms, p99 bucket <= 300 ms
Step: mean 6.504 ms, p99 bucket <= 30.0 ms
Crashed 0, bot overruns 0, refused (full) 0, refused before hello 0, outbox backlog max 2
Server process: CPU mean 99% of one core (max sample 100%), RSS 108 -> 109 MB (max 109)
Clients: 28680 snapshots, 5117 moves; gap between snapshots mean 325.2 ms, p99 1038.9 ms, max 1815 ms, 78.63% over 1.5 ticks
Harness itself: CPU 10% of one core (it shares the machine with the server when run in the container)

FAIL  mean tick lag 101.89 ms = 101.9% of the tick (budget 10%, 10 ms)
PASS  30 of 30 matches started
PASS  30 of 30 matches ended cleanly after the resign
PASS  matches crashed: 0
PASS  server steps in the window: 19918
PASS  client errors: none
```

What can be read from it:

- Functionally the stack held 30 matches and 60 sockets: no crash, no refusal (neither `503` nor `1013`: the per-address cap of #199 did
  not interfere), no client error, every match ended cleanly, memory flat at about 109 MB for the process.
- The server was **saturated**: 19 918 steps in 152 s are 131 per second instead of the 300 that 30 matches at 10 ticks per second need,
  at 99 % of a core. A step (simulation, both projections, both frames) took 6.5 ms on average here. A separate single-thread
  measurement on the same busy machine (one `MatchRunner` on `crossroads`, `mvp-1`, 50 ticks in) gave 0.73 ms for `Match.step`, 2.0 ms for one
  projection with frame encoding (36 KB per frame) and 0.34 ms to deflate that frame: about 4.7 ms per match and tick at the speed of the
  machine that day, so 30 matches need about 140 ms of every 100 ms tick, which is what the run shows. The one projection is about
  four times the 0.45 ms budget of section 12 for maps of this size, so the machine was at least that much slower than the reference
  one (`docs/perf.md`); how much of the 4.7 ms is the contention and how much the code, only a run on a quiet machine can say.
- Frames are large: about 36 KB per snapshot per player at 10 Hz, 60 connections, about 21 MB/s before compression in total. Whether the
  VPS (and the owner's bandwidth plan) sees that as a problem is for the VPS run; the in-process `test_match_load` has no sockets and does not
  show this part of the cost.

Reproduce under less contention before relying on any of it; the VPS run replaces this section.

## Target VPS `[manual]`

Not run yet. The owner pastes the report of the command above here (date, VPS plan, commit, ruleset, map) and closes #85 if the
verdict is `PASS`; a `FAIL` goes into an issue with the report attached (the first suspects: frame size and compression, the per-tick
projection cost, a single vCPU shared with the harness).
