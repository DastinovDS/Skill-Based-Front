# When bigger maps and more players call for raising the economy limits (#974)

**The answer** (`rulesets/mvp-7.toml`, `SIM_VERSION` 52; a human sustains **7 to 8.5 useful commands a minute**, the
estimate of `docs/balance/apm-ceiling.md`, section 6, taken here as an assumption, 8 in the headline numbers):

1. **Today (29 to 55 nodes, 2 players) nothing binds hard.** The 55-node maps pay 7.9 CP a minute in War, right at
   the assumed ceiling, so a human who stays in War and gives only single orders is at his limit there; Balance
   (6.4 CP a minute) has slack, the CP cap holds 38 s of War income, and `factory.max`, the warehouses,
   `max_groups` and the server limit do not bind.
2. **For 2 players the threshold is N = 56 in War and N = 86 in Balance** (44 to 88 in War for a ceiling of 7 to 10):
   past it the CP income outruns a human who pays 1 CP per command. Bots confirm the trend: on 80 to 120 nodes they
   need 7.6 to 9.0 useful commands a minute and sit at the CP cap 2 to 8% of the match. **Raise the CP per command
   first** (group orders, a multi-unit recruit), **then the CP cap with the tempo from N = 60**; keep the order cost,
   `factory.max`, the warehouses, `group_order.max_groups` and the server limit.
3. **For more players the tempo itself must change before any limit:** DEC-46 counts every node of the map, so 3 or
   4 players with 25 nodes each would get 1.23x or 1.42x the economy of a 1v1 with the same land. Counting the nodes
   per player (`N * 2 // P`) keeps every threshold of the 2-player table.

Sections: the model (1), the thresholds per limit (2), the check of today and of bigger maps with numbers (3), the
proposals (4), how to rerun (5). Everything below is a proposal: no rule, ruleset or `SIM_VERSION` changes.

## 1. The model

`N` is the node count of the map, `P` the players, `n = N / P` the nodes per player, `pct(N)` the map tempo of DEC-46
(`mechanics.md`, section 6): `clamp(isqrt(N * 10000 // 49), 50, 150)`, every economy period `p` becomes
`max(1, p * 100 // pct)`. The formulas of `docs/balance/apm-ceiling.md`, section 3, give the incomes:

| Quantity | Formula (`mvp-7`) | 49 nodes | 55 | 80 | 100 | 111+ | Grows like |
|---|---|---|---|---|---|---|---|
| CP a minute, War / Balance / Economy | `cp.per_period * 600 / P_cp(s, N) / 100`, about 7.5 / 6 / 3 `* pct / 100` | 7.5 / 6.0 / 3.0 | 7.9 / 6.4 / 3.2 | 9.7 / 7.7 / 3.8 | 10.7 / 8.6 / 4.3 | 11.5 / 9.1 / 4.5 | `sqrt(N)`, flat past 111; not territory, not `P` |
| Charges a minute, `F` factories, War / Balance / Economy | `F * 600 / P_f(s, N)`, about `F *` 1.5 / 3 / 6 `* pct / 100` | `F *` 1.5 / 3 / 6 | `F *` 1.6 / 3.2 / 6.3 | `F *` 1.9 / 3.8 / 7.7 | `F *` 2.1 / 4.3 / 8.6 | `F *` 2.3 / 4.5 / 9.1 | `sqrt(N)` per factory, `F <= factory.max = 3` |
| CP cap in seconds of War income | `cp.cap / cp.per_period * P_cp(war, N) / 10` | 40 s | 38 s | 31 s | 28 s | 26 s | `1 / sqrt(N)` |

The charges and the CP grow by the same `pct`, so their ratio does not depend on `N`; the stance alone sets it
(`apm-ceiling.md`, section 3: 1 CP buys 3 charges at every stance change). A charge rate past 3 factories does not
follow territory: the factory cap is flat.

