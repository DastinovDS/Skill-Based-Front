"""How big is a ``snapshot`` on the pool maps (#482, ARP-08, ``docs/perf.md``).

    mise exec -- uv run python scripts/snapshot_size.py [--ticks 9000] [MAP.json ...]

Plays a seeded match of two smart bots (``smart_rusher`` against ``smart_expander``, ``mvp-7``,
map tempo on) on each map (default: the pool, ``maps/*.json``) and encodes, for each player and
every tick, the frame the server sends (``gow_protocol.convert.snapshot_frame``). Prints per map
(markdown): the raw size in bytes (mean, p95, max), the size after permessage-deflate as the
server negotiates it, and the bandwidth per player at 10 snapshots a second.

The deflate figures follow ``uvicorn``'s ``websockets-sansio`` implementation, which the server
runs (``ws_per_message_deflate`` is on by default): ``ServerPerMessageDeflateFactory`` with a
12-bit window and ``memLevel`` 5, one compressor per connection that keeps its window between
messages (context takeover is not turned off), every message ended with ``Z_SYNC_FLUSH`` and its
trailing ``00 00 ff ff`` cut (RFC 7692). "Streaming" is that; "one-shot" compresses each frame
alone (the number a fresh connection's first frame costs, and what a context-less transport
would pay). The wire adds a 2 to 4 byte WebSocket header and, from the server to the browser,
no mask.
"""

import argparse
import json
import statistics
import sys
import time
import zlib
from pathlib import Path
from typing import cast

from gow_bots.bots import BOTS
from gow_protocol.convert import snapshot_frame
from gow_sim.commands import PlayerCommand
from gow_sim.maps import PLAYERS, MapDef, load_map
from gow_sim.match import Match
from gow_sim.ruleset import load_ruleset

ROOT = Path(__file__).resolve().parents[1]
KEY = bytes(range(32))
BOT_NAMES = ("smart_rusher", "smart_expander")
TICK_HZ = 10
WBITS = 12
MEM_LEVEL = 5
SYNC_TAIL = b"\x00\x00\xff\xff"
SECTION_EVERY = 100
"""Every this many ticks the frame is also parsed, to count its parts."""


class Deflate:
    """One direction of a permessage-deflate connection as ``websockets`` runs it."""

    def __init__(self) -> None:
        self.z = zlib.compressobj(wbits=-WBITS, memLevel=MEM_LEVEL)

    def message(self, data: bytes) -> int:
        out = self.z.compress(data) + self.z.flush(zlib.Z_SYNC_FLUSH)
        assert out.endswith(SYNC_TAIL)
        return len(out) - len(SYNC_TAIL)


def one_shot(data: bytes) -> int:
    z = zlib.compressobj(wbits=-WBITS, memLevel=MEM_LEVEL)
    return len(z.compress(data) + z.flush(zlib.Z_SYNC_FLUSH)) - len(SYNC_TAIL)


def _pct(data: list[int], q: int) -> int:
    ordered = sorted(data)
    return ordered[min(len(ordered) - 1, len(ordered) * q // 100)]


class Sizes:
    """The sizes of the frames of one map, all players together."""

    def __init__(self) -> None:
        self.raw: list[int] = []
        self.streaming: list[int] = []
        self.once: list[int] = []
        self.parts: dict[str, list[int]] = {}
        self.nulls: list[int] = []
        self.deflate_s: list[float] = []
        """Seconds the streaming compressor took per frame."""


def measure(mapdef: MapDef, ticks: int) -> tuple[Sizes, int]:
    """Play ``ticks`` ticks (or to the end) and measure every frame; returns the sizes and the
    number of ticks played."""
    source = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")
    match = Match(mapdef, source, KEY)
    bots = [BOTS[n](mapdef, match.rules, seed=7, player=p) for p, n in enumerate(BOT_NAMES)]
    wires = [Deflate() for _ in PLAYERS]
    sizes = Sizes()
    seq = 0
    while match.tick < ticks and not match.finished:
        cmds: list[PlayerCommand] = []
        if match.tick % 5 == 0:
            for p in PLAYERS:
                for cmd in bots[p].decide(match.view(p, reuse=True), match.tick):
                    cmds.append(PlayerCommand(p, seq, match.resolve(p, cmd)))
                    seq += 1
        match.step(cmds)
        for p in PLAYERS:
            frame = snapshot_frame(match.view(p, reuse=True)).frame
            data = frame.encode()
            sizes.raw.append(len(data))
            t0 = time.perf_counter()
            sizes.streaming.append(wires[p].message(data))
            sizes.deflate_s.append(time.perf_counter() - t0)
            sizes.once.append(one_shot(data))
            if match.tick % SECTION_EVERY == 0:
                _parts(json.loads(frame), sizes)
                sizes.nulls.append(frame.count("null"))
    return sizes, match.tick


def _parts(message: dict[str, object], sizes: Sizes) -> None:
    view = cast(dict[str, object], message["view"])
    for key, value in view.items():
        size = len(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
        sizes.parts.setdefault(key, []).append(size)


def _kb(n: float) -> str:
    return f"{n / 1000:.1f}"


def report(name: str, mapdef: MapDef, sizes: Sizes, ticks: int) -> str:
    raw, stream, once = sizes.raw, sizes.streaming, sizes.once
    lines = [
        f"### {name} ({len(mapdef.nodes)} nodes, {len(mapdef.edges)} roads), "
        f"{ticks} ticks, {len(raw)} frames",
        "",
        "| | mean | p95 | max | per player per second (mean x 10) |",
        "|---|---|---|---|---|",
    ]
    for label, data in (
        ("raw JSON (bytes)", raw),
        ("deflate, streaming (bytes)", stream),
        ("deflate, one-shot (bytes)", once),
    ):
        mean = statistics.fmean(data)
        lines.append(
            f"| {label} | {mean:.0f} | {_pct(data, 95)} | {max(data)} | "
            f"{_kb(mean * TICK_HZ)} KB/s |"
        )
    parts = ", ".join(
        f"{k} {_kb(statistics.fmean(v))} KB"
        for k, v in sorted(sizes.parts.items(), key=lambda kv: -statistics.fmean(kv[1]))
        if statistics.fmean(v) >= 500
    )
    lines += [
        "",
        f"Raw parts (mean, every {SECTION_EVERY} ticks): {parts}; "
        f"`null` values per frame: {statistics.fmean(sizes.nulls):.0f}. "
        f"Streaming deflate is {statistics.fmean(stream) / statistics.fmean(raw):.1%} of raw and "
        f"costs {statistics.fmean(sizes.deflate_s) * 1000:.2f} ms of CPU per frame (this machine).",
        "",
    ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="snapshot_size", description=__doc__)
    parser.add_argument("maps", nargs="*", type=Path, help="map files (default: maps/*.json)")
    parser.add_argument("--ticks", type=int, default=9000, help="ticks to play (default: 9000)")
    args = parser.parse_args(argv)
    files: list[Path] = args.maps or sorted((ROOT / "maps").glob("*.json"))
    for path in files:
        mapdef = load_map(path)
        sizes, played = measure(mapdef, args.ticks)
        print(report(path.stem, mapdef, sizes, played))
    return 0


if __name__ == "__main__":
    sys.exit(main())
