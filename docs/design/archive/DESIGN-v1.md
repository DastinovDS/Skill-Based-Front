> **Outdated, see [`../mechanics.md`](../mechanics.md).** The first version of the design document, kept as an archive.
> The rules of the game are set only by `docs/design/mechanics.md`; where this file disagrees with it, this file is not in force.

# Skill-Based Front: design document

> Status: concept. Nothing described here is implemented. The document records the decisions
> made during the design work, together with the reasons, so that a month from now there is no need
> to work out again why it was done this way.

---

## 1. What this is

A competitive real-time strategy game on a graph of provinces. One match takes
10-15 minutes. The core of the game is **logistics**: the winner is not the one with more troops,
but the one whose supply network can feed a fight in the right place at the right moment.

The closest relatives in feel: go (an accumulating board, life and death of groups),
Clash Royale (a countable economy of actions), Unity of Command (supply and encirclements).
The combination has no direct analogues.

### Target audience: honestly

This is **not** the mass strategy audience. The mass audience buys Manor Lords, Civ and
Total War campaigns: the fantasy of management, not a test of skill. The audience of this game is
a minority that plays StarCraft ladder, AoE2, go and chess. It is loyal and lives for
decades, but its demands are the opposite of the mass ones: symmetric maps instead of
beautiful random ones, no randomness instead of "dramatic moments", rating and
replays instead of a campaign.

The choice is made deliberately. Half-measures do not work here.

---

## 2. Frame

| Parameter | Decision |
|---|---|
| Match length | 10-15 minutes |
| Map size | 25-40 nodes |
| Start | each player already has a significant territory, contact from the first seconds |
| Mode | priority 1v1 and team modes; FFA is in question (see open questions) |
| Maps | a pool of hand-made maps with N-fold rotational symmetry, not procedural generation |
| Monetization | no P2W; realistically a one-time purchase |

**Why not 2.5-4 hours** (the original idea): it is the worst possible duration.
Too long to jump in for an evening, and too long to survive quitters. Web data:
a typical session is 11-20 minutes, people play 2-3 games per visit. OpenFront lives on
20-40 minutes. Depth does not come from length: go and chess matches are shorter.

**Why fixed maps.** The depth of chess and go is not in the rules but in accumulated
knowledge: opening theory, joseki, standard shapes. Knowledge accumulates only if
positions repeat. Random generation physically does not let a meta form: every
match starts from scratch, and a player can become faster but not smarter.

---

## 3. Principles (design invariants)

Violating any of them breaks what the game is being made for.

1. **Depth comes from the consequences of simple rules, not from hidden constants.**
   A hidden rule is learned by the community once and turns into a tax on newcomers.
   Its half-life is days (plus a python build is unpacked in five minutes).
   Hidden **state**, on the contrary, is generated anew every match. The rules
   are fully public; only the state of affairs on the opponent's side is unknown.

2. **Distinguish entities by their relation to the topology, not by stat vectors.**
   The six pieces in chess differ in *how they move*, not in attack and health.
   Fifteen units with different stats give a solvable balance, not depth.

3. **Everything the player tracks must be derived from the shape of their territory.**
   Five independent counters are five objects in the head. Three projections of one
   state of the board are almost one.

4. **CP never grow from territory.** Not from cities, not from buildings, not from armies.
   This is the main brake against a snowball: an empire twice as big has exactly the same
   number of actions per minute. The same brake that makes go a game: you cannot place two stones in one turn.

5. **Attributability.** A player must be able to say "I lost because of a move at the eighth
   minute". Hence: no randomness in combat, a symmetric start, a replay with reveal.

6. **Hard integer rules.** Binary rules are learned from the first match and give
   clean deduction. Continuous quantities blur the inference.

7. **Execution skill is actively cut out.** No micro-management, no
   placement precision, no APM race. All the skill is in decisions.

### Antipatterns

- Expanding the unit roster gives complexity, not depth, and breeds a dominant strategy.
- Tech trees reduce to a single optimal path.
- A resource whose optimal spending can be memorized is a build order, that is, execution and not a decision.
- A special rule "against trenches": the cure must be the victory condition, not the combat mechanics.

