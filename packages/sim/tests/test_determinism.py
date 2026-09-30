"""Determinism (AGENTS.md, section 10): one match in fresh processes with different hash seeds.

Each process generates the golden games (``golden/generate.py``) with its own
``PYTHONHASHSEED``; the replay files, checkpoint hashes included, must be byte-identical.
"""

import os
import subprocess
import sys
from pathlib import Path

GENERATE = Path(__file__).resolve().parent / "golden" / "generate.py"
SEEDS = ("0", "1", "4242")


def test_same_replays_under_different_hash_seeds(tmp_path: Path) -> None:
    procs: list[subprocess.Popen[bytes]] = []
    for seed in SEEDS:
        env = {**os.environ, "PYTHONHASHSEED": seed}
        out, archive = tmp_path / seed, tmp_path / f"archive-{seed}"
        cmd = [sys.executable, str(GENERATE), "--out", str(out), "--archive", str(archive)]
        procs.append(subprocess.Popen(cmd, env=env, stdout=subprocess.DEVNULL))
    assert [p.wait() for p in procs] == [0] * len(SEEDS)
    first = tmp_path / SEEDS[0]
    names = sorted(p.name for p in first.glob("*.jsonl.gz"))
    assert names
    for seed in SEEDS[1:]:
        for name in names:
            same = (tmp_path / seed / name).read_bytes() == (first / name).read_bytes()
            assert same, f"{name} differs between PYTHONHASHSEED={SEEDS[0]} and {seed}"
