"""SRV-01: the manual clock wakes sleepers only when a test moves time forward."""

import asyncio

import pytest

from gow_server.clock import Clock, ManualClock, MonotonicClock


def test_manual_clock_wakes_sleepers_in_time() -> None:
    async def scenario() -> list[str]:
        clock = ManualClock()
        woke: list[str] = []

        async def sleeper(name: str, seconds: float) -> None:
            await clock.sleep(seconds)
            woke.append(f"{name}@{clock.now()}")

        tasks = [asyncio.create_task(sleeper("a", 0.1)), asyncio.create_task(sleeper("b", 0.3))]
        await asyncio.sleep(0)  # let both tasks start sleeping
        clock.advance(0.05)
        await asyncio.sleep(0)
        assert woke == []
        clock.advance(0.05)
        await asyncio.sleep(0)
        assert woke == ["a@0.1"]
        clock.advance(1.0)
        await asyncio.gather(*tasks)
        return woke

    assert asyncio.run(scenario()) == ["a@0.1", "b@1.1"]


def test_manual_clock_non_positive_sleep_only_yields() -> None:
    async def scenario() -> float:
        clock = ManualClock(start=5.0)
        await clock.sleep(0)
        await clock.sleep(-1)
        return clock.now()

    assert asyncio.run(scenario()) == 5.0


def test_manual_clock_skips_cancelled_sleepers() -> None:
    async def scenario() -> None:
        clock = ManualClock()
        task = asyncio.create_task(clock.sleep(1))
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        clock.advance(2)  # must not fail on the cancelled future

    asyncio.run(scenario())


def test_manual_clock_rejects_going_backwards() -> None:
    with pytest.raises(ValueError, match="backwards"):
        ManualClock().advance(-1)


def test_clocks_satisfy_protocol() -> None:
    clocks: list[Clock] = [MonotonicClock(), ManualClock()]
    first, second = clocks[0].now(), clocks[0].now()
    assert second >= first
    assert clocks[1].now() == 0.0
