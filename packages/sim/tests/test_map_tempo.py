"""Map tempo (#803, experiment): ``[map_tempo]`` scales the economy periods by the map size.

The expected values are computed by hand from the formula of the issue: sqrt
``pct = isqrt(N * 10000 // ref_nodes)``, linear ``pct = N * 100 // ref_nodes``, both rounded down
and clamped to ``min_pct..max_pct``; a period ``p`` becomes ``max(1, p * 100 // pct)``.
"""

import dataclasses
from pathlib import Path

import pytest

from gow_sim.analysis import MatchLog, MatchRecorder, analyze
from gow_sim.maps import load_map
from gow_sim.match import HEADLESS_MATCH_KEY, Match
from gow_sim.state import event
from gow_sim.ruleset import (
    MapTempoRules,
    Ruleset,
    RulesetError,
    TempoForm,
    apply_map_tempo,
    load_ruleset,
    parse_ruleset,
    ruleset_hash,
    to_canonical,
)

TESTS = Path(__file__).resolve().parent
ROOT = TESTS.parents[2]
STANCES = ROOT / "rulesets" / "mvp-4-stances.toml"


def _tempo(form: TempoForm, min_pct: int = 50, max_pct: int = 150) -> MapTempoRules:
    return MapTempoRules(form=form, ref_nodes=49, min_pct=min_pct, max_pct=max_pct)


@pytest.mark.parametrize(
    ("form", "nodes", "pct"),
    [
        # 29 * 10000 // 49 = 5918; 76 * 76 = 5776 <= 5918 < 77 * 77 = 5929
        (TempoForm.SQRT, 29, 76),
        # 38 * 10000 // 49 = 7755; 88 * 88 = 7744 <= 7755 < 89 * 89 = 7921
        (TempoForm.SQRT, 38, 88),
        (TempoForm.SQRT, 49, 100),
        # 54 * 10000 // 49 = 11020; 104 * 104 = 10816 <= 11020 < 105 * 105 = 11025
        (TempoForm.SQRT, 54, 104),
        # 6 * 10000 // 49 = 1224, isqrt 34, clamped up to 50
        (TempoForm.SQRT, 6, 50),
        (TempoForm.LINEAR, 29, 59),  # 2900 // 49 = 59
        (TempoForm.LINEAR, 49, 100),
        (TempoForm.LINEAR, 54, 110),  # 5400 // 49 = 110
        (TempoForm.LINEAR, 20, 50),  # 2000 // 49 = 40, clamped up to 50
        (TempoForm.LINEAR, 100, 150),  # 10000 // 49 = 204, clamped down to 150
    ],
)
def test_the_multiplier_by_hand(form: TempoForm, nodes: int, pct: int) -> None:
    assert _tempo(form).pct(nodes) == pct


def test_without_the_section_the_rules_are_the_same_object() -> None:
    rules = load_ruleset(STANCES)
    mapdef = load_map(ROOT / "maps" / "narrows.json")
    assert apply_map_tempo(rules, mapdef) is rules
    match = Match(mapdef, rules, HEADLESS_MATCH_KEY)
    assert match.rules is rules and match.source_rules is rules


def test_the_section_is_left_out_of_the_hash_when_absent() -> None:
    rules = load_ruleset(STANCES)
    assert "map_tempo" not in to_canonical(rules)
    tempo = dataclasses.replace(rules, map_tempo=_tempo(TempoForm.SQRT))
    assert to_canonical(tempo)["map_tempo"] == {
        "form": "sqrt",
        "ref_nodes": 49,
        "min_pct": 50,
        "max_pct": 150,
    }
    assert parse_ruleset(to_canonical(tempo)) == tempo
    assert ruleset_hash(tempo) != ruleset_hash(rules)


