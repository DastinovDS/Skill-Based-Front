"""#905: the buildings in the replay frames file, in the full view and in each side's view.

The full view (``c`` and ``d`` of a frame) carries every city's factory, factory build, barracks,
barracks build, recruit queue and rally point and every road fortification. Each side's part
(``v[p]``) carries only the enemy buildings that side's live ``PlayerView`` showed: a built
factory and the barracks of an enemy city joined by an edge to an own node (DEC-31; DEC-41, item
2), an enemy road fortification while the half of its node is not in fog (DEC-43, item D8). The
side's own buildings come from the full view by owner (``docs/design/replay-frames.md``,
"Buildings").
"""

import gzip
import json
import tomllib
from collections.abc import Sequence
from pathlib import Path
from typing import Any, Final, cast

import pytest

from gow_bots.bots import BOTS
from gow_server.frames import build_frames, frame_of, vision_of
from gow_sim.commands import (
    BuildBarracks,
    BuildFactory,
    Command,
    Forfeit,
    FortifyRoad,
    PlayerCommand,
    SetRallyPoint,
)
from gow_sim.maps import PLAYERS, MapDef, load_map
from gow_sim.match import Controller, run_headless
from gow_sim.match import Match as SimMatch
from gow_sim.replay import ReplayWriter
from gow_sim.ruleset import Ruleset, load_ruleset
from gow_sim.state import Build, FactoryBuild, initial_state
from gow_sim.view import PlayerView, project, view_to_canonical

ROOT: Final = Path(__file__).parents[3]
RULESETS: Final = ROOT / "rulesets" / "archive"
SIEGE: Final = ROOT / "packages" / "sim" / "tests" / "maps" / "siege.json"
KEY: Final = b"k" * 32
FRAMES_BUDGET: Final = 2 * 1024 * 1024
"""AGENTS.md, section 12: the frames file of a whole match (15 minutes, DEC-22)."""
BUILDING_KEYS: Final[tuple[str, ...]] = (
    "factory",
    "factory_build",
    "has_barracks",
    "building",
    "recruit_queue",
    "recruit_progress",
    "recruit_waiting",
    "rally_point",
)
"""The ``NodeView`` fields of the buildings (#905)."""


@pytest.fixture(scope="module")
def siege() -> MapDef:
    return load_map(SIEGE)


@pytest.fixture(scope="module")
def rules() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "mvp-7.toml")


# The full view --------------------------------------------------------------------------------


def test_frame_carries_every_building_of_both_players(siege: MapDef, rules: Ruleset) -> None:
    """``c``: a record per city with any building, ``[node, factory, factory_build, barracks,
    build, recruit, rally]``; ``d``: every road fortification, ``[edge, node, built, ready]``.
    The numbers are the ones set below; a build that still owes charges has no done tick (DEC-41,
    item 7), a paid one ends ``build_ticks`` after its start (DEC-41, item 2; DEC-26), a
    fortification works from its ``ready`` tick (DEC-43, item D)."""
    state = initial_state(siege, rules)
    state.tick = 120
    capital0, city1, city3, capital1 = (state.nodes[i] for i in (0, 1, 3, 5))
    capital0.recruit_queue, capital0.recruit_progress = 2, 7
    capital0.rally_point = 1
    city1.factory_build = FactoryBuild(owner=0, since=30)
    city1.build = Build(owner=0, since=20, owed=1)
    city3.factory, city3.has_barracks = 1, True
    capital1.recruit_queue = 1
    capital1.recruit_progress = rules.recruit.unit_ticks  # ready, waits for a place
    capital1.rally_point = 4
    capital0.road_forts[5] = 140  # edge 5 (3-0): being built
    capital1.road_forts[3] = 100  # edge 3 (5-4): works since tick 100

    frame = frame_of(state, rules)

    assert frame["c"] == [
        [0, 0, None, 1, None, [2, 7, 0], 1],
        [1, None, [30 + rules.factory.build_ticks, 0], 0, [None, 1]],
        [3, 1, None, 1],
        [5, 1, None, 1, None, [1, rules.recruit.unit_ticks, 1], 4],
    ]  # the cities 2, 4 (no building) and 6, 7 (neutral) have no record
    assert frame["d"] == [[3, 5, 1, 100], [5, 0, 0, 140]]


def test_frame_without_forts_has_no_d(siege: MapDef, rules: Ruleset) -> None:
    """At the start only the capitals are factories with a barracks (DEC-26; DEC-41, item 2)."""
    frame = frame_of(initial_state(siege, rules), rules)
    assert frame["c"] == [[0, 0, None, 1], [5, 1, None, 1]]
    assert "d" not in frame


