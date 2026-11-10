"""Generate the golden replays of the current ``SIM_VERSION`` (SIM-16).

    uv run python packages/sim/tests/golden/generate.py            # golden/v{SIM_VERSION}/
    uv run python packages/sim/tests/golden/generate.py --out DIR  # elsewhere (determinism test)

Golden folders are frozen (AGENTS.md, section 4.5): the script refuses to write into an existing
``v{SIM_VERSION}`` folder. Changed a rule or the system order: bump ``SIM_VERSION`` in
``gow_sim.match`` and run the script, it creates the folder of the new version. It also archives
the rulesets into ``rulesets/archive/`` and copies the maps next to the replays, so later map
edits do not touch the old replays.

The drivers are ``ExpandBot`` of ``conftest.py`` plus ``MixBot``, which adds every other command
type on a fixed schedule (planned moves with a requested bonus and their early release, splits,
merges, stances, cancellations while waiting and on an edge, recruit cancellations, the barracks
and factories paid in charges, the leaf shift in range and out of it, road fortifications with a
wrong road and a second one on the same road now and then, unknown ids, group orders (attacks,
planned ones, rallies) and the recruit rally point of DEC-48), so the replays go through every
command path and many rejections (a group order and a rally point are rejected outside
``mvp-7``). The games cover the kept rulesets (#894):
``mvp-5``, ``mvp-6``, ``mvp-7`` (map tempo on the pool map ``narrows``, where the multiplier is 76,
and every factory follows the stance of its owner, DEC-47) and ``test-short`` with a forfeit.
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
    BuildFactory,
    CancelOrder,
    CancelRecruit,
    Command,
    Forfeit,
    FortifyRoad,
    GroupMove,
    Merge,
    Move,
    ReleasePlan,
    SetLeafShift,
    SetRallyPoint,
    SetStance,
    Split,
)
from gow_sim.maps import MapDef, load_map
from gow_sim.match import SIM_VERSION, Controller
from gow_sim.replay import REPLAY_SUFFIX, record_headless
from gow_sim.ruleset import Ruleset, Stance, apply_map_tempo, archive_ruleset, load_ruleset
from gow_sim.view import AtNode, GroupView, OnEdge, PlayerView

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
        if self.saving:  # until the CP are back: then a barracks
            if view.me.cp < 300:
                return []
            self.saving = False
            return self._develop(view, k // 120)
        cmds: list[Command] = self.base.decide(view, tick)
        idle = [g for g in view.groups if isinstance(g.location, AtNode) and g.order is None]
        if k % 5 == 0:  # a planned order names its bonus (DEC-41, item 10)
            bonus = 1 + k // 5 % 3
            cmds = [Move(c.group, c.dest, True, bonus) if isinstance(c, Move) else c for c in cmds]
        if k % 7 == 0 and idle:
            big = max(idle, key=lambda g: (g.units, g.id))
            if big.units >= 2:
                cmds.append(Split(big.id, big.units // 2))
        if k % 11 == 0:
            cmds.extend(self._merge(idle))
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
        if k % 37 == 0:  # DEC-44: every stance, the schedule above skips Economy
            cmds.append(SetStance(list(Stance)[k // 37 % len(Stance)]))
        if k % 31 == 0:  # the last unit of the capital's recruit queue comes back (DEC-25)
            cmds.append(CancelRecruit(self.map.capital(view.player)))
        if k % 37 == 0:  # often rejected: the barracks is there or being built
            cmds.extend(self._develop(view, k))
        if k % 7 == 3:  # DEC-43: 0..3, beyond the maximum now and then
            cmds.append(SetLeafShift(k // 7 % 4))
        if k % 11 == 5:  # DEC-43, item D: first, before the CP go; at times a reject
            cmds = self._fortify(view, k) + cmds
        cmds.extend(self._economy(view, k))
        if k % 2 == 0 and view.me.cp >= self.plan_cost:  # first, before the CP go (#646)
            cmds = self._plan(view, 1 + k // 2 % 3) + cmds
        if k % 9 == 4:  # DEC-48: a group order first, before the CP go
            cmds = self._group(view, k) + cmds
        if k % 25 == 3:  # DEC-48, item H: the rally point of the capital, set and cleared
            cmds.append(self._rally_point(view, k))
        return cmds

    def _group(self, view: PlayerView, k: int) -> list[Command]:
        """DEC-48: the idle groups (up to 3, by id) attack the nearest foreign node of the first,
        planned every other time, or rally at the node of the last one every third time."""
        idle = [g for g in view.groups if isinstance(g.location, AtNode) and g.order is None][:3]
        if len(idle) < 2:
            return []
        gids = tuple(g.id for g in idle)
        last = idle[-1].location
        assert isinstance(last, AtNode)
        if k // 9 % 3 == 2:
            return [GroupMove(gids, last.node)]
        first = idle[0].location
        assert isinstance(first, AtNode)
        foreign = [n.id for n in view.nodes if n.owner != view.player]
        if not foreign:
            return []
        hops = self._hops(first.node)
        dest = min(foreign, key=lambda n: (hops.get(n, len(hops)), n))
        planned = k // 9 % 3 == 1
        return [GroupMove(gids, dest, planned, 2 if planned else 0)]

    def _rally_point(self, view: PlayerView, k: int) -> Command:
        """DEC-48, item H: the capital sends its recruits to the first other own city, then
        clears the point."""
        capital = self.map.capital(view.player)
        cities = [
            n.id
            for n in view.nodes
            if n.owner == view.player and n.has_barracks is not None and n.id != capital
        ]
        target = cities[0] if cities and k // 25 % 2 == 0 else None
        return SetRallyPoint(capital, target)

    def _economy(self, view: PlayerView, k: int) -> list[Command]:
        """DEC-41: a factory now and then (paid in charges, #645; often ``FACTORY_LIMIT`` or
        ``ALREADY_BUILT``) and an early release of a gathering planned order (#646)."""
        me = view.player
        cities = [n.id for n in view.nodes if n.owner == me and n.has_barracks is not None]
        cmds: list[Command] = []
        if k % 41 == 0 and cities:
            cmds.append(BuildFactory(cities[k % len(cities)]))
        if k % 13 == 0:  # a gathering planned order departs now (#646)
            waiting = [g for g in view.groups if g.order is not None and g.order.planned]
            if waiting:
                cmds.append(ReleasePlan(waiting[-1].id))
        return cmds

    def _fortify(self, view: PlayerView, k: int) -> list[Command]:
        """DEC-43, item D: the first own node (by id) with a road to a foreign node it has not
        fortified fortifies it; every fourth time a road that does not leave the node
        (``NOT_ADJACENT``) or a second one on the same road (``ALREADY_BUILT``)."""
        me = view.player
        for n in view.nodes:
            if n.owner != me:
                continue
            for eid in self.map.incident[n.id]:
                other = self.map.edges[eid].other(n.id)
                if view.nodes[other].owner == me:
                    continue
                built = any(f.node == n.id for f in view.edges[eid].forts)
                if k % 4 == 1:
                    wrong = next(
                        e for e in range(len(self.map.edges)) if e not in self.map.incident[n.id]
                    )
                    return [FortifyRoad(n.id, wrong)]
                if built and k % 4 == 3:
                    return [FortifyRoad(n.id, eid)]
                if not built:
                    return [FortifyRoad(n.id, eid)]
        return []

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

    def _develop(self, view: PlayerView, k: int) -> list[Command]:
        """The barracks in the own city of rank ``k`` (DEC-26): rejected where it stands or is
        being built, which is part of the log too."""
        cities = [n.id for n in view.nodes if n.owner == view.player and n.has_barracks is not None]
        if not cities:
            return []
        return [BuildBarracks(cities[k % len(cities)])]

    def _merge(self, idle: list[GroupView]) -> list[Command]:
        by_node: dict[int, list[int]] = {}
        for g in idle:
            assert isinstance(g.location, AtNode)
            by_node.setdefault(g.location.node, []).append(g.id)
        for node in sorted(by_node):
            if len(by_node[node]) >= 2:
                return [Merge(tuple(by_node[node][:2]))]
        return []


@dataclass(frozen=True, slots=True)
class Game:
    name: str
    map_id: str
    ruleset: str
    forfeit_at: int | None = None
    """Player 1 forfeits at this tick."""
    map_dir: str = "maps/fixtures"
    """The folder of the map, relative to the repository root."""

    def controllers(self, mapdef: MapDef, rules: Ruleset) -> list[Controller]:
        return [MixBot(mapdef, rules), MixBot(mapdef, rules, self.forfeit_at)]


GAMES = (
    Game("artery-mvp5", "artery", "mvp-5"),
    Game("web-mvp5", "web", "mvp-5"),
    Game("pass-short-forfeit", "pass", "test-short", forfeit_at=400),
    Game("artery-mvp6", "artery", "mvp-6"),
    Game("web-mvp6", "web", "mvp-6"),
    Game("web-mvp7", "web", "mvp-7"),
    Game("narrows-mvp7", "narrows", "mvp-7", map_dir="maps"),
)


def generate(out: Path, archive: Path) -> list[Path]:
    """Play every game of ``GAMES`` and record it into ``out``; return the replay paths."""
    (out / "maps").mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for game in GAMES:
        map_file = ROOT / game.map_dir / f"{game.map_id}.json"
        rules_file = ROOT / "rulesets" / f"{game.ruleset}.toml"
        archive_ruleset(rules_file, archive)
        shutil.copyfile(map_file, out / "maps" / map_file.name)
        mapdef, rules = load_map(map_file), load_ruleset(rules_file)
        path = out / f"{game.name}{REPLAY_SUFFIX}"
        played = apply_map_tempo(rules, mapdef)  # the bots see the periods the match plays
        record_headless(path, mapdef, rules, game.controllers(mapdef, played))
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
