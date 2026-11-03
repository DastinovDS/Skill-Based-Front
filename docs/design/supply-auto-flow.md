# Automatic supply flow towards the front (owner idea)

Status: **[accepted]** as DEC-43 (the owner, 2026-11-03, all recommendations; `mechanics.md`, section 7, the DEC-43 block is the rule in force, this document is the reasoning). Design exploration for economy v2 (`economy.model = "v2"`). Decision issue: #697 (it continues #693). Interactive storyboards: [`mockups/supply-auto-flow.html`](mockups/supply-auto-flow.html) (open as a file; the switches at the top change the rule, every board replays it). How the flow is drawn for the player: #699, [`mockups/supply-flow-visuals.html`](mockups/supply-flow-visuals.html).

## The idea

The owner, 2026-11-02 (translated, the intent kept):

> Any system that gives the player control over supply moves the micromanagement from CP (equal CP income was meant to remove it) to supply, which is now the more important resource. So I lean towards an automatic mechanism the player can hardly interfere with. The map is a graph and the front provinces are its leaves. With the capital as the only source, the system directs supply as far as possible towards the leaves, and the same rule works for every city or province: the capital gives to the nearest cities, they pass it on. The leaves fill fastest; when they are full, the cities right behind them start to accumulate. When a leaf loses charges, the city nearest to it gives its charge, the city before that gives its own, and so on down the chain. Factories form sub-trees that also lead to the front.

The owner's addition (same day): **the only player lever is a "leaf shift"**: in the Supply mode a button moves the leaf level back by one city at a time, from the front line towards the capital and up to the capital itself, so a fresh capture that is a feint does not pull all supply into it; the current leaf level is lit on the map.

Rejected before and kept in mind here: v1 (stances, front markers, rear minimum, donors) as "too automatic and opaque, mechanics for the sake of mechanics"; convoys (V9) and player-drawn lines (DEC-41, DEC-42) as a new headache or micromanagement. So the rule has to be **simple, local and visibly drawn on the map**.

## The rule in one sentence

Every dispatch each own node passes one charge per road **downhill**, to a neighbour that is closer to the front and has room; the **leaf level** keeps what it gets. That is all the player has to know; everything below makes the sentence exact.

## The algorithm

Integer, deterministic, per player. Run every `supply.dispatch_ticks` (10) in the `supply` step of economy v2 instead of `systems.lines`.

```
for each player p (independently: nothing below reads the other player's state):
  own   = own nodes of p
  roads = edges with both ends own                       # internal edges, as today
  # 1. the field: roads to the front
  border(n) = n has a road to a node that is not p's     # option 1A
  d0 = multi-source BFS over roads from all border nodes (hops); INF where no border is reachable
  k  = min(p.leaf_shift, d0(capital))                    # the leaf level, 0 = the front line (lever, item 14)
  d  = d0, then every node with a tired own army (standing units with charged < units, or a
       gathering planned order) and d0 > k is set to k, and the BFS is spread again   # item 12
  # 2. a snapshot of the room
  room(n) = warehouse_cap(n) - stock(n) - charges of own packets on the way to n
  # 3. senders, the front first
  for n in own sorted by (d(n), node_key(p, n)):
      if d(n) <= k or d(n) == INF: continue               # the level keeps; ahead of it nothing moves
      spare = stock(n) - keep                             # keep = 0 (option 7A)
      down  = [m: road n-m, k <= d(m) < d(n), room(m) > 0] ordered by fill% of m, then node_key
      for m in down while spare > 0: send 1 charge n -> m; room(m) -= 1; spare -= 1
      level = [m: road n-m, d(m) == d(n), room(m) > 0, cap(m) - room(m) + 2 <= stock(n)]   # option 4B
      for m in level (same order) while spare > 0: send 1 charge n -> m; room(m) -= 1; spare -= 1
```

