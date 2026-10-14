"""The match WebSocket ``/ws/match/{match_id}`` (SRV-03, AGENTS.md, section 5.3).

1. The upgrade is refused (HTTP 403) unless ``Origin`` is the page's own origin (the ``Host`` the
   client connected to, i.e. the site behind Caddy) or listed in ``ws_allowed_origins``.
2. The first message is ``hello`` within ``ws_hello_timeout_s``, else close ``CLOSE_POLICY``.
   Another ``protocol_version`` closes with 4001 (``CLOSE_PROTOCOL_VERSION``), also when the rest
   of an old client's ``hello`` no longer validates. The token is looked up by its SHA-256 in a
   thread (``asyncio.to_thread``: the database is synchronous); it is never logged, and
   validation errors are logged only as their count.
3. An unknown token, an unknown or finished match, or a match the account does not play in all
   close with ``CLOSE_NO_MATCH``: the answer does not tell which.
4. ``welcome`` (with ``last_seq``) and a full ``snapshot`` follow, then a reader and a writer run in
   a ``TaskGroup`` until either ends:
   - reader: every message takes a token from the connection's token bucket (flood: ``error``
     ``RATE_LIMITED`` and close ``CLOSE_POLICY``); ``command`` goes to the match (a repeated
     ``seq`` is dropped, the ``ack`` comes from the tick), ``ping`` is answered with ``pong``,
     ``resync`` puts a full snapshot into the outbox, ``reach_query`` a ``reach`` (DEC-20); a
     malformed message gets ``error``;
   - writer: sends the player's ``Outbox`` (reliable messages first, then the latest snapshot),
     every send with a timeout: a client that does not read is disconnected. After
     ``match_end`` the connection is closed normally (1000); a newer connection of the same
     player closes the older one with ``CLOSE_REPLACED``, after which the old client must not
     reconnect (``CLOSE_REPLACED`` is final for it, ``matchConnection.ts``);
   - ``pause`` / ``resume`` go to the match (private matches, DEC-05): a refusal is ``error``
     ``PAUSE_DENIED``.
5. A dropped connection starts the player's reconnect window in the match (``MatchRunner``, SRV-04):
   the same token reconnects within it and gets ``welcome`` with ``last_seq`` and a full
   ``snapshot`` again; otherwise the match applies a ``Forfeit`` for the player.
"""

import asyncio
import json
import logging
import time
import urllib.parse
from typing import Final, cast

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from gow_protocol.codec import decode_client, encode
from gow_protocol.messages import (
    CLOSE_PROTOCOL_VERSION,
    CLOSE_REPLACED,
    PROTOCOL_VERSION,
    CommandMsg,
    ErrorMsg,
    HelloMsg,
    PauseMsg,
    PingMsg,
    PongMsg,
    ReachQueryMsg,
    ResumeMsg,
    ResyncMsg,
    WelcomeMsg,
)
from gow_protocol.ruleset import RulesetPublic
from gow_server.identity import hash_token
from gow_server.matches import MatchManager, MatchRunner, Outbox, Outgoing
from gow_server.models import Player
from gow_server.settings import Settings

log = logging.getLogger("gow_server.ws")

CLOSE_NORMAL: Final = 1000
CLOSE_POLICY: Final = 1008
"""No ``hello`` in time, a flood, a client that does not read."""
CLOSE_NO_MATCH: Final = 4004
"""Unknown token, unknown or finished match, or not a player of it."""
router = APIRouter()


class TokenBucket:
    """``rate`` tokens per second, at most ``burst``; ``take()`` is ``False`` when empty."""

    def __init__(self, rate: float, burst: int) -> None:
        self.rate = rate
        self.burst = burst
        self._tokens = float(burst)
        self._at = time.monotonic()

    def take(self) -> bool:
        now = time.monotonic()
        self._tokens = min(self.burst, self._tokens + (now - self._at) * self.rate)
        self._at = now
        if self._tokens < 1:
            return False
        self._tokens -= 1
        return True


