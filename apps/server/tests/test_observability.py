"""OPS-04: metrics, alerts on a crashed match and on tick lag."""

import asyncio
import logging
from collections.abc import Callable, Coroutine
from pathlib import Path
from typing import Final

import pytest
from fastapi.testclient import TestClient

from gow_server.alerts import Alerter, LagWatch
from gow_server.app import create_app
from gow_server.clock import ManualClock
from gow_server.matches import MatchManager, MatchRunner
from gow_server.metrics import Histogram, render
from gow_server.settings import Settings
from gow_sim.maps import MapDef, load_map
from gow_sim.ruleset import Ruleset, load_ruleset

ROOT: Final = Path(__file__).parents[3]
DT: Final = 0.1


@pytest.fixture(scope="module")
def line3() -> MapDef:
    return load_map(ROOT / "packages" / "sim" / "tests" / "maps" / "line3.json")


@pytest.fixture(scope="module")
def short_rules() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "test-short.toml")


def run[T](scenario: Callable[[], Coroutine[None, None, T]]) -> T:
    return asyncio.run(scenario())


async def settle() -> None:
    for _ in range(3):
        await asyncio.sleep(0)


class _Crashing(MatchRunner):
    def step(self) -> None:
        if self.match.tick == 2:
            raise RuntimeError("boom")
        super().step()


def alerts_in(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [r for r in caplog.records if r.name == "gow_server.alerts"]


def test_crashed_match_is_logged_with_its_id_and_raises_an_alert(
    line3: MapDef, short_rules: Ruleset, caplog: pytest.LogCaptureFixture
) -> None:
    async def scenario() -> MatchManager:
        clock = ManualClock()
        manager = MatchManager(clock)
        manager.start(_Crashing("m-crash", "line3", line3, short_rules, (1, 2), clock))
        await settle()
        for _ in range(5):
            clock.advance(DT)
            await settle()
        return manager

    with caplog.at_level(logging.INFO):
        manager = run(scenario)
    crashed = [r for r in caplog.records if r.getMessage() == "match crashed"]
    assert [r.__dict__["match_id"] for r in crashed] == ["m-crash"]
    assert crashed[0].exc_info is not None
    (alert,) = alerts_in(caplog)
    assert alert.levelno == logging.ERROR
    assert alert.__dict__["alert"] == "match_crashed"
    assert alert.__dict__["match_id"] == "m-crash"
    assert manager.metrics.matches_crashed == 1


def test_alert_is_not_repeated_within_the_cooldown(caplog: pytest.LogCaptureFixture) -> None:
    now = [0.0]
    alerter = Alerter(cooldown_s=300, now=lambda: now[0])
    with caplog.at_level(logging.ERROR):
        assert alerter.alert("tick_lag", "lag", key="a")
        assert not alerter.alert("tick_lag", "lag", key="a")
        assert alerter.alert("tick_lag", "lag", key="b")
        now[0] = 301.0
        assert alerter.alert("tick_lag", "lag", key="a")
    assert len(alerts_in(caplog)) == 3


def test_tick_lag_over_ten_percent_of_a_tick_raises_an_alert(
    line3: MapDef, short_rules: Ruleset, caplog: pytest.LogCaptureFixture
) -> None:
    async def scenario() -> None:
        clock = ManualClock()
        manager = MatchManager(clock)
        runner = MatchRunner("m-lag", "line3", line3, short_rules, (1, 2), clock)
        manager.start(runner)
        watch = LagWatch(manager.alerter)
        await settle()
        watch.check(manager)  # baseline
        runner.steps += 100
        runner.lag_sum += 100 * 0.009  # 9 ms of a 100 ms tick: under 10 %
        watch.check(manager)
        assert not alerts_in(caplog)
        runner.steps += 100
        runner.lag_sum += 100 * 0.011  # 11 ms: over 10 %
        watch.check(manager)
        await manager.shutdown()

    with caplog.at_level(logging.ERROR):
        run(scenario)
    (alert,) = alerts_in(caplog)
    assert alert.__dict__["alert"] == "tick_lag"
    assert alert.__dict__["match_id"] == "m-lag"


def test_histogram_buckets_and_quantile() -> None:
    hist = Histogram((1.0, 2.0, 4.0))
    for value in (0.5, 1.0, 1.5, 3.0, 10.0):
        hist.observe(value)
    assert hist.counts == [2, 1, 1, 1]
    assert hist.quantile(0.5) == 2.0
    assert hist.quantile(0.99) == float("inf")


def test_metrics_count_matches_steps_and_connections(line3: MapDef, short_rules: Ruleset) -> None:
    async def scenario() -> str:
        clock = ManualClock()
        manager = MatchManager(clock)
        runner = manager.create("line3", line3, short_rules, (1, 2))
        runner.attach(0)
        await settle()
        for _ in range(4):
            clock.advance(DT)
            await settle()
        text = render(manager)
        assert runner.steps == manager.metrics.step_seconds.count > 0
        await manager.shutdown()
        return text

    text = run(scenario)
    lines = text.splitlines()
    assert "gow_matches_active 1" in lines
    assert "gow_ws_connections 1" in lines
    assert "gow_matches_started_total 1" in lines
    assert 'gow_tick_lag_seconds_bucket{le="+Inf"} 5' in lines
    assert "gow_bot_overruns_total 0" in lines
    assert "gow_ws_refused_unauth_total 0" in lines


def test_metrics_endpoint_is_loopback_only(settings: Settings, client: TestClient) -> None:
    assert client.get("/internal/metrics").status_code == 404
    with TestClient(create_app(settings), client=("127.0.0.1", 50000)) as local:
        response = local.get("/internal/metrics")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    assert "gow_matches_active 0" in response.text.splitlines()
    assert "/internal/metrics" not in client.get("/openapi.json").text
