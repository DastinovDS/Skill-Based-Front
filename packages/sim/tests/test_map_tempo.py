"""Map tempo (DEC-46, #803): ``[map_tempo]`` scales the economy periods by the map size.

The expected values are computed by hand from the formula of DEC-46 (mechanics.md, section 6):
``pct = isqrt(N * 10000 // ref_nodes)``, both steps rounded down, clamped to
``min_pct..max_pct``; a period ``p`` becomes ``max(1, p * 100 // pct)``, rounded down.
"""

import dataclasses
from pathlib import Path
from typing import cast

import pytest

from gow_sim.analysis import MatchLog, MatchRecorder, analyze
from gow_sim.maps import load_map
from gow_sim.match import HEADLESS_MATCH_KEY, Match
from gow_sim.ruleset import (
    MapTempoRules,
    Ruleset,
    RulesetError,
    StanceTable,
    apply_map_tempo,
    load_ruleset,
    parse_ruleset,
    ruleset_hash,
    to_canonical,
)
from gow_sim.state import event

TESTS = Path(__file__).resolve().parent
ROOT = TESTS.parents[2]
STANCES = ROOT / "rulesets" / "mvp-6.toml"
"""mvp-6: the stances of DEC-44 without ``[map_tempo]``, a built factory every 100 ticks."""
TEMPO = ROOT / "rulesets" / "mvp-7.toml"
"""mvp-7: with ``[map_tempo]`` (ref_nodes 49, 50..150) and the factories following the stance."""


def _tempo(min_pct: int = 50, max_pct: int = 150) -> MapTempoRules:
    return MapTempoRules(ref_nodes=49, min_pct=min_pct, max_pct=max_pct)


@pytest.mark.parametrize(
    ("nodes", "pct"),
    [
        # 29 * 10000 // 49 = 5918; 76 * 76 = 5776 <= 5918 < 77 * 77 = 5929
        (29, 76),
        # 30 * 10000 // 49 = 6122; 78 * 78 = 6084 <= 6122 < 79 * 79 = 6241
        (30, 78),
        # 38 * 10000 // 49 = 7755; 88 * 88 = 7744 <= 7755 < 89 * 89 = 7921
        (38, 88),
        # 39 * 10000 // 49 = 7959; 89 * 89 = 7921 <= 7959 < 90 * 90 = 8100
        (39, 89),
        # 44 * 10000 // 49 = 8979; 94 * 94 = 8836 <= 8979 < 95 * 95 = 9025
        (44, 94),
        # 48 * 10000 // 49 = 9795; 98 * 98 = 9604 <= 9795 < 99 * 99 = 9801
        (48, 98),
        (49, 100),
        # 51 * 10000 // 49 = 10408; 102 * 102 = 10404 <= 10408 < 103 * 103 = 10609
        (51, 102),
        # 54 * 10000 // 49 = 11020; 104 * 104 = 10816 <= 11020 < 105 * 105 = 11025
        (54, 104),
        # 6 * 10000 // 49 = 1224, isqrt 34, clamped up to 50
        (6, 50),
        # 12 * 10000 // 49 = 2448, isqrt 49 (49 * 49 = 2401), clamped up to 50
        (12, 50),
        # 13 * 10000 // 49 = 2653, isqrt 51 (51 * 51 = 2601 <= 2653 < 2704): no clamp
        (13, 51),
        # 111 * 10000 // 49 = 22653, isqrt 150 (150 * 150 = 22500 <= 22653 < 151 * 151 = 22801)
        (111, 150),
        # 200 * 10000 // 49 = 40816, isqrt 202, clamped down to 150
        (200, 150),
    ],
)
def test_the_multiplier_by_hand(nodes: int, pct: int) -> None:
    assert _tempo().pct(nodes) == pct


def test_without_the_section_the_rules_are_the_same_object() -> None:
    rules = load_ruleset(STANCES)
    mapdef = load_map(ROOT / "maps" / "narrows.json")
    assert apply_map_tempo(rules, mapdef) is rules
    match = Match(mapdef, rules, HEADLESS_MATCH_KEY)
    assert match.rules is rules and match.source_rules is rules


def test_the_section_is_left_out_of_the_hash_when_absent() -> None:
    rules = load_ruleset(STANCES)
    assert "map_tempo" not in to_canonical(rules)
    tempo = dataclasses.replace(rules, map_tempo=_tempo())
    assert to_canonical(tempo)["map_tempo"] == {
        "ref_nodes": 49,
        "min_pct": 50,
        "max_pct": 150,
    }
    assert parse_ruleset(to_canonical(tempo)) == tempo
    assert ruleset_hash(tempo) != ruleset_hash(rules)