def origin_allowed(origin: str | None, host: str | None, allowed: tuple[str, ...]) -> bool:
    """``origin`` is the site's own (its host and port equal ``Host``) or in ``allowed``."""
    if not origin:
        return False
    if origin in allowed:
        return True
    parts = urllib.parse.urlsplit(origin)
    return parts.scheme in ("http", "https") and host is not None and parts.netloc == host.lower()


def account_of(sessions: sessionmaker[Session], token: str) -> int | None:
    """Account id of a guest token; ``None`` for an unknown token or a blocked account (MOD-01).

    Synchronous: run it in a thread.
    """
    with sessions() as session:
        return session.execute(
            select(Player.id).where(
                Player.token_hash == hash_token(token), Player.blocked_at.is_(None)
            )
        ).scalar_one_or_none()


BOT_NICK = "Bot"
"""Nick of a bot in ``welcome``; the nick rules reserve it, so no player has it."""


def nicks_of(sessions: sessionmaker[Session], players: tuple[int, int]) -> tuple[str, str]:
    """Nicks of the two accounts of a match by slot; a bot slot (``BOT_ACCOUNT``) is ``Bot``.

    Synchronous: run it in a thread.
    """
    with sessions() as session:
        found = {
            account: nick
            for account, nick in session.execute(
                select(Player.id, Player.nick).where(Player.id.in_(players))
            )
        }
    first, second = (found.get(account, BOT_NICK) for account in players)
    return first, second


