"""The shards of `test:py` in CI (#798): one job per shard, together exactly the tests of one run.

    uv run python scripts/pytest_shards.py args <shard>   # the pytest arguments of a shard
    uv run python scripts/pytest_shards.py check          # every test in exactly one shard

A shard is a list of paths. A path inside the path of another shard belongs to the more specific
one: the wider shard gets ``--ignore`` for it, so ``rest`` (the root) takes every test that no
other shard names, including tests in a directory added later. The shards are balanced by the
``--durations`` of CI: a shard's wall clock is bounded by its longest test (the determinism test,
about 2.5 minutes on a runner), so the long replay files have their own shard.

``check`` collects the reference set with the command of the task ``test:py`` (``mise.toml``)
without ``-n``, collects every shard the same way, and fails unless each test of the reference is
in exactly one shard and no shard has a test outside it. It also compares the shard names with
the matrix of the job ``py-test`` in ``.github/workflows/ci.yml``, so a shard cannot be left out
of CI.
"""

import re
import shlex
import subprocess
import sys
import tomllib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CI = ROOT / ".github/workflows/ci.yml"

SHARDS: dict[str, list[str]] = {
    # The long replay checks: determinism under hash seeds, the analysis of the golden matches.
    "sim-replays": [
        "packages/sim/tests/test_analysis.py",
        "packages/sim/tests/test_determinism.py",
        "packages/sim/tests/test_replay.py",
    ],
    "sim": ["packages/sim"],
    # Full bot matches.
    "bots-matches": [
        "apps/bots/tests/test_bots.py",
        "apps/bots/tests/test_capture_cost.py",
        "apps/bots/tests/test_charge_flow.py",
        "apps/bots/tests/test_supply_flow.py",
    ],
    "bots": ["apps/bots"],
    "server-protocol": ["apps/server", "packages/protocol"],
    # tools/maps, tests/ and anything no other shard names.
    "rest": ["."],
}


def _inside(path: str, parent: str) -> bool:
    return parent == "." or path.startswith(parent.rstrip("/") + "/")


def shard_args(name: str, shards: dict[str, list[str]] = SHARDS) -> list[str]:
    """The paths of a shard and an ``--ignore`` for every more specific path of another shard."""
    own = shards[name]
    inner = {
        p
        for other, paths in shards.items()
        if other != name
        for p in paths
        if p not in own and any(_inside(p, mine) for mine in own)
    }
    # A path inside another ignored path is ignored with it.
    ignores = sorted(p for p in inner if not any(q != p and _inside(p, q) for q in inner))
    return [*own, *(f"--ignore={p}" for p in ignores)]


def _base_command() -> list[str]:
    """The command of ``test:py`` without ``-n auto``: xdist is not needed to collect."""
    tasks = tomllib.loads((ROOT / "mise.toml").read_text(encoding="utf-8"))["tasks"]
    words = shlex.split(tasks["test:py"]["run"])
    i = words.index("-n")
    return [*words[:i], *words[i + 2 :]]


_SUMMARY = re.compile(r"^(?:(\d+)/\d+|(\d+)) tests? collected")


def _collect(extra: list[str]) -> list[str]:
    """Node ids collected by ``test:py`` with ``extra`` arguments."""
    cmd = [*_base_command(), "--collect-only", "-p", "no:cacheprovider", *extra]
    out = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, check=False)
    if out.returncode not in (0, 5):  # 5: nothing collected
        sys.exit(f"{shlex.join(cmd)} failed:\n{out.stdout}\n{out.stderr}")
    ids = [
        line
        for line in out.stdout.splitlines()
        if "::" in line and not line[:1].isspace() and line.split("::", 1)[0].endswith(".py")
    ]
    counts = [m for line in out.stdout.splitlines() if (m := _SUMMARY.match(line))]
    expected = int(counts[-1].group(1) or counts[-1].group(2)) if counts else 0
    if len(ids) != expected:
        sys.exit(f"{shlex.join(cmd)}: parsed {len(ids)} node ids, pytest reports {expected}")
    return ids


_MATRIX = re.compile(r"^\s+shard: \[([^\]]*)\]\s*$")


def _ci_matrix() -> list[str]:
    """The ``shard: [...]`` list of the job ``py-test`` (the next job header ends the search)."""
    lines = CI.read_text(encoding="utf-8").splitlines()
    if "  py-test:" not in lines:
        sys.exit(f"{CI}: no job py-test")
    start = lines.index("  py-test:") + 1
    for line in lines[start:]:
        if re.match(r"^  \S", line):
            break
        if m := _MATRIX.match(line):
            return [s.strip() for s in m.group(1).split(",")]
    sys.exit(f"{CI}: the job py-test has no line `shard: [...]`")


def check() -> int:
    matrix = _ci_matrix()
    if sorted(matrix) != sorted(SHARDS):
        print(f"ci.yml shards {matrix} differ from scripts/pytest_shards.py {list(SHARDS)}")
        return 1
    jobs = {"(single run)": [], **{name: shard_args(name) for name in SHARDS}}
    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        collected = dict(zip(jobs, pool.map(_collect, jobs.values()), strict=True))
    reference = collected.pop("(single run)")
    owners: dict[str, list[str]] = {}
    for name, ids in collected.items():
        for node in ids:
            owners.setdefault(node, []).append(name)
    ref = set(reference)
    missing = [n for n in reference if n not in owners]
    extra = sorted(n for n in owners if n not in ref)
    twice = sorted(n for n, o in owners.items() if len(o) > 1)
    width = max(map(len, jobs))
    for name, ids in collected.items():
        print(f"{name:<{width}}  {len(ids):5}  {shlex.join(shard_args(name))}")
    total = sum(map(len, collected.values()))
    print(f"{'shards total':<{width}}  {total:5}")
    print(f"{'single run':<{width}}  {len(reference):5}")
    for title, nodes in (("not in any shard", missing), ("not in the single run", extra)):
        for node in nodes:
            print(f"{title}: {node}")
    for node in twice:
        print(f"in several shards {owners[node]}: {node}")
    if missing or extra or twice or len(reference) != len(ref):
        return 1
    print("ok: every test of the single run is in exactly one shard")
    return 0


def main() -> int:
    if sys.argv[1:2] == ["check"]:
        return check()
    if len(sys.argv) == 3 and sys.argv[1] == "args" and sys.argv[2] in SHARDS:
        print(shlex.join(shard_args(sys.argv[2])))
        return 0
    print(f"usage: {sys.argv[0]} check | args {{{','.join(SHARDS)}}}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
