"""The bots and ``gow-bots stats`` under ``[stances]`` (DEC-44, #772).

The bots have no stance policy yet (#689): they stay in Balance, the rates of ``mvp-4-sup200``.
The bound of the enemy CP still has to hold, an enemy human may sit in War. ``stats`` reads the
stance usage of a match from its replay.
"""

import dataclasses
import re
from pathlib import Path

import pytest

from gow_bots.bots import BOTS
from gow_bots.bots.assess import EnemyCp
from gow_bots.cli import main
from gow_bots.tournament import live_keys
from gow_sim.commands import Command, PlayerCommand, SetStance
from gow_sim.maps import MapDef, load_map
from gow_sim.match import SIM_VERSION, Match
from gow_sim.ruleset import Ruleset, Stance, load_ruleset

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))
GOLDEN = ROOT / "packages" / "sim" / "tests" / "golden" / f"v{SIM_VERSION}"


@pytest.fixture(scope="module")
def rules() -> Ruleset:
    return load_ruleset(ROOT / "rulesets" / "mvp-4-stances.toml")


@pytest.fixture(scope="module")
def crossroads() -> MapDef:
    return load_map(ROOT / "maps" / "crossroads.json")


@pytest.mark.parametrize("name", sorted(BOTS))
def test_every_bot_stays_in_balance(rules: Ruleset, crossroads: MapDef, name: str) -> None:
    match = Match(crossroads, rules, KEY)
    bots = [BOTS[n](crossroads, rules, seed=2, player=p) for p, n in enumerate((name, name))]
    sent: list[Command] = []
    seq = 0
    while match.tick < 600 and not match.finished:
        cmds: list[PlayerCommand] = []
        if match.tick % 5 == 0:
            for p in (0, 1):
                for cmd in bots[p].decide(match.view(p), match.tick):
                    sent.append(cmd)
                    cmds.append(PlayerCommand(p, seq, match.resolve(p, cmd)))
                    seq += 1
        match.step(cmds)
    assert not any(isinstance(c, SetStance) for c in sent)
    assert all(p.stance is Stance.BALANCE for p in match.state.players.values())


def test_the_bound_of_the_enemy_cp_counts_the_fastest_stance(
    rules: Ruleset, crossroads: MapDef
) -> None:
    """War gives 1 CP per 80 ticks (DEC-44): 3 CP at the start, 4 at tick 80, 5 (the cap) at 160.
    To 5 CP from 3 at tick 0 it is two periods of 80 ticks."""
    match = Match(crossroads, rules, KEY)
    view = match.view(0)
    bound = EnemyCp(rules, 1)
    assert bound.ticks_to(500, 0) == 160
    assert bound.update(dataclasses.replace(view, tick=79)) == 300
    assert bound.update(dataclasses.replace(view, tick=80)) == 400
    assert bound.update(dataclasses.replace(view, tick=160)) == 500


def test_the_bound_holds_against_an_enemy_in_war(rules: Ruleset, crossroads: MapDef) -> None:
    match = Match(crossroads, rules, KEY)
    bound = EnemyCp(rules, 1)
    for tick in range(1, 301):
        cmds = [PlayerCommand(1, 0, SetStance(Stance.WAR))] if tick == 1 else []
        match.step(cmds)
        assert bound.update(match.view(0)) >= match.state.players[1].cp


def test_set_stance_is_a_live_key_only_with_the_section() -> None:
    assert "SetStance" not in live_keys("v2", "flow")
    assert "SetStance" in live_keys("v2", "flow", stances=True)
    assert "SetFront" not in live_keys("v2", "flow", stances=True)
    assert "SetStance" in live_keys("v1", None)


def _table(capsys: pytest.CaptureFixture[str], replay: Path) -> dict[str, str]:
    argv = [
        "stats",
        str(replay),
        "--rulesets",
        str(ROOT / "rulesets" / "archive"),
        "--maps",
        str(GOLDEN / "maps"),
    ]
    assert main(argv) == 0
    lines = capsys.readouterr().out.splitlines()
    return {re.split(r"\s{2,}", line)[0]: line for line in lines[1:]}


def test_stats_show_the_stance_usage(capsys: pytest.CaptureFixture[str]) -> None:
    """The golden game of ``mvp-4-stances``: ``MixBot`` changes the stance on a schedule."""
    rows = _table(capsys, GOLDEN / "web-mvp4-stances.jsonl.gz")
    for stance in ("economy", "balance", "war"):
        assert f"share of time in {stance}" in rows
        assert f"CP earned in {stance}" in rows
        assert f"charges in {stance} (capital / built)" in rows
    assert "stance switches" in rows
    assert int(rows["stance switches"].split()[2]) > 0
    assert "SetStance (accepted)" in rows
    assert "charges from the capital" in rows and "charges from built factories" in rows


def test_stats_of_v2_without_the_section_have_no_stance_rows(
    capsys: pytest.CaptureFixture[str],
) -> None:
    rows = _table(capsys, GOLDEN / "web-mvp4.jsonl.gz")
    assert "stance switches" not in rows and "SetStance (accepted)" not in rows
    assert "charges from the capital" in rows
