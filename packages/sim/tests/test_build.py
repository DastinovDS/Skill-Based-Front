"""Road upgrades (SIM-11): upgrade_gain table, buffer edges, interruption rules of the build.

Expected values come from the rules, not from the code:

- capacity gains by width, mechanics.md, section 9: +1.0 / +1.5 / +2.0 / +2.3 / +2.6, so the next
  level gives +0.5 / +0.5 / +0.3 / +0.3 (in hundredths: 50 / 50 / 30 / 30);
- packet speed by width, ``rulesets/mvp-0.toml`` ``[supply.packet_speed_pct]``:
  100 / 125 / 150 / 175 / 200, so every level gives +25 percentage points;
- only internal roads can be upgraded, buffer roads by nobody (mechanics.md, section 8);
- a build is lost by leaving or a fight (SIM-11); further details: defaults of #124.

These numbers are pinned in ``RULES`` below. The map ``fork`` (rot180), see ``test_capacity.py``:

    0 (capital of 0, base 4) -e0 w2- 1 (base 2) -e2 w2- 3 (base 2) -e4 w1- 4 (base 2) ...
    0 -e1 w1- 2 (base 2) -e3 w3- 3;   all max_width 5
"""

import dataclasses
from pathlib import Path

import pytest

from gow_sim.commands import (
    Command,
    Merge,
    Move,
    PlayerCommand,
    Reject,
    RejectCode,
    SetMode,
    Split,
    UpgradeRoad,
    apply_commands,
    validate,
)
from gow_sim.maps import load_map
from gow_sim.ruleset import BuildRules, CapacityRules, Ruleset, WidthTable, load_ruleset
from gow_sim.state import AtNode, GameState, Group, Mode, OnEdge, from_canonical, initial_state
from gow_sim.state import to_canonical as state_to_canonical
from gow_sim.systems.build import UpgradeGain, build, interrupt_build, upgrade_gain
from gow_sim.systems.capacity import change_owner, city_capacity, city_capacity_centi

TESTS_DIR = Path(__file__).resolve().parent
MVP0 = TESTS_DIR.parents[2] / "rulesets" / "mvp-0.toml"


def _rules() -> Ruleset:
    base = load_ruleset(MVP0)
    return dataclasses.replace(
        base,
        capacity=CapacityRules(
            attrition_ticks=30,
            grace_ticks=50,
            width_gain_centi=WidthTable((100, 150, 200, 230, 260)),
        ),
        supply=dataclasses.replace(
            base.supply, packet_speed_pct=WidthTable((100, 125, 150, 175, 200))
        ),
        build=BuildRules(ticks_per_level=150),
    )


RULES = _rules()
CAPITAL_GROUP = 0
"""Id of player 0's starting group in its capital 0 (``initial_state`` numbers groups by node)."""


def _fork(owned: bool = True) -> GameState:
    state = initial_state(load_map(TESTS_DIR / "maps" / "fork.json"), RULES)
    if owned:
        state.nodes[3].owner = 0
        state.nodes[4].owner = 1
    return state


def _group(state: GameState, owner: int, node: int, units: int = 1) -> Group:
    gid = state.new_id()
    group = Group(gid, owner, units, 0, Mode.ATTACK, AtNode(node))
    state.groups[gid] = group
    return group


def _command(state: GameState, player: int, cmd: Command) -> None:
    results, _ = apply_commands(state, RULES, [PlayerCommand(player, 1, cmd)])
    assert not isinstance(results[0].outcome, Reject), results[0].outcome


# upgrade_gain ---------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("width", "expected"),
    [
        (1, UpgradeGain(capacity_centi=50, packet_speed_pct=25)),  # +1.0 -> +1.5
        (2, UpgradeGain(capacity_centi=50, packet_speed_pct=25)),  # +1.5 -> +2.0
        (3, UpgradeGain(capacity_centi=30, packet_speed_pct=25)),  # +2.0 -> +2.3
        (4, UpgradeGain(capacity_centi=30, packet_speed_pct=25)),  # +2.3 -> +2.6
        (5, None),  # max_width: nothing to gain
    ],
)
def test_upgrade_gain_table(width: int, expected: UpgradeGain | None) -> None:
    state = _fork()
    state.edges[1].width = width
    assert upgrade_gain(state, RULES, 1) == expected


