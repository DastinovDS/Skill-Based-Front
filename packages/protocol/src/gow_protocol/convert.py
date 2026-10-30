"""Converters between the simulation and the wire messages (PRO-03 #46).

Server -> client:

- ``snapshot_msg``: ``PlayerView`` (``gow_sim.view.project()``) -> ``snapshot``. Opaque ids are
  63-bit integers in the simulation and decimal strings on the wire. Some fields of the view stay
  on the server, the client does not need them: ``order.depart_tick`` and ``location.back`` (a
  bouncing group's ``progress`` falls, so interpolation works without it). Enemy figures
  (``EdgeView.enemy_groups``, DEC-33) get wire ids like own entities; a range of units is an
  object ``{low, high}``;
- ``snapshot_frame``: the same ``snapshot`` encoded straight from the ``PlayerView``, without the
  models and their validation (#155). The server sends these every tick; ``snapshot_msg``, built
  through the validating models, is their specification: tests over real matches require the two
  frames to be equal byte for byte (``test_convert.py``), and the server outside ``prod``
  validates every frame it sends (``MatchRunner(validate_snapshots=True)``);
- ``ack_msg``: ``CommandResult`` -> ``ack`` (``path`` and ``arrive_tick`` of an accepted ``Move``
  or ``Transfer``, ``reject_code``);
- ``reach_msg``: ``gow_sim.view.Reach`` (``Match.reach``) -> ``reach`` (DEC-20, D5);
- ``events_msgs``: the events of a tick -> the ``event`` messages one player may see (below);
- ``match_end_msg``: ``Outcome`` -> ``match_end``.

Client -> server: ``command_from_wire`` turns a wire command into a simulation command that still
carries opaque ids (integers); ``gow_sim.view.resolve()`` (``Match.resolve``) maps them to internal
ids. An id string that is not the canonical decimal form of a 63-bit integer can name no entity:
it becomes a negative id, which ``resolve()`` keeps unknown, so ``validate()`` answers
``NOT_FOUND_OR_HIDDEN`` as for any other unknown id and never crashes.

Which events a player sees (AGENTS.md, section 4.4: nothing about the enemy's CP, stance,
production, counters or groups, no fights and supply in the fog). Unknown kinds are never sent:

- public: ``node_captured`` (ownership is public), ``vp_awarded`` (VP are public), ``forfeit``;
- ``fight_started``, ``fight_round``, ``fight_ended`` (DEC-24, item I2): to both players, they
  both fight in it, with every field: the rounds of both sides are public (shots with the virtual
  ones apart, spent charges, losses; I1 and I2 as revised with DEC-29);
- everything else only to the player of the event (``player``, for ``warehouse_lost`` ``owner``),
  enemy ones are dropped. ``fight_group`` goes only to the owner of the group; the build
  events ``build_started``, ``road_upgraded``, ``barracks_built``, ``warehouse_upgraded`` and
  ``build_stopped`` only to the builder (DEC-17, item 6; DEC-26, item 9); ``front_set``,
  ``rear_min_set`` (DEC-28) and ``transfer_started`` only to their player (DEC-18, item 8);
  ``starvation`` only to the owner of the city (DEC-19, item 8); ``capture_failed`` only to the
  player whose group could not pay for a capture (DEC-38, item 10);
- ``match_ended`` is not an event on the wire: it is ``match_end``.

Entity ids in event data (``group``, ``new_group``, ``packet``, ``fight``) become opaque ids of
the player; only events about the player's own entities and own fights carry them.

The simulation's ``victory.EndReason`` is finer than the wire's: ``vp``, ``cities`` and ``draw``
are all ``timer``; ``double_defeat`` (both players lost in one tick, #136) is its own reason.
"""

import re
from collections.abc import Iterable, Mapping, Sequence
from typing import Final

