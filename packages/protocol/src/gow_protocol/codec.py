"""Wire codec: the only place that turns messages into frames and back (AGENTS.md, section 6).

JSON text frames now; msgpack later by replacing this module.

``decode_client`` and ``decode_server`` raise only ``pydantic.ValidationError``, for any input:
invalid UTF-8, invalid JSON, too deep nesting, an unknown ``type`` or a bad field. The error
text never contains the input (``hide_input_in_errors`` on the adapters too: union-level errors
use the adapter's config). When logging an error, use ``str(exc)`` or
``exc.errors(include_input=False)``: plain ``exc.errors()`` still carries the input.

Snapshots are the exception to «a message is a model» (#155): a player gets one every tick, and
building the ``View`` models costs more than ``project()`` itself. ``encode_snapshot`` writes the
frame straight from plain data (``gow_protocol.convert.snapshot_frame``); the result is a
``SnapshotFrame``, which ``encode`` passes through. Tests over real matches check that the frame is
byte for byte the ``encode`` of the validated ``SnapshotMsg``; ``SnapshotFrame.message()`` decodes
and validates it like a client does.
"""

import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

from pydantic import ConfigDict, TypeAdapter

from gow_protocol.messages import ClientMsg, ServerMsg, SnapshotMsg

_ADAPTER_CONFIG: Final = ConfigDict(hide_input_in_errors=True)

client_adapter: Final = TypeAdapter[ClientMsg](ClientMsg, config=_ADAPTER_CONFIG)
server_adapter: Final = TypeAdapter[ServerMsg](ServerMsg, config=_ADAPTER_CONFIG)


def decode_client(frame: str | bytes) -> ClientMsg:
    """Parse and validate a frame from a client. Raises ``ValidationError``."""
    return client_adapter.validate_json(frame)


def decode_server(frame: str | bytes) -> ServerMsg:
    """Parse and validate a frame from the server. Raises ``ValidationError``."""
    return server_adapter.validate_json(frame)


@dataclass(frozen=True, slots=True)
class SnapshotFrame:
    """A ``snapshot`` message already encoded, not validated (see the module docstring)."""

    tick: int
    frame: str

    def message(self) -> SnapshotMsg:
        """The message decoded and validated as a client does it. Raises ``ValidationError``."""
        return SnapshotMsg.model_validate_json(self.frame)


def encode_snapshot(tick: int, view: Mapping[str, object]) -> SnapshotFrame:
    """The ``snapshot`` frame of ``view`` given as JSON data in the field order of ``View``."""
    data = {"type": "snapshot", "tick": tick, "view": view}
    return SnapshotFrame(tick, json.dumps(data, ensure_ascii=False, separators=(",", ":")))


def encode(msg: ClientMsg | ServerMsg | SnapshotFrame) -> str:
    """Serialize a message into a text frame. Every field is written, ``None`` as ``null``."""
    if isinstance(msg, SnapshotFrame):
        return msg.frame
    return msg.model_dump_json()
