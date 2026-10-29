"""Load harness (QA-03, #85): N matches played by scripted clients over real WebSockets.

``python -m gow_server.loadtest --matches 30 --duration 180`` against a running server. Per
match it creates two guests, plays the invite flow (``POST /api/matches``, ``join``, ``ready``
twice) and connects both players over ``/ws/match/{id}`` like the web client: ``hello``, then
every 25 ticks each idle group of a player goes to a random neighbour node (the clients of
``test_match_load`` and ``test_e2e_match``). Matches start spread over ``--ramp-s`` seconds, like
real ones; the measured window starts when all of them run. At the end one player of each match
resigns (``ForfeitCmd``), so no match is left to the 60-second reconnect window.

Measured in the window, from ``GET /internal/metrics`` (before and after, histograms by delta):
tick lag (mean, share of ticks over 10 % of the tick, p99 bucket), step duration (mean, p99
bucket), matches crashed, connections refused. From ``/proc`` of the server process (Linux,
sampled every ``--sample-s``): CPU and resident memory. From the clients: the gaps between the
snapshots they received (what a player feels), the messages they got and the errors.

``/internal/metrics`` answers on loopback only (``gow_server.internal``), so run the harness
inside the ``app`` container, where it finds the server process in ``/proc`` too::

    docker compose exec -T app python -m gow_server.loadtest --matches 30 --duration 180

Without access to the metrics (another machine, through Caddy) pass ``--no-server-metrics``: only
the client-side numbers and the verdict on them remain. Details and the limits to raise for the
run (guests per IP, matches): ``docs/qa/load.md``.

Only the standard library and the project's own packages: HTTP with ``urllib`` in threads, the
sockets with ``websockets`` (already a dependency of the server).
"""

import argparse
import asyncio
import json
import math
import os
import random
import re
import statistics
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from contextlib import suppress
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Final

from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed, WebSocketException
from websockets.typing import Origin

from gow_protocol.codec import decode_server, encode
from gow_protocol.commands import ForfeitCmd, MoveCmd
from gow_protocol.messages import (
    PROTOCOL_VERSION,
    CommandMsg,
    ErrorMsg,
    HelloMsg,
    MatchEndMsg,
    WelcomeMsg,
)
from gow_server.ws import CLOSE_TRY_LATER

LAG_BUDGET: Final = 0.10
"""Mean tick lag, as a share of the tick period, that AGENTS.md, section 12 allows."""
MOVE_EVERY_TICKS: Final = 25
"""A client orders its idle groups this often (2.5 s at 10 Hz): well under the message bucket."""
CONNECT_PARALLEL: Final = 4
"""Sockets between the upgrade and ``welcome`` at a time. All clients share one address, and the
server caps sockets that have not sent ``hello`` per address (``GOW_WS_UNAUTH_PER_IP``, #199)."""
CONNECT_ATTEMPTS: Final = 20
SNAPSHOT_HEAD: Final = re.compile(r'\{"type":"snapshot","tick":(\d+),')
"""The tick sits at the start of a snapshot frame: read it without parsing the frame."""
PROC: Final = Path("/proc")


# Metrics ------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Histogram:
    """A histogram of ``/internal/metrics``: cumulative bucket counts, sum and count."""

    bounds: tuple[float, ...]
    cumulative: tuple[int, ...]
    """One per bound, then ``+Inf``."""
    total: float
    count: int

    def minus(self, earlier: "Histogram") -> "Histogram":
        return Histogram(
            self.bounds,
            tuple(a - b for a, b in zip(self.cumulative, earlier.cumulative, strict=True)),
            self.total - earlier.total,
            self.count - earlier.count,
        )

    def mean(self) -> float:
        return self.total / self.count if self.count else 0.0

    def quantile(self, q: float) -> float:
        """Upper bound of the bucket holding the ``q``-quantile; ``inf`` past the last bound."""
        if not self.count:
            return 0.0
        for bound, seen in zip((*self.bounds, math.inf), self.cumulative, strict=True):
            if seen >= q * self.count:
                return bound
        return math.inf

    def share_over(self, bound: float) -> float:
        """Share of observations above ``bound`` (a bucket bound)."""
        if not self.count:
            return 0.0
        index = self.bounds.index(bound)
        return (self.count - self.cumulative[index]) / self.count


