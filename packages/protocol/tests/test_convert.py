"""Converters sim <-> wire (PRO-03 #46): real matches on the MVP maps, fixtures, and leak checks.

A client-side driver plays each MVP map through the wire only: it reads the ``snapshot`` it got,
sends wire commands with string ids, and the server side converts them (``command_from_wire``,
``Match.resolve``), steps the match and converts the view, the acks and the events back. Every
message must validate, round-trip through the codec, match the ``PlayerView`` field by field, and
never carry anything of the enemy the view does not show. The unvalidated ``snapshot_frame`` the
server sends must be, on every tick of these matches, the very frame of the validated
``snapshot_msg`` (#155).
"""

import dataclasses
import json
import timeit
from collections import deque
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from gow_bots.bots import BOTS
from gow_protocol import commands as wire
from gow_protocol.codec import SnapshotFrame, decode_client, decode_server, encode, encode_snapshot
from gow_protocol.convert import (
    EVENT_FIELDS,
    EVENT_ID_FIELDS,
    FIGHT_KINDS,
    PRIVATE_KINDS,
    PUBLIC_KINDS,
    ack_msg,
    command_from_wire,
    event_for_player,
    events_msgs,
    match_end_msg,
    opaque_from_wire,
    opaque_to_wire,
    reach_msg,
    snapshot_frame,
    snapshot_msg,
)
from gow_protocol.messages import CommandMsg, EndReason, EventMsg, MatchEndMsg, SnapshotMsg
from gow_protocol.view import AtNodeLoc, OnEdgeLoc, View
from gow_sim import commands as sim
from gow_sim import view as sv
from gow_sim.maps import PLAYERS, MapDef, load_map
from gow_sim.match import Match, run_headless
from gow_sim.ruleset import Ruleset, Stance, load_ruleset
from gow_sim.state import AtNode, Detail, Event, Group, Mode, event
from gow_sim.systems.movement import find_path
from gow_sim.systems.victory import EndReason as SimEndReason
from gow_sim.systems.victory import Outcome
from gow_sim.view import PlayerView, opaque_id, view_to_canonical

ROOT = Path(__file__).resolve().parents[3]
RULES = load_ruleset(ROOT / "rulesets" / "mvp-0.toml")
MVP_MAPS = ("artery", "web", "pass")
CLIENT_FIXTURES = ROOT / "packages" / "protocol" / "fixtures" / "client"
KEY = b"pro-03 test match key, 32 bytes!"
TICKS = 2000  # pass: the first fight of the scripted drivers is at 1722..1822
BOT_TICKS = 1200
REGRESSION = 1.5

NOT_FOUND = sim.RejectCode.NOT_FOUND_OR_HIDDEN.value
DROPPED_ORDER_KEYS = ("depart_tick",)
DROPPED_LOCATION_KEYS = ("back",)


# Client-side driver --------------------------------------------------------------------------


