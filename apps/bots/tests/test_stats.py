"""``gow-bots analyze`` and ``gow-bots stats`` on a recorded replay (#375, DEC-44 #772).

The replay is recorded here: two smart bots on ``web`` under ``test-short`` (a whole match in
600 ticks), player 0 switching the stance on a schedule, so the stance rows have something to
count.
"""

import json
import shutil
from dataclasses import dataclass
from pathlib import Path

import pytest

from gow_bots.bots import SmartRusher, SmartTurtle
from gow_bots.cli import main
from gow_bots.tournament import USAGE_KEYS
from gow_sim.commands import Command, SetStance
from gow_sim.maps import load_map
from gow_sim.match import Controller
from gow_sim.replay import record_headless
from gow_sim.ruleset import Stance, load_ruleset, ruleset_hash
from gow_sim.view import PlayerView

ROOT = Path(__file__).resolve().parents[3]


@dataclass
class _Switcher:
    """A controller that plays ``inner`` and sets a stance at the ticks of ``at``."""

    inner: Controller
    at: dict[int, Stance]

    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        cmds = self.inner.decide(view, tick)
        stance = self.at.get(tick)
        return cmds if stance is None else [SetStance(stance), *cmds]


@pytest.fixture(scope="module")
def recorded(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, Path]:
    """The replay file and the folder of its archived ruleset."""
    folder = tmp_path_factory.mktemp("stats")
    source = ROOT / "rulesets" / "test-short.toml"
    rules = load_ruleset(source)
    archive = folder / "archive"
    archive.mkdir()
    shutil.copyfile(source, archive / f"{ruleset_hash(rules)}.toml")
    mapdef = load_map(ROOT / "maps" / "fixtures" / "web.json")
    switches = {100: Stance.WAR, 300: Stance.ECONOMY}
    controllers = [
        _Switcher(SmartRusher(mapdef, rules, seed=1, player=0), switches),
        SmartTurtle(mapdef, rules, seed=1, player=1),
    ]
    replay = folder / "web-short.jsonl.gz"
    record_headless(replay, mapdef, rules, controllers)
    return replay, archive


def _run(capsys: pytest.CaptureFixture[str], command: str, recorded: tuple[Path, Path]) -> str:
    replay, archive = recorded
    argv = [
        command,
        str(replay),
        "--rulesets",
        str(archive),
        "--maps",
        str(ROOT / "maps" / "fixtures"),
    ]
    assert main(argv) == 0
    return capsys.readouterr().out


def _rows(capsys: pytest.CaptureFixture[str], recorded: tuple[Path, Path]) -> list[str]:
    return _run(capsys, "stats", recorded).splitlines()


def _labels(lines: list[str]) -> list[str]:
    return [line.split("  ")[0].strip() for line in lines[2:]]


def test_analyze_adds_the_statistics_of_both_players(
    capsys: pytest.CaptureFixture[str], recorded: tuple[Path, Path]
) -> None:
    row = json.loads(_run(capsys, "analyze", recorded))
    assert row["replay"] == recorded[0].name
    assert row["orders"] == [row["stats"]["players"][p]["orders"] for p in (0, 1)]
    players = row["stats"]["players"]
    assert len(players) == 2
    assert sum(players[0]["stance_ticks"].values()) == row["ticks"]
    assert "economy_model" not in row and "supply_model" not in row


def test_analyze_writes_the_usage_of_both_players(
    capsys: pytest.CaptureFixture[str], recorded: tuple[Path, Path]
) -> None:
    row = json.loads(_run(capsys, "analyze", recorded))
    assert len(row["usage"]) == 2
    assert set(row["usage"][0]) == set(USAGE_KEYS)
    # usage counts the accepted commands but Forfeit, so at most all accepted ones
    assert sum(row["usage"][0].values()) <= row["accepted"][0]
    assert row["usage"][0]["SetStance"] >= 2  # the two switches of the schedule at least


def test_stats_prints_a_table_per_replay(
    capsys: pytest.CaptureFixture[str], recorded: tuple[Path, Path]
) -> None:
    lines = _rows(capsys, recorded)
    assert lines[0].startswith(f"{recorded[0].name}: ")
    labels = _labels(lines)
    assert labels[0] == "stance (tick:stance)"
    assert "APM avg" in labels
    assert labels.index("CP total") < labels.index("charges start")  # charge rows come last (#588)
    assert labels[-1] == "mean stock packets"
    residual = next(line for line in lines if line.startswith("ledger residual"))
    assert residual.split()[-2:] == ["0", "0"]  # the ledger balances for both players


def test_stats_print_the_rows_of_the_kept_mechanics_only(
    capsys: pytest.CaptureFixture[str], recorded: tuple[Path, Path]
) -> None:
    """#894: no front markers, transfers, road upgrades or drawn lines are left to count."""
    labels = _labels(_rows(capsys, recorded))
    for dead in (
        "SetFront",
        "SetRearMin",
        "Transfer (charges)",
        "CP road",
        "CP transfer",
        "sent / delivered / to markers",
        "marker city empty",
        "mean stock front_wh",
        "SetFront (accepted)",
        "DrawLine (accepted)",
        "SetMode (accepted)",
        "BuildBunker (accepted)",
    ):
        assert dead not in labels
    for row in (
        "SetLeafShift (accepted)",
        "FortifyRoad (accepted)",
        "BuildFactory (accepted)",
        "charges into buildings",
        "charges into buildings lost",
        "charges into plans",
        "charges to road tolls",
        "tolls paid / taken",
        "contested sieges (won)",
        "charges per kill",
        "CP of cancelled moves",
        "idle discharged, in pockets",
    ):
        assert row in labels


def test_stats_show_the_stance_usage(
    capsys: pytest.CaptureFixture[str], recorded: tuple[Path, Path]
) -> None:
    lines = _rows(capsys, recorded)
    rows = {line.split("  ")[0].strip(): line for line in lines[2:]}
    for stance in ("economy", "balance", "war"):
        assert f"share of time in {stance}" in rows
        assert f"CP earned in {stance}" in rows
        assert f"charges in {stance} (capital / built)" in rows
    assert int(rows["stance switches"].split()[2]) >= 2  # Balance -> War -> Economy at least
    assert rows["stance (tick:stance)"].split()[2].startswith("0:balance")
    assert "SetStance (accepted)" in rows
    assert "charges from the capital" in rows and "charges from built factories" in rows


def test_stats_of_a_missing_replay_fails(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["stats", str(tmp_path / "none.jsonl.gz")]) == 1
    assert "ERROR" in capsys.readouterr().err
