"""The stance policy of the smart bots under ``[stances]`` (#881; DEC-44, ``gow_bots.bots.stance``).

Expected values come from the rules. Under the section a stance sets only the CP income and the
rate of the own capital (DEC-44, items 1 and 2): War the most CP and the fewest capital charges,
Economy the reverse. At the CP cap the excess of a quantum burns (DEC-02), so more CP buy nothing
there and the policy steps toward Economy; with the warehouses full the charges are not what is
short and it steps toward War. A change carries both counters over rounded down (item 4), so the
policy changes at most once per dwell. ``SetStance`` without the section gives
``FEATURE_DISABLED`` (DEC-41, item 1), so a bot never sends it there.
"""

from itertools import pairwise
from pathlib import Path

import pytest

from gow_bots.bots import BOTS, SmartBot, bot_factory, choose_params
from gow_bots.bots.assess import Army
from gow_bots.bots.base import LATE_KEYS
from gow_bots.bots.estimate import Phase
from gow_bots.bots.stance import StanceInputs, StancePolicy, wanted_stance
from gow_sim.commands import Command, PlayerCommand, Reject, SetStance
from gow_sim.maps import MapDef, load_map
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset, Stance, load_ruleset

ROOT = Path(__file__).resolve().parents[3]
KEY = bytes(range(32))
MVP4 = load_ruleset(ROOT / "rulesets" / "mvp-4.toml")
MVP6 = load_ruleset(ROOT / "rulesets" / "mvp-6.toml")
PARAMS = {
    "stance_opening": 1,
    "stance_midgame": 1,
    "stance_late": 1,
    "stance_wait": 3,
    "stance_full": 75,
    "stance_cp_low": 150,
    "stance_dwell": 300,
}
"""A Balance personality with the thresholds of ``smart._COMMON`` (one draw)."""
SMART = sorted(n for n, cls in BOTS.items() if isinstance(cls, type) and issubclass(cls, SmartBot))


def _army(*, waiting: int = 0, stock: int = 6, cap: int = 12) -> Army:
    return Army(
        units=10,
        charged=10 - waiting,
        uncharged_standing=waiting,
        warehouse=stock,
        warehouse_cap=cap,
        cities=3,
        cut=0,
    )


def _want(
    *,
    cp: int = 300,
    phase: Phase = Phase.MIDGAME,
    pressed: bool = False,
    insight: bool = True,
    params: dict[str, int] | None = None,
    **army: int,
) -> Stance:
    inputs = StanceInputs(phase, cp, _army(**army), pressed)
    return wanted_stance(MVP6, params or PARAMS, inputs, insight=insight)


def test_the_stance_of_the_phase() -> None:
    params = {**PARAMS, "stance_opening": 0, "stance_midgame": 1, "stance_late": 2}
    assert _want(phase=Phase.OPENING, params=params) is Stance.ECONOMY
    assert _want(phase=Phase.MIDGAME, params=params) is Stance.BALANCE
    assert _want(phase=Phase.LATE, params=params) is Stance.WAR


@pytest.mark.parametrize(
    ("cp", "stance"),
    [
        (500, Stance.ECONOMY),  # at the cap (MVP6: 5 CP): the next quantum burns in full
        (401, Stance.ECONOMY),  # the next quantum (1 CP) burns in part
        (400, Stance.BALANCE),  # the next quantum reaches the cap and fits
    ],
)
def test_cp_that_would_burn_step_toward_economy(cp: int, stance: Stance) -> None:
    assert MVP6.cp.cap == 500 and MVP6.cp.per_period == 100
    assert _want(cp=cp) is stance


def test_units_waiting_without_stock_step_toward_economy() -> None:
    assert _want(waiting=3, stock=5, cap=12) is Stance.ECONOMY  # 2 * 5 < 12: short
    assert _want(waiting=3, stock=6, cap=12) is Stance.BALANCE  # half full: not short
    assert _want(waiting=2, stock=0, cap=12) is Stance.BALANCE  # below stance_wait


def test_full_warehouses_step_toward_war() -> None:
    assert _want(stock=9, cap=12) is Stance.WAR  # 75%
    assert _want(stock=8, cap=12) is Stance.BALANCE  # 66%
    assert _want(stock=12, cap=12, waiting=3) is Stance.BALANCE  # units still wait for them


def test_a_pressed_bot_short_of_cp_steps_toward_war() -> None:
    assert _want(pressed=True, cp=149) is Stance.WAR
    assert _want(pressed=True, cp=150) is Stance.BALANCE
    assert _want(pressed=False, cp=0) is Stance.BALANCE


def test_the_burn_comes_before_full_warehouses() -> None:
    assert _want(cp=500, stock=12, cap=12) is Stance.ECONOMY


def test_burning_cp_step_on_from_the_stance_in_force() -> None:
    """A War personality whose CP still burn in Balance goes on to Economy; in Economy it stays."""
    war = {**PARAMS, "stance_midgame": 2}
    inputs = StanceInputs(Phase.MIDGAME, 500, _army(), False, Stance.WAR)
    assert wanted_stance(MVP6, war, inputs, insight=True) is Stance.BALANCE
    inputs = StanceInputs(Phase.MIDGAME, 500, _army(), False, Stance.BALANCE)
    assert wanted_stance(MVP6, war, inputs, insight=True) is Stance.ECONOMY
    inputs = StanceInputs(Phase.MIDGAME, 500, _army(), False, Stance.ECONOMY)
    assert wanted_stance(MVP6, war, inputs, insight=True) is Stance.ECONOMY
    inputs = StanceInputs(Phase.MIDGAME, 300, _army(), False, Stance.ECONOMY)
    assert wanted_stance(MVP6, war, inputs, insight=True) is Stance.WAR  # no burn: back to War