from gow_protocol import commands as wire
from gow_protocol.codec import SnapshotFrame, encode_snapshot
from gow_protocol.messages import (
    AckMsg,
    Calibration,
    EndReason,
    EventMsg,
    MatchEndMsg,
    MatchEndStats,
    RatingChange,
    ReachMsg,
    ReachNode,
    SnapshotMsg,
    UnratedReason,
)
from gow_protocol.view import (
    AtNodeLoc,
    EdgeBuild,
    EdgeView,
    EnemyGroup,
    FightRoundView,
    FightView,
    GroupView,
    HalfView,
    IntentView,
    Location,
    NodeBuilding,
    NodeView,
    OnEdgeLoc,
    OrderView,
    PacketView,
    Seen,
    SelfView,
    UnitsRange,
    UpgradeGain,
    View,
)
from gow_sim import commands as sim
from gow_sim import view as sv
from gow_sim.state import Event, EventValue
from gow_sim.systems.victory import EndReason as SimEndReason
from gow_sim.systems.victory import Outcome

__all__ = [
    "EVENT_FIELDS",
    "EVENT_ID_FIELDS",
    "FIGHT_KINDS",
    "PRIVATE_KINDS",
    "PUBLIC_KINDS",
    "ack_msg",
    "command_from_wire",
    "event_for_player",
    "events_msgs",
    "match_end_msg",
    "opaque_from_wire",
    "opaque_to_wire",
    "reach_msg",
    "snapshot_frame",
    "snapshot_msg",
    "view_to_wire",
]

_OPAQUE_LIMIT: Final = 2**63
_DECIMAL: Final = re.compile(r"0|[1-9][0-9]{0,18}")

PUBLIC_KINDS: Final = frozenset({"node_captured", "vp_awarded", "forfeit"})
"""Events every player gets as they are."""

PRIVATE_KINDS: Final = frozenset(
    {
        "attrition",
        "barracks_built",
        "build_started",
        "build_stopped",
        "capture_failed",
        "charges_overflow",
        "charges_produced",
        "cp_burned",
        "fight_group",
        "front_set",
        "group_arrived",
        "group_split",
        "groups_merged",
        "packet_delivered",
        "packet_lost",
        "packet_sent",
        "rear_min_set",
        "recruit_cancelled",
        "recruit_queue_lost",
        "recruited",
        "road_upgraded",
        "stance_changed",
        "starvation",
        "transfer_started",
        "warehouse_lost",
        "warehouse_upgraded",
    }
)
"""Events only their own player gets."""

FIGHT_KINDS: Final = frozenset({"fight_started", "fight_round", "fight_ended"})
"""Events of a fight (DEC-24): both players get them whole (item I2 as revised with DEC-29)."""

