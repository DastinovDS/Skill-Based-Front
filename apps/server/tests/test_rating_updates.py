"""RAT-02: ``match_end`` of a rated match carries the rating change of the receiving player.

Expected numbers come from an independent Glicko-2 implementation (the PyPI package
``glicko2``, tau = 0.5), not from ``gow_server.rating``: two new players, the first one wins
twice in a row. The displayed rating is ``r - 2 * RD``.

| after            | first win           | second win          |
|------------------|---------------------|---------------------|
| winner r / RD    | 1662.3109 / 290.3190 | 1720.3172 / 260.4888 |
| loser r / RD     | 1337.6891 / 290.3190 | 1279.6828 / 260.4888 |
| winner displayed | 1082 (from 800)     | 1199 (from 1082)    |
| loser displayed  | 757 (from 800)      | 759 (from 757)      |
"""

import asyncio
from pathlib import Path
from typing import Final

from gow_protocol.commands import ForfeitCmd
from gow_protocol.messages import MatchEndMsg, RatingChange
from gow_server.clock import ManualClock
from gow_server.matches import MatchManager, Outbox, Outgoing
from gow_server.rating import Glicko
from gow_sim.maps import load_map
from gow_sim.ruleset import load_ruleset

ROOT: Final = Path(__file__).parents[3]
DT: Final = 0.1


def drain(box: Outbox) -> list[Outgoing]:
    out: list[Outgoing] = []
    while (msg := box.get_nowait()) is not None:
        out.append(msg)
    return out


def test_match_end_of_a_rated_match_carries_the_rating_change() -> None:
    async def scenario() -> None:
        clock = ManualClock()
        mapdef = load_map(ROOT / "packages" / "sim" / "tests" / "maps" / "line3.json")
        rules = load_ruleset(ROOT / "rulesets" / "test-short.toml")
        manager = MatchManager(clock, new_id=lambda: "m1")
        runner = manager.create(
            "line3", mapdef, rules, (101, 202), ratings=(Glicko(), Glicko()), private=False
        )
        boxes = [runner.attach(0), runner.attach(1)]
        await asyncio.sleep(0)
        assert runner.submit(1, 1, ForfeitCmd())
        while manager.get("m1") is not None:
            clock.advance(DT)
            for _ in range(3):
                await asyncio.sleep(0)
        ends = [next(m for m in drain(b) if isinstance(m, MatchEndMsg)) for b in boxes]
        assert ends[0].winner == 0
        assert ends[0].rating == RatingChange(before=800, after=1082)
        assert ends[1].rating == RatingChange(before=800, after=757)

    asyncio.run(scenario())


def test_match_end_of_an_unrated_match_has_no_rating() -> None:
    async def scenario() -> None:
        clock = ManualClock()
        mapdef = load_map(ROOT / "packages" / "sim" / "tests" / "maps" / "line3.json")
        rules = load_ruleset(ROOT / "rulesets" / "test-short.toml")
        manager = MatchManager(clock, new_id=lambda: "m1")
        runner = manager.create("line3", mapdef, rules, (101, 202))
        box = runner.attach(0)
        await asyncio.sleep(0)
        assert runner.submit(1, 1, ForfeitCmd())
        while manager.get("m1") is not None:
            clock.advance(DT)
            for _ in range(3):
                await asyncio.sleep(0)
        end = next(m for m in drain(box) if isinstance(m, MatchEndMsg))
        assert end.rating is None

    asyncio.run(scenario())
