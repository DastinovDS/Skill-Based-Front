"""``SmartBot``: the shared base of the smart bots (#166, PR 1) and its five personalities.

One controller plays every personality; a personality is only a set of thresholds and weights
(``PARAMS``, drawn from the match seed by ``choose_params``, AGENTS.md section 8) and a stance.
The decision is the campaign play of ``CampaignBot`` (fights, fronts, city builds, recalls,
attacks under the stack limit, gathering, rallying, recruiting; its module docstring) driven by
the assessment layer (``gow_bots.bots.assess``), computed from the ``PlayerView`` every decision:

1. **The thresholds of the decision follow the position.** Ahead on the VP forecast (+1 margin)
   the bot demands ``secure_margin`` more shots of every attack (no wasted waves while the clock
   wins); not ahead with at most ``all_in`` awards left it goes all in (no capital guard, no
   reserve, one hop farther). The CP ``reserve`` waits only while the upper bound of the enemy CP
   can pay for a planned strike (#166: no idle reserve against an enemy that cannot strike).
2. **The capital.** When the shown enemy forces that can reach the own capital within ``alarm``
   ticks are enough to take it (``Threat.danger``), the capital comes first: its groups stay,
   free charged groups that can arrive in time walk home, and the capital recruits (item 22).
   Only a garrison sees what comes (DEC-35), so while an enemy node is within ``watch`` hops of
   the capital it keeps at least ``watch_guard`` units.
3. **Visible strikes** (DEC-08): ``respond`` 1 answers a planned strike at the capital, 2 at any
   own city, with the nearest group (the reactive play); for ``EXPOSED_TICKS`` the
   origin of every strike scores ``w_exposed`` more as a target (a bare spot to hit back).
4. **Targets** are ranked by one weighted sum (``score``): VP of the target (``w_vp`` for an enemy
   city, ``w_neutral`` for a neutral one), the damage to the enemy supply network (``w_cut``
   percent of ``cut_value``), the hops it brings closer to the enemy capital (``w_closer``),
   minus the shots it needs (``w_need``) and the hops away (``w_hops``); the enemy capital in
   reach always first (an open one before everything else: item 27). ``region`` > 0 keeps the
   targets within that many hops of the own capital (``spill`` more while CP are about to burn).
5. **Garrisons and the rest**: ``hold_front`` units stay in own nodes next to the enemy, front
   garrisons below it are filled from free groups nearby; the stance is item 24.
6. **Arrivals and recruit queues** (#166, PR 2; DEC-25), from ``gow_bots.bots.logistics``
   (the supply itself is the automatic flow of DEC-43 and the leaf shift, item 21):

   - A *doomed* city (losing its fight, or an arrival it cannot hold within ``DOOM_TICKS``)
     cancels its recruit queue (the queue and its CP are lost with the city, a cancel refunds
     them, DEC-25, items 3 and 10).
   - *Recruit queues* (DEC-25): a rear city with the barracks queues a second unit when a whole
     price is spare (no idle tick between units; up to ``recruit.queue_max`` with CP about to
     burn); a unit that has not started refunds in full (item 3), so while the capital is in
     danger and cannot pay its own recruit, the other cities cancel theirs (``unbank``).

7. **Scouting** (DEC-35: only own groups see). The ``scouts`` own front nodes nearest the own
   capital (the capital aside: it keeps ``guard``) keep at least one unit; an empty one gets the
   smallest free group nearby (a big group splits off its least charged unit first). A watched
   node keeps the unit when others march.
8. **The engagement zone** (DEC-37): a group that leaves a node within ``combat.engage_ticks``
   of an enemy arrival there is caught and fights outside the node, without its terrain. A group
   standing in an own node an enemy reaches within that window plus ``PIN_SLACK`` (the order
   applies in the next tick) is *pinned*: it does not leave and fights as the holder.
9. **Human tempo** (``gow_bots.bots.tempo``): a difficulty level (``easy``, ``normal``,
   ``hard``; the registry name ``smart_rusher@easy``, ``hard`` without a suffix) sets how often
   the bot thinks, how late it notices a shown enemy strike or figure, its commands per minute
   (a token bucket every ``spend`` pays) and whether it reads the position (``insight``: the
   thresholds of item 1, the pin of item 8, the evacuation of item 6, the scouts of item 7).

10. **A chosen plan gets its CP** (``wait_plan``, #618). When the best attack is a scheduled order
    (the bonus it gathers takes the target, DEC-41, item 10) that the CP cannot pay yet, the bot
    holds its price for ``wait_plan`` ticks (a ``Hold``): every other command that is not urgent
    (fights, evacuation,
    the garrisons and the answers to strikes) leaves that price, so one-CP claims do not eat it
    up. The hold ends when the plan is sent, when its target or group is gone, or when it runs
    out; the same target is not held again for twice ``wait_plan`` ticks. Without ``insight``
    the bot does not plan ahead (no hold).
11. **Strikes at lesser cities** (``worth_defense``, #618). ``respond`` 1 answers only the
    strikes at the capital; with ``worth_defense`` > 0 it also answers a strike at an own city
    worth at least that many VP while an award is still to come (a reinforcement like
    ``respond`` 2). The reaction delay of the level is the one of ``Perception``.

12. **A converging strike on the enemy capital** (``STRIKE``). The free charged groups within
    ``STRIKE_HOPS`` edges of it whose path reaches it go together (``strike_plan``): the groups
    next to it first, the most charged first, each by a scheduled order when ``plan_strike`` says
    so (a group that can gather a bonus, DEC-41, item 10), else by an ordinary one, while the CP
    last. The strike goes when its pool (charges and plan bonuses) reaches the shots that take
    the capital (``strike_need``) and it has ``STRIKE_MIN`` groups (one group alone is a single
    attack of item 4, unless ``STRIKE_ONLY``); with ``STRIKE_BANK`` a ready strike keeps its
    price from the other spending until it is paid. The orders are timed so that every group
    arrives within ``STRIKE_ALIGN`` ticks of the slowest one (the gathering of a plan,
    ``orders.plan_ticks_per_bonus`` a bonus, and the travel times of mechanics.md, section 4,
    ``travel.edge_ticks``):
    the joins of the first rounds count in full (DEC-24, D1). The groups of a
    strike are not recalled one by one and do not leave a fight that the rest of the strike is
    still walking into (``committed``, ``coming``).

    ``STRIKE`` is on for every personality but the bunker, with ``insight`` (``striking``).

Items 13-17 answer the owner's staging strike (#624, playtest 2026-10-30, B1-B4); they need
``insight`` and the personality's ``ANSWERS`` (the benchmark ``smart_hoarder`` keeps them off),
and each has its switch (``WORRY``, ``WITHDRAW``, ``CENTRE_BARRACKS``, ``PAIRS``).
Items 13 and 14 are off for every personality: on GitHub runners they made the hard bots weaker
against the field and against the benchmark (``docs/balance/log.md``, #624):

13. **Worry** (B1, anxiety). The enemy shots seen within two hops of the own capital (fresh
    sightings, figures heading next to it), at least ``WORRY_SEEN`` of them, plus
    ``ANXIETY`` percent of an upper bound of what the fog may hide (``hidden_shots``: the enemy
    CP bound of ``EnemyCp`` grows with every quiet period, CP regeneration being public and only
    the stance hidden; two plans of guessed groups at most, a guessed group more for a visible
    enemy barracks next to the capital, DEC-31), reach the shots that take the capital now: free
    charged groups that can arrive within ``alarm`` ticks walk home, the capital recruits, one
    more scout watches the way in, and the enemy node next to the capital with the most visible
    shots weighs ``W_STAGE`` more as a target (hit the build-up before it strikes).
14. **A thin garrison leaves** (B2): the groups of an own province whose pool (DEC-07) is
    ``WITHDRAW_GAP`` or more below a visible enemy force next to it that would take it walk to
    the safer own neighbour, not back into a node left within ``WITHDRAW_TICKS``. Cities are held
    (their VP and warehouse), numbers hidden by the fog are no reason, a pinned node (DEC-37)
    stays.
15. **War while the charges burn** (B3): an item of the stance of economy v1, removed with it
    (#894); the stance policy is item 24.
16. **One forward barracks in the centre** (B4): the large city whose hops to the two capitals
    differ least, once held and not next to the enemy; no barracks in front cities.
17. **Two strikes at one node** (the defensive pair): two or more enemy scheduled orders aimed at
    the capital raise the alarm (item 2) within ``alarm`` ticks of their arrival; at any other
    own node they are answered like a strike at the capital (a reinforcement).

18. **The midgame and the late game** (#663; ``gow_bots.bots.estimate``). The *phase* is the
    opening while more than a tenth of the nodes is neutral, the midgame after it, the late game
    in the last ``LATE_AWARDS`` VP awards. Every decision estimates the enemy force (the public,
    symmetric start units of the map plus as many recruits as the own side made, minus the enemy
    losses of the visible fights), its *strength by node* (fresh sightings, the rest spread over
    the unseen enemy nodes), the *sectors* (the enemy nodes next to the own territory, with the
    support of their enemy neighbours) and the *threat* to every own front node. On a settled map
    the spare units of the capital march to the objective (``MID_RALLY``) and the personalities
    play their plan by class switches: ``W_WEAK`` (score per shot a sector is below the mean
    pressure), ``MID_GOAL`` (the army rallies to the weakest sector, ``weak_spot``),
    ``MID_GROUP`` (no attack on a garrisoned enemy node with fewer charged units: concentrated
    breakthroughs), ``W_RING`` (score per own neighbour of the target: the encirclement),
    ``COUNTER`` (ahead on the forecast, a garrisoned enemy node that is no weak sector is a
    target only for ``COUNTER_TICKS`` after an enemy attack on an own node, the enemy neighbours
    of that node first). The late game keeps
    item 1: ahead, every attack demands ``secure_margin`` more; not ahead, all in.
19. **The turtle** (``SmartTurtle``): the natural half in the opening; on a settled map it holds
    while the forecast is ahead (garrisons by the threat, the spare army in the most threatened
    front city, road fortifications, the own half retaken first) and pushes the weakest sector one
    node at a time while it is not (its docstring).
20. **Pockets** (#684; DEC-43, item H; ``gow_bots.bots.pockets``). Under the supply flow a pocket
    (an own component without the own capital, ``flow_pocket``) never gets a charge from the
    capital's component and starves without a factory. Before the attacks (``leave_pockets``) a
    discharged free group in a pocket node with an empty warehouse leaves it (a front node does
    not keep it), then a charged one in a node that starves: it walks to the empty foreign node on
    the shortest chain of free captures into the capital's component (a ``Move`` ends at the first
    foreign node, SIM-05; the capture is free under ``mvp-5``, DEC-38), and once it is back the
    flow pulls charges to it (item A4); a group too big for the way, or for the room the foreign
    node has left once the own units on the way into it arrive (``pockets.heading``, item 21,
    #754), splits off the part that fits, and a city keeps one unit (an empty city falls for
    free, its VP with it). With no free way out it waits, and the foreign node that cut the
    pocket off (next to the capital's component and a pocket) scores ``W_RESCUE`` more per unit
    it rejoins (``pockets.rescue``), so a viable attack from either side retakes it first.
    Pocket discipline (#683, under a capture price): a stranded unit (no charge, an empty
    warehouse) weighs twice in the rescue; a discharged group that cannot pay the
    way out walks to a charged group of its pocket (``pocket_merge``), which waits for it and
    then leaves with it, its charges paying the capture for all; a charged group carrying
    stranded units leaves like one in a starving node, and a front node of a pocket keeps no
    charged group (held there it starves).
21. **Capacity and the leaf shift** (#686, G-L of the ``mvp-4`` bot audit). No move, recall or
    recruit puts an own node over capacity at the arrival (``CampaignBot``, "Capacity"): the
    garrisons, the answers, the reinforcements and the walks home count the units already on the
    way and pick a group that fits. The leaf shift holds ``economy.SHIFT_HOLD_TICKS`` after every
    change and stays back while the enemy takes own nodes (``economy.leaf_shift_command``).
22. **Capital defense and road fortifications** (#682, G-F of the ``mvp-4`` bot audit;
    ``gow_bots.bots.forts``). There is no Defense (DEC-41, item 5) and no bunker: the road
    fortification (DEC-43, item D) is the defensive building.

    - *The capital*: every road into it that a visible enemy force of ``FORT_SHOTS`` comes by
      (a fresh sighting in the enemy neighbour, a planned strike, a figure heading in) is
      fortified, any visible force while the capital is in danger; the capital keeps no CP for
      it. While the danger is within ``alarm`` plus the build time and the alarm is not on,
      ``DANGER_RESERVE_MOVES`` orders of CP are kept for it. The alarm walks home every free group
      that joins the capital's fight before it can be over (``walk_home``: a round per shot that
      takes it), a discharged one too while the capital warehouse has charges for it, and fills the
      capital's recruit queue (``recruit_burst``).
    - *Threatened nodes* (``fortify_roads``, with ``insight``): one fortification per decision on
      the road a visible force of ``FORT_SHOTS`` comes by into an own city or chokepoint
      (``forts.cut_off``) that holds units, is no fight and not doomed; at most ``FORTS`` of them
      on roads from enemy nodes, ``FORT_KEEP`` CP left, ``FORT_SHARE`` percent of the CP had so
      far at most. ``smart_turtle`` leans on them (6, no keep, 20%), ``smart_rusher`` least (1,
      2 CP kept, 5%); the benchmark ``smart_hoarder`` keeps the old
      capital defense and none (``DEFENSE_V2``). The CP sink of ``economy.fort_site`` stays,
      last in the decision (item 26).
23. **Cancel discipline and CP banking** (#687, G5 of the bot audit). A cancel refunds nothing
    (``orders.cost.cancel``, DEC-20, C), so a personality
    with ``DISCIPLINE`` recalls only an attack that would lose units and does not send the same
    target again within ``RECALL_TICKS`` without more shots (``CampaignBot.recall_pays``). A
    personality with ``BANK`` > 0 saves for a push or a fortification it has decided on and
    cannot pay yet (``saving``): a converging strike that is ready by its forces (item 12, the
    groups the budget pays go once that part is ready) or a road fortification whose site item
    22 found. While it saves, the routine spending (attacks, rallies, recruits, scouts,
    garrisons) leaves up to ``BANK`` CP, never more than the cap less two quanta; the urgent
    answers (fights, the capital, the strikes) spend them. The saving opens at the cap less one
    quantum (no CP burn at the cap, DEC-02) and stops for ``BANK_TICKS`` after a goal waited
    ``BANK_TICKS`` unpaid. The benchmark ``smart_hoarder`` keeps neither (its ``STRIKE_BANK``).
24. **The stance policy** (#881, DEC-44; ``gow_bots.bots.stance``). The stance
    of the phase (``stance_opening``, ``stance_midgame``, ``stance_late``: 0 Economy, 1 Balance,
    2 War), one step toward Economy while the next CP quantum would burn (on from the stance in
    force while they keep burning) or units wait for charges the warehouses do not have, one step
    toward War while the warehouses or the capital's are full or the capital is pressed with few
    CP; at most one change per ``stance_dwell`` ticks. The rusher
    (and the exploiter) stay in War, the expander opens in War, the turtle opens in Economy,
    the hoarder hoards in Economy and strikes in War late; the others play Balance. Without
    ``insight`` only the stance of the phase.
25. **The attack estimate before contact** (#881, DEC-40; ``CampaignBot.support``, ``meets``).
    Under ``combat.retreat = "none"`` a lost fight cannot be left, so the shots an attack needs
    count the reinforcements the defender can bring while the fight lasts (``contact_pct``
    percent of them) and the enemy figures met on the road in; an attack short of that is not
    sent, the group gathers or rallies. Under ``"round"`` nothing changes.
26. **CP discipline** (#1015, finding 1 of the bot behaviour review of 2026-11-12). The CP sink
    of ``economy.fort_site`` (a road fortification while the CP near their cap) comes last in
    the decision, after the attacks, the recruits and ``bank``, and spends only the CP the
    decision leaves near the cap (``fort_sink``), within the ``FORT_SHARE`` budget of item 22,
    which it shares; the budget counts the CP had at the stance in force (``cp_had``), not at
    the Balance period. Before, it came first and had no budget: a level whose APM bucket binds sits
    near the cap, so its every decision bought a fortification before any attack (27 to 41% of
    the CP of ``easy``). The APM bucket pays only the commands with a CP price (``spend``): a
    split, a cancel or a stance change needs a ready bucket and takes nothing.
27. **An open enemy capital is taken at once** (the owner's rule of 2026-11-12;
    ``gow_bots.bots.capital``). Right after the fights, before every other spending, a free group
    that reaches the enemy capital and takes it by the numbers the view shows there (empty, or
    weakly held) is sent, whatever ``radius``, ``region``, the score, a strike or a plan say; the
    capital guard goes only when it arrives before an enemy could reach the own capital. A node's
    owner and the enemy seen there reach the decision at once (the reaction delay of item 9 is
    for strikes and figures), so the level reacts within its think interval: the move is past the
    APM bucket and the kept CP (the one command that wins), and a bot with an empty bucket that
    sees the enemy capital still looks at it once a think interval (``peek``). With no CP for the
    move the decision spends nothing priced. Before, the capital was only the best score of
    ``_attack``, the last spending of a decision and within ``radius`` hops: the discharged groups
    next to an empty capital could not pay the capture, the charged ones were farther or the
    guard, and the CP went elsewhere first.
28. **A winning strike package and an army** (#1023, step 4a of the bot plan; the owner's recipe
    in his matches of 2026-11-12: 3-unit squads, the full bonus, a charge surplus, ``GroupMove``):

    - *The package* (``PACKAGE``, ``SURPLUS``; ``CampaignBot.options``): an attack on a defended
      enemy node (a garrison by the estimate) goes only with the shots that cancel the defender's
      charges and terrain, kill each of its units and leave the capture charge (``need``,
      ``takes``: more than the owner's "charges, terrain, toll and a capture charge" by the units)
      plus ``SURPLUS`` (0: one more measured weaker), and goes by a planned order with the full
      bonus the group can gather (DEC-41, item 10), not the shots it misses only; a walk-in
      stays an ordinary order.
    - *Squads* (``SQUADS``, ``squad``; on a settled map, item 18): the capital and a front stack
      split off one squad of a province's capacity (DEC-22, the stack limit of DEC-20 lets it
      through every node) a decision, and a stack that took a node stays together until a whole
      squad can go; less than a squad splits off only to walk into an empty node
      (``WALK_IN_SPLITS``: the land race is won by walk-ins, and without them the squads lost it
      to the benchmark) or, from the capital, to rally to the front (item 18).
    - *A combined attack* (``COMBINE``, ``_combine``, under ``[group_order]``): a defended enemy
      node no free group takes alone gets one ``GroupMove`` (DEC-48, a synchronized arrival) of
      the nearest free groups that take it together with the package, as few as it takes, one
      a decision; the converging strike of item 12 goes by one ``GroupMove`` too
      (``_strike_together``). Their members are committed (item 12): no recall one by one.
    - *The second echelon* (``W_EXPLOIT``): the groups a combined attack leaves out stay free,
      and for ``EXPLOIT_TICKS`` after the bot takes an enemy node every enemy node next to it
      scores ``W_EXPLOIT`` more (through the hole: the nodes behind it, the supply it cut).
    - *Plains first* (``W_TERRAIN``, the owner's input of 2026-11-12): a defended enemy target
      scores ``W_TERRAIN`` more per charge its terrain burns (the plains, DEC-45) and less per
      charge it adds (the mountains); ``need`` counts those charges already.
    - *Every unit used* (the owner's input of 2026-11-12): the spare of the capital above its
      guard does not stand idle, a squad or less: it walks into an empty node or rallies to the
      front (item 18) and merges there.
    - *The late assault* (``ASSAULT``): in the late game (item 18) a striking personality rallies
      to the enemy capital and its strike reaches one hop farther (``strike_hops``).

    The benchmarks ``smart_hoarder`` and ``smart_exploiter`` keep item 28 off.
29. **Defense** (#1022, step 4b of the bot plan; ``gow_bots.bots.defense``, ``DEFENSE``, off for
    the benchmarks). Once the neutrals run out the front nodes worth holding keep a picket, the
    valuable ones a garrison, within ``HOLD_SHARE`` percent of the army (``front_hold``); a
    salient is given up; a lost node is retaken before any attack by the nearest free groups
    that take it together (a breakthrough sealed), else the road into the rear is blocked. A
    visible strike at any own node is answered (``respond``): a reinforcement when the sum
    holds, else its origin is a target, or a garrison it would kill whole leaves. A lost node,
    the source of an enemy siege and the empty enemy rear while its army is committed score more
    (``score``).
30. **Army upkeep** (#1032, step 4c of the bot plan; ``gow_bots.bots.upkeep``, ``UPKEEP``, off for
    the benchmarks). The army keeps a floor of ``FLOOR_PCT`` percent of the own start army
    (less in the opening, none when all in); below it a recruit comes before the attacks once
    per ``upkeep.FIRST_TICKS`` ticks and otherwise right after them, before the rallies, merges
    and splits, without ``recruit_keep``; the scouts and the threat fortifications leave its
    price, and a retake or a block goes with two units at least. A visible strike at an own node
    other than the capital is answered only when the sum of forces holds (``defense.answer``,
    every strike at the node together), never by the nearest group alone; a gathering plan that
    the target, as seen now, beats is called off (``recall_plans``).

An order is planned when the bonus it gathers makes it take its target (DEC-41, item 10), the
same rule for all bots (AGENTS.md, section 8), and with item 28 whenever it attacks a defended
enemy node and can gather a bonus (the full bonus then). Tie-breaks are mirror-invariant
(``Bot.key``, ``Bot.edge_keys``), nothing draws from ``self.rng``.
"""

