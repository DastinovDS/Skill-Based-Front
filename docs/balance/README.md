# Balance: the bot tournament and the result format

The tournament (BOT-04, #37) runs bots against each other on maps and writes one JSONL line per match.
The report on this file is built by `gow-bots report` (BOT-05, #38); this document describes the format
the report relies on.

> Map ids were renamed to English in #390 (`arteriya` is `artery`, `pautina` is `web`, `pereval` is `pass`, `hrebet` is `ridge`, `perekrestki` is `crossroads`, `trakt` is `highway`); the tournament results and reports in this folder keep the old ids on purpose, they are history and are not rewritten.

## Running

```bash
uv run gow-bots tournament --maps maps/*.json --bots all --seeds 100 --jobs 8 --ruleset rulesets/mvp-4.toml
```

`mvp-4` is the played ruleset (owner decision 2026-11-04, #741); the tasks `tournament`, `search` and `tournament:gh` default to it. The older runs below (`mvp-2`, `mvp-3`) are history and are reproduced with `--ruleset rulesets/mvp-2.toml` and the like.

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
mise run tournament:gh --ref feature/123-x --ruleset rulesets/mvp-4.toml --bots "rusher smart_rusher@normal" --seeds 20
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

**Agents run tournaments only here**; a local run of at most 3 seeds only when GitHub is unavailable. When to run one: after a rules change no tournament gates the merge: the required CI is the gate (golden replays, determinism and property tests, `py-slow` catch crashes). While the owner is still iterating the mechanics through playtests, tournaments are skipped. Once the owner declares the mechanics settled: one batched smoke `mise run tournament:gh --seeds 3` (crashes and gross imbalance), then the field run of 16 bots x 20 seeds (`tournament:gh`) for the ruleset numbers. Tournaments run on GitHub runners (`tournament:gh`), not on the owner's laptop; a local `mise run tournament -- --seeds 3` (at most 3 seeds) only when GitHub is unavailable (owner decision 2026-11-03).

Matches: `maps x bots x bots x seeds`. Every **ordered** pair `(the bot of side 0, the bot of
side 1)` plays: each pair meets from both sides, each bot also plays itself (this gives an
estimate of the skew between the sides of a map). The match seed is shared by both bots; the bot's parameters are chosen from
`(name, seed, side)` (AGENTS.md, section 8).

Matches run on worker processes (`ProcessPoolExecutor`, the `spawn` start); a worker plays match after match (#787:
no module state survives a match, a match plays the same in a fresh and in a used worker). The order of
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

Stances of economy v2 (DEC-44, `mvp-4-stances`): the table of a match on such a ruleset adds, per player, the stance timeline,
`stance switches`, `share of time in <stance>`, `CP earned in <stance>`, `charges in <stance> (capital / built)` and the row
`SetStance (accepted)`. Every match under economy v2 has the rows `charges from the capital` and `charges from built factories`.
The JSONL of `gow-bots analyze` has the same numbers under `stats` and the flag `stats.stances` (section "Player statistics").

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
| `charges_tolls`, `tolls_paid`, `forts_built` | [int, int] | road fortifications (DEC-43, item D, #707): the charges the player's groups lost to tolls (`toll_paid`), the number of those tolls, the player's fortifications that started to work (`road_fort_built`); 0 without `[fort]` |
| `charges_residual` | [int, int] | `charges_start + charges_produced` minus all sinks (`charges_burned`, the six above and the two v2 sinks) minus `charges_end`; 0 when every charge is explained by an event (#588) |
| `charges_sent`, `charges_delivered`, `charges_delivered_front`, `charges_transfers` | [int, int] | the supply flow (#588): charges in dispatched packets, in all delivered packets (one-off transfers included), of them delivered into a city with a front marker, sent by transfers |
| `stock_by_place_minute` | [{place: [int or null, ...]}, ...] | the stock by place and match minute in hundredths of a charge (#588); places `cap_wh`, `front_wh`, `rear_wh`, `units_node`, `units_road`, `packets`; `null`: no sample in that minute |
| `marker_ticks`, `front_empty_ticks`, `front_empty_cap_has_ticks`, `cap_full_ticks` | [int, int] | the supply bottleneck in ticks (#588) |
| `front_empty_permille`, `front_empty_cap_has_permille` | [int or null, ...] | the second and the third over `marker_ticks`, per mille, rounded down; `null` without marker ticks (#588) |
| `cp_burned` | [int, int] | CP lost to the CP cap, in hundredths like `cp`: the sum of `cp` of the player's `cp_burned` events, the quantum that did not fit under `cp.cap` (and the rare overflow of a `CancelRecruit` refund). Divide by 100 for CP (#743, section "CP burned and idle discharged units") |
| `cp_cap_ticks` | [int, int] | ticks `1..ticks` that ended with the player's CP at `cp.cap` (#743) |
| `idle_discharged_connected`, `idle_discharged_pocket` | [int, int] | idle discharged unit-ticks (#743): units without a charge standing in an own node with an empty warehouse, in no fight and with no order, summed over ticks; the first in the component of the own capital, the second in a pocket (DEC-43, item H) |
| `usage` | [{str: int}, {str: int}] | accepted commands of each player per mechanic (#166): the command class name (`Move`, `CancelOrder`, `Split`, `Merge`, `SetMode`, `SetStance`, `Recruit`, `CancelRecruit`, `BuildBarracks`, `UpgradeWarehouse`, `UpgradeRoad`, `SetFront`, `SetRearMin`, `Transfer`, and the economy v2 commands `DrawLine`, `RemoveLine`, `BuildFactory`, `BuildBunker`, `ReleasePlan`, #648), a planned `Move` as `MovePlanned`; `Forfeit` is not counted. The report shows it as the section "Mechanic usage" |

The fields `stock_*`, `charges_*` and `burned_permille` were added in #310 without changing `schema`: nothing was removed and
nothing changed meaning. Tournament files older than #310 do not contain them, the report shows "no data" for them.
`usage` was added in #166 the same way; older files show n/a in its section.
`siege_orders`, `planned_siege_orders` and `planned_siege_share` were added in #590 the same way (no field changed
meaning); the report shows the gate share as n/a for older files, next to the share over all attacks. The charge ledger, flow, stock by place and
bottleneck fields (#588) were added the same way (only additions, `schema` stays 1); the report shows n/a for older files.
`cp_burned`, `cp_cap_ticks`, `idle_discharged_connected` and `idle_discharged_pocket` (#743) are additions too, and so
are the fields of #690 (section "Efficiency and contact"): `economy_model`, `supply_model`, `first_contact_tick`,
`siege_fights`, `siege_walk_ins`, `contested_sieges`, `contested_sieges_won`, `units_killed`, `charges_per_kill_centi`,
`charges_built_lost`, `cp_cancelled`. The report reads every one of them as optional: a file without them shows n/a in
their cells and the economy is inferred from the mechanics used.

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
| `stance_share` | `stance_ticks` as a share of `ticks`, 4 digits; `null` at `ticks = 0` |
| `stance_switches` | accepted stance changes in the match |
| `cp_by_stance` | CP in hundredths earned under each stance: the quantum minus what burned at the cap; only with `[stances]` (DEC-44), 0 otherwise. `MatchRecorder` reads a quantum from `cp_ticks`, which ends a tick at 0 only when the quantum fired |
| `charges_by_stance` | `{stance: [capital, built]}`: the charges made in each stance by the own capital and by every other factory (a captured capital too), `charges_produced` and `charge_burned` of a factory counted, like `charges_produced` of the metrics |
| `charges_capital`, `charges_built` | the sums of `charges_by_stance` over the stances; together they equal `charges_produced` of the metrics under economy v2 |
| `commands` | all the commands the player sent, except `Forfeit`; `rejected` of them were rejected (`Forfeit` is counted in `MatchMetrics.rejected`) |
| `apm_avg` | `commands * 60 * tick_hz / ticks`, 3 digits; `null` at `ticks = 0` |
| `apm_by_minute`, `apm_peak` | commands by match minute (minute `m`: ticks `m*60*tick_hz < t <= (m+1)*60*tick_hz`, the last minute may be shorter) and the maximum of them |
| `supply` | ticks of the accepted `SetFront` (`set_front`), `SetRearMin` (`set_rear_min`), `Transfer` (`transfer`); `transfer_charges`: the sum of charges from `transfer_started` (a shipment is cut by the free space of the target, so it can be less than the command's `n`) |
| `orders`, `planned_orders` | accepted `Move` and of them the scheduled ones |
| `planned_share` | `planned_orders / orders`, 4 digits; `null` without orders |
| `planned_attack_share`, `planned_siege_share` | as in `MatchMetrics` (#590: the second one is the gate share) |
| `cp_by_category` | CP spending in hundredths by accepted commands and the prices `orders.cost` of the ruleset: `move`, `planned_move`, `mode` (`SetMode`), `recruit` (recruiting minus the `CancelRecruit` refunds), `road` (`UpgradeRoad`), `barracks`, `warehouse`, `transfer`, `fort` (`FortifyRoad`, DEC-43 item D), `other` (`Split`, `Merge`, `CancelOrder`, `SetStance`, `SetFront`, `SetRearMin`: free in the MVP rulesets) |
| `cp_refunded`, `cp_total` | the refund for cancelling a recruit (already subtracted from `recruit`) and the sum of the categories |

A rejected command costs nothing. The real CP balance (regeneration, burning at the cap) is not
reconstructed: these are spendings by commands. The decisions on the disputed points were made by default
(a comment in #375): net spending with refunds, `Forfeit` outside APM, an offline tool without
display in the game and without a server API.

`gow-bots analyze` also writes `usage` (the accepted commands per mechanic, as in a tournament row) and the fields of
#690, so a human's mechanic usage is readable from a replay. The table of `gow-bots stats` follows the economy of the
match (#690): its title line names the economy, the supply model and the first contact tick; under economy v2 it
leaves out the rows of the v1 mechanics that v2 rejects (the stance timeline and ticks, `SetFront`, `SetRearMin`,
`Transfer`, CP `road` and `transfer`, the front-marker columns and `mean stock front_wh`) and adds the v2 sinks
(`charges into buildings`, `charges into buildings lost`, `charges into plans`, `charges to road tolls`), the tolls
paid and taken and the road forts built; a row per mechanic the economy and the supply model accept
(`<command> (accepted)`, `gow_bots.tournament.live_keys`: no `DrawLine` under the flow, no `SetLeafShift` under the
lines); and for every economy the efficiency rows (enemy units killed, charges per kill, siege fights and walk-ins,
contested sieges, CP of cancelled moves, CP burned, ticks at the CP cap, idle discharged units).

## Efficiency and contact (#690)

Per-player metrics of how well a player spent what it had, and one per-match metric of tempo. Not game rules: no event
or field was added to the simulation, `SIM_VERSION` and the golden replays are untouched (`gow_sim.analysis`, module
docstring "Efficiency and contact"). All values are integers.

| Field | Meaning |
|---|---|
| `economy_model`, `supply_model` | `economy.model` and `supply.model` of the ruleset; a reader hides the rows of the other economy by them |
| `first_contact_tick` | the earlier of the first `fight_started` (in a node or on an edge) and the first capture of a node the other player owned; `null` when the players never met (one value per match) |
| `siege_fights`, `siege_walk_ins` | the two parts of `sieges`: fights for an enemy node with the player as attacker, and walks into an enemy node without defenders |
| `contested_sieges`, `contested_sieges_won` | siege fights in which the defender spent a charge in a round (`spent_<defender>` of a `fight_round` above 0: a charged defender), and those of them that ended with the capture (`fight_ended` with `captured` and the attacker as winner) |
| `units_killed` | the enemy units the player's shots killed (`losses` of the other player in every `fight_round`) |
| `charges_per_kill_centi` | `charges_fights * 100 // units_killed`, hundredths rounded down; `null` without a kill |
| `charges_built_lost` | the charges of `build_paid` of a build later stopped (`build_stopped` of its node and kind) and of a finished building (`barracks_built`, `warehouse_upgraded`, `factory_built`, `fort_built`) in a node the other player later captured; a part of `charges_built` |
| `cp_cancelled` | CP in hundredths of the `Move` orders an accepted `CancelOrder` of the same group cancelled (the price of the group's last accepted `Move` while it still has an order at the end of a tick) |

Reading: "siege success" (captures of enemy nodes over siege attempts) is 0.9 and more for every bot because most
attempts are walk-ins; the contested sieges are the fights. `charges_built_lost` over `charges_built` is the share of the
building charges that never paid back; the report splits the whole ledger by the outcome of the match (section "Charge
sinks by outcome"). `first_contact_tick` measures the tempo of a map directly (the proposal of the map-economy notes of
2026-11-05).

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
charges_tolls + charges_end`, and
`charges_residual` is the difference (must be 0). Sources by event: `charges_fights` is the player's
`spent_<p>` of every `fight_round`, plus its `burned_<p>` under `combat.terrain_burn` (DEC-45); `charges_captures` is the number of `node_captured` times `capture.charge_cost`
(DEC-38); `charges_packets_lost` is `packet_lost`; `charges_warehouses_lost` is `warehouse_lost` (its `owner`);
`charges_starved` is `warehouse + units` of `starvation`; `charges_attrition` counts the `attrition` events that
killed a charged unit; under economy v2 `charges_built` is `warehouse + units` of `build_paid` and `charges_plans` counts
`plan_charged` (#646); `charges_tolls` is `charges` of `toll_paid` (DEC-43, item D6). `charges_start` and `charges_end` are the charge stock (section "Charge stock") before the first
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

## CP burned and idle discharged units (#743)

Two questions the charge ledger cannot answer: does a player have more command points than it spends, and do its
discharged units wait where no charge can reach them. Not a game rule: no event or field was added, `SIM_VERSION` and
the golden replays are untouched. `MatchRecorder` samples the end-of-tick state, `analyze` reads the `cp_burned` events
(`gow_sim.analysis`, module docstring "CP and idle units"). All values per player, integers.

- `cp_burned`: CP in hundredths that did not fit under `cp.cap`: the sum of `cp` of the player's `cp_burned` events (the
  regeneration quantum; the overflow of a `CancelRecruit` refund emits the same event and is counted too, it is rare and
  the log cannot tell it from a quantum burned in the same tick). A player that spends its CP as they come has 0.
- `cp_cap_ticks`: the ticks that ended with the CP at the cap; the next quantum burns completely. Over `ticks` it is the
  share of the match spent at the cap.
- `idle_discharged_connected` and `idle_discharged_pocket`, unit-ticks: in every tick, a group of the player that stands
  in a node (not on a road) the player owns, is in no fight and has no movement order (a waiting planned order is an
  order) adds `units - charged` when the node's warehouse is empty (nothing there can recharge it). The node is
  *connected* when it is joined to the player's capital over own nodes (`capacity.supplied_territory`), *pocket*
  otherwise (DEC-43, item H1; a player without its capital has only pockets, a factory in a pocket does not make the
  pocket connected). Groups in a node the player does not own are not counted. Divide by `tick_hz` (10) for
  unit-seconds.

Reading: the CP surplus question of #706 is answered by `cp_burned` and `cp_cap_ticks` of the bots that play at a human
tempo (`@normal`, `@hard`); a slow (`@easy`) or a plain bot sits at the cap by itself, so mixing them into one mean
reports a property of the field, not of the ruleset. `idle_discharged_pocket` over the sum of both is the share of the
idle stacks that the supply cannot reach. `gow-bots report` has the section "CP and idle units (#743)" (a table per
bot: means per player and match, the share of ticks at the cap, the share of matches that reached the cap, the pocket
share of the idle unit-ticks); `gow-bots analyze` prints the same keys.

## Report

```bash
uv run gow-bots report docs/balance/latest.jsonl            # writes latest.md and latest-*.png next to it
uv run gow-bots report run.jsonl --out-dir /tmp/rep --name run
```

The report (`gow_bots.report`, matplotlib only here) builds from a tournament file:
the economy of the file (from `economy_model`, or inferred from the mechanics used in an older file) and the
fair-field line (no bot played with an information grant: grants do not exist yet, #692), the data validity checks
(below), the bot competence checks (BOT-05, rewritten for the smart field: a personality's `@hard` bot stands in for the
old bot of that name, plus the exploiter gate of #688), the level ladder, every server level against the exploiter
(#688: the share with its Wilson interval and the capital lost and taken), the Bradley-Terry strength model, the matrix
of pairs with 95% Wilson intervals, the style matrix with its Nash mix, the side advantage (mirrored matches), the
metrics per bot (the share of scheduled attacks, the siege success, siege fights and walk-ins, contested sieges, the
captures in the last 3 minutes), the charge ledger and its split by outcome, the supply flow (DEC-43: leaf shifts,
road fortifications, tolls, starvation), CP and idle units, the mechanic usage, the strategy diversity (a dominant
strategy, "rock-paper-scissors" cycles), the number of unique outcomes, the breakdown by map and the seeds of the file.
Under economy v2 the v1-only columns (front markers, `front_wh`, the v1 commands in the usage table) are left out. The
output depends only on the lines of the file (the bootstrap draws from a fixed seed). A report of the 16-bot field of
20 seeds (20480 rows) takes about 10 seconds.

## Data validity

Reliability (does a number repeat on other seeds) and validity (does it say something about the rules, not the bot
code) are different questions. The section "Data validity" of the report answers the ones a tournament file can
answer (`gow_bots.validity`; the checklist of the data-quality notes of 2026-11-05). **The thresholds are proposals,
not owner decisions**: a FAIL says what the file cannot carry, not that a rule is wrong. A verdict about a rule number
names the field and the checks it passed.

| Id | Check | Computed from the file | Threshold (proposal) |
|---|---|---|---|
| V1 | skill floor | every `smart_*` bot head to head against `random_legal` and `idle` | each at least 0.95; NO DATA without the floor bots |
| V2 | level ladder | the head to head of `@hard`, `@normal`, `@easy` of every personality | hard over easy at least 0.60 with the Wilson lower bound above 0.5, normal over easy above 0.5, for every personality |
| V3 | tempo binding | the mean accepted commands per match of `@easy` and `@hard` of a personality | they differ by at least 15% |
| V4a | split-half reliability | Pearson's r of the bots' win rates against the others on the even and on the odd seeds (the pairs' r is printed too) | r at least 0.9 |
| V4b | pair precision | the median matches of an unordered pair, `1.96 * sqrt(0.25 / n)` | at most 0.05 (385 matches of the pair) |
| V4c | side bias | the side-0 share of the decided mirror matches per map, with the Wilson interval | 0.47..0.53 on every map |
| V5a | counter for every bot | the opponents whose share against the bot has a Wilson lower bound above 0.5 | every bot has at least one |
| V5b | no dominant bot | the win rate of every bot against the field | none above 0.65 |
| V6 | exploiter | every server level (`LEVEL_BOTS`) against `smart_exploiter` (#688), both sides, all maps, the share of the decided matches with its Wilson interval (the section "Against the exploiter" adds the capital losses) | `easy` at least 0.05, `normal` 0.20, `hard` 0.35, `expert` 0.50; a level not in the file is named and not judged; NO DATA without the exploiter |
| V7 | sensitivity | needs a second run with one rule number moved (NOT COMPUTABLE); prints the mechanics every bot uses less than 0.1 times per match: those are not judged by bots | |
| V8 | similarity to humans | needs the owner's replays (`gow-bots stats`; NOT COMPUTABLE) | a metric off by more than 2x is bots-only |
| V9 | rank stability across maps | Spearman's rho (ties get the mean rank) of the bots' win rates against the others for every two maps | at least 0.5 for every two maps, else decide per map |
| D1 | duplicate matches | rows with the same map, sides and seed | none |
| D2 | repeated games | rows whose final `state_hash` another seed of the same map and ordered pair already reached | at most 5% of the rows |

The **level ladder** section lists every pair of levels of every personality (a name without a level is `@hard`) and
the adjacent server levels (`easy` `smart_turtle@easy` < `normal` `smart_reactive@normal` < `hard`
`smart_strangler@hard` < `expert` `smart_expander@hard`, a copy of `gow_server.botmatch.LEVEL_BOTS` kept equal by a
test): the share of the higher level among the decided matches of the pair, both sides, all maps, with the Wilson
interval; *separated* when the interval excludes 0.5, *INVERTED* when it lies below. Next to it the accepted commands
per match by level (V3).

The **Bradley-Terry** section fits `P(side 0 wins) = sigmoid(s[bot0] - s[bot1] + h[map])` on the decided matches by
Newton's method with a ridge of 0.01 on every parameter (it keeps a bot that never lost finite and makes
`sum(s) = 0`): `s` is a bot's strength in log-odds, separated from the side and the map; `h` the side-0 advantage of a
map. The 95% intervals are the percentiles of 200 refits on the seeds drawn with replacement (`random.Random(0)`: the
same file gives the same text).

The **style matrix** is `A[i][j]` = (wins of i + half the draws) / matches of i against j, minus 0.5, both sides and all
maps. Its transitive part is `r[i] - r[j]` with `r[i]` the mean of row `i` (the least-squares fit of a single
strength); the **intransitive share** is the sum of squares of the rest over that of `A` (0: one ladder explains every
pair; 1: pure rock-paper-scissors; the combinatorial Hodge split of Balduzzi et al., 2018). The **Nash mix** is the
symmetric equilibrium of the zero-sum game `A` (20000 rounds of multiplicative weights, the mean of the played mixes);
its `gap` is the best pure answer to the mix, 0 at an exact equilibrium. A bot outside the mix is not needed against
this field; a mix of one bot means that bot has no answer in the field (read it with V5a).

## Seeds

The 95% half-width of a share near 0.5 is about `1.96 * sqrt(0.25 / n)`. Every ordered pair plays every seed on every
map, so the matches of one claim are:

| Claim | `n` at 3 seeds | at 20 seeds | at 50 seeds | Half-width at 20 seeds | What it answers |
|---|---|---|---|---|---|
| one ordered pair on one map | 3 | 20 | 50 | 0.22 | nothing alone; a crash or a frozen match |
| one pair, both sides, 4 maps | 24 | 160 | 400 | 0.08 | a pair or a ladder step only at 50 seeds (+-0.05) |
| one bot against a 16-bot field, 4 maps | 360 | 2400 | 6000 | 0.02 | a bot's standing in the field, the level order |
| one map's side skew, mirror matches of 16 bots | 48 | 320 | 800 | 0.055 | a skew of the map larger than about 0.05 |

The 3-seed smoke run answers "a crash or a gross imbalance"; the 16-bot field at 20 seeds answers a bot's standing and
the side skew of a map; a claim about one pair (a ladder step, the exploiter gate) needs about 400 matches of that pair
(50 seeds on the 4 pool maps). The report prints the same numbers for the file it reads (section "Seeds").

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
and `insight` (the position thresholds, the DEC-37 pin, the evacuation of doomed cities, the scouts). `apm_avg` and
`apm_by_minute` of `gow-bots stats` measure the result on replays.

| Level | think | react | APM (burst) | insight |
|---|---|---|---|---|
| `easy` | 20 ticks | 30 ticks | 6 (3) | yes |
| `normal` | 10 ticks | 15 ticks | 7 (4) | yes |
| `hard` (the name alone) | 5 ticks | 0 | 40 (8) | yes |

**Why the APM is the lever (#749).** Under `mvp-4` the CP income (about 93 CP a match) binds every smart bot: they
spend 98% of it and send 118 to 136 commands a match whatever the level, so the think and reaction delays and an
APM above that demand change almost nothing (the levels of #573, 12 / 25 / 40 APM, were flat in the field run of
#706: every level about 136 commands for the expander, `smart_reactive` and `smart_strangler` `easy` over `normal`
0.61). The old `easy` differed by `insight` only, and `insight` is no strength: without it a bot at the `hard` tempo
plays even with `hard`. An APM bucket below the demand binds: a bot at 8 a minute still plays even with `hard`, at 7
it wins about 0.4, at 6 almost never. So `hard` keeps the unlimited play and `normal` and `easy` sit below the
demand; the owner played match 6 (`mvp-3`) at 8.5 commands a minute. The numbers and the validation run: #749.

Two behaviors of the smart bots that do not depend on the level (#618; module docstring of `gow_bots.bots.smart`,
items 10 and 11): **a chosen plan gets its CP** (`wait_plan`: when the best attack is a scheduled order that the CP cannot
pay yet, the bot keeps its price for that many ticks and spends nothing non-urgent meanwhile; not without `insight`) and **a strike at a lesser city is answered** (`worth_defense`: with `respond` 1
the bot also switches to Defense
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

**The benchmark `smart_exploiter`** (`gow_bots.bots.exploiter`, #688) plays the holes the bot audit of 2026-11 found in
the field under `mvp-4`: the rusher's CP economy (every CP on a capture) with a **capital drive** (a group of 4 charged
units or more scores per hop it gets closer to the enemy capital), a **converging strike whenever it is ready** (one
group alone too, 2 shots above the estimate, scheduled orders where they can gather a bonus), **raids on enemy
pockets** (an enemy node cut from the enemy capital over enemy nodes, public ownership: a score bonus, and the estimate
of its garrison loses what the starvation of DEC-43 item H took since the cut), **raids on full leaf warehouses** (an
enemy node held 300 ticks counts with a full warehouse, every charge scores), the cut of enemy nodes (`w_cut`), the
**leaf shift at the front while a strike is under way**, and the capital defense and threat fortifications of item 22.
The parameter `anti_rush` (0 by default) switches on an anti-rush opening: the capital keeps 3 units, its roads from the
enemy side are fortified before an enemy is seen, and a city facing an enemy node fortifies the road from it at once.
It is a yardstick and the regression gate V6, not a server level (`LEVEL_BOTS` does not name it): put it in a
tournament with `--bots "... smart_exploiter"`.

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
| `smart_exploiter` (benchmark) | the rusher's opening, the cuts of the enemy network | the capital drive of the big groups, raids on enemy pockets and full leaf warehouses, the strike whenever ready, the leaf shift at the front during a strike | as midgame; not ahead: all in |

Every smart bot on a settled map also sends the spare units of its capital toward its objective (a pile at home earns
no VP), except the benchmark, whose build-up does that itself. The tempo levels (`easy`, `normal`, `hard`) keep their
meaning: an `easy` bot reads the phase and the sectors too, but thinks, reacts and acts at its tempo (section
"Difficulty levels and tempo").

## Scenario tests from a lost match (#691)

A tournament between bots never reaches the positions in which an owner's match was lost, so a
regression of their fixes needs a pinned position: `apps/bots/tests/test_scenarios_mvp4.py`. To turn a
lost match into such a test:

1. Find the tick. Re-simulate the replay (or a bot match, `run_headless` with an observer) and look at
   `match.view(player)` around the failure: the owners of the nodes, the groups and where they stand.
2. Write the position as a table in the frame of the bot (its capital is node 0), the way
   `_scenario(player, own, foe, groups, tick=..., cp=...)` takes it: nodes of the bot, nodes of the
   enemy, groups `(side, node, units, charged)`. The same table is played for player 1 on the mirror
   nodes (`MapDef.node_key`), so every case is also a mirror check.
3. Take the expected values from the rules (`mechanics.md`, the DEC table of the item), never from what
   the bot does now: assert on the bot's commands for the view (`bot.decide(view, tick)`), or play a
   few hundred ticks with `_play` (the bot decides every 5 ticks, the enemy stands still) and assert on
   the state, the rejected commands and the attrition.
4. Check that the test fails on the bot code from before the fix (export `apps/bots/src` of that
   commit into a scratch directory and run pytest with `PYTHONPATH` pointing at it). A gap the test
   finds and nobody fixes yet is `xfail(strict=False)` with the reason, and goes into the PR description.

## Budget

AGENTS.md, section 12: 1000 matches on 8 cores of the reference machine in no more than 20 minutes. A match
of `mvp-0` with the bots from BOT-01 takes about 1.3 seconds of one core; the measurement of a full tournament: `docs/perf.md`.
