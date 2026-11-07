"""scripts/pytest_shards.py and scripts/check_changed.py (#798): CI shards, the local check."""

import importlib.util
from pathlib import Path
from types import ModuleType

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def _load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


shards = _load("pytest_shards")
changed = _load("check_changed")


def test_a_wider_shard_ignores_the_paths_of_the_narrower_ones() -> None:
    layout = {
        "a-files": ["pkg/a/tests/test_x.py"],
        "a": ["pkg/a"],
        "b": ["pkg/b"],
        "rest": ["."],
    }
    assert shards.shard_args("a-files", layout) == ["pkg/a/tests/test_x.py"]
    assert shards.shard_args("a", layout) == ["pkg/a", "--ignore=pkg/a/tests/test_x.py"]
    # pkg/a/tests/test_x.py goes with pkg/a; a prefix of a name is not a parent directory.
    assert shards.shard_args("rest", layout) == [".", "--ignore=pkg/a", "--ignore=pkg/b"]
    assert shards.shard_args("b", {"b": ["pkg/b"], "bb": ["pkg/bb"]}) == ["pkg/b"]


def test_the_root_shard_ignores_every_other_shard() -> None:
    args: list[str] = shards.shard_args("rest")
    assert args[0] == "."
    ignored = {a.removeprefix("--ignore=") for a in args[1:]}
    tops = {p for name, paths in shards.SHARDS.items() if name != "rest" for p in paths}
    assert all(any(t == i or t.startswith(i + "/") for i in ignored) for t in tops)


def test_the_plan_follows_the_touched_packages() -> None:
    tasks, notes = changed.plan(["packages/sim/src/gow_sim/combat.py", "README.md"], "origin/x")
    assert tasks == [
        ["check"],
        ["test:py", "--", "packages/sim"],
        ["golden:check", "origin/x"],
        ["regen"],
        ["test:client"],
        ["build"],
    ]
    assert len(notes) == 1


def test_the_plan_of_a_bot_or_a_doc_change() -> None:
    assert changed.plan(["apps/bots/src/gow_bots/bots/smart.py"], "b")[0] == [
        ["check"],
        ["test:py", "--", "apps/bots"],
    ]
    assert changed.plan(["docs/design/mechanics.md"], "b") == ([["check"]], [])
    assert changed.plan(["uv.lock", "apps/bots/x.py"], "b")[0] == [["check"], ["test:py"]]


def test_the_plan_of_a_client_change() -> None:
    tasks, notes = changed.plan(["apps/client/src/render/groups.ts"], "b")
    assert tasks == [["check"], ["test:client"], ["build"]]
    assert "shots" in notes[0]
