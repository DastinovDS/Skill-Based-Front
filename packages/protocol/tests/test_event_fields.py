"""The fields of an event are a declared contract (ARC-02, #457).

``event_for_player`` filters by kind and by field: a field the simulation adds to an event reaches
nobody until it is declared in ``EVENT_FIELDS``, and only the declared id fields are turned into
opaque ids. A public or fight event goes to the opponent, so declaring a field there is a fog
decision (AGENTS.md 4.4, section 10). The expected values below come from the declared table and
the AGENTS.md rules, not from the output of the code.
"""

import ast
import json
from pathlib import Path
from typing import Any

import pytest

import gow_sim
from gow_protocol.codec import encode
from gow_protocol.convert import (
    EVENT_FIELDS,
    EVENT_ID_FIELDS,
    FIGHT_KINDS,
    PRIVATE_KINDS,
    PUBLIC_KINDS,
    event_for_player,
)
from gow_protocol.messages import EventMsg
from gow_protocol.schema import EVENT_FIELDS_PATH, event_fields_vector
from gow_sim.maps import PLAYERS
from gow_sim.state import EventValue, event
from gow_sim.view import opaque_id

KEY = b"arc-02 test match key, 32 bytes!"
SIM_SRC = Path(gow_sim.__file__).resolve().parent
FIXTURES_DIR = Path(__file__).resolve().parents[1] / "fixtures"
SENT_KINDS = PUBLIC_KINDS | PRIVATE_KINDS | FIGHT_KINDS
UNSENT_KINDS = {"match_ended"}
"""Simulation events no player gets as an ``event`` message (the result is ``match_end``)."""
REGENERATE = "mise run regen:protocol"


# The table -----------------------------------------------------------------------------------


def test_the_table_covers_exactly_the_kinds_that_are_sent() -> None:
    assert set(EVENT_FIELDS) == SENT_KINDS
    assert not (PUBLIC_KINDS & PRIVATE_KINDS or PUBLIC_KINDS & FIGHT_KINDS)
    assert not PRIVATE_KINDS & FIGHT_KINDS


def test_the_id_fields_are_declared_fields() -> None:
    assert set(EVENT_ID_FIELDS) <= set(EVENT_FIELDS)
    for kind, ids in EVENT_ID_FIELDS.items():
        assert ids <= set(EVENT_FIELDS[kind]), kind


def test_every_kind_names_its_player() -> None:
    """A private kind is routed by ``player`` (``owner`` for ``warehouse_lost``)."""
    for kind in PRIVATE_KINDS:
        assert ("owner" if kind == "warehouse_lost" else "player") in EVENT_FIELDS[kind], kind


def test_the_committed_vector_is_current() -> None:
    committed: object = json.loads(EVENT_FIELDS_PATH.read_text(encoding="utf-8"))
    assert committed == event_fields_vector(), f"event_fields.json is out of date: {REGENERATE}"


def test_the_event_fixture_has_declared_fields_only() -> None:
    fixture = json.loads((FIXTURES_DIR / "server" / "event.json").read_text(encoding="utf-8"))
    assert set(fixture["data"]) <= set(EVENT_FIELDS[fixture["kind"]])


# The table against the emitters --------------------------------------------------------------


