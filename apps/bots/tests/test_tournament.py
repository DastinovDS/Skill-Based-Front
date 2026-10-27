"""The tournament harness (BOT-04): a smoke tournament on the test-short ruleset."""

import json
import shutil
from itertools import product
from pathlib import Path

import pytest

from gow_bots.bots import BOTS
from gow_bots.cli import main
from gow_bots.tournament import SCHEMA_VERSION, build_tasks
from gow_sim.maps import load_map
from gow_sim.replay import analyze_replay
from gow_sim.ruleset import load_ruleset, ruleset_hash

ROOT = Path(__file__).resolve().parents[3]
MAP = ROOT / "maps" / "fixtures" / "artery.json"
SHORT = ROOT / "rulesets" / "test-short.toml"
SEEDS = 2


# The required CI path plays three bots (9 ordered pairs); the whole registry (49 pairs, ~30 s)
# is the slow variant, see ``pytest.mark.slow`` in ``pyproject.toml``.
SMOKE_BOTS = ["expander", "idle", "random_legal"]
BOT_SETS = [
    pytest.param(SMOKE_BOTS, id="three-bots"),
    pytest.param(sorted(BOTS), id="all-bots", marks=pytest.mark.slow),
]


def _run(out: Path, bots: list[str], *extra: str) -> list[dict[str, object]]:
    argv = ["tournament", "--maps", str(MAP), "--ruleset", str(SHORT), "--seeds", str(SEEDS)]
    argv += ["--bots", *bots]
    assert main([*argv, "--jobs", "2", "--out", str(out), *extra]) == 0
    return [json.loads(line) for line in out.read_text(encoding="ascii").splitlines()]


def test_build_tasks_plays_every_ordered_pair_in_a_fixed_order() -> None:
    tasks = build_tasks([MAP], SHORT, ["random_legal", "idle", "idle"], seeds=SEEDS, seed_base=7)
    assert [(t.bots, t.seed) for t in tasks] == [
        (pair, seed) for seed in (7, 8) for pair in product(("idle", "random_legal"), repeat=2)
    ]


def test_build_tasks_rejects_bad_arguments() -> None:
    with pytest.raises(ValueError, match="unknown bots"):
        build_tasks([MAP], SHORT, ["nope"], seeds=1)
    with pytest.raises(ValueError, match="at least 1"):
        build_tasks([MAP], SHORT, ["idle"], seeds=0)


def test_unknown_bot_is_a_clean_cli_error(tmp_path: Path) -> None:
    argv = ["tournament", "--maps", str(MAP), "--bots", "nope", "--out", str(tmp_path / "x.jsonl")]
    assert main(argv) == 2


@pytest.mark.parametrize("names", BOT_SETS)
def test_smoke_tournament_is_reproducible_and_its_replays_agree(
    tmp_path: Path, names: list[str]
) -> None:
    rows = _run(tmp_path / "a.jsonl", names, "--replays", str(tmp_path / "replays"))
    names = sorted(names)
    assert [(r["bot0"], r["bot1"], r["seed"]) for r in rows] == [
        (b0, b1, seed) for seed in range(SEEDS) for b0, b1 in product(names, repeat=2)
    ]
    rules = load_ruleset(SHORT)
    for r in rows:
        assert r["schema"] == SCHEMA_VERSION
        assert r["map"] == load_map(MAP).meta.name
        assert r["ruleset_hash"] == ruleset_hash(rules)
        assert r["ticks"] == rules.match_ticks or r["reason"] != "unfinished"

    # Same arguments, same bytes (the replays folder does not change the rows).
    _run(tmp_path / "b.jsonl", names)
    assert (tmp_path / "a.jsonl").read_bytes() == (tmp_path / "b.jsonl").read_bytes()

    # The metrics of a replay equal the metrics of the row it was recorded with.
    archive = tmp_path / "archive"
    archive.mkdir()
    shutil.copy(SHORT, archive / f"{ruleset_hash(rules)}.toml")
    row = rows[-1]
    replay = (
        tmp_path / "replays" / f"artery__{row['bot0']}_vs_{row['bot1']}__{row['seed']}.jsonl.gz"
    )
    metrics = analyze_replay(replay, archive, ROOT / "maps" / "fixtures").to_json()
    assert {k: row[k] for k in metrics} == metrics
