"""Factory sites of the bots under ``mvp-7`` (#683; DEC-41 item 2, DEC-43 items H and J, DEC-47).

The site is a rear city: at least two hops from every enemy node, reached from the own capital over
own nodes none of which touches an enemy node (one capture at the front does not cut it into a
pocket, where a factory stops, DEC-43 item H2); the farthest from the enemy nodes first (up to
``SITE_DEPTH_CAP``), then the nearest to the own capital. A build starts only from spare stock (the
warehouses of the capital's component beyond what the own discharged units there want) and only
while the match left pays it back at the period of the own stance (DEC-47: a built factory makes a
charge per capital period of its owner's stance, after map tempo); a lost site is never built
again, and past ``FACTORY_RESTARTS`` unpaid losses (a factory lost before it made ``factory.cost``
charges) no factory is built. Every case runs for player 0 and, mirrored, for player 1 (the map
symmetry, ``MapDef.mirror_nodes``).

The layout is ``crossroads`` (player 0's names; 49 nodes, so map tempo leaves the periods as they
are: Economy 100, Balance 200, War 400 ticks per charge): the capital 0; the cities 1, 4, 6, 7, 8
and the provinces 2, 3 around it; 7 (the large city) is next to the capital, 1 and 4 are the flanks.
"""

from dataclasses import replace
from pathlib import Path

import pytest

from gow_bots.bots import SmartRusher
from gow_bots.bots.factories import (
    FACTORY_DELIVERY_TICKS,
    FACTORY_PROFIT,
    FACTORY_RESTARTS,
    FactorySites,
    factory_site,
    payback,
    safe_rear,
    spare_stock,
)
from gow_sim.maps import MapDef, load_map
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset, Stance, load_ruleset
from gow_sim.view import AtNode, PlayerView, SelfView, SiteBuildView

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))
EXTRA = 2
"""``CampaignBot.FACTORIES``: two factories beside the capital (``factory.max = 3``)."""


@pytest.fixture(scope="module")
def crossroads() -> MapDef:
    return load_map(ROOT / "maps" / "crossroads.json")


@pytest.fixture(scope="module")
def rules(crossroads: MapDef) -> Ruleset:
    """The rules a ``crossroads`` match of ``mvp-7`` plays (map tempo applied: 100%)."""
    return Match(crossroads, load_ruleset(ROOT / "rulesets" / "mvp-7.toml"), KEY).rules


def _node(mapdef: MapDef, player: int, node: int) -> int:
    """Player 0's node id as the node of ``player`` (the mirror node for player 1)."""
    return node if player == 0 else mapdef.mirror_nodes[node]


def _setup(
    rules: Ruleset, mapdef: MapDef, player: int, enemy: tuple[int, ...]
) -> tuple[SmartRusher, PlayerView]:
    """The start of the match with ``enemy`` (player 0's names) made the opponent's; an own start
    garrison standing there is removed first. One tick is played."""
    match = Match(mapdef, rules, KEY)
    state = match.state
    for node in (_node(mapdef, player, n) for n in enemy):
        for gid in sorted(state.groups):
            loc = state.groups[gid].location
            if isinstance(loc, AtNode) and loc.node == node:
                del state.groups[gid]
        state.nodes[node].owner = 1 - player
    match.step()
    return SmartRusher(mapdef, rules, seed=1, player=player), match.view(player)


def _site(bot: SmartRusher, view: PlayerView, memory: FactorySites | None = None) -> int | None:
    return factory_site(bot, view, EXTRA, memory or FactorySites(), bot.supplied(view))


def _warehouses(view: PlayerView, stock: dict[int, int]) -> PlayerView:
    nodes = list(view.nodes)
    for node, value in stock.items():
        nodes[node] = replace(nodes[node], warehouse=value)
    return replace(view, nodes=tuple(nodes))


@pytest.mark.parametrize("player", [0, 1])
def test_the_deepest_rear_city_is_picked(rules: Ruleset, crossroads: MapDef, player: int) -> None:
    """The enemy holds province 11 next to cities 6 and 7: the rear cities are 1, 4 and 8; 4 is 3
    hops from 11 (``SITE_DEPTH_CAP``), 1 and 8 are 2, so 4 is the site."""
    bot, view = _setup(rules, crossroads, player, (11,))
    rear = safe_rear(bot, view)
    for n in (6, 7):
        assert _node(crossroads, player, n) not in rear  # next to the enemy
    for n in (1, 4, 8):
        assert _node(crossroads, player, n) in rear
    assert _site(bot, view) == _node(crossroads, player, 4)


