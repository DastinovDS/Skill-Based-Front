# Peak APM that spends resources (#965)

**The answer** (`rulesets/mvp-7.toml`, `SIM_VERSION` 52; the fastest tempo is the biggest map: 55 nodes from the
generator, `pct` 105; `gen1-58`, 54 nodes, `pct` 104, is the biggest map in the repo):

1. **Sustained: 7.9 paid commands a minute, in War** (CP only: moves, recruits, group orders at 1 CP each); with
   buildings paid in charges on top it is **about 9.5 a minute in any stance** (War 9.47, Balance 9.54, Economy 9.47).
2. **Burst: 5 paid commands at once** (the 5 CP cap), refilled in 38 s in War; the best windows are **6 in 10 s
   (36 a minute) and 13 in 60 s**, War, the same on 51 to 55 nodes; build commands can add one per own city, once.
3. **The economy binds, not the server** (1200 messages a minute, 60 at once, about 125 times more); hard bots on the
   biggest maps spend every CP and touch the 10 s and 60 s ceilings, 5.9 useful a minute on average.

The rest of this document: the definitions (section 1), the maps and the tempo (section 2), the analytic ceiling with
its formulas in the node count `N` (section 3), the server limit (section 4), the bot measurement (section 5), an
estimate for a human (section 6) and how to rerun it (section 7). The formulas are written for reuse by the follow-up
question of when the resource rates should grow with bigger maps or more players.

## 1. Definitions

- **Command:** one command of `gow_sim.commands` a player sends (`Forfeit` excluded, as in `gow_sim.analysis`).
  APM: commands per minute of match time (600 ticks).
- **Useful command (spends a resource):** an accepted command that costs CP (`Ok.cost > 0`) or is paid in charges:

  | Command | CP (mvp-7) | Charges |
  |---|---|---|
  | `Move` (ordinary) | 1 (`orders.cost.move`) | 1 per capture (`capture.charge_cost`), paid by the group |
  | `Move` planned | 1 (`orders.cost.planned_move`) | the requested bonus `b >= 1`, 1 per `orders.plan_ticks_per_bonus` (3 s) from the node warehouse |
  | `GroupMove` attack | 1 per member (at most `group_order.max_groups` = 16 members; the 5 CP cap allows 5) | as `Move` per member |
  | `GroupMove` rally | `ceil(n / 2)` whole CP for `n` groups (1 CP for 1 or 2 groups) | none |
  | `Recruit` | 1 (`orders.cost.recruit`) | none at once; the new unit takes 1 by recharge |
  | `FortifyRoad` | 1.5 (`fort.cost`) | none |
  | `BuildBarracks` | 0 | 3 (`city_upgrades.barracks_charges`), progressive payment |
  | `BuildFactory` | 0 | 4 (`factory.cost`), progressive payment, at most `factory.max` = 3 factories with the capital |

- **Free commands, counted apart:** `CancelOrder`, `Split`, `Merge`, `SetStance`, `SetRallyPoint`, `CancelRecruit`
  (it refunds CP), `ReleasePlan` and `SetLeafShift` (both rejected under `mvp-7`). They spend nothing and only the
  server limit bounds them (section 4).
- **Not a command:** the recruit rally walk (DEC-48, item H3) pays `recruit.rally_cost` = 0.5 CP per walking unit by
  itself, with no command. It is CP spent, not an action: a player who walks recruits to a rally point has 0.5 CP less
  for commands per recruit.
- The cheapest paid command costs **1 CP** (`Move`, a planned `Move`, `Recruit`, a rally of 1 or 2 groups). The
  cheapest command paid in charges costs **3 charges** (`BuildBarracks`).

## 2. Maps and tempo

Map tempo (DEC-46, `[map_tempo]`, `gow_sim.ruleset.apply_map_tempo`): `pct(N) = clamp(isqrt(N * 10000 // 49), 50,
150)`, and every period of `[stances.cp_period_ticks]` and `[stances.capital_period_ticks]` becomes
`max(1, p * 100 // pct)`. A bigger map has shorter periods, so the biggest map is the fastest tempo.

