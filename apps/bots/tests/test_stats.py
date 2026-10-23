"""``gow-bots analyze`` and ``gow-bots stats`` on a golden replay (#375)."""

import json
from pathlib import Path

import pytest

from gow_bots.cli import main
from gow_sim.match import SIM_VERSION

ROOT = Path(__file__).resolve().parents[3]
REPLAY = (
    ROOT
    / "packages"
    / "sim"
    / "tests"
    / "golden"
    / f"v{SIM_VERSION}"
    / "pereval-short-forfeit.jsonl.gz"
)


def test_analyze_adds_the_statistics_of_both_players(capsys: pytest.CaptureFixture[str]) -> None:
    assert (
        main(
            [
                "analyze",
                str(REPLAY),
                "--rulesets",
                str(ROOT / "rulesets" / "archive"),
                "--maps",
                str(ROOT / "maps"),
            ]
        )
        == 0
    )
    row = json.loads(capsys.readouterr().out)
    assert row["replay"] == REPLAY.name
    assert row["orders"] == [row["stats"]["players"][p]["orders"] for p in (0, 1)]
    players = row["stats"]["players"]
    assert len(players) == 2
    assert sum(players[0]["stance_ticks"].values()) == row["ticks"]


def test_stats_prints_a_table_per_replay(capsys: pytest.CaptureFixture[str]) -> None:
    argv = [
        "stats",
        str(REPLAY),
        "--rulesets",
        str(ROOT / "rulesets" / "archive"),
        "--maps",
        str(ROOT / "maps"),
    ]
    assert main(argv) == 0
    lines = capsys.readouterr().out.splitlines()
    assert lines[0].startswith(f"{REPLAY.name}: ")
    labels = [line.split("  ")[0].strip() for line in lines[2:]]
    assert labels[0] == "stance (tick:stance)"
    assert "APM avg" in labels
    assert labels[-1] == "CP total"


def test_stats_of_a_missing_replay_fails(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["stats", str(tmp_path / "none.jsonl.gz")]) == 1
    assert "ERROR" in capsys.readouterr().err