@dataclass(frozen=True, slots=True)
class Scrape:
    values: dict[str, float]
    histograms: dict[str, Histogram]

    def value(self, name: str) -> float:
        return self.values.get(name, 0.0)


_SAMPLE: Final = re.compile(r'^(\w+)(?:\{le="([^"]+)"\})? (\S+)$')


def parse_metrics(text: str) -> Scrape:
    """Parse the Prometheus text of ``gow_server.metrics.render`` (no other labels exist)."""
    values: dict[str, float] = {}
    buckets: dict[str, list[tuple[float, int]]] = {}
    for line in text.splitlines():
        found = _SAMPLE.match(line)
        if line.startswith("#") or found is None:
            continue
        name, bound, raw = found.groups()
        if bound is not None:
            buckets.setdefault(name.removesuffix("_bucket"), []).append(
                (math.inf if bound == "+Inf" else float(bound), int(float(raw)))
            )
        else:
            values[name] = float(raw)
    histograms: dict[str, Histogram] = {}
    for name, pairs in buckets.items():
        pairs.sort()
        histograms[name] = Histogram(
            tuple(b for b, _ in pairs if b != math.inf),
            tuple(n for _, n in pairs),
            values.get(f"{name}_sum", 0.0),
            int(values.get(f"{name}_count", 0)),
        )
    return Scrape(values, histograms)


# The server process -------------------------------------------------------------------------