**What there is to do** grows differently. The generator (`gow_maps.generate`, #771) was run with a fixed node count
for 60 to 120 nodes, three seeds per size (section 3.2); per player's half (the nodes nearer the own capital in roads):

| Nodes | Maps | Nodes of a half | Cities of a half | Front nodes of a half | Capital distance, roads / ticks |
|---|---|---|---|---|---|
| 29..39 | 5 (pool, `maps/gen/`) | 15.4 | 8.4 | 4.1 | 7.8 / 451 |
| 44..55 | 7 (pool, `maps/gen/`) | 23.2 | 11.8 | 5.3 | 8.7 / 524 |
| 60 | 3 (synthesized) | 27.3 | 14.3 | 5.5 | 9.0 / 517 |
| 70 | 3 | 32.0 | 17.0 | 7.0 | 9.0 / 548 |
| 80 | 3 | 36.8 | 19.3 | 7.3 | 8.3 / 478 |
| 90 | 3 | 37.8 | 18.8 | 8.2 | 9.3 / 536 |
| 100 | 3 | 46.0 | 21.8 | 9.0 | 8.7 / 542 |
| 110 | 3 | 48.5 | 24.3 | 9.0 | 9.0 / 534 |
| 120 | 3 | 55.7 | 27.5 | 7.2 | 10.0 / 566 |

- **Territory is linear:** a half holds about `0.46 N` nodes and `0.23 N` cities.
- **The front is about `0.8 sqrt(N)` nodes** (noisy: 4 to 10.5 per map), the shape DEC-46 assumed: the CP and the
  charges per front node stay about flat (Balance, 3 factories: 1.7 charges a minute per front node at 44 to 55
  nodes, 1.4 at 100, 1.9 at 120).
- **The capital distance does not grow** (8 to 10 roads, 450 to 650 ticks): the generator spreads the extra nodes
  sideways and in depth, so a bigger map is wider and denser, not longer.

So per player and minute, with 2 players: the CP and the charges grow like `sqrt(N)`, the front (where most paid
commands go) like `sqrt(N)`, the land, the cities and the barracks to build like `N`. The paid command rate a player
needs to use the CP grows like the CP, `sqrt(N)`; a human's ceiling does not grow at all.

**More players (#910, parked).** DEC-46 takes `N` of the whole map, so `pct` grows with `P` at the same land per
player. A 1v1 with 25 nodes a player is `N = 50`, `pct` 101; 3 players with 25 each are `N = 75`, `pct` 123; 4 are
`N = 100`, `pct` 142 (#910 named this: "a 100-node map would get a 1.4x faster economy by accident"). The land per
player and its charge room stay those of the 1v1, the economy runs 23 to 42% faster. An estimate, no map exists: a
FFA region borders enemies on several sides, so its front is about twice the front of a 1v1 half of equal land (a
corner region of `n` nodes facing two neighbours has about `2 sqrt(n)` border nodes, a 1v1 half `0.8 sqrt(2n)`, about
`1.1 sqrt(n)`); 2v2 is closer to a 1v1 of `N` with the front shared by two players.

## 2. Thresholds per limit

The human ceiling `H` is the sustained useful commands a minute (an assumption; #965 estimates 7 to 8.5); `c` is the
mean CP per useful command (1.0 with single orders: the bots measure 0.98 to 1.01, they send no `GroupMove`; more
with group orders). A limit "binds" at the smallest `N` where the condition holds (`scripts/scaling_thresholds.py
thresholds`, integer periods as the simulation plays them).

| Limit (`mvp-7`) | Binds when | 2 players, `H` = 8 | Range | More players | Why |
|---|---|---|---|---|---|
| **CP income vs the human** (order cost 1 CP) | CP a minute `> H * c` | **War N >= 56, Balance N >= 86** (`c` = 1); never with `c` = 1.5 | War 33..88 for `H` 6..10, never for `H` >= 12 (table A) | today's tempo counts `N` of the whole map: 3 players bind in War from 19 nodes each (`N = 56`), 4 from 14; with 4.1 from 28 each | the CP buy the moves and recruits; past it CP pile up unless one command pays more than 1 CP |
| **CP cap as a buffer** (5 CP) | the cap fills in less than the gap `G` without a paid command | `G` = 30 s: **War N >= 88**, Balance never; `G` = 40 s: War N >= 50, Balance N >= 78 | 20 s: never (table B) | as the CP row | during a long fight or a planning pause the CP above the cap burn (`cp_burned`) |
| **CP cap as a burst** (5 CP) | a push wants more members than the cap pays | an attack of 5 and a rally of 10 groups at once, at every `N`; the bots stand with about 10 groups at every size | binds today by design (DEC-48, item B5), not with `N` | same | the cap, not `max_groups`, sizes a synchronized attack (DEC-48, item B5) |
| `group_order.max_groups` (16) | the cap pays more than 16 members | never: needs a cap of 16 CP (attack) or 8 CP (rally) | never under the proposal of section 4.2 (7.5 CP at most) | same | |
| **Order cost** (1 CP a move or recruit) | income per cost `> H` | the same `N` as the first row | | | "too cheap" and "income outruns the human" are one ratio |
| `factory.max` (3) | the charge income stops following the land | from the start by design: the factories are capped, the land is not | 12 cities a half at 49, 27 at 120 | same, sooner per region if the tempo stays on `N` | bot runs on 80..120 nodes show a charge **surplus**, not a shortage (section 3.3) |
| Warehouses (city 3, capital 6, province 1) | production finds no room | bots on 80..120 nodes: the capital full 23 to 48% of the match, 5.5 to 16% of the charges burned (49..54 nodes: 10%, 3 to 5%) | | worse with today's tempo for 3+ players: the same room, a faster factory | a surplus of charges over what the bots use |
| Server rate (20 messages a second, burst 60) | commands `>` about 1188 a minute | never: the economy pays at most 13.8 useful a minute (11.5 by CP) at the clamp | | per connection, so independent of `P` | two orders of magnitude of room (`apm-ceiling.md`, section 4) |

### A. CP outruns the human (smallest `N`)

CP a minute at the clamp (`N >= 111`): War 11.54, Balance 9.09, Economy 4.55. `never`: not below the clamp.

| `H` useful a minute | War `c` = 1 | War `c` = 1.5 | War `c` = 2 | Balance `c` = 1 | Balance `c` = 1.5 | Balance `c` = 2 |
|---|---|---|---|---|---|---|
| 6 | 33 | 69 | never | 50 | 108 | never |
| 7 | 44 | 94 | never | 68 | never | never |
| 8 | 56 | never | never | 86 | never | never |
| 9 | 69 | never | never | 108 | never | never |
| 10 | 88 | never | never | never | never | never |
| 12 | never | never | never | never | never | never |

Economy (at most 4.55 CP a minute) never binds.

### B. The CP cap covers a gap (smallest `N`)

| Gap `G` | War | Balance | Economy |
|---|---|---|---|
| 20 s | never | never | never |
| 30 s | 88 | never | never |
| 40 s | 50 | 78 | never |

### Chart

CP a minute (y) against `N` (x), `mvp-7`: `W` War, `B` Balance; the rows `-` and `=` are the human ceilings 7 and
8.5; `*` a curve on a ceiling row. With single orders a human in War crosses 7 at 44 nodes and 8.5 at 62; Balance
crosses 7 at 68 and 8.5 at 95. The clamp flattens both at 111.

```text
 12.0 |                                                                     
 11.5 |                                                       W  W  W  W  W 
 11.0 |                                                    W                
 10.5 |                                           W  W  W                   
 10.0 |                                        W                            
  9.5 |                                  W  W                               
  9.0 |                            W  W                    B  B  B  B  B  B 
  8.5 |=========================*====================*==*===================
  8.0 |                      W                 B  B                         
  7.5 |                   W              B  B                               
  7.0 |-------------*--*-----------*--*-------------------------------------
  6.5 |          W           B  B                                           
  6.0 |       W        B  B                                                 
  5.5 |    W        B                                                       
  5.0 | W        B                                                          
  4.5 |    B  B                                                             
  4.0 | B                                                                   
      +---------------------------------------------------------------------
       20    30    40    50    60    70    80    90    100   110   120   130
```

## 3. Today, and bigger maps

### 3.1 Today's maps (29 to 55 nodes, 2 players)

- **CP income vs the human:** at most 7.89 CP a minute in War (55 nodes), 6.38 in Balance. Inside the assumed 7 to
  8.5: a human in War on 44 to 55 nodes at a ceiling of 7 is APM-bound with single orders; at 8 he is not. This is the
  only limit near its threshold today, and only in War.
- **CP cap:** 38 to 52 s of War income, 47 to 65 s of Balance.
- **`factory.max`, warehouses:** the bots on 29 to 54 nodes burn 1.7 to 5.1% of their charges, the capital is full
  6 to 10% of the match (section 3.3).
- **`max_groups`, the server:** far away (the cap binds first; 1188 a minute).

Nothing binds hard on today's maps; War on the biggest maps is at the edge for a human at 7 useful a minute.

### 3.2 Synthesized maps (not in the pool)

`gow_maps.generate` picks the node count of a seed in `MIN_NODES..MAX_NODES = 29..55`; the measurement set both to
the target count (module globals, nothing committed) and kept the first seed that passed the generator's filter.
Seeds (map ids `gen1-<seed>`): 60 nodes 974600 to 974602, 70: 974700 to 974702, 80: 974800 to 974802, 90: 974900 to
974902, 100: 975000 to 975002, 110: 975100 to 975102, 120: 975200 to 975202. Every one passes `gow-maps validate
--ruleset rulesets/mvp-7.toml` (checked for 80, 100, 120). The generator's own filter accepts them, so its fairness
thresholds do not stop maps up to 120 nodes.

### 3.3 Bot run on 29 to 120 nodes

GitHub Actions run
[43083800554](https://github.com/DastinovDS/Skill-Based-Front/actions/runs/43083800554) (`mise run tournament:gh --ref
exp/974-big-maps --replays true`, a throwaway branch with the three synthesized maps, deleted after the run):
`mvp-7`, `smart_rusher@hard`, `smart_expander@hard`, `smart_turtle@hard` (every ordered pair, both sides), 3 seeds,
6 maps: 162 matches, 324 player rows; 157 ended on VP at the timer, 5 by a capital (all on 29 to 54 nodes). The
replays were re-simulated with `scripts/apm_ceiling.py replays` and `scripts/scaling_thresholds.py workload`.

| Map | Nodes | `pct` | CP income a min | useful APM | best useful 60 s, mean / max | CP per useful | CP burned a match | at the cap | cities at the end | capital full | charges burned |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `narrows` | 29 | 76 | 4.64 | 4.90 | 9.2 / 10 | 0.98 | 0.03 | 0.1% | 14.5 | 5.8% | 1.7% |
| `crossroads` | 49 | 100 | 5.70 | 5.89 | 10.5 / 12 | 0.99 | 0.35 | 0.8% | 24.4 | 10.0% | 5.1% |
| `gen1-58` | 54 | 104 | 6.27 | 6.46 | 11.4 / 13 | 0.99 | 0.31 | 0.7% | 26.7 | 9.8% | 3.3% |
| `gen1-974800` | 80 | 127 | 7.48 | 7.61 | 13.0 / 14 | 0.99 | 1.15 | 2.0% | 39.1 | 23.0% | 5.5% |
| `gen1-975000` | 100 | 142 | 8.25 | 8.00 | 13.9 / 15 | 1.01 | 5.57 | 7.8% | 46.6 | 26.6% | 16.0% |
| `gen1-975200` | 120 | 150 | 9.20 | 9.01 | 15.0 / 16 | 1.00 | 5.72 | 6.5% | 58.5 | 47.8% | 9.5% |

What a player has to do, sampled every 10 s (`scaling_thresholds.py workload`; means over the samples and the
player rows, the maximum over the samples):

| Map | Nodes | standing groups, mean / max | groups | units | own nodes | own cities | barracks | factories | front nodes | CP held |
|---|---|---|---|---|---|---|---|---|---|---|
| `narrows` | 29 | 6.9 / 19 | 7.5 | 15.6 | 13.6 | 9.3 | 1.2 | 2.6 | 5.7 | 1.08 |
| `crossroads` | 49 | 10.2 / 32 | 11.3 | 18.3 | 22.2 | 13.0 | 1.2 | 2.6 | 10.1 | 1.01 |
| `gen1-58` | 54 | 9.8 / 34 | 11.0 | 20.5 | 24.7 | 14.4 | 1.4 | 2.8 | 6.7 | 0.96 |
| `gen1-974800` | 80 | 9.6 / 30 | 10.9 | 20.7 | 33.6 | 17.2 | 1.6 | 2.6 | 8.0 | 1.05 |
| `gen1-975000` | 100 | 10.2 / 33 | 11.7 | 22.6 | 36.6 | 19.9 | 1.2 | 2.8 | 8.7 | 1.38 |
| `gen1-975200` | 120 | 9.8 / 29 | 11.5 | 22.7 | 43.2 | 20.0 | 1.3 | 2.9 | 5.4 | 1.40 |

What it shows:

1. **Useful APM follows the CP income, `sqrt(N)`.** 5.9 a minute at 49 nodes, 7.6 at 80, 8.0 at 100, 9.0 at 120:
   about `5.9 * pct / 100`. The bots pay 1 CP per useful command at every size (no `GroupMove`). A human who plays
   like them is past 8 useful a minute from about 100 nodes in their stance mix (24 to 37% War, 46 to 59% Balance),
   from 56 nodes in War.
2. **The CP start to burn at 80 to 100 nodes** even for a bot that may send 40 commands a minute: 2% of the match at
   the cap at 80, 7 to 8% at 100 and 120 (0.7 to 0.8% on 49 to 54 nodes). The bots are not APM-bound (the `hard`
   tempo allows 40); the likely cause is the gap of table B (the CP fill up while their groups walk and fight; not
   measured per event).
3. **The charges are in surplus, not short.** The capital is full 23 to 48% of the match from 80 nodes, 5.5 to 16%
   of the charges burn (80, 100, 120 nodes: 5.5, 16.0, 9.5%); more factories or bigger warehouses would only store
   more of what goes unused. The surplus is the CP side (units recruited) not keeping up with the charge side; for a
   human it would be the same CP limit.
4. **The army does not grow with the map, the land does.** From 49 to 120 nodes the own nodes double (22 to 43), the
   units grow by a quarter (18 to 23) and the groups not at all (about 11, 10 standing). The extra CP of the tempo go
   into more moves of the same groups (moves 75% of the useful commands at 49 nodes, 84% at 120) and into a fuller
   CP purse (1.0 CP held on average up to 80 nodes, 1.4 from 100), not into more units. A player stands with about
   10 groups at every size, twice the 5 members the CP cap pays for one synchronized attack.
5. **`factory.max` and the barracks:** the bots hold 2.6 to 2.9 factories at every size (the cap is 3) and build
   almost no barracks (1.2 to 1.6 with the capital): more cities did not turn into more buildings.
6. **The front and the pressure stay flat** (front 5.5 to 10.7 nodes, pressure 0.07 to 0.13 charges a front node a
   minute): DEC-46 does its job on the front up to 120 nodes.

Limits: 3 seeds, one map per size, three bot personalities; bots are not humans. The trends are clear (two to ten
times between 50 and 100 nodes); the single numbers are not precise.

## 4. Proposals

Each is an integer formula that could go under a ruleset key like `[map_tempo]` (AGENTS.md 4.1: integers, `//` on
non-negative numbers, rounded down). None is applied.

### 4.1 Map tempo per player (before any 3- or 4-player format)

```
pct = clamp(isqrt(N * 2 * 10000 // (P * ref_nodes)), min_pct, max_pct)
```

- For `P = 2` it is today's formula exactly: no 1v1 number, hash or replay changes; the map file would carry `P`.
- **Trade-off:** it equalizes the economy per land, not per front; a FFA region has a longer front per node (section 1),
  so each front node gets less. A front-based tempo would give more CP and hit the APM threshold sooner.
- **Recommendation: yes, as part of #910** when it is unparked; until then nothing to do.

### 4.2 CP cap with the tempo

```
cp_cap(N) = max(cp.cap, cp.cap * pct // 100 // cp.per_period * cp.per_period)
```

| `N` | `pct` | cap | War buffer | attack members |
|---|---|---|---|---|
| 49 | 100 | 5.0 CP | 40 s | 5 |
| 55 | 105 | 5.0 | 38 s | 5 |
| 59 | 109 | 5.0 | 36 s | 5 |
| 60 | 110 | 5.5 | 40 s | 5 |
| 80 | 127 | 6.0 | 37 s | 6 |
| 100 | 142 | 7.0 | 39 s | 7 |
| 111+ | 150 | 7.5 | 39 s | 7 |

- Unchanged up to 59 nodes (today's maps and the generator range); from 60 nodes it keeps the buffer at 36 to 40 s of
  War income and grows the synchronized attack with the map (5 to 7 members).
- **Trade-off:** a bigger burst (a player who saves up strikes harder, 7.5 orders at once at the clamp), and the
  rally of 16 groups (8 CP) stays out of reach, so `max_groups` still does not bind.
- **Recommendation: yes**, under a key such as `[map_tempo] scale_cp_cap = true`, in the same PR that lets maps above
  59 nodes into play (the generator range or the pool).

### 4.3 More CP per command (bundling), instead of a dearer order

- The group order (DEC-48) already pays 1 CP per member in one command (5 members: `c` = 5 for that command) and a
  rally 0.5 CP per group. Table A: at `c` = 1.5 War binds only for a ceiling under 8. If half of a human's moves go in
  group orders of 3, his moves average `c` = 1.5.
- **A multi-unit recruit:** `Recruit(node, count)`, `1 <= count <= recruit.queue_max - queue`, price
  `count * orders.cost.recruit`, the same queue. Recruits are 11 to 22% of the bots' useful commands, the one paid
  command no group order bundles. A protocol and command change, no new number.
- **Trade-off:** none in the economy (the price per unit is the same); the gain is attention. A multi-recruit adds a
  control to the city menu.
- **Recommendation: yes, measure first.** `scripts/apm_ceiling.py replays` gives `cp_commands / useful` for a human
  replay; if the owner's `c` stays near 1 on 50-node maps in playtests, add the multi-recruit and push the group order
  in the UI before maps above 56 nodes ship.

### 4.4 A dearer order (`orders.cost.move` with the tempo)

```
move_cost(N) = max(orders.cost.move, orders.cost.move * pct // 100 // 50 * 50)   # 1.5 CP at pct >= 150
```

- It cancels the CP tempo: CP a minute over the order cost becomes flat in `N`. The same effect is simpler as a CP
  clamp of its own, for example a `cp_max_pct = 105` that holds the CP at the 55-node rate (War 7.9 a minute) and
  leaves the charges on the full tempo.
- **Trade-off:** the front still grows like `sqrt(N)`, so on a 100-node map each front node gets about a quarter fewer orders;
  the charges keep their tempo and their surplus grows (section 3.3).
- **Recommendation: no** while bundling (4.3) is open; the CP clamp is the fallback if playtests on big maps show
  APM-bound play that bundling does not fix.

### 4.5 `factory.max` with the land

```
factory_max(N, P) = max(factory.max, factory.max * N * 2 // (P * ref_nodes))   # 2 players: 3 at 49 nodes, 7 at 120
```

- **Trade-off:** the charge income would grow like `N * sqrt(N)` (more factories, each faster), on top of a surplus
  that already burns 16% at 100 nodes; it also feeds the snowball the flat economy avoids (`mechanics.md`,
  section 6: income that grows with territory is the problem).
- **Recommendation: no.** Revisit only if a run on big maps shows idle discharged units per front node growing.

### 4.6 Keep as they are

- **Warehouses** (3 / 6 / 1): the burn on big maps is a surplus; bigger warehouses would hide it, not use it.
- **`group_order.max_groups`** (16): binds only from a cap of 8 CP; 4.2 stops at 7.5.
- **The server limit** (20 a second, burst 60): per connection, a hundred times the economy's rate at any `N` and `P`.

## 5. Rerun

```bash
# the thresholds, the chart and the proposal tables of a ruleset
mise exec -- uv run python scripts/scaling_thresholds.py thresholds --ruleset rulesets/mvp-7.toml
# the structure of maps (halves, cities, front, capital distance)
mise exec -- uv run python scripts/scaling_thresholds.py maps maps/*.json maps/gen/*.json
# a map of a fixed size: set gow_maps.generate.MIN_NODES = MAX_NODES = <N>, then generate(seed) (section 3.2)
# the bot run: maps outside the pool must be on a pushed ref (a throwaway branch), then
mise run tournament:gh --ref <branch> --bots "smart_rusher@hard smart_expander@hard smart_turtle@hard" \
  --maps "maps/narrows.json maps/crossroads.json maps/gen/gen1-58.json <big maps>" --seeds 3 --shards 18 --replays true
mise exec -- uv run python scripts/apm_ceiling.py replays <replays>/*/*.jsonl.gz --maps <dir with every map> > apm.jsonl
mise exec -- uv run python scripts/scaling_thresholds.py workload <replays>/*/*.jsonl.gz --maps <dir> > work.jsonl
```
