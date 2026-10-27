# Test vectors

Shared data for the tests of the simulation (Python) and the client (TypeScript). The expected values come
only from `docs/design/mechanics.md` and the DEC tables, not from the output of the code (`AGENTS.md`, section 0).
If you changed a rule in mechanics.md: fix the vector first, then the code.

The structure of the files is checked by `packages/protocol/tests/test_vectors.py`.

## `combat.json`: a fight over time (DEC-24, #261; the pace DEC-32, #327; the totals DEC-07, #11)

Worked examples from mechanics.md, section 4, "The fight arena (DEC-32)", the tables at `round_ticks = 20`
(the rules and rounds of "Fight over time", DEC-24): rows 1-16 (the totals of the DEC-07 table, with the rounds and
the duration) in `vectors`, rows 17-23 (a bounce without a chain, the meeting point, a race home, reinforcements,
a retreat) in `scenarios`. The fight in the simulation is tested against them
(`packages/sim/tests/test_combat.py`). The fight estimate in the client (CLI-08, #64) was removed (#252), the client does not read these
vectors.

The top level:

| Field | Value |
|---|---|
| `schema_version` | the file schema version, currently `2` (DEC-24; `1`: the instant fight DEC-07) |
| `source` | where the rules and examples come from |
| `params` | the rule numbers the examples are computed with: `terrain_defense_mod` (`mountains` / `forest` / `plains`), `defense_bonus`, `round_ticks`, `shots_per_round`, `regroup_ticks` (with DEC-32 `round_ticks = 20`). They match `rulesets/mvp-0.toml` (`terrain.defense_mod`, `combat.*`); a test checks this. `defense_bonus` (2, "Defense" (+2) in the table rows) is not a ruleset number: with DEC-30 it is the bonus accumulated by the start of the fight (`orders.defense_ticks_per_bonus` ticks per unit, at most the charged units of the group); the test gives the group that many ticks in "Defense". The plan bonus is not among them: with DEC-29 it depends on the path of the order and is set in each example (`bonus.amount`, +2 in the table rows) |
| `vectors` | rows 1-16, `id` equals the table row number |
| `scenarios` | rows 17-23: `id` (`17`, `17б`, `17в`, `18`, ...), `source_row` (the table row as is), `expected` (the numbers the row names; every row has its own keys, `test_combat.py` reads them) |

An example (`vectors[i]`). The sides are always called `a` and `b`: in a fight for a node `a` attacks, `b` defends.

| Field | Value |
|---|---|
| `id` | the table row number |
| `source_row` | the cells of the table row as is: `attack`, `defense`, `rounds`, `result` |
| `location` | `node_attack` (an attack on an occupied enemy node), `edge_meeting` (a meeting on an edge), `neutral_arrival` (a simultaneous arrival at a neutral node), `empty_enemy_node` (an enemy node without units) |
| `terrain` | the terrain of the node: `mountains`, `forest`, `plains`; `null` if the terrain does not take part by the rules (an edge, a neutral node) |
| `node_owner_before` | the owner of the node before the fight: `a`, `b`, `neutral`; `null` for an edge |
| `sides.<a\|b>.role` | `attacker`, `defender` or `symmetric` (a fight without a defender: an edge and a neutral node) |
| `sides.<a\|b>.bonus` | `null` or `{source, amount}`, where `source` is `planned_order` (a scheduled order) or `defense_mode` (the "Defense" mode, already active). Whether it works is decided by the rules (item F) |
| `sides.<a\|b>.groups` | the groups of the side: `id` (unique within the vector), `units`, `charged`, `mode` (`attack`, `defense`) |
| `expected.fight` | whether a fight starts (`false`: an empty enemy node is taken at once) |
| `expected.end_after` | the tick the fight ends minus the contact tick `t` ("`t+N`" of the table; `0` without a fight) |
| `expected.rounds` | how many rounds were played (`end_after / round_ticks`) |
| `expected.trace` | the charged of the sides after a round, where the table names them: `{round, charged: {a, b}}` |
| `expected.shots` | the shots of the sides for the fight, where the table names them (an edge), otherwise `null` |
| `expected.losses` | how many units each side lost |
| `expected.groups` | the same groups after the fight: `id`, `units`, `charged`; a destroyed group stays in the list with `units = 0` |
| `expected.bounce` | whether a side bounces at the end of the fight |
| `expected.node_owner_after` | the owner of the node after the fight: `a`, `b`, `neutral`; `null` for an edge |
| `expected.continues_on_edge` | for `edge_meeting`: whether a side continues its way along the edge; otherwise `null` |
| `expected.goes_on_after` | the winner's first step on the edge after regrouping, in ticks from `t` (row 12), otherwise `null` |
| `note` | the rounds and the result of the row as text |

The invariants the test checks: the `id`s are unique and run 1...16; for every group `0 ≤ charged ≤ units`;
`expected.groups` contains exactly the groups of the input; the losses of a side equal the difference of the sum of `units` before and after
the fight; charges do not appear from nowhere; the duration is a multiple of a round.

## `event_kinds.json`: the event kinds the server sends to a player (#184)

The list `kinds` (alphabetical) matches `PUBLIC_KINDS`, `PRIVATE_KINDS` and `FIGHT_KINDS` from
`gow_protocol.convert`: the other simulation events (`match_ended`) do not go to the player. This is checked by
`packages/protocol/tests/test_vectors.py`. The client (`apps/client/src/hud/eventText.test.ts`) requires
that every kind have a string in both dictionaries or be explicitly hidden from the feed. If you added an event kind
to the protocol: add it here and decide whether to show it in the feed.