import math
from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import ClassVar, Final, override

from gow_bots.bots.assess import FRESH_TICKS, Assessment, Assessor, Travel
from gow_bots.bots.base import ParamRange, node_of
from gow_bots.bots.campaign import STALE_TICKS, CampaignBot, Ctx, Option, Wave
from gow_bots.bots.capital import TakeCommand
from gow_bots.bots.defense import Defense, answer, seal
from gow_bots.bots.defense import read as read_defense
from gow_bots.bots.economy import fort_site
from gow_bots.bots.estimate import EnemyForce, Phase, Sector, phase, sectors, strengths, threats
from gow_bots.bots.forts import RoadThreat, cut_off, fortified, road_threats
from gow_bots.bots.logistics import Arrival, arrivals, garrison_need
from gow_bots.bots.pockets import Pockets, heading, read_pockets
from gow_bots.bots.stance import StanceInputs, StancePolicy, factories_full, wanted_stance
from gow_bots.bots.tempo import DEFAULT_DIFFICULTY, DIFFICULTIES, Bucket, Perception
from gow_bots.bots.upkeep import FIRST_TICKS, army, floor, recall_plans
from gow_bots.bots.utility import (
    defender_pool,
    shots_to_take,
    takes,
    terrain_burned,
)
from gow_sim.commands import (
    CancelRecruit,
    Command,
    FortifyRoad,
    GroupMove,
    Move,
    Recruit,
    Split,
)
from gow_sim.maps import MapDef, NodeKind
from gow_sim.ruleset import Ruleset, Stance
from gow_sim.view import (
    AtNode,
    Detail,
    EnemyGroupView,
    FightView,
    GroupView,
    IntentView,
    PlayerView,
)

__all__ = [
    "PERSONALITIES",
    "SmartBot",
    "SmartExpander",
    "SmartReactive",
    "SmartRusher",
    "SmartStrangler",
    "SmartTurtle",
]

GUESS_UNITS: Final = 3
"""Units assumed for an enemy force whose numbers the fog hides (the threat to the capital)."""
THREAT_HORIZON: Final = 60
"""Ticks after the first arrival that still add a force to the threat."""
CUT_REFRESH_TICKS: Final = 20
"""The cut values are recomputed this often: ownership changes rarely."""
EXPOSED_TICKS: Final = 150
"""How long the origin of an enemy strike counts as exposed."""
SEARCH_HOPS: Final = 3
"""Farthest own node a reinforcement comes from, in road hops."""
DOOM_TICKS: Final = 30
"""An own city that a shown enemy force able to take it reaches within this many ticks is doomed."""
PIN_SLACK: Final = 1
"""Ticks added to ``combat.engage_ticks`` for the pin of DEC-37 (an order applies next tick)."""
SCOUT_TICKS: Final = 30
"""A node a scout was split off for waits this long before another split for it."""
STRIKE_ALIGN: Final = 10
"""The groups of a converging strike arrive within this many ticks of the slowest one (item 12)."""
STRIKE_TICKS: Final = 400
"""A strike whose groups are not all sent by its arrival plus this many ticks ends; a sent group
stays committed to it as long."""
STRIKE_REST: Final = 300
"""Ticks after a strike before the next one is planned."""
WITHDRAW_TICKS: Final = 150
"""A garrison does not withdraw into a node it left this recently (no back and forth)."""
WORRY_SEEN: Final = 3
"""Enemy shots that must be seen near the capital before the fog adds to them (item 13)."""
W_STAGE: Final = 400
"""Score added to the enemy build-up next to a worried capital (item 13)."""
LATE_AWARDS: Final = 6
"""The late game: the last this many VP awards (three minutes, ``estimate.phase``)."""
W_RESCUE: Final = 50
"""Score per own unit (or stopped factory, ``pockets.FACTORY_UNITS``) a capture rejoins with the
capital's component (item 20): a pocket of four units weighs like one VP of an enemy city."""
COUNTER_TICKS: Final = 300
"""How long an enemy attack on an own node opens the counterattack of ``smart_reactive``."""
V2_RECRUIT_KEEP_MOVES: Final = 2
"""``recruit_keep`` is at most this many ordinary orders (``adjusted``): the keeps of the
personalities were drawn for an economy with half the CP income and "Defense" to pay."""
DANGER_RESERVE_MOVES: Final = 2
"""#682: CP kept, in ordinary orders, while the capital is in danger but the alarm
is not on yet (item 22): the walk home and the recruits of the alarm, or a fortification."""
FORT_SHOTS: Final = 3
"""Visible enemy shots on a road into an own node that make it worth a road fortification
(item 22): a toll of at least 1 charge (DEC-43, item D6), a force, not a scout."""
FORT_MARGIN: Final = 2
"""A threatened node is fortified only when the visible force is at most this many shots short of
taking it (``shots_to_take``): the fortification may decide the fight (item 22)."""
FORT_RETRY: Final = 600
"""A road whose fortification the enemy destroyed (a capture, DEC-43 item D7) is not fortified
again for this many ticks after the first one was sent: the front changes hands there (item 22)."""
W_FORT_VP: Final = 100
"""Rank of a threatened node for a fortification per VP it is worth (item 22)."""
W_FORT_CUT: Final = 50
"""Rank of a threatened node for a fortification per own node its loss cuts off (item 22)."""
EXPLOIT_TICKS: Final = 300
"""Item 28: how long a node the bot took from the enemy draws the second echelon (30 s)."""
BANK_TICKS: Final = 300
"""Item 23 (#687): a goal saved for this long without being paid stops the saving for as long
(three quanta of CP: the price of a fortification and a keep, or of a strike of three groups)."""
_COMMON: Final[Mapping[str, ParamRange]] = {
    "alarm": ParamRange(150, 250),
    "all_in": ParamRange(3, 5),
    "secure_margin": ParamRange(1, 1),
    "starved": ParamRange(4, 6),
    "watch": ParamRange(2, 2),
    "watch_guard": ParamRange(2, 2),
    # The keys of #618 sort after every drawn key, so the draws of the others stay as they were.
    "wait_plan": ParamRange(100, 200),
    "worth_defense": ParamRange(0, 0),
    # The stance policy under ``[stances]`` (item 24, ``gow_bots.bots.stance``; #881): drawn from
    # their own stream (``base.LATE_KEYS``). The stance of each phase is an index of
    # ``stance.STANCES``: 0 Economy, 1 Balance, 2 War.
    "stance_opening": ParamRange(1, 1),
    "stance_midgame": ParamRange(1, 1),
    "stance_late": ParamRange(1, 1),
    "stance_wait": ParamRange(3, 4),
    "stance_full": ParamRange(70, 80),
    "stance_cp_low": ParamRange(100, 200),
    "stance_dwell": ParamRange(200, 400),
    # Item 25 (#881): the percent of the reinforcements of the defender an attack counts under
    # ``combat.retreat = "none"`` (``CampaignBot.support``).
    "contact_pct": ParamRange(100, 100),
}
"""Thresholds every personality shares (see the module docstring)."""


@dataclass(frozen=True, slots=True)
class Hold:
    """CP kept for a scheduled order the bot chose and could not pay yet (item 10)."""

    dest: int
    group: int
    """Opaque id of the group that was to go."""
    node: int
    """The node it stood in: a group that stands there later is as good, whatever its id (two idle
    groups of a node merge into the one with the lowest internal id, which is not mirror-invariant,
    #899)."""
    cost: int
    """Hundredths of CP."""
    until: int
    """The hold ends at this tick."""


@dataclass(frozen=True, slots=True)
class Pick:
    """One group of a converging strike (item 12)."""

    group: int
    """Opaque id."""
    node: int
    units: int
    charged: int
    planned: bool
    lead: int
    """Ticks from the order to the arrival: the plan's delay and the travel time."""
    bonus: int
    """The plan bonus it brings (DEC-29), 0 for an ordinary order."""


@dataclass(slots=True)
class Strike:
    """A converging strike on ``target`` (item 12): the groups not sent yet and the arrival."""

    target: int
    arrive: int
    """The tick the slowest group arrives; every group is sent to arrive within ``STRIKE_ALIGN``."""
    picks: list[Pick] = field(default_factory=list[Pick])
    until: int = 0


@dataclass(frozen=True, slots=True)
class Worry:
    """An enemy build-up the own capital may not hold (item 13)."""

    shots: int
    """Visible enemy shots within two hops of the capital plus the counted hidden ones."""
    hold: int
    """Shots that take the capital from its garrison now (``shots_to_take``)."""
    stage: int | None
    """The enemy node next to the capital with the most visible shots: a target to hit first."""


@dataclass(frozen=True, slots=True)
class StrikePlan:
    """What a strike would bring now (``SmartBot.strike_plan``)."""

    pool: int
    """Charges plus plan bonuses of the picks."""
    need: int
    """Shots that take the target by the estimate, with ``strike_margin``."""
    cost: int
    """Hundredths of CP."""
    picks: tuple[Pick, ...]

    @property
    def ready(self) -> bool:
        return bool(self.picks) and self.pool >= self.need