class _Close(Exception):
    """Ends the connection's task group with a close code."""

    def __init__(self, code: int, reason: str = "", error: str | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.reason = reason
        self.error = error
        """Code of an ``error`` message sent just before the close."""


async def _receive(ws: WebSocket) -> str | bytes:
    message = await ws.receive()
    if message["type"] == "websocket.disconnect":
        raise WebSocketDisconnect(message.get("code", 1000))
    text = message.get("text")
    if text is not None:
        return text
    data = message.get("bytes")
    return data if data is not None else b""


def _old_version(frame: str | bytes) -> bool:
    """An invalid ``hello`` of another protocol version (its other fields may differ)."""
    try:
        data: object = json.loads(frame)
    except ValueError:
        return False
    if not isinstance(data, dict):
        return False
    fields = cast(dict[str, object], data)
    return fields.get("type") == "hello" and fields.get("protocol_version") != PROTOCOL_VERSION


@router.websocket("/ws/match/{match_id}")
async def match_socket(ws: WebSocket, match_id: str) -> None:
    settings: Settings = ws.app.state.settings
    if not origin_allowed(
        ws.headers.get("origin"), ws.headers.get("host"), settings.ws_allowed_origins
    ):
        log.info("ws origin refused", extra={"match_id": match_id})
        await ws.close(code=CLOSE_POLICY)  # before accept: the upgrade is answered with 403
        return
    await ws.accept()
    try:
        await _serve(ws, match_id, settings)
    except _Close as close:
        await _close(ws, close, settings)
    except WebSocketDisconnect:
        pass


async def _close(ws: WebSocket, close: _Close, settings: Settings) -> None:
    """Send the ``error`` of ``close`` if any, then the close frame; both with the send timeout."""
    try:
        if close.error is not None:
            await _send(ws, ErrorMsg(code=close.error), settings)
        await asyncio.wait_for(
            ws.close(code=close.code, reason=close.reason), settings.ws_send_timeout_s
        )
    except (_Close, TimeoutError, RuntimeError, OSError, WebSocketDisconnect):
        pass  # the client is gone or does not read: nothing more to tell it


async def _hello(ws: WebSocket, settings: Settings) -> HelloMsg:
    try:
        frame = await asyncio.wait_for(_receive(ws), settings.ws_hello_timeout_s)
    except TimeoutError:
        raise _Close(CLOSE_POLICY, "no hello") from None
    try:
        msg = decode_client(frame)
    except ValidationError as exc:
        if _old_version(frame):
            raise _Close(CLOSE_PROTOCOL_VERSION, "protocol version") from None
        log.info("ws bad hello", extra={"errors": exc.error_count()})
        raise _Close(CLOSE_POLICY, "bad hello") from None
    if not isinstance(msg, HelloMsg):
        raise _Close(CLOSE_POLICY, "hello first")
    if msg.protocol_version != PROTOCOL_VERSION:
        raise _Close(CLOSE_PROTOCOL_VERSION, "protocol version")
    return msg


async def _serve(ws: WebSocket, match_id: str, settings: Settings) -> None:
    hello = await _hello(ws, settings)
    account = await asyncio.to_thread(account_of, ws.app.state.sessions, hello.token)
    manager: MatchManager = ws.app.state.matches
    runner = manager.get(match_id)
    player = None if runner is None or account is None else runner.slot_of(account)
    if runner is None or player is None or runner.finished:
        raise _Close(CLOSE_NO_MATCH, "no such match")
    nicks = await asyncio.to_thread(nicks_of, ws.app.state.sessions, runner.players)
    outbox = runner.attach(player)
    outbox.put(
        WelcomeMsg(
            player=player,
            ruleset_public=RulesetPublic.from_ruleset(runner.match.rules),
            map_id=runner.map_id,
            last_seq=runner.last_seq(player),
            nicks=nicks,
        )
    )
    outbox.put_snapshot(runner.snapshot(player))
    extra = {"match_id": match_id, "player": player}
    log.info("ws connected", extra=extra)
    code = CLOSE_NORMAL
    try:
        async with asyncio.TaskGroup() as tg:
            tg.create_task(_read(ws, runner, player, outbox, settings))
            tg.create_task(_write(ws, runner, outbox, settings))
    except* _Close as group:
        first = group.exceptions[0]
        assert isinstance(first, _Close)
        code = first.code
        raise first from None
    except* WebSocketDisconnect:
        code = -1
    finally:
        runner.detach(player, outbox)
        log.info("ws closed", extra={**extra, "code": code})


async def _read(
    ws: WebSocket, runner: MatchRunner, player: int, outbox: Outbox, settings: Settings
) -> None:
    bucket = TokenBucket(settings.ws_msg_rate, settings.ws_msg_burst)
    while True:
        frame = await _receive(ws)
        if not bucket.take():
            raise _Close(CLOSE_POLICY, "rate limited", error="RATE_LIMITED")
        try:
            msg = decode_client(frame)
        except ValidationError:
            outbox.put(ErrorMsg(code="BAD_MESSAGE"))
            continue
        match msg:
            case CommandMsg(seq=seq, cmd=cmd):
                runner.submit(player, seq, cmd)
            case PingMsg(id=ping_id):
                outbox.put(PongMsg(id=ping_id))
            case ResyncMsg():
                outbox.put_snapshot(runner.snapshot(player))
            case ReachQueryMsg(group=group):
                outbox.put(runner.reach(player, group))
            case PauseMsg():
                if not runner.request_pause(player):
                    outbox.put(ErrorMsg(code="PAUSE_DENIED"))
            case ResumeMsg():
                if not runner.request_resume(player):
                    outbox.put(ErrorMsg(code="PAUSE_DENIED"))
            case HelloMsg():
                outbox.put(ErrorMsg(code="UNEXPECTED_HELLO"))


async def _write(ws: WebSocket, runner: MatchRunner, outbox: Outbox, settings: Settings) -> None:
    while (msg := await outbox.get()) is not None:
        await _send(ws, msg, settings)
    if outbox.overflowed:
        raise _Close(CLOSE_POLICY, "not reading")
    if runner.finished:
        raise _Close(CLOSE_NORMAL, "match ended")
    raise _Close(CLOSE_REPLACED, "replaced")


async def _send(ws: WebSocket, msg: Outgoing, settings: Settings) -> None:
    try:
        await asyncio.wait_for(ws.send_text(encode(msg)), settings.ws_send_timeout_s)
    except TimeoutError:
        raise _Close(CLOSE_POLICY, "send timeout") from None
