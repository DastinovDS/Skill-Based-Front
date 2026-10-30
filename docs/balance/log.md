# Balance log

Each iteration: the ruleset, the run, the result against the BAL-02 gate criteria (#40), hypotheses and
the next step. The gate criteria: issue #40 and `docs/design/mechanics.md`, section 17. The report of the
latest run: [latest.md](latest.md), the data format: [README.md](README.md).

## Iteration 0: BAL-01 (#39), the first `mvp-0` run

### Run

```bash
uv run gow-bots tournament --maps maps/*.json --bots expander reactive rusher strangler turtle \
  --seeds 100 --jobs 8 --ruleset rulesets/mvp-0.toml
uv run gow-bots report docs/balance/latest.jsonl
```

- Ruleset `mvp-0` (hash `3c114c6a3fde5be635a73d1cd7ff1783`), `SIM_VERSION` 1, maps arteriya, pautina,
  pereval, seeds 0..99, 7500 matches. `idle` and `random_legal` are excluded: all gate criteria
  are computed over the strategic bots ("Idle and Random are not counted", #40); their competence
  was checked in BOT-01 and BOT-05.
- The run was assembled from three runs, one per map (`--maps maps/<map>.json`), and joined in map
  order: the rows are ordered by `(map, seed, bot0, bot1)`, so the file matches a single run
  on the three maps. Timing: `docs/perf.md`, section "Bot tournament".

### Result against the gate criteria

| Criterion (#40) | Value | Outcome |
|---|---|---|
| No strategic bot beats the other strategic bots more than 65% | rusher 0.90 [0.89; 0.91], expander 0.68 [0.66; 0.69]; strangler 0.51, reactive 0.41, turtle 0.00 | **failed** |
| Side 0 on each map < 55%, the 95% interval includes 50% (mirror matches) | arteriya 0.53 [0.48; 0.58], pautina 0.54 [0.48; 0.59], pereval 0.52 [0.47; 0.57]; over all matches 0.51 [0.49; 0.53] on each map | passed |
| The share of scheduled attacks among the strategic bots 20-70% | expander 0.13, rusher 0.08, strangler 0.05, reactive 0.04, turtle 0.00 | **failed** |
| Turtle beats Expander < 40% | 0.00 [0.00; 0.01] | passed (degenerately, see below) |
| A capture in the last 3 minutes in >= 30% of matches | 0.61 (4550/7500) | passed |
| The final ruleset `rulesets/mvp.toml` | - | the BAL-02 task |

Additionally (the BOT-05 report): rusher beats everyone significantly (a dominant strategy), there are no
rock-paper-scissors cycles; the competence check "reactive beats rusher more often than expander does" was not
met: 0.02 [0.01; 0.03] against 0.10 [0.08; 0.12] (#166). Draws 0.05, almost all matches go
to the timer (`vp` 6716 of 7500, `capital` 433). Cells without variability 0/75.

### Verdict

The gate on `mvp-0` is **failed**: 3 of the 5 numeric criteria are met (sides, the end of the match,
Turtle against Expander), 2 are not (a dominant strategy, the share of scheduled attacks). On
these numbers the mechanics collapse into a single strategy: "the War stance and capturing neutral nodes as fast
as possible". This is first of all a property of the ruleset, not only a weakness of the bots (evidence below);
start the BAL-02 iterations from the ruleset and fix Reactive and Turtle in parallel.

### Analysis: ruleset or bots

**1. The bottleneck: CP, not charges (ruleset).** The bots' wins are ordered strictly by stance:
rusher (War the whole match) 0.90 > expander (War for the first 1200-2400 ticks, then Balance) 0.68 >
strangler and reactive (Balance) 0.51 and 0.41 > turtle (Economy) 0.00. Matches are decided on VP, that is by
the number of nodes: at the end rusher holds 25-31 nodes against 2-7 for its opponents. A neutral city in the MVP
is empty (mechanics.md, section 9), a capture costs only an order (1 CP) and needs no charges, and
War leaves 75% of the regeneration in CP against 25% for Economy. Charges hardly limit anything: the success of sieges for
the campaign bots is 0.85-0.89. A check (10 seeds, the same set, not committed): `war = 40` instead of 25
lowers rusher to 0.81 [0.75; 0.85] (no significant domination any more), expander to 0.59, reactive
against rusher grows from 0.02 to 0.22 [0.13; 0.34], the sides show no skew.

**2. A scheduled order exactly pays for itself and therefore is almost never chosen (ruleset + metric).**
`prefer_planned` (`apps/bots/src/gow_bots/bots/utility.py`, the common function of all bots, AGENTS.md
section 8) takes the plan when the saved shots are worth more than the surcharge:
`saved * 100 > (planned_move - move) * charges_per_cp`, that is `saved > 2` with `mvp-0`. The bonus
`planned_bonus = 2`, so `saved = min(2, need) <= 2`, and the plan is chosen only when it
turns a bounce into a capture. A check with `planned_bonus = 3` (10 seeds): the share grows only to
0.17 / 0.10 / 0.07 / 0.06 (expander, rusher, strangler, reactive), rusher stays dominant
(0.88). The reason: the metric counts any `Move` to an enemy or neutral node as an attack, and most
of those orders go to empty neutral nodes (`need = 0`, no bonus is needed). While capturing neutrals
is free in charges, 20% cannot be reached by the price of the plan alone.

**3. Reactive against Rusher (#166): mostly a consequence of point 2, plus a weakness of the bot.** Reactive
responds only to public scheduled strikes; against reactive, rusher issues 1.4
scheduled orders per 77.9 attacking orders per match (about 2%), so there is almost nothing to respond to.
Without intents Reactive plays the basic campaign in Balance and keeps 200-300 CP in reserve "for a response",
that is it starves for CP even more. The result is 2.3 nodes against 30.2 at the end. A correction of the bots (not
of the ruleset) for #166: do not keep the reserve while there are no visible enemy plans; respond also to a visible
concentration of groups near your own cities.

**4. Turtle 0.00 against everyone: the idea is confirmed, but the bot is degenerate (bot + point 1).** All
defeats are on VP, not a single lost capital. Against expander 9.7 nodes against 22.9 (what the gate
wants to check: holding cities beats a bunker). But against rusher Turtle holds 1.8 nodes at the end,
that is it does not hold even its own region: in Economy it has about 3 CP per minute, "Defense" costs 2 CP,
attacking orders are 8-9 per match against 35-78 for the others. The warehouses are full, but there is nothing to spend the charges on.
A weakness of the bot: the Economy stance the whole match without switching. The mechanics: point 1 (charges are not
converted into strength without CP). The criterion "Turtle < 40% against Expander" is currently met
degenerately and must be rechecked after the fixes of point 1.

**5. A rules bug found: #175.** With `war = 40` one match of 750 (pautina, seed 0, strangler
against expander) fails in `combat` on the invariant "a group stands in a node with no arrival", and the
whole tournament aborts. On `mvp-0` there is no failure. It blocks iterations that change the stances; fix it before BAL-02
or as the first task in it.

### Hypotheses and candidates for BAL-02

| # | Hypothesis | Candidates (`mvp-0` keys) | Expectation |
|---|---|---|---|
| H1 | War is too profitable: CP is the only narrow resource | `economy.stance_to_charges_pct.war` 25 -> 40 (checked: rusher 0.81); together with `economy` 75 -> 60 | rusher and expander < 65%, Turtle and Reactive get CP |
| H2 | Capturing empty neutrals is too cheap, so VP is decided by the speed of claiming | there is no direct key in the ruleset; options: garrisons of neutral cities (a change of maps or rules, only through a DEC and mechanics.md) or `recruit.location = "capital"` (recruit only in the capital, fewer cheap bodies at the front). Proposed rule (2026-10-30): a capture costs a charge, `capture.charge_cost` ([DEC-38](../design/mechanics.md#capture-costs-a-charge-dec-38-578-proposed), #578, [proposed]; `0` in `mvp-0` and `mvp-1`, BAL-02 tests `1` in `mvp-2`) | fewer nodes for rusher, the fight for nodes matters more than the speed of claiming |
| H3 | The plan exactly pays for itself | `orders.planned_bonus` 2 -> 3 (checked: the share up to 0.17), or `orders.cost.planned_move` 200 -> 150 | the share of scheduled attacks grows; alone it will not reach 20% without H2 |
| H4 | The metric "share of scheduled attacks" is diluted by captures of empty neutrals | count the share only over attacks on occupied nodes (`need > 0`); this is a change of the metric definition in `gow_sim.analysis`, it needs an entry in mechanics.md, section 17, and not an edit of numbers | what is intended in section 5 gets measured |
| H5 | The bunker does not hold the region because of the CP starvation | `orders.cost.defense` 200 -> 100, `orders.defense_bonus` 2 -> 3 | Turtle holds the region against rusher, but still loses to expander on VP |

The order: first #175, then H1 (one edit, already visible in the data), then H2 or H3 separately,
each iteration with a `--seeds 100` tournament and a report in the PR (AGENTS.md, section 10). The bot fixes
(#166 for Reactive, stance switching for Turtle) go in separate PRs, so that the effect of the bot and of the ruleset
is not mixed in one iteration.

## BAL-02 (#40): iterations on `rulesets/mvp-2.toml`

`mvp-2` starts as a copy of `mvp-1` (`SIM_VERSION` 24); every iteration changes ruleset numbers only
(AGENTS.md, 4.1, item 7) and is marked `BAL-02` next to the key. `mvp-1` was the played ruleset during the iterations; the owner switched the defaults to `mvp-2` on 2026-10-30
(criterion 6, see "Owner decisions" below).

**Field.** The 10 strategic bots: `rusher`, `strangler`, `reactive`, `expander`, `turtle` (BOT-03) and
`smart_rusher`, `smart_strangler`, `smart_reactive`, `smart_expander`, `smart_turtle` (#166, the default `hard`
level); `idle` and `random_legal` are not counted (#40). The 3 pool maps (`crossroads`, `highway`, `ridge`), 10
seeds per iteration: `3 x 10 x 10 x 10 = 3000` matches. Iteration 0 ran locally (the laptop); from iteration 1 on the
iterations run on GitHub runners (`mise run tournament:gh`, #582, byte-identical to a local run).

**How the criteria are read.** Win rate: wins over the matches against the other strategic bots (mirror matches
excluded, a draw is not a win), 95% Wilson interval. Sides: the mirror matches of each map. Planned attack
share: `planned_attack_orders / attack_orders` summed over all strategic bots (the per-bot values are listed
too). Late capture: a match where either side captured something in the last 3 minutes.

### Iteration 0: the baseline, `mvp-1` unchanged

Ruleset `mvp-1` (hash `847cc9a644cf08715fafe7f5688a53d5`).

| bot | win rate [95%] | VP share | planned attack share | nodes at the end | charges produced | burned |
|---|---|---|---|---|---|---|
| smart_rusher | 0.80 [0.77; 0.84] | 0.67 | 0.03 | 36.8 | 91 | 28% |
| rusher | 0.76 [0.72; 0.79] | 0.67 | 0.03 | 39.2 | 78 | 22% |
| smart_expander | 0.69 [0.64; 0.72] | 0.58 | 0.01 | 27.4 | 169 | 61% |
| strangler | 0.66 [0.61; 0.69] | 0.54 | 0.01 | 27.9 | 171 | 70% |
| smart_strangler | 0.65 [0.61; 0.69] | 0.54 | 0.01 | 27.0 | 169 | 71% |
| reactive | 0.54 [0.50; 0.58] | 0.53 | 0.01 | 24.3 | 180 | 68% |
| smart_reactive | 0.51 [0.47; 0.55] | 0.52 | 0.01 | 22.9 | 179 | 75% |
| expander | 0.27 [0.24; 0.31] | 0.40 | 0.00 | 12.6 | 162 | 82% |
| turtle | 0.05 [0.04; 0.08] | 0.26 | 0.00 | 9.2 | 270 | 94% |
| smart_turtle | 0.05 [0.04; 0.07] | 0.30 | 0.04 | 13.4 | 243 | 86% |

| Criterion | Value | Outcome |
|---|---|---|
| No bot > 65% | smart_rusher 0.80, rusher 0.76, smart_expander 0.69, strangler 0.66 | failed |
| Side 0 < 55%, CI includes 50% (mirror) | crossroads 0.51 [0.41; 0.61], highway 0.52 [0.42; 0.63], ridge 0.65 [0.54; 0.75] | failed on ridge |
| Planned attack share 20-70% | 0.015 overall (every bot <= 0.04) | failed |
| Turtle vs Expander < 40% | turtle 0.00 [0.00; 0.06], smart_turtle vs smart_expander 0.00 | passed (degenerately) |
| Late capture >= 30% | 0.59 | passed |

End reasons: `vp` 2683, `capital` 254, draws 57. The rushers lose almost only by losing their capital (rusher
81 of 94 losses on 2 maps), they win on VP.

**Why the leader wins (from the data).** The results are ordered by the stance again: War (rushers) > War then
Balance (smart_expander) and Balance > Economy (turtles). Every bot outside War burns 61-94% of the charges it
produces (`charges_overflow`): the warehouses are full and a capture of an empty node needs no charge, so the charge
share of the quantum is mostly wasted. War produces half the charges of Balance and loses almost nothing for it
(it burns 22-28% of a smaller production), while its CP (9 CP a minute against 6 in Balance and 3 in Economy)
buy captures at 1 CP each: the rushers make about 100 move orders a match against 70 for Balance and 12-33 for
the turtles, and end with 37-39 nodes. Sieges succeed 96-98% of the time for everyone: the fights hardly decide
anything. The planned share is low for the reason of BAL-01, H3 and H4: `prefer_planned` needs
`saved > (planned_move - move) * charges_per_cp / 100 = 2` and never plans into an empty node, and most attacks go
into empty nodes.

### Iteration 1: `economy.charges_per_cp` 2 -> 1

**Hypothesis.** Charges are overproduced (iteration 0: 61-94% burn outside War), so the War stance pays nothing for
its CP. With half the charges, War (25% of the quantum) gets 3 charges a minute and should run short in its sieges,
while Balance still covers what it uses (about 50 charges a match).

**Change.** `economy.charges_per_cp = 1` (`mvp-1`: 2). Ruleset hash `cb13be21b46d79c538a0443f52ef22c8`, GitHub runners.

| bot | win rate [95%] | iteration 0 | burned |
|---|---|---|---|
| smart_rusher | 0.79 [0.75; 0.82] | 0.80 | 14% |
| rusher | 0.74 [0.70; 0.78] | 0.76 | 5% |
| smart_expander | 0.71 [0.67; 0.75] | 0.69 | 35% |
| strangler | 0.67 [0.63; 0.71] | 0.66 | 46% |
| smart_strangler | 0.65 [0.61; 0.69] | 0.65 | 46% |
| reactive | 0.55 [0.51; 0.59] | 0.54 | 48% |
| smart_reactive | 0.50 [0.46; 0.54] | 0.51 | 55% |
| expander | 0.28 [0.24; 0.32] | 0.27 | 68% |
| turtle | 0.05 [0.04; 0.08] | 0.05 | 88% |
| smart_turtle | 0.05 [0.04; 0.07] | 0.05 | 72% |

Sides (mirror): crossroads 0.48 [0.38; 0.58], highway 0.53 [0.42; 0.63], ridge 0.62 [0.51; 0.72]. Planned share
0.016. Late capture 0.58. Turtle vs Expander 0.00.

**Result: no effect.** Every win rate stays inside the interval of iteration 0. Halving production only cut the
burned share: the rushers still have a mean stock of 27-29 charges (the start stock of the map and the charged
start units) and win 96% of their sieges. Charges do not limit a strategy whose captures are free in charges,
so the charge side of the stance cannot be balanced by its rate alone. Reverted (back to 2) for the next iteration;
it is worth retrying together with DEC-38, where a capture spends a charge.

### Iteration 2: `capture.charge_cost` 0 -> 1 (DEC-38, #578, H2)

**Hypothesis (H2).** VP are decided by the speed of claiming empty nodes, which costs 1 CP and no charge. If every
capture spends a charge, the charge share of the stance gets a use, War pays for its CP with fewer captures, and
fights matter more than the claim.

**Change.** `capture.charge_cost = 1` (`mvp-1`: 0), everything else as `mvp-1`. Ruleset hash in the run rows.
**Caveat:** the bots did not know the cost yet (#580): they sent uncharged groups into captures that bounced. This
run measures the rule with bots that ignore it; iteration 5 reruns it with the bots of #580.

| bot | win rate [95%] | iteration 0 | captures a match (it. 0) | move orders (it. 0) |
|---|---|---|---|---|
| smart_rusher | 0.85 [0.81; 0.87] | 0.80 | 29.6 (59.9) | 125 (96) |
| smart_expander | 0.79 [0.75; 0.82] | 0.69 | 22.2 (49.6) | 96 (68) |
| rusher | 0.79 [0.75; 0.82] | 0.76 | 28.3 (64.5) | 129 (102) |
| smart_strangler | 0.61 [0.57; 0.65] | 0.65 | 19.1 (55.3) | 89 (73) |
| expander | 0.51 [0.47; 0.55] | 0.27 | 15.6 (18.5) | 39 (21) |
| smart_reactive | 0.48 [0.44; 0.52] | 0.51 | 17.2 (54.5) | 88 (67) |
| strangler | 0.42 [0.38; 0.46] | 0.66 | 16.3 (56.3) | 90 (76) |
| reactive | 0.37 [0.33; 0.41] | 0.54 | 17.2 (57.7) | 88 (74) |
| turtle | 0.11 [0.08; 0.14] | 0.05 | 10.8 (10.4) | 22 (12) |
| smart_turtle | 0.07 [0.05; 0.09] | 0.05 | 11.2 (16.7) | 34 (33) |

Sides (mirror): crossroads 0.59 [0.48; 0.68], highway 0.58 [0.46; 0.70], ridge 0.60 [0.48; 0.70], all 0.59
[0.52; 0.65]. Planned share 0.003. Late capture 0.30 (iteration 0: 0.59). Turtle vs Expander 0.00, smart 0.02.

**Result: worse for the gate with the current bots.** Captures halve for everyone, the bots spend the CP on more
move orders that bounce, sieges drop from about 40 to 4-12 a match, the late captures fall to the limit (0.30), and
the War bots still lead: they make the most orders, so they still claim the most. The charges keep burning
(48-92%): they wait in the warehouses while the bots march uncharged groups. Not kept (`charge_cost` back to 0);
retest with #580.

### Iteration 3: stance shares `economy` 75 -> 60, `war` 25 -> 40 (H1)

**Hypothesis (H1).** Charges have almost no value (iterations 0 to 2), so the stance with the most CP wins: War has
3 times the CP of Economy and 1.5 times that of Balance. Narrowing the shares (CP: Economy 40%, Balance 50%,
War 60%) should lower the War bots and give the Economy bots CP to act.

**Change.** `economy.stance_to_charges_pct.economy = 60` (75), `war = 40` (25); `capture.charge_cost` back to 0.

| bot | win rate [95%] | iteration 0 | move orders (it. 0) |
|---|---|---|---|
| smart_expander | 0.78 [0.74; 0.81] | 0.69 | 68 (68) |
| strangler | 0.71 [0.67; 0.74] | 0.66 | 75 (76) |
| smart_rusher | 0.70 [0.66; 0.73] | 0.80 | 80 (96) |
| smart_strangler | 0.66 [0.62; 0.70] | 0.65 | 73 (73) |
| rusher | 0.65 [0.61; 0.69] | 0.76 | 82 (102) |
| reactive | 0.58 [0.54; 0.62] | 0.54 | 76 (74) |
| smart_reactive | 0.56 [0.52; 0.60] | 0.51 | 67 (67) |
| expander | 0.24 [0.20; 0.28] | 0.27 | 20 (21) |
| turtle | 0.06 [0.04; 0.08] | 0.05 | 14 (12) |
| smart_turtle | 0.04 [0.02; 0.06] | 0.05 | 42 (33) |

Sides (mirror): crossroads 0.46 [0.35; 0.57], highway 0.54 [0.43; 0.65], ridge 0.51 [0.41; 0.61] (the ridge skew
of iterations 0 and 1 is gone, so it was noise of 100 mirror matches). Planned share 0.012. Late capture 0.57.
Turtle vs Expander 0.00 (both).

**Result: H1 confirmed for the rushers, kept.** The pure War bots lose 10 points each (0.80 -> 0.70,
0.76 -> 0.65) with 20% fewer orders; the lead moves to smart_expander (War early, Balance late, a guarded capital),
which now has the War CP early and the Balance charges late. The turtles still lose on VP (9-15 nodes at the end
against 25-33): the bunker holds its region but the region is worth fewer VP, which is the intent of
mechanics.md, section 11. **The arithmetic of the field:** the 10 win rates sum to about 4.9 (draws 2%), the two
turtles and expander give 0.34, so the other 7 average 0.65: criterion 1 can only pass with the 7 exactly level
or with the bunkers winning some matches.

### Iteration 4: planned order `planned_move` 200 -> 150, `planned_bonus_per_edge` 1 -> 2 (H3)

**Hypothesis (H3).** The shared `prefer_planned` plans when the saved shots exceed
`(planned_move - move) * charges_per_cp / 100`: 2 shots in `mvp-1`, while the bonus is 1 per edge, so a plan pays
only on a long strike that turns a bounce into a capture (planned share 0.012). With a surcharge of 0.5 CP
(1 shot) and 2 per edge, a strike on a defended neighbor with 2 charged units pays. This measures how far the
share can go while most attacks go into empty nodes (H4, `need = 0`, never planned).

**Change.** On top of iteration 3: `orders.cost.planned_move = 150` (200), `orders.planned_bonus_per_edge = 2` (1).

| bot | win rate [95%] | iteration 3 | planned attack share |
|---|---|---|---|
| smart_expander | 0.78 [0.74; 0.81] | 0.78 | 0.01 |
| smart_rusher | 0.72 [0.68; 0.76] | 0.70 | 0.04 |
| rusher | 0.69 [0.65; 0.73] | 0.65 | 0.04 |
| smart_strangler | 0.69 [0.64; 0.72] | 0.66 | 0.02 |
| strangler | 0.66 [0.61; 0.69] | 0.71 | 0.02 |
| reactive | 0.56 [0.52; 0.60] | 0.58 | 0.02 |
| smart_reactive | 0.55 [0.51; 0.59] | 0.56 | 0.01 |
| expander | 0.24 [0.21; 0.28] | 0.24 | 0.01 |
| turtle | 0.06 [0.04; 0.08] | 0.06 | 0.00 |
| smart_turtle | 0.03 [0.02; 0.05] | 0.04 | 0.06 |

Sides (mirror): crossroads 0.49, highway 0.54, ridge 0.50, every interval includes 0.5. Planned share 0.025
(iteration 3: 0.012). Late capture 0.59. Turtle vs Expander 0.00.

**Result: the share doubles but stays an order of magnitude below 20%; no win rate moves beyond its interval.
Reverted** (`mvp-1` prices). The ceiling is the metric, not the price (H4): the denominator counts every `Move` into
a node not owned by the player, and most of them go into empty neutral or enemy nodes where no plan can pay
(`need = 0`); sieges with defenders are a small part of the attacks. A cheaper plan cannot reach 20% without making
the plan nearly free; the criterion needs either the H4 metric (a definition change, an owner question) or more
defended targets (DEC-38, iteration 5).

### Iteration 5: `capture.charge_cost = 1` (DEC-38) with the bots of #580, on top of iteration 3

**Hypothesis (H2).** As iteration 2, now with bots that send claiming groups charged and do not loop on an unpaid
capture (#580, PR #584). The charge-flow report (`charge-flow.md`, finding 4) shows that with the cost the defenders
stand without charges (74-86% of sieges), so the fights should decide more.

**Change.** `capture.charge_cost = 1`, plus iteration 3 (stance shares 60/50/40); iteration 4 reverted. The branch
is rebased on develop with #584.

| bot | win rate [95%] | iteration 3 | captures a match (it. 3) | recruits (it. 3) |
|---|---|---|---|---|
| smart_expander | 0.92 [0.89; 0.94] | 0.78 | 36.7 (49.7) | 25.4 (13.2) |
| smart_rusher | 0.86 [0.83; 0.88] | 0.70 | 41.5 (54.9) | 21.6 (5.3) |
| rusher | 0.73 [0.69; 0.77] | 0.65 | 40.0 (57.0) | 21.7 (4.5) |
| smart_strangler | 0.67 [0.63; 0.71] | 0.66 | 36.1 (55.6) | 19.7 (4.0) |
| strangler | 0.60 [0.56; 0.64] | 0.71 | 36.5 (55.2) | 19.1 (3.4) |
| reactive | 0.37 [0.33; 0.42] | 0.58 | 26.1 (58.5) | 0.0 (0.0) |
| expander | 0.37 [0.33; 0.41] | 0.24 | 13.6 (18.0) | 9.0 (9.8) |
| smart_reactive | 0.33 [0.29; 0.37] | 0.56 | 26.0 (55.6) | 1.9 (0.3) |
| turtle | 0.07 [0.05; 0.09] | 0.06 | 11.5 (12.2) | 6.7 (6.3) |
| smart_turtle | 0.06 [0.04; 0.08] | 0.04 | 12.9 (19.1) | 23.0 (23.6) |

Sides (mirror): crossroads 0.45 [0.35; 0.55], highway 0.56 [0.45; 0.66], ridge 0.59 [0.48; 0.68]. Planned share
0.033. Late capture 0.47 (iteration 3: 0.57). Turtle vs Expander 0.00. Capital wins 119 (iteration 3: 302).

**Result: the field polarizes, the gate gets further away.** The bots that recruit and send charged groups (the
rushers, smart_expander, the stranglers: about 20 recruits a match, 4-6 times iteration 3) keep claiming at 65-75% of
the old speed; the reactive bots, which never recruit, fall to 0.33-0.37. smart_expander becomes the dominant
strategy (0.92, it beats everyone but smart_rusher beyond 0.80). This agrees with the #580 smart-bot run (20 seeds,
`mvp-1` shares: smart_expander 0.68 -> 0.84). DEC-38 as such makes the claim cost a body and a charge, and the bots
with more bodies win the claim even harder. Not kept alone; iteration 6 checks whether a faster supply (charged
defenders, `charge-flow.md`, finding 4) changes the picture.

### Iteration 6: road throughput `supply.amount_by_level` 1/2/3 -> 2/3/4, on top of iteration 5

**Hypothesis.** With a capture cost the defenders stand uncharged (`charge-flow.md`, finding 4: 74-86% of defenders
have no charged unit at a siege) because delivery, not production, limits the front (finding 2: a marker city is
empty 21-40% of the time while the capital has charges; a level-1 road carries 1 charge per dispatch). Doubling the
level-1 throughput (+1 per level as in DEC-28, item 7) should charge the front garrisons, make captures of held cities
cost fights again and slow the claim of the recruiting bots. The rear stock is not a bot issue: it is the spill of the
full capital (DEC-28, item 4.4); the smart bots raise `rear_min` only to 2-3 while the capital is full.

**Change.** `supply.amount_by_level` `1 = 2`, `2 = 3`, `3 = 4` (`mvp-1`: 1, 2, 3); `capture.charge_cost = 1` and
the stance shares of iteration 3 kept.

| bot | win rate [95%] | iteration 5 |
|---|---|---|
| smart_expander | 0.91 [0.88; 0.93] | 0.92 |
| smart_rusher | 0.87 [0.84; 0.89] | 0.86 |
| rusher | 0.74 [0.70; 0.78] | 0.73 |
| smart_strangler | 0.67 [0.63; 0.71] | 0.67 |
| strangler | 0.59 [0.55; 0.64] | 0.60 |
| reactive | 0.37 [0.33; 0.41] | 0.37 |
| expander | 0.36 [0.32; 0.40] | 0.37 |
| smart_reactive | 0.35 [0.31; 0.39] | 0.33 |
| turtle | 0.07 [0.05; 0.09] | 0.07 |
| smart_turtle | 0.05 [0.04; 0.08] | 0.06 |

Sides (mirror): crossroads 0.51, highway 0.51, ridge 0.52. Planned share (old definition) 0.033. Late capture 0.47.

**Result: no effect.** Every win rate within 0.02 of iteration 5. The bots take few sieges of held cities (2-23 a
match); the claim of empty nodes decides, and a faster supply does not touch it. Reverted.

### The candidate: iteration 3

The only change that moved the gate the right way is H1 (iteration 3). The final `mvp-2` = `mvp-1` with
`economy.stance_to_charges_pct.economy = 60` and `war = 40`, `capture.charge_cost = 0`. Its confirming run
(100 seeds on GitHub runners, the gate share of #590) follows.

### The confirming run: `mvp-2` (iteration 3), 100 seeds

Ruleset `mvp-2`, hash `9d8cc4dd4b48572ad2be415c2fcc4d4c` (archived as `rulesets/archive/9d8cc4dd4b48572ad2be415c2fcc4d4c.toml`),
`SIM_VERSION` 25, the 10 strategic bots, the 3 pool maps, seeds 0..99: 30000 matches on GitHub runners
(`mise run tournament:gh --ruleset rulesets/mvp-2.toml --seeds 100 --shards 20`). The report: [latest.md](latest.md)
(built from the full file). `latest.jsonl` holds seeds 0..9 of this run (3000 rows): the full file is 76 MB, too big
for git; it is reproducible byte for byte with the command above (the run artifact `tournament-final-100-*`). The gate
share is the #590 definition (`planned_siege_share`) from this run on; iterations 0 to 6 measured the BAL-01 share only.

| bot | win rate [95%] | iteration 0 (`mvp-1`, 10 seeds) | planned siege share (#590) | planned share of all attacks |
|---|---|---|---|---|
| smart_expander | 0.74 [0.73; 0.76] | 0.69 | 0.09 | 0.01 |
| rusher | 0.70 [0.69; 0.72] | 0.76 | 0.08 | 0.01 |
| smart_rusher | 0.70 [0.69; 0.71] | 0.80 | 0.09 | 0.02 |
| strangler | 0.68 [0.67; 0.69] | 0.66 | 0.06 | 0.01 |
| smart_strangler | 0.67 [0.65; 0.68] | 0.65 | 0.07 | 0.01 |
| reactive | 0.60 [0.59; 0.61] | 0.54 | 0.05 | 0.01 |
| smart_reactive | 0.55 [0.54; 0.57] | 0.51 | 0.06 | 0.00 |
| expander | 0.24 [0.23; 0.25] | 0.27 | 0.16 | 0.01 |
| turtle | 0.07 [0.06; 0.08] | 0.05 | 0.05 | 0.00 |
| smart_turtle | 0.03 [0.03; 0.04] | 0.05 | 0.69 | 0.05 |

| Criterion (#40) | Value | Outcome |
|---|---|---|
| 1. No strategic bot > 65% | smart_expander 0.74, rusher 0.70, smart_rusher 0.70, strangler 0.68, smart_strangler 0.67 | **failed** (top: 0.80 -> 0.74) |
| 2. Side 0 < 55%, CI includes 50% (mirror) | crossroads 0.50 [0.47; 0.54], highway 0.50 [0.46; 0.53], ridge 0.49 [0.46; 0.53] | passed |
| 3. Planned attack share 20-70% (#590: sieges of defended nodes) | 0.084 overall (34047 of 405615 siege orders); per bot 0.05-0.16, smart_turtle 0.69 | **failed** |
| 4. Turtle vs Expander < 40% | turtle 0.00 [0.00; 0.01], smart_turtle vs smart_expander 0.00 [0.00; 0.01] | passed (degenerately) |
| 5. Late capture >= 30% | 0.58 | passed |
| 6. Final ruleset `rulesets/mvp.toml`, archived | `mvp-2` archived by hash; no `mvp.toml` | **met** by `mvp-2` as the played ruleset (owner decision 2026-10-30, see "Owner decisions") |

End reasons: `vp` 26569, `capital` 2810, `cities` 103, draws 488, double defeats 30.

### Verdict and the gaps

The gate is **not passed** after 6 iterations (the timebox). `mvp-2` is better than `mvp-1` on every measured
criterion that moved: the leaders fall from 0.80 to 0.74, no bot dominates beyond 0.75, the sides hold on 300
mirror matches per map. Recommendation to the owner: play `mvp-2` (the stance shares 60/50/40) instead of `mvp-1`
if a switch is wanted now; it changes two numbers and no rule.

What the numbers could not do, and why (design hypotheses for the next step):

1. **Criterion 1 is blocked by the bunkers.** The 10 win rates sum to about 4.9; the two turtles and expander give
   0.34 (they lose on VP by design: mechanics.md, section 11, "VP is the remedy against the bunker"; criterion 4 wants
   them to lose to the expansion), so the other 7 must average 0.65, which leaves no room for any skill difference
   among them. Either the bunkers must win some matches (a VP rule that rewards a held region, e.g. a VP threshold or a
   final-hold bonus, section 11 [open]) or the criterion should be read over the non-bunker bots. Both are owner
   decisions; the orchestrator's brief says criterion 1 is not reworded.
2. **The claim of empty nodes decides the match.** 46-60 captures a match against 2-44 sieges, 96-98% of sieges
   succeed. Every lever that only prices charges (iterations 1, 6) does nothing, because a free claim needs no
   charge; DEC-38 (a capture costs a charge, iterations 2 and 5) makes the claim cost a body and a charge, and the bots
   with the most recruits win the claim harder (smart_expander 0.92). A rule that slows the claim itself (neutral
   garrisons, a claim delay, diminishing VP of far nodes) is a DEC question.
3. **The planned share stays low** because few attacks meet a garrison and a plan pays only against a garrison:
   even with the #590 definition 0.084. The bots defend few nodes (0.8-1.1 charged defenders at a siege,
   `charge-flow.md`), so there is little to plan against. The share grows with defended fronts, which point 2 would
   bring.

### Owner decisions (2026-10-30)

1. **Played ruleset.** The defaults (`stack`, `stack:reset`, `stack:agent`, `tournament`, `search`, `maps`, `compose.yaml`,
   the `app` image, the `tournament.yml` input) now point to `rulesets/mvp-2.toml`. The file keeps the name `mvp-2.toml`
   (no `rulesets/mvp.toml`). It is archived by hash as `rulesets/archive/9d8cc4dd4b48572ad2be415c2fcc4d4c.toml` (byte
   for byte equal to the file). Criterion 6 of #40 is met by `mvp-2` as the played ruleset. `mvp-0` and `mvp-1` stay
   as test and historical rulesets (golden replays, unit tests), `SIM_VERSION` is unchanged.
2. **Criterion 1 (#611, option A).** "No strategic bot > 65%" is read over the non-bunker strategic bots (`rusher`,
   `strangler`, `reactive`, `expander` and their `smart_*` versions). The bunkers (`turtle`, `smart_turtle`) are checked by
   criterion 4. Recorded in mechanics.md, section 17. The claim of empty nodes (option C) is not decided: the owner
   waits for the planned-order diagnostic; if chosen, it gets its own DEC.

**Criterion 1 under reading A, confirming run (30000 matches).** Win rate of the 8 non-bunker bots against all other
strategic bots (the column of "Metrics by bot" in [latest.md](latest.md)): smart_expander 0.74, rusher 0.70,
smart_rusher 0.70, strangler 0.68, smart_strangler 0.67 (all above 0.65), reactive 0.60, smart_reactive 0.55,
expander 0.24. **Not met**. A stricter variant, only against non-bunker opponents (mean of the 7 pairs of the pair
matrix, 600 matches each; the matrix is rounded to two decimals and the 30000-row file is not in the repo, so these
are approximations): smart_expander 0.67 [0.66; 0.68], rusher 0.62, smart_rusher 0.62, strangler 0.59,
smart_strangler 0.57, reactive 0.49, smart_reactive 0.43, expander 0.02. Still **not met**, by smart_expander alone.
So the gate stays open on criteria 1 and 3.