def test_narrows_sqrt_scales_every_economy_period_and_nothing_else() -> None:
    # narrows: 29 nodes, sqrt pct 76. Periods p * 100 // 76: 100 -> 131, 200 -> 263,
    # 80 -> 105, 400 -> 526.
    rules = load_ruleset(TEMPO)
    mapdef = load_map(ROOT / "maps" / "narrows.json")
    assert len(mapdef.nodes) == 29
    played = apply_map_tempo(rules, mapdef)
    assert played.map_tempo is None
    cp, capital = played.stances.cp_period_ticks, played.stances.capital_period_ticks
    assert (cp.economy, cp.balance, cp.war) == (263, 131, 105)
    assert (capital.economy, capital.balance, capital.war) == (131, 263, 526)
    assert played.factory.built_period_ticks is None  # DEC-47: every factory follows the stance
    # The rest is the ruleset as given: only the stance periods and [map_tempo] differ.
    assert dataclasses.replace(played, stances=rules.stances) == dataclasses.replace(
        rules, map_tempo=None
    )


def test_the_built_period_scales_too() -> None:
    # mvp-6 has a built period (100) and no section; with the section on narrows (pct 76):
    # 100 * 100 // 76 = 131.
    rules = dataclasses.replace(load_ruleset(STANCES), map_tempo=_tempo())
    played = apply_map_tempo(rules, load_map(ROOT / "maps" / "narrows.json"))
    assert played.factory.built_period_ticks == 131


@pytest.mark.parametrize(
    ("path", "nodes", "cp", "capital"),
    [
        # pct 102 (51 nodes): 100 * 100 // 102 = 98, 200 * 100 // 102 = 196
        ("ridge.json", 51, 98, 196),
        # pct 104 (54 nodes): 10000 // 104 = 96, 20000 // 104 = 192
        ("gen/gen1-58.json", 54, 96, 192),
        # pct 88 (38 nodes): 10000 // 88 = 113, 20000 // 88 = 227
        ("gen/gen1-25.json", 38, 113, 227),
    ],
)
def test_balance_periods_of_other_maps(path: str, nodes: int, cp: int, capital: int) -> None:
    mapdef = load_map(ROOT / "maps" / path)
    assert len(mapdef.nodes) == nodes
    played = apply_map_tempo(load_ruleset(TEMPO), mapdef)
    assert played.stances.cp_period_ticks.balance == cp
    assert played.stances.capital_period_ticks.balance == capital


def test_ref_nodes_keeps_todays_numbers() -> None:
    rules = load_ruleset(TEMPO)
    for name in ("crossroads", "highway"):
        played = apply_map_tempo(rules, load_map(ROOT / "maps" / f"{name}.json"))
        assert played == dataclasses.replace(rules, map_tempo=None)


def test_a_period_never_drops_below_one() -> None:
    rules = load_ruleset(STANCES)
    ones = StanceTable(economy=1, balance=1, war=1)
    tiny = dataclasses.replace(
        rules,
        stances=dataclasses.replace(rules.stances, cp_period_ticks=ones),
        map_tempo=MapTempoRules(ref_nodes=1, min_pct=1000, max_pct=1000),
    )
    played = apply_map_tempo(tiny, load_map(ROOT / "maps" / "narrows.json"))
    assert played.stances.cp_period_ticks == ones  # 1 * 100 // 1000 = 0, at least 1
    assert played.factory.built_period_ticks == 10  # 100 * 100 // 1000


def test_the_match_plays_the_scaled_rules_and_the_replay_names_the_given_ones() -> None:
    # line6: 6 nodes, sqrt 34 clamped to 50: every period doubles. Balance: CP every 200 ticks.
    rules = dataclasses.replace(load_ruleset(STANCES), map_tempo=_tempo())
    match = Match(load_map(TESTS / "maps" / "line6.json"), rules, HEADLESS_MATCH_KEY)
    assert match.source_rules is rules
    assert match.rules.stances.cp_period_ticks.balance == 200
    start = match.state.players[0].cp
    for _ in range(199):
        match.step()
    assert match.state.players[0].cp == start
    match.step()  # tick 200
    assert match.state.players[0].cp == start + rules.cp.per_period


def test_bad_sections_are_rejected() -> None:
    rules = dataclasses.replace(load_ruleset(STANCES), map_tempo=_tempo())
    data = to_canonical(rules)
    tempo = cast(dict[str, object], data["map_tempo"])
    for key, value in (("form", "sqrt"), ("ref_nodes", 0), ("min_pct", 0), ("max_pct", 40)):
        bad: dict[str, object] = {**data, "map_tempo": {**tempo, key: value}}
        with pytest.raises(RulesetError, match=f"map_tempo.{key}"):
            parse_ruleset(bad)


# Front pressure (#803) -------------------------------------------------------------------------


