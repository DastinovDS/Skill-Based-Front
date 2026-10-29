"""QA-03: the load harness ``gow_server.loadtest``: its parsing, and a tiny run on a real server.

The run uses the real clock, a few seconds and two matches: it checks that the harness plays the
invite flow, connects over WebSockets, reads the metrics and ends the matches, not any number.
"""

import asyncio
import math
import os
import shutil
from pathlib import Path
from typing import Final

import pytest
import uvicorn

from gow_server import loadtest
from gow_server.app import create_app
from gow_server.cli import WS_MAX_SIZE
from gow_server.clock import ManualClock
from gow_server.loadtest import (
    PROC,
    Options,
    Report,
    format_report,
    judge_lag,
    parse_metrics,
    read_process,
    run,
)
from gow_server.matches import MatchManager
from gow_server.metrics import render
from gow_server.settings import Settings

ROOT: Final = Path(__file__).parents[3]

METRICS: Final = """# HELP gow_matches_active Matches running now.
# TYPE gow_matches_active gauge
gow_matches_active 30.0
# TYPE gow_tick_lag_seconds histogram
gow_tick_lag_seconds_bucket{le="0.0"} 10
gow_tick_lag_seconds_bucket{le="0.01"} 90
gow_tick_lag_seconds_bucket{le="0.1"} 99
gow_tick_lag_seconds_bucket{le="+Inf"} 100
gow_tick_lag_seconds_sum 0.5
gow_tick_lag_seconds_count 100
"""


def test_parse_metrics_reads_gauges_and_histograms() -> None:
    scrape = parse_metrics(METRICS)
    assert scrape.value("gow_matches_active") == 30
    assert scrape.value("gow_no_such_metric") == 0
    lag = scrape.histograms["gow_tick_lag_seconds"]
    assert lag.bounds == (0.0, 0.01, 0.1)
    assert lag.cumulative == (10, 90, 99, 100)
    assert lag.count == 100
    assert lag.mean() == pytest.approx(0.005)
    assert lag.quantile(0.5) == 0.01
    assert lag.quantile(0.99) == 0.1
    assert lag.quantile(1.0) == math.inf
    assert lag.share_over(0.01) == pytest.approx(0.10)


def test_histogram_difference_is_the_window() -> None:
    earlier = parse_metrics(METRICS).histograms["gow_tick_lag_seconds"]
    later = parse_metrics(
        """gow_tick_lag_seconds_bucket{le="0.0"} 10
gow_tick_lag_seconds_bucket{le="0.01"} 190
gow_tick_lag_seconds_bucket{le="0.1"} 299
gow_tick_lag_seconds_bucket{le="+Inf"} 300
gow_tick_lag_seconds_sum 1.5
gow_tick_lag_seconds_count 300
"""
    ).histograms["gow_tick_lag_seconds"]
    window = later.minus(earlier)
    assert window.count == 200
    assert window.cumulative == (0, 100, 200, 200)
    assert window.mean() == pytest.approx(0.005)


def test_parse_metrics_reads_what_the_server_renders() -> None:
    manager = MatchManager(ManualClock())
    manager.metrics.tick_lag_seconds.observe(0.004)
    manager.metrics.step_seconds.observe(0.0002)
    scrape = parse_metrics(render(manager))
    assert scrape.histograms["gow_tick_lag_seconds"].count == 1
    assert scrape.histograms["gow_step_seconds"].quantile(0.99) == 0.0003
    assert scrape.value("gow_ws_refused_unauth_total") == 0


@pytest.mark.skipif(not PROC.is_dir(), reason="needs /proc (Linux)")
def test_read_process_gives_cpu_and_memory_of_a_pid() -> None:
    cpu, rss = read_process(os.getpid()) or (-1.0, -1)
    assert cpu >= 0
    assert rss > 0
    assert read_process(2**22 + 1) is None


def test_two_matches_run_end_to_end(
    maps_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(loadtest, "MOVE_EVERY_TICKS", 5)  # the clients act within a short run
    shutil.copy(ROOT / "maps" / "fixtures" / "web.json", maps_dir)
    settings = Settings(
        maps_dir=maps_dir,
        database_url=f"sqlite:///{tmp_path / 'gow.db'}",
        ruleset_path=ROOT / "rulesets" / "test-short.toml",
        rulesets_dir=tmp_path / "rulesets",
        guest_rate_limit=100,
    )

    async def scenario() -> Report:
        app = create_app(settings)  # the real clock: the harness measures real time
        config = uvicorn.Config(
            app, host="127.0.0.1", port=0, log_config=None, ws_max_size=WS_MAX_SIZE, lifespan="on"
        )
        server = uvicorn.Server(config)
        task = asyncio.create_task(server.serve())
        while not server.started:
            await asyncio.sleep(0.01)
        port = server.servers[0].sockets[0].getsockname()[1]
        try:
            return await run(
                Options(f"http://127.0.0.1:{port}", 2, 2.0, 0.5, "web", 1.0, True, None, 0)
            )
        finally:
            server.should_exit = True
            await task

    report = asyncio.run(scenario())
    judge_lag(report)
    assert report.matches_started == 2
    assert report.matches_ended == 2
    assert report.server is not None
    assert report.server["steps"] > 0
    assert report.server["matches_crashed"] == 0
    assert report.client["snapshots"] > 0
    assert report.client["moves_sent"] > 0
    assert report.client["errors"] == {}
    assert report.samples
    text = format_report(report)
    assert "mean tick lag" in text
    assert "2 started, 2 ended cleanly" in text
