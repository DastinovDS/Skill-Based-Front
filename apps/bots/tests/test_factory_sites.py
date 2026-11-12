"""Factory sites of the bots under ``mvp-7`` (#683; DEC-41 item 2, DEC-43 items H and J, DEC-47).

The site is a rear city: at least ``SITE_DEPTH`` (3) roads from every enemy node, reached from the
own capital over own nodes none of which touches an enemy node (one capture at the front does not
cut it into a pocket, where a factory stops, DEC-43 item H2); the farthest from the enemy nodes
first (up to ``SITE_DEPTH_CAP``), then the nearest to the own capital. A build starts only while
no own unit waits for a charge the warehouses of the capital's component do not hold, not while
the enemy holds more nodes, and only while the match left pays it back at the
period of the own stance (DEC-47: a built factory makes a charge per capital period of its owner's
stance, after map tempo); a lost site is never built again, and past ``FACTORY_RESTARTS`` unpaid
losses (a factory lost before it made ``factory.cost`` charges) no factory is built. Every case
runs for player 0 and, mirrored, for player 1 (the map symmetry, ``MapDef.mirror_nodes``).

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
    SITE_DEPTH,
    SITE_DEPTH_CAP,
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
EXTRA_OWN = (5, 9)
"""Two more provinces of the player (on its flanks), so the nodes the cases give the enemy do not
put the player behind on nodes (a factory is not started while losing ground)."""


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
    rules: Ruleset,
    mapdef: MapDef,
    player: int,
    enemy: tuple[int, ...],
    own: tuple[int, ...] = EXTRA_OWN,
) -> tuple[SmartRusher, PlayerView]:
    """The start of the match with ``enemy`` (player 0's names) made the opponent's and ``own``
    the player's; a start garrison standing in a node that changes hands is removed first. One
    tick is played."""
    match = Match(mapdef, rules, KEY)
    state = match.state
    for side, nodes in ((1 - player, enemy), (player, own)):
        for node in (_node(mapdef, player, n) for n in nodes):
            for gid in sorted(state.groups):
                loc = state.groups[gid].location
                if isinstance(loc, AtNode) and loc.node == node:
                    del state.groups[gid]
            state.nodes[node].owner = side
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
def test_the_rear_city_three_roads_from_the_enemy_is_picked(
    rules: Ruleset, crossroads: MapDef, player: int
) -> None:
    """The enemy holds province 12: 7 and 8 touch it, 4 is two roads away (4-8-12); 1 and 6 are
    three (1-2-7-12, 6-2-7-12), the ``SITE_DEPTH``, and two roads from the capital each; 1 wins
    by ``Bot.key``."""
    assert SITE_DEPTH == 3
    bot, view = _setup(rules, crossroads, player, (12,))
    rear = safe_rear(bot, view)
    for n in (7, 8):
        assert _node(crossroads, player, n) not in rear  # next to the enemy
    assert _site(bot, view) == _node(crossroads, player, 1)


@pytest.mark.parametrize("player", [0, 1])
def test_the_deepest_rear_city_is_picked(rules: Ruleset, crossroads: MapDef, player: int) -> None:
    """The enemy holds province 15: 6 and 7 are two roads away (6-11-15, 7-11-15), 1 three
    (1-6-11-15), 4 and 8 four (``SITE_DEPTH_CAP``): of the deepest, 4 wins by ``Bot.key``."""
    assert SITE_DEPTH_CAP == 4
    bot, view = _setup(rules, crossroads, player, (15,))
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
def test_no_site_within_two_roads_of_the_enemy(
    rules: Ruleset, crossroads: MapDef, player: int
) -> None:
    """The enemy holds provinces 11 and 12: every own city is at most two roads from one of them
    (1-6-11, 4-8-12; 6, 7 and 8 touch them), so no factory is started."""
    bot, view = _setup(rules, crossroads, player, (11, 12))
    assert _site(bot, view) is None


@pytest.mark.parametrize("player", [0, 1])
def test_a_city_reached_only_past_the_front_is_no_site(
    rules: Ruleset, crossroads: MapDef, player: int
) -> None:
    """The enemy holds city 7: both provinces next to the capital (2 and 3) touch it, so every own
    route to cities 1, 4 and 8 passes a node next to the enemy, and one capture of 2 or 3 would
    cut them into a pocket: no site."""
    bot, view = _setup(rules, crossroads, player, (7,))
    assert safe_rear(bot, view) == {crossroads.capital(player): 0}
    assert _site(bot, view) is None


@pytest.mark.parametrize("player", [0, 1])
def test_no_factory_while_losing_ground(rules: Ruleset, crossroads: MapDef, player: int) -> None:
    """The enemy holds three more nodes far away (the mirrors of 15, 17 and 19): 11 enemy nodes
    against the player's 10, no factory; with two more own provinces (12 against 11) the site is
    7 again."""
    far = tuple(crossroads.mirror_nodes[n] for n in (15, 17, 19))
    bot, view = _setup(rules, crossroads, player, far)
    assert _site(bot, view) is None
    bot, view = _setup(rules, crossroads, player, far, (*EXTRA_OWN, 11, 12))
    assert _site(bot, view) == _node(crossroads, player, 7)


@pytest.mark.parametrize("player", [0, 1])
def test_no_build_while_a_unit_waits_for_a_charge(
    rules: Ruleset, crossroads: MapDef, player: int
) -> None:
    """Empty warehouses and every unit charged: no unit waits, the build starts (the flow pays it,
    DEC-41 item 7). One unit of the capital without a charge and nothing in stock: it waits, no
    build; one charge in the capital's warehouse covers it, the build starts."""
    bot, view = _setup(rules, crossroads, player, ())
    capital = crossroads.capital(player)
    own = [n.id for n in view.nodes if n.owner == player]
    empty = _warehouses(view, dict.fromkeys(own, 0))
    assert spare_stock(bot, empty, bot.supplied(empty)) == 0
    assert _site(bot, empty) == _node(crossroads, player, 7)
    groups = list(empty.groups)
    at = next(
        i
        for i, g in enumerate(groups)
        if isinstance(g.location, AtNode) and g.location.node == capital
    )
    groups[at] = replace(groups[at], charged=groups[at].units - 1)  # one unit waits for a charge
    tired = replace(empty, groups=tuple(groups))
    assert spare_stock(bot, tired, bot.supplied(tired)) == -1
    assert _site(bot, tired) is None
    one = _warehouses(tired, {capital: 1})
    assert spare_stock(bot, one, bot.supplied(one)) == 0
    assert _site(bot, one) == _node(crossroads, player, 7)


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
    bot, view = _setup(rules, crossroads, player, ())
    tick = rules.match_ticks - 2000
    war, balance = _late(view, tick, Stance.WAR), _late(view, tick, Stance.BALANCE)
    assert (payback(rules, war), payback(rules, balance)) == (4, 9)
    assert _site(bot, war) is None
    assert _site(bot, balance) == _node(crossroads, player, 7)


def _with_build(view: PlayerView, node: int, tick: int | None = None) -> PlayerView:
    nodes = list(view.nodes)
    nodes[node] = replace(nodes[node], factory_build=SiteBuildView(None, 4))
    return replace(view, nodes=tuple(nodes), tick=view.tick if tick is None else tick)


def _lost(view: PlayerView, node: int, tick: int | None = None) -> PlayerView:
    nodes = list(view.nodes)
    nodes[node] = replace(nodes[node], owner=1 - view.player, factory_build=None, factory=None)
    return replace(view, nodes=tuple(nodes), tick=view.tick if tick is None else tick)


def _at(view: PlayerView, tick: int) -> PlayerView:
    return replace(view, tick=tick)


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
    """A factory build at 7 is captured, then 7 is own again: it is never a site again, the site
    is 1 (two roads from the capital, ``Bot.key``); once a build at 1 is lost too (more than
    ``FACTORY_RESTARTS`` losses), no factory is started."""
    assert FACTORY_RESTARTS == 1
    bot, view = _setup(rules, crossroads, player, ())
    seven, one = _node(crossroads, player, 7), _node(crossroads, player, 1)
    memory = FactorySites()
    assert _site(bot, _with_build(view, seven), memory) is None  # one at a time
    _site(bot, _lost(view, seven), memory)
    assert memory.lost == {seven: True}
    assert _site(bot, view, memory) == one  # 7 is own again: still no site
    assert _site(bot, _with_build(view, one), memory) is None
    _site(bot, _lost(view, one), memory)
    assert memory.lost == {seven: True, one: True}
    assert _site(bot, view, memory) is None  # past the restarts


@pytest.mark.parametrize("player", [0, 1])
def test_a_factory_that_paid_back_is_no_loss_for_the_restarts(
    rules: Ruleset, crossroads: MapDef, player: int
) -> None:
    """A factory that worked 800 ticks at 200 ticks a charge made its cost (4): two such factories
    lost (at 7, then at 1) leave the restarts untouched, so a third site (4) is still offered.
    The lost sites stay excluded."""
    bot, view = _setup(rules, crossroads, player, ())
    seven, one = _node(crossroads, player, 7), _node(crossroads, player, 1)
    four = _node(crossroads, player, 4)
    memory = FactorySites()
    assert _site(bot, _with_build(view, seven, 100), memory) is None
    assert _site(bot, _factory(view, seven, 200), memory) == one  # the second one
    _site(bot, _lost(view, seven, 1000), memory)
    assert memory.unpaid == 0 and memory.lost == {seven: True}
    assert _site(bot, _at(view, 1000), memory) == one
    assert _site(bot, _with_build(view, one, 1100), memory) is None
    assert _site(bot, _factory(view, one, 1200), memory) == four
    _site(bot, _lost(view, one, 2000), memory)
    assert _site(bot, _at(view, 2000), memory) == four
    assert memory.unpaid == 0 and memory.lost == {seven: True, one: True}


@pytest.mark.parametrize("player", [0, 1])
def test_a_factory_lost_before_it_paid_back_counts(
    rules: Ruleset, crossroads: MapDef, player: int
) -> None:
    """A factory lost after 795 ticks of work made 3 charges (rounded down): an unpaid loss. One
    that stood 800 ticks in a pocket made nothing (DEC-43, item H2): unpaid too. Past
    ``FACTORY_RESTARTS`` (1) unpaid losses no factory is started."""
    bot, view = _setup(rules, crossroads, player, ())
    seven, one = _node(crossroads, player, 7), _node(crossroads, player, 1)
    memory = FactorySites()
    assert _site(bot, _with_build(view, seven, 100), memory) is None
    _site(bot, _factory(view, seven, 200), memory)
    _site(bot, _factory(view, seven, 995), memory)
    _site(bot, _lost(view, seven, 995), memory)
    assert memory.unpaid == 1
    assert _site(bot, _at(view, 1000), memory) == one
    assert _site(bot, _with_build(view, one, 1100), memory) is None
    _site(bot, _factory(view, one, 1200, pocket=True), memory)
    _site(bot, _factory(view, one, 2000, pocket=True), memory)
    _site(bot, _lost(view, one, 2000), memory)
    assert memory.unpaid == 2
    assert _site(bot, _at(view, 2000), memory) is None
