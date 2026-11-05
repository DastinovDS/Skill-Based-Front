"""The balance report (BOT-05): statistics and output on a tiny synthetic tournament."""

import json
from itertools import product
from pathlib import Path
from typing import Any

import pytest

from gow_bots.cli import main
from gow_bots.report import load_rows, render_report, wilson, write_report
from gow_bots.tournament import SCHEMA_VERSION

BOTS = ("expander", "reactive", "rusher", "strangler")
# who beats whom in the synthetic data (every pair is decided the same way on both sides)
BEATS = {
    ("strangler", "expander"),
    ("reactive", "rusher"),
    ("rusher", "strangler"),
    ("strangler", "reactive"),
    ("reactive", "expander"),
    ("rusher", "expander"),
}


def _row(map_name: str, seed: int, bot0: str, bot1: str) -> dict[str, Any]:
    if bot0 == bot1:
        winner = 0 if seed % 4 else None  # a mild side-0 edge on mirror matches
    elif (bot0, bot1) in BEATS:
        winner = 0
    else:
        winner = 1
    strangler_side = [bot0 == "strangler", bot1 == "strangler"]
    return {
        "schema": SCHEMA_VERSION,
        "map": map_name,
        "map_hash": "m",
        "ruleset_hash": "r",
        "sim_version": 1,
        "seed": seed,
        "bot0": bot0,
        "bot1": bot1,
        "state_hash": f"{map_name}-{seed}-{bot0}-{bot1}" if seed else "same",
        "winner": winner,
        "reason": "draw" if winner is None else "capital",
        "ticks": 3600,
        "duration_s": 180.0,
        "vp": [1, 0],
        "cities": [3, 2],
        "orders": [4, 4],
        "attack_orders": [4, 2],
        "planned_attack_orders": [2, 1],
        "planned_attack_share": [0.5, 0.5],
        "sieges": [2, 2],
        "sieges_won": [int(s) for s in strangler_side],
        "captures": [2, 1],
        "captures_by_minute": [[1, 0, 1], [0, 1, 0]],
        "accepted": [8, 8],
        "rejected": [0, 0],
    }


def _write(path: Path, rows: list[dict[str, Any]]) -> Path:
    path.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="ascii")
    return path


@pytest.fixture
def tournament(tmp_path: Path) -> Path:
    rows = [
        _row(m, seed, b0, b1)
        for m in ("alpha", "beta")
        for seed in range(4)
        for b0, b1 in product(BOTS, repeat=2)
    ]
    return _write(tmp_path / "t.jsonl", rows)


def test_wilson_matches_known_values() -> None:
    assert wilson(0, 0) == (0.0, 1.0)
    lo, hi = wilson(5, 10)
    assert (round(lo, 3), round(hi, 3)) == (0.237, 0.763)
    lo, hi = wilson(10, 10)
    assert round(lo, 3) == 0.722
    assert hi == 1.0
    assert wilson(0, 10)[0] == 0.0


def test_load_rows_rejects_bad_files(tmp_path: Path) -> None:
    empty = _write(tmp_path / "e.jsonl", [])
    with pytest.raises(ValueError, match="no matches"):
        load_rows(empty)
    foreign = _row("alpha", 1, "rusher", "rusher") | {"schema": SCHEMA_VERSION + 1}
    with pytest.raises(ValueError, match=r"t\.jsonl:1"):
        load_rows(_write(tmp_path / "t.jsonl", [foreign]))
    missing = {k: v for k, v in _row("alpha", 1, "rusher", "rusher").items() if k != "vp"}
    with pytest.raises(ValueError, match="bad tournament row"):
        load_rows(_write(tmp_path / "m.jsonl", [missing]))


def test_report_numbers_follow_the_rows(tournament: Path) -> None:
    text = render_report(load_rows(tournament), "t.jsonl", "t")
    # strangler vs expander: strangler always wins, 16 matches, each takes a siege
    assert "[done] `strangler` takes at least one city by siege" in text
    assert "1.00 [0.81; 1.00]" in text
    # reactive wins every match against rusher, expander none
    assert "[done] `reactive` beats `rusher` more often" in text
    # reactive > rusher > strangler > reactive is the only cycle; expander loses to everyone
    assert "reactive > rusher > strangler > reactive" in text
    assert "Rock-paper-scissors cycles (A beats B, B beats C, C beats A): 1;" in text
    assert "Dominant strategy (beats all the others): none" in text
    assert "![pair matrix](t-pairs.png)" in text
    for title in ("Side advantage", "Breakdown by map", "Unique outcomes"):
        assert f"## {title}" in text


