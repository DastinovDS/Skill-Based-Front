"""The frames file of a replay (SRV-07): the full state of a finished match, for the viewer.

After a match the server re-simulates its command log (``build_frames``, in a worker process:
``replays.ReplayService``), checks every checkpoint hash and writes ``{id}.frames.json.gz``:
the whole state twice a second plus every event. The viewer needs no simulation, and the file
stays readable when ``SIM_VERSION`` or the rules move on. The format is in
``docs/design/replay-frames.md``; ``FORMAT`` is its version.

The frame state is a full-reveal view: nothing is hidden by the fog (AGENTS.md, section 4.4 is
about live views). Replays are published only after the match. Next to it every frame carries
what each player saw (``v``, #598): the vision part of ``gow_sim.view.project()`` for that player
and tick, so the viewer can show one side's fog of war without computing vision itself
(AGENTS.md, section 7.1).
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
from gow_sim.ruleset import Ruleset, ruleset_hash
from gow_sim.state import AtNode, Detail, Fight, FightRound, GameState, Group, OnEdge, Sighting
from gow_sim.systems.build import done_tick
from gow_sim.systems.capacity import node_capacities, warehouse_capacity
from gow_sim.systems.supply import is_city
from gow_sim.view import EnemyGroupView, HalfView, PlayerView

__all__ = [
    "FORMAT",
    "FRAMES_PER_SECOND",
    "FramesError",
    "FramesRecorder",
    "FramesResult",
    "build_frames",
    "frame_of",
    "vision_of",
]

FORMAT: Final = 1
"""Version of the frames file format; the viewer checks it."""

FRAMES_PER_SECOND: Final = 2
"""Full-state frames per second of the match (the issue: "2 times per second")."""


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
    return out


def _pair(pair: tuple[int, int]) -> list[int]:
    return [pair[0], pair[1]]


def _round(r: FightRound | None) -> list[object] | None:
    """The last round of a fight: ``[tick, shots, virtual, spent, losses]``, pairs by player."""
    if r is None:
        return None
    return [r.tick, _pair(r.shots), _pair(r.virtual), _pair(r.spent), _pair(r.losses)]


def _fight(f: Fight) -> list[object]:
    """A fight (DEC-24) with its round data (#323): the full-reveal view shows both sides, so the
    totals, the virtual shots left (DEC-32) and the last round are written as the simulation
    holds them, by player."""
    return [
        f.id,
        f.node,
        f.edge,
        f.point,
        f.attacker,
        f.start,
        f.next_round,
        sorted(f.members),
        [_pair(f.shots), _pair(f.losses), _pair(f.virtual), _round(f.last_round)],
    ]


def frame_of(state: GameState, rules: Ruleset) -> dict[str, object]:
    """The full state at ``state.tick`` as one frame (``docs/design/replay-frames.md``)."""
    capacities = node_capacities(state, rules)
    frame: dict[str, object] = {
        "t": state.tick,
        "p": [
            [p.cp, p.vp, p.stance.value, int(p.forfeited)]
            for p in (state.players[i] for i in sorted(state.players))
        ],
        "n": [
            [
                n.owner,
                n.warehouse,
                capacities[n.id],
                # Places of the warehouse (DEC-26) as `NodeView.warehouse_cap`; none in a province.
                (warehouse_capacity(state, rules, n.id) if is_city(state.map, n.id) else None),
            ]
            for n in (state.nodes[i] for i in sorted(state.nodes))
        ],
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
    builds = [
        [eid, b.owner, done_tick(rules, b)]
        for eid, b in ((i, state.edges[i].build) for i in sorted(state.edges))
        if b is not None  # road builds (DEC-28); the barracks and the warehouse are not drawn
    ]
    if builds:  # only while a road is built: older files without the key stay valid
        frame["e"] = builds
    # No ``b`` (road builds by cities) since DEC-28: files from before still carry it.
    # No ``r`` (road types) since DEC-26: roads have no type; files from before still carry it.
    fights = [_fight(state.fights[i]) for i in sorted(state.fights)]
    if fights:  # DEC-24, only while a fight goes on: older files without the key stay valid
        frame["f"] = fights
    return frame


def _trimmed(record: list[object]) -> list[object]:
    """``record`` without its trailing ``None`` elements: the reader takes a missing one as
    ``null``."""
    end = len(record)
    while end and record[end - 1] is None:
        end -= 1
    return record[:end]


def _sighting(s: Sighting | None, detail: Detail, tick: int) -> list[object] | None:
    """A ``Sighting`` as ``[level, modes, units, charged, range, tick]``, trailing ``None`` left
    out. A place not in fog is seen in this very tick (``project()``: this tick's sighting), so its
    ``tick`` is the frame's and is left out too; only a remembered sighting (``FOG``) has it."""
    if s is None:
        return None
    remembered = detail is Detail.FOG
    if not remembered and s.tick != tick:
        raise ValueError(f"a sighting of tick {s.tick} at tick {tick} outside the fog")
    return _trimmed(
        [
            s.level.value,
            [m.value for m in s.enemy_modes],
            s.enemy_units,
            s.enemy_charged,
            None if s.enemy_range is None else list(s.enemy_range),
            s.tick if remembered else None,
        ]
    )


def _half(h: HalfView, tick: int) -> list[object]:
    return _trimmed([h.detail.value, _sighting(h.seen, h.detail, tick)])


def _figure(f: EnemyGroupView) -> list[object]:
    """An enemy figure on an edge (DEC-33). The opaque id is a decimal string, as on the wire:
    63 bits do not fit a JavaScript number."""
    return _trimmed(
        [
            str(f.id),
            f.pos,
            int(f.toward_b),
            f.detail.value,
            f.mode.value,
            f.units,
            f.charged,
            None if f.units_range is None else list(f.units_range),
        ]
    )


def vision_of(view: PlayerView) -> dict[str, object]:
    """What ``view.player`` saw at ``view.tick``: the fog part of ``project()`` (#598).

    Everything here is copied from the ``PlayerView``; nothing is computed again. The layout is in
    ``docs/design/replay-frames.md`` ("Vision").
    """
    t = view.tick
    out: dict[str, object] = {
        "n": [
            _trimmed([n.detail.value, _sighting(n.seen, n.detail, t), n.warehouse])
            for n in view.nodes
        ],
        "e": [
            [e.width, e.detail.value, _half(e.halves[0], t), _half(e.halves[1], t)]
            + ([[_figure(f) for f in e.enemy_groups]] if e.enemy_groups else [])
            for e in view.edges
        ],
    }
    builds = [e.id for e in view.edges if e.build is not None]
    if builds:  # only while the player sees a road build
        out["b"] = builds
    return out


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
        self.frames.append(self._frame(match))

    def record(self, match: Match, commands: Sequence[PlayerCommand]) -> None:
        state = match.state
        self.events.extend([e.tick, e.kind, dict(e.data)] for e in state.events)
        if state.tick % self.frame_every == 0 or match.finished:
            self.frames.append(self._frame(match))

    @staticmethod
    def _frame(match: Match) -> dict[str, object]:
        """The frame and, under ``v``, each player's ``project()`` of the same state (#598): the
        snapshot that player had at this tick in the live match."""
        frame = frame_of(match.state, match.rules)
        frame["v"] = [vision_of(match.view(p)) for p in PLAYERS]
        return frame


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
    nicks: Sequence[str] | None = None,
) -> FramesResult:
    """Re-simulate the command log, check its hashes and write the frames file ``out_path``.

    ``nicks``: the nicks of the players by player id as the match had them, written to the
    header (#598); ``None``: no ``nicks`` key (a match without a database row).

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
    }
    if nicks is not None:
        document["nicks"] = list(nicks)
    document |= {
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