---

## 4. The core: one unit, three modes

There is **one** unit type. All the expressiveness is in what the group is doing now and where it stands.

At any moment a group is in one of three modes:

| Mode | What it does |
|---|---|
| **Combat** | the ordinary state, full combat supply consumption |
| **Readiness** | dug in: the same strength for half the supply; publicly announced; tied to the place |
| **Work** | builds/widens roads; cannot fight; if attacked in this mode, sharply weakened |

### The triangle of counters

```
    Attack ──beats──▶  Work
      ▲                  │
      │                  beats
     beats               │
      │                  ▼
   Readiness ◀───────────┘
```

- **Attack beats Work**: a group that is building is not ready.
- **Readiness beats Attack**: a dug-in group fights at half the cost.
- **Work beats Readiness**: construction does not storm a fortification, it
  **devalues** it: you raise the throughput of the bypass route, the artery
  shifts, and the dug-in group sits on a branch that no longer carries anything.

A full non-transitive triangle without a single stat and without a second unit type.
Thematically honest: the Maginot Line is not stormed, it is bypassed, and a bypass is engineering work.

### Switching modes

Entering Readiness takes time. Cancelling is **asymmetric**:

- out of contact: the time spent is lost;
- under threat (the enemy is near or approaching): costs CP and goes slower.

The decision is made **before it is known for certain** whether the preparation was needed.
This is a task of prediction, not of reaction.

A side effect: since the preparation is public and leaving is expensive, **a mistaken
preparation is punished twice**: you announced a commitment that cannot be lifted, and the opponent strikes
elsewhere. Readiness becomes a read, not a safe default option.
The same makes an **expensive bluff** possible: dig in loudly at A so that the opponent
draws in, and strike covertly at B. In game theory only expensive signals mean anything.

---

## 5. Action economy (CP)

The only spendable currency. It regenerates at a fixed rate
(guideline: 1 per 4-6 seconds) and accumulates up to a cap (guideline: 4-5).

CP pay for **everything** the player does:

- a movement order;
- splitting and merging groups;
- retreating under contact;
- cancelling Readiness under threat.

Construction **does not cost CP**: it costs the fact that the group does not fight and does not prepare.
The opportunity cost is enough.

**Initiative = CP.** Won a trade: got actions. Not an abstract percentage
bonus (which would collapse into "always attack"), but the right to act more often. This is a direct
analogue of positive elixir trade: tempo becomes countable and therefore learnable.

Since CP are not enough for everything, sente/gote arises automatically: a threat that demands a response
costs the opponent an action elsewhere. A special "initiative counter" is not needed:
what is needed is scarcity.

---

## 6. Supply

### The model is a body, not a switch

Arteries and capillaries. The flow goes from the cities along the graph, the farther the worse.
Mathematically this is max-flow / min-cut, but to the player it is explained with the metaphor of the circulatory
system, and nothing more needs explaining.

From the flow problem **for free** falls out everything that otherwise would have to be written by hand:

- encirclement is literally a minimum cut;
- cutting off can be **partial**: reduced the flow by 40%: choked without killing;
- redundancy of links = the "eyes" of go (Menger's theorem: protection against a cut is several
  disjoint paths);
- overextension punishes itself;
- bottlenecks are not designed but arise as min-cuts of the topology.

### Supply is a budget that gets spent

**Critical.** If supply is a static property that is read, then every fight has
a predetermined winner, known in advance and forever: no exhaustion, no drama,
no decision.

Therefore:

- **Road width is a ceiling on delivery speed**, not strength.
- The network produces N per second; groups consume for upkeep; **combat consumes many times more**.
- A drawn-out fight burns both sides faster than the networks replenish → **mutual exhaustion
  arises by itself**.
- An army on a narrow branch can *stand* but cannot *fight* for long.

### The main consequence: fronts compete for one budget

A group on a wide artery can be weaker than a group on a narrow road if three more fronts
depend on the artery. The question is not "whose road is wider" but **"whose network can afford
this fight right now"**.

Hence: **opening a second front weakens the first without moving a single unit there.**
This is the only way to move a sealed front, and it is also a mechanical, not a
psychological, initiative.

