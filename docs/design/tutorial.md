# How to play: the tutorial round (#806)

**Status.** The structure (five main chapters, the first match, an optional Advanced side road) and the look are the
owner's decisions of 2026-11-13 **[accepted]**; the owner's review of the walkthrough (2026-11-13, round 3) is binding
and is built in: no concept before its explanation, the HUD gated per beat, actions locked per beat, the simulation
paused while a card explains, failures only where the failure is the lesson (section 1); so is the owner's second review
(round 4, 2026-11-13: no number the interface shows or a newcomer does not need, no caption that repeats the card or the
mark, short natural sentences, two buttons on the Seal). The defaults of section 9 are in force until the owner changes
them. No game code exists yet; section 7 is the plan for it. The mockup is
[`mockups/tutorial.html`](mockups/tutorial.html) (the chosen look); the whole tutorial, screen by screen with the final
copy and the gating, is the walkthrough [`mockups/tutorial-walkthrough.html`](mockups/tutorial-walkthrough.html)
(section 8). The texts of section 4 and section 5 are the final copy; the walkthrough shows them on the real frames.

The tutorial teaches the main ruleset `rulesets/mvp-7.toml`. Every rule below is checked against
[`mechanics.md`](mechanics.md) (DEC numbers in the tables), every chapter script was played on the real simulation
(`gow_sim`, `mvp-7`, map tempo included) and its outcome is written next to it with its ticks (section 4, "Verified").
No rule is added or changed: the tutorial needs no DEC and no `SIM_VERSION`.

Contents: 1 the owner's decisions; 2 what is taught and where; 3 the screens and the flow; 4 the chapters (with the
gating, the locks and the pauses of every beat); 5 the hints of the first match; 6 the rules reference; 7 the technical
plan; 8 the look; 9 open questions.

---

## 1. The owner's decisions [accepted]

**Round 1 (2026-11-13), kept.** The opponent of a chapter is scripted (an exact command sequence, the lesson is always
the same), the first match is against `@easy`. A new guest's first "Play" starts the tutorial, with a visible "Skip";
it is reachable later from the menu. Completed chapters are kept in the browser; any chapter can be replayed. The old
How to play text page becomes a short rules reference whose numbers come from `ruleset_public`; `regen:howto` and the
v1 text go away when the tutorial lands. The combat rules card of #766 was closed into this issue (2026-11-09): its
rows are covered by chapters IV and V and the reference.

**Round 2 (2026-11-13), the structure.**

1. **Five main chapters**, then the first match against `@easy`, plus an optional **Advanced** side road:
   - **I. Units and movement:** a unit, the helmet and its number, moving, capacity, a capture costs a charge (the
     helmet's fill), cancelling an order, vision by terrain, speed by terrain.
   - **II. Map and economy:** CP (what they are, where they are shown, what they buy), the capital's charges, the roads
     carrying them to the front by themselves, warehouses and units filling up from them, a cut-off pocket and its
     starvation.
   - **III. Building:** factories and barracks, paying a building with the units' own charges (progressive payment,
     DEC-41 item 7), recruiting, and the stances (Economy, Balance, War) as the throttle of the economy.
   - **IV. Attack and fight:** a charge is a shot, rounds, planned orders and their bonus (visible to the enemy), no
     retreat, how to win (VP, the capital, the match clock).
   - **V. Defence:** terrain in a fight (DEC-45: plains bad for the defender, mountains good), road fortifications,
     answering a visible planned strike.
   - **Advanced (optional):** "Group orders" (DEC-48 `GroupMove`), then "Rally points" (DEC-48 `SetRallyPoint`).
2. **Each chapter is 1 to 2 minutes with one clear goal** (several beats allowed). "Skip" is on every screen, and the
   player may go to the first match after any chapter.
3. **The first match** keeps its hints, shrunk to what the chapters do not cover (section 5).
4. **The look** (mockup round 1): hint card **Leader**, goal mark **Compass**, chapter intro **Sheet**, chapter result
   **Seal**, chapter select **Road**, hint of the first match **Leader** (section 8).

