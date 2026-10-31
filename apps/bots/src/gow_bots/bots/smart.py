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
   the strongest one goes into Defense if the bonus grows before the arrival (DEC-30), free
   charged groups that can arrive in time walk home, and the capital recruits. Only a garrison
   sees what comes (DEC-35), so while an enemy node is within ``watch`` hops of the capital it
   keeps at least ``watch_guard`` units.
3. **Visible strikes** (DEC-08): ``respond`` 1 answers a planned strike at the capital, 2 at any
   own city, with Defense and the nearest group (the reactive play); for ``EXPOSED_TICKS`` the
   origin of every strike scores ``w_exposed`` more as a target (a bare spot to hit back).
4. **Targets** are ranked by one weighted sum (``score``): VP of the target (``w_vp`` for an enemy
   city, ``w_neutral`` for a neutral one), the damage to the enemy supply network (``w_cut``
   percent of ``cut_value``), the hops it brings closer to the enemy capital (``w_closer``),
   minus the shots it needs (``w_need``) and the hops away (``w_hops``); the enemy capital in
   reach always first. ``region`` > 0 keeps the targets within that many hops of the own capital
   (``spill`` more while CP are about to burn).
5. **Garrisons and the rest**: ``hold_front`` units stay in own nodes next to the enemy, front
   garrisons below it are filled from free groups nearby, ``fortify`` puts their strongest group
   into Defense; the stance is the personality's, one step toward Economy while units wait for
   charges and toward War while the warehouses are full and CP do not burn.
