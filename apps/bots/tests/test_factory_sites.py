"""Factory sites of the bots under the supply flow (#683; DEC-41 item 2, DEC-43 items H and J).

The site is a rear city: no enemy node next to it, not a leaf, reached from the own capital over
own nodes none of which touches an enemy node (one capture at the front does not cut it into a
pocket, where a factory stops, DEC-43 item H2); the deepest first (up to ``SITE_DEPTH`` hops from
every enemy node), then the farthest from the enemy capital. A build starts only from spare stock
(the warehouses of the capital's component beyond what the own discharged units there want), and a
lost site is never built again; past ``FACTORY_RESTARTS`` losses no factory is built. Every case
runs for player 0 and, mirrored, for player 1 (the map symmetry, ``MapDef.mirror_nodes``).

The layout is ``crossroads`` (player 0's names): the capital 0; cities 1, 4, 6, 7, 8 and provinces
2, 3 around it; 1 and 4 are the flanks (9 hops from the enemy capital), 7 the centre (8 hops).
"""

from dataclasses import replace
from pathlib import Path

import pytest

from gow_bots.bots import SmartRusher
from gow_bots.bots.economy import (
    FACTORY_RESTARTS,
    FactorySites,
    factory_site,
    safe_rear,
    spare_stock,
)
from gow_sim.maps import MapDef, load_map
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.view import AtNode, PlayerView, SiteBuildView

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))
EXTRA = 2
"""``CampaignBot.FACTORIES``: two factories beside the capital (``factory.max = 3``)."""


@pytest.fixture(scope="module")
def mvp4() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "mvp-4.toml")


@pytest.fixture(scope="module")
def crossroads() -> MapDef:
    return load_map(ROOT / "maps" / "crossroads.json")


def _node(mapdef: MapDef, player: int, node: int) -> int:
    """Player 0's node id as the node of ``player`` (the mirror node for player 1)."""
    return node if player == 0 else mapdef.mirror_nodes[node]


def _setup(
    rules: Ruleset, mapdef: MapDef, player: int, enemy: tuple[int, ...]
) -> tuple[SmartRusher, PlayerView]:
    """The start of the match with ``enemy`` (player 0's names) made the opponent's; an own start
    garrison standing there is removed first. One tick is played, so the view carries the flow
    field (``front_dist``)."""
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


def _warehouses(view: PlayerView, stock: dict[int, int]) -> PlayerView:
    nodes = list(view.nodes)
    for node, value in stock.items():
        nodes[node] = replace(nodes[node], warehouse=value)
    return replace(view, nodes=tuple(nodes))


@pytest.mark.parametrize("player", [0, 1])
def test_the_deepest_rear_city_is_picked(mvp4: Ruleset, crossroads: MapDef, player: int) -> None:
    """The enemy holds province 11 next to cities 6 and 7: the rear cities are 1, 4 and 8; 4 and 8
    are 3 hops from 11 (``SITE_DEPTH``, 1 is 2), and 4 is the farther from the enemy capital (9
    hops against 8), so it is the site."""
    bot, view = _setup(mvp4, crossroads, player, (11,))
    rear = safe_rear(bot, view)
    for n in (6, 7):
        assert _node(crossroads, player, n) not in rear  # next to the enemy
    for n in (1, 4, 8):
        assert _node(crossroads, player, n) in rear
    assert factory_site(bot, view, EXTRA, FactorySites()) == _node(crossroads, player, 4)


@pytest.mark.parametrize("player", [0, 1])
def test_a_city_next_to_an_enemy_node_is_no_site(
    mvp4: Ruleset, crossroads: MapDef, player: int
) -> None:
    """The enemy also holds province 9 next to city 4: 4 is out; 1 and 8 are both 2 hops from an
    enemy node, and 1 is the farther from the enemy capital (9 hops against 8)."""
    bot, view = _setup(mvp4, crossroads, player, (11, 9))
    assert _node(crossroads, player, 4) not in safe_rear(bot, view)
    assert factory_site(bot, view, EXTRA, FactorySites()) == _node(crossroads, player, 1)


