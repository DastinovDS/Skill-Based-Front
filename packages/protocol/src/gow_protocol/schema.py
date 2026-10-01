"""JSON Schema of the wire format: the source of the client's TypeScript types (PRO-02, #45).

``scripts/export_schema.py`` writes ``protocol_json_schema()`` to ``SCHEMA_PATH``;
``pnpm -C apps/client gen:protocol`` turns it into ``apps/client/src/protocol.gen.ts``.
CI regenerates both and fails on a diff (AGENTS.md, section 6).

The schema is the serialization schema (what a sender writes): fields with a default are
required (``json_schema_serialization_defaults_required`` in ``gow_protocol.base``), so ``type``
is never optional and the TypeScript unions narrow by ``type``.

A few adjustments keep the schema equivalent but make the generator (json-schema-to-typescript)
emit clean types: no field titles (each would become a named alias, ``type Seq = number``),
fixed-length tuples without ``prefixItems`` and described ``$ref`` fields under ``allOf``.
"""

from pathlib import Path
from typing import Any, Final, override

from pydantic import TypeAdapter
from pydantic.json_schema import GenerateJsonSchema, JsonSchemaValue
from pydantic_core import core_schema

from gow_protocol.mapfile import MapFile
from gow_protocol.messages import (
    CLOSE_PROTOCOL_VERSION,
    CLOSE_REPLACED,
    PROTOCOL_VERSION,
    ClientMsg,
    ServerMsg,
)

SCHEMA_PATH: Final = Path(__file__).resolve().parents[2] / "protocol.schema.json"
"""``packages/protocol/protocol.schema.json``."""

ROOTS: Final[tuple[object, ...]] = (ClientMsg, ServerMsg, MapFile)
"""Top-level types of the schema. Each is a named definition (a model or a ``type`` alias), and
TypeScript gets it under the same name."""


class WireJsonSchema(GenerateJsonSchema):
    """Pydantic's generator with the adjustments listed in the module docstring."""

    @override
    def field_title_should_be_set(self, schema: object) -> bool:
        return False

    @override
    def tuple_schema(self, schema: core_schema.TupleSchema) -> JsonSchemaValue:
        """A fixed-length tuple of one type as ``items`` + ``minItems`` = ``maxItems``.

        json-schema-to-typescript does not read ``prefixItems`` (JSON Schema 2020-12) and would
        type ``vp: tuple[int, int]`` as ``unknown[]``; this form is equivalent and becomes
        ``[number, number]``. A tuple of different types has no such form and is an error.
        """
        json_schema = super().tuple_schema(schema)
        prefix: list[JsonSchemaValue] | None = json_schema.pop("prefixItems", None)
        if prefix is None:
            return json_schema
        if "items" in json_schema or any(item != prefix[0] for item in prefix):
            raise ValueError(f"only a homogeneous fixed-length tuple is supported: {schema}")
        return {**json_schema, "items": prefix[0]}


def protocol_json_schema() -> dict[str, Any]:
    """One schema with every type in ``$defs``; the root is the union of ``ROOTS``.

    ``x-constants`` carries the values the client needs at runtime (the ``hello`` version and the
    final close codes). json-schema-to-typescript ignores it; ``apps/client/scripts/
    protocol-consts.js`` appends them to ``protocol.gen.ts`` as ``export const``.
    """
    refs, schema = TypeAdapter.json_schemas(
        [(i, "serialization", TypeAdapter[Any](root)) for i, root in enumerate(ROOTS)],
        schema_generator=WireJsonSchema,
    )
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "Protocol",
        "description": "Wire format of Skill-Based Front, generated from gow_protocol.",
        "anyOf": [refs[(i, "serialization")] for i in range(len(ROOTS))],
        "x-constants": {
            "PROTOCOL_VERSION": PROTOCOL_VERSION,
            "CLOSE_PROTOCOL_VERSION": CLOSE_PROTOCOL_VERSION,
            "CLOSE_REPLACED": CLOSE_REPLACED,
        },
        "$defs": {name: _wrap_described_refs(d) for name, d in schema["$defs"].items()},
    }


def _wrap_described_refs(definition: dict[str, Any]) -> dict[str, Any]:
    """``{"$ref": X, "description": ...}`` -> ``{"allOf": [{"$ref": X}], "description": ...}``.

    Equivalent in JSON Schema 2020-12, but json-schema-to-typescript reads a ``$ref`` with
    siblings as a new type and emits a copy of ``X`` (``Detail1``); under ``allOf`` it keeps the
    name ``X``.
    """
    properties: dict[str, dict[str, Any]] | None = definition.get("properties")
    if properties is None:
        return definition
    wrapped = {
        name: {"allOf": [{"$ref": prop["$ref"]}], **{k: v for k, v in prop.items() if k != "$ref"}}
        if "$ref" in prop and len(prop) > 1
        else prop
        for name, prop in properties.items()
    }
    return {**definition, "properties": wrapped}
