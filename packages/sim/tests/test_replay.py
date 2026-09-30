"""Replays (SIM-16): format round trip, golden replays of the current version, divergence dump."""

import gzip
import json
from pathlib import Path

import pytest

from gow_sim.commands import (
    CancelOrder,
    Command,
    Forfeit,
    Merge,
    Move,
    Recruit,
    SetMode,
    SetStance,
    Split,
    UpgradeRoad,
)
from gow_sim.match import SIM_VERSION
from gow_sim.replay import (
    REPLAY_SUFFIX,
    ReplayVersionError,
    decode_command,
    encode_command,
    main,
    read_replay,
    replay_run,
)
from gow_sim.ruleset import Stance
from gow_sim.state import Mode

TESTS = Path(__file__).resolve().parent
ROOT = TESTS.parents[2]
GOLDEN = TESTS / "golden" / f"v{SIM_VERSION}"
ARCHIVE = ROOT / "rulesets" / "archive"
MAPS = ROOT / "maps"
REPLAYS = sorted(GOLDEN.glob(f"*{REPLAY_SUFFIX}"))

COMMANDS: list[Command] = [
    Move(1, 2),
    Move(1, 2, planned=True),
    Split(3, 2),
    Merge((4, 5, 6)),
    SetMode(7, Mode.DEFENSE),
    SetStance(Stance.WAR),
    UpgradeRoad(8, 9),
    Recruit(0),
    CancelOrder(10),
    Forfeit(),
]


@pytest.mark.parametrize("cmd", COMMANDS, ids=lambda c: type(c).__name__)
def test_command_round_trip(cmd: Command) -> None:
    assert decode_command(json.loads(json.dumps(encode_command(cmd)))) == cmd


def test_golden_folder_of_current_version_exists() -> None:
    """A SIM_VERSION bump without new golden replays fails here."""
    assert REPLAYS, f"no golden replays in {GOLDEN}: run packages/sim/tests/golden/generate.py"


@pytest.mark.parametrize("path", REPLAYS, ids=lambda p: p.name)
def test_golden_replay(path: Path, tmp_path: Path) -> None:
    replay = read_replay(path)
    assert replay.header.sim_version == SIM_VERSION
    assert replay.final
    result = replay_run(path, ARCHIVE, MAPS, tmp_path)
    assert result.divergence is None
    assert result.checkpoints == len(replay.checkpoints)


def _lines(src: Path) -> list[bytes]:
    return gzip.decompress(src.read_bytes()).splitlines()


def _rewrite(src: Path, dst: Path, edit: dict[int, object]) -> None:
    lines = _lines(src)
    for number, value in edit.items():
        lines[number] = json.dumps(value).encode()
    dst.write_bytes(gzip.compress(b"\n".join(lines) + b"\n"))


def test_divergence_dumps_both_states(tmp_path: Path) -> None:
    src = REPLAYS[-1]
    number = _lines(src).index(
        b'{"tick":100,"hash":"' + read_replay(src).checkpoints[2].hash.encode() + b'"}'
    )
    bad = tmp_path / src.name
    _rewrite(src, bad, {number: {"tick": 100, "hash": "0" * 32}})
    (tmp_path / "maps").symlink_to(src.parent / "maps")
    result = replay_run(bad, ARCHIVE, MAPS, tmp_path / "dump")
    d = result.divergence
    assert d is not None and d.tick == 100 and d.expected == "0" * 32 and d.dump is not None
    assert sorted(p.name for p in d.dump.iterdir()) == [
        "divergence.json",
        "state_tick100_diverged.json",
        "state_tick50_matching.json",
    ]
    assert main(["check", str(bad), "--rulesets", str(ARCHIVE), "--dump-dir", str(tmp_path)]) == 1


def test_other_sim_version_is_skipped(tmp_path: Path) -> None:
    src = REPLAYS[-1]
    header = json.loads(_lines(src)[0])
    old = tmp_path / src.name
    _rewrite(src, old, {0: {**header, "sim_version": SIM_VERSION + 1}})
    with pytest.raises(ReplayVersionError):
        replay_run(old, ARCHIVE, MAPS)
    assert main(["check", str(tmp_path)]) == 1  # nothing of the current version checked
    args = ["check", str(tmp_path), str(GOLDEN), "--rulesets", str(ARCHIVE), "--maps", str(MAPS)]
    assert main(args) == 0