| Set | Biggest map | Nodes `N` | `pct` |
|---|---|---|---|
| pool (`maps/*.json`) | `ridge` | 51 | 102 |
| `maps/gen/` | `gen1-58` | 54 | 104 |
| `maps/fixtures/` | `web` | 34 | 83 |
| `maps/menu/` (not played) | `marches` | 48 | 98 |
| generator (`gow_maps.generate.plan_size`, `MIN_NODES, MAX_NODES = 29, 55`; the server's match maps, `gow_server.mapgen`) | any seed with 55 nodes | 55 | 105 |

- **`max_pct` = 150 saturates at `N >= 111`** (`111 * 10000 // 49 = 22653`, `isqrt` 150; `N = 110` gives 149).
  Today's maps reach at most 105: a map needs twice the nodes of today's biggest to reach the clamp.
- `min_pct` = 50 holds for `N <= 12` (no such map exists).

The base periods (ticks, `pct` = 100) and after the tempo on the fastest maps:

| Stance | CP: 0.5 CP per (base, 54, 55, 111+) | Every factory: 1 charge per (base, 54, 55, 111+) |
|---|---|---|
| War | 40, 38, 38, 26 | 400, 384, 380, 266 |
| Balance | 50, 48, 47, 33 | 200, 192, 190, 133 |
| Economy | 100, 96, 95, 66 | 100, 96, 95, 66 |

## 3. Analytic ceiling

### Formulas

With `hz` = `tick_hz` (10), `q` = `cp.per_period` (50 hundredths), `c` = the cheapest paid command (100 hundredths),
`F` = `factory.max` (3), `k` = the cheapest charge-paid command (3 charges), `p_cp(s)` and `p_f(s)` the stance
periods of the ruleset, `pct = pct(N)`:

```
P_cp(s, N) = max(1, p_cp(s) * 100 // pct(N))          # ticks per CP quantum
P_f(s, N)  = max(1, p_f(s)  * 100 // pct(N))          # ticks per charge of one factory
CP a minute       = q / 100 * 60 * hz / P_cp           # War, N = 49: 7.5
charges a minute  = F * 60 * hz / P_f                  # War, N = 49: 4.5 with 3 factories
APM_cp(s, N)      = (q * 60 * hz / P_cp) / c           # commands paid by CP
APM_ch(s, N)      = (F * 60 * hz / P_f) / k            # commands paid by charges, if paid as they come
APM_sustained     = APM_cp + APM_ch                    # ~ 9 * pct(N) / 100 in mvp-7, any stance
burst             = cp.cap // c                        # 5
window W seconds  = (cp.cap + ceil((W * hz - 1) / P_cp) * q) // c   paid commands in W s
```

The window formula starts at the cap: the commands are applied in ticks `t..t+W*hz-1` and the CP were at the cap after
tick `t-1`. Commands go before the economy in a tick (`gow_sim.match.SYSTEMS`), so a quantum that fires in the last
tick of the window cannot be spent in it: at most `ceil((W*hz - 1) / P_cp)` quanta count.

**Why every stance gives the same total.** The stances trade CP for charges at one rate: War to Balance gives up
1.5 CP a minute for 4.5 charges, Balance to Economy 3 CP for 9 charges (49 nodes, 3 factories), so 1 CP = 3 charges
= one `BuildBarracks`. With the cheapest charge command at 3 charges the sum `APM_cp + APM_ch` does not depend on the
stance; the stance only decides how much of it is orders and how much is buildings. This holds only while
`factory.max` factories work (with the capital alone 1 CP buys 1 charge, and War gives the most commands) and while
there are cities to build in.

### Table (`scripts/apm_ceiling.py ceiling`)

| nodes | pct | stance | cp_period | factory_period | cp_per_min | charges_per_min | apm_cp | apm_charges | apm_sustained | burst | cap_refill_s | apm_10s | apm_60s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 29 | 76 | war | 52 | 526 | 5.77 | 3.42 | 5.77 | 1.14 | 6.91 | 5 | 52.0 | 36.0 | 11.0 |
| 29 | 76 | balance | 65 | 263 | 4.62 | 6.84 | 4.62 | 2.28 | 6.9 | 5 | 65.0 | 36.0 | 10.0 |
| 29 | 76 | economy | 131 | 131 | 2.29 | 13.74 | 2.29 | 4.58 | 6.87 | 5 | 131.0 | 30.0 | 7.0 |
| 49 | 100 | war | 40 | 400 | 7.5 | 4.5 | 7.5 | 1.5 | 9.0 | 5 | 40.0 | 36.0 | 12.0 |
| 49 | 100 | balance | 50 | 200 | 6.0 | 9.0 | 6.0 | 3.0 | 9.0 | 5 | 50.0 | 36.0 | 11.0 |
| 49 | 100 | economy | 100 | 100 | 3.0 | 18.0 | 3.0 | 6.0 | 9.0 | 5 | 100.0 | 30.0 | 8.0 |
| 51 | 102 | war | 39 | 392 | 7.69 | 4.59 | 7.69 | 1.53 | 9.22 | 5 | 39.0 | 36.0 | 13.0 |
| 51 | 102 | balance | 49 | 196 | 6.12 | 9.18 | 6.12 | 3.06 | 9.18 | 5 | 49.0 | 36.0 | 11.0 |
| 51 | 102 | economy | 98 | 98 | 3.06 | 18.37 | 3.06 | 6.12 | 9.18 | 5 | 98.0 | 36.0 | 8.0 |
| 54 | 104 | war | 38 | 384 | 7.89 | 4.69 | 7.89 | 1.56 | 9.46 | 5 | 38.0 | 36.0 | 13.0 |
| 54 | 104 | balance | 48 | 192 | 6.25 | 9.38 | 6.25 | 3.12 | 9.38 | 5 | 48.0 | 36.0 | 11.0 |
| 54 | 104 | economy | 96 | 96 | 3.12 | 18.75 | 3.12 | 6.25 | 9.38 | 5 | 96.0 | 36.0 | 8.0 |
| 55 | 105 | war | 38 | 380 | 7.89 | 4.74 | 7.89 | 1.58 | 9.47 | 5 | 38.0 | 36.0 | 13.0 |
| 55 | 105 | balance | 47 | 190 | 6.38 | 9.47 | 6.38 | 3.16 | 9.54 | 5 | 47.0 | 36.0 | 11.0 |
| 55 | 105 | economy | 95 | 95 | 3.16 | 18.95 | 3.16 | 6.32 | 9.47 | 5 | 95.0 | 36.0 | 8.0 |
| 80 | 127 | war | 31 | 314 | 9.68 | 5.73 | 9.68 | 1.91 | 11.59 | 5 | 31.0 | 42.0 | 15.0 |
| 80 | 127 | balance | 39 | 157 | 7.69 | 11.46 | 7.69 | 3.82 | 11.51 | 5 | 39.0 | 36.0 | 13.0 |
| 80 | 127 | economy | 78 | 78 | 3.85 | 23.08 | 3.85 | 7.69 | 11.54 | 5 | 78.0 | 36.0 | 9.0 |
| 111 | 150 | war | 26 | 266 | 11.54 | 6.77 | 11.54 | 2.26 | 13.79 | 5 | 26.0 | 42.0 | 17.0 |
| 111 | 150 | balance | 33 | 133 | 9.09 | 13.53 | 9.09 | 4.51 | 13.6 | 5 | 33.0 | 36.0 | 14.0 |
| 111 | 150 | economy | 66 | 66 | 4.55 | 27.27 | 4.55 | 9.09 | 13.64 | 5 | 66.0 | 36.0 | 10.0 |

Columns: `cp_period` and `factory_period` in ticks; `apm_cp`, `apm_charges`, `apm_sustained` per minute; `burst`
commands at once; `cap_refill_s` the seconds from 0 to the CP cap; `apm_10s`, `apm_60s` the most paid commands in a
10 s or 60 s window, per minute.

### Chart

Paid commands a minute (y) against the node count `N` (x), `mvp-7`. `T`: the sustained total, CP and charges,
the same in every stance; `W`, `B`, `E`: the part paid by CP in War, Balance, Economy. The steps are the integer
periods; the lines are flat past `N = 111` (`max_pct`). Today's maps sit at `N` 25..55.

```text
 14 |                                                        T  T  T  T  T
 13 |                                               T  T  T               
 12 |                                      T  T  T           W  W  W  W  W
 11 |                             T  T  T           W  W  W               
 10 |                          T           W  W  W                        
  9 |                 T  T  T     W  W  W           B  B  B  B  B  B  B  B
  8 |           T  T     W  W  W        B  B  B  B                        
  7 |        T     W  W        B  B  B                                    
  6 |  T  T  W  W     B  B  B                                             
  5 |  W  W  B  B  B                                            E  E  E  E
  4 |  B  B                          E  E  E  E  E  E  E  E  E            
  3 |           E  E  E  E  E  E  E                                       
  2 |  E  E  E                                                            
  1 |                                                                     
  0 |                                                                     
    +---------------------------------------------------------------------
      20 25 30 35 40 45 50 55 60 65 70 75 80 85 90 95100105110115120125130
```

### What the formulas leave out

- **The charge term is not a rate for a whole match.** `BuildBarracks` is once per city (no cancel, it stays with the
  city) and `BuildFactory` at most `factory.max - 1` = 2 times (plus rebuilds after a loss). A player who owns 15 cities
  has at most 14 barracks and 2 factories to build: in Economy on 54 nodes (6.25 a minute) that is about 2.5 minutes of
  building, not 15. Over a whole match the CP term is the ceiling: **7.9 a minute in War on 54 or 55 nodes, 11.5 at the
  clamp**.
- **The charge term needs 3 factories.** At the start a player has 1 (the capital), so its charge term is a third.
- **The progressive payment** (DEC-41, item 7) lets a building command go out before its charges exist: a burst can
  add one `BuildBarracks` per own city without a barracks and one `BuildFactory` per free factory slot at once, paid
  later. That is a one-off, not a rate.
- **CP spent without a command:** the rally walk costs 0.5 CP per unit, so a recruit sent to a rally point is
  1 command for 1.5 CP, where a recruit and a `Move` are 2 commands for 2 CP. The rally point saves CP and lowers APM.
- **More groups per command:** a rally `GroupMove` moves 2 groups per CP, an attack `GroupMove` up to 5 groups at
  once; a player who uses them moves more groups per minute with fewer commands. The ceiling of group movements a
  minute is twice the CP a minute (rallies of even size), not the command count.
- **Usefulness:** a paid command still needs something to act on (a standing group, a city with a barracks and room).
  On a map with many own groups and barracks these never bind before the CP; on a tiny one they can.

## 4. The server limit

`gow_server.ws._read` takes one token per incoming message from a `TokenBucket(ws_msg_rate, ws_msg_burst)`
(`gow_server.settings`, `GOW_WS_MSG_RATE` = 20 a second, `GOW_WS_MSG_BURST` = 60 in `compose.yaml`); an empty bucket
closes the socket (`RATE_LIMITED`). Every message counts: commands, `ping` (the client sends one every 5 s), `reach`
queries, `resync`. So a client can send about **1188 commands a minute** (1200 minus 12 pings) and **60 at once**.

| | Paid commands a minute | At once |
|---|---|---|
| Economy ceiling, 55 nodes | 9.5 (7.9 by CP) | 5 (CP cap) |
| Economy ceiling, at the clamp (`N >= 111`) | 13.8 (11.5 by CP) | 5 |
| Server bucket | about 1188 (any commands) | 60 |
| Smart bot `@hard` (`gow_bots.bots.tempo`) | 40 (any commands) | 8 |

The economy binds first by two orders of magnitude; the server limit only bounds free commands (cancel, split,
merge, stance, rally point), which the economy does not limit at all.

## 5. Bot measurement

**The run.** GitHub Actions run
[43078487999](https://github.com/DastinovDS/Skill-Based-Front/actions/runs/43078487999) (`mise run tournament:gh
--ref feature/965-apm-ceiling --replays true`): `rulesets/mvp-7.toml`, the three biggest maps with matches (`gen1-58`
54 nodes, `ridge` 51, `gen1-40` 51), the five smart personalities at `hard` (`smart_rusher`, `smart_expander`,
`smart_strangler`, `smart_reactive`, `smart_turtle`; every ordered pair, both sides), 5 seeds: 375 matches, 750 player
rows, 365 ended on VP at the timer (15 minutes), 7 by a capital, 3 on cities. The replays were re-simulated with
`scripts/apm_ceiling.py replays` (the same `replay_log` as `gow-bots stats`). The `hard` tempo caps a bot at 40
commands a minute with a burst of 8 (`gow_bots.bots.tempo`), so 14 commands in 10 s (84 a minute) is the bot's own
ceiling for all commands.

Per map (APM and the useful share over the whole match; the peaks are the best sliding window of a player in a match,
in commands a minute; the p50 and p95 are over the player rows):

| map | players | APM | useful APM | useful share | useful 10 s p50 / p95 / max | useful 60 s p50 / p95 / max | all 10 s max | all 60 s max | CP spent a min |
|---|---|---|---|---|---|---|---|---|---|
| gen1-40 | 250 | 8.7 | 5.89 | 68% | 24 / 30 / 36 | 11 / 12 / 13 | 84 | 35 | 5.75 |
| gen1-58 | 250 | 8.7 | 5.96 | 68% | 24 / 30 / 30 | 10 / 13 / 13 | 84 | 41 | 5.79 |
| ridge | 250 | 8.5 | 5.82 | 69% | 24 / 30 / 36 | 10 / 12 / 13 | 84 | 47 | 5.69 |
| all | 750 | 8.6 | 5.89 | 68% | 24 / 30 / 36 | 10 / 13 / 13 | 84 | 47 | 5.75 |

Per bot:

| bot | players | APM | useful APM | useful share | useful 10 s p50 / p95 / max | useful 60 s p50 / p95 / max | all 10 s max | all 60 s max | CP spent a min |
|---|---|---|---|---|---|---|---|---|---|
| smart_expander@hard | 150 | 9.0 | 6.01 | 67% | 30 / 30 / 30 | 12 / 13 / 13 | 84 | 28 | 5.90 |
| smart_reactive@hard | 150 | 7.9 | 5.39 | 68% | 24 / 30 / 30 | 9 / 11 / 12 | 84 | 28 | 5.23 |
| smart_rusher@hard | 150 | 9.8 | 6.91 | 71% | 30 / 30 / 30 | 12 / 13 / 13 | 84 | 41 | 6.72 |
| smart_strangler@hard | 150 | 8.2 | 5.48 | 67% | 24 / 30 / 36 | 9 / 12 / 12 | 84 | 47 | 5.25 |
| smart_turtle@hard | 150 | 8.3 | 5.65 | 68% | 24 / 30 / 36 | 10 / 12 / 13 | 84 | 35 | 5.64 |
| all | 750 | 8.6 | 5.89 | 68% | 24 / 30 / 36 | 10 / 13 / 13 | 84 | 47 | 5.75 |

What it shows:

1. **The bots spend every CP.** A player burns 0.6 CP a match at the cap on average and ends 1.3% of the ticks at
   the cap (`cp_burned`, `cp_cap_ticks` of the tournament rows). They spend 5.75 CP a minute by commands; the income
   of their stance mix (27% Economy, 50% Balance, 23% War of the match time) is about 5.7 a minute on 51 to 54 nodes,
   5.9 with the 3 CP of the start, so they spend about 97% of it.
   Their 5.9 useful commands a minute are the CP term of their stances plus a few buildings: the ceiling of section 3
   holds them, and they reach it.
2. **The windows touch the analytic ceiling.** The best useful 10 s window is 6 commands (36 a minute) and the best
   60 s window 13: exactly the War ceilings of section 3 on 51 to 54 nodes (`apm_10s` 36, `apm_60s` 13); no player row
   exceeds them. The p95 of a player is 5 in 10 s (the cap spent at once) and 12 to 13 in 60 s.
3. **All commands peak at the bot tempo.** 14 commands in 10 s (84 a minute) is the `hard` bucket (8 saved up plus
   40 a minute), reached on every map. The free third of the commands (the `usage` of the tournament rows, all
   accepted commands): `Split` 16.6%, `SetStance` 11.4% (about 15 stance changes per player and match),
   `CancelOrder` 2.7%, `Merge` 1.1%, `CancelRecruit` under 0.1%; 19 of about 96,400 commands were rejected.
4. **About two thirds of the commands spend.** Useful share 68%; the useful commands are `Move` 79.6% (planned 3.1% of
   all useful), `Recruit` 12.6%, `BuildFactory` 3.8%, `FortifyRoad` 3.7%, `BuildBarracks` 0.5%. The bots send no
   `GroupMove` and set no rally point (0 CP of rally walks), so they never get more than one group move per CP.
5. **Lower bound.** The bots sit in War a quarter of the match; the per-bot spread follows the stance (`smart_rusher`
   opens in War: 6.9 useful a minute, `smart_reactive` and `smart_strangler` in Balance: 5.4 to 5.5). A player that
   stays in War would sit at 7.9.

## 6. A human (estimate)

**This section is an estimate**, not a measurement: the only recorded human match with these numbers is older.

- **The one data point.** The owner's match 6 (`mvp-3`, `narrows`, 7.7 minutes; `docs/balance/bot-audit-2026-11.md`,
  section 1): 66 commands, 8.5 a minute on average, 12 in the best minute; 46 CP spent, which is the whole CP income
  of that ruleset (1 CP per 100 ticks, 6 a minute, plus the start). A human player at the owner's level already spends
  every CP, like the bots do.
- **CP term: about 90 to 100% reachable.** Spending every CP as it comes needs one paid command every 7.6 s in War on
  55 nodes; the owner managed one every 10 s at a slower income. A strong human in War reaches 7 to 7.9 paid commands
  a minute sustained, and the windows (6 in 10 s, 13 in 60 s) whenever he saves up to the cap before a push.
- **Charge term: rarely used.** The owner built nothing in match 6, the bots put 4% of their useful commands into
  buildings. A human builds the 2 factories and a few barracks early and then stops: over a match the charge term
  adds well under 1 command a minute. Total: **about 7 to 8.5 useful commands a minute, 75 to 90% of the 9.5 ceiling,
  in War on the biggest map**; less in Balance or Economy (6.4 and 3.2 a minute paid by CP on 55 nodes).
- **Free commands on top.** The bots' useful share is about two thirds, the owner's was about 70% (46 CP over 66
  commands, before the group order existed). A human sending 8 useful commands a minute sends about 11 to 12 in all;
  the server allows a hundred times that.
- **What dominates.** `Move` (ordinary and planned) is about 80% of the useful commands of every bot and was 38 of 46
  CP of the owner; `Recruit` is the second (13% of the bots, 8 CP of the owner); forts and buildings are a few percent.
  The group order and the rally point (DEC-48) are new: a human who uses them moves more groups per CP (section 3,
  "What the formulas leave out") and sends fewer commands, so APM is a weaker measure of throughput than CP spent.

## 7. Rerun

```bash
# the ceiling of a ruleset for any node counts
mise exec -- uv run python scripts/apm_ceiling.py ceiling --ruleset rulesets/mvp-7.toml --nodes 29 49 55 111
# a small GitHub run with replays (#965), then the windows of every match and player
mise run tournament:gh --bots "smart_rusher@hard smart_expander@hard" --maps "maps/gen/gen1-58.json maps/ridge.json" \
  --seeds 5 --shards 10 --label apm --replays true
mise exec -- uv run python scripts/apm_ceiling.py replays .tournament/replays-<run id>/*/*.jsonl.gz --jobs 4 > rows.jsonl
```
