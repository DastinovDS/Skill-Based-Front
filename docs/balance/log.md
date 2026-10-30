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
