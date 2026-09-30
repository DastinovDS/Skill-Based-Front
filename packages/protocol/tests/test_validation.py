"""Bad messages are rejected with ValidationError only, and errors never show the token."""

import contextlib
import copy
import json
from collections.abc import Callable
from pathlib import Path
from typing import cast

import pytest
from hypothesis import given
from hypothesis import strategies as st
from pydantic import ValidationError

from gow_protocol.base import MAX_INT
from gow_protocol.codec import decode_client, decode_server, encode
from gow_protocol.messages import HelloMsg

FIXTURES_DIR = Path(__file__).resolve().parents[1] / "fixtures"
TOKEN = "fixture-token-not-a-secret_0123456789ABCDEF"

type Json = dict[str, object]


def _fixture(direction: str, name: str) -> Json:
    data: object = json.loads((FIXTURES_DIR / direction / f"{name}.json").read_text("utf-8"))
    return cast(Json, data)


def _node(data: object, *path: str | int) -> object:
    """The value at ``path`` inside ``data`` (dict keys and list indices)."""
    node = data
    for step in path:
        node = cast(list[object], node)[step] if isinstance(step, int) else cast(Json, node)[step]
    return node


def _at(data: object, *path: str | int) -> Json:
    return cast(Json, _node(data, *path))


def _edit(direction: str, name: str, change: Callable[[Json], object]) -> str:
    data = copy.deepcopy(_fixture(direction, name))
    change(data)
    return json.dumps(data)


def _cmd(**cmd: object) -> str:
    return json.dumps({"type": "command", "seq": 1, "cmd": cmd})


BAD_CLIENT_FRAMES: dict[str, str | bytes] = {
    "empty": b"",
    "invalid utf-8": b"\xff\xfe\xfd",
    "invalid json": '{"type": "ping", "id": 1',
    "not an object": "[1, 2, 3]",
    "json null": "null",
    "deep nesting": "[" * 100_000 + "]" * 100_000,
    "missing type": '{"id": 1}',
    "unknown type": '{"type": "shout", "id": 1}',
    "server type from client": '{"type": "pong", "id": 1}',
    "extra field": '{"type": "ping", "id": 1, "extra": 0}',
    "missing field": '{"type": "ping"}',
    "float integer": '{"type": "ping", "id": 1.0}',
    "bool integer": '{"type": "ping", "id": true}',
    "string integer": '{"type": "ping", "id": "1"}',
    "negative integer": '{"type": "ping", "id": -1}',
    "integer above int32": f'{{"type": "ping", "id": {MAX_INT + 1}}}',
    "huge integer": '{"type": "ping", "id": ' + "9" * 5000 + "}",
    "nan": '{"type": "ping", "id": NaN}',
    "hello version zero": json.dumps({"type": "hello", "protocol_version": 0, "token": TOKEN}),
    "hello version string": json.dumps({"type": "hello", "protocol_version": "1", "token": TOKEN}),
    "hello token with space": json.dumps({"type": "hello", "protocol_version": 1, "token": "a b"}),
    "hello token too long": json.dumps(
        {"type": "hello", "protocol_version": 1, "token": "a" * 129}
    ),
    "hello empty token": json.dumps({"type": "hello", "protocol_version": 1, "token": ""}),
    "resync with field": '{"type": "resync", "id": 1}',
    "command seq zero": json.dumps({"type": "command", "seq": 0, "cmd": {"type": "forfeit"}}),
    "command without cmd": '{"type": "command", "seq": 1}',
    "unknown command": _cmd(type="teleport", group="g1", dest=1),
    "move float dest": _cmd(type="move", group="g1", dest=1.5, planned=False),
    "move without planned": _cmd(type="move", group="g1", dest=1),
    "move planned as int": _cmd(type="move", group="g1", dest=1, planned=1),
    "move integer group id": _cmd(type="move", group=5, dest=1, planned=False),
    "move bad opaque id": _cmd(type="move", group="g 1", dest=1, planned=False),
    "move long opaque id": _cmd(type="move", group="g" * 33, dest=1, planned=False),
    "split zero": _cmd(type="split", group="g1", n=0),
    "merge one group": _cmd(type="merge", groups=["g1"]),
    "merge duplicate groups": _cmd(type="merge", groups=["g1", "g1"]),
    "merge too many groups": _cmd(type="merge", groups=[f"g{i}" for i in range(17)]),
    "set_mode unknown mode": _cmd(type="set_mode", group="g1", mode="sleep"),
    "set_mode upper-case mode": _cmd(type="set_mode", group="g1", mode="ATTACK"),
    "set_stance unknown": _cmd(type="set_stance", stance="panic"),
    "upgrade_road negative edge": _cmd(type="upgrade_road", group="g1", edge=-1),
    "recruit without node": _cmd(type="recruit"),
    "forfeit with field": _cmd(type="forfeit", player=1),
}


