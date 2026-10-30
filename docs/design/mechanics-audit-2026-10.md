# Mechanics audit 2026-10

An audit of every mechanic of the current rules (`docs/design/mechanics.md`, the played ruleset
`rulesets/mvp-2.toml`, `SIM_VERSION` 25) against the match tempo, with data (#639). It describes what each
mechanic does in play and how well it works. **It proposes no redesign, no new mechanic and no ruleset change**: the
variants already written up live in DEC-39 (#625, supply to the front) and DEC-40 (#626, retreat), and the BAL-02
log (`docs/balance/log.md`) holds the numeric iterations.

## Data

| Id | Source | What it is | Caveat |
|---|---|---|---|
| H | the owner's four matches of 2026-10-30, re-simulated (`docs/balance/playtest-2026-10-30.md`; command journal by `mise run stats`) | human (side 1) against `smart_strangler@hard` (matches 1-2) and `smart_expander@hard` (3-4), `crossroads`, 4 wins (3 by the capital) | one player, one map, four matches: a description, not an estimate |
| T | `docs/balance/latest.jsonl`: seeds 0..9 of the `mvp-2` confirming run, 3000 matches | the 10 strategic bots (5 classic, 5 smart before #618), the 3 pool maps; per match command usage, captures, the charge ledger | the smart bots before the plan hold of #618 |
| F | run `audit-usage` on GitHub runners (appendix A) | the 5 smart bots at `hard` of develop `298a048` (with #618), `mvp-2`, 3 pool maps, 20 seeds | bots only |
| R | earlier reports: `docs/balance/charge-flow.md`, `log.md` (BAL-02 iterations, the plan diagnostic, H-map, H-strike), DEC-39, DEC-40 | cited where used | |

"Bots don't use it" (a property of bot code) is kept apart from "it does not pay" (a property of the rules). Where
only bot behaviour is measured the text says so.

## The yardstick: what a second and a CP are worth

All from `rulesets/mvp-2.toml` and the pool maps, unless marked H.

| Quantity | Value |
|---|---|
| Match | 900 s (9000 ticks), 30 VP awards (one per 30 s) |
| CP income | 1 CP per 5 s split by stance: War 7.2 CP + 9.6 charges a minute, Balance 6.0 + 12.0, Economy 4.8 + 14.4 |
| CP over a match (War, H) | 80-111 CP received, 74-107 spent; burned at the cap 0.2-3.0 CP |
| CP cap | 5 CP = 42 s of War income |
| An ordinary order | 1 CP = 8.3 s of War income; a scheduled one 2 CP |
| Capital to capital, units, level 1 roads | 45-59 s (448-590 ticks; `crossroads` 590) |
| Capital to capital, packets, level 1 | 52-62 s (522-624 ticks); level 2 on every road: 35-41 s |
| Capital to the median node, units | 28-33 s |
| A fight (H, 76 fights) | mean 4.8 s, 2.4 rounds; a round is 2 s |
| Front marker life (H) | median 67 s (human, 45 placements), 31 s (bot, 95) |

The match is about 15 map crossings long; anything whose payback takes longer than a front marker lives (about a
minute) competes with that horizon.

## Summary

| # | Mechanic | Verdict | Key number |
|---|---|---|---|
| 1 | CP economy (regeneration, cap, burn) | works | the one binding resource: 96-99.8% of the human's CP spent, 13-26% of ticks below 1 CP |
| 2 | Stances | does not work at the current tempo | human in War 99.7% of ticks and still 58-85% of its charges never fired |
| 3 | Charge production | works weakly | 11-28% of the human's charges fired in fights; bots 3% (T) |
| 4 | Supply network (automatic distribution) | works weakly | a capital packet takes 17-27 s (median) to arrive; a marker city empty 27-45% of marker ticks while the capital is full |
| 5 | Front markers | works weakly | the only supply lever the human used (6-12 moves a match); 22-35 charges a match reach marker cities |
| 6 | Rear minimum | does not work at the current tempo | 0 human uses; the capital spill already fills the rear (12-18 charges in rear warehouses) |
| 7 | Transfers | not enough data | 0 human uses; bots move charges back into a full capital |
| 8 | Cut-off and starvation | works weakly | 15-28 cut-off episodes a match, starvation took 3 human and 19 bot charges in four matches |
| 9 | Road upgrades | does not work at the current tempo | 8 levels in 4 matches (one late burst); bots 0 in H |
| 10 | Warehouse upgrades | does not work at the current tempo | 1 level in 4 matches; 36-69% of the charges burn for lack of room anyway |
| 11 | Barracks | works | the human's central barracks: 14-15 recruits each for 3 CP, never lost |
| 12 | Recruit queue | works | 99 recruits in H; the human queues 2-3, the bots 1 |
| 13 | Ordinary vs scheduled orders, plan bonus | works weakly | human 33% of its sieges planned, 14 captures in 17 plan fights, 0 units lost; bots 2 plans in H |
| 14 | "Defense" mode | not enough data | 6 uses in H, 2 fights while in the mode |
| 15 | Fights (rounds, reinforcements) | works | outcomes follow the pools: 51 of the bot's 75 losses with a pool 2+ below |
| 16 | Retreat | works weakly | 17 bot retreats save 21 of 26 units, 10 of the 17 groups die within 90 s |
| 17 | Bounce (and G3) | works | 23 bounces, 4 G3 deaths, all per the rules |
| 18 | Capture | works | 279 captures in H, 87% of them into empty nodes |
| 19 | Capture cost (DEC-38) | not enough data | off in `mvp-2` (`charge_cost = 0`); at 1 the bot field polarizes (BAL-02 iterations 2, 5) |
| 20 | Capacity, attrition and the stack limit | works | groups of 2-3 units (provinces cap 3); 1 `STACK_LIMIT` rejection, 14 attrition deaths in H |
| 21 | Auto-merge | works | 169 merges, 0 manual `Merge` |
| 22 | Provinces | works weakly | 43% of the captures; 38-57% of the human's standing units, up to 28% of them discharged |
| 23 | Terrain: defense | works | node fights taken: mountains 40%, forest 62%, plains 74% |
| 24 | Terrain: speed | not enough data | no measured decision; a mountain edge is 1.8x slower than a plains edge |
| 25 | Fog of war and vision levels | not enough data | no per-tick view analysis; the bot ignored a stack it saw exactly |
| 26 | VP and the capital win | works | bots: 87% of matches end on the timer (T); human: 3 of 4 by the capital |

---

## 1. CP economy (regeneration, cap, burn)

Rules: section 6, DEC-02; `cp.start = 300`, `cap = 500`, 100 per 50 ticks.

1. **Decision.** What to spend attention on: every move, plan, recruit, building and mode costs CP; the stance splits the
   flow into CP and charges.
2. **Time scale.** One order is 8.3 s of War income; the cap (5 CP) fills in 42 s. A match gives 80-111 CP (H).
3. **Use.** Everyone spends almost everything. H: the human spent 74-107 CP of 80-111, burned 0.2-3.0 CP at the cap
   (0.6-4.4% of the ticks at the cap), was below 1 CP 13-26% and below 2 CP 45-66% of the ticks. The bots were never at
   the cap and below 1 CP 39-60% of the ticks. Movement takes 63-93% of the spending of both sides.
4. **Pays off.** It is the constraint that decides: BAL-01 and BAL-02 iteration 0 ordered the bots by the CP share of
   their stance, and every lever that only priced charges (iterations 1, 6) moved nothing (R).
5. **Visibility.** The top bar shows the CP gauge, the number and a MAX mark at the cap (`hud/TopBar.svelte`); the
   stance menu shows "+CP per minute". Burned CP (`cp_burned`) is not shown as an event (`hud/eventText.ts`,
   `HIDDEN_EVENT_KINDS`); the MAX mark is the only sign.
6. **Depends on.** Stances (2), order prices (13, 14), recruits (12), buildings (9-11).
7. **Verdict: works.** It is the one resource that binds both sides all match.

## 2. Stances

Rules: section 6, DEC-02, DEC-09; `mvp-2` shares 60 / 50 / 40% of the quantum into charges, `charges_per_cp = 2`,
cooldown 10 s, free.

1. **Decision.** "Act or feed": trade CP for charges (marginally 1 CP for 2 charges) and back, as the war phase changes.
2. **Time scale.** A change works on the next quantum (5 s); the cooldown is 10 s. War against Balance: +1.2 CP and
   -2.4 charges a minute.
3. **Use.** H: the human switched to War at tick 14-19 and stayed (99.7-99.8% of the ticks, 1 change a match). The bot
   changed 14-27 times a match and spent 27-55% of the ticks in War. T: the classic bots hold one stance by design;
   the smart bots change 6-25 times a match.
4. **Pays off.** The charge side of the trade has no marginal value. H: in War, the stance with the fewest charges,
   the human still burned 36-54% of its production and ended every match with 41-57 charges (fired in fights: 15-47);
   58-85% of everything it had (start plus production) was burned or left at the end. The bot in Balance 45-73% of the
   ticks burned 55-69% and lost 6-13 CP a match against War (playtest report). T: win rates are ordered by the CP share
   of the stance (iteration 0); narrowing the shares to 60/50/40 (iteration 3) lowered the War bots by 10 points, and
   halving `charges_per_cp` (iteration 1) changed no win rate.
5. **Visibility.** The stance chip in the top bar (key Q) opens a radial menu with "+CP per minute" and "+charges per
   minute" for each stance (`hud/radial.ts`, `stanceRates`). What the charges then do is not visible: burning
   (`charges_overflow`) is a hidden event kind, so a player cannot see that a stance with more charges buys nothing.
6. **Depends on.** Charge production (3), storage (10), what consumes charges (fights 15, captures 19, starvation 8).
   With `capture.charge_cost = 0` the only consumers are fights and losses.
7. **Verdict: does not work at the current tempo.** Only War makes sense while the charges it gives up are burned
   anyway.

## 3. Charge production

Rules: section 6 and DEC-28 item 4.4: only the capital produces, from the stance share; a full capital spills into
marker cities, then rear cities; the rest burns.

1. **Decision.** None directly (it follows the stance); indirectly, how much storage to hold.
2. **Time scale.** 0.8-1.2 charges per 5 s; the capital warehouse (6) fills in 25-38 s.
3. **Use.** H: 103-144 charges produced by the human, 115-170 by the bot, plus 30 at the start (map stock and charged
   start units). T: 115-215 a match by bot.
4. **Pays off.** H: the human fired 15-47 charges a match in fights (11-28% of its start plus production), the bot
   16-30. T: the bots fire 1-10 a match (3% of everything they have), 61% burns, 17% is left at the end. Losses to
   enemy action (packets cut, warehouses captured) are as large as fights for the bots (charge-flow, finding 3).
5. **Visibility.** Production is not an event the player sees (`charges_produced` is hidden); the warehouse dots of
   the capital show the stock, the burn is invisible.
6. **Depends on.** Stances (2), supply (4), storage (10), consumers (15, 19).
7. **Verdict: works weakly.** It produces several times what the game consumes; the binding side is delivery and CP.

## 4. Supply network (automatic distribution, packets, dispatch, priority)

Rules: section 7, DEC-18 items 3, 5, 6, 8-10, DEC-28: a tree from the capital over own nodes; a packet goes straight
to the city with a deficit; dispatch once a second (`dispatch_ticks = 10`); delivery order: marker cities to full,
rear cities to `rear_min` from the far end, the rest stays in the capital; donors cover a deficit from the nearest
stock; a road carries 1 / 2 / 3 charges per dispatch by level; packet speed 100 / 150 / 200%.

1. **Decision.** Meant to be no decision: "roads carry charges" without micromanagement (section 13); the player
   steers it with markers (5), the rear minimum (6) and transfers (7).
2. **Time scale.** H: a capital packet arrives after a median 17-27 s; the human's marker cities are 4-8 hops,
   24-53 s of level 1 road from its capital. A marker lives a median 67 s, so a marker gets about 2-3 deliveries in
   its life.
3. **Use.** Automatic for everyone: the human's network sent 83-153 packets a match (delivered 83-140), the bot's 23-50
   (21-31 delivered; 4-22 lost on cut roads).
4. **Pays off.** It delivers, slowly. H: a marker city stood empty in 27-45% of the human's marker ticks and in
   every one of them the capital held charges; an empty marker city waited a median 9-21 s, up to 51 s, for the next
   charge. Of the charges delivered, 16-37% reached a marker city; the rest filled the rear (mean 12-18 charges in rear
   warehouses against 1.7-2.1 in marker cities). Doubling the level 1 throughput moved no bot win rate (iteration 6):
   the gap is travel time, not volume (DEC-39 data).
5. **Visibility.** The "Supply" layer (Tab) draws warehouse dots, flow arrows with volumes, packets in transit and the
   markers (DEC-28 item 8). Not shown: the travel time of a packet to a city, why a city is empty (latency, a full
   road, or no donor), and the burn. The rules of delivery (passes 4.1-4.4, donors, detours) are many and run once a
   second, so a player infers them from the arrows.
6. **Depends on.** Ownership (only own nodes carry), capture and cut-off (8), road levels (9), warehouses (10),
   provinces (no warehouse, 22), the capital as the single source (3).
7. **Verdict: works weakly.** The network moves the charges correctly (no rule contradiction was found, playtest
   report) but at a latency of about a third of a marker's life, and the player cannot see the latency.

## 5. Front markers

Rules: DEC-28 items 2, 4.1, 5: two markers, free; a marker city fills to full first; a lost marker city sends the
marker back toward the capital.

1. **Decision.** Where the front is: which two cities get charges first.
2. **Time scale.** Instant to set; the effect waits for the trip (item 4: 17-27 s median).
3. **Use.** H: the human moved markers 6-12 times a match (median life 67 s), the bot 10-30 (median 31 s). T: bots
   10-38 a match.
4. **Pays off.** H: 22-35 charges a match reached the human's marker cities (about 2 a minute), against 103-144
   produced. Whether more marker moves would have helped is not measurable from four matches.
5. **Visibility.** A flag with a number on the Supply layer, set from the city radial there (keys 1, 2). A marker
   that retreats by itself sends `front_set` with `reason = fallback`, which the feed hides (`HIDDEN_EVENT_KINDS`).
6. **Depends on.** Supply latency (4), warehouse size of the marker city (10: 1-2 charges at level 0).
7. **Verdict: works weakly.** The only supply lever the human used, and it is understood, but it buys a priority
   that the trip time then dilutes.

## 6. Rear minimum

Rules: DEC-28 item 3: cities without a marker keep `min(rear_min, warehouse)`; default 1, range 0..8, free.

1. **Decision.** How much stock the rear keeps against raids versus how much stays in the capital for the front.
2. **Time scale.** Instant; the effect is on the next dispatches.
3. **Use.** H: the human never changed it; the bot 1-3 times a match. T: the smart bots 3-9 a match, the classic bots 0.
4. **Pays off.** No measurable effect: the capital was full in 68-99% of the ticks (H), and a full capital spills
   into the rear by itself (DEC-28 item 4.4), so the rear held 12-18 charges whatever `rear_min` said. A rear city
   warehouse is 1-2 charges at level 0, so values above 2 change nothing in most cities (DEC-28, "Accumulation").
5. **Visibility.** A slider in the Supply banner (`[` and `]`); no feedback on what it changed.
6. **Depends on.** The capital spill (3), warehouse sizes (10).
7. **Verdict: does not work at the current tempo.** With a charge surplus the spill makes the setting redundant.

## 7. Transfers

Rules: DEC-18 items 6 and 10: a one-off shipment between own cities, free, in batches, sharing road throughput.

1. **Decision.** Move a stock now (for example into a threatened or a new front city).
2. **Time scale.** The path time plus one second per batch; volume capped by the free room of the target.
3. **Use.** H: the human never used it. The bot made 18 in four matches, most from a threatened city back into its
   capital, which was full. T: the smart bots 2-9 a match, the classic bots 0.
4. **Pays off.** Not measured: no human use, and the bot use is a bot choice into a full capital.
5. **Visibility.** Supply layer, city radial key 3, a dialog with a slider; the server returns the arrival time.
6. **Depends on.** Supply (4), warehouse room (10); the automation may send the charges back (DEC-28 example 7).
7. **Verdict: not enough data.**

## 8. Cut-off and starvation

Rules: section 9 (supplied territory), DEC-19: a city outside the supplied territory spends
`ceil(U / 3)` charges every 10 s after a 10 s grace; units do not die; packets on a lost road are lost.

1. **Decision.** For the attacker: cut a region off instead of storming it ("siege of attrition", section 4). For the
   defender: hold the connecting nodes.
2. **Time scale.** Starvation starts 10 s after the cut and costs about 1 charge per 3 units per 10 s.
3. **Use.** H: 15-28 cut-off episodes a match (both sides). One capture cut six bot cities off for 147 s.
4. **Pays off.** Starvation itself barely: the six-city pocket lost 8 charges in 147 s, one city stayed cut off for
   1061 ticks without a consumption (`U = 0`), and over four matches starvation took 3 human and 19 bot charges. The
   cut matters through what it takes on the way: the bot lost 4-22 charges in packets and 10-33 with captured
   warehouses a match. In the charge-flow run (`mvp-1`) packets lost took 1-21% of a bot's charges and captured warehouses 3-8%,
   starvation 3-8%.
5. **Visibility.** A dashed ring and a "starving in N s" pill on an own cut-off city; the starvation event in the feed.
   That a region is cut off is inferred from ownership; the reason (which node broke it) is not shown.
6. **Depends on.** Ownership of every node on the path, provinces as links (22), the charge surplus (3: a pocket
   that starves has little to lose because units are often discharged or absent).
7. **Verdict: works weakly.** Cutting is a strong move against supply; starvation as a pressure is small at the
   current numbers.

## 9. Road upgrades

Rules: DEC-28 item 7: an own internal road, 0.5 CP per level, 15 s, levels 2-3 give unit speed +15 / +30%, throughput
2 / 3, packet speed 150 / 200%; any number of constructions at once.

1. **Decision.** Invest CP in logistics behind the front instead of orders.
2. **Time scale.** 15 s to build. Gain on `crossroads`: the human's path Core to Crossroads (5 edges) drops from 330 to
   220 packet ticks with level 2 everywhere (2.5 CP, 15 s in parallel): 11 s saved on every charge, and units walk 13%
   faster. 2.5 CP is 21 s of War income, or 2.5 move orders. The front marker the road serves lives a median 67 s.
3. **Use.** H: the human bought 8 levels once, in the last 2.5 minutes of match 2 (4 CP); 0 in the other three. The
   bots bought 0 in H. T: classic `expander` 9.3 and `turtle` 7.3 a match, the smart bots 1.4-5.8, `rusher`,
   `reactive`, `strangler` 0.
4. **Pays off.** Not measured in play. On paper (item 2) a level 2 path pays back in latency within the first two
   deliveries, but its CP comes out of the binding budget (1). The bots that build the most roads (`expander` 0.24,
   `turtle` 0.08 win rate, T) lose, which mixes road building with a passive personality and proves nothing either way.
5. **Visibility.** A separate mode (key U) lights the upgradable roads; the tooltip shows "units +15%, supply +1",
   the price and the time (`hud/RoadTip.svelte`). It does not show the packet speed gain (the main effect on the
   measured gap) or the trip time to a city; the result is a thicker line. Without the mode a click on a road does
   nothing (DEC-28, #315).
6. **Depends on.** CP (1), supply latency (4), the front moving (a road behind a moving front serves the rear).
7. **Verdict: does not work at the current tempo.** Rarely bought; the gain is invisible and competes with orders for
   the binding CP.

## 10. Warehouse upgrades

Rules: DEC-26 items 2-3: +1 warehouse capacity per level, two levels, 2 CP and 10 s each; level 0 is 6 / 2 / 2 / 1.

1. **Decision.** Buy storage: a front buffer in a city that loses supply, or a bigger stock.
2. **Time scale.** 10 s to build; 2 CP is 17 s of War income.
3. **Use.** H: 1 level in four matches (the human, Crossroads); bots 0. T: classic `expander` 6.8, `turtle` 3.8, the
   smart bots 0.2-1.9 a match.
4. **Pays off.** Storage is not the shortage: 36-69% of the charges burn for lack of room (H). The one level held a
   third charge in 39% of the remaining ticks. A front city has 1-2 charges of buffer at level 0 and waits 9-21 s for
   refills (4), so the buffer gap is real but the upgrade adds one charge.
5. **Visibility.** A city radial sector with the price; the gain is not stated in the sector (the warehouse capacity
   is in the city tooltip).
6. **Depends on.** Production surplus (3), supply latency (4), capture (a captured warehouse is zeroed, the level stays).
7. **Verdict: does not work at the current tempo.** It buys the resource that is in surplus.

## 11. Barracks

Rules: DEC-26, section 3: only the capital recruits at the start; a barracks costs 3 CP and 10 s; it passes to the
capturer.

1. **Decision.** Move the unit source toward the front (saves the walk: 1 CP and 30-50 s per unit) at the risk of
   losing it.
2. **Time scale.** 10 s to build; the return comes with the first 3 forward recruits.
3. **Use.** H: the human built 3 (Crossroads in matches 3 and 4 at tick 1105-1118, Middle Court late in match 3); the
   bot built 3. T: the smart bots 0.2-0.9 a match.
4. **Pays off.** For the human clearly: each Crossroads barracks gave 14-15 recruits and was never lost (31 of the
   human's 41 recruits in H were forward). The bot's three gave 3 recruits; two were lost within 20 s of completion.
5. **Visibility.** City radial "Barracks"; an enemy barracks is visible next to an own node (DEC-31). Without a
   barracks the "Recruit" sector is absent.
6. **Depends on.** CP (1), the stability of the front (a lost barracks goes to the enemy), recruits (12).
7. **Verdict: works.** The best measured investment in H, when placed in a held central city.

## 12. Recruit queue

Rules: DEC-25: 1 CP per unit, 3 s each, a queue of 3 per city, the unit appears discharged.

1. **Decision.** Bodies against orders (both cost 1 CP), and where to produce them.
2. **Time scale.** 3 s per unit; a recruit then needs a charge from the warehouse (1 per tick).
3. **Use.** H: 99 recruits (human 44, bot 55); the human filled the queue to 2-3, the bot to 1; 3 cancels (bot).
   T: 0-23 a match by bot (the reactive bots never recruit).
4. **Pays off.** With `charge_cost = 0` bodies matter through fights and garrisons; the bots that recruit the most win
   the claim harder when captures cost a charge (iteration 5). In H the human ended with 15-32 units against 2-14.
5. **Visibility.** Queue slots and progress above an own city; the city radial with the count and the refund.
6. **Depends on.** Barracks (11), CP (1), capacity (`CITY_FULL`, 20).
7. **Verdict: works.**

## 13. Ordinary vs scheduled orders and the plan bonus

Rules: section 5, DEC-08, DEC-29: a plan costs 2 CP instead of 1, waits 3 s with a public intent, and gets one bonus
shot per edge of the path, capped by the group's charged units, for its first fight.

1. **Decision.** Pay a CP and reveal the intent for virtual shots that save charges in a fight.
2. **Time scale.** 3 s delay; the bonus burns in the first fight (a few seconds).
3. **Use.** H: the human planned 21 of its 64 siege orders (33%); 14 of its 43 ordinary sieges were sent with less
   than 2 CP. The bot planned 2 orders in four matches (below 2 CP 84-98% of the ticks). T: planned siege share 0.05-0.16
   by bot (0.084 overall); after #618 (the bots hold CP for a chosen plan) 0.35 (log.md).
4. **Pays off.** For the human: 17 fights with a plan bonus, 14 captures, 0 human units lost; the plan shots tipped the
   capital fights (4 and 8 plan shots in matches 3 and 4). For the bots it does not: forcing a plan on every siege of a
   garrison loses (0.39 against 0.49), forbidding it changes nothing (0.52), because defenders hold 0-1 charges in 86%
   of sieges and the surcharge is one claim of an empty node (plan diagnostic, R). A strike from 1-2 hops gets 1-2
   shots (H-strike).
5. **Visibility.** Shift+click; "◇ +N" on the head of the own plan ribbon (a forecast until departure); the enemy sees
   the intent; the bonus shots are drawn in the arena and the remaining reserve is visible in a fight (DEC-32).
6. **Depends on.** CP (1), charged targets (fights, 15; the claim race, 18), the path length (map), the cap by
   charged units (supply, 4).
7. **Verdict: works weakly.** Decisive for a player who can afford it against a garrison; CP-starved, and for the
   bots worse than an ordinary order.

## 14. "Defense" mode

Rules: DEC-08, DEC-30: 2 CP, public as an intent; +1 bonus shot per 6 s in the mode, capped by charged units; burns in
a fight; only for a defender of a node with a charge.

1. **Decision.** Pay for a prepared defense against a visible threat.
2. **Time scale.** +1 per 6 s: a 3-charge group reaches its cap in 18 s.
3. **Use.** H: the human switched it on 4 times (match 4, 8 CP; its groups then stood 1688 group-seconds in the mode)
   and was never attacked there; the bot 2 times, 2 fights. T: `turtle` 4.1, `smart_expander` 1.8, `smart_turtle`
   1.1 a match, the others about 0.
4. **Pays off.** Not measured: no fight with a human defender in Defense; two bot fights.
5. **Visibility.** A shield "+N / M" next to the own group, a tooltip with the rule; the enemy sees the mode only.
6. **Depends on.** CP (1), charged defenders (4), the attacker's plan (13).
7. **Verdict: not enough data.**

## 15. Fights (rounds, reinforcements)

Rules: DEC-07, DEC-24, DEC-32, DEC-37: one shot per side per 2 s round, virtual shots first; groups that arrive join;
no recharge in a fight; an engagement zone of 3 ticks catches a leaving defender.

1. **Decision.** When and with how much to engage; whether to reinforce or leave.
2. **Time scale.** A fight lasts about `charges + units` of the smaller side in rounds: a mean of 4.8 s (H), so a
   reinforcement must be at most a few seconds away.
3. **Use.** H: 76 fights in four matches (10-28 a match), 15 of them with reinforcements (21 joining groups). The
   human attacked 53 times (won 37), the bot 13 (won 0). T: the bots fire 1-10 charges a match.
4. **Pays off.** The outcomes follow the pools: the bot lost 51 of its 75 units in 32 fights it defended with a pool
   2+ below the attacker; the human lost 0 in its 32 fights 2+ above (playtest report). The capital strikes won by
   joining 2-4 groups into one fight before its first rounds.
5. **Visibility.** The arena with chips per unit, the bonus reserve on both sides, the round animation (DEC-32); the
   outcome is not estimated for the player (AGENTS.md 7.1).
6. **Depends on.** Charges at the front (4), plan and Defense bonuses (13, 14), terrain (23), retreat (16).
7. **Verdict: works.** The rule is legible in play; fights are few against captures (18).

## 16. Retreat

Rules: DEC-24 item E: a defender leaves by `Move` (1 CP), an attacker or an edge group by `CancelOrder` (free), after
the nearest round.

1. **Decision.** Cut a losing fight short at the price of one round.
2. **Time scale.** One round (2 s).
3. **Use.** H: 17 retreats, all by the bot (12 by cancel, 5 by `Move`); 11 of them single units.
4. **Pays off.** 21 of 26 units left alive, but with 2 charges; 10 of the 17 groups died within 90 s. The chase cost
   the human 7 CP (DEC-40 data). In the first round shots cancel 1:1, so a small charged group loses a charge, not a
   unit.
5. **Visibility.** No dedicated control: the ordinary order or cancel; the arena shows the group leaving.
6. **Depends on.** One shot per round (15), the engagement zone (DEC-37).
7. **Verdict: works weakly.** It works as written, and it is cheap; the owner's complaint and the variants are DEC-40
   (#626).

## 17. Bounce and the return without a chain (G3)

Rules: DEC-07 rule 4, DEC-24 items A2, G3: an attacker that does not take the node goes back along its track; a
returning group that cannot retake its lost origin dies.

1. **Decision.** None directly; it makes an equal attack safe and an encirclement lethal.
2. **Time scale.** As long as the group walked on the edge.
3. **Use.** H: 23 bounces (19 human, 4 bot), 4 G3 deaths (5 units).
4. **Pays off.** Every G3 case matched the rule (playtest report); one 4-unit human group died at its retaken origin
   after a failed strike.
5. **Visibility.** The group turns back on the map; the fight line in the feed. The G3 death reads as "dying at home"
   (playtest report, encirclement item 3).
6. **Depends on.** Captures behind the attacker (18), fights (15).
7. **Verdict: works.**

## 18. Capture

Rules: DEC-07 row 5, DEC-24 G1-G2, DEC-37, DEC-38 (off): an empty node is taken on arrival; a fight's winner takes
the node; the warehouse is zeroed on a change of owner.

1. **Decision.** Which nodes to claim for VP and for links, and in what order.
2. **Time scale.** One order (1 CP) and the walk (seconds); a city then earns VP every 30 s.
3. **Use.** H: 279 captures in four matches; 242 (87%) into empty nodes, 37 after a fight (all human). 121 of the 279
   were provinces. In matches 1-2, 70 of the bot's orders went into empty human nodes (recaptures back and forth).
   T: 87 captures a match.
4. **Pays off.** It decides the bot matches: 46-60 captures a match against few sieges, VP by the speed of claiming,
   and every charge lever failed because a free claim needs no charge (BAL-02 verdict, point 2).
5. **Visibility.** Ownership is public; the node changes colour and the feed reports captures.
6. **Depends on.** CP (1), VP (26), the capture cost (19), provinces (22).
7. **Verdict: works.** Correct and central; it is the activity the match is mostly made of.

## 19. Capture cost (DEC-38)

Rules: DEC-38: a capture spends `capture.charge_cost` real charges; `mvp-2` keeps 0.

1. **Decision.** (When on) bring a charge to claim: ties expansion to supply.
2. **Time scale.** Instant at the capture.
3. **Use.** None in `mvp-2`.
4. **Pays off.** Tested at 1 in BAL-02: with bots that ignore it (iteration 2) captures halved and fights fell; with
   bots that know it (iteration 5) the recruiting bots won harder (`smart_expander` 0.92) and the field polarized;
   defenders stood uncharged in 74-86% of sieges (charge-flow). Not kept.
5. **Visibility.** In the order tooltip and help when on; a toast for `capture_failed`.
6. **Depends on.** Supply to the front (4), recruits (12).
7. **Verdict: not enough data** for human play (off in the played ruleset).

## 20. Capacity, attrition and the stack limit

Rules: DEC-12, DEC-20 D, DEC-22: capacity by node kind (10 / 8 / 6 / 4 / 3); a garrison above it loses a unit per
3 s; a group only paths through nodes with capacity at least its size.

1. **Decision.** Group size against path choice; where to mass.
2. **Time scale.** Checked once at the order; attrition after 3 s above capacity (5 s grace after a capture).
3. **Use.** H: 1 `STACK_LIMIT` rejection, 14 attrition deaths (human 4, bot 10), 129 splits (human 43, bot 86). The
   human moved groups of 2-3 units (224 of 263 orders), the bot of 1-2 (233 of 255).
4. **Pays off.** It shapes the army silently: the provinces of capacity 3 keep marching groups at 2-3; a strike needs
   several groups to arrive together (H-strike: the fist was capped at the stage capacity 6-8).
5. **Visibility.** The reachable nodes and travel times come from the server (DEC-20 D5); a `STACK_LIMIT` hint
   suggests a split; an overcrowded city raises an alert with the time to the next loss.
6. **Depends on.** Provinces (22), auto-merge (21), the map.
7. **Verdict: works.**

## 21. Auto-merge

Rules: DEC-20 A: a group that finishes moving in an own node merges with the standing group.

1. **Decision.** None (it removes one).
2. **Time scale.** End of the tick.
3. **Use.** H: 169 automatic merges, 0 manual `Merge` commands.
4. **Pays off.** No complaint in the playtest; it keeps the number of groups low.
5. **Visibility.** Silent (`groups_merged` is hidden); a merge above capacity triggers the overcrowding alert.
6. **Depends on.** Capacity (20).
7. **Verdict: works.**

## 22. Provinces

Rules: DEC-23: a node without a city: no warehouse, no recharge, no recruit, no VP, capacity 3; it links supply.

1. **Decision.** Positional: which links to hold and where to stand.
2. **Time scale.** As a capture (18).
3. **Use.** The pool maps have 22-26 provinces of 49-51 nodes. H: 121 of 279 captures; the human kept 38-57% of its
   standing units in provinces.
4. **Pays off.** Mixed. They cut regions off when lost (8) and cap marching groups at 3 (20). They cost the holder:
   in matches 2-3, 26-28% of the human's province units were discharged (cities 6-23%), and the human gave 16 orders
   (16 CP) to walk discharged groups from a province to an own city (DEC-39 data: 83% of the discharged province time
   was next to an own city).
5. **Visibility.** A province is drawn without a warehouse; the no-recharge rule is not stated on the map.
6. **Depends on.** Supply (4), the stack limit (20), cut-off (8).
7. **Verdict: works weakly.** The link role works; holding a province costs CP and charges in a way the map does not
   show.

## 23. Terrain: defense

Rules: DEC-07 rule 1, DEC-24 F2: mountains +1 virtual shot, plains -1 real shot, only for a node defender with a charge.

1. **Decision.** Where to hold and where to attack.
2. **Time scale.** A fight.
3. **Use.** H: 65 node fights: 30 in mountains, 27 on plains, 8 in forest. Every capital of the pool is in the
   mountains.
4. **Pays off.** The attacker took 12 of 30 mountain nodes (40%), 5 of 8 forest (62%), 20 of 27 plains (74%). The
   mountain shot entered most mountain fights (26 virtual defender shots over the 30).
5. **Visibility.** The terrain map mode (key T) with a legend; the arena shows the virtual shot.
6. **Depends on.** Charged defenders (4).
7. **Verdict: works.**

## 24. Terrain: speed

Rules: section 4, "Speed by terrain by zones": plains 125%, forest 100%, mountains 70%, by the half of the edge.

1. **Decision.** Path choice (the server picks the fastest) and where to fight a race.
2. **Time scale.** An edge of 60 ticks takes 48 ticks on plains and 85 in mountains.
3. **Use.** Applied to every move; no player choice is recorded (the server chooses the path).
4. **Pays off.** Not separable in the data.
5. **Visibility.** The terrain mode; the travel time on hover comes from the server.
6. **Depends on.** Road levels (9), the map.
7. **Verdict: not enough data.**

## 25. Fog of war and vision levels

Rules: DEC-04, DEC-17, DEC-21, DEC-33, DEC-35: only own groups are vision sources; the level of a neighbour depends
on the terrain pair (exact, range, presence); plans and Defense are public intents.

1. **Decision.** Scout, read the enemy's numbers before committing.
2. **Time scale.** Continuous.
3. **Use.** Not measured per tick. In matches 3-4 the bot saw 6-8 charged human units in Middle Court exactly (Nexus in
   the mountains sees the plains exactly) and did not answer them.
4. **Pays off.** Not measured. The bot's failures are failures to act on what it saw (playtest report, bot weaknesses
   1-2), not failures to see.
5. **Visibility.** Ranges like "3-5" where the level is not exact; the terrain legend shows the table.
6. **Depends on.** Terrain (23), group positions.
7. **Verdict: not enough data.**

## 26. VP and the capital win

Rules: section 11, DEC-03: VP every 30 s for each own city (capital x3); the enemy capital is an instant win.

1. **Decision.** Claim for points against strike for the capital.
2. **Time scale.** 30 awards; a city taken in minute 3 earns 24 awards.
3. **Use.** H: 3 of 4 matches ended by the capital (ticks 6466-7225); the human trailed on VP at 5 minutes in 3 of 4
   and at 10 minutes in match 3, which it then won by the capital. T: 87% of bot matches end on the timer, 10% by the
   capital.
4. **Pays off.** For bots the timer and the claim race decide (18); for the human the capital strike did, prepared from
   a staging city next to the bot capital (playtest report).
5. **Visibility.** The score and a tug bar in the top bar; the `vp_awarded` event is hidden as redundant.
6. **Depends on.** Captures (18), fights (15), the stack limit (20).
7. **Verdict: works.**

---

## Cross-cutting findings

1. **CP binds everywhere; charges are in surplus at the source and short at the front only by latency.** The
   orchestrator's reading is confirmed with one correction. CP: the human spent 96-99.8% of what it got, the bot never
   reached the cap. Charges: the human burned 36-54% in War and ended with 41-57; the stock sat in the capital (5.7-6
   of 6) and the rear (12-18), against 1.7-2.1 in the marker cities. "Scarce at the front" is a matter of time, not of
   quantity: a marker city was empty in 27-45% of its ticks while the capital was full in every one of them.
2. **Every investment competes with movement for the same CP, at a price comparable to an order.** A road level
   (0.5 CP), a warehouse level (2), a barracks (3), Defense (2), a plan surcharge (1) are each 0.5-3 orders; movement
   already takes 63-93% of the budget. The only investment that paid back measurably (the forward barracks) is the one
   that saves movement CP.
3. **The match is mostly a claim race of empty nodes.** 87% of the captures in H and the BAL-02 field took nodes
   without a fight; with `capture.charge_cost = 0` a claim needs no charge, so the charge side of the economy (stances,
   warehouses, rear minimum, roads for supply) has few consumers.
4. **Time scales do not line up.** A front marker lives about a minute; a charge needs 17-27 s to reach it; a road
   level takes 15 s to build and pays back over several deliveries; a fight lasts 5 s. Mechanics with a payback beyond
   a minute (roads, warehouses) serve a front that has moved by then.
5. **The economy's feedback is hidden.** The burn of charges (`charges_overflow`), the burn of CP, production, the
   packet trip time and the reason a city is empty are not shown; a player sees warehouse dots and arrows. The "one
   phrase test" (section 13) holds for the rules, but the player cannot observe the surplus that makes a stance choice
   moot.
6. **Bot code hides part of the picture.** The bots do not answer visible stacks, claim with 1-unit groups, flip
   stances 14-27 times and build few barracks (playtest report, bot weaknesses); these are bot findings. The plan
   diagnostic is the one place where bot code was varied and the rule itself was found not to pay.

## Open questions the data cannot answer

1. Would a human use roads, warehouses, the rear minimum and transfers if their effect were visible? H has one player
   and none of these was shown in effect; only a playtest can tell.
2. Do the stance results hold against a human who fights more? The human fired 11-28% of its charges against the
   bots' 3%; a stronger opponent may consume more.
3. How do the mechanics behave on the other pool maps (`highway`, `ridge`) with human players? H is `crossroads` only.
4. Does "Defense" pay off? There is no human-defended fight in the mode.
5. Does terrain speed or vision change decisions? Neither is separable without per-tick view analysis or a controlled
   experiment.
6. Which part of the supply latency is the map (distance from the capital) and which the rules (one source, packet
   speed)? H-map changed size and provinces together; the two cannot be separated from the existing runs.
7. With a charge consumer on captures (DEC-38 on), would the charge surplus disappear for humans as it does for the
   recruiting bots? Not playtested.

## Appendix A: current smart bots, command usage per player and match (run F)

Run `audit-usage` (GitHub run 41121023646): the 5 smart bots at `hard`, develop `298a048` (with the plan hold of
#618), `mvp-2`, `crossroads`, `highway`, `ridge`, seeds 0..19, both sides: 1500 matches, 600 player slots per bot. Mean
per player and match; win rate against all 5 (mirrors included).

| bot | Move | planned | Cancel | Split | SetMode | SetStance | Recruit | Barracks | Warehouse | Road | SetFront | RearMin | Transfer | captures | charges fired | burned | win |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| smart_expander | 67.2 | 2.1 | 9.9 | 17.9 | 1.6 | 11.8 | 11.4 | 0.42 | 1.62 | 2.45 | 26.2 | 7.8 | 6.7 | 49.2 | 8.1 | 108.9 | 0.65 |
| smart_reactive | 68.2 | 2.5 | 5.6 | 6.4 | 1.4 | 13.6 | 0.4 | 0.55 | 0.14 | 3.46 | 31.5 | 7.3 | 8.0 | 58.7 | 5.8 | 124.5 | 0.47 |
| smart_rusher | 69.7 | 8.0 | 12.6 | 7.7 | 0.0 | 6.8 | 3.6 | 0.17 | 0.27 | 0.65 | 28.4 | 10.2 | 9.7 | 54.9 | 9.7 | 68.5 | 0.64 |
| smart_strangler | 70.1 | 4.5 | 9.9 | 7.9 | 0.1 | 10.5 | 3.0 | 0.34 | 0.92 | 2.04 | 29.4 | 7.3 | 7.3 | 57.9 | 7.6 | 116.3 | 0.63 |
| smart_turtle | 39.1 | 1.3 | 3.0 | 16.7 | 1.8 | 25.8 | 23.4 | 0.93 | 1.80 | 3.50 | 11.8 | 2.7 | 1.9 | 17.6 | 3.3 | 161.1 | 0.10 |

Over all slots: 3.4% of the bots' charges (start plus production) are fired in fights, 58% burn, 16% are left at the
end; 90% of the matches end on the timer, 9% by the capital. The current bots buy 0.7-3.5 road levels, 0.1-1.8
warehouse levels and 0.2-0.9 barracks a match, and "Defense" 0-1.8 times: the same picture as T (sections 9-11, 14),
so the bot finding does not depend on the #618 change.

## Reproduction

H: the owner's replays (`data/replays/` on the server) and `mise run stats -- <files>`; the per-tick tallies come
from a `MatchObserver` passed to `gow_sim.replay.replay_match` (as in the playtest report; scratch scripts, not in
the repository). T: `docs/balance/latest.jsonl` (the `usage` and ledger fields). F: `mise run tournament:gh --ref
298a048 --bots "smart_rusher smart_expander smart_strangler smart_reactive smart_turtle" --seeds 20 --shards 10`.
