"""CP accrue in 0.5 CP quanta at the same rate (``mvp-7``, owner decision 2026-11-10, #900).

Expected values come from the rules (DEC-02, DEC-44, DEC-46 in mechanics.md), worked out by hand:
``cp.per_period`` is 50 (hundredths) and the CP periods of ``mvp-7`` are Economy 100, Balance 50,
War 40 ticks, so a stance earns what it earned with 1 CP per 200 / 100 / 80 ticks. The counter
rules are those of DEC-44: +1 per tick, a quantum when it reaches the period, a real stance change
carries it over, ``c * P_new // P_old`` rounded down. Map tempo (DEC-46) scales a period
``p * 100 // pct`` once per match: narrows (29 nodes) pct 76, so 100 / 50 / 40 become 131 / 65 / 52.

Map ``dec41`` (rot180): player 0 owns 0..7, the capital is node 0.
"""

import dataclasses
from pathlib import Path

import pytest

from gow_sim.maps import load_map
from gow_sim.match import Match
from gow_sim.ruleset import Ruleset, Stance, apply_map_tempo, load_ruleset
from gow_sim.state import Event, GameState, initial_state
from gow_sim.systems.economy import economy, set_stance

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[2]
MVP6 = load_ruleset(ROOT / "rulesets" / "mvp-6.toml")
MVP7 = load_ruleset(ROOT / "rulesets" / "mvp-7.toml")
MAP = load_map(TESTS_DIR / "maps" / "dec41.json")

# No map tempo (the periods as written) and no cap in the way: the quanta can be counted.
FLAT = dataclasses.replace(MVP7, map_tempo=None, cp=dataclasses.replace(MVP7.cp, cap=1_000_000))
FLAT6 = dataclasses.replace(MVP6, cp=dataclasses.replace(MVP6.cp, cap=1_000_000))


def _state(rules: Ruleset, stance: Stance, cp: int = 0) -> GameState:
    state = initial_state(MAP, rules)
    state.players[0].stance = stance
    state.players[0].cp = cp
    return state


def _tick(state: GameState, rules: Ruleset, ticks: int) -> list[Event]:
    events: list[Event] = []
    for _ in range(ticks):
        state.tick += 1
        events = economy(state, rules)
    return events


def _quanta(
    state: GameState, rules: Ruleset, until: int, switches: dict[int, Stance] | None = None
) -> list[int]:
    """The ticks player 0 gets a quantum; ``switches`` apply before ``economy`` of their tick."""
    quanta: list[int] = []
    while state.tick < until:
        before = state.players[0].cp
        if switches and state.tick + 1 in switches:
            set_stance(state, rules, 0, switches[state.tick + 1])
        _tick(state, rules, 1)
        if state.players[0].cp > before:
            assert state.players[0].cp - before == rules.cp.per_period
            quanta.append(state.tick)
    return quanta


def test_the_quantum_is_half_a_cp() -> None:
    assert MVP7.cp.per_period == 50
    assert MVP7.cp.cap == 500  # the cap stays 5 CP


@pytest.mark.parametrize(
    ("stance", "ticks", "cp"),
    [
        # 400 ticks: Economy 400 // 100 = 4 quanta, Balance 400 // 50 = 8, War 400 // 40 = 10.
        (Stance.ECONOMY, 400, 4 * 50),
        (Stance.BALANCE, 400, 8 * 50),
        (Stance.WAR, 400, 10 * 50),
        # A quantum lands exactly at the period and not a tick earlier.
        (Stance.BALANCE, 49, 0),
        (Stance.BALANCE, 50, 50),
        (Stance.WAR, 39, 0),
        (Stance.WAR, 40, 50),
        (Stance.ECONOMY, 99, 0),
        (Stance.ECONOMY, 100, 50),
    ],
)
def test_cp_after_n_ticks_in_each_stance(stance: Stance, ticks: int, cp: int) -> None:
    state = _state(FLAT, stance)
    _tick(state, FLAT, ticks)
    assert state.players[0].cp == cp


@pytest.mark.parametrize("stance", list(Stance))
def test_the_cp_rate_is_that_of_mvp_6(stance: Stance) -> None:
    """1200 ticks is a whole number of cycles of every period (200 / 100 / 80 and 100 / 50 / 40
    all divide it): the same CP as one 1 CP quantum per 200 / 100 / 80."""
    old, new = _state(FLAT6, stance), _state(FLAT, stance)
    _tick(old, FLAT6, 1200)
    _tick(new, FLAT, 1200)
    assert new.players[0].cp == old.players[0].cp
    expected = {Stance.ECONOMY: 600, Stance.BALANCE: 1200, Stance.WAR: 1500}
    assert new.players[0].cp == expected[stance]


