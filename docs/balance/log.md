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

### Experiments H-map and H-strike (2026-10-30): is it the maps, or the missing strike?

Two owner hypotheses before the DEC on the claim race (#40, comment of 2026-10-30). Nothing of this is in the game: the
striker bots lived on a temporary branch (deleted). Both runs on GitHub runners, `mvp-2`, seeds 0..19, the bots of
develop `44c449c` (the #574 bot PR had not landed).

**H-map** (the pool maps are too big for 15 minutes, so contact and planned orders come late): the 10 strategic bots on
the pool and on the fixtures `artery`, `pass`, `web` (they validate under `mvp-2`), 12000 matches (run 41061251055).
The fixtures differ in more than size: 31-34 nodes against 49-51, **no provinces** (every node a city, so no node of
capacity 3), capitals 5-8 hops apart against 8-9.

| | pool (3 maps) | small (3 fixtures) |
|---|---|---|
| planned siege share, non-bunker bots (#590) | 0.076 | 0.135 |
| capital wins, share of matches | 0.097 | 0.119 |
| capital win, mean tick | 4275 | 2825 |
| `vp` endings | 0.88 | 0.86 |
| siege orders a match (non-bunker matches) | 17.5 | 14.5 |
| captures a match (both players) | 88.7 | 74.4 |
| top non-bunker win rate [95%] | smart_expander 0.75 [0.72; 0.77] | strangler 0.74 [0.72; 0.77] |
| side 0 in mirrors | 0.49 [0.44; 0.53] | 0.52 [0.48; 0.57] |

The pool numbers match the 100-seed confirming run. **Verdict: partly.** Small maps raise the planned share by 1.8x and
bring capital wins 1.5x earlier, but the share stays below 20%, there are not more sieges of garrisons (fewer), the
timer still ends 86% of the matches, and criterion 1 still fails (four bots at 0.67-0.74; the leader changes from
smart_expander to strangler). `web` (capitals 5 hops apart) and `pass` (8 hops) give the same planned share (0.15), so
the distance between capitals is not what moves it; the absence of provinces (bigger groups pass) is the likelier cause,
but the run cannot separate it from the node count.

**H-strike** (a bot that ignores VP and strikes the charged enemy capital would make the plan pay): `smart_striker`, a
SmartBot personality (War, VP weights 0, claims only a corridor toward the enemy capital, gathers a fist on a stage
node within 2 hops of it, probes the capital with one unit when the fog hides the numbers, strikes first in the
decision and holds CP for it when the estimate says the fist and the groups next to it take the capital). The corridor
is robust: it claims nodes that remove the chokepoints between the own capital and the stage, keeps watchers on two of
them, sends a group to a chokepoint an enemy heads into, and a cut fist fights its way back. Variants:
`smart_striker_plan` / `_noplan` (always / never plan the capital strike), `smart_striker_naive` (a one-node tunnel:
none of the robust part). Against the 5 smart bots, all 6 maps, 9720 matches (run 41065934845), plus a local trace of
120 matches (pool, seeds 0 and 1) for the strikes and the fist.

| striker vs | expander | reactive | rusher | strangler | turtle | all 5, pool | all 5, small |
|---|---|---|---|---|---|---|---|
| `smart_striker` (pool) | 0.03 [0.01; 0.07] | 0.00 [0.00; 0.03] | 0.23 [0.16; 0.31] | 0.01 [0.00; 0.05] | 0.66 [0.57; 0.74] | 0.18 [0.15; 0.22] | 0.32 [0.28; 0.35] |
| `_plan` | | | | | | 0.18 [0.15; 0.21] | 0.23 [0.20; 0.27] |
| `_noplan` | | | | | | 0.16 [0.13; 0.19] | 0.26 [0.22; 0.29] |
| `_naive` | | | | | | 0.14 [0.11; 0.17] | 0.22 [0.19; 0.25] |

Capital wins a match: 0.058 pool, 0.110 small (`smart_striker`), median at tick 2392 / 1863; the other variants 0.04-0.05
pool. Always against never planning: capital wins 31 against 24 (pool), 29 against 62 (small); head to head 0.52
[0.43; 0.60] and 0.55 [0.46; 0.64]. Robust against naive: head to head 0.68 [0.60; 0.76] (pool), 0.63 [0.54; 0.71]
(small). The trace: the auto striker plans 38% of the groups it sends at the capital; at a strike the capital holds 3.2
units with 3.2 charges on average (0 charges in 8%, 2-4 in 64%) and a full warehouse (5.7 of 6), the striking groups
carry 2.7 charges each; a fist (4+ units within 2 hops of the capital) forms in 46 of 60 matches, at tick 2540 on
average, is cut off for 30+ ticks in 31 of 60 (naive 30 of 60), and only 4 of its 76 episodes reach a fight at the
capital. Decision time: 0.5-0.9 ms mean, p99 up to 2.4 ms (the inherited attack scans over many small groups; the naive
variant is 10% cheaper), over the 1 ms budget at p99.

**Verdict: rejected.** The striker loses to every smart bot but the bunker (0.18 overall on the pool), and the plan
does not beat a normal order against the capital. Why:

1. **The fist cannot get big.** CP is the scarce resource (BAL-02, the plan diagnostic): a unit costs 1 CP to recruit
   in the capital and about 1 CP to walk it to the front; War gives 7.2 CP a minute, so the fist grows by at most
   about 3 units a minute (an estimate from the prices) while the corridor costs its own CP. The striking groups carry 2-3 charges each.
2. **The defenders are charged where it matters.** The capital holds 2-4 charged units and refills them from a full
   warehouse between fights; with 1 shot a round (DEC-32) the defender has time to reinforce. So the hypothesis is right
   that the capital is a charged target, but the attacker cannot bring enough to it.
3. **The stack limit caps the fist** at the stage capacity (6-8; provinces of capacity 3 on the way split it), below the
   capital's 10, so a strike needs several groups to arrive together.
4. **The plan's bonus is small here**: a strike from 1-2 hops gets 1-2 virtual shots (DEC-29), worth less than the
   delay and the public intent; always planning halved the capital wins on the small maps.
5. **Ignoring VP is fatal**: the timer ends most matches, and the striker's wins are VP wins against the turtle.
   The robust corridor matters (it beats the naive tunnel), but the fist is still cut in half of the matches.

`smart_striker` is not competitive, so it does not become a personality (no issue).

**What this means for the open DEC.** Both runs point at the same thing as the plan diagnostic: the claim of empty nodes
decides, and few targets are charged. A smaller map pool alone (H-map) moves the planned share from 0.08 to 0.14 and
does not fix criterion 1; a decisive strike (H-strike) does not pay under `mvp-2`. Option **B** (charged targets:
neutral garrisons or a claim delay) is the lever both results support; option **A** (a cheaper plan) does not help the
strikes measured here, whose bonus is 1-2 shots. If the pool changes as well, the property to decide is the share of
provinces (capacity 3), then the node count (30-35 instead of about 50); the distance between capitals showed no effect.

## Server bot levels (#574)

`POST /api/bot-matches` plays the smart bots at a tempo level (`gow_server.botmatch.LEVEL_BOTS`). The table was
chosen from a tournament on `mvp-2` (hash `9d8cc4dd4b48572ad2be415c2fcc4d4c`, `SIM_VERSION` 25): the 15 smart bots
(5 personalities x `easy`/`normal`/`hard`), 3 pool maps, 20 seeds, both sides, 13500 matches on GitHub runners.
Criterion: the levels in order of strength (every higher level beats every lower one head to head, and the win rates
against the whole field rise), preferring four different personalities.

| Level | Bot | Style (client) | Win rate against the 14 others [95%] | Beats the level below |
|---|---|---|---|---|
| `easy` | `smart_turtle@easy` | Bunker | 0.06 [0.05; 0.07] | - |
| `normal` | `smart_reactive@easy` | Counter | 0.46 [0.44; 0.48] | 0.98 against easy |
| `hard` | `smart_strangler@hard` | Strangler | 0.65 [0.63; 0.67] | 0.70 [0.61; 0.78] against normal |
| `expert` | `smart_expander@hard` | Expander | 0.72 [0.70; 0.74] | 0.67 [0.58; 0.74] against hard |

Head to head, both sides (120 matches per pair): expert beats normal 0.88 and easy 1.00; hard beats easy 1.00. Notes:

- The tempo levels alone separate the bots little: `hard` and `normal` of the same personality are within the interval
  of each other (expander 0.72 and 0.75, strangler 0.65 and 0.65, rusher 0.63 and 0.61); only `easy` is clearly weaker
  for expander, strangler and rusher. So the ladder mixes personalities.
- `smart_turtle` loses to every other bot (0.06 to 0.08 at any level): a passive opponent for a first match; the step
  from `easy` to `normal` is large (0.98), a gap of the field, not of the tempo.
- The rusher personality is left out: `smart_rusher@hard` (0.63) is within the interval of `smart_strangler@hard`
  and loses to `smart_expander@hard` by 0.59 only (a narrower margin than the strangler's 0.67).
- Matches already stored with the old bot names (`turtle`, `reactive`, `expander`, `rusher`) keep their level in the
  replay nick (`gow_server.replays`).

## Smart bots keep the CP of a chosen plan and answer strikes at lesser cities (#618)

The BAL-02 plan diagnostic (#40) found that the smart bots spend every 1 CP at once (516 of 1429 chosen plans failed for
lack of CP) and that defenders do not react to a visible enemy intent at a lesser city. #618 adds the `wait_plan` hold
and the `worth_defense` answer (`gow_bots.bots.smart`, items 10 and 11; `docs/balance/README.md`). `SIM_VERSION` is
unchanged (bots only). Before/after: the 15 smart bots (5 personalities x 3 levels), `mvp-2`, 3 pool maps, 20 seeds,
13500 matches each, GitHub runners (the draws of the other parameters are unchanged: the new keys sort after all varied
ones).

Win rate against the other 14 bots [95%] and the planned share of sieges (`planned_siege_orders / siege_orders`):

| bot | before | after | planned siege share before -> after |
|---|---|---|---|
| smart_expander@normal | 0.75 [0.73; 0.77] | 0.72 [0.70; 0.74] | 0.119 -> 0.329 |
| smart_expander@hard | 0.72 [0.70; 0.74] | 0.70 [0.68; 0.73] | 0.116 -> 0.336 |
| smart_strangler@hard | 0.65 [0.63; 0.67] | 0.65 [0.63; 0.68] | 0.072 -> 0.382 |
| smart_rusher@hard | 0.63 [0.60; 0.65] | 0.66 [0.64; 0.68] | 0.122 -> 0.466 |
| smart_reactive@hard | 0.54 [0.52; 0.57] | 0.50 [0.47; 0.52] | 0.086 -> 0.367 |
| smart_turtle@hard | 0.08 [0.07; 0.09] | 0.08 [0.07; 0.10] | 0.698 -> 0.753 |

(The `normal` and `easy` rows are in the PR description; `easy` does not hold CP, it has no `insight`.) The five `hard`
bots among themselves (1500 matches): expander 0.74 -> 0.69, rusher 0.61 -> 0.67, strangler 0.62 -> 0.66, reactive 0.53
-> 0.47, turtle 0.00 -> 0.01. Planned share of sieges over all 13500 matches: 0.148 -> 0.351 (planned share of attacks
0.018 -> 0.049); among the `hard` bots 0.127 -> 0.432.

**Result.** Contrary to the diagnostic's prediction the planned share of sieges rose strongly: a plan that is chosen is
now paid, so it is sent instead of an ordinary order on the same target. Win rates moved little: every change is within or at the
edge of the interval; the largest are `smart_reactive` (-0.04) and `smart_rusher` (+0.03). The order of the field is the same, the
server level ladder of #574 holds (hard beats normal 0.70 -> 0.70, expert beats hard 0.67 -> 0.58, a narrower margin).
No tuning to the gate was done. Both changes stay on for every personality.

## Playtest 2026-10-30: four owner matches against the smart bots

The owner played four matches on `crossroads` under `mvp-2` (`SIM_VERSION` 25, the bots of #618) against
`smart_strangler@hard` (two) and `smart_expander@hard` (two) and won all four, three by taking the capital. The
re-simulated logs are analysed in [playtest-2026-10-30.md](playtest-2026-10-30.md): CP, supply, upgrades, fights,
the capital strikes, the encirclements and a verdict on each of the owner's eight observations. In short: the bot lost
75 units in fights against the human's 10 (51 of them in garrisons outgunned by 2+), both sides burned 36-69% of their
charges while CP was the binding constraint, every capital strike came from Middle Court (a large city next to the
bot capital) that the bot did not retake, a capital charge took 17-27 s to reach the front, and the starvation and
G3 checks found no contradiction with `mechanics.md`. The candidate changes (bots B1-B4, ruleset R1-R2, rules D1-D3)
are for the owner's decision; nothing was changed.

## A benchmark of the owner's staging strike and the smart bots' answers (#624)

The owner beat the hard smart bots 4 of 4 with one plan ([playtest-2026-10-30.md](playtest-2026-10-30.md)). PR #633
added `smart_hoarder` (`gow_bots.bots.hoarder`), a `SmartBot` personality that plays it: War, claims only in groups of
2+, a barracks in the centre (`crossroads`: Crossroads), from tick 2400..3600 recruits first and an advance to the
stage (the largest city next to the enemy capital, `crossroads`: Middle Court), then a converging strike (`SmartBot`
item 12: groups within 3 edges, the main one by an ordinary order, small far ones planned, arrivals aligned within
10 ticks by the travel times of mechanics.md section 4, the price banked while ready). Against the hard bots on
`crossroads` (20 local matches, the hoarder on the owner's side) it staged in Middle Court in 18, built the Crossroads
barracks in 5 (late: tick 3501-6951, the owner at 1105-1118), and struck twice with the owner's shape (4 groups, 13
charged, the 8-unit main group from Middle Court, one planned flank from 2 edges); it won 13 of 20, mostly on VP:
its front groups are often discharged far from supply (observation 6 of the playtest), so a strike is rarer than the
owner's.

PR #641 adds the answers (`SmartBot` items 13-17, each with a switch) and the converging strike for every personality
but the bunker (on top of the single attacks on the capital, `STRIKE_MIN` 2 groups, no banking). The benchmark keeps
none of the answers, so it stays the same yardstick (its `state_hash` is unchanged).

### Runs

All on GitHub runners, `mvp-2` (hash `9d8cc4dd4b48572ad2be415c2fcc4d4c`), `SIM_VERSION` 25, the 3 pool maps, seeds
0..19, both sides. The full field is the 15 smart bots (5 personalities x 3 levels) and `smart_hoarder`: 15360
matches. The ablations ran the 8 bots that matter here (the 5 hard bots, the ladder's `smart_reactive@easy` and
`smart_turtle@easy`, the hoarder; 3840 matches); a match depends only on its map, bots and seed, so the same 3840
matches of a full run compare one to one.

| run | branch state | runner run |
|---|---|---|
| before | #633: the hoarder, the personalities as on develop | 41107108133 |
| after 1 | the strike replaces single attacks on the capital, all answers on, banking | 41114156697 |
| after 2 | the strike adds to single attacks, no banking, all answers on | 41120933594 |
| strike only | after 2 without any answer | 41120991330 |
| ablation a | after 2 without items 15 and 16 (8 bots) | 41127631886 |
| ablation b | after 2 without items 13 and 14 (8 bots) | 41127678799 |
| final | ablation b as the default (items 13 and 14 off), the full field | 41131096355 |

### The 8-bot field (win rate against the other 7 [95%])

| bot | before | after 2 | strike only | a: 13, 14, 17 on | b: 15, 16, 17 on |
|---|---|---|---|---|---|
| smart_hoarder | 0.78 [0.75; 0.81] | 0.83 [0.80; 0.85] | 0.78 [0.75; 0.81] | 0.83 [0.81; 0.86] | 0.76 [0.73; 0.79] |
| smart_expander@hard | 0.73 [0.70; 0.76] | 0.65 [0.62; 0.68] | 0.73 [0.70; 0.76] | 0.67 [0.64; 0.70] | 0.72 [0.69; 0.75] |
| smart_rusher@hard | 0.69 [0.66; 0.72] | 0.72 [0.69; 0.75] | 0.69 [0.66; 0.72] | 0.72 [0.69; 0.75] | 0.67 [0.64; 0.70] |
| smart_strangler@hard | 0.65 [0.62; 0.68] | 0.61 [0.57; 0.64] | 0.65 [0.62; 0.68] | 0.58 [0.55; 0.62] | 0.66 [0.63; 0.69] |
| smart_reactive@hard | 0.51 [0.48; 0.54] | 0.52 [0.49; 0.55] | 0.51 [0.48; 0.54] | 0.50 [0.47; 0.54] | 0.57 [0.54; 0.60] |

The hard bots against the hoarder (their score, 120 matches each, before / after 2 / strike only / a / b): expander
0.44 / 0.23 / 0.44 / 0.26 / 0.38, rusher 0.56 / 0.47 / 0.56 / 0.47 / 0.56, strangler 0.18 / 0.20 / 0.18 / 0.12 /
0.31, reactive 0.17 / 0.12 / 0.17 / 0.15 / 0.25 (intervals about +-0.08).

**What the runs say.**

1. **Items 13 and 14 hurt.** The worry (B1: walk home and recruit at home when the visible build-up plus the bound of
   the hidden force reaches what takes the capital) and the withdrawal of thin province garrisons (B2) cost the
   expander 0.06-0.08 and the strangler 0.04-0.07 against the field and made every hard bot weaker against the hoarder
   (after 1 and 2, ablation a). The bots lose their claims and their tempo to the walk home and to nodes given up; the
   benchmark wins on VP, not by the strike it builds up, so a defense against the strike does not pay against it.
   Both stay in the code with a switch, off for every personality.
2. **Items 15-17 help where the playtest saw the weakness.** War while the warehouses are 9/10 full (B3), one forward
   barracks in the centre (B4) and the alarm on two strikes at one node: the strangler gains 0.13 against the hoarder
   (0.18 -> 0.31), the reactive 0.08 (0.17 -> 0.25) and 0.06 against the field; the expander loses 0.06 against the
   hoarder (within the intervals) and 0.01 against the field.
3. **The converging strike changes almost nothing for the personalities** (strike only = before within 0.01): their
   single attacks already take the capital when a group can, and a second group within 3 edges of the enemy capital
   with an own path is rare outside the hoarder's play. As a replacement of the single attacks (after 1) it cut the
   capital wins of the expander from 65 to 15 and of the strangler from 184 to 62: dropped.

### The result (the code of PR #641 = ablation b) and the server ladder

`LEVEL_BOTS` (#574) on the same 3840 matches, head to head (120 matches each, both sides):

| step | before | after (b) |
|---|---|---|
| normal `smart_reactive@easy` beats easy `smart_turtle@easy` | 0.97 [0.93; 0.99] | 0.97 [0.93; 0.99] (unchanged: neither bot answers) |
| hard `smart_strangler@hard` beats normal | 0.70 [0.61; 0.77] | 0.77 [0.68; 0.83] |
| expert `smart_expander@hard` beats hard | 0.58 [0.49; 0.67] | 0.55 [0.46; 0.64] |
| expert beats normal | 0.92 [0.85; 0.95] | 0.88 [0.81; 0.93] |

The ladder holds in order; the expert-over-hard step was already inside the interval of 0.5 before (#618 measured 0.58)
and stays there, so no new table is proposed. Planned siege share of the 8-bot field: 0.416 before, 0.421 after.
The hoarder stays the strongest bot of the field (0.74 of 16 bots before, 0.76 of 8 after); only the rusher (0.56)
holds it about even. What would close the gap is not a defense against the strike but the claim and supply game it wins
on VP: its front groups are charged and in groups of 2+, the bots' are single and spread.

The full 16-bot run of the final code (41131096355) was dispatched; its artifact was not downloaded here (the
GitHub API rate limit of the account ran out during the session), the 8-bot numbers above are the same matches.

## Economy v2: the smart bots and the hoarder play `mvp-3` (#648)

PR #648 teaches the bots the economy of DEC-41 (`gow_bots.bots.economy`, [README.md](README.md), "Economy v2"): no
v1-only command under v2, lines only from the own factories to the nodes that want charges, two built factories, bunkers
for the personalities that used Defense, warehouse levels for charges, a planned order only where its bonus turns a
bounce into a capture (asking for the missing shots, at most the warehouse stock), `ReleasePlan` after a long gathering,
the converging strike plans every group that can gather; the hoarder's hoard gets its line first. Under v1 nothing
changed: the `mvp-2` run below has the `state_hash` of `develop` in all 3840 matches.

### Runs

| run | ruleset | field | matches | runner run |
|---|---|---|---|---|
| v2 field | `mvp-3` (hash `bcea544177702fae1f939a9910c396e0`), `SIM_VERSION` 28 | 15 smart bots (5 x 3 levels) + `smart_hoarder` | 15360 | 41211377076 |
| v1 check, branch | `mvp-2` | the 8 bots of #624 | 3840 | 41211384341 |
| v1 check, `develop` | `mvp-2` | the same | 3840 | 41211384091 |

All on the 3 pool maps, seeds 0..19, both sides. Local smoke (`mise run tournament -- --seeds 3 --ruleset
rulesets/mvp-3.toml`, every registered bot): no crash.

### `mvp-3`: win rate against the others [95%]

| bot | 16-bot field | the 8 bots of #624 | `mvp-2`, 8 bots (= #624 ablation b) |
|---|---|---|---|
| smart_expander@hard | 0.88 [0.86; 0.89] | 0.88 [0.85; 0.90] | 0.72 |
| smart_rusher@hard | 0.82 [0.80; 0.84] | 0.80 [0.78; 0.83] | 0.67 |
| smart_expander@normal | 0.79 [0.77; 0.81] | | |
| smart_rusher@normal | 0.76 [0.74; 0.77] | | |
| smart_strangler@hard | 0.72 [0.70; 0.74] | 0.67 [0.64; 0.70] | 0.66 |
| smart_hoarder | 0.70 [0.68; 0.72] | 0.66 [0.62; 0.69] | 0.76 |
| smart_strangler@normal | 0.64 [0.62; 0.66] | | |
| smart_reactive@hard | 0.60 [0.57; 0.62] | 0.53 [0.50; 0.57] | 0.57 |
| smart_reactive@normal | 0.53 [0.51; 0.55] | | |
| smart_turtle@normal | 0.31 [0.29; 0.33] | | |
| smart_rusher@easy | 0.29 [0.27; 0.31] | | |
| smart_expander@easy | 0.28 [0.26; 0.31] | | |
| smart_strangler@easy | 0.22 [0.20; 0.24] | | |
| smart_turtle@hard | 0.20 [0.18; 0.22] | 0.15 [0.13; 0.18] | 0.10 |
| smart_reactive@easy | 0.15 [0.14; 0.17] | 0.21 [0.18; 0.23] | 0.45 |
| smart_turtle@easy | 0.11 [0.09; 0.12] | 0.10 [0.08; 0.12] | 0.06 |

The server ladder (`LEVEL_BOTS`, 120 matches each): normal `smart_reactive@easy` beats easy `smart_turtle@easy` 0.78
[0.70; 0.85] (`mvp-2`: 0.97), hard `smart_strangler@hard` beats normal 1.00 [0.97; 1.00] (0.77), expert
`smart_expander@hard` beats hard 0.79 [0.71; 0.85] (0.55). The order holds; the steps are steeper except the first.
The hard bots against the hoarder: expander 0.72, rusher 0.78, strangler 0.58, reactive 0.28.

### The v2 economy in use (mean per player and match, the 16-bot field)

`DrawLine` 64.7, `BuildFactory` 3.2 (a capture ends some builds), `BuildBunker` 1.8 (turtle 3.8-4.0, reactive 3.0-3.8,
expander 2.1-2.5, the others 0), planned orders 3.1, `ReleasePlan` 0.1, warehouse levels 16.9. Charges by sink, share of
start + production (304 produced per match): burned 0.35 (`mvp-2`: 0.57), buildings 0.16, captures 0.14, warehouses lost
0.08, packets lost 0.04, fights 0.04, plans 0.02, left at the end 0.15; ledger residual 0 in every match. CP spent
(orders and recruits at 1 CP over the income of 3 + 1 per 50 ticks): about 0.63. Captures 44 per player and match, 0.63
of them enemy nodes; siege success 0.91; planned siege share 0.355 (`mvp-2`: 0.421).

### Verdict

No crash, decisions within budget (local, the 3 pool maps, all decide calls: p99 0.33-0.89 ms, mean 0.19-0.28 ms;
`test_bench_decide_smart_v2_views` keeps the mean under 1 ms), v1 unchanged. Two gates of #648 are not met and are a
finding for #659, not a rule change here: a bot above 0.80 (the hard expander 0.88, the hard rusher 0.82) and the hoarder
is no longer the strongest bot (0.70). The relay reading of #644 (a full relay skips its incoming line) is noted on #651.

## Midgame and late-game characters of the smart bots (#663)

The owner (2026-10-31): a turtle that sits near its start and loses adds wins to the aggressive bots and paints an
imbalance toward one strategy; the characters should show after the territory is split too. #663 adds the shared
estimation `gow_bots.bots.estimate` (the phase, the enemy force from the symmetric start units, the own recruits and the
visible enemy losses, the strength by node and the front sectors, public data only) and a midgame plan to every
personality (the table of [README.md](README.md), "Bot characters"); the turtle is rewritten: its natural half in the
opening, then it holds while the VP forecast is ahead (garrisons by the threat, bunkers or Defense, the half retaken)
and advances at the weakest sector while it is not. No rule or ruleset number changed (`SIM_VERSION` 29).

### Runs

All on GitHub runners, the 16-bot field (15 smart bots, 5 personalities x 3 levels, and `smart_hoarder`), the 3 pool
maps, seeds 0..19, both sides, 15360 matches each; no crash.

| run | ruleset | code | runner run |
|---|---|---|---|
| before | `mvp-3` (hash `bcea544177702fae1f939a9910c396e0`) | `develop` 8e7a0cd | 41226875725 |
| before | `mvp-2` (hash `9d8cc4dd4b48572ad2be415c2fcc4d4c`) | `develop` 8e7a0cd | 41226900200 |
| after | `mvp-3` | PR of #663 | 41235493261 |
| after | `mvp-2` | PR of #663 | 41235511592 |

Iterations on the branch (8 bots or seeds 0..9): 41227687540, 41228042049 (a counter gate that kept the reactive out
of every attack while ahead: `smart_reactive@hard` 0.50 -> 0.35 on `mvp-3`; softened to open on empty nodes and
weak sectors), 41231137227.

### Win rate against the other 15 [95%]

| bot | `mvp-3` before | `mvp-3` after | `mvp-2` before | `mvp-2` after |
|---|---|---|---|---|
| smart_turtle@hard | 0.17 [0.15; 0.18] | 0.84 [0.82; 0.85] | 0.08 [0.07; 0.10] | 0.29 [0.27; 0.31] |
| smart_expander@hard | 0.88 [0.87; 0.90] | 0.81 [0.79; 0.83] | 0.68 [0.66; 0.70] | 0.62 [0.60; 0.64] |
| smart_expander@normal | 0.82 [0.80; 0.84] | 0.75 [0.73; 0.77] | 0.68 [0.66; 0.70] | 0.64 [0.62; 0.66] |
| smart_turtle@normal | 0.25 [0.23; 0.27] | 0.74 [0.72; 0.76] | 0.08 [0.07; 0.09] | 0.28 [0.26; 0.30] |
| smart_rusher@hard | 0.83 [0.81; 0.85] | 0.71 [0.69; 0.73] | 0.64 [0.61; 0.66] | 0.61 [0.59; 0.63] |
| smart_hoarder | 0.75 [0.73; 0.77] | 0.65 [0.62; 0.67] | 0.73 [0.71; 0.75] | 0.72 [0.70; 0.74] |
| smart_strangler@hard | 0.73 [0.71; 0.75] | 0.60 [0.58; 0.63] | 0.65 [0.62; 0.67] | 0.59 [0.57; 0.61] |
| smart_rusher@normal | 0.71 [0.69; 0.73] | 0.59 [0.56; 0.61] | 0.62 [0.60; 0.64] | 0.61 [0.59; 0.63] |
| smart_reactive@hard | 0.59 [0.57; 0.61] | 0.53 [0.50; 0.55] | 0.52 [0.49; 0.54] | 0.46 [0.44; 0.48] |
| smart_strangler@normal | 0.64 [0.62; 0.66] | 0.50 [0.47; 0.52] | 0.67 [0.65; 0.69] | 0.60 [0.58; 0.63] |
| smart_reactive@normal | 0.49 [0.46; 0.51] | 0.42 [0.39; 0.44] | 0.50 [0.48; 0.53] | 0.45 [0.43; 0.48] |
| smart_turtle@easy | 0.09 [0.08; 0.10] | 0.26 [0.24; 0.28] | 0.06 [0.05; 0.07] | 0.21 [0.19; 0.23] |
| smart_expander@easy | 0.33 [0.30; 0.35] | 0.24 [0.23; 0.27] | 0.57 [0.55; 0.59] | 0.51 [0.49; 0.54] |
| smart_rusher@easy | 0.30 [0.28; 0.32] | 0.19 [0.17; 0.21] | 0.56 [0.54; 0.58] | 0.52 [0.50; 0.54] |
| smart_strangler@easy | 0.23 [0.21; 0.25] | 0.10 [0.09; 0.12] | 0.55 [0.53; 0.57] | 0.50 [0.48; 0.52] |
| smart_reactive@easy | 0.19 [0.18; 0.21] | 0.08 [0.07; 0.09] | 0.42 [0.40; 0.44] | 0.37 [0.35; 0.39] |

Spread of the win rates of the `normal` and `hard` bots and the benchmark (standard deviation): `mvp-3` 0.225 ->
0.129 (range 0.17-0.88 -> 0.42-0.84), `mvp-2` 0.222 -> 0.138 (0.08-0.73 -> 0.28-0.72). The `easy` bots stay weak by
their tempo (no `insight`), on `mvp-3` weaker than before: the field they lose to is stronger.

### The server ladder (`LEVEL_BOTS`, head to head, 120 matches each)

The old ladder breaks on `mvp-3`: `smart_reactive@easy` beats `smart_turtle@easy` only 0.37 [0.29; 0.46] (before:
0.92), on `mvp-2` 0.81 [0.73; 0.87] (before: 0.97). The `normal` level is now `smart_reactive@normal` (the same
personality one tempo level up); the client strings of the levels follow the new characters.

| step | `mvp-3` before (old ladder) | `mvp-3` after | `mvp-2` before (old ladder) | `mvp-2` after |
|---|---|---|---|---|
| normal beats easy `smart_turtle@easy` | 0.92 [0.85; 0.95] | 0.72 [0.64; 0.80] | 0.97 [0.93; 0.99] | 0.74 [0.66; 0.81] |
| hard `smart_strangler@hard` beats normal | 1.00 [0.97; 1.00] | 0.82 [0.75; 0.88] | 0.77 [0.68; 0.83] | 0.62 [0.53; 0.70] |
| expert `smart_expander@hard` beats hard | 0.74 [0.66; 0.81] | 0.75 [0.67; 0.82] | 0.55 [0.46; 0.64] | 0.52 [0.43; 0.60] |

Against the whole field the levels rise on both rulesets (`mvp-3`: 0.26, 0.42, 0.60, 0.81; `mvp-2`: 0.21, 0.45,
0.59, 0.62). The expert-over-hard step on `mvp-2` stays inside the interval of 0.5, as it was before (#624).

### Verdict

- The turtle is a real player now: `mvp-3` 0.17 -> 0.84 (`hard`), 0.25 -> 0.74 (`normal`); `mvp-2` 0.08 -> 0.29
  and 0.28. It wins on VP (1504 of its 1505 wins on `mvp-3`), never by the capital: it holds, it does not conquer.
- Goal "no personality below 0.30 or above 0.80 on `mvp-3`" (not a gate): the hard turtle (0.84) and the hard
  expander (0.81) are just above it, the `easy` bots below it; the field is much less polarized. The turtle is
  strong on `mvp-3` and weak on `mvp-2`: the v2 bunker and the factory economy favour the holder (a finding for #659).
- Decisions within budget (local, the 3 pool maps, hard bots: p99 0.36-0.82 ms, the estimation step 0.03 ms mean).

## 2026-10-31: economy v2 parameter experiments (#659)

Report: [v2-params-2026-10.md](v2-params-2026-10.md); candidates `docs/balance/candidates/mvp-3-balanced.toml` and
`mvp-3-conservative.toml`. `mvp-3` itself is unchanged. Findings on the 16-bot field: CP prices barely change the
share of CP spent (bots are tempo limited), halving the income does (0.61 to 0.81); factory throughput and the
capital warehouse do nothing for the burn, only less production does (0.40 to 0.28 at 70/140); the capture price is
the lever for capital wins (cost 0 doubles them). Recommended `balanced` (CP period 100, factory periods 100/200,
capture cost 0): on the bots of #663, 20 seeds, CP spent 0.78 to 0.90, burned 0.36 to 0.22, capital wins 7.7% to
12.4%, win sd 0.233 to 0.188, no bot above 0.80. Runs: GitHub runner runs of branch `tmp/659-exp` and `tmp/659-exp2`
(deleted after the PR), local runs for group C.

## 2026-11-01: `mvp-3` takes the `balanced` parameters (#659)

Owner decision 2026-11-01: `rulesets/mvp-3.toml` = the candidate `balanced` of
[v2-params-2026-10.md](v2-params-2026-10.md): `cp.period_ticks` 50 -> 100, `factory.capital_period_ticks` 50 ->
100, `factory.built_period_ticks` 100 -> 200, `capture.charge_cost` 1 -> 0 (the rule stays parametric, DEC-38 and
DEC-41 item 11 in mechanics.md). Ruleset hash `f53557cb6a112f7bbf0888d71fb250cd` (archived), `SIM_VERSION` 30
unchanged (a number change only; the golden replays name their ruleset by hash).

Check run: `mise run tournament:gh --ruleset rulesets/mvp-3.toml --seeds 20 --shards 20` with the 16-bot field of the
experiments (5 smart characters x easy, normal, hard + `smart_hoarder`, 4 pool maps, 20480 matches). The default
100 seeds were started first and cancelled after an hour (about 5 hours); 20 seeds is the number of the report.
The columns are computed from `tournament.jsonl` as in the report.

| | report `balanced` | this run |
|---|---|---|
| CP spent | 0.90 | 0.92 |
| burned | 0.22 | 0.21 |
| captures per player | 48.0 | 49.3 |
| capital wins | 12.4% | 12.3% |
| ticks | 8486 | 8474 |
| win sd | 0.188 | 0.178 |
| spread (max - min) | 0.53 | 0.51 |
| top bot | strangler@normal 0.73 | strangler@normal 0.72 |

The run confirms the report (same field, same bots; small differences in CP spent and win sd come from the
rebuilt metric script). For reference the 13-bot default field (`--bots all`, 13520 matches: the old non-smart bots
and the smart ones without levels) gives CP spent 0.77, burned 0.31, capital wins 14.1%.

## 2026-11-01: lines from factories only (DEC-42, #674)

Rule change of `mvp-3` (owner decision 2026-11-01, DEC-42 in mechanics.md): only a factory starts a line, no limit of
lines (`lines.max_out` removed), a factory that is a line target is a hub, the auto-extension copies the nearest own
line. The ruleset numbers are those of #659; the hash changed only by the removed key (`0efed0c36a6800b5812db56ebfa68bf6`,
archived), `SIM_VERSION` 31. The bots draw lines only from their factories (at most 4 lines to wanted nodes per factory,
a bot choice) and feed every built factory from the capital (`gow_bots.bots.economy`).

Smoke run: `mise run tournament:gh --ruleset rulesets/mvp-3.toml --seeds 20 --shards 20` with the 16-bot field of #671
(5 smart characters x easy, normal, hard + `smart_hoarder`, 4 pool maps, 20480 matches), the metrics of
[v2-params-2026-10.md](v2-params-2026-10.md) (win sd: population standard deviation of the 16 win rates, draws 0.5,
mirror matches left out).

| | #671 (`SIM_VERSION` 30, line trees) | this run (DEC-42) |
|---|---|---|
| CP spent | 0.92 | 0.94 |
| burned | 0.21 | 0.17 |
| captures per player | 49.3 | 50.3 |
| capital wins | 12.3% | 13.5% |
| ticks | 8474 | 8429 |
| win sd | 0.178 | 0.140 |
| spread (max - min) | 0.51 | 0.43 |
| top bot | strangler@normal 0.72 | strangler@normal 0.69 (strangler@hard 0.69) |

No crash (20480 rows), no rejected command of the bots, draws 179 (0.9%). Lines drawn per player and match 40.8,
removed 17.9. Less burned (0.21 -> 0.17): with no slot limit a factory serves every wanted node, and the hub feed moves
capital production forward. The field is a little flatter (win sd 0.178 -> 0.140); the level order easy < normal,
hard holds for every character. No gross imbalance: the smoke check passes.

## 2026-11-02: bot audit (the smart bots under v2, the metrics, information grants)

Report: [bot-audit-2026-11.md](bot-audit-2026-11.md); ADR draft `docs/adr/0002-bot-information-grants.md` (proposed,
#692). From the owner's match 6 on `narrows` (`smart_expander@hard` lost by the capital) and a 3-seed smoke run
(`mise run tournament -- --maps maps/narrows.json --bots smart_expander@hard smart_hoarder smart_rusher@hard --seeds 3
--jobs 4 --ruleset rulesets/mvp-3.toml`): every smart bot sinks a third of its charges into buildings (41-50 per match,
`UpgradeWarehouse` 14), the v2 capital defense and evacuation are v1 no-ops (Defense, Transfer), discharged units in a
cut-off pocket idle, cancels waste a quarter of the CP; the field shares the blind spots and the hoarder benchmark is the
weakest bot of the three (2 of 12). Issues: #682 to #691 (bot fixes, the `smart_exploiter` yardstick and gate, v2
metrics, scenario tests), #692 (the grant decision). No code changed.

## 2026-11-03: the supply flow of `mvp-4`, smoke run (DEC-43, #704)

New ruleset `mvp-4` (owner decision 2026-11-03, DEC-43 in mechanics.md): `mvp-3` with the automatic supply flow
towards the front and the leaf shift instead of drawn lines, fixed warehouses (city 3, capital 6, province 1, no
upgrades) and no bunker. Hash `323c452aff9f942bfaeb010644c6cea5` (archived), `SIM_VERSION` 32. The bots draw no lines,
build no bunker, raise no warehouse; the campaign bots set the leaf shift by `gow_bots.bots.economy.leaf_shift_command`
(one road back while an own leaf faces a visibly stronger enemy and the bot attacks from nowhere, else the front).

Smoke run (AGENTS.md, section 8, a rule change): `mise run tournament -- --seeds 3 --ruleset rulesets/mvp-4.toml`, the
default field (13 bots), the 4 pool maps, 2028 matches, locally. The metrics as in
[v2-params-2026-10.md](v2-params-2026-10.md):

| | `mvp-4`, this run |
|---|---|
| CP spent | 0.77 |
| burned (share of start + production) | 0.47 |
| captures per player | 35.2 |
| capital wins | 13.4% |
| ticks | 8426 |
| leaf shifts per player and match | 32.7 |

No crash (2028 rows), charge ledger residual 0 in every match, draws 61 (3%); 282 rejected commands in all (none
`FEATURE_DISABLED` from the campaign bots, `tests/test_supply_flow.py`). Win rates against the others: the smart bots
0.50 (turtle) to 0.79 (strangler), `reactive` 0.73, the plain `turtle` 0.18, `idle` 0.00; side 0 wins 0.48 [0.45; 0.50]
of the decided matches (narrows 0.45 [0.41; 0.49]). No gross imbalance between bots or sides: the smoke check passes.
What stands out is the burned share: about half of the production burns (DEC-42 field on `mvp-3`: 0.17), the capital
is full in 50 to 86% of the ticks: with warehouses of 3 the network fills and a full factory finds no neighbour with
room. A question for the field run (#706) and the owner, not a smoke failure.

## 2026-11-03: road fortifications of `mvp-4`, smoke run (DEC-43 item D, #707)

`mvp-4` with the `[fort]` section (DEC-43 item D: 1.5 CP, 100 ticks, a toll of 1 charge per started 3 units at the
border point of the road). Hash `2ecffe4f3f336217d718a37347b920b7` (archived), `SIM_VERSION` 33. The campaign bots
fortify the road of an own node to an enemy neighbour where an enemy is in sight while their CP are near the cap
(`gow_bots.bots.economy.fort_site`), and an attack whose every own road into the target is fortified asks for the toll
on top of its shots (`Bot.toll_ahead`).

Smoke run (AGENTS.md, section 8): `mise run tournament -- --seeds 3 --ruleset rulesets/mvp-4.toml`, the default field
(13 bots), the 4 pool maps, 2028 matches, locally; the metrics as in the #704 entry above.

| | `mvp-4` #704 | `mvp-4` with `[fort]`, this run |
|---|---|---|
| CP spent | 0.77 | 0.77 (0.74 moves and recruits, 0.03 fortifications) |
| burned (share of start + production) | 0.47 | 0.48 |
| captures per player | 35.2 | 35.0 |
| capital wins | 13.4% | 12.9% |
| ticks | 8426 | 8430 |
| leaf shifts per player and match | 32.7 | 32.3 |

Fortifications: 5893 built in all (2.9 per player and match); the bots that build them are `reactive` (4.9 per match,
in 68% of its matches), `smart_reactive` 4.9, `smart_hoarder` 3.3, `strangler` 2.6, `smart_strangler` 2.2,
`smart_turtle` 0.9; the expander, rusher and turtle personalities (plain and smart) almost never reach the CP
condition. Tolls: 732 paid in all, 772 charges (0.36 tolls and 0.38 charges per player and match); most by
`random_legal` (0.69 per match), `smart_turtle` (0.59) and `smart_expander` (0.48). No crash (2028 rows), charge ledger
residual 0 in every match (`charges_tolls` is a sink of the ledger now), draws 62 (3%). Win rates against the others:
the smart bots 0.50 (turtle) to 0.79 (strangler), `reactive` 0.74, `turtle` 0.18, `idle` 0.00; side 0 wins 0.48
[0.45; 0.50] of the decided matches. No gross imbalance; the smoke check passes. The fortifications are a small CP sink
for these bots (3% of the income): the total CP spent did not rise, the bots that fortify spend a little less on moves
and recruits. The CP burned at the cap is not in the tournament rows (no metric); a question for the field run (#706)
and the bot audit, together with the price.

## 2026-11-03: pockets and starvation of `mvp-4`, smoke run (DEC-43 item H, #719)

`mvp-4` unchanged (hash `2ecffe4f3f336217d718a37347b920b7`), `SIM_VERSION` 34: a pocket is an own component without the
own capital, its factories stop, and a pocket without an own factory starves by DEC-19 on every node, provinces
included. The bots are unchanged.

Smoke run (AGENTS.md, section 8): `mise run tournament:gh --ruleset rulesets/mvp-4.toml --seeds 3`, the default field
(13 bots), the 4 pool maps, 2028 matches on GitHub runners (run 41649182902).

| | `mvp-4` with `[fort]` #707 | `mvp-4` with pockets, this run |
|---|---|---|
| burned (share of start + production) | 0.48 | 0.48 |
| captures per player | 35.0 | 35.6 |
| capital wins | 12.9% | 11.1% |
| ticks | 8430 | 8489 |
| draws | 62 | 63 |
| side 0 wins (decided) | 0.48 [0.45; 0.50] | 0.47 [0.45; 0.49] |

Starvation fires in 1528 of 2028 matches (75%), 4.4 charges per player and match (3.5% of the production; at most 45
in one match, median 11 where it fires); by bot from 2.4 (`random_legal`) to 7.3 (`smart_expander`) and 6.9
(`smart_turtle`). No crash (2028 rows), charge ledger residual 0 in every match. Win rates against the others: the
smart bots 0.49 (turtle) to 0.75 (expander), `smart_strangler` 0.74 (0.79 before), `reactive` 0.73, `turtle` 0.18,
`idle` 0.00. No gross imbalance; the smoke check passes. Mirror matches alone give side 0 0.39 [0.31; 0.49] (n=107),
a small sample; the mirror test of the simulation covers the rule.

## 2026-11-05: the 16-bot field run of `mvp-4` (DEC-43, #706)

The owner declared the `mvp-4` mechanics settled (AGENTS.md, section 8), so this is the field run after the smoke
(entries above) and after the three bot waves #745 (pockets), #746 (capacity-aware moves, a held leaf shift,
`CHURN_TICKS`) and #747 (capital defense, threat fortifications). No code, rule or ruleset number changed.

`mise run tournament:gh --ref develop --ruleset rulesets/mvp-4.toml --seeds 20 --shards 20 --label mvp4-field` with
`--bots` the 16 names `smart_{expander,reactive,rusher,strangler,turtle}@{easy,normal,hard}` and `smart_hoarder`. Code:
`develop` 7505264, ruleset hash `2ecffe4f3f336217d718a37347b920b7`, `SIM_VERSION` 40. The 4 pool maps (`crossroads`,
`highway`, `narrows`, `ridge`), seeds 0..19, both sides, 20480 matches. GitHub run 41946191597 (artifact
`tournament-mvp4-field-1793840781-51874-41946191597`: `tournament.jsonl`, `report.md`, charts).

No crash, 0 `unfinished`, charge ledger residual 0 in every match, 0.10 rejected commands per player and match, one
`double_defeat` (`smart_rusher@hard` mirror on `narrows`, seed 18). Rule numbers are read on the `normal`, `hard` and
`smart_hoarder` rows (the judged set, 11 bots, 9680 matches among themselves); `easy` is shown apart.

### Win rate against the other 15 [95%], and against the other judged bots

| bot | vs all 15 | vs the judged others | vs the 5 `easy` |
|---|---|---|---|
| smart_rusher@normal | 0.71 [0.69; 0.72] | 0.72 [0.70; 0.74] | 0.68 [0.65; 0.71] |
| smart_rusher@hard | 0.68 [0.66; 0.70] | 0.68 [0.65; 0.70] | 0.68 [0.65; 0.71] |
| smart_strangler@normal | 0.60 [0.58; 0.62] | 0.62 [0.59; 0.64] | 0.57 [0.53; 0.60] |
| smart_strangler@hard | 0.59 [0.57; 0.61] | 0.59 [0.57; 0.62] | 0.57 [0.54; 0.61] |
| smart_reactive@normal | 0.49 [0.47; 0.51] | 0.51 [0.48; 0.53] | 0.47 [0.44; 0.50] |
| smart_reactive@hard | 0.48 [0.46; 0.50] | 0.48 [0.46; 0.50] | 0.47 [0.44; 0.51] |
| smart_expander@normal | 0.47 [0.45; 0.49] | 0.47 [0.45; 0.50] | 0.46 [0.43; 0.50] |
| smart_expander@hard | 0.47 [0.45; 0.49] | 0.47 [0.45; 0.50] | 0.46 [0.43; 0.50] |
| smart_hoarder | 0.39 [0.37; 0.41] | 0.39 [0.36; 0.41] | 0.39 [0.36; 0.42] |
| smart_turtle@hard | 0.32 [0.30; 0.34] | 0.29 [0.27; 0.32] | 0.36 [0.33; 0.40] |
| smart_turtle@normal | 0.30 [0.28; 0.32] | 0.27 [0.25; 0.29] | 0.36 [0.33; 0.40] |
| smart_rusher@easy | 0.61 [0.59; 0.63] | 0.59 [0.57; 0.61] | 0.66 [0.62; 0.70] |
| smart_strangler@easy | 0.60 [0.58; 0.62] | 0.62 [0.60; 0.64] | 0.55 [0.52; 0.59] |
| smart_expander@easy | 0.49 [0.47; 0.51] | 0.48 [0.46; 0.50] | 0.50 [0.47; 0.54] |
| smart_reactive@easy | 0.48 [0.46; 0.50] | 0.49 [0.47; 0.52] | 0.46 [0.43; 0.50] |
| smart_turtle@easy | 0.31 [0.30; 0.33] | 0.32 [0.30; 0.34] | 0.30 [0.26; 0.34] |

Standard deviation of the win rates (against all 15) of the 11 judged bots 0.128, range 0.30 to 0.71 (`mvp-3` after
#663: 0.129, range 0.42 to 0.84). No gross imbalance: nobody is above 0.72 or below 0.27 against any slice, and the field
is not polarised toward the holder any more (`mvp-3` after #663: `smart_turtle@hard` 0.84, here 0.32: the v2 bunker is
gone and the fortifications are a toll). The rusher is the one personality above 0.65 (the #40 gate "no strategic bot
beats the others more than 65%"): 0.68 to 0.72, mostly against the expander (`smart_expander@hard` wins 0.26 against
`smart_rusher@hard`).

**The tempo levels no longer separate.** Within a personality `easy`, `normal` and `hard` are within a few points
(`smart_expander` 0.49, 0.47, 0.47) and play the same number of accepted commands per match (`smart_expander` 136.2,
135.6, 136.1; `smart_turtle` 127.8, 127.7, 128.7). Head to head `smart_expander@hard` beats `@easy` 0.53 [0.45; 0.61],
`smart_strangler@hard` loses to `@easy` 0.45 [0.37; 0.53]. On `mvp-3` after #663 the levels were 0.26, 0.42, 0.60, 0.81
over the field. The server ladder (`LEVEL_BOTS`) is only partly kept: `smart_reactive@normal` beats `smart_turtle@easy`
0.68 [0.60; 0.74], `smart_strangler@hard` beats `smart_reactive@normal` 0.71 [0.63; 0.77], but the expert
`smart_expander@hard` loses to the hard `smart_strangler@hard` 0.36 [0.29; 0.44]. The CP are spent at 98% of the income
at every level (see below); that the CP, not the tempo limit, is what binds is a hypothesis, not checked here.

### Sides

Side 0 wins 0.53 [0.52; 0.53] of the decided matches (n=20347), mirror matches 0.55 [0.52; 0.57] (n=1184); judged bots
among themselves 0.52 [0.51; 0.53].

| map | all matches | mirror matches | judged vs judged |
|---|---|---|---|
| crossroads | 0.52 [0.51; 0.54] | 0.52 [0.47; 0.58] | 0.52 [0.50; 0.54] |
| highway | 0.53 [0.52; 0.55] | 0.55 [0.49; 0.60] | 0.53 [0.51; 0.55] |
| narrows | 0.52 [0.50; 0.53] | 0.57 [0.52; 0.63] | 0.52 [0.50; 0.54] |
| ridge | 0.53 [0.51; 0.54] | 0.55 [0.49; 0.60] | 0.51 [0.49; 0.53] |

A mild skew toward side 0 on every map, below the 55% line of #40 for all matches; the mirror interval of `narrows`
(and of all maps together) excludes 0.5. The smoke runs showed the opposite sign (0.47 to 0.48 for the same bots, 3
seeds): the per-seed share of side 0 swings from 0.35 (seed 1) to 0.64 (seed 7), and the first three seeds alone give
0.47 [0.42; 0.51] for the six `hard` bots and the hoarder, seeds 3 to 19 give 0.53 [0.51; 0.55]. The skew `highway` showed
in the first smoke (mirror 0.29, n=21) is not there (mirror 0.55, n=266).

### Match end

| | matches | capital | vp | cities | draw | other | mean ticks |
|---|---|---|---|---|---|---|---|
| all | 20480 | 1885 (9.2%) | 18398 | 64 | 132 | 1 | 8646 |
| judged vs judged | 9680 | 820 (8.5%) | 8763 | 33 | 63 | 1 | 8707 |

Capital wins by map: `narrows` 13.5%, `highway` 8.5%, `crossroads` 8.2%, `ridge` 6.7%. By winner the strangler and the
reactive take the capital most (`smart_strangler@hard` 206, `smart_strangler@normal` 195, `smart_reactive@normal` 181),
the turtle almost never (8 in all). Draws 0.6% (`highway` 84 of 132).

### Charges (mean per player and match)

| group | produced | burned share | warehouses lost | starved | attrition | fights | built | left at the end |
|---|---|---|---|---|---|---|---|---|
| judged (normal, hard, hoarder) | 152.8 | 27.0% | 33.5 (21.9%) | 13.7 (8.9%) | 0.15 | 11.4 | 17.5 | 43.8 |
| `easy` | 149.9 | 22.5% | 30.4 (20.3%) | 11.7 (7.8%) | 0.17 | 12.2 | 26.6 | 44.8 |

Of the production about 58% goes to burning, lost warehouses and starvation, 7.5% to fights. Idle discharged unit-ticks
per player and match: 3207 in the capital's component, 8924 in pockets (judged); 4510 and 9059 for `easy`. By bot the
burned share runs from 16.6% (`smart_rusher@easy`) and 20.3% (`smart_hoarder`) to 35.2% (`smart_turtle@hard`); the
turtle loses the fewest warehouse charges (17.2) and keeps the most at the end (60.7), so it burns what it does not spend.
The capital is full in 40% of the ticks (judged). Per bot tables are in the artifact `report.md`.

### CP (DEC-43 item F)

| group | CP income | CP spent | burned | ticks at the cap | matches that reach the cap | moves | recruits | fortifications |
|---|---|---|---|---|---|---|---|---|
| judged | 89 | 87.6 (98%) | 0.4 CP (0.4%) | 0.4% | 3% | 86.8% | 8.3% | 4.9% |
| `easy` | 88 | 86.7 (98%) | 0.2 CP (0.2%) | 0.2% | 2% | 87.2% | 9.8% | 3.0% |

Spending is counted from the accepted commands and the prices of `orders.cost` (a move and a scheduled move 1 CP, a
recruit 1 CP less the refunds, a fortification 1.5 CP); the buildings of `mvp-4` cost charges, not CP (`built` above).
The income is `cp.start` plus 1 CP per 100 ticks of the match. The smart bots at human tempo have no CP surplus: they
spend 98% of the income, reach the cap in 3% of the matches and burn 0.4 CP. Only `smart_hoarder` (2.4 CP burned, 10% of
the matches at the cap) and `smart_turtle` (0.7 to 0.8 CP, 7 to 8%) get there. In the smoke (13 bots) the plain
`expander` and `turtle` burned 47 and 60 CP per match, the `idle` bot 86: a slow player does sit on the cap, a bot that
moves about 80 times a match does not. The bots therefore cannot tell whether C1 to C4 are needed for people: they say
that a CP sink matters only for a slow player and that the bots spend everything on moves (a cut of the income, C4,
would take moves from them).

### Fortifications and tolls (mean per player and match)

| bot | fortify commands | working | tolls paid (n / charges) | tolls collected (n / charges) |
|---|---|---|---|---|
| smart_turtle@normal | 8.77 | 8.39 | 0.67 / 0.72 | 1.87 / 2.34 |
| smart_turtle@hard | 8.59 | 8.23 | 0.66 / 0.71 | 1.79 / 2.20 |
| smart_turtle@easy | 4.17 | 3.95 | 0.54 / 0.58 | 0.90 / 1.11 |
| smart_reactive@hard | 3.19 | 3.01 | 0.25 / 0.33 | 0.59 / 0.61 |
| smart_hoarder | 2.72 | 2.56 | 0.39 / 0.46 | 0.41 / 0.43 |
| smart_expander@hard | 1.57 | 1.51 | 0.55 / 0.65 | 0.34 / 0.43 |
| smart_strangler@hard | 1.02 | 0.96 | 0.46 / 0.56 | 0.23 / 0.26 |
| smart_rusher@hard | 0.01 | 0.01 | 0.67 / 0.84 | 0.00 / 0.00 |

The turtle leans on them most (8.6 per match, 12.9 CP, 14% of its CP), the rusher never builds one and pays the most
tolls (0.67 to 0.75 per match, 0.84 to 0.93 charges). Over the judged set 2.7 fortifications work per player and match,
0.51 tolls and 0.60 charges paid: the tax is small next to the 33 charges of lost warehouses.

### Against the smoke runs (like for like)

The smoke runs play the 13-bot field with the smart bots at `hard`. The common slice is the six bots `smart_*` (hard) and
`smart_hoarder` against each other (432 matches in a smoke, 2880 here; seeds 0..2 of this run give the number of the
#747 smoke exactly, as the run is deterministic).

| run | `smart_expander` | `smart_hoarder` | `smart_reactive` | `smart_rusher` | `smart_strangler` | `smart_turtle` |
|---|---|---|---|---|---|---|
| smoke #706, f883f19 (before the waves) | 0.54 [0.45; 0.63] | 0.38 [0.29; 0.46] | 0.51 [0.42; 0.60] | 0.63 [0.54; 0.71] | 0.70 [0.61; 0.77] | 0.23 [0.16; 0.31] |
| smoke #745 branch, c8afdc4 | 0.52 [0.43; 0.60] | 0.38 [0.29; 0.46] | 0.48 [0.40; 0.57] | 0.71 [0.62; 0.78] | 0.67 [0.58; 0.74] | 0.23 [0.17; 0.32] |
| smoke #746 branch, cf0813e | 0.53 [0.44; 0.62] | 0.33 [0.25; 0.41] | 0.46 [0.37; 0.55] | 0.72 [0.63; 0.79] | 0.63 [0.54; 0.71] | 0.32 [0.24; 0.40] |
| smoke #747 branch, 67c4d44 | 0.50 [0.41; 0.59] | 0.35 [0.27; 0.44] | 0.47 [0.38; 0.56] | 0.74 [0.66; 0.81] | 0.67 [0.58; 0.74] | 0.26 [0.19; 0.34] |
| this run, 7505264 | 0.47 [0.44; 0.50] | 0.40 [0.36; 0.43] | 0.49 [0.45; 0.52] | 0.71 [0.68; 0.74] | 0.63 [0.60; 0.66] | 0.29 [0.26; 0.33] |

| run | burned share | capital wins | draws | mean ticks | side 0 (decided) | warehouses lost | starved | CP burned |
|---|---|---|---|---|---|---|---|---|
| smoke #706, f883f19 | 19.2% | 13.4% | 4 of 432 | 8449 | 0.48 | 36.1 | 14.6 | n/a |
| smoke #745 branch | 17.1% | 12.3% | 4 | 8576 | 0.44 | 37.2 | 15.2 | n/a |
| smoke #746 branch | 24.5% | 9.7% | 4 | 8742 | 0.48 | 34.8 | 14.5 | 0.49 |
| smoke #747 branch | 25.3% | 9.0% | 4 | 8752 | 0.47 | 34.6 | 14.0 | 0.48 |
| this run | 25.7% | 8.6% | 32 of 2880 | 8740 | 0.52 | 34.5 | 14.1 | 0.48 |

**`smart_expander`.** In the smoke (13 bots, against all) it went 0.712 to 0.670 after #747; in this slice it goes 0.54
(before the waves) to 0.47 [0.44; 0.50] now. The 20 seeds settle the level: the later seeds alone (3 to 19) give 0.46
[0.43; 0.50], so the first three seeds were not a lucky draw. The step from the smoke before the waves (n=120, interval
[0.45; 0.63]) is within that sample's noise, so the decline is a few points spread over #745 to #747, not one wave. It comes
from the matches against the hoarder (0.71 to 0.58) and the reactive (0.62 to 0.47); against the strangler (0.38 to 0.36)
and the rusher (0.29 to 0.26) it was already weak. Maps: `narrows` 0.39, `highway` 0.47, `crossroads` 0.49, `ridge`
0.54. In the 16-bot field it is in the middle (0.47, below the rusher and the strangler, above the hoarder and the
turtle), not a collapsed personality.

**`CHURN_TICKS`.** The burned share of the common slice rose from 17.1% (#745) to 24.5% (#746) and stayed there; the
warehouse charges lost fell only from 37.2 to 34.8 per player and match. Production is about 150 per player and match, so
the 7 points of burn are about 10 charges against about 2 charges saved from captured warehouses; the capital wins fell
12.3% to 9.7% in the same step. #746 changed three things together (capacity-aware moves, the held shift of
`SHIFT_HOLD_TICKS`, `CHURN_TICKS` = 300), so the numbers do not isolate `CHURN_TICKS`. In the field run the burned share
falls with the number of own nodes lost (57% with none lost, 18% with 31 to 60) and does not rise with the leaf shifts
per match beyond 7 (25% with up to 6, 29% with 7 to 14), so the burn is largest where the bot lost no node at all, which
a longer shift after a loss does not explain. A single-constant experiment `CHURN_TICKS = 0` is cheap and the numbers do
not argue against it: its cost is the charges kept back from captured warehouses (33.5 per player and match are lost now,
22% of the production), what it can gain is part of the 10 charges burned; the verdict needs a run (3 seeds smoke on the
six bots above, then the field).

### Candidates (proposed, not applied; the owner decides)

- The charge economy has a large surplus: the judged bots burn 27% of the production and lose another 22% in captured
  warehouses and 9% to starvation. If the owner wants less waste, the numbers to look at are `factory.built_period_ticks`
  (200), `capital_period_ticks` (100) and the warehouses (3, 6, 1); the bots show no shortage of charges (43.8 left at
  the end).
- CP surplus (C1 to C4 of item F): none to cure for the bots, they spend 98% of the income. Whether people sit on the cap
  needs a human playtest or `gow-bots analyze` of real replays (`cp_burned` is in the rows now); C4 (lower income) would
  tighten the bots, which already spend everything on moves.
- The tempo levels (`easy`, `normal`, `hard`) play alike under `mvp-4`; the bot screen and `LEVEL_BOTS` promise a ladder.
  This is a bot question, not a ruleset number.
- A mild side 0 skew (0.52 to 0.53) on every map with a large seed noise (0.35 to 0.64 per seed): watch it in the next
  run; the mirror test of the simulation is in CI, so the bots' side-dependent parameters (AGENTS.md, section 8: chosen from
  `(name, seed, side)`) are the first place to look.

## #749: a difficulty ladder by the APM bucket, no churn hold of the leaf shift (2026-11-05)

GitHub run 41992026732 (`mise run tournament:gh --seeds 3`, the 16-bot field of #706, `mvp-4`, 4 maps, 3072 matches)
against run 41946191597 of #706 restricted to the same seeds 0..2.

**Diagnosis.** The CP income (about 93 CP a match) binds every level: 98% of it is spent and every level sent 126 to 129
commands a match on these seeds (the expander 138 / 138 / 140, easy / normal / hard). The tempo knobs of #573 never
bound: 12 APM is 180 commands a match. `insight`, the only other difference of `easy`, is no strength: without it a bot
at the `hard` tempo plays even with `hard` (0.53 for the strangler and the reactive, 32 local matches each), and with a
late view (40-tick decisions, 100-tick reaction) the bot with `insight` loses to `hard` (0.25) while the one without
does not (0.53): it reads no arrival, pin or plan, so it does not care how late it sees. Hence `easy` over `normal` for
the reactive and the strangler (0.61 in the 20-seed field). The lever that binds is the APM bucket below the demand:
local runs against `hard` gave 0.53 at 8 a minute, 0.38 at 7, 0.00 and 0.04 at 6.

**Levels.** `easy` 6 APM (burst 3), `normal` 7 (burst 4), `hard` 40 (burst 8), `insight` on every level; think and
reaction delays unchanged.

| Personality (24 matches a pair) | normal vs easy | hard vs normal | hard vs easy |
|---|---|---|---|
| expander | 0.71 [0.51; 0.85] | 0.67 [0.47; 0.82] | 0.92 [0.74; 0.98] |
| reactive | 0.83 [0.64; 0.93] | 0.67 [0.47; 0.82] | 0.92 [0.74; 0.98] |
| rusher | 0.83 [0.64; 0.93] | 0.75 [0.55; 0.88] | 0.79 [0.60; 0.91] |
| strangler | 0.92 [0.74; 0.98] | 1.00 [0.86; 1.00] | 1.00 [0.86; 1.00] |
| turtle | 0.54 [0.35; 0.72] | 0.75 [0.55; 0.88] | 0.83 [0.64; 0.93] |
| pooled (120) | 0.77 [0.68; 0.83] | 0.77 [0.68; 0.83] | 0.89 [0.82; 0.94] |

Before (the same seeds): pooled 0.47 [0.39; 0.56], 0.45 [0.36; 0.54], 0.52 [0.43; 0.60]. Against the field: `easy` 0.26,
`normal` 0.52, `hard` 0.72 (before 0.51, 0.52, 0.51); commands a match 90 / 102 / 134. The weak pair is the turtle's
`normal` over `easy`. `easy` burns 35% of its production (it cannot send what it would spend them on).

**`CHURN_TICKS`** (#746) removed. The `hard` bots and the benchmark play the same code in both runs except for it, so
their matches among themselves (432) isolate it: burned 38.9 to 30.8 charges per player and match (share 25.3% to
20.2%), warehouses lost 34.6 to 37.0, the two together 73.4 to 67.8. Head to head (local, three `hard` personalities, 72
matches) the bot without it won 0.60.

## #754: no split/merge churn of the hoarder, pocket exits within the room of the way out (2026-11-05)

GitHub run 42008336134 (`mise run tournament:gh --seeds 3`, the 16-bot field of #706, `mvp-4`, 4 maps, 3072 matches)
against run 41992026732 (#749, the same seeds and field; the `hard` bots are named without `@hard` here, which seeds
their parameters the same way: `choose_params` takes the class name).

**Causes.** (1) The hoarder's splits are free (`orders.cost.split = 0`) and prepare a walk in the next decision, but its
CP are kept for the barracks and the banked strike, or spent on another order after the split; the unmoved part was merged
back by `_gather` (free too) and split again. (2) While advancing, `spearhead` merged the capital's spare units back
into the guard that `_guard_split` had just split them off. (3) `leave_pockets` did not count the own units already on
the way into the foreign node of the way out (`Ctx.incoming` counts own nodes only), so a big pocket overfilled it.
Fixes: a hoarder split keeps the CP of its part's move; no merge in the capital in `spearhead`; `pockets.heading`.

| Bot (384 matches) | Split | Merge | attrition | idle discharged in pockets | starved | score |
|---|---|---|---|---|---|---|
| smart_hoarder | 113.1 > 23.9 | 93.2 > 10.7 | 0.41 > 0.36 | 11005 > 12166 | 15.9 > 16.7 | 0.54 [0.49; 0.59] > 0.70 [0.65; 0.74] |

The other 15 bots are unchanged within the noise (score moves of at most 0.03, attrition at most 0.02 a match). No
crash. The benchmark is stronger beyond its interval: its spare units now march and its commands are not spent on the
loop; against the five `hard` personalities 0.34 > 0.47 (120 matches).

## #687: cancel discipline and CP banking of the smart bots (2026-11-05)

GitHub run 42011930257 (`mise run tournament:gh --seeds 3`, the 16-bot field of #706, `mvp-4`, 4 maps, 3072 matches)
against run 41992026732 (the bot code of develop a37d5fa; the same seeds). `cp_cancelled` is not in the baseline file
(written before #752); 8 local develop matches of the `hard` bots gave 3.0 to 10.8 CP a match, about 1 CP per cancel.

| bot | `CancelOrder` a match | of the moves | `cp_cancelled` a match (of the income) | ticks at the cap | `FortifyRoad` a match | win rate against the field |
|---|---|---|---|---|---|---|
| smart_expander@hard | 9.2 -> 4.1 | 12.2% -> 5.6% | 3.46 CP (3.8%) | 0.1% -> 0.0% | 0.9 -> 3.7 | 0.72 -> 0.69 |
| smart_reactive@hard | 6.4 -> 3.0 | 8.0% -> 4.1% | 2.53 CP (2.8%) | 0.0% -> 0.0% | 4.3 -> 8.0 | 0.72 -> 0.72 |
| smart_rusher@hard | 8.5 -> 5.0 | 10.2% -> 6.2% | 2.68 CP (3.2%) | 0.0% -> 0.0% | 0.0 -> 1.1 | 0.82 -> 0.88 |
| smart_strangler@hard | 9.5 -> 3.8 | 11.4% -> 4.9% | 2.96 CP (3.3%) | 0.0% -> 0.0% | 1.8 -> 5.9 | 0.87 -> 0.79 |
| smart_turtle@hard | 3.4 -> 1.3 | 5.7% -> 2.3% | 1.15 CP (1.2%) | 0.7% -> 0.8% | 6.4 -> 7.0 | 0.45 -> 0.45 |
| smart_hoarder (unchanged) | 6.2 -> 6.5 | 9.4% -> 9.7% | 5.75 CP (6.5%) | 2.5% -> 2.5% | 5.9 -> 5.7 | 0.54 -> 0.54 |

The `normal` and `easy` bots cancel 30 to 45% less as well. `cp_burned` of every `hard` bot stays 0.00 to 0.73 CP a match.
No crash; the data validity summary is the same as the baseline's (PASS 6, FAIL 4: V4b, V4c, V5a, V5b); the level ladder
passes V2 for every personality, 14 of 18 pairs separated (13 before), the inversion `expert` below `smart_strangler@hard`
is gone (0.25 to 0.42, not separated).

**The strangler.** Its 0.87 to 0.79 came from the saving: against the benchmark it won 18 of 24 before and 10 after.
Played locally on 16 of those matches (seeds 0 and 1, both sides) without its saving and with the discipline it won 14
(13 before, 5 with the saving): the siege lives on steady pressure. So the strangler keeps `BANK` 0; the merged code is
the run's code with that one number changed, the field was not run again (one smoke per PR).

**The rusher** halves its recalls but not its cancels (8.5 to 5.0): what is left are fight withdrawals and recalls on a
`RANGE` sighting (the top of the range is counted, DEC-21), both cancels that save units.

## #688: the benchmark `smart_exploiter` and the V6 gate of every server level (2026-11-05)

GitHub run 42035791469 (`mise run tournament:gh --seeds 3`, the 16-bot field of #706 plus `smart_exploiter`, 17 bots,
`mvp-4`, 4 maps, seeds 0..2, both sides, 3468 matches; code: branch `feature/688-smart-exploiter` on develop 0fe99e0).
No crash, no unfinished match, 11 draws. Local runs: 60 `run_headless` matches against `smart_rusher@hard`, one process
at a time (seeds 0, 3, 4; the GitHub seeds are 0..2, so the local seeds 3 and 4 are an independent sample).

**The bot** (`gow_bots.bots.exploiter`): the rusher's CP economy under `mvp-4` (about 93 CP a match bind every smart bot,
a move captures at most one node, a capture is free) with a capital drive of the groups of 4 charged units or more, the
converging strike whenever it is ready (one group alone too, 2 shots of margin, scheduled orders), raids on enemy
pockets (public ownership; the garrison estimate loses the starvation of DEC-43 item H since the cut) and on full leaf
warehouses, the cut of the enemy network, the leaf shift at the front while a strike is under way, and the
fortifications of item 22. A first version on the hoarder (the build-up at the centre) lost 2 of 8 to
`smart_rusher@hard` locally: its marches and recruits cost the CP the captures needed (the rusher recruited 0 units and
held 35 nodes with 8). Decision time 0.41 to 0.53 ms against 0.38 to 0.46 ms of the rusher (`test_benchmarks`).

### The exploiter against the field [95%]

| opponent | won / lost / drawn | exploiter's share | capital taken | capital lost |
|---|---|---|---|---|
| `smart_expander@easy` | 24 / 0 / 0 | 1.00 [0.86; 1.00] | 5 | 0 |
| `smart_expander@normal` | 20 / 4 / 0 | 0.83 [0.64; 0.93] | 2 | 1 |
| `smart_expander@hard` | 19 / 5 / 0 | 0.79 [0.60; 0.91] | 5 | 2 |
| `smart_hoarder` | 22 / 2 / 0 | 0.92 [0.74; 0.98] | 0 | 1 |
| `smart_reactive@easy` | 23 / 1 / 0 | 0.96 [0.80; 0.99] | 1 | 1 |
| `smart_reactive@normal` | 17 / 7 / 0 | 0.71 [0.51; 0.85] | 0 | 7 |
| `smart_reactive@hard` | 19 / 5 / 0 | 0.79 [0.60; 0.91] | 1 | 4 |
| `smart_rusher@easy` | 21 / 3 / 0 | 0.88 [0.69; 0.96] | 2 | 3 |
| `smart_rusher@normal` | 20 / 4 / 0 | 0.83 [0.64; 0.93] | 12 | 3 |
| `smart_rusher@hard` | 14 / 10 / 0 | 0.58 [0.39; 0.76] | 4 | 2 |
| `smart_strangler@easy` | 24 / 0 / 0 | 1.00 [0.86; 1.00] | 3 | 0 |
| `smart_strangler@normal` | 20 / 4 / 0 | 0.83 [0.64; 0.93] | 1 | 3 |
| `smart_strangler@hard` | 15 / 9 / 0 | 0.62 [0.43; 0.79] | 1 | 5 |
| `smart_turtle@easy` | 23 / 1 / 0 | 0.96 [0.80; 0.99] | 5 | 0 |
| `smart_turtle@normal` | 24 / 0 / 0 | 1.00 [0.86; 1.00] | 1 | 0 |
| `smart_turtle@hard` | 22 / 2 / 0 | 0.92 [0.74; 0.98] | 2 | 0 |
| all 16 | 327 / 57 / 0 | 0.85 [0.81; 0.88] | 45 | 32 |

Against the field: `smart_strangler@hard` 0.88, `smart_exploiter` 0.85, `smart_rusher@hard` 0.84, the rest 0.67 or less.
Bradley-Terry: strangler +2.48 [+2.32; +2.79], exploiter +2.20 [+2.14; +2.38], rusher +2.09 [+1.15; +2.86]. The Nash mix
of the style matrix is the exploiter 0.98, the rusher and the strangler 0.01 each (gap 0.004); intransitive share 0.13.
On `narrows` against `smart_expander@hard` (the owner's match 6 shape): 4 wins of 6, 3 of them by the capital.

### V6 (the thresholds are proposals)

| level | bot | share against the exploiter [95%] | at least | capital lost | capital taken |
|---|---|---|---|---|---|
| easy | `smart_turtle@easy` | 0.04 [0.01; 0.20] | 0.05 | 0.21 | 0.00 |
| normal | `smart_reactive@normal` | 0.29 [0.15; 0.49] | 0.20 | 0.00 | 0.29 |
| hard | `smart_strangler@hard` | 0.38 [0.21; 0.57] | 0.35 | 0.04 | 0.21 |
| expert | `smart_expander@hard` | 0.21 [0.09; 0.40] | 0.50 | 0.21 | 0.08 |

V6 FAILS on `expert` (0.21, the interval below 0.50) and narrowly on `easy` (1 win of 24). The expert level loses to the
human-style benchmark worse than the hard level does (the server ladder is inverted at the top in this run too:
`smart_expander@hard` over `smart_strangler@hard` 0.12 [0.04; 0.31]). 24 matches a pair are a smoke: the gate wants
about 400 (50 seeds on the 4 maps).

### Can anything counter `smart_rusher@hard`?

| exploiter variant against `smart_rusher@hard` | matches | exploiter's share [95%] | capital taken | capital lost |
|---|---|---|---|---|
| default, GitHub seeds 0..2 | 24 | 0.58 [0.39; 0.76] | 4 | 2 |
| default, local seeds 0, 3, 4 | 24 | 0.54 [0.35; 0.72] | 3 | 6 |
| default, pooled | 48 | 0.56 [0.42; 0.69] | 7 | 8 |
| `anti_rush` 1 (capital roads fortified early, 3 units held at home, front cities fortified at once), local seeds 0, 3, 4 | 24 | 0.50 [0.31; 0.69] | 3 | 0 |

Neither beats the rush significantly; the exploiter plays it even and beats the rest of the field more, so the rusher is
no longer alone in the Nash mix (V5a still fails: the exploiter, the rusher and the strangler have no significant
counter). The anti-rush opening removes the capital losses (8 in 48 for the default, 0 in 24) and wins no more: the rush
wins on VP, not at the capital. Reading (a hypothesis, not checked by a rules run): under `mvp-4` the binding resource is
the CP, a move captures at most one node and a capture is free (`capture.charge_cost = 0`), so the strongest play is
"every CP a capture"; a garrison, a fortification or a guard does not stop a free capture of an empty node (a toll takes
charges, an empty node needs none), so a defensive answer cannot beat it, only the same economy can match it. The rush
dominance of #706 was a bot problem (the other personalities spend CP on recruits, rallies and marches that capture
nothing), and the even match between two CP-efficient bots is a property of the rules. A rules experiment that would
test it: `capture.charge_cost = 1` against 0 with the same field (not run: #688 changes no rule).

### Data validity

PASS 6 (V2, V3, V4a, V9, D1, D2), FAIL 5 (V4b: 24 matches a pair; V4c: side 0 of the mirror matches 0.36 to 0.53;
V5a: no counter for the exploiter, `smart_rusher@hard`, `smart_strangler@hard`; V5b: `smart_strangler@hard` 0.88; V6),
NO DATA 1 (V1: no floor bots), NOT COMPUTABLE 2 (V7, V8).

## #763: less supply generation under `mvp-4` (experiment, 2026-11-06)

The owner's playtest of 2026-11-05: supply feels too plentiful (the factories barely felt, a bigger
territory stores the surplus, the leaf shift pointless). The question: does a slower capital factory
(DEC-41 item 2) make the factories and the leaf shift matter and a big army costly to feed?

Branch [`exp/763-supply-cut-mvp4`](https://github.com/DastinovDS/Skill-Based-Front/tree/exp/763-supply-cut-mvp4) (develop 05b1872 plus three rulesets, each a copy of `mvp-4` that differs only in the keys named), not merged:

| ruleset | `capital_period_ticks` | `built_period_ticks` | a built factory against the capital |
|---|---|---|---|
| `mvp-4` | 100 (1 charge / 10 s) | 200 | 0.5 |
| `mvp-4-sup150` | 150 | 200 | 0.75 |
| `mvp-4-sup200` | 200 | 200 | 1.0 |
| `mvp-4-sup200f` | 200 | 150 | 1.33 |

The three variants as proposed: they span a total cut of about 20 to 30% and a factory share from 0.75 to 1.33 times the capital, which is the spread the question needs; no other key (`factory.cost`, `max`, the warehouses) was touched. All load with `load_ruleset` and pass `gow-maps validate --ruleset` on the pool, the fixtures and the menu map.

GitHub runs, all from the same ref, the 16-bot field of #706 plus `smart_exploiter` (17 bots), 4 pool maps, seeds 0..4, both sides, 5780 matches each, no crash (`mise run tournament:gh --ref exp/763-supply-cut-mvp4 --bots "<the 17>" --seeds 5 --shards 5`):

- `mvp-4`: https://github.com/DastinovDS/Skill-Based-Front/actions/runs/42122837548 (byte for byte the same `state_hash` in every row as the #759 round 2 cost-0 run 42082265867: the same code, deterministic)
- `mvp-4-sup150`: https://github.com/DastinovDS/Skill-Based-Front/actions/runs/42122847800
- `mvp-4-sup200`: https://github.com/DastinovDS/Skill-Based-Front/actions/runs/42122858679
- `mvp-4-sup200f`: https://github.com/DastinovDS/Skill-Based-Front/actions/runs/42122868728

Rows marked *probe* come from 24 local headless matches per ruleset (seed 1, the 4 maps, `smart_rusher@hard`/`smart_turtle@hard`, `smart_expander@hard`/`smart_reactive@hard`, `smart_exploiter`/`smart_strangler@hard`, both sides; 97 local matches in all, one process): the tournament row has no factory ticks, no shift value and no node count by minute. All other rows are per player and match over the 5780 matches.

| | `mvp-4` | `sup150` | `sup200` | `sup200f` |
|---|---|---|---|---|
| charges produced | 152.0 | 122.5 (-19%) | 107.5 (-29%) | 128.4 (-16%) |
| charges burned, burned share | 36.9, 0.243 | 19.5, 0.159 | 12.8, 0.119 | 23.7, 0.185 |
| stock: mean, at the end | 39.7, 46.7 | 35.0, 42.1 | 32.0, 38.9 | 36.0, 43.1 |
| charges spent in fights / builds / plans / tolls | 14.1 / 15.7 / 4.5 / 3.3 | 13.5 / 15.4 / 4.0 / 3.3 | 13.0 / 15.2 / 3.7 / 3.2 | 13.3 / 15.4 / 4.0 / 3.3 |
| charges lost with captured warehouses | 33.8 | 28.7 | 25.5 | 29.6 |
| `BuildFactory` accepted | 3.75 | 3.73 | 3.74 | 3.73 |
| *probe*: factories built, first / second factory (median tick) | 4.10, 184 / 469 | 3.96, 184 / 469 | 3.96, 184 / 509 | 3.77, 184 / 522 |
| `SetLeafShift` accepted | 9.28 | 9.26 | 9.33 | 9.31 |
| *probe*: mean leaf shift (share of ticks with a shift > 0), the exploiter | 0.29, 0.19 | 0.27, 0.19 | 0.29, 0.16 | 0.26, 0.18 |
| charges starved | 12.3 | 11.9 | 11.4 | 11.8 |
| idle discharged unit-seconds: connected / pocket | 248 / 748 | 294 / 783 | 354 / 814 | 320 / 780 |
| captures: all / neutral / enemy | 43.1 / 14.4 / 28.7 | 43.2 / 14.4 / 28.7 | 43.6 / 14.5 / 29.2 | 43.3 / 14.4 / 28.8 |
| walk-ins / contested sieges (won) | 24.5 / 4.44 (2.93) | 24.7 / 4.20 (2.75) | 25.1 / 4.05 (2.66) | 24.7 / 4.16 (2.74) |
| end reasons: vp / capital / cities / draw | 5222 / 533 / 8 / 17 | 5211 / 549 / 10 / 10 | 5233 / 529 / 11 / 6 (+1 double defeat) | 5198 / 565 / 9 / 8 |
| mean ticks; median first contact crossroads / highway / narrows / ridge | 8687; 933 / 1166 / 528 / 1043 | 8672; 1003 / 1166 / 528 / 1082 | 8704; 932 / 1166 / 548 / 1064 | 8676; 1003 / 1166 / 628 / 1043 |
| more nodes at the end wins (non-mirror) | 0.83 [0.82; 0.84] | 0.84 [0.83; 0.85] | 0.83 [0.82; 0.84] | 0.84 [0.83; 0.85] |
| more captures in minutes 0..4 wins (non-mirror) | 0.81 [0.80; 0.82] | 0.81 [0.80; 0.82] | 0.82 [0.81; 0.83] | 0.81 [0.80; 0.82] |
| *probe*: more own nodes at minute 5 / minute 10 wins | 15 of 23 / 17 of 21 | 18 of 24 / 20 of 22 | 17 of 24 / 21 of 22 | 18 of 22 / 18 of 21 |
| exploiter against the field | 0.86 [0.83; 0.88] | 0.88 [0.85; 0.90] | 0.89 [0.86; 0.91] | 0.86 [0.83; 0.89] |
| exploiter against `smart_rusher@hard` | 0.57 [0.42; 0.71] | 0.60 [0.45; 0.74] | 0.55 [0.40; 0.69] | 0.53 [0.37; 0.67] |
| top 3 against the field | exploiter 0.86, strangler@hard 0.85, rusher@hard 0.84 | exploiter 0.88, strangler@hard 0.85, rusher@hard 0.83 | exploiter 0.89, rusher@hard 0.84, strangler@hard 0.84 | exploiter 0.86, rusher@hard 0.85, strangler@hard 0.83 |
| Nash mix | exploiter 0.98, rusher@hard 0.01 | exploiter 0.98, rusher@hard 0.01 | exploiter 0.98, rusher@hard 0.01 | exploiter 0.95, rusher@hard 0.04 |
| intransitive share | 0.14 | 0.14 | 0.13 | 0.12 |
| Bradley-Terry: top, range | exploiter +2.22, 4.82 | exploiter +2.37, 4.88 | exploiter +2.49, 5.00 | exploiter +2.26, 4.88 |
| level ladder (V2) | PASS, 5 of 5 (not separated: reactive hard/normal, turtle normal/easy) | PASS, the same two | PASS, the same two | PASS, the same two |
| V6, server levels against the exploiter: easy / normal / hard / expert | 0.03 / 0.15 / 0.35 / 0.25 | 0.05 / 0.07 / 0.28 / 0.12 | 0.03 / 0.12 / 0.25 / 0.17 | 0.03 / 0.12 / 0.30 / 0.17 |
| CP burned at the cap, ticks at the cap | 1.5 CP, 1.8% | 1.5 CP, 1.8% | 1.5 CP, 1.8% | 1.6 CP, 1.9% |
| mirror side 0, all maps | 0.45 [0.40; 0.51] | 0.55 [0.50; 0.60] | 0.53 [0.47; 0.58] | 0.52 [0.47; 0.57] |
| Data validity | PASS 6, FAIL 5 (V4b, V4c, V5a, V5b, V6) | the same | the same | the same (V5a: no counter for the exploiter and `smart_rusher@hard`; `smart_strangler@hard` gets one under every variant) |

Per bot, the win rate against the field moves by at most 0.04 between the four runs (the hoarder 0.67 to 0.63..0.64, the exploiter 0.86 to 0.89 at `sup200`); the order does not change. The burn sits in the weak and passive bots: at `mvp-4` `smart_turtle@hard` burns 55 of 162, the exploiter 14 of 157, `smart_rusher@hard` 14 of 155; at `sup200` 23, 3 and 3.

### The supply contract (DEC-43, item M12)

- Items 1, 2, 3, 5, 6, 7 at the fixed points: the quick sweep of `packages/sim/tests/test_flow_liveness.py` run against every ruleset (the module's `RULES` swapped by a runner, no code change): **PASS** for all four, with identical numbers (churn 0, stuck 0, unfed 0, frozen 0, undrawn 0, holes 25 / 16 / 20 / 81 = `QUICK`). The full sweep (`--full`, splits 0..11) against `sup200f`: PASS, holes 97 / 125 / 94 / 173 = `FULL`. Expected: the sweep has no production, and `systems/flow.py` (including the spill `spill_way`) reads no factory period (only `systems/economy.py` and `view.py` do).
- Item 8 (`test_bench_supply_flow_busy`): not rerun, `supply_flow` reads no factory period, so the number cannot move.
- The bot-match items (*probe*, 24 matches per ruleset):
  - 4, burns of a full factory while an own node it reaches had room: 149 of 1048 burns at `mvp-4`, 21 of 426, 67 of 399, 46 of 509. My check is a rough one that runs outside the simulation. It reads the room from the end of the previous tick and does not take off the room that another factory's spill takes in the same tick. That is why the baseline is not 0 either, and why `sup200` scores highest: there the capital and the built factories fire on the same ticks. **No break attributable to the numbers** (the spill rule is unchanged).
  - 5, quick returns (a road used back within 60 ticks): 1226 at `mvp-4`, 1212, 1032, 1199. None of the variants has more than the baseline: **PASS**. Per send they are about 0.3 points higher (4.7% against 5.0%), because there are fewer sends.
  - 7, the chevrons (`flow_next` inside `flow_down`): 0 everywhere: **PASS**.
  - 6, sends from or into a node ahead of the level, counted live: 78 at `mvp-4`, 74, 94, 116. The baseline is not 0 either. In a live match the shift and the owners change within the tick, while the test counter reads the state after the tick. Not investigated further, and this is a reading to confirm, not a measured break.

**No contract item breaks.**

### Reading

- **For the bots, supply is not the binding resource, even at -29%.** `sup200` takes 44 charges a match out of production. About 24 of them come out of the burn, 8 out of captured warehouses and 8 out of the stock left at the end. The charges spent in fights fall by 1 (14.1 to 13.0), and captures, end reasons, match length, the field order, the Nash mix and the ladder do not move. The binding resource stays the CP (#688): the exploiter even gains a little (0.86 to 0.89).
- **The burn halves.** It goes from 0.243 to 0.119 at `sup200`, but the warehouses are still far from empty: the mean stock is 32 against 40, and 39 charges are left at the end against 47. A territory with more cities still stores the surplus.
- **Factories.** The bots build them as fast as they can at every number. The first factory is paid from the start stock at tick 184 under every variant, and the second comes 40 to 53 ticks later at `sup200` and `sup200f`. So the bot data cannot show whether a factory became a decision. What the numbers change is the stake: at `sup200` one built factory doubles the capital's output, while at `mvp-4` it adds half.
- **The leaf shift.** Bot use is unchanged (9.3 commands a match, mean shift 0.26 to 0.29). The bots shift by threat, not by stock, so this run cannot say whether the shift became a decision.
- **Territory.** A bigger territory wins just as often at every variant (0.83 to 0.84 by the end count; the probe at minute 10: 17 of 21 at `mvp-4`, 21 of 22 at `sup200`). Less supply does not make a big territory a burden for the bots.
- **Feeding a big army.** The one signal that it got costlier: the idle discharged unit-seconds in connected nodes grow by 43% at `sup200` (248 to 354), and 19% at `sup150`. These are armies that wait for a charge where the flow would bring one. Starvation in pockets does not grow.
- `sup200f` is a weaker cut: factories in the rear fill rear warehouses that already hold stock, so 0.185 of the production burns. It brings nothing that `sup200` does not.

**Caveat, where the fixed bot policies bias this.**
- The bots build factories as soon as they can and up to `factory.max`, whatever they cost. So the run cannot show a factory turning into a choice, and at a higher price it overstates their value.
- The leaf shift policy reacts to threat, not to scarcity, so the run cannot show the shift becoming a decision.
- The bots attack by CP, not by stock. A human who masses one army will meet the scarcity earlier than the bots do: this run understates how much less supply a human feels.
- The exploiter's lead belongs to the CP economy (#688, #759), and less supply does not touch it.

### Recommendation

Playtest **`mvp-4-sup200`** (`factory.capital_period_ticks = 200`, the rest as `mvp-4`). It is the strongest cut tested. It halves the burn, keeps the supply contract and leaves the bot field, the ladder and the match length as they are. So it is safe to put in front of a human, and the bots cannot tell us more than this.

What a human should feel differently:
- The capital alone gives 1 charge per 20 s, and every built factory doubles that. An early second factory should feel like a real choice against an early attack.
- The front warehouses no longer refill at once after a fight. Pulling the level back (the leaf shift) keeps charges out of a warehouse that is about to be lost.
- A big stack waits longer for its charges.

If even `sup200` still feels plentiful, the surplus is in the warehouses, not in the production (the mean stock is still 32). The next step would then be the factories or the warehouses (`factory.max`, `factory.cost`, smaller warehouses), not a third cut of the capital. That needs its own run.

### Decision

Awaiting the owner's decision.