def test_report_flags_a_failed_competence_check(tmp_path: Path) -> None:
    rows = [_row("alpha", s, "expander", "strangler") | {"sieges_won": [0, 0]} for s in range(4)]
    rows += [_row("alpha", s, "strangler", "expander") | {"sieges_won": [0, 0]} for s in range(4)]
    text = render_report(load_rows(_write(tmp_path / "f.jsonl", rows)), "f.jsonl", "f")
    assert "[NOT done] `strangler` takes at least one city by siege" in text
    assert "[no data] check of `reactive`" in text


def test_report_counts_unique_outcomes_and_side_advantage(tournament: Path) -> None:
    text = render_report(load_rows(tournament), "t.jsonl", "t")
    # mirror matches: seeds 1..3 win for side 0, seed 0 is a draw -> 12 of 12 decisive per map
    assert "1.00 [0.76; 1.00] (n=12)" in text
    # the 16 matches of seed 0 share one state_hash: 48 + 1 distinct states per map
    assert "| alpha | 64 | 49 | 3 | 0/16 |" in text


def test_write_report_and_cli(tournament: Path, tmp_path: Path) -> None:
    out = tmp_path / "out"
    assert main(["report", str(tournament), "--out-dir", str(out), "--name", "r"]) == 0
    names = sorted(p.name for p in out.iterdir())
    assert names == ["r-bots.png", "r-pairs.png", "r-sides.png", "r.md"]
    for png in out.glob("*.png"):
        assert png.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    first = (out / "r.md").read_text(encoding="utf-8")
    write_report(tournament, out, "r")
    assert (out / "r.md").read_text(encoding="utf-8") == first  # a function of the rows


def test_cli_reports_a_bad_input_cleanly(tmp_path: Path) -> None:
    assert main(["report", str(tmp_path / "missing.jsonl"), "--out-dir", str(tmp_path)]) == 2
    bad = _write(tmp_path / "bad.jsonl", [])
    assert main(["report", str(bad), "--out-dir", str(tmp_path)]) == 2


def _stock_rows() -> list[dict[str, Any]]:
    """Two matches of rusher (side 0) against expander (side 1) on one map, worked by hand."""
    first = _row("alpha", 0, "rusher", "expander") | {
        "stock_mean_centi": [400, 200],
        "stock_peak": [6, 3],
        "charges_produced": [10, 8],
        "charges_burned": [2, 0],
        "burned_permille": [200, 0],
    }
    second = _row("alpha", 1, "rusher", "expander") | {
        "stock_mean_centi": [600, 100],
        "stock_peak": [8, 5],
        "charges_produced": [10, 4],
        "charges_burned": [3, 1],
        "burned_permille": [300, 250],
    }
    return [first, second]


def test_report_prints_the_charge_stock_columns(tmp_path: Path) -> None:
    text = render_report(load_rows(_write(tmp_path / "s.jsonl", _stock_rows())), "s.jsonl", "s")
    assert "## Charge stock and burned share (#310)" in text
    assert (
        "| bot | matches | mean stock | mean peak | highest peak | produced per match "
        "| burned share (burned/produced) |"
    ) in text
    # rusher: mean stock (400 + 600) / (2 * 100) = 5.00, peaks (6 + 8) / 2 = 7.00, highest 8,
    # produced (10 + 10) / 2 = 10.00, burned 2 + 3 = 5 of 20 = 25.0%
    assert "| **rusher** | 2 | 5.00 | 7.00 | 8 | 10.00 | 25.0% (5/20) |" in text
    # expander: (200 + 100) / 200 = 1.50, (3 + 5) / 2 = 4.00, highest 5, (8 + 4) / 2 = 6.00, 1/12
    assert "| **expander** | 2 | 1.50 | 4.00 | 5 | 6.00 | 8.3% (1/12) |" in text
    # the map: all four perspectives, (400 + 200 + 600 + 100) / 400 = 3.25, (6 + 3 + 8 + 5) / 4 =
    # 5.50, highest 8, (10 + 8 + 10 + 4) / 4 = 8.00, burned 6 of 32 = 18.75%
    assert "| alpha | 4 | 3.25 | 5.50 | 8 | 8.00 | 18.8% (6/32) |" in text


