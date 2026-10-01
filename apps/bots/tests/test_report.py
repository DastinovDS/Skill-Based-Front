"""The balance report (BOT-05): statistics and output on a tiny synthetic tournament."""

# The report text is Russian: RUF001 flags Cyrillic words that look like Latin ones.
# ruff: noqa: RUF001

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
    assert "[выполнено] `strangler` берёт хотя бы один город осадой" in text
    assert "1.00 [0.81; 1.00]" in text
    # reactive wins every match against rusher, expander none
    assert "[выполнено] `reactive` выигрывает у `rusher` чаще" in text
    # reactive > rusher > strangler > reactive is the only cycle; expander loses to everyone
    assert "reactive > rusher > strangler > reactive" in text
    assert "Циклы «камень-ножницы-бумага» (A бьёт B, B бьёт C, C бьёт A): 1;" in text
    assert "Доминирующая стратегия (бьёт всех остальных): нет" in text
    assert "![матрица пар](t-pairs.png)" in text
    for title in ("Преимущество стороны", "Разбивка по картам", "Уникальные исходы"):
        assert f"## {title}" in text


def test_report_flags_a_failed_competence_check(tmp_path: Path) -> None:
    rows = [_row("alpha", s, "expander", "strangler") | {"sieges_won": [0, 0]} for s in range(4)]
    rows += [_row("alpha", s, "strangler", "expander") | {"sieges_won": [0, 0]} for s in range(4)]
    text = render_report(load_rows(_write(tmp_path / "f.jsonl", rows)), "f.jsonl", "f")
    assert "[НЕ выполнено] `strangler` берёт хотя бы один город осадой" in text
    assert "[нет данных] проверка `reactive`" in text


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
