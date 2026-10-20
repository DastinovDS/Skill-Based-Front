"""Replays (SIM-16): the command log of a match, its check and the dump of a divergence.

A replay is a ``.jsonl.gz`` file (stdlib ``gzip``), one JSON value per line (AGENTS.md, 4.5)::

    {"sim_version":1,"ruleset_hash":"..","python_version":"3.12.1","map_id":"arteriya",
     "map_hash":"..","match_key":"<hex>"}                      header, the first line
    {"tick":0,"hash":".."}                                     checkpoint: state_hash after tick
    [1,0,0,{"type":"move","group":3,"dest":5,"planned":false}] command: [tick, player, seq, cmd]
    {"tick":50,"hash":".."}                                    a checkpoint every 50 ticks
    {"tick":7200,"hash":"..","final":true}                     the last tick played

A command of tick ``t`` is what ``Match.step()`` of tick ``t`` got: ids are internal (after
``resolve()``), rejected commands included, so a replay reproduces the match exactly. A log cut
short (no ``final`` record) is checked up to its last checkpoint.

The ruleset comes from ``rulesets/archive/<ruleset_hash>.toml`` (``ruleset.archive_ruleset``),
the map from ``<map_id>.json`` in the ``maps/`` folder next to the replay or in the map folder;
both must match the hashes of the header.

On a divergence the check writes to ``<dump_dir>/<replay name>/`` the canonical state of the last
matching checkpoint, the state that diverged and ``divergence.json``. The recorded state itself
is not in the log, only its hash: load the matching state with ``state.from_canonical`` and step
the commands with both versions of the code to find the first differing tick.

File I/O is allowed in this module (AGENTS.md, section 4.1, rule 1).
"""

import argparse
import gzip
import json
import platform
import sys
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path
from types import TracebackType
from typing import IO, Final, Self

from gow_sim.analysis import MatchMetrics, MatchRecorder, analyze
from gow_sim.canonical import digest
from gow_sim.commands import (
    BuildBarracks,
    CancelOrder,
    CancelRecruit,
    Command,
    Forfeit,
    Merge,
    Move,
    PlayerCommand,
    Recruit,
    SetFront,
    SetMode,
    SetRearMin,
    SetStance,
    Split,
    Transfer,
    UpgradeRoad,
    UpgradeWarehouse,
)
from gow_sim.maps import MapDef, MapFormatError, load_map, map_hash
from gow_sim.match import (
    HEADLESS_MATCH_KEY,
    SIM_VERSION,
    Controller,
    Match,
    MatchObserver,
    MatchResult,
    run_headless,
)
from gow_sim.ruleset import Ruleset, RulesetError, Stance, load_ruleset, ruleset_hash
from gow_sim.state import Mode, to_canonical

__all__ = [
    "CHECKPOINT_EVERY",
    "DEFAULT_MAPS_DIR",
    "DEFAULT_RULESETS_DIR",
    "REPLAY_SUFFIX",
    "Checkpoint",
    "Divergence",
    "Replay",
    "ReplayCheck",
    "ReplayError",
    "ReplayHeader",
    "ReplayVersionError",
    "ReplayWriter",
    "analyze_replay",
    "decode_command",
    "encode_command",
    "main",
    "read_replay",
    "record_headless",
    "replay_match",
    "replay_run",
]

CHECKPOINT_EVERY: Final = 50
"""A checkpoint hash every this many ticks (and at tick 0 and the last tick)."""

REPLAY_SUFFIX: Final = ".jsonl.gz"
DEFAULT_RULESETS_DIR: Final = Path("rulesets/archive")
DEFAULT_MAPS_DIR: Final = Path("maps")


class ReplayError(ValueError):
    """A malformed replay, or its ruleset or map cannot be found."""


class ReplayVersionError(ReplayError):
    """The replay was recorded by another ``SIM_VERSION``; this code cannot check it."""


@dataclass(frozen=True, slots=True)
class ReplayHeader:
    sim_version: int
    ruleset_hash: str
    python_version: str
    map_id: str
    """``MapMeta.name``."""
    map_hash: str
    match_key: bytes
    """Hex in the file: the secret of the opaque ids, needed to re-project views."""


@dataclass(frozen=True, slots=True)
class Checkpoint:
    tick: int
    hash: str
    """``state_hash`` after ``tick``."""