class WireDriver:
    """Plays from the wire ``View`` only: recruits, expands, splits, merges, defends, builds."""

    def __init__(self, mapdef: MapDef, rules: Ruleset, player: int) -> None:
        self.map, self.rules, self.player = mapdef, rules, player
        self.hops = [self._bfs(n) for n in range(len(mapdef.nodes))]

    def _bfs(self, start: int) -> list[int]:
        dist = [-1] * len(self.map.nodes)
        dist[start] = 0
        queue = deque([start])
        while queue:
            node = queue.popleft()
            for e in self.map.incident[node]:
                other = self.map.edges[e].other(node)
                if dist[other] < 0:
                    dist[other] = dist[node] + 1
                    queue.append(other)
        return dist

    def decide(self, view: View, tick: int) -> list[wire.Command]:
        me, cost = self.player, self.rules.orders.cost
        cmds: list[wire.Command] = []
        capital = self.map.capital(me)
        if (tick // 5) % 40 == 21 and view.me.cp >= cost.build:  # a road first (DEC-28: CP)
            for g in view.groups:
                if isinstance(g.location, AtNodeLoc):
                    here = g.location.node
                    gains = [e for e in self.map.incident[here] if view.edges[e].upgrade_gain]
                    if gains:
                        cmds.append(wire.UpgradeRoadCmd(edge=gains[0]))
                        break
        if view.me.cp >= cost.recruit and view.nodes[capital].owner == me:
            cmds.append(wire.RecruitCmd(node=capital))
        if tick == 300:
            cmds.append(wire.SetStanceCmd(stance=Stance.WAR))
        foreign = [n.id for n in view.nodes if n.owner != me]
        by_node: dict[int, list[str]] = {}
        for g in view.groups:
            if not isinstance(g.location, AtNodeLoc) or g.order is not None:
                continue
            here = g.location.node
            by_node.setdefault(here, []).append(g.id)
            phase = (tick // 5) % 40
            if phase == 7 and g.units >= 4:
                cmds.append(wire.SplitCmd(group=g.id, n=g.units // 2))
                continue
            if phase == 13 and here == capital:
                mode = Mode.DEFENSE if g.mode is Mode.ATTACK else Mode.ATTACK
                cmds.append(wire.SetModeCmd(group=g.id, mode=mode))
                continue
            gains = [e for e in self.map.incident[here] if view.edges[e].upgrade_gain is not None]
            if 21 <= phase <= 30 and gains:
                continue  # the groups at upgradable roads wait (a road: above), armies gather
            if g.mode is not Mode.ATTACK:
                continue
            dist = self.hops[here]
            reachable = [n for n in foreign if n != here and dist[n] > 0]
            if reachable:
                dest = min(reachable, key=lambda n: (dist[n], self.map.node_key(me, n)))
                cmds.append(wire.MoveCmd(group=g.id, dest=dest, planned=phase % 4 == 1))
        if (tick // 5) % 40 == 30:
            for ids in by_node.values():
                if len(ids) >= 2:
                    cmds.append(wire.MergeCmd(groups=tuple(ids[:2])))
        return cmds


# Faithfulness and leak checks ----------------------------------------------------------------


def _expected_wire_view(view: PlayerView) -> dict[str, Any]:
    """``view_to_canonical`` in wire shape: ids as strings, the server-only fields removed."""
    data: dict[str, Any] = json.loads(json.dumps(view_to_canonical(view)))
    del data["tick"], data["player"]
    for key in ("groups", "packets", "intents", "fights"):
        for entity in data[key]:
            entity["id"] = str(entity["id"])
    for fight in data["fights"]:
        fight["groups"] = [str(g) for g in fight["groups"]]
    for group in data["groups"]:
        if group["order"] is not None:
            for name in DROPPED_ORDER_KEYS:
                del group["order"][name]
        for name in DROPPED_LOCATION_KEYS:
            group["location"].pop(name, None)

    def wire_range(span: list[int | None] | None) -> dict[str, int | None] | None:
        return None if span is None else {"low": span[0], "high": span[1]}

    seen = [n["seen"] for n in data["nodes"]]
    seen += [h["seen"] for e in data["edges"] for h in e["halves"]]
    for s in seen:
        if s is not None:
            s["enemy_range"] = wire_range(s["enemy_range"])
    for edge in data["edges"]:
        for figure in edge["enemy_groups"]:
            figure["id"] = str(figure["id"])
            figure["units_range"] = wire_range(figure["units_range"])
    return data


def _check_snapshot(match: Match, player: int) -> SnapshotMsg:
    view = match.view(player)
    msg = snapshot_msg(view)
    frame = encode(msg)
    assert decode_server(frame) == msg
    fast = snapshot_frame(view)
    assert fast == SnapshotFrame(view.tick, frame)
    assert encode(fast) == frame
    assert msg.tick == view.tick
    assert json.loads(frame)["view"] == _expected_wire_view(view)
    _check_no_enemy_ids(match, player, frame)
    return msg


def _enemy_ids(match: Match, player: int) -> set[str]:
    """Every id string that would name an enemy group or packet: in either player's id space."""
    state = match.state
    internal = [gid for gid, g in state.groups.items() if g.owner != player]
    internal += [pid for pid, p in state.packets.items() if p.owner != player]
    return {str(opaque_id(match.match_key, viewer, i)) for i in internal for viewer in PLAYERS}


def _check_no_enemy_ids(match: Match, player: int, frame: str) -> None:
    for oid in _enemy_ids(match, player):
        assert oid not in frame


def _check_events(match: Match, events: list[Event], player: int) -> list[EventMsg]:
    msgs = events_msgs(events, player, match.match_key)
    by_kind = [e for e in events if event_for_player(e, player, match.match_key) is not None]
    assert len(msgs) == len(by_kind)
    for raw, msg in zip(by_kind, msgs, strict=True):
        frame = encode(msg)
        assert decode_server(frame) == msg
        assert (msg.tick, msg.kind) == (raw.tick, raw.kind)
        data = dict(raw.data)
        if raw.kind in PRIVATE_KINDS:
            owner = data["owner"] if raw.kind == "warehouse_lost" else data["player"]
            assert owner == player
        else:
            assert raw.kind in PUBLIC_KINDS or raw.kind in FIGHT_KINDS
        # ARC-02: the simulation sends only declared fields, and every declared one gets through
        # (DEC-24, I2 as revised with DEC-29: a fight event goes whole to both players).
        assert set(data) <= set(EVENT_FIELDS[raw.kind]), raw.kind
        assert set(msg.data) == set(data)
        for key, value in msg.data.items():
            if key in EVENT_ID_FIELDS.get(raw.kind, frozenset()):
                assert value == str(opaque_id(match.match_key, player, int(str(data[key]))))
            else:
                assert value == data[key]
        _check_no_enemy_ids(match, player, frame)
    for e in events:
        if e.kind == "match_ended":
            assert event_for_player(e, player, match.match_key) is None
    return msgs


# Real matches on the MVP maps ----------------------------------------------------------------


@pytest.mark.parametrize("name", MVP_MAPS)
def test_match_through_the_wire(name: str) -> None:
    mapdef = load_map(ROOT / "maps" / "fixtures" / f"{name}.json")
    # Roads for free here: the drivers spend every CP on recruits and moves, and the test wants
    # every message kind, ``road_upgraded`` included (the price is DEC-28's, ``test_build.py``).
    cost = dataclasses.replace(RULES.orders.cost, build=0)
    rules = dataclasses.replace(RULES, orders=dataclasses.replace(RULES.orders, cost=cost))
    match = Match(mapdef, rules, KEY)
    drivers = [WireDriver(mapdef, rules, p) for p in PLAYERS]
    seqs = dict.fromkeys(PLAYERS, 0)
    kinds: set[str] = set()
    acks: dict[str, int] = {"path": 0, "reject": 0, "ok": 0}
    snapshots = {p: _check_snapshot(match, p) for p in PLAYERS}
    pending: list[sim.PlayerCommand] = []
    while not match.finished and match.tick < TICKS:
        if match.tick % 5 == 0:
            for p in PLAYERS:
                for cmd in drivers[p].decide(snapshots[p].view, match.tick):
                    seqs[p] += 1
                    msg = decode_client(encode(CommandMsg(seq=seqs[p], cmd=cmd)))
                    assert isinstance(msg, CommandMsg)
                    resolved = match.resolve(p, command_from_wire(msg.cmd))
                    pending.append(sim.PlayerCommand(p, msg.seq, resolved))
        events = match.step(pending)
        pending = []
        kinds.update(e.kind for e in events)
        for result in match.results:
            ack = ack_msg(result)
            assert decode_server(encode(ack)) == ack
            assert (ack.seq, ack.applied_tick) == (result.seq, match.tick)
            match result.outcome:
                case sim.Ok(path=path):
                    assert ack.reject_code is None
                    assert ack.path == (path or None)
                    acks["path" if path else "ok"] += 1
                case sim.Reject(code=code):
                    assert (ack.reject_code, ack.path) == (code.value, None)
                    acks["reject"] += 1
        for p in PLAYERS:
            snapshots[p] = _check_snapshot(match, p)
            _check_events(match, events, p)
    # Every event kind the match produced is classified: nothing reaches a player by default.
    assert kinds <= PUBLIC_KINDS | PRIVATE_KINDS | FIGHT_KINDS | {"match_ended"}
    assert {"fight_started", "fight_round", "fight_ended", "fight_group"} <= kinds
    assert {"recruited", "node_captured", "road_upgraded"} <= kinds
    assert all(acks.values())
    # Upgraded roads went through the views.
    assert any(e.width > 1 for e in snapshots[0].view.edges)


class _FrameChecker:
    """``MatchObserver``: after every tick both players' frames equal the validated ones."""

    def __init__(self) -> None:
        self.features: set[str] = set()

    def begin(self, match: Match) -> None:
        self.record(match, ())

    def record(self, match: Match, commands: Sequence[sim.PlayerCommand]) -> None:
        for player in PLAYERS:
            view = match.view(player)
            msg = snapshot_msg(view)
            assert snapshot_frame(view) == SnapshotFrame(view.tick, encode(msg))
            self.features |= _features(msg.view)


def _features(view: View) -> set[str]:
    places = [*view.nodes, *(h for e in view.edges for h in e.halves)]
    found = {
        "on_edge": any(isinstance(g.location, OnEdgeLoc) for g in view.groups),
        "planned": any(g.order is not None and g.order.planned for g in view.groups),
        "packets": bool(view.packets),
        "intent_target": any(i.target is not None for i in view.intents),
        "intent_no_target": any(i.target is None for i in view.intents),
        "upgrade_gain": any(e.upgrade_gain is not None for e in view.edges),
        "enemy_exact": any(p.seen is not None and p.seen.enemy_units for p in places),
        "enemy_presence": any(
            p.seen is not None and p.seen.enemy_modes and p.seen.enemy_units is None for p in places
        ),
        "enemy_range": any(p.seen is not None and p.seen.enemy_range for p in places),
        "enemy_figures": any(e.enemy_groups for e in view.edges),
        "fog_memory": any(p.detail is Detail.FOG and p.seen is not None for p in places),
        "road_level": any(e.width > 1 for e in view.edges),
        "attrition_in": any(n.attrition_in is not None for n in view.nodes),
        "grace_left": any(n.grace_left is not None for n in view.nodes),
        "fronts": any(f is not None for f in view.me.fronts),
        "transfer": any(p.transfer and len(p.path) > 1 for p in view.packets),
        "starve_in": any(n.starve_in is not None for n in view.nodes),
        "recruit_queue": any(n.recruit_queue for n in view.nodes),
        "enemy_barracks": any(
            n.has_barracks is not None and n.warehouse_level is None for n in view.nodes
        ),
    }
    return {name for name, present in found.items() if present}


def test_snapshot_frames_of_a_bot_match() -> None:
    """Strategic bots against each other: their frames equal the validated ones. Under the stack
    limit (DEC-20) their armies split into smaller waves that take targets with plain orders, so
    planned orders and their intents are set up in ``test_snapshot_frame_of_rare_view_parts``."""
    mapdef = load_map(ROOT / "maps" / "fixtures" / "artery.json")
    bots = ("rusher", "turtle")
    controllers = [BOTS[bot](mapdef, RULES, seed=7, player=p) for p, bot in enumerate(bots)]
    checker = _FrameChecker()
    run_headless(mapdef, RULES, controllers, max_ticks=BOT_TICKS, match_key=KEY, observer=checker)
    assert checker.features >= {
        "on_edge",
        "packets",
        "upgrade_gain",
        "enemy_presence",
        "enemy_range",
        "enemy_figures",
        "fog_memory",
    }


def test_snapshot_frame_of_rare_view_parts() -> None:
    """Intents with and without a target (a planned move, ``defense``) and exact enemy numbers,
    set up directly."""
    match = _started()
    own = match.view(0).groups[0]
    assert isinstance(own.location, sv.AtNode)
    match.step([sim.PlayerCommand(0, 1, match.resolve(0, sim.SetMode(own.id, Mode.DEFENSE)))])
    state = match.state
    home = own.location.node
    walker = state.new_id()
    state.groups[walker] = Group(walker, 0, 1, 1, Mode.ATTACK, AtNode(home))
    near = state.map.edges[state.map.incident[home][0]].other(home)
    state.players[0].cp = RULES.cp.cap  # the defense spent the start CP
    planned = sim.Move(opaque_id(KEY, 0, walker), near, planned=True)
    match.step([sim.PlayerCommand(0, 2, match.resolve(0, planned))])
    assert isinstance(match.results[0].outcome, sim.Ok)
    gid = state.new_id()
    state.groups[gid] = Group(gid, 1, 3, 2, Mode.ATTACK, AtNode(own.location.node))
    checker = _FrameChecker()
    checker.record(match, ())
    assert checker.features >= {"intent_no_target", "enemy_exact", "planned", "intent_target"}


def test_snapshot_frame_of_an_overcrowded_own_city() -> None:
    """The countdown fields (ui-style, section 12): the direct frame equals the validated one."""
    match = _started()
    own = match.view(0).groups[0]
    assert isinstance(own.location, sv.AtNode)
    node = own.location.node
    state = match.state
    gid = state.new_id()
    state.groups[gid] = Group(gid, 0, 500, 0, Mode.ATTACK, AtNode(node))
    state.nodes[node].over_ticks = 3
    checker = _FrameChecker()
    checker.record(match, ())
    assert checker.features >= {"attrition_in"}
    state.nodes[node].captured_tick = state.tick
    checker.record(match, ())
    assert checker.features >= {"attrition_in", "grace_left"}
    wire = snapshot_msg(match.view(0)).view.nodes[node]
    assert (wire.attrition_in, wire.grace_left) == (None, match.rules.capacity.grace_ticks)
    assert snapshot_msg(match.view(1)).view.nodes[node].grace_left is None  # the enemy sees none


def test_snapshot_frame_of_enemy_barracks_next_door() -> None:
    """DEC-31: an enemy city joined by an edge to an own node carries ``has_barracks`` alone
    (the direct frame equals the validated one); the warehouse level and the build stay hidden."""
    match = _started()
    state = match.state
    capital = state.map.capital(1)
    near = state.map.edges[state.map.incident[capital][0]].other(capital)
    state.nodes[near].owner = 0
    checker = _FrameChecker()
    checker.record(match, ())
    assert checker.features >= {"enemy_barracks"}
    node = snapshot_msg(match.view(0)).view.nodes[capital]
    assert (node.has_barracks, node.warehouse_level, node.warehouse_cap, node.building) == (
        True,
        None,
        None,
        None,
    )


class _Keeper:
    """``MatchObserver`` that keeps the match."""

    match: Match

    def begin(self, match: Match) -> None:
        self.match = match

    def record(self, match: Match, commands: Sequence[sim.PlayerCommand]) -> None:
        pass


@pytest.mark.perf  # timing: serial only, never under xdist
def test_snapshot_frame_costs_no_more_than_project() -> None:
    """#155: a snapshot per player per tick must not cost more than the ``project()`` before it.

    A ratio on the same machine, so no ``speed_factor``; ``REGRESSION`` as in the benchmarks.
    """
    mapdef = load_map(ROOT / "maps" / "fixtures" / "web.json")
    controllers = [BOTS["rusher"](mapdef, RULES, seed=1, player=p) for p in PLAYERS]
    keeper = _Keeper()
    run_headless(mapdef, RULES, controllers, max_ticks=300, match_key=KEY, observer=keeper)
    match = keeper.match
    view = match.view(0)

    def best(fn: Callable[[], object]) -> float:
        return min(timeit.repeat(fn, number=200, repeat=7))

    project_s = best(lambda: match.view(0))
    frame_s = best(lambda: snapshot_frame(view))
    assert frame_s <= project_s * REGRESSION, f"frame {frame_s / project_s:.2f} x project()"


def test_snapshot_frame_message_validates() -> None:
    """``SnapshotFrame.message()`` is the leak trap of the unvalidated frames (#155)."""
    match = _started()
    view = match.view(0)
    frame = snapshot_frame(view)
    assert frame.message() == snapshot_msg(view)
    data = json.loads(frame.frame)["view"]
    fog = next(n for n in data["nodes"] if n["detail"] == "fog")
    fog["warehouse"] = 5  # an enemy warehouse in the fog: DEC-04 forbids it
    with pytest.raises(ValidationError):
        encode_snapshot(view.tick, data).message()


# Commands ------------------------------------------------------------------------------------


def _fixture_command(name: str) -> wire.Command:
    msg = decode_client((CLIENT_FIXTURES / f"command_{name}.json").read_text(encoding="utf-8"))
    assert isinstance(msg, CommandMsg)
    return msg.cmd


def test_fixture_commands_convert() -> None:
    types = {
        "move": sim.Move,
        "move_planned": sim.Move,
        "split": sim.Split,
        "merge": sim.Merge,
        "set_mode": sim.SetMode,
        "set_stance": sim.SetStance,
        "upgrade_road": sim.UpgradeRoad,
        "recruit": sim.Recruit,
        "cancel_order": sim.CancelOrder,
        "set_front": sim.SetFront,
        "set_rear_min": sim.SetRearMin,
        "transfer": sim.Transfer,
        "forfeit": sim.Forfeit,
    }
    for name, kind in types.items():
        assert isinstance(command_from_wire(_fixture_command(name)), kind)
    move = _fixture_command("move_planned")
    assert isinstance(move, wire.MoveCmd)
    converted = command_from_wire(move)
    assert isinstance(converted, sim.Move)
    assert (converted.dest, converted.planned) == (move.dest, True)


def test_command_fields() -> None:
    assert command_from_wire(wire.MoveCmd(group="12", dest=3, planned=False)) == sim.Move(12, 3)
    assert command_from_wire(wire.SplitCmd(group="5", n=2)) == sim.Split(5, 2)
    assert command_from_wire(wire.MergeCmd(groups=("7", "9"))) == sim.Merge((7, 9))
    assert command_from_wire(wire.SetModeCmd(group="1", mode=Mode.DEFENSE)) == sim.SetMode(
        1, Mode.DEFENSE
    )
    assert command_from_wire(wire.UpgradeRoadCmd(edge=8)) == sim.UpgradeRoad(8)
    assert command_from_wire(wire.CancelOrderCmd(group="0")) == sim.CancelOrder(0)
    assert command_from_wire(wire.SetStanceCmd(stance=Stance.ECONOMY)) == sim.SetStance(
        Stance.ECONOMY
    )
    assert command_from_wire(wire.RecruitCmd(node=2)) == sim.Recruit(2)
    assert command_from_wire(wire.SetFrontCmd(marker=1, node=3)) == sim.SetFront(1, 3)
    assert command_from_wire(wire.SetFrontCmd(marker=0, node=None)) == sim.SetFront(0, None)
    assert command_from_wire(wire.SetRearMinCmd(n=4)) == sim.SetRearMin(4)
    assert command_from_wire(wire.TransferCmd(from_node=1, to_node=4, n=3)) == sim.Transfer(1, 4, 3)
    assert command_from_wire(wire.ForfeitCmd()) == sim.Forfeit()


@pytest.mark.parametrize(
    "text", ["abc", "_", "-1", "007", "00", "1e3", "9223372036854775808", "9" * 32]
)
def test_non_opaque_id_strings_name_nothing(text: str) -> None:
    assert opaque_from_wire(text) is None
    cmd = command_from_wire(wire.SplitCmd(group=text, n=1))
    assert isinstance(cmd, sim.Split)
    assert cmd.group < 0


def test_opaque_ids_round_trip() -> None:
    for oid in (0, 1, 42, 2**63 - 1):
        assert opaque_from_wire(opaque_to_wire(oid)) == oid
        assert len(opaque_to_wire(oid)) <= 19


def test_distinct_unknown_ids_stay_distinct() -> None:
    cmd = command_from_wire(wire.MergeCmd(groups=("x", "y", "x-1")))
    assert isinstance(cmd, sim.Merge)
    assert len(set(cmd.groups)) == 3
    assert all(g < 0 for g in cmd.groups)


def _started(name: str = "web") -> Match:
    match = Match(load_map(ROOT / "maps" / "fixtures" / f"{name}.json"), RULES, KEY)
    match.step()
    return match


def _ack_for(match: Match, player: int, cmd: wire.Command, seq: int = 1) -> str | None:
    match.step([sim.PlayerCommand(player, seq, match.resolve(player, command_from_wire(cmd)))])
    (result,) = match.results
    return ack_msg(result).reject_code


def test_unknown_and_enemy_ids_are_not_found_or_hidden() -> None:
    match = _started()
    enemy = snapshot_msg(match.view(1)).view.groups[0].id
    own = snapshot_msg(match.view(0)).view.groups[0].id
    internal = str(min(gid for gid, g in match.state.groups.items() if g.owner == 0))
    for text in ("abc", "007", "9" * 32, enemy, internal, str(int(own) ^ 1)):
        assert _ack_for(match, 0, wire.SplitCmd(group=text, n=1)) == NOT_FOUND
        assert _ack_for(match, 0, wire.MergeCmd(groups=(own, text))) == NOT_FOUND


def test_split_groups_merge_back_through_the_wire() -> None:
    """Split, then merge the pair by opaque ids from the snapshot (#212, the owner's report)."""
    match = _started()
    groups = snapshot_msg(match.view(0)).view.groups
    big = max(groups, key=lambda g: g.units)
    assert isinstance(big.location, AtNodeLoc)
    node = big.location.node
    assert _ack_for(match, 0, wire.SplitCmd(group=big.id, n=2), seq=1) is None
    match.step()
    here = [
        g
        for g in snapshot_msg(match.view(0)).view.groups
        if isinstance(g.location, AtNodeLoc) and g.location.node == node
    ]
    assert sorted(g.units for g in here) == [2, big.units - 2]
    assert _ack_for(match, 0, wire.MergeCmd(groups=tuple(g.id for g in here)), seq=2) is None
    after = [
        g
        for g in snapshot_msg(match.view(0)).view.groups
        if isinstance(g.location, AtNodeLoc) and g.location.node == node
    ]
    assert [g.units for g in after] == [big.units]


def test_move_ack_carries_the_path() -> None:
    match = _started()
    view = snapshot_msg(match.view(0)).view
    group = next(g for g in view.groups if isinstance(g.location, AtNodeLoc))
    assert isinstance(group.location, AtNodeLoc)
    start = group.location.node
    dest = next(n.id for n in view.nodes if n.owner != 0)
    cmd = command_from_wire(wire.MoveCmd(group=group.id, dest=dest, planned=False))
    match.step([sim.PlayerCommand(0, 7, match.resolve(0, cmd))])
    (result,) = match.results
    ack = ack_msg(result)
    assert (ack.seq, ack.applied_tick, ack.reject_code) == (7, match.tick, None)
    assert ack.path is not None
    assert (ack.path[0], ack.path[-1]) == (start, dest)
    moved = next(g for g in snapshot_msg(match.view(0)).view.groups if g.id == group.id)
    assert moved.order is not None
    assert moved.order.dest == dest


def test_supply_control_through_the_wire() -> None:
    """DEC-18, DEC-28: a front marker, the rear minimum and a transfer by wire commands; the ack
    carries the transfer's path and arrival tick, the frames carry the markers and the transfer
    packet (byte-equal frames), the enemy gets neither the events nor the fields."""
    match = _started()
    view = snapshot_msg(match.view(0)).view
    cities = [n.id for n in view.nodes if n.warehouse_level is not None]  # own cities
    capital = match.state.map.capital(0)
    far = max(
        (c for c in cities if c != capital),
        key=lambda c: len(find_path(match.state, RULES, 0, capital, c) or ()),
    )
    match.state.nodes[capital].warehouse = 5
    cmds = [
        command_from_wire(wire.SetFrontCmd(marker=1, node=far)),
        command_from_wire(wire.SetRearMinCmd(n=2)),
        command_from_wire(wire.TransferCmd(from_node=capital, to_node=far, n=3)),
    ]
    events = match.step([sim.PlayerCommand(0, i + 1, c) for i, c in enumerate(cmds)])
    acks = [ack_msg(r) for r in match.results]
    assert [a.reject_code for a in acks] == [None, None, None]
    assert acks[0].path is None and acks[0].arrive_tick is None
    path, arrive = acks[2].path, acks[2].arrive_tick
    assert path is not None and (path[0], path[-1]) == (capital, far) and len(path) > 2
    assert arrive is not None and arrive > match.tick
    own = events_msgs(events, 0, KEY)
    kinds = {"front_set", "rear_min_set", "transfer_started"}
    assert {m.kind for m in own} >= kinds
    assert not {m.kind for m in events_msgs(events, 1, KEY)} & kinds
    checker = _FrameChecker()
    checker.record(match, ())
    assert checker.features >= {"fronts", "transfer"}
    wire_view = snapshot_msg(match.view(0)).view
    batches = sorted((p for p in wire_view.packets if p.transfer), key=lambda p: p.dest_tick)
    assert {p.path[-1] for p in batches} == {far}
    # #287: cut to the free room of ``far`` (the event has the actual amount), sent in batches.
    n = next(e.get("charges") for e in events if e.kind == "transfer_started")
    assert (batches[-1].dest_tick, sum(p.charges for p in batches)) == (arrive, n)
    assert (wire_view.me.fronts[1], wire_view.me.rear_min) == (far, 2)
    enemy = snapshot_msg(match.view(1)).view
    assert (enemy.me.fronts, enemy.me.rear_min) == ((None, None), 1)  # its own, not player 0's
    assert not any(p.transfer for p in enemy.packets)


def test_starvation_countdown_through_the_wire() -> None:
    """DEC-19: the countdown of an own cut-off city in byte-equal frames; the enemy gets neither
    the field nor the event."""
    match = _started()
    state = match.state
    city = next(
        n for n in sorted(state.nodes) if state.nodes[n].owner == 0 and n != state.map.capital(0)
    )
    state.nodes[city].cut_since = match.tick
    checker = _FrameChecker()
    checker.record(match, ())
    assert "starve_in" in checker.features
    assert snapshot_msg(match.view(0)).view.nodes[city].starve_in is not None
    assert snapshot_msg(match.view(1)).view.nodes[city].starve_in is None
    starving = event(5, "starvation", player=0, node=city, warehouse=1, units=0)
    assert event_for_player(starving, 0, KEY) is not None
    assert event_for_player(starving, 1, KEY) is None


def test_ack_of_an_accepted_command_without_path() -> None:
    result = sim.CommandResult(player=0, seq=3, tick=9, outcome=sim.Ok(cost=100))
    ack = ack_msg(result)
    assert (ack.seq, ack.applied_tick, ack.path, ack.reject_code) == (3, 9, None, None)


# Events --------------------------------------------------------------------------------------


def test_event_policy() -> None:
    tick = 5
    own = event(tick, "recruited", player=0, node=1, group=17)
    msg = event_for_player(own, 0, KEY)
    assert msg is not None
    assert msg.data == {"player": 0, "node": 1, "group": str(opaque_id(KEY, 0, 17))}
    assert event_for_player(own, 1, KEY) is None
    stance = event(tick, "stance_changed", player=1, stance="war")
    assert event_for_player(stance, 0, KEY) is None
    lost = event(tick, "warehouse_lost", node=3, owner=1, charges=4)
    assert event_for_player(lost, 0, KEY) is None
    assert event_for_player(lost, 1, KEY) is not None
    captured = event(tick, "node_captured", node=3, player=1)
    for p in PLAYERS:
        got = event_for_player(captured, p, KEY)
        assert got is not None
        assert got.data == {"node": 3, "player": 1}
    assert event_for_player(event(tick, "match_ended", winner=0, reason="capital"), 0, KEY) is None
    assert event_for_player(event(tick, "brand_new_kind", player=0), 0, KEY) is None


def test_fight_events_show_the_rounds_of_both_sides() -> None:
    """DEC-24, I1 and I2 as revised with DEC-29 (#295): both players get the fight events whole:
    the shots of both sides with the virtual (bonus) ones apart, the spent charges and the
    losses. Nothing is cut out; only the fight id becomes the player's opaque id."""
    fight_round = event(
        17,
        "fight_round",
        fight=4,
        node=2,
        edge=None,
        point=None,
        shots_0=1,
        shots_1=1,
        virtual_0=0,
        virtual_1=1,
        losses_0=0,
        losses_1=0,
        spent_0=1,
        spent_1=0,
    )
    for p in PLAYERS:
        msg = event_for_player(fight_round, p, KEY)
        assert msg is not None
        assert msg.data == {
            "fight": str(opaque_id(KEY, p, 4)),
            "node": 2,
            "edge": None,
            "point": None,
            "shots_0": 1,
            "shots_1": 1,
            "virtual_0": 0,
            "virtual_1": 1,  # player 1's bonus shot is seen by player 0 too
            "losses_0": 0,
            "losses_1": 0,
            "spent_0": 1,
            "spent_1": 0,
        }
    ended = event(
        57,
        "fight_ended",
        fight=4,
        node=2,
        edge=None,
        point=None,
        winner=0,
        captured=True,
        start=7,
        shots_0=4,
        shots_1=1,
        losses_0=0,
        losses_1=2,
    )
    for p in PLAYERS:
        msg = event_for_player(ended, p, KEY)
        assert msg is not None
        assert (msg.data["shots_0"], msg.data["shots_1"]) == (4, 1)


# Match end -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("reason", "winner", "wire_reason"),
    [
        (SimEndReason.CAPITAL, 0, EndReason.CAPITAL_CAPTURED),
        (SimEndReason.FORFEIT, 1, EndReason.FORFEIT),
        (SimEndReason.VP, 0, EndReason.TIMER),
        (SimEndReason.CITIES, 1, EndReason.TIMER),
        (SimEndReason.DRAW, None, EndReason.TIMER),
        (SimEndReason.DOUBLE_DEFEAT, None, EndReason.DOUBLE_DEFEAT),
    ],
)
def test_match_end(reason: SimEndReason, winner: int | None, wire_reason: EndReason) -> None:
    msg = match_end_msg(Outcome(winner, reason), 7200, (10, 12))
    assert msg == MatchEndMsg(tick=7200, reason=wire_reason, winner=winner, vp=(10, 12))
    assert decode_server(encode(msg)) == msg


def test_match_end_disconnect() -> None:
    msg = match_end_msg(Outcome(0, SimEndReason.FORFEIT), 100, (1, 0), disconnect=True)
    assert msg.reason is EndReason.DISCONNECT
    capital = match_end_msg(Outcome(0, SimEndReason.CAPITAL), 100, (1, 0), disconnect=True)
    assert capital.reason is EndReason.CAPITAL_CAPTURED


def test_forfeit_ends_the_match_on_the_wire() -> None:
    match = _started()
    assert _ack_for(match, 1, wire.ForfeitCmd()) is None
    assert match.outcome is not None
    msg = match_end_msg(match.outcome, match.tick, [match.state.players[p].vp for p in PLAYERS])
    assert (msg.reason, msg.winner) == (EndReason.FORFEIT, 0)


# Reach (DEC-20, D5) ----------------------------------------------------------------------------


@pytest.mark.parametrize("name", MVP_MAPS)
def test_reach_msg_promises_what_a_move_gets(name: str) -> None:
    """Every ``reach`` node is a move the simulation accepts, arriving after ``ticks``; every
    ``split`` node is ``STACK_LIMIT``. A foreign or unknown group gets empty lists."""
    match = Match(load_map(ROOT / "maps" / "fixtures" / f"{name}.json"), RULES, KEY)
    match.step()
    for player in PLAYERS:
        for g in match.view(player).groups:
            wire_id = opaque_to_wire(g.id)
            msg = reach_msg(wire_id, match.tick, match.reach(player, g.id))
            assert decode_server(encode(msg)) == msg
            assert msg.nodes, "the start garrison can go somewhere"
            for rn in msg.nodes:
                cmd = match.resolve(player, sim.Move(g.id, rn.node))
                ok = sim.validate(match.state, RULES, player, cmd)
                assert isinstance(ok, sim.Ok)
                assert ok.arrive_tick == match.tick + rn.ticks - 1
                assert rn.path == ok.path  # #448: the path of the ack
            for node in msg.split:
                cmd = match.resolve(player, sim.Move(g.id, node))
                assert sim.validate(match.state, RULES, player, cmd) == sim.Reject(
                    sim.RejectCode.STACK_LIMIT
                )
            enemy = reach_msg(wire_id, match.tick, match.reach(1 - player, g.id))
            assert (enemy.nodes, enemy.split) == ((), ())
    assert reach_msg("x", 1, None).nodes == ()


class _ReachChecker:
    """``MatchObserver``: every ``every`` ticks, the ``reach`` of each standing own group carries
    the path the ``ack`` of a move there would (#448) and names only nodes the player knows."""

    def __init__(self, every: int = 25) -> None:
        self.every = every
        self.longest = 0
        self.acked = 0

    def begin(self, match: Match) -> None:
        pass

    def record(self, match: Match, commands: Sequence[sim.PlayerCommand]) -> None:
        if match.tick % self.every:
            return
        for player in PLAYERS:
            view = match.view(player)
            for g in view.groups:
                if not isinstance(g.location, AtNode):
                    continue
                msg = reach_msg(opaque_to_wire(g.id), match.tick, match.reach(player, g.id))
                for rn in msg.nodes:
                    # the search ``validate`` runs for a ``Move`` (its CP and fight checks aside:
                    # a bot may have spent its CP, a group may stand in a fight)
                    here = g.location.node
                    size = g.units
                    assert rn.path == find_path(
                        match.state, RULES, player, here, rn.node, size=size
                    )
                    ok = sim.validate(
                        match.state, RULES, player, match.resolve(player, sim.Move(g.id, rn.node))
                    )
                    if isinstance(ok, sim.Ok):
                        assert rn.path == ok.path
                        self.acked += 1
                    assert rn.path[0] == g.location.node and rn.path[-1] == rn.node
                    # fog: every node the path passes is one the player owns (its own view says
                    # so); only the destination may be foreign, and it is in ``reach`` anyway
                    assert all(view.nodes[n].owner == player for n in rn.path[1:-1])
                    self.longest = max(self.longest, len(rn.path))


def test_reach_paths_of_a_bot_match_are_the_ack_paths_and_hide_nothing() -> None:
    """#448 over a played match: own territory grows, so the paths get longer than one road."""
    mapdef = load_map(ROOT / "maps" / "fixtures" / "artery.json")
    controllers = [
        BOTS[bot](mapdef, RULES, seed=7, player=p) for p, bot in enumerate(("rusher", "turtle"))
    ]
    checker = _ReachChecker()
    run_headless(mapdef, RULES, controllers, max_ticks=BOT_TICKS, match_key=KEY, observer=checker)
    assert checker.longest >= 4, "some path crosses at least two own nodes"
    assert checker.acked, "some of them were checked against an accepted move"
