"""Message schema: fixtures cover every message, every message round-trips, schema is int-only."""

import json
from pathlib import Path
from typing import Literal, cast

import pytest
from pydantic import ValidationError

from gow_protocol import PROTOCOL_VERSION
from gow_protocol.codec import client_adapter, decode_client, decode_server, encode, server_adapter
from gow_protocol.commands import MoveCmd
from gow_protocol.messages import CLOSE_PROTOCOL_VERSION, CLOSE_REPLACED, CommandMsg, HelloMsg
from gow_protocol.ruleset import CombatPublic, RulesetPublic
from gow_sim.ruleset import load_ruleset

FIXTURES_DIR = Path(__file__).resolve().parents[1] / "fixtures"
CLIENT_FIXTURES = sorted((FIXTURES_DIR / "client").glob("*.json"))
SERVER_FIXTURES = sorted((FIXTURES_DIR / "server").glob("*.json"))
RULESET_PATH = Path(__file__).resolve().parents[3] / "rulesets" / "mvp-0.toml"

# Message and command types named by PRO-01 (#44) and SIM-04 (#20); ``reach``: DEC-20 (#242).
CLIENT_TYPES = {"hello", "command", "ping", "resync", "pause", "resume", "reach_query"}
SERVER_TYPES = {
    "welcome",
    "snapshot",
    "ack",
    "event",
    "match_end",
    "error",
    "pong",
    "paused",
    "reach",
}
COMMAND_TYPES = {
    "move",
    "split",
    "merge",
    "set_mode",
    "set_stance",
    "upgrade_road",
    "recruit",
    "cancel_order",
    "cancel_recruit",
    "build_barracks",
    "upgrade_warehouse",
    "set_front",
    "set_rear_min",
    "transfer",
    "forfeit",
}


def _load(path: Path) -> dict[str, object]:
    data: object = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(data, dict)
    return cast(dict[str, object], data)


def _ids(paths: list[Path]) -> list[str]:
    return [p.stem for p in paths]


def test_fixtures_cover_every_message_type() -> None:
    assert {_load(p)["type"] for p in CLIENT_FIXTURES} == CLIENT_TYPES
    assert {_load(p)["type"] for p in SERVER_FIXTURES} == SERVER_TYPES


def test_fixtures_cover_every_command_type() -> None:
    commands = [_load(p)["cmd"] for p in CLIENT_FIXTURES if _load(p)["type"] == "command"]
    assert {cast(dict[str, object], c)["type"] for c in commands} == COMMAND_TYPES


def test_fixture_file_names_match_their_type() -> None:
    for path in CLIENT_FIXTURES + SERVER_FIXTURES:
        data = _load(path)
        expected = data["type"]
        if expected == "command":
            expected = f"command_{cast(dict[str, object], data['cmd'])['type']}"
        assert isinstance(expected, str)
        assert path.stem.startswith(expected), path


@pytest.mark.parametrize("path", CLIENT_FIXTURES, ids=_ids(CLIENT_FIXTURES))
def test_client_fixture_roundtrip(path: Path) -> None:
    msg = decode_client(path.read_bytes())
    assert json.loads(encode(msg)) == _load(path)
    assert decode_client(encode(msg)) == msg


@pytest.mark.parametrize("path", SERVER_FIXTURES, ids=_ids(SERVER_FIXTURES))
def test_server_fixture_roundtrip(path: Path) -> None:
    msg = decode_server(path.read_bytes())
    assert json.loads(encode(msg)) == _load(path)
    assert decode_server(encode(msg)) == msg


@pytest.mark.parametrize("path", CLIENT_FIXTURES, ids=_ids(CLIENT_FIXTURES))
def test_client_fixture_is_not_a_server_message(path: Path) -> None:
    with pytest.raises(ValidationError):
        decode_server(path.read_bytes())


@pytest.mark.parametrize("path", SERVER_FIXTURES, ids=_ids(SERVER_FIXTURES))
def test_server_fixture_is_not_a_client_message(path: Path) -> None:
    with pytest.raises(ValidationError):
        decode_client(path.read_bytes())


def test_messages_built_in_python_roundtrip() -> None:
    msg = CommandMsg(seq=7, cmd=MoveCmd(group="abc", dest=3, planned=True))
    assert json.loads(encode(msg)) == {
        "type": "command",
        "seq": 7,
        "cmd": {"type": "move", "group": "abc", "dest": 3, "planned": True},
    }
    assert decode_client(encode(msg)) == msg


def test_welcome_has_two_nicks() -> None:
    raw = json.loads((FIXTURES_DIR / "server" / "welcome.json").read_text())
    assert decode_server(json.dumps(raw)).model_dump(mode="json")["nicks"] == ["Danya", "Guest"]
    for bad in (["Danya"], ["Danya", "Guest", "Third"], ["", "Guest"], ["x" * 17, "Guest"]):
        with pytest.raises(ValidationError):
            decode_server(json.dumps({**raw, "nicks": bad}))


def test_overcrowding_countdown_fields_are_validated() -> None:
    raw = json.loads((FIXTURES_DIR / "server" / "snapshot.json").read_text())
    nodes = raw["view"]["nodes"]
    own = next(n for n in nodes if n["detail"] == "exact")
    other = next(n for n in nodes if n["detail"] != "exact")

    def decode(node: dict[str, object], **fields: object) -> None:
        patched = [{**node, **fields} if n is node else n for n in nodes]
        decode_server(json.dumps({**raw, "view": {**raw["view"], "nodes": patched}}))

    decode(own, attrition_in=12)
    decode(own, grace_left=30)
    for bad in ({"attrition_in": 0}, {"attrition_in": 3, "grace_left": 4}):
        with pytest.raises(ValidationError):
            decode(own, **bad)
    with pytest.raises(ValidationError):  # only a node seen exactly has a countdown
        decode(other, attrition_in=5)