@pytest.mark.parametrize("frame", BAD_CLIENT_FRAMES.values(), ids=BAD_CLIENT_FRAMES.keys())
def test_bad_client_frame_is_rejected(frame: str | bytes) -> None:
    with pytest.raises(ValidationError):
        decode_client(frame)


def _snapshot(change: Callable[[Json], None]) -> str:
    return _edit("server", "snapshot", change)


def _set(path: tuple[str | int, ...], key: str, value: object) -> Callable[[Json], None]:
    def change(data: Json) -> None:
        _at(data, *path)[key] = value

    return change


def _swap_nodes(data: Json) -> None:
    nodes = cast(list[object], _at(data, "view")["nodes"])
    nodes[0], nodes[1] = nodes[1], nodes[0]


def _duplicate_group(data: Json) -> None:
    groups = cast(list[object], _at(data, "view")["groups"])
    groups.append(copy.deepcopy(groups[0]))


VIEW = ("view",)
NODE0 = ("view", "nodes", 0)
NODE2 = ("view", "nodes", 2)
EDGE2 = ("view", "edges", 2)
GROUP0 = ("view", "groups", 0)

BAD_SERVER_FRAMES: dict[str, str | bytes] = {
    "client type from server": '{"type": "ping", "id": 1}',
    "welcome player 2": _edit("server", "welcome", lambda d: d.update(player=2)),
    "welcome player true": _edit("server", "welcome", lambda d: d.update(player=True)),
    "welcome bad map id": _edit("server", "welcome", lambda d: d.update(map_id="../etc")),
    "welcome float cost": _edit(
        "server", "welcome", lambda d: _at(d, "ruleset_public", "cost").update(move=1.5)
    ),
    "welcome extra ruleset field": _edit(
        "server", "welcome", lambda d: _at(d, "ruleset_public").update(secret=1)
    ),
    "ack path and reject": _edit("server", "ack_move", lambda d: d.update(reject_code="NO")),
    "ack empty path": _edit("server", "ack_move", lambda d: d.update(path=[])),
    "ack lower-case code": _edit("server", "ack_reject", lambda d: d.update(reject_code="no_cp")),
    "event float value": _edit("server", "event", lambda d: _at(d, "data").update(x=1.5)),
    "event nested value": _edit("server", "event", lambda d: _at(d, "data").update(x={"a": 1})),
    "event list value": _edit("server", "event", lambda d: _at(d, "data").update(x=[1])),
    "event upper-case key": _edit("server", "event", lambda d: _at(d, "data").update(Node=1)),
    "event bad kind": _edit("server", "event", lambda d: d.update(kind="Node Captured")),
    "event too many fields": _edit(
        "server", "event", lambda d: d.update(data={f"k{i}": i for i in range(33)})
    ),
    "match_end draw by capture": _edit("server", "match_end", lambda d: d.update(winner=None)),
    "match_end double defeat with winner": _edit(
        "server", "match_end_double_defeat", lambda d: d.update(winner=0)
    ),
    "match_end unknown reason": _edit("server", "match_end", lambda d: d.update(reason="boredom")),
    "match_end three vp": _edit("server", "match_end", lambda d: d.update(vp=[1, 2, 3])),
    "error without code": _edit("server", "error", lambda d: d.pop("code")),
    "error long message": _edit("server", "error", lambda d: d.update(message="x" * 201)),
    "snapshot enemy cp": _snapshot(_set(("view", "me"), "enemy_cp", 100)),
    "snapshot enemy stance": _snapshot(_set(VIEW, "enemy_stance", "war")),
    "snapshot one vp": _snapshot(_set(VIEW, "vp", [12])),
    "snapshot float cp": _snapshot(_set(("view", "me"), "cp", 2.5)),
    "snapshot nodes out of order": _snapshot(_swap_nodes),
    "snapshot duplicate group id": _snapshot(_duplicate_group),
    "snapshot presence with numbers": _snapshot(_set((*NODE2, "seen"), "enemy_units", 1)),
    "snapshot exact without numbers": _snapshot(_set((*NODE0, "seen"), "enemy_units", None)),
    "snapshot enemy charged above units": _snapshot(_set((*NODE0, "seen"), "enemy_charged", 1)),
    "snapshot fog sighting level": _snapshot(_set((*EDGE2, "seen"), "level", "fog")),
    "snapshot duplicate enemy modes": _snapshot(
        _set((*NODE2, "seen"), "enemy_modes", ["attack", "attack"])
    ),
    "snapshot warehouse of presence node": _snapshot(_set(NODE2, "warehouse", 3)),
    "snapshot exact node without warehouse": _snapshot(_set(NODE0, "warehouse", None)),
    "snapshot visible node without sighting": _snapshot(_set(NODE0, "seen", None)),
    "snapshot level differs from detail": _snapshot(
        _set(
            NODE2,
            "seen",
            {
                "tick": 120,
                "level": "exact",
                "enemy_modes": [],
                "enemy_units": 0,
                "enemy_charged": 0,
            },
        )
    ),
    "snapshot exact edge": _snapshot(_set(EDGE2, "detail", "exact")),
    "snapshot sighting from the future": _snapshot(_set((*EDGE2, "seen"), "tick", 121)),
    "snapshot stale sighting of a visible node": _snapshot(_set((*NODE0, "seen"), "tick", 119)),
    "snapshot charged above units": _snapshot(_set(GROUP0, "charged", 2)),
    "snapshot enemy group owner field": _snapshot(_set(GROUP0, "owner", 1)),
    "snapshot group on unknown node": _snapshot(_set((*GROUP0, "location"), "node", 9)),
    "snapshot progress above scale": _snapshot(
        _set(("view", "groups", 2, "location"), "progress", 1001)
    ),
    "snapshot intent with group id": _snapshot(_set(("view", "intents", 1), "group", "x")),
    "snapshot intent with size": _snapshot(_set(("view", "intents", 1), "units", 3)),
    "snapshot packet arrives before departure": _snapshot(
        _set(("view", "packets", 0), "arrive_tick", 100)
    ),
    "snapshot width zero": _snapshot(_set(EDGE2, "width", 0)),
}