def test_report_reads_a_file_without_the_charge_stock_fields(tournament: Path) -> None:
    text = render_report(load_rows(tournament), "t.jsonl", "t")
    assert "## Charge stock and burned share (#310)" in text
    assert "| **rusher** | 0 | n/a | n/a | n/a | n/a | n/a |" in text


def test_cli_report_writes_the_charge_stock_section(tmp_path: Path) -> None:
    path = _write(tmp_path / "s.jsonl", _stock_rows())
    assert main(["report", str(path), "--out-dir", str(tmp_path), "--name", "s"]) == 0
    assert "| **rusher** | 2 | 5.00 |" in (tmp_path / "s.md").read_text(encoding="utf-8")


def _flow_rows() -> list[dict[str, Any]]:
    """One match, rusher (side 0) against expander (side 1), worked by hand."""
    zeros = [0, 0]
    return [
        _row("alpha", 0, "rusher", "expander")
        | {
            "ticks": 1000,
            "charges_produced": [20, 10],
            "charges_burned": [4, 0],
            "charges_start": [10, 6],
            "charges_fights": [2, 1],
            "charges_captures": [3, 0],
            "charges_packets_lost": [1, 0],
            "charges_warehouses_lost": [0, 2],
            "charges_starved": zeros,
            "charges_attrition": [0, 1],
            "charges_end": [20, 12],
            "charges_residual": zeros,
            "charges_sent": [8, 4],
            "charges_delivered": [6, 4],
            "charges_delivered_front": [2, 0],
            "charges_transfers": zeros,
            "marker_ticks": [500, 0],
            "front_empty_ticks": [100, 0],
            "front_empty_cap_has_ticks": [50, 0],
            "cap_full_ticks": [250, 100],
            "stock_by_place_minute": [
                {"cap_wh": [200, 400], "front_wh": [0, 0], "rear_wh": [100, None]}
                | {"units_node": [0], "units_road": [0], "packets": [50, 50]},
                {k: [None] for k in ("cap_wh", "front_wh", "rear_wh", "units_node")}
                | {"units_road": [None], "packets": [None]},
            ],
        }
    ]


def test_report_prints_the_charge_flow_table(tmp_path: Path) -> None:
    text = render_report(load_rows(_write(tmp_path / "f.jsonl", _flow_rows())), "f.jsonl", "f")
    assert "## Charge flow (#588)" in text
    # rusher: start 10, produced 20, burned 4, fights 2, captures 3, packets lost 1, warehouses 0,
    # starved 0, attrition 0, built 0, plans 0 (a file without the v2 sinks), end 20, residual 0,
    # sent/delivered/to markers 8 / 6 / 2,
    # marker city empty 100 of 500 = 20%, capital has charges 50 of 500 = 10%, capital full 25%.
    row = (
        "| **rusher** | 1 | 10.0 | 20.0 | 4.0 | 2.0 | 3.0 | 1.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 "
        "| 20.0 | 0 "
        "| 8.0 / 6.0 / 2.0 | 20% | 10% | 25% |"
    )
    assert row in text
    # Stock by place of the rusher: cap_wh minutes 2.00 and 4.00 -> 3.00; rear_wh 1.00 (the
    # minute without a sample is skipped); packets 0.50. The expander has no sample at all.
    assert "| **rusher** | 1 | 3.00 | 0.00 | 1.00 | 0.00 | 0.00 | 0.50 |" in text
    assert "| **expander** | 0 | n/a | n/a | n/a | n/a | n/a | n/a |" in text


def test_report_charge_flow_shows_the_v2_sinks(tmp_path: Path) -> None:
    # #646, #648: the economy v2 sinks are columns of the ledger when the row has them.
    rows = [_flow_rows()[0] | {"charges_built": [7, 0], "charges_plans": [3, 1]}]
    text = render_report(load_rows(_write(tmp_path / "f.jsonl", rows)), "f.jsonl", "f")
    assert "| died with units | built | plans | end |" in text
    assert "| 0.0 | 0.0 | 0.0 | 7.0 | 3.0 | 20.0 | 0 " in text
    assert "| 2.0 | 0.0 | 1.0 | 0.0 | 1.0 | 12.0 | 0 " in text


def test_report_charge_flow_without_the_fields_is_na(tournament: Path) -> None:
    text = render_report(load_rows(tournament), "t.jsonl", "t")
    assert "| **rusher** | 0 | n/a |" in text.split("## Charge flow (#588)")[1]