- **fill%** of a neighbour is `(cap - room) * 100 // cap` (rounded down, integers only).
- **A packet** is today's packet: 1 charge, the road's `packet_ticks` at `supply.base_speed_pct`, lost on a road that stops being internal (section 7 packet rules). It lands in the warehouse of the next node; the next node decides at its next dispatch. Arrivals cannot overflow: the room was reserved when the packet left.
- **Production** is unchanged (DEC-41 item 2), with one change for a full factory (item 8).
- **Recharge** is unchanged: standing units recharge from the warehouse of their node (`supply.recharge_per_tick`), so an army standing on the way takes what passes through.
- **Determinism** (`AGENTS.md`, 4.1): hops and fill% are integers; iteration is `sorted` by `(d, node_key)`; ties between nodes only by `node_key(player, node)`, so the mirror test holds; each player's flow reads only its own nodes and the public ownership, so there is no tie-break between players. The decisions read the snapshot of the room taken at the start of the dispatch, so the result does not depend on the order in which two senders see the same receiver beyond the `node_key` order of the loop.
- **Cost**: one BFS over at most 55 nodes per player per dispatch; well inside the 0.1 ms supply budget (`AGENTS.md`, 12). The field is stored in `GameState` (`Node.front_dist`) so the client can draw it (item 15).

## The open points, options and recommendations

Each point: the options, then the recommendation (**rec.**). The mockup has a switch for every point marked ⚙.

### 1. What a leaf is ⚙

