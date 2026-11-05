"""``gow-bots analyze`` and ``gow-bots stats`` on a golden replay (#375)."""

import json
from pathlib import Path

import pytest

from gow_bots.cli import main
from gow_bots.tournament import USAGE_KEYS
from gow_sim.match import SIM_VERSION

ROOT = Path(__file__).resolve().parents[3]
REPLAY = next(
    (ROOT / "packages" / "sim" / "tests" / "golden" / f"v{SIM_VERSION}").glob(
        "*-short-forfeit.jsonl.gz"
    )
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
                str(ROOT / "maps" / "fixtures"),
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
        str(ROOT / "maps" / "fixtures"),
    ]
    assert main(argv) == 0
    lines = capsys.readouterr().out.splitlines()
    assert lines[0].startswith(f"{REPLAY.name}: ")
    labels = [line.split("  ")[0].strip() for line in lines[2:]]
    assert labels[0] == "stance (tick:stance)"
    assert "APM avg" in labels
    assert labels.index("CP total") < labels.index("charges start")  # charge rows come last (#588)
    assert labels[-1] == "mean stock packets"
    residual = next(line for line in lines if line.startswith("ledger residual"))
    assert residual.split()[-2:] == ["0", "0"]  # the ledger balances for both players


def test_stats_of_a_missing_replay_fails(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["stats", str(tmp_path / "none.jsonl.gz")]) == 1
    assert "ERROR" in capsys.readouterr().err


FLOW_REPLAY = next(
    (ROOT / "packages" / "sim" / "tests" / "golden" / f"v{SIM_VERSION}").glob("*-mvp4.jsonl.gz")
)


def _labels(capsys: pytest.CaptureFixture[str], replay: Path) -> tuple[str, list[str]]:
    argv = [
        "stats",
        str(replay),
        "--rulesets",
        str(ROOT / "rulesets" / "archive"),
        "--maps",
        str(ROOT / "maps" / "fixtures"),
    ]
    assert main(argv) == 0
    lines = capsys.readouterr().out.splitlines()
    return lines[0], [line.split("  ")[0].strip() for line in lines[2:]]


def test_stats_under_the_supply_flow_prints_the_v2_rows_and_no_v1_rows(
    capsys: pytest.CaptureFixture[str],
) -> None:
    # #690: an mvp-4 match (economy v2, supply flow) has no stances, markers or transfers.
    title, labels = _labels(capsys, FLOW_REPLAY)
    assert "economy v2, supply flow; first contact at tick " in title
    for dead in (
        "stance (tick:stance)",
        "ticks in war",
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


def test_stats_of_a_v1_match_keep_the_v1_rows(capsys: pytest.CaptureFixture[str]) -> None:
    title, labels = _labels(capsys, REPLAY)
    assert "economy v1;" in title
    assert "SetFront" in labels and "sent / delivered / to markers" in labels
    assert "SetLeafShift (accepted)" not in labels and "charges into buildings" not in labels


def test_analyze_writes_the_usage_of_both_players(capsys: pytest.CaptureFixture[str]) -> None:
    argv = [
        "analyze",
        str(FLOW_REPLAY),
        "--rulesets",
        str(ROOT / "rulesets" / "archive"),
        "--maps",
        str(ROOT / "maps" / "fixtures"),
    ]
    assert main(argv) == 0
    row = json.loads(capsys.readouterr().out)
    assert len(row["usage"]) == 2
    assert set(row["usage"][0]) == set(USAGE_KEYS)
    # usage counts the accepted commands but Forfeit, so at most all accepted ones
    assert sum(row["usage"][0].values()) <= row["accepted"][0]
    assert (row["economy_model"], row["supply_model"]) == ("v2", "flow")