def _emitted() -> tuple[dict[str, set[str]], set[str]]:
    """The keyword names of every ``event(tick, "<kind>", ...)`` call in ``gow_sim``, by kind,
    and the kinds with a call that also splats ``**data`` (its names are not all visible)."""
    fields: dict[str, set[str]] = {}
    splatted: set[str] = set()
    for path in sorted(SIM_SRC.rglob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            if getattr(func, "id", getattr(func, "attr", None)) != "event":
                continue
            where = f"{path.name}:{node.lineno}"
            kind = node.args[1] if len(node.args) >= 2 else None
            # A kind that is not a literal would bypass this check: reject it.
            assert isinstance(kind, ast.Constant), f"{where}: event kind must be a literal"
            names = fields.setdefault(str(kind.value), set())
            for kw in node.keywords:
                if kw.arg is None:
                    splatted.add(str(kind.value))
                else:
                    names.add(kw.arg)
    return fields, splatted


def test_the_table_matches_the_emitters() -> None:
    """A new event kind or field in the simulation fails here until the table is updated (with a
    fog test for a public or fight kind), and a declared field nobody emits is a stale entry."""
    emitted, splatted = _emitted()
    assert set(emitted) == SENT_KINDS | UNSENT_KINDS
    for kind in sorted(SENT_KINDS):
        declared = set(EVENT_FIELDS[kind])
        assert emitted[kind] <= declared, f"{kind}: undeclared {sorted(emitted[kind] - declared)}"
        if kind not in splatted:
            assert declared <= emitted[kind], f"{kind}: stale {sorted(declared - emitted[kind])}"


# The filter ----------------------------------------------------------------------------------


def _sample(kind: str) -> dict[str, int]:
    """Every declared field with an int, an id field with a value like a sequential id."""
    return {name: 100 + i for i, name in enumerate(EVENT_FIELDS[kind])}


def _receiver(kind: str, data: dict[str, int]) -> list[int]:
    if kind in PRIVATE_KINDS:
        return [data["owner" if kind == "warehouse_lost" else "player"]]
    return list(PLAYERS)


@pytest.mark.parametrize("kind", sorted(SENT_KINDS))
def test_an_undeclared_field_never_reaches_a_player(kind: str) -> None:
    data = _sample(kind)
    extra: dict[str, EventValue] = {
        "defender_group": 12,
        "defender_charged": 5,
        "hidden_group": 77,
        "secret": "x",
    }
    for player in _receiver(kind, data):
        msg = event_for_player(event(100, kind, **data, **extra), player, KEY)
        assert isinstance(msg, EventMsg)
        assert set(msg.data) == set(EVENT_FIELDS[kind])
        frame = encode(msg)
        assert "defender" not in frame
        assert "hidden_group" not in frame
        assert "secret" not in frame


@pytest.mark.parametrize("kind", sorted(SENT_KINDS))
def test_only_the_declared_id_fields_are_translated(kind: str) -> None:
    data = _sample(kind)
    ids = EVENT_ID_FIELDS.get(kind, frozenset())
    for player in _receiver(kind, data):
        msg = event_for_player(event(100, kind, **data), player, KEY)
        assert isinstance(msg, EventMsg)
        for name, value in data.items():
            if name in ids:
                assert msg.data[name] == str(opaque_id(KEY, player, value)), name
            else:
                assert msg.data[name] == value, name


def test_an_undeclared_id_is_dropped_not_sent_as_the_internal_number() -> None:
    """A group id under a new key (the sequential internal id) must not go out as it is."""
    raw = event(
        100,
        "fight_started",
        fight=3,
        node=7,
        edge=None,
        point=None,
        attacker=1,
        defender_group=12,
        defender_charged=5,
    )
    for player in PLAYERS:
        msg = event_for_player(raw, player, KEY)
        assert isinstance(msg, EventMsg)
        expected: dict[str, Any] = {
            "attacker": 1,
            "edge": None,
            "fight": str(opaque_id(KEY, player, 3)),
            "node": 7,
            "point": None,
        }
        assert msg.data == expected


@pytest.mark.parametrize("kind", sorted(PUBLIC_KINDS | FIGHT_KINDS))
def test_a_public_or_fight_event_has_the_same_fields_for_both_players(kind: str) -> None:
    raw = event(100, kind, **_sample(kind), defender_charged=5)
    first, second = (event_for_player(raw, p, KEY) for p in PLAYERS)
    assert isinstance(first, EventMsg)
    assert isinstance(second, EventMsg)
    assert set(first.data) == set(second.data) == set(EVENT_FIELDS[kind])