@pytest.mark.parametrize("frame", BAD_SERVER_FRAMES.values(), ids=BAD_SERVER_FRAMES.keys())
def test_bad_server_frame_is_rejected(frame: str | bytes) -> None:
    with pytest.raises(ValidationError):
        decode_server(frame)


# The token never leaks ---------------------------------------------------------------------

TOKEN_FRAMES: dict[str, str] = {
    "bad version": json.dumps({"type": "hello", "protocol_version": "x", "token": TOKEN}),
    "extra field": json.dumps({"type": "hello", "protocol_version": 1, "token": TOKEN, "x": 1}),
    "token as a number field": json.dumps({"type": "ping", "id": TOKEN}),
    "unknown type": json.dumps({"type": "hellx", "protocol_version": 1, "token": TOKEN}),
    "missing type": json.dumps({"protocol_version": 1, "token": TOKEN}),
    "truncated json": json.dumps({"type": "hello", "protocol_version": 1, "token": TOKEN})[:-2],
    "token with a bad character": json.dumps(
        {"type": "hello", "protocol_version": 1, "token": TOKEN + "!"}
    ),
    "json string": json.dumps(TOKEN),
}


@pytest.mark.parametrize("frame", TOKEN_FRAMES.values(), ids=TOKEN_FRAMES.keys())
def test_validation_error_does_not_contain_the_token(frame: str) -> None:
    secret = TOKEN[:20]
    with pytest.raises(ValidationError) as caught:
        decode_client(frame)
    exc = caught.value
    assert secret not in str(exc)
    assert secret not in repr(exc)
    assert secret not in exc.json(include_input=False)
    assert secret not in repr(exc.errors(include_input=False, include_context=False))


