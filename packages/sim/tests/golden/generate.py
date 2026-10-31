"""Generate the golden replays of the current ``SIM_VERSION`` (SIM-16).

    uv run python packages/sim/tests/golden/generate.py            # golden/v{SIM_VERSION}/
    uv run python packages/sim/tests/golden/generate.py --out DIR  # elsewhere (determinism test)

Golden folders are frozen (AGENTS.md, section 4.5): the script refuses to write into an existing
``v{SIM_VERSION}`` folder. Changed a rule or the system order: bump ``SIM_VERSION`` in
``gow_sim.match`` and run the script, it creates the folder of the new version. It also archives
the rulesets into ``rulesets/archive/`` and copies the maps next to the replays, so later map
edits do not touch the old replays.

The drivers are ``ExpandBot`` of ``conftest.py`` plus ``MixBot``, which adds every other command
type on a fixed schedule (planned moves, splits, merges, modes, stances, road upgrades, supply
priorities and transfers, cancellations while waiting and on an edge, recruit cancellations,
barracks and warehouse upgrades, unknown ids), so the replays go through every command path and
many rejections. The games cover ``mvp-0``, ``mvp-1`` (``city_upgrades`` on, DEC-26) and the
economy v2 of ``mvp-3`` (DEC-41): there ``MixBot`` also builds factories and bunkers (paid in
charges, #645), draws supply lines from its capital and from their targets and removes them,
gives its planned orders a requested bonus and releases some of them early (#646), and its
v1-only commands (and "Defense") are rejected.
"""

import argparse
import importlib.util
import shutil
import sys
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from gow_sim.commands import (
    BuildBarracks,
    BuildBunker,
    BuildFactory,
    CancelOrder,
    CancelRecruit,
    Command,
    DrawLine,
    Forfeit,
    Merge,
    Move,
    ReleasePlan,
    RemoveLine,
    SetAutoLines,
    SetFront,
    SetMode,
    SetRearMin,
    SetStance,
    Split,
    Transfer,
    UpgradeRoad,
    UpgradeWarehouse,
)
from gow_sim.maps import MapDef, load_map
from gow_sim.match import SIM_VERSION, Controller
from gow_sim.replay import REPLAY_SUFFIX, record_headless
from gow_sim.ruleset import Ruleset, Stance, archive_ruleset, load_ruleset
from gow_sim.view import AtNode, GroupView, Mode, OnEdge, PlayerView

TESTS = Path(__file__).resolve().parents[1]
ROOT = TESTS.parents[2]