def test_upgrade_gain_stops_at_the_edge_max_width() -> None:
    state = _fork()
    state.map = dataclasses.replace(
        state.map,
        edges=tuple(
            dataclasses.replace(e, max_width=3) if e.id == 1 else e for e in state.map.edges
        ),
    )
    state.edges[1].width = 3
    assert upgrade_gain(state, RULES, 1) is None


@pytest.mark.parametrize("edge", [0, 1, 2, 3])
@pytest.mark.parametrize("width", [1, 2, 3, 4])
def test_upgrade_gain_equals_the_capacity_difference(edge: int, width: int) -> None:
    state = _fork()
    state.edges[edge].width = width
    gain = upgrade_gain(state, RULES, edge)
    assert gain is not None
    ends = (state.map.edges[edge].a, state.map.edges[edge].b)
    before = [city_capacity_centi(state, RULES, n) for n in ends]
    state.edges[edge].width += 1
    after = [city_capacity_centi(state, RULES, n) for n in ends]
    assert [a - b for a, b in zip(after, before, strict=True)] == [gain.capacity_centi] * 2


def test_capacity_rounds_the_upgraded_sum_down() -> None:
    state = _fork()
    # City 3: 2 + e2 (w2, +1.5) + e3 (w3, +2.0) = 5.5 -> 5; e2 to w3: 2 + 2.0 + 2.0 = 6.
    assert (city_capacity_centi(state, RULES, 3), city_capacity(state, RULES, 3)) == (550, 5)
    state.edges[2].width = 3
    assert (city_capacity_centi(state, RULES, 3), city_capacity(state, RULES, 3)) == (600, 6)


# UpgradeRoad validation -----------------------------------------------------------------------


def test_upgrade_road_on_a_buffer_edge_is_rejected() -> None:
    state = _fork()
    group = _group(state, 0, 3)
    # e4 joins own 3 and enemy 4: a buffer road, nobody may upgrade it.
    assert validate(state, RULES, 0, UpgradeRoad(group.id, 4)) == Reject(RejectCode.NOT_INTERNAL)
    # e2 joins own 1 and neutral 3: also a buffer road.
    state.nodes[3].owner = None
    other = _group(state, 0, 1)
    assert validate(state, RULES, 0, UpgradeRoad(other.id, 2)) == Reject(RejectCode.NOT_INTERNAL)


def test_upgrade_road_on_an_enemy_internal_edge_is_rejected() -> None:
    state = _fork()
    group = _group(state, 0, 4)  # an own group in the enemy city 4 (e.g. after a fight)
    assert validate(state, RULES, 0, UpgradeRoad(group.id, 5)) == Reject(RejectCode.NOT_INTERNAL)


# Build system rules ---------------------------------------------------------------------------


def _run(state: GameState, ticks: int) -> list[tuple[int, str, object]]:
    """Step only the build system; ``(tick, kind, width or reason)`` of its events."""
    out: list[tuple[int, str, object]] = []
    for _ in range(ticks):
        state.tick += 1
        for e in build(state, RULES):
            out.append((e.tick, e.kind, e.get("width" if e.kind == "road_upgraded" else "reason")))
    return out


def test_a_level_takes_ticks_per_level_from_the_start() -> None:
    state = _fork()
    state.tick = 10
    _command(state, 0, UpgradeRoad(CAPITAL_GROUP, 1))  # applied at tick 10
    assert _run(state, 150) == [(160, "road_upgraded", 2)]  # 10 + 150


def test_leaving_loses_the_progress() -> None:
    state = _fork()
    state.tick = 1
    _command(state, 0, UpgradeRoad(CAPITAL_GROUP, 1))
    assert _run(state, 99) == []
    _command(state, 0, Move(CAPITAL_GROUP, 1))  # tick 100: a move order
    group = state.groups[CAPITAL_GROUP]
    assert (group.build_edge, group.build_since) == (None, None)
    state.tick += 1
    _command(state, 0, UpgradeRoad(CAPITAL_GROUP, 1))  # tick 101: a new build from zero
    assert _run(state, 200) == [(251, "road_upgraded", 2)]


