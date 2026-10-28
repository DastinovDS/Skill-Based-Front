"""Request body size limit (audit SRV-01, #411).

A pure ASGI middleware: it answers 413 before any parsing, both by the ``Content-Length`` header
(no byte is read) and by counting the bytes of a streamed or chunked body. WebSocket scopes pass
through untouched (messages there are limited by the connection itself).
"""

import contextlib
import json
from collections.abc import MutableMapping
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

_Headers = list[tuple[bytes, bytes]]

_BODY = json.dumps({"detail": "request body too large"}).encode()
_RESPONSE_HEADERS: _Headers = [
    (b"content-type", b"application/json"),
    (b"content-length", str(len(_BODY)).encode()),
    (b"connection", b"close"),
]


class BodyTooLargeError(Exception):
    """Raised inside the receive channel when a streamed body passes the limit."""


class BodySizeLimitMiddleware:
    """Refuses HTTP requests with a body over ``max_bytes`` with 413."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        if _declared_length(scope["headers"]) > self.max_bytes:
            await _refuse(send)
            return

        received = 0
        exceeded = False
        started = False

        async def counting_receive() -> Message:
            nonlocal received, exceeded
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    exceeded = True
                    raise BodyTooLargeError
            return message

        async def guarded_send(message: MutableMapping[str, Any]) -> None:
            nonlocal started
            if exceeded and not started:
                # FastAPI turns a failed body read into its own 400: the app's answer is dropped.
                return
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        with contextlib.suppress(BodyTooLargeError):
            await self.app(scope, counting_receive, guarded_send)
        if exceeded and not started:
            await _refuse(send)


def _declared_length(headers: _Headers) -> int:
    """The ``Content-Length`` value; 0 when absent or not a number (the stream count then rules)."""
    for name, value in headers:
        if name == b"content-length":
            try:
                return int(value)
            except ValueError:
                return 0
    return 0


async def _refuse(send: Send) -> None:
    await send({"type": "http.response.start", "status": 413, "headers": _RESPONSE_HEADERS})
    await send({"type": "http.response.body", "body": _BODY})