def find_server_pid() -> int | None:
    """The pid of ``gow-server`` in ``/proc`` (inside the container), else ``None``."""
    if not PROC.is_dir():
        return None
    for entry in PROC.iterdir():
        if not entry.name.isdigit() or int(entry.name) == os.getpid():
            continue
        try:
            command = (entry / "cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
        except OSError:
            continue
        if "gow-server" in command or "gow_server.cli" in command:
            return int(entry.name)
    return None


def read_process(pid: int) -> tuple[float, int] | None:
    """CPU seconds (user + system) and resident bytes of ``pid``; ``None`` when unreadable."""
    try:
        stat = (PROC / str(pid) / "stat").read_text()
        # The command (field 2) may hold spaces and brackets: count fields after the last ")".
        fields = stat.rsplit(")", 1)[1].split()
        ticks = int(fields[11]) + int(fields[12])  # utime, stime
        pages = int((PROC / str(pid) / "statm").read_text().split()[1])
        return ticks / os.sysconf("SC_CLK_TCK"), pages * os.sysconf("SC_PAGE_SIZE")
    except (OSError, ValueError, IndexError):
        return None


@dataclass(slots=True)
class Sample:
    at_s: float
    """Seconds since the start of the window."""
    matches: int
    connections: int
    cpu_pct: float | None
    rss_mb: float | None


# HTTP ---------------------------------------------------------------------------------------


class HttpError(Exception):
    def __init__(self, status: int, what: str) -> None:
        super().__init__(f"{what}: HTTP {status}")
        self.status = status


def _request(
    base: str, method: str, path: str, token: str | None = None, body: object | None = None
) -> Any:
    data = None if body is None else json.dumps(body).encode()
    headers = {"Content-Type": "application/json"} if data is not None else {}
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        raise HttpError(exc.code, f"{method} {path}") from None
    text = raw.decode()
    return json.loads(text) if text.startswith(("{", "[")) else text


async def call(
    base: str, method: str, path: str, token: str | None = None, body: object | None = None
) -> Any:
    return await asyncio.to_thread(_request, base, method, path, token, body)


# Clients ------------------------------------------------------------------------------------


@dataclass(slots=True)
class ClientStats:
    snapshots: int = 0
    moves: int = 0
    gaps_s: list[float] = field(default_factory=lambda: [])
    errors: Counter[str] = field(default_factory=lambda: Counter[str]())
    refused: int = 0
    """Times the server answered 1013 (too many sockets before ``hello``) and the client retried."""
    close_codes: Counter[int] = field(default_factory=lambda: Counter[int]())


class Player:
    """A scripted client of one seat of a match."""

    def __init__(
        self,
        ws_base: str,
        match_id: str,
        token: str,
        neighbours: dict[int, list[int]],
        seed: int,
        gate: asyncio.Semaphore,
        stats: ClientStats,
    ) -> None:
        self.ws_base = ws_base
        self.match_id = match_id
        self.token = token
        self.neighbours = neighbours
        self.rng = random.Random(seed)
        self.gate = gate
        self.stats = stats
        self.seq = 0
        self.tick_hz = 10
        self.end: MatchEndMsg | None = None
        self.ws: ClientConnection | None = None

    async def connect(self) -> None:
        """Open the socket and read ``welcome``; retry when the server says "try later"."""
        origin = "http" + self.ws_base.removeprefix("ws")
        for _ in range(CONNECT_ATTEMPTS):
            async with self.gate:
                ws = await connect(
                    f"{self.ws_base}/ws/match/{self.match_id}",
                    origin=Origin(origin),
                    open_timeout=15,
                    max_size=None,
                )
                try:
                    await ws.send(
                        encode(HelloMsg(protocol_version=PROTOCOL_VERSION, token=self.token))
                    )
                    first = decode_server(await asyncio.wait_for(ws.recv(), 15))
                except ConnectionClosed:
                    if ws.close_code == CLOSE_TRY_LATER:
                        self.stats.refused += 1
                        await asyncio.sleep(0.5)
                        continue
                    raise
            if isinstance(first, WelcomeMsg):
                self.tick_hz = first.ruleset_public.tick_hz
                self.ws = ws
                return
            await ws.close()
            raise RuntimeError(f"expected welcome, got {first.type}")
        raise RuntimeError("the server kept answering 1013")

    async def play(self) -> None:
        ws = self.ws
        assert ws is not None
        last: float | None = None
        loop = asyncio.get_running_loop()
        try:
            async for raw in ws:
                head = SNAPSHOT_HEAD.match(raw) if isinstance(raw, str) else None
                if head is None:
                    self._other(raw)
                    continue
                now = loop.time()
                self.stats.snapshots += 1
                if last is not None:
                    self.stats.gaps_s.append(now - last)
                last = now
                if int(head.group(1)) % MOVE_EVERY_TICKS == 0:
                    await self._move(ws, json.loads(raw))
        except ConnectionClosed:
            pass
        except WebSocketException as exc:
            self.stats.errors[type(exc).__name__] += 1
        if ws.close_code is not None:
            self.stats.close_codes[ws.close_code] += 1

    def _other(self, raw: str | bytes) -> None:
        msg = decode_server(raw)
        if isinstance(msg, MatchEndMsg):
            self.end = msg
        elif isinstance(msg, ErrorMsg):
            self.stats.errors[msg.code] += 1

    async def _move(self, ws: ClientConnection, snapshot: dict[str, Any]) -> None:
        """Read the frame as plain JSON, like the bulk of a real client's work would be."""
        for group in snapshot["view"]["groups"]:
            location = group["location"]
            if group["order"] is None and location["kind"] == "node":
                dest = self.rng.choice(self.neighbours[location["node"]])
                self.seq += 1
                self.stats.moves += 1
                cmd = MoveCmd(group=group["id"], dest=dest, planned=False)
                await ws.send(encode(CommandMsg(seq=self.seq, cmd=cmd)))

    async def resign(self) -> None:
        assert self.ws is not None
        self.seq += 1
        await self.ws.send(encode(CommandMsg(seq=self.seq, cmd=ForfeitCmd())))


# The run ------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Options:
    base_url: str
    matches: int
    duration_s: float
    ramp_s: float
    map_id: str | None
    sample_s: float
    server_metrics: bool
    pid: int | None
    seed: int


@dataclass(slots=True)
class Report:
    options: dict[str, Any]
    matches_started: int
    matches_ended: int
    tick_hz: int
    window_s: float
    server: dict[str, Any] | None
    process: dict[str, Any] | None
    client: dict[str, Any]
    harness_cpu_pct: float
    samples: list[Sample]
    verdict: list[str]
    passed: bool


def neighbours_of(map_file: dict[str, Any]) -> dict[int, list[int]]:
    result: dict[int, list[int]] = {}
    for edge in map_file["edges"]:
        result.setdefault(edge["a"], []).append(edge["b"])
        result.setdefault(edge["b"], []).append(edge["a"])
    return result


async def start_match(base: str, index: int, map_id: str, tokens: tuple[str, str]) -> str:
    """The invite flow of two guests; returns the id of the started match."""
    created = await call(base, "POST", "/api/matches", tokens[0], {"map_id": map_id})
    code = created["code"]
    started: dict[str, Any] = {}
    for token, action in ((tokens[1], "join"), (tokens[0], "ready"), (tokens[1], "ready")):
        started = await call(base, "POST", f"/api/matches/{code}/{action}", token)
    if started.get("state") != "started":
        raise RuntimeError(f"match {index} did not start: {started.get('state')}")
    return str(started["match_id"])


async def make_guests(base: str, count: int) -> list[str]:
    tokens: list[str] = []
    for n in range(count):
        try:
            guest = await call(base, "POST", "/api/guest", body={"nick": f"load{n:03d}"})
        except HttpError as exc:
            if exc.status == 429:
                raise SystemExit(
                    f"429 after {n} guests: raise GOW_GUEST_RATE_LIMIT to at least {count} "
                    "for the run (docs/qa/load.md)"
                ) from None
            raise
        tokens.append(guest["token"])
    return tokens


async def scrape(base: str) -> Scrape:
    return parse_metrics(await call(base, "GET", "/internal/metrics"))


def percentile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(q * len(ordered)))] if ordered else 0.0


