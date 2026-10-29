"""Metrics of the server process in the Prometheus text format (OPS-04, #83).

No client library: a few counters and two histograms are hand-rolled and rendered by
``render``. Matches write into ``ServerMetrics`` (step time, tick lag), the gauges (active
matches, connections, outbox backlog) are read from the ``MatchManager`` at scrape time, the
queue size from the ``MatchQueue`` (MM-01).
The endpoint is ``GET /internal/metrics`` (loopback only, never proxied by Caddy).
"""

import bisect
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Final

if TYPE_CHECKING:
    from gow_server.matches import MatchManager

STEP_BUCKETS_S: Final = (0.0001, 0.0003, 0.001, 0.003, 0.01, 0.03, 0.1)
"""Step duration buckets: budget of AGENTS.md, section 12 is 0.3 ms mean, 1 ms p99."""

LAG_BUCKETS_S: Final = (0.0, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.3)
"""Tick lag buckets; at 10 Hz the 10 % alert threshold is 0.01 s."""


class Histogram:
    """Fixed upper bounds, cumulative on output; ``quantile`` is the bound of its bucket."""

    def __init__(self, bounds: tuple[float, ...]) -> None:
        self.bounds: Final = bounds
        self.counts = [0] * (len(bounds) + 1)
        """Per bucket (the last one is ``+Inf``), not cumulative."""
        self.total = 0.0
        self.count = 0

    def observe(self, value: float) -> None:
        self.counts[bisect.bisect_left(self.bounds, value)] += 1
        self.total += value
        self.count += 1

    def quantile(self, q: float) -> float:
        """Upper bound of the bucket holding the ``q``-quantile; ``inf`` past the last bound."""
        if self.count == 0:
            return 0.0
        wanted, seen = q * self.count, 0
        for index, n in enumerate(self.counts):
            seen += n
            if seen >= wanted:
                return self.bounds[index] if index < len(self.bounds) else float("inf")
        return float("inf")


@dataclass(slots=True)
class ServerMetrics:
    matches_started: int = 0
    matches_finished: int = 0
    matches_crashed: int = 0
    bot_overruns: int = 0
    bot_skipped: int = 0
    matches_refused_full: int = 0
    matches_refused_bot_full: int = 0
    matches_never_started: int = 0
    step_seconds: Histogram = field(default_factory=lambda: Histogram(STEP_BUCKETS_S))
    tick_lag_seconds: Histogram = field(default_factory=lambda: Histogram(LAG_BUCKETS_S))


def _histogram(lines: list[str], name: str, help_text: str, hist: Histogram) -> None:
    lines += [f"# HELP {name} {help_text}", f"# TYPE {name} histogram"]
    cumulative = 0
    for bound, n in zip(hist.bounds, hist.counts, strict=False):
        cumulative += n
        lines.append(f'{name}_bucket{{le="{bound}"}} {cumulative}')
    lines.append(f'{name}_bucket{{le="+Inf"}} {hist.count}')
    lines += [f"{name}_sum {hist.total}", f"{name}_count {hist.count}"]


def _value(lines: list[str], kind: str, name: str, help_text: str, value: float) -> None:
    lines += [f"# HELP {name} {help_text}", f"# TYPE {name} {kind}", f"{name} {value}"]


def render(manager: "MatchManager", queue_size: int = 0) -> str:
    m = manager.metrics
    lines: list[str] = []
    _value(
        lines,
        "gauge",
        "gow_queue_size",
        "Players in the matchmaking queue (searching or confirming a pair).",
        queue_size,
    )
    _value(lines, "gauge", "gow_matches_active", "Matches running now.", manager.active)
    _value(
        lines,
        "gauge",
        "gow_matches_bot_active",
        "Matches against a bot running now.",
        manager.bot_active,
    )
    _value(
        lines,
        "gauge",
        "gow_matches_draining",
        "1 while draining for a deploy.",
        int(manager.draining),
    )
    _value(
        lines,
        "gauge",
        "gow_ws_connections",
        "Open match WebSocket connections.",
        manager.connections,
    )
    _value(
        lines,
        "gauge",
        "gow_outbox_backlog_max",
        "Longest unsent reliable queue of any connection (a client that does not read).",
        manager.outbox_backlog_max,
    )
    _value(lines, "counter", "gow_matches_started_total", "Matches started.", m.matches_started)
    _value(lines, "counter", "gow_matches_finished_total", "Matches finished.", m.matches_finished)
    _value(
        lines,
        "counter",
        "gow_matches_crashed_total",
        "Matches ended by an exception.",
        m.matches_crashed,
    )
    _value(
        lines,
        "counter",
        "gow_matches_refused_full_total",
        "Matches refused: GOW_MAX_MATCHES running matches (503).",
        m.matches_refused_full,
    )
    _value(
        lines,
        "counter",
        "gow_matches_refused_bot_full_total",
        "Bot matches refused: GOW_MAX_BOT_MATCHES running bot matches (503).",
        m.matches_refused_bot_full,
    )
    _value(
        lines,
        "counter",
        "gow_matches_never_started_total",
        "Bot matches dropped: nobody connected within GOW_BOT_CONNECT_TIMEOUT_S.",
        m.matches_never_started,
    )
    _value(
        lines, "counter", "gow_bot_overruns_total", "Bot decisions over the budget.", m.bot_overruns
    )
    _value(
        lines,
        "counter",
        "gow_bot_skipped_total",
        "Bot calls skipped after an overrun.",
        m.bot_skipped,
    )
    _histogram(lines, "gow_step_seconds", "Duration of one match tick.", m.step_seconds)
    _histogram(
        lines,
        "gow_tick_lag_seconds",
        "How late a tick started after it was due.",
        m.tick_lag_seconds,
    )
    return "\n".join(lines) + "\n"