EVENT_FIELDS: Final[Mapping[str, tuple[str, ...]]] = {
    "attrition": ("charged", "destroyed", "group", "node", "player"),
    "barracks_built": ("node", "player"),
    "build_started": ("edge", "kind", "level", "node", "player", "width"),
    "build_stopped": ("edge", "kind", "node", "player", "reason"),
    "capture_failed": ("group", "node", "player", "result"),
    "charges_overflow": ("charges", "node", "player"),
    "charges_produced": ("charges", "node", "player", "spill"),
    "cp_burned": ("cp", "player"),
    "fight_ended": (
        "attacker",
        "captured",
        "edge",
        "fight",
        "losses_0",
        "losses_1",
        "node",
        "point",
        "shots_0",
        "shots_1",
        "start",
        "winner",
    ),
    "fight_group": (
        "arrived",
        "bounce",
        "charged",
        "charged_before",
        "destroyed",
        "encircled",
        "group",
        "left",
        "player",
        "units",
        "units_before",
    ),
    "fight_round": (
        "edge",
        "fight",
        "losses_0",
        "losses_1",
        "node",
        "point",
        "shots_0",
        "shots_1",
        "spent_0",
        "spent_1",
        "virtual_0",
        "virtual_1",
    ),
    "fight_started": ("attacker", "edge", "fight", "node", "point"),
    "forfeit": ("player",),
    "front_set": ("marker", "node", "player", "reason"),
    "group_arrived": (
        "back",
        "edge",
        "from_node",
        "group",
        "level",
        "node",
        "planned",
        "player",
    ),
    "group_split": ("group", "new_group", "player", "units"),
    "groups_merged": ("group", "node", "player", "units"),
    "node_captured": ("node", "player"),
    "packet_delivered": ("charges", "node", "packet", "player"),
    "packet_lost": ("charges", "edge", "packet", "player"),
    "packet_sent": ("charges", "edge", "from_node", "packet", "player", "to_node"),
    "rear_min_set": ("n", "player"),
    "recruit_cancelled": ("cp", "node", "player"),
    "recruit_queue_lost": ("node", "player", "units"),
    "recruited": ("group", "node", "player"),
    "road_upgraded": ("edge", "player", "width"),
    "stance_changed": ("player", "stance"),
    "starvation": ("node", "player", "units", "warehouse"),
    "transfer_started": ("arrive_tick", "charges", "from_node", "packet", "player", "to_node"),
    "vp_awarded": ("player", "vp"),
    "warehouse_lost": ("charges", "node", "owner"),
    "warehouse_upgraded": ("level", "node", "player"),
}
"""The fields of each event kind the server sends to a player (ARC-02, #457), alphabetical.

``event_for_player`` drops every other field of a simulation event, so a field a rule change
adds reaches nobody until it is declared here. Declaring one is a fog decision: a field of a
public or fight kind goes to the opponent (AGENTS.md 4.4), so it needs a fog test.
``vectors/event_fields.json`` is written from this table (``scripts/export_schema.py``), and the
client tests check the fields they read against it. ``tests/test_event_fields.py`` checks the table
against the emitters in ``gow_sim``."""

EVENT_ID_FIELDS: Final[Mapping[str, frozenset[str]]] = {
    "attrition": frozenset({"group"}),
    "capture_failed": frozenset({"group"}),
    "fight_ended": frozenset({"fight"}),
    "fight_group": frozenset({"group"}),
    "fight_round": frozenset({"fight"}),
    "fight_started": frozenset({"fight"}),
    "group_arrived": frozenset({"group"}),
    "group_split": frozenset({"group", "new_group"}),
    "groups_merged": frozenset({"group"}),
    "packet_delivered": frozenset({"packet"}),
    "packet_lost": frozenset({"packet"}),
    "packet_sent": frozenset({"packet"}),
    "recruited": frozenset({"group"}),
    "transfer_started": frozenset({"packet"}),
}
"""The fields of an event kind that hold an internal entity id (a subset of ``EVENT_FIELDS``).
They go out as the receiving player's opaque ids (``view.opaque_id``); no other field is
translated, so an id under an undeclared name never reaches a player as the internal number."""


# Ids -----------------------------------------------------------------------------------------


def opaque_to_wire(oid: int) -> str:
    """An opaque id of the simulation as a wire id: its decimal form."""
    return str(oid)


def opaque_from_wire(text: str) -> int | None:
    """The opaque id a wire id names, or ``None`` if it is not a canonical 63-bit decimal."""
    if _DECIMAL.fullmatch(text) is None:
        return None
    value = int(text)
    return value if value < _OPAQUE_LIMIT else None


# Snapshot ------------------------------------------------------------------------------------


def snapshot_msg(view: sv.PlayerView) -> SnapshotMsg:
    return SnapshotMsg(tick=view.tick, view=view_to_wire(view))


