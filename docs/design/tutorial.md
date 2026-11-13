# How to play: the tutorial round (#806)

**Status.** The structure (five main chapters, the first match, an optional Advanced side road) and the look are the
owner's decisions of 2026-11-13 **[accepted]** (section 1). The defaults of section 9 are in force until the owner
changes them. No game code exists yet; section 7 is the plan for it. The mockup is
[`mockups/tutorial.html`](mockups/tutorial.html) (the chosen variants only).

The tutorial teaches the main ruleset `rulesets/mvp-7.toml`. Every rule below is checked against
[`mechanics.md`](mechanics.md) (DEC numbers in the tables), every chapter script was played on the real simulation
(`gow_sim`, `mvp-7`, map tempo included) and its outcome is written next to it with its ticks (section 4, "Verified").
No rule is added or changed: the tutorial needs no DEC and no `SIM_VERSION`.

Contents: 1 the owner's decisions; 2 what is taught and where; 3 the screens and the flow; 4 the chapters; 5 the hints
of the first match; 6 the rules reference; 7 the technical plan; 8 the look; 9 open questions.

---

## 1. The owner's decisions [accepted]

**Round 1 (2026-11-13), kept.** The opponent of a chapter is scripted (an exact command sequence, the lesson is always
the same), the first match is against `@easy`. A new guest's first "Play" starts the tutorial, with a visible "Skip";
it is reachable later from the menu. Completed chapters are kept in the browser; any chapter can be replayed. The old
How to play text page becomes a short rules reference whose numbers come from `ruleset_public`; `regen:howto` and the
v1 text go away when the tutorial lands. The combat rules card of #766 was closed into this issue (2026-11-09): its
rows are covered by chapters IV and V and the reference.

**Round 2 (2026-11-13), replaces the three chapters of round 1.**

1. **Five main chapters**, then the first match against `@easy`, plus an optional **Advanced** side road:
   - **I. Units and movement:** what a unit and a group look like, the charges on the helmet as shots, moving,
     cancelling a move, capturing a neutral place for a charge, the room of a place, vision by terrain; one line that
     terrain helps or hurts in a fight, with a pointer to chapter V.
   - **II. Map and economy:** CP and what they buy, the capital's charges, the supply flow carrying charges to the front
     by itself, warehouses (where supply is stored), units filling up from supply, the symbols for all of it, a cut-off
     pocket and its starvation.
   - **III. Building:** barracks and factories, paying a building with the units' own charges (progressive payment,
     DEC-41 item 7), recruiting, and the stances (Economy, Balance, War) as the throttle of the economy.
   - **IV. Attack and fight:** planned orders and their bonus (visible to the enemy), how hits count (shots, rounds),
     the whole fight, no retreat, the capture price, and how to win (VP, the capital, the match clock).
   - **V. Defence:** terrain bonuses and penalties (DEC-45: plains bad for the defender, mountains good), road
     fortifications, answering a visible planned strike.
   - **Advanced (optional):** "Advanced movement: group orders" (DEC-48 `GroupMove`), then "Advanced recruiting: rally
     points" (DEC-48 `SetRallyPoint`).
2. **Each chapter is 1 to 2 minutes with one clear goal** (several beats allowed). "Skip" is on every screen, and the
   player may go to the first match after any chapter.
3. **The first match** keeps its hints, shrunk to what the chapters do not cover (section 5).
4. **The look** (mockup round 1): hint card **Leader**, goal mark **Compass**, chapter intro **Sheet**, chapter result
   **Seal**, chapter select **Road**, hint of the first match **Leader** (section 8).

---

## 2. What is taught, and where

The list is the main ruleset `mvp-7` as of 2026-11-13. "Field" is where the number on screen comes from: a
`ruleset_public` field of the match (the rules the match plays, map tempo applied, `gow_server.ws` sends
`RulesetPublic.from_ruleset(match.rules)`), or a field of the player's own view. Numbers are never typed into a string
(`AGENTS.md` 7.1).

| # | Rule (as the player meets it) | Source | Where | Field |
|---|---|---|---|---|
| R1 | A unit is charged or empty; a charge is one shot; the helmet shows the units, the dots its charges | mechanics 3; DEC-07 | I | none |
| R2 | An order costs CP; cancelling a move is free, the group turns back on its road, the CP stay spent | DEC-02; DEC-20 item C | I | `cost.move`, `cost.cancel` |
| R3 | Taking a place costs a charge; without one the group turns back | DEC-38 | I (IV) | `capture.charge_cost` |
| R4 | A place holds only so many units (its ring); a bigger group splits off the part that fits | DEC-20 item D; DEC-22 | I | `NodeView.capacity` |
| R5 | You see only the places next to your groups; open ground exactly, a forest as a range, mountains least | DEC-21; DEC-35 | I | `vision.by_terrain` (no number in the text) |
| R6 | CP come back at a flat rate up to a cap; they pay for orders, recruits and road forts | DEC-02; DEC-44 | II | `cp.per_period`, `stances.cp_period_ticks`, `cp.cap` |
| R7 | The capital makes charges; the flow carries them toward the front by itself; each place stores them in its warehouse; units standing there fill up from it | DEC-41 items 2, 9, 13; DEC-43 items A, C; DEC-50 | II | `stances.capital_period_ticks`, `city_upgrades.warehouse_province`, `NodeView.warehouse_cap` |
| R8 | A pocket cut off from the capital gets no supply; without a factory its units starve after a grace | DEC-43 item H; DEC-19 | II | `starvation.*` (new in `ruleset_public`, section 7.9); `NodeView.starve_in` |
| R9 | A factory: paid in charges, first from the warehouse, then by the units standing there; works after a build time; makes charges like the capital | DEC-41 items 2, 7; DEC-47 | III | `factory.cost`, `factory.build_ticks`, `stances.capital_period_ticks` |
| R10 | A barracks: paid the same way, then the city recruits for CP; a recruit appears empty and fills up | DEC-26; DEC-41 item 7; DEC-25 | III | `city_upgrades.barracks_charges`, `city_upgrades.barracks_ticks`, `cost.recruit`, `recruit.unit_ticks` |
| R11 | Stances: Economy more charges and fewer CP, War the other way, Balance between; free, the progress is kept | DEC-44; DEC-47 | III | `stances.*` |
| R12 | A planned order costs as much as an ordinary one, waits and gathers +1 bonus per warehouse charge at a fixed pace, then sets off; the enemy sees where, never its size or bonus | DEC-41 item 10; DEC-48; mechanics 5; `AGENTS.md` 4.4 | IV | `cost.planned_move`, `orders.plan_ticks_per_bonus` |
| R13 | A fight runs in rounds; each side fires one shot a round, bonus shots first; shots cancel each other; a shot that meets none kills a unit, empty ones first | DEC-07 rules 1 to 3; DEC-24 items B, F1; DEC-32 | IV | `combat.round_ticks`, `combat.shots_per_round` |
| R14 | No retreat: a group in a fight stays until it ends; groups that arrive join it | DEC-40; DEC-24 item D | IV | `combat.retreat` |
| R15 | Winning: the enemy capital wins at once; otherwise every 30 s each city gives VP and more VP wins when the clock runs out | DEC-03 | IV | `victory.vp_period_ticks`, `match_ticks`; `View.vp_gain` |
| R16 | Terrain helps or hurts only the defender of a place that has a charged unit: mountains a bonus shot, plains burn a charge at the first round, forest nothing | DEC-07 rule 1; DEC-45 | V (one line in I) | `combat.terrain_defense_mod` |
| R17 | A road fort costs CP, works after a build time, and takes a charge per started 3 units from an enemy crossing it towards its place; a capture destroys it | DEC-43 item D | V | `fort.cost`, `fort.build_ticks`, `fort.toll_units`, `fort.toll_charges` |
| R18 | A group order: several groups, one order; to an enemy place they arrive in one tick (full price), to an own place they rally (half price) | DEC-48 items A to E | Advanced 1 | `cost.move`, `group_order.rally_pct` |
| R19 | A rally point: the new units of a city with a barracks walk to an own place by themselves, for half a CP each when they leave | DEC-48 item H | Advanced 2 | `recruit.rally_cost` |
| R20 | Over its room a place loses a unit at a fixed pace | DEC-12 | First-match hint H2 | `capacity.attrition_ticks`; `NodeView.attrition_in` |
| R21 | Bigger maps are faster: the economy periods scale with the node count | DEC-46 | First-match hint H1 | the periods of `stances.*` of that match |

