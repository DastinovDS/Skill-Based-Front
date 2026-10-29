"""Per-key rate limits for HTTP endpoints (AGENTS.md, section 5.4)."""

import ipaddress
import threading
from collections import deque

from gow_server.clock import Clock

IPV6_PREFIX = 64
"""A client of an IPv6 network usually controls a whole /64: its address is the prefix."""


def ip_key(host: str) -> str:
    """The key of a per-IP limiter for a client address (#415), used by every per-IP limit.

    IPv4: the address. IPv6: its /64 prefix (``2001:db8::1`` and ``2001:db8::2`` are one client,
    otherwise a /64 gives a new limit for every request). An IPv4-mapped IPv6 address
    (``::ffff:192.0.2.1``) is the IPv4 address. A scope id (``fe80::1%eth0``) is dropped. Anything
    that is not an IP address (a unix socket, a test client) is its own key, as it is.
    """
    try:
        address = ipaddress.ip_address(host.partition("%")[0])
    except ValueError:
        return host
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped is not None:
            return str(address.ipv4_mapped)
        return str(ipaddress.ip_network(f"{address}/{IPV6_PREFIX}", strict=False))
    return str(address)


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


class ConnectionGate:
    """Caps connections that are open at once and not yet authenticated (QA-04, #199).

    A match WebSocket is held for up to ``ws_hello_timeout_s`` before ``hello``, and the message
    bucket starts only after it. ``enter`` counts a connection per key (``ip_key``) and in total;
    ``leave`` ends the count once ``hello`` was read or the connection is gone. Over a cap
    ``enter`` is ``False`` and nothing is counted.

    Not thread-safe on purpose: it is used from the event loop only, where ``enter`` and
    ``leave`` never yield in between.
    """

    def __init__(self, per_key: int, total: int) -> None:
        self._per_key = per_key
        self._total = total
        self._open: dict[str, int] = {}
        self.pending = 0
        """Connections counted now, over all keys."""

    def enter(self, key: str) -> bool:
        if self.pending >= self._total or self._open.get(key, 0) >= self._per_key:
            return False
        self._open[key] = self._open.get(key, 0) + 1
        self.pending += 1
        return True

    def leave(self, key: str) -> None:
        """End the count of a connection that ``enter`` let in (once per ``True``)."""
        left = self._open[key] - 1
        if left:
            self._open[key] = left
        else:
            del self._open[key]
        self.pending -= 1