async def run(opts: Options) -> Report:
    base = opts.base_url.rstrip("/")
    ws_base = "ws" + base.removeprefix("http")
    rng = random.Random(opts.seed)
    maps = await call(base, "GET", "/api/maps")
    map_id = opts.map_id or str(maps[0]["id"])
    neighbours = neighbours_of(await call(base, "GET", f"/api/maps/{map_id}"))
    before_start = await scrape(base) if opts.server_metrics else None
    if before_start is not None and before_start.value("gow_matches_active"):
        raise SystemExit("the server already runs matches: the numbers would not be ours")
    log(f"{opts.matches} matches on {map_id}: creating {2 * opts.matches} guests")
    tokens = await make_guests(base, 2 * opts.matches)

    stats = ClientStats()
    gate = asyncio.Semaphore(CONNECT_PARALLEL)
    players: list[list[Player]] = []

    async def launch(index: int) -> None:
        await asyncio.sleep(rng.uniform(0, opts.ramp_s))
        pair = (tokens[2 * index], tokens[2 * index + 1])
        match_id = await start_match(base, index, map_id, pair)
        seats = [
            Player(ws_base, match_id, pair[seat], neighbours, 2 * index + seat, gate, stats)
            for seat in (0, 1)
        ]
        await asyncio.gather(*(p.connect() for p in seats))
        players.append(seats)

    await asyncio.gather(*(launch(i) for i in range(opts.matches)))
    tasks = [asyncio.create_task(p.play()) for seats in players for p in seats]
    tick_hz = players[0][0].tick_hz
    log(f"all {len(players)} matches run; measuring for {opts.duration_s:.0f} s")

    pid = opts.pid
    if pid is None:
        pid = find_server_pid()
    loop = asyncio.get_running_loop()
    cpu_start, wall_start = time.process_time(), loop.time()
    first = await scrape(base) if opts.server_metrics else None
    process_start = read_process(pid) if pid else None
    samples: list[Sample] = []
    previous = (wall_start, process_start)
    while (elapsed := loop.time() - wall_start) < opts.duration_s:
        await asyncio.sleep(min(opts.sample_s, opts.duration_s - elapsed))
        now = loop.time()
        current = read_process(pid) if pid else None
        cpu_pct = rss_mb = None
        if current is not None:
            rss_mb = current[1] / 2**20
            if previous[1] is not None:
                cpu_pct = 100 * (current[0] - previous[1][0]) / (now - previous[0])
        live = await scrape(base) if opts.server_metrics else None
        samples.append(
            Sample(
                now - wall_start,
                int(live.value("gow_matches_active")) if live else len(players),
                int(live.value("gow_ws_connections")) if live else 2 * len(players),
                cpu_pct,
                rss_mb,
            )
        )
        previous = (now, current)
    window_s = loop.time() - wall_start
    harness_cpu_pct = 100 * (time.process_time() - cpu_start) / window_s
    last = await scrape(base) if opts.server_metrics else None
    process_end = read_process(pid) if pid else None

    ended = await finish(players)
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)

    server = server_numbers(first, last) if first and last else None
    process = process_numbers(process_start, process_end, window_s, samples)
    client = client_numbers(stats, tick_hz)
    verdict, passed = judge(server, client, len(players), ended, opts)
    return Report(
        asdict(opts),
        len(players),
        ended,
        tick_hz,
        window_s,
        server,
        process,
        client,
        harness_cpu_pct,
        samples,
        verdict,
        passed,
    )


