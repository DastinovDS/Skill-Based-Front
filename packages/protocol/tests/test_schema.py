"""JSON Schema export (PRO-02, #45): the committed schema is current and the unions narrow."""

import json
from typing import Any

import pytest
from pydantic import BaseModel, TypeAdapter

from gow_protocol.messages import CLOSE_PROTOCOL_VERSION, CLOSE_REPLACED, PROTOCOL_VERSION
from gow_protocol.schema import SCHEMA_PATH, WireJsonSchema, protocol_json_schema

REGENERATE = "uv run python scripts/export_schema.py && pnpm -C apps/client gen:protocol"


@pytest.fixture(scope="module")
def schema() -> dict[str, Any]:
    return protocol_json_schema()


def _defs(schema: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return schema["$defs"]


def _members(schema: dict[str, Any], union: str) -> list[dict[str, Any]]:
    refs: list[dict[str, str]] = _defs(schema)[union]["oneOf"]
    return [_defs(schema)[ref["$ref"].removeprefix("#/$defs/")] for ref in refs]


def test_committed_schema_is_current(schema: dict[str, Any]) -> None:
    committed: object = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    assert committed == schema, f"the schema is out of date, run: {REGENERATE}"


def test_schema_carries_the_runtime_constants_of_the_client(schema: dict[str, Any]) -> None:
    """The client's ``hello`` and its 4001 handling read these (CLI-01, #57)."""
    assert schema["x-constants"] == {
        "PROTOCOL_VERSION": PROTOCOL_VERSION,
        "CLOSE_PROTOCOL_VERSION": CLOSE_PROTOCOL_VERSION,
        "CLOSE_REPLACED": CLOSE_REPLACED,
    }


def test_roots_are_named_definitions(schema: dict[str, Any]) -> None:
    assert schema["anyOf"] == [
        {"$ref": "#/$defs/ClientMsg"},
        {"$ref": "#/$defs/ServerMsg"},
        {"$ref": "#/$defs/MapFile"},
    ]


@pytest.mark.parametrize(
    ("union", "tag", "tags"),
    [
        (
            "ClientMsg",
            "type",
            {"hello", "command", "ping", "resync", "pause", "resume", "reach_query"},
        ),
        (
            "ServerMsg",
            "type",
            {
                "welcome",
                "snapshot",
                "ack",
                "event",
                "match_end",
                "error",
                "pong",
                "paused",
                "reach",
            },
        ),
        (
            "Command",
            "type",
            {
                "move",
                "split",
                "merge",
                "set_mode",
                "set_stance",
                "upgrade_road",
                "recruit",
                "cancel_order",
                "set_priority",
                "transfer",
                "forfeit",
            },
        ),
        ("Location", "kind", {"node", "edge"}),
    ],
)
def test_union_members_carry_a_required_constant_tag(
    schema: dict[str, Any], union: str, tag: str, tags: set[str]
) -> None:
    """What makes a TypeScript union narrow: every member has a required literal tag."""
    members = _members(schema, union)
    assert {m["properties"][tag]["const"] for m in members} == tags
    for member in members:
        assert tag in member["required"], member["title"]
        assert member["additionalProperties"] is False, member["title"]


def test_every_field_is_required(schema: dict[str, Any]) -> None:
    """The server writes every field (``None`` as ``null``), so none is optional in TypeScript."""
    for name, definition in _defs(schema).items():
        properties: dict[str, Any] = definition.get("properties", {})
        assert set(definition.get("required", [])) == set(properties), name


def test_fixed_length_tuple_becomes_items_with_bounds(schema: dict[str, Any]) -> None:
    vp = _defs(schema)["MatchEndMsg"]["properties"]["vp"]
    assert "prefixItems" not in vp
    assert (vp["type"], vp["items"]["type"], vp["minItems"], vp["maxItems"]) == (
        "array",
        "integer",
        2,
        2,
    )


def test_heterogeneous_tuple_is_rejected() -> None:
    class Mixed(BaseModel):
        pair: tuple[int, str]

    with pytest.raises(ValueError, match="homogeneous"):
        TypeAdapter(Mixed).json_schema(mode="serialization", schema_generator=WireJsonSchema)


def test_player_id_is_zero_or_one(schema: dict[str, Any]) -> None:
    assert _defs(schema)["PlayerId"]["enum"] == [0, 1]