**Round 3 (2026-11-13, the owner's review of the walkthrough).**

1. **A concept is never used before it is explained.** The chapter order stays (units first). Chapter I has no CP on
   screen and no word about prices (it starts at the CP cap, so CP never block); CP appear in chapter II with their
   explanation. Chapter I introduces a charge only as "the helmet's fill; a capture costs one"; where charges come from
   and how units refill is chapter II. Every screen was audited for this (the list is in the PR of round 3).
2. **The hint style:** one idea per card, plain words, what it is and how it looks on screen. Chapter I's texts are
   the owner's, polished (section 4.1); the other chapters are rewritten in the same style.
3. **Tutorial mechanisms** (section 4, common rules; section 7):
   - **UI gating:** every beat says which HUD pieces and map marks are visible (`ui`). No match timer in the
     tutorial, except the one beat of chapter IV that explains how to win. Stances hidden until chapter III.
   - **Action locks:** every beat lists the commands it allows (`allow`); everything else is disabled in the client and
     refused by the server.
   - **Freeze:** while a card explains, the simulation is paused (`pause`); it resumes on "Continue" or when the player
     gives the asked command.
   - **Failures:** a failure branch stays only where the failure is the lesson (chapter IV: an ordinary attack bounces
     where a planned one wins); every other mistake is prevented by a lock or a pause.
4. **The walkthrough** shows the gating: only the unlocked HUD, locked controls disabled, paused screens marked.

**Round 4 (2026-11-13, the owner's second review: "avoid extra text in the game").**

1. **No number the interface already shows or a newcomer does not need.** A card keeps a number only when its lesson
   cannot be understood without it and the screen does not show it; since this round no card quotes a ruleset number
   (prices are in the menus and the order ghost, capacity in the ring, the factory limit in the counter, the bonus on
   the wheel and the pill, the countdowns on the marks). The rules reference keeps the numbers a player looks up
   (section 6).
2. **No duplicate or redundant captions.** No pointer line ("Look at the top left", "Watch the rounds"): the Compass
   mark already points. An action line stays only when it tells the player something the card and the screen do not
   (what to click or press); a card that already says what to do has none.
3. **Natural sentences:** short, plain English, one idea per card, no stacked facts. Chapter I keeps the meaning the
   owner approved in round 3, trimmed the same way. Every card of section 4 and every hint of section 5 was rewritten;
   the cards went from 1145 words to 769 (46 cards and hints, say and action lines).
4. **The chapter result (Seal) has two buttons:** "All chapters" (primary) and "Replay chapter" (secondary, a real
   button). No "Next chapter" and no "Play your first match" on it: the player goes on from the chapter select, and
   leaves to the main menu from there (section 3).

---

## 2. What is taught, and where

The list is the main ruleset `mvp-7` as of 2026-11-13. "Field" is where the number on screen comes from: a
`ruleset_public` field of the match (the rules the match plays, map tempo applied, `gow_server.ws` sends
`RulesetPublic.from_ruleset(match.rules)`), or a field of the player's own view. Numbers are never typed into a string
(`AGENTS.md` 7.1). Since round 4 no card quotes a ruleset number (section 4.0): what a beat needs is on the HUD, a
menu or a mark, and the `ruleset_public` fields are what the rules reference (section 6) quotes. "Where" is the beat
that explains the rule; nothing of it is on screen or in a text before that beat.

| # | Rule (as the player meets it) | Source | Where | Field |
|---|---|---|---|---|
| R1 | A group is units; the number on the helmet is how many | mechanics 3; ui-style 9.5 | I.1 | none |
| R2 | Moving: select a group, click a place; cancelling an order turns a marching group back | DEC-20 item C | I.2, I.5 | none |
| R3 | A place holds only so many units: its capacity, one segment of its ring per unit | DEC-20 item D; DEC-22 | I.3 | `NodeView.capacity` |
| R4 | Taking a place costs a charge; the helmet's fill shows the charges | DEC-38; ui-style 9.5 | I.4 | `capture.charge_cost` |
| R5 | You see only the places next to your groups; open ground exactly, a forest as a range, mountains least | DEC-21; DEC-35 | I.6 | `vision.by_terrain` (no number in the text) |
| R6 | Units are faster on plains and slower in mountains | mechanics 4 (speed by terrain zones) | I.7 | `terrain.speed_pct` (no number in the text) |
| R7 | CP pay for orders and come back at a flat rate up to a cap | DEC-02; DEC-44 | II.1 | `cost.move`, `cp.per_period`, `stances.cp_period_ticks`, `cp.cap` |
| R8 | The capital makes charges; the roads carry them toward the front by themselves | DEC-41 items 2, 9; DEC-43 item A; DEC-50 | II.2 | `stances.capital_period_ticks` |
| R9 | Each place stores charges in its warehouse (the diamonds under it); units standing there fill up from it; the amber sign means they wait for charges | DEC-41 item 13; DEC-43 item C | II.3 | `NodeView.warehouse_cap` |
| R10 | A place cut off from the capital gets no charges; without a factory its units starve after a grace | DEC-43 item H; DEC-19 | II.4 | `NodeView.starve_in` (the countdown mark; no number in the text) |
| R11 | A factory makes charges like the capital; it is paid in charges, first from the warehouse, then by the units standing there; the top bar counts factories, at most a few | DEC-41 items 2, 7; DEC-47 | III.1, III.2, III.4 | `factory.cost`, `stances.capital_period_ticks`, `factory.max` |
| R12 | A barracks lets a city recruit, paid the same way; a recruit costs CP and arrives empty | DEC-26; DEC-41 item 7; DEC-25 | III.3, III.5 | `city_upgrades.barracks_charges`, `cost.recruit`, `recruit.unit_ticks` |
| R13 | Stances: Economy more charges and fewer CP, War the other way, Balance between; free | DEC-44; DEC-47 | III.6 | `stances.*` (no number in the text) |
| R14 | In a fight a charge is a shot; two shots cancel each other; a shot that meets none kills a unit, empty ones first | DEC-07 rules 1 to 3 | IV.1 | none |
| R15 | A planned order costs as much as an ordinary one, waits and gathers +1 bonus shot per warehouse charge at a fixed pace, then sets off; bonus shots fire first; the enemy sees where, never how strong | DEC-41 item 10; DEC-48; mechanics 5; `AGENTS.md` 4.4 | IV.3, IV.4, IV.5 | `cost.planned_move`, `orders.plan_ticks_per_bonus` |
| R16 | A fight runs in rounds, one shot a side a round | DEC-24 items B, F1; DEC-32 | IV.6 | `combat.round_ticks` |
| R17 | No retreat: a group in a fight stays until it ends; groups that arrive join it | DEC-40; DEC-24 item D | IV.7 | `combat.retreat` |
| R18 | Winning: the enemy capital wins at once; otherwise every 30 s each city gives VP and more VP wins when the clock runs out | DEC-03 | IV.8 | `victory.vp_period_ticks`, `match_ticks`; `View.vp_gain` |
| R19 | Terrain helps or hurts only the defender of a place that has a charged unit: mountains a bonus shot, plains burn a charge at the first round, forest nothing; the chevron by a helmet shows it | DEC-07 rule 1; DEC-45 | V.2 | `combat.terrain_defense_mod`; `NodeView.terrain_mark` |
| R20 | A road fort costs CP, works after a build time, and takes a charge per started 3 units from an enemy crossing it toward its place; a capture destroys it | DEC-43 item D | V.4, V.5 | `fort.cost`, `fort.build_ticks`, `fort.toll_units`, `fort.toll_charges` |
| R21 | A group order: several groups, one order; to an enemy place they arrive in one tick (full price), to an own place they rally (half price) | DEC-48 items A to E | Advanced 1 | `cost.move`, `group_order.rally_pct` |
| R22 | A rally point: the new units of a city with a barracks walk to an own place by themselves, for half a CP each when they leave | DEC-48 item H | Advanced 2 | `recruit.rally_cost` |
| R23 | Over its capacity a place loses a unit at a fixed pace | DEC-12 | First-match hint H2 | `capacity.attrition_ticks`; `NodeView.attrition_in` |
| R24 | Bigger maps are faster: the economy periods scale with the node count | DEC-46 | First-match hint H1 | the periods of `stances.*` of that match |

Left to the rules reference only: splitting a group (the client's split tip explains itself once capacity is known),
the engagement zone (DEC-37), enemy buildings seen from a neighbouring place (DEC-31).

---

## 3. The screens and the flow

```
first "Play" of a new guest ─┐                  ┌─ Skip ──────────────> the action the player chose (queue, bot, invite)
"?" > Tutorial (any time) ───┴─> Intro I (Sheet) ┤
                                                 └─ Start ─> I ─> Seal ─┬─ All chapters ──> the Road
                                                                        └─ Replay chapter ─> I again

the Road (chapter select) ─> any open intro (II ... V, Advanced A1, A2 after V) ─> the chapter ─> Seal ─> ...
                          ─> the first match (always open)
                          ─> the main menu (back)
```

| Screen | What is on it | Comes from | Goes to |
|---|---|---|---|
| **Chapter intro (Sheet)** | "Tutorial · Chapter N of V" (Advanced: "Advanced · 1 of 2"), the name, one sentence, the goal list, a crop of the chapter map with the goals ringed, Start; "Skip the tutorial" (the first entry) or "All chapters" | the first Play of a new guest; the Road | the chapter, the action the player chose (Skip), the Road |
| **Chapter** | the match screen with only the unlocked HUD (section 4, "Shown"), the hint card (Leader), the goal mark (Compass), the "Paused" plate while the simulation waits; no start banner (beat 1 takes its place); the exit button reads "Leave the chapter" | intro | Seal, or the Road (leave) |
| **Result (Seal)** | a stone window over the chapter's last moment: the seal, "Complete", the three lessons, two buttons: "All chapters" (primary) and "Replay chapter" (secondary) | the goal of the chapter | the Road, the chapter again |
| **Chapter select (Road)** | the main road I to V ending at the enemy capital (the first match, always open), the Advanced side road branching off after V with its two places, done marks, a plinth with the selected place and Start; "Rules". A main chapter opens when the one before it is done (a locked place reads "After II"); the Advanced chapters open when V is done (they use CP, fights and recruits; Q8) | "?" on the main screen; "All chapters" | any open intro, the first match, the rules reference |
| **First match** | a normal bot match (`@easy`, `narrows`) with the full HUD and the hints of section 5 | the Road | the normal result screen |
| **Rules reference** | one page of short rules with live numbers (section 6) | the Road | back |

**Entry.** `sbf.tutorial` (section 7.8) absent and the player is a guest (default, Q3): the first press of the main
button (Search, Start or Get the link) opens the intro of chapter I instead; "Skip the tutorial" sets `skipped` and
runs the action that was pressed. The New here dialog of #919 (`app/NewHereDialog.svelte`, off today) is not needed: its
job is the intro. An account that already played a match never gets the forced entry.

**Skip everywhere.** The intro has "Skip the tutorial"; a chapter has "Leave the chapter" (the exit dialog, worded
like the match's: eyebrow the chapter, title "Leave the chapter?", "You can come back at any time. It will start
over.", buttons "Leave the chapter" and "Keep playing" (primary); leaving goes to the Road, nothing is lost: a chapter
always restarts from its start); the Road offers the first match at any time. Replaying a chapter is a fresh match
every time.

**After any chapter** (round 4). The Seal has two buttons only: "All chapters" (primary) goes to the Road, where the
next chapter is the selected place, and "Replay chapter" (secondary, a real button) starts the chapter again at once.
The Seal offers neither the next chapter nor the first match: the player goes on from the Road, which keeps the first
match open from the start, and leaves to the main menu from there. After the first match the tutorial counts as
finished (`firstMatch: true`); the Advanced road stays on the Road.

---

## 4. The chapters

### 4.0 Common rules

- **Ruleset** `mvp-7` unchanged, with its map tempo. The chapter maps have 6 to 9 nodes, so the clamp `min_pct = 50`
  doubles the economy periods: the capital (and every factory) makes a charge per 40 s in Balance (20 s Economy, 80 s
  War), CP come 0.5 per 10 s in Balance (20 s Economy, 8 s War). No card quotes these numbers (round 4); the HUD shows
  what the chapter plays, and the first match plays its own (hint H1). The one exception is the starting CP: a
  chapter may start at another `cp.start` (`cp_start`, section 7.3); chapter I starts at the cap, `cp.cap`, so the
  hidden CP never refuse an order.
- **The player is player 0**, the scripted opponent player 1 (the map's `capital_of` decides it). Balance
  (`economy.start_stance`).
- **Every text is final copy** for `t()` (keys `tutorial.<chapter>.<beat>`, the action `tutorial.<chapter>.<beat>.act`),
  English only (`AGENTS.md` 7.4); key names in braces come from the player's bindings (`keyLabel`), a place name (H2)
  from the view, never typed in. The walkthrough shows them with the default keys.
- **A beat** is one hint card: it shows when its trigger fires and stays until the next beat's trigger. Triggers are
  facts of the player's own projected data (section 7.5): the chapter start, an event, the acceptance of the player's
  own command, a field of the player's view, a delay, "Continue" on the card before, or (client only) a selection.
  The goal mark follows the beat. **One idea per card**, in a sentence or two of plain English: what it is and how it
  looks on screen. **The action line** (under a rule, italic, with the key or mouse glyph) is there only when it tells
  the player something the card and the screen do not, what to click or press: never "watch" or "look at" (the Compass
  mark points), never a repeat of the card. **No number** the HUD, a menu or a mark shows, and none a newcomer does not
  need (round 4).
- **Shown (`ui`).** A chapter starts with the HUD of the chapters before it, and its beats unlock more (section 4.8,
  the table). A piece not yet unlocked is **hidden**: a top-bar piece, a map mark, a tooltip line. An item of a menu
  the player can open (the city menu, the group menu) whose concept is not unlocked, or whose command the beat does
  not allow, is **shown locked**: dimmed, its icon only (no price, no key), a small lock, no hover; the same for an
  unlocked top-bar control the beat does not allow (the stance chip in chapter IV). The first match shows everything.
- **Allowed (`allow`).** Each beat lists the commands it allows, with their places (a move from where to where, a build
  where, how many). Selecting, the camera, the help and leaving are always allowed. Anything else is disabled in the
  client (a click on a target that is not allowed does nothing but pulse the card's action line) and refused by the
  server (section 7.6). A beat triggered by a selection keeps the `allow` of the beat before it.
- **Paused (`pause`).** A card that explains pauses the simulation at the end of the tick its trigger fired:
  - `continue`: the card has a "Continue" button; the simulation resumes on it, and the card stays (without the
    button) for what it asks the player to watch;
  - `action`: the card asks for a command; the simulation resumes when the server accepts the first allowed command of
    the beat, so the player is never rushed and nothing happens behind the card;
  - none: the simulation runs (a card that only comments on what is happening).
  The "Paused" plate (top centre, where the start banner of a match is) shows while the simulation waits. A pause adds
  no tick: the "Verified" ticks below are the simulation's, with the player acting on the tick after each pause.
- **Failures.** A failure branch stays only where the failure is the lesson: chapter IV's ordinary attack that
  bounces (beat IV.F). Every other mistake is prevented: by `allow` (no wrong target, no wrong group, a bounded number
  of cancels, recruits, orders), by `pause: action` (no time pressure: a cut-off place, a coming strike), by the chapter
  data (chapter I's capital starts with an empty warehouse, so no unexplained refill). A failure card shows "Try again"
  in its head instead of the step lozenges.
- **A beat that fires with the goal** (A1.5) would be hidden at once by the Seal: when the goal holds, the client keeps
  the last frame and that card, with a "Continue" button, and shows the Seal on Continue. Other chapters go to the Seal
  at once.
- **In the rules reference** whole seconds are written without a decimal ("20 s", not "20.0 s"), CP with one ("0.5 CP").
- **The intro** of each chapter: the sentence and the goals below (**Intro**, **Goal**).
- **The map world** is 1200 x 700 world units (a 16:10 window). The maps live in `maps/tutorial/` (section 7.2); the
  map tables below are the drafts of the map files, and the roads take `travel_ticks` from their length (`round(length
  * 30 / 100)`), every border point at 500.
- **Verified** lines give the ticks of the real simulation (10 ticks = 1 s) for the commands named there, the player
  acting on the tick after each paused card.

The beat tables: **Trigger**; **The card says** (bold as on the card); **Action** (the italic line; "none": the card has
no action line); **Pause** (`continue`, `action`, or none); **Allowed** (the commands the beat allows; "as before": the
beat before it; "none": nothing but selecting, the camera, help and leaving); **Unlocks** (the `ui` pieces the beat
adds, section 4.8).

### 4.1 Chapter I: Units and movement (about 1 minute)

**Intro:** "March, take places, change your mind, and see what your army sees." **Goal:** take Ashford, Elmstead and
Fordham.

**Map `tut-move`** (9 nodes; units/charged; stock is the warehouse at the start):

| Node | x, y | Terrain | Kind | Owner | Units | Stock |
|---|---|---|---|---|---|---|
| Highhold | 190, 350 | mountains | capital | you | 3/3 | 0 |
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

**Chapter data:** `cp_start` = `cp.cap` (5 CP: the five orders of the chapter never meet a refusal while CP are
hidden). The army is 3 units, all charged, and the capital's warehouse starts **empty**: the three captures spend the
army's three charges, and no charge reaches it during the chapter (the capital's first charge comes at 40 s and stays
in its warehouse), so the helmet's fill only drops, as beat I.4 says. 3 units fit a province (capacity 3), so no split
comes up (splitting is left to the client's own tip, R-list note). Kestrel (plains) and Brackenfold (mountains) are the
two enemy towns the player sees from Elmstead (forest): one as a range, one as "an enemy is there".

**Shown at the start:** the map, the top bar's sound, help and Leave. Nothing else (section 4.8).

| Beat | Trigger | The card says | Action | Pause | Allowed | Unlocks |
|---|---|---|---|---|---|---|
| I.1 | chapter start | "This is your **army**. The number on the helmet is how many units it has." | "Click the helmet to select it" | `action` | move Highhold to Ashford | |
| I.2 | the group is selected (UI) | "To march, click a **city** or a **province**." | "Click Ashford" | (as before) | as before | |
| I.3 | the move to Ashford accepted | "A place holds only so many units: its **capacity**, one segment of its ring per unit." | none | `continue` | none | |
| I.4 | `node_captured` Ashford by you | "Every capture costs a **charge**. The helmet's fill shows your charges, and it just dropped." | "March on to Elmstead" | `action` | move Ashford to Elmstead | |
| I.5 | 2 s after the move to Elmstead was accepted | "Changed your mind? Press **{cancel_key}** to cancel the order." | "Then send the army to Elmstead again" | `action` (on the cancel) | cancel that order (once); move Ashford to Elmstead | |
| I.6 | `node_captured` Elmstead by you | "You see only the places next to your groups. From this forest, Kestrel shows **a range** of units, Brackenfold only **that someone is there**." | none | `continue` | none | |
| I.7 | Continue on I.6 | "**Terrain** sets your speed: faster on plains, slower in mountains." | "Now take Fordham" | `action` | move Elmstead to Fordham | terrain mode (`{terrain_key}`) |
| done | Ashford, Elmstead and Fordham are yours (`NodeView.owner` of each) | Seal | | | | |

`{cancel_key}` is the player's `cancel` binding (default X). With nothing selected it undoes the last order; with the
marching group selected it cancels that group's order (`help.key.cancel`): both turn the army back here, so the card
names neither.

**Opponent script:** none (its towns stand still).

**Verified** (`mvp-7`, `cp.start` 500): the move at tick 1: Ashford taken at 65 (the group 3/2). The move to
Elmstead at 66, beat I.5 at 86 (the group a third of the way), the cancel at 87: back in Ashford at 107
(`group_arrived`, `back`); sent again at 108: Elmstead at 161 (3/1). From Elmstead the view shows Kestrel at `range` and
Brackenfold at `presence`. Fordham (ordered at 162) at 271 (3/0); from Fordham Kestrel is `exact`. CP: 5, 4, 3, then
3.5 with the income, 2.5, 1.5, never lower (at the ruleset's 3 CP the order to Fordham is refused, `NOT_ENOUGH_CP`).
No packet moves during the chapter (the capital's first charge comes at 400).

### 4.2 Chapter II: Map and economy (about 1 minute)

**Intro:** "Orders cost command points. Charges flow from your capital to the front, unless the road is cut." **Goal:**
keep Westmarch supplied: retake Coldwell.

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

Westmarch starts with 3 empty units, so the player watches the roads fill them. Its only road home runs through
Coldwell, so a raid on Coldwell cuts it off. No order is allowed before the cut, so no fight happens in this chapter
(fights are chapter IV).

**Shown at the start:** chapter I's, plus the CP gauge and the notices (toasts).

| Beat | Trigger | The card says | Action | Pause | Allowed | Unlocks |
|---|---|---|---|---|---|---|
| II.1 | chapter start | "These are your **command points**, CP. Every order costs some, and they refill on their own." | none | `continue` | none | CP gauge, notices |
| II.2 | 3 s after Continue on II.1 | "Your capital makes **charges**, and your roads carry them to the front on their own." | none | `continue` | none | charges on roads |
| II.3 | the first own `packet_delivered` at Westmarch | "Each place stores charges in its **warehouse**, the diamonds under it. Units there fill up from it; {warn_sign} means they are still waiting." | none | `continue` | none | warehouses |
| II.4 | Westmarch has `starve_in` set (the enemy took Coldwell) | "The enemy took Coldwell, so **Westmarch is cut off**. No charges reach it, and soon it starts losing them." | "Retake Coldwell with Millbrook's group" | `action` | move Millbrook to Coldwell | pocket and starvation marks |
| done | `node_captured` Coldwell by you after II.4 | Seal | | | | |

`{warn_sign}` in II.3 is the amber "waiting for charges" sign of the map, drawn inline in the card.

**Opponent script:** at tick 200 the group of Ridgeway to Coldwell (an ordinary order); when Coldwell becomes its own,
that group goes back to Ridgeway (a step with a `when`, section 7.4).

**Verified** (`mvp-7`): the first packets leave Highhold at tick 10 and are on the roads at 30 (beat II.2); the first
one reaches Westmarch at 124 (its group 3/1; 3/3 at 244). The raid leaves Ridgeway at 200 and captures Coldwell at 267:
Westmarch is a pocket at once (`flow_pocket = true`, `starve_in = 100`), the raiders leave at 268. The player's order at
268 retakes the empty Coldwell at 328, before any `starvation` (the first would come at 367).

### 4.3 Chapter III: Building (about 1 minute)

**Intro:** "Build with your units' own charges, recruit, and set the pace of your economy." **Goal:** build a factory
in Millbrook; build a barracks in Fernhill and recruit a unit; switch to Economy.

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

**Shown at the start:** chapter II's (CP, notices, charges on roads, warehouses, pocket marks). The city menu shows
only the item the beat allows; the others are locked (section 4.0).

| Beat | Trigger | The card says | Action | Pause | Allowed | Unlocks |
|---|---|---|---|---|---|---|
| III.1 | chapter start | "A **factory** makes charges, like your capital." | "Click Millbrook, then Factory" | `action` | build a factory in Millbrook | buildings (marks, the menu's Factory and Barracks) |
| III.2 | the first own `build_paid` with `units > 0` | "The warehouse was empty, so **the units there paid** with their own charges. Your roads will refill them." | none | `continue` | none | |
| III.3 | `build_paid` of the factory with `owed = 0` | "A **barracks** lets a city recruit new units. It is paid the same way." | "Click Fernhill, then Barracks" | `action` | build a barracks in Fernhill | |
| III.4 | `factory_built` | "Your factory is working. This counter shows your factories and the limit." | none | `continue` | none | the factory counter |
| III.5 | `barracks_built` | "Fernhill can recruit now. New units arrive empty and fill up." | "Select Fernhill and press {recruit_key}" | `action` | recruit in Fernhill (once) | recruiting (the menu item, the key, the queue marks) |
| III.6 | `recruited` | "Your **stance** sets the pace: **Economy** for more charges, **War** for more CP. You start in **Balance**." | "Press {stance_key} and pick Economy" | `action` | set the stance to Economy | the stance chip and menu |
| done | `factory_built` Millbrook, `barracks_built` Fernhill, a `recruited`, a `stance_changed` | Seal | | | | |

No failure branch: every command the beats ask for is the only one allowed, and its place is fixed.

**Opponent script:** none.

**Verified** (`mvp-7`): `BuildFactory(Millbrook)` at tick 1: `build_paid` at once with `units = 3` (the group 3/0)
and `owed = 1`, the last charge from the roads at 66 (`owed = 0`), `factory_built` at 166. `BuildBarracks(Fernhill)`
at 67: `units = 2` at once, paid at 70, `barracks_built` at 170. `Recruit(Fernhill)` at 171: `recruited` at 200.
`SetStance(economy)` at 201. Millbrook's group is 3/2 at 166 and at 200.

### 4.4 Chapter IV: Attack and fight (about 1.5 minutes)

**Intro:** "Gather a bonus in the open, strike with it, then take their capital." **Goal:** take Ashwood with a
planned order; take Stormcrown, their capital.

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
is chapter V; the terrain marks stay hidden). From Fernhold (forest) Ashwood (forest) shows a range, "1-2"; the
cards count no defenders. The chapter ends by itself: taking the enemy capital ends the match (`match_ended`,
`reason = capital`).

**Shown at the start:** chapter III's (the stance chip shown locked: no beat here allows it).

| Beat | Trigger | The card says | Action | Pause | Allowed | Unlocks |
|---|---|---|---|---|---|---|
| IV.1 | chapter start | "In a fight, every charge is a **shot**. Two shots cancel out; a shot that meets none kills a unit." | none | `continue` | none | |
| IV.2 | Continue on IV.1 | "Your charges are not enough to take **Ashwood** with an ordinary attack." | "Select your group in Fernhold" | `action` | move Fernhold to Ashwood (ordinary or planned) | |
| IV.3 | the group is selected (UI) | "A **planned order** waits and gathers **bonus shots**, and they fire first." | "Hold {planned_key} over Ashwood, turn the wheel to +3, then click" | (as before) | as before | planned orders (`{planned_key}`, the wheel) |
| IV.4 | your planned order accepted | "Your group gathers its bonus from the warehouse here, then sets off on its own." | none | none | none | |
| IV.5 | the enemy's planned intent appears | "That arrow is an enemy **plan**. You see where it goes, never how strong it is, and they see yours the same way." | none | `continue` | none | |
| IV.6 | `fight_started` at Ashwood | "A fight runs in **rounds**: each side fires one shot a round, **bonus shots first**." | none | `continue` | none | |
| IV.7 | the first `fight_round` at Ashwood with a loss | "**No retreat**: a group in a fight stays until it ends. Others can still join it." | none | `continue` | none | |
| IV.8 | `node_captured` Ashwood by you | "Ashwood is yours. **Take their capital** and you win. If time runs out, the most **VP** wins. Your cities earn them." | "Let your group refill" | `continue` | none | VP (rail and badges); the match clock for this beat only |
| IV.9 | your group in Ashwood is full (`charged = units`) | "Your group is full again. Take **Stormcrown**, their capital." | none | `action` | move Ashwood to Stormcrown | (the clock hidden again) |
| IV.F | `fight_ended` at Ashwood lost by you (an ordinary attack) | "Your charges ran out before Ashwood fell, so the group turned back. Let it refill, then **plan** the attack." | none | `continue` | a planned move Fernhold to Ashwood | planned orders, if not yet |
| done | `match_ended`, winner you (the capital) | Seal | | | | |

IV.F is the one failure kept in the tutorial: the bounce is the lesson of the plan. IV.2 allows the ordinary order on
purpose; after IV.F only the plan is allowed. The beats after a plan is accepted (IV.4 on) are the same on both paths.

**Opponent script:** at tick 20 the group of Thornwick, a planned order to Old Mill with a bonus of 1. Nothing else.

**Verified** (`mvp-7`): the player's planned order at tick 1 with a bonus of 3: +1 at 60, 90, 120, the group leaves at
120 (frame of IV.4 at 61). The enemy plan at 20 (beat IV.5), its bonus at 82, Old Mill taken at 138. Contact at
Ashwood at 198 (IV.6); rounds at 218 and 238 (a bonus shot against a real one), 258 (a bonus shot kills: IV.7), 278 (a
real shot kills): Ashwood taken at 278, the group 3/1 (IV.8). It is full again at 502 (IV.9); ordered at 503 to
Stormcrown: contact at 601, rounds 621 (cancel) and 641 (a kill), the capital taken at 641 and `match_ended`
(`winner = 0`, `reason = capital`). **Failure:** an ordinary order at 1: contact at 78, rounds 98, 118, 138,
`fight_ended` at 138 lost (one defender dies, the group bounces home empty; IV.F); home and full at 218, the plan at
219: +3 at 324, Ashwood taken at 442 (the group 3/2).

### 4.5 Chapter V: Defence (about 1 minute)

**Intro:** "Watch the mountains hold, then answer an attack on the plains." **Goal:** fortify the road from Eastfield
into Flatford; hold Flatford.

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
town (Flatford). Eastfield is a city so the group of 4 passes it (a province holds 3).

**Shown at the start:** chapter IV's without the clock (VP shown; the stance chip and the recruit item locked).

| Beat | Trigger | The card says | Action | Pause | Allowed | Unlocks |
|---|---|---|---|---|---|---|
| V.1 | an enemy group on a road toward Highcrag (the view) | "The enemy is coming for **Highcrag**, up in the **mountains**." | none | `continue` | none | |
| V.2 | `fight_round` at Highcrag with `virtual_0 > 0` | "**Mountains** give the defender a bonus shot. **Plains** cost the defender a charge as the fight starts. The chevron by a helmet shows which." | none | `continue` | none | terrain marks |
| V.3 | `fight_ended` at Highcrag, not captured | "Highcrag held against a bigger army, and nobody died." | none | none | none | |
| V.4 | the enemy's planned intent to Flatford appears | "A planned attack is coming for **Flatford**, on the plains. A **road fort** makes enemies crossing it lose charges." | "Select Flatford, press {fortify_key}, and fortify the road from Eastfield" | `action` | fortify Flatford's road to Eastfield | the warnings at the top; road forts (`{fortify_key}`, the menu item, the marks) |
| V.5 | your `FortifyRoad` on that road accepted | "Now send Millbrook's group to help Flatford." | none | `action` | move Millbrook to Flatford | |
| V.6 | your `toll_taken` | "The fort took its toll. With help in Flatford, the charge the plains take hardly matters." | none | none | none | |
| done | your `road_fort_built` on Flatford-Eastfield, and Flatford yours after a `fight_ended` at Flatford | Seal | | | | |

No failure branch: V.4 and V.5 wait for their commands, so the fort always works before the strike crosses it and the
help always arrives (Flatford fell in round 2 when the player was late).

**Opponent script:** at tick 10 the group of Ridgeway to Highcrag (an ordinary order). At 200 the group of
Stormcrown, a planned order to Flatford with a bonus of 1. When Flatford becomes its own, that group goes back to
Stormcrown (never fires now).

**Verified** (`mvp-7`): the attack leaves Ridgeway at 10 (V.1), reaches Highcrag at 99; rounds at 119 (the mountain
bonus, `virtual_0 = 1`: V.2), 139, 159; `fight_ended` at 159 with no losses, the attacker bounces home (V.3). The
strike is planned at 200 (V.4); the fort at 202 (V.5), works at 302; Millbrook's group sent at 203, in Flatford at 268
(4/4). The strike gathers its bonus at 258, pays `toll_paid` 2 charges at the fort's point at 384 (4 units: 2 started
threes; V.6), contact at Flatford at 415, the first round burns a defender's charge (`burned_0 = 1`), the fight ends at
475 with no losses, `winner = 0`.

### 4.6 Advanced 1: Group orders (about 40 s)

**Intro:** "Two groups, one order, one arrival." **Goal:** take Ashwood with one order for both groups.

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

The two groups are far apart on purpose: sent one by one they would arrive 66 ticks apart and fight two lost fights.
Only the group order is allowed, so that never happens.

**Shown at the start:** chapter V's (no clock), plus group selection (Shift).

| Beat | Trigger | The card says | Action | Pause | Allowed | Unlocks |
|---|---|---|---|---|---|---|
| A1.1 | chapter start | "Sent one by one, these groups would arrive one by one and fight alone." | "Click one of them" | `action` | a group order of both groups to Ashwood | group selection |
| A1.2 | a group is selected (UI) | "One **group order** sends both, and they arrive together." | "Shift-click the other group, then click Ashwood" | (as before) | as before | |
| A1.3 | your `GroupMove` accepted (`kind = attack`) | "**Fernhold waits** so both arrive together. The hourglass shows the wait." | none | none | none | |
| A1.4 | `fight_started` at Ashwood with both groups | "Together, they far outnumber the defenders." | none | none | none | |
| A1.5 | `node_captured` Ashwood by you | "The same order to your own place is a **rally**: the groups gather there for **half the price**." | Continue (it fires with the goal) | (goal) | none | |
| done | `node_captured` Ashwood by you | Seal (after Continue on A1.5) | | | | |

**Opponent script:** none.

**Verified** (`mvp-7`): `GroupMove((Fernhold, Lowfield), Ashwood)` at tick 1: both arrive at 141, one fight, Ashwood
taken at 221 (shots 4 against 2, the capture paid by the fifth charge; the group 5/0).

### 4.7 Advanced 2: Rally points (about 40 s)

**Intro:** "Recruits that walk to the front by themselves." **Goal:** set a rally point on Highhold; get two recruits
to Fernhold (they reach it by themselves).

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

**Shown at the start:** chapter V's (no clock), plus the rally point item and key.

| Beat | Trigger | The card says | Action | Pause | Allowed | Unlocks |
|---|---|---|---|---|---|---|
| A2.1 | chapter start | "Give your capital a **rally point**, and its recruits walk to the front by themselves." | "Select Highhold, press {rally_key}, then click Fernhold" | `action` | a rally point of Highhold on Fernhold | rally points |
| A2.2 | your `SetRallyPoint` accepted | "Highhold's new units will now walk to Fernhold. Each walk costs a little CP." | "Recruit two: press {recruit_key} twice" | `action` | recruit in Highhold (twice) | |
| A2.3 | the first own `rally_walk_paid` | "Your first recruit is walking to Fernhold. The second will follow." | none | none | none | |
| done | two own groups of `rally_walk_paid` arrived at Fernhold (`group_arrived`, then `groups_merged` there) | Seal | | | | |

No failure branch: two recruits at most (`allow` counts them), so the walks never lack CP (round 2's A2.F needed a
third recruit).

**Opponent script:** none.

**Verified** (`mvp-7`): `SetRallyPoint(Highhold, Fernhold)` at tick 1, `Recruit(Highhold)` at 2 and 3 (CP 3 to 1):
`recruited` at 31 and 61, `rally_walk_paid` at 32 and 62 (CP 0.5, then 0 plus the income), both walk via Wyre and
merge at Fernhold at 191 and 221 (Fernhold 3/3).

### 4.8 What is shown when (`ui`)

The HUD and map pieces a beat can unlock (section 7.7 names them in code). "From" is the beat that unlocks it; a later
chapter starts with it. "Locked" is shown but disabled (section 4.0).

| Piece (`ui` flag) | What it covers | I | II | III | IV | V | A1, A2 |
|---|---|---|---|---|---|---|---|
| always | the map (places, roads, owners, fog, ground), groups and their helmets, the capacity rings, names; select, camera, help (`?`), sound, Leave | on | on | on | on | on | on |
| `terrainMode` | the terrain mode (`{terrain_key}`) and its banner | from I.7 | on | on | on | on | on |
| `cp` | the CP gauge; every CP price (menus, tips, the order ghost) | | from II.1 | on | on | on | on |
| `notices` | the toasts of events | | from II.1 | on | on | on | on |
| `supply` | charges on roads; the pocket and starvation marks (from II.4, when they happen) | | from II.2 | on | on | on | on |
| `warehouse` | the warehouse diamonds, the amber "waiting for charges" sign, warehouse lines in tips | | from II.3 | on | on | on | on |
| `buildings` | building marks on cities, builds under way, the Factory and Barracks items of the city menu | | | from III.1 | on | on | on |
| `factories` | the factory counter of the top bar | | | from III.4 | on | on | on |
| `recruit` | the Recruit item and key, the queue marks | | | from III.5 | locked | locked | locked (A2: allowed) |
| `stance` | the stance chip and its menu (`{stance_key}`) | | | from III.6 | locked | locked | locked |
| `planned` | planned orders (`{planned_key}`, the wheel, the bonus pill) | | | | from IV.3 | locked | locked |
| `vp` | the VP rail, the VP badges of cities | | | | from IV.8 | on | on |
| `clock` | the match timer | | | | IV.8 only | | |
| `terrainMarks` | the terrain chevrons of defenders (DEC-45) | | | | | from V.2 | on |
| `alerts` | the warnings at the top (attacks on you, `{alert_key}`) | | | | | from V.4 | on |
| `fort` | road forts (`{fortify_key}`, the menu item, the marks) | | | | | from V.4 | locked |
| `groupSelect` | Shift-click and Shift-drag selection | | | | | | A1 |
| `rally` | the rally point item and key | | | | | | A2 |
| never in a chapter | the player's pause button, split, merge, release a plan, cancel a recruit | | | | | | |

---

## 5. The hints of the first match

The first match is a normal bot match: `@easy` (`gow_server.botmatch`), `narrows` (29 nodes, Q1), unrated, one pause,
the full HUD, no locks. The client turns on the hints for it only (Q2); each shows **once** (kept in `sbf.tutorial`),
when its trigger fires. A hint never pauses the match and never covers its place; it goes away by itself after 12 s or
by its close button, and "Turn off hints" is one click on every hint. The look is the chapter card (Leader) without the
step lozenges.

The chapters teach every rule of round 1's hints (factory, payment, barracks, stances, pocket, road forts, VP), so the
first match keeps only what they do not cover; each hint explains its own concept in its text:

| # | Hint | Trigger (the player's own data) | The card says | Place |
|---|---|---|---|---|
| H1 | A bigger map | 5 s into the match | "Bigger maps run faster: here charges and CP come quicker than in the tutorial." | the own capital |
| H2 | Over its capacity | the first own node with `attrition_in` set | "**{node}** is over its capacity and is losing units. Move some out." | that node |
| H3 | Full warehouses / CP at the cap | the first own `charge_burned` or `cp_burned` | Charges: "Your warehouses are full, so new charges are lost. Spend them, or switch to **War**." CP: "Your CP are at the cap, so new ones are lost. Spend them, or switch to **Economy**." No key line: the mark is on the control | the stance chip; the CP gauge for CP |
| H4 | Strike together | Advanced 1 not done, and an own group joins a fight that already had a round (`PlayerView.fights[].groups` grows while `last_round` is set) | "Your groups arrived one by one. A **group order** brings them in together (Advanced chapter I)." Key line: "Shift click to select several" | the arena |
| H5 | Rally point | Advanced 2 not done, and the third own `recruited` in a city without `rally_point` | "A **rally point** sends recruits to the front by themselves (Advanced chapter II)." Key line: "Rally point {rally_key}" | that city |

The hints read events and view fields the client gets anyway; they compute no rule (`AGENTS.md` 7.1). No hint quotes a
number (round 4): H1 says the map runs faster, not how much; H2 points at the countdown mark; H3 says which stance
helps, not how much. A key line stays where it says how (H4, H5); H3 has none, its mark is on the control.

---

## 6. The rules reference

The How to play page (`app/HowToScreen.svelte`, `howto/HowToPlay.svelte`, the economy v1 text and the generated combat
examples) is replaced by one short page, "Rules", reachable from the Road. Sections, one or two lines each. It keeps
only the numbers a player looks up (round 4), from `ruleset_public` of the main ruleset: the CP and charge rates in
Balance and the CP cap, the round, the pace of a plan's bonus, the VP period and the match length, the fort's toll, the
price of a rally walk. It leaves out what the screen shows (prices in the menus, capacities in the rings, warehouse
sizes in the diamonds, build times on the build marks, the factory limit in the counter, the starvation and attrition
countdowns on their marks). In the words of the chapters ("capacity", "charge", "CP"), the sections: Units and charges
(R1, R2, R4); Capture and capacity (R3, R4; a bigger group splits off what fits); Vision and speed (R5, R6); CP and
supply (R7 to R10); Buildings and stances (R11 to R13); Fights and planned orders (R14 to R17); Winning (R18); Terrain
and forts (R19, R20); Group orders and rally points (R21, R22); Capacity and attrition (R23); "Bigger maps are faster"
(R24); the engagement zone (DEC-37) and the factory limit in one line each. No pictures that compute a fight; the
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
| Warehouses | **capital only**: `start_stock` of any other node is dropped (DEC-41 item 9); a capital may start at 0 (validated) | the capital's stock; I starts it empty; the roads fill the rest in seconds; III relies on the empty city warehouses |
| Buildings | **no**: every capital has its barracks and its factory (`initial_state`), nothing else can be set | Advanced 2 uses the capital's barracks; III builds its own |
| CP, stance | no (the ruleset: `cp.start`, `economy.start_stance`) | `cp_start` of the chapter file (7.3): chapter I |
| Groups on roads, gathering plans, fights in progress | no | none needed (the scripted opponent makes them) |

**Finding: the seven chapters need no map-format extension.** Each was designed inside these limits and played on
the simulation (section 4). The chapter maps are ordinary map files with `meta.symmetry = "none"`.

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
  walkthrough frames were drawn on such bakes (section 8).
- `gow_server.maps.MapCatalog` loads them as a separate group, served by `GET /api/maps/{id}` (the client draws a
  match map from the server).

### 7.3 The chapter definition: one data file per chapter

`tutorial/chapters/<id>.json`, validated by a Pydantic model in `gow_protocol.tutorial` (the only source of truth,
`AGENTS.md` 6), exported to the JSON schema and to TypeScript by `regen` like `MapFile`. The server reads it, the
client imports it at build time (as `app/menuMap.ts` imports the menu map). Chapter ids: `units`, `economy`,
`building`, `attack`, `defence` (main road), `group-orders`, `rally-points` (Advanced). Chapter I as the example:

```json
{
  "id": "units", "road": "main", "number": 1, "map": "tut-move",
  "cp_start": "cap",
  "ui": [],
  "opponent": [],
  "beats": [
    {"id": "1", "on": {"start": true}, "pause": "action",
     "allow": [{"move": {"from": "Highhold", "to": "Ashford"}}], "mark": [{"group": "Highhold"}]},
    {"id": "2", "on": {"ui": "select", "group": "Highhold"}, "mark": [{"node": "Ashford"}]},
    {"id": "3", "on": {"accepted": "move", "to": "Ashford"}, "pause": "continue", "allow": [],
     "mark": [{"node": "Ashford", "ring": true}]},
    {"id": "4", "on": {"event": "node_captured", "node": "Ashford", "by": "you"}, "pause": "action",
     "allow": [{"move": {"from": "Ashford", "to": "Elmstead"}}], "mark": [{"node": "Elmstead"}]},
    {"id": "5", "on": {"after": {"accepted": "move", "to": "Elmstead"}, "ticks": 20}, "pause": "action",
     "allow": [{"cancel_order": {}, "max": 1}, {"move": {"from": "Ashford", "to": "Elmstead"}}],
     "mark": [{"group": "moving"}]},
    {"id": "6", "on": {"event": "node_captured", "node": "Elmstead", "by": "you"}, "pause": "continue",
     "allow": [], "mark": [{"node": "Kestrel"}]},
    {"id": "7", "on": {"continued": "6"}, "pause": "action", "ui": ["terrainMode"],
     "allow": [{"move": {"from": "Elmstead", "to": "Fordham"}}], "mark": [{"node": "Fordham"}]}
  ],
  "fails": [],
  "goal": {"all": [{"owner": "Ashford", "is": "you"}, {"owner": "Elmstead", "is": "you"},
                   {"owner": "Fordham", "is": "you"}]}
}
```

- **`cp_start`** (optional): the starting CP of the chapter, `"cap"` or hundredths in `0..cp.cap`. The server plays the
  chapter on the main ruleset with only `cp.start` replaced (a derived `Ruleset`, `dataclasses.replace`, as map tempo
  derives `Match.rules`); no rule number in code, no new rule.
- **`ui`**: the pieces shown at the chapter start (section 4.8's flags; the loader checks it equals the union of the
  chapters before it, so a chapter played alone still starts right); a beat's `ui` adds pieces, its `hide` removes
  them (IV.9 hides the clock IV.8 showed).
- **`allow`**: per beat, a list of command patterns: the command type of the wire (`move`, `cancel_order`,
  `build_factory`, `build_barracks`, `recruit`, `set_stance`, `fortify_road`, `group_move`, `set_rally_point`) and its
  places by name (`from` the group's node, `to`, `node`, `toward` the road's other end, `groups` by their nodes,
  `stance`, `planned`: `true`, `false` or absent for either); `max` bounds how often the pattern is used in the beat.
  `forfeit` (leaving) is always allowed. A beat without `allow` keeps the one before it (a UI beat must not have one;
  the loader checks it).
- **`pause`**: `"continue"`, `"action"` or absent (section 4.0). A UI beat must not pause (the server does not see it).
- **`on`** (triggers): `start`; `event` with its filters (`node`, `by`, data fields with `min`); `accepted` (an own
  command the server accepted, by type and places); `view` (a field of an own node or group: `{"node": "Westmarch",
  "field": "starve_in", "set": true}`, `{"group_at": "Ashwood", "full": true}`, an enemy group on a road toward a node,
  an enemy intent to a node); `after` (another trigger plus `ticks`); `continued` (Continue on a beat); `ui` (client
  only: `select` of a group or a place).
- The texts are not in the file: the key of a beat is `tutorial.<chapter>.<beat>` in the client dictionaries. Node
  names, not ids: the file reads the way the chapter is written, and the loader checks every name against the map.

### 7.4 The scripted opponent

`gow_bots.bots.scripted.ScriptedBot`, a `Controller` built from the chapter's `opponent` list. It imports only what a
bot may (`gow_sim.view`, `gow_sim.commands`, `gow_sim.maps`; `AGENTS.md` 2): it reads the `PlayerView`, finds "the own
group standing in node X" there and answers `Move` (ordinary or planned with its bonus) with opaque ids. A step fires
at a tick (`at`) or on a fact of its own view (`when`: `owns` a node, as chapters II and V need); each fires once; a
step whose group is gone is skipped (the text never depends on it). Deterministic like every bot (no seed is needed);
the `Seat` calls it every 5 ticks as any bot, so `at: 30` means the first decision at or after tick 30, and a `when`
step answers within 5 ticks (the scripts above answered in 1 tick; 5 changes no outcome: the raiders of II leave an
empty place either way). A paused chapter does not step, so the opponent waits with it.

### 7.5 The beat director: the server walks the beats, the client draws them

The locks and the pauses need the current beat on the server, so the **server walks the beats** and the client draws
the beat the server names (round 2 had the client walk them and the server check only the goal; two walkers could
disagree).

- **`TutorialDirector`** (`gow_server.tutorial`, plain Python, no I/O): built from the chapter file and the map. After
  every step of a chapter match it reads what player 0 receives anyway: the events of `events_msgs(events, 0, key)`
  (fog applied), the results of player 0's commands, and `match.view(0)`; it matches the next beats' triggers
  (comparing fields with the file, never working out a rule, `AGENTS.md` 7.1), keeps the current beat, its `allow`
  with the `max` counters, its pause, and checks the fails and the goal.
- **The client** gets the beat in a new server message `tutorial` (`{beat, paused}`, sent on every change and after
  `welcome`); it shows that beat's card, mark, `ui` and `allow`. Only the UI beats (a selection) are walked by the
  client itself, between two server beats; they change neither the pause nor the locks.
- **The goal**: when it holds, the server queues a `Forfeit` of the scripted side, a normal command, so the match ends
  with `match_end` (the player wins, `reason = forfeit`). Chapter IV ends by itself (`reason = capital`). The client
  knows it is in a chapter (it started it) and shows the Seal instead of the match result. Alternative: a new
  `EndReason.TUTORIAL` (a cleaner record, `PROTOCOL_VERSION`++); not needed.

### 7.6 Server

- **`POST /api/tutorial-matches {chapter}`** (`gow_server.tutorial`): loads the chapter file, its map from
  `maps/tutorial/`, the main ruleset (with `cp_start` applied); seat 0 the player, seat 1 the `ScriptedBot`; unrated,
  not a bot level of `botmatch` (no `@level`). It goes through `MatchLifecycle` like a bot match: `claim` (one active
  match per player), the caps (`GOW_MAX_BOT_MATCHES`: a scripted match is cheap but still a match), the connect
  timeout. No replay file is kept (a chapter is scripted; the headless tests are its record). The runner gets the
  director (`MatchRunner(..., tutorial=director)`).
- **Locks.** `MatchRunner.step` hands the queued commands of player 0 to the director before `Match.step`: a command
  the current beat does not allow never reaches the simulation and is answered at once with an `ack` whose
  `reject_code` is `INVALID_ARGUMENT` (an existing code, no protocol change; the client never sends it, it only stops
  a modified client). The scripted side is not locked. Commands are matched on the resolved internal command and the
  state (a group's node), on the server only.
- **Pause.** When the director enters a beat with `pause`, the runner calls its existing `pause()` (the loop already
  waits on `_resumed`) and sends `tutorial {paused: true}`; it is not the private-match pause: no `request_pause`, no
  `_pauses_used`, no `pause_max_s` timer, no `paused` message. It ends with `resume()`:
  - `continue`: on the existing client message `resume` from player 0 (`request_resume` of a tutorial runner asks the
    director; a `resume` during an `action` pause is refused with the existing `PAUSE_DENIED`);
  - `action`: in `submit`, when a command of player 0 matches the beat's `allow` (it applies at the next tick).
  The player's own `pause` is refused in a chapter (`pause_available` false, no pause button). The reconnect window
  (DEC-05) still runs while a chapter waits: a player who leaves the tab loses the chapter, as they would a match, and
  replays it.
- **The match row:** a new column `matches.kind` (`match` | `tutorial`, an Alembic migration, default `match`), so the
  profile, the stats and the result counters skip chapters. The first match is an ordinary bot match
  (`POST /api/bot-matches {level: "easy", map_id: "narrows"}`), kept and listed like any.
- `GET /api/ruleset`: `RulesetPublic.from_ruleset` of the main ruleset (unscaled; the reference says bigger maps are
  faster). Public, cacheable. `api.gen.ts` by `regen:api`.

### 7.7 Client

- **Screens** (Svelte, `app/tutorial/`): the intro (Sheet), the result (Seal), the chapter select (Road with the
  Advanced side road); the stone and the rule frame of ui-style 69; the entry from the main button (`app/play.ts`).
- **In a chapter:** the match screen as it is, without the start banner (`hud/StartBanner.svelte`: beat 1 replaces
  it), plus a `TutorialCoach` (HTML over the map): the Leader card with Continue on a `continue` beat, the "Paused"
  plate while `paused`. The Compass mark of a place on the map is drawn by PixiJS in the effects layer (a baked
  sprite, `render/bake.ts`, one texture; the compass points turn once), the card and its leader are HTML (`AGENTS.md`
  7.2). A mark on the HUD (the CP gauge, the VP rail, the stance chip) is an HTML outline. The exit dialog reads "Leave
  the chapter". Continue sends `resume`.
- **Gating** (`tutorial/gate.ts`, plain TypeScript): the set of `ui` flags of the current beat (the chapter's start
  set, plus the beats' `ui`, minus their `hide`). The HUD reads it from the coach state (`$state.raw`, replaced on a
  beat change only): `TopBar` hides the CP gauge, the factory counter, the stance chip, the VP rail and the clock by
  flag; `EdgeAlerts`, `AlertStack` and `ToastStack` by `alerts` and `notices`; tips drop the lines of hidden flags. The
  map reads it once per beat as a `RenderGate` passed to the views (plain TS, `AGENTS.md` 7.2): `cityView` skips the
  warehouse row, the VP badge and the building marks, the packets view the packets, `alertView` the pocket and
  starvation marks, `entityView` the terrain badges. Outside a chapter the gate is "everything", so a match changes in
  nothing.
- **Locks:** `OrderController` gets an `allow(command): boolean` from the coach (the beat's patterns matched on the
  ids and nodes the client already has); a menu item, a key or a target click whose command is not allowed is
  disabled. The locked look (dimmed, icon only, a lock glyph, no hover) is one style of `Radial.svelte` and the top-bar
  chip; the locked item's `aria-disabled` and its tooltip "Not yet" tell a screen reader. A click on a target that is
  not allowed pulses the card's action line.
- **All strings** through `t()`, keys `tutorial.*`; every rule number of the reference from `ruleset_public` (formatted
  by the existing `hud/format.ts`), every key from the player's bindings (`keyLabel`).
- **Hints of the first match:** `hud/HintCoach.svelte` fed by the event stream and the view (section 5), on only in the
  match the tutorial started (a flag of the session); the gate is "everything" there.
- Reduced motion: the compass points do not turn and the glow does not breathe; the card appears without the burin
  stroke.

### 7.8 Progress

`localStorage` `sbf.tutorial` (wrapped in `try`, as the other `sbf.*` keys): `{"v": 1, "done": ["units", "economy"],
"skipped": false, "firstMatch": false, "hints": ["H1"], "hintsOff": false}`. A guest and an account on the same
browser share it (round 1: "in the browser"). No server state.

### 7.9 Versions, DEC, protocol

| Change | Needs |
|---|---|
| Rules | none: no DEC, no `SIM_VERSION`, no golden replays (`cp_start` replaces a ruleset value for a chapter, like map tempo) |
| The server message `tutorial` (`beat`, `paused`) | `PROTOCOL_VERSION`++, `regen:protocol`, in PR 1 |
| A locked command | none: an `ack` with the existing `INVALID_ARGUMENT` (Q10) |
| Pause and resume of a chapter | none on the wire beyond `tutorial`: the existing `resume` message; the runner's existing `pause()` and `resume()`. A line in DEC-05 (mechanics.md 19: "a tutorial chapter pauses at its cards, no limit") in PR 1, no new DEC: pauses are server settings, not rules |
| Chapter files (new Pydantic model) | the schema and `protocol.gen.ts` by `regen` (no WebSocket message carries them) |
| `POST /api/tutorial-matches`, `GET /api/ruleset` | `api.gen.ts` by `regen:api` |
| `matches.kind` | an Alembic migration |
| Validator `--checks`, the tutorial glob of the map tasks | `mise.toml` and `AGENTS.md` section 3 in the same PR |
| The removal of How to play v1 | `regen:howto` gone from `mise.toml` and `AGENTS.md` |

`ruleset_public` already has every number the rules reference quotes (section 6); no card quotes one (round 4), so
`starvation` is not added (round 3 added it for the text of beat II.4). The capital's VP multiplier (DEC-03) is
not quoted (beat IV.8 points at the VP rail, whose `vp_gain` already includes it), so it is not added.

### 7.10 Implementation in three PRs

| PR | Contents | Estimate |
|---|---|---|
| 1. Server, bots, data | the seven maps and chapter files (with `ui`, `allow`, `pause`, `cp_start`); `gow_protocol.tutorial`; the `tutorial` message (`PROTOCOL_VERSION`++); `ScriptedBot` with `at` and `when` steps; `TutorialDirector` (triggers, locks with `max`, pauses, fails, goal) and its hooks in `MatchRunner` (`step`, `submit`, `request_resume`); `POST /api/tutorial-matches` with the closing `Forfeit`; `GET /api/ruleset`; `matches.kind`; the validator profile and the map tasks; the DEC-05 line. Tests: the director on every chapter file (each beat's trigger, its `allow` accepted and everything else refused with `INVALID_ARGUMENT` and no state change, `max`, `pause` stopping the ticks and `continue`/`action` resuming them), the runner with a controllable clock (no tick passes while paused), every chapter played headless by its opponent script and a scripted student to its goal at the ticks of section 4 ("Verified", the expected values from this document, `AGENTS.md` 0.4), IV.F's branch | L, 4 days |
| 2. Client: chapters | the entry and Skip, the Sheet, the Road with the side road (Advanced after V), the Seal, the coach (Leader card, Continue, Paused plate, Compass sprite, HUD outlines), the gate in the top bar, the alerts, the tips and the map views, the locks in `OrderController` and the locked look of the radial and the chip, the exit wording, no start banner in a chapter, progress; Vitest of the gate (each flag hides its pieces, "everything" changes nothing), of the allow matcher and of the coach on recorded `tutorial` streams; `shots` of the new screens and of gated chapter scenes; the `visual` references | L, 5 days |
| 3. Client: first match and reference | the five hints of section 5 with their triggers; the rules reference on `GET /api/ruleset`; the removal of How to play v1 and `regen:howto` | M, 2 days |

---

## 8. The look [accepted 2026-11-13]

[`mockups/tutorial.html`](mockups/tutorial.html): self-contained (the fonts are the client's own, SIL OFL), on frames
of the real client: every chapter frame is the chapter map of section 4 (baked like a pool map) played on the
simulation by its script and drawn by the client; the first-match frames are dev scenes of the artery map and one
`tut-group` moment (a place over its capacity). It shows only the chosen variants, one large view, with a switch per
piece and per moment; the state is in the address (`#el=card&m=IV.5`).

| Piece | Chosen | Round 1 alternatives (dropped) |
|---|---|---|
| Hint card of a chapter | **Leader**: a plate tied to its place by a ruled leader, the chapter and its step lozenges in the head, the action under a rule; Continue at its foot on a `continue` beat | Tablet, Banner |
| Goal mark on the map | **Compass**: a double ring, the four compass points turn once and stop; on a road two rails and a chevron; on the HUD an outline with corner lozenges | Lantern, Burin |
| Chapter intro | **Sheet**: a stone sheet on the blurred main screen, the goal list and a crop of the chapter map with the goals ringed | Plinth |
| Chapter result | **Seal**: a stone window over the chapter's last moment, the seal (a lozenge with the chapter numeral), three lessons, two buttons: All chapters (primary) and Replay chapter (secondary; round 4) | Page |
| Chapter select | **Road**: the main road I to V ending at the enemy capital (the first match, open at any time), the Advanced side road branching off after V with its two places, the walked part in the own colour | Cards |
| Hint of the first match | **Leader**: the chapter card without the step lozenges, with "Turn off hints" | Toast |
| Paused (round 3) | **Plate**: a small stone plate at the top centre of the map, the pause glyph and "Paused", ivory on the casing; the frame under it unchanged (nothing is dimmed: the card asks the player to look at it) | |
| Locked (round 3) | the radial's existing disabled style, icon only, plus a small lock; the top-bar chip at 40% with the lock at its corner | |

Checked with `design:design-critique` and `design:accessibility-review` in round 1 (contrast of every text pair
6.9:1 or more, marks ivory on a dark casing, never a player or alert colour; motion stops by itself and "Less motion"
holds it still); rounds 2 and 3 keep those tokens.

**The walkthrough** [`mockups/tutorial-walkthrough.html`](mockups/tutorial-walkthrough.html) (for the owner's review of
every screen and every text before any code): the whole flow in the chosen look, 67 screens, each with a stable id
(`E.1` main screen, `E.2` Skip, `R.1` to `R.3` the Road first visit, in progress and finished, `R.4` the rules
reference; per chapter `<chapter>.0` the intro, `<chapter>.<beat>` the beats of section 4, `IV.F` the one failure,
`I.L` the leave dialog, `.S` the Seal; `H1` to `H5` the first-match hints). Previous and next (arrow keys too), a jump
list of every screen, the buttons of a screen go where they go in the game, and "Show triggers" shows the trigger or
the goal check, the pause, the allowed commands, what is shown, and the tick of the frame. Every chapter frame is the
player's view at the tick of its beat on the simulation (the scripts of section 4, "Verified"), drawn by the client
with the gating of section 4.8 (hidden pieces hidden, locked controls in the locked look; temporary dev scenes, not
committed); the hint frames are a `narrows` match of a bot against `smart_turtle@easy`; the frames are WebP
(`assets/tutorial-walk/`). The cards are placed where they cover no place and no name. The walkthrough follows this
document; where they differ, this document is right and the page is fixed.

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
- **Q5 (changed in round 4).** Ruleset numbers in `ruleset_public` only where a text needs them. **Default: none
  added**: no card quotes a ruleset number, and the rules reference leaves the starvation pace out (the countdown mark
  shows it); the capital's VP multiplier is not quoted. Alternative: add `starvation` and quote its pace in the
  reference.
- **Q6.** Chapter IV is the longest (about 64 s of play: the group waits about 22 s to fill up before the capital).
  Keep the wait (IV.8 explains the VP meanwhile), or start Ashwood with an empty warehouse but give the player a second
  group? **Default: keep.**
- **Q7.** Chapter III asks for four things (factory, barracks, recruit, stance). Keep all four in one chapter, or move
  the stance to chapter II? **Default: keep** (the stance is the throttle of what III builds).
- **Q8 (changed in round 3).** On the Road a main chapter opens when the one before it is done; the first match is
  open from the start; **the Advanced chapters open when V is done** (round 2: from the start), since they use CP,
  fights and recruits. Alternative: every chapter open from the start, each starting with the HUD of the chapters
  before it whatever was played.
- **Q9 (new).** Chapter I starts at the CP cap (`cp_start`), so the hidden CP never refuse its five orders (at the
  ruleset's 3 CP the fourth order of a quick player is refused). Alternative: a separate `rulesets/tutorial.toml`.
- **Q10 (new).** A locked command is refused with the existing `INVALID_ARGUMENT`. Alternative: a new code `LOCKED`
  (no schema change, one more alert key).
- **Q11 (new).** An action card waits for its command (`pause: action`), so the tutorial never rushes the player and
  three failure branches of round 2 are gone (II starving, V's late answer, A2's walk without CP). Alternative: action
  cards run, with those failure cards back.
- **Q12 (new).** The server walks the beats and names them in a new `tutorial` message (one protocol bump). Alternative:
  the client walks them and asks the server to pause and resume (the private pause without limits); then the server
  cannot lock per beat, only per chapter.
