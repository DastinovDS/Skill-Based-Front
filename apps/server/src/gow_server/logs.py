"""Structured JSON logs with a request id.

Every record is one JSON object per line. Fields passed through ``extra={...}`` are included,
and ``request_id`` is added while a request is being handled. Never log tokens or query strings
(AGENTS.md, section 5.3).
"""

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Final

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

# Attributes every LogRecord has; anything else on a record came from ``extra``.
# ``color_message`` is uvicorn's copy of the message with ANSI colours.
_STANDARD_ATTRS: Final = frozenset(
    logging.LogRecord("", 0, "", 0, "", None, None).__dict__.keys()
    | {"message", "asctime", "color_message"}
)


class DropWebSocketHandshake(logging.Filter):
    """Drops uvicorn's record of every WebSocket handshake (#193).

    uvicorn logs ``<client ip:port> - "WebSocket <path?query>" [accepted]`` (or ``403``) at INFO on
    ``uvicorn.error``: the client address is personal data and the query string is never logged
    (AGENTS.md, section 5.3; docs/ops/legal.md). ``gow_server.ws`` logs connections itself, with
    the match id and without the address.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        return not (isinstance(record.msg, str) and '"WebSocket ' in record.msg)


DROP_WS_HANDSHAKE: Final = DropWebSocketHandshake()


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        request_id = request_id_var.get()
        if request_id is not None:
            entry["request_id"] = request_id
        for key, value in record.__dict__.items():
            if key not in _STANDARD_ATTRS and not key.startswith("_"):
                entry[key] = value
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False, default=str)


def configure_logging(level: str) -> None:
    """Send all logs (ours and uvicorn's) to stderr as JSON lines.

    The uvicorn access log is switched off: it writes the query string. The access log is the
    request middleware in ``gow_server.app`` (path only, with the request id). uvicorn's own
    WebSocket handshake lines (client address and query string) are dropped as well.
    """
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    for name in ("uvicorn", "uvicorn.error"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True
    logging.getLogger("uvicorn.error").addFilter(DROP_WS_HANDSHAKE)
    uvicorn_access = logging.getLogger("uvicorn.access")
    uvicorn_access.handlers.clear()
    uvicorn_access.propagate = False
    uvicorn_access.disabled = True
