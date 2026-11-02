# Bot audit 2026-11: the smart bots under economy v2, the balance metrics, information grants

Owner's question (2026-11-02): a human beats the `expert` bot without much effort, so the bot lacks something; should the
higher levels be allowed to cheat a little (more and more accurate information); and are the existing metrics telling
us the truth. This document is the audit and the plan. It changes no code; the issues it files are listed in section 5,
the design proposal for information grants is ADR 0002 (`docs/adr/0002-bot-information-grants.md`, proposed, awaiting
the owner's decision, #692).

State audited: `develop` b0dc3af, `SIM_VERSION` 31, the played ruleset `rulesets/mvp-3.toml` (economy v2, DEC-41 and
DEC-42, the `balanced` numbers of #659), the bots of `apps/bots/src/gow_bots/bots/` (`smart.py`, `campaign.py`,
`economy.py`, `base.py`, `tempo.py`, `estimate.py`, `assess.py`, `hoarder.py`), the harness (`tournament.py`,
`report.py`, `stats.py`, `search.py`), `gow_sim.analysis` through its outputs.

## 0. Summary

1. The `expert` level loses to a human for reasons the bot-vs-bot tournaments cannot see. In the owner's match 6
   (`narrows`, `smart_expander@hard`, lost by the capital at tick 4648) the bot put 42 of its 84 charges into buildings
   and plans (18 into fights), left 11 discharged units idle for 850 ticks in a pocket cut from every factory, and met a
   visible two-plan push of 10 units on its capital with 6 defenders, 1 CP and no bunker. Every one of these is a v2
   gap in the bot, not a rules problem: the capital defense and the evacuation are still the v1 mechanisms (Defense,
   Transfer) that v2 rejects, so they silently do nothing.
2. The same bot wins 9 of 12 against `smart_hoarder` and `smart_rusher@hard` on the same map (3-seed smoke run below)
   and scored 0.81 against the 16-bot field (#663). The field shares the blind spots: no bot hoards, raids a cut-off
   stack or pushes a capital with 10 units, so the metrics are green. Worse, the one answer that would have helped
   (item 13, "worry about a build-up next to the capital") was switched off in #624 because it lost win rate against
   the bots. Tuning against the field removed a human-relevant defense.
3. The metrics are sound as statistics (Wilson intervals, mirror sides, a balanced ledger) and weak as a signal about
   humans: win rate measures strength within a field, the win-rate spread mixes rules with bot quality, "siege
   success" of 0.91-0.98 counts walks into empty nodes, the gate share of planned sieges tripled from a bot policy
   change (#618) with no change in win rates, and `stats` still prints the v1 rows under v2 while the v2 sinks
   (`charges_built`, lines, factories) have no row. What is missing is a yardstick that plays like the owner and
   metrics that count idle units, charges sunk into lost buildings and contested fights.
4. Information grants can make a level harder, but only after the fair fixes: an omniscient bot that spends half its
   charges on buildings it then loses still loses. The recommended design keeps the boundary: a `Grant` applied inside
   `project()` for a designated server level, bots keep reading only a `PlayerView`, balance tournaments stay fair by
   default and say so. Decision: #692.
5. Plan: metrics and the exploiter benchmark first (so every later PR is measured against the right opponent), then
   the five fair bot fixes that need no rule decision, then the parts that wait for the owner's pending decisions
   (warehouse upgrades, CP costs of buildings, the supply distribution), then the re-tune and the ladder, and the
   grant level last.

## 1. Evidence and how it was produced

| Source | How |
|---|---|
| Owner's match 6 | `6.jsonl.gz` of the owner's server (`narrows`, `mvp-3` hash `0efed0c3`, `SIM_VERSION` 31, side 0 `smart_expander@hard`, side 1 the owner), re-simulated: `mise exec -- uv run gow-bots stats 6.jsonl.gz --rulesets rulesets/archive --maps maps` and `gow-bots analyze` (the same arguments); the per-tick diagnosis of the earlier session (`bot-expander-replay6.md`, an observer over `gow_sim.replay.replay_match`) for the timeline |
| Smoke run | `mise run tournament -- --maps maps/narrows.json --bots smart_expander@hard smart_hoarder smart_rusher@hard --seeds 3 --jobs 4 --ruleset rulesets/mvp-3.toml --out <scratch>/t3.jsonl --replays <scratch>/rep` (27 matches, 109 s on 4 processes; a smoke run answers "crash or gross imbalance" only: 6 matches per ordered pair give a Wilson half-width of about 0.40) |
| Tournament history | `docs/balance/log.md` (#574, #618, #624, #648, #663, #659, #671, #674), `latest.md` (the `mvp-2` confirming run), `v2-params-2026-10.md` |
| Code | the files listed above, read in full; every claim about a function names it |

### Match 6 in numbers (`gow-bots stats` and `analyze`)

| | bot (side 0) | owner (side 1) |
|---|---|---|
| commands (rejected), APM avg / peak | 112 (0), 14.5 / 23 | 66 (4), 8.5 / 12 |
| CP spent: move / planned / recruit (total) | 36 / 2 / 10.5 (48.5) | 32 / 6 / 8 (46) |
| charges: start + produced | 18 + 66 | 18 + 57 |
| into buildings (`charges_built`) / into plans | 38 / 4 | 0 / 12 |
| spent in fights / lost with warehouses / died with units | 18 / 11 / 4 | 20 / 3 / 0 |
| lost in packets / burned / left at the end | 4 / 1 / 4 | 0 / 9 / 31 |
| moves, of them cancelled (`CancelOrder`) | 36, 9 | 32, 3 |
| captures / sieges won of attempts / siege orders (planned) | 14 / 4 of 5 / 7 (2) | 21 / 15 of 17 / 10 (6) |
| planned siege share (the #590 gate) | 0.29 | 0.60 |
| mean stock in units at nodes / in warehouses | 8.0 / 7.2 | 12.1 / 12.3 |
| cities at the end, VP | 4, 161 | 22, 248 |

The `hard` tempo (40 APM, no reaction delay) was never the limit: the bot used 14.5 APM and had 0 rejected commands. CP
was the limit for both sides (1 CP per 100 ticks). The difference is where the charges and the CP went.

### Smoke run (narrows, 3 seeds, 27 matches), mean per player and match

| bot | wins (of 12 against others) | capital lost | `charges_built` | plans | fights | warehouses lost | produced | `UpgradeWarehouse` | `DrawLine` / `RemoveLine` | `CancelOrder` of moves | attrition |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `smart_expander@hard` | 9 | 1 | 49.9 | 2.3 | 16.3 | 14.9 | 115.8 | 14.2 | 39.0 / 14.6 | 9.4 of 61.6 | 4.2 |
| `smart_rusher@hard` | 7 | 3 | 41.3 | 3.1 | 16.6 | 19.5 | 105.0 | 14.1 | 45.3 / 21.8 | 6.1 of 62.2 | 0.4 |
| `smart_hoarder` | 2 | 1 | 44.2 | 5.8 | 20.5 | 22.8 | 115.2 | 13.8 | 39.7 / 9.8 | 6.9 of 61.8 | 1.2 |

Every bot sinks a third of its charges (start plus production) into buildings and loses another sixth with captured
warehouses; fights get an eighth. The pattern of match 6 is the normal play of every smart bot under `mvp-3`, and the
benchmark of the owner's v1 plan (`smart_hoarder`, #624) is now the weakest of the three: it no longer models the owner.

## 2. Bot audit

### 2.1 What every smart bot still assumes from v1

`SmartBot._decide` runs the v1 and the v2 branches side by side (`smart.py`, `_decide`). The v1-only commands are
filtered at the last moment by `Bot.allowed` (`base.py`: `V1_ONLY`, and `SetMode(DEFENSE)`), which makes `spend`
return `False` without a trace. The decisions that still rest on them under v2:

| Function (`smart.py`) | v1 mechanism | Under v2 | Cost |
|---|---|---|---|
| `defend_capital`, `defend` | `SetMode(DEFENSE)` on the strongest capital group | dropped silently; what is left: a 1-CP recruit and the walk home of *charged* groups | the capital falls to a visible push (match 6) |
| `respond`, `reinforce` | Defense at the struck city plus one group | only the reinforcement | a planned strike at a city is answered by one group |
| `fortify` | Defense on every hot node | no-op (the bunker budget `BUNKERS` replaces it, 1 for the expander and the reactive, 4 for the turtle, 0 for the rusher and the strangler) | front garrisons have no bonus; `bunker_site` ranks by VP, the capital gets none while a front city has a full warehouse |
| `evacuate` | `Transfer` of a doomed city's stock | the `CancelRecruit` part works, the transfer is dropped | 11 charges lost with warehouses in match 6, 15-23 per match in the smoke run |
| `wanted_stance`, `_set_stance`, `build_roads`, `set_rear_min`, `feed`, `fronts` | stances, roads, markers, transfers | correctly skipped by `rules.v2` branches | none, but the personalities' `STANCE`, `LATE_STANCE`, `late`, `road_keep`, `rear_full` and the "tuned by search" comments are dead under v2 |
| `adjusted` | `reserve`, `recruit_keep` | cut to one and two orders ("v2 doubles the CP income"); `mvp-3` since #659 has 1 CP per 100 ticks, the same as v1 Balance | the bot is at 1 CP when the push comes |
| `Bot.defended` | the enemy's Defense intent | the enemy bunker when visible (DEC-31): correct | none |
| `CampaignBot.estimate` | an unseen enemy node holds at least 2/2 | unchanged | a discharged group never "takes" an empty node, `_rally` skips discharged groups: the pocket of match 6 |
| `hidden_shots` (item 13) | enemy CP bound by stance shares | the bound still counts the v1 stance split (`EnemyCp` uses the largest share of a quantum); under v2 the whole quantum is CP | the bound is low by up to 40%; moot while `WORRY` is off |

### 2.2 The gaps, ranked by what they cost against a human

| # | Gap | Evidence | Root in code | Issue |
|---|---|---|---|---|
| G1 | **Charges sunk into buildings that are lost or never finished.** A third of all charges; the two finished factories of match 6 were captured and produced for the owner | match 6: 38 built of 84, `factory_built` at 160 and 3171, `build_stopped` at 978 and 2111 after 3 of 4 charges paid; smoke: `charges_built` 41-50, `UpgradeWarehouse` 14 per match | `economy.factory_site` takes the own city nearest the enemy capital (the next front) and does not check the warehouse holds the cost, so `systems.build.pay` takes the garrison's charges (tick 166: two front units discharged for 750 ticks); `FACTORIES = 2` restarts after every interruption; `Bot.development` upgrades every full warehouse with units | #683 |
| G2 | **No capital defense under v2.** | match 6: two public plans on the capital from tick 4270, 10 attackers against about 6 defenders, bot at 1 CP, no bunker, one recruit; `capital` losses in 5 of 27 smoke matches | 2.1 above; `bunker_site` ranks by VP (the capital's 3 equals a large city's); `adjusted` cuts the reserve; `WORRY` off | #682 |
| G3 | **No notion of an unsupplied pocket.** Under v2 a unit recharges only from its node's warehouse, filled only by a line over own nodes from an own factory | match 6: 11 units with 0 charges idle in node 14 from 3800 to 4648 after the line was cut at 3580; two 3-unit raids had burned the stack's 10 charges | `answer_worry`, `defend_capital`, `reinforce`, `_rally` skip `charged == 0`; `options` needs `takes()` against an estimate of at least 2/2; nothing walks a discharged group to a stocked warehouse; `wants` and `_way` cannot reach a pocket | #684 |
| G4 | **Thin, diluted supply and thin fronts.** Lines split a factory's output by round robin; the expander spreads single units | match 6: 9 lines from the capital (1 charge per 100 ticks) and 5 from the second factory, 15 `line_auto` events, single discharged units on nodes 6, 9, 12; the owner took 10 empty bot nodes without a fight; smoke: 39-45 `DrawLine` per match | `LINES_PER_FACTORY = 4` per factory plus hub feeds plus the sim's auto-extension (no bot sends `SetAutoLines`); `hold_front` 0..1 for the expander | #685, #689 |
| G5 | **CP wasted on cancels and spent the tick it arrives.** | match 6: 9 of 36 moves cancelled (25% of the CP of the match); CP at 1.0 all match against the owner's bank of 5 and four recruits in a row; smoke: 6-9 cancels per 62 moves | `_recall` cancels on same-tick numbers; `_attack` scores without the chance that the target flips before arrival; `adjusted` leaves no keep | #687 |
| G6 | **Attrition from over-capacity merges.** | match 6: 4 units lost in node 14 (capacity 8, stack of 10); smoke: 4.2 charges per match for the expander | `_recall` returns a group into a full node; `_rally`, `converge`, `reinforce` do not count the destination's room | #686 |
| G7 | **The personalities are v1 tunings.** | `smart.py` comments "Tuned by `gow-bots search` against smart_rusher and rusher (#166, PR 3)" on `mvp-1`; a third of `PARAMS` is dead under v2 | dead keys listed in 2.1; `MID_GROUP`, `W_WEAK`, `MID_GOAL` of #663 are the only v2-era logic | #689 |
| G8 | **The yardstick is wrong.** `smart_hoarder` plays the owner's v1 plan (barracks in the centre, build-up from tick 2400) | smoke: 2 of 12; #663: 0.65 against the field, below every `hard` bot | the owner's v2 play is different (2.4) | #688 |
| G9 | **Raid exposure.** A charged stack at the front is a charge bank the enemy empties with 3-unit raids 1:1 (DEC-32, one shot a round) and the stack cannot refill faster than its line delivers | match 6: fights 129 and 141, 12 bot shots against 8 of the owner, then the stack was dead weight | no logic keeps a stack within what its line can recharge, or pulls it one hop back to a second warehouse | #684 (part), rules question in 6 |

### 2.3 By personality and level

The five personalities share `SmartBot`; what differs is the thresholds. Under `mvp-3`:

| Personality (server level) | What its character means under v2 | v2-specific weakness |
|---|---|---|
| `smart_expander@hard` (`expert`) | wide radius (4-5), `w_neutral` high, `MID_GOAL` to the weakest sector, `W_WEAK` 40; `hold_front` 0..1, `BUNKERS` 1 | the widest spread of single units and the most buildings (G1, G4); the owner's sweeps of empty nodes cost it 10 nodes |
| `smart_rusher@hard` | `MID_GROUP` 3 (no single units into garrisons), strikes, `guard` 0..1 | a capital kept by 0-1 units while the capital is the main factory: 3 capitals lost in 12 smoke matches |
| `smart_strangler@hard` (`hard`) | `w_cut` by connectivity to the enemy *capital*, `W_RING` 60 | under v2 what starves a node is the loss of its *line*, not of the capital path; `cut_value` also counts road levels, always 1 in v2 |
| `smart_reactive@normal` (`normal`) | `respond` 2, `COUNTER`, `reserve` 138-238 and `recruit_keep` 325-425 | both keeps are overridden by `adjusted` to 100 and 200, `fortify` is a no-op: the "Counter" has no v2 defense at all beyond one reinforcement |
| `smart_turtle` (`easy` at `@easy`) | `BUNKERS` 4, garrisons by `estimate.threats`, the natural half | the strongest holder on `mvp-3` before #659 (0.84), 0.46-0.60 after; at `easy` it has no `insight`, so no evacuation, no pin, no scouts |
| `smart_hoarder` (benchmark) | the owner's v1 plan | G8 |

Levels (`tempo.py`): `easy` thinks every 20 ticks, notices a shown enemy 30 ticks late, 12 APM, no `insight`;
`normal` 10 / 15 / 25 with insight; `hard` 5 / 0 / 40 with insight. The ladder of #574 separates by `insight` and by
personality, not by tempo: `hard` and `normal` of one personality are within each other's interval
(`docs/balance/log.md`, #574), and the real match used 14.5 of the 40 APM. Reaction time and APM are therefore not the
lever that would make a level harder (section 4, option D).

### 2.4 What a strong human does that the bot cannot answer

From match 6 and the playtest of 2026-10-30 (`playtest-2026-10-30.md`):

1. **Hoards charges and builds nothing.** The owner ended with 31 charges in stock and 0 in buildings. The bot's enemy
   estimate (`EnemyForce`: enemy recruits equal own recruits) is about units, never about charges; it cannot tell a
   charged stack from a discharged one until it sees it (`RANGE` shows units only, DEC-21). An answer needs no
   information: keep own charges in units, not in buildings (G1).
2. **Raids a cut-off or discharged stack with 3 units**, then ignores it. The bot neither retreats nor recharges it
   (G3, G9).
3. **Banks CP and spends it in bursts** (4 recruits in a row at tick 1200; two plans at the end). The bot spends every
   CP at once (G5).
4. **Stages next to the capital in plain sight and pushes with two plans.** The intents are public (DEC-08) and the
   staging nodes were adjacent to bot nodes, so the view showed them. The bot's item 13 (`WORRY`) would have walked
   groups home and recruited; it is off because it lost 0.06-0.08 win rate against the bot field (#624). The one place
   the data already told us what a human does, the field's incentive overrode it.
5. **Sweeps empty nodes in groups of 2+** while the bot's garrisons are 0-1 units (`hold_front` 0..1): 10 nodes of the
   bot changed hands without a fight in match 6.
6. **Uses the fog for the stack, not for the plan.** The owner's groups stood in nodes the bot had no garrison next to
   (DEC-35: only own groups see), so the bot's `strengths()` spread the hidden force evenly over all enemy nodes and saw
   no weak spot and no concentration.

Information would help with 6 (and a little with 1 and 4); 2, 3 and 5 are decisions the bot can take with what it sees
today. That is why the fair fixes come first in the plan.

## 3. Metrics audit

### 3.1 The existing metrics, one verdict each

| Metric (where) | Measures | Misses or misleads | Verdict |
|---|---|---|---|
| Win rate with a Wilson 95% interval (`report`, pair matrix, per bot) | relative strength within the field, both sides | nothing about humans; a field with shared blind spots is flat and green (section 2); the per-bot figure depends on which bots are in the field | keep; always name the field; add the exploiter pair (#688) |
| Win-rate standard deviation and spread (`v2-params`, log) | how flat the field is | mixes rule balance with bot quality: a field of equally weak bots has sd 0; it moved from 0.264 to 0.140 across #663, #659, #674 while the bots changed as much as the rules | weak as a rules gate; read only when the bots are frozen |
| Capital wins, share of matches (log, `v2-params`) | decisiveness | per field, not per bot; does not say who loses the capital or to what (a push, a walk into an empty capital) | keep; add per-bot capital losses and the attacker's size at the capital fight (#690) |
| CP spent over income (`v2-params`) | how binding CP is | measured bot tempo, not rules: prices did not move it, only the income (A1-A7); a human's share differs (match 6: both at about 1.0 CP all match) | sanity only |
| Burned share (`#310`) | overproduction at full warehouses | useful for the rules; says nothing about bot strength | keep |
| Charge ledger and flow (`#588`, `#646`) | where every charge went; residual 0 | no column for charges sunk into buildings later lost or interrupted (`build_stopped`, captured factory); `stats` does not print `charges_built` and `charges_plans` at all; `stock_by_place` still has `front_wh` (markers: always 0 in v2) | keep; extend (#690) |
| Planned siege share, the #590 gate (`report`, `stats`) | the share of planned orders among orders into garrisoned nodes | tripled (0.148 to 0.351) in #618 by a bot policy change with no win-rate change: it measures bot code, not rules; the owner's match shows 0.60 against the bot's 0.29 | not a rules gate while bots set it; keep as a usage figure |
| Siege success (`report`) | captures of enemy nodes over "sieges" | 0.91-0.98 everywhere because a "siege" includes an entry into an empty enemy node (smoke: 29.5 of 31.2 "sieges" won, 3.6 siege orders); it measures target choice, not fighting | replace by contested sieges (a fight with a charged defender) and their success (#690) |
| Captures per match, captures in the last 3 minutes (`report`) | activity, frozen matches | fine | keep |
| Side advantage on mirror matches (`report`) | map skew | fine (300 mirrors per map at 100 seeds) | keep |
| Dominant strategy, rock-paper-scissors cycles (`report`) | diversity within the field | within the field only; the hoarder's fall from strongest to weakest between `mvp-2` and `mvp-3` shows a field verdict flips with the rules | keep; add the exploiter line |
| Unique outcomes, cells without variability (`report`) | determinism and seed variability | fine | keep |
| Mechanic usage (`report`, `usage`) | what the bots do | not in `gow-bots analyze`, so a human's usage is not readable from a replay; the report shows share-of-matches, the per-match mean is secondary | keep; add to `analyze` (#690) |
| Competence checks (`report`) | the BOT-05 checks of the old bots (`strangler` vs `expander`, `turtle`) | name bots that are not in the smart field; "[no data]" on every v2 run | rewrite for the smart field and the benchmark (#690) |
| `stats` (APM, CP by category, stance timeline, markers, transfers) | how a player played | the stance, `SetFront`, `SetRearMin`, `Transfer` rows are dead under v2; no rows for lines, factories, bunkers; APM is the one human-vs-bot figure it gives (14.5 against 8.5 in match 6) | fix the rows (#690) |
| Search score (`search.py`: win rate plus a tenth of the VP share) | the climb of one bot's ranges | few seeds, overfits; the opponents define what "better" means: against the bot field it switched item 13 off | keep for climbing; confirm against the exploiter too (#689) |
| The level ladder (`log.md`, #574, hand-picked pairs) | easy < normal < hard < expert head to head | computed by hand from one run; `hard` over `normal` was inside the interval of 0.5 on `mvp-2` | compute it in the report from the names (#690) |
| "Top bot" of a run (`v2-params`) | the best win rate | meaningless across fields (the hoarder, the turtle and the expander each led a run within a week) | drop |

### 3.2 Seeds and intervals

The Wilson half-width at p = 0.5 is about `1.96 * sqrt(0.25 / n)`:

| matches `n` | how you get it | half-width |
|---|---|---|
| 6 | one ordered pair, 1 map, 3 seeds, both sides | 0.40 |
| 24 | one pair, 4 pool maps, 3 seeds | 0.20 |
| 160 | one pair, 4 maps, 20 seeds | 0.08 |
| 400 | one pair, 4 maps, 50 seeds | 0.05 |
| 2400 | one bot against a 16-bot field, 4 maps, 20 seeds | 0.02 |

So the 3-seed smoke run answers "crash or gross imbalance" and nothing finer; the 16-bot 20-seed field is good for a
bot's standing against the field (plus or minus 0.02) and for the level order; a head-to-head claim about one pair
(the ladder, the exploiter gate) needs 160-400 matches of that pair. The policy of `tournament-policy` (16 bots, 20
seeds, GitHub runners) fits the first two questions; the exploiter gate adds its own pair at 50 seeds.

### 3.3 Proposed metrics and gates

- **M1. A human-style yardstick as a regression gate** (#688): `smart_exploiter`, built from the owner's play (no
  buildings, hoard, groups of 2+, raids on cut-off or discharged stacks, CP banked and spent in bursts, a two-plan
  capital push). The gate: `expert` scores at least 0.50 against it on the pool maps (50 seeds of the pair). A level
  that loses to the exploiter is not expert, whatever its field win rate.
- **M2. Mechanic efficiency, per player** (#690): `charges_built_lost` (charges of a building later interrupted or
  captured), `idle_discharged_unit_ticks` (units with 0 charges in a node with an empty warehouse, summed over ticks),
  `charges_per_kill`, `cp_cancelled`, `contested_sieges` and their success. These are what match 6 shows and the ledger
  does not.
- **M3. Scenario tests from lost owner matches** (#691): the bot's own view at the decisive tick as a fixture, the
  expected answer from the rules. The two of match 6 fail today.
- **M4. A computed ladder** (#690): every personality's `easy < normal < hard` and the server levels head to head,
  with intervals, from the names in the file; a step inside the interval of 0.5 is printed as "not separated".
- **M5. A fair-field line** in every report once grants exist (#692): the report states whether every bot played
  without a grant; a balance verdict is only read from fair files.
- **M6. Dominant-strategy detection beyond the field**: the diversity section adds the exploiter and reads a
  personality that beats every other bot but loses to the exploiter as "dominant against bots only".
- **M7. The seeds table** of 3.2 in `docs/balance/README.md` (#690).

## 4. Information advantage: should the higher levels see more?

### 4.1 The conflict with today's rules

- AGENTS.md 4.4: "`project()` is the only thing that leaves the simulation toward a player. Bots get the same
  `PlayerView` as humans." AGENTS.md 8 and the import-linter contract: `gow_bots.bots` imports only `gow_sim.view`,
  `commands`, `maps`, `ruleset`, never `state`, `systems`, `match`; the `ruff.toml` of the bots bans `GameState`.
- ADR 0001, decision 3: fog on the server, one projection.
- Why the rules are there: a bot that reads hidden state cannot be used to measure balance (it plays a different
  game), its decisions cannot be explained from the replay, and a leak in a bot path is a leak in the server process.

A grant can live inside these rules if it is a *second input of `project()`*, not a bypass of it.

### 4.2 Designs

| Option | What | Keeps the boundary | Measurable | Trade-offs |
|---|---|---|---|---|
| **A. Per-level information grant in `project()`** | `project(state, rules, player, match_key, grant=NO_GRANT)`; `Grant` is applied to the vision `levels` after `compute_vision` (raise the detail of chosen nodes and edge halves); `near`: exact numbers in every enemy node adjacent to an own node and on both halves of their edges; `wide`: at least `RANGE` on every enemy node, plus the requested bonus of enemy plans; the server passes the grant of the level (`LEVEL_BOTS` becomes `LevelSpec(bot, grant)`), `run_headless` and the tournament take an explicit `--grant` | yes: bots still read a `PlayerView`; `gow_sim.view` owns the grant; a fog test proves the granted view is a superset of the fair one and that `NO_GRANT` is byte-identical to today | yes: the ladder and the exploiter gate run with and without the grant; the report prints the fair-field line | one more parameter in the one function that must never leak; the client must say the level sees more; replays must record the grant |
| B. Bots read `GameState` | drop the import-linter contract for a `cheat` module | no | no (the bot plays a different game; nothing bounds what it reads) | rejected |
| C. Resource grant | extra CP or charges for the bot's side, a ruleset or match option | boundary yes, symmetry no: the sim's mirror and property tests assume equal rules | per match, yes | changes the rules for one side; a human notices a bot that recruits faster than it can; keep as a last resort after A |
| D. Tempo only | the existing `think`, `react`, `apm` | yes | measured: insufficient (`hard` and `normal` within intervals, #574; 14.5 of 40 APM used) | nothing to gain |
| E. No grant, better fair bots | the fixes of section 2 | yes | yes | the owner's question stays open: how hard can a fair bot be made; the answer today is "much harder than now", the ceiling is unknown |

### 4.3 How a grant interacts with balance work

- Balance verdicts (the BAL-02 criteria, win sd, capital wins, the burn) must come from fair fields: a granted bot
  measures the rules under information no human has (fights without fog are a different game, and the planned-order
  share, which depends on what the attacker knows, would move for the wrong reason).
- The tournament therefore defaults to fair, the grant is an explicit per-bot flag (`smart_expander@hard+near` or
  `--grant`), the file rows carry it, the report prints "fair field: yes/no", `tournament.yml` keeps the default.
- The server level with a grant is a product decision: the client labels it ("sees the numbers of every enemy city
  next to its own"); a hidden advantage would be found in the replay viewer (a bot reacting to what the human knows it
  cannot see) and read as cheating. If bot matches touch the rating, the granted level needs the owner's call.
- The grant does not replace the fair fixes: with G1-G3 in place the bot loses the match 6 pattern regardless of what
  it sees (buildings, pocket, CP), so the grant is measured only after them (the plan's order).

### 4.4 Recommendation

Option A, in two steps, with the fair fixes first. The ADR draft is `docs/adr/0002-bot-information-grants.md`; the
decision is #692. The first grant to try is `near` (exact numbers where the bot already has a neighbour: this removes
the `RANGE` and `PRESENCE` guesses that drive `GUESS_UNITS = 3` and `strike_guess`), measured by the exploiter gate and
the ladder; `wide` only if `near` does not separate `expert+` from `expert` by more than the interval.

## 5. Plan: the issues in order

Pending owner decisions that the plan waits for: (a) removing warehouse upgrades, (b) CP costs for buildings, (c) a new
supply distribution method, (d) #692 (grants). A bot change that depends on one of them is marked.

| Order | Issue | What | Waits for |
|---|---|---|---|
| 1 | #690 | metrics for v2 and for human matches (`stats` rows, M2, M4, M7, `usage` in `analyze`) | none; first, so the later PRs are measured |
| 2 | #688 | `smart_exploiter` and the regression gate (M1) | none |
| 3 | #691 | scenario tests from match 6 (M3; they fail until 4 and 6) | none |
| 4 | #682 | capital defense under v2 | none |
| 5 | #683 | buildings: factory site in the rear, prepaid, no garrison payment; the warehouse-level part | the factory part none; the warehouse part waits for (a); the budget logic changes if (b) comes |
| 6 | #684 | unsupplied pockets | none |
| 7 | #686 | capacity-aware moves | none |
| 8 | #687 | cancel discipline and CP banking | none; re-check if (b) comes |
| 9 | #685 | lines: `SetAutoLines(False)` and dead-end removal now, the cap after (c) | (c) for the cap |
| 10 | #689 | re-tune the personalities on `mvp-3`, re-pick the ladder | 4-9 and (a), (b), (c) |
| 11 | #692 | the grant decision; then the implementation issues (sim `Grant`, server level, tournament flag, client label) | the owner; measured after 10 |

Each issue names its acceptance criteria and the metric that proves it; every bot PR runs the 3-seed smoke locally and
the 16-bot 20-seed field on GitHub runners (`tournament-policy`), plus the exploiter pair once #688 is in.

## 6. Questions for the owner

1. **Yardstick or player?** Should the smart personalities aim at beating a human-style opponent (the exploiter gate as
   a merge condition) or stay the balance field that measures rules? The audit recommends both roles with one field:
   fair bots, measured against the exploiter too, since tuning against bots alone removed a human-relevant defense.
2. **Grants (#692):** option A with `near`, `wide`, C, or E; and whether a granted level is labelled in the client.
3. **Raids on cut-off stacks (G9):** a human empties a cut stack 1:1 and the stack cannot refill. Is this intended
   (positioning is the skill) or does it need a rule (a discharged unit retreating on its own, a province depot)? The
   bot fix of #684 assumes the rule stays.
4. **Payment by the garrison** (`systems.build.pay`, #651): a factory started with an empty warehouse disarms the
   garrison. The bot fix of #683 avoids it; should the rule also refuse to pay with units, or pay the warehouse only?
5. **`SetAutoLines` for bots:** #685 turns it off for every smart bot (they draw every line). Fine, or should bots play
   the same default as humans?

## 7. Risks

- The diagnosis of G2, G3 and G9 rests on one real match and the playtest of 2026-10-30; G1, G4, G5 and G6 are
  confirmed by the smoke run on three seeds. More owner replays (the server keeps them) would firm it up; #691 makes
  them reusable.
- The fair fixes shift the field: the expander will beat the hoarder and the rusher more often; the 16-bot field and
  the level order must be re-checked after every PR (the issues say so). The server ladder may need re-picking before
  #689.
- A grant inside `project()` touches the one function that must never leak; its tests must prove `NO_GRANT` is
  identical to today (golden replays do not cover views; `test_view.py` and `test_dec41_view.py` do) before any level
  uses it.
- The owner's pending rule decisions can invalidate #683 (warehouse part), #685 (cap) and #689 (every number) if they
  land after the work; the plan orders those last for that reason.
- The exploiter is a bot too: it will have its own blind spots, and a personality tuned against it will overfit it as
  the field was overfitted. The gate is a floor, not a target; the scenario tests and new owner replays stay the
  truth.
