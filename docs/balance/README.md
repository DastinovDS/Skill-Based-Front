# Balance: the bot tournament and the result format

The tournament (BOT-04, #37) runs bots against each other on maps and writes one JSONL line per match.
The report on this file is built by `gow-bots report` (BOT-05, #38); this document describes the format
the report relies on.

> Map ids were renamed to English in #390 (`arteriya` is `artery`, `pautina` is `web`, `pereval` is `pass`, `hrebet` is `ridge`, `perekrestki` is `crossroads`, `trakt` is `highway`); the tournament results and reports in this folder keep the old ids on purpose, they are history and are not rewritten.

## Running

```bash
uv run gow-bots tournament --maps maps/*.json --bots all --seeds 100 --jobs 8 --ruleset rulesets/mvp-1.toml
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
| `planned_attack_share` | [float or null, ...] | `planned_attack_orders / attack_orders`, 4 digits; `null` without attacks |
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
| `usage` | [{str: int}, {str: int}] | accepted commands of each player per mechanic (#166): the command class name (`Move`, `CancelOrder`, `Split`, `Merge`, `SetMode`, `SetStance`, `Recruit`, `CancelRecruit`, `BuildBarracks`, `UpgradeWarehouse`, `UpgradeRoad`, `SetFront`, `SetRearMin`, `Transfer`), a planned `Move` as `MovePlanned`; `Forfeit` is not counted. The report shows it as the section "Mechanic usage" |

The fields `stock_*`, `charges_*` and `burned_permille` were added in #310 without changing `schema`: nothing was removed and
nothing changed meaning. Tournament files older than #310 do not contain them, the report shows "no data" for them.
`usage` was added in #166 the same way; older files show n/a in its section.

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
| `planned_attack_share` | as in `MatchMetrics` |
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

The BAL-01 run (#39) is committed: `latest.jsonl` (the 3 MVP maps, now fixtures in `maps/fixtures/` since #372, 5 strategic bots without `idle` and
`random_legal`, 100 seeds, 7500 matches, `mvp-0`) and `latest.md`, `latest-*.png` built from it.
The verdict by the gate criteria and the hypotheses for the iterations of BAL-02 (#40): [log.md](log.md).

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

## Budget

AGENTS.md, section 12: 1000 matches on 8 cores of the reference machine in no more than 20 minutes. A match
of `mvp-0` with the bots from BOT-01 takes about 1.3 seconds of one core; the measurement of a full tournament: `docs/perf.md`.