def _expand_bot() -> Callable[[MapDef, Ruleset], Controller]:
    """``ExpandBot`` of ``conftest.py``; tests are not a package, so load it by path."""
    spec = importlib.util.spec_from_file_location("sim_tests_conftest", TESTS / "conftest.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    bot: Callable[[MapDef, Ruleset], Controller] = module.ExpandBot
    return bot


ExpandBot = _expand_bot()

UNKNOWN_ID = 12345
"""An opaque id that names no group: ``resolve()`` turns it into a rejected command."""


class MixBot:
    """``ExpandBot`` plus the other command types on a fixed schedule of its decisions."""

    def __init__(self, mapdef: MapDef, rules: Ruleset, forfeit_at: int | None = None) -> None:
        self.map = mapdef
        self.v2 = rules.v2
        self.plan_cost = rules.orders.cost.planned_move
        self.base = ExpandBot(mapdef, rules)
        self.forfeit_at = forfeit_at
        self.decisions = 0
        self.saving = False
        """Saving CP for a city build (DEC-26): the decisions of ``ExpandBot`` are skipped."""

    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        if self.forfeit_at is not None and tick >= self.forfeit_at:
            self.forfeit_at = None
            return [Forfeit()]
        k = self.decisions = self.decisions + 1
        if k % 120 == 0:
            self.saving = True
        if self.saving:  # until the CP pay the barracks: then one of the city builds
            if view.me.cp < 300:
                return []
            self.saving = False
            return self._develop(view, k // 120)
        cmds: list[Command] = self.base.decide(view, tick)
        idle = [g for g in view.groups if isinstance(g.location, AtNode) and g.order is None]
        if k % 5 == 0:  # under v2 a planned order names its bonus (DEC-41, item 10)
            bonus = 1 + k // 5 % 3 if self.v2 else 0
            cmds = [Move(c.group, c.dest, True, bonus) if isinstance(c, Move) else c for c in cmds]
        if k % 7 == 0 and idle:
            big = max(idle, key=lambda g: (g.units, g.id))
            if big.units >= 2:
                cmds.append(Split(big.id, big.units // 2))
        if k % 11 == 0:
            cmds.extend(self._merge(idle))
        if k % 13 == 0 and idle:
            g = idle[k % len(idle)]
            cmds.append(SetMode(g.id, Mode.ATTACK if g.mode is Mode.DEFENSE else Mode.DEFENSE))
        if k % 17 == 0:
            cmds.extend(self._upgrade(view, idle))
        if k % 19 == 0:
            waiting = [g for g in view.groups if g.order is not None and g.order.planned]
            if waiting:
                cmds.append(CancelOrder(waiting[0].id))
        if k % 29 == 0:  # a move order on an edge turns back (DEC-20, C2)
            moving = [g for g in view.groups if isinstance(g.location, OnEdge) and g.order]
            if moving:
                cmds.append(CancelOrder(moving[0].id))
        if k % 23 == 0:
            cmds.append(Move(UNKNOWN_ID, 0))
        if k % 40 == 0:
            cmds.append(SetStance(list(Stance)[k // 40 % len(Stance)]))
        if k % 29 == 0:
            cmds.extend(self._supply(view, k))
        if k % 31 == 0:  # the last unit of the capital's recruit queue comes back (DEC-25)
            cmds.append(CancelRecruit(self.map.capital(view.player)))
        if k % 37 == 0:  # usually rejected: no CP left, or FEATURE_DISABLED without the flag
            cmds.extend(self._develop(view, k))
        if self.v2:
            cmds.extend(self._economy_v2(view, k))
            if k % 2 == 0 and view.me.cp >= self.plan_cost:  # first, before the CP go (#646)
                cmds = self._plan(view, 1 + k // 2 % 3) + cmds
        return cmds

    def _economy_v2(self, view: PlayerView, k: int) -> list[Command]:
        """DEC-41: a line from the capital or from an own city to the own city of rank ``k``, a
        factory now and then, a line removed by its per-player id; rejects are part of the log."""
        me = view.player
        cities = [n.id for n in view.nodes if n.owner == me and n.has_barracks is not None]
        cmds: list[Command] = []
        if k % 9 == 0 and len(cities) >= 2:
            source = self.map.capital(me) if k % 2 else cities[k // 9 % len(cities)]
            target = cities[(k // 9 + 1) % len(cities)]
            path = self._own_path(view, source, target)
            if path is not None:
                cmds.append(DrawLine(path))
        if k % 41 == 0 and cities:
            cmds.append(BuildFactory(cities[k % len(cities)]))
        own = [n.id for n in view.nodes if n.owner == me]
        if k % 29 == 0 and own:  # a bunker in a city or a province (#645)
            cmds.append(BuildBunker(own[k // 29 % len(own)]))
        if k % 53 == 0:
            cmds.append(RemoveLine(k // 53 % 4))
        if k % 67 == 0:  # the auto-extension off and on again (#665)
            cmds.append(SetAutoLines(k // 67 % 2 == 0))
        if k % 13 == 0:  # a gathering planned order departs now (#646)
            waiting = [g for g in view.groups if g.order is not None and g.order.planned]
            if waiting:
                cmds.append(ReleasePlan(waiting[-1].id))
        return cmds

    def _plan(self, view: PlayerView, bonus: int) -> list[Command]:
        """A planned ``Move`` with the requested ``bonus`` (DEC-41, item 10) of the idle charged
        group with the most charges, to the nearest node it does not own (ties: lower id)."""
        idle = [
            g
            for g in view.groups
            if isinstance(g.location, AtNode) and g.order is None and g.charged > 0
        ]
        foreign = [n.id for n in view.nodes if n.owner != view.player]
        if not idle or not foreign:
            return []
        g = max(idle, key=lambda g: (g.charged, g.id))
        assert isinstance(g.location, AtNode)
        hops = self._hops(g.location.node)
        dest = min(foreign, key=lambda n: (hops.get(n, len(hops)), n))
        return [Move(g.id, dest, True, bonus)]

    def _hops(self, start: int) -> dict[int, int]:
        """Edges from ``start`` to every node (BFS, neighbours in edge id order)."""
        dist = {start: 0}
        queue = deque([start])
        while queue:
            node = queue.popleft()
            for e in self.map.incident[node]:
                nxt = self.map.edges[e].other(node)
                if nxt not in dist:
                    dist[nxt] = dist[node] + 1
                    queue.append(nxt)
        return dist

    def _own_path(self, view: PlayerView, src: int, dst: int) -> tuple[int, ...] | None:
        """A shortest path by edges over own nodes (BFS, neighbours in edge id order)."""
        if src == dst:
            return None
        me = view.player
        prev: dict[int, int] = {src: src}
        queue = deque([src])
        while queue:
            node = queue.popleft()
            if node == dst:
                path = [dst]
                while path[-1] != src:
                    path.append(prev[path[-1]])
                return tuple(reversed(path))
            for e in self.map.incident[node]:
                nxt = self.map.edges[e].other(node)
                if nxt not in prev and view.nodes[nxt].owner == me:
                    prev[nxt] = node
                    queue.append(nxt)
        return None

    def _develop(self, view: PlayerView, k: int) -> list[Command]:
        """The barracks or a warehouse level in the own city of rank ``k`` (DEC-26); without
        ``city_upgrades`` both are rejected, which is part of the log too."""
        cities = [n.id for n in view.nodes if n.owner == view.player and n.has_barracks is not None]
        if not cities:
            return []
        node = cities[k % len(cities)]
        return [BuildBarracks(node) if k % 2 else UpgradeWarehouse(node)]

    def _supply(self, view: PlayerView, k: int) -> list[Command]:
        """A front marker on the own city of rank ``k``, a rear minimum (DEC-28) and a transfer
        from the capital to it (DEC-18); rejects are part of the log."""
        me = view.player
        cities = [n.id for n in view.nodes if n.owner == me]
        if not cities:
            return []
        node = cities[k % len(cities)]
        return [
            SetFront(k // 29 % 2, node),
            SetRearMin(k // 29 % 3),
            Transfer(self.map.capital(me), node, 1 + k % 3),
        ]

    def _merge(self, idle: list[GroupView]) -> list[Command]:
        by_node: dict[int, list[int]] = {}
        for g in idle:
            assert isinstance(g.location, AtNode)
            by_node.setdefault(g.location.node, []).append(g.id)
        for node in sorted(by_node):
            if len(by_node[node]) >= 2:
                return [Merge(tuple(by_node[node][:2]))]
        return []

    def _upgrade(self, view: PlayerView, idle: list[GroupView]) -> list[Command]:
        """A road at an idle group is upgraded for CP (DEC-28, item 7); rejects are part of the
        log. Now and then a road under a build already (``EDGE_BUSY``)."""
        for g in idle:
            assert isinstance(g.location, AtNode)
            node = g.location.node
            for e in self.map.incident[node]:
                road = view.edges[e]
                if road.upgrade_gain is not None and (
                    road.build is None or self.decisions % 85 == 0
                ):
                    return [UpgradeRoad(e)]
        return []


@dataclass(frozen=True, slots=True)
class Game:
    name: str
    map_id: str
    ruleset: str
    forfeit_at: int | None = None
    """Player 1 forfeits at this tick."""

    def controllers(self, mapdef: MapDef, rules: Ruleset) -> list[Controller]:
        return [MixBot(mapdef, rules), MixBot(mapdef, rules, self.forfeit_at)]


GAMES = (
    Game("artery-mvp0", "artery", "mvp-0"),
    Game("web-mvp0", "web", "mvp-0"),
    Game("pass-short-forfeit", "pass", "test-short", forfeit_at=400),
    Game("artery-mvp1", "artery", "mvp-1"),
    Game("pass-mvp1", "pass", "mvp-1"),
    Game("artery-mvp3", "artery", "mvp-3"),
    Game("web-mvp3", "web", "mvp-3"),
)


def generate(out: Path, archive: Path) -> list[Path]:
    """Play every game of ``GAMES`` and record it into ``out``; return the replay paths."""
    (out / "maps").mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for game in GAMES:
        map_file = ROOT / "maps" / "fixtures" / f"{game.map_id}.json"
        rules_file = ROOT / "rulesets" / f"{game.ruleset}.toml"
        archive_ruleset(rules_file, archive)
        shutil.copyfile(map_file, out / "maps" / map_file.name)
        mapdef, rules = load_map(map_file), load_ruleset(rules_file)
        path = out / f"{game.name}{REPLAY_SUFFIX}"
        record_headless(path, mapdef, rules, game.controllers(mapdef, rules))
        written.append(path)
    return written


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate the golden replays.")
    parser.add_argument("--out", type=Path, help="output folder (default: the golden folder)")
    parser.add_argument("--archive", type=Path, default=ROOT / "rulesets" / "archive")
    args = parser.parse_args()
    out: Path | None = args.out
    if out is None:
        out = Path(__file__).resolve().parent / f"v{SIM_VERSION}"
        if out.exists():
            print(f"{out} exists: golden folders are frozen, bump SIM_VERSION", file=sys.stderr)
            return 1
    for path in generate(out, args.archive):
        print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
