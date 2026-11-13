"""The travel module of the bots against the simulation (ARP-05, #994).

``gow_bots.bots.travel`` restates the movement rule of ``gow_sim.systems.movement`` on a
``PlayerView`` (the bots may not import the systems). These tests hold the copy to the rule:

- ``edge_ticks`` and ``ticks_left`` equal ``movement.leg`` (``ticks``, ``spent``) for every road
  in both directions of every map of the repository under every kept ruleset;
- ``ways`` equals ``movement.reachable_paths`` (the search of a ``Move``) for every standing own
  group of smart bot matches on the pool maps, with and without the stack limit;
- a real ``Move`` takes the path ``ways`` gives and arrives on the tick its ticks give (the ``ack``
  rule: the tick it is applied plus the ticks of the path, minus one).
"""

import copy
from collections.abc import Sequence
from pathlib import Path
from typing import Final

import pytest

from gow_bots.bots import bot_factory
from gow_bots.bots.travel import Times, Way, edge_ticks, ticks_left, ways
from gow_sim.commands import Move, Ok, PlayerCommand
from gow_sim.maps import PLAYERS, MapDef, load_map
from gow_sim.match import Match, play
from gow_sim.ruleset import load_ruleset
from gow_sim.state import AtNode
from gow_sim.systems.movement import leg, reachable_paths

ROOT: Final = Path(__file__).resolve().parents[3]
MAP_FILES: Final = sorted(
    p
    for folder in ("maps", "maps/fixtures", "maps/menu", "maps/gen", "maps/tutorial")
    for p in (ROOT / folder).glob("*.json")
)
RULESET_FILES: Final = sorted((ROOT / "rulesets").glob("*.toml"))
POOL: Final = sorted((ROOT / "maps").glob("*.json"))
MVP7: Final = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")
BOTS: Final = ("smart_rusher", "smart_expander")
CHECK_EVERY: Final = 150
"""Ticks between two checks of the standing groups."""
TICKS: Final = 1500
"""Ticks of each match: openings and the first fights, with an own territory to cross."""
MOVES_PER_CHECK: Final = 2
"""Real ``Move`` orders tried in a copy of the match at each check."""


@pytest.mark.parametrize("rules_path", RULESET_FILES, ids=lambda p: p.stem)
def test_edge_times_are_the_movement_rule(rules_path: Path) -> None:
    rules = load_ruleset(rules_path)
    for map_path in MAP_FILES:
        mapdef = load_map(map_path)
        for eid, e in enumerate(mapdef.edges):
            for to in (e.a, e.b):
                rule = leg(mapdef, rules, eid, to)
                assert edge_ticks(mapdef, rules, eid, to) == rule.ticks, (map_path.stem, eid, to)
                b = rule.border
                for gone in (0, 1, b - 1, b, b + 1, 999, 1000, *range(0, 1001, 97)):
                    if 0 <= gone <= 1000:
                        expected = rule.ticks - rule.spent(gone)
                        found = ticks_left(mapdef, rules, eid, to, gone)
                        assert found == expected, (map_path.stem, eid, to, gone)


def _sim_ways(match: Match, player: int, start: int, size: int) -> dict[int, Way]:
    """``reachable_paths`` of the simulation in the shape of ``travel.ways``."""
    mapdef = match.state.map
    found = {start: Way(0, (start,), -1)}
    for node, (ticks, path) in reachable_paths(
        match.state, match.rules, player, start, size
    ).items():
        a, b = path[-2], path[-1]
        edge = next(e for e in mapdef.incident[a] if mapdef.edges[e].other(a) == b)
        found[node] = Way(ticks, path, edge)
    return found


@pytest.mark.parametrize("map_path", MAP_FILES, ids=lambda p: p.stem)
def test_ways_on_a_whole_own_map(map_path: Path) -> None:
    """Every start of a map one player owns whole: the longest paths and the most ties of the
    key sequence (the heap of ``ways`` orders by ticks alone), with and without a stack limit."""
    mapdef = load_map(map_path)
    times = Times(mapdef, MVP7)
    for player in PLAYERS:
        match = Match(mapdef, MVP7, bytes(range(32)))
        for node in match.state.nodes.values():
            node.owner = player
        view = match.view(player)
        keys = tuple(mapdef.node_key(player, n) for n in range(len(mapdef.nodes)))
        for start in range(len(mapdef.nodes)):
            for size in (0, 4):
                mine = ways(view, times, keys, start, size)
                assert mine == _sim_ways(match, player, start, size), (player, start, size)