@pytest.mark.parametrize("player", [0, 1])
def test_without_an_enemy_near_the_city_next_to_the_capital_is_picked(
    rules: Ruleset, crossroads: MapDef, player: int
) -> None:
    """At the start every own city is far from the enemy (beyond ``SITE_DEPTH_CAP``): the nearest
    to the own capital wins, the large city 7 next to it."""
    bot, view = _setup(rules, crossroads, player, ())
    assert _site(bot, view) == _node(crossroads, player, 7)


@pytest.mark.parametrize("player", [0, 1])
def test_a_city_next_to_an_enemy_node_is_no_site(
    rules: Ruleset, crossroads: MapDef, player: int
) -> None:
    """The enemy also holds province 9 next to city 4: 4 is out; 1 and 8 are both 2 hops from an
    enemy node and 2 roads from the capital."""
    bot, view = _setup(rules, crossroads, player, (11, 9))
    assert _node(crossroads, player, 4) not in safe_rear(bot, view)
    assert _site(bot, view) in (_node(crossroads, player, 1), _node(crossroads, player, 8))


@pytest.mark.parametrize("player", [0, 1])
def test_a_city_reached_only_past_the_front_is_no_site(
    rules: Ruleset, crossroads: MapDef, player: int
) -> None:
    """The enemy holds city 7: both provinces next to the capital (2 and 3) touch it, so every own
    route to cities 1, 4 and 8 passes a node next to the enemy. City 4 is 2 hops from 7, yet one
    capture of 3 would cut it into a pocket: no site."""
    bot, view = _setup(rules, crossroads, player, (7,))
    assert safe_rear(bot, view) == {crossroads.capital(player): 0}
    assert _site(bot, view) is None


@pytest.mark.parametrize("player", [0, 1])
def test_no_build_without_spare_stock(rules: Ruleset, crossroads: MapDef, player: int) -> None:
    """``factory.cost = 4``: the warehouses of the capital's component must hold 4 beyond the own
    units without a charge standing in it."""
    assert rules.factory.cost == 4
    bot, view = _setup(rules, crossroads, player, (11,))
    capital = crossroads.capital(player)
    own = [n.id for n in view.nodes if n.owner == player]
    empty = _warehouses(view, dict.fromkeys(own, 0))
    assert spare_stock(bot, empty, bot.supplied(empty)) == 0
    assert _site(bot, empty) is None
    four = _warehouses(empty, {capital: 4})
    assert spare_stock(bot, four, bot.supplied(four)) == 4
    assert _site(bot, four) == _node(crossroads, player, 4)
    groups = list(four.groups)
    at = next(
        i
        for i, g in enumerate(groups)
        if isinstance(g.location, AtNode) and g.location.node == capital
    )
    groups[at] = replace(groups[at], charged=groups[at].units - 1)  # one unit waits for a charge
    tired = replace(four, groups=tuple(groups))
    assert spare_stock(bot, tired, bot.supplied(tired)) == 3
    assert _site(bot, tired) is None


def _late(view: PlayerView, tick: int, stance: Stance) -> PlayerView:
    me: SelfView = replace(view.me, stance=stance)
    return replace(view, tick=tick, me=me)


@pytest.mark.parametrize("player", [0, 1])
def test_a_late_factory_must_pay_back_at_the_stance_period(
    rules: Ruleset, crossroads: MapDef, player: int
) -> None:
    """2000 ticks left: a factory done after its build time (100) and the delivery allowance
    makes 4 charges under War (400 ticks each), 9 under Balance (200): only the Balance one pays
    ``factory.cost`` plus ``FACTORY_PROFIT`` back."""
    assert (rules.factory.build_ticks, FACTORY_DELIVERY_TICKS, FACTORY_PROFIT) == (100, 50, 2)
    bot, view = _setup(rules, crossroads, player, (11,))
    tick = rules.match_ticks - 2000
    war, balance = _late(view, tick, Stance.WAR), _late(view, tick, Stance.BALANCE)
    assert (payback(rules, war), payback(rules, balance)) == (4, 9)
    assert _site(bot, war) is None
    assert _site(bot, balance) == _node(crossroads, player, 4)


def _with_build(view: PlayerView, node: int, tick: int | None = None) -> PlayerView:
    nodes = list(view.nodes)
    nodes[node] = replace(nodes[node], factory_build=SiteBuildView(None, 4))
    return replace(view, nodes=tuple(nodes), tick=view.tick if tick is None else tick)