# Each side's view -----------------------------------------------------------------------------


def test_vision_shows_only_the_enemy_buildings_the_view_had(siege: MapDef, rules: Ruleset) -> None:
    """Player 0 holds 0, 1, 2 with groups in 0 and 2 (the siege start). DEC-31: of the enemy cities
    it sees the factory and barracks of 3 (next to 0) and 5 (next to 2), never of 4 (its
    neighbours 3, 5, 7 are not player 0's). DEC-43, item D8: of the enemy fortifications only
    those of a node whose half is not in fog: 3 and 5 are neighbours of player 0's sources, 4 is
    in fog. The enemy's builds, queue and rally point are never in it."""
    state = initial_state(siege, rules)
    state.tick = 200
    for n in (3, 4):
        state.nodes[n].factory, state.nodes[n].has_barracks = 1, True
    capital1 = state.nodes[5]
    capital1.recruit_queue, capital1.rally_point = 2, 4
    capital1.build = Build(owner=1, since=150)
    state.nodes[3].road_forts[5] = 100  # edge 5 (3-0), built
    state.nodes[5].road_forts[2] = 300  # edge 2 (2-5), being built
    state.nodes[4].road_forts[8] = 100  # edge 8 (7-4), in fog for player 0
    view = project(state, rules, 0, KEY)
    # The live view agrees with the reading of the rules above.
    assert [n.detail.value for n in view.nodes][4] == "fog"
    assert [n.id for n in view.nodes if n.owner == 1 and n.factory is not None] == [3, 5]

    vision = vision_of(view)

    assert vision["c"] == [[3, 1, 1], [5, 1, 1]]
    assert vision["d"] == [[2, 5, 0], [5, 3, 1]]  # by edge; no ready tick of an enemy one
    # Player 1 sees no fortification of player 0 (there is none) and its own are not in ``v``.
    assert "d" not in vision_of(project(state, rules, 1, KEY))


# A recorded match ----------------------------------------------------------------------------