def view_to_wire(view: sv.PlayerView) -> View:
    vp = view.vp
    return View(
        me=SelfView(
            cp=view.me.cp,
            stance=view.me.stance,
            fronts=view.me.fronts,
            rear_min=view.me.rear_min,
        ),
        vp=(vp[0], vp[1]),
        nodes=tuple(
            NodeView(
                id=n.id,
                owner=n.owner,
                capacity=n.capacity,
                detail=n.detail,
                warehouse=n.warehouse,
                seen=_seen(n.seen),
                attrition_in=n.attrition_in,
                grace_left=n.grace_left,
                starve_in=n.starve_in,
                recruit_queue=n.recruit_queue,
                recruit_progress=n.recruit_progress,
                recruit_waiting=n.recruit_waiting,
                has_barracks=n.has_barracks,
                warehouse_level=n.warehouse_level,
                warehouse_cap=n.warehouse_cap,
                building=None
                if n.building is None
                else NodeBuilding(kind=n.building.kind, done_tick=n.building.done_tick),
            )
            for n in view.nodes
        ),
        edges=tuple(
            EdgeView(
                id=e.id,
                width=e.width,
                detail=e.detail,
                upgrade_gain=None
                if e.upgrade_gain is None
                else UpgradeGain(
                    speed_pct=e.upgrade_gain.speed_pct,
                    unit_speed_pct=e.upgrade_gain.unit_speed_pct,
                    amount=e.upgrade_gain.amount,
                ),
                halves=(_half(e.halves[0]), _half(e.halves[1])),
                build=None if e.build is None else EdgeBuild(done_tick=e.build.done_tick),
                enemy_groups=tuple(
                    EnemyGroup(
                        id=opaque_to_wire(f.id),
                        pos=f.pos,
                        toward_b=f.toward_b,
                        detail=f.detail,
                        mode=f.mode,
                        units=f.units,
                        charged=f.charged,
                        units_range=_range(f.units_range),
                    )
                    for f in e.enemy_groups
                ),
            )
            for e in view.edges
        ),
        groups=tuple(
            GroupView(
                id=opaque_to_wire(g.id),
                units=g.units,
                charged=g.charged,
                mode=g.mode,
                location=_location(g.location),
                order=None
                if g.order is None
                else OrderView(
                    dest=g.order.dest,
                    path=g.order.path,
                    planned=g.order.planned,
                    bonus=g.order.bonus,
                ),
                defense_bonus=g.defense_bonus,
                defense_cap=g.defense_cap,
            )
            for g in view.groups
        ),
        packets=tuple(
            PacketView(
                id=opaque_to_wire(p.id),
                edge=p.edge,
                from_node=p.from_node,
                charges=p.charges,
                depart_tick=p.depart_tick,
                arrive_tick=p.arrive_tick,
                path=p.path,
                dest_tick=p.dest_tick,
                transfer=p.transfer,
            )
            for p in view.packets
        ),
        intents=tuple(
            IntentView(
                id=opaque_to_wire(i.id),
                owner=i.owner,
                kind=i.kind,
                origin=i.origin,
                target=i.target,
                created_tick=i.created_tick,
            )
            for i in view.intents
        ),
        fights=tuple(
            FightView(
                id=opaque_to_wire(f.id),
                node=f.node,
                edge=f.edge,
                point=f.point,
                attacker=f.attacker,
                start_tick=f.start_tick,
                next_round_tick=f.next_round_tick,
                groups=tuple(opaque_to_wire(g) for g in f.groups),
                enemy_units=f.enemy_units,
                enemy_charged=f.enemy_charged,
                shots=f.shots,
                losses=f.losses,
                virtual_left=f.virtual_left,
                mute=f.mute,
                last_round=None
                if f.last_round is None
                else FightRoundView(
                    tick=f.last_round.tick,
                    shots=f.last_round.shots,
                    virtual=f.last_round.virtual,
                    spent=f.last_round.spent,
                    losses=f.last_round.losses,
                ),
            )
            for f in view.fights
        ),
    )


def _seen(s: sv.Sighting | None) -> Seen | None:
    if s is None:
        return None
    return Seen(
        tick=s.tick,
        level=s.level,
        enemy_modes=s.enemy_modes,
        enemy_units=s.enemy_units,
        enemy_charged=s.enemy_charged,
        enemy_range=_range(s.enemy_range),
    )


def _half(h: sv.HalfView) -> HalfView:
    return HalfView(detail=h.detail, seen=_seen(h.seen))


def _range(r: tuple[int, int | None] | None) -> UnitsRange | None:
    return None if r is None else UnitsRange(low=r[0], high=r[1])


