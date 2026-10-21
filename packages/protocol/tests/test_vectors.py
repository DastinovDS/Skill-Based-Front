"""Structure checks for the shared test vectors (packages/protocol/vectors).

Only the file format and internal consistency are checked here. The expected values come from
docs/design/mechanics.md (DEC-24, which keeps the outcomes of DEC-07) and are exercised against the
real combat code (``packages/sim/tests/test_combat.py``).
"""

import json
import tomllib
from pathlib import Path
from typing import cast

import pytest

from gow_protocol.convert import FIGHT_KINDS, PRIVATE_KINDS, PUBLIC_KINDS

VECTORS_DIR = Path(__file__).resolve().parents[1] / "vectors"
COMBAT_PATH = VECTORS_DIR / "combat.json"
RULESET_PATH = Path(__file__).resolve().parents[3] / "rulesets" / "mvp-0.toml"

SIDES = ("a", "b")
LOCATIONS = {"node_attack", "edge_meeting", "neutral_arrival", "empty_enemy_node"}
TERRAINS = {"mountains", "forest", "plains"}
ROLES = {"attacker", "defender", "symmetric"}
BONUS_SOURCES = {"planned_order", "defense_mode"}
MODES = {"attack", "defense", "build"}
OWNERS = {"a", "b", "neutral"}

VECTOR_KEYS = {
    "id",
    "source_row",
    "location",
    "terrain",
    "node_owner_before",
    "sides",
    "expected",
    "note",
}
EXPECTED_KEYS = {
    "fight",
    "end_after",
    "rounds",
    "trace",
    "shots",
    "losses",
    "groups",
    "bounce",
    "node_owner_after",
    "continues_on_edge",
    "goes_on_after",
}