class SmartBot(CampaignBot):
    """The shared base: see the module docstring. Subclasses set ``PARAMS`` and the stances."""

    name: ClassVar[str] = "smart"
    STANCE_POLICY: ClassVar[bool] = True
    """Item 24: the stance policy (#881)."""
    CONTACT: ClassVar[bool] = True
    """Item 25: the attack estimate before contact under ``combat.retreat = "none"`` (#881)."""
    STRIKE: ClassVar[bool] = False
    """Converging strikes on the enemy capital instead of single attacks on it (item 12)."""
    STRIKE_HOPS: ClassVar[int] = 3
    """Farthest group of a converging strike, in edges of its path."""
    STRIKE_MARGIN: ClassVar[int] = 1
    """Shots a strike brings above the estimate (``strike_margin`` in ``PARAMS`` overrides it)."""
    STRIKE_ONLY: ClassVar[bool] = False
    """The enemy capital is never a single target: only a converging strike (the benchmark)."""
    STRIKE_BANK: ClassVar[bool] = False
    """A ready strike keeps its price from the other spending until it is paid (the benchmark);
    otherwise it goes when the CP are there."""
    STRIKE_MIN: ClassVar[int] = 2
    """Groups a strike needs: one group alone is a single attack (``_attack``)."""
    ANSWERS: ClassVar[bool] = True
    """The answers of items 13-17 (#624); the benchmark ``smart_hoarder`` keeps them off."""
    WORRY: ClassVar[bool] = False
    """Item 13 on (with ``ANSWERS``). Off: measured worse (#624, docs/balance/log.md)."""
    WITHDRAW: ClassVar[bool] = False
    """Item 14 on (with ``ANSWERS``). Off: measured worse (#624, docs/balance/log.md)."""
    CENTRE_BARRACKS: ClassVar[bool] = True
    """Item 16 on (with ``ANSWERS``)."""
    PAIRS: ClassVar[bool] = True
    """Item 17 on (with ``ANSWERS``)."""
    ANXIETY: ClassVar[int] = 50
    """Percent of the hidden enemy force (``hidden_shots``) a worried capital counts (item 13)."""
    WITHDRAW_GAP: ClassVar[int] = 2
    """A garrison this many shots below a visible adjacent enemy force leaves (item 14)."""
    W_WEAK: ClassVar[int] = 0
    """Midgame (item 18): score per shot an enemy front sector is below the mean pressure."""
    W_RING: ClassVar[int] = 0
    """Midgame (item 18): score per own neighbour of an enemy target (the encirclement)."""
    MID_GOAL: ClassVar[bool] = False
    """Midgame (item 18): the army rallies to the weakest enemy sector, not the enemy capital."""
    MID_GROUP: ClassVar[int] = 0
    """Midgame (item 18): an attack on a garrisoned enemy node needs this many charged units."""
    MID_RALLY: ClassVar[bool] = True
    """Midgame (item 18): the spare units of the capital march without a target in reach."""
    COUNTER: ClassVar[bool] = False
    """Midgame (item 18): ahead on the forecast, enemy nodes are attacked only for
    ``COUNTER_TICKS`` after an enemy attack on an own node (the counterattack)."""
    DEFENSE_V2: ClassVar[bool] = True
    """Item 22 on: the capital defense of #682 and the threat fortifications; the benchmark
    ``smart_hoarder`` keeps the old capital defense and no threat fortification."""
    FORTS: ClassVar[int] = 2
    """Item 22: fortifications on the roads into threatened own nodes other than the capital
    (built or being built, on a road from an enemy node) kept at most; 0: none."""
    FORT_KEEP: ClassVar[int] = 100
    """Item 22: CP in hundredths left after a fortification of a node other than the capital."""
    FORT_SHARE: ClassVar[int] = 10
    """Item 22: percent of the CP the bot has had so far (``cp.start`` and the flat income, public)
    that its fortifications of nodes other than the capital may take at most."""
    BANK: ClassVar[int] = 0
    """Item 23 (#687): CP in hundredths the routine spending leaves for a push or a fortification
    the bot decided on (``saving``); 0: no saving (the benchmark)."""
    PACKAGE: ClassVar[bool] = True
    """Item 28: the strike package (``CampaignBot.PACKAGE``); the benchmark keeps it off."""
    SURPLUS: ClassVar[int] = 0
    """Item 28: shots an attack on a defended enemy node brings above its ``need``. 0: ``need``
    already asks one shot per defending unit on top of the pool and ``takes`` the capture charge,
    so the owner's "shots above the charges, the terrain, the toll and a capture charge" holds;
    one more measured weaker (fewer attacks, more losses: #1023)."""
    SQUADS: ClassVar[bool] = True
    """Item 28: the capital and a front stack split off whole squads only (``squad``)."""
    WALK_IN_SPLITS: ClassVar[bool] = True
    """Item 28: with ``SQUADS``, less than a squad still splits off to walk into an empty node
    (a capture without a fight); without it the squads cost the land race (#1023)."""
    COMBINE: ClassVar[bool] = True
    """Item 28: combined attacks of several groups by one ``GroupMove`` (DEC-48), and the
    converging strike of item 12 by one ``GroupMove`` too."""
    ASSAULT: ClassVar[bool] = True
    """Item 28: in the late game a striking personality rallies to the enemy capital and its
    strike reaches one hop farther (the late synchronized assault)."""
    W_TERRAIN: ClassVar[int] = 40
    """Item 28: score per charge the terrain takes from (plains) or adds to (mountains) the pool
    of a defended enemy target (``terrain_value``); ``need`` already counts the charges."""
    W_EXPLOIT: ClassVar[int] = 150
    """Item 28: score of an enemy node next to a node the bot took within ``EXPLOIT_TICKS``: the
    second echelon follows a breakthrough."""
    DEFENSE: ClassVar[bool] = True
    """Item 29 (#1022): the line, the reserve, the answers to strikes at any node, retakes and
    raids of ``gow_bots.bots.defense``; the benchmarks keep it off."""
    HOLD_SHARE: ClassVar[int] = 50
    """Item 29: percent of the units outside the capital guard the line holds at most."""
    SEAL: ClassVar[bool] = True
    """Item 29: a lost node is retaken before any attack (``defense.seal``)."""
    PULL_OUT: ClassVar[bool] = True
    """Item 29: a garrison a visible strike would kill whole leaves (``defense.pull_out``)."""
    UPKEEP: ClassVar[bool] = True
    """Item 30 (#1032): the army floor, the reinforcements with the sum of forces, the beaten
    stacks that recharge, the plans called off (``gow_bots.bots.upkeep``); the benchmarks keep it
    off."""
    FLOOR_PCT: ClassVar[int] = 80
    """Item 30: the army floor in percent of the own start army of the map (``upkeep.floor``)."""
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {
        **_COMMON,
        "radius": ParamRange(2, 3),
        "margin": ParamRange(0, 1),
        "guard": ParamRange(1, 2),
        "reserve": ParamRange(0, 100),
        "recruit_keep": ParamRange(100, 250),
        "w_vp": ParamRange(200, 200),
        "w_neutral": ParamRange(100, 100),
        "w_base": ParamRange(0, 0),
        "w_cut": ParamRange(0, 0),
        "w_closer": ParamRange(0, 0),
        "w_need": ParamRange(2, 2),
        "w_hops": ParamRange(10, 10),
        "w_exposed": ParamRange(0, 0),
        "respond": ParamRange(1, 1),
        "region": ParamRange(0, 0),
        "spill": ParamRange(0, 0),
        "hold_front": ParamRange(0, 0),
        # ``fortify``, ``road_keep``, ``late`` and ``rear_full`` were read only by the play of
        # economy v1 (Defense, road upgrades, the stance, the rear minimum), removed with it
        # (#894). They stay drawn, so the draws of the other keys stay as they were.
        "fortify": ParamRange(0, 0),
        "road_keep": ParamRange(200, 300),
        "late": ParamRange(0, 0),
        "rear_full": ParamRange(2, 3),
        "scouts": ParamRange(1, 1),
    }

    def __init__(
        self,
        mapdef: MapDef,
        rules: Ruleset,
        *,
        seed: int,
        player: int,
        difficulty: str = DEFAULT_DIFFICULTY,
    ) -> None:
        super().__init__(mapdef, rules, seed=seed, player=player)
        if difficulty not in DIFFICULTIES:
            raise ValueError(f"unknown difficulty {difficulty!r}; known: {list(DIFFICULTIES)}")
        self.difficulty = difficulty
        self.tempo = DIFFICULTIES[difficulty]
        rules = self.rules  # the rules of the match (``Bot``)
        self.bucket = Bucket(self.tempo, rules.tick_hz)
        periods = rules.stances.cp_period_ticks
        self.income_unit = math.lcm(periods.economy, periods.balance, periods.war)
        """The common multiple of the CP periods of the stances: ``income`` counts in hundredths
        of CP times it, so every period divides it (integers only)."""
        self.income = 0
        """The own CP income in hundredths times ``income_unit`` from tick 0 to ``income_tick``,
        at the stance in force (item 26, ``cp_had``)."""
        self.income_tick = 0
        self.income_stance: Stance = rules.economy.start_stance
        """The own stance in force since ``income_tick``."""
        self.perception = Perception(self.tempo.react_ticks)
        self.thought: int | None = None
        """The tick of the last decision (item 9)."""
        self.travel = Travel(self.times)
        self.assessor = Assessor(mapdef, rules, player, self.travel)
        self.assessment: Assessment | None = None
        """The assessment of the last decision (tests and the docstring's thresholds)."""
        self.alarm = False
        """The capital is in danger in this decision (module docstring, item 2)."""
        self.danger = False
        """Item 22: the capital is in danger within ``alarm`` plus the build time of
        a road fortification, alarm or not."""
        self.paired: dict[int, int] = {}
        """Own node to the earliest arrival of two or more enemy strikes at it (item 17)."""
        self.left_from: dict[int, int] = {}
        """Own node to the tick a garrison withdrew from it: no walk back into it for
        ``WITHDRAW_TICKS`` (item 14)."""
        self.worry: Worry | None = None
        """An enemy build-up near the own capital in this decision (item 13)."""
        cap = rules.capacity.by_kind
        far, near = self.hops[self.enemy_home], self.hops[self.home]
        cities = [
            n.id
            for n in mapdef.nodes
            if n.kind is not NodeKind.CAPITAL and n.kind is not NodeKind.PROVINCE
        ]
        size = max((cap.of(mapdef.nodes[n].kind) for n in cities), default=0)
        self.centre: int = min(
            (n for n in cities if cap.of(mapdef.nodes[n].kind) == size),
            key=lambda n: (abs(near[n] - far[n]), near[n], self.key(n)),
            default=self.home,
        )
        """The large city whose hops to the two capitals differ least (item 16)."""
        self.hot: list[bool] = [False] * len(mapdef.nodes)
        """Own nodes next to the enemy in this decision: they keep ``hold_front`` units."""
        self.hold: Hold | None = None
        """The CP kept for a chosen plan (item 10)."""
        self.held_at: dict[int, int] = {}
        """Target to the tick of its last hold."""
        self.answered: dict[int, bool] = {}
        self.exposed: dict[int, int] = {}
        self.watched = False
        """An enemy node is near the own capital in this decision (``enemy_near_home``)."""
        self._cut: dict[int, int] = {}
        self._cut_tick = -CUT_REFRESH_TICKS
        count = len(mapdef.nodes)
        self.arrive: dict[int, Arrival] = {}
        """Own node to the shown enemy forces heading into it, in this decision."""
        self.doomed: list[bool] = [False] * count
        """Own nodes about to be lost in this decision (module docstring, item 6)."""
        self.pinned: list[bool] = [False] * count
        """Own nodes whose groups may not leave in this decision (DEC-37, item 8)."""
        self.watch: list[bool] = [False] * count
        """Own nodes a scout keeps in this decision (item 7)."""
        self.scouted: dict[int, int] = {}
        """Node to the tick a scout was split off for it."""
        self.strike: Strike | None = None
        """The converging strike under way (item 12)."""
        self.strike_rest = 0
        """No new strike before this tick."""
        self.strike_sent: dict[int, int] = {}
        """Opaque id of a group sent in a strike to the tick it was sent."""
        self.edge_between: dict[tuple[int, int], int] = {}
        """``(a, b)`` in both orders to the edge between the two nodes."""
        self.enemy_force = EnemyForce(mapdef, player)
        """The estimate of the enemy units (item 18)."""
        self.phase = Phase.OPENING
        self.shots: list[int] = [0] * count
        """Enemy shots estimated by node in this decision (``estimate.strengths``)."""
        self.sectors: list[Sector] = []
        self.weak: dict[int, int] = {}
        """Enemy sector to the shots its pressure is below the mean (``weakness``)."""
        self.spot: int | None = None
        """The weakest enemy sector of this decision (``weak_spot``)."""
        self.threat: list[int] = [0] * count
        """By own front node: enemy shots that can reach it (``estimate.threats``)."""
        self.attacked_at: dict[int, int] = {}
        """Enemy node next to an own node the enemy attacked, to the tick of that attack: its
        garrison left it (item 18, the counterattack)."""
        self.pockets: Pockets | None = None
        """The own pockets of this decision (item 20); ``None`` without one."""
        self.fort_cp = 0
        """CP in hundredths sent on the fortifications of item 22 of nodes other than the capital
        and on the sink fortifications of item 26 (``fort_share_left``)."""
        self.fort_sent: dict[tuple[int, int], int] = {}
        """Own node and road to the tick a fortification of a node other than the capital was
        sent for it (item 22, ``FORT_RETRY``)."""
        self._threats: tuple[PlayerView | None, dict[tuple[int, int], RoadThreat]] = (None, {})
        """The view and the ``road_threats`` of the last decision (item 22)."""
        self.saving_since: int | None = None
        """Item 23: the tick the current saving began; ``None``: not saving."""
        self.bank_rest = 0
        """Item 23: no saving before this tick (a goal waited ``BANK_TICKS`` unpaid)."""
        self.stance_policy = StancePolicy()
        """Item 24: the dwell of the stance policy under ``[stances]``."""
        self.watching = False
        """Item 27: the enemy capital was in sight at the last look (``thinks``)."""
        self.peeked: int | None = None
        """Item 27: the tick of the last look at the enemy capital with an empty bucket."""
        self.owned: list[int | None] = [n.start_owner for n in mapdef.nodes]
        """Item 28: the owner of every node at the last decision (public ownership)."""
        self.breach: dict[int, int] = {}
        """Item 28: an enemy node the bot took to the tick it saw it taken (``EXPLOIT_TICKS``)."""
        self.defense = Defense()
        """Item 29: the memory of the defense (``gow_bots.bots.defense``)."""
        self.deficit = 0
        self.first_recruit = -FIRST_TICKS
        """Item 30: the tick of the last recruit sent before the attacks (``FIRST_TICKS``)."""
        """Item 30: units the army (with the queued recruits) is below its floor in this
        decision (``upkeep.floor``); 0: none."""
        for e, edef in enumerate(mapdef.edges):
            self.edge_between[(edef.a, edef.b)] = e
            self.edge_between[(edef.b, edef.a)] = e

    # Decision -------------------------------------------------------------------------------

    def thinks(self, tick: int) -> bool:
        """Whether the call of ``tick`` decides (the think interval and the APM bucket, item 9);
        otherwise ``decide`` only notes the figures (``gow_sim.match.Glancer``). The refill is
        the one ``decide`` makes: a second one in the same tick adds nothing. With an empty
        bucket a bot that sees the enemy capital still looks at it once a think interval
        (``watching``, item 27)."""
        think = self.tempo.think_ticks
        if self.thought is not None and tick - self.thought < think:
            return False
        self.bucket.refill(tick)
        if self.bucket.ready():
            return True
        return self.watching and (self.peeked is None or tick - self.peeked >= think)

    def glance(self, tick: int, figures: tuple[int, ...]) -> None:
        """A call of ``tick`` that does not decide (``thinks`` is false), with the enemy figure
        ids of its view alone: what ``decide`` would note of it."""
        self.perception.glance(tick, figures)

    @override
    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        self.check_view(view)
        view = self.perception.view(view)  # every call: the first sighting of a figure
        if not self.thinks(tick):
            return []
        if not self.bucket.ready():
            self.peeked = tick
            return self.peek(view, tick)  # item 27: only the open enemy capital
        self.thought = tick
        drawn = self.params
        supplied = self.supplied(view)
        a = self.assessor.assess(view, supplied, guess=GUESS_UNITS, horizon=THREAT_HORIZON)
        self.assessment = a
        threat = a.threat
        self.alarm = (
            threat.danger and threat.eta is not None and threat.eta - tick <= drawn["alarm"]
        )
        self.paired = self._paired(view) if self.answering() and self.PAIRS else {}
        if self.home in self.paired and self.paired[self.home] - tick <= drawn["alarm"]:
            self.alarm = True  # item 17: two strikes at the capital
        lead = drawn["alarm"] + self.rules.fort.build_ticks
        self.danger = self.DEFENSE_V2 and (
            self.alarm or (threat.danger and threat.eta is not None and threat.eta - tick <= lead)
        )
        self.worry = self._worry(view, a) if self.answering() and self.WORRY else None
        self.hot = self._hot(view)
        self.watched = self.enemy_near_home(view)
        self._read_arrivals(view)
        self.watch = self._watch_nodes(view)
        self._estimate(view)
        self._read_breaches(view)
        self.pockets = self.read_pockets(view, tick, supplied)
        read_defense(self, view, self.defense)  # item 29
        self.params = self.adjusted(a)
        self.deficit = max(0, floor(self) - army(view)) if self.upkeep() else 0  # item 30
        try:
            return self._decide(view, tick, a)
        finally:
            self.params = drawn

    def _estimate(self, view: PlayerView) -> None:
        """The phase, the enemy strength by node and sector, the threats and the enemy attacks of
        this decision (item 18; ``gow_bots.bots.estimate``)."""
        total = self.enemy_force.update(view)
        self.phase = phase(view, self.rules, LATE_AWARDS)
        self.shots = strengths(view, self.map, self.neighbors, total, GUESS_UNITS)
        self.sectors = sectors(view, self.neighbors, self.shots)
        self.threat = threats(view, self.neighbors, self.shots)
        self.weak, self.spot = self._weak_spots()
        tick, me = view.tick, view.player
        self.attacked_at = {
            n: t for n, t in sorted(self.attacked_at.items()) if tick - t <= COUNTER_TICKS
        }
        for f in view.fights:
            if f.node is None or f.attacker != 1 - me or view.nodes[f.node].owner != me:
                continue
            for m in self.neighbors[f.node]:
                if view.nodes[m].owner == 1 - me:
                    self.attacked_at[m] = tick

    def read_pockets(self, view: PlayerView, tick: int, main: list[bool]) -> Pockets | None:
        """The own pockets of this decision (item 20): a foreign node is free to pass when the
        estimate of the enemy there is empty and no fight goes on in it."""
        fights = self.fight_nodes(view)

        def free(node: int) -> bool:
            return node not in fights and self.estimate(view, tick, node)[0] == 0

        return read_pockets(view, self.neighbors, main, free)

    def leave_pockets(self, ctx: Ctx, *, charged: bool) -> None:
        """Free groups leave a pocket (item 20) by the shortest chain of free captures into the
        capital's component: each walks to the empty foreign node on it, the nearest one first,
        then ``node_key``; one too big for that way splits off the part that fits. With no free
        way out a group stays: ``W_RESCUE`` sends the army instead.

        ``charged=False``: the discharged groups in a node with an empty warehouse. They never
        recharge in the pocket and fire no shot, so a front node does not keep them
        (``hold_front``); a pinned node and a scout's last unit do. ``charged=True``: the charged
        groups of a node that starves (``starve_in``, DEC-43 item H4) or that carry stranded units
        (``pocket_leaves``), so their charges go back to the army instead of the starvation. The
        discharged pass goes first: the CP of the decision are short (one move per CP).

        Under a capture price (DEC-38, ``capture.charge_cost`` above 0) a group leaves only when
        its charged units pay the capture of the way out after the toll of a visible enemy road
        fortification into it (DEC-43, item D6; ``takes``, #760): a discharged one never can, so
        it walks to a charged group of its pocket instead (``pocket_merge``, #683) or waits for a
        charge, not walking out, bouncing and being sent again.

        A city keeps one unit (``pocket_keep``): an empty one falls to any enemy group for free
        (``capture.charge_cost = 0``) and its VP with it, while every unit standing there costs
        the enemy a shot (DEC-07, rule 3); the rest splits off and leaves."""
        pk = self.pockets
        if pk is None:
            return
        view, me, far = ctx.view, self.player, len(self.map.nodes)
        for g in self.free_groups(ctx):
            here = node_of(g)
            if (
                not pk.pocket[here]
                or pk.exits[here] <= 0
                or not self.pocket_leaves(ctx, g, charged)
            ):
                continue
            left = pk.exits[here]
            hops = self.hops[here]
            ways = sorted(
                (
                    n
                    for n in self.reachable(view, here, far)
                    if view.nodes[n].owner != me and 0 <= pk.exits[n] < left
                ),
                key=lambda n: (pk.exits[n], hops[n], self.key(n)),
            )
            if not ways:
                continue
            dest = ways[0]
            room = view.nodes[dest].capacity - heading(view, ctx.cmds)[dest]  # #754
            fit = self.fit(view, here, dest, g.units)
            size = min(fit, g.units - self.pocket_keep(ctx, g), room)
            # #760: the part that leaves (a split hands it the charged units first, SIM-04) must
            # pay the capture of the way out (DEC-38) after the toll of a fortified road into it
            # (DEC-43, item D6); else it waits for a charge (a merge, the army's rescue).
            payer = min(size, g.charged)
            toll = self.toll_from(view, here, dest, size, payer)
            if size >= 1 and not takes(self.rules, payer, 0, 0, toll):
                if not charged:
                    self.pocket_merge(ctx, g)  # #683: leave with a charged group instead
                continue
            if size == g.units and self.spend(ctx, Move(g.id, dest)):
                ctx.used[g.id] = True
                ctx.claimed[dest] = True
                ctx.standing[here] -= g.units
            elif 1 <= size < g.units and self.spend(ctx, Split(g.id, size)):
                ctx.used[g.id] = True  # the part that leaves goes in the next decision

    def pocket_leaves(self, ctx: Ctx, g: GroupView, charged: bool) -> bool:
        """Whether ``g``, standing in a pocket, is one ``leave_pockets`` sends out in this pass.

        A charged group leaves a node that starves, and one that carries units without a charge
        the empty warehouse never recharges (#683: they leave with it, its charges pay the
        capture for all); not while own units are on the way into its node (a discharged group
        that ``pocket_merge`` sent to leave with it). A front node of a pocket does not keep it
        (#683: held there it starves to a stranded garrison); a pinned node and a scout's last
        unit do."""
        here = node_of(g)
        node = ctx.view.nodes[here]
        if charged:
            stranded = g.units > g.charged and not node.warehouse
            if g.charged <= 0 or not (node.starve_in is not None or stranded):
                return False
            if ctx.incoming[here] > 0 or self.pinned[here]:
                return False
            return not self.watch[here] or ctx.standing[here] - g.units >= 1
        if g.charged > 0 or (node.warehouse or 0) > 0 or self.pinned[here]:
            return False
        return not self.watch[here] or ctx.standing[here] - g.units >= 1

    def pocket_merge(self, ctx: Ctx, g: GroupView) -> None:
        """#683: ``g``, discharged in a pocket and unable to pay the capture of the way out
        (DEC-38), walks to the nearest node of its pocket (over own pocket nodes, ``node_key``
        order) where an own charged group stands free, so they leave as one: the charged units
        pay the capture for all (``pocket_leaves`` waits for it). A city keeps one unit
        (``pocket_keep``): the rest splits off first and walks in the next decision. Nothing when
        no such group or the way does not take the units whole (the stack limit, the room at the
        arrival)."""
        pk = self.pockets
        assert pk is not None
        view, here = ctx.view, node_of(g)
        size = g.units - self.pocket_keep(ctx, g)
        if size < 1:
            return
        charged = [0] * len(view.nodes)
        for other in self.free_groups(ctx):
            if other.id != g.id:
                charged[node_of(other)] += other.charged
        seen = {here: True}
        queue = deque([here])
        while queue:
            node = queue.popleft()
            if node != here and charged[node] > 0:
                if self.fit(view, here, node, size) < size or self.room(ctx, node) < size:
                    return
                if size < g.units:
                    if self.spend(ctx, Split(g.id, size)):
                        ctx.used[g.id] = True
                elif self.spend(ctx, Move(g.id, node)):
                    ctx.used[g.id] = True
                    ctx.standing[here] -= g.units
                return
            for other in self.neighbors[node]:
                if other not in seen and pk.pocket[other]:
                    seen[other] = True
                    queue.append(other)

    def pocket_keep(self, ctx: Ctx, g: GroupView) -> int:
        """Units of ``g`` that stay when it leaves a pocket: 1 in a city (VP above 0) that no
        other own unit holds, else 0 (``leave_pockets``)."""
        here = node_of(g)
        alone = ctx.standing[here] - g.units < 1
        return 1 if alone and self.map.nodes[here].vp > 0 else 0

    def settled(self) -> bool:
        """The territory is split: the midgame or the late game (item 18)."""
        return self.phase is not Phase.OPENING

    def _weak_spots(self) -> tuple[dict[int, int], int | None]:
        """By enemy sector the shots its pressure is below the mean of the sectors (rounded
        down, at least 0), and the weak spot: the sector with the least pressure minus 2 shots
        per VP it is worth, then the one nearer the enemy capital, then ``node_key`` (item 18)."""
        secs = self.sectors
        if not secs:
            return {}, None
        mean = sum(sec.pressure for sec in secs) // len(secs)
        weak = {sec.node: max(0, mean - sec.pressure) for sec in secs}
        far = self.hops[self.enemy_home]
        best: tuple[int, int, int] | None = None
        spot: int | None = None
        for sec in secs:
            if sec.node == self.enemy_home:
                continue
            vp = self.map.nodes[sec.node].vp
            rank = (sec.pressure - 2 * vp, far[sec.node], self.key(sec.node))
            if best is None or rank < best:
                best, spot = rank, sec.node
        return weak, spot

    def weak_spot(self, ctx: Ctx) -> int | None:
        """The weak spot of this decision (``_weak_spots``)."""
        return self.spot

    def weakness(self, dest: int) -> int:
        """Shots enemy sector ``dest`` is below the mean pressure of the sectors (0 if not)."""
        return self.weak.get(dest, 0)

    def front_hold(self, node: int) -> int:
        """Units an own node next to the enemy keeps (``hold_front``, the line of item 29; a hook
        of the turtle)."""
        return max(self.params["hold_front"], self.defense.hold(node))

    def defending(self) -> bool:
        """Item 29 is on: the personality's ``DEFENSE`` with ``insight`` (item 9)."""
        return self.DEFENSE and self.tempo.insight

    def upkeep(self) -> bool:
        """Item 30 is on: the personality's ``UPKEEP`` with ``insight`` (item 9)."""
        return self.UPKEEP and self.tempo.insight

    def thin(self) -> bool:
        """Item 30: the army is below its floor in this decision (``deficit``)."""
        return self.deficit > 0

    def recruit_price(self, ctx: Ctx) -> int:
        """Item 30: the CP in hundredths the routine spending leaves for a recruit while the army
        is below its floor and a city can queue one; 0 otherwise."""
        if not self.thin():
            return 0
        view = ctx.view
        if not any(self.can_queue(view, n.id, self.load(ctx, n.id)) for n in view.nodes):
            return 0
        return self.cost(Recruit(self.home))

    def upkeep_recruit(self, ctx: Ctx) -> bool:
        """Item 30: below the floor a recruit comes after the attacks and before the rallies, the
        merges and the splits, without ``recruit_keep``; whether one was queued."""
        if not self.thin():
            return False
        keep = self.params["recruit_keep"]
        self.params["recruit_keep"] = 0  # ``params`` is this decision's copy (``adjusted``)
        sent = len(ctx.cmds)
        try:
            self._recruit(ctx)
        finally:
            self.params["recruit_keep"] = keep
        return len(ctx.cmds) > sent

    def adjusted(self, a: Assessment) -> dict[str, int]:
        """The drawn parameters with the thresholds of this decision (module docstring, 1);
        without ``insight`` (item 9) only the capital guard of an alarm. With item 22: while the
        capital is in danger and the alarm is not on, ``DANGER_RESERVE_MOVES`` orders
        of CP are kept for it (``defend_capital`` spends them)."""
        p = self._adjusted(a)
        if self.danger and not self.alarm:
            p["reserve"] = max(p["reserve"], DANGER_RESERVE_MOVES * self.rules.orders.cost.move)
        return p

    def _adjusted(self, a: Assessment) -> dict[str, int]:
        p = dict(self.params)
        # No Defense to keep CP for (DEC-41, item 5) and the whole CP quantum goes to CP (item 1):
        # the keeps of the personalities shrink to a move or two.
        move = self.rules.orders.cost.move
        p["reserve"] = min(p["reserve"], move)
        p["recruit_keep"] = min(p["recruit_keep"], V2_RECRUIT_KEEP_MOVES * move)
        if not self.tempo.insight:
            p["scouts"] = 0
            if self.alarm:
                p["guard"] = max(p["guard"], a.threat.units)
            return p
        if a.ahead:
            p["margin"] += p["secure_margin"]
        elif a.awards_left <= p["all_in"]:
            p["guard"] = 0
            p["reserve"] = 0
            p["radius"] += 1
        if a.enemy_cp < self.rules.orders.cost.planned_move:
            p["reserve"] = 0
        if self.watched:
            p["guard"] = max(p["guard"], p["watch_guard"])
        if self.alarm:
            p["guard"] = max(p["guard"], a.threat.units)
            p["reserve"] = 0  # the reserve is for this moment: the walk home
        if self.worry is not None:
            p["scouts"] += 1  # item 13: one more watcher on the way in
            p["reserve"] = 0
        return p

    def enemy_near_home(self, view: PlayerView) -> bool:
        """An enemy node within ``watch`` hops of the own capital (public ownership): only a
        garrison sees what comes (DEC-35), so the capital keeps ``watch_guard`` units."""
        hops = self.hops[self.home]
        watch = self.params["watch"]
        return any(n.owner == 1 - self.player and 0 <= hops[n.id] <= watch for n in view.nodes)

    def _decide(self, view: PlayerView, tick: int, a: Assessment) -> list[Command]:
        self.note_income(tick, view.me.stance)
        ctx = Ctx(view, tick, view.me.cp - self.params["reserve"], standing=self.standing(view))
        for g in view.groups:
            if g.order is not None:
                ctx.claimed[g.order.dest] = True
        self._learn(ctx)
        for cmd in self.fight_commands(view, tick, ctx.budget):  # DEC-24: fights first
            if self.spend(ctx, cmd) and isinstance(cmd, Move):
                ctx.used[cmd.group] = True
        self.punish(ctx)  # item 27: the open enemy capital before everything else
        self.economy_v2(ctx, sink=False)  # factories, plans, the leaf shift (DEC-41, DEC-43)
        self.stance_v2(ctx, a)  # item 24 (DEC-44)
        self.evacuate(ctx)
        self.unbank(ctx)
        plan_cp = self.held_cp(ctx)
        bank = self.strike_cp(ctx) if self.striking() else 0  # item 12: the strike's CP
        ctx.held = max(plan_cp, bank)  # item 10: from here on the spending leaves the plan's CP
        save = self.saving(ctx)  # item 23: a push or a fortification decided on
        ctx.saved = save
        if not self.alarm:
            cmd = self.development(view, ctx.budget)  # DEC-26, item 11: before the orders
            if cmd is not None:
                self.spend(ctx, cmd)
        self._recall(ctx)
        if self.upkeep():
            recall_plans(self, ctx)  # item 30: a gathering plan that would lose units
        held, ctx.held, ctx.saved = ctx.held, 0, 0  # the urgent answers do not wait for the plan
        self.defend_capital(ctx, a)
        self.answer_worry(ctx)
        self.respond(ctx)
        self.withdraw(ctx)
        if self.defending() and self.SEAL:
            seal(self, ctx)  # item 29: a breakthrough is sealed before any attack
        ctx.held = bank  # a banked strike waits only for the capital and the strikes
        saving = save > 0
        if saving:
            self.fortify(ctx)  # item 23: the saving goes to its fortification first
            save = self.unpaid(ctx, save)
        ctx.saved = save
        self.garrison(ctx)
        ctx.saved = max(save, self.recruit_price(ctx))  # item 30: a recruit before a scout
        self.scout(ctx)
        ctx.saved = self.recruit_price(ctx)  # item 30: and before a threat fortification
        if not saving:
            self.fortify(ctx)
        ctx.saved = 0  # item 23: the strike spends what was saved
        ctx.held = 0
        if self.striking():
            self.converge(ctx)
            held = max(plan_cp if self.hold is not None else 0, self.strike_cp(ctx))
        ctx.held = held
        self.leave_pockets(ctx, charged=False)  # item 20
        self.leave_pockets(ctx, charged=True)
        ctx.saved = self.unpaid(ctx, save)
        if ctx.tick - self.first_recruit >= FIRST_TICKS and self.upkeep_recruit(ctx):
            self.first_recruit = ctx.tick  # item 30: below the floor a recruit now and then first
        self._attack(ctx)
        self._combine(ctx)  # item 28: what no single group takes, squads take together
        self.upkeep_recruit(ctx)  # item 30: below the floor, before the rallies and merges
        self._fit_split(ctx)
        self._gather(ctx)
        self._rally(ctx)
        self._recruit(ctx)
        self.bank(ctx)
        self.fort_sink(ctx)  # item 26: the CP the decision left near the cap, last
        return ctx.cmds

    @override
    def spend(self, ctx: Ctx, cmd: Command) -> bool:
        """``CampaignBot.spend`` that also pays one command of the APM bucket (item 9) when the
        command has a CP price; a free one only needs a ready bucket (item 26, #1015)."""
        if not self.bucket.ready():
            return False
        plan = cmd if isinstance(cmd, Move) and cmd.planned else None
        cost = self.cost(cmd)
        if ctx.held and plan is None and cost > ctx.budget - ctx.held:
            return False  # item 10: the CP are for the chosen plan
        short = ctx.saved and cost > 0 and ctx.budget - ctx.saved < cost
        if short and not self.relieves(ctx, cmd):
            return False  # item 23: the CP are saved for a push or a fortification
        if not super().spend(ctx, cmd):
            return False
        if cost > 0:
            self.bucket.take()
        if plan is not None and self.hold is not None and plan.dest == self.hold.dest:
            self.hold = None
            ctx.held = 0
        return True

    # The open enemy capital (item 27) ---------------------------------------------------------

    @override
    def punish(self, ctx: Ctx) -> None:
        """``CampaignBot.punish``; notes whether the enemy capital is in sight (``watching``)."""
        capital = ctx.view.nodes[self.enemy_home]
        self.watching = capital.owner != self.player and capital.detail is not Detail.FOG
        super().punish(ctx)

    def peek(self, view: PlayerView, tick: int) -> list[Command]:
        """A call with an empty APM bucket while the enemy capital is in sight (``thinks``): the
        open enemy capital alone, no other command (item 27)."""
        self._read_arrivals(view)  # the pin of DEC-37 of this tick
        ctx = Ctx(view, tick, view.me.cp - self.params["reserve"], standing=self.standing(view))
        for g in view.groups:
            if g.order is not None:
                ctx.claimed[g.order.dest] = True
        self.punish(ctx)
        return ctx.cmds

    @override
    def may_take(self, ctx: Ctx, g: GroupView) -> bool:
        return not self.pinned[node_of(g)]  # DEC-37: caught on the way out

    @override
    def pay_capital(self, ctx: Ctx, cmd: TakeCommand) -> bool:
        """Past the APM bucket and the CP kept for plans or a push (items 9, 10, 23): the one
        command that wins the match is never short of a hand. It pays a token when there is one."""
        held, saved = ctx.held, ctx.saved
        ctx.held = ctx.saved = 0
        try:
            if not CampaignBot.spend(self, ctx, cmd):
                return False
        finally:
            ctx.held, ctx.saved = held, saved
        if self.cost(cmd) > 0:
            self.bucket.take()
        return True

    # A chosen plan gets its CP (item 10) ------------------------------------------------------

    def held_cp(self, ctx: Ctx) -> int:
        """The CP kept for the hold of an earlier decision; a hold that ran out, whose target is
        taken or whose group is gone ends here."""
        hold = self.hold
        if hold is None:
            return 0
        view = ctx.view
        free = any(g.id == hold.group or node_of(g) == hold.node for g in self.idle_groups(view))
        if ctx.tick >= hold.until or not free or view.nodes[hold.dest].owner == self.player:
            self.hold = None
            return 0
        return hold.cost

    @override
    def short(self, ctx: Ctx, opt: Option, cmd: Move) -> None:
        """A planned attack the CP cannot pay: keep its price for ``wait_plan`` ticks, once per
        target in twice that time (item 10)."""
        wait = self.params["wait_plan"]
        if not cmd.planned or wait <= 0 or not self.tempo.insight or self.hold is not None:
            return
        cost = self.cost(cmd)
        if cost <= ctx.budget:
            return  # the CP are there: the bucket stopped the command, not the price
        last = self.held_at.get(opt.dest)
        if last is not None and ctx.tick - last < 2 * wait:
            return
        self.held_at[opt.dest] = ctx.tick
        self.hold = Hold(opt.dest, opt.group.id, node_of(opt.group), cost, ctx.tick + wait)
        ctx.held = cost

    # CP banking (item 23, #687) -------------------------------------------------------------

    def bank_limit(self) -> int:
        """The most CP in hundredths the bot saves: ``BANK``, at most the cap less two quanta, so
        the saving never holds the CP at the cap (DEC-02: the excess burns)."""
        cp = self.rules.cp
        return max(0, min(self.BANK, cp.cap - 2 * cp.per_period))

    def saving_goal(self, ctx: Ctx) -> int:
        """The price in hundredths of the push or fortification the bot has decided on now: a
        converging strike ready by its forces with the CP of the cap (item 12) and none under
        way, or the road fortification ``fort_road_site`` finds with its ``FORT_KEEP``; the
        dearer of the two; 0: none."""
        goal = 0
        strike = self.striking() and self.strike is None and ctx.tick >= self.strike_rest
        if strike and self.strike_wanted(ctx):
            plan = self.strike_plan(ctx, self.rules.cp.cap)
            if plan is not None and plan.ready and len(plan.picks) >= self.STRIKE_MIN:
                goal = plan.cost
        if self.fort_road_site(ctx) is not None:
            goal = max(goal, self.rules.fort.cost + self.FORT_KEEP)
        return goal

    def saving(self, ctx: Ctx) -> int:
        """The CP the routine spending of this decision leaves (item 23): the price of the goal
        (``saving_goal``) up to ``bank_limit``. Nothing without ``insight``, with the CP at the cap
        less one quantum (spend rather than burn), or before ``bank_rest``; a goal that waited
        more than ``BANK_TICKS`` unpaid stops the saving for ``BANK_TICKS``."""
        limit = self.bank_limit()
        if limit <= 0 or not self.tempo.insight:
            return 0
        tick = ctx.tick
        goal = 0 if tick < self.bank_rest else self.saving_goal(ctx)
        if goal <= 0:
            self.saving_since = None
            return 0
        if self.saving_since is None:
            self.saving_since = tick
        elif tick - self.saving_since > BANK_TICKS:
            self.saving_since = None
            self.bank_rest = tick + BANK_TICKS
            return 0
        cp = self.rules.cp
        if ctx.view.me.cp >= cp.cap - cp.per_period:
            return 0
        return min(goal, limit)

    def relieves(self, ctx: Ctx, cmd: Command) -> bool:
        """Item 23: ``cmd`` moves a group out of an own node that is over its capacity at the
        arrivals (``load``): the saving never keeps units where they die (DEC-12, #686)."""
        if not isinstance(cmd, Move):
            return False
        g = ctx.groups.get(cmd.group)
        if g is None or not isinstance(g.location, AtNode):
            return False
        node = g.location.node
        n = ctx.view.nodes[node]
        return n.owner == self.player and node != cmd.dest and self.load(ctx, node) > n.capacity

    def unpaid(self, ctx: Ctx, save: int) -> int:
        """What the saving ``save`` of this decision still keeps once the commands before have
        paid their part of the goal (``saving_goal`` anew); 0 without a saving."""
        if save <= 0:
            return 0
        return min(save, self.saving_goal(ctx))

    # A converging strike (item 12) ----------------------------------------------------------

    def striking(self) -> bool:
        """Converging strikes instead of single attacks on the enemy capital: the personality's
        ``STRIKE`` with ``insight`` (item 9: a bot without it does not plan ahead)."""
        return self.STRIKE and self.tempo.insight

    def strike_wanted(self, ctx: Ctx) -> bool:
        """Whether a strike may be planned now (a hook of the personalities)."""
        return True

    def strike_margin(self) -> int:
        """Shots a strike brings above the estimate: ``strike_margin`` of ``PARAMS`` if drawn,
        else ``STRIKE_MARGIN``; nothing extra in the last ``all_in`` awards when not ahead."""
        a = self.assessment
        if a is not None and not a.ahead and a.awards_left <= self.params["all_in"]:
            return 0
        return self.params.get("strike_margin", self.STRIKE_MARGIN)

    def strike_need(self, ctx: Ctx) -> int:
        """Shots a strike on the enemy capital needs, plus ``strike_margin``. Numbers the view
        shows (an exact sighting, the top of a range, a fresh memory) give ``need`` without the
        ``margin`` of single attacks; without them (the capital is in the mountains and seen from
        the plains as presence only, DEC-21) a garrison of ``strike_guess`` units, all charged
        (``PARAMS``; ``GUESS_UNITS`` if the personality draws none)."""
        view, target = ctx.view, self.enemy_home
        seen = view.nodes[target].seen
        known = self.memory.get(target)
        fresh = known is not None and ctx.tick - known[0] <= STALE_TICKS
        if fresh or (seen is not None and self.enemy_at(view, target) is not None):
            need = self.need(view, ctx.tick, target)
            base = need - self.params["margin"]
            if need > 0:  # the toll of a fortified road on top (DEC-43, item D6; not in ``need``)
                base += self.toll_ahead(view, target, base - self.extra.get(target, 0))
        else:
            start = self.map.nodes[target]
            units = self.params.get("strike_guess", GUESS_UNITS)
            base = shots_to_take(self.rules, start.terrain, units, units)
        return base + self.strike_margin()

    def way(self, view: PlayerView, start: int, dest: int, size: int) -> tuple[int, int] | None:
        """``(edges, ticks)`` of the path a ``Move`` of a group of ``size`` units takes from
        ``start`` to ``dest`` (``Bot.ways``: SIM-05, DEC-20, D, the travel times of the terrain);
        ``None``: none."""
        found = self.ways(view, start, size).get(dest)
        return None if found is None or dest == start else (found.hops, found.ticks)

    def strike_plan(self, ctx: Ctx, budget: int) -> StrikePlan | None:
        """The converging strike on the enemy capital the free groups could make now with
        ``budget`` CP in hundredths (item 12); ``None``: no group can go."""
        view, rules, target = ctx.view, self.rules, self.enemy_home
        if view.nodes[target].owner == self.player:
            return None
        cost = rules.orders.cost
        reach = self.strike_hops()
        found: list[tuple[GroupView, int, int, int]] = []
        for g in self.free_groups(ctx):
            here = node_of(g)
            if g.charged == 0 or self.hops[here][target] > reach or self.pinned[here]:
                continue
            if here == self.home and ctx.standing[here] - g.units < self.params["guard"]:
                continue
            path = self.way(view, here, target, g.units)
            if path is None or path[0] > reach:
                continue
            found.append((g, here, path[0], path[1]))
        if not found:
            return None
        need = self.strike_need(ctx)
        # The groups next to the target first (a plan of one edge brings 1), the most charged
        # first, then the farther ones: each is planned when ``plan_strike`` says so for the
        # shots the groups before it leave missing, else ordinary, while the CP last.
        found.sort(key=lambda c: (c[2], -c[0].charged, self.group_order(c[0])))
        spent = pool = 0
        chosen: list[Pick] = []
        plans: dict[int, bool] = {}  # #899: one gathering plan per node (``Bot.plan_clash``)
        for g, here, edges, ticks in found:
            # a plan asks for what is missing only (DEC-41, item 10)
            bonus = min(self.plan_bonus(view, here, g.charged), need - pool)
            plan = (
                bonus >= 1
                and need - pool > 0
                and spent + cost.planned_move <= budget
                and not plans.get(here)
                and not ctx.planned.get(here)
                and not self.plans_in(view, here)
                and self.plan_strike(g, need - pool, edges, bonus)
            )
            if plan:
                plans[here] = True
            price = cost.planned_move if plan else cost.move
            if spent + price > budget:
                continue
            spent += price
            pool += g.charged + (bonus if plan else 0)
            lead = ticks + (self.plan_lead(bonus) if plan else 0)
            chosen.append(Pick(g.id, here, g.units, g.charged, plan, lead, bonus if plan else 0))
        return StrikePlan(pool, need, spent, tuple(chosen))

    def strike_hops(self) -> int:
        """The farthest group of a strike in edges: ``STRIKE_HOPS``, one more in the late game
        with ``ASSAULT`` (item 28: the army that rallied to the enemy capital goes together)."""
        return self.STRIKE_HOPS + (1 if self.ASSAULT and self.phase is Phase.LATE else 0)

    def plan_strike(self, g: GroupView, missing: int, edges: int, bonus: int = 0) -> bool:
        """Whether group ``g`` of a strike goes by a scheduled order: every group that can gather
        a ``bonus`` does (DEC-41, item 10): the strike is short (``missing`` shots), and its
        arrival waits for the slowest group anyway. ``edges``: the edges of its path."""
        del g, missing, edges
        return bonus >= 1

    def strike_cp(self, ctx: Ctx) -> int:
        """The CP kept for the strike: the orders of a strike under way not sent yet, or the price
        of a strike that is ready with the CP of the cap (it is banked until paid, item 12)."""
        s = self.strike
        cost = self.rules.orders.cost
        if s is not None:
            return sum(cost.planned_move if p.planned else cost.move for p in s.picks)
        if not self.STRIKE_BANK or ctx.tick < self.strike_rest or not self.strike_wanted(ctx):
            return 0
        plan = self.strike_plan(ctx, self.rules.cp.cap)
        if plan is None or not plan.ready or len(plan.picks) < self.STRIKE_MIN:
            return 0
        return plan.cost

    def converge(self, ctx: Ctx) -> None:
        """Plan a ready strike, then send the groups whose time has come (item 12)."""
        tick = ctx.tick
        self.strike_sent = {
            g: t for g, t in sorted(self.strike_sent.items()) if tick - t <= STRIKE_TICKS
        }
        s = self.strike
        if s is None:
            if tick < self.strike_rest or not self.strike_wanted(ctx):
                return
            full = self.strike_plan(ctx, self.rules.cp.cap)
            if full is None or not full.ready:
                return
            if full.cost > ctx.budget and self.bank_limit() <= 0:
                return  # banked (``strike_cp``) or not paid
            # Item 23: a saving personality goes with the part the CP pay once it is ready.
            plan = self.strike_plan(ctx, ctx.budget)
            if plan is None or not plan.ready or len(plan.picks) < self.STRIKE_MIN:
                return
            arrive = tick + 1 + max(p.lead for p in plan.picks)
            s = Strike(self.enemy_home, arrive, list(plan.picks), arrive + STRIKE_TICKS)
            self.strike = s
            self.saving_since = None
        ctx.claimed[s.target] = True
        free = {g.id: g for g in self.free_groups(ctx)}
        if self.combining():
            self._strike_together(ctx, s, free)
            return
        left: list[Pick] = []
        for p in s.picks:
            g = free.get(p.group)
            if g is None:
                continue  # gone, in a fight or busy: the others go on
            if tick + 1 + p.lead < s.arrive - STRIKE_ALIGN:
                left.append(p)
                continue
            if self.spend(ctx, self.order(p.group, s.target, p.planned, p.bonus)):
                ctx.used[p.group] = True
                ctx.standing[p.node] -= g.units
                self.strike_sent[p.group] = tick
            else:
                left.append(p)
        s.picks = left
        if not left or tick > s.until:
            self.strike = None
            self.strike_rest = tick + STRIKE_REST

    def _strike_together(self, ctx: Ctx, s: Strike, free: Mapping[int, GroupView]) -> None:
        """Item 28: the picks of the strike ``s`` go by one ``GroupMove`` (DEC-48): the server
        times every departure for one arrival, so no ``STRIKE_ALIGN`` timing and no drip. Planned
        when a pick gathers a bonus, the request the sum of theirs; a planned order takes one
        group of a node (the bonus of two groups of one node gathers in the order of their
        internal ids, #899). Unpaid, the strike waits for the CP until ``Strike.until``."""
        tick = ctx.tick
        picks = [p for p in s.picks if p.group in free]
        planned = any(p.planned for p in picks)
        if planned:
            one: dict[int, Pick] = {}
            for p in picks:
                if p.node not in one or (p.planned and not one[p.node].planned):
                    one[p.node] = p
            picks = [one[n] for n in sorted(one, key=self.key)]
        picks.sort(key=lambda p: (-p.bonus, self.key(p.node), -p.units, -p.charged))
        picks = picks[: self.group_cap()]
        bonus = sum(p.bonus for p in picks) if planned else 0
        sent = len(picks) >= self.STRIKE_MIN and self._group_attack(
            ctx, [free[p.group] for p in picks], s.target, planned and bonus >= 1, bonus
        )
        if sent or not picks or tick > s.until:
            self.strike = None
            self.strike_rest = tick + STRIKE_REST

    def group_cap(self) -> int:
        """Groups in one ``GroupMove`` at most (``group_order.max_groups``; 1 without it)."""
        order = self.rules.group_order
        return 1 if order is None else order.max_groups

    def _group_attack(
        self, ctx: Ctx, groups: list[GroupView], dest: int, planned: bool, bonus: int
    ) -> bool:
        """Send one synchronized attack of ``groups`` on ``dest`` (DEC-48, item C) and book it:
        the groups are used and committed (not recalled one by one, item 12), the target claimed
        and judged as a wave (``_learn``)."""
        cmd = GroupMove(tuple(g.id for g in groups), dest, planned, bonus if planned else 0)
        if not self.spend(ctx, cmd):
            return False
        tick = ctx.tick
        for g in groups:
            here = node_of(g)
            ctx.used[g.id] = True
            ctx.standing[here] -= g.units
            self.strike_sent[g.id] = tick
            if planned:
                ctx.planned[here] = True
        ctx.claimed[dest] = True
        estimate = self.estimate(ctx.view, tick, dest)
        self.waves[dest] = Wave(tick, sum(g.charged for g in groups), estimate)
        return True

    # A combined attack, squads, the second echelon (item 28) --------------------------------

    def combining(self) -> bool:
        """Item 28 is on: ``COMBINE`` with ``insight`` (item 9) under ``[group_order]``."""
        return self.COMBINE and self.tempo.insight and self.rules.group_order is not None

    def _combine(self, ctx: Ctx) -> None:
        """One combined attack a decision (item 28): the free groups that reach a defended enemy
        node within ``radius`` (one per node, the most charged) and take it together with the
        strike package (``need``, ``SURPLUS``, the capture charge, the toll of each road in, the
        bonus each can gather) while none of them was sent alone, the nearest first, as few as
        it takes (the rest is the second echelon), at most ``group_order.max_groups`` and what
        the CP pay; the best such target by ``score``. One ``GroupMove``, planned with the sum of
        the bonuses when the target is defended and no member's node gathers another plan."""
        if not self.combining():
            return
        view, rules = ctx.view, self.rules
        move = max(1, rules.orders.cost.move)
        afford = min(self.group_cap(), (ctx.budget - max(ctx.held, ctx.saved)) // move)
        if afford < 2:
            return
        by_node: dict[int, GroupView] = {}
        for g in self.free_groups(ctx):
            if g.charged < 1 or not self.may_leave(ctx, g):
                continue
            here = node_of(g)
            best = by_node.get(here)
            if best is None or (g.charged, g.units) > (best.charged, best.units):
                by_node[here] = g
        if len(by_node) < 2:
            return
        radius = self.params["radius"]
        enemy = 1 - self.player
        found: dict[int, list[tuple[int, int, int, GroupView]]] = {}
        for here in sorted(by_node, key=self.key):
            g = by_node[here]
            ways = self.ways(view, here, g.units)
            for dest in self.reachable(view, here, radius, g.units):
                if dest in ctx.claimed or view.nodes[dest].owner != enemy:
                    continue
                if not self.defended(view, ctx.tick, dest):
                    continue
                real = g.charged - self.toll_from(view, here, dest, g.units, g.charged)
                if real <= 0:
                    continue
                gathers = ctx.planned.get(here) or self.plans_in(view, here, g.id)
                bonus = 0 if gathers else min(self.plan_bonus(view, here, g.charged), real)
                found.setdefault(dest, []).append((ways[dest].ticks, real, bonus, g))
        cost = rules.capture.charge_cost
        best_attack: tuple[int, int, list[GroupView], int] | None = None
        for dest in sorted(found, key=self.key):
            cands = found[dest]
            if len(cands) < 2:
                continue
            cands.sort(key=lambda c: (c[0], -c[1], self.group_order(c[3])))
            need = self.need(view, ctx.tick, dest) + self.SURPLUS + cost
            chosen: list[tuple[int, int, int, GroupView]] = []
            real = bonus = 0
            for c in cands[:afford]:
                chosen.append(c)
                real, bonus = real + c[1], bonus + c[2]
                if real >= cost and real + min(bonus, real) >= need:
                    break
            else:
                continue  # not enough together
            if len(chosen) < 2:
                continue  # one group alone: a single attack (``_attack``)
            if self.DISCIPLINE and self.recall_holds(ctx.tick, dest, real + bonus):
                continue
            first = chosen[0][3]
            army = self.fake_group(
                first, sum(c[3].units for c in chosen), sum(c[3].charged for c in chosen)
            )
            score = self.score(ctx, army, dest, need)
            if score is None:
                continue
            if best_attack is None or score > best_attack[0]:
                groups = [c[3] for c in sorted(chosen, key=lambda c: (-c[2], c[0]))]
                best_attack = (score, dest, groups, bonus)
        if best_attack is None:
            return
        _, dest, groups, bonus = best_attack
        self._group_attack(ctx, groups, dest, bonus >= 1, bonus)

    def squads(self) -> bool:
        """Item 28: the army moves in squads: ``SQUADS`` on a settled map (item 18); the opening
        keeps its quick splits, the land race is won by walk-ins."""
        return self.SQUADS and self.settled()

    def squad(self) -> int:
        """Units of a squad (item 28): the capacity of a province (DEC-22), the biggest group
        every road of the map lets through (the stack limit, DEC-20, D); 2 without ``squads``
        (the old smallest split)."""
        if not self.squads():
            return 2
        return max(2, self.rules.capacity.by_kind.of(NodeKind.PROVINCE))

    @override
    def min_split(self, ctx: Ctx, dest: int) -> int:
        """Item 28: a split off a stack (an army that fits a path to ``dest``, a part that fits
        the room of a rally) is a whole squad, unless the army walks into an empty node (a
        capture without a fight: the land race is won by walk-ins)."""
        if not self.squads():
            return 1
        foreign = ctx.view.nodes[dest].owner != self.player
        if self.WALK_IN_SPLITS and foreign and not self.defended(ctx.view, ctx.tick, dest):
            return 1
        return self.squad()

    def _read_breaches(self, view: PlayerView) -> None:
        """Item 28: the enemy nodes the bot took since its last decision (public ownership) open
        a breach for ``EXPLOIT_TICKS``."""
        tick, me = view.tick, self.player
        for n in view.nodes:
            if n.owner == me and self.owned[n.id] == 1 - me:
                self.breach[n.id] = tick
            self.owned[n.id] = n.owner
        self.breach = {
            n: t
            for n, t in sorted(self.breach.items())
            if tick - t <= EXPLOIT_TICKS and view.nodes[n].owner == me
        }

    def terrain_value(self, ctx: Ctx, dest: int) -> int:
        """Item 28 (the owner, 2026-11-12: his breakthroughs come on the plains): ``W_TERRAIN``
        per charge the terrain takes from a defended enemy node's pool (DEC-45: the plains burn
        one in the first round), less per charge it adds (the mountains); 0 for a walk-in, where
        the terrain does not act (DEC-07, rule 1)."""
        if not self.W_TERRAIN or not self.defended(ctx.view, ctx.tick, dest):
            return 0
        if self.estimate(ctx.view, ctx.tick, dest)[1] <= 0:
            return 0  # no firing charge: no terrain modifier
        mod = self.rules.terrain.defense_mod.of(self.map.nodes[dest].terrain)
        return -self.W_TERRAIN * mod

    def exploit(self, view: PlayerView, dest: int) -> int:
        """Item 28: ``W_EXPLOIT`` for an enemy node next to a breach (the second echelon goes
        through the hole: the nodes behind it, the supply it cut); 0 otherwise."""
        if not self.W_EXPLOIT or view.nodes[dest].owner != 1 - self.player:
            return 0
        return self.W_EXPLOIT if any(m in self.breach for m in self.neighbors[dest]) else 0

    @override
    def committed(self, group: int) -> bool:
        return group in self.strike_sent

    @override
    def coming(self, view: PlayerView, fight: FightView) -> int:
        """The charges and plan bonuses of the own strike groups still walking into the node of
        ``fight`` (item 12): the first arrivals stay in the fight for the rest."""
        if not self.striking() or fight.node is None:
            return 0
        busy = self.fighting(view)
        shots = 0
        for g in view.groups:
            o = g.order
            sent = o is not None and o.dest == fight.node and g.id in self.strike_sent
            if sent and o is not None and g.id not in busy:
                shots += g.charged + o.bonus
        s = self.strike
        if s is not None and s.target == fight.node:
            shots += sum(p.charged + p.bonus for p in s.picks)
        return shots

    # The answers to a staging strike (items 13-17, #624) ------------------------------------

    def answering(self) -> bool:
        """Items 13-17 are on: the personality's ``ANSWERS`` with ``insight`` (item 9)."""
        return self.ANSWERS and self.tempo.insight

    def _paired(self, view: PlayerView) -> dict[int, int]:
        """Own nodes two or more enemy strikes (planned intents, DEC-08) are aimed at, with the
        earliest arrival (item 17)."""
        count: dict[int, int] = {}
        first: dict[int, int] = {}
        for i in self.strikes_at(view):
            assert i.target is not None
            count[i.target] = count.get(i.target, 0) + 1
            when = self.arrival(i)
            first[i.target] = min(first.get(i.target, when), when)
        return {n: first[n] for n in sorted(count) if count[n] >= 2}

    def strikes_at(self, view: PlayerView) -> list[IntentView]:
        return [
            i
            for i in view.intents
            if i.owner != self.player
            and i.target is not None
            and view.nodes[i.target].owner == self.player
        ]

    def hidden_shots(self, view: PlayerView, a: Assessment) -> int:
        """An upper bound of the enemy shots the fog may hide near the own capital (item 13).

        CP regeneration is public, only the stance is hidden (DEC-02), so the bound of the enemy
        CP (``EnemyCp``: the largest CP share since the start, minus every visible payment)
        grows with every quiet period. Each two CP of it can send a scheduled strike of a
        guessed group (``GUESS_UNITS``) with a bonus of two (DEC-29), at most two of them (the CP
        cap pays two plans); a built enemy barracks in a city next to the capital (DEC-31) adds a
        guessed group recruited there. Only while an enemy node stands within two hops of the
        capital (a build-up needs one). ``ANXIETY`` percent of it counts."""
        near = self.hops[self.home]
        enemy = 1 - self.player
        staging = [n for n in view.nodes if n.owner == enemy and 0 < near[n.id] <= 2]
        if not staging:
            return 0
        plans = min(2, a.enemy_cp // self.rules.orders.cost.planned_move)
        shots = plans * (GUESS_UNITS + 2)
        if any(n.has_barracks and near[n.id] == 1 for n in staging):
            shots += GUESS_UNITS
        return shots * self.ANXIETY // 100

    def _worry(self, view: PlayerView, a: Assessment) -> Worry | None:
        """Item 13: the enemy shots seen within two hops of the own capital (fresh sightings in
        nodes, figures heading into a node next to it) plus ``hidden_shots`` reach the shots that
        take the capital now; at least ``WORRY_SEEN`` of them must be seen (the fog alone does not
        worry)."""
        home = self.home
        if view.nodes[home].owner != self.player:
            return None
        near = self.hops[home]
        seen_shots = 0
        best: tuple[int, int] | None = None
        stage: int | None = None
        for n in view.nodes:
            sighting = n.seen
            if not 0 < near[n.id] <= 2 or sighting is None or not sighting.enemy_modes:
                continue
            if view.tick - sighting.tick > FRESH_TICKS:
                continue
            numbers = self.enemy_at(view, n.id)
            shots = GUESS_UNITS if numbers is None else numbers[1]
            seen_shots += shots
            rank = (-shots, self.key(n.id))
            if near[n.id] == 1 and n.owner != self.player and (best is None or rank < best):
                best, stage = rank, n.id
        for e in view.edges:
            edef = self.map.edges[e.id]
            for f in e.enemy_groups:
                head = edef.b if f.toward_b else edef.a
                if near[head] <= 1:
                    seen_shots += _figure_shots(f)
        if seen_shots < WORRY_SEEN:
            return None
        units = charged = 0
        for g in view.groups:
            if g.location == AtNode(home):
                units += g.units
                charged += g.charged
        terrain = self.map.nodes[home].terrain
        burned = terrain_burned(self.rules, view, home)
        hold = shots_to_take(self.rules, terrain, units, charged, burned=burned)
        shots = seen_shots + self.hidden_shots(view, a)
        if shots < hold:
            return None
        return Worry(shots, hold, stage)

    def answer_worry(self, ctx: Ctx) -> None:
        """Item 13: the free charged groups that can walk home within ``alarm`` ticks come home
        (nearest first) until the capital holds the worry, and the capital recruits."""
        w = self.worry
        view, home = ctx.view, self.home
        if w is None or self.alarm or home in self.fight_nodes(view):
            return
        missing = w.shots - w.hold + 1
        to_home = [row[home] for row in self.travel.ticks]
        far = len(self.map.nodes)
        groups = sorted(
            (g for g in self.free_groups(ctx) if node_of(g) != home and g.charged > 0),
            key=lambda g: (to_home[node_of(g)], self.group_order(g)),
        )
        for g in groups:
            here = node_of(g)
            if missing <= 0 or to_home[here] < 0 or to_home[here] > self.params["alarm"]:
                break
            if not self.may_leave(ctx, g) or home not in self.reachable(view, here, far, g.units):
                continue
            if g.units > self.room(ctx, home):
                continue  # #686: the capital would be over capacity
            if self.spend(ctx, Move(g.id, home)):
                ctx.used[g.id] = True
                ctx.standing[here] -= g.units
                missing -= g.charged
        if self.can_queue(view, home, self.load(ctx, home)) and self.spend(ctx, Recruit(home)):
            self.recruited[home] = ctx.tick
            ctx.standing[home] += 1

    def enemy_shots_near(self, view: PlayerView, node: int) -> int:
        """The most shots of one visible enemy force next to own ``node``: a fresh sighting in a
        neighbour, or a figure on an incident edge heading into ``node``
        (item 14). Only numbers the view shows count: a force hidden by the fog is not a reason
        to give a node up."""
        best = 0
        for m in self.neighbors[node]:
            sighting = view.nodes[m].seen
            if sighting is None or not sighting.enemy_modes:
                continue
            if view.tick - sighting.tick > FRESH_TICKS:
                continue
            numbers = self.enemy_at(view, m)
            if numbers is not None:
                best = max(best, numbers[1])
        for e in self.incident[node]:
            edef = self.map.edges[e]
            for f in view.edges[e].enemy_groups:
                shown = f.detail is not Detail.PRESENCE
                if shown and (edef.b if f.toward_b else edef.a) == node:
                    best = max(best, _figure_shots(f))
        return best

    def withdraw(self, ctx: Ctx) -> None:
        """Item 14 (playtest B2): the groups of an own node (not the capital, not in a fight, not
        pinned by DEC-37) whose pool is ``WITHDRAW_GAP`` or more below a visible enemy force next
        to it that would take the node leave for the own neighbour farthest from the enemy (the
        least threatened, then the most own units, then ``node_key``): a unit kept is worth more
        than the node (1 CP an order against 1 CP and a walk a recruit)."""
        if not self.answering() or not self.WITHDRAW:
            return
        view = ctx.view
        fights = self.fight_nodes(view)
        by_node: dict[int, list[GroupView]] = {}
        for g in self.free_groups(ctx):
            by_node.setdefault(node_of(g), []).append(g)
        for node in sorted(by_node, key=self.key):
            if node == self.home or node in fights or self.pinned[node]:
                continue
            if self._is_city(node):
                continue  # a city is worth its VP and its warehouse: it is held, not given up
            enemy = self.enemy_shots_near(view, node)
            if enemy <= 0:
                continue
            groups = by_node[node]
            units = sum(g.units for g in groups)
            charged = sum(g.charged for g in groups)
            terrain = self.map.nodes[node].terrain
            pool = defender_pool(self.rules, terrain, charged)
            if enemy - pool < self.WITHDRAW_GAP or enemy < pool + units:
                continue
            for g in groups:
                exits = [
                    m
                    for m in self.neighbors[node]
                    if view.nodes[m].owner == self.player
                    and m not in fights
                    and self.room(ctx, m) >= g.units
                ]
                if not exits:
                    continue
                exits = [
                    m
                    for m in exits
                    if self.left_from.get(m, -WITHDRAW_TICKS) < ctx.tick - WITHDRAW_TICKS
                ]
                if not exits:
                    continue
                dest = min(
                    exits,
                    key=lambda m: (self.enemy_shots_near(view, m), -ctx.standing[m], self.key(m)),
                )
                if self.enemy_shots_near(view, dest) >= enemy:
                    continue  # no safer place next door
                if self.spend(ctx, Move(g.id, dest)):
                    ctx.used[g.id] = True
                    ctx.standing[node] -= g.units
                    self.left_from[node] = ctx.tick

    @override
    def wanted_barracks(self, view: PlayerView) -> int | None:
        """Item 16 (playtest B4): with the answers, the one forward barracks goes to the centre
        (the large city between the capitals) once it is held and not next to the enemy."""
        if not self.answering() or not self.CENTRE_BARRACKS:
            return super().wanted_barracks(view)
        centre = self.centre
        if centre == self.home or centre in self.barracks_lost:
            return None  # #683: no rebuild where one was lost
        n = view.nodes[centre]
        if n.owner != self.player or n.has_barracks or n.building is not None:
            return None
        if self.hot[centre] or self.doomed[centre] or centre in self.fight_nodes(view):
            return None
        return centre

    # Stance ---------------------------------------------------------------------------------

    def stance_v2(self, ctx: Ctx, a: Assessment) -> None:
        """Item 24: the stance of the policy (``gow_bots.bots.stance``, DEC-44), at most one
        change per ``stance_dwell`` ticks."""
        view = ctx.view
        pressed = self.danger or self.alarm or bool(self.strikes_at(view))
        full = factories_full(self.rules, view, self.home)
        inputs = StanceInputs(self.phase, a.cp, a.own, pressed, view.me.stance, full)
        want = wanted_stance(self.rules, self.params, inputs, insight=self.tempo.insight)
        dwell = self.params["stance_dwell"]
        cmd = self.stance_policy.command(view.me.stance, want, ctx.tick, dwell)
        if cmd is not None and self.spend(ctx, cmd):
            self.stance_policy.sent(ctx.tick)
            self.note_income(ctx.tick + 1, cmd.stance)  # applied at the start of the next tick

    # The capital ----------------------------------------------------------------------------

    def defend_capital(self, ctx: Ctx, a: Assessment) -> None:
        """Module docstring, item 2: the groups that arrive in time, a recruit; with
        ``DEFENSE_V2`` item 22 (``defend_capital_v2``)."""
        if self.DEFENSE_V2:
            self.defend_capital_v2(ctx, a)
            return
        if not self.alarm or a.threat.eta is None:
            return
        view, home = ctx.view, self.home
        if view.nodes[home].owner != self.player or home in self.fight_nodes(view):
            return
        missing = a.threat.units - a.threat.need + 1
        to_home = [row[home] for row in self.travel.ticks]
        far = len(self.map.nodes)
        for g in self.free_groups(ctx):
            here = node_of(g)
            if missing <= 0:
                break
            if here == home or g.charged == 0 or ctx.tick + to_home[here] > a.threat.eta:
                continue
            if self.pinned[here]:
                continue  # DEC-37: it would be caught on the way out
            if home not in self.reachable(view, here, far, g.units):
                continue
            if self.spend(ctx, Move(g.id, home)):
                ctx.used[g.id] = True
                ctx.standing[here] -= g.units
                missing -= g.charged
        if self.can_queue(view, home, self.load(ctx, home)) and self.spend(ctx, Recruit(home)):
            self.recruited[home] = ctx.tick
            ctx.standing[home] += 1

    def defend_capital_v2(self, ctx: Ctx, a: Assessment) -> None:
        """Item 22 (#682): the alarm walks home every free group that can join the fight at the
        capital (``walk_home``); alarm or not, the roads into the capital that a visible enemy
        force comes by are fortified (``fortify_capital``); then the alarm fills the capital's
        recruit queue (``recruit_burst``) with the CP left. The line comes before the recruits
        (#1015): 1.5 CP of it take a charge per started 3 attacking units (DEC-43, item D6), more
        than the units the same CP queue; until #1015 the CP sink of ``fort_site`` bought it first
        at the cap. The CP kept by ``DANGER_RESERVE_MOVES`` are spent here."""
        view, home = ctx.view, self.home
        if view.nodes[home].owner != self.player or home in self.fight_nodes(view):
            return
        reserve = self.params["reserve"]
        ctx.budget += reserve
        eta = a.threat.eta if self.alarm else None
        try:
            if eta is not None:
                self.walk_home(ctx, eta, a.threat.units - a.threat.need + 1, a)
            self.fortify_capital(ctx)
            if eta is not None:
                self.recruit_burst(ctx)
        finally:
            ctx.budget = max(0, ctx.budget - reserve)

    def walk_home(self, ctx: Ctx, eta: int, missing: int, a: Assessment) -> None:
        """The free groups that reach the capital (over own nodes, not pinned by DEC-37) while its
        fight can still go on walk home, nearest first, until they bring ``missing`` shots. A
        fight takes a round per shot (DEC-24, one shot a side a round), so a capital that needs
        ``need`` shots holds about ``need`` rounds after ``eta`` and a group arriving within them
        joins its fight (DEC-24, D1). A discharged unit counts when the capital warehouse has a
        charge for it beyond the discharged units standing there (recharging, 1 per tick)."""
        view, home = ctx.view, self.home
        combat = self.rules.combat
        holds = combat.round_ticks * max(1, a.threat.need) // max(1, combat.shots_per_round)
        stock = view.nodes[home].warehouse or 0
        for g in view.groups:
            if g.location == AtNode(home):
                stock -= g.units - g.charged
        stock = max(0, stock)
        to_home = [row[home] for row in self.travel.ticks]
        far = len(self.map.nodes)
        groups = sorted(
            (g for g in self.free_groups(ctx) if node_of(g) != home),
            key=lambda g: (to_home[node_of(g)], self.group_order(g)),
        )
        for g in groups:
            if missing <= 0:
                break
            here = node_of(g)
            if to_home[here] < 0 or ctx.tick + to_home[here] > eta + holds:
                continue
            if self.pinned[here]:
                continue  # DEC-37: it would be caught on the way out
            refill = min(g.units - g.charged, stock)
            if g.charged + refill <= 0:
                continue
            if home not in self.reachable(view, here, far, g.units):
                continue
            if self.spend(ctx, Move(g.id, home)):
                ctx.used[g.id] = True
                ctx.standing[here] -= g.units
                missing -= g.charged + refill
                stock -= refill

    def recruit_burst(self, ctx: Ctx) -> None:
        """The capital queues recruits up to ``recruit.queue_max`` and its capacity at the
        arrivals (#686), while the CP pay (DEC-25: CP at queueing, a cancel of an unstarted unit
        refunds in full)."""
        view, home = ctx.view, self.home
        n = view.nodes[home]
        queued = n.recruit_queue
        if queued is None or not n.has_barracks:
            return
        queue = queued  # ``standing`` counts the recruits of this decision, ``queue`` too
        while (
            queue < self.rules.recruit.queue_max and self.load(ctx, home) + queued + 1 <= n.capacity
        ):
            if not self.spend(ctx, Recruit(home)):
                return
            queue += 1
            self.recruited[home] = ctx.tick
            ctx.standing[home] += 1

    def road_threats(self, view: PlayerView) -> dict[tuple[int, int], RoadThreat]:
        """By own node and road the visible enemy shots coming in (``forts.road_threats``), once
        per decision."""
        if self._threats[0] is view:
            return self._threats[1]
        tick = view.tick

        def seen(node: int) -> int:
            sighting = view.nodes[node].seen
            if sighting is None or not sighting.enemy_modes:
                return 0
            if tick - sighting.tick > FRESH_TICKS:
                return 0
            numbers = self.enemy_at(view, node)
            return GUESS_UNITS if numbers is None else numbers[1]

        found = road_threats(
            view, self.map, seen, self.travel.ticks, self.edge_keys, guess=GUESS_UNITS, figures=True
        )
        self._threats = (view, found)
        return found

    def fortify_capital(self, ctx: Ctx) -> None:
        """Item 22: every road into the own capital that a visible enemy force of ``FORT_SHOTS``
        comes by (any visible force while the capital is in danger) gets a road fortification
        (DEC-43, item D), the most shots first; the capital keeps no CP for it."""
        view, home = ctx.view, self.home
        least = 1 if self.danger else FORT_SHOTS
        roads = sorted(
            (
                t
                for t in self.road_threats(view).values()
                if t.node == home and t.shots >= least and not fortified(view, home, t.edge)
            ),
            key=lambda t: (-t.shots, self.edge_keys[t.edge]),
        )
        for t in roads:
            if not self.spend(ctx, FortifyRoad(home, t.edge)):
                return

    # Visible strikes ------------------------------------------------------------------------

    @override
    def respond(self, ctx: Ctx) -> None:
        view = ctx.view
        live = {i.id for i in view.intents}
        self.answered = {i: True for i in sorted(self.answered) if i in live}
        level = self.params["respond"]
        ctx.budget += self.params["reserve"]
        for intent in self.strikes(ctx):
            self.exposed[intent.origin] = ctx.tick
            target = intent.target
            if target is None or intent.id in self.answered:
                continue
            if level <= 0 and target not in self.paired:
                continue
            lesser = target != self.home and target not in self.paired  # item 17: pairs count
            if lesser and level == 1 and not self.worth_defending(target):
                continue
            if target != self.home and self.defending() and self.UPKEEP:
                continue  # item 30: ``answer`` below, only when the sum of forces holds
            if self.reinforce(ctx, target):
                self.answered[intent.id] = True
        if self.defending():  # item 29: a strike at any own node
            answer(self, ctx, [i for i in self.strikes(ctx) if i.id not in self.answered])
        ctx.budget -= self.params["reserve"]

    def worth_defending(self, node: int) -> bool:
        """Whether a strike at own city ``node`` is answered at ``respond`` 1 (item 11): the
        city is worth ``worth_defense`` VP or more, and an award is still to come."""
        worth = self.params["worth_defense"]
        a = self.assessment
        if worth <= 0 or a is None or a.awards_left <= 0:
            return False
        return self.map.nodes[node].vp >= worth

    def strikes(self, ctx: Ctx) -> list[IntentView]:
        """Planned enemy orders aimed at an own node, in a mirror-invariant order."""
        view = ctx.view
        found = [
            i
            for i in view.intents
            if i.owner != self.player
            and i.target is not None
            and view.nodes[i.target].owner == self.player
        ]
        found.sort(key=lambda i: (self.key(i.target or 0), self.key(i.origin), i.created_tick))
        return found

    def arrival(self, intent: IntentView) -> int:
        """The earliest tick the planned strike of ``intent`` can reach its target: it departs once
        it has gathered one bonus at least (DEC-41, item 10)."""
        assert intent.target is not None
        way = max(0, self.travel.ticks[intent.origin][intent.target])
        return intent.created_tick + self.rules.orders.plan_ticks_per_bonus + way

    def reinforce(self, ctx: Ctx, target: int) -> bool:
        """The nearest charged group that can walk to ``target``, may leave its node and fits
        ``target`` at the arrival (#686)."""
        best: GroupView | None = None
        room = self.room(ctx, target) if ctx.view.nodes[target].owner == self.player else None
        for g in self.free_groups(ctx):
            here = node_of(g)
            if here == target or g.charged == 0 or (room is not None and g.units > room):
                continue
            if not self.may_leave(ctx, g) or target not in self.reachable(
                ctx.view, here, SEARCH_HOPS, g.units
            ):
                continue
            if best is None or (self.hops[here][target], -g.charged) < (
                self.hops[node_of(best)][target],
                -best.charged,
            ):
                best = g
        if best is not None and self.spend(ctx, Move(best.id, target)):
            ctx.used[best.id] = True
            ctx.standing[node_of(best)] -= best.units
            ctx.claimed[target] = True
            return True
        return False

    # Garrisons ------------------------------------------------------------------------------

    def _hot(self, view: PlayerView) -> list[bool]:
        """Own nodes next to an enemy node or to fresh enemy groups (public ownership and the
        sightings of the view)."""
        me = view.player
        enemy_near = [
            n.owner == 1 - me
            or (n.seen is not None and bool(n.seen.enemy_modes) and view.tick - n.seen.tick <= 50)
            for n in view.nodes
        ]
        return [
            n.owner == me and any(enemy_near[m] for m in self.neighbors[n.id]) for n in view.nodes
        ]

    def garrison(self, ctx: Ctx) -> None:
        """Fill the own nodes next to the enemy that hold fewer than ``hold_front`` units from the
        free groups within ``SEARCH_HOPS`` that may leave (VP first, then ``node_key``)."""
        view = ctx.view
        holds = [self.front_hold(n) if self.hot[n] else 0 for n in range(len(view.nodes))]
        short = [n for n in range(len(view.nodes)) if self.load(ctx, n) < holds[n]]
        short.sort(key=lambda n: (-self.map.nodes[n].vp, self.key(n)))
        for node in short:
            hold = holds[node]
            for g in self.free_groups(ctx):
                here = node_of(g)
                if self.load(ctx, node) >= hold:
                    break
                if here == node or self.hot[here] or not self.may_leave(ctx, g):
                    continue
                if g.units > self.room(ctx, node):
                    continue  # #686
                if node not in self.reachable(view, here, SEARCH_HOPS, g.units):
                    continue
                if self.spend(ctx, Move(g.id, node)):
                    ctx.used[g.id] = True
                    ctx.standing[here] -= g.units

    def fortify(self, ctx: Ctx) -> None:
        """With item 22 (``DEFENSE_V2``) the road fortifications of ``fortify_roads``."""
        if self.DEFENSE_V2:
            self.fortify_roads(ctx)

    def fortify_roads(self, ctx: Ctx) -> None:
        """Item 22 (G-F): one road fortification per decision on the road into a threatened own
        node other than the capital (``fortify_capital``): a visible enemy force of
        ``FORT_SHOTS`` or more comes by it (``road_threats``), the node holds own units, is no
        fight and not doomed (a capture destroys its fortifications, DEC-43 item D7), the force is
        at most ``FORT_MARGIN`` shots short of taking it (the fortification may decide the fight),
        the road lost no fortification within ``FORT_RETRY`` ticks, and the node is worth it: a
        city (its VP) or a chokepoint whose loss cuts own nodes off the capital (``forts.cut_off``:
        a pocket, item H). At most ``FORTS`` such fortifications stand on roads from enemy nodes,
        ``FORT_KEEP`` CP stay, and all of them take at most ``FORT_SHARE`` percent of the CP the
        bot has had (a budget, not a sink). The most VP and cut first, then the most shots, then
        ``node_key``. Needs ``insight`` (item 9). The site is ``fort_road_site``; a site the CP
        cannot pay yet is saved for (item 23, ``saving``)."""
        fort = self.rules.fort
        if ctx.budget - fort.cost < self.FORT_KEEP:
            return
        site = self.fort_road_site(ctx)
        if site is not None and self.spend(ctx, FortifyRoad(*site)):
            self.fort_cp += fort.cost
            self.fort_sent[site] = ctx.tick
            self.saving_since = None

    def note_income(self, tick: int, stance: Stance) -> None:
        """Count the own CP income up to ``tick`` at the stance in force, then ``stance`` from
        there on (item 26)."""
        self.income = self.income_at(tick)
        self.income_tick = max(self.income_tick, tick)
        self.income_stance = stance

    def income_at(self, tick: int) -> int:
        """``income`` carried on to ``tick`` at ``income_stance``."""
        period = self.rules.stances.cp_period_ticks.of(self.income_stance)
        rate = self.rules.cp.per_period * (self.income_unit // period)
        return self.income + max(0, tick - self.income_tick) * rate

    def cp_had(self, tick: int) -> int:
        """The CP in hundredths the bot has had by ``tick``: ``cp.start`` and the flat income of
        the stances it was in (DEC-44, the periods of the match: ``Bot.rules`` carries the map
        tempo of DEC-46), rounded down. Until #1015 the fortification budget counted the Balance
        period whatever the stance, so a War bot had more CP than it counted and an Economy bot
        less. A stance change counts from the tick it is applied; the carried counter (DEC-44,
        item 4) is not modelled, at most one quantum per change."""
        return self.rules.cp.start + self.income_at(tick) // self.income_unit

    def fort_share_left(self, tick: int) -> bool:
        """Whether one more fortification of a node other than the capital stays within
        ``FORT_SHARE`` percent of the CP the bot has had by ``tick`` (``cp_had``), with the ones
        sent so far (``fort_cp``)."""
        return 100 * (self.fort_cp + self.rules.fort.cost) <= self.FORT_SHARE * self.cp_had(tick)

    def fort_road_site(self, ctx: Ctx) -> tuple[int, int] | None:
        """The ``(node, road)`` ``fortify_roads`` fortifies now with the CP aside (its docstring);
        ``None``: none (no ``insight``, ``FORTS`` 0 or no item 22)."""
        if self.FORTS <= 0 or not self.tempo.insight or not self.DEFENSE_V2:
            return None
        if not self.fort_share_left(ctx.tick):
            return None
        view, home, me = ctx.view, self.home, self.player
        standing = 0
        for e in view.edges:
            edef = self.map.edges[e.id]
            for f in e.forts:
                if f.owner != me or f.node == home:
                    continue
                if view.nodes[edef.other(f.node)].owner == 1 - me:
                    standing += 1
        if standing >= self.FORTS:
            return None
        fights = self.fight_nodes(view)
        units = [0] * len(view.nodes)
        charged = [0] * len(view.nodes)
        for g in view.groups:
            if isinstance(g.location, AtNode):
                units[g.location.node] += g.units
                charged[g.location.node] += g.charged
        best: tuple[int, int, int, int] | None = None
        site: tuple[int, int] | None = None
        for (node, edge), t in self.road_threats(view).items():
            if node == home or t.shots < FORT_SHOTS or fortified(view, node, edge):
                continue
            if node in fights or self.doomed[node] or self.load(ctx, node) < 1:
                continue
            sent = self.fort_sent.get((node, edge))
            if sent is not None and ctx.tick - sent < FORT_RETRY:
                continue  # it was destroyed: the node changed hands since
            terrain = self.map.nodes[node].terrain
            if t.shots + FORT_MARGIN < shots_to_take(
                self.rules, terrain, units[node], charged[node]
            ):
                continue  # the garrison holds it: the fortification would not decide the fight
            worth = W_FORT_VP * self.map.nodes[node].vp
            worth += W_FORT_CUT * cut_off(view, self.neighbors, home, node)
            if worth <= 0:
                continue
            rank = (-worth, -t.shots, self.key(node), self.edge_keys[edge])
            if best is None or rank < best:
                best, site = rank, (node, edge)
        return site

    @override
    def may_leave(self, ctx: Ctx, g: GroupView, *, hold: bool = True) -> bool:
        """``CampaignBot.may_leave`` with the pin, the pockets, the scouts, the capital guard and,
        with ``hold``, the garrison of a front node (``front_hold``); a retake of item 29 passes
        ``hold=False``: the garrisons next to a breach are the ones that seal it."""
        here = node_of(g)
        if self.pinned[here]:
            return False  # DEC-37: caught on the way out, it fights outside the node
        pk = self.pockets
        if pk is not None and pk.pocket[here] and ctx.incoming[here] > 0:
            return False  # #683: stranded units walk in to leave the pocket with it
        if self.watch[here] and ctx.standing[here] - g.units < 1:
            return False  # the scout stays (DEC-35)
        if here == self.home:
            if self.alarm:
                return False
            return ctx.standing[here] - g.units >= self.params["guard"]
        if hold and self.hot[here]:
            return ctx.standing[here] - g.units >= self.front_hold(here)
        return True

    @override
    def _guard_split(self, ctx: Ctx) -> None:
        """Split the spare units off a group that holds the capital or a front node, so they can
        march (only when the spare units alone could take a target)."""
        p = self.params
        for g in self.free_groups(ctx):
            here = node_of(g)
            if here == self.home:
                if self.alarm:
                    continue
                keep = p["guard"]
            elif self.hot[here]:
                keep = self.front_hold(here)
            else:
                continue
            spare = ctx.standing[here] - keep
            # Item 29: a picket of the line lets the rest of its group go, one unit too.
            least = 1 if self.defending() and self.defense.hold(here) else 2
            if spare < least or g.units <= spare:
                continue
            squad = self.squad()
            whole = not self.squads() or spare >= squad
            if not whole:
                if not self.WALK_IN_SPLITS:
                    continue  # item 28: the recruits merge into the stack until a squad is spare
            elif self.squads():
                spare = squad  # item 28: one whole squad a decision
            army = self.fake_group(g, spare, min(spare, g.charged))
            # Item 18: on a settled map the spare units of the capital march to the objective
            # even without a target in reach (a pile at home earns nothing).
            rally = self.MID_RALLY and self.settled() and here == self.home and g.charged > keep
            opts = self.options(ctx, [army])
            if not whole:  # item 28: less than a squad walks into an empty node or to the front
                opts = [o for o in opts if not self.defended(ctx.view, ctx.tick, o.dest)]
            if (rally or opts) and self.spend(ctx, Split(g.id, spare)):
                ctx.used[g.id] = True

    # Targets --------------------------------------------------------------------------------

    @override
    def score(self, ctx: Ctx, g: GroupView, dest: int, need: int) -> int | None:
        p = self.params
        node = self.map.nodes[dest]
        here = node_of(g)
        hops = self.hops[here][dest]
        if not self.in_reach(ctx, g, dest):
            return None
        if self.thin() and g.units < 2 and dest in self.defense.lost:
            return None  # item 30: a small army retakes with two units at least
        if node.capital_of is not None:
            return None if self.STRIKE_ONLY else 10_000 - hops  # item 12
        far = self.hops[self.enemy_home]
        closer = far[here] - far[dest]
        if ctx.view.nodes[dest].owner is None:
            value = p["w_neutral"] * node.vp
        else:
            cut = self.cut_values(ctx.view).get(dest, 0)
            value = p["w_base"] + p["w_vp"] * node.vp + p["w_cut"] * cut // 100
        seen = self.exposed.get(dest)
        if seen is not None and ctx.tick - seen <= EXPOSED_TICKS:
            value += p["w_exposed"]
        if self.worry is not None and dest == self.worry.stage:
            value += W_STAGE  # item 13: hit the build-up before it strikes
        value += self.mid_value(ctx, dest)
        value += self.exploit(ctx.view, dest)  # item 28: the second echelon
        value += self.terrain_value(ctx, dest)  # item 28: plains first, mountains last
        if self.pockets is not None:
            value += W_RESCUE * self.pockets.rescue.get(dest, 0)  # item 20: retake the cut
        value += self.defense.bonus.get(dest, 0)  # item 29: retakes, origins, raids
        return value + p["w_closer"] * closer - p["w_need"] * need - p["w_hops"] * hops

    def in_reach(self, ctx: Ctx, g: GroupView, dest: int) -> bool:
        """Whether ``dest`` may be a target at all: within ``region`` hops of the own capital
        (``spill`` more while CP are about to burn); midgame ``COUNTER`` and ``MID_GROUP``
        (item 18)."""
        p = self.params
        region = p["region"]
        if region > 0:
            if ctx.view.me.cp >= self.rules.cp.cap - self.rules.cp.per_period:
                region += p["spill"]  # CP are about to burn: the bunker grows a ring
            if self.hops[self.home][dest] > region:
                return False
        if not self.settled() or ctx.view.nodes[dest].owner != 1 - self.player:
            return True
        if self.MID_GROUP and self.shots[dest] > 0 and g.charged < self.MID_GROUP:
            return False  # concentrated breakthroughs: no single units into a garrison
        if self.COUNTER:
            a = self.assessment
            ahead = a is not None and a.ahead
            seen = self.exposed.get(dest)
            fresh = seen is not None and ctx.tick - seen <= EXPOSED_TICKS
            weak = self.shots[dest] == 0 or self.weakness(dest) > 0
            if ahead and not self.attacked_at and not fresh and not weak:
                return False  # ahead, nothing committed, no weak spot: wait for the enemy
        return True

    def mid_value(self, ctx: Ctx, dest: int) -> int:
        """Item 18: the score a settled map adds to an enemy target (weakness, encirclement,
        the nodes the enemy left to attack)."""
        if not self.settled() or ctx.view.nodes[dest].owner != 1 - self.player:
            return 0
        value = self.W_WEAK * self.weakness(dest)
        if self.W_RING:
            ring = sum(ctx.view.nodes[m].owner == self.player for m in self.neighbors[dest])
            value += self.W_RING * ring
        if self.COUNTER and dest in self.attacked_at:
            value += self.params["w_exposed"]
        return value

    @override
    def objective(self, ctx: Ctx) -> int:
        """Region bots gather at the edge of their region nearest the enemy; cutting bots at the
        most damaging enemy node; the rest at the enemy capital. In the late game with
        ``ASSAULT`` every striking personality at the enemy capital (item 28)."""
        if self.ASSAULT and self.striking() and self.phase is Phase.LATE:
            return self.enemy_home
        if self.MID_GOAL and self.settled():
            spot = self.weak_spot(ctx)
            if spot is not None:
                return spot
        region = self.params["region"]
        if region > 0:
            far = self.hops[self.enemy_home]
            inside = [
                n.id
                for n in ctx.view.nodes
                if n.owner == self.player and 0 <= self.hops[self.home][n.id] <= region
            ]
            return min(inside, key=lambda n: (far[n], self.key(n)), default=self.home)
        if self.params["w_cut"] > 0:
            values = self.cut_values(ctx.view)
            if values:
                return max(sorted(values, key=self.key), key=lambda n: values[n])
        return self.enemy_home

    def cut_values(self, view: PlayerView) -> dict[int, int]:
        """``cut_value`` of every node of the enemy network, refreshed every few ticks."""
        if view.tick - self._cut_tick >= CUT_REFRESH_TICKS:
            self._cut = {n: self.cut_value(view, n) for n in sorted(self.enemy_net(view))}
            self._cut_tick = view.tick
        return self._cut

    def cut_value(self, view: PlayerView, node: int) -> int:
        """Damage to the enemy network if ``node`` were ours, in points: 100 per enemy node that
        would lose its connection to the enemy capital, plus a quarter of 100 per network road
        into it (public ownership)."""
        net = self.enemy_net(view)
        if node not in net:
            return 0
        enemy = 1 - self.player
        seen: dict[int, bool] = {self.enemy_home: True} if node != self.enemy_home else {}
        queue = deque(seen)
        while queue:
            at = queue.popleft()
            for other in self.neighbors[at]:
                if other != node and other not in seen and view.nodes[other].owner == enemy:
                    seen[other] = True
                    queue.append(other)
        lost = len(net) - 1 - len(seen)
        roads = sum(100 for e in self.incident[node] if self.map.edges[e].other(node) in net)
        return 100 * lost + roads // 4

    # Arrivals, doomed cities, the engagement zone ------------------------------------------

    def _read_arrivals(self, view: PlayerView) -> None:
        """``arrive``, ``doomed`` and ``pinned`` of this decision (module docstring, 6 and 8)."""
        rules, me = self.rules, self.player
        self.arrive = arrivals(view, self.map, rules, self.travel, GUESS_UNITS)
        count = len(view.nodes)
        doomed = [False] * count
        pinned = [False] * count
        fights = self.fight_nodes(view)
        groups = {g.id: g for g in view.groups}
        for node, f in fights.items():
            if view.nodes[node].owner != me:
                continue
            stock = sum(groups[i].charged for i in f.groups if i in groups) + f.virtual_left[me]
            doomed[node] = f.enemy_charged + f.virtual_left[1 - me] > stock
        window = rules.combat.engage_ticks + PIN_SLACK
        for node in sorted(self.arrive) if self.tempo.insight else []:
            if node in fights:
                continue  # DEC-37, item 2: nothing is caught for a node with a fight
            arrival = self.arrive[node]
            pinned[node] = arrival.tick - view.tick <= window
            if arrival.tick - view.tick <= DOOM_TICKS:
                doomed[node] = arrival.units >= garrison_need(view, self.map, rules, node)
        self.doomed = doomed
        self.pinned = pinned

    # Doomed cities, recruit queues ------------------------------------------------------------

    def _is_city(self, node: int) -> bool:
        return self.map.nodes[node].kind is not NodeKind.PROVINCE

    def evacuate(self, ctx: Ctx) -> None:
        """A doomed own city cancels its recruit queue (module docstring, item 6)."""
        view = ctx.view
        doomed = [n for n in range(len(view.nodes)) if self.doomed[n]]
        if not doomed or not self.tempo.insight:
            return
        for node in sorted(doomed, key=self.key):
            n = view.nodes[node]
            if n.owner != self.player or not self._is_city(node):
                continue
            if n.recruit_queue:
                self.spend(ctx, CancelRecruit(node))

    @override
    def fort_sink(self, ctx: Ctx) -> None:
        """Item 26 (#1015): the CP sink of ``economy.fort_site`` comes last in the decision, after
        the attacks, the recruits and ``bank``, only while the CP the decision leaves are near the
        cap (``cp.cap - cp.per_period``, the next income would burn in part), and within the
        fortification budget of item 22 (``fort_share_left``, which it shares)."""
        cp = self.rules.cp
        if ctx.budget + self.params["reserve"] < cp.cap - cp.per_period:
            return
        if not self.fort_share_left(ctx.tick):
            return
        road = fort_site(self, ctx.view, ctx.budget)
        if road is not None and self.spend(ctx, FortifyRoad(*road)):
            self.fort_cp += self.rules.fort.cost

    def bank(self, ctx: Ctx) -> None:
        """A second unit in the recruit queue of a rear city with the barracks (DEC-25): a queue
        of one stands empty between the unit made and the next decision, a queue of two does
        not. The second unit has not started, so it refunds in full (DEC-25, item 3) and
        ``unbank`` takes it back when the capital needs the CP. Only with a whole recruit price
        above ``recruit_keep``; CP about to burn on the cap (DEC-02) fill the queue up to
        ``recruit.queue_max``. One unit per decision, nearest the own capital first."""
        view, rules = ctx.view, self.rules
        cost = self.cost(Recruit(0))
        burning = ctx.budget + self.params["reserve"] >= rules.cp.cap - rules.cp.per_period
        if not burning and ctx.budget - 2 * cost < self.params["recruit_keep"]:
            return
        if ctx.budget < cost:
            return
        limit = rules.recruit.queue_max if burning else 2
        fights = self.fight_nodes(view)
        hops = self.hops[self.home]
        cities: list[int] = []
        for n in view.nodes:
            node = n.id
            queue = n.recruit_queue
            if n.owner != self.player or queue is None or node in fights:
                continue
            if self.recruited.get(node) == ctx.tick or not 1 <= queue < limit:
                continue
            if self.hot[node] or self.doomed[node] or not self.recruits_in(view, node):
                continue
            if self.load(ctx, node) + queue + 1 > n.capacity:  # #686: the arrivals too
                continue
            cities.append(node)
        if not cities:
            return
        city = min(cities, key=lambda c: (hops[c], self.key(c)))
        if self.spend(ctx, Recruit(city)):
            self.recruited[city] = ctx.tick

    def recruits_in(self, view: PlayerView, node: int) -> bool:
        """``Recruit`` is allowed in the own city ``node`` by the barracks (DEC-26, item 11)."""
        return bool(view.nodes[node].has_barracks)

    def unbank(self, ctx: Ctx) -> None:
        """While the capital is in danger, production moves to the capital (its recruits stand
        where the threat comes): when the CP do not pay for a recruit there, the last unit of the
        queue of every other own city is cancelled (DEC-25, item 11), a full refund for a unit
        that has not started, a half for one in production (item 3); the next decision queues
        it in the capital (``defend_capital``)."""
        view = ctx.view
        if not self.alarm or ctx.budget >= self.cost(Recruit(self.home)):
            return
        if not self.can_queue(view, self.home, self.load(ctx, self.home)):
            return
        for n in view.nodes:
            if n.owner == self.player and n.id != self.home and n.recruit_queue:
                self.spend(ctx, CancelRecruit(n.id))

    # Scouting -------------------------------------------------------------------------------

    def _watch_nodes(self, view: PlayerView) -> list[bool]:
        """The ``scouts`` own nodes next to the enemy nearest the own capital, the capital aside
        (it keeps ``guard``), not doomed (item 7)."""
        watch = [False] * len(view.nodes)
        count = self.params["scouts"] if self.tempo.insight else 0
        if count <= 0:
            return watch
        hops = self.hops[self.home]
        front = [
            n
            for n in range(len(view.nodes))
            if self.hot[n] and not self.doomed[n] and n != self.home  # the capital has a guard
        ]
        front.sort(key=lambda n: (hops[n] if hops[n] >= 0 else len(hops), self.key(n)))
        for n in front[:count]:
            watch[n] = True
        return watch

    def scout(self, ctx: Ctx) -> None:
        """An empty watched node gets the smallest free group within ``SEARCH_HOPS`` that may
        leave; a bigger group splits off its least charged unit first (``Split`` hands the
        charged units to the new group, SIM-04), which walks in a later decision."""
        view = ctx.view
        move = self.rules.orders.cost.move
        heading = {g.order.dest: True for g in view.groups if g.order is not None}
        for node in sorted((n for n in range(len(view.nodes)) if self.watch[n]), key=self.key):
            if self.load(ctx, node) > 0 or node in heading:
                continue
            if ctx.budget - move < self.params["recruit_keep"]:
                return
            best: GroupView | None = None
            for g in self.free_groups(ctx):
                here = node_of(g)
                if here == node or self.watch[here] or self.pinned[here]:
                    continue
                if node not in self.reachable(view, here, SEARCH_HOPS, 1):
                    continue
                if g.units > 1 and (
                    self.scouted.get(node, -SCOUT_TICKS) > ctx.tick - SCOUT_TICKS
                    or not self.may_leave(ctx, self.fake_group(g, 1, 0))
                ):
                    continue
                if g.units == 1 and not self.may_leave(ctx, g):
                    continue
                rank = (g.units, g.charged, self.hops[here][node], self.group_order(g))
                if best is None or rank < (
                    best.units,
                    best.charged,
                    self.hops[node_of(best)][node],
                    self.group_order(best),
                ):
                    best = g
            if best is None:
                continue
            here = node_of(best)
            if best.units == 1:
                if self.spend(ctx, Move(best.id, node)):
                    ctx.used[best.id] = True
                    ctx.standing[here] -= 1
            elif self.spend(ctx, Split(best.id, best.units - 1)):
                ctx.used[best.id] = True
                self.scouted[node] = ctx.tick


# The personalities: the BOT-02 and BOT-03 bots as thresholds and weights of ``SmartBot``. ------


class SmartRusher(SmartBot):
    """Early pressure (``RusherBot``): War, a small guard, the weak cities near the enemy
    capital first, neutral cities only as a side dish."""

    name: ClassVar[str] = "smart_rusher"
    DISCIPLINE: ClassVar[bool] = True
    BANK: ClassVar[int] = 300
    """Item 23: a strike of three groups."""
    FORTS: ClassVar[int] = 1
    FORT_KEEP: ClassVar[int] = 200
    FORT_SHARE: ClassVar[int] = 5
    HOLD_SHARE: ClassVar[int] = 35
    """Item 29: the rusher holds the least, its army attacks."""
    SEAL: ClassVar[bool] = False
    """Item 29: no retake before the attacks (with it the rusher won 0.44 of 16 matches against
    ``smart_exploiter``, without it 0.69; #1022)."""
    STRIKE: ClassVar[bool] = True
    MID_GROUP: ClassVar[int] = 3
    MID_GOAL: ClassVar[bool] = True
    W_WEAK: ClassVar[int] = 20
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {
        **SmartBot.PARAMS,
        "radius": ParamRange(3, 4),
        "margin": ParamRange(0, 1),
        "guard": ParamRange(0, 1),
        "reserve": ParamRange(0, 0),
        "recruit_keep": ParamRange(100, 150),
        "secure_margin": ParamRange(0, 0),
        "w_vp": ParamRange(300, 300),
        "w_neutral": ParamRange(40, 120),
        "w_closer": ParamRange(40, 40),
        "w_need": ParamRange(15, 15),
        "respond": ParamRange(1, 1),
        "worth_defense": ParamRange(3, 3),
        "stance_opening": ParamRange(2, 2),  # item 24: War all match (CP for the captures)
        "stance_midgame": ParamRange(2, 2),
        "stance_late": ParamRange(2, 2),
        "contact_pct": ParamRange(75, 75),  # item 25: the boldest estimate
    }


class SmartStrangler(SmartBot):
    """Cuts the enemy roads and besieges (``StranglerBot``): the most damaging city in reach,
    a held cut-off city keeps a garrison."""

    name: ClassVar[str] = "smart_strangler"
    DISCIPLINE: ClassVar[bool] = True
    BANK: ClassVar[int] = 0
    """Item 23: no saving. The siege lives on steady pressure: with a saving of 2 CP the
    strangler won 5 of 16 matches against the benchmark, without it 14 (run 42011930257 and
    local runs on the same seeds, #687)."""
    STRIKE: ClassVar[bool] = True
    W_RING: ClassVar[int] = 60
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {
        **SmartBot.PARAMS,
        "radius": ParamRange(2, 4),
        "margin": ParamRange(0, 1),
        "guard": ParamRange(1, 2),
        "reserve": ParamRange(0, 100),
        "recruit_keep": ParamRange(100, 250),
        "w_vp": ParamRange(50, 50),
        "w_neutral": ParamRange(40, 40),
        "w_base": ParamRange(150, 150),
        "w_cut": ParamRange(100, 100),
        "w_need": ParamRange(3, 3),
        "worth_defense": ParamRange(2, 2),
    }


class SmartReactive(SmartBot):
    """Answers the visible intents (``ReactiveBot``): Defense and a reinforcement at every own
    city under a planned strike, then the bare origin of the strike."""

    name: ClassVar[str] = "smart_reactive"
    DISCIPLINE: ClassVar[bool] = True
    BANK: ClassVar[int] = 250
    """Item 23: a fortification and its keep (the answers spend the saving first)."""
    FORTS: ClassVar[int] = 3
    HOLD_SHARE: ClassVar[int] = 60
    """Item 29: the answering personality holds the most of its line."""
    STRIKE: ClassVar[bool] = True
    COUNTER: ClassVar[bool] = True
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {
        **SmartBot.PARAMS,
        # Tuned by ``gow-bots search`` against smart_rusher and rusher (#166, PR 3).
        "radius": ParamRange(1, 2),
        "margin": ParamRange(0, 1),
        "guard": ParamRange(1, 2),
        "reserve": ParamRange(138, 238),
        "recruit_keep": ParamRange(325, 425),
        "w_neutral": ParamRange(125, 125),
        "w_closer": ParamRange(1, 1),
        "w_exposed": ParamRange(500, 500),
        "respond": ParamRange(2, 2),
        "fortify": ParamRange(1, 1),
    }


class SmartExpander(SmartBot):
    """Territory first (``ExpanderBot``): War until ``late``, then Balance; neutral cities weigh
    like enemy ones, the front keeps a garrison, spare CP go into roads."""

    name: ClassVar[str] = "smart_expander"
    DISCIPLINE: ClassVar[bool] = True
    BANK: ClassVar[int] = 150
    """Item 23: territory first, so the least: a fortification without its keep."""
    HOLD_SHARE: ClassVar[int] = 0
    """Item 29: no line of item 29 on top of its own ``hold_front`` (with it the expander won 0.25
    of 32 matches against ``smart_exploiter``, without it 0.44, as without item 29; #1022)."""
    STRIKE: ClassVar[bool] = True
    MID_GOAL: ClassVar[bool] = True
    W_WEAK: ClassVar[int] = 40
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {
        **SmartBot.PARAMS,
        # Tuned by ``gow-bots search`` against smart_rusher and rusher (#166, PR 3).
        "alarm": ParamRange(200, 300),
        "radius": ParamRange(4, 5),
        "margin": ParamRange(2, 3),
        "guard": ParamRange(2, 3),
        "reserve": ParamRange(0, 0),
        "recruit_keep": ParamRange(63, 163),
        "w_vp": ParamRange(187, 187),
        "w_neutral": ParamRange(186, 236),
        "w_closer": ParamRange(1, 1),
        "w_need": ParamRange(3, 3),
        "w_hops": ParamRange(20, 20),
        "hold_front": ParamRange(0, 1),
        "fortify": ParamRange(1, 1),
        "road_keep": ParamRange(250, 350),
        "late": ParamRange(1200, 2400),
        "worth_defense": ParamRange(2, 2),
        "stance_opening": ParamRange(2, 2),  # item 24: War for the claims, then Balance
    }


class SmartTurtle(SmartBot):
    """The bunker that holds the VP lead (#663, item 19 of the module docstring).

    - *Opening*: it claims its natural half of the map (the nodes no farther from the own capital
      than from the enemy one), one ring more while the CP are about to burn.
    - *Hold* (the territory split, the VP forecast ahead): no attack outside the own half; every
      own node next to the enemy keeps a garrison sized to the enemy shots that can reach it
      (``estimate.threats``, at least ``hold_front``, at most ``hold_front + FRONT_EXTRA``), the
      spare army stands in the most threatened front city, the front roads get the road
      fortifications (item 22), lost nodes of the own half are retaken first.
    - *Push* (the forecast not ahead): a slow advance, one enemy node next to the own territory
      at a time, the weakest sector first (``weak_spot``), with the bunker's margin; the army
      rallies there. The late game without a lead goes all in like every smart bot (item 1).
    """

    name: ClassVar[str] = "smart_turtle"
    DISCIPLINE: ClassVar[bool] = True
    BANK: ClassVar[int] = 250
    """Item 23: its fortifications (no keep, ``FORTS`` 6; no strike, item 12)."""
    FORTS: ClassVar[int] = 6
    """Item 22: the turtle leans on road fortifications."""
    FORT_KEEP: ClassVar[int] = 0
    FORT_SHARE: ClassVar[int] = 10
    """Owner decision after step 2 (#1023): the fort CP share of the turtle under 10% too."""
    FRONT_EXTRA: ClassVar[int] = 2
    """Units a threatened front node keeps above ``hold_front`` at most."""
    W_WEAK: ClassVar[int] = 40
    W_RETAKE: ClassVar[int] = 300
    """Score of an enemy node in the own half (a lost node is retaken first)."""
    PARAMS: ClassVar[Mapping[str, ParamRange]] = {
        **SmartBot.PARAMS,
        "radius": ParamRange(2, 3),
        "margin": ParamRange(1, 2),
        "guard": ParamRange(3, 5),
        "reserve": ParamRange(0, 100),
        "recruit_keep": ParamRange(150, 250),
        "w_neutral": ParamRange(150, 150),
        "region": ParamRange(3, 4),
        "spill": ParamRange(1, 2),
        "hold_front": ParamRange(2, 3),
        "fortify": ParamRange(1, 1),
        "road_keep": ParamRange(250, 350),
        "respond": ParamRange(2, 2),
        "worth_defense": ParamRange(1, 1),
        "stance_opening": ParamRange(0, 0),  # item 24: Economy while it claims its half
    }

    def __init__(
        self,
        mapdef: MapDef,
        rules: Ruleset,
        *,
        seed: int,
        player: int,
        difficulty: str = DEFAULT_DIFFICULTY,
    ) -> None:
        super().__init__(mapdef, rules, seed=seed, player=player, difficulty=difficulty)
        near, far = self.hops[self.home], self.hops[self.enemy_home]
        count = len(mapdef.nodes)
        self.half: list[bool] = [0 <= near[n] <= far[n] for n in range(count)]
        """The natural half: no farther from the own capital than from the enemy one."""
        self.ring: list[int] = [0 if self.half[n] else count for n in range(count)]
        """Hops from the half (0 inside it)."""
        queue = deque(n for n in range(count) if self.half[n])
        while queue:
            n = queue.popleft()
            for m in self.neighbors[n]:
                if self.ring[m] > self.ring[n] + 1:
                    self.ring[m] = self.ring[n] + 1
                    queue.append(m)

    def pushing(self) -> bool:
        """The territory is split and the forecast is not ahead: the slow advance."""
        a = self.assessment
        return self.settled() and (a is None or not a.ahead)

    @override
    def in_reach(self, ctx: Ctx, g: GroupView, dest: int) -> bool:
        if self.pushing():
            return True  # ``reachable`` ends at the first foreign node: next to the territory
        spill = 0
        if ctx.view.me.cp >= self.rules.cp.cap - self.rules.cp.per_period:
            spill = self.params["spill"]  # CP are about to burn: one ring more
        if self.settled():
            spill = min(spill, 1)
        return self.ring[dest] <= spill

    @override
    def mid_value(self, ctx: Ctx, dest: int) -> int:
        if ctx.view.nodes[dest].owner != 1 - self.player:
            return 0
        value = self.W_RETAKE if self.half[dest] else 0
        if self.pushing():
            value += self.W_WEAK * self.weakness(dest)
            if dest == self.weak_spot(ctx):
                value += self.W_WEAK * 2
        return value

    @override
    def front_hold(self, node: int) -> int:
        hold = self.params["hold_front"]
        if not self.settled():
            return hold
        if self.pushing():  # the army is needed for the advance: what the threat asks, no more
            return max(1, min(hold, self.threat[node] + 1))
        return max(hold, min(self.threat[node] + 1, hold + self.FRONT_EXTRA))

    @override
    def objective(self, ctx: Ctx) -> int:
        """Opening: the own node of the half nearest the enemy capital; hold: the own front city
        under the most threat; push: the weakest enemy sector."""
        view = ctx.view
        if self.pushing():
            spot = self.weak_spot(ctx)
            if spot is not None:
                return spot
        far = self.hops[self.enemy_home]
        own = [n.id for n in view.nodes if n.owner == self.player]
        if self.settled():
            front = [n for n in own if self.hot[n] and self._is_city(n)]
            if front:
                return max(
                    front,
                    key=lambda n: (
                        self.threat[n] - ctx.standing[n],
                        self.map.nodes[n].vp,
                        -self.key(n),
                    ),
                )
        inside = [n for n in own if self.half[n]]
        return min(inside, key=lambda n: (far[n], self.key(n)), default=self.home)


PERSONALITIES: Final[tuple[type[SmartBot], ...]] = (
    SmartExpander,
    SmartReactive,
    SmartRusher,
    SmartStrangler,
    SmartTurtle,
)
"""The five personalities, in name order."""


def _figure_shots(f: EnemyGroupView) -> int:
    """The shots of an enemy figure on an edge (DEC-33): the exact charges, the top of the range
    of units (the start of the open last one), else ``GUESS_UNITS``."""
    if f.detail is Detail.EXACT and f.charged is not None:
        return f.charged
    if f.units_range is not None:
        low, high = f.units_range
        return low if high is None else high
    return GUESS_UNITS