### Strength

```
strength = min(group size, delivered supply)
```

Size is the ceiling of consumption. Supply is the fuel. A big group without supply
is a big group of hungry mouths.

Consequences:
- Gathering more than the network can feed is **pointless**: the excess adds mouths, not strength.
- Overflow beyond the capacity of a node **slowly burns away**: there is nothing to feed it with.
- The central strategic act is to **starve** an army, not to defeat it.

### There are no resources

There are **no** separate resources (Money/Metal/Oil/Food/Fossils). The production of new groups
is tied to the flow that reaches a city. What remains on the screen is CP and the board.

The deepest skill games in history have zero resources. Resources are a source
of load, not of depth. The only exception: a resource adds depth if its
value depends on position. Here that role is played by the flow itself.

---

## 7. The map

### Two different widths

This distinction is critical, without it everything breaks.

| | What it is | What it determines | Who changes it |
|---|---|---|---|
| **Terrain width** | how wide the land is | the **front**: how many units physically fight at once | nobody, set by the map |
| **Road width** | what is built on that terrain | the **throughput** of supply + a gate on the passage of groups | the players, up to the limit of the terrain |

Terrain is always public: it is geography. So the ceiling of the threat in each direction
is known to everyone from the first second; **how much the opponent has used up that ceiling** is the subject of scouting.

A narrow front cuts **both sides**: on terrain of width 1 it is one against one,
and a garrison of five is useless. This is Thermopylae: the pass does not give the defender strength,
it nullifies numerical superiority.

### Who builds the road

**The one who owns both ends of the edge. On a contested edge, nobody.**

There is one width per edge. Not "the maximum of the two" (that would give the enemy your investment) and
not two independent halves (double counting inside your own territory, and it is exactly from there that
the asymmetry "I will leave the road narrow and they will not take me" comes).

Consequences:

- **You can build only in the rear.** You cannot prepare a highway for an invasion.
- **The last crossing is a bottleneck for everyone, symmetrically.** Nobody improves the
  conditions of their own assault. Where war is possible at all is decided by the **map**, not by the players.
- **Consolidation stops being a separate rule.** Took a node → the edge became
  internal → you can finally build. The rhythm of the offensive (breakthrough → pause →
  consolidation → thrust) arises from a single restriction.
- **The expansion cycle:** occupied a node → built a road to it → went further. Cut off
  from the network, you have nothing to go further with.

### Node capacity

Vertices also have capacity. Without it a deathball in the capital is invulnerable: it sits right on
the source of supply, and the flow does not limit it.

```
capacity = city_base + Σ f(width of road i)
```

**Only those edges that lead into your connected supplied territory** are counted.

f is concave, so that building up **all** approaches is rewarded, not just one:

| edge width | contribution |
|---|---|
| 1 | +1.0 |
| 2 | +1.5 |
| 3 | +2.0 |
| 4 | +2.3 |
| 5 | +2.6 |

A table, not a function: tuned by hand, read by eye, no floating point in the network.

(Why not max: the other two roads become junk. Why not sum: one road
of width 9 equals three of width 3. Why not min: one dirt road zeroes out a city,
and there appears an incentive not to own nodes with a large number of links.)

**The key consequence is siege as strangulation.** By cutting off an approach, the attacker reduces the
garrison the city is able to hold. Three roads → capacity 6; took one → 4;
took the second → 2. The garrison spills over the limit and **bleeds** (attrition over
time, not an instant eviction: the defender has a window to decide).

This is a literal translation of the go **breaths** (liberties): the connected approaches are the liberties, you remove
them one by one, and the group dies not from a blow but from the loss of shape.

**The second consequence.** A city of capacity 8 with three roads of 3: eight fit, but
no road will pass more than three at a time. So gathering a fist is a logistical
operation, visible and slow. And **to mass, you must first own the approaches**.

**The third.** A high-degree node is a natural fortress (many summands), but also the most
vulnerable (many approaches to cover). The best position is the hardest to hold.

### Players building new edges

Allowed. It is the most go-like element: the map stops being a board and becomes a position.
It also gives teeth to the "Work beats Readiness" arm: a bypass is always available, just expensive.

