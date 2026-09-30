"""Canonical JSON and its blake2b digest: the basis of ``ruleset_hash`` and ``state_hash``.

Canonical JSON (AGENTS.md, section 4.5): keys sorted, no whitespace, ASCII only, no ``float``.
The value is checked before encoding, so a float anywhere is an error rather than a hash that
depends on float formatting.
"""

import hashlib
import json
from typing import Final

DIGEST_SIZE: Final = 16
"""blake2b digest size in bytes: 32 hex characters."""


def canonical_json(value: object) -> bytes:
    """Encode ``value`` as canonical JSON bytes.

    Allowed values: ``None``, ``bool``, ``int``, ``str`` (including ``StrEnum``), lists and tuples
    (encoded as lists) and dicts with ``str`` keys. Anything else, ``float`` included, raises
    ``TypeError`` naming the path to the offending value.
    """
    _check(value, "$")
    text = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False
    )
    return text.encode("ascii")


def digest(value: object) -> str:
    """blake2b hex digest of the canonical JSON of ``value``."""
    return hashlib.blake2b(canonical_json(value), digest_size=DIGEST_SIZE).hexdigest()


def _check(value: object, where: str) -> None:
    if value is None or isinstance(value, bool | int | str):
        return
    if isinstance(value, float):
        raise TypeError(f"{where}: float {value!r} is not allowed in canonical data")
    if isinstance(value, list | tuple):
        items: list[object] | tuple[object, ...] = value  # pyright: ignore[reportUnknownVariableType]
        for i, item in enumerate(items):
            _check(item, f"{where}[{i}]")
        return
    if isinstance(value, dict):
        mapping: dict[object, object] = value  # pyright: ignore[reportUnknownVariableType]
        for key, item in mapping.items():
            if not isinstance(key, str):
                raise TypeError(f"{where}: key {key!r} is not a string")
            _check(item, f"{where}.{key}")
        return
    raise TypeError(f"{where}: {type(value).__name__} is not allowed in canonical data")
