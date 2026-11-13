"""Record the command logs the pool benchmarks replay (#1029).

    uv run python scripts/bench_pool_record.py        # mise run bench:record

``apps/bots/tests/test_benchmarks_pool.py`` measures the simulation on the state of a smart-bot
match on each pool map. The bots play it only here: the benchmarks replay the recorded commands,
so a change of a bot no longer changes what the simulation benchmarks measure (it moved the
supply flow by 20 to 50% per map on the same machine, #1029). One ``.jsonl.gz`` replay per map
(``gow_sim.replay`` format, a checkpoint hash every 50 ticks) in ``apps/bots/tests/bench_pool/``.

Record again when the state of the replay changes: a rule or ``SIM_VERSION``, the ruleset
``mvp-7`` or a pool map (``test_pool_logs_replay`` fails and names this command). Then measure
the ceilings of ``CEILING_MS`` again (``docs/perf.md``). A bot change needs neither.
"""

import sys
from pathlib import Path

from gow_bots.bots import BOTS
from gow_sim.commands import PlayerCommand
from gow_sim.maps import PLAYERS, load_map
from gow_sim.match import DECIDE_EVERY, Match
from gow_sim.replay import ReplayWriter
from gow_sim.ruleset import load_ruleset

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps" / "bots" / "tests" / "bench_pool"
KEY = bytes(range(32))
"""The match key of the benchmarks (``test_benchmarks_pool.KEY``)."""
TICKS = 4500
"""The warm-up of the benchmarks (3000 ticks) plus the 1500 ticks their step benchmark plays."""
BOT_NAMES = ("smart_rusher", "smart_expander")
SEED = 7


def record(name: str) -> None:
    mapdef = load_map(ROOT / "maps" / f"{name}.json")
    match = Match(mapdef, load_ruleset(ROOT / "rulesets" / "mvp-7.toml"), KEY)
    bots = [BOTS[n](mapdef, match.rules, seed=SEED, player=p) for p, n in enumerate(BOT_NAMES)]
    seq = 0
    with ReplayWriter(OUT / f"{name}.jsonl.gz") as writer:
        writer.begin(match)
        while match.tick < TICKS:
            if match.finished:
                raise SystemExit(f"{name}: the match ended at tick {match.tick}, before {TICKS}")
            cmds: list[PlayerCommand] = []
            if match.tick % DECIDE_EVERY == 0:
                for p in PLAYERS:
                    for cmd in bots[p].decide(match.view(p, reuse=True), match.tick):
                        cmds.append(PlayerCommand(p, seq, match.resolve(p, cmd)))
                        seq += 1
            match.step(cmds)
            writer.record(match, cmds)
    print(f"{name}: {TICKS} ticks, {seq} commands")


def main() -> None:
    names = sys.argv[1:] or sorted(p.stem for p in (ROOT / "maps").glob("*.json"))
    for name in names:
        record(name)


if __name__ == "__main__":
    main()
