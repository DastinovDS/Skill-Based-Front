# Supply distribution: variants

Status: **[awaiting the owner's decision]**. Follow-up: the owner's automatic flow idea (a field towards the front, the leaf shift) is worked out in [`supply-auto-flow.md`](supply-auto-flow.md) (#697). Design exploration for economy v2 (`economy.model = "v2"`, `rulesets/mvp-3.toml`); nothing here changes the rules. Decision issue: #693. Frames: [`mockups/img/693/`](mockups/img/693/). Short storyboards of every variant (3 scenarios each, start here): [`mockups/supply-examples.html`](mockups/supply-examples.html). Detailed mockup: [`mockups/supply-methods.html`](mockups/supply-methods.html) (open as a file; pick two variants, play the script, compare the counters and the board of all 15).

## The problem

The owner after the playtests of 2026-10-31 to 2026-11-02: supply distribution is the main UX problem of the game. What went wrong so far:

- **v1** (stances, two front markers, the rear minimum, donors, server routing, DEC-02, DEC-18, DEC-28): "mechanics for the sake of mechanics", too automatic and opaque; road and warehouse upgrades unused. A front marker with server routing was rejected again on 2026-11-01 ("v1 again").
- **v2 lines** (DEC-41): line trees and relays were confusing ("you have to click many cities to understand what goes where"), so DEC-42 made lines factory-only.
- **DEC-42 playtest (2026-11-02):** the auto-extension puts a second line on top of an existing one; the "Auto lines" toggle is not understood; a line into a province seems to burn charges; rear transit cities stay empty.

Constraints every variant is held to: 1v1, 10 to 15 minutes, 10 ticks per second, the player's attention is on the armies, so supply takes few clicks but stays a real decision; readable without opening many menus; no hidden automation; deterministic integer simulation, server-authoritative, fog of war (the enemy does not see the supply plan unless the variant says so); a charge is a shot. CP is in surplus today, so a variant may spend CP.

## How the mockup compares them

One toy map of 14 nodes: the capital K (the only factory), rear cities A, B, C, D, the province P, the front cities N1 and S1 with an army each, then N2, S2, Q (a province), N3, S3, H to capture. Both armies spend a charge every 2.6 s. A script captures a city every 15 to 20 s, cuts the roads C-N1 and N2-Q at 1:50 (the north becomes a pocket until H is taken at 2:10) and mends them at 2:30. Each variant has a scripted player who does the setup clicks at the start and reacts after an attention delay: **Focused** 1 s, **Busy** 6 s, **Away** (setup only). The counters: clicks, charges the armies took (to armies), seconds an army had no charge (army dry), charges idle in the rear above 1 per node, rear cities with an empty warehouse, charges burned or lost.

The toy numbers are not ruleset numbers (the factory makes 1 charge per second, roads take about 1 s); they show the **shape** of each method: where charges pile up, where they starve, and what the player has to click. The table below is the board of the mockup with the **Busy** player.

| # | Variant | One-line rule | Clicks / 3 min (Busy) | To armies | Army dry, s | Rear idle | Empty rear | Burned/lost | DEC | Sim | Protocol | Client | Bots | Fit (1-5) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| V0 | Now: factory lines (DEC-42) | lines factory → city, only the target fills, a capture copies the nearest line | 12 | 130 | 23 | 9.2 | 4.3 | 32 | none | none | none | none | none | 2 |
| V1 | Lines + transit buffer K + ladder | as V0, each transit city keeps K (every 2nd charge), a ladder pulls the buffer toward the target | 14 | 129 | 33 | 8.3 | 0.5 | 29 | yes | M | S | S | S | 3 |
| V2 | Weighted lines + drag to retarget | lines with a weight pause/normal/main, drag a line end to move it, a status mark at the target | 11 | 127 | 38 | 9.1 | 4.3 | 35 | small | S | S | M | S | 3 |
| V3 | Growing spine | one line per front, transit cities keep 1, the tip grows into a city captured next to it | 6 | 130 | 23 | 7.2 | 0.4 | 31 | yes | M | S | S | S | **4** |
| V4 | Conveyor roads | click a road to give it a flow arrow; cities on a flow keep 1, the end of a flow fills | 11 | 117 | 56 | 4.3 | 0.2 | 48 | yes | M | M | M | M | **4** |
| V5 | Demand pips per city | each city asks for a stock 0..full, factories fill the requests (full first, nearest first) | 18 | 124 | 36 | 9.3 | 0.1 | 31 | yes | M | S | M | S | 2 |
| V6 | Border roles (automatic) | cities on the border fill up, the rest keep 1, the player sets nothing | 0 | 130 | 23 | 8.1 | 0.2 | 25 | yes | S | S | S | S | 1 |
| V7 | Depots with a district | factories feed up to two depots, a depot fills the cities one road around it | 7 | 116 | 51 | 8.2 | 1.4 | 41 | yes | M | S | M | M | 3 |
| V8 | Request tickets | a city asks once for 4 charges, factories serve the tickets in order | 18 | 60 | 206 | 7.2 | 5.6 | 111 | yes | S | S | M | S | 2 |
| V9 | Convoys | wagons shuttle 4 charges factory ↔ city at army speed, visible and interceptable | 9 | 60 | 206 | 9.6 | 4.1 | 105 | yes | L | M | L | L | 2 |
| V10 | Army tether | tie a group to a factory, its line follows the group | 4 | 130 | 23 | 9.2 | 4.3 | 32 | yes | S | S | S | S | 3 |
| V11 | Painted zones + split | paint up to two zones and a split, a zone fills its emptiest city, a capture joins its zone | 7 | 130 | 17 | 10.7 | 2.1 | 26 | yes | M | S | M | M | 2 |
| V12 | Pressure and valves | charges flow along every open road to an emptier neighbour, a valve closes a road | 2 | 124 | 39 | 5.1 | 2.0 | 41 | yes | M | S | M | M | 3 |
| V13 | Supply radius, no packets | a factory fills the emptiest city within 3 roads, a depot (3 charges) extends the reach | 3 | 135 | 14 | 9.4 | 0.1 | 6 | yes | M | S | M | M | 3 |
| V14 | Airlift for CP | no network: 1 CP drops 2 factory charges into any own city in 2.5 s | 34 | 61 | 223 | 5.1 | 5.8 | 113 | yes | S | S | S | S | 2 |

Sizes: S up to a day, M a few days, L a week or more (sim includes the DEC text, tests, `SIM_VERSION` and golden replays; protocol includes `PROTOCOL_VERSION` and `regen`).

**Fit** scores the pain points: (a) what goes where reads on the map without opening cities, (b) few clicks per front advance, (c) a real decision and no hidden automation, (d) no duplicate or stale lines when the front moves, (e) the rear is not left empty, (f) no surprise burning, (g) cheap and safe for fog and determinism.

## Recommendation

1. **V3 Growing spine** (recommended). The smallest step from DEC-42 that removes every pain point of the last playtest: one line per front instead of a line per city (no copy on top of a copy: the line grows), transit cities keep 1 (the rear is not empty), the tip follows a capture next to it by a rule the player can see (the line visibly lengthens), provinces are skipped (no surprise burning), the toggle "Auto lines" goes away. 6 clicks in 3 minutes, and it survives an "Away" player. The decision left to the player: how many spines and along which roads. Cost: a DEC, a medium sim change on the existing line code, a small protocol change.
2. **V4 Conveyor roads**. The most readable one: every road shows its own arrow, so "what goes where" is on the map, never in a menu; a front advance is one click on one road; the rear keeps 1 by the rule. The trade-off seen in the mockup: a city with an army on a flow keeps eating what passes through it (army dry 56 s when the north army stands behind the south one), and the player must click on every advance (an Away player starves). Cost: a DEC that replaces lines with flow roads, a medium change in sim, protocol, client and bots.
3. **V13 Supply radius** (the radical one). The best numbers of the board and the fewest clicks: no lines and no packets, only "where are my factories and depots"; a cut works through the road graph (a pocket falls outside the radius). The trade-off: supply loses its roads-and-packets texture (no interception on a road, nothing to look at), and the decision moves into building depots. Worth a playtest only if the owner wants supply to be a background system.

Not recommended: V6 (zero clicks, but it is v1 again), V8 and V14 (attention-hungry: the front starves as soon as the player is busy), V9 (great flavour, but slow and fragile at this pace and the largest cost), V11 (stock spreads across the zone and idles in the rear).

## The variants

Each block: the rule; what the player does; what the opponent sees; the front moving forward; the rear; a cut-off pocket; pros; cons and risks; cost.

### V0. Now: factory lines (DEC-42), the baseline

- **Rule.** A factory starts any number of lines; a line is a drawn path factory → city; only the target fills (1 charge per line per dispatch, round robin, a full target skipped). A factory that is a target is a hub. With "Auto lines" on, a captured city gets a copy of the nearest own line plus the fastest extension.
- **Player.** 2 clicks per line (source, target with the suggested path), 2 to remove one from the target's menu. About 2 to 4 clicks per minute while the front moves.
- **Opponent sees.** Nothing.
- **Front forward.** The auto-copy gives the new city its own line, and the old line keeps feeding the city the army left: the player removes it by hand or the stock idles there.
- **Rear.** Transit cities get nothing (empty rear 4.3 in the mockup).
- **Pocket.** A line with no way round is cut and must be redrawn after the pocket is relieved.
- **Pros.** Built, tested, precise; the player owns the path.
- **Cons.** Lines pile up (a copy on top of a line), the toggle is not understood, the rear stays empty, a province target burns its excess.
- **Cost.** None.

### V1. Lines + transit buffer K + ladder (the queued idea)

- **Rule.** As V0, plus a per-line K: every transit city of the line keeps up to K, taking every second passing charge while below K. A ladder: when the target has room, the city before it sends a charge from its buffer, the one before refills it, back to the factory, one road per step.
- **Player.** As V0 plus 1 click for K per line (a 3-state toggle 0/1/2 rather than a slider).
- **Opponent sees.** Nothing.
- **Front forward.** As V0 (the copy and the stale line stay a problem); the new line inherits K.
- **Rear.** Solved: transit cities hold K (empty rear 0.5).
- **Pocket.** The buffers inside the pocket are its reserve, which is the right feeling.
- **Pros.** Fixes the empty rear without more lines; the ladder makes the front draw first.
- **Cons.** A city on several lines has one warehouse and several K (needs a rule); two new concepts on top of lines; the line clutter of V0 stays.
- **Cost.** DEC, sim M (per-line K, alternate keep, ladder), protocol S (K on the line), client S, bots S.

### V2. Weighted lines + drag to retarget (the parked UX ideas)

- **Rule.** Lines as V0 with a weight: paused (0), normal (1), main (2 shares of the round robin). A line end can be dragged to another city: the path is kept up to the old target and extended. A mark at the target: flowing, full, starving. No auto-extension.
- **Player.** 2 clicks per new line, 1 drag per front advance, 1 click per weight change.
- **Opponent sees.** Nothing.
- **Front forward.** One drag moves the line with the army: no duplicates, no stale line.
- **Rear.** Empty unless the player draws low-weight lines to it.
- **Pocket.** As V0.
- **Pros.** Cheap, mostly client; pause replaces remove-and-redraw; the status mark answers "is it working?" at a glance.
- **Cons.** Still manual on every advance (an Away player starves: army dry 273 s); the rear problem remains.
- **Cost.** DEC small (weight, retarget command), sim S, protocol S, client M, bots S.

### V3. Growing spine (recommended)

- **Rule.** A spine is a line from a factory along a path the player draws. The tip fills first; when the tip is full, the transit city nearest the tip with fewer than 1 charge gets the next one; a transit city holding more than 1 rolls the extra one road toward the tip. When the player captures a **city** joined by a road to a spine's tip, the spine grows into it (the old tip becomes transit). Provinces are never grown into. Break rules as DEC-41 (reroute, cut).
- **Player.** 2 clicks per spine (usually one per front); 0 per advance along the spine; 2 to start a new spine where the front forks. About 0 to 1 click per minute.
- **Opponent sees.** Nothing.
- **Front forward.** The spine grows: one line, longer, never a copy. A capture away from the tip (a flank) is not joined until the player draws a branch spine.
- **Rear.** Every city on a spine keeps 1 (empty rear 0.4); cities off the spines stay empty, which is a visible choice.
- **Pocket.** The cut spine reroutes or is cut; the transit 1s inside the pocket are its reserve; after relief the player redraws (2 clicks).
- **Pros.** One concept, one line per front, readable (the spine is the front's supply road); the growth rule is visible on the map; robust when the player is busy.
- **Cons.** "Keep 1 on the way" is fixed (a player who wants a pure pipe cannot have it unless K becomes a setting, which is V1); a fork needs a second spine.
- **Cost.** DEC (replaces the DEC-42 auto-extension and the toggle), sim M on the line code, protocol S (the toggle goes), client S (one line style, growth mark), bots S.

### V4. Conveyor roads

- **Rule.** There are no lines: the player gives own roads a flow arrow (click a road: off → toward one end → toward the other → off). A charge leaves a factory along its flow roads (round robin) and passes straight through any city on a flow that already holds 1; a city on a flow with 0 keeps it; a city where the flow ends fills its warehouse. A flow never sends into a part of the network that has no room.
- **Player.** 1 click per road; 1 click per front advance (the road from the old front city to the new one); the network is the decision (which roads, where it forks).
- **Opponent sees.** Nothing.
- **Front forward.** One road click; the old front city becomes "on the flow" and keeps 1.
- **Rear.** Keeps 1 on every flow city (empty rear 0.2, the least rear idle of the board).
- **Pocket.** A cut road is dead; the player clicks a detour; inside the pocket the flow cities keep their 1.
- **Pros.** Everything readable on the roads, local, no menus; the road becomes meaningful again (the road upgrade audit pain); one click per advance.
- **Cons.** An army standing on a flow city eats what passes (it refills its keep-1 from the flow); every advance needs a click; flows that cross need a tie rule; a new model replaces lines (bigger change).
- **Cost.** DEC (replaces lines), sim M, protocol M (flow roads in the view), client M (arrows on roads, the click cycle), bots M.

### V5. Demand pips per city

- **Rule.** Every own node has a requested stock 0..full (a click on the city cycles it). Each dispatch, factories send one charge to each node below its request, the "full" requests first, then by distance; the server picks the fastest path.
- **Player.** 1 click per city change; setting up the rear is 1 click per city. About 2 to 4 per minute.
- **Opponent sees.** Nothing.
- **Front forward.** Raise the new city, lower the old one (2 clicks).
- **Rear.** As good as the player sets it (empty rear 0.1), at a click cost.
- **Pocket.** Requests inside the pocket wait.
- **Pros.** Pull, not push: the player says where, not how; precise.
- **Cons.** The server picks the path (against DEC-41 item 6); close to DEC-18 priorities, which v1 left; many clicks.
- **Cost.** DEC, sim M, protocol S, client M, bots S.

### V6. Border roles (automatic, a reference point)

- **Rule.** A node next to a non-own node fills to full; every other node keeps 1; factories serve the border first, then the rear far to near. The player sets nothing (an override could pin a city).
- **Player.** 0 clicks.
- **Opponent sees.** Nothing.
- **Front forward / rear / pocket.** All by the rule; a pocket waits.
- **Pros.** The numbers are good and it costs no attention.
- **Cons.** It is v1 again: no decision, the owner rejected it twice.
- **Cost.** DEC, sim S, protocol S, client S, bots S. Shown only as the bar every manual variant is measured against.

### V7. Depots with a district

- **Rule.** The player names up to two depots. Factories feed the depots in turn; each depot fills the own nodes one road around it (border nodes to full, the rest to 1), the largest gap first.
- **Player.** 1 click per depot move; about 1 per front advance of each front.
- **Opponent sees.** Nothing (a depot could follow the DEC-31 rule if it should be a target).
- **Front forward.** Move the depot one step forward.
- **Rear.** Only around depots (empty rear 1.4).
- **Pocket.** A depot in the pocket feeds its district from its own stock.
- **Pros.** Few, spatial decisions; reads as "two supply bases".
- **Cons.** The district radius is arbitrary; a marker that the server serves, close to the rejected front marker.
- **Cost.** DEC, sim M, protocol S, client M, bots M.

### V8. Request tickets

- **Rule.** A city issues a one-off ticket "send 4"; factories serve the open tickets in order, one charge per ticket per dispatch, along the fastest path. A ticket ends when filled.
- **Player.** 1 click per ticket, repeated whenever the front runs low: the most clicks of the board after the airlift.
- **Opponent sees.** Nothing.
- **Front forward / rear / pocket.** Only what is asked for; a pocket's tickets wait.
- **Pros.** Every charge is a decision; trivial to explain.
- **Cons.** It punishes a busy player hard (army dry 206 s); the rear is never served.
- **Cost.** DEC, sim S, protocol S, client M, bots S.

### V9. Convoys (radical)

- **Rule.** Charges travel only in wagons: a wagon is a group-like token with 4 slots that loads at a factory, travels at army speed to its target, unloads, returns. A wagon on a road that is cut or entered by the enemy is destroyed with its cargo.
- **Player.** 2 clicks per convoy, 1 to retarget.
- **Opponent sees.** Wagons in its vision, like groups (that is the point: raids).
- **Front forward.** Retarget the wagon.
- **Rear.** Not served.
- **Pocket.** The wagon is lost or stuck; the pocket starves.
- **Pros.** Physical, interceptable supply: raids on the rear become a strategy.
- **Cons.** Slow and lumpy at this pace (to armies 60); more units to manage; the largest cost.
- **Cost.** DEC, sim L (a new entity with fights), protocol M, client L, bots L.

### V10. Army tether

- **Rule.** The player ties a group to a factory; the factory keeps a line to the node where the group stands, along the fastest path; the line moves with the group. A tie ends when the group dies.
- **Player.** 2 clicks per group, then nothing.
- **Opponent sees.** Nothing.
- **Front forward.** Automatic: the line follows the army.
- **Rear.** Empty; cities the army left keep what they had.
- **Pocket.** The line is cut while there is no path.
- **Pros.** The player thinks in armies, where the attention already is.
- **Cons.** Server routing that follows a moving target: close to the rejected "front marker with auto-routing"; the stock left behind idles.
- **Cost.** DEC, sim S, protocol S, client S, bots S.

### V11. Painted zones + split

- **Rule.** The player paints cities into up to two zones and sets a split (for example 50/50). Each dispatch the factories alternate the zones by the split; inside a zone the emptiest city gets the charge. A city captured by an army joins the zone of the city the army came from.
- **Player.** 1 stroke per zone, 1 click to unpaint a city left behind.
- **Opponent sees.** Nothing.
- **Front forward.** Automatic joining; the zone grows, so stock spreads into the old front.
- **Rear.** Cities in a zone are kept level, which idles the most charges in the rear (10.7).
- **Pocket.** The zone part inside the pocket waits.
- **Pros.** A high-level control ("70% to the north") with the reason visible.
- **Cons.** "Emptiest first" dilutes the front; painting is fiddly on a small map.
- **Cost.** DEC, sim M, protocol S, client M, bots M.

### V12. Pressure and valves (radical)

- **Rule.** No lines: every dispatch each own node passes one charge along each open own road to a neighbour whose fill (stock / capacity, plus what is on the way) stays below its own after the pass. The player closes roads with a valve.
- **Player.** 1 click per valve, rarely.
- **Opponent sees.** Nothing.
- **Front forward.** Automatic: an army that spends charges lowers the level and draws the flow.
- **Rear.** Fills evenly; valves keep it from soaking up the flow.
- **Pocket.** Levels even out inside the pocket.
- **Pros.** One physical rule anyone can read from the warehouse squares; almost no clicks; deterministic.
- **Cons.** Slow over long chains (one road per dispatch); a big rear soaks up production before the front; the decision (valves) is thin.
- **Cost.** DEC, sim M, protocol S, client M, bots M.

### V13. Supply radius, no packets (radical)

- **Rule.** A factory fills the emptiest own node within 3 roads of it (counted over own open roads), one charge per dispatch, arriving after a short delay per road, with no packet on the road. A depot (3 charges, built in a city in range) becomes a source of reach while it is connected to a factory.
- **Player.** 1 click per depot, about one per two captures.
- **Opponent sees.** Built depots, as a factory (DEC-31).
- **Front forward.** Out of range until a depot is built forward.
- **Rear.** Everything in range is kept level (empty rear 0.1).
- **Pocket.** Outside the radius of any connected source: starves; a depot inside the pocket is not a source.
- **Pros.** The best numbers and the simplest picture ("the green area is supplied"); building is the decision.
- **Cons.** Supply on the roads disappears (no interception, nothing moving); the rear idles; the radius is a tuning knob with large effects.
- **Cost.** DEC, sim M, protocol S, client M, bots M.

### V14. Airlift for CP (radical)

- **Rule.** No network at all. The factory stock is the national stock; 1 CP drops up to 2 of it into any own city after 2.5 s, through a cut or a pocket.
- **Player.** 1 click and 1 CP per drop, every time the front runs low.
- **Opponent sees.** A drop in its vision (a flare over the city).
- **Front forward / rear / pocket.** Only where the player drops; a pocket can be supplied at a price.
- **Pros.** Uses the CP surplus; trivial to explain; a hard tension between CP for moves and CP for charges.
- **Cons.** Attention-hungry (34 clicks, army dry 223 s for a busy player); roads no longer matter for supply; the factory overflows.
- **Cost.** DEC, sim S, protocol S, client S, bots S.

## Open questions for the decision

- V3: should a spine also grow into a captured city next to any of its nodes (a flank), or only next to the tip? (The mockup: only the tip.)
- V3 and V1: is "keep 1" fixed or a per-spine setting (0/1/2)?
- V4: what does a city with an army on a flow do with passing charges (the mockup: it keeps 1 like any flow city, so the army eats the flow)?
- Any variant: what happens to the DEC-42 hub factories (the mockup has one factory).