6. **Supply** (#166, PR 2; DEC-18, DEC-25, DEC-28), from ``gow_bots.bots.logistics``:

   - *Front markers* go to the front cities an enemy is heading into first (the charges reach
     the defenders before the fight), then to the front nearest the enemy capital; never to a
     *doomed* city (losing its fight, or an arrival it cannot hold within ``DOOM_TICKS``).
   - A doomed city cancels its recruit queue (the queue and its CP are lost with the city, a
     cancel refunds them, DEC-25, items 3 and 10) and transfers the charges its own units do not
     need to the nearest safe own city (a captured warehouse is zeroed, DEC-26, item 4).
   - ``SetRearMin``: 0 while ``FEED_MIN`` units wait in a city with a marker and an empty
     warehouse (the rear gives everything to the front, DEC-28, item 5), ``rear_full`` while
     the capital warehouse is full (the stock spreads to the rear instead of burning), else
     the ruleset default.
   - ``Transfer``: a city without a marker where at least ``FEED_MIN`` own units wait for
     charges that are not there or on the way gets them from the nearest own city with a stock
     above its supply target (DEC-28, item 5), one transfer per decision.
   - *Recruit queues* (DEC-25): a rear city with the barracks queues a second unit when a whole
     price is spare (no idle tick between units; up to ``recruit.queue_max`` with CP about to
     burn); a unit that has not started refunds in full (item 3), so while the capital is in
     danger and cannot pay its own recruit, the other cities cancel theirs (``unbank``).
   - *Roads*: one at a time while ``road_keep`` CP are left (DEC-28, item 7), the *arteries*
     first (the roads from the capital to the cities with a marker, over own nodes), then the
     road with the most gain.

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
    (``prefer_planned``) that the CP cannot pay yet, the bot holds its price for ``wait_plan``
    ticks (a ``Hold``): every other command that is not urgent (Defense, fights, evacuation,
    the garrisons and the answers to strikes) leaves that price, so one-CP claims do not eat it
    up. The hold ends when the plan is sent, when its target or group is gone, or when it runs
    out; the same target is not held again for twice ``wait_plan`` ticks. Without ``insight``
    the bot does not plan ahead (no hold).
11. **Strikes at lesser cities** (``worth_defense``, #618). ``respond`` 1 answers only the
    strikes at the capital; with ``worth_defense`` > 0 it also answers a strike at an own city
    worth at least that many VP while an award is still to come (Defense and a reinforcement
    like ``respond`` 2). The reaction delay of the level is the one of ``Perception``.

12. **A converging strike on the enemy capital** (``STRIKE``). The free charged groups within
    ``STRIKE_HOPS`` edges of it whose path reaches it go together (``strike_plan``): the groups
    next to it first, the most charged first, each by a scheduled order when ``plan_strike`` (the
    shared ``prefer_planned`` with the shots the groups before it leave missing) says so, else by
    an ordinary one, while the CP last. The strike goes when its pool (charges and plan bonuses,
    DEC-29) reaches the shots that take the capital (``strike_need``) and it has ``STRIKE_MIN``
    groups (one group alone is a single attack of item 4, unless ``STRIKE_ONLY``); with
    ``STRIKE_BANK`` a ready strike keeps its price from the other spending until it is paid. The
    orders are timed so that every group arrives within ``STRIKE_ALIGN`` ticks of the slowest one
    (the plan's ``orders.planned_delay_ticks`` and the travel times of mechanics.md, section 4,
    ``edge_ticks``): the joins of the first rounds count in full (DEC-24, D1). The groups of a
    strike are not recalled one by one and do not leave a fight that the rest of the strike is
    still walking into (``committed``, ``coming``).

    ``STRIKE`` is on for every personality but the bunker, with ``insight`` (``striking``).

Items 13-17 answer the owner's staging strike (#624, playtest 2026-10-30, B1-B4); they need
``insight`` and the personality's ``ANSWERS`` (the benchmark ``smart_hoarder`` keeps them off),
and each has its switch (``WORRY``, ``WITHDRAW``, ``BURN_WAR``, ``CENTRE_BARRACKS``, ``PAIRS``).
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
15. **War while the charges burn** (B3): the stance steps toward War when the warehouses are
    nine tenths full, whether units wait for delivery or not.
16. **One forward barracks in the centre** (B4): the large city whose hops to the two capitals
    differ least, once held and not next to the enemy; no barracks in front cities.
17. **Two strikes at one node** (the defensive pair): two or more enemy scheduled orders aimed at
    the capital raise the alarm (item 2) within ``alarm`` ticks of their arrival; at any other
    own node they are answered like a strike at the capital (Defense and a reinforcement).

The ordinary-or-planned choice of every order is ``prefer_planned``: a function of the ruleset
prices only, shared by all bots (AGENTS.md, section 8). Tie-breaks are mirror-invariant
(``Bot.key``, ``Bot.edge_keys``), nothing draws from ``self.rng``.
"""

import heapq
from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import ClassVar, Final, override

from gow_bots.bots.assess import FRESH_TICKS, Assessment, Assessor, Travel, edge_ticks
from gow_bots.bots.base import ParamRange, node_of
from gow_bots.bots.campaign import STALE_TICKS, CampaignBot, Ctx, Option
from gow_bots.bots.estimate import EnemyForce, Phase, Sector, phase, sectors, strengths, threats
from gow_bots.bots.logistics import (
    Arrival,
    arrivals,
    garrison_need,
    incoming_charges,
    own_parts,
)
from gow_bots.bots.tempo import DEFAULT_DIFFICULTY, DIFFICULTIES, Bucket, Perception
from gow_bots.bots.utility import defender_pool, prefer_planned, shots_to_take
from gow_sim.commands import (
    CancelRecruit,
    Command,
    Move,
    Recruit,
    SetFront,
    SetMode,
    SetRearMin,
    SetStance,
    Split,
    Transfer,
    UpgradeRoad,
)
from gow_sim.maps import MapDef, NodeKind
from gow_sim.ruleset import RecruitLocation, Ruleset
from gow_sim.view import (
    AtNode,
    Detail,
    EnemyGroupView,
    FightView,
    GroupView,
    IntentKind,
    IntentView,
    Mode,
    PlayerView,
    Stance,
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
FEED_MIN: Final = 2
"""Own units waiting for charges in a city that a transfer feeds."""
FRONT_HOLD: Final = 300
"""Ticks a front marker stays on a city that is still a candidate (hysteresis, item 6)."""
REAR_MIN_TICKS: Final = 150
"""The rear minimum changes at most this often (no flapping on every dispatch)."""
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
COUNTER_TICKS: Final = 300
"""How long an enemy attack on an own node opens the counterattack of ``smart_reactive``."""
V2_RECRUIT_KEEP_MOVES: Final = 2
"""Economy v2: ``recruit_keep`` is at most this many ordinary orders (``adjusted``)."""
STANCES: Final = (Stance.ECONOMY, Stance.BALANCE, Stance.WAR)
"""From the most charges to the most CP (``economy.stance_to_charges_pct``)."""

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
}
"""Thresholds every personality shares (see the module docstring)."""


@dataclass(frozen=True, slots=True)
class Hold:
    """CP kept for a scheduled order the bot chose and could not pay yet (item 10)."""

    dest: int
    group: int
    """Opaque id of the group that was to go."""
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
    home_units: int


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
    STANCE: ClassVar[Stance] = Stance.BALANCE
    LATE_STANCE: ClassVar[Stance | None] = None
    """The stance from tick ``late`` on (``None``: ``STANCE`` all match)."""
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
    BURN_WAR: ClassVar[bool] = True
    """Item 15 on (with ``ANSWERS``)."""
    CENTRE_BARRACKS: ClassVar[bool] = True
    """Item 16 on (with ``ANSWERS``)."""
    PAIRS: ClassVar[bool] = True
    """Item 17 on (with ``ANSWERS``)."""
    BUNKERS: ClassVar[int] = 1
    """Economy v2: bunkers of a personality that fortifies (``bunkers``)."""
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
        self.bucket = Bucket(self.tempo, rules.tick_hz)
        self.perception = Perception(self.tempo.react_ticks)
        self.thought: int | None = None
        """The tick of the last decision (item 9)."""
        self.travel = Travel(mapdef, rules)
        self.assessor = Assessor(mapdef, rules, player, self.travel)
        self.assessment: Assessment | None = None
        """The assessment of the last decision (tests and the docstring's thresholds)."""
        self.alarm = False
        """The capital is in danger in this decision (module docstring, item 2)."""
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
        self.rear_tick: int | None = None
        self.front_set: list[int | None] = []
        """By marker index: the tick this bot last moved it (``fronts``)."""
        self.scouted: dict[int, int] = {}
        """Node to the tick a scout was split off for it."""
        self.strike: Strike | None = None
        """The converging strike under way (item 12)."""
        self.strike_rest = 0
        """No new strike before this tick."""
        self.strike_sent: dict[int, int] = {}
        """Opaque id of a group sent in a strike to the tick it was sent."""
        self._edge_ticks: dict[tuple[int, int, int], int] = {}
        self.edge_between: dict[tuple[int, int], int] = {}
        """``(a, b)`` in both orders to the edge between the two nodes."""
        self.enemy_force = EnemyForce(mapdef, player)
        """The estimate of the enemy units (item 18)."""
        self.phase = Phase.OPENING
        self.shots: list[int] = [0] * count
        """Enemy shots estimated by node in this decision (``estimate.strengths``)."""
        self.sectors: list[Sector] = []
        self.threat: list[int] = [0] * count
        """By own front node: enemy shots that can reach it (``estimate.threats``)."""
        self.attacked_at: dict[int, int] = {}
        """Enemy node next to an own node the enemy attacked, to the tick of that attack: its
        garrison left it (item 18, the counterattack)."""
        for e, edef in enumerate(mapdef.edges):
            self.edge_between[(edef.a, edef.b)] = e
            self.edge_between[(edef.b, edef.a)] = e

    # Decision -------------------------------------------------------------------------------

    @override
    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        self.check_view(view)
        view = self.perception.view(view)  # every call: the first sighting of a figure
        if self.thought is not None and tick - self.thought < self.tempo.think_ticks:
            return []
        self.bucket.refill(tick)
        if not self.bucket.ready():
            return []
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
        self.worry = self._worry(view, a) if self.answering() and self.WORRY else None
        self.hot = self._hot(view)
        self.watched = self.enemy_near_home(view)
        self._read_arrivals(view)
        self.watch = self._watch_nodes(view)
        self._estimate(view)
        self.params = self.adjusted(a)
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

    def settled(self) -> bool:
        """The territory is split: the midgame or the late game (item 18)."""
        return self.phase is not Phase.OPENING

    def weak_spot(self, ctx: Ctx) -> int | None:
        """The enemy front sector with the least pressure per VP it is worth (item 18): the
        least ``pressure`` minus 2 shots per VP, the one nearer the enemy capital, ``node_key``."""
        far = self.hops[self.enemy_home]
        best: tuple[int, int, int] | None = None
        spot: int | None = None
        for sec in self.sectors:
            if sec.node == self.enemy_home:
                continue
            rank = (
                sec.pressure - 2 * self.map.nodes[sec.node].vp,
                far[sec.node],
                self.key(sec.node),
            )
            if best is None or rank < best:
                best, spot = rank, sec.node
        return spot

    def weakness(self, dest: int) -> int:
        """Shots enemy sector ``dest`` is below the mean pressure of the sectors (0 if not)."""
        if not self.sectors:
            return 0
        mean = sum(sec.pressure for sec in self.sectors) // len(self.sectors)
        for sec in self.sectors:
            if sec.node == dest:
                return max(0, mean - sec.pressure)
        return 0

    def front_hold(self, node: int) -> int:
        """Units an own node next to the enemy keeps (``hold_front``; a hook of the turtle)."""
        return self.params["hold_front"]

    def adjusted(self, a: Assessment) -> dict[str, int]:
        """The drawn parameters with the thresholds of this decision (module docstring, 1);
        without ``insight`` (item 9) only the capital guard of an alarm."""
        p = dict(self.params)
        if self.rules.v2:
            # Economy v2 has no Defense to keep CP for (DEC-41, item 5) and doubles the CP
            # income (item 1): the keeps of the v1 personalities shrink to a move or two.
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
            p["reserve"] = 0  # the reserve is for this moment: Defense and the walk home
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
        ctx = Ctx(view, tick, view.me.cp - self.params["reserve"], standing=self.standing(view))
        for g in view.groups:
            if g.order is not None:
                ctx.claimed[g.order.dest] = True
        self._learn(ctx)
        for cmd in self.fight_commands(view, tick, ctx.budget):  # DEC-24: fights first
            if self.spend(ctx, cmd) and isinstance(cmd, Move):
                ctx.used[cmd.group] = True
        if self.rules.v2:
            self.economy_v2(ctx)  # lines, factories, bunkers, plans (DEC-41)
        else:
            self._set_stance(ctx, a)
            for cmd in self.fronts(view):  # front markers on the front cities (DEC-28)
                self.spend(ctx, cmd)
        self.evacuate(ctx)
        self.unbank(ctx)
        if not self.rules.v2:
            self.set_rear_min(ctx)
            self.feed(ctx)
        plan_cp = self.held_cp(ctx)
        bank = self.strike_cp(ctx) if self.striking() else 0  # item 12: the strike's CP
        ctx.held = max(plan_cp, bank)  # item 10: from here on the spending leaves the plan's CP
        if not self.alarm:
            cmd = self.development(view, ctx.budget)  # DEC-26, item 11: before the orders
            if cmd is not None:
                self.spend(ctx, cmd)
        self._recall(ctx)
        held, ctx.held = ctx.held, 0  # the urgent answers do not wait for the plan
        self.defend_capital(ctx, a)
        self.answer_worry(ctx)
        self.respond(ctx)
        self.withdraw(ctx)
        ctx.held = bank  # a banked strike waits only for the capital and the strikes
        self.garrison(ctx)
        self.scout(ctx)
        self.fortify(ctx)
        ctx.held = 0
        if self.striking():
            self.converge(ctx)
            held = max(plan_cp if self.hold is not None else 0, self.strike_cp(ctx))
        ctx.held = held
        self._attack(ctx)
        self._fit_split(ctx)
        self._gather(ctx)
        self._rally(ctx)
        self._recruit(ctx)
        if not self.rules.v2:
            self.build_roads(ctx)  # no road levels under v2 (DEC-41, item 8)
        self.bank(ctx)
        return ctx.cmds

    @override
    def spend(self, ctx: Ctx, cmd: Command) -> bool:
        """``CampaignBot.spend`` that also pays one command of the APM bucket (item 9)."""
        if not self.bucket.ready():
            return False
        plan = cmd if isinstance(cmd, Move) and cmd.planned else None
        if ctx.held and plan is None and self.cost(cmd) > ctx.budget - ctx.held:
            return False  # item 10: the CP are for the chosen plan
        if not super().spend(ctx, cmd):
            return False
        self.bucket.take()
        if plan is not None and self.hold is not None and plan.dest == self.hold.dest:
            self.hold = None
            ctx.held = 0
        return True

    # A chosen plan gets its CP (item 10) ------------------------------------------------------

    def held_cp(self, ctx: Ctx) -> int:
        """The CP kept for the hold of an earlier decision; a hold that ran out, whose target is
        taken or whose group is gone ends here."""
        hold = self.hold
        if hold is None:
            return 0
        view = ctx.view
        free = any(g.id == hold.group for g in self.idle_groups(view))
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
        self.hold = Hold(opt.dest, opt.group.id, cost, ctx.tick + wait)
        ctx.held = cost

    # A converging strike (item 12) ----------------------------------------------------------

    def striking(self) -> bool:
        """Converging strikes instead of single attacks on the enemy capital: the personality's
        ``STRIKE`` with ``insight`` (item 9: an ``easy`` bot does not plan ahead)."""
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
            base = self.need(view, ctx.tick, target) - self.params["margin"]
        else:
            start = self.map.nodes[target]
            units = self.params.get("strike_guess", GUESS_UNITS)
            base = shots_to_take(
                self.rules, start.terrain, units, units, self.defended(view, target)
            )
        return base + self.strike_margin()

    def edge_time(self, edge: int, to_node: int, level: int) -> int:
        key = (edge, to_node, level)
        ticks = self._edge_ticks.get(key)
        if ticks is None:
            ticks = edge_ticks(self.map, self.rules, edge, to_node, level)
            self._edge_ticks[key] = ticks
        return ticks

    def way(self, view: PlayerView, start: int, dest: int, size: int) -> tuple[int, int] | None:
        """``(edges, ticks)`` of the fastest path a group of ``size`` units takes from ``start``
        to ``dest``: through own nodes without a fight, under the stack limit (SIM-05, DEC-20, D),
        by the travel times of the current road levels; ties by ``node_key``. ``None``: none."""
        me, nodes = view.player, view.nodes
        fights = self.fight_nodes(view)
        best: dict[int, int] = {start: 0}
        heap: list[tuple[int, int, int, int]] = [(0, self.key(start), start, 0)]
        while heap:
            ticks, _, node, edges = heapq.heappop(heap)
            if ticks > best[node]:
                continue
            if node == dest:
                return (edges, ticks)
            if node != start and (nodes[node].owner != me or node in fights):
                continue
            for e in self.incident[node]:
                other = self.map.edges[e].other(node)
                if nodes[other].capacity < size:
                    continue
                t = ticks + self.edge_time(e, other, view.edges[e].width)
                if other not in best or t < best[other]:
                    best[other] = t
                    heapq.heappush(heap, (t, self.key(other), other, edges + 1))
        return None

    def strike_plan(self, ctx: Ctx, budget: int) -> StrikePlan | None:
        """The converging strike on the enemy capital the free groups could make now with
        ``budget`` CP in hundredths (item 12); ``None``: no group can go."""
        view, rules, target = ctx.view, self.rules, self.enemy_home
        if view.nodes[target].owner == self.player:
            return None
        cost = rules.orders.cost
        found: list[tuple[GroupView, int, int, int]] = []
        for g in self.free_groups(ctx):
            here = node_of(g)
            if g.charged == 0 or self.hops[here][target] > self.STRIKE_HOPS or self.pinned[here]:
                continue
            if here == self.home and ctx.standing[here] - g.units < self.params["guard"]:
                continue
            path = self.way(view, here, target, g.units)
            if path is None or path[0] > self.STRIKE_HOPS:
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
        for g, here, edges, ticks in found:
            bonus = self.plan_bonus(view, here, edges, g.charged)
            if rules.v2:
                bonus = min(bonus, need - pool)  # a v2 plan asks for what is missing only
            plan = (
                bonus >= 1
                and need - pool > 0
                and spent + cost.planned_move <= budget
                and self.plan_strike(g, need - pool, edges, bonus)
            )
            price = cost.planned_move if plan else cost.move
            if spent + price > budget:
                continue
            spent += price
            pool += g.charged + (bonus if plan else 0)
            lead = ticks + (self.plan_lead(bonus) if plan else 0)
            chosen.append(Pick(g.id, here, g.units, g.charged, plan, lead, bonus if plan else 0))
        return StrikePlan(pool, need, spent, tuple(chosen))

    def plan_strike(self, g: GroupView, missing: int, edges: int, bonus: int = 0) -> bool:
        """Whether group ``g`` of a strike goes by a scheduled order: the shared utility
        (``prefer_planned``) with the shots the groups before it leave ``missing``. Under v2
        every group that can gather a ``bonus`` does (DEC-41, item 10): the strike is short,
        and its arrival waits for the slowest group anyway."""
        if self.rules.v2:
            return bonus >= 1
        return prefer_planned(self.rules, g.charged, missing, edges)

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
            if full is None or not full.ready or full.cost > ctx.budget:
                return  # banked (``strike_cp``) or not ready
            plan = self.strike_plan(ctx, ctx.budget)
            if plan is None or not plan.ready or len(plan.picks) < self.STRIKE_MIN:
                return
            arrive = tick + 1 + max(p.lead for p in plan.picks)
            s = Strike(self.enemy_home, arrive, list(plan.picks), arrive + STRIKE_TICKS)
            self.strike = s
        ctx.claimed[s.target] = True
        free = {g.id: g for g in self.free_groups(ctx)}
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
            and i.kind is IntentKind.PLANNED_MOVE
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
        units = charged = defense = 0
        for g in view.groups:
            if g.location == AtNode(home):
                units += g.units
                charged += g.charged
                defense += g.defense_bonus or 0
        terrain = self.map.nodes[home].terrain
        hold = shots_to_take(self.rules, terrain, units, charged, defense)
        shots = seen_shots + self.hidden_shots(view, a)
        if shots < hold:
            return None
        return Worry(shots, hold, stage, units)

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
            if ctx.standing[home] + g.units > view.nodes[home].capacity:
                continue
            if self.spend(ctx, Move(g.id, home)):
                ctx.used[g.id] = True
                ctx.standing[here] -= g.units
                ctx.standing[home] += g.units
                missing -= g.charged
        if self.can_queue(view, home, ctx.standing[home]) and self.spend(ctx, Recruit(home)):
            self.recruited[home] = ctx.tick
            ctx.standing[home] += 1

    def enemy_shots_near(self, view: PlayerView, node: int) -> int:
        """The most shots of one visible enemy force next to own ``node``: a fresh sighting in a
        neighbour in the Attack mode, or a figure on an incident edge heading into ``node``
        (item 14). Only numbers the view shows count: a force hidden by the fog is not a reason
        to give a node up."""
        best = 0
        for m in self.neighbors[node]:
            sighting = view.nodes[m].seen
            if sighting is None or Mode.ATTACK not in sighting.enemy_modes:
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
            pool = defender_pool(self.rules, terrain, charged, 0)
            if enemy - pool < self.WITHDRAW_GAP or enemy < pool + units:
                continue
            for g in groups:
                exits = [
                    m
                    for m in self.neighbors[node]
                    if view.nodes[m].owner == self.player
                    and m not in fights
                    and view.nodes[m].capacity >= ctx.standing[m] + g.units
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
                    ctx.standing[dest] += g.units
                    self.left_from[node] = ctx.tick

    def _burning(self, stock: int, cap: int, waiting: int) -> bool:
        """The warehouses are full, so new charges burn (item 15, playtest B3): without the
        answers only a full stock with no unit waiting; with them nine tenths of the capacity,
        units waiting or not (they wait for delivery, not for production)."""
        if not self.answering() or not self.BURN_WAR:
            return cap <= stock and waiting == 0
        return 10 * stock >= 9 * cap

    @override
    def wanted_barracks(self, view: PlayerView) -> int | None:
        """Item 16 (playtest B4): with the answers, the one forward barracks goes to the centre
        (the large city between the capitals) once it is held and not next to the enemy; no
        barracks in the cities a front marker would put up and lose."""
        if not self.answering() or not self.CENTRE_BARRACKS:
            return super().wanted_barracks(view)
        centre = self.centre
        if centre == self.home or not self.rules.city_upgrades.enabled:
            return None
        n = view.nodes[centre]
        if n.owner != self.player or n.has_barracks or n.building is not None:
            return None
        if self.hot[centre] or self.doomed[centre] or centre in self.fight_nodes(view):
            return None
        return centre

    # Stance ---------------------------------------------------------------------------------

    def wanted_stance(self, a: Assessment) -> Stance:
        """The personality's stance, one step toward Economy while ``starved`` own units wait
        for charges and the warehouses are less than half full, one step toward War while the
        warehouses are full, no unit waits and the CP are not about to burn (the stance only
        splits the CP income, DEC-02)."""
        p = self.params
        late = p["late"]
        stance = self.LATE_STANCE if self.LATE_STANCE and late and a.tick >= late else self.STANCE
        at = STANCES.index(stance)
        own = a.own
        if own.uncharged_standing >= p["starved"] and 2 * own.warehouse < own.warehouse_cap:
            at = max(0, at - 1)
        elif (
            own.warehouse_cap > 0
            and self._burning(own.warehouse, own.warehouse_cap, own.uncharged_standing)
            and a.cp < self.rules.cp.cap - 2 * self.rules.cp.per_period
        ):
            at = min(len(STANCES) - 1, at + 1)
        return STANCES[at]

    def _set_stance(self, ctx: Ctx, a: Assessment) -> None:
        last = self.stance_tick
        if last is not None and ctx.tick - last < self.rules.orders.stance_cooldown_ticks:
            return
        stance = self.wanted_stance(a)
        if ctx.view.me.stance is not stance and self.spend(ctx, SetStance(stance)):
            self.stance_tick = ctx.tick

    # The capital ----------------------------------------------------------------------------

    def defend_capital(self, ctx: Ctx, a: Assessment) -> None:
        """Module docstring, item 2: Defense, the groups that arrive in time, a recruit."""
        if not self.alarm or a.threat.eta is None:
            return
        view, home = ctx.view, self.home
        if view.nodes[home].owner != self.player or home in self.fight_nodes(view):
            return
        self.defend(ctx, home, a.threat.eta)
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
        if self.can_queue(view, home, ctx.standing[home]) and self.spend(ctx, Recruit(home)):
            self.recruited[home] = ctx.tick
            ctx.standing[home] += 1

    def defend(self, ctx: Ctx, target: int, arrival: int) -> bool:
        """Defense for the strongest charged group standing in ``target``, if it gathers at least
        +1 by ``arrival`` (it is switched on in the next tick, DEC-30)."""
        if self.rules.orders.defense_bonus(max(0, arrival - ctx.tick - 1), 1) < 1:
            return False
        here = [
            g
            for g in self.idle_groups(ctx.view)
            if node_of(g) == target and g.charged > 0 and g.id not in ctx.used
        ]
        if not here or any(g.mode is Mode.DEFENSE for g in here):
            return False
        best = max(here, key=lambda g: (g.charged, g.units))
        if self.spend(ctx, SetMode(best.id, Mode.DEFENSE)):
            ctx.used[best.id] = True
            return True
        return False

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
            done = self.defend(ctx, target, self.arrival(intent))
            done = self.reinforce(ctx, target) or done
            if done:
                self.answered[intent.id] = True
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
            and i.kind is IntentKind.PLANNED_MOVE
            and i.target is not None
            and view.nodes[i.target].owner == self.player
        ]
        found.sort(key=lambda i: (self.key(i.target or 0), self.key(i.origin), i.created_tick))
        return found

    def arrival(self, intent: IntentView) -> int:
        """The earliest tick the planned strike of ``intent`` can reach its target."""
        assert intent.target is not None
        way = max(0, self.travel.ticks[intent.origin][intent.target])
        return intent.created_tick + self.rules.orders.planned_delay_ticks + way

    def reinforce(self, ctx: Ctx, target: int) -> bool:
        """The nearest charged group that can walk to ``target`` and may leave its node."""
        best: GroupView | None = None
        for g in self.free_groups(ctx):
            here = node_of(g)
            if here == target or g.charged == 0:
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
            ctx.standing[target] += best.units
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
        short = [n for n in range(len(view.nodes)) if ctx.standing[n] < holds[n]]
        short.sort(key=lambda n: (-self.map.nodes[n].vp, self.key(n)))
        for node in short:
            hold = holds[node]
            for g in self.free_groups(ctx):
                here = node_of(g)
                if ctx.standing[node] >= hold:
                    break
                if here == node or self.hot[here] or not self.may_leave(ctx, g):
                    continue
                if node not in self.reachable(view, here, SEARCH_HOPS, g.units):
                    continue
                if self.spend(ctx, Move(g.id, node)):
                    ctx.used[g.id] = True
                    ctx.standing[here] -= g.units
                    ctx.standing[node] += g.units

    @override
    def bunkers(self) -> int:
        """Economy v2: the personalities that fortify keep ``BUNKERS`` (DEC-41, item 12: the
        bunker replaces Defense)."""
        return self.BUNKERS if self.params["fortify"] > 0 else 0

    def fortify(self, ctx: Ctx) -> None:
        """Defense on the strongest charged group of every own node next to the enemy (and of
        the capital), once: the bonus gathers anew after a fight without a new payment
        (DEC-30). Only while CP stay above the recruit keep."""
        if self.params["fortify"] <= 0:
            return
        keep = self.params["recruit_keep"]
        by_node: dict[int, list[GroupView]] = {}
        for g in self.free_groups(ctx):
            by_node.setdefault(node_of(g), []).append(g)
        for node in sorted(by_node, key=self.key):
            if not self.hot[node] or any(g.mode is Mode.DEFENSE for g in by_node[node]):
                continue
            charged = [g for g in by_node[node] if g.charged > 0]
            if not charged:
                continue
            best = max(charged, key=lambda g: (g.charged, g.units))
            cmd = SetMode(best.id, Mode.DEFENSE)
            if ctx.budget - self.cost(cmd) >= keep and self.spend(ctx, cmd):
                ctx.used[best.id] = True

    @override
    def may_leave(self, ctx: Ctx, g: GroupView) -> bool:
        here = node_of(g)
        if self.pinned[here]:
            return False  # DEC-37: caught on the way out, it fights outside the node
        if self.watch[here] and ctx.standing[here] - g.units < 1:
            return False  # the scout stays (DEC-35)
        if here == self.home:
            if self.alarm:
                return False
            return ctx.standing[here] - g.units >= self.params["guard"]
        if self.hot[here]:
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
            if spare < 2 or g.units <= spare:
                continue
            army = self.fake_group(g, spare, min(spare, g.charged))
            # Item 18: on a settled map the spare units of the capital march to the objective
            # even without a target in reach (a pile at home earns nothing).
            rally = self.MID_RALLY and self.settled() and here == self.home and g.charged > keep
            if (rally or self.options(ctx, [army])) and self.spend(ctx, Split(g.id, spare)):
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
            if ahead and not self.attacked_at and not fresh:
                return False  # ahead and nothing committed: wait for the enemy to move
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
        most damaging enemy node; the rest at the enemy capital."""
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
        would lose its connection to the enemy capital, plus a quarter of 100 per road level of
        the network roads into it (public ownership, known road levels)."""
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
        roads = sum(
            100 * view.edges[e].width
            for e in self.incident[node]
            if self.map.edges[e].other(node) in net
        )
        return 100 * lost + roads // 4

    # Roads ----------------------------------------------------------------------------------

    def build_roads(self, ctx: Ctx) -> None:
        """One road at a time (DEC-28, item 7): while no own road is being built and
        ``road_keep`` CP stay after the price, the own internal road whose ends are not next to
        the enemy: an artery first (``arteries``), then the most speed and throughput gain; ties
        to the road nearer the own capital, then the edge key (mirror-invariant)."""
        view = ctx.view
        keep = self.params["road_keep"]
        if ctx.budget - self.rules.orders.cost.build < keep:
            return
        if any(e.build is not None and e.upgrade_gain is not None for e in view.edges):
            return
        hops = self.hops[self.home]
        artery = self.arteries(view)
        best: tuple[bool, int, int, int] | None = None
        best_edge: int | None = None
        for e, edef in enumerate(self.map.edges):
            gain = view.edges[e].upgrade_gain
            if gain is None or not self.can_upgrade(view, e):
                continue
            if self.hot[edef.a] or self.hot[edef.b]:
                continue
            value = gain.speed_pct + gain.unit_speed_pct + 100 * gain.amount
            rank = (not artery[e], -value, min(hops[edef.a], hops[edef.b]), self.edge_keys[e])
            if best is None or rank < best:
                best, best_edge = rank, e
        if best_edge is not None:
            self.spend(ctx, UpgradeRoad(best_edge))

    def arteries(self, view: PlayerView) -> list[bool]:
        """By edge: on a shortest way in hops over own nodes from the own capital to a city with
        a front marker (the supply runs along it, DEC-28, items 4 and 7). Ways by ``node_key``
        order of the neighbours (mirror-invariant)."""
        me = self.player
        found = [False] * len(self.map.edges)
        if view.nodes[self.home].owner != me:
            return found
        parent: dict[int, int] = {self.home: self.home}
        queue = deque([self.home])
        while queue:
            node = queue.popleft()
            for other in self.neighbors[node]:
                if other not in parent and view.nodes[other].owner == me:
                    parent[other] = node
                    queue.append(other)
        for marker in view.me.fronts:
            node = marker
            while node is not None and node in parent and parent[node] != node:
                up = parent[node]
                found[self.edge_between[(node, up)]] = True
                node = up
        return found

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

    @override
    def fronts(self, view: PlayerView) -> list[Command]:
        """The front markers of ``Bot.fronts`` with hysteresis (module docstring, item 6).

        A marker moves only to a wanted city without one (the first ``front_cities``) and only
        when its own city is lost, cut off or doomed, or ranks below the wanted ones plus one and
        was set at least ``FRONT_HOLD`` ticks ago; an attacked wanted city without a marker ends
        the hold (its defenders need the charges first). With no wanted city free a marker stays
        on its own supplied city: a full rear warehouse does no harm.
        """
        cities = self.front_cities(view)
        count = len(view.me.fronts)
        wanted = cities[:count]
        near = cities[: count + 1]
        fronts = list(view.me.fronts)
        if len(self.front_set) != count:
            self.front_set = [None] * count
        supplied = self.supplied(view)
        free = [n for n in wanted if n not in fronts]
        urgent = any(n in self.arrive for n in free)
        cmds: list[Command] = []
        for i, node in enumerate(fronts):
            since = self.front_set[i]
            held = since is not None and view.tick - since < FRONT_HOLD and not urgent
            valid = node is not None and supplied[node] and not self.doomed[node]
            if valid and (node in near or held or not free):
                continue
            new = free.pop(0) if free else None
            if new != node:
                cmds.append(SetFront(i, new))
                self.front_set[i] = view.tick
        return cmds

    @override
    def front_cities(self, view: PlayerView) -> list[int]:
        """The front cities an enemy is heading into first, then the base order; never a doomed
        city (its warehouse would be lost, DEC-26, item 4)."""
        cities = [n for n in super().front_cities(view) if not self.doomed[n]]
        attacked = [n for n in cities if n in self.arrive]
        return attacked + [n for n in cities if n not in self.arrive]

    # Supply ---------------------------------------------------------------------------------

    def _is_city(self, node: int) -> bool:
        return self.map.nodes[node].kind is not NodeKind.PROVINCE

    def _waiting(self, view: PlayerView) -> list[int]:
        """Own units without a charge standing in each node."""
        wait = [0] * len(view.nodes)
        for g in view.groups:
            loc = g.location
            if isinstance(loc, AtNode):
                wait[loc.node] += g.units - g.charged
        return wait

    def evacuate(self, ctx: Ctx) -> None:
        """A doomed own city cancels its recruit queue and ships the charges its own units do not
        need to the nearest safe own city (module docstring, item 6)."""
        view = ctx.view
        doomed = [n for n in range(len(view.nodes)) if self.doomed[n]]
        if not doomed or not self.tempo.insight:
            return
        parts = own_parts(view, self.map)
        incoming = incoming_charges(view)
        wait = self._waiting(view)
        for node in sorted(doomed, key=self.key):
            n = view.nodes[node]
            if n.owner != self.player or not self._is_city(node):
                continue
            if n.recruit_queue:
                self.spend(ctx, CancelRecruit(node))
            spare = (n.warehouse or 0) - wait[node]
            if spare <= 0:
                continue
            best: tuple[int, int] | None = None
            room = dest = 0
            for other in range(len(view.nodes)):
                if other == node or parts[other] != parts[node] or self.doomed[other]:
                    continue
                o = view.nodes[other]
                if not self._is_city(other) or o.warehouse_cap is None:
                    continue
                free = o.warehouse_cap - (o.warehouse or 0) - incoming.get(other, 0)
                rank = (self.travel.ticks[node][other], self.key(other))
                if free > 0 and (best is None or rank < best):
                    best, room, dest = rank, free, other
            if best is not None:
                self.spend(ctx, Transfer(node, dest, min(spare, room)))

    def set_rear_min(self, ctx: Ctx) -> None:
        """``SetRearMin`` by the module docstring, item 6, at most once per ``REAR_MIN_TICKS``."""
        view = ctx.view
        if self.rear_tick is not None and ctx.tick - self.rear_tick < REAR_MIN_TICKS:
            return
        wait = self._waiting(view)
        supply = self.rules.supply
        now = view.me.rear_min
        # Hysteresis: a setting holds until the reason for it is half gone.
        starving = any(
            m is not None
            and (
                (wait[m] >= FEED_MIN and not view.nodes[m].warehouse)
                or (now == 0 and wait[m] > (view.nodes[m].warehouse or 0))
            )
            for m in view.me.fronts
        )
        home = view.nodes[self.home]
        stock, cap = home.warehouse or 0, home.warehouse_cap or 0
        full = (
            home.owner == self.player
            and cap > 0
            and (stock >= cap or (now == self.params["rear_full"] and 2 * stock >= cap))
        )
        if starving:
            want = 0
        elif full:
            want = self.params["rear_full"]
        else:
            want = supply.rear_min_default
        want = min(want, supply.rear_min_max)
        if want != view.me.rear_min and self.spend(ctx, SetRearMin(want)):
            self.rear_tick = ctx.tick

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
            if ctx.standing[node] + queue + 1 > n.capacity:
                continue
            cities.append(node)
        if not cities:
            return
        city = min(cities, key=lambda c: (hops[c], self.key(c)))
        if self.spend(ctx, Recruit(city)):
            self.recruited[city] = ctx.tick

    def recruits_in(self, view: PlayerView, node: int) -> bool:
        """``Recruit`` is allowed in the own city ``node`` by the barracks (DEC-26, item 11) or by
        ``recruit.location`` (DEC-25, item 8)."""
        if self.rules.city_upgrades.enabled:
            return bool(view.nodes[node].has_barracks)
        if self.rules.recruit.location is RecruitLocation.CAPITAL:
            return node == self.home
        return True

    def unbank(self, ctx: Ctx) -> None:
        """While the capital is in danger, production moves to the capital (its recruits stand
        where the threat comes): when the CP do not pay for a recruit there, the last unit of the
        queue of every other own city is cancelled (DEC-25, item 11), a full refund for a unit
        that has not started, a half for one in production (item 3); the next decision queues
        it in the capital (``defend_capital``)."""
        view = ctx.view
        if not self.alarm or ctx.budget >= self.cost(Recruit(self.home)):
            return
        if not self.can_queue(view, self.home, ctx.standing[self.home]):
            return
        for n in view.nodes:
            if n.owner == self.player and n.id != self.home and n.recruit_queue:
                self.spend(ctx, CancelRecruit(n.id))

    def supply_target(self, view: PlayerView, node: int) -> int:
        """The supply target of the own city ``node`` (DEC-28, item 5): a full warehouse with a
        marker, 0 for the capital without one, else ``min(rear_min, capacity)``."""
        cap = view.nodes[node].warehouse_cap or 0
        if node in view.me.fronts:
            return cap
        if node == self.home:
            return 0
        return min(view.me.rear_min, cap)

    def feed(self, ctx: Ctx) -> None:
        """One ``Transfer`` to the city without a marker where the most own units wait for
        charges that are neither there nor on the way (at least ``FEED_MIN``), from the nearest
        own city with a stock above its target (module docstring, item 6)."""
        view = ctx.view
        me = self.player
        wait = self._waiting(view)
        incoming = incoming_charges(view)
        fronts = view.me.fronts
        short: list[tuple[int, int]] = []
        for n in view.nodes:
            node = n.id
            if n.owner != me or not self._is_city(node) or node in fronts or self.doomed[node]:
                continue
            if n.warehouse_cap is None or wait[node] < FEED_MIN:
                continue
            lack = wait[node] - (n.warehouse or 0) - incoming.get(node, 0)
            room = n.warehouse_cap - (n.warehouse or 0) - incoming.get(node, 0)
            if lack >= FEED_MIN and room > 0:
                short.append((node, min(lack, room)))
        if not short:
            return
        dest, amount = min(short, key=lambda s: (-s[1], self.key(s[0])))
        parts = own_parts(view, self.map)
        best: tuple[int, int] | None = None
        give = 0
        src = dest
        for n in view.nodes:
            node = n.id
            if node == dest or parts[node] != parts[dest] or self.doomed[node]:
                continue
            if not self._is_city(node) or n.warehouse is None:
                continue
            spare = n.warehouse - self.supply_target(view, node) - wait[node]
            rank = (self.travel.ticks[node][dest], self.key(node))
            if spare > 0 and (best is None or rank < best):
                best, give, src = rank, spare, node
        if best is not None:
            self.spend(ctx, Transfer(src, dest, min(amount, give)))

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
            if ctx.standing[node] > 0 or node in heading:
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
                    ctx.standing[node] += 1
            elif self.spend(ctx, Split(best.id, best.units - 1)):
                ctx.used[best.id] = True
                self.scouted[node] = ctx.tick


# The personalities: the BOT-02 and BOT-03 bots as thresholds and weights of ``SmartBot``. ------


class SmartRusher(SmartBot):
    """Early pressure (``RusherBot``): War, a small guard, the weak cities near the enemy
    capital first, neutral cities only as a side dish."""

    name: ClassVar[str] = "smart_rusher"
    STANCE: ClassVar[Stance] = Stance.WAR
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
    }


class SmartStrangler(SmartBot):
    """Cuts the enemy roads and besieges (``StranglerBot``): the most damaging city in reach,
    a held cut-off city keeps a garrison."""

    name: ClassVar[str] = "smart_strangler"
    STANCE: ClassVar[Stance] = Stance.BALANCE
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
    STANCE: ClassVar[Stance] = Stance.BALANCE
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
    STANCE: ClassVar[Stance] = Stance.WAR
    LATE_STANCE: ClassVar[Stance | None] = Stance.BALANCE
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
    }


class SmartTurtle(SmartBot):
    """The bunker that holds the VP lead (#663, item 19 of the module docstring).

    - *Opening*: it claims its natural half of the map (the nodes no farther from the own capital
      than from the enemy one), one ring more while the CP are about to burn; Economy (v1).
    - *Hold* (the territory split, the VP forecast ahead): no attack outside the own half; every
      own node next to the enemy keeps a garrison sized to the enemy shots that can reach it
      (``estimate.threats``, at least ``hold_front``, at most ``hold_front + FRONT_EXTRA``), the
      spare army stands in the most threatened front city, the front cities get the bunkers
      (v2) and Defense (v1), lost nodes of the own half are retaken first.
    - *Push* (the forecast not ahead): a slow advance, one enemy node next to the own territory
      at a time, the weakest sector first (``weak_spot``), with the bunker's margin; the army
      rallies there. The late game without a lead goes all in like every smart bot (item 1).
    """

    name: ClassVar[str] = "smart_turtle"
    STANCE: ClassVar[Stance] = Stance.ECONOMY
    BUNKERS: ClassVar[int] = 6
    FRONT_EXTRA: ClassVar[int] = 3
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
