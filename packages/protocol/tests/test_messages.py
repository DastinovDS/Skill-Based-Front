"""Message schema: fixtures cover every message, every message round-trips, schema is int-only."""

import json
from pathlib import Path
from typing import Literal, cast

import pytest
from pydantic import ValidationError

from gow_protocol import PROTOCOL_VERSION
from gow_protocol.codec import client_adapter, decode_client, decode_server, encode, server_adapter
from gow_protocol.commands import MoveCmd
from gow_protocol.messages import (
    CLOSE_NO_MATCH,
    CLOSE_POLICY,
    CLOSE_PROTOCOL_VERSION,
    CLOSE_REPLACED,
    CommandMsg,
    HelloMsg,
)
from gow_protocol.ruleset import CombatPublic, RulesetPublic
from gow_sim.ruleset import load_ruleset

FIXTURES_DIR = Path(__file__).resolve().parents[1] / "fixtures"
CLIENT_FIXTURES = sorted((FIXTURES_DIR / "client").glob("*.json"))
SERVER_FIXTURES = sorted((FIXTURES_DIR / "server").glob("*.json"))
RULESET_PATH = Path(__file__).resolve().parents[3] / "rulesets" / "mvp-7.toml"

# Message and command types named by PRO-01 (#44) and SIM-04 (#20); ``reach``: DEC-20 (#242).
CLIENT_TYPES = {
    "hello",
    "command",
    "ping",
    "resync",
    "pause",
    "resume",
    "reach_query",
}
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
    "set_stance",
    "recruit",
    "cancel_order",
    "cancel_recruit",
    "build_barracks",
    "forfeit",
    "build_factory",
    "release_plan",
    "set_leaf_shift",
    "fortify_road",
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
        "cmd": {"type": "move", "group": "abc", "dest": 3, "planned": True, "bonus": 0},
    }
    assert decode_client(encode(msg)) == msg


def test_welcome_has_two_nicks() -> None:
    raw = json.loads((FIXTURES_DIR / "server" / "welcome.json").read_text())
    assert decode_server(json.dumps(raw)).model_dump(mode="json")["nicks"] == ["Ember", "Guest"]
    for bad in (["Ember"], ["Ember", "Guest", "Third"], ["", "Guest"], ["x" * 17, "Guest"]):
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


def test_factory_and_plan_fields_are_validated() -> None:
    """DEC-41 (#647): the factory fields of a node and the plan of an order keep their shape: a
    rate only for an own factory, a build only for an own city without a factory, ``done_tick``
    exactly when nothing is owed, a request only while a planned order gathers. (Which
    player a snapshot is for is not in it, so the rule "own only" is the simulation's fog test,
    ``packages/sim/tests/test_dec41_view.py``.)"""
    raw = json.loads((FIXTURES_DIR / "server" / "snapshot.json").read_text())
    view = raw["view"]
    own, neutral, enemy = view["nodes"][0], view["nodes"][2], view["nodes"][3]
    order_group = next(g for g in view["groups"] if g["order"] is not None)

    def decode(**patch: object) -> None:
        decode_server(json.dumps({**raw, "view": {**view, **patch}}))

    def nodes(node: dict[str, object], **fields: object) -> list[dict[str, object]]:
        return [{**n, **fields} if n is node else n for n in view["nodes"]]

    def order(**fields: object) -> list[dict[str, object]]:
        patched: dict[str, object] = {**order_group, "order": {**order_group["order"], **fields}}
        return [patched if g is order_group else g for g in view["groups"]]

    built = {"done_tick": 220, "owed": 0}
    unpaid = {"done_tick": None, "owed": 2}
    decode(nodes=nodes(own, factory=True, factory_period=50))
    decode(nodes=nodes(own, factory=False, factory_build=built))
    decode(nodes=nodes(own, factory=False, factory_build=unpaid))
    decode(nodes=nodes(enemy, factory=True))  # next to an own node (DEC-31 rule)
    decode(groups=order(planned=True, gathering=True, plan=2, next_charge_tick=150))
    bad: list[dict[str, object]] = [
        {"nodes": nodes(own, factory=False, factory_period=50)},
        {"nodes": nodes(neutral, factory=True)},
        {"nodes": nodes(own, factory=False, factory_build={"done_tick": None, "owed": 0})},
        {"nodes": nodes(own, factory=False, factory_build={"done_tick": 10, "owed": 1})},
        {"nodes": nodes(own, building={"kind": "barracks", "done_tick": None, "owed": 0})},
        {"groups": order(planned=True, gathering=True, plan=2, next_charge_tick=None)},
        {"groups": order(planned=False, gathering=True, plan=2, next_charge_tick=150)},
        {"groups": order(planned=True, gathering=False, plan=2, next_charge_tick=None)},
    ]
    for patch in bad:
        with pytest.raises(ValidationError):
            decode(**patch)


