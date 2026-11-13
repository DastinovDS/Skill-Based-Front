"""The command logs of the pool benchmarks still give the recorded match (#1029).

``test_benchmarks_pool.py`` replays ``bench_pool/<map>.jsonl.gz`` to measure the simulation on a
fixed state. A change of a rule, of ``mvp-7`` or of a pool map changes the state the commands
lead to; this test (in the ordinary run, unlike the benchmarks) says so before the benchmarks
measure something else: record the logs again (``mise run bench:record``) and measure the ceilings
again (``docs/perf.md``). A bot change does not touch the logs.
"""

from pathlib import Path
from typing import Final

import pytest

from gow_sim.commands import PlayerCommand
from gow_sim.maps import load_map
from gow_sim.match import Match
from gow_sim.replay import read_replay
from gow_sim.ruleset import load_ruleset

ROOT: Final = Path(__file__).resolve().parents[3]
LOGS: Final = Path(__file__).resolve().parent / "bench_pool"
POOL: Final = sorted(p.stem for p in (ROOT / "maps").glob("*.json"))


def test_every_pool_map_has_a_log() -> None:
    assert sorted(p.name.removesuffix(".jsonl.gz") for p in LOGS.glob("*.jsonl.gz")) == POOL


@pytest.mark.parametrize("name", POOL)
def test_pool_log_replays(name: str) -> None:
    replay = read_replay(LOGS / f"{name}.jsonl.gz")
    assert replay.final
    log: dict[int, list[PlayerCommand]] = {}
    for tick, cmd in replay.commands:
        log.setdefault(tick, []).append(cmd)
    match = Match(
        load_map(ROOT / "maps" / f"{name}.json"),
        load_ruleset(ROOT / "rulesets" / "mvp-7.toml"),
        replay.header.match_key,
    )
    for checkpoint in replay.checkpoints:
        while match.tick < checkpoint.tick:
            match.step(log.get(match.tick + 1, ()))
        assert match.state_hash() == checkpoint.hash, (
            f"{name}: the log no longer gives its match from tick {checkpoint.tick}: "
            "record it again with `mise run bench:record`"
        )
    assert not match.finished