Four restrictions without which everything else breaks:

1. **Planarity: an edge cannot cross an existing one.** Encirclement makes sense
   only on a planar graph; an edge jumping over foreign territory kills
   the whole go analogy. As a side effect: a built road eats up geometric space,
   closing the possibility of other roads, including the opponent's.
2. **Construction is public from the first second**, like Readiness. This is the main *slow
   visible ultimatum* of the game: the opponent watches a path being dug toward them and must decide
   whether to interfere or accept.
3. **A node degree limit** (4-5). Otherwise six roads into the capital bring the deathball back through
   the back door, and by the tenth minute the map turns into an unreadable web.
4. **Terrain decides where it is possible and at what price.** Only geometrically close nodes; mountains
   expensive or impossible.

Tempo: widening an existing road is fast; a new edge is long, 1-3 per match.
An event, not a routine.

There is **no** demolition of roads: by capturing a node you have already blocked the flow through it. A separate
mechanic would give an extra button and a duty to repair.

### Requirements for maps

- **N-fold rotational symmetry** for N players (for 1v1, a 180° rotation).
  Not mirror. The positions are topologically identical → "I lost to the map" disappears as a class.
- **From any base to any important node, at least two or three sufficiently wide routes.**
  Otherwise a large army is obliged to appear in a single place, and the match degenerates
  into pushing along a corridor.
- **Significant neutral space between the starting positions.** This is what makes
  passivity punishable (see the victory condition). If the map is divided from the first second,
  trenches become a valid strategy.
- **The value and the difficulty of supply are positively correlated.** Capitals on the periphery,
  value in the center, which everyone's arteries reach with difficulty. Otherwise the dominant
  position is taken once and held forever.
- Variety comes **from a pool of maps**, not from a generator. One with narrow passes, another
  a web, a third with a fat central artery. The same rules, a different game.

---

## 8. Combat

### Where it takes place

**A meeting engagement on an edge.** Two groups collided between nodes. Front = the terrain width of
the edge. Both draw supply from afar. The outcome: the border moves, the loser rolls back.

**Assault on a node.** The attacker reached a city. Front = the terrain width of the edge
they came along. The key asymmetry: **the defender sits on the source of supply,
the attacker at the end of the pipe.** Hence the value of cities, without special bonuses to defense.

### The tick

For every point of contact, every tick:

1. **Engaged** = min(units in place, terrain width). The rest are reserve.
2. **Supply delivered** = the min over the roads of the route, taking into account how much the network
   already spends on other fronts.
3. **Strength** = min(engaged, delivered). In Readiness half the supply is needed
   for the same strength.
4. **Losses** of each side ∝ the enemy's strength. Both sides always bleed.
5. **Deficit modifier:** whoever does not get enough supply takes losses with an increased
   coefficient. Logistical war is lethal, not merely slow.
6. **The border** moves toward the weaker at a speed ∝ the difference in strength. Equality: it stands.

All deterministic, no dice rolls.

### The border is a state of the fight, not a state of the map

The point of contact exists **only where a fight is going on right now**: it is a single number
("how far it has been pushed"), living with the active engagement and disappearing along with it.

On the other edges no border is stored: there is only the ownership of nodes, and
territory is drawn from it. The tug of war remains, but it is ephemeral: while
they fight, the strip crawls and is visible; when they stop, the border collapses to the neutral
line. The map at rest stays simple, complexity appears only where it is looked at.

**The border is moved by troops, not by supply.** Supply decides who can afford
to press, and therefore shows not in the *position* of the border but in its *movement*.

### Reserves

The reserve automatically replaces the fallen: no orders, no micro.
**The engaged burn the combat rate, the reserve only upkeep.** That is why keeping
a reserve makes sense, and dumping the whole army onto a narrow front does not: strength is by the width of the terrain,
the consumption is by the whole crowd.

### How it ends

Three outcomes: destruction; retreat (an order, costs CP, slower under contact); the border
reached a node → assault.

**There is no automatic flight.** Did not pay for the retreat: the group dies. This runs
into the CP deficit: not everyone can be saved, you have to choose whom to abandon. Here also lives the go
**sacrifice**: giving up a group for tempo elsewhere becomes a real move.

