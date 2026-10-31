"""WebSocket messages of a match: ``ClientMsg`` and ``ServerMsg``, tagged unions by ``type``.

Client -> server: ``hello`` (first message, with the token), ``command``, ``ping``, ``resync``,
``pause`` and ``resume`` (private matches only, DEC-05), ``reach_query`` (DEC-20),
``line_route_query`` (#665).
Server -> client: ``welcome``, ``snapshot``, ``ack``, ``event``, ``match_end``, ``error``, ``pong``,
``paused``, ``reach``, ``line_route``.
The connection rules are in AGENTS.md, section 5.3 (SRV-03 #48, SRV-04 #50).

Any change of these models is a protocol change: bump ``PROTOCOL_VERSION`` and regenerate the
TypeScript types (AGENTS.md, sections 6 and 10).
"""

from enum import StrEnum
from typing import Annotated, Final, Literal, Self

from pydantic import Field, StringConstraints, model_validator

from gow_protocol.base import (
    Code,
    MapId,
    NodeId,
    NonNegInt,
    OpaqueId,
    PlayerId,
    PosInt,
    SignedInt,
    Tick,
    WireModel,
)
from gow_protocol.commands import MAX_LINE_NODES, Command
from gow_protocol.ruleset import RulesetPublic
from gow_protocol.view import View
from gow_sim.state import Detail

PROTOCOL_VERSION: Final = 34
"""Bumped on every change of the message schema."""

CLOSE_PROTOCOL_VERSION: Final = 4001
"""WebSocket close code for a ``hello`` with another ``protocol_version`` (AGENTS.md, section 6)."""

CLOSE_REPLACED: Final = 4009
"""A newer connection of the same player replaced this one. Final for the client: it must not
reconnect, or two tabs of one player would evict each other forever (SRV-04, #50)."""

CLOSE_NO_MATCH: Final = 4004
"""Unknown token, unknown or finished match, or not a player of it (one answer for all)."""

CLOSE_POLICY: Final = 1008
"""WebSocket policy violation: no ``hello`` in time, a bad ``hello``, a flood, a client that does
not read."""

MAX_EVENT_FIELDS: Final = 32
"""Wire limit on the number of ``event.data`` fields."""


# Client -> server ----------------------------------------------------------------------------


class HelloMsg(WireModel):
    """First message of a connection. The token is never in the URL, a log or an error text."""

    type: Literal["hello"] = "hello"
    protocol_version: PosInt
    token: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,128}$")] = Field(repr=False)
    """Guest token from ``POST /api/guest`` (``secrets.token_urlsafe``, ID-01 #43)."""


class CommandMsg(WireModel):
    type: Literal["command"] = "command"
    seq: PosInt
    """Client sequence number of the command, strictly increasing; ``ack`` echoes it."""
    cmd: Command


class PingMsg(WireModel):
    """Application-level ping for RTT (browsers do not expose protocol pings)."""

    type: Literal["ping"] = "ping"
    id: NonNegInt
    """Echoed in ``pong``; the client measures the time itself."""


class ResyncMsg(WireModel):
    """Ask for a full snapshot now (after a gap in snapshots)."""

    type: Literal["resync"] = "resync"


class PauseMsg(WireModel):
    """Pause a private match (DEC-05): one pause per player, at most ``paused.ends_in_s`` long.

    Refused with ``error`` ``PAUSE_DENIED`` in a rated match, with no pause left or while paused.
    """

    type: Literal["pause"] = "pause"


class ResumeMsg(WireModel):
    """End a pause early. Only the player who paused may; else ``error`` ``PAUSE_DENIED``."""

    type: Literal["resume"] = "resume"


class ReachQueryMsg(WireModel):
    """Ask where an own standing group can be ordered to and how long it takes (DEC-20, D5).

    The answer is ``reach``. The interface sends it when a group is selected; the connection's
    message rate limit covers it like every other message.
    """

    type: Literal["reach_query"] = "reach_query"
    group: OpaqueId


class LineRouteQueryMsg(WireModel):
    """Ask for the suggested path of a supply line through ``points`` (economy v2, DEC-41,
    item 6; owner decision 2026-10-31, #665): the source, the nodes to route through, the target.

    The answer is ``line_route``. The interface sends it when the player clicks the target or a
    node to route through; the connection's message rate limit covers it like every other
    message. The suggestion is only a default: the player confirms it with ``draw_line``.
    """

    type: Literal["line_route_query"] = "line_route_query"
    points: Annotated[tuple[NodeId, ...], Field(min_length=2, max_length=MAX_LINE_NODES)]


