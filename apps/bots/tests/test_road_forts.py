"""Road fortifications in the bots (DEC-43, item D and item G, #707).

The campaign bots fortify the road of an own node to an enemy neighbour where an enemy is in sight
while their CP are near the cap (``gow_bots.bots.economy.fort_site``), and an attack whose every
road into the target carries a visible enemy fortification asks for the toll on top of its shots
(``Bot.toll_ahead``).
"""

from dataclasses import replace
from pathlib import Path

import pytest

from gow_bots.bots import SmartRusher
from gow_bots.bots.economy import fort_site
from gow_sim.commands import FortifyRoad
from gow_sim.maps import MapDef, load_map
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.state import Detail, Mode, Sighting
from gow_sim.view import PlayerView, RoadFortView

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))


@pytest.fixture(scope="module")
def mvp4() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "mvp-7.toml")


@pytest.fixture(scope="module")
def crossroads() -> MapDef:
    return load_map(ROOT / "maps" / "crossroads.json")


def _front(rules: Ruleset, mapdef: MapDef) -> tuple[SmartRusher, PlayerView, int, int, int]:
    """Player 0's view with an own node next to a node made the enemy's; returns the bot, the
    view, the own node, the enemy node and the road between them."""
    match = Match(mapdef, rules, KEY)
    bot = SmartRusher(mapdef, rules, seed=1, player=0)
    state = match.state
    near, enemy = next(
        (n, m)
        for n in range(len(mapdef.nodes))
        if state.nodes[n].owner == 0
        for m in bot.neighbors[n]
        if state.nodes[m].owner is None
    )
    state.nodes[enemy].owner = 1
    match.step()
    road = next(e for e in mapdef.incident[near] if mapdef.edges[e].other(near) == enemy)
    return bot, match.view(0), near, enemy, road


def _seen(view: PlayerView, node: int, units: int) -> PlayerView:
    nodes = list(view.nodes)
    sighting = Sighting(view.tick, Detail.EXACT, (Mode.ATTACK,), units, units)
    nodes[node] = replace(nodes[node], detail=Detail.EXACT, seen=sighting)
    return replace(view, nodes=tuple(nodes))


def test_a_front_road_is_fortified_when_the_cp_near_the_cap(
    mvp4: Ruleset, crossroads: MapDef
) -> None:
    bot, view, near, enemy, road = _front(mvp4, crossroads)
    cap = mvp4.cp.cap
    full = replace(view, me=replace(view.me, cp=cap))
    assert fort_site(bot, full, cap) is None  # no enemy in sight there
    seen = _seen(full, enemy, 3)
    assert fort_site(bot, seen, cap) == (near, road)
    low = replace(seen, me=replace(seen.me, cp=cap - mvp4.cp.per_period - 1))
    assert fort_site(bot, low, cap) is None  # the CP are not near the cap
    assert fort_site(bot, seen, 100) is None  # the budget does not pay 1.5 CP
    edges = list(seen.edges)
    edges[road] = replace(edges[road], forts=(RoadFortView(near, 0, False, 200),))
    assert fort_site(bot, replace(seen, edges=tuple(edges)), cap) != (near, road)
    assert bot.allowed(FortifyRoad(near, road))


def test_a_fortified_approach_raises_the_shots_of_an_attack(
    mvp4: Ruleset, crossroads: MapDef
) -> None:
    """DEC-43, item D6: 1 charge per started 3 units; only when every own road into the target
    is fortified (the path is the simulation's)."""
    bot, view, near, enemy, _ = _front(mvp4, crossroads)
    assert bot.toll_ahead(view, enemy, 4) == 0
    roads = [
        e
        for e in crossroads.incident[enemy]
        if view.nodes[crossroads.edges[e].other(enemy)].owner == 0
    ]
    edges = list(view.edges)
    for e in roads:
        edges[e] = replace(edges[e], forts=(RoadFortView(enemy, 1, True, None),))
    fortified = replace(view, edges=tuple(edges))
    assert bot.toll_ahead(fortified, enemy, 4) == 2
    assert bot.toll_ahead(fortified, enemy, 3) == 1
    assert bot.toll_ahead(fortified, near, 4) == 0  # an own node
    if len(roads) > 1:
        edges[roads[0]] = replace(edges[roads[0]], forts=())
        assert bot.toll_ahead(replace(view, edges=tuple(edges)), enemy, 4) == 0