@pytest.mark.parametrize("player", [0, 1])
def test_a_city_reached_only_past_the_front_is_no_site(
    mvp4: Ruleset, crossroads: MapDef, player: int
) -> None:
    """The enemy holds city 7: both provinces next to the capital (2 and 3) touch it, so every own
    route to cities 1, 4 and 8 passes a node next to the enemy. City 4 is 2 hops from 7, yet one
    capture of 3 would cut it into a pocket: no site."""
    bot, view = _setup(mvp4, crossroads, player, (7,))
    assert safe_rear(bot, view) == {crossroads.capital(player): 0}
    assert factory_site(bot, view, EXTRA, FactorySites()) is None


@pytest.mark.parametrize("player", [0, 1])
def test_no_build_without_spare_stock(mvp4: Ruleset, crossroads: MapDef, player: int) -> None:
    """``factory.cost = 4``: the warehouses of the capital's component must hold 4 beyond the own
    units without a charge standing in it."""
    bot, view = _setup(mvp4, crossroads, player, (11,))
    capital = crossroads.capital(player)
    own = [n.id for n in view.nodes if n.owner == player]
    empty = _warehouses(view, dict.fromkeys(own, 0))
    assert spare_stock(bot, empty) == 0
    assert factory_site(bot, empty, EXTRA, FactorySites()) is None
    four = _warehouses(empty, {capital: 4})
    assert spare_stock(bot, four) == 4
    assert factory_site(bot, four, EXTRA, FactorySites()) == _node(crossroads, player, 4)
    groups = list(four.groups)
    at = next(
        i
        for i, g in enumerate(groups)
        if isinstance(g.location, AtNode) and g.location.node == capital
    )
    groups[at] = replace(groups[at], charged=groups[at].units - 1)  # one unit waits for a charge
    tired = replace(four, groups=tuple(groups))
    assert spare_stock(bot, tired) == 3
    assert factory_site(bot, tired, EXTRA, FactorySites()) is None


def _with_build(view: PlayerView, node: int) -> PlayerView:
    nodes = list(view.nodes)
    nodes[node] = replace(nodes[node], factory_build=SiteBuildView(None, 4))
    return replace(view, nodes=tuple(nodes))


def _lost(view: PlayerView, node: int) -> PlayerView:
    nodes = list(view.nodes)
    nodes[node] = replace(nodes[node], owner=1 - view.player, factory_build=None, factory=None)
    return replace(view, nodes=tuple(nodes))


@pytest.mark.parametrize("player", [0, 1])
def test_a_lost_site_is_not_rebuilt_and_the_restarts_are_capped(
    mvp4: Ruleset, crossroads: MapDef, player: int
) -> None:
    """A factory build at 4 is captured: 4 is never a site again (while the enemy holds it, 8 next
    to it is out too and the site is 1; once 4 is own again, 8); once a build at 1 is lost too
    (more than ``FACTORY_RESTARTS`` losses), no factory is started."""
    assert FACTORY_RESTARTS == 1
    bot, view = _setup(mvp4, crossroads, player, (11,))
    four, one = _node(crossroads, player, 4), _node(crossroads, player, 1)
    eight = _node(crossroads, player, 8)
    memory = FactorySites()
    assert factory_site(bot, _with_build(view, four), EXTRA, memory) is None  # one at a time
    assert factory_site(bot, _lost(view, four), EXTRA, memory) == one  # 4 is the enemy's now
    assert memory.lost == {four: True}
    assert factory_site(bot, view, EXTRA, memory) == eight  # 4 is owned again: still no site
    assert factory_site(bot, _with_build(view, one), EXTRA, memory) is None
    assert factory_site(bot, _lost(view, one), EXTRA, memory) is None  # past the restarts
    assert memory.lost == {four: True, one: True}
    assert factory_site(bot, view, EXTRA, memory) is None  # past the restarts