@dataclass(frozen=True, slots=True)
class Replay:
    header: ReplayHeader
    commands: tuple[tuple[int, PlayerCommand], ...]
    """``(tick, command)`` in file order."""
    checkpoints: tuple[Checkpoint, ...]
    """Ascending ticks; the last one is ``final`` when the log is complete."""
    final: bool
    """``True`` when the log ends with the ``final`` record of the last tick."""


# Commands -----------------------------------------------------------------------------------


def encode_command(cmd: Command) -> dict[str, object]:
    """``cmd`` as JSON data: ``{"type": <snake_case name>, <fields>}``."""
    match cmd:
        case Move(group=g, dest=dest, planned=planned):
            return {"type": "move", "group": g, "dest": dest, "planned": planned}
        case Split(group=g, n=n):
            return {"type": "split", "group": g, "n": n}
        case Merge(groups=groups):
            return {"type": "merge", "groups": list(groups)}
        case SetMode(group=g, mode=mode):
            return {"type": "set_mode", "group": g, "mode": mode.value}
        case SetStance(stance=stance):
            return {"type": "set_stance", "stance": stance.value}
        case UpgradeRoad(node=node, edge=edge, kind=kind):
            return {"type": "upgrade_road", "node": node, "edge": edge, "kind": kind}
        case BuildBarracks(node=node):
            return {"type": "build_barracks", "node": node}
        case UpgradeWarehouse(node=node):
            return {"type": "upgrade_warehouse", "node": node}
        case Recruit(node=node):
            return {"type": "recruit", "node": node}
        case CancelRecruit(node=node):
            return {"type": "cancel_recruit", "node": node}
        case CancelOrder(group=g):
            return {"type": "cancel_order", "group": g}
        case SetFront(marker=marker, node=node):
            return {"type": "set_front", "marker": marker, "node": node}
        case SetRearMin(n=n):
            return {"type": "set_rear_min", "n": n}
        case Transfer(src=src, dst=dst, n=n):
            return {"type": "transfer", "from": src, "to": dst, "n": n}
        case Forfeit():
            return {"type": "forfeit"}


def decode_command(data: object) -> Command:
    """The inverse of ``encode_command``. Raises ``ReplayError`` on malformed data."""
    if not isinstance(data, dict):
        raise ReplayError(f"command: expected an object, got {data!r}")
    d: dict[str, object] = data  # pyright: ignore[reportUnknownVariableType]
    kind = d.get("type")
    try:
        match kind:
            case "move":
                return Move(_int(d["group"]), _int(d["dest"]), _bool(d["planned"]))
            case "split":
                return Split(_int(d["group"]), _int(d["n"]))
            case "merge":
                groups = d["groups"]
                if not isinstance(groups, list):
                    raise ReplayError("merge: groups must be a list")
                items: list[object] = groups  # pyright: ignore[reportUnknownVariableType]
                return Merge(tuple(_int(g) for g in items))
            case "set_mode":
                return SetMode(_int(d["group"]), Mode(_str(d["mode"])))
            case "set_stance":
                return SetStance(Stance(_str(d["stance"])))
            case "upgrade_road":
                road = d["kind"]
                return UpgradeRoad(
                    _int(d["node"]), _int(d["edge"]), None if road is None else _str(road)
                )
            case "build_barracks":
                return BuildBarracks(_int(d["node"]))
            case "upgrade_warehouse":
                return UpgradeWarehouse(_int(d["node"]))
            case "recruit":
                return Recruit(_int(d["node"]))
            case "cancel_recruit":
                return CancelRecruit(_int(d["node"]))
            case "cancel_order":
                return CancelOrder(_int(d["group"]))
            case "set_front":
                node = d["node"]
                return SetFront(_int(d["marker"]), None if node is None else _int(node))
            case "set_rear_min":
                return SetRearMin(_int(d["n"]))
            case "transfer":
                return Transfer(_int(d["from"]), _int(d["to"]), _int(d["n"]))
            case "forfeit":
                return Forfeit()
            case _:
                raise ReplayError(f"command: unknown type {kind!r}")
    except KeyError as exc:
        raise ReplayError(f"command {kind}: missing field {exc}") from exc
    except ValueError as exc:  # a bad enum value; ReplayError is a ValueError too
        raise ReplayError(f"command {kind}: {exc}") from exc


