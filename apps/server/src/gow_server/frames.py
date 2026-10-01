"""The frames file of a replay (SRV-07): the full state of a finished match, for the viewer.

After a match the server re-simulates its command log (``build_frames``, in a worker process:
``replays.ReplayService``), checks every checkpoint hash and writes ``{id}.frames.json.gz``:
the whole state twice a second plus every event. The viewer needs no simulation, and the file
stays readable when ``SIM_VERSION`` or the rules move on. The format is in
``docs/design/replay-frames.md``; ``FORMAT`` is its version.

This is a full-reveal view: nothing is hidden by the fog (AGENTS.md, section 4.4 is about live
views). Replays are published only after the match.
"""

import gzip
import json
import os
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from gow_sim.commands import PlayerCommand
from gow_sim.maps import PLAYERS, map_hash, map_to_data
from gow_sim.match import SIM_VERSION, Match
from gow_sim.replay import DEFAULT_MAPS_DIR, DEFAULT_RULESETS_DIR, replay_run
from gow_sim.ruleset import ruleset_hash
from gow_sim.state import AtNode, GameState, Group, OnEdge

__all__ = [
    "FORMAT",
    "FRAMES_PER_SECOND",
    "FramesError",
    "FramesRecorder",
    "FramesResult",
    "build_frames",
    "frame_of",
]

FORMAT: Final = 1
"""Version of the frames file format; the viewer checks it."""

FRAMES_PER_SECOND: Final = 2
"""Full-state frames per second of the match (the issue: "2 раза в секунду")."""


class FramesError(ValueError):
    """The log cannot be turned into a frames file: it diverged, or it is not a finished match."""


def _group(g: Group) -> dict[str, object]:
    out: dict[str, object] = {
        "id": g.id,
        "o": g.owner,
        "u": g.units,
        "c": g.charged,
        "m": g.mode.value,
    }
    match g.location:
        case AtNode(node=node):
            out["at"] = node
        case OnEdge(edge=edge, from_node=from_node, progress=progress, back=back):
            out["on"] = [edge, from_node, progress, int(back)]
    if g.order is not None:
        out["to"] = list(g.order.path)
        if g.order.planned:
            out["pl"] = 1
    if g.build_edge is not None:
        out["b"] = g.build_edge
    return out


def frame_of(state: GameState) -> dict[str, object]:
    """The full state at ``state.tick`` as one frame (``docs/design/replay-frames.md``)."""
    return {
        "t": state.tick,
        "p": [
            [p.cp, p.vp, p.stance.value, int(p.forfeited)]
            for p in (state.players[i] for i in sorted(state.players))
        ],
        "n": [[n.owner, n.warehouse] for n in (state.nodes[i] for i in sorted(state.nodes))],
        "w": [state.edges[i].width for i in sorted(state.edges)],
        "g": [_group(state.groups[i]) for i in sorted(state.groups)],
        "k": [
            [p.id, p.owner, p.edge, p.from_node, p.charges, p.depart_tick, p.arrive_tick]
            for p in (state.packets[i] for i in sorted(state.packets))
        ],
        "i": [
            [i.id, i.owner, i.kind.value, i.origin, i.target]
            for i in (state.intents[k] for k in sorted(state.intents))
        ],
    }


class FramesRecorder:
    """A ``MatchObserver`` that collects the frames and the events of a match."""

    def __init__(self) -> None:
        self.frames: list[dict[str, object]] = []
        self.events: list[list[object]] = []
        self.match: Match | None = None
        self.frame_every = 1

    def begin(self, match: Match) -> None:
        self.match = match
        self.frame_every = max(match.rules.tick_hz // FRAMES_PER_SECOND, 1)
        self.frames.append(frame_of(match.state))

    def record(self, match: Match, commands: Sequence[PlayerCommand]) -> None:
        state = match.state
        self.events.extend([e.tick, e.kind, dict(e.data)] for e in state.events)
        if state.tick % self.frame_every == 0 or match.finished:
            self.frames.append(frame_of(state))


@dataclass(frozen=True, slots=True)
class FramesResult:
    path: Path
    ticks: int
    frames: int
    size: int
    """Bytes of the gzip file."""
    state_hash: str
    """``state_hash`` of the final state; equals the one of the live match."""
    winner: int | None
    reason: str


def build_frames(
    log_path: str | Path,
    out_path: str | Path,
    rulesets_dir: str | Path = DEFAULT_RULESETS_DIR,
    maps_dir: str | Path = DEFAULT_MAPS_DIR,
) -> FramesResult:
    """Re-simulate the command log, check its hashes and write the frames file ``out_path``.

    One pass: the hashes are compared at every checkpoint of the log while the frames are
    recorded. A top-level function with plain arguments, so a ``ProcessPoolExecutor`` can run it
    (AGENTS.md, section 4.5). Raises ``FramesError`` for a divergence or a log of a match that
    did not finish, ``ReplayError`` (``ReplayVersionError``) for a log this code cannot read.
    The file is written whole or not at all.
    """
    log_path, out_path = Path(log_path), Path(out_path)
    recorder = FramesRecorder()
    check = replay_run(log_path, rulesets_dir, maps_dir, observer=recorder)
    if check.divergence is not None:
        d = check.divergence
        raise FramesError(
            f"{log_path}: state diverged at tick {d.tick}: {d.expected} != {d.actual}"
        )
    match = recorder.match
    if match is None or match.outcome is None:
        raise FramesError(f"{log_path}: the log ends before the match did (no outcome)")
    state = match.state
    final_hash = match.state_hash()
    document: dict[str, object] = {
        "format": FORMAT,
        "sim_version": SIM_VERSION,
        "ruleset_hash": ruleset_hash(match.rules),
        "map_id": state.map.meta.name,
        "map_hash": map_hash(state.map),
        "tick_hz": match.rules.tick_hz,
        "frame_every": recorder.frame_every,
        "ticks": state.tick,
        "outcome": {"winner": match.outcome.winner, "reason": match.outcome.reason.value},
        "vp": [state.players[p].vp for p in PLAYERS],
        "state_hash": final_hash,
        "map": map_to_data(state.map),
        "frames": recorder.frames,
        "events": recorder.events,
    }
    data = json.dumps(document, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_name(out_path.name + ".tmp")
    with tmp.open("wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as gz:
        gz.write(data)
    os.replace(tmp, out_path)
    return FramesResult(
        out_path,
        state.tick,
        len(recorder.frames),
        out_path.stat().st_size,
        final_hash,
        match.outcome.winner,
        match.outcome.reason.value,
    )