def test_the_terrain_mark_is_validated() -> None:
    """#791: a non-zero terrain mark of a node with an owner, never in fog. (Who carries it is the
    simulation's fog test, ``packages/sim/tests/test_terrain_mark.py``.)"""
    raw = json.loads((FIXTURES_DIR / "server" / "snapshot.json").read_text())
    view = raw["view"]
    own, neutral = view["nodes"][0], view["nodes"][2]

    def decode(node: object, mark: object) -> None:
        nodes = [{**n, "terrain_mark": mark} if n is node else n for n in view["nodes"]]
        decode_server(json.dumps({**raw, "view": {**view, "nodes": nodes}}))

    decode(own, 1)
    decode(own, -1)
    decode(own, None)
    for node, mark in ((own, 0), (neutral, 1)):
        with pytest.raises(ValidationError):
            decode(node, mark)


def test_supply_flow_fields_are_validated() -> None:
    """DEC-43, item E (#704): the flow fields of a node go together and only for an own node,
    ``flow_idle`` exactly when ``flow_next`` is empty, ``front_dist`` may be ``null`` (no field);
    the shift fields of ``me`` go together, the shift within its maximum. (The rule "own only"
    is the simulation's fog test, ``packages/sim/tests/test_dec43_view.py``.)"""
    raw = json.loads((FIXTURES_DIR / "server" / "snapshot.json").read_text())
    view = raw["view"]
    own, neutral = view["nodes"][0], view["nodes"][2]

    def decode(**patch: object) -> None:
        decode_server(json.dumps({**raw, "view": {**view, **patch}}))

    def nodes(node: dict[str, object], **fields: object) -> list[dict[str, object]]:
        return [{**n, **fields} if n is node else n for n in view["nodes"]]

    def me(**fields: object) -> dict[str, object]:
        return {**view["me"], **fields}

    sending: dict[str, object] = {
        "front_dist": 2,
        "flow_down": [1],
        "flow_next": [1],
        "flow_idle": None,
    }
    idle: dict[str, object] = {
        "front_dist": None,
        "flow_down": [],
        "flow_next": [],
        "flow_idle": "leaf",
    }
    decode(nodes=nodes(own, **sending, flow_pocket=False))
    decode(nodes=nodes(own, **idle, flow_pocket=True))
    decode(me=me(leaf_shift=1, leaf_shift_max=2, next_dispatch_tick=130))
    bad: list[dict[str, object]] = [
        {"nodes": nodes(neutral, **sending, flow_pocket=False)},
        {"nodes": nodes(own, **sending, flow_pocket=None)},
        {"nodes": nodes(own, **{**sending, "flow_idle": "full"}, flow_pocket=False)},
        {"nodes": nodes(own, **{**idle, "flow_idle": None}, flow_pocket=False)},
        {"nodes": nodes(own, front_dist=1)},
        {"nodes": nodes(own, flow_idle="ahead")},
        {"me": me(leaf_shift=1, leaf_shift_max=None, next_dispatch_tick=130)},
        {"me": me(leaf_shift=3, leaf_shift_max=2, next_dispatch_tick=130)},
    ]
    for patch in bad:
        with pytest.raises(ValidationError):
            decode(**patch)


def test_protocol_version_is_a_positive_integer() -> None:
    assert type(PROTOCOL_VERSION) is int
    assert PROTOCOL_VERSION >= 1
    assert CLOSE_PROTOCOL_VERSION == 4001  # AGENTS.md, section 6
    assert CLOSE_REPLACED == 4009
    assert (CLOSE_NO_MATCH, CLOSE_POLICY) == (4004, 1008)