def test_narrows_sqrt_scales_every_economy_period_and_nothing_else() -> None:
    # narrows: 29 nodes, sqrt pct 76. Periods p * 100 // 76: 100 -> 131, 200 -> 263,
    # 80 -> 105, 400 -> 526.
    rules = load_ruleset(ROOT / "rulesets" / "mvp-4-stances-tempo-sqrt.toml")
    mapdef = load_map(ROOT / "maps" / "narrows.json")
    assert len(mapdef.nodes) == 29
    played = apply_map_tempo(rules, mapdef)
    assert played.map_tempo is None
    assert played.cp.period_ticks == 131
    factory = played.factory_rules()
    assert (factory.capital_period_ticks, factory.built_period_ticks) == (263, 263)
    assert played.stances is not None
    cp, capital = played.stances.cp_period_ticks, played.stances.capital_period_ticks
    assert (cp.economy, cp.balance, cp.war) == (263, 131, 105)
    assert (capital.economy, capital.balance, capital.war) == (131, 263, 526)
    # The rest is the base ruleset: the variant differs from it only by [map_tempo].
    base = load_ruleset(STANCES)
    assert dataclasses.replace(
        played, cp=base.cp, factory=base.factory, stances=base.stances
    ) == dataclasses.replace(base, map_tempo=None)


def test_narrows_linear_periods() -> None:
    # linear pct 59: 100 -> 10000 // 59 = 169, 200 -> 338, 80 -> 135, 400 -> 677.
    rules = load_ruleset(ROOT / "rulesets" / "mvp-4-stances-tempo-linear.toml")
    played = apply_map_tempo(rules, load_map(ROOT / "maps" / "narrows.json"))
    assert played.cp.period_ticks == 169
    assert played.factory_rules().built_period_ticks == 338
    assert played.stances is not None
    assert played.stances.cp_period_ticks.war == 135
    assert played.stances.capital_period_ticks.war == 677


def test_ref_nodes_keeps_todays_numbers() -> None:
    base = load_ruleset(STANCES)
    for form in ("sqrt", "linear"):
        rules = load_ruleset(ROOT / "rulesets" / f"mvp-4-stances-tempo-{form}.toml")
        for name in ("crossroads", "highway"):
            played = apply_map_tempo(rules, load_map(ROOT / "maps" / f"{name}.json"))
            assert played == dataclasses.replace(base, map_tempo=None)


def test_a_period_never_drops_below_one() -> None:
    rules = load_ruleset(STANCES)
    tiny = dataclasses.replace(
        rules,
        cp=dataclasses.replace(rules.cp, period_ticks=1),
        map_tempo=MapTempoRules(TempoForm.LINEAR, ref_nodes=1, min_pct=1, max_pct=1000),
    )
    played = apply_map_tempo(tiny, load_map(ROOT / "maps" / "narrows.json"))
    assert played.cp.period_ticks == 1  # 1 * 100 // 1000 = 0, at least 1


def test_the_match_plays_the_scaled_rules_and_the_replay_names_the_given_ones() -> None:
    # line6: 6 nodes, sqrt 34 clamped to 50: every period doubles. Balance: CP every 200 ticks.
    rules = dataclasses.replace(load_ruleset(STANCES), map_tempo=_tempo(TempoForm.SQRT))
    match = Match(load_map(TESTS / "maps" / "line6.json"), rules, HEADLESS_MATCH_KEY)
    assert match.source_rules is rules
    assert match.rules.cp.period_ticks == 200
    start = match.state.players[0].cp
    for _ in range(199):
        match.step()
    assert match.state.players[0].cp == start
    match.step()  # tick 200
    assert match.state.players[0].cp == start + rules.cp.per_period


def test_bad_sections_are_rejected() -> None:
    data = to_canonical(dataclasses.replace(load_ruleset(STANCES), map_tempo=_tempo(TempoForm.SQRT)))
    tempo = data["map_tempo"]
    assert isinstance(tempo, dict)
    for key, value in (("form", "cube"), ("ref_nodes", 0), ("min_pct", 0), ("max_pct", 40)):
        bad = {**data, "map_tempo": {**tempo, key: value}}
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
    tempo = dataclasses.replace(rules, map_tempo=_tempo(TempoForm.SQRT))
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