Left to the rules reference only: the engagement zone (DEC-37), the factory limit (`factory.max`, the client already
answers a fourth factory with its alert), enemy buildings seen from a neighbouring place (DEC-31).

---

## 3. The screens and the flow

```
first "Play" of a new guest ─┐                  ┌─ Skip ──────────────> the action the player chose (queue, bot, invite)
"?" > Tutorial (any time) ───┴─> Intro I (Sheet) ┤
                                                 └─ Start ─> I ─> Seal ─> Intro II ─> II ─> ... ─> V ─> Seal
                                                                  │                                    │
                         "Play your first match" (on every Seal and on the Road) <─────────────────────┘
                                                                  │
                         Advanced side road (Road select): A1 Group orders ─> A2 Rally points (optional, any time)
```

| Screen | What is on it | Comes from | Goes to |
|---|---|---|---|
| **Chapter intro (Sheet)** | "Tutorial · Chapter N of V" (Advanced: "Advanced · 1 of 2"), the name, one sentence, the goal list, a crop of the chapter map with the goals ringed, Start; "Skip the tutorial" (the first entry) or "All chapters" | the first Play of a new guest; the Road; a Seal | the chapter, the action the player chose (Skip), the Road |
| **Chapter** | the match screen as in a real match, plus the hint card (Leader) and the goal mark (Compass); no start banner (beat 1 takes its place); the exit button reads "Leave the chapter" | intro | Seal, or the Road (leave) |
| **Result (Seal)** | a stone window over the chapter's last moment: the seal, "Complete", the three lessons, the next chapter (primary), "Play your first match" and "Replay chapter" | the goal of the chapter | next intro, the first match, the chapter again |
| **Chapter select (Road)** | the main road I to V ending at the enemy capital (the first match, always open), the Advanced side road branching off after V with its two places, done marks, a plinth with the selected place and Start; "Rules" | "?" on the main screen; "All chapters" | any intro, the first match, the rules reference |
| **First match** | a normal bot match (`@easy`, `narrows`) with the hints of section 5 | a Seal, the Road | the normal result screen |
| **Rules reference** | one page of short rules with live numbers (section 6) | the Road | back |

**Entry.** `sbf.tutorial` (section 7.8) absent and the player is a guest (default, Q3): the first press of the main
button (Search, Start or Get the link) opens the intro of chapter I instead; "Skip the tutorial" sets `skipped` and
runs the action that was pressed. The New here dialog of #919 (`app/NewHereDialog.svelte`, off today) is not needed: its
job is the intro. An account that already played a match never gets the forced entry.