def _location(loc: sv.Location) -> Location:
    match loc:
        case sv.AtNode(node=node):
            return AtNodeLoc(node=node)
        case sv.OnEdge(edge=edge, from_node=from_node, progress=progress):
            return OnEdgeLoc(edge=edge, from_node=from_node, progress=progress)


# Snapshot frame (#155) -----------------------------------------------------------------------
# The same fields as ``view_to_wire``, in the same order, as plain JSON data. Enum members go in as
# they are: they are ``StrEnum``, and ``json`` writes a ``str`` subclass as its value.


def snapshot_frame(view: sv.PlayerView) -> SnapshotFrame:
    """The encoded ``snapshot`` of a view: ``encode(snapshot_msg(view))`` without validation."""
    return encode_snapshot(view.tick, _view_data(view))


def _view_data(view: sv.PlayerView) -> dict[str, object]:
    me = view.me
    return {
        "me": {
            "cp": me.cp,
            "stance": me.stance,
            "fronts": list(me.fronts),
            "rear_min": me.rear_min,
        },
        "vp": view.vp[:2],
        "nodes": [
            {
                "id": n.id,
                "owner": n.owner,
                "capacity": n.capacity,
                "detail": n.detail,
                "warehouse": n.warehouse,
                "seen": _seen_data(n.seen),
                "attrition_in": n.attrition_in,
                "grace_left": n.grace_left,
                "starve_in": n.starve_in,
                "recruit_queue": n.recruit_queue,
                "recruit_progress": n.recruit_progress,
                "recruit_waiting": n.recruit_waiting,
                "has_barracks": n.has_barracks,
                "warehouse_level": n.warehouse_level,
                "warehouse_cap": n.warehouse_cap,
                "building": None
                if n.building is None
                else {"kind": n.building.kind, "done_tick": n.building.done_tick},
            }
            for n in view.nodes
        ],
        "edges": [
            {
                "id": e.id,
                "width": e.width,
                "detail": e.detail,
                "upgrade_gain": None
                if e.upgrade_gain is None
                else {
                    "speed_pct": e.upgrade_gain.speed_pct,
                    "unit_speed_pct": e.upgrade_gain.unit_speed_pct,
                    "amount": e.upgrade_gain.amount,
                },
                "halves": [{"detail": h.detail, "seen": _seen_data(h.seen)} for h in e.halves],
                "build": None if e.build is None else {"done_tick": e.build.done_tick},
                "enemy_groups": [
                    {
                        "id": opaque_to_wire(f.id),
                        "pos": f.pos,
                        "toward_b": f.toward_b,
                        "detail": f.detail,
                        "mode": f.mode,
                        "units": f.units,
                        "charged": f.charged,
                        "units_range": _range_data(f.units_range),
                    }
                    for f in e.enemy_groups
                ],
            }
            for e in view.edges
        ],
        "groups": [
            {
                "id": opaque_to_wire(g.id),
                "units": g.units,
                "charged": g.charged,
                "mode": g.mode,
                "location": _location_data(g.location),
                "order": None
                if g.order is None
                else {
                    "dest": g.order.dest,
                    "path": g.order.path,
                    "planned": g.order.planned,
                    "bonus": g.order.bonus,
                },
                "defense_bonus": g.defense_bonus,
                "defense_cap": g.defense_cap,
            }
            for g in view.groups
        ],
        "packets": [
            {
                "id": opaque_to_wire(p.id),
                "edge": p.edge,
                "from_node": p.from_node,
                "charges": p.charges,
                "depart_tick": p.depart_tick,
                "arrive_tick": p.arrive_tick,
                "path": p.path,
                "dest_tick": p.dest_tick,
                "transfer": p.transfer,
            }
            for p in view.packets
        ],
        "intents": [
            {
                "id": opaque_to_wire(i.id),
                "owner": i.owner,
                "kind": i.kind,
                "origin": i.origin,
                "target": i.target,
                "created_tick": i.created_tick,
            }
            for i in view.intents
        ],
        "fights": [
            {
                "id": opaque_to_wire(f.id),
                "node": f.node,
                "edge": f.edge,
                "point": f.point,
                "attacker": f.attacker,
                "start_tick": f.start_tick,
                "next_round_tick": f.next_round_tick,
                "groups": [opaque_to_wire(g) for g in f.groups],
                "enemy_units": f.enemy_units,
                "enemy_charged": f.enemy_charged,
                "shots": list(f.shots),
                "losses": list(f.losses),
                "virtual_left": list(f.virtual_left),
                "mute": list(f.mute),
                "last_round": _round_data(f.last_round),
            }
            for f in view.fights
        ],
    }