def test_hello_repr_does_not_contain_the_token() -> None:
    msg = decode_client(json.dumps({"type": "hello", "protocol_version": 1, "token": TOKEN}))
    assert isinstance(msg, HelloMsg)
    assert msg.token == TOKEN
    assert TOKEN not in repr(msg)
    assert TOKEN not in str(msg)


# Fuzzing: any input gives a message or ValidationError, nothing else ------------------------


def _decode_both(frame: str | bytes) -> None:
    """Decode as both directions; anything but ValidationError propagates and fails the test."""
    for decode in (decode_client, decode_server):
        with contextlib.suppress(ValidationError):
            decode(frame)


@given(st.binary(max_size=512))
def test_arbitrary_bytes_raise_only_validation_error(frame: bytes) -> None:
    _decode_both(frame)


@given(st.text(max_size=256))
def test_arbitrary_text_raises_only_validation_error(frame: str) -> None:
    _decode_both(frame)


_json_scalars = (
    st.none()
    | st.booleans()
    | st.integers()
    | st.floats(allow_nan=False)
    | st.text(max_size=20)
    | st.sampled_from(["hello", "command", "ping", "snapshot", "ack", "move", "attack", "exact"])
)
_json_values = st.recursive(
    _json_scalars,
    lambda children: (
        st.lists(children, max_size=4)
        | st.dictionaries(
            st.sampled_from(["type", "id", "seq", "cmd", "tick", "view", "group", "data"])
            | st.text(max_size=8),
            children,
            max_size=4,
        )
    ),
    max_leaves=20,
)


@given(_json_values)
def test_arbitrary_json_raises_only_validation_error(value: object) -> None:
    frame = json.dumps(value)
    _decode_both(frame)


_ALL_FIXTURES = sorted(FIXTURES_DIR.glob("*/*.json"))


def _paths(node: object, prefix: tuple[str | int, ...] = ()) -> list[tuple[str | int, ...]]:
    """Every path to a value inside ``node``."""
    found: list[tuple[str | int, ...]] = []
    if isinstance(node, dict):
        for key, value in cast(Json, node).items():
            found.append((*prefix, key))
            found += _paths(value, (*prefix, key))
    elif isinstance(node, list):
        for index, value in enumerate(cast(list[object], node)):
            found.append((*prefix, index))
            found += _paths(value, (*prefix, index))
    return found


@given(st.data())
def test_mutated_fixture_is_a_message_or_validation_error(data: st.DataObject) -> None:
    path = data.draw(st.sampled_from(_ALL_FIXTURES))
    original: object = json.loads(path.read_text("utf-8"))
    mutated = copy.deepcopy(original)
    target = data.draw(st.sampled_from(_paths(mutated)))
    parent = _node(mutated, *target[:-1])
    replacement = data.draw(_json_values)
    if isinstance(parent, list):
        cast(list[object], parent)[cast(int, target[-1])] = replacement
    else:
        cast(Json, parent)[cast(str, target[-1])] = replacement
    decode = decode_client if path.parent.name == "client" else decode_server
    try:
        msg = decode(json.dumps(mutated))
    except ValidationError:
        return
    assert decode(encode(msg)) == msg