def _standing(match: Match, player: int) -> list[tuple[int, int, int]]:
    """``(group id, node, units)`` of the own groups standing in a node without an order and
    outside fights."""
    out: list[tuple[int, int, int]] = []
    for gid in sorted(match.state.groups):
        g = match.state.groups[gid]
        standing = isinstance(g.location, AtNode) and g.order is None and g.fight is None
        if g.owner == player and standing:
            assert isinstance(g.location, AtNode)
            out.append((gid, g.location.node, g.units))
    return out


class _Checker:
    """Compares ``travel.ways`` with the simulation every ``CHECK_EVERY`` ticks."""

    def __init__(self, mapdef: MapDef) -> None:
        self.map = mapdef
        self.times = Times(mapdef, MVP7)
        self.keys = {
            p: tuple(mapdef.node_key(p, n) for n in range(len(mapdef.nodes))) for p in PLAYERS
        }
        self.compared = 0
        self.moved = 0

    def begin(self, match: Match) -> None:
        del match

    def record(self, match: Match, commands: Sequence[PlayerCommand]) -> None:
        del commands
        if match.tick % CHECK_EVERY:
            return
        for player in PLAYERS:
            view = match.view(player)
            groups = _standing(match, player)
            for _, node, units in groups:
                for size in (0, units):
                    mine = ways(view, self.times, self.keys[player], node, size)
                    assert mine == _sim_ways(match, player, node, size), (match.tick, node, size)
                    self.compared += 1
            self._moves(match, player, groups)

    def _moves(self, match: Match, player: int, groups: list[tuple[int, int, int]]) -> None:
        """Real ``Move`` orders in copies of the match: the path of ``ways`` and its arrival."""
        tried = 0
        view = match.view(player)
        for gid, node, units in groups:
            found = ways(view, self.times, self.keys[player], node, units)
            far = sorted(
                (w for n, w in found.items() if n != node and view.nodes[n].owner == player),
                key=lambda w: (-w.ticks, self.keys[player][w.path[-1]]),
            )
            if not far:
                continue
            way = far[0]
            if self._arrives(match, player, gid, way):
                self.moved += 1
            tried += 1
            if tried >= MOVES_PER_CHECK:
                return

    @staticmethod
    def _arrives(match: Match, player: int, gid: int, way: Way) -> bool:
        """``True`` when the group sent along ``way`` in a copy of the match arrived on the tick
        ``ways`` gives; ``False`` when something stopped it on the way (a fight, a lost node)."""
        trial = copy.deepcopy(match)
        dest = way.path[-1]
        trial.state.players[player].cp += 100 * 100  # the price is not under test
        trial.step([PlayerCommand(player, 0, Move(gid, dest))])
        result = trial.results[0].outcome
        assert isinstance(result, Ok), result
        assert result.path == way.path
        applied = trial.tick
        arrive = applied + way.ticks - 1  # the ack rule: it departs in the tick it is applied
        assert result.arrive_tick == arrive
        while not trial.finished and trial.tick < arrive:
            for e in trial.step():
                if e.kind == "group_arrived" and e.get("group") == gid:
                    if e.get("node") != dest:
                        return False  # an own node on the way was lost: it stops there
                    assert trial.tick == arrive
                    return True
            g = trial.state.groups.get(gid)
            if g is None or g.fight is not None:
                return False  # met the enemy: stopped
        return False


@pytest.mark.parametrize("map_path", POOL, ids=lambda p: p.stem)
def test_ways_are_the_moves_of_the_simulation(map_path: Path) -> None:
    mapdef = load_map(map_path)
    factories = [bot_factory(BOTS[p]) for p in PLAYERS]
    checker = _Checker(mapdef)
    play(mapdef, MVP7, factories, seed=7, max_ticks=TICKS, observer=checker)  # map tempo on
    assert checker.compared >= 100
    assert checker.moved >= 20