> **After the first playtest (owner 2026-11-03, #724, `mechanics.md` DEC-43 item I):** 1B is the rule: a leaf faces an enemy node only; its fallback before contact is the own nodes farthest from the capital (hops over own roads, all ties); the leaves on the level even out along level roads (4B now applies on the level too).

| | Option | Effect |
|---|---|---|
| 1A | an own node with a road to a node that is not own (enemy or neutral) | simplest, readable as "touches land that is not mine"; early game the expansion edge is the front; a quiet flank next to a neutral also fills |
| 1B | an own node with a road to an enemy node only | the flank next to a neutral stays a transit node; needs a fallback when there is no enemy contact yet (early game: nothing would flow) |
| 1C | a dead end of the own graph (one own road) | rejected: on a ring there may be no dead end at all, and a rear dead end becomes a "front" (the mockup's Ring and Tree boards show both) |

**Rec. 1A.** One sentence, no fallback, and a neutral node is a target you can take, so treating it as front is honest. Provinces are leaves like cities and hold 1 (DEC-41 item 13).

### 2. The metric of the field

Hops (roads) or travel ticks (`packet_ticks`). **Rec. hops**: a small integer the player can read on the map ("2 roads to the front"); travel time still matters through the packet speed. Ticks would make the number unreadable and change the direction of flow when a road is slow, which is hard to see.

### 3. Several downhill neighbours: who gets the charge ⚙

Only matters when a node has fewer spare charges than downhill neighbours with room (one charge per road per dispatch, so a node with enough stock serves all of them).

| | Option | Effect |
|---|---|---|
| 3A | the emptiest neighbour (fill%), then `node_key` | the chain reaction steers itself: a leaf that spent charges is emptiest, so its branch is served first; the next node back becomes the emptiest in turn |
| 3B | in turn (round robin per node, `Node.rr` exists) | equal share between branches whatever they need |
| 3C | a fixed order (`node_key`) | deterministic but a hidden preference for one branch |

**Rec. 3A.** It is the owner's chain reaction expressed locally, and the "Capital plus a factory" board shows the payoff: the middle city sends the capital's charges south because the north already has a factory.

### 4. A road between two nodes at the same distance ⚙

A node gets charges only from a neighbour that is farther from the front. A node with no farther neighbour (a "ridge", for example a city beside the capital at the same distance) gets nothing, and the front behind it starves (the Ring board with "carries nothing").

| | Option | Effect |
|---|---|---|
| 4A | a level road carries nothing | simplest; real maps have ridges, so some fronts starve with no visible reason |
| 4B | a level road evens out: a charge goes to the level neighbour when that one is lower by 2 or more (stock plus incoming) | fixes ridges; also moves stock along the front line from a quiet leaf to a busy one; cannot oscillate (the gap shrinks by 2 per move and a gap of 1 never moves) |
| 4C | level roads point away from the nearest factory (a second field) | fixes ridges with a direction, but a second number the player cannot see |

**Rec. 4B.** One extra clause, visible as charges moving along a road with no downhill arrow. (The first implementation applied it behind the level only; since #724 the level evens out too: DEC-43 item I3.)

### 5. Throughput, speed and the chain speed

- **1 charge per road per dispatch** in each direction, every road (rec.). With `dispatch_ticks = 10` a road carries up to 1 charge per second, above any factory rate of `mvp-3` (capital 1 per 100 ticks), so a road does not bind on volume; what binds is **latency** (hop by hop: the road's packet time plus up to one dispatch per city) and **where the stock sits**.
- **Packet speed**: today's `supply.base_speed_pct = 150`.
- **The chain speed**: with the snapshot of the room (above) the refill runs back **one city per dispatch** (the wave: the leaf's neighbour gives first, the one behind it at the next dispatch). The alternative (room freed by a send counts in the same dispatch) moves the whole chain at once. **Rec. the wave**: it is what the owner described ("the city nearest gives, then the one before it") and it is visible as a sequence (the mockup numbers it 1st, 2nd).
- If supply should cost more distance: raise `supply.dispatch_ticks` or lower the packet speed (ruleset numbers, no new rule).

### 6. Which leaf is served first

There is no global choice: each node chooses locally (item 3). The consequences: with 3A the most depleted branch draws first; a leaf nearer to a source fills sooner because its charges travel less (latency, not a rule); two leaves on one branch even out through 4B.

### 7. Accumulation and a rear minimum ⚙

| | Option | Effect |
|---|---|---|
| 7A | no rear minimum: a node passes everything downhill while the next node has room | exactly the owner's order: the leaves fill, then the layer behind them, then the next, back to the capital |
| 7B | every node keeps 1 before passing on (as V3) | rear garrisons and a pocket keep a reserve; the front waits for the rear to fill its 1s first |

**Rec. 7A.** A rear army is still served: it pulls (item 12). The leaf shift (item 14) is the deliberate way to stock the rear.

### 8. A full factory

A factory is a node like any other; its stock rolls downhill. When its warehouse is full and production comes:

- **rec.**: the new charge goes as a packet to an own neighbour with room that is not ahead of the leaf level (the smallest distance first, then `node_key`); with no such neighbour it burns (`charge_burned`, as today). This fills the layer behind a front factory and the cities beside the capital; a charge sent there flows back down when the front has room.
- alternative: it burns at once (today's v2 rule; a front factory then wastes its production while the city behind it is empty).

### 9. Several sources

Nothing extra: a source is only where charges appear. The field is the distance to the **front**, not to the sources, so every factory's charges roll downhill from where the factory stands: a factory near a front feeds that front first (a sub-tree, in the owner's words), a factory in the rear adds to the flow of the trunk, and where two flows share a road they share its throughput and the room of the nodes below. No sub-tree is stored, drawn by the player or broken on a capture.

### 10. A cut-off pocket ⚙

A pocket is a group of own nodes with no road path to an own factory.

| | Option | Effect |
|---|---|---|
| 10A | the same rule inside the pocket: its own field, its stock rolls to its own front | no special case; the pocket fights with what it has; the player sees it run dry |
| 10B | frozen: nothing moves in a pocket | an extra rule, and a pocket army next to a full city starves |

**Rec. 10A**, with a "no source" mark on the pocket's nodes in the Supply mode. v2 has no starvation (DEC-41 item 5); none is added.

A **road cut** in the mockup stands for anything that stops a road being internal. Under today's rules that is the capture of an end node; the cut ends become front nodes, so the stock on both sides turns towards the cut. Whether an enemy group standing on a road should also block packets (raids on supply) is an open question (Q8).

### 11. The front moves

The field is recomputed at every dispatch, so there is no command:

- **a captured node** becomes a leaf at the next dispatch; the old leaf is now one road back and its stock rolls into the new leaf (the old front feeds the new one by the same rule, which v1 needed donors for);
- **a lost node** loses its warehouse (`warehouse_lost`) and its packets on the way are lost; its own neighbours become leaves and the flow turns to them.

The feint problem (a capture pulls the stock forward and the next loss takes it) is answered by the lever (item 14) or its alternative.

### 12. Armies ⚙

Units recharge from the warehouse of their node (unchanged). A big army at a leaf drains the leaf; the chain refills it. An army anywhere else gets what passes through its node, and nothing in a rear dead end. Options:

- **12A (rec.)**: **a tired army pulls**: a node with own standing units that have fewer charges than units, or with a gathering planned order (DEC-41 item 10), is placed on the leaf level of the field (`d = k`). Charges then flow to it like to a leaf until it is charged, and it stops pulling. The player steers supply with the armies it already moves; no new control.
- 12B: no pull; an army must stand on the flow (or at the front) to recharge.

With the leaf shift above 0, a tired army ahead of the level does not pull: the shift is the player's explicit choice and wins.

### 13. Provinces

A province holds 1 (DEC-41 item 13) and is a node like any other: a leaf when it touches land that is not own, otherwise a transit node. Consequence: a province on a trunk is a **narrow neck**: with 1 slot it passes at most 1 charge per 2 dispatches. Rec.: keep it (readable: the single slot is drawn), and watch it in the playtest (Q9). The burning of an arriving charge in a full province (DEC-42 playtest) cannot happen: arrivals reserve room.

### 14. The player's influence: the leaf shift

**Levels of influence considered:**

| | Lever | Micromanagement risk |
|---|---|---|
| none | the player steers only by capturing, moving armies (12A) and building factories | none; but a feint capture pulls the front stock into a city that will be lost |
| **leaf shift (owner, rec.)** | one global value `k = 0..d(capital)`: the leaf level is the set of own nodes at `k` roads from the front | one control for the whole player; used before a feint, a withdrawal or to stock the rear |
| hold a city | a toggle per city: it gives nothing on (it still fills) | one toggle per city, easy to forget; a held trunk city starves everything behind it (the mockup's hold step) |

**The leaf shift, worked out:**

- **Unit**: hops of the field. `k = 0` is the front line (the default); `k = 1` makes the cities one road behind the front the leaves; `k = d0(capital)` makes the capital the leaf. The control is `−` (back towards the capital) and `+` (forward), one step per click; the HUD shows "front", "−1", "−2"; the cities of the level are lit on the map.
- **The level follows the front**: `k` is relative to the current front, so with `k = 1` a fresh capture makes the old front city the level and the capture gets nothing (the mockup's "Feint capture" board). After the feint, `+` sets `k = 0` and the capture fills.
- **Global or per direction**: global (rec.). Per direction would need a definition of a direction (a group of leaves, a sub-tree of the downhill graph), a way to pick it on the map and a value per direction; the player would have to remember which fronts are shifted. That is the v1 front markers again (two markers, each a standing setting per front) and exactly the micromanagement the idea removes. If the playtest shows a real need for one front stocked and the other fed, the cheap step is 12A (the army there pulls), not per-direction shifts.
- **Stock ahead of the level** (nodes with `d < k`):
  - **stays (rec.)**: they neither receive nor give; their armies still recharge from their own warehouses. Pressing `−` before a feint costs nothing that is already at the front, and `+` resumes the flow;
  - flows back towards the level: a "withdraw the stock" tool before a retreat, but every `−` then `+` pumps charges back and forth on the roads, and a short shift drains the front.
- **Up to the capital**: everything flows to the capital and the cities beside it (the spill, item 8); the capital and the nodes at the level fill, the rest is burned at the full capital. No extra limit is needed: the warehouse of the capital (6 in `mvp-3`) and the burn bound the hoard, and the cost is the front. A shifted player should see it: the HUD shows the level all the time it is not "front".
- **Price and cooldown**: free and instant (rec. for the first playtest). If players flicker it, a CP price per step is a ready answer (and a CP sink, item 17).
- **Fog**: the opponent sees nothing new: not `k`, not the field, not the lit level (`PlayerView` carries them for the own player only; a fog test per field, `AGENTS.md` 4.4). Indirectly the enemy can only notice what it already can: the stock of a city where its own group stands (DEC-21, DEC-35).

**An alternative without a lever, for the same feint problem: a fresh city settles.** A captured node counts as front only after it has been own for `supply.settle_ticks` (for example 50 ticks); until then the field treats it as not own, so the old front city stays the leaf ("Fresh city is front: after 3 beats" in the mockup).

| | Leaf shift | Settling delay |
|---|---|---|
| clicks | 1 before a feint, 1 after | none |
| a feint of a few seconds | protected | protected if shorter than the delay |
| a long feint or a planned withdrawal | protected for as long as the player wants | not protected after the delay |
| a real advance | must press `+` (one click), or the capture stays empty | the capture waits the delay for supply (the army carries its own charges meanwhile) |
| stock the rear before a defence | yes (`−` several times) | no |
| forgetting it | the front starves while the level is shifted (visible, the HUD shows it) | nothing to forget |
| new rule text | one value and a lit level | one number |

**Rec.: the leaf shift** as the only lever (the owner's choice, and it also covers withdrawals and rear stocking). The settling delay is cheap and orthogonal: keep it as a fallback if the playtest shows players forget the shift (then both: settle 30 to 50 ticks, shift for longer plans).

### 15. Fog and the view

- **The opponent**: nothing new. No command, no line, no setting is public; the field is computed from own territory, and the enemy sees own packets only as today (DEC-10). The enemy knows the rule, so it knows the front is where the stock is: but it sees the warehouse numbers only where its own group stands (DEC-21, DEC-35).
- **The own player** (`PlayerView`, own nodes only): `NodeView.front_dist` (the field, or `null` in a node that gets nothing), `View.me.leaf_shift`, the level is the nodes with `front_dist == leaf_shift`; own packets as today. The client draws, it does not compute (`AGENTS.md`, 7.1).
- **The Supply mode** shows: the number of every own node (small), a downhill chevron on every road that carries, the lit leaf level, charges moving as dots, warehouse slots, "no source" on a pocket, "ahead: no new supply" on nodes ahead of a shifted level. That is the whole explanation of the system: the player can predict every charge from the picture.

### 16. Why it stays a strategic factor (not a free teleport)

- **Distance**: a charge moves hop by hop; a front 4 roads from the nearest factory waits 4 road times plus up to 4 dispatches for a refill, a front next to a factory refills almost at once.
- **Position of the stock**: the stock sits at the front by default, so a breakthrough takes a full warehouse (`warehouse_lost`), and a feint can cost the front stock: the leaf shift is the answer, and the decision is the player's.
- **Roads and cuts**: a capture that cuts the trunk turns both sides towards the cut and makes a pocket that runs on its own stock; a single road into a salient carries 1 charge per dispatch; a province on a trunk is a neck.
- **Factories**: where to build one decides which front refills fast (DEC-41 item 2, unchanged).

### 17. CP

This removes supply micromanagement and spends no CP. The CP surplus of `mvp-3` (CP pays only for moves, recruits and planned orders) stays a separate open problem. Options that fit this model (no choice made here):

- **C1, overtime**: 1 CP makes a factory produce one extra charge now; it flows by the rule. A real CP-versus-charges choice without a stance setting.
- **C2, a paid shift**: each step of the leaf shift costs CP (for example 0.5 CP); a sink that also stops flicker.
- **C3, a rush road**: CP doubles one road's packet speed for 30 s; a local, visible, tactical push of supply.
- **C4, lower income**: `cp.period_ticks` back up (150 to 200); no new mechanic.

## What the mockup shows

Five storyboards and a free play board; every step is a few dispatches ("beats") of a toy, integer version of the rule (a road takes one beat, the capital makes 1 charge per 2 beats, a factory 1 per 3; warehouses: capital 6, city 3, province 1). With the recommended options:

| Board | What it shows |
|---|---|
| A tree from the capital | the front (0) fills first, then the layer behind it; an army at a leaf fires and the refill runs back (1st the city behind it, 2nd the capital); a tired army behind the capital pulls charges back to it |
| Feint capture | `−` moves the level back one city; the army takes X and X gets nothing; the enemy retakes X and only X's empty warehouse is lost; a real advance with `+` fills X |
| A ring of roads | a city next to a neutral is front (1A); the city beside the capital gets charges only through the level road (4B); two armies fire and both sides refill |
| Capital plus a factory | the factory feeds the north, so the middle city sends the capital's charges south (3A); when everything is full, a source burns |
| A pocket after a cut | a cut makes the cut ends front; the pocket moves its own stock to its army, then runs dry; mending the road brings the capital's flow back |
| Free play | any map; click a city (its army fires 2), click a road (cut or mend), capture the next node, lose a city, the leaf level `−`/`+` |

Every switch re-runs every board, so the cost of a non-recommended option is visible (the ring starves with "carries nothing", a dead-end leaf feeds the rear, a frozen pocket leaves its army empty next to a full city, a held city starves the leaf behind it).

## How it differs from what was tried

| | v1 (DEC-18, DEC-28) | V6 Border roles (#693) | V12 Pressure and valves (#693) | DEC-42 lines (now) | This idea |
|---|---|---|---|---|---|
| who decides where | the server, from player settings (two front markers, the rear minimum, stances) | the server, by node roles | each node, by levels | the player draws every line | each node, by one field |
| allocation | global: targets per city, passes, the nearest donor covers a deficit | global: factories serve the border first, then the rear far to near | local: any road to an emptier neighbour | per line, only the target fills | local: downhill to a neighbour with room |
| path of a charge | the server's fastest path, transit through cities to the target | the server's path | one road per dispatch, in any direction | the drawn path | one road per dispatch, always towards the front |
| the rear | holds `rear_min` | keeps 1 | fills as evenly as the front (soaks production) | empty | fills only after the front (or by the shift) |
| player input | markers, minimum, stance, transfers | none | valves | every line, every advance | none, or one global value (shift) |
| readable on the map | no (targets and donors are hidden numbers) | partly (roles) | yes (levels) | per line, many clicks to read | yes: one number per city and an arrow per road |

- **Against v1**: no settings, no targets, no donors, no passes, no server routing. The "donor" effect (the old front feeds the new one) comes out of the same local rule, not out of a separate pass. The only lever is one number.
- **Against V6**: the outcome at rest is close (the border full, the rear near empty), which is why V6 was the reference line in #693 and was rejected as "v1 again". The difference is the mechanism: V6 is a global allocation the player cannot see (who serves whom), this one is a local rule that can be read from every road; and the premise changed: the owner now prefers automation to micromanagement.
- **Against V12**: V12 evens out in every direction, so the rear soaks the production before the front and long chains are slow; its decision is valves. Here the flow has a direction (the front), the rear fills last, and evening out happens only along a level road.

## What changes in economy v2

- **Removed** under the new flag: lines (`DrawLine`, `RemoveLine`, `View.lines`, `line_cut`, `line_rerouted`, `line_auto`), the suggested path (`line_route_query`, #665), the auto-extension and its toggle (`SetAutoLines`, `lines.auto_extend*`, DEC-42 item 5), the line round robin (DEC-42 item 2). The DEC-41 item 6 promise "the player chooses the path" no longer applies: the field chooses, and the owner's new idea is the reason.
- **Kept**: factories and their rates, the cap and the capture rule (DEC-41 item 2); production into the factory warehouse; buildings paid in charges and the progressive payment (item 7); the bunker (item 12); the planned order gathering its bonus (item 10, and it pulls by 12A); the province warehouse of 1 (item 13); packets, recharge, `warehouse_lost`; no stances, markers, starvation (item 5).
- **New**: the field (`Node.front_dist`), the flow step, the full-factory spill, the leaf shift (`SetLeafShift(k)` or `ShiftLeaves(+1/−1)`, free, not public, `View.me.leaf_shift`).
- **Behind a flag**: `supply.model = "flow"` (default `"lines"`) under `economy.model = "v2"`, in a new `rulesets/mvp-4.toml` (= `mvp-3` plus the flow), so `mvp-3` and its golden replays stay and the two can be compared in a playtest.

## Cost

S up to a day, M a few days, L a week or more.

| Area | Size | What |
|---|---|---|
| DEC | M | DEC-43 in `mechanics.md`: the rule, the field, the shift, the examples as a table (the boards of the mockup become rows); supersedes DEC-41 items 3 and 6, DEC-42 and #665 under `supply.model = "flow"` |
| Sim | M | `systems/flow.py` (field, dispatch, spill, shift; about 150 lines), the flag, `mvp-4.toml`, table tests from the DEC rows, the mirror and property tests on `flow`, `SIM_VERSION` + golden replays |
| Protocol | S | `NodeView.front_dist`, `View.me.leaf_shift`, the shift command, the line commands `FEATURE_DISABLED` under flow; fog tests; `PROTOCOL_VERSION`, `regen` |
| Client | M | the Supply mode as a view: numbers, chevrons, the lit level, "no source", the `−`/`+` control; the line drawing UI hidden under flow; shots before and after |
| Bots | S | drop the line logic under flow; the shift stays at 0 at first (a bot may use `−` before a retreat later) |

## Risk: "opaque automation"

The owner disliked v1 for being automatic **and** opaque. This rule is automatic on purpose; the answer to opacity is that every part of it is on the map:

1. **One rule, local**: "a city passes one charge per road to a neighbour closer to the front". No hidden targets, priorities or global passes.
2. **The field is drawn**: a small number on every own city, a chevron on every road that carries. The player can predict where the next charge goes by looking.
3. **Every charge is visible** as a dot on a road; the refill visibly runs back along the chain, one city per dispatch.
4. **The only lever is drawn**: the lit leaf level and "ahead: no new supply".
5. **Exceptions are marked**: a pocket ("no source"), a cut road.

Remaining risks: the player may feel no agency over supply (mitigations: 12A, factories, the shift); the front holds the stock, so a breakthrough is costly (that is the point of the shift); ridges and provinces as necks behave in ways the player has to learn (4B, Q9).

## Open questions for the owner

Each with the recommendation.

1. **Leaf**: next to any node that is not own, neutrals included (rec.), or next to an enemy only?
2. **Fork**: the emptiest neighbour first (rec.), in turn, or a fixed order?
3. **Level roads**: even out by a gap of 2 (rec.), or carry nothing?
4. **Rear minimum**: none, the rear fills after the front (rec., as described), or every city keeps 1?
5. **Armies**: a tired army (or a gathering planned order) puts its node on the leaf level (rec.), or armies only take what passes?
6. **Pocket**: the same rule inside the pocket (rec.), or frozen?
7. **Leaf shift**: global (rec.) or per direction? Stock ahead of the level stays (rec.) or flows back? Free (rec.) or a CP price per step?
8. **Raids**: should an enemy group standing on a road block the packets on it (supply raids), or does only a capture cut a road (rec. for the first playtest: only a capture, today's rule)?
9. **Provinces**: keep them as 1-slot transit nodes (a neck, rec.), or let charges pass through a province without landing?
10. **Feint fallback**: add the settling delay (a fresh city is front after 30 to 50 ticks) together with the shift, or the shift alone (rec. for the first playtest)?
11. **Rollout**: a new ruleset `mvp-4` beside `mvp-3` for an A/B playtest (rec.), or replace lines in `mvp-3`?
12. **CP surplus**: which of C1 to C4 (no recommendation; separate decision)?
