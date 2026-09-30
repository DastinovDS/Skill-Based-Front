"""Time source of the server (AGENTS.md, section 5.2).

Match loops read time only through a ``Clock``: production uses ``MonotonicClock``, tests use
``ManualClock`` and move time forward by hand, so they never wait for real time.
"""

import asyncio
import time
from typing import Protocol


class Clock(Protocol):
    def now(self) -> float:
        """Monotonic time in seconds."""
        ...

    async def sleep(self, seconds: float) -> None:
        """Wait ``seconds`` of this clock's time; a non-positive value only yields."""
        ...


class MonotonicClock:
    """Real time: ``time.monotonic`` and ``asyncio.sleep``."""

    def now(self) -> float:
        return time.monotonic()

    async def sleep(self, seconds: float) -> None:
        await asyncio.sleep(max(seconds, 0.0))


class ManualClock:
    """Time that moves only when a test calls ``advance``."""

    def __init__(self, start: float = 0.0) -> None:
        self._now = start
        self._sleepers: list[tuple[float, asyncio.Future[None]]] = []

    def now(self) -> float:
        return self._now

    async def sleep(self, seconds: float) -> None:
        if seconds <= 0:
            await asyncio.sleep(0)
            return
        future: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        self._sleepers.append((self._now + seconds, future))
        await future

    def advance(self, seconds: float) -> None:
        """Move time forward and wake every sleeper whose deadline has come."""
        if seconds < 0:
            raise ValueError("time cannot go backwards")
        self._now += seconds
        waiting: list[tuple[float, asyncio.Future[None]]] = []
        for deadline, future in self._sleepers:
            if future.done():  # the sleeping task was cancelled
                continue
            if deadline <= self._now:
                future.set_result(None)
            else:
                waiting.append((deadline, future))
        self._sleepers = waiting