### What the player does

Little: bring up reinforcements, retreat, change mode. And **the best move is usually not in this
fight**: open a second front so that the enemy network splits its budget.

**Combat is an indicator of logistics, not a standalone event.** It does not decide, it
shows the decision made five minutes ago. That is why it can and must be simple.

### Worked example

Edge A-B: terrain 3, road 1 (contested, nobody builds). C-B and D-B: 3 each.

A storms B head-on:
- road 1 → a large group cannot be passed through, it must be split (CP) and go one at a time;
- front 3, but A's supply through road 1 → **A's strength = 1**;
- B at its own node: full supply from C and D, capacity ~5, the front cuts to 3 → **B's strength = 3**.

3 against 1, A is ground down.

A takes D, then C. B's capacity sagged, the inflow dropped, one approach of width 1 remains:
- **B's strength = min(garrison, 1) = 1**, parity;
- A has three bodies against one or two, the trade goes in its favor.

The city falls **not because A broke through the road, but because it cut the other two.**

---

## 9. Information

### The ladder: one rule, four levels

The principle: **from afar the state is visible, up close the magnitude.**

1. **To everyone, always:** geography: nodes and terrain widths.
2. **To everyone, always:** announced preparations and constructions. **A fact, not strength.** What is visible is THAT
   a position is prepared, not HOW strong it is: otherwise publicity leaks the whole distribution of forces and scouting
   loses its meaning. This way a small prepared group is indistinguishable from a big one, and the bluff works.
3. **Near your territory:** ownership, presence of troops, status. No numbers.
4. **Your node, or a node your group has entered:** everything exactly.

Front-line edges are visible to both by definition. **The opponent's internal roads** are the subject
of scouting: how much they invested in the rear is visible only where vision reaches.

### Vision: the smaller the group, the farther it sees

A group of size 1 sees wide, a group of size 10 sees narrow. Scouting is small
scattered detachments on dirt roads, not a column on a highway.

Why: vision tied to the width of the arteries would give **compounding**: whoever invested
also sees more. The inversion turns the snowball around: the one who gathered mass goes **blind**,
and the scattered one gets an asymmetric weapon. And the decision "split or merge" becomes
three-dimensional: splitting costs CP, but buys mobility along the capillaries **and** vision.

The role of the scout arises without a separate unit type.

### Inversion of visibility

**A commitment is public, improvisation is private.** Ordinary movement is hidden until contact
or until it enters vision; preparation and construction are public.

A public preparation is not a trap but a **zone ban**: the enemy sees it and can go around.
The price arises by itself: by announcing where you are strong, you have announced where you are not.

### Deduction is the main reward of the system

A hard limit by width + fog give a **bounded inference problem**: geography
is public, so an opponent who does not see the group knows the set of places where it can be.
Every observation narrows the set.

The mechanics rescue each other: fog makes width interesting, and width makes fog
**fair**: a big army does not appear out of nowhere, you could always work out where
it would come from.

This is the "system the player studies", but what they study is a live opponent, and the task
is generated anew every match. Hidden constants would give a week of feeling instead of years;
worse, **they kill deduction**, because deductive skill exists only
on top of a known model of the world.

### A replay with reveal is mandatory

After the match, show the true picture of the flows over time. It turns every defeat
into a lesson instead of a guess, teaches in weeks instead of months and kills superstitions. For a skill
game it is part of the core, not a decoration.

---

## 10. The victory condition

**VP drip for holding cities over time.** Not for destroying the opponent.

This is a load-bearing structure, not a detail. It is what makes passivity a loss:

A player who sealed all approaches with narrow roads is unbreakable, and holds exactly what they
started with. All the neutral space goes to the opponent without a single fight. After six
minutes the opponent owns a map twice as big and scores points twice as fast.

**A turtle does not need to be cracked, it needs to be outgrown.**

Besides, a narrow network chokes the dug-in player themselves: they cannot aggregate their own
production, they have no depth of defense (capacity is minimal everywhere), and a single crack
brings down the whole construction.