def _lost(view: PlayerView, node: int, tick: int | None = None) -> PlayerView:
    nodes = list(view.nodes)
    nodes[node] = replace(nodes[node], owner=1 - view.player, factory_build=None, factory=None)
    return replace(view, nodes=tuple(nodes), tick=view.tick if tick is None else tick)


def _factory(view: PlayerView, node: int, tick: int, *, pocket: bool = False) -> PlayerView:
    """``view`` at ``tick`` with an own built factory in ``node`` making a charge every 200 ticks
    (Balance), in a pocket or not."""
    nodes = list(view.nodes)
    nodes[node] = replace(
        nodes[node], factory=True, factory_period=200, factory_build=None, flow_pocket=pocket
    )
    return replace(view, tick=tick, nodes=tuple(nodes))


@pytest.mark.parametrize("player", [0, 1])
def test_a_lost_site_is_not_rebuilt_and_the_restarts_are_capped(
    rules: Ruleset, crossroads: MapDef, player: int
) -> None:
    """A factory build at 4 is captured: 4 is never a site again (while the enemy holds it, 8 next
    to it is out too and the site is 1; once 4 is own again, 8); once a build at 1 is lost too
    (more than ``FACTORY_RESTARTS`` losses), no factory is started."""
    assert FACTORY_RESTARTS == 1
    bot, view = _setup(rules, crossroads, player, (11,))
    four, one = _node(crossroads, player, 4), _node(crossroads, player, 1)
    eight = _node(crossroads, player, 8)
    memory = FactorySites()
    assert _site(bot, _with_build(view, four), memory) is None  # one at a time
    assert _site(bot, _lost(view, four), memory) == one  # 4 is the enemy's now
    assert memory.lost == {four: True}
    assert _site(bot, view, memory) in (one, eight)  # 4 is own again: still no site
    assert _site(bot, _with_build(view, one), memory) is None
    assert _site(bot, _lost(view, one), memory) is None  # past the restarts
    assert memory.lost == {four: True, one: True}
    assert _site(bot, view, memory) is None


@pytest.mark.parametrize("player", [0, 1])
def test_a_factory_that_paid_back_is_no_loss_for_the_restarts(
    rules: Ruleset, crossroads: MapDef, player: int
) -> None:
    """A factory that worked 800 ticks at 200 ticks a charge made its cost (4): two such factories
    lost (at 4, then at 1) leave the restarts untouched, so a third site (8) is still offered.
    The lost sites stay excluded."""
    bot, view = _setup(rules, crossroads, player, (11,))
    four, one = _node(crossroads, player, 4), _node(crossroads, player, 1)
    eight = _node(crossroads, player, 8)
    memory = FactorySites()
    assert _site(bot, _with_build(view, four, 100), memory) is None
    assert _site(bot, _factory(view, four, 200), memory) in (one, eight)  # the second one
    assert _site(bot, _lost(view, four, 1000), memory) == one
    assert memory.unpaid == 0 and memory.lost == {four: True}
    assert _site(bot, _with_build(view, one, 1100), memory) is None
    assert _site(bot, _factory(view, one, 1200), memory) == eight
    assert _site(bot, _lost(view, one, 2000), memory) == eight
    assert memory.unpaid == 0 and memory.lost == {four: True, one: True}


@pytest.mark.parametrize("player", [0, 1])
def test_a_factory_lost_before_it_paid_back_counts(
    rules: Ruleset, crossroads: MapDef, player: int
) -> None:
    """A factory lost after 795 ticks of work made 3 charges (rounded down): an unpaid loss. One
    that stood 800 ticks in a pocket made nothing (DEC-43, item H2): unpaid too. Past
    ``FACTORY_RESTARTS`` (1) unpaid losses no factory is started."""
    bot, view = _setup(rules, crossroads, player, (11,))
    four, one = _node(crossroads, player, 4), _node(crossroads, player, 1)
    memory = FactorySites()
    assert _site(bot, _with_build(view, four, 100), memory) is None
    _site(bot, _factory(view, four, 200), memory)
    _site(bot, _factory(view, four, 995), memory)
    assert _site(bot, _lost(view, four, 995), memory) == one
    assert memory.unpaid == 1
    assert _site(bot, _with_build(view, one, 1100), memory) is None
    _site(bot, _factory(view, one, 1200, pocket=True), memory)
    _site(bot, _factory(view, one, 2000, pocket=True), memory)
    assert _site(bot, _lost(view, one, 2000), memory) is None
    assert memory.unpaid == 2
