"""#624: the benchmark ``smart_hoarder`` and the converging strike of ``SmartBot`` (item 12).

Expected values come from the rules and the map: the travel time of mechanics.md, section 4
("Speed by terrain by zones", the road speed of DEC-28, item 7), the plan bonus of DEC-29 (the
edges of the path, capped by the charged units), the delay ``orders.planned_delay_ticks`` and the
prices of DEC-08, ``shots_to_take`` of DEC-07, the capacities of DEC-22 and the owner's strike in
``docs/balance/playtest-2026-10-30.md`` (the stage Middle Court next to the bot capital, the
centre Crossroads).
"""

import dataclasses
from collections.abc import Sequence
from pathlib import Path
from typing import ClassVar

import pytest

from gow_bots.bots import BOTS, SmartHoarder, bot_factory
from gow_bots.bots.assess import edge_ticks
from gow_bots.bots.campaign import Ctx
from gow_bots.bots.smart import STRIKE_ALIGN, SmartBot
from gow_bots.bots.utility import shots_to_take
from gow_sim.commands import PlayerCommand
from gow_sim.maps import MapDef, load_map
from gow_sim.match import Match, run_headless
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.state import AtNode
from gow_sim.systems.movement import traversal_ticks

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))


@pytest.fixture(scope="module")
def rules() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "mvp-2.toml")


@pytest.fixture(scope="module")
def crossroads() -> MapDef:
    return load_map(ROOT / "maps" / "crossroads.json")


def _named(mapdef: MapDef, name: str) -> int:
    return next(n.id for n in mapdef.nodes if n.name == name)


def test_the_hoarder_is_registered_with_its_params_in_range(
    crossroads: MapDef, rules: Ruleset
) -> None:
    assert BOTS["smart_hoarder"] is SmartHoarder
    assert SmartHoarder.STRIKE and not SmartBot.STRIKE
    for seed in range(10):
        bot = SmartHoarder(crossroads, rules, seed=seed, player=seed % 2)
        for key, r in SmartHoarder.PARAMS.items():
            assert r.low <= bot.params[key] <= r.high
    assert isinstance(
        bot_factory("smart_hoarder@easy")(crossroads, rules, seed=0, player=0), SmartHoarder
    )


def test_stage_and_centre_on_crossroads(crossroads: MapDef, rules: Ruleset) -> None:
    # Side 1 (Core) stages in Middle Court next to Nexus, the owner's stage; side 0 in its
    # mirror. The centre is Crossroads for both (the large city at 4 hops from either capital).
    human = SmartHoarder(crossroads, rules, seed=0, player=1)
    assert human.stage == _named(crossroads, "Middle Court")
    assert human.centre == _named(crossroads, "Crossroads")
    bot = SmartHoarder(crossroads, rules, seed=0, player=0)
    assert bot.stage == crossroads.mirror_nodes[human.stage]
    assert bot.centre == human.centre == crossroads.mirror_nodes[human.centre]
    assert crossroads.nodes[human.stage].kind.value == "city_large"


def test_edge_ticks_is_the_travel_time_of_the_rules(crossroads: MapDef, rules: Ruleset) -> None:
    for e, edge in enumerate(crossroads.edges):
        for to in (edge.a, edge.b):
            for level in (1, 2, 3):
                expected = traversal_ticks(crossroads, rules, e, to, level)
                assert edge_ticks(crossroads, rules, e, to, level) == expected


def test_way_follows_the_fastest_own_path(crossroads: MapDef, rules: Ruleset) -> None:
    view = Match(crossroads, rules, KEY).view(1)
    bot = SmartHoarder(crossroads, rules, seed=0, player=1)
    home = crossroads.capital(1)
    for e in crossroads.incident[home]:
        other = crossroads.edges[e].other(home)
        # A neutral neighbour ends the path: one edge at the level 1 time.
        assert bot.way(view, home, other, 1) == (1, edge_ticks(crossroads, rules, e, other))
    # The enemy capital is beyond neutral nodes: no own path reaches it at the start.
    assert bot.way(view, home, crossroads.capital(0), 1) is None


def test_an_unseen_capital_counts_the_guessed_garrison(crossroads: MapDef, rules: Ruleset) -> None:
    view = Match(crossroads, rules, KEY).view(1)
    bot = SmartHoarder(crossroads, rules, seed=0, player=1)
    bot.decide(view, 0)
    ctx = Ctx(view, 0, view.me.cp, standing=bot.standing(view))
    guess = bot.params["strike_guess"]
    terrain = crossroads.nodes[crossroads.capital(0)].terrain
    expected = shots_to_take(rules, terrain, guess, guess) + bot.params["strike_margin"]
    assert bot.strike_need(ctx) == expected