def test_protocol_version_is_a_positive_integer() -> None:
    assert type(PROTOCOL_VERSION) is int
    assert PROTOCOL_VERSION >= 1
    assert CLOSE_PROTOCOL_VERSION == 4001  # AGENTS.md, section 6
    assert CLOSE_REPLACED == 4009


def test_hello_fixture_uses_the_current_protocol_version() -> None:
    msg = decode_client((FIXTURES_DIR / "client" / "hello.json").read_bytes())
    assert isinstance(msg, HelloMsg)
    assert msg.protocol_version == PROTOCOL_VERSION


def test_ruleset_public_has_the_stance_table_and_order_delays_of_mvp_0() -> None:
    """The numbers of the stance menu and of the countdown on order arrows (ui-style 11 and 9.7)."""
    public = RulesetPublic.from_ruleset(load_ruleset(RULESET_PATH))
    assert public.economy.model_dump() == {
        "stance_to_charges_pct": {"economy": 75, "balance": 50, "war": 25},
        "charges_per_cp": 2,
    }
    assert public.orders.model_dump() == {
        "planned_delay_ticks": 30,
        "defense_ticks_per_bonus": 60,
        "stance_cooldown_ticks": 100,
    }
    # The overcrowding countdown of ui-style 12 (rulesets/mvp-0.toml, [capacity]).
    assert public.capacity.model_dump() == {"attrition_ticks": 30, "grace_ticks": 50}


def test_ruleset_public_takes_values_from_the_ruleset() -> None:
    rules = load_ruleset(RULESET_PATH)
    public = RulesetPublic.from_ruleset(rules)
    assert public.tick_hz == rules.tick_hz
    assert public.match_ticks == rules.match_ticks
    assert (public.cp.cap, public.cp.per_period, public.cp.period_ticks) == (
        rules.cp.cap,
        rules.cp.per_period,
        rules.cp.period_ticks,
    )
    cost = rules.orders.cost
    assert public.cost.model_dump() == {
        "move": cost.move,
        "planned_move": cost.planned_move,
        "cancel": cost.cancel,
        "split": cost.split,
        "merge": cost.merge,
        "attack": cost.attack,
        "defense": cost.defense,
        "build": cost.build,
        "recruit": cost.recruit,
        "stance": cost.stance,
        "front": cost.front,
        "rear_min": cost.rear_min,
        "transfer": cost.transfer,
        "barracks": cost.barracks,
        "warehouse": cost.warehouse,
    }
    mod = rules.terrain.defense_mod
    assert public.combat.terrain_defense_mod.model_dump() == {
        "plains": mod.plains,
        "forest": mod.forest,
        "mountains": mod.mountains,
    }
    assert public.combat.planned_bonus_per_edge == rules.orders.planned_bonus_per_edge
    assert public.orders.defense_ticks_per_bonus == rules.orders.defense_ticks_per_bonus
    assert public.supply.model_dump() == {  # DEC-28, items 2 and 3: markers, the slider
        "rear_min_max": rules.supply.rear_min_max,
        "rear_min_default": rules.supply.rear_min_default,
        "front_markers": rules.supply.front_markers,
    }
    assert public.build.model_dump() == {"ticks_per_level": rules.build.ticks_per_level}


def test_ruleset_public_has_the_combat_vector_parameter_names() -> None:
    """The vectors' ``params`` use the names of ``combat``; the plan bonus is not among them since
    DEC-29 (it depends on the path, every vector gives its amount), the gathered «Защита» of the
    rows (``defense_bonus``) is not a ruleset number since DEC-30."""
    params = _load(FIXTURES_DIR.parent / "vectors" / "combat.json")["params"]
    assert isinstance(params, dict)
    names = set(cast(dict[str, object], params))
    assert names - {"defense_bonus"} | {"planned_bonus_per_edge"} == set(CombatPublic.model_fields)


def _schema_types(node: object) -> set[str]:
    found: set[str] = set()
    if isinstance(node, dict):
        mapping = cast(dict[str, object], node)
        kind = mapping.get("type")
        if isinstance(kind, str):
            found.add(kind)
        for value in mapping.values():
            found |= _schema_types(value)
    elif isinstance(node, list):
        for value in cast(list[object], node):
            found |= _schema_types(value)
    return found


@pytest.mark.parametrize("mode", ["validation", "serialization"])
def test_schema_has_no_floats(mode: Literal["validation", "serialization"]) -> None:
    for adapter in (client_adapter, server_adapter):
        schema = adapter.json_schema(mode=mode)
        types = _schema_types(schema)
        assert "number" not in types
        assert "integer" in types


def test_serialization_schema_requires_type_for_narrowing() -> None:
    """PRO-02 (#45) generates TS types from it; an optional ``type`` would not narrow."""
    for adapter in (client_adapter, server_adapter):
        defs = cast(
            dict[str, dict[str, object]], adapter.json_schema(mode="serialization")["$defs"]
        )
        for name, definition in defs.items():
            properties = definition.get("properties")
            if isinstance(properties, dict) and "type" in properties:
                assert "type" in cast(list[str], definition["required"]), name