async def finish(players: list[list[Player]]) -> int:
    """Player 0 of each match resigns; wait for every ``match_end``. Returns how many arrived."""
    for seats in players:
        with suppress(ConnectionClosed):
            await seats[0].resign()
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if all(p.end is not None for seats in players for p in seats):
            break
        await asyncio.sleep(0.1)
    return sum(1 for seats in players if all(p.end is not None for p in seats))


def server_numbers(first: Scrape, last: Scrape) -> dict[str, Any]:
    lag = last.histograms["gow_tick_lag_seconds"].minus(first.histograms["gow_tick_lag_seconds"])
    step = last.histograms["gow_step_seconds"].minus(first.histograms["gow_step_seconds"])

    def delta(name: str) -> int:
        return int(last.value(name) - first.value(name))

    return {
        "steps": step.count,
        "tick_lag_mean_ms": 1000 * lag.mean(),
        "tick_lag_p99_bucket_ms": 1000 * lag.quantile(0.99),
        "tick_lag_over_10ms_share": lag.share_over(0.01),
        "step_mean_ms": 1000 * step.mean(),
        "step_p99_bucket_ms": 1000 * step.quantile(0.99),
        "matches_active_end": int(last.value("gow_matches_active")),
        "ws_connections_end": int(last.value("gow_ws_connections")),
        "outbox_backlog_max": int(last.value("gow_outbox_backlog_max")),
        "matches_crashed": delta("gow_matches_crashed_total"),
        "bot_overruns": delta("gow_bot_overruns_total"),
        "refused_full": delta("gow_matches_refused_full_total"),
        "ws_refused_unauth": delta("gow_ws_refused_unauth_total"),
    }


def process_numbers(
    start: tuple[float, int] | None,
    end: tuple[float, int] | None,
    window_s: float,
    samples: list[Sample],
) -> dict[str, Any] | None:
    if start is None or end is None:
        return None
    cpu = [s.cpu_pct for s in samples if s.cpu_pct is not None]
    rss = [s.rss_mb for s in samples if s.rss_mb is not None]
    return {
        "cpu_mean_pct": 100 * (end[0] - start[0]) / window_s,
        "cpu_max_sample_pct": max(cpu, default=0.0),
        "rss_start_mb": start[1] / 2**20,
        "rss_end_mb": end[1] / 2**20,
        "rss_max_mb": max(rss, default=0.0),
    }


def client_numbers(stats: ClientStats, tick_hz: int) -> dict[str, Any]:
    tick = 1 / tick_hz
    gaps = stats.gaps_s
    return {
        "snapshots": stats.snapshots,
        "moves_sent": stats.moves,
        "gap_mean_ms": 1000 * statistics.fmean(gaps) if gaps else 0.0,
        "gap_p99_ms": 1000 * percentile(gaps, 0.99),
        "gap_max_ms": 1000 * max(gaps, default=0.0),
        "gaps_over_1_5_ticks_share": (
            sum(1 for g in gaps if g > 1.5 * tick) / len(gaps) if gaps else 0.0
        ),
        "refused_1013_retries": stats.refused,
        "errors": dict(stats.errors),
        "close_codes": {str(code): n for code, n in sorted(stats.close_codes.items())},
    }


def judge(
    server: dict[str, Any] | None,
    client: dict[str, Any],
    started: int,
    ended: int,
    opts: Options,
) -> tuple[list[str], bool]:
    """The verdict lines; the run passes when every check that could be made passed."""
    lines: list[str] = []
    ok = True

    def check(good: bool, text: str) -> None:
        nonlocal ok
        ok = ok and good
        lines.append(("PASS  " if good else "FAIL  ") + text)

    check(started == opts.matches, f"{started} of {opts.matches} matches started")
    check(ended == started, f"{ended} of {started} matches ended cleanly after the resign")
    if server is not None:
        check(server["matches_crashed"] == 0, f"matches crashed: {server['matches_crashed']}")
        check(server["steps"] > 0, f"server steps in the window: {server['steps']}")
    else:
        lines.append("SKIP  server metrics were not read: no tick lag verdict")
    check(not client["errors"], f"client errors: {client['errors'] or 'none'}")
    return lines, ok