A narrow front **must** stay unbreakable head-on: this is a good and realistic
mechanic. The task is not to give a key to this door, but to make sitting behind the
door not a winning strategy. This is handled by the victory condition, neutral land
and road building.

---

## 11. Open questions

**1. 1v1 or FFA: decide before everything else.**
The inversion of visibility lives badly in FFA: a public preparation is visible not only to your target
but also to third parties, who will immediately use it. Planning becomes
suicidal. In 1v1 and team modes the mechanic is clean. Maps,
balance and modes depend on this choice.

**2. Platform.** The market analysis gave two realistic niches:
- *Web/.io*: sessions of 15-30 minutes, zero installation, direct competition with OpenFront through
  depth. The strongest tailwind (Poki: 100M MAU versus 10M in 2020), but it requires
  a web client.
- *Steam, a one-time purchase of 15-25 €*: single player against AI + lobby. The trend of the mid price point
  ($30-50 grew by 60% on PC) and the strategy renaissance works. But a strong AI is needed,
  and the statistics are harsh: of 20 282 releases in 2025, the threshold of 1000 reviews was passed by 2.99%.

The combination (web as a free funnel → Steam as monetization) is justified: 62% of web players
bought a game they found in the browser.

What is **not** on the trend map is a desktop client for competitive three-hour matches.

**3. Automatic flight:** to do it or not. Currently decided "no" (the player's decision,
it runs into CP). It may turn out too harsh; a candidate for playtest levers.

**4. Randomized modifiers per match** as a separate casual mode:
the range is known, today's draw is unknown → scouting the ruleset becomes
part of the match. A renewable mechanic that does not occur in strategy games. But it pays
with attributability, therefore **not** in the rating.

**5. All the numbers.** CP regen, CP cap, the combat consumption rate, the deficit coefficient,
the speed of border movement, the edge construction time, the base capacities of cities. Nothing
is calibrated.

---

## 12. What to check in playtests

**The dominant strategy test.** 20 live matches. If more than 70% follow one
opening, there is no depth, regardless of the number of systems in the game.

**Bot self-play as a depth gauge.** Three primitive bots with fixed strategies
(expansion / early pressure / supply cutting), a hundred runs. Look **not** at
who won but at the **spread of outcomes**: the configuration with the greatest variance
of winners is the one where the strategic space is wider. A bot taking 65%+ against everyone
means a wrongly chosen restriction.

**Red flags:**
- a mass of one unit or a pure economy wins → topology does not affect the outcome;
- a trench equilibrium: both dug in, nobody moves;
- initiative snowballs;
- the early game collapses into "everyone builds" → you need to restrict the **places** of construction,
  not the price.

**The build order test.** You added a quantity: check whether the optimal
sequence of the first two minutes can be written down as text. If it can, it added execution,
not decisions. Remove it.

**The superstition test.** For any non-obvious factor: can a player set up
an in-game experiment isolating this variable? If not, it will breed not knowledge
but superstitions.

**The first levers, if trenches dominate:** the rate of VP accrual and the volume of neutral
space. **Not** the combat mechanics.

---

## 13. Interface requirements

Not cosmetics but part of the design.

- **The combat bar shows the flow, not HP.** "Your 7 / his 4". The loser must
  instantly understand not only that they are losing but also what to do: not to send more troops
  into the meat grinder but to cut the artery.
- **Before committing troops, your own strength is visible exactly and an estimate of the enemy's.** Otherwise every fight is
  a blind bet, and the whole construction was built for the opposite.
- **On hovering over an edge, the marginal benefit, not the width.** "Upgrade: +1.5 city
  capacity, +2 flow". The concave formula works as design only if the player sees its
  result; otherwise it is a hidden rule.
- **Show the derived army limit explicitly.** "Supply holds 14, you have 16, attrition
  is under way".
- **Borders breathe.** The thickness of the "pipes" and the movement of the border are the visual language of logistics.
  Shifts must be a **reaction to events**, so that the player can always name the cause,
  and not a background drift.
- **Early expansion gives the same feeling of painting over the map** as Territorial.io and
  OpenFront, but behind the picture there is real logistics: territory grows because
  a road was built, not because of a click.
