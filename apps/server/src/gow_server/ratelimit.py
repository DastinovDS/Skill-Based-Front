"""Per-key rate limits for HTTP endpoints (AGENTS.md, section 5.4)."""

import threading
from collections import deque

from gow_server.clock import Clock


class SlidingWindowLimiter:
    """At most ``limit`` hits per key within any ``window`` seconds.

    Thread-safe: ``def`` endpoints run concurrently in the FastAPI threadpool.
    """

    def __init__(self, limit: int, window: float, clock: Clock) -> None:
        self._limit = limit
        self._window = window
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str) -> float | None:
        """Count a hit. Returns ``None`` if allowed, else seconds until the next allowed hit."""
        now = self._clock.now()
        with self._lock:
            self._forget_before(now - self._window)
            hits = self._hits.setdefault(key, deque())
            if len(hits) >= self._limit:
                return hits[0] + self._window - now
            hits.append(now)
            return None

    def _forget_before(self, cutoff: float) -> None:
        for key in list(self._hits):
            hits = self._hits[key]
            while hits and hits[0] <= cutoff:
                hits.popleft()
            if not hits:
                del self._hits[key]