**Skip everywhere.** The intro has "Skip the tutorial"; a chapter has "Leave the chapter" (exit dialog: "Leave the
chapter", "Keep playing"; leaving goes to the Road, nothing is lost: a chapter always restarts from its start); a Seal
and the Road both offer "Play your first match". Replaying a chapter is a fresh match every time.

**After any chapter.** The Seal's primary button is the next main chapter (after V: "Play your first match"); "Play
your first match" is there after every chapter, and the Road keeps the first match open from the start. After the
first match the tutorial counts as finished (`firstMatch: true`); the Advanced road stays on the Road.

---

## 4. The chapters

Common to all seven:

- **Ruleset** `mvp-7` unchanged, with its map tempo. The chapter maps have 6 to 9 nodes, so the clamp `min_pct = 50`
  doubles the economy periods: the capital (and every factory) makes a charge per 40 s in Balance (20 s Economy, 80 s
  War), CP come 0.5 per 10 s in Balance (20 s Economy, 8 s War). The texts read these numbers from `ruleset_public`, so
  they say what the chapter plays; the first match plays its own (hint H1). No chapter waits for production: the
  capital starts with its warehouse full, and every script below was timed with these numbers.
- **The player is player 0**, the scripted opponent player 1 (the map's `capital_of` decides it). CP start 3
  (`cp.start`), Balance (`economy.start_stance`).
- **Every text is a draft** for `t()` (keys `tutorial.<chapter>.<beat>`), English only (`AGENTS.md` 7.4); numbers in
  braces come from section 2's fields, key names from the player's bindings (`keyLabel`), never typed in.
- A **beat** is one hint card: it shows when its trigger fires and stays until the next beat's trigger. Triggers are
  facts the player's own client already receives (section 7.5): an event, the `ack` of the player's own command, a
  field of the player's view, a UI action of the player (a selection), or a delay after the previous beat. The goal
  mark follows the beat.
- **Failure never ends a chapter.** Every failure the script can produce has a beat that says why and what to do;
  the goal stays the same. Leaving and Replay are always there.
- **The map world** is 1200 x 700 world units (a 16:10 window). The maps live in `maps/tutorial/` (section 7.2); the
  drafts are in the tables, and the roads take `travel_ticks` from their length (`round(length * 30 / 100)`), every
  border point at 500.
- **Verified** lines give the ticks of the real simulation (10 ticks = 1 s) for the commands named there. Tick 30 is
  where the start banner of a normal match ends; a chapter has no banner, so the first command can come at once.

### 4.1 Chapter I: Units and movement (about 1 minute)

**Goal:** take Ashford, Elmstead and Fordham.

**Map `tut-move`** (9 nodes; units/charged; stock is the warehouse at the start):

| Node | x, y | Terrain | Kind | Owner | Units | Stock |
|---|---|---|---|---|---|---|
| Highhold | 190, 350 | mountains | capital | you | 4/4 | 6 |
| Ashford | 370, 270 | plains | province | none | | |
| Elmstead | 540, 160 | forest | small city | none | | |
| Fordham | 560, 410 | plains | medium city | none | | |
| Reedwick | 360, 520 | forest | province | none | | |
| Kestrel | 780, 290 | plains | small city | enemy | 2/2 | |
| Thornby | 760, 540 | forest | province | none | | |
| Brackenfold | 760, 90 | mountains | small city | enemy | 1/1 | |
| Stormcrown | 1010, 330 | mountains | capital | enemy | 3/3 | 6 |

Roads (travel ticks): Highhold-Ashford 59, Highhold-Reedwick 72, Ashford-Elmstead 61, Ashford-Fordham 71,
Reedwick-Fordham 68, Elmstead-Kestrel 82, Fordham-Kestrel 75, Fordham-Thornby 72, Elmstead-Brackenfold 69,
Kestrel-Stormcrown 70, Thornby-Stormcrown 98, Brackenfold-Stormcrown 104.

The army is 4 on purpose: Ashford is a province that holds 3, so the first order shows the room of a place and the
client's split ("click to split off 3 and send them", `split.tipClick`). Kestrel (plains) and Brackenfold (mountains)
are the two enemy towns the player sees from Elmstead (forest): one as a range, one as "an enemy is there".

| Beat | Trigger | The card says (draft) | Mark |
|---|---|---|---|
| 1.1 | chapter start | "This is your army: 4 units. The filled dots are charges, and each charge is one shot. Click the helmet to select it." | the group in Highhold |
| 1.2 | the group is selected (UI) | "Click Ashford to march there. An order costs {move} CP." | Ashford |
| 1.3 | the `ack` of the order (a split and a move) | "Ashford is a province: it holds only {Ashford.capacity}. Three went, one stayed. The ring of a place shows its room." | Ashford's ring |
| 1.4 | `node_captured` Ashford by you | "Ashford is yours. Taking a place costs {capture} charge: one dot went empty. Now march on to Elmstead." | Elmstead |
| 1.5 | the `ack` of an order of that group | "Changed your mind? {cancel} turns a marching group back, free; the order's CP stay spent. Try it, then send it again." | the group |
| 1.6 | `node_captured` Elmstead by you | "Your groups are your eyes: you see only the places next to them. From this forest Kestrel shows a range, Brackenfold only that someone is there. Open ground is seen best." | Kestrel |
| 1.7 | 6 s after 1.6 | "Ground also sets the pace (plains fast, mountains slow) and helps or hurts in a fight: chapter V. Last: take Fordham." | Fordham |
| 1.F | `capture_failed` by you | "No charge, no capture: the group turned back. Let it fill up, then try again." | the group |
| done | Ashford, Elmstead and Fordham are yours (`NodeView.owner` of each) | Seal | |

**Opponent script:** none (its towns stand still).

**Verified** (`mvp-7`): the split at tick 20 and the order at 21: Ashford taken at 85 (the group 3/2, full again by
150 from the flow). The order to Elmstead at 150, cancelled at 175: the group is back in Ashford at 199
(`group_arrived`, `back`); sent again at 230: Elmstead at 283. From Elmstead the view shows Kestrel at `range` and
Brackenfold at `presence`; from Fordham Kestrel is `exact`. Fordham (ordered at 380) at 489. Without the cancel:
Elmstead at 203. Failure: the remaining 1/1 of Highhold to Reedwick at 30 (taken at 116, the group 1/0), sent on to
Fordham at once: `capture_failed` (bounce) at 177, back in Reedwick at 238, beat 1.F.

### 4.2 Chapter II: Map and economy (about 1 minute)

**Goal:** keep Westmarch supplied: Coldwell must be yours after the enemy's raid.

**Map `tut-supply`** (7 nodes):

| Node | x, y | Terrain | Kind | Owner | Units | Stock |
|---|---|---|---|---|---|---|
| Highhold | 170, 360 | mountains | capital | you | | 6 |
| Millbrook | 380, 500 | forest | medium city | you | 2/2 | |
| Coldwell | 520, 320 | plains | province | you | | |
| Westmarch | 660, 150 | forest | small city | you | 3/0 | |
| Ridgeway | 790, 420 | plains | small city | enemy | 1/1 | |
| Brackenfold | 900, 150 | mountains | province | enemy | | |
| Stormcrown | 1040, 330 | mountains | capital | enemy | 2/2 | 6 |

Roads (travel ticks): Highhold-Millbrook 76, Highhold-Coldwell 106, Millbrook-Coldwell 68, Coldwell-Westmarch 66,
Coldwell-Ridgeway 86, Millbrook-Ridgeway 125, Westmarch-Brackenfold 72, Ridgeway-Stormcrown 80,
Brackenfold-Stormcrown 68.

Westmarch starts with 3 empty units, so the player watches the flow fill them. Its only road home runs through
Coldwell, so a raid on Coldwell cuts it off.

| Beat | Trigger | The card says (draft) | Mark |
|---|---|---|---|
| 2.1 | chapter start | "CP pay for orders, recruits and road forts. They come back by themselves: {cp} CP every {cp_period} s, up to {cap}." | the CP gauge |
| 2.2 | 5 s after 2.1, or the first own `packet_sent` | "Your capital makes a charge every {capital_period} s and keeps them in its warehouse. The flow carries them toward the front by itself: watch the roads." | the road Highhold-Coldwell |
| 2.3 | the first own `packet_delivered` at Westmarch | "Each place stores charges in its warehouse: Westmarch {Westmarch.warehouse_cap}, a province {province}. Units standing there fill up from it: watch their dots." | Westmarch's dots |
| 2.4 | `node_captured` Coldwell by the enemy | "The enemy took Coldwell. Westmarch is cut off: no supply reaches a pocket, and {grace} s later its units start to lose {charges} charge per {per_units} units every {period} s. Take Coldwell back." | Westmarch, Coldwell |
| 2.5 | the first own `starvation` at Westmarch | "Westmarch is starving: it lost a charge. Retake Coldwell to reconnect it." | Coldwell |
| 2.B | `fight_ended` at Coldwell, winner you (the raid met a group there) | "You held Coldwell: Westmarch stays connected. Had it fallen, Westmarch would be a pocket and starve." | Westmarch |
| done | `node_captured` Coldwell by you after 2.4, or 2.B | Seal | |

**Opponent script:** at tick 200 the group of Ridgeway to Coldwell (an ordinary order); when Coldwell becomes its own,
that group goes back to Ridgeway (a step with a `when`, section 7.4).

**Verified** (`mvp-7`): the first packets leave Highhold at tick 10; the first one for Westmarch leaves Coldwell at 80,
and its group is 3/2 at 199 and 3/3 by 300. The raid captures Coldwell at 267 and leaves at 268: Westmarch is a pocket at 279
(`flow_pocket = true`, `starve_in = 88`). A player who sends the group of Millbrook 10 ticks after the cut retakes
Coldwell at 338, before any loss; 40 ticks after: `starvation` at Westmarch at 367 (`units = 1`), Coldwell retaken at
368; 140 ticks after: `starvation` at 367 and 467, Coldwell retaken at 468, the pocket gone at once
(`flow_pocket = false`). A player who stands the group of Millbrook in Coldwell before the raid (ordered at 100): the
raid fights it at 267 and loses at 287 (`winner = 0`), beat 2.B.

### 4.3 Chapter III: Building (about 1 minute)

**Goal:** build a factory in Millbrook and a barracks in Fernhill, recruit a unit, and switch to Economy.

**Map `tut-build`** (7 nodes):

| Node | x, y | Terrain | Kind | Owner | Units | Stock |
|---|---|---|---|---|---|---|
| Highhold | 170, 350 | mountains | capital | you | | 6 |
| Millbrook | 420, 220 | forest | medium city | you | 3/3 | |
| Fernhill | 430, 500 | plains | small city | you | 2/2 | |
| Wyre | 650, 140 | plains | province | none | | |
| Lowfield | 670, 560 | forest | province | none | | |
| Ashwood | 820, 350 | forest | small city | enemy | 1/1 | |
| Stormcrown | 1040, 350 | mountains | capital | enemy | 1/1 | 6 |

Roads (travel ticks): Highhold-Millbrook 85, Highhold-Fernhill 90, Millbrook-Fernhill 84, Millbrook-Wyre 73,
Fernhill-Lowfield 74, Wyre-Ashwood 81, Lowfield-Ashwood 77, Ashwood-Stormcrown 66, Wyre-Stormcrown 133.

The warehouses of Millbrook and Fernhill start empty (only a capital keeps its stock, DEC-41 item 9), so both
buildings are paid by the units standing there first: that is the lesson of progressive payment.

| Beat | Trigger | The card says (draft) | Mark |
|---|---|---|---|
| 3.1 | chapter start | "More factories, more charges. Open Millbrook's menu and build a factory: {factory_cost} charges." | Millbrook |
| 3.2 | the first own `build_paid` with `units > 0` | "Millbrook's warehouse was empty, so the units standing there paid: their dots went empty. The flow brings the rest and refills them." | Millbrook's dots |
| 3.3 | `build_paid` with `owed = 0` | "Paid. The factory works in {factory_build} s. Meanwhile, a barracks in Fernhill: {barracks} charges, paid the same way." | Fernhill |
| 3.4 | `factory_built` | "A factory makes a charge every {capital_period} s, like your capital." | Millbrook |
| 3.5 | `barracks_built` | "Fernhill can recruit now: {recruit_key}, {recruit_cost} CP a unit, ready in {unit} s. A recruit comes empty and fills up." | Fernhill |
| 3.6 | `recruited` | "Stances set the pace. Economy: charges every {eco_capital} s, CP slower. War: CP faster, charges slower. Switch to Economy ({stance_key})." | the stance chip |
| done | `factory_built` Millbrook, `barracks_built` Fernhill, a `recruited`, a `stance_changed` (any order) | Seal | |

No failure branch: the goals can be met in any order, and a refused command (a building in a province, a recruit
without a barracks) gets the client's usual alert.

**Opponent script:** none.

**Verified** (`mvp-7`): `BuildFactory(Millbrook)` at tick 30: `build_paid` at once with `units = 3` (the group 3/0)
and `owed = 1`, the last charge from the flow at 66 (`owed = 0`), `factory_built` at 166. `BuildBarracks(Fernhill)`
at 167: `units = 2` at once, paid at 216, `barracks_built` at 316. `Recruit(Fernhill)` at 317: `recruited` at 346.
`SetStance(economy)` at 347: Highhold makes its next charge at 373 (progress carried over, DEC-44), Millbrook's factory
at 456, then every 200 ticks. Millbrook's group is 3/3 again by 150.

### 4.4 Chapter IV: Attack and fight (about 1.5 minutes)

**Goal:** take Ashwood with a planned order, then take Stormcrown, their capital.

**Map `tut-attack`** (9 nodes; round 1's planned-strike map, the enemy capital now the second target):

| Node | x, y | Terrain | Kind | Owner | Units | Stock |
|---|---|---|---|---|---|---|
| Highhold | 170, 350 | mountains | capital | you | | 6 |
| Fernhold | 420, 350 | forest | medium city | you | 3/3 | |
| Wyre | 330, 150 | plains | province | you | | |
| Lowfield | 330, 560 | plains | province | you | | |
| Ashwood | 680, 350 | forest | small city | enemy | 2/2 | |
| Old Mill | 560, 110 | plains | province | none | | |
| Thornwick | 790, 140 | plains | small city | enemy | 1/1 | |
| Gullmoor | 760, 570 | forest | province | enemy | | |
| Stormcrown | 1010, 360 | forest | capital | enemy | 1/1 | 3 |

Roads (travel ticks): Highhold-Fernhold 75, Highhold-Wyre 77, Highhold-Lowfield 79, Wyre-Fernhold 66,
Lowfield-Fernhold 69, Fernhold-Ashwood 78, Wyre-Old Mill 70, Old Mill-Thornwick 70, Thornwick-Ashwood 71,
Thornwick-Stormcrown 93, Ashwood-Stormcrown 99, Ashwood-Gullmoor 70, Gullmoor-Stormcrown 98, Lowfield-Gullmoor 129.

Ashwood and Stormcrown are forest: no terrain effect, so the plan and the charges are the only difference (terrain
is chapter V). The chapter ends by itself: taking the enemy capital ends the match (`match_ended`, `reason = capital`).

| Beat | Trigger | The card says (draft) | Mark |
|---|---|---|---|
| 4.1 | chapter start; the enemy's planned intent appears | "That arrow is an enemy planned order. Everyone sees where a plan goes; nobody sees how big it is. Yours look the same to them." | the enemy intent to Old Mill |
| 4.2 | 4 s after 4.1, or a group is selected | "Your squad in Fernhold: 3 units, 3 charges. Against 2 in Ashwood that is not enough without a bonus." | Fernhold's group |
| 4.3 | the squad is selected (UI) | "Hold {planned_key} and click Ashwood for a planned order; turn the wheel to ask for a bonus of 3. It costs {planned} CP, like any order." | Ashwood |
| 4.4 | the `ack` of your planned order | "The squad waits in Fernhold and gathers +1 bonus every {plan} s from the warehouse there. At +3 it sets off by itself." | the squad and its bonus pill |
| 4.5 | `fight_started` at Ashwood | "A fight runs in rounds: every {round} s each side fires one shot, bonus shots first. Two shots cancel each other." | the arena |
| 4.6 | the first `fight_round` at Ashwood with a loss | "A shot that meets none kills a unit, empty ones first. No retreat: nobody leaves until the fight ends; others can join." | the arena |
| 4.7 | `node_captured` Ashwood by you | "Ashwood is yours, for {capture} charge. How to win: take the enemy capital and the match is yours at once; otherwise every {vp} s each city gives VP, and more VP wins when the clock runs out. Let the squad fill up, then take Stormcrown." | the VP rail, then Stormcrown |
| 4.F | an ordinary order to Ashwood is acked | "An ordinary order: 3 against 2 without a bonus will bounce. Cancel it with {cancel} and plan instead." | the squad |
| 4.F2 | `fight_ended` lost by you, or `capture_failed` by you | "No charge was left to win or to pay for the capture, so the squad turned back. Let it fill up, then strike again." | the squad |
| done | `match_ended`, winner you (the capital) | Seal | |

**Opponent script:** at tick 20 the group of Thornwick, a planned order to Old Mill with a bonus of 1. Nothing else.

**Verified** (`mvp-7`): the enemy plan gathers its bonus at tick 82 and takes Old Mill at 138. The player's planned
order at 60 with a bonus of 3: +1 at 90, 120, 150, the squad leaves at 150; contact at Ashwood at 228; rounds at 248
and 268 (a bonus shot against a real one), 288 (a bonus shot kills), 308 (a real shot kills): Ashwood taken at 308,
the squad 3/1. It is full again at 503; ordered then to Stormcrown: contact at 601, rounds 621 (cancel) and 641 (a
kill), the capital taken at 641 and `match_ended` (`winner = 0`, `reason = capital`). Failures: an ordinary order to
Ashwood at 60: contact at 137, rounds 157, 177, 197, `fight_ended` at 197 lost (one defender dies, the squad bounces home
empty), beats 4.F and 4.F2. The squad sent on to Stormcrown at once after Ashwood (3/1): `fight_ended` lost at 427; sent at 2 charges
(at 363): the defender dies but `capture_failed` (bounce) at 501, beat 4.F2.

### 4.5 Chapter V: Defence (about 1 minute)

**Goal:** fortify the road from Eastfield into Flatford, and hold Flatford.

**Map `tut-defence`** (7 nodes):

| Node | x, y | Terrain | Kind | Owner | Units | Stock |
|---|---|---|---|---|---|---|
| Highhold | 160, 350 | mountains | capital | you | | 6 |
| Highcrag | 410, 180 | mountains | small city | you | 2/2 | |
| Millbrook | 380, 450 | forest | medium city | you | 3/3 | |
| Flatford | 600, 560 | plains | small city | you | 1/1 | |
| Ridgeway | 680, 170 | plains | small city | enemy | 3/3 | |
| Eastfield | 860, 540 | forest | medium city | enemy | | |
| Stormcrown | 1060, 330 | forest | capital | enemy | 4/4 | 6 |

Roads (travel ticks): Highhold-Highcrag 91, Highhold-Millbrook 72, Highcrag-Millbrook 81, Millbrook-Flatford 74,
Highcrag-Ridgeway 81, Flatford-Eastfield 78, Ridgeway-Stormcrown 124, Eastfield-Stormcrown 87.

Two lessons in a row: first the player watches mountains hold (Highcrag), then answers a planned strike on a plains
town (Flatford). Eastfield is a city so the squad of 4 passes it (a province holds 3).

| Beat | Trigger | The card says (draft) | Mark |
|---|---|---|---|
| 5.1 | chapter start | "The enemy is coming for Highcrag. Watch: its defenders stand in the mountains." | Highcrag |
| 5.2 | `fight_round` at Highcrag with `virtual_0 > 0` | "Mountains give the defender {mountains} bonus shot, fired first. Plains do the opposite: the defender burns {plains} charge as the fight starts. Forest gives nothing." | the arena |
| 5.3 | `fight_ended` at Highcrag, not captured | "Held, and nobody died: 3 attackers could not beat 2 defenders in the mountains." | Highcrag |
| 5.4 | the enemy's planned intent to Flatford appears | "A planned strike on Flatford: you see where, not how big. Flatford is on plains. Answer now: fortify the road from Eastfield ({fortify_key}, {fort_cost} CP), and send the group of Millbrook." | the road Flatford-Eastfield |
| 5.5 | `ack` of your `FortifyRoad` on that road | "A road fort works in {fort_build} s. An enemy crossing it towards Flatford loses {toll} charge per {toll_units} units, rounded up." | the fort |
| 5.6 | your `toll_taken` | "The fort took its toll. Now the defenders: more of them, and the burn costs only one." | the arena |
| 5.F | `node_captured` Flatford by the enemy | "Flatford fell: one defender on plains burns its only charge. The raiders head home: take it back, and fortify the road." | Flatford |
| done | your `road_fort_built` on Flatford-Eastfield, and Flatford yours after a `fight_ended` at Flatford | Seal | |

**Opponent script:** at tick 30 the group of Ridgeway to Highcrag (an ordinary order). At 200 the group of
Stormcrown, a planned order to Flatford with a bonus of 1. When Flatford becomes its own, that group goes back to
Stormcrown.

**Verified** (`mvp-7`): the attack reaches Highcrag at 119; rounds at 139 (the mountain bonus, `virtual_0 = 1`), 159,
179; `fight_ended` at 179 with no losses, the attacker bounces home. The strike gathers its bonus at 258 and crosses the
fort's point at 384; contact at Flatford at 415. **Fort and help** (`FortifyRoad` at 220, 250 or 270, the group of
Millbrook 5 ticks later): the fort works at 320, 350 or 370, `toll_paid` 2 charges at 384 (4 units: 2 started
threes), the fight from 415 (first round `burned_0 = 1`) ends at 475 with no losses, `winner = 0`. **Help only**: held
at 515 with 2 defenders dead. **Fort only, or nothing**: Flatford falls at 435 (beat 5.F); the raiders leave at 436,
the group of Millbrook (sent at 436) retakes the empty town at 501, the fort ordered at 502 works at 602. A fort
ordered after 284 is too late for this strike (the toll is taken at the border point at 384, and a fort works
`fort.build_ticks` after its command); it still counts for the goal.

### 4.6 Advanced 1: Group orders (about 40 s)

**Goal:** take Ashwood with one order for two groups.

**Map `tut-group`** (8 nodes):

| Node | x, y | Terrain | Kind | Owner | Units | Stock |
|---|---|---|---|---|---|---|
| Highhold | 170, 330 | mountains | capital | you | | 6 |
| Fernhold | 440, 260 | forest | medium city | you | 2/2 | |
| Lowfield | 230, 600 | plains | small city | you | 3/3 | |
| Wyre | 420, 80 | plains | province | you | | |
| Ashwood | 680, 330 | forest | small city | enemy | 2/2 | |
| Thornwick | 800, 120 | plains | province | enemy | | |
| Gullmoor | 840, 580 | forest | province | enemy | | |
| Stormcrown | 1040, 350 | mountains | capital | enemy | 1/1 | 6 |

Roads (travel ticks): Highhold-Fernhold 84, Highhold-Lowfield 83, Highhold-Wyre 106, Fernhold-Wyre 54,
Fernhold-Ashwood 75, Lowfield-Ashwood 157, Wyre-Thornwick 115, Thornwick-Stormcrown 100, Ashwood-Stormcrown 108,
Thornwick-Ashwood 73, Ashwood-Gullmoor 89, Gullmoor-Stormcrown 91.

The two groups are far apart on purpose: sent one by one they arrive 66 ticks apart and fight two lost fights.

| Beat | Trigger | The card says (draft) | Mark |
|---|---|---|---|
| A1.1 | chapter start | "Two groups, one target. Sent one by one they arrive one by one, and each fights alone." | both groups |
| A1.2 | a group is selected (UI) | "Hold {several_key} and click the other group too (or drag a box). Then click Ashwood: one order, {move} CP per group, and they arrive in the same tick." | Ashwood |
| A1.3 | the `ack` of your `GroupMove` (`kind = attack`) | "Lowfield sets off now; Fernhold waits so both arrive together. The hourglass shows the wait." | Fernhold's group |
| A1.4 | `fight_started` at Ashwood with both groups | "Together: 5 charges against 2." | the arena |
| A1.5 | `node_captured` Ashwood by you | "The same order to one of your own places is a rally: the groups gather there for {rally} of the price." | Highhold |
| A1.F | `fight_ended` at Ashwood lost by you with one group | "One group arrived alone and fought alone. Select both and give one order." | the groups |
| done | `node_captured` Ashwood by you | Seal | |

**Opponent script:** none.

**Verified** (`mvp-7`): `GroupMove((Fernhold, Lowfield), Ashwood)` at tick 40: both arrive at 180, one fight, Ashwood
taken at 260 (shots 4 against 2, the capture paid by the fifth charge). Two `Move` at 40: Fernhold's group alone at
114, `fight_ended` lost at 154 (it bounces home empty, nobody dies); Lowfield's alone at 180, lost at 240 (one defender
dies); Ashwood keeps 1 defender, beat A1.F.

### 4.7 Advanced 2: Rally points (about 40 s)

**Goal:** two new units reach Fernhold by themselves.

**Map `tut-rally`** (6 nodes):

| Node | x, y | Terrain | Kind | Owner | Units | Stock |
|---|---|---|---|---|---|---|
| Highhold | 170, 350 | mountains | capital | you | | 6 |
| Wyre | 400, 200 | plains | province | you | | |
| Fernhold | 620, 330 | forest | medium city | you | 1/1 | |
| Lowfield | 400, 520 | forest | province | you | | |
| Ashwood | 860, 260 | forest | small city | enemy | 2/2 | |
| Stormcrown | 1060, 380 | mountains | capital | enemy | 1/1 | 6 |

Roads (travel ticks): Highhold-Wyre 82, Highhold-Lowfield 86, Wyre-Fernhold 77, Lowfield-Fernhold 87,
Fernhold-Ashwood 75, Ashwood-Stormcrown 70, Lowfield-Stormcrown 202.

**The barracks without a build:** the capital has a barracks from the start (DEC-26; `initial_state` sets
`has_barracks` for every capital), so the rally point is set on Highhold. No building, no map-format extension.

| Beat | Trigger | The card says (draft) | Mark |
|---|---|---|---|
| A2.1 | chapter start | "Your capital recruits. Give it a rally point: open Highhold's menu, Rally point ({rally_key}), then click Fernhold." | Highhold |
| A2.2 | the `ack` of your `SetRallyPoint` | "New units of Highhold now walk to Fernhold by themselves, {rally_cost} CP each as they leave. Recruit two: {recruit_key}, {recruit_cost} CP each." | Highhold |
| A2.3 | the first own `rally_walk_paid` | "On its way: a recruit walks to Fernhold by itself, {rally_cost} CP paid as it left Highhold. It sets off empty and fills up there." | Fernhold |
| A2.F | own `rally_walk_no_cp` | "Not enough CP for the walk: that recruit stayed in Highhold. The next one walks when you have {rally_cost} CP." | the CP gauge |
| done | two own groups of `rally_walk_paid` arrived at Fernhold (`group_arrived`, then `groups_merged` there) | Seal | |

**Opponent script:** none.

**Verified** (`mvp-7`): `SetRallyPoint(Highhold, Fernhold)` at tick 20, `Recruit(Highhold)` at 25 and 26 (CP 3 to 1):
`recruited` at 54 and 84, `rally_walk_paid` at 55 and 85 (CP 0.5, then 0 plus the income), both walk via Wyre and
merge at Fernhold at 214 and 244 (Fernhold 3/3 by 300). Three recruits at once (CP 3 to 0): the first two find no CP
for the walk (`rally_walk_no_cp` at 55 and 85, they merge in Highhold), the third walks (paid at 115, Fernhold at
274): beat A2.F.

### 4.8 The result of a chapter (Seal)

Three short lessons per chapter, drafted to the rule numbers:

| Chapter | Lessons |
|---|---|
| I | A charge is a shot. A capture costs one. You see what your groups see. |
| II | The capital makes charges. The flow carries them. A pocket starves. |
| III | Units pay what the warehouse lacks. Barracks recruit. Stances set the pace. |
| IV | A plan is seen, its size is not. Bonus shots fire first. The capital wins. |
| V | Mountains help the defender, plains hurt it. A road fort takes a toll. Answer a plan early. |
| Advanced 1 | One order, one arrival. Strike together. Rally for half the price. |
| Advanced 2 | Your capital has a barracks. A rally point walks recruits. Each walk costs CP. |

Then the next chapter (primary), "Play your first match", "Replay chapter".

---

## 5. The hints of the first match

The first match is a normal bot match: `@easy` (`gow_server.botmatch`), `narrows` (29 nodes, Q1), unrated, one pause.
The client turns on the hints for it only (Q2); each shows **once** (kept in `sbf.tutorial`), when its trigger fires.
A hint never pauses the match and never covers its place; it goes away by itself after 12 s or by its close button,
and "Turn off hints" is one click on every hint. The look is the chapter card (Leader) without the step lozenges.

The chapters now teach every rule of round 1's hints (factory, payment, barracks, stances, pocket, road forts, VP), so
the first match keeps only what they do not cover:

| # | Hint | Trigger (the player's own data) | The card says (draft) | Place |
|---|---|---|---|---|
| H1 | Bigger map, faster economy | 5 s into the match | "This map is bigger than the tutorial's, so it runs faster: your capital makes a charge every {capital_period} s here, and CP come every {cp_period} s." | the own capital |
| H2 | Over its room | the first own node with `attrition_in` set | "{node} holds more than its room: every {attrition} s above it, one unit is lost. Move some out." | that node |
| H3 | Nothing is stored above the cap | the first own `cp_burned` or `charge_burned` | CP: "Your CP are at the cap, so new ones are lost. Spend them, or switch to Economy ({stance_key})." Charges: "Your warehouses are full, so new charges are lost. Build, or switch to War ({stance_key})." | the CP gauge, or the stance chip |
| H4 | Strike together | Advanced 1 not done, and two own groups join one fight more than a round apart (`fight_group` with `arrived`, after the first `fight_round`) | "Your groups arrived one by one. A group order makes them arrive in one tick: Advanced chapter 1." | the arena |
| H5 | Rally point | Advanced 2 not done, and the third own `recruited` in a city without `rally_point` | "Recruits can walk to the front by themselves: a rally point (Advanced chapter 2)." | that city |

The hints read events and view fields the client gets anyway; they compute no rule (`AGENTS.md` 7.1). H1 quotes the
periods of the match's own `ruleset_public` (map tempo applied); H3 says which stance helps, not how much.

---

## 6. The rules reference

The How to play page (`app/HowToScreen.svelte`, `howto/HowToPlay.svelte`, the economy v1 text and the generated combat
examples) is replaced by one short page, "Rules", reachable from the Road. Sections, one or two lines each, every number
from `ruleset_public` of the main ruleset: Units and charges (R1, R2); Capture and room (R3, R4); Vision (R5); CP and
supply (R6, R7, R8); Buildings and stances (R9 to R11); Fights and planned orders (R12 to R14); Winning (R15); Terrain
and forts (R16, R17); Group orders and rally points (R18, R19); Room and attrition (R20); "Bigger maps are faster"
(R21); the engagement zone (DEC-37) and the factory limit in one line each. No pictures that compute a fight; the
chapters show fights.

Out of a match the client has no `ruleset_public` (it comes in `welcome`), so the reference needs a small HTTP endpoint
(section 7.6). When the tutorial lands, `mise run regen:howto`, `scripts/export_howto.py`,
`tests/test_export_howto.py`, `apps/client/src/howto/` and the `regen:howto` row of `AGENTS.md` section 3 go away
(`regen` keeps protocol and api).

---

## 7. The technical plan

### 7.1 A chapter from a prepared state: the map format suffices

**Checked** in `docs/design/map-format.md` and the code (`gow_sim.maps._parse_node`, `gow_sim.state.initial_state`):

| Needed | The map format today | Used by the chapters |
|---|---|---|
| Owners | yes: `start_owner` per node, any node (one capital per player, owned by it) | yes |
| Starting garrisons | yes, one group per node, `start_units`, `start_charged` (an empty or half-charged group too: II starts Westmarch 3/0); **not** in provinces, **not** in neutral nodes (load errors) | yes, only in cities and capitals |
| Warehouses | **capital only**: `start_stock` of any other node is dropped (DEC-41 item 9) | the capital's stock; the flow fills the rest in seconds; III relies on the empty city warehouses |
| Buildings | **no**: every capital has its barracks and its factory (`initial_state`), nothing else can be set | Advanced 2 uses the capital's barracks; III builds its own |
| CP, stance | no (the ruleset: `cp.start`, `economy.start_stance`) | the defaults |
| Groups on roads, gathering plans, fights in progress | no | none needed (the scripted opponent makes them) |

**Finding: the seven chapters need no extension.** Each was designed inside these limits and played on the simulation
(section 4). For the rally chapter the cheaper way exists: the capital's own barracks (DEC-26), so the player sets a
rally point on Highhold and never builds. The chapter maps are ordinary map files with `meta.symmetry = "none"`.

If a later chapter ever needs more (a prebuilt factory, a stocked city), the smallest extension stays the one of round
1: optional `start_factory`, `start_barracks` and a kept `start_stock` for maps with `meta.start = "as_written"` (a DEC
note bending DEC-41 item 9 for such maps, `gow_sim.maps`, `initial_state`, `MapFile`, `PROTOCOL_VERSION`++, the
validator; no `SIM_VERSION`). Not needed now.

### 7.2 The chapter maps

- `maps/tutorial/<id>.json` (`tut-move`, `tut-supply`, `tut-build`, `tut-attack`, `tut-defence`, `tut-group`,
  `tut-rally`), outside the pool like `maps/menu/` and `maps/gen/`: never served to the queue, a lobby or a tournament.
- **Validation:** they fail the design checks by design (`fairness` of `meta.symmetry = "none"`, `neutral_space`).
  `gow-maps validate` gets `--checks <list>` (or a `tutorial` profile) and `maps:validate` runs the tutorial glob with
  the structural checks only (`format`, `names`, `connectivity`, `planarity`, `travel_ticks`, `degree`); the
  `warehouse` check against `mvp-7` runs as for every map.
- `maps:bake` and `maps:preview` take the glob too (backgrounds as for any map; no geography file, so no water). The
  mockup frames were drawn on such bakes (section 8).
- `gow_server.maps.MapCatalog` loads them as a separate group, served by `GET /api/maps/{id}` (the client draws a
  match map from the server).

### 7.3 The chapter definition: one data file per chapter

`tutorial/chapters/<id>.json`, validated by a Pydantic model in `gow_protocol.tutorial` (the only source of truth,
`AGENTS.md` 6), exported to the JSON schema and to TypeScript by `regen` like `MapFile`. The server reads it, the
client imports it at build time (as `app/menuMap.ts` imports the menu map). Chapter ids: `units`, `economy`,
`building`, `attack`, `defence` (main road), `group-orders`, `rally-points` (Advanced).

```json
{
  "id": "defence", "road": "main", "number": 5, "map": "tut-defence",
  "opponent": [
    {"at": 30, "move": {"from": "Ridgeway", "to": "Highcrag"}},
    {"at": 200, "move": {"from": "Stormcrown", "to": "Flatford", "planned": true, "bonus": 1}},
    {"when": {"owns": "Flatford"}, "move": {"from": "Flatford", "to": "Stormcrown"}}
  ],
  "beats": [
    {"id": "watch", "on": {"start": true}, "mark": [{"node": "Highcrag"}]},
    {"id": "mountain", "on": {"event": "fight_round", "node": "Highcrag", "field": "virtual_0", "min": 1},
     "mark": [{"arena": "Highcrag"}]},
    {"id": "answer", "on": {"intent": {"to": "Flatford"}}, "mark": [{"road": ["Flatford", "Eastfield"]}]}
  ],
  "fails": [{"id": "fell", "on": {"event": "node_captured", "node": "Flatford", "by": "enemy"},
             "mark": [{"node": "Flatford"}]}],
  "goal": {"all": [{"event": "road_fort_built", "node": "Flatford", "road": "Eastfield"},
                   {"after": {"event": "fight_ended", "node": "Flatford"}, "owner": "Flatford", "is": "you"}]}
}
```

The texts are not in the file: the key of a beat is `tutorial.<chapter>.<beat>` in the client dictionaries. Node
names, not ids: the file reads the way the chapter is written, and the loader checks every name against the map.

### 7.4 The scripted opponent

`gow_bots.bots.scripted.ScriptedBot`, a `Controller` built from the chapter's `opponent` list. It imports only what a
bot may (`gow_sim.view`, `gow_sim.commands`, `gow_sim.maps`; `AGENTS.md` 2): it reads the `PlayerView`, finds "the own
group standing in node X" there and answers `Move` (ordinary or planned with its bonus) with opaque ids. A step fires
at a tick (`at`) or on a fact of its own view (`when`: `owns` a node, as chapters II and V need); each fires once; a
step whose group is gone is skipped (the text never depends on it). Deterministic like every bot (no seed is needed);
the `Seat` calls it every 5 ticks as any bot, so `at: 30` means the first decision at or after tick 30, and a `when`
step answers within 5 ticks (the scripts above answered in 1 tick; 5 changes no outcome: the raiders of II and V
leave an empty place either way).

Tests (`apps/bots/tests/test_scripted.py` and a chapter test in `apps/server/tests/`): every chapter is played
headless by its opponent script and a scripted "student" (the commands of section 4, "Verified") and reaches its goal
at the ticks written there; each failure branch produces its trigger event. The expected ticks come from this
document, not from the code (`AGENTS.md` 0.4).

### 7.5 Goals and beats without game logic in the client

A trigger is a fact the player already receives: an event of `event_for_player` (fog applied), the `ack` of one of
their own commands, a field of their `PlayerView` (an owner, `capacity`, `warehouse_cap`, `starve_in`, `flow_pocket`,
`attrition_in`, an intent), or a UI action of their own (a selection). Matching a trigger is comparing those fields
with the data file, never working out a rule (`AGENTS.md` 7.1).

- **The client** walks the beats: it shows the card and the mark of the latest beat whose trigger fired.
- **The server** checks the **goal** only, on the same projected events and view of player 0 (so both agree), and
  ends the chapter when it holds: it queues a `Forfeit` of the scripted side, a normal command in the journal, so the
  match ends with `match_end` (the player wins, `reason = forfeit`). Chapter IV ends by itself (`reason = capital`).
  No protocol change; the client knows it is in a chapter (it started it) and shows the Seal instead of the match
  result.
- Alternative: a new `EndReason.TUTORIAL` (a cleaner record, `PROTOCOL_VERSION`++). Not needed for the first version.

### 7.6 Server

- `POST /api/tutorial-matches {chapter}` (`gow_server.tutorial`): loads the chapter file, its map from
  `maps/tutorial/`, the main ruleset; seat 0 the player, seat 1 the `ScriptedBot`; unrated, private (one pause), not a
  bot level of `botmatch` (no `@level`). It goes through `MatchLifecycle` like a bot match: `claim` (one active match
  per player), the caps (`GOW_MAX_BOT_MATCHES`: a scripted match is cheap but still a match), the connect timeout. No
  replay file is kept (a chapter is scripted; the headless tests are its record).
- **The match row:** a new column `matches.kind` (`match` | `tutorial`, an Alembic migration, default `match`), so the
  profile, the stats and the result counters skip chapters. The first match is an ordinary bot match
  (`POST /api/bot-matches {level: "easy", map_id: "narrows"}`), kept and listed like any.
- `GET /api/ruleset`: `RulesetPublic.from_ruleset` of the main ruleset (unscaled; the reference says bigger maps are
  faster). Public, cacheable. `api.gen.ts` by `regen:api`.

### 7.7 Client

- **Screens** (Svelte, `app/tutorial/`): the intro (Sheet), the result (Seal), the chapter select (Road with the
  Advanced side road); the stone and the rule frame of ui-style 69; the entry from the main button (`app/play.ts`).
- **In a chapter:** the match screen as it is, without the start banner (`hud/StartBanner.svelte`: beat 1 replaces
  it), plus a `TutorialCoach` (HTML over the map): the Leader card. The Compass mark of a place on the map is drawn by
  PixiJS in the effects layer (a baked sprite, `render/bake.ts`, one texture; the compass points turn once), the card
  and its leader are HTML (`AGENTS.md` 7.2). A mark on the HUD (the CP gauge, the VP rail, the stance chip) is an HTML
  outline. The exit dialog reads "Leave the chapter".
- **All strings** through `t()`, keys `tutorial.*`; every rule number from `ruleset_public` (formatted by the existing
  `hud/format.ts`), every key from the player's bindings (`keyLabel`).
- **Hints of the first match:** `hud/HintCoach.svelte` fed by the event stream and the view (section 5), on only in the
  match the tutorial started (a flag of the session).
- Reduced motion: the compass points do not turn and the glow does not breathe; the card appears without the burin
  stroke.

### 7.8 Progress

`localStorage` `sbf.tutorial` (wrapped in `try`, as the other `sbf.*` keys): `{"v": 1, "done": ["units", "economy"],
"skipped": false, "firstMatch": false, "hints": ["H1"], "hintsOff": false}`. A guest and an account on the same
browser share it (round 1: "in the browser"). No server state.

### 7.9 Versions, DEC, protocol

| Change | Needs |
|---|---|
| Rules | none: no DEC, no `SIM_VERSION`, no golden replays |
| `starvation` in `RulesetPublic` (grace, period, charges, per units: the text of beat 2.4) | `PROTOCOL_VERSION`++, `regen:protocol`, in PR 1 |
| Chapter files (new Pydantic model) | the schema and `protocol.gen.ts` by `regen` (no WebSocket message carries them) |
| `POST /api/tutorial-matches`, `GET /api/ruleset` | `api.gen.ts` by `regen:api` |
| `matches.kind` | an Alembic migration |
| Validator `--checks`, the tutorial glob of the map tasks | `mise.toml` and `AGENTS.md` section 3 in the same PR |
| The removal of How to play v1 | `regen:howto` gone from `mise.toml` and `AGENTS.md` |

`ruleset_public` already has every other number the texts quote (section 2). The capital's VP multiplier (DEC-03) is
not quoted (beat 4.7 points at the VP rail, whose `vp_gain` already includes it), so it is not added.

### 7.10 Implementation in three PRs

| PR | Contents | Estimate |
|---|---|---|
| 1. Server, bots, data | the seven maps and chapter files; `gow_protocol.tutorial`; `starvation` in `RulesetPublic` (`PROTOCOL_VERSION`++); `ScriptedBot` with `at` and `when` steps; `POST /api/tutorial-matches` with the goal check and the closing `Forfeit`; `GET /api/ruleset`; `matches.kind`; the validator profile and the map tasks; headless tests of every chapter and failure branch (section 4, "Verified") | M to L, 3 days |
| 2. Client: chapters | the entry and Skip, the Sheet, the Road with the side road, the Seal, the coach (Leader card, Compass sprite, HUD outlines), the exit wording, no start banner in a chapter, progress; Vitest of the beat walker on recorded event streams; `shots` of the new screens; the `visual` references | L, 4 days |
| 3. Client: first match and reference | the five hints of section 5 with their triggers; the rules reference on `GET /api/ruleset`; the removal of How to play v1 and `regen:howto` | M, 2 days |

---

## 8. The look [accepted 2026-11-13]

[`mockups/tutorial.html`](mockups/tutorial.html): self-contained (the fonts are the client's own, SIL OFL), on frames
of the real client: every chapter frame is the chapter map of section 4 (baked like a pool map) played on the
simulation by its script and drawn by the client; the first-match frames are dev scenes of the artery map and one
`tut-group` moment (a place over its room). It shows only the chosen variants, one large view, with a switch per
piece and per moment; the state is in the address (`#el=card&m=IV.5`).

| Piece | Chosen | Round 1 alternatives (dropped) |
|---|---|---|
| Hint card of a chapter | **Leader**: a plate tied to its place by a ruled leader, the chapter and its step lozenges in the head, the action under a rule | Tablet, Banner |
| Goal mark on the map | **Compass**: a double ring, the four compass points turn once and stop; on a road two rails and a chevron; on the HUD an outline with corner lozenges | Lantern, Burin |
| Chapter intro | **Sheet**: a stone sheet on the blurred main screen, the goal list and a crop of the chapter map with the goals ringed | Plinth |
| Chapter result | **Seal**: a stone window over the chapter's last moment, the seal (a lozenge with the chapter numeral), three lessons | Page |
| Chapter select | **Road**: the main road I to V ending at the enemy capital (the first match, open at any time), the Advanced side road branching off after V with its two places, the walked part in the own colour | Cards |
| Hint of the first match | **Leader**: the chapter card without the step lozenges, with "Turn off hints" | Toast |

Checked with `design:design-critique` and `design:accessibility-review` in round 1 (contrast of every text pair
6.9:1 or more, marks ivory on a dark casing, never a player or alert colour; motion stops by itself and "Less motion"
holds it still); the round 2 page keeps those tokens and adds only the side road and the two Advanced seals.

---

## 9. Open questions

The defaults are in force until the owner changes them.

- **Q1.** The first match on `narrows` (29 nodes, the smallest pool map)? **Default: yes.** Alternative: a generated
  small map.
- **Q2.** Hints only in the first match? **Default: yes.** Alternative: until each hint was shown once, with a "Show
  hints" setting.
- **Q3.** The forced entry for guests only? **Default: yes** (a new account is not sent into the tutorial).
- **Q4.** Round 1's H8 "Strike together" became the Advanced chapter "Group orders"; the first match only points at it
  (H4) when that chapter was not played. **Default: as written.**
- **Q5.** Ruleset numbers in `ruleset_public` only where a chapter text needs them. **Default: only `starvation`**
  (beat 2.4; one `PROTOCOL_VERSION` bump in PR 1); the capital's VP multiplier is not quoted.
- **Q6 (new).** Chapter IV is the longest (about 64 s of play: the squad waits about 20 s to fill up before the
  capital). Keep the wait (beat 4.7 explains the VP meanwhile), or start Ashwood with an empty warehouse but give the
  player a second squad? **Default: keep.**
- **Q7 (new).** Chapter III asks for four things (factory, barracks, recruit, stance). Keep all four in one chapter, or
  move the stance to chapter II? **Default: keep** (the stance is the throttle of what III builds).