def test_a_far_small_group_of_a_strike_goes_planned(crossroads: MapDef, rules: Ruleset) -> None:
    bot = SmartHoarder(crossroads, rules, seed=0, player=1)
    view = Match(crossroads, rules, KEY).view(1)
    g = next(iter(view.groups))
    two = dataclasses.replace(g, units=2, charged=2)
    one = dataclasses.replace(g, units=2, charged=1)
    # DEC-29: two edges and two charged units bring the whole bonus of 2; one edge brings 1.
    assert bot.plan_strike(two, 3, 2)
    assert not bot.plan_strike(two, 3, 1)
    assert not bot.plan_strike(one, 3, 3)  # capped at 1 charged unit


class _StrikeLog:
    """The hoarder's orders into the enemy capital, their arrivals and the fights there."""

    def __init__(self, side: int) -> None:
        self.side = side
        self.orders: dict[int, tuple[int, bool]] = {}
        """Internal group id to the tick of its order and whether it was planned."""
        self.arrived: dict[int, int] = {}
        self.fight_groups = 0
        self.stage_owned: int | None = None

    def begin(self, match: Match) -> None:
        self.mapdef = match.state.map
        self.target = self.mapdef.capital(1 - self.side)

    def record(self, match: Match, commands: Sequence[PlayerCommand]) -> None:
        st = match.state
        stage = _named(self.mapdef, "Middle Court")
        if self.stage_owned is None and st.nodes[stage].owner == self.side:
            self.stage_owned = st.tick
        for g in st.groups.values():
            if g.owner != self.side:
                continue
            o = g.order
            if o is not None and o.path[-1] == self.target and g.id not in self.orders:
                self.orders[g.id] = (st.tick, o.planned)
            fight = st.fights.get(g.fight) if g.fight is not None else None
            there = g.location == AtNode(self.target) or (
                fight is not None and fight.node == self.target
            )
            if g.id in self.orders and g.id not in self.arrived and there:
                self.arrived[g.id] = st.tick
        for f in st.fights.values():
            if f.node == self.target:
                mine = sum(1 for m in f.members.values() if m.player == self.side)
                self.fight_groups = max(self.fight_groups, mine)


def test_the_hoarder_stages_and_strikes_like_the_owner(crossroads: MapDef, rules: Ruleset) -> None:
    # A full match on the owner's map against the normal level (seed fixed: the bots are
    # deterministic). The owner's strike: Middle Court taken first, then 2-4 groups, at least one
    # planned, joining one capital fight.
    side = 1
    bots = [
        bot_factory("smart_reactive@easy")(crossroads, rules, seed=1, player=0),
        bot_factory("smart_hoarder")(crossroads, rules, seed=1, player=side),
    ]
    log = _StrikeLog(side)
    result = run_headless(crossroads, rules, bots, observer=log)
    assert log.orders, "no strike"
    first = min(t for t, _ in log.orders.values())
    assert log.stage_owned is not None and log.stage_owned < first
    episode = [g for g, (t, _) in log.orders.items() if t - first <= 300]
    assert len(episode) >= 2
    assert any(log.orders[g][1] for g in episode)
    arrivals = [log.arrived[g] for g in episode if g in log.arrived]
    assert len(arrivals) >= 2
    # The groups arrive within the alignment of the slowest one (a decision every 5 ticks and
    # the round of a fight it joins add a few ticks).
    assert max(arrivals) - min(arrivals) <= 2 * STRIKE_ALIGN + 20
    assert log.fight_groups >= 2
    assert result.outcome is not None


def _mirrored(cls: type[SmartBot]) -> type[SmartBot]:
    class Mirrored(cls):
        name: ClassVar[str] = cls.name

        def __init__(self, mapdef: MapDef, rules: Ruleset, *, seed: int, player: int) -> None:
            super().__init__(mapdef, rules, seed=seed, player=player)
            twin = cls(mapdef, rules, seed=seed, player=0)
            self.params, self.rng = twin.params, twin.rng

    return Mirrored


def test_hoarder_self_play_is_a_draw(crossroads: MapDef, rules: Ruleset) -> None:
    # Mirror-invariant: the stage, the centre, the strike timing and every tie-break by
    # ``node_key``; nothing but the opaque ids differs between the sides.
    cls = _mirrored(SmartHoarder)
    bots = [cls(crossroads, rules, seed=3, player=p) for p in (0, 1)]
    result = run_headless(crossroads, rules, bots)
    assert result.vp[0] == result.vp[1]
    assert result.accepted[0] == result.accepted[1]


def test_strike_groups_are_committed_and_kept_in_the_fight(
    crossroads: MapDef, rules: Ruleset
) -> None:
    bot = SmartHoarder(crossroads, rules, seed=0, player=1)
    bot.strike_sent[7] = 100
    assert bot.committed(7) and not bot.committed(8)
    plain = bot_factory("smart_expander")(crossroads, rules, seed=0, player=1)
    assert isinstance(plain, SmartBot) and not plain.committed(7)