def test_a_full_capital_steps_toward_war() -> None:
    """A full capital spills or burns its charge (DEC-43, item A8): a faster one adds nothing."""
    economy = {**PARAMS, "stance_midgame": 0}
    inputs = StanceInputs(Phase.MIDGAME, 300, _army(stock=2), False, Stance.ECONOMY, True)
    assert wanted_stance(MVP6, economy, inputs, insight=True) is Stance.BALANCE
    inputs = StanceInputs(Phase.MIDGAME, 300, _army(stock=2), False, Stance.ECONOMY, False)
    assert wanted_stance(MVP6, economy, inputs, insight=True) is Stance.ECONOMY


def test_the_steps_stay_in_the_three_stances() -> None:
    war = {**PARAMS, "stance_midgame": 2}
    economy = {**PARAMS, "stance_midgame": 0}
    assert _want(stock=12, params=war) is Stance.WAR
    assert _want(cp=500, params=economy) is Stance.ECONOMY


def test_without_insight_only_the_stance_of_the_phase() -> None:
    assert _want(cp=500, insight=False) is Stance.BALANCE
    assert _want(stock=12, insight=False) is Stance.BALANCE


def test_the_dwell_holds_a_change() -> None:
    policy = StancePolicy()
    assert policy.command(Stance.BALANCE, Stance.BALANCE, 10, 300) is None  # NO_CHANGE
    assert policy.command(Stance.BALANCE, Stance.WAR, 10, 300) == SetStance(Stance.WAR)
    policy.sent(10)
    assert policy.command(Stance.WAR, Stance.ECONOMY, 309, 300) is None
    assert policy.command(Stance.WAR, Stance.ECONOMY, 310, 300) == SetStance(Stance.ECONOMY)


@pytest.mark.parametrize("name", SMART)
def test_the_stance_keys_leave_the_other_draws(name: str) -> None:
    """The stance and contact keys are drawn from their own stream (``choose_params``)."""
    cls = BOTS[name]
    assert isinstance(cls, type) and issubclass(cls, SmartBot)
    rest = {k: r for k, r in cls.PARAMS.items() if not k.startswith(LATE_KEYS)}
    assert len(rest) < len(cls.PARAMS)
    for seed in range(5):
        full = choose_params(name, seed, 1, cls.PARAMS)
        assert {k: full[k] for k in rest} == choose_params(name, seed, 1, rest)
        assert full == choose_params(name, seed, 1, cls.PARAMS)


@pytest.fixture(scope="module")
def crossroads() -> MapDef:
    return load_map(ROOT / "maps" / "crossroads.json")


def _play(
    mapdef: MapDef, rules: Ruleset, names: tuple[str, str], ticks: int
) -> tuple[list[list[tuple[int, Command]]], Match]:
    match = Match(mapdef, rules, KEY)
    bots = [bot_factory(n)(mapdef, rules, seed=4, player=p) for p, n in enumerate(names)]
    sent: list[list[tuple[int, Command]]] = [[], []]
    stances: list[int] = []
    seq = 0
    while match.tick < ticks and not match.finished:
        cmds: list[PlayerCommand] = []
        if match.tick % 5 == 0:
            for p in (0, 1):
                for cmd in bots[p].decide(match.view(p), match.tick):
                    sent[p].append((match.tick, cmd))
                    cmds.append(PlayerCommand(p, seq, match.resolve(p, cmd)))
                    if isinstance(cmd, SetStance):
                        stances.append(seq)
                    seq += 1
        match.step(cmds)
        rejected = [r.seq for r in match.results if isinstance(r.outcome, Reject)]
        assert not any(s in stances for s in rejected)  # no NO_CHANGE, no FEATURE_DISABLED
    return sent, match


def test_the_personalities_take_their_stance_under_mvp6(crossroads: MapDef) -> None:
    """The opening: the rusher goes to War, the turtle to Economy at their first decision."""
    sent, match = _play(crossroads, MVP6, ("smart_rusher", "smart_turtle"), 40)
    first = [next(c for _, c in s if isinstance(c, SetStance)) for s in sent]
    assert first == [SetStance(Stance.WAR), SetStance(Stance.ECONOMY)]
    assert match.state.players[0].stance is Stance.WAR
    assert match.state.players[1].stance is Stance.ECONOMY


@pytest.mark.parametrize(
    "pair", [("smart_expander", "smart_hoarder"), ("smart_reactive", "smart_exploiter")]
)
def test_at_most_one_change_per_dwell(crossroads: MapDef, pair: tuple[str, str]) -> None:
    """A minute of play: every change is at least the smallest dwell (200 ticks) after the last."""
    sent, _ = _play(crossroads, MVP6, pair, 1200)
    for side in sent:
        ticks = [t for t, c in side if isinstance(c, SetStance)]
        assert all(b - a >= 200 for a, b in pairwise(ticks))


def test_no_stance_command_without_the_section(crossroads: MapDef) -> None:
    sent, _ = _play(crossroads, MVP4, ("smart_rusher", "smart_turtle"), 300)
    assert not any(isinstance(c, SetStance) for side in sent for _, c in side)
