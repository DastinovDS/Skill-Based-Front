"""Converters sim <-> wire (PRO-03 #46): real matches on the MVP maps, fixtures, and leak checks.

A client-side driver plays each MVP map through the wire only: it reads the ``snapshot`` it got,
sends wire commands with string ids, and the server side converts them (``command_from_wire``,
``Match.resolve``), steps the match and converts the view, the acks and the events back. Every
message must validate, round-trip through the codec, match the ``PlayerView`` field by field, and
never carry anything of the enemy the view does not show.
"""

import json
from collections import deque
from pathlib import Path
from typing import Any

import pytest

from gow_protocol import commands as wire
from gow_protocol.codec import decode_client, decode_server, encode
from gow_protocol.convert import (
    ENTITY_KEYS,
    PRIVATE_KINDS,
    PUBLIC_KINDS,
    ack_msg,
    command_from_wire,
    event_for_player,
    events_msgs,
    match_end_msg,
    opaque_from_wire,
    opaque_to_wire,
    snapshot_msg,
)
from gow_protocol.messages import CommandMsg, EndReason, EventMsg, MatchEndMsg, SnapshotMsg
from gow_protocol.view import AtNodeLoc, View
from gow_sim import commands as sim
from gow_sim.maps import PLAYERS, MapDef, load_map
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset, Stance, load_ruleset
from gow_sim.state import Event, Mode, event
from gow_sim.systems.victory import EndReason as SimEndReason
from gow_sim.systems.victory import Outcome
from gow_sim.view import PlayerView, opaque_id, view_to_canonical

ROOT = Path(__file__).resolve().parents[3]
RULES = load_ruleset(ROOT / "rulesets" / "mvp-0.toml")
MVP_MAPS = ("arteriya", "pautina", "pereval")
CLIENT_FIXTURES = ROOT / "packages" / "protocol" / "fixtures" / "client"
KEY = b"pro-03 test match key, 32 bytes!"
TICKS = 1500

NOT_FOUND = sim.RejectCode.NOT_FOUND_OR_HIDDEN.value
DROPPED_GROUP_KEYS = ("build_edge",)
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
            if phase == 21:
                gains = [
                    e for e in self.map.incident[here] if view.edges[e].upgrade_gain is not None
                ]
                if gains:
                    cmds.append(wire.UpgradeRoadCmd(group=g.id, edge=gains[0]))
                    continue
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
    for key in ("groups", "packets", "intents"):
        for entity in data[key]:
            entity["id"] = str(entity["id"])
    for group in data["groups"]:
        for name in DROPPED_GROUP_KEYS:
            del group[name]
        if group["order"] is not None:
            for name in DROPPED_ORDER_KEYS:
                del group["order"][name]
        for name in DROPPED_LOCATION_KEYS:
            group["location"].pop(name, None)
    return data


def _check_snapshot(match: Match, player: int) -> SnapshotMsg:
    view = match.view(player)
    msg = snapshot_msg(view)
    frame = encode(msg)
    assert decode_server(frame) == msg
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
            assert raw.kind in PUBLIC_KINDS or raw.kind == "fight"
        if raw.kind == "fight":
            other = 1 - player
            assert f"pool_{other}" not in msg.data
            assert f"unspent_{other}" not in msg.data
            assert msg.data[f"losses_{other}"] == data[f"losses_{other}"]
        for key, value in msg.data.items():
            if key in ENTITY_KEYS:
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
    mapdef = load_map(ROOT / "maps" / f"{name}.json")
    match = Match(mapdef, RULES, KEY)
    drivers = [WireDriver(mapdef, RULES, p) for p in PLAYERS]
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
    assert kinds <= PUBLIC_KINDS | PRIVATE_KINDS | {"fight", "match_ended"}
    assert {"fight", "fight_group", "recruited", "node_captured"} <= kinds
    assert all(acks.values())


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
    assert command_from_wire(wire.SetModeCmd(group="1", mode=Mode.BUILD)) == sim.SetMode(
        1, Mode.BUILD
    )
    assert command_from_wire(wire.UpgradeRoadCmd(group="4", edge=8)) == sim.UpgradeRoad(4, 8)
    assert command_from_wire(wire.CancelOrderCmd(group="0")) == sim.CancelOrder(0)
    assert command_from_wire(wire.SetStanceCmd(stance=Stance.ECONOMY)) == sim.SetStance(
        Stance.ECONOMY
    )
    assert command_from_wire(wire.RecruitCmd(node=2)) == sim.Recruit(2)
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


def _started(name: str = "pautina") -> Match:
    match = Match(load_map(ROOT / "maps" / f"{name}.json"), RULES, KEY)
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


def test_fight_hides_the_enemy_charges() -> None:
    fight = event(
        7,
        "fight",
        node=2,
        edge=None,
        attacker=1,
        pool_0=5,
        pool_1=3,
        unspent_0=2,
        unspent_1=0,
        losses_0=1,
        losses_1=3,
    )
    for p in PLAYERS:
        msg = event_for_player(fight, p, KEY)
        assert msg is not None
        o = 1 - p
        assert msg.data == {
            "node": 2,
            "edge": None,
            "attacker": 1,
            f"pool_{p}": dict(fight.data)[f"pool_{p}"],
            f"unspent_{p}": dict(fight.data)[f"unspent_{p}"],
            "losses_0": 1,
            "losses_1": 3,
        }
        assert f"pool_{o}" not in msg.data


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
