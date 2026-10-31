# Skill-Based Front: mechanics

> **Status: mechanics frozen for the first release on 2026-10-28 (owner decision).** Bugs are fixed at once; new rules
> and mechanics go to the queue after the release (#282).

> **The single source of truth about the game rules** (see `AGENTS.md`, section 0).
> The basis of the document: a digest of the mechanics discussions (the "battery unit" model). The decisions of the DEC issues
> are written into the matching sections; their summary list: section 21.
>
> All the numbers of the rules live in `rulesets/*.toml` (SIM-01, #17). The numbers here are the starting values;
> balancing changes the ruleset, not this document. What is postponed beyond the MVP is listed in
> [`docs/mvp/MVP_PLAN.md`](../mvp/MVP_PLAN.md), the section "What is not in the MVP".
>
> The terms match the glossary of `AGENTS.md` (section 15).

## How to read the statuses

| Label | Meaning |
|---|---|
| **[accepted]** | the decision is confirmed by the owner of the project |
| **[default]** | the default value from a DEC issue; the code implements it until the DEC issue changes the status to [accepted] or records another decision |
| **[proposed]** | a proposal from the discussion; the owner did not object but did not explicitly confirm it |
| **[open]** | the question is not settled, there are options |
| **[rejected]** | the option was considered and replaced by another one (see section 16) |
| **[superseded by DEC-N]** | the accepted text is cancelled by a later decision DEC-N; the text is kept struck through for history, the DEC-N block is in force |

If the decision of a DEC issue refines an item with the status [proposed] or [open], next to the item there is
a reference to the DEC, and the rule in force is written in the DEC block in the same section. If they disagree,
the DEC block is in force.

If a later decision cancels an accepted text, that text is struck through (`~~...~~`) and
marked **[superseded by DEC-N]** with a reference to the block where the rule in force is written. The blocks
"How the simulation computes this" with such a label describe the code before the new decision was implemented.

---

## 1. Scope

- **[accepted]** The match length is 10-15 minutes. The exact length in the MVP: 15 minutes (DEC-22, section 8; it was 12 minutes under DEC-03, section 11).
- **[proposed]** The map size is 25-40 nodes. **[superseded by DEC-27 for the size]**: the new maps have 45..55 nodes (#266: `ridge`, `crossroads`, `highway`). Each player already has a meaningful territory at the start.
- **[proposed]** A pool of hand-made maps with N-fold rotational symmetry instead of procedural generation. The reason: repeating positions let players accumulate knowledge (opening theory), random maps do not. DEC-27 (#266): the symmetry of the rules (the graph and its attributes), not of the picture; the node coordinates are free.
- **[accepted]** No pay-to-win.
- **[open]** 1v1 / team or FFA (see the open questions, item 1). MVP: 1v1 only (`docs/mvp/MVP_PLAN.md`).

---

## 2. Design invariants

The rules whose violation breaks the main idea of the game.

1. **Income does not grow from territory.** Neither CP nor supply. This is the main brake against a snowball.
2. **The rules are public, only the enemy's state is hidden.** No hidden constants: they are found out within a week, after which they become a tax on newcomers.
3. **No randomness in a fight.** A player must understand why they lost.
4. **Everything a player watches is derived from the map.** As few separate counters as possible.
5. **Integer additive rules.** The outcome of a fight must be computable in your head.
6. **No micro-management.** Skill is in the decisions, not in the speed of the hands.

---

## 3. Unit and charge

- **[accepted]** There is **one** unit type.
- **[accepted]** A unit is a "battery". It has two states: **charged** (there is supply) or **discharged**.
- **[accepted]** The strength of a unit = its charge. A discharged unit has no strength in a fight.
- ~~**[accepted]** Splitting and merging groups costs CP.~~ **[superseded by DEC-20]**: splitting, merging and cancelling any orders are free, groups merge by themselves (the DEC-20 block below).
- ~~**[open]** Which units leave when a group is split, what mode the new and the merged group have, whether a group can be commanded on the way: question #117. Until it is decided (SIM-04): `Split(group, n)` gives the new group the charged units first (`min(n, charged)`), the new group is in "Attack" and without an order; `Merge(groups)` gathers the groups standing in one node into the group with the smallest id, mode "Attack", orders and construction are removed; commands to a group on an edge are rejected (`GROUP_ON_EDGE`), to a group that waits to set out on a scheduled order all commands except cancel (`GROUP_BUSY`).~~ **[superseded by DEC-20]**: the DEC-20 block below; what is not set there, by the default from #117 (splitting gives the charged units first).
- ~~**[accepted]** Groups can be gathered only in cities, so the size of a group is limited by the capacity of a city.~~ **[superseded by DEC-20, DEC-23]**: groups stand in cities and provinces, the size of a group on the way is limited by the capacity of the nodes (the stack limit, DEC-20). There is no separate penalty for big groups.
- **[proposed]** Interface: a green or red dot above a unit (charged / discharged). This is the main indicator of the whole economy.

### Unit modes

- ~~**[accepted]** Three modes: **Attack / Defense / Building** (on the board: A / D / B).~~ **[superseded by DEC-16]**
- **[accepted]** Two modes: **Attack / Defense** (DEC-16, section 8). Roads are upgraded by a city, not by a group.
- ~~**[open]** "A builder upgrades roads": is it a separate unit type or a mode "B" of an ordinary unit? A separate unit type breaks the "one unit" principle and changes the triangle of modes.
  In the MVP plan roads are upgraded by the "Building" mode of an ordinary unit (SIM-11, #27); the effects of the modes: DEC-08, section 5.~~
  **[superseded by DEC-16]**: neither a separate unit nor a mode. Upgrading a road: a function of one's own city, paid with the charges of its warehouse (section 8).

### Appearance of new units (DEC-01, #7) **[accepted]**

Recruiting in any own city with free capacity: ~~the command `Recruit(node)` creates one discharged unit as a new group for 1 CP; no more than one unit per city per 20 ticks, otherwise the rejection `RECRUIT_COOLDOWN`.~~ **[superseded by DEC-25]**: `Recruit(node)` puts a unit into the production queue of the city, CP at queueing (the DEC-25 block below). The flag `recruit.location = any_city | capital`. **[superseded by DEC-26 with `city_upgrades.enabled = true`]**: the capital and the cities with a barracks recruit (the block "Barracks (DEC-26)" below), `recruit.location` does not apply.

Values in `rulesets/mvp-0.toml`: ~~`recruit.cooldown_ticks`~~ **[superseded by DEC-25]**: `recruit.unit_ticks`, `recruit.queue_max`, `recruit.refund_started_pct`; `recruit.location`, `orders.cost.recruit` (in hundredths of CP).

~~How the simulation computes this (SIM-12, #28): a unit appears when the command is applied (at the start of the tick), the new group is in "Attack", one unit without a charge. Free capacity: the own units standing in the city are fewer than its capacity (section 9; groups on edges in transit do not count). The cooldown belongs to the city: a recruit at tick `t` allows the next one in this city from tick `t + cooldown_ticks`. The rejections are checked in the order: the city does not exist (`NOT_FOUND_OR_HIDDEN`), not own (`NOT_OWNER`), not the capital when `recruit.location = capital` (`NOT_CAPITAL`), no room (`CITY_FULL`), cooldown (`RECRUIT_COOLDOWN`), not enough CP (`NOT_ENOUGH_CP`).~~ **[superseded by DEC-25]**: how the simulation computes this: the DEC-25 block below, "Implementation". Groups on edges in transit still do not occupy capacity.

Alternatives (not chosen):
- Only in the capital (a slower arrival at the front, a stronger role of logistics).
- Recruiting for charges from the warehouse instead of CP.

### Recruit queue (DEC-25, #262) **[accepted]**

The owner's decision of 2026-10-14 (#252). It replaces the instant recruit and the cooldown of DEC-01 (above). The items
**[accepted]** by the owner on 2026-10-14: he chose production of 3 s per unit (the alternative of question 1) and
a queue of up to 3, and accepted the other recommendations. Implemented in #278 (`SIM_VERSION` 11,
`PROTOCOL_VERSION` 15), the block "Implementation" after the examples.

1. **[accepted]** Every own city has a unit production queue. The progress of the current unit and
   the length of the queue are visible to the owner above the city.
2. **[accepted]** CP are charged when a unit is put into the queue (`orders.cost.recruit`, 100 hundredths).
3. **[accepted]** Cancelling a unit that has not started refunds the CP in full; cancelling a unit
   in production: a half. CP are in hundredths, rounded down: the refund is
   `orders.cost.recruit * recruit.refund_started_pct // 100` (100 * 50 // 100 = 50, that is 0.5 CP).
4. **[accepted]** **Production.** A city makes one unit at a time, `recruit.unit_ticks = 30`
   (3 s). In production: the first unit of the queue. The progress
   `Node.recruit_progress` grows by 1 on every tick when the queue is not empty and there is no fight in the city
   (item 9); the unit is ready when the progress equals `unit_ticks`. The `recruit` system (the order of systems does not
   change) goes after `apply_commands`, so a unit put into an empty queue at tick `t`
   gets the first tick of progress at `t` and appears at tick `t + unit_ticks - 1`; the next one
   starts on the next tick. The cooldown `recruit.cooldown_ticks` is removed.
5. **[accepted]** **The unit** appears discharged, as a new group in "Attack", on the same tick
   merges under DEC-20, item A1. A warehouse charge is not needed for it to appear. It takes a charge later, by the usual
   recharge of the standing units from the warehouse of the city (`supply.recharge_per_tick`, section 7), if the warehouse
   has a charge. The `supply` system goes before `recruit`, so the first recharge of a new unit is on the
   next tick.
6. **[accepted]** **Queue length:** no more than `recruit.queue_max = 3` units per city,
   including the current one; otherwise the rejection `QUEUE_FULL` (a new code).
7. **[accepted]** **Capacity.** When queueing: the owner's standing units in the city plus the queue are
   fewer than the capacity (DEC-22), otherwise `CITY_FULL`. A ready unit that has no room (the city was filled
   by arrived groups) waits with full progress and appears on the first tick when there is room.
   The unit is not lost, CP are not refunded.
8. **[accepted]** **Where:** only an own city (a province: `NOT_CITY`, DEC-23), taking into account
   `recruit.location` (`any_city | capital`); with `city_upgrades.enabled = true` instead: only a
   city with a barracks (`NO_BARRACKS`, DEC-26, the block "Barracks" below). A cut-off city (DEC-19) produces as usual
   (DEC-19, item 9).
9. **[accepted]** **A fight in the city** (DEC-24, section 4): while a fight goes on in the city, the progress stands;
   queueing and cancelling are possible. A ready unit does not appear in the middle of a fight.
10. **[accepted]** **Capture of the city:** the queue and the progress are lost, CP are not refunded (like the warehouse:
    on capture it is zeroed, there are no spoils). The new owner starts with an empty queue. The event
    `recruit_queue_lost` (node, number of units) is received only by the former owner.
11. **[accepted]** **Commands.** `Recruit(node)`: put one unit into the queue (with
    `city_upgrades.enabled = true`, instead of `NOT_CAPITAL`, `NO_BARRACKS` is checked, DEC-26). The rejections in the order
    of checking: `NOT_FOUND_OR_HIDDEN`, `NOT_OWNER`, `NOT_CITY`, `NOT_CAPITAL`, `QUEUE_FULL`,
    `CITY_FULL`, `NOT_ENOUGH_CP`. `CancelRecruit(node)` (new, free): remove the **last**
    unit of the queue; it is in production only if it is the only one in the queue. The rejections:
    `NOT_FOUND_OR_HIDDEN`, `NOT_OWNER`, `NOTHING_TO_CANCEL` (the queue is empty). A refund above the CP
    ceiling burns, like regeneration at the ceiling (the event `cp_burned`).
12. **[accepted]** **Player view.** For an own city in `NodeView`: `recruit_queue` (the number of units in
    the queue), `recruit_progress` (the ticks of the current one), `recruit_waiting` (ready but no room). For foreign and
    neutral nodes `None`: the enemy's production is hidden (AGENTS.md, 4.4). A fog test for
    each field. The events `recruited` (as now), `recruit_cancelled` (node, refund) only to
    the owner.
13. **[accepted]** **Bots:** queue no more than can be produced before the next
    decision, taking CP into account; handle `QUEUE_FULL`; keep the queue in the rear cities (the risk of
    losing it on capture, item 10).

Numbers in the ruleset (the section `[recruit]`): `unit_ticks = 30`, `queue_max = 3`,
`refund_started_pct = 50`; `cooldown_ticks` is removed; `orders.cost.recruit = 100` unchanged.

Worked examples. City X (medium, capacity 6), 1 unit of the owner stands in it, `recruit.location
= any_city`, CP 300, the numbers above. Implementation tests: exactly this table.

| # | Situation | Result |
|---|---|---|
| 1 | `Recruit(X)` at tick 1000, the queue is empty | CP 200, queue 1; the unit appears at tick 1029 and merges with the group of X (DEC-20) |
| 2 | three `Recruit(X)` at tick 1000 | CP 0, queue 3; the units at ticks 1029, 1059, 1089 |
| 3 | as 2, `CancelRecruit(X)` at tick 1020 | the third is removed (not started): CP +100 = 100; queue 2, the first still appears at 1029 |
| 4 | as 1, `CancelRecruit(X)` at tick 1020 | the current one is removed: CP +50 = 250; the queue is empty, progress 0 |
| 5 | 3 units in the queue; `Recruit(X)` | `QUEUE_FULL` |
| 6 | 5 units stand in X, queue 1; `Recruit(X)` | `CITY_FULL` (5 + 1 = 6, not less than the capacity) |
| 7 | as 1, at tick 1020 an own group arrived in X, 6 units stand; at tick 1050 a group of 2 units left | at tick 1029 the unit is ready but waits (`recruit_waiting`); appears at tick 1050 |
| 8 | as 1, a fight in X from tick 1010, the fight ended at tick 1040 (X held) | progress 10 by tick 1009, stands at ticks 1010..1039; 20 more are needed: the unit at tick 1059 |
| 9 | as 2, X captured at tick 1020 | the queue is lost, CP 0 (not refunded), `recruit_queue_lost` with 3 units |
| 10 | as 1, X cut off from the capital (DEC-19) since tick 990 | production goes on, the unit at tick 1029 |
| 11 | CP 50; `Recruit(X)` | `NOT_ENOUGH_CP` |
| 12 | CP 450, queue 2; `CancelRecruit(X)` | refund 100: 500 (the ceiling), 50 burn (`cp_burned`) |
| 13 | `Recruit(P)`, P: an own province | `NOT_CITY` |
| 14 | as 1, 2 charges in the warehouse of X | the unit appears at tick 1029 discharged (group X: 2 units, 1 charged); at tick 1030 it takes a charge from the warehouse (warehouse 1), group X: 2 units, 2 charged |
| 15 | as 14, the warehouse of X is empty | the unit stays discharged until a charge arrives at the warehouse |

What the implementation changes: the state `Node.recruit_queue`, `Node.recruit_progress` (instead of
`recruited_tick`) and `SIM_VERSION`; the command `CancelRecruit`, the code `QUEUE_FULL`, the `NodeView` fields and
events, `PROTOCOL_VERSION`; the client: progress above an own city, the number in the queue, cancelling; bots;
rulesets (`mvp-0`, the test ones).

Example 14 was refined during implementation (#278): the original unit of X is charged (otherwise from a warehouse of 2 charges it
would have charged before tick 1029); "1 charged" was the number of the group at the tick of appearance, after the recharge
at tick 1030 both are charged.

**Implementation** (#278; `gow_sim.systems.recruit`, `SIM_VERSION` 11, `PROTOCOL_VERSION` 15):

- The state of a city: `Node.recruit_queue` (units in the queue, including the current one) and
  `Node.recruit_progress` (the ticks of the current one, `0..unit_ticks`); `recruited_tick` and the cooldown are removed.
- **[proposed]** "In production" (item 3, a half refund) is a unit only if it is the only one in the queue
  **and** it already has progress. A single unit without progress (queued in a city with a fight, where the
  progress stands) has not started yet: the refund is full. An alternative: the first in the queue is always "in
  production", even without progress.
- The `recruit` system walks the cities by player, for each in the order of `node_key` (AGENTS.md, 4.1,
  rule 6): the ids of the new groups of one player are mirrored. Room for a ready unit: the owner's standing
  units in the city are fewer than the capacity.
- Queueing gives no event (the answer: `ack`); the event `recruited` at the tick of appearance.
  `recruit_cancelled` (player, node, `cp`: the refund up to the ceiling), `recruit_queue_lost` (player: the former
  owner, node, `units`) only to the owner; `cp_burned` when the refund is above the ceiling.
- The rejection `IN_FIGHT` for `Recruit` in a city with a fight (temporary, DEC-24, "How the simulation computes this",
  item 9) is removed: queueing and cancelling in a fight are possible, the progress stands.
- `ruleset_public.recruit` (`unit_ticks`, `queue_max`, `refund_started_pct`) for the progress bar and
  the refund line in the city menu. The client: above an own city the queue slots, the first one is filled
  with progress (full: ready and waiting for room); the radial menu of the city: "Recruit" (R), "Cancel recruit".
- Bots queue one unit per city (the queue is empty), not in a city with a fight, and choose a rear
  city before a front one (item 13).

Alternatives (not chosen):
- Production of 5 s per unit (`recruit.unit_ticks = 50`) and a queue of up to 5 (`recruit.queue_max = 5`): proposed first, the owner chose 3 s and 3.
- A unit comes charged for a charge of the city warehouse (more expensive, but a recruit is combat-ready at once).
- Capture refunds the CP for the queue, like cancelling (less risk in keeping a queue near the front).
- Cancelling removes the current unit, not the last one (a half refund more often).
- Production during a fight too (reinforcements straight into the fight, discharged, die first).

### Barracks (DEC-26, #265) **[accepted]**

The owner's decision of 2026-10-14 (#252), all the details are accepted (#265). A part of the DEC-26 block (section 8: the flag,
the warehouse, roads, the common construction of a city, commands, the player view, worked examples). The barracks works
only with `city_upgrades.enabled = true`; **with `false` every own city recruits** (DEC-01,
DEC-25 above as written, taking `recruit.location` into account).

1. **[accepted]** At the start only the capital recruits (it has a barracks from the beginning of the match). Any other
   own city (not a province, DEC-23) gets the ability to recruit by the "barracks" upgrade.
2. **[accepted]** The price of a barracks: 3 CP (`orders.cost.barracks = 300`, in hundredths of CP). The construction time is
   `city_upgrades.barracks_ticks = 100` (10 s). The command `BuildBarracks(node)`,
   paid at the start, there is no cancelling and no CP refund. The common construction of a city and its interruption on capture:
   section 8, DEC-26, item 8.
3. **[accepted]** On capture the barracks goes to the new owner (they can recruit in the city
   at once). The recruit queue of the former owner is lost, as in DEC-25, item 10.
4. **[accepted]** `Recruit(node)` with the flag on: after `NOT_CITY` the new check
   `NO_BARRACKS` (there is no barracks); `NOT_CAPITAL` and `recruit.location` do not apply with `true` (who
   recruits is determined by the barracks). The other checks of DEC-25, item 11, in the same order.
   A cut-off city with a barracks recruits as usual (DEC-19, item 9).
5. **[accepted]** A barracks does not require supplied territory. While there is no barracks (including while
   it is under construction), units cannot be queued (`NO_BARRACKS`).
6. **[accepted]** Visibility: `NodeView.has_barracks` only for own cities, ~~`None` for foreign ones~~ **[superseded by DEC-31]**: for a foreign city adjacent to an own node a built barracks is visible (section 10, the DEC-31 block); for the other foreign ones `None`
   (section 8, item 10).
7. **[accepted]** Bots: `Recruit` only where `has_barracks`.

Numbers: `orders.cost.barracks = 300`, `city_upgrades.barracks_ticks = 100` (the section
`[city_upgrades]`, section 8). Worked examples: section 8, DEC-26, rows 2-6, 16 and 22.

### Groups and orders: auto-merge, free split, merge and cancel, stack limit (DEC-20, #232) **[accepted]**

Playtest of 2026-10-12: the army from the capital ignored the capacity ("deathball"), the paid split, merge and cancel got in the way of control. The owner's decision. It replaces the open question #117, item 1 of question #141 and the accepted texts about the price of split, merge and cancel (sections 3, 5, 6, DEC-08).

Groups merge by themselves, split, merge and cancelling any orders are free, and the size of a group
is limited by the capacity of the nodes on its way. The items earlier marked "(default)" were confirmed by
the owner on 2026-10-12 (#239).

**A. Auto-merge.**

1. An own group that **finished moving in an own node** (arrived at the target, came back after a bounce
   or a cancel) or **appeared by a recruit** merges with the **target group** of the node: the own group
   standing there with the smallest id and without an order (not waiting to set out on a scheduled order). A node:
   a city or a province (the owner, 2026-10-12: auto-merge works in provinces too).
2. These do not merge: a group in transit (passes through the node on the way), a group waiting to set out, groups on
   edges. If there is no target group, and several groups finished moving in the node on this tick, they
   merge into the one with the smaller id.
3. **When:** at the end of the tick, in the `orders` system (after the fight and all the systems that move groups).
   In a fight the groups stay separate (DEC-07, rule 7), the survivors merge.
4. **What is kept:** `units` and `charged` are summed; the mode, "Defense" with its bonus, ~~the delay~~
   **[superseded by DEC-30]** the accumulation counter and the intent are taken from the target group. The arrived group is always in "Attack" (an order
   to move removes "Defense", DEC-08), the bonus of its scheduled order has burned by then (the end of the
   order, #141 by default).
5. A merge can give a group larger than the capacity of the node. Then the death above capacity (#118) and
   the stack limit (section D) apply; the interface suggests splitting the group. Such a group leaves the node
   only after a split: a starting army above the capacity is intended, splitting is free (the owner, 2026-10-12).
6. The event `groups_merged` is received only by the owner.

**B. Split and merge by hand: free** (`orders.cost.split = 0`, `orders.cost.merge = 0`).

1. `Split(group, n)` as in SIM-04 (#117 by default): `1 <= n < units`, the new group gets the
   charged units first (`min(n, charged)`), the new group is in "Attack" without an order, the original keeps its mode and
   order. Auto-merge fires only on the events of item A1, so the split groups do not
   merge back until one of them moves. The client (#315): after a split the **split-off** group is selected
   (the size set by the slider), not the remainder. The client takes its id from
   the event `group_split` (`new_group`, the same opaque id as in snapshots; `ack` carries no id),
   matching it with the sent `split` of the same group; the selection moves to it as soon as
   a snapshot shows it, and only if the original group is selected.
2. `Merge(groups)`: two or more own groups standing in one node, none waits to set out
   (`GROUP_BUSY`). The result is in the group with the smallest id; its mode and "Defense" with the bonus are kept,
   as in auto-merge (replaces #117 by default: "Attack"); the intents of the other groups are removed.
   Enforcement note (the owner, 2026-10-28, #435; `SIM_VERSION` 23): a group that holds a move order (an ordinary one that
   has not departed yet, i.e. `Move` and `Merge` in the same tick, as already for a waiting scheduled order) is `GROUP_BUSY`, so the
   whole `Merge` is rejected. Otherwise the merged group would leave with a size the stack limit of item D3 never checked.
3. The other commands to a group on an edge, except `CancelOrder`, are still rejected
   (`GROUP_ON_EDGE`).

**C. Cancelling any order: free** (`orders.cost.cancel = 0`). `CancelOrder(group)`:

1. A scheduled order during the delay: the order and the intent are removed, the group stands. The CP for the order itself
   are not refunded.
2. A group on an edge with an order to move (an ordinary one or a scheduled one after setting out):
   turns around from the current place and goes back to the node it left onto **this** edge
   (the start of the current edge, not the start of the whole path: the owner's decision of 2026-10-12), for as many ticks as it walked
   along the edge. The mechanics are the same as for a bounce (`OnEdge.back`, DEC-07, rules 4 and 6, #133), but charges
   are not spent. The order, the plan bonus and the intent are removed. If the node of return became
   foreign in the meantime, the arrival is ordinary, with a fight (DEC-07, rule 4).
3. "Defense": the group goes to "Attack", the bonus and the intent are removed. `SetMode(ATTACK)` gives the same and is also
   free (settles #141, item 1).
4. After a fight there is nothing to cancel: a bouncing group (the order burned in the fight) and a standing group without an
   order and without "Defense" get `NOTHING_TO_CANCEL`. The commands are applied at the start of the tick, before
   the movement and the fight, so a cancel applied at tick `t` is in time before the meeting and the arrival of tick
   `t`. The winner of a meeting on an edge goes on with its order, which can be cancelled.

**D. Stack limit.**

1. `Move` (ordinary and scheduled) is accepted only if there is a path on which the capacity
   (DEC-22: fixed and public) of every node of the path except the starting one (the intermediate ones and the target)
   is not less than the `units` of the group. `find_path` searches for a path only through such nodes: the same Dijkstra by the
   passing time and the same tie-break, so the chosen path can be longer than the fastest one.
2. Rejections: a path without the restriction exists, with it none: `STACK_LIMIT` (a new code); no path
   at all: `NO_PATH`, as now.
3. The check is once, at the command: the size of the group on the way does not change (commands to a group on an edge,
   except cancel, are forbidden), the capacity is fixed.
   Enforcement note (the owner, 2026-10-28, #435; `SIM_VERSION` 23): this holds also for a group that has a move order but
   has not departed yet: `Merge` of such a group is rejected with `GROUP_BUSY` (item B2), so `Move` plus `Merge` in one tick
   cannot send a bigger group where the limit closes the way. No new rule.
4. Other groups in the nodes of the path are not counted: a common garrison above the capacity is settled by the death (#118).
5. The interface highlights the nodes reachable by the selected group and the travel time to them; the server computes this
   (see "Impact on the implementation"), the client does not compute it.
6. If the target is unreachable because of the stack limit (`STACK_LIMIT`), the interface suggests splitting the group
   (the key `S`). The limit against a starting army is intended, splitting is free (the owner, 2026-10-12).

Numbers in the ruleset: `orders.cost.split = 0`, `orders.cost.merge = 0`, `orders.cost.cancel = 0` (it was
100 for each; the keys stay so that balance can bring the fee back without code).

Worked examples. Nodes (capacity): A (6), B (4), C (8), D (6), E (6), province P (3); edges
A-B, B-C (the fastest path A-C), A-D, D-E, E-C, A-P, P-C; A, B, D, E, P are own, C is neutral.
Implementation tests: exactly this table.

| # | Situation | Result |
|---|---|---|
| 1 | G1 (3 units, 3 charged, "Defense" with an active bonus) stands in A; G2 (2, 1 charged) arrives in A | G1: 5 units, 4 charged, "Defense", the bonus +2 kept; G2 removed |
| 2 | G1 waits to set out on a scheduled order in A; G2 arrives | G2 stays separate: there is no target group |
| 3 | `Recruit(A)`, G1 (4, 4 charged) stands in A | at the end of the tick G1: 5 units, 4 charged |
| 4 | G2 passes A in transit | no merge |
| 5 | into an empty own A on one tick come G3 and G2 (id G2 < G3) | one group G2, "Attack" |
| 6 | G2 arrives in A where G1 stands, and on the same tick the enemy attacks A | fight: G1 and G2 separately; the survivors merge at the end of the tick (with DEC-24: at the end of the fight) |
| 7 | G1 (5, 5 charged) stands in A (capacity 6); G2 (3, 3 charged) arrives | G1: 8 units; death above capacity per #118; after that G1 goes only where the capacity of every node of the path is not less than 8 |
| 8 | `Split(G1, 2)`, G1: 5 units, 3 charged | the new group 2 units, 2 charged, "Attack"; G1: 3 units, 1 charged; 0 CP; they do not merge back |
| 9 | `Merge(G1, G4)`, G1 in "Defense", G4 in "Attack", id G1 < G4 | the result is G1 in "Defense" with the bonus; 0 CP |
| 10 | an ordinary `Move` A→B, the group made 10 steps along the edge A-B; `CancelOrder` | 10 steps back, stands in A without an order; 0 CP |
| 11 | a scheduled order in the delay; `CancelOrder` | the order and the intent removed; 0 CP; the 2 CP for the order are not refunded |
| 12 | path A→B→C, the group is on the edge B-C; `CancelOrder` | return to B (the start of the current edge), stop |
| 13 | the group bounces after a fight; `CancelOrder` | `NOTHING_TO_CANCEL` |
| 14 | the group is in "Defense"; `CancelOrder` or `SetMode(ATTACK)` | "Attack", the bonus and the intent removed; 0 CP |
| 15 | a group of 5 units in A; `Move` to B | `STACK_LIMIT` (the capacity of B is 4) |
| 16 | a group of 5 units in A; `Move` to C | the path A-D-E-C is accepted: on A-B-C B (4) is in the way, on A-P-C P (3) is in the way |
| 17 | a group of 3 units in A; `Move` to C | the fastest path A-B-C is accepted |
| 18 | a group of 3 units in A; `Move` to P | accepted |
| 19 | a group of 4 units in A; `Move` to P | `STACK_LIMIT` (the capacity of a province is 3) |
| 20 | as 16, but the edges A-D, D-E, E-C do not exist | `STACK_LIMIT` |
| 21 | a cancel on the edge A-B, A was captured during the return | arrival in A with a fight (DEC-07, rule 4); not having taken A, the group dies (DEC-24, item G3) |

What the implementation changes (the simulation and `SIM_VERSION`, the protocol and `PROTOCOL_VERSION`, the client, bots, rulesets): the list is in #232.

Implementation: #242 (`SIM_VERSION` 7, `PROTOCOL_VERSION` 11). The details that the block does not set in words:

- A cancel on an edge with `progress = 0` (the group has just passed its node in transit): zero ticks
  back, the arrival at the start of the edge on the same tick (through `OnEdge.back`, so a lost node gives
  a fight, as in item C2).
- The arrival tick of an order (`ack.arrive_tick`): the tick of application, plus the delay of a scheduled
  order, plus the sum of the edge times of the path, minus 1 (the first step is made on the tick of the order
  or of setting out).
- The reachable nodes and the travel time are computed by the server on the client request `reach_query` (the answer `reach`:
  the nodes where the group's `Move` would be accepted now, with the travel time, and the nodes with the rejection `STACK_LIMIT`).
  The request goes under the common message limit of the connection.
- **[accepted]** (owner, 2026-10-28, #448) Each reachable node of `reach` also carries its path: the node ids from
  the group's node to that node, the path the travel time refers to and the same one the `ack` of a `Move` there would
  give (one search for both). The client highlights it under the travel-time label and never computes it. The path
  names nothing hidden: every node of it but the last is the group's node or an own node, and the last is the
  reachable node itself.
- The auto-merge event `groups_merged` carries the node (`node`), like a manual merge, only to the owner.
- A recruit that is given an order to move on the same tick has already left the node and does not merge.

Alternatives (not chosen):
- **A front fight** (for later, at the owner's word): in a fight each side takes part with no more units than the capacity of the node of the fight; the rest wait. The stack limit is then not needed, a big group simply does not realize its strength.
- A cancelled order stops the group in the nearest city of the path (the owner's first option, replaced by the turn-around).
- A cancel turns the group to the start of the whole path, not of the current edge.
- A manual merge gives "Attack" (#117 by default) or "Defense" if at least one group had it.
- Auto-merge only in cities, without provinces.
- The stack limit only by the target, without the intermediate nodes.

---

## 4. Combat

### Rules

- **[accepted]** The charges of the two sides cancel each other **in pairs**. The units are discharged by this, but do not die.
- **[accepted]** **Each surplus charge kills one enemy unit.**
- **[accepted]** A discharged unit against a charged one dies.
- **[accepted]** Result: with equal charges both sides are simply discharged. To kill, you need a surplus.

In essence this is the main rule of "Diplomacy" (equal forces bounce, dislodging needs +1), moved to real time.

### What happens after a bounce

- **[proposed]** After a bounce **the attacker returns to the node it came from**. Both sides are discharged, nobody died. The exact bounce rule: DEC-07, rule 4. If this node became enemy-held during the bounce and the group did not take it, it dies (DEC-24, item G3, [accepted]).

Without this rule the defender instantly recharges from the warehouse, and the discharged attacker dies on the next tick. Attacking with equal forces becomes suicide.

### Siege of attrition (a consequence)

If the bounce rule is accepted, the siege works by itself:

1. The attacker cuts the roads into the city so that the warehouse stops being replenished.
2. Each wave of attack discharges the defenders, and they spend charges from the warehouse.
3. The attacker withdraws home, recharges, comes back.
4. When the warehouse is empty, the defenders have nothing to recharge with, and the next wave destroys them.

Important: on a bounce both sides lose charges equally. The siege pays off only if the **defender's roads are cut**. Without that it is just both sides burning their budget.

### Terrain

- **[accepted]** Terrain acts **asymmetrically**: as a modifier of the defender.
- **[proposed]** One terrain type per province. It affects the defense of this province and the movement speed in its zone (the block "Speed by terrain by zones" below).

| Terrain | Defender | Speed in the zone |
|---|---|---|
| Mountains | +1 charge | slower |
| Forest | 0 | normal |
| Plains | −1 charge | faster |

- **[open]** The exact speed values. Starting values of the `mvp-0` ruleset: `terrain.speed_pct` (before #253 `terrain.entry_speed_pct`) in SIM-01 (#17).

How the simulation computes this (SIM-05, #21; `gow_sim.systems.movement`): ~~crossing an edge into a node takes
`travel_ticks * 100 // pct` ticks, where `pct`: `terrain.entry_speed_pct` of the terrain of the entry node
(rounded down, at least 1 tick; more than 1000 ticks is not allowed, otherwise `progress` in thousandths does not
distinguish ticks). After k ticks of T `progress = k * 1000 // T`.~~ **[superseded by the decision of 2026-10-14, #253]**:
the edge crossing time and `progress` by terrain zones (block below). Path: Dijkstra by this time
only through own nodes: the first enemy or neutral node: the end of the path, the target of an attack or capture; if
an own node on the path is lost, the group stops in it. With equal times the path with the
lexicographically smaller sequence of `node_key(player, node)` is chosen, so a mirrored position
gives a mirrored path. A step goes in two phases: first all groups advance and the arrivals are fixed,
then an empty neutral node where groups of only one player stand is captured; the rest
is resolved by the fight (DEC-07, rules 5, 6, 8). A group that received an order in tick t makes its first step in
the same tick. It passes an intermediate own node without stopping: in the tick of arrival into it it is already on
the next edge with `progress = 0` (transit, #118), so a path of edges T1 and T2 takes T1 + T2.
Stack limit (DEC-20, section 3): the path is searched only through nodes whose capacity is not less than the size of the group.

### Speed by terrain by zones (owner's decision 2026-10-14, #252, #253) **[accepted]**

The owner's feedback of 2026-10-14: the whole edge went at the speed of the terrain of the destination node, so an order from
plains to mountains is slow at once, and from mountains to plains fast at once. Decision: the speed modifier
acts only in the zone of its own terrain. Replaces "the terrain of the entry node" in the SIM-05 block above and in
DEC-22, item 10.

1. **Zones.** The edge is divided by the border point `border_permille` (DEC-21, DEC-23: in thousandths from the end
   `a`): the edge field in the map (#366; one simulation function, `movement.border_permille`, gives it to all
   rules; for maps before DEC-23 the border point was the middle, 500). The section
   from node A to the border point goes at the speed of the terrain of A, the section from the border point to node B: at the
   speed of the terrain of B. Speed: `terrain.speed_pct` (the key was renamed from `entry_speed_pct`,
   the numbers are the same: plains 125, forest 100, mountains 70).
2. **Time to cross the edge from A to B.** `b`: the border point in thousandths from A (`border_permille` if A is
   the end `a`, otherwise `1000 - border_permille`); `pA`, `pB`: `terrain.speed_pct` of the terrain of A and B;
   `D = b * pB + (1000 - b) * pA`.
   `T = max(1, travel_ticks * 100 * D // (1000 * pA * pB))`: the exact value
   `travel_ticks * 100 * (b / pA + (1000 - b) / pB) / 1000` (the sum of the times of the two sections),
   rounded down once, at the end; at least 1 tick. An edge in one terrain `p`: `D = 1000 * p`,
   `T = travel_ticks * 100 // p`, as before.
3. **Position** after `k` ticks on the edge (`0 <= k <= T`), `progress` in thousandths from A:
   - on section A, while `k * D <= T * b * pB`: `progress = k * D // (T * pB)`;
   - on section B: `progress = b + (k * D - T * b * pB) // (T * pA)`;

   rounded down (all numbers are non-negative); at `k = T` exactly 1000 results. The speeds of the
   sections relate as `pA` to `pB`; the whole time (`T` ticks) is divided between the sections in
   the proportion of the exact time of item 2. An edge in one terrain: `progress = k * 1000 // T`, as before.
4. **Restriction.** On each section the group covers at least one thousandth per tick:
   `T * max(pA, pB) <= D`, otherwise `progress` does not distinguish ticks (for an edge in one terrain this is
   the former `T <= 1000`). An edge that violates the restriction is rejected by the simulation (an error);
   the edges of the MVP maps are checked by a test.
5. **Bounce and cancel on an edge** (DEC-07, rules 4 and 6; DEC-20): the group goes back along the same steps,
   `progress` decreases by the formula of item 3 of the "forward" direction, so the bounce lasts as long as
   the group walked on the edge (from a node: `T` of the edge into this node).
6. **Meeting on an edge** (DEC-07, rule 6, #175) unchanged: positions are counted in thousandths from
   their exit nodes, the meeting is in the tick when the sum of `progress` first reached 1000.
7. **Travel time of an order:** the sum of `T` of the edges of the path (transit through own nodes without stopping). Path search
   goes by this time; the server computes the time: `ReachNode.ticks` in the `reach` response and
   `ack.arrive_tick` (DEC-20).
8. Supply (packets and transfers) does not depend on terrain (DEC-22, item 4).
9. **Road** (DEC-28, item 7): an upgraded road multiplies the speed of both zones:
   `pA = terrain_pct(A) * road_pct // 100`, `pB` likewise (`[road.speed_pct]`, level 1: 100),
   then the formulas of items 2-3 unchanged; the level is taken when the group enters the edge.

Worked examples: `travel_ticks = 30`, border point 500; plains 125, forest 100, mountains 70; "after
`k` ticks": `progress` after `k` ticks on the edge. Implementation tests: exactly this table
(`packages/sim/tests/test_terrain_zones.py`).

| # | Situation | Result |
|---|---|---|
| 1 | plains A → mountains B | `D = 97500`, `T = 33` (was 42); after 5 ticks 211, after 11: 464, after 12: 503 (the border point is passed on the 12th tick); arrival on the 33rd tick |
| 2 | mountains A → plains B | `T = 33` (was 24); after 10 ticks 236, after 21: 496, after 22: 535 |
| 3 | forest → forest, plains → plains, mountains → mountains | `T` = 30, 24, 42, as before; forest → forest after 10 ticks 333 (`k * 1000 // 30`) |
| 4 | as 1, the group bounces after 20 ticks on the edge (`progress` 692) | after the first tick of the bounce 669 (the position after 19 ticks); home in 20 ticks |
| 5 | path plains A → mountains B → forest C, both edges 30, ordinary order in tick `t` | B → C: `D = 85000`, `T = 36`; `reach`: C in 69 ticks (33 + 36); `ack.arrive_tick = t + 68` (the first step in the tick of the order) |
| 6 | group X goes from A (plains) to B (mountains), group Y from B to A, both set out in the same tick | after 16 ticks 598 + 378 = 976; after 17: 621 + 401 = 1022: the meeting is on the 17th tick (by the old rule on the 16th) |

Alternatives (not chosen):
- Round the time of each section separately (`T = T_A + T_B`): an edge in one terrain with an odd
  time would change the time by a tick.
- Store in the state the ticks spent on the edge instead of restoring them from `progress`: more
  state, and the restriction of item 4 is needed anyway for display.

### Fight resolution (DEC-07, #11) **[accepted]**

> **Partially superseded by DEC-24 (#261), the block "Fight over time" below:** the fight goes in rounds, not
> entirely in the arrival tick (rule 8); there is no repeated bounce (rule 4). Rules 1-3, 5-7, 9 apply
> inside a round; the results of the table below stay true for a fight without reinforcements and retreat.

The fight rules above leave some things undefined: the order of cancelling virtual charges, the fate of a surplus charge, a fight
on an edge, simultaneous arrival, several groups, a bounce into a lost node. The rules and the table below
close these cases. SIM-09 tests (#25): exactly this table; it is also stored as data in
`packages/protocol/vectors/combat.json` (SIM-09; the fight estimate in the CLI-08 client, #64, was removed, #252).

The main rule: each charge is one "shot". It either cancels an enemy charge or kills
one enemy unit. A discharged unit does not shoot.

1. The pool of a side Q = charges of the shooting units + the bonus of a scheduled order or "Defense" + terrain.
   Units in the modes "Attack" and "Defense" shoot; ~~charges of units in "Building" do not count.~~
   **[superseded by DEC-16]**: there is no "Building" mode, all charged units shoot (section 8).
   The "Defense" bonus and terrain act only on the defender of a node and only if it has at least
   one shooting charge: mountains +1, plains −1 (a single charged unit cannot shoot, but keeps its charge).
2. Cancelling: c = min(Qa, Qd); each side spends c shots: first virtual ones (bonus, terrain), then real ones.
3. The surplus s = |Qa − Qd| of the stronger side kills up to s enemy units. After cancelling, the opponent's
   units are all discharged (except the "plains" case), so discharged ones die first. Each kill
   spends a shot, also virtual first. Shots beyond the number of enemy units are not spent;
   the unspent bonus burns after the fight.
4. If the defender has no units left, the node passes to the attacker. Otherwise the attacker bounces:
   it returns along the same edge to the source node (the path takes travel_ticks); the order and the bonus burn.
   ~~If the source node became enemy-held in the meantime, the arrival there is ordinary, with its own fight.~~ **[superseded by DEC-24]**:
   the arrival with a fight, but a group that did not take the node dies, there is no second bounce (DEC-24, item G3).
5. Simultaneous arrival of both sides into a neutral node (there are no neutral garrisons in the MVP): a symmetric
   fight without terrain and without a "defender"; if both sides are not destroyed, both bounce, the node stays neutral.
6. A meeting on an edge: `progress` is stored in thousandths of the edge; groups going toward each other meet when the sum of
   progress ≥ 1000. A symmetric fight without terrain; the loser bounces to its source node, the surviving
   winner continues its path; on a tie both bounce. A bounce from the middle of an edge takes as long
   as the group has already walked. Meetings on edges are resolved before arrivals in the same tick.
7. Several groups of one side in a fight add up, but stay separate groups (there is no free merge; survivors merge after the fight per DEC-20, section 3).
   Discharged units of any group die first, then units of the group with the largest `units`; shots are spent
   from the group with the largest `charged`; on a tie: by id inside the player.
8. ~~The fight is resolved in the arrival tick:~~ **[superseded by DEC-24]**: the fight starts in the arrival tick and goes in rounds (DEC-24, item B). First all movements and arrivals are computed, then all fights: the order of players does not affect the outcome.
9. There is no automatic flight: discharged units stay until the player pulls them back with an order.

Worked examples (forest, no orders unless said otherwise):

| # | Attack | Defense | Result |
|---|---|---|---|
| 1 | 2 charged | 2 charged | both discharged, no losses, the attack bounces |
| 2 | 3 charged | 2 charged | 1 defender killed; the attack (3, all discharged) bounces; the defense has 1 discharged |
| 3 | 4 charged | 2 charged | the defense is destroyed, the node is taken by 4 discharged |
| 4 | 1 charged | 10 discharged | 1 killed; the attack is discharged and bounces |
| 5 | 2 charged | empty enemy node | the node is taken, no charges are spent |
| 6 | 3 charged | 2 charged, mountains | Qd = 3: all discharged, no losses, bounce |
| 7 | 2 charged | 3 discharged, mountains | terrain does not act; 2 killed, bounce |
| 8 | 2 charged | 2 charged, plains | Qd = 1: 1 discharged defender killed; the defense keeps 1 charged; bounce |
| 9 | 2 charged + plan (+2) | 2 charged | virtual +2 cancel; the real 2 kill 2; the node is taken |
| 10 | 3 charged | 2 charged + "Defense" (+2) | 1 attacker killed; 2 discharged bounce; the defense has 2 units, both discharged |
| 11 | edge: 2 charged | edge: 2 charged | both discharged, both bounce |
| 12 | edge: 3 charged | edge: 1 charged | the opponent is destroyed; the winner has 1 charged, the path continues |
| 13 | simultaneous into a neutral: 3 charged | 2 charged | 1 killed; both sides bounce; the node is neutral |
| 14 | simultaneous into a neutral: 4 charged | 2 charged | the second side is destroyed; the node is taken |
| 15 | 3 charged + plan (+2) | 1 discharged | 1 killed (a virtual shot is spent); the node is taken, the attack has 3 charged |
| 16 | 3 charged | 2 discharged + "Defense" (+2) | the bonus does not act (no shooting charges); 2 killed; the node is taken, the attack has 1 charged |

"Defense" (+2) in rows 10 and 16 **[superseded by DEC-30]**: a bonus of 2 accumulated by the start of the fight (with `orders.defense_ticks_per_bonus = 60` this is at least 120 ticks in the mode and at least 2 charged units; section 5, the DEC-30 block). The outcomes of the rows do not change.

~~How the simulation computes this (SIM-09, #25)~~ **[superseded by DEC-24, #268]**: the instant fight below
is described as before DEC-24; the implementation of the fight over time: the block "How the simulation computes this (DEC-24)" at the end of
the section "Fight over time". How SIM-09 computed it (`gow_sim.systems.combat`): the `combat` system runs right
after `movement` and takes the tick's arrivals from the `group_arrived` events. First the meetings on edges
(a group that arrived in this tick stands on its edge with `progress = 1000`), then nodes. A meeting
by rule 6 happens once, in the tick when the groups pass each other: the sum of `progress`
reached 1000 in this tick, and was below 1000 at its start (#175). Without this a bouncing
group that lost the meeting would walk home toward the winner continuing its path and on each
following tick would fight it again, and a 0 against 0 draw would turn the winner back against
rule 6. The bounce of a group that in this tick passed its node and stands on the next edge with
`progress = 0` takes zero ticks: it stands in this node at once. A group that returns by a bounce
to a node that became enemy-held and met an enemy on an edge in the arrival tick still arrives
there (its bounce leads there as well) and fights there by rule 4 (#175). The fight core
`resolve_fight()` gets the sides' bonuses as an input parameter (source: SIM-10, #26). The bounce
(`OnEdge.back`): the group goes back along its own track, `progress` decreases by the same steps, so the
bounce takes as long as the group walked on the edge (from a node: the time to cross the edge into this node).
Owner change: only `change_owner()`. The details that the table does not set, by default from the
question #133 **[open]**: the bonuses of several groups of a side add up, the plan bonus acts even
without shooting charges; plains −1 switches off a real charge; the group for a shot and for a loss is
chosen anew for each shot (among discharged ones the units of the group with the largest
`units` die first); two bouncing groups do not meet. The ids of the starting groups are issued by
`node_key(player, node)`, so the tie-break by id inside a player is mirrored. Tests: each row of the
table through the real `movement` and `combat` on the pinned `packages/sim/tests/rulesets/dec07.toml`.
The "siege of attrition" scenario (`packages/sim/tests/scenarios/test_siege_scenario.py`, the map
`packages/sim/tests/maps/siege.json`, the pinned `packages/sim/tests/rulesets/siege.toml`): waves of
equal forces against a city with cut roads (warehouse 3, 2 defenders) take it exactly on the 3rd wave
(with the starvation of DEC-19; before it: on the 4th; the calculation is in the test description), with open roads the city holds 10 waves without losses.

The `combat.json` format: `packages/protocol/vectors/README.md`. Terrain modifiers in `rulesets/mvp-0.toml`: `terrain.defense_mod`; plan and "Defense" bonuses: DEC-08, section 5.

Alternatives (not chosen):
- A surplus charge kills without being spent (attack waves are stronger, the siege is cheaper).
- Terrain acts on the defender even without charges (the siege of attrition is almost impossible in the mountains).

### Fight over time (DEC-24, #261) **[accepted]**

The owner's decision of 2026-10-14 (#252). Replaces rule 8 of DEC-07 (the fight entirely in the arrival tick) and
the repeated bounce of rule 4; absorbs the open #133 and items 2-4 of #141 (their default values are
written below). Rules 1-3, 5-7 and 9 of DEC-07 apply inside a round. All items are
**[accepted]** by the owner on 2026-10-14: he accepted all 14 recommendations of the questions to #261. Until
the implementation the code works by DEC-07.

**A. The owner's decisions [accepted]**

1. The fight is not instant: it lasts several seconds **by the rules** (rounds in ticks), the client
   shows an animation of the rounds. This is not a visual delay: while the fight goes on, it can be reinforced and
   it can be left (items D, E).
2. **The bounce does not chain.** A group that returned by a bounce into a node that became enemy-held (rule 4) and
   did not take it dies (encirclement); there is no second bounce to the far end of the edge, toward the enemy (now
   `movement._step_back` writes `from_node = far`). **[accepted]** The same for a return by cancel
   (DEC-20, C2) and a retreat (item E2): all of them use one mechanism `OnEdge.back`.
3. A fight on an edge carries the meeting point (item C3) in the events and in the player view; the client draws the mark and
   the animation there, not in the middle of the road.
4. There is no fight estimate in the HUD (removed in #254). `packages/protocol/vectors/combat.json` stays for the tests
   of the simulation and is rebuilt from the examples below (new schema: rounds and duration).

**B. Rounds**

1. Numbers: ~~`combat.round_ticks = 10` (1 s)~~ **[superseded by DEC-32]**: `combat.round_ticks = 20` (2 s), `combat.shots_per_round = 1`.
2. The fight starts in the contact tick `t` (item C). Rounds go in the ticks `t + k * round_ticks`,
   `k = 1, 2, ...`: the first one a round after the contact (time for reinforcements to arrive, the approach animation).
3. The reserve of a side: virtual shots `V` (bonuses and mountains, item F) and real ones `R`: the charged units
   of its groups in the fight (on plains minus one, item F2).
4. In a round the sides shoot simultaneously: each makes `f = min(V + R, shots_per_round)`
   shots, virtual first. Opposing shots cancel: each side spends `min(fa, fb)` (rule
   2); the surplus shots of a side kill an enemy unit each, discharged ones first (rule 3);
   a shot beyond the number of enemy units is not spent. The group for a shot and for a loss is chosen
   by rule 7 anew for each shot (#133, item 3).
5. **End of the fight:** after a round in which neither side can shoot at a living
   opponent any more (each has `V + R = 0` or the opponent has no units), or when a side has no
   groups left in the fight (destroyed or left, item E). If at contact nobody can shoot (for example,
   0 charges against 0), the fight ends in the contact tick without rounds.
6. While the fight goes on, its groups do not move.
7. A consequence: without reinforcements and retreat the result matches DEC-07. A side makes fewer shots than the limit
   only when it has fired its whole reserve, so the opponent's surplus shots hit the already
   discharged, as in the instant calculation. The result rows of the DEC-07 table stay true;
   with `shots_per_round = 1` there are as many rounds as the side that shot longer made shots.

**C. Start of the fight**

1. **Node.** A group finished moving in an enemy node where the owner's groups stand: a fight, the attacker is
   the one who arrived. **[amended by DEC-37]**: the owner's groups that left the node within the last `combat.engage_ticks`
   ticks are caught into the fight as leaving defenders, and an empty node with such a group is not taken at once. An empty enemy node is taken at once, without a fight (DEC-07, row 5). A neutral node:
   both players arrived in one tick: a symmetric fight (rule 5); one: a capture at once.
2. **Edge.** The meeting as now (DEC-07, rule 6; #175): in the tick when the sum of `progress`
   of the groups going toward each other first reached 1000. The meeting is started by pairs where at least one group goes
   forward and does not return (#133, item 5). The groups of the fight stop, each at its `progress`
   (one that arrived in this tick stands on the edge at 1000). We do not change the detection, the consequence is covered in item G5.
3. **The fight point** on an edge: `point = pos_0 + pos_1`, where `pos_p` is the position of the met group
   of player `p` in thousandths from the end `a` of the edge. This is the doubled middle, an integer 0..2000 with no division,
   hence mirror-symmetric (for a mirrored edge with the reversed `a`: `2000 - point`). The client draws the mark at
   the fraction `point / 2000` of the edge length from `a`. Several meetings on an edge in one tick: one fight,
   `point` = the smallest + the largest position of the met groups.
4. On an edge no more than one fight goes at a time: a group that reached the point of a running fight
   joins it (item D2); new meetings by item C2 on such an edge are not counted (in example 23 X2
   passes by the standing Y before the fight point and joins only at the point).
5. Order in the tick (the order of the systems is the same): `movement` fixes the arrivals and meetings; `combat`
   creates new fights, accepts reinforcements, plays the rounds of this tick, finishes fights. Meetings on an
   edge are before the arrivals into nodes of the same tick, as now.

**D. Reinforcements**

1. **Node.** A group of any player that finished moving in a node with a fight joins the fight for its side
   in the arrival tick, before the round of this tick. A node with a fight is not passed in transit: a group
   whose path goes through it stops in it, the order ends, it joins the fight. Path
   search (`find_path`, `reach`) does not lead through a node with a fight, as through an enemy one: it can only be
   the target.
2. **Edge.** A group on an edge with a fight (of any player, forward or returning) whose position
   reached the fight point or passed it (`2 * pos >= point` for one going from `a`, `2 * pos <= point` for
   one going from `b`) stops at its `progress` and joins the fight.
3. A joining group brings its charges and the active plan bonus (item F1).

**E. Retreat**

1. The defender of a node leaves by an ordinary `Move` (`orders.cost.move`, the path from the node as usual).
   A scheduled `Move` in a fight: the rejection `IN_FIGHT`.
2. The attacker in a node and any group on an edge leave by `CancelOrder` (free, DEC-20): back to
   the start of the current edge along their own track, like a bounce. A returning group has no order
   (`NOTHING_TO_CANCEL`) and stays in the fight until the end.
3. A group leaves after the nearest round: it shoots in it and may die, then leaves the
   fight and moves. The price of a retreat: one round under fire.
4. Other commands to a group in a fight: `IN_FIGHT` (a new code): split, merge, mode, `Move`
   for the attacker. A group waiting to set out on a scheduled order stands in the fight and sets out
   after the fight ends, if alive.
5. All groups of a side left: the fight ends in this tick; if the defender left, the attacker takes the node
   (item G1).

**F. Bonuses and terrain**

1. The plan bonuses (~~`orders.planned_bonus`~~ **[superseded by DEC-29]**: by distance, `orders.planned_bonus_per_edge`) and "Defense" (~~`orders.defense_bonus`~~ **[superseded by DEC-30]**: the accumulated bonus, `orders.defense_ticks_per_bonus`) act on the fight, not
   on a round: virtual shots enter the `V` of a side when a group joins the fight (at the start or as
   a reinforcement), and burn at the end of the fight, spent or not. The bonuses of several groups
   add up; the plan bonus acts even without shooting charges (#133, item 1). "Defense" enters
   only if the group has stood in the node since the start of the fight; ~~"Defense" that became active during the fight does not
   enter it and waits for the next one (#141, item 3)~~ **[superseded by DEC-30]**: in a fight the bonus does not grow, the accumulation starts anew after the fight. In the examples below "Defense" (+2) means a bonus of 2 accumulated by the start of the fight (DEC-30). A fight during the delay of a scheduled order does not spend the bonus
   (#141, item 2).
2. The condition of rule 1 ("the defender has a shooting charge") is checked once, in the contact tick.
   Met: the "Defense" bonus and mountains (+1 virtual shot, `terrain.defense_mod`) enter the `V`
   of the defender; on plains in each round one charged unit of the defender stays silent (real shots
   no more than `charged - 1`; #133, item 2). Not met: neither "Defense" nor terrain until the end of the fight.
3. On an edge and in a neutral node there is no terrain, as now.

**G. End of the fight**

1. **A node with a defender.** If no defender units are left in the node (**[amended by DEC-37]**: standing in it; a caught group on an edge does not hold the node), the node passes to the attacker in
   the tick of the end of the fight (`change_owner`). Until then the node belongs to the defender: VP, supply, capital (victory
   by capturing the capital in the tick of the end of the fight; double defeat: #136). Otherwise the attackers bounce
   (rule 4), the order and the bonus burn.
2. **A neutral node:** both sides survived: both bounce; one: it takes the node.
3. **[accepted]** A returning group (item A2) that did not take its former node dies.
4. **Edge:** the side that made more shots during the fight wins; equal: a draw. The loser (and
   both sides on a draw) bounces from the fight place along their own track, the first step in the tick after the end of the
   fight; a returning group simply continues its way home. The winner continues the order after
   `combat.regroup_ticks = 10` (regrouping): the first step in the tick `end + regroup_ticks`. Without
   reinforcements and retreat this is rule 6 of DEC-07 (the larger pool wins).
5. **Why regrouping.** A meeting is counted when the groups have already passed each other
   (the winner's `pos` is beyond the meeting point), so without a pause the winner at equal speed always
   reaches the loser's home before the loser, takes the empty home, and the loser dies by item G3
   (a case from the game, #252). With a pause of a round the loser makes it home (example 19). Alternative:
   count the meeting one tick earlier; it changes only the overlap by one tick and does not cure the case.

**H. Supply and other systems in a fight node**

1. Packets and transfers reach the warehouse of the fight node as usual, but there is no recharging of groups in a fight **while
   the fight lasts**: otherwise the warehouse becomes the defender's reserve of shots and the siege of attrition (section 4)
   does not work. After the fight ends, the groups standing in the node recharge from the warehouse as usual
   (`supply.recharge_per_tick`).
2. Starvation (DEC-19) goes on schedule; charges taken off units drop out of the fight.
3. Death above capacity (#118) as now: it counts the standing units of the owner of the node.
4. Unit production in a city with a fight stands still (DEC-25, item 9).

**I. Visibility**

1. In a fight there are always groups of both players, so both see the fight. A new field `PlayerView.fights`
   (a fog test): the place (a node or an edge and `point`), the attacker, the start tick, the tick of the next round,
   the player's own groups of the fight and, for the opponent, the number of units and charged in this fight, exact (also on an edge, where
   a group itself shows only the level `PRESENCE`, DEC-10; **[amended by DEC-35]**: on an edge a group shows the level of its half). ~~The opponent's virtual reserve (bonuses, terrain) is hidden, as
   its `pool` is hidden now.~~ **[superseded, revision of recommendation 13 to #261, 2026-10-17, #295]**: the opponent's bonuses in a fight are **not hidden**: the fight arena shows for each round the shots of each side, including virtual bonus ones (separately from real ones), cancelled charges and killed units. This is a change of the fog rule and of the protocol: the implementation (#294, client #295) changes `PlayerView.fights` and the round events and raises `PROTOCOL_VERSION`; the fog test is rewritten. ~~**[accepted]** (confirmed by the owner 2026-10-17) The data of the rounds (`fight_round` events) is revealed, not the reserve before the start of the fight.~~ **[superseded by DEC-32]**: while the fight goes on, the remaining bonus reserve of both sides is visible to both players (`PlayerView.fights`), outside a fight it is hidden. **[accepted]** (the orchestrator, technical, 2026-10-21; #329, for #330): `PlayerView.fights` also has the silent charges of both sides (item F2, plains), see DEC-32, item 13.
2. Events instead of a single `fight`: `fight_started` (place, `point`, attacker), `fight_round`
   (shots and losses of the sides), `fight_ended` (result, capture, bounces, death by item G3);
   `fight_group` at the end of the fight. Both players receive them; ~~the opponent's fields `pool`, `unspent` and
   virtual shots are cut out, as now.~~ **[superseded, item I.1]**: the opponent's round fields (shots, virtual, cancelled, killed) are not cut out.
3. The approach of the opponent's reinforcements is visible by the ordinary vision rules (DEC-21).

**J. Determinism and symmetry**

1. A fight: the entity `Fight` in `GameState` (`dict[int, Fight]`, iterated by id), a group has the field `fight`.
   Fights do not intersect by groups, so the iteration order does not affect the outcome.
2. A round is simultaneous for both sides; the choice of the group for a shot and for a loss only inside a player
   (rule 7, the tie-break by id, the ids of the starting groups by `node_key`). There are no tie-breaks between players,
   `point` without rounding.
3. All durations are in ticks from the ruleset; `SIM_VERSION` grows, golden replays of the new version.

**K. Bots**

- handle `IN_FIGHT`; groups in a fight are given only a retreat;
- reinforce a fight if their own group gets there before its end (the remaining rounds by `PlayerView.fights`),
  and leave a lost fight;
- the outcome estimate is as before (item B7), the duration of the fight is added to the attack time;
- do not lead groups through a node with a fight (the server would not lay such a path anyway).

**L. What it absorbs.** #133 (DEC-13): items 1, 2, 3, 5 went into items B4, C2, F1, F2;
item 4 (bounce along their own track) and item 6 (transit) unchanged; item 7 (repeated bounce) is replaced by
item G3 [accepted]. #141 (DEC-15): item 1 is settled by DEC-20; items 2, 3 went into item F1; item 4 ("the bonus is spent in the
first fight of the tick") is removed: the fight lasts longer than a tick, the bonus burns at the end of the fight; item 5 (the life of
intents) is unchanged: the plan's intent lives while the winner on the edge continues the path. Both
issues are closed together with #261.

Numbers in the ruleset (a new section `[combat]`): ~~`round_ticks = 10`~~ **[superseded by DEC-32]**: `round_ticks = 20`; `shots_per_round = 1`,
`regroup_ticks = 10`.

> **The ticks of these tables [superseded by DEC-32]:** the tables below are computed with `round_ticks = 10` (the code before #329). The rounds and outcomes stay true, the duration at `round_ticks = 20` (round N in the tick `t + 20 * N`) and the recomputed event ticks: the tables in the DEC-32 block below; the tests (`test_combat.py`) and `combat.json` since #329 take the expected values from there.

**Worked examples.** The numbers are above; `t`: the contact tick; rN: round N in the tick `t + 10 * N`; "canc.":
opposing shots cancelled each other; in parentheses the charged after the round (attack / defense). Forest,
no orders unless said otherwise. Rows 1-16: the DEC-07 rows with the same outcome. ~~The implementation tests
and `combat.json`: exactly these tables.~~ **[superseded by DEC-32, #329]**: the tests and `combat.json` follow the tables of the DEC-32 block (the same rounds and outcomes, the ticks at `round_ticks = 20`).

| # | Attack | Defense | Rounds | Result; end of the fight |
|---|---|---|---|---|
| 1 | 2 charged | 2 charged | r1 canc. (1 / 1); r2 canc. (0 / 0) | no losses, the attack bounces; `t+20` |
| 2 | 3 charged | 2 charged | r1 canc. (2 / 1); r2 canc. (1 / 0); r3 the attack kills 1 | the defense has 1 discharged; the attack (3, discharged) bounces; `t+30` |
| 3 | 4 charged | 2 charged | r1, r2 canc. (2 / 0); r3, r4 1 killed each | the defense is destroyed, the node is taken by 4 discharged; `t+40` |
| 4 | 1 charged | 10 discharged | r1 1 killed | the attack is discharged, bounces; the defense has 9; `t+10` |
| 5 | 2 charged | empty enemy node | none | the node is taken in tick `t`, the charges are intact |
| 6 | 3 charged | 2 charged, mountains | `V` of the defense 1. r1 canc. (the defense by the virtual one; 2 / 2); r2 canc. (1 / 1); r3 canc. (0 / 0) | no losses, bounce; `t+30` |
| 7 | 2 charged | 3 discharged, mountains | terrain does not enter (item F2). r1, r2 1 killed each | the defense has 1; bounce; `t+20` |
| 8 | 2 charged | 2 charged, plains | one charge of the defense is silent. r1 canc. (1 / 1, silent); r2 the attack kills 1 discharged | the defense has 1 charged; the attack (2, discharged) bounces; `t+20` |
| 9 | 2 charged + plan (+2) | 2 charged | `V` of the attack 2. r1 canc. (the attack by the virtual one; 2 / 1); r2 canc. (the attack by the virtual one; 2 / 0); r3, r4 the attack kills 1 each | the node is taken, the attack has 2 discharged; `t+40` |
| 10 | 3 charged | 2 charged + "Defense" (+2) | `V` of the defense 2. r1, r2 canc. (the defense by the virtual ones; 1 / 2); r3 canc. (0 / 1); r4 the defense kills 1 | the attack (2, discharged) bounces; the defense has 2 discharged; `t+40` |
| 11 | edge: 2 charged | edge: 2 charged | r1 canc.; r2 canc. | shots 2 and 2: a draw, both bounce from the fight place; `t+20` |
| 12 | edge: 3 charged | edge: 1 charged | r1 canc. (2 / 0); r2 1 killed | the opponent is destroyed; the winner has 1 charged; the fight until `t+20`, the path continues from `t+30` |
| 13 | neutral, simultaneous: 3 charged | 2 charged | r1, r2 canc.; r3 1 killed | both sides bounce, the node is neutral; `t+30` |
| 14 | neutral, simultaneous: 4 charged | 2 charged | r1, r2 canc.; r3, r4 1 killed each | the second side is destroyed, the node is taken; `t+40` |
| 15 | 3 charged + plan (+2) | 1 discharged | r1 1 killed by a virtual shot | the node is taken, the attack has 3 charged; `t+10` |
| 16 | 3 charged | 2 discharged + "Defense" (+2) | "Defense" does not enter (item F2). r1, r2 1 killed each | the node is taken, the attack has 1 charged; `t+20` |

New examples. Edge a-b: forest at both ends, `travel_ticks = 30`, `T = 30`, `progress` after
`k` ticks `k * 1000 // 30`; X, X2: groups of player 0, set out from a; Y: a group of player 1, set out from b.

| # | Situation | Course | Result |
|---|---|---|---|
| 17 | **A bounce without a chain** (a case from the game). L (1, discharged) returns by a bounce to its city H; while it was walking, the opponent's W (2, discharged) took the empty H. L arrives in H in tick `t` | nobody can shoot: the fight ends in `t` without rounds | L did not take H and dies (item G3); before DEC-24 L went away by a second bounce toward the enemy |
| 17b | as 17, W has 1 charged | r1 W kills L | L dies; `t+10` |
| 17c | as 17, but W has already left, H is empty | none | L takes H in tick `t` (row 5) |
| 18 | **The fight point.** X (3 charged), Y (1, 1 charged) set out 4 ticks later | the 17th tick of X: 566 + 433 = 999; the 18th (tick `t`): 600 + 466 = 1066: contact. `pos_0 = 600`, `pos_1 = 1000 - 466 = 534`, `point = 1134` (567 thousandths from a); X stands at 600, Y at 466. r1 canc.; r2 Y is destroyed | the fight until `t+20`; X (1 charged) makes the 19th step in tick `t+30` and arrives in b in tick `t+41` |
| 19 | **The race home.** As 18, but Y: 2 units, 2 charged, b: an empty city of player 1 | r1, r2 canc.; r3 X kills 1. Shots 3 and 2: X won, the fight until `t+30` | Y (1, discharged) bounces 14 steps from `t+31`, home in `t+44`. X goes from `t+40` (12 steps), in b in `t+51`: 0 charges against 0, the fight ends at once, X bounces. Without regrouping X would be in b in `t+42`, would take the empty b, and Y would die in `t+44` (item G3) |
| 20 | **A reinforcement into a node.** Attack 3 charged, defense 2 charged; in `t+15` the defense's own group G (2, 2 charged) arrives in the node | r1 canc. (2 / 1); G joins (2 / 3); r2 canc. (1 / 2); r3 canc. (0 / 1); r4 the defense kills 1 | the attack (2, discharged) bounces; the defense has 4 units, discharged; `t+40`. Without G: row 2 |
| 21 | **The defender's retreat.** Attack 4 charged, defense 2 charged; in `t+12` the defender gets a `Move` into its neighboring node (1 CP) | r1 canc. (3 / 1); r2 canc. (2 / 0); after r2 the defense leaves | the node is taken in `t+20` by the attack (4, 2 charged); the defense kept 2 units (in row 3 it is destroyed) |
| 22 | **The attack's retreat.** As row 10; in `t+11` the attack gives `CancelOrder` | r1 canc. (2 / defense `V` 1); r2 canc. (1 / `V` 0, 2 charged); after r2 the attack goes back | the attack without losses: 3 units, 1 charged (in row 10 it lost 1); the "Defense" bonus burned; the fight until `t+20`, the node stays with the defense |
| 23 | **A reinforcement on an edge.** As row 11 (X 2 charged, Y 2 charged, the point from 18: `point = 1134`); X2 (1, 1 charged) set out 5 ticks later than X | in `t+4` X2 at 566 (`2 * 566 = 1132 < 1134`), in `t+5` at 600: joins, stands at 600. r1 canc. (2 / 1); r2 canc. (1 / 0); r3 player 0 kills 1 | the fight until `t+30`; shots 3 and 2: player 0 won; Y (1, discharged) bounces; X and X2 go on from `t+40`. Without X2: a draw, row 11 |

What the implementation changes: the state (`Fight`, `Group.fight`), the systems `combat` and `movement`
(stopping in a fight, transit, `_step_back` without a second bounce), `orders` (the life of bonuses), `supply`
(no recharging in a fight), `recruit` (DEC-25), `SIM_VERSION` and golden replays; `combat.json` by
the tables above; the protocol (`PlayerView.fights`, events, `IN_FIGHT`) and `PROTOCOL_VERSION`; the client
(round animation, the mark at the fight point); bots; rulesets (`mvp-0`, test ones). The siege scenario
(`test_siege_scenario.py`) is recomputed.

Alternatives (not chosen):
- `shots_per_round = 2`: fights twice as short (2 against 2 in 1 s, 10 against 10 in 5 s), less time for
  reinforcement and retreat.
- The first round in the contact tick: a 1 against 0 fight is instant, as before.
- Continuous fire: each charged unit shoots once per `round_ticks` (big armies decide the fight
  faster, the result depends on the order of shots inside a round).
- Recharging from the warehouse during a fight (the warehouse: the defender's reserve of shots, the siege is almost impossible).
- The winner on an edge goes on at once, without regrouping (the loser loses its empty home and dies).
- A retreat that is free and instant (a fight without losses for whoever left in time).

**How the simulation computes this (DEC-24, implementation #268; `gow_sim.systems.combat`, `SIM_VERSION` 10; the pace and the bonus reserve in the view: DEC-32, #329, `SIM_VERSION` 18, `PROTOCOL_VERSION` 21)**

The order in a tick (item C5) inside the `combat` system: meetings on edges without a fight, reinforcements on edges,
nodes by id (reinforcements, new fights, capture of an empty enemy node), then fights by id: the round of this
tick, the retreat after the round, the end of the fight. A fight: `Fight` in `GameState.fights` (the id from the common counter of groups,
packets and intents, opaque in the player view), a group has `Group.fight`, a fight has `members` (per group:
the player, the counters at joining, the edge and the node by which it came into the fight node, the flags "returning",
"arrived", "leaving"), the reserve of virtual shots of the sides, the silent charges (plains), the shots and losses of the
sides over the fight. All this is part of the canonical form and of `state_hash`. Numbers: the `[combat]` section of the ruleset
(with DEC-32 `round_ticks = 20` in `mvp-0`, `mvp-1`, `test-short` and in the test rulesets `dec07`, `siege`).

Details that the tables do not set (implementation values):

1. **Joining a fight on an edge** (item D2): a group joins in the tick in which its position reached
   the fight point or passed it, and at the start of the tick was on this side of the point. A group that already stood beyond
   the point (for example, the winner of the previous fight on this edge) does not join. A group that arrived in a node in
   the tick of the meeting or of joining returns to the edge: forward at 1000 with its order into this node,
   back at 0 at its own node. An empty neutral node captured by `movement` in this tick before the fight
   stays captured (as before DEC-24).
2. **Bonuses** (item F1): the active bonus of a group is taken off it when it joins a fight, even if in that
   fight it does not act ("Defense" without a charged defender unit, row 16): it burns with the fight.
   An inactive one (a waiting scheduled order; ~~"Defense" before the delay~~ **[superseded by DEC-30]**: the accumulation of "Defense" is reset when joining a fight, DEC-30) stays on the group until the next
   fight.
3. **The defender's retreat** (item E1, E3): after a round the group stands on the first edge of the path of its `Move` with
   `progress = 0`, the first step in the next tick. The defender's `CancelOrder` in a fight cancels its retreat `Move`
   or a waiting scheduled order, the group stays in the fight; "Defense" cannot be cancelled in a fight
   (`IN_FIGHT`, it is a mode, item E4). A repeated `CancelOrder` of a leaving group: `NOTHING_TO_CANCEL`.
4. **[proposed] An edge on which one side left.** If a side has no groups left in the fight
   (destroyed or left), the other side won, regardless of the number of shots, and continues the path
   after `regroup_ticks` (item G4 compares shots only while both sides are in the fight). Alternative:
   compare shots then too (the remaining side with fewer shots would bounce from an empty
   place).
5. **[proposed] A returning winner on an edge** (bounce, cancel, retreat) does not regroup:
   it has no order, it goes home from the next tick.
6. **The loser on an edge** bounces from its `progress`, the first step in the tick after the end of the fight (item
   G4); with `progress = 0` (the group passed its node in the tick of the meeting) it stands in this node in the next
   tick. There is no instant bounce into a node (#175) any more.
7. **Death by item G3** is part of the side's losses (`losses` in `fight_ended`); the charges of the dead group
   vanish with it (`fight_group` with `encircled`).
8. **Merge after the fight** (DEC-20, A; DEC-07, rule 7): groups that came into the fight node (at the start
   or as a reinforcement) and the attackers that took the node merge at the end of the fight by the ordinary
   auto-merge rule; groups that stood in the node since the start of the fight do not merge.
9. ~~**[proposed] Recruiting in a city with a fight** (DEC-25, item 9): while there is no recruit queue and recruiting is instant,
   `Recruit` in a node with a fight is rejected with the code `IN_FIGHT`.~~ **[superseded by DEC-25, #278]**: `Recruit` in a
   city with a fight is accepted, the progress of the queue stands until the end of the fight (DEC-25, item 9).
10. **Starvation and death above capacity** (items H2, H3) go on schedule; a group that died of them drops out
    of the fight, and a fight in which a side has no groups ends in the nearest `combat` tick.

Events (item I2): `fight_started` (`fight`, `node`, `edge`, `point`, `attacker`), `fight_round`
(`shots_p`, `virtual_p`: the shots of the round and the virtual ones among them, `losses_p`, `spent_p`: the charges
that left the side's units), `fight_ended` (`winner`, `captured`, `start`, `shots_p`, `losses_p` over the
whole fight), `fight_group` (at the end of the fight and when a group retreats: the counters at joining and now,
`destroyed`, `bounce`, `left`, `encircled`, `arrived`). ~~The opponent's player does not get the other side's `shots`,
`virtual` and `spent`.~~ **[superseded, items I1 and I2 as edited by DEC-29; #294, `SIM_VERSION`
16, `PROTOCOL_VERSION` 19]**: the fight events go to both players in full. The player view
`PlayerView.fights`: the place, `point`, the attacker, the start tick and the tick of the next round, the own groups, for the
opponent the units and charged of this fight; since #294 also the shots and losses of the sides over the fight (`shots`,
`losses`) and the last round of both sides (`last_round`: tick, `shots`, `virtual`, `spent`, `losses`,
the same numbers as in `fight_round`). ~~The remainder of virtual shots (`Fight.virtual`) is not part of the view:
the bonus is revealed when it has fired.~~ **[superseded by DEC-32, #329]**: the remainder (`Fight.virtual`) is part of the view of both players while the fight goes on:
`FightView.virtual_left`, a pair by player id, exact (bonuses and mountains); the silent charges of the sides
(`Fight.mute`, item F2) are in the same place: `FightView.mute`, no more than the side's charged (DEC-32, item 13). Tests:
`packages/sim/tests/test_combat.py` (the DEC-32 tables, the expected values from `combat.json`),
`test_dec24.py` (commands, movement, supply, view and fog, including the bonus reserve: both numbers are
visible to both in a fight, the bonus of a foreign group outside a fight and reinforcements on the way are not visible), the siege scenario.

### The fight arena: a 2 s round, the bonus reserve visible in a fight (DEC-32, #327) **[accepted]**

The owner's decision of 2026-10-21 (feedback after #326: the fight goes too fast, the situation cannot be read in time, bonus attacks are unclear, "bonuses during a fight must not be a secret"; chosen from the mockup `docs/design/mockups/fight-arena.html`). Implementation: sim, protocol, bots #329 (implemented, `SIM_VERSION` 18, `PROTOCOL_VERSION` 21); client #330. The block changes the number `combat.round_ticks` and the player view; **the DEC-24 fight rules do not change**.

**The owner's decision [accepted].**

1. **Pace.** ~~`combat.round_ticks = 10` (1 s)~~ **[superseded by DEC-32]**: `combat.round_ticks = 20` (2 s; `tick_hz = 10`). The rulesets `mvp-0` and `mvp-1`. The fight from examples 9 and 10 lasts 4 rounds: 8 s instead of 4 s.
2. **The bonus rules stay as in DEC-24, item B4**: each side makes `min(V + R, shots_per_round)` shots per round, virtual first; the sources and sizes of the bonuses are as before (plan, DEC-29; "Defense", DEC-30; mountains). The owner first chose variant B1 of the mockup (a separate "bonus attacks" phase after the ordinary exchange), then withdrew the choice: a fight with bonuses must last **longer** than a fight without them, and the total duration of the fight follows from the **total number of charges** (real and bonus ones). The current rule gives this: a bonus adds shots to a side and extends its shooting by a round per shot while the opponent has units. Variants B1 and B2 are **not accepted**: they shortened the fight (the average number of rounds on the small configurations of the mockup: 3.44 now, 2.20 with B1, 1.63 with B2, #327).
3. **The bonus reserve is visible in a fight.** A revision of item I1 of DEC-24 (its last proposal, confirmed 2026-10-17: ~~the data of the rounds is revealed, not the reserve before the start of the fight~~ **[superseded by DEC-32]**): while the fight goes on, the remaining reserve of virtual shots of each side (`Fight.virtual`) is part of `PlayerView.fights` for **both** players, as an exact number. Outside a fight unchanged: the accumulated "Defense" (DEC-30, item 5) and the waiting plan bonus of a foreign group are hidden, a reinforcement on the way does not reveal the bonus. The reserve burns at the end of the fight (DEC-24, item F1) and disappears from the view together with the fight.
4. **Client** (#330):
   - **A1:** a bonus (virtual) shot is drawn with a different arrow (a wide glow, a dashed shaft, a diamond head) and the caption "bonus attack" above the arena in a round where virtual shots fire; the source of the bonus is not named in the caption (the protocol does not carry it);
   - **V3:** the arena with "chips": a capsule per unit (charged: filled; discharged: empty with hatching; killed: dashed), one that changed in the round pulses; up to 8 chips per side, then "+N" with the exact number of the rest (state not by color alone, AGENTS.md, 7.4);
   - the bonus reserve icon ◇ with a number on the arena, at each side;
   - the duration of the round animation is computed from `round_ticks` and `tick_hz`, not hardcoded seconds.

**What does not change** (checked against the DEC-24 text): item B4 (the formula of the round's shots, virtual first), B5 (the end of the fight), B7, F1 and F2 (how the bonus enters `V`, the defender condition, mountains +1, plains minus one silent charge), the `fight_round` events (they already have the number of virtual shots of the round), `shots_per_round = 1`, `regroup_ticks = 10` (see item 6). The rounds and outcomes in the table of examples are the same as in the DEC-24 tables (rows 1-23); only the ticks change.

**Details [accepted]** (confirmed by the owner 2026-10-21; the simplest, consistent with DEC-24):

5. **[accepted]** **What is in the view.** For each of the two sides of the fight, the exact number of remaining bonus shots (implementation #329: `FightView.virtual_left`, a pair by player id). It is visible from the first snapshot after `fight_started`, grows in the tick when a reinforcement group with a bonus joins (DEC-24, item F1), decreases after each round, equals 0 when the bonus is spent. The fight events do not change: the source of the bonus is not added to the protocol (it is not in the caption). A fog test for the new field (AGENTS.md, 4.4): both numbers are visible to both players in a fight; outside a fight and before a reinforcement joins the foreign bonus is not in the view. Alternative: put the reserve into `fight_started`; not needed, the player view is already refreshed once per snapshot.
6. **[accepted]** **`combat.regroup_ticks` stays 10.** Regrouping is needed so that the loser on an edge makes it home before the winner (item G5, example 19); the offset between them does not depend on the round length (example 19 below: a margin of 7 ticks, as it was). The words "a pause of a round" in item G5 now do not mean equality with the round. Alternative: 20 (equal to the round): the margin would grow to 17 ticks, but the winner on an edge would wait 2 s and raids would become slower.
7. **[accepted]** **`test-short`: `round_ticks = 20`**, like `mvp-0`: the test `test_test_short_is_mvp0_with_a_60_second_match` requires `test-short` to differ from `mvp-0` only in `match_ticks`, and e2e checks the same rules as the game. Alternative: leave 10 in `test-short` and weaken the test; then e2e does not catch defects of the animation duration.
8. **[accepted]** **Bots** (`fight_commands`): the estimate of a side in a fight accounts for the visible bonus reserve: the reserve of a side = charged + bonus (now the bonus does not take part in the estimate, the opponent's one is not visible before #329). The estimate of the end of the fight `next_round_tick + (max(reserves) - 1) * round_ticks` stays rough (an exact model is not needed); `round_ticks` is taken from the ruleset. Checked by a tournament.
9. **[accepted]** **Test vectors.** `packages/protocol/vectors/combat.json`: `params.round_ticks = 20`, `end_after` of rows 1-16 and the ticks of scenarios 17-23 by the tables of this block; `schema_version` does not change (the structure is the same); the hard-coded `10 * rounds` in `packages/protocol/tests/test_vectors.py` is replaced by `round_ticks`. Expected values: from the tables below.
10. **[accepted]** **Versions.** `SIM_VERSION`++ (the fight duration changes the course of matches) and new golden replays, `PROTOCOL_VERSION`++ (a new view field). Goes after #317 (shared versions): whoever merges second raises the versions anew (`docs/process/orchestration.md`, section 5).
11. **[accepted]** **Consequences of a long round for balance** (the rules do not change, checked by a bot tournament on `mvp-1` and a report): the window for reinforcements and retreat is twice as long (retreat: up to 2 s under fire, item E3); the delay of a scheduled order of 30 ticks (`orders.planned_delay_ticks`) is now shorter than a round and a half: the opponent gets fewer rounds; the warehouse of a fight node and recruiting stand still longer (item H1, DEC-25, item 9); the siege of attrition and starvation (DEC-19) go longer inside a fight; the 15-minute match does not change.
12. **[open]** (not accepted by the owner on 2026-10-21, stays an open variant) **Variant B3 "bonuses at the end"** (mockup #327: rules). A side makes one shot per round, as now, but **a real one first, a virtual one only when the real ones have run out** (item B4 changes the order "virtual first" to "real first"). The length of the fight does not change, the bonus stops saving charges. A brute-force check of 1089 small configurations of the mockup (1-4 units per side, any charges, a bonus of 0-3 not above the number of charged): the number of rounds and who takes the node matched in all; the final state (units and charges of both sides) matched in 821 (75%). In the table of examples one example differs: **15** (attack 3 charged + plan +2 against 1 discharged: the attack keeps 2 charged, not 3; the real shot goes first, the bonus burns); for examples 6, 9, 10 the result and the number of rounds are the same, the virtual shots fall on the last rounds. A plus of B3: the bonus shots are all at the end of the fight, the caption "bonus attack" is more natural. A minus: it weakens the saving of charges that both the plan (DEC-29) and "Defense" (DEC-30, just retuned) give; without a tournament the balance cannot be estimated. **Recommendation: do not accept now.** The owner's requirement about the duration is already met by the current rule; A1 gives the caption without a change of rules. Return to B3 if after the implementation of DEC-32 and DEC-30 players still do not understand why the bonus shoots before the real charges. If the owner accepts: a new DEC (replacing item B4), `SIM_VERSION`++, golden replays, a recomputation of the examples (row 15, charges after rounds in 6, 9, 10), a tournament and a report. **Not accepted by the owner on 2026-10-21, stays an open variant; not part of the code.**
13. **[accepted]** (the orchestrator, technical, 2026-10-21; source: a comment of the arena mockup agent in #330) **Silent charges in the view.** In `PlayerView.fights` for each side the number of charged units that do not shoot in a round because of terrain (item F2 of DEC-24: on plains one charge of the defender): `FightView.mute`, a pair by player id, `min(Fight.mute, the side's charged in the fight)`. It reveals nothing new: it follows from the public terrain of the node, the condition of item F2 in the contact tick and the side's charged, which the fight view already shows exactly; the client (#330) shows it without computing it itself (AGENTS.md, 7.1). A fog test: both numbers for both players (`test_dec24.py`). It changes only the protocol (`PROTOCOL_VERSION` 21 together with item 5), not the rules (`SIM_VERSION` does not grow).

**Worked examples at `round_ticks = 20`.** The rounds and outcomes are the same as in the DEC-24 tables above; `t`: the contact tick; rN: round N in the tick `t + 20 * N`; in parentheses the charged after the round (attack / defense). Forest, no orders unless said otherwise. Implementation tests and `combat.json` after the implementation: exactly these tables (the DEC-24 tables above describe `round_ticks = 10`, the code before #329).

| # | Attack | Defense | Rounds | Result; end of the fight |
|---|---|---|---|---|
| 1 | 2 charged | 2 charged | r1 canc. (1 / 1); r2 canc. (0 / 0) | no losses, the attack bounces; `t+40` |
| 2 | 3 charged | 2 charged | r1 canc. (2 / 1); r2 canc. (1 / 0); r3 the attack kills 1 | the defense has 1 discharged; the attack (3, discharged) bounces; `t+60` |
| 3 | 4 charged | 2 charged | r1, r2 canc. (2 / 0); r3, r4 1 killed each | the defense is destroyed, the node is taken by 4 discharged; `t+80` |
| 4 | 1 charged | 10 discharged | r1 1 killed | the attack is discharged, bounces; the defense has 9; `t+20` |
| 5 | 2 charged | empty enemy node | none | the node is taken in tick `t`, the charges are intact |
| 6 | 3 charged | 2 charged, mountains | `V` of the defense 1. r1 canc. (the defense by the virtual one; 2 / 2); r2 canc. (1 / 1); r3 canc. (0 / 0) | no losses, bounce; `t+60` |
| 7 | 2 charged | 3 discharged, mountains | terrain does not enter (item F2). r1, r2 1 killed each | the defense has 1; bounce; `t+40` |
| 8 | 2 charged | 2 charged, plains | one charge of the defense is silent. r1 canc. (1 / 1, silent); r2 the attack kills 1 discharged | the defense has 1 charged; the attack (2, discharged) bounces; `t+40` |
| 9 | 2 charged + plan (+2) | 2 charged | `V` of the attack 2. r1 canc. (the attack by the virtual one; 2 / 1); r2 canc. (the attack by the virtual one; 2 / 0); r3, r4 the attack kills 1 each | the node is taken, the attack has 2 discharged; `t+80` |
| 10 | 3 charged | 2 charged + "Defense" (+2) | `V` of the defense 2. r1, r2 canc. (the defense by the virtual ones; 1 / 2); r3 canc. (0 / 1); r4 the defense kills 1 | the attack (2, discharged) bounces; the defense has 2 discharged; `t+80` |
| 11 | edge: 2 charged | edge: 2 charged | r1 canc.; r2 canc. | shots 2 and 2: a draw, both bounce from the fight place; `t+40` |
| 12 | edge: 3 charged | edge: 1 charged | r1 canc. (2 / 0); r2 1 killed | the opponent is destroyed; the winner has 1 charged; the fight until `t+40`, the path continues from `t+50` |
| 13 | neutral, simultaneous: 3 charged | 2 charged | r1, r2 canc.; r3 1 killed | both sides bounce, the node is neutral; `t+60` |
| 14 | neutral, simultaneous: 4 charged | 2 charged | r1, r2 canc.; r3, r4 1 killed each | the second side is destroyed, the node is taken; `t+80` |
| 15 | 3 charged + plan (+2) | 1 discharged | r1 1 killed by a virtual shot | the node is taken, the attack has 3 charged; `t+20` |
| 16 | 3 charged | 2 discharged + "Defense" (+2) | "Defense" does not enter (item F2). r1, r2 1 killed each | the node is taken, the attack has 1 charged; `t+40` |

New examples (the same layout as in the DEC-24 table above). Edge a-b: forest at both ends, `travel_ticks = 30`, `T = 30`, `progress` after `k` ticks `k * 1000 // 30`; X, X2: groups of player 0, set out from a; Y: a group of player 1, set out from b. The ticks of events (reinforcement, order) are shifted so that they fall into the same intervals between rounds as in DEC-24 (a round is now 20 ticks).

| # | Situation | Course | Result |
|---|---|---|---|
| 17 | **A bounce without a chain** (a case from the game). L (1, discharged) returns by a bounce to its city H; while it was walking, the opponent's W (2, discharged) took the empty H. L arrives in H in tick `t` | nobody can shoot: the fight ends in `t` without rounds | L did not take H and dies (item G3); before DEC-24 L went away by a second bounce toward the enemy |
| 17b | as 17, W has 1 charged | r1 W kills L | L dies; `t+20` |
| 17c | as 17, but W has already left, H is empty | none | L takes H in tick `t` (row 5) |
| 18 | **The fight point.** X (3 charged), Y (1, 1 charged) set out 4 ticks later | the 17th tick of X: 566 + 433 = 999; the 18th (tick `t`): 600 + 466 = 1066: contact. `pos_0 = 600`, `pos_1 = 1000 - 466 = 534`, `point = 1134` (567 thousandths from a); X stands at 600, Y at 466. r1 canc.; r2 Y is destroyed | the fight until `t+40`; X (1 charged) makes the 19th step in tick `t+50` and arrives in b in tick `t+61` |
| 19 | **The race home.** As 18, but Y: 2 units, 2 charged, b: an empty city of player 1 | r1, r2 canc.; r3 X kills 1. Shots 3 and 2: X won, the fight until `t+60` | Y (1, discharged) bounces 14 steps from `t+61`, home in `t+74`. X goes from `t+70` (12 steps), in b in `t+81`: 0 charges against 0, the fight ends at once, X bounces. Without regrouping X would be in b in `t+72`, would take the empty b, and Y would die in `t+74` (item G3). A margin of 7 ticks, as at `round_ticks = 10` |
| 20 | **A reinforcement into a node.** Attack 3 charged, defense 2 charged; in `t+30` (between r1 and r2) the defense's own group G (2, 2 charged) arrives in the node | r1 canc. (2 / 1); G joins (2 / 3); r2 canc. (1 / 2); r3 canc. (0 / 1); r4 the defense kills 1 | the attack (2, discharged) bounces; the defense has 4 units, discharged; `t+80`. Without G: row 2 |
| 21 | **The defender's retreat.** Attack 4 charged, defense 2 charged; in `t+24` (between r1 and r2) the defender gets a `Move` into its neighboring node (1 CP) | r1 canc. (3 / 1); r2 canc. (2 / 0); after r2 the defense leaves | the node is taken in `t+40` by the attack (4, 2 charged); the defense kept 2 units (in row 3 it is destroyed) |
| 22 | **The attack's retreat.** As row 10; in `t+22` (between r1 and r2) the attack gives `CancelOrder` | r1 canc. (2 / defense `V` 1); r2 canc. (1 / `V` 0, 2 charged); after r2 the attack goes back | the attack without losses: 3 units, 1 charged (in row 10 it lost 1); the "Defense" bonus burned; the fight until `t+40`, the node stays with the defense |
| 23 | **A reinforcement on an edge.** As row 11 (X 2 charged, Y 2 charged, the point from 18: `point = 1134`); X2 (1, 1 charged) set out 5 ticks later than X | in `t+4` X2 at 566 (`2 * 566 = 1132 < 1134`), in `t+5` at 600: joins (before r1 in `t+20`), stands at 600. r1 canc. (2 / 1); r2 canc. (1 / 0); r3 player 0 kills 1 | the fight until `t+60`; shots 3 and 2: player 0 won; Y (1, discharged) bounces; X and X2 go on from `t+70`. Without X2: a draw, row 11 |

**Cross-check with the mockup** (`docs/design/mockups/fight-arena.html`, the function `simulate`, the rules "as now"; the engine's calculation and a manual calculation). Examples 1-4, 6, 7, 9-16: the rounds, the charged after rounds and the final units and charges matched the tables; the mockup's built-in check (`checkTable`, examples 6, 9, 10, 15) gives no discrepancies. The mockup engine does not model plains (the silent charge, example 8), movement, reinforcements and retreat (examples 17-23): they were computed manually by the DEC-24 rules (the rounds are the same as in the DEC-24 tables, the ticks shifted by `round_ticks = 20`; for 19 by the steps from the table above). There are no discrepancies.

What the implementation changes (#329 implemented, #330 client implemented): rulesets (`mvp-0`, `mvp-1`, `test-short`), `PlayerView.fights` (the bonus reserve of both sides), the fog test, `SIM_VERSION` and `PROTOCOL_VERSION`, golden replays, `combat.json`, bots (the estimate), a tournament on `mvp-1`; the client (A1, V3, ◇, the animation from `round_ticks`).

Alternatives (not chosen):
- A pace of 1.5 s (`round_ticks = 15`): the mockup's recommendation; the owner chose 2 s.
- B1 (a "bonus attacks" phase after the exchange) and B2 (a common volley of bonuses in round 1): they shorten the fight and change the charge economy; the owner requires the bonus to lengthen the fight.
- A2 (a strip of the last rounds): not chosen; the client stays with A1.
- Arena view V1, V2: V3 is chosen.
- The bonus source in the caption ("plan", "Defense", "mountains"): not chosen, the protocol does not change.

### Engagement zone around a node: a defender that just left is caught (DEC-37, #549) **[accepted]**

The owner's direction of 2026-10-29 (playtest feedback, #549): "Units should have a larger 'collision' radius when
they engage in a fight, to avoid situations where the enemy leaves the city a fraction of a second before. The radius
should be a bit larger than it is now." A rule change after the freeze (the note at the top), like DEC-35, by the
owner's direction. The rule below and the number are the orchestrator's reading of that direction; the number is
**[default, chosen by the orchestrator; the owner may tune it]**.

**Why (the analysis of #549).** A fight starts only by DEC-24, item C: in a node when the attacker finishes its
movement there while the owner's groups *stand* in it (C1), on an edge when two groups going toward each other on *the
same edge* pass each other (C2). A defender that left the node onto another edge is in neither case: the node is empty,
it is taken at once (DEC-07, row 5), and the defender walks away untouched. Commands are applied at the start of a tick
and `movement` runs before `combat`, so a `Move` given in the very tick of the attacker's arrival is already enough.
The client's render delay (2 ticks, AGENTS.md 7.3) delays both groups equally and is not the cause; a group 1-3 ticks
out of a city still overlaps the city icon, which makes the escape look like a pass through each other.

**The rule.**

1. **The engagement zone** of a node: the first `combat.engage_ticks` ticks of every edge leaving it. A group on an
   edge is *in the zone of its start node* when it goes forward (not a return: bounce, cancel or retreat, item A2 of
   DEC-24), is in no fight, and has spent on the edge at most `engage_ticks` ticks, counting the current one
   (`leg(...).spent(progress) <= engage_ticks`, the same integer formula as `movement`). A group in transit through
   the node (DEC-12: it stands on the next edge at `progress = 0` in the tick it passes the node) counts as having
   left it. The zone is measured in ticks, not in thousandths: the same 0.3 s on a long and a short edge, in any
   terrain and on any road level.
2. **Who is caught.** In a tick when an attacker's arrival into an enemy node starts a fight (DEC-24, C1) or would
   take the empty node (DEC-07, row 5), every group of the node's owner in the zone of that node is caught: it stops
   where it stands on its edge and joins the fight as a defender. An empty node with a caught group is therefore not
   taken at once: a fight starts. Nothing is caught for a node that already has a fight (the reinforcement of D1 and
   the retreat of E1 apply: a defender retreating from a running fight already pays its round), for a neutral node
   (nobody can be leaving it: a group in a neutral node takes it or fights in it), and on edges (C2 is unchanged).
3. **A caught group is a leaving defender** (DEC-24, item E): it shoots in the nearest round and may die in it, then
   leaves the fight and goes on with its order from where it stands, the first step in the next tick. It brings its
   active plan bonus into the fight like any joining group (F1: it burns with the fight). It is not a holder of the
   node: terrain ("Defense", mountains, plains: item F2) counts only when a defender *standing in the node* has a
   charged unit at contact, and the node passes to the attacker when no standing defender is left (G1), even if a
   caught group is still in the fight. Commands to a caught group: `CancelOrder` is `NOTHING_TO_CANCEL` (it is
   already leaving), the rest `GROUP_ON_EDGE`, as for any group on an edge.
4. **End of the fight.** As DEC-24, item G, with item 3 above: if the fight ends before its first round (nobody can
   shoot at contact, B5), the caught groups are released and go on at once; the attacker takes the node if no
   standing defender is left, otherwise it bounces.
5. **Symmetry and determinism.** The rule depends only on the roles (attacker, owner of the node) and on integer
   ticks; the groups are taken in id order inside the player; no tie-break between players. A mirrored position gives
   the mirrored outcome.
6. **Fog.** A fight is public (DEC-24, I1): the caught groups are counted in `PlayerView.fights` like any defender;
   a caught enemy group is not drawn as a figure on its edge (a group in a fight is shown by the fight, DEC-33). The
   attacker in the node is a vision source (DEC-35) and a group 3 ticks out is in that node's half of the edge on
   every map of the pool (`border_permille` is far beyond 3 ticks), so nothing that was hidden is revealed. No new
   field in `PlayerView`, events or the protocol.

**The number** (`[combat]` of the ruleset): `engage_ticks = 3` **[default, chosen by the orchestrator; the owner may
tune it]**; `0` switches the rule off (the behavior before DEC-37). Why 3 ticks (0.3 s): it is "a bit larger than now"
(now 0: even a departure in the arrival tick escapes); it is shorter than a human reaction to a seen threat, so an
evacuation ordered when the attack was seen coming is not caught, only a last-instant escape; on a typical edge of the
pool (55-65 ticks) 3 ticks are 45-55 thousandths, the stretch where the figure still overlaps the city icon. 5 ticks
would also catch evacuations ordered half a second before the arrival, which starts to punish a timely retreat.

**Worked examples.** The line `0 - 1 - 2 - 3`, forest everywhere, `travel_ticks = 30` (`progress` after `k` ticks
`k * 1000 // 30`: 33, 66, 100, 133), `round_ticks = 20`, `engage_ticks = 3`. Node 1 belongs to player 1, the attacker
A of player 0 comes from node 0 and arrives in node 1 in tick `t`; D: a group of player 1 that leaves node 1 toward
node 2 by a `Move` given in the tick shown; G: a group of player 1 that stays in node 1. "On the edge": ticks spent on
edge 1-2 in tick `t`, counting `t`.

| # | Situation | On the edge | Course | Result |
|---|---|---|---|---|
| 1 | A 3/3; D 2/2, `Move` in `t` (the same tick) | 1 (33) | caught; r1 (`t+20`) canc. (A 3/2, D 2/1); D leaves | the node is taken in `t+20` by A (3, 2 charged); D (2, 1 charged) goes on from 33 in `t+21`. Before DEC-37: taken in `t`, D 2/2 |
| 2 | as 1, `Move` in `t-1` | 2 (66) | as 1 | as 1, D goes on from 66 |
| 3 | as 1, `Move` in `t-2` | 3 (100) | as 1 | as 1, D goes on from 100 |
| 4 | as 1, `Move` in `t-3` | 4 (133) | not caught | the node is taken in `t` without a fight; D 2/2 (as before DEC-37) |
| 5 | A 2/2; D 2 units, 0 charged, `Move` in `t-1` | 2 | caught; r1 A kills 1 (A 2/1) | the node is taken in `t+20`; D (1, 0) goes on. Before: D 2/0 untouched |
| 6 | A 2/0 (discharged); D 1/0, `Move` in `t-1` | 2 | caught; nobody can shoot: the fight ends in `t` without rounds | D is released and goes on from 66 in `t+1`; no standing defender: the node is taken in `t` (as before DEC-37, plus `fight_started` and `fight_ended`) |
| 7 | A 4/4; D 2/2, `Move` in `t-1`; G 1/1 stays | 2 | r1 canc.: the defense shoots from D (the most charged, rule 7): A 4/3, D 2/1; D leaves. r2 canc. (A 4/2, G 1/0); r3 A kills G | the node is taken in `t+60` by A (4, 1 charged); D (2, 1 charged) escaped. Before DEC-37: G alone, r1 canc., r2 kill, taken in `t+40` by A 4/2, D 2/2 |
| 8 | node 1 already has a fight (an attacker of player 0 against G and D of player 1); D got a `Move` and left after the round of `t-1` (DEC-24, E3); A 2/2 arrives in `t` | 1 (33) | A joins the running fight (D1); D is not caught: it already paid its round | DEC-24 unchanged |
| 9 | A 3/3; D 2/2 left node 1 toward node 0, that is toward A, along A's edge | | an edge meeting (C2), before the node contact of the tick | DEC-24 unchanged |
| 10 | the mirror of 1: A of player 1 from node 3 into node 2 of player 0, D of player 0 toward node 1 | 1 | as 1 | the mirrored result of 1 |

What the implementation changes (#549): the ruleset field `combat.engage_ticks` (`mvp-0`, `mvp-1`, `test-short`, the
test rulesets), `gow_sim.systems.combat` (the catch in the node contacts, the leaving of a caught group after the
round without a bounce, item G1 counting only standing defenders), `SIM_VERSION` and golden replays. Not changed: the
protocol (`engage_ticks` is not in the public ruleset: the client computes nothing from it), `PlayerView`, the events,
commands, the client, bots.

Alternatives (not chosen):
- A zone in thousandths of the edge (`engage_permille`): the same distance is a different time on a long or slow edge,
  so the escape window would depend on the map; ticks match the complaint ("a fraction of a second").
- Catching only the groups that left in the arrival tick (`engage_ticks = 1`): fixes the worst case but not "a
  fraction of a second before".
- A caught group stays in the fight to the end: an evacuation started in time would be punished by a whole fight; the
  retreat price of DEC-24 (one round) is the existing rule for leaving a fight.
- Moving the node contact one tick earlier (an attacker 1 tick from the node already engages): changes every attack
  timing, the regroup analysis of DEC-24 G5 and the arrival ticks the client shows in the `ack`.

### Capture costs a charge (DEC-38, #578) **[accepted]**

The owner's proposal of 2026-10-30 after BAL-01 (#39; `docs/balance/log.md`, iteration 0, hypothesis H2): "capturing a
city needs at least one charge, to make fast claiming costlier". The mechanics are frozen for the first release (the
note at the top), so the rule goes behind a ruleset number that is `0` (today's rule) in `mvp-0`, `mvp-1` and
`test-short`; BAL-02 (#40) tests it in `rulesets/mvp-2.toml`. The variants and the open questions: #578.
**Decision (the owner, 2026-10-30): [accepted] with all defaults**: variant C (the number `capture.charge_cost`),
every capture costs (also after a fight), provinces and the capital too, a group that cannot pay bounces, a returning
group that cannot pay for its lost home dies (DEC-24, G3), virtual charges never pay. The rule below is the accepted
one; implemented #578 (sim and protocol), the bots and the client follow in a separate issue.

**Why.** Today any group that finishes its movement in an empty neutral node (`movement.settle_arrivals`) or in an
empty enemy node (DEC-07, row 5; DEC-24, item C1) takes it at once, even a fully discharged one, and the winner of a
fight takes the node with whatever it has left. A capture costs only the CP of the order. In BAL-01 6716 of 7500
matches ended on the timer and rusher held 25-31 nodes against 2-7: VP were decided by the speed of claiming, and
supply did not limit expansion at all.

**Variants.**

- **A. A charge is needed, not spent.** A capture needs at least one charged unit among the capturing player's groups
  in the node. A weak brake: one charged unit per claiming group keeps its charge and chains captures; only the
  "discharged claimer" and "the 0-charge winner takes the node" cases go away.
- **B. A charge is spent.** A capture spends one real charge of the capturing player's groups in the node; without one
  there is no capture. Expansion is tied to supply: every claim takes a charge from the front, and a newly captured
  city has an empty warehouse (SIM-07), so the charge comes back only with supply.
- **C. B as a number** (recommended): `capture.charge_cost`, a non-negative integer. `0`: today's rule; `1`: variant B;
  `N`: a capture spends `N` charges and needs at least `N`. A is not a special case of C (it would need a second flag
  "needed but not spent"); given its weakness it is not worth one.

**The rule (variant C).** `k = capture.charge_cost`; with `k = 0` nothing below applies and every table of DEC-07,
DEC-24 and DEC-37 stays as it is.

1. **What is a capture.** Every change of the owner of a node to a player whose groups are in it: an empty neutral
   node (`settle_arrivals`), an empty enemy node without caught groups (DEC-07, row 5; DEC-37, item 2), the end of a
   fight in a node that the side takes (DEC-24, items G1 and G2, including item E5: all defenders left). The same for a
   city of any kind, a province (DEC-23) and a capital; an enemy node that was the player's own before gets no
   discount. Arriving in an own node is not a capture (auto-merge, DEC-20). Edges are not captured; meetings on edges
   (DEC-07, rule 6) do not change.
2. **Who pays.** The capturing player's groups in the node at the moment of the capture: the groups that arrived in
   this tick (an empty node), or the side's live groups in the fight that stand in the node (the end of a fight). Their
   real charges are pooled: one payment per node, not per group. If the pool has at least `k` charges, `k` charges are
   spent one at a time, each from the group with the largest `charged`, ties by the smaller id (DEC-07, rule 7); the
   units stay, discharged. Only then `change_owner` runs as today (the warehouse is zeroed, grace, the recruit queue is
   lost). The spent charge goes nowhere (not into the warehouse: a unit would recharge from it at once, and the
   capture would be free again).
3. **Virtual charges do not pay.** The plan bonus (DEC-29), "Defense" (DEC-30) and mountains are virtual shots of a
   fight and burn with it (DEC-24, item F1); a plan bonus that was not used in a fight burns with the order, as today.
4. **Not enough charges: a bounce.** If the pool has fewer than `k` charges, the node does not change its owner and
   every group of the player that was to take it bounces (DEC-07, rule 4): it goes back along the edge by which it
   came, by its own track, the order and the bonus burn. An empty node: the group is put back on its edge at
   `progress = 1000` going home in the arrival tick, the first step in the next tick, home after the edge time `T`. A
   fight: the bounce of DEC-24, item G1, at the end of the fight. A returning group (a bounce, a cancel, a retreat,
   DEC-24, item A2) that cannot pay for its own former node dies there (DEC-24, item G3: no chain of bounces).
   The groups do not stay in the node: a foreign group standing in a neutral or enemy node without a fight is a state
   that movement, combat, supply and vision do not have.
5. **A fight.** The fight itself is unchanged; only its end. In a node with a defender (G1): no standing defender left
   and the attacker pays: the node is taken; it cannot pay: the attacker bounces, the node stays the defender's (empty;
   the next wave with a charge takes it at once). In a neutral node (G2, DEC-07, rule 5): the sole survivor pays or
   bounces, the node stays neutral; two survivors bounce as today. `fight_ended.winner` stays the side that won the
   fight, `captured` is `false` when it could not pay.
6. **Several groups, auto-merge.** Arrivals of one player into one node in one tick pool their charges (item 2). The
   capture is decided in `movement` and `combat`; auto-merge (DEC-20, item A3) runs later, in `orders`, so it does not
   affect the payment. Groups that already stood in the node do not exist for an empty neutral node (it would be the
   player's own); in a fight only the live groups of the side in the node pay (a caught group of DEC-37 belongs to the
   defender and is never a payer).
7. **DEC-37.** The engagement zone is unchanged: an empty enemy node with a caught group starts a fight; if nobody can
   shoot at contact (DEC-37, item 4), the fight ends at once, the caught groups are released and the attacker takes the
   node only if it pays (otherwise it bounces).
8. **The capital.** Taking an enemy capital needs the payment too; no capture, no victory (section 11).
9. **Orders.** `validate()` does not reject a `Move` to a node the group cannot pay for, and `reach` and the `ack` do
   not change: at order time the outcome is not known. Charges change on the way (a fight on an edge spends them; a
   group waiting to set out on a scheduled order recharges from the warehouse), the target can change its owner (and
   become the player's own, then no payment is needed), and another group arriving in the same tick can pay (item 2).
   The client does not compute the outcome (AGENTS.md, 7.1): it shows the bounce and the event of item 10.
10. **Events and fog.** The spent charge is visible to the owner through its group's `charged`; `node_captured` keeps
    its fields (`node`, `player`; public, ownership is public). A new event `capture_failed` (`node`, `player`,
    `group`, `result`: `bounce` or `encircled`), one per group, **only to the capturing player** (the node's owner does
    not see it: vision comes from units, DEC-35; what its groups see of the bounce is shown by the ordinary rules). A
    new event kind: an entry in `EVENT_FIELDS` (`group` in `EVENT_ID_FIELDS`), a fog test, `PROTOCOL_VERSION`++.
    `capture.charge_cost` goes into `RulesetPublic` (the rule is public: the order tooltip and the help show it).
11. **Symmetry and determinism.** The payment depends only on the counters of one player's groups, ties by id inside
    the player; integers only; the order of systems is unchanged.

**The number** (a new section `[capture]` of the ruleset): `charge_cost = 0` in `mvp-0`, `mvp-1`, `test-short` and the
test rulesets (the rule is off, current play does not change); BAL-02 sets `1` in `rulesets/mvp-2.toml`.

**Worked examples** (`charge_cost = 1` unless said otherwise). Forest, `travel_ticks = 30` (`T = 30`),
`round_ticks = 20` (DEC-32), `engage_ticks = 3`; the groups are of player 0 and arrive in tick `t`; "a/b": units /
charged; "plan (+2)": a scheduled order with a bonus of 2. These rows become the implementation tests.

| # | Situation | Result with `charge_cost = 1` | Today (`charge_cost = 0`) |
|---|---|---|---|
| 1 | 2/2 into an empty neutral city | taken in `t`, the group 2/1 | taken, 2/2 |
| 2 | 2/0 into an empty neutral city | not taken; the group bounces: on the edge at 1000 going home in `t`, home in `t+30`, 2/0; `capture_failed` (`bounce`) | taken, 2/0 |
| 3 | 1/1 into an empty neutral province | taken, 1/0 | taken, 1/1 |
| 4 | 1/0 into an empty neutral province | as row 2 | taken |
| 5 | 2/2 into an empty enemy city, nobody in the engagement zone | taken in `t`, 2/1; `warehouse_lost` as today | taken, 2/2 (DEC-07, row 5) |
| 6 | 3/0 into an empty enemy city | not taken, bounce; the city stays the enemy's | taken |
| 7 | two groups 1/0 and 2/1 into one empty neutral in one tick | taken; the charge from 2/1; auto-merge at the end of the tick: 3/0 | taken, merged 3/1 |
| 8 | two groups 1/0 and 2/0 into one empty neutral in one tick | not taken, both bounce | taken |
| 9 | `charge_cost = 2`: groups 2/1 (smaller id) and 1/1 into an empty neutral | taken; one charge from each (equal `charged`: the smaller id first); merged 3/0 | taken, 3/2 |
| 10 | `charge_cost = 2`: one group 3/1 into an empty neutral | not taken, bounce | taken |
| 11 | neutral, simultaneous: player 0 4/4, player 1 2/2 (DEC-07 row 14) | r1, r2 canc.; r3, r4 kill: player 1 destroyed; player 0 4/0 cannot pay, bounces; the node stays neutral; `t+80`, `captured = false` | taken by 4/0 |
| 12 | neutral, simultaneous: player 0 5/5, player 1 2/2 | as 11, player 0 5/1 pays: taken in `t+80`, 5/0 | taken, 5/1 |
| 13 | 4/4 against 2/2 in an enemy city (DEC-07 row 3) | the defense destroyed in `t+80`; the attack 4/0 cannot pay, bounces; the city stays the enemy's, empty | taken by 4/0 |
| 14 | 5/5 against 2/2 in an enemy city | r1 (4/1), r2 (3/0) canc.; r3, r4 kill; 5/1 pays: taken in `t+80`, 5/0 | taken, 5/1 |
| 15 | 2/2 + plan (+2) against 2/2 (DEC-07 row 9) | the attack 2/0 at `t+80`; virtual charges do not pay: bounce, the city stays the enemy's, empty | taken by 2/0 |
| 16 | 3/3 + plan (+2) against 1/0 (DEC-07 row 15) | r1: 1 killed by a virtual shot; taken in `t+20`, 3/2; the unused bonus burns | taken, 3/3 |
| 17 | 3/3 against 2/0 + "Defense" (+2) (DEC-07 row 16) | taken in `t+40`, 3/0 | taken, 3/1 |
| 18 | a scheduled order 2/0 + plan (+2) into an empty neutral | not taken (virtual charges do not pay), bounce, the bonus burns | taken |
| 19 | DEC-37 row 1: A 3/3; D 2/2 caught | r1 canc. (A 3/2, D 2/1), D leaves; taken in `t+20`, A 3/1 | taken, A 3/2 |
| 20 | DEC-37 row 6: A 2/0; D 1/0 caught | the fight ends in `t` without rounds, D is released; A cannot pay: bounces (the first step in `t+1`), the node stays player 1's | taken in `t` |
| 21 | DEC-37 row 7: A 4/4; D 2/2 caught; G 1/1 stays | as DEC-37; at `t+60` A 4/1 pays: taken, 4/0 | taken, 4/1 |
| 22 | an empty enemy capital, A 1/1 | taken, A 1/0; victory by the capital as today | taken, victory |
| 23 | an empty enemy capital, A 3/0 | not taken, bounce, no victory | taken, victory |
| 24 | node X was the player's own, the enemy took it and left; 2/0 of the player arrives | not taken, bounce (no discount for a former own node) | taken |
| 25 | a group 2/0 bounces home to Y; the enemy took Y and left it empty | Y is not taken; the group dies in Y (DEC-24, G3), `capture_failed` (`encircled`) | Y retaken by 2/0 |
| 26 | as 25, the group 2/1 | Y retaken, 2/0 | Y retaken, 2/1 |
| 27 | a fight in an enemy city: the last defender leaves by a `Move` (DEC-24, E5); the attacker 2/1 / 2/0 | 2/1: taken, 2/0; 2/0: bounces, the city stays the enemy's | taken in both |
| 28 | `Move` of a 2/0 group to a neutral node | accepted, the `ack` as today; the outcome at arrival (row 2) | accepted |
| 29 | `charge_cost = 0`, any row above | the "Today" column; the DEC-07, DEC-24, DEC-32, DEC-37 tables unchanged | |

Variant A differs only in item 2: the pool must have at least one charge, nothing is spent (rows 1, 3, 5, 7, 12, 14,
16, 17, 19, 21, 22, 26, 27 keep the charges of the "Today" column; the rows without a charge are as in B).

**Expected effect** (qualitative; BAL-02 measures it): rusher (War, 25% of regeneration into charges) is hit hardest,
every claim takes a charge from its front; expander is hit while it claims in War, less after it switches to Balance;
turtle (Economy, full warehouses) gains relatively. Discharged raiders can no longer flip empty rear cities and
provinces to cut supply for free. Attacks need one more charge than the defense (rows 13 and 15), which also favors
the defender in sieges (section 4, "Siege of attrition": the last wave must keep a charge). With variant A rusher keeps
one charge per claiming group, and the claiming speed barely changes.

What the implementation changes (a separate issue after the choice): the ruleset field `capture.charge_cost` and its
public copy; `gow_sim.systems.movement` (`settle_arrivals`: payment or bounce) and `gow_sim.systems.combat` (the
empty enemy node and the end of a fight: one payment function before `change_owner`); the event `capture_failed`
(`EVENT_FIELDS`, fog test, `PROTOCOL_VERSION`); `SIM_VERSION` and golden replays (expected: the ruleset hash changes
with the new field even at `0`; `golden:check` confirms); bots: a capture target needs `charge_cost` more charges
(`need + charge_cost`), claiming groups are sent charged, `capture_failed` is handled; the client (after the merge of
the server part): a toast for `capture_failed`, the rule in the order tooltip.

Alternatives (not chosen):
- Garrisons of neutral cities (the BAL-01 option for H2): a change of every map and of the start, and a neutral
  garrison is a fight with nobody's units (DEC-07, rule 5 says there are none).
- A higher CP price for capturing orders: CP are already the narrow resource (H1); it would not tie expansion to supply.
- The spent charge goes into the warehouse of the captured city: a unit recharges from it in the same tick, so the
  capture is free in charges again.
- A capture over time (hold the node `N` ticks): a new state "being captured", a new HUD element and a new fog
  question, for the same brake.
- Neutral nodes only (enemy empty nodes free): a discharged raider would still cut supply by flipping empty rear
  cities, and the rule would differ by owner.
- Groups that cannot pay stay in the node (a vision post): see item 4.

---

## 5. Orders: ordinary and scheduled

- **[accepted]** Two kinds of orders: **ordinary** and **scheduled**.
- **[accepted]** A scheduled order costs more CP.
- **[accepted]** Scheduled orders are **visible to all players**. What is visible is the **intent, not the composition** of the group.
- **[accepted]** Ordinary orders are visible only within the enemy's vision range.
- ~~**[accepted]** Cancelling a scheduled order costs extra CP or time.~~ **[superseded by DEC-20]**: cancelling any order is free; the price of a plan: the CP paid and the lost delay (section 3).
- ~~**[accepted]** The bonus for a scheduled order is **fixed** (not a multiplier).~~ **[superseded by DEC-29]**: the bonus is still not a multiplier, but it is not fixed: it equals the number of edges of the order's path, capped by the group's charged units (DEC-29 block below).
- **[open]** ~~Bonus size.~~ **[superseded by DEC-29]**: bonus by distance. The earlier starting point, +2 charges to the group (see section 14). In the MVP: +2 for the first fight (DEC-08 below).

### Why not ×2

A multiplier grows with the size of the group: a group of 2 gets +2, a group of 10 gets +10. It rewards big armies and works against the limit on group size. Besides, a multiplier together with the terrain terms makes the outcome impossible to work out in your head: `(n − 1) × 2` and `n × 2 − 1` give different numbers.

A fixed bonus solves a small precise operation and changes little for a big group. It rewards precision, not mass.

### How to calculate the bonus

Since CP buy charges (section 6), the bonus for a plan can be priced in the same currency. A scheduled operation is "charges delivered straight to the point of the strike, bypassing logistics".

- If the plan is cheaper than buying the same charges in the capital, people will always plan.
- If it is much more expensive, they never will.
- Rule of thumb: the surcharge for a plan ≈ the cost of the bonus charges at the capital's rate. Instant delivery is balanced by the fact that the enemy sees the order.

Calibration by bot self-play: if scheduled orders are more than ~70% of all attacks, the plan is too cheap; if less than ~20%, it is too expensive.

**[accepted]** (the owner's decision 2026-10-30, #590, option A) **"Attacks" here are sieges of defended nodes.** The share counts only the move orders into a node that is not the player's own and holds a group of the opponent at the moment of the order (the state the order is applied to, the end of the previous tick); a walk into an empty node (neutral or enemy) is no attack for this share, because no plan can pay there (there is no fight). Metric: `planned_siege_share` in `gow_sim.analysis` (`docs/balance/README.md`); the share over every order into a node that is not one's own stays as `planned_attack_share` (the BAL-01 definition), for comparison with older runs. A balance metric, not a rule: `SIM_VERSION` unchanged.

### Open questions about orders

- **[open]** Does the bonus of a scheduled order apply to **defense** (a position prepared in advance), or only to moving armies? The original idea was that a prepared defense takes the initiative away from an ordinary attack.
- **[open]** Does a won exchange give CP (the "initiative = CP" idea)? In a flat economy this is acceptable only as a one-off reward.

In the MVP, a prepared defense is given by the "Defense" mode with ~~the same +2 bonus~~ **[superseded by DEC-30]** an accumulating bonus (DEC-30 block below; DEC-08 below, DEC-07 rule 1).

### Modes and scheduled orders (DEC-08, #12) **[accepted]**

> **[superseded by DEC-41 under `economy.model = "v2"`]**: the "Defense" mode and the scheduled order's fixed delay and price (DEC-41 item 10). The text below is kept and is in force for `economy.model = "v1"`.

Extends sections 3 and 5: preparation time, cancelling, mode effects.

A scheduled order: the group stands in the source node for `orders.planned_delay_ticks` (30 ticks = 3 s), the intent is already visible to everyone; then it sets out with a +2 bonus for the first fight (~~bonus +2~~ **[superseded by DEC-29]**: bonus by distance, DEC-29 block below). The cost is 2 CP instead of 1. "Defense": switching it on is visible to everyone as an intent, ~~the +2 bonus is active after 30 ticks and is spent in the first fight~~ **[superseded by DEC-30]**: the bonus grows while the group stands in "Defense", DEC-30 block below; switching it on again (after leaving the mode) costs again (2 CP). "Defense" holds while the group stands; an order to move removes it with no extra charge. "Attack", the ordinary state without effects (switching is free). ~~"Building" (1 CP): the group's charges do not count in a fight.~~ **[superseded by DEC-16]**: there is no "Building" mode, a city upgrades the road (section 8). ~~Cancelling a scheduled order during the delay costs 1 CP.~~ **[superseded by DEC-20]**: cancelling is free (section 3). The full cost table is in SIM-01.

SIM-01: #17; the values go into `rulesets/mvp-0.toml` (`orders.cost` in hundredths of CP).
Delays and bonuses: `orders.planned_delay_ticks`, ~~`orders.defense_delay_ticks`~~ **[superseded by DEC-30]**, ~~`orders.planned_bonus`~~ **[superseded by DEC-29]** (`orders.planned_bonus_per_edge`), ~~`orders.defense_bonus`~~ **[superseded by DEC-30]** (`orders.defense_ticks_per_bonus`).

How the simulation computes this (SIM-10, #26; `gow_sim.systems.orders`): a scheduled `Move` immediately
creates a public intent (`Intent`: owner, kind, the group's node, target; without the group's id and size,
DEC-04), the bonus ~~`orders.planned_bonus`~~ **[superseded by DEC-29]** (by distance, `orders.planned_bonus_per_edge`) is active from the tick of setting out. `SetMode(DEFENSE)` creates the
intent immediately, ~~the `orders.defense_bonus` bonus is active after `orders.defense_delay_ticks`~~ **[superseded by DEC-30]** (the bonus accumulates, `orders.defense_ticks_per_bonus`); it applies
only to the defender of a node with a firing charge (DEC-07, rule 1). ~~`UpgradeRoad` creates a public
construction intent (from the group's node along the edge).~~ **[superseded by DEC-16]**: construction is not public, there is no
construction intent (section 8). `CancelOrder` removes a scheduled order during the
delay, or "Defense", for `orders.cost.cancel` (DEC-20: 0; cancelling on an edge: a turn-around, section 3). The fight receives the active bonuses (`active_bonuses`),
the bonus burns up in the first fight of the tick; the `orders` system at the end of the step (after `build`) removes the spent
bonuses and the intents of finished orders and modes. Details that DEC-08 does not set are
by default from question #141 **[open]**: the plan bonus burns up also when the order ends without a fight; a fight during
the delay does not spend the plan bonus; ~~a fight before "Defense" is activated does not spend the bonus; after a fight the group stays in "Defense" without
a bonus, switching it on again restarts the delay~~ **[superseded by DEC-30]**: accumulation, after a fight the mode stays and accumulation starts over with no extra charge; ~~`SetMode(ATTACK)` out of "Defense" is free, while
`CancelOrder` of "Defense" costs 1 CP.~~ **[superseded by DEC-20]**: both are free (item 1 of #141 is resolved, the other items of #141 remain defaults).

Alternatives (not chosen):
- The "Defense" bonus applies to every fight while the mode is on (stronger defense, weaker siege).
- Asymmetric cancelling: free outside a threat, expensive under a threat.

### Scheduled order bonus by distance (DEC-29, #291) **[accepted]**

> **[superseded by DEC-41 under `economy.model = "v2"`]**: the distance bonus; the bonus is accumulated in charges. The text below is kept and is in force for `economy.model = "v1"`.

The owner's decision 2026-10-17. ~~The scheduled order bonus is fixed: `orders.planned_bonus = 2` virtual charges for the first fight (DEC-08, above).~~ **[superseded by DEC-29]**: the bonus depends on the range of the strike. Implementation: #294. What did not change: the price 2 CP (`orders.cost.planned_move = 200`), the delay `orders.planned_delay_ticks = 30`, the bonus burns up in the first fight or when the order ends, the intent is visible to everyone (size and composition hidden), "Defense" and `orders.defense_bonus = 2` (DEC-08).

**The owner's decision [accepted].** The bonus equals the number of edges on the fastest path from the order's source node to the target (a neighboring node: 1, plus 1 for each further edge), capped by: the number of **charged** units in the group. The trade-off: a deep strike is visible to the enemy in advance, while the group stands in the delay.

**Details [accepted]** (confirmed by the owner 2026-10-17):

- **Which path.** The one the order takes (`Move`, DEC-20: the fastest path by time, taking the stack limit into account; the same one is in `ack.path`). There is no separate graph for the bonus: hostile nodes and fog do not affect the number of edges. The bonus is `edges * orders.planned_bonus_per_edge`, `planned_bonus_per_edge = 1` (the key replaces `orders.planned_bonus`).
- **When the cap is measured.** At the tick of setting out (the end of the delay), by the number of charged units in the group at that moment: over 30 ticks the group recharges from the warehouse (`supply.recharge_per_tick`). The number of edges is taken from the path chosen at the command.
- **Zero bonus.** A group with no charged units at the tick of setting out gets no bonus (0); the order is carried out, the CP are not refunded.
- **[accepted]** (the owner's decision 2026-10-21, mockup #339, "Bonus on the head: yes") **Bonus forecast in your own order.** The player view carries the bonus in the order of your own group (`OrderView.bonus`, #329): `min(path bonus, group's charged units right now)` for a scheduled order, 0 for an ordinary one and after the bonus has entered a fight. Before setting out this is a forecast: the cap is taken at the tick of setting out (item "When the cap is measured"), so the number can change if the charged units change during the delay. The client shows "◇ +N" on the head of its own plan ribbon, without computing it itself (AGENTS.md, 7.1). The enemy gets only the intent with no size and no bonus; the plan bonus is revealed only in a fight (DEC-32). Fog test: `test_dec29.py`. Changes only the protocol (`PROTOCOL_VERSION` 21 together with DEC-32), not the rules.

**Examples** (ruleset `mvp-1`):

| # | Number of edges of the path | Charged units at the tick of setting out | Bonus |
|---|---|---|---|
| 1 | 1 (a neighboring node) | 3 | 1 |
| 2 | 2 | 3 | 2 |
| 3 | 4 | 3 | 3 (cap: charged units) |
| 4 | 3 | 1 (out of 4 units) | 1 |
| 5 | 3 | 0 | 0 |
| 6 | 2 | 5 | 2 |

The bonus used to be 2 in every row, independent of distance.

Ruleset keys (written by the implementation, #294): add `orders.planned_bonus_per_edge = 1` (**[accepted]** (confirmed by the owner 2026-10-17)), remove `orders.planned_bonus`; the rest of `[orders]` is unchanged.

How the simulation computes this (#294, `SIM_VERSION` 16): `Move(planned=True)` gives the group a bonus of
`(len(path) - 1) * orders.planned_bonus_per_edge` along the path from `ack.path`; the `movement` system at the tick
of setting out (the first step after the delay) caps it at the number of charged units of the group (on the way
the group's charges do not change, so the cap at every step equals the cap at departure). The rule
function: `OrderRules.planned_bonus(edges, charged)`, the bots use it too. A group with no charged units
gets 0, so item F1 of DEC-24 "the plan bonus works even without firing charges" applies, with DEC-29,
only to a group that had a charged unit at the tick of setting out. Tests:
`packages/sim/tests/test_dec29.py` (the rows of the examples table; the forecast in your own `OrderView.bonus` and its fog, #329).

Alternatives (not chosen):
- A flat +2 bonus (DEC-08): does not depend on distance, does not tell a raid from a neighboring attack.
- A multiplier by group size: rewards big armies (section 5, "Why not x2").

### Accumulation of the "Defense" bonus (DEC-30, #316) **[accepted]**

> **[superseded by DEC-41 under `economy.model = "v2"`]**: the "Defense" mode; the bunker replaces it. The text below is kept and is in force for `economy.model = "v1"`.

The owner's decision 2026-10-21 (playtest feedback). Replaces the "Defense" part of DEC-08: ~~the +2 bonus is active after 30 ticks (`orders.defense_delay_ticks`, `orders.defense_bonus`)~~ **[superseded by DEC-30]**. Implementation: sim, protocol and bots #317, client #318.

**Reason.** "Defense" cancelled out the scheduled order: a +2 bonus with no cap by charged units; activation in 30 ticks equals the scheduled order's delay (30 ticks), so the reaction to a visible intent was always in time; after DEC-29 a strike on a neighboring node gives +1 against the defense's +2.

**The owner's decision [accepted].**

1. **The bonus grows.** +1 for every `orders.defense_ticks_per_bonus` ticks that the group stands in "Defense" (initial value 60, roughly the time to traverse one edge; balance later, after smart bots). There is no separate switch-on delay: `orders.defense_delay_ticks` and `orders.defense_bonus` are removed.
2. **Cap:** the number of charged units in the group at the start of the fight (like the DEC-29 cap).
3. **After a fight** the accumulated bonus burns up, the mode stays, accumulation starts over with no repeat payment.
4. **The price of switching on** is 2 CP (`orders.cost.defense = 200`), unchanged.
5. **Visibility.** The enemy sees the "Defense" mode as before (the intent is public from the moment of switching on, the mode is visible from the `PRESENCE` level, section 10, DEC-21, item 7), but not the accumulated number; in a fight the bonus is revealed per DEC-24 item 13 (revision of DEC-29, section 4, item I.1); with DEC-32 (#329) the remaining reserve of the fight is visible to both while the fight goes on (`FightView.virtual_left`).

The fight bonus: `min(charged, ticks_in_defense // orders.defense_ticks_per_bonus)`, where `charged` is taken at the tick of entering the fight, `ticks_in_defense` is the number of ticks in "Defense" since the mode was switched on or since the end of the last fight (`//` on non-negative numbers, rounding down).

**What does not change** (checked against the text of DEC-08, DEC-07 and DEC-24): the bonus applies only to the defender of a node that has at least one firing (charged) unit, the condition is checked at the tick of contact (DEC-07, rule 1; DEC-24, F2); the bonus enters a fight only if the group has stood in the node since the start of the fight (DEC-24, F1); the mode holds while the group stands, an order to move removes it with no extra charge (DEC-08), `SetMode(ATTACK)` and `CancelOrder` are free (DEC-20), the mode cannot be changed in a fight (`IN_FIGHT`, DEC-24, item E4; G, item 3); the bonus does not grow during a fight (it enters `V` once on joining, DEC-24, F1).

**Details [accepted]** (confirmed by the owner 2026-10-21; the simplest, consistent with DEC-20 and DEC-24):

- **[accepted]** **Counter.** A group has a counter `ticks_in_defense`: 0 when the mode is switched on, +1 for every tick while the group stands in a node in "Defense" and not in a fight. Reset to 0: leaving the mode (`SetMode(ATTACK)`, `CancelOrder`), an order to move, joining any fight (the fight bonus is fixed at that tick and does not grow further).
- **[accepted]** **Merging** (DEC-20, A4, B2): the mode, "Defense" and its counter are taken from the target group (as its "Defense" with the bonus is now); an arriving group in "Attack" adds no accumulation. The cap is computed from the charged units of the merged group at the start of the fight.
- **[accepted]** **Splitting** (DEC-20, B1): the new group is in "Attack", counter 0; the original keeps the mode and the counter. The cap is computed from its charged units at the start of the fight (so a split can cut the bonus by the cap).
- **[accepted]** **Reinforcement.** A group that joined a fight as a reinforcement gets its counter reset, like any group that joined a fight; the bonus enters `V` only if the group has stood in the node since the start of the fight (DEC-24, F1), otherwise it burns up (DEC-24, G, item 2).
- **[accepted]** **Rounding:** down, whole numbers (AGENTS.md, 4.1, item 3); the accumulated number is stored not as a bonus but as a tick counter, so that changing a key in the ruleset does not require recomputing the state.
- **[accepted]** **Player view:** for your own group `PlayerView` gives the current accumulated bonus and the cap (`GroupView.defense_bonus` and `defense_cap`, #317); for an enemy group only the mode, no number (a fog test for the new field).

**Examples** (ruleset `mvp-1`, `orders.defense_ticks_per_bonus = 60`, a defender in a node with a firing charge; bonus = `min(charged, ticks // 60)`):

| # | Ticks in "Defense" at the start of the fight | Charged units | Fight bonus |
|---|---|---|---|
| 1 | 30 | 3 | 0 (30 // 60 = 0) |
| 2 | 60 | 3 | 1 |
| 3 | 130 | 3 | 2 (130 // 60 = 2) |
| 4 | 600 | 3 | 3 (cap: charged units, 600 // 60 = 10) |
| 5 | 180 | 1 (out of 4 units) | 1 (cap, 180 // 60 = 3) |
| 6 | 300 | 0 | 0 (no firing charges: the bonus does not apply, DEC-24, F2) |
| 7 | the first fight ended, the group stayed in "Defense"; the second fight 90 ticks after the end of the first | 3 | 1 (counting afresh: 90 // 60 = 1; what the first fight accumulated burned up) |

The bonus used to be +2 from the 30th tick, and after that did not depend on time or on the number of charged units.

Ruleset keys (written by the implementation, #317): add `orders.defense_ticks_per_bonus = 60` (**[accepted]** by the owner 2026-10-21 as the initial value, balance later), remove `orders.defense_delay_ticks`, `orders.defense_bonus`; `orders.cost.defense = 200` and the rest of `[orders]` are unchanged. Affected: `rulesets/mvp-0.toml`, `rulesets/mvp-1.toml`, `rulesets/test-short.toml`.

How the simulation computes this (#317, `SIM_VERSION` 17, `PROTOCOL_VERSION` 20): the counter
`Group.ticks_in_defense` is set to 0 by the command `SetMode(DEFENSE)`, by leaving the mode
(`SetMode(ATTACK)`, `CancelOrder`, `Move`) and by joining a fight (`systems.combat`, `_join`); the
`orders` system at the end of the tick adds 1 to every group in "Defense" that stands in a node and is not in a fight. So
at the tick of contact the counter equals the number of ticks since the mode was switched on (or since the end of the last fight): a command
at tick `s`, contact at tick `s + 60` give 60, bonus 1. The fight bonus is computed by `active_bonuses` at the tick of
contact with the rule function `OrderRules.defense_bonus(ticks, charged)` (the bots use it too);
`Group.bonus` remains only the plan bonus. `SetMode(DEFENSE)` for a group that already stands in "Defense"
is rejected with `NO_CHANGE` (it used to be allowed and cost 2 CP again): switching on again would only
reset what was accumulated, and after a fight accumulation starts over by itself. Player view: `GroupView.defense_bonus`
(the bonus of a fight starting now, that is, what is accumulated, with the cap) and `defense_cap` (the cap: charged
units), both `null` outside "Defense"; `ruleset_public.orders.defense_ticks_per_bonus` instead of
`defense_delay_ticks`, `combat.defense_bonus` removed. Bots: the estimate of the defender's pool adds what the
enemy has accumulated, judged from the public tick of the "Defense" intent (`(tick - created_tick) // 60`, capped
by the charged units), `ReactiveBot` switches on "Defense" in reply to a visible plan only if, before the very
earliest arrival of the strike, it will manage to accumulate at least +1. Tests: `packages/sim/tests/test_dec30.py`
(the examples table and details), fog: `test_view.py`.

Alternatives (not chosen):
- The earlier DEC-08 rule: +2 after 30 ticks (coincides with the plan's delay, the reaction is always in time, no cap).
- The bonus does not burn up after a fight (stronger defense, harder siege; the owner chose burning up).


---

## 6. CP (command points)

- **[proposed]** CP stay in the game (there was a question whether to drop them altogether).
- ~~**[accepted]** CP pay for: orders (scheduled ones cost more), splitting and merging groups, cancelling scheduled orders.~~ **[superseded by DEC-20]**: CP pay for move orders (scheduled ones cost more), "Defense" and recruiting; splitting, merging, cancelling (DEC-20), priority and transfer (DEC-18) are free.
- **[proposed]** CP are the same for both players and **do not grow with territory**.
- **[proposed]** CP are also the economy: they buy charges in the capital (see section 7).

The key clarification from the discussion: the problem is not that CP are both attention and economy at once. The problem is income that **grows with territory**. If income is flat, CP can be both.

### Stance instead of clicking

- **[proposed]** To avoid pressing "buy charges" every five seconds, the split of CP is set by a stance that is changed rarely (the current rule: DEC-02 below):

| Stance | CP for orders | CP for supply |
|---|---|---|
| Economy | 25% | 75% |
| Balance | 50% | 50% |
| War | 75% | 25% |

- ~~**[proposed]** Plus a small passive production of charges in the capital, so that a player who spent everything on orders is not left completely without supply.~~ **[superseded by the decision of 2026-10-14, #253]**: there is no passive production, charges come only from CP through the stance (DEC-02 block below).
- **[open]** A fallback option: two separate flat flows (CP and charges) without conversion. Simpler, but the dilemma "act or feed" disappears.

### Economy model and CP stance (DEC-02, #8) **[accepted]**

> **[superseded by DEC-41 under `economy.model = "v2"`]**: stances, the charge share of CP regeneration, `charges_per_cp`, the starting stance (DEC-09) and the stance cooldown; in v2 all CP goes to CP and charges come from factories. The text below is kept and is in force for `economy.model = "v1"`.

A flat economy: only the capital produces supply. ~~Passively 1 charge per 50 ticks;~~ **[superseded by the decision of 2026-10-14, #253]**: there is no passive production (below). The stance has three positions (25 / 50 / 75% of the CP regen goes into charges at the rate 1 CP → 2 charges). Credited in a quantum: once per 50 ticks 100 hundredths of CP are divided by the stance; the share going to charges accumulates in an accumulator (in hundredths of a charge) and turns into whole charges. At the CP cap the excess CP burns up; the stance's share into charges is always credited. Changing the stance is free, not more often than once per 100 ticks.

How the positions match the stance table above: "Economy": 75% into charges, "Balance": 50%, "War": 25%
(`economy.stance_to_charges_pct` in SIM-01, #17).

**No passive production (the owner's decision 2026-10-14, #252, #253) [accepted].** The capital does not
produce charges by itself: charges appear only from CP, from the shares of the regen quantum by stance. The keys
`economy.passive_period_ticks` and `economy.passive_amount` are removed from the ruleset and from the protocol's `ruleset_public`.
Even "War" gives 25% of the quantum to charges, so a player is not left without supply.
Example: over 600 ticks (12 quanta) the capital gets 18 charges in "Economy", 12 in "Balance", and
6 in "War" (before the decision: 12 more in every stance). Test: `packages/sim/tests/test_economy.py`.

Values in `rulesets/mvp-0.toml`: the sections `[cp]`, `[economy]`, `orders.stance_cooldown_ticks`, `orders.cost.stance`.

How the simulation computes this (SIM-06, #22; `gow_sim.systems.economy`): the quantum ~~and passive production
are~~ is credited on ticks t > 0 that are multiples of the period (the first quantum at tick 50; 12 quanta over 600 ticks).
The share into charges: `per_period * pct // 100` (rounding down), `share * charges_per_cp`
hundredths of a charge go into the accumulator. Charges are credited to the capital's warehouse within its capacity (section 9), ~~the excess is lost
(event `charges_overflow`)~~ **[superseded by DEC-28]**: the excess spreads to the rear cities, burns up (`charges_overflow`) only when all warehouses are full (section 8, DEC-28, item 4.4); CP that burned up at the cap: event `cp_burned`. If the capital is not yours, the
produced charges are lost, CP regenerate as usual.

#### Starting stance and the first stance change (DEC-09, #104) **[accepted]**

The owner's decision of 2026-10-28; it confirms what is implemented (no change of rules, `SIM_VERSION` unchanged).

- The starting stance of both players is "Balance" (`economy.start_stance = "balance"`).
- The first stance change is allowed at once: the cooldown `orders.stance_cooldown_ticks` counts from the previous change, and there is none at the start.

Alternatives (not chosen):
- A concave model (cities give a small income with diminishing returns): implemented only if BAL-02 fails.
- Two independent flat flows (CP and charges) without conversion.

---

## 7. Supply

- **[accepted]** Supply is "packets" that go from the capital and cities to other cities.
- **[accepted]** Every city has a **warehouse**. Units in a city are charged from its warehouse.
- The three priority levels and the delivery order of DEC-18 **[superseded by DEC-28]**: front markers, rear minimum, transit, donors (section 8, DEC-28 block).
- ~~**[accepted]** All flows are **automatic**. The player never directs packets by hand.~~ **[superseded by DEC-18]**: flows are automatic, the player sets a city's priority and can transfer charges once (DEC-18 block below).
- ~~**[accepted]** The warehouse capacity depends on the development of the roads around the city.~~ **[superseded by DEC-22]**: the warehouse capacity is fixed by the kind of node (section 8).

### Who produces supply

- **[proposed]** **Flat economy: only the capital produces supply**, charges are bought for CP (the current rule: DEC-02, section 6). The other cities are warehouses, places for troops and sources of VP, but not producers.

Why this removes the snowball: a player with twice the territory has the same income, while having to defend twice the perimeter. Territory gives not income, but:

- **VP** (what the fighting is for);
- **reach** (a forward warehouse is closer to the front, charges arrive faster);
- **capacity** (more places for troops and charges).

A comeback stays possible: the one who loses land loses the pace of collecting VP, but not income.

**Risk:** the capital is the only source, and cutting it off is a catastrophe. Mitigation: warehouses give a cut-off region a reserve of time (a group dies gradually, not instantly). Capitals on maps should be placed on winning terrain (mountains).

- **[open]** If the flat economy turns out too static (nobody needs to expand), there are intermediate options:

| Model | Income from cities | Snowball |
|---|---|---|
| Flat | none, only the capital | no |
| Concave | small, with diminishing returns (≈ √ of the number of cities) | controlled |
| Linear | every city gives the same | classic 4X |

Recommendation: start with flat, move to concave only if players stop expanding.

- ~~**[open]** A priority lever: mark a city as a priority so that charges go there first. One button instead of a flow control panel.~~ **[superseded by DEC-18]**: three priority levels (block below).

### Supply management: priorities and transfers (DEC-18, #230) **[accepted]**

> **[superseded by DEC-41 under `economy.model = "v2"`]**: one-off transfers, the delivery passes, the priority and transit parts (supply lines replace them); recharge and spoils stay. The text below is kept and is in force for `economy.model = "v1"`.

Playtest 2026-10-12: supply is entirely automatic, the player cannot say "the front first" and quickly move a stock, intermediate cities keep the charges for themselves. The owner's decision: a "Supply" map mode, three priority levels for a city, intermediate cities work as transit, a one-off transfer A→B is free. Replaces the accepted text "All flows are automatic" (above) and the open question #131 (its values came in here as the base algorithm).

> **DEC-28 (#290, 2026-10-17):** items 1, 2, 4 (city priority, target stock, three dispatch passes) and the map mode, item 7,
> **[superseded by DEC-28]** (block in section 8): two front markers instead of three priorities, the city's target: a full warehouse at the front and
> `rear_min` in the rear, transit through cities, donors. Items 3 (the tree as a distance metric), 5 (packet and path;
> at the end of the path charges are put into the warehouse), 6 (transfer), 8-10 stay in force; read the words "priority", `high`, `normal`, `low`
> in them per DEC-28. Implementation #292: examples 1-7, 20-22 and 25-28 (priorities, targets, the forwarding
> reserve) **[superseded by DEC-28]**, their place was taken by the examples of the DEC-28 block; examples 8-17, 19, 23 and
> 29-33 stay in force (in the tests of 9, 17 and 23 the destination city holds a front marker so that automation does not
> carry the arrived charges further, DEC-28, item 6).

> **DEC-26 (#265):** with `city_upgrades.enabled = true`, wherever below "capacity" refers to a charge
> (items 2, 4, 5, 6 and the examples), the city's `warehouse_capacity` is taken (the warehouse is separate from the unit capacity,
> section 8); the examples below are given for `enabled = false` (the warehouse equals the node's capacity).

Supply stays automatic, and the player gets two levers: a city's priority and a one-off
transfer. The owner's answers 2026-10-12 (#239): priority sets only the order of delivery (items 2 and 4), transfer
inside a cut-off pocket is allowed (item 6), map modes switch on `Tab` (item 7). The throughput of a
transfer (item 6, earlier "by default") was decided by the owner 2026-10-14 (#252): a transfer shares it with
automatic dispatch (item 10). The owner's decisions 2026-10-15 (#287) **[accepted]**: the city's
reserve when forwarding (item 4), the transfer volume by the receiver's free room and delivery of a transfer
in batches (item 6); examples 26-33.

1. ~~**City priority.**~~ **[superseded by DEC-28]** The command `SetPriority(node, level)`, `level`: `high` | `normal` | `low`
   (high, normal, low). Free (`orders.cost.priority = 0`). All cities start with
   `normal`; when the owner changes, the priority is reset to `normal`. Checks in order: the node does not exist
   (`NOT_FOUND_OR_HIDDEN`); the node is not yours (`NOT_OWNER`); the node is not a city, that is, it is a DEC-23 province
   (`NOT_CITY`, a new code); the same level (`NO_CHANGE`); CP less than `orders.cost.priority`
   (`NOT_ENOUGH_CP`, does not trigger at 0).
2. ~~**City target stock**~~ **[superseded by DEC-28]** the same for all levels: `min(capacity, discharged + supply.buffer)`
   ("discharged": the owner's discharged units standing in the city, as in SIM-08). Priority does not change the target
   and does not fill the warehouse to capacity (the owner 2026-10-12: more supply deficit is needed); it
   sets only the order of delivery (item 4). There is no key `supply.low_buffer`.
3. **Supply tree** as in SIM-08 (the default values of #131 come in here and become
   the rule): Dijkstra from your capital over your nodes joined by internal edges; the metric:
   the packet time over an edge (`packet_ticks` by road level, DEC-22, DEC-26); on a tie the parent with
   the smaller `node_key(player, node)`. Cut-off nodes are not in the tree. Provinces (DEC-23) are in
   the tree as transit: they have no warehouse and no target. **Children of a city** in supply: the nearest
   descendant cities in the tree (the path to them goes only through provinces); a packet goes to such a city
   along that path in full, without stopping in provinces.
4. ~~**Dispatch**~~ **[superseded by DEC-28]** once per `supply.dispatch_ticks` (ticks `t > 0` that are multiples of the period) in three passes:
   `high`, then `normal`, then `low`: high priority is served before normal, normal
   before low. In the pass of level `L` the cities with a level not lower than `L` are **active** (`high` is higher than
   `normal`, which is higher than `low`); the others are only transit in this pass. What was sent in a pass counts
   as "in transit" in the following passes.
   - The own deficit of an active city: `target - warehouse - in transit to it`; of an inactive one:
     `-(warehouse + in transit to it)`. An inactive city does not hold a stock for itself: everything lying in it
     is available to its descendants (transit).
   - The deficit of a subtree, bottom up: `max(0, own + sum of the deficits of the children's subtrees)`.
   - ~~Cities in tree order (from the capital) give `warehouse - (target if active, otherwise 0)` to children with
     a subtree deficit above 0 (minus what was already sent in earlier passes of the period).~~
     **[superseded by the owner's decision 2026-10-15, #287]**: cities in tree order (from the capital)
     give to children with a subtree deficit above 0 `warehouse - reserve` (the warehouse already without what was sent in
     earlier passes of the period). The **reserve** of an active city: `min(target, warehouse_capacity // 2)`,
     that is, no more than the target and no more than half the warehouse capacity (rounding down); of an inactive one: 0,
     as before. Warehouse capacity 1 keeps 0 (pure transit), 2 and 3 keep 1, 4 keeps 2,
     the capital with 6 keeps 3 (if the target is not smaller). Reason: with the small warehouses of `mvp-1` (1..2) the target
     equalled the whole warehouse, a small city forwarded nothing and blocked the supply of all
     the cities behind it. The own deficit (what the city asks for, below) does not change: a city whose
     reserve is less than its target can both give to children and ask its parent in one period (a conveyor,
     examples 26-28: in the `low` pass the normal cities are active again, and what was given in the `normal` pass
     frees up room).
     **Order of children:** a child's key: the smallest triple `(level rank, warehouse, node_key(player, node))`
     among the active cities of its subtree (including itself) with an own deficit above 0;
     the rank of `high` is 0, `normal` 1, `low` 2; warehouse: the charges in the city's warehouse without those "in transit". Children go in
     ascending order of key: higher priority first; at equal level the first is the city with the LEAST number of
     charges in the warehouse; at equal warehouse the smaller `node_key` (AGENTS.md, 4.1, rule 6).
     A child gets no more than its subtree
     deficit, no more than the free room `capacity - warehouse - in transit to it` and no more than the remainder of
     the throughput of every edge of the path for this period (the edge's `amount`, DEC-22, minus
     what transfers took, item 10; the remainder is shared by all three passes and all paths through the edge).
   - Everything that one city sent to one child in a period goes as one packet.
   - Equal priority: the city nearest to the capital holds its target first (#287: its own reserve).
   - If all cities are `normal`, one level rule works: the first to receive is the city with the smallest
     number of charges in the warehouse (a test; the "by descending deficit" order from SIM-08 is removed).
5. **Packet and path.** A packet stores the path (edges) and the current edge. The time of each edge
   `packet_ticks(edge)` is computed at dispatch by the current levels and does not change afterwards.
   - A packet on an edge that has stopped being internal for its owner is lost (`packet_lost`),
     ~~except on a freight road (DEC-22, item 5)~~ **[superseded by DEC-26]**: there are no exceptions, there is no freight road.
   - A packet that reached an intermediate node goes on at once. If the next edge of the path is no longer
     internal: in your own city the charges are put into the warehouse (within capacity, the excess:
     `charges_overflow`), in a province they are lost (`packet_lost`).
   - At the end of the path the charges are put into the warehouse within capacity, the excess burns up (`charges_overflow`).
6. **Transfer.** The command `Transfer(from, to, n)`: send once `n` charges from the warehouse of city
   `from` to the warehouse of city `to` along your internal roads. Free (`orders.cost.transfer = 0`).
   - Checks in order: `from` does not exist (`NOT_FOUND_OR_HIDDEN`); not yours (`NOT_OWNER`); `to` does not exist
     (`NOT_FOUND_OR_HIDDEN`); not yours (`NOT_OWNER`); `from` or `to` is not a city (`NOT_CITY`);
     `from == to` or `n < 1` (`INVALID_ARGUMENT`); no path over your nodes through internal edges
     (`NO_PATH`); the warehouse of `from` has fewer than `n` (`NOT_ENOUGH_CHARGES`); **(#287)** the warehouse of `to`
     has no free room (`TARGET_FULL`, a new code, see the volume below); CP (`NOT_ENOUGH_CP`).
   - **Volume (#287) [accepted]:** when the command is applied, `n` is cut down to the free room of the warehouse of
     `to`: `n' = min(n, warehouse_capacity(to) - warehouse(to) - in transit to to)` ("in transit": the charges of your own
     packets whose path ends in `to`, as in item 4); at `0` the command is rejected with `TARGET_FULL`. After that everywhere
     `n'`. Before, charges above the free room burned up on arrival (`charges_overflow`).
     The client sees the actual volume in the event `transfer_started` (`charges`); the `ack` has no volume
     field, the protocol does not change; `ack.arrive_tick` is computed from `n'`.
   - Path: ~~the fastest for this `n` by the time from item 6 below~~ **[superseded by #287]**: the
     fastest by the sum of `packet_ticks` of the edges (the number of batches does not depend on the path: `amount` is the same at
     all levels, DEC-26), on a tie the lexicographically
     smaller sequence of `node_key`, as for movement. A transfer goes in any direction, including
     toward the capital and inside a pocket cut off from the capital (the owner 2026-10-12).
   - `n'` charges are written off from the warehouse of `from` when the command is applied (the start of tick `t`), ~~the packet
     sets out in the same tick~~ **[superseded by #287]**: the first batch sets out in the same tick.
   - ~~The time on edge `e`: `packet_ticks(e) + (ceil(n / amount(e)) - 1) * supply.dispatch_ticks`,
     where `ceil(n / a) = (n + a - 1) // a`: `n` charges go in batches of `amount` per period, while the
     simulation moves them as one packet with the time of the last batch.~~ **[superseded by the decision of the
     owner 2026-10-15, #287]**: **batches.** A transfer goes in `B = ceil(n' / amount)` batches,
     `ceil(n / a) = (n + a - 1) // a`: batch `k = 0 .. B - 1` of `min(amount, remaining)`
     charges leaves `from` at tick `t + k * supply.dispatch_ticks` as a separate packet and goes
     the whole path by itself, `packet_ticks` on each edge (like an automation packet). Before leaving, a batch
     waits in `from` (in the player view: your own transfer packet at the start of the first edge, `depart_tick` in
     the future) and takes no throughput. The arrival of the last batch:
     `t + (B - 1) * supply.dispatch_ticks + the sum of packet_ticks(e) over the path`; the server reports it in
     `ack.arrive_tick`.
   - **[proposed]** A waiting batch whose first edge has stopped being internal: if `from` is
     still yours, the charges return to the warehouse of `from` (within the warehouse capacity, the excess
     `charges_overflow`; the event `packet_delivered` in `from`), otherwise they are lost (`packet_lost`).
     A transfer cannot be cancelled by a command. ~~A transfer does not take
     the throughput of automatic dispatch (by default).~~ **[superseded by the decision of
     2026-10-14, #253]**: a transfer shares the edge's throughput with automatic dispatch (item 10).
   - On the way a transfer obeys item 5. The arrived charges lie in the warehouse of `to` as ordinary ones:
     automatic dispatch can carry the excess further, so to accumulate, a city is set to
     `high`.
7. ~~**"Supply" map mode**~~ **[superseded by DEC-28, item 8]** (the client, there is no game logic in it): map modes switch on `Tab`
   (alternative `F2`), "Supply" is one of them; the `S` key is taken by splitting a group (DEC-20). The mode
   shows city priorities (the label differs by shape, not only by color), warehouses,
   the supply tree, your own packets and transfers. A click on your own city changes the priority in a cycle;
   dragging from city A to city B with a slider `n`: a transfer. The path and the arrival tick of a transfer
   the client gets in the `ack`, it does not compute them itself.
8. **Visibility.** The enemy's priorities, transfers and packets are not visible (DEC-04, DEC-10);
   the events `priority_set`, `transfer_started` and packet events are received only by the owner. New fields of
   `PlayerView` (the priority of your own city, your own transfers): only with a fog test.
9. **Order inside the `supply` system:** loss of packets, movement of packets along the path and delivery,
   recharge, the share of transfers (item 10), dispatch (three passes). Transfers are created in `apply_commands`.
10. **A transfer and automation share the edge's `amount`** (the owner's decision 2026-10-14, #252, #253)
    **[accepted]**. An edge passes `amount` charges per dispatch period (DEC-22, item 4), and a transfer
    takes them first.
    - A transfer packet that has set out onto an edge (when the command is applied or further along the path in an
      intermediate node) carries on that edge a **share** of `n` (all its charges). On every
      dispatch tick (tick `t > 0` that is a multiple of `supply.dispatch_ticks`), while the packet is on the edge, the transfer takes
      `min(amount, share)` from the edge's `amount`, and the share decreases by the same. The tick of setting out onto
      the edge counts if it is itself a dispatch tick (a transfer is created in `apply_commands`, and
      the packet moves to the next edge at the start of the `supply` system, both before dispatch).
    - Automatic dispatch (item 4) gets for the edge the remainder of the period:
      `max(0, amount - what this player's transfers took on this edge in this tick)`.
    - A transfer goes first, so its time by the formula of item 6 does not depend on automation, and the server
      reports it in the `ack` when the command is applied.
    - **#287:** every batch of a transfer (item 6) is a separate packet with its own share (its own charges, no
      more than `amount`); a batch still waiting in `from` takes no share. The batches of one transfer
      set out with a step of the dispatch period, so on every edge of the path one transfer takes no
      more than `amount` per period.
    - **[proposed]** Transfers on one edge do not delay each other: each goes in its own
      batches by the formula of item 6, what they took is added up, and automation is left `max(0, ...)`.
      A queue of transfers would make the time of a transfer depend on other transfers on edges further
      along the path, and the `ack` could not name it in advance.
    - A transfer packet left the edge (further along the path, onto a warehouse, or lost): its share on this edge
      disappears; on the next edge of the path the share is `n` again.
    - An edge is internal for only one player, so one player's transfers do not affect
      the other's supply (there are no tie-breaks between players).

Worked examples. The map: capital K (capacity 10); cities A, B, C (capacity 6), edges K-A, A-B,
A-C; province P only in examples 8, 15 and 20; examples 23-25: item 10; all edges have `travel_ticks = 30`, level 1
(`speed_pct` 100, `amount` 1; with DEC-28 `amount` by level 1 / 2 / 3), unless said otherwise; `buffer = 2`,
`dispatch_ticks = 10`; `node_key` grows in the order K, A, B, C; there are no units unless said otherwise;
examples 26-28: the warehouse is separate from capacity (DEC-26, `city_upgrades.enabled = true`), the warehouse capacity of
K is 6, of the others is given in the example; transfers at tick `t` that is not a multiple of the period, unless said otherwise;
warehouses are given at the moment of dispatch (after recharge); the "outcome" describes one dispatch period. The implementation's tests: exactly this table.

| # | Situation | Outcome |
|---|---|---|
| 1 | all `normal`; warehouse of K 5, the others 0 | target of K 2, excess 3; deficit of the subtree of A 2 + 2 + 2 = 6; K sends A 1 charge (`amount` 1) |
| 2 | all `normal`; warehouse of A 3, K 0 | target of A 2, excess 1; B and C with an equal warehouse 0 and deficit 2: B (the smaller `node_key`) gets 1 |
| 3 | as 2, C `high` | the `high` pass: A is inactive, gives C 1; the `normal` pass: the excess of A 0 (warehouse 2 = target), B gets nothing; outcome: packet A-C 1, warehouse of A 2 |
| 4 | chain K-A-B without C: A `low`, B `normal`; warehouse of A 2; A-B of level 3 (`amount` 1; recalculated DEC-26, earlier a freight road `amount` 3) | the `normal` pass: A is inactive (transit), B gets 1 (the edge passes no more than `amount`); warehouse of A 1; the `low` pass: A is active, target 2, warehouse 1: gives nothing |
| 5 | as 4, A `normal` | A holds its target 2, B gets nothing |
| 6 | chain K-A-B without C: A and B `high`; warehouse of A 4; A-B of level 3 (`amount` 1; recalculated DEC-26, earlier a freight road `amount` 3) | A holds its target 2 (the one nearest the capital first), excess 2 for B (deficit 2), but the edge passes 1: packet A-B 1, warehouse of A 3 |
| 7 | chain K-A-B without C: B `high`, warehouse of B 1; A `normal`, warehouse of A 3 | target of B 2, deficit 1; the `high` pass: A is inactive (target 0), gives B 1; the `normal` pass: the excess of A 0; warehouse of A 2 |
| 8 | K-P-B, P a province; warehouse of K 5 | K sends B 1 charge as a packet along the path K-P-B; does not stop in P; 60 ticks on the way |
| 9 | `Transfer(A, B, 4)`, warehouse of A 5 | warehouse of A 1 at tick `t`; ~~in the warehouse of B +4 at tick `t + 30 + 3 * 10 = t + 60`~~ **[recalculated #287: batches]** batches of 1 set out at `t`, `t + 10`, `t + 20`, `t + 30`; in the warehouse of B +1 at ticks `t + 30`, `t + 40`, `t + 50`, `t + 60`; `ack.arrive_tick = t + 3 * 10 + 30 = t + 60` |
| 10 | as 9, A-B of level 3 (`speed_pct` 200, ~~`amount` 1; recalculated DEC-26, earlier freight~~ `amount` 3: **[recalculated DEC-28]**, #306) | ~~arrival of the batches `t + 15`, `t + 25`, `t + 35`, the last `t + 3 * 10 + 15 = t + 45` (#287)~~ batches of 3 and 1 set out at `t` and `t + 10`; arrival `t + 15` (3 charges) and of the last `t + 1 * 10 + 15 = t + 25` |
| 11 | `Transfer(A, B, 1)`, A-B fast, level 3 (`speed_pct` 200) | arrival `t + 15` |
| 12 | `Transfer(A, B, 6)`, warehouse of A 5 | `NOT_ENOUGH_CHARGES` |
| 13 | `Transfer(A, E, 1)`, E is an enemy node | `NOT_OWNER` |
| 14 | `Transfer(A, X, 1)`, X is yours, but the path to it goes only through an enemy node | `NO_PATH` |
| 15 | `Transfer(P, B, 1)`, P a province | `NOT_CITY` |
| 16 | `Transfer(K, B, 3)` along K-A-B; a packet on A-B (level 1), A is captured | the packet is lost (`packet_lost`). #287: at tick `t + 55` all three batches are on A-B (they set out onto A-B at `t + 30`, `t + 40`, `t + 50`), A is captured: three `packet_lost` of 1 each |
| 17 | `Transfer(K, C, 3)` along K-A-C; a packet on K-A, C is captured | the packet reaches A; A-C is not internal: 3 charges into the warehouse of A. #287: C is captured at `t + 10`; the batches reach A at `t + 30`, `t + 40`, `t + 50`, each puts 1 into the warehouse of A, 3 in total |
| 18 | `Transfer(A, B, 3)`, warehouse of B 5 | ~~B gets 1, 2 burn up (`charges_overflow`)~~ **[superseded by #287]**: the volume is cut to the free room, example 29 |
| 19 | a packet of 2 charges on A-B, B is captured before arrival (recalculated DEC-26: earlier it arrived over the freight road) | the packet is lost (`packet_lost`), no `packet_captured`. #287: ~~`Transfer(A, B, 2)` along A-B of level 2 goes in two batches; B is captured at `t + 10`, both batches are already on A-B: two `packet_lost` of 1 each~~ **[recalculated DEC-28]**, #306: along A-B of level 2 (`amount` 2) one batch of 2; B is captured at `t + 10`: one `packet_lost` with 2 |
| 20 | `SetPriority(P, high)`, P a province | `NOT_CITY` |
| 21 | C `high`, C is captured and recaptured | the priority of C is `normal` |
| 22 | all `normal`; warehouse of A 3, B 1, C 0; K 0 | excess of A 1; deficits of B 1, C 2; C with the smallest warehouse first: packet A-C 1, B gets nothing |
| 23 | `Transfer(K, A, 2)` at the dispatch tick `t`, warehouse of K 5 (after the command 3); no production | the transfer takes 1 from the `amount` of K-A at tick `t` and 1 at `t + 10` (#287: the first and second batches): K sends nothing; at tick `t + 20` K sends A 1 charge; ~~the transfer is in the warehouse of A at tick `t + 40`~~ **[recalculated #287]** the batches are in the warehouse of A at ticks `t + 30` and `t + 40` |
| 24 | ~~as 23, K-A a freight road of level 3 (`amount` 3)~~ **[removed DEC-26]**: there is no freight road | (the row is left so as not to shift the numbers) |
| 25 | a transfer packet K → B (1 charge) reached A at the dispatch tick and moved onto A-B; warehouse of A 3, K 0 | the transfer takes 1 from the `amount` of A-B; the excess of A 1 goes not to B (the edge is busy) but to C: packet A-C 1 |
| 26 | chain K-A-B without C; warehouse capacity of A 1, B 2; warehouses K 6, A 1, B 0 | the `high` pass: all are inactive, no deficits; the `normal` pass: K sends A nothing (free room in A 0), A holds `min(1, 1 // 2) = 0`: packet A-B 1, warehouse of A 0; the `low` pass (`normal` are active again): free room of A 1, deficit of the subtree of A: its own 1 + B `2 - 0 - 1 = 1`: K sends A 1. Outcome: packets K-A 1 and A-B 1. Before, A held a target of 1, and nothing went out |
| 27 | as 26, the next period: warehouse of A 0, in transit K-A 1 and A-B 1 | free room of A `1 - 0 - 1 = 0`: K sends nothing, A has nothing to give (transit with a warehouse of 1 holds no more than 1 charge in transit to itself: a question for the owner in #287) |
| 28 | chain K-A-B without C; warehouse capacity of A 2, B 2; warehouses K 6, A 2, B 0 | the `normal` pass: A holds `min(2, 2 // 2) = 1`: packet A-B 1, warehouse of A 1; the `low` pass: free room of A 1, deficit of A its own 1 + B 1: K sends A 1. Outcome: packets K-A 1 and A-B 1 |
| 29 | `Transfer(A, B, 3)`, warehouse of A 3, warehouse of B 5 | volume `min(3, 6 - 5 - 0) = 1`: warehouse of A 2; B gets 1 at tick `t + 30`, nothing burns up; `transfer_started` with `charges` 1, `ack.arrive_tick = t + 30` |
| 30 | `Transfer(A, B, 1)`, warehouse of A 3, warehouse of B 6 | `TARGET_FULL` |
| 31 | `Transfer(A, B, 3)`, warehouse of A 3, warehouse of B 2, a packet of 2 in transit to B | volume `min(3, 6 - 2 - 2) = 2`: warehouse of A 1 |
| 32 | `Transfer(K, B, 3)` along K-A-B, warehouse of K 5 | batches of 1 set out from K at ticks `t`, `t + 10`, `t + 20` and travel `30 + 30` ticks: B +1 at `t + 60`, `t + 70`, `t + 80`; `ack.arrive_tick = t + 2 * 10 + 60 = t + 80` (earlier `t + 100`: the formula of item 6 added the waiting of the batches on every edge) |
| 33 | `Transfer(A, B, 3)`, warehouse of A 3; at tick `t + 5` B is captured | the first batch on A-B is lost (`packet_lost` 1); the two waiting batches at tick `t + 6` return to the warehouse of A (**[proposed]**, item 6): warehouse of A 2 |

What the implementation changes (simulation and `SIM_VERSION`, protocol and `PROTOCOL_VERSION`, client, bots, rulesets): the list is in #230.

Implementation: #243 (`SIM_VERSION` 6, `PROTOCOL_VERSION` 10). Simulation: `gow_sim.systems.supply`
(city children through provinces, three passes, a packet with a path `Packet.route`), the commands `SetPriority` and
`Transfer` in `gow_sim.commands`, table tests `packages/sim/tests/test_dec18.py`. Player view:
`NodeView.priority` of your own city, for your own packets the remaining path `path`, `dest_tick` and the flag
`transfer`. Client (the minimum, until #236): the "Supply" mode on `Tab`/`F2`, a click on your own city
opens a radial menu (three priorities and "transfer"), a transfer: the destination city by a click, the number
of charges by a slider. The client does not draw the supply tree yet: the server computes it, and it is not in the player view
(moved to #236). Bots set `high` for cities at the border.

Implementation of the decisions of 2026-10-15: #287 (`SIM_VERSION` 13, `PROTOCOL_VERSION` unchanged:
the rejection code as a string, the volume in the event). `gow_sim.systems.supply`: `forward_reserve`, `warehouse_room`,
`send_transfer` (batches: packets with `depart_tick` in the future); tests: examples 26-33 in
`packages/sim/tests/test_dec18.py`.

Alternatives (not chosen):
- Only priority without a transfer (less control, but no quick move of a stock).
- Priority `high` fills the warehouse to capacity, `low` holds nothing (the first version of DEC-18; removed by the owner 2026-10-12: more supply deficit is needed, priority is only the order of delivery).
- ~~A transfer takes the throughput of roads on a par with automation (more exact, but harder to explain and compute).~~ Chosen by the owner 2026-10-14 (item 10).
- A transfer does not take the throughput of automation (the default value until 2026-10-14).
- Automation takes `amount` first, a transfer gets the remainder (the time of a transfer is then not known in advance).
- A transfer only from the supplied territory (like `NOT_SUPPLIED` for construction).
- A transfer like "Defense": a public intent (reveals the plan to the enemy).

### Starvation when cut off (DEC-19, #231) **[accepted]**

> **[superseded by DEC-41 under `economy.model = "v2"`]**: starvation is removed (a cut line already stops resupply). The text below is kept and is in force for `economy.model = "v1"`.

The owner's decision 2026-10-12. Replaces the capacity drop of a cut-off city (section 9, SIM-07) together with DEC-22.

A city cut off from the capital gradually "eats" the garrison's charges. Units do not die from it, they
only stay discharged and become easy prey. The capacity drop on being cut off
is removed: capacity is fixed (DEC-22).

1. **A cut-off city:** your own city outside the owner's connected supplied territory (SIM-07,
   `supplied_territory`): there is no path from it over your nodes to your capital. Provinces (DEC-23) do not
   starve: they have no warehouse, the charges of units in them are not spent. Neutral nodes do not starve.
2. **The countdown.** `Node.cut_since`: the first tick of the current continuous cut-off. Reset when the
   city is in the supplied territory again or changes owner. If after a capture the city is cut off for
   the new owner, the countdown starts from the tick of the capture.
3. **Consumption** at ticks `t = cut_since + starvation.grace_ticks + k * starvation.period_ticks`,
   `k = 0, 1, 2, ...`: the garrison spends `starvation.charges * ceil(U / starvation.per_units)`
   charges, where `U`: the owner's units standing in the city (groups on edges, including in transit,
   do not count), `ceil(U / k) = (U + k - 1) // k`. At `U = 0` nothing is spent.
4. **From where:** first the city's warehouse; the remainder from the charges of standing units, one charge at a time from the group with
   the largest `charged`, on a tie from the one with the smaller id (like shots, DEC-07, rule 7). A shortfall
   does not accumulate and is not carried over to the next time.
5. **Units do not die from starvation.** Death above capacity (#118) remains: it is caused by capacity, not by
   being cut off.
6. **Capacity does not change when cut off** (DEC-22); the warehouse of a cut-off city is not cut down. DEC-26: the warehouse level and the barracks are not changed by being cut off.
   Recharging units from the warehouse in a cut-off city goes as usual.
7. **System.** Starvation is computed by the `capacity` system after death above capacity; it runs after the fight and before
   `supply`, so at the consumption tick the warehouse is first spent by starvation, then recharges the units.
8. **Visibility.** The event `starvation` (player, node, charges from the warehouse, charges from units) is received
   only by the owner. For your own cut-off city the view shows `starve_in`: ticks to the next
   consumption (taking the grace period into account); for enemy and neutral nodes `None` (a new `PlayerView` field,
   fog test). Whether an enemy city is cut off, the player infers from public ownership (DEC-04), this is not
   a leak.
   **Clarification (the owner's decision 2026-10-14, #252, #253) [accepted]:** `starve_in = None` also for
   your own cut-off city if there is nothing to spend: the warehouse is empty and the owner's units standing in the city
   have no charges (item 4). Then the interface has neither a pulse nor a countdown. The consumption schedule
   (`cut_since`, item 3) does not change because of this: charges appeared (a packet, a transfer,
   a charged group arrived), and `starve_in` again shows the time to the nearest tick of the same
   schedule. **[proposed]** For the same reason `None` also for a cut-off city without standing units
   (`U = 0`, item 3: no one to spend, nothing is lost), even if the warehouse is not empty.
9. Recruiting and construction are unchanged (DEC-26: recruiting goes if the city has a barracks; the barracks and the warehouse are also built in a cut-off city, the road is not): recruiting in a cut-off city is allowed (DEC-01), construction is not
   (`NOT_SUPPLIED`, DEC-16).

Numbers in the ruleset (a new section `[starvation]`): `grace_ticks = 100` (10 s), `period_ticks = 100`
(10 s), `charges = 1`, `per_units = 3` (1 charge for every started 3 units).

Worked examples. City X (capacity 6) is cut off from tick 1000 (`cut_since = 1000`); the ruleset numbers
as above; the garrison stands in X; death above capacity is in force (the garrisons of the examples do not exceed it).
The implementation's tests: exactly this table.

| # | Situation | Outcome |
|---|---|---|
| 1 | 3 units, all charged; warehouse 2 | 1100: warehouse 1; 1200: warehouse 0; 1300: charged 2; 1400: 1; 1500: 0; after that nothing changes, the units are alive |
| 2 | no units, warehouse 5 | nothing is spent |
| 3 | 5 units, all charged; warehouse 0 | 1100: −2 (`ceil(5 / 3) = 2`), charged 3; 1200: 1; 1300: 0 (the shortfall 1 is not carried over); the units are alive |
| 4 | 4 units, all charged; warehouse 1 | 1100: 2 are spent: warehouse 0 and one charge of a unit, charged 3 |
| 5 | groups G1 (3 charged) and G2 (2 charged), id G1 < G2; warehouse 0 | 1100: 2 are spent (`ceil(5 / 3)`): the first from G1 (3 > 2), the second again from G1 (2 = 2, the smaller id); G1 1, G2 2 |
| 6 | the connection is restored at tick 1150, cut off again at tick 1180 | consumption at 1100; a new countdown from 1180; the next at 1280 |
| 7 | at tick 1100 your own group passes through X in transit | it does not count in `U` |
| 8 | province P is cut off, it has 3 charged units | no starvation |
| 9 | the player captured city Y at tick 2000, Y is not connected to their capital | `cut_since = 2000`; the first consumption 2100 |
| 10 | at tick 1100 warehouse 0, all units discharged | nothing changes, nobody dies |
| 11 | 3 units, discharged; warehouse 0; tick 1150 | `starve_in = None` (nothing to spend, item 8) |
| 12 | as 11, at tick 1160 a packet puts 1 charge into the warehouse | `starve_in = 40` (the next consumption at 1200, the schedule is the same) |
| 13 | no units, warehouse 5; tick 1150 | `starve_in = None` (no one to spend, item 8, [proposed]) |

What the implementation changes (simulation and `SIM_VERSION`, protocol and `PROTOCOL_VERSION`, client, bots, rulesets): the list is in #231.

Implementation: #244 (`SIM_VERSION` 7, `PROTOCOL_VERSION` 11). `Node.cut_since`, starvation in the
`capacity` system after death above capacity (`gow_sim.systems.capacity.starvation`, the order of systems did not
change), the ruleset section `[starvation]`, the event `starvation` (`warehouse`, `units`) only to the
owner, `NodeView.starve_in`; table tests `packages/sim/tests/test_dec19.py`. ~~In example 3
(7 units in a city of capacity 6) the test turns off death above capacity: the example does not account for it.~~
Example 3 was fixed in #253: the former 7 units in a city of capacity 6 would have died above capacity (#118), and
the test turned this death off; now it is 5 units, and the test runs on the real rules. Examples 11-13
(`starve_in` without charges): #253.
The "siege of attrition" scenario is recalculated: a city with its roads cut falls on the 3rd wave.

Alternatives (not chosen):
- Keep the capacity drop when cut off (opaque, conflicts with the fixed capacity of DEC-22).
- Starving units die when there are no charges (too harsh: encirclement would decide without a fight).
- Consumption per unit, not per started 3 (punishes big garrisons more).
- Starvation in provinces too (the charges of units in a province are also spent).

### How the simulation computes this (SIM-08, #24)

> This block describes the code before the implementation of DEC-18 (#230, implemented in #243), DEC-19 (#231), DEC-22 (#234) and DEC-26 (#265: the warehouse "capacity" below, with `city_upgrades.enabled`, is its own, `supply.target_stock`; there are no road types); the current rules: the blocks above and section 8. Width below: the road level, "no more than `width` charges": `amount` (DEC-22). The values of #131 came into DEC-18 as the base algorithm; the "by descending deficit" order below was removed by DEC-18.

`gow_sim.systems.supply`, numbers: the `[supply]` section of the ruleset.

- The flow goes only outward along the tree of shortest paths from your capital over the connected supplied
  territory (section 9): every node has one parent toward the capital. Packets go only along the
  internal edges of the tree from parent to child, so there are no cycles and no movement toward the capital.
- The node's target stock: `min(capacity, discharged standing units + supply.buffer)`; the subtree deficit
  is computed bottom up once per `supply.dispatch_ticks`. A node sends to its children everything above the target
  stock, in descending order of subtree deficit (tie-break by `node_key`), no more than `width`
  charges per edge per period (one packet).
- Travel time: `travel_ticks * 100 // supply.packet_speed_pct[width]` (rounding down, at least
  1 tick), by the width at the moment of dispatch.
- A packet on an edge that has stopped being internal for its owner is lost (the event
  `packet_lost`); charges above the warehouse capacity on arrival are lost (`charges_overflow`).
- Recharge: the owner's units standing in a node take charges from the warehouse, no more than
  `supply.recharge_per_tick` per node per tick; units on edges are not charged.
- Details (question #131, DEC-14, closed: the values came into DEC-18, items 3 and 4): the tree by packet time, on a tie
  the parent with the smaller `node_key`; a child gets no more than its free room
  (`capacity - warehouse - charges in transit to it`); the own deficit `target - warehouse - in transit` can be
  negative and first covers the children (subtree deficit: `max(0, own + Σ of children)`);
  the group with the smallest id is charged first; the order inside the system: loss of packets, delivery,
  recharge, dispatch.

### Economy v2 (DEC-41, #642) **[accepted]**

The owner's decision of 2026-10-31, after the mechanics audit (#639, `docs/design/mechanics-audit-2026-10.md`): the audit found a CP deficit and a supply surplus at the source (CP binds everywhere, charges are short at the front only by delivery latency, few things consume charges). The model of v2: **CP pays for orders (moves, recruiting); supply (charges) pays for everything material.** The owner's answers: "the capital is the main factory with one fixed rate, every built factory has a smaller but also fixed rate" (item 2); "the player chooses the path, not the server" (item 6); "a capture needs one spent charge" (item 11); "a bunker is destroyed on capture" (item 12); "we will see the rest as the game goes": every other default below is **[accepted]** as a **starting value, tuned by playtests** (not a promise of the final number).

**Behind a flag.** Everything below applies only under `economy.model = "v2"` in the new `rulesets/mvp-3.toml`. `economy.model = "v1"` (the default) is today's behaviour in `mvp-0`, `mvp-1`, `mvp-2`, `test-short`: the v1 rules, their DEC blocks and the golden replays stay valid and unchanged. Rule numbers live in `Ruleset` (`AGENTS.md`, 4.1, rule 7); the numbers named here are the starting values of `mvp-3.toml`. The status marks `[superseded by DEC-41 under economy.model = "v2"]` on the older blocks mean exactly this: the old text is kept, and it is in force for v1.

**Invariant 1 of section 2 is amended for factories.** "Income does not grow from territory" stays for CP (flat, one rate for everyone) and for the capital. Charge production now grows with the number of **built factories**, and the growth is bounded twice: by the factory cap (item 2) and by the factory cost in charges, paid at the front (item 2). Territory itself still gives nothing.

**Economy**

1. **No stances.** CP income is the same for everyone: the whole quantum (100 hundredths per `cp.period_ticks = 50`) goes to CP (+67% against War, +100% against Balance of v1). Charges no longer come from CP. `SetStance`, `economy.stance_to_charges_pct`, `charges_per_cp`, `start_stance`, `orders.stance_cooldown_ticks` have no effect in v2 (`SetStance` gives `FEATURE_DISABLED`). The CP cap stays 5 CP (`cp.cap`), re-checked after the tournament.
2. **Factories (F1 to F4).** A factory is a city (not a province) that produces charges **into its own warehouse**. Production is per factory and additive.
   - **The capital is the main factory from the start** with its own fixed rate: `factory.capital_period_ticks = 50` (1 charge per 50 ticks, the order of magnitude of today's Balance output).
   - **Every built factory has a smaller fixed rate:** `factory.built_period_ticks = 100` (1 charge per 100 ticks).
   - **Building:** any own city, cost `factory.cost = 4` **charges** (paid by the progressive payment of item 7), `factory.build_ticks = 100`. A factory is not CP-priced.
   - **Cap:** at most `factory.max = 3` factories per player including the capital.
   - **Capture:** a captured factory passes to the capturer as a built factory (built rate) if the capturer has fewer than `factory.max` factories, otherwise it is destroyed; all lines that start at it are cut (item 3). A captured capital counts as a built factory for the capturer.
   - Production stops while the factory warehouse is full: the charge **burns** (event `charge_burned`), the only place where production burns (L6).
3. **Supply lines (L1 to L7).** A factory (and any city that is the target of a line) can start lines.
   - **A line** is an independent layer from a source city to a target city along a **path of own nodes drawn by the player** (item 6). Lines never merge, even on shared roads or nodes.
   - **Throughput (L1):** per line, independent: 1 charge per `supply.dispatch_ticks` on the line's turn. Road levels do not matter.
   - **Round robin:** a node with several outgoing lines serves them in turn; a target that has its own outgoing lines is a tree node and passes charges on by the same rule.
   - **Relay (L5):** the node itself is one slot of its round robin (its own warehouse competes with its outgoing lines for the incoming charges), so a relay neither stays empty nor hoards.
   - **A full target (L6):** the line is skipped in the round robin; the source keeps the charge. The charge burns only when the factory warehouse is full (item 2).
   - **Limits (L4):** at most `lines.max_out = 3` outgoing lines per node, any number incoming, **no cycles** (a cycle is rejected).
   - **Cost (L3):** drawing and removing a line is free (a standing setting, like the old marker).
   - **Speed:** every packet travels at `supply.base_speed_pct = 150` (item 8).
   - **Breaking, the owner's four situations:**

     | # | Lines | Event | Result |
     |---|---|---|---|
     | 1 | A -> C along A-B-C; a path A-D-C exists | B captured | the line reroutes along A-D-C |
     | 2 | A -> B; B -> D; B -> C; D and C connect only through B | B captured | all three lines cut |
     | 3 | as 2 | C captured | only B -> C is cut; A -> B and B -> D stay |
     | 4 | factory A with lines A -> B, A -> E | A captured | both lines cut |

   - **Rule:** when an **intermediate** node of a line is captured, the player's drawn path is used while it is intact; once it breaks, the server **reroutes** along the fastest path over own nodes to the same target if one exists (a tie by `node_key`, rule 6 of 4.1), otherwise the line is cut below the captured node (situation 2 for the lines that depend on that node). A line whose **source or target** is captured is cut; a captured factory cuts all its lines.
   - **A cut line (L7)** is removed; the player redraws it. The older note "a contradiction between rerouting and a drawn path" is resolved by this rule (item 6).
   - **Packets in flight** on a broken line follow the existing packet rules of section 7 (loss of packets); the sim issue pins this in a test.
   - **Fog:** the enemy's lines are never visible; `PlayerView` has only your own lines.
4. **Groups carry supply.** Charged units standing in a city can give their charges to pay for buildings (item 7).
5. **What v2 removes (X, R).** Front markers and `SetFront` (DEC-28), `rear_min` and `SetRearMin`, the delivery passes and donors, one-off transfers (DEC-18), starvation (DEC-19), the DEC-29 distance bonus (item 10), `SetMode(DEFENSE)` and the accumulated Defense bonus (DEC-30; the bunker replaces it, item 12), road upgrades (R): all give `FEATURE_DISABLED` where they are commands. Roads keep their length, terrain and the border point; they have no level in v2. Kept: recharge of units from the warehouse of their node (`supply.recharge_per_tick`), the tree of own territory as a distance metric where a rule needs one, spoils on capture, warehouse upgrades (item 7).
6. **L2: the player draws the path.** A line is given as a path over own roads (waypoints along the graph). The server validates that every node is own and the path is a simple path; the path is used as drawn while it is intact. Rerouting only happens on a break, as in item 3. The server never replaces an intact path with a "better" one.

**Buildings paid with supply**

7. **Payment (items 4 and 5 of the owner's list).** All city buildings are paid in **charges**, not CP; recruiting stays CP. Costs (starting values): factory 4, barracks 3, warehouse upgrade 2 per level, bunker 3 (item 12). A cost may exceed the city warehouse (a barracks of 3 in a city with a warehouse of 1), so payment is **progressive**: the building takes charges from the city warehouse, then from the own groups standing in the city (the largest `charged` first, as DEC-19 item 4 chose for the old starvation), until the cost is met. The build time starts when it is paid in full. Cancelling a building refunds nothing.
8. **Roads (R).** Road upgrades are removed; all packets travel at `supply.base_speed_pct = 150` (the audit: upgrades do not work, DEC-39 R2).
9. **Starting supply (S).** Only the capital keeps a stock: the capital's start stock stays, the warehouses of the other cities start at 0, the start units stay charged (`crossroads`: 30 -> 22 per side). A ruleset number, the maps do not change. Province warehouse: item 13.

**Orders and defense**

10. **Planned order rework (P1 to P4).**
    - Price equal to an ordinary order (`orders.cost.planned_move = orders.cost.move`). The DEC-29 distance bonus is removed (P3).
    - The player gives the **requested attack bonus** `b >= 1` with the order; the intent is public at once, as today (size and group id hidden).
    - While waiting, once per `orders.plan_ticks_per_bonus = 30` ticks (P1, 3 s) the group takes **1 real charge** from the warehouse of the city it stands in; the charge is consumed and the bonus grows by 1.
    - Recharge comes first: the units recharge from the warehouse first (`supply.recharge_per_tick`), accumulation takes the next charge (P4).
    - With an empty warehouse accumulation pauses and resumes when stock arrives; there is no timeout (P2). The player may **release** the group at any moment (`ReleasePlan`): it departs at once with the bonus accumulated so far, free; a **cancel** is free and the consumed charges are lost.
    - **Cap:** as DEC-29, the bonus is at most the group's charged units.
    - The group departs by itself when the requested bonus or the cap is reached. The bonus burns in the first fight or when the order ends, as in DEC-08.
    - Accumulation works in a **province** too (item 13).
11. **Capture (DEC-38).** `capture.charge_cost = 1` in `mvp-3.toml`: a capture spends one real charge of the capturing groups, otherwise they bounce. The BAL-02 result ("the bot field polarizes") was measured under v1 supply and is re-measured under v2.
12. **Bunker (B).** A building for a **province or a city**, one per node, cost 3 charges, `bunker.build_ticks = 100`. Effect: **+1 virtual shot** to the node's defender in every fight there, and only if the defender has a charged unit (as terrain, DEC-07 rule 1). It replaces the "Defense" mode (item 5). **A bunker is destroyed when the node is captured** (the owner's decision: it does not pass to the capturer, unlike a barracks, DEC-26 item 4). Fog: visible like an enemy barracks (DEC-31: only a built one, next to an own node). **Name:** the rule is called "bunker" in the interface; section 12 "Bunker (Topic 2)" uses the word for the turtle strategy, so the code identifier is `fort` (the sim issue may change it, the rule text stays).
13. **Province warehouse (W).** A province has a warehouse of **capacity 1, always** (no command, no building). It receives charges only as the target of a line (and from groups); units recharge from it and spoils on capture apply. This **reverses DEC-23 item 2** for v2 (no warehouse, no recharge, no spoils in a province).

**Protocol, versions, bots, client**

14. **New commands:** `BuildFactory`, `DrawLine(path)`, `RemoveLine`, `BuildBunker`, `Move(planned, bonus)`, `ReleasePlan`. Under v2 the v1-only commands (item 5) give `FEATURE_DISABLED`; under v1 the new ones do. `PlayerView` carries own lines, own factories and bunkers; an enemy factory and bunker follow the DEC-31 rule; never an enemy line. Each new field has a fog test (`AGENTS.md`, 4.4). Versions: `SIM_VERSION` +1 with golden replays for v2; `PROTOCOL_VERSION` +1 with `regen`.
15. **Bots** are rewritten for v2 (factory placement, lines, payment in charges, the requested plan bonus); `smart_hoarder` stays the benchmark. The **client** gets a minimal UI first (own lines as plain segments, two-click drawing, factory and bunker marks, a number for the requested bonus; the stance chip hidden in v2); the full design comes after the function is accepted.
16. **Verification:** the smoke tournament on `mvp-3`, the 16-bot field on GitHub runners against the `mvp-2` baseline (`docs/balance/log.md`), an owner playtest, then the BAL-02 gate (#40) re-measured. The DEC-39 (#625) proposal is superseded by this block; DEC-40 (#626, retreat) is independent.

---

## 8. Roads

- **[accepted]** Roads **do not limit the number of units**. ~~They affect only the speed and volume of supply delivery.~~ **[superseded by DEC-28]**: an upgraded road speeds up units too (`[road.speed_pct]`: level 2 +15%, level 3 +30%), not only supply (DEC-28 block below, item 7).
- **[accepted]** A road can be upgraded only **inside your own territory** (both ends of the edge are yours).
- **[accepted]** A road that leads from your own city to an enemy or neutral one is a **buffer** road, nobody can upgrade it.

Consequences:

- You cannot prepare a highway for an invasion in advance: the last crossing is always the bottleneck, the same for both sides.
- After a city is captured, the edge becomes internal and can be upgraded. The rhythm of the offensive (breakthrough → pause → consolidation → next thrust) emerges by itself.
- Deduction through the fog is kept in a soft form: how many bodies the enemy has at the front is unknown, but the number of **charged** ones is limited by how many charges reach there along the roads.

### Road upgrade as a function of the city (DEC-16, #203) **[accepted]**

> **The numbers and the link to capacity are superseded by DEC-22 (#234), block below:** at most three levels, road type
> at the first upgrade, prices `2 = 3`, `3 = 4`, capacity does not depend on roads; a province cannot
> build (`NOT_CITY`). The other items of DEC-16 stand.
>
> **DEC-26 (#265), in force for any value of the flag:** the road type and the DEC-22 prices are replaced (roads
> without a type, prices `2 = 1`, `3 = 2`). Only with `city_upgrades.enabled = true` does the city's construction
> become shared by the road, the barracks and the warehouse (items 2 and 5 below: `CITY_BUSY` for any of the three);
> the other items stand.
>
> **DEC-28 (#290):** payment by the charges of the city warehouse and the condition "the city pays" **[superseded by DEC-28]**: a road is paid for in CP
> by a click on an internal road (`UpgradeRoad(edge)`, 0.5 CP per level), construction still takes
> `build.ticks_per_level`; read items 2-3 and 5 below according to the DEC-28 block (section 8).

The approach was accepted by the owner after the playtest of 2026-10-07; the numbers are defaults, they live in
the ruleset. Replaces construction by a group in the "Building" mode (DEC-08, SIM-11 below, question #124).
Reason: a group had to be switched into a separate mode and kept idle, a third mode
complicated the fight and the interface, and the price in CP was not tied to charges (section 13, item 1).

Road upgrade: a function of your own city, paid for with the charges of its warehouse. The "Building" mode
is removed: "Attack" and "Defense" remain, in a fight all charged units shoot.

1. **Command** `UpgradeRoad(node, edge)`: the city `node` raises the width of the edge `edge` by one
   level. ~~Interface: click your own city, key U, choose a road (section 18).~~ **[superseded by DEC-28]**: the command `UpgradeRoad(edge)` without a city, interface: a click on your own internal road (DEC-28 block below, item 7).
2. **Checks in order** (the first one that fires gives the rejection, the state does not change): the node does not
   exist (`NOT_FOUND_OR_HIDDEN`); the node is not yours (`NOT_OWNER`); the edge does not exist (`NOT_FOUND_OR_HIDDEN`); `node` is not an
   end of `edge` (`NOT_ADJACENT`); the edge is not internal for the player, that is buffer or foreign
   (`NOT_INTERNAL`); the width equals `max_width` (`MAX_WIDTH`); the city is not in the connected supplied
   territory of its owner, section 9 (`NOT_SUPPLIED`); the city already has a construction of any edge going
   (`CITY_BUSY`); this edge is already being built by its other end (`EDGE_BUSY`); the city warehouse has fewer than
   `build.charges_per_level[w + 1]` charges, where `w`: the current width (`NOT_ENOUGH_CHARGES`); CP
   is less than `orders.cost.build` (`NOT_ENOUGH_CP`, does not fire at value 0).
3. **Payment at the start.** The command is applied at the start of tick `t`: from the warehouse of `node` are deducted
   `build.charges_per_level[w + 1]` charges, from CP `orders.cost.build`; event `build_started`
   (player, node, edge, target width, charges). The deduction goes before the recharge of the same tick
   (`apply_commands` is before `supply`).
4. **Duration.** The width grows by 1 at tick `t + build.ticks_per_level` in the system `build`
   (event `road_upgraded`), and the construction ends. The next level: a new command and a new
   payment, there is no queue. ~~City capacity and packet speed by the new width: as in SIM-11 below.~~
   **[superseded by DEC-22]**: a new level changes only the speed and volume of supply.
5. **Simultaneity.** One construction per city, one edge is built by only one city. Different cities
   of one player build different edges at the same time, including edges with a common end (A builds
   A-B, B builds B-C). Commands of one player in one tick are checked in turn `(player, seq)`,
   so a second command on the same edge gets `EDGE_BUSY`. Players do not interfere with each other:
   an internal edge and its ends belong to one player.
6. **Interruption.** On every tick the system `build` checks that the edge is still internal for the player
   who started the construction. If not (the builder city or the other end was captured), the construction is removed:
   event `build_stopped` (`reason = "interrupted"`), the width does not change, the charges are not returned.
   The fight goes before `build`, so a capture on the completion tick cancels the upgrade. Nothing else
   interrupts the construction: not a fight in the city without a change of owner, not a loss of supply (the city is cut off
   from the capital, the edge stayed internal), not an emptied warehouse, not the movement of groups.
7. **No cancel.** The charges are spent at the start; a mistake costs no more than 5 charges and 15 seconds.
8. **Visibility.** The construction is not public: there is no public intent of a construction. A player sees their own construction
   exactly (city, edge, end tick). A player sees the enemy's construction per DEC-17 (section 10, item 5):
   the edge and the builder city, only while the edge under construction is not in the fog; in the fog the construction is not visible and
   not remembered, the player learns about the result from the width (DEC-17, items 1 and 2). The width of the edge
   with one's own group on it is visible: the group takes its edge out of the fog (DEC-10, item 5). The events
   `build_started`, `road_upgraded`, `build_stopped` go only to the owner (DEC-17, item 6).

Numbers in the ruleset (put in by the implementation, afterwards only balance changes them):
`build.ticks_per_level = 150` (unchanged, 15 s per level); ~~a new table
`build.charges_per_level` keyed by "new width": `2 = 2`, `3 = 3`, `4 = 4`, `5 = 5` (all widths
2..5 are required);~~ **[superseded by DEC-22]**: ~~`2 = 3`, `3 = 4`~~ **[superseded by DEC-26]**: `2 = 1`, `3 = 2`; `orders.cost.build = 0` (was 100; the key stays so that balance can bring back the CP
fee without code).

Why this way:
- ~~The price of a level equals the new width: the price grows while the capacity gain shrinks (+0.5 / +0.5 / +0.3 /
  +0.3, section 9), so it is better to develop all approaches, not one. Level 2 for 2 charges equals
  the former price of 1 CP at the DEC-02 rate. The whole road from 1 to 5 costs 14 charges: about 35 s of the income
  of the capital in "Balance" (2 charges per 50 ticks).~~ **[superseded by DEC-22]**
- ~~The warehouse of an ordinary city (base 3, two roads of width 1) holds 5 charges, so any level
  can be paid for; for a dead end (capacity 4) level 5 is paid for by the other end of the edge.~~ **[superseded by DEC-22]**: capacity does not depend on roads, prices and rationale: DEC-22 block.
- No CP: one currency per action, CP stay attention for troops. The fee from the warehouse competes with the
  recharge of the garrison, and the decision "build or hold charges" stays spatial
  (section 13, item 3).
- `NOT_SUPPLIED`: capacity and supply are counted only in the supplied territory, so an
  upgrade in a cut-off pocket gives nothing while it is cut off, and the warehouse of the pocket is its
  only defense. A construction already started is not interrupted by the cut-off: a blockade is often temporary, and a single
  interruption condition is simpler.
- No cancel and no refund on capture: one rule, "the construction charges are spent at the start".

Worked examples. A, B, C: own cities in the supplied territory; edge A-B is internal, width
1, `max_width` 3; `ticks_per_level` 150, prices 2 / 3 / 4 / 5. Implementation tests: exactly this table.
(The prices here are nominal: the rules of the table do not depend on prices, `test_build.py` fixes its own 3 / 4;
the actual DEC-26 prices `2 = 1`, `3 = 2` are checked by the examples of DEC-22 and DEC-26.)

| # | Situation | Outcome |
|---|---|---|
| 1 | tick 100: `UpgradeRoad(A, A-B)`, warehouse A = 5 | warehouse A = 3, `build_started`; tick 250: width 2, `road_upgraded`, no construction. **[superseded by DEC-28]**: `UpgradeRoad(A-B)`, CP -0.5, the warehouse does not change |
| 2 | same, warehouse A = 1 | `NOT_ENOUGH_CHARGES`, warehouse 1. **[superseded by DEC-28]**: CP less than 0.5: `NOT_ENOUGH_CP` |
| 3 | A-B of width 2, warehouse A = 3 | warehouse 0; after 150 ticks width 3 |
| 4 | A-B of width 3 (`max_width`) | `MAX_WIDTH` |
| 5 | edge A-N, N neutral or enemy | `NOT_INTERNAL` |
| 6 | A builds A-B; `UpgradeRoad(A, A-C)` | `CITY_BUSY`. **[superseded by DEC-28]**: accepted, both constructions run (the number of constructions is not limited) |
| 7 | A builds A-B; `UpgradeRoad(B, A-B)` | `EDGE_BUSY` (DEC-28: `UpgradeRoad(A-B)` once more) |
| 8 | A builds A-B; `UpgradeRoad(B, B-C)` | accepted, both constructions run |
| 9 | A builds A-B from tick 100; tick 200: B captured | `build_stopped` (`interrupted`), width 1, the charges were not returned |
| 10 | A builds A-B from tick 100; tick 250: A captured | the fight is before `build`: width 1, `build_stopped` |
| 11 | A builds A-B from tick 100; tick 200: A and B cut off from the capital, A-B internal | the construction runs; tick 250: width 2 |
| 12 | A is cut off from the capital at the moment of the command | `NOT_SUPPLIED`. **[superseded by DEC-28]**: accepted, there is no `NOT_SUPPLIED` for a road |
| 13 | A builds A-B; a fight in A, the defender held the city | the construction runs |
| 14 | A builds A-B; the warehouse of A emptied on recharge | the construction runs (DEC-28: the warehouse does not take part in construction) |

Replaced accepted texts (struck through, marked [superseded by DEC-16]): section 3, unit modes and
the question "Builder"; DEC-07, rule 1 (section 4); DEC-08 and the description of SIM-10 (section 5); the SIM-11 block
and question #124 below; the information ladder, item 2 (section 10; public constructions in DEC-04 are already
replaced by DEC-17); section 15, item 8; the glossary.
The DEC-07 table and `packages/protocol/vectors/combat.json` do not change: the "Building" mode is not in
them. What the implementation changes (simulation and `SIM_VERSION`, protocol and `PROTOCOL_VERSION`, client,
bots, rulesets): the list in #203.

Alternatives (not chosen):
- Keep the "Building" mode (SIM-11 and the details of #124).
- A price in CP per level instead of charges; a constant price per level.
- A cancel `CancelBuild(node)` with the charges returned to the warehouse within capacity.
- The construction visible to the enemy as a public intent (as before DEC-16 and DEC-17); a queue of several levels; construction from a
  cut-off city.

### Roads of two types, fixed capacity, a 15-minute match (DEC-22, #234) **[accepted]**

Playtest 2026-10-12: the match felt cramped, nobody upgraded roads, capacity from roads mixed supply and garrison size. The owner's decision. Replaces capacity from roads (sections 7, 9), the numbers of DEC-16 and its link to capacity, item 3 of DEC-17, the match length of DEC-03.

The capacity of a node no longer depends on roads: it is fixed by the map. Roads affect only
supply, they have up to three levels and ~~two types to choose from~~ **[superseded by DEC-26]**: there are no types. A match lasts 15 minutes. The DEC-16 model
(the city pays with warehouse charges) is kept, its numbers change. The items earlier marked
"(default)" were confirmed by the owner on 2026-10-12 (#239).

> **DEC-26 (#265, section 8 below):** the items about the road type and its prices (items 2-8 and the numbers in the ruleset)
> are replaced **for any value of the flag** and struck through. "The warehouse equals the node capacity" (item 1) is replaced only
> with `city_upgrades.enabled = true`: with `false` (the value in `mvp-0.toml`) item 1 stands as written.

1. **Capacity is fixed.** The capacity of a node: `capacity.by_kind[kind]`, where `kind`: the kind of node from the map
   (DEC-23: capital, large, medium, small city, province). It does not depend on roads, owner or
   supply, so it is public and exact for all nodes. As before, one number limits
   the standing units and, separately, the warehouse (a province has no warehouse). Death above capacity and the grace period after
   a capture are unchanged (#118). One number for the warehouse and the units: **[superseded by DEC-26 with `city_upgrades.enabled = true`]** (the warehouse separately, item 2 of DEC-26; with `false` it stands). A cut-off does not change capacity; the pressure of encirclement: starvation (DEC-19).
2. **Road: level.** Level `1..max_level`, `max_level <= 3` (a map field, DEC-23): three
   levels, that is two upgrades (owner, 2026-10-12). The level is kept across captures (nothing is demolished).
   ~~Level 1: an ordinary road without a type. The first upgrade (1 → 2) chooses the type: `fast` (fast) or
   `freight` (freight); level 3 of the same type. The type does not change.~~ **[superseded by DEC-26]**: there is no type,
   an upgrade only speeds up supply delivery (section 8, DEC-26, item 7).
3. **Command** ~~`UpgradeRoad(node, edge, kind)`~~ **[superseded by DEC-26]**: ~~`UpgradeRoad(node, edge)`~~ **[superseded by DEC-28]**: `UpgradeRoad(edge)`, rejections and payment per the DEC-28 block, item 7; the text of the item below describes the former command.
   The checks of DEC-16, item 2, in order, with changes: after `NOT_OWNER`: the node is not a city, that is
   a province (`NOT_CITY`); after `MAX_WIDTH` (the code stays, it checks `max_level`):
   ~~at level 1 the type is not set or unknown (`INVALID_ARGUMENT`), at level 2 the type is set and not equal to
   the road type (`ROAD_KIND_MISMATCH`, a new code)~~ **[superseded by DEC-26]**: the type is not set, if it is set,
   `INVALID_ARGUMENT`; there is no code `ROAD_KIND_MISMATCH`; then `NOT_SUPPLIED`, `CITY_BUSY`,
   `EDGE_BUSY`, `NOT_ENOUGH_CHARGES`, `NOT_ENOUGH_CP`, as in DEC-16. Payment at the start,
   duration, simultaneity, interruption and the absence of cancel: DEC-16, items 3-7 unchanged.
4. **Supply parameters of an edge** (DEC-18): `speed_pct` (packet speed) and `amount` (charges per
   edge per dispatch period). ~~A table by type: fast, levels 2 and 3: 150 and 200 at `amount` 1;
   freight, levels 2 and 3: 100 at `amount` 2 and 3.~~ **[superseded by DEC-26]**: there are no types, `amount`
   equals 1 at any level (the throughput does not grow):

   | Road | `speed_pct` | `amount` |
   |---|---|---|
   | level 1 | 100 | 1 |
   | level 2 | 150 | ~~1~~ 2 **[superseded by DEC-28]** |
   | level 3 | 200 | ~~1~~ 3 **[superseded by DEC-28]** |

   Packet time on an edge: `packet_ticks = max(1, travel_ticks * 100 // speed_pct)` (rounded
   down).
5. ~~**Freight road: what was sent arrives.** A packet (and a DEC-18 transfer) on a freight edge is not
   lost when the edge stops being internal for its owner: it reaches the end of the edge.
   If the node there is still yours, the packet goes on along the path or lands in the warehouse. If the node is
   captured by the enemy, the charges land in the warehouse of that node for the new owner within capacity
   (the surplus burns up), the packet's path ends; the captor gets the event `packet_captured`,
   the sender `packet_lost`. If the node is neutral or a province, the charges are lost. A packet on an
   ordinary or fast road is lost, as now.~~ **[superseded by DEC-26]**: there is no freight road,
   a packet on an edge that stopped being internal is lost (`packet_lost`) at any level; there is no event
   `packet_captured`.
6. ~~**The price of an upgrade** in warehouse charges of the builder city~~ **[superseded by DEC-28]**: 0.5 CP per level (`orders.cost.build = 50`), the province and the warehouse do not take part. The former entry (key: new level): ~~`2 = 3`, `3 = 4`~~
   **[superseded by DEC-26]**: `2 = 1`, `3 = 2` (`build.charges_per_level`);
   `build.ticks_per_level = 150` (15 s, unchanged); `orders.cost.build = 0`. The smallest city
   (capacity 4) pays for any level (with `city_upgrades.enabled = true` the warehouse is separate: DEC-26, item 7). ~~A province cannot build (it has no warehouse), so a road
   between two provinces is not upgraded (owner, 2026-10-12).~~ **[superseded by DEC-28, item 7]**: an upgrade needs no
   city, only an own internal edge that is not at its last level, with no build in progress, and the CP, so a road
   between two provinces can be upgraded.
7. **Upgrade hint** (`upgrade_gain`): ~~the gain of `speed_pct` and `amount` for each of the two
   types at level 1 and for its own type at level 2 (instead of the capacity gain)~~ **[superseded by
   DEC-26]**: only the `speed_pct` gain of the next level (`amount` does not grow).
8. **Fog** (DEC-17): the level of an edge is visible while the edge is not in the fog; in the fog the last one seen;
   an edge the player has never seen: level 1. ~~The edge type is visible the same way; never seen:
   no type.~~ **[superseded by DEC-26]**: there is no type, `Sighting.road` and the edge type in the player view are removed.
   `capacity_stale` is dropped (item 1).
9. **Match length: 15 minutes.** `match_ticks = 9000`; VP still every 300 ticks: 30 awards,
   the last one on the last tick. `test-short` unchanged (600 ticks).
10. **Movement speed by terrain** already exists (~~`terrain.entry_speed_pct`, the terrain of the entry node~~
    **[superseded by the decision of 2026-10-14, #253]**: `terrain.speed_pct` by the zones of the edge, section 4:
    plain 125, that is time ×0.8; forest 100; mountains 70, time about ×1.43). DEC-22 did not change the rule;
    the interface must show the travel time of an order. The server computes it (DEC-20, "Impact").

Numbers in the ruleset: `match_ticks = 9000`; a new section `[capacity.by_kind]`: `capital = 10`,
`city_large = 8`, `city_medium = 6`, `city_small = 4`, `province = 3`; removed are
`[capacity.width_gain_centi]` and `[supply.packet_speed_pct]`; new `supply.base_speed_pct = 100`,
`supply.base_amount = 1`, `[supply.fast_speed_pct]` `2 = 150`, `3 = 200`, ~~`[supply.freight_amount]`
`2 = 2`, `3 = 3`~~ **[superseded by DEC-26]**: there is no section `[supply.freight_amount]`; `[build.charges_per_level]`
~~`2 = 3`, `3 = 4`~~ **[superseded by DEC-26]**: `2 = 1`, `3 = 2` (keys 4 and 5 are removed);
`build.ticks_per_level = 150`, `orders.cost.build = 0` unchanged.

Worked examples (recomputed by DEC-26: roads without a type, prices `2 = 1`, `3 = 2`; rows 3-6 and
9-14 replaced; **[superseded by DEC-28]**, #306: a road is paid for in CP, `orders.cost.build = 50`, the warehouse does not
change, rows 3-6, 8, 9 and 12-14 recomputed). A, B: own cities in the supplied territory,
capacity 6; edge A-B is internal, level 1, `max_level` 3, `travel_ticks = 30`. Implementation tests:
exactly this table.

| # | Situation | Outcome |
|---|---|---|
| 1 | a medium city: own, cut off, neutral, with any roads | capacity 6 |
| 2 | the capital | capacity 10 |
| 3 | tick 100: ~~`UpgradeRoad(A, A-B)`, warehouse A 5~~ `UpgradeRoad(A-B)`, CP 1 | ~~warehouse A 4~~ CP 0.5, warehouse A does not change; tick 250: level 2; a packet takes 20 ticks (`30 * 100 // 150`) |
| 4 | ~~`UpgradeRoad(A, A-B, fast)`: the type is set~~ **[superseded by DEC-28]**: the command has neither a city nor a type | ~~`INVALID_ARGUMENT`~~ |
| 5 | A-B of level 1, ~~warehouse A 0~~ CP 0.49 | ~~`NOT_ENOUGH_CHARGES` (level 2 costs 1)~~ `NOT_ENOUGH_CP` (a level costs 0.5 CP) |
| 6 | A-B of level 2; ~~`UpgradeRoad(A, A-B)`, warehouse A 2~~ `UpgradeRoad(A-B)` | ~~warehouse 0~~ CP -0.5; after 150 ticks level 3: a packet takes 15 ticks |
| 7 | A-B of level 3 | `MAX_WIDTH` |
| 8 | ~~`UpgradeRoad(P, P-A)`~~ `UpgradeRoad(P-A)`, P an own province | ~~`NOT_CITY`~~ accepted: there is no paying city, a road at a province is upgraded too (DEC-28, item 7) |
| 9 | A-B of level 3; dispatch per period | no more than ~~1 charge~~ 3 charges along the edge per period (~~`amount` 1 at any level~~ `amount` 1 / 2 / 3 by level, DEC-28) |
| 10 | a packet of 2 charges on A-B, B captured by the enemy before arrival | the packet is lost: `packet_lost` to the sender, no `packet_captured` |
| 11 | a packet on A-B, A captured, B own | the packet is lost (`packet_lost`) |
| 12 | A-B of level 2, ~~warehouse A 1~~ warehouse A 0 | ~~`NOT_ENOUGH_CHARGES` (level 3 costs 2)~~ accepted: the warehouse does not take part (DEC-28) |
| 13 | A-B of level 1, ~~warehouse A 1~~ CP 0.5 | ~~warehouse 0~~ CP 0; after 150 ticks level 2 |
| 14 | A-B of level 2 (the construction of level 3 runs ~~at A~~); ~~`UpgradeRoad(B, A-B)`~~ `UpgradeRoad(A-B)` once more | `EDGE_BUSY` (DEC-28, item 7) |
| 15 | a match without an early victory | ends at tick 9000, 30 VP awards |

What the implementation changes (simulation and `SIM_VERSION`, protocol and `PROTOCOL_VERSION`, client, bots, rulesets): the list in #234.

Implementation: #238 (`SIM_VERSION` 5, `PROTOCOL_VERSION` 9). Before DEC-23 the MVP maps got the node kind
by the rule of `docs/design/map-format.md` ("Node kinds in the MVP maps"); the other rules of the province
(warehouse, transit, recruit) are introduced by the implementation of DEC-23. Since #366 the map field is called `max_level`
(DEC-23, item 6); the road level in the state and in `EdgeView` is still `width`, the rejection code
is `MAX_WIDTH`.

Alternatives (not chosen):
- Keep capacity from roads (section 9): it mixes two decisions, the playtest showed that roads are not upgraded.
- Capacity as a number right in the map instead of the node kind (balance would then require editing maps, not the ruleset).
- One road type with growth of both speed and volume (no choice). Later DEC-26 still removed the choice of type,
  but kept the growth of speed only.
- Four levels (three upgrades) instead of three.
- A freight road without "arrives on capture" (then the freight road is simply slower than the fast one).
- A 12-minute match (DEC-03).

### City development: barracks, warehouse separate from capacity, roads without a type (DEC-26, #265) **[accepted]**

> **[superseded by DEC-41 under `economy.model = "v2"`]**: road upgrades and the CP prices of the barracks and the warehouse upgrade (paid in charges in v2). The text below is kept and is in force for `economy.model = "v1"`.

The owner's decision of 2026-10-14 (#252). Cities stop being equal from the first second: at first only the capital
recruits, the warehouse is small and grows by upgrades, roads only speed up delivery. The barracks
block (who recruits): section 3, "Barracks (DEC-26)". The owner accepted all items (2026-10-14,
#265) with two changes: the road prices are **1 and 2** charges (the proposal had 2 and 3), and the change to
roads **always applies, not behind a flag** (the proposal had it behind a flag). The barracks and the separate warehouse
stay behind a flag. Implemented in #265 (`SIM_VERSION` 12, `PROTOCOL_VERSION` 16), the
"Implementation" block after the examples.

1. **[accepted]** **Flag** `city_upgrades.enabled` (boolean, section `[city_upgrades]` of the ruleset), to
   compare the rules in playtests. It covers **only the barracks and the warehouse separate from capacity**.
   - **`false`:** every own city recruits (DEC-01, DEC-25), the warehouse capacity equals the capacity of the
     node (DEC-22, item 1). The commands `BuildBarracks` and `UpgradeWarehouse` give `FEATURE_DISABLED`
     (a new code), the keys `[city_upgrades]` and `[warehouse]` are not read.
   - **`true`:** items 2-6 and 8-11 below and the barracks block in section 3; the DEC-22 item, item 1 ("the warehouse equals
     capacity"), and `recruit.location` do not apply.
   - **Roads (item 7) do not depend on the flag:** with any value roads are without a type and prices are `2 = 1`,
     `3 = 2`. The DEC-22 items about the road type and its prices are replaced everywhere (struck through without reservations).
   - `rulesets/mvp-0.toml` stays with `enabled = false`, for playtests of the new mode
     `rulesets/mvp-1.toml` with `true`. The change to roads changes the rules of both (`SIM_VERSION`++,
     golden replays of the new version; mvp-0 with `false` differs from the previous one only in roads).
2. **[accepted]** **The warehouse separate from unit capacity.** Unit capacity stays by node kind
   (`capacity.by_kind`, DEC-22: 10 / 8 / 6 / 4 / 3). The capacity of a city warehouse:
   `warehouse_capacity = warehouse.start_by_kind[kind] + level * warehouse.gain_per_level`,
   `level` of a city is `0..warehouse.max_level` (`warehouse.gain_per_level = 1`,
   `warehouse.max_level = 2`: two upgrades). A province has no warehouse (DEC-23).

   | Node kind | Unit capacity | Warehouse, level 0 | level 1 | level 2 |
   |---|---|---|---|---|
   | capital (`capital`) | 10 | 6 | 7 | 8 |
   | large city (`city_large`) | 8 | 2 | 3 | 4 |
   | medium city (`city_medium`) | 6 | 2 | 3 | 4 |
   | small city (`city_small`) | 4 | 1 | 2 | 3 |
   | province (`province`) | 3 | none | none | none |

3. **[accepted]** **The warehouse upgrade** is paid for in CP: the command `UpgradeWarehouse(node)`, the price
   `orders.cost.warehouse` for each of the two levels (in hundredths of CP): `200` (2 CP), one price for both
   levels, time `city_upgrades.warehouse_ticks = 100` (10 s, as for the barracks).
   Payment at the start of the construction (as DEC-16, item 3), there is no cancel and no refund.
4. **[accepted]** **Capture.** The barracks and the warehouse level pass to the new owner. The warehouse is still
   zeroed on a change of owner (section 9, SIM-07: `warehouse_lost`), so on a capture
   there is no "surplus over capacity". A neutral city has no levels (no barracks, warehouse
   of level 0): only the owner upgrades.
5. **[accepted]** **Match start.** The warehouse of a city at the start: `min(start_stock, warehouse_capacity)`
   (the surplus is discarded without an event). The map validator check `warehouse`: `start_stock` is not
   greater than `warehouse.start_by_kind[kind]` (it runs with the ruleset, `gow-maps validate --ruleset`).
   The MVP maps pass it: small cities have `start_stock = 1` (`artery` and `web` were fixed in #379, before that
   small cities had 2 with a starting warehouse of 1), the check is part of `mise run maps:validate`.
6. **[accepted]** **Where the warehouse capacity works** (in all places where "capacity" used to stand for a
   charge): the target stock of a city `min(warehouse_capacity, discharged + supply.buffer)` and the "free
   room" on dispatch (DEC-18, items 2 and 4); the surplus on delivery of a packet and of a transfer burns up
   (`charges_overflow`, DEC-18, items 5 and 6); a packet that arrived in a province is lost, as before.
   Unit capacity (death above capacity #118, stack limit DEC-20, `CITY_FULL`, the DEC-25 queue) does not
   change.
7. **[accepted]** **Roads without a type and cheaper, with any value of the flag.** A road upgrade only
   speeds up supply delivery; the type is not chosen at the first upgrade, there is no "freight" road.
   Replaces DEC-22, items 2-8 (types and prices) for all rulesets.
   - The command `UpgradeRoad(node, edge)` without `kind`; if `kind` is set, `INVALID_ARGUMENT` (in place of
     the DEC-22 type check, after `MAX_WIDTH`). There are no `ROAD_KIND_MISMATCH` rejections, there is no edge type
     (`Edge.road` and `Sighting.road` are removed).
   - Packet speed: `supply.fast_speed_pct[level]` for all upgraded roads (level 2: 150,
     level 3: 200), time `max(1, travel_ticks * 100 // speed_pct)`. ~~The volume `amount` at any
     level is `supply.base_amount = 1` (a consequence of the decision: the throughput does not grow);~~
     **[superseded by DEC-28]**: `amount` 1 / 2 / 3 by road level; `supply.freight_amount` is removed.
   - The rule "a packet on a freight road arrives on capture" (DEC-22, item 5) does not apply: a packet on an
     edge that became non-internal is lost (`packet_lost`); there is no event `packet_captured`.
   - ~~Road prices in warehouse charges of the builder city~~ **[superseded by DEC-28]**: a road is paid for in CP (DEC-28 block). The former entry (key: new level):
     `build.charges_per_level`: `2 = 1`, `3 = 2` (was 3 and 4; the owner lowered the proposed 2 and 3);
     `build.ticks_per_level = 150` and `orders.cost.build = 0` unchanged. There is no separate key
     `city_upgrades.road_charges`. A consequence with `city_upgrades.enabled = true`: the starting warehouse
     of a medium and a large city is 2, of a small one 1, so they pay for both levels (1 and 2 charges),
     a small city without a warehouse upgrade only level 2; level 3 for it is paid by the other end of the edge
     or by itself after a warehouse upgrade. With `false` the warehouse equals capacity (at least 4), any city
     pays for any level.
8. **[accepted]** **One construction per city, shared (with `enabled = true`):** ~~road,~~ the barracks and the warehouse occupy the same
   construction of the city (**[superseded by DEC-28]**: a road is built on an edge for CP and does not occupy the city's construction); while it runs, any of the three commands gives `CITY_BUSY`. Interruption, as DEC-16,
   item 6: a capture of the city (or of the other end of the edge for a road) removes the construction, `build_stopped`
   (`reason = "interrupted"`), the charges and CP are not returned. Neither a fight without a change of owner nor a loss of
   supply interrupts the construction. There is no cancel. The barracks and the warehouse do not require a supplied territory
   (`NOT_SUPPLIED` is only for a road, DEC-16).
9. **[accepted]** **Commands and rejections** (in order of checking; on a rejection the state does not change):

   | Command | Checks |
   |---|---|
   | `BuildBarracks(node)` | `FEATURE_DISABLED`; `NOT_FOUND_OR_HIDDEN`; `NOT_OWNER`; `NOT_CITY` (province); `ALREADY_BUILT` (there is a barracks, including the capital); `CITY_BUSY`; `NOT_ENOUGH_CP` (less than `orders.cost.barracks`, 300) |
   | `UpgradeWarehouse(node)` | `FEATURE_DISABLED`; `NOT_FOUND_OR_HIDDEN`; `NOT_OWNER`; `NOT_CITY`; `WAREHOUSE_MAX` (the level equals `warehouse.max_level`); `CITY_BUSY`; `NOT_ENOUGH_CP` |
   | ~~`UpgradeRoad(node, edge)`~~ `UpgradeRoad(edge)` | ~~the checks of DEC-16, item 2 unchanged, except the type: `INVALID_ARGUMENT` when `kind` is set (after `MAX_WIDTH`); prices `build.charges_per_level` (`2 = 1`, `3 = 2`); with any value of the flag~~ **[superseded by DEC-28]**: `NOT_FOUND_OR_HIDDEN`, `NOT_INTERNAL`, `MAX_WIDTH`, `EDGE_BUSY`, `NOT_ENOUGH_CP` (DEC-28, item 7) |
   | `Recruit(node)` | section 3, "Barracks (DEC-26)": a new code `NO_BARRACKS` |

   New codes: `FEATURE_DISABLED`, `ALREADY_BUILT`, `WAREHOUSE_MAX`, `NO_BARRACKS`
   (`ROAD_KIND_MISMATCH` is removed). The start event `build_started` gets the field `kind`
   (`road` | `barracks` | `warehouse`); new events
   `barracks_built`, `warehouse_upgraded` (node, new level); `road_upgraded` as before.
   All to the owner only.
10. **[accepted]** **Player view.** For an own city in `NodeView`: `has_barracks` (boolean),
    `warehouse_level`, `warehouse_cap` (warehouse capacity), `building` (`kind` and ticks to the end
    of the current construction, like one's own road construction). For foreign and neutral nodes all these fields are `None`:
    the barracks and the warehouse level are hidden in the fog (AGENTS.md, 4.4; only the unit capacity by
    node kind is public). **[superseded by DEC-31]**: `has_barracks` of a foreign city adjacent to your own node is visible (section 10, DEC-31 block); the other fields stay `None`. A fog test for every field. Events go to the owner only. The ruleset fields for the client (prices, flag,
    warehouse tables) go into `ruleset_public`.
11. **[accepted]** **Bots.** They do not issue `Recruit` in a city without `has_barracks`; they handle
    `NO_BARRACKS`, `CITY_BUSY`, `FEATURE_DISABLED`; they build a barracks in a city at the front or in a
    developed rear, upgrade the warehouse in cities that supply troops; they compare the barracks price (3 CP)
    with the recruit queue; they call `UpgradeRoad` without a type (with any value of the flag). With `enabled = false` there are no barracks and warehouse in the behavior.

Numbers in the ruleset. A new section `[city_upgrades]` (except `enabled` it is read only with `enabled = true`):
`enabled = false`, `barracks_ticks = 100`, `warehouse_ticks = 100`; section `[warehouse]`:
`gain_per_level = 1`, `max_level = 2`, `[warehouse.start_by_kind]` `capital = 6`, `city_large = 2`,
`city_medium = 2`, `city_small = 1`; `orders.cost.barracks = 300`, `orders.cost.warehouse = 200`.
For roads, with any value of the flag: `[build.charges_per_level]` `2 = 1`, `3 = 2`;
`[supply.freight_amount]` is removed (`supply.base_amount = 1` at any level).

Worked examples (`city_upgrades.enabled = true`, except rows 13-15, 22 and 23, numbers above). A, B: own
cities in the supplied territory, A is medium (warehouse of level 0, capacity 2), K is the capital; edge A-B
is internal, level 1, `max_level` 3, `travel_ticks = 30`; CP regeneration is not counted. Implementation
tests: exactly this table.

| # | Situation | Outcome |
|---|---|---|
| 1 | warehouse capacity by kind and level | the table of item 2: capital 6 / 7 / 8, large and medium 2 / 3 / 4, small 1 / 2 / 3 |
| 2 | `Recruit(A)`, A has no barracks | `NO_BARRACKS` |
| 3 | `BuildBarracks(A)` at tick 1000, CP 500 | CP 200, `build_started`; the barracks at tick 1100 (`barracks_built`); `Recruit(A)` at tick 1100 gives `NO_BARRACKS` (`apply_commands` is before `build`), at tick 1101 it is accepted |
| 4 | `BuildBarracks(K)`, K is the capital | `ALREADY_BUILT` |
| 5 | `BuildBarracks(A)`, CP 200 | `NOT_ENOUGH_CP` (200 < 300) |
| 6 | `BuildBarracks(P)`, P is a province | `NOT_CITY` |
| 7 | `UpgradeWarehouse(A)` at tick 1000, CP 500 | CP 300; at tick 1100 level 1, warehouse capacity 3 |
| 8 | as 7, a second `UpgradeWarehouse(A)` at tick 1101 | CP 100; at tick 1201 level 2, capacity 4; the third: `WAREHOUSE_MAX` |
| 9 | at tick 1050 during the barracks construction: `UpgradeWarehouse(A)` or ~~`UpgradeRoad(A, A-B)`~~ | `CITY_BUSY`; **[superseded by DEC-28]**: `UpgradeRoad(A-B)` is accepted (a road does not occupy the city's construction) |
| 10 | A: warehouse of level 1 (capacity 3), warehouse 3; warehouse B 2 (full: A forwards nothing, ~~the DEC-18 reserve #287~~ there is no deficit, DEC-28); ~~`UpgradeRoad(A, A-B)`~~ `UpgradeRoad(A-B)` at tick 1000 | ~~warehouse 2 (the price of level 2: 1 charge)~~ **[superseded by DEC-28]**: CP -0.5, warehouse 3; at tick 1150 level 2; a packet takes `30 * 100 // 150 = 20` ticks |
| 11 | as 10, the second upgrade (tick 1151)~~, warehouse A 2~~ | ~~warehouse 0 (the price of level 3: 2 charges)~~ **[superseded by DEC-28]**: CP -0.5, warehouse 3; level 3 at tick 1301; a packet takes `30 * 100 // 200 = 15` ticks |
| 12 | A of level 0, warehouse 1, the edge of level 2; ~~`UpgradeRoad(A, A-B)`~~ `UpgradeRoad(A-B)` | ~~`NOT_ENOUGH_CHARGES` (level 3 costs 2, the warehouse has 1); B can upgrade~~ **[superseded by DEC-28]**: accepted, the warehouse does not take part |
| 13 | ~~`UpgradeRoad(A, A-B, fast)` (with any value of the flag)~~ **[superseded by DEC-28]**: the command has no type | ~~`INVALID_ARGUMENT` (the type is not set)~~ |
| 14 | edge A-B of level 3: volume (with any value of the flag) | ~~`amount = 1`~~ **[superseded by DEC-28]**: `amount = 3` per dispatch period (there is no freight road) |
| 15 | a packet of 2 charges on A-B, B captured before arrival (with any value of the flag) | the packet is lost (`packet_lost`); no `packet_captured` |
| 16 | B is medium: barracks, warehouse of level 2 (capacity 4), warehouse 3; captured by the enemy | for the new owner: barracks, level 2, capacity 4, warehouse 0 (`warehouse_lost` to the previous one); the recruit queue is gone (DEC-25, item 10); `Recruit(B)` is allowed for them at once |
| 17 | `UpgradeWarehouse(A)` at tick 1000, A captured at tick 1050 | `build_stopped` (`interrupted`), CP are not returned, level 0 |
| 18 | a small city S, warehouse 0, capacity 1; a packet of 2 charges arrived | warehouse 1, one charge burns up (`charges_overflow`) |
| 19 | ~~S, 3 discharged units stand, `supply.buffer = 2`~~ **[superseded by DEC-28]** | ~~target stock `min(1, 3 + 2) = 1`~~ the target of a rear city `min(rear_min, 1)`: at `rear_min = 1` it equals 1 |
| 20 | start: S, `start_stock = 2` | warehouse 1; the validator with the ruleset: `FAIL [warehouse]` |
| 21 | `Transfer(A, B, 3)`, B medium of level 0, warehouse B 1 | ~~B gets 1, two burn up (`charges_overflow`)~~ **[superseded by DEC-18, #287]**: the volume is cut to the free room of B: 1; B gets 1, warehouse A 2, nothing burns up |
| 22 | `city_upgrades.enabled = false`: `BuildBarracks(A)`; `Recruit(A)`; the warehouse of a medium city and of the capital | `FEATURE_DISABLED`; recruiting is allowed; warehouse capacity 6 and 10 (as DEC-22) |
| 23 | `enabled = false`, A is medium (warehouse 6), A-B of level 1; ~~`UpgradeRoad(A, A-B)`~~ `UpgradeRoad(A-B)` at tick 1000, warehouse A 6 | ~~warehouse 5 (roads without a type and cheaper with any flag)~~ **[superseded by DEC-28]**: CP -0.5, warehouse 6 (roads for CP with any flag); at tick 1150 level 2 |

What the implementation changes (simulation and `SIM_VERSION`, protocol and `PROTOCOL_VERSION`, client, bots,
rulesets, maps, validator): the state `Node.has_barracks`, `Node.warehouse_level`, the shared construction
of a city; the commands `BuildBarracks`, `UpgradeWarehouse`, `UpgradeRoad` without a type (removed are `kind`,
`RoadType`, `ROAD_KIND_MISMATCH`, the edge type in `PlayerView`, the key `r` in replay frames
`docs/design/replay-frames.md`, `supply.freight_amount`); the codes and events above; `NodeView`; the client
(city menu: barracks, warehouse, roads without a type; warehouse capacity in the tooltip); bots;
`rulesets/mvp-0.toml` (flag `false`) and a new `mvp-1.toml` (`true`), both with road prices `2 = 1`,
`3 = 2`; maps (`start_stock`); golden replays of the new version for both rulesets (the change to roads
always applies).

**Implementation** (#265; `SIM_VERSION` 12, `PROTOCOL_VERSION` 16; golden replays `v12` on `mvp-0`,
`test-short` and `mvp-1`):

- The state of a city: `Node.has_barracks`, `Node.warehouse_level`; the construction of a city `Node.build` is shared,
  `Build.kind`: `road` | `barracks` | `warehouse` (for a barracks and a warehouse `edge` is empty). Warehouse
  capacity: `capacity.warehouse_capacity`; the supply target `supply.target_stock`.
- **[proposed]** Without the flag `Node.has_barracks` is true for every city (every city
  recruits, DEC-01), and `NodeView.has_barracks`, `warehouse_level` (0), `warehouse_cap` (node
  capacity), `building` are shown to own cities with any flag: the client and bots read one field.
- **[proposed]** The keys `[city_upgrades]` and `[warehouse]` are required in every ruleset and go into
  `ruleset_hash` with any flag; with `false` they do not apply (item 1: "are not read" is understood as "are not
  applied").
- **[proposed]** `UpgradeRoad` on the wire and in the replay log keeps the optional field `kind`
  (`fast` | `freight` of old clients): when set, it gives `INVALID_ARGUMENT` (item 7), not a message
  parse error.
- Events: `build_started` gets `kind` (for a road also `edge`, `width`, `charges`, the field `road`
  is removed; for a warehouse `level`), `build_stopped` gets `kind`, `road_upgraded` without `road`;
  `barracks_built`, `warehouse_upgraded` (`level`) to the owner only; `packet_captured` is removed.
- Replay frames: there is no key `r`, `b` only for road constructions (`replay-frames.md`).
- Validator: the check `warehouse` only with a `--ruleset` whose flag is on. **The maps were not
  edited** (a question to the owner): `artery` and `web` do not pass it (small cities with
  `start_stock = 2`), with `mvp-1` their warehouse is cut to 1 at the start, `mvp-0` does not change.
- Bots (item 11): `Bot.development` builds a barracks in its own city that is two roads closer to the
  enemy capital than any barracks (the price of 3 CP instead of three recruits in the capital), and expands the full
  warehouse of a city with troops or at the front, only with CP at the ceiling; `Recruit` only where `has_barracks`.
  The attacking bots (rusher, strangler, reactive) spend CP on orders and rarely get to a barracks.
- Client: the city menu with the flag: "Recruit", "Cancel recruit", ~~"Roads"~~ **[superseded by DEC-28, #311]**
  (a road is upgraded by a click on it), "Barracks", "Warehouse";
  the choice of road type and the freight lanes are removed, an upgraded road is drawn with chevrons.
  ~~"Recruit" is always there, grey without a barracks~~ **[superseded by #315]**: in a city without a barracks
  (`has_barracks = false` with `city_upgrades.enabled`) there is no "Recruit" sector at all; with an unknown
  `has_barracks` (`null`) and with the flag off the sector is there.

Alternatives (not chosen):
- **A warehouse upgrade only when the warehouse is full, spending those charges** (in the game "the charges are invested in the
  warehouse"; needs no CP, but competes with the recharge of the garrison; the owner chose payment in CP).
- A flag without roads (roads stay of two types with `enabled = true`): simpler, but leaves the
  freight road, which the owner decided to remove. ~~Roads behind a flag (proposed)~~ **[superseded]**:
  the owner decided that roads change for all rulesets, the flag is only for the barracks and the warehouse.
- Road prices 2 and 3 (the proposal): the warehouse and roads are tied too rigidly (a small city with a warehouse of 1 would
  pay for no level, a medium one would not pay for level 3); the owner chose 1 and 2.
- Warehouse capacity equal to unit capacity (as DEC-22): the warehouse of the capital 10 and of a small city 4.
- A barracks in every city from the first second (DEC-01): all cities are equal.

### Rework of supply and roads (DEC-28, #290) **[accepted]**

> **[superseded by DEC-41 under `economy.model = "v2"`]**: front markers, `rear_min`, donors, the delivery passes and the road payment in CP (road upgrades are removed). The text below is kept and is in force for `economy.model = "v1"`.

The owner's decision of 2026-10-17. Replaces the three priority levels and the delivery order of DEC-18 (section 7, items 1, 2, 4), the payment for a road with the charges of the city warehouse (DEC-16, DEC-26, item 7), the throughput of 1 at any level (DEC-22, item 4; DEC-26, item 7) and the burning of a capital charge above capacity (section 6). What stays: the supply tree as a distance metric (DEC-18, item 3), the one-off transfer (DEC-18, items 6 and 10), starvation in encirclement (DEC-19), provinces as transit. What the implementation changes in code, rulesets and protocol: #292 (sim, protocol, bots), #293 (client). The details the owner did not fix were marked [proposed]; the owner confirmed all of them on 2026-10-17, they are [accepted] (confirmed by the owner on 2026-10-17).

**The owner's decisions [accepted]**

1. **Transit.** A packet goes through own cities as through provinces, straight to the city with a deficit, and does not touch the warehouse of intermediate cities. The free room (`warehouse capacity - stock - in transit`) is checked only at the destination. The throughput of the edges of the path (item 7 below) works as before. This removes the slow relay through warehouses of capacity 1 (DEC-18, example 27).
2. **Two front markers instead of three priorities.** A player has two markers. Moving a marker is free (`orders.cost.front = 0`). A city with a marker fills its warehouse to full (target = `warehouse_capacity`). If a city with a marker is lost, the marker itself retreats to the nearest own city toward the capital (farther from the enemy); only the player moves a marker forward. There are no priority levels and no command `SetPriority`; the key `supply.buffer` (the target "discharged + 2") is removed.
3. **Rear minimum.** One setting per player: cities without a marker hold at least `rear_min` charges (the target of a rear city is `min(rear_min, warehouse_capacity)`). **[accepted]** (confirmed by the owner on 2026-10-17) The default is 1 (`supply.rear_min_default = 1`), the range is `0..supply.rear_min_max` (the maximum warehouse capacity by the ruleset, 8 for `mvp-1`: the capital with two upgrades), changing it is free (`orders.cost.rear_min = 0`), the command `SetRearMin(n)`.
4. **Delivery order** (once per `supply.dispatch_ticks`, recomputed at every dispatch, so a change of marker works at once):
   1. Cities with a marker, up to a full warehouse. **[accepted]** (confirmed by the owner on 2026-10-17) Between two markers the city with fewer charges in the warehouse goes first, on a tie the smaller `node_key(player, node)` (like equal priority in DEC-18).
   2. Rear cities up to `rear_min`: from the farthest from the capital to the nearest. Distance: the sum of `packet_ticks` along the fastest path over own internal edges (the tree metric, DEC-18, item 3); on a tie the smaller `node_key` (AGENTS.md, 4.1, rule 6).
   3. The remaining stock stays in the capital.
   4. The capital is full: the surplus spreads ~~over the rear cities~~ **[refined by the owner's decision of 2026-10-20, #309]**: first over cities with a marker that have free room (order as in item 4.1), then over rear cities that have free room (`warehouse capacity - stock - in transit`), from the nearest to the capital to the farthest, on equal distance the smaller `node_key`. A charge burns up (`charges_overflow`) only when all warehouses of the player are full. The production charges that did not fit into the capital go into pass 4 of the same tick; **[accepted]** (confirmed by the owner on 2026-10-17) the remainder above the throughput of the edges burns up (a rare case: the capital produces up to 2 charges per 50 ticks, dispatch once per 10 ticks).
5. **Donors.** A deficit (`target - stock - in transit`) is covered by the nearest donor with a stock above **its own** target (distance as in item 4, on a tie the smaller `node_key` of the donor); if the donor did not cover the deficit, the next one is taken (**[accepted]** (the owner's decision of 2026-10-20, #309) a donor's path that runs into an exhausted throughput may go by a detour: "Supply implementation", "Detour around a busy road"). The donor's target: a city with a marker: a full warehouse; a rear city: `min(rear_min, warehouse_capacity)`; the capital: **[accepted]** (confirmed by the owner on 2026-10-17) 0 (its whole stock is a donor stock; with a marker on the capital: a full warehouse). A donor never gives below its target, so charges are not driven back and forth. A consequence: after a marker is moved, the former front city with a full warehouse (its target dropped to the minimum) feeds the new one (example 2).
6. **One-off transfer** (DEC-18, items 6 and 10) stays: free, it ignores the minimum and targets, shares the `amount` of the edge with the automation. The automation may then return the charges if the sender has a deficit and the receiver became a donor (example 7); to keep the stock, place a marker.
7. **Roads for CP.** An upgrade is paid for in CP by a click on an internal road: `UpgradeRoad(edge)` without a city; the price per level is 0.5 CP (`orders.cost.build = 50` in hundredths of CP), payment at the start, no refund, the construction takes `build.ticks_per_level = 150` ticks. Warehouse charges are not deducted, the key `build.charges_per_level` and the condition "the city warehouse paid" are removed. For each level above the first:
   - **unit speed +15%:** the road multiplier multiplies the terrain speed (like `terrain.speed_pct`, section 4): `[road.speed_pct]` `2 = 115`, `3 = 130` (level 1: 100), the effective speed `terrain_pct * road_pct // 100` (rounded down), the time `travel_ticks * 100 // effective speed`;
   - **supply throughput +1:** `[supply.amount_by_level]` `1 = 1`, `2 = 2`, `3 = 3` charges per dispatch period along the edge (replaces `supply.base_amount`);
   - packet speed as before: `supply.fast_speed_pct` `2 = 150`, `3 = 200` (at the start, for balance tuning).

   **[accepted]** (confirmed by the owner on 2026-10-17) Command details: rejections in order `NOT_FOUND_OR_HIDDEN` (there is no edge or it is not visible), `NOT_INTERNAL` (the edge is not internal for the player), `MAX_WIDTH`, `EDGE_BUSY` (a construction already runs on the edge), `NOT_ENOUGH_CP`; there is no `NOT_SUPPLIED` and `CITY_BUSY` for a road (there is no paying city), the number of simultaneous constructions is not limited. A capture of either end of the edge removes the construction (`build_stopped`, `reason = "interrupted"`), CP are not returned (as DEC-16, item 6). The travel time of units is computed when they step onto the edge and does not change afterwards (like packet time); the road level affects the units of any player, like terrain.
8. **The map mode "Supply"** (client, there is no game logic in it; the specification for the client task #293). A separate minimalist layer instead of a drawing over the ordinary map:
   - shows: a flat fill of the territory (the player's color plus an outline), the filling of warehouses (filled and empty dots), the two front markers, flow arrows with the volume (the number of charges), the road level by line width, cut-off cities with a starvation timer (`starve_in`, DEC-19), packets in transit;
   - does not show: the terrain background, own units, fight arenas; the enemy only by territory and presence (no warehouses, packets, markers: DEC-04, DEC-17);
   - markers are moved by a click on your own city; the rear minimum is set by a slider; the state is not conveyed by color alone (AGENTS.md, 7.4).
9. **Accumulation: edge cases** (below, a separate section).

**What is computed and where.** The tree, distances, targets, deficits, order and donors are computed by the simulation (`gow_sim.systems.supply`); the client shows markers, flows and packets from the player view. New fields of the player view (markers, `rear_min`) only with a fog test; the enemy's markers and minimum are not visible. `SIM_VERSION`++ and `PROTOCOL_VERSION`++ are done by the implementation.

**Ruleset keys (written by the implementation, #292).** Add: `supply.rear_min_default = 1`, `supply.rear_min_max = 8` (both **[accepted]** (confirmed by the owner on 2026-10-17)), `[supply.amount_by_level]` `1 = 1`, `2 = 2`, `3 = 3`, `[road.speed_pct]` `2 = 115`, `3 = 130`, `orders.cost.front = 0`, `orders.cost.rear_min = 0`; change `orders.cost.build = 50`. Remove: `supply.buffer`, `supply.base_amount`, `[build.charges_per_level]`, `orders.cost.priority`. Unchanged: `supply.dispatch_ticks`, `supply.recharge_per_tick`, `supply.base_speed_pct`, `[supply.fast_speed_pct]`, `build.ticks_per_level`. **[proposed]** (#306) The number of front markers is also a rule number (AGENTS.md, 4.1, rule 7): `supply.front_markers = 2` (it was the constant `FRONT_MARKERS` in the code), the client reads it from `ruleset_public.supply.front_markers`. Roads implementation (#306): a section `[road]` with the table `speed_pct` (keys 2..3; level 1 is always 100), `[supply.amount_by_level]` with keys 1..3.

**Examples.** Unless said otherwise: `mvp-1`, the capital's warehouse K 6, cities A, B, C of 2 each (warehouse capacity), `packet_ticks` 30 per edge, `rear_min = 1`, no markers, `amount` 1, one chain K-A-B-C.

| # | State | Result |
|---|---|---|
| 1 | chain K-A-B, warehouse A 1, warehouse B 2; a marker on B; warehouses K 6, A 1, B 0 | A holds the minimum 1 and is not a donor (target 1, warehouse 1). Dispatch tick `t`: deficit of B 2; donor K: packet K-A-B 1, warehouse A does not change (transit), arrives at `t + 60`. Tick `t + 10`: deficit of B `2 - 0 - 1 = 1`: a second packet, arrives at `t + 70`. B is full at `t + 70`, A is 1 all the time (before, the packet stopped in A of capacity 1) |
| 2 | a marker on B; warehouses K 3, A 1, B 2, C 1 | the player moves the marker from B to C (0 CP). Targets: A 1, B 1, C 2; deficit of C 1. Donors: B (warehouse 2, target 1, distance 30 ticks), K (warehouse 3, target 0, 90 ticks): the nearest, B, gives 1: C is full at `t + 30`, B 1, K sends nothing |
| 3 | no markers, `rear_min = 2`; warehouses K 5, A 0, B 0, C 0 | order: C (the farthest), B, A. Dispatches over 5 periods (`amount` 1, one edge K-A): C, C, B, B, A. Result C 2, B 2, A 1, K 0 |
| 4 | no markers; warehouses K 6 (full), A 1, B 1, C 1; the capital produces a charge | pass 4: the nearest rear city with free room is A (room 1): packet K-A 1. The next charge: A, counting "in transit", is full, B goes, then C. When K, A, B, C are full: the charge burns up (`charges_overflow`) |
| 5 | chain K-A-B, no markers; warehouses K 0, A 2, B 0 | target A 1, B 1: deficit of B 1; donor A (2 > 1) gives 1: A 1, B 1. A does not take it back: B is not above its target |
| 6 | chain K-A-B, a marker on B, `rear_min = 0`; warehouses K 0, A 2, B 0 | target A 0: A is a donor with its whole stock of 2; B gets 2 (one per period) |
| 7 | chain K-A-B, `rear_min = 1`; warehouses K 0, A 1, B 1; `Transfer(A, B, 1)` | the transfer is allowed (the minimum is ignored): A 0, B 2. The next dispatch: deficit of A 1, the nearest donor B (2 > 1): the charge comes back. With a marker on B the transfer stays |
| 8 | markers on B and C; C captured | the marker of C retreats to the nearest own city in the rear: B already has a marker, so [accepted] to A (no more than one marker per city) |
| 9 | city D is cut off from the capital (no path over own internal edges) | D does not take part in supply: does not receive, does not give, starvation by DEC-19 |
| 10 | road A-B of level 1 -> 3 in two upgrades | cost 2 x 0.5 = 1 CP, each level is built in 150 ticks; units in a forest (100 %): `travel_ticks 60` -> level 2: `60 * 100 // 115 = 52`, level 3: `60 * 100 // 130 = 46`; on a plain (125 %): `125 * 130 // 100 = 162`, `60 * 100 // 162 = 37`; `amount` 3 per period |
| 11 | mountains (70 %), a road of level 2, `travel_ticks 60` | effective speed `70 * 115 // 100 = 80`, time `60 * 100 // 80 = 75` (without the road `60 * 100 // 70 = 85`) |
| 12 | **[accepted]** (the owner's decision of 2026-10-20, #309) a ring K-A-B and K-E-B (E: a medium city), all roads of level 1 at 30 ticks; a marker on B; warehouses K 6, A 1, E 1, B 0 | deficit of B 2, donor K. The fastest path K-A-B (60 ticks; on equal time the smaller `node_key`: A before E) passes 1 charge; the second charge goes by the detour K-E-B (60 ticks, no more than `60 + 10`): two packets at tick `t`, both arrive at `t + 60`. If E-B is 50 ticks, the detour K-E-B of 80 ticks is more than `60 + 10`: the second charge waits and leaves by K-A-B at `t + 10`, arrival `t + 70` |
| 13 | **[accepted]** (the owner's decision of 2026-10-20, #309) a marker on C; B captured (C is cut off), then C captured | C has no own neighbor in the supply tree: the marker is removed (`front_set`, `node = null`, `reason = "fallback"`); it does not jump to the capital |
| 14 | **[accepted]** (the owner's decision of 2026-10-20, #309) markers on K and B; warehouses K 6 (full), A 1, B 0, C 1; the capital produces a charge | K with a marker is not a donor (target 6), A and C are at the minimum: pass 4.1 sends nothing. Surplus 1: the room in K was not freed by a dispatch, the first city with a marker that has free room: B (room 2): packet K-A-B 1 (before: to the rear city A) |

#### Accumulation: edge cases

A player's storage: the sum of the capacities of the warehouses of all own cities plus charged units (a unit's charge lives in the unit). Everything that does not fit burns up (`charges_overflow`), and this is the only "ceiling" of accumulation.

- **Warehouses are the storage, it can be bought.** In `mvp-1` the warehouses are 6 for the capital, 2 for large and medium cities, 1 for small ones; a warehouse level gives +1 for 2 CP (`orders.cost.warehouse = 200`, DEC-26). Example: the capital and four cities 2 + 2 + 2 + 1 hold 13 charges plus garrisons; two upgrades add 2.
- **The surplus at the capital is a target for a deep strike.** When the capital is full, the stock spreads over the rear cities nearest to it (item 4.4). An enemy that captures such a city zeroes the warehouse (DEC-26, item 4: `warehouse_lost`), so hoarding at the capital is risky; the player who did not fight and hoarded pays for it.
- **A high global minimum is a deliberate choice.** At `rear_min = 3` every rear city holds up to 3 charges, less stock stays in the capital, but the front is still served first (item 4.1): the minimum reduces the capital's stock and the durability of the rear, not the supply of the front. Example: the warehouse of a rear city is 2 at `rear_min = 3`: the target is `min(3, 2) = 2`, the minimum does not raise it above the warehouse.
- **Loss of territory shrinks the storage.** A capture of two cities of 2 each reduces the storage by 4 (a captured warehouse is zeroed), and the surplus burns up earlier: with full warehouses all the capital's production burns up.
- **A quiet phase is not a problem.** Accumulation without fights runs into the storage and the burning (above), and the match timer of 15 minutes and VP (section 11) force the trailing side to act. There is no additional tax on hoarding.

**Supply implementation** (#292; `SIM_VERSION` 14, `PROTOCOL_VERSION` 17; roads item 7 and the answers of #309: #306,
`SIM_VERSION` 15, `PROTOCOL_VERSION` 18; client: #293, #311).
`gow_sim.systems.supply` (`city_target`, `front_fallback`, passes 4.1, 4.2, 4.4 and donors in
`_dispatch`), the commands `SetFront(marker, node)` and `SetRearMin(n)` in `gow_sim.commands`, the state
`PlayerState.fronts` and `PlayerState.rear_min`, the player view `SelfView.fronts` and `SelfView.rear_min`
(own only; a fog test), `ruleset_public.supply` (`rear_min_max`, `rear_min_default`,
`front_markers`), table tests `packages/sim/tests/test_dec28.py` (examples 1-12). The implementation
details that the decision did not set; the questions of #309, the owner answered on 2026-10-20:
- **[accepted]** (the owner's decision of 2026-10-20, #309) `SetFront(marker, node)`: `marker` from 0 to
  `supply.front_markers - 1`; `node = null` removes the marker from the map. Rejections in order:
  `INVALID_ARGUMENT` (the marker number), `NOT_FOUND_OR_HIDDEN`, `NOT_OWNER`, `NOT_CITY` (province),
  `NO_CHANGE` (the marker is already there or already removed), `INVALID_ARGUMENT` (the city has another marker, example 8),
  `NOT_ENOUGH_CP`. `SetRearMin(n)`: `INVALID_ARGUMENT` outside `0..supply.rear_min_max`, `NO_CHANGE`,
  `NOT_ENOUGH_CP`. The events `front_set` (`marker`, `node`, `reason`: `command` or `fallback`) and
  `rear_min_set` are received only by the owner.
- **[accepted]** (the owner's decision of 2026-10-20, #309) The retreat of a marker (item 2): to the first own city
  on the fastest path from the lost city to the capital along the supply tree (the exit from the lost
  city through an own neighbor with the smallest `distance + packet_ticks`, on a tie the smaller
  `node_key`), skipping the city of another marker. If the lost city has no own neighbor in the
  supply tree (encirclement, a cut-off pocket), the marker is **removed** (there is no jump to the capital).
  Markers retreat in the order of their number. The retreat is computed at the start of the system `supply` of the same tick.
- The path of an automation packet: as for a transfer (the fastest by `packet_ticks`, on a tie the
  lexicographically smaller sequence of `node_key`).
- **[accepted]** (the owner's decision of 2026-10-20, #309) The capital's surplus (item 4.4): the economy puts into the
  capital what fits, and passes the rest to `supply` of the same tick in the field `spill` of the event
  `charges_produced` (`charges`: everything produced). The surplus first takes the room that was freed in
  this tick by a dispatch from the capital (passes 4.1, 4.2 and donors), then goes to cities with a
  marker that have free room (`warehouse capacity - stock - in transit`; order as in item 4.1: fewer
  charges in the warehouse first, on a tie the smaller `node_key`), then to rear cities from the
  nearest to the capital. Only the remainder burns up (`charges_overflow`). Without an own capital everything
  produced burns up.
- **[accepted]** (the owner's decision of 2026-10-20, #309) **Detour around a busy road.** If the fastest
  path of an automatic dispatch (a donor or the capital's surplus) runs into a road without a remainder of
  throughput in this dispatch, the fastest path over own internal roads with a remainder is searched for;
  it is taken only if its time is no more than the time of the fastest path plus
  `supply.dispatch_ticks` (not slower than waiting for the next dispatch); otherwise the charge waits for the next
  dispatch. If part of the charges passes along the main path, the remainder may go by a detour by the same
  rule. A one-off transfer (`Transfer`) does not look for detours. The details the owner did not set:
  - **[accepted]** (confirmed by the owner on 2026-10-21) The fastest (main) path is searched for without regard to throughput; the detour:
    the same search (`packet_ticks`, on a tie the lexicographically smaller sequence of
    `node_key`) only over roads that have at least 1 charge of throughput
    left in this dispatch.
  - **[accepted]** (confirmed by the owner on 2026-10-21) Splitting: along the main path goes `min(charges, the smallest remainder of the roads of the
    path)`; for the remainder a detour is searched for again, and so on until the charges run out or there is no suitable
    detour. Every dispatch exhausts at least one road, so the loop is finite. The threshold of all
    detours is the same: the time of the main path plus `supply.dispatch_ticks`.
  - **[accepted]** (confirmed by the owner on 2026-10-21) Each path gives its own packet (one pair "from, to" may give several packets in one
    dispatch along different paths).
  - **[accepted]** (confirmed by the owner on 2026-10-21) The order of donors does not change (the nearest by the tree metric first): the detour of
    a near donor goes before the main path of a far one.

**Client implementation** (#293; a road upgrade by click: #311). The "Supply" mode (`Tab` or `F2`) is
a separate map layer `supply` (`render/supplyView.ts`, the pure part `render/supplyLayout.ts`): while it is
on, terrain, groups, intents, fog and effects are hidden, the territory is filled flat, stronger than
the ordinary one. It draws only from the player view: the warehouses of own cities as dots (filled: a charge, empty: room;
a province and a foreign city have no warehouse), front markers as a flag with a number, one arrow
per road and direction with the number of charges (the sum of own packets by the remainder of their route: solid, a one-off
transfer dashed; flows to one city along different roads are each drawn with its own arrow),
packets in transit (a circle, a transfer a square), a cut-off own city with a dashed ring and a timer
`starve_in`, the enemy only with a hollow triangle "it is here" where it is visible now. The road level
is read by line thickness. A click on an own city opens a radial menu: marker 1 (key `1`),
marker 2 (`2`), transfer (`3`); a marker sector places or moves the marker (`set_front`, 0 CP) or
removes it (`node = null`) if it is already on this city; a city with another marker does not give the sector
(one marker per city, example 8). The rear minimum is a slider in the mode banner
(`0..ruleset_public.supply.rear_min_max`), the command `set_rear_min` is sent on release. The number of
markers the client takes from `ruleset_public.supply.front_markers` (#311; before, from the length of
`SelfView.fronts`); a nonzero price of a marker (`ruleset_public.cost.front`) is shown in the menu
sector (in DEC-28 it is 0, and the sector has no price). Server rejections are shown by a toast, like for other
commands.

**Road upgrade in the client** (#311, #315, item 7). Road upgrade has its own mode: the key `U`
turns it on and off (`Esc` also leaves it, before clearing the selection), the same on the ordinary map and in the
"Supply" mode (`Tab` does not turn the road mode off). In the mode all own roads are lit
for which the server sent `EdgeView.upgrade_gain` (an own internal one below the top level) and
which have no construction (`EdgeView.build`): a dashed strip (a shape, not only color); the client does not compute its own
conditions. A click on such a road sends `upgrade_road(edge)` at once, without a city and a choice;
the mode stays on for the next road. A selected group does not interfere with a click on a road (the mode is
turned on explicitly); during the choice of a transfer target a road stays a "city area". **Without the mode
a click on a road does not upgrade it**: it is a click on the city area (an order to the selected group, the choice of a
city), so the instant upgrade by click from #311 is cancelled; `Shift`+click is taken by a scheduled
order. The banner at the bottom of the map names the mode and the exit keys (if there is nothing to upgrade, it says so).
Under the cursor a road of the mode shows a tooltip after a pause: "level N → N+1", the gain from
`upgrade_gain` (unit speed, supply), the price `cost.build` and the time `build.ticks_per_level` from
`ruleset_public` (the client does not compute them). The progress of a construction is an icon and a time on the road
(`EdgeView.build`). The old path "city, `U`, choose a road" and the "Roads" sector in the city menu
are removed; `U` is now only the road mode.

**Roads implementation** (item 7, #306; `SIM_VERSION` 15, `PROTOCOL_VERSION` 18). The command
`UpgradeRoad(edge)` (`gow_sim.commands`, on the wire `{"type": "upgrade_road", "edge"}`), the construction
on an edge `Edge.build` (`gow_sim.systems.build`), unit speed `movement.road_speed_pct` and
`movement.leg(..., level)`, supply throughput `supply.road_amount(rules, level)`; the ruleset keys
`[road.speed_pct]`, `[supply.amount_by_level]`, `supply.front_markers`; table tests
`test_dec28.py` (examples 10-14), `test_build.py`, `test_dec22.py`, `test_dec26.py`. The details the
decision does not set:
- **[accepted]** (confirmed by the owner on 2026-10-21) `NOT_FOUND_OR_HIDDEN`: there is no edge or it is in the player's fog (~~an internal edge
  is never in the fog, so the answer reveals nothing~~ **[superseded by DEC-35]**: an own internal edge counts as known for commands, whatever its fog level for enemy presence, so the answer still reveals nothing); `NOT_INTERNAL`: the edge is visible but its
  ends are not both own. The codes `NOT_ADJACENT` and `NOT_SUPPLIED` are no longer issued by anything and are removed;
  `CITY_BUSY` stays for the barracks and the warehouse (DEC-26, item 8).
- **[accepted]** (confirmed by the owner on 2026-10-21) A road between provinces or at a province is upgraded too (there is no paying city;
  DEC-22, item 6 about the province is replaced).
- **[accepted]** (confirmed by the owner on 2026-10-21) The level by which a unit's time is computed (`OnEdge.level`) is taken when
  stepping onto the edge: on departure, on transit through an own node, on a defender's retreat by its own
  order (DEC-24, E3) and on a bounce or retreat of an attacker from a fight node (a new step onto the edge:
  the level at that moment). A group that turns around on the edge itself (a bounce on an edge,
  a cancel, a retreat from a fight on an edge) keeps its level, so a bounce lasts as long as
  the group walked (section 4, item 5). Pathfinding and the travel time of an order (`reach`, `ack.arrive_tick`)
  are computed by the current levels.
- **[accepted]** (confirmed by the owner on 2026-10-21) A transfer (DEC-18, item 6) goes in batches by the smallest `amount` of the roads of its
  path at the moment of the command; each batch takes `min(amount, share)` of the current level of its road
  (item 10).
- **[proposed]** Events: `build_started` of a road (`player`, `kind = road`, `edge`, `width`: the new
  level; without `node` and `charges`), `road_upgraded` (`player`, `edge`, `width`), `build_stopped`
  of a road (`player`, `kind`, `edge`, `reason`); only the owner receives them. `group_arrived`
  gets the field `level` (the level with which the group walked).
- **[proposed]** Player view: the road construction in `EdgeView.build` (`done_tick` of one's own construction;
  a foreign one is visible without a tick while the edge is not in the fog, and is not remembered; a fog test), `NodeView.build`
  is removed; the hint `upgrade_gain` gives the gains of `speed_pct` (packet), `unit_speed_pct` (units) and
  `amount`. `ruleset_public.build` without charge prices (the price: `cost.build`),
  `ruleset_public.supply.front_markers`. Replay frames: the key `e` (`[edge, owner, done_tick]`)
  instead of `b` (`replay-frames.md`).
- The DEC-26 "Implementation" items about the shared city construction for a road and about the field `kind` of
  `UpgradeRoad` are replaced by this block.
- **[accepted]** (confirmed by the owner on 2026-10-21) Bots (`gow_bots`): one road construction at a time per player, from CP above the reserve
  `road_keep` (350..450 for `expander` and `turtle`, so that roads do not eat the barracks and recruiting);
  the choice: the largest gain (`speed_pct + unit_speed_pct + 100 * amount`), on a tie the one closer to the
  capital, then the smaller edge key.

Alternatives (not chosen):
- Keep the three priority levels and the payment for roads with warehouse charges (DEC-18, DEC-26): harder to explain, small warehouses break transit.
- Delivery "to the target only" without donors: the front would wait for the capital, the old front would sit idle with a full warehouse when a marker is moved.
- Burning a capital charge above capacity while rear warehouses are free (section 6 before DEC-28).

---

### How the simulation computes this (SIM-11, #27)

> The struck-through items described construction by a group before the implementation of DEC-16 (#209, `SIM_VERSION` 3); the rule
> in force: the DEC-16 block above. The items not struck through apply to construction by a city too.

- ~~`UpgradeRoad(group, edge)` (1 CP, `orders.cost.build`) puts an own group standing at the end of an internal edge into "Building" on this edge. A buffer edge and an enemy edge: the rejection `NOT_INTERNAL`; an edge of width `max_width`: the rejection `MAX_WIDTH`.~~ **[superseded by DEC-16]**
- ~~The width of an edge grows by 1 every `build.ticks_per_level` ticks of construction, up to the `max_width` of the edge.~~ **[superseded by DEC-16]**: one level per command. The capacity of cities is recomputed by the new width (section 9), the packet speed is taken from `supply.packet_speed_pct` of the new width.
- ~~Construction is interrupted by the group leaving (a move order), a fight involving it, a change of mode and a merge; the progress of the current level is lost.~~ **[superseded by DEC-16]**
- ~~A hint "what the upgrade gives" (section 18): `upgrade_gain(edge)` = the capacity gain of each end in hundredths (`capacity.width_gain_centi[w + 1] − [w]`) and the packet speed gain in percentage points (`supply.packet_speed_pct[w + 1] − [w]`); an edge of width `max_width` has no hint.~~ **[superseded by DEC-22]**: the hint shows the gain of speed and volume by type (DEC-22, item 7).
- ~~**[open]** Construction details: question #124. Until decided: `UpgradeRoad` at tick `t` gives +1 at tick `t + ticks_per_level`, then every `ticks_per_level`; each group has its own progress, builders of one edge do not add up and do not interfere with each other; a finished road ends the construction (event `build_stopped`), the group stays in "Building"; the construction is removed also when the edge stopped being internal or the group no longer stands at its end; on a split only the original group builds; the size and charges of the group do not matter.~~ **[superseded by DEC-16]**: question #124 is closed as superseded.

### Construction of new edges by players

> Outside the MVP: the construction of new edges is postponed (`docs/mvp/MVP_PLAN.md`, "What is not in the MVP").

- **[proposed]** Allowed, with restrictions:
  1. **Planarity:** a new edge cannot cross an existing one. Otherwise encirclement loses its meaning.
  2. **The construction is visible to everyone from the first second**, like a scheduled order.
  3. **A limit on node degree** (4-5 edges).
  4. Terrain determines where one can build and how much it costs.
  5. A new edge takes long to build: 1-3 per match.
- **[proposed]** There is no demolition of roads: the capture of a node already blocks the flow through it.

### Delivery modes

> Outside the MVP: the delivery modes "packets / pumping" are postponed.

- ~~**[open]** "Big packets" versus "fast pumping" (Topic 4). If kept, then not on every road (that is about 60 decisions on the map), but as a stance for the front or for the whole network. Recommendation: postpone until the first playtest.~~ **[superseded by DEC-22]**: the choice is made at the level of a road: fast or freight at the first upgrade.

---

## 9. Cities

- ~~**[accepted]** The capacity of a city (both for units and for the warehouse) depends on the development of the roads around it.~~ **[superseded by DEC-22]**: capacity is fixed by the node kind from the map (section 8).
- ~~**[proposed]** Formula: `capacity = city_base + Σ f(width of road i)`, where f is concave, so that it pays to develop **all** approaches, not just one.~~ **[superseded by DEC-22]**; the table below applies only to code before DEC-22 is implemented.

| Road width | Contribution to capacity |
|---|---|
| 1 | +1.0 |
| 2 | +1.5 |
| 3 | +2.0 |
| 4 | +2.3 |
| 5 | +2.6 |

- ~~**[proposed]** Only roads leading into your connected supplied territory count. By cutting off the approaches to a city, the attacker reduces its capacity.~~ **[superseded by DEC-19, DEC-22]**: cutting off does not change capacity; the pressure of encirclement is starvation (section 7). If the garrison exceeds capacity, the excess units die off gradually (rather than being evicted at once).
- **[accepted]** Since groups assemble only in cities, all places where a big army can appear are known in advance.
- ~~**[accepted]** MVP simplification (MVP plan, MAP-01, #13): **every map node is a city with a warehouse**; there are no villages and no empty crossroads.~~ **[superseded by DEC-23]**: there are provinces, nodes without a city (the DEC-23 block below). Neutral cities are empty at the start: no garrison and an empty warehouse. Map format: [`map-format.md`](map-format.md).

### How the simulation computes this (SIM-07, #23)

> The struck-through items describe capacity from roads before DEC-22 (#234) was implemented; the current rule:
> capacity by node kind (section 8), starvation in encirclement (DEC-19, section 7).

- The connected supplied territory of a player: the nodes reachable from the own capital through own nodes (all edges
  between own nodes are internal). If the capital is not own, the territory is empty.
- ~~Capacity of a node = `base_capacity` + (Σ `capacity.width_gain_centi[width]` over the internal edges of the node) // 100,
  if the node is in the supplied territory of its owner; a cut-off own node and a neutral node: only
  `base_capacity`. One number limits separately the units standing in the city and separately the warehouse.~~ **[superseded by DEC-22]**
- ~~Capacity is recomputed only when the owners of nodes or the widths of roads change.~~ **[superseded by DEC-22]**
- On a change of owner the warehouse is zeroed (event `warehouse_lost`), road widths are kept,
  the grace period `capacity.grace_ticks` starts. DEC-26: the barracks and the warehouse level are kept.
- **Details of attrition (DEC-12, #118) [accepted].** The owner's decision of 2026-10-28; it confirms what is implemented (no change of rules, `SIM_VERSION` unchanged).
  1. A unit dies on the `capacity.attrition_ticks`-th consecutive tick above capacity; then the count restarts (one unit per `attrition_ticks` ticks). A tick without an excess resets the count.
  2. The grace ticks after a capture (`captured_tick .. captured_tick + capacity.grace_ticks - 1`) do not count; the count stays at zero. Starting cities do not count as captured.
  3. Only the owner's standing units (`AtNode`) count; groups on edges are in transit. Movement never leaves a group standing in an intermediate node of its path: it puts the group onto the next edge with `progress = 0` (`gow_sim.systems.movement`), so a path through own nodes has no standing stops.
  4. Only the units of the node's owner count. The unit that dies: a discharged one of the group with the lowest id; if there are no discharged ones, a charged one of the group with the most units, ties by the lowest id (as DEC-07, rule 7). A group without units is removed.
  5. ~~A warehouse above the capacity is not trimmed.~~ Obsolete: after DEC-22 the capacity does not fall, and with DEC-26 the warehouse has its own capacity.

### Map rework: provinces, city kinds, names, border point (DEC-23, #235) **[accepted]**

> **[superseded by DEC-41 under `economy.model = "v2"`]**: item 2 (a province has no warehouse): a province has a warehouse of capacity 1. The text below is kept and is in force for `economy.model = "v1"`.

The owner's decision of 2026-10-12. Replaces the MVP simplification "every node is a city with a warehouse" (above). Format changes: `map-format.md`, section "Format changes per DEC-23".

A map gets provinces (nodes without a city), city classes, names and a border point on every
edge. The rules and the format are recorded here; the maps themselves are redone by a separate issue (criteria below).
Items previously marked "(default)" were confirmed by the owner on 2026-10-12 (#239).

1. **Node kind** `kind`: `capital` (capital), `city_large`, `city_medium`, `city_small` (large,
   medium, small city), `province` (province). Capacity by kind from the ruleset (DEC-22, item 1):
   10 / 8 / 6 / 4 / 3. `base_capacity` is removed from the map: the rule numbers live in the ruleset
   (AGENTS.md, 4.1, rule 7).
2. **Province:** a node without a city, only a position.
   - No warehouse: the warehouse is always 0, packets do not stop in it, they only pass through
     (DEC-18, item 3), there is no recharge, no starvation (DEC-19).
   - Capacity 3: it limits only the standing units and the stack limit (DEC-20, D).
   - VP 0, no recruiting (`NOT_CITY`), ~~cannot build roads (`NOT_CITY`, DEC-22, item 6)~~ **[superseded by DEC-28]**: a road at a province is upgraded for CP like any other own internal one (DEC-28, item 7), and there is no ~~priority~~ front marker
     (DEC-28, #292) and no transfers (`NOT_CITY`, DEC-18).
   - Like an ordinary node: terrain (fight, entry speed, vision DEC-21), capture, ownership, internal and
     buffer edges, connectivity of the supplied territory (capturing a province can cut cities off).
   - Map constraints: `vp = 0`, `capital_of = null`, `start_units = 0`, `start_charged = 0`,
     `start_stock = 0`; `start_owner` is any (an own province at the start is allowed).
3. **Capital:** `kind = capital` if and only if `capital_of` is not `null`.
4. **Name** `name`: every node has one name, a string of 1..24 characters without spaces at the edges,
   unique within the map. Names are not translated (map data, one name per node). The interface
   labels cities with them and uses them in toasts and events instead of "Node 22".
5. **Border point** `border_permille` on every edge: an integer 100..900, thousandths of the edge length from
   the end `a`; 500: the middle. It sets the halves of the edge for vision (DEC-21, item 5) and the border of territories on
   the map (a weighted diagram: the border between neighboring nodes passes through the border point of their
   edge).
6. **Roads:** `base_width` is removed (all roads start at level 1 without a type, DEC-22);
   `max_width` is renamed to `max_level`, 1..3.
7. **Mirror.** A mirrored node: the same `kind`, its own (different) `name`. The mirrored edge `m(e)`
   connects `m(a)` and `m(b)`; if its end `a` equals `m(e.a)`, then
   `border_permille(m(e)) = border_permille(e)`, otherwise `1000 - border_permille(e)`. An edge that is the mirror of
   itself has `border_permille = 500`.
8. **Half of a map** (`maps/src/*.half.json`): a node has `name` and `mirror_name` (the name of the mirrored
   copy; the central node has only `name`); an edge has `border_permille` optional (by default
   500), the script always writes it into the finished map. The copy of an ordinary edge gets the same value;
   the copy of a `cross_edge` (from `b` to the mirror of `a`) gets `1000 - border_permille`; a `cross_edge` with
   `a == b` requires 500, otherwise a script error.
9. **The loader** is strict, as now: `kind`, `name`, `border_permille`, `max_level` are required;
   `base_capacity`, `base_width`, `max_width` are forbidden (an old map does not load).
10. **Validator:** new checks `names` (item 4), `border` (the range of item 5 and the symmetry of item 7),
    `kinds` (items 2 and 3); the `symmetry` check compares `kind` and `border_permille` taking the
    direction into account, and does not compare `name`. The other checks are unchanged.

An example of a map fragment:

```json
{"id": 4, "x": 340, "y": 500, "terrain": "forest", "kind": "province", "name": "Ford",
 "vp": 0, "capital_of": null, "start_owner": 0, "start_units": 0, "start_charged": 0, "start_stock": 0}
{"id": 7, "a": 4, "b": 9, "max_level": 3, "travel_ticks": 45, "border_permille": 400}
```

Worked examples for the loader and the validator. Tests: "bad" fixtures, one per row.

| # | Map | Result |
|---|---|---|
| 1 | a province with `vp = 1` | load error (`nodes[i].vp`) |
| 2 | a province with `start_units = 2` | load error |
| 3 | `kind = capital` without `capital_of` | load error |
| 4 | two nodes with the same `name` | `FAIL [names]` |
| 5 | `border_permille = 50` | load error (range 100..900) |
| 6 | an edge without `border_permille` in a finished map | load error (required field) |
| 7 | an edge a→b with 400, its mirror with end `a = m(a)` and 400 | `OK` |
| 8 | the same, the mirror with end `a = m(b)` and 400 | `FAIL [border]` (600 expected) |
| 9 | an edge that is the mirror of itself, with 400 | `FAIL [border]` |
| 10 | a node with `base_capacity` | load error (unknown key) |
| 11 | mirrored nodes of different `kind` | `FAIL [symmetry]` |
| 12 | `max_level = 4` | load error |

What the implementation changes (simulation and `SIM_VERSION`, protocol and `PROTOCOL_VERSION`, client, bots, rulesets): the list is in #235.

**Implementation of the format** (#366; `SIM_VERSION` 20, `PROTOCOL_VERSION` 24): the loader, `MapFile`,
the validator (`names`, `border`), the mirroring script, the client takes the border point from the map; the three MVP
maps got names, border points 500. Difference from item 10: the `kinds` check (items 2, 3) is done by the
loader (error `format`, as in examples 1-3), the symmetry of the border point is checked by `border`, not
`symmetry`. The province rules in the simulation apply with DEC-22, DEC-18, DEC-19, DEC-25 (capacity,
`NOT_CITY`, transit of packets, warehouse 0). Maps with provinces: #266.

Alternatives (not chosen):
- Capacity as a number in the map (`capacity`) instead of the node kind: the balance of the rules would end up in the map files.
- Provinces with a warehouse of capacity 0 (a superfluous entity "a warehouse that stores nothing").
- The border point always in the middle (no field): a "long approach" to a mountain fortress is impossible.
- Names by i18n keys (two versions per node); the owner: one name per node.

### Maps: symmetry of the rules without symmetry of the picture, size, no water (DEC-27, #266) **[accepted]**, asymmetric maps **[deferred]**; item 3 (no water) **[superseded by DEC-36]**

The owner's decision of 2026-10-14 (#252): maps should look less symmetric and more interesting, be
a bit larger, and the water on the background is confusing. Changes of the format and the tools:
`docs/design/map-format.md`, section "Format changes under DEC-27". The owner accepted all items
(2026-10-14, #266), including those that were proposals with a default value. The decision is
accepted and implemented (#266, closed 2026-10-22; validator and script #366, DEC-27 maps only in the server pool since #372).

1. **[accepted]** **Symmetry of the rules, not of the picture.** These stay mirrored:
   - the graph (the `mirror` table, the ends of edges);
   - the node attributes: `kind`, `terrain`, `vp`, `capital_of` and `start_owner` (swapped between
     the players), `start_units`, `start_charged`, `start_stock`;
   - the road attributes: `travel_ticks`, `max_level`, `border_permille` taking the direction into account
     (DEC-23, item 7).

   **The node coordinates `x`, `y` are free:** the requirement `(width - x, height - y)` for a mirrored node
   is gone. The whole game (the ruleset, `node_key`, the mirror test, the player view) reads the graph and
   the attributes, not the coordinates, so the map stays fair for both sides, including the ranked
   one (AGENTS.md, 4.1, rule 6: tie-breaks between nodes through `node_key(player, node)`
   work without changes). The picture (positions, the shape of roads on the screen, the background) may differ.
2. **[accepted]** **Maps a bit larger** than before (31..34 nodes, world 1140..1600 by 1000).
   **[accepted]** 45..55 nodes with the provinces of DEC-23; the world scales proportionally (width and
   height are multiples of 4, a `bake` requirement), the specific sizes are set by the maps issue.
3. ~~**[accepted]** **No water for now:** the sea, shallows and beach are removed from the baked backgrounds (`uv run gow-maps bake`);
   the background is all land, only the biomes by node terrain remain (plains, forest, mountains). The owner
   finds water confusing. This does not change the game rules (the background is only for looks).~~
   **[superseded by DEC-36]** (accepted 2026-10-29, #537): water returns as water cells and rivers that lie exactly
   where the areas of nodes do not connect (the DEC-36 block below). A map without an authored geography
   (`maps/src/<id>.geo.json`) keeps the land-only background described here.
4. **[accepted]** **The length of the drawn road agrees with `travel_ticks`** (otherwise with free
   coordinates the road on the screen lies about the travel time): a tolerance of 15 percent, the validator check
   `travel_ticks` (now 25 percent, `travel_tolerance_pct = 25`; it will become `15`). The expected time
   `e = length * travel_ticks_per_100_units / 100` (30, that is, 100 world units = 3 seconds), the condition
   `|travel_ticks - e| * 100 <= travel_tolerance_pct * e`; the validator is an offline tool, `float`
   is allowed in it (the integer rule applies to `gow_sim`). Mirrored edges have one
   `travel_ticks`, so their drawn lengths also differ by no more than the tolerance.
5. **[accepted]** **Validator checks:** `symmetry` compares the graph and the attributes of nodes and edges
   (including `terrain`, `vp`, the start fields and `border_permille` with direction), and **does not compare
   the coordinates**; `planarity` stays and is now essential (free coordinates produce
   crossings more easily; the actual coordinates are checked, a road does not pass through a foreign city);
   the new check `size` with the thresholds `min_nodes = 45`, `max_nodes = 55` in `validate.toml`, off by
   default so that the three MVP maps (31..34 nodes) pass; for new maps run with
   `--config` for the thresholds. The other checks are unchanged.
6. **[accepted]** **The script `gow-maps mirror`:** a node of the half gets the optional
   `mirror_x`, `mirror_y` (the coordinates of the copy); without them the copy is at `(width - x, height - y)`, as
   now (old halves work). A node that is the mirror of itself is set by the flag
   `self_mirror: true` and arbitrary coordinates (now only the exact center). The `cross_edge` road
   and `edges` as now. `meta.symmetry` stays `"rot180"`: it is a swap of players and nodes
   by the `mirror` table, not a geometric rotation.
7. **[accepted]** **Performance:** the budgets of AGENTS.md, section 12 are set for 40 nodes;
   a 55-node map is checked by a separate benchmark (`grid55`, like `grid40` from `conftest.py`):
   a step without projections on average no more than 0.3 ms, p99 no more than 1 ms, a projection no more than 0.3 ms
   (a linear estimate from `docs/perf.md`: 0.15 ms on 40 nodes gives about 0.21 ms on 55, this is an estimate, not a measurement).
   If it does not fit, the budget or the map is changed, not the rule. The `grid55` measurement (#266) did not fit
   the projection into 0.3 ms, so **[accepted]** (the owner, 2026-10-22, #371): on maps of 45..55 nodes
   the `project()` budget is 0.45 ms; the budgets of the step and of supply, as well as 0.3 ms for 40 nodes, do not change.
8. **[deferred]** **Real asymmetric maps** (a different graph or different attributes for the sides):
   only later and only for unranked matches. They need a new tie-break instead of the mirrored
   `node_key` (AGENTS.md, 4.1, rule 6) and their own fairness test; without this they are not introduced in the MVP.
9. **The Windows and Mac discrepancy: found (#269).** The owner saw water on the background only on Windows,
   on Mac it was not there. The cause: the `caddy` image built the client, copying into the context only
   `maps/*.json`, without `maps/*.bg.png` (`deploy/caddy.Dockerfile`; since #344 the backgrounds are `maps/*.bg.webp`); the client takes the backgrounds from
   `import.meta.glob('maps/*.bg.png')` at build time (`*.bg.webp` since #344), so in the Docker stack (on Mac) the glob is empty and the
   map is drawn in flat terrain colors, while the client from the repository (the Vite dev server) sees the background.
   The server serves the background correctly (`GET /api/maps/{id}/background.png`, since #344 `background.webp`, answers 200), but the client does not
   request that address. Fixed: the Dockerfile copies the backgrounds too, the check
   `deploy/check-caddy.sh` catches an empty glob.

Worked examples. A 400 by 400 map, `travel_ticks_per_100_units = 30`. Validator tests: "bad"
fixtures, one per row.

| # | Map | Result |
|---|---|---|
| 1 | node 3 at (120, 80), mirrored node 17 at (260, 310) with the same attributes | `OK` (before, (280, 320) was needed) |
| 2 | mirrored nodes with different `terrain` | `FAIL [symmetry]` |
| 3 | graph: an edge has no mirrored one | `FAIL [symmetry]` |
| 4 | an edge of length 200 units: `e = 60`; `travel_ticks = 60` | `OK` |
| 5 | the same, `travel_ticks = 69` and `51` | `OK` (tolerance 15 percent: `900 <= 15 * 60`) |
| 6 | the same, `travel_ticks = 70` and `50` | `FAIL [travel_ticks]` (`1000 > 900`) |
| 7 | a pair of mirrored edges with `travel_ticks = 60`: one of length 200, the other 180 (`e = 54`) | `OK` (`6 * 100 = 600 <= 15 * 54 = 810`) |
| 8 | as 7, the second of length 150 (`e = 45`) | `FAIL [travel_ticks]` (`15 * 100 = 1500 > 675`) |
| 9 | a road of the mirrored node crosses another road | `FAIL [planarity]` |
| 10 | a 50-node map with `--config` of the `size` thresholds | `OK` |
| 11 | a 34-node map with the `size` thresholds 45..55 | `FAIL [size]` |
| 12 | the `bake` background | not a single pixel of sea, shallows and beach; the image size exactly `width x height` |

What the implementation changes (map tools, maps; item 9 and `gow_maps.bake` without water were done in #269): `gow_maps.validate`
(`symmetry` without coordinates, `travel_ticks` 15 percent, `size`), `gow_maps.mirror` (`mirror_x`,
`mirror_y`, `self_mirror`), `gow_maps.bake` (without water), new or reworked maps, `grid55` in
the benchmarks, `maps/README.md`; the simulation and the protocol do not change (the map is public and is read as
before). Done: the validator and the script in #366 (together with the DEC-23 format); maps of 45..55 nodes
("Ridge", "Crossroads", "Highway": 49..51 nodes, about half provinces, free coordinates of the
mirrored half), `grid55` and `maps/README.md`: #266. The three MVP maps stay in the pool for now. The
`grid55` measurement (item 7): the step and supply fit into the 40-node budgets, the projection does not (0.32 ms, with the
enemy figures of DEC-33 0.41 ms on the reference machine): the `grid55` budget for the projection of 0.45 ms was accepted by the
owner on 2026-10-22 (#371).

Alternatives (not chosen):
- Keep the coordinates mirrored, change only the background (the picture would stay mirrored).
- Asymmetric maps in the ranked mode too (a new tie-break and a proof of fairness are needed).
- Keep water on the background as decoration (the owner: it is confusing).
- A `travel_ticks` tolerance of 25 percent (the road on the screen could be a quarter longer or
  shorter than the travel time).

### Map geography: water cells, rivers as area borders, areas touch only along roads (DEC-36, #537) **[accepted]**

**Decision: accepted** by the owner on 2026-10-29 (#537), in substance, with these choices and defaults:

- **Water look W4 Painted** (item 6), baked into the background.
- **No dark line along water.** Where the border of an area runs along water (a sea, a lake, a river or a stream),
  no dark stroke, dark halo or dark bank line is drawn on the land side or on the water side: the water itself is
  the border, and the water stays blue. This replaces the "soft shore halo" of the mockup's W4 (a darkened band on
  the land along every coast) and applies to the client's thin area line too: it is drawn only between two land
  areas.
- The questions of #537 the owner did not answer take the defaults of this block: long rivers with drawn bridges at
  border points as in the mockup (item 4), about 20 percent water on `ridge` (item 11), the fixtures `artery`,
  `web`, `pass` and the test maps without water (item 10), everything before the release (M6), in three steps:
  (1) the baker, the vector file and the validator check `geography` (#537); (2) the client territory layer from the
  vector file (this removes the "sliver"); (3) the geography of the three pool maps and the menu map.

DEC-27, item 3 ("no water") is **[superseded by DEC-36]**: a map with an authored geography gets water; a map
without one keeps the land-only background.

The owner's feedback of 2026-10-29 on the river variants of the #429 mockup (`docs/design/mockups/supply-terrain.html`):
rivers and the visual separation of territories must be reworked; the map may have whole cells of sea or lake;
rivers and the borders they form must look better and more natural, still in the map's style; no sliver of one
node's area may stick into a neighbouring area; ideally the areas of two nodes touch **only where a road links them**,
elsewhere water, a river or another natural border separates them.

**This is not a rule change.** The mechanics are frozen for the release (the note at the top of this document): DEC-36
changes only the picture of the map and the data that draws it. The simulation, the server, the bots and the
protocol read none of it (the list in item 7). Format and tools: `docs/design/map-format.md`, section "Format
changes under DEC-36". Mockup: `docs/design/mockups/map-geography.html` (the pool map `ridge` re-imagined, four
water variants, the check of item 3, the moved nodes of item 9); prototype generator:
`docs/design/mockups/src/map_geography.py`.

Today (measured on the pool maps by the mockup and its generator): on `ridge` 48 of the 130 pairs of touching
areas have no road between their nodes (`crossroads` 32 of 124, `highway` 47 of 123); and the picture and the
territory do not agree, because the client tints straight Voronoi cells (`voronoi.ts`) while the baker warps the
borders of the same cells by noise (`gow_maps.bake`, `WARP = 40`): on 11 to 12.5 percent of each map the ground under
a tint belongs to another area, on 6.6 to 7.7 percent it is even another terrain. That is the "sliver of another
territory" the owner saw.

Proposal (each item is a default for the owner to confirm or change):

1. **Water returns, as part of the picture.** A map may have **water cells**: a sea (at the edge of the map) or a
   lake (inside), each set by a point and a radius in the authored geography of the map. The water cell takes the
   ground around its point exactly as a node takes its area (item 2). **Supersedes DEC-27, item 3** ("no water
   for now", [superseded by DEC-36] since 2026-10-29). Why the earlier
   objection no longer applies: the water of the old baker was the sea below a density threshold of the
   prototype generator, unrelated to the graph, so it suggested a rule that did not exist; under DEC-36 water lies
   exactly where the areas do not connect, so it shows the graph instead of contradicting it.
2. **Areas.** The area of a node is the ground nearer to it than to any other site; the site of a node is its
   point and the halves of its roads up to the border point (`border_permille`, DEC-23, item 5), the site of a water
   cell is its point minus its radius. The borders are warped by the baker's noise, and the warp fades near roads.
   Consequences: a road always runs through its own two areas only, and **their border crosses the road at its
   border point** (the DEC-21 border point becomes visible on the ground).
3. **The adjacency rule.** Two land areas share a border only if a road connects their nodes. On every other
   border of two areas a stream or a river is cut (it widens toward other water). Every area is one piece and
   holds its node: a land piece cut off from its node becomes the water around it (no slivers, no exclaves).
   The validator checks this (the new check `geography`, map-format.md).
4. **Long rivers.** Besides the streams of item 3, a map may have long rivers: a spring point (or a lake) and the
   water it flows into; the river runs along area borders. Where it passes a road it does so at the road's border
   point, and a **bridge** is drawn there. A bridge is a picture: the road is unchanged, crossing it costs nothing
   (rivers and bridges as obstacles would be a rule: a separate DEC after the release, item 13).
5. **One geometry for the picture and the territory.** The baker writes, next to the background, the vectors of
   the areas, the water and the rivers; the client draws the territory tint, the owner borders, the fog veil and
   picks an area from that file instead of its own Voronoi cells (maps without the file keep the Voronoi cells).
   The tint and the ground then agree everywhere.
6. **Rendering.** Variants (mockup, section "Water variants"): W1 flat ink, W2 shallows and banks, W3 engraved
   coast, W4 painted T2 water. **Recommended: W4**, baked into `maps/<id>.bg.webp` (no per-frame cost): flat water in
   two tones, a soft shore without a hard line, reed tufts on the banks that thin out away from the water (the T2
   language of details thinning at an edge), faint flow streaks on rivers (removed by the owner on 2026-10-30, #585:
   they read as rendering artifacts), wooden bridges. The owner border line
   runs along a coast where the territory ends at water, and not along a river between two areas of one owner.
7. **What does not change.** The graph, the roads and their levels, `travel_ticks`, `border_permille`, capacities,
   supply, vision (DEC-21, DEC-35), fights, the ruleset, `PlayerView`, the protocol, `SIM_VERSION`,
   `PROTOCOL_VERSION`, the map file `maps/<id>.json` and its loader (water is not a field of the map file). The
   geography stays public to everyone (section 10, DEC-04), as the background is now.
8. **Symmetry.** The rules stay mirrored (DEC-27, item 1); water, rivers and bridges are free like the
   coordinates, so the two halves of a map may differ in the picture (on `ridge` the seas of the two corners mirror
   each other, the lakes do not).
9. **Node coordinates may move,** to give a stream or a lake room (on `ridge`: four nodes 131 to 159 units from a
   neighbour without a road, moved 25 to 45 units). The game does not read coordinates (DEC-27, item 1), but the
   validator ties the drawn length of a road to its `travel_ticks` (DEC-27, item 4, 15 percent). A move that keeps
   every road of the node within that tolerance changes no simulation result (the four moves of the mockup do);
   a move beyond it would change `travel_ticks`, a balance change of the map that needs a tournament (AGENTS.md,
   section 8).
10. **Scope.** The three pool maps (`ridge`, `crossroads`, `highway`) get a geography; the fixtures `artery`, `web`,
    `pass` and the test maps keep the Voronoi cells and the land-only background (they are not served, the dev
    scenes and visual references use them); the menu map (#474) follows the pool when it lands.
11. **How much water.** About a fifth of the map on `ridge` (20 percent: two seas in the corners, two bays, four
    lakes; rivers and streams 2 percent). The owner may ask for less (fewer lakes) without changing the rule.
12. **Determinism.** The baker stays deterministic (the map seed); the vector file is generated, committed and
    checked like the background (a map edit without `bake` breaks CI).
13. **Not in DEC-36:** rivers or lakes as obstacles, bridges or fords as chokepoints, movement or vision by water.
    They would be rules: a DEC with a ruleset flag after the release (#429).

Worked examples (the validator check `geography`, map-format.md; one "bad" fixture per row).

| # | Map | Result |
|---|---|---|
| 1 | the areas of A and B share land, a road A-B exists | `OK` |
| 2 | the areas of A and B share land, no road A-B | `FAIL [geography]` (a stream must separate them) |
| 3 | a stream separates A and B, no road A-B | `OK` |
| 4 | the area of A in two pieces (a piece cut off by a river or a coast) | `FAIL [geography]` |
| 5 | a road crosses a lake | `FAIL [geography]` |
| 6 | a long river passes the road A-B at its border point (a bridge) | `OK`; A and B may then share no land at all |
| 7 | a node closer than `water_clearance` (60 units) to water | `FAIL [geography]` |
| 8 | mirrored roads: one with a bridge, the other without | `OK` (the picture is free, item 8) |
| 9 | `ridge` today (land only, warped Voronoi) | `FAIL [geography]`: 48 pairs touch without a road; the check is off for a map without a geography file |
| 10 | a node moved 40 units, every road within 15 percent of its `travel_ticks` | `OK`; same `travel_ticks`, same simulation results |

What the implementation would change (impact estimate in #537): the map tools (`gow-maps bake` with areas, water,
rivers, the vector file; the validator check `geography`), the authored geography of the three pool maps, the
client territory layer (tint, borders, glow, veil, picking, the capture effect and the Supply view from the vector
file), the docs (`map-format.md`, `maps/README.md`, `ui-style.md`). Not the simulation, the protocol or the golden
replays (they replay frozen copies of the fixture maps, `packages/sim/tests/golden/v*/maps/`).

Alternatives (not chosen):
- Keep the land-only map and separate unconnected cells by a drawn strip (#428, PR #445): tried and removed in #451 as out of place.
- Derive rivers in the client from the Voronoi cells (#429, variants A to C): no water cells, the ground and the tint still disagree, short streams with nowhere to flow.
- Paint water only where it looks good and accept some unconnected contacts (#429, variant D): misses the owner's rule "touch only along roads".
- Move nodes freely and recompute `travel_ticks`: a balance change of every map, a tournament, for no gain over item 9.
- Rivers as obstacles with bridges as chokepoints: a rule, out of scope for the release (item 13).

### Spoils from warehouses

> Outside the MVP: there are no spoils; on a change of owner the warehouse is zeroed (SIM-07, #23).

- **[rejected, provisionally]** The idea "the contents of the warehouse pass to the capturer" does not work as a general reward: in a siege of attrition the warehouse is empty by the time of capture. The spoils work only on a quick capture.
- **[open]** Options:
  1. Remove the spoils altogether. In a flat economy, forcing the opponent to burn his budget is already damage. **Recommended.**
  2. Keep it as a reward precisely for a surprise capture (it makes rear warehouses targets).
  3. A fixed one-off CP for a capture (for example +2), working the same in a siege and in a quick strike.

---

## 10. Information and fog of war

- **[accepted]** There is fog of war.
- **[accepted]** Scheduled orders are visible to everyone, ordinary ones only within vision.
- **[accepted]** A scheduled order shows the intent, but not the composition.
- **[proposed]** The information ladder is one rule: **from afar the state is visible, up close the magnitude.** For the MVP it is refined in DEC-04 and DEC-17 below (difference: the ownership of all nodes and the VP of both sides are public).
  1. To everyone, always: geography and terrain.
  2. To everyone, always: scheduled orders ~~and construction~~ (the fact, without strength). The enemy's construction is visible only within vision: DEC-17 below; there is no public intent of construction (DEC-16, section 8).
  3. Near your territory: ownership, presence of troops, status. Without numbers. Refined by DEC-21 below: how much is visible about neighbors depends on terrain.
  4. ~~Your node or a node where your group stands: everything exactly.~~ **[superseded by DEC-35]**: a node where your group stands (or in whose half of an edge your group is) is seen exactly; your own node without a group of yours: its own data (warehouse, queue, construction) exactly, enemies in it at the level `PRESENCE` (the DEC-35 block at the end of this section).
- **[proposed]** Vision is inversely proportional to the size of a group: a small one sees farther. The role of a scout appears without a separate unit type, and whoever has gathered a big army sees worse. Outside the MVP (DEC-04).
- **[proposed]** A replay after the match revealing the real state.

### Visibility rules in the MVP (DEC-04, #10) **[accepted]**

Refines the information ladder above to a level sufficient for code. Difference from the ladder: the ownership of all nodes and the VP of both sides are public, otherwise the VP scoreboard would reveal the hidden indirectly.

To everyone, always: geography, terrain, ~~road widths~~, ownership ~~and capacity~~ of all nodes, the VP of both sides, the intents of scheduled orders ~~and of construction~~ (from where → to where, the kind; without the size and without the group id). ~~Exactly: own nodes and nodes where own groups stand.~~ **[superseded by DEC-35]**: exactly: nodes where own groups stand and the node of the half of an edge an own group is in; the data of an own node stays known to its owner, but an own node without an own group is not a source. ~~In the nodes next to them and on the adjoining edges: whether there are enemy groups and their mode, but not the number of units and charges.~~ **[superseded by DEC-21]**: information about neighbors by the terrain table, on edges by halves. An enemy group with an ordinary order does not show its target. The rest is fog with the "last seen" memory. Vision depending on group size is not done in the MVP.

Every rule of this block: a separate test in SIM-14 (#30).

> **Superseded by DEC-21 (#233), block below:** the information about enemy groups in neighboring nodes and on edges depends on terrain and on the border point of the edge; the capacity of all nodes is public (DEC-22).
>
> **Superseded by DEC-35 (#477), block at the end of this section:** "own nodes" are no longer vision sources; the sources are own groups only (a group on an edge counts as standing in the node of its half). Every rule below that relies on own nodes as sources is marked **[superseded by DEC-35]**.
>
> **Superseded by DEC-17 (#204), block below:** the struck-through parts are no longer public. Road widths, the capacity of enemy cities and its construction are visible only within vision, outside vision the player sees the last seen state. The ownership of all nodes and the VP are still public.

- ~~**[open]** Whether an own group on an edge gives vision and whether enemy packets are visible: question #112. Until decided (a literal reading of the block above, SIM-03): vision is given only by own nodes and nodes where own groups stand; enemy packets are not visible. DEC-21 and DEC-33 do not settle this question.~~ **[decided by DEC-10]** (the block at the end of this section): an own group on an edge is a vision source for its edge only, at the level `PRESENCE`; enemy packets are not visible.

Alternatives (not chosen):
- Hidden ownership of distant nodes and hidden enemy VP (closer to the ladder above, but the scoreboard becomes useless).

### Fog of war for roads (DEC-17, #204) **[accepted]**

The owner's playtest of 2026-10-07: the enemy's road upgrades were visible through the fog. Decision: road widths, the capacity of enemy cities and its construction are visible only within the vision zone; outside vision the player sees the last seen state. Replaces the corresponding parts of DEC-04 (struck through above). Road construction by a city is introduced by DEC-16 (#203); the visibility rules below do not depend on the way of construction.

1. **Visible edge.** The width of an edge is seen exactly while the edge is not in the fog for the player: edge level `PRESENCE` per DEC-04 (~~at least one end is seen exactly: an own node or a node where an own group stands~~ **[superseded by DEC-35]**: at least one end is a vision source of DEC-35, that is, a node with an own group or the node of the half an own group on the edge is in). There is no separate vision rule for widths: one edge-level function (`compute_vision`) decides both "is there an enemy" and the width.
   - ~~Own internal edges are always visible (both ends are own).~~ **[superseded by DEC-35]**: an own internal edge is in the fog for enemy presence like any other edge without a source on it; its road level and the own construction on it stay exactly known to the owner (own data, only the owner changes them; DEC-35, detail 5).
   - ~~A buffer edge with an own end is seen exactly; nobody can upgrade it (section 8).~~ **[superseded by DEC-35]**: a buffer edge is not in the fog only if one of its ends is a vision source (DEC-35); otherwise the last seen width (items 2 and 7 below; `base_width` if never seen); nobody can upgrade a buffer edge (section 8).
   - An edge between two nodes neighboring my territory (both of level `PRESENCE`) is in the fog, as per DEC-04.
2. **An edge in the fog.** The width on the last tick when the edge was not in the fog is shown (the "last seen" memory). An edge the player has never seen: `base_width` from the map file (the map file is public, at the start the width equals `base_width`). There is no demolition of roads, so the known width is not greater than the real one and equals it outside the fog.
3. ~~**Node capacity.** The same SIM-07 formula (section 9), but by the widths the player knows (items 1 and 2). Ownership is public, so the supplied territory and "is the city cut off" are computed exactly; only the contribution of widths is hidden. Own and neutral capacity is exact; the capacity of an enemy node is exact if all its internal edges are visible, otherwise it is an estimate by the last seen widths (not greater than the real one). The "estimate" flag (`capacity_stale`): the node is in the supplied territory of its owner and at least one of its internal edges is in the fog for the player. Capacity is not stored in memory, it is derived from the known widths and the current ownership.~~ **[superseded by DEC-22]**: capacity is fixed by the node kind, is public and exact; `capacity_stale` is not needed.
4. **Ownership and VP** are public, as in DEC-04. Geography, terrain, `base_width` and `max_width` from the map file are public.
5. **Construction.** The intent of the enemy's construction (and any visible sign of road construction per DEC-16) is shown only while the edge under construction is not in the fog for the player; in the fog it is not shown and not remembered, the player learns the result from the width (items 1 and 2). The player always sees their own construction. Scheduled orders and "Defense" stay public (DEC-04, DEC-08). While the "Building" mode exists, the mode of an enemy group in a node of level `PRESENCE` is visible per DEC-04; it does not tell which edge is being built.
6. **Events** of construction (`road_upgraded`, `build_stopped` and the future events of DEC-16) are received only by the own player. The opponent learns the new width only through the view per items 1 and 2.
7. **Memory.** The known width is stored in the fog memory `GameState.vision_memory` next to the `Sighting` of the edge and is updated by the `vision` system at the end of the tick for every edge not in the fog. The memory is part of `state_hash()`, so the replay is reproducible and `project()` stays a pure function. A replay after the match shows the real state.
8. **Link to #112.** The width follows the edge level: if #112 decides that a group on an edge gives vision of that edge, its width becomes visible without a separate rule (**[decided by DEC-10]**, item 5: it does). Enemy packets, if #112 opens them, can be shown only on edges not in the fog: the speed of a packet depends on the width.

There is no flag in the ruleset: the visibility rules contain no numbers, as with DEC-04. Every rule of the block: a separate fog test at implementation (the list of changes: #204).

Alternatives (not chosen):
- The width in the fog is always `base_width`, without memory: contradicts the requirement "the last seen state".
- Hide the capacity of enemy nodes outside exact vision: it loses what the player honestly knows from the public ownership.
- A separate memory "last seen capacity": extra state, diverges from the public ownership after a capture.

### Vision by terrain and the border point of an edge (DEC-21, #233) **[accepted]**

Playtest of 2026-10-12: under DEC-04 only "there is an enemy" is visible about neighbors, terrain did not affect vision. The owner's decision and a clarification of the same day. Replaces part of DEC-04 (neighboring nodes without numbers, struck through above) and, together with DEC-22, item 3 of DEC-17.

How much is visible about the enemy in a neighboring node depends on terrain: where I look from and where to. Instead of
random noise, ranges are shown. The exact number is revealed when an enemy group crosses the
border point of an edge toward my node. Items previously marked "(default)" were confirmed by the
owner on 2026-10-12 (#239). The vision is wider than in DEC-04 by design; to be checked in a playtest. Every
item: a separate fog test.

1. ~~**Vision sources** are unchanged (DEC-04): own nodes and nodes where own groups stand.~~ **[superseded by DEC-35]**: the vision sources are own groups only: a node where an own group stands, and the node of the half of its edge an own group on an edge is in (DEC-35, items 1 and 3); an own node without an own group is not a source. At the
   sources everything is seen exactly. ~~A group on an edge gives no vision (#112 by default, the question stays
   open).~~ **[superseded by DEC-10]**: an own group on an edge is a source for its edge only, its halves are at least
   `PRESENCE`; it gives no node a level. **[superseded by DEC-35]**: it is a source as if it stood in the node of its half (DEC-35, item 3).
2. **The level of information about a neighboring node.** A node adjacent to a source by an edge gets a level by the
   pair of terrains "source terrain → node terrain" from the table below. If there are several sources nearby,
   the best level is taken: `EXACT` is better than `RANGE`, `RANGE` is better than `PRESENCE`. A node not adjacent to any
   source: fog (`FOG`) with the "last seen" memory. **[amended by DEC-35]**: an own node without an own group is not a source, but enemy groups in it are seen at the level `PRESENCE` (the better of this and the table level); this level gives no zone and no levels to neighbors (DEC-35, details 3 and 4).

   | Source \ target | plains | forest | mountains |
   |---|---|---|---|
   | **plains** | `EXACT` | `RANGE` | `PRESENCE` |
   | **forest** | `RANGE` | `RANGE` | `PRESENCE` |
   | **mountains** | `EXACT` | `RANGE` | `RANGE` |

   The owner's rules: plains and plains see each other exactly; mountains see plains exactly; from plains
   and from forest only presence is seen in mountains; forest is always a range, never exact; the rest is a
   range.

   **[implemented, #429]** The table is public: `ruleset_public.vision.by_terrain.<source>.<target>` (`PROTOCOL_VERSION` 29) carries it to the client, which only displays it (the legend of the terrain map mode). The level of a place stays decided by the server (`node.detail` in the snapshot).
3. **What is visible about the enemy groups of a place** (a node or a half of an edge, item 5), by level:
   - `EXACT`: `units` and `charged` (sums over all enemy groups of the place), the modes;
   - `RANGE`: the range of the sum of `units` and the modes; `charged` is not shown (the owner, 2026-10-12);
   - `PRESENCE`: whether an enemy is there and the modes, without numbers;
   - `FOG`: the last seen (level, values, tick).

   The warehouse of an enemy city is not visible at any level: a warehouse is visible only at the sources (~~an own node, a node with an own group~~ **[superseded by DEC-35]**: the warehouse of an own node is known to its owner as own data; the warehouse of a foreign city only where an own group really stands, not at the node of a group on an edge: DEC-35, detail 2), as now.
4. **Ranges.** The lower bounds `vision.range_starts = [1, 3, 6, 11, 21]` give the ranges 1..2,
   3..5, 6..10, 11..20 and 21+ (in the interface "1-2", "3-5", "6-10", "11-20", "21+"). 0 units:
   no enemy. A range depends only on the number: no noise, the same on every tick.
5. **Edges and the border point.**
   - The road width (DEC-17, DEC-22; the road type was removed by DEC-26) is unchanged: an edge is not in the fog if at least one of its
     ends is a source. An edge between two non-sources is in the fog at any levels of the ends
     (**width**; for groups on it: **[clarified by DEC-33]**, the half of a visible node is visible even without a source on the edge).
   - The border point of an edge `border_permille` (DEC-23: in thousandths from the end `a`, 500 by default)
     divides the edge into the half of `a` and the half of `b`. The position of a group on the edge in thousandths from `a`:
     `progress` if it left `a`, otherwise `1000 - progress`. A group belongs to the half of the node
     it is now heading to if along the movement it is already at the border point or beyond it; otherwise to
     the half of the other end. For a bouncing group and a group that cancelled its order (DEC-20), "the node it is heading to"
     is the return node.
   - On an edge not in the fog the half of the source is visible as `EXACT`; the other half: with the level of its node
     (item 2). Hence the owner's rule: the exact number is revealed when an enemy group crosses
     the border point toward my node (or a node where my group stands), and before that the
     terrain table applies. **[amended by DEC-35]**: "my node" here means a node that is a source, that is, a node with an own group (or the node of the half of an edge an own group is in); toward an own node without a group the group is not revealed on the edge.
   - ~~Inside a half neither the position nor the direction of movement is shown (the owner, 2026-10-12): only
     that there is an enemy in the half, and the information by level.~~ **[superseded by DEC-33]**: in the half of a visible node
     an enemy group is visible with a continuous position and direction of movement (the DEC-33 block below).
6. **The target of an enemy's ordinary order is never shown** (DEC-04). The enemy's movement is visible
   only within vision: by the places of items 2 and 5.
7. **Scheduled orders and "Defense"** stay public intents (DEC-04, DEC-08); the mode
   "Defense" is visible at level `PRESENCE` and higher, it is not hidden.
8. **Memory.** `Sighting` stores the level (`EXACT`, `RANGE`, `PRESENCE`), the shown values
   (`units` or a range, `charged` only for `EXACT`), the modes and the tick; for an edge: by halves,
   plus the width and the type (DEC-17, DEC-22). In the fog the last seen is shown.
9. **The capacity** of nodes is public and exact (DEC-22): `capacity_stale` from DEC-17, item 3 is no longer needed.
10. A replay after the match shows the real state. Bots get the same `PlayerView`.

The numbers and the table in the ruleset (a new section `[vision]`): `range_starts = [1, 3, 6, 11, 21]`; the table
`[vision.by_terrain.<source terrain>]` with the target terrain keys and the values `"exact"`, `"range"`,
`"presence"` (the values from the table of item 2). The table in the ruleset is public, like all the rules (section 2,
invariant 2).

> **[superseded by DEC-35] for the examples that take my city as a source:** in the table below M (and M1, M2 in examples 8 and 9) is a source only because it is my city. Under DEC-35 it is a source only if an own group stands in it (or in its half of an edge); read examples 1-9, 11-15, 17 and 18 with "an own group stands in M" (the DEC-35 block has its own examples). Examples 10, 16 and 19-22 do not depend on this.

Worked examples. My city M, an enemy city E, the edge M-E (`a` = M, border point 500 unless
stated otherwise); in E there is an enemy group of 4 units, 3 charged, "Attack". Fog tests: exactly this table.

| # | Situation | What the owner of M sees |
|---|---|---|
| 1 | M plains, E plains | E: 4 units, 3 charged, "Attack" |
| 2 | M mountains, E plains | E: 4 and 3 |
| 3 | M plains, E forest | E: "3-5", no charges |
| 4 | M forest, E plains | E: "3-5" |
| 5 | M mountains, E mountains | E: "3-5" |
| 6 | M plains, E mountains | E: an enemy is there, "Attack", no numbers |
| 7 | M forest, E mountains | E: an enemy is there, no numbers |
| 8 | E forest; neighbors of E: own M1 (plains) and own M2 (mountains) | E: "3-5" (both sources give `RANGE`) |
| 9 | E plains; neighbors of E: own M1 (forest) and own M2 (mountains) | E: 4 and 3 (the best: `EXACT` from mountains) |
| 10 | E is not a neighbor of any source | fog: the last seen (level, values, tick) |
| 11 | E forest; a group from E goes to M, has passed 400‰ of the edge | in the half of E: "3-5" |
| 12 | as 11, the group has passed 500‰ | in the half of M: 4 units, 3 charged |
| 13 | border point 700 from M (`a` = M); a group from E goes to M | the half of E until the group has passed 300‰ from E; from 300‰: exact |
| 14 | a group bounced off M and goes back to E, now at 400‰ from M | in the half of M: exact |
| 15 | an enemy group with an ordinary order leaves E | the target is not shown; the group is visible in the half of E by the level of E |
| 16 | E: a scheduled order E→M | the intent E→M is visible to everyone, as now |
| 17 | E in "Defense" | the mode is visible (level `PRESENCE` and higher), the intent of "Defense" is public |
| 18 | the edge E-F, E and F are neighbors of M, both not sources | ~~the edge is in the fog: groups on it are not visible, the width and the type are the last seen~~ **[superseded by DEC-33]**: the width is the last seen (DEC-17); both halves of the visible nodes are visible, the groups on them with position and direction (example 4 in DEC-33) |
| 19 | E has 1, 2, 3, 10, 25 units, level `RANGE` | "1-2", "1-2", "3-5", "6-10", "21+" |
| 20 | E has two enemy groups of 2 and 2 units, level `RANGE` | "3-5" (by the sum) |
| 21 | an own group stands in a neutral N (forest); E (plains) is a neighbor of N | N: a source, all exact; E by the pair forest → plains: "3-5" |
| 22 | the warehouse of E at any level | not visible |

What the implementation changes (simulation and `SIM_VERSION`, protocol and `PROTOCOL_VERSION`, client, bots, rulesets): the list is in #233.

Alternatives (not chosen):
- Random noise on the numbers in every tick (violates invariant 3 "no randomness" in spirit and cannot be checked in one's head).
- A range for `charged` too (more information; it can be turned on without changing the form of the ranges).
- ~~Showing the position and direction of an enemy group inside a half of an edge.~~ **[chosen by DEC-33]**.
- Revealing the exact number when an order is given (no window of uncertainty).
- Vision by group size (section 10, outside the MVP).

### Enemy barracks are visible at neighboring cities (DEC-31, #316) **[accepted]**

The owner's decision of 2026-10-21 (playtest feedback). Changes the fog of barracks of DEC-25 and DEC-26: ~~the barracks of a foreign city is hidden~~ **[superseded by DEC-31]** (notes in section 3, "Barracks", item 6, and in section 8, the DEC-26 block, item 10; AGENTS.md, 4.4). Implementation: #319.

**The owner's decision [accepted].**

1. **Who is visible.** For an enemy city connected by a road (an edge of the map graph) to any own node, the player sees whether the barracks is built. Adjacency is counted by the edges of the map file, not by vision and not by the fog (the graph is public, section 10, DEC-04).
2. **What is visible.** Only a built barracks. Still hidden: the construction of a barracks, the recruit queue (DEC-25, item 12), the warehouse and its level, the warehouse capacity, construction (DEC-26, item 10).
3. **There is no memory.** The city stopped being adjacent (the own node next to it is lost) or changed owner: the information about the barracks disappears.
4. **This is about cities.** The owner wrote "in provinces", but provinces have no barracks (DEC-23, section 9: a node without a city and a warehouse, `Recruit` is rejected with `NOT_CITY`); the rule is written for cities. The own node that is the source of adjacency may be both a city and a province.

> **Not affected by DEC-35 (#477):** "the source of adjacency" here is an own node by ownership and the public map graph (item 1: "not by vision and not by the fog"), not a vision source. An own node without an own group still makes an adjacent enemy city show its built barracks. Recorded as a reading in the PR of DEC-35 (open question 4).

**Details [accepted]** (confirmed by the owner on 2026-10-21):

- **[accepted]** For an adjacent foreign city `NodeView.has_barracks` is `True` (built) or `False` (no barracks or it is still under construction), for the other foreign cities and for neutral ones `None` (unknown; neutral ones have no barracks). `Sighting` is not extended: the field is computed as a projection from the current ownership and the map graph.
- **[accepted]** With `city_upgrades.enabled = false` every city has a barracks (DEC-26, item 1), so an adjacent enemy city shows `True`.

**Examples** (ruleset `mvp-1`, `city_upgrades.enabled = true`; E is an enemy city):

| No. | Situation | What the player sees |
|---|---|---|
| 1 | E has a built barracks, E is connected by an edge to my city M | `has_barracks = True` |
| 2 | E has a barracks under construction (or none), E is connected by an edge to my node | `False`; construction, queue and warehouse are not visible |
| 3 | E has a barracks, my nearest node is across one foreign node (there is no edge between E and my node) | `None` |
| 4 | as 1, but E is connected only to my province | `True` (any own node serves as the source of adjacency) |
| 5 | as 1, M is captured, E has no other own nodes of mine linked to it | `None` (there is no memory) |

Fog test: exactly this table, plus the warehouse and recruit queue fields stay `None` in rows 1 and 4.

**Implementation** (#319; `PROTOCOL_VERSION` 23, `SIM_VERSION` does not change: the rule is projection-only,
the state and the step are the same, the golden replays are the same): `gow_sim.view.project()` computes adjacency from
`MapDef.incident` and the current owners; `NodeView.has_barracks` of an enemy city can arrive at
any `detail` without the warehouse fields (the protocol validator); the client draws the same little house as for its own
city. Tests: `packages/sim/tests/test_dec31.py` (examples 1-5 and the details), the fog property test in
`test_view.py`, the protocol frame in `test_convert.py`.

Alternatives (not chosen):
- Show the barracks only by ordinary vision (DEC-21): a neighboring city often stays in the fog, and the barracks is not visible.
- Remember the last seen barracks (`Sighting`): the information would not disappear when adjacency is lost.

### Visible movement of enemy groups in the vision zone of a node (DEC-33, #296) **[accepted]**

The owner's decision of 2026-10-21 (from a playtest screenshot): "everything beyond the field of view (in the fog) I do not see; I see how enemy units enter a node and leave it, that is, all their movements only in my vision zone; with the terrain table more or less information is visible". Replaces in DEC-21, item 5, the phrase "neither the position nor the direction of movement is shown inside a half" (struck through above). Implementation together with DEC-21: #296.

**The owner's decision [accepted].**

1. **The vision zone of a node.** A visible node: a vision source (DEC-21, item 1, ~~own nodes and nodes with own groups~~ **[superseded by DEC-35]**: nodes with own groups and the node of the half an own group on an edge is in) or a node with level `EXACT`, `RANGE` or `PRESENCE` by the DEC-21 table, item 2. The vision zone of a visible node: its halves of edges, that is, from the node to the border point `border_permille` of each edge (DEC-23, item 5); the zone coincides with the territory of the node on the map. A `FOG` node gives no zone.
2. **What is visible in the zone.** In the half of an edge belonging to a visible node, an enemy group is visible with a **continuous position and direction of movement**: the figure moves smoothly (entering the zone through the border point, moving toward the node, leaving the node and going away to the border point). The information about numbers by the level of this half, as in DEC-21, items 3 and 5: the half of a source is `EXACT`; the half of a visible neighbor by its level (`EXACT`, `RANGE`); `PRESENCE`: a figure without numbers.
3. **Fog.** The half of a node in the fog is not visible at all: at the border point the group disappears into the fog (further the "last seen" memory, DEC-21, item 8) and appears out of the fog at the border point.
4. **Unchanged.**
   - The target of an enemy's ordinary order is hidden (DEC-21, item 6): the direction is shown only by the nearest node of the edge the group is heading to.
   - The warehouse and the contents of cities (DEC-21, item 3), construction and the recruit queue.
   - The road level in the fog (DEC-17): the width of an edge is visible only while the edge is not in the fog by the edge level; the half of a visible node on an edge between two non-sources does not reveal the width (example 4 below; the leak through speed: item 9 of "Details").
   - ~~A group on an edge gives no vision (#112 stays open).~~ **[superseded by DEC-10]**: an own group on an edge makes the halves of its edge at least `PRESENCE`. **[superseded by DEC-35]**: it is a source as if it stood in the node of its half, and the zone of that node and of its visible neighbors follows (DEC-35, item 3).
   - Enemy supply packets are not visible (DEC-04, DEC-10).

The zone borders are the same as for the halves of DEC-21, item 5: a group belongs to the half of the node it is heading to if it is at the border point or beyond it, otherwise to the half of the other end (exactly at the border point: to the half of the node it is heading to; for a bouncing group and a group that cancelled its order, DEC-20, this is the return node).

**Details [accepted]** (the owner accepted all items as recommended on 2026-10-21; a fog test for every field and item; implemented in #296):

1. **[accepted]** **Position precision.** `PlayerView` gives the position of a group as an integer in thousandths of the edge from the end `a` (`pos`, 0..1000, like `progress` in DEC-21, item 5), without rounding. **Recommendation:** exact thousandths; the client interpolates between frames (section 18), anything coarser hides nothing (the speed is public by the rules, section 4) but gives jerkiness.
2. **[accepted]** **Direction.** One boolean field: "toward the end `b`" or "toward the end `a`" (`toward_b`), that is, the nearest node of the edge the group is heading to (including a bounce and an order cancellation, DEC-20: the real direction of movement; on a turnaround the field changes, the reason is not revealed). No paths, targets or the rest of the route. **Recommendation:** this way.
3. **[accepted]** **The shape in `PlayerView`.** A new list in `EdgeView` (the name `enemy_groups`): one element per enemy group in a visible half: `id`, `pos`, `toward_b`, the mode and the information by the level of the half. The information per group, not as a sum: `EXACT` gives the group's `units` and `charged`, `RANGE` gives the range of its `units` (the bounds `vision.range_starts`, DEC-21, item 4), `PRESENCE` gives no numbers. The sum over a place (DEC-21, items 3 and 20) stays for a node; for a half of an edge the list replaces it. **Recommendation:** this way (different groups travel at different points, they cannot be drawn as a sum). The price: a split of 2+2 units is visible at `EXACT` and `RANGE`; accepted as the cost of a continuous position.
4. **[accepted]** **Several groups in one half.** Each as a separate figure with its own `pos`; the order in the list by `id`. Two groups at one point are drawn separately (the client). **Recommendation:** this way.
5. **[accepted]** **The opaque id of a figure.** The client needs it for smooth interpolation between frames. The rule: the id of an enemy figure is keyed blake2b of the secret `match_key` (AGENTS.md, 4.4), the internal id of the group and the tick when it appeared in the zone, therefore **after leaving into the fog and reappearing the id is different**: the player does not track a group through the fog and does not learn that two figures were one group. **Recommendation:** this way; test: a group leaves the zone and returns, the ids differ; the internal id does not reach `PlayerView`.
6. **[accepted]** **A group in a fight on an edge.** A fight is public and exact (DEC-24, item I.1, `PlayerView.fights`: the place and `point`), a group in a fight stands at the point of the fight. The figure in the list of the half is **not duplicated** for it: the fight shows it; in the node and the half its information by level stays in the sum of the place, as now. **Recommendation:** this way (otherwise a duplicate and a divergence of numbers: the fight shows exact numbers even at level `RANGE`).
7. **[accepted]** **A group leaves a node and enters a node.** A group standing in a visible node is given in the `seen` of the node (as now, as a sum per DEC-21); from the moment it leaves onto the edge it is a separate figure with `pos` near the end of this node. Arrival at a node: the figure disappears from the list, the group enters the sum of the node in the same frame (for an arrival with auto-merge, DEC-20, nothing changes). **Recommendation:** this way.
8. **[accepted]** **Memory on leaving into the fog.** The "last seen" memory (DEC-21, item 8) stores per half: the level, the shown values, the modes and the tick; **there are no positions and directions in memory** (less state in `state_hash()`, no "ghost moving without data"). In the fog the client draws a memory marker of the half (for example at the border point), not a moving figure. **Recommendation:** this way.
9. **[accepted]** **Speed and road level (a leak).** The speed of a group on an edge depends on the road level (section 4, item 9; the level is taken on leaving onto the edge), so from the travel time through a visible half the road level can be estimated even if the edge is in the fog per DEC-17. **Recommendation:** accept the leak (the estimate is rough: it needs a time measurement and knowledge of the terrain; DEC-17 protects the display of the width, not a deduction from speed); `EdgeView.width` and the width memory are still updated only per DEC-17. Alternative: do not show the position on edges where the width is in the fog (it would break example 4 and the owner's decision).
10. **[accepted]** **Versions.** `SIM_VERSION`++ (the per-half form of the `Sighting` memory changes `state_hash()`; in one bump together with DEC-21: implemented in #296) and `PROTOCOL_VERSION`++ (the list in `EdgeView`, AGENTS.md, section 6; regenerating `protocol.gen.ts`). The ruleset is unchanged: there are no numbers in DEC-33, we do not introduce a flag (as with DEC-04 and DEC-17). **Recommendation:** this way, in #296.
11. **[accepted]** **Replay and bots.** The file of full replay frames shows the real state, DEC-33 does not change it. Bots get the same `PlayerView` and can read `enemy_groups`; direct access to the state is still forbidden (AGENTS.md, section 2). **Recommendation:** this way.
12. **[accepted]** **Budgets.** `project()` walks the groups once; the list is bounded by the number of enemy groups in the visible halves, it fits in the 0.3 ms budget (AGENTS.md, section 12); to be checked with a `project()` benchmark in #296. **Recommendation:** this way.

No numbers in the ruleset are needed. Fog tests at implementation: exactly this table plus one test for each item of "Details" above.

> **[superseded by DEC-35] for the examples that take my city as a source:** M is a source below only if an own group stands in it (or in its half of an edge); the DEC-35 block has its own examples. Example 13 is superseded twice (DEC-10, then DEC-35).

Worked examples. My city M (plains, a source) and the edge M-E, `a` = M, border point 500 unless stated otherwise; `pos` in thousandths from `a`; the enemy group is 4 units, 3 charged, "Attack", travels from E to M.

| # | Situation | What the owner of M sees |
|---|---|---|
| 1 | E plains (`EXACT`), the group at `pos` 800 | a figure at 800, toward `a`, 4 and 3 (the half of E is visible by the level of E) |
| 2 | as 1, `pos` 500 (at the border point) | a figure at 500, toward `a`, 4 and 3 (the half of M, a source) |
| 3 | E mountains (`PRESENCE`), the group at `pos` 800 | a figure at 800, toward `a`, no numbers |
| 4 | M is a source; E and F are visible neighbors (forest, forest, `RANGE`), the edge E-F between non-sources, the group travels from E to F, `pos` on the edge E-F 300 (from E) | a figure at 300, toward F, "3-5"; the width of the edge E-F is the last seen (DEC-17) |
| 5 | F is not a neighbor of M (`FOG`), E is visible (forest), the group goes from E to F: up to the border point E-F | a figure in the half of E; it disappears at the border point; there is no figure in the half of F; the memory of F: the last seen (DEC-21, item 8) |
| 6 | as 5, the group returns from F to E | not visible in the half of F; it appears at the border point in the half of E with a new `id` (item 5 of "Details") |
| 7 | E and F both `FOG`, the edge E-F | there are no halves: no groups are visible |
| 8 | a group travels from E to M with an ordinary order to Z through M | a figure toward M; the target Z is not shown (DEC-21, item 6) |
| 9 | a group at `pos` 400 turned around (bounce, cancellation) | a figure at 400, `toward_b` changes to the opposite, the reason is not visible |
| 10 | border point 700 from M; a group from E travels to M, the edge M-E | at `pos` > 700 the half of E (by the level of E), at `pos` ≤ 700 (including 700) the half of M, exact |
| 11 | in the half of E two enemy groups, at 800 and 650 | two figures with different `id` and their own information (items 3 and 4 of "Details") |
| 12 | a group in a fight on an edge, in the half of E | visible in the fight (`fights`, `point`), there is no separate figure |
| 13 | an own group stands on the edge E-F, no sources nearby | ~~an own group gives no vision (#112): no figures~~ **[superseded by DEC-10]**: the halves of E-F are `PRESENCE`, an enemy group on E-F is a figure without numbers **[superseded by DEC-35]**: the own group is a source in the node of its half (E or F); the enemy figure has the level of its half by the terrain table (the DEC-35 examples 3 and 4) |

What the implementation changes (simulation and `SIM_VERSION`, protocol and `PROTOCOL_VERSION`, client, bots): the list is in #296.

Alternatives (not chosen):
- The position only in the half of a source (the owner chose the zone of a node, not only of a source).
- The position only without the direction (the direction is needed to tell "enters" from "leaves").
- A coarse position (jerks tick by tick; adds no secrecy).

### Vision of a group on an edge and enemy packets (DEC-10, #112) **[accepted]**

The owner's decision of 2026-10-26 (the last comment on #112). Closes the open item of DEC-04 (#112) and replaces
"a group on an edge gives no vision" in DEC-21, item 1 and DEC-33, item 4 (struck through above); example 13 of
DEC-33 changes accordingly. Implementation: #112.

Owner confirmed on 2026-10-28: (1) a group on an edge makes `EdgeView.detail` PRESENCE, so the exact road level and
enemy construction on that edge are visible; (2) an enemy group standing in an end node stays hidden until it steps
onto the edge; (3) a half in fog rises only to PRESENCE, never to RANGE or EXACT.

> **Superseded by DEC-35 (#477), block below:** a group on an edge is now a vision source as if it stood in the node of its half (by the border point). Confirmations (2) and (3) and decision item 1, details 1 to 4 and the examples 1, 2, 3, 5, 6 and 10 are superseded (marked in place); confirmation (1), details 5 to 7 (with the source named differently), 8 (with the half's level from DEC-35) and 9 and 10, decision item 2 and the examples 4, 7, 8 and 9 stay. The "edge source" as a separate kind of source no longer exists.

**The owner's decision [accepted].**

1. ~~An own group on an edge is a vision source for that edge only: it sees its own edge at the level
   "an enemy is there and its mode" (as for an adjacent edge), not the end nodes.~~ **[superseded by DEC-35]**: an own group on an edge is a source as if it stood in the node of its half (DEC-35, item 3).
2. Enemy supply packets stay hidden on all edges, as before.

**Details [accepted]** (written by the implementation in #112 in the terms of DEC-17, DEC-21 and DEC-33; where the
decision leaves room, the reading that reveals less is taken, the open points are listed in the PR of #112):

1. **[superseded by DEC-35]** (a group on an edge is a source in the node of its half; the cases listed here, bouncing, turned back, in a fight, ends lost on the way, all stay sources, DEC-35, detail 6) **The edge source.** Every own group whose place is an edge (`OnEdge`) makes that edge an edge source of its
   player: a group on the way, bouncing or turned back (DEC-07, DEC-20), in a fight on the edge (DEC-24), whoever
   owns the ends, also when the node it left was lost while it was on the way. Own packets give no vision. A group
   standing in a node (also one waiting for the departure of a scheduled order) is a node source as before (DEC-21,
   item 1).
2. **[superseded by DEC-35]** (the half of the group's node is a source half, `EXACT`; the other half has the level its node gets by the terrain table, never lower than `PRESENCE`) **The halves of its edge.** While the edge is an edge source, the level of each of its two halves (DEC-21,
   item 5) is the better of the level of the half's node and `PRESENCE`. So the half of a `FOG` node becomes
   `PRESENCE`; the half of an `EXACT`, `RANGE` or `PRESENCE` node keeps its level. An edge source never makes a half
   `EXACT` or `RANGE`: "the half of the source is `EXACT`" of DEC-21, item 5 is about node sources only.
3. **[superseded by DEC-35]** (a half shows what its level shows: `EXACT`, `RANGE` or `PRESENCE` by DEC-21, items 3 and 5, and DEC-33) **What such a half shows** is the `PRESENCE` level of DEC-21, item 3 and DEC-33, item 2, unchanged: the modes of
   the enemy groups in the half (`HalfView.seen`) without numbers, and every enemy group of the half not in a fight
   as a figure (`EdgeView.enemy_groups`) with `pos`, `toward_b` and the mode, without numbers. This is what "as for
   an adjacent edge" means after DEC-33: the half of a `PRESENCE` neighbor on the edge of a source shows exactly
   this. A figure that comes into sight through an edge source gets a new opaque id (DEC-33, detail 5).
4. **[superseded by DEC-35]** (the end node of the group's half is revealed as a source; the far end gets its table level; an enemy standing in the node of the group's half is seen) **The end nodes are not revealed.** Node levels come from node sources only (DEC-21, items 1 and 2). An edge
   source does not change `NodeView.detail` or `NodeView.seen` of its ends, does not show their warehouse, gives
   no levels to their neighbors by the terrain table, and is not an own node for the barracks of DEC-31. An enemy
   group standing in an end node is not seen through the edge source; once it leaves the node onto the edge, it is a
   figure in the half (DEC-33, detail 7). The other edges of the end nodes and their halves do not change.
5. **The road level (DEC-17, item 8).** **[stays under DEC-35; the cause is the source node at the end of the edge]** An edge source takes its edge out of the fog of DEC-17: `EdgeView.detail` is
   `PRESENCE` while an own group is on the edge, so its road level is shown exactly and remembered (DEC-17, items 1
   and 7), and an enemy road build on it is visible (DEC-17, item 5). This is intended, also at the `PRESENCE`
   level: DEC-17 has only two edge levels, `PRESENCE` (not in the fog) and `FOG`, and item 8 of DEC-17 tied the
   width to the edge level in advance; the group travels on this road, and its own speed already tells the level the
   road had when the group left the node (section 4). No other edge leaves the fog through the group.
6. **Enemy packets** are not visible on any edge, the edge of an own group included: no `PlayerView` field and no
   event (DEC-04; section 7, DEC-18, item 8). The alternative "packets as a fact on edges of level `PRESENCE`" was
   not chosen.
7. **Memory.** The `vision` system records an edge source like any other place in sight (DEC-21, item 8; DEC-17,
   item 7): the `PRESENCE` sighting of each half (the modes, the tick; no positions, DEC-33, detail 8) and the road
   level. When the group leaves the edge (arrives in a node, merges, dies), the halves return to the level of their
   nodes; a half that falls into the fog keeps its last sighting, the edge keeps the last seen road level.
8. **A fight on the edge.** The enemy groups of the fight are shown by the fight, exactly (DEC-24, item I1; DEC-33,
   detail 6); another enemy group on the same edge (a reinforcement on the way, a group passing by) is a figure of
   its half's level (item 2, **[amended by DEC-35]**: the level of the half by DEC-35).
9. **Symmetry, numbers, versions.** The rule is the same for both players and has no numbers: no ruleset flag
   (like DEC-04, DEC-17, DEC-33). `SIM_VERSION`++ (the fog memory is part of `state_hash()`, new golden replays).
   The shape of `PlayerView` does not change; the descriptions of `HalfView.detail` and `EdgeView.detail` in the
   protocol schema do, so `PROTOCOL_VERSION`++.
10. **Interface** (the client, a separate task): a half whose `detail` is not `fog` is drawn as seen even when its
    node is under the haze, and its figures are not covered by the haze of the node.

> **[superseded by DEC-35] examples 1, 2, 3, 5, 6 and 10 below**: they assume that my capital M is a source because it is mine (X is `EXACT`) and that a group on an edge shows only `PRESENCE` and not the end nodes. Examples 4, 7, 8 and 9 stay. The DEC-35 block has its own examples on the same map.

Worked examples. The map M - X - E - F: M (node 0) my capital, plains; E (node 1) the enemy capital; X (node 2) and
F (node 3) neutral; all plains; the edges e0 = M-X, e1 = X-E (`a` = X), e2 = E-F (`a` = E), border points 500. X is
`EXACT` (plains from plains), E and F are `FOG` (no node source next to them). My group G (2 units, 2 charged) is on
e2 unless stated otherwise; the enemy group is 4 units, 3 charged, "Attack". Fog tests: exactly this table.

| # | Situation | What I see |
|---|---|---|
| 1 | G on e2 at `pos` 500 | both halves of e2 `PRESENCE`, no enemy; e2 `detail` `PRESENCE`, its road level exact; E and F stay `FOG` (their `seen` the last sighting, no warehouse); the half of E on e1 stays `FOG` |
| 2 | as 1, an enemy group on e2 at `pos` 300 going to F | a figure at 300, toward `b`, `PRESENCE`, "Attack", no numbers; `HalfView.seen` of the half of E: "Attack", no numbers |
| 3 | as 1, the enemy group stands in E | not visible: E stays `FOG`, the halves of e2 show no enemy |
| 4 | as 1, an enemy packet on e2 | not visible: no field, no event |
| 5 | G on e1 at `pos` 600, from X; an enemy group on e1 going to X, at `pos` 800, then at 400 | at 800: the half of E, `PRESENCE`, a figure without numbers; at 400: the half of X, `EXACT` by the level of X, 4 and 3 |
| 6 | G in a fight on e2 with an enemy group; a second enemy group on e2 goes to the fight | the fight shows the enemy of the fight exactly (`fights`); the second group is a `PRESENCE` figure; the first is not a figure (DEC-33, detail 6) |
| 7 | G left F, F was mine and was captured while G is on the way | as 1: e2 is still an edge source |
| 8 | E builds a road level on e2 (an internal edge of the enemy: F is the enemy's too); the real level is 2, the last seen 1 | the build is visible (no end tick), the road level 2 |
| 9 | as 2, then G is no longer on e2 and stands in neither E nor F (for example it died) | the halves of e2 go back to `FOG` and keep the last sighting (the half of E: "Attack" and the tick); e2 is in the fog with the last seen road level |
| 10 | DEC-33, example 13: my group on the edge E-F, no sources nearby, an enemy group on the same edge | a `PRESENCE` figure, no numbers |

Alternatives (not chosen):
- A group on an edge gives no vision (the default of #112, the literal DEC-04): the group could not see the enemy on
  its own road before the meeting.
- An edge source sees its edge exactly, or by the terrain table: more than "an enemy is there and its mode".
- An edge source shows the presence without positions: a new kind of half that does not exist since DEC-33.
- Enemy packets visible as a fact on edges of level `PRESENCE`.

### Vision comes only from units: own nodes are no longer vision sources (DEC-35, #477) **[accepted]**

The owner's decision of 2026-10-28, a rule change after the mechanics freeze (the status line at the top of this document), accepted by the owner and implemented before the smart bots (#166) and the balance gate (#40), which depend on the fog. Implementation: #477.

**Why.** Today an empty own province (or city) gives vision on its neighbours (DEC-04, DEC-21, item 1: "own nodes and nodes where own groups stand"). This reads as illogical: vision should come from the units themselves, and terrain shapes what they see. An enemy near your capital is still noticed through the public ownership of the map (captured territory).

**The owner's decision [accepted].**

1. **Vision sources are own groups only.** An own node without an own group is not a vision source: this holds for provinces, cities and the capital alike. Terrain still decides what a group sees (the DEC-21 table, with the group's node as the source).
2. **An enemy in an own node without an own group** is visible at the `PRESENCE` level (an enemy is there and its mode, no numbers). The own data of the node (warehouse, recruit queue, construction) stays fully known to its owner.
3. **A group on the way.** A group on an edge is a vision source as if it stood in the node whose half of the edge it is in (by the border point `border_permille`, DEC-21 item 5 and DEC-23 item 5), with that node's terrain: before the border point it sees from the node it left, after it from the node it is heading to. Consequence accepted by the owner: after crossing the border point toward an enemy node, the group sees that node as a source (its garrison exactly) before arrival, mirroring the DEC-21 rule that an enemy crossing the border point toward my node is revealed exactly.

**What it supersedes** (each place is marked **[superseded by DEC-35]** or **[amended by DEC-35]** in its own block, the old text is kept):

| Where | What is superseded |
|---|---|
| Section 10, the information ladder, item 4 | "your node ... everything exactly" |
| DEC-04 | "Exactly: own nodes and nodes where own groups stand"; the sources "own nodes" [superseded by DEC-35] |
| DEC-17, item 1 | the end "seen exactly" as an own node; "own internal edges are always visible"; "a buffer edge with an own end is seen exactly" |
| DEC-21, item 1 | the vision sources; the clause "a group on an edge is a source for its edge only" (already changed by DEC-10) |
| DEC-21, item 2 (amended), item 3 (the warehouse), item 5 (the exact number toward "my node") | own nodes as sources; examples 1-9, 11-15, 17, 18 (note before the table) |
| DEC-10, decision item 1, confirmations (2) and (3), details 1 to 4, examples 1, 2, 3, 5, 6, 10 | the "edge source" and "the end nodes are not revealed" |
| DEC-33, item 1 (the sources), item 4 (the group on an edge), example 13, the examples with "M, a source" | the same |
| Section 8, DEC-28, the `UpgradeRoad` rejection details | "an internal edge is never in the fog" |
| Section 4, DEC-24, the fight on an edge | "a group itself shows only the level `PRESENCE`" |
| Section 16 (rejected) | a row added |

Not affected: DEC-31 (adjacency of the barracks is by ownership and the public graph, not by vision; see the note in its block), DEC-17 items 2 and 4 to 8 (the memory and the rest), DEC-21 items 4, 6 to 10, DEC-33 items 2, 3 and the details, DEC-10 items 5 to 10 in substance (the road level of an edge with an own group, packets, memory, fights).

**Details [accepted]** (the owner confirmed all items 1 to 10 as written on 2026-10-29; written by the DEC author in the terms of DEC-10, DEC-17, DEC-21 and DEC-33; where the decision leaves room, the reading that reveals less is taken; a fog test for every item):

1. **The sources.** A vision source is a node. A node is a source when (a) an own group stands in it (also a group waiting for the departure of a scheduled order and a freshly recruited group), or (b) an own group on an edge (`OnEdge`) is in the half of the edge that belongs to this node (item 6). Own packets give no vision. Everything else in DEC-21 works on this set of source nodes unchanged: the table of item 2, the best level of several sources, the edge is not in the fog if at least one of its ends is a source (item 5), the zone of a visible node and the figures in it (DEC-33). The separate "edge source" of DEC-10 does not exist any more: a group on an edge is a node source (item 3 above).
2. **What a source node shows.** At a source node the enemy groups are seen at `EXACT` (`units`, `charged`, modes). The warehouse, the warehouse level, the recruit queue and the construction of a **foreign** city are shown only where an own group **really stands** in it (as before, DEC-21 item 3). At the node of the half of a group on an edge these are **not** shown: the group sees the garrison exactly (the owner's consequence of item 3), but it does not see into the city. (The reading that reveals less.)
3. **The level of a node.** For the enemy groups of a node the level is the best of: the level from the sources by the DEC-21 table; `EXACT` if the node is a source; `PRESENCE` if the node is **own**. So an own node is never in the fog for enemy presence: an enemy in an own node without an own group is seen at `PRESENCE` at any time, without the "last seen" delay, and the memory of such a node is not needed. The own data of the node (warehouse, level, recruit queue, construction, barracks, production) stays exact for the owner whatever the level. A neutral or an enemy node gets no such level.
4. **The `PRESENCE` of an own node is a level of the node only.** It does not make the node a source: it gives no level to the neighbours, it is not a node of "level `EXACT`, `RANGE` or `PRESENCE` by the DEC-21 table" of DEC-33, item 1, so the halves of an own node without a source get no zone: an enemy group on the way to my node is not seen on the edge (it is not a figure there, no memory marker) until it is in the node, and in the node it is at `PRESENCE`. A scheduled order of the enemy, a fight (public to both of its sides, DEC-24) and the ownership change stay visible as before. (The reading that reveals less.)
5. **Own roads and own data.** An own internal edge without a source on it is in the fog for enemy presence (item 1), but its road level and the own construction on it stay exactly known to the owner: this is own data, which only the owner changes (as the warehouse of an own node in item 2 of the decision). The representation in `PlayerView` (a separate flag or the width independent of `EdgeView.detail`) is the implementation's choice; the visible fact is: the owner always sees the level and the construction of their own internal edges. For the commands, an own internal edge always counts as known (`UpgradeRoad` is not rejected with `NOT_FOUND_OR_HIDDEN`; the answer reveals nothing). A buffer edge or an enemy edge: only by the rules of DEC-17 (not in the fog if an end is a source; otherwise the last seen width, `base_width` if never seen). (The reading that reveals less.)
6. **The node of the half.** The half is found by the rule of DEC-21 item 5 and DEC-33 (the border point `border_permille`, DEC-23 item 5): geometrically, the position of the group on the edge decides which half of the border point it is in; exactly at the border point the half of the node the group is heading to. For a bouncing group and a group that cancelled its order (DEC-20) the node it is heading to is the return node. A group in a fight on an edge stays at the point of the fight and is a source of the node of the half of that point (the heading is that of its movement before the fight). A group that has just left a node (`progress` 0) is in the half of this node. The rule is the same for the group of either player and uses only public data and the group's own position, so the player learns nothing new. If the node of the half was lost while the group is on the way, the group is still a source in that node (as DEC-10, detail 1, for the ends lost on the way): vision does not depend on who owns the node.
7. **Edges, memory and the rest.** The edge on which the group is, is not in the fog (its end in the group's half is a source): its road level is exact and remembered and an enemy construction on it is visible (DEC-17, items 1, 5, 7), as DEC-10, item 5 said; the other half of the edge has the level of its node by the table from the source node (never lower than `PRESENCE`, because the nodes are neighbours by this edge), so DEC-10's guarantee "both halves at least `PRESENCE`" holds as a consequence and not as a separate rule. The `vision` system records the sightings of a source node and its halves as it does for any source (DEC-21, item 8); when the group crosses the border point, leaves the edge or dies, the places fall to their new levels and keep the last sighting. Enemy supply packets are not visible on any edge (DEC-10, item 6).
8. **Unchanged.** The terrain table and `vision.range_starts`; the public ownership and VP; the scheduled orders and "Defense" as public intents; the target of an enemy ordinary order is hidden; the fog events; the fights are public and exact to both sides; DEC-31. There are no numbers: no ruleset flag (as DEC-04, DEC-17, DEC-33).
9. **Symmetry and information.** The rule is the same for both players. A player loses vision of the neighbours of their empty nodes and of the edges around them, so more of the map is in the fog; they keep the public ownership (an enemy that took a node is noticed through it), the scheduled orders, the fights and the `PRESENCE` of an enemy in their nodes. This is the intended effect: a garrison or a scout is needed to see.
10. **Versions and the rest** (for the implementation, #477): `SIM_VERSION`++ (the vision and the fog memory change, `state_hash()` changes), new golden replays (AGENTS.md, section 4.5); `PROTOCOL_VERSION`++ and a regeneration of `protocol.gen.ts` only if a field of `PlayerView` changes (for example the width of an own edge in the fog, item 5), the descriptions of `detail` in the schema change anyway; a fog test for each item and each example; the mirror and property tests; bots read the same `PlayerView` (they must not assume vision from empty nodes); the smoke tournament `--seeds 3` on `mvp-1`. The client draws no rules. **The owner's decision of 2026-10-29:** the whole own territory is drawn **without** the fog veil: own nodes (never in the fog, detail 3: their own data exact, an enemy inside shown at `PRESENCE`) and own internal edges, also those without a source on them; the rule of detail 5 does not change (an enemy on an own internal edge without a source is still not in `PlayerView`), only the look. Only foreign (neutral or enemy) places outside vision are under the veil (the dev scene and the shots, AGENTS.md, section 7.5). **The owner's decisions of 2026-10-29 on two readings of the implementation (#488):** (a) the own half of a **buffer** edge (from the own end to the border point) is part of the own territory and is drawn without the fog veil too, also without a source on the edge; the foreign half keeps the fog look when it is outside vision (only the look, as above; an enemy on that half without a source is still not in `PlayerView`, detail 4); (b) the road level of an own internal edge is also written into the fog memory (`VisionMemory.widths`, DEC-17, item 2), so a road the player loses later keeps the level its owner last knew, not an older sighting or `base_width`.

Worked examples. The map M - X - E - F as in DEC-10: M (node 0) my capital, plains; E (node 1) the enemy capital; X (node 2) and F (node 3) neutral or mine; M and X are mine unless stated otherwise; the edges e0 = M-X, e1 = X-E (`a` = X), e2 = E-F (`a` = E), border points 500; M, X, E plains, F forest. The enemy group is 4 units, 3 charged, "Attack". Fog tests: exactly this table.

| # | Situation | What I see |
|---|---|---|
| 1 | I have no groups at all; the enemy group stands in my X | X: "an enemy is there", "Attack", no numbers (item 2 of the decision); the warehouse and the queue of X are exact; M and the edges: no enemy shown, nothing is a source |
| 2 | as 1, my group stands in M (plains) | M is a source; X is its neighbour plains to plains: `EXACT`, the enemy is 4 and 3 (the best of `EXACT` and the own `PRESENCE`, detail 3) |
| 3 | I have no groups; the enemy group travels on e0 toward M, at `pos` 700 | not visible: M and X are not sources, own nodes give no zone (detail 4); the road level of e0 is exact (detail 5); when the group arrives in M: M shows "an enemy is there", "Attack" |
| 4 | my group G on e1 at `pos` 300 (from X toward E) | G is in the half of X: X is a source, `EXACT`; X's neighbours by the table: M `EXACT`, E (plains from plains) `EXACT`: the enemy garrison of E is 4 and 3 if it stands there; the warehouse of E is not shown (detail 2); e1 is not in the fog, its road level is exact |
| 5 | as 4, G at `pos` 500 (the border point; heading toward E) | G is in the half of E (the node it is heading to): E is a source, `EXACT` (the owner's consequence, item 3); X is a neighbour of E, `EXACT`; F (forest from plains): `RANGE`; e2 is not in the fog |
| 6 | as 4, G at `pos` 600, bounced and going back to X | still in the half of E (geometrically past the border point): E is a source; at 500 it passes to the half of X (heading to X) |
| 7 | as 4, an enemy group on e1 at `pos` 800 going to X | the half of E has the level `EXACT` (from the source X, plains to plains): a figure at 800, toward `a`, 4 and 3; (DEC-10 had `PRESENCE` here) |
| 8 | G on e2 at `pos` 300 (from E toward F) | G is in the half of E: E is a source (the garrison seen exactly), F (forest from plains) `RANGE`; an enemy standing in F is "3-5"; the halves of E (on e1 and e2) are halves of a source, `EXACT` |
| 9 | as 8, G is a group of mine in a fight on e2 with an enemy group | the fight shows the enemy of the fight exactly (`fights`, DEC-24); G is a source in the half of its fight point (detail 6) |
| 10 | G left F, F was mine and was captured while G is on e2 | G is still a source in the node of its half (detail 6) |
| 11 | the enemy builds a road level on e2; G on e1 at `pos` 500 (E is a source) | the build is visible: e2 has an end that is a source, so it is not in the fog (DEC-17, item 5) |
| 12 | no groups of mine; the enemy city E is joined by an edge to my X; E has a built barracks | `has_barracks = True` (DEC-31 is by ownership and the graph, not by vision) |
| 13 | no groups of mine; I order `UpgradeRoad` on e0 | accepted: an own internal edge counts as known (detail 5), not `NOT_FOUND_OR_HIDDEN` |
| 14 | the enemy sends a scheduled order E to X | the intent is public to everyone (DEC-04, DEC-08), as before, whether or not I have sources |
| 15 | the enemy stands in my X and my group arrives in X; they fight | the fight is public to both sides; after it, if my group stays in X, X is a source |

Alternatives (not chosen):
- Keep own nodes as sources (DEC-04, DEC-21): an empty own province would see its neighbours, which the owner called illogical.
- A group on an edge sees only its edge (DEC-10): it could not see the node it is heading to, though the owner wants the garrison seen before arrival.
- Give an own node without a group no level at all: the owner decided on `PRESENCE` for an enemy in an own node (item 2).
- Remembered (stale) information for own nodes without a group: not needed, an own node is never in the fog for enemy presence (detail 3).

---

## 11. Victory condition

- **[proposed]** VP are awarded for holding cities over time, not for destroying the opponent.

This is the main remedy against the bunker strategy: a player who sealed themselves in a small region holds few cities and loses on points even if nobody took them.

- **[proposed]** Maps must have a meaningful neutral space between the starting positions. Without it, digging in becomes profitable.
- **[open]** The value of a capture falls toward the end of the match: a city taken in the 3rd minute earns VP for 12 minutes, in the 13th for 2 minutes. The end of the match may freeze. Options: a victory on reaching a VP threshold instead of a timer, or an extra weight for the cities held at the moment the match ends. In the MVP: the timer (DEC-03 below); fallback options only based on the results of BAL-02.

### Victory condition and match length (DEC-03, #9) **[accepted]**

~~A 12-minute match (7200 ticks).~~ **[superseded by DEC-22]**: 15 minutes (9000 ticks). VP are awarded every 300 ticks (30 seconds) for each of your cities (the `vp` value from the map, the capital ×3); per match ~~24 awards~~ 30 awards. Capturing the enemy capital is an instant victory. On the timer the one with more VP wins; on a tie, the one with more cities; otherwise a draw.

Values in `rulesets/mvp-0.toml`: `tick_hz`, `match_ticks`, `victory.vp_period_ticks` (300), `victory.capital_multiplier` (3).

The owner's decision of 2026-10-07 (#211): the award period was increased from 50 to 300 ticks, because huge VP numbers are hard to read. The values per city did not change, the ratio between the players is preserved; only the frequency of the award changes (and the step of the score in the interface). The end of the match (~~7200~~ 9000 ticks, DEC-22) and the 600 ticks of `test-short` are multiples of the period, the last award falls on the last tick.

Implementation details (SIM-13, #29), `gow_sim.systems.victory`:
- A player loses at once if they surrendered (`Forfeit`, including a technical defeat by the server) or if their capital belongs to the opponent. A neutral capital does not count as captured.
- **Double defeat (DEC-03 addition, #136) [accepted].** If both players lose in the same tick (both `Forfeit`, or both capitals change owner, or a mix of the two), the match is a draw (`EndReason.DOUBLE_DEFEAT`, `reason: double_defeat`). The only mirror-symmetric answer, no tie-break between players. The owner's decision of 2026-10-28; it confirms what is implemented (no change of rules, `SIM_VERSION` unchanged).
- The last tick of the match (`match_ticks`) awards VP as usual, then the winner is determined. A neutral city does not count as anyone's city when comparing the number of cities.
- The result is not stored in the state: `outcome(state, rules)` is computed from it, the `victory` system writes the event `match_ended` (`winner`: a player id or `null` on a draw; `reason`: `capital`, `forfeit`, `vp`, `cities`, `draw`, `double_defeat`).

Alternatives (not chosen):
- A VP threshold instead of a timer or a bonus for the final hold: only if BAL-02 shows that the end of the match freezes.

---

## 12. Bunker (Topic 2)

The defender's advantage by default is intended. The question is whether the bunker wins the match. Right now the following work against it:

- VP for holding (the bunker holds few cities);
- ~~warehouse capacity depends on roads (a bunker with narrow roads has a small warehouse);~~ **[superseded by DEC-22]**: capacity is fixed by the kind of node;
- siege of attrition (with cut roads the warehouse is not replenished);
- building new edges (a bypass).

If the bunker still dominates in playtests, first turn **the VP award rate and the amount of neutral territory**, not the combat mechanics.

- **[open]** There is no additional lever against the bunker yet (the owner 2026-10-12, #239): come back after the round 2 playtest.

---

## 13. How not to make an economic simulator

1. **One unit of measurement: the charge.** The warehouse is in charges, a road is in charges per tick, a cost is in charges. One charge is what one unit needs. The only conversion is buying charges for CP in the capital at a fixed rate.
2. **All flows are automatic.** Packets on the way are an animation, not an object of control. **[superseded by DEC-18]**: the player sets a city priority and can transfer charges once, the packets themselves are not controlled. **[superseded by DEC-28]**: instead of a priority, two front markers and a rear minimum.
3. **Economic decisions are only spatial:** where to upgrade a road and where to put troops (with `city_upgrades.enabled`, DEC-26, also where to build a barracks and which warehouse to expand). ~~At most one additional lever: the city priority (DEC-18: priority and a one-off transfer).~~ **[superseded by DEC-28]**: there are no priorities, the supply levers are: two front markers, a rear minimum and a one-off transfer (section 8, the DEC-28 block).
4. **Show the state, not the flows:** a charge dot above a unit, a fill bar of the warehouse, the thickness of a road. No tables and no separate screens.
5. **A one-phrase test:** *"The capital produces charges, roads carry them, a unit without a charge is defenseless."* A new mechanic that does not fit this phrase is a reason to reconsider it.

---

## 14. Starting numbers for the first playtest

Nothing is calibrated, this is a point of reference.

The current starting values of the ruleset `rulesets/mvp-0.toml` (durations in ticks, CP in hundredths) are listed in SIM-01 (#17). The regen "1 CP per 5 s" is recorded there as 100 hundredths of CP per 50 ticks, the cap of 5 CP as 500.

| Parameter | Value |
|---|---|
| CP regen | 1 per 5 s |
| CP cap | 5 |
| Purchase in the capital | 1 CP → 2 charges |
| Ordinary order | 1 CP |
| Scheduled order | 2 CP, ~~+2 charges to the group~~ **[superseded by DEC-29]**: a bonus by the number of edges of the path, cap: charged units (section 5) |
| Split / merge | ~~1 CP~~ 0 (DEC-20) |
| Terrain | mountains +1, forest 0, plains −1 (for the defender) |
| New edge | 1-3 per match |
| Node degree limit | 4-5 |

---

## 15. Open questions (summary)

1. **1v1 or FFA.** The visibility of scheduled orders works badly in FFA: they are seen not only by the target but by third players too. In 1v1 and team modes the mechanic is clean. Decide before the rest: maps and balance depend on it. *MVP: only 1v1.*
2. **Flat economy**: confirm it or choose a concave model. *MVP: flat (DEC-02).*
3. **CP stance**: three positions or two separate flows without conversion. *MVP: three positions (DEC-02).*
4. **The bounce rule**: does the attacker return to the source node? The siege depends on it. *MVP: yes (DEC-07, rule 4).*
5. **The size of the bonus** for a scheduled order. ~~*MVP: +2 for the first fight (DEC-08).*~~ **[superseded by DEC-29]** *MVP: the number of edges of the path, cap: charged units (DEC-29).*
6. **The plan bonus on defense**: does it apply, or only to moving armies. *MVP: prepared defense: the mode "Defense", ~~+2 (DEC-08)~~ **[superseded by DEC-30]** an accumulating bonus (DEC-30).*
7. **Initiative = CP** for a won exchange: is it needed.
8. **The builder**: a separate unit or a mode. ~~*MVP: the mode "Building" (DEC-08, SIM-11).*~~ *MVP: neither; the road upgrade is a city function for warehouse charges (DEC-16).*
9. **Warehouse trophies**: remove, keep as a reward for speed, or replace with one-off CP. *MVP: no trophies, the warehouse is zeroed on capture (SIM-07).*
10. **Delivery modes** (packets / pumping): are they needed at all. ~~*Outside the MVP.*~~ ~~*MVP: instead of modes, two road types, fast and cargo (DEC-22).*~~ *MVP: no modes and no types, an upgraded road is only faster (DEC-26).*
11. **City priority**: is this lever needed. ~~*MVP: three priority levels and a one-off transfer (DEC-18).*~~ **[superseded by DEC-28]** *MVP: two front markers, a rear minimum and a one-off transfer (DEC-28).*
12. **The value of late captures**: a VP threshold or a weight of the final hold. *MVP: the timer (DEC-03); fallback options only based on the results of BAL-02.*
13. **Automatic flight** of discharged units: there is none now (a group whose retreat was not paid for dies). It may turn out too harsh. *MVP: no flight (DEC-07, rule 9).*
14. **Hex coordinates** on the board (axes x/y/z and the formula `(x+y+z)/2`): what is this: a distance on hexes, the placement of provinces, or something else?
15. **All the numbers** from section 14. *Starting values of `mvp-0`: SIM-01.*

---

## 16. What was rejected and why

| Option | Replaced by | Reason |
|---|---|---|
| Matches of 2.5-4 hours | 10-15 minutes | too long for a session, breaks when a player leaves the match |
| 5 resources (Money, Metal, Oil, Food, Fossils) | one charge | resources add load, not depth |
| Several unit types | one unit + modes | roles are moved into modes and terrain |
| Random map generation | a pool of symmetric hand-made maps | without repeating positions no knowledge forms |
| Hidden mechanics that open up with experience | hidden state with public rules | hidden constants are found out within a week |
| ×2 charges for a scheduled order | a fixed bonus | a multiplier rewards big armies |
| Roads limit the number of units | ~~roads affect only supply~~ **[superseded by DEC-28]**: an upgraded road speeds up units too | group size is already limited by city capacity |
| Two independent widths for the halves of an edge | one width, upgraded only inside your own territory | double counting and the loophole "I'll leave my half narrow" |
| The border as a supply equilibrium point | troops move the border | otherwise territory could be squeezed out without a fight |
| +0.5 CP per city (recommended to drop) | flat economy | income that grows with territory is a snowball; the simulation showed it: "in the long run the player with a city advantage inevitably wins" |
| A separate penalty for big groups | city capacity | the limit already arises by itself |
| Road widths, the capacity of all nodes and construction are always visible to everyone (DEC-04) | visible only in vision range, outside it the last seen (DEC-17) | playtest 2026-10-07: the enemy's road upgrades were visible through the fog |
| The "Building" mode of a group (DEC-08, SIM-11) | a road upgrade by a city for warehouse charges (DEC-16) | the group had to be switched and kept idle, a third mode complicated combat, the price in CP was not tied to charges |
| Only automatic supply | ~~city priority and a one-off transfer (DEC-18)~~ **[superseded by DEC-28]**: front markers, a rear minimum and a one-off transfer | playtest 2026-10-12: it was impossible to say "front first", intermediate cities hoarded charges |
| A capacity drop of a cut-off city | starvation in an encirclement: the garrison spends charges, units do not die (DEC-19) | the capacity drop was opaque and disappears with fixed capacity |
| Split, merge and cancel for CP | free, auto-merge, a stack limit by the capacity of the path (DEC-20) | playtest 2026-10-12: a "deathball" from the capital, paid group management got in the way |
| Of the neighbors only "there is an enemy" (DEC-04) | information by terrain, ranges, the exact number beyond the border point of an edge (DEC-21) | playtest 2026-10-12: decisions in the blind, terrain did not affect vision |
| Capacity from roads, width 1..5, a 12-minute match | capacity by the kind of node, roads up to 3 levels of two types, 15 minutes (DEC-22) | roads did not get upgraded, capacity mixed two decisions, the match felt rushed |
| Every node: a city with a warehouse (MAP-01) | provinces without a warehouse, kinds of cities, names (DEC-23) | positional play and different value of cities |
| Own nodes are vision sources (DEC-04, DEC-21 item 1) | vision comes only from units: own groups, a group on an edge as in the node of its half (DEC-35) | playtest 2026-10-28: an empty own province giving vision on its neighbours read as illogical |
| Two road types: fast and cargo (DEC-22), all cities recruit and one number for the warehouse and units | roads without a type and cheaper (always), a barracks and a separate warehouse behind a flag (DEC-26) | playtest 2026-10-14: the decision "which type" changed nothing, cities are too equal from the first second |

---

## 17. What to check in playtests

- **A dominant strategy.** If more than 70% of matches follow one scenario, there is no depth.
- **Bot self-play.** Three simple bots (expansion / early pressure / supply cut-off). Look at the spread of outcomes: if one bot wins more than ~65% against all others, there is a skew somewhere.
  **Reading of the BAL-02 gate (#40, criterion 1; owner decision 2026-10-30, #611, option A):** the "no strategic bot above 65%" check is read over the non-bunker strategic bots (`rusher`, `strangler`, `reactive`, `expander` and their `smart_*` versions); the bunkers (`turtle`, `smart_turtle`) win by holding and lose on VP by design (section 11), so they are checked by criterion 4 (Turtle against Expander below 40%). Whether the claim of empty nodes needs a rule (option C) is not decided; if it is, it gets its own DEC.
- **The share of scheduled orders** among attacks: the guideline is 20-70%; the attacks are the orders into a node with an enemy garrison (#590, section 5).
- **Does the siege pay off:** are cities taken by attrition if the roads are cut.
- **The bunker:** does a player who sealed themselves in a small region win.
- **The end of the match:** are there attacks in the last minutes.
- **The superstition test:** for any non-obvious factor, can a player inside the game set up an experiment and check it? If not, players will invent false explanations.

---

## 18. Interface (minimum)

- A charge dot above a unit (green / red).
- A fill bar of the warehouse at a city.
- Road thickness = its throughput.
- A road in the fog is drawn with the last seen thickness and is marked as stale not by color alone; ~~the capacity of a city from stale data is shown as an estimate (DEC-17).~~ **[superseded by DEC-22]**: capacity is fixed by the kind of node and is shown exactly.
- ~~Before an attack your own charges are seen exactly, and an estimate of the enemy's charges.~~ **[superseded by #252]**: the fight estimate in the interface was removed by the owner, your own charges are seen exactly.
- On hover over a road: what the upgrade will give, not just the current width. ~~For example "+1.5 city capacity".~~ **[superseded by DEC-22, DEC-28]**: capacity does not depend on roads; the tooltip shows the gain in unit and supply speed and the price in CP.
- City development (DEC-26, with `city_upgrades.enabled`): in the city menu "Barracks" and "Warehouse" (level, warehouse capacity, price); above your own city a thin bar of the barracks or warehouse construction in progress; the warehouse bar by warehouse capacity. ~~Recruiting without a barracks is inactive ("no barracks").~~ **[superseded by #315]**: in a city without a barracks (`has_barracks = false`) there is no "Recruit" sector in the menu at all (not grayed out); if the barracks is unknown (`null`) or `city_upgrades.enabled = false`, the sector is there, the server decides. A built barracks and a warehouse of the maximum level disappear from the menu (the sectors are not shown). Your own barracks is visible on the city by a house icon (a shape, not a color); ~~at an enemy city the barracks is hidden by the fog (AGENTS.md 4.4)~~ **[superseded by DEC-31]**: at an enemy city adjacent to your own node a built barracks is visible by the same house; at the other enemy cities it is hidden (AGENTS.md 4.4), the client does not infer anything. No more than one radial menu is open.
- Road upgrade (DEC-16): ~~a click on your own city, the key U, choosing a road (without choosing a type, DEC-26); the tooltip shows the speed gain and the price in charges.~~ **[superseded by DEC-28, #315]**: a road upgrade mode on `U` (`Esc` or `U` again: leave): your own roads that can be upgraded are highlighted, a click on such a road sends `upgrade_road`; without the mode a click on a road upgrades nothing; the price is in CP (0.5 CP per level), the city takes no part (client: #311, #315, section 8, "Road upgrade in the client"). With `city_upgrades.enabled = true` the city menu gets the barracks and the warehouse (DEC-26).
- The fight arena on the map (DEC-24, DEC-29, DEC-32, #295, #325, #330; ui-style 9.9, 27): a panel of two halves (yours on the left, the opponent on the right), for each unit of the fight a ▽ token (`units + losses`: charged is filled, discharged is empty with hatching, killed is dashed; the opponent's has a second dark outline), up to 8 tokens per side, beyond that "+N" with the exact number of hidden tokens and the small number of hidden charged ones; an amber crossed-out circle on a charged token that does not fire (`FightView.mute`, item F2); under each half a reserve of bonus shots ◇ ×N (`FightView.virtual_left`, dashed and dim at 0), along the bottom edge a bar to the next round. A token that changed in a round (a charge went out, a unit was killed, reinforcement came) pulses once; which one exactly cannot be learned from the view, this is a visual convention. The exchange of blows of the last round is shown as arcs above the panel in the color of the shooter (a filled circle: real shots, an empty diamond: virtual ones), there is no arrow on a side that did not shoot; a round where a side shot only virtual ones is drawn with a different arrow (glow, dashed shaft, diamond head), and above the panel stands the caption "bonus attack" (the source of the bonus is not shown). The arena is drawn in screen pixels (it does not shrink at 60%), all durations (growth of the arrows, rise and fade of the numbers, pulsation, showing the result) are counted as fractions of a round from `ruleset_public.combat.round_ticks`. There is no board window. The client computes and derives nothing: all numbers come from `PlayerView.fights` and events (ui-style 9.9, 27).
- "Defense" (DEC-30, #318): next to the icon of your own group (city) in "Defense" there is a shield "+N / M" (`GroupView.defense_bonus` and `defense_cap`, with several groups the sum); the tooltip on hover: the bonus, the rule (+1 per `orders.defense_ticks_per_bonus` ticks in the mode, cap: charged units, burns after a fight, the price) and the same lines as a caption under the group menu. For an enemy group only the mode shield, no number.
- The bonus of a scheduled order (DEC-29): at the head of the ribbon of your own plan "◇ +N" (`OrderView.bonus`, the server's number); while the group stands in the city, this is a forecast (a dashed outline, the group tooltip says so), from setting out the outline is solid. The opponent sees only the intent.
- The recruit queue (DEC-25): above your own city the queue slots, the first is filled by progress (full: the unit is ready and waits for room); in the city menu "Recruit" (R) with the number in the queue and "Cancel recruiting" with a refund.
- Border shifts only in response to events, so that the player can always name the reason.
- `Tab` (an alternative to `F2`) also clears the city selection and closes its menu.
- On the "Supply" layer `[` and `]` lower and raise the rear minimum by one (like a slider, #330).
- Map modes on `Tab` (an alternative to `F2`), including "Supply": ~~city priorities and transfers (DEC-18)~~ **[superseded by DEC-28]**: two front markers, a rear minimum and transfers; splitting a group on `S` (DEC-20).
- The travel time of an order and the highlight of the nodes reachable by the selected group (DEC-20, DEC-22); computed by the server.
- Ranges "3-5" instead of numbers where the terrain vision does not give them (DEC-21); a starvation timer at a cut-off city (DEC-19).
- The owner's interface decisions after round 2: tracking #236.

---

## 19. Match on the server: disconnect and rating

The rules of this section: settings of the server and of the meta-game, not of the simulation ruleset.

### Disconnect and pauses (DEC-05, #49) **[accepted]**

60 seconds to reconnect, the match keeps going meanwhile; then a technical defeat (recorded in the replay log as the command `Forfeit`). In rated matches there are no pauses; in private ones (by an invite link) one pause of up to 60 seconds per player. A match from the public lobby (LOB-01, #76) is played with a stranger, so there are no pauses in it, as in a rated one: a pause in it would be a way to drag the game out. Server settings, not the ruleset.

The values are set in the server settings (SRV-04, #50), they are not in `rulesets/*.toml`.

Alternatives (not chosen):
- A bot takes control for the time of the disconnect.

### Which matches are rated (DEC-06, #74) **[accepted]**

Rated are only the matches from the matchmaking queue. Matches from the lobby, by invite and against a bot do not change the rating but are saved in the history. A technical defeat and a surrender are a defeat. (Extended by DEC-34: who of the queue players is rated, and when the rating is not updated.)

### Glicko-2 rating (RAT-01, #73)

A player's rating is a Glicko-2 triple `(r, RD, σ)` (`gow_server.rating`, after Glickman's paper). A new player: 1500 / 350 / 0.06, τ = 0.5. Each rated match is a separate "period": both players are updated after the match against each other (a win 1, a draw 0.5, a loss 0). RD growth from idleness is not implemented: RD changes only in matches. The displayed rating is `r − 2·RD`. This is a meta-game setting, not a ruleset one: the simulation does not see the rating.

The update (RAT-02, #75): right after a rated match, in the same DB transaction as the result record (outside a tick). A win 1, a draw 0.5 (including `double_defeat`), a loss 0; a technical defeat (`disconnect`, `no_show`) and a surrender are a defeat. A match is counted once: the flag `matches.rating_applied` is taken by a single atomic `UPDATE`, repeated processing does not change the rating. An aborted match (`aborted`) is not rated. A match becomes rated only in `lifecycle.start(rated=True)` between two accounts: against a bot the flag is ignored (extended by DEC-34: only between two password accounts that finished calibration, and with exceptions for calibration, an early resign and the per-opponent limit). The displayed rating before and after is written to `match_players.rating_before/after`; the player gets it in `match_end.rating` (`before`, `after`, integers) and sees it on the result screen. Both sides are computed from the ratings at the start of the match (a player never has two active matches), the server recomputes them in the transaction.

### Leaderboard and player profile (LB-01, #78)

Server read endpoints, no protocol change (`GET /api/leaderboard`, `GET /api/players/{id}`; shapes in the README). Both are
public and rate limited per client IP (`GOW_PUBLIC_READ_RATE_LIMIT`).

- **Who is on the leaderboard:** the top 100 by the displayed rating `r - 2·RD` (rounded), highest first, equal ratings by
  player id. Only a password account that is not blocked and has at least `GOW_CALIBRATION_MATCHES` (5) rating-changing
  matches (`ratings.rated_matches`): a guest and an account in calibration are not listed (DEC-34, item 2).
- **Profile:** nick, rating and rank (`null` for a guest and while calibrating, then `calibration` says "k/5"), the record of
  the matches that changed the rating, the record of all finished matches, and the last 20 finished matches of any kind
  with the opponent, the kind (rated, calibration, unrated queue match with its reason, invite or lobby, bot) and a link to
  the replay. A blocked account has no profile (404).
- **Rating in the history** follows `match_end`: the change of a calibration match is hidden, it is shown from the match that
  completes the calibration on.
- **Replay link:** `ready`, `preparing`, `expired` (the retention of SRV-08, #515), `unavailable` (no frames were made) or
  `private`: the replay of an unrated match opens only for its two players, as in `GET /api/replays/{id}`.

### Matchmaking queue (MM-01, #77)

A rated match (DEC-06) is found through the queue (`gow_server.matchqueue`, `POST/GET/DELETE /api/queue`). These are meta-game rules: the numbers are server settings (`GOW_QUEUE_*`, README), not the ruleset.

- **Window.** A player who has waited `t` seconds accepts an opponent whose rating is within `100 + 5·t`, but not more than 400. A pair is formed only if each one's window accepts the other's rating. What is compared is the Glicko-2 `r` (the strength estimate), not the displayed `r − 2·RD`: a newcomer has a large RD, and the displayed rating is understated.
- **The pass** happens at most once a second. The queue is traversed from the start; each player not yet matched takes the eligible opponent with the closest rating difference, and with an equal difference the one closer to the start of the queue. The same pair is not matched twice in a row: the last offered opponent of a player is skipped.
- **Confirmation.** "Opponent found" → 15 seconds for both to confirm. The one who did not confirm leaves the queue; the one who confirmed returns to its start, the waiting time (and the window) is kept. A refusal (leaving the queue) works the same at once. The match is created only after two confirmations.
- **The match**: a random map of the pool, sides chosen randomly (independent of the order in the queue), rated (`lifecycle.start(rated=True)`), not private: no pauses (DEC-05).
- **Bot.** After 60 seconds of waiting the player is offered an unrated match with a bot (SRV-06); accepting the offer takes them out of the queue.
- Waiting in the queue occupies the player, like a match does (SRV-09): while they are in the queue, they cannot create or accept another match (409), and vice versa. The client polls the status once a second; a player whose client is silent for 15 seconds (a closed tab) leaves the queue. The queue lives in process memory: a server restart clears it.

### Rated-match protection against rating farming (DEC-34, #414) **[accepted]**

The owner's decision of 2026-10-28, from the audit item SRV-04 (#414: a player queues together with a throwaway guest
that forfeits at once, and the full win is rated). These are meta-game rules of the server, not of the simulation
ruleset: no `SIM_VERSION`. Every number below is a server setting (the settings are named in the "Implementation"
paragraph at the end of this block; they are not in `rulesets/*.toml`). The sections above are extended, not replaced:
DEC-06 (what is rated) and RAT-02 (the update). Implemented in #414 (`PROTOCOL_VERSION` 26).

1. **Rated only between password accounts.** There is one shared matchmaking queue, the pool is not split. A queue
   match is rated only if both players are accounts with a password and both have finished calibration (item 2);
   otherwise it is played unrated. Guests keep playing, unrated. Rated stays only for queue matches (DEC-06): never by
   invite, from the lobby or against a bot, so a player cannot choose the opponent of a rated match.
2. **Calibration.** The first 5 queue matches of an account (between password accounts) are its calibration matches
   (setting: the number of calibration matches). The Glicko-2 rating of the calibrating player is updated as usual,
   but it is not displayed: the player sees "Calibration k/5" and is not on the leaderboard. A calibration match does
   NOT change the rating of the opponent, whether the opponent is calibrated or not. After 5 such matches the rating
   is displayed as usual (`r - 2*RD`) and the player appears on the leaderboard.
3. **Resign penalty.** A "resign" is a surrender (the command `Forfeit`) or a technical defeat by disconnect (DEC-05)
   in a rated match.
   - **An early resign**, before 3 minutes of match time (tick 1800 at 10 Hz; setting: the threshold in seconds): the
     resigner gets the defeat as usual, the rating of the winner does not change.
   - **Repeated resigns** in rated matches within a rolling 24 hour window ban the player from the matchmaking queue
     (settings: the window, the ban lengths): the first carries no ban, the 2nd a ban of 5 minutes, the 3rd of
     30 minutes, the 4th and each later one of 2 hours. The ban is shown to the player with the time left.
   - **A resign in a calibration match counts** toward that resign count (owner's decision of 2026-10-28), like a
     resign in any other rated match.
   - **A draw is not a resign** (owner's decision of 2026-10-28): a `double_defeat` (or any other draw) never counts
     toward the ban, and the early-resign rule does not apply to it: both players are rated as for a draw.
4. **Per-opponent limit.** At most 3 rated matches between the same two accounts within a rolling 24 hour window
   (settings: the count, the window). The queue may still pair them (the online pool is small), but the 4th and later
   matches are unrated, and the result screen says why.
5. **What the client is told.** Whether a match is rated and, if not, why (a guest, the calibration of the opponent,
   the opponent limit, an early resign of the opponent), and the calibration progress. The exact protocol and HTTP
   fields are left to the implementation (`PROTOCOL_VERSION`++ there).

**Implementation (#414)**, the details the items above leave open:

- *Who is rated* is decided once, when the match starts (`gow_server.ladder.plan_queue_match`), and stored per side in
  `match_players.rating_mode` (`rated`, `calibration`, `none`) and `unrated_reason`. `matches.rated` means "at least one
  side's rating can change". A side is `calibration` while its account has fewer than the calibration number of rating
  changes (`ratings.rated_matches`); a calibrated side against a calibrating one is `none` with the reason
  `opponent_calibrating` (it is not a rated match for it). Two calibrating players both change their own rating.
- *Calibration progress* counts the matches that changed the account's rating: an unrated match, the calibrated side
  of a calibration match and the winner of an early resign add nothing. Early-resign winners therefore do not
  progress either, so a throwaway account cannot finish calibration through quick resigns of an alt.
- *The early resign* is checked at the end by `gow_server.ladder.settle`: end reason `forfeit`, `disconnect` or `no_show`
  and fewer ticks than the threshold in seconds times `tick_hz` (tick 1800 at 10 Hz is not early, tick 1799 is). The
  match stays flagged rated (it counts toward the per-opponent limit and the resign count); the winner's side becomes
  `none` with the reason `opponent_early_resign`, the loser's rating changes as usual. The same function computes what
  `match_end` tells the players and what the database transaction stores.
- *The per-opponent limit* counts the matches flagged rated at their start between the two accounts, with a start time
  inside the rolling window (a match whose winner got no gain counts too). A match that was unrated for that reason is
  not itself counted, so the oldest rated match leaving the window frees exactly one place.
- *The queue ban* is stored as `players.queue_banned_until`, set in the transaction that writes the result of the
  resigned match: the length is by the number of that player's resigns (the loser of a match flagged rated whose end
  reason is `forfeit`, `disconnect` or `no_show`) within the window, this one included. A shorter ban never shortens a
  longer one. `POST /api/queue` answers 429 with `Retry-After` and a `QueueBan` body while it lasts. The ban applies to
  the queue only: invites, the lobby and bot matches stay open.
- *The client is told* (`PROTOCOL_VERSION` 26): `welcome` and `match_end` carry `rated`, `unrated_reason`
  (`casual`, `guest`, `opponent_guest`, `opponent_calibrating`, `opponent_limit`, `opponent_early_resign`; the last
  only in `match_end`) and `calibration` (`played`, `total`, for a password account that was calibrating when the match
  began). `welcome` also has `forfeit_ban_s` (`PROTOCOL_VERSION` 30, #559): the queue ban in seconds a resign would
  bring to that player now (resigns in the window, counted at the match start, plus one; `0` for none or when the
  match is not flagged rated; a calibrated side facing a calibrating opponent, `opponent_calibrating`, gets the real
  length, because its resign counts too). The ranked forfeit dialog shows it, also in that case (#571); the client
  computes nothing.
  `match_end.rating` is `null` while the rating is hidden and present from the match that completes the
  calibration on. `GET /api/me` has `calibration` (`null` for a guest and once calibration is over). The leaderboard
  (LB-01, #78, below) lists only password accounts that are not blocked and have finished calibration.
- *Settings*: `GOW_CALIBRATION_MATCHES` (5), `GOW_EARLY_RESIGN_S` (180), `GOW_RESIGN_WINDOW_S` (86400),
  `GOW_RESIGN_BAN_SECOND_S` (300), `GOW_RESIGN_BAN_THIRD_S` (1800), `GOW_RESIGN_BAN_LATER_S` (7200),
  `GOW_OPPONENT_LIMIT` (3), `GOW_OPPONENT_LIMIT_WINDOW_S` (86400); passed through `compose.yaml` and listed in the README.
- Accounts that played rated matches before DEC-34 keep their rating and their `rated_matches`: with five or more they
  count as calibrated.

Alternatives (not chosen):
- A separate rated queue for accounts: it splits a small pool.
- Account age instead of calibration.
- No rating gain for the winner after any resign, not only an early one.

---

## 20. Glossary

Matches the glossary of `AGENTS.md` (section 15). Changes only together with it.

| Term | In code | Meaning |
|---|---|---|
| tick | `tick` | a simulation step, 10 per second |
| ruleset | `Ruleset` | all numbers and flags of the rules, `rulesets/*.toml` |
| city / node | `Node` | a vertex of the graph; a node is a city with a warehouse or a province (DEC-23) |
| province | `kind = province` | a node without a city: no warehouse, capacity 3, no VP, position only (DEC-23) |
| road / edge | `Edge` | a link between nodes; `width`: road level 1..3; ~~type fast or cargo from level 2 (DEC-22)~~ there is no type, an upgrade only speeds up delivery (DEC-26) |
| border point | `border_permille` | a point on an edge in thousandths from the end `a`; splits the edge into halves for vision (DEC-21, DEC-23) |
| internal edge | `is_internal` | both ends belong to one owner; only it can be upgraded and only along it does supply go |
| buffer edge | `is_buffer` | the ends belong to different owners, or one is neutral |
| group | `Group` | units of one player in one place: `units`, `charged` |
| charge | `charged` | a charged unit; each charge is one "shot" |
| warehouse | `warehouse` | a city's stock of charges; with `city_upgrades.enabled` the warehouse capacity is separate from the unit capacity and grows with upgrades (DEC-26) |
| recruit queue | `recruit_queue` | the units a city produces one per `recruit.unit_ticks`; CP at queueing, cancelling the last one refunds (DEC-25) |
| barracks | `has_barracks` | the city can recruit; with `city_upgrades.enabled` the capital has it from the start, other cities get it by an upgrade for 3 CP (DEC-26) |
| capacity | `capacity` | how many units (and charges when `enabled = false`) a node holds; fixed by the kind of node (DEC-22); warehouse capacity is separate (DEC-26) |
| ~~priority~~ | ~~`priority`~~ | ~~the supply level of a city: high, normal, low (DEC-18)~~ **[superseded by DEC-28]** |
| front marker | `front` | one of a player's two markers: a city fills its warehouse to full (DEC-28) |
| rear minimum | `rear_min` | how many charges the cities without a marker keep (DEC-28) |
| transfer | `Transfer` | a one-off shipment of charges between your own cities (DEC-18) |
| starvation | `starvation` | a garrison cut off from the capital spends charges (DEC-19) |
| packet | `Packet` | charges travelling along a road |
| bounce | `bounce` | an attacker without a win returns to the source node discharged |
| scheduled order | `planned=True` | more expensive, visible to everyone as an intent, sets out with a delay, gives a one-off bonus |
| intent | `Intent` | the part of a scheduled order visible to everyone: from where, to where, the kind, without the size and group id |
| modes | `Mode.ATTACK / DEFENSE` | "Attack", "Defense"; "Building" (`BUILD`) was removed by DEC-16 |
| construction | ~~`UpgradeRoad(node, edge)`~~ `UpgradeRoad(edge)` | upgrading your own internal road by one level ~~by your own city for charges of its warehouse (DEC-16)~~ for CP, without a city (DEC-28, item 7) |
| CP | `cp` | command points; flat regeneration, they do not grow with territory; stored in hundredths |
| stance | `Stance.ECONOMY / BALANCE / WAR` | the share of CP regeneration that goes into charges |
| player view | `PlayerView` | the state filtered by fog for a player or a bot |
| VP | `vp` | victory points for holding cities |

Synonyms from early discussions: "province" in sections 4 and 15 means a node; since DEC-23 a province is a node without a city. The details of internal edges,
capacity and supply that are not in sections 7, 8 and 9 are set in the MVP plan: SIM-07 (#23) and SIM-08 (#24).

---

## 21. DEC decisions

| DEC | Issue | Topic | Where recorded | Status |
|---|---|---|---|---|
| DEC-01 | #7 | how new units appear | section 3 | [accepted]; instant recruit and cooldown [superseded by DEC-25]; "any city" [superseded by DEC-26 with `city_upgrades.enabled = true`] |
| DEC-02 | #8 | the economy model and the CP stance | section 6 | [accepted]; passive production removed 2026-10-14 (#253); parts [superseded by DEC-41] under `economy.model = "v2"` |
| DEC-03 | #9 | victory condition and match length | section 11 | [accepted]; match length [superseded by DEC-22]; double defeat is a draw [accepted] 2026-10-28 (#136) |
| DEC-04 | #10 | visibility rules in the MVP | section 10 | [accepted]; parts [superseded by DEC-17, DEC-21] |
| DEC-05 | #49 | disconnect and pauses | section 19 | [accepted] |
| DEC-06 | #74 | which matches are rated | section 19 | [accepted] |
| DEC-07 | #11 | combat resolution (a table of worked examples) | section 4 | [accepted]; rule 8 and the repeated bounce [superseded by DEC-24] |
| DEC-08 | #12 | modes and scheduled orders | section 5 | [accepted]; "Building" [superseded by DEC-16]; the cancel price [superseded by DEC-20]; the "Defense" bonus [superseded by DEC-30]; parts [superseded by DEC-41] under `economy.model = "v2"` |
| DEC-09 | #104 | the starting CP stance and the first stance change | section 6 | [accepted] (2026-10-28); confirms the implementation |
| DEC-13 | #124 | road construction by a group: countdown, builders, interruption | section 8 | [superseded by DEC-16] |
| DEC-10 | #112 | vision of a group on an edge and enemy packets | section 10 | [accepted] (2026-10-26): an own group on an edge sees its edge at the level `PRESENCE`, not the end nodes; enemy packets stay hidden; implemented #112 (`SIM_VERSION` 21, `PROTOCOL_VERSION` 25); the "edge source" [superseded by DEC-35]: a group on an edge is a source in the node of its half |
| DEC-11 | #117 | splitting and merging groups, commands to a group on the way | section 3 | [superseded by DEC-20] |
| DEC-12 | #118 | garrison attrition: the count, the grace period, transit, the unit that dies | section 9 | [accepted] (2026-10-28); confirms the implementation; item 5 (trimming the warehouse) obsolete after DEC-22 and DEC-26 |
| DEC-14 | #131 | supply details SIM-08 | section 7 | [superseded by DEC-18] |
| DEC-16 | #203 | road upgrade as a city function for warehouse charges | section 8 | [accepted]; the numbers and the link to capacity [superseded by DEC-22]; part [superseded by DEC-28] |
| DEC-17 | #204 | fog of war for roads: widths, capacity and the enemy's construction | section 10 | [accepted]; item 3 [superseded by DEC-22]; the "own end" of item 1 [superseded by DEC-35] |
| DEC-18 | #230 | supply control: priorities and transfer | section 7 | [accepted]; a transfer shares the `amount` of the edge with the automatics, item 10 (2026-10-14, #253); part [superseded by DEC-28]; parts [superseded by DEC-41] under `economy.model = "v2"` |
| DEC-19 | #231 | starvation in an encirclement | section 7 | [accepted]; `starve_in` without charges, example 3 (2026-10-14, #253); parts [superseded by DEC-41] under `economy.model = "v2"` |
| DEC-20 | #232 | groups and orders: auto-merge, free split, merge, cancel, stack limit | section 3 | [accepted] |
| DEC-21 | #233 | terrain vision and the border point of an edge | section 10 | [accepted]; item 5 on position and direction in an edge half [superseded by DEC-33]; implemented #296 (`SIM_VERSION` 19, `PROTOCOL_VERSION` 22); item 1 (the sources) [superseded by DEC-35] |
| DEC-22 | #234 | roads of two types, fixed capacity, a 15-minute match | section 8 | [accepted]; road types and prices [superseded by DEC-26] (always); warehouse equals capacity [superseded by DEC-26 with `city_upgrades.enabled = true`] |
| DEC-23 | #235 | map rework: provinces, kinds of cities, names, the border point | section 9 | [accepted]; implemented: the format (#366, `SIM_VERSION` 20, `PROTOCOL_VERSION` 24), maps with provinces (#266); parts [superseded by DEC-41] under `economy.model = "v2"` |
| DEC-24 | #261 | fight over time: rounds, reinforcements, retreat, a bounce without a chain, the fight point | section 4 | [accepted] (2026-10-14, all 14 recommendations); absorbs #133, #141; `round_ticks = 10` and item I1 on the remaining bonus [superseded by DEC-32, implemented #329] |
| DEC-25 | #262 | recruit queue | section 3 | [accepted] (2026-10-14: 3 s per unit, a queue of 3); implemented #278 |
| DEC-26 | #265 | city development: roads without a type and cheaper (always); barracks and warehouse separate from capacity (behind the flag `city_upgrades.enabled`) | sections 3 and 8 | [accepted] (2026-10-14, all details; road prices 1 and 2, roads not behind the flag); implemented #265 (`SIM_VERSION` 12, `PROTOCOL_VERSION` 16); part [superseded by DEC-28]; parts [superseded by DEC-41] under `economy.model = "v2"` |
| DEC-27 | #266 | maps: symmetry of rules without symmetry of the picture, size, no water | section 9 | [accepted] (2026-10-14, all details); asymmetric maps [deferred]; implemented: the background without water #269 (item 3 [superseded by DEC-36] 2026-10-29), the validator and script #366, the maps and `grid55` #266; the projection budget on 55 nodes 0.45 ms [accepted] 2026-10-22 (#371) |
| DEC-28 | #290 | supply and roads rework: transit, front markers, rear minimum, donors, roads for CP | sections 6, 7, 8 | [accepted] (2026-10-17); details [accepted] 2026-10-17; replaces the priorities of DEC-18, the road payment of DEC-16, DEC-26; supply implemented #292 (`SIM_VERSION` 14, `PROTOCOL_VERSION` 17); roads (#306) and the client (#293) await implementation; parts [superseded by DEC-41] under `economy.model = "v2"` |
| DEC-29 | #291 | the bonus of a scheduled order by distance; revision of DEC-24 item 13 (the opponent's bonuses in a fight are visible) | sections 4, 5 | [accepted] (2026-10-17); details [accepted] 2026-10-17; `orders.planned_bonus` [superseded by DEC-29]; implemented (#294, `SIM_VERSION` 16; client: #295, the arena on the map: #325); the bonus forecast in your own order (`OrderView.bonus`) [accepted] 2026-10-21, implemented #329; parts [superseded by DEC-41] under `economy.model = "v2"` |
| DEC-30 | #316 | accumulating the "Defense" bonus: +1 per `orders.defense_ticks_per_bonus` ticks, the cap by charged units, burns after a fight | section 5 | [accepted] (2026-10-21); replaces the part of DEC-08 about "Defense"; details [accepted] 2026-10-21; implemented (#317, `SIM_VERSION` 17, `PROTOCOL_VERSION` 20); client implemented (#318); parts [superseded by DEC-41] under `economy.model = "v2"` |
| DEC-31 | #316 | enemy barracks are visible at neighboring cities (only a built one, no memory) | section 10 | [accepted] (2026-10-21); changes the barracks fog of DEC-25 and DEC-26; details [accepted] 2026-10-21; implemented (#319, `PROTOCOL_VERSION` 23); not affected by DEC-35 (adjacency is by ownership) |
| DEC-32 | #327 | the fight arena: a 2 s round (`combat.round_ticks = 20`), the bonus reserve is visible to both sides in a fight (revision of DEC-24, item I1); the bonus rules do not change (B1, B2 not accepted); client A1, V3, ◇ | section 4 | [accepted] (2026-10-21); details [accepted] 2026-10-21; item 13 (mute charges in the fight view) [accepted] by the orchestrator 2026-10-21; variant B3 "bonuses at the end" [open], not accepted by the owner 2026-10-21; implemented (#329, `SIM_VERSION` 18, `PROTOCOL_VERSION` 21); client implemented (#330) |
| DEC-33 | #296 | visible movement of enemy groups in a node's vision zone: continuous position and direction in the halves of visible nodes | section 10 | [accepted] (2026-10-21); details [accepted] 2026-10-21 (all as recommended); replaces part of DEC-21, item 5; implemented together with DEC-21 (#296, `SIM_VERSION` 19, `PROTOCOL_VERSION` 22); client: ranges, the border point, the half memory and the smooth movement of figures are done in #359, the border point from the map (`border_permille`) since #366, the look of the figure awaits #354; the sources of item 1 [superseded by DEC-35] |
| DEC-34 | #414 | rated-match protection against rating farming: rated only between password accounts, calibration, the early-resign and repeated-resign penalty, a per-opponent limit | section 19 | [accepted] (2026-10-28); meta-game server rules, no `SIM_VERSION`; implemented #414 (`PROTOCOL_VERSION` 26); owner's additions of 2026-10-28: a resign in a calibration match counts toward the queue ban, a draw (`double_defeat` too) is not a resign |
| DEC-35 | #477 | vision comes only from units: own nodes are no longer vision sources; a group on an edge is a source in the node of its half; an enemy in an own node without a group is `PRESENCE` | section 10 | [accepted] (2026-10-28, a rule change after the freeze); details [accepted] (2026-10-29, all items as written: the readings that reveal less); implemented #477 (`SIM_VERSION` 22, `PROTOCOL_VERSION` 28: the wire allows own data on an own node at any level) |
| DEC-36 | #537 | map geography: water cells (sea, lakes), rivers as area borders, areas of nodes touch only where a road links them; visual only, the rules do not read it | section 9 | [accepted] 2026-10-29 (W4 Painted, no dark line along water, the defaults of the open questions); supersedes DEC-27, item 3; step 1 (baker, vector file, validator `geography`) #537, step 2 (client territory) #544, step 3 (pool maps and the menu map with water, no node moved) #545 |
| DEC-37 | #549 | an engagement zone around a node: a defender that left the node within the last `combat.engage_ticks` ticks (3) is caught into the fight as a leaving defender | section 4 | [accepted] (2026-10-29, the owner's direction, a rule change after the freeze); the number `engage_ticks = 3` [default, chosen by the orchestrator; the owner may tune it]; implemented #549 |
| DEC-38 | #578 | capture costs a charge: a capture spends `capture.charge_cost` real charges of the capturing groups in the node, otherwise they bounce | section 4 | [accepted] (2026-10-30, the owner, all defaults: variant C, every capture costs, provinces and the capital too, bounce, G3, no virtual charges); implemented #578 (sim, protocol); `charge_cost = 0` (off) in `mvp-0`, `mvp-1`, `test-short`, BAL-02 tests `1` in `mvp-2`; `charge_cost = 1` in v2 (DEC-41) |
| DEC-41 | #642 | economy v2: factories (capital main, built smaller, both fixed), player-drawn supply lines with reroute, supply as the currency of buildings, no stances, bunker, planned-order accumulation, province warehouse 1, capture costs a charge | section 7 | [accepted] (2026-10-31, the owner; every other default [accepted] as a starting value tuned by playtests); behind `economy.model = "v2"` (`rulesets/mvp-3.toml`), v1 unchanged; supersedes the proposal DEC-39 (#625); implementation: follow-up issues |

How to close a DEC issue: confirm the default value or choose an alternative, replace the status
in the section block and in this table with [accepted] (or record another decision) and reflect the numbers in
`rulesets/mvp-0.toml`, if the DEC sets them.