def judge_lag(report: Report) -> None:
    """The tick lag verdict, needs the tick period (known from ``welcome`` after the run)."""
    if report.server is None:
        return
    budget_ms = 1000 * LAG_BUDGET / report.tick_hz
    mean_ms = report.server["tick_lag_mean_ms"]
    good = mean_ms < budget_ms
    report.passed = report.passed and good
    share = 100 * mean_ms / (1000 / report.tick_hz)
    report.verdict.insert(
        0,
        ("PASS  " if good else "FAIL  ")
        + f"mean tick lag {mean_ms:.2f} ms = {share:.1f}% of the tick (budget {LAG_BUDGET:.0%}, "
        f"{budget_ms:.0f} ms)",
    )


def log(text: str) -> None:
    print(f"[loadtest] {text}", file=sys.stderr, flush=True)


def format_report(report: Report) -> str:
    out = [
        f"Matches: {report.matches_started} started, {report.matches_ended} ended cleanly; "
        f"window {report.window_s:.0f} s at {report.tick_hz} ticks/s",
    ]
    if report.server:
        s = report.server
        out += [
            f"Server steps in the window: {s['steps']}",
            f"Tick lag: mean {s['tick_lag_mean_ms']:.2f} ms, "
            f"{100 * s['tick_lag_over_10ms_share']:.2f}% of ticks over 10 ms, "
            f"p99 bucket <= {s['tick_lag_p99_bucket_ms']:.0f} ms",
            f"Step: mean {s['step_mean_ms']:.3f} ms, "
            f"p99 bucket <= {s['step_p99_bucket_ms']:.1f} ms",
            f"Crashed {s['matches_crashed']}, bot overruns {s['bot_overruns']}, refused (full) "
            f"{s['refused_full']}, refused before hello {s['ws_refused_unauth']}, "
            f"outbox backlog max {s['outbox_backlog_max']}",
        ]
    if report.process:
        p = report.process
        out.append(
            f"Server process: CPU mean {p['cpu_mean_pct']:.0f}% of one core (max sample "
            f"{p['cpu_max_sample_pct']:.0f}%), RSS {p['rss_start_mb']:.0f} -> "
            f"{p['rss_end_mb']:.0f} MB (max {p['rss_max_mb']:.0f})"
        )
    c = report.client
    out += [
        f"Clients: {c['snapshots']} snapshots, {c['moves_sent']} moves; gap between snapshots "
        f"mean {c['gap_mean_ms']:.1f} ms, p99 {c['gap_p99_ms']:.1f} ms, "
        f"max {c['gap_max_ms']:.0f} ms, "
        f"{100 * c['gaps_over_1_5_ticks_share']:.2f}% over 1.5 ticks",
        f"Harness itself: CPU {report.harness_cpu_pct:.0f}% of one core "
        "(it shares the machine with the server when run in the container)",
        "",
        *report.verdict,
    ]
    return "\n".join(out)


def parse_args(argv: list[str] | None) -> tuple[Options, Path | None]:
    parser = argparse.ArgumentParser(prog="python -m gow_server.loadtest", description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--matches", type=int, default=30)
    parser.add_argument("--duration", type=float, default=180.0, help="measured seconds")
    parser.add_argument("--ramp-s", type=float, default=10.0, help="spread of the match starts")
    parser.add_argument("--map", dest="map_id", help="map id (default: the first of /api/maps)")
    parser.add_argument("--sample-s", type=float, default=10.0)
    parser.add_argument("--no-server-metrics", action="store_true")
    parser.add_argument("--pid", type=int, help="server pid for CPU and memory (default: /proc)")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--json", type=Path, help="also write the report here as JSON")
    args = parser.parse_args(argv)
    return (
        Options(
            args.base_url,
            args.matches,
            args.duration,
            args.ramp_s,
            args.map_id,
            args.sample_s,
            not args.no_server_metrics,
            args.pid,
            args.seed,
        ),
        args.json,
    )


def main(argv: list[str] | None = None) -> int:
    opts, json_path = parse_args(argv)
    report = asyncio.run(run(opts))
    judge_lag(report)
    print(format_report(report))
    if json_path is not None:
        json_path.write_text(json.dumps(asdict(report), indent=2, default=str) + "\n")
    return 0 if report.passed else 1


if __name__ == "__main__":
    sys.exit(main())
