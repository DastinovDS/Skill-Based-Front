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
    # starved 0, attrition 0, end 20, residual 0, sent/delivered/to markers 8 / 6 / 2,
    # marker city empty 100 of 500 = 20%, capital has charges 50 of 500 = 10%, capital full 25%.
    row = (
        "| **rusher** | 1 | 10.0 | 20.0 | 4.0 | 2.0 | 3.0 | 1.0 | 0.0 | 0.0 | 0.0 | 20.0 | 0 "
        "| 8.0 / 6.0 / 2.0 | 20% | 10% | 25% |"
    )
    assert row in text
    # Stock by place of the rusher: cap_wh minutes 2.00 and 4.00 -> 3.00; rear_wh 1.00 (the
    # minute without a sample is skipped); packets 0.50. The expander has no sample at all.
    assert "| **rusher** | 1 | 3.00 | 0.00 | 1.00 | 0.00 | 0.00 | 0.50 |" in text
    assert "| **expander** | 0 | n/a | n/a | n/a | n/a | n/a | n/a |" in text


def test_report_charge_flow_without_the_fields_is_na(tournament: Path) -> None:
    text = render_report(load_rows(tournament), "t.jsonl", "t")
    assert "| **rusher** | 0 | n/a |" in text.split("## Charge flow (#588)")[1]