class _Builder:
    """A bot plus the buildings it would not make by itself: at tick 100 a factory and a barracks
    in every own city, from 300 on every 200 ticks a fortification on a road of the next own node
    (one at a time: the CP do not pay for more), a rally point of
    every city with a barracks at 100 and again at 600; ``forfeit_at`` ends the match early.
    Rejected commands change nothing (AGENTS.md, section 4.3)."""

    def __init__(self, inner: Controller, mapdef: MapDef, forfeit_at: int | None) -> None:
        self.inner, self.mapdef, self.forfeit_at = inner, mapdef, forfeit_at

    def decide(self, view: PlayerView, tick: int) -> list[Command]:
        if self.forfeit_at is not None and tick >= self.forfeit_at:
            return [Forfeit()]
        cmds = list(self.inner.decide(view, tick))
        own = [n for n in view.nodes if n.owner == view.player]
        k, late = divmod(tick - 300, 200)
        if not late and 0 <= k < len(own):
            n = own[k].id
            cmds.append(FortifyRoad(n, self.mapdef.incident[n][0]))
        for n in own:
            if tick == 100:
                cmds += [BuildFactory(n.id), BuildBarracks(n.id)]
            others = [m.id for m in own if m.id != n.id]
            if tick in (100, 600) and others and n.has_barracks:
                cmds.append(SetRallyPoint(n.id, others[tick // 100 % len(others)]))
        return cmds


class _ViewsAndLog:
    """The replay log plus both players' canonical ``project()`` at every frame tick."""

    def __init__(self, writer: ReplayWriter) -> None:
        self.writer = writer
        self.views: dict[int, list[dict[str, Any]]] = {}

    def begin(self, match: SimMatch) -> None:
        self.writer.begin(match)
        self._sample(match)

    def record(self, match: SimMatch, commands: Sequence[PlayerCommand]) -> None:
        self.writer.record(match, commands)
        if match.tick % 5 == 0 or match.finished:
            self._sample(match)

    def _sample(self, match: SimMatch) -> None:
        self.views[match.tick] = [view_to_canonical(match.view(p)) for p in PLAYERS]


def _padded(record: list[Any], size: int) -> list[Any]:
    return [*record, *[None] * (size - len(record))]


def _as_seen_by(frame: dict[str, Any], side: int, mapdef: MapDef) -> dict[str, Any]:
    """The buildings of ``side`` in one frame, read the way ``replay-frames.md`` tells the viewer:
    own ones from the full ``c`` and ``d`` by owner, enemy ones only from ``v[side]``. Shaped
    like the ``NodeView`` and ``EdgeView.forts`` fields of ``view_to_canonical``."""
    owners = [n[0] for n in frame["n"]]
    full = {rec[0]: _padded(rec, 7) for rec in frame.get("c", [])}
    vision = frame["v"][side]
    enemy = {rec[0]: rec for rec in vision.get("c", [])}
    empty: dict[str, Any] = dict.fromkeys(BUILDING_KEYS)
    nodes: list[dict[str, Any]] = []
    for node in mapdef.nodes:
        n = node.id
        if node.kind.value == "province":
            nodes.append(empty)
        elif owners[n] == side:
            _, factory, site, barracks, build, recruit, rally = full.get(
                n, _padded([n, None, None, 0], 7)
            )
            queue, progress, waiting = recruit or [0, 0, 0]
            nodes.append(
                {
                    "factory": factory == side,
                    "factory_build": None
                    if site is None
                    else dict(zip(("done_tick", "owed"), site, strict=True)),
                    "has_barracks": bool(barracks),
                    "building": None
                    if build is None
                    else {"kind": "barracks", "done_tick": build[0], "owed": build[1]},
                    "recruit_queue": queue,
                    "recruit_progress": progress,
                    "recruit_waiting": bool(waiting),
                    "rally_point": rally,
                }
            )
        elif n in enemy:
            _, factory, barracks = enemy[n]
            nodes.append(empty | {"factory": bool(factory), "has_barracks": bool(barracks)})
        else:
            nodes.append(empty)
    forts: dict[int, list[dict[str, Any]]] = {}
    for e, n, built, ready in frame.get("d", []):
        if owners[n] == side:
            forts.setdefault(e, []).append(
                {
                    "node": n,
                    "owner": side,
                    "built": bool(built),
                    "done_tick": None if built else ready,
                }
            )
    for e, n, built in vision.get("d", []):
        forts.setdefault(e, []).append(
            {"node": n, "owner": owners[n], "built": bool(built), "done_tick": None}
        )
    for e, listed in forts.items():
        listed.sort(key=lambda f: f["node"] != mapdef.edges[e].a)  # the end ``a`` first
    return {"nodes": nodes, "forts": forts}


def _live(view: dict[str, Any]) -> dict[str, Any]:
    return {
        "nodes": [{k: n[k] for k in BUILDING_KEYS} for n in view["nodes"]],
        "forts": {e["id"]: e["forts"] for e in view["edges"] if e["forts"]},
    }


def test_each_side_sees_in_the_frames_what_its_live_view_showed(
    tmp_path: Path, siege: MapDef, rules: Ruleset
) -> None:
    """In every frame and for each side, the buildings the viewer reads (own from the full view,
    enemy from ``v``) equal the side's live ``project()`` of that tick: never an enemy building
    or rally point it did not show, and every own one. The full view holds the enemy ones the
    side did not see; the counters make sure every case occurred."""
    bots = [
        _Builder(BOTS["smart_rusher"](siege, rules, seed=1, player=0), siege, None),
        _Builder(BOTS["smart_expander"](siege, rules, seed=2, player=1), siege, 2000),
    ]
    log = tmp_path / "1.jsonl.gz"
    with ReplayWriter(log) as writer:
        observer = _ViewsAndLog(writer)
        played = run_headless(siege, rules, bots, observer=observer)
    assert played.outcome is not None and played.outcome.reason.value == "forfeit"
    result = build_frames(log, tmp_path / "1.frames.json.gz", RULESETS, SIEGE.parent)
    doc = json.loads(gzip.decompress(result.path.read_bytes()))
    assert [f["t"] for f in doc["frames"]] == sorted(observer.views)

    seen: dict[str, int] = dict.fromkeys(
        (
            "enemy factory shown",
            "enemy factory hidden",
            "enemy barracks hidden",
            "enemy fort shown",
            "enemy fort hidden",
            "enemy rally hidden",
            "enemy queue hidden",
            "factory build",
            "barracks build",
            "recruit queue",
        ),
        0,
    )
    for frame in doc["frames"]:
        owners = [n[0] for n in frame["n"]]
        full = {rec[0]: _padded(rec, 7) for rec in frame.get("c", [])}
        assert all(owners[n] is not None for n in full), "a neutral city has no building"
        seen["factory build"] += sum(rec[2] is not None for rec in full.values())
        seen["barracks build"] += sum(rec[4] is not None for rec in full.values())
        seen["recruit queue"] += sum(rec[5] is not None for rec in full.values())
        for side in PLAYERS:
            vision = frame["v"][side]
            assert _as_seen_by(frame, side, siege) == _live(observer.views[frame["t"]][side]), (
                f"tick {frame['t']}, side {side}"
            )
            shown = {rec[0] for rec in vision.get("c", [])}
            assert all(owners[n] not in (None, side) for n in shown), "only enemy cities in v"
            for n, rec in full.items():
                if owners[n] == side:
                    continue
                if rec[1] is not None:
                    seen["enemy factory shown" if n in shown else "enemy factory hidden"] += 1
                if rec[3] and n not in shown:
                    seen["enemy barracks hidden"] += 1
                seen["enemy rally hidden"] += rec[6] is not None
                seen["enemy queue hidden"] += rec[5] is not None
            shown_forts = {(e, n) for e, n, _ in vision.get("d", [])}
            assert all(owners[n] not in (None, side) for _, n in shown_forts)
            for e, n, _, _ in frame.get("d", []):
                if owners[n] != side:
                    hidden = (e, n) not in shown_forts
                    seen["enemy fort hidden" if hidden else "enemy fort shown"] += 1
    assert all(seen.values()), seen


def test_frames_of_many_buildings_stay_in_the_size_budget(rules: Ruleset) -> None:
    """Worst case for #905 on the largest pool map: every city a factory with a barracks, a
    factory build, a barracks build, a full recruit queue and a rally point, a fortification on
    both ends of every road, in all 1801 frames of 15 minutes, the counters changing every frame.
    The budget is 2 MB (AGENTS.md, section 12)."""
    mapdef = load_map(ROOT / "maps" / "crossroads.json")
    state = initial_state(mapdef, rules)
    cities = [n.id for n in mapdef.nodes if n.kind.value != "province"]
    for i, n in enumerate(mapdef.nodes):
        state.nodes[n.id].owner = i % 2
    for edef in mapdef.edges:
        for n in (edef.a, edef.b):
            state.nodes[n].road_forts[edef.id] = 0
    sizes: list[int] = []
    frames: list[dict[str, object]] = []
    for tick in range(0, 9001, 5):
        state.tick = tick
        for n in cities:
            node = state.nodes[n]
            node.factory, node.has_barracks = node.owner, True
            node.factory_build = FactoryBuild(owner=0, since=tick, owed=tick % 4)
            node.build = Build(owner=0, since=tick, owed=tick % 3)
            node.recruit_queue, node.recruit_progress = 3, tick % 31
            node.rally_point = (n + tick // 5) % len(mapdef.nodes)
        for edef in mapdef.edges:
            state.nodes[edef.a].road_forts[edef.id] = tick + 100
        frames.append(frame_of(state, rules))
        sizes.append(len(cast("list[object]", frames[-1]["c"])))
    assert min(sizes) == len(cities)
    data = json.dumps(frames, separators=(",", ":")).encode()
    assert len(gzip.compress(data)) <= FRAMES_BUDGET


def test_header_has_the_rule_numbers_the_viewer_draws_builds_with(tmp_path: Path) -> None:
    """``rules`` (#905): the times and prices of the builds and the recruit queue, from the ruleset
    file (map tempo scales only the economy periods, so these are the file's numbers)."""
    siege_map = load_map(SIEGE)
    path = ROOT / "rulesets" / "mvp-7.toml"
    ruleset, toml = load_ruleset(path), tomllib.loads(path.read_text())
    bots = [
        BOTS["smart_rusher"](siege_map, ruleset, seed=1, player=0),
        _Builder(BOTS["smart_expander"](siege_map, ruleset, seed=2, player=1), siege_map, 50),
    ]
    log = tmp_path / "2.jsonl.gz"
    with ReplayWriter(log) as writer:
        run_headless(siege_map, ruleset, bots, observer=writer)
    result = build_frames(log, tmp_path / "2.frames.json.gz", RULESETS, SIEGE.parent)
    doc = json.loads(gzip.decompress(result.path.read_bytes()))
    assert doc["rules"] == {
        "unit_ticks": toml["recruit"]["unit_ticks"],
        "queue_max": toml["recruit"]["queue_max"],
        "barracks_ticks": toml["city_upgrades"]["barracks_ticks"],
        "barracks_charges": toml["city_upgrades"]["barracks_charges"],
        "factory_ticks": toml["factory"]["build_ticks"],
        "factory_charges": toml["factory"]["cost"],
        "fort_ticks": toml["fort"]["build_ticks"],
    }
