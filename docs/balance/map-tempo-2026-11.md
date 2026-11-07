# Map tempo experiment (#803), 2026-11-07

**Status: experiment.** Branch `exp/803-map-tempo`, not merged into `develop`; the decision is the owner's
(issue #803, "awaiting the owner's decision").

## Question

Is the "pressure on the front" equal on every map? Today the economy does not scale with the map: the CP income is
flat and the capital and the factories make charges at fixed periods, so a small map has more economy per node. The
experiment scales the economy periods by the node count `N` of the map and measures three variants:

| Variant | Ruleset | Multiplier `pct` |
|---|---|---|
| none | `rulesets/mvp-4-stances.toml` | 100 |
| sqrt | `rulesets/mvp-4-stances-tempo-sqrt.toml` | `isqrt(N * 10000 // 49)`, clamped 50..150 |
| linear | `rulesets/mvp-4-stances-tempo-linear.toml` | `N * 100 // 49`, clamped 50..150 |

Every economy period `p` (`cp.period_ticks`, `factory.capital_period_ticks`, `factory.built_period_ticks`, both
`[stances]` tables) becomes `max(1, p * 100 // pct)`. Nothing else scales. The two variant files differ from the base
only by the section `[map_tempo]`.

## Setup

- Three `mise run tournament:gh` runs on `--ref exp/803-map-tempo`, identical except the ruleset:
  none [42381908971](https://github.com/DastinovDS/Skill-Based-Front/actions/runs/42381908971),
  sqrt [42381915146](https://github.com/DastinovDS/Skill-Based-Front/actions/runs/42381915146),
  linear [42381918217](https://github.com/DastinovDS/Skill-Based-Front/actions/runs/42381918217) (6 shards each,
  about 30 minutes, run in parallel).
- Maps: all 12 (`maps/*.json`, `maps/gen/*.json`, 29..54 nodes). The generated maps (`meta.symmetry = "none"`) are
  not mirror-symmetric, so their side 0 share also measures the map, not only the bots.
- Bots: `smart_expander@hard`, `smart_reactive@hard`, `smart_rusher@hard`, `smart_strangler@hard`,
  `smart_turtle@hard`, `smart_hoarder` (hard by default); every ordered pair including self-play, 5 seeds:
  12 x 36 x 5 = 2160 matches per variant.
- The bots have no stance policy (DEC-44, #689): they stay in Balance the whole match, so only the Balance periods
  were exercised. The bots get the scaled rules (the tournament passes `apply_map_tempo(rules, map)` to them).

## Metrics

Per player and match (tournament row, `gow_sim.analysis`, `docs/balance/README.md` "Front pressure"):

- **Front width**: own nodes sharing an edge with an enemy-owned node, sampled once per second; the mean is taken over
  the seconds in which a front exists.
- **Front pressure**: the charges the player spent in fights (`charges_fights`: real shots, charges of killed
  units, DEC-45 terrain burn) per front node per minute of front. Per map it is pooled: all fight charges of the map
  over all front node-minutes of the map.
- **Fight charges / min**: the same charges per player-minute of match, not divided by the front.
- **First contact**: `first_contact_tick`, the first fight or capture of an enemy node (mean over matches, seconds).
- **CP / min, charges / min**: CP of the quanta fired (before the cap) and charges produced, per player-minute.
- **Capital wins**: matches that ended with a capital capture. **Side 0 share**: wins of side 0 over decisive matches.

Spread across maps: the coefficient of variation (population standard deviation over the mean of the 12 per-map
values), max / min, and the slope of `log(metric)` against `log(N)` (0: the metric does not depend on the map size;
negative: small maps are pushed harder).

## Results

Per-map values are pooled over the 180 matches of the map (36 ordered pairs x 5 seeds). The bootstrap standard error
of the per-map front pressure is 0.004..0.010, so differences between maps above about 0.02 are real.

### Variant `none`

| Map | Nodes | pct | Matches | First contact, s | Front width | Front pressure | Fight charges / min | Length, min | CP / min | Charges / min | Capital wins | Side 0 share |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gen1-17 | 29 | 100 | 180 | 60 | 5.72 | 0.174 | 0.97 | 14.2 | 5.99 | 7.62 | 18% | 53% |
| narrows | 29 | 100 | 180 | 66 | 7.14 | 0.147 | 1.03 | 13.8 | 5.99 | 7.08 | 16% | 47% |
| gen1-5 | 30 | 100 | 180 | 53 | 6.07 | 0.196 | 1.17 | 13.8 | 5.99 | 6.95 | 19% | 51% |
| gen1-25 | 38 | 100 | 180 | 67 | 6.86 | 0.165 | 1.13 | 14.4 | 6.00 | 7.17 | 12% | 42% |
| gen1-33 | 39 | 100 | 180 | 76 | 6.01 | 0.173 | 1.00 | 14.6 | 6.00 | 7.34 | 9% | 42% |
| gen1-36 | 44 | 100 | 180 | 79 | 5.76 | 0.191 | 1.05 | 14.1 | 5.99 | 7.96 | 14% | 37% |
| gen1-37 | 48 | 100 | 180 | 81 | 7.54 | 0.138 | 0.98 | 14.4 | 6.00 | 7.67 | 12% | 61% |
| crossroads | 49 | 100 | 180 | 111 | 11.71 | 0.111 | 1.25 | 14.6 | 6.00 | 7.08 | 8% | 49% |
| highway | 49 | 100 | 180 | 112 | 9.30 | 0.125 | 1.06 | 14.8 | 6.00 | 7.82 | 7% | 51% |
| gen1-40 | 51 | 100 | 180 | 44 | 6.41 | 0.202 | 1.27 | 14.6 | 6.00 | 7.89 | 11% | 40% |
| ridge | 51 | 100 | 180 | 85 | 10.48 | 0.115 | 1.11 | 14.9 | 6.00 | 7.59 | 2% | 54% |
| gen1-58 | 54 | 100 | 180 | 112 | 9.09 | 0.131 | 1.09 | 14.6 | 6.00 | 7.41 | 8% | 52% |
| **all** | | | 2160 | 79 | 7.67 | 0.149 | 1.09 | 14.4 | 6.00 | 7.47 | 11% | 48% |

### Variant `sqrt`

| Map | Nodes | pct | Matches | First contact, s | Front width | Front pressure | Fight charges / min | Length, min | CP / min | Charges / min | Capital wins | Side 0 share |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gen1-17 | 29 | 76 | 180 | 57 | 5.66 | 0.140 | 0.77 | 14.6 | 4.53 | 5.89 | 11% | 49% |
| narrows | 29 | 76 | 180 | 81 | 7.14 | 0.119 | 0.82 | 14.6 | 4.54 | 5.30 | 12% | 56% |
| gen1-5 | 30 | 78 | 180 | 64 | 6.02 | 0.178 | 1.06 | 14.1 | 4.66 | 5.53 | 17% | 53% |
| gen1-25 | 38 | 88 | 180 | 54 | 6.74 | 0.148 | 0.99 | 14.4 | 5.27 | 6.41 | 11% | 37% |
| gen1-33 | 39 | 89 | 180 | 78 | 6.06 | 0.162 | 0.94 | 14.7 | 5.33 | 6.51 | 7% | 36% |
| gen1-36 | 44 | 94 | 180 | 84 | 5.56 | 0.201 | 1.07 | 14.1 | 5.60 | 7.53 | 14% | 36% |
| gen1-37 | 48 | 98 | 180 | 84 | 7.40 | 0.147 | 1.02 | 14.4 | 5.86 | 7.52 | 11% | 56% |
| crossroads | 49 | 100 | 180 | 111 | 11.71 | 0.111 | 1.25 | 14.6 | 6.00 | 7.08 | 8% | 49% |
| highway | 49 | 100 | 180 | 112 | 9.30 | 0.125 | 1.06 | 14.8 | 6.00 | 7.82 | 7% | 51% |
| gen1-40 | 51 | 102 | 180 | 44 | 6.41 | 0.205 | 1.29 | 14.5 | 6.07 | 7.87 | 12% | 48% |
| ridge | 51 | 102 | 180 | 88 | 10.67 | 0.111 | 1.09 | 14.9 | 6.07 | 7.63 | 4% | 53% |
| gen1-58 | 54 | 104 | 180 | 109 | 9.05 | 0.139 | 1.16 | 14.5 | 6.20 | 7.56 | 10% | 54% |
| **all** | | | 2160 | 80 | 7.64 | 0.143 | 1.04 | 14.5 | 5.51 | 6.89 | 10% | 48% |

### Variant `linear`

| Map | Nodes | pct | Matches | First contact, s | Front width | Front pressure | Fight charges / min | Length, min | CP / min | Charges / min | Capital wins | Side 0 share |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gen1-17 | 29 | 59 | 180 | 72 | 5.35 | 0.113 | 0.58 | 14.4 | 3.53 | 4.61 | 12% | 48% |
| narrows | 29 | 59 | 180 | 93 | 6.74 | 0.111 | 0.72 | 14.5 | 3.53 | 4.29 | 10% | 46% |
| gen1-5 | 30 | 61 | 180 | 79 | 5.57 | 0.154 | 0.84 | 14.2 | 3.66 | 4.35 | 13% | 58% |
| gen1-25 | 38 | 77 | 180 | 62 | 6.39 | 0.147 | 0.93 | 14.5 | 4.60 | 5.61 | 12% | 31% |
| gen1-33 | 39 | 79 | 180 | 88 | 6.00 | 0.145 | 0.83 | 14.8 | 4.73 | 5.87 | 4% | 38% |
| gen1-36 | 44 | 89 | 180 | 87 | 5.39 | 0.199 | 1.03 | 14.0 | 5.33 | 7.23 | 15% | 31% |
| gen1-37 | 48 | 97 | 180 | 86 | 7.66 | 0.140 | 1.01 | 14.4 | 5.80 | 7.32 | 11% | 57% |
| crossroads | 49 | 100 | 180 | 111 | 11.71 | 0.111 | 1.25 | 14.6 | 6.00 | 7.08 | 8% | 49% |
| highway | 49 | 100 | 180 | 112 | 9.30 | 0.125 | 1.06 | 14.8 | 6.00 | 7.82 | 7% | 51% |
| gen1-40 | 51 | 104 | 180 | 43 | 6.46 | 0.206 | 1.31 | 14.4 | 6.20 | 8.02 | 14% | 47% |
| ridge | 51 | 104 | 180 | 87 | 10.54 | 0.118 | 1.15 | 14.8 | 6.20 | 7.79 | 5% | 51% |
| gen1-58 | 54 | 110 | 180 | 110 | 9.40 | 0.129 | 1.12 | 14.6 | 6.66 | 8.01 | 9% | 48% |
| **all** | | | 2160 | 86 | 7.54 | 0.137 | 0.99 | 14.5 | 5.19 | 6.51 | 10% | 46% |

### Spread across maps

Over the 12 per-map values. "slope vs log N": the least squares slope of `log(metric)` against `log(nodes)`.

| Variant | Front pressure CV | max / min | slope vs log N | Fight charges / min CV | max / min | slope | First contact CV | Capital wins (all) |
|---|---|---|---|---|---|---|---|---|
| none | 0.197 | 1.81 | -0.42 | 0.086 | 1.31 | +0.13 | 0.279 | 11% |
| sqrt | 0.206 | 1.85 | -0.05 | 0.141 | 1.68 | +0.52 | 0.272 | 10% |
| linear | 0.217 | 1.85 | +0.18 | 0.210 | 2.26 | +0.91 | 0.228 | 10% |

### Same node count, different shape (49 nodes)

`crossroads` and `highway` have pct 100 in every variant, so the three rows are the same matches.

| Variant | crossroads pressure | highway pressure | ratio | crossroads width | highway width |
|---|---|---|---|---|---|
| none | 0.111 | 0.125 | 0.89 | 11.71 | 9.30 |
| sqrt | 0.111 | 0.125 | 0.89 | 11.71 | 9.30 |
| linear | 0.111 | 0.125 | 0.89 | 11.71 | 9.30 |

### Small against big maps

The mean of the per-map front pressure of the small maps over that of the big ones (1.00: equal):

| Variant | narrows / (crossroads, highway, ridge): the pool | (narrows, gen1-17, gen1-5) / (the five maps of 49+ nodes) |
|---|---|---|
| none | 0.147 / 0.117 = **1.26** | 0.172 / 0.137 = **1.26** |
| sqrt | 0.119 / 0.116 = **1.03** | 0.146 / 0.138 = **1.06** |
| linear | 0.111 / 0.118 = **0.94** | 0.126 / 0.138 = **0.91** |

By bot (side 0, pooled, maps of 29..30 nodes against maps of 49+ nodes): under `none` every bot pushes harder on the
small maps (`smart_rusher@hard` 0.267 against 0.154, `smart_reactive@hard` the least, 0.129 against 0.127); under
`sqrt` four bots of six are within 0.01 and the rusher and the expander still push about 1.2..1.3x harder on the small
maps; under `linear` four bots of six (`hoarder`, `reactive`, `strangler`, `turtle`) push *less* on the small maps
than on the big ones: an overcorrection.

## Reading

1. **What the size does today.** The fight charges per player-minute hardly depend on the map (`none`: CV 0.086, slope
   +0.13): the bots fight about one charge per minute on every map. What changes is the front: on a small map the
   same fighting falls on fewer front nodes, so the pressure per front node is higher. On the pool `narrows` is
   pushed 1.26x harder than the 49..51-node maps; the slope against `log N` is -0.42.
2. **sqrt removes the size trend; linear overcorrects.** sqrt brings the slope to -0.05 and the small/big ratio to
   1.03..1.06. linear turns the slope to +0.18 and the ratio to 0.91..0.94: the small maps become quieter than the big
   ones. The economy itself (CP and charges per minute) follows the multiplier as designed: under sqrt `narrows` gets
   4.5 CP and 5.3 charges per player-minute instead of 6.0 and 7.1, under linear 3.5 and 4.3.
3. **Neither variant reduces the total spread.** The coefficient of variation of the front pressure stays about 0.2 in
   all three variants (0.197, 0.206, 0.217), max / min about 1.8. The spread that is left is the **shape** of the
   map, not its size: the per-map pressure correlates with the observed front width at -0.94 (log-log, `none`) and
   with the node count only at -0.48. Two maps of 51 nodes differ 1.8x (`gen1-40` 0.202 with a front of 6.4 nodes,
   `ridge` 0.115 with 10.5); two maps of 49 nodes differ 1.13x (`crossroads` 0.111 with a front of 11.7, `highway`
   0.125 with 9.3). The generated maps have narrow fronts (5.4..7.7 nodes) at every size; the hand-made pool maps
   have wide ones (9.3..11.7) except `narrows`.
4. **Is the node count the right input?** For the four pool maps, yes: their front width grows with the size, and
   sqrt of the node count equalizes them within 3%. For the generated maps, no: their front is narrow whatever the
   size. Simple static graph measures do not do better than `N`: the number of nodes about equally far from both
   capitals (`|d0 - d1| <= 1`, hops), the edges cut by the hop-distance split between the capitals and the capital
   distance correlate with the observed front width at 0.39, 0.50 and 0.41 (`N`: 0.61). The front width is an
   emergent property (where the bots stop expanding), so a map-shape input would have to be measured, not computed
   from the graph alone.
5. **Side effects of sqrt on the small maps.** The first contact comes a bit later on `narrows` (66 s to 81 s; on
   `gen1-17` and `gen1-5` within noise: 60 to 57 s, 53 to 64 s); capital wins on the 29..30-node maps drop from 16..19%
   to 11..17%; the match length stays 14.1..14.6 minutes; the side 0 share does not move beyond the map's own skew
   (the generated maps are not symmetric: `gen1-25`, `gen1-33`, `gen1-36` favour side 1 in every variant).
6. **Limits of the data.** The bots stay in Balance (no stance policy, #689), so only the Balance periods were tested;
   bots are rule-based and play every map the same way, so a human who widens or narrows the front on purpose may
   change the picture. 5 seeds per pair and map (180 matches per map) is enough for the per-map pressure (standard
   error at most 0.010) but not for win rates by pair.

## Recommendation

**sqrt with `ref_nodes = 49`, `min_pct = 50`, `max_pct = 150`**, if the owner wants the formula at all: it equalizes
the front pressure across the pool (`narrows` against the three big pool maps within 3%, from 26%) without making
the small maps quieter than the big ones, and the pool's big maps keep today's numbers exactly. Confirm it with a
human playtest on `narrows` (its economy becomes 24% slower: CP every 13.1 s and a capital charge every 26.3 s under
Balance) before accepting the DEC.

linear is not recommended: it overcorrects (small maps quieter than big ones for four of the six bots).

The formula does not fix the spread between the generated maps and the pool: that is a question of map shape (front
width), not of size. If the generated maps are to play like the pool, that belongs to the generator (#771: a wider
middle) or to a per-map multiplier measured by a tournament, not to a node-count formula.

## Open questions for the owner

1. Is "pressure per front node" the target, or "fighting per player-minute"? The latter is already equal across maps
   today (CV 0.09), and any tempo formula makes it less equal (sqrt CV 0.14, linear CV 0.21).
2. sqrt or none? The pool has one small map; a per-map `tempo_pct` in the map file (measured once) would be simpler
   than a formula and would also cover the shape of the generated maps.
3. Should the generator (#771) aim at a front width like the pool maps (9..12 nodes) instead?
4. Should the stance menu show the scaled seconds (the proposed UI), or should the map card show "economy tempo 76%"
   as well?

## What a real PR needs

- The DEC in `docs/design/mechanics.md` with the status [accepted] and the section `[map_tempo]` in the played ruleset
  (`mvp-4-stances.toml` and/or `mvp-4.toml`): the hash of that ruleset changes.
- `SIM_VERSION` raised and new golden replays (a new rule, even if the existing rulesets play byte-identically), a
  golden replay on a tempo ruleset and a small map.
- The client already gets the scaled periods (`ruleset_public` is built from `Match.rules`, the effective rules);
  showing the multiplier itself would be a protocol field (`PROTOCOL_VERSION` raised).
- The fog: nothing new to hide, the multiplier is public (a function of the public map and ruleset).
- The front pressure metric of this branch can go to `develop` on its own (it does not change the simulation).

## Reproduce

```bash
mise run tournament:gh --ref exp/803-map-tempo --ruleset rulesets/mvp-4-stances-tempo-sqrt.toml \
  --bots "smart_expander@hard smart_reactive@hard smart_rusher@hard smart_strangler@hard smart_turtle@hard smart_hoarder" \
  --maps "maps/crossroads.json maps/highway.json maps/narrows.json maps/ridge.json maps/gen/gen1-17.json maps/gen/gen1-25.json maps/gen/gen1-33.json maps/gen/gen1-36.json maps/gen/gen1-37.json maps/gen/gen1-40.json maps/gen/gen1-5.json maps/gen/gen1-58.json" \
  --seeds 5 --shards 6 --label tempo803-sqrt
```

The tables above come from the three `tournament.jsonl` files (pooled per map as described in "Metrics").