def _front_match(rules: Ruleset, ticks: int) -> MatchRecorder:
    # line6: 0-1-2-3-4-5, player 0 owns 0 and 1, player 1 owns 4 and 5. Node 2 goes to player 0 and
    # node 3 to player 1, so each player has exactly one front node (2 and 3). Nobody moves.
    match = Match(load_map(TESTS / "maps" / "line6.json"), rules, HEADLESS_MATCH_KEY)
    match.state.nodes[2].owner = 0
    match.state.nodes[3].owner = 1
    recorder = MatchRecorder()
    recorder.begin(match)
    for _ in range(ticks):
        match.step()
        recorder.record(match, [])
    return recorder


def test_front_width_and_cp_income_by_hand() -> None:
    # 200 ticks: 20 samples (every 10th tick), width 1 each: sum 20, 20 samples, mean 1.00.
    # No fight: pressure 0. CP under Balance every 100 ticks: ticks 100 and 200, 2 * 100.
    rules = load_ruleset(STANCES)
    m = analyze(_front_match(rules, 200).log())
    assert m.front_width_sum == (20, 20)
    assert m.front_samples == (20, 20)
    assert m.front_width_centi == (100, 100)
    assert m.front_pressure_centi == (0, 0)
    assert m.cp_income == (200, 200)
    row = m.to_json()
    assert row["front_pressure_centi"] == [0, 0]
    # With the map tempo the CP period doubles on line6 (clamped 50%): one quantum, at tick 200.
    tempo = dataclasses.replace(rules, map_tempo=_tempo())
    assert analyze(_front_match(tempo, 200).log()).cp_income == (100, 100)


def test_no_front_leaves_the_width_and_pressure_undefined() -> None:
    rules = load_ruleset(STANCES)
    match = Match(load_map(TESTS / "maps" / "line6.json"), rules, HEADLESS_MATCH_KEY)
    recorder = MatchRecorder()
    recorder.begin(match)
    for _ in range(30):
        match.step()
        recorder.record(match, [])
    m = analyze(recorder.log())
    assert m.front_width_sum == (0, 0)
    assert m.front_width_centi == (None, None)
    assert m.front_pressure_centi == (None, None)


def test_front_pressure_from_a_hand_made_log() -> None:
    # Player 0 spends 2 + 1 = 3 charges in fights, player 1 spends 1 + 1 = 2 (burned_1 counts,
    # DEC-45). Player 0 had a front of 2 nodes for 30 samples: 60 node-samples = 600 node-ticks
    # = 1 node-minute: pressure 3 * 100 * 600 // (60 * 10) = 300. Player 1: 3 nodes for 40
    # samples, 120 node-samples: 2 * 100 * 600 // 1200 = 100; mean width 120 * 100 // 40 = 300.
    log = MatchLog(
        tick_hz=10,
        ticks=600,
        events=(
            event(6, "fight_round", fight=1, node=1, spent_0=2, spent_1=1),
            event(26, "fight_round", fight=1, node=1, spent_0=1, spent_1=0, burned_1=1),
        ),
        moves=(),
        commands=(),
        start_stance="balance",
        initial_owners=(0, None, None, 1),
        vp=(0, 0),
        accepted=(0, 0),
        rejected=(0, 0),
        stock=((), ()),
        front_width_sum=(60, 120),
        front_samples=(30, 40),
    )
    m = analyze(log)
    assert m.front_pressure_centi == (300, 100)
    assert m.front_width_centi == (200, 300)


MVP7 = ROOT / "rulesets" / "mvp-7.toml"


@pytest.mark.parametrize(
    ("name", "pct", "cp", "capital"),
    [
        # Expected values by hand (issue #885, mechanics.md DEC-46): pct, then p * 100 // pct.
        # cp: War / Balance / Economy of 80 / 100 / 200; capital: of 400 / 200 / 100.
        ("narrows", 76, (105, 131, 263), (526, 263, 131)),
        ("crossroads", 100, (80, 100, 200), (400, 200, 100)),
        ("highway", 100, (80, 100, 200), (400, 200, 100)),
        ("ridge", 102, (78, 98, 196), (392, 196, 98)),
    ],
)
def test_mvp7_periods_on_the_pool_maps(
    name: str, pct: int, cp: tuple[int, int, int], capital: tuple[int, int, int]
) -> None:
    rules = load_ruleset(MVP7)
    assert rules.map_tempo is not None
    mapdef = load_map(ROOT / "maps" / f"{name}.json")
    assert rules.map_tempo.pct(len(mapdef.nodes)) == pct
    played = apply_map_tempo(rules, mapdef)
    assert played.map_tempo is None
    t, c = played.stances.cp_period_ticks, played.stances.capital_period_ticks
    assert (t.war, t.balance, t.economy) == cp
    assert (c.war, c.balance, c.economy) == capital
    assert played.factory.built_period_ticks is None  # DEC-47: every factory follows the stance
