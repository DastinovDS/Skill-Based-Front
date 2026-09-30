"""Wire codec: the only place that turns messages into frames and back (AGENTS.md, section 6).

JSON text frames now; msgpack later by replacing this module.

``decode_client`` and ``decode_server`` raise only ``pydantic.ValidationError``, for any input:
invalid UTF-8, invalid JSON, too deep nesting, an unknown ``type`` or a bad field. The error
text never contains the input (``hide_input_in_errors`` on the adapters too: union-level errors
use the adapter's config). When logging an error, use ``str(exc)`` or
``exc.errors(include_input=False)``: plain ``exc.errors()`` still carries the input.
"""

from typing import Final

from pydantic import ConfigDict, TypeAdapter

from gow_protocol.messages import ClientMsg, ServerMsg

_ADAPTER_CONFIG: Final = ConfigDict(hide_input_in_errors=True)

client_adapter: Final = TypeAdapter[ClientMsg](ClientMsg, config=_ADAPTER_CONFIG)
server_adapter: Final = TypeAdapter[ServerMsg](ServerMsg, config=_ADAPTER_CONFIG)


def decode_client(frame: str | bytes) -> ClientMsg:
    """Parse and validate a frame from a client. Raises ``ValidationError``."""
    return client_adapter.validate_json(frame)


def decode_server(frame: str | bytes) -> ServerMsg:
    """Parse and validate a frame from the server. Raises ``ValidationError``."""
    return server_adapter.validate_json(frame)


def encode(msg: ClientMsg | ServerMsg) -> str:
    """Serialize a message into a text frame. Every field is written, ``None`` as ``null``."""
    return msg.model_dump_json()
