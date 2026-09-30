"""ID-01: sliding-window rate limiter on a manual clock."""

from gow_server.clock import ManualClock
from gow_server.ratelimit import SlidingWindowLimiter


def test_limit_per_key_and_window_slides() -> None:
    clock = ManualClock()
    limiter = SlidingWindowLimiter(limit=2, window=10, clock=clock)
    assert limiter.hit("a") is None  # t=0
    clock.advance(4)
    assert limiter.hit("a") is None  # t=4
    assert limiter.hit("a") == 6  # the hit at t=0 leaves the window at t=10
    assert limiter.hit("b") is None  # another key has its own budget
    clock.advance(6)  # t=10
    assert limiter.hit("a") is None
    assert limiter.hit("a") == 4  # now the hit at t=4 is the oldest


def test_rejected_hits_do_not_extend_the_block() -> None:
    clock = ManualClock()
    limiter = SlidingWindowLimiter(limit=1, window=10, clock=clock)
    assert limiter.hit("a") is None
    for _ in range(5):
        clock.advance(1)
        assert limiter.hit("a") is not None
    clock.advance(5)  # t=10
    assert limiter.hit("a") is None