def _round_data(r: sv.FightRound | None) -> dict[str, object] | None:
    if r is None:
        return None
    return {
        "tick": r.tick,
        "shots": list(r.shots),
        "virtual": list(r.virtual),
        "spent": list(r.spent),
        "losses": list(r.losses),
    }


def _seen_data(s: sv.Sighting | None) -> dict[str, object] | None:
    if s is None:
        return None
    return {
        "tick": s.tick,
        "level": s.level,
        "enemy_modes": s.enemy_modes,
        "enemy_units": s.enemy_units,
        "enemy_charged": s.enemy_charged,
        "enemy_range": _range_data(s.enemy_range),
    }


def _range_data(r: tuple[int, int | None] | None) -> dict[str, object] | None:
    return None if r is None else {"low": r[0], "high": r[1]}


def _location_data(loc: sv.Location) -> dict[str, object]:
    match loc:
        case sv.AtNode(node=node):
            return {"kind": "node", "node": node}
        case sv.OnEdge(edge=edge, from_node=from_node, progress=progress):
            return {"kind": "edge", "edge": edge, "from_node": from_node, "progress": progress}


# Commands ------------------------------------------------------------------------------------


def command_from_wire(cmd: wire.Command) -> sim.Command:
    """The simulation command of a wire command, with opaque ids; resolve it before ``step``."""
    unknown: dict[str, int] = {}

    def gid(text: str) -> int:
        oid = opaque_from_wire(text)
        if oid is not None:
            return oid
        return unknown.setdefault(text, -1 - len(unknown))

    match cmd:
        case wire.MoveCmd(group=g, dest=dest, planned=planned):
            return sim.Move(gid(g), dest, planned)
        case wire.SplitCmd(group=g, n=n):
            return sim.Split(gid(g), n)
        case wire.MergeCmd(groups=groups):
            return sim.Merge(tuple(gid(g) for g in groups))
        case wire.SetModeCmd(group=g, mode=mode):
            return sim.SetMode(gid(g), mode)
        case wire.SetStanceCmd(stance=stance):
            return sim.SetStance(stance)
        case wire.UpgradeRoadCmd(edge=edge):
            return sim.UpgradeRoad(edge)
        case wire.BuildBarracksCmd(node=node):
            return sim.BuildBarracks(node)
        case wire.UpgradeWarehouseCmd(node=node):
            return sim.UpgradeWarehouse(node)
        case wire.RecruitCmd(node=node):
            return sim.Recruit(node)
        case wire.CancelRecruitCmd(node=node):
            return sim.CancelRecruit(node)
        case wire.CancelOrderCmd(group=g):
            return sim.CancelOrder(gid(g))
        case wire.SetFrontCmd(marker=marker, node=node):
            return sim.SetFront(marker, node)
        case wire.SetRearMinCmd(n=n):
            return sim.SetRearMin(n)
        case wire.TransferCmd(from_node=src, to_node=dst, n=n):
            return sim.Transfer(src, dst, n)
        case wire.ForfeitCmd():
            return sim.Forfeit()


def ack_msg(result: sim.CommandResult) -> AckMsg:
    """``ack`` of a command result; ``result.seq`` is the client's ``seq``."""
    match result.outcome:
        case sim.Ok(path=path, arrive_tick=arrive_tick):
            return AckMsg(
                seq=result.seq,
                applied_tick=result.tick,
                path=path or None,
                arrive_tick=arrive_tick,
            )
        case sim.Reject(code=code):
            return AckMsg(seq=result.seq, applied_tick=result.tick, reject_code=code.value)


