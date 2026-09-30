"""Fail if a golden replay that exists in ``base`` was changed or removed (SIM-16, AGENTS.md 4.5).

    uv run python scripts/check_golden_frozen.py [base]   # default base: HEAD^1

Golden folders are frozen: a rule change needs a ``SIM_VERSION`` bump and a new ``v<N>`` folder,
never regenerated files. New files may only go into the folder of the current ``SIM_VERSION``.
CI runs it on the merge commit of a PR, where ``HEAD^1`` is the base branch.
"""

import subprocess
import sys

from gow_sim.match import SIM_VERSION

GOLDEN = "packages/sim/tests/golden/"


def violations(changes: list[tuple[str, str]], sim_version: int) -> list[str]:
    """``changes``: ``(git status letter, path)``; returns the forbidden ones."""
    current = f"{GOLDEN}v{sim_version}/"
    bad: list[str] = []
    for status, path in changes:
        if not path.startswith(f"{GOLDEN}v"):
            continue  # generate.py and other tooling may change
        if status != "A":
            bad.append(f"{status} {path}: golden files are frozen, bump SIM_VERSION instead")
        elif not path.startswith(current):
            bad.append(f"A {path}: new golden files go into {current}")
    return bad


def main() -> int:
    base = sys.argv[1] if len(sys.argv) > 1 else "HEAD^1"
    out = subprocess.run(
        ["git", "diff", "--name-status", "--no-renames", base, "HEAD", "--", GOLDEN],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    changes = [(s[0], p) for s, p in (line.split("\t", 1) for line in out.splitlines())]
    bad = violations(changes, SIM_VERSION)
    for line in bad:
        print(line, file=sys.stderr)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