def test_hello_fixture_uses_the_current_protocol_version() -> None:
    msg = decode_client((FIXTURES_DIR / "client" / "hello.json").read_bytes())
    assert isinstance(msg, HelloMsg)
    assert msg.protocol_version == PROTOCOL_VERSION


def test_ruleset_public_has_the_stance_table_and_the_plan_pace_of_mvp_7() -> None:
    """The numbers of the stance menu (DEC-44, DEC-47: the periods of ``rulesets/mvp-7.toml``)
    and of the gathering of a planned order (DEC-41, item 10)."""
    public = RulesetPublic.from_ruleset(load_ruleset(RULESET_PATH))
    assert public.stances.model_dump() == {
        "cp_period_ticks": {"economy": 100, "balance": 50, "war": 40},
        "capital_period_ticks": {"economy": 100, "balance": 200, "war": 400},
        "factories_follow": True,
    }
    assert public.factory.built_period_ticks is None  # DEC-47: every factory follows the stance
    assert public.orders.model_dump() == {"plan_ticks_per_bonus": 30}
    # The overcrowding countdown of ui-style 12 (rulesets/mvp-7.toml, [capacity]).
    assert public.capacity.model_dump() == {"attrition_ticks": 30, "grace_ticks": 50}


def test_ruleset_public_takes_values_from_the_ruleset() -> None:
    rules = load_ruleset(RULESET_PATH)
    public = RulesetPublic.from_ruleset(rules)
    assert public.tick_hz == rules.tick_hz
    assert public.match_ticks == rules.match_ticks
    assert (public.cp.cap, public.cp.per_period) == (rules.cp.cap, rules.cp.per_period)
    cost = rules.orders.cost
    assert public.cost.model_dump() == {
        "move": cost.move,
        "planned_move": cost.planned_move,
        "cancel": cost.cancel,
        "split": cost.split,
        "merge": cost.merge,
        "recruit": cost.recruit,
        "stance": cost.stance,
        "barracks": cost.barracks,
    }
    mod = rules.terrain.defense_mod
    assert public.combat.terrain_defense_mod.model_dump() == {
        "plains": mod.plains,
        "forest": mod.forest,
        "mountains": mod.mountains,
    }
    assert public.combat.retreat == rules.combat.retreat
    assert public.supply_dispatch_ticks == rules.supply.dispatch_ticks
    assert public.city_upgrades.model_dump() == {
        "barracks_ticks": rules.city_upgrades.barracks_ticks,
        "barracks_charges": rules.city_upgrades.barracks_charges,
        "warehouse_province": rules.warehouse.province,
    }
    assert public.fort.model_dump() == {
        "cost": rules.fort.cost,
        "build_ticks": rules.fort.build_ticks,
        "toll_units": rules.fort.toll_units,
        "toll_charges": rules.fort.toll_charges,
    }


def test_ruleset_public_vision_table_is_dec_21_item_2() -> None:
    """Expected values come from mechanics.md (DEC-21, item 2), not from the loader: plains and
    plains exact; mountains see plains exactly; forest is always a range; from plains and from
    forest only presence is seen in mountains; the rest is a range."""
    public = RulesetPublic.from_ruleset(load_ruleset(RULESET_PATH))
    assert public.vision.model_dump(mode="json") == {
        "by_terrain": {
            "plains": {"plains": "exact", "forest": "range", "mountains": "presence"},
            "forest": {"plains": "range", "forest": "range", "mountains": "presence"},
            "mountains": {"plains": "exact", "forest": "range", "mountains": "range"},
        }
    }


def test_ruleset_public_has_the_combat_vector_parameter_names() -> None:
    """The vectors' ``params`` use the names of ``combat``; the vectors are the rows of DEC-24
    without ``retreat`` (DEC-40: row 21N sets it)."""
    params = _load(FIXTURES_DIR.parent / "vectors" / "combat.json")["params"]
    assert isinstance(params, dict)
    names = set(cast(dict[str, object], params))
    public = set(CombatPublic.model_fields) - {"retreat"}
    assert names == public


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
