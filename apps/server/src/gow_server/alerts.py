"""Alerts (OPS-04, #83): a crashed match and tick lag over 10 %.

An alert is one ERROR record of the ``gow_server.alerts`` logger with an ``alert`` field (its
kind). Delivery is not the server's job: the ``app`` container has no route to the outside
world (compose.yaml), so ``deploy/alert-forward.sh`` on the host reads these records from the
container log and posts them to a webhook (docs/ops/deploy.md, "Наблюдаемость").
"""

import asyncio
import logging
import time
from collections.abc import Callable
from typing import TYPE_CHECKING, Final

if TYPE_CHECKING:
    from gow_server.matches import MatchManager

log = logging.getLogger("gow_server.alerts")

LAG_ALERT_RATIO: Final = 0.10
"""Alert when the mean tick lag of a match exceeds this share of the tick period."""

COOLDOWN_S: Final = 300.0
"""The same alert for the same match is raised at most this often."""


class Alerter:
    def __init__(
        self, cooldown_s: float = COOLDOWN_S, now: Callable[[], float] = time.monotonic
    ) -> None:
        self._cooldown_s = cooldown_s
        self._now = now
        self._last: dict[tuple[str, str], float] = {}

    def alert(self, kind: str, message: str, *, key: str, **fields: object) -> bool:
        """Log the alert; ``False``: the same ``(kind, key)`` was raised within the cooldown."""
        now = self._now()
        last = self._last.get((kind, key))
        if last is not None and now - last < self._cooldown_s:
            return False
        self._last[kind, key] = now
        log.error(message, extra={"alert": kind, **fields})
        return True


class LagWatch:
    """Compares each running match's mean tick lag since the previous ``check`` with 10 %."""

    def __init__(self, alerter: Alerter) -> None:
        self._alerter = alerter
        self._seen: dict[str, tuple[int, float, int]] = {}
        """Per match: ``steps``, ``lag_sum`` and ``resets`` at the previous check."""

    def check(self, manager: "MatchManager") -> None:
        live: set[str] = set()
        for runner in manager.runners():
            live.add(runner.match_id)
            steps, lag_sum, resets = self._seen.get(runner.match_id, (0, 0.0, 0))
            self._seen[runner.match_id] = (runner.steps, runner.lag_sum, runner.resets)
            new_steps = runner.steps - steps
            if new_steps <= 0:
                continue
            mean = (runner.lag_sum - lag_sum) / new_steps
            if mean > LAG_ALERT_RATIO * runner.dt or runner.resets > resets:
                self._alerter.alert(
                    "tick_lag",
                    f"match {runner.match_id}: tick lag {1000 * mean:.1f} ms "
                    f"({100 * mean / runner.dt:.0f} % of a tick)",
                    key=runner.match_id,
                    match_id=runner.match_id,
                    lag_mean_ms=round(1000 * mean, 2),
                    resets=runner.resets - resets,
                )
        for gone in self._seen.keys() - live:
            del self._seen[gone]


async def monitor(manager: "MatchManager", interval_s: float) -> None:
    """Run ``LagWatch`` every ``interval_s`` seconds of real time until cancelled."""
    watch = LagWatch(manager.alerter)
    while True:
        await asyncio.sleep(interval_s)
        watch.check(manager)