def _obj(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


def _list(value: object) -> list[object]:
    assert isinstance(value, list)
    return cast(list[object], value)


def _int(value: object) -> int:
    assert isinstance(value, int)
    assert not isinstance(value, bool)
    return value


def _bool(value: object) -> bool:
    assert isinstance(value, bool)
    return value


def _per_side(value: object) -> dict[str, object]:
    obj = _obj(value)
    assert set(obj) == set(SIDES)
    return obj


def _load_combat() -> dict[str, object]:
    return _obj(json.loads(COMBAT_PATH.read_text(encoding="utf-8")))


def _combat_vectors() -> list[dict[str, object]]:
    return [_obj(v) for v in _list(_load_combat()["vectors"])]


def _groups(value: object) -> dict[int, tuple[int, int]]:
    """Map group id -> (units, charged), checking 0 <= charged <= units."""
    result: dict[int, tuple[int, int]] = {}
    for raw in _list(value):
        group = _obj(raw)
        gid = _int(group["id"])
        units = _int(group["units"])
        charged = _int(group["charged"])
        assert 0 <= charged <= units
        assert gid not in result
        result[gid] = (units, charged)
    return result


def test_combat_header() -> None:
    data = _load_combat()
    assert set(data) == {"schema_version", "source", "params", "vectors", "scenarios"}
    assert _int(data["schema_version"]) == 2
    assert isinstance(data["source"], str)
    params = _obj(data["params"])
    assert set(params) == {
        "terrain_defense_mod",
        "defense_bonus",
        "round_ticks",
        "shots_per_round",
        "regroup_ticks",
    }
    terrain = _obj(params["terrain_defense_mod"])
    assert set(terrain) == TERRAINS
    for mod in terrain.values():
        _int(mod)
    _int(params["defense_bonus"])
    assert _int(params["round_ticks"]) > 0
    assert _int(params["shots_per_round"]) > 0
    assert _int(params["regroup_ticks"]) >= 0
    scenarios = [_obj(s) for s in _list(data["scenarios"])]
    assert [s["id"] for s in scenarios] == ["17", "17б", "17в", "18", "19", "20", "21", "22", "23"]  # noqa: RUF001
    for scenario in scenarios:
        assert set(scenario) == {"id", "source_row", "expected"}
        assert isinstance(scenario["source_row"], str) and scenario["source_row"]
        _obj(scenario["expected"])


def test_combat_params_match_mvp0_ruleset() -> None:
    params = _obj(_load_combat()["params"])
    ruleset = _obj(tomllib.loads(RULESET_PATH.read_text(encoding="utf-8")))
    orders = _obj(ruleset["orders"])
    assert params["terrain_defense_mod"] == _obj(ruleset["terrain"])["defense_mod"]
    # «Защита» (+2) of the rows is a bonus gathered by the start of the fight (DEC-30), not a
    # number of the ruleset; the ruleset has the pace of gathering.
    assert _int(orders["defense_ticks_per_bonus"]) > 0
    combat = _obj(ruleset["combat"])
    for key in ("round_ticks", "shots_per_round", "regroup_ticks"):
        assert params[key] == combat[key]


def test_combat_ids_are_1_to_16() -> None:
    ids = [_int(v["id"]) for v in _combat_vectors()]
    assert ids == list(range(1, 17))


@pytest.mark.parametrize("vector", _combat_vectors(), ids=lambda v: f"example-{v['id']}")
def test_combat_vector_structure(vector: dict[str, object]) -> None:
    assert set(vector) == VECTOR_KEYS
    assert isinstance(vector["note"], str)
    assert vector["note"]
    row = _obj(vector["source_row"])
    assert set(row) == {"attack", "defense", "rounds", "result"}
    assert all(isinstance(cell, str) and cell for cell in row.values())

    location = vector["location"]
    assert location in LOCATIONS
    on_edge = location == "edge_meeting"
    symmetric = location in {"edge_meeting", "neutral_arrival"}

    terrain = vector["terrain"]
    assert terrain is None if symmetric else terrain in TERRAINS
    owner_before = vector["node_owner_before"]
    assert owner_before is None if on_edge else owner_before in OWNERS

    sides = _per_side(vector["sides"])
    initial: dict[str, dict[int, tuple[int, int]]] = {}
    for name in SIDES:
        side = _obj(sides[name])
        assert set(side) == {"role", "bonus", "groups"}
        expected_role = "symmetric" if symmetric else ("attacker" if name == "a" else "defender")
        assert side["role"] == expected_role
        if side["bonus"] is not None:
            bonus = _obj(side["bonus"])
            assert set(bonus) == {"source", "amount"}
            assert bonus["source"] in BONUS_SOURCES
            assert _int(bonus["amount"]) > 0
        for raw in _list(side["groups"]):
            assert _obj(raw)["mode"] in MODES
        initial[name] = _groups(side["groups"])
    all_ids = [gid for name in SIDES for gid in initial[name]]
    assert len(all_ids) == len(set(all_ids))
    assert initial["a"]
    assert bool(initial["b"]) == (location != "empty_enemy_node")

    expected = _obj(vector["expected"])
    assert set(expected) == EXPECTED_KEYS
    fight = _bool(expected["fight"])
    assert fight == (location != "empty_enemy_node")
    rounds = _int(expected["rounds"])
    round_ticks = _int(_obj(_load_combat()["params"])["round_ticks"])
    assert _int(expected["end_after"]) == round_ticks * rounds  # the end comes after a round
    assert fight == (rounds > 0)
    for raw in _list(expected["trace"]):
        step = _obj(raw)
        assert 1 <= _int(step["round"]) <= rounds
        for charged in _per_side(step["charged"]).values():
            assert _int(charged) >= 0
    if expected["shots"] is not None:
        assert on_edge
        for shots in _per_side(expected["shots"]).values():
            assert 0 <= _int(shots) <= rounds
    if expected["goes_on_after"] is not None:
        assert on_edge and _int(expected["goes_on_after"]) > _int(expected["end_after"])
    losses = _per_side(expected["losses"])
    after_groups = _per_side(expected["groups"])
    for name in SIDES:
        after = _groups(after_groups[name])
        assert set(after) == set(initial[name])
        for gid, (units, charged) in after.items():
            before_units, before_charged = initial[name][gid]
            assert units <= before_units
            # A group never gains charges in combat; losing units may only discharge it.
            assert charged <= before_charged
        lost = sum(u for u, _ in initial[name].values()) - sum(u for u, _ in after.values())
        assert _int(losses[name]) == lost
    for flag in _per_side(expected["bounce"]).values():
        _bool(flag)

    owner_after = expected["node_owner_after"]
    assert owner_after is None if on_edge else owner_after in OWNERS
    if on_edge:
        for flag in _per_side(expected["continues_on_edge"]).values():
            _bool(flag)
    else:
        assert expected["continues_on_edge"] is None


def test_event_kinds_vector_is_what_the_server_sends() -> None:
    """The client checks every one of these kinds has a feed text (or is hidden), see #184."""
    data = cast(dict[str, object], json.loads((VECTORS_DIR / "event_kinds.json").read_text()))
    assert data["kinds"] == sorted(PUBLIC_KINDS | PRIVATE_KINDS | FIGHT_KINDS)
