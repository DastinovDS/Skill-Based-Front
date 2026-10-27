"""Shared helpers of the simulation tests: a simple controller and a 40-node benchmark map.

``ExpandBot`` sees only its ``PlayerView`` (plus the public map and ruleset), like a real bot
(AGENTS.md, section 8). It is a test driver for ``run_headless`` and the benchmarks, not a bot of
``gow_bots``: every idle group in "Attack" walks to the nearest node its player does not own,
recruits are queued in the capital, and it never spends more CP than it has. Under the stack limit
(DEC-20, D) a group bigger than the smallest node capacity of the map first splits off the rest,
which stays for a later decision.
"""

from collections import deque
from collections.abc import Callable
from pathlib import Path

import pytest

from gow_sim.commands import Command, Move, Recruit, Split
from gow_sim.maps import MapDef, parse_map
from gow_sim.match import Controller
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.view import AtNode, Mode, PlayerView

ROOT = Path(__file__).resolve().parents[3]
MVP0 = ROOT / "rulesets" / "mvp-0.toml"
MVP_MAPS = ("artery", "web", "pass")


class ExpandBot:
    def __init__(self, mapdef: MapDef, rules: Ruleset) -> None:
        self.map = mapdef
        self.rules = rules
        self.hops = [self._bfs(n) for n in range(len(mapdef.nodes))]
        self.stack = min(rules.capacity.by_kind.of(n.kind) for n in mapdef.nodes)
        """The biggest group that fits into every node (DEC-20, D)."""

    def _bfs(self, start: int) -> list[int]:
        dist = [-1] * len(self.map.nodes)
        dist[start] = 0
        queue = deque([start])
        while queue:
            node = queue.popleft()
            for e in self.map.incident[node]:
                other = self.map.edges[e].other(node)
                if dist[other] < 0:
                    dist[other] = dist[node] + 1
                    queue.append(other)
        return dist

    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        del tick
        me, cost = view.player, self.rules.orders.cost
        budget = view.me.cp
        cmds: list[Command] = []
        capital = self.map.capital(me)
        standing = sum(g.units for g in view.groups if g.location == AtNode(capital))
        queue = view.nodes[capital].recruit_queue or 0  # DEC-25
        if (
            budget >= cost.recruit
            and queue < self.rules.recruit.queue_max
            and standing + queue < view.nodes[capital].capacity
        ):
            cmds.append(Recruit(capital))
            budget -= cost.recruit
        foreign = [n.id for n in view.nodes if n.owner != me]
        for g in view.groups:
            if budget < cost.move or not foreign:
                break
            if (
                not isinstance(g.location, AtNode)
                or g.order is not None
                or g.mode is not Mode.ATTACK
            ):
                continue
            here = g.location.node
            dist = self.hops[here]
            reachable = [n for n in foreign if n != here and dist[n] > 0]
            if not reachable:
                continue
            dest = min(reachable, key=lambda n: (dist[n], self.map.node_key(me, n)))
            if g.units > self.stack:
                if budget < cost.split + cost.move:
                    continue
                cmds.append(Split(g.id, g.units - self.stack))
                budget -= cost.split
            cmds.append(Move(g.id, dest))
            budget -= cost.move
        return cmds