type ClientMsg = Annotated[
    HelloMsg
    | CommandMsg
    | PingMsg
    | ResyncMsg
    | PauseMsg
    | ResumeMsg
    | ReachQueryMsg
    | LineRouteQueryMsg,
    Field(discriminator="type"),
]


# Server -> client ----------------------------------------------------------------------------


Nick = Annotated[str, StringConstraints(min_length=1, max_length=16)]


class UnratedReason(StrEnum):
    """Why a match did not change your rating (DEC-34, #414)."""

    CASUAL = "casual"
    """Not a queue match: an invite, the lobby or a bot (DEC-06). Nothing to explain."""
    GUEST = "guest"
    """Your account has no password: rated matches are for password accounts."""
    OPPONENT_GUEST = "opponent_guest"
    """The opponent is a guest."""
    OPPONENT_CALIBRATING = "opponent_calibrating"
    """The opponent is still in calibration: it does not change the rating of a calibrated
    player."""
    OPPONENT_LIMIT = "opponent_limit"
    """You have already played the rated-match limit against this opponent within 24 hours."""
    OPPONENT_EARLY_RESIGN = "opponent_early_resign"
    """The opponent resigned (or disconnected) early: no gain for the winner. Only in
    ``match_end``."""


class Calibration(WireModel):
    """Calibration progress of an account: the first matches of a rated account do not show its
    rating (DEC-34, #414)."""

    played: NonNegInt
    """Calibration matches played, at most ``total``."""
    total: PosInt
    """Calibration matches needed (a server setting, 5 by default)."""


def _check_rated_fields(rated: bool, reason: UnratedReason | None) -> None:
    if rated and reason is not None:
        raise ValueError("a rated match has no unrated reason")
    if not rated and reason is None:
        raise ValueError("an unrated match needs a reason")


class WelcomeMsg(WireModel):
    """Answer to a valid ``hello``, also after a reconnect; a full ``snapshot`` follows."""

    type: Literal["welcome"] = "welcome"
    player: PlayerId
    ruleset_public: RulesetPublic
    map_id: MapId
    """The map graph itself is public and comes over HTTP (``GET /api/maps/{id}``)."""
    last_seq: NonNegInt
    """Highest ``seq`` of this player the server has accepted; ``0`` if none. After a reconnect
    the client resends only its commands with a greater ``seq``."""
    nicks: tuple[Nick, Nick]
    """Nicks of the two players by player id (ui-style U3); the bot of a bot match is ``Bot``.
    Not secret (visible in the waiting room and the queue), so not part of the ``PlayerView``."""
    rated: bool = False
    """Whether this match is expected to change your rating (DEC-34, #414); a calibration match
    does, silently. A rated match can still end unrated for its winner (an early resign of the
    opponent): ``match_end`` has the final answer."""
    unrated_reason: UnratedReason | None = UnratedReason.CASUAL
    """Why not (``rated`` is ``False``), known at the start; ``None`` when ``rated``."""
    calibration: Calibration | None = None
    """Your calibration progress before this match; ``None`` for a guest, in a match that is not
    from the queue, and once calibration is over."""
    forfeit_ban_s: NonNegInt = 0
    """Seconds the matchmaking queue would be locked for you if you forfeited (or were
    disconnected for good) now, counting your earlier resigns in the rolling window (DEC-34,
    item 3, #559); ``0``: no lock, also for a match that is not rated. The client only shows it."""
    pause_available: bool
    """Whether you may still pause this match (DEC-05): ``False`` in a rated (queue) match and
    once you have used your pause, also on a reconnect. A pause of the opponent going on now
    does not change it (``paused`` says that)."""

    @model_validator(mode="after")
    def _check_rated(self) -> Self:
        _check_rated_fields(self.rated, self.unrated_reason)
        return self