def reach_msg(group: str, tick: int, reach: sv.Reach | None) -> ReachMsg:
    """``reach`` for the wire id ``group`` after tick ``tick``; ``None``: empty lists."""
    if reach is None:
        return ReachMsg(group=group, tick=tick, nodes=(), split=())
    return ReachMsg(
        group=group,
        tick=tick,
        nodes=tuple(ReachNode(node=n, ticks=t, path=p) for n, t, p in reach.nodes),
        split=reach.split,
    )


# Events --------------------------------------------------------------------------------------


def events_msgs(events: Iterable[Event], player: int, match_key: bytes) -> list[EventMsg]:
    """The ``event`` messages of ``player`` for the events of a tick, in their order."""
    out: list[EventMsg] = []
    for e in events:
        msg = event_for_player(e, player, match_key)
        if msg is not None:
            out.append(msg)
    return out


def event_for_player(e: Event, player: int, match_key: bytes) -> EventMsg | None:
    """The ``event`` message of ``e`` for ``player``, or ``None`` if the player must not see it.

    Only the fields ``EVENT_FIELDS`` declares for the kind go out (ARC-02, #457).
    """
    data = dict(e.data)
    if e.kind in PRIVATE_KINDS:
        owner = data["owner"] if e.kind == "warehouse_lost" else data["player"]
        if owner != player:
            return None
    elif e.kind not in PUBLIC_KINDS and e.kind not in FIGHT_KINDS:
        return None
    return EventMsg(tick=e.tick, kind=e.kind, data=_wire_data(e.kind, data, player, match_key))


def _wire_data(
    kind: str, data: dict[str, EventValue], player: int, match_key: bytes
) -> dict[str, EventValue]:
    fields = EVENT_FIELDS[kind]
    ids = EVENT_ID_FIELDS.get(kind, frozenset())
    out: dict[str, EventValue] = {}
    for key, value in data.items():
        if key not in fields:
            continue
        if key in ids and isinstance(value, int) and not isinstance(value, bool):
            out[key] = opaque_to_wire(sv.opaque_id(match_key, player, value))
        else:
            out[key] = value
    return out


# Match end -----------------------------------------------------------------------------------

_END_REASONS: Final = {
    SimEndReason.CAPITAL: EndReason.CAPITAL_CAPTURED,
    SimEndReason.FORFEIT: EndReason.FORFEIT,
    SimEndReason.VP: EndReason.TIMER,
    SimEndReason.CITIES: EndReason.TIMER,
    SimEndReason.DRAW: EndReason.TIMER,
    SimEndReason.DOUBLE_DEFEAT: EndReason.DOUBLE_DEFEAT,
}


def match_end_msg(
    outcome: Outcome,
    tick: int,
    vp: Sequence[int],
    *,
    disconnect: bool = False,
    rating: RatingChange | None = None,
    unrated_reason: UnratedReason | None = UnratedReason.CASUAL,
    calibration: Calibration | None = None,
    stats: tuple[int, int] | None = None,
) -> MatchEndMsg:
    """``match_end`` of a finished match; ``disconnect``: the ``Forfeit`` was a technical defeat.

    ``rating``: the receiving player's rating change in a rated match (RAT-02), ``None`` while
    the rating is hidden. ``unrated_reason``: why the match did not change the rating, ``None``
    when it did (DEC-34). ``calibration``: the player's progress after the match. ``stats``:
    the receiving player's ``(units_lost, charges_delivered)`` (``gow_sim.analysis.result_totals``).
    """
    reason = _END_REASONS[outcome.reason]
    if disconnect and reason is EndReason.FORFEIT:
        reason = EndReason.DISCONNECT
    return MatchEndMsg(
        tick=tick,
        reason=reason,
        winner=outcome.winner,
        vp=(vp[0], vp[1]),
        rating=rating,
        rated=unrated_reason is None,
        unrated_reason=unrated_reason,
        calibration=calibration,
        stats=None
        if stats is None
        else MatchEndStats(units_lost=stats[0], charges_delivered=stats[1]),
    )