def grid40() -> MapDef:
    """A rot180 ladder of 2 x 20 nodes (40 nodes, 58 edges); each player owns 10 nodes."""
    cols = 20
    nodes: list[dict[str, object]] = []
    for node_id in range(2 * cols):
        col = node_id % cols
        owner = 0 if col < 5 else 1 if col >= cols - 5 else None
        capital = 0 if node_id == 0 else 1 if node_id == 2 * cols - 1 else None
        nodes.append(
            {
                "id": node_id,
                "name": f"n{node_id}",
                "x": 50 + 40 * col,
                "y": 100 + 200 * (node_id // cols),
                "terrain": ["plains", "forest", "mountains"][min(col, cols - 1 - col) % 3],
                "vp": 3 if capital is not None else 1,
                "kind": "city_small" if capital is None else "capital",
                "capital_of": capital,
                "start_owner": owner,
                "start_units": 3 if owner is not None else 0,
                "start_charged": 2 if owner is not None else 0,
                "start_stock": 4 if capital is not None else (1 if owner is not None else 0),
            }
        )
    pairs = [(r * cols + c, r * cols + c + 1) for r in range(2) for c in range(cols - 1)]
    pairs += [(c, cols + c) for c in range(cols)]
    edges = [
        {"id": i, "a": a, "b": b, "max_level": 3, "travel_ticks": 30, "border_permille": 500}
        for i, (a, b) in enumerate(pairs)
    ]
    mirror_node = {n: 2 * cols - 1 - n for n in range(2 * cols)}
    index = {frozenset(p): i for i, p in enumerate(pairs)}
    mirror_edge = {
        i: index[frozenset((mirror_node[a], mirror_node[b]))] for i, (a, b) in enumerate(pairs)
    }
    return parse_map(
        {
            "meta": {
                "name": "grid40",
                "version": 1,
                "symmetry": "rot180",
                "width": 900,
                "height": 400,
            },
            "nodes": nodes,
            "edges": edges,
            "mirror": {
                "nodes": {str(k): v for k, v in mirror_node.items()},
                "edges": {str(k): v for k, v in mirror_edge.items()},
            },
        }
    )


def _grid55_own(node_id: int) -> bool:
    """Player 0 owns columns 0-2 of ``grid55`` except node 2 (row 0, column 2): 14 nodes."""
    return node_id % 11 <= 2 and node_id != 2


def grid55() -> MapDef:
    """A rot180 grid of 5 x 11 nodes (55 nodes, 94 edges; DEC-27, item 7): the size of the new
    maps. Each player owns 14 nodes: its three edge columns without one corner; the centre node
    is its own mirror. Garrisons and stock as in ``grid40``."""
    rows, cols = 5, 11
    count = rows * cols
    nodes: list[dict[str, object]] = []
    for node_id in range(count):
        row, col = divmod(node_id, cols)
        owner = 0 if _grid55_own(node_id) else 1 if _grid55_own(count - 1 - node_id) else None
        capital = 0 if node_id == 2 * cols else 1 if node_id == count - 1 - 2 * cols else None
        nodes.append(
            {
                "id": node_id,
                "name": f"n{node_id}",
                "x": 60 + 80 * col,
                "y": 60 + 80 * row,
                "terrain": ["plains", "forest", "mountains"][(row + min(col, cols - 1 - col)) % 3],
                "vp": 3 if capital is not None else 1,
                "kind": "city_small" if capital is None else "capital",
                "capital_of": capital,
                "start_owner": owner,
                "start_units": 3 if owner is not None else 0,
                "start_charged": 2 if owner is not None else 0,
                "start_stock": 4 if capital is not None else (1 if owner is not None else 0),
            }
        )
    pairs = [(r * cols + c, r * cols + c + 1) for r in range(rows) for c in range(cols - 1)]
    pairs += [(r * cols + c, (r + 1) * cols + c) for r in range(rows - 1) for c in range(cols)]
    edges = [
        {"id": i, "a": a, "b": b, "max_level": 3, "travel_ticks": 24, "border_permille": 500}
        for i, (a, b) in enumerate(pairs)
    ]
    mirror_node = {n: count - 1 - n for n in range(count)}
    index = {frozenset(p): i for i, p in enumerate(pairs)}
    mirror_edge = {
        i: index[frozenset((mirror_node[a], mirror_node[b]))] for i, (a, b) in enumerate(pairs)
    }
    return parse_map(
        {
            "meta": {
                "name": "grid55",
                "version": 1,
                "symmetry": "rot180",
                "width": 920,
                "height": 440,
            },
            "nodes": nodes,
            "edges": edges,
            "mirror": {
                "nodes": {str(k): v for k, v in mirror_node.items()},
                "edges": {str(k): v for k, v in mirror_edge.items()},
            },
        }
    )


_TERRAIN = {"p": "plains", "f": "forest", "m": "mountains"}


def fog_map(
    terrains: str, edges: list[tuple[int, int]], owners: dict[int, int] | None = None
) -> MapDef:
    """A small map for the fog tests of DEC-21 and DEC-33, without garrisons or stock.

    ``terrains``: one letter per node (``p`` plains, ``f`` forest, ``m`` mountains). Node 0 is
    the capital of player 0 and node 1 that of player 1; the other nodes are neutral small
    cities unless ``owners`` gives them a player. ``edges``: ``(a, b)`` pairs, edge ids in order,
    ``travel_ticks`` 30. The mirror tables are the identity: the tests do not mirror.
    """
    owner_of = {0: 0, 1: 1, **(owners or {})}
    nodes = [
        {
            "id": n,
            "name": f"n{n}",
            "x": 10 * n,
            "y": 10,
            "terrain": _TERRAIN[t],
            "vp": 1,
            "kind": "capital" if n < 2 else "city_small",
            "capital_of": n if n < 2 else None,
            "start_owner": owner_of.get(n),
            "start_units": 0,
            "start_charged": 0,
            "start_stock": 0,
        }
        for n, t in enumerate(terrains)
    ]
    return parse_map(
        {
            "meta": {"name": "fog", "version": 1, "symmetry": "rot180", "width": 400, "height": 20},
            "nodes": nodes,
            "edges": [
                {
                    "id": i,
                    "a": a,
                    "b": b,
                    "max_level": 3,
                    "travel_ticks": 30,
                    "border_permille": 500,
                }
                for i, (a, b) in enumerate(edges)
            ],
            "mirror": {
                "nodes": {str(n): n for n in range(len(terrains))},
                "edges": {str(e): e for e in range(len(edges))},
            },
        }
    )


@pytest.fixture(scope="session")
def make_fog_map() -> Callable[..., MapDef]:
    return fog_map


@pytest.fixture(scope="session")
def mvp_rules() -> Ruleset:
    return load_ruleset(MVP0)


@pytest.fixture(scope="session")
def expand_bot() -> Callable[[MapDef, Ruleset], Controller]:
    return ExpandBot


@pytest.fixture(scope="session")
def grid40_map() -> MapDef:
    return grid40()


@pytest.fixture(scope="session")
def grid55_map() -> MapDef:
    return grid55()
