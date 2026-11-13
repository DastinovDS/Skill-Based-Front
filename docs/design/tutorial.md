# How to play: the tutorial round (#806)

**Status.** The form, the chapters, the opponent, the entry, the progress and the rules reference are the owner's
decisions of 2026-11-13 **[accepted]** (section 1). The look (hint card, goal highlight, chapter intro and result,
chapter select, the hint of the first match) is **[awaiting the owner's decision]**: the variants are in the mockup
[`mockups/tutorial.html`](mockups/tutorial.html) and in the table of issue #806. No game code exists yet; section 7 is
the plan for it.

The tutorial teaches the main ruleset `rulesets/mvp-7.toml`. Every rule below is checked against
[`mechanics.md`](mechanics.md) (DEC numbers in the tables), every chapter script was played on the real simulation
(`gow_sim`, `mvp-7`, map tempo included) and its outcome is written next to it (section 4, "Verified"). No rule is
added or changed: the tutorial needs no DEC and no `SIM_VERSION`.

Contents: 1 the owner's decisions; 2 what is taught and where; 3 the screens and the flow; 4 the three chapters;
5 the hints of the first match; 6 the rules reference; 7 the technical plan; 8 the mockup; 9 open questions.

---

## 1. The owner's decisions (2026-11-13) [accepted]

1. **Form.** Three short chapters, about a minute each, then the player's first real match against a `@easy` bot on a
   small map, where the remaining rules appear as contextual hints the first time they matter. Not a long chain of
   chapters. The first 3 to 4 minutes teach one idea: expand, then one strike with a bonus.
2. **Chapters.** (1) Move and capture: a charge on the helmet is a shot, a capture costs a charge, the capital makes
   charges and the flow carries them to the front by itself. (2) Fight: rounds and shots; plains are bad for the
   defender, mountains good; no retreat, reinforcing is allowed. (3) Strike with a plan: a 3-unit squad and a planned
   order that gathers a bonus and is visible to the enemy. **Hints in the first match**, on events: the first factory
   and paying it with unit charges, the barracks and the rally point, stances, a cut-off pocket, road forts, VP and
   winning.
3. **Opponent.** Scripted in the chapters (an exact command sequence, the lesson is always the same); `@easy` in the
   match.
4. **Entry.** A new guest's first "Play" starts the tutorial, with a visible "Skip"; it is also reachable later from
   the menu.
5. **Progress.** Completed chapters are kept in the browser; any chapter can be replayed.
6. **The old How to play text page** becomes a short rules reference whose numbers come from `ruleset_public`;
   `regen:howto` and the v1 text go away when the tutorial lands.

The combat rules card of #766 was closed into this issue (owner, 2026-11-09): its rows are covered by chapter 2, the
hints and the reference (section 2).

---

## 2. What is taught, and where

The rule list of the issue body (2026-11-03) is outdated: it names the leaf shift (gone, DEC-50) and "orders and
modes" (no "Defense" since #894). The list below is the main ruleset `mvp-7` as of 2026-11-13. "Field" is the
`ruleset_public` field every number on screen comes from (never typed into a string, `AGENTS.md` 7.1).

| # | Rule (as the player meets it) | Source | Where | Field |
|---|---|---|---|---|
| R1 | A unit is charged or empty; a charge is one shot; the helmet shows units, the dots its charges | mechanics 3; DEC-07 | Chapter 1 | none |
| R2 | An order costs CP; CP come back at a flat rate | DEC-02, DEC-44 | Chapter 1 | `cost.move`, `cp.per_period`, `stances.cp_period_ticks` |
| R3 | Taking a place costs a charge; without one the group turns back | DEC-38 | Chapter 1 (and 2) | `capture.charge_cost` |
| R4 | The capital makes charges; the flow carries them to the front by itself and recharges standing units | DEC-41 items 2, 9; DEC-43; DEC-50 | Chapter 1 | `stances.capital_period_ticks`, `supply_dispatch_ticks` |
| R5 | A fight runs in rounds; each side fires one shot a round; shots cancel charges; a surplus shot kills one unit, empty ones first | DEC-07 rules 1 to 3; DEC-24 item B; DEC-32 | Chapter 2 | `combat.round_ticks`, `combat.shots_per_round`, `tick_hz` |
| R6 | Terrain helps or hurts only the defender of a place that has a charged unit: mountains a bonus shot, plains burn a charge at the first round, forest nothing | DEC-07 rule 1; DEC-24 F2; DEC-45 | Chapter 2 | `combat.terrain_defense_mod` |
| R7 | No retreat: a group in a fight stays until it ends; groups that arrive join it | DEC-40; DEC-24 item D | Chapter 2 | `combat.retreat` |
| R8 | Bonus shots fire first and burn when the fight ends; both sides see the reserve (◇) in a fight | DEC-24 F1; DEC-32 items 3, 5 | Chapters 2, 3 | none |
| R9 | A planned order costs as much as an ordinary one, waits in its node and gathers +1 bonus per warehouse charge at a fixed pace, at most the group's charges; it leaves at the bonus asked for | DEC-41 item 10; DEC-48 | Chapter 3 | `cost.planned_move`, `orders.plan_ticks_per_bonus` |
| R10 | The enemy sees where a planned order goes, never its size or bonus (until the fight) | mechanics 5; `AGENTS.md` 4.4; DEC-32 item 3 | Chapter 3 | none |
| R11 | Groups of 3 pass every road: a province holds 3 (the stack limit) | DEC-20 item D; DEC-22 | Chapter 3 | `NodeView.capacity` (public per node, DEC-22) |
| R12 | A group order: several groups strike in one tick, or rally to an own node | DEC-48 | Hint H8 (proposed, question Q4) | `group_order` |
| R13 | A factory: 4 charges paid from the warehouse, then by the units standing there; works after a build time; at most 3 with the capital | DEC-41 items 2, 7; DEC-47 | Hint H1, H2 | `factory.cost`, `factory.build_ticks`, `factory.max` |
| R14 | A barracks: 3 charges, then the city recruits; a rally point walks new units to the front for half a CP each | DEC-26; DEC-41 item 7; DEC-25; DEC-48 item H | Hint H3 | `city_upgrades.*`, `cost.recruit`, `recruit.rally_cost` |
| R15 | Stances: War more CP and fewer charges, Economy the other way, Balance between; the switch is free and keeps progress | DEC-44; DEC-47 | Hint H4 | `stances.*` |
| R16 | A pocket cut off from the capital gets no supply, its factories stop, and without a factory it starves | DEC-43 item H | Hint H5 | none in the text (`starvation` is not public, section 7.9) |
| R17 | A road fort costs CP and takes a charge per started 3 units from an enemy crossing it towards its node; a capture destroys it | DEC-43 item D | Hint H6 | `fort.*` |
| R18 | VP every 30 s for each city (capital x3); the enemy capital wins at once; at the end more VP wins | DEC-03 | Hint H7 | `victory.vp_period_ticks`, `match_ticks`; `View.vp_gain` (the multiplier is not public, section 7.9) |

Not taught anywhere on purpose (the reference has them): vision levels by terrain (DEC-21), the engagement zone
(DEC-37), map tempo (DEC-46), attrition over capacity (DEC-12).

---

## 3. The screens and the flow

```
first "Play" of a new guest ─┐                       ┌─> Skip ──> the action the player chose (queue, bot, invite)
"?" > Tutorial (any time) ───┴─> Chapter intro (1) ──┤
                                                     └─> Start ─> Chapter 1 ─> Result ─> Chapter 2 ─> ... ─> Result 3
                                                                                                             │
           "Play your first match" (bot @easy, small map, hints on) <────────────────────────────────────────┘
```

| Screen | What is on it | Comes from | Goes to |
|---|---|---|---|
| **Chapter intro** | the chapter number and name, one sentence of what you will do, Start; on the first entry "Skip the tutorial" | the first Play of a new guest; the chapter select; the result of the previous chapter | the chapter (a match) or, by Skip, the action the player had chosen |
| **Chapter** | the match screen as in a real match, plus the hint card and the goal highlight; the exit button reads "Leave the chapter" | intro | result, or the chapter select (leave) |
| **Result** | done mark, one line of what was learned, Next chapter (or Play your first match after 3), Replay chapter | the goal of the chapter | next intro, the first match, or the main screen |
| **Chapter select** ("Tutorial") | the three chapters with done marks, the first match, the rules reference link | "?" on the main screen | any chapter intro, the first match, the reference |
| **First match** | a normal bot match (`@easy`, a small map) with the hints of section 5 | result of chapter 3, or the chapter select | the normal result screen |
| **Rules reference** | one page of short rules with live numbers (section 6) | the chapter select; the result screen | back |

**Entry.** `sbf.tutorial` (section 7.8) absent and the player is a guest: the first press of the main button (Search,
Start or Get the link) opens the intro of chapter 1 instead; "Skip the tutorial" sets the progress to `skipped` and
runs the action that was pressed. The New here dialog of #919 (`app/NewHereDialog.svelte`, off today) is not needed
any more: its job is the intro. An account that already played a match never gets the forced entry.

**Leaving a chapter.** The exit dialog of a match ("Forfeit and leave") says "Leave the chapter" and "Keep playing"
in a chapter; leaving goes to the chapter select. Nothing is lost: a chapter always restarts from its start.

**Replay a chapter.** From the result (Replay) or the chapter select; a chapter is a fresh match every time.

---

## 4. The three chapters

Common to all three:

- **Ruleset** `mvp-7` unchanged, with its map tempo: the chapter maps are small, so the economy periods are doubled
  (the clamp `min_pct = 50`): the capital makes a charge per 40 s in Balance, CP come 0.5 per 10 s. The chapters
  never wait for production: the capital starts with 6 charges, and the scripts below were timed with these numbers.
- **The player is player 0**, the scripted opponent player 1 (the map's `capital_of` decides it; a chapter never
  swaps sides). CP start 3 (`cp.start`), Balance (`economy.start_stance`).
- **Every text is a draft** for `t()` (keys `tutorial.c<N>.<beat>`), English only (`AGENTS.md` 7.4); numbers in
  braces come from `ruleset_public`, key names from the player's bindings (`keyLabel`), never typed in.
- A **beat** is one hint card: it shows when its trigger fires and stays until the next beat's trigger. Triggers are
  facts the player's own client already receives (section 7.5): an event, an `ack` of the player's own command, a
  field of the player's view, or a UI action of the player (a selection). The goal highlight follows the beat.
- **Failure never ends a chapter.** Every failure the script can produce has a beat that says why and what to do;
  the goal stays the same. Leaving and Replay are always there.
- **The map world** is laid out to fill a 16:10 window (1200 x 700 world units below; the client fits it with its
  usual margin). The maps live in `maps/tutorial/` (section 7.2); the drafts are in the tables.

### 4.1 Chapter 1: Move and capture (about 50 s)

**Goal:** take Ashford, Elmstead and Fordham.

**Map `tut-move`** (9 nodes; `x, y` world units; units/charged; stock is the warehouse at the start):

| Node | x, y | Terrain | Kind | Owner | Units | Stock |
|---|---|---|---|---|---|---|
| Highhold | 190, 350 | mountains | capital | you | 2/2 | 6 |
| Ashford | 370, 270 | plains | province | none | | |
| Elmstead | 540, 160 | forest | small city | none | | |
| Fordham | 560, 410 | plains | medium city | none | | |
| Reedwick | 360, 520 | forest | province | none | | |
| Kestrel | 760, 280 | plains | province | none | | |
| Thornby | 760, 540 | forest | province | none | | |
| Brackenfold | 760, 90 | mountains | province | none | | |
| Stormcrown | 1000, 330 | mountains | capital | enemy | 3/3 | 6 |

Roads (travel ticks): Highhold-Ashford 59, Highhold-Reedwick 72, Ashford-Elmstead 61, Ashford-Fordham 71,
Reedwick-Fordham 68, Elmstead-Kestrel 75, Fordham-Kestrel 72, Fordham-Thornby 72, Elmstead-Brackenfold 69,
Kestrel-Stormcrown 74, Thornby-Stormcrown 96, Brackenfold-Stormcrown 102.

The group is 2 units on purpose: two captures empty it, so the flow has to refill it, and a third capture without
waiting fails visibly (the failure beat below).

| Beat | Trigger | The card says (draft) | Highlight |
|---|---|---|---|
| 1.1 | chapter start | "This is your army: 2 units. Each filled dot is a charge, and a charge is one shot. Click the helmet to select it." | the group in Highhold |
| 1.2 | the group is selected (UI) | "Click Ashford to march there. An order costs {move} CP." | Ashford |
| 1.3 | `node_captured` Ashford by you | "Ashford is yours. Taking a place costs {capture} charge: look at the dots." | the group's dots |
| 1.4 | `packet_sent` from Highhold, or 3 s after 1.3 | "Your capital makes charges, and the flow carries them to the front by itself. Watch the road." | the road Highhold-Ashford |
| 1.5 | the group is full again (its `charged` equals `units` in the view) | "Charged again. Take Elmstead and Fordham." | Elmstead, Fordham |
| 1.F | `capture_failed` by you | "No charge, no capture: the group turned back. Let the flow refill it, then try again." | the group |
| done | Ashford, Elmstead and Fordham are yours (`node_captured`) | result | |

**Opponent script:** at tick 100, the group of Stormcrown to Kestrel; at tick 260, from Kestrel to Brackenfold
(ambient: it is in the fog unless the player walks near; it never attacks).

**Verified** (`mvp-7`, the player's orders at ticks 20, 150, 330): Ashford taken at tick 84 (the group 2/1), the first
packet lands at Ashford at 129 and the group is 2/2 again, Elmstead at 203, Fordham at 439 (through Ashford). A rushed
player (Ashford at 20, Fordham at 86, Elmstead at 158 without waiting): Fordham is taken with the last charge, then
`capture_failed` (bounce) at Elmstead at tick 267, beat 1.F; the group is back at Ashford 2/2 by 321.

### 4.2 Chapter 2: Fight (about 50 s)

**Goal:** hold Highcrag and take Flatford.

**Map `tut-fight`** (7 nodes):

| Node | x, y | Terrain | Kind | Owner | Units | Stock |
|---|---|---|---|---|---|---|
| Highhold | 170, 350 | mountains | capital | you | 0 | 6 |
| Highcrag | 420, 200 | mountains | small city | you | 2/2 | |
| Millbrook | 400, 470 | forest | medium city | you | 3/3 | |
| Fernhill | 450, 640 | plains | small city | you | 1/1 | |
| Ridgeway | 690, 180 | plains | small city | enemy | 3/3 | |
| Flatford | 700, 450 | plains | small city | enemy | 2/2 | |
| Stormcrown | 1000, 330 | forest | capital | enemy | 1/1 | 6 |

Roads (travel ticks): Highhold-Highcrag 87, Highhold-Millbrook 78, Highcrag-Millbrook 81, Millbrook-Fernhill 53,
Highcrag-Ridgeway 81, Millbrook-Flatford 90, Fernhill-Flatford 94, Ridgeway-Flatford 81, Ridgeway-Stormcrown 103,
Flatford-Stormcrown 97. Fernhill is placed so that its group needs about as long to Flatford as the squad of
Millbrook (74 and 80 ticks): sent together or up to 6 s later, it joins the fight in time.

| Beat | Trigger | The card says (draft) | Highlight |
|---|---|---|---|
| 2.1 | chapter start | "The enemy is coming for Highcrag. Watch: a fight runs in rounds, one shot a side every {round} s. Shots cancel charges." | Highcrag |
| 2.2 | `fight_round` at Highcrag with `virtual_0 > 0` | "Highcrag stands in the mountains: its defenders get {mountains} bonus shot (◇), fired first." | the arena's ◇ |
| 2.3 | `fight_ended` at Highcrag, not captured | "Held, and nobody died: 3 attackers could not beat 2 defenders in the mountains. Now attack Flatford with the squad in Millbrook." | Millbrook's group, Flatford |
| 2.4 | the `ack` of your order to Flatford | "Flatford is on plains: its defenders lose {plains} charge as the fight starts. Send the group from Fernhill too: groups that arrive join a fight." | Fernhill's group |
| 2.5 | `fight_started` at Flatford | "No retreat: nobody can leave this fight until it ends. You can only send more." | the arena |
| 2.F | `capture_failed` at Flatford (`result = bounce`) | "You won the fight, but no charge was left to pay for the capture, so the squad turned back. Flatford is empty now: take it with any charged group." | Flatford |
| 2.F2 | `fight_ended` at Flatford lost by a lone group (it arrived before the squad) | "One group alone fought one fight alone. Send groups so they arrive together." | Millbrook's group |
| done | `node_captured` Flatford by you, Highcrag still yours | result | |

**Opponent script:** at tick 30 the group of Ridgeway to Highcrag (an ordinary order). Nothing else.

**Verified** (`mvp-7`): the attack reaches Highcrag at tick 119; rounds at 139 (the defence fires its mountain bonus,
`virtual_0 = 1`), 159, 179; `fight_ended` at 179 with no losses on either side, the attacker bounces home 3/0
(DEC-32 row 6). The player's squad of Millbrook ordered at 150, the group of Fernhill at 150, 170, 190 or 210: Flatford
is taken at tick 284 to 290 (`fight_round` at the first round with `burned_1 = 1`, two defenders killed, the capture
paid by a charge still left on the side). The squad alone (or Fernhill sent at 230 or later): the defenders die at 290
but `capture_failed` (bounce, the squad 3/0), beat 2.F; the late group of Fernhill then takes the empty town at 304. If
the group of Fernhill is sent long before the squad, it arrives alone and loses its only charge (`fight_ended` at
contact + 20), beat 2.F2; the squad still takes nothing alone (2.F follows).

### 4.3 Chapter 3: Strike with a plan (about 45 s)

**Goal:** take Ashwood with a planned order.

**Map `tut-plan`** (9 nodes):

| Node | x, y | Terrain | Kind | Owner | Units | Stock |
|---|---|---|---|---|---|---|
| Highhold | 170, 350 | mountains | capital | you | 0 | 6 |
| Fernhold | 420, 350 | forest | medium city | you | 3/3 | |
| Wyre | 330, 150 | plains | province | you | | |
| Lowfield | 330, 560 | plains | province | you | | |
| Ashwood | 680, 350 | forest | small city | enemy | 2/2 | |
| Old Mill | 560, 110 | plains | province | none | | |
| Thornwick | 790, 140 | plains | small city | enemy | 1/1 | |
| Gullmoor | 760, 570 | forest | province | enemy | | |
| Stormcrown | 1010, 360 | mountains | capital | enemy | 1/1 | 6 |

Roads (travel ticks): Highhold-Fernhold 75, Highhold-Wyre 77, Highhold-Lowfield 79, Wyre-Fernhold 66,
Lowfield-Fernhold 69, Fernhold-Ashwood 78, Wyre-Old Mill 70, Old Mill-Thornwick 70, Thornwick-Ashwood 71,
Thornwick-Stormcrown 93, Ashwood-Stormcrown 99, Ashwood-Gullmoor 70, Gullmoor-Stormcrown 98, Lowfield-Gullmoor 129.

Ashwood is forest on purpose: no terrain, so the plan is the only difference.

| Beat | Trigger | The card says (draft) | Highlight |
|---|---|---|---|
| 3.1 | chapter start; the enemy's planned intent appears | "That arrow is an enemy planned order. Everyone sees where it goes; nobody sees how big it is. Yours look the same to them." | the enemy intent to Old Mill |
| 3.2 | 4 s after 3.1, or the player selects a group | "Your squad of 3 in Fernhold: three units, three charges. Three fits through every road." | Fernhold's group |
| 3.3 | the squad is selected (UI) | "Hold {planned} and click Ashwood for a planned order. Turn the wheel to ask for a bonus of 3." | Ashwood |
| 3.4 | the `ack` of your planned order | "Your squad waits in Fernhold and gathers +1 bonus every {plan} s from the warehouse there. At +3 it sets off." | the squad and its bonus pill |
| 3.5 | `fight_started` at Ashwood | "Bonus shots (◇) fire first and cancel the defenders' charges. Your own charges are left to kill and to pay for the capture." | the arena |
| 3.F | an ordinary order to Ashwood is acked | "An ordinary order: 3 against 2 bounces without a bonus. Cancel it with {cancel} and plan instead." | the squad |
| 3.F2 | `fight_ended` at Ashwood lost by you | "3 against 2 bounced: the defenders cancelled your shots. Let the squad recharge and strike with a plan." | Fernhold |
| done | `node_captured` Ashwood by you | result | |

**Opponent script:** at tick 20 the group of Thornwick, a planned order to Old Mill with a bonus of 1 (it gathers
from Thornwick's warehouse, leaves and takes the empty Old Mill). Nothing else.

**Verified** (`mvp-7`): the enemy plan gathers its bonus at tick 82 and takes Old Mill at 138. The player's planned
order at tick 60 with a bonus of 3: +1 at 90, 120, 150 (from Fernhold's warehouse, which the flow refills), the squad
leaves at 150, contact at Ashwood at 228; rounds 248 and 268 (virtual against real), 288 (a virtual shot kills), 308
(a real shot kills): Ashwood taken at 308, the squad 3/2 after paying the capture. The same squad with an ordinary
order at tick 60: contact at 137, rounds 157, 177 cancel, 197 kills one defender; `fight_ended` at 197 lost, the squad
bounces home 3/0 (DEC-32 row 2), beat 3.F2; Ashwood keeps 1 defender.

### 4.4 The result of a chapter

One line of what was learned, drafted to the rule numbers: chapter 1 "A charge is a shot. A capture costs one. The
flow refills the front."; chapter 2 "Mountains help the defender, plains hurt it. No retreat; help may join.";
chapter 3 "Everyone sees a plan, not its size. The bonus fires first. Strike with a squad of three." Then Next chapter (or Play your first
match), Replay chapter, and the way back.

---

## 5. The hints of the first match

The first match after chapter 3 is a normal bot match: `@easy` (`smart_turtle@easy` today, `gow_server.botmatch`),
the smallest pool map `narrows` (29 nodes), unrated, one pause. The client turns on the hints for it; each hint shows
**once** (kept in `sbf.tutorial`, section 7.8), in the order its trigger fires. A hint never pauses the match and never
covers the place it talks about; it goes away by itself after 12 s or by its close button, and "Turn off hints" is one
click on every hint.

| # | Hint | Trigger (the player's own data) | The card says (draft) | Place |
|---|---|---|---|---|
| H1 | The first factory | 60 s in, the factory counter of the top bar is 1 (the capital only) and an own city stands two or more roads from the capital | "Build a factory in a city near the front: {factory_cost} charges, and it makes charges like your capital. Open the city's menu." | that city |
| H2 | Paid by the units | the first own `build_paid` with `units > 0` | "The warehouse had too few charges, so the units there paid the rest. The flow recharges them." | the build |
| H3 | Barracks and rally point | the first own `barracks_built`, or 4 min in without one | "Recruit here ({recruit} key, {recruit_cost} CP a unit). Set a rally point ({rally} key) and new units walk to the front by themselves ({rally_cost} CP each)." | the barracks city |
| H4 | Stances | the first own `cp_burned` or `charge_burned` | CP burned: "Your CP are full, so new ones are lost. Economy gives more charges and fewer CP ({stance} key)." Charge burned: "Your warehouses are full, so new charges are lost. War gives more CP and fewer charges ({stance} key)." | the stance chip |
| H5 | A pocket | an own node with `flow_pocket = true` in the view | "These places are cut off from your capital: no supply reaches them, and without a factory their units starve. Reconnect them." | the pocket |
| H6 | Road forts | the first own `toll_paid`, or an enemy fort in the view | "An enemy road fort took {toll} charge from your group: {toll_charges} per {toll_units} units, rounded up, and only on the way into its city. Take the city and the fort is gone. Your own: {fortify} in a city's menu, {fort_cost} CP." | the fort |
| H7 | VP and winning | the first `vp_awarded` | "Every {vp_period} s each city gives VP; the number above the rail is your next gain. Take the enemy capital to win at once; otherwise more VP wins when the clock runs out." | the VP rail of the top bar |

H8 (a proposal, not in the owner's list): two own groups enter one fight more than a round apart (`fight_group` with
`arrived` later than the first round), "Strike together: select several groups (Shift) and give one order; they arrive
in the same tick." Question Q4.

The hints read events and view fields the client gets anyway; they compute no rule (`AGENTS.md` 7.1). H4 says which
stance helps, not how much: the rates are in the stance menu already.

---

## 6. The rules reference

The How to play page (`app/HowToScreen.svelte`, `howto/HowToPlay.svelte`, economy v1 text and the generated combat
examples) is replaced by one short page, "Rules", reachable from the chapter select and the result of a chapter.
Sections, one or two lines each, all numbers from `ruleset_public` of the main ruleset: Units and charges (R1, R2);
Capture (R3); Supply (R4, R16); Fights (R5 to R8); Planned orders and group orders (R9 to R12); Buildings (R13, R14,
R17); Stances (R15); Winning (R18); "Smaller maps are slower" (map tempo, DEC-46, one line). No pictures that compute a
fight; the chapters show fights.

Out of a match the client has no `ruleset_public` today (it comes in `welcome`), so the reference needs a small HTTP
endpoint (section 7.6). When the tutorial lands, `mise run regen:howto`, `scripts/export_howto.py`,
`tests/test_export_howto.py`, `apps/client/src/howto/` and the `regen:howto` row of `AGENTS.md` section 3 go away
(`regen` keeps protocol and api).

---

## 7. The technical plan

### 7.1 A chapter from a prepared state: the map format suffices

**Checked** in `docs/design/map-format.md` and the code (`gow_sim.maps._parse_node`, `gow_sim.state.initial_state`):

| Needed | The map format today | Used by the chapters |
|---|---|---|
| Owners | yes: `start_owner` per node, any node (one capital per player, owned by it) | yes |
| Starting garrisons | yes, one group per node: `start_units`, `start_charged`; **not** in provinces, **not** in neutral nodes (load errors) | yes, only in cities and capitals |
| Warehouses | **capital only**: `start_stock` of any other node is dropped (DEC-41 item 9, `_start_stock`) | the capital's 6; the flow fills the rest in seconds |
| Buildings | **no**: the capital has its barracks and factory, nothing else can be set (no factory, barracks, road fort) | none needed |
| CP, stance | no (the ruleset: `cp.start`, `economy.start_stance`) | the defaults |
| Groups on roads, gathering plans, fights in progress | no | none needed |

**Finding: the three chapters need no extension.** Each was designed inside these limits and played on the
simulation (section 4). The chapter maps are ordinary map files with `meta.symmetry = "none"`.

If a later chapter ever needs more (a prebuilt factory, a stocked city), the smallest extension is **optional start
fields on a node**: `start_factory: bool`, `start_barracks: bool`, and `start_stock` kept for every node of a map that
sets `meta.start = "as_written"`. Cost: a DEC note (it bends DEC-41 item 9 for such maps only), `gow_sim.maps` and
`initial_state` (absent fields keep every existing map and its hash: the fields are left out of `map_to_data` at their
defaults), `MapFile` and `PROTOCOL_VERSION`++ (the client reads the map), the validator. No `SIM_VERSION`: no rule
changes. The alternative, a scripted opening (both sides play commands for the first seconds before the player gets
control), costs nothing in the format but shows the player a setup they did not make and adds seconds. Neither is
needed now.

### 7.2 The chapter maps

- `maps/tutorial/<id>.json` (`tut-move`, `tut-fight`, `tut-plan`), outside the pool like `maps/menu/` and
  `maps/gen/`: never served to the queue, a lobby or a tournament.
- **Validation:** they fail the design checks by design (the `fairness` of `meta.symmetry = "none"` and
  `neutral_space`: the drafts of section 4 fail exactly those and pass `format`, `names`, `connectivity`, `planarity`,
  `travel_ticks`, `degree`). `gow-maps validate` gets `--checks <list>` (or a `tutorial` profile) and
  `maps:validate` runs the tutorial glob with the structural checks only. The `warehouse` check against `mvp-7` runs
  as for every map.
- `maps:bake` and `maps:preview` take the glob too (backgrounds as for any map; no geography file: no water).
- `gow_server.maps.MapCatalog` loads them as a separate group, served by `GET /api/maps/{id}` like the menu maps are
  not (the client draws a match map from the server).

### 7.3 The chapter definition: one data file per chapter

`tutorial/chapters/<id>.json`, validated by a Pydantic model in `gow_protocol.tutorial` (the only source of truth,
`AGENTS.md` 6), exported to the JSON schema and to TypeScript by `regen` like `MapFile`. The server reads it, the
client imports it at build time (as `app/menuMap.ts` imports the menu map).

```json
{
  "id": "fight", "number": 2, "map": "tut-fight",
  "opponent": [{"at": 30, "move": {"from": "Ridgeway", "to": "Highcrag"}}],
  "beats": [
    {"id": "watch", "on": {"start": true}, "highlight": [{"node": "Highcrag"}]},
    {"id": "mountain", "on": {"event": "fight_round", "node": "Highcrag", "field": "virtual_0", "min": 1},
     "highlight": [{"arena": "Highcrag"}]},
    {"id": "noRetreat", "on": {"event": "fight_started", "node": "Flatford"}, "highlight": [{"arena": "Flatford"}]}
  ],
  "fails": [{"id": "noCharge", "on": {"event": "capture_failed", "node": "Flatford"}, "highlight": [{"node": "Flatford"}]}],
  "goal": {"all": [{"event": "node_captured", "node": "Flatford", "by": "you"}, {"owner": "Highcrag", "is": "you"}]}
}
```

The texts are not in the file: the key of a beat is `tutorial.<chapter>.<beat>` in the client dictionaries.
Node names, not ids: the file reads the way the chapter is written, and the loader checks every name against the map.

### 7.4 The scripted opponent

`gow_bots.bots.scripted.ScriptedBot`, a `Controller` built from the chapter's `opponent` list. It imports only what a
bot may (`gow_sim.view`, `gow_sim.commands`, `gow_sim.maps`; `AGENTS.md` 2): it reads the `PlayerView`, finds "the
own group standing in node X" there and answers `Move`, `GroupMove` or `SetStance` with opaque ids. Steps fire at a
tick (`at`) or on a fact of its view (`when`: an own node lost, an enemy figure in node X); a step whose group is gone
is skipped (the chapter's text never depends on it). It is deterministic like every bot (no seed is needed); the
`Seat` calls it every 5 ticks as any bot, so `at: 30` means the first decision at or after tick 30. The server's
bot matches already run controllers through `gow_sim.match.Seat`; a scripted one comes through `given()`.

Tests (`apps/bots/tests/test_scripted.py` and a chapter test in `apps/server/tests/`): every chapter is played
headless by its opponent script and a scripted "student" (the commands of section 4, "Verified") and reaches its goal
at the ticks written there; each failure branch produces its trigger event. The expected ticks come from this
document, not from the code (`AGENTS.md` 0.4).

### 7.5 Goals and beats without game logic in the client

A trigger is a fact the player already receives: an event of `event_for_player` (fog applied), the `ack` of one of
their own commands, a field of their `PlayerView`, or a UI action of their own (a selection). Matching a trigger is
comparing those fields with the data file, never working out a rule (`AGENTS.md` 7.1).

- **The client** walks the beats: it shows the card and the highlight of the latest beat whose trigger fired.
- **The server** checks the **goal** only, on the same projected events and view of player 0 (so both agree), and
  ends the chapter when it holds: it queues a `Forfeit` of the scripted side, a normal command in the journal, so the
  match ends with `match_end` (the player wins, `reason = forfeit`). No protocol change; the client knows it is in a
  chapter (it started it) and shows the chapter result instead of the match result.
- Alternative: a new `EndReason.TUTORIAL` (a cleaner record, `PROTOCOL_VERSION`++). Not needed for the first version.

### 7.6 Server

- `POST /api/tutorial-matches {chapter}` (`gow_server.tutorial`): loads the chapter file, its map from
  `maps/tutorial/`, the main ruleset; seat 0 the player, seat 1 the `ScriptedBot`; unrated, private (one pause),
  not a bot level of `botmatch` (no `@level`). It goes through `MatchLifecycle` like a bot match: `claim` (one active
  match per player), the caps (`GOW_MAX_BOT_MATCHES`: a scripted match is cheap but still a match), the connect
  timeout. No replay file is kept (a chapter is scripted; the headless tests are its record).
- **The match row:** a new column `matches.kind` (`match` | `tutorial`, Alembic migration, default `match`), so the
  profile, the stats and the result counters skip chapters. The first match after the tutorial is an ordinary bot
  match (`POST /api/bot-matches {level: "easy", map_id: "narrows"}`), kept and listed like any.
- `GET /api/ruleset`: `RulesetPublic.from_ruleset` of the main ruleset (unscaled; the reference says smaller maps are
  slower). Public, cacheable. `api.gen.ts` by `regen:api`.

### 7.7 Client

- **Screens** (Svelte, `app/tutorial/`): the intro, the result, the chapter select; the Plinth frame and the stone
  of section 69 of `ui-style.md`; the entry from the main button (`app/play.ts`).
- **In a chapter:** the match screen as it is, plus a `TutorialCoach` (HTML over the map): the hint card and the goal
  highlight. The highlight of a place on the map is drawn by PixiJS in the effects layer (a baked ring sprite,
  `render/bake.ts`, one texture), the hint card and its leader are HTML (`AGENTS.md` 7.2). The exit dialog reads
  "Leave the chapter".
- **All strings** through `t()`, keys `tutorial.*`; every rule number from `ruleset_public` (formatted by the existing
  `hud/format.ts`), every key from the player's bindings (`keyLabel`).
- **Hints of the first match:** `hud/HintCoach.svelte` fed by the event stream and the view (section 5), on only in a
  match the tutorial started (a flag of the session), plus a "Show hints" setting.
- Reduced motion: the highlight pulses become a still double ring; the card appears without the slide.

### 7.8 Progress

`localStorage` `sbf.tutorial` (wrapped in `try`, as the other `sbf.*` keys): `{"v": 1, "done": ["move", "fight"],
"skipped": false, "firstMatch": false, "hints": ["H1", "H7"], "hintsOff": false}`. A guest and an account on the same
browser share it (owner decision 5: "in the browser"). No server state.

### 7.9 Versions, DEC, protocol

| Change | Needs |
|---|---|
| Rules | none: no DEC, no `SIM_VERSION`, no golden replays |
| Chapter files (new Pydantic model) | the schema and `protocol.gen.ts` by `regen` (no WebSocket message changes, so no `PROTOCOL_VERSION` by `AGENTS.md` 6 as long as no message carries it) |
| `POST /api/tutorial-matches`, `GET /api/ruleset` | `api.gen.ts` by `regen:api` |
| `matches.kind` | an Alembic migration |
| Validator `--checks`, the tutorial glob of the map tasks | `mise.toml` and `AGENTS.md` section 3 in the same PR |
| The removal of How to play v1 | `regen:howto` gone from `mise.toml` and `AGENTS.md` |
| Only if the owner wants the numbers in H5 and H7 (Q5) | `starvation` and `victory.capital_multiplier` in `RulesetPublic`, `PROTOCOL_VERSION`++ |

### 7.10 Implementation in three PRs

| PR | Contents | Estimate |
|---|---|---|
| 1. Server, bots, data | the three maps and chapter files; `gow_protocol.tutorial`; `ScriptedBot`; `POST /api/tutorial-matches` with the goal check and the closing `Forfeit`; `GET /api/ruleset`; `matches.kind`; the validator profile and the map tasks; headless tests of every chapter and failure branch (section 4, "Verified") | M, 2 to 3 days |
| 2. Client: chapters | the entry and Skip, intro, chapter select, result, the coach (card, leader, map highlight), the exit wording, progress; Vitest of the beat walker on recorded event streams; `shots` of the new screens; the `visual` references | L, 3 to 4 days |
| 3. Client: first match and reference | the hints of section 5 with their triggers and the "Show hints" setting; the rules reference on `GET /api/ruleset`; the removal of How to play v1 and `regen:howto` | M, 2 days |

Two numbers the hints could quote are not in `ruleset_public` today: the starvation (H5) and the capital's VP
multiplier (H7, DEC-03). The drafts avoid them; if the owner wants them (Q5), PR 3 adds both to `RulesetPublic` in one
`PROTOCOL_VERSION` bump.

---

## 8. The mockup

[`mockups/tutorial.html`](mockups/tutorial.html): self-contained (the fonts are the client's own, SIL OFL; the map
frames are the real client: the chapter frames are the chapter maps of section 4 played on the simulation and drawn
by the client, the first-match frames are dev scenes of the artery map). One element at a time, one button per
variant, one large view; the state is in the address (`#el=card&v=b`).

| Piece | Variants | Recommended | Why |
|---|---|---|---|
| Hint card of a chapter | A Leader (a plate tied to the place by a ruled leader), B Tablet (a stone tablet docked at the bottom), C Banner (a strip hung from the top bar) | **A Leader** | the words sit where the eye already is, in the map tip language the owner chose (ui-style 63); B is the fallback if a beat's text grows; C competes with the alert strips and the VP rail |
| Goal mark on the map | A Compass (a double ring, four compass points turning once), B Lantern (the rest of the map dims), C Burin (a ring engraved in, with ticks and a pointer) | **A Compass** | reads at a glance on every terrain, leaves the map readable; B looks like the fog veil (a false meaning), C's pointer is generic |
| Chapter intro | A Plinth (the main screen's plinth with the chapter), B Sheet (a sheet on blurred stone with the chapter map and the goal) | **A Plinth** | the first Play turns into Start without leaving the screen; B shows the goal earlier but is one more page |
| Result | A Seal (a stone window over the chapter's last moment), B Page (a page like the match result) | **A Seal** | keeps what the player just did in sight, one click to the next chapter |
| Chapter select | A Road (the chapters as places on one road, the first match the enemy capital at its end), B Cards (four cards with the chapter maps) | **A Road** | the game's own picture of progress; B is plainer and denser |
| Hint of the first match | A Toast (in the toast column, Go there takes the camera), B Leader (tied to the place) | **A Toast** | calm in a real match, never covers the action, the existing "message with a place" (ui-style 10.4) |

Checked with `design:design-critique`, `design:accessibility-review` (contrast of every text pair 6.9:1 or more,
marks ivory on a dark casing, never a player or alert colour; motion stops by itself and "Less motion" holds it
still) and `design:ux-copy` (the strings of section 4 and 5 are the reviewed drafts).

---

## 9. Open questions

- **Q1.** Is `narrows` (29 nodes, the smallest pool map) right for the first match, or a generated small map?
- **Q2.** Should the hints stay on for later matches until each has been shown once (today's draft: only the first
  match), with "Show hints" in the settings?
- **Q3.** Does the forced entry also apply to a new account (not a guest)? The draft: guests only, as decided.
- **Q4.** Add H8 "Strike together" (DEC-48 group order) to the hints? It is the owner's own winning pattern.
- **Q5.** H5 and H7 without the starvation numbers and the capital's x3, or add both to `ruleset_public` (one `PROTOCOL_VERSION` bump)?