def test_report_share_of_scheduled_attacks_counts_siege_orders(tmp_path: Path) -> None:
    # #590: the gate share is planned siege orders / siege orders. Every bot plays every row
    # once on each side, so per bot: (0 + 1) / (4 + 2) = 0.17; all attacks: (2 + 1) / (4 + 2).
    rows = [
        _row(m, seed, b0, b1) | {"siege_orders": [4, 2], "planned_siege_orders": [0, 1]}
        for m in ("alpha",)
        for seed in range(2)
        for b0, b1 in product(BOTS, repeat=2)
    ]
    text = render_report(load_rows(_write(tmp_path / "g.jsonl", rows)), "g.jsonl", "g")
    lines = [x for x in text.splitlines() if " | 0.17 | 0.50 | " in x]  # the bots section
    assert sorted(x.split(" | ")[0] for x in lines) == sorted(f"| **{b}**" for b in BOTS)


def test_report_share_of_scheduled_attacks_without_siege_fields_is_na(tournament: Path) -> None:
    text = render_report(load_rows(tournament), "t.jsonl", "t")
    lines = [x for x in text.splitlines() if x.startswith("| **rusher** |") and "(0/" in x]
    assert len(lines) == 1  # the bots section: n/a, then the share of all attacks (2 + 1) / 6
    assert " | n/a | 0.50 | " in lines[0]


def _cp_rows() -> list[dict[str, Any]]:
    """Two matches of the rusher (side 0) against the expander, worked by hand."""
    first = _row("alpha", 0, "rusher", "expander") | {
        "ticks": 1000,
        "cp_burned": [250, 0],
        "cp_cap_ticks": [400, 0],
        "idle_discharged_connected": [30, 0],
        "idle_discharged_pocket": [90, 0],
    }
    second = _row("alpha", 1, "rusher", "expander") | {
        "ticks": 3000,
        "cp_burned": [0, 100],
        "cp_cap_ticks": [0, 3000],
        "idle_discharged_connected": [10, 40],
        "idle_discharged_pocket": [0, 0],
    }
    return [first, second]


def test_report_prints_the_cp_and_idle_unit_columns(tmp_path: Path) -> None:
    text = render_report(load_rows(_write(tmp_path / "c.jsonl", _cp_rows())), "c.jsonl", "c")
    assert "## CP and idle units (#743)" in text
    # rusher (side 0 in both): CP burned (250 + 0) / (100 * 2) = 1.25; ticks at the cap
    # 400 of 4000 = 10.0%; 1 of 2 matches reached the cap = 50%;
    # idle connected (30 + 10) / 2 = 20, pocket (90 + 0) / 2 = 45, pockets 90 of 130 = 69%.
    assert "| **rusher** | 2 | 1.25 | 10.0% | 50% | 20 | 45 | 69% |" in text
    # expander (side 1): burned (0 + 100) / 200 = 0.50; cap 3000 of 4000 = 75.0%; 1 of 2 = 50%;
    # idle connected (0 + 40) / 2 = 20, pocket 0, pockets 0 of 40 = 0%.
    assert "| **expander** | 2 | 0.50 | 75.0% | 50% | 20 | 0 | 0% |" in text


def test_report_cp_columns_without_the_fields_are_na(tournament: Path) -> None:
    text = render_report(load_rows(tournament), "t.jsonl", "t")
    section = text.split("## CP and idle units (#743)")[1]
    assert "| **rusher** | 0 | n/a | n/a | n/a | n/a | n/a | n/a |" in section


# Data validity, the ladder and the v2 rows (#690) ------------------------------------------------
#
# The expected values are counted by hand from the synthetic rows and the definitions of
# ``gow_bots.validity`` (``docs/balance/README.md``, section "Data validity").

RE, RH = "smart_rusher@easy", "smart_rusher@hard"
TE, TH = "smart_turtle@easy", "smart_turtle@hard"
FIELD = (RE, RH, TE, TH)
# RH beats everyone, RE beats both turtles, TE beats TH (an inverted turtle ladder)
FIELD_BEATS = {(RH, RE), (RH, TE), (RH, TH), (RE, TE), (RE, TH), (TE, TH)}
ACCEPTED = {RE: 100, RH: 120, TE: 100, TH: 104}


def _field_row(map_name: str, seed: int, bot0: str, bot1: str) -> dict[str, Any]:
    row = _row(map_name, seed, bot0, bot1)
    if bot0 != bot1:
        row["winner"] = 0 if (bot0, bot1) in FIELD_BEATS else 1
        row["reason"] = "capital"
    row["accepted"] = [ACCEPTED[bot0], ACCEPTED[bot1]]
    return row