class SnapshotMsg(WireModel):
    """The player's view after tick ``tick``. Only the latest one matters (AGENTS.md, 5.3)."""

    type: Literal["snapshot"] = "snapshot"
    tick: Tick
    view: View

    @model_validator(mode="after")
    def _check_ticks(self) -> Self:
        halves = [h for e in self.view.edges for h in e.halves]
        for place in (*self.view.nodes, *halves):
            seen = place.seen
            if seen is None:
                continue
            if seen.tick > self.tick:
                raise ValueError(f"a sighting from tick {seen.tick} is newer than the snapshot")
            if place.detail is not Detail.FOG and seen.tick != self.tick:
                raise ValueError("a place not in fog carries a sighting of the snapshot tick")
        return self


class AckMsg(WireModel):
    """Result of the command ``seq``: accepted (``reject_code`` is ``None``) or rejected.

    ``applied_tick``: the tick at whose start the command was validated and, if accepted, applied.
    ``path``: for an accepted ``move``, the nodes from the group's node to ``dest``; for an
    accepted ``transfer`` (DEC-18), the nodes from ``from_node`` to ``to_node`` (the client draws
    it and never computes it); ``None`` otherwise.
    ``arrive_tick``: for an accepted ``move``, the tick the group reaches ``dest`` (planned delay
    included; DEC-22, item 10); for an accepted ``transfer``, the tick the charges reach
    ``to_node``; both if nothing stops them; ``None`` otherwise.
    ``reject_code``: code of the simulation's ``Reject`` (``NOT_FOUND_OR_HIDDEN``,
    ``NOT_ENOUGH_CP``, ``QUEUE_FULL``, ... from SIM-04 #20).
    """

    type: Literal["ack"] = "ack"
    seq: PosInt
    applied_tick: Tick
    path: Annotated[tuple[NodeId, ...], Field(min_length=1)] | None = None
    arrive_tick: Tick | None = None
    reject_code: Code | None = None

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.path is not None and self.reject_code is not None:
            raise ValueError("a rejected command has no path")
        if self.arrive_tick is not None and self.path is None:
            raise ValueError("an arrival tick comes with a path")
        return self


EventKey = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,31}$")]
EventValue = bool | SignedInt | Annotated[str, StringConstraints(max_length=64)] | None


class EventMsg(WireModel):
    """A simulation event visible to the player (``gow_sim.state.Event``; PRO-03 filters them).

    ``data`` mirrors ``Event.data``: flat fields with integer, string, boolean or null values.
    Entity ids in ``data`` are opaque ids (strings), map node and edge ids are integers.
    """

    type: Literal["event"] = "event"
    tick: Tick
    kind: EventKey
    data: Annotated[dict[EventKey, EventValue], Field(max_length=MAX_EVENT_FIELDS)]


class EndReason(StrEnum):
    """How the match ended (DEC-03, DEC-05)."""

    CAPITAL_CAPTURED = "capital_captured"
    TIMER = "timer"
    """Time is up: more VP wins, then more cities, else a draw."""
    FORFEIT = "forfeit"
    DISCONNECT = "disconnect"
    """Technical defeat after the reconnect window (a ``Forfeit`` in the replay journal)."""
    DOUBLE_DEFEAT = "double_defeat"
    """Both players lost in the same tick (two forfeits or both capitals taken): a draw (#136)."""


class RatingChange(WireModel):
    """The rating of the receiving player before and after a rated match (RAT-02, #75).

    Both numbers are the displayed rating (``r - 2 * RD``, RAT-01), rounded to integers.
    """

    before: SignedInt
    after: SignedInt


class MatchEndStats(WireModel):
    """Totals of the receiving player only (#607); the opponent's are never sent (fog).

    ``units_lost``: own units destroyed in fights (killed by shots) and by over-capacity attrition;
    ``charges_delivered``: charges that reached a city as supply packets or transfers. Both count
    the whole match from the event log, so a reconnect does not change them."""

    units_lost: NonNegInt
    charges_delivered: NonNegInt


