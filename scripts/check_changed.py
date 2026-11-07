"""An agent's local check before a push (#798, AGENTS.md section 3): only what the diff touches.

    mise run check:changed [base]             # base: a git ref, origin/develop by default
    mise run check:changed --dry-run [base]   # print the tasks, run nothing

The diff is the working tree (committed, staged, unstaged and untracked files) against the merge
base with ``base``. The tasks: ``check`` always (the static checks are cheap and pyright sees the
whole workspace); ``test:py`` with the test paths of the touched Python packages (all of it when
the workspace configuration changed); ``golden:check`` when the simulation or a ruleset changed;
``regen`` when a generator input changed; ``test:client`` and ``build`` when the client (or a
regenerated type) changed. ``test:perf``, ``test:slow`` and the full ``ci`` are left to GitHub:
timing on a machine shared by agents is noise. A failing CI job is fixed from its log.
"""

import subprocess
import sys

# Path prefix of a changed file -> the test path of its package for `test:py`.
PY_TESTS: dict[str, str] = {
    "packages/sim/": "packages/sim",
    "rulesets/": "packages/sim",
    "packages/protocol/": "packages/protocol",
    "apps/server/": "apps/server",
    "deploy/": "apps/server",
    "apps/bots/": "apps/bots",
    "tools/maps/": "tools/maps",
    "maps/": "tools/maps",
    "scripts/": "tests",
    "tests/": "tests",
    "mise.toml": "tests",
}
# A change here can break any Python test: run all of `test:py`.
PY_ALL = ("pyproject.toml", "uv.lock", ".python-version", "conftest.py")
GOLDEN = ("packages/sim/", "rulesets/")
# The inputs of `regen`: the protocol schema takes enums and limits from gow_sim, the API types
# come from the server, the How to play examples are played through gow_sim.
REGEN = ("packages/protocol/src/", "packages/sim/src/", "apps/server/src/", "scripts/export_")
CLIENT = "apps/client/"
LOOK = ("apps/client/src/", "apps/client/public/")


def plan(changed: list[str], base: str) -> tuple[list[list[str]], list[str]]:
    """The ``mise run`` argument lists for ``changed`` paths, and reminders to print."""
    tasks: list[list[str]] = [["check"]]
    notes: list[str] = []
    if any(p in PY_ALL for p in changed):
        tasks.append(["test:py"])
    else:
        paths = sorted(
            {test for p in changed for prefix, test in PY_TESTS.items() if p.startswith(prefix)}
        )
        if paths:
            tasks.append(["test:py", "--", *paths])
    if any(p.startswith(GOLDEN) for p in changed):
        tasks.append(["golden:check", base])
    regen = any(p.startswith(REGEN) for p in changed)
    if regen:
        tasks.append(["regen"])
    if regen or any(p.startswith(CLIENT) for p in changed):
        tasks += [["test:client"], ["build"]]
    if regen:
        notes.append("regen: commit the regenerated files it changes (git status)")
    if any(p.startswith(LOOK) for p in changed):
        notes.append(
            "the client changed: if the look changed, compare `mise run shots before` and"
            " `mise run shots after` (AGENTS.md, 7.5)"
        )
    return tasks, notes


def _git(*args: str) -> list[str]:
    out = subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout
    return [line for line in out.splitlines() if line]


def changed_files(base: str) -> list[str]:
    merge_base = _git("merge-base", base, "HEAD")[0]
    tracked = _git("diff", "--name-only", "--no-renames", merge_base)
    untracked = _git("ls-files", "--others", "--exclude-standard")
    return sorted({*tracked, *untracked})


def main() -> int:
    args = sys.argv[1:]
    dry_run = "--dry-run" in args
    rest = [a for a in args if a != "--dry-run"]
    base = rest[0] if rest else "origin/develop"
    changed = changed_files(base)
    tasks, notes = plan(changed, base)
    print(f"{len(changed)} files changed against {base}")
    failed: list[str] = []
    for task in tasks:
        line = "mise run " + " ".join(task)
        print(f"--- {line}", flush=True)
        if not dry_run and subprocess.run(["mise", "run", *task], check=False).returncode != 0:
            failed.append(line)
    for note in notes:
        print(f"note: {note}")
    for line in failed:
        print(f"FAILED: {line}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