def _field(tmp_path: Path) -> str:
    rows = [
        _field_row(m, seed, b0, b1)
        for m in ("alpha", "beta")
        for seed in range(4)
        for b0, b1 in product(FIELD, repeat=2)
    ]
    return render_report(load_rows(_write(tmp_path / "v.jsonl", rows)), "v.jsonl", "v")


def _check_line(text: str, check_id: str) -> str:
    return next(x for x in text.splitlines() if x.startswith(f"| {check_id} |"))


def _section(text: str, title: str) -> str:
    return text.split(f"## {title}\n")[1].split("\n## ")[0]


def test_report_computes_the_level_ladder(tmp_path: Path) -> None:
    ladder = _section(_field(tmp_path), "Level ladder")
    # 2 maps x 4 seeds x 2 sides = 16 decided matches per pair; Wilson(16, 16) = [0.81; 1.00]
    assert f"| smart_rusher | `{RH}` over `{RE}` | 16 | 1.00 [0.81; 1.00] | separated |" in ladder
    assert f"| smart_turtle | `{TH}` over `{TE}` | 16 | 0.00 [0.00; 0.19] | INVERTED |" in ladder
    # commands per match by level: easy 100 and hard 120 (rusher), 104 (turtle)
    assert "| smart_rusher | 100.0 | n/a | 120.0 |" in ladder
    assert "| smart_turtle | 100.0 | n/a | 104.0 |" in ladder


def test_report_validity_section_prints_pass_and_fail(tmp_path: Path) -> None:
    text = _field(tmp_path)
    assert "**Every threshold is a proposal, not an owner decision**" in text
    assert "1 of 2 pass; fail: smart_turtle" in _check_line(text, "V2")
    assert _check_line(text, "V2").endswith("| **FAIL** |")
    # tempo: rusher (120 - 100) / 100 = 20%, turtle 4%: the smallest is below 15%
    assert "smallest smart_turtle 4.0%, largest 20.0%" in _check_line(text, "V3")
    assert _check_line(text, "V3").endswith("| **FAIL** |")
    # the outcome does not depend on the seed: even and odd seeds agree exactly
    assert "bots r = 1.00, pairs r = 1.00" in _check_line(text, "V4a")
    assert _check_line(text, "V4a").endswith("| **PASS** |")
    # 16 matches per pair: 1.96 * sqrt(0.25 / 16) = 0.245; +-0.05 needs ceil((1.96/0.1)^2) = 385
    assert "median pair 16 matches: +-0.245 (needs 385)" in _check_line(text, "V4b")
    # mirror matches: 12 decided per map (seed 0 is a draw), all won by side 0
    assert "alpha 1.00 [0.76; 1.00]" in _check_line(text, "V4c")
    assert f"without a counter: {RH}" in _check_line(text, "V5a")
    assert f"highest {RH} 1.00" in _check_line(text, "V5b")
    assert _check_line(text, "V1").endswith("| **NO DATA** |")
    assert _check_line(text, "V6").endswith("| **NO DATA** |")
    assert _check_line(text, "V8").endswith("| **NOT COMPUTABLE** |")
    # both maps rank the bots the same: rho = 1
    assert "lowest alpha/beta 1.00, highest 1.00" in _check_line(text, "V9")
    assert "0 extra rows" in _check_line(text, "D1")
    assert _check_line(text, "D2").endswith("| **PASS** |")


def test_report_flags_duplicate_matches_and_repeated_games(tmp_path: Path) -> None:
    rows = [_field_row("alpha", seed, RE, RH) | {"state_hash": "one"} for seed in range(4)]
    rows.append(rows[0])
    text = render_report(load_rows(_write(tmp_path / "d.jsonl", rows)), "d.jsonl", "d")
    assert "1 extra rows" in _check_line(text, "D1")
    # one cell, 5 rows with one final state: 4 repeat another
    assert "4 of 5 (80.0%)" in _check_line(text, "D2")
    assert _check_line(text, "D2").endswith("| **FAIL** |")


def test_report_strength_model_and_style_matrix(tmp_path: Path) -> None:
    text = _field(tmp_path)
    strength = _section(text, "Strength model (Bradley-Terry)")
    order = [x.split(" | ")[0] for x in strength.splitlines() if x.startswith("| **smart_")]
    assert order == [f"| **{b}**" for b in (RH, RE, TE, TH)]  # the order of the beats
    style = _section(text, "Style matrix and Nash mix")
    # RH beats everyone: the equilibrium is RH alone, the others are outside the mix
    assert f"Outside the mix (weight below 0.005): {RE}, {TE}, {TH}." in style


