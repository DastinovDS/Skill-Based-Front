# Balance: the bot tournament and the result format

The tournament (BOT-04, #37) runs bots against each other on maps and writes one JSONL line per match.
The report on this file is built by `gow-bots report` (BOT-05, #38); this document describes the format
the report relies on.

> Map ids were renamed to English in #390 (`arteriya` is `artery`, `pautina` is `web`, `pereval` is `pass`, `hrebet` is `ridge`, `perekrestki` is `crossroads`, `trakt` is `highway`); the tournament results and reports in this folder keep the old ids on purpose, they are history and are not rewritten.

## Running

```bash
uv run gow-bots tournament --maps maps/*.json --bots all --seeds 100 --jobs 8 --ruleset rulesets/mvp-2.toml
```

| Key | Meaning |
|---|---|
| `--maps` | map files (the shell expands the glob; an unexpanded glob works too) |
| `--bots` | names from `gow_bots.bots.BOTS` or `all` (the whole registry, new bots are picked up by themselves); a smart bot takes a difficulty level after `@`: `smart_rusher@easy`, `@normal`, `@hard` (the name alone is `hard`; `gow_bots.bots.tempo`, #166) |
| `--seeds N` | `N` seeds per map and pair: `seed-base .. seed-base + N - 1` |
| `--seed-base` | the first seed, 0 by default |
| `--jobs` | the number of processes, the number of cores by default |
| `--ruleset` | the ruleset, `rulesets/mvp-0.toml` by default |
| `--out` | the result file, `docs/balance/latest.jsonl` by default |
| `--replays DIR` | additionally write the replay of every match into `DIR` |

### Running on GitHub runners (#582)

A long tournament does not belong on a laptop. The workflow `.github/workflows/tournament.yml` (manual
dispatch only, it is not a required check) plays it on GitHub runners:

```bash
mise run tournament:gh -- --help                       # all options
mise run tournament:gh --seeds 100 --shards 10 --label bal02
mise run tournament:gh --ref feature/123-x --ruleset rulesets/mvp-2.toml --bots "rusher smart_rusher@normal" --seeds 20
```

| Option | Meaning |
|---|---|
| `--ref` | the git ref to check out and to dispatch from (`develop` by default); a branch must be pushed and contain the workflow |
| `--ruleset`, `--bots`, `--maps`, `--seeds` | as for `gow-bots tournament`; `--seeds` is the total over all shards, `--bots` is a space-separated list or `all`, `--maps` the pool `maps/*.json` by default |
| `--shards` | parallel runner jobs, 10 by default, at most 20, never more than `--seeds` |
| `--label` | a name for the run title and the artifact |
| `--dir` | where the artifact lands (`.tournament/`, outside git) |

The task dispatches the run, waits with a single `gh run watch --exit-status` and downloads the artifact
`tournament-<label>-<run id>/` with `tournament.jsonl` and `report.md` (and the charts of the report).
The inputs are in the job summary of the run and in the artifact name.

How it keeps the result equal to a local run: the seeds `seed_base .. seed_base + seeds - 1` are split into
contiguous ranges, each shard runs `mise run tournament` with its `--seed-base`/`--seeds` and `--jobs` = the CPU count of
the runner, and `scripts/tournament_shards.py merge` puts the rows into the order of a single run
(`map, seed, bot0, bot1`, see below) without touching their text. The merged file is byte-identical to the
file of `mise run tournament` with the same arguments (the test `tests/test_tournament_shards.py`). Runners use the
Python of `.python-version` (uv fetches it; a shard fails if the version differs).

**Agents: prefer this to a local run for anything above `--seeds 3`**; the smoke tournament of 3 seeds stays local.

Matches: `maps x bots x bots x seeds`. Every **ordered** pair `(the bot of side 0, the bot of
side 1)` plays: each pair meets from both sides, each bot also plays itself (this gives an
estimate of the skew between the sides of a map). The match seed is shared by both bots; the bot's parameters are chosen from
`(name, seed, side)` (AGENTS.md, section 8).

One match = one process (`ProcessPoolExecutor`, `max_tasks_per_child=1`, the `spawn` start). The order of
lines is fixed: `(map, seed, bot0, bot1)`, where maps and bots are sorted by name. The result
depends only on the arguments and the code: a repeated run gives the same file byte for byte (there is no
time or paths in the lines). The file is written to `<out>.tmp` and renamed when finished.

The metrics of a real match (a PT-01 / REL-01 replay) by the same code:

```bash
uv run gow-bots analyze path/to/match.jsonl.gz --rulesets rulesets/archive --maps maps
```

It prints the same kind of JSON line with the metrics (without the match identification fields, but with `replay`) and the key
`stats` with the player statistics (section "Player statistics"). A table for a human to read:

```bash
mise run stats path/to/match.jsonl.gz            # arguments after the task name: files and options
uv run gow-bots stats a.jsonl.gz b.jsonl.gz --rulesets rulesets/archive --maps maps
```

## The line format (`schema` = 1)

One line = one JSON object, ASCII, without spaces. The fields with `[a, b]` are indexed by the player id
(0 and 1, that is by the side). The value `null` in a list: there is no metric (division by zero).

| Field | Type | Meaning |
|---|---|---|
| `schema` | int | the line format version; grows when a field is removed or changes meaning |
| `map` | str | the map name (`meta.name`) |
| `map_hash` | str | the map hash |
| `ruleset_hash` | str | the ruleset hash |
| `sim_version` | int | `SIM_VERSION` of the engine |
| `seed` | int | the match seed (of the bots) |
| `bot0`, `bot1` | str | the bot names of side 0 and 1 |
| `state_hash` | str | `state_hash` of the final state (a reproducibility check) |
| `winner` | int or null | the winning side; `null`: a draw or the match is not finished |
| `reason` | str | the reason for the end: `capital`, `forfeit`, `vp`, `cities`, `draw`, `double_defeat` (the values of `EndReason`) or `unfinished` |
| `ticks` | int | the last played tick |
| `duration_s` | float | `ticks / tick_hz`, seconds of game time |
| `vp` | [int, int] | the final victory points |
| `cities` | [int, int] | the number of nodes the player owns at the end |
| `orders` | [int, int] | accepted `Move` orders |
| `attack_orders` | [int, int] | of them attacking: the target did not belong to the player at the moment of the order |
| `planned_attack_orders` | [int, int] | of the attacking ones the scheduled (`planned=true`) |
| `planned_attack_share` | [float or null, ...] | `planned_attack_orders / attack_orders`, 4 digits; `null` without attacks (the BAL-01 definition: empty nodes count as attacks) |
| `siege_orders` | [int, int] | of the attacking ones those into a node with an enemy garrison: a group of the opponent stood in the destination at the moment of the order (the end of the previous tick) (#590) |
| `planned_siege_orders` | [int, int] | of the siege orders the scheduled ones (#590) |
| `planned_siege_share` | [float or null, ...] | `planned_siege_orders / siege_orders`, 4 digits; `null` without siege orders. **The gate metric** "share of scheduled attacks" (#40, criterion 3; the owner's decision 2026-10-30, #590; mechanics.md, section 5) |
| `sieges` | [int, int] | siege attempts: a fight for an enemy node with the player as the attacker, or an entry into an empty enemy node |
| `sieges_won` | [int, int] | successful sieges: captures of enemy nodes (neutral ones do not count) |
| `captures` | [int, int] | all captures of nodes, neutral ones included |
| `captures_by_minute` | [[int, ...], [int, ...]] | the player's captures by match minute; minute `m`: ticks `m*60*tick_hz < t <= (m+1)*60*tick_hz`; the length is `ceil(ticks / (60*tick_hz))`, at least 1 |
| `accepted` | [int, int] | accepted commands of all kinds |
| `rejected` | [int, int] | rejected commands |
| `stock_mean_centi` | [int or null, ...] | the mean of the total charge stock in hundredths of a charge (#310, section "Charge stock and burned share"); `null` without samples |
| `stock_peak` | [int, int] | the peak of the total charge stock (#310) |
| `charges_produced` | [int, int] | charges produced: the sum of `charges` of the `charges_produced` events (#310) |
| `charges_burned` | [int, int] | charges burned: the sum of `charges` of the `charges_overflow` events (#310) |
| `burned_permille` | [int or null, ...] | the share burned in per mille, `charges_burned * 1000 // charges_produced`; `null` without production (#310) |
| `charges_start`, `charges_fights`, `charges_captures`, `charges_packets_lost`, `charges_warehouses_lost`, `charges_starved`, `charges_attrition`, `charges_end` | [int, int] | the charge ledger (#588, section "Charge ledger and flow"): the stock before tick 1, the charges spent in fights, on captures (DEC-38), lost in cut packets, lost with captured warehouses, starved, killed with units, and the stock after the last tick |
| `charges_built`, `charges_plans` | [int, int] | economy v2 (DEC-41): the charges paid for buildings (`build_paid` warehouse + units, item 7) and taken by waiting planned orders for their bonus (`plan_charged`, one each, item 10); 0 under v1 (#646) |
| `charges_residual` | [int, int] | `charges_start + charges_produced` minus all sinks (`charges_burned`, the six above and the two v2 sinks) minus `charges_end`; 0 when every charge is explained by an event (#588) |
| `charges_sent`, `charges_delivered`, `charges_delivered_front`, `charges_transfers` | [int, int] | the supply flow (#588): charges in dispatched packets, in all delivered packets (one-off transfers included), of them delivered into a city with a front marker, sent by transfers |
| `stock_by_place_minute` | [{place: [int or null, ...]}, ...] | the stock by place and match minute in hundredths of a charge (#588); places `cap_wh`, `front_wh`, `rear_wh`, `units_node`, `units_road`, `packets`; `null`: no sample in that minute |
| `marker_ticks`, `front_empty_ticks`, `front_empty_cap_has_ticks`, `cap_full_ticks` | [int, int] | the supply bottleneck in ticks (#588) |
| `front_empty_permille`, `front_empty_cap_has_permille` | [int or null, ...] | the second and the third over `marker_ticks`, per mille, rounded down; `null` without marker ticks (#588) |
| `usage` | [{str: int}, {str: int}] | accepted commands of each player per mechanic (#166): the command class name (`Move`, `CancelOrder`, `Split`, `Merge`, `SetMode`, `SetStance`, `Recruit`, `CancelRecruit`, `BuildBarracks`, `UpgradeWarehouse`, `UpgradeRoad`, `SetFront`, `SetRearMin`, `Transfer`, and the economy v2 commands `DrawLine`, `RemoveLine`, `BuildFactory`, `BuildBunker`, `ReleasePlan`, #648), a planned `Move` as `MovePlanned`; `Forfeit` is not counted. The report shows it as the section "Mechanic usage" |

The fields `stock_*`, `charges_*` and `burned_permille` were added in #310 without changing `schema`: nothing was removed and
nothing changed meaning. Tournament files older than #310 do not contain them, the report shows "no data" for them.
`usage` was added in #166 the same way; older files show n/a in its section.
`siege_orders`, `planned_siege_orders` and `planned_siege_share` were added in #590 the same way (no field changed
meaning); the report shows the gate share as n/a for older files, next to the share over all attacks. The charge ledger, flow, stock by place and
bottleneck fields (#588) were added the same way (only additions, `schema` stays 1); the report shows n/a for older files.

The metric definitions are set in `packages/sim/src/gow_sim/analysis.py` (the module docstring).
A "scheduled" and an "attacking" order is not visible in the event log (`Move` leaves no event),
so `MatchRecorder` classifies an order at the moment it is applied.

## Player statistics (#375)

The metrics above describe the outcome and the fights; the player statistics describe **how a human or a bot played**.
The source: the command log of the match (all the commands sent with the `validate` verdict and the price
the simulation charged) and the events the simulation already writes (`stance_changed`, `transfer_started`,
`recruit_cancelled`). There are no new events, `state_hash` does not change. The code: `gow_sim.analysis`
(`analyze_stats`, `PlayerStats`), the module docstring is there too; the output: the key `stats` in the
JSONL of `gow-bots analyze` and the table of `gow-bots stats`. The statistics are not part of the tournament lines
(`MatchMetrics` was not changed). The replay has to be re-simulated, so the ruleset and the map are needed (the archive
`rulesets/archive/<hash>.toml`). The charge stock metric (#310) counts the state, not the actions:
these are separate fields, the only thing they share is `MatchRecorder`/`MatchLog`.

`stats.players[p]` (by side `p`, 0 or 1):

| Field | Meaning |
|---|---|
| `stance_timeline` | a list of `[tick, stance]`: the first entry is `[0, economy.start_stance]`, then every accepted `SetStance` |
| `stance_ticks` | ticks in each stance; a stance set in tick `t` works from tick `t` (`apply_commands` goes before `economy`), the starting stance from tick 1; the sum equals `ticks` |
| `commands` | all the commands the player sent, except `Forfeit`; `rejected` of them were rejected (`Forfeit` is counted in `MatchMetrics.rejected`) |
| `apm_avg` | `commands * 60 * tick_hz / ticks`, 3 digits; `null` at `ticks = 0` |
| `apm_by_minute`, `apm_peak` | commands by match minute (minute `m`: ticks `m*60*tick_hz < t <= (m+1)*60*tick_hz`, the last minute may be shorter) and the maximum of them |
| `supply` | ticks of the accepted `SetFront` (`set_front`), `SetRearMin` (`set_rear_min`), `Transfer` (`transfer`); `transfer_charges`: the sum of charges from `transfer_started` (a shipment is cut by the free space of the target, so it can be less than the command's `n`) |
| `orders`, `planned_orders` | accepted `Move` and of them the scheduled ones |
| `planned_share` | `planned_orders / orders`, 4 digits; `null` without orders |
| `planned_attack_share`, `planned_siege_share` | as in `MatchMetrics` (#590: the second one is the gate share) |
| `cp_by_category` | CP spending in hundredths by accepted commands and the prices `orders.cost` of the ruleset: `move`, `planned_move`, `mode` (`SetMode`), `recruit` (recruiting minus the `CancelRecruit` refunds), `road` (`UpgradeRoad`), `barracks`, `warehouse`, `transfer`, `other` (`Split`, `Merge`, `CancelOrder`, `SetStance`, `SetFront`, `SetRearMin`: free in the MVP rulesets) |
| `cp_refunded`, `cp_total` | the refund for cancelling a recruit (already subtracted from `recruit`) and the sum of the categories |

A rejected command costs nothing. The real CP balance (regeneration, burning at the cap) is not
reconstructed: these are spendings by commands. The decisions on the disputed points were made by default
(a comment in #375): net spending with refunds, `Forfeit` outside APM, an offline tool without
display in the game and without a server API.

## Charge stock and burned share (#310)

A balance statistic of how much a player stores and how much of the production is wasted. It is
**not a game rule**: no DEC, no ruleset field, nothing in `mechanics.md` changes, and the
simulation does not know about it (the state hash and `SIM_VERSION` are untouched). It exists to
check on tournaments the conclusions of DEC-28 about accumulation (`mechanics.md`, section 8,
"Accumulation: edge cases"): a quiet phase runs into the storage and the surplus burns. Code:
`gow_sim.analysis` (`charge_stock`, `MatchRecorder`, `MatchMetrics`), the module docstring there
has the same text.

**Charge stock** of a player at the end of tick `t`:

```
stock(t) = sum of warehouse of the cities the player owns
         + sum of charges of the player's packets on roads
         + sum of charged of the player's groups (at nodes and on edges)
```

A charge is counted once: a charge that left a warehouse in a packet, or was taken by a unit
(recharge), is no longer in the warehouse. A captured city's warehouse is zeroed by the
simulation (`warehouse_lost`), so it drops out of the stock of the old owner at once. Enemy
charges are never counted.

`MatchRecorder` samples `stock(t)` after every tick `t = 1..ticks` into `MatchLog.stock` (a loop
over nodes, packets and groups: about 8 microseconds per tick on a loaded development machine, about
1% of a headless match). Per match and player:

| Value | Formula (integers, rounded down) |
|---|---|
| `stock_peak` | `max(stock(t))` over the samples; 0 without samples |
| `stock_mean_centi` | `sum(stock(t)) * 100 // n`, `n` the number of samples; in hundredths of a charge (`375` is 3.75 charges); `null` when `n = 0` |
| `charges_produced` | sum of `charges` of the player's `charges_produced` events: everything the economy made, the spill that does not fit into the capital included |
| `charges_burned` | sum of `charges` of the player's `charges_overflow` events: charges that found no room in a warehouse (the spill of the capital, or the end of a packet's path) |
| `burned_permille` | `charges_burned * 1000 // charges_produced`, per mille; `null` when nothing was produced |

Only `charges_overflow` is burning. Charges that disappear in other ways (`packet_lost` on a road
that stopped being internal, `warehouse_lost` on a capture, starvation, use in a fight) are not
counted as burned, and the start stock of the map is never produced, so it never burns. The
burned share is therefore between 0 and 1000 per mille.

The tournament report (`gow-bots report`, section "Charge stock and burned share") aggregates the rows per bot and
per map: mean of `stock_mean_centi` and of `stock_peak`, the highest peak, and the **burned share
of the group** = total `charges_burned` / total `charges_produced` over its matches (not the mean
of per-match shares, so a match with little production does not count as much as one with a lot).
`gow-bots analyze` prints the same fields for a real match.

## Charge ledger and flow (#588)

The permanent form of the one-off analysis in [charge-flow.md](charge-flow.md). Not a game rule: no event or field was
added, `SIM_VERSION` and the golden replays are untouched. The numbers come from the events the simulation already
writes, plus two samplings of the state by `MatchRecorder` (so tournament matches and re-simulated replays give the same
values). Code and exact definitions: the module docstring of `gow_sim.analysis` (`analyze`, `ChargeFlow`,
`charge_places`). All values per player, charges, integers.

**Ledger.** `charges_start + charges_produced = charges_burned + charges_fights + charges_captures +
charges_packets_lost + charges_warehouses_lost + charges_starved + charges_attrition + charges_built + charges_plans +
charges_end`, and
`charges_residual` is the difference (must be 0). Sources by event: `charges_fights` is the player's
`spent_<p>` of every `fight_round`; `charges_captures` is the number of `node_captured` times `capture.charge_cost`
(DEC-38); `charges_packets_lost` is `packet_lost`; `charges_warehouses_lost` is `warehouse_lost` (its `owner`);
`charges_starved` is `warehouse + units` of `starvation`; `charges_attrition` counts the `attrition` events that
killed a charged unit; under economy v2 `charges_built` is `warehouse + units` of `build_paid` and `charges_plans` counts
`plan_charged` (#646). `charges_start` and `charges_end` are the charge stock (section "Charge stock") before the first
and after the last tick. A nonzero residual means a rule moved a charge that no event explains: extend the ledger.

**Flow.** `charges_sent` is the sum of `packet_sent` (the supply dispatch); `charges_delivered` the sum of all
`packet_delivered` (what the target warehouse accepted; transfers included); `charges_delivered_front` the part of it
delivered into a city that has a front marker at the end of that tick; `charges_transfers` the sum of `transfer_started`.

**Stock by place.** At the end of every 10th tick (`PLACE_SAMPLE_TICKS`, one second) the stock is split into the capital
warehouse (`cap_wh`), the warehouses of the cities with a front marker (`front_wh`), all other warehouses
(`rear_wh`), charged units standing in nodes (`units_node`), charged units on roads (`units_road`) and packets
(`packets`); the places sum to the charge stock. `stock_by_place_minute[p][place][m]` is the mean of the samples of
minute `m` (ticks `m*60*tick_hz < t <= (m+1)*60*tick_hz`) in hundredths of a charge, rounded down.

**Supply bottleneck**, counted in every tick: `marker_ticks` is the ticks in which the player owns its capital and a city
other than the capital with a front marker; `front_empty_ticks` the part of them in which such a warehouse is empty;
`front_empty_cap_has_ticks` the part of those in which the capital's warehouse is not empty (the supply, not the
production, is the limit); `cap_full_ticks` the ticks in which the owned capital's warehouse is full (all ticks, not only
marker ticks).

Where to read it: the tournament rows (above); `gow-bots report`, section "Charge flow (#588)" (a table per bot with the
means per player and match, the bottleneck shares summed over the group's ticks, and the mean stock by place);
`gow-bots analyze` (the same keys) and `gow-bots stats` (rows `charges ...`, `ledger residual`, `marker city empty`,
`mean stock <place>` after the CP rows). Not included (needs a new event or a state sample at the start of a fight): the
siege composition of charge-flow.md; the cost of the added counting is below 2% of a headless match.

## Report

```bash
uv run gow-bots report docs/balance/latest.jsonl            # writes latest.md and latest-*.png next to it
uv run gow-bots report run.jsonl --out-dir /tmp/rep --name run
```

The report (`gow_bots.report`, matplotlib only here) builds from a tournament file:
the bot competence checks from BOT-05, the matrix of pairs with 95% Wilson intervals, the side
advantage (mirrored matches), the metrics per bot (the share of scheduled attacks, the siege success, the captures in
the last 3 minutes), the strategy diversity (a dominant strategy, "rock-paper-scissors" cycles),
the number of unique outcomes and the breakdown by map. The output depends only on the lines of the file.

The BAL-02 confirming run (#40) is committed: `latest.md` and `latest-*.png` from 30000 matches of `mvp-2` (the 10
strategic bots, the 3 pool maps, 100 seeds, GitHub runners); `latest.jsonl` holds seeds 0..9 of that run (the full
file is 76 MB, reproducible with `mise run tournament:gh --ruleset rulesets/mvp-2.toml --seeds 100`). The BAL-01 run
(#39, `mvp-0`) is in the git history of these files. The verdict by the gate criteria and the iterations: [log.md](log.md).

## Parameter search

```bash
mise run search -- --bot smart_turtle --against smart_rusher smart_expander --keys region guard --rounds 30 --seeds 2
```

`gow-bots search` (`gow_bots.search`, #166, standard library only) tunes the `PARAMS` ranges of one bot by
tournament: a (1+1) hill climb. Round 0 scores the ranges of the class, every next round moves `--mutate` of the
`--keys` one step (a quarter of the middle of the range, at least 1; the width stays) and keeps the candidate when it
scores higher. The score is the win rate against the `--against` bots (both sides, every map, the same seeds for
every candidate, a draw counts half) plus a tenth of the mean VP share; `--target T` aims at a win rate instead of up.
Every round is a line of `--out` (JSONL); the best ranges are printed as a `PARAMS` fragment. A search measures on few
seeds and overfits them: confirm a result with a tournament on fresh seeds (`--seed-base`).

## Difficulty levels and tempo

The smart bots play at a human tempo (`gow_bots.bots.tempo`, #166): a decision at most every `think_ticks`, an enemy
strike or figure noticed `react_ticks` after it is shown, at most `apm` commands a minute (a token bucket of `burst`),
and `insight` (the position thresholds, the DEC-37 pin, the evacuation of doomed cities, the scouts) only from
`normal` up. `apm_avg` and `apm_by_minute` of `gow-bots stats` measure the result on replays.

| Level | think | react | APM (burst) | insight |
|---|---|---|---|---|
| `easy` | 20 ticks | 30 ticks | 12 (3) | no |
| `normal` | 10 ticks | 15 ticks | 25 (5) | yes |
| `hard` (the name alone) | 5 ticks | 0 | 40 (8) | yes |

Two behaviors of the smart bots that do not depend on the level (#618; module docstring of `gow_bots.bots.smart`,
items 10 and 11): **a chosen plan gets its CP** (`wait_plan`: when the best attack is a scheduled order that the CP cannot
pay yet, the bot keeps its price for that many ticks and spends nothing non-urgent meanwhile; not on `easy`, which does not
plan ahead) and **a strike at a lesser city is answered** (`worth_defense`: with `respond` 1 the bot also switches to Defense
and reinforces an own city of at least that many VP; the reaction delay of the level applies). `0` switches either off:
`bot_factory("smart_rusher", {"wait_plan": ParamRange(0, 0)})`.

#624 adds (items 12-17 of the same docstring, `insight` levels only): a **converging strike** on the enemy capital
(several groups within 3 edges, timed to arrive together, planned where the shared utility says so; on top of the
single attacks, every personality but the bunker), **War while the warehouses are 9/10 full**, **one forward barracks
in the centre** (the large city between the capitals) and **the alarm on two enemy strikes at one node**. The worry about
a build-up next to the capital and the withdrawal of thin province garrisons are implemented with a switch each
(`SmartBot.WORRY`, `SmartBot.WITHDRAW`) and off: they measured worse ([log.md](log.md), #624).

**The benchmark `smart_hoarder`** (`gow_bots.bots.hoarder`, #624) plays the owner's winning plan of the playtest of
2026-10-30: claims in groups of 2+, a barracks in the centre, from tick 2400..3600 recruits first and an advance to the
largest city next to the enemy capital, then a converging strike with banked CP. It is a yardstick, not a server level:
put it in a tournament with `--bots "... smart_hoarder"`.

**Economy v2** (`mvp-3`, DEC-41, #648; `gow_bots.bots.economy`). Under `economy.model = "v2"` every bot sends no v1-only
command (stance, front markers, rear minimum, transfers, road upgrades, Defense: `Bot.allowed`) and the campaign and
smart bots play the v2 economy instead: **lines** from the own factories (only a factory starts a line, DEC-42) to the
nodes that want charges most (units without a charge, a building that owes charges, a front node with room, the hoard
of `smart_hoarder`), at most four per factory (`LINES_PER_FACTORY`, a bot choice: DEC-42 has no limit), and a line from
the capital into every built factory (a hub); **factories** (two beside the capital, one build at a time, the own city
nearest the enemy capital that no enemy node touches); **bunkers** for the personalities that used Defense (one, three
for `smart_turtle`; a front city with a full warehouse); **warehouse levels** in full supplying warehouses (charges, no
CP); a **planned order** only where its bonus turns a bounce into a capture, asking for the missing shots at most the
stock of its warehouse, released (`ReleasePlan`) when it gathered too long; the converging strike plans every group that
can gather a bonus. The CP keeps of the v1 personalities (`reserve`, `recruit_keep`) shrink to one and two orders: v2
has no Defense to keep CP for and doubles the CP income. Under v1 the play is unchanged (the same `state_hash` on
`mvp-2`).

## Bot characters (#663)

The smart personalities differ in the opening, the midgame and the late game, not only in the opening. The phase
is read from public data (`gow_bots.bots.estimate`): the **opening** while more than a tenth of the nodes is neutral,
the **midgame** after it, the **late game** in the last 6 VP awards (3 minutes). On a settled map every smart bot
estimates the enemy force from public data only (the symmetric start units of the map, as many recruits as it made
itself, since the CP income is flat and the same for both, minus the enemy losses of the visible fights), spreads the
part it does not see over the unseen enemy nodes, and ranks the enemy front sectors by their pressure (the shots in the
node plus half of its enemy neighbours'): the least pressed sector is the *weak spot*. The VP forecast of `assess.py`
(the VP now plus the VP of the cities owned now at every award left) decides "ahead" or "not ahead".

| Personality | Opening | Midgame (the territory split) | Late game |
|---|---|---|---|
| `smart_turtle` (Bunker) | claims its natural half (nodes no farther from its capital than from the enemy one), one ring more while CP burn; Economy | ahead on the forecast: holds, every front node keeps a garrison sized to the enemy shots that can reach it, the spare army stands in the most threatened front city, bunkers (v2) and Defense (v1), lost nodes of the half retaken first; not ahead: a slow advance, one enemy node next to the territory at a time, the weakest sector first | the same; not ahead, all in |
| `smart_expander` (Expander) | War, neutral cities weigh like enemy ones, a wide radius | pushes the weakest sector: the army rallies to the weak spot, targets score by how far below the mean pressure they are | ahead: secure margin; not ahead: all in |
| `smart_rusher` (Rusher) | War, enemy cities near the enemy capital first, small guard | concentrated breakthroughs: no attack on a garrisoned enemy node with fewer than 3 charged units, the army rallies to the weak spot nearest the enemy capital, converging strikes on the capital | as midgame; not ahead: all in |
| `smart_strangler` (Strangler) | Balance, cuts the enemy supply network | encircles: the most damaging cut first, every own neighbour of a target adds to it, cut-off cities are besieged | as midgame; not ahead: all in |
| `smart_reactive` (Counter) | Balance, answers every visible strike, Defense on the front | counterattacks: ahead on the forecast it attacks enemy nodes only within 30 s after an enemy attack on its territory (the neighbours of the attacked node first, their garrisons left); not ahead, it attacks without waiting | as midgame; not ahead: all in |
| `smart_hoarder` (benchmark) | War, claims in groups of 2+, the centre barracks | from tick 2400..3600 the build-up at the centre, then the stage next to the enemy capital, the converging strike | not ahead: the strike goes without waiting for the build-up |

Every smart bot on a settled map also sends the spare units of its capital toward its objective (a pile at home earns
no VP), except the benchmark, whose build-up does that itself. The tempo levels (`easy`, `normal`, `hard`) keep their
meaning: an `easy` bot reads the phase and the sectors too, but thinks, reacts and acts at its tempo and has no
`insight` (section "Difficulty levels and tempo").

## Budget

AGENTS.md, section 12: 1000 matches on 8 cores of the reference machine in no more than 20 minutes. A match
of `mvp-0` with the bots from BOT-01 takes about 1.3 seconds of one core; the measurement of a full tournament: `docs/perf.md`.
