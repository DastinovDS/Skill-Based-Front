"""The arithmetic of the validity section (#690): ranks, the Bradley-Terry fit, the style matrix.

Expected values come from the definitions (closed forms of small cases), not from the code: a
logistic fit of one pair is the logit of its share, rock-paper-scissors has the uniform
equilibrium and no transitive part.
"""

import math
from dataclasses import dataclass

import pytest

from gow_bots import validity
from gow_bots.tournament import USAGE_KEYS, live_keys
from gow_bots.validity import Tally, nash, pearson, spearman, split_level, transitive_split


@dataclass(frozen=True, slots=True)
class _M:
    """The fields of a row ``validity`` reads."""

    map: str
    seed: int
    bots: tuple[str, str]
    winner: int | None
    state_hash: str = ""
    accepted: tuple[int, int] | None = None
    usage: tuple[dict[str, int], dict[str, int]] | None = None


def test_spearman_ranks_ties_by_their_mean() -> None:
    assert spearman([1, 2, 3], [10, 20, 30]) == pytest.approx(1.0)
    assert spearman([1, 2, 3], [3, 2, 1]) == pytest.approx(-1.0)
    # ranks [1.5, 1.5, 3] and [1, 2, 3]: sxy = 1.5, sxx = 1.5, syy = 2 -> 1.5 / sqrt(3)
    assert spearman([5, 5, 9], [1, 2, 3]) == pytest.approx(1.5 / math.sqrt(3))
    assert pearson([1, 1], [2, 3]) is None  # a constant list


def test_split_level_reads_the_name() -> None:
    assert split_level("smart_rusher@easy") == ("smart_rusher", "easy")
    assert split_level("smart_hoarder") == ("smart_hoarder", "hard")  # DEFAULT_DIFFICULTY
    assert split_level("random_legal") == ("random_legal", None)


def test_bradley_terry_of_one_pair_is_the_logit_of_its_share() -> None:
    # a beats b in 3 of 4 matches on each side, side 0 wins half: s_a - s_b = logit(3/4) = ln 3,
    # sum(s) = 0, h = 0. The ridge of 0.01 shrinks the estimate a little (tolerance below).
    rows: list[_M] = []
    for seed in range(4):
        rows.append(_M("m", seed, ("a", "b"), 0 if seed < 3 else 1))
        rows.append(_M("m", seed, ("b", "a"), 1 if seed < 3 else 0))
    fit = validity.bradley_terry(Tally(rows), replicates=20)
    assert fit is not None
    (a, b), (h,) = fit
    assert a.value - b.value == pytest.approx(math.log(3), abs=0.02)
    assert a.value + b.value == pytest.approx(0.0, abs=1e-9)
    assert h.value == pytest.approx(0.0, abs=1e-6)
    assert a.low <= a.value <= a.high


def test_bradley_terry_reads_the_side_from_the_mirror_matches() -> None:
    # side 0 wins 3 of 4 mirror matches: h = logit(3/4) = ln 3 (the strengths cancel)
    rows = [_M("m", seed, ("a", "a"), 0 if seed < 3 else 1) for seed in range(4)]
    fit = validity.bradley_terry(Tally(rows), replicates=0)
    assert fit is not None
    assert fit[1][0].value == pytest.approx(math.log(3), abs=0.02)


def test_rock_paper_scissors_is_all_cycle_and_its_equilibrium_is_uniform() -> None:
    rps = [[0.0, 0.5, -0.5], [-0.5, 0.0, 0.5], [0.5, -0.5, 0.0]]
    r, share = transitive_split(rps)
    assert r == pytest.approx([0.0, 0.0, 0.0])
    assert share == pytest.approx(1.0)
    mix, gap = nash(rps)
    assert mix == pytest.approx([1 / 3, 1 / 3, 1 / 3], abs=0.02)
    assert gap == pytest.approx(0.0, abs=0.02)


def test_a_ladder_has_no_cycle_and_its_equilibrium_is_the_top() -> None:
    # A[i][j] = r[i] - r[j] with r = (0.2, 0, -0.2): purely transitive, the top bot dominates
    ladder = [[0.0, 0.2, 0.4], [-0.2, 0.0, 0.2], [-0.4, -0.2, 0.0]]
    r, share = transitive_split(ladder)
    assert r == pytest.approx([0.2, 0.0, -0.2])
    assert share == pytest.approx(0.0)
    mix, _ = nash(ladder)
    assert mix[0] > 0.98  # the mean of the played mixes keeps a trace of the first rounds


def test_live_keys_hide_the_mechanics_of_the_other_economy() -> None:
    flow = live_keys("v2", "flow")
    assert "SetLeafShift" in flow and "FortifyRoad" in flow and "BuildFactory" in flow
    for dead in ("SetStance", "SetFront", "SetRearMin", "Transfer", "UpgradeRoad", "DrawLine"):
        assert dead not in flow
    lines = live_keys("v2", "lines")
    assert "DrawLine" in lines and "SetLeafShift" not in lines
    v1 = live_keys("v1", "lines")
    assert "SetFront" in v1 and "BuildFactory" not in v1 and "SetLeafShift" not in v1
    assert live_keys(None, None) == USAGE_KEYS
    assert "DrawLine" in live_keys("v2", None) and "SetLeafShift" in live_keys("v2", None)


def test_server_levels_are_the_levels_of_the_server() -> None:
    from gow_server.botmatch import LEVEL_BOTS  # the harness may not import it (AGENTS.md 2)

    assert tuple(LEVEL_BOTS.items()) == validity.SERVER_LEVELS


def _against(bot: str, rival: str, wins: int, losses: int) -> list[_M]:
    """``wins`` and ``losses`` of ``bot`` against ``rival``, on alternating sides."""
    rows: list[_M] = []
    for i in range(wins + losses):
        side = i % 2
        pair = (bot, rival) if side == 0 else (rival, bot)
        rows.append(_M("m", i, pair, side if i < wins else 1 - side))
    return rows


def _v6(rows: list[_M]) -> validity.Check:
    return next(c for c in validity.checks(Tally(rows), []) if c.id == "V6")


def test_the_exploiter_gate_reads_every_server_level() -> None:
    levels = dict(validity.SERVER_LEVELS)
    rival = validity.EXPLOITER
    shares = {"easy": (1, 9), "normal": (2, 8), "hard": (4, 6), "expert": (5, 5)}
    rows = [r for lv, (w, n) in shares.items() for r in _against(levels[lv], rival, w, n)]
    found = validity.exploiter_rates(Tally(rows))
    assert [(lv, w, d) for lv, _, w, d in found] == [
        ("easy", 1, 10),
        ("normal", 2, 10),
        ("hard", 4, 10),
        ("expert", 5, 10),
    ]
    # The proposed least shares (not owner decisions).
    assert validity.EXPLOITER_GATE == (
        ("easy", 0.05),
        ("normal", 0.20),
        ("hard", 0.35),
        ("expert", 0.50),
    )
    check = _v6(rows)
    assert check.status == validity.PASS
    assert "expert 0.50 [0.24; 0.76] (n=10)" in check.measured  # the Wilson interval of 5 of 10
    # The expert at 4 of 10 fails the gate; a level not in the file is named.
    shares = {"normal": (2, 8), "hard": (4, 6), "expert": (4, 6)}
    rows = [r for lv, (w, n) in shares.items() for r in _against(levels[lv], rival, w, n)]
    check = _v6(rows)
    assert check.status == validity.FAIL
    assert "missing: easy" in check.measured
    assert _v6(_against("a", "b", 1, 1)).status == validity.NO_DATA