def _int(value: object) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ReplayError(f"expected an integer, got {value!r}")
    return value


def _bool(value: object) -> bool:
    if not isinstance(value, bool):
        raise ReplayError(f"expected a boolean, got {value!r}")
    return value


def _str(value: object) -> str:
    if not isinstance(value, str):
        raise ReplayError(f"expected a string, got {value!r}")
    return value


# Writing ------------------------------------------------------------------------------------


def _line(value: object) -> bytes:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=True).encode("ascii") + b"\n"


class ReplayWriter:
    """Records a match into a replay file; a ``MatchObserver`` for ``run_headless``.

    ``begin(match)`` at tick 0 writes the header and the first checkpoint, ``record(match,
    commands)`` after every ``step(commands)``, ``close()`` the ``final`` record of the last tick.
    Leaving the ``with`` block by an exception closes the file without the ``final`` record
    (``abort()`` does the same). The gzip header has no name and ``mtime=0``: the same match gives
    the same bytes. With ``flush_at_checkpoints`` the data written so far reaches the file at
    every checkpoint (a sync flush, which makes the gzip a little bigger): after a crash of a live
    server the file lacks only the ticks since the last checkpoint. Its gzip stream has no end, so
    ``read_replay`` refuses it; ``zlib.decompressobj(31)`` reads what is there.
    """

    def __init__(self, path: str | Path, *, flush_at_checkpoints: bool = False) -> None:
        self.path: Final = Path(path)
        self._flush: Final = flush_at_checkpoints
        self._raw: IO[bytes] | None = None
        self._gz: gzip.GzipFile | None = None
        self._match: Match | None = None

    def begin(self, match: Match) -> None:
        if self._gz is not None:
            raise RuntimeError("the replay has already begun")
        if match.tick != 0:
            raise ValueError(f"a replay begins at tick 0, the match is at tick {match.tick}")
        mapdef = match.state.map
        header = {
            "sim_version": SIM_VERSION,
            "ruleset_hash": ruleset_hash(match.rules),
            "python_version": platform.python_version(),
            "map_id": mapdef.meta.name,
            "map_hash": map_hash(mapdef),
            "match_key": match.match_key.hex(),
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._raw = self.path.open("wb")
        self._gz = gzip.GzipFile(filename="", mode="wb", fileobj=self._raw, mtime=0)
        self._gz.write(_line(header))
        self._match = match
        self._checkpoint(match)

    def record(self, match: Match, commands: Sequence[PlayerCommand]) -> None:
        gz = self._require(match)
        tick = match.tick
        for c in commands:
            gz.write(_line([tick, c.player, c.seq, encode_command(c.cmd)]))
        if tick % CHECKPOINT_EVERY == 0:
            self._checkpoint(match)

    def close(self) -> None:
        """Write the ``final`` record and close the file; a second call does nothing."""
        if self._gz is None or self._match is None:
            return
        match = self._match
        self._gz.write(_line({"tick": match.tick, "hash": match.state_hash(), "final": True}))
        self._shut()

    def abort(self) -> None:
        """Close the file without the ``final`` record (the match did not reach its end)."""
        self._shut()

    def _require(self, match: Match) -> gzip.GzipFile:
        if self._gz is None or self._match is not match:
            raise RuntimeError("record() before begin() or with another match")
        return self._gz

    def _checkpoint(self, match: Match) -> None:
        assert self._gz is not None
        self._gz.write(_line({"tick": match.tick, "hash": match.state_hash()}))
        if self._flush:
            self._gz.flush()

    def _shut(self) -> None:
        if self._gz is not None:
            self._gz.close()
        if self._raw is not None:
            self._raw.close()
        self._gz = self._raw = self._match = None

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if exc_type is None:
            self.close()
        else:
            self._shut()


def record_headless(
    path: str | Path,
    mapdef: MapDef,
    rules: Ruleset,
    controllers: Sequence[Controller],
    max_ticks: int | None = None,
    decide_every: int = 5,
    match_key: bytes = HEADLESS_MATCH_KEY,
) -> MatchResult:
    """``run_headless`` that records the match into the replay file ``path``."""
    with ReplayWriter(path) as writer:
        return run_headless(
            mapdef, rules, controllers, max_ticks, decide_every, match_key, observer=writer
        )


# Reading ------------------------------------------------------------------------------------


def read_replay(path: str | Path) -> Replay:
    """Parse a replay file. Raises ``ReplayError`` naming the file and the line."""
    path = Path(path)
    try:
        with gzip.open(path, "rb") as f:
            lines = f.read().splitlines()
    except (OSError, EOFError) as exc:  # gzip.BadGzipFile is an OSError
        raise ReplayError(f"{path}: {exc}") from exc
    if not lines:
        raise ReplayError(f"{path}: empty replay")
    try:
        return _parse(lines)
    except ReplayError as exc:
        raise ReplayError(f"{path}: {exc}") from exc


def _read_current(path: Path) -> Replay:
    """``read_replay`` of a replay of this ``SIM_VERSION``; another version raises
    ``ReplayVersionError`` before its commands are parsed (their format may have changed)."""
    try:
        with gzip.open(path, "rb") as f:
            first = f.readline()
    except (OSError, EOFError) as exc:
        raise ReplayError(f"{path}: {exc}") from exc
    if not first:
        raise ReplayError(f"{path}: empty replay")
    try:
        version = _parse_header(_json(first.rstrip(b"\n"), 1)).sim_version
    except ReplayError as exc:
        raise ReplayError(f"{path}: {exc}") from exc
    if version != SIM_VERSION:
        raise ReplayVersionError(f"{path}: sim_version {version}, this code is {SIM_VERSION}")
    return read_replay(path)


def _parse(lines: list[bytes]) -> Replay:
    header = _parse_header(_json(lines[0], 1))
    commands: list[tuple[int, PlayerCommand]] = []
    checkpoints: list[Checkpoint] = []
    final = False
    for number, raw in enumerate(lines[1:], start=2):
        if final:
            raise ReplayError(f"line {number}: data after the final record")
        value = _json(raw, number)
        try:
            if isinstance(value, list):
                commands.append(_parse_command(value))  # pyright: ignore[reportUnknownArgumentType]
            elif isinstance(value, dict):
                record: dict[str, object] = value  # pyright: ignore[reportUnknownVariableType]
                checkpoint = Checkpoint(_int(record.get("tick")), _str(record.get("hash")))
                final = record.get("final") is True
                last = checkpoints[-1].tick if checkpoints else -1
                # The final record may repeat the checkpoint of its tick.
                if checkpoint.tick < last or (checkpoint.tick == last and not final):
                    raise ReplayError("checkpoint ticks must grow")
                checkpoints.append(checkpoint)
            else:
                raise ReplayError(f"unexpected record {value!r}")
        except ReplayError as exc:
            raise ReplayError(f"line {number}: {exc}") from exc
    if not checkpoints:
        raise ReplayError("no checkpoints")
    return Replay(header, tuple(commands), tuple(checkpoints), final)


def _json(raw: bytes, number: int) -> object:
    try:
        return json.loads(raw)
    except ValueError as exc:
        raise ReplayError(f"line {number}: invalid JSON: {exc}") from exc


def _parse_header(value: object) -> ReplayHeader:
    if not isinstance(value, dict):
        raise ReplayError("line 1: the header must be an object")
    h: dict[str, object] = value  # pyright: ignore[reportUnknownVariableType]
    try:
        return ReplayHeader(
            sim_version=_int(h.get("sim_version")),
            ruleset_hash=_str(h.get("ruleset_hash")),
            python_version=_str(h.get("python_version")),
            map_id=_str(h.get("map_id")),
            map_hash=_str(h.get("map_hash")),
            match_key=bytes.fromhex(_str(h.get("match_key"))),
        )
    except ValueError as exc:
        raise ReplayError(f"line 1: bad header: {exc}") from exc


def _parse_command(items: list[object]) -> tuple[int, PlayerCommand]:
    if len(items) != 4:
        raise ReplayError("a command record is [tick, player, seq, cmd]")
    tick, player, seq, cmd = items
    return _int(tick), PlayerCommand(_int(player), _int(seq), decode_command(cmd))


# Checking -----------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Divergence:
    tick: int
    expected: str
    actual: str
    """``state_hash`` computed now; ``"match ended at tick N"`` if the match ended earlier."""
    dump: Path | None
    """Folder with the dumped states, ``None`` when no ``dump_dir`` was given."""


@dataclass(frozen=True, slots=True)
class ReplayCheck:
    path: Path
    checkpoints: int
    """Checkpoints that matched."""
    ticks: int
    """Last tick simulated."""
    divergence: Divergence | None

    @property
    def ok(self) -> bool:
        return self.divergence is None


def replay_run(
    path: str | Path,
    rulesets_dir: str | Path = DEFAULT_RULESETS_DIR,
    maps_dir: str | Path = DEFAULT_MAPS_DIR,
    dump_dir: str | Path | None = None,
    observer: MatchObserver | None = None,
) -> ReplayCheck:
    """Re-simulate a replay and compare every checkpoint hash; stop at the first divergence.

    Raises ``ReplayVersionError`` for another ``SIM_VERSION`` and ``ReplayError`` for a malformed
    file or a missing ruleset or map. With ``dump_dir``, a divergence writes the states (module
    docstring). ``observer`` sees every tick like in ``replay_match`` (the server writes the
    frames file this way, SRV-07); it stops seeing ticks at a divergence.
    """
    path = Path(path)
    replay = _read_current(path)
    header = replay.header
    rules = _find_ruleset(header.ruleset_hash, Path(rulesets_dir))
    mapdef = _find_map(header, [path.parent / "maps", Path(maps_dir)])
    try:
        match = Match(mapdef, rules, header.match_key)
    except ValueError as exc:
        raise ReplayError(f"{path}: {exc}") from exc
    by_tick: dict[int, list[PlayerCommand]] = {}
    for tick, cmd in replay.commands:
        by_tick.setdefault(tick, []).append(cmd)
    good: tuple[int, dict[str, object]] | None = None
    if observer is not None:
        observer.begin(match)
    for matched, checkpoint in enumerate(replay.checkpoints):
        while match.tick < checkpoint.tick and not match.finished:
            commands = by_tick.get(match.tick + 1, [])
            match.step(commands)
            if observer is not None:
                observer.record(match, commands)
        data = to_canonical(match.state)
        actual = digest(data)
        if match.tick < checkpoint.tick:
            actual = f"match ended at tick {match.tick}"
        if actual != checkpoint.hash:
            dump = None
            if dump_dir is not None:
                dump = _dump(Path(dump_dir), path, checkpoint, actual, good, (match.tick, data))
            divergence = Divergence(checkpoint.tick, checkpoint.hash, actual, dump)
            return ReplayCheck(path, matched, match.tick, divergence)
        good = (match.tick, data)
    return ReplayCheck(path, len(replay.checkpoints), match.tick, None)


def replay_match(
    path: str | Path,
    rulesets_dir: str | Path = DEFAULT_RULESETS_DIR,
    maps_dir: str | Path = DEFAULT_MAPS_DIR,
    observer: MatchObserver | None = None,
) -> Match:
    """Re-simulate a replay up to its last checkpoint and return the finished ``Match``.

    ``observer`` sees every tick like in ``run_headless``. No hash is compared (that is
    ``replay_run``). Raises ``ReplayVersionError`` and ``ReplayError`` like ``replay_run``.
    """
    path = Path(path)
    replay = _read_current(path)
    header = replay.header
    rules = _find_ruleset(header.ruleset_hash, Path(rulesets_dir))
    mapdef = _find_map(header, [path.parent / "maps", Path(maps_dir)])
    try:
        match = Match(mapdef, rules, header.match_key)
    except ValueError as exc:
        raise ReplayError(f"{path}: {exc}") from exc
    by_tick: dict[int, list[PlayerCommand]] = {}
    for tick, cmd in replay.commands:
        by_tick.setdefault(tick, []).append(cmd)
    if observer is not None:
        observer.begin(match)
    while not match.finished and match.tick < replay.checkpoints[-1].tick:
        commands = by_tick.get(match.tick + 1, [])
        match.step(commands)
        if observer is not None:
            observer.record(match, commands)
    return match


def analyze_replay(
    path: str | Path,
    rulesets_dir: str | Path = DEFAULT_RULESETS_DIR,
    maps_dir: str | Path = DEFAULT_MAPS_DIR,
) -> MatchMetrics:
    """``analyze`` of the match of a replay (a bot tournament match or a real one)."""
    recorder = MatchRecorder()
    replay_match(path, rulesets_dir, maps_dir, recorder)
    return analyze(recorder.log())


def _find_ruleset(rules_hash: str, rulesets_dir: Path) -> Ruleset:
    file = rulesets_dir / f"{rules_hash}.toml"
    if not file.is_file():
        raise ReplayError(f"ruleset {rules_hash} is not archived in {rulesets_dir}")
    try:
        rules = load_ruleset(file)
    except RulesetError as exc:
        raise ReplayError(str(exc)) from exc
    if ruleset_hash(rules) != rules_hash:
        raise ReplayError(f"{file}: archived ruleset does not match its hash")
    return rules


def _find_map(header: ReplayHeader, dirs: list[Path]) -> MapDef:
    for folder in dirs:
        file = folder / f"{header.map_id}.json"
        if not file.is_file():
            continue
        try:
            mapdef = load_map(file)
        except MapFormatError as exc:
            raise ReplayError(str(exc)) from exc
        if map_hash(mapdef) == header.map_hash:
            return mapdef
    where = ", ".join(str(d) for d in dirs)
    raise ReplayError(f"no map {header.map_id} with hash {header.map_hash} in {where}")


def _dump(
    dump_dir: Path,
    path: Path,
    checkpoint: Checkpoint,
    actual: str,
    good: tuple[int, dict[str, object]] | None,
    bad: tuple[int, dict[str, object]],
) -> Path:
    folder = dump_dir / path.name.removesuffix(REPLAY_SUFFIX)
    folder.mkdir(parents=True, exist_ok=True)
    report = {
        "replay": str(path),
        "tick": checkpoint.tick,
        "expected": checkpoint.hash,
        "actual": actual,
        "last_matching_tick": None if good is None else good[0],
        "sim_version": SIM_VERSION,
        "python_version": platform.python_version(),
    }
    _write_json(folder / "divergence.json", report)
    if good is not None:
        _write_json(folder / f"state_tick{good[0]}_matching.json", good[1])
    _write_json(folder / f"state_tick{bad[0]}_diverged.json", bad[1])
    return folder


def _write_json(file: Path, value: object) -> None:
    text = json.dumps(value, sort_keys=True, indent=1, ensure_ascii=False)
    file.write_text(text + "\n", encoding="utf-8")


# CLI ----------------------------------------------------------------------------------------


def _replay_files(args: Sequence[str]) -> Iterator[Path]:
    """Replay files among ``args``: files ending in ``.jsonl.gz`` and such files in folders."""
    for arg in args:
        p = Path(arg)
        if p.is_dir():
            yield from sorted(f for f in p.rglob(f"*{REPLAY_SUFFIX}") if f.is_file())
        elif p.name.endswith(REPLAY_SUFFIX):
            yield p


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m gow_sim.replay", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("check", help="re-simulate replays and compare checkpoint hashes")
    check.add_argument("paths", nargs="+", help="replay files or folders (other files ignored)")
    check.add_argument("--rulesets", default=str(DEFAULT_RULESETS_DIR), help="ruleset archive")
    check.add_argument("--maps", default=str(DEFAULT_MAPS_DIR), help="map folder")
    check.add_argument(
        "--dump-dir", default="replay-divergence", help="where divergences are dumped"
    )
    args = parser.parse_args(argv)
    checked = failed = skipped = 0
    for file in dict.fromkeys(_replay_files(args.paths)):  # a glob may name a file twice
        try:
            result = replay_run(file, args.rulesets, args.maps, args.dump_dir)
        except ReplayVersionError as exc:
            skipped += 1
            print(f"skip      {exc}")
            continue
        except ReplayError as exc:
            failed += 1
            print(f"ERROR     {exc}")
            continue
        checked += 1
        d = result.divergence
        if d is None:
            print(f"ok        {file}: {result.checkpoints} checkpoints, {result.ticks} ticks")
        else:
            failed += 1
            print(
                f"DIVERGED  {file} at tick {d.tick}: expected {d.expected}, got {d.actual}; "
                f"dump: {d.dump}"
            )
    print(f"{checked} checked, {failed} failed, {skipped} skipped (other sim_version)")
    if checked == 0 and failed == 0:
        print(f"no replay of sim_version {SIM_VERSION} found", file=sys.stderr)
        return 1
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