def test_half_a_cp_on_the_account_reaches_one_cp_in_half_the_time() -> None:
    """The reason of #900: with 0.5 CP a 1 CP order (100) is paid after one Balance period of 50
    ticks, not 100."""
    state = _state(FLAT, Stance.BALANCE, cp=50)
    _tick(state, FLAT, 49)
    assert state.players[0].cp == 50
    _tick(state, FLAT, 1)
    assert state.players[0].cp == 100 == FLAT.orders.cost.move


def test_the_cap_burns_the_excess_of_a_half_quantum() -> None:
    rules = dataclasses.replace(FLAT, cp=dataclasses.replace(FLAT.cp, cap=500))
    state = _state(rules, Stance.BALANCE, cp=480)
    events = _tick(state, rules, 50)  # the quantum would make 530: 30 burn
    assert state.players[0].cp == 500
    assert [e.get("cp") for e in events if e.kind == "cp_burned"] == [30]


def test_a_switch_mid_period_carries_the_counter() -> None:
    """Balance, 30 ticks of the period 50 done. War (period 40) carries 30 * 40 // 50 = 24, tick
    31 makes 25, the quantum comes when the counter reaches 40: tick 31 + 15 = 46, then 86.
    Economy (period 100) carries 30 * 100 // 50 = 60, tick 31 makes 61: the quantum at 31 + 39 = 70,
    then 170."""
    state = _state(FLAT, Stance.BALANCE)
    _tick(state, FLAT, 30)
    assert state.players[0].cp_ticks == 30
    set_stance(state, FLAT, 0, Stance.WAR)
    assert state.players[0].cp_ticks == 24
    assert _quanta(state, FLAT, 90) == [46, 86]

    state = _state(FLAT, Stance.BALANCE)
    _tick(state, FLAT, 30)
    assert _quanta(state, FLAT, 180, {31: Stance.ECONOMY}) == [70, 170]


def test_a_switch_back_costs_at_most_the_rounding() -> None:
    """Balance 30 ticks, War (30 * 40 // 50 = 24), straight back to Balance (24 * 50 // 40 = 30):
    nothing is lost for these numbers; the quantum still comes at tick 50."""
    state = _state(FLAT, Stance.BALANCE)
    _tick(state, FLAT, 30)
    set_stance(state, FLAT, 0, Stance.WAR)
    set_stance(state, FLAT, 0, Stance.BALANCE)
    assert state.players[0].cp_ticks == 30
    assert _quanta(state, FLAT, 60) == [50]


def test_narrows_periods_and_a_carry_between_them() -> None:
    """Narrows: 29 nodes, pct 76, so 100 / 50 / 40 become 100 * 100 // 76 = 131, 5000 // 76 = 65,
    4000 // 76 = 52. Balance 40 ticks done: War carries 40 * 52 // 65 = 32, tick 41 makes 33, the
    quantum at 41 + 19 = 60. Balance 64 done, Economy carries 64 * 131 // 65 = 128 (8384 // 65,
    rounded down), tick 65 makes 129, the quantum at 65 + 2 = 67."""
    narrows = load_map(ROOT / "maps" / "narrows.json")
    played = apply_map_tempo(
        dataclasses.replace(MVP7, cp=dataclasses.replace(MVP7.cp, cap=1_000_000)), narrows
    )
    t = played.stances.cp_period_ticks
    assert (t.economy, t.balance, t.war) == (131, 65, 52)

    state = initial_state(MAP, played)
    state.players[0].cp = 0
    _tick(state, played, 40)
    set_stance(state, played, 0, Stance.WAR)
    assert state.players[0].cp_ticks == 32
    assert _quanta(state, played, 120) == [60, 112]

    state = initial_state(MAP, played)
    state.players[0].cp = 0
    _tick(state, played, 64)
    set_stance(state, played, 0, Stance.ECONOMY)
    assert state.players[0].cp_ticks == 128
    assert _quanta(state, played, 200) == [67, 198]


def test_a_match_on_narrows_gets_half_a_cp_at_tick_65() -> None:
    """The played rules of a match on narrows: Balance (the start stance), the first quantum at
    tick 65 (5000 // 76), the second at 130; CP start 300."""
    match = Match(load_map(ROOT / "maps" / "narrows.json"), MVP7, bytes(range(32)))
    assert match.rules.cp.per_period == 50
    for _ in range(64):
        match.step()
    assert match.state.players[0].cp == 300
    match.step()
    assert match.state.players[0].cp == 350
    for _ in range(65):
        match.step()
    assert match.state.players[0].cp == 400
