"""Generate the golden replays of the current ``SIM_VERSION`` (SIM-16).

    uv run python packages/sim/tests/golden/generate.py            # golden/v{SIM_VERSION}/
    uv run python packages/sim/tests/golden/generate.py --out DIR  # elsewhere (determinism test)

Golden folders are frozen (AGENTS.md, section 4.5): the script refuses to write into an existing
``v{SIM_VERSION}`` folder. Changed a rule or the system order: bump ``SIM_VERSION`` in
``gow_sim.match`` and run the script, it creates the folder of the new version. It also archives
the rulesets into ``rulesets/archive/`` and copies the maps next to the replays, so later map
edits do not touch the old replays.

The drivers are ``ExpandBot`` of ``conftest.py`` plus ``MixBot``, which adds every other command
type on a fixed schedule (planned moves, splits, merges, modes, stances, road upgrades,
cancellations, unknown ids), so the replays go through every command path and many rejections.
"""

import argparse
import importlib.util
import shutil
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from gow_sim.commands import (
    CancelOrder,
    Command,
    Forfeit,
    Merge,
    Move,
    SetMode,
    SetStance,
    Split,
    UpgradeRoad,
)
from gow_sim.maps import MapDef, load_map
from gow_sim.match import SIM_VERSION, Controller
from gow_sim.replay import REPLAY_SUFFIX, record_headless
from gow_sim.ruleset import Ruleset, Stance, archive_ruleset, load_ruleset
from gow_sim.view import AtNode, GroupView, Mode, PlayerView

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
        self.base = ExpandBot(mapdef, rules)
        self.forfeit_at = forfeit_at
        self.decisions = 0

    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        if self.forfeit_at is not None and tick >= self.forfeit_at:
            self.forfeit_at = None
            return [Forfeit()]
        k = self.decisions = self.decisions + 1
        cmds: list[Command] = self.base.decide(view, tick)
        idle = [g for g in view.groups if isinstance(g.location, AtNode) and g.order is None]
        if k % 5 == 0:
            cmds = [Move(c.group, c.dest, True) if isinstance(c, Move) else c for c in cmds]
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
        if k % 23 == 0:
            cmds.append(Move(UNKNOWN_ID, 0))
        if k % 40 == 0:
            cmds.append(SetStance(list(Stance)[k // 40 % len(Stance)]))
        return cmds

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
        for g in idle:
            assert isinstance(g.location, AtNode)
            for e in self.map.incident[g.location.node]:
                if view.edges[e].upgrade_gain is not None:
                    return [UpgradeRoad(g.id, e)]
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
    Game("arteriya-mvp0", "arteriya", "mvp-0"),
    Game("pautina-mvp0", "pautina", "mvp-0"),
    Game("pereval-short-forfeit", "pereval", "test-short", forfeit_at=400),
)


def generate(out: Path, archive: Path) -> list[Path]:
    """Play every game of ``GAMES`` and record it into ``out``; return the replay paths."""
    (out / "maps").mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for game in GAMES:
        map_file = ROOT / "maps" / f"{game.map_id}.json"
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