def _v2_row(**extra: Any) -> dict[str, Any]:
    """One match of the rusher (side 0, the winner) against the expander under the flow."""
    return (
        _flow_rows()[0]
        | {
            "charges_built": [7, 0],
            "charges_plans": [3, 1],
            "charges_tolls": [1, 2],
            "tolls_paid": [1, 2],
            "forts_built": [2, 0],
            "charges_built_lost": [4, 0],
            "siege_fights": [3, 1],
            "siege_walk_ins": [1, 0],
            "contested_sieges": [2, 1],
            "contested_sieges_won": [1, 0],
            "first_contact_tick": 321,
            "usage": [{"SetLeafShift": 5, "FortifyRoad": 2}, {"SetLeafShift": 1}],
            "marker_ticks": [0, 0],
            "front_empty_ticks": [0, 0],
            "front_empty_cap_has_ticks": [0, 0],
        }
        | extra
    )


def test_report_under_the_supply_flow_hides_the_v1_rows(tmp_path: Path) -> None:
    rows = [_v2_row(economy_model="v2", supply_model="flow")]
    text = render_report(load_rows(_write(tmp_path / "f.jsonl", rows)), "f.jsonl", "f")
    assert "- Economy: `v2`, supply `flow`.\n" in text
    assert "alpha 321 (0 of 1 never met)" in text
    flow = _section(text, "Charge flow (#588)")
    assert "marker city empty" not in flow and "front_wh" not in flow
    # start 10, produced 20, burned 4, fights 2, captures 3, packets 1, warehouses 0, starved 0,
    # attrition 0, built 7, plans 3, tolls 1, end 20, residual 0, sent / delivered 8 / 6,
    # capital full 250 of 1000 ticks
    row = (
        "| **rusher** | 1 | 10.0 | 20.0 | 4.0 | 2.0 | 3.0 | 1.0 | 0.0 | 0.0 | 0.0 | 7.0 | 3.0 "
        "| 1.0 | 20.0 | 0 | 8.0 / 6.0 | 25% |"
    )
    assert row in flow
    sinks = _section(text, "Charge sinks by outcome (#690)")
    # columns: produced, burned, start, fights, captures, packets lost, warehouses lost,
    # starved, died with units, built, of them lost, plans, tolls, end
    assert (
        "| won | 1 | 20.0 | 4.0 | 10.0 | 2.0 | 3.0 | 1.0 | 0.0 | 0.0 | 0.0 | 7.0 | 4.0 | 3.0 "
        "| 1.0 | 20.0 |"
    ) in sinks
    assert (
        "| lost | 1 | 10.0 | 0.0 | 6.0 | 1.0 | 0.0 | 0.0 | 2.0 | 0.0 | 1.0 | 0.0 | 0.0 | 1.0 "
        "| 2.0 | 12.0 |"
    ) in sinks
    assert "| no winner | 0 | n/a |" in sinks
    supply = _section(text, "Supply flow (DEC-43)")
    # leaf shifts 5, forts ordered 2 and built 2, tolls paid 1 (1 charge), the expander lost 2
    # charges at the rusher's forts, starved 0
    assert "| **rusher** | 1 | 5.00 | 2.00 | 2.00 | 1.00 | 1.00 | 2.00 | 0.00 |" in supply
    usage = _section(text, "Mechanic usage (#166)")
    assert "| SetLeafShift |" in usage and "| SetFront |" not in usage
    assert "SetStance, UpgradeRoad, SetFront, SetRearMin, Transfer, DrawLine, RemoveLine" in usage
    bots = _section(text, "Metrics by bot")
    # fights 3 and walk-ins 1 per match; contested: 1 won of 2
    assert "| 3.00 / 1.00 | 0.50 (1/2) |" in bots


def test_report_infers_the_economy_of_an_older_file(tmp_path: Path) -> None:
    text = render_report(load_rows(_write(tmp_path / "o.jsonl", [_v2_row()])), "o.jsonl", "o")
    assert "- Economy: `v2`, supply `flow` (inferred from the mechanics used" in text
    old = render_report(load_rows(_write(tmp_path / "t.jsonl", _flow_rows())), "t.jsonl", "t")
    assert "- Economy: `v1` (inferred" in old  # marker ticks: v1
    assert "n/a (a file written before #690)" in old
