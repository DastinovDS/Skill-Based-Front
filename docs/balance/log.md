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
(AGENTS.md, 4.1, item 7) and is marked `BAL-02` next to the key. `mvp-1` stays the played ruleset; switching the
defaults is the owner's call (criterion 6).

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