def test_a_fight_loses_the_progress() -> None:
    state = _fork()
    state.tick = 1
    _command(state, 0, UpgradeRoad(CAPITAL_GROUP, 1))
    _run(state, 99)
    interrupt_build(state.groups[CAPITAL_GROUP])  # what combat (SIM-09) does to a fighter
    assert _run(state, 300) == []
    assert state.edges[1].width == 1


@pytest.mark.parametrize(
    "cmd",
    [SetMode(CAPITAL_GROUP, Mode.ATTACK), SetMode(CAPITAL_GROUP, Mode.DEFENSE)],
    ids=["attack", "defense"],
)
def test_a_mode_change_stops_the_build(cmd: SetMode) -> None:
    state = _fork()
    state.tick = 1
    _command(state, 0, UpgradeRoad(CAPITAL_GROUP, 1))
    state.tick = 50
    _command(state, 0, cmd)
    assert _run(state, 300) == []


def test_merge_stops_the_build_and_split_keeps_it() -> None:
    state = _fork()
    state.tick = 1
    _command(state, 0, UpgradeRoad(CAPITAL_GROUP, 1))
    _command(state, 0, Split(CAPITAL_GROUP, 1))  # the new group does not build
    (new,) = [gid for gid in state.groups if gid not in (0, 1)]
    assert state.groups[new].build_edge is None
    assert _run(state, 150) == [(151, "road_upgraded", 2)]  # the original group builds on
    _command(state, 0, Merge((CAPITAL_GROUP, new)))
    assert _run(state, 300) == []


def test_edge_turning_into_a_buffer_stops_the_build() -> None:
    state = _fork()
    state.tick = 1
    _command(state, 0, UpgradeRoad(CAPITAL_GROUP, 1))
    _run(state, 49)
    state.tick += 1
    change_owner(state, 2, 1)  # tick 51: the enemy takes the other end of e1
    assert [(e.kind, e.get("reason")) for e in build(state, RULES)] == [
        ("build_stopped", "interrupted")
    ]
    change_owner(state, 2, 0)  # retaken: the build does not resume by itself
    assert _run(state, 300) == []
    assert state.edges[1].width == 1


def test_a_group_off_the_edge_end_stops_building() -> None:
    state = _fork()
    state.tick = 1
    _command(state, 0, UpgradeRoad(CAPITAL_GROUP, 1))
    # The group is on an edge (moved by something other than a Move order): no longer at an end.
    state.groups[CAPITAL_GROUP].location = OnEdge(edge=0, from_node=0, progress=100)
    assert _run(state, 1) == [(2, "build_stopped", "interrupted")]


def test_builders_of_one_edge_have_their_own_progress() -> None:
    state = _fork()
    state.tick = 1
    _command(state, 0, UpgradeRoad(CAPITAL_GROUP, 1))  # from the capital end, tick 1
    other = _group(state, 0, 2)
    state.tick = 51
    _command(state, 0, UpgradeRoad(other.id, 1))  # from the other end, tick 51
    assert _run(state, 400) == [
        (151, "road_upgraded", 2),
        (201, "road_upgraded", 3),
        (301, "road_upgraded", 4),
        (351, "road_upgraded", 5),
        (351, "build_stopped", "max_width"),
        (351, "build_stopped", "max_width"),
    ]


def test_finished_road_ends_the_build_the_mode_stays() -> None:
    state = _fork()
    state.edges[1].width = 4
    state.tick = 1
    _command(state, 0, UpgradeRoad(CAPITAL_GROUP, 1))
    assert _run(state, 400) == [(151, "road_upgraded", 5), (151, "build_stopped", "max_width")]
    group = state.groups[CAPITAL_GROUP]
    assert (group.mode, group.build_edge, group.build_since) == (Mode.BUILD, None, None)
    assert validate(state, RULES, 0, UpgradeRoad(CAPITAL_GROUP, 1)) == Reject(RejectCode.MAX_WIDTH)


def test_build_state_roundtrips_through_the_canonical_form() -> None:
    state = _fork()
    state.tick = 7
    _command(state, 0, UpgradeRoad(CAPITAL_GROUP, 1))
    restored = from_canonical(state_to_canonical(state))
    assert restored.groups[CAPITAL_GROUP].build_since == 7
    assert restored == state