class MatchEndMsg(WireModel):
    type: Literal["match_end"] = "match_end"
    tick: Tick
    reason: EndReason
    winner: PlayerId | None
    """``None`` is a draw: always for ``double_defeat``, possible for ``timer``, else never."""
    vp: tuple[NonNegInt, NonNegInt]
    """Final VP of both players, by player id."""
    rating: RatingChange | None = None
    """Rating change of the receiving player; ``None``: the match is not rated (DEC-06), or the
    player is still in calibration and the rating is hidden (``calibration``). Present when the
    match completes the calibration: that is the first rating the player sees (DEC-34)."""
    rated: bool = False
    """Whether this match changed your rating (a calibration match did, silently); the final
    answer, after the early-resign rule (DEC-34, #414)."""
    unrated_reason: UnratedReason | None = UnratedReason.CASUAL
    """Why not (``rated`` is ``False``); ``None`` when ``rated``."""
    stats: MatchEndStats | None = None
    """Your own totals for the result screen; ``None`` when the server did not count them."""
    calibration: Calibration | None = None
    """Your calibration progress after this match; ``None`` for a guest, in a match that is not
    from the queue, and once calibration was over before this match."""

    @model_validator(mode="after")
    def _check(self) -> Self:
        _check_rated_fields(self.rated, self.unrated_reason)
        if self.rating is not None and not self.rated:
            raise ValueError("a rating change needs a rated match")
        if self.reason is EndReason.DOUBLE_DEFEAT:
            if self.winner is not None:
                raise ValueError("a double defeat is a draw")
        elif self.winner is None and self.reason is not EndReason.TIMER:
            raise ValueError("only a match ended by the timer or a double defeat can be a draw")
        return self


class ErrorMsg(WireModel):
    """A protocol-level error (malformed message, rate limit, ...); game rejections are ``ack``.

    ``message`` is a short text for developers. It never echoes the client's input.
    """

    type: Literal["error"] = "error"
    code: Code
    message: Annotated[str, StringConstraints(max_length=200)] | None = None


class PongMsg(WireModel):
    type: Literal["pong"] = "pong"
    id: NonNegInt
    """``id`` of the ``ping``."""


class PausedMsg(WireModel):
    """The pause state of the match changed (also sent after ``welcome`` while paused)."""

    type: Literal["paused"] = "paused"
    paused: bool
    by: PlayerId | None
    """Player who paused; ``None`` when ``paused`` is false."""
    ends_in_s: NonNegInt | None
    """Whole seconds until the pause ends by itself; ``None`` when ``paused`` is false."""

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.paused != (self.by is not None and self.ends_in_s is not None):
            raise ValueError("`by` and `ends_in_s` are set exactly while paused")
        return self


class ReachNode(WireModel):
    node: NodeId
    ticks: PosInt
    """Ticks of the path once the group departs (a planned order waits its delay first)."""
    path: Annotated[tuple[NodeId, ...], Field(min_length=2)]
    """The nodes from the group's node to ``node``: the path ``ticks`` refers to, the same one
    the ``ack`` of a ``move`` there carries (#448). All but the last are the group's node or own
    nodes."""

    @model_validator(mode="after")
    def _check_path(self) -> Self:
        if self.path[-1] != self.node:
            raise ValueError("a path ends at its node")
        return self


class ReachMsg(WireModel):
    """Answer to ``reach_query``, computed by the server on the state after tick ``tick``
    (DEC-20, D5; DEC-22, item 10). The client highlights ``nodes``, shows their travel time and
    suggests splitting the group for ``split``; it computes neither. Both lists are empty for a
    group that is unknown, not own, hidden or on an edge."""

    type: Literal["reach"] = "reach"
    group: OpaqueId
    tick: Tick
    nodes: tuple[ReachNode, ...]
    """Nodes a ``move`` of the group is accepted to now, by node id."""
    split: tuple[NodeId, ...]
    """Nodes a ``move`` is rejected to with ``STACK_LIMIT``: only a smaller group gets there."""


class LineRouteMsg(WireModel):
    """Answer to ``line_route_query``, computed by the server on the state after tick ``tick``
    (#665): the fastest path over own nodes through ``points`` in order, each leg avoiding the
    nodes of the legs before it (the sum of the packet times, ties by ``node_key``). ``path`` is
    empty when a point is not own, repeated or out of range, or a leg has no way. Only own nodes
    are on a path. The rules of ``draw_line`` (source, limit, cycle) are not checked here."""

    type: Literal["line_route"] = "line_route"
    points: tuple[NodeId, ...]
    """The points of the query, as asked: the client matches the answer by them."""
    tick: Tick
    path: tuple[NodeId, ...]
    """``(points[0], ..., points[-1])`` or ``()``."""


type ServerMsg = Annotated[
    WelcomeMsg
    | SnapshotMsg
    | AckMsg
    | EventMsg
    | MatchEndMsg
    | ErrorMsg
    | PongMsg
    | PausedMsg
    | ReachMsg
    | LineRouteMsg,
    Field(discriminator="type"),
]
